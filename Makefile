.PHONY: dev up down logs test build backup ports
up:        ## sobe stack de produção
	docker compose up -d --build
down:
	docker compose down
logs:
	docker compose logs -f --tail=200
test:      ## testes do motor musical + build web
	cd ai-worker && python -m pytest -q tests
	cd frontend && npm run build
dev:       ## frontend local com proxy p/ API em localhost:8000
	cd frontend && npm run dev
backup:
	bash infra/scripts/backup.sh
ports:     ## mostra portas em uso no host e as escolhidas pelo harmonIA
	@bash -c '. infra/scripts/lib-ports.sh; echo "Em uso: $$(ports_in_use | tr "\n" " ")"; grep -E "^(HTTP|TURN)_" .env 2>/dev/null || true'
