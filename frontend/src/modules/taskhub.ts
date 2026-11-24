// Ícone de tarefas (canto inferior esquerdo): anel de progresso animado com % no centro e um personagem 3D
// que muda conforme a etapa. Clique abre o detalhamento — etapas concluídas ✓, etapa atual com detalhe,
// próximas etapas, tempo decorrido e estimativa — e, no fim, o resumo do resultado (ou o erro, com
// "Tentar de novo").
import { h } from "../core/ui";
import { allTasks, onTasks, removeTask, Task } from "../core/tasks";
import { ICONS } from "../core/icons";

const R = 26, C = 2 * Math.PI * R;
const fmt = (s: number) => (s < 60 ? `${Math.round(s)} s` : `${Math.floor(s / 60)} min ${String(Math.round(s % 60)).padStart(2, "0")} s`);
const iconOf = (t: Task) => (t.type === "transcribe_image" ? ICONS.t_annot : t.type === "export" ? ICONS.export : t.stage === "upload" ? ICONS.import : ICONS.record);

export function mountTaskHub() {
  let open = false;
  let shown = 0; // % exibido (anima suavemente até o real)
  const ring = h("div", { class: "th-ring" });
  ring.innerHTML = `<svg viewBox="0 0 64 64" aria-hidden="true">
    <defs><linearGradient id="thg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffd36e"/><stop offset=".5" stop-color="#ff6fae"/><stop offset="1" stop-color="#7c5cff"/></linearGradient></defs>
    <circle cx="32" cy="32" r="${R}" class="th-track"/><circle cx="32" cy="32" r="${R}" class="th-bar" stroke-dasharray="${C}" stroke-dashoffset="${C}"/></svg>`;
  const face = h("span", { class: "th-face" });
  const pctEl = h("b", { class: "th-pct" }, "0%");
  const badge = h("i", { class: "th-badge", hidden: true });
  const fab = h("button", { class: "th-fab", "aria-label": "Tarefas de IA", "aria-expanded": "false", onclick: () => { open = !open; draw(); } }, ring, face, pctEl, badge);
  const panel = h("section", { class: "th-panel", role: "dialog", "aria-label": "Andamento das tarefas", hidden: true });
  const root = h("div", { class: "taskhub", hidden: true }, panel, fab);
  document.body.append(root);

  function stepList(t: Task) {
    const idx = t.stages.findIndex((s) => s.key === t.stage);
    return h("ol", { class: "th-steps" }, ...t.stages.map((s, i) => {
      const done = t.status === "done" || i < idx;
      const cur = i === idx && !["done", "error", "cancelled"].includes(t.status);
      const bad = i === idx && t.status === "error";
      return h("li", { class: done ? "done" : cur ? "cur" : bad ? "bad" : "" },
        h("span", { class: "th-dot", "aria-hidden": "true" }, done ? "✓" : bad ? "!" : cur ? "" : String(i + 1)),
        h("div", {}, h("b", {}, s.label), cur && t.detail ? h("small", {}, t.detail) : ""));
    }));
  }

  function card(t: Task) {
    const el = (t.endedAt ?? Date.now()) - t.startedAt;
    const eta = t.status === "running" && t.pct > 12 ? (el / 1000) * (100 - t.pct) / t.pct : 0;
    return h("article", { class: "th-card " + t.status },
      h("header", {}, h("span", { class: "th-mini", html: iconOf(t) }),
        h("div", {}, h("b", {}, t.label), h("small", {}, t.status === "done" ? `concluída em ${fmt(el / 1000)}` : t.status === "error" ? "falhou" :
          `${Math.round(t.pct)}% · ${fmt(el / 1000)}${eta ? ` · faltam ~${fmt(eta)}` : ""}`)),
        h("button", { class: "fly-x", "aria-label": "Remover da lista", title: t.status === "done" || t.status === "error" ? "Remover" : "Ocultar (continua no servidor)", onclick: () => removeTask(t.id) }, "✕")),
      h("div", { class: "th-progress" }, h("i", { style: { width: Math.round(t.status === "done" ? 100 : t.pct) + "%" } })),
      t.status === "done" ? h("div", { class: "th-result" }, h("p", {}, "✅ " + (t.summary || "Concluído")),
        t.open ? h("button", { class: "btn primary", onclick: () => { t.open?.(); open = false; draw(); } }, "Ver resultado") : "") :
      t.status === "cancelled" ? h("div", { class: "th-result err" }, h("p", {}, "⏹ " + (t.error || "Cancelada")),
        t.retry ? h("button", { class: "btn", onclick: () => { removeTask(t.id); t.retry?.(); } }, "↻ Recomeçar") : "") :
      t.status === "error" ? h("div", { class: "th-result err" }, h("p", {}, "❌ " + (t.error || "Falha")),
        t.retry ? h("button", { class: "btn", onclick: () => { removeTask(t.id); t.retry?.(); } }, "↻ Tentar de novo") : "") : "",
      t.cancel && !["done", "error", "cancelled"].includes(t.status) ? h("button", { class: "btn ghost danger th-cancel", disabled: !!t.cancelRequested, onclick: () => t.cancel?.() }, t.cancelRequested ? "Cancelando…" : "⏹ Cancelar transcrição") : "",
      stepList(t));
  }

  let prevRunning = 0;
  function draw() {
    const list = allTasks();
    root.hidden = !list.length;
    if (!list.length) { open = false; return; }
    const running = list.filter((t) => !["done", "error", "cancelled"].includes(t.status));
    if (running.length > prevRunning) open = true; // nova tarefa: mostra o detalhe
    if (!running.length && prevRunning && open) setTimeout(() => { if (!allTasks().some((t) => !["done", "error", "cancelled"].includes(t.status)) && allTasks()[0]?.status === "done") { open = false; draw(); } }, 6000); // terminou bem: recolhe sozinho
    prevRunning = running.length;
    const main = running[0] ?? list[0];
    const target = main.status === "done" ? 100 : main.pct;
    root.classList.toggle("busy", !!running.length);
    root.classList.toggle("ok", !running.length && main.status === "done");
    root.classList.toggle("err", !running.length && main.status === "error");
    face.innerHTML = main.status === "done" && !running.length ? ICONS.play : iconOf(main);
    badge.hidden = running.length < 2; badge.textContent = String(running.length);
    fab.setAttribute("aria-expanded", String(open));
    fab.setAttribute("aria-label", `Tarefas de IA: ${main.label} — ${main.status === "done" ? "concluída" : main.status === "error" ? "falhou" : Math.round(target) + "%, " + main.stageLabel}`);
    fab.title = main.status === "done" ? `${main.label}: ${main.summary}` : main.status === "error" ? `${main.label}: ${main.error}` : `${main.stageLabel} — ${Math.round(target)}%`;
    panel.hidden = !open;
    if (open) panel.replaceChildren(h("header", { class: "th-head" }, h("b", {}, "Tarefas de IA"), h("small", {}, running.length ? `${running.length} em andamento` : "tudo pronto"),
      h("button", { class: "fly-x", "aria-label": "Fechar", onclick: () => { open = false; draw(); } }, "–")), ...list.map(card));
    (ring as any)._target = target;
  }
  // animação contínua: o anel caminha até o % real e "respira" enquanto espera a próxima etapa
  const bar = () => ring.querySelector(".th-bar") as SVGCircleElement;
  const tick = () => {
    const list = allTasks();
    if (list.length) {
      const running = list.find((t) => !["done", "error", "cancelled"].includes(t.status));
      const main = running ?? list[0];
      let target = main.status === "done" ? 100 : main.pct;
      // enquanto roda, avança devagar dentro da etapa atual (até o fim dela), para nunca parecer travado
      if (running) {
        const st = main.stages.find((s) => s.key === main.stage);
        const cap = st?.pct ? 6 + st.pct * 0.92 - 1 : target + 3;
        target = Math.max(target, Math.min(cap, shown + 0.03));
      }
      shown += (target - shown) * 0.08;
      if (Math.abs(target - shown) < 0.05) shown = target;
      bar()?.setAttribute("stroke-dashoffset", String(C * (1 - shown / 100)));
      pctEl.textContent = main.status === "error" && !running ? "!" : `${Math.round(shown)}%`;
      if (open && running) panel.querySelectorAll<HTMLElement>(".th-card.running .th-progress i, .th-card.queued .th-progress i, .th-card.upload .th-progress i")[0]?.style.setProperty("width", Math.round(shown) + "%");
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  setInterval(() => { if (open && allTasks().some((t) => !["done", "error", "cancelled"].includes(t.status))) draw(); }, 1000);
  onTasks(draw);
  draw();
}
