// Administração (visível só para o papel admin): visão geral, usuários/papéis, moderação e auditoria.
import { h, toast } from "../core/ui";
import { api, currentUser } from "../core/api";

const ROLES: [string, string][] = [["admin", "Administrador"], ["composer", "Compositor"], ["student", "Estudante"], ["viewer", "Ouvinte"]];

export function mountAdmin(body: HTMLElement) {
  body.classList.add("admin-app");
  const tabs = h("div", { class: "tabs" });
  const main = h("div");
  body.append(tabs, main);
  const views: Record<string, () => Promise<HTMLElement>> = { "📊 Visão geral": overview, "👥 Usuários": users, "🌐 Moderação": moderation, "🧾 Auditoria LGPD": audit, "🔄 Atualizações": updates, "🤖 IA": aiProviders };

  async function aiProviders() {
    let r = await api("/api/admin/ai");
    const KNOWN: [string, string, string][] = [
      ["groq", "Groq (grátis)", "https://console.groq.com/keys"], ["gemini", "Google Gemini (grátis)", "https://aistudio.google.com/apikey"],
      ["github", "GitHub Models (grátis — PAT com models:read)", "https://github.com/settings/personal-access-tokens/new"],
      ["openrouter", "OpenRouter (modelos :free)", "https://openrouter.ai/keys"], ["cerebras", "Cerebras (grátis)", "https://cloud.cerebras.ai"],
      ["mistral", "Mistral (plano Experiment)", "https://console.mistral.ai/api-keys"], ["anthropic", "Anthropic Claude", "https://console.anthropic.com/settings/keys"],
      ["openai", "OpenAI", "https://platform.openai.com/api-keys"], ["deepseek", "DeepSeek", "https://platform.deepseek.com/api_keys"],
      ["xai", "xAI Grok", "https://console.x.ai"], ["together", "Together AI", "https://api.together.ai/settings/api-keys"], ["huggingface", "Hugging Face (grátis)", "https://huggingface.co/settings/tokens"], ["pollinations", "Pollinations (grátis; sk_ do enter.pollinations.ai)", "https://enter.pollinations.ai"], ["__custom", "➕ Outra IA (compatível com OpenAI)", ""]];
    const SRC: Record<string, string> = { painel: "🔐 painel", env: "📄 .env / GitHub", anon: "🌐 anônimo (grátis)", "": "—" };
    const src = (x: string) => SRC[x] ?? (x?.startsWith("apps:") ? "🔗 app " + x.slice(5).replace(/\+/g, ", ") : x || "—");
    /** Lista das chaves do provedor na ordem de prioridade, com o resultado do último teste. */
    const candList = (cs: any[] = []) => cs.length > 1 || cs.some((c) => c.source !== "env") ? h("ul", { class: "cand-list" }, ...cs.map((c) =>
      h("li", { class: (c.active ? "active " : "") + (c.verified === false || c.ok === false ? "bad" : c.verified || c.ok ? "good" : "") },
        h("span", {}, c.ok === true || c.verified === true ? "✅" : c.ok === false || c.verified === false ? "❌" : "◻️"), " ", src(c.source), " ", h("code", {}, c.hint),
        c.active ? h("small", { class: "chip" }, "em uso") : "", c.ok === false && c.detail ? h("small", { class: "hint" }, ` — ${c.code ? "HTTP " + c.code + " · " : ""}${c.detail}`) : ""))) : "";
    const statusBox = h("div");
    const drawStatus = () => statusBox.replaceChildren(h("table", { class: "grid-table" },
      h("thead", {}, h("tr", {}, ...["#", "Provedor", "Chave", "Modelo", "Estado", ""].map((t) => h("th", {}, t)))),
      h("tbody", {}, ...r.providers.map((p: any) => h("tr", { class: p.configured ? "" : "muted" },
        h("td", {}, String(p.position)),
        h("td", {}, h("b", {}, p.label || p.name), p.free ? h("small", { class: "chip" }, "grátis") : "", p.custom ? h("small", { class: "chip" }, "personalizada") : ""),
        h("td", {}, p.configured ? `${src(p.keySource)} ${p.keyHint}` : "—", candList(p.candidates)),
        h("td", { class: "mono" }, p.model),
        h("td", {}, !p.configured ? "sem chave" : p.paused ? `⏸ em pausa (${p.lastError})` : p.lastOk ? "✅ ok" : "pronto"),
        h("td", { class: "row-actions" },
          p.configured ? h("button", { class: "btn ghost", title: "Testar só esta IA agora", onclick: (e: Event) => testOne(p.name, e.currentTarget as HTMLButtonElement) }, "🧪 Testar") : "",
          h("button", { class: "btn ghost", title: p.configured ? "Trocar a chave / modelo desta IA" : "Cadastrar chave para esta IA", onclick: () => editCred(p.name) }, p.configured ? "🔑 Trocar" : "🔑 Cadastrar"),
          p.keySource === "painel" ? h("button", { class: "btn ghost danger", title: "Remover credencial do painel", onclick: async () => {
          if (!confirm(`Remover a credencial de ${p.label}?`)) return;
          r = await api(`/api/admin/ai/credentials/${p.name}`, { method: "DELETE" }); drawStatus(); toast("Credencial removida", "ok");
        } }, "🗑") : ""))))));
    /** Testa uma IA isolada e mostra o resultado na própria linha (notificação também). */
    async function testOne(name: string, btn: HTMLButtonElement) {
      btn.disabled = true; btn.textContent = "⏳";
      try {
        const d = await api("/api/admin/ai/diagnose", { method: "POST", json: { names: [name] } });
        r = { providers: d.providers }; drawStatus();
        const x = d.results[0];
        if (x?.ok) toast(`✅ ${x.label} respondeu em ${x.ms} ms`, "ok", 4000);
        else { toast(`❌ ${x?.label || name}: ${x?.code ? "HTTP " + x.code + " — " : ""}${x?.detail || "falhou"}${x?.provider_message ? " · " + x.provider_message : ""}`, "error", 9000); editCred(name); }
      } catch (e: any) { toast(e.message, "error"); btn.disabled = false; btn.textContent = "🧪 Testar"; }
    }
    drawStatus();

    // ----- diagnóstico
    const diagBox = h("div");
    const diagBtn = h("button", { class: "btn primary", onclick: async () => {
      diagBtn.disabled = true; diagBox.replaceChildren(h("p", { class: "hint" }, h("span", { class: "spin" }), "Atualizando o acervo de chaves (.env do GitHub e outras apps) e testando cada uma…"));
      try {
        const d = await api("/api/admin/ai/diagnose", { method: "POST" });
        r = { providers: d.providers }; drawStatus();
        diagBox.replaceChildren(
          h("p", {}, h("b", {}, d.working ? `✅ ${d.working} IA(s) funcionando` : "⚠️ Nenhuma IA generativa respondeu — o app segue com tradução grátis e Maestro offline"), ` · ${d.ms} ms`,
            h("span", { class: "hint" }, d.poolRefreshed ? " · acervo atualizado agora (.env do GitHub + outras apps da VPS)" : " · acervo de chaves: última coleta automática")),
          h("table", { class: "grid-table" }, h("thead", {}, h("tr", {}, ...["", "IA", "Origem", "Modelo", "Tempo", "Diagnóstico"].map((t) => h("th", {}, t)))),
            h("tbody", {}, ...d.results.map((x: any) => h("tr", { class: x.state === "sem_chave" ? "muted" : "" },
              h("td", {}, x.ok ? "✅" : x.state === "sem_chave" ? "⚪" : "❌"), h("td", {}, h("b", {}, x.label)), h("td", {}, src(x.keySource), x.note ? h("div", { class: "hint" }, "↪ " + x.note) : "", candList(x.candidates)),
              h("td", { class: "mono" }, x.model), h("td", {}, x.ms != null ? `${x.ms} ms` : "—"),
              h("td", {}, x.ok ? (x.reply ? `respondeu “${x.reply}”` : x.detail || "ok") : `${x.code ? "HTTP " + x.code + " — " : ""}${x.detail}`,
                x.provider_message ? h("div", { class: "mono hint" }, "Provedor: " + x.provider_message) : "",
                !x.ok && !["mymemory", "offline"].includes(x.name) ? h("button", { class: "btn ghost", onclick: () => editCred(x.name) }, x.state === "sem_chave" ? "🔑 Cadastrar chave" : "🔑 Trocar chave e testar") : ""))))));
      } catch (e: any) { diagBox.replaceChildren(h("p", {}, "❌ " + e.message)); }
      finally { diagBtn.disabled = false; }
    } }, "🩺 Rodar diagnóstico") as HTMLButtonElement;

    // ----- cadastro de credenciais
    const sel = h("select", {}, ...KNOWN.map(([v, l]) => h("option", { value: v }, l))) as HTMLSelectElement;
    const key = h("input", { type: "password", autocomplete: "off", placeholder: "Cole a chave de API (fica cifrada no servidor)" }) as HTMLInputElement;
    const model = h("input", { placeholder: "Modelo (opcional — vazio usa o padrão)" }) as HTMLInputElement;
    const cname = h("input", { placeholder: "identificador (ex.: deepseek)" }) as HTMLInputElement;
    const clabel = h("input", { placeholder: "Nome exibido (ex.: DeepSeek)" }) as HTMLInputElement;
    const curl = h("input", { placeholder: "https://api.exemplo.com/v1/chat/completions" }) as HTMLInputElement;
    const ckind = h("select", {}, h("option", { value: "openai" }, "compatível com OpenAI"), h("option", { value: "anthropic" }, "API Anthropic"), h("option", { value: "gemini" }, "API Gemini")) as HTMLSelectElement;
    const cfree = h("input", { type: "checkbox" }) as HTMLInputElement;
    const link = h("a", { target: "_blank", rel: "noopener", class: "hint" });
    const customBox = h("div", { class: "grid2", hidden: true }, h("label", {}, "Identificador", cname), h("label", {}, "Nome", clabel),
      h("label", {}, "Endpoint (URL https)", curl), h("label", {}, "Formato da API", ckind), h("label", { class: "check" }, cfree, " gratuita"));
    const result = h("div", { class: "row" });
    const syncSel = () => {
      const k = KNOWN.find((x) => x[0] === sel.value)!;
      customBox.hidden = sel.value !== "__custom";
      link.textContent = k[2] ? "Obter chave ↗" : ""; if (k[2]) link.setAttribute("href", k[2]); else link.removeAttribute("href");
      const cur = r.providers.find((p: any) => p.name === sel.value);
      model.placeholder = cur ? `Modelo (vazio = ${cur.model})` : "Modelo (ex.: deepseek-chat)";
    };
    sel.addEventListener("change", syncSel); syncSel();
    /** Leva ao formulário já com o provedor escolhido: basta colar a nova chave e "Salvar e testar". */
    function editCred(name: string) {
      if (KNOWN.some((k) => k[0] === name)) sel.value = name;
      else { sel.value = "__custom"; const cur = r.providers.find((p: any) => p.name === name); cname.value = name; clabel.value = cur?.label || name; }
      syncSel();
      formBox.scrollIntoView({ behavior: "smooth", block: "center" });
      formBox.classList.add("flash"); setTimeout(() => formBox.classList.remove("flash"), 900);
      setTimeout(() => key.focus(), 300);
    }
    const save = h("button", { class: "btn primary", onclick: async () => {
      const custom = sel.value === "__custom";
      const body: any = { name: custom ? cname.value.trim().toLowerCase() : sel.value, key: key.value.trim() || undefined, model: model.value.trim() || undefined, test: true };
      if (custom) Object.assign(body, { label: clabel.value.trim(), url: curl.value.trim(), kind: ckind.value, free: cfree.checked });
      save.disabled = true; result.textContent = "Salvando e testando…";
      try {
        const out = await api("/api/admin/ai/credentials", { method: "POST", json: body });
        key.value = ""; r = { providers: out.providers }; drawStatus();
        const t = out.test;
        result.textContent = t?.ok ? `✅ Salva e funcionando (${t.ms} ms)` : `⚠️ Salva, mas o teste falhou: ${t?.code ? "HTTP " + t.code + " — " : ""}${t?.detail || "sem resposta"}`;
      } catch (e: any) { result.textContent = "❌ " + e.message; }
      finally { save.disabled = false; }
    } }, "💾 Salvar e testar") as HTMLButtonElement;

    const formBox = h("div", { class: "cred-form" },
      h("div", { class: "grid2" }, h("label", {}, "Provedor", sel), h("label", {}, "Modelo", model)),
      customBox,
      h("label", { class: "prop" }, h("span", {}, "Chave de API"), h("div", { class: "prop-ctl" }, key)), link,
      h("div", { class: "row" }, save, result));
    key.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); save.click(); } });
    return h("div", { class: "ai-admin" },
      h("h4", {}, "Provedores (ordem de failover)"), statusBox,
      h("h4", {}, "Diagnóstico"), h("div", { class: "row" }, diagBtn, h("span", { class: "hint" }, "Recolhe as chaves do .env (GitHub) e de outras apps da VPS, testa todas e mostra qual funciona e o motivo de falha. Ordem de uso: 📄 .env/GitHub → 🔗 outras apps → 🔐 painel.")), diagBox,
      h("h4", {}, "Registrar ou atualizar credencial"), formBox,
      h("p", { class: "hint" }, "A chave é cifrada (AES-256-GCM) antes de ir ao banco e nunca volta para a tela — aparecem só os 4 últimos caracteres. Prioridade: a chave do .env/GitHub é usada primeiro; as de outras apps da VPS e as cadastradas aqui são reservas e só entram se a anterior faltar ou falhar no teste. Deixe a chave em branco para trocar só o modelo."));
  }

  async function updates() {
    const [sys, hc] = await Promise.all([api("/api/admin/system"), api("/api/health")]);
    const au = sys.autoupdate;
    const label: Record<string, string> = { ok: "✅ Em dia", updating: "⏳ Aplicando atualização", waiting: "⏳ Aguardando testes (CI)", blocked: "⛔ Versão bloqueada", rolled_back: "↩️ Revertido", error: "⚠️ Erro", disabled: "⏸ Desativado" };
    return h("div", {},
      h("div", { class: "stats" },
        h("div", { class: "stat" }, h("b", {}, hc.version), h("small", {}, "versão em execução")),
        h("div", { class: "stat" }, h("b", { style: { fontSize: "16px" } }, au ? (label[au.state] || au.state) : "—"), h("small", {}, au ? new Date(au.at).toLocaleString() : "sem registro ainda")),
        h("div", { class: "stat" }, h("b", { style: { fontSize: "16px" } }, au?.sha ? au.sha.slice(0, 7) : hc.commit), h("small", {}, "commit"))),
      h("p", {}, au ? au.message : "A atualização automática registra o estado aqui após a primeira verificação (a cada 5 minutos)."),
      h("p", { class: "hint" }, "Fluxo: alteração publicada no GitHub → testes automáticos (CI) → a VPS verifica a cada 5 min e aplica só versões aprovadas → se o app não responder, volta sozinho para a versão anterior."),
      sys.log.length ? h("pre", { class: "mono log-box" }, sys.log.join("\n")) : "");
  }
  let cur = Object.keys(views)[0];
  const go = async (k: string) => {
    cur = k;
    tabs.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.textContent === k));
    main.replaceChildren(h("div", { class: "spin-wrap" }, h("span", { class: "spin" })));
    try { main.replaceChildren(await views[k]()); } catch (e: any) { main.replaceChildren(h("p", { class: "hint" }, e.message)); }
  };
  Object.keys(views).forEach((k) => tabs.append(h("button", { onclick: () => go(k) }, k)));

  async function overview() {
    const [st, hc] = await Promise.all([api("/api/admin/stats"), api("/api/health")]);
    const card = (n: any, l: string) => h("div", { class: "stat" }, h("b", {}, String(n)), h("small", {}, l));
    return h("div", {},
      h("div", { class: "stats" }, card(st.users, "usuários"), card(st.activeUsers, "ativos"), card(st.compositions, "composições"),
        card(st.public, "públicas"), card(st.featured, "em destaque"), card(st.playlists, "playlists/álbuns"), card(st.storageMB + " MB", "mídia enviada")),
      h("p", { class: "hint" }, `API ${hc.version} · commit ${hc.commit} · IA ${hc.ai_full ? "completa" : "leve (sem transcrição de áudio/foto)"}`));
  }

  async function users() {
    const rows = await api<any[]>("/api/admin/users");
    const q = h("input", { placeholder: "Buscar nome ou e-mail…", oninput: () => draw() }) as HTMLInputElement;
    const tbody = h("tbody");
    const draw = () => tbody.replaceChildren(...rows.filter((u) => !q.value || (u.name + u.email).toLowerCase().includes(q.value.toLowerCase())).map((u) => {
      const self = u.id === currentUser?.id;
      const role = h("select", { disabled: self, onchange: async () => {
        try { await api(`/api/admin/users/${u.id}`, { method: "PATCH", json: { role: role.value } }); u.role = role.value; toast(`${u.name}: papel ${role.value}`, "ok"); }
        catch (e: any) { toast(e.message, "error"); role.value = u.role; }
      } }, ...ROLES.map(([v, l]) => h("option", { value: v, selected: v === u.role }, l))) as HTMLSelectElement;
      const active = h("input", { type: "checkbox", checked: u.active, disabled: self, onchange: async () => {
        try { await api(`/api/admin/users/${u.id}`, { method: "PATCH", json: { active: active.checked } }); u.active = active.checked; toast(active.checked ? "Acesso liberado" : "Acesso bloqueado", "ok"); }
        catch (e: any) { toast(e.message, "error"); active.checked = u.active; }
      } }) as HTMLInputElement;
      return h("tr", { class: u.active ? "" : "muted" }, h("td", {}, h("b", {}, u.name), self ? h("small", { class: "chip" }, "você") : ""),
        h("td", {}, u.email), h("td", {}, role), h("td", {}, active), h("td", {}, String(u.compositions)), h("td", {}, new Date(u.createdAt).toLocaleDateString()));
    }));
    draw();
    return h("div", {}, h("div", { class: "row" }, q, h("span", { class: "hint" }, `${rows.length} usuários · dados pessoais exibidos apenas para fins administrativos (acesso registrado na auditoria)`)),
      h("table", { class: "grid-table" }, h("thead", {}, h("tr", {}, ...["Nome", "E-mail", "Papel", "Ativo", "Obras", "Desde"].map((t) => h("th", {}, t)))), tbody));
  }

  async function moderation() {
    const rows = await api<any[]>("/api/library/public");
    if (!rows.length) return h("p", { class: "hint" }, "Nenhuma composição pública no momento.");
    return h("table", { class: "grid-table" }, h("thead", {}, h("tr", {}, ...["Título", "Autor", "Destaque", "Atualizada", ""].map((t) => h("th", {}, t)))),
      h("tbody", {}, ...rows.map((c) => h("tr", {}, h("td", {}, c.title), h("td", {}, c.author || "—"), h("td", {}, c.featured ? "⭐" : ""),
        h("td", {}, new Date(c.updatedAt).toLocaleDateString()),
        h("td", {}, h("button", { class: "btn ghost danger", onclick: async () => {
          if (!confirm(`Retirar "${c.title}" da biblioteca pública?`)) return;
          await api(`/api/admin/compositions/${c.id}/unpublish`, { method: "POST" }); toast("Retirada da biblioteca pública", "ok"); go(cur);
        } }, "Despublicar"))))));
  }

  async function audit() {
    const rows = await api<any[]>("/api/admin/audit?limit=200");
    return h("table", { class: "grid-table" }, h("thead", {}, h("tr", {}, ...["Quando", "Usuário", "Ação", "Detalhe"].map((t) => h("th", {}, t)))),
      h("tbody", {}, ...rows.map((a) => h("tr", {}, h("td", {}, new Date(a.at).toLocaleString()), h("td", {}, a.userId ?? "—"), h("td", {}, a.action),
        h("td", { class: "mono" }, Object.keys(a.detail || {}).length ? JSON.stringify(a.detail) : "")))));
  }

  go(cur);
}
