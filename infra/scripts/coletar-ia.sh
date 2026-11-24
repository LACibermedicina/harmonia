#!/usr/bin/env bash
# =============================================================================
# harmonIA — monta o "acervo" de credenciais de IA lido pela API (pasta data/ai, só root e a API leem).
#
#   data/ai/env.ai   ← chaves de IA do .env do harmonIA (vindas do GitHub: SERVIDOR_ENV / secrets) — PRIORIDADE 1
#   data/ai/apps.ai  ← chaves de IA encontradas em OUTRAS apps desta VPS (ex.: Prática, Gusto) — reserva (prioridade 2)
#   (o painel de Administração é a prioridade 3: só entra se as anteriores faltarem ou falharem no teste)
#
# Procura em arquivos .env* de /opt, /srv, /var/www, /home e /root (até 4 níveis) e nas variáveis de ambiente
# dos containers Docker que não são do harmonIA. Copia SÓ nomes de chaves de IA conhecidos — nunca senhas de
# banco, JWT etc. — e NUNCA imprime valores (só os 4 últimos caracteres).
#
# Roda sozinho: a cada ciclo da atualização automática e quando o painel pede "Rodar diagnóstico".
# Uso manual (root):  bash infra/scripts/coletar-ia.sh          # mostra o resumo
#                     bash infra/scripts/coletar-ia.sh --quiet  # sem saída (systemd)
# =============================================================================
set -euo pipefail
APP_DIR="${APP_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
QUIET=0; [[ "${1:-}" == "--quiet" ]] && QUIET=1
[[ $EUID -eq 0 ]] || { echo "Rode como root (precisa ler as outras apps): sudo bash $0"; exit 1; }
AI_DIR="$APP_DIR/data/ai"
API_UID=10001   # usuário "api" do container (backend/Dockerfile)
mkdir -p "$AI_DIR"
chown root:"$API_UID" "$AI_DIR"; chmod 2770 "$AI_DIR"

QUIET=$QUIET APP_DIR="$APP_DIR" AI_DIR="$AI_DIR" API_UID="$API_UID" python3 -I - <<'PY'
import os, re, subprocess, json, hashlib, sys
APP, OUT, UID, QUIET = os.environ["APP_DIR"], os.environ["AI_DIR"], int(os.environ["API_UID"]), os.environ["QUIET"] == "1"
# nome encontrado → nome canônico usado pelo harmonIA
ALIAS = {
  "ANTHROPIC_API_KEY": "ANTHROPIC_API_KEY", "CLAUDE_API_KEY": "ANTHROPIC_API_KEY", "ANTHROPIC_KEY": "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY": "OPENAI_API_KEY", "OPENAI_KEY": "OPENAI_API_KEY", "OPENAI_SECRET_KEY": "OPENAI_API_KEY",
  "GROQ_API_KEY": "GROQ_API_KEY",
  "GEMINI_API_KEY": "GEMINI_API_KEY", "GOOGLE_API_KEY": "GEMINI_API_KEY", "GOOGLE_AI_API_KEY": "GEMINI_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY": "GEMINI_API_KEY", "GOOGLE_GEMINI_API_KEY": "GEMINI_API_KEY",
  "GITHUB_MODELS_TOKEN": "GITHUB_MODELS_TOKEN", "GH_MODELS_TOKEN": "GITHUB_MODELS_TOKEN",
  "CEREBRAS_API_KEY": "CEREBRAS_API_KEY", "MISTRAL_API_KEY": "MISTRAL_API_KEY", "OPENROUTER_API_KEY": "OPENROUTER_API_KEY",
  "DEEPSEEK_API_KEY": "DEEPSEEK_API_KEY", "XAI_API_KEY": "XAI_API_KEY", "GROK_API_KEY": "XAI_API_KEY",
  "TOGETHER_API_KEY": "TOGETHER_API_KEY", "HF_TOKEN": "HF_TOKEN", "HUGGINGFACE_API_KEY": "HF_TOKEN",
  "POLLINATIONS_API_KEY": "POLLINATIONS_API_KEY", "POLLINATIONS_TOKEN": "POLLINATIONS_API_KEY",
}
EXTRA = re.compile(r"^(AI_MODEL|OPENAI_MODEL|GROQ_MODEL|GEMINI_MODEL|GITHUB_MODELS_MODEL|CEREBRAS_MODEL|MISTRAL_MODEL|OPENROUTER_MODEL|DEEPSEEK_MODEL|XAI_MODEL|TOGETHER_MODEL|HF_MODEL|POLLINATIONS_MODEL|GEMINI_FALLBACK_MODELS|POLLINATIONS_FALLBACK_MODELS|AI_POLLINATIONS_ANON|AI_PROVIDERS|AI_COOLDOWN_S|AI_TIMEOUT_S|MYMEMORY_EMAIL)$")
LINE = re.compile(r"^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$")
FAKE = re.compile(r"(x{4,}|your|seu_|sua_|change|example|exemplo|placeholder|<|\$\{|\*\*\*)", re.I)

def parse(text):
    for raw in text.splitlines():
        m = LINE.match(raw)
        if not m: continue
        k, v = m.group(1), m.group(2).strip()
        if v[:1] in "\"'" and v[-1:] == v[:1]: v = v[1:-1]
        elif " #" in v: v = v.split(" #", 1)[0].strip()
        yield k, v

def usable(v): return len(v) >= 16 and not FAKE.search(v) and " " not in v
hint = lambda v: "••••" + v[-4:]

# 1) .env do harmonIA (sincronizado do GitHub) → env.ai
env_lines, env_vals = [], {}
try:
    for k, v in parse(open(os.path.join(APP, ".env"), encoding="utf-8", errors="ignore").read()):
        c = ALIAS.get(k)
        if c and usable(v) and c not in env_vals: env_vals[c] = v; env_lines.append(f"{c}={v}")
        elif EXTRA.match(k) and v: env_lines.append(f"{k}={v}")
except FileNotFoundError:
    pass

# 2) outras apps
GENERIC = {"backend", "api", "app", "src", "server", "web", "frontend", "config", "docker", "deploy", "current", "releases", "shared", "www", "html", "public_html", "htdocs"}
def app_name(path):
    parts = [p for p in os.path.dirname(path).split("/") if p]
    for p in reversed(parts):
        if p.lower() not in GENERIC and not p.startswith("."): return re.sub(r"[^a-z0-9_-]", "", p.lower())[:24] or "app"
    return "app"
found = {}   # (canon, value) -> set(apps)
def add(c, v, app):
    if not usable(v) or env_vals.get(c) == v: return
    found.setdefault((c, v), set()).add(app)
SKIP = {"node_modules", ".git", "venv", ".venv", "__pycache__", "vendor", "dist", "build", ".cache", "proc", "snap"}
roots = ["/opt", "/srv", "/var/www", "/home", "/root"]
harm = os.path.realpath(APP)
for root in roots:
    if not os.path.isdir(root): continue
    base_depth = root.rstrip("/").count("/")
    for d, dirs, files in os.walk(root):
        if os.path.realpath(d).startswith(harm): dirs[:] = []; continue
        dirs[:] = [x for x in dirs if x not in SKIP] if d.count("/") - base_depth < 4 else []
        for f in files:
            if not (f == ".env" or f.startswith(".env.") or f.endswith(".env")) or f.endswith((".example", ".sample", ".dist", ".template")): continue
            p = os.path.join(d, f)
            try:
                if os.path.getsize(p) > 200_000: continue
                for k, v in parse(open(p, encoding="utf-8", errors="ignore").read()):
                    if k in ALIAS: add(ALIAS[k], v, app_name(p))
            except OSError:
                pass
# containers Docker de outras apps
try:
    names = subprocess.run(["docker", "ps", "--format", "{{.Names}}"], capture_output=True, text=True, timeout=20).stdout.split()
    for n in names:
        if n.startswith("harmonia"): continue
        envs = subprocess.run(["docker", "inspect", "-f", "{{range .Config.Env}}{{println .}}{{end}}", n], capture_output=True, text=True, timeout=20).stdout
        app = re.sub(r"[-_](app|api|web|backend|server|worker|frontend)?[-_]?\d*$", "", n.lower())[:24] or n[:24]
        for k, v in parse(envs):
            if k in ALIAS: add(ALIAS[k], v, app)
except Exception:
    pass

apps_lines = []
for (c, v), apps in sorted(found.items(), key=lambda x: (x[0][0], sorted(x[1]))):
    apps_lines.append(f"{c}@{'+'.join(sorted(apps))}={v}")

def write(name, lines):
    p = os.path.join(OUT, name); tmp = p + ".tmp"
    with open(tmp, "w") as fh: fh.write("# gerado por coletar-ia.sh — não edite\n" + "\n".join(lines) + "\n")
    os.chown(tmp, 0, UID); os.chmod(tmp, 0o640); os.replace(tmp, p)
write("env.ai", env_lines)
write("apps.ai", apps_lines)

if not QUIET:
    print("== Credenciais de IA do .env do harmonIA (GitHub) — prioridade 1")
    for c, v in env_vals.items(): print(f"   {c:22} {hint(v)}")
    if not env_vals: print("   (nenhuma)")
    print("== Encontradas em outras apps desta VPS — reserva (prioridade 2)")
    for (c, v), apps in sorted(found.items()): print(f"   {c:22} {hint(v)}   ← {', '.join(sorted(apps))}")
    if not found: print("   (nenhuma além das do .env)")
    print("Pronto. Abra Administração → 🤖 IA → Rodar diagnóstico para testar todas.")
PY
# a API relê os arquivos sozinha (pela data de modificação); não precisa reiniciar
