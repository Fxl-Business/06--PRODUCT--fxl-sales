# Execute 06 - Phased professional identity migration

Status: PASS

Tested commit: `00d83854a01bd9e6da2b133b972c80faf6536c6b`

## Red

The static contract command failed with four intended failures and one passing journal-order test.
It proved that migration 0018 still lacked the phased header, concurrent indexes, bounded `SKIP LOCKED` backfill, and shared startup runner.

```text
pnpm --filter @fxl-sales/api exec vitest run src/domains/sales-ops/__tests__/professional-payable-identity.test.ts src/config/__tests__/docker-migration-contract.test.ts
Test Files 2 failed
Tests 4 failed, 1 passed
```

The populated PostgreSQL command failed before collection because `../../src/db/migration-runner.js` did not exist.
That was the intended runner-level Red and left the configured database unchanged.

```text
VITEST_INTEGRATION=1 pnpm --filter @fxl-sales/api exec vitest run test/rls/professional-payable-migration.integration.test.ts
Test Files 1 failed
Cause: shared migration runner module missing
```

## Green implementation

The repository now owns migration execution through `apps/api/src/db/migration-runner.ts`.
It loads the Drizzle journal before database changes, preserves migration hashes and timestamps, rejects invalid journal ordering, and applies ordinary migrations one at a time through explicit reserved-handle transactions.
It holds a stable session advisory lock on one reserved postgres-js backend and checks the backend PID before and after every phase and transaction.
Lock acquisition uses `pg_try_advisory_lock` polling on that same reserved session because a second runner blocked inside `pg_advisory_lock` retains an old transaction snapshot and can deadlock the first runner's `CREATE INDEX CONCURRENTLY` phase.

Migration 0018 now has the exact phased header and marker order.
The nullable column phase has a finite five-second lock timeout.
Both indexes build concurrently outside a transaction and invalid interrupted indexes are dropped concurrently before retry.
The composite foreign key is installed `NOT VALID`, immediately enforces new writes, and is validated only after backfill completion.
The forced-RLS backfill updates at most 1000 rows per explicit transaction with `FOR UPDATE OF p SKIP LOCKED`.
Every empty-batch and pre-journal candidate check executes with transaction-local `app.fxl_admin = true`.
The journal row is written only after both indexes are valid, the constraint is validated, and no unambiguous candidate remains.

Production startup and Vitest integration global setup both call the shared runner.
The generated 0018 snapshot and journal were not modified.

## Review repair

Review finding 1 is closed by a finite advisory-lock attempt budget on completed `pg_try_advisory_lock` queries.
A deterministic two-runner rendezvous proves the contender polls while the first runner owns the lock, resumes after release, and applies its migration exactly once.
A separate three-attempt exhaustion oracle proves the contender terminates without mutation or a journal record.

Review finding 2 is closed by single-candidate `SKIP LOCKED` controls.
One oracle holds the only candidate through an empty batch, releases it, and proves the runner resumes and journals only after the row is linked.
Another holds the candidate through exactly 50 empty batches and proves bounded failure, a null professional identity, and no 0018 journal record.
Both cases retain the forced-RLS negative control, which sees zero candidates without transaction-local admin context and one with it.

Review finding 3 is closed by registering scratch resources before DDL and cleaning clients, database connections, the database, the role, and the admin client through independent best-effort steps.
An injected failure immediately after database creation proves the original error is retained and an independent administrator observes neither database nor role afterward.

The Minor phase-marker finding is closed by an exact parser that requires one known marker at the beginning of every breakpoint chunk and immediately before SQL.
Static tests prove malformed names, markers after SQL, and duplicate or stray markers are rejected before a database connection is opened.

## PostgreSQL oracle

The scratch oracle creates a fresh database and a fresh owner role for each scenario.
The owner is asserted to be `NOSUPERUSER` and `NOBYPASSRLS` before any migration runs.
Only the separate superuser connection performs scratch lifecycle and catalog inspection.

The ordinary migration probe proves committed work and the journal row use the runner backend PID.
Its second migration raises PostgreSQL `22012`, and the inserted row, created table, and journal row all roll back.

The populated probe upgrades a 0017 database containing 10000 unambiguous payables plus one ambiguous same-name payable.
The missing-admin-context control sees zero candidates under forced RLS, while the transaction-local admin-context control sees all 10000.
Tenant-scoped reads and insert-delete writes continue between the column and journal phases without `55P03` or `57014` failures.
The post-constraint control rejects an invalid professional identity with PostgreSQL `23503`.
A locked payable is skipped by one committed batch and backfilled by a later batch before the journal event.

The interrupted-index probe observes the exact target backend waiting on `Lock/virtualxid`, cancels it with PostgreSQL `57014`, confirms the named invalid index remains, and then runs two shared runners concurrently.
Both runners resolve, both indexes finish valid, the foreign key finishes validated, and exactly one 0018 journal row exists.

## Verification evidence

```text
pnpm run build:packages
PASS

pnpm --filter @fxl-sales/api exec vitest run src/db/__tests__/migration-runner.test.ts src/domains/sales-ops/__tests__/professional-payable-identity.test.ts src/config/__tests__/docker-migration-contract.test.ts
PASS - 3 files, 8 tests

VITEST_INTEGRATION=1 pnpm --filter @fxl-sales/api exec vitest run test/rls/professional-payable-migration.integration.test.ts
PASS - 1 file, 9 tests

CI=true TEST_DATABASE_URL=<local fxl_sales_test> TEST_MIGRATE_DATABASE_URL=<local postgres> ADMIN_DATABASE_URL=<local postgres> pnpm --filter @fxl-sales/api test:integration
PASS - 21 files, 128 tests

pnpm --filter @fxl-sales/api test
PASS - 35 files, 340 tests

pnpm --filter @fxl-sales/api exec eslint src/db/migration-runner.ts src/db/migrate.ts src/db/__tests__/migration-runner.test.ts test/rls/global-setup.ts src/config/__tests__/docker-migration-contract.test.ts src/domains/sales-ops/__tests__/professional-payable-identity.test.ts src/domains/sales-ops/__tests__/sale-transitions.integration.test.ts test/rls/professional-payable-migration.integration.test.ts
PASS

pnpm --filter @fxl-sales/api type-check
PASS

pnpm --filter @fxl-sales/api build
PASS

git diff --check
PASS
```

The first bare full-integration invocation used the worktree fallback superuser because ignored local `.env` files are not copied into linked worktrees.
Its RLS guards failed as designed.
The documented local role split rerun above passed all 128 tests and kept migration traffic on local port 5006.

The compiled `dist/db/migrate.js` imports and awaits the shared runner.
Catalog inspection confirms both named indexes have `indisvalid = true` and the composite foreign key has `convalidated = true`.
Post-run inspection found no `fxl_sales_migration_%` database and no `fxl_sales_migrator_%` role.
All test commands were run once per invocation without watch mode, and no process started by this slice remains running.

## Commit

`d8574f6 fix(db): phase professional identity migration`

`00d8385 fix(db): bound migration retry paths`

No tag, staging promotion, or milestone close was performed.
