// Cliente da API harmonIA com token JWT e polling de jobs assíncronos.
import { toast } from "./ui";
import { notify } from "./notify";
import { Task, startTask, updateTask, applyJob, summarize } from "./tasks";

let token = localStorage.getItem("harmonia.token") || "";
export let currentUser: any = null;
export let online = true;

export function setToken(t: string, user: any) {
  token = t; currentUser = user;
  if (t) localStorage.setItem("harmonia.token", t); else localStorage.removeItem("harmonia.token");
  window.dispatchEvent(new CustomEvent("auth", { detail: user }));
}
export const getToken = () => token;

export async function api<T = any>(path: string, opts: RequestInit & { json?: any } = {}): Promise<T> {
  const headers: Record<string, string> = { ...(opts.headers as any) };
  if (token) headers.Authorization = `Bearer ${token}`;
  let body = opts.body;
  if (opts.json !== undefined) { headers["Content-Type"] = "application/json"; body = JSON.stringify(opts.json); }
  let r: Response;
  try {
    r = await fetch(path, { ...opts, headers, body });
  } catch (e) {
    online = false;
    throw new Error("Sem conexão com o servidor");
  }
  if (r.status === 401 && token) { setToken("", null); }
  if (!r.ok) {
    let msg = r.statusText;
    try { msg = (await r.json()).detail || msg; } catch { /* corpo vazio */ }
    throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
  }
  online = true;
  return r.json();
}

export async function restoreSession() {
  if (!token) return null;
  try { currentUser = await api("/api/auth/me"); window.dispatchEvent(new CustomEvent("auth", { detail: currentUser })); return currentUser; }
  catch { return null; }
}

const JOB_LABEL: Record<string, string> = { transcribe_audio: "Transcrição de áudio", transcribe_image: "Leitura da partitura", export: "Exportação" };
export interface JobInfo { status: string; pct: number; label: string; detail: string; queuePos?: number; workerAlive?: boolean }

/** Executa job de IA. Jobs leves voltam na hora; pesados são acompanhados por polling, com % e etapa
 *  publicados no ícone de tarefas. `opts.task` continua uma tarefa já criada (ex.: que começou no envio). */
export async function runJob(type: string, payload: any, onProgress?: (s: string, info: JobInfo) => void,
  opts: { task?: Task; label?: string; open?: () => void; retry?: () => void; noWorkerAfter?: number } = {}): Promise<any> {
  const heavy = type in JOB_LABEL;
  const t = opts.task ?? (heavy ? startTask(type, opts.label) : undefined);
  if (t) updateTask(t, { open: opts.open ?? t.open, retry: opts.retry ?? t.retry });
  const fail = (msg: string) => { if (t) updateTask(t, { status: "error", error: msg, endedAt: Date.now() }); return new Error(msg); };
  let j: any;
  try { j = await api("/api/jobs", { method: "POST", json: { type, payload } }); }
  catch (e: any) { throw fail(e.message); }
  const finish = (result: any) => {
    if (t) updateTask(t, { status: "done", pct: 100, stage: "done", stageLabel: "Concluído", detail: "", summary: summarize(type, result), endedAt: Date.now() });
    return result;
  };
  if (j.status === "done") return finish(j.result);
  let cancelled = false;
  if (t) updateTask(t, { cancel: () => { cancelled = true; updateTask(t, { cancelRequested: true, detail: "cancelando…" }); api(`/api/jobs/${j.id}`, { method: "DELETE" }).catch(() => {}); } });
  if (t) applyJob(t, j);
  let stuck = 0;
  for (let i = 0; i < 1200; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    let s: any;
    try { s = await api(`/api/jobs/${j.id}`); } catch (e: any) { if (++stuck > 20) throw fail("Conexão perdida com o servidor: " + e.message); continue; }
    stuck = 0;
    if (s.status === "cancelled" || (cancelled && s.status !== "done")) {
      if (s.status === "cancelled" || i > 30) { if (t) updateTask(t, { status: "cancelled", error: "Cancelada por você", endedAt: Date.now(), cancel: undefined }); throw new Error("Transcrição cancelada"); }
    }
    if (t) applyJob(t, s);
    const info: JobInfo = { status: s.status, pct: t?.pct ?? 0, label: t?.stageLabel ?? s.status, detail: t?.detail ?? "", queuePos: s.queuePos, workerAlive: s.workerAlive };
    onProgress?.(s.status, info);
    if (s.status === "done") { notify(JOB_LABEL[type] ? `${JOB_LABEL[type]} concluída` : "Processamento concluído", { kind: "ok", body: summarize(type, s.result) }); return finish(s.result); }
    if (s.status === "error") { notify(`${JOB_LABEL[type] || "Processamento"} falhou`, { kind: "error", body: s.error }); throw fail(s.error || "Falha no processamento"); }
    // sem processador de IA ativo: desiste cedo (quem chamou pode transcrever no navegador)
    if (opts.noWorkerAfter && s.status === "queued" && s.workerAlive === false && i >= opts.noWorkerAfter) {
      api(`/api/jobs/${j.id}`, { method: "DELETE" }).catch(() => {});
      const err: any = new Error("O processador de IA do servidor não está respondendo"); err.noWorker = true;
      if (t) updateTask(t, { cancel: undefined });
      throw err;
    }
    if (s.status === "queued" && s.workerAlive === false && i === 45) notify("Processador de IA parado", { kind: "warn", body: "A tarefa está na fila, mas o serviço de IA não respondeu. Verifique o container ai-worker na VPS." });
  }
  throw fail("Tempo esgotado (20 min). Tente um trecho menor.");
}

/** Mensagem compreensível para falhas de envio (o servidor nem sempre devolve JSON). */
function uploadError(status: number, detail?: any) {
  if (typeof detail === "string" && detail) return detail;
  return ({ 401: "Sua sessão expirou — entre de novo", 403: "Sem permissão para enviar arquivos", 413: "Arquivo grande demais — recorte um trecho menor",
    415: "Formato não suportado — use MP3, WAV, M4A, OGG, PNG ou JPG", 500: "Erro no servidor ao salvar o arquivo — o administrador precisa rodar a atualização na VPS",
    502: "Servidor reiniciando — tente de novo em 1 minuto", 503: "Servidor ocupado — tente de novo em instantes", 504: "O envio demorou demais — tente um trecho menor",
    507: "O servidor não conseguiu salvar o arquivo (permissão/espaço)" } as Record<number, string>)[status] || `Falha no envio (HTTP ${status || "sem resposta"})`;
}

/** Envia um arquivo. Com `task`, mostra o % do envio no ícone de tarefas. */
export async function upload(kind: string, blob: Blob, filename: string, task?: Task) {
  const fd = new FormData();
  fd.append("kind", kind);
  fd.append("file", blob, filename);
  if (!task) return api<{ id: number; path: string; url: string }>("/api/assets", { method: "POST", body: fd });
  return new Promise<{ id: number; path: string; url: string }>((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open("POST", "/api/assets");
    if (token) x.setRequestHeader("Authorization", `Bearer ${token}`);
    x.upload.onprogress = (e) => { if (e.lengthComputable) updateTask(task, { pct: Math.round((e.loaded / e.total) * 4), detail: `${Math.round(e.loaded / 1024)} de ${Math.round(e.total / 1024)} KB` }); };
    x.onload = () => {
      let body: any = {}; try { body = JSON.parse(x.responseText); } catch { /* */ }
      if (x.status >= 200 && x.status < 300) { updateTask(task, { pct: 4, stage: "queue", stageLabel: "Na fila do processador de IA", detail: "arquivo enviado" }); resolve(body); }
      else { const m = uploadError(x.status, body.detail); updateTask(task, { status: "error", error: m, endedAt: Date.now() }); reject(new Error(m)); }
    };
    updateTask(task, { cancel: () => { x.abort(); updateTask(task, { status: "cancelled", error: "Envio cancelado", endedAt: Date.now(), cancel: undefined }); reject(new Error("Envio cancelado")); } });
    x.onerror = () => { updateTask(task, { status: "error", error: "Sem conexão com o servidor", endedAt: Date.now() }); reject(new Error("Sem conexão com o servidor")); };
    x.send(fd);
  });
}

export function requireLogin(): boolean {
  if (currentUser) return true;
  toast("Entre na sua conta para usar a IA e salvar na biblioteca", "warn");
  window.dispatchEvent(new CustomEvent("open-app", { detail: "account" }));
  return false;
}
