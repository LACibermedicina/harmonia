#!/usr/bin/env bash
# =============================================================================
# harmonIA — recebe credenciais de IA (stdin, linhas CHAVE=valor) e mescla no .env da VPS.
# Chamado pelo GitHub Actions (job sync-ai-env) via SSH como usuário deploy.
#  • Só chaves da LISTA PERMITIDA (IA/modelos). Senhas do banco, JWT e chave de criptografia
#    NUNCA são alteradas por aqui — evita quebrar o banco ou perder dados criptografados.
#  • Valor vazio não apaga a chave existente na VPS (as credenciais já registradas continuam).
#  • Não imprime valores; reinicia só a API e somente se algo mudou.
# =============================================================================
set -euo pipefail
APP_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$APP_DIR"
. infra/scripts/lib-ports.sh
ENV=".env"
[[ -f "$ENV" ]] || { echo "::warning::.env não encontrado em $APP_DIR"; exit 0; }

declare -A ALIAS=( [CLAUDE_API_KEY]=ANTHROPIC_API_KEY [GOOGLE_API_KEY]=GEMINI_API_KEY [GOOGLE_AI_API_KEY]=GEMINI_API_KEY
                   [GH_MODELS_TOKEN]=GITHUB_MODELS_TOKEN [POLLINATIONS_TOKEN]=POLLINATIONS_API_KEY )
ALLOW='^(ANTHROPIC_API_KEY|OPENAI_API_KEY|GROQ_API_KEY|GEMINI_API_KEY|GITHUB_MODELS_TOKEN|CEREBRAS_API_KEY|MISTRAL_API_KEY|OPENROUTER_API_KEY|DEEPSEEK_API_KEY|XAI_API_KEY|TOGETHER_API_KEY|HF_TOKEN|POLLINATIONS_API_KEY|POLLINATIONS_MODEL|GEMINI_FALLBACK_MODELS|POLLINATIONS_FALLBACK_MODELS|AI_POLLINATIONS_ANON|DEEPSEEK_MODEL|XAI_MODEL|TOGETHER_MODEL|HF_MODEL|AI_MODEL|OPENAI_MODEL|GROQ_MODEL|GEMINI_MODEL|GITHUB_MODELS_MODEL|CEREBRAS_MODEL|MISTRAL_MODEL|OPENROUTER_MODEL|AI_PROVIDERS|AI_COOLDOWN_S|AI_TIMEOUT_S|MYMEMORY_EMAIL)$'

changed=0; applied=(); ignored=()
while IFS= read -r line || [[ -n "$line" ]]; do
  line="${line%$'\r'}"
  [[ "$line" =~ ^[[:space:]]*(export[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]] || continue
  k="${BASH_REMATCH[2]}"; v="${BASH_REMATCH[3]}"
  v="${v#\"}"; v="${v%\"}"; v="${v#\'}"; v="${v%\'}"
  k="${ALIAS[$k]:-$k}"
  if [[ ! "$k" =~ $ALLOW ]]; then ignored+=("$k"); continue; fi
  [[ -z "$v" ]] && continue
  if [[ "$(env_get "$ENV" "$k")" != "$v" ]]; then env_set "$ENV" "$k" "$v"; changed=1; applied+=("$k"); fi
done
chmod 600 "$ENV"

[[ ${#ignored[@]} -gt 0 ]] && echo "Ignoradas (fora da lista de IA, não alteradas): $(printf '%s ' "${ignored[@]}" | tr ' ' '\n' | sort -u | tr '\n' ' ')"
if [[ $changed -eq 1 ]]; then
  echo "Atualizadas no .env da VPS: ${applied[*]}"
  docker compose up -d --force-recreate --no-deps api >/dev/null 2>&1 && echo "API reiniciada com as novas credenciais."
  # pede a recoleta do acervo (data/ai/env.ai) — o serviço harmonia-ia (root) roda na hora
  sleep 3; docker compose exec -T api sh -c 'date +%s > /data/ai/refresh.request' >/dev/null 2>&1 || true
else
  echo "Nenhuma mudança: as credenciais de IA da VPS já estavam em dia."
fi
