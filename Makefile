.PHONY: dev front back stg back-stg front-stg install setup setup-no-db build build-shared build-web build-api \
       lint lint-fix type-check check \
       migrate db-up db-down db-reset docker-up docker-down docker-build \
       clean preview help doctor

.DEFAULT_GOAL := dev

# --- Development ---

dev: ## Interactive app selector - pick api or web to run
	@printf "Which app do you want to run?\n"
	@printf "  1) api     (http://localhost:3006)\n"
	@printf "  2) web     (http://localhost:8006)\n"
	@printf "Selection [1-2]: "
	@read choice; \
	case "$$choice" in \
		1) $(MAKE) back ;; \
		2) $(MAKE) front ;; \
		*) echo "Invalid choice: $$choice"; exit 1 ;; \
	esac

front: ## Run only the frontend
	pnpm --filter @fxl-sales/web dev

back: build-shared ## Run only the API
	pnpm --filter @fxl-sales/api dev

# --- Staging ---
#
# Staging is opt-in BY NAME and never by default. `back-stg` names
# apps/api/.env.staging through SALES_ENV_FILE; `front-stg` names
# apps/web/.env.staging through vite's --mode. Both files are gitignored and
# hold real values; the committed shapes are the .env.staging.example files.
#
# There is deliberately NO `migrate-stg` target, and none is to be added.
# Applying DDL to staging is a DEPLOY step, run by the deploy pipeline against
# the deploy's own credentials - not a target sitting one typo away from
# `make migrate` on a developer's machine. If you came here to add it: don't.

stg: ## Interactive app selector for STAGING - pick api or web to run
	@printf "Which app do you want to run against STAGING?\n"
	@printf "  1) api     (SALES_ENV_FILE=.env.staging)\n"
	@printf "  2) web     (vite --mode staging)\n"
	@printf "Selection [1-2]: "
	@read choice; \
	case "$$choice" in \
		1) $(MAKE) back-stg ;; \
		2) $(MAKE) front-stg ;; \
		*) echo "Invalid choice: $$choice"; exit 1 ;; \
	esac

front-stg: ## Run only the frontend against staging (reads apps/web/.env.staging)
	pnpm --filter @fxl-sales/web dev --mode staging

back-stg: build-shared ## Run only the API against staging (reads apps/api/.env.staging)
	SALES_ENV_FILE=.env.staging pnpm --filter @fxl-sales/api dev

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

# db-reset chains `migrate`, and that chain is what once carried DDL to staging.
# The line below is an ANNOUNCEMENT, not a guard: it prints the host that
# `migrate` is about to receive, before anything is destroyed, so a wrong host is
# visible while the prompt is still yours to abort. The enforcement lives in
# apps/api/src/db/migrate.ts and refuses by exit code. Host and port only - never
# a user, never a password, never the whole URL.
db-reset: ## Destroy and recreate database volume (announces the target host first)
	@node -e 'const fs=require("fs");const p="apps/api/.env";let host="(unknown - no DATABASE_URL in environment or apps/api/.env)";try{let raw=process.env.DATABASE_URL||"";if(!raw){const line=fs.readFileSync(p,"utf8").split("\n").map(s=>s.trim()).filter(s=>s.startsWith("DATABASE_URL=")).pop();if(line)raw=line.slice(13).trim().replace(/"/g,"");}if(raw){const u=new URL(raw);host=u.hostname+":"+(u.port||"5432");}}catch(e){host="(unknown - DATABASE_URL unreadable or unparseable)";}console.log("db-reset: migrations will target host "+host);'
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

# --- Misc ---

preview: ## Preview production build locally
	pnpm --filter @fxl-sales/web preview

clean: ## Remove all node_modules and build artifacts
	rm -rf node_modules apps/*/node_modules packages/*/node_modules
	rm -rf apps/*/dist packages/*/dist
	rm -rf apps/web/.vite

# --- Help ---

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-15s\033[0m %s\n", $$1, $$2}'
