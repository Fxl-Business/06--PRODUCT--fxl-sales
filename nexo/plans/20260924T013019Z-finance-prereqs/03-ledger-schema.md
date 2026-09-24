---
id: 03-ledger-schema
milestone: v4.1.0
status: done
depends_on: []
files_modified: [apps/api/drizzle/0024_sales_ops_settlements.sql, apps/api/drizzle/meta/_journal.json, apps/api/drizzle/meta/0024_snapshot.json, apps/api/src/db/schema.ts, apps/api/src/db/__tests__/settlements-schema-contract.test.ts, apps/api/src/db/__tests__/settlement-test-cleanup.ts, apps/api/test/rls/scratch-database.ts, apps/api/test/rls/settlements-schema.test.ts, apps/api/test/rls/settlements-schema-migration.test.ts, apps/api/scripts/seed/plan.ts, apps/api/scripts/seed-dev.ts, apps/api/scripts/__tests__/seed-plan.test.ts, CLAUDE.md, nexo/knowledge/reference/propostas.md]
goal: "Contract C3 as one ordinary migration 0024_sales_ops_settlements: revision and updated_at on receivables and payables, removed_at on sale items and sale professionals, the immutable FORCE-RLS sales_ops_settlements table, and one synthetic baixa per pre-existing paid row, with the Drizzle mirror, the dev seed and the test cleanup kept coherent."
acceptance: ["migration apps/api/drizzle/0024_sales_ops_settlements.sql is journaled as idx 24 and applied by the shared runner in one ordinary transaction", "sales_ops_receivables and sales_ops_payables have revision integer NOT NULL DEFAULT 1 CHECK >= 1 and updated_at timestamptz NOT NULL DEFAULT now()", "sales_ops_sale_items and sales_ops_sale_professionals have a nullable removed_at timestamptz with no default, mirrored as removedAt in Drizzle (slice 04 soft-removes lines with it)", "sales_ops_settlements exists with every C3 column, every named CHECK, composite ON DELETE RESTRICT foreign keys, a unique index allowing at most one estorno per baixa, and indexes on (org_id, sale_id), (org_id, receivable_id) and (org_id, payable_id)", "any UPDATE or DELETE on sales_ops_settlements fails with SQLSTATE FXS01, for the tenant role and for a superuser admin connection", "an estorno whose row, sale, kind or amount differs from its baixa, or that reverses an estorno, fails with SQLSTATE FXS02", "under FORCE RLS a tenant connection cannot read another org's settlements and cannot insert one with a foreign org_id", "a database populated at 0023 gets exactly one baixa per paid receivable or payable with amount_brl > 0 (amount = row amount, origin manual, actor_user_id system, actor_name Migração), none for open, void or zero-amount rows, and paid_on = LEAST(UTC civil due day, Sao Paulo today)", "the dev seed writes one synthetic baixa per seeded paid row and re-seeding an org that has settlements succeeds", "test and seed cleanup can remove settlements without any product-code bypass", "CLAUDE.md and nexo/knowledge/reference/propostas.md describe the settlements table rules in the same change"]
---

# 03 - Ledger schema: revision, updated_at and the immutable settlements table

## Context

Verified in the worktree on 2026-09-23.

Migrations and runner:
- `apps/api/drizzle/` ends at `0023_lead_seller_identity.sql`; `meta/_journal.json` ends at `idx: 23`, `when: 1789782282603`, `tag: "0023_lead_seller_identity"`, and every migration since 0000 has a `meta/NNNN_snapshot.json` (0023's includes the leads tables and `sales_ops_people.hub_account_id`, so snapshots are maintained by `drizzle-kit generate` and then the SQL is hand-edited).
- `apps/api/src/db/migration-runner.ts` is the shared runner.
  Only the tag `0018_professional_payable_identity` may be phased (`phasedTag`, line ~68); a file that starts with `-- fxl-migration-mode: phased` under any other tag throws, and a `-- fxl-phase:` marker without the header throws.
  Every other migration is split on the literal `--> statement-breakpoint` and run statement by statement inside ONE transaction together with the journal insert (`runCheckedTransaction`, bottom of `runDatabaseMigrations`), so a `RAISE EXCEPTION` anywhere rolls back the whole file and its journal row.
  `when` values must be strictly increasing.
- `apps/api/src/db/__tests__/single-role-db-contract.test.ts` reads the bytes of every `.sql` file and fails on `CREATE ROLE`, `ALTER ROLE`, the word `BYPASSRLS`, or `TO fxl_sales_(owner|app|admin)`, even inside comments.
- `0022_sales_ops_leads.sql` is the template for a new tenant table: composite `(org_id, x_id)` FKs with `ON DELETE restrict`, `ENABLE` plus `FORCE ROW LEVEL SECURITY`, two policies `<table>_tenant_isolation` (`org_id = current_setting('app.current_org_id', true)`) and `<table>_admin_context` (`current_setting('app.fxl_admin', true) = 'true'`), no GRANT, and a backfill that first runs `SELECT set_config('app.fxl_admin', 'true', true);` because FORCE RLS applies to the migrating owner in staging and production.
- There is no per-role policy anywhere: the `fxl_sales_test` role reads tables through `ALTER DEFAULT PRIVILEGES` provisioned once outside migrations (`nexo/knowledge/decisions/2026-07-29-integration-tests-are-hermetic-local.md:37-49`), which covers a new table with no GRANT.
- No migration in this repo creates a trigger yet (`0017` and `0022` headers say so); this is the first.

Tables (`apps/api/src/db/schema.ts`):
- `salesOpsReceivables` (lines 1114-1129): `id, orgId, saleId, label, dueDate timestamptz, amountBrl integer, method, status ('open'|'paid'|'void')`, index `sales_ops_receivables_sale_id_idx`, single-column FK to `sales_ops_sales.id`. No `paid_at`, no `updated_at`, no revision.
- `salesOpsPayables` (lines 1131-1167): `id, orgId, saleId, beneficiaryName, kind, receivableId (FK set null), saleProfessionalId, dueDate, amountBrl, status`.
- `salesOpsSales` already has `uniqueIndex('sales_ops_sales_org_id_id_idx').on(t.orgId, t.id)` (line ~826), the composite-FK target 0022 created.
- `schema.ts` imports from `drizzle-orm/pg-core` (lines 24-38) do NOT include `date`.
- Both ledger tables already have FORCE RLS plus both policies from `0008_single_role_rls_context.sql:127-175`; a new column inherits them.

What "paid" is today:
- No production code in `apps/api/src/domains/sales-ops` writes `status = 'paid'` (audit 2.1: only test fixtures do; `git grep "'paid'" apps/api/src/domains/sales-ops` finds nothing outside tests).
- The dev seed DOES: `apps/api/scripts/seed/plan.ts:1095` marks S1's first installment receivable paid and `buildCommissionPayables` (`plan.ts:642-720`) marks its seller, finder and tax payables paid; every paid row is due `isoDateTime(cutoff.iso)` (default cutoff `2026-09-01`).
- The only date a paid row carries is `due_date` (civil day `D` stored as `D T00:00:00Z`, contract C1). `sales_ops_sales.won_at` exists but belongs to the sale, not the row.

Who deletes ledger rows (interaction with ON DELETE RESTRICT):
- `updateSale` (`service.ts:2466-2479`) deletes payables, receivables, professionals and items of a `draft`/`open` sale; it refuses `won|lost|cancelled` (`:2458`). Slice 04 replaces this with in-place reconcile.
- `purge-service.ts` deletes only products, people, funções and áreas (`:118`, `:148`, `:183`, `:211`); settlements reference none of them, so the nightly purge is unaffected.
- `apps/api/scripts/seed-dev.ts:296-330` deletes every sales-ops table per dev org inside `withTenant` (children first, `EXPECTED_DELETE_ORDER` at `:67-84` must equal `SEED_DELETE_ORDER` in `plan.ts:167-184`), then inserts in `SEED_WRITE_ORDER` (`plan.ts:148-165`).
  It connects through `getDb()` with the local `DATABASE_URL` (`postgres:postgres@localhost:5006`, a superuser, `apps/api/.env.dev.example:18`).
- Integration tests delete by org in `afterAll`/`afterEach` (`test/rls/proposal-write.test.ts:52-56`, `leads-seller-scope.test.ts:94-98`, `src/domains/sales-ops/__tests__/sale-transitions.integration.test.ts:149-157`, and others). None of them creates a settlement, so none breaks in this slice; slices 04 and 06 will create settlements and must call the cleanup helper this slice ships BEFORE their existing deletes.
- `TRUNCATE` does not fire row-level triggers, but no test truncates and `fxl_sales_test` has no TRUNCATE privilege; the cleanup path below does not use it.

Test harness:
- `vitest.config.ts`: `test:integration` runs `test/rls/**/*.test.ts` and `src/**/*.integration.test.ts` serially after `test/rls/global-setup.ts` migrates the local test DB with `TEST_MIGRATE_DATABASE_URL` (the local `postgres` superuser). `TEST_DATABASE_URL` is the non-superuser `fxl_sales_test`; `ADMIN_DATABASE_URL` is the local superuser.
- `test/rls/professional-payable-migration.integration.test.ts:117-204` creates a scratch database owned by a fresh NOSUPERUSER role, migrates it with `runDatabaseMigrations({ throughTag })`, seeds under `set_config('app.fxl_admin', 'true', true)` and drops it in `afterEach`. That is the only way to seed rows BEFORE a migration, and it runs the migration as a non-superuser owner, so FORCE RLS genuinely applies to the backfill.
- `test/rls/leads-schema-migration.test.ts:50-70` replays shipped migration statements by splitting the real file on `--> statement-breakpoint`.
- `apps/api/tsconfig.json` has `rootDir: ./src` and includes `src/**/*`, so a `src/**/__tests__` file may not import from `apps/api/test/`; the precedent for a shared non-test helper under `src` is `apps/api/src/auth/__tests__/hub-auth-context-fixture.ts`.

Finance mirror (`01--PRODUCT--fxl-finance/.../02-baixas-migracao.md`): table `lancamento_baixas` with `CHECK (num_nonnulls(...) = 1)`, `(tipo = 'estorno') = (estorna_baixa_id IS NOT NULL)`, `valor_centavos > 0`, motivo only on estorno, a partial unique index "one estorno per baixa", a `BEFORE UPDATE` trigger raising SQLSTATE `FXB01`, a `BEFORE INSERT` trigger raising `FXB02` when an estorno does not mirror its baixa, a backfill, and a `DO` verification raising `FXB03`.
Finance deliberately has NO delete trigger because its portability restore deletes by `org_id` and its FKs cascade; Sales has neither, so Sales refuses DELETE too (see Decisions).

## Design

### Names fixed by this slice (slices 04 and 06 code against them)

- Migration tag `0024_sales_ops_settlements`, file `apps/api/drizzle/0024_sales_ops_settlements.sql`.
- Drizzle export `salesOpsSettlements`; constants `SETTLEMENT_TYPES = ['baixa', 'estorno'] as const`, `SETTLEMENT_TARGET_KINDS = ['receivable', 'payable'] as const`, `SETTLEMENT_ORIGINS = ['manual', 'finance'] as const`, all exported from `schema.ts`.
- SQLSTATEs: `FXS01` immutability (UPDATE or DELETE), `FXS02` estorno does not mirror its baixa, `FXS03` migration 0024 backfill verification failed. Slice 06 maps `23505` on `sales_ops_settlements_one_estorno_per_baixa_idx` to `409 already_reversed`.
- A settlement's `sale_id` MUST equal the target row's `sale_id` (enforced by the composite FK); slice 06 copies it from the row.
- Synthetic actor: `actor_user_id = 'system'`, `actor_name = 'Migração'` (migration) or `'Seed de desenvolvimento'` (dev seed).

### Drizzle schema (`apps/api/src/db/schema.ts`)

1. Add `date` to the `drizzle-orm/pg-core` import list (alphabetical, between `check` and `foreignKey`).
2. `salesOpsReceivables`: append columns and extend the table callback. Keep the existing index.

```ts
    status: text('status').notNull().default('open'), // 'open' | 'paid' | 'void'
    /**
     * Monotonic per-row revision (contract C7): starts at 1 and is bumped by
     * exactly 1, together with updated_at, in the same statement as any change of
     * amount, due date, counterparty or status. The integration will publish it.
     */
    revision: integer('revision').notNull().default(1),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('sales_ops_receivables_sale_id_idx').on(t.saleId),
    // Composite-FK target for sales_ops_settlements.(org_id, sale_id, receivable_id).
    uniqueIndex('sales_ops_receivables_org_sale_id_id_idx').on(t.orgId, t.saleId, t.id),
    check('sales_ops_receivables_revision_check', sql`${t.revision} >= 1`),
  ],
```

2b. `salesOpsSaleItems` and `salesOpsSaleProfessionals` (plan-check resolution of slice 04's deviation D1): append to each table's columns, as the last column,
   ```ts
    /** Soft removal (PC2): set when the line leaves the proposta on edit; readers filter removed_at IS NULL. Never deleted: sales_ops_payables pins professionals with a RESTRICT FK. */
    removedAt: timestamp('removed_at', { withTimezone: true }),
   ```
   Nullable, no default, no index (every reader already filters by `sale_id`). Slice 04 owns every reader and writer of the column; this slice only ships it.
3. `salesOpsPayables`: same two columns (same doc comment, shortened to "See salesOpsReceivables.revision."), plus in its callback `uniqueIndex('sales_ops_payables_org_sale_id_id_idx').on(t.orgId, t.saleId, t.id)` and `check('sales_ops_payables_revision_check', sql\`${t.revision} >= 1\`)`.
4. New table directly after `salesOpsPayables`, preceded by a section comment block in the file's `// ───` style explaining: immutable facts, estorno instead of edit, FXS01/FXS02, composite FKs and why RESTRICT, no product-code DELETE path.

```ts
export const SETTLEMENT_TYPES = ['baixa', 'estorno'] as const;
export const SETTLEMENT_TARGET_KINDS = ['receivable', 'payable'] as const;
export const SETTLEMENT_ORIGINS = ['manual', 'finance'] as const;

export const salesOpsSettlements = pgTable(
  'sales_ops_settlements',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    saleId: uuid('sale_id').notNull(),
    targetKind: text('target_kind').notNull(), // 'receivable' | 'payable'
    receivableId: uuid('receivable_id'),
    payableId: uuid('payable_id'),
    type: text('type').notNull(), // 'baixa' | 'estorno'
    reversesSettlementId: uuid('reverses_settlement_id'),
    /** Civil São Paulo day `YYYY-MM-DD`; for an estorno, the reversal day. */
    paidOn: date('paid_on', { mode: 'string' }).notNull(),
    amountBrl: integer('amount_brl').notNull(),
    origin: text('origin').notNull().default('manual'), // 'manual' | 'finance'
    actorUserId: text('actor_user_id').notNull(),
    actorName: text('actor_name'),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).defaultNow().notNull(),
    reason: text('reason'),
  },
  (t) => [
    uniqueIndex('sales_ops_settlements_org_id_id_idx').on(t.orgId, t.id),
    index('sales_ops_settlements_org_sale_idx').on(t.orgId, t.saleId),
    index('sales_ops_settlements_org_receivable_idx')
      .on(t.orgId, t.receivableId)
      .where(sql`${t.receivableId} is not null`),
    index('sales_ops_settlements_org_payable_idx')
      .on(t.orgId, t.payableId)
      .where(sql`${t.payableId} is not null`),
    uniqueIndex('sales_ops_settlements_one_estorno_per_baixa_idx')
      .on(t.reversesSettlementId)
      .where(sql`${t.reversesSettlementId} is not null`),
    check('sales_ops_settlements_target_kind_check', sql`${t.targetKind} in ('receivable', 'payable')`),
    check(
      'sales_ops_settlements_target_check',
      sql`(${t.targetKind} = 'receivable' and ${t.receivableId} is not null and ${t.payableId} is null) or (${t.targetKind} = 'payable' and ${t.payableId} is not null and ${t.receivableId} is null)`,
    ),
    check('sales_ops_settlements_type_check', sql`${t.type} in ('baixa', 'estorno')`),
    check(
      'sales_ops_settlements_reverses_check',
      sql`(${t.type} = 'estorno') = (${t.reversesSettlementId} is not null)`,
    ),
    check(
      'sales_ops_settlements_reverses_not_self_check',
      sql`${t.reversesSettlementId} is null or ${t.reversesSettlementId} <> ${t.id}`,
    ),
    check('sales_ops_settlements_amount_check', sql`${t.amountBrl} > 0`),
    check('sales_ops_settlements_origin_check', sql`${t.origin} in ('manual', 'finance')`),
    check('sales_ops_settlements_reason_check', sql`${t.type} = 'estorno' or ${t.reason} is null`),
    check('sales_ops_settlements_actor_check', sql`length(btrim(${t.actorUserId})) > 0`),
    foreignKey({
      columns: [t.orgId, t.saleId],
      foreignColumns: [salesOpsSales.orgId, salesOpsSales.id],
      name: 'sales_ops_settlements_org_sale_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [t.orgId, t.saleId, t.receivableId],
      foreignColumns: [salesOpsReceivables.orgId, salesOpsReceivables.saleId, salesOpsReceivables.id],
      name: 'sales_ops_settlements_org_sale_receivable_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [t.orgId, t.saleId, t.payableId],
      foreignColumns: [salesOpsPayables.orgId, salesOpsPayables.saleId, salesOpsPayables.id],
      name: 'sales_ops_settlements_org_sale_payable_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [t.orgId, t.reversesSettlementId],
      foreignColumns: [t.orgId, t.id],
      name: 'sales_ops_settlements_org_reverses_fk',
    }).onDelete('restrict'),
  ],
);
```

The self-reference `foreignColumns: [t.orgId, t.id]` works because the extra-config callback receives the table's own columns as `t`; no `AnyPgColumn` annotation is needed.

### Migration `apps/api/drizzle/0024_sales_ops_settlements.sql`

Produce it in two moves so the snapshot stays machine-made:
1. After editing `schema.ts`, run `pnpm --filter @fxl-sales/api exec drizzle-kit generate --name sales_ops_settlements` (offline, it never connects). It writes `0024_sales_ops_settlements.sql`, `meta/0024_snapshot.json` and the idx 24 journal entry. It must NOT prompt (no renames); if it prompts, abort and report.
2. Replace the whole generated `.sql` body with EXACTLY the text below (the constraint, index and FK names are identical to the Drizzle ones, so the next `generate` diffs to nothing). Keep the generated snapshot and journal entry untouched (`breakpoints: true`, `version: "7"`, `when` = generated timestamp, which is greater than `1789782282603`).

Fallback only if `drizzle-kit` cannot run: append `{ "idx": 24, "version": "7", "when": <Date.now()>, "tag": "0024_sales_ops_settlements", "breakpoints": true }` to `_journal.json` by hand, and create `0024_snapshot.json` by copying `0023_snapshot.json`, giving it a fresh `id` (random uuid), `prevId` = 0023's `id`, and adding the two columns, the two unique indexes and checks on the ledger tables and the new table entry in the same JSON shape 0023 uses for `sales_ops_leads`.

Rules for the file: one SQL statement per breakpoint chunk (postgres.js `unsafe` refuses two commands in one prepared statement); never write the words `CREATE ROLE`, `ALTER ROLE`, the RLS-bypass attribute word, `GRANT`, the literal breakpoint marker, or `-- fxl-phase:` anywhere, comments included; no em dash.

```sql
-- 0024_sales_ops_settlements - baixa and estorno facts for the ledger, and a per-row revision.
--
-- LINES: sales_ops_sale_items and sales_ops_sale_professionals gain a nullable
-- `removed_at`. Editing a proposta soft-removes a line instead of deleting it, so
-- ids stay stable and the RESTRICT FK from sales_ops_payables keeps holding.
-- Readers filter removed_at IS NULL. Existing RLS policies cover the new column.
--
-- WHAT: sales_ops_receivables and sales_ops_payables gain `revision` (starts at 1,
-- bumped by exactly 1 with every change of amount, due date, counterparty or
-- status, contract C7) and `updated_at`. The new tenant table
-- sales_ops_settlements holds immutable settlement facts: a `baixa` records a real
-- payment day and amount against ONE receivable or payable, an `estorno`
-- reverses exactly one baixa. A row's paid state is a pure function of its facts
-- (active baixa = a baixa no estorno points at; paid = sum of active; displayed
-- day = the greatest active paid_on), the same rules as Finance's
-- reduzirLiquidacao. `status = 'paid'` stays on the ledger rows as a cache.
--
-- IMMUTABILITY: a BEFORE UPDATE OR DELETE trigger refuses every change with
-- SQLSTATE FXS01. A correction is an estorno plus a new baixa, never an edit.
-- Finance refuses UPDATE only, because its restore deletes by org and its FKs
-- cascade. Sales has neither: nothing in the product deletes a sale, and every
-- FK here is RESTRICT, so a settled row, its sale and a reversed baixa can never
-- disappear. Local tests and the dev seed remove settlements only as the local
-- superuser with session_replication_role = replica; product code has no path.
-- A BEFORE INSERT trigger refuses, with SQLSTATE FXS02, an estorno that does not
-- mirror its baixa (same org, sale, kind, row and amount; the target must be a
-- baixa). The CHECKs and FKs keep their own SQLSTATEs (23514, 23503), because
-- the insert trigger returns early for every case they already refuse.
--
-- TENANCY: org_id text NOT NULL, FORCE ROW LEVEL SECURITY with the same two
-- policies 0012 and 0022 spell. Every FK is composite and leads with org_id, and
-- the row FKs also carry sale_id, so a settlement cannot point at another org's
-- row or at a row of a different sale even in the admin context. A single-column
-- FK would not consult the RLS predicate.
--
-- ONE ESTORNO PER BAIXA: a partial unique index on reverses_settlement_id.
-- A second estorno of the same baixa fails with 23505.
--
-- BACKFILL: before this file no production code could write status = 'paid'
-- (only test fixtures and the dev seed did), so the backfill is expected to be
-- empty in staging and production. Every paid row with amount_brl > 0 gets ONE
-- synthetic baixa: amount = the row amount, origin 'manual', actor_user_id
-- 'system', actor_name 'Migração'. No row stores a payment day, so paid_on is the
-- row's civil due day (the UTC day of due_date, the storage convention of
-- dateFromIsoDay), clamped to today in America/Sao_Paulo so it is never in the
-- future. A paid row with amount_brl <= 0 gets no baixa: the amount CHECK forbids
-- it and the reducer reads a zero row as settled with no fact. The final DO block
-- recomputes every paid row from its facts and aborts the whole file with
-- SQLSTATE FXS03 on any divergence, journal row included.
--
-- PRE-FLIGHT against a real target before deploying (comment only):
-- SELECT 'receivable' AS kind, count(*) FROM sales_ops_receivables WHERE status = 'paid'
-- UNION ALL SELECT 'payable', count(*) FROM sales_ops_payables WHERE status = 'paid';
--
-- No privilege statement appears in this file. The test role already holds
-- ALTER DEFAULT PRIVILEGES on new public tables, and a journaled migration must
-- never create, alter or grant to a cluster role; see the single-role database
-- contract test, which reads every migration's bytes.
ALTER TABLE "sales_ops_receivables" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_ops_receivables" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_ops_receivables" ADD CONSTRAINT "sales_ops_receivables_revision_check" CHECK ("sales_ops_receivables"."revision" >= 1);--> statement-breakpoint
ALTER TABLE "sales_ops_payables" ADD COLUMN "revision" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_ops_payables" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "sales_ops_payables" ADD CONSTRAINT "sales_ops_payables_revision_check" CHECK ("sales_ops_payables"."revision" >= 1);--> statement-breakpoint
ALTER TABLE "sales_ops_sale_items" ADD COLUMN "removed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sales_ops_sale_professionals" ADD COLUMN "removed_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "sales_ops_receivables_org_sale_id_id_idx" ON "sales_ops_receivables" USING btree ("org_id","sale_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_ops_payables_org_sale_id_id_idx" ON "sales_ops_payables" USING btree ("org_id","sale_id","id");--> statement-breakpoint
CREATE TABLE "sales_ops_settlements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"sale_id" uuid NOT NULL,
	"target_kind" text NOT NULL,
	"receivable_id" uuid,
	"payable_id" uuid,
	"type" text NOT NULL,
	"reverses_settlement_id" uuid,
	"paid_on" date NOT NULL,
	"amount_brl" integer NOT NULL,
	"origin" text DEFAULT 'manual' NOT NULL,
	"actor_user_id" text NOT NULL,
	"actor_name" text,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reason" text,
	CONSTRAINT "sales_ops_settlements_target_kind_check" CHECK ("sales_ops_settlements"."target_kind" in ('receivable', 'payable')),
	CONSTRAINT "sales_ops_settlements_target_check" CHECK (("sales_ops_settlements"."target_kind" = 'receivable' and "sales_ops_settlements"."receivable_id" is not null and "sales_ops_settlements"."payable_id" is null) or ("sales_ops_settlements"."target_kind" = 'payable' and "sales_ops_settlements"."payable_id" is not null and "sales_ops_settlements"."receivable_id" is null)),
	CONSTRAINT "sales_ops_settlements_type_check" CHECK ("sales_ops_settlements"."type" in ('baixa', 'estorno')),
	CONSTRAINT "sales_ops_settlements_reverses_check" CHECK (("sales_ops_settlements"."type" = 'estorno') = ("sales_ops_settlements"."reverses_settlement_id" is not null)),
	CONSTRAINT "sales_ops_settlements_reverses_not_self_check" CHECK ("sales_ops_settlements"."reverses_settlement_id" is null or "sales_ops_settlements"."reverses_settlement_id" <> "sales_ops_settlements"."id"),
	CONSTRAINT "sales_ops_settlements_amount_check" CHECK ("sales_ops_settlements"."amount_brl" > 0),
	CONSTRAINT "sales_ops_settlements_origin_check" CHECK ("sales_ops_settlements"."origin" in ('manual', 'finance')),
	CONSTRAINT "sales_ops_settlements_reason_check" CHECK ("sales_ops_settlements"."type" = 'estorno' or "sales_ops_settlements"."reason" is null),
	CONSTRAINT "sales_ops_settlements_actor_check" CHECK (length(btrim("sales_ops_settlements"."actor_user_id")) > 0)
);--> statement-breakpoint
CREATE UNIQUE INDEX "sales_ops_settlements_org_id_id_idx" ON "sales_ops_settlements" USING btree ("org_id","id");--> statement-breakpoint
CREATE INDEX "sales_ops_settlements_org_sale_idx" ON "sales_ops_settlements" USING btree ("org_id","sale_id");--> statement-breakpoint
CREATE INDEX "sales_ops_settlements_org_receivable_idx" ON "sales_ops_settlements" USING btree ("org_id","receivable_id") WHERE "sales_ops_settlements"."receivable_id" is not null;--> statement-breakpoint
CREATE INDEX "sales_ops_settlements_org_payable_idx" ON "sales_ops_settlements" USING btree ("org_id","payable_id") WHERE "sales_ops_settlements"."payable_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "sales_ops_settlements_one_estorno_per_baixa_idx" ON "sales_ops_settlements" USING btree ("reverses_settlement_id") WHERE "sales_ops_settlements"."reverses_settlement_id" is not null;--> statement-breakpoint
ALTER TABLE "sales_ops_settlements" ADD CONSTRAINT "sales_ops_settlements_org_sale_fk" FOREIGN KEY ("org_id","sale_id") REFERENCES "public"."sales_ops_sales"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_ops_settlements" ADD CONSTRAINT "sales_ops_settlements_org_sale_receivable_fk" FOREIGN KEY ("org_id","sale_id","receivable_id") REFERENCES "public"."sales_ops_receivables"("org_id","sale_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_ops_settlements" ADD CONSTRAINT "sales_ops_settlements_org_sale_payable_fk" FOREIGN KEY ("org_id","sale_id","payable_id") REFERENCES "public"."sales_ops_payables"("org_id","sale_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_ops_settlements" ADD CONSTRAINT "sales_ops_settlements_org_reverses_fk" FOREIGN KEY ("org_id","reverses_settlement_id") REFERENCES "public"."sales_ops_settlements"("org_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE FUNCTION "public"."sales_ops_settlements_refuse_mutation"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'sales_ops_settlements is immutable: % of settlement % refused, record an estorno instead', TG_OP, OLD."id"
    USING ERRCODE = 'FXS01';
END
$$;--> statement-breakpoint
CREATE TRIGGER "sales_ops_settlements_immutable" BEFORE UPDATE OR DELETE ON "sales_ops_settlements"
  FOR EACH ROW EXECUTE FUNCTION "public"."sales_ops_settlements_refuse_mutation"();--> statement-breakpoint
CREATE FUNCTION "public"."sales_ops_settlements_validate_insert"() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target "public"."sales_ops_settlements"%ROWTYPE;
BEGIN
  IF NEW."type" IS DISTINCT FROM 'estorno' OR NEW."reverses_settlement_id" IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT * INTO target FROM "public"."sales_ops_settlements" WHERE "id" = NEW."reverses_settlement_id";
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;
  IF target."type" <> 'baixa'
     OR target."org_id" IS DISTINCT FROM NEW."org_id"
     OR target."sale_id" IS DISTINCT FROM NEW."sale_id"
     OR target."target_kind" IS DISTINCT FROM NEW."target_kind"
     OR target."receivable_id" IS DISTINCT FROM NEW."receivable_id"
     OR target."payable_id" IS DISTINCT FROM NEW."payable_id"
     OR target."amount_brl" <> NEW."amount_brl" THEN
    RAISE EXCEPTION 'sales_ops_settlements: estorno % does not mirror baixa %', NEW."id", NEW."reverses_settlement_id"
      USING ERRCODE = 'FXS02';
  END IF;
  RETURN NEW;
END
$$;--> statement-breakpoint
CREATE TRIGGER "sales_ops_settlements_validate" BEFORE INSERT ON "sales_ops_settlements"
  FOR EACH ROW EXECUTE FUNCTION "public"."sales_ops_settlements_validate_insert"();--> statement-breakpoint
ALTER TABLE sales_ops_settlements ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE sales_ops_settlements FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY sales_ops_settlements_tenant_isolation ON sales_ops_settlements
  AS PERMISSIVE FOR ALL
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));--> statement-breakpoint
CREATE POLICY sales_ops_settlements_admin_context ON sales_ops_settlements
  AS PERMISSIVE FOR ALL
  USING (current_setting('app.fxl_admin', true) = 'true')
  WITH CHECK (current_setting('app.fxl_admin', true) = 'true');--> statement-breakpoint
SELECT set_config('app.fxl_admin', 'true', true);--> statement-breakpoint
INSERT INTO "sales_ops_settlements" (
  "org_id", "sale_id", "target_kind", "receivable_id", "type", "paid_on",
  "amount_brl", "origin", "actor_user_id", "actor_name"
)
SELECT r."org_id", r."sale_id", 'receivable', r."id", 'baixa',
       LEAST((r."due_date" AT TIME ZONE 'UTC')::date, (now() AT TIME ZONE 'America/Sao_Paulo')::date),
       r."amount_brl", 'manual', 'system', 'Migração'
FROM "sales_ops_receivables" r
WHERE r."status" = 'paid'
  AND r."amount_brl" > 0
  AND NOT EXISTS (
    SELECT 1 FROM "sales_ops_settlements" s
    WHERE s."org_id" = r."org_id" AND s."receivable_id" = r."id"
  );--> statement-breakpoint
INSERT INTO "sales_ops_settlements" (
  "org_id", "sale_id", "target_kind", "payable_id", "type", "paid_on",
  "amount_brl", "origin", "actor_user_id", "actor_name"
)
SELECT p."org_id", p."sale_id", 'payable', p."id", 'baixa',
       LEAST((p."due_date" AT TIME ZONE 'UTC')::date, (now() AT TIME ZONE 'America/Sao_Paulo')::date),
       p."amount_brl", 'manual', 'system', 'Migração'
FROM "sales_ops_payables" p
WHERE p."status" = 'paid'
  AND p."amount_brl" > 0
  AND NOT EXISTS (
    SELECT 1 FROM "sales_ops_settlements" s
    WHERE s."org_id" = p."org_id" AND s."payable_id" = p."id"
  );--> statement-breakpoint
DO $$
DECLARE
  divergent bigint;
BEGIN
  WITH paid_rows AS (
    SELECT r."org_id", r."id", r."amount_brl" FROM "public"."sales_ops_receivables" r
    WHERE r."status" = 'paid' AND r."amount_brl" > 0
    UNION ALL
    SELECT p."org_id", p."id", p."amount_brl" FROM "public"."sales_ops_payables" p
    WHERE p."status" = 'paid' AND p."amount_brl" > 0
  ), active AS (
    SELECT b."org_id", coalesce(b."receivable_id", b."payable_id") AS "row_id", sum(b."amount_brl") AS "paid_brl"
    FROM "public"."sales_ops_settlements" b
    WHERE b."type" = 'baixa'
      AND NOT EXISTS (
        SELECT 1 FROM "public"."sales_ops_settlements" e WHERE e."reverses_settlement_id" = b."id"
      )
    GROUP BY 1, 2
  )
  SELECT count(*) INTO divergent
  FROM paid_rows pr
  LEFT JOIN active a ON a."org_id" = pr."org_id" AND a."row_id" = pr."id"
  WHERE coalesce(a."paid_brl", 0) <> pr."amount_brl";
  IF divergent > 0 THEN
    RAISE EXCEPTION 'migration 0024 aborted: % paid ledger row(s) whose active baixas do not sum to the row amount', divergent
      USING ERRCODE = 'FXS03';
  END IF;
END
$$;
```

Why each piece (tell the executor not to "simplify"):
- `(due_date AT TIME ZONE 'UTC')::date`, never `due_date::date`: the cast uses the session TimeZone, and a session in `America/Sao_Paulo` turns `2026-03-01T00:00:00Z` into `2026-02-28`. The migration oracle runs the scratch DB in São Paulo time to catch exactly that.
- `LEAST(..., São Paulo today)`: a paid row due in the future must not produce a future `paid_on` (contract C3, request item 2).
- `amount_brl > 0` filter: without it the amount CHECK aborts the whole migration on a zero commission.
- `set_config('app.fxl_admin', 'true', true)`: FORCE RLS applies to the table owner; without it the INSERT...SELECT silently sees zero rows in staging and production. The scratch-DB oracle runs as a non-superuser owner, so it catches the omission.
- `NOT EXISTS`: replay-safe, proven by the idempotency oracle.
- `reverses_not_self_check`: without it an estorno whose `reverses_settlement_id` equals its own `id` passes the insert trigger (the target does not exist yet) and the self FK (it finds itself).

### Test cleanup helper `apps/api/src/db/__tests__/settlement-test-cleanup.ts`

Not a test file (no `.test.ts`), so vitest never runs it; it sits under `src` so `src/**/*.integration.test.ts` files of slices 04 and 06 can import it without breaking `rootDir`.

```ts
import postgres from 'postgres';

/**
 * Removes every settlement of the given orgs from the LOCAL test database.
 *
 * sales_ops_settlements refuses DELETE with SQLSTATE FXS01 by design, and its
 * RESTRICT foreign keys then block deleting the ledger rows and the sale. The
 * only way through is a superuser session with session_replication_role =
 * replica, which skips ordinary triggers for that transaction. This helper is
 * test-only on purpose: product code must never own such a path. Call it BEFORE
 * deleting any payable, receivable or sale of the same orgs.
 */
export async function deleteSettlementsForOrgs(orgIds: readonly string[]): Promise<number> {
  if (orgIds.length === 0) return 0;
  const url =
    process.env.TEST_MIGRATE_DATABASE_URL ??
    process.env.ADMIN_DATABASE_URL ??
    'postgresql://postgres:postgres@localhost:5006/fxl_sales';
  const client = postgres(url, { max: 1 });
  try {
    return await client.begin(async (tx) => {
      const [me] = await tx<{ rolsuper: boolean }[]>`
        SELECT rolsuper FROM pg_roles WHERE rolname = current_user
      `;
      if (!me?.rolsuper) {
        throw new Error(
          'deleteSettlementsForOrgs needs the local superuser (TEST_MIGRATE_DATABASE_URL)',
        );
      }
      await tx`SET LOCAL session_replication_role = replica`;
      const deleted = await tx`
        DELETE FROM sales_ops_settlements WHERE org_id = ANY(${orgIds as string[]})
      `;
      return deleted.count;
    });
  } finally {
    await client.end();
  }
}
```

### Scratch database helper `apps/api/test/rls/scratch-database.ts`

Not a test file. Copy, verbatim apart from dropping `testControls`, these pieces of `test/rls/professional-payable-migration.integration.test.ts`: `identifierPattern` and `exactIdentifier` (lines ~34, 67-72), `databaseUrl` (74-88), `migrationAdminUrl` (90-97), `attemptCleanup` (99-108), `createScratchDatabase` (117-172, without the `testControls` parameter and branches), `scratchClient` (174-178) and `cleanupScratch` (180-204). Export `type ScratchDatabase`, `createScratchDatabase`, `scratchClient`, `cleanupScratch`, `migrationAdminUrl`, and `MIGRATIONS_FOLDER = resolve(process.cwd(), 'drizzle')`.
Keep its own `scratches` bookkeeping out: the caller holds the scratch and calls `cleanupScratch` in `afterAll`, throwing an `AggregateError` if it returns errors.
Do NOT refactor the 0018 test to use it in this slice (see Out of scope).

### Dev seed (`apps/api/scripts/seed/plan.ts`, `apps/api/scripts/seed-dev.ts`)

The seed writes paid rows (`plan.ts:1095`), so without a matching baixa its paid rows would contradict the reducer, and once a settlement exists the re-seed delete of receivables would hit the RESTRICT FK.

`plan.ts`:
- Add `'salesOpsSettlements'` to `SEED_WRITE_ORDER` directly after `'salesOpsPayables'`, and as the FIRST entry of `SEED_DELETE_ORDER`.
- Add:

```ts
export interface SettlementRow {
  id: string;
  orgId: string;
  saleId: string;
  targetKind: 'receivable' | 'payable';
  receivableId: string | null;
  payableId: string | null;
  type: 'baixa';
  reversesSettlementId: null;
  paidOn: string; // YYYY-MM-DD
  amountBrl: number;
  origin: 'manual';
  actorUserId: string;
  actorName: string;
  recordedAt: string; // ISO date-time
  reason: null;
}

export const SEED_SETTLEMENT_ACTOR_NAME = 'Seed de desenvolvimento';

/** One synthetic baixa per paid ledger row with a positive amount, mirroring
 *  migration 0024's backfill: amount = the row amount, paid_on = the row's due
 *  day, actor 'system'. Pure: reads only its arguments. */
export function buildSeedSettlements(
  receivables: readonly ReceivableRow[],
  payables: readonly PayableRow[],
  cutoff: SeedCutoff,
): SettlementRow[]
```
  Body: for each receivable with `status === 'paid' && amountBrl > 0`, push `{ id: deterministicUuid(\`${row.orgId}:settlement:receivable:${row.id}\`), orgId: row.orgId, saleId: row.saleId, targetKind: 'receivable', receivableId: row.id, payableId: null, type: 'baixa', reversesSettlementId: null, paidOn: row.dueDate.slice(0, 10), amountBrl: row.amountBrl, origin: 'manual', actorUserId: 'system', actorName: SEED_SETTLEMENT_ACTOR_NAME, recordedAt: isoDateTime(cutoff.iso), reason: null }`; then the same for payables with `targetKind: 'payable'`, `receivableId: null`, `payableId: row.id` and the id name `...:settlement:payable:...`. Receivables first, then payables, each in input order (determinism).
- `DevSeedPlan.rows` gains `salesOpsSettlements: readonly SettlementRow[];` placed after `salesOpsPayables`, and `buildDevSeedPlan` sets `salesOpsSettlements: buildSeedSettlements(receivables, payables, cutoff)` after the per-org loop (use the name the function already has for its cutoff argument).

`seed-dev.ts`:
- Import `SettlementRow` with the other row types; add `'salesOpsSettlements'` to `EXPECTED_DELETE_ORDER` (first) and `EXPECTED_WRITE_ORDER` (after `'salesOpsPayables'`).
- Add `function toSettlementInsert(row: SettlementRow) { return { ...row, recordedAt: new Date(row.recordedAt) }; }` next to `toPayableInsert`.
- Change `const { eq } = await import('drizzle-orm');` to `const { eq, sql } = await import('drizzle-orm');`.
- As the first statements inside the per-org `withTenant` callback, before the payables delete:

```ts
      // sales_ops_settlements refuses DELETE (FXS01) and its RESTRICT FKs block
      // the ledger deletes below. The dev seed runs only against the local
      // database (the guard above) as the local superuser, so it may skip
      // ordinary triggers for this one statement and then restore them at once,
      // before any FK-checked delete runs.
      await tx.execute(sql`SET LOCAL session_replication_role = replica`);
      await tx
        .delete(schema.salesOpsSettlements)
        .where(eq(schema.salesOpsSettlements.orgId, orgId));
      await tx.execute(sql`SET LOCAL session_replication_role = origin`);
```
- After the payables insert block, insert `plan.rows.salesOpsSettlements` filtered by org with `toSettlementInsert`, same shape as the other blocks.

## Steps

Prerequisite for every integration run in this worktree: `cp` the main checkout's `apps/api/.env` to `apps/api/.env` here (gitignored), `docker compose up -d db` if the container is down, and never run `db:migrate` (it targets STAGING through `DATABASE_URL`); the integration `globalSetup` migrates the local test DB.

1. Red: `apps/api/src/db/__tests__/settlements-schema-contract.test.ts` (pure, no DB), tests:
   - `journals 0024_sales_ops_settlements as the last entry after 0023`: read `drizzle/meta/_journal.json`, assert the last entry `{ idx: 24, tag: '0024_sales_ops_settlements' }` and `when` greater than the 0023 entry's.
   - `ships the immutability trigger, the estorno trigger and forced RLS for sales_ops_settlements`: read the `.sql`, assert it contains `BEFORE UPDATE OR DELETE ON "sales_ops_settlements"`, `ERRCODE = 'FXS01'`, `ERRCODE = 'FXS02'`, `ERRCODE = 'FXS03'`, `FORCE ROW LEVEL SECURITY` on `sales_ops_settlements`, both policy names, `sales_ops_settlements_one_estorno_per_baixa_idx`, and does NOT start with `-- fxl-migration-mode: phased`.
   - `mirrors contract C3 in the Drizzle table`: `getTableConfig(salesOpsSettlements)` (from `drizzle-orm/pg-core`) column names equal exactly `['id','org_id','sale_id','target_kind','receivable_id','payable_id','type','reverses_settlement_id','paid_on','amount_brl','origin','actor_user_id','actor_name','recorded_at','reason']`, and `getTableConfig(salesOpsReceivables)` / `(salesOpsPayables)` columns include `revision` and `updated_at` with `notNull: true`, and `getTableConfig(salesOpsSaleItems)` / `(salesOpsSaleProfessionals)` columns include `removed_at` with `notNull: false`; the `.sql` contains both `ADD COLUMN "removed_at"` statements.
   Run it: fails (no file, no export).
2. Red: `apps/api/test/rls/settlements-schema.test.ts` and `apps/api/test/rls/settlements-schema-migration.test.ts` exactly as in Oracle tests below, plus the two helpers (`settlement-test-cleanup.ts`, `scratch-database.ts`). Run the integration command: both fail (table missing).
3. Green: edit `schema.ts` (Design), run `drizzle-kit generate --name sales_ops_settlements`, replace the SQL body with the Design text, check `git diff apps/api/drizzle/meta/_journal.json` shows only the new entry.
4. Green: run the unit command and the integration command below until green. Then run `pnpm --filter @fxl-sales/api exec vitest run src/db/__tests__/single-role-db-contract.test.ts` (must stay green; it scans the new file).
5. Red then Green (seed): add to `apps/api/scripts/__tests__/seed-plan.test.ts`:
   - `emits exactly one synthetic baixa per paid receivable and payable with a positive amount, and none for any other row` (count equals the number of paid rows with `amountBrl > 0`; every settlement's target row is `paid`; `amountBrl` equals the row's; `paidOn === row.dueDate.slice(0, 10)`; `actorUserId === 'system'`; `actorName === SEED_SETTLEMENT_ACTOR_NAME`; `type === 'baixa'`; `reversesSettlementId === null`).
   - extend `never lets a foreign-key-shaped field cross an org boundary` with `assertSameOrgReference(asRows(rows.salesOpsSettlements), 'saleId', rows.salesOpsSales)`, `'receivableId'` against receivables and `'payableId'` against payables.
   - extend `orders SEED_DELETE_ORDER as the reverse-dependency order the restrict FKs require` with `expect(index('salesOpsSettlements')).toBeLessThan(index('salesOpsPayables'))`, `...toBeLessThan(index('salesOpsReceivables'))`, `...toBeLessThan(index('salesOpsSales'))`.
   Run `pnpm --filter @fxl-sales/api exec vitest run scripts/__tests__/seed-plan.test.ts` red, implement the `plan.ts` and `seed-dev.ts` changes, run green. The existing determinism, unique-id and org-scope tests pick up the new table through `allTables`/`collectIds` automatically.
6. Seed smoke (manual, local only): against the local Docker DB already migrated by the integration run, run `make db-seed` twice in a row; both must print the `seeded ... row(s)` line. Then, in `psql` on the local DB as `postgres`, insert one estorno for one seeded baixa of a dev org (copying its org, sale, kind, row id and amount) and run `make db-seed` again; it must succeed (proves the replica-mode delete). Record the three outputs in the exec notes.
7. Refactor: none required; keep the helpers minimal. Update docs (Docs section). Run `pnpm run lint` and `pnpm run type-check` (the latter covers `scripts/` through `tsconfig.scripts.json`).
8. Full gate for the slice: `pnpm --filter @fxl-sales/api test` and the full `pnpm --filter @fxl-sales/api test:integration` (existing ledger tests must stay green: none creates a settlement, and their deletes run on rows with no settlement).

## Oracle tests

Unit (no DB):
`pnpm --filter @fxl-sales/api exec vitest run src/db/__tests__/settlements-schema-contract.test.ts src/db/__tests__/single-role-db-contract.test.ts scripts/__tests__/seed-plan.test.ts`
- `journals 0024_sales_ops_settlements as the last entry after 0023`.
- `ships the immutability trigger, the estorno trigger and forced RLS for sales_ops_settlements`. Mutation: delete `OR DELETE` from the trigger line, test fails.
- `mirrors contract C3 in the Drizzle table`. Mutation: drop `reason` from the Drizzle table, test fails.
- `emits exactly one synthetic baixa per paid receivable and payable with a positive amount, and none for any other row`. Mutation: make `buildSeedSettlements` return `[]`, or drop the payable loop, test fails (the seed has paid payables).

Integration (local Docker test DB):
`pnpm --filter @fxl-sales/api test:integration test/rls/settlements-schema.test.ts test/rls/settlements-schema-migration.test.ts`

`apps/api/test/rls/settlements-schema.test.ts`, `describe('sales_ops_settlements schema (migration 0024)')`.
Connections: `appClient = postgres(TEST_DATABASE_URL)` with the non-superuser guard copied from `test/rls/cross-tenant.test.ts:36-48` (throw if `rolsuper || rolbypassrls`); `adminClient = postgres(ADMIN_DATABASE_URL ?? APP_DB_URL, { max: 1, connection: { 'app.fxl_admin': 'true' } })` for seeding.
Seed helpers (raw SQL through `adminClient`): `insertSale(orgId, sequence)` copied from `test/rls/leads-rls.test.ts:96-107` with a unique `code`, but `status` `'won'`; `insertReceivable(orgId, saleId, { amountBrl = 100000, dueDate = '2026-03-01T00:00:00Z', status = 'open' })`; `insertPayable(orgId, saleId, receivableId, { amountBrl = 5000 })` with `beneficiary_name 'Vendedor'`, `kind 'seller_commission'`; `insertSettlement(sql, fields)` building an INSERT from a partial object with defaults `{ target_kind: 'receivable', type: 'baixa', paid_on: '2026-03-02', amount_brl: <row amount>, origin: 'manual', actor_user_id: 'acct_test', actor_name: 'Pessoa Teste' }`, returning `id`.
Read dates as text (`paid_on::text`) because postgres.js returns `date` as a JS `Date`.
Assert errors with `await expect(p).rejects.toMatchObject({ code: '<SQLSTATE>' })`, and for CHECK and index cases also `constraint_name`.
`afterAll`: `await deleteSettlementsForOrgs(orgIds)`, then for each org delete payables, receivables, sales through `adminClient`, then end all clients.
Tests:
1. `adds revision 1 and a non-null updated_at to every new receivable and payable, and refuses revision 0`: insert one of each, read `revision`, `updated_at IS NOT NULL`; `UPDATE sales_ops_receivables SET revision = 0` rejects `23514` with `constraint_name: 'sales_ops_receivables_revision_check'`, same for payables.
2. `refuses UPDATE of a settlement with SQLSTATE FXS01, for the tenant role and for the admin context`: create a baixa; inside `appClient.begin` with `set_config('app.current_org_id', orgA, true)` FIRST assert `SELECT id ... WHERE id = $id` returns 1 row (positive control: without it an RLS-hidden row would make the UPDATE a silent no-op), then `UPDATE sales_ops_settlements SET reason = 'x' WHERE id = $id` rejects `FXS01`; then the same UPDATE through `adminClient` rejects `FXS01`; finally the row is unchanged. Mutation: trigger `BEFORE INSERT` only, test fails.
3. `refuses DELETE of a settlement with SQLSTATE FXS01, for the tenant role and for the admin context`: same shape with `DELETE FROM sales_ops_settlements WHERE id = $id`; the row still exists afterwards. Mutation: trigger `BEFORE UPDATE` only, test fails.
4. `hides another org's settlements under RLS and refuses a smuggled org_id with WITH CHECK`: baixa in org A; `appClient` with org A context sees it (positive control), with org B context sees 0 rows by id and 0 rows unfiltered for org A; with org B context, an INSERT whose `org_id` is org A (pointing at org A's sale and receivable) rejects `42501`. Mutation: tenant policy `USING (true)`, test fails.
5. `accepts one estorno per baixa and refuses a second with 23505`: baixa `b1`, estorno `e1` (`type 'estorno'`, `reverses_settlement_id b1`, same row and amount, `paid_on '2026-03-05'`, `reason 'Pagamento lançado em duplicidade'`) succeeds; a second estorno of `b1` rejects `23505` with `constraint_name: 'sales_ops_settlements_one_estorno_per_baixa_idx'`. Mutation: drop the unique index, test fails.
6. `refuses every malformed settlement with its named CHECK constraint`: table-driven, each case violating exactly one constraint, all `23514`:
   - `target_kind 'invoice'` with `receivable_id` set: this unavoidably also breaks `target_check`, so assert `code 23514` and `constraint_name` is one of `sales_ops_settlements_target_kind_check` or `sales_ops_settlements_target_check`.
   - `target_kind 'receivable'` with `receivable_id` null and `payable_id` set (same sale): `sales_ops_settlements_target_check`.
   - both `receivable_id` and `payable_id` set, `target_kind 'receivable'`: `sales_ops_settlements_target_check`.
   - `type 'ajuste'`: `sales_ops_settlements_type_check`.
   - `type 'estorno'` with `reverses_settlement_id` null: `sales_ops_settlements_reverses_check`.
   - `type 'baixa'` with `reverses_settlement_id` = an existing baixa id: `sales_ops_settlements_reverses_check`.
   - explicit `id = X` and `type 'estorno'`, `reverses_settlement_id = X`: `sales_ops_settlements_reverses_not_self_check`.
   - `amount_brl 0` and `amount_brl -1`: `sales_ops_settlements_amount_check`.
   - `origin 'hub'`: `sales_ops_settlements_origin_check`.
   - `type 'baixa'` with `reason 'x'`: `sales_ops_settlements_reason_check`.
   - `actor_user_id '  '`: `sales_ops_settlements_actor_check`.
   Mutation: remove `sales_ops_settlements_reverses_not_self_check`, the self case inserts and the test fails.
7. `refuses an estorno that does not mirror its baixa with SQLSTATE FXS02`: with baixa `b1` on receivable `r1` (amount 100000) and a second receivable `r2` of the same sale: estorno of `b1` with `amount_brl 99999` rejects `FXS02`; estorno of `b1` pointing at `r2` rejects `FXS02`; estorno `e1` of `b1` succeeds, then an estorno of `e1` rejects `FXS02`. Mutation: drop the `amount_brl <>` line from the trigger, the first case inserts and the test fails.
8. `composite foreign keys refuse a cross-org or cross-sale target and restrict deleting a settled row, its sale and a reversed baixa`: through `adminClient` (admin context, where RLS does not help): a settlement in org B naming org A's sale and receivable rejects `23503`; a settlement whose `sale_id` is sale S2 but whose `receivable_id` belongs to sale S1 (same org) rejects `23503`; `DELETE FROM sales_ops_receivables WHERE id = <settled row>` rejects `23503` with `constraint_name 'sales_ops_settlements_org_sale_receivable_fk'`; the same for a settled payable (`..._org_sale_payable_fk`) and for the sale (`23503`). Mutation: replace the receivable FK with a single-column FK on `receivable_id`, the cross-sale case inserts and the test fails.
9. `deleteSettlementsForOrgs removes one org's settlements and leaves another org untouched`: baixas in org C and org D; `deleteSettlementsForOrgs([orgC])` returns 1; org C has 0 settlements, org D still 1; afterwards deleting org C's receivable succeeds. Mutation: drop the `SET LOCAL session_replication_role` line, the helper throws `FXS01`, test fails.

`apps/api/test/rls/settlements-schema-migration.test.ts`, `describe('migration 0024 on a database populated at 0023')`, using `scratch-database.ts`.
`beforeAll` (timeout 120000):
- `scratch = await createScratchDatabase()`.
- `await scratch.admin.unsafe(\`ALTER DATABASE "${scratch.databaseName}" SET timezone TO 'America/Sao_Paulo'\`)` (identifier already validated by the helper's pattern).
- `await runDatabaseMigrations({ databaseUrl: scratch.ownerUrl, migrationsFolder: MIGRATIONS_FOLDER, throughTag: '0023_lead_seller_identity' })`.
- Seed through `scratchClient(scratch)` inside `begin` with `set_config('app.fxl_admin', 'true', true)`, using the `sales_ops_sales` INSERT from `professional-payable-migration.integration.test.ts:231-242` (status `'won'`):
  - org A, sale SA: `RA1` paid, `due_date '2026-03-01T00:00:00Z'`, 120000, label `'1/3'`; `RA2` open, `'2026-04-01T00:00:00Z'`, 120000, `'2/3'`; `RA3` void, `'2026-05-01T00:00:00Z'`, 120000, `'3/3'`; `RA4` paid, `due_date now() + interval '400 days'`, 80000, `'M1/12'`.
  - payables of SA: `PA1` paid `seller_commission` 6000 `receivable_id RA1` due `'2026-03-01T00:00:00Z'`; `PA2` open `tax` 14400 `receivable_id RA2`; `PA3` paid `finder_commission` amount 0 `receivable_id RA1`.
  - org B, sale SB: `RB1` paid, `'2026-01-15T00:00:00Z'`, 50000.
- `spTodayBefore = (SELECT (now() AT TIME ZONE 'America/Sao_Paulo')::date::text)` via `scratch.adminScratch`.
- `await runDatabaseMigrations({ databaseUrl: scratch.ownerUrl, migrationsFolder: MIGRATIONS_FOLDER })` (runs 0024 as the non-superuser owner, so FORCE RLS is real).
- `spTodayAfter` the same way.
`afterAll`: `cleanupScratch(scratch)`; throw an `AggregateError` if it returned errors.
Read everything through `scratch.adminScratch` (superuser, sees all orgs).
Tests:
1. `backfills exactly one synthetic baixa per paid receivable and payable with a positive amount, coherent with the reducer rules`: `sales_ops_settlements` has exactly 4 rows, one each for RA1, RA4, PA1, RB1, and none for RA2, RA3, PA2, PA3; each has `type 'baixa'`, `reverses_settlement_id null`, `amount_brl` = its row's, `origin 'manual'`, `actor_user_id 'system'`, `actor_name 'Migração'`, `reason null`, `org_id` and `sale_id` = its row's, the right `target_kind` and id column; RA1 and PA1 `paid_on::text = '2026-03-01'`, RB1 `'2026-01-15'`. Reducer coherence in SQL: for every `status = 'paid' AND amount_brl > 0` row, the sum of baixas with no estorno equals `amount_brl`. All eight seeded ledger rows have `revision = 1` and `updated_at IS NOT NULL`. Mutations: remove `set_config` from the backfill (0 settlements, fails); remove `amount_brl > 0` (migration throws `23514` in `beforeAll`, fails).
2. `stamps paid_on with the UTC civil due day even when the database runs in America/Sao_Paulo, and clamps a future due day to the Sao Paulo today`: precondition on a fresh `scratchClient(scratch)`: `SHOW timezone` returns `America/Sao_Paulo` (non-vacuity of the timezone trap); RA1's `paid_on` is `'2026-03-01'` (the mutation `r."due_date"::date` yields `'2026-02-28'` here); RA4's `paid_on::text` is `spTodayBefore` or `spTodayAfter` (mutation: drop `LEAST`, it becomes a day 400 days ahead, fails).
3. `is idempotent: replaying the shipped backfill statements adds nothing`: read `drizzle/0024_sales_ops_settlements.sql`, split on `--> statement-breakpoint`, take the chunks from the first one containing `set_config('app.fxl_admin'` to the end, run them in one `scratchClient(scratch).begin` transaction, assert the settlement count is still 4. Mutation: remove both `NOT EXISTS` clauses, count becomes 8, fails.
4. `the shipped verification block aborts with FXS03 when a paid row has no matching baixa`: take the chunk containing `ERRCODE = 'FXS03'` from the shipped file; inside one `scratch.adminScratch.begin` transaction insert a new paid receivable (amount 1000) on SA, then run the chunk; the transaction rejects with `code 'FXS03'`; afterwards the settlement count is still 4 and the extra receivable is gone (rolled back). Mutation: change the `DO` block's comparison to `<> pr."amount_brl" + 1000000`, it no longer raises, fails.

## Docs

`CLAUDE.md`, section `## Propostas domain`, insert this block after the `Statuses and payables:` bullets and before `Professional split:` (do NOT touch the line `Leaving \`won\` voids only ...`; slice 06 owns it):

```markdown
Settlements (schema):
- `sales_ops_settlements` (migration `0024_sales_ops_settlements`) holds immutable `baixa`/`estorno` facts for one receivable or payable each. A trigger refuses every UPDATE and DELETE with SQLSTATE `FXS01`; an estorno that does not mirror its baixa (org, sale, kind, row, amount) fails with `FXS02`.
- At most one estorno per baixa (`sales_ops_settlements_one_estorno_per_baixa_idx`, `23505`). Every FK is composite, leads with `org_id`, carries `sale_id` for the row FKs, and is `ON DELETE RESTRICT`: a settled row, its sale and a reversed baixa are never deleted.
- `sales_ops_receivables` and `sales_ops_payables` carry `revision` (starts at 1, CHECK `>= 1`) and `updated_at`.
- `sales_ops_sale_items` and `sales_ops_sale_professionals` carry a nullable `removed_at` (soft removal on edit; slice 04 writes the rules for it).
- Product code has no DELETE path and no trigger bypass for settlements. Tests remove them only through `deleteSettlementsForOrgs` (`apps/api/src/db/__tests__/settlement-test-cleanup.ts`) and the dev seed only in replica mode as the local superuser, both before any ledger or sale delete.
- Migrated paid rows got one synthetic baixa (`actor_user_id = 'system'`, `actor_name = 'Migração'`, `paid_on` = the UTC civil due day clamped to today in São Paulo); the dev seed writes the same shape with `actor_name = 'Seed de desenvolvimento'`.
```

`nexo/knowledge/reference/propostas.md`: append at the end a `## Settlements schema (migration 0024)` section, one sentence per line, no em dash, covering:
- The table's purpose and the reducer rules it feeds (active baixa, paid = sum of active, displayed day = greatest active `paid_on`), and that `status = 'paid'` is a cache.
- Why DELETE is refused although Finance refuses only UPDATE (Finance's restore deletes by org with cascading FKs; Sales deletes no sale and uses RESTRICT everywhere).
- Why the FKs are composite with `sale_id` (a single-column FK does not consult RLS; cross-sale settlements become unrepresentable), and that slice 06 must copy `sale_id` from the target row.
- The SQLSTATE list `FXS01`, `FXS02`, `FXS03` and that `23505` on the one-estorno index maps to `already_reversed`.
- The backfill rule (`LEAST((due_date AT TIME ZONE 'UTC')::date, São Paulo today)`, `amount_brl > 0` only, `set_config('app.fxl_admin')` because FORCE RLS binds the owner), and that before 0024 no production code wrote `paid`, so the backfill is expected empty outside local data.
- Why there is no database guard against a future `paid_on` (the app and DB clocks can disagree near midnight; the API owns the rule).
- The cleanup rule (replica mode, local superuser only) and the scratch-database migration oracle.
- Oracle names: `apps/api/test/rls/settlements-schema.test.ts`, `apps/api/test/rls/settlements-schema-migration.test.ts`, `apps/api/src/db/__tests__/settlements-schema-contract.test.ts`, and the seed test title above.

## Security notes

- Tenant isolation is enforced three times: FORCE RLS with the org policy, composite FKs that lead with `org_id` (hold even in the admin context), and the insert trigger's org comparison for estornos.
- No GRANT, no role DDL, no `SECURITY DEFINER` function; both trigger functions run as the invoker and qualify every table with `public`.
- The only way around the immutability trigger is a superuser session with `session_replication_role = replica`; the application role in staging and production is not a superuser, and no product code sets that parameter. The two places that do (`settlement-test-cleanup.ts`, `seed-dev.ts`) are test and local-dev only; `seed-dev.ts` stays behind the local database guard.
- `actor_name` is a display snapshot, never an identifier; `actor_user_id` is the Hub account id that slice 06 takes from the verified token, never from a body.

## Contract deviations

- C3 says "UNIQUE constraint" on `reverses_settlement_id`; this plan uses a partial UNIQUE INDEX (`WHERE reverses_settlement_id IS NOT NULL`), identical semantics and SQLSTATE `23505`, matching Finance's shape. Slice 06 matches on the index name `sales_ops_settlements_one_estorno_per_baixa_idx`.
- C3 says "`receivable_id uuid NULL` FK" and "`sale_id` FK"; this plan makes them composite `(org_id, sale_id, receivable_id)` / `(org_id, sale_id, payable_id)` / `(org_id, sale_id)` / `(org_id, reverses_settlement_id)`, which needs two new unique indexes on the ledger tables. Consequence for slices 04 and 06: a settlement's `sale_id` must be the target row's `sale_id`.
- The request mentions "policies for the app role and the fxl_sales_test role": this repo has no per-role policies. Policies are role-agnostic GUC predicates and `fxl_sales_test` gets table privileges through `ALTER DEFAULT PRIVILEGES`; a GRANT in a migration would fail `single-role-db-contract.test.ts`. No change to C3.
- Transitional window (serial execution, H6): until slice 04 lands, `updateSale` still deletes receivables of `draft`/`open` sales. A legacy `paid` receivable left on a reverted (`won -> open`) sale would now carry a synthetic baixa, and editing that sale would fail with `23503` instead of silently deleting a paid row. Only local fixture data can be in that state; slice 04 removes the delete. No fix in this slice.

## Decisions for AUDIT

- D03-1 Migrated `paid_on`: `LEAST((due_date AT TIME ZONE 'UTC')::date, (now() AT TIME ZONE 'America/Sao_Paulo')::date)`. No ledger column records a payment day; the due day is the best proxy and the clamp keeps it out of the future. `won_at` was rejected because it belongs to the sale, not the row.
- D03-2 A `paid` row with `amount_brl <= 0` gets no synthetic baixa (the amount CHECK forbids a zero baixa; Finance's reducer reads a zero row as settled with no fact). Its `status` is left untouched; slice 06 decides how the cache treats zero rows.
- D03-3 DELETE is refused as well as UPDATE (`FXS01`), unlike Finance, because Sales has no cascade or restore path that deletes by org. Tests and the dev seed use the local superuser in replica mode.
- D03-4 An estorno must mirror its baixa (org, sale, kind, row, amount) and may not target an estorno (`FXS02`), mirroring Finance's `FXB02`. Not written in C3, added for parity.
- D03-5 No database guard against a future `paid_on`: app and database clocks can straddle midnight and turn a legitimate default "today" into a 500. The API (slice 06) and the UI own the rule.
- D03-6 Synthetic baixas use `origin = 'manual'` (the C3 CHECK allows only `manual|finance`) and are recognizable by `actor_user_id = 'system'`; Finance uses a dedicated `origem = 'migracao'`.
- D03-7 The dev seed writes one synthetic baixa per seeded paid row (`actor_name = 'Seed de desenvolvimento'`, `paid_on` = due day) so seeded data obeys the same invariant; `paid_on` follows `SEED_CUTOFF`, which the developer controls.
- D03-8 SQLSTATE names `FXS01` immutability, `FXS02` estorno mismatch, `FXS03` backfill verification.
- D03-9 (plan-check) `removed_at` for sale items and sale professionals ships in `0024` (not a separate `0025`), so the feature has exactly one migration.

## Out of scope

- Any service, route, zod schema, bootstrap projection or reducer code (slices 02, 04, 06). The bootstrap raw `select()` will start carrying `revision` and `updatedAt` on its own; nothing else is shaped here.
- Bumping `revision`/`updated_at` on writes (slice 04, C7).
- The `status` cache refresh from the reducer and the leave-won lock (slice 06).
- Refactoring `professional-payable-migration.integration.test.ts` onto `scratch-database.ts` (possible follow-up; left alone to keep this slice's diff off an unrelated oracle).
- Any currency DDL (slice 07).
