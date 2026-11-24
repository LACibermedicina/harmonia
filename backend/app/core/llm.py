"""Cliente de IA com failover entre provedores (tradução contextual e assistente Maestro).

Provedores (entram na cadeia só se a chave existir no .env da VPS):
  pagos/assinatura: anthropic, openai
  gratuitos (free tier, sem cartão): groq, gemini, github (GitHub Models), cerebras, mistral, openrouter (openrouter/free)
Ordem: AI_PROVIDERS (os configurados que não estiverem na lista entram no fim, para nenhuma chave ficar ociosa).

Origem das chaves de cada provedor, nesta prioridade (a seguinte só é usada se a anterior faltar ou falhar no teste):
  1. env      — .env da VPS, sincronizado a partir do GitHub (SERVIDOR_ENV / secrets). Lido ao vivo de
                /data/ai/env.ai (coletar-ia.sh) e, se não houver, das variáveis do processo.
  2. apps:X   — chaves de IA encontradas em outras apps da mesma VPS (ex.: Prática, Gusto) — /data/ai/apps.ai.
  3. painel   — cadastradas em Administração → IA.
O diagnóstico testa TODAS as chaves e grava o resultado em /data/ai/status.json; chave reprovada sai da frente.
Em erro de rede, timeout, 429, 5xx ou chave inválida, o próximo provedor responde; o que falhou fica em pausa
crescente (circuit breaker, AI_COOLDOWN_S). Se TODOS falharem, as rotas usam fallbacks sem IA generativa
(tradução gratuita MyMemory e respostas do Maestro offline) — as funcionalidades sempre respondem.

LGPD: só textos de interface e resumos musicais são enviados — nunca nome/e-mail de usuários.
Chaves NUNCA são logadas nem devolvidas pela API.
"""
from __future__ import annotations

import logging
import os
import time
from dataclasses import dataclass

import httpx
from fastapi import HTTPException

log = logging.getLogger("harmonia.llm")
DEFAULT_ORDER = "anthropic,openai,groq,gemini,github,cerebras,mistral,openrouter,pollinations,deepseek,xai,together,huggingface"
AI_DIR = os.getenv("AI_DATA_DIR", "/data/ai")
SOURCE_RANK = {"env": 0, "apps": 1, "painel": 2, "anon": 3}
RETRY_MODEL = {404, 429, 500, 502, 503, 504}  # erros em que vale tentar o modelo reserva do mesmo provedor


@dataclass
class Cand:
    """Uma chave candidata de um provedor, com seu próprio disjuntor (circuit breaker)."""
    source: str                        # env | apps:<app> | painel
    key: str
    failures: int = 0
    paused_until: float = 0.0
    last_error: str = ""
    last_ok: float = 0.0
    verified: bool | None = None       # resultado do último teste (None = ainda não testada)
    checked_at: float = 0.0

    @property
    def fid(self) -> str:              # identificador estável SEM revelar a chave
        import hashlib
        return hashlib.sha256(self.key.encode()).hexdigest()[:12]

    @property
    def hint(self) -> str:
        if not self.key:
            return "sem chave"
        return ("••••" + self.key[-4:]) if len(self.key) > 8 else "••••"


_pool_cache: dict[str, tuple[float, object]] = {}


def _read_file(name: str):
    """Lê env.ai (CHAVE=valor) ou apps.ai (CHAVE@app=valor) com cache pela data de modificação."""
    path = os.path.join(AI_DIR, name)
    try:
        mt = os.path.getmtime(path)
    except OSError:
        return [] if name == "apps.ai" else {}
    hit = _pool_cache.get(name)
    if hit and hit[0] == mt:
        return hit[1]
    out: object = [] if name == "apps.ai" else {}
    try:
        for raw in open(path, encoding="utf-8", errors="ignore"):
            raw = raw.strip()
            if not raw or raw.startswith("#") or "=" not in raw:
                continue
            k, v = raw.split("=", 1)
            if name == "apps.ai":
                env, _, app = k.partition("@")
                out.append((env, app or "app", v))  # type: ignore[union-attr]
            else:
                out[k] = v  # type: ignore[index]
    except OSError:
        pass
    _pool_cache[name] = (mt, out)
    return out


def pool_env(k: str) -> str:
    """Valor do acervo env.ai (atualizado sem reiniciar) ou do processo."""
    v = _read_file("env.ai").get(k, "")  # type: ignore[union-attr]
    return v or os.getenv(k, "").strip().strip('"').strip("'")


_status_cache: tuple[float, dict] = (0.0, {})


def _load_status() -> dict:
    global _status_cache
    path = os.path.join(AI_DIR, "status.json")
    try:
        mt = os.path.getmtime(path)
    except OSError:
        return _status_cache[1]
    if mt != _status_cache[0]:
        try:
            import json
            _status_cache = (mt, json.load(open(path)))
        except Exception:  # noqa: BLE001
            pass
    return _status_cache[1]


def _save_status(results: dict) -> None:
    import json
    cur = dict(_load_status())
    cur.update(results)
    path = os.path.join(AI_DIR, "status.json")
    try:
        tmp = path + ".tmp"
        with open(tmp, "w") as fh:
            json.dump(cur, fh)
        os.replace(tmp, path)
    except OSError:
        pass  # sem pasta de dados (dev/testes): resultado fica só na memória


@dataclass
class Provider:
    name: str
    label: str
    key_envs: tuple[str, ...]          # aceita nomes alternativos (ex.: GOOGLE_API_KEY)
    model_env: str
    default_model: str
    kind: str                          # anthropic | openai | gemini
    url: str = ""
    free: bool = False
    db_key: str = ""                   # cadastrada no painel (reserva: só entra se env/apps faltarem ou falharem)
    db_model: str = ""
    fallback_env: str = ""             # modelos reserva (lista separada por vírgula), ex.: GEMINI_FALLBACK_MODELS
    default_fallbacks: str = ""
    anon_env: str = ""                 # provedor que aceita uso anônimo (sem chave), ex.: AI_POLLINATIONS_ANON
    source: str = "env"
    custom: bool = False
    failures: int = 0
    paused_until: float = 0.0
    last_error: str = ""
    last_ok: float = 0.0
    calls: int = 0
    _cands: dict = None  # type: ignore[assignment]  # fid -> Cand (mantém o disjuntor de cada chave)

    def candidates(self) -> list[Cand]:
        """Chaves na ordem de prioridade: .env/GitHub → outras apps → painel (sem repetir a mesma chave)."""
        if self._cands is None:
            self._cands = {}
        want: list[tuple[str, str]] = []
        for k in self.key_envs:                      # 1. env (acervo ao vivo e variáveis do processo)
            for v in (_read_file("env.ai").get(k, ""), os.getenv(k, "").strip().strip('"').strip("'")):  # type: ignore[union-attr]
                if v:
                    want.append(("env", v))
        canon = self.key_envs[0] if self.key_envs else ""
        for env, app, v in _read_file("apps.ai"):    # 2. outras apps da VPS
            if env == canon:
                want.append((f"apps:{app}", v))
        if self.db_key:                              # 3. painel
            want.append(("painel", self.db_key))
        if self.anon_env and pool_env(self.anon_env).lower() not in ("0", "false", "no", "nao", "não", "off"):  # padrão: ligado
            want.append(("anon", ""))                # 4. uso anônimo gratuito (limitado), por último
        st = _load_status().get(self.name, {})
        out, seen = [], set()
        for src, v in want:
            c = Cand(src, v)
            if c.fid in seen and src != "anon":
                continue
            seen.add(c.fid)
            c = self._cands.setdefault(c.fid, c)
            c.source = src
            r = st.get(c.fid)
            if r and r.get("at", 0) > c.checked_at:
                c.verified, c.checked_at = bool(r.get("ok")), r.get("at", 0)
            out.append(c)
        return out

    def usable(self) -> list[Cand]:
        """Candidatas utilizáveis: reprovadas no teste vão para o fim (só se não houver outra)."""
        cs = self.candidates()
        return [c for c in cs if c.verified is not False] + [c for c in cs if c.verified is False]

    @property
    def active(self) -> Cand | None:
        cs = self.usable()
        return cs[0] if cs else None

    @property
    def key(self) -> str:
        a = self.active
        return a.key if a else ""

    @property
    def model(self) -> str:
        return self.db_model or pool_env(self.model_env) or self.default_model

    @property
    def key_source(self) -> str:
        a = self.active
        return a.source if a else ""

    @property
    def models(self) -> list[str]:
        """Modelo principal + reservas (tentadas quando o principal está sobrecarregado/indisponível)."""
        extra = [m.strip() for m in (pool_env(self.fallback_env) if self.fallback_env else "").split(",") if m.strip()] if self.fallback_env else []
        if not extra and self.default_fallbacks:
            extra = [m.strip() for m in self.default_fallbacks.split(",") if m.strip()]
        out = []
        for m in [self.model, *extra]:
            if m and m not in out:
                out.append(m)
        return out


PROVIDERS: dict[str, Provider] = {p.name: p for p in [
    Provider("anthropic", "Anthropic Claude", ("ANTHROPIC_API_KEY", "CLAUDE_API_KEY"), "AI_MODEL", "claude-sonnet-4-5", "anthropic"),
    Provider("openai", "OpenAI", ("OPENAI_API_KEY",), "OPENAI_MODEL", "gpt-4o-mini", "openai",
             "https://api.openai.com/v1/chat/completions"),
    Provider("groq", "Groq (gratuito)", ("GROQ_API_KEY",), "GROQ_MODEL", "llama-3.3-70b-versatile", "openai",
             "https://api.groq.com/openai/v1/chat/completions", free=True),
    Provider("gemini", "Google Gemini (gratuito)", ("GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_AI_API_KEY"), "GEMINI_MODEL",
             "gemini-2.5-flash", "gemini", free=True, fallback_env="GEMINI_FALLBACK_MODELS", default_fallbacks="gemini-2.5-flash,gemini-2.5-flash-lite"),
    Provider("github", "GitHub Models (gratuito)", ("GITHUB_MODELS_TOKEN", "GH_MODELS_TOKEN"), "GITHUB_MODELS_MODEL",
             "openai/gpt-4.1-mini", "openai", "https://models.github.ai/inference/chat/completions", free=True),
    Provider("cerebras", "Cerebras (gratuito)", ("CEREBRAS_API_KEY",), "CEREBRAS_MODEL", "llama3.1-8b", "openai",
             "https://api.cerebras.ai/v1/chat/completions", free=True),
    Provider("mistral", "Mistral (gratuito)", ("MISTRAL_API_KEY",), "MISTRAL_MODEL", "mistral-small-latest", "openai",
             "https://api.mistral.ai/v1/chat/completions", free=True),
    Provider("openrouter", "OpenRouter (modelos :free)", ("OPENROUTER_API_KEY",), "OPENROUTER_MODEL", "openrouter/free", "openai",
             "https://openrouter.ai/api/v1/chat/completions", free=True),
    Provider("pollinations", "Pollinations (gratuito)", ("POLLINATIONS_API_KEY", "POLLINATIONS_TOKEN"), "POLLINATIONS_MODEL", "openai", "openai",
             "https://gen.pollinations.ai/v1/chat/completions", free=True, fallback_env="POLLINATIONS_FALLBACK_MODELS",
             default_fallbacks="openai-fast,mistral", anon_env="AI_POLLINATIONS_ANON"),
    Provider("deepseek", "DeepSeek", ("DEEPSEEK_API_KEY",), "DEEPSEEK_MODEL", "deepseek-chat", "openai",
             "https://api.deepseek.com/chat/completions"),
    Provider("xai", "xAI Grok", ("XAI_API_KEY", "GROK_API_KEY"), "XAI_MODEL", "grok-3-mini", "openai",
             "https://api.x.ai/v1/chat/completions"),
    Provider("together", "Together AI", ("TOGETHER_API_KEY",), "TOGETHER_MODEL", "meta-llama/Llama-3.3-70B-Instruct-Turbo-Free", "openai",
             "https://api.together.xyz/v1/chat/completions", free=True),
    Provider("huggingface", "Hugging Face (Inference)", ("HF_TOKEN", "HUGGINGFACE_API_KEY"), "HF_MODEL", "meta-llama/Llama-3.1-8B-Instruct", "openai",
             "https://router.huggingface.co/v1/chat/completions", free=True),
]}


BUILTIN = set(PROVIDERS)
_loaded_at = 0.0


def refresh_from_db(force: bool = False) -> None:
    """Carrega credenciais cadastradas no painel (cache de 30 s; cada worker do uvicorn recarrega sozinho)."""
    global _loaded_at
    if not force and time.time() - _loaded_at < 30:
        return
    _loaded_at = time.time()
    try:
        from sqlalchemy import select

        from ..models import AICredential
        from .db import SessionLocal
        from .security import decrypt
        with SessionLocal() as db:
            rows = list(db.scalars(select(AICredential)))
    except Exception as e:  # noqa: BLE001 — banco fora: segue só com o .env
        log.warning("credenciais do painel indisponíveis: %s", type(e).__name__)
        return
    seen = set()
    for r in rows:
        seen.add(r.name)
        try:
            key = decrypt(r.key_enc) if r.enabled else ""
        except Exception:  # noqa: BLE001
            key = ""
        p = PROVIDERS.get(r.name)
        if p is None:
            p = PROVIDERS[r.name] = Provider(r.name, r.label or r.name, (), "", r.model or "", r.kind, r.url, free=r.free, custom=True)
        p.db_key, p.db_model = key, r.model or ""
        if p.custom:
            p.kind, p.url, p.label, p.default_model, p.free = r.kind, r.url, r.label or r.name, r.model or p.default_model, r.free
    for name in list(PROVIDERS):
        if name not in seen:
            if name in BUILTIN:
                PROVIDERS[name].db_key = PROVIDERS[name].db_model = ""
            else:
                PROVIDERS.pop(name)


def order() -> list[str]:
    listed = [p.strip() for p in (os.getenv("AI_PROVIDERS") or DEFAULT_ORDER).split(",") if p.strip() in PROVIDERS]
    rest = [n for n in DEFAULT_ORDER.split(",") if n not in listed]
    custom = [n for n in PROVIDERS if n not in listed and n not in rest]
    return listed + rest + custom


def chain() -> list[Provider]:
    refresh_from_db()
    return [PROVIDERS[n] for n in order() if PROVIDERS[n].candidates()]


async def _call(p: Provider, client: httpx.AsyncClient, system: str, user: str, max_tokens: int, key: str | None = None) -> str:
    """Chama o provedor; se o modelo principal estiver sobrecarregado/indisponível, tenta os modelos reserva."""
    key = p.key if key is None else key
    models = p.models or [p.model]
    for i, model in enumerate(models):
        try:
            return await _call_model(p, client, system, user, max_tokens, key, model)
        except httpx.HTTPStatusError as e:
            if e.response is None or e.response.status_code not in RETRY_MODEL or i == len(models) - 1:
                raise
            log.info("IA %s: modelo %s indisponível (HTTP %s) — tentando %s", p.name, model, e.response.status_code, models[i + 1])
    raise RuntimeError("sem modelo")


def _text_of(msg: dict) -> str:
    """Conteúdo da resposta (alguns modelos gratuitos de raciocínio só preenchem 'reasoning')."""
    c = msg.get("content")
    if isinstance(c, list):
        c = "".join(x.get("text", "") for x in c if isinstance(x, dict))
    return (c or "").strip() or (msg.get("reasoning") or msg.get("reasoning_content") or "").strip()


async def _call_model(p: Provider, client: httpx.AsyncClient, system: str, user: str, max_tokens: int, key: str, model: str) -> str:
    if p.kind == "anthropic":
        r = await client.post("https://api.anthropic.com/v1/messages",
                              headers={"x-api-key": key, "anthropic-version": "2023-06-01"},
                              json={"model": model, "max_tokens": max_tokens, "system": system,
                                    "messages": [{"role": "user", "content": user}]})
        r.raise_for_status()
        return "".join(b.get("text", "") for b in r.json().get("content", []))
    if p.kind == "openai":
        headers = {"Authorization": f"Bearer {key}"} if key else {}
        if p.name == "openrouter":
            headers |= {"HTTP-Referer": os.getenv("PUBLIC_BASE_URL", "https://harmonia.m3d.pro"), "X-Title": "harmonIA"}
        if p.name == "github":
            headers |= {"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}
        body = {"model": model, "max_tokens": max_tokens, "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]}
        if p.name != "pollinations":
            body["temperature"] = 0.3
        r = await client.post(p.url, headers=headers, json=body)
        r.raise_for_status()
        ch = (r.json().get("choices") or [{}])[0]
        return _text_of(ch.get("message") or {})
    if p.kind == "gemini":
        r = await client.post(f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
                              headers={"x-goog-api-key": key},
                              json={"systemInstruction": {"parts": [{"text": system}]},
                                    "contents": [{"role": "user", "parts": [{"text": user}]}],
                                    "generationConfig": {"maxOutputTokens": max_tokens, "temperature": 0.3}})
        r.raise_for_status()
        cands = r.json().get("candidates") or []
        return "".join(part.get("text", "") for part in (cands[0].get("content", {}).get("parts", []) if cands else []))
    raise ValueError(p.name)


# ------------------------------------------------------------------ visão (imagem + texto)
# Modelos com visão por provedor (o modelo de texto configurado nem sempre enxerga imagens).
VISION_MODELS = {
    "gemini": ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash"],
    "openai": ["gpt-4o-mini"], "github": ["openai/gpt-4o-mini", "gpt-4o-mini"],
    "anthropic": ["claude-sonnet-4-5", "claude-3-5-sonnet-latest"],
    "openrouter": ["google/gemini-2.0-flash-exp:free", "meta-llama/llama-4-maverick:free", "qwen/qwen2.5-vl-72b-instruct:free"],
    "groq": ["meta-llama/llama-4-scout-17b-16e-instruct"], "pollinations": ["openai"],
    "mistral": ["pixtral-12b-2409"], "together": ["meta-llama/Llama-Vision-Free"],
}


async def _vision_model(p: Provider, client: httpx.AsyncClient, system: str, user: str, img_b64: str, mime: str,
                        max_tokens: int, key: str, model: str) -> str:
    if p.kind == "anthropic":
        r = await client.post("https://api.anthropic.com/v1/messages",
                              headers={"x-api-key": key, "anthropic-version": "2023-06-01"},
                              json={"model": model, "max_tokens": max_tokens, "system": system,
                                    "messages": [{"role": "user", "content": [
                                        {"type": "image", "source": {"type": "base64", "media_type": mime, "data": img_b64}},
                                        {"type": "text", "text": user}]}]})
        r.raise_for_status()
        return "".join(b.get("text", "") for b in r.json().get("content", []))
    if p.kind == "gemini":
        r = await client.post(f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
                              headers={"x-goog-api-key": key},
                              json={"systemInstruction": {"parts": [{"text": system}]},
                                    "contents": [{"role": "user", "parts": [{"inline_data": {"mime_type": mime, "data": img_b64}}, {"text": user}]}],
                                    "generationConfig": {"maxOutputTokens": max_tokens, "temperature": 0.1}})
        r.raise_for_status()
        cands = r.json().get("candidates") or []
        return "".join(part.get("text", "") for part in (cands[0].get("content", {}).get("parts", []) if cands else []))
    headers = {"Authorization": f"Bearer {key}"} if key else {}
    if p.name == "openrouter":
        headers |= {"HTTP-Referer": os.getenv("PUBLIC_BASE_URL", "https://harmonia.m3d.pro"), "X-Title": "harmonIA"}
    body = {"model": model, "max_tokens": max_tokens, "messages": [
        {"role": "system", "content": system},
        {"role": "user", "content": [{"type": "text", "text": user}, {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{img_b64}"}}]}]}
    r = await client.post(p.url, headers=headers, json=body)
    r.raise_for_status()
    ch = (r.json().get("choices") or [{}])[0]
    return _text_of(ch.get("message") or {})


async def complete_vision(system: str, user: str, img_b64: str, mime: str = "image/jpeg", max_tokens: int = 6000,
                          timeout: float = 120) -> tuple[str, str]:
    """Pergunta com imagem: tenta os provedores com visão (modelos de visão de cada um), com failover."""
    providers = [p for p in chain() if p.name in VISION_MODELS or p.kind in ("anthropic", "gemini")]
    if not providers:
        raise HTTPException(503, "Nenhum provedor de IA com visão configurado no servidor")
    errors = []
    async with httpx.AsyncClient(timeout=timeout) as client:
        for p in providers:
            models = VISION_MODELS.get(p.name) or VISION_MODELS.get(p.kind) or [p.model]
            for c in p.usable():
                for m in models:
                    try:
                        text = await _vision_model(p, client, system, user, img_b64, mime, max_tokens, c.key, m)
                        if text.strip():
                            return text, f"{p.name}/{m}"
                        errors.append(f"{p.name}/{m}: vazio")
                    except Exception as e:  # noqa: BLE001
                        code = getattr(getattr(e, "response", None), "status_code", None)
                        errors.append(f"{p.name}/{m}: {('HTTP ' + str(code)) if code else type(e).__name__}")
                        log.info("visão %s/%s falhou (%s)", p.name, m, errors[-1])
                        if code in (401, 403):
                            break  # chave sem permissão: próxima chave/provedor
    raise HTTPException(502, "Nenhuma IA com visão conseguiu ler a imagem: " + "; ".join(errors[:6]))


async def complete(system: str, user: str, max_tokens: int = 2000, timeout: float | None = None) -> str:
    return (await complete_ex(system, user, max_tokens, timeout))[0]


async def complete_ex(system: str, user: str, max_tokens: int = 2000, timeout: float | None = None) -> tuple[str, str]:
    """Como complete(), mas devolve também o nome do provedor que respondeu."""
    providers = chain()
    if not providers:
        raise HTTPException(503, "Nenhum provedor de IA configurado no servidor")
    cooldown = float(os.getenv("AI_COOLDOWN_S", "60"))
    now = time.time()
    # cada provedor tenta suas chaves na ordem env → apps → painel; chaves em pausa vão para o fim da fila
    pairs = [(p, c) for p in providers for c in p.usable()]
    ordered = [x for x in pairs if x[1].paused_until <= now] + [x for x in pairs if x[1].paused_until > now]
    errors = []
    async with httpx.AsyncClient(timeout=timeout or float(os.getenv("AI_TIMEOUT_S", "45"))) as client:
        for p, c in ordered:
            p.calls += 1
            try:
                text = await _call(p, client, system, user, max_tokens, key=c.key)
                if not text.strip():
                    raise ValueError("resposta vazia")
                c.failures, c.last_ok, c.last_error, c.paused_until = 0, time.time(), "", 0.0
                p.failures, p.last_ok, p.last_error, p.paused_until = 0, c.last_ok, "", 0.0
                return text, p.name
            except Exception as e:  # noqa: BLE001
                resp = getattr(e, "response", None)
                code = getattr(resp, "status_code", None)
                c.failures += 1
                c.last_error = (f"HTTP {code}" + (f" — {provider_message(resp)[:90]}" if provider_message(resp) else "")) if code else type(e).__name__
                c.paused_until = time.time() + cooldown * min(c.failures, 10)
                p.failures, p.last_error, p.paused_until = p.failures + 1, c.last_error, c.paused_until
                errors.append(f"{p.name}[{c.source}]: {c.last_error}")
                log.warning("IA %s (%s) falhou (%s) — tentando a próxima", p.name, c.source, c.last_error)
    raise HTTPException(502, "Todos os provedores de IA falharam: " + "; ".join(errors))


def status() -> list[dict]:
    refresh_from_db()
    now = time.time()
    out = []
    for i, n in enumerate(order()):
        p = PROVIDERS[n]
        cs = p.candidates()
        a = p.active
        k = a.key if a else ""
        out.append({"name": n, "label": p.label, "free": p.free, "configured": bool(k), "model": p.model,
                    "keySource": p.key_source, "keyHint": a.hint if a else "",
                    "candidates": [{"source": c.source, "hint": c.hint, "verified": c.verified, "active": c is a,
                                    "paused": c.paused_until > now, "lastError": c.last_error} for c in cs],
                    "custom": p.custom, "kind": p.kind, "url": p.url if p.custom else "",
                    "position": i + 1, "paused": p.paused_until > now, "failures": p.failures,
                    "lastError": p.last_error, "lastOk": p.last_ok or None, "calls": p.calls})
    return out


def provider_message(resp) -> str:
    """Trecho da mensagem de erro do provedor (ex.: 'credit balance is too low'), sem expor chaves."""
    if resp is None:
        return ""
    try:
        j = resp.json()
        err = j.get("error", j) if isinstance(j, dict) else j
        msg = (err.get("message") if isinstance(err, dict) else str(err)) or ""
    except Exception:  # noqa: BLE001
        msg = (getattr(resp, "text", "") or "")[:300]
    import re as _re
    msg = _re.sub(r"(sk|gsk|AIza|ghp|github_pat|sk-or|sk-ant)[-_A-Za-z0-9]{6,}", "[chave oculta]", str(msg))
    return msg.strip()[:240]


ERROR_HINTS = {
    402: "sem créditos/saldo na conta do provedor (ou modelo pago)",
    400: "requisição recusada (saldo de créditos insuficiente, modelo ou parâmetros inválidos)", 401: "chave inválida ou expirada",
    403: "sem permissão para este modelo/conta", 404: "modelo ou endpoint não encontrado",
    408: "tempo esgotado no provedor", 429: "limite de uso ou cota esgotada (no OpenAI: conta sem créditos/billing)",
    500: "erro interno do provedor", 502: "provedor indisponível", 503: "provedor sobrecarregado", 504: "provedor não respondeu a tempo",
}


async def refresh_pool(wait: float = 8.0) -> bool:
    """Pede ao host a recoleta do acervo (.env do GitHub + outras apps) e espera até `wait` s pela atualização."""
    import asyncio
    req = os.path.join(AI_DIR, "refresh.request")
    env_file = os.path.join(AI_DIR, "env.ai")
    try:
        t0 = time.time()
        with open(req, "w") as fh:
            fh.write(str(int(t0)))
    except OSError:
        return False  # sem pasta de dados (dev/testes)
    while time.time() - t0 < wait:
        try:
            if os.path.getmtime(env_file) >= t0 - 0.5:
                return True
        except OSError:
            pass
        await asyncio.sleep(0.4)
    return False


async def diagnose(names: list[str] | None = None, timeout: float = 20, refresh: bool = False) -> list[dict]:
    """Testa TODAS as chaves de cada provedor (em paralelo): primeiro as do .env/GitHub, depois as de outras apps
    e as do painel. Grava o resultado (status.json) para que chaves reprovadas saiam da frente em todos os workers."""
    import asyncio
    refreshed = await refresh_pool() if refresh else False
    refresh_from_db(force=True)
    targets = [PROVIDERS[n] for n in order() if (names is None or n in names)]

    async def test(p: Provider, c: Cand, client: httpx.AsyncClient) -> dict:
        t0 = time.time()
        r = {"source": c.source, "hint": c.hint}
        try:
            text = await _call(p, client, "Você é um teste de conectividade. Responda apenas: ok", "teste", 256, key=c.key)
            ms = int((time.time() - t0) * 1000)
            if not text.strip():
                r |= {"ok": False, "ms": ms, "detail": "resposta vazia"}
            else:
                c.failures, c.paused_until, c.last_error, c.last_ok = 0, 0.0, "", time.time()
                r |= {"ok": True, "ms": ms, "reply": text.strip()[:40]}
        except Exception as e:  # noqa: BLE001
            resp = getattr(e, "response", None)
            code = getattr(resp, "status_code", None)
            detail = ERROR_HINTS.get(code, "") if code else ("tempo esgotado" if "Timeout" in type(e).__name__ else "falha de rede/conexão")
            r |= {"ok": False, "ms": int((time.time() - t0) * 1000), "code": code, "detail": detail or f"HTTP {code}",
                  "provider_message": provider_message(resp)}
        c.verified, c.checked_at = r["ok"], time.time()
        r["_fid"] = c.fid
        return r

    async def one(p: Provider, client: httpx.AsyncClient) -> dict:
        cs = p.candidates()
        ms = p.models
        base = {"name": p.name, "label": p.label, "model": ms[0] + (f" (reserva: {', '.join(ms[1:])})" if len(ms) > 1 else ""), "free": p.free}
        if not cs:
            return base | {"ok": False, "state": "sem_chave", "keySource": "", "detail": "sem chave cadastrada", "candidates": []}
        rs = list(await asyncio.gather(*(test(p, c, client) for c in cs)))
        good = next((r for r in rs if r["ok"]), None)
        main = good or rs[0]  # resposta principal: a 1ª que funcionou (na ordem de prioridade) ou a de maior prioridade
        out = base | {k: v for k, v in main.items() if not k.startswith("_") and k not in ("source", "hint")}
        out |= {"state": "ok" if good else "erro", "keySource": main["source"], "keyHint": main["hint"],
                "candidates": [{k: v for k, v in r.items() if not k.startswith("_")} for r in rs]}
        if good and good is not rs[0]:
            out["note"] = f"{rs[0]['source']} falhou; usando a chave de {good['source']}"
        out["_save"] = {r["_fid"]: {"ok": r["ok"], "at": time.time(), "source": r["source"]} for r in rs}
        return out

    async with httpx.AsyncClient(timeout=timeout) as client:
        results = list(await asyncio.gather(*(one(p, client) for p in targets)))
    save = {}
    for r in results:
        sv = r.pop("_save", None)
        if sv:
            save[r["name"]] = {**_load_status().get(r["name"], {}), **sv}
    _save_status(save)
    if refresh and results:
        results[0]["poolRefreshed"] = refreshed
    if names is not None:  # teste pontual de um provedor (botão "Testar")
        return results
    # fallbacks gratuitos sem chave
    t0 = time.time()
    mm = await free_translate(["Tocar"], "en")
    results.append({"name": "mymemory", "label": "MyMemory (tradução grátis, sem chave)", "free": True, "keySource": "—",
                    "model": "—", "ok": bool(mm), "state": "ok" if mm else "erro", "ms": int((time.time() - t0) * 1000),
                    "detail": "" if mm else "indisponível ou cota diária esgotada"})
    results.append({"name": "offline", "label": "Maestro offline (local)", "free": True, "keySource": "—", "model": "—",
                    "ok": True, "state": "ok", "ms": 0, "detail": "sempre disponível"})
    return results


# ------------------------------------------------------- fallbacks sem chave
MYMEMORY_LANG = {"zh": "zh-CN", "es": "es-ES", "en": "en-GB", "hi": "hi-IN", "pt": "pt-BR"}


async def free_translate(texts: list[str], target: str, source: str = "pt") -> dict[str, str]:
    """Tradução gratuita (MyMemory, sem chave). Agrupa textos curtos para economizar a cota diária."""
    sep = "\n¶\n"
    out: dict[str, str] = {}
    email = os.getenv("MYMEMORY_EMAIL", "").strip()
    batches, cur = [], []
    for t in texts:
        if len(sep.join(cur + [t]).encode()) > 450 and cur:
            batches.append(cur); cur = []
        cur.append(t)
    if cur:
        batches.append(cur)
    async with httpx.AsyncClient(timeout=12) as client:
        for b in batches:
            params = {"q": sep.join(b), "langpair": f"{MYMEMORY_LANG.get(source, source)}|{MYMEMORY_LANG.get(target, target)}"}
            if email:
                params["de"] = email
            try:
                r = await client.get("https://api.mymemory.translated.net/get", params=params)
                txt = r.json().get("responseData", {}).get("translatedText", "")
            except Exception:  # noqa: BLE001
                break
            parts = [x.strip() for x in txt.split("¶")]
            if len(parts) == len(b):
                out.update({src: dst for src, dst in zip(b, parts) if dst and "MYMEMORY WARNING" not in dst})
            elif len(b) == 1 and txt:
                out[b[0]] = txt.strip()
    return out
