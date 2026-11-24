// Motor de áudio: síntese de piano (WebAudio), reprodução por camadas (mute/solo/volume),
// metrônomo, gravação por microfone com contagem, e recorte/ganho de áudio antes do envio.
import { Score, Layer, staves } from "./types";
import { instrument, Timbre } from "./instruments";

let ctx: AudioContext | null = null;
let master: GainNode;
export const ac = () => {
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain(); master.gain.value = 0.8;
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp).connect(ctx.destination);
  }
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
};

const freq = (p: number) => 440 * Math.pow(2, (p - 69) / 12);

/** Piano sintetizado: parciais inarmônicos com envelope percussivo. Outros timbres: ver `voice()`. */
export function playNote(pitch: number, when: number, dur: number, vel = 80, gain = 1, dest?: AudioNode, timbre: Timbre = "piano") {
  if (timbre !== "piano") return voice(timbre, pitch, when, dur, vel, gain, dest);
  const c = ac();
  const out = c.createGain();
  const v = (vel / 127) * 0.32 * gain;
  const t0 = Math.max(c.currentTime, when);
  const decay = Math.max(0.4, 3.2 - (pitch - 40) * 0.03);
  out.gain.setValueAtTime(0, t0);
  out.gain.linearRampToValueAtTime(v, t0 + 0.005);
  out.gain.exponentialRampToValueAtTime(v * 0.35, t0 + 0.15);
  out.gain.exponentialRampToValueAtTime(Math.max(0.0001, v * 0.35 * Math.exp(-dur / decay)), t0 + dur);
  out.gain.exponentialRampToValueAtTime(0.0001, t0 + dur + 0.25);
  const lp = c.createBiquadFilter();
  lp.type = "lowpass"; lp.frequency.value = 1200 + vel * 40;
  out.connect(lp).connect(dest || master);
  const f = freq(pitch);
  [[1, 1], [2, 0.45], [3, 0.22], [4, 0.12], [5, 0.06]].forEach(([k, a]) => {
    const o = c.createOscillator();
    o.type = k === 1 ? "triangle" : "sine";
    o.frequency.value = f * k * (1 + 0.0004 * k * k);
    const g = c.createGain(); g.gain.value = a;
    o.connect(g).connect(out);
    o.start(t0); o.stop(t0 + dur + 0.3);
  });
}

// timbres sustentados/dedilhados simples: forma de onda, ataque, filtro, vibrato e decaimento
const TIMBRES: Record<Exclude<Timbre, "piano">, { wave: OscillatorType; atk: number; rel: number; cut: number; vib: number; pluck?: boolean; detune?: number; level: number }> = {
  strings: { wave: "sawtooth", atk: 0.09, rel: 0.25, cut: 2600, vib: 5, detune: 6, level: 0.16 },
  winds: { wave: "sine", atk: 0.06, rel: 0.12, cut: 4000, vib: 4, level: 0.3 },
  reed: { wave: "square", atk: 0.04, rel: 0.1, cut: 1800, vib: 3, level: 0.12 },
  brass: { wave: "sawtooth", atk: 0.05, rel: 0.12, cut: 2200, vib: 2, level: 0.15 },
  plucked: { wave: "triangle", atk: 0.003, rel: 0.4, cut: 3000, vib: 0, pluck: true, level: 0.32 },
  organ: { wave: "sine", atk: 0.02, rel: 0.08, cut: 5000, vib: 0, level: 0.14 },
  voice: { wave: "triangle", atk: 0.08, rel: 0.2, cut: 1500, vib: 6, level: 0.3 },
};
function voice(t: Exclude<Timbre, "piano">, pitch: number, when: number, dur: number, vel: number, gain: number, dest?: AudioNode) {
  const c = ac(); const p = TIMBRES[t];
  const t0 = Math.max(c.currentTime, when);
  const v = (vel / 127) * p.level * gain;
  const out = c.createGain();
  out.gain.setValueAtTime(0, t0);
  out.gain.linearRampToValueAtTime(v, t0 + p.atk);
  if (p.pluck) out.gain.exponentialRampToValueAtTime(Math.max(0.0001, v * Math.exp(-dur * 1.6)), t0 + dur);
  else out.gain.setValueAtTime(v * 0.85, t0 + Math.max(p.atk, dur - 0.02));
  out.gain.exponentialRampToValueAtTime(0.0001, t0 + dur + p.rel);
  const lp = c.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = p.cut + vel * 10;
  out.connect(lp).connect(dest || master);
  const f = freq(pitch);
  const oscs: OscillatorNode[] = [];
  const mk = (type: OscillatorType, mult: number, amp: number, det = 0) => {
    const o = c.createOscillator(); o.type = type; o.frequency.value = f * mult; o.detune.value = det;
    const g = c.createGain(); g.gain.value = amp; o.connect(g).connect(out); oscs.push(o);
  };
  mk(p.wave, 1, 1);
  if (p.detune) mk(p.wave, 1, 0.7, p.detune);
  if (t === "organ") { mk("sine", 2, 0.5); mk("sine", 3, 0.25); mk("sine", 0.5, 0.35); }
  if (t === "voice") mk("sine", 2, 0.25);
  if (p.vib) { // vibrato entra depois do ataque
    const lfo = c.createOscillator(); const lg = c.createGain();
    lfo.frequency.value = 5.2; lg.gain.setValueAtTime(0, t0); lg.gain.linearRampToValueAtTime(p.vib, t0 + Math.min(0.4, dur));
    lfo.connect(lg); oscs.forEach((o) => lg.connect(o.detune)); lfo.start(t0); lfo.stop(t0 + dur + p.rel + 0.05);
  }
  oscs.forEach((o) => { o.start(t0); o.stop(t0 + dur + p.rel + 0.05); });
}

/** Timbre da camada segundo o instrumento da pauta em que ela está. */
export function timbreOf(s: Score, l: Layer): Timbre {
  if (l.instrument) return instrument(l.instrument).timbre;
  const st = staves(s);
  return instrument((l.staff === "bass" ? st.lower : st.upper).instrument).timbre;
}

export function click(when: number, accent: boolean, dest?: AudioNode) {
  const c = ac();
  const o = c.createOscillator(); const g = c.createGain();
  o.frequency.value = accent ? 1600 : 1000;
  g.gain.setValueAtTime(0.25, when); g.gain.exponentialRampToValueAtTime(0.0001, when + 0.05);
  o.connect(g).connect(dest || master); o.start(when); o.stop(when + 0.06);
}

// ------------------------------------------------------------ sessões de reprodução
// Uma única sessão toca por vez (partitura ou trecho de áudio). O player universal controla a sessão
// atual: pausar, retomar, avançar, parar, volume geral — e mostra qual quadro está tocando.
export interface PlaySource { id: string; label: string; icon?: string; focus?: () => void }
export interface PlayerState { source: PlaySource | null; playing: boolean; paused: boolean; pos: number; dur: number }
interface Session { source: PlaySource; startedAt: number; offset: number; dur: number; bus: GainNode; stop: () => void; replay: (fromSec: number) => void }
export interface Transport { stop: () => void; startedAt: number; spb: number; fromBeat: number; }
let current: Session | null = null;
let last: { source: PlaySource; replay: (fromSec: number) => void; dur: number } | null = null;
let pausedAt = -1;
const audioCache = new Map<string, AudioBuffer>();
const layerBus = new Map<string, { gain: GainNode; an: AnalyserNode }>();
let masterAn: AnalyserNode | null = null;

async function loadBuffer(url: string) {
  if (audioCache.has(url)) return audioCache.get(url)!;
  const buf = await ac().decodeAudioData(await (await fetch(url)).arrayBuffer());
  audioCache.set(url, buf); return buf;
}

/** Áudio decodificado de uma camada de gravação (blob local ou mídia já enviada). */
export function layerBuffer(l: Layer): Promise<AudioBuffer> {
  const url = l.audioUrl || (l.audio ? `/api/media/${l.audio}` : "");
  if (!url) return Promise.reject(new Error("gravação sem áudio"));
  return loadBuffer(url);
}

export function audibleLayers(s: Score): Layer[] {
  const solo = s.layers.filter((l) => l.solo);
  return (solo.length ? solo : s.layers.filter((l) => !l.muted));
}

function newBus() {
  const c = ac();
  const bus = c.createGain();
  if (!masterAn) { masterAn = c.createAnalyser(); masterAn.fftSize = 512; master.connect(masterAn); }
  bus.connect(master);
  return bus;
}

/** Aplica ao vivo volume, mudo e solo de cada camada (mesa de som) na sessão em andamento. */
export function liveMix(s: Score) {
  const aud = new Set(audibleLayers(s).map((l) => l.id));
  const c = ctx; if (!c) return;
  for (const l of s.layers) {
    const b = layerBus.get(l.id); if (!b) continue;
    b.gain.gain.setTargetAtTime(aud.has(l.id) ? l.volume : 0, c.currentTime, 0.02);
  }
}
export function setMasterVolume(v: number) { ac(); master.gain.setTargetAtTime(Math.max(0, Math.min(1.2, v)), ctx!.currentTime, 0.02); try { localStorage.setItem("harmonia.volume", String(v)); } catch { /* */ } }
export function masterVolume() { const v = parseFloat((() => { try { return localStorage.getItem("harmonia.volume") || ""; } catch { return ""; } })()); return isNaN(v) ? 0.8 : v; }
/** Nível (0–1) de uma camada ou do master — para os medidores da mesa. */
export function level(layerId?: string) {
  const an = layerId ? layerBus.get(layerId)?.an : masterAn;
  if (!an || !current) return 0;
  const d = new Float32Array(an.fftSize); an.getFloatTimeDomainData(d);
  let m = 0; for (let i = 0; i < d.length; i++) m = Math.max(m, Math.abs(d[i]));
  return Math.min(1, m * 1.6);
}

function startSession(source: PlaySource, dur: number, offset: number, bus: GainNode, replay: (fromSec: number) => void, onStop: () => void) {
  const c = ac();
  current = { source, startedAt: c.currentTime + 0.12, offset, dur, bus, replay,
    stop: () => {
      onStop();
      const t = c.currentTime;
      bus.gain.cancelScheduledValues(t); bus.gain.setValueAtTime(bus.gain.value, t); bus.gain.linearRampToValueAtTime(0, t + 0.04);
      setTimeout(() => { try { bus.disconnect(); } catch { /* */ } }, 120);
    } };
  last = { source, replay, dur };
  pausedAt = -1;
  stateListeners.forEach((f) => f(true)); emit();
}

/** Toca a partitura a partir de `fromBeat` (opcionalmente só um trecho). `source` identifica o quadro no player.
 *  `rangeStart` (interno) guarda o início do trecho original para pausar/avançar dentro dele. */
// ---- posição de leitura da PARTITURA (qualquer origem: editor, pentagrama do desktop, ao vivo)
// b = tempo atual; null = parou (ended = chegou ao fim). O editor desenha a guia e o compasso em execução.
const scoreBeatFns = new Set<(b: number | null, srcId: string, ended?: boolean) => void>();
export const onScoreBeat = (fn: (b: number | null, srcId: string, ended?: boolean) => void) => { scoreBeatFns.add(fn); return () => scoreBeatFns.delete(fn); };
let scoreSrc = "";
const emitBeat = (b: number | null, ended = false) => scoreBeatFns.forEach((f) => f(b, scoreSrc, ended));

export async function play(s: Score, opts: { fromBeat?: number; toBeat?: number; rangeStart?: number; metronome?: boolean; loop?: boolean; onBeat?: (b: number) => void; onEnd?: () => void } = {},
  source: PlaySource = { id: "score", label: "Partitura", icon: "🎼" }): Promise<Transport> {
  stop();
  const c = ac();
  const spb = 60 / s.tempo;
  const from = opts.fromBeat || 0;
  const rangeStart = opts.rangeStart ?? (opts.toBeat !== undefined ? from : 0);
  const bpmM = (s.timeSig[0] * 4) / s.timeSig[1];
  const end = opts.toBeat ?? Math.max(s.measures * bpmM, ...s.layers.flatMap((l) => l.notes.map((n) => n.start + n.dur)));
  const t0 = c.currentTime + 0.12;
  const bus = newBus();
  layerBus.clear();
  const sources: AudioScheduledSourceNode[] = [];
  let raf = 0;
  startSession(source, (end - rangeStart) * spb, (from - rangeStart) * spb, bus,
    (sec) => { play(s, { ...opts, rangeStart, fromBeat: rangeStart + sec / spb }, source); },
    () => { cancelAnimationFrame(raf); sources.forEach((x) => { try { x.stop(); } catch { /* */ } }); });
  const mine = current;
  scoreSrc = source.id;
  const aud = new Set(audibleLayers(s).map((l) => l.id));
  // todas as camadas são agendadas (mudas com ganho 0) para a mesa poder abrir/fechar canais ao vivo
  for (const l of s.layers) {
    const g = c.createGain(); g.gain.value = aud.has(l.id) ? l.volume : 0;
    const an = c.createAnalyser(); an.fftSize = 256;
    g.connect(an); g.connect(bus);
    layerBus.set(l.id, { gain: g, an });
    const tb = timbreOf(s, l);
    for (const n of l.notes) {
      if (n.start + n.dur <= from || n.start >= end) continue;
      const st = Math.max(n.start, from);
      playNote(n.pitch, t0 + (st - from) * spb, (Math.min(n.start + n.dur, end) - st) * spb, n.vel ?? 80, 1, g, tb);
    }
  }
  for (const l of s.layers) {
    const url = l.audioUrl || (l.audio ? `/api/media/${l.audio}` : "");
    if (!url) continue;
    try {
      const buf = await loadBuffer(url);
      if (current !== mine) break; // parou ou outra sessão começou enquanto carregava
      const src = c.createBufferSource(); src.buffer = buf;
      src.connect(layerBus.get(l.id)!.gain);
      const offset = from * spb - (l.audioOffset || 0);
      const when = Math.max(t0, c.currentTime);
      if (offset >= 0) { if (offset < buf.duration) src.start(when, offset + (when - t0)); } else src.start(t0 - offset);
      sources.push(src);
    } catch { /* mídia indisponível */ }
  }
  if (opts.metronome) for (let b = Math.ceil(from); b < end; b++) click(t0 + (b - from) * spb, b % bpmM === 0, bus);
  const tick = () => {
    if (current !== mine) { if (!current) emitBeat(null); return; }
    const b = from + (c.currentTime - t0) / spb;
    if (b >= end) {
      if (opts.loop) { play(s, { ...opts, fromBeat: rangeStart }, source); return; }
      stop(); emitBeat(null, true); opts.onEnd?.(); return;
    }
    opts.onBeat?.(Math.max(from, b));
    emitBeat(Math.max(from, b));
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return { stop, startedAt: t0, spb, fromBeat: from };
}

/** Toca um trecho de áudio (ex.: faixa do Importar) como sessão do player universal: pausar, avançar,
 *  voltar e mover o ponteiro funcionam dentro do trecho [rangeStart, to]. */
export function playBuffer(buf: AudioBuffer, o: { from?: number; to?: number; rangeStart?: number; gainDb?: number; source: PlaySource }) {
  stop();
  const c = ac();
  const to = Math.min(buf.duration, o.to ?? buf.duration);
  const rangeStart = o.rangeStart ?? o.from ?? 0;
  const from = Math.max(rangeStart, Math.min(to - 0.02, o.from ?? rangeStart));
  const bus = newBus();
  const g = c.createGain(); g.gain.value = Math.pow(10, (o.gainDb || 0) / 20);
  const src = c.createBufferSource(); src.buffer = buf; src.connect(g).connect(bus);
  src.start(c.currentTime + 0.12, from, Math.max(0.02, to - from));
  startSession(o.source, to - rangeStart, from - rangeStart, bus,
    (sec) => playBuffer(buf, { ...o, rangeStart, to, from: rangeStart + sec }),
    () => { src.onended = null; try { src.stop(); } catch { /* */ } });
  const mine = current;
  src.onended = () => { if (current === mine) stop(); };
}

const stateListeners = new Set<(playing: boolean) => void>();
/** Avisa quem mostra botões ▶/■ (editor, pentagrama do desktop) quando a reprodução começa/para. */
export const onPlayState = (fn: (playing: boolean) => void) => { stateListeners.add(fn); return () => stateListeners.delete(fn); };
const playerListeners = new Set<(st: PlayerState) => void>();
export const onPlayer = (fn: (st: PlayerState) => void) => { playerListeners.add(fn); fn(playerState()); return () => playerListeners.delete(fn); };
function emit() { const st = playerState(); playerListeners.forEach((f) => f(st)); }
export function playerState(): PlayerState {
  if (current) return { source: current.source, playing: true, paused: false, pos: Math.max(0, current.offset + (ctx!.currentTime - current.startedAt)), dur: current.dur };
  return { source: last?.source ?? null, playing: false, paused: pausedAt >= 0, pos: Math.max(0, pausedAt), dur: last?.dur ?? 0 };
}
export function stop() { const was = !!current; current?.stop(); current = null; pausedAt = -1; if (was) { stateListeners.forEach((f) => f(false)); emit(); emitBeat(null); } }
export function pause() { if (!current) return; const pos = playerState().pos; current.stop(); current = null; pausedAt = pos; stateListeners.forEach((f) => f(false)); emit(); emitBeat(null); }
export function resume() { if (!last) return; const p = Math.max(0, pausedAt); last.replay(p >= last.dur - 0.05 ? 0 : p); }
export function seek(sec: number) { if (!last) return; const t = Math.max(0, Math.min(last.dur - 0.05, sec)); if (current) last.replay(t); else { pausedAt = t; emit(); } }
export function restart() { last?.replay(0); }
export const isPlaying = () => !!current;

// ------------------------------------------------------------- gravação
export async function record(opts: { countInBeats: number; spb: number; onCount?: (n: number) => void }) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
  const c = ac();
  for (let i = opts.countInBeats; i > 0; i--) {
    click(c.currentTime + 0.01, i === opts.countInBeats);
    opts.onCount?.(i);
    await new Promise((r) => setTimeout(r, opts.spb * 1000));
  }
  const rec = new MediaRecorder(stream);
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => chunks.push(e.data);
  rec.start();
  return {
    stop: () => new Promise<Blob>((res) => {
      rec.onstop = () => { stream.getTracks().forEach((t) => t.stop()); res(new Blob(chunks, { type: rec.mimeType })); };
      rec.stop();
    }),
  };
}

// --------------------------------------------- recorte/ganho antes do envio
export async function decode(blob: Blob) { return ac().decodeAudioData(await blob.arrayBuffer()); }

export function peaks(buf: AudioBuffer, n: number) {
  const d = buf.getChannelData(0); const step = Math.floor(d.length / n) || 1; const out: number[] = [];
  for (let i = 0; i < n; i++) { let m = 0; for (let j = i * step; j < (i + 1) * step && j < d.length; j += 8) m = Math.max(m, Math.abs(d[j])); out.push(m); }
  return out;
}

/** Recorta [start,end] s, aplica ganho e fade, reamostra para 22.05 kHz mono e codifica WAV 16-bit. */
export async function trimToWav(buf: AudioBuffer, start: number, end: number, gainDb = 0, fade = 0.02): Promise<Blob> {
  const sr = 22050;
  const len = Math.max(1, Math.floor((end - start) * sr));
  const off = new OfflineAudioContext(1, len, sr);
  const src = off.createBufferSource(); src.buffer = buf;
  const g = off.createGain(); const lin = Math.pow(10, gainDb / 20);
  g.gain.setValueAtTime(0, 0); g.gain.linearRampToValueAtTime(lin, fade);
  g.gain.setValueAtTime(lin, Math.max(fade, (end - start) - fade)); g.gain.linearRampToValueAtTime(0, end - start);
  src.connect(g).connect(off.destination); src.start(0, start, end - start);
  const out = await off.startRendering();
  const data = out.getChannelData(0);
  const ab = new ArrayBuffer(44 + data.length * 2); const v = new DataView(ab);
  const w = (o: number, s: string) => [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
  w(0, "RIFF"); v.setUint32(4, 36 + data.length * 2, true); w(8, "WAVEfmt "); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, sr, true); v.setUint32(28, sr * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, "data"); v.setUint32(40, data.length * 2, true);
  for (let i = 0; i < data.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, data[i])) * 0x7fff, true);
  return new Blob([ab], { type: "audio/wav" });
}

/** Analisador ligado à SAÍDA do sistema (tudo que a plataforma toca) — referência para o afinador
 *  separar o som da entrada (microfone) do que está sendo reproduzido ao mesmo tempo. */
export function tapOutput(fftSize = 4096): AnalyserNode {
  const c = ac();
  const an = c.createAnalyser(); an.fftSize = fftSize; an.smoothingTimeConstant = 0;
  master.connect(an);
  return an;
}
export function untapOutput(an: AnalyserNode) { try { master.disconnect(an); } catch { /* já desligado */ } }
