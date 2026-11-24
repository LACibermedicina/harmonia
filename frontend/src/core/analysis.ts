// Análise do tema principal: tonalidade, MOTIVO RÍTMICO, MÓDULOS TEMÁTICOS (A, A', B…), harmonização
// recomendada (quando não há cifras), cadências e um texto teórico-técnico para o assistente explicar.
//
// Como funciona:
//  • tema principal = a camada de melodia/voz com mais notas na pauta de cima;
//  • ritmo de cada compasso = sequência de ataques (na grade de semicolcheia) → "assinatura rítmica";
//    o motivo rítmico é a assinatura (com ≥ 2 ataques) que mais se repete;
//  • módulos = blocos de 4 compassos (ou 2, em temas curtos) comparados por ritmo (60%) e contorno melódico
//    (intervalos, 40%): ≥ 0,85 → mesmo módulo (A); ≥ 0,6 → variação (A'); senão um módulo novo (B, C…);
//  • harmonização recomendada = um acorde diatônico por meio compasso escolhido pelas notas que soam,
//    com preferência pelas funções I, IV, V e cadência V→I no fim das frases.
import type { Score, Note, Layer, ChordEv } from "./types";

export const NAMES_PT = ["Dó", "Dó♯", "Ré", "Mi♭", "Mi", "Fá", "Fá♯", "Sol", "Lá♭", "Lá", "Si♭", "Si"];
const NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
const KS_MAJ = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KS_MIN = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
const FIG: [number, string][] = [[4, "semibreve"], [3, "mínima pontuada"], [2, "mínima"], [1.5, "semínima pontuada"], [1, "semínima"], [0.75, "colcheia pontuada"], [0.5, "colcheia"], [0.25, "semicolcheia"]];
export const figureName = (d: number) => (FIG.find(([v]) => Math.abs(v - d) < 0.01) ?? FIG.reduce((a, b) => (Math.abs(b[0] - d) < Math.abs(a[0] - d) ? b : a)))[1];
const bpmOf = (s: Score) => (s.timeSig[0] * 4) / s.timeSig[1];

export interface Module { label: string; from: number; to: number; sim: number }
export interface Analysis {
  theme: Layer | null; key: { tonic: number; mode: "major" | "minor"; name: string; conf: number };
  motive: { signature: string; durations: number[]; measures: number[] } | null;
  modules: Module[]; chords: ChordEv[][]; suggested: boolean; cadences: { measure: number; kind: string }[];
  range: [number, number] | null; scale: number[];
}

function corr(a: number[], b: number[]) {
  const ma = a.reduce((x, y) => x + y, 0) / 12, mb = b.reduce((x, y) => x + y, 0) / 12;
  let n = 0, da = 0, db = 0; for (let i = 0; i < 12; i++) { n += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
  return n / Math.sqrt(da * db || 1);
}

export function themeLayer(s: Score): Layer | null {
  // camadas geradas no Estudo e capturas ao vivo não contam como tema
  const base = s.layers.filter((l) => l.kind !== "recording" && l.notes.length && l.group !== "estudo" && !l.live);
  const c = base.filter((l) => l.staff !== "bass" && (l.kind === "melody" || l.kind === "voice" || l.kind === "omr"));
  const pool = c.length ? c : base.length ? base : s.layers.filter((l) => l.kind !== "recording" && l.notes.length);
  const rank = (l: Layer) => (l.kind === "melody" ? 1000 : 0) + l.notes.length;
  return [...pool].sort((a, b) => rank(b) - rank(a))[0] ?? null;
}

export function detectKey(notes: Note[], keySig = 0) {
  const pc = new Array(12).fill(0); for (const n of notes) pc[n.pitch % 12] += n.dur;
  let tonic = 0, mode: "major" | "minor" = "major", best = -2;
  for (let t = 0; t < 12; t++) for (const [prof, md] of [[KS_MAJ, "major"], [KS_MIN, "minor"]] as const) {
    // leve preferência pela armadura escrita
    const fifthsOf = (md === "major" ? t : (t + 3) % 12) * 7 % 12; const bonus = fifthsOf === (((keySig * 7) % 12) + 12) % 12 ? 0.05 : 0;
    const r = corr(pc, prof.map((_, i) => prof[(i - t + 12) % 12])) + bonus;
    if (r > best) { best = r; tonic = t; mode = md; }
  }
  return { tonic, mode, conf: Math.max(0, best), name: `${NAMES_PT[tonic]} ${mode === "major" ? "maior" : "menor"}` };
}

export const scaleOf = (tonic: number, mode: "major" | "minor") => (mode === "major" ? [0, 2, 4, 5, 7, 9, 11] : [0, 2, 3, 5, 7, 8, 10]).map((x) => (x + tonic) % 12);

/** Um acorde diatônico por meio compasso, pelas notas que soam (com cadência no fim das frases). */
export function suggestChords(s: Score, notes: Note[], key: { tonic: number; mode: "major" | "minor" }): ChordEv[][] {
  const bpm = bpmOf(s), half = bpm >= 3 && bpm % 2 === 0 ? bpm / 2 : bpm;
  const sc = scaleOf(key.tonic, key.mode);
  const cands = sc.map((r, i) => {
    const third = sc[(i + 2) % 7], fifth = sc[(i + 4) % 7];
    let q = (third - r + 12) % 12 === 3 ? "m" : ""; if ((fifth - r + 12) % 12 === 6) q = "dim";
    let pcs = [r, third, fifth];
    if (key.mode === "minor" && i === 4) { q = "7"; pcs = [r, (r + 4) % 12, fifth, (r + 10) % 12]; } // V7 no menor (sensível)
    if (key.mode === "major" && i === 4) { q = "7"; pcs = [r, third, fifth, sc[(i + 6) % 7]]; }
    return { root: r, quality: q, pcs, w: [1.25, 0.85, 0.7, 1.05, 1.15, 0.9, 0.35][i], deg: i };
  });
  const measures = Math.max(s.measures, Math.ceil(Math.max(0, ...notes.map((n) => n.start + n.dur)) / bpm));
  const out: ChordEv[][] = [];
  let prev = -1;
  for (let m = 0; m < measures; m++) {
    const cell: ChordEv[] = [];
    for (let a = m * bpm; a < (m + 1) * bpm - 1e-6; a += half) {
      const b = a + half, w = new Array(12).fill(0);
      for (const n of notes) { const ov = Math.min(b, n.start + n.dur) - Math.max(a, n.start); if (ov > 0) w[n.pitch % 12] += ov * (Math.abs(n.start - a) < 0.01 ? 1.6 : 1); }
      if (!w.some((x) => x > 0)) continue;
      const endOfPhrase = (m % 4 === 3 || m === measures - 1) && b >= (m + 1) * bpm - 1e-6;
      const prePhrase = (m % 4 === 3 || m === measures - 1) && !endOfPhrase;
      let best = cands[0], bs = -1;
      for (const c of cands) {
        let sc2 = c.pcs.reduce((acc, p, j) => acc + w[p] * (j === 0 ? 1.25 : 1), 0) * c.w;
        if (endOfPhrase && c.deg === 0 && m === measures - 1) sc2 *= 1.6;       // termina na tônica
        if (prePhrase && c.deg === 4) sc2 *= 1.25;                                // dominante antes da cadência
        if (prev === 4 && c.deg === 0) sc2 *= 1.15;                               // V → I
        if (c.deg === prev) sc2 *= 1.05;
        if (sc2 > bs) { bs = sc2; best = c; }
      }
      prev = best.deg;
      const sym = NAMES[best.root] + (best.quality === "dim" ? "°" : best.quality);
      const last = cell[cell.length - 1];
      if (last && last.symbol === sym) { last.dur += half; continue; }
      cell.push({ beat: a - m * bpm, dur: half, root: best.root, quality: best.quality, symbol: sym, extensions: [], bass: null });
    }
    out.push(cell);
  }
  return out;
}

function rhythmSig(ns: Note[], m: number, bpm: number) {
  return ns.filter((n) => Math.floor(n.start / bpm + 1e-9) === m).sort((a, b) => a.start - b.start).map((n) => Math.round((n.start - m * bpm) * 4) / 4);
}
function contour(ns: Note[], a: number, b: number) {
  const xs = ns.filter((n) => n.start >= a - 1e-9 && n.start < b - 1e-9).sort((x, y) => x.start - y.start);
  return xs.slice(1).map((n, i) => Math.sign(n.pitch - xs[i].pitch) * Math.min(7, Math.abs(n.pitch - xs[i].pitch)));
}
function simSeq(a: number[], b: number[], tol = 0) {
  if (!a.length && !b.length) return 1;
  const n = Math.max(a.length, b.length); let ok = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (Math.abs(a[i] - b[i]) <= tol) ok++;
  return ok / n;
}

export function analyze(s: Score): Analysis {
  const bpm = bpmOf(s);
  const theme = themeLayer(s);
  const notes = theme ? [...theme.notes].sort((a, b) => a.start - b.start) : [];
  const allNotes = s.layers.filter((l) => l.kind !== "recording").flatMap((l) => l.notes);
  const key = detectKey(notes.length ? notes : allNotes, s.keySig);
  const nMeas = Math.max(1, Math.ceil(Math.max(0, ...notes.map((n) => n.start + n.dur)) / bpm));
  // motivo rítmico
  const sigs = Array.from({ length: nMeas }, (_, m) => rhythmSig(notes, m, bpm));
  const count = new Map<string, number[]>();
  sigs.forEach((sg, m) => { if (sg.length >= 2) { const k = sg.join(","); count.set(k, [...(count.get(k) || []), m]); } });
  let motive: Analysis["motive"] = null;
  for (const [k, ms] of count) if (ms.length >= 2 && (!motive || ms.length > motive.measures.length || (ms.length === motive.measures.length && k.split(",").length > motive.signature.split(",").length))) {
    const on = k.split(",").map(Number);
    const durations = on.map((x, i) => (i + 1 < on.length ? on[i + 1] : bpm) - x);
    motive = { signature: k, durations, measures: ms };
  }
  // módulos
  const L = nMeas >= 8 ? 4 : nMeas >= 4 ? 2 : 1;
  const modules: Module[] = [];
  const reps: { label: string; from: number; sig: number[][]; con: number[] }[] = [];
  let next = 0;
  for (let f = 0; f < nMeas; f += L) {
    const to = Math.min(nMeas - 1, f + L - 1);
    const sig = sigs.slice(f, to + 1), con = contour(notes, f * bpm, (to + 1) * bpm);
    let bestR: typeof reps[0] | null = null, bs = 0;
    for (const r of reps) {
      const rs = sig.reduce((a, sg, i) => a + simSeq(sg, r.sig[i] || []), 0) / Math.max(1, sig.length);
      const cs = simSeq(con, r.con, 1);
      const sc = 0.6 * rs + 0.4 * cs;
      if (sc > bs) { bs = sc; bestR = r; }
    }
    if (bestR && bs >= 0.85) modules.push({ label: bestR.label, from: f, to, sim: bs });
    else if (bestR && bs >= 0.6) modules.push({ label: bestR.label.replace(/'*$/, (x) => x + "'"), from: f, to, sim: bs });
    else { const lb = String.fromCharCode(65 + next++); reps.push({ label: lb, from: f, sig, con }); modules.push({ label: lb, from: f, to, sim: 1 }); }
  }
  // harmonia (escrita ou sugerida)
  const has = s.chords.some((c) => c?.length);
  const chords = has ? s.chords : suggestChords(s, notes, key);
  // cadências: fim de cada módulo
  const cadences: Analysis["cadences"] = [];
  const degOf = (c?: ChordEv) => (c ? scaleOf(key.tonic, key.mode).indexOf(c.root) : -1);
  for (const md of modules) {
    // último acorde do módulo e o acorde DIFERENTE imediatamente anterior
    const seq = chords.slice(md.from, md.to + 1).flat();
    const z = seq[seq.length - 1];
    let y: ChordEv | undefined; for (let i = seq.length - 2; i >= 0; i--) if (seq[i].symbol !== z?.symbol) { y = seq[i]; break; }
    const dz = degOf(z), dy = degOf(y);
    let kind = "";
    if (dz === 0 && dy === 4) kind = "autêntica (V → I)"; else if (dz === 0 && dy === 3) kind = "plagal (IV → I)";
    else if (dz === 4) kind = "suspensiva / semicadência (→ V)"; else if (dz === 5 && dy === 4) kind = "de engano (V → vi)";
    if (kind) cadences.push({ measure: md.to, kind });
  }
  const range: [number, number] | null = notes.length ? [Math.min(...notes.map((n) => n.pitch)), Math.max(...notes.map((n) => n.pitch))] : null;
  return { theme, key, motive, modules, chords, suggested: !has, cadences, range, scale: scaleOf(key.tonic, key.mode) };
}

const pn = (p: number) => `${NAMES_PT[p % 12]}${Math.floor(p / 12) - 1}`;
const INTERVAL = ["uníssono", "2ª menor", "2ª maior", "3ª menor", "3ª maior", "4ª justa", "trítono", "5ª justa", "6ª menor", "6ª maior", "7ª menor", "7ª maior", "oitava"];

/** Texto teórico-técnico (para o assistente explicar o tema). */
export function explain(s: Score, a = analyze(s)): string[] {
  const out: string[] = [];
  const bpm = bpmOf(s);
  if (!a.theme) return ["Ainda não há melodia para analisar. Escreva, grave ou importe o tema principal e me peça de novo."];
  out.push(`Este tema está em ${a.key.name} (${s.timeSig[0]}/${s.timeSig[1]}, ♩ = ${s.tempo}), na camada “${a.theme.name}”, com ${a.theme.notes.length} notas em ${Math.ceil(Math.max(...a.theme.notes.map((n) => n.start + n.dur)) / bpm)} compassos.`);
  if (a.range) { const span = a.range[1] - a.range[0]; out.push(`Extensão: de ${pn(a.range[0])} a ${pn(a.range[1])} (${span <= 12 ? INTERVAL[span] : `${span} semitons — mais de uma oitava`}).`); }
  if (a.motive) {
    const figs = a.motive.durations.map(figureName);
    out.push(`Motivo rítmico: ${figs.join(" – ")}, que aparece nos compassos ${a.motive.measures.map((m) => m + 1).join(", ")}. Repetir um mesmo desenho rítmico dá unidade ao tema; é ele que o ouvido reconhece.`);
  } else out.push("Não encontrei um desenho rítmico que se repita compasso a compasso — o ritmo é mais livre (prosa musical).");
  if (a.modules.length > 1) {
    const form = a.modules.map((m) => m.label).join(" ");
    out.push(`Estrutura em módulos: ${a.modules.map((m) => `${m.label} (c.${m.from + 1}–${m.to + 1})`).join(", ")} → forma ${form}. Módulos com o mesmo nome repetem ritmo e contorno; o apóstrofo (A') indica variação.`);
  }
  const prog = a.chords.slice(0, 8).map((c) => (c || []).map((x) => x.symbol).join(" ")).filter(Boolean);
  if (prog.length) out.push(`${a.suggested ? "Harmonização recomendada" : "Harmonia"}: ${prog.join(" | ")}${a.chords.length > 8 ? " …" : ""}. ${a.suggested ? "Escolhi um acorde por meio compasso pelas notas que soam, priorizando I, IV e V e preparando o fim das frases com a dominante." : ""}`);
  if (a.cadences.length) out.push(`Cadências: ${a.cadences.map((c) => `c.${c.measure + 1} ${c.kind}`).join("; ")}.`);
  const leaps = a.theme.notes.slice().sort((x, y) => x.start - y.start).reduce((acc, n, i, xs) => acc + (i && Math.abs(n.pitch - xs[i - 1].pitch) > 4 ? 1 : 0), 0);
  out.push(leaps > a.theme.notes.length / 3 ? "O contorno tem muitos saltos — bom para arpejos; para cantar, prepare os saltos maiores." : "O contorno é sobretudo por graus conjuntos — ótimo para ornamentar (mordentes, apojaturas) e para solos por escala.");
  out.push("Sugestões de estudo: arpejos dos acordes I–IV–V do tema, um solo que reaproveite o motivo rítmico e ornamentos nas notas longas dos tempos fortes.");
  return out;
}
