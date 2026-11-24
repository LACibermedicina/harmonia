// Afinador: altura, nota e desvio em cents do som que ENTRA (microfone / instrumento),
// ignorando o que a própria plataforma toca ao mesmo tempo.
//
// Como separa entrada × sistema:
//  1) cancelamento de eco do navegador no microfone (echoCancellation) — remove a maior parte do retorno;
//  2) subtração espectral com referência: a saída do sistema é lida direto do motor de áudio (tapOutput);
//     o ganho do vazamento é estimado por mínimos quadrados a cada quadro e o espectro da saída
//     (alargado ±1 bin) é subtraído do espectro do microfone;
//  3) a altura vem da soma harmônica do RESÍDUO (o timbre que sobrou é o seu), refinada por interpolação;
//     sem reprodução ativa, usa o YIN no domínio do tempo (mais preciso).
//  4) timbre: centróide espectral + perfil dos 8 primeiros harmônicos, e a semelhança desse perfil com
//     o som do sistema (se for alta, o afinador avisa que pode estar ouvindo a caixa de som).
import * as audio from "./audio";
import { detectPitch } from "./livecapture";
import { classifyTimbre, timbreFeatures } from "./polypitch";

export interface TunerReading {
  freq: number | null; midi: number | null; cents: number; clarity: number; level: number;
  playback: boolean; separated: boolean; centroid: number; harmonics: number[]; similarity: number; leak: number; family?: string;
}
type Fn = (r: TunerReading) => void;

let running: { stop: () => void } | null = null;
const fns = new Set<Fn>();
export let A4 = 440;
export const setA4 = (v: number) => { A4 = Math.max(400, Math.min(480, v)); };
export let subtract = true;
export const setSubtract = (v: boolean) => { subtract = v; };
export const onTuner = (fn: Fn) => { fns.add(fn); return () => fns.delete(fn); };
export const tunerRunning = () => !!running;

export async function startTuner(): Promise<void> {
  if (running) return;
  const c = audio.ac();
  if (c.state === "suspended") await c.resume();
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false } });
  const src = c.createMediaStreamSource(stream);
  const N = 8192;
  const mic = c.createAnalyser(); mic.fftSize = N; mic.smoothingTimeConstant = 0; src.connect(mic); // NÃO vai para a saída
  const ref = audio.tapOutput(N);
  const bins = N / 2, sr = c.sampleRate, hz = sr / N;
  const mDb = new Float32Array(bins), rDb = new Float32Array(bins), td = new Float32Array(N);
  const M = new Float32Array(bins), R = new Float32Array(bins), Res = new Float32Array(bins);
  // a saída chega ao microfone com atraso (alto-falante + ar + buffer): usa o máximo dos últimos ~200 ms
  const hist: Float32Array[] = Array.from({ length: 5 }, () => new Float32Array(bins)); let hi = 0;
  const centsHist: number[] = [];
  let smoothF = 0, lastMidi: number | null = null, hold = 0;
  const tick = () => {
    mic.getFloatFrequencyData(mDb); ref.getFloatFrequencyData(rDb); mic.getFloatTimeDomainData(td);
    let lvl = 0; for (let i = 0; i < N; i += 8) lvl = Math.max(lvl, Math.abs(td[i]));
    let rE = 0, mE = 0;
    const cur = hist[hi]; hi = (hi + 1) % hist.length;
    for (let i = 0; i < bins; i++) { cur[i] = Math.pow(10, rDb[i] / 20); }
    for (let i = 0; i < bins; i++) { M[i] = Math.pow(10, mDb[i] / 20); let r = 0; for (const hh of hist) if (hh[i] > r) r = hh[i]; R[i] = r; rE += cur[i] * cur[i]; mE += M[i] * M[i]; }
    const playback = audio.isPlaying() || Math.sqrt(rE / bins) > 1e-4;
    // referência alargada ±1 bin (pequenos desvios de fase/janela)
    let num = 0, den = 0;
    const Rw = Res; // reaproveita o buffer: primeiro Rw, depois resíduo
    for (let i = 1; i < bins - 1; i++) { Rw[i] = Math.max(R[i - 1], R[i], R[i + 1]); }
    let leak = 0;
    if (playback && subtract) {
      for (let i = 2; i < bins / 4; i++) { num += M[i] * Rw[i]; den += Rw[i] * Rw[i]; }
      leak = den > 0 ? Math.max(0, Math.min(8, num / den)) : 0;
      for (let i = 0; i < bins; i++) Res[i] = Math.max(0, M[i] - 1.4 * leak * Rw[i]);
    } else for (let i = 0; i < bins; i++) Res[i] = M[i];
    let resE = 0; for (let i = 2; i < bins / 4; i++) resE += Res[i] * Res[i];
    const separated = playback && subtract;
    let freq: number | null = null, clarity = 0;
    if (lvl > 0.01 && resE > 1e-7) {
      if (!separated) {
        const p = detectPitch(td.subarray(0, 4096), sr);
        if (p && p.clarity > 0.6) { freq = p.f; clarity = p.clarity; }
      }
      if (freq === null) {
        // soma harmônica do resíduo (f0 50–1500 Hz), com penalidade de meio-harmônicos contra erro de oitava
        let best = 0, bestK = 0;
        const amp = (f: number) => { const k = f / hz, i = Math.floor(k); return i + 1 < bins ? Math.max(Res[i], Res[i + 1]) : 0; };
        for (let k = Math.ceil(50 / hz); k < 1500 / hz; k++) {
          const f0 = k * hz; let s = 0, pen = 0;
          for (let hN = 1; hN <= 8; hN++) { const f = f0 * hN; if (f > sr / 2.2) break; s += amp(f) / Math.sqrt(hN); if (hN <= 4) pen += amp(f0 * (hN - 0.5)); }
          const sc = s - 0.6 * pen;
          if (sc > best) { best = sc; bestK = k; }
        }
        if (bestK) {
          // refina pelo pico do harmônico mais forte entre os 4 primeiros
          let bh = 1, bv = 0;
          for (let hN = 1; hN <= 4; hN++) { const i = Math.round(bestK * hN); if (i + 1 < bins && Res[i] > bv) { bv = Res[i]; bh = hN; } }
          const i = Math.round(bestK * bh); const a = Res[i - 1], b = Res[i], cc = Res[i + 1];
          const sh = (a - cc) / (2 * (a - 2 * b + cc) || 1);
          freq = ((i + (isFinite(sh) ? Math.max(-0.5, Math.min(0.5, sh)) : 0)) * hz) / bh;
          let tot = 0; for (let j = 2; j < bins / 4; j++) tot += Res[j];
          clarity = Math.min(1, best / (tot / 40 + 1e-9) / 6);
          if (clarity < 0.25) freq = null;
        }
      }
    }
    // timbre: centróide e perfil harmônico da entrada (e semelhança com a saída do sistema)
    let cw = 0, cs = 0; for (let i = 2; i < bins / 2; i++) { cw += Res[i]; cs += Res[i] * i * hz; }
    const centroid = cw > 0 ? cs / cw : 0;
    const harmonics: number[] = [], refH: number[] = [];
    if (freq) for (let hN = 1; hN <= 8; hN++) { const i = Math.round((freq * hN) / hz); harmonics.push(i < bins ? Math.max(Res[i - 1] ?? 0, Res[i], Res[i + 1] ?? 0) : 0); refH.push(i < bins ? Rw[i] ?? 0 : 0); }
    const mx = Math.max(1e-12, ...harmonics); const norm = harmonics.map((x) => x / mx);
    let dot = 0, na = 0, nb = 0; harmonics.forEach((x, k) => { dot += x * refH[k]; na += x * x; nb += refH[k] * refH[k]; });
    const similarity = playback && na && nb ? dot / Math.sqrt(na * nb) : 0;
    // suavização: segura a última nota ~150 ms para não piscar
    let midi: number | null = null, cents = 0;
    if (freq) {
      smoothF = smoothF && Math.abs(1200 * Math.log2(freq / smoothF)) < 60 ? smoothF * 0.6 + freq * 0.4 : freq;
      const mf = 69 + 12 * Math.log2(smoothF / A4); midi = Math.round(mf); cents = Math.round((mf - midi) * 100);
      lastMidi = midi; hold = 4;
    } else if (hold > 0) { hold--; midi = lastMidi; } else smoothF = 0;
    // família do timbre (estimada) com vibrato medido pela variação dos cents
    if (midi !== null) { centsHist.push(cents); if (centsHist.length > 25) centsHist.shift(); } else centsHist.length = 0;
    const mc = centsHist.reduce((a, b) => a + b, 0) / (centsHist.length || 1);
    const vib = Math.sqrt(centsHist.reduce((a, b) => a + (b - mc) ** 2, 0) / (centsHist.length || 1));
    const family = midi !== null && norm.length ? classifyTimbre(timbreFeatures(norm, 0, vib, midi), midi).label : undefined;
    const r: TunerReading = { freq: freq ? smoothF : null, midi, cents, clarity, level: Math.min(1, lvl * 2), playback, separated, centroid, harmonics: norm, similarity, leak, family };
    fns.forEach((f) => f(r));
  };
  const timer = window.setInterval(tick, 40);
  running = { stop: () => { clearInterval(timer); stream.getTracks().forEach((t) => t.stop()); try { src.disconnect(); } catch { /* */ } audio.untapOutput(ref); } };
}

export function stopTuner() { running?.stop(); running = null; }

/** Para a captura ao vivo: diz se a altura detectada no microfone é, na verdade, o som do sistema
 *  vazando pela caixa (compara a energia dos harmônicos de f no microfone com a saída do motor de áudio). */
export function makeSeparator(mic: AnalyserNode) {
  const ref = audio.tapOutput(mic.fftSize);
  const bins = mic.fftSize / 2, hz = mic.context.sampleRate / mic.fftSize;
  const mDb = new Float32Array(bins), rDb = new Float32Array(bins);
  const hist: Float32Array[] = Array.from({ length: 5 }, () => new Float32Array(bins)); let hi = 0;
  const lin = (d: number) => Math.pow(10, d / 20);
  return {
    /** chamar a cada quadro (mantém o histórico da saída para compensar o atraso da caixa → microfone) */
    feed() { ref.getFloatFrequencyData(rDb); const h = hist[hi]; hi = (hi + 1) % hist.length; for (let i = 0; i < bins; i++) h[i] = lin(rDb[i]); },
    isSystem(f: number): boolean {
      if (!audio.isPlaying()) return false;
      mic.getFloatFrequencyData(mDb);
      let num = 0, den = 0, mH = 0, rH = 0;
      const R = (i: number) => { let r = 0; for (const h of hist) r = Math.max(r, h[i - 1] ?? 0, h[i], h[i + 1] ?? 0); return r; };
      for (let i = 4; i < bins / 4; i += 2) { const m = lin(mDb[i]), r = R(i); num += m * r; den += r * r; }
      const leak = den > 0 ? num / den : 0;
      for (let k = 1; k <= 5; k++) { const i = Math.round((f * k) / hz); if (i + 1 >= bins) break; mH += Math.max(lin(mDb[i - 1]), lin(mDb[i]), lin(mDb[i + 1])); rH += R(i) * leak; }
      return mH < rH * 2.2; // o que o microfone ouve nessa altura é explicado pelo vazamento do sistema
    },
    dispose() { audio.untapOutput(ref); },
  };
}
