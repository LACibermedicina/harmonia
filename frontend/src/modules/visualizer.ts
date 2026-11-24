// Visualizador dinâmico da transcrição: acompanha a reprodução em duas vistas —
//  • 🎼 Pauta: sistema de piano que corre da direita para a esquerda sob um cursor fixo;
//  • 🎹 Piano vertical: notas "caindo" sobre um teclado (estilo MIDI digital), teclas acendem ao tocar.
// Pode ouvir só a transcrição, só a faixa original (camada 🎙) ou as duas juntas. Arraste para avançar/voltar.
import { h } from "../core/ui";
import { store } from "../core/store";
import { beatsPerMeasure, staves, Clef, Score } from "../core/types";
import * as audio from "../core/audio";
import type { Win } from "../core/wm";

const SRC = "visualizer";
const LETTER = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6];
const SHARP = [0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0];
const TOP: Record<Clef, number> = { G: 38, F: 26, C: 32 };
const GLYPH: Record<Clef, string> = { G: "𝄞", F: "𝄢", C: "𝄡" };
const isBlack = (p: number) => SHARP[p % 12] === 1;

export function mountVisualizer(body: HTMLElement, win: Win) {
  body.classList.add("visualizer");
  let mode: "staff" | "piano" = (localStorage.getItem("harmonia.viz.mode") as any) || "piano";
  let listen: "both" | "notes" | "orig" = "both";
  let zoom = 1;
  let beat = 0; // posição exibida (tempos)

  const seg = (opts: [string, string][], get: () => string, set: (v: string) => void) => {
    const box = h("div", { class: "seg", role: "radiogroup" });
    const draw = () => box.replaceChildren(...opts.map(([v, l]) => h("button", { class: get() === v ? "on" : "", role: "radio", "aria-checked": String(get() === v), onclick: () => { set(v); draw(); } }, l)));
    draw(); return box;
  };
  const playB = h("button", { class: "btn primary", onclick: () => toggle() }, "▶ Tocar");
  const hasOrig = () => store.score.layers.some((l) => l.kind === "recording" && (l.audio || l.audioUrl));
  const listenSeg = seg([["both", "🎧 Ambos"], ["notes", "🎹 Transcrição"], ["orig", "🎙 Original"]], () => listen, (v) => { listen = v as any; if (mine() && audio.isPlaying()) { const p = audio.playerState().pos; start(p / spb()); } });
  const zoomIn = h("input", { type: "range", min: 0.5, max: 2.5, step: 0.1, value: zoom, "aria-label": "Zoom", oninput: (e: Event) => { zoom = +(e.target as HTMLInputElement).value; } });
  const info = h("small", { class: "hint", "data-noi18n": "" });
  const canvas = h("canvas", { class: "viz-canvas", tabindex: "0", "aria-label": "Visualização da transcrição" }) as HTMLCanvasElement;
  body.append(h("div", { class: "toolbar viz-bar" },
    seg([["piano", "🎹 Piano vertical"], ["staff", "🎼 Pauta"]], () => mode, (v) => { mode = v as any; localStorage.setItem("harmonia.viz.mode", v); }),
    playB, listenSeg, h("label", { class: "inline" }, "🔍", zoomIn), info), canvas);

  const spb = () => 60 / store.score.tempo;
  const mine = () => audio.playerState().source?.id === SRC;
  /** Cópia da partitura com as camadas que se quer ouvir (transcrição, original ou ambos). */
  function mixScore(): Score {
    const s: Score = JSON.parse(JSON.stringify(store.score));
    for (const l of s.layers) {
      const isRec = l.kind === "recording";
      if (listen === "notes" && isRec) l.muted = true;
      if (listen === "orig" && !isRec) l.muted = true;
      if (listen !== "both") l.solo = false;
    }
    return s;
  }
  function start(fromBeat: number) {
    audio.play(mixScore(), { fromBeat: Math.max(0, fromBeat), rangeStart: 0 }, { id: SRC, label: `Visualizador — ${mode === "piano" ? "piano vertical" : "pauta"}`, icon: "👁", focus: () => win.focus() });
  }
  function toggle() {
    const st = audio.playerState();
    if (mine() && st.playing) audio.pause();
    else if (mine() && st.paused) audio.resume();
    else start(beat);
  }
  audio.onPlayer((st) => { playB.textContent = mine() && st.playing ? "⏸ Pausar" : "▶ Tocar"; });

  // arrastar na tela = avançar/voltar (scrub); solta = continua dali
  canvas.addEventListener("pointerdown", (e) => {
    const sx = e.clientX, sy = e.clientY, b0 = beat; const wasPlaying = mine() && audio.isPlaying();
    if (wasPlaying) audio.pause();
    canvas.setPointerCapture(e.pointerId);
    const ppb = pxPerBeat();
    const mv = (ev: PointerEvent) => { beat = Math.max(0, mode === "piano" ? b0 + (ev.clientY - sy) / ppb : b0 - (ev.clientX - sx) / ppb); };
    const up = () => {
      canvas.removeEventListener("pointermove", mv); canvas.removeEventListener("pointerup", up);
      if (wasPlaying) start(beat); else if (mine()) audio.seek(beat * spb());
    };
    canvas.addEventListener("pointermove", mv); canvas.addEventListener("pointerup", up);
  });
  canvas.addEventListener("keydown", (e) => {
    if (e.key === " ") { e.preventDefault(); toggle(); }
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") { const d = (e.key === "ArrowRight" ? 1 : -1) * beatsPerMeasure(store.score); beat = Math.max(0, beat + d); if (mine() && audio.isPlaying()) start(beat); }
  });

  const pxPerBeat = () => (mode === "piano" ? 60 : 70) * zoom;
  let raf = 0;
  function frame() {
    const st = audio.playerState();
    if (mine() && (st.playing || st.paused)) beat = st.pos / spb();
    const dpr = devicePixelRatio || 1;
    const W = canvas.clientWidth, H = canvas.clientHeight;
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) { canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr); }
    const c = canvas.getContext("2d")!;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, W, H);
    if (mode === "piano") drawPiano(c, W, H); else drawStaff(c, W, H);
    const s = store.score, bpm = beatsPerMeasure(s);
    info.textContent = `compasso ${Math.floor(beat / bpm) + 1} · ${s.layers.filter((l) => l.kind !== "recording").reduce((a, l) => a + l.notes.length, 0)} notas${hasOrig() ? " · com faixa original" : ""}`;
    raf = requestAnimationFrame(frame);
  }

  const notes = () => store.score.layers.filter((l) => l.visible && l.kind !== "recording").flatMap((l) => l.notes.map((n) => ({ n, color: l.color, muted: listen === "orig" })));

  function drawPiano(c: CanvasRenderingContext2D, W: number, H: number) {
    const all = notes();
    let lo = 48, hi = 84;
    if (all.length) { lo = Math.min(...all.map((x) => x.n.pitch)) - 3; hi = Math.max(...all.map((x) => x.n.pitch)) + 3; }
    lo = Math.max(21, Math.floor(lo / 12) * 12); hi = Math.min(108, Math.ceil((hi + 1) / 12) * 12);
    const whites: number[] = []; for (let p = lo; p <= hi; p++) if (!isBlack(p)) whites.push(p);
    const ww = W / whites.length, kh = Math.min(110, H * 0.22), ky = H - kh;
    const xOf = (p: number) => { const wi = whites.findIndex((w) => w >= p - (isBlack(p) ? 1 : 0)); return isBlack(p) ? (wi + 1) * ww - ww * 0.3 : wi * ww; };
    const wOf = (p: number) => (isBlack(p) ? ww * 0.6 : ww);
    const ppb = pxPerBeat();
    // fundo + linhas de compasso
    const g = c.createLinearGradient(0, 0, 0, ky); g.addColorStop(0, "#1a1033"); g.addColorStop(1, "#2a1b55");
    c.fillStyle = g; c.fillRect(0, 0, W, ky);
    const bpm = beatsPerMeasure(store.score);
    for (let m = Math.floor(beat / bpm); ; m++) { const y = ky - (m * bpm - beat) * ppb; if (y < 0) break; c.fillStyle = "rgba(255,255,255,.08)"; c.fillRect(0, y, W, 1); c.fillStyle = "rgba(255,255,255,.35)"; c.font = "10px system-ui"; c.fillText(String(m + 1), 4, y - 3); }
    for (const w of whites) if (w % 12 === 0) { c.fillStyle = "rgba(255,255,255,.05)"; c.fillRect(xOf(w), 0, 1, ky); }
    // notas caindo
    const active = new Map<number, string>();
    for (const { n, color, muted } of all) {
      const y1 = ky - (n.start - beat) * ppb, y0 = y1 - n.dur * ppb;
      if (y1 < 0 || y0 > ky) continue;
      const x = xOf(n.pitch) + 1, w = wOf(n.pitch) - 2;
      const on = n.start <= beat && n.start + n.dur > beat;
      if (on) active.set(n.pitch, color);
      c.globalAlpha = muted ? 0.35 : 1;
      c.fillStyle = color; c.shadowColor = color; c.shadowBlur = on ? 18 : 6;
      roundRect(c, x, Math.max(0, y0), w, Math.min(ky, y1) - Math.max(0, y0), Math.min(6, w / 2)); c.fill();
      c.shadowBlur = 0; c.fillStyle = "rgba(255,255,255,.35)"; c.fillRect(x + 2, Math.max(0, y0) + 2, Math.max(1, w * 0.25), Math.max(0, Math.min(ky, y1) - Math.max(0, y0) - 4));
      c.globalAlpha = 1;
    }
    // linha de ataque
    c.fillStyle = "#ffd36e"; c.fillRect(0, ky - 2, W, 2);
    // teclado
    for (const w of whites) {
      const col = active.get(w);
      c.fillStyle = col || "#fbfaff"; c.fillRect(xOf(w), ky, ww - 1, kh);
      if (w % 12 === 0) { c.fillStyle = col ? "#fff" : "#8a82a8"; c.font = "10px system-ui"; c.fillText("C" + (Math.floor(w / 12) - 1), xOf(w) + 3, H - 6); }
    }
    for (let p = lo; p <= hi; p++) if (isBlack(p)) { const col = active.get(p); c.fillStyle = col || "#1d1830"; c.fillRect(xOf(p), ky, wOf(p), kh * 0.62); }
  }

  function drawStaff(c: CanvasRenderingContext2D, W: number, H: number) {
    const s = store.score, st = staves(s), bpm = beatsPerMeasure(s);
    const LS = Math.max(8, Math.min(14, H / 26));
    const both = st.upper.visible && st.lower.visible;
    const upY = H / 2 - (both ? LS * 7 : LS * 2), loY = both ? H / 2 + LS * 3 : upY;
    const playX = W * 0.3, ppb = pxPerBeat();
    c.fillStyle = "#fffdf8"; c.fillRect(0, 0, W, H);
    const staffs: [number, Clef, "treble" | "bass"][] = [];
    if (st.upper.visible) staffs.push([upY, st.upper.clef, "treble"]);
    if (st.lower.visible) staffs.push([loY, st.lower.clef, "bass"]);
    c.strokeStyle = "#4a4560"; c.lineWidth = 1;
    for (const [y, clef] of staffs) {
      for (let i = 0; i < 5; i++) { c.beginPath(); c.moveTo(0, y + i * LS); c.lineTo(W, y + i * LS); c.stroke(); }
      c.fillStyle = "#2a2540"; c.font = `${LS * (clef === "G" ? 4.2 : 3.2)}px serif`; c.fillText(GLYPH[clef], 6, y + (clef === "G" ? LS * 3.3 : LS * 2.2));
    }
    const yT = staffs[0][0], yB = staffs[staffs.length - 1][0] + 4 * LS;
    // compassos e cifras
    for (let m = Math.max(0, Math.floor(beat / bpm) - 4); m <= s.measures; m++) {
      const x = playX + (m * bpm - beat) * ppb; if (x > W) break; if (x < 40) continue;
      c.fillStyle = "#4a4560"; c.fillRect(x, yT, 1.2, yB - yT);
      c.fillStyle = "#8a82a8"; c.font = "10px system-ui"; c.fillText(String(m + 1), x + 3, yT - 16);
      for (const ch of s.chords[m] || []) { c.fillStyle = "#7c5cff"; c.font = "bold 12px system-ui"; c.fillText(ch.symbol, playX + (m * bpm + ch.beat - beat) * ppb + 4, yT - 4); }
    }
    // notas
    for (const l of s.layers) {
      if (!l.visible || l.kind === "recording") continue;
      const cfg = l.staff === "bass" ? st.lower : st.upper; if (!cfg.visible) continue;
      const sy = l.staff === "bass" ? loY : upY, top = TOP[cfg.clef];
      for (const n of l.notes) {
        const x = playX + (n.start - beat) * ppb, xe = x + n.dur * ppb;
        if (xe < 40 || x > W) continue;
        const step = (Math.floor(n.pitch / 12) - 1) * 7 + LETTER[n.pitch % 12];
        const y = sy + (top - step) * LS / 2;
        const on = n.start <= beat && n.start + n.dur > beat;
        c.globalAlpha = listen === "orig" ? 0.4 : 1;
        c.fillStyle = l.color + "55"; roundRect(c, x, y - LS * 0.35, Math.max(4, xe - x), LS * 0.7, LS * 0.35); c.fill();
        c.strokeStyle = "#4a4560";
        for (let s2 = top - 10; s2 >= step; s2 -= 2) { const ly = sy + (top - s2) * LS / 2; c.beginPath(); c.moveTo(x - LS * 0.8, ly); c.lineTo(x + LS * 0.8, ly); c.stroke(); }
        for (let s2 = top + 2; s2 <= step; s2 += 2) { const ly = sy + (top - s2) * LS / 2; c.beginPath(); c.moveTo(x - LS * 0.8, ly); c.lineTo(x + LS * 0.8, ly); c.stroke(); }
        if (SHARP[n.pitch % 12]) { c.fillStyle = "#2a2540"; c.font = `${LS * 1.3}px serif`; c.fillText("♯", x - LS * 1.5, y + LS * 0.45); }
        c.save(); c.translate(x, y); c.rotate(-0.35);
        c.shadowColor = l.color; c.shadowBlur = on ? 16 : 0;
        c.fillStyle = n.dur >= 1.99 ? "#fff" : l.color; c.strokeStyle = l.color; c.lineWidth = 2;
        c.beginPath(); c.ellipse(0, 0, LS * 0.62, LS * 0.42, 0, 0, Math.PI * 2); c.fill(); c.stroke(); c.restore();
        if (n.dur < 3.99) { const up = step < top - 4; c.fillStyle = l.color; c.fillRect(up ? x + LS * 0.55 : x - LS * 0.62, up ? y - LS * 3.2 : y, 1.5, LS * 3.2); }
        if (n.lyric && l.staff !== "bass") { c.fillStyle = "#4a4560"; c.font = "12px system-ui"; c.fillText(n.lyric === "_" ? "—" : n.lyric, x - 4, yB + 22); }
        c.globalAlpha = 1;
      }
    }
    // cursor fixo
    c.fillStyle = "#ff4d7d"; c.fillRect(playX - 1, yT - 26, 2.5, yB - yT + 40);
    // margem esquerda fixa com as claves (as notas que já passaram somem por baixo dela)
    c.fillStyle = "#fffdf8"; c.fillRect(0, 0, LS * 4.6, H);
    const g = c.createLinearGradient(LS * 4.6, 0, LS * 4.6 + 50, 0); g.addColorStop(0, "#fffdf8"); g.addColorStop(1, "rgba(255,253,248,0)");
    c.fillStyle = g; c.fillRect(LS * 4.6, 0, 50, H);
    c.strokeStyle = "#4a4560"; c.lineWidth = 1;
    for (const [y, clef] of staffs) {
      for (let i = 0; i < 5; i++) { c.beginPath(); c.moveTo(0, y + i * LS); c.lineTo(LS * 4.6 + 50, y + i * LS); c.stroke(); }
      c.fillStyle = "#2a2540"; c.font = `${LS * (clef === "G" ? 4.2 : 3.2)}px serif`; c.fillText(GLYPH[clef], 6, y + (clef === "G" ? LS * 3.3 : LS * 2.2));
    }
  }

  raf = requestAnimationFrame(frame);
  win.setTitle(`Visualizador — ${store.score.title}`);
  return () => { cancelAnimationFrame(raf); if (mine()) audio.stop(); };
}

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, hh: number, r: number) {
  c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + hh, r); c.arcTo(x + w, y + hh, x, y + hh, r); c.arcTo(x, y + hh, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}
