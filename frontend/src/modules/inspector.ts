// Painéis de interação com a partitura: Propriedades (partitura, notas e compassos selecionados) e Anotações.
import { store } from "../core/store";
import { h, toast } from "../core/ui";
import { KEY_NAMES, NAMES, SOLFEGE, parseChord } from "../core/theory";
import { beatsPerMeasure, ChordEv, uid } from "../core/types";
import * as audio from "../core/audio";
import { mountConsole } from "./console";

const DURS: [number, string][] = [[4, "𝅝 Semibreve"], [3, "𝅗𝅥. Mínima pont."], [2, "𝅗𝅥 Mínima"], [1.5, "♩. Semínima pont."], [1, "♩ Semínima"], [0.75, "♪. Colcheia pont."], [0.5, "♪ Colcheia"], [0.25, "𝅘𝅥𝅯 Semicolcheia"]];
const EFFECTS: [string, string][] = [["", "—"], ["vibrato", "∿ Vibrato"], ["glissando", "↗ Glissando"], ["staccato", "· Staccato"], ["fermata", "𝄐 Fermata"], ["falsetto", "° Falsete"]];
const noteName = (p: number) => `${SOLFEGE[p % 12]}${Math.floor(p / 12) - 1} (${NAMES[p % 12]}${Math.floor(p / 12) - 1})`;

function field(label: string, ...ctl: (Node | string)[]) { return h("label", { class: "prop" }, h("span", {}, label), h("div", { class: "prop-ctl" }, ...ctl)); }
function section(title: string, ...kids: (Node | string | null | false)[]) { return h("div", { class: "prop-sec" }, h("h5", {}, title), ...kids); }

function extract(mode: "copy" | "cut", src: "notes" | "measures") {
  const r = store.extractToNewLayer(mode, src);
  if (!r.created) { toast(r.skippedLocked ? "As notas estão em camadas bloqueadas" : "Nenhuma nota na seleção", "warn"); return; }
  toast(`${mode === "cut" ? "Recortadas" : "Copiadas"} ${r.moved} nota(s) para ${r.created} nova(s) camada(s)`, "ok");
}

// ---------------------------------------------------------------- Propriedades
export function mountProperties(body: HTMLElement) {
  body.classList.add("props");
  const scoreBox = h("div"); const selBox = h("div");
  const consoleBox = h("div");
  body.append(h("div", { class: "prop-sec" }, h("h5", {}, "🎚 Mesa de som"), consoleBox), scoreBox, selBox);
  mountConsole(consoleBox);
  let lastKey = "";

  function renderScore() {
    const s = store.score;
    scoreBox.replaceChildren(section("Partitura",
      field("Título", h("input", { value: s.title, onchange: (e: Event) => store.mutate((x) => (x.title = (e.target as HTMLInputElement).value), "title") })),
      h("div", { class: "prop-grid" },
        field("Andamento ♩", h("input", { type: "number", min: 30, max: 260, value: s.tempo, onchange: (e: Event) => store.mutate((x) => (x.tempo = +(e.target as HTMLInputElement).value || 96), "tempo") })),
        field("Compasso", h("select", { onchange: (e: Event) => store.mutate((x) => (x.timeSig = (e.target as HTMLSelectElement).value.split("/").map(Number) as [number, number]), "ts") },
          ...["2/4", "3/4", "4/4", "6/8", "5/4", "7/8"].map((v) => h("option", { value: v, selected: v === s.timeSig.join("/") }, v)))),
        field("Tonalidade", h("select", { onchange: (e: Event) => store.mutate((x) => (x.keySig = +(e.target as HTMLSelectElement).value), "key") },
          ...Object.entries(KEY_NAMES).sort((a, b) => +a[0] - +b[0]).map(([f, n]) => h("option", { value: f, selected: +f === s.keySig }, `${n} / ${NAMES[(((+f * 7 + 9) % 12) + 12) % 12]}m`)))),
        field("Compassos", h("span", { class: "chip" }, String(s.measures)),
          h("button", { class: "p-btn", title: "Adicionar no final", onclick: () => store.insertMeasure(store.score.measures) }, "+")))));
  }

  function renderSelection() {
    const s = store.score;
    const bpm = beatsPerMeasure(s);
    const notes = s.layers.flatMap((l) => l.notes.filter((n) => store.selectedNotes.has(n.id)).map((n) => ({ n, l })));
    const ms = [...store.selectedMeasures].sort((a, b) => a - b);
    const kids: (Node | null)[] = [];

    if (notes.length) {
      const one = notes.length === 1 ? notes[0] : null;
      const edit = (fn: (n: (typeof notes)[0]["n"]) => void, reason = "props") => store.mutate(() => notes.forEach(({ n, l }) => !l.locked && fn(n)), reason);
      const durSel = h("select", { onchange: (e: Event) => edit((n) => (n.dur = +(e.target as HTMLSelectElement).value)) },
        ...(one && !DURS.some(([d]) => d === one.n.dur) ? [h("option", { value: one.n.dur, selected: true }, `${one.n.dur} tempos`)] : []),
        ...DURS.map(([d, l]) => h("option", { value: d, selected: one?.n.dur === d }, l)));
      const vel = h("input", { type: "range", min: 1, max: 127, value: one?.n.vel ?? 84, onchange: (e: Event) => edit((n) => (n.vel = +(e.target as HTMLInputElement).value)) });
      const layerSel = h("select", { onchange: (e: Event) => {
        const to = s.layers.find((l) => l.id === (e.target as HTMLSelectElement).value);
        if (!to || to.locked) return;
        store.mutate(() => notes.forEach(({ n, l }) => { if (l === to || l.locked) return; l.notes = l.notes.filter((x) => x.id !== n.id); to.notes.push(n); }), "move-layer");
      } }, ...s.layers.filter((l) => l.kind !== "recording").map((l) => h("option", { value: l.id, selected: one?.l.id === l.id }, l.name)));
      kids.push(section(one ? "Nota selecionada" : `${notes.length} notas selecionadas`,
        h("div", { class: "row" }, ...[...new Set(notes.map(({ l }) => l))].map((l) => h("span", { class: "layer-tag", style: { "--lc": l.color } as any }, l.name))),
        one ? h("div", { class: "note-id" }, h("b", {}, noteName(one.n.pitch)),
          h("small", {}, `compasso ${Math.floor(one.n.start / bpm) + 1}, tempo ${+((one.n.start % bpm) + 1).toFixed(2)}`)) : null,
        h("div", { class: "row" },
          h("button", { class: "btn ghost", title: "Oitava abaixo", onclick: () => edit((n) => (n.pitch = Math.max(21, n.pitch - 12))) }, "−8ª"),
          h("button", { class: "btn ghost", title: "Semitom abaixo", onclick: () => edit((n) => (n.pitch = Math.max(21, n.pitch - 1))) }, "♭ −1"),
          h("button", { class: "btn ghost", title: "Semitom acima", onclick: () => edit((n) => (n.pitch = Math.min(108, n.pitch + 1))) }, "♯ +1"),
          h("button", { class: "btn ghost", title: "Oitava acima", onclick: () => edit((n) => (n.pitch = Math.min(108, n.pitch + 12))) }, "+8ª"),
          h("button", { class: "btn ghost", title: "Ouvir", onclick: () => notes.forEach(({ n }) => audio.playNote(n.pitch, 0, 0.6, n.vel)) }, "▶")),
        field("Duração", durSel),
        field("Intensidade", vel),
        one ? field("Sílaba", h("input", { value: one.n.lyric || "", placeholder: "ex.: a-mor, _ = melisma", onchange: (e: Event) => edit((n) => (n.lyric = (e.target as HTMLInputElement).value.trim() || null)) })) : null,
        field("Efeito", h("select", { onchange: (e: Event) => edit((n) => (n.effect = (e.target as HTMLSelectElement).value || null)) },
          ...EFFECTS.map(([v, l]) => h("option", { value: v, selected: (one?.n.effect || "") === v }, l)))),
        field("Camada", layerSel),
        h("button", { class: "btn danger", onclick: () => { store.mutate((x) => x.layers.forEach((l) => !l.locked && (l.notes = l.notes.filter((n) => !store.selectedNotes.has(n.id)))), "delete"); store.selectedNotes.clear(); store.emit("selection"); } }, "Apagar nota(s)")));
    }

    if (ms.length) {
      const range = ms.length > 1 ? `${ms[0] + 1}–${ms[ms.length - 1] + 1}` : String(ms[0] + 1);
      const chordIn = h("input", { value: (s.chords[ms[0]] || []).map((c) => c.symbol).join(" "), placeholder: "ex.: Am7 D7(9)" }) as HTMLInputElement;
      chordIn.addEventListener("change", () => {
        const toks = chordIn.value.trim().split(/\s+/).filter(Boolean);
        const cs = toks.map(parseChord);
        if (cs.some((c) => !c)) { toast("Cifra não reconhecida", "error"); return; }
        const step = bpm / Math.max(1, cs.length);
        store.mutate((x) => ms.forEach((m) => (x.chords[m] = (cs as ChordEv[]).map((c, k) => ({ ...c, beat: k * step, dur: step })))), "chords");
      });
      const count = s.layers.reduce((a, l) => a + l.notes.filter((n) => ms.includes(Math.floor(n.start / bpm))).length, 0);
      kids.push(section(`Compasso${ms.length > 1 ? "s" : ""} ${range}`,
        h("small", { class: "hint" }, `${count} nota(s) · ${ms.length} compasso(s)`),
        field("Cifra", chordIn),
        h("div", { class: "row" },
          h("button", { class: "btn accent", onclick: () => dispatchEvent(new CustomEvent("harmonia:action", { detail: "harmonize" })) }, "✨ Harmonizar"),
          h("button", { class: "btn", onclick: () => dispatchEvent(new CustomEvent("harmonia:action", { detail: "play-selection" })) }, "▶ Ouvir trecho")),
        h("div", { class: "row" },
          h("button", { class: "btn ghost", onclick: () => store.insertMeasure(ms[0]) }, "+ antes"),
          h("button", { class: "btn ghost", onclick: () => store.insertMeasure(ms[ms.length - 1] + 1) }, "+ depois"),
          h("button", { class: "btn ghost", onclick: () => store.mutate((x) => x.layers.forEach((l) => !l.locked && (l.notes = l.notes.filter((n) => !ms.includes(Math.floor(n.start / bpm))))), "clear") }, "Limpar"),
          h("button", { class: "btn ghost danger", onclick: () => {
            if (count && !confirm(`Excluir ${ms.length} compasso(s) com ${count} nota(s)? (⌘Z desfaz)`)) return;
            if (!store.deleteMeasures(ms)) toast("A partitura precisa de ao menos 1 compasso", "warn");
          } }, "Excluir"))));
    }

    if (!kids.length) kids.push(section("Seleção", h("p", { class: "hint" },
      "Clique numa nota para editar altura, duração, intensidade, sílaba e efeito. Clique na faixa numerada para selecionar compassos (Shift = intervalo) e editar cifra, harmonizar, inserir ou excluir.")));
    selBox.replaceChildren(...(kids.filter(Boolean) as Node[]));
  }

  const off = store.on((r) => {
    if (r === "autosave") return;
    const key = [store.score.title, store.score.tempo, store.score.timeSig, store.score.keySig, store.score.measures].join("|");
    if (key !== lastKey || r === "load") { lastKey = key; }
    if (!body.contains(document.activeElement) || r === "selection") renderSelection();
  });
  renderSelection(); void renderScore; void extract;
  return () => off();
}

// ------------------------------------------------------------------ Anotações
export function mountAnnotations(body: HTMLElement) {
  body.classList.add("ann-panel");
  const list = h("div", { class: "ann-list" });
  const inp = h("input", { placeholder: "Nova anotação no compasso selecionado…" }) as HTMLInputElement;
  const color = h("input", { type: "color", value: "#ffd36e" }) as HTMLInputElement;
  const add = () => {
    if (!inp.value.trim()) return;
    const m = [...store.selectedMeasures][0] ?? 0;
    store.mutate((s) => s.annotations.push({ id: uid(), measure: m, beat: 0, text: inp.value.trim(), color: color.value, layerId: store.selectedLayer || undefined }), "annotate");
    inp.value = "";
  };
  inp.addEventListener("keydown", (e) => e.key === "Enter" && add());
  body.append(h("div", { class: "row" }, inp, color, h("button", { class: "btn primary", onclick: add }, "+")), list);
  const render = () => {
    const anns = [...store.score.annotations].sort((a, b) => a.measure - b.measure || a.beat - b.beat);
    list.replaceChildren(...(anns.length ? anns.map((a) => h("div", { class: "ann-item", style: { "--ac": a.color } as any },
      h("button", { class: "chip", title: "Selecionar compasso", onclick: () => { store.selectedMeasures = new Set([a.measure]); store.emit("selection"); } }, `c.${a.measure + 1}`),
      (() => { const l = store.score.layers.find((x) => x.id === a.layerId); return l ? h("span", { class: "layer-tag", style: { "--lc": l.color } as any, title: "Camada " + l.name }, "") : ""; })(),
      h("input", { value: a.text, onchange: (e: Event) => store.mutate(() => (a.text = (e.target as HTMLInputElement).value), "annotate") }),
      h("button", { class: "p-btn", title: "Remover", onclick: () => store.mutate((s) => (s.annotations = s.annotations.filter((x) => x.id !== a.id)), "annotate") }, "✕")))
      : [h("p", { class: "hint" }, "Sem anotações. Selecione um compasso e escreva acima, ou use a ferramenta ✦ no editor.")]));
  };
  const off = store.on((r) => { if (r !== "autosave" && !body.contains(document.activeElement)) render(); });
  render();
  return () => off();
}
