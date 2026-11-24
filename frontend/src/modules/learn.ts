// Modo APRENDER (gamificado), em duas versões:
//  • Execução: tocar a partitura (microfone, teclado MIDI ou teclado do computador) — “Esperar por mim”
//    (a partitura só anda quando você acerta) ou “No tempo” (o acompanhamento toca e cada nota é julgada:
//    Perfeito / Bom / Atrasado / Errou). Pontos, combo, precisão, estrelas e XP; as notas ficam verdes ou
//    vermelhas na pauta e o Maestro comenta.
//  • Composição: desafios que a análise da partitura confere sozinha (motivo, módulos, cadência, pontuadas,
//    harmonia I–IV–V, dois instrumentos…), cada um com XP e medalha.
import { h, toast } from "../core/ui";
import { store } from "../core/store";
import { beatsPerMeasure, Layer, Score } from "../core/types";
import { analyze } from "../core/analysis";
import { listen, Heard } from "../core/listen";
import * as audio from "../core/audio";

// ------------------------------------------------------------------ marcas na partitura + progresso
export const learnMarks = new Map<string, "hit" | "miss" | "next" | "late">();
const KEY = "harmonia.learn.v1";
interface Prog { xp: number; badges: string[]; done: Record<string, boolean>; best: Record<string, number> }
const load = (): Prog => { try { return { xp: 0, badges: [], done: {}, best: {}, ...JSON.parse(localStorage.getItem(KEY) || "{}") }; } catch { return { xp: 0, badges: [], done: {}, best: {} }; } };
let prog = load();
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(prog)); } catch { /* */ } };
const level = () => 1 + Math.floor(prog.xp / 120);
const maestro = (text: string, ms = 6000) => dispatchEvent(new CustomEvent("maestro:say", { detail: { text, ms } }));
const NAMES = ["Dó", "Dó♯", "Ré", "Mi♭", "Mi", "Fá", "Fá♯", "Sol", "Lá♭", "Lá", "Si♭", "Si"];
const nm = (p: number) => `${NAMES[p % 12]}${Math.floor(p / 12) - 1}`;
function gain(xp: number, why: string) {
  const before = level(); prog.xp += xp; save();
  if (level() > before) { maestro(`🎉 Subiu para o nível ${level()}! ${why}`, 7000); confetti(); }
}
function badge(id: string, label: string) { if (prog.badges.includes(label)) return; prog.badges.push(label); save(); toast(`🏅 Medalha: ${label}`, "ok", 5000); confetti(); }
function confetti() {
  const box = h("div", { class: "confetti", "aria-hidden": "true" });
  for (let i = 0; i < 40; i++) box.append(h("i", { style: { left: Math.random() * 100 + "%", background: ["#ff5d8f", "#ffd36e", "#14d8c4", "#7c5cff", "#ff7a1a"][i % 5], animationDelay: Math.random() * 0.4 + "s", transform: `rotate(${Math.random() * 360}deg)` } as any }));
  document.body.append(box); setTimeout(() => box.remove(), 2200);
}

// ------------------------------------------------------------------ desafios de composição
interface Mission { id: string; title: string; hint: string; xp: number; check: (s: Score) => boolean }
const bpmOf = (s: Score) => beatsPerMeasure(s);
const noteLayers = (s: Score) => s.layers.filter((l) => l.kind !== "recording");
const MISSIONS: Mission[] = [
  { id: "full-measure", title: "Complete um compasso", hint: "Some as durações até encher o compasso (ex.: 4 semínimas em 4/4).", xp: 20,
    check: (s) => { const b = bpmOf(s); return noteLayers(s).some((l) => { const by = new Map<number, number>(); l.notes.forEach((n) => { const m = Math.floor(n.start / b); by.set(m, (by.get(m) || 0) + n.dur); }); return [...by.values()].some((d) => Math.abs(d - b) < 1e-6); }); } },
  { id: "dotted", title: "Use uma nota pontuada", hint: "Ponto = metade a mais: semínima pontuada (1½ tempo) ou mínima pontuada (3 tempos).", xp: 20,
    check: (s) => noteLayers(s).some((l) => l.notes.some((n) => [0.75, 1.5, 3].some((d) => Math.abs(n.dur - d) < 1e-3))) },
  { id: "motive", title: "Crie um motivo rítmico e repita-o", hint: "Repita o mesmo desenho rítmico em dois compassos — é o que dá identidade ao tema.", xp: 40, check: (s) => !!analyze(s).motive },
  { id: "modules", title: "Pergunta e resposta (2 módulos)", hint: "Escreva 2 frases de 2–4 compassos: a segunda responde à primeira (A–A' ou A–B).", xp: 40, check: (s) => analyze(s).modules.length >= 2 },
  { id: "tonic-end", title: "Termine na tônica", hint: "A última nota do tema na nota que dá nome à tonalidade traz sensação de chegada.", xp: 30,
    check: (s) => { const a = analyze(s); const ns = [...(a.theme?.notes || [])].sort((x, y) => x.start - y.start); return !!ns.length && ns[ns.length - 1].pitch % 12 === a.key.tonic; } },
  { id: "i-iv-v", title: "Harmonize com I, IV e V", hint: "Use os três acordes principais da tonalidade (em Dó: C, F e G).", xp: 40,
    check: (s) => { const a = analyze(s); if (a.suggested) return false; const d = new Set(s.chords.flat().map((c) => a.scale.indexOf(c.root))); return d.has(0) && d.has(3) && d.has(4); } },
  { id: "cadence", title: "Cadência autêntica", hint: "Feche uma frase com V → I (em Dó: G7 → C).", xp: 50, check: (s) => analyze(s).cadences.some((c) => c.kind.startsWith("autêntica")) && !analyze(s).suggested },
  { id: "two-inst", title: "Escreva para 2 instrumentos", hint: "No painel Estudo › Multi-instrumentos, dê um instrumento a outra camada ou adicione um.", xp: 40,
    check: (s) => new Set(noteLayers(s).filter((l) => l.notes.length).map((l) => l.instrument || "pauta")).size >= 2 },
  { id: "two-hands", title: "Duas mãos", hint: "Tenha notas nas duas pautas (Sol e Fá).", xp: 30, check: (s) => noteLayers(s).some((l) => l.staff === "bass" && l.notes.length) && noteLayers(s).some((l) => l.staff !== "bass" && l.notes.length) },
  { id: "recorded", title: "Grave pelo microfone", hint: "Use ● Gravar e cante ou toque — as notas viram uma camada 🎤.", xp: 30, check: (s) => s.layers.some((l) => l.live && l.notes.length) },
  { id: "ornament", title: "Ornamente o tema", hint: "Estudo › Solo e ornamentos › Ornamentar o tema.", xp: 30, check: (s) => s.layers.some((l) => l.notes.some((n) => !!n.effect)) },
];

// ------------------------------------------------------------------ painel
export function mountLearn(body: HTMLElement) {
  body.classList.add("learn");
  let mode: "play" | "compose" = "play";
  const lvl = h("div", { class: "ln-level" });
  const drawLevel = () => lvl.replaceChildren(h("b", {}, `Nível ${level()}`), h("div", { class: "ln-xpbar" }, h("i", { style: { width: `${((prog.xp % 120) / 120) * 100}%` } as any })),
    h("small", {}, `${prog.xp % 120}/120 XP · ${prog.badges.length} medalha(s)`));
  const tabs = h("div", { class: "ln-tabs", role: "tablist" });
  const pane = h("div", { class: "ln-pane" });
  const drawTabs = () => tabs.replaceChildren(
    h("button", { class: mode === "play" ? "on" : "", role: "tab", onclick: () => { mode = "play"; drawTabs(); draw(); } }, "🎹 Execução"),
    h("button", { class: mode === "compose" ? "on" : "", role: "tab", onclick: () => { mode = "compose"; drawTabs(); draw(); } }, "✍️ Composição"));
  body.append(lvl, tabs, pane);

  // ---------------------------------------------------------------- execução
  let session: { stop: () => void } | null = null;
  const layerSel = h("select", { "aria-label": "Camada para tocar" }) as HTMLSelectElement;
  const fillLayers = () => {
    const a = analyze(store.score);
    const ls = noteLayers(store.score).filter((l) => l.notes.length);
    const cur = layerSel.value || a.theme?.id || ls[0]?.id || "";
    layerSel.replaceChildren(...ls.map((l) => h("option", { value: l.id, selected: l.id === cur }, `${l.name} (${l.notes.length})`)));
    layerSel.value = cur;
  };
  const waitIn = h("input", { type: "checkbox", checked: true }) as HTMLInputElement;
  const octIn = h("input", { type: "checkbox", checked: true }) as HTMLInputElement;
  const speed = h("input", { type: "range", min: "40", max: "120", step: "5", value: "80", "aria-label": "Velocidade" }) as HTMLInputElement;
  const speedT = h("small", {}, "80%"); speed.oninput = () => (speedT.textContent = speed.value + "%");
  const hudScore = h("b", { class: "ln-score" }, "0"), hudCombo = h("span", { class: "ln-combo" }, ""), hudAcc = h("span", {}, "—"), hudFb = h("div", { class: "ln-fb" }, "Pronto?");
  const hudBar = h("div", { class: "ln-bar" }, h("i"));
  const hudStars = h("div", { class: "ln-stars" }, "☆☆☆");
  const startB = h("button", { class: "btn primary big", onclick: () => (session ? stopPlay() : startPlay()) }, "▶ Começar") as HTMLButtonElement;

  function feedback(txt: string, cls: string) { hudFb.textContent = txt; hudFb.className = "ln-fb " + cls; void hudFb.offsetWidth; hudFb.classList.add("pop"); }
  function stopPlay(final = false) {
    session?.stop(); session = null; startB.textContent = "▶ Começar"; body.classList.remove("ln-on");
    if (!final) { learnMarks.clear(); store.emit("learn"); }
  }
  async function startPlay() {
    const l = store.score.layers.find((x) => x.id === layerSel.value) as Layer | undefined;
    if (!l?.notes.length) { toast("Escolha uma camada com notas", "warn"); return; }
    const bpm = bpmOf(store.score);
    const sel = [...store.selectedMeasures].sort((a, b) => a - b);
    const inSel = (st: number) => !sel.length || (st >= sel[0] * bpm && st < (sel[sel.length - 1] + 1) * bpm);
    // grupos = notas que começam juntas (acordes contam como um alvo)
    const groups: { start: number; pitches: number[]; ids: string[]; done?: "hit" | "miss" }[] = [];
    for (const n of [...l.notes].filter((n) => inSel(n.start)).sort((a, b) => a.start - b.start)) {
      const g = groups[groups.length - 1];
      if (g && Math.abs(g.start - n.start) < 0.02) { g.pitches.push(n.pitch); g.ids.push(n.id); } else groups.push({ start: n.start, pitches: [n.pitch], ids: [n.id] });
    }
    let score = 0, combo = 0, hits = 0, misses = 0, idx = 0, stable = 0, wrong = 0;
    const total = groups.length;
    learnMarks.clear();
    const upd = () => {
      hudScore.textContent = String(score); hudCombo.textContent = combo > 1 ? `combo ×${combo}` : "";
      const judged = hits + misses; hudAcc.textContent = judged ? `${Math.round((hits / judged) * 100)}% de acerto` : "—";
      (hudBar.firstChild as HTMLElement).style.width = `${((hits + misses) / total) * 100}%`;
      store.emit("learn");
    };
    const matches = (heard: number[], g: typeof groups[0], src: Heard["source"]) => {
      const ok = (p: number) => heard.some((m) => m === p || (octIn.checked && (m - p) % 12 === 0));
      const n = g.pitches.filter(ok).length;
      return src === "mic" && g.pitches.length > 1 ? n >= Math.ceil(g.pitches.length / 2) : n === g.pitches.length;
    };
    const markNext = () => { if (groups[idx]) { groups[idx].ids.forEach((id) => learnMarks.set(id, "next")); store.cursorBeat = groups[idx].start; store.emit("cursor"); } };
    const finish = () => {
      const acc = total ? hits / total : 0;
      const stars = acc >= 0.9 ? 3 : acc >= 0.7 ? 2 : acc >= 0.4 ? 1 : 0;
      hudStars.textContent = "★".repeat(stars) + "☆".repeat(3 - stars);
      const xp = Math.round(score / 25) + stars * 10;
      gain(xp, "Continue praticando!");
      const k = `${store.score.title}|${l.name}`; if ((prog.best[k] ?? 0) < stars) { prog.best[k] = stars; save(); }
      if (stars === 3) badge("perfect", "Execução 3 estrelas");
      if (hits >= 50) badge("50hits", "50 notas certas");
      feedback(`Fim! ${Math.round(acc * 100)}% · ${"★".repeat(stars)} · +${xp} XP`, "end");
      maestro(stars === 3 ? `Bravo! ${Math.round(acc * 100)}% de acerto — três estrelas! 🌟` : stars >= 2 ? `Muito bem: ${Math.round(acc * 100)}%. Repita os compassos em vermelho mais devagar.` : `Vamos com calma: ligue “Esperar por mim” e baixe a velocidade. Cada nota certa fica verde.`, 8000);
      confetti(); stopPlay(true); drawLevel(); upd();
    };
    startB.textContent = "■ Parar"; body.classList.add("ln-on"); hudStars.textContent = "☆☆☆";
    feedback(waitIn.checked ? `Toque: ${groups[0].pitches.map(nm).join(" + ")}` : "Prepare-se…", "info");
    if (waitIn.checked) {
      // ESPERAR POR MIM: só avança quando a nota (ou acorde) certa soa
      markNext(); upd();
      const lis = await listen((hh) => {
        const g = groups[idx]; if (!g) return;
        if (!hh.midis.length) { stable = 0; wrong = Math.max(0, wrong - 1); return; }
        if (matches(hh.midis, g, hh.source)) {
          if (++stable >= (hh.source === "mic" ? 3 : 1)) {
            stable = 0; wrong = 0; combo++; hits++; score += 100 + Math.min(combo, 20) * 10;
            g.ids.forEach((id) => learnMarks.set(id, g.done === "miss" ? "late" : "hit")); g.done = g.done ?? "hit";
            feedback(combo >= 5 ? `🔥 ${combo} seguidas!` : "✔ Certo!", "hit");
            idx++; if (idx >= total) { lis.stop(); finish(); return; }
            markNext(); feedback(`Agora: ${groups[idx].pitches.map(nm).join(" + ")}`, "info");
            if (combo === 10) maestro("Dez seguidas! Você está pegando o jeito. 🎶", 4000);
          }
        } else if ((hh.source !== "mic" ? (wrong = 10) : ++wrong) === 10 && !g.done) {
          g.done = "miss"; misses++; combo = 0; g.ids.forEach((id) => learnMarks.set(id, "miss"));
          feedback(`✖ Ouvi ${hh.midis.slice(0, 3).map(nm).join("+")} — era ${g.pitches.map(nm).join(" + ")}`, "miss");
        }
        upd();
      }, { poly: groups.some((g) => g.pitches.length > 1) });
      session = { stop: () => lis.stop() };
      if (!lis.hasMic) toast("Sem microfone: use o teclado do computador (A W S E D…) ou um teclado MIDI", "info", 5000);
    } else {
      // NO TEMPO: o acompanhamento toca (a camada escolhida fica muda) e cada nota é julgada na hora
      const sp = +speed.value / 100;
      const s2 = JSON.parse(JSON.stringify(store.score)) as Score; s2.tempo = Math.round(store.score.tempo * sp);
      s2.layers.forEach((x) => { if (x.id === l.id) x.muted = true; });
      let beat = -1;
      const tol = 0.4;
      const lis = await listen((hh) => {
        if (beat < 0 || !hh.midis.length) return;
        const g = groups.find((x) => !x.done && Math.abs(x.start - beat) <= tol && matches(hh.midis, x, hh.source));
        if (!g) return;
        const dt = Math.abs(g.start - beat);
        const q = dt < 0.12 ? ["Perfeito!", 120] : dt < 0.25 ? ["Bom!", 80] : ["No limite", 40];
        g.done = "hit"; hits++; combo++; score += (q[1] as number) + Math.min(combo, 20) * 5;
        g.ids.forEach((id) => learnMarks.set(id, dt < 0.25 ? "hit" : "late"));
        feedback(`${q[0]}${combo >= 5 ? ` 🔥×${combo}` : ""}`, dt < 0.25 ? "hit" : "late"); upd();
      }, { poly: groups.some((g) => g.pitches.length > 1) });
      const from = groups[0].start - (groups[0].start % bpm), to = (Math.floor(groups[groups.length - 1].start / bpm) + 1) * bpm;
      await audio.play(s2, { fromBeat: from, toBeat: to, metronome: true,
        onBeat: (b) => {
          beat = b;
          for (const g of groups) if (!g.done && b > g.start + tol) { g.done = "miss"; misses++; combo = 0; g.ids.forEach((id) => learnMarks.set(id, "miss")); feedback(`✖ Faltou ${g.pitches.map(nm).join(" + ")}`, "miss"); upd(); }
          const nx = groups.find((g) => !g.done); if (nx) nx.ids.forEach((id) => learnMarks.has(id) || learnMarks.set(id, "next"));
        },
        onEnd: () => { lis.stop(); finish(); } }, { id: "learn", label: "Aprender — execução", icon: "🏆" });
      session = { stop: () => { lis.stop(); audio.stop(); } };
    }
  }

  // ---------------------------------------------------------------- composição
  const missionsBox = h("div", { class: "ln-missions" });
  const drawMissions = () => {
    const s = store.score;
    let newly = 0; const got: string[] = [];
    const rows = MISSIONS.map((m) => {
      let ok = false; try { ok = m.check(s); } catch { ok = false; }
      if (ok && !prog.done[m.id]) { prog.done[m.id] = true; newly++; gain(m.xp, m.title); got.push(`${m.title} (+${m.xp} XP)`); }
      const done = !!prog.done[m.id];
      return h("div", { class: "ln-m" + (done ? " done" : "") + (ok ? " now" : "") }, h("span", { class: "ln-ck" }, done ? "✓" : ""),
        h("div", {}, h("b", {}, m.title), h("small", {}, m.hint)), h("i", {}, `+${m.xp}`));
    });
    if (newly) {
      save(); confetti(); drawLevel();
      toast(got.length === 1 ? `🏆 Desafio cumprido: ${got[0]}` : `🏆 ${got.length} desafios cumpridos: ${got.join(" · ")}`, "ok", 6000);
      maestro(got.length === 1 ? `Desafio cumprido: ${got[0].replace(/ \(\+.*$/, "")}! 👏` : `Uau, ${got.length} desafios de uma vez! 👏`, 5000);
    }
    const n = Object.keys(prog.done).length;
    if (n >= 5) badge("composer5", "Compositor(a) iniciante");
    if (n >= MISSIONS.length) badge("composerAll", "Todos os desafios");
    missionsBox.replaceChildren(h("div", { class: "ln-mhead" }, h("b", {}, `${n}/${MISSIONS.length} desafios`), h("div", { class: "ln-bar" }, h("i", { style: { width: `${(n / MISSIONS.length) * 100}%` } as any }))), ...rows,
      h("button", { class: "btn ghost", onclick: () => { prog.done = {}; save(); drawMissions(); } }, "↺ Recomeçar desafios"));
  };

  function draw() {
    if (mode === "play") {
      fillLayers();
      pane.replaceChildren(
        h("label", { class: "ln-f" }, h("small", {}, "Tocar a camada"), layerSel),
        h("div", { class: "ln-opts" }, h("label", { class: "st-chk" }, waitIn, " Esperar por mim"), h("label", { class: "st-chk" }, octIn, " Aceitar outra oitava")),
        h("label", { class: "ln-f" }, h("small", {}, "Velocidade (no tempo)"), h("div", { class: "row" }, speed, speedT)),
        h("div", { class: "ln-hud" }, h("div", { class: "ln-top" }, hudScore, hudCombo), hudFb, hudBar, h("div", { class: "ln-row" }, hudAcc, hudStars)),
        startB,
        h("p", { class: "hint" }, "Toque no instrumento perto do microfone, num teclado MIDI ou no teclado do computador (A W S E D F T G Y H U J K = dó a dó). Selecione compassos na faixa numerada para treinar só um trecho. A nota seguinte pisca em azul; certas ficam verdes, erradas vermelhas."));
    } else {
      pane.replaceChildren(h("p", { class: "hint" }, "Desafios conferidos automaticamente enquanto você compõe — cumpra para ganhar XP e medalhas."), missionsBox);
      drawMissions();
    }
  }
  drawLevel(); drawTabs(); draw();
  let raf = 0;
  const off = store.on((r) => { if (r === "autosave" || r === "learn" || r === "cursor") return; cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { if (mode === "compose") drawMissions(); else if (!session) fillLayers(); }); });
  return () => { off(); stopPlay(); };
}
