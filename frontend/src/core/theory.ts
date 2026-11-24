// Motor musical local (espelho leve do ai-worker) — permite edição didática instantânea e modo offline.
import { ChordEv, Note, uid } from "./types";

export const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
export const NAMES_FLAT = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
export const SOLFEGE = ["Dó", "Dó#", "Ré", "Ré#", "Mi", "Fá", "Fá#", "Sol", "Sol#", "Lá", "Lá#", "Si"];

const Q: Record<string, number[]> = {
  "": [0, 4, 7], m: [0, 3, 7], dim: [0, 3, 6], aug: [0, 4, 8], sus2: [0, 2, 7], sus4: [0, 5, 7],
  "6": [0, 4, 7, 9], m6: [0, 3, 7, 9], "7": [0, 4, 7, 10], maj7: [0, 4, 7, 11], m7: [0, 3, 7, 10],
  m7b5: [0, 3, 6, 10], dim7: [0, 3, 6, 9], "7sus4": [0, 5, 7, 10], mmaj7: [0, 3, 7, 11], "5": [0, 7],
};
const EXT: Record<string, number> = { b9: 13, "9": 14, "#9": 15, "11": 17, "#11": 18, b13: 20, "13": 21 };

export const pitchName = (p: number, flats = false) => (flats ? NAMES_FLAT : NAMES)[p % 12] + (Math.floor(p / 12) - 1);

function pc(n: string) {
  let b = ({ C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 } as any)[n[0].toUpperCase()];
  for (const ch of n.slice(1)) b += ch === "#" ? 1 : ch === "b" ? -1 : 0;
  return (b + 12) % 12;
}

export function parseChord(tok: string): ChordEv | null {
  const m = tok.trim().match(/^([A-G][#b]?)([^/]*)(?:\/([A-G][#b]?))?$/);
  if (!m) return null;
  const root = pc(m[1]);
  let rest = m[2];
  const exts: string[] = [];
  rest = rest.replace(/\(([^)]*)\)/g, (_, x) => { exts.push(...x.split(/[,/]/).map((s: string) => s.trim())); return ""; });
  rest = rest.replace(/[°º]/, "dim").replace("ø", "m7b5").replace(/7M|M7|7\+|Δ/, "maj7").replace(/^-/, "m").replace(/^\+/, "aug");
  let quality = "";
  for (const q of ["mmaj7", "m7b5", "7sus4", "dim7", "maj7", "sus2", "sus4", "m7", "m6", "dim", "aug", "m", "7", "6", "5"]) {
    if (rest.startsWith(q)) { quality = q; rest = rest.slice(q.length); break; }
  }
  if (quality === "m" && exts.includes("maj7")) quality = "mmaj7";
  if (quality === "m7" && exts.includes("b5")) quality = "m7b5";
  const t = rest.match(/^(b9|#9|9|#11|11|b13|13)/);
  if (t) { if (!quality) quality = "7"; else if (quality === "m") quality = "m7"; exts.push(t[1]); rest = rest.slice(t[1].length); }
  if (rest.trim()) return null;
  return { root, quality, extensions: exts.filter((e) => e in EXT), bass: m[3] ? pc(m[3]) : null, symbol: tok.trim(), beat: 0, dur: 4 };
}

export function chordPcs(c: ChordEv) {
  const s = new Set((Q[c.quality] || Q[""]).map((i) => (c.root + i) % 12));
  (c.extensions || []).forEach((e) => s.add((c.root + EXT[e]) % 12));
  return s;
}

export function symbolOf(root: number, quality: string, flats = false) {
  const q = ({ maj7: "7M", m7b5: "m7(b5)", dim: "°", dim7: "°7", aug: "+" } as any)[quality] ?? quality;
  return (flats ? NAMES_FLAT : NAMES)[root] + q;
}

/** Voicing de mão esquerda com condução de vozes. */
export function voiceChords(chords: ChordEv[][], bpm: number, style = "block"): Note[] {
  const out: Note[] = [];
  let prev: number[] | null = null;
  chords.forEach((cell, m) => cell.forEach((c) => {
    const ivs = (Q[c.quality] || Q[""]).slice(0, 4);
    const opts: number[][] = [];
    for (let inv = 0; inv < ivs.length; inv++) {
      const pcs = [...ivs.slice(inv), ...ivs.slice(0, inv)].map((i) => (c.root + i) % 12);
      let cur = 48 + ((pcs[0] - 48 + 120) % 12);
      const v: number[] = [];
      for (const p of pcs) { while (cur % 12 !== p) cur++; v.push(cur); cur++; }
      opts.push(v);
    }
    const score = (v: number[]) => (prev ? v.reduce((a, x, i) => a + Math.abs(x - (prev![i] ?? x)), 0) : Math.abs(v[0] - 52));
    const v = opts.sort((a, b) => score(a) - score(b))[0];
    prev = v;
    const bass = 36 + (((c.bass ?? c.root) - 36 + 120) % 12);
    const st = m * bpm + c.beat;
    if (style === "arpeggio") {
      const seq = [bass, ...v]; const d = c.dur / seq.length;
      seq.forEach((p, i) => out.push({ id: uid(), pitch: p, start: st + i * d, dur: d, vel: 70 }));
    } else if (style === "alberti" && v.length >= 3) {
      const pat = [v[0], v[2], v[1], v[2]];
      for (let i = 0; i < c.dur * 2; i++) out.push({ id: uid(), pitch: pat[i % 4], start: st + i / 2, dur: 0.5, vel: 66 });
    } else {
      out.push({ id: uid(), pitch: bass, start: st, dur: c.dur, vel: 76 });
      v.forEach((p) => out.push({ id: uid(), pitch: p, start: st, dur: c.dur, vel: 64 }));
    }
  }));
  return out;
}

/** Skyline: voz mais aguda = melodia principal. */
export function extractMelody(notes: Note[], minPitch = 55): Note[] {
  const ev = [...notes].filter((n) => n.pitch >= minPitch).sort((a, b) => a.start - b.start || b.pitch - a.pitch);
  const out: Note[] = [];
  for (const n of ev) {
    const last = out[out.length - 1];
    if (last && n.start < last.start + last.dur - 1e-6) {
      if (n.pitch > last.pitch) { last.dur = n.start - last.start; if (last.dur <= 1e-6) out.pop(); out.push({ ...n, id: uid() }); }
      continue;
    }
    out.push({ ...n, id: uid() });
  }
  return out;
}

/** Converte cifra em texto ("| C | Am | F G7 |") em acordes por compasso. */
export function parseCifraBars(text: string, bpm = 4): ChordEv[][] {
  const cells = text.includes("|") ? text.split(/\||\n/) : text.split(/\s+/);
  const out: ChordEv[][] = [];
  for (const cell of cells) {
    const toks = cell.trim().split(/\s+/).filter(Boolean);
    if (!toks.length) continue;
    const cs = toks.map(parseChord).filter(Boolean) as ChordEv[];
    if (!cs.length) continue;
    const step = bpm / cs.length;
    out.push(cs.map((c, k) => ({ ...c, beat: k * step, dur: step })));
  }
  return out;
}

// Armadura: quintas → acidentes
export const SHARP_ORDER = [5, 0, 7, 2, 9, 4, 11]; // F C G D A E B
export const FLAT_ORDER = [11, 4, 9, 2, 7, 0, 5];  // B E A D G C F
export const KEY_NAMES: Record<number, string> = { [-6]: "Gb", [-5]: "Db", [-4]: "Ab", [-3]: "Eb", [-2]: "Bb", [-1]: "F", 0: "C", 1: "G", 2: "D", 3: "A", 4: "E", 5: "B", 6: "F#" };
