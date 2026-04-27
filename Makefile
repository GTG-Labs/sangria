.PHONY: dev dev-clean down

dev:
	docker compose -f docker-compose.dev.yml up --build

dev-clean:
	docker compose -f docker-compose.dev.yml down -v
	docker compose -f docker-compose.dev.yml up --build

down:
	docker compose -f docker-compose.dev.yml down
