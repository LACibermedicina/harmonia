#!/usr/bin/env bash
# harmonIA — utilitários de portas.
# Regra do projeto: NUNCA usar porta < 1024 nem porta já ocupada no host.
# As portas escolhidas são gravadas no .env e reaproveitadas nos próximos deploys.

PORT_MIN="${PORT_MIN:-20000}"
PORT_MAX="${PORT_MAX:-29999}"

# Lista todas as portas em uso no host (TCP/UDP em escuta + publicadas pelo Docker)
ports_in_use() {
  {
    if command -v ss >/dev/null 2>&1; then
      ss -Htanlu 2>/dev/null | awk '{print $5}' | sed -E 's/.*[:.]([0-9]+)$/\1/'
    else  # fallback sem iproute2: lê o kernel direto (TCP em LISTEN + UDP ligados)
      { for f in /proc/net/tcp /proc/net/tcp6; do [[ -r $f ]] && awk 'NR>1 && $4=="0A" {split($2,a,":"); print a[2]}' "$f"; done
        for f in /proc/net/udp /proc/net/udp6; do [[ -r $f ]] && awk 'NR>1 {split($2,a,":"); print a[2]}' "$f"; done
      } | while read -r hx; do echo $((16#$hx)); done
    fi
    if command -v docker >/dev/null 2>&1; then
      docker ps --format '{{.Ports}}' 2>/dev/null | grep -oE ':[0-9]+->' | tr -d ':->'
    fi
  } | grep -E '^[0-9]+$' | sort -un
}

port_is_free() {
  local p="$1"
  [[ "$p" -ge 1024 ]] || return 1
  ! ports_in_use | grep -qx "$p"
}

# Primeira porta livre a partir de $1 (ou PORT_MIN), pulando as listadas em $2..
find_free_port() {
  local p="${1:-$PORT_MIN}"; shift || true
  local skip=" $* "
  while [[ "$p" -le "$PORT_MAX" ]]; do
    if [[ "$skip" != *" $p "* ]] && port_is_free "$p"; then echo "$p"; return 0; fi
    p=$((p + 1))
  done
  return 1
}

# Faixa contínua de N portas livres (para relay UDP do TURN)
find_free_range() {
  local n="$1" start="${2:-$PORT_MIN}"; shift 2 || true
  local skip=" $* " used; used="$(ports_in_use)"
  local s="$start"
  while [[ $((s + n - 1)) -le "$PORT_MAX" ]]; do
    local ok=1 q
    for ((q = s; q < s + n; q++)); do
      if [[ "$skip" == *" $q "* ]] || grep -qx "$q" <<<"$used"; then ok=0; s=$((q + 1)); break; fi
    done
    if [[ $ok -eq 1 ]]; then echo "$s $((s + n - 1))"; return 0; fi
  done
  return 1
}

# Lê variável do .env (vazio se não existir)
env_get() { [[ -f "$1" ]] && grep -E "^$2=" "$1" | tail -1 | cut -d= -f2- || true; }

# Grava/atualiza variável no .env (seguro para qualquer caractere no valor; preserva dono/permissão)
env_set() {
  local file="$1" key="$2" val="$3" tmp
  [[ -f "$file" ]] || : > "$file"
  tmp="$(mktemp)"
  K="$key" V="$val" awk 'BEGIN { done = 0 }
    index($0, ENVIRON["K"] "=") == 1 { if (!done) print ENVIRON["K"] "=" ENVIRON["V"]; done = 1; next }
    { print }
    END { if (!done) print ENVIRON["K"] "=" ENVIRON["V"] }' "$file" > "$tmp"
  cat "$tmp" > "$file"; rm -f "$tmp"
}

# Portas publicadas pelos containers do próprio harmonIA (válidas num redeploy)
own_ports() {
  command -v docker >/dev/null 2>&1 || return 0
  docker ps --filter label=com.docker.compose.project=harmonia --format '{{.Ports}}' 2>/dev/null \
    | grep -oE ':[0-9]+->' | tr -d ':->' | sort -un
  # coturn usa network_mode host: suas portas aparecem só no ss
  if docker ps --filter name=harmonia-coturn --format '{{.Names}}' 2>/dev/null | grep -q coturn; then
    local f="${ENV_FILE:-.env}"
    env_get "$f" TURN_PORT
    local a b; a="$(env_get "$f" TURN_MIN_PORT)"; b="$(env_get "$f" TURN_MAX_PORT)"
    [[ -n "$a" && -n "$b" ]] && seq "$a" "$b"
  fi
}

# A porta pertence ao próprio harmonIA se o /api/health dela responde como "harmonia"
# (prova definitiva, independente de permissão no Docker).
is_harmonia_http() {
  curl -fsS -m 3 "http://127.0.0.1:$1/api/health" 2>/dev/null | grep -q '"project":"harmonia"'
}

# Garante HTTP_PORT, TURN_PORT e faixa de relay no .env: reaproveita se continuar livre
# (ou se for do próprio harmonIA); senão escolhe nova porta livre >= 20000.
ensure_ports() {
  local f="$1"; ENV_FILE="$f"
  local mine; mine=" $(own_ports | tr '\n' ' ') "
  ok_port() { [[ -n "$1" && "$1" -ge 1024 ]] && { [[ "$mine" == *" $1 "* ]] || port_is_free "$1" || is_harmonia_http "$1"; }; }

  local http; http="$(env_get "$f" HTTP_PORT)"
  ok_port "$http" || http="$(find_free_port 20080)" || { echo "Sem porta livre para HTTP"; return 1; }
  env_set "$f" HTTP_PORT "$http"

  local turn; turn="$(env_get "$f" TURN_PORT)"
  ok_port "$turn" || turn="$(find_free_port 23478 "$http")" || { echo "Sem porta livre para TURN"; return 1; }
  env_set "$f" TURN_PORT "$turn"

  local a b okr=1 q; a="$(env_get "$f" TURN_MIN_PORT)"; b="$(env_get "$f" TURN_MAX_PORT)"
  if [[ -n "$a" && -n "$b" ]]; then for ((q = a; q <= b; q++)); do ok_port "$q" || { okr=0; break; }; done; else okr=0; fi
  if [[ $okr -eq 0 ]]; then read -r a b < <(find_free_range 41 24000 "$http" "$turn") || { echo "Sem faixa livre para TURN"; return 1; }; fi
  env_set "$f" TURN_MIN_PORT "$a"; env_set "$f" TURN_MAX_PORT "$b"
  echo "[ports] HTTP=127.0.0.1:$http  TURN=$turn (tcp/udp)  relay=$a-$b/udp"
}
