// harmonIA — desktop estilo macOS: barra de menus, seletor de idiomas, menu lateral, ícones, Dock e janelas.
import "./styles/main.css";
import { initWM, openApp, AppDef, onWindowsChange, openWindows, restoreWindow, minimizeAll } from "./core/wm";
import { initDevice, isMobile, preference, setPreference, toggleLargeText, toggleContrast } from "./core/device";
import { ICONS, installIconDefs } from "./core/icons";
import { h, toast, installTips } from "./core/ui";
import { LANGS, setLang, lang, t, watchI18n } from "./core/i18n";
import { restoreSession, currentUser, api } from "./core/api";
import { store } from "./core/store";
import { mountScoreEditor } from "./modules/score-editor";
import { mountLayers } from "./modules/layers";
import { mountImporter } from "./modules/importer";
import { mountMixer } from "./modules/mixer";
import { mountLibrary } from "./modules/library";
import { mountGraph } from "./modules/graph";
import { mountAgenda } from "./modules/agenda";
import { mountCommunity, mountCommunityPanel } from "./modules/community";
import { mountAccount } from "./modules/account";
import { mountAvatar } from "./modules/avatar";
import { mountAdmin } from "./modules/admin";
import { showLogin, showWizard, needsOnboarding } from "./modules/welcome";
import { notifications, unread, markAllRead, clearNotifications, onNotify } from "./core/notify";
import { PanelDock } from "./core/paneldock";
import { mountProperties, mountAnnotations } from "./modules/inspector";
import * as audio from "./core/audio";
import { mountStudy } from "./modules/study";
import { mountLearn } from "./modules/learn";
import { mountProjects } from "./modules/projects";
import { listProjects, onProjects, saveCurrent as saveProject } from "./core/projects";
import { mountVisualizer } from "./modules/visualizer";
import { playerBar } from "./modules/playerbar";
import { mountTaskHub } from "./modules/taskhub";
import { connectPresence, onPresence, online as onlineUsers, isConnected, status as myStatus, setStatus } from "./core/presence";
import { setToken } from "./core/api";
import { startTour, TOURS } from "./modules/tour";

const VERSION = "0.10.0-alpha";

const APPS: Record<string, AppDef> = {
  compose: { id: "compose", title: t("compose"), icon: ICONS.compose, width: Math.max(560, Math.min(1220, innerWidth - 24 - 312 - 24)), height: Math.max(520, innerHeight - 150), x: 16, y: 44, mount: mountScoreEditor },
  import: { id: "import", title: t("import"), icon: ICONS.import, width: 760, height: 560, mount: mountImporter },
  visualizer: { id: "visualizer", title: t("visualizer"), icon: ICONS.visualizer, width: Math.min(1000, innerWidth - 80), height: Math.min(640, innerHeight - 140), mount: mountVisualizer },
  mixer: { id: "mixer", title: t("mixer"), icon: ICONS.export, width: 820, height: 460, mount: mountMixer },
  projects: { id: "projects", title: "Projetos salvos", icon: ICONS.folder, width: 860, height: 540, mount: mountProjects },
  library: { id: "library", title: t("library"), icon: ICONS.library, width: 900, height: 560, mount: mountLibrary },
  graph: { id: "graph", title: t("graph"), icon: ICONS.graph, width: 1100, height: 420, mount: mountGraph },
  agenda: { id: "agenda", title: t("agenda"), icon: ICONS.agenda, width: 820, height: 520, mount: mountAgenda },
  community: { id: "community", title: t("community"), icon: ICONS.community, width: 860, height: 540, mount: mountCommunity },
  account: { id: "account", title: t("account"), icon: ICONS.account, width: 460, height: 560, mount: mountAccount },
  admin: { id: "admin", title: t("admin"), icon: ICONS.admin, width: 920, height: 560, mount: mountAdmin },
};
const ORDER = ["compose", "projects", "props", "layers", "notes", "import", "mixer", "library", "graph", "agenda", "community", "admin", "account"];
// Funções administrativas: visíveis e acessíveis somente ao papel admin (o servidor também valida)
const ADMIN_ONLY = new Set(["graph", "admin"]);
const isAdmin = () => currentUser?.role === "admin";
const allowed = (id: string) => !ADMIN_ONLY.has(id) || isAdmin();
const titleOf = (id: string) => APPS[id]?.title ?? t(id);
const iconOf = (id: string) => APPS[id]?.icon ?? PANEL_ICONS[id];
const visible = () => ORDER.filter(allowed);
// Painéis da partitura (dock direito acoplável) — abrem como painel, não como janela
const PANEL_IDS = new Set(["props", "layers", "notes"]);
let panels: PanelDock;
const PANEL_ICONS: Record<string, string> = { props: ICONS.props, layers: ICONS.layers, notes: ICONS.notes, visualizer: ICONS.visualizer };
// No desktop, Mesa de Edição e Comunidade vivem no grupo de painéis laterais (acopláveis/flutuantes)
const DESKTOP_PANEL_ROUTE: Record<string, string> = { mixer: "mix", community: "chat", import: "imp" };
// conta e comunidade ficam na barra superior (menu do nome e ícone de presença), não no Dock
const DOCK_HIDE = new Set(["account", "community", "projects"]);
const open = (id: string) => {
  if (PANEL_IDS.has(id)) { panels?.reveal(id); return; }
  if (!isMobile() && DESKTOP_PANEL_ROUTE[id] && panels) { if (id === "community") document.body.classList.add("peek-float"); panels.reveal(DESKTOP_PANEL_ROUTE[id]); return; }
  if (!APPS[id]) return;
  if (!allowed(id)) { toast("Acesso restrito ao administrador", "warn"); return; }
  const fresh = !openWindows().some((w) => w.app.id === id);
  const w = openApp(APPS[id]);
  // a Composição abre maximizada (pauta com o máximo de espaço; o botão verde restaura)
  // a Composição é o centro do app: palco maximizado entre os ícones do desktop e as abas de painéis
  if (id === "compose" && !isMobile()) { w.el.classList.add("stage"); if (fresh) w.el.classList.add("max"); }
  return w;
};
/** Salva a composição aberta em "Projetos salvos" (conta ou, sem conta, neste navegador). */
async function saveNow() {
  try { const w = await saveProject(); toast(`“${store.score.title}” salvo em Projetos salvos${w === "navegador" ? " (neste navegador)" : ""}`, "ok"); }
  catch (e: any) { toast(e.message, "error"); }
}
addEventListener("keydown", (e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") { e.preventDefault(); saveNow(); } });
/** Nova composição: partitura vazia + editor aberto (confirma se já há notas). */
function newComposition() {
  const has = store.score.layers.some((l) => l.notes.length || l.kind === "recording");
  if (has && !confirm("Começar uma composição nova em uma pauta vazia? (o que já foi salvo continua na Biblioteca)")) return;
  store.startFromScratch("Nova composição");
  open("compose");
}
const guide = (name: string) => { if (name === "audio" || name === "image") { open("import"); dispatchEvent(new CustomEvent("import:preset", { detail: { tab: name, mode: "melody" } })); } else open("compose"); setTimeout(() => startTour(name, TOURS[name]), 500); };
// Ao sair/trocar de conta, fecha janelas administrativas abertas
addEventListener("auth", () => openWindows().forEach((w) => !allowed(w.app.id) && w.close()));

function menubar() {
  const clock = h("span", { class: "clock", "data-noi18n": "" });
  const tick = () => (clock.textContent = new Date().toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" }));
  tick(); setInterval(tick, 20000);
  const userBtn = userMenu();
  const menu = (label: string, items: [string, () => void][]) => {
    const dd = h("div", { class: "dropdown" }, ...items.map(([l, fn]) => h("button", { onclick: () => { dd.parentElement!.classList.remove("open"); fn(); } }, l)));
    const m = h("div", { class: "mb-menu" }, h("button", { class: "mb-item", onclick: (e: Event) => { e.stopPropagation(); document.querySelectorAll(".mb-menu.open").forEach((x) => x !== m && x.classList.remove("open")); m.classList.toggle("open"); } }, label), dd);
    return m;
  };
  const menuDyn = (label: string, items: () => [string, () => void][]) => {
    const m = menu(label, []);
    const dd = m.querySelector(".dropdown")!;
    m.querySelector(".mb-item")!.addEventListener("click", () => dd.replaceChildren(...items().map(([l, fn]) => h("button", { onclick: () => { m.classList.remove("open"); fn(); } }, l))));
    return m;
  };
  addEventListener("click", () => document.querySelectorAll(".mb-menu.open").forEach((x) => x.classList.remove("open")));
  return h("header", { class: "menubar" },
    h("button", { class: "mb-logo", onclick: () => about(), "aria-label": "Sobre o harmonIA" }, h("b", {}, "harmon"), h("i", {}, "IA")),
    menu("Arquivo", [["Nova composição", newComposition], ["Salvar ⌘S", () => saveNow()], ["Projetos salvos…", () => open("projects")], ["Abrir o editor de composição", () => open("compose")],
      ["Importar áudio / foto / cifra…", () => open("import")], ["Biblioteca", () => open("library")], ["Exportar…", () => open("mixer")]]),
    menu("Editar", [["Desfazer ⌘Z", () => store.undoOp()], ["Refazer ⇧⌘Z", () => store.redoOp()], ["Selecionar todos os compassos", () => { store.selectedMeasures = new Set([...Array(store.score.measures).keys()]); store.emit("selection"); }]]),
    menuDyn("Janelas", () => visible().map((id) => [(PANEL_IDS.has(id) ? "▸ Painel: " : "") + titleOf(id), () => open(id)] as [string, () => void])),
    menu("Ajuda", [["Passo a passo inicial", () => showWizard(open)], ["Guia: compor e harmonizar", () => guide("compose")], ["Guia: gravar a melodia", () => guide("record")],
      ["Guia: importar áudio", () => guide("audio")], ["Guia: importar imagem de partitura", () => guide("image")], ["Despertar o Maestro (assistente)", () => dispatchEvent(new CustomEvent("maestro:wake"))], ["Atalhos de teclado", shortcuts], ["Versão para celular", () => setPreference("mobile")], ["Detectar dispositivo automaticamente", () => setPreference("auto")],
      ["Texto maior (liga/desliga)", () => toggleLargeText()], ["Alto contraste (liga/desliga)", () => toggleContrast()], ["Sobre / versão", about]]),
    h("span", { class: "spacer" }), playerBar(() => open("compose")), h("span", { class: "spacer" }), tray(), communityMenu(), notifBell(), clock, userBtn);
}

/** Bandeja na barra de menus: janelas minimizadas (ponto colorido) e menus laterais recolhidos
 *  pelo modo foco (vidro desfocado). Clique restaura/mostra. */
const trayBox = h("div", { class: "mb-tray", role: "toolbar", "aria-label": "Abertos e minimizados" });
function tray() { return trayBox; }
function drawTray() {
  const chips: HTMLElement[] = [];
  for (const w of openWindows().filter((x) => x.el.classList.contains("min")))
    chips.push(h("button", { class: "tray-chip min", title: `${w.app.title} — minimizada (clique para abrir)`, onclick: () => restoreWindow(w) },
      h("i", { class: "dot", "aria-hidden": "true" }), h("span", { class: "tray-ic", html: w.app.icon }), h("span", {}, w.app.title)));
  const peek = (cls: string, label: string, icon: string, on: () => void) => h("button", { class: "tray-chip hidden-side" + (document.body.classList.contains(cls) ? " on" : ""), title: `${label} — recolhido (clique para mostrar)`,
    onclick: (e: Event) => { e.stopPropagation(); on(); drawTray(); }, "data-ic": icon, "aria-label": label }, h("i", { class: "blur-dot", "aria-hidden": "true" }), h("span", {}, icon + " " + label));

  if (panels?.isAway()) chips.push(peek("peek-rdock", "Painéis", "▦", () => document.body.classList.toggle("peek-rdock")));
  if (document.body.classList.contains("focus-mode") && document.querySelector(".panel.floating.discreet:not([hidden])"))
    chips.push(peek("peek-float", t("community"), "💬", () => document.body.classList.toggle("peek-float")));
  trayBox.replaceChildren(...chips);
  trayBox.hidden = !chips.length;
}
/** Modo foco: com uma janela aberta, os menus laterais que não fazem parte dela saem pela lateral
 *  (fica uma faixa translúcida; passar o mouse ou clicar na bandeja mostra de novo). */
function focusMode() {
  const apply = () => {
    if (isMobile()) { document.body.classList.remove("focus-mode", "hide-sidebar"); panels?.setAway(false); drawTray(); return; }
    const vis = openWindows().filter((w) => !w.el.classList.contains("min")).sort((a, b) => +b.el.style.zIndex - +a.el.style.zIndex);
    const top = vis[0];
    const any = !!top;
    document.body.classList.toggle("focus-mode", any);
    document.body.classList.remove("hide-sidebar");
    panels?.setAway(any && top.app.id !== "compose"); // os painéis da partitura só fazem parte da Composição
    if (!any) document.body.classList.remove("peek-sidebar", "peek-rdock", "peek-float");
    drawTray();
  };
  onWindowsChange(apply); addEventListener("layoutchange", apply);
  // clicar fora fecha as espiadas
  addEventListener("pointerdown", (e) => {
    const t0 = e.target as HTMLElement;
    if (t0.closest(".sidebar, .rdock, .mb-tray, .float-layer")) return;
    if (document.body.classList.contains("peek-sidebar") || document.body.classList.contains("peek-rdock") || document.body.classList.contains("peek-float")) {
      document.body.classList.remove("peek-sidebar", "peek-rdock", "peek-float"); drawTray();
    }
  });
  apply();
}

/** Menu do usuário (barra superior): dados da conta, privacidade e sair. */
function userMenu() {
  const dd = h("div", { class: "dropdown user-dd" });
  const btn = h("button", { class: "mb-item user-btn", "aria-haspopup": "menu" });
  const wrap = h("div", { class: "mb-menu" }, btn, dd);
  const go = (id: string) => () => { wrap.classList.remove("open"); open(id); };
  const draw = () => {
    btn.textContent = currentUser ? "👤 " + currentUser.name.split(" ")[0] + " ▾" : "Entrar";
    const guest = currentUser?.role === "guest" || currentUser?.guest;
    const ROLE: Record<string, string> = { admin: "Administrador", composer: "Compositor", student: "Estudante", viewer: "Ouvinte", guest: "Visitante" };
    dd.replaceChildren(...(currentUser ? [
      h("div", { class: "dd-head" }, h("b", {}, currentUser.name), h("small", {}, guest ? "Visitante (sem cadastro)" : currentUser.email || ""), h("small", { class: "chip" }, ROLE[currentUser.role] || currentUser.role)),
      h("button", { onclick: go("account") }, guest ? "✍️ Criar conta / entrar" : "👤 Minha conta e perfil"),
      h("button", { onclick: go("account") }, "🔒 Privacidade e meus dados (LGPD)"),
      h("button", { onclick: go("library") }, "📚 Minhas composições"),
      ...(isAdmin() ? [h("button", { onclick: go("admin") }, "🛡 Administração")] : []),
      h("hr"),
      h("button", { onclick: () => { wrap.classList.remove("open"); setToken("", null); } }, "↩ Sair")] : []));
  };
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!currentUser) { open("account"); return; }
    document.querySelectorAll(".mb-menu.open").forEach((x) => x !== wrap && x.classList.remove("open"));
    wrap.classList.toggle("open");
  });
  addEventListener("auth", draw); draw();
  return wrap;
}

/** Comunidade discreta na barra superior: seu estado (online/ausente/invisível), quem está online,
 *  chat e videochamada — abre o chat do compositor (painel) ao lado. */
function communityMenu() {
  const dot = h("i", { class: "cm-dot" });
  const count = h("small", { class: "cm-count" });
  const btn = h("button", { class: "cm-btn", "aria-haspopup": "dialog", title: "Comunidade: quem está online, chat e videochamada" }, h("span", { "aria-hidden": "true" }, "👥"), dot, count);
  const panel = h("div", { class: "cm-panel", role: "dialog", "aria-label": "Comunidade", hidden: true });
  const STATUS: Record<string, string> = { online: "🟢 Online", away: "🌙 Ausente", invisible: "👻 Invisível" };
  const draw = () => {
    const users = onlineUsers();
    const me = currentUser ? String(currentUser.id) : "";
    const st = myStatus();
    dot.className = "cm-dot " + (!isConnected() ? "off" : st);
    count.textContent = isConnected() ? String(users.length) : "";
    btn.setAttribute("aria-label", `Comunidade: ${isConnected() ? users.length + " online" : "desconectado"}`);
    panel.replaceChildren(
      h("header", {}, h("b", {}, "Comunidade"), h("small", {}, isConnected() ? `${users.length} online agora` : currentUser ? "conectando…" : "entre para ver quem está online")),
      currentUser ? h("div", { class: "cm-status", role: "radiogroup", "aria-label": "Seu estado" }, ...(["online", "away", "invisible"] as const).map((s) =>
        h("button", { class: st === s ? "on" : "", role: "radio", "aria-checked": String(st === s), onclick: () => setStatus(s) }, STATUS[s]))) : "",
      users.length ? h("ul", { class: "cm-list" }, ...users.map((u) => h("li", {}, h("i", { class: "cm-dot " + u.status }), h("span", {}, u.nick + (u.id === me ? " (você)" : "")),
        u.call ? h("small", { title: "em videochamada" }, "📹") : ""))) : h("p", { class: "hint" }, "Ninguém online no momento."),
      h("div", { class: "row" },
        h("button", { class: "btn primary", onclick: () => { panel.hidden = true; open("community"); } }, "💬 Chat"),
        h("button", { class: "btn", onclick: () => { panel.hidden = true; open("community"); setTimeout(() => dispatchEvent(new CustomEvent("community:call")), 700); } }, "📹 Videochamada")));
  };
  btn.addEventListener("click", (e) => { e.stopPropagation(); document.querySelectorAll(".mb-menu.open").forEach((x) => x.classList.remove("open")); panel.hidden = !panel.hidden; if (!panel.hidden) draw(); });
  panel.addEventListener("click", (e) => e.stopPropagation());
  addEventListener("click", () => (panel.hidden = true));
  onPresence(draw); draw();
  return h("div", { class: "cm-wrap" }, btn, panel);
}

/** Área de notificações: sino com contador e lista (transcrições, exportações, atualizações, avisos). */
function notifBell() {
  const badge = h("b", { class: "bell-badge", hidden: true });
  const panel = h("div", { class: "notif-panel", role: "dialog", "aria-label": "Notificações", hidden: true });
  const btn = h("button", { class: "bell", "aria-label": "Notificações", "aria-haspopup": "dialog" }, h("span", { "aria-hidden": "true" }, "🔔"), badge);
  const icon: Record<string, string> = { ok: "✅", warn: "⚠️", error: "❌", info: "ℹ️" };
  const draw = () => {
    const n = unread();
    badge.hidden = !n; badge.textContent = n > 9 ? "9+" : String(n);
    btn.setAttribute("aria-label", n ? `Notificações: ${n} não lidas` : "Notificações");
    const list = notifications();
    panel.replaceChildren(
      h("div", { class: "notif-head" }, h("b", {}, "Notificações"),
        h("button", { class: "btn ghost", onclick: () => markAllRead() }, "Marcar como lidas"),
        h("button", { class: "btn ghost", onclick: () => clearNotifications() }, "Limpar")),
      list.length ? h("ul", { class: "notif-list" }, ...list.slice(0, 40).map((x) => h("li", { class: x.read ? "" : "unread" },
        h("span", { "aria-hidden": "true" }, icon[x.kind]), h("div", {}, h("p", {}, x.title), x.body ? h("small", {}, x.body) : "",
          h("time", {}, new Date(x.at).toLocaleString(undefined, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }))))))
        : h("p", { class: "hint" }, "Nada por aqui ainda."));
  };
  btn.addEventListener("click", (e) => { e.stopPropagation(); panel.hidden = !panel.hidden; if (!panel.hidden) { draw(); setTimeout(markAllRead, 1500); } });
  panel.addEventListener("click", (e) => e.stopPropagation());
  addEventListener("click", () => (panel.hidden = true));
  onNotify(draw); draw();
  return h("div", { class: "bell-wrap" }, btn, panel);
}

function langbar() {
  const bar = h("div", { class: "langbar", role: "group", "aria-label": "Idioma" }, ...LANGS.map((l) =>
    h("button", { class: "flag" + (l.code === lang ? " on" : ""), title: l.name, "aria-label": l.name, "data-noi18n": "",
      onclick: async (e: Event) => { bar.querySelectorAll(".flag").forEach((b) => b.classList.remove("on")); (e.currentTarget as HTMLElement).classList.add("on"); await setLang(l.code); } }, l.flag)));
  return bar;
}

function sidebar() {
  const nav = h("nav", { class: "sidebar", "aria-label": "Navegação" });
  const draw = () => nav.replaceChildren(
    h("button", { class: "sb-toggle", title: "Recolher/expandir", onclick: () => document.body.classList.toggle("sb-collapsed") }, "☰"),
    ...visible().filter((id) => !PANEL_IDS.has(id)).map((id) => h("button", { class: "sb-item" + (openWindows().some((w) => w.app.id === id) ? " running" : ""), onclick: () => open(id), title: titleOf(id) },
      h("span", { class: "sb-ic", html: iconOf(id) }), h("span", { class: "sb-label", "data-i18n": id }, t(id)))));
  onWindowsChange(draw); addEventListener("auth", draw); draw();
  return nav;
}

function dock() {
  const d = h("footer", { class: "dock", role: "toolbar", "aria-label": "Dock" });
  const draw = () => {
    d.replaceChildren(...visible().filter((id) => !PANEL_IDS.has(id) && !DOCK_HIDE.has(id)).map((id) => {
      const running = openWindows().filter((w) => w.app.id === id);
      return h("button", { class: "dock-item" + (running.length ? " running" : ""), "aria-label": APPS[id].title,
        onclick: () => (running.length && running[0].el.classList.contains("min") ? restoreWindow(running[0]) : open(id)) },
        h("span", { class: "dock-ic", html: APPS[id].icon }), h("span", { class: "dock-tip", "data-i18n": id }, t(id)));
    }));
    // magnificação estilo macOS
    d.onpointermove = (e) => d.querySelectorAll<HTMLElement>(".dock-item").forEach((it) => {
      const r = it.getBoundingClientRect(); const dist = Math.abs(e.clientX - (r.left + r.width / 2));
      it.style.setProperty("--s", String(1 + Math.max(0, 1 - dist / 150) * 0.55));
    });
    d.onpointerleave = () => d.querySelectorAll<HTMLElement>(".dock-item").forEach((it) => it.style.setProperty("--s", "1"));
  };
  onWindowsChange(draw); addEventListener("auth", draw); draw();
  return d;
}

function desktopIcons() {
  const box = h("div", { class: "desk-icons" });
  const fresh = h("button", { class: "desk-icon new", title: "Abrir uma pauta nova (clique)", onclick: newComposition },
    h("span", { class: "new-ic", html: ICONS.compose }), h("small", {}, "Nova composição"));
  // pasta "Projetos salvos": tudo o que foi salvo (conta + navegador), com contador
  const count = h("i", { class: "desk-badge", hidden: true });
  const folder = h("button", { class: "desk-icon folder", title: "Projetos salvos — todas as composições salvas (clique para abrir)", onclick: () => open("projects") },
    h("span", { class: "new-ic", html: ICONS.folder }), count, h("small", {}, "Projetos salvos"));
  const recount = async () => { const n = (await listProjects()).length; count.hidden = !n; count.textContent = String(n); };
  onProjects(recount); addEventListener("auth", recount); setTimeout(recount, 600);
  const draw = () => box.replaceChildren(fresh, folder, ...([] as string[]).filter(allowed).map((id) =>
    h("button", { class: "desk-icon", ondblclick: () => open(id), onclick: (e: Event) => (e.currentTarget as HTMLElement).classList.toggle("sel") },
      h("span", { html: APPS[id].icon }), h("small", { "data-i18n": id }, t(id)))));
  addEventListener("auth", draw); draw();
  return box;
}

function shortcuts() {
  openApp({ id: "help", title: "Atalhos", icon: ICONS.maestro, width: 460, height: 420, mount: (b) => {
    b.append(h("table", { class: "kbd" }, ...[["Espaço", "Tocar / parar"], ["V N E C L A", "Ferramentas: mover, nota, apagar, cifra, letra, anotação"], ["1–5", "Duração: semibreve → semicolcheia"],
      ["↑ ↓ (Shift = oitava)", "Transpor notas selecionadas"], ["← →", "Mover no tempo"], ["Delete", "Apagar seleção"], ["⌘Z / ⇧⌘Z", "Desfazer / refazer"], ["⌘A", "Selecionar camada"],
      ["Alt + arrastar", "Duplicar nota"], ["⌘W", "Fechar janela"], ["Duplo clique no desktop", "Fecha a janela ativa"]].map(([k, v]) => h("tr", {}, h("td", {}, h("kbd", {}, k)), h("td", {}, v)))));
  } });
}
async function about() {
  let api_v = "offline";
  try { api_v = (await api("/api/health")).version; } catch { /* */ }
  toast(`harmonIA web ${VERSION} · API ${api_v} · harmonia.m3d.pro`, "info", 5000);
}

/** Rotas públicas: /s/<token> (link compartilhado) e /biblioteca (link principal). */
async function publicRoutes() {
  const m = location.pathname.match(/^\/s\/([\w-]+)/);
  if (m) {
    try {
      const r = await api(`/api/share/${m[1]}`);
      if (r.type === "composition") { store.load(r.score); open("compose"); toast(`"${r.title}" por ${r.author} — modo visualização. Toque ▶ para ouvir.`, "info", 7000); }
      else { open("library"); toast(`${r.kind === "album" ? "Álbum" : "Playlist"} compartilhado: ${r.title}`, "info"); }
    } catch (e: any) { toast(e.message, "error"); }
    return true;
  }
  if (location.pathname.startsWith("/biblioteca")) { open("library"); return true; }
  return false;
}

/** O servidor se atualiza sozinho; quando a versão muda, oferece recarregar sem perder o trabalho. */
function watchForUpdates() {
  let running = "";
  const check = async () => {
    try {
      const v = (await (await fetch("/api/health", { cache: "no-store" })).json()).version as string;
      if (!running) { running = v; return; }
      if (v && v !== running && !document.querySelector(".update-bar")) {
        const bar = h("div", { class: "update-bar", role: "status" },
          h("span", {}, `✨ Nova versão do harmonIA instalada (${v}).`),
          h("button", { class: "btn primary", onclick: async () => {
            if (currentUser && store.compositionId) {
              try { await api(`/api/compositions/${store.compositionId}`, { method: "PATCH", json: { score: store.score, version: store.version } }); } catch { /* segue */ }
            }
            location.reload();
          } }, "Recarregar agora"),
          h("button", { class: "btn ghost", onclick: () => bar.remove() }, "Depois"));
        document.body.append(bar);
      }
    } catch { /* offline: tenta de novo depois */ }
  };
  check();
  setInterval(check, 3 * 60 * 1000);
  addEventListener("focus", check);
}

// ============================================================ versão celular
// Início (lançador) + barra inferior fixa (polegar) + folha "Mais". Janelas abrem em tela cheia,
// "‹ Voltar" fecha; os painéis da partitura viram folha inferior.
function mobileShell() {
  const greet = h("p", { class: "m-greet" });
  const setGreet = () => (greet.textContent = currentUser ? `Olá, ${currentUser.name.split(" ")[0]}! O que vamos compor?` : "Bem-vindo ao harmonIA");
  addEventListener("auth", setGreet); setGreet();
  const tile = (id: string, sub: string) => h("button", { class: "m-tile", onclick: () => open(id) },
    h("span", { class: "m-tile-ic", html: iconOf(id) }), h("b", { "data-i18n": id }, t(id)), h("small", {}, sub));
  const tiles = h("div", { class: "m-tiles" });
  const drawTiles = () => tiles.replaceChildren(
    tile("compose", "Editar partitura"), tile("import", "Áudio, foto ou cifra"), tile("library", "Obras e playlists"),
    tile("mixer", "Ouvir e exportar"), tile("agenda", "Estudos e ensaios"), tile("community", "Chat e vídeo"),
    ...(allowed("admin") ? [tile("admin", "Usuários, IA, sistema")] : []), tile("account", currentUser ? "Perfil e privacidade" : "Entrar"));
  addEventListener("auth", drawTiles); drawTiles();
  const home = h("main", { class: "m-home", id: "m-home", "aria-label": "Início" },
    h("div", { class: "m-home-top" }, h("div", { class: "m-brand" }, h("b", {}, "harmon"), h("i", {}, "IA")), notifBell()), greet, tiles);

  const more = h("div", { class: "m-sheet", role: "dialog", "aria-modal": "true", "aria-label": "Mais opções", hidden: true });
  const closeMore = () => { more.hidden = true; };
  const drawMore = () => more.replaceChildren(
    h("div", { class: "m-sheet-head" }, h("b", {}, "Mais"), h("button", { class: "sheet-close", "aria-label": "Fechar", onclick: closeMore }, "✕")),
    h("div", { class: "m-list" }, ...visible().filter((id) => !PANEL_IDS.has(id) && !["compose", "import"].includes(id)).map((id) =>
      h("button", { onclick: () => { closeMore(); open(id); } }, h("span", { class: "m-li-ic", html: iconOf(id) }), h("span", { "data-i18n": id }, t(id))))),
    h("h5", {}, "Idioma"),
    h("div", { class: "m-flags", "data-noi18n": "" }, ...LANGS.map((l) => h("button", { class: "flag" + (l.code === lang ? " on" : ""), "aria-label": l.name, "aria-pressed": String(l.code === lang),
      onclick: async () => { closeMore(); await setLang(l.code); } }, l.flag, h("small", {}, l.name)))),
    h("h5", {}, "Acessibilidade"),
    h("div", { class: "m-list" },
      h("button", { "aria-pressed": String(document.body.classList.contains("large-text")), onclick: () => { toggleLargeText(); drawMore(); } }, "🔠 Texto maior", h("small", {}, document.body.classList.contains("large-text") ? "ligado" : "desligado")),
      h("button", { "aria-pressed": String(document.body.classList.contains("high-contrast")), onclick: () => { toggleContrast(); drawMore(); } }, "◐ Alto contraste", h("small", {}, document.body.classList.contains("high-contrast") ? "ligado" : "desligado")),
      h("button", { onclick: () => { closeMore(); setPreference("desktop"); toast("Versão desktop ativada. Para voltar: Ajuda → Versão para celular", "info", 5000); } }, "🖥 Usar versão desktop", h("small", {}, preference() === "auto" ? "detecção automática" : "escolha fixa")),
      h("button", { onclick: () => { closeMore(); showWizard(open); } }, "🧭 Passo a passo inicial"),
      h("button", { onclick: () => { closeMore(); shortcuts(); } }, "⌨️ Atalhos e ajuda")));

  const tab = (id: string, label: string, icon: string, fn: () => void) => h("button", { class: "m-tab", "data-tab": id, "aria-label": label, onclick: fn },
    h("span", { class: "m-tab-ic", "aria-hidden": "true" }, icon), h("small", {}, label));
  const tabbar = h("nav", { class: "m-tabbar", "aria-label": "Navegação principal" },
    tab("home", "Início", "⌂", () => { closeMore(); panels.toggleSheet(false); minimizeAll(); }),
    tab("compose", "Compor", "♫", () => { closeMore(); panels.toggleSheet(false); open("compose"); }),
    tab("import", "Importar", "⇪", () => { closeMore(); panels.toggleSheet(false); open("import"); }),
    tab("panels", "Painéis", "☰", () => { closeMore(); panels.toggleSheet(); }),
    tab("more", "Mais", "⋯", () => { panels.toggleSheet(false); if (more.hidden) { drawMore(); more.hidden = false; (more.querySelector("button") as HTMLElement)?.focus(); } else closeMore(); }));
  const markTab = () => {
    const top = openWindows().filter((w) => !w.el.classList.contains("min")).sort((a, b) => +b.el.style.zIndex - +a.el.style.zIndex)[0];
    const cur = !more.hidden ? "more" : document.body.classList.contains("sheet-open") ? "panels" : top ? (["compose", "import"].includes(top.app.id) ? top.app.id : "") : "home";
    tabbar.querySelectorAll<HTMLElement>(".m-tab").forEach((b) => { const on = b.dataset.tab === cur; b.classList.toggle("on", on); b.setAttribute("aria-current", on ? "page" : "false"); });
    document.body.classList.toggle("m-has-window", !!top);
  };
  onWindowsChange(markTab); addEventListener("sheetchange", markTab);
  new MutationObserver(markTab).observe(more, { attributes: true, attributeFilter: ["hidden"] });
  addEventListener("keydown", (e) => { if (e.key === "Escape") { closeMore(); panels?.toggleSheet(false); } });
  setTimeout(markTab, 0);
  const mPlayer = h("div", { class: "m-player" }, playerBar(() => open("compose"), false));
  return [home, more, mPlayer, tabbar];
}

async function boot() {
  installIconDefs();
  installTips();
  initDevice();
  const app = document.getElementById("app")!;
  const winLayer = h("div", { class: "win-layer", id: "main-content" });
  const skip = h("a", { class: "skip-link", href: "#main-content" }, "Pular para o conteúdo");
  // o Dock é o único lançador (o menu lateral esquerdo repetia os mesmos itens e foi removido)
  app.append(skip, menubar(), langbar(), desktopIcons(), winLayer, dock());
  void sidebar;
  initWM(winLayer);
  panels = new PanelDock(app);
  panels.register([
    { id: "props", title: t("props"), icon: ICONS.props, mount: mountProperties },
    { id: "layers", title: t("layers"), icon: ICONS.layers, mount: mountLayers },
    { id: "notes", title: t("notes"), icon: ICONS.notes, mount: mountAnnotations },
    { id: "imp", title: t("import"), icon: ICONS.import, mount: mountImporter, defaultMode: "hidden" },
    { id: "study", title: "Estudo", icon: ICONS.study, mount: mountStudy },
    { id: "learn", title: "Aprender", icon: ICONS.trophy, mount: mountLearn },
    { id: "mix", title: t("mixer"), icon: ICONS.export, mount: mountMixer, defaultCollapsed: true },
    // quadro discreto e móvel no fundo da área de trabalho; pode ser fechado ou acoplado ao menu lateral
    { id: "chat", title: t("community"), icon: ICONS.community, mount: mountCommunityPanel, defaultMode: "floating", discreet: true, defaultCollapsed: true,
      defaultRect: { x: 214, y: Math.max(120, innerHeight - 150), w: 300, h: 320 } },
  ]);
  app.append(...mobileShell());
  watchI18n(winLayer);
  mountAvatar();
  mountTaskHub();
  addEventListener("layoutchange", (e: any) => toast(e.detail === "mobile" ? "📱 Layout para celular ativado" : "🖥 Layout desktop ativado", "info", 2200));
  addEventListener("open-app", (e: any) => open(e.detail));
  addEventListener("harmonia:action", (e: any) => {
    if (e.detail === "open-layers") panels.reveal("layers");
    // barra de estudo da Composição → painel Estudo na seção certa
    if (typeof e.detail === "string" && e.detail.startsWith("study:")) { panels.reveal("study"); setTimeout(() => dispatchEvent(new CustomEvent("study:section", { detail: e.detail.slice(6) })), 150); }
    if (e.detail === "open-import") panels.reveal("imp");
    if (e.detail === "open-learn") panels.reveal("learn");
  });
  // Os painéis de edição (Propriedades, Camadas…) não começam abertos: aparecem com o editor e recolhem quando ele fecha
  let composeShown = false;
  onWindowsChange(() => {
    const on = openWindows().some((w) => w.app.id === "compose" && !w.el.classList.contains("min"));
    if (on !== composeShown) { composeShown = on; if (!isMobile()) panels.setDockOpen(on); }
  });
  // o antigo "pentagrama do desktop" virou a própria Composição, aberta no centro ao iniciar
  if (!isMobile()) setTimeout(() => { if (!openWindows().some((w) => w.app.id === "compose")) open("compose"); }, 250);
  focusMode();
  // autosave remoto da composição aberta
  store.on(async (r) => {
    if (r !== "autosave" || !currentUser || !store.compositionId) return;
    try { const x = await api(`/api/compositions/${store.compositionId}`, { method: "PATCH", json: { score: store.score, version: store.version } }); store.version = x.version; dispatchEvent(new CustomEvent("projects-changed")); }
    catch (e: any) { toast("Autosave: " + e.message, "warn"); }
  });
  document.addEventListener("visibilitychange", () => document.hidden && audio.stop());
  watchForUpdates();
  // aviso ao administrador quando o servidor não consegue gravar arquivos (envio de áudio/imagem falharia)
  setTimeout(async () => { try { const hc = await api("/api/health"); if (hc.storage === false && isAdmin()) toast("⚠️ O servidor não consegue gravar na pasta de mídia: envios vão falhar. Rode a atualização na VPS (corrige a permissão).", "warn", 12000); } catch { /* */ } }, 4000);
  await restoreSession();
  connectPresence();
  // Fluxo de entrada: link público → abre direto; sem sessão → tela de login/visitante;
  // usuário novo → passo a passo; senão → estação completa (desktop) ou Início (celular).
  const start = () => {
    if (needsOnboarding()) { showWizard(open); return; }
    // desktop: o editor não abre sozinho — o pentagrama do desktop mostra a composição e o editor é aberto quando solicitado
  };
  if (!(await publicRoutes())) {
    if (!currentUser) showLogin(start); else start();
  }
  addEventListener("auth", (e: any) => { if (!e.detail) showLogin(start); });
  if (lang !== "pt") setLang(lang);
}
boot();
if (import.meta.env.DEV) (window as any).__store = store; // só para testes locais
