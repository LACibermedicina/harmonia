// Ouvir o que a pessoa toca SEM escrever na partitura (usado no modo Aprender):
// microfone (várias notas ao mesmo tempo, com limpeza de ruído e sem o som do próprio app),
// teclado MIDI e o teclado do computador (A W S E D F T G Y H U J K = dó a dó).
import * as audio from "./audio";
import { makeSeparator } from "./tuner";
import { NoiseGate, frameVoices } from "./polypitch";
import { detectPitch } from "./livecapture";

export interface Heard { midis: number[]; level: number; source: "mic" | "midi" | "keys" }
const KEYS = "awsedftgyhujk";

export async function listen(cb: (h: Heard) => void, o: { mic?: boolean; poly?: boolean; octave?: number } = {}) {
  const c = audio.ac(); if (c.state === "suspended") await c.resume();
  const held = new Set<number>();
  const emitHeld = (src: Heard["source"]) => cb({ midis: [...held], level: held.size ? 1 : 0, source: src });
  // teclado do computador
  const base = () => 12 * ((o.octave ?? 4) + 1);
  const kd = (e: KeyboardEvent) => { if ((e.target as HTMLElement).closest("input, textarea, select") || e.repeat || e.metaKey || e.ctrlKey) return; const i = KEYS.indexOf(e.key.toLowerCase()); if (i < 0) return; const m = base() + i; held.add(m); audio.playNote(m, 0, 0.35, 90); emitHeld("keys"); };
  const ku = (e: KeyboardEvent) => { const i = KEYS.indexOf(e.key.toLowerCase()); if (i < 0) return; held.delete(base() + i); emitHeld("keys"); };
  addEventListener("keydown", kd); addEventListener("keyup", ku);
  // MIDI
  let midiAccess: any = null;
  try {
    if ((navigator as any).requestMIDIAccess) {
      midiAccess = await (navigator as any).requestMIDIAccess();
      [...midiAccess.inputs.values()].forEach((inp: any) => (inp.onmidimessage = (e: any) => {
        const [st, note, vel] = e.data; const cmd = st & 0xf0;
        if (cmd === 0x90 && vel > 0) { held.add(note); audio.playNote(note, 0, 0.35, vel); } else if (cmd === 0x80 || cmd === 0x90) held.delete(note);
        emitHeld("midi");
      }));
    }
  } catch { midiAccess = null; }
  // microfone
  let stream: MediaStream | null = null, timer = 0, sepr: ReturnType<typeof makeSeparator> | null = null;
  if (o.mic !== false) {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false } });
      const src = c.createMediaStreamSource(stream);
      const hp = c.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 45;
      const an = c.createAnalyser(); an.fftSize = 8192; an.smoothingTimeConstant = 0; src.connect(hp).connect(an);
      sepr = makeSeparator(an);
      const td = new Float32Array(an.fftSize), db = new Float32Array(an.fftSize / 2), mag = new Float32Array(an.fftSize / 2);
      const hz = c.sampleRate / an.fftSize, gate = new NoiseGate();
      timer = window.setInterval(() => {
        an.getFloatTimeDomainData(td); an.getFloatFrequencyData(db); sepr!.feed();
        let lvl = 0; for (let i = 0; i < td.length; i += 8) lvl = Math.max(lvl, Math.abs(td[i]));
        for (let i = 0; i < db.length; i++) mag[i] = Math.pow(10, db[i] / 20);
        const clean = gate.clean(mag, hz);
        let midis: number[] = [];
        if (lvl > 0.01) {
          if (o.poly) midis = frameVoices(clean, hz, "auto", 4).filter((v) => !sepr!.isSystem(v.f)).map((v) => v.midi);
          else { const p = detectPitch(td.subarray(td.length - 2048), c.sampleRate); if (p && p.clarity > 0.6 && !sepr!.isSystem(p.f)) midis = [Math.round(69 + 12 * Math.log2(p.f / 440))]; }
        }
        if (!held.size) cb({ midis, level: Math.min(1, lvl * 2), source: "mic" });
      }, 30);
    } catch { /* sem microfone: teclado e MIDI continuam */ }
  }
  return {
    stop() {
      clearInterval(timer); stream?.getTracks().forEach((t) => t.stop()); sepr?.dispose();
      removeEventListener("keydown", kd); removeEventListener("keyup", ku);
      if (midiAccess) [...midiAccess.inputs.values()].forEach((inp: any) => (inp.onmidimessage = null));
    },
    hasMic: !!stream,
  };
}
