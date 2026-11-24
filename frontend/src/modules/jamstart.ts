// Escolha antes do "ao vivo": recomeçar do início ou do cursor de leitura, com contagem de 1 compasso.
import { h } from "../core/ui";
import { store } from "../core/store";
import { beatsPerMeasure } from "../core/types";
import { startJam, stopJam, jamActive } from "../core/jam";
import { capturePrefs, setCapturePrefs } from "../core/livecapture";

const CI_KEY = "harmonia.jam.countin";
type Input = "mic" | "keys";

export function requestJam(input: Input, opts: { focus?: () => void } = {}, anchor?: HTMLElement | null) {
  if (jamActive()) { stopJam(); return; }
  document.querySelector(".jam-start")?.remove();
  const s = store.score, bpm = beatsPerMeasure(s);
  const cur = store.readCursor();
  const m = Math.floor(cur / bpm + 1e-9);
  let countOn = true; try { countOn = localStorage.getItem(CI_KEY) !== "0"; } catch { /* */ }
  const ci = h("input", { type: "checkbox", checked: countOn, onchange: () => { try { localStorage.setItem(CI_KEY, ci.checked ? "1" : "0"); } catch { /* */ } } }) as HTMLInputElement;
  const go = (from: number) => { close(); startJam(input, { ...opts, from, countIn: ci.checked }); };
  const fromStart = h("button", { class: "js-opt", onclick: () => go(0) }, h("b", {}, "⏮ Do início"), h("small", {}, "compasso 1"));
  const fromCur = h("button", { class: "js-opt primary", disabled: cur <= 0, onclick: () => go(cur) },
    h("b", {}, "⏯ Do cursor"), h("small", {}, cur > 0 ? `compasso ${m + 1}${store.selectedMeasures.size ? " (selecionado)" : " (onde a leitura parou)"}` : "clique num compasso ou pare a reprodução onde quiser"));
  // como interpretar o som (vale para a gravação pelo microfone e pelo teclado MIDI)
  const cp = capturePrefs();
  const seg = (name: string, cur: string, opts: [string, string, string][], on: (v: string) => void) => {
    const box2 = h("div", { class: "js-seg", role: "radiogroup", "aria-label": name });
    const draw = (v: string) => box2.replaceChildren(...opts.map(([val, lb, tipT]) => h("button", { class: val === v ? "on" : "", role: "radio", "aria-checked": String(val === v), "data-tip": tipT,
      onclick: () => { on(val); draw(val); } }, lb)));
    draw(cur); return h("div", { class: "js-opt-row" }, h("small", {}, name), box2);
  };
  const chk = (label: string, v: boolean, on: (x: boolean) => void, tipT: string) => { const c = h("input", { type: "checkbox", checked: v, onchange: () => on(c.checked) }) as HTMLInputElement; return h("label", { class: "js-ci", "data-tip": tipT }, c, " " + label); };
  const box = h("div", { class: "jam-start", role: "dialog", "aria-label": "Começar a gravar" },
    h("header", {}, h("b", {}, input === "mic" ? "🎤 Gravar ao vivo" : "🎹 Gravar pelo teclado"), h("button", { class: "js-x", "aria-label": "Fechar", onclick: () => close() }, "✕")),
    h("div", { class: "js-row" }, fromStart, fromCur),
    h("label", { class: "js-ci" }, ci, ` Contagem de 1 compasso (${s.timeSig[0]} tempos) antes de começar`),
    input === "mic" ? h("details", { class: "js-more", open: true }, h("summary", {}, "Como ouvir o som"),
      seg("Notas", cp.notes, [["auto", "Automático", "Reconhece sozinho se é uma nota ou várias ao mesmo tempo"], ["mono", "Uma por vez", "Melodia (voz, flauta, violino…): mais precisão"], ["poly", "Várias (acordes)", "Piano, violão, coro: até 4–6 notas juntas"]], (v) => setCapturePrefs({ notes: v as any })),
      seg("Mãos", cp.hands, [["auto", "Duas mãos", "Graves vão para a pauta de Fá (mão esquerda)"], ["one", "Uma pauta", "Tudo numa camada só"]], (v) => setCapturePrefs({ hands: v as any })),
      chk("🎼 Orquestra — vários instrumentos ao mesmo tempo (cada timbre numa camada)", cp.orchestra, (x) => setCapturePrefs({ orchestra: x }), "Agrupa as notas pelo timbre: cada instrumento reconhecido ganha a sua camada, com o timbre estimado"),
      chk("Afinar na tonalidade (nota desafinada vai para a nota da escala mais próxima)", cp.snapKey, (x) => setCapturePrefs({ snapKey: x }), "Corrige pequenas desafinações para a escala da partitura"),
      chk("Harmonizar o que foi gravado (cifras nos compassos sem acorde)", cp.harmonize, (x) => setCapturePrefs({ harmonize: x }), "Ao parar, sugere acordes para os compassos gravados; Ctrl+Z desfaz")) : "");
  document.body.append(box);
  const r = anchor?.getBoundingClientRect();
  if (r && r.width) {
    const x = Math.max(8, Math.min(innerWidth - 336, r.right - 320)), y = r.bottom + 8 + 430 > innerHeight ? Math.max(34, r.top - 438) : r.bottom + 8;
    Object.assign(box.style, { left: x + "px", top: Math.max(34, y) + "px" });
  } else box.classList.add("center");
  (cur > 0 ? fromCur : fromStart).focus();
  const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
  const outside = (e: Event) => { if (!box.contains(e.target as Node) && e.target !== anchor && !anchor?.contains(e.target as Node)) close(); };
  addEventListener("keydown", onKey); setTimeout(() => addEventListener("pointerdown", outside, true));
  function close() { box.remove(); removeEventListener("keydown", onKey); removeEventListener("pointerdown", outside, true); }
}
