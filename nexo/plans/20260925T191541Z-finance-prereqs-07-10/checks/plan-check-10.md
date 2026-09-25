# Plan-check: 10-migration-0018-deadlock

## Verdict

PASS, with edits listed below.
The plan is executable as edited.

## 1. Root cause

The lock cycle is real and I reproduced it independently.
I ran the flaky test 8 times serially on master `2f1f406` from the main checkout: 5 of 8 failed, all with `deadlock detected`.
The Docker DB log shows the same cycle as the plan: the traffic INSERT waits for RowShareLock on relation X+44 (`sales_ops_receivables`) while `ALTER TABLE "sales_ops_payables" ADD COLUMN "revision"` waits for AccessExclusiveLock on relation X (`sales_ops_payables`), and in one run the migration was the victim.
`apps/api/drizzle/0024_sales_ops_settlements.sql:59-64` alters receivables (three statements) and then payables inside one transaction, as claimed.
`apps/api/src/db/migration-runner.ts:596-604` runs each ordinary migration plus its journal INSERT in one `runCheckedTransaction` with no `lock_timeout` and no retry, as claimed.
`migration-runner.ts:301-313` (`runLockBoundedPhase`) hard-codes `SET lock_timeout = '5s'`, as claimed.
The test's traffic loop (`professional-payable-migration.integration.test.ts:603-634`) holds AccessShare on payables (`SELECT count(*)`) and then INSERTs a payable whose RI trigger opens receivables with RowShareLock; `runDatabaseMigrations` is called with no `throughTag` (line 637) and traffic stops only in the `finally`, so it runs through 0019-0024.
0018 itself is not the culprit: its indexes are CONCURRENTLY, its backfill is `FOR UPDATE ... SKIP LOCKED`, and its column and constraint steps are single autocommit statements.

## 2. Fix soundness

`SET LOCAL lock_timeout = floor(deadlock_timeout/2)` makes the migration's lock wait end before either party's deadlock check, so the migration leaves the cycle and the live transaction proceeds; this is a fix, not a weakening, because live traffic is never retried and its errors still fail the test.
The ordinary-migration retry is safe: every ordinary migration's statements and journal INSERT share one transaction that `withReservedTransaction` rolls back fully before rethrowing, so a retry starts from nothing and an incomplete migration is never journaled.
No ordinary migration contains `CONCURRENTLY`, `COMMIT` or its own `lock_timeout` (grep over `apps/api/drizzle/*.sql` finds `CONCURRENTLY` only in 0018).
The 0018 `column` step is `ADD COLUMN IF NOT EXISTS` and the `constraint` step runs only while `constraintExists` is false; both are single autocommit statements, so a 55P03 leaves nothing behind and the retry is idempotent.
Already-committed 0018 phases are not re-run: the retry wraps only the failing step, and the concurrent index, backfill and validate steps are untouched.
`SET LOCAL` scope is the migration transaction and reverts on COMMIT or ROLLBACK; the phased steps keep session-level `SET` plus `RESET` in `finally`.
`AggregateError` from a failed ROLLBACK has no `code` and is rethrown on the first attempt.
The advisory lock is session-level and is held across retries and released in the runner's `finally`.
`deadlock_timeout < 2` is rejected, which prevents `lock_timeout = 0` (no timeout).
Production applies the fix: `apps/api/Dockerfile` CMD runs `node dist/db/migrate.js`, which calls `runDatabaseMigrations` (`apps/api/src/db/migrate.ts:55`), and `docker-migration-contract.test.ts` pins that wiring.
`production` has migrations only through 0021 (`git ls-tree production apps/api/drizzle`), so the plan's claim that 0024 is not yet shipped holds.
Residual risk (a slow statement between two lock acquisitions) is named and documented.

## 3. Acceptance and oracles

The flaky test stays unchanged and still proves resumable phased upgrade of populated forced-RLS data with traffic running, now across 0019-0024 too.
The repetition oracle (30/30 serial, 21/21 in 7 rounds of 3) and the deterministic inversion oracle (`yields its locks instead of deadlocking ...`, red on base) are named.
Gap found: acceptance 1 (the value is DERIVED from `pg_settings.deadlock_timeout`) had no direct oracle; a hard-coded `500ms` would have passed every test on a default server.
Gap found: acceptance 4 (advisory lock released) was not asserted by the budget oracle.
Both gaps are closed by the edits below.
I confirmed on the local Docker DB that `ALTER DATABASE ... SET deadlock_timeout = '1400ms'` is visible in `pg_settings` of a new session and that `SET LOCAL lock_timeout = '700ms'` reads back as `700ms`.

## 4. files_modified and depends_on

`files_modified` is an inline array of three paths: `apps/api/src/db/migration-runner.ts`, the integration test, and the new decision record.
It is disjoint from slices 07, 08 and 09 (their files are under `apps/api/src/domains/sales-ops`, `apps/api/src/middleware`, `apps/web`, `CLAUDE.md` and the three reference docs).
`depends_on: []` is sane.

## 5. CLAUDE.md rules

The plan never runs `db:migrate`, touches no guarded entrypoint, uses run-once vitest, edits no migration SQL or journal, and names the scratchpad for temp files.
No existing doc states the `5s` value or a migration lock rule (grep over `nexo/knowledge`, `CLAUDE.md`), so no doc goes stale; the new rule lives in a decision record, and D6 defers a CLAUDE.md pointer to Capture to keep the slice disjoint from slice 07, which is acceptable.
Gap found: the slice worktree has no `node_modules` and no `apps/api/.env`, and `test/rls/setup-env.ts` falls back to `DATABASE_URL` when `TEST_DATABASE_URL` is absent, so the integration runs needed an explicit local-pin preflight.

## Edits made to the plan

1. Acceptance: the budget oracle now also requires a follow-up `runDatabaseMigrations` with `advisoryLockMaxAttempts: 1` to succeed, journal 2 rows and create both columns (advisory lock released, failure resumable); Appendix B's budget test carries the matching code.
2. Acceptance and Oracles: added a third new oracle, `derives the migration lock_timeout from the server deadlock_timeout` (scratch DB `deadlock_timeout = 1400ms`, probe migration records `700ms`), specified in a new Appendix C.
3. Acceptance: "both new oracles fail on base" became "all three"; the RED command's `-t` filter and steps 1 and 3 were updated to match.
4. Acceptance: the integration test count became "269 at base 2f1f406 plus the 3 new = 272; any other count must be explained by another merged slice".
5. Implementation step 0 (worktree preflight): `pnpm install --frozen-lockfile`, copy `apps/api/.env`, confirm both `TEST_*` URLs point at `localhost:5006` before any integration run, and never commit the copy.
6. Decision record content: added the deploy failure mode (migrate exits non-zero before `server.js`, nothing journaled, next start resumes).
