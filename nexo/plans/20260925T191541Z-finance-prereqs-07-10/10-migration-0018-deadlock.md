---
id: 10-migration-0018-deadlock
milestone: v4.1.0
status: done
depends_on: []
files_modified: [apps/api/src/db/migration-runner.ts, apps/api/test/rls/professional-payable-migration.integration.test.ts, nexo/knowledge/decisions/2026-09-25-migrations-yield-locks-to-live-traffic.md]
goal: "Remove the migration-vs-traffic deadlock by making every lock-taking migration step in the shared runner yield (lock_timeout below deadlock_timeout) and retry its whole rolled-back unit a bounded number of times, keeping live traffic running across every migration"
acceptance: ["An ordinary (non-phased) migration runs inside its transaction with SET LOCAL lock_timeout equal to floor(deadlock_timeout / 2) milliseconds, read from pg_settings on the migration backend", "The 0018 phased 'column' and 'constraint' steps use the same derived lock_timeout instead of the hard-coded '5s'", "A migration transaction or lock-bounded phase that fails with SQLSTATE 55P03 or 40P01 is rolled back and retried whole, up to lockContentionMaxAttempts (default 50) with lockContentionRetryMs (default 200) between attempts; any other error is rethrown unchanged on the first attempt", "When the budget is exhausted the runner rejects with 'migration <tag> could not acquire its locks after <n> attempts' (cause = the last lock error), releases the advisory lock, and the contended migration is not journaled and none of its DDL is visible", "New oracle 'yields its locks instead of deadlocking when live traffic takes them in the opposite order' passes: the traffic transaction's blocked statement returns without error in less than deadlock_timeout, the first recorded retry is {attempt: 1, code: '55P03', tag: '0001_lock_order_alter'}, both columns exist and the journal has 2 rows", "New oracle 'stops after the lock contention budget and never journals the contended migration' passes with lockContentionMaxAttempts 3, and after the traffic commits a second runDatabaseMigrations with advisoryLockMaxAttempts 1 succeeds, journals 2 rows and creates both columns (advisory lock released, failure resumable)", "New oracle 'derives the migration lock_timeout from the server deadlock_timeout' passes: with ALTER DATABASE <scratch> SET deadlock_timeout = '1400ms' (run through scratch.admin), a probe ordinary migration records current_setting('lock_timeout') = '700ms' inside its own transaction", "All three new oracles FAIL against the pre-change runner (deadlock detected / 30 s timeout / lock_timeout 0), proven by running them once against the base runner before the runner change", "The existing test 'upgrades populated forced-RLS data in resumable phases while traffic continues' is unchanged, keeps its traffic loop running until runDatabaseMigrations returns (across 0018 AND 0019-0024), and passes 30 of 30 consecutive serial runs plus 21 of 21 runs in 7 rounds of 3 concurrent processes", "CI=true pnpm --filter @fxl-sales/api test:integration passes in full (269 tests at base 2f1f406 plus the 3 new = 272; any other count must be explained by another merged slice) and pnpm --filter @fxl-sales/api exec vitest run src/db src/config/__tests__/docker-migration-contract.test.ts passes", "eslint and tsc --noEmit are clean for the two changed TypeScript files", "nexo/knowledge/decisions/2026-09-25-migrations-yield-locks-to-live-traffic.md records the rule, the root cause and the residual risk"]
---

# 10 - Migration vs live traffic deadlock (reported as "migration 0018 deadlock")

## Context

The flaky test is `apps/api/test/rls/professional-payable-migration.integration.test.ts` > `phased professional payable identity migration > upgrades populated forced-RLS data in resumable phases while traffic continues` (starts at line 587).

What the test does.
- `populateBaseline` migrates a scratch database through `0017_professional_payment_split` and seeds 10000 `professional_cost` payables (lines 213-315).
- A traffic loop (lines 603-634) repeats one transaction per iteration as the NOSUPERUSER owner role with `app.current_org_id` set and `SET LOCAL lock_timeout = '2s'`:
  `SELECT count(*) FROM sales_ops_payables` (AccessShareLock on payables), then `INSERT INTO sales_ops_payables (... 'other_cost' ...)`, then `DELETE` of that row.
- It then calls `runDatabaseMigrations` with NO `throughTag` (line 637), so the runner applies 0018 (phased) AND every later ordinary migration, 0019 through 0024.
- `trafficRunning` is only set to `false` in the `finally` (line 721), i.e. after the runner has finished ALL migrations, so the traffic keeps running through 0019-0024.
- `expect(trafficErrors).toEqual([])` (line 731) fails when a traffic transaction errors.

What the runner does (`apps/api/src/db/migration-runner.ts`).
- Ordinary migrations (lines 596-604): all statements of one migration plus the journal INSERT run in ONE transaction through `runCheckedTransaction`, with NO `lock_timeout` and NO retry.
- The phased 0018 `column` and `constraint` steps use `runLockBoundedPhase` (lines 307-319) with a hard-coded `SET lock_timeout = '5s'` and no retry.
- 0018's indexes are CONCURRENTLY, its backfill uses `FOR UPDATE ... SKIP LOCKED` in bounded batches, and its validate takes ShareUpdateExclusiveLock only, so 0018 itself never holds two conflicting table locks in one transaction.

What migration 0024 does (`apps/api/drizzle/0024_sales_ops_settlements.sql`, lines 59-64), in one transaction:
- `ALTER TABLE "sales_ops_receivables" ADD COLUMN "revision" ...` (AccessExclusiveLock on receivables, HELD to commit), two more receivables statements,
- then `ALTER TABLE "sales_ops_payables" ADD COLUMN "revision" ...` (AccessExclusiveLock on payables).

Relevant schema fact: `sales_ops_payables.receivable_id` has FK `sales_ops_payables_receivable_id_sales_ops_receivables_id_fk` to `sales_ops_receivables` (migration 0011).
Postgres's RI insert trigger opens the referenced table with RowShareLock BEFORE its NULL check, so every INSERT into payables takes RowShareLock on receivables even when `receivable_id` is NULL (as in the test's canary insert).

## Reproduction evidence

All commands from `apps/api` in the main checkout, local Docker DB `06--product--fxl-sales-db-1` on port 5006 (`.env` pins `TEST_*`; `setup-env.ts` hard-overrides `DATABASE_URL`).

```bash
VITEST_INTEGRATION=1 npx vitest run test/rls/professional-payable-migration.integration.test.ts -t "traffic continues"
```

- Serial, base commit `2f1f406`: 6 failures in 20 runs (30%), plus 1 of 1 on the very first attempt.
- 3 concurrent processes per round, 7 rounds: 12 failures in 21 runs (57%).
- Every failure is `PostgresError: deadlock detected` (`40P01`).
  In 4 of the 6 serial failures the traffic transaction was the victim (the `trafficErrors` assertion fails).
  In 2 of the 6 the MIGRATION was the victim and `runDatabaseMigrations` itself rejected, i.e. the migration run failed.

Server log (`docker logs 06--product--fxl-sales-db-1`), traffic as victim:

```
ERROR:  deadlock detected
DETAIL:  Process 337501 waits for RowShareLock on relation 532621 of database 532229; blocked by process 337502.
	Process 337502 waits for AccessExclusiveLock on relation 532577 of database 532229; blocked by process 337501.
	Process 337501: INSERT INTO sales_ops_payables (org_id, sale_id, beneficiary_name, kind, due_date, amount_brl, status) VALUES ($1, $2, $3, 'other_cost', now(), 1, 'open') RETURNING id
	Process 337502: ALTER TABLE "sales_ops_payables" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;
```

Migration as victim (same cycle, other side detected it):

```
ERROR:  deadlock detected
DETAIL:  Process 337763 waits for AccessExclusiveLock on relation 541137 of database 540789; blocked by process 337762.
	Process 337762 waits for RowShareLock on relation 541181 of database 540789; blocked by process 337763.
	Process 337763: ALTER TABLE "sales_ops_payables" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;
	Process 337762: INSERT INTO sales_ops_payables (...) 'other_cost' ...
STATEMENT:  ALTER TABLE "sales_ops_payables" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;
```

Relation mapping: in every deadlock the RowShareLock relation is the AccessExclusive relation + 44, and in a database migrated the same way `sales_ops_receivables` is exactly `sales_ops_payables` + 44.
So relation X = `sales_ops_payables`, relation X+44 = `sales_ops_receivables`.

## Root cause

A lock-order inversion between migration 0024 and ordinary payables traffic, not a defect of migration 0018.

- Migration 0024 (one transaction): AccessExclusiveLock on `sales_ops_receivables` (held) -> requests AccessExclusiveLock on `sales_ops_payables`.
- Traffic (one transaction): AccessShareLock on `sales_ops_payables` (the `SELECT count(*)`, held) -> the INSERT's FK trigger requests RowShareLock on `sales_ops_receivables`.
- Each waits for the other; after `deadlock_timeout` (1s) Postgres aborts whichever process's deadlock check fires first.

It only appeared recently because the test runs every migration with no `throughTag` while the traffic keeps running, and 0024 (added 2026-09-23/24) is the first migration after 0018 that takes AccessExclusiveLock on two tables that the traffic touches in the opposite order.

This is NOT a test-harness artefact.
Any production request that touches `sales_ops_payables` and later needs `sales_ops_receivables` in the same transaction (every `withTenant` read of payables then receivables, every payable INSERT/UPDATE through the receivable FK, a won `PUT /sales/:id` reconcile) forms the same cycle with 0024 while the API migrates before startup against a database the previous release is still serving.
The victim is either a user request (40P01) or the migration itself, which fails the deploy's migrate step.
Worse, even without a deadlock, an ordinary migration waiting for AccessExclusiveLock with no `lock_timeout` queues every later request on that table behind it for as long as the blocker lives.
Production (`production` branch) has migrations only through 0021, so 0022-0024 are still to be released: this lands before the defect ships.

No fixed lock order inside 0024 solves it: traffic takes these two tables in both orders (payables-then-receivables on reads and FK checks, receivables-then-payables when materializing a won proposta), so any single order deadlocks with one of them.

## Decision and justification

Fix in the CODE (the shared runner), not in the test, and not in migration 0024.

- Every lock-taking migration unit yields instead of waiting: ordinary migration transactions run with `SET LOCAL lock_timeout = floor(deadlock_timeout / 2)` ms, and the 0018 `column` / `constraint` steps use the same value instead of `'5s'`.
  Because the migration's lock wait always ends (55P03) before `deadlock_timeout` elapses, the migration abandons the cycle before the deadlock detector would pick a victim, so the live transaction simply proceeds.
  Deriving the value from `pg_settings.deadlock_timeout` on the migration backend keeps the inequality true on any server configuration (1000 ms default here and on RDS gives 500 ms).
- The whole unit is then retried: an ordinary migration's transaction is fully rolled back by `withReservedTransaction`, and each 0018 lock-bounded phase is a single autocommit statement (`ADD COLUMN IF NOT EXISTS`, and `constraint` only runs when `constraintExists` is false), so a retry is idempotent.
  Retry is bounded (`lockContentionMaxAttempts`, default 50, 200 ms apart, roughly 35 s worst case) and then fails loudly without journaling, matching the existing advisory-lock and SKIP LOCKED budgets in the same file.
  Only SQLSTATE `55P03` (lock_not_available) and `40P01` (deadlock_detected) are retried; everything else, including an `AggregateError` from a failed ROLLBACK, is rethrown on the first attempt.
  This is not a blind retry that swallows deadlocks: the MIGRATION yields its own rolled-back work, and live traffic is never retried or masked; the traffic's own errors still fail the test.
- The test's traffic stays exactly as it is and keeps running across all migrations (0018 phases and 0019-0024), which now proves strictly more than before: no traffic error across the whole upgrade.
- Migration 0024 is NOT edited: its hash is already applied in every local database, and editing it cannot fix the inversion for both traffic orders.

Residual risk, recorded in the decision file: the guarantee is that the migration's wait is shorter than the other party's deadlock check.
If a migration spends more than `lock_timeout` executing between acquiring table A and requesting table B (for example a long CHECK scan on a large table) while traffic already waits on A, the traffic's own deadlock check can still fire first.
Authors of future multi-table migrations should take their locks up front (`LOCK TABLE ... IN ACCESS EXCLUSIVE MODE` as the first statement) when a statement between two lock acquisitions scans a large table.

## Prototype validation (already done by the planner, in a scratch copy, not in the repo)

The exact diffs in the appendix were applied to a scratch copy of `apps/api` sharing the repo's `node_modules` and run against the same Docker DB.
- Flaky test with the fix: 30 of 30 serial runs passed, 21 of 21 in 7 rounds of 3 concurrent processes passed.
  The DB log showed 35 `canceling statement due to lock timeout` on exactly `ALTER TABLE "sales_ops_payables" ADD COLUMN "revision"` and 0 `deadlock detected`, so the retry path was exercised about once per run.
- Both new oracles: green with the fix; against the base runner, 3 of 3 runs of `yields its locks ...` failed with `deadlock detected` and `stops after the lock contention budget ...` failed by timing out at 30 s.
- Full integration suite with the fix: 35 files, 271 tests passed (269 + 2 new). `src/db` unit tests and `docker-migration-contract.test.ts`: 33 passed. `tsc --noEmit` and eslint clean on both files.

## Implementation steps

Work in the slice worktree. Never run `db:migrate`. Keep every vitest invocation run-once (`vitest run`).

0. Worktree preflight (plan-check addition).
   The slice worktree has no `node_modules` and no `apps/api/.env`.
   Run `pnpm install --frozen-lockfile` at the worktree root, copy the main checkout's `apps/api/.env` into the worktree's `apps/api/`, and before any integration run confirm that `TEST_DATABASE_URL` and `TEST_MIGRATE_DATABASE_URL` in it point at `localhost:5006` (print host and port only, never the credentials).
   `test/rls/setup-env.ts` falls back to `DATABASE_URL` when `TEST_DATABASE_URL` is absent, so a missing pin could send scratch-database DDL to a remote host; stop if either pin is missing or remote.
   Never commit the copied `.env`.
1. RED first. Add the three new tests and their helpers to `apps/api/test/rls/professional-payable-migration.integration.test.ts` as in Appendix B (with its plan-check addition) and Appendix C.
   Run `VITEST_INTEGRATION=1 npx vitest run test/rls/professional-payable-migration.integration.test.ts -t "opposite order|contention budget|derives the migration lock_timeout"` from `apps/api` against the UNCHANGED runner and record that all three fail (`deadlock detected`, a 30 s timeout, and `lock_timeout` recorded as `0`).
   Record the output in the run's exec notes.
2. Change `apps/api/src/db/migration-runner.ts` as in Appendix A, with these two refinements over the prototype:
   - In `retryOnLockContention`, validate `maxAttempts` (positive integer) and `retryMs` (non-negative integer) with the same error style as the advisory-lock and backfill validators (`'lock contention max attempts must be a positive integer'`, `'lock contention retry interval must be a non-negative integer'`).
   - Replace the prototype's `const session = reserved; const sessionPid = backendPid;` (a TypeScript narrowing workaround for the closure) with clearer names or a small helper `runOrdinaryMigration(reserved, backendPid, migration, lockTimeoutMs, options)` that takes non-optional parameters; behaviour must stay identical.
   Add a short comment above `migrationLockTimeoutMs` explaining why the value must be below `deadlock_timeout` (the migration must abandon a lock cycle before the deadlock detector picks a live transaction as victim).
3. Run the three new oracles again: all green.
4. Run the repetition oracle for the original flaky test (below): 30/30 serial and 21/21 concurrent.
5. Run the whole file, the full integration suite, the related unit tests, `tsc --noEmit` and eslint on the two files.
6. Write `nexo/knowledge/decisions/2026-09-25-migrations-yield-locks-to-live-traffic.md` (content spec below).

## Oracles

Locked oracle tests (all in `apps/api/test/rls/professional-payable-migration.integration.test.ts`):
- NEW `phased professional payable identity migration > yields its locks instead of deadlocking when live traffic takes them in the opposite order` - deterministic reproduction of the exact inversion (traffic holds AccessShare on table B, migration holds AccessExclusive on A and waits for B, traffic then reads A). Must be red on the base runner, green after.
- NEW `phased professional payable identity migration > stops after the lock contention budget and never journals the contended migration` (including the resume run added to Appendix B).
- NEW `phased professional payable identity migration > derives the migration lock_timeout from the server deadlock_timeout` - direct oracle for the `floor(deadlock_timeout / 2)` derivation (spec in Appendix C). Must be red on the base runner (records `0`), green after; a hard-coded `500ms` would fail it.
- EXISTING, UNCHANGED `phased professional payable identity migration > upgrades populated forced-RLS data in resumable phases while traffic continues`.
- EXISTING, must stay green: every other test in the same file, and `apps/api/test/rls/settlements-schema-migration.test.ts`.

Repetition oracle (the flaky test, from `apps/api`):

```bash
# serial: must be 30/30 (base was 6 failures in 20)
f=0; for i in $(seq 1 30); do VITEST_INTEGRATION=1 npx vitest run test/rls/professional-payable-migration.integration.test.ts -t "traffic continues" >/dev/null 2>&1 || f=$((f+1)); done; echo "fail=$f/30"
# concurrent load: must be 21/21 (base was 12 failures in 21)
f=0; for r in $(seq 1 7); do pids=(); for k in 1 2 3; do (VITEST_INTEGRATION=1 npx vitest run test/rls/professional-payable-migration.integration.test.ts -t "traffic continues" >/dev/null 2>&1; echo $? > /tmp/fxl10-$r-$k.rc) & pids+=($!); done; wait "${pids[@]}"; for k in 1 2 3; do [ "$(cat /tmp/fxl10-$r-$k.rc)" = 0 ] || f=$((f+1)); done; done; echo "fail=$f/21"
```

(Use the session scratchpad instead of `/tmp` for the `.rc` files if one exists.)
Each background process is waited on by PID; nothing is left running.
Also check `docker logs --since 10m 06--product--fxl-sales-db-1 2>&1 | grep -c "deadlock detected"` is `0` after the loops.

Suite gates:
- `CI=true pnpm --filter @fxl-sales/api test:integration` - all green (271 tests expected).
- `pnpm --filter @fxl-sales/api exec vitest run src/db src/config/__tests__/docker-migration-contract.test.ts` - green.
- `pnpm --filter @fxl-sales/api exec tsc --noEmit` and eslint on the two changed files - clean.

## Decision record content

`nexo/knowledge/decisions/2026-09-25-migrations-yield-locks-to-live-traffic.md`, one sentence per line, sections:
- Rule: every lock-taking migration unit in `apps/api/src/db/migration-runner.ts` runs with `lock_timeout = floor(deadlock_timeout / 2)` and is retried whole on `55P03` / `40P01` up to a bounded budget; live traffic is never retried; no migration may run without that bound.
- Root cause: the 0024 vs traffic cycle (receivables AccessExclusive held, payables AccessExclusive requested; traffic AccessShare on payables held, RowShare on receivables requested by the RI trigger even for a NULL FK), with the two log excerpts.
- Why not reorder or edit 0024, why not stop the test's traffic at 0018's journal.
- Residual risk and the `LOCK TABLE` up-front guidance for future multi-table migrations.
- Deploy failure mode: when the budget is exhausted the container's `node dist/db/migrate.js` exits non-zero before `server.js` starts (Dockerfile `CMD`), nothing of the contended migration is journaled, and the next start resumes from the journal; previously the same contention would either deadlock or wait without bound.
- Oracle names (the two new tests and the repetition oracle numbers: base 6/20 serial and 12/21 concurrent failures, fixed 0/30 and 0/21).

## Scope limits

- Do not edit any `apps/api/drizzle/*.sql` file or the journal.
- Do not change the traffic loop, its `lock_timeout`, its assertions, or add `throughTag` to the flaky test.
- Do not add any retry on the traffic side or any catch of `40P01` in test code.
- Do not touch `apps/api/src/db/migrate.ts`, `test/rls/global-setup.ts`, or anything under `apps/web`, `routes.ts`, `service.ts`, `require-admin.ts`.
- `validate`, the concurrent index steps and the SKIP LOCKED backfill keep their current behaviour.

## Decisions

- D1. The reported "migration 0018 deadlock" is actually a deadlock in migration 0024 (the test runs all migrations while its traffic runs). The slice id keeps its name; the fix is in the shared runner.
- D2. Fixed in product code, not the test, because the same cycle occurs with real production traffic during a deploy that migrates while the previous release serves requests, and 0022-0024 are not yet in `production`.
- D3. `lock_timeout` is derived as `floor(deadlock_timeout / 2)` from the server rather than hard-coded, and the 0018 phases move from `5s` to the same value, so a migration's lock wait is always shorter than the deadlock check.
- D4. Retry budget defaults: 50 attempts, 200 ms apart (about 35 s worst case), then a loud failure without journaling. Before this change an ordinary migration would wait for its lock indefinitely while queueing all traffic behind it.
- D5. Migration 0024 is not edited (already applied in local databases, and no single lock order fixes both traffic orders).
- D6. CLAUDE.md and `nexo/knowledge/reference/propostas.md` are NOT edited in this slice to keep `files_modified` disjoint from slice 07, which edits both. The rule lives in the new decision record; Capture may fold a one-line pointer into the CLAUDE.md "Professional split" bullet ("Migrations use the shared phased runner") after the wave merges.

## Appendix A - runner diff (validated prototype)

Apply the refinements from step 2 on top of it.

```diff
--- a/apps/api/src/db/migration-runner.ts
+++ b/apps/api/src/db/migration-runner.ts
@@ -34,6 +34,13 @@
     advisoryLockRetryMs?: number;
     backfillMaxEmptyBatches?: number;
     backfillRetryMs?: number;
+    lockContentionMaxAttempts?: number;
+    lockContentionRetryMs?: number;
+    onLockContentionRetry?: (event: {
+      attempt: number;
+      code: string;
+      tag: string;
+    }) => void | Promise<void>;
     onAdvisoryLockPoll?: (event: {
       attempt: number;
       backendPid: number;
@@ -84,6 +91,51 @@
 const defaultAdvisoryLockRetryMs = 100;
 const defaultBackfillMaxEmptyBatches = 50;
 const defaultBackfillRetryMs = 100;
+const lockContentionCodes = new Set(['55P03', '40P01']);
+const defaultLockContentionMaxAttempts = 50;
+const defaultLockContentionRetryMs = 200;
+
+function sqlStateOf(error: unknown): string | undefined {
+  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
+  const code = (error as { code: unknown }).code;
+  return typeof code === 'string' ? code : undefined;
+}
+
+async function migrationLockTimeoutMs(reserved: ReservedSql): Promise<number> {
+  const [row] = await reserved<Array<{ ms: number }>>`
+    SELECT setting::integer AS ms FROM pg_settings WHERE name = 'deadlock_timeout'
+  `;
+  if (!row || !Number.isInteger(row.ms) || row.ms < 2) {
+    throw new Error('deadlock_timeout could not be read');
+  }
+  return Math.floor(row.ms / 2);
+}
+
+async function retryOnLockContention<T>(
+  options: RunDatabaseMigrationsOptions,
+  tag: string,
+  attemptWork: () => Promise<T>,
+): Promise<T> {
+  const maxAttempts =
+    options.testControls?.lockContentionMaxAttempts ?? defaultLockContentionMaxAttempts;
+  const retryMs = options.testControls?.lockContentionRetryMs ?? defaultLockContentionRetryMs;
+  for (let attempt = 1; ; attempt += 1) {
+    try {
+      return await attemptWork();
+    } catch (error) {
+      const code = sqlStateOf(error);
+      if (code === undefined || !lockContentionCodes.has(code)) throw error;
+      await options.testControls?.onLockContentionRetry?.({ attempt, code, tag });
+      if (attempt >= maxAttempts) {
+        throw new Error(
+          `migration ${tag} could not acquire its locks after ${maxAttempts} attempts`,
+          { cause: error },
+        );
+      }
+      if (retryMs > 0) await new Promise((resolveDelay) => setTimeout(resolveDelay, retryMs));
+    }
+  }
+}
 
 const remainingCandidateSql = `
 SELECT count(*)::integer AS count
@@ -308,9 +360,10 @@
   reserved: ReservedSql,
   backendPid: number,
   statement: string,
+  lockTimeoutMs: number,
 ): Promise<void> {
   await assertBackendPid(reserved, backendPid);
-  await reserved.unsafe("SET lock_timeout = '5s'");
+  await reserved.unsafe(`SET lock_timeout = '${lockTimeoutMs}ms'`);
   try {
     await reserved.unsafe(statement);
   } finally {
@@ -405,6 +458,7 @@
   backendPid: number,
   migration: LoadedMigration,
   options: RunDatabaseMigrationsOptions,
+  lockTimeoutMs: number,
 ): Promise<void> {
   const phases = migration.phases;
   if (!phases) throw new Error(`${migration.tag} is missing its phased SQL contract`);
@@ -430,7 +484,9 @@
     throw new Error('backfill retry interval must be a non-negative integer');
   }
 
-  await runLockBoundedPhase(reserved, backendPid, phaseStatement('column'));
+  await retryOnLockContention(options, migration.tag, () =>
+    runLockBoundedPhase(reserved, backendPid, phaseStatement('column'), lockTimeoutMs),
+  );
   await emitPhase(options, event('column'));
 
   await ensureConcurrentIndex(
@@ -451,7 +507,9 @@
 
   await assertBackendPid(reserved, backendPid);
   if (!(await constraintExists(reserved))) {
-    await runLockBoundedPhase(reserved, backendPid, phaseStatement('constraint'));
+    await retryOnLockContention(options, migration.tag, () =>
+      runLockBoundedPhase(reserved, backendPid, phaseStatement('constraint'), lockTimeoutMs),
+    );
   }
   await assertBackendPid(reserved, backendPid);
   await emitPhase(options, event('post-constraint'));
@@ -585,23 +643,29 @@
       )
     `);
     const latestApplied = await appliedMigrationTimestamp(reserved, migrations);
+    const lockTimeoutMs = await migrationLockTimeoutMs(reserved);
+    const session = reserved;
+    const sessionPid = backendPid;
 
     for (const migration of migrations.slice(0, throughIndex + 1)) {
       if (latestApplied !== undefined && migration.when <= latestApplied) continue;
       if (migration.tag === phasedTag) {
-        await runPhasedMigration(reserved, backendPid, migration, options);
+        await runPhasedMigration(reserved, backendPid, migration, options, lockTimeoutMs);
         continue;
       }
       if (migration.phases) throw new Error(`unsupported phased migration ${migration.tag}`);
-      await runCheckedTransaction(reserved, backendPid, async (transaction) => {
-        for (const statement of migration.statements) {
-          if (statement.trim().length > 0) await transaction.unsafe(statement);
-        }
-        await transaction`
-          INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
-          VALUES (${migration.hash}, ${migration.when})
-        `;
-      });
+      await retryOnLockContention(options, migration.tag, () =>
+        runCheckedTransaction(session, sessionPid, async (transaction) => {
+          await transaction.unsafe(`SET LOCAL lock_timeout = '${lockTimeoutMs}ms'`);
+          for (const statement of migration.statements) {
+            if (statement.trim().length > 0) await transaction.unsafe(statement);
+          }
+          await transaction`
+            INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
+            VALUES (${migration.hash}, ${migration.when})
+          `;
+        }),
+      );
       await emitPhase(options, {
         backendPid,
         phase: 'ordinary-commit',
```

## Appendix B - test diff (validated prototype)

Only additions: two helpers placed before `afterEach`, and two tests placed before the last test of the file. The existing tests are untouched.

```diff
--- a/apps/api/test/rls/professional-payable-migration.integration.test.ts
+++ b/apps/api/test/rls/professional-payable-migration.integration.test.ts
@@ -347,6 +347,52 @@
     if (Date.now() >= deadline) throw new Error(`condition not met within ${timeoutMs}ms`);
     await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
   }
+}
+
+async function createLockOrderMigrationFolder(): Promise<string> {
+  const folder = await mkdtemp(join(tmpdir(), 'fxl-sales-lock-order-migrations-'));
+  await mkdir(join(folder, 'meta'));
+  await writeFile(
+    join(folder, 'meta/_journal.json'),
+    JSON.stringify({
+      dialect: 'postgresql',
+      entries: [
+        { breakpoints: true, idx: 0, tag: '0000_lock_order_tables', version: '7', when: 1 },
+        { breakpoints: true, idx: 1, tag: '0001_lock_order_alter', version: '7', when: 2 },
+      ],
+      version: '7',
+    }),
+  );
+  await writeFile(
+    join(folder, '0000_lock_order_tables.sql'),
+    [
+      'CREATE TABLE lock_order_first(id integer);',
+      '--> statement-breakpoint',
+      'CREATE TABLE lock_order_second(id integer);',
+    ].join('\n'),
+  );
+  await writeFile(
+    join(folder, '0001_lock_order_alter.sql'),
+    [
+      'ALTER TABLE lock_order_first ADD COLUMN marker integer;',
+      '--> statement-breakpoint',
+      'ALTER TABLE lock_order_second ADD COLUMN marker integer;',
+    ].join('\n'),
+  );
+  return folder;
+}
+
+async function waitForMigrationLockWait(scratch: ScratchDatabase, relation: string): Promise<void> {
+  await waitFor(async () => {
+    const rows = await scratch.adminScratch<Array<{ waiting: number }>>`
+      SELECT count(*)::integer AS waiting
+      FROM pg_locks
+      WHERE NOT granted
+        AND mode = 'AccessExclusiveLock'
+        AND relation = to_regclass(${relation})
+    `;
+    return (rows[0]?.waiting ?? 0) > 0;
+  }, 5_000);
 }
 
 afterEach(async () => {
@@ -1039,7 +1085,110 @@
     `;
     expect(journal?.count).toBe(1);
   }, 60_000);
+
+  it('yields its locks instead of deadlocking when live traffic takes them in the opposite order', async () => {
+    const scratch = await createScratchDatabase();
+    const folder = await createLockOrderMigrationFolder();
+    const retries: Array<{ attempt: number; code: string; tag: string }> = [];
+    const traffic = scratchClient(scratch);
+    let trafficOpen = false;
+    let migrationRun: Promise<unknown> | undefined;
+    try {
+      await runDatabaseMigrations({
+        databaseUrl: scratch.ownerUrl,
+        migrationsFolder: folder,
+        throughTag: '0000_lock_order_tables',
+      });
+      await traffic.unsafe('BEGIN');
+      trafficOpen = true;
+      await traffic.unsafe('SELECT count(*) FROM lock_order_second');
 
+      migrationRun = runDatabaseMigrations({
+        databaseUrl: scratch.ownerUrl,
+        migrationsFolder: folder,
+        testControls: {
+          lockContentionMaxAttempts: 20,
+          lockContentionRetryMs: 25,
+          onLockContentionRetry: (event) => {
+            retries.push(event);
+          },
+        },
+      });
+      await waitForMigrationLockWait(scratch, 'lock_order_second');
+
+      const [deadlock] = await scratch.adminScratch<Array<{ ms: number }>>`
+        SELECT setting::integer AS ms FROM pg_settings WHERE name = 'deadlock_timeout'
+      `;
+      const started = Date.now();
+      await traffic.unsafe('SELECT count(*) FROM lock_order_first');
+      const waitedMs = Date.now() - started;
+      await traffic.unsafe('COMMIT');
+      trafficOpen = false;
+      await migrationRun;
+
+      expect(waitedMs).toBeLessThan(deadlock?.ms ?? 0);
+      expect(retries.length).toBeGreaterThan(0);
+      expect(retries[0]).toEqual({ attempt: 1, code: '55P03', tag: '0001_lock_order_alter' });
+      const owner = scratchClient(scratch);
+      const columns = await owner<Array<{ table_name: string }>>`
+        SELECT table_name FROM information_schema.columns
+        WHERE column_name = 'marker' ORDER BY table_name
+      `;
+      const [journal] = await owner<Array<{ count: number }>>`
+        SELECT count(*)::integer AS count FROM drizzle.__drizzle_migrations
+      `;
+      expect(columns).toEqual([
+        { table_name: 'lock_order_first' },
+        { table_name: 'lock_order_second' },
+      ]);
+      expect(journal?.count).toBe(2);
+    } finally {
+      if (trafficOpen) await traffic.unsafe('ROLLBACK');
+      await Promise.allSettled([migrationRun].filter(Boolean));
+      await rm(folder, { force: true, recursive: true });
+    }
+  }, 30_000);
+
+  it('stops after the lock contention budget and never journals the contended migration', async () => {
+    const scratch = await createScratchDatabase();
+    const folder = await createLockOrderMigrationFolder();
+    const traffic = scratchClient(scratch);
+    let trafficOpen = false;
+    try {
+      await runDatabaseMigrations({
+        databaseUrl: scratch.ownerUrl,
+        migrationsFolder: folder,
+        throughTag: '0000_lock_order_tables',
+      });
+      await traffic.unsafe('BEGIN');
+      trafficOpen = true;
+      await traffic.unsafe('SELECT count(*) FROM lock_order_second');
+
+      await expect(
+        runDatabaseMigrations({
+          databaseUrl: scratch.ownerUrl,
+          migrationsFolder: folder,
+          testControls: { lockContentionMaxAttempts: 3, lockContentionRetryMs: 1 },
+        }),
+      ).rejects.toThrow('migration 0001_lock_order_alter could not acquire its locks after 3 attempts');
+      await traffic.unsafe('COMMIT');
+      trafficOpen = false;
+
+      const owner = scratchClient(scratch);
+      const columns = await owner`
+        SELECT table_name FROM information_schema.columns WHERE column_name = 'marker'
+      `;
+      const [journal] = await owner<Array<{ count: number }>>`
+        SELECT count(*)::integer AS count FROM drizzle.__drizzle_migrations
+      `;
+      expect(columns).toHaveLength(0);
+      expect(journal?.count).toBe(1);
+
+      // Plan-check addition (not in the validated prototype): the advisory lock
+      // was released and the failed migration resumes cleanly.
+      await runDatabaseMigrations({
+        databaseUrl: scratch.ownerUrl,
+        migrationsFolder: folder,
+        testControls: { advisoryLockMaxAttempts: 1 },
+      });
+      const [resumed] = await owner<Array<{ count: number }>>`
+        SELECT count(*)::integer AS count FROM drizzle.__drizzle_migrations
+      `;
+      const resumedColumns = await owner`
+        SELECT table_name FROM information_schema.columns WHERE column_name = 'marker'
+      `;
+      expect(resumed?.count).toBe(2);
+      expect(resumedColumns).toHaveLength(2);
+    } finally {
+      if (trafficOpen) await traffic.unsafe('ROLLBACK');
+      await rm(folder, { force: true, recursive: true });
+    }
+  }, 30_000);
+
   it('keeps the journal timestamp and phased SQL source authoritative for migration 0018', async () => {
     const journal = JSON.parse(
       await readFile(resolve(migrationsFolder, 'meta/_journal.json'), 'utf8'),
```

## Appendix C - derivation oracle (plan-check addition, not prototyped)

Test `derives the migration lock_timeout from the server deadlock_timeout`, in the same `describe`, next to the two tests of Appendix B, timeout 30 s.
- `createScratchDatabase()`, then `await scratch.admin.unsafe(`ALTER DATABASE ${scratch.databaseName} SET deadlock_timeout = '1400ms'`)` before any migration run (the name is already an exact identifier; `deadlock_timeout` is superuser-only, which `admin` is; the setting applies to sessions opened afterwards).
- A temp folder with one ordinary migration `0000_lock_timeout_probe`: `CREATE TABLE lock_timeout_probe(value text);`, breakpoint, `INSERT INTO lock_timeout_probe SELECT current_setting('lock_timeout');`.
- Run `runDatabaseMigrations` on it, then read the row through `scratchClient(scratch)` and expect `'700ms'`.
- Remove the folder in `finally`; the scratch database is dropped by the existing `afterEach`.
