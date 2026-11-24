// Dock lateral direito com painéis acopláveis (estilo IDE/DAW profissional):
//  • painéis empilhados no dock, recolhíveis (▾) e reordenáveis arrastando o cabeçalho;
//  • arraste para fora do dock (ou ⇱ / duplo clique) → painel flutuante, movível e redimensionável;
//  • arraste de volta sobre o dock → reacopla na posição indicada pela linha guia;
//  • dock recolhível em faixa de ícones (como o menu lateral esquerdo); layout salvo por navegador.
import { h } from "./ui";

export interface PanelDef {
  id: string; title: string; icon: string; mount: (body: HTMLElement) => void | (() => void); minH?: number;
  /** estado inicial (antes de o usuário mexer): acoplado, flutuante discreto ou fechado */
  defaultMode?: Mode; defaultRect?: { x: number; y: number; w: number; h: number }; discreet?: boolean; defaultCollapsed?: boolean;
}
type Mode = "docked" | "floating" | "hidden" | "icon"; // icon = iconizado: vira aba vertical; passar o mouse abre
interface PState { mode: Mode; collapsed: boolean; x: number; y: number; w: number; h: number; dh?: number; max?: boolean; }
interface Layout { order: string[]; panels: Record<string, PState>; dockCollapsed: boolean; }
interface P { def: PanelDef; el: HTMLElement; body: HTMLElement; st: PState; }

const KEY = "harmonia.panels.v2";
const DOCK_W = 312, STRIP_W = 52;

export class PanelDock {
  private dock = h("aside", { class: "rdock", "aria-label": "Painéis da partitura" });
  private stack = h("div", { class: "rdock-stack" });
  private strip = h("div", { class: "rdock-strip" });
  private floatLayer = h("div", { class: "float-layer" });
  private guide = h("div", { class: "drop-guide", hidden: true });
  private icons = h("div", { class: "rdock-icons", "aria-label": "Painéis iconizados" });
  private peekBox = h("div", { class: "rdock-peek", hidden: true });
  private peeking: string | null = null;
  private peekTimer = 0;
  private panels = new Map<string, P>();
  private layout: Layout;
  private topZ = 9100;

  constructor(root: HTMLElement) {
    let saved: Layout | null = null;
    try { saved = JSON.parse(localStorage.getItem(KEY) || "null"); } catch { /* layout corrompido */ }
    this.layout = saved || { order: [], panels: {}, dockCollapsed: true }; // começa contraído: os painéis aparecem quando solicitados
    const head = h("div", { class: "rdock-head" },
      h("button", { class: "sb-toggle", title: "Recolher/expandir painéis", onclick: () => this.setCollapsed(!this.layout.dockCollapsed) }, "☰"),
      h("b", {}, "Painéis"),
      h("button", { class: "ic-btn ghost", title: "Restaurar layout padrão", onclick: () => this.reset() }, "↺"),
      h("button", { class: "sheet-close", "aria-label": "Fechar painéis", onclick: () => this.toggleSheet(false) }, "✕"));
    this.dock.append(head, this.icons, this.stack, this.strip, this.guide, this.peekBox);
    this.peekBox.addEventListener("pointerenter", () => clearTimeout(this.peekTimer));
    this.peekBox.addEventListener("pointerleave", () => this.unpeekSoon());
    root.append(this.dock, this.floatLayer);
    addEventListener("resize", () => this.panels.forEach((p) => p.st.mode === "floating" && this.clamp(p)));
    addEventListener("layoutchange", () => this.apply());
    addEventListener("keydown", (e) => { if (e.key === "Escape") { let ch = false; this.panels.forEach((p) => { if (p.st.max) { p.st.max = false; ch = true; } }); if (ch) this.apply(); } });
  }

  register(defs: PanelDef[]) {
    for (const d of defs) {
      const r0 = d.defaultRect || { x: innerWidth - 700, y: 120, w: 300, h: 380 };
      const st: PState = this.layout.panels[d.id] || { mode: d.defaultMode || "docked", collapsed: !!d.defaultCollapsed, ...r0 };
      this.layout.panels[d.id] = st;
      if (!this.layout.order.includes(d.id)) this.layout.order.push(d.id);
      const body = h("div", { class: "panel-body" });
      const btnDock = h("button", { class: "p-btn", title: "Destacar / reacoplar (duplo clique no título)", onclick: () => this.toggleFloat(d.id) });
      const btnCol = h("button", { class: "p-btn", title: "Recolher", onclick: () => { st.collapsed = !st.collapsed; this.apply(); } }, "▾");
      const btnIcon = h("button", { class: "p-btn p-icon", title: "Iconizar — vira uma aba vertical na lateral; passe o mouse para abrir", onclick: () => { st.mode = st.mode === "icon" ? "docked" : "icon"; st.max = false; this.peeking = null; this.apply(); } }, "▭");
      const btnMax = h("button", { class: "p-btn p-max", title: "Maximizar / restaurar (Esc restaura)", onclick: () => { st.max = !st.max; if (st.max) st.collapsed = false; this.apply(); } }, "⤢");
      const head = h("header", { class: "panel-head" },
        h("span", { class: "grip", "aria-hidden": "true" }, "⋮⋮"), h("span", { class: "p-ic", html: d.icon }), h("b", { "data-i18n": d.id }, d.title),
        h("span", { class: "spacer" }), btnCol, btnDock, btnIcon, btnMax,
        h("button", { class: "p-btn", title: "Fechar painel", onclick: () => { st.mode = "hidden"; st.max = false; this.apply(); } }, "✕"));
      // alça de redimensionar: altura quando acoplado; largura e altura quando flutuante
      const grip = h("div", { class: "p-resize", title: "Arraste para redimensionar", "aria-hidden": "true" });
      const el = h("section", { class: "panel" + (d.discreet ? " discreet" : ""), "data-panel": d.id, role: "region", "aria-label": d.title }, head, body, grip);
      grip.addEventListener("pointerdown", (e) => {
        e.preventDefault(); e.stopPropagation();
        const r0 = el.getBoundingClientRect(), sx = e.clientX, sy = e.clientY;
        grip.setPointerCapture(e.pointerId);
        const mv = (ev: PointerEvent) => {
          const hh = Math.max(90, r0.height + ev.clientY - sy);
          if (st.mode === "floating") { st.w = Math.max(240, r0.width + ev.clientX - sx); st.h = hh; Object.assign(el.style, { width: st.w + "px", height: st.h + "px" }); }
          else { st.dh = hh; el.style.flex = `0 0 ${hh}px`; }
        };
        const up = () => { grip.removeEventListener("pointermove", mv); grip.removeEventListener("pointerup", up); this.save(); };
        grip.addEventListener("pointermove", mv); grip.addEventListener("pointerup", up);
      });
      head.addEventListener("dblclick", (e) => { if (!(e.target as HTMLElement).closest("button")) { if (st.max) { st.max = false; this.apply(); } else this.toggleFloat(d.id); } });
      head.addEventListener("pointerdown", (e) => this.startDrag(e, d.id));
      el.addEventListener("pointerdown", () => { if (st.mode === "floating") el.style.zIndex = String(++this.topZ); });
      new ResizeObserver(() => { if (st.mode === "floating" && el.offsetWidth) { st.w = el.offsetWidth; st.h = el.offsetHeight; this.save(); } }).observe(el);
      this.panels.set(d.id, { def: d, el, body, st });
      d.mount(body);
    }
    this.apply();
  }

  /** Mostra e destaca o painel (acoplado ou flutuante). */
  reveal(id: string) {
    const p = this.panels.get(id); if (!p) return;
    if (this.mobile()) this.toggleSheet(true);
    if (p.st.mode === "icon" && !this.mobile()) { this.peek(id, true); return; }
    if (p.st.mode === "hidden" || p.st.mode === "icon") p.st.mode = "docked";
    p.st.collapsed = false;
    // acordeão: ao abrir um painel no dock, os outros acoplados recolhem (o aberto ganha espaço)
    if (p.st.mode === "docked" && !this.mobile()) this.panels.forEach((q, qid) => { if (qid !== id && q.st.mode === "docked") q.st.collapsed = true; });
    if (p.st.mode === "docked") this.layout.dockCollapsed = false;
    this.apply();
    p.el.classList.add("flash"); setTimeout(() => p.el.classList.remove("flash"), 700);
    p.el.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  /** Abre o painel como aba vertical aberta (ao lado da faixa), sem tirar do lugar. */
  private peek(id: string, sticky = false, anchor?: HTMLElement) {
    if (this.mobile()) { this.reveal(id); return; }
    clearTimeout(this.peekTimer);
    const p = this.panels.get(id); if (!p) return;
    if (this.peeking && this.peeking !== id) { this.peeking = null; this.apply(); }
    this.peeking = id;
    p.el.hidden = false; p.el.classList.remove("collapsed", "floating", "maxed"); p.el.removeAttribute("style");
    this.peekBox.replaceChildren(p.el);
    this.peekBox.hidden = false; this.dock.classList.add("peeking");
    const dr = this.dock.getBoundingClientRect();
    const ar = anchor?.getBoundingClientRect();
    const top = ar ? Math.max(0, Math.min(ar.top - dr.top - 8, dr.height - 160)) : 0;
    this.peekBox.style.top = top + "px";
    this.peekBox.classList.toggle("sticky", sticky);
    this.strip.querySelectorAll(".strip-btn").forEach((b) => b.classList.toggle("peek", (b as HTMLElement).dataset.id === id));
    this.icons.querySelectorAll(".icon-tab").forEach((b) => b.classList.toggle("peek", (b as HTMLElement).dataset.id === id));
  }
  private unpeekSoon() {
    clearTimeout(this.peekTimer);
    this.peekTimer = window.setTimeout(() => {
      if (!this.peeking || this.peekBox.matches(":hover") || this.peekBox.contains(document.activeElement) && this.peekBox.classList.contains("sticky")) return;
      this.peeking = null; this.peekBox.hidden = true; this.apply();
    }, 380);
  }

  private toggleFloat(id: string) {
    const p = this.panels.get(id)!;
    if (p.st.mode === "floating") { p.st.mode = "docked"; }
    else {
      const r = p.el.getBoundingClientRect();
      Object.assign(p.st, { mode: "floating", x: r.left - 340, y: r.top + 10, w: 300, h: Math.max(240, Math.min(480, r.height)) });
    }
    this.apply();
  }

  private setCollapsed(v: boolean) { this.layout.dockCollapsed = v; this.apply(); }
  /** Abre/contrai o dock (ex.: abre junto com a janela de Composição e contrai quando ela fecha). */
  private away = false;
  /** Modo foco: o dock sai pela lateral (fica só uma faixa translúcida; passar o mouse mostra). */
  setAway(v: boolean) { if (this.away === v) return; this.away = v; this.apply(); }
  isAway() { return this.away; }
  setDockOpen(open: boolean) { if (this.layout.dockCollapsed === !open) return; this.layout.dockCollapsed = !open; this.apply(); }

  private reset() {
    localStorage.removeItem(KEY);
    this.layout.dockCollapsed = false;
    this.layout.order = [...this.panels.keys()];
    this.panels.forEach((p) => Object.assign(p.st, { mode: "docked", collapsed: false }));
    this.apply();
  }

  private mobile() { return document.body.classList.contains("mobile"); }

  /** Celular: abre/fecha a folha inferior com os painéis. */
  toggleSheet(open?: boolean) {
    const on = open ?? !document.body.classList.contains("sheet-open");
    document.body.classList.toggle("sheet-open", on);
    dispatchEvent(new CustomEvent("sheetchange", { detail: on }));
  }

  private apply() {
    const mobile = this.mobile();
    const docked = this.layout.order.filter((id) => this.panels.get(id)?.st.mode === "docked");
    for (const id of this.layout.order) {
      const p = this.panels.get(id); if (!p) continue;
      const { el, st } = p;
      if (this.peeking === id) continue; // aberto como aba vertical
      if (st.mode === "icon" && !mobile) { el.hidden = true; el.removeAttribute("style"); this.stack.append(el); continue; }
      el.classList.toggle("collapsed", st.collapsed);
      const floating = st.mode === "floating" && !mobile; // no celular tudo fica na folha inferior
      el.classList.toggle("floating", floating);
      el.hidden = st.mode === "hidden";
      (el.querySelector(".p-icon") as HTMLElement).textContent = st.mode === "icon" ? "▣" : "▭";
      const maxed = !!st.max && !mobile && st.mode !== "hidden";
      el.classList.toggle("maxed", maxed);
      const mb = el.querySelector(".p-max") as HTMLElement; mb.textContent = maxed ? "⤡" : "⤢"; mb.title = maxed ? "Restaurar tamanho (Esc)" : "Maximizar";
      (el.querySelector(".p-btn:nth-of-type(2)") as HTMLElement).textContent = st.mode === "floating" ? "⇲" : "⇱";
      (el.querySelector(".p-btn:nth-of-type(2)") as HTMLElement).title = st.mode === "floating" ? "Reacoplar ao painel lateral" : "Destacar (janela flutuante)";
      if (maxed) {
        if (el.parentElement !== this.floatLayer) this.floatLayer.append(el);
        el.removeAttribute("style"); el.style.zIndex = String(++this.topZ + 500);
      } else if (floating) {
        if (el.parentElement !== this.floatLayer) this.floatLayer.append(el);
        Object.assign(el.style, { left: st.x + "px", top: st.y + "px", width: st.w + "px", height: st.collapsed ? "" : st.h + "px", zIndex: String(++this.topZ) });
        this.clamp(p);
      } else {
        el.removeAttribute("style");
        if (st.dh && !st.collapsed) el.style.flex = `0 0 ${st.dh}px`;
        this.stack.append(el); // ordem segue layout.order
      }
    }
    // faixa de ícones (dock recolhido) — inclui painéis ocultos para reabrir
    // abas verticais: ícone + nome; passar o mouse abre o painel ao lado, clicar fixa no dock
    const tab = (id: string, cls: string) => {
      const p = this.panels.get(id)!;
      const b = h("button", { class: cls + (p.st.mode === "hidden" ? " off" : "") + (p.st.mode === "floating" ? " float" : "") + (p.st.mode === "icon" ? " iconized" : "") + (this.peeking === id ? " peek" : ""),
        "data-id": id, "aria-label": p.def.title, title: `${p.def.title} — passe o mouse para ver · clique para fixar`,
        onclick: () => { if (p.st.mode === "icon") { p.st.mode = "docked"; this.peeking = null; this.peekBox.hidden = true; } this.reveal(id); } },
        h("span", { class: "tab-ic", html: p.def.icon }), h("span", { class: "tab-lb" }, p.def.title));
      b.addEventListener("pointerenter", () => { if (p.st.mode === "floating") return; this.peek(id, false, b); });
      b.addEventListener("pointerleave", () => this.unpeekSoon());
      return b;
    };
    this.strip.replaceChildren(...this.layout.order.map((id) => tab(id, "strip-btn")));
    const iconized = this.layout.order.filter((id) => this.panels.get(id)!.st.mode === "icon");
    this.icons.replaceChildren(...iconized.map((id) => tab(id, "icon-tab")));
    this.icons.hidden = !iconized.length;
    const collapsed = this.layout.dockCollapsed || !docked.filter((id) => !this.panels.get(id)!.st.max).length;
    if (!this.peeking) { this.peekBox.hidden = true; this.dock.classList.remove("peeking"); }
    this.dock.classList.toggle("collapsed", collapsed);
    this.dock.classList.toggle("away", this.away && !mobile);
    // com o Importar aberto no dock, a coluna fica mais larga (onda, imagem e trechos ao lado da pauta)
    const wide = docked.some((id) => id === "imp" && !this.panels.get(id)!.st.collapsed);
    this.dock.classList.toggle("wide", wide && !collapsed);
    document.body.style.setProperty("--rdock", mobile ? "0px" : this.away ? "16px" : (collapsed ? STRIP_W : wide ? 460 : DOCK_W) + "px");
    this.save();
  }

  private clamp(p: P) {
    p.st.x = Math.max(4, Math.min(innerWidth - 120, p.st.x));
    p.st.y = Math.max(32, Math.min(innerHeight - 60, p.st.y));
    p.el.style.left = p.st.x + "px"; p.el.style.top = p.st.y + "px";
  }

  private save() { try { localStorage.setItem(KEY, JSON.stringify(this.layout)); } catch { /* modo privado */ } }

  // ------------------------------------------------------------- arrastar
  private dropIndex(y: number) {
    const docked = [...this.stack.children].filter((c) => !(c as HTMLElement).hidden && !c.classList.contains("dragging")) as HTMLElement[];
    let idx = docked.length;
    for (let i = 0; i < docked.length; i++) { const r = docked[i].getBoundingClientRect(); if (y < r.top + r.height / 2) { idx = i; break; } }
    const ref = docked[idx] || null;
    const dr = this.dock.getBoundingClientRect();
    const gy = ref ? ref.getBoundingClientRect().top : (docked.length ? docked[docked.length - 1].getBoundingClientRect().bottom : this.stack.getBoundingClientRect().top + 4);
    Object.assign(this.guide.style, { top: gy - dr.top - 2 + "px" });
    return ref ? ref.dataset.panel! : null; // inserir antes deste id (null = no fim)
  }

  private overDock(x: number, y: number) {
    const r = this.dock.getBoundingClientRect();
    return x >= r.left - 24 && x <= r.right && y >= r.top && y <= r.bottom;
  }

  private startDrag(e: PointerEvent, id: string) {
    if ((e.target as HTMLElement).closest("button, input, select") || this.mobile()) return;
    const p = this.panels.get(id)!;
    const head = e.currentTarget as HTMLElement;
    const sx = e.clientX, sy = e.clientY;
    let started = false, offX = 0, offY = 0, before: string | null = null, over = false;
    head.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      if (!started) {
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return;
        started = true;
        const r = p.el.getBoundingClientRect();
        offX = sx - r.left; offY = sy - r.top;
        p.el.classList.add("dragging");
        document.body.classList.add("panel-dragging");
      }
      over = this.overDock(ev.clientX, ev.clientY) && !this.layout.dockCollapsed;
      if (p.st.mode === "docked" && !over) {
        // saiu do dock → vira flutuante seguindo o ponteiro
        const r = p.el.getBoundingClientRect();
        Object.assign(p.st, { mode: "floating", w: 300, h: Math.max(240, Math.min(460, r.height)) });
        offX = Math.min(offX, 260);
        this.apply();
        p.el.classList.add("dragging");
      }
      if (p.st.mode === "floating") {
        p.st.x = ev.clientX - offX; p.st.y = ev.clientY - offY;
        p.el.style.left = p.st.x + "px"; p.el.style.top = p.st.y + "px";
      }
      this.dock.classList.toggle("drop-target", over);
      this.guide.hidden = !over;
      if (over) before = this.dropIndex(ev.clientY);
    };
    const up = () => {
      head.removeEventListener("pointermove", move); head.removeEventListener("pointerup", up);
      p.el.classList.remove("dragging"); document.body.classList.remove("panel-dragging");
      this.dock.classList.remove("drop-target"); this.guide.hidden = true;
      if (!started) return;
      if (over) { // reacopla / reordena
        p.st.mode = "docked";
        this.layout.order = this.layout.order.filter((x) => x !== id);
        const i = before ? this.layout.order.indexOf(before) : -1;
        this.layout.order.splice(i < 0 ? this.layout.order.length : i, 0, id);
      }
      this.apply();
    };
    head.addEventListener("pointermove", move); head.addEventListener("pointerup", up);
  }
}
