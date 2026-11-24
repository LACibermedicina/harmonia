#!/usr/bin/env bash
# =============================================================================
# harmonIA — instalação/atualização na VPS (Ubuntu 22.04/24.04, Debian 12)
# Seguro para servidor COMPARTILHADO (Odoo, outros sites):
#   • nenhuma porta < 1024 e nenhuma porta já em uso é aberta pelo harmonIA;
#   • o HTTPS fica com o nginx/apache que já existe (vhost novo + certbot);
#   • se o vhost novo quebrar o nginx, ele é removido na hora (rollback);
#   • o firewall NÃO é ativado/alterado se estiver desligado;
#   • modo de IA "leve" automático em máquinas pequenas (sem PyTorch).
#
# Uso (root):  bash infra/scripts/setup-vps.sh <email-letsencrypt> [arquivo-chave-publica-deploy]
# Variáveis opcionais: AI_ML=1 (força IA completa) · HARDEN_SSH=1 · SKIP_BUILD=1
# =============================================================================
set -Eeuo pipefail
trap 'echo -e "\n\033[1;31m[harmonIA] ERRO na linha $LINENO: $BASH_COMMAND\033[0m\nNada foi alterado nos outros serviços. Copie esta mensagem e envie para análise." >&2' ERR

PROJETO_NOME="harmonia"
SUBDOMINIO="harmonia.m3d.pro"
APP_DIR="/opt/${PROJETO_NOME}"
DEPLOY_USER="deploy"
LE_EMAIL="${1:-}"
DEPLOY_PUBKEY_FILE="${2:-}"
SRC_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=lib-ports.sh
. "$SRC_DIR/infra/scripts/lib-ports.sh"

log()  { printf '\033[1;35m[harmonIA]\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m  ✓\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m  !\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m  ✗ %s\033[0m\n' "$*" >&2; exit 1; }
[[ $EUID -eq 0 ]] || die "Execute como root (sudo)."
[[ "$LE_EMAIL" == *@*.* ]] || die "Informe um e-mail válido: setup-vps.sh voce@dominio"

# ----------------------------------------------------------------- 1. checagens
log "1/9 Checando o servidor"
FREE_GB=$(df -BG --output=avail / | tail -1 | tr -dc '0-9')
MEM_MB=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
SWAP_MB=$(awk '/SwapTotal/ {print int($2/1024)}' /proc/meminfo)
ok "Disco livre: ${FREE_GB} GB · RAM: ${MEM_MB} MB · Swap: ${SWAP_MB} MB"
[[ "$FREE_GB" -ge 4 ]] || die "Menos de 4 GB livres em /. Libere espaço (ex.: 'docker system prune', logs antigos) e rode de novo."
if [[ "$SWAP_MB" -lt 1024 && "$FREE_GB" -ge 8 ]]; then
  if [[ ! -f /swapfile ]]; then fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null; fi
  swapon /swapfile 2>/dev/null || true
  grep -q '^/swapfile ' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  ok "Swap ativado"
fi
if [[ -z "${AI_ML:-}" ]]; then
  if [[ "$MEM_MB" -ge 7500 && "$FREE_GB" -ge 20 ]]; then AI_ML=1; else AI_ML=0; fi
fi
[[ "$AI_ML" == "1" ]] && ok "IA completa (Demucs, Basic Pitch, Whisper, OMR)" \
  || warn "Modo de IA LEVE: editor, cifra, harmonização e exportação MIDI/MusicXML/PDF/WAV/MP3 funcionam; transcrição de áudio/foto fica desativada (requer ≥ 8 GB RAM e 20 GB livres)."

# ---------------------------------------------------------------- 2. pacotes
log "2/9 Pacotes"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y >/dev/null 2>&1 || warn "apt-get update teve avisos (repositórios de terceiros) — seguindo."
apt-get install -y ca-certificates curl gnupg rsync jq iproute2 openssl unzip dnsutils git >/dev/null
ok "ok"

# ------------------------------------------------------------ 3. docker/compose
log "3/9 Docker e Compose"
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh >/dev/null
fi
systemctl enable --now docker >/dev/null 2>&1 || true
if ! docker compose version >/dev/null 2>&1; then
  apt-get install -y docker-compose-plugin >/dev/null 2>&1 || {
    mkdir -p /usr/local/lib/docker/cli-plugins
    curl -fsSL "https://github.com/docker/compose/releases/download/v2.29.7/docker-compose-linux-$(uname -m)" \
      -o /usr/local/lib/docker/cli-plugins/docker-compose
    chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
  }
fi
ok "$(docker --version | cut -d, -f1) · $(docker compose version --short 2>/dev/null || echo compose)"

# ---------------------------------------------------------- 4. usuário deploy
log "4/9 Usuário '${DEPLOY_USER}' (só chave SSH, sem sudo — só precisa do Docker)"
id -u "$DEPLOY_USER" >/dev/null 2>&1 || useradd -m -s /bin/bash "$DEPLOY_USER"
mkdir -p "/home/${DEPLOY_USER}/.ssh"
usermod -d "/home/${DEPLOY_USER}" -s /bin/bash "$DEPLOY_USER"
usermod -aG docker "$DEPLOY_USER"
gpasswd -d "$DEPLOY_USER" sudo >/dev/null 2>&1 || true   # menor privilégio
passwd -l "$DEPLOY_USER" >/dev/null 2>&1 || true          # sem login por senha (chave continua valendo)
touch "/home/${DEPLOY_USER}/.ssh/authorized_keys"
if [[ -n "$DEPLOY_PUBKEY_FILE" && -s "$DEPLOY_PUBKEY_FILE" ]]; then
  grep -qxF "$(cat "$DEPLOY_PUBKEY_FILE")" "/home/${DEPLOY_USER}/.ssh/authorized_keys" \
    || cat "$DEPLOY_PUBKEY_FILE" >> "/home/${DEPLOY_USER}/.ssh/authorized_keys"
  ok "Chave de deploy do GitHub autorizada"
fi
chown -R "$DEPLOY_USER:$DEPLOY_USER" "/home/${DEPLOY_USER}"
chmod 700 "/home/${DEPLOY_USER}/.ssh"; chmod 600 "/home/${DEPLOY_USER}/.ssh/authorized_keys"

# ------------------------------------------------------------------ 5. código
log "5/9 Código em ${APP_DIR}"
install -d "$APP_DIR" "$APP_DIR/data/postgres" "$APP_DIR/data/redis" "$APP_DIR/data/media" "$APP_DIR/data/models" "$APP_DIR/data/backups" "$APP_DIR/data/status"
if [[ "$SRC_DIR" != "$APP_DIR" ]]; then
  rsync -a --delete --exclude '.env' --exclude 'data/' --exclude '.git/' --exclude 'node_modules/' "$SRC_DIR/" "$APP_DIR/"
fi
chown -R "$DEPLOY_USER:$DEPLOY_USER" "$APP_DIR"
git config --system --add safe.directory "$APP_DIR" 2>/dev/null || true
chown -R 70:70 "$APP_DIR/data/postgres" 2>/dev/null || true   # uid do postgres (alpine)
ok "Versão $(cat "$APP_DIR/VERSION")"

# ----------------------------------------------------------------- 6. segredos
log "6/9 Segredos (.env, chmod 600)"
ENV="$APP_DIR/.env"
if [[ ! -f "$ENV" ]]; then
  gen() { openssl rand -hex "$1"; }
  cat > "$ENV" <<EOF
PROJETO_NOME=${PROJETO_NOME}
SUBDOMINIO=${SUBDOMINIO}
LE_EMAIL=${LE_EMAIL}
POSTGRES_DB=harmonia
POSTGRES_USER=harmonia
POSTGRES_PASSWORD=$(gen 24)
REDIS_PASSWORD=$(gen 24)
JWT_SECRET=$(gen 48)
DATA_ENCRYPTION_KEY=$(gen 32)
TURN_SECRET=$(gen 24)
ANTHROPIC_API_KEY=
AI_MODEL=claude-sonnet-4-5
OPENAI_API_KEY=
GROQ_API_KEY=
GEMINI_API_KEY=
GITHUB_MODELS_TOKEN=
CEREBRAS_API_KEY=
MISTRAL_API_KEY=
OPENROUTER_API_KEY=
AI_PROVIDERS=anthropic,openai,groq,gemini,github,cerebras,mistral,openrouter
ADMIN_EMAIL=${LE_EMAIL}
ADMIN_PASSWORD=$(gen 12)
CLOUDFLARE_TUNNEL_TOKEN=
EOF
  ok ".env criado"
else
  ok ".env existente preservado"
fi
env_set "$ENV" AI_ML "$AI_ML"
# atualização automática (pull do GitHub, só commits com CI verde)
[[ -n "$(env_get "$ENV" AUTOUPDATE)" ]] || env_set "$ENV" AUTOUPDATE 1
[[ -n "$(env_get "$ENV" AUTOUPDATE_REPO)" ]] || env_set "$ENV" AUTOUPDATE_REPO "${AUTOUPDATE_REPO:-https://github.com/LACibermedicina/harmonia.git}"
[[ -n "$(env_get "$ENV" AUTOUPDATE_BRANCH)" ]] || env_set "$ENV" AUTOUPDATE_BRANCH main
[[ -n "$(env_get "$ENV" AUTOUPDATE_REQUIRE_CI)" ]] || env_set "$ENV" AUTOUPDATE_REQUIRE_CI 1
env_set "$ENV" API_WORKERS "$([[ "$MEM_MB" -lt 4000 ]] && echo 1 || echo 2)"
chmod 600 "$ENV"

# ------------------------------------------------------------------- 7. portas
log "7/9 Portas (nenhuma < 1024, nenhuma ocupada)"
ensure_ports "$ENV"
chown "$DEPLOY_USER:$DEPLOY_USER" "$ENV"
HTTP_PORT="$(env_get "$ENV" HTTP_PORT)"; TURN_PORT="$(env_get "$ENV" TURN_PORT)"
TURN_MIN="$(env_get "$ENV" TURN_MIN_PORT)"; TURN_MAX="$(env_get "$ENV" TURN_MAX_PORT)"
if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  ufw allow "${TURN_PORT}/tcp" comment 'harmonIA TURN' >/dev/null
  ufw allow "${TURN_PORT}/udp" comment 'harmonIA TURN' >/dev/null
  ufw allow "${TURN_MIN}:${TURN_MAX}/udp" comment 'harmonIA TURN relay' >/dev/null
  ok "UFW ativo: regras do TURN acrescentadas (demais regras intactas)"
else
  warn "UFW desligado — não alterado (para não afetar os outros serviços)."
fi
warn "Se houver Cloud Firewall na DigitalOcean, libere ${TURN_PORT}/tcp+udp e ${TURN_MIN}-${TURN_MAX}/udp (só p/ videochamada)."
if [[ "${HARDEN_SSH:-0}" == "1" ]]; then
  sed -i -E 's/^#?PasswordAuthentication .*/PasswordAuthentication no/' /etc/ssh/sshd_config
  systemctl reload ssh 2>/dev/null || systemctl reload sshd
  warn "Login SSH por senha desativado no servidor inteiro."
fi

# ------------------------------------------------------ 8. subir a stack
log "8/9 Construindo e subindo os containers (1ª vez: 5–15 min)"
cd "$APP_DIR"
if [[ "${SKIP_BUILD:-0}" != "1" ]]; then
  docker compose build
  docker compose up -d --remove-orphans
  for i in $(seq 1 40); do
    docker compose exec -T api python -m app.migrate >/dev/null 2>&1 && break
    sleep 3
  done
  for i in $(seq 1 40); do
    if curl -fsS "http://127.0.0.1:${HTTP_PORT}/api/health" >/dev/null 2>&1; then ok "App respondendo em 127.0.0.1:${HTTP_PORT}"; break; fi
    [[ $i -eq 40 ]] && { docker compose ps; die "App não respondeu. Veja: cd $APP_DIR && docker compose logs --tail=80 api nginx"; }
    sleep 3
  done
  docker builder prune -f >/dev/null 2>&1 || true
  docker image prune -f >/dev/null 2>&1 || true
fi

# ------------------------------------------- 9. HTTPS pelo proxy existente
log "9/9 Publicando https://${SUBDOMINIO} pelo proxy já existente"
PUBLIC_IP="$(curl -4fsS --max-time 5 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')"
DNS_IP="$(dig +short A "$SUBDOMINIO" @1.1.1.1 2>/dev/null | tail -1)"
PROXY="none"
if systemctl is-active --quiet nginx 2>/dev/null; then PROXY="nginx"
elif systemctl is-active --quiet apache2 2>/dev/null; then PROXY="apache"
elif systemctl is-active --quiet caddy 2>/dev/null; then PROXY="caddy"; fi
ok "Proxy: ${PROXY} · IP público: ${PUBLIC_IP} · DNS ${SUBDOMINIO}: ${DNS_IP:-não encontrado}"

need_cert=0
case "$PROXY" in
  nginx)
    if [[ -d /etc/nginx/sites-enabled ]] && grep -qE 'include .*/sites-enabled/' /etc/nginx/nginx.conf; then
      VHOST="/etc/nginx/sites-available/${SUBDOMINIO}"; LINK="/etc/nginx/sites-enabled/${SUBDOMINIO}"
    else
      VHOST="/etc/nginx/conf.d/${SUBDOMINIO}.conf"; LINK=""
    fi
    if [[ -f "$VHOST" ]] && grep -q 'managed by Certbot' "$VHOST"; then
      # já tem TLS: só atualiza a porta interna
      sed -i -E "s#proxy_pass http://127\.0\.0\.1:[0-9]+;#proxy_pass http://127.0.0.1:${HTTP_PORT};#" "$VHOST"
    else
      cp -a "$VHOST" "${VHOST}.bak" 2>/dev/null || true
      sed -e "s/__HTTP_PORT__/${HTTP_PORT}/g" "$APP_DIR/infra/host-proxy/nginx-harmonia.conf" > "$VHOST"
      need_cert=1
    fi
    [[ -n "$LINK" ]] && ln -sf "$VHOST" "$LINK"
    if nginx -t >/dev/null 2>&1; then
      systemctl reload nginx; ok "vhost ${SUBDOMINIO} → 127.0.0.1:${HTTP_PORT}"
    else
      nginx -t || true
      rm -f "$VHOST" ${LINK:+"$LINK"}; [[ -f "${VHOST}.bak" ]] && mv "${VHOST}.bak" "$VHOST"
      die "Config do nginx inválida — vhost do harmonIA removido, os outros sites seguem intactos."
    fi
    ;;
  apache)
    a2enmod proxy proxy_http proxy_wstunnel headers rewrite >/dev/null
    sed -e "s/__HTTP_PORT__/${HTTP_PORT}/g" "$APP_DIR/infra/host-proxy/apache-harmonia.conf" > "/etc/apache2/sites-available/${SUBDOMINIO}.conf"
    a2ensite "${SUBDOMINIO}.conf" >/dev/null
    apachectl configtest && systemctl reload apache2 || { a2dissite "${SUBDOMINIO}.conf" >/dev/null; die "Config do apache inválida — revertido."; }
    need_cert=1
    ;;
  caddy)
    warn "Caddy: acrescente ao Caddyfile e rode 'systemctl reload caddy':"
    sed -e "s/__HTTP_PORT__/${HTTP_PORT}/g" "$APP_DIR/infra/host-proxy/Caddyfile.snippet"
    ;;
  none)
    warn "Nenhum proxy em 80/443. Veja infra/host-proxy/README.md (túnel Cloudflare)."
    ;;
esac

CERT_OK=0
if [[ "$need_cert" == "1" || ! -d "/etc/letsencrypt/live/${SUBDOMINIO}" ]] && [[ "$PROXY" =~ ^(nginx|apache)$ ]]; then
  if [[ "$DNS_IP" == "$PUBLIC_IP" ]]; then
    if ! command -v certbot >/dev/null; then apt-get install -y certbot >/dev/null; fi
    if [[ "$PROXY" == "nginx" ]]; then
      certbot plugins 2>/dev/null | grep -q nginx || apt-get install -y python3-certbot-nginx >/dev/null
    else
      certbot plugins 2>/dev/null | grep -q apache || apt-get install -y python3-certbot-apache >/dev/null
    fi
    if certbot --"$PROXY" -d "$SUBDOMINIO" -m "$LE_EMAIL" --agree-tos --no-eff-email --redirect --non-interactive; then
      CERT_OK=1; ok "Certificado SSL emitido (renovação automática pelo certbot do servidor)"
    else
      warn "certbot falhou — o site segue em HTTP. Rode depois: certbot --${PROXY} -d ${SUBDOMINIO}"
    fi
  else
    warn "DNS de ${SUBDOMINIO} ainda não aponta para ${PUBLIC_IP} (atual: ${DNS_IP:-nenhum})."
    warn "Crie o registro A e, quando propagar, rode:  sudo certbot --${PROXY} -d ${SUBDOMINIO} --redirect"
  fi
elif [[ -d "/etc/letsencrypt/live/${SUBDOMINIO}" ]]; then CERT_OK=1; fi

# ---------------------------------------------- atualização automática (systemd)
cat > /etc/systemd/system/harmonia-autoupdate.service <<UNIT
[Unit]
Description=harmonIA - atualizacao automatica a partir do GitHub
After=network-online.target docker.service
Wants=network-online.target
[Service]
Type=oneshot
User=${DEPLOY_USER}
Group=docker
WorkingDirectory=${APP_DIR}
ExecStart=/bin/bash ${APP_DIR}/infra/scripts/autoupdate.sh
Nice=10
TimeoutStartSec=45min
UNIT
cat > /etc/systemd/system/harmonia-autoupdate.timer <<UNIT
[Unit]
Description=harmonIA - verifica atualizacoes a cada 5 minutos
[Timer]
OnBootSec=2min
OnUnitActiveSec=5min
RandomizedDelaySec=30
Persistent=true
[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now harmonia-autoupdate.timer >/dev/null
ok "Atualização automática ativa (a cada 5 min, só versões com CI verde) — log: ${APP_DIR}/data/status/autoupdate.log"

cat > /etc/cron.d/harmonia-backup <<EOF
40 2 * * * ${DEPLOY_USER} cd ${APP_DIR} && bash infra/scripts/backup.sh
EOF

echo
log "PRONTO ✔"
echo "   Endereço:        $([[ $CERT_OK == 1 ]] && echo https || echo http)://${SUBDOMINIO}"
echo "   App interno:     http://127.0.0.1:${HTTP_PORT} (não exposto)"
echo "   IA:              $([[ $AI_ML == 1 ]] && echo completa || echo 'leve (sem transcrição de áudio/foto)')"
echo "   Login admin:     $(env_get "$ENV" ADMIN_EMAIL)"
echo "   Senha admin:     $(env_get "$ENV" ADMIN_PASSWORD)   ← troque após o 1º acesso"
echo "   Status:          cd ${APP_DIR} && docker compose ps"
echo "   Atualizações:    automáticas (GitHub → VPS a cada 5 min) · log: ${APP_DIR}/data/status/autoupdate.log"
