// Tela de entrada (login, criar conta ou visitante sem senha) e passo a passo para novos usuários.
// O usuário pode pular para a estação completa (desktop) a qualquer momento — cria um projeto vazio.
import { h, toast } from "../core/ui";
import { api, setToken, currentUser } from "../core/api";
import { store } from "../core/store";
import { prefs, setCaptureMode, CaptureMode } from "../core/prefs";
import { KEY_NAMES, NAMES } from "../core/theory";
import { startTour, TOURS } from "./tour";

const tour = (name: string) => setTimeout(() => startTour(name, TOURS[name]), 650);

type Goal = "compose" | "image" | "record" | "audio";
const onboardKey = () => `harmonia.onboarded.${currentUser?.id ?? "anon"}`;
export const needsOnboarding = () => !localStorage.getItem(onboardKey());
const markOnboarded = () => localStorage.setItem(onboardKey(), "1");

let overlay: HTMLElement | null = null;
function shell(content: HTMLElement, label: string) {
  overlay?.remove();
  overlay = h("div", { class: "welcome", role: "dialog", "aria-modal": "true", "aria-label": label },
    h("div", { class: "welcome-card" }, h("div", { class: "welcome-brand" }, h("b", {}, "harmon"), h("i", {}, "IA")), content));
  document.body.append(overlay);
  (overlay.querySelector("input, button") as HTMLElement | null)?.focus();
}
const close = () => { overlay?.remove(); overlay = null; };

// ---------------------------------------------------------------- entrada
export function showLogin(onDone: () => void) {
  let mode: "login" | "register" = "login";
  const form = h("form", { class: "auth" }) as HTMLFormElement;
  const draw = () => form.replaceChildren(
    h("p", { class: "welcome-sub" }, "Transforme áudio, fotos de partitura e cifras em partitura de piano — e componha com ajuda da IA."),
    h("div", { class: "seg", role: "tablist" },
      h("button", { type: "button", role: "tab", class: mode === "login" ? "on" : "", "aria-selected": String(mode === "login"), onclick: () => { mode = "login"; draw(); } }, "Entrar"),
      h("button", { type: "button", role: "tab", class: mode === "register" ? "on" : "", "aria-selected": String(mode === "register"), onclick: () => { mode = "register"; draw(); } }, "Criar conta")),
    mode === "register" ? h("label", {}, "Nome", h("input", { name: "name", required: true, autocomplete: "name" })) : "",
    h("label", {}, "E-mail", h("input", { name: "email", type: "email", required: true, autocomplete: "email" })),
    h("label", {}, "Senha", h("input", { name: "password", type: "password", required: true, minlength: 8, autocomplete: mode === "login" ? "current-password" : "new-password" })),
    mode === "register" ? h("label", { class: "check consent" }, h("input", { type: "checkbox", name: "consent", required: true }),
      " Li e aceito a Política de Privacidade (LGPD). Posso exportar ou excluir meus dados a qualquer momento.") : "",
    h("button", { class: "btn primary big" }, mode === "login" ? "Entrar" : "Criar conta"),
    h("div", { class: "or" }, h("span", {}, "ou")),
    h("button", { type: "button", class: "btn big guest", onclick: guest }, "👤 Entrar como visitante (sem senha)"),
    h("p", { class: "hint" }, "Visitante: compõe, usa a IA e exporta sem cadastro. Para publicar na biblioteca e conversar na comunidade, crie uma conta."));
  async function guest() {
    try { const r = await api("/api/auth/guest", { method: "POST" }); setToken(r.token, r.user); close(); onDone(); }
    catch (e: any) { toast("Não foi possível entrar como visitante: " + e.message, "error"); }
  }
  form.onsubmit = async (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(form)) as any;
    try {
      const r = await api(mode === "login" ? "/api/auth/login" : "/api/auth/register", { method: "POST",
        json: mode === "login" ? { email: d.email, password: d.password } : { ...d, consent: !!d.consent, lang: localStorage.getItem("harmonia.lang") || "pt" } });
      setToken(r.token, r.user); close(); onDone();
    } catch (err: any) { toast(err.message, "error"); }
  };
  draw();
  shell(form, "Entrar no harmonIA");
}

// --------------------------------------------------------- passo a passo
export function showWizard(go: (id: string) => void) {
  let goal: Goal | null = null;
  const skip = () => {
    store.startFromScratch("Nova composição");
    markOnboarded(); close();
    toast(document.body.classList.contains("mobile") ? "Projeto vazio criado. Toque em ♫ Compor para editar." : "Projeto vazio criado. Abra o editor pelo ícone “Nova composição” ou ✎ Editar no pentagrama. O Maestro (🎼 ?) ajuda quando quiser.", "info", 7000);
  };
  const footer = (back?: () => void) => h("div", { class: "wiz-foot" },
    back ? h("button", { class: "btn ghost", onclick: back }, "‹ Voltar") : h("span"),
    h("button", { class: "btn ghost skip", onclick: skip }, "Pular e ir para a estação completa →"));
  const progress = (n: number) => h("div", { class: "wiz-steps", "aria-label": `Passo ${n} de 2` }, h("i", { class: n >= 1 ? "on" : "" }), h("i", { class: n >= 2 ? "on" : "" }), h("small", {}, `Passo ${n} de 2`));

  const card = (g: Goal, icon: string, title: string, sub: string) => h("button", { class: "wiz-card", onclick: () => { goal = g; step2(); } },
    h("span", { class: "wiz-ic", "aria-hidden": "true" }, icon), h("b", {}, title), h("small", {}, sub));

  function step1() {
    shell(h("div", { class: "wizard" }, progress(1),
      h("h2", {}, (currentUser?.guest || currentUser?.role === "guest") ? "Bem-vindo, visitante! Como você quer começar?" : `Olá${currentUser ? ", " + currentUser.name.split(" ")[0] : ""}! Como você quer começar?`),
      h("div", { class: "wiz-grid" },
        card("compose", "✎", "Compor livremente", "Escrever uma melodia e depois harmonizar"),
        card("image", "📷", "Enviar imagem da partitura", "Foto ou scan do tema que deseja editar"),
        card("record", "🎙", "Gravar o tema", "Cantar ou tocar agora e editar depois"),
        card("audio", "🎵", "Enviar arquivo de áudio", "MP3, WAV, M4A… para transcrever e editar")),
      footer()), "Passo a passo");
  }

  function step2() {
    if (goal === "compose") return step2Compose();
    const opt = (m: CaptureMode, icon: string, title: string, sub: string) => h("button", { class: "wiz-card", onclick: () => finish(m) },
      h("span", { class: "wiz-ic", "aria-hidden": "true" }, icon), h("b", {}, title), h("small", {}, sub));
    shell(h("div", { class: "wizard" }, progress(2),
      h("h2", {}, "O que capturar do material?"),
      h("div", { class: "wiz-grid two" },
        opt("melody", "〰", "Só a melodia", "Depois eu faço a harmonização (✨ Harmonizar) sobre o material"),
        opt("both", "🎹", "Melodia + harmonia", "Capturar a melodia junto com os acordes / acompanhamento")),
      footer(step1)), "Passo 2");
  }

  function step2Compose() {
    const key = h("select", { "aria-label": "Tonalidade" }, ...Object.entries(KEY_NAMES).sort((a, b) => +a[0] - +b[0])
      .map(([f, n]) => h("option", { value: f, selected: f === "0" }, `${n} maior / ${NAMES[(((+f * 7 + 9) % 12) + 12) % 12]}m`))) as HTMLSelectElement;
    const ts = h("select", { "aria-label": "Fórmula de compasso" }, ...["4/4", "3/4", "2/4", "6/8"].map((v) => h("option", { value: v }, v))) as HTMLSelectElement;
    const tempo = h("input", { type: "number", min: 40, max: 220, value: 96, "aria-label": "Andamento" }) as HTMLInputElement;
    const meas = h("select", { "aria-label": "Número de compassos" }, ...[8, 16, 32].map((n) => h("option", { value: n }, `${n} compassos`))) as HTMLSelectElement;
    shell(h("div", { class: "wizard" }, progress(2),
      h("h2", {}, "Como será a sua composição?"),
      h("div", { class: "grid2" }, h("label", {}, "Tonalidade", key), h("label", {}, "Compasso", ts), h("label", {}, "Andamento (♩)", tempo), h("label", {}, "Tamanho", meas)),
      h("button", { class: "btn primary big", onclick: () => {
        store.startFromScratch("Minha melodia", { keySig: +key.value, timeSig: ts.value.split("/").map(Number) as [number, number], tempo: +tempo.value || 96, measures: +meas.value });
        markOnboarded(); close(); go("compose");
        tour("compose");
      } }, "Começar a compor"),
      footer(step1)), "Passo 2");
  }

  function finish(m: CaptureMode) {
    setCaptureMode(m);
    store.startFromScratch(goal === "record" ? "Tema gravado" : "Tema importado");
    markOnboarded(); close();
    if (goal === "record") {
      go("compose");
      tour("record");
    } else {
      prefs.importTab = goal === "image" ? "image" : "audio";
      go("import");
      dispatchEvent(new CustomEvent("import:preset", { detail: { tab: prefs.importTab, mode: m } }));
      tour(prefs.importTab);
    }
  }
  step1();
}
