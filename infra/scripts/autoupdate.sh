#!/usr/bin/env bash
# =============================================================================
# harmonIA — atualização automática (modelo "pull", roda na VPS pelo systemd timer)
#
#  1. Consulta o GitHub (git ls-remote, sem limite de API) por um commit novo na branch.
#  2. Só aplica se o CI (GitHub Actions: testes + build) daquele commit passou.
#  3. Faz checkout, rebuild e restart (deploy.sh) e confere a saúde do app.
#  4. Se algo falhar: volta para a versão anterior (rollback) e marca o commit como ruim.
#
# Nada precisa ser guardado no GitHub (sem chave SSH da VPS em secrets): a VPS é quem busca.
# Configuração em /opt/harmonia/.env:
#   AUTOUPDATE=1  AUTOUPDATE_REPO=https://github.com/LACibermedicina/harmonia.git  AUTOUPDATE_BRANCH=main
#   AUTOUPDATE_REQUIRE_CI=1   (0 = não espera o CI)
# Uso manual: bash infra/scripts/autoupdate.sh [--force]
# =============================================================================
set -Eeuo pipefail
# O checkout git substitui este próprio arquivo; o bash lê scripts aos poucos, então
# executamos sempre uma CÓPIA temporária para não ler código pela metade durante a troca.
if [[ -z "${HARMONIA_AU_COPY:-}" ]]; then
  APP_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
  TMP_SELF="$(mktemp /tmp/harmonia-autoupdate.XXXXXX.sh)"; cp "$0" "$TMP_SELF"
  HARMONIA_AU_COPY="$TMP_SELF" APP_DIR="$APP_DIR" exec bash "$TMP_SELF" "$@"
fi
trap 'rm -f "$HARMONIA_AU_COPY"' EXIT
cd "$APP_DIR"
. infra/scripts/lib-ports.sh
STATUS_DIR="$APP_DIR/data/status"; mkdir -p "$STATUS_DIR"
LOG="$STATUS_DIR/autoupdate.log"
exec 9>"$STATUS_DIR/.lock"; flock -n 9 || { echo "já em execução"; exit 0; }

log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*" | tee -a "$LOG"; }
status() { # grava estado para o painel de Administração
  jq -n --arg state "$1" --arg msg "$2" --arg sha "${3:-}" --arg version "$(cat VERSION 2>/dev/null)" \
     --arg at "$(date -u +%FT%TZ)" '{state:$state,message:$msg,sha:$sha,version:$version,at:$at}' > "$STATUS_DIR/autoupdate.json"
}
tail -n 2000 "$LOG" > "$LOG.tmp" 2>/dev/null && mv "$LOG.tmp" "$LOG" || true

# ---------------------------------------- acervo de credenciais de IA (independe de haver versão nova)
# "Rodar diagnóstico" no painel grava data/ai/refresh.request → esta unidade recoleta na hora.
if [[ $EUID -eq 0 && ! -f /etc/systemd/system/harmonia-ia.path && -f infra/scripts/coletar-ia.sh ]]; then
  cat > /etc/systemd/system/harmonia-ia.service <<UNIT
[Unit]
Description=harmonIA — coleta credenciais de IA (.env do GitHub + outras apps)
[Service]
Type=oneshot
Environment=APP_DIR=$APP_DIR
ExecStart=/bin/bash $APP_DIR/infra/scripts/coletar-ia.sh --quiet
UNIT
  cat > /etc/systemd/system/harmonia-ia.path <<UNIT
[Unit]
Description=harmonIA — recoleta credenciais de IA quando o painel pede
[Path]
PathChanged=$APP_DIR/data/ai/refresh.request
[Install]
WantedBy=multi-user.target
UNIT
  mkdir -p data/ai; systemctl daemon-reload; systemctl enable --now harmonia-ia.path >/dev/null 2>&1 || true
  log "Instalada a coleta automática de credenciais de IA (harmonia-ia.path)"
fi
[[ $EUID -eq 0 && -f infra/scripts/coletar-ia.sh ]] && bash infra/scripts/coletar-ia.sh --quiet >/dev/null 2>&1 || true

[[ "$(env_get .env AUTOUPDATE)" == "0" ]] && { status disabled "Atualização automática desativada (AUTOUPDATE=0)"; exit 0; }
REPO="$(env_get .env AUTOUPDATE_REPO)"; BRANCH="$(env_get .env AUTOUPDATE_BRANCH)"; BRANCH="${BRANCH:-main}"
REQUIRE_CI="$(env_get .env AUTOUPDATE_REQUIRE_CI)"; REQUIRE_CI="${REQUIRE_CI:-1}"
[[ -n "$REPO" ]] || { status error "AUTOUPDATE_REPO não definido no .env"; exit 1; }
FORCE=0; [[ "${1:-}" == "--force" ]] && FORCE=1

# ------------------------------------------------ 1. transforma em checkout git
if [[ ! -d .git ]]; then
  log "Inicializando checkout git em $APP_DIR"
  git init -q -b "$BRANCH"
  git remote add origin "$REPO"
fi
git remote set-url origin "$REPO"
git config core.fileMode false

REMOTE_SHA="$(git ls-remote origin "refs/heads/$BRANCH" | cut -f1)"
[[ -n "$REMOTE_SHA" ]] || { status error "Branch $BRANCH não encontrada em $REPO"; log "ERRO: branch não encontrada"; exit 1; }
LOCAL_SHA="$(git rev-parse -q --verify HEAD 2>/dev/null || echo none)"
BAD_FILE="$STATUS_DIR/bad-commits"; touch "$BAD_FILE"

if grep -qx "$REMOTE_SHA" "$BAD_FILE" && [[ $FORCE -eq 0 ]]; then
  status blocked "Commit ${REMOTE_SHA:0:7} falhou antes e foi ignorado; aguardando um commit novo" "$LOCAL_SHA"; exit 0
fi
if [[ "$REMOTE_SHA" == "$LOCAL_SHA" && $FORCE -eq 0 ]]; then
  status ok "Atualizado — versão $(cat VERSION)" "$LOCAL_SHA"; exit 0
fi

# ----------------------------------------------------- 2. espera o CI passar
if [[ "$REQUIRE_CI" == "1" && $FORCE -eq 0 && "$REPO" == *github.com* ]]; then
  SLUG="$(sed -E 's#(git@github.com:|https://github.com/)##; s#\.git$##' <<<"$REPO")"
  CHECKS="$(curl -fsS -m 20 -H 'Accept: application/vnd.github+json' \
    "https://api.github.com/repos/${SLUG}/commits/${REMOTE_SHA}/check-runs" 2>/dev/null || echo '{}')"
  # considera só os checks de qualidade (job "test"); sync de credenciais/deploy não bloqueiam a atualização
  CI_NAMES="$(env_get .env AUTOUPDATE_CI_CHECKS)"; CI_NAMES="${CI_NAMES:-test}"
  CHECKS="$(jq --arg names "$CI_NAMES" '{check_runs: [.check_runs[]? | select(.name as $n | ($names | split(",") | index($n)))]}' <<<"$CHECKS")"
  TOTAL="$(jq -r '.check_runs | length' <<<"$CHECKS")"
  PENDING="$(jq -r '[.check_runs[]? | select(.status != "completed")] | length' <<<"$CHECKS")"
  FAILED="$(jq -r '[.check_runs[]? | select(.status == "completed" and (.conclusion | IN("success","skipped","neutral") | not))] | length' <<<"$CHECKS")"
  if [[ "$FAILED" -gt 0 ]]; then
    echo "$REMOTE_SHA" >> "$BAD_FILE"
    status blocked "CI falhou no commit ${REMOTE_SHA:0:7} — atualização não aplicada" "$LOCAL_SHA"; log "CI falhou em ${REMOTE_SHA:0:7}"; exit 0
  fi
  if [[ "$PENDING" -gt 0 ]]; then status waiting "Aguardando CI do commit ${REMOTE_SHA:0:7}" "$LOCAL_SHA"; exit 0; fi
  if [[ "$TOTAL" -eq 0 ]]; then
    # sem CI registrado: espera 20 min desde o commit e então segue
    git fetch -q origin "$BRANCH"
    AGE=$(( $(date +%s) - $(git show -s --format=%ct "$REMOTE_SHA") ))
    if [[ $AGE -lt 1200 ]]; then status waiting "Commit ${REMOTE_SHA:0:7} sem CI ainda; aguardando" "$LOCAL_SHA"; exit 0; fi
  fi
fi

# ----------------------------------------------------- 3. aplica e verifica
log "Atualizando ${LOCAL_SHA:0:7} → ${REMOTE_SHA:0:7}"
status updating "Aplicando ${REMOTE_SHA:0:7}" "$LOCAL_SHA"
git fetch -q origin "$BRANCH"
git checkout -q -f -B "$BRANCH" "$REMOTE_SHA"
git clean -q -fd   # remove arquivos antigos rastreáveis; .env e data/ (ignorados) são preservados

healthy() {
  local p; p="$(env_get .env HTTP_PORT)"
  for _ in $(seq 1 "${HEALTH_TRIES:-60}"); do
    [[ "$(curl -fsS -m 5 "http://127.0.0.1:${p}/api/health" 2>/dev/null | jq -r '.version // empty' 2>/dev/null)" == "$(cat VERSION)" ]] && return 0
    sleep 5
  done
  return 1
}

if bash infra/scripts/deploy.sh "$REMOTE_SHA" >> "$LOG" 2>&1 9>&- && healthy; then
  status ok "Atualizado para $(cat VERSION) (${REMOTE_SHA:0:7})" "$REMOTE_SHA"
  log "OK: versão $(cat VERSION)"
  docker image prune -f >/dev/null 2>&1 || true
  docker builder prune -f --filter until=72h >/dev/null 2>&1 || true
  exit 0
fi

# ------------------------------------------------------------- 4. rollback
log "FALHA ao aplicar ${REMOTE_SHA:0:7} — revertendo para ${LOCAL_SHA:0:7}"
echo "$REMOTE_SHA" >> "$BAD_FILE"
if [[ "$LOCAL_SHA" != "none" ]]; then
  git checkout -q -f -B "$BRANCH" "$LOCAL_SHA"; git clean -q -fd
  bash infra/scripts/deploy.sh "$LOCAL_SHA" >> "$LOG" 2>&1 9>&- || true
fi
status rolled_back "Falha ao aplicar ${REMOTE_SHA:0:7}; versão anterior restaurada" "$LOCAL_SHA"
exit 1
