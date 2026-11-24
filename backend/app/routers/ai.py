"""IA contextual: tradução de tudo o que está na tela (com cache) e assistente/avatar musical.

Camadas de resposta (sempre responde):
  1. cadeia de provedores de IA com failover (core/llm.py — pagos e gratuitos);
  2. se todos falharem: tradução gratuita MyMemory / Maestro offline (teoria musical local + guia do editor).
LGPD: nenhum dado pessoal (nome, e-mail) é enviado a provedores — apenas textos de UI e um
resumo musical da composição aberta, quando o próprio usuário pergunta."""
import hashlib
import json
import logging
import re

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ..core import llm
from ..core.security import current_user, optional_user
from .media import rds

router = APIRouter(prefix="/api/ai", tags=["ai"])
log = logging.getLogger("harmonia.ai")
LANGS = {"zh": "Mandarim (chinês simplificado)", "es": "Espanhol", "en": "Inglês", "hi": "Hindi", "pt": "Português do Brasil"}


def _cache_get(k: str):
    try:
        return rds().get(k)
    except Exception:  # noqa: BLE001 — Redis fora não pode derrubar a tradução
        return None


def _cache_set(k: str, v: str, ttl: int):
    try:
        rds().setex(k, ttl, v)
    except Exception:  # noqa: BLE001
        pass


class TranslateIn(BaseModel):
    target: str = Field(pattern="^(zh|es|en|hi|pt)$")
    texts: list[str] = Field(max_length=400)
    context: str = "Interface de app de composição musical e partitura para piano"


@router.post("/translate")
async def translate(body: TranslateIn, _=Depends(optional_user)):
    """Traduz em lote preservando termos musicais (cifras, nomes de notas, dinâmicas) e placeholders."""
    out: dict[str, str] = {}
    missing = []
    key = lambda t: "harmonia:tr:" + body.target + ":" + hashlib.sha1(t.encode()).hexdigest()  # noqa: E731
    for t in dict.fromkeys(body.texts):
        cached = _cache_get(key(t))
        if cached is not None:
            out[t] = cached
        else:
            missing.append(t)
    engine = "cache"
    if missing:
        translated: dict[str, str] = {}
        try:
            system = ("Você é um tradutor técnico-musical. Traduza cada string para " + LANGS[body.target] +
                      ". Preserve exatamente: cifras (C7M, Am7(b5)), nomes de notas, termos italianos de dinâmica "
                      "(p, mf, crescendo), números, {placeholders}, emojis e quebras de linha. Mantenha comprimento "
                      "próximo ao original para não quebrar o layout. Responda SOMENTE com um array JSON de strings, "
                      "na mesma ordem.")
            txt, engine = await llm.complete_ex(system, f"Contexto: {body.context}\n\n" + json.dumps(missing, ensure_ascii=False), 4000)
            arr = json.loads(txt[txt.index("["): txt.rindex("]") + 1])
            translated = {s: d for s, d in zip(missing, arr) if isinstance(d, str) and d}
        except (HTTPException, ValueError, json.JSONDecodeError) as e:
            log.warning("tradução por IA indisponível (%s) — usando tradutor gratuito", getattr(e, "detail", e))
        rest = [t for t in missing if t not in translated]
        if rest:
            free = await llm.free_translate(rest, body.target)
            if free:
                engine = "mymemory" if not translated else engine + "+mymemory"
            translated |= free
        for src, dst in translated.items():
            out[src] = dst
            _cache_set(key(src), dst, 60 * 60 * 24 * 30)
    return {"target": body.target, "translations": out, "engine": engine}


class AskIn(BaseModel):
    question: str = Field(max_length=2000)
    lang: str = "pt"
    score_summary: dict | None = None  # título, tom, compassos, acordes, camadas (sem dados pessoais)


# ------------------------------------------------------------- Maestro offline
_GUIDE = [
    (r"harmoniz", "Para harmonizar: clique na faixa numerada para selecionar compassos (Shift = intervalo) e use ✨ Harmonizar seleção. "
                  "Os demais compassos servem de contexto. Escolha o estilo (bloco, arpejo, Alberti) e ajuste as vozes arrastando as notas."),
    (r"cifra|acorde", "Escreva acordes clicando acima do compasso (ferramenta C7) ou no painel Propriedades. Aceito: C, Am7, G7/B, F#m7(b5), Bb7M, A7(9), Dsus4, C°. "
                      "Para gerar o acompanhamento a partir de um texto de cifra, use Importar → 🎸 Cifra."),
    (r"camada|layer", "Camadas: cada uma tem cor e textura próprias. No painel Camadas você oculta, silencia, faz solo, bloqueia e reordena. "
                      "Selecione notas ou compassos e use ⧉ Copiar / ✂ Recortar p/ nova camada (⌘⇧C / ⌘⇧X)."),
    (r"grav|microfone", "Para gravar um trecho: selecione os compassos (ou deixe vazio para gravar os que faltam) e clique ● Gravar trecho. "
                        "Há contagem de um compasso e metrônomo. Depois use 'Transcrever gravação' no menu da camada."),
    (r"export|pdf|midi|mp3|wav", "Na Mesa de Edição marque os formatos (.mid, .musicxml, .pdf, .wav, .mp3) e clique ⇩ Exportar. Camadas em Solo têm prioridade; mudas ficam fora do áudio."),
    (r"transcr|áudio|audio|foto|imagem", "Importar → Áudio: recorte o trecho, ajuste o ganho e escolha melodia, harmonia ou ambos; o resultado chega como camadas novas na Composição. "
                                       "A foto de partitura (OMR) exige a IA completa no servidor."),
    (r"letra|sílaba|silaba", "Use a ferramenta ♪a Letra e clique numa nota para escrever a sílaba (Tab avança, '_' prolonga). Ou cole a letra inteira em Camadas → Letra → notas."),
    (r"compasso.*(inser|adicion)|inserir|\+", "Para inserir compassos use o + discreto sobre cada barra (Alt+clique insere 4). Para excluir, selecione e use Excluir no painel Propriedades."),
    (r"tonalidade|armadura|tom\b", "A tonalidade fica no cabeçalho da partitura e no painel Propriedades. O seletor mostra o tom maior e o relativo menor (ex.: C maior / Am)."),
]


def offline_answer(question: str, summary: dict | None) -> str:
    q = question.lower()
    parts: list[str] = []
    # teoria: explica acordes citados na pergunta
    try:
        from harmonia_ai.theory import NOTE_NAMES_FLAT, NOTE_NAMES_SHARP, parse_chord  # núcleo musical local
        seen = set()
        for tok in re.findall(r"(?<![\w/])[A-G][#b]?[^\s,;?!]*", question):
            tok = tok.rstrip(".")
            c = parse_chord(tok)
            if c and tok not in seen:
                seen.add(tok)
                names = NOTE_NAMES_FLAT if "b" in tok[1:2] else NOTE_NAMES_SHARP
                notes = [names[(c.root + iv) % 12] for iv in c.intervals()]
                bass = f" — baixo em {names[c.bass]}" if c.bass is not None and c.bass != c.root else ""
                parts.append(f"{tok} = {', '.join(dict.fromkeys(notes))}{bass}.")
    except Exception:  # noqa: BLE001
        pass
    for pat, txt in _GUIDE:
        if re.search(pat, q):
            parts.append(txt)
            if len(parts) >= 3:
                break
    if summary and not parts:
        chords = [c for c in (summary.get("chords") or []) if c]
        parts.append(f"Sua composição '{summary.get('title', '')}' tem {summary.get('measures', '?')} compassos"
                     + (f" e acordes como {', '.join(chords[:4])}" if chords else "") + ". Selecione compassos e use ✨ Harmonizar para sugerir acordes.")
    if not parts:
        parts.append("Posso ajudar com harmonização, cifras, camadas, gravação, letra e exportação. Pergunte, por exemplo: 'como harmonizar o refrão?' ou 'quais as notas de F#m7(b5)?'.")
    return " ".join(parts) + " (Maestro offline — a IA generativa está temporariamente indisponível.)"


@router.post("/assistant")
async def assistant(body: AskIn, _user=Depends(current_user)):
    system = ("Você é o Maestro, assistente didático do harmonIA. Explique teoria musical, harmonia, leitura "
              "de partitura e o uso do editor (camadas, drag & drop, harmonização, gravação, exportação) de forma "
              "curta, encorajadora e precisa. Quando sugerir acordes use cifra brasileira. Responda em " +
              LANGS.get(body.lang, "Português do Brasil") + ". Nunca peça dados pessoais.")
    ctx = json.dumps(body.score_summary, ensure_ascii=False)[:6000] if body.score_summary else "nenhuma"
    try:
        answer, provider = await llm.complete_ex(system, f"Composição aberta: {ctx}\n\nPergunta: {body.question}", 900)
    except HTTPException as e:
        log.warning("Maestro em modo offline: %s", e.detail)
        answer, provider = offline_answer(body.question, body.score_summary), "offline"
    return {"answer": answer, "provider": provider}


# ------------------------------------------------------------------ leitura de partitura por IA com visão
# Usada quando o OMR completo (oemer) não está instalado no servidor (modo leve) ou falhou.
OMR_SYSTEM = (
    "Você é um transcritor de partituras (OMR) preciso. Leia a imagem e devolva SOMENTE um JSON válido, sem texto "
    "antes ou depois, no formato:\n"
    '{"title":"","tempo":96,"timeSig":[4,4],"keyFifths":0,'
    '"staves":[{"clef":"G","measures":[[{"p":"A4","d":1,"lyric":"la"},{"p":"r","d":0.5},{"p":["C4","E4"],"d":2,"tie":false}]]}],'
    '"chords":[["Dm","C"]]}\n'
    "Regras: p = nota com oitava científica (C4 = dó central), sustenido # e bemol b, 'r' = pausa, lista = acorde "
    "(notas simultâneas). d = duração em semínimas (1 semínima, 0,5 colcheia, 0,25 semicolcheia, 2 mínima, 4 semibreve; "
    "pontuada = ×1,5, ex. 1.5; tercinas = 0.333). tie=true quando a nota se liga à seguinte. Aplique a armadura e os "
    "acidentes da partitura nas alturas (escreva a altura real). Um item em staves por pauta (clave G ou F; em piano, "
    "duas pautas). chords = cifras escritas acima de cada compasso (vazio se não houver). Inclua TODOS os compassos "
    "de todas as linhas, na ordem. keyFifths: sustenidos positivos, bemóis negativos.")


class OmrIn(BaseModel):
    image_b64: str = Field(min_length=100, max_length=14_000_000)
    mime: str = "image/jpeg"
    melodyOnly: bool = False


_NOTE = re.compile(r"^\s*([A-Ga-g])\s*([#♯b♭]{0,2})\s*(-?\d)\s*$")


def _pitch(s: str) -> int | None:
    m = _NOTE.match(str(s))
    if not m:
        return None
    pc = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}[m.group(1).upper()]
    acc = sum(1 if ch in "#♯" else -1 for ch in m.group(2))
    return (int(m.group(3)) + 1) * 12 + pc + acc


def _json_of(text: str) -> dict:
    t = text.strip()
    t = re.sub(r"^```(?:json)?|```$", "", t, flags=re.M).strip()
    a, b = t.find("{"), t.rfind("}")
    if a < 0 or b < 0:
        raise ValueError("a IA não devolveu JSON")
    return json.loads(t[a:b + 1])


def omr_to_score(d: dict, melody_only: bool = False) -> dict:
    """JSON da IA → camadas de notas (uma por pauta), compassos ajustados à fórmula de compasso."""
    num, den = (d.get("timeSig") or [4, 4])[:2]
    bpm = num * 4 / den
    layers, n_meas = [], 0
    staves = d.get("staves") or []
    for si, st in enumerate(staves):
        if melody_only and si > 0:
            break
        clef = str(st.get("clef", "G")).upper()
        notes, tie_open = [], {}
        for mi, meas in enumerate(st.get("measures") or []):
            items = [x for x in (meas or []) if isinstance(x, dict)]
            total = sum(max(0.0, float(x.get("d") or 0)) for x in items) or bpm
            scale = bpm / total if total > bpm + 1e-6 else 1.0  # compasso lotado: comprime para caber
            t = mi * bpm
            for x in items:
                dur = max(0.0, float(x.get("d") or 0)) * scale
                ps = x.get("p")
                ps = ps if isinstance(ps, list) else [ps]
                for k, ptxt in enumerate(ps):
                    if str(ptxt).lower() in ("r", "rest", "pausa"):
                        continue
                    p = _pitch(ptxt)
                    if p is None:
                        continue
                    prev = tie_open.pop(p, None)
                    if prev is not None and abs(prev["start"] + prev["dur"] - t) < 1e-3:
                        prev["dur"] = round(prev["dur"] + dur, 4)  # ligadura: estende a nota anterior
                        n = prev
                    else:
                        n = {"pitch": p, "start": round(t, 4), "dur": round(max(0.125, dur), 4), "vel": 80}
                        if k == 0 and x.get("lyric"):
                            n["lyric"] = str(x["lyric"])[:20]
                        notes.append(n)
                    if x.get("tie"):
                        tie_open[p] = n
                t += dur
            n_meas = max(n_meas, mi + 1)
        if notes:
            bass = clef.startswith("F") or (sorted(n["pitch"] for n in notes)[len(notes) // 2] < 55)
            layers.append({"name": "Partitura (IA) — " + ("Fá" if bass else "Sol") + (f" {si + 1}" if len(staves) > 2 else ""),
                           "kind": "omr", "staff": "bass" if bass else "treble", "notes": notes})
    chords = [[str(c) for c in (cell or []) if c] for cell in (d.get("chords") or [])]
    return {"title": str(d.get("title") or "")[:120], "tempo": int(d.get("tempo") or 96), "timeSig": [int(num), int(den)],
            "keySig": max(-7, min(7, int(d.get("keyFifths") or 0))), "measures": max(1, n_meas), "layers": layers,
            "chordSymbols": chords}


@router.post("/omr")
async def omr(body: OmrIn, _user=Depends(current_user)):
    user = ("Transcreva esta partitura." + (" Só a pauta superior (melodia)." if body.melodyOnly else "") +
            " Responda apenas com o JSON.")
    text, provider = await llm.complete_vision(OMR_SYSTEM, user, body.image_b64, body.mime)
    try:
        d = _json_of(text)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"A IA ({provider}) respondeu num formato inesperado — tente recortar só as pautas") from e
    out = omr_to_score(d, body.melodyOnly)
    if not any(l["notes"] for l in out["layers"]):
        raise HTTPException(422, "Não encontrei notas na imagem — recorte a área das pautas e tente de novo")
    out["engine"] = "vision:" + provider
    out["notice"] = f"Lida por IA com visão ({provider}). Confira as notas na revisão antes de juntar."
    return out
