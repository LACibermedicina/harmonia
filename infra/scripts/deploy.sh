#!/usr/bin/env bash
# Executado na VPS pelo GitHub Actions (usuário deploy). Idempotente.
# Garante a regra de portas: nada < 1024, nada ocupado por outro serviço.
set -euo pipefail
cd "$(dirname "$0")/../.."
. infra/scripts/lib-ports.sh
SHA="${1:-manual}"
echo "[deploy] versão $(cat VERSION) commit ${SHA}"
[[ -f .env ]] || { echo ".env ausente — rode: sudo bash infra/scripts/setup-vps.sh <email>"; exit 1; }

# Confere se as portas gravadas continuam válidas (livres ou do próprio harmonIA).
CHK="$(mktemp)"; cp .env "$CHK"
ensure_ports "$CHK" >/dev/null || true
HP="$(env_get .env HTTP_PORT)"
if [[ -z "$HP" ]] || { [[ "$HP" != "$(env_get "$CHK" HTTP_PORT)" ]] && ! is_harmonia_http "$HP"; }; then
  echo "[deploy] ERRO: HTTP_PORT=${HP:-vazia} está ocupada por outro serviço (não responde como harmonIA)."
  echo "         Rode 'sudo bash infra/scripts/setup-vps.sh <email>' para escolher outra porta. Nada foi alterado."
  rm -f "$CHK"; exit 1
fi
for k in TURN_PORT TURN_MIN_PORT TURN_MAX_PORT; do
  [[ "$(env_get .env "$k")" == "$(env_get "$CHK" "$k")" ]] || echo "[deploy] aviso: $k=$(env_get .env "$k") pode estar em uso; videochamada pode precisar do setup (o app segue normal)."
done
rm -f "$CHK"
echo "[deploy] portas: HTTP 127.0.0.1:$(env_get .env HTTP_PORT) · TURN $(env_get .env TURN_PORT) · relay $(env_get .env TURN_MIN_PORT)-$(env_get .env TURN_MAX_PORT)"

export GIT_SHA="$SHA"
docker compose build --pull
# pastas de dados graváveis pelos containers (usuário 10001 "api"/"worker"): sem isso o envio de
# áudio/imagem falha com "Internal Server Error" (sem permissão para gravar em data/media)
mkdir -p data/media data/models data/ai
docker compose run --rm --no-deps -u 0 --entrypoint sh api -c 'chown -R 10001:10001 /data/media && chmod -R u+rwX /data/media' >/dev/null 2>&1 \
  || { [[ $EUID -eq 0 ]] && chown -R 10001:10001 data/media data/models; } || echo "AVISO: não consegui ajustar a permissão de data/media"
[[ $EUID -eq 0 ]] && chown -R 10001:10001 data/models 2>/dev/null || true
# acervo de credenciais de IA (lido pela API): .env do GitHub (prioridade) + outras apps desta VPS
if [[ $EUID -eq 0 ]]; then chown root:10001 data/ai; chmod 2770 data/ai; bash infra/scripts/coletar-ia.sh --quiet || true; fi
docker compose up -d --remove-orphans
for _ in $(seq 1 30); do docker compose exec -T api python -m app.migrate && break; sleep 3; done
docker image prune -f >/dev/null
docker compose ps
