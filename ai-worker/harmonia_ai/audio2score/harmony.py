"""Harmonia: tom (perfis de Krumhansl-Kessler), cromagrama do áudio e acordes por trecho (Viterbi com
progressões funcionais), com nomes cifrados e vozes para piano (baixo + acorde em posição fechada)."""
import numpy as np

KK_MAJ = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
KK_MIN = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])
SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B']
FIFTHS_MAJ = {0: 0, 7: 1, 2: 2, 9: 3, 4: 4, 11: 5, 6: 6, 1: -5, 8: -4, 3: -3, 10: -2, 5: -1}
PT = {'C': 'Dó', 'D': 'Ré', 'E': 'Mi', 'F': 'Fá', 'G': 'Sol', 'A': 'Lá', 'B': 'Si'}
QUAL = {'': (0, 4, 7), 'm': (0, 3, 7), 'dim': (0, 3, 6), '7': (0, 4, 7, 10), 'm7': (0, 3, 7, 10), 'maj7': (0, 4, 7, 11)}


def key_info(tonic, mode):
    fifths = FIFTHS_MAJ[tonic] if mode == 'maior' else FIFTHS_MAJ[(tonic + 3) % 12]
    names = FLAT if fifths < 0 else SHARP
    n = names[tonic]
    pt = PT[n[0]] + ('♯' if '#' in n else '♭' if 'b' in n[1:] else '')
    return {'tonica': tonic, 'modo': mode, 'fifths': fifths, 'nome': n + ('' if mode == 'maior' else 'm'),
            'nome_pt': pt + (' maior' if mode == 'maior' else ' menor'), 'sustenidos': fifths >= 0}


def estimate_key(pc_weights):
    w = np.asarray(pc_weights, float)
    if w.sum() <= 0: return key_info(0, 'maior'), 0.0
    best, bs = (0, 'maior'), -9
    for t in range(12):
        for mode, prof in (('maior', KK_MAJ), ('menor', KK_MIN)):
            r = np.corrcoef(w, np.roll(prof, t))[0, 1]
            if r > bs: bs, best = r, (t, mode)
    return key_info(*best), float(bs)


def chroma(x, fs, hop=1024, n_fft=4096, fmin=60.0, fmax=2100.0):
    """Cromagrama simples (STFT): energia por classe de altura a cada hop. Devolve (tempos, matriz Nx12)."""
    x = np.asarray(x, np.float64)
    if len(x) < n_fft: x = np.pad(x, (0, n_fft - len(x)))
    win = np.hanning(n_fft)
    n = 1 + (len(x) - n_fft) // hop
    fr = np.lib.stride_tricks.as_strided(x, (n, n_fft), (x.strides[0] * hop, x.strides[0]))
    S = np.abs(np.fft.rfft(fr * win, axis=1)) ** 2
    f = np.fft.rfftfreq(n_fft, 1 / fs)
    sel = (f >= fmin) & (f <= fmax)
    pc = (np.round(12 * np.log2(f[sel] / 440.0)) + 69).astype(int) % 12
    C = np.zeros((n, 12))
    for k in range(12): C[:, k] = S[:, sel][:, pc == k].sum(axis=1)
    C = np.log1p(C / (np.median(C[C > 0]) + 1e-12) if (C > 0).any() else C)
    t = (np.arange(n) * hop + n_fft / 2) / fs
    return t, C


def _vocab(key):
    """Acordes candidatos com custo a priori (diatônicos primeiro; dominantes secundárias e empréstimos custam mais)."""
    T, minor = key['tonica'], key['modo'] == 'menor'
    if not minor:
        dia = [(0, '', 'I'), (2, 'm', 'ii'), (4, 'm', 'iii'), (5, '', 'IV'), (7, '', 'V'), (9, 'm', 'vi'), (11, 'dim', 'vii°'), (7, '7', 'V7')]
        ext = [(2, '7', 'V7/V'), (4, '7', 'V7/vi'), (9, '7', 'V7/ii'), (0, '7', 'V7/IV'), (5, 'm', 'iv'), (10, '', 'bVII')]
    else:
        dia = [(0, 'm', 'i'), (2, 'dim', 'ii°'), (3, '', 'III'), (5, 'm', 'iv'), (7, '', 'V'), (7, '7', 'V7'), (8, '', 'VI'), (10, '', 'VII'), (7, 'm', 'v')]
        ext = [(5, '', 'IV'), (0, '7', 'V7/iv'), (2, '7', 'V7/V'), (1, '', 'bII')]
    out = []
    for r, q, f in dia: out.append({'root': (T + r) % 12, 'q': q, 'func': f, 'prior': 0.0})
    for r, q, f in ext: out.append({'root': (T + r) % 12, 'q': q, 'func': f, 'prior': -.3})
    names = SHARP if key['sustenidos'] else FLAT
    for c in out:
        c['pcs'] = [(c['root'] + i) % 12 for i in QUAL[c['q']]]
        c['nome'] = names[c['root']] + c['q'].replace('dim', '°')
    return out


def _trans(a, b, key):
    """Bônus de progressão funcional entre os acordes a e b."""
    if a['nome'] == b['nome']: return .2
    T = key['tonica']; ra, rb = (a['root'] - T) % 12, (b['root'] - T) % 12
    s = 0.0
    if (rb - ra) % 12 == 5: s += .18 + (.1 if a['q'] == '7' and b['prior'] == 0 else 0)   # queda de quinta (V→I, ii→V, V7/V→V)
    if a['func'].startswith('V7/') and ((rb - ra) % 12 != 5 or b['prior'] < 0): s -= .3   # dominante secundária que não resolve num diatônico
    if ra in (5, 2) and rb == 7: s += .1                                         # subdominante → dominante
    if a['func'] in ('V', 'V7') and b['func'] in ('IV', 'iv', 'ii', 'ii°'): s -= .12   # retrogressão
    return s


def chords(qnotes, key, bpm, lead, meter=4, per=2, chroma_tc=None, audio_weight=.35):
    """Escolhe um acorde por trecho de `per` tempos. qnotes: notas quantizadas ('b','q','m').
    chroma_tc: (tempos, matriz) do áudio — ajuda quando há instrumentos acompanhando."""
    total = max((n['b'] + n['q'] for n in qnotes), default=meter)
    nseg = int(np.ceil(total / per)); spb = 60.0 / bpm
    W = np.zeros((nseg, 12))
    for n in qnotes:
        if n.get('kind') == 'efeito' and not n.get('s'): pass
        b0, b1 = n['b'], n['b'] + n['q']
        for s in range(int(b0 // per), int(np.ceil(b1 / per))):
            ov = min(b1, (s + 1) * per) - max(b0, s * per)
            if ov <= 0 or s >= nseg: continue
            strong = 1.5 if abs((n['b'] % meter)) < 1e-6 or abs(n['b'] - s * per) < 1e-6 else 1.0
            W[s, n['m'] % 12] += ov * strong
    has_audio = chroma_tc is not None and len(chroma_tc[0])
    if has_audio:
        tc, C = chroma_tc
        for s in range(nseg):
            a, b = lead + s * per * spb, lead + (s + 1) * per * spb
            sel = (tc >= a) & (tc < b)
            if sel.any():
                c = C[sel].mean(axis=0); c = c / (c.sum() + 1e-9)
                W[s] += audio_weight * per * 2 * c
    V = _vocab(key); K = len(V)
    E = np.zeros((nseg, K))
    for s in range(nseg):
        tot = W[s].sum()
        if tot <= 1e-9: continue
        for k, c in enumerate(V):
            inn = sum(W[s, p] * (1.35 if p == c['root'] else 1.0) for p in c['pcs'])
            out = tot - sum(W[s, p] for p in c['pcs'])
            E[s, k] = (inn - .7 * out) / tot + c['prior'] - (.08 if len(c['pcs']) == 4 else 0)
    # Viterbi
    TR = np.array([[_trans(a, b, key) for b in V] for a in V])
    tonic_k = 0
    D = np.full((nseg, K), -1e9); B = np.zeros((nseg, K), int)
    D[0] = E[0] + np.array([.2 if k == tonic_k else 0 for k in range(K)])
    for s in range(1, nseg):
        sc = D[s - 1][:, None] + TR
        B[s] = np.argmax(sc, axis=0); D[s] = sc[B[s], range(K)] + E[s]
    D[-1] += np.array([.3 if k == tonic_k else 0 for k in range(K)])
    path = [int(np.argmax(D[-1]))]
    for s in range(nseg - 1, 0, -1): path.append(int(B[s, path[-1]]))
    path.reverse()
    out = []
    for s, k in enumerate(path):
        c = V[k]
        if out and out[-1]['nome'] == c['nome'] and (s * per) % meter != 0: out[-1]['q'] += per; continue
        if out and out[-1]['nome'] == c['nome'] and W[s].sum() == 0: out[-1]['q'] += per; continue
        out.append({'b': s * per, 'q': per, 'nome': c['nome'], 'func': c['func'], 'root': c['root'], 'qual': c['q'], 'pcs': c['pcs']})
    voice(out)
    return out


def voice(ch, lo=55, hi=68):
    """Baixo na fundamental (40..51) e acorde em posição fechada com a menor movimentação entre acordes."""
    prev = None
    for c in ch:
        c['baixo'] = 40 + (c['root'] - 40) % 12
        cands = []
        pcs = c['pcs'][:4]
        for inv in range(len(pcs)):
            order = pcs[inv:] + pcs[:inv]
            base = lo + (order[0] - lo) % 12; v = [base]
            for p in order[1:]:
                x = v[-1] + (p - v[-1]) % 12 or 12
                v.append(x)
            if v[-1] <= hi + 2: cands.append(v)
        if not cands: cands = [[lo + (p - lo) % 12 for p in sorted(pcs)]]
        if prev: best = min(cands, key=lambda v: sum(abs(a - b) for a, b in zip(sorted(v), sorted(prev))) + abs(len(v) - len(prev)))
        else: best = min(cands, key=lambda v: abs(np.mean(v) - 61))
        c['vozes'] = sorted(best); prev = c['vozes']
    return ch


def melody_pc(qnotes):
    w = np.zeros(12)
    for n in qnotes: w[n['m'] % 12] += n['q'] * (1.3 if n.get('kind') == 'silaba' else 1.0)
    return w
