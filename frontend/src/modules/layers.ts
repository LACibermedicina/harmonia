// Gestor de camadas: visibilidade, mudo, solo, bloqueio, cor, volume, pauta, reordenar (drag & drop),
// mesclar, duplicar, transpor, transcrever gravações e alinhar letra.
import { liveState, onLive } from "../core/livecapture";
import { transcribeRecording } from "../core/rectx";
import { store, newLayer } from "../core/store";
import { Layer, LayerKind, LayerGroup, uid } from "../core/types";
import { h, toast, tip } from "../core/ui";
import { currentUser, runJob, requireLogin } from "../core/api";
import { extractMelody } from "../core/theory";

const KIND_LABEL: Record<LayerKind, string> = { melody: "Melodia", harmony: "Harmonia", voice: "Voz", bass: "Baixo", omr: "OMR", recording: "Gravação" };

export function mountLayers(body: HTMLElement) {
  body.classList.add("layers-app");
  const list = h("ul", { class: "layer-list", role: "listbox", "aria-label": "Camadas" });
  const addSel = h("select", { "aria-label": "Tipo de nova camada" }, ...(["melody", "harmony", "voice", "bass"] as LayerKind[]).map((k) => h("option", { value: k }, KIND_LABEL[k])));
  const toolbar = h("div", { class: "toolbar" },
    addSel,
    h("button", { class: "btn primary", onclick: () => store.mutate((s) => { const k = addSel.value as LayerKind; const l = newLayer(k, KIND_LABEL[k], k === "harmony" || k === "bass" ? "bass" : "treble"); s.layers.push(l); store.selectedLayer = l.id; }, "layer") }, "+ Camada"),
    tip(h("button", { class: "btn", onclick: newGroup }, "+ Grupo"), "Cria um grupo e coloca nele a camada ativa. Arraste camadas sobre o título do grupo para agrupá-las."),
    tip(h("button", { class: "btn", onclick: merge }, "Mesclar visíveis"), "Junta as camadas visíveis desbloqueadas numa só"),
    tip(h("button", { class: "btn", onclick: lyricsDialog }, "Letra → notas"), "Distribui a letra (silabada automaticamente) nas notas da camada ativa"));
  const help = h("p", { class: "hint" }, "Arraste ☰ para reordenar (a ordem define a prioridade na mixagem e na exportação). Clique numa camada para torná-la ativa no editor.");
  body.append(toolbar, list, help);

  let dragId: string | null = null;

  /** Corrente ao lado do olho: fechada = gravação e notas movem juntas; aberta = independentes. */
  function linkBtn(l: Layer) {
    if (!l.link) return "";
    const mates = store.score.layers.filter((x) => x.link === l.link);
    if (mates.length < 2) return "";
    const on = !l.unlinked;
    const other = mates.filter((x) => x.id !== l.id).map((x) => x.name).join(", ");
    return h("button", { class: "ic-btn link-btn" + (on ? " on" : " off"), "aria-pressed": String(on),
      title: on ? `Vinculada a: ${other}. Mover uma move a outra. Clique para desvincular.` : `Desvinculada de: ${other}. Clique para vincular de novo.`,
      onclick: (e: Event) => { e.stopPropagation(); store.mutate(() => mates.forEach((x) => (x.unlinked = on)), "layer"); } }, on ? "🔗" : "⛓");
  }

  function row(l: Layer) {
    const active = l.id === store.selectedLayer;
    const toggle = (key: "visible" | "muted" | "solo" | "locked", on: string, off: string, label: string) =>
      h("button", { class: "ic-btn" + (l[key] ? " on" : ""), "aria-pressed": String(!!l[key]), title: label,
        onclick: (e: Event) => { e.stopPropagation();
          if (key === "visible") { const n = store.setVisible(l, !l.visible); if (n > 1) toast(`${l.visible ? "Mostrando" : "Ocultando"} ${n} camadas vinculadas 🔗 — desvincule ⛓ para ocultar só esta`, "info", 3000); return; }
          store.mutate(() => { (l as any)[key] = !l[key]; }, "layer"); } }, l[key] ? on : off);
    const capturing = !!l.live && liveState()?.layerId === l.id;
    const li = h("li", { class: "layer-row" + (active ? " active" : "") + (l.live ? " live" : "") + (capturing ? " capturing" : ""), draggable: "true", "data-id": l.id, style: { "--lc": l.color } as any,
      onclick: () => { store.selectedLayer = l.id; store.emit("selection"); } },
      h("span", { class: "grip", "aria-hidden": "true" }, "☰"),
      h("input", { type: "color", value: l.color, "aria-label": "Cor", onclick: (e: Event) => e.stopPropagation(), onchange: (e: Event) => store.mutate(() => (l.color = (e.target as HTMLInputElement).value), "layer") }),
      h("div", { class: "lname" },
        h("input", { value: l.name, "aria-label": "Nome", onclick: (e: Event) => e.stopPropagation(), onchange: (e: Event) => store.mutate(() => (l.name = (e.target as HTMLInputElement).value), "layer") }),
        h("small", {}, l.live ? h("b", { class: "live-badge", title: "Notas captadas em tempo real (microfone ou MIDI)" }, capturing ? "● GRAVANDO AO VIVO" : "CAPTURA EM TEMPO REAL") : "", l.live ? " · " : "", `${KIND_LABEL[l.kind]} · ${l.kind === "recording" ? "áudio" : l.notes.length + " notas"} · ${l.staff === "bass" ? "𝄢 Fá" : "𝄞 Sol"}`)),
      toggle("visible", "👁", "◌", "Visível"), linkBtn(l), toggle("locked", "🔒", "🔓", "Trancar (cadeado)"),
      menu(l));
    li.addEventListener("dragstart", (e) => { dragId = l.id; li.classList.add("dragging"); e.dataTransfer!.effectAllowed = "move"; });
    li.addEventListener("dragend", () => { li.classList.remove("dragging"); dragId = null; });
    li.addEventListener("dragover", (e) => { e.preventDefault(); li.classList.add("over"); });
    li.addEventListener("dragleave", () => li.classList.remove("over"));
    li.addEventListener("drop", (e) => {
      e.preventDefault(); li.classList.remove("over");
      if (!dragId || dragId === l.id) return;
      store.mutate((s) => { const from = s.layers.findIndex((x) => x.id === dragId); const [m] = s.layers.splice(from, 1); s.layers.splice(s.layers.findIndex((x) => x.id === l.id), 0, m); }, "reorder");
    });
    return li;
  }

  function menu(l: Layer) {
    const sel = h("select", { class: "row-menu", "aria-label": "Ações da camada", onclick: (e: Event) => e.stopPropagation() },
      h("option", { value: "" }, "⋯"),
      h("option", { value: "staff" }, "Trocar pauta (Sol/Fá)"),
      h("option", { value: "dup" }, "Duplicar"),
      h("option", { value: "up" }, "Transpor +1 st"), h("option", { value: "down" }, "Transpor −1 st"),
      h("option", { value: "oct+" }, "Oitava acima"), h("option", { value: "oct-" }, "Oitava abaixo"),
      h("option", { value: "melody" }, "Extrair melodia desta camada"),
      l.kind === "recording" ? h("option", { value: "transcribe" }, "✨ Transcrever toda a gravação → notas") : null,
      l.kind === "recording" ? h("option", { value: "transcribe-both" }, "✨ Transcrever gravação (melodia + harmonia)") : null,
      l.kind === "recording" && store.selectedMeasures.size ? h("option", { value: "transcribe-sel" }, "✨ Transcrever só os compassos selecionados") : null,
      h("option", { value: "clear-lyrics" }, "Limpar letra"),
      ...(store.score.layerGroups || []).filter((g) => g.id !== l.group).map((g) => h("option", { value: "group:" + g.id }, "Mover para grupo: " + g.name)),
      l.group ? h("option", { value: "ungroup" }, "Tirar do grupo") : null,
      h("option", { value: "delete" }, "Excluir camada"));
    sel.addEventListener("change", async () => {
      const v = sel.value; sel.value = "";
      const tr = (d: number) => store.mutate(() => l.notes.forEach((n) => (n.pitch = Math.max(21, Math.min(108, n.pitch + d)))), "layer");
      if (v === "staff") store.mutate(() => (l.staff = l.staff === "bass" ? "treble" : "bass"), "layer");
      if (v === "dup") store.mutate((s) => s.layers.push({ ...JSON.parse(JSON.stringify(l)), id: Math.random().toString(36).slice(2), name: l.name + " (cópia)" }), "layer");
      if (v === "up") tr(1); if (v === "down") tr(-1); if (v === "oct+") tr(12); if (v === "oct-") tr(-12);
      if (v === "melody") store.mutate((s) => { const m = newLayer("melody", "Melodia de " + l.name); m.notes = extractMelody(l.notes, 0); s.layers.push(m); }, "layer");
      if (v === "clear-lyrics") store.mutate(() => l.notes.forEach((n) => (n.lyric = null)), "layer");
      if (v === "delete" && confirmDelete(l)) store.mutate((s) => (s.layers = s.layers.filter((x) => x.id !== l.id)), "layer");
      if (v.startsWith("group:")) store.mutate(() => (l.group = v.slice(6)), "layer");
      if (v === "ungroup") store.mutate(() => (l.group = undefined), "layer");
      if (v === "transcribe") await transcribeRecording(l);
      if (v === "transcribe-both") await transcribeRecording(l, { mode: "both" });
      if (v === "transcribe-sel") await transcribeRecording(l, { measures: [...store.selectedMeasures] });
    });
    return sel;
  }

  function confirmDelete(l: Layer) {
    if (!l.notes.length) return true;
    const ok = window.confirm(`Excluir "${l.name}" com ${l.notes.length} notas? (Pode desfazer com ⌘Z)`);
    return ok;
  }

  function merge() {
    const vis = store.score.layers.filter((l) => l.visible && !l.locked && l.kind !== "recording");
    if (vis.length < 2) { toast("Deixe ao menos duas camadas visíveis e desbloqueadas", "warn"); return; }
    store.mutate((s) => {
      const m = newLayer("harmony", "Mesclada", vis[0].staff);
      m.notes = vis.flatMap((l) => l.notes.map((n) => ({ ...n })));
      s.layers = s.layers.filter((l) => !vis.includes(l)); s.layers.push(m);
    }, "merge");
  }

  function lyricsDialog() {
    const l = store.layer();
    if (!l || l.kind === "recording") { toast("Selecione uma camada de melodia/voz", "warn"); return; }
    const ta = h("textarea", { rows: 4, placeholder: "Cole a letra aqui…" }) as HTMLTextAreaElement;
    const dlg = h("div", { class: "sheet" }, h("h4", {}, `Letra para "${l.name}"`), ta,
      h("p", { class: "hint" }, "A letra é dividida em sílabas e encaixada nas notas, respeitando pausas (≥ 1 tempo) como fim de frase. Ajuste depois com a ferramenta Letra."),
      h("div", { class: "row" }, h("button", { class: "btn", onclick: () => dlg.remove() }, "Cancelar"),
        h("button", { class: "btn primary", onclick: async () => {
          try {
            if (currentUser) {
              const r = await runJob("lyrics", { score: store.score, layer: l.id, text: ta.value });
              store.mutate(() => (l.notes = r.notes), "lyrics");
            } else {
              const syl = ta.value.split(/\s+/).filter(Boolean);
              store.mutate(() => [...l.notes].sort((a, b) => a.start - b.start).forEach((n, i) => (n.lyric = syl[i] ?? null)), "lyrics");
            }
            dlg.remove(); toast("Letra aplicada", "ok");
          } catch (e: any) { toast(e.message, "error"); }
        } }, "Aplicar")));
    body.append(dlg); ta.focus();
  }

  // ------------------------------------------------------------ grupos
  function newGroup() {
    const name = prompt("Nome do grupo (ex.: Mão direita, Acompanhamento, Vozes)");
    if (!name?.trim()) return;
    store.mutate((s) => {
      const g: LayerGroup = { id: uid(), name: name.trim(), color: "#7c5cff" };
      s.layerGroups = [...(s.layerGroups || []), g];
      const act = s.layers.find((x) => x.id === store.selectedLayer);
      if (act) act.group = g.id;
    }, "layer");
  }

  function groupRow(g: LayerGroup, members: Layer[]) {
    const all = (k: "visible" | "muted" | "solo" | "locked") => members.length > 0 && members.every((m) => m[k]);
    const toggle = (k: "visible" | "muted" | "solo" | "locked", on: string, off: string, label: string) =>
      h("button", { class: "ic-btn" + (all(k) ? " on" : ""), title: label + " (grupo inteiro)", "aria-pressed": String(all(k)),
        onclick: (e: Event) => { e.stopPropagation(); const v = !all(k); store.mutate(() => members.forEach((m) => ((m as any)[k] = v)), "layer"); } }, all(k) ? on : off);
    const li = h("li", { class: "group-row" + (g.collapsed ? " collapsed" : ""), "data-group": g.id },
      h("button", { class: "ic-btn ghost", "aria-label": g.collapsed ? "Expandir grupo" : "Recolher grupo", onclick: () => store.mutate(() => (g.collapsed = !g.collapsed), "layer") }, g.collapsed ? "▸" : "▾"),
      h("span", { class: "grp-ic", "aria-hidden": "true" }, "🗂"),
      h("input", { class: "grp-name", value: g.name, "aria-label": "Nome do grupo", onchange: (e: Event) => store.mutate(() => (g.name = (e.target as HTMLInputElement).value), "layer") }),
      h("small", {}, `${members.length} camada(s)`),
      toggle("visible", "👁", "◌", "Visível"), toggle("locked", "🔒", "🔓", "Trancar"),
      h("button", { class: "ic-btn", title: "Desfazer grupo (as camadas continuam)", onclick: () => store.mutate((s) => {
        s.layers.forEach((x) => { if (x.group === g.id) x.group = undefined; });
        s.layerGroups = (s.layerGroups || []).filter((x) => x.id !== g.id);
      }, "layer") }, "✕"));
    // soltar uma camada sobre o título do grupo = agrupar
    li.addEventListener("dragover", (e) => { e.preventDefault(); li.classList.add("over"); });
    li.addEventListener("dragleave", () => li.classList.remove("over"));
    li.addEventListener("drop", (e) => {
      e.preventDefault(); li.classList.remove("over");
      if (!dragId) return;
      store.mutate((s) => { const x = s.layers.find((y) => y.id === dragId); if (x) x.group = g.id; }, "layer");
    });
    return li;
  }

  const render = () => {
    const s = store.score;
    const groups = (s.layerGroups || []).filter((g) => g);
    const items: HTMLElement[] = [];
    for (const g of groups) {
      const members = s.layers.filter((l) => l.group === g.id);
      items.push(groupRow(g, members));
      if (!g.collapsed) members.forEach((m) => { const r = row(m); r.classList.add("in-group"); items.push(r); });
    }
    s.layers.filter((l) => !l.group || !groups.some((g) => g.id === l.group)).forEach((l) => items.push(row(l)));
    list.replaceChildren(...items, ...(s.layers.length ? [] : [h("li", { class: "empty" }, "Nenhuma camada. Importe áudio, foto ou cifra — ou crie uma camada.")]));
  };
  const off = store.on((r) => r !== "autosave" && render());
  // início/fim da captura ao vivo muda o selo (● GRAVANDO AO VIVO) sem redesenhar a cada quadro
  let wasLive: string | null = null;
  const offLive = onLive((st) => { const id = st?.layerId ?? null; if (id !== wasLive) { wasLive = id; render(); } });
  render();
  return () => { off(); offLive(); };
}
