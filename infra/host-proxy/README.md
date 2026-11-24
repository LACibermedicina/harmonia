# Publicação HTTPS sem abrir portas novas

O harmonIA segue a regra: **nenhuma porta < 1024 e nenhuma porta já ocupada**.
A stack escuta só em `127.0.0.1:HTTP_PORT` (porta alta livre escolhida pelo setup e gravada no `.env`).
Quem atende o público em 443 é o proxy que **já existe** no servidor.

| Proxy no host | O que o `setup-vps.sh` faz |
|---|---|
| nginx | cria `/etc/nginx/sites-available/harmonia.m3d.pro` e roda `certbot --nginx` |
| apache2 | cria o vhost, ativa `proxy*` e roda `certbot --apache` |
| Caddy | imprime o bloco de `Caddyfile.snippet` para você colar (TLS automático) |
| Traefik / nginx-proxy em container | veja abaixo |
| nenhum | use o túnel Cloudflare |

A renovação do certificado fica com o certbot do próprio host (timer `certbot.timer`).

## Proxy em container (Traefik, nginx-proxy)
Crie `docker-compose.override.yml` em `/opt/harmonia` ligando o serviço `nginx` à rede do seu proxy
e aponte o proxy para `nginx:8080`, por exemplo para Traefik:

```yaml
services:
  nginx:
    networks: [edge, internal, proxy]
    labels:
      - traefik.enable=true
      - traefik.http.routers.harmonia.rule=Host(`harmonia.m3d.pro`)
      - traefik.http.routers.harmonia.tls.certresolver=letsencrypt
      - traefik.http.services.harmonia.loadbalancer.server.port=8080
networks:
  proxy:
    external: true   # nome da rede do seu Traefik
```

## Sem proxy: túnel Cloudflare (zero portas de entrada)
Requer o DNS de `m3d.pro` na Cloudflare.
1. Cloudflare Zero Trust → Networks → Tunnels → Create tunnel (cloudflared) → copie o token.
2. Public hostname: `harmonia.m3d.pro` → Service `http://nginx:8080`.
3. Em `/opt/harmonia/.env`: `CLOUDFLARE_TUNNEL_TOKEN=<token>` e `COMPOSE_PROFILES=tunnel`.
4. `docker compose up -d` — o registro DNS é criado pela própria Cloudflare (não crie o registro A).
