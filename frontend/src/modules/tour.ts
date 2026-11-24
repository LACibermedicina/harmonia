// Guia passo a passo sobre a interface: escurece a tela, recorta um "holofote" no controle da vez e aponta
// com uma seta cartunesca (gorducha, com brilho e quique). O usuário pode clicar no controle destacado.
// Fecha com ✕, Esc ou com duplo clique fora do cartão.
import { h } from "../core/ui";

export interface TourStep {
  target?: string | (() => Element | null); // seletor CSS; sem alvo = cartão centralizado
  title: string;
  text: string;
  advanceOnClick?: boolean;                 // clicar no alvo avança para o próximo passo
  before?: () => void;                      // prepara a tela (abrir aba, selecionar algo…)
}

let active: { close: () => void } | null = null;
export const tourActive = () => !!active;

const ARROW_SVG = `
<svg viewBox="0 0 120 120" width="96" height="96" aria-hidden="true">
  <defs>
    <linearGradient id="ar-g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffe066"/><stop offset=".55" stop-color="#ffb02e"/><stop offset="1" stop-color="#ff6b3d"/></linearGradient>
    <filter id="ar-s" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="5" stdDeviation="4" flood-color="#3a1a5e" flood-opacity=".45"/></filter>
  </defs>
  <g filter="url(#ar-s)">
    <path d="M16 96 C 22 60, 46 40, 76 36 L 72 20 L 108 44 L 74 70 L 76 54 C 54 56, 36 70, 30 100 Z"
      fill="url(#ar-g)" stroke="#5b2a86" stroke-width="5" stroke-linejoin="round"/>
    <path d="M26 88 C 32 64, 50 50, 72 46" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" opacity=".75"/>
    <circle cx="86" cy="42" r="3.2" fill="#fff" opacity=".9"/>
  </g>
</svg>`;

export function startTour(name: string, steps: TourStep[]) {
  active?.close();
  let i = 0;
  const dims = [0, 1, 2, 3].map(() => h("div", { class: "tour-dim" }));
  const ring = h("div", { class: "tour-ring", "aria-hidden": "true" });
  const arrow = h("div", { class: "tour-arrow", html: ARROW_SVG });
  const counter = h("small", { class: "tour-count" });
  const ttl = h("b", {});
  const txt = h("p", {});
  const back = h("button", { class: "btn ghost", onclick: () => go(i - 1) }, "‹ Voltar");
  const next = h("button", { class: "btn primary", onclick: () => go(i + 1) }, "Próximo ›");
  const card = h("div", { class: "tour-card", role: "dialog", "aria-modal": "false", "aria-label": "Guia passo a passo" },
    h("button", { class: "tour-x", "aria-label": "Fechar o guia", title: "Fechar o guia (Esc)", onclick: () => close() }, "✕"),
    counter, ttl, txt, h("div", { class: "tour-foot" }, back, next), h("small", { class: "tour-hint" }, "Dica: duplo clique fora deste quadro fecha o guia."));
  const root = h("div", { class: "tour", "data-tour": name }, ...dims, ring, arrow, card);
  document.body.append(root);
  dims.forEach((d) => d.addEventListener("dblclick", () => close()));
  let raf = 0, clickTarget: Element | null = null;
  const onTargetClick = () => { if (steps[i]?.advanceOnClick) setTimeout(() => go(i + 1), 250); };
  const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
  addEventListener("keydown", onKey);

  function find(): Element | null {
    const t = steps[i]?.target;
    if (!t) return null;
    const e = typeof t === "function" ? t() : document.querySelector(t);
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return r.width && r.height ? e : null;
  }

  function layout() {
    const e = find();
    if (clickTarget !== e) { clickTarget?.removeEventListener("click", onTargetClick); clickTarget = e; e?.addEventListener("click", onTargetClick); }
    const W = innerWidth, H = innerHeight;
    if (!e) { // sem alvo visível: escurece tudo e centraliza o cartão
      Object.assign(dims[0].style, { left: "0", top: "0", width: W + "px", height: H + "px" });
      dims.slice(1).forEach((d) => (d.style.width = "0"));
      ring.hidden = true; arrow.hidden = true;
      Object.assign(card.style, { left: (W - card.offsetWidth) / 2 + "px", top: (H - card.offsetHeight) / 2 + "px" });
    } else {
      const r = e.getBoundingClientRect(); const p = 6;
      const x0 = Math.max(0, r.left - p), y0 = Math.max(0, r.top - p), x1 = Math.min(W, r.right + p), y1 = Math.min(H, r.bottom + p);
      Object.assign(dims[0].style, { left: "0", top: "0", width: W + "px", height: y0 + "px" });
      Object.assign(dims[1].style, { left: "0", top: y1 + "px", width: W + "px", height: H - y1 + "px" });
      Object.assign(dims[2].style, { left: "0", top: y0 + "px", width: x0 + "px", height: y1 - y0 + "px" });
      Object.assign(dims[3].style, { left: x1 + "px", top: y0 + "px", width: W - x1 + "px", height: y1 - y0 + "px" });
      ring.hidden = false; arrow.hidden = false;
      Object.assign(ring.style, { left: x0 + "px", top: y0 + "px", width: x1 - x0 + "px", height: y1 - y0 + "px" });
      // cartão do lado com mais espaço; a seta fica entre o cartão e o alvo, apontando para ele
      const cw = card.offsetWidth, ch = card.offsetHeight, gap = 110;
      const space = { right: W - x1, left: x0, below: H - y1, above: y0 };
      const side = (Object.entries(space) as [keyof typeof space, number][]).sort((a, b) => b[1] - a[1])[0][0];
      let cx = 0, cy = 0;
      const cxMid = Math.min(W - cw - 12, Math.max(12, (x0 + x1) / 2 - cw / 2)), cyMid = Math.min(H - ch - 12, Math.max(40, (y0 + y1) / 2 - ch / 2));
      if (side === "right") { cx = Math.min(W - cw - 12, x1 + gap); cy = cyMid; }
      if (side === "left") { cx = Math.max(12, x0 - gap - cw); cy = cyMid; }
      if (side === "below") { cx = cxMid; cy = Math.min(H - ch - 12, y1 + gap); }
      if (side === "above") { cx = cxMid; cy = Math.max(40, y0 - gap - ch); }
      Object.assign(card.style, { left: cx + "px", top: cy + "px" });
      // seta: nasce na borda do cartão e aponta (ponta = canto superior direito do desenho) para o alvo
      // aponta para o ponto da borda do alvo mais próximo do cartão
      const ccx = cx + cw / 2, ccy = cy + ch / 2;
      const tx = Math.max(x0, Math.min(x1, ccx)), ty = Math.max(y0, Math.min(y1, ccy));
      const ax = Math.max(cx - 10, Math.min(cx + cw + 10, tx)), ay = Math.max(cy - 10, Math.min(cy + ch + 10, ty));
      const ang = Math.atan2(ty - ay, tx - ax) * 180 / Math.PI;
      const dist = Math.hypot(tx - ax, ty - ay);
      const k = Math.max(0.2, 1 - 50 / Math.max(dist, 1)); // centro da seta ~50px antes do alvo
      const mx = ax + (tx - ax) * k, my = ay + (ty - ay) * k;
      // o desenho aponta para ~ -29,5° (para cima/direita); compensa
      Object.assign(arrow.style, { left: mx - 48 + "px", top: my - 48 + "px" });
      arrow.style.setProperty("--rot", `${ang + 29.5}deg`);
    }
    raf = requestAnimationFrame(layout);
  }

  function go(n: number) {
    if (n >= steps.length) { close(true); return; }
    i = Math.max(0, n);
    const st = steps[i];
    try { st.before?.(); } catch { /* */ }
    // alvo dentro de área rolável (ex.: seção do painel de ferramentas): traz para a vista
    setTimeout(() => { const t = st.target; const e = t ? (typeof t === "function" ? t() : document.querySelector(t)) : null; e?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" }); }, 60);
    counter.textContent = `Passo ${i + 1} de ${steps.length}`;
    ttl.textContent = st.title; txt.textContent = st.text;
    back.hidden = i === 0;
    next.textContent = i === steps.length - 1 ? "Concluir ✓" : st.advanceOnClick ? "Pular ›" : "Próximo ›";
    card.classList.remove("tpop"); void card.offsetWidth; card.classList.add("tpop");
    arrow.classList.remove("tpop"); void arrow.offsetWidth; arrow.classList.add("tpop");
    next.focus({ preventScroll: true });
  }

  function close(done = false) {
    cancelAnimationFrame(raf);
    clickTarget?.removeEventListener("click", onTargetClick);
    removeEventListener("keydown", onKey);
    root.classList.add("out");
    setTimeout(() => root.remove(), 200);
    active = null;
    try { localStorage.setItem("harmonia.tour." + name, done ? "done" : "closed"); } catch { /* */ }
  }

  active = { close: () => close() };
  go(0);
  raf = requestAnimationFrame(layout);
  return active;
}

// --------------------------------------------------------- roteiros prontos
const q = (sel: string) => () => document.querySelector(sel);
const act = (a: string) => () => dispatchEvent(new CustomEvent("harmonia:action", { detail: a }));

export const TOURS: Record<string, TourStep[]> = {
  compose: [
    { target: ".score-editor .rail", title: "Sua barra de ferramentas", text: "Gravar e Importar ficam sempre no topo. Cada ícone abre um quadro com explicação. Passe o mouse para ver dicas; arraste pela alça ⋯ para mudar de lugar." },
    { target: ".score-editor [data-tool=pencil]", title: "1. Pegue o lápis", text: "Clique em ✎ Nota (ou tecle N) para escrever notas.", advanceOnClick: true },
    { target: ".score-editor .fly .durs", before: act("group:dur"), title: "2. Escolha a duração", text: "Semínima ♩ = 1 tempo, colcheia ♪ = ½… Você também pode arrastar a figura direto para a pauta." },
    { target: ".score-editor .score-canvas", before: act("group-close"), title: "3. Escreva a melodia", text: "Clique na pauta de cima para colocar notas. Arraste uma nota para mudar a altura ou o tempo; Delete apaga." },
    { target: ".score-editor .measure-band", title: "4. Selecione compassos", text: "Clique na faixa numerada para selecionar um compasso (Shift = intervalo)." },
    { target: ".score-editor .fly .btn.accent", before: act("group:harm"), title: "5. Harmonize", text: "✨ Harmonizar seleção cria os acordes e a mão esquerda só nos compassos escolhidos." },
    { target: ".desk-score .ds-play", before: act("group-close"), title: "6. Ouça o resultado", text: "O pentagrama final fica no desktop: aperte ▶ para ouvir a composição inteira a qualquer momento." },
  ],
  record: [
    { target: ".score-editor .measure-band", title: "1. (Opcional) escolha onde gravar", text: "Selecione compassos na faixa numerada para gravar só esse trecho. Sem seleção, você grava livremente por cima da partitura, como uma nova voz." },
    { target: ".score-editor .big-rec", title: "2. Grave", text: "Aperte ● Gravar. Eu conto um compasso (1-2-3-4) com o metrônomo e você canta ou toca. Aperte ■ para parar.", advanceOnClick: true },
    { target: () => q(".panel[data-panel=layers]:not([hidden])")() || q(".rdock")(), title: "3. Sua gravação vira camada", text: "A gravação aparece como uma camada nova (🎙) e, conectado, é transcrita em notas numa camada própria — cada uma com sua cor.", before: act("open-layers") },
    { target: ".score-editor [data-tool=select]", title: "4. Ajuste o que foi transcrito", text: "Com ⤧ Mover, arraste um retângulo para selecionar notas (das duas mãos, se quiser) e corrija altura e ritmo." },
    { target: ".desk-score .ds-play", title: "5. Ouça", text: "Toque o resultado no pentagrama do desktop." },
  ],
  audio: [
    { target: ".importer [data-tab=audio]", title: "1. Áudio", text: "Esta aba transforma uma canção ou gravação em partitura.", before: () => (document.querySelector(".importer [data-tab=audio]") as HTMLElement)?.click() },
    { target: ".importer [data-pane=audio] .drop", title: "2. Envie o arquivo", text: "Arraste o MP3/WAV/M4A para cá ou clique para escolher.", advanceOnClick: false },
    { target: ".importer [data-pane=audio] .trim", title: "3. Recorte o trecho", text: "Arraste sobre a onda para escolher só a parte que interessa e ouça antes com ▶ Ouvir trecho." },
    { target: ".importer [data-pane=audio] .grid2 select", title: "4. O que capturar", text: "Só a melodia (você harmoniza depois) ou melodia + harmonia." },
    { target: ".importer [data-pane=audio] .btn.primary.big", title: "5. Transcreva", text: "A IA escreve as notas e o resultado entra na Composição como camadas novas.", advanceOnClick: true },
  ],
  image: [
    { target: ".importer [data-tab=image]", title: "1. Foto da partitura", text: "Esta aba lê partituras fotografadas ou escaneadas (OMR).", before: () => (document.querySelector(".importer [data-tab=image]") as HTMLElement)?.click() },
    { target: ".importer [data-pane=image] .drop", title: "2. Envie a imagem", text: "Arraste a foto (JPG/PNG/PDF) ou clique para escolher. Fotos retas e bem iluminadas funcionam melhor." },
    { target: ".importer [data-pane=image] .crop-stage canvas", title: "3. Recorte as pautas", text: "Desenhe um retângulo só em volta das pautas; ⟳ gira a imagem se precisar." },
    { target: ".importer [data-pane=image] .btn.primary.big", title: "4. Ler partitura", text: "A IA lê as notas e manda para a Composição como camadas, prontas para editar e harmonizar.", advanceOnClick: true },
  ],
};
