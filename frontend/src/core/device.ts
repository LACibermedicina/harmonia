// Detecção de dispositivo e troca automática de layout (celular × desktop).
// Critérios: user agent móvel (Client Hints quando disponível), tela estreita, ou toque como
// ponteiro principal em tela < 1100 px (tablet em retrato). O usuário pode fixar uma escolha.
export type Layout = "mobile" | "desktop";
const KEY = "harmonia.layout"; // "auto" | "mobile" | "desktop"

export function preference(): "auto" | Layout {
  const v = localStorage.getItem(KEY);
  return v === "mobile" || v === "desktop" ? v : "auto";
}

export function detect(): Layout {
  const ua = navigator.userAgent;
  const uaMobile = (navigator as any).userAgentData?.mobile ?? /Android.+Mobile|iPhone|iPod|Windows Phone|IEMobile|Opera Mini|Mobile Safari/i.test(ua);
  const narrow = matchMedia("(max-width: 820px)").matches;
  const touchFirst = matchMedia("(pointer: coarse)").matches && !matchMedia("(any-pointer: fine)").matches;
  return uaMobile || narrow || (touchFirst && innerWidth < 1100) ? "mobile" : "desktop";
}

export let layout: Layout = "desktop";
export const isMobile = () => layout === "mobile";

function apply() {
  const pref = preference();
  const next: Layout = pref === "auto" ? detect() : pref;
  const changed = next !== layout;
  layout = next;
  document.body.classList.toggle("mobile", next === "mobile");
  document.body.classList.toggle("desktop", next === "desktop");
  document.body.dataset.layout = next;
  if (changed) dispatchEvent(new CustomEvent("layoutchange", { detail: next }));
}

export function setPreference(p: "auto" | Layout) {
  if (p === "auto") localStorage.removeItem(KEY); else localStorage.setItem(KEY, p);
  apply();
}

export function initDevice() {
  apply();
  let t: number | undefined;
  const re = () => { clearTimeout(t); t = window.setTimeout(apply, 150); };
  addEventListener("resize", re);
  addEventListener("orientationchange", re);
  matchMedia("(pointer: coarse)").addEventListener?.("change", re);
  // acessibilidade: tamanho de texto e alto contraste persistidos
  document.body.classList.toggle("large-text", localStorage.getItem("harmonia.largeText") === "1");
  document.body.classList.toggle("high-contrast", localStorage.getItem("harmonia.contrast") === "1");
}

export function toggleLargeText() {
  const on = !document.body.classList.contains("large-text");
  document.body.classList.toggle("large-text", on);
  localStorage.setItem("harmonia.largeText", on ? "1" : "0");
  return on;
}
export function toggleContrast() {
  const on = !document.body.classList.contains("high-contrast");
  document.body.classList.toggle("high-contrast", on);
  localStorage.setItem("harmonia.contrast", on ? "1" : "0");
  return on;
}
