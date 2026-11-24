// Pasta "Projetos salvos" (desktop): todos os projetos como ícones de arquivo.
// Duplo clique abre na Composição; menu com renomear, duplicar e excluir; salvar a composição aberta aqui.
import { h, toast } from "../core/ui";
import { ICONS } from "../core/icons";
import { store } from "../core/store";
import { currentUser } from "../core/api";
import { listProjects, saveCurrent, openProject, renameProject, duplicateProject, deleteProject, isOpen, onProjects, Project } from "../core/projects";

const ago = (iso: string) => {
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (d < 60) return "agora"; if (d < 3600) return `há ${Math.floor(d / 60)} min`; if (d < 86400) return `há ${Math.floor(d / 3600)} h`;
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: d > 300 * 86400 ? "numeric" : undefined });
};

export function mountProjects(body: HTMLElement) {
  body.classList.add("projects");
  let sort: "recent" | "name" = "recent", q = "", sel: string | null = null, items: Project[] = [];
  const search = h("input", { type: "search", placeholder: "Buscar projeto…", "aria-label": "Buscar projeto", oninput: () => { q = search.value.toLowerCase(); draw(); } }) as HTMLInputElement;
  const sortSel = h("select", { "aria-label": "Ordenar", onchange: () => { sort = sortSel.value as any; draw(); } },
    h("option", { value: "recent" }, "Mais recentes"), h("option", { value: "name" }, "Nome (A–Z)")) as HTMLSelectElement;
  const saveB = h("button", { class: "btn primary", onclick: async () => {
    try { const w = await saveCurrent(); toast(`“${store.score.title}” salvo em Projetos salvos${w === "navegador" ? " (neste navegador)" : ""}`, "ok"); }
    catch (e: any) { toast(e.message, "error"); } } }, "💾 Salvar a composição aberta");
  const saveAsB = h("button", { class: "btn", title: "Salvar uma cópia como projeto novo", onclick: async () => {
    try { await saveCurrent(true); toast("Cópia salva como novo projeto", "ok"); } catch (e: any) { toast(e.message, "error"); } } }, "Salvar como novo");
  const crumbs = h("div", { class: "pj-path" }, h("span", { class: "pj-folder-ic", html: ICONS.folder }), h("b", {}, "Desktop"), " › ", h("b", {}, "Projetos salvos"));
  const grid = h("div", { class: "pj-grid", role: "listbox", "aria-label": "Projetos salvos" });
  const foot = h("div", { class: "pj-foot" });
  body.append(h("div", { class: "pj-bar" }, crumbs, h("span", { class: "spacer" }), search, sortSel), h("div", { class: "pj-actions" }, saveB, saveAsB), grid, foot);

  async function load() { grid.classList.add("loading"); items = await listProjects(); grid.classList.remove("loading"); draw(); }
  function draw() {
    let xs = items.filter((p) => !q || p.title.toLowerCase().includes(q));
    if (sort === "name") xs = [...xs].sort((a, b) => a.title.localeCompare(b.title, "pt-BR"));
    if (!xs.length) {
      grid.replaceChildren(h("div", { class: "pj-empty" }, h("span", { html: ICONS.folder }),
        h("p", {}, q ? "Nenhum projeto com esse nome." : "Nenhum projeto salvo ainda."),
        h("small", {}, q ? "" : "Abra ou crie uma composição e use 💾 Salvar (⌘S) — ela aparece aqui.")));
    } else grid.replaceChildren(...xs.map(card));
    const nAcc = items.filter((p) => p.where === "conta").length, nLoc = items.length - nAcc;
    foot.textContent = `${items.length} projeto${items.length === 1 ? "" : "s"}` + (nAcc ? ` · ${nAcc} na conta` : "") + (nLoc ? ` · ${nLoc} neste navegador` : "") +
      (!currentUser && nLoc ? " — entre na conta para guardar na nuvem" : "");
  }
  function card(p: Project) {
    const open = async () => { try { await openProject(p); } catch (e: any) { toast(e.message, "error"); } };
    const name = h("b", { class: "pj-name", title: p.title }, p.title);
    const el = h("div", { class: "pj-item" + (sel === p.key ? " sel" : "") + (isOpen(p) ? " open" : ""), role: "option", tabindex: "0", "aria-selected": String(sel === p.key),
      style: { "--pc": p.color || (p.where === "conta" ? "#7c5cff" : "#2e86de") } as any, title: "Duplo clique para abrir",
      onclick: () => { sel = p.key; grid.querySelectorAll(".pj-item").forEach((x) => x.classList.toggle("sel", x === el)); },
      ondblclick: open, onkeydown: (e: KeyboardEvent) => { if (e.key === "Enter") open(); if (e.key === "F2") rename(); if (e.key === "Delete") del(); } },
      h("div", { class: "pj-file" }, h("span", { class: "pj-staff", "aria-hidden": "true" }, "𝄞"), h("i", { class: "pj-where", title: p.where === "conta" ? "Salvo na sua conta" : "Salvo neste navegador" }, p.where === "conta" ? "☁" : "💻"),
        isOpen(p) ? h("i", { class: "pj-open-badge" }, "aberto") : ""),
      name, h("small", {}, `${ago(p.updatedAt)}${p.measures ? ` · ${p.measures} comp.` : ""}`),
      h("div", { class: "pj-ops" },
        h("button", { title: "Abrir", onclick: (e: Event) => { e.stopPropagation(); open(); } }, "↗"),
        h("button", { title: "Renomear (F2)", onclick: (e: Event) => { e.stopPropagation(); rename(); } }, "✎"),
        h("button", { title: "Duplicar", onclick: async (e: Event) => { e.stopPropagation(); try { await duplicateProject(p); toast("Projeto duplicado", "ok"); } catch (er: any) { toast(er.message, "error"); } } }, "⧉"),
        h("button", { class: "del", title: "Excluir (clique 2×)", onclick: (e: Event) => { e.stopPropagation(); del(); } }, "🗑")));
    let arm = 0;
    async function del() {
      const b = el.querySelector(".pj-ops .del") as HTMLElement;
      if (!arm) { b.classList.add("armed"); b.textContent = "?"; arm = window.setTimeout(() => { arm = 0; b.classList.remove("armed"); b.textContent = "🗑"; }, 2500); toast(`Clique de novo para excluir “${p.title}”`, "warn", 2500); return; }
      clearTimeout(arm);
      try { await deleteProject(p); toast(`“${p.title}” excluído`, "ok"); } catch (er: any) { toast(er.message, "error"); }
    }
    function rename() {
      const inp = h("input", { class: "pj-rename", value: p.title }) as HTMLInputElement;
      name.replaceWith(inp); inp.focus(); inp.select();
      let done = false;
      const fin = async (ok: boolean) => { if (done) return; done = true; const v = inp.value.trim(); if (ok && v && v !== p.title) { try { await renameProject(p, v); } catch (er: any) { toast(er.message, "error"); } } else draw(); };
      inp.addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter") fin(true); if (e.key === "Escape") fin(false); });
      inp.addEventListener("blur", () => fin(true));
    }
    return el;
  }
  const off = onProjects(load);
  addEventListener("auth", load);
  const offStore = store.on((r) => { if (r === "load") draw(); });
  load();
  return () => { off(); removeEventListener("auth", load); offStore(); };
}
