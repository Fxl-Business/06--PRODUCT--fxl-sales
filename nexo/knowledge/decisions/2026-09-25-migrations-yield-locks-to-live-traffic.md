# Migrations yield their table locks to live traffic instead of waiting or deadlocking

**Date:** 2026-09-25
**Surfaced by:** slice `10-migration-0018-deadlock` of run `20260925T191541Z-finance-prereqs-07-10`

## Rule

Every lock-taking migration unit in `apps/api/src/db/migration-runner.ts` runs with `lock_timeout = floor(deadlock_timeout / 2)` milliseconds.
The value is read from `pg_settings.deadlock_timeout` on the migration backend at the start of every run, never hard-coded.
An ordinary migration sets it with `SET LOCAL` inside its own transaction, and the phased 0018 `column` and `constraint` steps set it at session level around their single statement (they used a hard-coded `5s` before).
A unit that fails with SQLSTATE `55P03` (lock_not_available) or `40P01` (deadlock_detected) is rolled back and retried whole, up to `lockContentionMaxAttempts` (default 50) with `lockContentionRetryMs` (default 200 ms) between attempts.
Any other error, including an `AggregateError` from a failed `ROLLBACK`, is rethrown on the first attempt.
When the budget is exhausted the run rejects with `migration <tag> could not acquire its locks after <n> attempts` (cause: the last lock error), releases the advisory lock, and journals nothing of the contended migration.
Live traffic is never retried and never masked; only the migration yields its own rolled-back work.
No migration may run without that bound.

## Root cause

The failure was reported as a "migration 0018 deadlock" because the flaky test is the 0018 phased-migration test, but 0018 is not the culprit.
The test `upgrades populated forced-RLS data in resumable phases while traffic continues` runs every migration with no `throughTag` while its traffic loop keeps running, so it also applies 0019 through 0024.
Migration `0024_sales_ops_settlements` alters `sales_ops_receivables` (AccessExclusiveLock, held to commit) and then `sales_ops_payables` (AccessExclusiveLock requested), in one transaction.
The traffic transaction reads `sales_ops_payables` (AccessShareLock, held) and then inserts a payable, whose foreign key trigger opens `sales_ops_receivables` with RowShareLock before its NULL check, so even a NULL `receivable_id` takes that lock.
Each side waits for the other, and after `deadlock_timeout` Postgres aborts whichever process's deadlock check fires first.

Traffic as the victim:

```
ERROR:  deadlock detected
DETAIL:  Process 337501 waits for RowShareLock on relation 532621 of database 532229; blocked by process 337502.
	Process 337502 waits for AccessExclusiveLock on relation 532577 of database 532229; blocked by process 337501.
	Process 337501: INSERT INTO sales_ops_payables (org_id, sale_id, beneficiary_name, kind, due_date, amount_brl, status) VALUES ($1, $2, $3, 'other_cost', now(), 1, 'open') RETURNING id
	Process 337502: ALTER TABLE "sales_ops_payables" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;
```

The migration as the victim, which fails the migration run itself:

```
ERROR:  deadlock detected
DETAIL:  Process 337763 waits for AccessExclusiveLock on relation 541137 of database 540789; blocked by process 337762.
	Process 337762 waits for RowShareLock on relation 541181 of database 540789; blocked by process 337763.
	Process 337763: ALTER TABLE "sales_ops_payables" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;
	Process 337762: INSERT INTO sales_ops_payables (...) 'other_cost' ...
STATEMENT:  ALTER TABLE "sales_ops_payables" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;
```

In every captured cycle the RowShareLock relation is `sales_ops_receivables` and the AccessExclusiveLock relation is `sales_ops_payables`.
This is not a test artefact.
Any production request that touches payables and then receivables in one transaction (a tenant read of both, any payable write through the receivable FK, a won `PUT /sales/:id` reconcile) forms the same cycle while the API migrates before startup against a database the previous release still serves.
Even without a cycle, an ordinary migration waiting for AccessExclusiveLock with no `lock_timeout` queued every later request on that table behind it for as long as the blocker lived.

## Why a lock_timeout below deadlock_timeout

The deadlock detector only runs after a process has waited `deadlock_timeout`.
If the migration's own wait always ends before that, with `55P03`, the migration leaves the cycle first and the live transaction proceeds, so no live request can be chosen as the victim.
Deriving the value from the server keeps the inequality true on any configuration: the default of 1000 ms here and on RDS gives 500 ms.
A value below 2 ms is refused, because `floor(1 / 2)` would be `0`, which means no timeout at all.

## Why the retry is safe

An ordinary migration's statements and its journal INSERT share one transaction that `withReservedTransaction` rolls back fully before rethrowing, so a retry starts from nothing and an incomplete migration is never journaled.
No ordinary migration contains `CONCURRENTLY`, `COMMIT` or its own `lock_timeout`.
Each 0018 lock-bounded phase is a single autocommit statement (`ADD COLUMN IF NOT EXISTS`, and `constraint` runs only while `constraintExists` is false), so a retry is idempotent.
Committed 0018 phases are never re-run: the retry wraps only the failing step.
The advisory lock is session-level, is held across retries, and is released in the runner's `finally`.

## Alternatives rejected

Reordering the statements inside 0024 does not help: traffic takes these two tables in both orders (payables then receivables on reads and FK checks, receivables then payables when materializing a won proposta), so any single order deadlocks with one of them.
Editing 0024 at all is also wrong because its hash is already applied in every local database.
Stopping the test's traffic at 0018's journal row would hide the defect in the test while leaving it in every deploy.
The test's traffic stays exactly as it was and now proves strictly more: no traffic error across the whole upgrade, 0018 and 0019 to 0024.

## Deploy failure mode

The container's `CMD` runs `node dist/db/migrate.js`, which calls `runDatabaseMigrations`, before `server.js` starts.
When the budget is exhausted (about 35 s of continuous contention at the defaults), migrate exits non-zero, nothing of the contended migration is journaled, and the next start resumes from the journal.
Before this change the same contention either deadlocked (failing a user request or the deploy) or waited without bound while queueing all traffic on the table.
`production` held migrations only through 0021 when this landed, so the 0024 cycle never shipped.

## Residual risk

The guarantee is that the migration's wait is shorter than the other party's deadlock check.
If a migration spends longer than `lock_timeout` executing between acquiring table A and requesting table B (for example a long CHECK scan on a large table) while traffic already waits on A, the traffic's own deadlock check can still fire first.
Authors of future multi-table migrations whose statements between two lock acquisitions scan a large table should take every lock up front, with `LOCK TABLE ... IN ACCESS EXCLUSIVE MODE` as the first statement.

## Oracles

All in `apps/api/test/rls/professional-payable-migration.integration.test.ts`, describe `phased professional payable identity migration`.

- `yields its locks instead of deadlocking when live traffic takes them in the opposite order` reproduces the inversion deterministically; on the base runner it failed with `deadlock detected`.
- `stops after the lock contention budget and never journals the contended migration` asserts the loud failure, the empty journal and DDL, and a clean resume with `advisoryLockMaxAttempts: 1`; on the base runner it timed out at 30 s.
- `derives the migration lock_timeout from the server deadlock_timeout` sets the scratch database's `deadlock_timeout` to `1400ms` and expects `700ms` inside the probe migration; on the base runner it read `0`.
- The unchanged `upgrades populated forced-RLS data in resumable phases while traffic continues` is the repetition oracle.
  Base: 6 failures in 20 serial runs and 12 failures in 21 runs of 7 rounds of 3 concurrent processes, all `40P01`.
  Fixed: 0 failures in 30 serial runs and 0 in 21 concurrent runs, with 0 `deadlock detected` in the server log and 52 `canceling statement due to lock timeout`, all on `ALTER TABLE "sales_ops_payables" ADD COLUMN "revision"`, which shows the yield path running about once per run.
