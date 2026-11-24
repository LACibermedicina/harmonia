// Contrato do Score JSON — idêntico ao usado pela API e pelo ai-worker.
export interface Note {
  id: string;
  pitch: number; // MIDI
  start: number; // em tempos (semínimas)
  dur: number;
  vel?: number;
  lyric?: string | null;
  effect?: string | null; // vibrato | glissando | falsetto | staccato | fermata
}

export type LayerKind = "melody" | "harmony" | "voice" | "bass" | "omr" | "recording";

export interface Layer {
  id: string;
  name: string;
  kind: LayerKind;
  staff: "treble" | "bass";
  notes: Note[];
  visible: boolean;
  muted: boolean;
  solo: boolean;
  locked: boolean;
  volume: number;
  color: string;
  program?: number;
  audio?: string; // gravação/stem (caminho de mídia)
  audioUrl?: string; // blob local antes do upload
  audioOffset?: number; // segundos
  measures?: number[]; // trecho que a gravação cobre
  group?: string;      // id do grupo de camadas
  audioDur?: number;   // duração da gravação (s) — desenha o clipe contínuo na pauta
  link?: string;       // camadas vinculadas (ex.: gravação ↔ notas transcritas) movem-se juntas
  unlinked?: boolean;  // vínculo aberto (corrente aberta no painel de Camadas)
  instrument?: string; // instrumento próprio da camada (multi-instrumentos) — timbre e extensão
  live?: boolean;      // notas capturadas em tempo real (microfone/MIDI) — cor e selo próprios
}

export interface ChordEv {
  beat: number;
  dur: number;
  root: number;
  quality: string;
  bass?: number | null;
  symbol: string;
  extensions?: string[];
}

export interface Annotation {
  id: string;
  measure: number;
  beat: number;
  text: string;
  color: string;
  layerId?: string;
}

export type Clef = "G" | "F" | "C";
export interface StaffCfg { clef: Clef; visible: boolean; instrument?: string; }
/** Mão (pauta) em edição: direita = superior, esquerda = inferior, ambas = as duas ao mesmo tempo. */
export type Hand = "both" | "upper" | "lower";

export interface Score {
  title: string;
  tempo: number;
  timeSig: [number, number];
  keySig: number; // quintas
  measures: number;
  layers: Layer[];
  chords: ChordEv[][];
  annotations: Annotation[];
  staves?: { upper: StaffCfg; lower: StaffCfg }; // pauta superior (camadas "treble") e inferior ("bass")
  layerGroups?: LayerGroup[];
  /** compassos: repetir os atuais (loop) ao gravar, infinitos (a pauta cresce) ou com limite */
  measureMode?: "loop" | "infinite" | "limit";
  measureLimit?: number;
}

export interface LayerGroup { id: string; name: string; collapsed?: boolean; color?: string; }

export function staves(s: Score) {
  const st = s.staves || { upper: { clef: "G", visible: true }, lower: { clef: "F", visible: true } };
  if (!st.upper.visible && !st.lower.visible) st.upper.visible = true;
  return st as { upper: StaffCfg; lower: StaffCfg };
}

export const uid = () => Math.random().toString(36).slice(2, 12);
export const beatsPerMeasure = (s: Score) => (s.timeSig[0] * 4) / s.timeSig[1];
