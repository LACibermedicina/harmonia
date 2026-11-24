"""Reconhecimento da letra com o tempo de cada palavra (opcional): faster-whisper local, CPU int8.
pip install faster-whisper   ·   modelos: tiny, base (padrão), small, medium, large-v3
"""
import re, threading, time
import numpy as np

_W = {'model': None, 'name': None, 'last': 0}
_WLOCK = threading.Lock()
def whisper_words(x16, model_name='base', root=None, progress=None, language='pt'):
    from faster_whisper import WhisperModel
    with _WLOCK:
        if _W['model'] is None or _W['name'] != model_name:
            if progress: progress(.12, 'Carregando o reconhecimento de voz (%s)' % model_name)
            _W['model'] = WhisperModel(model_name, device='cpu', compute_type='int8', cpu_threads=1, download_root=root)
            _W['name'] = model_name
        _W['last'] = time.time(); mdl = _W['model']
    segs, info = mdl.transcribe(np.asarray(x16, np.float32), language=language or None, word_timestamps=True, vad_filter=True,
                                beam_size=2, condition_on_previous_text=False, initial_prompt='Letra de música cantada.' if language != 'pt' else 'Letra de música cantada em português.')
    words = []; dur = len(x16) / 16000.0
    for s in segs:
        if progress: progress(.15 + .45 * min(1, s.end / max(1, dur)), 'Reconhecendo a letra · %d:%02d' % (int(s.end) // 60, int(s.end) % 60))
        for w in (s.words or []):
            tx = w.word.strip()
            if re.sub('[^A-Za-zÀ-ÿ]', '', tx): words.append({'w': tx, 'start': round(float(w.start), 3), 'end': round(float(w.end), 3), 'p': round(float(w.probability), 2)})
    return words, info.language
def whisper_idle(sec=600):
    if _W['model'] is not None and time.time() - _W['last'] > sec:
        with _WLOCK: _W['model'] = None; _W['name'] = None
        import gc; gc.collect()



def available():
    try:
        import faster_whisper  # noqa
        return True
    except Exception:
        return False
