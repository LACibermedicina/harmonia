"""audio2score — transcrição de áudio para partitura (melodia, letra, ornamentos e harmonia).

Módulo independente extraído do MelodIA Orquestra.

    from audio2score import transcribe
    r = transcribe('gravacao.m4a', lyrics='Canta a vida com alegria')   # ou asr=True (faster-whisper)
    r.save('saida/')            # partitura.musicxml, melodia.mid, transcricao.json
    xml = r.musicxml(); mid = r.midi(); dados = r.json()
"""
import json as _json, os, time
import numpy as np
from . import audio, pitch, melody, rhythm, harmony, musicxml, midi, asr as _asr

__version__ = '1.0.0'
NOMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']


class Result:
    def __init__(self, d): self.d = d

    def json(self):
        """Dicionário pronto para JSON (sem os campos internos)."""
        d = {k: v for k, v in self.d.items() if k not in ('notas_q', 'acordes_q')}
        return d

    def musicxml(self, title=None, composer=None): return musicxml.build(self.d, title, composer)

    def midi(self, **kw): return midi.build(self.d, **kw)

    def save(self, folder, base=None):
        os.makedirs(folder, exist_ok=True); base = base or 'transcricao'
        paths = {'musicxml': os.path.join(folder, base + '.musicxml'), 'midi': os.path.join(folder, base + '.mid'), 'json': os.path.join(folder, base + '.json')}
        open(paths['musicxml'], 'w', encoding='utf-8').write(self.musicxml())
        open(paths['midi'], 'wb').write(self.midi())
        open(paths['json'], 'w', encoding='utf-8').write(_json.dumps(self.json(), ensure_ascii=False, indent=1))
        return paths

    def __getitem__(self, k): return self.d[k]


def _nome(m):
    return NOMES[m % 12] + str(m // 12 - 1)


def transcribe(src, sr=None, lyrics=None, words=None, asr=False, asr_model='base', language='pt', engine='auto',
               bpm=None, meter=(4, 4), grid=.25, chord_beats=2, harmony_mode='auto', title=None, vocables=False,
               fmin=65.0, fmax=1000.0, max_seconds=900, detail='simples', progress=None, pw=None):
    """Transcreve um áudio (caminho, bytes ou array) para partitura.

    lyrics: letra digitada (opcional) — encaixada nas sílabas cantadas.
    words: [{'w','start','end'}] — palavras com tempo vindas de outro reconhecedor (opcional).
    asr: reconhece a letra com faster-whisper (pip install faster-whisper).
    engine: 'auto' (Harvest se o pyworld estiver instalado; senão YIN), 'harvest' ou 'yin'.
    bpm: força o andamento; meter: (tempos, figura) — ex.: (3, 4); grid: menor figura em tempos (.25 = semicolcheia).
    chord_beats: um acorde a cada N tempos (2 = meio compasso em 4/4; 4 = compasso inteiro).
    harmony_mode: 'auto' (melodia + áudio), 'melodia', 'audio' ou None (sem harmonia).
    vocables: True escreve sons sem letra como sílabas neutras (hm, ô, tá); padrão False (sem texto).
    detail: 'simples' (padrão: inflexões curtas dentro da mesma sílaba viram parte da nota principal, leitura fácil)
            ou 'completo' (cada patamar de altura vira nota — para análise fina).
    progress: função(fração 0..1, mensagem).
    """
    t0 = time.time(); P = progress or (lambda f, m: None)
    P(.02, 'Lendo o áudio')
    x, fs = audio.load(src, sr, max_s=max_seconds)
    dur = len(x) / fs
    if dur < .5: raise ValueError('Áudio curto demais (mínimo 0,5 s)')
    asr_name, asr_err = '', ''
    if asr and not words:
        try:
            words, _ = _asr.whisper_words(x.astype(np.float32), asr_model, os.environ.get('A2S_MODELS'), lambda f, m: P(.05 + f * .5, m), language)
            asr_name = 'faster-whisper-' + asr_model
        except Exception as e:
            asr_err = str(e)[:200]
    P(.58, 'Medindo a altura')
    t, m, edb, eng = pitch.track(x, fs, engine, fmin, fmax, pw=pw)
    P(.72, 'Separando sílabas, notas e ornamentos')
    notes, segs = melody.extract_notes(m, edb, t)
    if not notes: raise ValueError('Não encontrei melodia no áudio (muito baixo, ruído ou sem altura definida)')
    if words: notes = melody.vocables(melody.align(notes, words))
    elif lyrics: notes = melody.align_text(notes, lyrics)
    else:
        notes = melody.vocables(melody.align(notes, []))
    if not vocables:
        for n in notes:
            if n['kind'] == 'efeito': n['s'] = ''
    if detail == 'simples':
        out = []
        for n in notes:
            L = out[-1] if out else None
            # harmonIA: passos de semitom com duração real (≥ 0,2 s) são notas, não inflexão
            if L and n['seg'] == L['seg'] and not n.get('s') and (n['d'] < .2 or n['m'] == L['m']):
                L['d'] = round(n['t'] + n['d'] - L['t'], 3)
                L['orn'] = list(dict.fromkeys(L['orn'] + [o for o in n['orn'] if o == 'vib']))
                continue
            out.append(dict(n))
        notes = out
    for i, n in enumerate(notes):
        n['_melisma'] = bool(n.get('s')) and i + 1 < len(notes) and notes[i + 1]['kind'] == 'melisma' and notes[i + 1]['seg'] == n['seg']
    P(.8, 'Andamento e compassos')
    sel = [n for n in notes if n['first'] or n['kind'] != 'melisma']
    on = [n['t'] for n in sel]; ow = [min(1.0, n['d']) + (.5 if n.get('kind') == 'silaba' else 0) for n in sel]
    est_bpm, phase = rhythm.tempo(on, weights=ow)
    use_bpm = float(bpm) if bpm else est_bpm
    if bpm: _, phase = rhythm.tempo(on, use_bpm - .01, use_bpm + .01, weights=ow); use_bpm = float(bpm)
    beats = meter[0] * (4 / meter[1])
    q, bars, lead = rhythm.quantize(notes, use_bpm, phase, grid, beats)
    med = float(np.median([n['m'] for n in q]))
    P(.88, 'Tom e harmonia')
    pcw = harmony.melody_pc(q); ctc = None
    if harmony_mode in ('auto', 'audio'):
        ctc = harmony.chroma(x, fs)
        cw = ctc[1].sum(axis=0); cw = cw / (cw.sum() + 1e-9) * pcw.sum()
        pcw = pcw + (.5 if harmony_mode == 'auto' else 2) * cw
    key, conf = harmony.estimate_key(pcw)
    ch = harmony.chords(q, key, use_bpm, lead, beats, chord_beats, ctc if harmony_mode in ('auto', 'audio') else None,
                        .35 if harmony_mode == 'auto' else 1.5) if harmony_mode else []
    if bars and ch:
        tot = bars * beats  # acordes até o fim do último compasso
        ch = [c for c in ch if c['b'] < tot]
        if ch: ch[-1]['q'] = tot - ch[-1]['b']
    spb = 60 / use_bpm
    notas = [{'inicio_s': round(lead + n['b'] * spb, 3), 'dur_s': round(n['q'] * spb, 3), 'audio_inicio_s': n['t'], 'audio_dur_s': n['d'],
              'tempo': n['b'], 'duracao': n['q'], 'compasso': int(n['b'] // beats) + 1, 'midi': n['m'], 'nota': _nome(n['m']), 'altura_fina': n.get('mf'),
              'silaba': n.get('s', ''), 'tipo': n.get('kind'), 'palavra_inicio': bool(n.get('wi')), 'palavra_fim': bool(n.get('wf')),
              'ornamentos': [o for o in n.get('orn', []) if o != 'grace'], 'notas_de_graca': [int(g) for g in n.get('grace', [])],
              'silaba_cantada': n['seg']} for n in q]
    acordes = [{'tempo': c['b'], 'duracao': c['q'], 'compasso': int(c['b'] // beats) + 1, 'inicio_s': round(lead + c['b'] * spb, 3),
                'nome': c['nome'], 'funcao': c['func'], 'fundamental': NOMES[c['root']], 'qualidade': c['qual'] or 'maior',
                'notas': [_nome(v) for v in c['vozes']], 'baixo': _nome(c['baixo']), 'midi': [c['baixo']] + c['vozes']} for c in ch]
    st = {k: sum(1 for n in q if n['kind'] == k) for k in ('silaba', 'melisma', 'efeito')}
    st['ornamentos'] = sum(len(n['orn']) for n in q); st['silabas_cantadas'] = len(segs)
    letra = ' '.join(w['w'] for w in words) if words else (lyrics or '')
    d = {'versao': __version__, 'titulo': title or '', 'duracao_s': round(dur, 2), 'motor_altura': eng, 'reconhecimento_letra': asr_name or ('texto informado' if lyrics else ''),
         'erro_reconhecimento': asr_err, 'andamento': use_bpm, 'andamento_estimado': est_bpm, 'compasso': [meter[0], meter[1]], 'grade': grid,
         'inicio_compasso_1_s': round(lead, 3), 'compassos': bars, 'tom': dict(key, confianca=round(conf, 3)),
         'extensao': [_nome(min(n['m'] for n in q)), _nome(max(n['m'] for n in q))], 'letra': letra, 'palavras': words or [],
         'notas': notas, 'acordes': acordes, 'estatisticas': st, 'detalhe': detail, 'tempo_processamento_s': round(time.time() - t0, 2),
         'clave_oitava': med < 60, 'notas_q': q, 'acordes_q': ch}
    P(1, 'Pronto')
    return Result(d)


def transcribe_to_files(src, folder, **kw):
    r = transcribe(src, **kw)
    return r, r.save(folder)
