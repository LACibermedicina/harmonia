// Utilitários de DOM e notificações.
import { notify } from "./notify";
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, any> = {}, ...children: (Node | string | null | undefined | false)[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "style" && typeof v === "object") {
      for (const [sk, sv] of Object.entries(v)) {
        if (sk.startsWith("--")) el.style.setProperty(sk, String(sv)); else (el.style as any)[sk] = sv;
      }
    }
    else if (k === "html") el.innerHTML = v;
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c as any);
  return el;
}

export function toast(msg: string, kind: "info" | "ok" | "warn" | "error" = "info", ms = 3800) {
  if (ms >= 3000 || kind !== "info") notify(msg, { kind }); // mensagens relevantes ficam na central
  let box = document.getElementById("toasts");
  if (!box) { box = h("div", { id: "toasts" }); document.body.append(box); }
  const t = h("div", { class: `toast ${kind}`, role: "status" }, msg);
  box.append(t);
  setTimeout(() => { t.classList.add("out"); setTimeout(() => t.remove(), 400); }, ms);
}

export function busy(btn: HTMLButtonElement, on: boolean, label?: string) {
  if (on) { if (btn.dataset.busy !== "1") btn.dataset.html = btn.innerHTML; btn.dataset.busy = "1"; btn.disabled = true; btn.innerHTML = `<span class="spin"></span>${label || ""}`; }
  else { btn.disabled = false; btn.dataset.busy = ""; btn.innerHTML = btn.dataset.html || ""; }
}

export function download(blob: Blob, name: string) {
  const a = h("a", { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/** Coloca um ícone 3D pequeno antes do texto de um botão (padrão visual único do app). */
export function withIcon<T extends HTMLElement>(el: T, svg: string): T {
  el.classList.add("has-ic"); el.prepend(h("span", { class: "bi", "aria-hidden": "true", html: svg })); return el;
}

/** Tooltip didático: explica o conceito musical por trás do controle. */
export function tip(el: HTMLElement, text: string) { el.dataset.tip = text; return el; }

/** Dicas flutuantes num só lugar do documento: nunca são cortadas por janelas/painéis com rolagem.
 *  Ficam ao lado de barras laterais e abaixo dos demais controles, sempre dentro da tela. */
export function installTips() {
  if (document.getElementById("tipbox")) return;
  const box = h("div", { id: "tipbox", role: "tooltip", hidden: true });
  document.body.append(box);
  let cur: HTMLElement | null = null, timer = 0;
  const hide = () => { clearTimeout(timer); cur = null; box.hidden = true; };
  const show = (el: HTMLElement) => {
    const text = el.dataset.tip || ""; if (!text || document.body.classList.contains("mobile")) return;
    const m = text.match(/^(.{2,60}?)\s+[—:-]\s+(.+)$/s);
    box.replaceChildren(...(m ? [h("b", {}, m[1]), h("span", {}, m[2])] : [h("span", {}, text)]));
    box.hidden = false; box.className = "";
    const r = el.getBoundingClientRect(), bw = box.offsetWidth, bh = box.offsetHeight, W = innerWidth, H = innerHeight, gap = 10;
    const side = !!el.closest(".rail, .toolbox, .rdock-strip, .taskhub") || r.left < 120;
    let x: number, y: number;
    if (side) {
      const right = r.right + gap + bw < W;
      x = right ? r.right + gap : r.left - gap - bw; y = r.top + r.height / 2 - bh / 2; box.classList.add(right ? "at-right" : "at-left");
    } else {
      const below = r.bottom + gap + bh < H;
      x = r.left + r.width / 2 - bw / 2; y = below ? r.bottom + gap : r.top - gap - bh; box.classList.add(below ? "at-below" : "at-above");
    }
    box.style.left = Math.max(8, Math.min(W - bw - 8, x)) + "px";
    box.style.top = Math.max(8, Math.min(H - bh - 8, y)) + "px";
  };
  document.addEventListener("pointerover", (e) => {
    const el = (e.target as HTMLElement).closest?.("[data-tip]") as HTMLElement | null;
    if (el === cur) return;
    hide(); if (!el) return;
    cur = el; timer = window.setTimeout(() => cur === el && show(el), 350);
  });
  document.addEventListener("focusin", (e) => { const el = (e.target as HTMLElement).closest?.("[data-tip]") as HTMLElement | null; if (el) { cur = el; show(el); } });
  for (const ev of ["pointerdown", "scroll", "keydown", "focusout"]) document.addEventListener(ev, hide, true);
}
