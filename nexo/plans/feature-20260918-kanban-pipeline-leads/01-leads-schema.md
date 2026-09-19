---
id: 01-leads-schema
milestone: v4.1.0
status: done
depends_on: []
files_modified:
  - apps/api/src/db/schema.ts
  - apps/api/drizzle/0022_sales_ops_leads.sql
  - apps/api/drizzle/meta/0022_snapshot.json
  - apps/api/drizzle/meta/_journal.json
  - apps/api/src/domains/sales-ops/service.ts
  - apps/api/src/domains/sales-ops/leads/stages-seed.ts
  - apps/api/test/rls/leads-rls.test.ts
  - apps/api/test/rls/leads-schema-migration.test.ts
acceptance: "given a fresh database and an org with no lead rows at all, when migration 0022 is applied and `ensureLeadStagesForOrg` is called for that org, then `sales_ops_lead_stages`, `sales_ops_leads` and `sales_ops_lead_products` exist under FORCE ROW LEVEL SECURITY with both org policies, the org carries exactly four stages of which only the conversion stage and the Perdido stage are `is_system`, a second call writes nothing new, and every cross-org foreign key, the `(org_id, name)` unique index, the `(org_id, kind)` partial unique index and the `is_system` / `kind` biconditional CHECK all reject their negative case at the database level."
goal: The whole feature's persistence layer - three tables, their RLS, their composite FKs and the per-org stage seed - in exactly one migration.
must_not_break:
  - "`pnpm --filter @fxl-sales/api test:integration` stays green end to end: 0022 is appended to the journal and every existing RLS/migration test still runs against a database migrated through it."
  - "No existing table's columns, constraints, policies or indexes change. 0022 touches existing tables ONLY by adding three unique `(org_id, id)` indexes (clients, products, sales) that exist solely as composite-FK targets."
  - "`salesOpsRouter` gains no route and no DELETE verb in this slice; `routes.ts` is byte-unchanged."
  - "`getSalesOpsSnapshot`, `getSalesOpsSummary`, `computeSaleFinancials`, `buildSaleLedger`, `SALE_TRANSITIONS` and `purge-service.ts` are byte-unchanged. Nothing about leads reaches `/bootstrap`."
  - "The only edit to `apps/api/src/domains/sales-ops/service.ts` is the word `export` in front of `async function withTenant`. Its body, its signature and every other line of that file are byte-unchanged."
  - "`drizzle/meta/_journal.json` keeps every existing entry byte-identical; 0022 is appended, never inserted."
rules:
  - "Money is integer cents. Rates are numeric(5,2). Neither appears here except the estimate, which is integer cents."
  - "Discriminators are `text` plus a CHECK, never a Postgres `enum` type - the whole repo (`status`, `kind`, `mode`, `method`, `entrada_mode`) does it this way."
  - "Every FK that crosses a tenant boundary is COMPOSITE on `(org_id, <fk>)`. A foreign key does not consult the RLS predicate, so a single-column FK accepts another org's id."
  - "FORCE ROW LEVEL SECURITY plus the two policies (`*_tenant_isolation`, `*_admin_context`) on all three new tables, spelled exactly as 0012 spells them."
  - "Journaled migrations must never contain `CREATE ROLE` / `ALTER ROLE` / `GRANT ... TO <role>`."
  - "The backfill block runs behind `SELECT set_config('app.fxl_admin', 'true', true);`, exactly as 0012 and 0020 do, or FORCE RLS makes it match zero rows."
  - "Every hand-written SQL reference to the `position` column is double-quoted as `\"position\"`."
  - "No `ON DELETE CASCADE` on any edge that carries history. The one cascade is `sales_ops_lead_products` -> `sales_ops_leads`, justified in the body."
verifier_focus: "That the migration's SQL, the Drizzle schema and the two integration tests agree on every constraint NAME, and that each named oracle really goes red when its constraint is deleted - in particular the biconditional CHECK, the `(org_id, name)` unique index, the `(org_id, kind)` partial unique index, and the ON DELETE rules (cascade on lead_products, restrict everywhere else). Also that `_journal.json` has exactly one new entry and that no existing migration file or snapshot was rewritten by a careless `pnpm db:generate`."
---

# 01-leads-schema — the persistence layer for the kanban pipeline

## 0. The decision this slice was told to make and record

> **Are the conversion stage and the Perdido stage identified by a boolean column each, or by a `kind` enum?**

**Decision: one `kind` text discriminator (`'normal' | 'conversion' | 'lost'`), plus the existing
`is_system` boolean, tied together by one biconditional CHECK. NOT two booleans.**

Argued from this repo's own precedents:

1. **The repo already has exactly this shape and it is the newest one.** `sales_ops_products.kind`
   (`'product' | 'service'`) is a `text` discriminator with a CHECK, and it REPLACED a pile of
   per-question booleans - `open_price` survives only as a server-written *projection* of `kind`,
   pinned by `sales_ops_products_kind_open_price_check` (`(kind = 'service') = open_price`).
   CLAUDE.md records that migration as the right direction. Two new booleans would be walking it
   backwards two months later.
2. **The three categories are mutually exclusive, and two booleans cannot say so.**
   `is_conversion AND is_lost` is a representable nonsense row that would need a CHECK anyway; once
   you are writing the CHECK, the column is the wrong shape. A single `kind` makes the nonsense
   unrepresentable rather than merely rejected.
3. **"Exactly one conversion stage per org" is one line with `kind` and two with booleans.**
   `CREATE UNIQUE INDEX ... ON (org_id, kind) WHERE kind <> 'normal'` gives both uniqueness rules at
   once. With booleans it is two partial unique indexes on two columns, which is two things to
   forget.
4. **A fourth category is a literal, not a migration.** A future terminal-positive stage, or a
   "Standby" bucket, adds one string to one CHECK and one union member in zod. With booleans it adds
   a column to a table, a column to every read, and a migration on a table that by then holds every
   org's pipeline.
5. **`is_system` stays**, because it answers a DIFFERENT question - "may the API rename or archive
   this?" - and because slice 02's `409 stage_is_system` is the direct analogue of today's
   `409 funcao_is_system`, which keys on `salesOpsFuncoes.isSystem`. Mirroring the funções guard
   verbatim is worth more than collapsing two orthogonal facts into one column.
   The biconditional CHECK `(kind <> 'normal') = is_system` is what keeps the two from drifting - it
   is `sales_ops_products_kind_open_price_check` applied to the same problem.

`text` + CHECK and **not** a Postgres `CREATE TYPE ... AS ENUM`: nothing in this schema uses a pg
enum, and adding a value to one is `ALTER TYPE`, which cannot run inside the runner's
ordinary-commit transaction.

---

## 1. What exists today (read before writing)

| fact | where |
|---|---|
| there is ALREADY a table called `leads` (legacy referral funnel, `export const leads`) | `apps/api/src/db/schema.ts:224` |
| system rows seeded per org by migration, re-seeded on demand for a new org | `apps/api/drizzle/0012_sales_ops_funcoes.sql` + `resolvePersonFuncoes` in `apps/api/src/domains/sales-ops/service.ts:1388-1440` |
| composite `(org_id, fk)` FK idiom + why | `salesOpsPersonFuncoes` / `salesOpsProductFuncaoCosts` / `salesOpsSaleProfessionals` in `schema.ts` |
| nullable id + `*_name_snapshot` idiom | `salesOpsSaleItems` (`product_id` + `product_name_snapshot`), `salesOpsSales` (`client_id` + `client_name_snapshot`) |
| RLS block wording | `apps/api/drizzle/0012_sales_ops_funcoes.sql`, last third |
| backfill behind an admin context | `0012` and `0020_cadastro_archived_at.sql` |
| `withTenant` (PRIVATE today) | `apps/api/src/domains/sales-ops/service.ts:1303` |
| migrations are applied by the shared runner, ordinary migrations in one commit | `apps/api/src/db/migration-runner.ts` |
| integration tests migrate first, then run serially | `apps/api/test/rls/global-setup.ts`, `apps/api/vitest.config.ts` |
| `fxl_sales_test` already holds `ALTER DEFAULT PRIVILEGES` on new public tables | `nexo/knowledge/decisions/2026-07-29-integration-tests-are-hermetic-local.md` — **no GRANT is needed for the three new tables, and none may be written into the migration** |

> **The legacy `leads` table is a naming trap.** The new Drizzle export is `salesOpsLeads`, the new
> SQL table is `sales_ops_leads`. Do not touch `export const leads` and do not rename it.

---

## 2. Schema — `apps/api/src/db/schema.ts`

Append all three tables **after `salesOpsSaleProfessionals`** and **before `salesOpsReceivables`**,
so `salesOpsProducts`, `salesOpsClients`, `salesOpsPeople` and `salesOpsSales` are all already
declared above (the composite FKs reference those objects at module evaluation time).

Also add the three composite-FK target indexes to the existing tables, in their existing
`(t) => [...]` arrays, each with a one-line comment naming its consumer (exactly as
`sales_ops_people_org_id_id_idx` is commented today):

```ts
// in salesOpsClients's index array:
uniqueIndex('sales_ops_clients_org_id_id_idx').on(t.orgId, t.id),
// in salesOpsProducts's index array:
uniqueIndex('sales_ops_products_org_id_id_idx').on(t.orgId, t.id),
// in salesOpsSales's index array:
uniqueIndex('sales_ops_sales_org_id_id_idx').on(t.orgId, t.id),
```

### 2.1 `salesOpsLeadStages` → `sales_ops_lead_stages`

```ts
export const salesOpsLeadStages = pgTable(
  'sales_ops_lead_stages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    name: text('name').notNull(),                       // pt-BR display label
    kind: text('kind').notNull().default('normal'),     // 'normal' | 'conversion' | 'lost'
    isSystem: boolean('is_system').notNull().default(false),
    position: integer('position').notNull().default(0),
    status: text('status').notNull().default('active'), // 'active' | 'archived'
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('sales_ops_lead_stages_org_name_idx').on(t.orgId, t.name),
    uniqueIndex('sales_ops_lead_stages_org_id_id_idx').on(t.orgId, t.id),
    index('sales_ops_lead_stages_org_position_idx').on(t.orgId, t.position),
    uniqueIndex('sales_ops_lead_stages_org_kind_idx')
      .on(t.orgId, t.kind)
      .where(sql`${t.kind} <> 'normal'`),
    check('sales_ops_lead_stages_kind_check', sql`${t.kind} in ('normal', 'conversion', 'lost')`),
    check('sales_ops_lead_stages_system_kind_check', sql`(${t.kind} <> 'normal') = ${t.isSystem}`),
  ],
);
```

Column notes the executor must reproduce as real comments in the file:

- **`kind`** — the machine key. `'conversion'` is the single stage whose entry opens the proposta
  wizard and which, once entered, is the read-only column mirroring `sale.status`;
  `'lost'` is the single terminal-negative stage that requires a reason. See §0.
- **`isSystem`** — guards rename and archive, exactly as on `sales_ops_funcoes`. Held equal to
  `kind <> 'normal'` by `sales_ops_lead_stages_system_kind_check`.
- **`position`** — deliberately NOT unique per org. A reorder has to pass through a transient
  duplicate, and a non-deferrable unique index would force a two-pass update for no gain; the board
  read orders by `(position, name)` so ties are still deterministic. Always quoted `"position"` in
  hand-written SQL.
- **`archivedAt`** — same contract as `sales_ops_areas.archivedAt`. Written by slice 02, read by
  NOBODY in this feature: `purge-service.ts` is byte-unchanged and a lead stage is deliberately not
  purgeable, because a purged stage would orphan every lead that names it. The column ships here
  only so slice 02 needs no second migration - the same reason `sales_ops_leads.sale_id` ships here
  for slice 08.
- **`sales_ops_lead_stages_org_name_idx`** — a REAL `UNIQUE (org_id, name)` database index, and it
  is load-bearing rather than decorative. Acceptance 5 says a stage follows "o precedente de
  `sales_ops_funcoes`", and that precedent is exactly this: `sales_ops_funcoes_org_name_idx` is a
  database index, surfaced by the API as `409 funcao_name_taken` through
  `mapFuncaoUniqueViolation`, and NOT a service-level probe that two concurrent admins can both
  walk past. Slice 02 surfaces this one as `409 stage_name_taken` the same way. A service probe
  alone is a time-of-check/time-of-use race; the index is the guard and the probe only names which
  rule was hit.
- **No `slug` column**, deliberately, and this is a considered divergence from `sales_ops_funcoes`.
  A função needed a slug because 0012 had to match three reserved machine keys against legacy
  boolean mirrors and because `createFuncao` must refuse `reserved_slug` on a *name*. A stage has
  no legacy data, nothing matches it by name, and `kind` already IS its machine key; a slug would
  add a second identity that silently drifts on every rename.
  The consequence for slice 02 is spelled out there and repeated here so the two cannot drift:
  there is exactly ONE duplicate sentinel, `'duplicate'` → `409 stage_name_taken`, keyed on
  `sales_ops_lead_stages_org_name_idx`. There is no `duplicate_slug`, no `stage_slug_taken` and no
  `reserved_slug`.

### 2.2 `salesOpsLeads` → `sales_ops_leads`

```ts
export const salesOpsLeads = pgTable(
  'sales_ops_leads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    contactName: text('contact_name').notNull(),
    // Empresa. Nullable id + ALWAYS-written snapshot, exactly as
    // sales_ops_sales.(client_id, client_name_snapshot). The snapshot IS the
    // free-text fallback: a lead may name a company that has no cadastro row,
    // and creating a lead NEVER inserts into sales_ops_clients (slice 08 does
    // that, at conversion, and not before).
    clientId: uuid('client_id'),
    clientNameSnapshot: text('client_name_snapshot').notNull(),
    // The ESTIMATE. Integer cents, like every other money column. The name says
    // "estimated" so no reader can mistake it for a priced total: nothing here
    // reaches getSalesOpsSummary, the dashboard or computeSaleFinancials.
    estimatedValueBrl: integer('estimated_value_brl').notNull().default(0),
    description: text('description'),
    // Nullable: a lead may sit unassigned. Server-side seller scoping (slice 03)
    // therefore shows an unassigned lead to admins only, which is correct.
    sellerPersonId: uuid('seller_person_id'),
    sellerNameSnapshot: text('seller_name_snapshot').notNull().default(''),
    stageId: uuid('stage_id').notNull(),
    // Changes ONLY when stage_id changes - never on an ordinary edit and never
    // on a reorder. That is a service-layer rule (slice 03); no trigger.
    stageChangedAt: timestamp('stage_changed_at', { withTimezone: true }).defaultNow().notNull(),
    position: integer('position').notNull().default(0),
    lostReason: text('lost_reason'),
    // The post-conversion link. Written once, by slice 08, after POST /sales
    // returns 201. NULL for every lead that has not converted.
    saleId: uuid('sale_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('sales_ops_leads_org_id_id_idx').on(t.orgId, t.id),
    index('sales_ops_leads_org_stage_position_idx').on(t.orgId, t.stageId, t.position),
    index('sales_ops_leads_org_seller_idx').on(t.orgId, t.sellerPersonId),
    uniqueIndex('sales_ops_leads_org_sale_idx')
      .on(t.orgId, t.saleId)
      .where(sql`${t.saleId} is not null`),
    foreignKey({
      columns: [t.orgId, t.stageId],
      foreignColumns: [salesOpsLeadStages.orgId, salesOpsLeadStages.id],
      name: 'sales_ops_leads_org_stage_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [t.orgId, t.clientId],
      foreignColumns: [salesOpsClients.orgId, salesOpsClients.id],
      name: 'sales_ops_leads_org_client_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [t.orgId, t.sellerPersonId],
      foreignColumns: [salesOpsPeople.orgId, salesOpsPeople.id],
      name: 'sales_ops_leads_org_seller_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [t.orgId, t.saleId],
      foreignColumns: [salesOpsSales.orgId, salesOpsSales.id],
      name: 'sales_ops_leads_org_sale_fk',
    }).onDelete('restrict'),
    check('sales_ops_leads_estimated_value_check', sql`${t.estimatedValueBrl} >= 0`),
  ],
);
```

- All four FKs are **MATCH SIMPLE** (the default), so a NULL `client_id` / `seller_person_id` /
  `sale_id` skips the lookup entirely - which is exactly what an unlinked company, an unassigned
  lead and an unconverted lead need. `stage_id` is NOT NULL, so its FK always fires.
- All four are **`restrict`**, never cascade: a cliente, a pessoa, a produto and a venda all carry
  history, and the "Arquivamento e histórico" rule forbids cascading off them. A stage is
  restrict-referenced too, which is a second, structural reason a stage can only ever be archived.
- **"Perdido requires a reason" is NOT a CHECK.** The rule is "`lost_reason` must be non-empty when
  the lead's stage has `kind = 'lost'`", and that needs a join to `sales_ops_lead_stages`, which a
  CHECK constraint may not contain. It is enforced in zod in slice 03, for exactly the reason
  `cost_split_bp`'s `Σ === 10000` is enforced in zod and not in SQL. Record this in the migration
  header so nobody "hardens" it later with a trigger.

### 2.3 `salesOpsLeadProducts` → `sales_ops_lead_products`

```ts
export const salesOpsLeadProducts = pgTable(
  'sales_ops_lead_products',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    leadId: uuid('lead_id').notNull(),
    productId: uuid('product_id'),
    productNameSnapshot: text('product_name_snapshot').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index('sales_ops_lead_products_org_lead_idx').on(t.orgId, t.leadId),
    foreignKey({
      columns: [t.orgId, t.leadId],
      foreignColumns: [salesOpsLeads.orgId, salesOpsLeads.id],
      name: 'sales_ops_lead_products_org_lead_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.orgId, t.productId],
      foreignColumns: [salesOpsProducts.orgId, salesOpsProducts.id],
      name: 'sales_ops_lead_products_org_product_fk',
    }).onDelete('restrict'),
  ],
);
```

**The one CASCADE, justified against the "Arquivamento e histórico" rule.**
That rule draws the line at *shared history*: `sale_items.product_id`, `sales.seller_person_id`,
`sale_professionals.person_id` and both `area_id`s may never cascade, because each is what makes a
produto or a pessoa with real history undeletable. The two edges that DO cascade today -
`product_funcao_costs.product_id` and `person_funcoes.person_id` - are the parent's **own
configuration**, meaningless without it. `sales_ops_lead_products.lead_id` is that second case,
exactly: a row here has no independent identity, names no beneficiary, carries no money, no
schedule, no ledger entry and nothing references it. It is a line in one lead's "what are we
negotiating" list, and it is not history - it is an *intention*, superseded the moment a proposta is
created, at which point the real history lives in `sales_ops_sale_items`. Deleting a lead and
leaving its product rows behind would be the anomaly.
`product_id` is `restrict` for the mirror-image reason: it points at a produto that DOES carry
history, and a produto a lead still names must stay undeletable - which is also what keeps the
nightly `runArchivedCadastroPurge` from hard-deleting a produto out from under an open negotiation
(the purge lets the database decide, by attempting the DELETE and treating `23503` as "skip", so
this FK is automatically the guard, with no edit to `purge-service.ts`).

**Deliberately NOT added:** a unique index on `(org_id, lead_id, product_id)`. A free-form row has
`product_id IS NULL` and would fall outside a partial unique index anyway, so the rule would be
half-enforced at the database and would still have to be spelled in zod. Slice 03 de-duplicates the
set on write. Recorded so it reads as a decision rather than an omission.

### 2.4 The one-word edit to `service.ts`

`apps/api/src/domains/sales-ops/service.ts:1303`:

```ts
export async function withTenant<T>(db: Db, orgId: string, fn: (tx: Db) => Promise<T>): Promise<T> {
```

Add `export`, add a one-line comment above it (`Exported so the leads module can open the SAME
tenant-scoped transaction; there must be exactly one implementation of setTenantContext-then-run.`)
and change **nothing else in the file**. A second copy of `withTenant` inside `leads/` is the
failure mode this avoids: it would be one more place for the `setTenantContext` call to be forgotten
or reordered.

---

## 3. The migration — `apps/api/drizzle/0022_sales_ops_leads.sql`

### 3.1 How to produce it

1. Edit `schema.ts` first (§2).
2. `cd apps/api && pnpm db:generate` — drizzle-kit writes `drizzle/0022_<random>.sql`,
   `drizzle/meta/0022_snapshot.json` and appends ONE entry to `drizzle/meta/_journal.json`.
3. **Rename the SQL file to `0022_sales_ops_leads.sql` and set that entry's `"tag"` to
   `"0022_sales_ops_leads"`** — 0014, 0016, 0019, 0020 and 0021 all carry hand-chosen descriptive
   tags, and the runner keys on the tag, so the file name and the journal tag must agree exactly.
   Leave `idx`, `when`, `version` and `breakpoints` as generated.
4. Hand-append the RLS block and the seed block (drizzle-kit generates neither), and the header
   comment, following 0012's wording.
5. `git diff --stat apps/api/drizzle` must show exactly three changed paths: the new SQL, the new
   snapshot, and `_journal.json` with **one added entry and no other line touched**. If
   `db:generate` rewrote an older snapshot, revert that file.

### 3.2 What the file must contain, in order

```
-- header comment: what this creates, why kind is a text discriminator and not
--   two booleans (§0, three lines), why lead_products cascades and nothing else
--   does (§2.3), and that "Perdido requires a reason" is a zod rule and NOT a
--   CHECK because it needs a join.

1. CREATE TABLE sales_ops_lead_stages   (with both CHECK constraints inline)
2. CREATE TABLE sales_ops_leads
3. CREATE TABLE sales_ops_lead_products
4. the three composite-FK target indexes on EXISTING tables:
     CREATE UNIQUE INDEX "sales_ops_clients_org_id_id_idx"  ON "sales_ops_clients"  ("org_id","id");
     CREATE UNIQUE INDEX "sales_ops_products_org_id_id_idx" ON "sales_ops_products" ("org_id","id");
     CREATE UNIQUE INDEX "sales_ops_sales_org_id_id_idx"    ON "sales_ops_sales"    ("org_id","id");
   (each is unique by construction - `id` is already the primary key - so none can fail)
5. every index on the three new tables, including `sales_ops_lead_stages_org_name_idx`
   (UNIQUE `(org_id, name)`) and the two PARTIAL unique ones
   (`sales_ops_lead_stages_org_kind_idx`, `sales_ops_leads_org_sale_idx`)
6. every ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY (six of them)
7. for EACH of the three new tables, verbatim in 0012's shape:
     ALTER TABLE <t> ENABLE ROW LEVEL SECURITY;
     ALTER TABLE <t> FORCE ROW LEVEL SECURITY;
     CREATE POLICY <t>_tenant_isolation ON <t>
       AS PERMISSIVE FOR ALL
       USING (org_id = current_setting('app.current_org_id', true))
       WITH CHECK (org_id = current_setting('app.current_org_id', true));
     CREATE POLICY <t>_admin_context ON <t>
       AS PERMISSIVE FOR ALL
       USING (current_setting('app.fxl_admin', true) = 'true')
       WITH CHECK (current_setting('app.fxl_admin', true) = 'true');
8. SELECT set_config('app.fxl_admin', 'true', true);
9. the seed (below)
```

Every statement separated by `--> statement-breakpoint`. No `-- fxl-migration-mode: phased` header:
this is an ordinary migration and the runner applies it in one commit.

### 3.3 The seed, mirroring 0012's org registry exactly

```sql
INSERT INTO "sales_ops_lead_stages" ("org_id", "name", "kind", "is_system", "position")
SELECT o."org_id", s."name", s."kind", s."is_system", s."position"
FROM (
  SELECT DISTINCT "org_id" FROM "sales_ops_people"
  UNION SELECT DISTINCT "org_id" FROM "sales_ops_settings"
  UNION SELECT DISTINCT "org_id" FROM "sales_ops_sales"
) AS o
CROSS JOIN (VALUES
  ('Novo',           'normal',     false, 1),
  ('Em negociação',  'normal',     false, 2),
  ('Proposta',       'conversion', true,  3),
  ('Perdido',        'lost',       true,  4)
) AS s("name", "kind", "is_system", "position")
ON CONFLICT DO NOTHING;
```

- The org registry is the UNION of the three sales-ops footprints, byte-for-byte 0012's, because
  `sales_ops_settings` can legitimately have no row for an org.
- **Bare `ON CONFLICT DO NOTHING`, with no named arbiter**, for the exact reason recorded in
  `resolvePersonFuncoes`: this table carries two unique indexes the seed writes into
  (`(org_id, name)` and the partial `(org_id, kind)`), and naming one arbiter makes Postgres raise
  `23505` whenever it reports the other. Bare absorbs both, which is what makes the migration and
  the runtime seed replay-safe.
- **Four stages, only two of them system.** Two would leave an org with a board that has a
  conversion column and a Perdido column and nowhere for a lead to start. Seeding `Novo` and
  `Em negociação` as ORDINARY, renameable, archivable rows is precisely 0012's `prestador`
  precedent: a usable starting bucket that the org owns, next to the reserved rows it does not.
- `Em negociação` is written with its accent; the column is `text` and the database is UTF-8.

---

## 4. The on-demand seed — `apps/api/src/domains/sales-ops/leads/stages-seed.ts`

New directory `apps/api/src/domains/sales-ops/leads/`, which slices 02 and 03 fill in. This slice
adds exactly one file to it. **No route, no router, no zod schema, no list/CRUD function.**

This is the "whatever runs it for a NEW org" half: migration 0022 seeds every org that exists at
deploy, and an org provisioned afterwards has no stages at all until this runs - the same gap
`resolvePersonFuncoes` closes for funções.

```ts
import { and, asc, eq } from 'drizzle-orm';
import type { getDb } from '../../../db/client.js';
import { salesOpsLeadStages } from '../../../db/schema.js';
import { withTenant } from '../service.js';

type Db = ReturnType<typeof getDb>;

export type LeadStageKind = 'normal' | 'conversion' | 'lost';
export type LeadStageRow = typeof salesOpsLeadStages.$inferSelect;

/**
 * The default pipeline written for every org. Byte-identical to the VALUES list
 * in migration 0022 - if these two ever disagree, an org provisioned before the
 * deploy and one provisioned after get different boards.
 * `leads-schema-migration.test.ts` asserts they agree.
 */
export const LEAD_STAGE_SEEDS = [
  { name: 'Novo', kind: 'normal', isSystem: false, position: 1 },
  { name: 'Em negociação', kind: 'normal', isSystem: false, position: 2 },
  { name: 'Proposta', kind: 'conversion', isSystem: true, position: 3 },
  { name: 'Perdido', kind: 'lost', isSystem: true, position: 4 },
] as const satisfies readonly {
  name: string; kind: LeadStageKind; isSystem: boolean; position: number;
}[];

/** The two stage kinds the API refuses to rename, archive or create. */
export const SYSTEM_LEAD_STAGE_KINDS = ['conversion', 'lost'] as const;

/**
 * Seeds the default pipeline for an org that does not have it yet and returns
 * the org's stages in board order. MUST be called inside an already
 * tenant-scoped transaction (see `ensureLeadStagesForOrg` for the entry point
 * that opens one).
 */
export async function ensureLeadStages(tx: Db, orgId: string): Promise<LeadStageRow[]> { … }

/** Opens the tenant transaction and seeds. The public entry point. */
export async function ensureLeadStagesForOrg(db: Db, orgId: string): Promise<LeadStageRow[]> {
  return withTenant(db, orgId, (tx) => ensureLeadStages(tx, orgId));
}
```

`ensureLeadStages`'s body, in order:

1. Read the org's stages: `select().from(salesOpsLeadStages).where(eq(orgId, orgId))
   .orderBy(asc(position), asc(name))`. **Filter by `eq(salesOpsLeadStages.orgId, orgId)`
   explicitly** even though RLS is on - defence in depth, and it is what the
   `scopes ... even when RLS is not doing the scoping` oracle drives.
2. **If the read is non-empty, return it unchanged and insert nothing.** This is the load-bearing
   line: an org that has renamed `Novo` to `Prospecção`, or archived it, must never have `Novo`
   re-inserted underneath it. "Has this org been seeded" is "does it have ANY stage row", not "does
   it have each of the four".
3. Otherwise insert all four `LEAD_STAGE_SEEDS` in one `.values([...])` with bare
   `.onConflictDoNothing()` (§3.3's reason), then **re-read** with the same query and return that.
   The re-read is not a nicety: a concurrent first request can win the race, the conflict is
   absorbed, and `.returning()` would then come back short. Same shape as `resolvePersonFuncoes`'s
   race fallback.
4. `isSystem` and `kind` are NEVER taken from a caller - there is no caller parameter at all.

---

## 5. Tests

Both files are integration tests under `apps/api/test/rls/`, written in the exact style of
`funcoes-rls.test.ts` and `funcoes-schema-migration.test.ts`: the same `APP_DB_URL` /
`ADMIN_DB_URL` / `ADMIN_CONNECTION_OPTIONS` preamble, the same `newOrgPair` / `newOrg` suffixing, the
same `afterAll` teardown deleting per-org rows through the admin client and ending every client.

Teardown order for both files (children first, or the restrict FKs reject the delete):
`sales_ops_lead_products` → `sales_ops_leads` → `sales_ops_lead_stages` → then whatever sales /
products / clients / people fixtures the file created, in the existing files' order.

**Neither file writes to `audit_log`**, so neither needs the `funcoes-rls.test.ts` ledger-tail
cleanup. Say so in a comment, because the next author will copy that block by reflex.

### 5.1 `apps/api/test/rls/leads-schema-migration.test.ts`

Replays the shipped 0022 backfill exactly as `funcoes-schema-migration.test.ts` replays 0012's:
read `drizzle/0022_*.sql`, split on `--> statement-breakpoint`, find the index of the statement
containing `set_config('app.fxl_admin'`, and run that slice inside one `adminClient.begin`. **Do not
paraphrase the seed SQL** - the whole value of this file is that it drives the shipped bytes.

| oracle test title | decisive against (delete this and the test goes red) |
|---|---|
| `seeds the four default stages per org, with only Proposta and Perdido flagged is_system` | deleting the seed INSERT; flagging all four system; changing a name, a kind or a position |
| `seeds an org that only has a proposta or a settings row` | narrowing the org registry to `sales_ops_people` alone |
| `is idempotent when the backfill statements are replayed` | dropping `ON CONFLICT DO NOTHING`, or naming a single arbiter (replay then raises 23505 and the test throws) |
| `keeps the migration seed and LEAD_STAGE_SEEDS byte-identical` | editing `LEAD_STAGE_SEEDS` without editing 0022, or the reverse. Asserts, for the seeded org, that the rows read back equal `LEAD_STAGE_SEEDS` mapped to `{name, kind, is_system, position}`, ordered by position |
| `refuses a second stage with the same name in one org and allows that name in another org` | dropping `sales_ops_lead_stages_org_name_idx`, which is what slice 02's `409 stage_name_taken` is actually keyed on. Insert `Novo` a second time into the seeded org → rejects naming that exact index; insert `Novo` into a second org → resolves |
| `allows exactly one conversion stage and one lost stage per org, and any number of normal ones` | dropping `sales_ops_lead_stages_org_kind_idx`. Insert a 2nd `conversion` → rejects on that index name; insert a 3rd `normal` → resolves |
| `rejects a stage whose kind and is_system disagree` | dropping `sales_ops_lead_stages_system_kind_check`. Four probes: `('normal', true)` rejects, `('conversion', false)` rejects, `('normal', false)` resolves, `('lost', true)` resolves. Also `kind = 'ganho'` rejects on `sales_ops_lead_stages_kind_check` |
| `forces row level security on all three lead tables and carries both org policies` | dropping any `FORCE ROW LEVEL SECURITY` or any `CREATE POLICY`. Reads `pg_class.relrowsecurity` + `relforcerowsecurity` and `pg_policies.policyname` for the three tables and asserts the six exact policy names |
| `cascades a lead's produtos with the lead and refuses to delete a produto a lead still names` | flipping either `sales_ops_lead_products` FK. Delete the lead → its product rows are gone; `DELETE FROM sales_ops_products` → rejects on `sales_ops_lead_products_org_product_fk` |
| `refuses to delete a stage, a cliente, a pessoa or a venda that a lead still names` | turning any `sales_ops_leads_org_*_fk` into a cascade. Four `DELETE`s, each expected to reject naming its own constraint |
| `declares sales_ops_leads with an integer-cents estimate, a nullable sale_id and a non-null stage_changed_at` | renaming `estimated_value_brl`, storing it as numeric, making `sale_id` NOT NULL or `stage_changed_at` nullable. Reads `information_schema.columns` for `column_name, data_type, is_nullable` and asserts the exact set. Also asserts a negative estimate rejects on `sales_ops_leads_estimated_value_check` |
| `links at most one lead to a given sale` | dropping `sales_ops_leads_org_sale_idx`. Two leads with the same `sale_id` reject; two leads with `sale_id IS NULL` both resolve (this second half is what proves the index is PARTIAL) |

### 5.2 `apps/api/test/rls/leads-rls.test.ts`

Drives `ensureLeadStagesForOrg` (the only service function this slice ships) plus raw SQL for the
lead and lead-product tables, since they have no service layer yet. State that in a file-header
comment so a reader does not think the raw SQL is laziness.

| oracle test title | decisive against |
|---|---|
| `ensureLeadStagesForOrg seeds a brand-new org exactly once and is safe to call again` | deleting the on-demand seed entirely (an org created after 0022 would get zero stages), or dropping the "non-empty read returns unchanged" early return. Asserts: first call returns 4 rows in position order with the two system kinds; second call returns the SAME ids; `count(*)` over the admin client is still 4 |
| `ensureLeadStagesForOrg never re-inserts a stage the org has renamed or archived` | replacing the early return with a per-seed upsert. Rename `Novo` to `Prospecção` and archive it through raw SQL, call again, assert still exactly 4 rows and that no row is named `Novo` |
| `two concurrent first calls for the same org still leave exactly four stages` | dropping `.onConflictDoNothing()` or the re-read fallback. `await Promise.all([ensureLeadStagesForOrg(db, org), ensureLeadStagesForOrg(db, org)])`, both resolve, both return 4 rows with identical id sets, and the admin count is 4 |
| `scopes the stage read by orgId even when RLS is not doing the scoping` | deleting `eq(salesOpsLeadStages.orgId, orgId)` from the read. Runs `ensureLeadStagesForOrg(adminDb, …)` for two orgs over the `app.fxl_admin` connection - where the admin policy makes every org's rows visible - and asserts each call returns only its own 4 |
| `raw RLS blocks cross-org reads of lead stages, leads and lead products and WITH CHECK blocks smuggled inserts` | dropping FORCE RLS or either policy. The full `funcoes-rls.test.ts` scoped-probe-role recipe: `CREATE ROLE … NOSUPERUSER NOBYPASSRLS`, `GRANT USAGE ON SCHEMA public`, `GRANT SELECT, INSERT, UPDATE, DELETE ON sales_ops_lead_stages, sales_ops_leads, sales_ops_lead_products`, insert under org A's context, read back under A (positive control), read under B (empty), insert a row carrying org B's `org_id` from inside A's context (rejects), read with `app.current_org_id` set to `''` (empty), then `DROP OWNED BY` + `DROP ROLE` in a `finally` |
| `the composite foreign keys refuse a cross-org stage, cliente, vendedor, produto and venda even in the admin context` | downgrading any of the six FKs to a single-column reference. For each: build the row in org A naming org B's id, expect the insert to reject naming that exact constraint; then a same-org positive control that resolves |

`GRANT` statements appear only inside this test's probe-role setup, never in the migration.

### 5.3 Commands

```bash
# the two oracles for this slice
pnpm --filter @fxl-sales/api test:integration test/rls/leads-schema-migration.test.ts test/rls/leads-rls.test.ts

# if pnpm swallows the positional args on this version, the explicit form:
pnpm --filter @fxl-sales/api exec sh -c \
  'VITEST_INTEGRATION=1 vitest run test/rls/leads-schema-migration.test.ts test/rls/leads-rls.test.ts'

# the rest of the slice gate
pnpm --filter @fxl-sales/api lint
pnpm --filter @fxl-sales/api type-check
pnpm --filter @fxl-sales/api test            # unit project; must stay green and unchanged
pnpm --filter @fxl-sales/api test:integration # FULL integration suite - 0022 is now in the journal
                                              # for every existing file, so this is the real gate
```

`vitest run`, never a watcher. The integration project migrates first via `global-setup.ts` and runs
`fileParallelism: false`, so no extra setup step is needed - but the local Docker database must be
up and `fxl_sales_test` must already exist (see the hermetic-tests decision doc; its
`ALTER DEFAULT PRIVILEGES` already covers the three new tables, and the migration must NOT contain a
GRANT).

---

## 6. Deliberately out of scope, and why

- **Any route, any zod schema, any list/create/update function.** Slices 02 and 03. `routes.ts` is
  byte-unchanged; `salesOpsRouter` gains nothing, DELETE verb least of all.
- **Anything in `apps/web`**, including `navigation.ts` and `packages/shared-types`. Slices 04-08.
- **`/bootstrap`.** `getSalesOpsSnapshot` is byte-unchanged; leads have their own paginated
  endpoint in slice 03. Acceptance 16.
- **`purge-service.ts`.** A lead stage is never purged - a hard-deleted stage would orphan every
  lead naming it, and the `restrict` FK makes the attempt fail as `23503` anyway, which the purge
  already treats as "skip". `archived_at` ships unwired, on purpose (§2.1).
- **`audit_log`.** Nothing here writes a ledger entry. Acceptance 19.
- **A trigger or CHECK for "Perdido requires a reason"** and for "`stage_changed_at` moves only on a
  stage change". Both need context a constraint cannot see; both are service-layer rules in
  slice 03. §2.2.
- **A unique index on `(org_id, lead_id, product_id)`.** §2.3.
- **Dropping or altering the legacy `leads` table.** Untouched.
- **A `CLAUDE.md` leads-domain section.** Acceptance 24, and it belongs to the last slice that can
  describe the whole domain truthfully.
