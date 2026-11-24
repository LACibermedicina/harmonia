// "Compor ao vivo": a partitura toca em loop (com metrônomo) e o que você toca — no instrumento externo
// (microfone ou teclado MIDI) ou no teclado da tela — é escrito NA HORA, na posição da reprodução.
// As notas novas entram na camada "Ao vivo" e já soam na próxima volta do loop.
import * as audio from "./audio";
import { store } from "./store";
import { beatsPerMeasure, uid } from "./types";
import { startCapture, Capture, newLiveLayer } from "./livecapture";
import { toast, h } from "./ui";

type Input = "mic" | "keys";
let active: { input: Input; layerId: string; cap: Capture | null; stopPlay: () => void } | null = null;
let beatNow = -1, ctxAt = 0, beatAt0 = 0;
const listeners = new Set<() => void>();
const beatListeners = new Set<(b: number) => void>();
export const onJam = (fn: () => void) => { listeners.add(fn); return () => listeners.delete(fn); };
export const onJamBeat = (fn: (b: number) => void) => { beatListeners.add(fn); return () => beatListeners.delete(fn); };
const emit = () => listeners.forEach((f) => f());
export const jamActive = () => !!active;
export const jamInput = () => active?.input ?? null;
export const jamBeat = () => beatNow;
let pitchNow: number | null = null, levelNow = 0;
/** Nota ouvida agora do instrumento externo (para acender no teclado da tela). */
export const livePitch = () => (active ? { pitch: pitchNow, level: levelNow } : { pitch: null, level: 0 });

/** Tempo musical num instante do AudioContext (interpolado a partir do último quadro da reprodução). */
function clock(ctxTime: number) {
  const spb = 60 / store.score.tempo;
  return beatAt0 + (ctxTime - ctxAt) / spb;
}

function jamLayer(input: Input): string {
  // cada sessão ao vivo ganha camada própria, com cor de captura e selo 🎤/🎹
  const nl = newLiveLayer(input === "mic" ? "Captura em tempo real" : "Ao vivo (teclado)");
  if (input === "keys") nl.name = nl.name.replace("🎤", "🎹");
  store.mutate((sc) => sc.layers.push(nl), "jam");
  store.selectedLayer = nl.id;
  return nl.id;
}

// cursor de leitura: onde a reprodução da partitura parou (fim da música → volta ao início)
let lastBeat = 0;
audio.onScoreBeat((b, _src, ended) => {
  if (b !== null) { lastBeat = b; return; }
  if (active || counting) return; // o loop do ao vivo não mexe no cursor
  store.cursorBeat = ended ? 0 : Math.max(0, lastBeat);
  store.emit("cursor");
});

let counting: { cancel: () => void } | null = null;
let countN = 0;
/** Número da contagem regressiva em andamento (0 = sem contagem). */
export const jamCount = () => countN;
export const jamCounting = () => !!counting;

/** Contagem de 1 compasso (cliques + números grandes) antes de começar. Resolve false se cancelada. */
function countIn(beats: number, spb: number, label: string): Promise<boolean> {
  const c = audio.ac();
  const t0 = c.currentTime + 0.15;
  for (let i = 0; i < beats; i++) audio.click(t0 + i * spb, i === 0);
  const big = h("b", { class: "ci-n" }, String(beats));
  const ov = h("div", { class: "countin", role: "status", "aria-live": "assertive" },
    h("div", { class: "ci-ring" }, big), h("small", {}, label), h("button", { class: "ci-x", onclick: () => cancel() }, "Cancelar (Esc)"));
  document.body.append(ov);
  const timers: number[] = [];
  let done: (ok: boolean) => void = () => {};
  const p = new Promise<boolean>((r) => (done = r));
  const finish = (ok: boolean) => { timers.forEach(clearTimeout); removeEventListener("keydown", onKey); ov.remove(); counting = null; countN = 0; emit(); done(ok); };
  const cancel = () => finish(false);
  const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") cancel(); };
  addEventListener("keydown", onKey);
  for (let i = 0; i < beats; i++) timers.push(window.setTimeout(() => {
    countN = beats - i; big.textContent = String(countN); big.classList.remove("pop"); void big.offsetWidth; big.classList.add("pop"); ov.classList.toggle("accent", i === 0); emit();
  }, Math.max(0, (t0 + i * spb - c.currentTime) * 1000)));
  // termina um pouco antes do 1º tempo: a reprodução agenda com ~0,12 s de antecedência
  timers.push(window.setTimeout(() => finish(true), Math.max(0, (t0 + beats * spb - 0.12 - c.currentTime) * 1000)));
  counting = { cancel };
  countN = beats; emit();
  return p;
}
export function cancelCount() { counting?.cancel(); }

export async function startJam(input: Input, opts: { metronome?: boolean; focus?: () => void; from?: number; countIn?: boolean } = {}) {
  if (active) await stopJam();
  if (counting) { counting.cancel(); return; }
  const s0 = store.score, bpm = beatsPerMeasure(s0), spb = 60 / s0.tempo;
  // sempre começa no início de um compasso: do início ou do compasso onde está o cursor de leitura
  const from = Math.max(0, Math.floor((opts.from ?? 0) / bpm + 1e-9) * bpm);
  const layerId = jamLayer(input);
  if (!s0.layers.some((l) => l.notes.length)) store.mutate((sc) => { sc.measures = Math.max(sc.measures, 4); }, "jam");
  // compassos: loop nos atuais (padrão), infinitos (a pauta cresce enquanto grava) ou com limite
  const mm = store.score.measureMode ?? "loop";
  const limitB = mm === "limit" && store.score.measureLimit ? store.score.measureLimit * bpm : 0;
  const total = mm === "infinite" ? from + 400 * bpm : limitB ? Math.max(from + bpm, limitB) : Math.max(store.score.measures * bpm, from + bpm * 4);
  const c = audio.ac();
  if (c.state === "suspended") await c.resume();
  if (audio.isPlaying()) audio.stop();
  active = { input, layerId, cap: null, stopPlay: () => audio.stop() };
  // o relógio já aponta para o compasso de partida (notas tocadas na contagem caem no 1º tempo)
  beatAt0 = from; ctxAt = c.currentTime + 0.15 + bpm * spb;
  // pede o microfone ANTES da contagem (a permissão não atrasa a entrada)
  if (input === "mic") {
    try { active.cap = await startCapture({ clock, layerId, grid: 0.25, onPitch: (m, l) => { pitchNow = m; levelNow = l; } }); }
    catch (e: any) { toast("Microfone/MIDI indisponível: " + e.message + " — use o teclado da tela", "warn", 6000); active.input = "keys"; }
  }
  emit();
  if (opts.countIn !== false) {
    const a = active;
    beatAt0 = from; ctxAt = c.currentTime + 0.15 + bpm * spb;
    const ok = await countIn(bpm, spb, from > 0 ? `Gravando a partir do compasso ${Math.floor(from / bpm) + 1}` : "Gravando do início");
    if (!ok || active !== a) { if (active === a) { await a.cap?.stop(); store.mutate((sc) => { sc.layers = sc.layers.filter((l) => l.id !== a.layerId || l.notes.length); }, "jam-empty"); active = null; emit(); } return; }
  }
  await audio.play(store.score, { fromBeat: from, rangeStart: from, toBeat: total, loop: mm !== "infinite", metronome: opts.metronome ?? true,
    onBeat: (b) => {
      beatNow = b; ctxAt = c.currentTime; beatAt0 = b; beatListeners.forEach((f) => f(b));
      // infinito: sempre 2 compassos livres à frente do cursor
      if (mm === "infinite" && b > (store.score.measures - 2) * bpm) { const sc = store.score; sc.measures += 2; while (sc.chords.length < sc.measures) sc.chords.push([]); store.emit("extend"); }
    } },
    { id: "jam", label: from > 0 ? `Compor ao vivo — desde o compasso ${Math.floor(from / bpm) + 1}` : "Compor ao vivo", icon: "🎹", focus: opts.focus });
  emit();
  toast(active?.input === "mic" ? (active.cap?.midi ? "Gravando: toque no teclado MIDI — a pauta é escrita na hora" : "Gravando: cante ou toque perto do microfone — as notas aparecem na pauta") : "Gravando: toque no teclado da tela no ritmo do metrônomo", "info", 4500);
}

export async function stopJam() {
  if (counting) { counting.cancel(); return; }
  if (!active) return;
  const a = active; active = null; beatNow = -1;
  await a.cap?.stop();
  a.stopPlay();
  emit();
  const n = store.score.layers.find((l) => l.id === a.layerId)?.notes.length ?? 0;
  const name = store.score.layers.find((l) => l.id === a.layerId)?.name ?? "Ao vivo";
  if (!n) store.mutate((sc) => { sc.layers = sc.layers.filter((l) => l.id !== a.layerId || l.notes.length); }, "jam-empty"); // sessão sem notas não deixa camada vazia
  toast(n ? `Gravação encerrada — ${n} nota(s) na camada “${name}”` : "Gravação encerrada — nenhuma nota captada", n ? "ok" : "info", 3500);
}

/** Nota tocada no teclado da tela durante o "ao vivo": entra na posição atual da reprodução. */
export function jamNote(pitch: number, vel: number, dur = 0.5) {
  if (!active || beatNow < 0) return false;
  const grid = 0.25, start = Math.max(0, Math.round((clock(audio.ac().currentTime) - 0.04) / grid) * grid);
  store.mutate((sc) => { const l = sc.layers.find((x) => x.id === active!.layerId); l?.notes.push({ id: uid(), pitch, start, dur, vel }); }, "jam-note");
  return true;
}
addEventListener("pagehide", () => stopJam());
// se o player universal parar/pausar a reprodução, o "ao vivo" termina junto (o loop reinicia sem parar)
audio.onPlayer(() => setTimeout(() => { if (counting) return; if (active && audio.playerState().source?.id !== "jam") stopJam(); else if (active && !audio.playerState().playing) stopJam(); }, 400));
