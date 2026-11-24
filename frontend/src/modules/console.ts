// Mesa de som compacta (painel Propriedades, na barra lateral): o que está tocando, volume geral com medidor
// e um canal por camada (fader ao vivo, mudo, solo e medidor de nível com a cor da camada).
import { h } from "../core/ui";
import { store } from "../core/store";
import * as audio from "../core/audio";

export function mountConsole(box: HTMLElement) {
  box.classList.add("console");
  const now = h("button", { class: "cs-now", title: "Ir para o quadro que está tocando" });
  const play = h("button", { class: "cs-btn", "aria-label": "Tocar / pausar", onclick: () => { const st = audio.playerState(); if (st.playing) audio.pause(); else if (st.source) audio.resume(); else audio.play(store.score, {}, { id: "console", label: "Mesa de som — mix", icon: "🎚" }); } }, "▶");
  const stop = h("button", { class: "cs-btn", "aria-label": "Parar", onclick: () => audio.stop() }, "■");
  const master = h("input", { type: "range", min: 0, max: 1.2, step: 0.01, value: audio.masterVolume(), "aria-label": "Volume geral", oninput: (e: Event) => audio.setMasterVolume(+(e.target as HTMLInputElement).value) });
  const mMeter = h("i", { class: "cs-meter" }, h("b"));
  const chans = h("div", { class: "cs-chans" });
  void play; void stop;
  box.append(h("div", { class: "cs-top" }, now), h("div", { class: "cs-row master" }, h("span", { class: "cs-name" }, "Geral"), master, mMeter), chans);

  const drawNow = (st: audio.PlayerState) => {
    now.replaceChildren(h("i", { class: "pb-dot" + (st.playing ? " on" : "") }), h("span", {}, st.source ? `${st.source.icon ?? "🎧"} ${st.source.label}` : "Nada tocando"));
    now.onclick = () => st.source?.focus?.();

  };
  const offP = audio.onPlayer(drawNow);
  const meters = new Map<string, HTMLElement>();
  const render = () => {
    meters.clear();
    chans.replaceChildren(...store.score.layers.map((l) => {
      const m = h("i", { class: "cs-meter" }, h("b", { style: { background: l.color } }));
      meters.set(l.id, m);
      return h("div", { class: "cs-row" + (l.muted ? " muted" : "") + (l.solo ? " solo" : ""), style: { "--lc": l.color } },
        h("span", { class: "cs-name", title: l.name }, h("i", { class: "cs-sw" }), l.kind === "recording" ? "🎙 " + l.name : l.name),
        h("input", { type: "range", min: 0, max: 1, step: 0.01, value: l.volume, "aria-label": "Volume " + l.name,
          oninput: (e: Event) => { l.volume = +(e.target as HTMLInputElement).value; audio.liveMix(store.score); }, onchange: () => store.mutate(() => {}, "mix") }),
        h("button", { class: "cs-ms" + (l.muted ? " on" : ""), title: "Mudo", onclick: () => { store.mutate(() => (l.muted = !l.muted), "mix"); audio.liveMix(store.score); } }, "M"),
        h("button", { class: "cs-ms" + (l.solo ? " on" : ""), title: "Solo", onclick: () => { store.mutate(() => (l.solo = !l.solo), "mix"); audio.liveMix(store.score); } }, "S"), m);
    }));
  };
  let raf = 0;
  const tick = () => {
    (mMeter.firstChild as HTMLElement).style.width = audio.level() * 100 + "%";
    meters.forEach((m, id) => ((m.firstChild as HTMLElement).style.width = audio.level(id) * 100 + "%"));
    raf = requestAnimationFrame(tick);
  };
  const off = store.on((r) => { if (r !== "autosave" && r !== "selection") render(); });
  render(); raf = requestAnimationFrame(tick);
  return () => { off(); offP(); cancelAnimationFrame(raf); };
}
