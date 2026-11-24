// Biblioteca de composições: minhas obras, playlists/álbuns (drag & drop), biblioteca pública e links.
import { store, demoScore } from "../core/store";
import { h, toast } from "../core/ui";
import { api, currentUser } from "../core/api";
import * as audio from "../core/audio";
import { saveCurrent as saveProject } from "../core/projects";

export function mountLibrary(body: HTMLElement) {
  body.classList.add("library");
  const side = h("nav", { class: "lib-side" });
  const main = h("div", { class: "lib-main" });
  body.append(side, main);
  let view: string = currentUser ? "mine" : "public";
  let mine: any[] = [], pls: any[] = [];

  async function refresh() {
    side.replaceChildren(
      h("button", { class: view === "public" ? "on" : "", onclick: () => go("public") }, "🌐 Biblioteca pública"),
      h("button", { class: view === "featured" ? "on" : "", onclick: () => go("featured") }, "⭐ Destaques"),
      currentUser ? h("button", { class: view === "mine" ? "on" : "", onclick: () => go("mine") }, "🎼 Minhas composições") : "",
      currentUser ? h("h5", {}, "Playlists e álbuns") : "",
      ...pls.map((p) => {
        const b = h("button", { class: view === "pl" + p.id ? "on" : "", onclick: () => go("pl" + p.id) }, (p.kind === "album" ? "💿 " : "🎧 ") + p.title);
        b.addEventListener("dragover", (e) => { e.preventDefault(); b.classList.add("over"); });
        b.addEventListener("dragleave", () => b.classList.remove("over"));
        b.addEventListener("drop", async (e) => {
          e.preventDefault(); b.classList.remove("over");
          const id = +(e.dataTransfer?.getData("text/harmonia-comp") || 0); if (!id) return;
          await api(`/api/playlists/${p.id}/items`, { method: "PUT", json: { compositionIds: [...p.items.map((i: any) => i.id), id] } });
          toast(`Adicionada a "${p.title}"`, "ok"); load();
        });
        return b;
      }),
      currentUser ? h("div", { class: "row" },
        h("button", { class: "btn ghost", onclick: () => newPl("playlist") }, "+ Playlist"),
        h("button", { class: "btn ghost", onclick: () => newPl("album") }, "+ Álbum")) : h("p", { class: "hint" }, "Entre para salvar composições, playlists e álbuns."));
    main.replaceChildren(h("div", { class: "spin-wrap" }, h("span", { class: "spin" })));
    try {
      if (view === "mine") main.replaceChildren(header("Minhas composições", h("button", { class: "btn primary", onclick: saveCurrent }, "💾 Salvar composição aberta"), h("button", { class: "btn", onclick: () => { store.load(demoScore()); toast("Nova composição", "ok"); } }, "+ Nova")), grid(mine, true));
      else if (view.startsWith("pl")) {
        const p = pls.find((x) => "pl" + x.id === view)!;
        main.replaceChildren(header(p.title, shareCtl(p, `/api/playlists/${p.id}/publish`)), plList(p));
      } else {
        const rows = await api<any[]>(`/api/library/public${view === "featured" ? "?featured=true" : ""}`);
        const albums = view === "public" ? await api<any[]>("/api/library/public/albums") : [];
        main.replaceChildren(header(view === "featured" ? "Destaques da biblioteca" : "Biblioteca pública de composições",
          h("a", { class: "chip", href: "/biblioteca", target: "_blank" }, "🔗 Link principal da biblioteca")),
          albums.length ? h("div", { class: "albums" }, ...albums.map((a) => h("div", { class: "album", style: { background: a.coverColor } }, h("b", {}, a.title), h("small", {}, `${a.items.length} faixas`)))) : "",
          grid(rows, false));
      }
    } catch (e: any) { main.replaceChildren(h("p", { class: "hint" }, "Biblioteca indisponível offline (" + e.message + ").")); }
  }
  const go = (v: string) => { view = v; refresh(); };
  const header = (title: string, ...actions: (HTMLElement | string)[]) => h("div", { class: "lib-head" }, h("h3", {}, title), h("div", { class: "row" }, ...actions));

  function grid(rows: any[], own: boolean) {
    if (!rows.length) return h("p", { class: "hint" }, own ? "Nenhuma composição salva ainda." : "Nada publicado por aqui ainda.");
    return h("div", { class: "cards" }, ...rows.map((c) => {
      const card = h("div", { class: "card", draggable: String(own), style: { "--cc": c.coverColor } as any },
        h("div", { class: "cover" }, h("span", {}, "♫")),
        h("b", {}, c.title), h("small", {}, `${c.author ? c.author + " · " : ""}${c.measures ?? "?"} comp. · ♩${c.tempo ?? ""}`),
        h("div", { class: "row" },
          h("button", { class: "btn ghost", title: "Ouvir", onclick: () => listen(c.id, own, c) }, "▶"),
          own ? h("button", { class: "btn ghost", onclick: () => open(c.id) }, "Abrir") : "",
          own ? shareCtl(c, `/api/compositions/${c.id}/publish`) : "",
          own ? h("button", { class: "btn ghost danger", title: "Excluir", onclick: async () => { if (confirm(`Excluir "${c.title}"?`)) { await api(`/api/compositions/${c.id}`, { method: "DELETE" }); load(); } } }, "🗑") : ""));
      card.addEventListener("dragstart", (e) => e.dataTransfer!.setData("text/harmonia-comp", String(c.id)));
      return card;
    }));
  }

  function plList(p: any) {
    const ul = h("ol", { class: "pl-list" });
    let dragIdx = -1;
    p.items.forEach((c: any, i: number) => {
      const li = h("li", { draggable: "true" }, h("span", { class: "grip" }, "☰"), h("b", {}, c.title), h("button", { class: "btn ghost", onclick: () => listen(c.id, true, c) }, "▶"),
        h("button", { class: "btn ghost", onclick: async () => { await api(`/api/playlists/${p.id}/items`, { method: "PUT", json: { compositionIds: p.items.filter((x: any) => x.id !== c.id).map((x: any) => x.id) } }); load(); } }, "✕"));
      li.addEventListener("dragstart", () => (dragIdx = i));
      li.addEventListener("dragover", (e) => e.preventDefault());
      li.addEventListener("drop", async () => {
        const ids = p.items.map((x: any) => x.id); const [m] = ids.splice(dragIdx, 1); ids.splice(i, 0, m);
        await api(`/api/playlists/${p.id}/items`, { method: "PUT", json: { compositionIds: ids } }); load();
      });
      ul.append(li);
    });
    return h("div", {}, p.items.length ? ul : h("p", { class: "hint" }, "Arraste composições de \"Minhas composições\" para esta lista na barra lateral."),
      p.items.length ? h("button", { class: "btn primary", onclick: () => playAll(p.items) }, "▶ Tocar tudo") : "");
  }

  function shareCtl(item: any, url: string) {
    const sel = h("select", { "aria-label": "Visibilidade", onchange: async () => {
      const v = sel.value;
      const r = await api(url, { method: "POST", json: { visibility: v === "featured" ? "public" : v, featured: v === "featured" } });
      if (r.shareUrl) { const full = location.origin + r.shareUrl; navigator.clipboard?.writeText(full); toast("Link copiado: " + full, "ok", 6000); }
      load();
    } }, h("option", { value: "private", selected: item.visibility === "private" }, "🔒 Privada"),
      h("option", { value: "link", selected: item.visibility === "link" }, "🔗 Por link"),
      h("option", { value: "public", selected: item.visibility === "public" && !item.featured }, "🌐 Pública"),
      h("option", { value: "featured", selected: !!item.featured }, "⭐ Link principal")) as HTMLSelectElement;
    return sel;
  }

  async function saveCurrent() {
    try { const w = await saveProject(); toast(w === "conta" ? "Composição salva em Projetos salvos" : "Salva neste navegador (Projetos salvos)", "ok"); load(); }
    catch (e: any) { toast(e.message, "error"); }
  }
  async function open(id: number) {
    const r = await api(`/api/compositions/${id}`);
    store.load(r.score, r.id, r.version);
    window.dispatchEvent(new CustomEvent("open-app", { detail: "compose" }));
  }
  async function listen(id: number, own: boolean, c: any) {
    const r = own ? await api(`/api/compositions/${id}`) : await api(`/api/share/${c.shareUrl?.split("/").pop()}`).catch(() => null);
    if (!r?.score) { toast("Prévia indisponível", "warn"); return; }
    audio.play(r.score, {}, { id: "library", label: `Biblioteca — ${r.score.title || r.title || "prévia"}`, icon: "📚", focus: () => dispatchEvent(new CustomEvent("open-app", { detail: "library" })) });
  }
  async function playAll(items: any[]) {
    for (const it of items) {
      const r = await api(`/api/compositions/${it.id}`);
      await new Promise<void>((res) => audio.play(r.score, { onEnd: res }, { id: "library", label: `Playlist — ${r.score.title || "faixa"}`, icon: "📚", focus: () => dispatchEvent(new CustomEvent("open-app", { detail: "library" })) }));
    }
  }
  async function newPl(kind: string) {
    const title = prompt(kind === "album" ? "Nome do álbum" : "Nome da playlist");
    if (!title) return;
    await api("/api/playlists", { method: "POST", json: { title, kind, coverColor: `hsl(${Math.random() * 360} 70% 60%)` } });
    load();
  }
  async function load() {
    if (currentUser) {
      try { [mine, pls] = await Promise.all([api<any[]>("/api/compositions"), api<any[]>("/api/playlists")]); } catch { /* offline */ }
    }
    refresh();
  }
  load();
}
