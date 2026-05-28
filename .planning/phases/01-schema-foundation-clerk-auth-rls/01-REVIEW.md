---
phase: 01-schema-foundation-clerk-auth-rls
depth: standard
reviewed_at: 2026-05-28
verdict: PASS (no Critical, no Warning)
findings_critical: 0
findings_warning: 0
findings_info: 2
---

# Phase 01 — Code Review

**Scope (files changed this phase):**
`apps/api/src/db/schema.ts`, `apps/api/src/db/client.ts`, `apps/api/src/env.ts`,
`apps/api/src/middleware/auth.ts`, `apps/api/src/middleware/require-admin.ts`,
`apps/api/src/lib/clerk.ts`, `apps/api/scripts/migrate.ts`,
`apps/api/drizzle/0000_fancy_klaw.sql`, `apps/api/vitest.config.ts`,
`apps/api/test/rls/*.ts`, `apps/api/package.json`, env files.

**Verdict: PASS.** No Critical or Warning findings. Two Info notes for downstream phases.

## Security review (RLS — the load-bearing concern)

Validated empirically against the live DB as the unprivileged `fxl_finders_app` role:

- **Fail-closed with no tenant context:** with `app.current_org_id` unset,
  `current_setting('app.current_org_id', true)` returns NULL and the policy
  predicate `org_id = NULL` is NULL → **0 rows visible** (including real-org rows).
  Verified: a row with `org_id='org_real_X'` is invisible when no context is set. ✅
- **Correct isolation with context:** context = `org_real_X` → exactly that 1 row;
  cross-org context → 0 rows; cross-org UPDATE → 0 rows affected; WITH CHECK blocks
  cross-org INSERT. (All four covered by the passing integration suite.) ✅
- **FORCE RLS** is on, so even the table owner is subject to the policy; only the
  dedicated `fxl_finders_admin` BYPASSRLS role spans tenants (D-C). ✅
- **`verifyToken` usage:** confirmed `@clerk/backend` v1.x `verifyToken` resolves to
  the JWT payload (so `payload.sub` / `payload.org_id` / `payload.publicMetadata`
  access is type-correct — full `tsc --noEmit` exits 0). ✅
- **No `users.getUser()` in the request path** — role is read from the verified JWT
  claim only (D-B). ✅

## Findings

### INFO-1 — Pre-approval finders share `org_id=''` visibility (Phase 03 concern)
`finders.org_id` is `''` for pending finders before admin approval (by design,
plan-brief x-phase #2). RLS treats `''` as a literal tenant key: if a session ever
presented `orgId=''`, it would see ALL pending finders. In v1.0 this cannot happen —
a finder has no Clerk session until approval (when a real `org_id` is assigned), and
all pre-approval reads go through the admin BYPASSRLS connection. **No Phase 01
action.** Phase 03 (approve flow) should keep pre-approval reads on `getAdminDb()`
and never call `setTenantContext('')`. Recorded here so Phase 03 is aware.

### INFO-2 — `audit_log` app role lacks DELETE (intentional); RLS test cleans via owner conn
The `fxl_finders_app` role is granted SELECT/INSERT/UPDATE on tenant tables but no
DELETE (audit_log is INSERT/SELECT only). The RLS integration test therefore cleans
its rows via the owner/superuser connection rather than the app role. This is the
intended append-only posture and the plan-sanctioned cleanup path; no change needed.

## Quality / contract checks

- Named exports only; no default exports. ✅
- Strict TS, no `any`/`unknown` in modified files (`setTenantContext` typed via
  `PgTransaction`, not loosened). ✅
- Money columns are `integer` cents; only `*_rate_pct` are `numeric(5,2)`. ✅
- `getDb()`/`getAdminDb()` lazy; no `db` singleton, no `db/index.ts` (D-H). ✅
- RLS + grants live inside the journaled migration (D-F); idempotent role creation. ✅
- ESLint passes on `src/` after adding the two missing devDeps the template lint
  config required (`@eslint/js`, `typescript-eslint`) — a genuine pre-existing
  toolchain fix, scoped and version-aligned with the rest of the monorepo.

## Auto-fix

No Critical/Warning findings → nothing to auto-fix. Both Info items are intentional
designs / downstream-phase notes, not defects.
