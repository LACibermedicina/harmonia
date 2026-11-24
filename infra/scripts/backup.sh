#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
set -a; . ./.env; set +a
STAMP=$(date +%Y%m%d-%H%M)
docker compose exec -T db pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" | gzip > "data/backups/db-${STAMP}.sql.gz"
find data/backups -name 'db-*.sql.gz' -mtime +14 -delete
