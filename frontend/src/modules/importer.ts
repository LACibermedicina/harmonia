// Importação: áudio (recorte/ganho antes do envio), foto de partitura (recorte/rotação) e cifra em texto.
import { store, newLayer } from "../core/store";
import { h, toast, busy, tip, withIcon } from "../core/ui";
import { ICONS } from "../core/icons";
import { runJob, upload, requireLogin, currentUser, api } from "../core/api";
import * as audio from "../core/audio";
import { parseCifraBars, voiceChords, parseChord } from "../core/theory";
import { beatsPerMeasure, uid } from "../core/types";

// ------------------------------------------------ arrastar o trecho do Importar para a partitura
// O trecho recortado fica registrado aqui; a partitura dispara "harmonia:drop-audio" ao soltar.
interface Clip { buf: AudioBuffer; a: number; b: number; gainDb: number; name: string; mode: string; separate: boolean; lyrics: boolean }
const clips = new Map<string, Clip>();
addEventListener("harmonia:drop-audio", (e: Event) => { const d = (e as CustomEvent).detail; const c = clips.get(d.key); if (c) placeAudio(c, d.beat); });

/** Coloca o trecho como camada de gravação na posição (tempo) e transcreve em notas vinculadas a ela. */
async function placeAudio(c: Clip, startBeat: number) {
  const s = store.score, spb = 60 / s.tempo, bpm = beatsPerMeasure(s);
  const dur = c.b - c.a, link = uid();
  const m0 = Math.floor(startBeat / bpm), m1 = Math.floor((startBeat + dur / spb - 1e-6) / bpm);
  const wav = await audio.trimToWav(c.buf, c.a, c.b, c.gainDb);
  const rec = { ...newLayer("recording", `🎵 ${c.name.replace(/\.\w+$/, "")} (c.${m0 + 1})`), audioUrl: URL.createObjectURL(wav), audioOffset: startBeat * spb, audioDur: dur,
    measures: Array.from({ length: m1 - m0 + 1 }, (_, i) => m0 + i), link };
  store.mutate((sc) => { sc.layers.push(rec); sc.measures = Math.max(sc.measures, m1 + 1); while (sc.chords.length < sc.measures) sc.chords.push([]); store.selectedLayer = rec.id; }, "drop-audio");
  dispatchEvent(new CustomEvent("open-app", { detail: "compose" }));
  toast(`Trecho no compasso ${m0 + 1}. Transcrevendo em notas…`, "info", 4000);
  try {
    const r = await transcribeBuffer(c.buf, { name: c.name, label: `Trecho na partitura — ${c.name}`, a: c.a, b: c.b, gainDb: c.gainDb, mode: c.mode as any, separate: c.separate, lyrics: c.lyrics,
      tempo: s.tempo, fixedTempo: true, timeSig: s.timeSig, onUploaded: (path) => store.mutate(() => { const l = store.score.layers.find((x) => x.id === rec.id); if (l) l.audio = path; }, "upload"),
      open: () => dispatchEvent(new CustomEvent("open-app", { detail: "compose" })) });
    const made: string[] = [];
    store.mutate((sc) => {
      for (const nl of r.layers || []) {
        if (!nl.notes?.length) continue;
        const v = newLayer(nl.staff === "bass" ? "harmony" : (nl.kind || "voice"), `${nl.name || "Notas"} — ${rec.name.replace(/^🎵 /, "")}`, nl.staff === "bass" ? "bass" : "treble");
        v.notes = nl.notes.map((n: any) => ({ ...n, id: uid(), start: n.start + startBeat }));
        v.link = link; sc.layers.push(v); made.push(v.name);
        const last = Math.max(...v.notes.map((n) => n.start + n.dur));
        sc.measures = Math.max(sc.measures, Math.ceil(last / bpm));
      }
      while (sc.chords.length < sc.measures) sc.chords.push([]);
    }, "merge");
    toast(made.length ? `Notas criadas e vinculadas à gravação 🔗 (${made.join(" · ")}). Arraste o clipe 🎙 na pauta e as notas acompanham.` : "Gravação colocada; nenhuma nota reconhecida neste trecho.", made.length ? "ok" : "warn", 7000);
  } catch (e: any) { toast("Gravação colocada; transcrição indisponível: " + e.message, "warn", 6000); }
}
import { prefs } from "../core/prefs";
import { startTask, updateTask } from "../core/tasks";
import { transcribeBuffer } from "../core/transcribe";
import { startCapture, Capture } from "../core/livecapture";
import { SOLFEGE } from "../core/theory";

/** Leitura da partitura por IA com visão (servidor em modo leve ou OMR indisponível). */
async function visionOmr(cv: HTMLCanvasElement, melodyOnly: boolean, task: ReturnType<typeof startTask>, label: (t: string) => void) {
  const STG = [{ key: "prep", label: "Preparando a imagem", pct: 10 }, { key: "ai", label: "IA lendo as pautas, notas e cifras", pct: 85 }, { key: "notes", label: "Convertendo em notas", pct: 100 }];
  updateTask(task, { status: "running", stages: STG, stage: "prep", stageLabel: STG[0].label, pct: 5, detail: "leitura por IA com visão", error: undefined, cancel: undefined });
  // reduz para no máx. 2200 px no lado maior (legível para a IA, envio rápido)
  const k = Math.min(1, 2200 / Math.max(cv.width, cv.height));
  const small = document.createElement("canvas"); small.width = Math.round(cv.width * k); small.height = Math.round(cv.height * k);
  const g = small.getContext("2d")!; g.fillStyle = "#fff"; g.fillRect(0, 0, small.width, small.height); g.drawImage(cv, 0, 0, small.width, small.height);
  const b64 = small.toDataURL("image/jpeg", 0.9).split(",")[1];
  updateTask(task, { stage: "ai", stageLabel: STG[1].label, pct: 15 });
  label("IA lendo a partitura… (até 1 min)");
  let pct = 15; const tick = window.setInterval(() => { pct = Math.min(80, pct + 3); updateTask(task, { pct }); }, 1500);
  try {
    const r = await api<any>("/api/ai/omr", { method: "POST", json: { image_b64: b64, mime: "image/jpeg", melodyOnly } });
    updateTask(task, { stage: "notes", stageLabel: STG[2].label, pct: 92 });
    const bpm = (r.timeSig[0] * 4) / r.timeSig[1];
    r.chords = (r.chordSymbols || []).map((cell: string[]) => cell.map((sym, i) => { const c = parseChord(sym); return c ? { ...c, beat: (i * bpm) / cell.length, dur: bpm / cell.length } : null; }).filter(Boolean));
    const n = r.layers.reduce((a: number, l: any) => a + l.notes.length, 0);
    updateTask(task, { status: "done", pct: 100, stage: "done", stageLabel: "Concluído (IA com visão)", summary: `${n} notas · ${r.measures} compassos`, endedAt: Date.now() });
    return r;
  } catch (e: any) {
    updateTask(task, { status: "error", error: e.message, endedAt: Date.now() });
    throw e;
  } finally { clearInterval(tick); }
}

export function mountImporter(body: HTMLElement) {
  body.classList.add("importer");
  const tabs = h("div", { class: "tabs", role: "tablist" });
  const panes = h("div", { class: "panes" });
  // ENTRADA ÚNICA: solte ou cole qualquer coisa — o tipo é reconhecido e a aba certa abre com o conteúdo
  const anyIn = h("input", { type: "file", hidden: true, accept: "audio/*,video/*,image/*,.txt,.cho,.chordpro,.crd,.pro,.mid,.midi,.musicxml,.xml,.mxl,.pdf", onchange: () => { const f = anyIn.files?.[0]; if (f) route(f); anyIn.value = ""; } }) as HTMLInputElement;
  const inbox = h("div", { class: "inbox", tabindex: "0", role: "button", "aria-label": "Entrada única: áudio, vídeo, foto de partitura ou cifra",
    onclick: () => anyIn.click(), onkeydown: (e: KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); anyIn.click(); } } },
    h("b", {}, "⬇ Solte aqui qualquer entrada"),
    h("small", {}, "🎵 áudio/vídeo · 📷 foto ou scan da partitura · 🎸 cifra (.txt) — ou cole (⌘V) texto/imagem. Eu reconheço o tipo e abro a edição certa."), anyIn);
  const say = (m: string) => { inbox.dataset.last = m; inbox.classList.add("got"); setTimeout(() => inbox.classList.remove("got"), 1200); toast(m, "info", 3500); };
  async function route(f: File) {
    const n = f.name.toLowerCase(), t = f.type;
    if (t.startsWith("audio/") || t.startsWith("video/") || /\.(mp3|wav|m4a|aac|ogg|oga|opus|flac|webm|mp4|mov|3gp|amr)$/.test(n)) { show("audio"); say(`🎵 Áudio reconhecido: ${f.name} — recorte o trecho e transcreva`); dispatchEvent(new CustomEvent("import:inject", { detail: { kind: "audio", file: f } })); return; }
    if (t.startsWith("image/") || /\.(png|jpe?g|webp|heic|heif|bmp|gif|tiff?)$/.test(n)) { show("image"); say(`📷 Partitura em imagem: ${f.name} — marque as pautas e leia`); dispatchEvent(new CustomEvent("import:inject", { detail: { kind: "image", file: f } })); return; }
    if (t.startsWith("text/") || /\.(txt|cho|chordpro|crd|pro)$/.test(n)) { const text = await f.text(); show("cifra"); say(`🎸 Cifra reconhecida: ${f.name}`); dispatchEvent(new CustomEvent("import:inject", { detail: { kind: "cifra", text } })); return; }
    if (/\.pdf$/.test(n) || t === "application/pdf") { toast("PDF: exporte a página como imagem (ou tire um print) e solte aqui — a leitura é feita por página", "warn", 6000); return; }
    if (/\.(mid|midi|musicxml|xml|mxl)$/.test(n)) { toast("MIDI/MusicXML: abra na Biblioteca ou exporte como áudio/imagem por enquanto", "warn", 5000); return; }
    toast(`Não reconheci o tipo de “${f.name}”`, "warn");
  }
  inbox.addEventListener("dragover", (e) => { e.preventDefault(); inbox.classList.add("over"); });
  inbox.addEventListener("dragleave", () => inbox.classList.remove("over"));
  inbox.addEventListener("drop", (e) => { e.preventDefault(); inbox.classList.remove("over"); const f = e.dataTransfer?.files?.[0]; if (f) route(f); else { const tx = e.dataTransfer?.getData("text/plain"); if (tx) pasteText(tx); } });
  const pasteText = (tx: string) => {
    // texto com acordes (C, Am, G7, F#m7(b5)…) → cifra; senão tenta como letra para conferir
    const chordy = (tx.match(/\b[A-G](#|b)?(m|maj7|7M|m7|7|dim|°|aug|\+|sus[24]|add9|9|6)?(\/[A-G](#|b)?)?(?=\s|$|\|)/g) || []).length;
    if (chordy >= 2) { show("cifra"); say("🎸 Texto com acordes reconhecido como cifra"); dispatchEvent(new CustomEvent("import:inject", { detail: { kind: "cifra", text: tx } })); }
    else toast("Colei como texto, mas não vi acordes. Para conferir letra, use a aba Áudio › Conferir com a letra.", "info", 5000);
  };
  body.addEventListener("paste", (e: ClipboardEvent) => {
    if ((e.target as HTMLElement).closest("textarea, input")) return;
    const item = [...(e.clipboardData?.items || [])].find((i) => i.kind === "file");
    const f = item?.getAsFile(); if (f) { e.preventDefault(); route(f); return; }
    const tx = e.clipboardData?.getData("text/plain"); if (tx) { e.preventDefault(); pasteText(tx); }
  });
  body.append(inbox, tabs, panes);
  const defs: [string, string, () => HTMLElement][] = [["audio", "🎵 Áudio ou 🎙 gravação", audioPane], ["image", "📷 Foto da partitura", imagePane], ["cifra", "🎸 Cifra", cifraPane]];
  const show = (id: string) => {
    tabs.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.tab === id));
    panes.querySelectorAll<HTMLElement>(".pane").forEach((p) => (p.hidden = p.dataset.pane !== id));
  };
  for (const [id, label, mk] of defs) {
    tabs.append(h("button", { role: "tab", "data-tab": id, onclick: () => show(id) }, label));
    const p = mk(); p.classList.add("pane"); p.dataset.pane = id; panes.append(p);
  }
  show(prefs.importTab || "audio");
  // pré-seleção vinda do passo a passo (aba e o que capturar)
  const applyPreset = (tab: string, mode: string) => {
    show(tab);
    panes.querySelectorAll<HTMLSelectElement>("[data-pane=audio] select").forEach((sel, i) => { if (i === 0) sel.value = mode === "melody" ? "melody" : "both"; });
  };
  applyPreset(prefs.importTab || "audio", prefs.captureMode);
  const onPreset = (e: Event) => { const d = (e as CustomEvent).detail; applyPreset(d.tab, d.mode); };
  addEventListener("import:preset", onPreset);
  // Servidor em modo leve: avisa antes do envio (transcrição de áudio/foto exige IA completa)
  fetch("/api/health").then((r) => r.json()).then((hc) => {
    if (hc.ai_full) return;
    panes.querySelectorAll<HTMLElement>('[data-pane="audio"], [data-pane="image"]').forEach((p) =>
      p.prepend(h("div", { class: "lyrics-check" }, p.dataset.pane === "audio"
        ? "ℹ️ Modo de IA leve: a transcrição extrai a melodia principal (voz ou instrumento solo) e estima os acordes. Separação de voz, polifonia e letra cantada exigem a IA completa."
        : "ℹ️ Modo de IA leve: a foto da partitura é lida por uma IA com visão (Gemini/OpenAI/Pollinations…). Recorte só as pautas para mais precisão e confira na revisão.")));
  }).catch(() => {});
}

/** Leva o resultado para a tela de Composição como camada(s) nova(s) e mostra onde estão. */
function deliver(r: any, what: string, openCompose = true) {
  const ids = store.mergeResult(r);
  if (openCompose) {
    dispatchEvent(new CustomEvent("open-app", { detail: "compose" }));
    dispatchEvent(new CustomEvent("open-app", { detail: "layers" }));
  }
  const names = store.score.layers.filter((l) => ids.includes(l.id)).map((l) => l.kind === "recording" ? `🎙 ${l.name}` : `${l.name} (${l.notes.length} notas)`);
  if (!ids.length) toast(`${what}: nenhuma nota reconhecida. Tente recortar um trecho mais limpo ou ajustar o ganho.`, "warn", 7000);
  else toast(`${what} → ${ids.length} camada(s) na Composição: ${names.join(" · ")}`, "ok", 7000);
  if (r.notice) setTimeout(() => toast(r.notice, "info", 9000), 600);
  return ids;
}

function dropZone(accept: string, label: string, onFile: (f: File) => void) {
  const input = h("input", { type: "file", accept, hidden: true, onchange: (e: Event) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) onFile(f); } });
  const z = h("label", { class: "drop" }, input, h("div", { class: "drop-ic" }, "⇪"), h("b", {}, label), h("small", {}, "arraste e solte aqui ou clique para escolher"));
  z.addEventListener("dragover", (e) => { e.preventDefault(); z.classList.add("over"); });
  z.addEventListener("dragleave", () => z.classList.remove("over"));
  z.addEventListener("drop", (e) => { e.preventDefault(); z.classList.remove("over"); const f = e.dataTransfer?.files[0]; if (f) onFile(f); });
  return z;
}

// ------------------------------------------------------------------ ÁUDIO
function audioPane() {
  const p = h("div");
  let buf: AudioBuffer | null = null; let file: File | null = null;
  let a = 0, b = 0;
  const cv = h("canvas", { class: "wave", width: 900, height: 120 }) as HTMLCanvasElement;
  const info = h("div", { class: "hint" });
  const gain = h("input", { type: "range", min: -12, max: 12, step: 1, value: 0, "aria-label": "Ganho (dB)" }) as HTMLInputElement;
  const mode = h("select", {}, h("option", { value: "both" }, "Melodia + harmonia"), h("option", { value: "melody" }, "Somente melodia"), h("option", { value: "harmony" }, "Somente harmonia")) as HTMLSelectElement;
  const sep = h("input", { type: "checkbox", checked: true }) as HTMLInputElement;
  const polySel = h("select", { "aria-label": "Notas simultâneas" }, h("option", { value: "mono" }, "uma nota por vez"), h("option", { value: "poly" }, "várias (acordes)")) as HTMLSelectElement;
  const orch = h("input", { type: "checkbox" }) as HTMLInputElement;
  const lyr = h("input", { type: "checkbox", checked: true }) as HTMLInputElement;
  const tempo = h("input", { type: "number", placeholder: "auto", min: 30, max: 260, class: "num" }) as HTMLInputElement;
  const expected = h("textarea", { rows: 3, placeholder: "Opcional: cole a letra correta para conferir a transcrição do canto" }) as HTMLTextAreaElement;
  const go = h("button", { class: "btn primary go", disabled: true, title: "Envie ou grave um áudio primeiro" }, "✨ Transcrever para partitura") as HTMLButtonElement;
  const result = h("div", { class: "result" });
  // transporte da faixa importada: ouvir/pausar, parar, voltar/avançar 5 s e ponteiro arrastável na onda
  const SRC_ID = "import-audio";
  let ph = -1; // posição de reprodução (segundos da faixa)
  const playB = h("button", { class: "btn primary", "aria-label": "Ouvir trecho", onclick: () => togglePlay() }, "▶ Ouvir trecho") as HTMLButtonElement;
  const stopB = h("button", { class: "btn", "aria-label": "Parar", title: "Parar", onclick: () => { if (mine()) audio.stop(); ph = -1; draw(); } }, "■");
  const backB = h("button", { class: "btn", "aria-label": "Voltar 5 segundos", title: "Voltar 5 s", onclick: () => jump(-5) }, "⏪ 5s");
  const fwdB = h("button", { class: "btn", "aria-label": "Avançar 5 segundos", title: "Avançar 5 s", onclick: () => jump(5) }, "5s ⏩");
  const clock = h("span", { class: "hint mono", "aria-live": "off" }, "0:00");
  // ---- barra fixa no topo: fonte (arquivo / gravação ao vivo), transporte, opções e TRANSCREVER — sempre visíveis
  const fileIn = h("input", { type: "file", accept: "audio/*,video/webm", hidden: true, onchange: (e: Event) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) load(f); } }) as HTMLInputElement;
  const pickB = tip(h("button", { class: "btn", onclick: () => fileIn.click() }, "📂 Arquivo"), "Escolher um arquivo de áudio (MP3, WAV, FLAC, M4A, OGG) — ou arraste para a área abaixo");
  let rec: { stop: () => Promise<Blob> } | null = null; let recT0 = 0; let recTimer = 0;
  const recB = tip(h("button", { class: "btn rec cap-btn", onclick: () => toggleCapture() }, "🎤 Capturar notas"),
    "Capturar notas — cante ou toque (microfone ou teclado MIDI) e a pauta é escrita em tempo real, no andamento da partitura, a partir do compasso selecionado. Conto 1 compasso antes.") as HTMLButtonElement;
  const capLive = h("span", { class: "cap-live", hidden: true, "aria-live": "polite" });
  const resetB = tip(h("button", { class: "btn ghost", onclick: () => { if (buf) { a = 0; b = buf.duration; draw(); } } }, "↺ Recorte"), "Voltar a usar a faixa inteira");
  const viewB = h("button", { class: "btn", hidden: true, onclick: () => (dispatchEvent(new CustomEvent("open-app", { detail: "compose" })), setTimeout(() => dispatchEvent(new CustomEvent("harmonia:action", { detail: "viz-open" })), 300)) }, "👁 Ver transcrição") as HTMLButtonElement;
  // alça arrastável: solte o trecho sobre a partitura (no compasso desejado) — vira camada 🎙 + notas vinculadas
  // trechos marcados: ✂ guarda a seleção atual (alças rosa) como trecho; cada trecho pode ser ouvido e
  // ARRASTADO para a pauta (solte no compasso onde ele deve entrar) — vira 🎙 + notas vinculadas 🔗
  const clipKey = "clip-" + Math.random().toString(36).slice(2, 8);
  const putClip = (ra = a, rb = b, key = clipKey) => { if (buf) clips.set(key, { buf, a: ra, b: rb, gainDb: +gain.value, name: file?.name || "faixa", mode: mode.value, separate: sep.checked, lyrics: lyr.checked }); };
  interface Region { id: string; a: number; b: number; n: number }
  let regions: Region[] = []; let regN = 0;
  const regBox = h("div", { class: "regions", "aria-label": "Trechos marcados" });
  const REG_COLORS = ["#ff8a4c", "#3d7bff", "#17a589", "#e5487f", "#8e44ad", "#f39c12"];
  const drawRegions = () => {
    regBox.replaceChildren(...regions.map((r, i) => {
      const key = "reg-" + r.id;
      const chip = tip(h("span", { class: "reg-chip", draggable: "true", tabindex: "0", role: "button", style: { "--rc": REG_COLORS[i % REG_COLORS.length] },
        "aria-label": `Trecho ${r.n}: arraste para a pauta` },
        h("b", { class: "reg-grip", "aria-hidden": "true" }, "⠿"), h("span", {}, `T${r.n} · ${fmt(r.a)}–${fmt(r.b)}`),
        h("button", { class: "reg-btn", "aria-label": "Ouvir trecho", onclick: (e: Event) => { e.stopPropagation(); if (buf) audio.playBuffer(buf, { from: r.a, to: r.b, gainDb: +gain.value, source: source() }); } }, "▶"),
        h("button", { class: "reg-btn", "aria-label": "Selecionar na onda", onclick: (e: Event) => { e.stopPropagation(); a = r.a; b = r.b; draw(); } }, "◎"),
        h("button", { class: "reg-btn", "aria-label": "Remover trecho", onclick: (e: Event) => { e.stopPropagation(); regions = regions.filter((x) => x !== r); drawRegions(); draw(); } }, "✕")),
        `Trecho ${r.n} — arraste e solte na pauta, no compasso onde deve começar (ou Enter = compasso selecionado). Vira gravação 🎙 + notas transcritas e vinculadas 🔗.`);
      chip.addEventListener("dragstart", (e) => { putClip(r.a, r.b, key); e.dataTransfer!.setData("text/harmonia-audio", key); e.dataTransfer!.effectAllowed = "copy"; });
      chip.addEventListener("keydown", (e) => { if (e.key === "Enter") { putClip(r.a, r.b, key); placeAudio(clips.get(key)!, ([...store.selectedMeasures].sort((x, y) => x - y)[0] ?? 0) * beatsPerMeasure(store.score)); } });
      return chip;
    }), regions.length ? "" : h("small", { class: "hint" }, "Selecione com as alças rosa e clique ✂ para guardar trechos. Arraste qualquer trecho (ou o ✂) direto para a pauta."));
  };
  const markB = tip(h("button", { class: "btn mark-btn", draggable: "true", hidden: true, "aria-label": "Marcar trecho",
    onclick: () => { if (!buf) return; regions.push({ id: Math.random().toString(36).slice(2, 7), a, b, n: ++regN }); drawRegions(); draw(); } }, "✂"),
    "Marcar trecho — guarda a parte selecionada (entre as alças rosa) para ouvir e importar. Você também pode ARRASTAR este ícone direto para a pauta e soltar onde o trecho deve entrar.") as HTMLButtonElement;
  markB.addEventListener("dragstart", (e) => { putClip(); e.dataTransfer!.setData("text/harmonia-audio", clipKey); e.dataTransfer!.effectAllowed = "copy"; });
  const dragB = h("span", { hidden: true });
  const bar = h("div", { class: "imp-bar" },
    h("div", { class: "imp-row" }, pickB, recB, capLive, h("i", { class: "imp-sep" }), backB, playB, stopB, fwdB, clock, h("span", { class: "spacer" }), markB, viewB, go),
    h("div", { class: "imp-row opts" },
      h("label", { class: "inline" }, "Extrair ", mode), h("label", { class: "inline" }, "♩ ", tempo),
      tip(h("label", { class: "check" }, sep, " Separar voz"), "Isola a voz (Demucs) para transcrever como camada 'Voz' com letra e efeitos vocais"),
      h("label", { class: "check" }, lyr, " Letra cantada"),
      tip(h("label", { class: "inline" }, "Notas ", polySel), "“Várias” reconhece acordes (piano, violão, coro) e cria notas simultâneas nas duas mãos"),
      tip(h("label", { class: "check" }, orch, " 🎼 Orquestra"), "Vários instrumentos ao mesmo tempo: cada timbre reconhecido vai para uma camada própria (instrumento estimado)"),
      h("label", { class: "inline" }, "Ganho ", gain), resetB));
  withIcon(pickB, ICONS.import); withIcon(go, ICONS.harm);
  const lyricsBox = h("details", { class: "imp-more" }, h("summary", {}, "Conferir com a letra correta (opcional)"), expected);
  const drop = dropZone("audio/*,video/*", "Arraste um áudio ou vídeo aqui, escolha 📂 Arquivo ou use 🎤 Capturar notas", load);
  const editor = h("div", { class: "trim", hidden: true }, cv, regBox, info, lyricsBox, result);
  p.classList.add("imp-pane");
  p.append(fileIn, bar, drop, editor);
  const setTransport = (on: boolean) => [playB, stopB, backB, fwdB, resetB].forEach((x) => ((x as HTMLButtonElement).disabled = !on));
  setTransport(false);
  let cap: Capture | null = null;
  async function toggleCapture() {
    if (cap) {
      const n = await cap.stop(); cap = null;
      recB.classList.remove("recording"); recB.textContent = "🎤 Capturar notas"; capLive.hidden = true;
      toast(n ? `${n} nota(s) escritas na camada “Captura ao vivo”` : "Nenhuma nota detectada — aproxime o microfone e cante/toque notas mais longas", n ? "ok" : "warn", 5000);
      return;
    }
    try {
      audio.stop();
      dispatchEvent(new CustomEvent("open-app", { detail: "compose" }));
      const sel = [...store.selectedMeasures].sort((x, y) => x - y);
      cap = await startCapture({ fromBeat: (sel[0] ?? 0) * beatsPerMeasure(store.score), metronome: true,
        onPitch: (m, lvl) => { capLive.hidden = false; capLive.textContent = m === null ? "· · ·" : `${SOLFEGE[m % 12]}${Math.floor(m / 12) - 1}`; capLive.style.setProperty("--lvl", String(lvl)); } });
      recB.classList.add("recording"); recB.textContent = cap.midi ? "■ Parar (teclado MIDI)" : "■ Parar captura";
      toast(cap.midi ? "Teclado MIDI conectado: toque e a pauta é escrita na hora" : "Conto 1 compasso… depois cante ou toque: a pauta é escrita em tempo real", "info", 4500);
    } catch (e: any) { toast("Microfone indisponível: " + e.message, "error"); cap = null; }
  }
  void toggleRec;
  async function toggleRec() {
    if (rec) {
      clearInterval(recTimer);
      const blob = await rec.stop(); rec = null;
      recB.classList.remove("recording"); recB.textContent = "🎙 Gravar ao vivo";
      await load(new File([blob], `gravacao-${new Date().toISOString().slice(11, 19).replace(/:/g, "")}.webm`, { type: blob.type || "audio/webm" }));
      toast("Gravação pronta: ouça, recorte e transcreva", "ok");
      return;
    }
    try {
      audio.stop();
      rec = await audio.record({ countInBeats: 0, spb: 0.5 });
      recT0 = performance.now(); recB.classList.add("recording");
      const tick = () => { const t = (performance.now() - recT0) / 1000; recB.textContent = `■ Parar (${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")})`; };
      tick(); recTimer = window.setInterval(tick, 500);
    } catch (e: any) { toast("Microfone indisponível: " + e.message, "error"); rec = null; }
  }

  addEventListener("import:inject", (e: Event) => { const d = (e as CustomEvent).detail; if (d.kind === "audio") load(d.file); });
  async function load(f: File) {
    file = f;
    try { buf = await audio.decode(f); } catch { toast("Não foi possível ler este áudio", "error"); return; }
    if (audio.playerState().source?.id === SRC_ID) audio.stop();
    a = 0; b = buf.duration; ph = -1; editor.hidden = false; drop.hidden = true; setTransport(true);
    go.disabled = false; go.removeAttribute("title"); viewB.hidden = true; dragB.hidden = false; markB.hidden = false; result.replaceChildren();
    regions = []; regN = 0; drawRegions(); draw();
  }
  function draw() {
    if (!buf) return;
    const ctx = cv.getContext("2d")!; const W = cv.width, H = cv.height;
    ctx.clearRect(0, 0, W, H);
    const pk = audio.peaks(buf, W / 3);
    pk.forEach((v, i) => {
      const x = i * 3, t = (x / W) * buf!.duration;
      ctx.fillStyle = t >= a && t <= b ? "#7c5cff" : "rgba(140,140,170,.35)";
      const hh = Math.max(2, v * H * 0.9); ctx.fillRect(x, (H - hh) / 2, 2, hh);
    });
    regions.forEach((r, i) => { // trechos marcados: faixa colorida no rodapé da onda
      const x0 = (r.a / buf!.duration) * W, x1 = (r.b / buf!.duration) * W;
      ctx.fillStyle = ["#ff8a4c", "#3d7bff", "#17a589", "#e5487f", "#8e44ad", "#f39c12"][i % 6];
      ctx.globalAlpha = 0.25; ctx.fillRect(x0, 0, x1 - x0, H); ctx.globalAlpha = 1; ctx.fillRect(x0, H - 14, x1 - x0, 14);
      ctx.fillStyle = "#fff"; ctx.font = "bold 11px system-ui"; ctx.fillText("T" + r.n, x0 + 4, H - 3);
    });
    for (const t of [a, b]) { const x = (t / buf.duration) * W; ctx.fillStyle = "#ff5d8f"; ctx.fillRect(x - 2, 0, 4, H); ctx.beginPath(); ctx.arc(x, 8, 7, 0, 7); ctx.fill(); }
    if (ph >= 0) { // ponteiro de reprodução
      const x = (ph / buf.duration) * W;
      ctx.fillStyle = "#1db954"; ctx.fillRect(x - 1.5, 0, 3, H);
      ctx.beginPath(); ctx.moveTo(x - 8, H); ctx.lineTo(x + 8, H); ctx.lineTo(x, H - 12); ctx.fill();
    }
    clock.textContent = `${fmt(Math.max(0, ph))} / ${fmt(buf.duration)}`;
    info.textContent = `${file?.name} · trecho ${a.toFixed(2)}s → ${b.toFixed(2)}s (${(b - a).toFixed(1)}s de ${buf.duration.toFixed(1)}s) · alças rosa recortam · clique ou arraste na onda para mover o ponteiro verde`;
  }
  cv.addEventListener("pointerdown", (e) => {
    if (!buf) return;
    const r = cv.getBoundingClientRect();
    const tAt = (ev: PointerEvent) => Math.max(0, Math.min(buf!.duration, ((ev.clientX - r.left) / r.width) * buf!.duration));
    const pxOf = (t: number) => r.left + (t / buf!.duration) * r.width;
    const t0 = tAt(e);
    // perto de uma alça rosa (≤ 12 px): recorta; senão: move o ponteiro de reprodução (e a faixa segue dali se estiver tocando)
    const near = (t: number) => Math.abs(e.clientX - pxOf(t)) <= 12;
    const which = near(a) && (!near(b) || Math.abs(t0 - a) <= Math.abs(t0 - b)) ? "a" : near(b) ? "b" : "seek";
    cv.setPointerCapture(e.pointerId);
    const mv = (ev: PointerEvent) => {
      const t = tAt(ev);
      if (which === "a") a = Math.min(t, b - 0.2); else if (which === "b") b = Math.max(t, a + 0.2);
      else { ph = Math.max(a, Math.min(b, t)); if (mine() && audio.isPlaying()) dragging = true; }
      draw();
    };
    let dragging = false;
    mv(e);
    if (which === "seek") {
      const fin = () => { cv.removeEventListener("pointerup", fin); seekTo(ph); };
      cv.addEventListener("pointerup", fin);
    }
    const up = () => { cv.removeEventListener("pointermove", mv); cv.removeEventListener("pointerup", up); };
    cv.addEventListener("pointermove", mv); cv.addEventListener("pointerup", up);
  });
  const fmt = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
  const mine = () => audio.playerState().source?.id === SRC_ID;
  const source = () => ({ id: SRC_ID, label: `Importar — ${file?.name ?? "faixa"}`, icon: "🎵", focus: () => dispatchEvent(new CustomEvent("open-app", { detail: "import" })) });
  /** Toca o trecho recortado [a, b] a partir de `t` (segundos da faixa). */
  function startAt(t: number) {
    if (!buf) return;
    audio.playBuffer(buf, { rangeStart: a, from: Math.max(a, Math.min(b - 0.05, t)), to: b, gainDb: +gain.value, source: source() });
  }
  function togglePlay() {
    if (!buf) return;
    const st = audio.playerState();
    if (mine() && st.playing) { audio.pause(); return; }
    if (mine() && st.paused) { audio.resume(); return; }
    startAt(ph >= a && ph < b - 0.05 ? ph : a);
  }
  function seekTo(t: number) {
    if (!buf) return;
    ph = Math.max(a, Math.min(b, t));
    if (mine() && audio.isPlaying()) audio.seek(ph - a); else if (mine()) audio.seek(ph - a);
    draw();
  }
  function jump(d: number) { if (!buf) return; const cur = ph >= 0 ? ph : a; seekTo(cur + d); if (!mine() || !audio.isPlaying()) startAt(ph); }
  // acompanha o player universal (ele também pode pausar/parar esta faixa)
  let raf = 0;
  const follow = () => {
    const st = audio.playerState();
    if (mine()) { ph = a + st.pos; playB.textContent = st.playing ? "⏸ Pausar" : "▶ Continuar"; }
    else playB.textContent = "▶ Ouvir trecho";
    draw();
    if (mine() && st.playing) raf = requestAnimationFrame(follow);
  };
  audio.onPlayer(() => { cancelAnimationFrame(raf); raf = requestAnimationFrame(follow); });
  go.addEventListener("click", async () => {
    if (!buf) return;
    busy(go, true, "Preparando o trecho…");
    try {
      let path = "";
      const openViz = () => (dispatchEvent(new CustomEvent("open-app", { detail: "compose" })), setTimeout(() => dispatchEvent(new CustomEvent("harmonia:action", { detail: "viz-open" })), 300));
      const r = await transcribeBuffer(buf, { name: file?.name ?? "áudio", a, b, gainDb: +gain.value, mode: mode.value as any, separate: sep.checked, lyrics: lyr.checked, notes: polySel.value as any, orchestra: orch.checked,
        expected_lyrics: expected.value || undefined, tempo: tempo.value ? +tempo.value : undefined, fixedTempo: !!tempo.value, timeSig: store.score.timeSig,
        onProgress: (pct, label) => busy(go, true, `${label} · ${Math.round(pct)}%`), onUploaded: (p) => (path = p), open: openViz, retry: () => go.click() });
      // a faixa original entra junto como camada 🎙 (para comparar com a transcrição no visualizador)
      const spb = 60 / (r.tempo || store.score.tempo);
      const bpm = beatsPerMeasure(store.score);
      const nMeas = Math.max(1, Math.ceil((b - a) / spb / bpm));
      const orig: any = { ...newLayer("recording", `Original: ${file?.name ?? "faixa"}`), audioOffset: 0, audioDur: b - a, measures: Array.from({ length: nMeas }, (_, i) => i), notes: [] };
      if (path) orig.audio = path; else orig.audioUrl = URL.createObjectURL(await audio.trimToWav(buf, a, b, +gain.value));
      r.layers = [...(r.layers || []), orig];
      // gravação original + notas transcritas ficam vinculadas 🔗: movem, mostram e ocultam juntas
      const link = uid(); r.layers.forEach((l: any) => (l.link = link));
      deliver(r, "Transcrição do áudio", false);
      showResult(r);
      viewB.hidden = false;
      openViz();
    } catch (e: any) { toast(e.message, "error"); }
    finally { busy(go, false); }
  });
  function showResult(r: any) {
    result.replaceChildren(h("h4", {}, "Resultado"),
      h("ul", {}, ...r.layers.map((l: any) => h("li", {}, `${l.name}: ${l.notes.length} notas`))),
      r.lyricsCheck ? h("div", { class: "lyrics-check" },
        h("b", {}, `Conferência da letra: ${Math.round(r.lyricsCheck.similarity * 100)}% de correspondência`),
        ...r.lyricsCheck.diffs.slice(0, 20).map((d: any) => h("div", { class: "diff" }, h("del", {}, d.heard || "∅"), " → ", h("ins", {}, d.expected || "∅")))) : "");
  }
  return p;
}

// ----------------------------------------------------------------- IMAGEM
function imagePane() {
  const p = h("div");
  const cv = h("canvas", { class: "crop" }) as HTMLCanvasElement;
  let img: HTMLImageElement | null = null; let file: File | null = null; let rot = 0;
  let crop = { x: 0.03, y: 0.03, w: 0.94, h: 0.94 };
  const go = h("button", { class: "btn primary go", disabled: true, title: "Envie uma imagem primeiro" }, "✨ Ler partitura (OMR)") as HTMLButtonElement;
  const fileIn = h("input", { type: "file", accept: "image/*", hidden: true, onchange: (e: Event) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) load(f); } }) as HTMLInputElement;
  const camIn = h("input", { type: "file", accept: "image/*", capture: "environment", hidden: true, onchange: (e: Event) => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) load(f); } }) as HTMLInputElement;
  const rotB = h("button", { class: "btn", disabled: true, onclick: () => { rot = (rot + 90) % 360; draw(); } }, "⟳ Girar") as HTMLButtonElement;
  const allB = h("button", { class: "btn ghost", disabled: true, onclick: () => { crop = { x: 0, y: 0, w: 1, h: 1 }; draw(); } }, "⤢ Sem recorte") as HTMLButtonElement;
  const melOnly = h("input", { type: "checkbox", checked: prefs.captureMode === "melody" }) as HTMLInputElement;
  melOnly.addEventListener("change", () => (prefs.captureMode = melOnly.checked ? "melody" : "both"));
  const bar = h("div", { class: "imp-bar" },
    h("div", { class: "imp-row" },
      tip(h("button", { class: "btn", onclick: () => fileIn.click() }, "📂 Imagem"), "Foto ou scan (PNG, JPG, WEBP) — ou arraste para a área abaixo"),
      tip(h("button", { class: "btn", onclick: () => camIn.click() }, "📷 Câmera"), "Fotografar agora (no celular abre a câmera)"),
      h("i", { class: "imp-sep" }), rotB, allB,
      tip(h("label", { class: "check" }, melOnly, " Só a melodia"), "Lê só a pauta de cima (você harmoniza depois)"),
      h("span", { class: "spacer" }), go),
    h("div", { class: "imp-row opts hint" }, "Arraste sobre a imagem para marcar só a área com as pautas. Fotos retas, com boa luz, uma página por vez."));
  // revisão da leitura (OMR): a leitura da IA aparece SOBREPOSTA à imagem e numa lista por compasso;
  // dá para corrigir altura e acidentes, apagar notas e escolher só os compassos que entram na pauta.
  const ovl = h("div", { class: "omr-overlay", hidden: true, "aria-hidden": "true" });
  const stage = h("div", { class: "crop-stage", hidden: true }, h("div", { class: "omr-wrap" }, cv, ovl));
  const reviewBox = h("div", { class: "omr-review", hidden: true });
  const drop = dropZone("image/*", "Arraste a foto ou o scan da partitura aqui", load);
  p.classList.add("imp-pane");
  p.append(fileIn, camIn, bar, drop, stage, reviewBox);

  addEventListener("import:inject", (e: Event) => { const d = (e as CustomEvent).detail; if (d.kind === "image") load(d.file); });
  function load(f: File) {
    file = f; const u = URL.createObjectURL(f);
    img = new Image(); img.onload = () => { stage.hidden = false; drop.hidden = true; rotB.disabled = allB.disabled = go.disabled = false; go.removeAttribute("title"); draw(); }; img.src = u;
  }
  function draw() {
    if (!img) return;
    const sw = rot % 180 ? img.height : img.width, sh = rot % 180 ? img.width : img.height;
    const scale = Math.min(860 / sw, 520 / sh);
    cv.width = sw * scale; cv.height = sh * scale;
    const c = cv.getContext("2d")!;
    c.save(); c.translate(cv.width / 2, cv.height / 2); c.rotate((rot * Math.PI) / 180);
    c.drawImage(img, (-img.width * scale) / 2, (-img.height * scale) / 2, img.width * scale, img.height * scale); c.restore();
    c.fillStyle = "rgba(10,10,30,.5)";
    const X = crop.x * cv.width, Y = crop.y * cv.height, W = crop.w * cv.width, H = crop.h * cv.height;
    c.fillRect(0, 0, cv.width, Y); c.fillRect(0, Y + H, cv.width, cv.height - Y - H); c.fillRect(0, Y, X, H); c.fillRect(X + W, Y, cv.width - X - W, H);
    c.strokeStyle = "#ff5d8f"; c.lineWidth = 2; c.setLineDash([6, 4]); c.strokeRect(X, Y, W, H);
  }
  cv.addEventListener("pointerdown", (e) => {
    const r = cv.getBoundingClientRect();
    const fx = (ev: PointerEvent) => Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width));
    const fy = (ev: PointerEvent) => Math.max(0, Math.min(1, (ev.clientY - r.top) / r.height));
    const x0 = fx(e), y0 = fy(e);
    cv.setPointerCapture(e.pointerId);
    const mv = (ev: PointerEvent) => { const x1 = fx(ev), y1 = fy(ev); crop = { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.max(0.05, Math.abs(x1 - x0)), h: Math.max(0.05, Math.abs(y1 - y0)) }; draw(); };
    const up = () => { cv.removeEventListener("pointermove", mv); cv.removeEventListener("pointerup", up); };
    cv.addEventListener("pointermove", mv); cv.addEventListener("pointerup", up);
  });
  go.addEventListener("click", async () => {
    if (!img || !file || !requireLogin()) return;
    busy(go, true, "Recortando e enviando…");
    try {
      // aplica rotação + recorte localmente (envia só a área útil — menos dados, mais privacidade)
      const full = document.createElement("canvas");
      const sw = rot % 180 ? img.height : img.width, sh = rot % 180 ? img.width : img.height;
      full.width = crop.w * sw; full.height = crop.h * sh;
      const c = full.getContext("2d")!;
      c.translate(-crop.x * sw, -crop.y * sh); c.translate(sw / 2, sh / 2); c.rotate((rot * Math.PI) / 180);
      c.drawImage(img, -img.width / 2, -img.height / 2);
      const melodyOnly = prefs.captureMode === "melody";
      const task = startTask("transcribe_image", `Leitura — ${file?.name ?? "partitura"}`);
      const openC = () => dispatchEvent(new CustomEvent("open-app", { detail: "compose" }));
      let r: any = null;
      // 1º o OMR completo do servidor (se instalado); se faltar ou falhar, a IA com visão lê a imagem
      const full_ai = await fetch("/api/health").then((x) => x.json()).then((hc) => !!hc.ai_full).catch(() => false);
      if (full_ai) {
        try {
          const blob: Blob = await new Promise((res) => full.toBlob((bb) => res(bb!), "image/png"));
          const up = await upload("image", blob, "partitura.png", task);
          busy(go, true, "Lendo a partitura…");
          r = await runJob("transcribe_image", { asset: up.path }, (_s, info) => busy(go, true, `${info.label} · ${Math.round(info.pct)}%`), { task, open: openC, retry: () => go.click(), noWorkerAfter: 8 });
        } catch (e: any) { if (/cancelad/i.test(e.message)) throw e; r = null; }
      }
      if (!r) r = await visionOmr(full, melodyOnly, task, (t) => busy(go, true, t));
      r.open = openC;
      if (prefs.captureMode === "melody") { r.layers = (r.layers || []).filter((l: any) => l.staff !== "bass"); r.chords = []; }
      review(r);
    } catch (e: any) { toast(e.message, "error"); }
    finally { busy(go, false); }
  });

  function review(r: any) {
    const num = r.timeSig?.[0] ?? 4, den = r.timeSig?.[1] ?? 4, bpm = (num * 4) / den;
    const res = JSON.parse(JSON.stringify(r));
    const nMeas = Math.max(1, r.measures || 1);
    const include = new Set<number>([...Array(nMeas).keys()]);
    const NAMES_SHARP = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0];
    const name = (p: number) => `${SOLFEGE[p % 12]}${Math.floor(p / 12) - 1}`;
    const durName = (d: number) => d >= 4 ? "𝅝" : d >= 2 ? "𝅗𝅥" : d >= 1 ? "♩" : d >= 0.5 ? "♪" : "𝅘𝅥𝅯";
    const notesIn = (m: number) => res.layers.flatMap((l: any) => l.notes.filter((n: any) => Math.floor(n.start / bpm + 1e-9) === m).map((n: any) => ({ n, l })))
      .sort((x: any, y: any) => x.n.start - y.n.start || y.n.pitch - x.n.pitch);
    const opacity = h("input", { type: "range", min: 0, max: 1, step: 0.05, value: 0.85, "aria-label": "Transparência da leitura sobreposta",
      oninput: (e: Event) => ovl.style.setProperty("--o", (e.target as HTMLInputElement).value) }) as HTMLInputElement;
    const showOv = h("input", { type: "checkbox", checked: true, onchange: () => (ovl.hidden = !showOv.checked) }) as HTMLInputElement;
    const drawOverlay = () => {
      // grade aproximada: compassos distribuídos sobre a área recortada (4 por linha)
      const per = Math.min(4, nMeas), rows = Math.ceil(nMeas / per);
      ovl.style.setProperty("--per", String(per)); ovl.style.setProperty("--rows", String(rows));
      ovl.replaceChildren(...[...Array(nMeas).keys()].map((m) => h("div", { class: "ov-cell" + (include.has(m) ? "" : " off") },
        h("small", {}, String(m + 1)), h("div", {}, ...notesIn(m).map(({ n, l }: any) => h("span", { class: l.staff === "bass" ? "ov-n bass" : "ov-n" }, name(n.pitch).replace(/\d$/, "") + durName(n.dur)))))));
      ovl.hidden = !showOv.checked;
    };
    const draw = () => {
      drawOverlay();
      reviewBox.hidden = false;
      reviewBox.replaceChildren(
        h("div", { class: "omr-head" }, h("b", {}, "Revise a leitura antes de levar para a pauta"),
          h("label", { class: "check" }, showOv, " Sobrepor à imagem"), h("label", { class: "inline" }, "opacidade ", opacity),
          h("button", { class: "btn ghost", onclick: () => { [...Array(nMeas).keys()].forEach((m) => include.add(m)); draw(); } }, "Todos"),
          h("button", { class: "btn ghost", onclick: () => { include.clear(); draw(); } }, "Nenhum"),
          h("button", { class: "btn primary go", disabled: !include.size, onclick: () => commit() }, `✓ Agregar ${include.size} compasso(s) à pauta`)),
        h("p", { class: "hint" }, "Compare cada compasso com a imagem. ▲▼ sobem/descem meio tom, ♯ ♭ ♮ corrigem o acidente, ✕ remove a nota. Desmarque os compassos que não quer importar."),
        h("div", { class: "omr-measures" }, ...[...Array(nMeas).keys()].map((m) => {
          const ns = notesIn(m);
          return h("div", { class: "omr-m" + (include.has(m) ? "" : " off") },
            h("header", {}, h("label", { class: "check" }, h("input", { type: "checkbox", checked: include.has(m), onchange: (e: Event) => { (e.target as HTMLInputElement).checked ? include.add(m) : include.delete(m); draw(); } }), ` Compasso ${m + 1}`),
              h("button", { class: "reg-btn", "aria-label": `Ouvir compasso ${m + 1}`, onclick: () => ns.forEach(({ n }: any) => audio.playNote(n.pitch, audio.ac().currentTime + 0.05 + (n.start - m * bpm) * 0.5, Math.min(1.5, n.dur * 0.5))) }, "▶")),
            ns.length ? h("div", { class: "omr-notes" }, ...ns.map(({ n, l }: any) => {
              const set = (p: number) => { n.pitch = Math.max(21, Math.min(108, p)); audio.playNote(n.pitch, 0, 0.4); draw(); };
              return h("span", { class: "omr-n" + (l.staff === "bass" ? " bass" : "") },
                h("b", {}, name(n.pitch)), h("small", {}, durName(n.dur)),
                h("button", { "aria-label": "Meio tom acima", onclick: () => set(n.pitch + 1) }, "▲"), h("button", { "aria-label": "Meio tom abaixo", onclick: () => set(n.pitch - 1) }, "▼"),
                h("button", { "aria-label": "Sustenido", onclick: () => set(NAMES_SHARP[n.pitch % 12] ? n.pitch : n.pitch + 1) }, "♯"),
                h("button", { "aria-label": "Bemol", onclick: () => set(NAMES_SHARP[n.pitch % 12] ? n.pitch : n.pitch - 1) }, "♭"),
                h("button", { "aria-label": "Natural (sem acidente)", onclick: () => set(NAMES_SHARP[n.pitch % 12] ? n.pitch - 1 : n.pitch) }, "♮"),
                h("button", { "aria-label": "Remover nota", onclick: () => { l.notes = l.notes.filter((x: any) => x !== n); draw(); } }, "✕"));
            })) : h("small", { class: "hint" }, "pausa / sem notas"));
        })));
    };
    function commit() {
      const ms = [...include].sort((x, y) => x - y);
      if (!ms.length) return;
      const target = [...store.selectedMeasures].sort((x, y) => x - y)[0];
      const shift = target !== undefined ? (target - ms[0]) * bpm : 0;
      const out = { ...res, layers: res.layers.map((l: any) => ({ ...l, notes: l.notes.filter((n: any) => include.has(Math.floor(n.start / bpm + 1e-9))).map((n: any) => ({ ...n, start: n.start + shift })) })).filter((l: any) => l.notes.length),
        chords: [] as any[] };
      (res.chords || []).forEach((cell: any, m: number) => { if (include.has(m)) out.chords[m + Math.round(shift / bpm)] = cell; });
      out.measures = Math.max(...ms) + 1 + Math.round(shift / bpm);
      deliver(out, `Leitura da partitura (${ms.length} compasso(s))`);
      reviewBox.hidden = true; ovl.hidden = true;
    }
    draw();
    toast("Leitura pronta: confira a sobreposição, corrija o que precisar e escolha os compassos", "info", 6000);
  }
  return p;
}

// ------------------------------------------------------------------ CIFRA
function cifraPane() {
  addEventListener("import:inject", (e: Event) => { const d = (e as CustomEvent).detail; if (d.kind === "cifra") { ta.value = d.text; ta.dispatchEvent(new Event("input")); ta.focus(); } });
  const ta = h("textarea", { rows: 9, class: "mono", placeholder: "[Intro]\n| C | Am | F | G7 |\n\nC            Am\nEu sei que vou te amar\nF           G7\nPor toda a minha vida" }) as HTMLTextAreaElement;
  const style = h("select", {}, h("option", { value: "block" }, "Acordes em bloco"), h("option", { value: "arpeggio" }, "Arpejo"), h("option", { value: "alberti" }, "Baixo de Alberti"), h("option", { value: "bass-chord" }, "Baixo + acorde")) as HTMLSelectElement;
  const perLine = h("select", {}, h("option", { value: 1 }, "1 acorde por compasso"), h("option", { value: 2 }, "2 acordes por compasso")) as HTMLSelectElement;
  const preview = h("div", { class: "chord-preview", "data-noi18n": "" });
  const go = h("button", { class: "btn primary go" }, "✨ Transcrever cifra para partitura") as HTMLButtonElement;
  ta.addEventListener("input", () => {
    const bars = parseCifraBars(ta.value.split("\n").filter((l) => /^[\s|A-G#bm0-9()/°º+\-susadijM]+$/.test(l)).join(" | "), beatsPerMeasure(store.score));
    preview.replaceChildren(...bars.map((cell, i) => h("span", { class: "chip" }, h("small", {}, String(i + 1)), cell.map((c) => c.symbol).join(" "))));
  });
  go.addEventListener("click", async () => {
    if (!ta.value.trim()) return;
    busy(go, true, "Interpretando…");
    try {
      if (currentUser) {
        const r = await runJob("parse_cifra", { text: ta.value, timeSig: store.score.timeSig, style: style.value, chords_per_measure: +perLine.value });
        deliver(r, "Cifra");
        if (r.lyricsSyllables?.length) toast(`Letra detectada (${r.lyricsSyllables.length} sílabas). Use "Letra → notas" nas Camadas após escrever a melodia.`, "info", 6000);
      } else {
        const bpm = beatsPerMeasure(store.score);
        const chords = parseCifraBars(ta.value, bpm);
        const l = newLayer("harmony", "Harmonia (cifra)", "bass"); l.notes = voiceChords(chords, bpm, style.value);
        deliver({ chords, layers: [l], measures: chords.length }, "Cifra");
      }
    } catch (e: any) { toast(e.message, "error"); }
    finally { busy(go, false); }
  });
  return h("div", { class: "imp-pane" },
    h("div", { class: "imp-bar" }, h("div", { class: "imp-row" }, h("label", { class: "inline" }, "Acompanhamento ", style), perLine, h("span", { class: "spacer" }), go)),
    ta, preview,
    h("p", { class: "hint" }, "Formatos aceitos: barras (| C | Am |), cifra sobre a letra, solfejo (Ré m), extensões (7M, m7(b5), 7(9), sus4, °, /baixo) e % para repetir o compasso."));
}
