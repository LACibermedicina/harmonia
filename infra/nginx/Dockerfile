# Stage 1: build do frontend (Vite + TypeScript)
FROM node:20-alpine AS web
WORKDIR /web
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: nginx sem privilégios (usuário nginx, porta 8080 — nenhuma porta < 1024)
FROM nginxinc/nginx-unprivileged:1.27-alpine
COPY --from=web /web/dist /usr/share/nginx/html
EXPOSE 8080
