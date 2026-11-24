// Transcrição de QUALQUER gravação da plataforma (feita no editor, solta do Importar ou faixa original):
// a gravação inteira ou só os compassos escolhidos viram notas na posição certa, vinculadas 🔗 à gravação.
import { store, newLayer } from "./store";
import { Layer, beatsPerMeasure, uid } from "./types";
import * as audio from "./audio";
import { transcribeBuffer } from "./transcribe";
import { toast } from "./ui";

/** Trecho da partitura (em tempos) coberto pela gravação. */
export function recordingSpan(l: Layer, durSec?: number) {
  const s = store.score, spb = 60 / s.tempo, bpm = beatsPerMeasure(s);
  const dur = durSec ?? l.audioDur ?? ((l.measures?.length || 1) * bpm * spb);
  const b0 = (l.audioOffset || 0) / spb;
  return { b0, b1: b0 + dur / spb, dur };
}

export async function transcribeRecording(l: Layer, opts: { measures?: number[]; mode?: "melody" | "both" | "harmony"; lyrics?: boolean } = {}) {
  if (l.kind !== "recording") return;
  const s = store.score, spb = 60 / s.tempo, bpm = beatsPerMeasure(s);
  let buf: AudioBuffer;
  try { buf = await audio.layerBuffer(l); } catch { toast("Não encontrei o áudio desta gravação", "error"); return; }
  if (!l.audioDur) store.mutate(() => (l.audioDur = buf.duration), "rec-meta");
  const span = recordingSpan(l, buf.duration);
  // trecho em segundos dentro da gravação
  let t0 = 0, t1 = buf.duration, label = "toda a gravação";
  if (opts.measures?.length) {
    const ms = [...opts.measures].sort((a, b) => a - b);
    t0 = Math.max(0, ms[0] * bpm * spb - (l.audioOffset || 0));
    t1 = Math.min(buf.duration, (ms[ms.length - 1] + 1) * bpm * spb - (l.audioOffset || 0));
    label = ms.length > 1 ? `compassos ${ms[0] + 1}–${ms[ms.length - 1] + 1}` : `compasso ${ms[0] + 1}`;
    if (t1 - t0 < 0.15) { toast("A gravação não cobre esse compasso", "warn"); return; }
  }
  const startBeat = span.b0 + t0 / spb;
  toast(`Transcrevendo ${label} de “${l.name}”…`, "info", 4000);
  try {
    const r = await transcribeBuffer(buf, { name: l.name, label: `Gravação — ${l.name} (${label})`, a: t0, b: t1, kind: "audio", mode: opts.mode || "melody", lyrics: opts.lyrics ?? true,
      tempo: s.tempo, fixedTempo: true, timeSig: s.timeSig, onUploaded: (path) => { if (!l.audio && !opts.measures) store.mutate(() => (l.audio = path), "upload"); },
      open: () => dispatchEvent(new CustomEvent("open-app", { detail: "compose" })), retry: () => transcribeRecording(l, opts) });
    const made: string[] = [];
    store.mutate((sc) => {
      if (!l.link) l.link = uid();
      for (const nl of r.layers || []) {
        if (!nl.notes?.length) continue;
        const v = newLayer(nl.staff === "bass" ? "harmony" : (nl.kind === "harmony" ? "harmony" : "voice"), `${nl.name || "Notas"} — ${l.name.replace(/^[🎵🎙] ?/u, "")} (${label})`, nl.staff === "bass" ? "bass" : "treble");
        v.notes = nl.notes.map((n: any) => ({ ...n, id: uid(), start: n.start + startBeat })).filter((n: any) => n.start < startBeat + (t1 - t0) / spb + 0.01);
        v.link = l.link; v.group = l.group;
        if (!v.notes.length) continue;
        sc.layers.push(v); made.push(`${v.name} (${v.notes.length} notas)`);
        sc.measures = Math.max(sc.measures, Math.ceil(Math.max(...v.notes.map((n) => n.start + n.dur)) / bpm));
      }
      while (sc.chords.length < sc.measures) sc.chords.push([]);
      if (opts.mode !== "melody" && r.chords) r.chords.forEach((cell: any[], i: number) => { const m = Math.floor(startBeat / bpm) + i; if (cell?.length && m < sc.measures && !sc.chords[m]?.length) sc.chords[m] = cell; });
    }, "merge");
    toast(made.length ? `Transcrito (${label}) e vinculado 🔗 à gravação: ${made.join(" · ")}` : `Nenhuma nota reconhecida em ${label}. Tente um trecho mais limpo.`, made.length ? "ok" : "warn", 7000);
  } catch (e: any) { toast("Não foi possível transcrever: " + e.message, "error", 6000); }
}
