// Fluxo de IA em grafo (nós + conexões, drag & drop): monta visualmente o pipeline
// Entrada → Pré-processamento → Modelos → Pós-processamento → Partitura/Exportação.
import { h, toast } from "../core/ui";
import { api, currentUser } from "../core/api";

interface GNode { id: string; type: string; x: number; y: number; }
interface GEdge { from: string; to: string; }

const PALETTE: Record<string, { label: string; color: string; in: boolean; out: boolean; help: string }> = {
  audio: { label: "🎵 Áudio", color: "#1b8fd6", in: false, out: true, help: "Arquivo de áudio ou gravação" },
  image: { label: "📷 Foto", color: "#8a5cf6", in: false, out: true, help: "Foto/scan de partitura" },
  cifra: { label: "🎸 Cifra", color: "#ff9f43", in: false, out: true, help: "Texto com acordes" },
  trim: { label: "✂️ Recorte", color: "#5c6f8c", in: true, out: true, help: "Recorte e ganho" },
  demucs: { label: "🧪 Separar fontes", color: "#16a37a", in: true, out: true, help: "Voz / baixo / bateria / outros (Demucs)" },
  pitch: { label: "🎹 Áudio→notas", color: "#e0397a", in: true, out: true, help: "Basic Pitch (polifônico)" },
  voice: { label: "🎤 Voz + efeitos", color: "#ffb547", in: true, out: true, help: "pYIN: melodia vocal, vibrato, glissando" },
  asr: { label: "📝 Letra (ASR)", color: "#ff5f6d", in: true, out: true, help: "Whisper com tempos por palavra" },
  omr: { label: "👁 OMR", color: "#a77bff", in: true, out: true, help: "Leitura óptica (oemer)" },
  melody: { label: "〰 Melodia", color: "#ff6b9a", in: true, out: true, help: "Skyline: voz principal" },
  harmony: { label: "♫ Harmonização", color: "#5b8cff", in: true, out: true, help: "Viterbi funcional + voicing" },
  chords: { label: "C7 Cifrar", color: "#36c99a", in: true, out: true, help: "Reconhecimento de acordes" },
  score: { label: "🎼 Partitura", color: "#7c5cff", in: true, out: true, help: "Camadas no editor" },
  export: { label: "⇩ Exportar", color: "#f08a1c", in: true, out: false, help: "MIDI · PDF · WAV · MP3" },
};

const DEFAULT = {
  nodes: [
    { id: "a", type: "audio", x: 20, y: 60 }, { id: "b", type: "trim", x: 170, y: 60 }, { id: "c", type: "demucs", x: 320, y: 60 },
    { id: "d", type: "voice", x: 480, y: 10 }, { id: "e", type: "asr", x: 480, y: 90 }, { id: "f", type: "pitch", x: 480, y: 170 },
    { id: "g", type: "chords", x: 640, y: 170 }, { id: "h", type: "score", x: 790, y: 90 }, { id: "i", type: "export", x: 940, y: 90 },
  ] as GNode[],
  edges: [["a", "b"], ["b", "c"], ["c", "d"], ["c", "e"], ["c", "f"], ["f", "g"], ["d", "h"], ["e", "h"], ["g", "h"], ["h", "i"]].map(([from, to]) => ({ from, to })) as GEdge[],
};

export function mountGraph(body: HTMLElement) {
  body.classList.add("graph-app");
  let state: { nodes: GNode[]; edges: GEdge[] } = JSON.parse(JSON.stringify(DEFAULT));
  const pal = h("div", { class: "palette" }, h("small", {}, "Arraste módulos:"), ...Object.entries(PALETTE).map(([k, v]) => {
    const b = h("div", { class: "pal-item", draggable: "true", title: v.help, style: { background: v.color } }, v.label);
    b.addEventListener("dragstart", (e) => e.dataTransfer!.setData("text/harmonia-node", k));
    return b;
  }));
  const board = h("div", { class: "board" });
  const wires = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  wires.classList.add("wires");
  board.append(wires);
  body.append(pal, board, h("p", { class: "hint" }, "Arraste da bolinha de saída (direita) até a entrada (esquerda) de outro nó para conectar. Duplo clique num nó remove. O fluxo é salvo no seu espaço de trabalho."));

  let linking: { from: string; x: number; y: number } | null = null;
  const temp = document.createElementNS("http://www.w3.org/2000/svg", "path");
  temp.classList.add("wire", "temp");

  function port(n: GNode, side: "in" | "out") { return { x: n.x + (side === "out" ? 132 : 0), y: n.y + 22 }; }
  const curve = (a: { x: number; y: number }, b: { x: number; y: number }) => `M${a.x} ${a.y} C${a.x + 60} ${a.y} ${b.x - 60} ${b.y} ${b.x} ${b.y}`;

  function draw() {
    board.querySelectorAll(".gnode").forEach((e) => e.remove());
    wires.replaceChildren();
    for (const e of state.edges) {
      const a = state.nodes.find((n) => n.id === e.from), b = state.nodes.find((n) => n.id === e.to);
      if (!a || !b) continue;
      const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
      p.setAttribute("d", curve(port(a, "out"), port(b, "in"))); p.classList.add("wire");
      p.addEventListener("dblclick", () => { state.edges = state.edges.filter((x) => x !== e); draw(); save(); });
      wires.append(p);
    }
    wires.append(temp);
    for (const n of state.nodes) {
      const def = PALETTE[n.type];
      const el = h("div", { class: "gnode", style: { left: n.x + "px", top: n.y + "px", "--nc": def.color } as any, title: def.help },
        def.in ? h("i", { class: "port in", "data-node": n.id }) : "", h("span", {}, def.label), def.out ? h("i", { class: "port out", "data-node": n.id }) : "");
      el.addEventListener("dblclick", () => { state.nodes = state.nodes.filter((x) => x !== n); state.edges = state.edges.filter((e) => e.from !== n.id && e.to !== n.id); draw(); save(); });
      el.addEventListener("pointerdown", (ev) => {
        const tgt = ev.target as HTMLElement;
        const br = board.getBoundingClientRect();
        if (tgt.classList.contains("out")) {
          linking = { from: n.id, ...port(n, "out") };
          const mv = (e: PointerEvent) => temp.setAttribute("d", curve(linking!, { x: e.clientX - br.left + board.scrollLeft, y: e.clientY - br.top + board.scrollTop }));
          const up = (e: PointerEvent) => {
            removeEventListener("pointermove", mv); removeEventListener("pointerup", up); temp.setAttribute("d", "");
            const to = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement)?.closest(".gnode")?.querySelector<HTMLElement>(".port.in")?.dataset.node;
            if (to && to !== n.id && !state.edges.some((x) => x.from === n.id && x.to === to)) { state.edges.push({ from: n.id, to }); save(); }
            linking = null; draw();
          };
          addEventListener("pointermove", mv); addEventListener("pointerup", up);
          return;
        }
        const ox = ev.clientX - n.x, oy = ev.clientY - n.y;
        el.setPointerCapture(ev.pointerId);
        const mv = (e: PointerEvent) => { n.x = Math.max(0, e.clientX - ox); n.y = Math.max(0, e.clientY - oy); el.style.left = n.x + "px"; el.style.top = n.y + "px"; drawWiresOnly(); };
        const up = () => { el.removeEventListener("pointermove", mv); el.removeEventListener("pointerup", up); save(); };
        el.addEventListener("pointermove", mv); el.addEventListener("pointerup", up);
      });
      board.append(el);
    }
  }
  function drawWiresOnly() {
    [...wires.querySelectorAll(".wire:not(.temp)")].forEach((p, i) => {
      const e = state.edges[i]; const a = state.nodes.find((n) => n.id === e.from)!, b = state.nodes.find((n) => n.id === e.to)!;
      if (a && b) p.setAttribute("d", curve(port(a, "out"), port(b, "in")));
    });
  }
  board.addEventListener("dragover", (e) => e.preventDefault());
  board.addEventListener("drop", (e) => {
    const type = e.dataTransfer?.getData("text/harmonia-node"); if (!type) return;
    const r = board.getBoundingClientRect();
    state.nodes.push({ id: Math.random().toString(36).slice(2, 8), type, x: e.clientX - r.left - 60, y: e.clientY - r.top - 20 });
    draw(); save(); toast(`Módulo ${PALETTE[type].label} adicionado`, "ok", 1600);
  });
  let st: number | undefined;
  function save() {
    clearTimeout(st);
    st = window.setTimeout(async () => {
      if (!currentUser) return;
      const ws = await api("/api/account/workspace").catch(() => ({}));
      api("/api/account/workspace", { method: "PUT", json: { ...ws, graph: state } }).catch(() => {});
    }, 800);
  }
  (async () => {
    if (currentUser) { const ws = await api("/api/account/workspace").catch(() => null); if (ws?.graph?.nodes) state = ws.graph; }
    draw();
  })();
}
