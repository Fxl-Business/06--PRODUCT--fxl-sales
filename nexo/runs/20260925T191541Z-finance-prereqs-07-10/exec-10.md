# Exec 10 - migration 0018 deadlock (migration vs live traffic)

Branch `feat/20260925-10-migration-0018-deadlock`, base master `e8ea0b9`, head `ca69c31`.
Worktree `.worktrees/20260925T191541Z-finance-prereqs-07-10/10-migration-0018-deadlock`.

## Commits

- `9d67853` fix(db): migrations yield table locks to live traffic and retry
- `e1dcaae` test(db): oracles for migration lock yielding, budget and lock_timeout derivation
- `861da64` test(db): make the ordinary-commit probe callback return void
- `ca69c31` docs(nexo): record why migrations yield their table locks to live traffic

## Files

- `apps/api/src/db/migration-runner.ts`
- `apps/api/test/rls/professional-payable-migration.integration.test.ts`
- `nexo/knowledge/decisions/2026-09-25-migrations-yield-locks-to-live-traffic.md`

Exactly the plan's `files_modified`; no `.env`, nothing under `nexo/runs/` or `nexo/plans/` committed.

## Preflight

`TEST_DATABASE_URL` and `TEST_MIGRATE_DATABASE_URL` in the worktree's `apps/api/.env` both point at `localhost:5006`.
`db:migrate` was never run.

## RED (base runner, tests added, runner unchanged)

`CI=true VITEST_INTEGRATION=1 npx vitest run test/rls/professional-payable-migration.integration.test.ts -t "opposite order|contention budget|derives the migration lock_timeout"`: 3 failed, 9 skipped.

- `yields its locks instead of deadlocking ...`: `PostgresError: deadlock detected` (1258 ms).
- `stops after the lock contention budget ...`: `Test timed out in 30000ms`.
- `derives the migration lock_timeout ...`: `expected [ { value: '0' } ] to deeply equal [ { value: '700ms' } ]`.

All three fail for the reasons the plan predicts.

## GREEN

Runner changed per Appendix A with the two step-2 refinements.

- `retryOnLockContention` validates `maxAttempts` (positive integer) and `retryMs` (non-negative integer) with the messages `lock contention max attempts must be a positive integer` and `lock contention retry interval must be a non-negative integer`.
- The prototype's `session` / `sessionPid` aliases are replaced by a helper `runOrdinaryMigration(reserved, backendPid, migration, options, lockTimeoutMs)` with non-optional parameters; behaviour identical.
- Comments above `migrationLockTimeoutMs` (why below `deadlock_timeout`) and `retryOnLockContention` (what is retried, what is rethrown).

Whole migration file plus `settlements-schema-migration.test.ts`: 16 of 16 passed (12 + 4).

## Repetition oracle (the unchanged flaky test)

- Serial: 0 failures in 30 runs (base 6 in 20).
- Concurrent: 0 failures in 21 runs, 7 rounds of 3 processes, each waited on by PID (base 12 in 21).
- Docker DB log since the start of the loops: 0 `deadlock detected`, 52 `canceling statement due to lock timeout`, all 52 on `ALTER TABLE "sales_ops_payables" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;` (the 0024 statement), so the yield-and-retry path ran about once per run.

## Suite gates

- `CI=true pnpm --filter @fxl-sales/api test:integration`: 35 files, 272 of 272 passed (plan expected 272 = 269 + 3).
- `pnpm --filter @fxl-sales/api exec vitest run src/db src/config/__tests__/docker-migration-contract.test.ts`: 5 files, 33 passed.
- `CI=true pnpm test`: auth-fake 35, shared-utils 155, api 678, web 998, scripts guard 55 pass / 0 fail.
- `pnpm run lint`: clean. `eslint` on both changed TS files: clean (the api `lint` script covers only `src/` and `scripts/`, so the test file was linted explicitly).
- `pnpm run type-check`: clean.

## Decisions and findings

- The api `tsconfig.json` includes only `src/**/*`, so `test/` is never type-checked.
  An ad-hoc `tsc` over the test file (throwaway config in the session scratchpad, extending the api tsconfig) found a PRE-EXISTING error at the `commits and rolls back ordinary migrations` test: `onPhaseComplete: (event) => events.push(event)` returns a number against a `void | Promise<void>` callback.
  Fixed in its own commit `861da64` (block body); that test was rerun green and the file now type-checks clean.
  The full integration run happened before this one-line type-only fix; the changed test was rerun alone afterwards.
  Follow-up worth filing: nothing type-checks `apps/api/test/**`.
- The existing flaky test, its traffic loop, `lock_timeout` and assertions are untouched; no `throughTag` added; no `drizzle/*.sql` or journal edit; no retry or `40P01` catch in test code.
- CLAUDE.md and the reference docs were not edited (plan D6); Capture may add a one-line pointer.

## Processes

Every vitest run was run-once (`vitest run`, `CI=true`); the concurrent loop waited on each PID; no process started by this slice is left running.
