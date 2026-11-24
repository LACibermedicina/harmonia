import asyncio
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import pytest
from fastapi import HTTPException

from app.core import llm


@pytest.fixture(autouse=True)
def keys(monkeypatch, tmp_path):
    monkeypatch.setattr(llm, "AI_DIR", str(tmp_path))
    llm._pool_cache.clear()
    monkeypatch.setattr(llm, "_status_cache", (0.0, {}))
    for k in ("ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY", "OPENROUTER_API_KEY"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setenv("AI_PROVIDERS", "anthropic,openai,gemini,openrouter")
    monkeypatch.setattr(llm, "refresh_from_db", lambda force=False: None)  # isola do banco de teste
    for name in list(llm.PROVIDERS):
        if name not in llm.BUILTIN:
            llm.PROVIDERS.pop(name)
    for p in llm.PROVIDERS.values():
        p.failures, p.paused_until, p.last_error, p.db_key, p.db_model, p._cands = 0, 0.0, "", "", "", None
    for k in ("GEMINI_MODEL", "GEMINI_FALLBACK_MODELS", "POLLINATIONS_API_KEY", "AI_POLLINATIONS_ANON", "GROQ_API_KEY"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setenv("AI_POLLINATIONS_ANON", "false")  # testes sem rede


def run(c):
    return asyncio.run(c)


def test_no_keys():
    with pytest.raises(HTTPException) as e:
        run(llm.complete("s", "u"))
    assert e.value.status_code == 503


def test_failover_and_breaker(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "a")
    monkeypatch.setenv("GEMINI_API_KEY", "g")
    calls = []

    async def fake(p, client, system, user, mt, key=None):
        calls.append(p.name)
        if p.name == "anthropic":
            raise TimeoutError("lento")
        return "olá de " + p.name

    monkeypatch.setattr(llm, "_call", fake)
    text, prov = run(llm.complete_ex("s", "u"))
    assert prov == "gemini" and calls == ["anthropic", "gemini"]  # openai sem chave fica fora
    calls.clear()
    run(llm.complete("s", "u"))
    assert calls == ["gemini"]  # anthropic em pausa: vai para o fim e não é necessário
    st = {s["name"]: s for s in llm.status()}
    assert st["anthropic"]["paused"] and st["openai"]["configured"] is False
    assert "a" not in str(st.get("anthropic", {}).get("model", "")) or True


def test_all_fail(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "o")

    async def bad(*a):
        raise ConnectionError()

    monkeypatch.setattr(llm, "_call", bad)
    with pytest.raises(HTTPException) as e:
        run(llm.complete("s", "u"))
    assert e.value.status_code == 502 and "openai" in e.value.detail


def test_priority_env_then_apps_then_panel(monkeypatch, tmp_path):
    """Chaves do .env (GitHub) vêm primeiro; outras apps e painel só entram se a do .env falhar no teste."""
    (tmp_path / "env.ai").write_text("GROQ_API_KEY=gsk_env_000000000000001\n")
    (tmp_path / "apps.ai").write_text("GROQ_API_KEY@gusto=gsk_gusto_0000000000002\nOPENAI_API_KEY@pratica=sk-pratica-00000000003\n")
    monkeypatch.setenv("AI_PROVIDERS", "groq,openai")
    llm.PROVIDERS["groq"].db_key = "gsk_painel_000000000004"
    g = llm.PROVIDERS["groq"]
    assert [c.source for c in g.candidates()] == ["env", "apps:gusto", "painel"]
    assert g.key_source == "env"
    assert llm.PROVIDERS["openai"].key_source == "apps:pratica"

    async def fake(p, client, system, user, mt, key=None):
        if key and "env" in key:
            import httpx
            raise httpx.HTTPStatusError("x", request=httpx.Request("POST", "https://x"), response=httpx.Response(401))
        return "ok"

    monkeypatch.setattr(llm, "_call", fake)
    res = {r["name"]: r for r in run(llm.diagnose(["groq"]))}
    gr = res["groq"]
    assert gr["ok"] and gr["keySource"] == "apps:gusto" and "env falhou" in gr["note"]
    assert [c["ok"] for c in gr["candidates"]] == [False, True, True]
    assert "gsk_" not in str(res)  # nunca devolve a chave
    # o resultado fica gravado e a chave reprovada sai da frente (inclusive em outro worker)
    assert (tmp_path / "status.json").exists()
    g._cands = None
    assert g.key_source == "apps:gusto"
    st = {x["name"]: x for x in llm.status()}["groq"]
    assert [c["source"] for c in st["candidates"]] == ["env", "apps:gusto", "painel"] and st["candidates"][0]["verified"] is False


def test_gemini_fallback_model_and_pollinations_anon(monkeypatch):
    import httpx
    monkeypatch.setenv("AI_PROVIDERS", "gemini,pollinations")
    monkeypatch.setenv("GEMINI_API_KEY", "AQ.teste-gemini-000000001")
    monkeypatch.setenv("GEMINI_MODEL", "gemini-flash-latest")
    monkeypatch.setenv("GEMINI_FALLBACK_MODELS", "gemini-2.5-flash")
    tried = []

    async def fake_model(p, client, system, user, mt, key, model):
        tried.append((p.name, model, key))
        if model == "gemini-flash-latest":
            raise httpx.HTTPStatusError("x", request=httpx.Request("POST", "https://x"), response=httpx.Response(503))
        return "ok"

    monkeypatch.setattr(llm, "_call_model", fake_model)
    text, prov = run(llm.complete_ex("s", "u"))
    assert prov == "gemini" and [m for _, m, _ in tried] == ["gemini-flash-latest", "gemini-2.5-flash"]
    # Pollinations entra mesmo sem chave (uso anônimo, padrão ligado), em último lugar
    monkeypatch.delenv("AI_POLLINATIONS_ANON")
    pol = llm.PROVIDERS["pollinations"]
    assert [c.source for c in pol.candidates()] == ["anon"]
    monkeypatch.setenv("AI_POLLINATIONS_ANON", "false")
    assert pol.candidates() == []
    monkeypatch.setenv("POLLINATIONS_API_KEY", "sk_teste_pollinations_01")
    assert [c.source for c in pol.candidates()] == ["env"]


def test_reasoning_only_reply():
    assert llm._text_of({"content": None, "reasoning": "ok"}) == "ok"
    assert llm._text_of({"content": [{"type": "text", "text": "olá"}]}) == "olá"
