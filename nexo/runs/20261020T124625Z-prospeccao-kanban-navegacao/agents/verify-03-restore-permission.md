# Verify 03-restore-permission

Result: **PASS**.
Commit: `704dba44486b70bbb7ef32717f4f92a5fa00f0e6`.

## Evidence

- Confirmed the ignored `apps/api/.env` uses localhost port 5006 for `TEST_DATABASE_URL`, `ADMIN_DATABASE_URL`, and `TEST_MIGRATE_DATABASE_URL` before database work.
- `NODE_ENV=test pnpm --filter @fxl-sales/api exec vitest run src/domains/sales-ops/leads/__tests__/lead-routes.test.ts`: 17 passed.
- `NODE_ENV=test VITEST_INTEGRATION=1 pnpm --filter @fxl-sales/api exec vitest run test/rls/leads-lixeira.test.ts`: 11 passed against the real test database.
- `NODE_ENV=test pnpm --filter @fxl-sales/api exec vitest run src/domains/sales-ops/leads/__tests__`: 53 passed across five files.
- `pnpm --filter @fxl-sales/api type-check`: passed.
- `pnpm --filter @fxl-sales/api lint`: passed.
- `git diff 704dba4^ 704dba4 --check`: passed.

## Independent review

- The route derives actor ID and admin privilege from verified context.
- `GET /leads/deleted` retains `requireAdmin`.
- The service filters by organization, ID, deleted state, and the deleting user's ID for non-admin callers.
- The same predicate governs the locked read and update within `withTenant`, following the board lock.
- Refused, live, unknown, and cross-organization rows return the existing `not_found` outcome.
- The restore path keeps stage fallback, appended position and renumbering, and the audit write after the board update.
- The real database oracle creates distinct seller-deleted, admin-deleted, and foreign-organization rows, then verifies seller refusal and success plus admin success.
- The real router test exercises seller delete and restore with the app database role and verifies the deleted list remains admin-only.

No blocking findings.
