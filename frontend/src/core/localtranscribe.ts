// Transcrição no próprio navegador (sem servidor): usada para visitantes e quando o worker de IA
// não responde. Mesma estratégia do audio2score em versão compacta:
//  1) altura quadro a quadro (YIN) com filtro de mediana;
//  2) segmentação por patamares de altura + reataques de energia (sílabas);
//  3) notas curtas demais (< 80 ms) viram ornamento da vizinha em vez de nota nova;
//  4) andamento por autocorrelação dos ataques (ou o da partitura) e quantização em semicolcheias;
//  5) tom (Krumhansl) e um acorde por meio compasso escolhido pelas notas da melodia.
import { detectPitch } from "./livecapture";
import { magSpectrum, NoiseGate, frameVoices, Tracker, snapDur, PolyMode, TrackedNote } from "./polypitch";
import { detectKey as keyOf, suggestChords } from "./analysis";
import { newLayer } from "./store";
import type { Score } from "./types";

export interface LocalOpts { a?: number; b?: number; tempo?: number; timeSig?: [number, number]; estimateTempo?: boolean; onProgress?: (pct: number, label: string) => void; name?: string }

const KS_MAJ = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const KS_MIN = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
const NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
const FIFTHS = [0, -5, 2, -3, 4, -1, 6, 1, -4, 3, -2, 5];

function median(a: number[]) { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; }
function corr(a: number[], b: number[]) {
  const ma = a.reduce((x, y) => x + y, 0) / 12, mb = b.reduce((x, y) => x + y, 0) / 12;
  let n = 0, da = 0, db = 0; for (let i = 0; i < 12; i++) { n += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
  return n / Math.sqrt(da * db || 1);
}
const tick = () => new Promise((r) => setTimeout(r, 0));

export interface RawNote { pitch: number; t: number; d: number; fine: number }

/** Altura + segmentação: devolve notas em segundos (relativas ao início do trecho). */
export async function detectNotes(buf: AudioBuffer, a = 0, b = buf.duration, onProgress?: LocalOpts["onProgress"]): Promise<RawNote[]> {
  const sr = buf.sampleRate, i0 = Math.floor(a * sr), i1 = Math.min(buf.length, Math.floor(b * sr));
  const mono = new Float32Array(i1 - i0);
  for (let c = 0; c < buf.numberOfChannels; c++) { const ch = buf.getChannelData(c); for (let i = 0; i < mono.length; i++) mono[i] += ch[i0 + i] / buf.numberOfChannels; }
  let peak = 0; for (let i = 0; i < mono.length; i++) peak = Math.max(peak, Math.abs(mono[i]));
  if (peak > 0) for (let i = 0; i < mono.length; i++) mono[i] /= peak;
  const N = sr > 30000 ? 2048 : 1024, hop = Math.round(sr * 0.01); // 10 ms
  const nF = Math.max(0, Math.floor((mono.length - N) / hop));
  const midi: number[] = new Array(nF).fill(NaN), rms: number[] = new Array(nF).fill(0);
  for (let f = 0; f < nF; f++) {
    const fr = mono.subarray(f * hop, f * hop + N);
    let e = 0; for (let i = 0; i < N; i += 4) e += fr[i] * fr[i]; rms[f] = Math.sqrt(e / (N / 4));
    const p = detectPitch(fr, sr);
    if (p && p.clarity > 0.55 && p.f > 60 && p.f < 1100) midi[f] = 69 + 12 * Math.log2(p.f / 440);
    if (f % 200 === 0) { onProgress?.(5 + (f / nF) * 70, "Ouvindo a melodia (altura de cada nota)"); await tick(); }
  }
  // mediana de 5 quadros (remove saltos de oitava isolados)
  const sm = midi.map((_, i) => { const w = midi.slice(Math.max(0, i - 2), i + 3).filter((x) => !isNaN(x)); return w.length >= 3 && !isNaN(midi[i]) ? median(w) : NaN; });
  // segmentação: patamar de altura estável; reataque de energia abre nova nota
  onProgress?.(78, "Separando as notas e sílabas");
  const out: RawNote[] = [];
  let st = -1, vals: number[] = [];
  const close = (end: number) => {
    if (st >= 0 && end - st >= 6) { const m = median(vals); out.push({ pitch: Math.round(m), fine: m, t: (st * hop) / sr, d: ((end - st) * hop) / sr }); }
    st = -1; vals = [];
  };
  for (let f = 0; f < nF; f++) {
    const m = sm[f];
    if (isNaN(m)) { close(f); continue; }
    if (st < 0) { st = f; vals = [m]; continue; }
    const cur = median(vals.slice(-8));
    const reattack = f > 3 && rms[f] > rms[f - 3] * 1.8 && rms[f] > 0.08 && f - st > 8;
    if (Math.abs(m - cur) > 0.7 || reattack) { close(f); st = f; vals = [m]; } else vals.push(m);
  }
  close(nF);
  // notas de passagem curtíssimas (deslizes) somem; a mesma altura com intervalo mínimo junta
  const merged: RawNote[] = [];
  for (const n of out) {
    const L = merged[merged.length - 1];
    if (L && n.pitch === L.pitch && n.t - (L.t + L.d) < 0.04) { L.d = n.t + n.d - L.t; continue; }
    if (n.d < 0.08 && L && Math.abs(n.pitch - L.pitch) <= 2) { L.d = n.t + n.d - L.t; continue; }
    merged.push(n);
  }
  return merged.filter((n) => n.d >= 0.07);
}

/** Andamento pelos ataques (autocorrelação de um trem de impulsos), 60–180 bpm. */
export function estimateTempo(notes: RawNote[]): { bpm: number; phase: number } {
  if (notes.length < 4) return { bpm: 0, phase: 0 };
  const res = 0.01, T = Math.ceil((notes[notes.length - 1].t + 1) / res);
  const env = new Float32Array(T);
  for (const n of notes) { const k = Math.round(n.t / res); for (let j = -2; j <= 2; j++) if (k + j >= 0 && k + j < T) env[k + j] += (1 - Math.abs(j) / 3) * Math.min(1, n.d + 0.3); }
  let best = 0, bv = -1;
  for (let bpm = 60; bpm <= 180; bpm += 1) {
    const lag = 60 / bpm / res; let s = 0;
    for (let i = 0; i < T; i++) { const j = Math.round(i + lag), j2 = Math.round(i + 2 * lag); if (j < T) s += env[i] * env[j]; if (j2 < T) s += 0.5 * env[i] * env[j2]; }
    s *= 1 + 0.15 * Math.exp(-((bpm - 100) ** 2) / 1800); // leve preferência a 80–120
    if (s > bv) { bv = s; best = bpm; }
  }
  const spb = 60 / best;
  let bp = 0, bs = -1;
  for (let k = 0; k < 20; k++) { const ph = (k / 20) * spb; const s = notes.reduce((acc, n) => acc + Math.cos((2 * Math.PI * (n.t - ph)) / spb) * Math.min(1, n.d + 0.3), 0); if (s > bs) { bs = s; bp = ph; } }
  return { bpm: best, phase: bp };
}

/** Transcrição completa → mesmo formato que o servidor devolve (camadas, acordes, tom). */
export async function transcribeLocal(buf: AudioBuffer, o: LocalOpts = {}): Promise<Partial<Score> & { layers: any[]; chords: any[][]; engine: string; notice: string }> {
  const P = o.onProgress ?? (() => {});
  P(2, "Preparando o áudio");
  const raw = await detectNotes(buf, o.a ?? 0, o.b ?? buf.duration, P);
  const ts = o.timeSig ?? [4, 4], bpm = (ts[0] * 4) / ts[1];
  P(85, "Encaixando o ritmo nos compassos");
  let tempo = o.tempo ?? 100, phase = raw[0]?.t ?? 0;
  if (o.estimateTempo !== false) { const est = estimateTempo(raw); if (est.bpm) { tempo = est.bpm; phase = est.phase; } }
  const spb = 60 / tempo;
  while (raw.length && phase > raw[0].t + 0.05) phase -= spb;
  const g = 0.25, q = (x: number) => Math.round(x / g) * g;
  const notes: any[] = [];
  for (const n of raw) {
    const s = q((n.t - phase) / spb); let d = Math.max(g, q(n.d / spb));
    const L = notes[notes.length - 1];
    if (L && s < L.start + L.dur) { if (s <= L.start) continue; L.dur = s - L.start; }
    if (s < 0) continue;
    notes.push({ pitch: n.pitch, start: s, dur: d, vel: 84 });
  }
  // tom pela melodia ponderada por duração
  P(92, "Tom e acordes");
  const pc = new Array(12).fill(0); for (const n of notes) pc[n.pitch % 12] += n.dur;
  let tonic = 0, mode: "major" | "minor" = "major", kb = -2;
  for (let t = 0; t < 12; t++) for (const [prof, md] of [[KS_MAJ, "major"], [KS_MIN, "minor"]] as const) { const r = corr(pc, prof.map((_, i) => prof[(i - t + 12) % 12])); if (r > kb) { kb = r; tonic = t; mode = md; } }
  // um acorde diatônico (I ii iii IV V vi / i iv V VI ...) por meio compasso, pelas notas que soam
  const scale = mode === "major" ? [0, 2, 4, 5, 7, 9, 11] : [0, 2, 3, 5, 7, 8, 10];
  const cands = scale.map((deg, i) => { const r = (tonic + deg) % 12; const third = (tonic + scale[(i + 2) % 7]) % 12, fifth = (tonic + scale[(i + 4) % 7]) % 12;
    let qual = (third - r + 12) % 12 === 3 ? "m" : ""; if ((fifth - r + 12) % 12 === 6) qual = "dim";
    if (mode === "minor" && i === 4) { qual = ""; } // dominante maior no menor
    const pcs = mode === "minor" && i === 4 ? [r, (r + 4) % 12, fifth] : [r, third, fifth];
    return { root: r, quality: qual, pcs, w: [1.2, 0.8, 0.7, 1, 1.1, 0.9, 0.4][i] }; });
  const last = notes.length ? Math.max(...notes.map((n) => n.start + n.dur)) : bpm;
  const measures = Math.max(1, Math.ceil(last / bpm));
  const half = bpm / 2;
  const chords: any[][] = [];
  for (let m = 0; m < measures; m++) {
    const cell: any[] = [];
    for (let k = 0; k < 2; k++) {
      const a = m * bpm + k * half, b = a + half;
      const w = new Array(12).fill(0);
      for (const n of notes) { const ov = Math.min(b, n.start + n.dur) - Math.max(a, n.start); if (ov > 0) w[n.pitch % 12] += ov * (n.start >= a && n.start < a + 0.3 ? 1.5 : 1); }
      if (!w.some((x) => x > 0)) continue;
      let best = cands[0], bs = -1;
      for (const c of cands) { const s = c.pcs.reduce((acc, p, j) => acc + w[p] * (j === 0 ? 1.2 : 1), 0) * c.w; if (s > bs) { bs = s; best = c; } }
      const sym = NAMES[best.root] + (best.quality === "dim" ? "°" : best.quality);
      if (cell.length && cell[cell.length - 1].symbol === sym) { cell[cell.length - 1].dur += half; continue; }
      cell.push({ beat: k * half, dur: half, root: best.root, quality: best.quality, extensions: [], bass: null, symbol: sym });
    }
    chords.push(cell);
  }
  const acc: any[] = [];
  chords.forEach((cell, m) => cell.forEach((c: any) => {
    const third = c.quality === "m" || c.quality === "dim" ? 3 : 4, fifth = c.quality === "dim" ? 6 : 7;
    const r = 48 + c.root; // tríade em posição fechada (C3–B3) + baixo uma oitava abaixo
    for (const [k, p] of [r - 12, r, r + third, r + fifth].entries()) acc.push({ pitch: p, start: m * bpm + c.beat, dur: c.dur, vel: k ? 66 : 74 });
  }));
  const tag = o.name ? ` — ${o.name.replace(/\.\w+$/, "").slice(0, 40)}` : "";
  const layers: any[] = [];
  if (notes.length) layers.push({ ...newLayer("melody", "Melodia transcrita" + tag), notes });
  if (acc.length) layers.push({ ...newLayer("harmony", "Harmonia estimada" + tag, "bass"), notes: acc });
  P(100, "Pronto");
  return { tempo: Math.round(tempo), timeSig: ts, keySig: FIFTHS[mode === "major" ? tonic : (tonic + 3) % 12], measures, layers, chords, engine: "browser",
    notice: `Transcrito no navegador: ${notes.length} notas, ♩=${Math.round(tempo)}, tom ${NAMES[tonic]}${mode === "minor" ? "m" : ""}.` };
}

// ------------------------------------------------------------------ polifônico / orquestra (no navegador)

/** Várias notas ao mesmo tempo; no modo orquestra cada timbre reconhecido vira uma camada (instrumento). */
export async function transcribeLocalPoly(buf: AudioBuffer, o: LocalOpts & { notes?: PolyMode; orchestra?: boolean; hands?: boolean } = {}) {
  const P = o.onProgress ?? (() => {});
  P(2, "Preparando o áudio");
  const sr = buf.sampleRate, a = o.a ?? 0, b = o.b ?? buf.duration;
  const i0 = Math.floor(a * sr), i1 = Math.min(buf.length, Math.floor(b * sr));
  const mono = new Float32Array(i1 - i0);
  for (let ch = 0; ch < buf.numberOfChannels; ch++) { const d = buf.getChannelData(ch); for (let i = 0; i < mono.length; i++) mono[i] += d[i0 + i] / buf.numberOfChannels; }
  let peak = 0; for (let i = 0; i < mono.length; i++) peak = Math.max(peak, Math.abs(mono[i]));
  if (peak > 0) for (let i = 0; i < mono.length; i++) mono[i] /= peak;
  const N = sr > 30000 ? 8192 : 4096, hop = Math.round(sr * 0.02), hz = sr / N;
  const gate = new NoiseGate();
  const notes: TrackedNote[] = [];
  const tr = new Tracker((n) => notes.push(n), { orchestra: !!o.orchestra, minFrames: 2, missFrames: 3 });
  const nF = Math.max(0, Math.floor((mono.length - N) / hop));
  const spec = new Float32Array(N / 2);
  for (let f = 0; f < nF; f++) {
    const fr = mono.subarray(f * hop, f * hop + N);
    let e = 0; for (let i = 0; i < N; i += 16) e = Math.max(e, Math.abs(fr[i]));
    magSpectrum(fr, spec);
    const clean = gate.clean(spec, hz);
    const vs = e > 0.02 ? frameVoices(clean, hz, o.orchestra ? "poly" : o.notes ?? "auto", o.orchestra ? 6 : 4, 33, 96, !!o.orchestra) : [];
    // instante do quadro: um pouco depois do centro da janela (a nota nova só domina quando ocupa ~¾ da janela)
    tr.push(vs.filter((v) => v.midi >= 28 && v.midi <= 100), (f * hop + N * 0.72) / sr);
    if (f % 40 === 0) { P(4 + (f / nF) * 76, "Ouvindo as notas (várias ao mesmo tempo)"); await new Promise((r) => setTimeout(r, 0)); }
  }
  tr.flush(mono.length / sr);
  P(82, "Encaixando o ritmo nos compassos");
  const ts = o.timeSig ?? [4, 4], bpm = (ts[0] * 4) / ts[1];
  let tempo = o.tempo ?? 100, phase = notes.length ? Math.min(...notes.map((n) => n.t0)) : 0;
  if (o.estimateTempo !== false && notes.length > 4) {
    const raw = notes.map((n) => ({ pitch: n.midi, t: n.t0, d: n.t1 - n.t0, fine: n.midi })).sort((x, y) => x.t - y.t);
    const est = estimateTempo(raw); if (est.bpm) { tempo = est.bpm; phase = est.phase; while (phase > raw[0].t + 0.05) phase -= 60 / tempo; }
  }
  const spb = 60 / tempo, g = 0.25;
  // camadas: por instrumento (orquestra) e por mão (graves na pauta de Fá)
  const groups = new Map<string, { notes: any[]; cluster: number; bass: boolean }>();
  for (const n of notes) {
    const start = Math.max(0, Math.round((n.t0 - phase) / spb / g) * g);
    const dur = Math.max(g, snapDur((n.t1 - n.t0) / spb));
    const bass = (o.hands ?? true) && !o.orchestra && n.midi < 60;
    const cl = o.orchestra ? n.cluster ?? 0 : 0;
    const k = `${cl}:${bass ? "b" : "t"}`;
    if (!groups.has(k)) groups.set(k, { notes: [], cluster: cl, bass });
    groups.get(k)!.notes.push({ pitch: n.midi, start, dur, vel: Math.round(60 + Math.min(1, Math.sqrt(n.sal) * 6) * 50) });
  }
  const all = [...groups.values()].flatMap((x) => x.notes);
  P(92, "Tom e acordes");
  const key = keyOf(all as any, 0);
  const score: any = { tempo, timeSig: ts, measures: Math.max(1, Math.ceil(Math.max(bpm, ...all.map((n) => n.start + n.dur)) / bpm)), keySig: 0, chords: [], layers: [] };
  const chords = suggestChords(score, all as any, key);
  const tag = o.name ? ` — ${o.name.replace(/\.\w+$/, "").slice(0, 30)}` : "";
  const PAL = ["#ff6b9a", "#ff9f1c", "#2e86de", "#13a876", "#9b5de5", "#f15bb5"];
  const layers = [...groups.values()].sort((x, y) => x.cluster - y.cluster || +x.bass - +y.bass).map((gr) => {
    const tb = o.orchestra ? tr.clusters[gr.cluster]?.timbre : undefined;
    const name = o.orchestra ? `Instrumento ${gr.cluster + 1} — ${tb?.label ?? "?"} (estimado)${tag}` : `${gr.bass ? "Mão esquerda" : "Mão direita"} (transcrita)${tag}`;
    const med = gr.notes.map((n: any) => n.pitch).sort((x: number, y: number) => x - y)[Math.floor(gr.notes.length / 2)] ?? 60;
    const low = gr.bass || med < 55;
    return { ...newLayer(low ? "harmony" : "melody", name, low ? "bass" : "treble"), notes: gr.notes, ...(tb ? { instrument: tb.instrument, color: PAL[gr.cluster % PAL.length] } : {}) };
  }).filter((l) => l.notes.length);
  P(100, "Pronto");
  const FIFTHS = [0, -5, 2, -3, 4, -1, 6, 1, -4, 3, -2, 5];
  return { tempo: Math.round(tempo), timeSig: ts, keySig: FIFTHS[key.mode === "major" ? key.tonic : (key.tonic + 3) % 12], measures: score.measures, layers, chords, engine: "browser-poly",
    notice: `Transcrito no navegador (${o.orchestra ? `orquestra: ${layers.length} instrumento(s) por timbre` : "polifônico"}): ${all.length} notas, ♩=${Math.round(tempo)}, ${key.name}.` };
}
