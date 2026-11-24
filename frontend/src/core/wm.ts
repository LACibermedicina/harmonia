// Gerenciador de janelas estilo macOS: arrastar, redimensionar, foco, minimizar ao Dock, maximizar,
// e fechamento por duplo clique fora (no desktop) da janela ativa.
import { h } from "./ui";

export interface AppDef {
  id: string;
  title: string;
  icon: string; // SVG
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  singleton?: boolean;
  mount: (body: HTMLElement, win: Win) => void | (() => void);
}

export interface Win {
  id: string;
  app: AppDef;
  el: HTMLElement;
  body: HTMLElement;
  close: () => void;
  focus: () => void;
  setTitle: (t: string) => void;
}

const wins = new Map<string, Win>();
let z = 100;
let layer: HTMLElement;
const listeners = new Set<() => void>();
export const onWindowsChange = (fn: () => void) => listeners.add(fn);
const changed = () => listeners.forEach((f) => f());
export const openWindows = () => [...wins.values()];

export function initWM(root: HTMLElement) {
  layer = root;
  // duplo clique fora (área livre do desktop) fecha a janela em foco
  root.parentElement!.addEventListener("dblclick", (e) => {
    const t = e.target as HTMLElement;
    if (t.closest(".win, .dock, .menubar, .langbar, .avatar-wrap, .desk-icon")) return;
    const top = [...wins.values()].filter((w) => !w.el.classList.contains("min")).sort((a, b) => +b.el.style.zIndex - +a.el.style.zIndex)[0];
    top?.close();
  });
  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "w") {
      const f = document.querySelector<HTMLElement>(".win.focused");
      if (f) { e.preventDefault(); wins.get(f.dataset.win!)?.close(); }
    }
  });
}

export function openApp(app: AppDef): Win {
  if (app.singleton !== false) {
    const ex = [...wins.values()].find((w) => w.app.id === app.id);
    if (ex) { ex.el.classList.remove("min"); ex.focus(); return ex; }
  }
  const id = app.id + "-" + Math.random().toString(36).slice(2, 7);
  const W = Math.min(app.width || 720, innerWidth - 40);
  const H = Math.min(app.height || 480, innerHeight - 130);
  const n = wins.size;
  const x = app.x ?? Math.max(20, (innerWidth - W) / 2 + (n % 6) * 26 - 60);
  const y = app.y ?? Math.max(38, (innerHeight - H) / 2 + (n % 6) * 22 - 40);

  const title = h("div", { class: "win-title" }, app.title);
  const lights = h("div", { class: "lights" },
    h("button", { class: "l close", "aria-label": "Fechar / voltar", title: "Fechar (⌘W)" }, h("span", { class: "back-label", "aria-hidden": "true" }, "‹ Voltar")),
    h("button", { class: "l min", "aria-label": "Minimizar", title: "Minimizar" }),
    h("button", { class: "l max", "aria-label": "Maximizar", title: "Maximizar" }));
  const bar = h("header", { class: "win-bar" }, lights, h("span", { class: "win-icon", html: app.icon }), title);
  const body = h("div", { class: "win-body" });
  const el = h("section", { class: "win opening", "data-win": id, role: "dialog", "aria-label": app.title,
    style: { left: x + "px", top: y + "px", width: W + "px", height: H + "px", zIndex: String(++z) } }, bar, body);
  for (const d of ["n", "s", "e", "w", "ne", "nw", "se", "sw"]) el.append(h("div", { class: `rz rz-${d}`, "data-dir": d }));
  layer.append(el);
  requestAnimationFrame(() => el.classList.remove("opening"));

  let cleanup: void | (() => void);
  const win: Win = {
    id, app, el, body,
    close: () => {
      el.classList.add("closing");
      setTimeout(() => { el.remove(); typeof cleanup === "function" && cleanup(); }, 180);
      wins.delete(id);
      // no celular as janelas ocupam a tela toda: ao voltar, a anterior assume o foco
      if (document.body.classList.contains("mobile")) {
        const next = [...wins.values()].filter((w) => !w.el.classList.contains("min")).sort((a, b) => +b.el.style.zIndex - +a.el.style.zIndex)[0];
        next?.focus();
      }
      changed();
    },
    focus: () => {
      document.querySelectorAll(".win.focused").forEach((w) => w.classList.remove("focused"));
      el.classList.add("focused"); el.style.zIndex = String(++z); changed();
    },
    setTitle: (t) => (title.textContent = t),
  };
  wins.set(id, win);
  el.addEventListener("pointerdown", () => win.focus());
  lights.querySelector(".close")!.addEventListener("click", (e) => { e.stopPropagation(); win.close(); });
  lights.querySelector(".min")!.addEventListener("click", (e) => { e.stopPropagation(); el.classList.add("min"); changed(); });
  const toggleMax = () => el.classList.toggle("max");
  lights.querySelector(".max")!.addEventListener("click", (e) => { e.stopPropagation(); toggleMax(); });
  bar.addEventListener("dblclick", toggleMax);

  // arrastar pela barra
  bar.addEventListener("pointerdown", (e) => {
    if ((e.target as HTMLElement).closest("button") || el.classList.contains("max") || document.body.classList.contains("mobile")) return;
    const sx = e.clientX - el.offsetLeft, sy = e.clientY - el.offsetTop;
    bar.setPointerCapture(e.pointerId);
    el.classList.add("dragging");
    const mv = (ev: PointerEvent) => {
      el.style.left = Math.min(innerWidth - 80, Math.max(-W + 120, ev.clientX - sx)) + "px";
      el.style.top = Math.min(innerHeight - 60, Math.max(30, ev.clientY - sy)) + "px";
    };
    const up = () => { el.classList.remove("dragging"); bar.removeEventListener("pointermove", mv); bar.removeEventListener("pointerup", up); };
    bar.addEventListener("pointermove", mv); bar.addEventListener("pointerup", up);
  });
  // redimensionar pelas bordas
  el.querySelectorAll<HTMLElement>(".rz").forEach((rz) => rz.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
    if (document.body.classList.contains("mobile")) return;
    const d = rz.dataset.dir!;
    const r0 = el.getBoundingClientRect(), sx = e.clientX, sy = e.clientY;
    rz.setPointerCapture(e.pointerId);
    const mv = (ev: PointerEvent) => {
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      if (d.includes("e")) el.style.width = Math.max(320, r0.width + dx) + "px";
      if (d.includes("s")) el.style.height = Math.max(200, r0.height + dy) + "px";
      if (d.includes("w")) { const w = Math.max(320, r0.width - dx); el.style.width = w + "px"; el.style.left = r0.right - w + "px"; }
      if (d.includes("n")) { const hh = Math.max(200, r0.height - dy); el.style.height = hh + "px"; el.style.top = r0.bottom - hh + "px"; }
      el.dispatchEvent(new CustomEvent("resize"));
    };
    const up = () => { rz.removeEventListener("pointermove", mv); rz.removeEventListener("pointerup", up); };
    rz.addEventListener("pointermove", mv); rz.addEventListener("pointerup", up);
  }));

  cleanup = app.mount(body, win);
  win.focus();
  return win;
}

export function restoreWindow(w: Win) { w.el.classList.remove("min"); w.focus(); }

/** Celular: minimiza todas as janelas (volta para a tela Início). */
export function minimizeAll() { wins.forEach((w) => w.el.classList.add("min")); changed(); }
