"""MusicXML 4.0 (partwise): parte 1 = melodia com letra, ornamentos, notas de graça e cifras;
parte 2 = harmonia para piano (acordes na clave de sol, baixo na clave de fá). Abre no MuseScore, Finale,
Sibelius, Dorico, Noteflight, flat.io e no music21."""
import xml.etree.ElementTree as ET
from .harmony import SHARP, FLAT

KIND = {'': ('major', ''), 'm': ('minor', 'm'), 'dim': ('diminished', '°'), '7': ('dominant', '7'), 'm7': ('minor-seventh', 'm7'), 'maj7': ('major-seventh', 'maj7')}
TYPES = [(4.0, 'whole', 0), (3.0, 'half', 1), (2.0, 'half', 0), (1.5, 'quarter', 1), (1.0, 'quarter', 0), (.75, 'eighth', 1),
         (.5, 'eighth', 0), (.375, '16th', 1), (.25, '16th', 0), (.125, '32nd', 0)]


def _pieces(q, pos=0.0):
    """Divide uma duração (em tempos) em figuras escrevíveis, respeitando o meio do compasso 4/4 quando possível."""
    out = []
    while q > 1e-6:
        for v, t, dot in TYPES:
            if v <= q + 1e-6:
                # evita atravessar o tempo 3 com figura pontuada estranha (ex.: semínima pontuada começando no 2,5)
                if dot and (pos % 1) != 0 and v >= 1.5: continue
                out.append((v, t, dot)); q -= v; pos += v; break
        else:
            break
    return out


def _spell(m, sharps):
    names = SHARP if sharps else FLAT
    n = names[m % 12]; octv = m // 12 - 1
    return n[0], (1 if '#' in n else -1 if len(n) > 1 else 0), octv


def _sub(p, tag, text=None, **at):
    e = ET.SubElement(p, tag, {k.replace('_', '-'): str(v) for k, v in at.items()})
    if text is not None: e.text = str(text)
    return e


def _pitch(note, m, sharps):
    st, al, oc = _spell(m, sharps)
    p = _sub(note, 'pitch'); _sub(p, 'step', st)
    if al: _sub(p, 'alter', al)
    _sub(p, 'octave', oc)


def _accidental(note, m, sharps, key_fifths):
    st, al, oc = _spell(m, sharps)
    # acidente só quando a nota não pertence à armadura
    order_s, order_f = 'FCGDAEB', 'BEADGCF'
    ks = set(order_s[:key_fifths]) if key_fifths > 0 else set()
    kf = set(order_f[:-key_fifths]) if key_fifths < 0 else set()
    expect = 1 if st in ks else -1 if st in kf else 0
    if al != expect: _sub(note, 'accidental', {1: 'sharp', -1: 'flat', 0: 'natural'}[al])


def _harmony(meas, c, offset_div, sharps):
    h = _sub(meas, 'harmony', print_frame='no')
    r = _sub(h, 'root'); st, al, _ = _spell(c['root'] + 60, sharps)
    _sub(r, 'root-step', st)
    if al: _sub(r, 'root-alter', al)
    k, txt = KIND.get(c['qual'], ('major', ''))
    ke = _sub(h, 'kind', k); ke.set('text', txt)
    if offset_div: _sub(h, 'offset', offset_div)


def build(res, title=None, composer=None):
    key = res['tom']; sharps = key['sustenidos']; fifths = key['fifths']
    meter = res['compasso'][0]; unit = res['compasso'][1]; bpm = res['andamento']
    grid = res.get('grade', .25); div = max(1, int(round(1 / grid)))
    notes = sorted(res['notas_q'], key=lambda n: n['b']); chords = res.get('acordes_q', []); bars = res['compassos']
    low = res.get('clave_oitava', False)
    root = ET.Element('score-partwise', version='4.0')
    w = _sub(root, 'work'); _sub(w, 'work-title', title or res.get('titulo') or 'Transcrição')
    ident = _sub(root, 'identification')
    if composer: _sub(ident, 'creator', composer, type='composer')
    enc = _sub(ident, 'encoding'); _sub(enc, 'software', 'audio2score (MelodIA)')
    pl = _sub(root, 'part-list')
    sp = _sub(pl, 'score-part', id='P1'); _sub(sp, 'part-name', res.get('nome_melodia', 'Melodia'))
    if chords:
        sp2 = _sub(pl, 'score-part', id='P2'); _sub(sp2, 'part-name', 'Harmonia')
        si = _sub(sp2, 'score-instrument', id='P2-I1'); _sub(si, 'instrument-name', 'Piano')
        mi = _sub(sp2, 'midi-instrument', id='P2-I1'); _sub(mi, 'midi-channel', 2); _sub(mi, 'midi-program', 1)

    def attrs(meas, staves=1, clefs=(('G', 2, 0),)):
        a = _sub(meas, 'attributes'); _sub(a, 'divisions', div)
        k = _sub(a, 'key'); _sub(k, 'fifths', fifths); _sub(k, 'mode', 'major' if key['modo'] == 'maior' else 'minor')
        t = _sub(a, 'time'); _sub(t, 'beats', meter); _sub(t, 'beat-type', unit)
        if staves > 1: _sub(a, 'staves', staves)
        for i, (sign, line, oc) in enumerate(clefs):
            c = _sub(a, 'clef', **({'number': i + 1} if staves > 1 else {}))
            _sub(c, 'sign', sign); _sub(c, 'line', line)
            if oc: _sub(c, 'clef-octave-change', oc)

    # ---------------- parte 1: melodia
    p1 = _sub(root, 'part', id='P1')
    for bi in range(bars):
        meas = _sub(p1, 'measure', number=bi + 1)
        if bi == 0:
            attrs(meas, clefs=(('G', 2, -1 if low else 0),))
            d = _sub(meas, 'direction', placement='above'); dt = _sub(d, 'direction-type'); mt = _sub(dt, 'metronome')
            _sub(mt, 'beat-unit', 'quarter'); _sub(mt, 'per-minute', int(round(bpm))); _sub(d, 'sound', tempo=int(round(bpm)))
        a0, a1 = bi * meter, (bi + 1) * meter
        ev = []  # (início, duração, nota|None, é_primeiro_pedaço, continua)
        pos = a0
        for n in notes:
            b0, b1 = n['b'], n['b'] + n['q']
            if b1 <= a0 or b0 >= a1: continue
            s0, s1 = max(b0, a0), min(b1, a1)
            if s0 > pos + 1e-6: ev.append((pos, s0 - pos, None, False, False))
            ev.append((s0, s1 - s0, n, abs(s0 - b0) < 1e-6, b1 > a1 + 1e-6))
            pos = s1
        if pos < a1 - 1e-6: ev.append((pos, a1 - pos, None, False, False))
        chs = [c for c in chords if a0 - 1e-6 <= c['b'] < a1 - 1e-6] if chords else []
        # a mesma cifra que continua no compasso seguinte é repetida no 1º tempo (legibilidade)
        if chords and not any(abs(c['b'] - a0) < 1e-6 for c in chs):
            prev = [c for c in chords if c['b'] < a0]
            if prev: chs = [dict(prev[-1], b=a0)] + chs
        ci = 0
        for (s, q, n, first, cont) in ev:
            while ci < len(chs) and chs[ci]['b'] < s + q - 1e-6:
                _harmony(meas, chs[ci], int(round((chs[ci]['b'] - s) * div)) if chs[ci]['b'] > s + 1e-6 else 0, sharps); ci += 1
            if n is not None and first and n.get('orn') and 'vib' in n['orn']:
                d = _sub(meas, 'direction', placement='above'); dt = _sub(d, 'direction-type'); _sub(dt, 'words', 'vib.', font_style='italic', font_size='8')
            if n is not None and first:
                for g in (n.get('grace') or [])[:2]:
                    ge = _sub(meas, 'note'); _sub(ge, 'grace', slash='yes'); _pitch(ge, int(g), sharps); _sub(ge, 'voice', 1); _sub(ge, 'type', 'eighth'); _accidental(ge, int(g), sharps, fifths)
            pcs = _pieces(q, s - a0); p = s
            for k, (v, t, dot) in enumerate(pcs):
                ne = _sub(meas, 'note')
                if n is None: _sub(ne, 'rest', **({'measure': 'yes'} if q >= meter - 1e-6 else {}))
                else: _pitch(ne, n['m'], sharps)
                _sub(ne, 'duration', int(round(v * div)))
                last_piece = k == len(pcs) - 1
                tie_start = n is not None and (not last_piece or cont); tie_stop = n is not None and (k > 0 or not first)
                if tie_stop: _sub(ne, 'tie', type='stop')
                if tie_start: _sub(ne, 'tie', type='start')
                _sub(ne, 'voice', 1); _sub(ne, 'type', t)
                if dot: _sub(ne, 'dot')
                if n is not None and (k == 0 and first): _accidental(ne, n['m'], sharps, fifths)
                if n is not None:
                    nots = None
                    if tie_stop or tie_start:
                        nots = _sub(ne, 'notations')
                        if tie_stop: _sub(nots, 'tied', type='stop')
                        if tie_start: _sub(nots, 'tied', type='start')
                    if k == 0 and first and n.get('orn'):
                        o = set(n['orn'])
                        if o & {'scoop', 'fall'}:
                            nots = nots if nots is not None else _sub(ne, 'notations'); ar = _sub(nots, 'articulations')
                            if 'scoop' in o: _sub(ar, 'scoop')
                            if 'fall' in o: _sub(ar, 'falloff')
                    if k == 0 and first and n.get('s'):
                        ly = _sub(ne, 'lyric', number=1)
                        wi, wf = n.get('wi', True), n.get('wf', True)
                        if n.get('kind') == 'efeito': wi = wf = True
                        _sub(ly, 'syllabic', 'single' if wi and wf else 'begin' if wi else 'end' if wf else 'middle')
                        _sub(ly, 'text', '(' + n['s'] + ')' if n.get('kind') == 'efeito' else n['s'], **({'font_style': 'italic'} if n.get('kind') == 'efeito' else {}))
                        if n.get('_melisma'): _sub(ly, 'extend')
                p += v
        while ci < len(chs): _harmony(meas, chs[ci], 0, sharps); ci += 1
        if bi == bars - 1: b = _sub(meas, 'barline', location='right'); _sub(b, 'bar-style', 'light-heavy')

    # ---------------- parte 2: harmonia (piano, duas pautas)
    if chords:
        p2 = _sub(root, 'part', id='P2')
        for bi in range(bars):
            meas = _sub(p2, 'measure', number=bi + 1)
            if bi == 0: attrs(meas, staves=2, clefs=(('G', 2, 0), ('F', 4, 0)))
            a0, a1 = bi * meter, (bi + 1) * meter
            for staff, voice in ((1, 1), (2, 5)):
                if staff == 2: bk = _sub(meas, 'backup'); _sub(bk, 'duration', int(round(meter * div)))
                pos = a0
                for c in chords:
                    b0, b1 = c['b'], c['b'] + c['q']
                    if b1 <= a0 or b0 >= a1: continue
                    s0, s1 = max(b0, a0), min(b1, a1)
                    if s0 > pos + 1e-6:
                        for v, t, dot in _pieces(s0 - pos, pos - a0):
                            r = _sub(meas, 'note'); _sub(r, 'rest'); _sub(r, 'duration', int(round(v * div))); _sub(r, 'voice', voice); _sub(r, 'type', t)
                            if dot: _sub(r, 'dot')
                            _sub(r, 'staff', staff)
                    pcs = _pieces(s1 - s0, s0 - a0); first = abs(s0 - b0) < 1e-6; cont = b1 > a1 + 1e-6
                    pitches = c['vozes'] if staff == 1 else [c['baixo']]
                    for k, (v, t, dot) in enumerate(pcs):
                        last = k == len(pcs) - 1; ts = not last or cont; tp = k > 0 or not first
                        for j, mm in enumerate(pitches):
                            ne = _sub(meas, 'note')
                            if j: _sub(ne, 'chord')
                            _pitch(ne, mm, sharps); _sub(ne, 'duration', int(round(v * div)))
                            if tp: _sub(ne, 'tie', type='stop')
                            if ts: _sub(ne, 'tie', type='start')
                            _sub(ne, 'voice', voice); _sub(ne, 'type', t)
                            if dot: _sub(ne, 'dot')
                            if k == 0 and first: _accidental(ne, mm, sharps, fifths)
                            _sub(ne, 'staff', staff)
                            if tp or ts:
                                nt = _sub(ne, 'notations')
                                if tp: _sub(nt, 'tied', type='stop')
                                if ts: _sub(nt, 'tied', type='start')
                    pos = s1
                if pos < a1 - 1e-6:
                    for v, t, dot in _pieces(a1 - pos, pos - a0):
                        r = _sub(meas, 'note'); _sub(r, 'rest'); _sub(r, 'duration', int(round(v * div))); _sub(r, 'voice', voice); _sub(r, 'type', t)
                        if dot: _sub(r, 'dot')
                        _sub(r, 'staff', staff)
            if bi == bars - 1: b = _sub(meas, 'barline', location='right'); _sub(b, 'bar-style', 'light-heavy')
    ET.indent(root, space=' ')
    head = '<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">\n'
    return head + ET.tostring(root, encoding='unicode')
