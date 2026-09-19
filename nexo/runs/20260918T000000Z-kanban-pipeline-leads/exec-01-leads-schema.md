# exec notes - slice 01-leads-schema

Branch `feat/20260918-01-leads-schema`, commit `501fabf`.
Worktree `.worktrees/20260918T000000Z-kanban-pipeline-leads/01-leads-schema`.

## What shipped

Exactly the eight paths in the plan's `files_modified`, and nothing else.

- `apps/api/src/db/schema.ts` - `salesOpsLeadStages`, `salesOpsLeads`,
  `salesOpsLeadProducts`, appended after `salesOpsSaleProfessionals` and before
  `salesOpsReceivables`.
  Plus the three composite-FK target indexes on existing tables
  (`sales_ops_clients_org_id_id_idx`, `sales_ops_products_org_id_id_idx`,
  `sales_ops_sales_org_id_id_idx`), each with the one-line comment naming its
  consumer. No existing column, constraint or policy changed.
- `apps/api/drizzle/0022_sales_ops_leads.sql` - one migration, hand-ordered.
- `apps/api/drizzle/meta/0022_snapshot.json` - as generated.
- `apps/api/drizzle/meta/_journal.json` - ONE appended entry, tag rewritten to
  `0022_sales_ops_leads`. `git diff --stat apps/api/drizzle` shows
  `1 file changed, 7 insertions(+)`; no older snapshot or migration was rewritten.
- `apps/api/src/domains/sales-ops/service.ts` - the single word `export` in front
  of `withTenant`, plus the two-line comment the plan dictates. The diff is
  exactly those three lines.
- `apps/api/src/domains/sales-ops/leads/stages-seed.ts` - new directory, one file:
  `LEAD_STAGE_SEEDS`, `SYSTEM_LEAD_STAGE_KINDS`, `ensureLeadStages`,
  `ensureLeadStagesForOrg`. No route, no router, no zod schema.
- `apps/api/test/rls/leads-schema-migration.test.ts` - 12 oracles.
- `apps/api/test/rls/leads-rls.test.ts` - 6 oracles.

The contract's binding points are honoured: `kind` has exactly the three values
`'normal' | 'conversion' | 'lost'`, there is no `slug` column, and
`sales_ops_lead_stages_org_name_idx` is a real UNIQUE `(org_id, name)` database
index mirroring `sales_ops_funcoes_org_name_idx`.

## Red before green

Both test files were written first and run before any implementation existed.
They went red at COLLECTION with
`Cannot find module '../../src/domains/sales-ops/leads/stages-seed.js'`, which is
the right reason: the module the oracles drive did not exist.

## Two corrections made during the run, both worth recording

1. **drizzle-kit emitted the FK `ALTER TABLE`s BEFORE the composite-FK target
   indexes.** That ordering cannot apply: `ADD CONSTRAINT ... REFERENCES
   sales_ops_clients(org_id, id)` needs the unique index on those columns to exist
   already. The shipped file is hand-ordered into the plan's §3.2 order (tables,
   then every index, then the six FKs, then RLS, then `set_config`, then the seed),
   and that ordering is now proven by a from-scratch migrate (below) rather than
   only by the already-migrated test database.
2. **My own migration header tripped `single-role-db-contract.test.ts`.** The
   header explained that a journaled migration must never carry a
   `CREATE ROLE` / `ALTER ROLE` / `GRANT ... TO <role>` - and that guard reads
   every migration's raw bytes and matches `/\bCREATE\s+ROLE\b/i`, so the prose
   describing the rule violated it. The paragraph was reworded to say the same
   thing without the literal spellings. Worth knowing for slices 02 and 03: that
   guard does not parse SQL, it greps, and a comment counts.

## Decisiveness probes

The two most load-bearing constraints were dropped in the database and the
matching oracle re-run, to prove neither passes vacuously:

- `DROP CONSTRAINT sales_ops_lead_stages_system_kind_check` ->
  `rejects a stage whose kind and is_system disagree` FAILED.
- `DROP INDEX sales_ops_lead_stages_org_name_idx` ->
  `refuses a second stage with the same name in one org and allows that name in
  another org` FAILED.

Both were restored afterwards, and the full integration suite was re-run green
after the restore.

## From-scratch migrate

Because the shared test database already carried 0022 from the first run, the
migration was also applied to a brand-new database (`fxl_leads_fresh`, created and
dropped inside the run) through the real `runDatabaseMigrations`. It reported
`FRESH MIGRATE OK` and the three tables came out with `relforcerowsecurity = t`.
That is what proves the hand-ordering in correction 1 above.

## Commands actually run, with their real output

```
VITEST_INTEGRATION=1 vitest run test/rls/leads-schema-migration.test.ts test/rls/leads-rls.test.ts
  Test Files  2 passed (2)
       Tests  18 passed (18)

pnpm --filter @fxl-sales/api test:integration
  Test Files  27 passed (27)
       Tests  187 passed (187)

pnpm --filter @fxl-sales/api test          (the unit project, plan §5.3)
  Test Files  46 passed (46)
       Tests  478 passed (478)

pnpm run lint
  apps/api lint: Done
  apps/web lint: Done

pnpm run type-check
  apps/api type-check: Done
  apps/web type-check: Done
```

## Environment note for the next executor

`packages/shared-types` and `packages/shared-utils` had no `dist/` in a fresh
worktree, so every integration file that imports `service.ts` failed to resolve
`@fxl-sales/shared-utils` before any test ran. `pnpm run build:packages` (or
`pnpm run type-check`, which does it first) fixes it. Nothing in the slice caused
this; it is a fresh-worktree fact.

## Out of scope, confirmed untouched

`routes.ts`, `salesOpsRouter`, `SALE_TRANSITIONS`, `getSalesOpsSnapshot`,
`getSalesOpsSummary`, `computeSaleFinancials`, `buildSaleLedger`,
`purge-service.ts`, the legacy `leads` table, `apps/web`, `packages/shared-types`
and `CLAUDE.md` are all byte-unchanged. No DELETE verb was added. Nothing about
leads reaches `/bootstrap`. No open question for `AUDIT.md`.
