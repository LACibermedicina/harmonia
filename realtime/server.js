// harmonIA realtime — WebSocket: chat da comunidade, sinalização WebRTC (videochamada),
// colaboração na partitura (patches) e eventos de jobs de IA vindos do worker (Redis pub/sub).
import { WebSocketServer } from "ws";
import Redis from "ioredis";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";

const PORT = 8080;
const sub = new Redis(process.env.REDIS_URL);
const store = new Redis(process.env.REDIS_URL);
const wss = new WebSocketServer({ port: PORT, path: "/ws/", maxPayload: 512 * 1024 });
const rooms = new Map(); // room -> Set<ws>

// Presença: quem está online (um registro por usuário, mesmo com várias abas); "invisible" some da lista
function presence() {
  const users = new Map();
  for (const c of wss.clients) if (c.user && c.status !== "invisible") users.set(c.user.id, { id: c.user.id, nick: c.user.nick, status: c.status || "online", call: !!c.inCall });
  return [...users.values()];
}
const announce = () => { const msg = { type: "presence", users: presence() }; for (const c of wss.clients) send(c, msg); };
const send = (ws, msg) => ws.readyState === 1 && ws.send(JSON.stringify(msg));
const broadcast = (room, msg, except) => {
  for (const c of rooms.get(room) || []) if (c !== except) send(c, msg);
};

// Credenciais TURN efêmeras (coturn use-auth-secret)
function turnCredentials(userId) {
  const user = `${Math.floor(Date.now() / 1000) + 3600}:${userId}`;
  const cred = crypto.createHmac("sha1", process.env.TURN_SECRET || "dev").update(user).digest("base64");
  return { urls: [`turn:${process.env.SUBDOMINIO || "localhost"}:${process.env.TURN_PORT}?transport=udp`, `turn:${process.env.SUBDOMINIO || "localhost"}:${process.env.TURN_PORT}?transport=tcp`], username: user, credential: cred };
}

wss.on("connection", (ws, req) => {
  const url = new URL(req.url, "http://x");
  let user;
  try {
    user = jwt.verify(url.searchParams.get("token") || "", process.env.JWT_SECRET);
  } catch {
    ws.close(4401, "unauthorized");
    return;
  }
  ws.user = { id: user.sub, role: user.role, nick: (url.searchParams.get("nick") || "Músico").slice(0, 24) };
  ws.rooms = new Set();
  ws.isAlive = true;
  ws.on("pong", () => (ws.isAlive = true));
  ws.status = "online";
  send(ws, { type: "hello", user: ws.user, ice: [{ urls: "stun:stun.l.google.com:19302" }, turnCredentials(ws.user.id)] });
  announce();

  let tokens = 20; // rate-limit simples: 20 msgs / 5 s
  const refill = setInterval(() => (tokens = 20), 5000);

  ws.on("message", async (raw) => {
    if (--tokens < 0) return send(ws, { type: "error", error: "rate_limited" });
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    const room = typeof m.room === "string" ? m.room.slice(0, 64) : null;
    switch (m.type) {
      case "join": {
        if (!room) return;
        if (!rooms.has(room)) rooms.set(room, new Set());
        rooms.get(room).add(ws); ws.rooms.add(room);
        const history = (await store.lrange(`harmonia:chat:${room}`, -50, -1)).map((x) => JSON.parse(x));
        send(ws, { type: "joined", room, history, peers: [...rooms.get(room)].map((c) => c.user) });
        broadcast(room, { type: "peer-join", room, user: ws.user }, ws);
        break;
      }
      case "leave":
        rooms.get(room)?.delete(ws); ws.rooms.delete(room);
        broadcast(room, { type: "peer-leave", room, user: ws.user });
        break;
      case "chat": {
        if (!ws.rooms.has(room) || typeof m.text !== "string") return;
        const msg = { type: "chat", room, id: crypto.randomUUID(), user: ws.user, text: m.text.slice(0, 2000), at: Date.now() };
        await store.rpush(`harmonia:chat:${room}`, JSON.stringify(msg));
        await store.ltrim(`harmonia:chat:${room}`, -500, -1);
        await store.expire(`harmonia:chat:${room}`, 60 * 60 * 24 * 90); // retenção LGPD: 90 dias
        broadcast(room, msg);
        break;
      }
      case "rtc": // offer/answer/ice — encaminhado ao par alvo
        if (!ws.rooms.has(room)) return;
        for (const c of rooms.get(room) || [])
          if (c.user.id === m.to) send(c, { type: "rtc", room, from: ws.user.id, data: m.data });
        break;
      case "score-patch": // colaboração: operações do editor (add/move/delete nota, camada...)
        if (!ws.rooms.has(room)) return;
        broadcast(room, { type: "score-patch", room, from: ws.user.id, ops: m.ops }, ws);
        break;
      case "status": // online | away | invisible
        if (["online", "away", "invisible"].includes(m.status)) { ws.status = m.status; announce(); }
        break;
      case "who":
        send(ws, { type: "presence", users: presence() });
        break;
      case "call": // entrou/saiu de uma videochamada (mostra 📹 ao lado do nome)
        ws.inCall = !!m.on; announce();
        break;
      case "cursor":
        if (ws.rooms.has(room)) broadcast(room, { type: "cursor", room, from: ws.user, pos: m.pos }, ws);
        break;
    }
  });

  ws.on("close", () => {
    clearInterval(refill);
    setTimeout(announce, 50);
    for (const r of ws.rooms) {
      rooms.get(r)?.delete(ws);
      broadcast(r, { type: "peer-leave", room: r, user: ws.user });
    }
  });
});

// Eventos do worker de IA → dono do job
sub.subscribe("harmonia:events");
sub.on("message", (_ch, payload) => {
  const ev = JSON.parse(payload);
  for (const c of wss.clients) if (!ev.owner || c.user?.id === ev.owner) send(c, ev);
});

setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false; ws.ping();
  }
}, 30000);

console.log(`[realtime] ouvindo :${PORT}/ws/`);
