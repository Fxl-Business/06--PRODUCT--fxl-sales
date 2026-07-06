.PHONY: dev front site back mobile install setup setup-no-db build build-shared build-web build-api build-site \
       lint lint-fix type-check check \
       migrate db-up db-down db-reset docker-up docker-down docker-build \
       clean preview help mobile-install mobile-ios doctor

.DEFAULT_GOAL := dev

# --- Development ---

dev: ## Interactive app selector — pick one of api/web/site/mobile to run
	@printf "Which app do you want to run?\n"
	@printf "  1) api     (http://localhost:3006)\n"
	@printf "  2) web     (http://localhost:8006)\n"
	@printf "  3) mobile  (Expo dev server)\n"
	@printf "  4) site    (http://localhost:4006)\n"
	@printf "Selection [1-4]: "
	@read choice; \
	case "$$choice" in \
		1) $(MAKE) back ;; \
		2) $(MAKE) front ;; \
		3) $(MAKE) mobile ;; \
		4) $(MAKE) site ;; \
		*) echo "Invalid choice: $$choice"; exit 1 ;; \
	esac

front: ## Run only the frontend
	pnpm --filter @fxl-sales/web dev

site: ## Run only the landing page (apps/site)
	pnpm --filter @fxl-sales/site dev

back: build-shared ## Run only the API
	pnpm --filter @fxl-sales/api dev

# --- Setup ---

install: ## Install all dependencies
	pnpm install

setup: ## One-shot bootstrap (preflight + rename + .env + install + db). Auto-detects new-project vs new-dev mode.
	bash scripts/setup.sh

setup-no-db: ## Same as `setup` but skips starting Postgres (use when Docker isn't running)
	bash scripts/setup.sh --no-db

# --- Build ---

build: build-shared ## Build everything
	pnpm --filter @fxl-sales/api build
	pnpm --filter @fxl-sales/web build

build-shared: ## Build shared workspace packages
	pnpm --filter @fxl-sales/shared-types build
	pnpm --filter @fxl-sales/shared-utils build

build-web: ## Build frontend
	pnpm --filter @fxl-sales/web build

build-api: build-shared ## Build API
	pnpm --filter @fxl-sales/api build

build-site: ## Build landing page
	pnpm --filter @fxl-sales/site build

# --- Quality ---

lint: ## Lint all workspaces
	pnpm run lint

lint-fix: ## Lint and auto-fix
	pnpm run lint -- --fix

type-check: ## Type check all workspaces
	pnpm run type-check

check: ## Run lint + typecheck
	pnpm run lint && pnpm run type-check

doctor: ## Run the FXL health check
	bash fxl-doctor.sh

# --- Database ---

migrate: ## Run database migrations
	pnpm --filter @fxl-sales/api db:migrate

db-up: ## Start PostgreSQL only
	docker compose up db -d

db-down: ## Stop PostgreSQL
	docker compose down db

db-reset: ## Destroy and recreate database volume
	docker compose down db -v
	docker compose up db -d
	@echo "Waiting for PostgreSQL..."
	@sleep 3
	$(MAKE) migrate

# --- Docker ---

docker-up: ## Start all services (API + PostgreSQL)
	docker compose up -d

docker-down: ## Stop all services
	docker compose down

docker-build: ## Rebuild Docker images
	docker compose build --no-cache

# --- Mobile (standalone, not part of pnpm workspace) ---

mobile: ## Start the mobile app (Expo dev server)
	cd apps/mobile && pnpm start

mobile-install: ## Install mobile-only dependencies
	cd apps/mobile && pnpm install

mobile-ios: ## Build and run mobile on a connected iOS device
	cd apps/mobile && pnpm ios -- --device

# --- Misc ---

preview: ## Preview production build locally
	pnpm --filter @fxl-sales/web preview

clean: ## Remove all node_modules and build artifacts
	rm -rf node_modules apps/*/node_modules packages/*/node_modules
	rm -rf apps/*/dist packages/*/dist
	rm -rf apps/web/.vite apps/site/.next

# --- Help ---

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-15s\033[0m %s\n", $$1, $$2}'
