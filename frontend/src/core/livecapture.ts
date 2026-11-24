// Captura de notas ao vivo: a pauta é escrita em tempo real enquanto você canta ou toca.
//  • Microfone: detecção de altura (autocorrelação normalizada, estilo YIN) a cada ~23 ms, com segmentação
//    em notas (estável ≥ 3 quadros = nota; silêncio/troca = fim) e quantização na grade do andamento.
//  • Teclado MIDI (Web MIDI), quando houver: notas e intensidade exatas.
// Cada nota terminada entra numa camada NOVA "🎤 Captura em tempo real" (cor própria) (com contagem de 1 compasso e metrônomo opcional).
import * as audio from "./audio";
import { makeSeparator } from "./tuner";
import { NoiseGate, frameVoices, Tracker, snapDur, snapToKey, PolyMode, Voice } from "./polypitch";
import { detectKey, suggestChords } from "./analysis";
import { store, newLayer } from "./store";
import { beatsPerMeasure, Layer, Note, uid } from "./types";

export interface CaptureOpts {
  fromBeat?: number; grid?: number; metronome?: boolean;
  onPitch?: (midi: number | null, level: number) => void; // indicador ao vivo
  onNote?: (n: Note) => void;
  /** Relógio externo (tempo do AudioContext → tempo musical): usado ao compor por cima da reprodução. */
  clock?: (ctxTime: number) => number;
  layerName?: string; layerId?: string;
  /** uma nota por vez, várias (acordes) ou automático (detecta sozinho) */
  notes?: PolyMode;
  /** "auto": notas graves vão para a mão esquerda (pauta de Fá); "one": tudo numa camada */
  hands?: "auto" | "one";
  /** orquestra: vários instrumentos ao mesmo tempo, cada timbre numa camada */
  orchestra?: boolean;
  /** afina na tonalidade da partitura (nota fora da escala perto de uma da escala vai para ela) */
  snapKey?: boolean;
}
export interface CapturePrefs { notes: PolyMode; hands: "auto" | "one"; orchestra: boolean; snapKey: boolean; harmonize: boolean }
const CP_KEY = "harmonia.capture.opts";
export function capturePrefs(): CapturePrefs {
  const d: CapturePrefs = { notes: "auto", hands: "auto", orchestra: false, snapKey: true, harmonize: true };
  try { return { ...d, ...JSON.parse(localStorage.getItem(CP_KEY) || "{}") }; } catch { return d; }
}
export function setCapturePrefs(p: Partial<CapturePrefs>) { try { localStorage.setItem(CP_KEY, JSON.stringify({ ...capturePrefs(), ...p })); } catch { /* */ } }
export interface Capture { stop: () => Promise<number>; layerId: string; midi: boolean }

// ---- retorno visual da captura em tempo real -------------------------------------------------
// Cor própria e camada nova a cada captura (🎤), para nunca se confundir com o que foi escrito à mão.
export const LIVE_COLOR = "#14d8c4";
/** Estado instantâneo da captura: nota que está soando agora (ainda não gravada) e onde ela começou. */
export interface LiveState { layerId: string; pitch: number | null; startBeat: number; nowBeat: number; level: number; notes: number; input: "mic" | "midi"; extra?: { pitch: number; startBeat: number }[]; timbre?: string }
let liveNow: LiveState | null = null;
const liveFns = new Set<(s: LiveState | null) => void>();
export const liveState = () => liveNow;
export const onLive = (fn: (s: LiveState | null) => void) => { liveFns.add(fn); return () => liveFns.delete(fn); };
function setLive(s: LiveState | null) { liveNow = s; liveFns.forEach((f) => f(s)); }

/** Cria a camada “🎤 Captura em tempo real” (numerada, cor própria, marcada como live). */
export function newLiveLayer(label = "Captura em tempo real"): Layer {
  const n = store.score.layers.filter((l) => l.live).length + 1;
  const hhmm = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  const l = newLayer("melody", `🎤 ${label} ${n} · ${hhmm}`, "treble");
  l.color = LIVE_COLOR; l.live = true;
  return l;
}

/** Frequência fundamental por autocorrelação normalizada (diferença cumulativa, YIN simplificado). */
export function detectPitch(buf: Float32Array, sr: number): { f: number; clarity: number } | null {
  const n = buf.length, half = Math.floor(n / 2);
  let rms = 0; for (let i = 0; i < n; i++) rms += buf[i] * buf[i];
  rms = Math.sqrt(rms / n); if (rms < 0.012) return null;
  const minLag = Math.floor(sr / 1050), maxLag = Math.min(half - 1, Math.floor(sr / 65));
  const d = new Float32Array(maxLag + 1);
  for (let lag = minLag; lag <= maxLag; lag++) { let s = 0; for (let i = 0; i < half; i++) { const x = buf[i] - buf[i + lag]; s += x * x; } d[lag] = s; }
  // diferença cumulativa normalizada
  let run = 0; const cm = new Float32Array(maxLag + 1); cm[minLag] = 1;
  for (let lag = minLag; lag <= maxLag; lag++) { run += d[lag]; cm[lag] = run ? (d[lag] * (lag - minLag + 1)) / run : 1; }
  let best = -1;
  for (let lag = minLag + 1; lag < maxLag; lag++) if (cm[lag] < 0.15 && cm[lag] <= cm[lag + 1]) { best = lag; break; }
  if (best < 0) { let mn = 1; for (let lag = minLag; lag <= maxLag; lag++) if (cm[lag] < mn) { mn = cm[lag]; best = lag; } if (mn > 0.35) return null; }
  // interpolação parabólica
  const a = cm[best - 1] ?? cm[best], b = cm[best], c = cm[best + 1] ?? cm[best];
  const shift = (a - c) / (2 * (a - 2 * b + c) || 1);
  return { f: sr / (best + (isFinite(shift) ? shift : 0)), clarity: 1 - b };
}
export const freqToMidi = (f: number) => Math.round(69 + 12 * Math.log2(f / 440));

export async function startCapture(o: CaptureOpts = {}): Promise<Capture> {
  const s = store.score, bpm = beatsPerMeasure(s), spb = 60 / s.tempo, grid = o.grid ?? 0.25;
  const fromBeat = o.fromBeat ?? 0;
  const existing = o.layerId ? store.score.layers.find((l) => l.id === o.layerId) : undefined;
  const layer = existing ?? newLiveLayer(o.layerName);
  if (!existing) store.mutate((sc) => { sc.layers.push(layer); store.selectedLayer = layer.id; }, "capture");
  const c = audio.ac();
  // sem relógio externo: contagem de 1 compasso (cliques) e, depois, metrônomo contínuo opcional
  const t0 = o.clock ? c.currentTime : c.currentTime + 0.1 + bpm * spb;
  if (!o.clock) for (let i = 0; i < bpm; i++) audio.click(c.currentTime + 0.1 + i * spb, i === 0);
  let metroTimer = 0;
  if (o.metronome && !o.clock) { let k = 0; metroTimer = window.setInterval(() => { const t = t0 + k * spb; if (t - c.currentTime < 0.3) { audio.click(Math.max(t, c.currentTime), k % bpm === 0); k++; } }, 40); }
  const beatAt = (time: number) => (o.clock ? o.clock(time) : fromBeat + (time - t0) / spb);
  const q = (b: number) => Math.max(o.clock ? 0 : fromBeat, Math.round(b / grid) * grid);
  const cp = { ...capturePrefs(), ...Object.fromEntries(Object.entries({ notes: o.notes, hands: o.hands, orchestra: o.orchestra, snapKey: o.snapKey }).filter(([, v]) => v !== undefined)) } as CapturePrefs;
  // camadas da captura: principal (mão direita / instrumento 1), mão esquerda e um par por instrumento (orquestra)
  const layers = new Map<string, string>([["0:treble", layer.id]]);
  const layerFor = (cluster: number, staff: "treble" | "bass", label?: string, inst?: string) => {
    const key = `${cluster}:${staff}`;
    const have = layers.get(key);
    if (have && store.score.layers.some((l) => l.id === have)) return have;
    const nl = newLiveLayer(cp.orchestra ? `Instrumento ${cluster + 1}${label ? " — " + label + " (estimado)" : ""}` : "Captura em tempo real");
    if (staff === "bass") { nl.staff = "bass"; nl.name += " — mão esquerda"; }
    if (inst) { nl.instrument = inst; }
    if (cluster > 0) nl.color = ["#14d8c4", "#ff9f1c", "#9b5de5", "#f15bb5", "#00bbf9"][cluster % 5];
    store.mutate((sc) => sc.layers.push(nl), "capture");
    layers.set(key, nl.id);
    return nl.id;
  };
  const tonic = ((((s.keySig ?? 0) * 7) % 12) + 12) % 12;
  const scale = cp.snapKey ? [0, 2, 4, 5, 7, 9, 11].map((x) => (x + tonic) % 12) : null;
  let split = 60; // dó central: abaixo vai para a mão esquerda
  const add = (pitch: number, onT: number, offT: number, vel: number, extra: { cluster?: number; label?: string; inst?: string; cents?: number } = {}) => {
    if (!o.clock && beatAt(offT) < fromBeat) return;
    const st = q(beatAt(onT));
    // duração real → figura (inclui pontuadas: 0,75 · 1,5 · 3)
    const dur = Math.max(grid, snapDur(Math.max(grid, beatAt(offT) - beatAt(onT))));
    const p2 = snapToKey(pitch, extra.cents ?? 0, scale);
    const staff: "treble" | "bass" = cp.hands === "auto" && p2 < split ? "bass" : "treble";
    const lid = extra.cluster || staff === "bass" ? layerFor(extra.cluster ?? 0, staff, extra.label, extra.inst) : layer.id;
    const n: Note = { id: uid(), pitch: p2, start: st, dur, vel };
    store.mutate((sc) => { const l = sc.layers.find((x) => x.id === lid); if (l) l.notes.push(n); sc.measures = Math.max(sc.measures, Math.ceil((st + dur) / bpm)); while (sc.chords.length < sc.measures) sc.chords.push([]); }, "capture-note");
    o.onNote?.(n);
  };
  const captured = () => [...layers.values()].flatMap((id) => store.score.layers.find((l) => l.id === id)?.notes ?? []);
  const t0Beat = beatAt(c.currentTime);
  /** Depois de gravar: harmoniza os compassos captados que ainda não têm cifra (desfazível). */
  const finishUp = () => {
    const ns = captured();
    if (cp.harmonize && ns.length >= 3) {
      const ms = new Set(ns.map((n) => Math.floor(n.start / bpm + 1e-9)));
      const empty = [...ms].filter((m) => !store.score.chords[m]?.length);
      if (empty.length) {
        const key = detectKey(ns, store.score.keySig);
        const sug = suggestChords(store.score, ns, key);
        store.mutate((sc) => { for (const m of empty) if (sug[m]?.length) sc.chords[m] = sug[m]; }, "harmonize");
      }
    }
    // camadas vazias da captura somem
    const ids = new Set(layers.values());
    store.mutate((sc) => { sc.layers = sc.layers.filter((l) => !ids.has(l.id) || l.notes.length || l.id === layer.id); }, "capture-end");
    void t0Beat;
  };

  const notesIn = () => store.score.layers.find((x) => x.id === layer.id)?.notes.length ?? 0;
  const pushLive = (pitch: number | null, startBeat: number, level: number, input: "mic" | "midi") =>
    setLive({ layerId: layer.id, pitch, startBeat, nowBeat: beatAt(c.currentTime), level, notes: notesIn(), input });
  setLive({ layerId: layer.id, pitch: null, startBeat: 0, nowBeat: beatAt(c.currentTime), level: 0, notes: 0, input: "mic" });
  // ---- teclado MIDI (preferido quando existe)
  let midiAccess: any = null; const held = new Map<number, { t: number; v: number }>();
  try {
    if ((navigator as any).requestMIDIAccess) {
      midiAccess = await (navigator as any).requestMIDIAccess();
      const inputs = [...midiAccess.inputs.values()];
      if (!inputs.length) midiAccess = null;
      else inputs.forEach((inp: any) => (inp.onmidimessage = (e: any) => {
        const [st, note, vel] = e.data; const cmd = st & 0xf0;
        if (cmd === 0x90 && vel > 0) { held.set(note, { t: c.currentTime, v: vel }); audio.playNote(note, 0, 0.4, vel); o.onPitch?.(note, vel / 127); pushLive(note, beatAt(c.currentTime), vel / 127, "midi"); }
        else if (cmd === 0x80 || (cmd === 0x90 && vel === 0)) { const h = held.get(note); if (h) { held.delete(note); add(note, h.t, c.currentTime, h.v); } o.onPitch?.(null, 0); pushLive(null, 0, 0, "midi"); }
      }));
    }
  } catch { midiAccess = null; }

  // ---- microfone: limpeza de ruído, várias notas ao mesmo tempo (ou uma), timbre e duração real
  let stream: MediaStream | null = null, timer = 0;
  if (!midiAccess) {
    // sem supressão de ruído do navegador (ela "come" notas longas); a limpeza é feita aqui, por faixa de frequência
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false } });
    dispatchEvent(new CustomEvent("harmonia:action", { detail: "tuner-auto" }));
    const src = c.createMediaStreamSource(stream);
    const hp = c.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 45; // remove ronco/vento
    const an = c.createAnalyser(); an.fftSize = 8192; an.smoothingTimeConstant = 0; src.connect(hp).connect(an);
    const sepr = makeSeparator(an); // ignora o que a própria plataforma está tocando (ex.: loop do "ao vivo")
    const td = new Float32Array(an.fftSize), db = new Float32Array(an.fftSize / 2), mag = new Float32Array(an.fftSize / 2);
    const hz = c.sampleRate / an.fftSize, gate = new NoiseGate();
    const tracker = new Tracker((tn) => {
      const lvl = Math.min(1, Math.sqrt(tn.sal) * 6);
      const cents = tn.cents.reduce((x, y) => x + y, 0) / tn.cents.length;
      const cl = cp.orchestra ? tn.cluster ?? 0 : 0;
      const tb = cp.orchestra ? tracker.clusters[cl]?.timbre ?? tn.timbre : tn.timbre;
      lastTimbre = tn.timbre?.label ?? lastTimbre;
      add(tn.midi, tn.t0, tn.t1, Math.round(50 + lvl * 70), { cluster: cl, label: tb?.label, inst: cp.orchestra ? tb?.instrument : undefined, cents });
    }, { orchestra: cp.orchestra, minFrames: cp.notes === "mono" ? 3 : 2, missFrames: 3 });
    let lastTimbre = "";
    timer = window.setInterval(() => {
      const now = c.currentTime;
      if (now < t0 - 0.05) return;
      an.getFloatTimeDomainData(td); an.getFloatFrequencyData(db);
      for (let i = 0; i < db.length; i++) mag[i] = Math.pow(10, db[i] / 20);
      sepr.feed();
      let lvl = 0; for (let i = 0; i < td.length; i += 8) lvl = Math.max(lvl, Math.abs(td[i]));
      const clean = gate.clean(mag, hz);
      let voices: Voice[] = [];
      if (lvl > 0.008) {
        if (cp.notes === "mono") {
          // uma nota por vez: YIN no domínio do tempo (mais preciso) + timbre pelo espectro
          const p = detectPitch(td.subarray(td.length - 2048), c.sampleRate);
          if (p && p.clarity > 0.6) { const mf = 69 + 12 * Math.log2(p.f / 440), m = Math.round(mf); const fv = frameVoices(clean, hz, "mono"); voices = [{ midi: m, cents: Math.round((mf - m) * 100), f: p.f, sal: fv[0]?.sal ?? lvl, harm: fv[0]?.harm ?? [] }]; }
        } else voices = frameVoices(clean, hz, cp.orchestra ? "poly" : cp.notes, cp.orchestra ? 6 : 4, 33, 96, cp.orchestra);
      }
      voices = voices.filter((v) => v.midi >= 28 && v.midi <= 100 && !sepr.isSystem(v.f));
      tracker.push(voices, now);
      // divisão das mãos acompanha o que está sendo tocado: entre as vozes mais aguda e mais grave
      if (voices.length >= 2) { const ps = voices.map((v) => v.midi).sort((x, y) => x - y); if (ps[ps.length - 1] - ps[0] >= 10) split = Math.round((split * 4 + (ps[0] + ps[ps.length - 1]) / 2) / 5); }
      const act = tracker.activeNotes().sort((x, y) => y.midi - x.midi);
      o.onPitch?.(act[0]?.midi ?? voices[0]?.midi ?? null, Math.min(1, lvl * 2));
      setLive({ layerId: layer.id, pitch: act[0]?.midi ?? voices[0]?.midi ?? null, startBeat: act[0] ? beatAt(act[0].t0) : beatAt(now), nowBeat: beatAt(now), level: Math.min(1, lvl * 2),
        notes: captured().length, input: "mic", extra: act.slice(1).map((n) => ({ pitch: n.midi, startBeat: beatAt(n.t0) })), timbre: lastTimbre });
    }, 23);
    return {
      layerId: layer.id, midi: false,
      stop: async () => {
        clearInterval(timer); clearInterval(metroTimer);
        tracker.flush(c.currentTime);
        stream?.getTracks().forEach((t) => t.stop()); sepr.dispose();
        o.onPitch?.(null, 0); setLive(null);
        finishUp();
        return captured().length;
      },
    };
  }
  return {
    layerId: layer.id, midi: true,
    stop: async () => {
      clearInterval(metroTimer);
      held.forEach((h, note) => add(note, h.t, c.currentTime, h.v)); held.clear();
      [...midiAccess.inputs.values()].forEach((inp: any) => (inp.onmidimessage = null));
      setLive(null);
      finishUp();
      return captured().length;
    },
  };
}
