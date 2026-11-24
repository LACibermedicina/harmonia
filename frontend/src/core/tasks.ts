// Tarefas de IA em andamento (transcrição de áudio/imagem, exportação): % de evolução, etapa atual,
// detalhamento do processo, posição na fila e resultado — exibidas pelo ícone de tarefas (taskhub).
export interface Stage { key: string; label: string; pct: number }
export interface Task {
  id: string; type: string; label: string;
  status: "upload" | "queued" | "running" | "done" | "error" | "cancelled";
  pct: number; stage: string; stageLabel: string; detail: string; stages: Stage[];
  queuePos?: number; workerAlive?: boolean; startedAt: number; endedAt?: number;
  error?: string; summary?: string; open?: () => void; retry?: () => void; cancel?: () => void; cancelRequested?: boolean;
}
const tasks = new Map<string, Task>();
const listeners = new Set<() => void>();
export const onTasks = (fn: () => void) => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = () => listeners.forEach((f) => f());
export const allTasks = () => [...tasks.values()].sort((a, b) => b.startedAt - a.startedAt);

const LABEL: Record<string, string> = { transcribe_audio: "Transcrição de áudio", transcribe_image: "Leitura da partitura", export: "Exportação" };
const UPLOAD: Stage = { key: "upload", label: "Enviando o arquivo", pct: 0 };
const QUEUE: Stage = { key: "queue", label: "Na fila do processador de IA", pct: 0 };

export function startTask(type: string, label?: string): Task {
  const t: Task = { id: Math.random().toString(36).slice(2), type, label: label || LABEL[type] || "Processamento", status: "upload",
    pct: 0, stage: "upload", stageLabel: UPLOAD.label, detail: "", stages: [UPLOAD, QUEUE], startedAt: Date.now() };
  tasks.set(t.id, t); emit();
  // mantém no máximo 8 tarefas na lista
  allTasks().slice(8).forEach((x) => x.status === "done" || x.status === "error" ? tasks.delete(x.id) : null);
  return t;
}
export function updateTask(t: Task, patch: Partial<Task>) { Object.assign(t, patch); emit(); }
export function removeTask(id: string) { tasks.delete(id); emit(); }

/** Aplica a resposta de /api/jobs/<id> à tarefa. */
export function applyJob(t: Task, s: any) {
  if (s.status === "queued") {
    updateTask(t, { status: "queued", stage: "queue", stageLabel: QUEUE.label, pct: Math.max(t.pct, 4), queuePos: s.queuePos, workerAlive: s.workerAlive,
      detail: s.workerAlive === false ? "o processador de IA não está respondendo — o administrador foi avisado no painel" : s.queuePos > 1 ? `posição ${s.queuePos} na fila` : "começando em instantes" });
  } else if (s.status === "running") {
    const p = s.progress || {};
    const stages: Stage[] = [UPLOAD, QUEUE, ...(p.stages || [])];
    updateTask(t, { status: "running", pct: Math.max(t.pct, 6 + (p.pct ?? 0) * 0.92), stage: p.stage || "running", stageLabel: p.label || "Processando", detail: p.detail || "", stages });
  }
}

/** Resumo do resultado (feedback ao terminar). */
export function summarize(type: string, r: any): string {
  if (type === "transcribe_audio" || type === "transcribe_image") {
    const layers = (r?.layers || []).filter((l: any) => l.kind !== "recording");
    const notes = layers.reduce((a: number, l: any) => a + (l.notes?.length || 0), 0);
    const KEYS = ["Dó", "Dó♯", "Ré", "Mi♭", "Mi", "Fá", "Fá♯", "Sol", "Lá♭", "Lá", "Si♭", "Si"];
    const key = r?.key ? `${KEYS[r.key.tonic] ?? ""} ${r.key.mode === "minor" ? "menor" : "maior"}` : "";
    return [`${notes} notas em ${layers.length} camada(s)`, r?.tempo ? `♩ = ${r.tempo}` : "", key, r?.measures ? `${r.measures} compassos` : "",
      r?.engine === "lite" ? "modo leve" : ""].filter(Boolean).join(" · ");
  }
  if (type === "export") return Object.keys(r?.files || {}).map((k) => k.toUpperCase()).join(", ") + " prontos";
  return "Concluído";
}
