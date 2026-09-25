# Verify 10-migration-0018-deadlock (a1)

Verdict: PASS.
Commit under test: ca69c31675b8ab3ca4b73d07c6aa92e8c128b7fa (branch feat/20260925-10-migration-0018-deadlock, base master e8ea0b9).
Worktree: .worktrees/20260925T191541Z-finance-prereqs-07-10/10-migration-0018-deadlock.

## Scope and safety

`git diff master...HEAD --name-only` touches only `apps/api/src/db/migration-runner.ts`, `apps/api/test/rls/professional-payable-migration.integration.test.ts` and `nexo/knowledge/decisions/2026-09-25-migrations-yield-locks-to-live-traffic.md`.
No nexo/runs, nexo/plans or .env files in the diff.
`TEST_DATABASE_URL` and `TEST_MIGRATE_DATABASE_URL` in `apps/api/.env` both point at `localhost:5006` (checked host and port only); `db:migrate` was never run.

## 1. Flaky test not weakened

The diff of the test file contains no hunk inside `upgrades populated forced-RLS data in resumable phases while traffic continues`: its traffic loop, `runDatabaseMigrations` without `throughTag`, the `finally` that stops traffic only after the runner returns, and `expect(trafficErrors).toEqual([])` are byte-identical to master.
Other changes: three new tests, three helpers, and one cosmetic change in the `0000_commit_probe` test (`onPhaseComplete` body in braces so the callback returns void; no assertion changed).
Traffic errors are not caught or retried anywhere; the retry exists only inside the migration runner.

## 2. New oracles green on head, red on base

Head: `VITEST_INTEGRATION=1 npx vitest run test/rls/professional-payable-migration.integration.test.ts -t "opposite order|contention budget|derives the migration lock_timeout"` -> 3 passed.
Base runner (`git show master:apps/api/src/db/migration-runner.ts` over the file), same command, exit 1, 3 failed for the right reasons:
- `yields its locks ...` -> `PostgresError: deadlock detected`.
- `stops after the lock contention budget ...` -> 30068 ms test timeout.
- `derives the migration lock_timeout ...` -> `expected [ { value: '0' } ] to deeply equal [ { value: '700ms' } ]`.
Restored with `git checkout -- apps/api/src/db/migration-runner.ts`; `git status --short` empty.

## 3. Repetition oracle (independent)

Command per run: `VITEST_INTEGRATION=1 npx vitest run test/rls/professional-payable-migration.integration.test.ts -t "traffic continues"` from `apps/api`.
- Serial: 20 of 20 passed (exit 0, "1 passed | 11 skipped").
- Concurrent: 5 rounds of 3 processes, 15 of 15 passed.
- Docker log window from 2026-09-25T19:43:30Z: `deadlock detected` count 0; `canceling statement due to lock timeout` count 41, i.e. the yield-and-retry path was exercised in many runs.
Full integration run window: `deadlock detected` count 0.

## 4. Runner review

- Retry only on SQLSTATE 55P03 / 40P01 (`lockContentionCodes`); anything without a string code (including the AggregateError from a failed ROLLBACK) or any other code is rethrown on the first attempt.
- Bounded: `lockContentionMaxAttempts` default 50, `lockContentionRetryMs` default 200, both validated with the file's existing error style; exhaustion throws `migration <tag> could not acquire its locks after <n> attempts` with `cause` = last lock error.
- Whole unit rolled back: ordinary migration statements plus the journal INSERT share one `withReservedTransaction`, which ROLLBACKs before rethrow, so an incomplete migration is never journaled (oracle 2 asserts journal count 1 and no DDL).
- Advisory lock is session-level, acquired once before the loop, held across retries, released in the runner's `finally`; oracle 2's resume with `advisoryLockMaxAttempts: 1` proves release.
- `SET LOCAL lock_timeout` inside the ordinary migration transaction, so it ends with the transaction; the 0018 lock-bounded phases use session `SET` with `RESET` in `finally`, single idempotent autocommit statements (`ADD COLUMN IF NOT EXISTS`; constraint gated by `constraintExists`).
- `deadlock_timeout` read from `pg_settings` on the migration backend once per run, `floor(ms/2)`, guard refuses < 2 ms (would yield 0 = no timeout).
- CONCURRENTLY steps (`ensureConcurrentIndex`) are not wrapped in a transaction or the retry; `grep -il "concurrently|^commit|lock_timeout" drizzle/*.sql` matches only 0018 (phased), confirming no ordinary migration conflicts with the transaction wrapper.
- Production path: `apps/api/src/db/migrate.ts` line 55 calls `runDatabaseMigrations`.

Mutation probes (each restored, tree clean afterwards):
- `SET LOCAL lock_timeout` hard-coded back to `'5s'`: `yields its locks ...` red (`expected 1003 to be less than 1000`, traffic waited past deadlock_timeout), `derives ...` red (`'5s'` vs `'700ms'`).
- Retry removed (always rethrow): `yields its locks ...` red (`canceling statement due to lock timeout`), `stops after the lock contention budget ...` red (wrong error message).

Minor observation, not blocking: `onLockContentionRetry` is also invoked on the final, non-retried attempt; it is a test-only hook and no oracle depends on it.

## 5. Full checks

- `CI=true pnpm --filter @fxl-sales/api test:integration`: exit 0, 35 files, 272 tests passed (269 + 3 new, as expected).
- `CI=true npx vitest run src/db src/config/__tests__/docker-migration-contract.test.ts`: 5 files, 33 tests passed.
- `CI=true pnpm test`: exit 0 (auth-fake 1 file, shared-utils 5, api 63, web 85 test files, node scripts 55 pass 0 fail).
- `pnpm run lint`: exit 0. `npx eslint` on both changed TS files (the api lint script does not cover `test/`): exit 0.
- `pnpm run type-check`: exit 0. The test file is outside the api tsconfig `include`; a scratch tsconfig extending it with the test file included type-checks clean.

## 6. Decision record

`nexo/knowledge/decisions/2026-09-25-migrations-yield-locks-to-live-traffic.md` exists with rule, root cause (with the two server-log excerpts), why the timeout is below deadlock_timeout, retry safety, rejected alternatives, deploy failure mode, residual risk and oracles.
One sentence per line; zero em dashes.

## Cleanup

All processes I started (repetition script, waiters, vitest runs) have exited; the worktree is clean (`git status --short` empty).
