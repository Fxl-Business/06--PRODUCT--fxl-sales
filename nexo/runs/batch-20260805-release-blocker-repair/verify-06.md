# Gate 2 Verify - Slice 06 Phased Professional Identity Migration

Status: PASS

Agent: verify

Tested HEAD: `00d83854a01bd9e6da2b133b972c80faf6536c6b`

Base: `deaf757`

## Scope and independence

I read the repository and API `AGENTS.md` files and the complete slice 06 plan.
I inspected the cumulative committed diff from `deaf757` through the pinned HEAD directly.
I did not use a context pack or prior execution prose as verification evidence.
The four pre-existing untracked execution and review artifacts were preserved and excluded from the implementation verdict.

## Command evidence

| Command | Result | Evidence |
|---|---:|---|
| `pnpm run build:packages` | PASS | Shared types and shared utils TypeScript builds exited 0. |
| `pnpm --filter @fxl-sales/api exec vitest run src/domains/sales-ops/__tests__/professional-payable-identity.test.ts src/config/__tests__/docker-migration-contract.test.ts src/db/__tests__/migration-runner.test.ts` | PASS | 3 files and 8 tests passed. |
| `VITEST_INTEGRATION=1 pnpm --filter @fxl-sales/api exec vitest run test/rls/professional-payable-migration.integration.test.ts` | PASS | 1 file and 9 PostgreSQL tests passed. |
| `pnpm --filter @fxl-sales/api test` | PASS | 35 files and 340 unit tests passed. |
| `CI=true TEST_DATABASE_URL=postgresql://fxl_sales_test:fxl_sales_test@localhost:5006/fxl_sales TEST_MIGRATE_DATABASE_URL=postgresql://postgres:postgres@localhost:5006/fxl_sales ADMIN_DATABASE_URL=postgresql://postgres:postgres@localhost:5006/fxl_sales pnpm --filter @fxl-sales/api test:integration` | PASS | 21 files and 128 integration tests passed under the documented application and migration/admin role split. |
| Changed-file ESLint over all eight changed TypeScript files | PASS | ESLint exited 0 with no output. |
| `pnpm --filter @fxl-sales/api type-check` | PASS | TypeScript `--noEmit` exited 0. |
| `pnpm run build` | PASS | Shared packages, API, and web production builds exited 0; Vite transformed 1824 modules. |
| `pnpm --filter @fxl-sales/api exec drizzle-kit check --config drizzle.config.ts` | PASS | Drizzle reported `Everything's fine`. |
| `git diff --exit-code deaf757..HEAD -- apps/api/drizzle/meta/0018_snapshot.json apps/api/drizzle/meta/_journal.json` | PASS | Generated snapshot and journal metadata are unchanged. |
| `git diff --check deaf757..HEAD` | PASS | No whitespace errors. |

An initial full-suite invocation without explicit role variables was setup-invalid because this linked worktree has no `apps/api/.env` and therefore fell back to superuser `postgres`.
The suite's RLS guards correctly rejected that invalid environment.
The authoritative rerun above used the documented non-superuser `fxl_sales_test` application role and separate `postgres` migration/admin URLs and passed completely.

## Requirement inspection

- The runner creates one postgres-js client with `max: 1`, reserves one handle, acquires and releases the session advisory lock through that handle, and routes every migration statement, transaction control statement, and catalog query through it.
- Backend PID checks surround the reserved transactions and migration phases, and the populated oracle observed one PID across every emitted event and result.
- Lock acquisition uses `pg_try_advisory_lock` with finite attempt and retry budgets.
- Real contention tests prove polling, acquisition after release, and deterministic exhaustion after three attempts without contender mutation.
- Ordinary migrations use explicit `BEGIN`, `COMMIT`, and rollback-on-error `ROLLBACK`; PostgreSQL error `22012` left the inserted row, created table, and journal entry rolled back.
- Migration loading matches Drizzle's full-source SHA-256 calculation and journal `when` timestamp semantics.
- Installed Drizzle 0.45.2 source and the repository runner both select pending migrations by greatest `created_at` and insert the full-file hash with that timestamp.
- The repository migration catalog passes `drizzle-kit check`, and the committed snapshot plus `_journal.json` are byte-unchanged from the base.
- The two indexes use `CREATE INDEX CONCURRENTLY` outside transactions.
- The PostgreSQL oracle completed without `25001`, observed an invalid interrupted concurrent index, dropped and rebuilt it, and finished with both `indisvalid = true`.
- The foreign key is added as `NOT VALID`, rejects an invalid new write immediately, is validated only after backfill completion, and finishes with `convalidated = true` and restrictive delete code `r`.
- Backfill update, empty-batch remaining reads, and final pre-journal reads all execute in explicit transactions after setting transaction-local `app.fxl_admin = true`.
- The forced-RLS negative control returns zero without admin context and returns the real candidate count with admin context.
- The only-candidate lock scenario emitted batch sizes `[0, 1, 0]`, proving release and resume after an empty `SKIP LOCKED` batch.
- The exhaustion scenario emitted exactly 50 empty batches and left both the candidate and journal row unchanged.
- The phased parser requires the exact header, exact ordered markers, one marker per breakpoint chunk, and immediate marker-to-SQL placement.
- Production `migrate.ts` and integration `global-setup.ts` both import and await the shared runner; neither imports the stock Drizzle migrator.
- The compiled `dist/db/migrate.js` imports and invokes the compiled shared runner.

## Catalog and cleanup evidence

The persistent local test database catalog reports both target indexes valid and the foreign key validated.
Its pre-existing 0018 journal row retains the hash recorded before this SQL file was rewritten, which is compatible with stock Drizzle's greatest-`created_at` prefix behavior.
Fresh scratch databases exercise the current file hash and exactly-one-row journal behavior.

After the focused and full PostgreSQL suites completed, the admin catalog reported:

```text
scratch_databases=0
scratch_roles=0
scratch_clients=0
test_role=fxl_sales_test,super=false,bypassrls=false
```

The setup-failure test also independently verified that its exact database and role were absent after injected failure.
Every Vitest, TypeScript, ESLint, Drizzle, and build process started by this verification exited.
No watcher was used, and no owned timer or process remained.

## Verdict

PASS for exact cumulative HEAD `00d83854a01bd9e6da2b133b972c80faf6536c6b`.
