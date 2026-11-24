// Editor de partitura para piano (sistema Sol/Fá) com drag & drop profissional e camadas.
// Híbrido didático: notação tradicional + barra de duração colorida por camada (mostra a duração real).
import { store, newLayer } from "../core/store";
import { Note, Score, uid, beatsPerMeasure, ChordEv, staves, Clef, Hand } from "../core/types";
import { INSTRUMENTS, instrument } from "../core/instruments";
import { h, toast, busy, tip } from "../core/ui";
import { SOLFEGE, NAMES, parseChord, voiceChords, extractMelody, chordPcs, symbolOf, KEY_NAMES } from "../core/theory";
import * as audio from "../core/audio";
import { currentUser, runJob, upload } from "../core/api";
import { t } from "../core/i18n";
import { prefs } from "../core/prefs";
import { ICONS } from "../core/icons";
import { mountInstrumentView } from "./instrumentview";
import { stopJam, jamActive, onJam } from "../core/jam";
import { requestJam } from "./jamstart";
import { withIcon } from "../core/ui";
import { transcribeRecording, recordingSpan } from "../core/rectx";
import { transcribeBuffer } from "../core/transcribe";
import { onLive, LiveState } from "../core/livecapture";
import { toggleTuner, onTunerPanel, tunerOpen } from "./tuner";
import { analyze, Analysis, figureName } from "../core/analysis";
import { analysisOn, explainWithMaestro } from "./study";
import { learnMarks } from "./learn";
import type { Win } from "../core/wm";

const SVGNS = "http://www.w3.org/2000/svg";
const LS = 10; // espaçamento entre linhas
const LETTER_PC = [0, 2, 4, 5, 7, 9, 11];
const SHARP_LETTERS = [3, 0, 4, 1, 5, 2, 6];
const FLAT_LETTERS = [6, 2, 5, 1, 4, 0, 3];
const SPELL_SHARP: [number, number][] = [[0, 0], [0, 1], [1, 0], [1, 1], [2, 0], [3, 0], [3, 1], [4, 0], [4, 1], [5, 0], [5, 1], [6, 0]];
const SPELL_FLAT: [number, number][] = [[0, 0], [1, -1], [1, 0], [2, -1], [2, 0], [3, 0], [4, -1], [4, 0], [5, -1], [5, 0], [6, -1], [6, 0]];

type Tool = "select" | "pencil" | "erase" | "annotate" | "lyrics" | "chord";

function keyAcc(fifths: number) {
  const a = [0, 0, 0, 0, 0, 0, 0];
  if (fifths > 0) SHARP_LETTERS.slice(0, fifths).forEach((l) => (a[l] = 1));
  if (fifths < 0) FLAT_LETTERS.slice(0, -fifths).forEach((l) => (a[l] = -1));
  return a;
}
function spell(p: number, fifths: number) {
  const [letter, acc] = (fifths < 0 ? SPELL_FLAT : SPELL_SHARP)[p % 12];
  return { step: (Math.floor(p / 12) - 1) * 7 + letter, letter, acc };
}
function stepToPitch(step: number, fifths: number) {
  const letter = ((step % 7) + 7) % 7, oct = Math.floor(step / 7);
  return (oct + 1) * 12 + LETTER_PC[letter] + keyAcc(fifths)[letter];
}
// passo diatônico da linha superior de cada clave e glifo
const CLEF_TOP: Record<Clef, number> = { G: 38, F: 26, C: 32 };
const CLEF_GLYPH: Record<Clef, string> = { G: "𝄞", F: "𝄢", C: "𝄡" };
const CLEF_SHIFT: Record<Clef, number> = { G: 0, F: -14, C: -7 }; // deslocamento da armadura vs. clave de Sol

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, any> = {}, text?: string) {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) el.setAttribute(k, String(v));
  if (text !== undefined) el.textContent = text;
  return el;
}

/** Padrão SVG da camada: cor + textura (lisa, listras, pontos, xadrez, verticais, ondas) pelo índice. */
export function layerPattern(id: string, color: string, i: number) {
  const kinds = [
    `<rect width="8" height="8" fill="${color}"/>`,
    `<rect width="8" height="8" fill="${color}" opacity=".55"/><path d="M-2 2 L2 -2 M0 8 L8 0 M6 10 L10 6" stroke="${color}" stroke-width="2.4"/>`,
    `<rect width="8" height="8" fill="${color}" opacity=".45"/><circle cx="4" cy="4" r="2" fill="${color}"/>`,
    `<rect width="8" height="8" fill="${color}" opacity=".5"/><path d="M0 0 H4 V4 H0Z M4 4 H8 V8 H4Z" fill="${color}"/>`,
    `<rect width="8" height="8" fill="${color}" opacity=".5"/><rect x="0" width="3" height="8" fill="${color}"/>`,
    `<rect width="8" height="8" fill="${color}" opacity=".45"/><path d="M0 5 Q2 2 4 5 T8 5" stroke="${color}" stroke-width="1.8" fill="none"/>`,
  ];
  return `<pattern id="pat-${id}" width="8" height="8" patternUnits="userSpaceOnUse">${kinds[i % kinds.length]}</pattern>`;
}

interface SysGeom { index: number; y: number; firstMeasure: number; nMeasures: number; left: number; trebleY: number; bassY: number; }

export function mountScoreEditor(body: HTMLElement, win: Win) {
  let tool: Tool = "select";
  let dur = 1;
  let dotted = false;
  let zoom = 1;
  let grid = 0.25;
  let harmStyle = "block";
  let metronome = false;
  let loop = false;
  let playhead = -1;
  let systems: SysGeom[] = [];
  let liveIds = new Set<string>();
  let layerMs = new Map<string, Set<number>>();
  let anal: Analysis | null = null;
  const layoutMode = () => { try { return localStorage.getItem("harmonia.layout") === "horizontal" ? "horizontal" : "vertical"; } catch { return "vertical"; } };
  const layoutSel = h("select", { onchange: () => { try { localStorage.setItem("harmonia.layout", layoutSel.value); } catch { /* */ } render(); } },
    h("option", { value: "vertical" }, "↕ Vertical (quebra em linhas)"), h("option", { value: "horizontal" }, "↔ Horizontal contínua")) as HTMLSelectElement;
  layoutSel.value = layoutMode();
  const mmSel = h("select", { onchange: () => { const v = mmSel.value as any; store.mutate((x) => { x.measureMode = v; if (v === "limit" && !x.measureLimit) x.measureLimit = Math.max(4, x.measures); }, "measures"); syncMm(); } },
    h("option", { value: "loop" }, "🔁 Repetir os atuais ao gravar"), h("option", { value: "infinite" }, "∞ Infinitos (a pauta cresce)"), h("option", { value: "limit" }, "🔢 Limite de compassos")) as HTMLSelectElement;
  const limIn = h("input", { type: "number", min: "1", max: "999", class: "num", "aria-label": "Limite de compassos", onchange: () => store.mutate((x) => { x.measureLimit = Math.max(1, +limIn.value || 8); }, "measures") }) as HTMLInputElement;
  const syncMm = () => { mmSel.value = store.score.measureMode ?? "loop"; limIn.value = String(store.score.measureLimit ?? store.score.measures); limIn.hidden = mmSel.value !== "limit"; };
  store.on((r) => { if (r === "load" || r === "measures") syncMm(); }); syncMm();
  let tintOn = (() => { try { return localStorage.getItem("harmonia.tint") !== "0"; } catch { return true; } })();
  const tintIn = h("label", { class: "check" }, h("input", { type: "checkbox", checked: tintOn, onchange: (e: Event) => { tintOn = (e.target as HTMLInputElement).checked; try { localStorage.setItem("harmonia.tint", tintOn ? "1" : "0"); } catch { /* */ } render(); } }), " Colorir compassos pela cor de cada camada");
  let ppb = 34;

  // ------------------------------------------------------------ toolbar
  const toolBtn = (id: Tool, icon: string, label: string, help: string) =>
    tip(h("button", { class: "tool" + (tool === id ? " on" : ""), "data-tool": id, "aria-label": label, onclick: () => setTool(id) }, h("span", { html: icon }), h("small", {}, label)), `${label} — ${help}`);
  const tools = h("div", { class: "seg" },
    toolBtn("select", ICONS.t_select, "Mover", "Selecionar e arrastar notas. ↑↓ transpõe, Shift+arrastar = cromático, Alt+arrastar = duplicar."),
    toolBtn("pencil", ICONS.t_pencil, "Nota", "Clique na pauta para inserir uma nota com a duração escolhida."),
    toolBtn("erase", ICONS.t_erase, "Apagar", "Clique numa nota para removê-la."),
    toolBtn("chord", ICONS.t_chord, "Cifra", "Clique acima do compasso para escrever acordes (ex.: Am7 D7(9))."),
    toolBtn("lyrics", ICONS.t_lyrics, "Letra", "Clique numa nota para escrever a sílaba. Tab avança, '_' = melisma (prolonga)."),
    toolBtn("annotate", ICONS.t_annot, "Nota+", "Adicionar anotação didática / de interpretação no compasso."));

  const DURS: [number, string, string][] = [[4, "𝅝", "Semibreve (4 tempos)"], [2, "𝅗𝅥", "Mínima (2)"], [1, "♩", "Semínima (1)"], [0.5, "♪", "Colcheia (½)"], [0.25, "𝅘𝅥𝅯", "Semicolcheia (¼)"]];
  const durBox = h("div", { class: "seg durs" }, ...DURS.map(([d, g, n]) => {
    const b = tip(h("button", { class: "dur" + (d === dur ? " on" : ""), draggable: "true", "data-dur": d, onclick: () => { dur = d; refreshDurs(); } }, g), n + " — arraste para a pauta");
    b.addEventListener("dragstart", (e) => { e.dataTransfer!.setData("text/harmonia-dur", String(d * (dotted ? 1.5 : 1))); e.dataTransfer!.effectAllowed = "copy"; });
    return b;
  }), tip(h("button", { class: "dur", onclick: (e: Event) => { dotted = !dotted; (e.currentTarget as HTMLElement).classList.toggle("on", dotted); } }, "•"), "Ponto de aumento: +50% da duração"));
  const refreshDurs = () => durBox.querySelectorAll<HTMLElement>("[data-dur]").forEach((b) => b.classList.toggle("on", +b.dataset.dur! === dur));

  const playBtn = h("button", { class: "btn primary", onclick: () => togglePlay() }, "▶ " + t("play"));
  const tempoIn = h("input", { type: "number", min: 30, max: 260, value: store.score.tempo, class: "num", "aria-label": "Andamento",
    onchange: (e: Event) => store.mutate((s) => (s.tempo = +(e.target as HTMLInputElement).value || 96), "tempo") });
  const transport = h("div", { class: "seg" },
    tip(h("button", { class: "btn" + (metronome ? " on" : ""), onclick: (e: Event) => { metronome = !metronome; (e.currentTarget as HTMLElement).classList.toggle("on", metronome); } }, "𝅘𝅥 Metrônomo"), "Clique a cada tempo; acento no tempo forte"),
    tip(h("button", { class: "btn", onclick: (e: Event) => { loop = !loop; (e.currentTarget as HTMLElement).classList.toggle("on", loop); } }, "⟲ Loop"), "Repete o trecho selecionado"),
    h("label", { class: "inline" }, "♩=", tempoIn));

  const styleSel = h("select", { "aria-label": "Estilo de acompanhamento", onchange: (e: Event) => (harmStyle = (e.target as HTMLSelectElement).value) },
    h("option", { value: "block" }, "Acordes em bloco"), h("option", { value: "arpeggio" }, "Arpejo"), h("option", { value: "alberti" }, "Baixo de Alberti"), h("option", { value: "bass-chord" }, "Baixo + acorde"));
  const harmBtn = tip(h("button", { class: "btn accent", onclick: (e: Event) => harmonize(e.currentTarget as HTMLButtonElement, false) }, "✨ " + t("harmonize") + " seleção"), "Gera acordes só nos compassos selecionados, mantendo o resto como contexto");
  const harmAllBtn = h("button", { class: "btn", onclick: (e: Event) => harmonize(e.currentTarget as HTMLButtonElement, true) }, "Harmonizar tudo");
  const melBtn = h("button", { class: "btn", onclick: extractMel }, "Melodia ⇠ harmonia");
  const cifBtn = h("button", { class: "btn", onclick: transcribeChords }, "Cifrar");
  const recSecBtn = tip(h("button", { class: "btn rec", onclick: (e: Event) => recordSection(e.currentTarget as HTMLButtonElement) }, "● " + t("record") + " trecho"),
    "Gravar trecho: grava só os compassos selecionados (ou os primeiros que estão vazios). Conto um compasso antes e o metrônomo acompanha. Vira uma camada nova.") as HTMLButtonElement;
  const recFreeBtn = tip(h("button", { class: "btn rec", onclick: (e: Event) => recordFree(e.currentTarget as HTMLButtonElement) }, "● Nova voz"),
    "Nova voz: você ouve a partitura e grava livremente por cima, até apertar ■. A gravação vira uma nova voz numa camada própria.") as HTMLButtonElement;
  const zoomIn = h("input", { type: "range", min: 0.6, max: 2, step: 0.1, value: zoom, "aria-label": "Zoom", oninput: (e: Event) => { zoom = +(e.target as HTMLInputElement).value; render(); } });
  // Seleção: selecionar tudo · excluir só a seleção · excluir tudo (2 cliques; Ctrl+Z desfaz)
  const report = (r: { notes: number; chords: number; locked: number }, what: string) => {
    const parts = [r.notes && `${r.notes} nota${r.notes > 1 ? "s" : ""}`, r.chords && `${r.chords} cifra${r.chords > 1 ? "s" : ""}`].filter(Boolean).join(" e ");
    toast(parts ? `${what}: ${parts} excluída${r.notes + r.chords > 1 ? "s" : ""}.${r.locked ? ` ${r.locked} nota(s) em camadas com 🔒 foram preservadas.` : ""} Ctrl+Z desfaz.` : r.locked ? "Só há notas em camadas travadas 🔒 — destrave para excluir." : "Nada para excluir aqui.", parts ? "ok" : "warn", 5000);
  };
  const selAllB = h("button", { class: "sel-b", "data-tip": "Selecionar tudo (Ctrl+A) — todas as notas das camadas visíveis e destravadas da mão em edição", onclick: () => { const n = store.selectAll(); toast(n ? `${n} notas selecionadas — Delete exclui, ⇧⌘X recorta para nova camada` : "Não há notas editáveis", "info", 3500); canvas.focus(); } },
    h("span", { "aria-hidden": "true" }, "⬚"), h("small", {}, "Tudo"));
  const delSelB = h("button", { class: "sel-b", "data-tip": "Excluir seleção (Delete) — as notas marcadas, ou o conteúdo dos compassos marcados na faixa numerada", onclick: () => { report(store.deleteSelection(), "Seleção"); canvas.focus(); } },
    h("span", { "aria-hidden": "true" }, "⌫"), h("small", {}, "Seleção"));
  let delArm = 0;
  const delAllB = h("button", { class: "sel-b danger", "data-tip": "Excluir tudo — apaga as notas de todas as camadas destravadas e as cifras (clique 2×; Ctrl+Z desfaz)", onclick: () => {
    if (!delArm) { delAllB.classList.add("armed"); delAllB.lastChild!.textContent = "Confirmar?"; delArm = window.setTimeout(() => { delArm = 0; delAllB.classList.remove("armed"); delAllB.lastChild!.textContent = "Tudo"; }, 3000); return; }
    clearTimeout(delArm); delArm = 0; delAllB.classList.remove("armed"); delAllB.lastChild!.textContent = "Tudo";
    report(store.deleteAll(), "Partitura limpa"); canvas.focus(); } },
    h("span", { "aria-hidden": "true" }, "🗑"), h("small", {}, "Tudo"));
  const selBar = h("div", { class: "sel-bar", role: "group", "aria-label": "Seleção" }, selAllB, delSelB, delAllB);
  const syncSel = () => { const has = store.selectedNotes.size > 0 || store.selectedMeasures.size > 0; delSelB.toggleAttribute("disabled", !has); selBar.classList.toggle("has", has); };
  store.on((r) => { if (r === "selection" || r === "load" || r === "delete" || r === "delete-selection" || r === "delete-all") syncSel(); });
  syncSel();

  const metaBox = h("div", { class: "seg" },
    h("button", { class: "btn ghost", title: "Desfazer (⌘Z)", onclick: () => store.undoOp() }, "↶"),
    h("button", { class: "btn ghost", title: "Refazer (⇧⌘Z)", onclick: () => store.redoOp() }, "↷"),
    h("label", { class: "inline" }, "🔍", zoomIn));

  // Painel de ferramentas lateral: movível (arraste pela alça), contraível (só ícones) ou expandido.
  // Gravar e Importar ficam fixos no topo e continuam visíveis mesmo com o painel contraído.
  const recMain = tip(h("button", { class: "btn rec big-rec", "aria-label": "Gravar", onclick: (e: Event) => {
    const b = e.currentTarget as HTMLButtonElement;
    if (freeRec || !store.selectedMeasures.size) recordFree(b); else recordSection(b);
  } }, h("span", { class: "tb-ic", html: ICONS.record }), h("span", { class: "tb-lb" }, t("record"))),
    "🎙 GRAVAR — cante ou toque no microfone. Sem compassos selecionados: grava livremente uma nova voz por cima da partitura até você apertar ■. Com compassos selecionados (faixa numerada): grava só aquele trecho. Eu conto 1 compasso antes. A gravação vira uma camada nova e é transcrita em notas.") as HTMLButtonElement;
  const importBtn = tip(h("button", { class: "btn imp", "aria-label": "Importar", onclick: () => dispatchEvent(new CustomEvent("open-app", { detail: "import" })) },
    h("span", { class: "tb-ic", html: ICONS.import }), h("span", { class: "tb-lb" }, t("import"))),
    "⇪ IMPORTAR — traga um material para editar: arquivo de áudio (MP3, WAV…), foto ou scan de partitura, ou cifra em texto. A IA transcreve e o resultado entra aqui como camadas novas.");
  const titleIn = h("input", { class: "score-title", value: store.score.title, "aria-label": "Título",
    onchange: (e: Event) => store.mutate((s) => (s.title = (e.target as HTMLInputElement).value), "title") });
  const keySel = h("select", { "aria-label": "Armadura", onchange: (e: Event) => store.mutate((s) => (s.keySig = +(e.target as HTMLSelectElement).value), "key") },
    ...Object.entries(KEY_NAMES).sort((a, b) => +a[0] - +b[0]).map(([f, n]) => h("option", { value: f, selected: +f === store.score.keySig }, `${n} maior / ${NAMES[(((+f * 7 + 9) % 12) + 12) % 12]}m`)));
  const tsSel = h("select", { "aria-label": "Fórmula de compasso", onchange: (e: Event) => store.mutate((s) => (s.timeSig = (e.target as HTMLSelectElement).value.split("/").map(Number) as [number, number]), "ts") },
    ...["2/4", "3/4", "4/4", "6/8", "5/4", "7/8"].map((v) => h("option", { value: v, selected: v === store.score.timeSig.join("/") }, v)));
  const addMeasure = h("button", { class: "btn ghost", onclick: () => store.mutate((s) => { s.measures++; }, "measures") }, "+ compasso");
  // Pautas: piano completo, ocultar mão esquerda (só superior) ou só inferior; clave de cada pauta
  const stavesSel = h("select", { "aria-label": "Pautas visíveis", title: "Pautas visíveis", onchange: (e: Event) => {
    const v = (e.target as HTMLSelectElement).value;
    store.mutate((x) => { const st = staves(x); st.upper.visible = v !== "lower"; st.lower.visible = v !== "upper"; x.staves = st; }, "staves");
  } }, h("option", { value: "both" }, "𝄞+𝄢 Duas pautas"), h("option", { value: "upper" }, "Ocultar mão esquerda"), h("option", { value: "lower" }, "Só pauta inferior")) as HTMLSelectElement;
  const clefSel = (which: "upper" | "lower") => h("select", { "aria-label": which === "upper" ? "Clave da pauta superior" : "Clave da pauta inferior",
    title: which === "upper" ? "Clave da pauta superior" : "Clave da pauta inferior",
    onchange: (e: Event) => store.mutate((x) => { const st = staves(x); st[which].clef = (e.target as HTMLSelectElement).value as Clef; x.staves = st; }, "staves") },
    h("option", { value: "G" }, "𝄞 Sol"), h("option", { value: "F" }, "𝄢 Fá"), h("option", { value: "C" }, "𝄡 Dó")) as HTMLSelectElement;
  const upperClef = clefSel("upper"), lowerClef = clefSel("lower");
  const syncStaffCtl = () => {
    const st = staves(store.score);
    stavesSel.value = st.upper.visible && st.lower.visible ? "both" : st.upper.visible ? "upper" : "lower";
    upperClef.value = st.upper.clef; lowerClef.value = st.lower.clef;
    upperClef.hidden = !st.upper.visible; lowerClef.hidden = !st.lower.visible;
    handSel.value = store.hand; try { drawSummary(); } catch { /* ainda montando */ }
    instSel.value = (store.hand === "lower" ? st.lower : st.upper).instrument || "piano";
  };
  const scratch = tip(h("button", { class: "btn ghost", onclick: () => {
    if (!confirm("Começar do zero? A partitura atual será substituída por uma vazia (o que já foi salvo na Biblioteca continua lá; ⌘Z não desfaz).")) return;
    store.startFromScratch();
    toast("Partitura vazia pronta — escolha a ferramenta ✎ Nota ou grave um trecho", "ok");
  } }, "⟲ Do zero"), "Recomeçar com uma partitura vazia");
  // Mão em edição (direita, esquerda ou as duas ao mesmo tempo) e instrumento — a clave acompanha o instrumento
  const handSel = tip(h("select", { "aria-label": "Mão em edição", onchange: (e: Event) => {
    store.hand = (e.target as HTMLSelectElement).value as Hand; syncStaffCtl(); render();
    toast(store.hand === "both" ? "Editando as duas mãos: seleção, cópia, recorte e ⌘A pegam as duas pautas" : store.hand === "upper" ? "Editando a mão direita (pauta superior)" : "Editando a mão esquerda (pauta inferior)", "info", 2200);
  } }, h("option", { value: "both" }, "🙌 Ambas as mãos"), h("option", { value: "upper" }, "✋ Mão direita"), h("option", { value: "lower" }, "🤚 Mão esquerda")) as HTMLSelectElement,
    "Qual mão você está editando. 'Ambas' deixa selecionar, copiar, recortar e transpor as duas pautas juntas (arraste um retângulo na partitura).") as HTMLSelectElement;
  const instSel = tip(h("select", { "aria-label": "Instrumento", onchange: (e: Event) => applyInstrument((e.target as HTMLSelectElement).value) },
    ...INSTRUMENTS.map((i) => h("option", { value: i.id }, `${i.icon} ${i.name}`))) as HTMLSelectElement,
    "Instrumento da pauta em edição. A clave muda sozinha: violino e flauta em Sol, viola em Dó, violoncelo, fagote e baixo em Fá. Piano, órgão e harpa usam as duas pautas.") as HTMLSelectElement;
  function applyInstrument(id: string) {
    const inst = instrument(id);
    const lowerHasNotes = store.score.layers.some((l) => l.staff === "bass" && l.notes.length);
    let msg = "";
    store.mutate((x) => {
      const st = staves(x);
      if (inst.grand) {
        st.upper = { ...st.upper, clef: "G", visible: true, instrument: inst.id };
        st.lower = { ...st.lower, clef: "F", visible: true, instrument: inst.id };
        x.layers.forEach((l) => (l.program = inst.program));
        msg = `${inst.name}: pautas em Sol e Fá`;
      } else {
        const which = store.hand === "lower" ? "lower" : "upper";
        st[which] = { ...st[which], clef: inst.clef, visible: true, instrument: inst.id };
        x.layers.forEach((l) => { if ((l.staff === "bass") === (which === "lower")) l.program = inst.program; });
        if (store.hand === "both" && !lowerHasNotes) { st.lower.visible = false; msg = ` · a pauta inferior (vazia) foi ocultada — reexiba em “Pautas”`; }
        msg = `${inst.name} → clave de ${({ G: "Sol", F: "Fá", C: "Dó" } as const)[inst.clef]} na pauta ${which === "lower" ? "inferior" : "superior"}` + msg;
      }
      x.staves = st;
    }, "staves");
    toast(msg, "ok", 3500);
  }
  // ------------------------------------------------ barra lateral (trilho) + quadros explicativos
  // Trilho discreto com ícones grandes e amigáveis. Gravar e Importar ficam sempre visíveis;
  // cada grupo abre um quadro ao lado com explicação e os controles (um de cada vez).
  const explain = (el: HTMLElement, text: string) => h("div", { class: "fly-item" }, el, h("small", {}, text));
  const field = (label: string, el: HTMLElement) => h("label", { class: "fly-field" }, h("span", {}, label), el);
  const playIn = h("button", { class: "btn primary", onclick: () => togglePlay() }, "▶ " + t("play"));
  const liveIn = h("button", { class: "btn live-btn", "data-tip": "Gravar — após a contagem, a partitura toca e o que você canta ou toca (microfone, MIDI ou teclado da tela) vira notas na hora: uma ou várias ao mesmo tempo, nas duas mãos, com a duração real.",
    onclick: () => dispatchEvent(new CustomEvent("harmonia:action", { detail: "viz-live" })) }, "Gravar");
  const GROUPS: { id: string; icon: string; label: string; color: string; help: string; body: () => HTMLElement[] }[] = [
    { id: "dur", icon: ICONS.dur, label: "Duração", color: "#8d72ff", help: "Escolha a figura antes de clicar na pauta — ou arraste a figura direto para o lugar. O ponto aumenta a duração pela metade.", body: () => [durBox] },
    { id: "play", icon: ICONS.play, label: "Ouvir", color: "#3db66e", help: "Metrônomo, loop e andamento da reprodução. Para tocar, use ▶ no topo da partitura ou o player na barra de menus.", body: () => [transport] },
    { id: "harm", icon: ICONS.harm, label: "Harmonia", color: "#ef4a80", help: "A IA cria acordes e o acompanhamento da mão esquerda a partir da melodia. Selecione compassos na faixa numerada para harmonizar só um trecho.", body: () => [
      explain(harmBtn, "Só nos compassos selecionados; o resto serve de contexto."),
      explain(harmAllBtn, "A música inteira, do primeiro ao último compasso."),
      field("Estilo do acompanhamento", styleSel),
      explain(melBtn, "Faz o caminho inverso: tira a melodia (voz mais aguda) dos acordes."),
      explain(cifBtn, "Lê as notas e escreve a cifra (C, Am7, G7…) acima dos compassos.")] },
    { id: "staff", icon: ICONS.staff, label: "Pauta", color: "#2e86de", help: "Mão em edição, instrumento (a clave acompanha), tonalidade, compasso e quais pautas aparecem.", body: () => [
      field("Mão em edição", handSel), field("Instrumento", instSel),
      h("div", { class: "fly-grid" }, field("Tonalidade", keySel), field("Compasso", tsSel)),
      field("Pautas visíveis", stavesSel), h("div", { class: "fly-grid" }, field("Clave de cima", upperClef), field("Clave de baixo", lowerClef)),
      h("div", { class: "row" }, addMeasure), tintIn,
      field("Visualização", layoutSel), h("div", { class: "fly-grid" }, field("Compassos", mmSel), field("Máximo", limIn))] },
    { id: "edit", icon: ICONS.edit, label: "Editar", color: "#f39c12", help: "Selecionar tudo, excluir a seleção ou tudo, desfazer (⌘Z), refazer (⇧⌘Z) e o zoom da partitura.", body: () => [
      explain(h("button", { class: "btn", onclick: () => selAllB.click() }, "⬚ Selecionar tudo"), "Todas as notas editáveis (Ctrl+A). Para um trecho, arraste um retângulo na pauta ou marque compassos na faixa numerada."),
      explain(h("button", { class: "btn", onclick: () => delSelB.click() }, "⌫ Excluir seleção"), "Só as notas marcadas — ou, se marcou compassos, o conteúdo deles (notas e cifras)."),
      explain(h("button", { class: "btn danger", onclick: () => delAllB.click() }, "🗑 Excluir tudo"), "Limpa a partitura (camadas com 🔒 ficam). Clique duas vezes para confirmar; Ctrl+Z desfaz."),
      metaBox] },
  ];
  const fly = h("div", { class: "fly", role: "dialog", hidden: true });
  let openGroup = "";
  const groupBtns = GROUPS.map((g) => tip(h("button", { class: "rail-btn", "data-group": g.id, style: { "--c": g.color }, "aria-label": g.label, "aria-expanded": "false",
    onclick: () => toggleGroup(g.id) }, h("span", { class: "rail-ic", "aria-hidden": "true", html: g.icon }), h("small", {}, g.label)), `${g.label} — ${g.help}`));
  function toggleGroup(id: string) {
    if (openGroup === id || !id) { openGroup = ""; fly.hidden = true; }
    else {
      const g = GROUPS.find((x) => x.id === id)!;
      openGroup = id;
      fly.style.setProperty("--c", g.color);
      fly.replaceChildren(
        h("header", { class: "fly-head" }, h("span", { class: "fly-ic", "aria-hidden": "true", html: g.icon }), h("b", {}, g.label),
          h("button", { class: "fly-x", "aria-label": "Fechar", onclick: () => toggleGroup("") }, "✕")),
        h("p", { class: "fly-help" }, g.help), h("div", { class: "fly-body" }, ...g.body()));
      fly.setAttribute("aria-label", g.label);
      fly.hidden = false; fly.classList.remove("in"); void fly.offsetWidth; fly.classList.add("in");
      placeFly();
    }
    groupBtns.forEach((b) => { const on = b.dataset.group === openGroup; b.classList.toggle("on", on); b.setAttribute("aria-expanded", String(on)); });
  }
  const placeFly = () => {
    if (fly.hidden) return;
    const st = stage.getBoundingClientRect(), r = toolbar.getBoundingClientRect();
    const fw = fly.offsetWidth || 300;
    const right = r.right - st.left + 10;
    const left = right + fw > st.width && r.left - st.left - fw - 10 > 0 ? r.left - st.left - fw - 10 : right;
    Object.assign(fly.style, { left: left + "px", top: Math.max(4, r.top - st.top) + "px", maxHeight: st.height - Math.max(4, r.top - st.top) - 8 + "px" });
  };
  addEventListener("pointerdown", (e) => { if (openGroup && !fly.contains(e.target as Node) && !toolbar.contains(e.target as Node)) toggleGroup(""); }, true);
  body.addEventListener("keydown", (e) => { if (e.key === "Escape" && openGroup) { e.stopPropagation(); toggleGroup(""); } });

  const TB_KEY = "harmonia.rail.v2"; // v2: começa sempre aderida à lateral da pauta
  let tb: { mode: "docked" | "floating"; x: number; y: number } = { mode: "docked", x: 12, y: 12 };
  try { tb = { ...tb, ...JSON.parse(localStorage.getItem(TB_KEY) || "{}") }; } catch { /* */ }
  const tbGrip = h("div", { class: "rail-grip", title: "Arraste para mover a barra de ferramentas · duplo clique: voltar para a lateral" }, "⋯");
  const gb = (id: string) => groupBtns.find((b) => b.dataset.group === id)!;
  // Visualizador do instrumento (subfunção da pauta): abre/fecha a gaveta embaixo da partitura
  const vizBtn = tip(h("button", { class: "rail-btn", "data-group": "viz", style: { "--c": "#7c5cff" }, "aria-label": "Visualizador do instrumento", "aria-pressed": "false",
    onclick: () => toggleViz() }, h("span", { class: "rail-ic", "aria-hidden": "true", html: ICONS.visualizer }), h("small", {}, "Teclado")),
    "Visualizador — teclado ou braço do instrumento em 3D sob a pauta. 👁 Mostrar acende as notas tocadas (nome, intensidade e pedal); ✎ Criar escreve na pauta a nota que você tocar.") as HTMLButtonElement;
  const sec = (label: string, ...kids: HTMLElement[]) => h("div", { class: "rail-sec", role: "group", "aria-label": label }, h("small", { class: "rail-h" }, label), ...kids);
  const toolbar = h("aside", { class: "rail", "aria-label": "Barra de ferramentas da composição" }, tbGrip,
    sec("Criar", h("div", { class: "rail-pinned" }, recMain, importBtn)),
    sec("Escrever", tools),
    sec("Ajustar", h("div", { class: "rail-grid" }, gb("dur"), gb("play"), gb("staff"), gb("edit"), vizBtn)),
    sec("IA", gb("harm")));
  const applyTb = () => {
    toolbar.classList.toggle("floating", tb.mode === "floating");
    if (tb.mode === "floating") Object.assign(toolbar.style, { left: tb.x + "px", top: tb.y + "px", maxHeight: Math.max(160, (stage.clientHeight || 400) - tb.y - 6) + "px" }); else toolbar.removeAttribute("style");
    try { localStorage.setItem(TB_KEY, JSON.stringify(tb)); } catch { /* */ }
    placeFly();
  };
  tbGrip.addEventListener("dblclick", () => { tb.mode = "docked"; applyTb(); });
  tbGrip.addEventListener("pointerdown", (e) => {
    if (document.body.classList.contains("mobile")) return;
    const st = stage.getBoundingClientRect(), r0 = toolbar.getBoundingClientRect();
    const ox = e.clientX - r0.left, oy = e.clientY - r0.top, sx = e.clientX, sy = e.clientY;
    let moving = false;
    tbGrip.setPointerCapture(e.pointerId);
    const mv = (ev: PointerEvent) => {
      if (!moving && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 5) return;
      if (!moving) { moving = true; tb.mode = "floating"; toolbar.classList.add("dragging"); }
      tb.x = Math.max(0, Math.min(st.width - 70, ev.clientX - st.left - ox));
      tb.y = Math.max(0, Math.min(st.height - 60, ev.clientY - st.top - oy));
      toolbar.classList.toggle("snap", tb.x < 14);
      applyTb();
    };
    const up = () => {
      tbGrip.removeEventListener("pointermove", mv); tbGrip.removeEventListener("pointerup", up);
      toolbar.classList.remove("dragging", "snap");
      if (moving && tb.x < 14) tb.mode = "docked";
      applyTb();
    };
    tbGrip.addEventListener("pointermove", mv); tbGrip.addEventListener("pointerup", up);
  });

  // cabeçalho limpo: título, resumo da pauta (abre o quadro "Pauta") e ▶
  const summary = h("button", { class: "score-sum", title: "Pauta, instrumento, tonalidade e compasso", onclick: () => toggleGroup("staff") });
  const drawSummary = () => {
    const s = store.score, st = staves(s), inst = instrument((store.hand === "lower" ? st.lower : st.upper).instrument);
    summary.replaceChildren(...[`${inst.icon} ${inst.name}`, `${KEY_NAMES[s.keySig] ?? ""} maior`, s.timeSig.join("/"), `♩=${s.tempo}`, store.hand === "both" ? "🙌 ambas as mãos" : store.hand === "upper" ? "✋ mão direita" : "🤚 mão esquerda"]
      .map((x) => h("span", {}, x)));
  };
  const tunIn = h("button", { class: "btn tuner-btn", "data-tip": "Afinador — mostra a nota e o desvio em cents do que você canta/toca (só a entrada do microfone, mesmo com a partitura tocando). Tecla T mostra/oculta.", onclick: () => toggleTuner() });
  withIcon(tunIn, ICONS.tuner); tunIn.append("Afinador");
  const offTun = onTunerPanel((o) => tunIn.classList.toggle("on", o)); tunIn.classList.toggle("on", tunerOpen());
  const header = h("div", { class: "score-head" }, titleIn, summary, selBar, tunIn, liveIn, playIn);
  void scratch; void recSecBtn; void recFreeBtn;
  withIcon(liveIn, ICONS.record);
  const offJamE = onJam(() => { liveIn.classList.toggle("on", jamActive()); liveIn.lastChild!.textContent = jamActive() ? "Parar gravação" : "Gravar"; });
  syncStaffCtl(); drawSummary();

  const status = h("div", { class: "statusbar", "data-noi18n": "" });
  const canvas = h("div", { class: "score-canvas", tabindex: "0" });
  const stage = h("div", { class: "score-stage" });
  const paper = svg("svg", { class: "score-svg" });
  canvas.append(paper);
  const legend = h("div", { class: "score-legend", "data-noi18n": "" });
  if (document.body.classList.contains("mobile")) { zoom = 0.9; }
  const drawer = h("div", { class: "score-drawer", hidden: true, role: "region", "aria-label": "Visualizador do instrumento" });
  const main = h("div", { class: "score-main" }, legend, canvas, drawer);
  let viz: { destroy: () => void; setMode: (m: "show" | "create") => void } | null = null;
  let insBeat = -1; // cursor de inserção do modo Criar
  function toggleViz(force?: boolean, modeSel?: "show" | "create") {
    const on = force ?? drawer.hidden;
    drawer.hidden = !on; vizBtn.classList.toggle("on", on); vizBtn.setAttribute("aria-pressed", String(on));
    if (on && !viz) viz = mountInstrumentView(drawer, {
      instrumentId: () => staves(store.score).upper.instrument || "piano",
      lit: () => {
        const s = store.score, notes: { pitch: number; vel: number; color: string }[] = [];
        let pedal = false;
        if (playhead >= 0) {
          const aud = new Set(audio.audibleLayers(s).map((l) => l.id));
          for (const l of s.layers) if (l.visible && aud.has(l.id)) for (const n of l.notes) if (n.start <= playhead && n.start + n.dur > playhead) {
            notes.push({ pitch: n.pitch, vel: n.vel ?? 80, color: l.color });
            if (l.staff === "bass" && n.dur >= 2) pedal = true;
          }
        } else for (const l of s.layers) for (const n of l.notes) if (store.selectedNotes.has(n.id)) notes.push({ pitch: n.pitch, vel: n.vel ?? 80, color: l.color });
        return { notes, pedal };
      },
      create: (pitch, vel) => {
        const s = store.score, bpm = beatsPerMeasure(s), d = dur * (dotted ? 1.5 : 1);
        if (insBeat < 0) {
          const sel = [...store.selectedMeasures].sort((a, b) => a - b);
          const l = store.layer();
          insBeat = sel.length ? sel[0] * bpm : l && l.notes.length ? Math.max(...l.notes.map((n) => n.start + n.dur)) : 0;
        }
        const st = staves(s);
        const staff: "treble" | "bass" = store.hand === "upper" ? "treble" : store.hand === "lower" ? "bass" : !st.lower.visible ? "treble" : !st.upper.visible ? "bass" : pitch >= 60 ? "treble" : "bass";
        insertNote(pitch, insBeat, staff, d, vel, true);
        insBeat += d;
        store.ensureMeasures();
        status.dataset.hover = `✎ próxima nota no compasso ${Math.floor(insBeat / bpm) + 1}, tempo ${((insBeat % bpm) + 1).toFixed(2).replace(/\.00$/, "")}`;
        status.setAttribute("data-hover", status.dataset.hover);
      },
    });
    if (on && modeSel) viz?.setMode(modeSel);
  }
  store.on((r) => { if (r === "selection" && store.selectedMeasures.size) insBeat = -1; if (r === "load") insBeat = -1; });
  // barra de estudo (centro do app): captar, transcrever, multi-instrumentos, arpejos, solo, harmonizar, IA
  const act = (a: string) => () => dispatchEvent(new CustomEvent("harmonia:action", { detail: a }));
  const sb = (icon: string, label: string, tipTxt: string, fn: () => void, cls = "") => withIcon(h("button", { class: "sb-btn " + cls, "data-tip": tipTxt, onclick: fn }, label), icon);
  const micB = sb(ICONS.mic, "Microfone", "Captura em tempo real: a partitura toca (com contagem) e o que você canta ou toca vira notas numa camada 🎤 nova.", () => { if (jamActive()) stopJam(); else requestJam("mic", { focus: () => win.focus() }, micB); }, "c-mic");
  const studyBar = h("nav", { class: "study-bar", "aria-label": "Estudo" },
    micB,
    sb(ICONS.transcribe, "Transcrever", "Importar áudio ou foto da partitura e transcrever em notas (com revisão antes de juntar).", act("open-import"), "c-trs"),
    h("span", { class: "sb-sep" }),
    sb(ICONS.instruments, "Multi-instrumentos", "Um instrumento por camada (timbre, volume, liga/desliga) e novas vozes: melodia, contracanto, baixo, acordes, arpejo.", act("study:multi"), "c-ins"),
    sb(ICONS.arpeggio, "Arpejos", "Estudo de arpejos sobre a harmonia do tema, para o instrumento em foco.", act("study:arp"), "c-arp"),
    sb(ICONS.solo, "Solo / Ornamentos", "Proposta de solo com o motivo rítmico do tema e ornamentos (mordente, trilo, grupeto, apojatura).", act("study:solo"), "c-solo"),
    sb(ICONS.harm, "Harmonizar", "Harmoniza o tema inteiro (acordes + mão esquerda); veja motivo e módulos em Estudo › Análise.", () => { harmonize(harmAllBtn as HTMLButtonElement, true); }, "c-harm"),
    sb(ICONS.trophy, "Aprender", "Modo aprendizagem gamificado: tocar a partitura (esperar por mim ou no tempo) ou cumprir desafios de composição — pontos, combo, estrelas e medalhas.", act("open-learn"), "c-learn"),
    sb(ICONS.assistant, "IA Assistente", "O Maestro explica o tema: tonalidade, motivo, módulos, harmonia e cadências.", () => { try { localStorage.setItem("harmonia.analysis", "1"); } catch { /* */ } store.emit("analysis"); explainWithMaestro(); act("study:analysis")(); }, "c-ai"));
  const offJamBar = onJam(() => micB.classList.toggle("on", jamActive()));
  stage.append(toolbar, main, fly);
  body.append(header, stage, studyBar, status);
  applyTb();

  function renderLegend() {
    const s = store.score; const bpm = beatsPerMeasure(s);
    const chips = s.layers.map((l, i) => {
      const sw = document.createElementNS(SVGNS, "svg");
      sw.setAttribute("width", "26"); sw.setAttribute("height", "12");
      sw.innerHTML = `<defs>${layerPattern("sw-" + l.id, l.color, i)}</defs><rect x="1" y="1" width="24" height="10" rx="4" fill="url(#pat-sw-${l.id})" stroke="${l.color}"/>`;
      return h("button", { class: "lg-chip" + (l.id === store.selectedLayer ? " on" : "") + (l.visible ? "" : " hidden-l"), style: { "--lc": l.color } as any,
        title: `${l.name} — clique: ativar · duplo clique: mostrar/ocultar`,
        onclick: () => { store.selectedLayer = l.id; store.emit("selection"); },
        ondblclick: () => { const n = store.setVisible(l, !l.visible); if (n > 1) toast(`${l.visible ? "Mostrando" : "Ocultando"} ${n} camadas vinculadas 🔗 (gravação + notas)`, "info", 2500); } },
        sw, h("span", {}, l.name), h("small", {}, String(l.kind === "recording" ? "🎙" : l.notes.length)));
    });
    const nSel = store.selectedNotes.size, mSel = store.selectedMeasures.size;
    const src: "notes" | "measures" | null = nSel ? "notes" : mSel ? "measures" : null;
    const label = nSel ? `${nSel} nota(s)` : mSel ? `${mSel} compasso(s)` : "";
    const act = (mode: "copy" | "cut") => () => extract(mode, src!);
    legend.replaceChildren(h("div", { class: "lg-chips" }, ...chips),
      src ? h("div", { class: "sel-actions" }, h("b", {}, label),
        h("button", { class: "btn ghost", title: "Copiar para nova camada (⌘⇧C)", onclick: act("copy") }, "⧉ Copiar p/ nova camada"),
        h("button", { class: "btn ghost", title: "Recortar para nova camada (⌘⇧X)", onclick: act("cut") }, "✂ Recortar p/ nova camada")) : "");
    void bpm;
  }

  function extract(mode: "copy" | "cut", src: "notes" | "measures") {
    const r = store.extractToNewLayer(mode, src);
    if (!r.created) { toast(r.skippedLocked ? "As notas selecionadas estão em camadas bloqueadas" : "Nenhuma nota na seleção", "warn"); return; }
    toast(`${mode === "cut" ? "Recortadas" : "Copiadas"} ${r.moved} nota(s) para ${r.created} nova(s) camada(s)` + (r.skippedLocked ? ` · ${r.skippedLocked} em camada bloqueada ignorada(s)` : ""), "ok", 4000);
  }
  body.classList.add("score-editor");

  function setTool(tl: Tool) {
    tool = tl;
    tools.querySelectorAll<HTMLElement>(".tool").forEach((b) => b.classList.toggle("on", b.dataset.tool === tl));
    canvas.dataset.tool = tl;
  }

  // -------------------------------------------------------------- render
  function render() {
    const s = store.score;
    const bpm = beatsPerMeasure(s);
    ppb = 34 * zoom;
    const width = Math.max(480, canvas.clientWidth - 16);
    const mW = bpm * ppb + 16;
    const keyW = Math.abs(s.keySig) * 9;
    const firstLeft = 70 + keyW + 26, otherLeft = 62 + keyW;
    const horiz = layoutMode() === "horizontal";
    const perSys = horiz ? Math.max(1, s.measures) : Math.max(1, Math.floor((width - firstLeft) / mW));
    const st = staves(s);
    const both = st.upper.visible && st.lower.visible;
    const SYS_H = both ? 300 : 200;
    systems = [];
    liveIds = new Set(s.layers.filter((l) => l.live).map((l) => l.id));
    layerMs = new Map(s.layers.filter((l) => l.visible).map((l) => [l.id, store.layerMeasures(l)]));
    anal = analysisOn() ? analyze(s) : null;
    for (let m = 0, i = 0; m < s.measures; m += perSys, i++) {
      const y = (anal ? 22 : 10) + i * SYS_H;
      systems.push({ index: i, y, firstMeasure: m, nMeasures: Math.min(perSys, s.measures - m), left: i === 0 ? firstLeft : otherLeft,
        trebleY: y + 92, bassY: both ? y + 92 + 40 + 78 : y + 92 });
    }
    paper.setAttribute("width", String(horiz ? Math.max(width, firstLeft + s.measures * mW + 60) : width));
    canvas.classList.toggle("horiz", horiz);
    paper.setAttribute("height", String(systems.length * SYS_H + 20));
    paper.replaceChildren();
    const defs = svg("defs");
    // Identidade de camada: cor + padrão da barra de duração (distinguível também sem cor)
    defs.innerHTML = `<filter id="nshadow"><feDropShadow dx="0" dy="1" stdDeviation="1.2" flood-opacity=".35"/></filter>` +
      s.layers.map((l, i) => layerPattern(l.id, l.color, i)).join("");
    paper.append(defs);
    for (const sys of systems) drawSystem(sys, s, bpm, mW);
    drawPlayhead();
    renderLegend();
    status.textContent = `${s.measures} compassos · ${s.timeSig.join("/")} · ${KEY_NAMES[s.keySig] ?? ""} · ♩=${s.tempo} · camada ativa: ${store.layer()?.name ?? "—"}${store.selectedMeasures.size ? ` · seleção: compassos ${[...store.selectedMeasures].sort((a, b) => a - b).map((m) => m + 1).join(", ")}` : ""}`;
  }

  function xOf(sys: SysGeom, beat: number, bpm: number, mW: number) {
    const rel = beat - sys.firstMeasure * bpm;
    const m = Math.floor(rel / bpm);
    return sys.left + m * mW + 10 + (rel - m * bpm) * ppb;
  }

  function drawStaff(g: SVGGElement, y: number, x0: number, x1: number) {
    for (let i = 0; i < 5; i++) g.append(svg("line", { x1: x0, x2: x1, y1: y + i * LS, y2: y + i * LS, class: "staff-line" }));
  }

  function drawSystem(sys: SysGeom, s: Score, bpm: number, mW: number) {
    const g = svg("g", { class: "system", "data-sys": sys.index });
    paper.append(g);
    const x0 = 8, x1 = sys.left + sys.nMeasures * mW;
    // seleção de compassos + bandas
    for (let k = 0; k < sys.nMeasures; k++) {
      const m = sys.firstMeasure + k;
      const mx = sys.left + k * mW;
      if (store.selectedMeasures.has(m)) g.append(svg("rect", { x: mx, y: sys.y + 4, width: mW, height: sys.bassY + 40 + 30 - sys.y, rx: 6, class: "measure-sel" }));
      g.append(svg("rect", { x: mx + 2, y: sys.y + 4, width: mW - 4, height: 18, rx: 5, class: "measure-band", "data-measure": m }));
      g.append(svg("text", { x: mx + 6, y: sys.y + 17, class: "measure-num" }, String(m + 1)));
      g.append(svg("rect", { x: mx + 2, y: sys.y + 26, width: mW - 4, height: 22, rx: 5, class: "chord-band", "data-chord-measure": m }));
      for (const c of s.chords[m] || []) {
        const cx = mx + 10 + c.beat * ppb;
        g.append(svg("text", { x: cx, y: sys.y + 42, class: "chord-sym", "data-chord-measure": m }, c.symbol));
      }
      for (const a of s.annotations.filter((a) => a.measure === m)) {
        const ax = mx + 10 + a.beat * ppb;
        const ag = svg("g", { class: "annotation", "data-ann": a.id, transform: `translate(${ax},${sys.y + 52})` });
        const tw = Math.min(mW * 1.6, 12 + a.text.length * 6.2);
        ag.append(svg("rect", { x: 0, y: -2, width: tw, height: 18, rx: 6, fill: a.color, opacity: 0.9 }), svg("text", { x: 6, y: 11, class: "ann-text" }, a.text));
        const al = a.layerId ? s.layers.find((l) => l.id === a.layerId) : null;
        if (al) { ag.append(svg("rect", { x: 0, y: -2, width: 4, height: 18, rx: 2, fill: al.color }), svg("title", {}, `Anotação da camada ${al.name}`)); }
        g.append(ag);
      }
    }
    const st = staves(s);
    const both = st.upper.visible && st.lower.visible;
    const yTop = sys.trebleY, yBot = (both ? sys.bassY : sys.trebleY) + 40;
    // cor de cada camada sobre os compassos que ela ocupa (camadas sobrepostas misturam as cores)
    if (tintOn) for (let k = 0; k < sys.nMeasures; k++) {
      const m = sys.firstMeasure + k, mx = sys.left + k * mW;
      const here = s.layers.filter((l) => l.visible && layerMs.get(l.id)?.has(m));
      if (!here.length) continue;
      const segW = (mW - 4) / here.length;
      here.forEach((l, i) => {
        const tg = svg("rect", { x: mx + 1, y: yTop - 10, width: mW - 2, height: yBot - yTop + 20, rx: 6, fill: l.color, class: "layer-tint" + (l.kind === "recording" ? " rec" : "") + (l.live ? " live" : "") });
        tg.append(svg("title", {}, `Compasso ${m + 1} · camada ${l.name}${l.link && !l.unlinked ? " 🔗" : ""}`));
        g.append(tg);
        g.append(svg("rect", { x: mx + 2 + i * segW, y: sys.y + 19, width: segW, height: 4, rx: 2, fill: l.color, class: "layer-strip", "data-measure": m }));
      });
    }
    // análise do tema: módulos (A, A', B…), motivo rítmico e harmonização recomendada
    if (anal) {
      const last = sys.firstMeasure + sys.nMeasures - 1;
      for (const md of anal.modules) {
        if (md.to < sys.firstMeasure || md.from > last) continue;
        const a0 = Math.max(md.from, sys.firstMeasure), a1 = Math.min(md.to, last);
        const bx0 = sys.left + (a0 - sys.firstMeasure) * mW + 4, bx1 = sys.left + (a1 - sys.firstMeasure + 1) * mW - 4, by = Math.max(9, sys.y - 2);
        const mg = svg("g", { class: "an-module mod-" + md.label[0] });
        mg.append(svg("path", { d: `M${bx0} ${by + 7} v-7 H${bx1} v7`, class: "an-bracket" }));
        const lb = md.from >= sys.firstMeasure ? `Módulo temático (${md.label})` : `(${md.label}) cont.`;
        const tw = 10 + lb.length * 6.1, tx = (bx0 + bx1) / 2 - tw / 2;
        mg.append(svg("rect", { x: tx, y: by - 9, width: tw, height: 16, rx: 8, class: "an-pill" }), svg("text", { x: tx + 6, y: by + 3, class: "an-text" }, lb));
        mg.append(svg("title", {}, `Módulo ${md.label}: compassos ${md.from + 1}–${md.to + 1}${md.label.includes("'") ? " (variação)" : ""} · semelhança ${Math.round(md.sim * 100)}%`));
        g.append(mg);
      }
      if (anal.motive) for (const m of anal.motive.measures) {
        if (m < sys.firstMeasure || m > last) continue;
        const mx = sys.left + (m - sys.firstMeasure) * mW;
        const mg = svg("g", { class: "an-motive" });
        mg.append(svg("path", { d: `M${mx + 6} ${yTop - 14} v-5 H${mx + mW - 6} v5`, class: "an-mbracket" }),
          svg("text", { x: mx + 8, y: yTop - 22, class: "an-mtext" }, "Motivo rítmico"),
          svg("title", {}, `Motivo rítmico: ${anal.motive.durations.map(figureName).join(" – ")} (compassos ${anal.motive.measures.map((x) => x + 1).join(", ")})`));
        g.append(mg);
      }
      if (anal.suggested) for (let k = 0; k < sys.nMeasures; k++) {
        const m = sys.firstMeasure + k; if (s.chords[m]?.length) continue;
        for (const c of anal.chords[m] || []) g.append(svg("text", { x: sys.left + k * mW + 10 + c.beat * ppb, y: sys.y + 42, class: "chord-sug" }, c.symbol),
          svg("title", {}, "Harmonização recomendada — Estudo › Análise › Aplicar"));
      }
    }
    if (st.upper.visible) drawStaff(g, sys.trebleY, x0, x1);
    if (st.lower.visible) drawStaff(g, sys.bassY, x0, x1);
    // chave do piano (só com as duas pautas) e barras
    if (both) g.append(svg("path", { d: `M${x0 - 2} ${sys.trebleY} q-10 ${(sys.bassY + 40 - sys.trebleY) / 4} 0 ${(sys.bassY + 40 - sys.trebleY) / 2} q-10 ${(sys.bassY + 40 - sys.trebleY) / 4} 0 ${(sys.bassY + 40 - sys.trebleY) / 2}`, class: "brace" }));
    g.append(svg("line", { x1: x0, x2: x0, y1: yTop, y2: yBot, class: "barline" }));
    for (let k = 0; k <= sys.nMeasures; k++) {
      const bx = sys.left + k * mW;
      const last = sys.firstMeasure + k === s.measures;
      g.append(svg("line", { x1: bx, x2: bx, y1: yTop, y2: yBot, class: last ? "barline final" : "barline" }));
    }
    // "+" discreto nas barras: insere compasso entre os compassos e ao final
    for (let k = sys.index === 0 ? 0 : 1; k <= sys.nMeasures; k++) {
      const at = sys.firstMeasure + k;
      const bx = sys.left + k * mW;
      const isEnd = at === s.measures;
      const pg = svg("g", { class: "ins-measure" + (isEnd ? " end" : ""), "data-insert": at, transform: `translate(${bx + (isEnd ? 12 : 0)},${sys.trebleY - 12})` });
      const title = svg("title", {}, isEnd ? "Adicionar compasso no final" : at === 0 ? "Inserir compasso no início" : `Inserir compasso entre ${at} e ${at + 1}`);
      pg.append(title, svg("circle", { r: 7, "data-insert": at }), svg("path", { d: "M-3.5 0H3.5M0 -3.5V3.5", "data-insert": at }));
      g.append(pg);
    }
    // claves, armadura, fórmula
    const visibleStaves: [number, Clef][] = [];
    if (st.upper.visible) visibleStaves.push([sys.trebleY, st.upper.clef]);
    if (st.lower.visible) visibleStaves.push([sys.bassY, st.lower.clef]);
    for (const [sy, clef] of visibleStaves) {
      const cy = clef === "G" ? sy + 31 : clef === "F" ? sy + 21 : sy + 30;
      g.append(svg("text", { x: 14, y: cy, class: "clef clef-" + clef + (clef === "F" ? " bass" : "") }, CLEF_GLYPH[clef]));
    }
    const order = s.keySig >= 0 ? SHARP_LETTERS : FLAT_LETTERS;
    order.slice(0, Math.abs(s.keySig)).forEach((_letter, i) => {
      const sym = s.keySig > 0 ? "♯" : "♭";
      const tStep = s.keySig > 0 ? [38, 35, 39, 36, 33, 37, 34][i] : [34, 37, 33, 36, 32, 35, 31][i];
      for (const [sy, clef] of visibleStaves)
        g.append(svg("text", { x: 50 + i * 9, y: sy + (CLEF_TOP[clef] - (tStep + CLEF_SHIFT[clef])) * LS / 2 + 4, class: "acc" }, sym));
    });
    if (sys.index === 0) {
      const tx = 56 + Math.abs(s.keySig) * 9;
      for (const [sy] of visibleStaves) {
        g.append(svg("text", { x: tx, y: sy + 18, class: "timesig" }, String(s.timeSig[0])));
        g.append(svg("text", { x: tx, y: sy + 38, class: "timesig" }, String(s.timeSig[1])));
      }
    }
    // notas por camada
    const fromBeat = sys.firstMeasure * bpm, toBeat = (sys.firstMeasure + sys.nMeasures) * bpm;
    for (const l of s.layers) {
      if (!l.visible) continue;
      const lg = svg("g", { class: "layer" + (l.id === store.selectedLayer ? " active" : "") + (l.locked ? " locked" : "") + (store.inHand(l) ? "" : " other-hand"), "data-layer": l.id, style: `--lc:${l.color}` });
      g.append(lg);
      if (l.kind === "recording" && l.audioDur) { // clipe contínuo na posição exata (arrastável)
        const spbS = 60 / s.tempo;
        const b0 = (l.audioOffset || 0) / spbS, b1 = b0 + l.audioDur / spbS;
        const sb0 = sys.firstMeasure * bpm, sb1 = (sys.firstMeasure + sys.nMeasures) * bpm;
        if (b1 > sb0 && b0 < sb1) {
          const x0 = xOf(sys, Math.max(b0, sb0), bpm, mW), x1 = Math.min(xOf(sys, Math.min(b1, sb1) - 1e-6, bpm, mW), sys.left + sys.nMeasures * mW);
          const linked = !!l.link && !l.unlinked && s.layers.some((x) => x.link === l.link && x.id !== l.id);
          lg.append(svg("rect", { x: x0, y: sys.trebleY + 44, width: Math.max(8, x1 - x0), height: 16, rx: 8, class: "rec-clip", fill: `url(#pat-${l.id})`, stroke: l.color, "data-rec": l.id }),
            svg("text", { x: x0 + 6, y: sys.trebleY + 56, class: "rec-label", "data-rec": l.id }, (linked ? "🔗 " : "🎙 ") + l.name),
            svg("title", {}, `${l.name} — arraste para mover${linked ? " (as notas vinculadas acompanham)" : ""} · duplo clique: opções (ouvir, transcrever…)`));
        }
        continue;
      }
      if (l.kind === "recording") {
        for (const m of l.measures || []) if (m >= sys.firstMeasure && m < sys.firstMeasure + sys.nMeasures) {
          const rx = sys.left + (m - sys.firstMeasure) * mW;
          lg.append(svg("rect", { x: rx + 4, y: sys.trebleY + 44, width: mW - 8, height: 16, rx: 8, class: "rec-clip", fill: `url(#pat-${l.id})`, stroke: l.color, "data-rec": l.id }), svg("text", { x: rx + 10, y: sys.trebleY + 56, class: "rec-label", "data-rec": l.id }, "🎙 " + l.name));
        }
        continue;
      }
      const cfgL = l.staff === "bass" ? st.lower : st.upper;
      if (!cfgL.visible) continue; // pauta oculta (ex.: mão esquerda escondida)
      const staffY = l.staff === "bass" ? sys.bassY : sys.trebleY;
      const top = CLEF_TOP[cfgL.clef];
      for (const n of l.notes) {
        if (n.start >= toBeat || n.start < fromBeat) continue;
        drawNote(lg, n, sys, staffY, top, bpm, mW, s.keySig, l.staff, l.color, l.id, l.name);
      }
    }
  }

  function drawNote(g: SVGGElement, n: Note, sys: SysGeom, staffY: number, top: number, bpm: number, mW: number, fifths: number, staff: string, color: string, layerId = "", layerName = "") {
    const { step, letter, acc } = spell(n.pitch, fifths);
    const y = staffY + (top - step) * LS / 2;
    const x = xOf(sys, n.start, bpm, mW);
    const sel = store.selectedNotes.has(n.id);
    const live = !!layerId && liveIds.has(layerId);
    const lm = learnMarks.get(n.id);
    const ng = svg("g", { class: "note" + (sel ? " sel" : "") + (live ? " live-note" : "") + (lm ? " learn-" + lm : ""), "data-id": n.id });
    // barra de duração (didática) – limitada ao fim do sistema
    const endX = Math.min(xOf(sys, Math.min(n.start + n.dur, (sys.firstMeasure + sys.nMeasures) * bpm) - 1e-6, bpm, mW), sys.left + sys.nMeasures * mW);
    ng.append(svg("title", {}, `Camada: ${layerName} · ${SOLFEGE[n.pitch % 12]}${Math.floor(n.pitch / 12) - 1} · ${n.dur} tempo(s)`));
    ng.append(svg("rect", { x: x - 1, y: y - 4, width: Math.max(6, endX - x), height: 8, rx: 4, class: "dur-bar", fill: layerId ? `url(#pat-${layerId})` : color, stroke: color }));
    ng.append(svg("rect", { x: Math.max(x + 4, endX - 6), y: y - 5, width: 7, height: 10, rx: 3, class: "dur-handle", "data-resize": n.id }));
    // linhas suplementares
    const bottomStep = top - 8;
    for (let st = bottomStep - 2; st >= step; st -= 2) ng.append(svg("line", { x1: x - 8, x2: x + 10, y1: staffY + (top - st) * LS / 2, y2: staffY + (top - st) * LS / 2, class: "ledger" }));
    for (let st = top + 2; st <= step; st += 2) ng.append(svg("line", { x1: x - 8, x2: x + 10, y1: staffY + (top - st) * LS / 2, y2: staffY + (top - st) * LS / 2, class: "ledger" }));
    // acidente
    const ka = keyAcc(fifths)[letter];
    if (acc !== ka) ng.append(svg("text", { x: x - 15, y: y + 4, class: "acc" }, acc === 1 ? "♯" : acc === -1 ? "♭" : "♮"));
    const d = n.dur;
    const base = d >= 3.99 ? 4 : d >= 1.99 ? 2 : d >= 0.99 ? 1 : d >= 0.49 ? 0.5 : 0.25;
    const hollow = base >= 2;
    ng.append(svg("ellipse", { cx: x + 1, cy: y, rx: 6.2, ry: 4.4, transform: `rotate(-20 ${x + 1} ${y})`, class: "head" + (hollow ? " hollow" : ""), filter: "url(#nshadow)" }));
    if (base < 4) {
      const up = step < top - 4; // abaixo da linha central: haste para cima
      const sx = up ? x + 6.6 : x - 4.6;
      const y2 = up ? y - 32 : y + 32;
      ng.append(svg("line", { x1: sx, x2: sx, y1: y, y2, class: "stem" }));
      const flags = base === 0.5 ? 1 : base === 0.25 ? 2 : 0;
      for (let f = 0; f < flags; f++) {
        const fy = y2 + (up ? f * 7 : -f * 7);
        ng.append(svg("path", { d: up ? `M${sx} ${fy} q9 6 7 16` : `M${sx} ${fy} q9 -6 7 -16`, class: "flag" }));
      }
    }
    if (Math.abs(d - base * 1.5) < 1e-3) ng.append(svg("circle", { cx: x + 12, cy: y - (step % 2 === 0 ? 3 : 0), r: 1.8, class: "dot" }));
    if (n.effect) ng.append(svg("text", { x: x - 4, y: y - 12, class: "effect" }, ({ vibrato: "∿", glissando: "↗", fermata: "𝄐", staccato: "·", falsetto: "°" } as any)[n.effect] || "✦"));
    if (n.lyric && staff === "treble") ng.append(svg("text", { x: x - 2, y: sys.trebleY + 40 + 34, class: "lyric" + (n.lyric === "_" ? " melisma" : "") }, n.lyric === "_" ? "—" : n.lyric));
    void color;
    g.append(ng);
  }

  function drawPlayhead() {
    paper.querySelector(".play-guide")?.remove();
    const s = store.score; const bpm = beatsPerMeasure(s); const mW = bpm * ppb + 16;
    const st = staves(s);
    const reading = playhead >= 0;
    const beat = reading ? playhead : store.readCursor();
    if (!reading && (beat <= 0 && !store.selectedMeasures.size)) return;
    const m = Math.floor(beat / bpm + 1e-9);
    const sys = systems.find((y) => m >= y.firstMeasure && m < y.firstMeasure + y.nMeasures);
    if (!sys) return;
    const yTop = (st.upper.visible ? sys.trebleY : sys.bassY) - 30, yBot = (st.lower.visible ? sys.bassY : sys.trebleY) + 50;
    const g = svg("g", { class: "play-guide" + (reading ? " reading" : " cursor") });
    const mx = sys.left + (m - sys.firstMeasure) * mW;
    const x = xOf(sys, Math.min(beat, (sys.firstMeasure + sys.nMeasures) * bpm - 1e-6), bpm, mW);
    if (reading) {
      // compasso em execução destacado + guia com a posição exata do leitor
      g.append(svg("rect", { x: mx + 1, y: yTop + 6, width: mW - 2, height: yBot - yTop - 6, rx: 6, class: "now-measure" }));
      const inBeat = beat - m * bpm;
      g.append(svg("rect", { x: mx + 2, y: sys.y + 4, width: Math.max(2, Math.min(mW - 4, (inBeat / bpm) * (mW - 4))), height: 18, rx: 5, class: "now-progress" }));
      g.append(svg("line", { x1: x, x2: x, y1: yTop, y2: yBot, class: "playhead" }));
      // a vista acompanha o leitor (horizontal: rola para o lado; vertical: para baixo)
      const vw = canvas.clientWidth, vh = canvas.clientHeight;
      if (x < canvas.scrollLeft + 40 || x > canvas.scrollLeft + vw - 120) canvas.scrollLeft = Math.max(0, x - vw * 0.3);
      if (yTop < canvas.scrollTop || yBot > canvas.scrollTop + vh) canvas.scrollTop = Math.max(0, yTop - 40);
      g.append(svg("path", { d: `M${x - 7} ${yTop - 10} h14 l-7 9 z`, class: "playhead-cap" }));
      g.append(svg("text", { x: x + 9, y: yTop - 2, class: "playhead-lb" }, `c.${m + 1} · ${Math.floor(inBeat) + 1}`));
    } else {
      // cursor de leitura parado: de onde a reprodução / o ao vivo recomeça
      g.append(svg("line", { x1: x, x2: x, y1: yTop, y2: yBot, class: "read-cursor" }));
      g.append(svg("path", { d: `M${x - 6} ${yTop - 9} h12 l-6 8 z`, class: "read-cap" }));
      g.append(svg("text", { x: x + 8, y: yTop - 2, class: "read-lb" }, `cursor · c.${m + 1}`));
    }
    paper.append(g);
  }
  const offBeat = audio.onScoreBeat((b) => { playhead = b === null ? -1 : b; drawPlayhead(); });
  store.on((r) => { if (r === "cursor" || r === "selection") drawPlayhead(); if (r === "analysis" || r === "extend" || r === "learn") render(); });

  // ------------------------------------------------------- captura em tempo real (🎤): nota soando agora
  let liveRaf = 0, liveLast: LiveState | null = null;
  function drawLive() {
    liveRaf = 0;
    paper.querySelector(".live-ghost")?.remove();
    const st = liveLast; if (!st) { body.classList.remove("capturing"); return; }
    body.classList.add("capturing");
    const s = store.score, bpm = beatsPerMeasure(s), mW = bpm * ppb + 16;
    const now = Math.max(0, st.nowBeat);
    const m = Math.floor(now / bpm);
    const sys = systems.find((y) => m >= y.firstMeasure && m < y.firstMeasure + y.nMeasures) ?? systems[systems.length - 1];
    if (!sys) return;
    const g = svg("g", { class: "live-ghost" });
    const x = xOf(sys, Math.min(now, (sys.firstMeasure + sys.nMeasures) * bpm - 1e-6), bpm, mW);
    g.append(svg("line", { x1: x, x2: x, y1: sys.trebleY - 34, y2: sys.bassY + 50, class: "live-cursor" }));
    const lvH = 6 + st.level * 40;
    g.append(svg("rect", { x: x - 3, y: sys.trebleY - 34 - lvH, width: 6, height: lvH, rx: 3, class: "live-level" }));
    let label = st.input === "midi" ? "🎹 aguardando tecla…" : "🎤 ouvindo…";
    const heard = st.pitch !== null ? [{ pitch: st.pitch, startBeat: st.startBeat }, ...(st.extra || [])] : [];
    const cfg = staves(s);
    for (const hp of heard) {
      const bass = (hp.pitch < 60 && cfg.lower.visible) || !cfg.upper.visible;
      const staffY = bass ? sys.bassY : sys.trebleY, top = CLEF_TOP[bass ? cfg.lower.clef : cfg.upper.clef];
      const { step } = spell(hp.pitch, s.keySig);
      const y = staffY + (top - step) * LS / 2;
      const sb = Math.max(sys.firstMeasure * bpm, Math.min(hp.startBeat, now));
      const x0 = xOf(sys, sb, bpm, mW);
      g.append(svg("rect", { x: x0 - 1, y: y - 5, width: Math.max(8, x - x0), height: 10, rx: 5, class: "live-bar" }));
      g.append(svg("ellipse", { cx: x0 + 1, cy: y, rx: 6.6, ry: 4.8, transform: `rotate(-20 ${x0 + 1} ${y})`, class: "live-head" }));
    }
    if (heard.length) {
      const nm = (p: number) => `${SOLFEGE[p % 12]}${Math.floor(p / 12) - 1}`;
      label = `${st.input === "midi" ? "🎹" : "🎤"} ${heard.length > 1 ? "acorde " + heard.map((x) => nm(x.pitch)).join("+") : nm(heard[0].pitch)} · gravando${st.timbre ? " · " + st.timbre : ""}`;
    }
    const tx = svg("text", { x: x + 8, y: sys.trebleY - 50, class: "live-label" }, `${label} · ${st.notes} nota${st.notes === 1 ? "" : "s"}`);
    g.append(tx);
    paper.append(g);
  }
  const offLive = onLive((st) => { liveLast = st; if (!liveRaf) liveRaf = requestAnimationFrame(drawLive); });

  // ------------------------------------------------------- hit testing
  function locate(ev: { clientX: number; clientY: number }) {
    const r = paper.getBoundingClientRect();
    const px = ev.clientX - r.left, py = ev.clientY - r.top;
    const s = store.score; const bpm = beatsPerMeasure(s); const mW = bpm * ppb + 16;
    const sys = systems.find((y) => py >= y.y && py < y.y + 300) || systems[systems.length - 1];
    const k = Math.floor((px - sys.left) / mW);
    const measure = Math.max(0, Math.min(s.measures - 1, sys.firstMeasure + Math.max(0, Math.min(sys.nMeasures - 1, k))));
    const inBeat = Math.max(0, Math.min(bpm - grid, (px - sys.left - Math.max(0, k) * mW - 10) / ppb));
    const beat = measure * bpm + Math.round(inBeat / grid) * grid;
    const st = staves(s);
    const mid = (sys.trebleY + 40 + sys.bassY) / 2;
    let staff: "treble" | "bass" = st.upper.visible && st.lower.visible ? (py < mid ? "treble" : "bass") : st.upper.visible ? "treble" : "bass";
    // com uma só mão em edição, o lápis escreve na pauta dela (se estiver visível)
    if (store.hand === "upper" && st.upper.visible) staff = "treble";
    if (store.hand === "lower" && st.lower.visible) staff = "bass";
    const step = staff === "treble" ? Math.round(CLEF_TOP[st.upper.clef] - (py - sys.trebleY) / (LS / 2)) : Math.round(CLEF_TOP[st.lower.clef] - (py - sys.bassY) / (LS / 2));
    return { px, py, sys, measure, beat, staff, step, pitch: stepToPitch(step, s.keySig) };
  }

  function findNote(id: string) {
    for (const l of store.score.layers) { const n = l.notes.find((x) => x.id === id); if (n) return { l, n }; }
    return null;
  }

  function targetLayer(staff: "treble" | "bass") {
    const sel = store.layer();
    if (sel && !sel.locked && sel.staff === staff && sel.kind !== "recording") return sel;
    const ex = store.score.layers.find((l) => l.staff === staff && !l.locked && l.visible && l.kind !== "recording");
    if (ex) return ex;
    const nl = newLayer(staff === "treble" ? "melody" : "harmony", staff === "treble" ? "Melodia" : "Mão esquerda", staff);
    store.score.layers.push(nl);
    return nl;
  }

  const timbreFor = (staff: "treble" | "bass") => instrument((staff === "bass" ? staves(store.score).lower : staves(store.score).upper).instrument).timbre;
  function insertNote(pitch: number, beat: number, staff: "treble" | "bass", d = dur * (dotted ? 1.5 : 1), vel = 84, silent = false) {
    store.mutate(() => {
      const l = targetLayer(staff);
      const n: Note = { id: uid(), pitch, start: beat, dur: d, vel };
      l.notes.push(n);
      store.selectedLayer = l.id;
      store.selectedNotes = new Set([n.id]);
    }, "add");
    if (!silent) audio.playNote(pitch, 0, 0.5, 80, 1, undefined, timbreFor(staff));
  }

  // ------------------------------------------------------ interações
  let drag: null | { kind: "move" | "resize"; ids: string[]; startX: number; startY: number; orig: Map<string, { start: number; pitch: number; dur: number }>; moved: boolean; dup: boolean } = null;

  let lastRecDown = { id: "", t: 0 };
  let lastDown = { key: "", t: 0 };
  /** Segundo toque no mesmo alvo em até 400 ms = duplo clique. */
  const isDbl = (key: string) => { const now = performance.now(), d = lastDown.key === key && now - lastDown.t < 400; lastDown = { key, t: now }; return d; };
  paper.addEventListener("pointerdown", (ev) => {
    canvas.focus();
    const t0 = ev.target as Element;
    const loc = locate(ev);
    const noteEl = t0.closest<SVGGElement>(".note");
    const resizeId = (t0 as SVGElement).dataset?.resize;
    const measureBand = (t0 as SVGElement).dataset?.measure;
    const chordM = t0.closest<SVGElement>("[data-chord-measure]")?.dataset.chordMeasure;
    const annEl = t0.closest<SVGGElement>(".annotation");

    const recId = (t0 as SVGElement).dataset?.rec;
    if (recId) {
      // duplo clique detectado à mão (pointerdown não informa a contagem de cliques em todos os navegadores)
      const now = performance.now(), dbl = lastRecDown.id === recId && now - lastRecDown.t < 400;
      lastRecDown = { id: recId, t: now };
      if (dbl) recMenu(recId, loc); else dragRecording(recId, ev);
      return;
    }
    const ins = t0.closest<SVGElement>("[data-insert]")?.dataset.insert;
    if (ins !== undefined) {
      const at = +ins;
      store.insertMeasure(at, ev.altKey ? 4 : 1);
      toast(ev.altKey ? `4 compassos inseridos a partir do ${at + 1}` : at >= store.score.measures - 1 ? "Compasso adicionado no final" : `Compasso inserido na posição ${at + 1}`, "ok", 1800);
      return;
    }
    if (measureBand !== undefined) {
      const m = +measureBand;
      store.selectedNotes.clear(); // seleção de compassos substitui a de notas
      if (ev.shiftKey && store.selectedMeasures.size) {
        const a = Math.min(...store.selectedMeasures, m), b = Math.max(...store.selectedMeasures, m);
        for (let i = a; i <= b; i++) store.selectedMeasures.add(i);
      } else if (ev.metaKey || ev.ctrlKey) {
        store.selectedMeasures.has(m) ? store.selectedMeasures.delete(m) : store.selectedMeasures.add(m);
      } else {
        const only = store.selectedMeasures.size === 1 && store.selectedMeasures.has(m);
        store.selectedMeasures = only ? new Set() : new Set([m]);
      }
      store.emit("selection"); return;
    }
    if (chordM !== undefined && (tool === "chord" || isDbl("chord" + chordM))) { editChords(+chordM, loc); return; }
    if (annEl) { if (isDbl("ann" + annEl.dataset.ann)) editAnnotation(annEl.dataset.ann!, loc); else dragAnnotation(annEl.dataset.ann!, ev); return; }
    if (tool === "annotate") { addAnnotation(loc); return; }

    if (noteEl) {
      const id = noteEl.dataset.id!;
      const f = findNote(id);
      if (!f) return;
      if (!store.inHand(f.l)) { toast(`Essa nota é da ${f.l.staff === "bass" ? "mão esquerda" : "mão direita"} — troque a mão em edição ou escolha “Ambas”`, "info", 2600); return; }
      if (tool === "erase") { store.mutate(() => (f.l.notes = f.l.notes.filter((x) => x.id !== id)), "erase"); return; }
      if (tool === "lyrics") { editLyric(id, loc); return; }
      if (f.l.locked) { toast(`Camada "${f.l.name}" está bloqueada`, "warn"); return; }
      store.selectedLayer = f.l.id;
      store.selectedMeasures.clear(); // seleção de notas substitui a de compassos
      if (ev.shiftKey) store.selectedNotes.has(id) ? store.selectedNotes.delete(id) : store.selectedNotes.add(id);
      else if (!store.selectedNotes.has(id)) store.selectedNotes = new Set([id]);
      const ids = [...store.selectedNotes];
      drag = { kind: resizeId ? "resize" : "move", ids, startX: ev.clientX, startY: ev.clientY, moved: false, dup: ev.altKey,
        orig: new Map(ids.map((i) => { const x = findNote(i)!.n; return [i, { start: x.start, pitch: x.pitch, dur: x.dur }]; })) };
      paper.setPointerCapture(ev.pointerId);
      audio.playNote(f.n.pitch, 0, 0.35, 80, 1, undefined, audio.timbreOf(store.score, f.l));
      store.emit("selection");
      return;
    }
    if (tool === "pencil") { insertNote(loc.pitch, loc.beat, loc.staff); return; }
    if (tool === "select") startMarquee(ev);
  });

  /** Seleção por retângulo: pega notas das duas pautas de uma vez (ou só da mão em edição). */
  function startMarquee(ev: PointerEvent) {
    const r = paper.getBoundingClientRect();
    const x0 = ev.clientX - r.left, y0 = ev.clientY - r.top;
    const base = ev.shiftKey ? new Set(store.selectedNotes) : new Set<string>();
    const box = svg("rect", { class: "marquee", x: x0, y: y0, width: 0, height: 0 });
    let shown = false;
    const mv = (e: PointerEvent) => {
      const x1 = e.clientX - r.left, y1 = e.clientY - r.top;
      if (!shown && Math.hypot(x1 - x0, y1 - y0) < 4) return;
      if (!shown) { paper.append(box); shown = true; }
      const bx = Math.min(x0, x1), by = Math.min(y0, y1), bw = Math.abs(x1 - x0), bh = Math.abs(y1 - y0);
      Object.entries({ x: bx, y: by, width: bw, height: bh }).forEach(([k, v]) => box.setAttribute(k, String(v)));
      const sel = new Set(base);
      paper.querySelectorAll<SVGGElement>(".layer:not(.other-hand):not(.locked) .note").forEach((n) => {
        const hr = n.querySelector(".head")!.getBoundingClientRect();
        const cx = hr.left + hr.width / 2 - r.left, cy = hr.top + hr.height / 2 - r.top;
        if (cx >= bx && cx <= bx + bw && cy >= by && cy <= by + bh) sel.add(n.dataset.id!);
      });
      store.selectedNotes = sel;
      paper.querySelectorAll<SVGGElement>(".note").forEach((n) => n.classList.toggle("sel", sel.has(n.dataset.id!)));
    };
    const up = () => {
      removeEventListener("pointermove", mv); removeEventListener("pointerup", up);
      box.remove();
      if (!shown && !ev.shiftKey) store.selectedNotes.clear();
      if (store.selectedNotes.size) store.selectedMeasures.clear();
      store.emit("selection");
    };
    addEventListener("pointermove", mv); addEventListener("pointerup", up);
  }

  let snapshotTaken = false;
  paper.addEventListener("pointermove", (ev) => {
    const loc = locate(ev);
    const sp = SOLFEGE[loc.pitch % 12] + (Math.floor(loc.pitch / 12) - 1);
    status.dataset.hover = `${sp} (${NAMES[loc.pitch % 12]}${Math.floor(loc.pitch / 12) - 1}) · compasso ${loc.measure + 1}, tempo ${(loc.beat % beatsPerMeasure(store.score)) + 1}`;
    status.setAttribute("data-hover", status.dataset.hover);
    if (!drag) return;
    const dx = ev.clientX - drag.startX, dy = ev.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < 3) return;
    if (!snapshotTaken) {
      store.mutate(() => {
        if (drag!.dup) { // Alt: duplica e arrasta a cópia
          const newIds: string[] = [];
          for (const id of drag!.ids) { const f = findNote(id)!; const c = { ...f.n, id: uid() }; f.l.notes.push(c); newIds.push(c.id); drag!.orig.set(c.id, drag!.orig.get(id)!); }
          drag!.ids = newIds; store.selectedNotes = new Set(newIds);
        }
      }, "drag-start");
      snapshotTaken = true;
    }
    drag.moved = true;
    const dBeats = Math.round(dx / ppb / grid) * grid;
    for (const id of drag.ids) {
      const f = findNote(id); if (!f) continue; const o = drag.orig.get(id)!;
      if (drag.kind === "resize") { f.n.dur = Math.max(grid, o.dur + dBeats); continue; }
      f.n.start = Math.max(0, o.start + dBeats);
      if (ev.shiftKey) f.n.pitch = Math.max(21, Math.min(108, o.pitch - Math.round(dy / (LS / 2))));
      else {
        const st = spell(o.pitch, store.score.keySig).step - Math.round(dy / (LS / 2));
        f.n.pitch = Math.max(21, Math.min(108, stepToPitch(st, store.score.keySig)));
      }
    }
    store.ensureMeasures();
    render();
  });
  paper.addEventListener("pointerup", () => {
    if (drag?.moved) { const f = findNote(drag.ids[0]); if (f) audio.playNote(f.n.pitch, 0, 0.35, 80, 1, undefined, audio.timbreOf(store.score, f.l)); store.emit("edit"); }
    drag = null; snapshotTaken = false;
  });

  // Soltar figura de duração arrastada da paleta
  canvas.addEventListener("dragover", (e) => {
    if (e.dataTransfer?.types.includes("text/harmonia-dur")) { e.preventDefault(); canvas.classList.add("drop"); }
    if (e.dataTransfer?.types.includes("text/harmonia-audio")) {
      e.preventDefault(); canvas.classList.add("drop-audio");
      const loc = locate(e); status.dataset.hover = `soltar o trecho no compasso ${loc.measure + 1}, tempo ${(loc.beat % beatsPerMeasure(store.score)) + 1}`; status.setAttribute("data-hover", status.dataset.hover);
    }
  });
  canvas.addEventListener("dragleave", () => canvas.classList.remove("drop", "drop-audio"));
  canvas.addEventListener("drop", (e) => {
    canvas.classList.remove("drop", "drop-audio");
    const key = e.dataTransfer?.getData("text/harmonia-audio");
    if (key) { e.preventDefault(); const loc = locate(e); dispatchEvent(new CustomEvent("harmonia:drop-audio", { detail: { key, beat: Math.max(0, Math.floor(loc.beat)) } })); return; }
    const d = parseFloat(e.dataTransfer?.getData("text/harmonia-dur") || "");
    if (!d) return;
    e.preventDefault();
    const loc = locate(e);
    insertNote(loc.pitch, loc.beat, loc.staff, d);
  });

  canvas.addEventListener("keydown", (e) => {
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? store.redoOp() : store.undoOp(); return; }
    if (mod && e.shiftKey && (e.key.toLowerCase() === "c" || e.key.toLowerCase() === "x")) {
      e.preventDefault();
      const src = store.selectedNotes.size ? "notes" : store.selectedMeasures.size ? "measures" : null;
      if (src) extract(e.key.toLowerCase() === "x" ? "cut" : "copy", src);
      return;
    }
    if (mod && e.key.toLowerCase() === "a") { // todas as notas da(s) mão(s) em edição
      e.preventDefault();
      store.selectedNotes = new Set(store.score.layers.filter((l) => l.visible && !l.locked && l.kind !== "recording" && store.inHand(l)).flatMap((l) => l.notes.map((n) => n.id)));
      store.selectedMeasures.clear(); store.emit("selection"); return;
    }
    if (e.key === " ") { e.preventDefault(); togglePlay(); return; }
    const k = { v: "select", n: "pencil", e: "erase", c: "chord", l: "lyrics", a: "annotate" }[e.key.toLowerCase()] as Tool | undefined;
    if (k && !mod) { setTool(k); return; }
    const num = { "1": 4, "2": 2, "3": 1, "4": 0.5, "5": 0.25 }[e.key as "1"];
    if (num) { dur = num; refreshDurs(); return; }
    if ((e.key === "Delete" || e.key === "Backspace") && (store.selectedNotes.size || store.selectedMeasures.size)) {
      e.preventDefault();
      const r = store.deleteSelection();
      if (r.locked || (!r.notes && !r.chords)) report(r, "Seleção");
      return;
    }
    if (!store.selectedNotes.size) return;
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const d = (e.key === "ArrowUp" ? 1 : -1) * (e.shiftKey ? 12 : 1);
      store.mutate((s) => s.layers.forEach((l) => !l.locked && l.notes.forEach((n) => store.selectedNotes.has(n.id) && (n.pitch = Math.max(21, Math.min(108, n.pitch + d))))), "transpose");
    } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      const d = (e.key === "ArrowRight" ? 1 : -1) * grid;
      store.mutate((s) => s.layers.forEach((l) => !l.locked && l.notes.forEach((n) => store.selectedNotes.has(n.id) && (n.start = Math.max(0, n.start + d)))), "nudge");
    }
  });

  /** Duplo clique no bloco gravado: ouvir e transcrever (toda a gravação ou só o compasso), vínculo, cadeado… */
  function recMenu(id: string, loc: ReturnType<typeof locate>) {
    const l = store.score.layers.find((x) => x.id === id); if (!l) return;
    canvas.querySelector(".rec-menu")?.remove();
    const span = recordingSpan(l);
    const bpm = beatsPerMeasure(store.score);
    const inRec = (m: number) => (m + 1) * bpm > span.b0 && m * bpm < span.b1;
    const sel = [...store.selectedMeasures].filter(inRec).sort((a, b) => a - b);
    const ms = sel.length ? sel : [loc.measure];
    const msLabel = ms.length > 1 ? `compassos ${ms[0] + 1}–${ms[ms.length - 1] + 1}` : `compasso ${ms[0] + 1}`;
    const spbS = 60 / store.score.tempo;
    const close = () => { menu.remove(); removeEventListener("pointerdown", outside, true); };
    const outside = (e: Event) => { if (!menu.contains(e.target as Node)) close(); };
    const item = (icon: string, label: string, hint: string, fn: () => void, disabled = false) => h("button", { class: "rm-item", disabled, onclick: () => { close(); fn(); } },
      h("span", { class: "rm-ic" }, icon), h("span", {}, h("b", {}, label), h("small", {}, hint)));
    const mates = store.score.layers.filter((x) => x.id !== l.id && l.link && x.link === l.link);
    const listen = (fromBeat: number, toBeat: number, what: string) => audio.layerBuffer(l).then((buf) => audio.playBuffer(buf, {
      from: Math.max(0, fromBeat * spbS - (l.audioOffset || 0)), to: Math.min(buf.duration, toBeat * spbS - (l.audioOffset || 0)),
      source: { id: "rec-" + l.id, label: `${l.name} — ${what}`, icon: "🎙", focus: () => win.focus() } })).catch(() => toast("Áudio da gravação indisponível", "error"));
    const menu = h("div", { class: "rec-menu", role: "menu", "aria-label": "Opções da gravação", style: { left: Math.min(loc.px, canvas.clientWidth - 290) + "px", top: loc.sys.trebleY + 66 + "px" } },
      h("header", {}, h("b", {}, "🎙 " + l.name), h("small", {}, `${span.dur.toFixed(1)} s · compassos ${Math.floor(span.b0 / bpm) + 1}–${Math.floor((span.b1 - 1e-6) / bpm) + 1}`)),
      item("▶", "Ouvir toda a gravação", "no player universal", () => listen(span.b0, span.b1, "toda a gravação")),
      item("▶", `Ouvir só o ${msLabel}`, sel.length ? "compassos selecionados" : "compasso clicado", () => listen(Math.max(span.b0, ms[0] * bpm), Math.min(span.b1, (ms[ms.length - 1] + 1) * bpm), msLabel)),
      h("hr"),
      item("✨", "Transcrever toda a gravação", "melodia → notas vinculadas 🔗", () => transcribeRecording(l)),
      item("✨", `Transcrever só o ${msLabel}`, "notas entram exatamente nesses compassos", () => transcribeRecording(l, { measures: ms })),
      item("🎹", "Transcrever melodia + harmonia", "toda a gravação, com acordes", () => transcribeRecording(l, { mode: "both" })),
      h("hr"),
      mates.length ? item(l.unlinked ? "🔗" : "⛓", l.unlinked ? "Vincular às notas" : "Desvincular das notas", mates.map((m) => m.name).join(", "), () => store.mutate(() => [l, ...mates].forEach((x) => (x.unlinked = !l.unlinked)), "layer")) : "",
      item(l.locked ? "🔓" : "🔒", l.locked ? "Destrancar" : "Trancar", "impede mover ou apagar", () => store.mutate(() => (l.locked = !l.locked), "layer")),
      item(l.muted ? "🔈" : "🔇", l.muted ? "Ativar som" : "Silenciar", "na reprodução e na mesa", () => { store.mutate(() => (l.muted = !l.muted), "layer"); audio.liveMix(store.score); }),
      item("🎹", "Ver no teclado", "visualizador sob a pauta", () => (dispatchEvent(new CustomEvent("open-app", { detail: "compose" })), setTimeout(() => dispatchEvent(new CustomEvent("harmonia:action", { detail: "viz-open" })), 300))),
      item("🗑", "Apagar gravação", l.locked ? "trancada" : "as notas transcritas ficam", () => { if (confirm(`Apagar a gravação "${l.name}"?`)) store.mutate((sc) => (sc.layers = sc.layers.filter((x) => x.id !== l.id)), "layer"); }, l.locked));
    canvas.append(menu);
    setTimeout(() => addEventListener("pointerdown", outside, true), 0);
    (menu.querySelector(".rm-item") as HTMLElement)?.focus();
    menu.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });
  }

  /** Arrasta o clipe de gravação no tempo; camadas vinculadas 🔗 (não trancadas) acompanham. */
  function dragRecording(id: string, ev: PointerEvent) {
    const l = store.score.layers.find((x) => x.id === id); if (!l) return;
    if (l.locked) { toast(`Camada "${l.name}" está trancada 🔒`, "warn"); return; }
    const mates = () => store.score.layers.filter((x) => x.id !== l.id && l.link && !l.unlinked && x.link === l.link && !x.unlinked);
    const lockedMate = mates().find((x) => x.locked);
    if (lockedMate) { toast(`A camada vinculada "${lockedMate.name}" está trancada 🔒 — destranque ou desvincule ⛓ para mover`, "warn", 4500); return; }
    store.selectedLayer = id;
    const spbS = 60 / store.score.tempo, bpm = beatsPerMeasure(store.score);
    if (!l.audioDur) l.audioDur = recordingSpan(l).dur; // gravações antigas: duração pelos compassos
    const sx = ev.clientX, off0 = l.audioOffset || 0;
    const notes0 = new Map(mates().flatMap((m) => m.notes.map((n) => [n.id, n.start] as [string, number])));
    let applied = 0, first = true;
    paper.setPointerCapture(ev.pointerId);
    const mv = (e: PointerEvent) => {
      let d = Math.round((e.clientX - sx) / ppb / grid) * grid;
      d = Math.max(-off0 / spbS, d); // não passa do início
      if (d === applied) return;
      if (first) { store.mutate(() => {}, "rec-drag"); first = false; }
      applied = d;
      l.audioOffset = off0 + d * spbS;
      const b0 = l.audioOffset / spbS, b1 = b0 + (l.audioDur || 0) / spbS;
      l.measures = Array.from({ length: Math.max(1, Math.floor((b1 - 1e-6) / bpm) - Math.floor(b0 / bpm) + 1) }, (_, i) => Math.floor(b0 / bpm) + i);
      for (const m of mates()) for (const n of m.notes) { const s0 = notes0.get(n.id); if (s0 !== undefined) n.start = s0 + d; }
      store.ensureMeasures();
      if (store.score.measures < Math.ceil(b1 / bpm)) store.score.measures = Math.ceil(b1 / bpm);
      render();
      status.dataset.hover = `${l.name} → compasso ${Math.floor(b0 / bpm) + 1}, tempo ${((b0 % bpm) + 1).toFixed(2).replace(/\.00$/, "")}${mates().length ? " · notas vinculadas acompanham 🔗" : ""}`;
      status.setAttribute("data-hover", status.dataset.hover);
    };
    const up = () => { paper.removeEventListener("pointermove", mv); paper.removeEventListener("pointerup", up); if (!first) store.emit("edit"); };
    paper.addEventListener("pointermove", mv); paper.addEventListener("pointerup", up);
  }

  // --------------------------------------------- editores inline (popover)
  function popover(x: number, y: number, value: string, placeholder: string, onDone: (v: string, ev?: KeyboardEvent) => void) {
    canvas.querySelector(".pop")?.remove();
    const inp = h("input", { class: "pop", value, placeholder, style: { left: x + "px", top: y + "px" } });
    canvas.append(inp); inp.focus(); inp.select();
    let done = false;
    const finish = (ev?: KeyboardEvent) => { if (done) return; done = true; onDone(inp.value, ev); inp.remove(); canvas.focus(); };
    inp.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); finish(e); } if (e.key === "Escape") { done = true; inp.remove(); } });
    inp.addEventListener("blur", () => finish());
  }

  function editChords(m: number, loc: ReturnType<typeof locate>) {
    const bpm = beatsPerMeasure(store.score);
    const cur = (store.score.chords[m] || []).map((c) => c.symbol).join(" ");
    popover(loc.px - 20, loc.sys.y + 26, cur, "ex.: Am7 D7(9)", (v) => {
      const toks = v.trim().split(/\s+/).filter(Boolean);
      const cs = toks.map(parseChord);
      if (cs.some((c) => !c)) { toast("Cifra não reconhecida: " + toks.filter((_, i) => !cs[i]).join(", "), "error"); return; }
      const step = bpm / Math.max(1, cs.length);
      store.mutate((s) => (s.chords[m] = (cs as ChordEv[]).map((c, k) => ({ ...c, beat: k * step, dur: step }))), "chords");
    });
  }

  function editLyric(id: string, loc: ReturnType<typeof locate>) {
    const f = findNote(id)!;
    popover(loc.px - 16, loc.sys.trebleY + 58, f.n.lyric || "", "sí-la-ba", (v, ev) => {
      store.mutate(() => (f.n.lyric = v.trim() || null), "lyric");
      if (ev?.key === "Tab") { // avança para a próxima nota da camada
        const ns = [...f.l.notes].sort((a, b) => a.start - b.start);
        const nx = ns[ns.findIndex((x) => x.id === id) + 1];
        if (nx) setTimeout(() => { const el = paper.querySelector(`[data-id="${nx.id}"] .head`); if (el) { const r = el.getBoundingClientRect(); editLyric(nx.id, locate({ clientX: r.left + 4, clientY: r.top })); } }, 30);
      }
    });
  }

  function addAnnotation(loc: ReturnType<typeof locate>) {
    const bpm = beatsPerMeasure(store.score);
    popover(loc.px, loc.sys.y + 52, "", "anotação (ex.: respirar aqui)", (v) => {
      if (!v.trim()) return;
      store.mutate((s) => s.annotations.push({ id: uid(), measure: loc.measure, beat: loc.beat - loc.measure * bpm, text: v.trim(), color: "#ffd36e", layerId: store.selectedLayer || undefined }), "annotate");
    });
  }
  function editAnnotation(id: string, loc: ReturnType<typeof locate>) {
    const a = store.score.annotations.find((x) => x.id === id)!;
    popover(loc.px, loc.sys.y + 52, a.text, "vazio = remover", (v) => store.mutate((s) => {
      if (!v.trim()) s.annotations = s.annotations.filter((x) => x.id !== id); else a.text = v.trim();
    }, "annotate"));
  }
  function dragAnnotation(id: string, ev: PointerEvent) {
    const bpm = beatsPerMeasure(store.score);
    let first = true;
    const mv = (e: PointerEvent) => {
      const loc = locate(e);
      const a = store.score.annotations.find((x) => x.id === id); if (!a) return;
      if (first) { store.mutate(() => {}, "ann-drag"); first = false; }
      a.measure = loc.measure; a.beat = loc.beat - loc.measure * bpm; render();
    };
    const up = () => { removeEventListener("pointermove", mv); removeEventListener("pointerup", up); store.emit("edit"); };
    addEventListener("pointermove", mv); addEventListener("pointerup", up);
    void ev;
  }

  // ------------------------------------------------------------ ações
  function togglePlay() {
    if (audio.isPlaying() && audio.playerState().source?.id === "compose") { audio.stop(); playhead = -1; drawPlayhead(); return; }
    const s = store.score; const bpm = beatsPerMeasure(s);
    const sel = [...store.selectedMeasures].sort((a, b) => a - b);
    audio.play(s, {
      fromBeat: sel.length ? sel[0] * bpm : 0, toBeat: sel.length ? (sel[sel.length - 1] + 1) * bpm : undefined,
      metronome, loop,
      onBeat: (b) => { playhead = b; drawPlayhead(); },
      onEnd: () => { playhead = -1; drawPlayhead(); },
    }, srcCompose());
  }
  const srcCompose = () => ({ id: "compose", label: `Composição — ${store.score.title}`, icon: "🎼", focus: () => win.focus() });

  function melodyLayer() {
    return store.layer() && ["melody", "voice", "omr"].includes(store.layer()!.kind) ? store.layer()! : store.score.layers.find((l) => l.kind === "melody" || l.kind === "voice");
  }

  /** Harmonização local (gulosa, por compasso) – usada offline / sem login. */
  function localHarmonize(measures: number[]) {
    const s = store.score; const bpm = beatsPerMeasure(s);
    const mel = melodyLayer()?.notes || [];
    const tonicMaj = ((s.keySig * 7) % 12 + 12) % 12;
    const degs: [number, string][] = [[0, ""], [5, ""], [7, "7"], [9, "m"], [2, "m"], [4, "m"]];
    const out: Record<number, ChordEv[]> = {};
    let prevRoot = -1;
    for (const m of measures) {
      const ns = mel.filter((n) => n.start < (m + 1) * bpm && n.start + n.dur > m * bpm);
      let best: ChordEv | null = null, bs = -1e9;
      for (const [off, q] of degs) {
        const c: ChordEv = { root: (tonicMaj + off) % 12, quality: q, beat: 0, dur: bpm, symbol: "" };
        const pcs = chordPcs(c);
        let sc = ns.reduce((a, n) => a + (pcs.has(n.pitch % 12) ? n.dur * (n.start % bpm === 0 ? 1.6 : 1) : -0.3 * n.dur), 0);
        if (c.root === prevRoot) sc -= 0.4;
        if (m === s.measures - 1 && off === 0) sc += 1.5;
        if (sc > bs) { bs = sc; best = c; }
      }
      best!.symbol = symbolOf(best!.root, best!.quality, s.keySig < 0);
      out[m] = [best!]; prevRoot = best!.root;
    }
    return out;
  }

  async function harmonize(btn: HTMLButtonElement, all: boolean) {
    const s = store.score;
    const measures = all ? [...Array(s.measures).keys()] : [...store.selectedMeasures].sort((a, b) => a - b);
    if (!measures.length) { toast("Selecione compassos clicando na faixa numerada (Shift = intervalo)", "warn"); return; }
    const mel = melodyLayer();
    if (!mel?.notes.length) { toast("Escreva ou importe uma melodia primeiro", "warn"); return; }
    busy(btn, true, "Harmonizando…");
    let chords: Record<number, ChordEv[]>;
    try {
      if (currentUser) {
        const r = await runJob("harmonize", { score: s, measures, style: harmStyle, melodyLayer: mel.id });
        chords = Object.fromEntries(measures.map((m) => [m, r.chords[m]]));
      } else chords = localHarmonize(measures);
    } catch (e: any) {
      toast("Servidor indisponível — usando harmonização local. " + e.message, "warn");
      chords = localHarmonize(measures);
    } finally { busy(btn, false); }
    const bpm = beatsPerMeasure(s);
    store.mutate((sc) => {
      for (const m of measures) sc.chords[m] = chords[m] || [];
      let lh = sc.layers.find((l) => l.kind === "harmony" && l.name.startsWith("Harmonização"));
      if (!lh) { lh = newLayer("harmony", "Harmonização", "bass"); sc.layers.push(lh); }
      lh.notes = lh.notes.filter((n) => !measures.includes(Math.floor(n.start / bpm)));
      const cells = sc.chords.map((c, m) => (measures.includes(m) ? c : []));
      lh.notes.push(...voiceChords(cells, bpm, harmStyle));
    }, "harmonize");
    toast(`Harmonia gerada em ${measures.length} compasso(s). Dica: arraste notas para ajustar as vozes.`, "ok");
  }

  function extractMel() {
    const src = store.score.layers.filter((l) => (l.kind === "harmony" || l.kind === "omr") && l.visible);
    if (!src.length) { toast("Nenhuma camada de harmonia visível", "warn"); return; }
    const mel = extractMelody(src.flatMap((l) => l.notes));
    if (!mel.length) { toast("Nenhuma nota acima de G3 para formar melodia", "warn"); return; }
    store.mutate((s) => { const l = newLayer("melody", "Melodia (da harmonia)"); l.notes = mel; s.layers.push(l); store.selectedLayer = l.id; }, "extract");
    toast(`Melodia extraída: ${mel.length} notas`, "ok");
  }

  async function transcribeChords() {
    if (!currentUser) { toast("Entre na conta para reconhecer acordes com IA", "warn"); return; }
    try {
      const r = await runJob("transcribe_chords", { score: store.score });
      store.mutate((s) => r.chords.forEach((c: ChordEv[], m: number) => { if (c.length && (!store.selectedMeasures.size || store.selectedMeasures.has(m))) s.chords[m] = c; }), "chords");
      toast("Cifra escrita a partir das notas", "ok");
    } catch (e: any) { toast(e.message, "error"); }
  }

  async function recordSection(btn: HTMLButtonElement) {
    const s = store.score; const bpm = beatsPerMeasure(s); const spb = 60 / s.tempo;
    let sel = [...store.selectedMeasures].sort((a, b) => a - b);
    if (!sel.length) { // trechos faltantes: compassos sem nenhuma nota
      sel = [...Array(s.measures).keys()].filter((m) => !s.layers.some((l) => l.notes.some((n) => Math.floor(n.start / bpm) === m)));
      if (!sel.length) { toast("Selecione os compassos a gravar", "warn"); return; }
      const gap = sel.findIndex((m, i) => i > 0 && m !== sel[i - 1] + 1);
      if (gap > 0) sel = sel.slice(0, gap); // primeiro trecho contínuo faltante
    }
    const from = sel[0], to = sel[sel.length - 1] + 1;
    try {
      busy(btn, true, "");
      const rec = await audio.record({ countInBeats: bpm, spb, onCount: (n) => (btn.innerHTML = `<b>${n}</b>`) });
      btn.innerHTML = `<span class="tb-ic">■</span><span class="tb-lb">Gravando…</span>`; btn.disabled = false;
      audio.play(s, { fromBeat: from * bpm, toBeat: to * bpm, metronome: true, onBeat: (b) => { playhead = b; drawPlayhead(); } }, { id: "compose", label: "Composição — gravando trecho", icon: "🎙", focus: () => win.focus() });
      await new Promise((r) => setTimeout(r, (to - from) * bpm * spb * 1000));
      const blob = await rec.stop();
      audio.stop(); playhead = -1; drawPlayhead();
      busy(btn, false);
      const url = URL.createObjectURL(blob);
      const layer = { ...newLayer("recording", `Gravação c.${from + 1}–${to}`), audioUrl: url, audioOffset: from * bpm * spb, audioDur: (to - from) * bpm * spb, measures: sel };
      store.mutate((sc) => sc.layers.push(layer), "record");
      toast("Gravação adicionada como camada. Use 'Transcrever' no gestor de camadas para virar notas.", "ok", 5200);
      if (currentUser) {
        const up = await upload("recording", blob, "trecho.webm");
        store.mutate(() => { const l = store.score.layers.find((x) => x.id === layer.id); if (l) l.audio = up.path; }, "upload");
      }
    } catch (e: any) { busy(btn, false); toast("Microfone indisponível: " + e.message, "error"); }
  }

  /** Gravação livre: toca a partitura como acompanhamento e grava até o usuário parar (nova voz). */
  let freeRec: null | { stop: () => Promise<void> } = null;
  async function recordFree(btn: HTMLButtonElement) {
    if (freeRec) { await freeRec.stop(); return; }
    const s = store.score; const bpm = beatsPerMeasure(s); const spb = 60 / s.tempo;
    const sel = [...store.selectedMeasures].sort((a, b) => a - b);
    const from = sel[0] ?? 0;
    const label = btn.innerHTML;
    try {
      busy(btn, true, "");
      const rec = await audio.record({ countInBeats: bpm, spb, onCount: (n) => (btn.innerHTML = `<b>${n}</b>`) });
      btn.disabled = false; btn.classList.add("recording"); btn.innerHTML = `<span class="tb-ic">■</span><span class="tb-lb">Parar gravação</span>`;
      const t0 = performance.now();
      audio.play(s, { fromBeat: from * bpm, metronome: true, onBeat: (b) => { playhead = b; drawPlayhead(); } }, { id: "compose", label: "Composição — gravando nova voz", icon: "🎙", focus: () => win.focus() });
      freeRec = {
        stop: async () => {
          freeRec = null;
          const secs = (performance.now() - t0) / 1000;
          const blob = await rec.stop();
          audio.stop(); playhead = -1; drawPlayhead();
          btn.classList.remove("recording"); btn.innerHTML = label;
          const nMeas = Math.max(1, Math.ceil(secs / spb / bpm));
          const measures = Array.from({ length: nMeas }, (_, i) => from + i);
          const layer = { ...newLayer("recording", `Voz gravada c.${from + 1}–${from + nMeas}`), audioUrl: URL.createObjectURL(blob), audioOffset: from * bpm * spb, audioDur: secs, measures };
          store.mutate((sc) => { sc.layers.push(layer); sc.measures = Math.max(sc.measures, from + nMeas); store.selectedLayer = layer.id; }, "record");
          toast(`Nova voz gravada (${nMeas} compasso${nMeas > 1 ? "s" : ""}) numa camada própria`, "ok", 5000);
          try {
            toast("Transcrevendo a voz gravada em notas…", "info");
            const vb = await audio.decode(blob);
            const r = await transcribeBuffer(vb, { name: "voz gravada", label: `Voz gravada — c.${from + 1}–${from + nMeas}`, kind: "recording", mode: prefs.captureMode === "both" ? "both" : "melody",
              tempo: s.tempo, fixedTempo: true, timeSig: s.timeSig, open: () => win.focus(),
              onUploaded: (path) => store.mutate(() => { const l = store.score.layers.find((x) => x.id === layer.id); if (l) l.audio = path; }, "upload") });
            const off = from * bpm;
            store.mutate((sc) => {
              for (const nl of r.layers || []) {
                const v = newLayer(nl.staff === "bass" ? "harmony" : "voice", `${nl.staff === "bass" ? "Harmonia" : "Voz"} (notas) c.${from + 1}–${from + nMeas}`, nl.staff === "bass" ? "bass" : "treble");
                v.notes = (nl.notes || []).map((n: Note) => ({ ...n, id: uid(), start: n.start + off }));
                v.group = layer.group; v.link = layer.link = layer.link || uid();
                if (v.notes.length) sc.layers.push(v);
              }
            }, "merge");
            toast("Voz transcrita como camada de notas — confira e ajuste no editor", "ok", 5000);
          } catch (e: any) { toast("Gravação salva; transcrição indisponível: " + e.message, "warn", 6000); }
        },
      };
    } catch (e: any) { busy(btn, false); freeRec = null; toast("Microfone indisponível: " + e.message, "error"); }
  }

  // Ações disparadas pelos painéis laterais (Propriedades)
  const onAction = (e: Event) => {
    const a = (e as CustomEvent).detail;
    if (a === "harmonize") harmonize(harmBtn as HTMLButtonElement, false);
    if (a === "play-selection") { if (audio.isPlaying()) togglePlay(); togglePlay(); }
    if (a === "record-free") recordFree(recMain);
    if (a === "record-section") recordSection(recSecBtn);
    if (a === "hand-both") { store.hand = "both"; syncStaffCtl(); render(); }
    if (a === "tool-pencil") setTool("pencil");
    if (a === "viz-open") toggleViz(true, "show");
    if (a === "viz-create") toggleViz(true, "create");
    if (a === "viz-live") { toggleViz(true, "create"); if (jamActive()) stopJam(); else requestJam("mic", { focus: () => win.focus() }, liveIn); }
    if (typeof a === "string" && a.startsWith("group:")) { const id = a.slice(6); if (openGroup !== id) toggleGroup(id); }
    if (a === "group-close") toggleGroup("");
  };
  addEventListener("harmonia:action", onAction);
  const off = store.on((reason) => {
    if (reason === "autosave") return;
    if (["load", "merge", "staves", "undo", "redo"].includes(reason)) syncStaffCtl();
    if (["load", "merge", "staves", "undo", "redo", "key", "ts", "tempo"].includes(reason)) drawSummary();
    if (reason === "load" || reason === "merge" || reason === "tempo" || reason === "key" || reason === "ts") {
      titleIn.value = store.score.title; tempoIn.value = String(store.score.tempo);
      keySel.value = String(store.score.keySig); tsSel.value = store.score.timeSig.join("/");
    }
    render();
  });
  const offPlay = audio.onPlayer((st) => { const on = st.playing && st.source?.id === "compose"; playBtn.textContent = playIn.textContent = (on ? "■ " + t("stop") : "▶ " + t("play")); });
  const ro = new ResizeObserver(() => render());
  ro.observe(canvas);
  setTool("select");
  render();
  win.setTitle(`${t("compose")} — ${store.score.title}`);
  return () => { off(); ro.disconnect(); audio.stop(); removeEventListener("harmonia:action", onAction); offPlay(); offJamE(); offLive(); offTun(); offBeat(); offJamBar(); viz?.destroy(); };
}
