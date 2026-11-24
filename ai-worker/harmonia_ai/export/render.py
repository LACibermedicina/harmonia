"""Renderização: MIDI → WAV (FluidSynth + SoundFont de piano) → MP3 (ffmpeg); MusicXML → PDF (Verovio)."""
from __future__ import annotations

import os
import subprocess
import tempfile
from pathlib import Path

SOUNDFONT = os.environ.get("SOUNDFONT", "/usr/share/sounds/sf2/FluidR3_GM.sf2")


def midi_to_wav(midi_bytes: bytes, out_wav: str, mix_audio: list[dict] | None = None) -> str:
    mid = tempfile.mktemp(suffix=".mid")
    Path(mid).write_bytes(midi_bytes)
    synth = tempfile.mktemp(suffix=".wav")
    subprocess.run(["fluidsynth", "-ni", "-g", "0.8", "-r", "44100", "-F", synth, SOUNDFONT, mid], check=True)
    if not mix_audio:
        os.replace(synth, out_wav); return out_wav
    # Mixa gravações (camadas de áudio) com o piano sintetizado: [{path, offset_s, volume}]
    cmd = ["ffmpeg", "-y", "-loglevel", "error", "-i", synth]
    filt, labels = [], ["[0:a]"]
    for i, a in enumerate(mix_audio, start=1):
        cmd += ["-i", a["path"]]
        ms = int(a.get("offset_s", 0) * 1000)
        filt.append(f"[{i}:a]adelay={ms}|{ms},volume={a.get('volume', 1.0)}[a{i}]")
        labels.append(f"[a{i}]")
    filt.append("".join(labels) + f"amix=inputs={len(labels)}:normalize=0,alimiter[out]")
    cmd += ["-filter_complex", ";".join(filt), "-map", "[out]", out_wav]
    subprocess.run(cmd, check=True)
    return out_wav


def wav_to_mp3(wav: str, mp3: str, bitrate: str = "192k") -> str:
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", wav, "-b:a", bitrate, mp3], check=True)
    return mp3


def musicxml_to_pdf(xml: str, out_pdf: str) -> str:
    import verovio  # noqa: PLC0415
    import cairosvg  # noqa: PLC0415
    from pypdf import PdfWriter, PdfReader  # noqa: PLC0415
    tk = verovio.toolkit()
    tk.setOptions({"pageWidth": 2100, "pageHeight": 2970, "scale": 40, "footer": "none",
                   "breaks": "auto", "lyricSize": 3.5})
    tk.loadData(xml)
    writer = PdfWriter()
    for p in range(1, tk.getPageCount() + 1):
        pdf_page = tempfile.mktemp(suffix=".pdf")
        cairosvg.svg2pdf(bytestring=tk.renderToSVG(p).encode(), write_to=pdf_page)
        writer.append(PdfReader(pdf_page))
    with open(out_pdf, "wb") as f:
        writer.write(f)
    return out_pdf
