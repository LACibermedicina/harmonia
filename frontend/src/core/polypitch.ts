// Altura POLIFÔNICA + timbre + limpeza de ruído — usado na captura ao vivo e na transcrição local.
//
//  1) limpeza: estimativa do piso de ruído por faixa de frequência (sobe devagar, desce rápido) e
//     "spectral gating" — só o que passa ~2× o ruído de fundo conta; faixa útil 50 Hz–5 kHz;
//  2) altura: soma harmônica ponderada (até 10 harmônicos) em grade fina de 10 cents; a voz mais forte
//     é escolhida, seus harmônicos são subtraídos do espectro e a busca se repete (Klapuri, iterativa);
//     para quando a próxima voz é fraca demais ou é só um harmônico da anterior;
//  3) timbre: perfil dos harmônicos, centróide, razão ímpares/pares, vibrato e queda de volume →
//     família provável (voz, cordas de arco, flauta, palheta, metais, dedilhado, piano);
//  4) acompanhamento das notas (Tracker): nota começa após 2–3 quadros estáveis, termina quando some;
//     reataque reinicia a nota; duração real → figura (com pontuadas) na grade do andamento.
//     No modo ORQUESTRA as notas são agrupadas por timbre (cada grupo vira um instrumento/camada).

export type PolyMode = "auto" | "mono" | "poly";
export interface Voice { midi: number; cents: number; f: number; sal: number; harm: number[] }

// ------------------------------------------------------------------ FFT (radix-2, real → magnitude)
export function magSpectrum(x: Float32Array, out?: Float32Array): Float32Array {
  const n = x.length, re = new Float32Array(n), im = new Float32Array(n);
  for (let i = 0; i < n; i++) re[i] = x[i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1))); // Hann
  for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { const t = re[i]; re[i] = re[j]; re[j] = t; } }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        const nr = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
  const m = out ?? new Float32Array(n / 2);
  for (let i = 0; i < n / 2; i++) m[i] = Math.hypot(re[i], im[i]) / n;
  return m;
}

// ------------------------------------------------------------------ piso de ruído + vozes
export class NoiseGate {
  floor: Float32Array | null = null;
  clean(mag: Float32Array, hz: number): Float32Array {
    // começa baixo (o 1º quadro pode já ter música) e aprende o ruído pelos mínimos: desce rápido, sobe devagar
    if (!this.floor || this.floor.length !== mag.length) this.floor = Float32Array.from(mag, (v) => v * 0.04);
    const f = this.floor, out = new Float32Array(mag.length);
    const lo = Math.floor(50 / hz), hi = Math.min(mag.length, Math.ceil(5000 / hz));
    for (let i = 0; i < mag.length; i++) {
      f[i] = mag[i] < f[i] ? f[i] * 0.7 + mag[i] * 0.3 : Math.min(mag[i], f[i] * 1.003 + 1e-8);
      out[i] = i >= lo && i < hi ? Math.max(0, mag[i] - 2 * f[i]) : 0;
    }
    return out;
  }
}

const W = Array.from({ length: 11 }, (_, h) => (h ? 1 / Math.pow(h, 0.8) : 0));
/** Vozes presentes no quadro (espectro já limpo). */
export function frameVoices(spec: Float32Array, hz: number, mode: PolyMode, maxVoices = 6, minMidi = 33, maxMidi = 96, smooth = false): Voice[] {
  const S = Float32Array.from(spec);
  const amp = (f: number) => { const k = f / hz, i = Math.floor(k); if (i + 1 >= S.length || i < 1) return 0; return Math.max(S[i - 1] * 0.5, S[i], S[i + 1], i + 2 < S.length ? S[i + 2] * 0.5 : 0); };
  let total = 0; for (let i = 0; i < S.length; i++) total += S[i];
  if (total < 1e-6) return [];
  const voices: Voice[] = [];
  const limit = mode === "mono" ? 1 : maxVoices;
  for (let v = 0; v < limit; v++) {
    let best = 0, bm = 0;
    for (let m10 = minMidi * 10; m10 <= maxMidi * 10; m10 += 1) {
      const f0 = 440 * Math.pow(2, (m10 / 10 - 69) / 12);
      let sc = 0, pen = 0;
      for (let h = 1; h <= 10; h++) { const f = f0 * h; if (f > 5000) break; sc += W[h] * amp(f); }
      // penaliza sub-harmônicos (f0/2 parece bom porque cobre os harmônicos pares)
      for (let h = 1; h <= 4; h++) pen += amp(f0 * (h - 0.5));
      sc -= 0.55 * pen;
      if (sc > best) { best = sc; bm = m10; }
    }
    if (!bm) break;
    const first = voices[0]?.sal ?? best;
    const rel = best / first;
    // voz extra: precisa ser forte o suficiente (no automático, mais exigente)
    if (v > 0 && (best < first * (mode === "poly" ? 0.22 : 0.4) || best < total * 0.012)) break;
    const midiF = bm / 10, f0 = 440 * Math.pow(2, (midiF - 69) / 12);
    // descarta "voz" que é só harmônico de uma voz já encontrada (oitava/quinta acima)
    if (voices.some((q) => { const r = f0 / q.f; const nr = Math.round(r); return nr >= 2 && Math.abs(1200 * Math.log2(r / nr)) < 25 && rel < 0.7; })) {
      for (let h = 1; h <= 10; h++) { const i = Math.round((f0 * h) / hz); for (let j = i - 2; j <= i + 2; j++) if (j > 0 && j < S.length) S[j] *= 0.3; }
      continue;
    }
    const harm: number[] = [];
    for (let h = 1; h <= 8; h++) harm.push(amp(f0 * h));
    const midi = Math.round(midiF);
    voices.push({ midi, cents: Math.round((midiF - midi) * 100), f: f0, sal: best, harm });
    // subtrai a voz encontrada com "suavidade espectral" (Klapuri): em cada harmônico tira só o que a envoltória
    // suave da voz explica — o excesso (de outra nota que coincide nesse harmônico) continua disponível
    // (mesmo instrumento — piano, violão — subtrai tudo: harmônicos coincidentes são da mesma nota)
    if (!smooth) { for (let h = 1; h <= 12; h++) { const i = Math.round((f0 * h) / hz); for (let j = i - 2; j <= i + 2; j++) if (j > 0 && j < S.length) S[j] *= 0.12; } continue; }
    const A = Array.from({ length: 14 }, (_, h) => (h ? amp(f0 * h) : 0));
    for (let h = 1; h <= 12; h++) {
      const est = h === 1 ? A[1] : Math.min(A[h], ((A[h - 1] || 0) + (A[h + 1] || A[h])) / 2);
      const i = Math.round((f0 * h) / hz);
      for (let j = i - 2; j <= i + 2; j++) if (j > 0 && j < S.length) S[j] = Math.max(0, S[j] - est * (j === i ? 1 : 0.6));
    }
  }
  return voices;
}

// ------------------------------------------------------------------ timbre
export interface TimbreGuess { family: string; instrument: string; label: string; conf: number }
const FAMILIES: { family: string; instrument: string; label: string }[] = [
  { family: "voice", instrument: "voice-s", label: "voz" }, { family: "bowed", instrument: "violin", label: "cordas (arco)" },
  { family: "flute", instrument: "flute", label: "flauta" }, { family: "reed", instrument: "clarinet", label: "madeira (palheta)" },
  { family: "brass", instrument: "trumpet", label: "metais" }, { family: "plucked", instrument: "guitar", label: "violão / dedilhado" },
  { family: "piano", instrument: "piano", label: "piano" },
];
/** Vetor de características: 8 harmônicos normalizados + brilho + ímpares/pares + queda + vibrato. */
export function timbreFeatures(harm: number[], decayDbS: number, vibratoCents: number, midi: number): number[] {
  const mx = Math.max(1e-12, ...harm); const h = harm.map((x) => x / mx);
  let cw = 0, cs = 0; h.forEach((a, i) => { cw += a; cs += a * (i + 1); });
  const bright = cw ? cs / cw / 8 : 0;
  const odd = h[2] + h[4] + h[6], even = h[1] + h[3] + h[5] + 1e-6;
  return [...h, bright, Math.min(3, odd / even) / 3, Math.min(1, Math.max(0, decayDbS) / 30), Math.min(1, vibratoCents / 60), (midi - 30) / 70];
}
export function classifyTimbre(fv: number[], midi: number): TimbreGuess {
  const [h1, h2, h3, h4] = fv; const bright = fv[8], oddEven = fv[9], decay = fv[10], vib = fv[11];
  const sc: Record<string, number> = { voice: 0, bowed: 0, flute: 0, reed: 0, brass: 0, plucked: 0, piano: 0 };
  sc.plucked += decay * 2.2 + (midi < 72 ? 0.4 : 0); sc.piano += decay * 2 + (h2 > 0.3 ? 0.3 : 0);
  sc.voice += vib * 1.8 + (1 - decay) * 0.6 + (h1 > 0.6 && bright < 0.35 ? 0.4 : 0);
  sc.flute += (1 - bright) * 1.2 + (h2 + h3 < 0.5 ? 0.8 : 0) + (1 - decay) * 0.4;
  sc.reed += oddEven * 2 + (1 - decay) * 0.4 - (h2 > 0.5 ? 0.6 : 0);
  sc.brass += bright * 1.6 + (h3 + h4 > 1.1 ? 0.6 : 0) + (1 - decay) * 0.4;
  sc.bowed += bright * 0.9 + (h2 + h3 + h4 > 1.2 ? 0.6 : 0) + vib * 0.6 + (1 - decay) * 0.6;
  const best = Object.entries(sc).sort((a, b) => b[1] - a[1]);
  const fam = FAMILIES.find((f) => f.family === best[0][0])!;
  let instrument = fam.instrument;
  if (fam.family === "voice" && midi < 57) instrument = "voice-t";
  if (fam.family === "bowed" && midi < 55) instrument = midi < 40 ? "contrabass" : "cello";
  if (fam.family === "plucked" && midi < 45) instrument = "ebass";
  return { ...fam, instrument, conf: Math.max(0, Math.min(1, (best[0][1] - best[1][1]) / 1.2 + 0.35)) };
}

// ------------------------------------------------------------------ notas, durações e agrupamento
export const FIGS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8];
/** Duração em tempos → figura mais próxima (com pontuadas). */
export function snapDur(d: number) {
  if (d > 8) return Math.round(d / 4) * 4;
  return FIGS.reduce((a, b) => (Math.abs(b - d) < Math.abs(a - d) ? b : a));
}
/** Afina na tonalidade: nota fora da escala que ficou perto de uma nota da escala vai para ela. */
export function snapToKey(midi: number, cents: number, scale: number[] | null) {
  if (!scale || scale.includes(((midi % 12) + 12) % 12)) return midi;
  const dir = cents >= 0 ? 1 : -1;
  if (Math.abs(cents) > 20 && scale.includes((((midi + dir) % 12) + 12) % 12)) return midi + dir;
  return midi;
}

export interface TrackedNote { midi: number; t0: number; t1: number; sal: number; harm: number[]; frames: number; level0: number; levelEnd: number; cents: number[]; cluster?: number; timbre?: TimbreGuess }
interface Active { n: TrackedNote; seen: number; miss: number; peak: number; trough: number }
export interface Cluster { id: number; fv: number[]; count: number; timbre: TimbreGuess }

export class Tracker {
  private active = new Map<number, Active>();
  private pending = new Map<number, number>();
  clusters: Cluster[] = [];
  constructor(private onNote: (n: TrackedNote) => void, private o: { minFrames?: number; missFrames?: number; orchestra?: boolean; maxClusters?: number } = {}) {}
  /** Um quadro: vozes detectadas no instante t (s). */
  push(voices: Voice[], t: number) {
    const minF = this.o.minFrames ?? 2, missF = this.o.missFrames ?? 3;
    const here = new Set<number>();
    for (const v of voices) {
      // continuidade: aceita ±1 semitom de deriva (vibrato) para a nota já ativa
      const key = this.active.has(v.midi) ? v.midi : this.active.has(v.midi - 1) && Math.abs(v.cents) > 30 ? v.midi - 1 : this.active.has(v.midi + 1) && Math.abs(v.cents) > 30 ? v.midi + 1 : v.midi;
      here.add(key);
      const a = this.active.get(key);
      if (a) {
        // reataque: o volume volta a subir muito → nota repetida
        // (compara com o vale desde o último pico: a janela longa faz o volume subir aos poucos)
        if (a.n.frames > 5 && v.sal > a.trough * 2.2 && v.sal > a.peak * 0.55 && a.trough < a.peak * 0.6) { this.finish(key, t); this.start(v, t); continue; }
        a.trough = Math.min(a.trough, v.sal);
        a.miss = 0; a.n.t1 = t; a.n.frames++; a.n.levelEnd = v.sal; if (v.sal > a.peak) { a.peak = v.sal; a.trough = v.sal; } a.n.cents.push(v.cents);
        a.n.harm = a.n.harm.map((x, i) => x * 0.85 + (v.harm[i] || 0) * 0.15);
        continue;
      }
      const c = (this.pending.get(v.midi) || 0) + 1;
      this.pending.set(v.midi, c);
      if (c >= minF) { this.pending.delete(v.midi); this.start(v, t - (minF - 1) * 0.023); }
    }
    for (const k of [...this.pending.keys()]) if (!voices.some((v) => v.midi === k)) this.pending.delete(k);
    for (const [k, a] of [...this.active]) if (!here.has(k) && ++a.miss >= missF) this.finish(k, a.n.t1 + 0.02);
  }
  private start(v: Voice, t: number) {
    this.active.set(v.midi, { n: { midi: v.midi, t0: t, t1: t, sal: v.sal, harm: [...v.harm], frames: 1, level0: v.sal, levelEnd: v.sal, cents: [v.cents] }, seen: 1, miss: 0, peak: v.sal, trough: v.sal });
  }
  private finish(k: number, t: number) {
    const a = this.active.get(k); if (!a) return;
    this.active.delete(k);
    a.n.t1 = Math.max(a.n.t1, t);
    const dur = Math.max(0.03, a.n.t1 - a.n.t0);
    const decay = a.peak > 0 && a.n.levelEnd > 0 ? (20 * Math.log10(a.peak / a.n.levelEnd)) / dur : 0;
    const cs = a.n.cents; const mean = cs.reduce((x, y) => x + y, 0) / cs.length;
    const vib = Math.sqrt(cs.reduce((x, y) => x + (y - mean) ** 2, 0) / cs.length);
    const fv = timbreFeatures(a.n.harm, decay, vib, a.n.midi);
    a.n.timbre = classifyTimbre(fv, a.n.midi);
    if (this.o.orchestra) a.n.cluster = this.assign(fv, a.n.timbre).id;
    this.onNote(a.n);
  }
  /** Agrupa por timbre (modo orquestra): mesmo grupo se as características estão perto. */
  private assign(fv: number[], tg: TimbreGuess): Cluster {
    // um grupo por família de timbre (flauta, cordas, metais…); se o limite estourar, vai para o mais parecido
    let best = this.clusters.find((c) => c.timbre.family === tg.family) ?? null;
    const max = this.o.maxClusters ?? 4;
    if (!best && this.clusters.length < max) { best = { id: this.clusters.length, fv: [...fv], count: 0, timbre: tg }; this.clusters.push(best); }
    if (!best) { let bd = Infinity; for (const c of this.clusters) { const d = Math.sqrt(c.fv.reduce((acc, x, i) => acc + (x - fv[i]) ** 2, 0)); if (d < bd) { bd = d; best = c; } } }
    best!.count++; best!.fv = best!.fv.map((x, i) => x + (fv[i] - x) / Math.min(best!.count, 20));
    return best!;
  }
  /** Fecha tudo (fim da captura). */
  flush(t: number) { for (const k of [...this.active.keys()]) this.finish(k, t); }
  activeNotes() { return [...this.active.values()].map((a) => a.n); }
}
