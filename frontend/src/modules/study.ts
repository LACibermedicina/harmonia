// Painel "Estudo": multi-instrumentos, instrumento em foco (arpejos, solo, ornamentos) e análise do tema.
// Cada seção explica como funciona; tudo gera camadas NOVAS no grupo 🎓 Estudo (Ctrl+Z desfaz).
import { h, toast } from "../core/ui";
import { store } from "../core/store";
import { INSTRUMENTS, instrument } from "../core/instruments";
import { staves } from "../core/types";
import { analyze, explain, figureName } from "../core/analysis";
import { addInstrument, arpeggios, soloProposal, ornament, applySuggestedChords, ARP_LABEL, ORN_LABEL, ArpPattern, Orn, Role } from "../core/study";
import * as audio from "../core/audio";

const FOCUS_KEY = "harmonia.study.focus";
export const ANALYSIS_KEY = "harmonia.analysis";
export const analysisOn = () => { try { return localStorage.getItem(ANALYSIS_KEY) === "1"; } catch { return false; } };

const instSelect = (value: string, onchange: (v: string) => void, withStaff = false) => {
  const sel = h("select", { onchange: () => onchange(sel.value) },
    ...(withStaff ? [h("option", { value: "" }, "— da pauta —")] : []),
    ...INSTRUMENTS.map((i) => h("option", { value: i.id, selected: i.id === value }, `${i.icon} ${i.name}`))) as HTMLSelectElement;
  sel.value = value; return sel;
};
const how = (txt: string) => h("details", { class: "st-how" }, h("summary", {}, "Como funciona"), h("p", {}, txt));

export function mountStudy(body: HTMLElement) {
  body.classList.add("study");
  let focus = (() => { try { return localStorage.getItem(FOCUS_KEY) || "guitar"; } catch { return "guitar"; } })();
  const sec = (id: string, icon: string, title: string, ...kids: (HTMLElement | string)[]) =>
    h("section", { class: "st-sec", "data-sec": id }, h("h4", {}, h("span", { "aria-hidden": "true" }, icon), " ", title), ...kids);

  // ---------------------------------------------------------------- multi-instrumentos
  const list = h("div", { class: "st-list" });
  const drawList = () => {
    const s = store.score, st = staves(s);
    const rows = s.layers.filter((l) => l.kind !== "recording").map((l) => {
      const inst = instrument(l.instrument || (l.staff === "bass" ? st.lower.instrument : st.upper.instrument));
      const vol = h("input", { type: "range", min: "0", max: "1", step: "0.01", value: String(l.volume), "aria-label": `Volume de ${l.name}`,
        oninput: () => { l.volume = +vol.value; audio.liveMix(store.score); }, onchange: () => store.mutate(() => {}, "layer") }) as HTMLInputElement;
      const on = h("input", { type: "checkbox", class: "st-toggle", checked: !l.muted && l.visible, "aria-label": `Ligar ${l.name}`,
        onchange: () => store.mutate(() => { l.muted = !on.checked; }, "layer") }) as HTMLInputElement;
      const sel = instSelect(l.instrument || "", (v) => store.mutate(() => { l.instrument = v || undefined; if (v) l.program = instrument(v).program; }, "layer"), true);
      return h("div", { class: "st-row" + (l.id === store.selectedLayer ? " on" : ""), style: { "--lc": l.color } as any },
        h("span", { class: "st-ic", title: inst.name }, inst.icon), h("b", { title: l.name, onclick: () => { store.selectedLayer = l.id; store.emit("selection"); } }, l.name), vol, on, sel);
    });
    list.replaceChildren(...(rows.length ? rows : [h("p", { class: "hint" }, "Sem camadas de notas ainda.")]));
  };
  const addInst = instSelect("violin", () => {});
  const addRole = h("select", {}, ...(["melodia", "contracanto", "baixo", "acordes", "arpejo"] as Role[]).map((r) => h("option", { value: r }, r))) as HTMLSelectElement;
  const addB = h("button", { class: "btn primary", onclick: () => { const l = addInstrument(addInst.value, addRole.value as Role); if (l) toast(`Nova camada: ${l.name} (${l.notes.length} notas)`, "ok"); } }, "+ Adicionar");

  // ---------------------------------------------------------------- instrumento em foco
  const focusSel = instSelect(focus, (v) => { focus = v; try { localStorage.setItem(FOCUS_KEY, v); } catch { /* */ } });
  const pat = h("select", {}, ...(Object.keys(ARP_LABEL) as ArpPattern[]).map((k) => h("option", { value: k }, ARP_LABEL[k]))) as HTMLSelectElement;
  const sub = h("select", {}, h("option", { value: "1" }, "semínimas"), h("option", { value: "0.5", selected: true }, "colcheias"), h("option", { value: "0.333333" }, "tercinas"), h("option", { value: "0.25" }, "semicolcheias")) as HTMLSelectElement;
  sub.value = "0.5";
  const oct = h("select", {}, h("option", { value: "1" }, "1 oitava"), h("option", { value: "2" }, "2 oitavas")) as HTMLSelectElement;
  const arpB = h("button", { class: "btn", onclick: () => { const l = arpeggios(focus, { pattern: pat.value as ArpPattern, sub: +sub.value, octaves: +oct.value as 1 | 2 }); toast(`Estudo de arpejos criado: ${l.notes.length} notas — toque ▶ ou use Solo (S) na camada`, "ok", 5000); } }, "🎼 Gerar estudo de arpejos");
  const dens = h("select", {}, h("option", { value: "calmo" }, "calmo (semínimas)"), h("option", { value: "médio", selected: true }, "médio (colcheias)"), h("option", { value: "virtuoso" }, "virtuoso (semicolcheias)")) as HTMLSelectElement;
  dens.value = "médio";
  const useMot = h("input", { type: "checkbox", checked: true }) as HTMLInputElement;
  let lastSolo: string | null = null;
  const soloB = h("button", { class: "btn", onclick: () => { const l = soloProposal(focus, { density: dens.value as any, useMotive: useMot.checked }); lastSolo = l.id; toast(`Proposta de solo: ${l.notes.length} notas na camada “${l.name}”`, "ok", 5000); } }, "✨ Gerar proposta de solo");
  const againB = h("button", { class: "btn ghost", title: "Troca a última proposta por outra", onclick: () => {
    if (lastSolo) store.mutate((s) => { s.layers = s.layers.filter((x) => x.id !== lastSolo); }, "study");
    soloB.click(); } }, "↻ Outra");
  const ornKinds = (Object.keys(ORN_LABEL) as Orn[]).map((k) => h("label", { class: "st-chk" }, h("input", { type: "checkbox", value: k, checked: k === "mordente" || k === "apojatura" }), " " + ORN_LABEL[k]));
  const amt = h("input", { type: "range", min: "0.1", max: "1", step: "0.05", value: "0.45", "aria-label": "Quantidade de ornamentos" }) as HTMLInputElement;
  const ornB = h("button", { class: "btn", onclick: () => {
    const kinds = ornKinds.map((l) => l.querySelector("input") as HTMLInputElement).filter((x) => x.checked).map((x) => x.value as Orn);
    if (!kinds.length) { toast("Escolha pelo menos um ornamento", "warn"); return; }
    const l = ornament(focus, kinds, +amt.value); if (!l) { toast("Não há tema para ornamentar", "warn"); return; }
    toast(`Tema ornamentado: ${l.name}`, "ok", 5000); } }, "🌀 Ornamentar o tema");

  // ---------------------------------------------------------------- análise
  const anBox = h("div", { class: "st-analysis" });
  const showOn = h("input", { type: "checkbox", checked: analysisOn(), onchange: () => { try { localStorage.setItem(ANALYSIS_KEY, showOn.checked ? "1" : "0"); } catch { /* */ } store.emit("analysis"); } }) as HTMLInputElement;
  const drawAnalysis = () => {
    const a = analyze(store.score);
    showOn.checked = analysisOn();
    if (!a.theme) { anBox.replaceChildren(h("p", { class: "hint" }, "Escreva, grave ou importe uma melodia para analisar.")); return; }
    const chip = (t: string, c = "") => h("span", { class: "st-chip " + c }, t);
    anBox.replaceChildren(
      h("div", { class: "st-kv" }, h("small", {}, "Tonalidade"), h("b", {}, `${a.key.name}`), h("small", {}, `confiança ${Math.round(a.key.conf * 100)}%`)),
      h("div", { class: "st-kv" }, h("small", {}, "Motivo rítmico"), a.motive ? h("b", {}, a.motive.durations.map(figureName).join(" – ")) : h("b", {}, "—"),
        a.motive ? h("small", {}, `compassos ${a.motive.measures.map((m) => m + 1).join(", ")}`) : ""),
      h("div", { class: "st-kv" }, h("small", {}, "Módulos"), h("div", { class: "st-chips" }, ...a.modules.map((m) => chip(`${m.label} c.${m.from + 1}–${m.to + 1}`, "mod-" + m.label[0])))),
      h("div", { class: "st-kv" }, h("small", {}, a.suggested ? "Harmonização recomendada" : "Harmonia"), h("div", { class: "st-chips" }, ...a.chords.slice(0, 8).map((c) => chip((c || []).map((x) => x.symbol).join(" ") || "·", "ch")))),
      a.cadences.length ? h("div", { class: "st-kv" }, h("small", {}, "Cadências"), h("b", {}, a.cadences.map((c) => `c.${c.measure + 1} ${c.kind}`).join(" · "))) : "",
      h("div", { class: "row" },
        a.suggested ? h("button", { class: "btn", onclick: () => { const n = applySuggestedChords(); toast(n ? `${n} cifras aplicadas (Ctrl+Z desfaz)` : "Nada a aplicar", "ok"); } }, "Aplicar harmonização") : "",
        h("button", { class: "btn primary", onclick: () => explainWithMaestro() }, "🤖 Explicar com o Maestro")));
  };

  body.append(
    sec("multi", "🎻", "Camadas · Multi-instrumentos", list, h("div", { class: "st-add" }, addInst, h("span", {}, "como"), addRole, addB),
      how("Cada camada pode ter o seu próprio instrumento (timbre e extensão): o volume e a chave ligam/desligam na hora, sem parar a música. “Adicionar” cria uma camada nova para o instrumento: melodia = o tema transposto para a região confortável dele; contracanto = uma terça/sexta abaixo do tema; baixo = as fundamentais dos acordes; acordes = tríades em bloco; arpejo = os acordes quebrados.")),
    sec("focus", "🎯", "Instrumento em foco", h("div", { class: "st-focus" }, focusSel),
      h("p", { class: "hint" }, "Arpejos, solo e ornamentos são escritos para este instrumento, dentro da extensão dele.")),
    sec("arp", "🎼", "Estudo de arpejos", h("div", { class: "st-grid3" }, pat, sub, oct), arpB,
      how("Para cada acorde da harmonia (a escrita ou, se não houver cifras, a recomendada), as notas do acorde são tocadas uma a uma no padrão escolhido, começando na região confortável do instrumento. O primeiro tempo de cada grupo vem acentuado — estude devagar com o metrônomo e suba o andamento.")),
    sec("solo", "✨", "Solo e ornamentos", h("div", { class: "st-grid2" }, dens, h("label", { class: "st-chk" }, useMot, " reaproveitar o motivo rítmico")), h("div", { class: "row" }, soloB, againB),
      h("div", { class: "st-orns" }, ...ornKinds), h("label", { class: "st-amt" }, "Quantidade ", amt), ornB,
      how("Solo: nos tempos fortes, notas do acorde; nos fracos, a escala da tonalidade, preferindo graus conjuntos e pequenos saltos; respira no fim de cada frase de 4 compassos e resolve numa nota do acorde. Com “reaproveitar o motivo”, o ritmo do solo usa o motivo rítmico do tema — o solo soa como parte da música. Ornamentos: mordente (nota–vizinha superior–nota), trilo nas notas longas, grupeto (superior–nota–inferior), apojatura (vizinha no tempo forte que resolve) e notas de passagem entre terças.")),
    sec("analysis", "🔎", "Análise do tema principal", h("label", { class: "st-chk" }, showOn, " Mostrar motivo, módulos e harmonização na partitura"), anBox,
      how("O tema principal é a camada de melodia com mais notas. O ritmo de cada compasso vira uma assinatura (ataques em semicolcheias); a mais repetida é o motivo rítmico. Blocos de 4 compassos são comparados por ritmo e contorno: iguais = mesmo módulo (A), parecidos = variação (A'), diferentes = módulo novo (B). Sem cifras, sugiro um acorde por meio compasso pelas notas que soam, preparando o fim das frases com a dominante. Peça ao Maestro a explicação teórica completa.")),
  );
  const refresh = () => { drawList(); drawAnalysis(); };
  const off = store.on((r) => { if (r !== "autosave") { cancelAnimationFrame(raf); raf = requestAnimationFrame(refresh); } });
  let raf = 0;
  const onGo = (e: Event) => { const id = (e as CustomEvent).detail; const el = body.querySelector<HTMLElement>(`[data-sec="${id}"]`); if (el) { el.scrollIntoView({ block: "start", behavior: "smooth" }); el.classList.add("flash"); setTimeout(() => el.classList.remove("flash"), 900); } };
  addEventListener("study:section", onGo);
  refresh();
  return () => { off(); removeEventListener("study:section", onGo); };
}

/** O Maestro explica o tema (análise local; com conta, a IA aprofunda). */
export function explainWithMaestro() {
  const lines = explain(store.score);
  dispatchEvent(new CustomEvent("maestro:say", { detail: { text: lines.join("\n\n"), ms: 30000, long: true } }));
}
