// Ponto único de transcrição de áudio → notas.
// 1º servidor (audio2score / IA completa); se o visitante não tem conta, se o processador de IA não
// responde ou se o envio falha, transcreve NO NAVEGADOR (core/localtranscribe) — nunca fica sem resultado.
import { currentUser, runJob, upload } from "./api";
import { startTask, updateTask, Task } from "./tasks";
import { transcribeLocal, transcribeLocalPoly } from "./localtranscribe";
import * as audio from "./audio";
import { toast } from "./ui";

export interface TranscribeOpts {
  name: string; label?: string; mode?: "melody" | "both" | "harmony"; separate?: boolean; lyrics?: boolean; expected_lyrics?: string;
  tempo?: number; fixedTempo?: boolean; timeSig: [number, number]; a?: number; b?: number; gainDb?: number;
  kind?: "audio" | "recording"; onProgress?: (pct: number, label: string) => void;
  open?: () => void; retry?: () => void;
  /** várias notas ao mesmo tempo / orquestra (cada instrumento numa camada): análise no navegador */
  notes?: "auto" | "mono" | "poly"; orchestra?: boolean;
  /** chamado com o caminho do arquivo enviado (para guardar na camada de gravação) */
  onUploaded?: (path: string) => void;
}

const STAGES = [{ key: "prepare", label: "Preparando o áudio", pct: 5 }, { key: "pitch", label: "Ouvindo a melodia (altura de cada nota)", pct: 75 },
  { key: "split", label: "Separando as notas e sílabas", pct: 84 }, { key: "rhythm", label: "Encaixando o ritmo nos compassos", pct: 92 }, { key: "chords", label: "Tom e acordes", pct: 100 }];

async function local(buf: AudioBuffer, o: TranscribeOpts, t: Task, why: string) {
  updateTask(t, { status: "running", stages: STAGES, stage: "prepare", stageLabel: "Transcrevendo no navegador", detail: why, pct: 3, cancel: undefined, error: undefined });
  const r = await transcribeLocal(buf, { a: o.a, b: o.b, tempo: o.tempo, timeSig: o.timeSig, estimateTempo: !o.fixedTempo, name: o.name,
    onProgress: (pct, label) => { const st = STAGES.find((s) => s.label === label)?.key ?? t.stage; updateTask(t, { pct, stageLabel: label, stage: st }); o.onProgress?.(pct, label); } });
  if (o.mode === "melody") r.layers = r.layers.filter((l) => l.kind !== "harmony");
  if (o.mode === "harmony") r.layers = r.layers.filter((l) => l.kind === "harmony");
  const n = r.layers.reduce((acc, l) => acc + l.notes.length, 0);
  updateTask(t, { status: "done", pct: 100, stage: "done", stageLabel: "Concluído (no navegador)", detail: "", summary: `${n} notas · ♩=${r.tempo}`, endedAt: Date.now() });
  return r;
}

/** Transcreve um AudioBuffer (trecho a..b em segundos). Devolve o mesmo formato do servidor. */
export async function transcribeBuffer(buf: AudioBuffer, o: TranscribeOpts): Promise<any> {
  const t = startTask("transcribe_audio", o.label ?? `Transcrição — ${o.name}`);
  updateTask(t, { open: o.open, retry: o.retry });
  // acordes / vários instrumentos: o servidor leve é monofônico → análise polifônica aqui mesmo
  if (o.orchestra || o.notes === "poly") {
    updateTask(t, { status: "running", stages: STAGES, stage: "prepare", stageLabel: "Transcrevendo no navegador", detail: o.orchestra ? "orquestra — separando instrumentos pelo timbre" : "várias notas ao mesmo tempo", pct: 3 });
    const r: any = await transcribeLocalPoly(buf, { a: o.a, b: o.b, tempo: o.tempo, timeSig: o.timeSig, estimateTempo: !o.fixedTempo, name: o.name, notes: o.notes, orchestra: o.orchestra,
      onProgress: (pct, label) => { updateTask(t, { pct, stageLabel: label }); o.onProgress?.(pct, label); } });
    const n = r.layers.reduce((acc: number, l: any) => acc + l.notes.length, 0);
    updateTask(t, { status: "done", pct: 100, stage: "done", stageLabel: "Concluído (no navegador)", summary: `${n} notas · ${r.layers.length} camada(s)`, endedAt: Date.now() });
    return r;
  }
  if (!currentUser) return local(buf, o, t, "modo visitante — sem envio ao servidor");
  let wav: Blob;
  try { wav = await audio.trimToWav(buf, o.a ?? 0, o.b ?? buf.duration, o.gainDb ?? 0); }
  catch { return local(buf, o, t, "não consegui preparar o arquivo para envio"); }
  try {
    const up = await upload(o.kind ?? "audio", wav, o.name.replace(/\.\w+$/, "").replace(/[^\w\- ]+/g, "-") + "-trecho.wav", t);
    o.onUploaded?.(up.path);
    return await runJob("transcribe_audio", { asset: up.path, source_name: o.name, mode: o.mode ?? "both", separate: !!o.separate, lyrics: !!o.lyrics,
      expected_lyrics: o.expected_lyrics || undefined, tempo: o.fixedTempo ? o.tempo : (o.tempo || undefined), timeSig: o.timeSig },
      (_s, info) => o.onProgress?.(info.pct, info.label), { task: t, open: o.open, retry: o.retry, noWorkerAfter: 8 });
  } catch (e: any) {
    if (/cancelad/i.test(e.message)) throw e;
    toast(`Servidor de IA indisponível (${e.message}). Transcrevendo no navegador…`, "warn", 6000);
    // a gravação local (o trecho a..b) continua a ser a fonte — mesmo resultado, sem servidor
    return local(buf, { ...o }, t, "servidor indisponível — processando aqui");
  }
}
