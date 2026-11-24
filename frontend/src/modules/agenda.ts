// Agenda de estudos/ensaios com notas cruzadas entre dias (arraste uma nota para outro dia)
// e vínculo opcional à composição aberta.
import { h } from "../core/ui";
import { api, currentUser } from "../core/api";
import { store } from "../core/store";

interface ANote { id: string; date: string; text: string; color: string; composition?: string; }

export function mountAgenda(body: HTMLElement) {
  body.classList.add("agenda");
  let cur = new Date(); cur.setDate(1);
  let notes: ANote[] = [];
  let selected = iso(new Date());
  const head = h("div", { class: "cal-head" });
  const grid = h("div", { class: "cal-grid" });
  const side = h("div", { class: "cal-side" });
  body.append(h("div", { class: "cal-main" }, head, grid), side);

  function iso(d: Date) { return d.toISOString().slice(0, 10); }
  function render() {
    const month = cur.toLocaleDateString(undefined, { month: "long", year: "numeric" });
    head.replaceChildren(h("button", { class: "btn ghost", onclick: () => { cur.setMonth(cur.getMonth() - 1); render(); } }, "‹"), h("b", {}, month),
      h("button", { class: "btn ghost", onclick: () => { cur.setMonth(cur.getMonth() + 1); render(); } }, "›"));
    grid.replaceChildren(...["D", "S", "T", "Q", "Q", "S", "S"].map((d) => h("div", { class: "dow" }, d)));
    const start = new Date(cur); start.setDate(1 - cur.getDay());
    for (let i = 0; i < 42; i++) {
      const d = new Date(start); d.setDate(start.getDate() + i);
      const k = iso(d);
      const day = h("div", { class: "day" + (d.getMonth() !== cur.getMonth() ? " other" : "") + (k === iso(new Date()) ? " today" : "") + (k === selected ? " sel" : ""), onclick: () => { selected = k; render(); } },
        h("span", {}, String(d.getDate())), ...notes.filter((n) => n.date === k).slice(0, 3).map((n) => {
          const c = h("i", { class: "dot-note", draggable: "true", style: { background: n.color }, title: n.text });
          c.addEventListener("dragstart", (e) => e.dataTransfer!.setData("text/harmonia-note", n.id));
          return c;
        }));
      day.addEventListener("dragover", (e) => e.preventDefault());
      day.addEventListener("drop", (e) => { const id = e.dataTransfer?.getData("text/harmonia-note"); const n = notes.find((x) => x.id === id); if (n) { n.date = k; save(); render(); } });
      grid.append(day);
    }
    const ta = h("textarea", { rows: 3, placeholder: "Ex.: estudar harmonização do refrão (c. 9–16) a ♩=80" }) as HTMLTextAreaElement;
    const color = h("input", { type: "color", value: "#7c5cff" }) as HTMLInputElement;
    side.replaceChildren(h("h4", {}, new Date(selected + "T12:00").toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })),
      ...notes.filter((n) => n.date === selected).map((n) => h("div", { class: "anote", style: { borderColor: n.color } },
        h("p", {}, n.text), n.composition ? h("small", {}, "🎼 " + n.composition) : "",
        h("button", { class: "btn ghost", onclick: () => { notes = notes.filter((x) => x !== n); save(); render(); } }, "✕"))),
      ta, h("div", { class: "row" }, color,
        h("button", { class: "btn primary", onclick: () => { if (!ta.value.trim()) return; notes.push({ id: Math.random().toString(36).slice(2), date: selected, text: ta.value.trim(), color: color.value, composition: store.score.title }); save(); render(); } }, "+ Nota")));
  }
  async function save() {
    if (!currentUser) return;
    const ws = await api("/api/account/workspace").catch(() => ({}));
    api("/api/account/workspace", { method: "PUT", json: { ...ws, agenda: notes } }).catch(() => {});
  }
  (async () => { if (currentUser) { const ws = await api("/api/account/workspace").catch(() => null); notes = ws?.agenda || []; } render(); })();
}
