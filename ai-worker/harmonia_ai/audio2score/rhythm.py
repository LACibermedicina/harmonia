"""Ritmo: andamento, fase do pulso e quantização das notas numa grade (semicolcheia por padrão), por compasso."""
import numpy as np


def tempo(onsets, lo=60, hi=160, weights=None):
    """Andamento (bpm) e fase do tempo (s).
    1) busca grossa: o andamento cuja grade de colcheias melhor encaixa os inícios de nota;
    2) refinamento por mínimos quadrados (corrige a deriva de andamentos como 96,4 bpm);
    3) fase do pulso: entre "no tempo" e "no contratempo", a que põe mais inícios (ponderados) nos tempos."""
    on = np.asarray(sorted(onsets), float)
    w = np.ones(len(on)) if weights is None else np.asarray(weights, float)[np.argsort(onsets)]
    if len(on) < 8: return 100.0, float(on[0]) if len(on) else 0.0
    best, be = 100.0, 1e9
    for bpm in np.arange(lo, hi + .5, .5):
        g = 60.0 / bpm / 2; ph = (on / g) % 1; ph = np.minimum(ph, 1 - ph)
        e = float(np.mean(ph)) + (0.004 if bpm < 72 or bpm > 145 else 0)
        if e < be: be, best = e, float(bpm)
    g = 60.0 / best / 2
    phi = (np.angle(np.mean(np.exp(2j * np.pi * on / g))) / (2 * np.pi)) % 1 * g
    for _ in range(4):
        k = np.round((on - phi) / g); r = on - (phi + k * g); ok = np.abs(r) < g / 3
        if ok.sum() < 6: break
        A = np.vstack([np.ones(ok.sum()), k[ok]]).T
        sol, *_ = np.linalg.lstsq(A, on[ok], rcond=None)
        if not (lo <= 30.0 / sol[1] <= hi): break
        phi, g = float(sol[0]), float(sol[1])
    bpm = 30.0 / g; spb = 2 * g
    cand = [phi % spb, (phi + g) % spb]
    sc = [float(np.sum(w * np.cos(2 * np.pi * (on - c) / spb))) for c in cand]
    return round(bpm, 2), float(cand[int(np.argmax(sc))])


def quantize(notes, bpm, offset=0.0, grid=.25, meter=4, keep_lead=False):
    """notes: [{'t','d','m','kind','s',...}] em segundos -> mesmas notas com 'b' (início) e 'q' (duração) em tempos.
    Colisões na grade: notas de melisma/curtíssimas sem sílaba se fundem à anterior; as demais andam uma casa."""
    spb = 60.0 / bpm; out = []
    for n in sorted(notes, key=lambda z: z['t']):
        b = round((n['t'] - offset) / spb / grid) * grid
        e = round((n['t'] + n['d'] - offset) / spb / grid) * grid
        q = max(grid, e - b)
        if out:
            L = out[-1]
            if b <= L['b']:
                if not (n.get('s') and n.get('kind') == 'silaba') and (n.get('kind') == 'melisma' or n['d'] < .12):
                    L['q'] = max(L['q'], b + q - L['b'])
                    if n.get('grace'): L['grace'] = (L.get('grace') or []) + n['grace']
                    continue
                b = L['b'] + grid
        z = dict(n); z['b'] = b; z['q'] = q; out.append(z)
    for i, n in enumerate(out):  # sem sobreposição: cada nota termina onde a próxima começa
        if i + 1 < len(out) and n['b'] + n['q'] > out[i + 1]['b']: n['q'] = max(grid, out[i + 1]['b'] - n['b'])
    if out and not keep_lead:
        # primeiro tempo do compasso: onde caem as notas mais longas (tempo forte); meio do compasso pesa metade
        sc = []
        for k in range(int(round(meter))):
            v = 0.0
            for n in out:
                r = (n['b'] - k) % meter
                if abs(r) < 1e-6: v += n['q']
                elif abs(r - meter / 2) < 1e-6 and meter % 2 == 0: v += .4 * n['q']
            sc.append(v)
        k0 = int(np.argmax(sc)) if max(sc) > 0 else 0
        sh = np.floor((out[0]['b'] - k0) / meter) * meter + k0  # o compasso 1 começa no tempo forte antes da primeira nota
        for n in out: n['b'] = round(n['b'] - sh, 4)
        lead = offset + sh * spb
    else:
        lead = offset
    bars = int(np.ceil(max((n['b'] + n['q'] for n in out), default=meter) / meter))
    return out, bars, lead
