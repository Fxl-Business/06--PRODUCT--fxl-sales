---
id: 06-phased-professional-identity-migration
milestone: v2.4.0
status: done
depends_on: []
files_modified:
  - apps/api/drizzle/0018_professional_payable_identity.sql
  - apps/api/src/db/migration-runner.ts
  - apps/api/src/db/migrate.ts
  - apps/api/test/rls/global-setup.ts
  - apps/api/src/config/__tests__/docker-migration-contract.test.ts
  - apps/api/src/domains/sales-ops/__tests__/professional-payable-identity.test.ts
  - apps/api/src/domains/sales-ops/__tests__/sale-transitions.integration.test.ts
  - apps/api/test/rls/professional-payable-migration.integration.test.ts
acceptance: "given a populated database at migration 0017 and concurrent application traffic, when the repository migration runner applies 0018, then the nullable column is added briefly, indexes are built concurrently outside a transaction, the foreign key is installed not-valid then validated, identity rows are backfilled in bounded transactions, concurrent reads and writes succeed, retries are safe, and exactly one journal record marks completion"
---

# Phased Professional Identity Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` or `superpowers:executing-plans` to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.
> Use `superpowers:test-driven-development` for Red, Green, and Refactor, and do not weaken the populated PostgreSQL oracle after recording its failure.

**Goal:** Apply migration 0018 without retaining an access-exclusive table lock through index creation, constraint validation, or the historical identity backfill.

**Architecture:** Replace the stock all-pending-migrations transaction with a repository runner that preserves transactional execution for ordinary migrations and recognizes migration 0018 as a phased migration.
The phased path holds a session advisory lock on one reserved postgres-js connection, adds the nullable column in a short autocommit statement, creates both indexes concurrently, adds the foreign key as `NOT VALID`, backfills bounded batches in separate transactions, validates the constraint, and records the Drizzle journal row only after every phase succeeds.
Every phase is idempotent so container restart or a second replica safely resumes.

**Tech Stack:** TypeScript, postgres-js reserved connections, PostgreSQL advisory locks, concurrent indexes, not-valid foreign keys, Drizzle journal format, Vitest, and Docker startup migration execution.

## Global Constraints

- Production and integration startup must use the same repository-owned migration runner.
- Preserve the existing `drizzle.__drizzle_migrations` table name, schema, `hash`, and `created_at` semantics.
- Determine pending work from the greatest recorded `created_at`, matching the stock Drizzle migrator, and never apply an older journal entry behind a newer recorded entry.
- Preserve journal ordering and migration file hashes.
- Ordinary migrations remain transactional, one journaled migration per transaction.
- Migration 0018 must not execute `CREATE INDEX CONCURRENTLY` inside any transaction block.
- Migration 0018 must carry the exact header `-- fxl-migration-mode: phased` and the ordered phase markers defined below.
- The migration runner must reserve one physical postgres-js connection for the session advisory lock and release it in `finally`.
- Every migration statement, explicit transaction control statement, catalog query, advisory lock, and advisory unlock must execute through that reserved handle on the same PostgreSQL backend PID.
- Never call `begin` on the base postgres-js client while its only `max: 1` connection is reserved, and never assume the installed reserved handle exposes `begin`.
- Transactions on the reserved handle must use explicit `BEGIN`, `COMMIT`, and rollback-on-error `ROLLBACK` statements.
- The advisory lock key must be stable and repository-specific, such as `hashtext('fxl-sales:database-migrations')`.
- Add-column and add-constraint phases must set a finite `lock_timeout` of `5s` and fail for retry rather than wait indefinitely.
- The target unique index and source lookup index must be built with `CREATE INDEX CONCURRENTLY`.
- An interrupted invalid concurrent index must be detected through `pg_index.indisvalid`, dropped with `DROP INDEX CONCURRENTLY`, and rebuilt.
- The composite foreign key must be added as `NOT VALID` and must enforce new writes immediately.
- The backfill must update at most `1000` payables per transaction with `FOR UPDATE OF p SKIP LOCKED` and transaction-local `app.fxl_admin = true`.
- An empty batch may finish only when a separate remaining-candidate query returns zero; if locked candidates remain, retry at `100ms` intervals up to `50` times and then fail without journaling.
- Every remaining-candidate query and the final pre-journal candidate query must run inside an explicit reserved-handle transaction that first sets transaction-local `app.fxl_admin = true`.
- Constraint validation must happen only after the backfill reaches zero rows.
- A migration record must be inserted only after indexes are valid, the backfill is complete, and the foreign key is validated.
- Re-running after any completed phase must be safe and must not create a second migration record.
- Do not require a maintenance window.
- Do not change application schema, generated `0018_snapshot.json`, journal order, runtime payable behavior, or unrelated migrations in this slice.
- Do not manually edit `apps/api/drizzle/meta/0018_snapshot.json` or any generated context pack.
- Run every command once without watch mode and stop every process started for this slice.

---

## File map

- `apps/api/drizzle/0018_professional_payable_identity.sql` is the authoritative phased SQL and carries executable phase markers.
- `apps/api/src/db/migration-runner.ts` loads the Drizzle journal, serializes runners, executes ordinary migrations transactionally, and executes 0018 by phase.
- `apps/api/src/db/migrate.ts` is the production CLI wrapper around the shared runner.
- `apps/api/test/rls/global-setup.ts` applies migrations through the same shared runner.
- `apps/api/src/config/__tests__/docker-migration-contract.test.ts` pins compiled runner startup and migration asset inclusion.
- `apps/api/src/domains/sales-ops/__tests__/professional-payable-identity.test.ts` pins the phased SQL contract.
- `apps/api/test/rls/professional-payable-migration.integration.test.ts` owns populated-database, traffic, retry, and catalog verification.

## Exact runner interface

Create this exported contract in `apps/api/src/db/migration-runner.ts`.

```ts
export type MigrationPhase =
  | 'ordinary-commit'
  | 'column'
  | 'target-index'
  | 'source-index'
  | 'post-constraint'
  | 'backfill-batch'
  | 'validate'
  | 'journal';

export type MigrationPhaseEvent = {
  phase: MigrationPhase;
  tag: string;
  backendPid: number;
  batchUpdated?: number;
};

export type RunDatabaseMigrationsResult = {
  backendPid: number;
};

export type RunDatabaseMigrationsOptions = {
  databaseUrl: string;
  migrationsFolder: string;
  throughTag?: string;
  onPhaseComplete?: (event: MigrationPhaseEvent) => void | Promise<void>;
};

export async function runDatabaseMigrations(
  options: RunDatabaseMigrationsOptions,
): Promise<RunDatabaseMigrationsResult>;
```

`throughTag` and `onPhaseComplete` are deterministic test seams.
Production passes neither option.
The hook runs only after a phase has committed and while no phase transaction is open.
`post-constraint` fires only after the not-valid FK statement commits, so tests may acquire a row blocker without obstructing the earlier access-exclusive column phase.
The runner obtains `backendPid` once through `SELECT pg_backend_pid()` on the reserved handle, rechecks it before and after every explicit transaction and phase, and throws before journaling if any observed PID differs.

Use this exact reserved-handle transaction primitive for ordinary migrations, backfill batches, admin-context candidate reads, and final journaling.

```ts
type PostgresClient = ReturnType<typeof postgres>;
type ReservedSql = Awaited<ReturnType<PostgresClient['reserve']>>;

async function withReservedTransaction<T>(
  reserved: ReservedSql,
  work: (transaction: ReservedSql) => Promise<T>,
): Promise<T> {
  await reserved.unsafe('BEGIN');
  try {
    const value = await work(reserved);
    await reserved.unsafe('COMMIT');
    return value;
  } catch (error) {
    try {
      await reserved.unsafe('ROLLBACK');
    } catch (rollbackError) {
      throw new AggregateError([error, rollbackError], 'migration transaction rollback failed');
    }
    throw error;
  }
}
```

`ReservedSql` is the installed postgres-js reserved query-handle type.
Do not call `reserved.begin`, `client.begin`, Drizzle `db.transaction`, or any helper that leases a second pool connection.

Migration 0018 uses this exact ordered marker vocabulary.

```text
-- fxl-migration-mode: phased
-- fxl-phase: column
-- fxl-phase: target-index
-- fxl-phase: source-index
-- fxl-phase: constraint
-- fxl-phase: backfill-context
-- fxl-phase: backfill-repeat
-- fxl-phase: validate
```

Each phase marker immediately precedes one breakpoint-delimited SQL statement.
The runner executes `backfill-context` and one `backfill-repeat` statement inside each batch transaction.

### Task 1: Lock the runner and SQL contracts in unit tests

**Files:**

- Modify: `apps/api/src/domains/sales-ops/__tests__/professional-payable-identity.test.ts`
- Modify: `apps/api/src/config/__tests__/docker-migration-contract.test.ts`

- [ ] **Step 1: Replace the unsafe migration assertions with phased assertions**

Keep the journal, nullable column, composite key direction, admin context, and conservative match assertions.
Add assertions that migration 0018 contains these exact concepts in this order: `ADD COLUMN IF NOT EXISTS`, target `CREATE UNIQUE INDEX CONCURRENTLY`, source `CREATE INDEX CONCURRENTLY`, `ADD CONSTRAINT ... NOT VALID`, a batch limit of `1000`, `FOR UPDATE OF p SKIP LOCKED`, and `VALIDATE CONSTRAINT`.
Assert the exact phased header and marker sequence from `Exact runner interface`.
Assert that the backfill update includes `RETURNING p."id"` so the runner can detect an empty batch.
Assert that no ordinary non-concurrent `CREATE INDEX` remains.

- [ ] **Step 2: Pin production and integration to the shared runner**

Update the Docker contract test to assert that `apps/api/src/db/migrate.ts` imports and awaits `runDatabaseMigrations`.
Assert that `apps/api/test/rls/global-setup.ts` imports and awaits the same function.
Retain the Dockerfile assertions that compiled migrations run before the API server and the `drizzle` directory is copied.
Assert that neither entrypoint imports `migrate` from `drizzle-orm/postgres-js/migrator`.

- [ ] **Step 3: Run the static contracts and record Red**

```bash
pnpm --filter @fxl-sales/api exec vitest run src/domains/sales-ops/__tests__/professional-payable-identity.test.ts src/config/__tests__/docker-migration-contract.test.ts
```

Expected Red: migration 0018 has non-concurrent indexes and a validating foreign key in one transaction, and both startup paths still call the stock Drizzle migrator.

### Task 2: Lock the populated PostgreSQL migration oracle

**Files:**

- Create: `apps/api/test/rls/professional-payable-migration.integration.test.ts`

**Interfaces:**

- Consumes: `runDatabaseMigrations`, `TEST_MIGRATE_DATABASE_URL`, the journaled migration folder, and postgres-js.
- Produces: executable proof that 0018 can upgrade populated 0017 state under traffic and resume after interruption.

- [ ] **Step 1: Create and always remove a scratch database**

Connect as the `TEST_MIGRATE_DATABASE_URL` superuser to the `postgres` database for lifecycle operations only.
Generate a database name `fxl_sales_migration_<uuid_without_dashes>`, a role name `fxl_sales_migrator_<uuid_without_dashes>`, and a random password.
Validate both identifiers against `^[a-z0-9_]+$` before quoting them.
Create the role with `LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`, then create the scratch database owned by that role.
Build `scratchOwnerUrl` with the generated role and URL-encoded password.
Assert through `pg_roles` that the owner has `rolsuper = false` and `rolbypassrls = false` before running any migration.
Use the superuser only to create or drop the role and database, terminate cleanup connections, and inspect system catalogs when owner visibility is insufficient.
Run migrations, fixture writes, candidate reads, and traffic canaries through the non-superuser owner URL.
Register cleanup in `afterEach` that closes every client, terminates scratch-database connections, drops that exact database, and then drops that exact role.
Never drop the configured source database.

- [ ] **Step 2: Prove reserved-session ordinary commit, rollback, and PID stability**

Create a test-owned temporary migration folder and remove it in `finally`.
Its journal has `0000_commit_probe` followed by `0001_rollback_probe` with strictly increasing timestamps and correct SQL files.
Migration `0000_commit_probe` creates `migration_tx_probe(marker text, backend_pid integer)` and inserts `('committed', pg_backend_pid())`.
Migration `0001_rollback_probe` inserts `('must_rollback', pg_backend_pid())`, creates `migration_must_rollback`, and then executes `SELECT 1 / 0` as a later breakpoint statement.
Run through `0000_commit_probe` and assert the committed row plus its journal row exist.
Assert the stored PID equals `RunDatabaseMigrationsResult.backendPid` and every emitted phase event carries that same PID.
Run again without `throughTag`, assert PostgreSQL division-by-zero `22012`, and assert the `must_rollback` row, `migration_must_rollback` table, and second journal row are all absent.
The runner must finish both calls without waiting for another pool connection.

- [ ] **Step 3: Build a populated 0017 baseline with the shared runner**

Call `runDatabaseMigrations({ databaseUrl: scratchOwnerUrl, migrationsFolder, throughTag: '0017_professional_payment_split' })`.
Insert one organization, one sale, one unambiguous professional, and at least `10000` paid or open v2.3.1-shaped professional payables with null receivable and no identity.
Use one transaction and `generate_series` for fixture creation rather than 10000 client round trips.
Insert an additional ambiguous same-name sale and payable as a backfill negative control.
The owner fixture transaction must first call `set_config('app.fxl_admin', 'true', true)` because both populated tables use forced RLS.

- [ ] **Step 4: Lock the admin-context negative control**

Execute the exact remaining-candidate count as the non-superuser owner without setting `app.fxl_admin` and assert it falsely returns zero under forced RLS.
Execute the same count inside an explicit owner transaction that first calls `set_config('app.fxl_admin', 'true', true)` and assert it returns all unambiguous fixtures.
Keep this contrast as a negative control proving that removing admin context from either empty-batch confirmation or final pre-journal confirmation makes the migration oracle fail.

- [ ] **Step 5: Run continuous traffic and acquire the row blocker after the constraint**

Start a second postgres-js client before applying 0018.
Loop a tenant-scoped `SELECT count(*) FROM sales_ops_payables` and an insert plus delete of a uniquely named open payable.
Each canary transaction must set `app.current_org_id` transaction-locally and use `SET LOCAL lock_timeout = '2s'`.
Pass an `onPhaseComplete` hook to `runDatabaseMigrations`.
When the hook receives `post-constraint`, open a third non-superuser owner connection, issue explicit `BEGIN`, set transaction-local `app.fxl_admin = true`, and lock one known unambiguous candidate with `SELECT ... FOR UPDATE`.
Return from the `post-constraint` hook while that blocker transaction remains open.
When the hook receives the first `backfill-batch` event with `batchUpdated > 0`, assert the locked row is still null from the blocker transaction, record that one batch committed around it, then explicitly `COMMIT` and close the blocker.
Run `runDatabaseMigrations` to completion through `scratchOwnerUrl`.
Stop the canary loop in `finally` without leaving a timer or client alive.
Assert that at least one read and one write completed after the column phase and before the journal phase, and that no canary failed with lock timeout `55P03` or query cancellation `57014`.
Assert the formerly locked row was updated by a later batch before the migration journal row appeared.
Assert every phase event and the returned result report one stable backend PID.

- [ ] **Step 6: Assert catalog and data completion**

Assert `sales_ops_payables.sale_professional_id` is nullable.
Assert both new indexes exist and `pg_index.indisvalid` is true.
Assert the composite foreign key exists, `convalidated` is true, and `confdeltype` is restrictive.
Assert all unambiguous professional-cost fixtures received the same-org and same-sale professional ID.
Assert the ambiguous fixture remains null.
Assert exactly one migration row has `created_at` equal to journal entry 0018.

- [ ] **Step 7: Add a deterministic interrupted-index resume test**

Create another scratch database through 0017.
Add the nullable identity column.
Open a blocker connection as the non-superuser owner and issue `BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`.
Run `SELECT count(*) FROM sales_ops_sale_professionals` to establish and retain the old transaction snapshot.
On an index connection, start the exact `CREATE UNIQUE INDEX CONCURRENTLY "sales_ops_sale_professionals_org_sale_id_id_idx"` statement.
Read the index connection's exact `pg_backend_pid()` before starting the command.
Poll every `25ms` for at most `5s` using the superuser catalog connection.
Proceed only when the named index exists with `indisvalid = false` and that exact backend reports `state = 'active'`, `wait_event_type = 'Lock'`, and `wait_event = 'virtualxid'` in `pg_stat_activity`.
Fail the test if that exact wait state is not observed before the finite deadline.
Call `pg_cancel_backend` for that exact index backend from the admin connection and assert the index command rejects with PostgreSQL code `57014`.
Explicitly `ROLLBACK` and close the blocker connection in `finally`, then assert the named invalid index remains.
Run the shared migration runner twice concurrently with `Promise.all`.
Assert both calls resolve, the advisory lock serialized them, the final indexes are valid, the constraint is validated, and the migration table has exactly one 0018 record.
Do not update PostgreSQL system catalogs directly.

- [ ] **Step 8: Run the PostgreSQL oracle and retain Red**

```bash
VITEST_INTEGRATION=1 pnpm --filter @fxl-sales/api exec vitest run test/rls/professional-payable-migration.integration.test.ts
```

Expected Red: `runDatabaseMigrations` does not exist and the current stock runner cannot execute a concurrent phased migration.

### Task 3: Implement the shared journal-compatible migration runner

**Files:**

- Create: `apps/api/src/db/migration-runner.ts`
- Modify: `apps/api/src/db/migrate.ts`
- Modify: `apps/api/test/rls/global-setup.ts`

- [ ] **Step 1: Load and validate journaled migrations**

Read `meta/_journal.json`, preserve ascending `idx`, and load each tagged SQL file.
Compute SHA-256 from the complete file text, use journal `when` as `created_at`, and split statements on `--> statement-breakpoint`.
Reject a missing SQL file, duplicate index, non-monotonic timestamp, or unknown phase marker before changing the database.
Reject a phased file whose marker order or statement count differs from the exact eight-marker contract.
Read the greatest applied `created_at` and select only later journal entries, preserving the stock migrator's prefix semantics.
If the migration table contains a timestamp not present in the journal or a newer row while a journal prefix is missing, fail before applying SQL instead of replaying historical work out of order.

- [ ] **Step 2: Reserve one connection and serialize migration processes**

Create postgres-js with `max: 1`, call `reserve()`, and acquire `pg_advisory_lock(hashtext('fxl-sales:database-migrations'))` on that reserved connection.
Immediately read and retain `pg_backend_pid()` from the reserved handle.
Acquire the advisory lock, create the Drizzle schema and migration table, and perform all later migration work through only that handle.
Before and after each phase and explicit transaction, query `pg_backend_pid()` through the same handle and require equality with the retained PID.
In `finally`, first issue a best-effort explicit `ROLLBACK` only when the transaction helper recorded an open transaction, then call `pg_advisory_unlock` on the reserved handle, verify the PID one final time, release the reserved handle, and end the base client.
Return the retained PID in `RunDatabaseMigrationsResult`.

- [ ] **Step 3: Execute ordinary pending migrations transactionally**

For each journal entry later than the greatest recorded `created_at`, call `withReservedTransaction` on the reserved handle, execute every breakpoint statement through that handle, and insert its hash and timestamp before the explicit commit.
On any statement or journal insert failure, issue explicit `ROLLBACK` on the same handle and rethrow the original error unless rollback itself fails.
After commit, emit `ordinary-commit` with the tag and retained backend PID.
Stop after `throughTag` when it is provided.
Do not use the stock dialect migrator because it wraps every pending migration, including 0018, in one outer transaction.
Do not call the base client's `begin`, the nonexistent reserved-handle `begin`, or any transaction helper that leases a connection.

- [ ] **Step 4: Dispatch 0018 to a dedicated phased function**

Recognize only the exact tag `0018_professional_payable_identity`.
Execute each committed phase in the journal order and call `onPhaseComplete` only after success.
Execute the column, concurrent-index, constraint, validation, and catalog statements directly through the reserved handle in autocommit mode.
Before each concurrent index, query `pg_class` plus `pg_index` by schema and exact index name.
Skip a valid index, drop an invalid index concurrently, and then create the index concurrently.
Before adding the foreign key, query `pg_constraint` by exact table and name.
Skip an existing constraint and otherwise add the exact composite FK as `NOT VALID`.
Emit `post-constraint` only after the add-or-confirm constraint work has committed and the runner has rechecked its backend PID.

- [ ] **Step 5: Repeat bounded backfill transactions**

For each batch, call `withReservedTransaction`, execute the marked `backfill-context` statement through the reserved handle, and then execute `backfill-repeat` through the same handle with batch size `1000`.
Commit the returned rows before starting the next batch.
When a batch returns zero IDs, keep the explicit transaction open and count the remaining unambiguous null-ID candidates through the same reserved handle after the transaction-local admin context is set.
Stop only when that count is zero.
When the count is nonzero because candidates were skipped while locked, wait `100ms` and retry, allowing at most `50` consecutive empty batches before throwing a retryable migration error without inserting the journal row.
Call the phase hook after each explicit commit, reporting the number of updated rows, and once after the empty terminating transaction commits.

- [ ] **Step 6: Validate and journal only complete migration state**

Execute `VALIDATE CONSTRAINT` outside the backfill transactions.
Query `pg_index.indisvalid` and `pg_constraint.convalidated` through the reserved handle.
Then call `withReservedTransaction`, set transaction-local `app.fxl_admin = true`, and execute the final pre-journal count of unambiguous null-ID rows through the same reserved handle.
Inside that same explicit transaction, insert the 0018 journal row only when both indexes are valid, the constraint is validated, and the admin-context count is zero.
Use a unique check on `created_at` in code and re-query under the advisory lock before insert so retry cannot duplicate the row.
Commit, recheck the backend PID, and only then emit `journal`.

- [ ] **Step 7: Route both startup entrypoints through the runner**

In `src/db/migrate.ts`, validate `DATABASE_URL`, resolve `./drizzle`, and await `runDatabaseMigrations`.
In integration `global-setup.ts`, keep the existing URL precedence and call the same runner with `migrationsFolder: './drizzle'`.
Retain explicit connection cleanup inside the runner.

### Task 4: Rewrite migration 0018 as authoritative phased SQL

**Files:**

- Modify: `apps/api/drizzle/0018_professional_payable_identity.sql`

- [ ] **Step 1: Make the column phase replay-safe**

Start the file with `-- fxl-migration-mode: phased` and `-- fxl-phase: column`.
Use `ALTER TABLE "sales_ops_payables" ADD COLUMN IF NOT EXISTS "sale_professional_id" uuid` as its own breakpoint-delimited statement.

- [ ] **Step 2: Make both indexes concurrent phases**

Use exact names `sales_ops_sale_professionals_org_sale_id_id_idx` and `sales_ops_payables_sale_professional_id_idx`.
Use `CREATE UNIQUE INDEX CONCURRENTLY` for the target tuple and `CREATE INDEX CONCURRENTLY` for the source identity.
Prefix them with `-- fxl-phase: target-index` and `-- fxl-phase: source-index` respectively.
Keep each in its own breakpoint-delimited statement.

- [ ] **Step 3: Add the FK without an initial table scan**

Use the current organization, sale, and professional column direction with `ON DELETE restrict ON UPDATE no action NOT VALID`.
Prefix it with `-- fxl-phase: constraint`.
Keep it in its own phase.

- [ ] **Step 4: Bound and lock only each backfill batch**

Prefix the existing `SELECT set_config('app.fxl_admin', 'true', true)` statement with `-- fxl-phase: backfill-context`.
The runner must execute this statement and the following batch statement inside the same transaction so the transaction-local setting governs the update.
Change the backfill CTE to select at most `1000` matching payable IDs ordered by ID and locked with `FOR UPDATE OF p SKIP LOCKED`.
Retain the exact same-org, same-sale, same-beneficiary, unique-match, kind, and null-ID predicates.
Prefix this statement with `-- fxl-phase: backfill-repeat`.
Update by the selected IDs and `RETURNING p."id"`.

- [ ] **Step 5: Validate in the final SQL phase**

End with `-- fxl-phase: validate` followed by `ALTER TABLE "sales_ops_payables" VALIDATE CONSTRAINT "sales_ops_payables_org_sale_professional_fk"`.
Do not add a default, `NOT NULL`, guessed match, destructive statement, or RLS policy.

- [ ] **Step 6: Keep the existing executable backfill test compatible with phase markers**

In `sale-transitions.integration.test.ts`, split migration 0018 on `--> statement-breakpoint` and require exactly one chunk containing a line equal to `-- fxl-phase: backfill-repeat`.
Select that chunk by its exact marker instead of `startsWith('WITH "unambiguous_professional_matches"')`.
If the raw executor requires it, remove only the leading marker line with `markedChunk.replace(/^\s*-- fxl-phase: backfill-repeat\r?\n/, '')`.
Assert the remaining text begins with the original CTE and execute it without trimming, copying, reconstructing, or otherwise rewriting the shipped SQL.

### Task 5: Reach Green and verify the deployment shape

- [ ] **Step 1: Run static and runner tests**

```bash
pnpm --filter @fxl-sales/api exec vitest run src/domains/sales-ops/__tests__/professional-payable-identity.test.ts src/config/__tests__/docker-migration-contract.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run the populated migration integration test**

```bash
VITEST_INTEGRATION=1 pnpm --filter @fxl-sales/api exec vitest run test/rls/professional-payable-migration.integration.test.ts
```

Expected: PASS with valid concurrent indexes, validated FK, complete conservative backfill, successful traffic canaries, and exactly one 0018 record.

- [ ] **Step 3: Prove normal migration startup still works from empty state**

Run the complete integration suite, whose global setup now uses the shared runner.

```bash
CI=true pnpm --filter @fxl-sales/api test:integration
```

Expected: PASS.

- [ ] **Step 4: Prove compiled Docker startup keeps the runner**

```bash
pnpm --filter @fxl-sales/api build
pnpm --filter @fxl-sales/api exec vitest run src/config/__tests__/docker-migration-contract.test.ts
```

Expected: PASS and `dist/db/migrate.js` references the compiled shared runner.

## Verification contract

A different Verify agent must run these commands from the repository root.

```bash
pnpm run build:packages
pnpm --filter @fxl-sales/api exec vitest run src/domains/sales-ops/__tests__/professional-payable-identity.test.ts src/config/__tests__/docker-migration-contract.test.ts
VITEST_INTEGRATION=1 pnpm --filter @fxl-sales/api exec vitest run test/rls/professional-payable-migration.integration.test.ts
CI=true pnpm --filter @fxl-sales/api test:integration
pnpm --filter @fxl-sales/api exec eslint src/db/migration-runner.ts src/db/migrate.ts test/rls/global-setup.ts src/config/__tests__/docker-migration-contract.test.ts src/domains/sales-ops/__tests__/professional-payable-identity.test.ts src/domains/sales-ops/__tests__/sale-transitions.integration.test.ts test/rls/professional-payable-migration.integration.test.ts
pnpm --filter @fxl-sales/api type-check
pnpm --filter @fxl-sales/api build
git diff --check
```

The verifier must inspect the real catalog and confirm both indexes have `indisvalid = true`, the FK has `convalidated = true`, and no stock Drizzle migrator call remains in either startup path.
The verifier must confirm `CREATE INDEX CONCURRENTLY` executes outside a transaction by observing that the populated PostgreSQL oracle does not raise `25001`.
The verifier must confirm every scratch database and process started by the tests is removed before finishing.

## Atomic capture guidance

After separate-agent Verify returns PASS, stage exactly the files in `files_modified` and inspect `git diff --cached --check` and `git diff --cached --stat`.
Capture the slice with this Conventional Commit.

```bash
git commit -m "fix(db): phase professional identity migration"
```

Do not tag, promote staging, or close milestone `v2.4.0` in this slice.
