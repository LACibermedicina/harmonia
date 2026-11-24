"""Tempo, quantização e alinhamento de letra (sílabas) às notas da melodia."""
from __future__ import annotations

import re
import statistics
import unicodedata


def estimate_tempo(onsets_sec: list[float], lo: float = 60, hi: float = 180) -> float:
    """Estimativa simples por histograma de IOIs (o worker usa librosa.beat quando disponível)."""
    if len(onsets_sec) < 3:
        return 100.0
    iois = [b - a for a, b in zip(onsets_sec, onsets_sec[1:]) if 0.08 < b - a < 2.0]
    if not iois:
        return 100.0
    best, best_score = 100.0, -1.0
    bpm = lo
    while bpm <= hi:
        beat = 60.0 / bpm
        score = 0.0
        for d in iois:
            r = d / (beat / 4)  # grade de semicolcheias
            score += 1.0 - min(1.0, abs(r - round(r)) * 2)
        score /= len(iois)
        score -= 0.0015 * abs(bpm - 105)  # leve viés para andamentos comuns
        if score > best_score:
            best, best_score = bpm, score
        bpm += 1
    return float(best)


def seconds_to_beats(events: list[dict], bpm: float, grid: float = 0.25, offset: float = 0.0) -> list[dict]:
    """events: {pitch, start_s, end_s, vel?} → notas quantizadas em tempos."""
    spb = 60.0 / bpm
    out = []
    for e in events:
        s = round(((e["start_s"] - offset) / spb) / grid) * grid
        d = max(grid, round(((e["end_s"] - e["start_s"]) / spb) / grid) * grid)
        if s < 0:
            continue
        out.append({"pitch": int(e["pitch"]), "start": s, "dur": d, "vel": int(e.get("vel", 80)),
                    **({"effect": e["effect"]} if e.get("effect") else {})})
    return out


# ------------------------------------------------------------- silabação PT
_V = "aeiouáéíóúâêôãõàü"


def syllabify_pt(word: str) -> list[str]:
    """Silabação aproximada para português (suficiente para distribuir letra nas notas)."""
    w = word
    if len(w) <= 2:
        return [w]
    low = w.lower()
    sylls, cur, i = [], "", 0
    while i < len(w):
        cur += w[i]
        if low[i] in _V:
            # ditongos decrescentes ficam juntos (ai, ei, oi, ou, ão, õe)
            if i + 1 < len(w) and low[i + 1] in "iuoe" and low[i] in "aeoãõ" and \
                    not (i + 2 < len(w) and low[i + 2] in _V):
                if low[i:i + 2] in ("ai", "ei", "oi", "ou", "au", "eu", "ão", "õe", "ãe", "ui"):
                    cur += w[i + 1]; i += 1
            rest = low[i + 1:]
            cons = re.match(rf"[^{_V}]*", rest).group(0)
            if not rest:
                pass
            elif len(cons) == 0:
                sylls.append(cur); cur = ""
            elif len(cons) == 1:
                sylls.append(cur); cur = ""
            elif cons[:2] in ("ch", "lh", "nh", "qu", "gu") or (len(cons) >= 2 and cons[1] in "lr" and cons[0] in "bcdfgkptv"):
                if len(rest) > len(cons):
                    sylls.append(cur); cur = ""
            else:
                if len(rest) > len(cons):
                    cur += w[i + 1]; i += 1
                    if len(cons) == 3:
                        cur += w[i + 1]; i += 1
                    sylls.append(cur); cur = ""
        i += 1
    if cur:
        if sylls and not any(ch.lower() in _V for ch in cur):
            sylls[-1] += cur
        else:
            sylls.append(cur)
    return sylls


def tokenize_lyrics(text: str) -> list[str]:
    """Texto → sílabas com hífen de continuação ('a-', 'mor')."""
    out = []
    for word in re.findall(r"[\wÀ-ÿ']+", unicodedata.normalize("NFC", text)):
        parts = syllabify_pt(word)
        for k, p in enumerate(parts):
            out.append(p + ("-" if k < len(parts) - 1 else ""))
    return out


def align_lyrics(melody: list[dict], syllables: list[str],
                 timed_words: list[dict] | None = None, bpm: float | None = None) -> list[dict]:
    """Associa sílabas às notas. Respeita pausas (notas não recebem sílaba após silêncio
    se não houver palavra cantada no intervalo, quando houver tempos do ASR) e melismas
    (notas extras viram '_' — prolongamento da sílaba anterior)."""
    notes = sorted(melody, key=lambda n: n["start"])
    for n in notes:
        n.pop("lyric", None)
    if not notes or not syllables:
        return notes
    if timed_words and bpm:
        # Atribuição guiada pelo tempo: cada palavra vai para notas dentro de sua janela
        spb = 60.0 / bpm
        idx = 0
        for w in timed_words:
            a, b = w["start"] / spb, w["end"] / spb
            parts = syllabify_pt(w["word"].strip(" ,.!?"))
            win = [n for n in notes if a - 0.25 <= n["start"] < b + 0.1 and "lyric" not in n]
            for k, n in enumerate(win):
                if k < len(parts):
                    n["lyric"] = parts[k] + ("-" if k < len(parts) - 1 else "")
                else:
                    n["lyric"] = "_"
            idx += 1
        return notes
    # Sem tempos: distribuição sequencial; notas excedentes em frase viram melisma
    phrases: list[list[dict]] = [[]]
    for i, n in enumerate(notes):
        if i and n["start"] - (notes[i - 1]["start"] + notes[i - 1]["dur"]) >= 1.0:
            phrases.append([])
        phrases[-1].append(n)
    si = 0
    for ph in phrases:
        for n in ph:
            if si < len(syllables):
                n["lyric"] = syllables[si]; si += 1
    return notes


def check_lyrics(expected: str, recognized_words: list[str]) -> dict:
    """Compara a letra informada com a reconhecida (ASR). Retorna diffs palavra a palavra."""
    import difflib
    norm = lambda s: re.sub(r"[^\wÀ-ÿ]", "", s.lower())
    exp = [w for w in expected.split() if norm(w)]
    rec = [w for w in recognized_words if norm(w)]
    sm = difflib.SequenceMatcher(a=[norm(w) for w in exp], b=[norm(w) for w in rec])
    diffs = []
    for op, a0, a1, b0, b1 in sm.get_opcodes():
        if op != "equal":
            diffs.append({"op": op, "expected": " ".join(exp[a0:a1]), "heard": " ".join(rec[b0:b1]),
                          "word_index": a0})
    return {"similarity": round(sm.ratio(), 3), "diffs": diffs}


def median_pitch(notes: list[dict]) -> float:
    return statistics.median(n["pitch"] for n in notes) if notes else 60
