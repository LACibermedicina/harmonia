// Projetos salvos: as composições da conta (servidor) + as salvas neste navegador (sem conta ou offline).
// A pasta "Projetos salvos" do desktop lista tudo daqui; salvar, renomear, duplicar e excluir avisam a pasta.
import { api, currentUser } from "./api";
import { store } from "./store";
import type { Score } from "./types";

export interface Project { key: string; id?: number; lid?: string; title: string; updatedAt: string; measures?: number; tempo?: number; color?: string; where: "conta" | "navegador" }

const LKEY = "harmonia.projects.local";
const changed = () => dispatchEvent(new CustomEvent("projects-changed"));
export const onProjects = (fn: () => void) => { addEventListener("projects-changed", fn); return () => removeEventListener("projects-changed", fn); };

type Local = { lid: string; title: string; score: Score; updatedAt: string };
function readLocal(): Local[] { try { return JSON.parse(localStorage.getItem(LKEY) || "[]"); } catch { return []; } }
function writeLocal(xs: Local[]) { localStorage.setItem(LKEY, JSON.stringify(xs)); }

let cache: Project[] = [];
export const projectsCache = () => cache;

export async function listProjects(): Promise<Project[]> {
  const out: Project[] = [];
  if (currentUser) {
    try {
      const rows = await api<any[]>("/api/compositions");
      for (const c of rows) out.push({ key: "s" + c.id, id: c.id, title: c.title, updatedAt: c.updatedAt, measures: c.measures, tempo: c.tempo, color: c.coverColor, where: "conta" });
    } catch { /* offline: mostra só os locais */ }
  }
  for (const l of readLocal()) out.push({ key: "l" + l.lid, lid: l.lid, title: l.title, updatedAt: l.updatedAt, measures: l.score.measures, tempo: l.score.tempo, where: "navegador" });
  out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  cache = out;
  return out;
}

/** Salva a composição aberta: na conta (se houver) ou neste navegador. Devolve onde salvou. */
export async function saveCurrent(asNew = false): Promise<"conta" | "navegador"> {
  const title = store.score.title || "Sem título";
  if (currentUser) {
    try {
      if (store.compositionId && !asNew) {
        const r = await api(`/api/compositions/${store.compositionId}`, { method: "PATCH", json: { score: store.score, title, version: store.version } });
        store.version = r.version;
      } else {
        const r = await api("/api/compositions", { method: "POST", json: { title, score: store.score } });
        store.compositionId = r.id; store.version = r.version; localId = null;
      }
      changed(); return "conta";
    } catch (e: any) {
      if (/vers[aã]o desatualizada/i.test(e.message)) throw e;
      // sem permissão (visitante) ou servidor fora: guarda no navegador
    }
  }
  const xs = readLocal();
  const now = new Date().toISOString();
  const snap = JSON.parse(JSON.stringify(store.score)) as Score;
  const i = localId && !asNew ? xs.findIndex((x) => x.lid === localId) : -1;
  if (i >= 0) xs[i] = { ...xs[i], title, score: snap, updatedAt: now };
  else { localId = Math.random().toString(36).slice(2, 10); xs.push({ lid: localId, title, score: snap, updatedAt: now }); }
  writeLocal(xs); changed();
  return "navegador";
}
let localId: string | null = null;

export async function openProject(p: Project) {
  if (p.id) { const r = await api(`/api/compositions/${p.id}`); store.load(r.score, r.id, r.version); localId = null; }
  else { const l = readLocal().find((x) => x.lid === p.lid); if (!l) throw new Error("Projeto não encontrado neste navegador"); store.load(JSON.parse(JSON.stringify(l.score))); localId = l.lid; }
  dispatchEvent(new CustomEvent("open-app", { detail: "compose" }));
}

export async function renameProject(p: Project, title: string) {
  if (p.id) await api(`/api/compositions/${p.id}`, { method: "PATCH", json: { title } });
  else { const xs = readLocal(); const l = xs.find((x) => x.lid === p.lid); if (l) { l.title = title; l.score.title = title; l.updatedAt = new Date().toISOString(); writeLocal(xs); } }
  if ((p.id && p.id === store.compositionId) || (p.lid && p.lid === localId)) store.mutate((s) => (s.title = title), "title");
  changed();
}

export async function duplicateProject(p: Project) {
  let score: Score;
  if (p.id) score = (await api(`/api/compositions/${p.id}`)).score;
  else score = readLocal().find((x) => x.lid === p.lid)!.score;
  const title = `${p.title} (cópia)`;
  const copy = { ...JSON.parse(JSON.stringify(score)), title };
  if (p.id) await api("/api/compositions", { method: "POST", json: { title, score: copy } });
  else { const xs = readLocal(); xs.push({ lid: Math.random().toString(36).slice(2, 10), title, score: copy, updatedAt: new Date().toISOString() }); writeLocal(xs); }
  changed();
}

export async function deleteProject(p: Project) {
  if (p.id) { await api(`/api/compositions/${p.id}`, { method: "DELETE" }); if (store.compositionId === p.id) store.compositionId = null; }
  else { writeLocal(readLocal().filter((x) => x.lid !== p.lid)); if (localId === p.lid) localId = null; }
  changed();
}

/** Projeto aberto agora (para destacar na pasta). */
export const isOpen = (p: Project) => (!!p.id && p.id === store.compositionId) || (!!p.lid && p.lid === localId);
// nova partitura / outra carregada fora daqui: esquece o vínculo local
store.on((r) => {
  if (r === "load") localId = null;
  // autosave dos projetos guardados no navegador
  if (r === "autosave" && localId && !store.compositionId) {
    const xs = readLocal(); const l = xs.find((x) => x.lid === localId);
    if (l) { l.score = JSON.parse(JSON.stringify(store.score)); l.title = store.score.title || l.title; l.updatedAt = new Date().toISOString(); try { writeLocal(xs); changed(); } catch { /* cota do navegador */ } }
  }
});
