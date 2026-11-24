"""Altura da voz (ou do instrumento solista) a cada 10 ms.

Usa o Harvest do WORLD (pyworld) quando instalado, que é o mais estável para voz cantada.
Sem ele, usa um YIN próprio em numpy (de Cheveigné & Kawahara, 2002), sem outras dependências.
Depois: correção de oitava contra a mediana móvel (~1,2 s) e descarte de respiração/ruído pela energia.
"""
import numpy as np

HOP = 10.0  # ms


def midi(f):
    return 12 * np.log2(np.maximum(f, 1e-9) / 440.0) + 69


def _pyworld():
    try:
        import pyworld
        return pyworld
    except Exception:
        return None


def yin(x, fs, fmin=65.0, fmax=1000.0, hop_ms=HOP, thr=.15):
    """YIN vetorizado: diferença cumulativa normalizada via FFT, limiar absoluto e interpolação parabólica."""
    x = np.asarray(x, np.float64)
    hop = int(round(fs * hop_ms / 1000)); W = int(2 ** np.ceil(np.log2(fs / fmin * 2.2)))
    tmin, tmax = int(fs / fmax), min(int(fs / fmin) + 2, W // 2)
    n = max(1, int(np.ceil(len(x) / hop)))
    pad = np.concatenate([np.zeros(W // 2), x, np.zeros(W + hop)])
    f0 = np.zeros(n); per = np.ones(n)
    nfft = 2 * W
    for s in range(0, n, 256):  # em blocos para não estourar memória
        idx = np.arange(s, min(n, s + 256))
        fr = np.stack([pad[i * hop:i * hop + W] for i in idx])
        fr = fr - fr.mean(axis=1, keepdims=True)
        F = np.fft.rfft(fr, nfft, axis=1)
        ac = np.fft.irfft(F * np.conj(F), nfft, axis=1)[:, :W // 2 + 1]
        e = np.cumsum(fr ** 2, axis=1)
        tot = e[:, -1:]
        # d(tau) = sum x_j^2 + sum x_{j+tau}^2 - 2 r(tau), sobre a janela de comprimento W - tau
        taus = np.arange(W // 2 + 1)
        e1 = e[:, W - 1 - taus]                      # energia de x[0 : W - tau]
        e2 = tot - np.concatenate([np.zeros((len(idx), 1)), e[:, :W // 2]], axis=1)  # energia de x[tau : W]
        d = e1 + e2 - 2 * ac
        d[:, 0] = 0
        cm = np.cumsum(d[:, 1:], axis=1) / np.arange(1, W // 2 + 1)
        dn = np.ones_like(d); dn[:, 1:] = d[:, 1:] / np.maximum(cm, 1e-12)
        for r, i in enumerate(idx):
            row = dn[r]
            cand = np.where(row[tmin:tmax] < thr)[0]
            if len(cand):
                t = cand[0] + tmin
                while t + 1 < tmax and row[t + 1] < row[t]: t += 1
            else:
                t = int(np.argmin(row[tmin:tmax])) + tmin
                if row[t] > .35: continue
            a, b, c = row[t - 1], row[t], row[t + 1] if t + 1 < len(row) else row[t]
            den = a - 2 * b + c
            tt = t + (.5 * (a - c) / den if abs(den) > 1e-12 else 0)
            f0[i] = fs / tt; per[i] = row[t]
    t = np.arange(n) * hop / fs
    return f0, t, per


def track(x, fs, engine='auto', fmin=65.0, fmax=1000.0, pw=None):
    """Devolve (tempos, altura MIDI em float com NaN onde não há altura, energia em dB, nome do motor)."""
    x = np.asarray(x, np.float64)
    pw = pw or (_pyworld() if engine in ('auto', 'harvest') else None)
    if engine == 'harvest' and pw is None:
        raise RuntimeError('pyworld não instalado (pip install pyworld) — use engine="yin"')
    if pw is not None and engine != 'yin':
        f0, t = pw.harvest(x, fs, f0_floor=fmin, f0_ceil=fmax, frame_period=HOP)
        name = 'harvest'
    else:
        f0, t, _ = yin(x, fs, fmin, fmax)
        name = 'yin'
    hop = int(round(fs * HOP / 1000)); n = len(f0)
    fr = np.pad(x, (0, max(0, n * hop - len(x))))[:n * hop].reshape(n, hop)
    edb = 20 * np.log10(np.sqrt(np.mean(fr ** 2, axis=1) + 1e-12) + 1e-9)
    m = np.where(f0 > 0, midi(f0), np.nan)
    # correção de oitava e descarte de rouquidão: compara com a mediana móvel de ~1,2 s
    v = ~np.isnan(m); k = 60
    if v.sum() > 20:
        idx = np.where(v)[0]; med = np.full(n, np.nan)
        lo = np.searchsorted(idx, np.arange(n) - k); hi = np.searchsorted(idx, np.arange(n) + k)
        for i in np.where(v)[0]:
            if hi[i] > lo[i]: med[i] = np.median(m[idx[lo[i]:hi[i]]])
        for i in np.where(v)[0]:
            if np.isnan(med[i]): continue
            d = m[i] - med[i]
            if abs(d) > 8.5:
                for o in (-12, 12, -24, 24):
                    if abs(d + o) < 4: m[i] += o; break
                else: m[i] = np.nan
    # voz fraca demais = ruído/respiração
    floor = np.nanpercentile(edb, 92) - 38 if np.isfinite(edb).any() else -80
    m[edb < floor] = np.nan
    return t, m, edb, name
