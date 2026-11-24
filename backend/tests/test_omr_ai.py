from app.routers.ai import _pitch, omr_to_score, _json_of


def test_pitch_names():
    assert _pitch("C4") == 60 and _pitch("A4") == 69 and _pitch("Bb3") == 58 and _pitch("F#5") == 78 and _pitch("x") is None


def test_omr_json_to_layers():
    d = _json_of('```json\n{"tempo":80,"timeSig":[4,4],"keyFifths":-1,"staves":[{"clef":"G","measures":['
                 '[{"p":"r","d":1},{"p":"A4","d":0.5,"lyric":"la"},{"p":"A4","d":0.5},{"p":"G4","d":1,"tie":true},{"p":"r","d":1}],'
                 '[{"p":"G4","d":1},{"p":["C4","E4"],"d":3}]]}],"chords":[["Dm"],["C"]]}\n```')
    r = omr_to_score(d)
    notes = r["layers"][0]["notes"]
    assert r["keySig"] == -1 and r["measures"] == 2 and r["chordSymbols"] == [["Dm"], ["C"]]
    assert [n["pitch"] for n in notes] == [69, 69, 67, 67, 60, 64]  # pausa entre as duas G4: sem ligadura
    assert notes[0]["start"] == 1 and notes[0]["lyric"] == "la"


def test_omr_tie_across_barline():
    d = {"timeSig": [4, 4], "staves": [{"clef": "G", "measures": [[{"p": "r", "d": 2}, {"p": "E5", "d": 2, "tie": True}], [{"p": "E5", "d": 1}, {"p": "r", "d": 3}]]}]}
    n = omr_to_score(d)["layers"][0]["notes"]
    assert len(n) == 1 and n[0]["start"] == 2 and n[0]["dur"] == 3
