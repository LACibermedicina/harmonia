// i18n em duas camadas:
// 1) Dicionário estático para o "chrome" do sistema (funciona offline).
// 2) Tradução contextual por IA de TODO texto visível (janelas, dados, notas), com cache no servidor,
//    preservando cifras, nomes de notas e termos musicais. Elementos com [data-noi18n] são ignorados.
import { api } from "./api";
import { toast } from "./ui";

export type Lang = "pt" | "en" | "es" | "zh" | "hi";
export const LANGS: { code: Lang; flag: string; name: string }[] = [
  { code: "zh", flag: "🇨🇳", name: "中文" },
  { code: "es", flag: "🇪🇸", name: "Español" },
  { code: "en", flag: "🇬🇧", name: "English" },
  { code: "hi", flag: "🇮🇳", name: "हिन्दी" },
  { code: "pt", flag: "🇧🇷", name: "Português" },
];

const D: Record<string, Record<Lang, string>> = {
  compose: { pt: "Composição", en: "Composition", es: "Composición", zh: "作曲", hi: "रचना" },
  import: { pt: "Importar", en: "Import", es: "Importar", zh: "导入", hi: "आयात" },
  layers: { pt: "Camadas", en: "Layers", es: "Capas", zh: "图层", hi: "परतें" },
  mixer: { pt: "Exportar", en: "Export", es: "Exportar", zh: "导出", hi: "निर्यात" },
  library: { pt: "Biblioteca", en: "Library", es: "Biblioteca", zh: "曲库", hi: "पुस्तकालय" },
  graph: { pt: "Fluxo de IA", en: "AI Flow", es: "Flujo de IA", zh: "AI 流程", hi: "एआई प्रवाह" },
  agenda: { pt: "Agenda", en: "Calendar", es: "Agenda", zh: "日程", hi: "कैलेंडर" },
  community: { pt: "Comunidade", en: "Community", es: "Comunidad", zh: "社区", hi: "समुदाय" },
  visualizer: { pt: "Visualizador", en: "Visualizer", es: "Visualizador", zh: "可视化", hi: "विज़ुअलाइज़र" },
  props: { pt: "Propriedades", en: "Properties", es: "Propiedades", zh: "属性", hi: "गुण" },
  notes: { pt: "Anotações", en: "Annotations", es: "Anotaciones", zh: "注释", hi: "टिप्पणियाँ" },
  admin: { pt: "Administração", en: "Administration", es: "Administración", zh: "管理", hi: "प्रशासन" },
  account: { pt: "Conta", en: "Account", es: "Cuenta", zh: "账户", hi: "खाता" },
  play: { pt: "Tocar", en: "Play", es: "Reproducir", zh: "播放", hi: "चलाएँ" },
  stop: { pt: "Parar", en: "Stop", es: "Detener", zh: "停止", hi: "रोकें" },
  record: { pt: "Gravar", en: "Record", es: "Grabar", zh: "录音", hi: "रिकॉर्ड" },
  harmonize: { pt: "Harmonizar", en: "Harmonize", es: "Armonizar", zh: "配和声", hi: "सामंजस्य" },
  export: { pt: "Exportar", en: "Export", es: "Exportar", zh: "导出", hi: "निर्यात" },
  save: { pt: "Salvar", en: "Save", es: "Guardar", zh: "保存", hi: "सहेजें" },
  translating: { pt: "Traduzindo a tela…", en: "Translating screen…", es: "Traduciendo pantalla…", zh: "正在翻译屏幕…", hi: "स्क्रीन का अनुवाद…" },
};

export let lang: Lang = (localStorage.getItem("harmonia.lang") as Lang) || "pt";
export const t = (k: string) => D[k]?.[lang] ?? D[k]?.pt ?? k;

const originals = new WeakMap<Text, string>();
const ATTRS = ["placeholder", "title", "aria-label", "data-tip"];
const origAttr = new WeakMap<Element, Record<string, string>>();

function collect(root: HTMLElement) {
  const nodes: Text[] = [];
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => {
      const p = n.parentElement;
      if (!p || p.closest("[data-noi18n], script, style, svg, textarea, code")) return NodeFilter.FILTER_REJECT;
      return /[A-Za-zÀ-ÿ]{2,}/.test(n.textContent || "") ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });
  while (w.nextNode()) nodes.push(w.currentNode as Text);
  return nodes;
}

export async function setLang(l: Lang) {
  lang = l;
  localStorage.setItem("harmonia.lang", l);
  document.documentElement.lang = l === "zh" ? "zh-CN" : l === "hi" ? "hi-IN" : l;
  document.querySelectorAll<HTMLElement>("[data-i18n]").forEach((el) => (el.textContent = t(el.dataset.i18n!)));
  window.dispatchEvent(new CustomEvent("lang", { detail: l }));
  await translateScreen();
}

/** Traduz tudo que está visível. Restaura o original ao voltar para PT. */
export async function translateScreen(root: HTMLElement = document.body) {
  const nodes = collect(root);
  const attrEls = [...root.querySelectorAll<HTMLElement>(ATTRS.map((a) => `[${a}]`).join(","))].filter((e) => !e.closest("[data-noi18n]"));
  nodes.forEach((n) => { if (!originals.has(n)) originals.set(n, n.textContent || ""); });
  attrEls.forEach((e) => { if (!origAttr.has(e)) origAttr.set(e, Object.fromEntries(ATTRS.filter((a) => e.hasAttribute(a)).map((a) => [a, e.getAttribute(a)!]))); });
  if (lang === "pt") {
    nodes.forEach((n) => (n.textContent = originals.get(n)!));
    attrEls.forEach((e) => Object.entries(origAttr.get(e) || {}).forEach(([a, v]) => e.setAttribute(a, v)));
    return;
  }
  const texts = [...new Set([...nodes.map((n) => originals.get(n)!.trim()), ...attrEls.flatMap((e) => Object.values(origAttr.get(e) || {}))])].filter(Boolean);
  if (!texts.length) return;
  const tag = toastOnce();
  try {
    const out: Record<string, string> = {};
    for (let i = 0; i < texts.length; i += 150) {
      const r = await api<{ translations: Record<string, string> }>("/api/ai/translate", { method: "POST", json: { target: lang, texts: texts.slice(i, i + 150) } });
      Object.assign(out, r.translations);
    }
    nodes.forEach((n) => { const o = originals.get(n)!; const k = o.trim(); if (out[k]) n.textContent = o.replace(k, out[k]); });
    attrEls.forEach((e) => Object.entries(origAttr.get(e) || {}).forEach(([a, v]) => out[v] && e.setAttribute(a, out[v])));
  } catch (e: any) {
    toast(`Tradução por IA indisponível (${e.message}). Menus traduzidos pelo dicionário local.`, "warn");
  } finally { tag(); }
}

function toastOnce() { document.body.classList.add("translating"); return () => document.body.classList.remove("translating"); }

// Novas janelas abertas são traduzidas automaticamente quando o idioma ≠ PT
const mo = new MutationObserver((muts) => {
  if (lang === "pt") return;
  for (const m of muts) m.addedNodes.forEach((n) => { if (n instanceof HTMLElement && n.classList.contains("win")) setTimeout(() => translateScreen(n), 50); });
});
export function watchI18n(root: HTMLElement) { mo.observe(root, { childList: true }); }
