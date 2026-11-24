// Estado da composição aberta com desfazer/refazer e eventos.
import { Score, Layer, uid, LayerKind, Hand } from "./types";

type Listener = (reason: string) => void;

const LAYER_COLORS: Record<LayerKind, string> = {
  melody: "#ff6b9a", harmony: "#5b8cff", voice: "#ffb547", bass: "#36c99a", omr: "#a77bff", recording: "#ff8a4c",
};

// eslint-disable-next-line prefer-const
let storeRef: { score: Score } | null = null;
// Paleta de cores bem distintas entre si: cada camada nova recebe uma cor ainda não usada
export const LAYER_PALETTE = ["#e5487f", "#3d7bff", "#f39c12", "#17a589", "#8e44ad", "#e4572e", "#2e86c1", "#c0392b", "#27ae60", "#d4ac0d", "#6c5ce7", "#00a8a8"];
export function nextLayerColor(preferred?: string): string {
  const used = new Set((storeRef?.score.layers ?? []).map((l) => l.color.toLowerCase()));
  if (preferred && !used.has(preferred.toLowerCase())) return preferred;
  return LAYER_PALETTE.find((c) => !used.has(c)) || LAYER_PALETTE[used.size % LAYER_PALETTE.length];
}

export function newLayer(kind: LayerKind, name: string, staff: "treble" | "bass" = "treble"): Layer {
  return { id: uid(), name, kind, staff, notes: [], visible: true, muted: false, solo: false, locked: false,
    volume: 0.8, color: nextLayerColor(LAYER_COLORS[kind]), program: 0 };
}

export function demoScore(): Score {
  const mel = newLayer("melody", "Melodia");
  const notes: [number, number, number, string?][] = [
    [67, 0, 1, "Se"], [72, 1, 1, "eu"], [71, 2, 1, "pu-"], [72, 3, 1, "des-"],
    [74, 4, 2, "se"], [72, 6, 1, "can-"], [71, 7, 1, "tar"],
    [69, 8, 1, "o"], [72, 9, 1, "teu"], [77, 10, 1.5, "no-"], [76, 11.5, 0.5, "me"],
    [74, 12, 3, "_"], [79, 15, 1, "e"],
    [76, 16, 2, "ou-"], [74, 18, 1, "vir"], [72, 19, 1, "a"],
    [74, 20, 1, "tua"], [71, 21, 1, "voz"], [67, 22, 2, "_"],
    [69, 24, 1, "no"], [71, 25, 1, "mar"], [72, 26, 2, "_"], [72, 28, 4, ""],
  ];
  mel.notes = notes.map(([pitch, start, dur, lyric]) => ({ id: uid(), pitch, start, dur, vel: 84, lyric: lyric || null }));
  return {
    title: "Canção do Mar (demo)", tempo: 92, timeSig: [4, 4], keySig: 0, measures: 8,
    layers: [mel], chords: Array.from({ length: 8 }, () => []),
    annotations: [{ id: uid(), measure: 0, beat: 0, text: "dolce, cantabile", color: "#ffb547" }],
  };
}

/** Partitura vazia para começar do zero: piano (Sol + Fá) com uma camada em cada pauta. */
export function emptyScore(title = "Nova composição", opts: { keySig?: number; timeSig?: [number, number]; tempo?: number; measures?: number } = {}): Score {
  const mel = newLayer("melody", "Melodia (mão direita)", "treble");
  const lh = newLayer("harmony", "Mão esquerda", "bass");
  return { title, tempo: opts.tempo ?? 96, timeSig: opts.timeSig ?? [4, 4], keySig: opts.keySig ?? 0, measures: opts.measures ?? 8,
    layers: [mel, lh], chords: Array.from({ length: opts.measures ?? 8 }, () => []), annotations: [],
    staves: { upper: { clef: "G", visible: true }, lower: { clef: "F", visible: true } }, layerGroups: [] };
}

class Store {
  score: Score = demoScore();
  compositionId: number | null = null;
  version = 1;
  selectedLayer: string | null = this.score.layers[0]?.id ?? null;
  selectedMeasures = new Set<number>();
  selectedNotes = new Set<string>();
  /** Cursor de leitura (em tempos): onde a reprodução parou ou o compasso escolhido — o "ao vivo" pode recomeçar daqui. */
  cursorBeat = 0;
  /** Cursor de leitura efetivo: o 1º compasso selecionado (se houver) ou onde a reprodução parou. */
  readCursor() {
    const bpm = (this.score.timeSig[0] * 4) / this.score.timeSig[1];
    if (this.selectedMeasures.size) return Math.min(...this.selectedMeasures) * bpm;
    return Math.min(this.cursorBeat, Math.max(0, (this.score.measures - 1) * bpm));
  }
  /** Mão em edição: "both" seleciona/edita as duas pautas ao mesmo tempo. */
  hand: Hand = "both";
  inHand(l: Layer) { return this.hand === "both" || (this.hand === "upper") === (l.staff !== "bass"); }
  private undo: string[] = [];
  private redo: string[] = [];
  private listeners = new Set<Listener>();

  on(fn: Listener) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(reason = "change") { this.listeners.forEach((l) => l(reason)); }

  /** Aplica mutação com snapshot para desfazer. */
  mutate(fn: (s: Score) => void, reason = "edit") {
    this.undo.push(JSON.stringify(this.score));
    if (this.undo.length > 200) this.undo.shift();
    this.redo = [];
    fn(this.score);
    this.ensureMeasures();
    this.emit(reason);
    scheduleSave();
  }
  undoOp() { const s = this.undo.pop(); if (!s) return; this.redo.push(JSON.stringify(this.score)); this.score = JSON.parse(s); this.emit("undo"); }
  redoOp() { const s = this.redo.pop(); if (!s) return; this.undo.push(JSON.stringify(this.score)); this.score = JSON.parse(s); this.emit("redo"); }

  /** Recomeça do zero (partitura vazia, sem vínculo com a composição salva). */
  startFromScratch(title?: string, opts?: Parameters<typeof emptyScore>[1]) {
    this.load(emptyScore(title, opts), null, 1);
  }

  load(score: Score, id: number | null = null, version = 1) {
    this.score = score; this.compositionId = id; this.version = version;
    this.undo = []; this.redo = [];
    this.selectedLayer = score.layers[0]?.id ?? null;
    this.selectedMeasures.clear(); this.selectedNotes.clear();
    this.ensureMeasures(); this.emit("load");
  }

  layer(id = this.selectedLayer) { return this.score.layers.find((l) => l.id === id) || null; }

  ensureMeasures() {
    const s = this.score;
    const bpm = (s.timeSig[0] * 4) / s.timeSig[1];
    let max = s.measures;
    for (const l of s.layers) for (const n of l.notes) max = Math.max(max, Math.floor((n.start + n.dur - 1e-6) / bpm) + 1);
    // gravações: os compassos vão até o FIM do áudio e as camadas vinculadas 🔗 herdam esse trecho
    const spb = 60 / s.tempo;
    for (const l of s.layers) {
      if (l.kind !== "recording" || !l.audioDur) continue;
      const b0 = (l.audioOffset || 0) / spb, b1 = b0 + l.audioDur / spb;
      const m0 = Math.floor(b0 / bpm + 1e-9), m1 = Math.max(m0, Math.ceil(b1 / bpm - 1e-6) - 1);
      l.measures = Array.from({ length: m1 - m0 + 1 }, (_, i) => m0 + i);
      max = Math.max(max, m1 + 1);
      if (l.link && !l.unlinked) for (const x of s.layers) if (x !== l && x.link === l.link && !x.unlinked) x.measures = [...l.measures];
    }
    s.measures = Math.max(1, max);
    if (s.measureMode === "limit" && s.measureLimit) s.measures = Math.min(s.measures, Math.max(1, s.measureLimit));
    while (s.chords.length < s.measures) s.chords.push([]);
  }

  /** Mescla resultado de IA (transcrição/cifra/harmonização) na composição aberta. */
  mergeResult(r: Partial<Score> & { layers?: Layer[]; chords?: any[][] }, opts: { replaceChordsIn?: number[] } = {}): string[] {
    const added: string[] = [];
    this.mutate((s) => {
      if (r.tempo) s.tempo = r.tempo;
      if (r.timeSig) s.timeSig = r.timeSig as [number, number];
      if (typeof r.keySig === "number") s.keySig = r.keySig;
      if (r.measures) s.measures = Math.max(s.measures, r.measures);
      for (const l of r.layers || []) {
        const nl = { ...newLayer(l.kind, l.name, l.staff), ...l, visible: true };
        nl.color = nextLayerColor(l.color); // garante cor única por camada
        if (s.layers.some((x) => x.id === nl.id)) nl.id = uid();
        nl.notes = (l.notes || []).map((n) => ({ ...n, id: n.id || uid() }));
        s.layers.push(nl); added.push(nl.id);
      }
      if (added.length) this.selectedLayer = added[0];
      if (r.chords) {
        r.chords.forEach((cell, m) => {
          if (!cell?.length) return;
          if (opts.replaceChordsIn && !opts.replaceChordsIn.includes(m)) return;
          s.chords[m] = cell;
        });
      }
    }, "merge");
    return added;
  }

  /** Camadas vinculadas 🔗 a `l` (mesma gravação), incluindo ela. */
  linkedWith(l: Layer): Layer[] { return l.link && !l.unlinked ? this.score.layers.filter((x) => x.link === l.link && !x.unlinked) : [l]; }

  /** Mostra/oculta a camada — e, se vinculada, a gravação e as notas transcritas dela juntas. */
  setVisible(l: Layer, v: boolean) {
    const ids = new Set(this.linkedWith(l).map((x) => x.id));
    this.mutate((s) => s.layers.forEach((x) => { if (ids.has(x.id)) x.visible = v; }), "layer");
    return ids.size;
  }

  /** Compassos ocupados por uma camada: as notas e, se ligada a uma gravação, o trecho todo dela. */
  layerMeasures(l: Layer): Set<number> {
    const bpm = (this.score.timeSig[0] * 4) / this.score.timeSig[1];
    const out = new Set<number>(l.measures || []);
    for (const n of l.notes) { const a = Math.floor(n.start / bpm + 1e-9), b = Math.floor((n.start + n.dur - 1e-6) / bpm); for (let m = a; m <= b; m++) out.add(m); }
    return out;
  }

  /** Camadas editáveis agora: visíveis, destravadas, de notas e da(s) mão(s) em edição. */
  editableLayers() { return this.score.layers.filter((l) => l.visible && !l.locked && l.kind !== "recording" && this.inHand(l)); }

  /** Seleciona todas as notas editáveis (e todos os compassos, para cópia/recorte/harmonização). */
  selectAll(withMeasures = false) {
    this.selectedNotes = new Set(this.editableLayers().flatMap((l) => l.notes.map((n) => n.id)));
    this.selectedMeasures = withMeasures ? new Set(Array.from({ length: this.score.measures }, (_, i) => i)) : new Set();
    this.emit("selection");
    return this.selectedNotes.size;
  }

  /** Exclui só o que está selecionado: as notas marcadas ou, sem notas, o conteúdo dos compassos marcados
   *  (notas das camadas editáveis + cifras desses compassos). Camadas com cadeado 🔒 nunca são tocadas. */
  deleteSelection(): { notes: number; chords: number; locked: number } {
    const bpm = (this.score.timeSig[0] * 4) / this.score.timeSig[1];
    const ms = new Set(this.selectedMeasures);
    const byNotes = this.selectedNotes.size > 0;
    if (!byNotes && !ms.size) return { notes: 0, chords: 0, locked: 0 };
    const hit = (n: { id: string; start: number }) => byNotes ? this.selectedNotes.has(n.id) : ms.has(Math.floor(n.start / bpm + 1e-9));
    let notes = 0, chords = 0, locked = 0;
    const editable = new Set(this.editableLayers().map((l) => l.id));
    this.mutate((s) => {
      for (const l of s.layers) {
        if (l.kind === "recording") continue;
        const k = l.notes.filter(hit).length; if (!k) continue;
        if (l.locked || (!byNotes && !editable.has(l.id))) { if (l.locked) locked += k; continue; }
        l.notes = l.notes.filter((n) => !hit(n)); notes += k;
      }
      if (!byNotes) for (const m of ms) if (s.chords[m]?.length) { chords += s.chords[m].length; s.chords[m] = []; }
    }, "delete-selection");
    this.selectedNotes.clear(); this.emit("selection");
    return { notes, chords, locked };
  }

  /** Apaga TODO o conteúdo editável (notas das camadas destravadas e todas as cifras). Ctrl+Z desfaz. */
  deleteAll(): { notes: number; chords: number; locked: number } {
    let notes = 0, chords = 0, locked = 0;
    this.mutate((s) => {
      for (const l of s.layers) {
        if (l.kind === "recording") continue;
        if (l.locked) { locked += l.notes.length; continue; }
        notes += l.notes.length; l.notes = [];
      }
      chords = s.chords.reduce((a, c) => a + (c?.length || 0), 0);
      s.chords = s.chords.map(() => []);
    }, "delete-all");
    this.selectedNotes.clear(); this.selectedMeasures.clear(); this.emit("selection");
    return { notes, chords, locked };
  }

  /** Copia ou recorta as notas selecionadas (ou o conteúdo dos compassos selecionados) para nova(s) camada(s).
   *  Cria uma camada por pauta de origem (Sol/Fá) para manter a notação coerente. */
  extractToNewLayer(mode: "copy" | "cut", source: "notes" | "measures"): { created: number; moved: number; skippedLocked: number } {
    const s = this.score;
    const bpm = (s.timeSig[0] * 4) / s.timeSig[1];
    const ms = [...this.selectedMeasures];
    const pick = (l: Layer) => l.notes.filter((n) => source === "notes" ? this.selectedNotes.has(n.id) : ms.includes(Math.floor(n.start / bpm + 1e-9)));
    const srcLayers = s.layers.filter((l) => l.kind !== "recording" && (source === "notes" || (l.visible && this.inHand(l))));
    let skippedLocked = 0;
    const byStaff: Record<string, { notes: typeof s.layers[0]["notes"]; from: string[] }> = {};
    for (const l of srcLayers) {
      const ns = pick(l);
      if (!ns.length) continue;
      if (mode === "cut" && l.locked) { skippedLocked += ns.length; continue; }
      (byStaff[l.staff] ||= { notes: [], from: [] }).notes.push(...ns);
      byStaff[l.staff].from.push(l.name);
    }
    const staffs = Object.keys(byStaff);
    if (!staffs.length) return { created: 0, moved: 0, skippedLocked };
    const range = source === "measures" ? ` (c.${Math.min(...ms) + 1}${ms.length > 1 ? "–" + (Math.max(...ms) + 1) : ""})` : "";
    let moved = 0;
    const newIds: string[] = [];
    this.mutate((sc) => {
      for (const st of staffs) {
        const g = byStaff[st];
        const ids = new Set(g.notes.map((n) => n.id));
        const from = [...new Set(g.from)];
        const nl = newLayer(st === "bass" ? "harmony" : "melody", `${mode === "cut" ? "Recorte" : "Cópia"} de ${from.length > 1 ? from.length + " camadas" : from[0]}${range}`, st as "treble" | "bass");
        nl.notes = g.notes.map((n) => ({ ...n, id: uid() }));
        if (mode === "cut") for (const l of sc.layers) if (!l.locked) l.notes = l.notes.filter((n) => !ids.has(n.id));
        sc.layers.push(nl); newIds.push(nl.id);
        moved += nl.notes.length;
      }
      this.selectedLayer = newIds[0];
      this.selectedMeasures.clear();
      this.selectedNotes = new Set(sc.layers.filter((l) => newIds.includes(l.id)).flatMap((l) => l.notes.map((n) => n.id)));
    }, "extract-layer");
    return { created: newIds.length, moved, skippedLocked };
  }

  /** Insere `count` compassos vazios antes do compasso `at` (at = measures → no final).
   *  Desloca notas, cifras, anotações, gravações e seleção; notas que cruzam o ponto são divididas. */
  insertMeasure(at: number, count = 1) {
    const s = this.score;
    const bpm = (s.timeSig[0] * 4) / s.timeSig[1];
    at = Math.max(0, Math.min(at, s.measures));
    const cut = at * bpm, shift = bpm * count;
    this.mutate((sc) => {
      for (const l of sc.layers) {
        const extra: typeof l.notes = [];
        for (const n of l.notes) {
          if (n.start >= cut - 1e-6) n.start += shift;
          else if (n.start + n.dur > cut + 1e-6) { // cruza a barra: divide em duas partes
            extra.push({ ...n, id: Math.random().toString(36).slice(2, 12), start: cut + shift, dur: n.start + n.dur - cut, lyric: null });
            n.dur = cut - n.start;
          }
        }
        l.notes.push(...extra);
        if (l.kind === "recording") {
          if (l.measures) l.measures = l.measures.map((m) => (m >= at ? m + count : m));
          if ((l.audioOffset || 0) >= cut * (60 / sc.tempo) - 1e-6) l.audioOffset = (l.audioOffset || 0) + shift * (60 / sc.tempo);
        }
      }
      while (sc.chords.length < sc.measures) sc.chords.push([]);
      sc.chords.splice(at, 0, ...Array.from({ length: count }, () => []));
      for (const a of sc.annotations) if (a.measure >= at) a.measure += count;
      sc.measures += count;
      this.selectedMeasures = new Set([...this.selectedMeasures].map((m) => (m >= at ? m + count : m)));
    }, "insert-measure");
  }

  /** Exclui os compassos indicados: remove o conteúdo e puxa o restante para trás. */
  deleteMeasures(list: number[]) {
    const s = this.score;
    const bpm = (s.timeSig[0] * 4) / s.timeSig[1];
    const del = [...new Set(list)].filter((m) => m >= 0 && m < s.measures).sort((a, b) => a - b);
    if (!del.length || del.length >= s.measures) return false;
    const removedBefore = (beat: number) => del.filter((m) => (m + 1) * bpm <= beat + 1e-6).length;
    const inDeleted = (beat: number) => del.includes(Math.floor(beat / bpm + 1e-9));
    this.mutate((sc) => {
      for (const l of sc.layers) {
        l.notes = l.notes.filter((n) => !inDeleted(n.start));
        for (const n of l.notes) {
          // nota que invadia um compasso excluído é encurtada até a barra (coordenadas originais)
          const bar = (Math.floor(n.start / bpm + 1e-9) + 1) * bpm;
          if (n.start + n.dur > bar + 1e-6 && inDeleted(bar)) n.dur = Math.max(0.25, bar - n.start);
          n.start -= removedBefore(n.start) * bpm;
        }
        if (l.measures) l.measures = l.measures.filter((m) => !del.includes(m)).map((m) => m - del.filter((d) => d < m).length);
      }
      sc.chords = sc.chords.filter((_, m) => !del.includes(m));
      sc.annotations = sc.annotations.filter((a) => !del.includes(a.measure)).map((a) => ({ ...a, measure: a.measure - del.filter((d) => d < a.measure).length }));
      sc.measures -= del.length;
      this.selectedMeasures.clear();
    }, "delete-measure");
    return true;
  }
}

export const store = new Store();
storeRef = store;

// Autosave com debounce (quando autenticado e com composição aberta)
let t: number | undefined;
function scheduleSave() {
  clearTimeout(t);
  t = window.setTimeout(() => store.emit("autosave"), 1500);
}
