// Player universal: sempre visível na barra de menus (no celular, acima da barra inferior).
// Controla qualquer áudio em execução nos quadros — partitura no editor, pentagrama do desktop, mesa de som,
// faixa do Importar, visualizador — e mostra QUAL quadro está tocando (clique no nome para ir até ele).
import { h } from "../core/ui";
import * as audio from "../core/audio";
import { store } from "../core/store";

const fmt = (t: number) => `${Math.floor(Math.max(0, t) / 60)}:${String(Math.floor(Math.max(0, t) % 60)).padStart(2, "0")}`;

export function playerBar(openCompose: () => void, keys = true) {
  const src = h("button", { class: "pb-src", title: "Ir para o quadro que está tocando" });
  const btn = (label: string, icon: string, fn: () => void, cls = "") => h("button", { class: "pb-btn " + cls, "aria-label": label, title: label, onclick: fn }, icon);
  const play = btn("Tocar / pausar (Espaço fora da partitura)", "▶", () => toggle(), "main");
  const seek = h("input", { type: "range", class: "pb-seek", min: 0, max: 1, step: 0.01, value: 0, "aria-label": "Posição da reprodução" }) as HTMLInputElement;
  const time = h("small", { class: "pb-time", "data-noi18n": "" }, "0:00 / 0:00");
  const vol = h("input", { type: "range", class: "pb-vol", min: 0, max: 1.2, step: 0.01, value: audio.masterVolume(), "aria-label": "Volume geral" }) as HTMLInputElement;
  const volIc = h("span", { class: "pb-vic", "aria-hidden": "true" }, "🔊");
  vol.addEventListener("input", () => { audio.setMasterVolume(+vol.value); volIc.textContent = +vol.value === 0 ? "🔇" : +vol.value < 0.5 ? "🔉" : "🔊"; });
  let dragging = false;
  seek.addEventListener("input", () => { dragging = true; time.textContent = `${fmt(+seek.value)} / ${fmt(+seek.max)}`; });
  seek.addEventListener("change", () => { dragging = false; audio.seek(+seek.value); });

  const bar = h("div", { class: "playerbar idle", role: "region", "aria-label": "Player universal" },
    src, btn("Do início", "⏮", () => audio.restart()), btn("Voltar 5 segundos", "⏪", () => jump(-5)), play,
    btn("Avançar 5 segundos", "⏩", () => jump(5)), btn("Parar", "■", () => audio.stop()), seek, time,
    h("span", { class: "pb-volbox" }, volIc, vol));

  function jump(d: number) { const st = audio.playerState(); if (st.source) audio.seek(st.pos + d); }
  function toggle() {
    const st = audio.playerState();
    if (st.playing) audio.pause();
    else if (st.source) audio.resume();
    else { openCompose(); audio.play(store.score, {}, { id: "compose", label: `Composição — ${store.score.title}`, icon: "🎼", focus: openCompose }); }
  }

  let raf = 0;
  const draw = () => {
    const st = audio.playerState();
    bar.classList.toggle("idle", !st.source);
    bar.classList.toggle("playing", st.playing);
    bar.classList.toggle("paused", st.paused);
    src.replaceChildren(h("i", { class: "pb-dot", "aria-hidden": "true" }), h("span", {}, (st.source?.icon ?? "🎧") + " "),
      h("b", {}, st.source ? st.source.label : "Nada tocando"), st.playing ? "" : st.source ? h("small", {}, st.paused ? " · pausado" : " · parado") : "");
    src.onclick = () => st.source?.focus?.();
    play.textContent = st.playing ? "⏸" : "▶";
    play.setAttribute("aria-label", st.playing ? "Pausar" : "Tocar");
    if (!dragging) { seek.max = String(Math.max(0.1, st.dur)); seek.value = String(Math.min(st.pos, st.dur)); time.textContent = `${fmt(st.pos)} / ${fmt(st.dur)}`; }
    bar.setAttribute("aria-label", `Player universal: ${st.source ? (st.playing ? "tocando " : st.paused ? "pausado " : "parado ") + st.source.label : "nada tocando"}`);
    if (st.playing) raf = requestAnimationFrame(draw);
  };
  audio.onPlayer(() => { cancelAnimationFrame(raf); draw(); });
  // Espaço fora de campos e da partitura: tocar/pausar a sessão atual
  if (keys) addEventListener("keydown", (e) => {
    if (e.key !== " " || e.defaultPrevented) return;
    const t = e.target as HTMLElement;
    if (t.closest("input, textarea, select, button, [contenteditable], .score-canvas")) return;
    e.preventDefault(); toggle();
  });
  return bar;
}
