// Estudo multi-instrumentos sobre o tema principal:
//  • adicionar instrumento (dobra a melodia, faz o baixo, os acordes ou um arpejo) na extensão dele;
//  • estudo de ARPEJOS do instrumento em foco sobre a harmonia (escrita ou recomendada);
//  • PROPOSTA DE SOLO que reaproveita o motivo rítmico do tema e as notas dos acordes;
//  • ORNAMENTOS (mordente, trilo, grupeto, apojatura, notas de passagem) aplicados a uma cópia do tema.
// Tudo entra como camada NOVA (grupo “Estudo”), com o timbre do instrumento — nada do original é alterado.
import { store, newLayer } from "./store";
import { Note, Score, ChordEv, uid } from "./types";
import { instrument, Instrument } from "./instruments";
import { analyze, Analysis } from "./analysis";

const bpmOf = (s: Score) => (s.timeSig[0] * 4) / s.timeSig[1];
const Q: Record<string, number[]> = { "": [0, 4, 7], m: [0, 3, 7], dim: [0, 3, 6], "°": [0, 3, 6], aug: [0, 4, 8], "7": [0, 4, 7, 10], maj7: [0, 4, 7, 11], m7: [0, 3, 7, 10], m7b5: [0, 3, 6, 10], sus4: [0, 5, 7], sus2: [0, 2, 7] };
const pcsOf = (c: ChordEv) => (Q[c.quality] ?? Q[""]).map((i) => (c.root + i) % 12);

/** Linha do tempo dos acordes (absoluta, em tempos). */
export function chordLine(s: Score, a: Analysis): { start: number; dur: number; c: ChordEv }[] {
  const bpm = bpmOf(s);
  return a.chords.flatMap((cell, m) => (cell || []).map((c) => ({ start: m * bpm + c.beat, dur: c.dur, c })));
}
const inRange = (p: number, r: [number, number]) => p >= r[0] && p <= r[1];
/** Leva a altura para dentro da extensão do instrumento (por oitavas). */
function fit(p: number, r: [number, number]) { while (p < r[0]) p += 12; while (p > r[1]) p -= 12; return p; }
/** Região confortável (terço central da extensão). */
const comfy = (r: [number, number]): [number, number] => { const w = r[1] - r[0]; return [Math.round(r[0] + w * 0.25), Math.round(r[0] + w * 0.7)]; };

function pushLayer(name: string, inst: Instrument, notes: Note[], kind: "voice" | "harmony" | "melody" = "voice", group = "estudo") {
  const med = notes.length ? notes.map((n) => n.pitch).sort((a, b) => a - b)[Math.floor(notes.length / 2)] : 60;
  const l = newLayer(kind, `${inst.icon} ${name}`, med < 55 ? "bass" : "treble");
  l.notes = notes; l.instrument = inst.id; l.program = inst.program; l.group = group;
  store.mutate((s) => {
    if (!(s.layerGroups || []).some((g) => g.id === group)) s.layerGroups = [...(s.layerGroups || []), { id: group, name: "🎓 Estudo", color: "#f39c12" }];
    s.layers.push(l); store.selectedLayer = l.id;
  }, "study");
  return l;
}

// ------------------------------------------------------------------ multi-instrumentos
export type Role = "melodia" | "baixo" | "acordes" | "arpejo" | "contracanto";
export function addInstrument(instId: string, role: Role) {
  const s = store.score, a = analyze(s), inst = instrument(instId), bpm = bpmOf(s);
  const r = inst.range, cz = comfy(r);
  let notes: Note[] = [];
  if (role === "melodia" && a.theme) {
    const med = a.theme.notes.map((n) => n.pitch).sort((x, y) => x - y)[Math.floor(a.theme.notes.length / 2)];
    const shift = Math.round(((cz[0] + cz[1]) / 2 - med) / 12) * 12;
    notes = a.theme.notes.map((n) => ({ ...n, id: uid(), pitch: fit(n.pitch + shift, r) }));
  } else if (role === "baixo") {
    for (const { start, dur, c } of chordLine(s, a)) {
      const root = fit(36 + c.root, [Math.max(r[0], 28), Math.min(r[1], 55)]);
      notes.push({ id: uid(), pitch: root, start, dur: Math.min(dur, bpm / 2 >= 1 ? dur : dur), vel: 82 });
    }
  } else if (role === "acordes") {
    for (const { start, dur, c } of chordLine(s, a)) for (const pc of pcsOf(c).slice(0, 3)) notes.push({ id: uid(), pitch: fit(cz[0] + ((pc - cz[0]) % 12 + 12) % 12, r), start, dur, vel: 64 });
  } else if (role === "contracanto" && a.theme) {
    // terça (ou sexta) diatônica abaixo do tema, sempre consonante com o acorde
    const sc = a.scale;
    for (const n of a.theme.notes) {
      const deg = sc.indexOf(n.pitch % 12);
      let p = deg >= 0 ? n.pitch - ((n.pitch % 12) - sc[(deg + 5) % 7] + 12) % 12 : n.pitch - 3;
      p = fit(p, r); notes.push({ ...n, id: uid(), pitch: p, vel: 66 });
    }
  } else return arpeggios(instId, { pattern: "up", sub: 0.5, octaves: 1 });
  return pushLayer(`${inst.name} — ${role}`, inst, notes, role === "baixo" || role === "acordes" ? "harmony" : "voice");
}

// ------------------------------------------------------------------ arpejos
export type ArpPattern = "up" | "down" | "updown" | "alberti" | "broken";
export const ARP_LABEL: Record<ArpPattern, string> = { up: "ascendente", down: "descendente", updown: "sobe e desce", alberti: "baixo de Alberti", broken: "quebrado (1-5-3-5)" };
export function arpeggios(instId: string, o: { pattern: ArpPattern; sub: number; octaves: 1 | 2 }) {
  const s = store.score, a = analyze(s), inst = instrument(instId);
  const r = inst.range, cz = comfy(r);
  const notes: Note[] = [];
  for (const { start, dur, c } of chordLine(s, a)) {
    const base = fit(cz[0] + ((c.root - cz[0]) % 12 + 12) % 12, r);
    const tones: number[] = [];
    const ivs = (Q[c.quality] ?? Q[""]);
    for (let o2 = 0; o2 < o.octaves; o2++) for (const iv of ivs) tones.push(base + iv + 12 * o2);
    tones.push(base + 12 * o.octaves);
    const ok = tones.filter((p) => inRange(p, r));
    let seq: number[];
    if (o.pattern === "down") seq = [...ok].reverse();
    else if (o.pattern === "updown") seq = [...ok, ...ok.slice(1, -1).reverse()];
    else if (o.pattern === "alberti") seq = [ok[0], ok[2] ?? ok[1], ok[1], ok[2] ?? ok[1]];
    else if (o.pattern === "broken") seq = [ok[0], ok[2] ?? ok[1], ok[1], ok[2] ?? ok[1]].map((p, i) => (i === 2 ? p : p));
    else seq = ok;
    let k = 0;
    for (let t = start; t < start + dur - 1e-6; t += o.sub, k++) notes.push({ id: uid(), pitch: seq[k % seq.length], start: t, dur: o.sub, vel: k % (Math.round(1 / o.sub)) === 0 ? 84 : 68 });
  }
  return pushLayer(`${inst.name} — arpejos ${ARP_LABEL[o.pattern]}`, inst, notes, "voice");
}

// ------------------------------------------------------------------ solo
let seed = 1;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
export function soloProposal(instId: string, o: { density: "calmo" | "médio" | "virtuoso"; useMotive: boolean; seed?: number }) {
  const s = store.score, a = analyze(s), inst = instrument(instId), bpm = bpmOf(s);
  seed = o.seed ?? (Date.now() % 100000) + 1;
  const r = inst.range, cz = comfy(r);
  const line = chordLine(s, a);
  const sc = a.scale;
  const total = Math.max(...line.map((x) => x.start + x.dur), s.measures * bpm);
  // ritmo: o motivo rítmico do tema (se houver) ou uma grade pela densidade
  const motiveOn = a.motive && o.useMotive ? a.motive.signature.split(",").map(Number) : null;
  const grid = o.density === "calmo" ? 1 : o.density === "médio" ? 0.5 : 0.25;
  const onsets: number[] = [];
  for (let m = 0; m * bpm < total; m++) {
    const rest = m % 4 === 3 && o.density !== "virtuoso"; // respira no fim de cada frase
    const pat = motiveOn && (m % 2 === 0 || o.density === "calmo") ? motiveOn : Array.from({ length: Math.round(bpm / grid) }, (_, i) => i * grid).filter((x, i) => i === 0 || rnd() < (o.density === "calmo" ? 0.45 : o.density === "médio" ? 0.7 : 0.9));
    for (const x of pat) if (!rest || x < bpm / 2) onsets.push(m * bpm + x);
  }
  const chordAt = (t: number) => line.find((x) => t >= x.start - 1e-6 && t < x.start + x.dur - 1e-6)?.c;
  const notes: Note[] = [];
  let prev = Math.round((cz[0] + cz[1]) / 2);
  for (let i = 0; i < onsets.length; i++) {
    const t = onsets[i], end = i + 1 < onsets.length ? Math.min(onsets[i + 1], t + bpm) : Math.min(total, t + 1);
    const c = chordAt(t); const strong = Math.abs((t % 1)) < 1e-6;
    const pool = strong && c ? pcsOf(c) : sc;
    // candidatas próximas da nota anterior (movimento por grau ou salto pequeno para nota do acorde)
    const cands: number[] = [];
    for (let p = prev - 7; p <= prev + 7; p++) if (pool.includes(((p % 12) + 12) % 12) && inRange(p, r) && p !== prev) cands.push(p);
    if (!cands.length) cands.push(fit(prev, r));
    const w = cands.map((p) => { const d = Math.abs(p - prev); const center = Math.abs(p - (cz[0] + cz[1]) / 2) / 12; return (d <= 2 ? 3 : d <= 4 ? 1.6 : 0.6) * (1 - center * 0.6); });
    let x = rnd() * w.reduce((u, v) => u + v, 0), pick = cands[0];
    for (let k = 0; k < cands.length; k++) { x -= w[k]; if (x <= 0) { pick = cands[k]; break; } }
    // fim de frase: resolve em nota do acorde
    if ((i + 1 < onsets.length && Math.floor(onsets[i + 1] / bpm) % 4 === 0 && Math.floor(t / bpm) % 4 === 3) && c) pick = cands.find((p) => pcsOf(c).includes(p % 12)) ?? pick;
    notes.push({ id: uid(), pitch: pick, start: t, dur: Math.max(0.25, end - t), vel: strong ? 86 : 72 });
    prev = pick;
  }
  return pushLayer(`${inst.name} — proposta de solo (${o.density}${motiveOn && o.useMotive ? ", com o motivo" : ""})`, inst, notes, "voice");
}

// ------------------------------------------------------------------ ornamentos
export type Orn = "mordente" | "trilo" | "grupeto" | "apojatura" | "passagem";
export const ORN_LABEL: Record<Orn, string> = { mordente: "mordente", trilo: "trilo", grupeto: "grupeto", apojatura: "apojatura", passagem: "notas de passagem" };
export function ornament(instId: string, kinds: Orn[], amount: number) {
  const s = store.score, a = analyze(s), inst = instrument(instId);
  if (!a.theme) return null;
  const sc = a.scale, r = inst.range;
  const step = (p: number, dir: 1 | -1) => { for (let k = 1; k <= 2; k++) { const q = p + dir * k; if (sc.includes(((q % 12) + 12) % 12)) return q; } return p + dir; };
  const src = [...a.theme.notes].sort((x, y) => x.start - y.start);
  const med = src.map((n) => n.pitch).sort((x, y) => x - y)[Math.floor(src.length / 2)];
  const cz = comfy(r); const shift = Math.round(((cz[0] + cz[1]) / 2 - med) / 12) * 12;
  const out: Note[] = [];
  let k = 0;
  const g = 0.125; // fusa/semicolcheia rápida (meio de semicolcheia)
  src.forEach((n0, i) => {
    const n = { ...n0, pitch: fit(n0.pitch + shift, r) };
    const strong = Math.abs(n.start % 1) < 1e-6, long = n.dur >= 1;
    const nx = src[i + 1] ? fit(src[i + 1].pitch + shift, r) : null;
    const want = (o: Orn) => kinds.includes(o) && ((k++ * 0.618) % 1) < amount;
    const add = (p: number, st: number, d: number, eff?: string) => out.push({ id: uid(), pitch: p, start: st, dur: d, vel: n.vel ?? 80, ...(eff ? { effect: eff } : {}) });
    if (long && want("trilo")) {
      const up = step(n.pitch, 1); let t = n.start, j = 0;
      while (t < n.start + n.dur - 0.25 - 1e-6) { add(j % 2 ? up : n.pitch, t, g, j === 0 ? "trilo" : undefined); t += g; j++; }
      add(n.pitch, t, n.start + n.dur - t); return;
    }
    if (long && strong && want("grupeto")) {
      const q = Math.min(0.25, n.dur / 8);
      [step(n.pitch, 1), n.pitch, step(n.pitch, -1)].forEach((p, j) => add(p, n.start + j * q, q, j === 0 ? "grupeto" : undefined));
      add(n.pitch, n.start + 3 * q, n.dur - 3 * q); return;
    }
    if (strong && n.dur >= 0.5 && want("apojatura")) {
      const half = n.dur / 2; add(step(n.pitch, nx !== null && nx < n.pitch ? 1 : -1), n.start, half, "apojatura"); add(n.pitch, n.start + half, half); return;
    }
    if (n.dur >= 0.5 && want("mordente")) {
      add(n.pitch, n.start, g, "mordente"); add(step(n.pitch, 1), n.start + g, g); add(n.pitch, n.start + 2 * g, n.dur - 2 * g); return;
    }
    if (nx !== null && Math.abs(nx - n.pitch) >= 3 && Math.abs(nx - n.pitch) <= 4 && n.dur >= 0.5 && want("passagem")) {
      add(n.pitch, n.start, n.dur / 2); add(step(n.pitch, nx > n.pitch ? 1 : -1), n.start + n.dur / 2, n.dur / 2, "passagem"); return;
    }
    add(n.pitch, n.start, n.dur);
  });
  return pushLayer(`${inst.name} — tema ornamentado (${kinds.map((x) => ORN_LABEL[x]).join(", ")})`, inst, out, "voice");
}

/** Aplica a harmonização recomendada às cifras dos compassos sem acordes (desfazível). */
export function applySuggestedChords() {
  const s = store.score, a = analyze(s);
  if (!a.suggested) return 0;
  let n = 0;
  store.mutate((sc) => { a.chords.forEach((cell, m) => { if (!sc.chords[m]?.length && cell.length) { sc.chords[m] = cell; n += cell.length; } }); }, "harmonize");
  return n;
}
