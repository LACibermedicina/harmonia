"""Melodia cantada: sílabas cantadas, notas, ornamentos e letra alinhada (o mesmo motor do MelodIA).

1) sílabas cantadas pelos vales de energia e pelas consoantes (trechos sem altura);
2) dentro de cada sílaba, patamares de altura = notas; deslizes de entrada (scoop), quedas (fall),
   vibrato e notas curtíssimas (< 80 ms) viram ORNAMENTOS da nota principal, não notas novas;
3) letra: com o tempo de cada palavra (ASR) encaixa sílaba a sílaba nas notas que soam naquele momento;
   com letra digitada, distribui as sílabas pelos inícios de sílaba cantada. Notas extras dentro da
   palavra = melisma; som fora das palavras = efeito vocal (hm, ô, tá, ê).
"""
import re
import numpy as np
from .pitch import HOP

# ------------------------------------------------------------------ sílabas (igual ao app)
VW = 'aeiouáéíóúâêôãõàü'
_SYL = re.compile('[^' + VW + ']*[' + VW + ']+(?:[nrsmlz](?![' + VW + ']))?')
_DG = (('nh', '\u0272'), ('lh', '\u028e'), ('ch', '\u0283'), ('qu', 'q\u02b7'), ('gu', 'g\u02b7'))
def syl_word(w):
    w = re.sub('[^a-záéíóúâêôãõàçü]', '', w.lower())
    if not w: return []
    for a_, b_ in _DG[:3]: w = w.replace(a_, b_)  # dígrafos não se separam (ca-mi-nho, fi-lho, cho-ro)
    out = _SYL.findall(w)
    if out:
        rest = w[len(''.join(out)):]
        if rest: out[-1] += rest
    else: out = [w]
    # hiatos com i/u seguidos de a/e/o (di-a, ru-a, a-le-gri-a, ci-ú-me), exceto qu/gu e ditongos nasais (mãe, põe)
    sp = []
    for o in out:
        mm = re.match(r'^(.*?(?<![qg])[iuíú])([aeoáéóâêô].*)$', o) or re.match(r'^(.*?(?<![qg])[aeoiu])([íú].*)$', o)
        if mm and not re.search(r'[ãõ]', o): sp += [mm.group(1), mm.group(2)]
        else: sp.append(o)
    back = lambda x: x.replace('\u0272', 'nh').replace('\u028e', 'lh').replace('\u0283', 'ch')
    return [back(o) for o in sp]

def _smooth(a, k=5):
    out = a.copy(); h = k // 2
    for i in range(len(a)):
        w = a[max(0, i - h):i + h + 1]; w = w[~np.isnan(w)]
        out[i] = np.median(w) if len(w) else np.nan
    return out

# ------------------------------------------------------------------ sílabas cantadas e notas
def syllable_segments(m, edb, min_len=6):
    """Trechos sonoros separados por silêncio, consoantes surdas ou vales de energia."""
    v = ~np.isnan(m); n = len(m); segs = []; i = 0
    es = np.convolve(np.nan_to_num(edb, nan=-90), np.ones(5) / 5, mode='same')
    while i < n:
        if not v[i]: i += 1; continue
        j = i
        while j < n and (v[j] or (j + 1 < n and v[j + 1] and j - i > 2)): j += 1
        # divide por vales de energia (sílabas emendadas, sem consoante surda)
        cuts = [i]
        for k in range(i + 6, j - 6):
            win = es[k - 6:k + 7]
            if es[k] == win.min() and min(es[k - 6:k].max(), es[k + 1:k + 7].max()) - es[k] >= 4.5: cuts.append(k)
        cuts.append(j)
        for a, b in zip(cuts, cuts[1:]):
            if b - a >= min_len: segs.append((a, b))
        i = j
    return segs

def notes_in_segment(m, a, b, t):
    """Patamares de altura dentro de uma sílaba; deslizes e vibrato viram ornamentos."""
    ms = _smooth(m[a:b], 5); n = b - a
    plats = []; s = 0
    while s < n:
        if np.isnan(ms[s]): s += 1; continue
        e = s + 1; ref = ms[s]; vals = [ms[s]]
        while e < n:
            x = ms[e]
            if np.isnan(x): break
            med = float(np.median(vals[-12:]))
            if abs(x - med) > 0.85:
                # muda de patamar só se a nova altura se sustenta por ≥ 60 ms
                look = ms[e:e + 6]; look = look[~np.isnan(look)]
                if len(look) >= 5 and np.all(np.abs(look - np.median(look)) < 0.7) and abs(np.median(look) - med) > 0.85: break
            vals.append(x); e += 1
        plats.append([s, e]); s = e
    notes = []
    for s, e in plats:
        seg = ms[s:e]; seg = seg[~np.isnan(seg)]
        if len(seg) < 3: continue
        L = len(seg); core = seg[int(L * .25):max(int(L * .25) + 1, int(L * .8))]
        pitch = float(np.median(core)); orn = []
        head = seg[:max(2, int(L * .25))]; tail = seg[int(L * .8):]
        if len(head) and pitch - head.min() > 1.2 and head.argmin() < len(head) / 2: orn.append('scoop')
        if len(tail) > 1 and pitch - tail[-1] > 1.5: orn.append('fall')
        if L >= 25:
            dev = core - np.convolve(core, np.ones(9) / 9, mode='same')
            zc = np.sum(np.diff(np.sign(dev[4:-4])) != 0) / max(1e-9, (len(core) - 8) * HOP / 1000) / 2
            if 3.5 < zc < 9 and np.std(dev[4:-4]) > .18: orn.append('vib')
        notes.append({'a': a + s, 'b': a + e, 'm': pitch, 'orn': orn})
    # notas curtíssimas (< 80 ms) = ornamento (apojatura/nota de graça) da vizinha mais longa
    out = []
    for i, nt in enumerate(notes):
        dur = (nt['b'] - nt['a']) * HOP / 1000
        if dur < .08 and len(notes) > 1:
            j = i + 1 if i + 1 < len(notes) else i - 1
            tgt = notes[j]
            if abs(tgt['m'] - nt['m']) <= 3:
                tgt.setdefault('grace', []).append(round(nt['m']))
                if j > i: tgt['a'] = nt['a']
                else: tgt['b'] = nt['b']
                continue
        out.append(nt)
    return out

def extract_notes(m, edb, t):
    segs = syllable_segments(m, edb); notes = []
    for si, (a, b) in enumerate(segs):
        for k, nt in enumerate(notes_in_segment(m, a, b, t)):
            nt['seg'] = si; nt['first'] = k == 0
            nt['e'] = float(np.nanmax(edb[nt['a']:nt['b']])) if nt['b'] > nt['a'] else -90.0
            notes.append(nt)
    out = []
    for nt in notes:
        t0 = nt['a'] * HOP / 1000; d = (nt['b'] - nt['a']) * HOP / 1000
        out.append({'t': round(t0, 3), 'd': round(d, 3), 'm': int(round(nt['m'])), 'mf': round(nt['m'], 2), 'seg': nt['seg'], 'first': nt['first'],
                    'orn': nt['orn'] + (['grace'] if nt.get('grace') else []), 'grace': nt.get('grace', []), 'e': round(nt['e'], 1)})
    return out, segs

# ------------------------------------------------------------------ letra alinhada às notas
def align(notes, words):
    """words: [{'w','start','end'}]. Marca cada nota como sílaba, melisma ou efeito vocal."""
    for n in notes: n.update(s='', kind='efeito', word=-1, wi=False, wf=False)
    if not words:
        return notes
    for wi_, w in enumerate(words):
        ss = syl_word(w['w'])
        if not ss: continue
        a, b = w['start'] - .12, w['end'] + .08
        idx = [i for i, n in enumerate(notes) if a <= n['t'] + min(.06, n['d'] / 2) < b and notes[i]['word'] < 0]
        if not idx:
            # palavra sem nota própria (falada muito rápido): cola na nota mais próxima
            near = min(range(len(notes)), key=lambda i: abs(notes[i]['t'] - w['start'])) if notes else None
            if near is not None and abs(notes[near]['t'] - w['start']) < .5 and notes[near]['word'] < 0: idx = [near]
            else: continue
        # grupos de notas por sílaba cantada (segmento); cada grupo recebe uma sílaba
        groups = []
        for i in idx:
            if groups and notes[groups[-1][-1]]['seg'] == notes[i]['seg']: groups[-1].append(i)
            else: groups.append([i])
        while len(groups) > len(ss) and len(groups) > 1:
            # junta o grupo mais curto ao vizinho: vira melisma da sílaba anterior
            durs = [sum(notes[i]['d'] for i in g) for g in groups]; k = int(np.argmin(durs[1:])) + 1
            groups[k - 1] += groups.pop(k)
        sylls = list(ss)
        if len(sylls) > len(groups):
            # mais sílabas que sílabas cantadas: divide notas longas ou junta sílabas na última
            extra = len(sylls) - len(groups); flat = [i for g in groups for i in g]
            if len(flat) >= len(sylls): groups = [[i] for i in flat[:len(sylls) - 1]] + [flat[len(sylls) - 1:]]
            else:
                groups = [[i] for i in flat]; sylls = sylls[:len(groups) - 1] + [''.join(sylls[len(groups) - 1:])]
        for k, g in enumerate(groups):
            for j, i in enumerate(g):
                notes[i].update(word=wi_, kind='silaba' if j == 0 else 'melisma', s=sylls[k] if j == 0 else '',
                                wi=(k == 0 and j == 0), wf=(k == len(groups) - 1 and j == 0))
    return notes

def vocables(notes):
    """Efeitos vocais fora das palavras: escolhe uma sílaba neutra pela altura/energia/duração."""
    for i, n in enumerate(notes):
        if n['kind'] != 'efeito': continue
        prev = notes[i - 1] if i else None
        if prev and prev['kind'] in ('silaba', 'melisma') and prev['seg'] == n['seg']:
            n['kind'] = 'melisma'; n['s'] = ''; continue
        n['s'] = 'hm' if n['e'] < np.median([x['e'] for x in notes]) - 9 else ('ô' if n['d'] > .35 else 'tá' if n['d'] < .16 else 'ê')
    return notes



def _pick_anchors(notes, anc, M):
    """Escolhe M dos N inícios de sílaba cantada para receber a letra (programação dinâmica).
    Descartar um início custa a duração do som; nas pontas das frases (pausa >= 0,25 s ou começo/fim) custa menos,
    e descartes seguidos (vocalise, "ô ô ô") custam metade — sons sem letra costumam vir nas pontas, em bloco.
    O primeiro som só fica sem letra se estiver isolado por uma pausa (vocalise de introdução)."""
    N = len(anc)
    seg_end = {}
    for n in notes: seg_end[n['seg']] = max(seg_end.get(n['seg'], 0), n['t'] + n['d'])
    dur, edge = [], []
    for q, i in enumerate(anc):
        nt = notes[i]; nxt = notes[anc[q + 1]] if q + 1 < N else None; prv = notes[anc[q - 1]] if q else None
        d = seg_end[nt['seg']] - nt['t']; dur.append(d)
        gb = nt['t'] - seg_end[prv['seg']] if prv else 9; ga = nxt['t'] - seg_end[nt['seg']] if nxt else 9
        if q == 0: edge.append(.4 if ga >= .25 else 1.0 + 1.0 / max(d, .05))   # a letra costuma começar no 1º som cantado
        else: edge.append(.4 if gb >= .25 or ga >= .25 else 1.0)
    INF = 1e18
    # D[j][k]: menor custo usando j inícios e atribuindo k sílabas; último início descartado (1) ou não (0)
    D = [[[INF, INF] for _ in range(M + 1)] for _ in range(N + 1)]; Bk = {}
    D[0][0][0] = 0
    for j in range(N):
        for k in range(M + 1):
            for dp in (0, 1):
                c = D[j][k][dp]
                if c >= INF: continue
                if k < M and c < D[j + 1][k + 1][0]: D[j + 1][k + 1][0] = c; Bk[(j + 1, k + 1, 0)] = (k, dp, True)
                cd = c + dur[j] * edge[j] * (.5 if dp else 1.0)
                if cd < D[j + 1][k][1]: D[j + 1][k][1] = cd; Bk[(j + 1, k, 1)] = (k, dp, False)
    dp = 0 if D[N][M][0] <= D[N][M][1] else 1; k = M; keep = []
    for j in range(N, 0, -1):
        pk, pdp, used = Bk[(j, k, dp)]
        if used: keep.append(anc[j - 1])
        k, dp = pk, pdp
    return sorted(keep)


def align_text(notes, text):
    """Letra digitada (sem tempo das palavras): uma sílaba por início de sílaba cantada, na ordem."""
    for n in notes: n.update(s='', kind='efeito', word=-1, wi=False, wf=False)
    words = [w for w in re.split(r'\s+', str(text or '').strip()) if re.sub('[^A-Za-zÀ-ÿ]', '', w)]
    flags = []
    for wi_, w in enumerate(words):
        ss = syl_word(w)
        for k, s in enumerate(ss): flags.append((s, wi_, k == 0, k == len(ss) - 1))
    if not flags or not notes: return vocables(notes) if notes else notes
    anc = [i for i, n in enumerate(notes) if n['first']]
    if len(anc) > len(flags): anc = _pick_anchors(notes, anc, len(flags))
    for q, i in enumerate(anc):
        s, wi_, a, b = flags[q]
        if q == len(anc) - 1 and len(flags) > len(anc): s = ''.join(f[0] for f in flags[q:]); b = True
        notes[i].update(s=s, kind='silaba', word=wi_, wi=a, wf=b)
    return vocables(notes)
