"""MIDI padrão (SMF tipo 1, 480 PPQ): faixa de tempo, melodia (com a letra em eventos de letra) e harmonia (baixo + acordes)."""
import struct


def _vlq(n):
    b = [n & 0x7F]; n >>= 7
    while n: b.append((n & 0x7F) | 0x80); n >>= 7
    return bytes(reversed(b))


def _track(events):
    """events: (tick, ordem, bytes). Devolve o bloco MTrk."""
    events.sort(key=lambda e: (e[0], e[1])); out = b''; last = 0
    for t, _, data in events:
        out += _vlq(max(0, t - last)) + data; last = t
    out += _vlq(0) + b'\xff\x2f\x00'
    return b'MTrk' + struct.pack('>I', len(out)) + out


def _meta(kind, data):
    return bytes([0xFF, kind]) + _vlq(len(data)) + data


def build(res, ppq=480, melody_program=53, chord_program=0, lyrics=True):
    bpm = res['andamento']; meter, unit = res['compasso']
    t0 = [(0, 0, _meta(0x03, (res.get('titulo') or 'Transcrição').encode('utf-8'))),
          (0, 1, _meta(0x51, struct.pack('>I', int(round(60e6 / bpm)))[1:])),
          (0, 2, _meta(0x58, bytes([meter, {2: 1, 4: 2, 8: 3}.get(unit, 2), 24, 8]))),
          (0, 3, _meta(0x59, struct.pack('>bB', res['tom']['fifths'], 0 if res['tom']['modo'] == 'maior' else 1)))]
    tr = [_track(t0)]
    ev = [(0, 0, _meta(0x03, b'Melodia')), (0, 1, bytes([0xC0, melody_program]))]
    tick = lambda b: int(round(b * ppq))
    for n in res['notas_q']:
        a = tick(n['b']); b = tick(n['b'] + n['q']); vel = 92 if n.get('kind') == 'silaba' else 78
        for k, g in enumerate((n.get('grace') or [])[:2]):
            ga = max(0, a - ppq // 8 * (len(n['grace'][:2]) - k))
            ev += [(ga, 3, bytes([0x90, int(g), 70])), (ga + ppq // 8 - 1, 2, bytes([0x80, int(g), 0]))]
        if lyrics and n.get('s'):
            txt = n['s'] + ('' if n.get('wf', True) or n.get('kind') == 'efeito' else '-')
            ev.append((a, 4, _meta(0x05, (' ' + txt if n.get('wi', True) else txt).encode('utf-8'))))
        ev += [(a, 5, bytes([0x90, n['m'], vel])), (max(a + 1, b - 1), 2, bytes([0x80, n['m'], 0]))]
    tr.append(_track(ev))
    if res.get('acordes_q'):
        ev = [(0, 0, _meta(0x03, b'Harmonia')), (0, 1, bytes([0xC1, chord_program]))]
        for c in res['acordes_q']:
            a = tick(c['b']); b = tick(c['b'] + c['q'])
            ev.append((a, 3, _meta(0x01, c['nome'].encode('utf-8'))))
            for m in [c['baixo']] + c['vozes']:
                ev += [(a, 5, bytes([0x91, m, 64])), (max(a + 1, b - 2), 2, bytes([0x81, m, 0]))]
        tr.append(_track(ev))
    return b'MThd' + struct.pack('>IHHH', 6, 1, len(tr), ppq) + b''.join(tr)
