# Handoff — fxl-template v1.0

**Date:** 2026-05-19
**Branch:** `main` (local only, no remote push per autopilot rule 11)
**Final commit:** `61ab124`

## What was built

A master scaffold for all future FXL client projects, at `/Users/cauetpinciara/Documents/fxl/projetos/internos/fxl-template/`. Replaces the ad-hoc copy-paste-rename approach.

### Tree

```
fxl-template/
├── apps/
│   ├── api/        Hono 4 + Drizzle (empty schema) + Clerk Backend + Sentry/Resend env-gated. /health endpoint.
│   ├── web/        Vite 6 + React 18 + Tailwind 3 + shadcn baseline + Clerk + TanStack Query + Router + i18n.
│   │               Sidebar + topbar + 3 empty-state routes.
│   ├── site/       Next.js 15 + React 19 + Tailwind v4. Hero + Features + HowItWorks + Footer landing.
│   └── mobile/     Expo Router 6 + RN 0.81 + NativeWind + Clerk Expo. Sign-in + tab navigator.
│                   Standalone pnpm scope (own pnpm-lock.yaml).
├── packages/
│   ├── shared-types/   audit-actions tuple, env zod schemas, branded ID types
│   └── shared-utils/   theme tokens, money/date helpers
├── .planning/      PROJECT.md, ROADMAP.md, STATE.md, perf-budget.yml
├── .nexo/          config.json + manifest.json
├── .husky/pre-commit
├── .github/workflows/ci.yml
├── scripts/
│   ├── init-from-template.sh   placeholder rename + pnpm install
│   └── perf-audit.mjs           stub
├── CLAUDE.md       FXL contract rules (with __APP_*__ placeholders)
├── Makefile        dev/front/site/back/mobile/install/build/lint/type-check/migrate/...
├── docker-compose.yml
├── fxl-doctor.sh
├── docs/
│   ├── template-usage.md
│   ├── superpowers/specs/2026-05-19-fxl-template-design.md
│   └── nexo/handoffs/2026-05-19-fxl-template-v1-handoff.md (this file)
└── (standard configs: tsconfig.base, prettier, .gitignore, .npmrc, vercel.json)
```

7 atomic commits, one per phase (6 + 1 integration fix).

## Spec & decisions

Full design: `docs/superpowers/specs/2026-05-19-fxl-template-design.md`.

Five locked decisions (all user-approved during brainstorm):
1. Init strategy: placeholder tokens (`fxl-sales`, `Fxl Sales`, `fxl_finders`, `3006`, `8006`, `4006`) + `scripts/init-from-template.sh`
2. Scaffold depth: full FXL contract pre-wired, layout-only (no migrations, no seed data, no TanStack queries in pages)
3. Mobile: outside pnpm workspace, standalone Expo (React 19 vs web React 18)
4. Git: `git init` + atomic commit per phase, no remote push
5. Nexo wiring: full — root CLAUDE.md, `.nexo/`, `.planning/` skeleton, per-app AGENTS.md

## How to use

```bash
# 1. Clone into your new project location
git clone /path/to/fxl-template /path/to/my-new-project
cd /path/to/my-new-project

# 2. Run the init script (positional: slug, name, db)
bash scripts/init-from-template.sh my-new-project "My New Project" my_new_project --git-fresh

# 3. Fill .env files
# apps/api/.env   → DATABASE_URL, CLERK_SECRET_KEY, ...
# apps/web/.env   → VITE_CLERK_PUBLISHABLE_KEY, VITE_API_URL
# apps/site/.env  → NEXT_PUBLIC_WEB_URL
# apps/mobile/.env → EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY, EXPO_PUBLIC_API_URL

# 4. Boot
make db-up
make dev          # api + web in parallel
make site         # landing (separate terminal)
make mobile       # expo (separate terminal, cd apps/mobile)
```

## What was verified end-to-end

Cloned the template to `/tmp`, ran the rename script, then:
- 0 unresolved `__APP_*__` tokens remained after rename
- `pnpm install` succeeded in 27s
- `pnpm -r type-check` green across `shared-types`, `shared-utils`, `api`, `web`, `site`
- `apps/mobile` (standalone): `pnpm install` + `pnpm type-check` green

Two real bugs surfaced and got fixed in Phase 7:
- `apps/web/src/router.tsx`: pnpm isolated linker leaked `@remix-run/router` transitive type → explicit `ReturnType<typeof createBrowserRouter>` annotation
- `apps/mobile/lib/clerk-token-cache.ts`: `@clerk/clerk-expo/dist/cache` subpath has moved → inlined `TokenCache` type

## Deviations from /nexo:add-feature workflow

Logged in `.planning/STATE.md`. Summary:

1. Greenfield, no PROJECT.md → bootstrapped `.planning/` directly instead of invoking `/gsd-new-project` (would have derailed autopilot)
2. Phases ran in main context (Tier 1-ish) rather than via `/gsd-plan-phase`/`/gsd-execute-phase` agents. Spec was fully prescriptive — no per-phase Q&A needed. Verify-work gates honored manually
3. Per-phase `pnpm type-check` deferred to final integration test because the template can't `pnpm install` until rename

## Suggested next steps

1. **Add the missing mobile assets.** `apps/mobile/app.config.ts` references `./assets/icon.png` and `./assets/adaptive-icon.png` which aren't shipped. Drop in 1024×1024 placeholders so `pnpm start` doesn't warn.
2. **Wire the perf-audit stub.** `scripts/perf-audit.mjs` exits 0. Port the rule catalogue from `1-fxl-financeiro`'s `scripts/perf-audit.mjs` and `docs/perf-methodology.md`.
3. **Add smoke tests.** Vitest for shared-utils, a `health.test.ts` for apps/api, and a Playwright `signed-out-renders-clerk.spec.ts` for apps/web. Then enable `pnpm test` in `fxl-doctor.sh`.
4. **Pre-build a sample env profile.** A `.env.example.dev` that points to a shared dev Clerk instance + a docker Postgres so a new contributor can `make dev` without provisioning anything.
5. **Set up GitHub remote** (when ready). `gh repo create fxl/fxl-template --private --source . --push` — and only then is `git push` authorized.

## Resume tips for future sessions

- The spec, roadmap, and state files in `.planning/` and `docs/superpowers/specs/` are the source of truth — read them first
- `git log --oneline` gives you the phase-by-phase build history
- The init script is idempotent on already-renamed projects (it just won't find any `__APP_*__` matches)
- For small follow-ups: `/nexo:fast` or `/nexo:quick`
- For larger evolution (e.g., wiring real perf audit): open a fresh session with this handoff pasted in, then `/nexo:add-feature`
