// Painel do afinador: flutuante, arrastável, recolhível e ocultável (Mostrar/Ocultar pelo botão 🎚 ou tecla T).
// Mostra a nota (dó-ré-mi + letra), a oitava, a frequência, o ponteiro de cents, o nível de entrada,
// e o "timbre" do que entra — separando a sua voz/instrumento do som que a plataforma está tocando.
import { h, toast } from "../core/ui";
import { startTuner, stopTuner, onTuner, tunerRunning, setA4, A4, setSubtract, subtract, TunerReading } from "../core/tuner";
import { SOLFEGE } from "../core/theory";

const LETTERS = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
const POS_KEY = "harmonia.tuner.pos";
let panel: HTMLElement | null = null;
const listeners = new Set<(open: boolean) => void>();
export const onTunerPanel = (fn: (open: boolean) => void) => { listeners.add(fn); return () => listeners.delete(fn); };
export const tunerOpen = () => !!panel;
const emit = () => listeners.forEach((f) => f(!!panel));

let userClosed = false;
/** Abre junto com a captura ao vivo (só até a pessoa ocultar o afinador nesta sessão). */
export function autoOpenTuner() { if (!panel && !userClosed) openTuner(); }

export function toggleTuner(force?: boolean) {
  const want = force ?? !panel;
  if (want && !panel) openTuner(); else if (!want && panel) { userClosed = true; closeTuner(); }
}

function closeTuner() {
  stopTuner(); off?.(); off = null;
  panel?.remove(); panel = null; emit();
}
let off: (() => void) | null = null;

async function openTuner() {
  const note = h("div", { class: "tn-note" }, "—");
  const oct = h("sub", {}, "");
  const sol = h("div", { class: "tn-sol" }, "toque ou cante uma nota");
  const freq = h("div", { class: "tn-freq" }, "— Hz");
  const needle = h("div", { class: "tn-needle" });
  const centsT = h("div", { class: "tn-cents" }, "");
  const gauge = h("div", { class: "tn-gauge" },
    ...[-50, -25, 0, 25, 50].map((c) => h("i", { class: "tn-tick" + (c === 0 ? " zero" : ""), style: { left: `${50 + c}%` } })),
    h("span", { class: "tn-flat" }, "♭ baixo"), h("span", { class: "tn-sharp" }, "alto ♯"), needle);
  const lvl = h("div", { class: "tn-lvl" }, h("i"));
  const sep = h("div", { class: "tn-sep" }, "🎤 só a entrada do microfone");
  const timbre = h("div", { class: "tn-timbre", title: "Perfil dos 8 primeiros harmônicos do som que ENTRA — é a ‘impressão digital’ do timbre" },
    ...Array.from({ length: 8 }, (_, i) => h("i", { title: `${i + 1}º harmônico` })));
  const timbreT = h("small", { class: "tn-timbre-t" }, "");
  const a4 = h("input", { type: "number", min: "415", max: "466", step: "1", value: String(A4), "aria-label": "Lá de referência (Hz)",
    onchange: () => setA4(+a4.value || 440) }) as HTMLInputElement;
  const subt = h("input", { type: "checkbox", checked: subtract, onchange: () => setSubtract(subt.checked) }) as HTMLInputElement;
  const min = h("button", { class: "tn-x", title: "Recolher", "aria-label": "Recolher", onclick: () => p.classList.toggle("mini") }, "–");
  const x = h("button", { class: "tn-x", title: "Ocultar afinador (T)", "aria-label": "Ocultar afinador", onclick: () => { userClosed = true; closeTuner(); } }, "✕");
  const head = h("header", { class: "tn-head" }, h("b", {}, "🎚 Afinador"), h("span", { class: "tn-live" }, "● entrada"), min, x);
  const p = h("div", { class: "tuner", role: "dialog", "aria-label": "Afinador" }, head,
    h("div", { class: "tn-main" }, h("div", { class: "tn-big" }, note, oct), h("div", {}, sol, freq)),
    gauge, centsT, lvl, sep,
    h("div", { class: "tn-row" }, timbre, timbreT),
    h("div", { class: "tn-opts" },
      h("label", {}, "Lá = ", a4, " Hz"),
      h("label", { title: "Subtrai do microfone o som que a própria plataforma está tocando (referência interna), para avaliar só a sua nota" }, subt, " Ignorar o som do sistema")));
  panel = p;
  try { const pos = JSON.parse(localStorage.getItem(POS_KEY) || "null"); if (pos) Object.assign(p.style, { left: pos.x + "px", top: pos.y + "px", right: "auto", bottom: "auto" }); } catch { /* */ }
  document.body.append(p); emit();
  // arrastar pela barra de título
  head.addEventListener("pointerdown", (e) => {
    if ((e.target as HTMLElement).closest("button")) return;
    const r = p.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
    const mv = (ev: PointerEvent) => { const nx = Math.max(0, Math.min(innerWidth - 80, ev.clientX - dx)), ny = Math.max(0, Math.min(innerHeight - 40, ev.clientY - dy)); Object.assign(p.style, { left: nx + "px", top: ny + "px", right: "auto", bottom: "auto" }); };
    const up = () => { removeEventListener("pointermove", mv); removeEventListener("pointerup", up); try { const b = p.getBoundingClientRect(); localStorage.setItem(POS_KEY, JSON.stringify({ x: b.left, y: b.top })); } catch { /* */ } };
    addEventListener("pointermove", mv); addEventListener("pointerup", up);
  });
  off = onTuner((r) => paint(r));
  function paint(r: TunerReading) {
    (lvl.firstChild as HTMLElement).style.width = `${Math.round(r.level * 100)}%`;
    p.classList.toggle("playback", r.playback);
    sep.textContent = r.separated ? (r.leak > 0.05 ? `🔇 separando do som do sistema (vazamento ×${r.leak.toFixed(2)} subtraído)` : "🔇 o sistema está tocando — sem vazamento no microfone") : r.playback ? "⚠ o sistema está tocando — ative “Ignorar o som do sistema”" : "🎤 só a entrada do microfone";
    if (r.midi === null) { p.classList.remove("ok", "near", "off"); note.textContent = "—"; oct.textContent = ""; sol.textContent = r.level > 0.03 ? "som sem altura definida" : "toque ou cante uma nota"; freq.textContent = "— Hz"; centsT.textContent = ""; needle.style.left = "50%"; return; }
    const pc = ((r.midi % 12) + 12) % 12;
    note.textContent = LETTERS[pc]; oct.textContent = String(Math.floor(r.midi / 12) - 1);
    sol.textContent = `${SOLFEGE[pc]}${Math.floor(r.midi / 12) - 1}`;
    freq.textContent = r.freq ? `${r.freq.toFixed(1)} Hz` : "";
    needle.style.left = `${50 + Math.max(-50, Math.min(50, r.cents))}%`;
    const a = Math.abs(r.cents);
    p.classList.toggle("ok", a <= 5); p.classList.toggle("near", a > 5 && a <= 15); p.classList.toggle("off", a > 15);
    centsT.textContent = a <= 5 ? "✓ afinado" : `${r.cents > 0 ? "+" : ""}${r.cents} cents · ${r.cents > 0 ? "baixe um pouco" : "suba um pouco"}`;
    r.harmonics.forEach((v, i) => ((timbre.children[i] as HTMLElement).style.height = `${Math.round(8 + v * 92)}%`));
    const bright = r.centroid > 2200 ? "brilhante" : r.centroid > 900 ? "equilibrado" : "escuro/aveludado";
    timbreT.textContent = `${r.family ? "🎻 " + r.family + " (estimado) · " : ""}timbre ${bright} · ${Math.round(r.centroid)} Hz` + (r.playback && r.leak > 0.05 && r.similarity > 0.92 ? " · ⚠ parecido com o som do sistema" : r.playback && r.leak > 0.05 ? " · distinto do sistema ✓" : "");
  }
  try { await startTuner(); }
  catch (e: any) { toast("Microfone indisponível para o afinador: " + e.message, "error", 6000); closeTuner(); return; }
  if (!tunerRunning()) closeTuner();
}

// atalho global: T mostra/oculta (fora de campos de texto)
addEventListener("keydown", (e) => {
  if (e.key.toLowerCase() !== "t" || e.metaKey || e.ctrlKey || e.altKey) return;
  const tg = e.target as HTMLElement;
  if (tg.closest("input, textarea, select, [contenteditable=true]")) return;
  toggleTuner();
});
addEventListener("harmonia:action", (e) => { const a = (e as CustomEvent).detail; if (a === "tuner") toggleTuner(); if (a === "tuner-open") toggleTuner(true); if (a === "tuner-close") toggleTuner(false); if (a === "tuner-auto") autoOpenTuner(); });
