#!/usr/bin/env bash
# Executado no GitHub Actions: junta as credenciais de IA dos secrets (SERVIDOR_ENV em formato .env
# e/ou secrets individuais) e envia à VPS por SSH. Nunca falha o CI e nunca imprime valores.
set -uo pipefail
KEYS="ANTHROPIC_API_KEY CLAUDE_API_KEY OPENAI_API_KEY GROQ_API_KEY GEMINI_API_KEY GOOGLE_API_KEY GITHUB_MODELS_TOKEN CEREBRAS_API_KEY MISTRAL_API_KEY OPENROUTER_API_KEY DEEPSEEK_API_KEY XAI_API_KEY TOGETHER_API_KEY HF_TOKEN POLLINATIONS_API_KEY GEMINI_MODEL GEMINI_FALLBACK_MODELS POLLINATIONS_MODEL AI_POLLINATIONS_ANON AI_PROVIDERS MYMEMORY_EMAIL"
payload="$(mktemp)"; chmod 600 "$payload"
printf '%s\n' "${SERVIDOR_ENV:-}" > "$payload"
for k in $KEYS; do v="${!k:-}"; [[ -n "$v" ]] && printf '%s=%s\n' "$k" "$v" >> "$payload"; done
n=$(grep -cE '^[[:space:]]*(export[[:space:]]+)?[A-Za-z_][A-Za-z0-9_]*=.+' "$payload" || true)
if [[ "$n" -eq 0 ]]; then echo "::notice::Nenhuma credencial de IA nos secrets (SERVIDOR_ENV ou individuais) — nada a sincronizar."; exit 0; fi
if [[ -z "${VPS_SSH_KEY:-}" || -z "${VPS_HOST:-}" ]]; then
  echo "::warning::Credenciais encontradas, mas faltam os secrets VPS_HOST/VPS_SSH_KEY para enviá-las à VPS."; exit 0
fi
install -m 700 -d ~/.ssh
printf '%s\n' "$VPS_SSH_KEY" > ~/.ssh/k && chmod 600 ~/.ssh/k
ssh-keyscan -H "$VPS_HOST" >> ~/.ssh/known_hosts 2>/dev/null
SSH="ssh -i $HOME/.ssh/k -o BatchMode=yes -o ConnectTimeout=20 ${VPS_USER:-deploy}@${VPS_HOST}"
if ! $SSH "test -f /opt/harmonia/infra/scripts/merge-env.sh"; then
  echo "::warning::A VPS ainda não tem merge-env.sh (a atualização automática aplica em até 5 min). Rode este workflow de novo depois."; exit 0
fi
if $SSH "bash /opt/harmonia/infra/scripts/merge-env.sh" < "$payload"; then
  echo "::notice::Credenciais de IA sincronizadas com a VPS."
else
  echo "::warning::Falha ao sincronizar credenciais com a VPS (veja o log acima)."
fi
rm -f "$payload" ~/.ssh/k
exit 0
