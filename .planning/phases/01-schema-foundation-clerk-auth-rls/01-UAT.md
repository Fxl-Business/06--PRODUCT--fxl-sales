---
phase: 01-schema-foundation-clerk-auth-rls
status: passed
mode: automated (backend-only phase; no human-interactive UI to converse-test; autopilot)
verified_at: 2026-05-28
verdict: PASS
tests_total: 19
tests_passed: 19
tests_failed: 0
---

# Phase 01 — Verification (UAT)

**Mode:** Phase 01 is backend-only (schema + DB roles + RLS + Clerk auth middleware).
There is no UI and no human in the loop (autopilot). Verification was performed by
executing each acceptance criterion against the actual built artifacts and the live
Docker Postgres (port 5006), not by conversational UI testing.

**Verdict: PASS** — all 19 checks green. RLS integration suite (the load-bearing
security gate) passes connecting as the unprivileged `fxl_finders_app` role.

## Results

| # | Check (acceptance criterion) | Decision | Method | Result |
|---|------|------|------|------|
| 1 | 9 foundation tables defined in schema.ts | — | `grep -c '= pgTable('` → 9; DB `pg_tables` → 9 | ✅ PASS |
| 2 | No LGPD consent columns on finders (owned by Phase 03) | x-phase #5 | grep — only the `leads` comment matched | ✅ PASS |
| 3 | Composite indexes leading on org_id (finders, leads) | D-R | `finders_org_id_idx` + `leads_org_id_idx` present | ✅ PASS |
| 4 | Money = integer cents; rates = numeric(5,2) | — | grep `numeric` in .sql → only `*_rate_pct`; no `_brl` | ✅ PASS |
| 5 | Migration generated + journaled (single entry) | — | `0000_fancy_klaw` in `_journal.json` | ✅ PASS |
| 6 | Role grants + RLS APPENDED into journaled file (not standalone) | D-F | only one `.sql`; contains `CREATE POLICY` + `GRANT … fxl_finders_app` | ✅ PASS |
| 7 | After migrate: pg_policies shows both *_tenant_isolation | D-F | `SELECT … pg_policies` → finders + leads (ALL) | ✅ PASS |
| 8 | FORCE RLS on finders+leads only | — | `relforcerowsecurity=t` finders/leads; `f` apps/sellers | ✅ PASS |
| 9 | 3 roles exist w/ correct attrs | D-C/D-G | owner (no login), app (LOGIN, no bypass), admin (LOGIN, BYPASSRLS) | ✅ PASS |
| 10 | audit_log app grants = SELECT+INSERT only (append-only) | — | `role_table_grants` → SELECT, INSERT | ✅ PASS |
| 11 | Auth exported as clerkAuthMiddleware + authMiddleware alias | D-B | grep both exports present | ✅ PASS |
| 12 | verifyToken called; userRole from publicMetadata?.role; ContextVariableMap augmented | D-B | grep confirms all three | ✅ PASS |
| 13 | NO clerkClient.users.getUser() in request path | D-B | only a doc-comment mention; no call | ✅ PASS |
| 14 | setTenantContext(tx, orgId) takes tx handle, imports sql, not any/unknown | D-D | `PgTransaction` param, `import { sql }`, no any/unknown | ✅ PASS |
| 15 | getAdminDb() + getDb() lazy; ADMIN_DATABASE_URL in env; no db singleton/index.ts | D-C/D-H | both getters present; no `db/index.ts`; env has ADMIN_DATABASE_URL | ✅ PASS |
| 16 | clerkClient via createClerkClient({ secretKey }) | D-I | `lib/clerk.ts` confirmed; named export only | ✅ PASS |
| 17 | requireAdmin single-file owner reading userRole==='admin' | D-B | `middleware/require-admin.ts` confirmed | ✅ PASS |
| 18 | RLS tests: as fxl_finders_app (guarded) + positive control + cross-org-zero + WITH CHECK + UPDATE path, finders+leads | D-G | `pnpm test:integration` → 4/4 pass; superuser/BYPASSRLS guard present | ✅ PASS |
| 19 | globalSetup migrates TEST DB before RLS tests; unit run excludes test/rls | D-G | global-setup.ts migrates; `pnpm test` → 0 RLS files, exit 0 | ✅ PASS |

## Gate command results

- `pnpm --filter @fxl-finders/api type-check` → exit 0
- `pnpm -r type-check` → exit 0 (5 buildable projects)
- `pnpm --filter @fxl-finders/api lint` → exit 0 (after fixing pre-existing missing eslint deps)
- `pnpm --filter @fxl-finders/api test` (unit) → exit 0 (empty suite, passWithNoTests)
- `pnpm --filter @fxl-finders/api test:integration` (RLS) → 4 passed (4)

## Gaps / follow-ups

None blocking. Operational handoff items (not code gaps):
- Clerk session-token custom claim `{ "publicMetadata": "{{user.public_metadata}}" }` must be configured in the dashboard before admin login works in staging/prod (D-B). Documented in `docs/nexo/decisions/phase01-clerk-config.md`.
- Staging/prod DB role split (runtime app role, owner migrations, admin BYPASSRLS) per D-C.

## Notes

- Deviations from PLAN (vitest v2 config form, `passWithNoTests`, pre-existing
  lint dep fix, `MIGRATE_DATABASE_URL`) are documented in `01-SUMMARY.md` and do not
  affect any acceptance criterion — all original criteria are still met.
