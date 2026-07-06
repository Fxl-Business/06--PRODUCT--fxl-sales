# Dev-Env + README — Design Spec (Milestone v1.1)

**Date:** 2026-05-19
**Author:** Claude (via /nexo:add-feature)
**Milestone:** v1.1 — Dev-environment model and root README
**Parent project:** `fxl-template` (v1.0 baseline closed 2026-05-19)

---

## Goal

The CTO is growing the team. Until v1.0, only the CTO developed against the existing Clerk "Development" instance (used as staging). New employees can't safely use staging directly. Two deliverables:

1. **Dev-environment model** — a 3-level scheme (local / staging / prod) with concrete provisioning for Clerk, Postgres, and secrets, so onboarding a new dev is `clone → setup script → make` with zero contact with staging credentials.
2. **Root `README.md`** — onboarding entrypoint covering both "starting a new project" and "joining an existing project" flows.

## Non-goals

- Creating the actual FXL Local Sandbox Clerk app (CTO does this once outside the template; template ships placeholder keys + instructions)
- Provisioning Infisical workspaces (out-of-band ops task)
- Setting up Coolify dev/staging/prod environments (separate infra task)
- Automating per-developer Clerk user creation
- VPN/network access for any shared remote dev DB (we don't use one)

## Locked decisions (from brainstorm)

| # | Decision | Rationale |
|---|---|---|
| 1 | One shared "FXL Local Sandbox" Clerk app for ALL 20+ FXL projects | Avoid Clerk-app sprawl. Per-project Clerk app keeps its current Dev=staging + Prod=production roles. |
| 2 | Local Docker Postgres per dev per project | Already shipped in `docker-compose.yml`. Zero remote dependency, fastest feedback loop. |
| 3 | Dev secrets committed in `.env.dev.example` per app | User explicit: "for develop we only have the envs in the code, in the .env". Acceptable because sandbox has no real users/data. |
| 4 | Infisical for staging + prod secrets only | Matches FXL canonical (`ecossistema/monorepo/env-vars.md`). Not used for dev. |
| 5 | Template ships placeholder Clerk sandbox keys + CTO instructions for one-time creation | CTO creates the FXL Local Sandbox Clerk app once on dashboard.clerk.com, replaces placeholders in the template repo with real keys, commits. From then on every new project + every new dev gets working keys automatically. |

## Environment model

```
LOCAL                          STAGING                       PRODUCTION
─────                          ───────                       ──────────
Clerk:  shared FXL Local       Clerk:  project app's          Clerk:  project app's
        Sandbox (1 app, all            "Development" instance         "Production" instance
        20+ projects)                  (CTO + leads only)             (real users)
Postgres: local Docker         Postgres: Coolify staging DB   Postgres: Coolify prod DB
Secrets: .env.dev.example      Secrets: Infisical (staging)   Secrets: Infisical (prod)
         (committed)
Who:     all devs              Who:     CTO + leads            Who:     CTO + ops only
```

## Template changes (Phase 8)

### Per-app `.env.dev.example` (new, committed)

Each of `apps/{api,web,site,mobile}` gets a `.env.dev.example` with the FXL Local Sandbox keys hard-wired and localhost defaults. The existing `.env.example` stays — it's the reference for what keys exist (used by Infisical mirror config and as the new-project staging/prod template).

**`apps/api/.env.dev.example`:**
```dotenv
NODE_ENV=development
PORT=3006
CORS_ORIGIN=http://localhost:8006
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/fxl_finders
CLERK_SECRET_KEY=sk_test_FXL_LOCAL_SANDBOX_REPLACE_ME
CLERK_PUBLISHABLE_KEY=pk_test_FXL_LOCAL_SANDBOX_REPLACE_ME
CLERK_WEBHOOK_SECRET=whsec_dev_unused
SENTRY_DSN=
RESEND_API_KEY=
RESEND_FROM=
```

**`apps/web/.env.dev.example`:**
```dotenv
VITE_API_URL=http://localhost:3006
VITE_CLERK_PUBLISHABLE_KEY=pk_test_FXL_LOCAL_SANDBOX_REPLACE_ME
VITE_SENTRY_DSN=
```

**`apps/site/.env.dev.example`:**
```dotenv
NEXT_PUBLIC_APP_NAME=Fxl Sales
NEXT_PUBLIC_WEB_URL=http://localhost:8006
NEXT_PUBLIC_VERCEL_ANALYTICS=
```

**`apps/mobile/.env.dev.example`:**
```dotenv
EXPO_PUBLIC_API_URL=http://localhost:3006
EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_FXL_LOCAL_SANDBOX_REPLACE_ME
```

### `scripts/setup-dev.sh` (new)

For new-developer onboarding on an existing project (NOT for starting a new project — that's `init-from-template.sh`).

- For each app, if `.env` doesn't exist, copy from `.env.dev.example`
- Runs `pnpm install` at root
- Reminds the user to run `make db-up` and `make`
- Idempotent: re-running doesn't clobber existing `.env`

### `scripts/init-from-template.sh` (updated)

Currently copies `.env.example` → `.env`. Update to copy `.env.dev.example` → `.env` (with `.env.example` as fallback if `.env.dev.example` doesn't exist on a given app, so the script stays robust).

### `Makefile` (updated)

Add `make setup` target that runs `setup-dev.sh`. Update the help text.

### `CLAUDE.md` (updated)

Add a new section "Environments" mirroring the matrix above. Reference the README for full onboarding details.

### `docs/template-usage.md` (updated)

Add a "First-time CTO setup" callout: create FXL Local Sandbox Clerk app, get its keys, sed-replace `FXL_LOCAL_SANDBOX_REPLACE_ME` placeholders across `.env.dev.example` files in the template repo, commit.

## Root README.md (Phase 9)

Structure (per brainstorm synthesis):

```markdown
# fxl-template

[Elevator pitch: 2 lines]

## Quick links
- Starting a NEW project from this template → § Use as a template
- NEW dev joining an EXISTING project → § Onboard a new dev
- Understanding environments → § Environments

## Prerequisites
Node 20+, pnpm 9+, Docker Desktop, Xcode (iOS), Android Studio (Android).

## Use as a template (CTO / project lead)
[5-step recipe]

## Onboard a new dev (existing project)
[5-step recipe]

## Environments
[Matrix + Clerk strategy explanation + how to switch to staging for one-off testing]

## Getting API keys
- Clerk: dev needs nothing — .env.dev.example points at FXL Local Sandbox. For staging/prod, CTO grants Infisical access.
- Sentry/Resend: optional for dev, leave blank.

## Running the apps
[Makefile cheatsheet]

## Common issues
[Docker not running, Clerk redirect loop, workspace:* resolution, mobile pnpm scope]

## Where to go next
→ CLAUDE.md (FXL contract rules)
→ apps/*/AGENTS.md (per-app rules)
→ docs/template-usage.md (placeholder rename details)
→ docs/superpowers/specs/ (design history)
```

## Phase plan

Token tier: **1** (two phases, single session, no subagents).

| # | Phase | Verify |
|---|---|---|
| 8 | Dev-env scaffolding | (a) clone template to `/tmp`, run init-from-template, observe `.env` files created from `.env.dev.example`; (b) `pnpm install` clean; (c) `pnpm -r type-check` green; (d) `setup-dev.sh` is idempotent (running twice doesn't overwrite `.env`) |
| 9 | Root README.md | (a) File exists at `README.md`; (b) renders without markdown errors (manual check); (c) both onboarding flows present; (d) environments section matches the spec matrix |

## Failure semantics

- Dev-env phase failure → halt, surface; setup-dev.sh is a small enough script that one retry resolves anything
- README phase failure → impossible (it's a docs-only commit); validation is content-completeness
- TSC regression after dev-env changes → halt; means an `.env.dev.example` introduced a typo that broke env.ts parsing

## Self-review (2026-05-19)

- Placeholders scanned — `FXL_LOCAL_SANDBOX_REPLACE_ME` is the consistent token across all `.env.dev.example` files
- Internal consistency — the README's "onboard a new dev" flow uses `setup-dev.sh` which Phase 8 creates; no forward references to nonexistent files
- Scope check — focused on two phases, both small; no need to decompose further
- Ambiguity check — clarified: `.env.dev.example` is committed and contains real working Clerk keys ONCE the CTO swaps in the FXL Local Sandbox values. Until that one-time swap, the placeholders force a clear error.
