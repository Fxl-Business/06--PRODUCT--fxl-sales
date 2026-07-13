# Production Migrations Before API Startup

## Mode

Hotfix autopilot.
Gate 1 was skipped because the user explicitly approved autopilot.
Gate 2 was performed by a separate verifier.
Gate 3 was explicitly approved by the user on 2026-07-13.

## Symptom

Production returned PostgreSQL `42P01` from `GET /api/v1/sales-ops/bootstrap` because relation `sales_ops_sales` did not exist.
The web client showed repeated failed bootstrap activity while the API remained unavailable.
Code inspection found no document reload call in this failure path.

## Root Cause

The API runtime image copied `apps/api/dist` but omitted `apps/api/drizzle`.
The migration runner lived outside the API compiler's `src/**/*` input and therefore had no compiled runtime entrypoint.
The container started `dist/server.js` directly, allowing application code to run against an outdated schema.

## RED

Added `apps/api/src/config/__tests__/docker-migration-contract.test.ts` to require a buildable migration runner, runtime migration files, and fail-fast migration-before-server startup.
The focused test failed because `apps/api/src/db/migrate.ts` did not exist.

## GREEN

Moved the runner to `apps/api/src/db/migrate.ts`, updated `db:migrate` to use it, copied `apps/api/drizzle` into the runtime image, and changed startup to `node dist/db/migrate.js && exec node dist/server.js`.
The focused contract test passed, the API build produced `apps/api/dist/db/migrate.js`, and an empty-`DATABASE_URL` execution exited before the server started.

## Gate 2

Independent verifier verdict: PASS.

- Focused Docker migration contract: 1 test passed.
- Full repository suite: API 153 tests, web 31 tests, and shared-utils 17 tests passed.
- Workspace lint, typecheck, and production builds passed.
- `pnpm audit --prod` reported no known vulnerabilities.
- `git diff --check` passed.
- Migration journal inspection confirmed `0007_marvelous_valeria_richards`, whose SQL creates `sales_ops_sales`.
- Failure-path execution confirmed a migration error prevents API server startup.

Verifier report: `nexo/runs/20260712-2117-prod-migrations/agents/verify-report.md`.

## Docker E2E Limitation

The fresh-Postgres production-image E2E was not run because the configured OrbStack Docker daemon was unavailable.
No container, server, watcher, or other persistent process was started.
Gate 2 passed based on the contract test, compiled artifact, checked-in migration contents, startup ordering, and failure-path execution.

## Files Changed

- `apps/api/Dockerfile`
- `apps/api/package.json`
- `apps/api/scripts/migrate.ts` (removed)
- `apps/api/src/db/migrate.ts`
- `apps/api/src/config/__tests__/docker-migration-contract.test.ts`
- `nexo/plans/20260712-prod-migrations.md`
- `nexo/runs/20260712-2117-prod-migrations/`
- `nexo/knowledge/decisions/2026-07-12-api-migrates-before-startup.md`

Unrelated user files under `.vscode/` and `nexo/knowledge/doubts/20260707-missing-entitlement.md` were not touched.

## Delivery State

Fix commit `60e333a` was merged to `master` as `6ef8792` and pushed.
Release `v2.0.3` tags `6ef8792`.
The same commit was fast-forwarded to `production` and then `staging`.
