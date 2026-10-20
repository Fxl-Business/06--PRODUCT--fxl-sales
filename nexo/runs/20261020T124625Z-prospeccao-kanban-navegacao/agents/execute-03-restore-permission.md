# Execute 03 - restore permission

## Verdict

Implementation complete, awaiting separate Verify.
The real DB RLS oracle could not run because the configured local Postgres at `localhost:5006` refused connections.

## Changes

- The restore route now accepts sellers, passes the verified actor and admin role to the service, and keeps the deleted list admin-only.
- The service filters both the locked read and update by deleting user for non-admin callers, while retaining the organization and deleted predicates.
- Route and RLS tests cover seller ownership, admin restore, denied IDs, live rows, cross-organization rows, and existing restore behavior.

## Test first and verification

- Route test failed red with `expected 403 to be 200` before implementation.
- Route oracle passed: 17 tests.
- Affected lead unit suite passed: 53 tests across 5 files.
- API typecheck passed.
- API lint passed.
- `git diff --check` passed.
- RLS oracle was invoked with the repository's documented local-only DB URLs, verified to target `localhost:5006/fxl_sales`, and failed in the pre-migration test-role check with `ECONNREFUSED`.
- The local Docker daemon was unavailable, and no database migrations ran.

## Decision and review

- Keep this slice as implementation complete with the RLS gate unresolved.
- Revisao: start the local test Postgres and rerun `VITEST_INTEGRATION=1 pnpm --filter @fxl-sales/api exec vitest run test/rls/leads-lixeira.test.ts` using the documented local-only URLs before Gate 2 can pass.
