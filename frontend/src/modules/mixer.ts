// Mesa de edição: canais por camada (fader, pan visual, mudo/solo), master, transporte e exportação
// MIDI (local) / MusicXML / PDF / WAV / MP3 (servidor) do resultado da combinação.
import { store } from "../core/store";
import { h, toast, busy, download, withIcon } from "../core/ui";
import { ICONS } from "../core/icons";
import * as audio from "../core/audio";
import { scoreToMidi } from "../core/midi";
import { runJob, requireLogin } from "../core/api";

export function mountMixer(body: HTMLElement) {
  body.classList.add("mixer", "exporter");
  const fmts: [string, string][] = [["mid", "MIDI"], ["musicxml", "MusicXML"], ["pdf", "PDF (partitura)"], ["wav", "WAV"], ["mp3", "MP3"]];
  const checks = fmts.map(([f, l]) => h("label", { class: "check" }, h("input", { type: "checkbox", value: f, checked: f === "mid" || f === "pdf" }), " " + l));
  const exp = withIcon(h("button", { class: "btn primary go" }, "Exportar") as HTMLButtonElement, ICONS.export);
  const links = h("div", { class: "links" });
  exp.onclick = async () => {
    const sel = checks.map((c) => c.querySelector("input")!).filter((i) => i.checked).map((i) => i.value);
    if (!sel.length) return;
    const slug = store.score.title.toLowerCase().replace(/[^\w]+/g, "-");
    if (sel.includes("mid")) download(scoreToMidi(store.score), slug + ".mid");
    const server = sel.filter((f) => f !== "mid");
    if (!server.length) return;
    if (!requireLogin()) return;
    busy(exp, true, "Renderizando…");
    try {
      const r = await runJob("export", { score: store.score, formats: server }, (_s, info) => busy(exp, true, `${info.label} · ${Math.round(info.pct)}%`), { label: `Exportação — ${store.score.title}` });
      links.replaceChildren(...Object.entries(r.files).map(([k, u]) => h("a", { class: "chip", href: u as string, download: "" }, "⇩ " + k.toUpperCase())));
      toast("Arquivos prontos para download", "ok");
    } catch (e: any) { toast(e.message, "error"); }
    finally { busy(exp, false); }
  };
  body.append(h("div", { class: "exp-grid" }, ...checks), exp, links,
    h("p", { class: "hint" }, "Usa a combinação atual da 🎚 Mesa de som (em Propriedades): camadas em solo têm prioridade e as mudas ficam fora do áudio. Gravações entram no WAV/MP3."));
  void audio;
}
