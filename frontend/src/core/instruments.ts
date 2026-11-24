// Instrumentos: clave correspondente, programa General MIDI (exportação) e timbre de síntese (reprodução).
import type { Clef } from "./types";

export type Timbre = "piano" | "strings" | "winds" | "brass" | "plucked" | "organ" | "voice" | "reed";
export interface Instrument { id: string; name: string; icon: string; clef: Clef; grand?: boolean; program: number; timbre: Timbre; range: [number, number]; }

export const INSTRUMENTS: Instrument[] = [
  { id: "piano", name: "Piano", icon: "🎹", clef: "G", grand: true, program: 0, timbre: "piano", range: [21, 108] },
  { id: "organ", name: "Órgão", icon: "🎛", clef: "G", grand: true, program: 19, timbre: "organ", range: [36, 96] },
  { id: "harp", name: "Harpa", icon: "🪕", clef: "G", grand: true, program: 46, timbre: "plucked", range: [24, 103] },
  { id: "voice-s", name: "Voz (soprano/contralto)", icon: "🎤", clef: "G", program: 52, timbre: "voice", range: [53, 81] },
  { id: "voice-t", name: "Voz (tenor/baixo)", icon: "🎙", clef: "F", program: 52, timbre: "voice", range: [40, 67] },
  { id: "violin", name: "Violino", icon: "🎻", clef: "G", program: 40, timbre: "strings", range: [55, 100] },
  { id: "viola", name: "Viola de arco", icon: "🎻", clef: "C", program: 41, timbre: "strings", range: [48, 88] },
  { id: "cello", name: "Violoncelo", icon: "🎻", clef: "F", program: 42, timbre: "strings", range: [36, 76] },
  { id: "contrabass", name: "Contrabaixo acústico", icon: "🎻", clef: "F", program: 43, timbre: "strings", range: [28, 67] },
  { id: "flute", name: "Flauta", icon: "🪈", clef: "G", program: 73, timbre: "winds", range: [60, 96] },
  { id: "oboe", name: "Oboé", icon: "🪈", clef: "G", program: 68, timbre: "reed", range: [58, 91] },
  { id: "clarinet", name: "Clarinete", icon: "🪈", clef: "G", program: 71, timbre: "reed", range: [50, 91] },
  { id: "sax", name: "Saxofone alto", icon: "🎷", clef: "G", program: 65, timbre: "reed", range: [49, 81] },
  { id: "bassoon", name: "Fagote", icon: "🪈", clef: "F", program: 70, timbre: "reed", range: [34, 75] },
  { id: "trumpet", name: "Trompete", icon: "🎺", clef: "G", program: 56, timbre: "brass", range: [54, 84] },
  { id: "trombone", name: "Trombone", icon: "🎺", clef: "F", program: 57, timbre: "brass", range: [40, 72] },
  { id: "tuba", name: "Tuba", icon: "🎺", clef: "F", program: 58, timbre: "brass", range: [28, 58] },
  { id: "guitar", name: "Violão", icon: "🎸", clef: "G", program: 24, timbre: "plucked", range: [40, 84] },
  { id: "eguitar", name: "Guitarra", icon: "🎸", clef: "G", program: 27, timbre: "plucked", range: [40, 88] },
  { id: "ebass", name: "Baixo elétrico", icon: "🎸", clef: "F", program: 33, timbre: "plucked", range: [28, 67] },
];
export const instrument = (id?: string) => INSTRUMENTS.find((i) => i.id === id) || INSTRUMENTS[0];
