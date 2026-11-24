// Visualizador do instrumento (subfunção da pauta): teclado ou braço do instrumento em 3D cartunesco e didático.
//  • 👁 Mostrar: acende as notas que estão soando (ou as selecionadas), com nome da nota, intensidade
//    (barra + p / mf / f) e pedal de sustentação quando o instrumento tem pedal (piano).
//  • ✎ Criar: tocar nas teclas/casas escreve a nota na pauta (duração escolhida na barra de ferramentas);
//    a altura do toque na tecla define a intensidade (mais embaixo = mais forte).
import { h } from "../core/ui";
import { SOLFEGE } from "../core/theory";
import { INSTRUMENTS, instrument, Instrument } from "../core/instruments";
import * as audio from "../core/audio";
import { requestJam } from "./jamstart";
import { stopJam, jamActive, jamNote, onJam, livePitch, jamBeat } from "../core/jam";
import { store } from "../core/store";
import { beatsPerMeasure } from "../core/types";
import { ICONS } from "../core/icons";

export interface Lit { pitch: number; vel: number; color: string; pedal?: boolean }
export interface ViewApi {
  lit: () => { notes: Lit[]; pedal: boolean };
  create: (pitch: number, vel: number, inst: Instrument) => void;
  instrumentId: () => string;
  focus?: () => void;
}

/** Notas que soam num tempo da partitura (usado durante o "ao vivo"). */
function litAt(b: number) {
  const notes: Lit[] = []; let pedal = false;
  if (b < 0) return { notes, pedal };
  const s = store.score, aud = new Set(audio.audibleLayers(s).map((l) => l.id));
  for (const l of s.layers) if (l.visible && aud.has(l.id)) for (const n of l.notes) if (n.start <= b && n.start + n.dur > b) {
    notes.push({ pitch: n.pitch, vel: n.vel ?? 80, color: l.color }); if (l.staff === "bass" && n.dur >= 2) pedal = true;
  }
  return { notes, pedal };
}

const isBlack = (p: number) => [1, 3, 6, 8, 10].includes(p % 12);
const nm = (p: number) => `${SOLFEGE[p % 12]}${Math.floor(p / 12) - 1}`;
const dyn = (v: number) => (v < 45 ? "p" : v < 70 ? "mp" : v < 90 ? "mf" : v < 110 ? "f" : "ff");
// afinações (corda solta, da mais grave para a mais aguda)
const TUNING: Record<string, number[]> = { guitar: [40, 45, 50, 55, 59, 64], eguitar: [40, 45, 50, 55, 59, 64], ebass: [28, 33, 38, 43], contrabass: [28, 33, 38, 43],
  violin: [55, 62, 69, 76], viola: [48, 55, 62, 69], cello: [36, 43, 50, 57] };

export function mountInstrumentView(box: HTMLElement, api: ViewApi) {
  let mode: "show" | "create" = "show";
  let instId = api.instrumentId();
  const canvas = h("canvas", { class: "iv-canvas", tabindex: "0", "aria-label": "Instrumento: toque para escrever notas no modo Criar" }) as HTMLCanvasElement;
  const modeSeg = h("div", { class: "seg", role: "radiogroup", "aria-label": "Modalidade do visualizador" });
  const drawSeg = () => modeSeg.replaceChildren(...([["show", "👁 Mostrar"], ["create", "✎ Criar"]] as const).map(([v, l]) =>
    h("button", { class: mode === v ? "on" : "", role: "radio", "aria-checked": String(mode === v), onclick: () => { mode = v; drawSeg(); canvas.classList.toggle("create", mode === "create"); } }, l)));
  drawSeg();
  const instSel = h("select", { "aria-label": "Instrumento do visualizador", onchange: () => { instId = instSel.value; } },
    ...INSTRUMENTS.map((i) => h("option", { value: i.id, selected: i.id === instId }, `${i.icon} ${i.name}`))) as HTMLSelectElement;
  const hint = h("small", { class: "hint" });
  // Compor ao vivo: a pauta toca em loop e o que você toca (instrumento externo ou teclado da tela) é escrito na hora
  const inputSel = h("select", { "aria-label": "Entrada do ao vivo" }, h("option", { value: "mic" }, "🎤 Instrumento externo / MIDI"), h("option", { value: "keys" }, "🎹 Teclado da tela")) as HTMLSelectElement;
  const jamBtn = h("button", { class: "iv-jam", "data-tip": "Compor ao vivo — toca a partitura em loop com metrônomo e escreve na hora o que você toca: no instrumento externo (microfone ou teclado MIDI) ou neste teclado. As notas entram na camada “Ao vivo” e soam já na próxima volta.",
    onclick: () => (jamActive() ? stopJam() : requestJam(inputSel.value as "mic" | "keys", { focus: api.focus }, jamBtn)) }) as HTMLButtonElement;
  const drawJam = () => { const on = jamActive(); jamBtn.classList.toggle("on", on); jamBtn.innerHTML = `<span class="iv-ic">${on ? "■" : ICONS.record}</span><b>${on ? "Parar gravação" : "Gravar"}</b>`; if (on) { mode = "create"; drawSeg(); canvas.classList.add("create"); } };
  const offJam = onJam(drawJam); drawJam();
  box.append(h("div", { class: "iv-bar" }, jamBtn, inputSel, modeSeg, h("label", { class: "inline" }, "Instrumento ", instSel), hint), canvas);

  // geometria calculada a cada quadro (para o clique saber o que foi tocado)
  let hits: { x: number; y: number; w: number; h: number; pitch: number }[] = [];
  const flash = new Map<number, number>(); // nota tocada no modo Criar → brilho temporário

  function frame() {
    const inst = instrument(instId);
    const dpr = devicePixelRatio || 1, W = canvas.clientWidth, H = canvas.clientHeight;
    if (!W || !H) { raf = requestAnimationFrame(frame); return; }
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
    const c = canvas.getContext("2d")!; c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, W, H);
    const { notes, pedal } = jamActive() ? litAt(jamBeat()) : api.lit();
    const lp = livePitch();
    if (lp.pitch !== null) notes.push({ pitch: lp.pitch, vel: Math.round(40 + lp.level * 87), color: "#1dd75b" }); // nota ouvida do instrumento externo
    const now = performance.now();
    for (const [p, t] of flash) if (now - t > 450) flash.delete(p);
    const lit = new Map<number, Lit>(notes.map((n) => [n.pitch, n]));
    flash.forEach((_t, p) => !lit.has(p) && lit.set(p, { pitch: p, vel: 96, color: "#ffb547" }));
    hits = [];
    if (TUNING[inst.id]) drawNeck(c, W, H, inst, lit); else drawKeys(c, W, H, inst, lit, pedal && inst.id === "piano");
    hint.textContent = jamActive() ? `● ao vivo · compasso ${Math.floor(Math.max(0, jamBeat()) / beatsPerMeasure(store.score)) + 1}${lp.pitch !== null ? " · ouvindo " + nm(lp.pitch) : ""}` : mode === "create" ? "Toque para escrever na pauta · mais embaixo na tecla = mais forte" : lit.size ? [...lit.values()].map((n) => `${nm(n.pitch)} ${dyn(n.vel)}`).join("  ·  ") : "Toque ▶ ou selecione notas para ver no instrumento";
    raf = requestAnimationFrame(frame);
  }

  function drawKeys(c: CanvasRenderingContext2D, W: number, H: number, inst: Instrument, lit: Map<number, Lit>, pedal: boolean) {
    const [lo0, hi0] = inst.range;
    const lo = Math.max(21, Math.min(lo0, 48)), hi = Math.min(108, Math.max(hi0, 84));
    const whites: number[] = []; for (let p = lo; p <= hi; p++) if (!isBlack(p)) whites.push(p);
    const showPedals = inst.id === "piano";
    const kh = H - (showPedals ? 46 : 18), ww = W / whites.length, top = 16;
    const xw = (p: number) => whites.indexOf(p) * ww;
    // tampa do piano (volume)
    const g0 = c.createLinearGradient(0, 0, 0, top); g0.addColorStop(0, "#3a2a6a"); g0.addColorStop(1, "#1d1436");
    c.fillStyle = g0; c.fillRect(0, 0, W, top);
    for (const p of whites) {
      const x = xw(p), on = lit.get(p), dy = on ? 3 : 0;
      const g = c.createLinearGradient(0, top, 0, top + kh);
      if (on) { g.addColorStop(0, on.color); g.addColorStop(1, shade(on.color, -25)); } else { g.addColorStop(0, "#ffffff"); g.addColorStop(0.85, "#f1eef9"); g.addColorStop(1, "#d9d3ec"); }
      c.fillStyle = g; rr(c, x + 1, top + dy, ww - 2, kh - dy, 6); c.fill();
      c.fillStyle = "rgba(0,0,0,.12)"; c.fillRect(x + 1, top + kh - 6, ww - 2, 6); // borda inferior (volume)
      if (on) glow(c, x + ww / 2, top + kh * 0.7, on, ww);
      hits.push({ x, y: top, w: ww, h: kh, pitch: p });
      if (p % 12 === 0 && !on) { c.fillStyle = "#9a93b8"; c.font = "10px system-ui"; c.textAlign = "center"; c.fillText("Dó" + (Math.floor(p / 12) - 1), x + ww / 2, top + kh - 10); }
    }
    for (let p = lo; p <= hi; p++) if (isBlack(p)) {
      const x = xw(p - 1) + ww * 0.68, bw = ww * 0.64, bh = kh * 0.62, on = lit.get(p), dy = on ? 2 : 0;
      const g = c.createLinearGradient(0, top, 0, top + bh);
      if (on) { g.addColorStop(0, shade(on.color, 10)); g.addColorStop(1, shade(on.color, -35)); } else { g.addColorStop(0, "#4a4360"); g.addColorStop(0.15, "#1d1830"); g.addColorStop(1, "#0d0a18"); }
      c.fillStyle = g; rr(c, x, top + dy, bw, bh - dy, 4); c.fill();
      c.fillStyle = "rgba(255,255,255,.18)"; rr(c, x + 3, top + 3 + dy, bw - 6, bh * 0.35, 3); c.fill(); // brilho
      if (on) glow(c, x + bw / 2, top + bh * 0.6, on, bw);
      hits.unshift({ x, y: top, w: bw, h: bh, pitch: p }); // pretas têm prioridade no clique
    }
    if (showPedals) {
      const py = top + kh + 8, names = ["una corda", "sostenuto", "sustentação"];
      names.forEach((n, i) => {
        const x = W / 2 - 75 + i * 55, on = i === 2 && pedal;
        const g = c.createLinearGradient(0, py, 0, py + 22); g.addColorStop(0, on ? "#ffe680" : "#e7e1f7"); g.addColorStop(1, on ? "#f0a500" : "#b9b0d6");
        c.fillStyle = g; rr(c, x, py + (on ? 3 : 0), 40, 18, 7); c.fill();
        c.fillStyle = on ? "#7a4b00" : "#8a82a8"; c.font = "9px system-ui"; c.textAlign = "center"; c.fillText(n, x + 20, py + 31);
      });
    }
  }

  function drawNeck(c: CanvasRenderingContext2D, W: number, H: number, inst: Instrument, lit: Map<number, Lit>) {
    const strings = TUNING[inst.id], frets = inst.id.includes("guitar") || inst.id === "ebass" ? 15 : 0;
    const fretted = frets > 0, cols = fretted ? frets + 1 : 12;
    const nutX = 40, fw = (W - nutX - 10) / cols, top = 14, sh = (H - 34) / (strings.length - 1);
    const g = c.createLinearGradient(0, 0, 0, H); g.addColorStop(0, "#7a4a2a"); g.addColorStop(1, "#4a2a16");
    c.fillStyle = g; rr(c, nutX - 6, top - 10, W - nutX - 4, H - 14, 10); c.fill();
    c.fillStyle = "#f5ecd8"; c.fillRect(nutX - 4, top - 8, 5, H - 18); // pestana
    if (fretted) for (let f = 1; f <= frets; f++) {
      c.fillStyle = "#cfd4dc"; c.fillRect(nutX + f * fw, top - 8, 2.5, H - 18);
      if ([3, 5, 7, 9, 15].includes(f)) { c.fillStyle = "rgba(255,255,255,.55)"; c.beginPath(); c.arc(nutX + (f - 0.5) * fw, H / 2 - 4, 5, 0, 7); c.fill(); }
      if (f === 12) { c.fillStyle = "rgba(255,255,255,.55)"; [-1, 1].forEach((k) => { c.beginPath(); c.arc(nutX + 11.5 * fw, H / 2 - 4 + k * sh, 5, 0, 7); c.fill(); }); }
    }
    // cordas (mais grossas embaixo)
    strings.forEach((open, i) => {
      const y = top + (strings.length - 1 - i) * sh;
      c.fillStyle = "#e8e2c8"; c.fillRect(nutX - 4, y - (1 + (strings.length - i) * 0.35) / 2, W - nutX - 6, 1 + (strings.length - i) * 0.35);
      c.fillStyle = "#fff"; c.font = "bold 11px system-ui"; c.textAlign = "right"; c.fillText(SOLFEGE[open % 12], nutX - 10, y + 4);
      for (let f = 0; f < cols; f++) hits.push({ x: nutX + f * fw - (f === 0 ? 30 : 0), y: y - sh / 2, w: fw + (f === 0 ? 30 : 0), h: sh, pitch: open + f });
    });
    // notas: posição mais baixa possível no braço
    lit.forEach((n) => {
      let best: [number, number] | null = null;
      strings.forEach((open, i) => { const f = n.pitch - open; if (f >= 0 && f < cols && (!best || f < best[1])) best = [i, f]; });
      if (!best) return;
      const [si, f] = best as [number, number];
      const x = f === 0 ? nutX - 18 : nutX + (f - 0.5) * fw, y = top + (strings.length - 1 - si) * sh;
      glow(c, x, y, n, 26, true);
    });
  }

  function glow(c: CanvasRenderingContext2D, x: number, y: number, n: Lit, w: number, dot = false) {
    const r = Math.max(9, Math.min(16, w * 0.4));
    c.save(); c.shadowColor = n.color; c.shadowBlur = 10 + (n.vel / 127) * 18;
    const g = c.createRadialGradient(x - r / 3, y - r / 3, 1, x, y, r); g.addColorStop(0, "#fff"); g.addColorStop(0.35, n.color); g.addColorStop(1, shade(n.color, -30));
    c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, 7); c.fill(); c.restore();
    // nome da nota e intensidade (barra + dinâmica)
    c.fillStyle = "#fff"; c.font = "bold 10px system-ui"; c.textAlign = "center"; c.fillText(nm(n.pitch), x, y + 3.5);
    const bw = 24, bh = 4, by = dot ? y + r + 4 : y + r + 6;
    c.fillStyle = "rgba(0,0,0,.25)"; c.fillRect(x - bw / 2, by, bw, bh);
    c.fillStyle = n.vel > 100 ? "#ff4d4d" : n.vel > 70 ? "#ffd36e" : "#1dd75b"; c.fillRect(x - bw / 2, by, (bw * n.vel) / 127, bh);
    c.fillStyle = dot ? "#fff" : "#4b2fc4"; c.font = "italic bold 10px serif"; c.fillText(dyn(n.vel), x, by + 14);
  }

  canvas.addEventListener("pointerdown", (e) => {
    const r = canvas.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    const hit = hits.find((k) => x >= k.x && x <= k.x + k.w && y >= k.y && y <= k.y + k.h);
    if (!hit) return;
    const vel = Math.round(40 + Math.min(1, Math.max(0, (y - hit.y) / hit.h)) * 80);
    const inst = instrument(instId);
    flash.set(hit.pitch, performance.now());
    audio.playNote(hit.pitch, 0, 0.6, vel, 1, undefined, inst.timbre);
    if (jamActive()) jamNote(hit.pitch, vel); else if (mode === "create") api.create(hit.pitch, vel, inst);
  });
  // teclado do computador no modo Criar: A W S E D F T G Y H U J K = Dó4…Dó5
  const KEYMAP = "awsedftgyhujk";
  canvas.addEventListener("keydown", (e) => {
    const i = KEYMAP.indexOf(e.key.toLowerCase()); if (i < 0 || e.metaKey || e.ctrlKey) return;
    e.preventDefault(); const p = 60 + i; flash.set(p, performance.now());
    const inst = instrument(instId); audio.playNote(p, 0, 0.6, 90, 1, undefined, inst.timbre);
    if (jamActive()) jamNote(p, 90); else if (mode === "create") api.create(p, 90, inst);
  });
  let raf = requestAnimationFrame(frame);
  return { destroy: () => { cancelAnimationFrame(raf); offJam(); }, setMode: (m: "show" | "create") => { mode = m; drawSeg(); canvas.classList.toggle("create", m === "create"); } };
}

function rr(c: CanvasRenderingContext2D, x: number, y: number, w: number, hh: number, r: number) {
  c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + hh, r); c.arcTo(x + w, y + hh, x, y + hh, r); c.arcTo(x, y + hh, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}
function shade(hex: string, pct: number) {
  const n = parseInt(hex.replace("#", "").slice(0, 6), 16); const f = (v: number) => Math.max(0, Math.min(255, Math.round(v + (pct / 100) * 255)));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}
