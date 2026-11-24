"""Transcrição LEVE (só numpy + ffmpeg) para servidores pequenos, sem PyTorch.

- Melodia monofônica: YIN (de Cheveigné & Kawahara, 2002) + segmentação em notas, com vibrato/glissando.
- Andamento e primeiro tempo: fluxo espectral + autocorrelação do envelope de ataques.
- Harmonia: cromagrama por meio compasso → reconhecimento de acordes por modelos (templates).
Funciona bem para voz/instrumento solo e para estimar acordes; para mixagens densas a IA completa é melhor.
"""
from __future__ import annotations

import subprocess

import numpy as np

from ..theory import Chord, QUALITIES, chord_symbol

SR = 22050


def load_audio(path: str, sr: int = SR) -> np.ndarray:
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-ac", "1", "-ar", str(sr), "-f", "f32le", "-"],
                         check=True, capture_output=True).stdout
    y = np.frombuffer(raw, dtype=np.float32).astype(np.float64)
    peak = np.max(np.abs(y)) if y.size else 0
    return y / peak if peak > 0 else y


def _frames(y: np.ndarray, n: int, hop: int) -> np.ndarray:
    if y.size < n:
        y = np.pad(y, (0, n - y.size))
    count = 1 + (y.size - n) // hop
    idx = np.arange(n)[None, :] + hop * np.arange(count)[:, None]
    return y[idx]


# ------------------------------------------------------------------- YIN
def yin_f0(y: np.ndarray, sr: int = SR, fmin: float = 65, fmax: float = 1050, n: int = 2048, hop: int = 256,
           thr: float = 0.15, chunk: int = 600) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Retorna (f0 Hz [0 = sem voz], confiança 0..1, rms) por quadro."""
    W = n // 2
    tmin, tmax = max(2, int(sr / fmax)), min(W - 1, int(sr / fmin))
    F_all = _frames(y, n, hop)
    f0s, confs, rmss = [], [], []
    for c0 in range(0, len(F_all), chunk):
        x = F_all[c0:c0 + chunk]
        a = x[:, :W]
        nfft = 2 * n
        r = np.fft.irfft(np.fft.rfft(x, nfft) * np.conj(np.fft.rfft(a, nfft)), nfft)[:, :W]
        cs = np.concatenate([np.zeros((len(x), 1)), np.cumsum(x ** 2, axis=1)], axis=1)
        e0 = cs[:, W:W + 1]
        taus = np.arange(W)
        etau = cs[:, taus + W] - cs[:, taus]
        d = np.maximum(e0 + etau - 2 * r, 0)
        cm = np.ones_like(d)
        cum = np.cumsum(d[:, 1:], axis=1)
        cm[:, 1:] = d[:, 1:] * np.arange(1, W) / np.where(cum > 1e-12, cum, 1e-12)
        seg = cm[:, tmin:tmax]
        below = seg < thr
        first = np.where(below.any(axis=1), below.argmax(axis=1), seg.argmin(axis=1))
        # desce até o mínimo local após o primeiro cruzamento do limiar
        for i in range(len(first)):
            t = first[i]
            while t + 1 < seg.shape[1] and seg[i, t + 1] < seg[i, t]:
                t += 1
            first[i] = t
        best = seg[np.arange(len(seg)), first]
        tau = (first + tmin).astype(float)
        # interpolação parabólica
        ii = np.clip(first + tmin, 1, W - 2)
        rows = np.arange(len(seg))
        y0, y1, y2 = cm[rows, ii - 1], cm[rows, ii], cm[rows, ii + 1]
        den = (y0 - 2 * y1 + y2)
        tau = tau + np.where(np.abs(den) > 1e-9, 0.5 * (y0 - y2) / den, 0)
        f0s.append(sr / tau)
        confs.append(np.clip(1 - best, 0, 1))
        rmss.append(np.sqrt(np.mean(x ** 2, axis=1)))
    f0, conf, rms = np.concatenate(f0s), np.concatenate(confs), np.concatenate(rmss)
    voiced = (conf > 1 - 2.2 * thr) & (rms > 0.02 * (rms.max() if rms.size else 1))
    return np.where(voiced, f0, 0.0), conf, rms


def _median(x: np.ndarray, k: int = 5) -> np.ndarray:
    if x.size < k:
        return x
    p = k // 2
    xp = np.pad(x, p, mode="edge")
    return np.median(_frames(xp, k, 1), axis=1)


def melody_events(y: np.ndarray, sr: int = SR, hop: int = 256, min_dur: float = 0.08) -> list[dict]:
    f0, conf, rms = yin_f0(y, sr, hop=hop)
    midi = np.where(f0 > 0, 69 + 12 * np.log2(np.maximum(f0, 1) / 440.0), np.nan)
    sm = _median(np.nan_to_num(midi, nan=-100), 5)
    sm[np.isnan(midi)] = np.nan
    events, cur = [], None
    dt = hop / sr
    for i, m in enumerate(sm):
        t = i * dt
        if np.isnan(m) or m < 0:
            if cur:
                events.append(cur); cur = None
            continue
        q = int(round(m))
        if cur and abs(m - cur["pitch"]) < 0.6:
            cur["end_s"] = t + dt; cur["_f"].append(m); cur["_r"].append(rms[i])
        else:
            if cur:
                events.append(cur)
            cur = {"start_s": t, "end_s": t + dt, "pitch": q, "_f": [m], "_r": [rms[i]]}
    if cur:
        events.append(cur)
    out = []
    peak = float(rms.max()) if rms.size else 1.0
    for e in events:
        f = np.array(e.pop("_f")); r = np.array(e.pop("_r"))
        if e["end_s"] - e["start_s"] < min_dur:
            continue
        e["pitch"] = int(round(float(np.median(f))))
        e["vel"] = int(np.clip(40 + 87 * (r.mean() / peak) ** 0.5, 30, 120))
        if f.size > 12 and np.std(f - np.convolve(f, np.ones(7) / 7, "same")[: f.size]) > 0.15:
            e["effect"] = "vibrato"
        elif f.size > 6 and abs(f[-1] - f[0]) > 0.8:
            e["effect"] = "glissando"
        out.append(e)
    # une repetições fragmentadas (mesma altura, intervalo < 40 ms)
    merged: list[dict] = []
    for e in out:
        if merged and merged[-1]["pitch"] == e["pitch"] and e["start_s"] - merged[-1]["end_s"] < 0.04:
            merged[-1]["end_s"] = e["end_s"]
        else:
            merged.append(e)
    return merged


# --------------------------------------------------------- tempo e croma
def _stft_mag(y: np.ndarray, n: int, hop: int) -> np.ndarray:
    F = _frames(y, n, hop) * np.hanning(n)[None, :]
    return np.abs(np.fft.rfft(F, axis=1))


def tempo_and_offset(y: np.ndarray, sr: int = SR, lo: float = 60, hi: float = 180) -> tuple[float, float]:
    hop = 512
    S = np.log1p(_stft_mag(y, 2048, hop))
    flux = np.maximum(np.diff(S, axis=0), 0).sum(axis=1)
    flux = np.concatenate([[0], flux])
    flux = flux - np.convolve(flux, np.ones(16) / 16, "same")
    flux = np.maximum(flux, 0)
    if flux.size < 16 or not flux.any():
        return 100.0, 0.0
    fps = sr / hop
    ac = np.correlate(flux, flux, "full")[flux.size - 1:]
    best, bscore = 100.0, -1.0
    for bpm in np.arange(lo, hi + 0.5, 0.5):
        lag = 60 * fps / bpm
        l0 = int(lag)
        if l0 + 1 >= ac.size:
            continue
        v = ac[l0] + (lag - l0) * (ac[l0 + 1] - ac[l0])
        v2 = ac[min(ac.size - 1, int(2 * lag))]
        score = (v + 0.5 * v2) * np.exp(-0.5 * (np.log2(bpm / 110) / 0.9) ** 2)
        if score > bscore:
            best, bscore = float(bpm), float(score)
    period = 60 * fps / best
    phases = np.arange(int(period))
    sums = [flux[int(p)::max(1, int(round(period)))].sum() for p in phases] if period >= 1 else [0]
    offset = float(np.argmax(sums)) / fps
    return round(best, 1), offset


def chroma(y: np.ndarray, sr: int = SR, n: int = 4096, hop: int = 1024) -> tuple[np.ndarray, np.ndarray]:
    M = _stft_mag(y, n, hop) ** 2
    freqs = np.fft.rfftfreq(n, 1 / sr)
    band = (freqs >= 55) & (freqs <= 2000)
    pcs = (np.round(69 + 12 * np.log2(freqs[band] / 440.0)).astype(int)) % 12
    C = np.zeros((M.shape[0], 12))
    for pc in range(12):
        C[:, pc] = M[:, band][:, pcs == pc].sum(axis=1)
    C = np.sqrt(C)
    times = np.arange(M.shape[0]) * hop / sr + n / (2 * sr)
    return C, times


_Q = ["", "m", "7", "maj7", "m7", "dim", "sus4"]


def chord_from_chroma(v: np.ndarray) -> Chord | None:
    if v.sum() <= 1e-9:
        return None
    v = v / (np.linalg.norm(v) + 1e-12)
    best, bs = None, -1.0
    for r in range(12):
        for q in _Q:
            t = np.zeros(12)
            for i, iv in enumerate(QUALITIES[q]):
                t[(r + iv) % 12] = 1.0 if i < 3 else 0.6
            t[r] = 1.3
            s = float(v @ (t / np.linalg.norm(t))) - 0.035 * (len(QUALITIES[q]) - 3)
            if s > bs:
                best, bs = Chord(r, q), s
    if best is not None:
        best.symbol = chord_symbol(best)
    return best if bs > 0.55 else None


def chords_by_measure(y: np.ndarray, tempo: float, offset: float, beats_per_measure: int, n_measures: int,
                      per_measure: int = 2, sr: int = SR) -> list[list[dict]]:
    C, times = chroma(y, sr)
    spb = 60.0 / tempo
    step = beats_per_measure / per_measure
    out: list[list[dict]] = []
    for m in range(n_measures):
        cell: list[dict] = []
        for k in range(per_measure):
            a = offset + (m * beats_per_measure + k * step) * spb
            b = a + step * spb
            sel = (times >= a) & (times < b)
            c = chord_from_chroma(C[sel].sum(axis=0)) if sel.any() else None
            if c and cell and cell[-1]["symbol"] == c.symbol:
                cell[-1]["dur"] += step
            elif c:
                cell.append({"beat": k * step, "dur": step, **c.to_dict()})
        out.append(cell)
    return out
