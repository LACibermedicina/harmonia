"""Teoria musical base: notas, cifras (padrão brasileiro + internacional), acordes e tonalidade.

Formato de nota usado em todo o sistema (contrato com o frontend):
    {"id": str, "pitch": int (MIDI), "start": float (tempos), "dur": float (tempos),
     "vel": int, "lyric": str|None, "effect": str|None}
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

NOTE_NAMES_SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
NOTE_NAMES_FLAT = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"]
_LETTER = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}
# Solfejo (Dó Ré Mi...) também é aceito na cifra
_SOLFEGE = {"DO": "C", "RE": "D", "MI": "E", "FA": "F", "SOL": "G", "LA": "A", "SI": "B"}


def pc_of(name: str) -> int:
    name = name.strip()
    base = _LETTER[name[0].upper()]
    for ch in name[1:]:
        if ch in "#♯":
            base += 1
        elif ch in "b♭":
            base -= 1
    return base % 12


def pitch_name(midi: int, flats: bool = False) -> str:
    names = NOTE_NAMES_FLAT if flats else NOTE_NAMES_SHARP
    return f"{names[midi % 12]}{midi // 12 - 1}"


# Intervalos (semitons a partir da fundamental) por qualidade
QUALITIES: dict[str, tuple[int, ...]] = {
    "": (0, 4, 7),
    "m": (0, 3, 7),
    "dim": (0, 3, 6),
    "aug": (0, 4, 8),
    "sus2": (0, 2, 7),
    "sus4": (0, 5, 7),
    "5": (0, 7),
    "6": (0, 4, 7, 9),
    "m6": (0, 3, 7, 9),
    "7": (0, 4, 7, 10),
    "maj7": (0, 4, 7, 11),
    "m7": (0, 3, 7, 10),
    "mmaj7": (0, 3, 7, 11),
    "m7b5": (0, 3, 6, 10),
    "dim7": (0, 3, 6, 9),
    "7sus4": (0, 5, 7, 10),
}
_EXT = {"b9": 13, "9": 14, "#9": 15, "11": 17, "#11": 18, "b13": 20, "13": 21}


@dataclass
class Chord:
    root: int
    quality: str = ""
    extensions: list[str] = field(default_factory=list)
    bass: int | None = None
    symbol: str = ""

    @property
    def pcs(self) -> set[int]:
        s = {(self.root + i) % 12 for i in QUALITIES[self.quality]}
        s |= {(self.root + _EXT[e]) % 12 for e in self.extensions if e in _EXT}
        if self.bass is not None:
            s.add(self.bass)
        return s

    def intervals(self) -> list[int]:
        iv = list(QUALITIES[self.quality]) + [_EXT[e] for e in self.extensions if e in _EXT]
        return sorted(set(iv))

    def to_dict(self) -> dict:
        return {"root": self.root, "quality": self.quality, "extensions": self.extensions,
                "bass": self.bass, "symbol": self.symbol or chord_symbol(self)}


_CHORD_RE = re.compile(
    r"^(?P<root>[A-G](?:#|b|♯|♭)?)(?P<rest>[^/]*)(?:/(?P<bass>[A-G](?:#|b|♯|♭)?))?$"
)


def _normalize_solfege(tok: str) -> str:
    up = tok.upper()
    for k in sorted(_SOLFEGE, key=len, reverse=True):
        if up.startswith(k):
            return _SOLFEGE[k] + tok[len(k):]
    return tok


def parse_chord(token: str) -> Chord | None:
    """Interpreta cifra: C, Cm7, G7/B, F#m7(b5), Bb7M, A7(9), Dsus4, C°, C7+, Am(maj7), Ré m."""
    tok = token.strip().replace(" ", "")
    if not tok:
        return None
    if not tok[0] in "ABCDEFG":
        tok = _normalize_solfege(tok)
    m = _CHORD_RE.match(tok)
    if not m:
        return None
    root = pc_of(m["root"])
    rest = m["rest"]
    bass = pc_of(m["bass"]) if m["bass"] else None

    # Extensões entre parênteses: (9), (b5), (11,13), (maj7)
    paren = re.findall(r"\(([^)]*)\)", rest)
    rest_main = re.sub(r"\([^)]*\)", "", rest)
    exts: list[str] = []
    for p in paren:
        exts += [x.strip() for x in re.split(r"[,/]", p) if x.strip()]

    r = rest_main
    r = r.replace("°", "dim").replace("º", "dim").replace("ø", "m7b5").replace("Δ", "maj7")
    r = r.replace("7M", "maj7").replace("M7", "maj7").replace("7+", "maj7")
    r = r.replace("min", "m").replace("-", "m") if not r.startswith("maj") else r
    r = r.replace("+", "aug")

    quality = ""
    # ordem importa: mais longas primeiro
    for q in ["mmaj7", "m7b5", "7sus4", "dim7", "maj7", "sus2", "sus4", "m7", "m6", "dim", "aug", "m", "7", "6", "5"]:
        if r.startswith(q):
            quality = q
            r = r[len(q):]
            break
    # m + (maj7) → mmaj7 ; m7 + (b5) → m7b5
    if quality == "m" and "maj7" in exts:
        quality = "mmaj7"; exts.remove("maj7")
    if quality == "m7" and "b5" in exts:
        quality = "m7b5"; exts.remove("b5")
    if quality in ("7", "m7", "maj7") and r.startswith("b5"):
        quality = "m7b5" if quality == "m7" else quality; r = r[2:]
    # "9", "11", "13" soltos implicam 7ª: C9 = C7(9)
    tail = re.match(r"^(b9|#9|9|#11|11|b13|13)", r)
    if tail:
        e = tail.group(1)
        if quality == "":
            quality = "7"
        elif quality == "m":
            quality = "m7"
        exts.append(e)
        r = r[len(e):]
    exts = [e for e in exts if e in _EXT]
    if quality not in QUALITIES:
        return None
    return Chord(root, quality, exts, bass, token.strip())


def chord_symbol(c: Chord, flats: bool = False) -> str:
    names = NOTE_NAMES_FLAT if flats else NOTE_NAMES_SHARP
    q = {"maj7": "7M", "m7b5": "m7(b5)", "dim": "°", "dim7": "°7", "aug": "+"}.get(c.quality, c.quality)
    s = names[c.root] + q
    if c.extensions:
        s += "(" + ",".join(c.extensions) + ")"
    if c.bass is not None and c.bass != c.root:
        s += "/" + names[c.bass]
    return s


# ---------------- Tonalidade (Krumhansl-Schmuckler) ----------------
_MAJ_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
_MIN_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]


def _corr(a: list[float], b: list[float]) -> float:
    n = len(a)
    ma, mb = sum(a) / n, sum(b) / n
    num = sum((x - ma) * (y - mb) for x, y in zip(a, b))
    da = sum((x - ma) ** 2 for x in a) ** 0.5
    db = sum((y - mb) ** 2 for y in b) ** 0.5
    return num / (da * db) if da and db else 0.0


def pc_histogram(notes: list[dict]) -> list[float]:
    h = [0.0] * 12
    for n in notes:
        h[n["pitch"] % 12] += n["dur"]
    return h


def detect_key(notes: list[dict]) -> tuple[int, str]:
    """Retorna (tônica pc, 'major'|'minor')."""
    h = pc_histogram(notes)
    if not any(h):
        return 0, "major"
    best = (-2.0, 0, "major")
    for t in range(12):
        rot = h[t:] + h[:t]
        for mode, prof in (("major", _MAJ_PROFILE), ("minor", _MIN_PROFILE)):
            c = _corr(rot, prof)
            if c > best[0]:
                best = (c, t, mode)
    return best[1], best[2]


def key_fifths(tonic: int, mode: str) -> int:
    """Armadura em número de quintas (-7..7) para o frontend renderizar."""
    major = tonic if mode == "major" else (tonic + 3) % 12
    table = {0: 0, 7: 1, 2: 2, 9: 3, 4: 4, 11: 5, 6: 6, 1: -5, 8: -4, 3: -3, 10: -2, 5: -1}
    return table[major]
