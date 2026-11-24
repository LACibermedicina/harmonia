#!/usr/bin/env bash
# =============================================================================
# harmonIA — grava as chaves dos provedores de IA no .env da VPS (failover).
# As chaves são digitadas OCULTAS (não aparecem na tela nem no histórico do shell)
# e ficam só em /opt/harmonia/.env (chmod 600). Enter em branco = mantém a atual.
# Uso (na VPS, root):  sudo bash /opt/harmonia/infra/scripts/configurar-ia.sh
# =============================================================================
set -euo pipefail
APP_DIR="${APP_DIR:-/opt/harmonia}"
ENV="$APP_DIR/.env"
. "$APP_DIR/infra/scripts/lib-ports.sh"
[[ $EUID -eq 0 ]] || { echo "Execute com sudo."; exit 1; }
[[ -f "$ENV" ]] || { echo "Não achei $ENV — rode o setup primeiro."; exit 1; }
cp -a "$ENV" "$ENV.bak.$(date +%Y%m%d%H%M%S)"

mask() { local v="$1"; [[ -z "$v" ]] && echo "(vazia)" || echo "${v:0:6}…${v: -4}"; }
ask_key() { # nome_var  rótulo  onde_obter
  local var="$1" label="$2" url="$3" cur new
  cur="$(env_get "$ENV" "$var")"
  printf '\n\033[1m%s\033[0m  atual: %s\n  (obter em %s)\n' "$label" "$(mask "$cur")" "$url"
  read -rsp "  Nova chave (Enter = manter, '-' = remover): " new </dev/tty; echo
  if [[ "$new" == "-" ]]; then env_set "$ENV" "$var" ""; echo "  removida"
  elif [[ -n "$new" ]]; then env_set "$ENV" "$var" "$new"; echo "  ✓ gravada $(mask "$new")"; fi
}

echo "=== Provedores de IA do harmonIA (failover: se um falhar, usa o próximo) ==="
echo "Sem nenhuma chave o app continua respondendo: tradução gratuita (MyMemory) e Maestro offline."
echo "Pagos (opcionais):"
ask_key ANTHROPIC_API_KEY   "Anthropic (Claude)"                 "https://console.anthropic.com/settings/keys"
ask_key OPENAI_API_KEY      "OpenAI"                             "https://platform.openai.com/api-keys"
echo; echo "GRATUITOS (free tier, sem cartão) — recomendável ter 2 ou mais:"
ask_key GROQ_API_KEY        "Groq — Llama 3.3 70B, muito rápido" "https://console.groq.com/keys"
ask_key GEMINI_API_KEY      "Google Gemini 2.5 Flash"            "https://aistudio.google.com/apikey"
ask_key GITHUB_MODELS_TOKEN "GitHub Models (PAT com models:read)" "https://github.com/settings/personal-access-tokens/new"
ask_key CEREBRAS_API_KEY    "Cerebras"                           "https://cloud.cerebras.ai"
ask_key MISTRAL_API_KEY     "Mistral (plano Experiment)"         "https://console.mistral.ai/api-keys"
ask_key OPENROUTER_API_KEY  "OpenRouter (modelos :free)"          "https://openrouter.ai/keys"

cur_order="$(env_get "$ENV" AI_PROVIDERS)"; cur_order="${cur_order:-anthropic,openai,groq,gemini,github,cerebras,mistral,openrouter}"
printf '\nOrdem de failover atual: %s\n' "$cur_order"
read -rp "Nova ordem (Enter = manter): " order </dev/tty
[[ -n "$order" ]] && cur_order="$order"
env_set "$ENV" AI_PROVIDERS "$cur_order"
chmod 600 "$ENV"; chown deploy:deploy "$ENV" 2>/dev/null || true

echo; echo "Aplicando (reinicia só a API, ~10 s)…"
cd "$APP_DIR" && docker compose up -d --force-recreate --no-deps api >/dev/null
P="$(env_get "$ENV" HTTP_PORT)"
for _ in $(seq 1 30); do curl -fsS "http://127.0.0.1:$P/api/health" >/dev/null 2>&1 && break; sleep 2; done
configured=$(for v in ANTHROPIC_API_KEY OPENAI_API_KEY GROQ_API_KEY GEMINI_API_KEY GITHUB_MODELS_TOKEN CEREBRAS_API_KEY MISTRAL_API_KEY OPENROUTER_API_KEY; do [[ -n "$(env_get "$ENV" "$v")" ]] && echo "${v%%_API_KEY}"; done | tr '\n' ' ')
echo "✅ Pronto. Provedores com chave: ${configured:-nenhum}"
echo "   Teste em: Administração → 🤖 IA → Testar (mostra qual provedor respondeu)."
ls -1t "$ENV".bak.* 2>/dev/null | tail -n +4 | xargs -r rm -f   # mantém só os 3 backups mais recentes
