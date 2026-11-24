"""Harmonia: extração da melodia a partir da harmonia, reconhecimento de acordes
e harmonização automática (Viterbi funcional) com voicing para piano.

Todas as posições estão em tempos (beats). Compasso m ocupa [m*bpm, (m+1)*bpm).
"""
from __future__ import annotations

import math
import uuid

from ..theory import Chord, QUALITIES, chord_symbol, detect_key


def _nid() -> str:
    return uuid.uuid4().hex[:10]


# ------------------------------------------------------------------ melodia
def extract_melody(notes: list[dict], min_pitch: int = 55) -> list[dict]:
    """Skyline: em cada instante mantém a nota mais aguda (voz principal).
    Notas sobrepostas e mais graves são descartadas; a melodia resultante é monofônica."""
    evs = sorted((n for n in notes if n["pitch"] >= min_pitch), key=lambda n: (n["start"], -n["pitch"]))
    out: list[dict] = []
    for n in evs:
        if out and n["start"] < out[-1]["start"] + out[-1]["dur"] - 1e-6:
            last = out[-1]
            if n["pitch"] > last["pitch"]:
                # nova nota mais aguda corta a anterior
                last["dur"] = max(0.0, n["start"] - last["start"])
                if last["dur"] < 1e-6:
                    out.pop()
                out.append({**n, "id": _nid()})
            continue
        out.append({**n, "id": _nid()})
    return [n for n in out if n["dur"] > 1e-6]


def split_hands(notes: list[dict], split: int = 60) -> tuple[list[dict], list[dict]]:
    return [n for n in notes if n["pitch"] >= split], [n for n in notes if n["pitch"] < split]


# ---------------------------------------------------------- reconhecimento
_RECOG_QUALITIES = ["", "m", "7", "maj7", "m7", "dim", "sus4", "m7b5"]


def _template(root: int, q: str) -> list[float]:
    t = [0.0] * 12
    for i, iv in enumerate(QUALITIES[q]):
        t[(root + iv) % 12] = 1.0 if i < 3 else 0.6
    t[root] = 1.4
    return t


def recognize_chord(notes: list[dict], window: tuple[float, float]) -> Chord | None:
    a, b = window
    h = [0.0] * 12
    bass_w: dict[int, float] = {}
    lowest = None
    for n in notes:
        s, e = max(a, n["start"]), min(b, n["start"] + n["dur"])
        if e <= s:
            continue
        w = (e - s) * (1.5 if abs(n["start"] - a) < 1e-3 else 1.0)
        h[n["pitch"] % 12] += w
        if lowest is None or n["pitch"] < lowest["pitch"]:
            lowest = n
        bass_w[n["pitch"] % 12] = bass_w.get(n["pitch"] % 12, 0) + w
    if not any(h):
        return None
    tot = math.sqrt(sum(x * x for x in h))
    best, best_s = None, -1.0
    for r in range(12):
        for q in _RECOG_QUALITIES:
            t = _template(r, q)
            s = sum(x * y for x, y in zip(h, t)) / (tot * math.sqrt(sum(y * y for y in t)))
            s -= 0.04 * (len(QUALITIES[q]) - 3)  # parcimônia: prefere tríades
            if lowest and lowest["pitch"] % 12 == r:
                s += 0.05
            if s > best_s:
                best, best_s = Chord(r, q), s
    if best and lowest and lowest["pitch"] % 12 != best.root and lowest["pitch"] % 12 in best.pcs:
        best.bass = lowest["pitch"] % 12
    if best:
        best.symbol = chord_symbol(best)
    return best


def transcribe_harmony(notes: list[dict], n_measures: int, bpm: int = 4, per_measure: int = 1) -> list[list[dict]]:
    out = []
    step = bpm / per_measure
    for m in range(n_measures):
        cell = []
        prev = None
        for k in range(per_measure):
            a = m * bpm + k * step
            c = recognize_chord(notes, (a, a + step))
            if c and (prev is None or c.symbol != prev):
                cell.append({"beat": k * step, "dur": step, **c.to_dict()})
                prev = c.symbol
            elif cell:
                cell[-1]["dur"] += step
        out.append(cell)
    return out


# ------------------------------------------------------------ harmonização
# Graus diatônicos (offset da tônica, qualidade, função T/S/D)
_MAJOR_DEGREES = [(0, "", "T"), (2, "m", "S"), (4, "m", "T"), (5, "", "S"),
                  (7, "", "D"), (9, "m", "T"), (11, "dim", "D"), (7, "7", "D")]
_MINOR_DEGREES = [(0, "m", "T"), (2, "dim", "S"), (3, "", "T"), (5, "m", "S"),
                  (7, "", "D"), (8, "", "S"), (10, "", "D"), (7, "7", "D")]
_TRANSITION = {  # preferência funcional (log-prob aproximada)
    ("T", "S"): 0.0, ("T", "D"): -0.3, ("T", "T"): -0.6,
    ("S", "D"): 0.0, ("S", "T"): -0.5, ("S", "S"): -0.7,
    ("D", "T"): 0.0, ("D", "D"): -0.6, ("D", "S"): -1.4,
}


def harmonize(melody: list[dict], n_measures: int, bpm: int = 4, measures: list[int] | None = None,
              key: tuple[int, str] | None = None, per_measure: int = 1,
              existing: list[list[dict]] | None = None) -> list[list[dict]]:
    """Gera acordes para os compassos pedidos (None = todos), respeitando acordes já existentes
    nos demais compassos como contexto. Retorna lista por compasso (vazia onde não alterado)."""
    tonic, mode = key or detect_key(melody)
    degrees = _MAJOR_DEGREES if mode == "major" else _MINOR_DEGREES
    cands = [(Chord((tonic + off) % 12, q), fn) for off, q, fn in degrees]
    targets = set(range(n_measures)) if measures is None else set(measures)
    step = bpm / per_measure
    slots = [(m, k) for m in range(n_measures) for k in range(per_measure)]

    def emission(m: int, k: int, c: Chord) -> float:
        a = m * bpm + k * step
        b = a + step
        s, tot = 0.0, 0.0
        for n in melody:
            ov = min(b, n["start"] + n["dur"]) - max(a, n["start"])
            if ov <= 0:
                continue
            w = ov * (1.6 if abs(n["start"] - a) < 1e-3 else 1.0)
            tot += w
            if n["pitch"] % 12 in c.pcs:
                s += w
            elif (n["pitch"] - c.root) % 12 in (1, 6):  # 9b/11# como dissonância forte
                s -= 0.5 * w
        return math.log(0.05 + max(0.0, s / tot if tot else 0.5))

    fixed: dict[tuple[int, int], Chord] = {}
    if existing:
        for m, cell in enumerate(existing):
            if m in targets or not cell:
                continue
            for k in range(per_measure):
                beat = k * step
                act = [c for c in cell if c["beat"] <= beat + 1e-6]
                if act:
                    c = act[-1]
                    fixed[(m, k)] = Chord(c["root"], c["quality"], c.get("extensions", []), c.get("bass"))

    # Viterbi
    V: list[list[float]] = []
    back: list[list[int]] = []
    for t, (m, k) in enumerate(slots):
        row, brow = [], []
        for j, (c, fn) in enumerate(cands):
            if (m, k) in fixed:
                fc = fixed[(m, k)]
                e = 0.0 if (fc.root == c.root and fc.quality == c.quality) else -50.0
                if all(fc.root != cc.root or fc.quality != cc.quality for cc, _ in cands):
                    e = 0.0 if c.root == fc.root else -50.0  # acorde cromático fixo: casa pela fundamental
            else:
                e = emission(m, k, c)
            if t == 0:
                start_bonus = 0.6 if (c.root == tonic and fn == "T") else 0.0
                row.append(e + start_bonus); brow.append(-1)
                continue
            best_v, best_i = -1e9, 0
            for i, (pc, pfn) in enumerate(cands):
                tr = _TRANSITION[(pfn, fn)]
                if pc.root == c.root and pc.quality == c.quality and k > 0:
                    tr = 0.1  # sustentar dentro do compasso é natural
                v = V[t - 1][i] + tr
                if v > best_v:
                    best_v, best_i = v, i
            row.append(best_v + e); brow.append(best_i)
        V.append(row); back.append(brow)

    # cadência final na tônica
    last = len(slots) - 1
    for j, (c, fn) in enumerate(cands):
        if c.root == tonic and fn == "T":
            V[last][j] += 0.8
    j = max(range(len(cands)), key=lambda x: V[last][x])
    path = [0] * len(slots)
    for t in range(last, -1, -1):
        path[t] = j
        j = back[t][j] if back[t][j] >= 0 else j

    result: list[list[dict]] = [[] for _ in range(n_measures)]
    for t, (m, k) in enumerate(slots):
        if m not in targets:
            continue
        c = Chord(cands[path[t]][0].root, cands[path[t]][0].quality)
        c.symbol = chord_symbol(c)
        if result[m] and result[m][-1]["symbol"] == c.symbol:
            result[m][-1]["dur"] += step
        else:
            result[m].append({"beat": k * step, "dur": step, **c.to_dict()})
    return result


def voice_chords(chords: list[list[dict]], bpm: int = 4, style: str = "block",
                 low: int = 48, high: int = 64) -> list[dict]:
    """Voicing para mão esquerda do piano com condução de vozes mínima.
    style: block | arpeggio | alberti | bass-chord"""
    notes: list[dict] = []
    prev: list[int] | None = None
    for m, cell in enumerate(chords):
        for c in cell:
            ch = Chord(c["root"], c["quality"], c.get("extensions", []), c.get("bass"))
            ivs = ch.intervals()[:4]
            options = []
            for inv in range(len(ivs)):
                pcs = [(ch.root + i) % 12 for i in ivs[inv:] + ivs[:inv]]
                base = low + ((pcs[0] - low) % 12)
                v, cur = [], base
                for pc in pcs:
                    while cur % 12 != pc:
                        cur += 1
                    v.append(cur); cur += 1
                if v[-1] <= high + 4:
                    options.append(v)
            if not options:
                continue
            voicing = min(options, key=lambda v: sum(abs(a - b) for a, b in zip(v, prev)) if prev else abs(v[0] - 52))
            prev = voicing
            bass_pc = ch.bass if ch.bass is not None else ch.root
            bass = 36 + ((bass_pc - 36) % 12)
            start = m * bpm + c["beat"]
            dur = c["dur"]
            if style == "arpeggio":
                seq = [bass] + voicing
                stepd = dur / max(1, len(seq))
                for i, p in enumerate(seq):
                    notes.append({"id": _nid(), "pitch": p, "start": start + i * stepd, "dur": stepd, "vel": 70})
            elif style == "alberti" and len(voicing) >= 3:
                pat = [voicing[0], voicing[2], voicing[1], voicing[2]]
                n8 = int(dur * 2)
                for i in range(n8):
                    notes.append({"id": _nid(), "pitch": pat[i % 4], "start": start + i * 0.5, "dur": 0.5, "vel": 66})
            elif style == "bass-chord":
                notes.append({"id": _nid(), "pitch": bass, "start": start, "dur": min(1, dur), "vel": 78})
                for p in voicing:
                    notes.append({"id": _nid(), "pitch": p, "start": start + min(1, dur), "dur": max(0.5, dur - 1), "vel": 64})
            else:
                notes.append({"id": _nid(), "pitch": bass, "start": start, "dur": dur, "vel": 76})
                for p in voicing:
                    notes.append({"id": _nid(), "pitch": p, "start": start, "dur": dur, "vel": 66})
    return notes
