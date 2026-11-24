// Conta: login/cadastro (consentimento LGPD explícito), perfil, papéis (RBAC), portabilidade e exclusão.
import { h, toast, download } from "../core/ui";
import { api, setToken, currentUser } from "../core/api";

export function mountAccount(body: HTMLElement) {
  body.classList.add("account");
  const render = () => body.replaceChildren(currentUser ? profile() : authForm());
  function authForm() {
    let mode: "login" | "register" = "login";
    const f = h("form", { class: "auth" }) as HTMLFormElement;
    const draw = () => f.replaceChildren(
      h("div", { class: "seg" }, h("button", { type: "button", class: mode === "login" ? "on" : "", onclick: () => { mode = "login"; draw(); } }, "Entrar"),
        h("button", { type: "button", class: mode === "register" ? "on" : "", onclick: () => { mode = "register"; draw(); } }, "Criar conta")),
      mode === "register" ? h("label", {}, "Nome", h("input", { name: "name", required: true, autocomplete: "name" })) : "",
      h("label", {}, "E-mail", h("input", { name: "email", type: "email", required: true, autocomplete: "email" })),
      h("label", {}, "Senha", h("input", { name: "password", type: "password", required: true, minlength: 8, autocomplete: mode === "login" ? "current-password" : "new-password" })),
      mode === "register" ? h("label", { class: "check consent" }, h("input", { type: "checkbox", name: "consent", required: true }),
        " Li e aceito a Política de Privacidade. Autorizo o tratamento dos meus dados (nome, e-mail, composições e arquivos enviados) para operar o harmonIA, conforme a LGPD. Posso exportar ou excluir meus dados a qualquer momento.") : "",
      h("button", { class: "btn primary big" }, mode === "login" ? "Entrar" : "Criar conta"));
    f.onsubmit = async (e) => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(f)) as any;
      try {
        const r = await api(mode === "login" ? "/api/auth/login" : "/api/auth/register", { method: "POST",
          json: mode === "login" ? { email: d.email, password: d.password } : { ...d, consent: !!d.consent, lang: localStorage.getItem("harmonia.lang") || "pt" } });
        setToken(r.token, r.user); toast(`Bem-vindo(a), ${r.user.name.split(" ")[0]}!`, "ok"); render();
      } catch (err: any) { toast(err.message, "error"); }
    };
    draw();
    return h("div", {}, f, h("p", { class: "hint" }, "Seus dados pessoais são criptografados no servidor (AES-256-GCM). A IA nunca recebe seu nome ou e-mail."));
  }
  function profile() {
    const u = currentUser;
    return h("div", { class: "profile" },
      h("div", { class: "avatar-ph" }, u.name[0]),
      h("h3", {}, u.name), h("p", {}, u.email), h("span", { class: "chip" }, "Papel: " + u.role),
      h("p", { class: "hint" }, "Permissões: " + u.permissions.join(", ")),
      h("h4", {}, "Privacidade (LGPD)"),
      h("div", { class: "row" },
        h("button", { class: "btn", onclick: async () => { const d = await api("/api/account/export"); download(new Blob([JSON.stringify(d, null, 2)], { type: "application/json" }), "meus-dados-harmonia.json"); } }, "⇩ Exportar meus dados"),
        h("button", { class: "btn danger", onclick: async () => {
          if (prompt('Isso apaga definitivamente sua conta, composições e playlists. Digite EXCLUIR para confirmar.') !== "EXCLUIR") return;
          await api("/api/account", { method: "DELETE" }); setToken("", null); toast("Conta excluída", "ok"); render();
        } }, "Excluir minha conta")),
      h("button", { class: "btn ghost", onclick: () => { setToken("", null); render(); } }, "Sair"));
  }
  const on = () => render();
  addEventListener("auth", on);
  render();
  return () => removeEventListener("auth", on);
}
