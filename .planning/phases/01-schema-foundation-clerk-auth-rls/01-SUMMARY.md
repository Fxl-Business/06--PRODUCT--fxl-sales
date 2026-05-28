# Phase 01 — Execution Summary

**Plan:** `01-PLAN.md` (17 tasks: T01–T15 + T09b + T11b)
**Status:** ✅ complete
**Executed:** 2026-05-28 (inline sequential execution — runtime has no Agent() isolation; followed the documented sequential-inline fallback)

## What shipped

### Schema (T02–T08) — `apps/api/src/db/schema.ts`
9 foundation tables: `finders`, `sellers`, `apps`, `products`, `price_bands`,
`commission_rules`, `audit_log`, `webhook_events`, `leads`.
- Money = `integer` cents; rates = `numeric(5,2)` (only `setup_rate_pct` / `recurring_rate_pct`).
- `audit_log` = `bigserial` PK, append-only (no `updated_at`).
- Composite indexes leading on `org_id`: `finders_org_id_idx`, `leads_org_id_idx` (D-R NIT).
- `leads.click_id`/`link_id` = soft FKs (Phase 04 adds hard FKs).
- No LGPD consent columns (owned by Phase 03 T01).
- `price_bands` CHECK `min_brl <= list_brl <= max_brl`.

### Migration (T09 + T10) — `apps/api/drizzle/0000_fancy_klaw.sql` (journaled)
- Generated via `drizzle-kit generate`; role grants + RLS policies APPENDED INTO
  the SAME journaled file (D-F) — NOT a standalone `.sql`.
- 3 roles: `fxl_finders_owner` (owner), `fxl_finders_app` (LOGIN, no BYPASSRLS),
  `fxl_finders_admin` (LOGIN, BYPASSRLS). Idempotent `DO $$ IF NOT EXISTS`.
- `FORCE ROW LEVEL SECURITY` + `*_tenant_isolation` policies on `finders` + `leads`
  using `current_setting('app.current_org_id', true)`.
- Verified post-migrate: `pg_policies` shows both policies; all 3 roles exist with
  correct `rolcanlogin`/`rolbypassrls`; `relforcerowsecurity=t` on finders/leads;
  `audit_log` app grants = SELECT+INSERT only.

### Auth + DB plumbing
- T11 `apps/api/src/middleware/auth.ts`: `clerkAuthMiddleware` (+ `authMiddleware`
  alias), `verifyToken` from `@clerk/backend`, `orgId = org_id ?? sub`, `userRole`
  from `publicMetadata?.role`, `ContextVariableMap` augmented (D-B). No
  `users.getUser()` in request path. `setTenantContext(tx, orgId)` takes a tx
  handle, imports `{ sql }`, typed via `PgTransaction` (D-D).
- T11b `apps/api/src/lib/clerk.ts`: `clerkClient = createClerkClient({ secretKey })` (D-I).
- T09b `apps/api/src/db/client.ts`: added `getAdminDb()` (lazy, BYPASSRLS conn);
  `getDb()` unchanged; `closeDb()` tears down both; no singleton/`db/index.ts` (D-C/D-H).
  `ADMIN_DATABASE_URL` added to `src/env.ts`.
- `apps/api/src/middleware/require-admin.ts`: `requireAdmin` gating
  `c.get('userRole')==='admin'` — Phase 01 OWNS this single file (D-B); Phases 02/03/05/06 consume it.

### Tests (T12 + T13)
- `apps/api/test/rls/cross-tenant.test.ts`: connects as `fxl_finders_app` (guarded
  against superuser/BYPASSRLS). Positive control + cross-org-zero + WITH CHECK +
  UPDATE path, for finders AND leads. **4 tests pass.**
- `apps/api/test/rls/global-setup.ts`: migrates `TEST_MIGRATE/DATABASE_URL` before
  RLS tests (D-G).
- `apps/api/vitest.config.ts`: unit vs integration split via `VITEST_INTEGRATION`
  flag (Vitest 2.x has no `test.projects`; this is the v2 equivalent — see deviations).
- `test:integration` script added.

### Config / docs (T14)
- `apps/api/.env.dev.example` + `apps/api/.env`: `DATABASE_URL`→app role,
  `ADMIN_DATABASE_URL`→admin role, `MIGRATE_DATABASE_URL`→owner/superuser, Clerk
  custom-claim note (D-B).
- `docs/nexo/decisions/phase01-clerk-config.md`: Clerk dashboard config incl.
  session-token `{ "publicMetadata": "{{user.public_metadata}}" }` claim + DB role split + handoff checklist.

## Gates
- `pnpm --filter @fxl-finders/api type-check` → exit 0
- `pnpm -r type-check` → exit 0 (all 5 buildable projects)
- `pnpm --filter @fxl-finders/api lint` → exit 0 (after fixing pre-existing missing deps — see deviations)
- `pnpm --filter @fxl-finders/api test` (unit) → exit 0 (empty suite, passWithNoTests)
- `pnpm --filter @fxl-finders/api test:integration` (RLS) → 4/4 pass
- Money-column grep: `numeric` only on `*_rate_pct`; no `_brl`/float money column
- No `any` in modified TS

## Deviations / autopilot decisions
1. **Vitest config form.** PLAN used `test.projects` (Vitest 3+ API); installed
   vitest is 2.1.9. Used a `VITEST_INTEGRATION` env-flag split in a single
   `vitest.config.ts` (v2-compatible equivalent). All acceptance criteria met:
   unit run excludes `test/rls/**` + no globalSetup; integration run includes only
   `test/rls/**` + globalSetup; separate scripts.
2. **`passWithNoTests` on unit project.** Phase 01 ships only RLS integration
   tests; the unit suite is empty. Added `passWithNoTests: true` so the gate / CI
   doesn't fail on zero unit files.
3. **Pre-existing lint toolchain defect (recoverable, fixed).** `apps/api/eslint.config.js`
   imported `@eslint/js` + `typescript-eslint`, neither of which was in
   `apps/api/package.json` — lint could never run in the template. Added
   `@eslint/js@^9.21.0` (matches api's eslint 9) + `typescript-eslint@^8.58.0`
   (matches web/site) as devDeps; `pnpm install`; lint now exits 0.
4. **`MIGRATE_DATABASE_URL` in migrate script.** First migrate must CREATE ROLE /
   CREATE POLICY (needs superuser), but runtime `DATABASE_URL` targets the
   unprivileged app role. `scripts/migrate.ts` now prefers `MIGRATE_DATABASE_URL`
   (owner/superuser) and falls back to `DATABASE_URL`. Mirrors the dev-vs-staging
   role split (D-C/D-G).
5. **Cleanup via owner connection in RLS test.** App role has no DELETE grant
   (per T09), so test rows are cleaned via the owner/superuser connection rather
   than granting DELETE to the app role (plan offered either option).

## Handoff items
- Clerk session-token custom claim `{ "publicMetadata": "{{user.public_metadata}}" }`
  MUST be set in the dashboard before any admin login works (D-B).
- Staging/prod: `DATABASE_URL`→`fxl_finders_app`; migrations as owner; `ADMIN_DATABASE_URL`→`fxl_finders_admin` (D-C).
- Phases 02/03 consume `requireAdmin` (delete any local admin guard) and `clerkClient` singleton.

## Files changed
- `apps/api/src/db/schema.ts`
- `apps/api/src/db/client.ts`
- `apps/api/src/env.ts`
- `apps/api/src/middleware/auth.ts`
- `apps/api/src/middleware/require-admin.ts` (new)
- `apps/api/src/lib/clerk.ts` (new)
- `apps/api/scripts/migrate.ts`
- `apps/api/drizzle/0000_fancy_klaw.sql` (new, generated + appended) + `meta/` (new)
- `apps/api/vitest.config.ts` (new)
- `apps/api/test/rls/cross-tenant.test.ts` (new)
- `apps/api/test/rls/global-setup.ts` (new)
- `apps/api/package.json` (test:integration script + eslint devDeps)
- `apps/api/.env`, `apps/api/.env.dev.example`
- `docs/nexo/decisions/phase01-clerk-config.md` (new)
- `pnpm-lock.yaml`
