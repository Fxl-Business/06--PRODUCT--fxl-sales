# Using fxl-template

This template scaffolds a new FXL client project with all 4 apps (web, api, site, mobile) wired against the FXL contract, ready to boot to a visible layout — no business logic, no migrations, no seed data.

## Quick start

```bash
# 1. Clone the template into your new project directory
git clone <fxl-template-url> my-new-project
cd my-new-project

# 2. One-shot setup (interactive — prompts for slug/name/db)
make setup
# Or non-interactive:
bash scripts/setup.sh my-new-project "My New Project" my_new_project

# 3. Run an app
make              # interactive selector: 1) api  2) web  3) mobile  4) site
```

`make setup` runs preflight (Node 20+, pnpm 9+, Docker, git), gathers project identity, renames all `__APP_*__` placeholders, scaffolds `.env` files, installs dependencies (root + standalone mobile scope), boots Postgres via docker-compose, and **wipes the template's `.git` so your project starts with a fresh history**. If Docker isn't running, use `make setup-no-db`. Pass `--keep-git` if you want to preserve the template's git history (rare).

## Placeholder tokens

The setup script replaces these tokens across all files:

| Token | Example | Used in |
|---|---|---|
| `fxl-sales` | `fxl-financeiro` | pnpm scope `@<slug>/web`, package names, `.nexo/config.json` |
| `Fxl Sales` | `FXL Financeiro` | README, CLAUDE.md, page titles |
| `fxl_finders` | `fxl_financeiro` | docker-compose, `DATABASE_URL` |
| `3006` | `3003` | api server, CORS, web `VITE_API_URL` |
| `8006` | `8003` | vite, api `CORS_ORIGIN` |
| `4006` | `4003` | next dev |
| `5006`  | `5003` | docker-compose host port mapping, `DATABASE_URL` |
| `2026-05-28` | `2026-05-19` | `.nexo/manifest.json` |

When you give `make setup` a project number `N`, all four port tokens above are derived as `3000+N` / `8000+N` / `4000+N` / `5000+N` so multiple FXL projects can run their stacks side-by-side without collisions. Blank number → stock defaults (3000 / 5173 / 3001 / 5432).

## What's pre-wired

- pnpm workspaces with shared-types and shared-utils packages
- Hono backend with `/health`, Drizzle ORM (empty schema), Dockerfile
- Vite React app with sidebar+topbar shell, Clerk sign-in, shadcn baseline components
- Next.js 15 landing page with hero/features/howitworks/footer
- Expo Router mobile app with Clerk sign-in + tab navigator
- Tailwind tokens shared across all 4 apps via `packages/shared-utils/src/theme.ts`
- i18n: PT-BR primary, EN secondary
- `.husky/pre-commit` running stub `perf-audit.mjs` (replace with real rules per project)
- `fxl-doctor.sh` CI health check
- `.github/workflows/ci.yml` running doctor
- Root `CLAUDE.md` with FXL contract rules
- Per-app `AGENTS.md` files
- `.planning/` skeleton ready for `/gsd-new-milestone`

## What's NOT pre-wired (intentional)

- Real Drizzle schema or migrations — write them in `apps/api/src/db/schema.ts`
- Data fetching in `apps/web` pages — pages render empty states; wire TanStack Query queries to `apps/api`
- Sentry / Resend / R2 / Infisical runtime — env vars present, code paths are no-ops until you wire them
- Playwright E2E tests
- Domain-specific business logic

## First-time CTO setup: FXL Local Sandbox Clerk app

The template ships `.env.dev.example` files containing placeholder values like `pk_test_FXL_LOCAL_SANDBOX_REPLACE_ME` and `sk_test_FXL_LOCAL_SANDBOX_REPLACE_ME`. These placeholders mean "Clerk keys not yet configured."

**You only do this once for the entire FXL ecosystem (covers all 20+ projects):**

1. Go to https://dashboard.clerk.com → Create application → name it **"FXL Local Sandbox"**
2. Open the Development instance → Settings → API Keys
3. Copy the Publishable key (`pk_test_…`) and the Secret key (`sk_test_…`)
4. In your local `fxl-template` clone, run:

   ```bash
   # macOS / BSD sed
   PK="pk_test_REAL_VALUE_HERE"
   SK="sk_test_REAL_VALUE_HERE"
   find apps -name '.env.dev.example' -exec sed -i '' "s|pk_test_FXL_LOCAL_SANDBOX_REPLACE_ME|$PK|g" {} +
   find apps -name '.env.dev.example' -exec sed -i '' "s|sk_test_FXL_LOCAL_SANDBOX_REPLACE_ME|$SK|g" {} +
   ```

5. Commit the result: `git commit -am "config: wire FXL Local Sandbox Clerk keys into template"`
6. Push to your template remote.

From this point on, every new project created from the template and every new developer joining an existing project gets working Clerk dev auth with zero additional setup.

**If a sandbox key leaks or you need to rotate:** repeat steps 2–5 with new keys. Every downstream project picks them up on next template sync.

## Onboarding a new developer to an existing project (not the template)

The same `make setup` works for new devs joining an existing project. It auto-detects that placeholders are already replaced and skips the rename step, running only:

1. Preflight (Node / pnpm / Docker / git)
2. `.env` scaffolding from `.env.dev.example`
3. `pnpm install` at root + in `apps/mobile`
4. `docker compose up db -d`

```bash
git clone <project repo>
cd <project repo>
make setup          # auto-detects new-dev mode
make                # interactive app selector
```

The script is idempotent — re-running won't clobber existing `.env` files and will skip already-installed deps.

## Updating the template

This template is itself a living project. When you discover a pattern that should be shared across all FXL projects, contribute it back to `fxl-template`. Treat each downstream project as a consumer of the template's contract.
