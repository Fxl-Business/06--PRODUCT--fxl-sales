# Fxl Sales

Project bootstrapped from `fxl-template` — the FXL canonical monorepo scaffold. After init, fill in stack-specific details and remove this line.

## Architecture

- **Monorepo**: pnpm workspaces — `apps/web`, `apps/api`, `apps/site`, `apps/mobile` (standalone), `packages/shared-types`, `packages/shared-utils`
- **Frontend**: React 18 + Vite + TypeScript + Tailwind + shadcn/ui + TanStack Query + React Router v6
- **Backend**: Hono + Drizzle ORM + PostgreSQL + Clerk Backend SDK
- **Landing**: Next.js 15 + Tailwind v4
- **Mobile**: Expo Router + React Native + NativeWind + Clerk Expo (standalone — not in pnpm workspace)
- **Auth**: Clerk organizations — JWT carries org_id, backend validates
- **Data flow**: React → api-client.ts → Hono → PostgreSQL (Drizzle). Frontend NEVER calls DB directly.
- **Deploy**: Hetzner VPS via Coolify (API), Vercel (web + site)
- **i18n**: react-i18next — PT-BR primary, EN secondary

## Commands

```bash
make setup        # One-shot bootstrap (preflight + rename + .env + install + db).
                  # Auto-detects new-project vs new-dev mode.
make setup-no-db  # Same as setup but skips Docker (use when Docker isn't running)
make              # Interactive selector — pick 1) api  2) web  3) mobile  4) site
make front        # Frontend only (port 8006)
make site         # Landing only (port 4006)
make back         # Backend only (port 3006)
make mobile       # Mobile (Expo dev server, standalone)
make install      # pnpm install
make doctor       # FXL health check
make check        # lint + type-check
```

## Rules — FXL contract (inherited from template)

### Data & Auth
- Every table has `org_id text NOT NULL` with RLS policy
- Backend extracts org_id from Clerk JWT: `payload.org_id ?? payload.sub`
- All queries filter by org_id — never trust client-provided org_id
- All mutations include `eq(table.id, id)` AND `eq(table.orgId, orgId)`
- `DATABASE_URL` is backend-only — never prefix with `VITE_`
- Admin endpoints bypass org_id filtering (cross-org visibility)

### Code Style
- Named exports only — no default exports
- Functional components only — no class components
- Strict TypeScript — no `any`, use `unknown` + type guards
- Array hooks use `select: (data) => Array.isArray(data) ? data : []`
- Query invalidation: `invalidateQueries()` — never `resetQueries()`
- Every mutation hook MUST invalidate every queryKey whose underlying data the server-side handler could change

### UI Identifiers (no raw Clerk IDs)
- NEVER render a raw Clerk identifier (`user_*`, `org_*`) in user-facing UI
- The API boundary resolves names via `resolveActors` / `resolveOrgs`
- Frontend components render via `userLabel` / `orgLabel` helpers
- Raw-ID fallback uses `font-mono text-xs text-muted-foreground`

### Loading States (mandatory)
- `isLoading === true` → skeleton (never empty state, never content)
- `!isLoading && empty` → empty state ("Sem dados")
- `!isLoading && data` → content
- Use `KPICard` for all metric displays with `title`, `value`, `icon`, `isLoading`, `colorScheme`

### API Pattern (domain-based)
- `apps/api/src/domains/{name}/routes.ts` — Hono router with typed Variables
- `apps/api/src/domains/{name}/service.ts` — Zod schemas + business logic + Drizzle queries
- Routes extract orgId/userId from context, pass to service

### Performance Budget
- Every commit runs `pnpm run perf:audit` via `.husky/pre-commit`
- `--no-verify` is forbidden. To bypass: `Perf-Audit-Bypass: <reason>` trailer + tracked follow-up

## Environments

3-level model — full details in root `README.md`.

| Level | Clerk | Postgres | Secrets | Who |
|---|---|---|---|---|
| **local** | Shared "FXL Local Sandbox" Clerk app (one across all 20+ FXL projects) | Local Docker (`make db-up`) | `.env.dev.example` → `.env` (committed dev keys) | All devs |
| **staging** | This project's Clerk app, "Development" instance | Coolify staging DB | Infisical `staging` env | CTO + leads |
| **production** | This project's Clerk app, "Production" instance | Coolify prod DB | Infisical `prod` env | CTO + ops |

New devs onboard with `make setup` (copies dev defaults, runs `pnpm install`). They never see staging or prod credentials.

## Template artifacts

This project was scaffolded from `fxl-template` v1.0.0. To check what's still a placeholder:

```bash
grep -r '__APP_' . --include='*.md' --include='*.ts' --include='*.tsx' --include='*.json' --include='*.yaml' --include='*.yml' --include='Makefile'
```

If any matches remain, the init-from-template script missed them — patch by hand and report to the template repo.

<!-- nexo:managed:start -->
<!-- Managed by Nexo (/nexo-init, /nexo-doctor). Edit only OUTSIDE these markers. -->

## Methodology: Nexo - Extreme Programming, enforced

Work runs through the loop, **one small slice at a time** (a feature is many slices):

```
Frame → Plan → [Human Gate] → Execute(Red→Green→Refactor) → Verify → Capture → ↺
```

- **Frame** - capture *what* + *why*; write acceptance criteria as testable statements ("given X, when Y, then Z").
- **Plan** - slice to the smallest shippable increment; state scope limits (YAGNI); name the test that proves "done". If it needs the word "and", it's two slices.
- **Human Gate (Gate 1)** - the human approves the plan + test contract. *(skippable: `--autopilot`)*
- **Execute** - **Red** (write the failing test = locked oracle, immutable to the implementer) → **Green** (simplest thing that passes) → **Refactor** (only on green).
- **Verify (Gate 2)** - a **different agent** runs the full suite + lint + typecheck + security, locally. Objective PASS/FAIL.
- **Capture** - atomic Conventional Commit; record the run in `nexo/runs/`; distill learnings to `nexo/knowledge/` + curate `CLAUDE.md`.

Roles never invert: the **human owns WHAT** (goals, priorities, "ship it", "stop - over-engineered"); the **agent owns HOW** (implementation, tests, refactor, research). If WHAT is unclear, **stop and ask** - never guess and build.

## The three gates

| Gate | Checks | Enforced by | Skippable? |
|---|---|---|---|
| **1 · WHAT** | the plan is right | the human | yes (`--autopilot`) |
| **2 · Machine** | tests + lint + typecheck + security green | a **separate Verify agent, run locally** | **never** |
| **3a · Cut → staging** | release-verify green + version correct; tag on `master` (`/nexo-ship`) | human approval | **never auto** |
| **3b · Staging → prod** | staging validated in-env; ff-push `production` | human approval | **never auto** |

## Delivery - local trunk + promotion (`master → staging → production`, no hosted CI)

- **`master`** is the single long-lived trunk. Always green (local Verify passed before merge), always testable. Everything integrates here.
- Per slice: short-lived **local** `feat/*` / `fix/*` → separate-agent Verify PASS → `git merge --no-ff` into `master` → delete branch → `git push origin master`.
- **Promotion (opt-in, this repo):** `staging` and `production` are **deployment pointers**, never integration branches. Promotion is **fast-forward-only** `git push` run by `/nexo-ship` (Gate 3a/3b) - never force-pushed, never reset, never merged `--no-ff`. The deploy platform (Vercel/Coolify) watches the branches; deploys happen ONLY from `staging`/`production` (`master` deploys are disabled in vercel.json).
- **No PRs, no hosted CI.** Gate 2 is the local Verify.
- **The user never commits by hand - Nexo runs the whole delivery sequence.**

## Conventional Commits (drives SemVer at ship time)

Atomic - one logical change per commit. If the message needs "and", split it.

```
<type>(<scope>): <summary>
```

Types: `feat` (→ minor) · `fix` / `perf` (→ patch) · `refactor` · `test` · `docs` · `chore` · `ci`.
Breaking change: `feat!:` or a `BREAKING CHANGE:` footer (→ major).

## Artifacts live in one place - `nexo/`

`ROADMAP.md` (backlog) · `state.json` (pointer + `delivery` block) · `plans/` · `runs/` · `milestones/` · `knowledge/{decisions,doubts}/` · `playbooks/`. Never scatter into `.nexo/`, `docs/nexo/`, or `.planning/`.

<!-- nexo:managed:end -->
