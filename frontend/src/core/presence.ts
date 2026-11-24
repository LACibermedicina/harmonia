// Presença na comunidade: uma conexão leve ao serviço realtime para saber quem está online, o próprio
// estado (online / ausente / invisível) e quem está em videochamada. Reconecta sozinha.
import { getToken, currentUser } from "./api";

export interface Person { id: string; nick: string; status: string; call: boolean }
let ws: WebSocket | null = null;
let users: Person[] = [];
let connected = false;
let myStatus: "online" | "away" | "invisible" = (localStorage.getItem("harmonia.status") as any) || "online";
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((f) => f());
export const onPresence = (fn: () => void) => { listeners.add(fn); return () => listeners.delete(fn); };
export const online = () => users;
export const isConnected = () => connected;
export const status = () => myStatus;

export function setStatus(s: "online" | "away" | "invisible") {
  myStatus = s; localStorage.setItem("harmonia.status", s);
  if (ws?.readyState === 1) ws.send(JSON.stringify({ type: "status", status: s }));
  emit();
}

let retry = 0;
export function connectPresence() {
  ws?.close(); ws = null; connected = false; users = []; emit();
  if (!currentUser || !getToken()) return;
  const sock = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws/?token=${encodeURIComponent(getToken())}&nick=${encodeURIComponent(currentUser.name.split(" ")[0])}`);
  ws = sock;
  sock.onopen = () => { connected = true; retry = 0; if (myStatus !== "online") sock.send(JSON.stringify({ type: "status", status: myStatus })); sock.send(JSON.stringify({ type: "who" })); emit(); };
  sock.onmessage = (ev) => { try { const m = JSON.parse(ev.data); if (m.type === "presence") { users = m.users; emit(); } } catch { /* */ } };
  sock.onclose = () => {
    if (ws !== sock) return;
    connected = false; emit();
    retry = Math.min(retry + 1, 6);
    setTimeout(() => { if (ws === sock && currentUser) connectPresence(); }, 2000 * retry);
  };
}
addEventListener("auth", () => connectPresence());
