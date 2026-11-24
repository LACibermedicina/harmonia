"""Escrita de MIDI (SMF tipo 1) sem dependências externas. Uma trilha por camada visível."""
from __future__ import annotations

import struct

PPQ = 480


def _vlq(n: int) -> bytes:
    out = [n & 0x7F]
    n >>= 7
    while n:
        out.append((n & 0x7F) | 0x80)
        n >>= 7
    return bytes(reversed(out))


def _meta_text(t: int, txt: str) -> bytes:
    b = txt.encode("utf-8")
    return bytes([0xFF, t]) + _vlq(len(b)) + b


def _track(events: list[tuple[int, int, bytes]]) -> bytes:
    events.sort(key=lambda e: (e[0], e[1]))
    data, last = b"", 0
    for tick, _, msg in events:
        data += _vlq(tick - last) + msg
        last = tick
    data += b"\x00\xFF\x2F\x00"
    return b"MTrk" + struct.pack(">I", len(data)) + data


def score_to_midi(score: dict) -> bytes:
    tempo = int(score.get("tempo", 100))
    num, den = score.get("timeSig", [4, 4])
    conductor = [
        (0, 0, _meta_text(0x03, score.get("title", "harmonIA"))),
        (0, 0, b"\xFF\x51\x03" + struct.pack(">I", int(60_000_000 / tempo))[1:]),
        (0, 0, b"\xFF\x58\x04" + bytes([num, {1: 0, 2: 1, 4: 2, 8: 3, 16: 4}[den], 24, 8])),
        (0, 0, b"\xFF\x59\x02" + struct.pack(">bB", int(score.get("keySig", 0)), 0)),
    ]
    tracks = [_track(conductor)]
    ch = 0
    for layer in score.get("layers", []):
        if layer.get("muted") or not layer.get("notes"):
            continue
        c = 9 if layer.get("kind") == "percussion" else ch
        program = int(layer.get("program", 0))  # 0 = Acoustic Grand Piano
        evs: list[tuple[int, int, bytes]] = [
            (0, 0, _meta_text(0x03, layer.get("name", "camada"))),
            (0, 0, bytes([0xC0 | c, program])),
            (0, 0, bytes([0xB0 | c, 7, int(max(0, min(1, layer.get("volume", 0.8))) * 127)])),
        ]
        for n in layer["notes"]:
            on = int(round(n["start"] * PPQ))
            off = int(round((n["start"] + n["dur"]) * PPQ))
            p = max(0, min(127, int(n["pitch"])))
            if n.get("lyric") and n["lyric"] != "_":
                evs.append((on, 0, _meta_text(0x05, n["lyric"])))
            evs.append((on, 2, bytes([0x90 | c, p, max(1, min(127, int(n.get("vel", 80))))])))
            evs.append((off, 1, bytes([0x80 | c, p, 0])))
        tracks.append(_track(evs))
        ch = (ch + 1) % 16
        if ch == 9:
            ch = 10
    header = b"MThd" + struct.pack(">IHHH", 6, 1, len(tracks), PPQ)
    return header + b"".join(tracks)
