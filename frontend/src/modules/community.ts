// Comunidade: salas de chat em tempo real + videochamada WebRTC (malha p2p, TURN efêmero).
import { h, toast } from "../core/ui";
import { getToken, currentUser, requireLogin } from "../core/api";

export function mountCommunity(body: HTMLElement) {
  body.classList.add("community");
  if (!currentUser) { body.append(h("div", { class: "empty-state" }, h("p", {}, "Entre na sua conta para conversar com outros músicos."), h("button", { class: "btn primary", onclick: () => requireLogin() }, "Entrar"))); return; }
  const rooms = ["geral", "harmonia", "composição", "piano", "voz-e-letra"];
  let room = "geral";
  const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws/?token=${encodeURIComponent(getToken())}&nick=${encodeURIComponent(currentUser.name.split(" ")[0])}`);
  let ice: RTCIceServer[] = [];
  const peers = new Map<string, RTCPeerConnection>();
  let local: MediaStream | null = null;

  const roomList = h("nav", { class: "rooms" }, ...rooms.map((r) => h("button", { "data-room": r, onclick: () => join(r) }, "# " + r)));
  const log = h("div", { class: "chat-log", "aria-live": "polite" });
  const inp = h("input", { placeholder: "Mensagem… (compartilhe links /s/… de composições)", maxlength: 2000 }) as HTMLInputElement;
  const videos = h("div", { class: "videos" });
  const callBtn = h("button", { class: "btn accent", onclick: () => (local ? hangup() : call()) }, "📹 Entrar na chamada") as HTMLButtonElement;
  body.append(roomList, h("div", { class: "chat" }, h("div", { class: "toolbar" }, h("b", { class: "room-name" }), callBtn), videos, log,
    h("form", { class: "chat-form", onsubmit: (e: Event) => { e.preventDefault(); if (inp.value.trim()) { ws.send(JSON.stringify({ type: "chat", room, text: inp.value })); inp.value = ""; } } }, inp, h("button", { class: "btn primary" }, "Enviar"))));

  const line = (m: any) => h("div", { class: "msg" + (m.user.id === String(currentUser.id) ? " me" : "") }, h("b", {}, m.user.nick), h("span", {}, m.text), h("time", {}, new Date(m.at).toLocaleTimeString().slice(0, 5)));
  function join(r: string) {
    if (ws.readyState === 1) { ws.send(JSON.stringify({ type: "leave", room })); ws.send(JSON.stringify({ type: "join", room: r })); }
    room = r; roomList.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.room === r));
    body.querySelector(".room-name")!.textContent = "# " + r; log.replaceChildren();
  }
  ws.onopen = () => join(room);
  ws.onerror = () => { log.replaceChildren(h("p", { class: "hint" }, "Chat indisponível no momento — tentaremos de novo quando você reabrir.")); };
  ws.onmessage = async (ev) => {
    const m = JSON.parse(ev.data);
    if (m.type === "hello") ice = m.ice;
    if (m.type === "joined") log.replaceChildren(...m.history.map(line));
    if (m.type === "chat" && m.room === room) { log.append(line(m)); log.scrollTop = log.scrollHeight; }
    if (m.type === "peer-join" && local) offer(m.user.id);
    if (m.type === "peer-leave") { peers.get(m.user.id)?.close(); peers.delete(m.user.id); videos.querySelector(`[data-peer="${m.user.id}"]`)?.remove(); tile?.querySelector(`[data-peer="${m.user.id}"]`)?.remove(); syncTile(); }
    if (m.type === "rtc") await onSignal(m.from, m.data);
  };

  function pc(id: string) {
    if (peers.has(id)) return peers.get(id)!;
    const p = new RTCPeerConnection({ iceServers: ice });
    local?.getTracks().forEach((t) => p.addTrack(t, local!));
    p.onicecandidate = (e) => e.candidate && ws.send(JSON.stringify({ type: "rtc", room, to: id, data: { ice: e.candidate } }));
    p.ontrack = (e) => {
      let v = videos.querySelector<HTMLVideoElement>(`[data-peer="${id}"]`);
      if (!v) { v = h("video", { autoplay: true, playsinline: true, "data-peer": id }) as HTMLVideoElement; videos.append(v); }
      v.srcObject = e.streams[0];
      tileVideo(id, e.streams[0]);
    };
    peers.set(id, p); return p;
  }
  async function offer(id: string) { const p = pc(id); const o = await p.createOffer(); await p.setLocalDescription(o); ws.send(JSON.stringify({ type: "rtc", room, to: id, data: { sdp: o } })); }
  async function onSignal(from: string, d: any) {
    const p = pc(from);
    if (d.sdp) {
      await p.setRemoteDescription(d.sdp);
      if (d.sdp.type === "offer") { const a = await p.createAnswer(); await p.setLocalDescription(a); ws.send(JSON.stringify({ type: "rtc", room, to: from, data: { sdp: a } })); }
    } else if (d.ice) await p.addIceCandidate(d.ice).catch(() => {});
  }
  async function call() {
    try {
      local = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      const me = h("video", { autoplay: true, muted: true, playsinline: true, class: "me" }) as HTMLVideoElement; me.srcObject = local; videos.append(me);
      callBtn.textContent = "Sair da chamada";
      openTile();
      ws.send(JSON.stringify({ type: "call", on: true }));
      ws.send(JSON.stringify({ type: "leave", room })); ws.send(JSON.stringify({ type: "join", room })); // reanuncia → pares enviam ofertas
    } catch (e: any) { toast("Câmera/microfone indisponível: " + e.message, "error"); }
  }
  function hangup() { if (local && ws.readyState === 1) ws.send(JSON.stringify({ type: "call", on: false })); local?.getTracks().forEach((t) => t.stop()); local = null; peers.forEach((p) => p.close()); peers.clear(); videos.replaceChildren(); callBtn.textContent = "📹 Entrar na chamada"; closeTile(); }

  // ---- chamada minimizada: quadro flutuante estilo Zoom (aparece quando o painel da Comunidade não está à vista)
  let tile: HTMLElement | null = null, tileTimer = 0;
  const TILE_KEY = "harmonia.calltile";
  function openTile() {
    if (tile) return;
    const grid = h("div", { class: "ct-grid" });
    const me = h("video", { autoplay: true, muted: true, playsinline: true, class: "ct-me" }) as HTMLVideoElement; me.srcObject = local;
    const timeEl = h("small", { class: "ct-time" }, "00:00");
    const t0 = Date.now();
    const btn = (txt: string, title: string, fn: (b: HTMLButtonElement) => void, cls = "") => { const b = h("button", { class: "ct-b " + cls, title, "aria-label": title }, txt) as HTMLButtonElement; b.onclick = (e) => { e.stopPropagation(); fn(b); }; return b; };
    const mic = btn("🎤", "Microfone (liga/desliga)", (b) => { const t = local?.getAudioTracks()[0]; if (t) { t.enabled = !t.enabled; b.classList.toggle("off", !t.enabled); } });
    const cam = btn("📷", "Câmera (liga/desliga)", (b) => { const t = local?.getVideoTracks()[0]; if (t) { t.enabled = !t.enabled; b.classList.toggle("off", !t.enabled); me.classList.toggle("off", !t.enabled); } });
    const big = btn("⤢", "Abrir a chamada na Comunidade", () => dispatchEvent(new CustomEvent("open-app", { detail: "community" })));
    const mini = btn("–", "Recolher em ícone", () => tile!.classList.toggle("dot"));
    const end = btn("📞", "Sair da chamada", () => hangup(), "end");
    tile = h("div", { class: "call-tile", role: "dialog", "aria-label": `Chamada em # ${room}` },
      h("header", { class: "ct-head" }, h("b", {}, `● # ${room}`), timeEl, mini),
      h("div", { class: "ct-stage" }, grid, me),
      h("div", { class: "ct-bar" }, mic, cam, big, end));
    tile.addEventListener("click", () => { if (tile!.classList.contains("dot")) tile!.classList.remove("dot"); });
    try { const p = JSON.parse(localStorage.getItem(TILE_KEY) || "null"); if (p) Object.assign(tile.style, { left: p.x + "px", top: p.y + "px", right: "auto", bottom: "auto" }); } catch { /* */ }
    const head = tile.querySelector(".ct-head") as HTMLElement;
    head.addEventListener("pointerdown", (e) => {
      if ((e.target as HTMLElement).closest("button")) return;
      const r = tile!.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
      const mv = (ev: PointerEvent) => Object.assign(tile!.style, { left: Math.max(0, Math.min(innerWidth - 60, ev.clientX - dx)) + "px", top: Math.max(30, Math.min(innerHeight - 40, ev.clientY - dy)) + "px", right: "auto", bottom: "auto" });
      const up = () => { removeEventListener("pointermove", mv); removeEventListener("pointerup", up); try { const b = tile!.getBoundingClientRect(); localStorage.setItem(TILE_KEY, JSON.stringify({ x: b.left, y: b.top })); } catch { /* */ } };
      addEventListener("pointermove", mv); addEventListener("pointerup", up);
    });
    document.body.append(tile);
    peers.forEach((_p, id) => { const v = videos.querySelector<HTMLVideoElement>(`[data-peer="${id}"]`); if (v?.srcObject) tileVideo(id, v.srcObject as MediaStream); });
    tileTimer = window.setInterval(() => {
      const s = Math.floor((Date.now() - t0) / 1000); timeEl.textContent = `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
      // o quadro só aparece quando a chamada não está visível no painel
      const r = body.getBoundingClientRect();
      const seen = body.isConnected && !!body.offsetParent && r.height > 120 && r.width > 120 && r.bottom > 0 && r.top < innerHeight;
      tile!.hidden = seen;
    }, 700);
    syncTile();
  }
  function tileVideo(id: string, stream: MediaStream) {
    if (!tile) return;
    const grid = tile.querySelector(".ct-grid")!;
    let v = grid.querySelector<HTMLVideoElement>(`[data-peer="${id}"]`);
    if (!v) { v = h("video", { autoplay: true, playsinline: true, muted: true, "data-peer": id }) as HTMLVideoElement; grid.append(v); } // som já toca pelo vídeo do painel
    v.srcObject = stream; syncTile();
  }
  function syncTile() { if (!tile) return; const n = tile.querySelectorAll(".ct-grid video").length; tile.dataset.n = String(n); tile.querySelector(".ct-grid")!.classList.toggle("empty", !n); }
  function closeTile() { clearInterval(tileTimer); tile?.remove(); tile = null; }
  const onCall = () => { if (!local) call(); };
  addEventListener("community:call", onCall);
  return () => { removeEventListener("community:call", onCall); hangup(); ws.close(); };
}


/** Versão para painel (acoplável/flutuante): remonta ao entrar/sair da conta. */
export function mountCommunityPanel(body: HTMLElement) {
  body.classList.add("community-panel");
  let cleanup: void | (() => void);
  const remount = () => { if (typeof cleanup === "function") cleanup(); body.replaceChildren(); cleanup = mountCommunity(body); };
  addEventListener("auth", remount);
  remount();
  return () => { removeEventListener("auth", remount); if (typeof cleanup === "function") cleanup(); };
}
