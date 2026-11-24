"""Cifra (texto) → acordes por compasso + letra.

Aceita dois estilos:
1. Barras:      | C  Am | F G7 | C |
2. Cifra popular (acordes acima da letra):
       C          Am
   Eu sei que vou te amar
Cada linha de acordes sem barras = 1 compasso por acorde (ou `chords_per_measure`).
"""
from __future__ import annotations

import re

from ..theory import parse_chord, chord_symbol

_SECTION = re.compile(r"^\s*\[?(intro|verso|refr[aã]o|ponte|solo|final|coda|chorus|verse|bridge)[^\]]*\]?\s*:?\s*$", re.I)


def _is_chord_line(line: str) -> bool:
    toks = [t for t in re.split(r"[\s|]+", line.strip()) if t]
    if not toks:
        return False
    ok = sum(1 for t in toks if parse_chord(t) or t in {"%", "-", "/", "N.C."})
    return ok / len(toks) >= 0.75


def parse_cifra(text: str, beats_per_measure: int = 4, chords_per_measure: int = 1) -> dict:
    measures: list[list[dict]] = []
    lyrics: list[dict] = []  # {"measure": i, "text": str}
    sections: list[dict] = []
    lines = text.replace("\r", "").split("\n")
    i = 0
    while i < len(lines):
        line = lines[i]
        if not line.strip():
            i += 1
            continue
        if _SECTION.match(line):
            sections.append({"name": line.strip(" []:"), "measure": len(measures)})
            i += 1
            continue
        if _is_chord_line(line):
            start_measure = len(measures)
            if "|" in line:
                for cell in [c for c in line.split("|")]:
                    toks = cell.split()
                    if not toks:
                        continue
                    measures.append(_cell_to_chords(toks, beats_per_measure, measures))
            else:
                toks = line.split()
                for k in range(0, len(toks), chords_per_measure):
                    measures.append(_cell_to_chords(toks[k:k + chords_per_measure], beats_per_measure, measures))
            # linha seguinte é letra?
            if i + 1 < len(lines) and lines[i + 1].strip() and not _is_chord_line(lines[i + 1]) \
                    and not _SECTION.match(lines[i + 1]):
                lyrics.append({"measure": start_measure, "measures": len(measures) - start_measure,
                               "text": lines[i + 1].strip()})
                i += 1
        else:
            lyrics.append({"measure": len(measures), "measures": 0, "text": line.strip()})
        i += 1
    return {"measures": measures, "lyrics": lyrics, "sections": sections}


def _cell_to_chords(toks: list[str], bpm: int, prev: list[list[dict]]) -> list[dict]:
    if toks == ["%"] and prev:
        return [dict(c) for c in prev[-1]]
    chords = [parse_chord(t) for t in toks if t not in {"-", "/"}]
    chords = [c for c in chords if c]
    if not chords:
        return []
    step = bpm / len(chords)
    return [{"beat": round(k * step, 3), "dur": step, "symbol": chord_symbol(c), **c.to_dict()}
            for k, c in enumerate(chords)]
