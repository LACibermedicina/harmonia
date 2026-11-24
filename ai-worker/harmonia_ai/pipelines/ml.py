"""Wrappers dos modelos de IA (importação tardia: o núcleo roda e é testável sem eles).

- Áudio → notas polifônicas: Spotify Basic Pitch (ONNX/TF-lite)
- Separação de fontes (voz / acompanhamento / baixo / bateria): Demucs htdemucs
- Melodia vocal monofônica + efeitos (vibrato, glissando): torchcrepe/pyin (librosa)
- Letra cantada com tempos por palavra: faster-whisper
- Foto de partitura → MusicXML (OMR): oemer
- Áudio: tempo/beat com librosa
"""
from __future__ import annotations

import os
import subprocess
import tempfile
from pathlib import Path

MODELS = Path(os.environ.get("MODELS_DIR", "/data/models"))


def trim_audio(src: str, start: float | None, end: float | None, gain_db: float = 0.0) -> str:
    """Recorte/normalização opcional antes do processamento (ffmpeg)."""
    out = tempfile.mktemp(suffix=".wav")
    cmd = ["ffmpeg", "-y", "-loglevel", "error"]
    if start:
        cmd += ["-ss", str(start)]
    cmd += ["-i", src]
    if end:
        cmd += ["-t", str(end - (start or 0))]
    af = ["aresample=22050"]
    if gain_db:
        af.append(f"volume={gain_db}dB")
    cmd += ["-ac", "1", "-af", ",".join(af), out]
    subprocess.run(cmd, check=True)
    return out


def separate_stems(src: str, out_dir: str) -> dict[str, str]:
    import demucs.separate  # noqa: PLC0415
    demucs.separate.main(["-n", "htdemucs", "-o", out_dir, "--mp3", src])
    base = Path(out_dir) / "htdemucs" / Path(src).stem
    return {k: str(base / f"{k}.mp3") for k in ("vocals", "bass", "drums", "other")}


def audio_to_note_events(src: str, onset_threshold: float = 0.5, min_note_ms: float = 80) -> list[dict]:
    from basic_pitch.inference import predict  # noqa: PLC0415
    _, _, events = predict(src, onset_threshold=onset_threshold, minimum_note_length=min_note_ms)
    return [{"start_s": float(s), "end_s": float(e), "pitch": int(p), "vel": int(min(127, a * 127))}
            for s, e, p, a, *_ in events]


def vocal_melody_events(src: str) -> list[dict]:
    """Melodia da voz via pYIN, com detecção de vibrato e glissando por contorno de f0."""
    import librosa  # noqa: PLC0415
    import numpy as np  # noqa: PLC0415
    y, sr = librosa.load(src, sr=22050, mono=True)
    f0, voiced, _ = librosa.pyin(y, fmin=70, fmax=1100, sr=sr, frame_length=2048)
    hop = 512 / sr
    midi = librosa.hz_to_midi(np.where(voiced, f0, np.nan))
    events, cur = [], None
    for i, m in enumerate(midi):
        t = i * hop
        if np.isnan(m):
            if cur:
                events.append(cur); cur = None
            continue
        r = int(round(m))
        if cur and abs(r - cur["pitch"]) == 0:
            cur["end_s"] = t + hop; cur["_f"].append(m)
        else:
            if cur:
                events.append(cur)
            cur = {"start_s": t, "end_s": t + hop, "pitch": r, "vel": 90, "_f": [m]}
    if cur:
        events.append(cur)
    out = []
    for e in events:
        f = np.array(e.pop("_f"))
        if e["end_s"] - e["start_s"] < 0.07:
            continue
        if len(f) > 12 and np.std(f - np.convolve(f, np.ones(9) / 9, "same")) > 0.18:
            e["effect"] = "vibrato"
        elif len(f) > 6 and abs(f[-1] - f[0]) > 0.8:
            e["effect"] = "glissando"
        out.append(e)
    return out


def detect_tempo(src: str) -> tuple[float, float]:
    import librosa  # noqa: PLC0415
    y, sr = librosa.load(src, sr=22050, mono=True)
    tempo, beats = librosa.beat.beat_track(y=y, sr=sr)
    first = float(librosa.frames_to_time(beats[0], sr=sr)) if len(beats) else 0.0
    return float(tempo if not hasattr(tempo, "__len__") else tempo[0]), first


def transcribe_lyrics(src: str, language: str | None = "pt") -> list[dict]:
    from faster_whisper import WhisperModel  # noqa: PLC0415
    model = WhisperModel("small", device="cpu", compute_type="int8", download_root=str(MODELS / "whisper"))
    segs, _ = model.transcribe(src, language=language, word_timestamps=True, vad_filter=True)
    return [{"word": w.word.strip(), "start": w.start, "end": w.end} for s in segs for w in (s.words or [])]


def sheet_image_to_musicxml(img: str, crop: dict | None = None) -> str:
    """OMR. crop = {x,y,w,h} em fração da imagem (recorte feito no frontend é reaplicado aqui)."""
    from PIL import Image  # noqa: PLC0415
    src = img
    if crop:
        im = Image.open(img)
        W, H = im.size
        im = im.crop((int(crop["x"] * W), int(crop["y"] * H),
                      int((crop["x"] + crop["w"]) * W), int((crop["y"] + crop["h"]) * H)))
        src = tempfile.mktemp(suffix=".png"); im.save(src)
    out_dir = tempfile.mkdtemp()
    subprocess.run(["oemer", "-o", out_dir, src], check=True)
    xml = next(Path(out_dir).glob("*.musicxml"))
    return xml.read_text(encoding="utf-8")


def musicxml_to_notes(xml_text: str) -> dict:
    """MusicXML → {tempo, timeSig, keySig, notes[], measures} via music21."""
    from music21 import converter, tempo as m21tempo  # noqa: PLC0415
    s = converter.parseData(xml_text, format="musicxml")
    notes = []
    for el in s.flatten().notes:
        for p in (el.pitches if el.isChord else [el.pitch]):
            notes.append({"pitch": int(p.midi), "start": float(el.offset), "dur": float(el.quarterLength),
                          "vel": 80, "lyric": el.lyric or None})
    ts = s.recurse().getElementsByClass("TimeSignature")
    ks = s.recurse().getElementsByClass("KeySignature")
    mm = s.recurse().getElementsByClass(m21tempo.MetronomeMark)
    return {"notes": notes,
            "timeSig": [ts[0].numerator, ts[0].denominator] if ts else [4, 4],
            "keySig": ks[0].sharps if ks else 0,
            "tempo": float(mm[0].number) if mm and mm[0].number else 100,
            "measures": len(s.parts[0].getElementsByClass("Measure")) if s.parts else 0}
