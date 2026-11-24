// Central de notificações: registra eventos importantes (transcrições, exportações, atualizações,
// mensagens do sistema). Fica salva no navegador (últimas 60) e mostra contador de não lidas.
export type NKind = "info" | "ok" | "warn" | "error";
export interface Notif { id: string; title: string; body?: string; kind: NKind; at: number; read: boolean; action?: string; }

const KEY = "harmonia.notifications";
let list: Notif[] = [];
try { list = JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { list = []; }
const listeners = new Set<() => void>();
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, 60))); } catch { /* modo privado */ } listeners.forEach((f) => f()); };

export function notify(title: string, opts: { body?: string; kind?: NKind; action?: string } = {}) {
  const last = list[0];
  if (last && last.title === title && Date.now() - last.at < 5000) return; // evita duplicatas em sequência
  list.unshift({ id: Math.random().toString(36).slice(2), title, body: opts.body, kind: opts.kind || "info", at: Date.now(), read: false, action: opts.action });
  list = list.slice(0, 60);
  save();
}
export const notifications = () => list;
export const unread = () => list.filter((n) => !n.read).length;
export function markAllRead() { list.forEach((n) => (n.read = true)); save(); }
export function clearNotifications() { list = []; save(); }
export function onNotify(fn: () => void) { listeners.add(fn); return () => listeners.delete(fn); }
