"""Orquestração dos jobs de IA. Cada handler recebe `payload` e devolve um dict JSON-serializável.
Handlers leves (cifra, harmonização, melodia, MIDI/MusicXML) também são chamados de forma síncrona pela API."""
from __future__ import annotations

import base64
import os
import uuid
from pathlib import Path

from .export.midi import score_to_midi
from .export.musicxml import score_to_musicxml
from .pipelines import harmony, rhythm
from .pipelines.cifra import parse_cifra
from .theory import detect_key, key_fifths, parse_chord
import logging

log = logging.getLogger("harmonia.jobs")

MEDIA = Path(os.environ.get("MEDIA_ROOT", "/data/media"))

# ------------------------------------------------------------------ progresso
# Cada job declara suas etapas (chave, rótulo, % ao concluir). O worker instala um "reporter" que grava
# % / etapa / detalhe no Redis; a API devolve isso e a interface mostra o andamento passo a passo.
PLANS: dict[str, list[tuple[str, str, int]]] = {
    "audio_lite": [("prepare", "Preparando o áudio", 10), ("tempo", "Detectando andamento e pulso", 25),
                   ("melody", "Ouvindo a melodia (altura de cada nota)", 58), ("rhythm", "Encaixando o ritmo nos compassos", 70),
                   ("chords", "Reconhecendo os acordes", 86), ("assemble", "Montando camadas e tonalidade", 100)],
    "audio_a2s": [("prepare", "Preparando o áudio", 8), ("pitch", "Ouvindo a melodia (altura, sílabas e ornamentos)", 72),
                  ("rhythm", "Andamento, compassos e ritmo", 86), ("chords", "Tom e acordes (condução harmônica)", 96),
                  ("assemble", "Montando camadas e tonalidade", 100)],
    "audio_ml": [("prepare", "Preparando o áudio", 5), ("tempo", "Detectando andamento e pulso", 12),
                 ("separate", "Separando voz e instrumentos", 38), ("notes", "Detectando as notas (polifonia)", 56),
                 ("voice", "Transcrevendo a voz", 66), ("lyrics", "Reconhecendo a letra cantada", 78),
                 ("harmony", "Harmonia e mãos do piano", 90), ("assemble", "Montando camadas e tonalidade", 100)],
    "image": [("prepare", "Preparando a imagem", 10), ("omr", "Lendo os símbolos da partitura", 70),
              ("notes", "Convertendo em notas", 85), ("chords", "Reconhecendo os acordes", 100)],
    "export": [("prepare", "Preparando a partitura", 15), ("render", "Gerando os arquivos", 90), ("done", "Finalizando", 100)],
}
_reporter = None
_cancelled = None  # função que diz se o usuário pediu para cancelar


class Cancelled(Exception):
    """O usuário cancelou a tarefa — o worker para na próxima etapa."""


def set_cancel_check(fn) -> None:
    global _cancelled
    _cancelled = fn


def set_reporter(fn) -> None:
    global _reporter
    _reporter = fn


def step(plan: str, key: str, detail: str = "") -> None:
    """Marca o INÍCIO da etapa `key` (o % sobe até o fim da etapa anterior)."""
    if _cancelled and _cancelled():
        raise Cancelled()
    if not _reporter:
        return
    stages = PLANS[plan]
    i = next((k for k, s in enumerate(stages) if s[0] == key), 0)
    pct = stages[i - 1][2] if i else 2
    try:
        _reporter({"pct": pct, "stage": key, "label": stages[i][1], "detail": detail, "plan": plan,
                   "stages": [{"key": k, "label": lbl, "pct": pc} for k, lbl, pc in stages]})
    except Exception:  # noqa: BLE001 — progresso nunca derruba o job
        pass
COLORS = {"melody": "#ff6b9a", "harmony": "#5b8cff", "voice": "#ffb547", "bass": "#36c99a", "omr": "#a77bff"}


def _layer(kind: str, name: str, notes: list[dict], staff: str = "treble", **kw) -> dict:
    for n in notes:
        n.setdefault("id", uuid.uuid4().hex[:10])
        n.setdefault("vel", 80)
    return {"id": uuid.uuid4().hex[:8], "name": name, "kind": kind, "staff": staff, "notes": notes,
            "visible": True, "muted": False, "locked": False, "solo": False, "volume": 0.8,
            "color": COLORS.get(kind, "#888"), "program": 0, **kw}


def _measures_of(notes: list[dict], bpm: int) -> int:
    return max([int((n["start"] + n["dur"]) // bpm) + 1 for n in notes] or [1])


# ------------------------------------------------------------------ áudio
def _ml_available() -> bool:
    import importlib.util
    return all(importlib.util.find_spec(m) for m in ("librosa", "basic_pitch", "demucs"))


def _label(p: dict) -> str:
    name = (p.get("source_name") or "").rsplit(".", 1)[0][:40]
    return f" — {name}" if name else ""


def _a2s_transcribe(p: dict, wav: str) -> dict:
    """Transcrição pelo audio2score (YIN/Harvest + sílabas, ornamentos, Viterbi harmônico)."""
    from . import audio2score as a2s
    num, den = p.get("timeSig", [4, 4])
    bpm_measure = num * 4 / den
    plan = "audio_a2s"

    def prog(f: float, msg: str) -> None:
        key = "pitch" if f < 0.75 else ("rhythm" if f < 0.86 else "chords")
        step(plan, key, msg)

    r = a2s.transcribe(wav, lyrics=p.get("expected_lyrics") or None, bpm=p.get("tempo") or None,
                       meter=(int(num), int(den)), grid=0.25, chord_beats=int(max(1, bpm_measure // 2)),
                       harmony_mode="auto", progress=prog)
    d = r.d
    mode = p.get("mode", "both")
    tag = _label(p)
    layers: list[dict] = []
    mel = []
    for n in d["notas"]:
        if n["tempo"] < 0:
            continue
        note = {"pitch": int(n["midi"]), "start": float(n["tempo"]), "dur": max(0.25, float(n["duracao"])), "vel": 84}
        if n.get("silaba"):
            note["lyric"] = n["silaba"] + ("" if n.get("palavra_fim") else "-")
        orn = n.get("ornamentos") or []
        if orn:
            note["effect"] = orn[0]
        mel.append(note)
    n_measures = max(int(d.get("compassos") or 1), _measures_of(mel, bpm_measure) if mel else 1)
    if mode in ("melody", "both") and mel:
        layers.append(_layer("melody", "Melodia transcrita" + tag, mel))
    chords: list[list[dict]] = [[] for _ in range(n_measures)]
    for c in d["acordes"]:
        m = int(c["tempo"] // bpm_measure)
        if 0 <= m < n_measures:
            ch = parse_chord(c["nome"].replace("°", "dim").replace("ø", "m7b5"))
            cd = ch.to_dict() if ch else {"root": 0, "quality": "", "extensions": [], "bass": None, "symbol": c["nome"]}
            cd["symbol"] = c["nome"]
            chords[m].append({"beat": float(c["tempo"] - m * bpm_measure), "dur": float(c["duracao"]), **cd})
    if mode in ("harmony", "both") and d["acordes"]:
        acc = []
        for c in d["acordes"]:
            for k, mi in enumerate(c["midi"]):
                acc.append({"pitch": int(mi), "start": float(c["tempo"]), "dur": float(c["duracao"]), "vel": 70 if k else 76})
        layers.append(_layer("harmony", "Harmonia estimada" + tag, acc, staff="bass"))
    step(plan, "assemble", f"{len(mel)} notas · {d['tom']['nome_pt']}")
    tom = d["tom"]
    mode_k = "minor" if str(tom.get("modo", "")).startswith("men") else "major"
    return {"tempo": round(d["andamento"]), "timeSig": [num, den], "keySig": int(tom.get("fifths", key_fifths(tom["tonica"], mode_k))),
            "key": {"tonic": int(tom["tonica"]), "mode": mode_k}, "measures": n_measures, "layers": layers,
            "chords": chords, "lyricsCheck": None, "engine": "audio2score",
            "notice": f"Transcrição (audio2score, motor {d['motor_altura']}): melodia monofônica com ornamentos e "
                      f"acordes por condução harmônica. Tom estimado: {tom['nome_pt']}. Para mixagens densas, a IA completa separa as vozes."}


def job_transcribe_audio_lite(p: dict) -> dict:
    """Modo leve (sem PyTorch): melodia por YIN + acordes por cromagrama + acompanhamento de piano."""
    from .pipelines import lite_audio, ml
    step("audio_lite", "prepare", "convertendo para mono 22 kHz")
    src = str(MEDIA / p["asset"])
    trim = p.get("trim") or {}
    wav = ml.trim_audio(src, trim.get("start"), trim.get("end"), trim.get("gain_db", 0))
    if not p.get("engine_legacy"):
        try:
            return _a2s_transcribe(p, wav)
        except Cancelled:
            raise
        except Exception as e:  # noqa: BLE001 — cai para o YIN antigo
            log.warning("audio2score falhou (%s); usando YIN legado", e)
    y = lite_audio.load_audio(wav)
    step("audio_lite", "tempo", f"{len(y) / lite_audio.SR:.1f} s de áudio")
    num, den = p.get("timeSig", [4, 4])
    bpm_measure = int(num * 4 / den)
    tempo, offset = lite_audio.tempo_and_offset(y)
    if p.get("tempo"):
        tempo = float(p["tempo"])
    mode = p.get("mode", "both")
    tag = _label(p)
    layers, chords = [], []
    step("audio_lite", "melody", f"♩ = {round(tempo)}")
    events = lite_audio.melody_events(y)
    step("audio_lite", "rhythm", f"{len(events)} notas ouvidas")
    # o tempo 1 do compasso 1 não pode cair depois da primeira nota (senão ela seria descartada)
    first = min([e["start_s"] for e in events], default=offset)
    while first < offset - 0.06:
        offset -= 60.0 / tempo
    offset = max(offset, first - 60.0 / tempo * bpm_measure) if offset < 0 else offset
    mel = rhythm.seconds_to_beats(events, tempo, offset=offset)
    n_measures = max(_measures_of(mel, bpm_measure), int((len(y) / lite_audio.SR - offset) / (60 / tempo) // bpm_measure) + 1)
    if mode in ("melody", "both") and mel:
        if p.get("expected_lyrics"):
            rhythm.align_lyrics(mel, rhythm.tokenize_lyrics(p["expected_lyrics"]))
        layers.append(_layer("melody", "Melodia transcrita" + tag, mel))
    if mode in ("harmony", "both"):
        step("audio_lite", "chords", f"{n_measures} compassos")
        chords = lite_audio.chords_by_measure(y, tempo, offset, bpm_measure, n_measures, per_measure=2)
        layers.append(_layer("harmony", "Harmonia estimada" + tag, harmony.voice_chords(chords, bpm_measure, "block"), staff="bass"))
    step("audio_lite", "assemble", f"{len(mel)} notas na melodia")
    all_notes = [n for l in layers for n in l["notes"]]
    tonic, mode_k = detect_key(all_notes) if all_notes else (0, "major")
    return {"tempo": round(tempo), "timeSig": [num, den], "keySig": key_fifths(tonic, mode_k),
            "key": {"tonic": tonic, "mode": mode_k}, "measures": n_measures, "layers": layers, "chords": chords,
            "lyricsCheck": None, "engine": "lite",
            "notice": "Transcrição no modo leve: melodia monofônica e acordes estimados. Para separar voz, "
                      "transcrever polifonia e letra cantada, ative a IA completa (servidor com ≥ 8 GB de RAM)."}


def job_transcribe_audio(p: dict) -> dict:
    if not _ml_available():
        return job_transcribe_audio_lite(p)
    from .pipelines import ml
    step("audio_ml", "prepare")
    src = str(MEDIA / p["asset"])
    trim = p.get("trim") or {}
    wav = ml.trim_audio(src, trim.get("start"), trim.get("end"), trim.get("gain_db", 0))
    step("audio_ml", "tempo")
    mode = p.get("mode", "both")  # melody | harmony | both
    num, den = p.get("timeSig", [4, 4])
    bpm_measure = int(num * 4 / den)
    tempo, offset = ml.detect_tempo(wav)
    if p.get("tempo"):
        tempo = float(p["tempo"])

    layers, chords, lyrics_check = [], [], None
    stems = {}
    if p.get("separate", True):
        step("audio_ml", "separate", "Demucs: voz, baixo, bateria e outros")
        stems = ml.separate_stems(wav, str(MEDIA / "stems" / uuid.uuid4().hex))
    step("audio_ml", "notes", f"♩ = {round(tempo)}")

    accomp_src = stems.get("other", wav)
    poly = rhythm.seconds_to_beats(ml.audio_to_note_events(accomp_src), tempo, offset=offset)
    n_measures = _measures_of(poly, bpm_measure)

    if stems.get("vocals"):
        step("audio_ml", "voice", f"{len(poly)} notas no acompanhamento")
        voc = rhythm.seconds_to_beats(ml.vocal_melody_events(stems["vocals"]), tempo, offset=offset)
        if len(voc) >= 4:
            if p.get("lyrics", True):
                step("audio_ml", "lyrics", f"{len(voc)} notas na voz")
                words = ml.transcribe_lyrics(stems["vocals"], p.get("language", "pt"))
                rhythm.align_lyrics(voc, [], timed_words=words, bpm=tempo)
                if p.get("expected_lyrics"):
                    lyrics_check = rhythm.check_lyrics(p["expected_lyrics"], [w["word"] for w in words])
            layers.append(_layer("voice", "Voz", voc, audio=_rel(stems["vocals"])))
            n_measures = max(n_measures, _measures_of(voc, bpm_measure))

    if mode in ("melody", "both") and not any(l["kind"] == "voice" for l in layers):
        layers.append(_layer("melody", "Melodia (extraída)", harmony.extract_melody(poly)))
    if mode in ("harmony", "both"):
        step("audio_ml", "harmony", f"{n_measures} compassos")
        rh, lh = harmony.split_hands(poly)
        if mode == "harmony":
            layers.append(_layer("harmony", "Harmonia — mão direita", rh))
        layers.append(_layer("harmony", "Harmonia — mão esquerda", lh, staff="bass"))
        chords = harmony.transcribe_harmony(poly, n_measures, bpm_measure, per_measure=2)
    if stems.get("bass"):
        bass = rhythm.seconds_to_beats(ml.audio_to_note_events(stems["bass"]), tempo, offset=offset)
        layers.append(_layer("bass", "Baixo", harmony.extract_melody(bass, min_pitch=0), staff="bass", visible=False))

    step("audio_ml", "assemble", f"{len(layers)} camadas")
    all_notes = [n for l in layers for n in l["notes"]]
    tonic, mode_k = detect_key(all_notes)
    return {"tempo": round(tempo), "timeSig": [num, den], "keySig": key_fifths(tonic, mode_k),
            "key": {"tonic": tonic, "mode": mode_k}, "measures": n_measures, "layers": layers,
            "chords": chords, "lyricsCheck": lyrics_check, "engine": "ml",
            "stems": {k: _rel(v) for k, v in stems.items()}}


def _rel(path: str) -> str:
    return str(Path(path).relative_to(MEDIA)) if str(path).startswith(str(MEDIA)) else path


# ----------------------------------------------------------------- imagem
def job_transcribe_image(p: dict) -> dict:
    import shutil
    from .pipelines import ml
    if not shutil.which("oemer"):
        # modo leve: o programa de OMR não existe — a interface usa a leitura por IA com visão
        raise RuntimeError("OMR_LITE: leitura completa de partituras não instalada neste servidor")
    step("image", "prepare")
    step("image", "omr", "oemer: pautas, claves, cabeças de nota e hastes")
    xml = ml.sheet_image_to_musicxml(str(MEDIA / p["asset"]), p.get("crop"))
    step("image", "notes")
    parsed = ml.musicxml_to_notes(xml)
    step("image", "chords", f"{len(parsed['notes'])} notas lidas")
    rh, lh = harmony.split_hands(parsed["notes"])
    layers = [_layer("omr", "Partitura (OMR) — Sol", rh), _layer("omr", "Partitura (OMR) — Fá", lh, staff="bass")]
    num, den = parsed["timeSig"]
    bpm = int(num * 4 / den)
    return {**{k: parsed[k] for k in ("tempo", "timeSig", "keySig")},
            "measures": max(parsed["measures"], _measures_of(parsed["notes"], bpm)),
            "layers": layers, "chords": harmony.transcribe_harmony(parsed["notes"], _measures_of(parsed["notes"], bpm), bpm)}


# ------------------------------------------------------------------ cifra
def job_parse_cifra(p: dict) -> dict:
    num, den = p.get("timeSig", [4, 4])
    bpm = int(num * 4 / den)
    parsed = parse_cifra(p["text"], bpm, p.get("chords_per_measure", 1))
    chords = parsed["measures"]
    layers = [_layer("harmony", "Harmonia (cifra)", harmony.voice_chords(chords, bpm, p.get("style", "block")), staff="bass")]
    syl = rhythm.tokenize_lyrics(" ".join(l["text"] for l in parsed["lyrics"]))
    return {"measures": len(chords), "chords": chords, "layers": layers, "sections": parsed["sections"],
            "lyricsSyllables": syl, "lyrics": parsed["lyrics"]}


# ------------------------------------------------------------ harmonização
def job_harmonize(p: dict) -> dict:
    score = p["score"]
    num, den = score.get("timeSig", [4, 4])
    bpm = int(num * 4 / den)
    src_layer = next((l for l in score["layers"] if l["id"] == p.get("melodyLayer")), None) \
        or next((l for l in score["layers"] if l["kind"] in ("melody", "voice")), None)
    if not src_layer:
        raise ValueError("Nenhuma camada de melodia para harmonizar")
    melody = src_layer["notes"]
    n_measures = max(int(score.get("measures", 0)), _measures_of(melody, bpm))
    key = (p["key"]["tonic"], p["key"]["mode"]) if p.get("key") else None
    chords = harmony.harmonize(melody, n_measures, bpm, p.get("measures"), key, p.get("per_measure", 1),
                               existing=score.get("chords"))
    voiced = harmony.voice_chords(chords, bpm, p.get("style", "block"))
    return {"chords": chords, "layer": _layer("harmony", f"Harmonização ({p.get('style', 'block')})", voiced, staff="bass"),
            "measures": p.get("measures")}


def job_extract_melody(p: dict) -> dict:
    notes = [n for l in p["score"]["layers"] if l["id"] in p.get("layers", []) for n in l["notes"]] \
        or [n for l in p["score"]["layers"] if l["kind"] in ("harmony", "omr") for n in l["notes"]]
    return {"layer": _layer("melody", "Melodia (da harmonia)", harmony.extract_melody(notes))}


def job_transcribe_chords(p: dict) -> dict:
    score = p["score"]
    num, den = score.get("timeSig", [4, 4])
    bpm = int(num * 4 / den)
    notes = [n for l in score["layers"] if l.get("visible", True) and l["kind"] != "voice" for n in l["notes"]]
    return {"chords": harmony.transcribe_harmony(notes, max(score.get("measures", 1), _measures_of(notes, bpm)), bpm, 2)}


def job_lyrics(p: dict) -> dict:
    score = p["score"]
    layer = next(l for l in score["layers"] if l["id"] == p["layer"])
    notes = rhythm.align_lyrics(layer["notes"], rhythm.tokenize_lyrics(p["text"]))
    return {"layerId": layer["id"], "notes": notes}


# ---------------------------------------------------------------- exportar
def job_export(p: dict) -> dict:
    score = p["score"]
    step("export", "prepare")
    solo = [l for l in score["layers"] if l.get("solo")]
    play_layers = solo or [l for l in score["layers"] if not l.get("muted")]
    play_score = {**score, "layers": play_layers}
    out_dir = MEDIA / "exports" / uuid.uuid4().hex
    out_dir.mkdir(parents=True, exist_ok=True)
    slug = "".join(c if c.isalnum() else "-" for c in score.get("title", "harmonia")).strip("-").lower() or "harmonia"
    files: dict[str, str] = {}
    fmts = set(p.get("formats", ["mid"]))
    step("export", "render", ", ".join(sorted(p.get("formats", ["mid"]))).upper())
    midi = score_to_midi(play_score)
    xml = score_to_musicxml(score)
    if "mid" in fmts:
        (out_dir / f"{slug}.mid").write_bytes(midi); files["mid"] = f"{slug}.mid"
    if "musicxml" in fmts or "pdf" in fmts:
        (out_dir / f"{slug}.musicxml").write_text(xml, encoding="utf-8"); files["musicxml"] = f"{slug}.musicxml"
    if "pdf" in fmts:
        from .export.render import musicxml_to_pdf
        musicxml_to_pdf(xml, str(out_dir / f"{slug}.pdf")); files["pdf"] = f"{slug}.pdf"
    if fmts & {"wav", "mp3"}:
        from .export.render import midi_to_wav, wav_to_mp3
        rec = [{"path": str(MEDIA / l["audio"]), "offset_s": l.get("audioOffset", 0),
                "volume": l.get("volume", 1)} for l in play_layers if l.get("audio") and l["kind"] == "recording"]
        wav = midi_to_wav(midi, str(out_dir / f"{slug}.wav"), rec)
        if "wav" in fmts:
            files["wav"] = f"{slug}.wav"
        if "mp3" in fmts:
            wav_to_mp3(wav, str(out_dir / f"{slug}.mp3")); files["mp3"] = f"{slug}.mp3"
    step("export", "done")
    rel = out_dir.relative_to(MEDIA)
    return {"files": {k: f"/api/media/{rel}/{v}" for k, v in files.items()}}


def job_midi_inline(p: dict) -> dict:
    return {"midi_b64": base64.b64encode(score_to_midi(p["score"])).decode()}


HANDLERS = {
    "transcribe_audio": job_transcribe_audio,
    "transcribe_image": job_transcribe_image,
    "parse_cifra": job_parse_cifra,
    "harmonize": job_harmonize,
    "extract_melody": job_extract_melody,
    "transcribe_chords": job_transcribe_chords,
    "lyrics": job_lyrics,
    "export": job_export,
}
SYNC_JOBS = {"parse_cifra", "harmonize", "extract_melody", "transcribe_chords", "lyrics"}
