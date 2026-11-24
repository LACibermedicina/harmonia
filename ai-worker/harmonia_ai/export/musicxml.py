"""Score JSON → MusicXML 4.0 (piano em sistema de duas pautas).
Usado para PDF (Verovio), interoperabilidade (MuseScore/Finale/Sibelius) e OMR round-trip."""
from __future__ import annotations

from xml.sax.saxutils import escape

DIV = 4  # divisões por semínima (grade de semicolcheia)
_TYPES = [(16, "whole", 0), (12, "half", 1), (8, "half", 0), (6, "quarter", 1), (4, "quarter", 0),
          (3, "eighth", 1), (2, "eighth", 0), (1, "16th", 0)]
_STEPS = [("C", 0), ("C", 1), ("D", 0), ("D", 1), ("E", 0), ("F", 0), ("F", 1), ("G", 0), ("G", 1), ("A", 0), ("A", 1), ("B", 0)]
_STEPS_FLAT = [("C", 0), ("D", -1), ("D", 0), ("E", -1), ("E", 0), ("F", 0), ("G", -1), ("G", 0), ("A", -1), ("A", 0), ("B", -1), ("B", 0)]
_KIND = {"": "major", "m": "minor", "7": "dominant", "maj7": "major-seventh", "m7": "minor-seventh",
         "dim": "diminished", "dim7": "diminished-seventh", "aug": "augmented", "m7b5": "half-diminished",
         "sus4": "suspended-fourth", "sus2": "suspended-second", "6": "major-sixth", "m6": "minor-sixth",
         "mmaj7": "major-minor", "7sus4": "dominant", "5": "power"}
_ROOT = ["C", "C", "D", "E", "E", "F", "F", "G", "A", "A", "B", "B"]
_ROOT_ALT = [0, 1, 0, -1, 0, 0, 1, 0, -1, 0, -1, 0]


def _split(d: int) -> list[tuple[int, str, int]]:
    out = []
    while d > 0:
        for v, t, dots in _TYPES:
            if v <= d:
                out.append((v, t, dots)); d -= v; break
    return out


def _pitch_xml(p: int, flats: bool) -> str:
    step, alt = (_STEPS_FLAT if flats else _STEPS)[p % 12]
    octave = p // 12 - 1
    a = f"<alter>{alt}</alter>" if alt else ""
    return f"<pitch><step>{step}</step>{a}<octave>{octave}</octave></pitch>"


def _voice_events(notes: list[dict], m_start: int, m_len: int) -> list[tuple[int, int, list[dict], bool, bool]]:
    """Retorna eventos (início_rel, dur, notas_do_acorde, tie_start, tie_stop) dentro do compasso."""
    groups: dict[tuple[int, int], list[dict]] = {}
    for n in notes:
        s = round(n["start"] * DIV)
        e = round((n["start"] + n["dur"]) * DIV)
        a, b = max(s, m_start), min(e, m_start + m_len)
        if b <= a:
            continue
        key = (a - m_start, b - a)
        groups.setdefault(key, []).append({**n, "_tstop": s < m_start, "_tstart": e > m_start + m_len})
    evs, cursor = [], 0
    for (a, d), ns in sorted(groups.items()):
        if a < cursor:  # sobreposição na mesma voz: corta
            d -= cursor - a; a = cursor
            if d <= 0:
                continue
        evs.append((a, d, ns))
        cursor = a + d
    return evs


def score_to_musicxml(score: dict) -> str:
    num, den = score.get("timeSig", [4, 4])
    m_len = int(num * 4 / den * DIV)
    fifths = int(score.get("keySig", 0))
    flats = fifths < 0
    layers = [l for l in score.get("layers", []) if l.get("visible", True) and l.get("notes") is not None]
    n_measures = int(score.get("measures") or 0)
    for l in layers:
        for n in l.get("notes", []):
            n_measures = max(n_measures, int((n["start"] + n["dur"]) * DIV // m_len) + 1)
    n_measures = max(1, n_measures)
    chords = score.get("chords", [])  # [[{beat,dur,root,quality,bass,symbol}], ...] por compasso

    staff_of = lambda l: 2 if l.get("staff") == "bass" else 1
    parts = []
    for m in range(n_measures):
        x = [f'<measure number="{m + 1}">']
        if m == 0:
            x.append(f"<attributes><divisions>{DIV}</divisions><key><fifths>{fifths}</fifths></key>"
                     f"<time><beats>{num}</beats><beat-type>{den}</beat-type></time><staves>2</staves>"
                     "<clef number=\"1\"><sign>G</sign><line>2</line></clef>"
                     "<clef number=\"2\"><sign>F</sign><line>4</line></clef></attributes>"
                     f'<direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit>'
                     f'<per-minute>{int(score.get("tempo", 100))}</per-minute></metronome></direction-type>'
                     f'<sound tempo="{int(score.get("tempo", 100))}"/></direction>')
        for ann in score.get("annotations", []):
            if int(ann.get("measure", -1)) == m:
                x.append(f'<direction placement="above"><direction-type><words>{escape(ann.get("text", ""))}'
                         "</words></direction-type></direction>")
        if m < len(chords):
            for c in chords[m]:
                bass = ""
                if c.get("bass") is not None and c["bass"] != c["root"]:
                    bass = (f"<bass><bass-step>{_ROOT[c['bass']]}</bass-step>"
                            f"<bass-alter>{_ROOT_ALT[c['bass']]}</bass-alter></bass>")
                x.append(f'<harmony><root><root-step>{_ROOT[c["root"]]}</root-step>'
                         f'<root-alter>{_ROOT_ALT[c["root"]]}</root-alter></root>'
                         f'<kind text="{escape(c.get("symbol", ""))}">{_KIND.get(c.get("quality", ""), "major")}</kind>'
                         f'{bass}<offset>{int(c.get("beat", 0) * DIV)}</offset></harmony>')
        voices = []
        for staff in (1, 2):
            sl = [l for l in layers if staff_of(l) == staff and not l.get("muted_score")]
            if not sl:
                sl = [{"notes": [], "_empty": True}]
            for l in sl:
                voices.append((staff, l))
        first = True
        for vi, (staff, l) in enumerate(voices, start=1):
            if not first:
                x.append(f"<backup><duration>{m_len}</duration></backup>")
            first = False
            cursor = 0
            for a, d, ns in _voice_events(l.get("notes", []), m * m_len, m_len):
                if a > cursor:
                    for v, t, dots in _split(a - cursor):
                        x.append(f"<note><rest/><duration>{v}</duration><voice>{vi}</voice><type>{t}</type>"
                                 + "<dot/>" * dots + f"<staff>{staff}</staff></note>")
                pieces = _split(d)
                for pi, (v, t, dots) in enumerate(pieces):
                    for ci, n in enumerate(sorted(ns, key=lambda q: q["pitch"])):
                        tie_stop = pi > 0 or n["_tstop"]
                        tie_start = pi < len(pieces) - 1 or n["_tstart"]
                        ties = ("<tie type=\"stop\"/>" if tie_stop else "") + ("<tie type=\"start\"/>" if tie_start else "")
                        notations = ("<tied type=\"stop\"/>" if tie_stop else "") + ("<tied type=\"start\"/>" if tie_start else "")
                        lyric = ""
                        if ci == 0 and pi == 0 and n.get("lyric") and n["lyric"] != "_" and not n["_tstop"]:
                            txt = n["lyric"]
                            syl = "begin" if txt.endswith("-") else "single"
                            lyric = f"<lyric number=\"1\"><syllabic>{syl}</syllabic><text>{escape(txt.rstrip('-'))}</text></lyric>"
                        x.append("<note>" + ("<chord/>" if ci else "") + _pitch_xml(int(n["pitch"]), flats)
                                 + f"<duration>{v}</duration>{ties}<voice>{vi}</voice><type>{t}</type>"
                                 + "<dot/>" * dots + f"<staff>{staff}</staff>"
                                 + (f"<notations>{notations}</notations>" if notations else "") + lyric + "</note>")
                cursor = a + d
            if cursor < m_len:
                for v, t, dots in _split(m_len - cursor):
                    x.append(f"<note><rest/><duration>{v}</duration><voice>{vi}</voice><type>{t}</type>"
                             + "<dot/>" * dots + f"<staff>{staff}</staff></note>")
        x.append("</measure>")
        parts.append("".join(x))
    title = escape(score.get("title", "harmonIA"))
    return ('<?xml version="1.0" encoding="UTF-8"?>\n'
            '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" '
            '"http://www.musicxml.org/dtds/partwise.dtd">\n'
            f'<score-partwise version="4.0"><work><work-title>{title}</work-title></work>'
            '<identification><encoding><software>harmonIA</software></encoding></identification>'
            '<part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>'
            f'<part id="P1">{"".join(parts)}</part></score-partwise>')
