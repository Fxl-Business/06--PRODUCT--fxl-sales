---
id: 02-proposal-schema-backend
milestone: v2.3.0
status: done
depends_on: [01-areas-backend]
files_modified:
  [
    apps/api/src/db/schema.ts,
    apps/api/drizzle/0011_proposal_lifecycle_schema.sql,
    apps/api/drizzle/meta/_journal.json,
    apps/api/drizzle/meta/0011_snapshot.json,
    apps/api/src/domains/sales-ops/service.ts,
    apps/api/src/domains/sales-ops/__tests__/service.test.ts,
    apps/api/test/rls/proposal-schema-migration.test.ts,
  ]
acceptance: "Given legacy sales rows with statuses closed, completed, forecast and in_progress plus fresh rows exercising every new column, when migration 0011 and its backfill SQL run against the integration database, then the legacy rows read back as won (won_at = COALESCE(updated_at, created_at)) or open, and receivables.method, payables.receivable_id (with ON DELETE SET NULL), sale_items.area_id + area_name_snapshot, sales.won_at/lost_at and the five client legal columns all accept writes, proven by apps/api/test/rls/proposal-schema-migration.test.ts."
---

# Slice 02: Proposal schema backend

## Scope

ONE Drizzle migration plus `apps/api/src/db/schema.ts` edits covering every remaining schema change of the feature.
Slice 01 already ships `sales_ops_areas` and `sales_ops_products.area_id`; this slice does NOT touch those.
This slice ships no endpoint, no ledger, and no web change.
The only non-schema TypeScript edits are two value-level lines in `apps/api/src/domains/sales-ops/service.ts` (documented below) that keep behavior correct after the data remap; nothing else is needed for compilation.

## Dependency contract with slice 01

Slice 01 exports the areas table from `apps/api/src/db/schema.ts` as `export const salesOpsAreas = pgTable('sales_ops_areas', ...)`.
Slice 01 lands migration index 0010; this slice therefore generates index 0011.
If slice 01 used a different export name or index, the executor adapts the references below to the actual name and next free index, changing nothing else.

## 1. schema.ts edits (verbatim)

All line anchors verified on current master: clients at 492, sales at 532, sale_items at 572, receivables at 606, payables at 622.
All new columns are nullable or carry a default, so no existing `insert(...).values(...)` call site changes and the workspace keeps compiling.
Statuses stay plain text with a documenting comment and no CHECK constraint, matching the existing convention on `sales_ops_sales.status` and `sales_ops_products.status`.

### 1a. sales_ops_sales (line 545)

Replace:

```ts
    status: text('status').notNull().default('forecast'),
```

with:

```ts
    status: text('status').notNull().default('open'), // 'draft' | 'open' | 'won' | 'lost' | 'cancelled'
    wonAt: timestamp('won_at', { withTimezone: true }),
    lostAt: timestamp('lost_at', { withTimezone: true }),
```

No code relies on the DB default (every insert passes `status` explicitly), so changing the default from `forecast` to `open` is safe and removes the last schema-level trace of the dead status.

### 1b. sales_ops_sale_items (after line 582, `productTypeSnapshot`)

Insert after the `productTypeSnapshot` line:

```ts
    areaId: uuid('area_id').references(() => salesOpsAreas.id),
    areaNameSnapshot: text('area_name_snapshot').notNull().default(''),
```

The `() =>` lazy reference means declaration order relative to `salesOpsAreas` does not matter.

### 1c. sales_ops_receivables (line 617)

Replace:

```ts
    status: text('status').notNull().default('open'),
```

with:

```ts
    method: text('method').notNull().default('pix'), // 'pix' | 'card' | 'boleto' | 'transfer'
    status: text('status').notNull().default('open'), // 'open' | 'paid' | 'void'
```

### 1d. sales_ops_payables (after line 631, `kind`)

Insert after the `kind: text('kind').notNull(),` line:

```ts
    receivableId: uuid('receivable_id').references(() => salesOpsReceivables.id, {
      onDelete: 'set null',
    }),
```

`salesOpsReceivables` is declared above `salesOpsPayables` in the file, so the reference resolves directly.
Also add a documenting comment to the payables status line, changing it to:

```ts
    status: text('status').notNull().default('open'), // 'open' | 'paid' | 'void'
```

### 1e. sales_ops_clients (after line 498, `contact`)

Insert after the `contact: text('contact'),` line:

```ts
    legalName: text('legal_name'),
    document: text('document'),
    address: text('address'),
    legalRepName: text('legal_rep_name'),
    legalRepDocument: text('legal_rep_document'),
```

## 2. Migration

### 2a. Generate

Run from the repo root:

```bash
pnpm --filter @fxl-sales/api db:generate --name proposal_lifecycle_schema
```

This produces `apps/api/drizzle/0011_proposal_lifecycle_schema.sql` and updates `apps/api/drizzle/meta/_journal.json` plus `apps/api/drizzle/meta/0011_snapshot.json`.
Expected generated statements (drizzle output order may differ; verify content, do not hand-edit the generated part except to confirm):

```sql
ALTER TABLE "sales_ops_clients" ADD COLUMN "legal_name" text;
ALTER TABLE "sales_ops_clients" ADD COLUMN "document" text;
ALTER TABLE "sales_ops_clients" ADD COLUMN "address" text;
ALTER TABLE "sales_ops_clients" ADD COLUMN "legal_rep_name" text;
ALTER TABLE "sales_ops_clients" ADD COLUMN "legal_rep_document" text;
ALTER TABLE "sales_ops_payables" ADD COLUMN "receivable_id" uuid;
ALTER TABLE "sales_ops_receivables" ADD COLUMN "method" text DEFAULT 'pix' NOT NULL;
ALTER TABLE "sales_ops_sale_items" ADD COLUMN "area_id" uuid;
ALTER TABLE "sales_ops_sale_items" ADD COLUMN "area_name_snapshot" text DEFAULT '' NOT NULL;
ALTER TABLE "sales_ops_sales" ALTER COLUMN "status" SET DEFAULT 'open';
ALTER TABLE "sales_ops_sales" ADD COLUMN "won_at" timestamp with time zone;
ALTER TABLE "sales_ops_sales" ADD COLUMN "lost_at" timestamp with time zone;
ALTER TABLE "sales_ops_payables" ADD CONSTRAINT "sales_ops_payables_receivable_id_sales_ops_receivables_id_fk" FOREIGN KEY ("receivable_id") REFERENCES "public"."sales_ops_receivables"("id") ON DELETE set null ON UPDATE no action;
ALTER TABLE "sales_ops_sale_items" ADD CONSTRAINT "sales_ops_sale_items_area_id_sales_ops_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."sales_ops_areas"("id") ON DELETE no action ON UPDATE no action;
```

New columns on RLS-enabled tables need no new policies (existing row-level policies cover all columns).

### 2b. Hand-append the status remap backfill

Append to the end of `apps/api/drizzle/0011_proposal_lifecycle_schema.sql`, exactly (mirrors the 0009 convention including breakpoints):

```sql
--> statement-breakpoint
SELECT set_config('app.fxl_admin', 'true', true);--> statement-breakpoint
UPDATE "sales_ops_sales"
SET "status" = 'won',
    "won_at" = COALESCE("updated_at", "created_at")
WHERE "status" IN ('closed', 'completed');--> statement-breakpoint
UPDATE "sales_ops_sales"
SET "status" = 'open'
WHERE "status" IN ('forecast', 'in_progress');
```

Drizzle runs the whole migration in one transaction, so the transaction-local `set_config(..., true)` covers both UPDATEs and the columns exist before the backfill runs.
Rows already in `draft` or `cancelled` are untouched by design.

## 3. TypeScript changes in the API layer

Exactly two value-level edits in `apps/api/src/domains/sales-ops/service.ts`; the zod schema rework itself stays in slice 03.

### 3a. Widen the status enum (line 129)

Replace:

```ts
  status: z.enum(['draft', 'forecast', 'closed', 'in_progress', 'completed', 'cancelled']),
```

with:

```ts
  // Canonical: draft | open | won | lost | cancelled. Legacy values remain accepted until slice 03 reworks CreateSaleSchema.
  status: z.enum(['draft', 'open', 'won', 'lost', 'cancelled', 'forecast', 'closed', 'in_progress', 'completed']),
```

Keeping the legacy values means the existing unit fixtures (`status: 'closed'` in `service.test.ts` lines 16, 72, 115) and the current wizard payload keep working; slice 03 narrows the enum to canonical values only.
Interim behavior note, accepted on purpose: creating a sale with `status: 'won'` through the existing endpoint does not set `won_at`; win-time materialization and timestamps are slice 03/04 scope.

### 3b. Count won sales in the summary (line 342)

Replace:

```ts
  const closedStatuses = new Set(['closed', 'completed']);
```

with:

```ts
  const closedStatuses = new Set(['won', 'closed', 'completed']);
```

Without this one-token addition the dashboard KPIs would drop to zero the moment the remap runs, breaking the overview rule that the dashboard stays correct at every wave boundary.
Slice 03 reduces the set to `won` only when it deletes the legacy statuses.

### 3c. What deliberately does NOT change

`SaleSummaryRow.status` and `PayableSummaryRow.status` are typed `string`, so reads of remapped rows compile untouched.
`buildSaleLedger`, `CreateSaleSchema` payment fields, routes, bootstrap and the web app compile unchanged because every new column is nullable or defaulted.
`apps/web/src/sales-ops/calculations.ts` and `statusMeta` copies are slice 07 scope per the overview and are not touched here.
No shared-types package references sale statuses (verified by grep), so nothing else moves.

## 4. Oracle tests

### 4a. Integration oracle (primary): `apps/api/test/rls/proposal-schema-migration.test.ts` (new file)

Runs under `pnpm --filter @fxl-sales/api test:integration`; global-setup applies all journaled migrations including 0011 before the suite.
Modeled on `apps/api/test/rls/product-commission-contract.test.ts` (admin `postgres` client with `app.fxl_admin` connection option, per-org cleanup in `afterAll`) and it may use `getAdminDb()` from `apps/api/src/db/client.ts` for typed drizzle inserts.
The status column has no CHECK constraint, so the test can seed legacy statuses even after the migration ran.

Test 1: `remaps legacy sale statuses and backfills won_at (replays the shipped 0011 backfill SQL)`.
Seed four minimal `sales_ops_sales` rows in a unique test org: one `closed` with `updated_at` set, one `completed` with `updated_at` null, one `forecast`, one `in_progress`, plus one `draft` and one `cancelled` control row.
Locate the shipped migration file with `fs.readdirSync('<apps/api>/drizzle').find((f) => /^0011_.*\.sql$/.test(f))`, split its content on `--> statement-breakpoint`, and keep the statements from the one containing `set_config('app.fxl_admin'` onward.
Execute those statements in order inside one `adminClient.begin(...)` transaction via `tx.unsafe(statement)`, so the test exercises the exact SQL that ships, not a copy.
Assert, filtering by the test org id: the `closed` row is `won` with `won_at` equal to its `updated_at`; the `completed` row is `won` with `won_at` equal to its `created_at`; `forecast` and `in_progress` rows are `open` with `won_at` null; `draft` and `cancelled` rows are unchanged.
Replaying the UPDATE also touches any stray legacy-status rows left by earlier serial test files; that mirrors real migration behavior and all assertions are scoped to the test org, so it is harmless.

Test 2: `new columns exist, accept writes, and receivable deletion nulls payable links`.
In a second unique test org, insert one client with all five legal fields set, one area row in `sales_ops_areas`, one sale with `status: 'won'` and `wonAt` set and `lostAt` null, one sale item with `areaId` pointing at the area and `areaNameSnapshot: 'FXL Tech'`, one receivable with `method: 'boleto'` and `status: 'void'`, and one payable with `receivableId` pointing at that receivable.
Select everything back and assert each new value round-trips exactly.
Then delete the receivable row and assert the payable still exists with `receivableId` null (proves `ON DELETE SET NULL`).
Also insert one receivable omitting `method` and assert it reads back `'pix'` (proves the default).
Cleanup in `afterAll` deletes seeded rows child-first per org: payables, receivables, sale_items, sales, areas, clients.

### 4b. Unit oracle: extend `apps/api/src/domains/sales-ops/__tests__/service.test.ts`

Test name: `accepts canonical proposal statuses and counts won sales as closed`.
Assert `CreateSaleSchema.parse` succeeds for `status: 'won'`, `status: 'open'`, and `status: 'lost'` (reuse an existing valid fixture, override status) and still succeeds for legacy `status: 'closed'`.
Assert `summarizeSalesOpsState` with one sale of `status: 'won'` and one of `status: 'closed'` returns `kpis.closedSalesCount === 2` and sums both into `closedRevenueBrl`.

## 5. Execution order for the executor

1. Edit `apps/api/src/db/schema.ts` per section 1.
2. Run the generate command per section 2a and eyeball the generated SQL against the expected statement list.
3. Append the backfill SQL per section 2b.
4. Apply the two `service.ts` edits per section 3.
5. Write the two tests per section 4.
6. Verify: `pnpm run lint`, `pnpm run type-check`, `pnpm test`, `pnpm run build`, `pnpm --filter @fxl-sales/api test:integration` (Docker Postgres up), all green.

## 6. Out of scope (owned by later slices)

CreateSaleSchema v2 payload, `installments[]` array, recurring block and `buildSaleLedger` rework: slice 03.
Transition endpoints, per-receivable payable materialization, void logic and won/lost timestamp writes at transition time: slice 04.
All web changes including `calculations.ts` closedStatuses and `statusMeta`: slices 05 to 08.
Removal of the legacy status values from the zod enum: slice 03.
