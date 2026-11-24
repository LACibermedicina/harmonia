from harmonia_ai.theory import parse_chord, chord_symbol, detect_key
from harmonia_ai.pipelines.cifra import parse_cifra
from harmonia_ai.pipelines import harmony, rhythm
from harmonia_ai.export.midi import score_to_midi
from harmonia_ai.export.musicxml import score_to_musicxml
import xml.dom.minidom


def n(p, s, d=1.0):
    return {"pitch": p, "start": s, "dur": d, "vel": 80}


def test_parse_chords_br():
    cases = {"C": (0, ""), "Am7": (9, "m7"), "G7/B": (7, "7"), "F#m7(b5)": (6, "m7b5"), "Bb7M": (10, "maj7"),
             "A7(9)": (9, "7"), "Dsus4": (2, "sus4"), "C°": (0, "dim"), "Em(maj7)": (4, "mmaj7"), "C9": (0, "7")}
    for sym, (root, q) in cases.items():
        c = parse_chord(sym)
        assert c is not None, sym
        assert (c.root, c.quality) == (root, q), (sym, c)
    assert parse_chord("G7/B").bass == 11
    assert 2 in parse_chord("C9").pcs
    assert parse_chord("Lam").root == 9  # solfejo
    assert parse_chord("hello") is None


def test_cifra_bars_and_lyrics():
    txt = "[Intro]\n| C | Am | F G7 | C |\n\nC          Am\nEu sei que vou te amar\n"
    r = parse_cifra(txt)
    assert len(r["measures"]) == 6
    assert [c["symbol"] for c in r["measures"][2]] == ["F", "G7"]
    assert r["measures"][2][1]["beat"] == 2
    assert r["lyrics"][0]["text"].startswith("Eu sei")
    assert r["sections"][0]["name"].lower() == "intro"


def test_key_and_harmonize_c_major():
    # Melodia: C E G | F A C | G B D | C
    mel = [n(72, 0), n(76, 1), n(79, 2, 2), n(77, 4), n(81, 5), n(84, 6, 2),
           n(79, 8), n(83, 9), n(86, 10, 2), n(72, 12, 4)]
    assert detect_key(mel) == (0, "major")
    ch = harmony.harmonize(mel, 4, 4)
    syms = [c[0]["symbol"] for c in ch]
    assert syms[0] == "C" and syms[1] == "F" and syms[2] in ("G", "G7") and syms[3] == "C"


def test_harmonize_only_selected_measures_keeps_context():
    mel = [n(72, 0, 4), n(77, 4, 4), n(79, 8, 4), n(72, 12, 4)]
    existing = [[{"beat": 0, "dur": 4, "root": 0, "quality": ""}], [], [], []]
    ch = harmony.harmonize(mel, 4, 4, measures=[1, 2], existing=existing)
    assert ch[0] == [] and ch[3] == []
    assert ch[1] and ch[2]


def test_voice_chords_range():
    notes = harmony.voice_chords([[{"beat": 0, "dur": 4, "root": 7, "quality": "7"}]])
    assert all(30 <= x["pitch"] <= 70 for x in notes)
    assert {x["pitch"] % 12 for x in notes} >= {7, 11, 2, 5}


def test_extract_melody_skyline():
    poly = [n(60, 0, 2), n(64, 0, 2), n(72, 0, 1), n(74, 1, 1), n(67, 2, 2)]
    mel = harmony.extract_melody(poly)
    assert [m["pitch"] for m in mel] == [72, 74, 67]


def test_recognize_chord():
    c = harmony.recognize_chord([n(55, 0, 4), n(59, 0, 4), n(62, 0, 4), n(65, 0, 4)], (0, 4))
    assert c.root == 7 and c.quality in ("7", "")


def test_syllabify_and_align():
    assert rhythm.syllabify_pt("amor") == ["a", "mor"]
    assert rhythm.syllabify_pt("canção") == ["can", "ção"]
    assert rhythm.syllabify_pt("palavra") == ["pa", "la", "vra"]
    syl = rhythm.tokenize_lyrics("meu amor")
    mel = [n(60, 0), n(62, 1), n(64, 2), n(65, 3), n(67, 4)]
    out = rhythm.align_lyrics(mel, syl)
    assert [x.get("lyric") for x in out][:3] == ["meu", "a-", "mor"]


def test_lyrics_check():
    r = rhythm.check_lyrics("eu sei que vou te amar", ["eu", "sei", "que", "vou", "te", "chamar"])
    assert r["diffs"] and r["diffs"][0]["expected"] == "amar"


def test_tempo_and_quantize():
    ons = [i * 0.5 for i in range(16)]
    assert abs(rhythm.estimate_tempo(ons) - 120) < 3 or abs(rhythm.estimate_tempo(ons) - 60) < 3 \
        or abs(rhythm.estimate_tempo(ons) - 90) < 3
    q = rhythm.seconds_to_beats([{"pitch": 60, "start_s": 0.51, "end_s": 0.98}], 120)
    assert q[0]["start"] == 1.0 and q[0]["dur"] == 1.0


SCORE = {"title": "Teste", "tempo": 96, "timeSig": [4, 4], "keySig": 0, "measures": 2,
         "chords": [[{"beat": 0, "dur": 4, "root": 0, "quality": "", "symbol": "C"}], []],
         "annotations": [{"measure": 0, "text": "dolce"}],
         "layers": [{"id": "a", "name": "Mel", "kind": "melody", "staff": "treble",
                     "notes": [n(72, 0, 1.5) | {"lyric": "a-"}, n(74, 1.5, 3.5)]},
                    {"id": "b", "name": "LH", "kind": "harmony", "staff": "bass",
                     "notes": [n(48, 0, 4), n(52, 0, 4), n(55, 0, 4)]}]}


def test_midi_bytes():
    b = score_to_midi(SCORE)
    assert b[:4] == b"MThd" and b.count(b"MTrk") == 3


def test_musicxml_valid_and_ties():
    x = score_to_musicxml(SCORE)
    xml.dom.minidom.parseString(x.encode())
    assert x.count('<measure number=') == 2
    assert '<tie type="start"/>' in x  # nota que cruza a barra
    assert "<chord/>" in x and "<harmony>" in x and "dolce" in x
