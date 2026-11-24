import asyncio
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "ai-worker"))
from app.core import llm
from app.routers import ai


def test_offline_answer_chords_and_guide():
    a = ai.offline_answer("Quais as notas de F#m7(b5) e como harmonizar?", None)
    assert "F#m7(b5) = F#, A, C, E." in a and "Harmonizar" in a and "offline" in a
    a2 = ai.offline_answer("G7/B ?", None)
    assert "G, B, D, F" in a2 and "baixo em B" in a2


def test_order_appends_new_providers(monkeypatch):
    monkeypatch.setenv("AI_PROVIDERS", "anthropic,openai,gemini,openrouter")
    o = llm.order()
    assert o[:4] == ["anthropic", "openai", "gemini", "openrouter"] and "groq" in o and "github" in o


def test_aliases(monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.setenv("GOOGLE_API_KEY", '"abc"')
    assert llm.PROVIDERS["gemini"].key == "abc"


def test_free_translate_batches(monkeypatch):
    sent = []

    class R:
        def __init__(self, q): self.q = q
        def json(self): return {"responseData": {"translatedText": self.q.upper()}}

    class C:
        async def __aenter__(self): return self
        async def __aexit__(self, *a): pass
        async def get(self, url, params): sent.append(params); return R(params["q"])

    monkeypatch.setattr(llm.httpx, "AsyncClient", lambda **k: C())
    out = asyncio.run(llm.free_translate(["Tocar", "Parar", "Camadas"], "en"))
    assert out == {"Tocar": "TOCAR", "Parar": "PARAR", "Camadas": "CAMADAS"} and len(sent) == 1
    assert sent[0]["langpair"] == "pt-BR|en-GB"
