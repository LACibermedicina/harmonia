"""Leitura de áudio: WAV direto (sem dependências); MP3, M4A, OGG, OPUS, FLAC, WEBM, MP4 etc. via ffmpeg, se instalado."""
import io, os, shutil, subprocess, wave
import numpy as np

SR = 16000  # a análise roda em 16 kHz mono


def _wav_bytes(b):
    with wave.open(io.BytesIO(b)) as w:
        ch, sw, sr, n = w.getnchannels(), w.getsampwidth(), w.getframerate(), w.getnframes()
        raw = w.readframes(n)
    if sw == 1: x = (np.frombuffer(raw, np.uint8).astype(np.float64) - 128) / 128
    elif sw == 2: x = np.frombuffer(raw, '<i2').astype(np.float64) / 32768
    elif sw == 3:
        a = np.frombuffer(raw, np.uint8).reshape(-1, 3)
        v = (a[:, 0].astype(np.int32) | (a[:, 1].astype(np.int32) << 8) | (a[:, 2].astype(np.int32) << 16))
        x = np.where(v >= 1 << 23, v - (1 << 24), v).astype(np.float64) / (1 << 23)
    elif sw == 4: x = np.frombuffer(raw, '<i4').astype(np.float64) / 2147483648
    else: raise ValueError('WAV com %d bytes por amostra não suportado' % sw)
    if ch > 1: x = x.reshape(-1, ch).mean(axis=1)
    return x, sr


def _float_wav(b):
    """WAV em ponto flutuante (formato 3), que o módulo wave não lê."""
    if b[:4] != b'RIFF' or b[8:12] != b'WAVE': raise ValueError
    i, fmt, data = 12, None, None
    while i + 8 <= len(b):
        cid, sz = b[i:i + 4], int.from_bytes(b[i + 4:i + 8], 'little')
        if cid == b'fmt ': fmt = b[i + 8:i + 8 + sz]
        elif cid == b'data': data = b[i + 8:i + 8 + sz]
        i += 8 + sz + (sz & 1)
    if not fmt or data is None: raise ValueError
    tag, ch, sr, bits = int.from_bytes(fmt[0:2], 'little'), int.from_bytes(fmt[2:4], 'little'), int.from_bytes(fmt[4:8], 'little'), int.from_bytes(fmt[14:16], 'little')
    if tag == 0xFFFE and len(fmt) >= 26: tag = int.from_bytes(fmt[24:26], 'little')
    if tag != 3: raise ValueError
    x = np.frombuffer(data[:len(data) // (bits // 8) * (bits // 8)], '<f4' if bits == 32 else '<f8').astype(np.float64)
    if ch > 1: x = x[:len(x) // ch * ch].reshape(-1, ch).mean(axis=1)
    return x, sr


def _ffmpeg(b):
    exe = os.environ.get('A2S_FFMPEG') or shutil.which('ffmpeg')
    if not exe: raise RuntimeError('Formato de áudio não suportado sem o ffmpeg. Envie WAV ou instale o ffmpeg.')
    import tempfile
    # arquivo temporário (MP4/M4A do celular costumam ter o índice no fim e não funcionam por pipe)
    with tempfile.NamedTemporaryFile(suffix='.bin', delete=False) as f: f.write(b); tmp = f.name
    try:
        p = subprocess.run([exe, '-v', 'error', '-nostdin', '-i', tmp, '-vn', '-ac', '1', '-ar', str(SR), '-f', 's16le', 'pipe:1'],
                           stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=600)
    finally:
        try: os.unlink(tmp)
        except OSError: pass
    if p.returncode != 0 or not p.stdout: raise RuntimeError('O ffmpeg não conseguiu ler o áudio: ' + p.stderr.decode('utf-8', 'replace')[-300:])
    return np.frombuffer(p.stdout, '<i2').astype(np.float64) / 32768, SR


def resample(x, sr, to=SR):
    if sr == to: return np.asarray(x, np.float64)
    from math import gcd
    from scipy.signal import resample_poly
    g = gcd(int(to), int(sr))
    return resample_poly(np.asarray(x, np.float64), to // g, sr // g)


def load(src, sr=None, max_s=900):
    """src: caminho, bytes ou array numpy (com sr). Devolve (sinal mono float64 em 16 kHz, 16000)."""
    if isinstance(src, np.ndarray):
        if not sr: raise ValueError('Informe sr ao passar um array')
        x = src.astype(np.float64)
        if x.ndim > 1: x = x.mean(axis=1 if x.shape[1] < x.shape[0] else 0)
        x, s = x, sr
    else:
        b = src if isinstance(src, (bytes, bytearray)) else open(src, 'rb').read()
        if not b: raise ValueError('Áudio vazio')
        try: x, s = _wav_bytes(b)
        except Exception:
            try: x, s = _float_wav(b)
            except Exception: x, s = _ffmpeg(b)
    x = resample(x, s)
    x = x[:SR * max_s]
    pk = np.max(np.abs(x)) if len(x) else 0
    if pk > 0: x = x / pk * .9  # normaliza o volume (gravações baixas de celular)
    return x, SR
