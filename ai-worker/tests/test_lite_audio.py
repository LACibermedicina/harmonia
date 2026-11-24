import os, subprocess, tempfile
import numpy as np
from harmonia_ai.pipelines import lite_audio
from harmonia_ai import jobs

SR = 22050


def tone(midi, dur, sr=SR, harmonics=(1, .5, .25)):
    t = np.arange(int(dur * sr)) / sr
    f = 440 * 2 ** ((midi - 69) / 12)
    y = sum(a * np.sin(2 * np.pi * f * k * t) for k, a in enumerate(harmonics, start=1))
    env = np.minimum(1, t / 0.01) * np.minimum(1, (dur - t) / 0.03)
    return y * env


def write_wav(y, path):
    y = (y / np.max(np.abs(y)) * 0.8).astype(np.float32)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ar", str(SR), "-ac", "1", "-i", "-", path], input=y.tobytes(), check=True)


def song():
    # 120 BPM: C4 E4 G4 C5 (semínimas) | acorde C maior (2 tempos) + G maior (2 tempos)
    mel = np.concatenate([tone(p, 0.5) for p in (60, 64, 67, 72, 67, 64, 62, 60)])
    acc = np.concatenate([sum(tone(p, 1.0) for p in (48, 52, 55)), sum(tone(p, 1.0) for p in (43, 47, 50)),
                          sum(tone(p, 1.0) for p in (48, 52, 55)), sum(tone(p, 1.0) for p in (43, 47, 50))])
    return mel, acc


def test_yin_melody():
    mel, _ = song()
    ev = lite_audio.melody_events(mel)
    assert [e["pitch"] for e in ev] == [60, 64, 67, 72, 67, 64, 62, 60]
    assert abs(ev[1]["start_s"] - 0.5) < 0.05


def test_chroma_chords():
    _, acc = song()
    C, times = lite_audio.chroma(acc)
    c1 = lite_audio.chord_from_chroma(C[(times > 0.1) & (times < 0.9)].sum(axis=0))
    c2 = lite_audio.chord_from_chroma(C[(times > 1.1) & (times < 1.9)].sum(axis=0))
    assert (c1.root, c1.quality) == (0, "") and (c2.root, c2.quality) == (7, "")


def test_job_lite_end_to_end(monkeypatch):
    mel, acc = song()
    media = tempfile.mkdtemp()
    write_wav(mel + 0.0 * acc[: mel.size], os.path.join(media, "a.wav"))
    monkeypatch.setattr(jobs, "MEDIA", __import__("pathlib").Path(media))
    monkeypatch.setattr(jobs, "_ml_available", lambda: False)
    r = jobs.job_transcribe_audio({"asset": "a.wav", "mode": "both", "tempo": 120, "source_name": "teste.wav"})
    assert r["engine"] == "audio2score"
    kinds = [l["kind"] for l in r["layers"]]
    assert kinds == ["melody", "harmony"]
    assert r["layers"][0]["name"].endswith("teste")
    pitches = [n["pitch"] for n in r["layers"][0]["notes"]]
    assert pitches[:4] == [60, 64, 67, 72]
    assert r["measures"] >= 1


def test_job_reports_progress(monkeypatch):
    """O job informa as etapas com % crescente — a interface mostra o andamento passo a passo."""
    mel, acc = song()
    media = tempfile.mkdtemp()
    write_wav(mel, os.path.join(media, "a.wav"))
    monkeypatch.setattr(jobs, "MEDIA", __import__("pathlib").Path(media))
    monkeypatch.setattr(jobs, "_ml_available", lambda: False)
    seen = []
    jobs.set_reporter(lambda info: seen.append(info))
    try:
        jobs.job_transcribe_audio({"asset": "a.wav", "mode": "both", "tempo": 120, "engine_legacy": True})
    finally:
        jobs.set_reporter(None)
    keys = [s["stage"] for s in seen]
    assert keys == ["prepare", "tempo", "melody", "rhythm", "chords", "assemble"]
    pcts = [s["pct"] for s in seen]
    assert pcts == sorted(pcts) and pcts[-1] < 100 and all(s["stages"] for s in seen)
    assert "notas ouvidas" in seen[3]["detail"]


def test_job_can_be_cancelled(monkeypatch):
    mel, acc = song()
    media = tempfile.mkdtemp()
    write_wav(mel, os.path.join(media, "a.wav"))
    monkeypatch.setattr(jobs, "MEDIA", __import__("pathlib").Path(media))
    monkeypatch.setattr(jobs, "_ml_available", lambda: False)
    calls = {"n": 0}
    def check():
        calls["n"] += 1
        return calls["n"] >= 3  # cancela na 3ª etapa
    jobs.set_cancel_check(check)
    try:
        import pytest
        with pytest.raises(jobs.Cancelled):
            jobs.job_transcribe_audio({"asset": "a.wav", "mode": "both", "tempo": 120})
    finally:
        jobs.set_cancel_check(None)


def test_audio2score_engine_transcribes_melody(tmp_path, monkeypatch):
    """O modo leve usa o audio2score: melodia com as alturas certas, tom e acordes por compasso."""
    import wave

    import numpy as np

    from harmonia_ai import jobs
    sr = 22050
    seq = [60, 62, 64, 65, 67, 67, 65, 64]
    y = np.concatenate([0.5 * np.sin(2 * np.pi * 440 * 2 ** ((m - 69) / 12) * np.arange(int(sr * .5)) / sr) *
                        np.minimum(1, np.minimum(np.arange(int(sr * .5)), np.arange(int(sr * .5))[::-1]) / 300) for m in seq])
    y = np.concatenate([np.zeros(sr // 4), y, np.zeros(sr // 4)])
    p = tmp_path / "m.wav"
    with wave.open(str(p), "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr)
        w.writeframes((y * 32767).astype("<i2").tobytes())
    monkeypatch.setattr(jobs, "MEDIA", tmp_path)
    r = jobs.job_transcribe_audio_lite({"asset": "m.wav", "timeSig": [4, 4], "mode": "both", "tempo": 120})
    assert r["engine"] == "audio2score"
    mel = r["layers"][0]["notes"]
    assert [n["pitch"] for n in mel][:5] == seq[:5]
    assert r["key"]["tonic"] == 0
    assert any(cell for cell in r["chords"])


def test_legacy_engine_still_available(monkeypatch):
    mel, _ = song()
    media = tempfile.mkdtemp()
    write_wav(mel, os.path.join(media, "a.wav"))
    monkeypatch.setattr(jobs, "MEDIA", __import__("pathlib").Path(media))
    r = jobs.job_transcribe_audio_lite({"asset": "a.wav", "mode": "melody", "tempo": 120, "engine_legacy": True})
    assert r["engine"] == "lite" and r["layers"][0]["notes"]
