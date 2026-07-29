---
id: 05-pessoas-funcoes-api
milestone: v2.3.0
status: todo
depends_on: []
files_modified:
  - apps/api/src/db/schema.ts
  - apps/api/drizzle/0012_sales_ops_funcoes.sql
  - apps/api/drizzle/meta/_journal.json
  - apps/api/src/domains/sales-ops/service.ts
  - apps/api/src/domains/sales-ops/routes.ts
  - apps/api/src/domains/sales-ops/__tests__/funcoes-contract.test.ts
  - apps/api/src/domains/sales-ops/__tests__/routes.test.ts
  - apps/api/test/rls/funcoes-rls.test.ts
  - apps/api/test/rls/funcoes-schema-migration.test.ts
acceptance: "Given an org whose sales_ops_people rows carry the legacy is_seller / is_finder / is_collaborator booleans, when migration 0012 is applied and the sales-ops API is called, then every org has the two immutable system funções `vendedor` and `finder`, every legacy person is reachable as ONE pessoa carrying the matching funções (a seller+finder person carries both), org-created dynamic funções can be created and renamed through admin-gated CRUD while the two system funções cannot, no cross-org read or write of funções or assignments is possible, and every pre-existing sellers/finders/propostas foreign key and endpoint still resolves unchanged."
---

# 05 - Pessoas e Funções (backend: schema, migração, API)

## Goal

Make Funções a first-class org-configurable cadastro in the sales-ops domain and turn the two hardcoded app roles (`vendedor`, `finder`) into predefined funções attached to a pessoa, without creating a second people table and without touching the unrelated affiliate/referral domain.
The pessoas table already exists as `sales_ops_people`; this slice adds `sales_ops_funcoes` plus the `sales_ops_person_funcoes` assignment join, migrates the three legacy boolean columns into função assignments, and extends the existing `/api/v1/sales-ops/people` endpoints plus a new `/api/v1/sales-ops/funcoes` CRUD.
The slice is expand-only: it adds tables, adds columns to no table, drops nothing, and keeps the legacy booleans as derived deprecated mirrors so the current web build stays green and the slice lands as one atomic commit.

## Current state

### Pessoas already exist - do not create a parallel table

`apps/api/src/db/schema.ts:432-447` defines `salesOpsPeople` (`sales_ops_people`):

- `id uuid PK default gen_random_uuid()`, `orgId text NOT NULL`, `displayName text NOT NULL`, `contactEmail text`, `status text NOT NULL default 'active'`
- `isSeller boolean NOT NULL default false` (`apps/api/src/db/schema.ts:440`)
- `isFinder boolean NOT NULL default false` (`apps/api/src/db/schema.ts:441`)
- `isCollaborator boolean NOT NULL default false` (`apps/api/src/db/schema.ts:442`)
- `createdAt`, `updatedAt`
- `index('sales_ops_people_org_id_idx').on(t.orgId, t.displayName)` (`apps/api/src/db/schema.ts:446`)

This IS the Pessoas cadastro.
There is no `accountId`, `workspaceId`, `document`, or `notes` column on it.

### The affiliate `sellers` / `finders` tables are a different domain - untouched

`apps/api/src/db/schema.ts:42-77` (`finders`, org-scoped, carries `accountId` / `workspaceId`) and `apps/api/src/db/schema.ts:82-92` (`sellers`, cross-org, no `org_id`, no RLS) belong to the referral/affiliate product.
Their only consumers are `referralLinks.finderId` (`apps/api/src/db/schema.ts:246`), `clicks`, `conversions.finderId` / `conversions.sellerId` (`apps/api/src/db/schema.ts:327-330`), `commissions.finderId` (`apps/api/src/db/schema.ts:372`), `payouts.finderId` (`apps/api/src/db/schema.ts:413`), and the routes `apps/api/src/domains/sellers/admin-routes.ts`, `apps/api/src/domains/finders/admin-routes.ts`, `apps/api/src/domains/finders/public-routes.ts`, `apps/api/src/domains/finder/routes.ts`.
None of them touches a proposta.
This slice does not read, write, migrate, or reference either table.

### FKs into pessoas already point at `sales_ops_people` - no repointing needed

Verified in the schema:

- `salesOpsSales.sellerPersonId` -> `salesOpsPeople.id` (`apps/api/src/db/schema.ts:560`)
- `salesOpsSales.finderPersonId` -> `salesOpsPeople.id` (`apps/api/src/db/schema.ts:562`)
- `salesOpsSaleProfessionals.personId` -> `salesOpsPeople.id` (`apps/api/src/db/schema.ts:621`)
- The DDL for those three constraints is `apps/api/drizzle/0007_marvelous_valeria_richards.sql:148,150,151`.

`salesOpsPayables` (`apps/api/src/db/schema.ts:646-667`) has **no** person FK at all; it carries `beneficiaryName text NOT NULL` plus `kind`.
The payables generation path `materializeWonPayables` (`apps/api/src/domains/sales-ops/service.ts:496`) fills `beneficiaryName` from `input.sale.sellerName` (`:514`), `input.sale.finderName ?? 'Finder'` (`:527`), the literal `'Impostos'` (`:540`), `professional.personName` (`:553`), and `'Outros custos'` (`:565`).
So no proposta, payable, or commission row depends on the boolean columns or on any person-role linkage.
Nothing in this slice can orphan a historical seller or finder, because no FK moves.

### Existing people API

`apps/api/src/domains/sales-ops/routes.ts`:

- `GET /people` at `:56` - no `requireAdmin`, any authenticated org member, returns `{ people }`.
- `POST /people` at `:61` - `requireAdmin`, `PersonSchema`, returns `{ person }` 201.
- `PATCH /people/:id` at `:70` - `requireAdmin`, `UpdatePersonSchema`, 404 `{ error: 'not_found' }` when the row is not in the caller org.

Validation failures uniformly return `400 { error: 'validation_error', issues: parsed.error.flatten() }`.
`c.get('orgId')` is always the source of the org; the body org is never read.
There is **no DELETE verb anywhere in `salesOpsRouter`** - soft status is the only removal mechanism (`status: 'archived'` for áreas/produtos, `status: 'inactive'` for pessoas).

Zod contracts, `apps/api/src/domains/sales-ops/service.ts`:

- `PersonFieldsSchema` at `:26-33`, `PersonSchema` at `:35-40` (refine: at least one of the three booleans), `UpdatePersonSchema` at `:41-50`.
- `AreaSchema` at `:96-99`, `UpdateAreaSchema` at `:100` - the closest existing shape to the new funções cadastro.

Service handlers: `listPeople` `:628`, `createPerson` `:638`, `updatePerson` `:648`.
Every one wraps `withTenant(db, orgId, ...)` (`:621-626`), which opens a transaction and calls `setTenantContext(tx, orgId)`, and additionally filters `eq(salesOpsPeople.orgId, orgId)` in the WHERE clause.
`listAreas` `:778`, `getArea` `:788`, `createArea` `:799` (returns the literal `'duplicate'` on a per-org name collision), `updateArea` `:812` are the reference implementation to mirror for funções.

`getSalesOpsSnapshot` (`apps/api/src/domains/sales-ops/service.ts:1300-1358`) returns `{ sales, products, clients, people, payables, saleItems, areas, receivables, saleProfessionals, settings }` and backs `GET /bootstrap` (`routes.ts:46`).
`summarizeSalesOpsState` counts `snapshot.people.length` at `service.ts:615`.

Admin gate: `apps/api/src/middleware/require-admin.ts:16-21` reads `c.get('userRole')` and returns `403 { error: 'forbidden', reason: 'admin_role_required' }`.
The router is mounted with `app.use('/api/v1/sales-ops/*', appAuthMiddleware)` then `app.route('/api/v1/sales-ops', salesOpsRouter)` (`apps/api/src/server.ts:74-75`).

### How the three booleans are actually consumed

- `isCollaborator` -> `ProductDialog collaborators=` (`apps/web/src/sales-ops/SalesOpsApp.tsx:1101`) and the wizard's `collaborators` memo (`:3677`), which feeds `professionals[].personName` with a **free-text** `role` string defaulting to `'Operacional'` (`:4823`, editable at `:4880`).
  So `isCollaborator` means exactly "may be picked as a prestador on a product's providers list or on a proposta's professionals list".
- `isSeller` / `isFinder` -> `PeopleView` filter (`:1824`) and the wizard `sellers` / `finders` memos (`:3669`, `:3673`), both additionally filtering `person.status === 'active'`.
- Person dialog toggles at `:3452-3454` ("Vendedor" / "Finder" / "Prestador") and the submit guard at `:3459`.
- Web type `SalesOpsPerson` at `apps/web/src/sales-ops/types.ts:6-17` carries all three booleans.

### "Meus dados" scoping - the honest current state

There is **no** pessoa-to-Hub-account linkage anywhere in the sales-ops domain.
`sales_ops_people` has no `account_id` / `user_id` column, and no sales-ops query filters by `c.get('userId')`.
`meus-dados` visibility is driven purely by the Hub role set through `getVisibleWorkspaces` (`apps/web/src/sales-ops/navigation.ts:90-100`), and the panels it reuses (`PeopleView` with `mode='seller'|'finder'`) render **every** matching person in the org, not just the caller.
Consequence for this slice: there is nothing to preserve, because nothing exists.
Adding a Hub linkage is deliberately **out of scope** here - inventing an `account_id` column now would be unbacked speculation and would silently change what `meus-dados` shows.
This slice must therefore not add any per-user filter, and it flags the missing linkage as a follow-up (see `## Out of scope`).

### RLS policy pattern (mirror this exactly)

Reference: `apps/api/drizzle/0010_sales_ops_areas.sql:13-22`.

```sql
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
```

Every `sales_ops_*` tenant table already has this exact pair (`apps/api/drizzle/0007_marvelous_valeria_richards.sql:164-255`, including `sales_ops_people_tenant_isolation` at `:186` and `sales_ops_people_admin_context` at `:190`).
A missing policy is a hard test failure, because the integration suite provisions a real `NOSUPERUSER NOBYPASSRLS` probe role (`apps/api/test/rls/areas-rls.test.ts:126-137`).

### Migration convention

- Journaled SQL files live in `apps/api/drizzle/`, registered in `apps/api/drizzle/meta/_journal.json`.
- `pnpm --filter @fxl-sales/api db:generate` (`drizzle-kit generate`, `apps/api/package.json:14`) emits the DDL; meaningful migrations are then hand-renamed to a descriptive tag and hand-edited, which requires editing the matching `tag` in `_journal.json`.
- Newest entry is `idx: 11`, `tag: "0011_proposal_lifecycle_schema"`, `when: 1785349621521` (`apps/api/drizzle/meta/_journal.json:75-87`). The new migration is `idx: 12`, tag `0012_sales_ops_funcoes`, and its `when` must be strictly greater than `1785349621521`.
- Statements are separated by `--> statement-breakpoint`.
- Data backfill goes in the **same file, after the DDL and after the RLS policies**, preceded by `SELECT set_config('app.fxl_admin', 'true', true);--> statement-breakpoint` so the backfill can write across orgs under the `*_admin_context` policy. Exact precedent: `apps/api/drizzle/0010_sales_ops_areas.sql:23-28` and `apps/api/drizzle/0011_proposal_lifecycle_schema.sql:16-23`.
- Migrations are applied by `apps/api/src/db/migrate.ts:18` (`migrate(db, { migrationsFolder: './drizzle' })`) and, for tests, by `apps/api/test/rls/global-setup.ts:25` before any integration test connects.
- There is no per-org registry table. `sales_ops_settings` is nullable per org (`getSettings` returns `null` when absent, `service.ts:863-872`), so `0010` seeding from `sales_ops_settings` alone would miss an org that has people but no settings row. The 0012 backfill therefore unions the org sources.

### Test harness

`apps/api/vitest.config.ts:17` switches on `VITEST_INTEGRATION=1`.
Integration mode: `include: ['test/rls/**/*.test.ts', 'src/**/*.integration.test.ts']`, `globalSetup: ['./test/rls/global-setup.ts']`, `setupFiles: ['./test/rls/setup-env.ts']`, `testTimeout: 30000`, `fileParallelism: false`.
Unit mode: `include: ['src/**/__tests__/**/*.test.ts']`, excludes `test/rls/**`, `passWithNoTests: true`.
`apps/api/test/rls/setup-env.ts:21` hard-overrides `DATABASE_URL` so the suite can never reach the staging DB that `apps/api/.env` points at.
Root `pnpm test` runs the **unit** suite only.

## Target schema

Both new tables go in `apps/api/src/db/schema.ts`, after `salesOpsAreas` and before `salesOpsProducts`, so the file order matches the RLS/FK order in the migration.

### `sales_ops_funcoes`

```ts
export const salesOpsFuncoes = pgTable(
  'sales_ops_funcoes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    // pt-BR display label shown in Cadastros and in every picker.
    name: text('name').notNull(),
    // Stable machine key. 'vendedor' and 'finder' are reserved for the two
    // predefined app roles; everything else is slugified from `name` on create.
    slug: text('slug').notNull(),
    // true ONLY for the two predefined app roles. Guards rename/archive/delete.
    isSystem: boolean('is_system').notNull().default(false),
    status: text('status').notNull().default('active'), // 'active' | 'archived'
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('sales_ops_funcoes_org_slug_idx').on(t.orgId, t.slug),
    uniqueIndex('sales_ops_funcoes_org_name_idx').on(t.orgId, t.name),
    // Composite-FK target so sales_ops_person_funcoes can enforce same-org
    // assignment at the database level (see below).
    uniqueIndex('sales_ops_funcoes_org_id_id_idx').on(t.orgId, t.id),
    // Only the two predefined slugs may ever be flagged as system.
    check(
      'sales_ops_funcoes_system_slug_check',
      sql`NOT is_system OR slug IN ('vendedor', 'finder')`,
    ),
  ],
);
```

Why both `slug` and `isSystem`: `slug` is the load-bearing machine key that slices 09 and 12 resolve `vendedor` / `finder` by (never the display name, which an org may localise), while `isSystem` is the immutability guard.
The `check` constraint makes it impossible for an org-created função to be flagged system even through a raw SQL write.
`uniqueIndex(orgId, slug)` leads on `org_id`, matching the repo's RLS-read index convention (`schema.ts:74-76`).

### `sales_ops_person_funcoes`

```ts
export const salesOpsPersonFuncoes = pgTable(
  'sales_ops_person_funcoes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    personId: uuid('person_id').notNull(),
    funcaoId: uuid('funcao_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex('sales_ops_person_funcoes_org_person_funcao_idx').on(
      t.orgId,
      t.personId,
      t.funcaoId,
    ),
    index('sales_ops_person_funcoes_org_funcao_idx').on(t.orgId, t.funcaoId),
    // Composite FKs: (org_id, person_id) and (org_id, funcao_id). A plain
    // single-column FK would happily let org A assign org B's função, because a
    // FK does not consult the RLS predicate. Declared in the migration SQL
    // because drizzle-kit does not emit composite foreignKey() reliably; the TS
    // side declares them via foreignKey({ columns, foreignColumns }) so
    // db:generate stays in sync.
    foreignKey({
      columns: [t.orgId, t.personId],
      foreignColumns: [salesOpsPeople.orgId, salesOpsPeople.id],
      name: 'sales_ops_person_funcoes_org_person_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.orgId, t.funcaoId],
      foreignColumns: [salesOpsFuncoes.orgId, salesOpsFuncoes.id],
      name: 'sales_ops_person_funcoes_org_funcao_fk',
    }).onDelete('restrict'),
  ],
);
```

`ON DELETE cascade` on the person side: an assignment has no meaning without its pessoa, and there is no delete path for pessoas anyway (see below), so cascade is a safety net rather than a behaviour.
`ON DELETE restrict` on the função side: a função that is still assigned can never be deleted out from under an assignment.

### Supporting index on `sales_ops_people`

```ts
uniqueIndex('sales_ops_people_org_id_id_idx').on(t.orgId, t.id),
```

Added to the existing `salesOpsPeople` index list (`apps/api/src/db/schema.ts:446`) purely as the composite-FK target.
No column is added to, changed on, or removed from `sales_ops_people` in this slice.

### The three legacy booleans: kept as derived, deprecated mirrors

`is_seller`, `is_finder`, and `is_collaborator` are **not** dropped in this slice.
Justification, in order of weight:

1. `GET /bootstrap` feeds the whole web app, and five live web call sites plus eight web test files read those booleans (`SalesOpsApp.tsx:1101,1824,3401-3404,3452-3454,3669-3677`, `types.ts:12-14`). Slice 09 is the slice that flips the UI to funções. Dropping the columns in 05 would red-line `pnpm run type-check` and `pnpm run build` and make 05 impossible to land atomically.
2. Expand/contract is the correct shape for a data-model change with a live reader: 05 expands (add tables, write both representations), 09 migrates readers, a later contract slice drops the columns.
3. Keeping them costs one derived write per person mutation and buys a zero-downtime rollback: if 05 is reverted, the booleans are still authoritative and nothing is lost.

The **join table is the single source of truth** from 05 onward.
The service recomputes the mirrors on every person write:

- `is_seller  := funcao set contains slug 'vendedor'`
- `is_finder  := funcao set contains slug 'finder'`
- `is_collaborator := funcao set contains at least one função with is_system = false`

The `is_collaborator` rule is derived from how it is actually consumed (the prestador / professionals picker), so a person tagged only "Desenvolvedor" correctly becomes selectable as a prestador with no extra flag.
The columns are annotated `@deprecated - derived mirror of sales_ops_person_funcoes; drop after slice 09 lands` in `schema.ts`.

## Migration plan

New file `apps/api/drizzle/0012_sales_ops_funcoes.sql`, plus one appended entry in `apps/api/drizzle/meta/_journal.json`.
Ordered, and in exactly this order inside the file.

**Step 1 - DDL for the two new tables.**

```sql
CREATE TABLE "sales_ops_funcoes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"is_system" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "sales_ops_funcoes_system_slug_check" CHECK (NOT is_system OR slug IN ('vendedor', 'finder'))
);--> statement-breakpoint
CREATE TABLE "sales_ops_person_funcoes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"person_id" uuid NOT NULL,
	"funcao_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
```

**Step 2 - indexes, including the two composite-FK targets.**

```sql
CREATE UNIQUE INDEX "sales_ops_funcoes_org_slug_idx" ON "sales_ops_funcoes" USING btree ("org_id","slug");
CREATE UNIQUE INDEX "sales_ops_funcoes_org_name_idx" ON "sales_ops_funcoes" USING btree ("org_id","name");
CREATE UNIQUE INDEX "sales_ops_funcoes_org_id_id_idx" ON "sales_ops_funcoes" USING btree ("org_id","id");
CREATE UNIQUE INDEX "sales_ops_people_org_id_id_idx" ON "sales_ops_people" USING btree ("org_id","id");
CREATE UNIQUE INDEX "sales_ops_person_funcoes_org_person_funcao_idx" ON "sales_ops_person_funcoes" USING btree ("org_id","person_id","funcao_id");
CREATE INDEX "sales_ops_person_funcoes_org_funcao_idx" ON "sales_ops_person_funcoes" USING btree ("org_id","funcao_id");
```

**Step 3 - composite foreign keys** (must follow step 2, they need the unique targets).

```sql
ALTER TABLE "sales_ops_person_funcoes"
  ADD CONSTRAINT "sales_ops_person_funcoes_org_person_fk"
  FOREIGN KEY ("org_id","person_id") REFERENCES "public"."sales_ops_people"("org_id","id")
  ON DELETE cascade ON UPDATE no action;
ALTER TABLE "sales_ops_person_funcoes"
  ADD CONSTRAINT "sales_ops_person_funcoes_org_funcao_fk"
  FOREIGN KEY ("org_id","funcao_id") REFERENCES "public"."sales_ops_funcoes"("org_id","id")
  ON DELETE restrict ON UPDATE no action;
```

**Step 4 - RLS, mirroring `0010_sales_ops_areas.sql:13-22` verbatim** for both tables: `ENABLE`, `FORCE`, `<t>_tenant_isolation`, `<t>_admin_context`.
Four policies total, two per table.
This must come before the backfill so the backfill is genuinely exercising the admin-context policy that production reads will rely on.

**Step 5 - enter the admin context.**

```sql
SELECT set_config('app.fxl_admin', 'true', true);--> statement-breakpoint
```

**Step 6 - seed the two system funções for every existing org.**
The org registry is the union of every org that has any sales-ops footprint, because `sales_ops_settings` is not guaranteed to have a row:

```sql
INSERT INTO "sales_ops_funcoes" ("org_id", "name", "slug", "is_system")
SELECT o."org_id", f."name", f."slug", true
FROM (
  SELECT DISTINCT "org_id" FROM "sales_ops_people"
  UNION SELECT DISTINCT "org_id" FROM "sales_ops_settings"
  UNION SELECT DISTINCT "org_id" FROM "sales_ops_sales"
) AS o
CROSS JOIN (VALUES ('Vendedor', 'vendedor'), ('Finder', 'finder')) AS f("name", "slug")
ON CONFLICT ("org_id", "slug") DO NOTHING;
```

**Step 7 - seed the `prestador` função, only where it is needed.**

```sql
INSERT INTO "sales_ops_funcoes" ("org_id", "name", "slug", "is_system")
SELECT DISTINCT "org_id", 'Prestador', 'prestador', false
FROM "sales_ops_people"
WHERE "is_collaborator" = true
ON CONFLICT ("org_id", "slug") DO NOTHING;
```

`is_system = false` on purpose: "Prestador" is a compatibility bucket for the existing collaborator picker, not a predefined app role, so an org may later rename or archive it.
Orgs with no collaborator get no `prestador` row - the cadastro stays clean.

**Step 8 - backfill the assignments.** One statement per legacy boolean, all idempotent:

```sql
INSERT INTO "sales_ops_person_funcoes" ("org_id", "person_id", "funcao_id")
SELECT p."org_id", p."id", f."id"
FROM "sales_ops_people" p
JOIN "sales_ops_funcoes" f ON f."org_id" = p."org_id" AND f."slug" = 'vendedor'
WHERE p."is_seller" = true
ON CONFLICT ("org_id", "person_id", "funcao_id") DO NOTHING;
-- identical statements for is_finder -> 'finder' and is_collaborator -> 'prestador'
```

**Identity matching rule - how "the same human" is identified.**
It is not a name match and not an e-mail match.
`sales_ops_people` is already the unified people table: a human who is both a seller and a finder is **already one row** with `is_seller = true AND is_finder = true`.
The backfill therefore matches on `sales_ops_people.id`, which is exact and needs no heuristic.
The three INSERTs above are independent, keyed on the same `person_id`, and de-duplicated by `ON CONFLICT (org_id, person_id, funcao_id)`, so a seller+finder person ends up as ONE pessoa with exactly TWO assignment rows.
There is no fallback, because there is no ambiguity to fall back from.
This is the direct consequence of the corrected scope: the risky cross-table name/e-mail matching the original brief worried about applies to the affiliate `sellers` / `finders` tables, which this slice does not touch.

**Step 9 - journal entry.** Append to `apps/api/drizzle/meta/_journal.json`:

```json
{ "idx": 12, "version": "7", "when": <epoch-ms > 1785349621521>, "tag": "0012_sales_ops_funcoes", "breakpoints": true }
```

Use whatever `when` `drizzle-kit generate` stamps, then hand-rename the tag and the file to `0012_sales_ops_funcoes`.

**Reversibility.**
The migration is fully reversible by data: it creates two tables and four indexes, and inserts only into the two new tables.
It never `UPDATE`s, `DELETE`s, `ALTER`s, or drops any pre-existing row, column, constraint, or policy.
A rollback is `DROP TABLE sales_ops_person_funcoes; DROP TABLE sales_ops_funcoes; DROP INDEX sales_ops_people_org_id_id_idx;` and the database is byte-equivalent to pre-0012 apart from sequence-free uuid generation.
The **only** irreversible facts: (a) the uuids minted for the seeded funções are not reproducible, so a drop-and-replay yields different ids and any external reference captured in between would dangle; (b) `_journal.json` is append-only in practice, so an actual rollback needs a forward `0013` rather than an edit to 0012. Both are stated so an operator does not assume a clean `down`.

## API contract

Base path `/api/v1/sales-ops`.
Every route sits behind `appAuthMiddleware` via `apps/api/src/server.ts:74`; `orgId` always comes from `c.get('orgId')` and every query carries `eq(table.orgId, c.get('orgId'))` inside `withTenant`.
No handler reads `orgId`, `userId`, `accountId`, or `workspaceId` from a request body.
Validation failures return `400 { error: 'validation_error', issues: <ZodFlattenedError> }`, matching every existing handler.

### Shared response shapes

```ts
type FuncaoResponse = {
  id: string;
  orgId: string;
  name: string;            // pt-BR label, e.g. "Vendedor", "Desenvolvedor"
  slug: string;            // "vendedor" | "finder" | slugified name
  isSystem: boolean;
  status: 'active' | 'archived';
  createdAt: string;       // ISO
  updatedAt: string | null;
};

type PersonResponse = {
  id: string;
  orgId: string;
  displayName: string;
  contactEmail: string | null;
  status: 'active' | 'inactive';
  // Forward contract - slices 09 and 12 read these.
  funcaoIds: string[];
  funcoes: Array<Pick<FuncaoResponse, 'id' | 'name' | 'slug' | 'isSystem'>>;
  // @deprecated derived mirrors, still emitted for the pre-slice-09 web build.
  isSeller: boolean;
  isFinder: boolean;
  isCollaborator: boolean;
  createdAt: string;
  updatedAt: string | null;
};
```

`funcoes` is sorted by `isSystem DESC, name ASC` so `vendedor` / `finder` lead deterministically.

### Funções

**`GET /funcoes`** - auth: any authenticated org member (no `requireAdmin`, mirroring `GET /areas` at `routes.ts:134`).
Request: none.
Response `200 { funcoes: FuncaoResponse[] }`, ordered `isSystem DESC, name ASC`.

**`POST /funcoes`** - auth: `requireAdmin`.

```ts
export const FuncaoSchema = z.object({
  name: z.string().trim().min(1).max(120),
  status: z.enum(['active', 'archived']).default('active'),
});
```

`slug` is **never** accepted from the body; it is derived server-side by `slugifyFuncao(name)` (lowercase, strip diacritics, non-alphanumerics to `-`, collapse and trim `-`, cap 120).
`isSystem` is never accepted from the body and is always written as `false`.
Responses:

- `201 { funcao: FuncaoResponse }`
- `400 { error: 'validation_error', reason: 'reserved_funcao_slug' }` when the derived slug is `vendedor` or `finder`
- `409 { error: 'conflict', reason: 'funcao_name_taken' }` on a per-org name collision (mirrors `POST /areas` at `routes.ts:145`)
- `409 { error: 'conflict', reason: 'funcao_slug_taken' }` when the name is distinct but the derived slug collides
- `403 { error: 'forbidden', reason: 'admin_role_required' }` for a non-admin

**`PATCH /funcoes/:id`** - auth: `requireAdmin`.

```ts
export const UpdateFuncaoSchema = FuncaoSchema.partial();
```

Responses:

- `200 { funcao: FuncaoResponse }`
- `404 { error: 'not_found' }` when the id is absent or belongs to another org
- `409 { error: 'conflict', reason: 'funcao_is_system' }` when the target row has `isSystem = true` and the patch would change `name` or `status`. The two predefined funções are fully immutable through the API: no rename, no archive, no delete.
- `409 { error: 'conflict', reason: 'funcao_name_taken' }` / `'funcao_slug_taken'` on collision with a different row in the same org
- `400 { error: 'validation_error', reason: 'reserved_funcao_slug' }` when a rename would derive a reserved slug
- `403 { error: 'forbidden', reason: 'admin_role_required' }`

**No `DELETE /funcoes/:id`.**
`salesOpsRouter` has no DELETE verb today and this slice does not introduce one.
Removal is `PATCH { status: 'archived' }`, exactly as for áreas and produtos.
Archiving a função that still has assignments is **allowed** - archived funções simply stop appearing in pickers, matching the existing áreas/produtos archive semantics - and the assignment rows survive so historical propostas keep their labels.
System funções cannot be archived at all.

### Pessoas

**`GET /people`** - unchanged path, unchanged auth (any authenticated org member, `routes.ts:56`).
Response `200 { people: PersonResponse[] }`, ordered by `displayName`.
Additive only: the three legacy booleans are still present with identical semantics, so the pre-slice-09 web build is unaffected.

**`POST /people`** - unchanged path, `requireAdmin`.

```ts
const PersonFieldsSchema = z.object({
  displayName: z.string().min(1).max(120),
  contactEmail: z.string().email().optional().or(z.literal('')),
  status: z.enum(['active', 'inactive']).default('active'),
  // Forward contract.
  funcaoIds: z.array(z.string().uuid()).optional(),
  // @deprecated compat shim - accepted only while the web build predates slice 09.
  isSeller: z.boolean().optional(),
  isFinder: z.boolean().optional(),
  isCollaborator: z.boolean().optional(),
});
export const PersonSchema = PersonFieldsSchema;      // cross-field rules live in the service
export const UpdatePersonSchema = PersonFieldsSchema.partial();
```

The at-least-one-role rule moves out of `.refine()` and into the service, because it now has to consult the org's função rows.
Resolution rule, in order:

1. If `funcaoIds` is present, it is **authoritative**. Every id is verified to exist in the caller org (`eq(salesOpsFuncoes.orgId, orgId)`); any unknown or foreign id yields `400 { error: 'validation_error', reason: 'unknown_funcao' }` - the same guard shape `POST /products` uses for `unknown_area` (`routes.ts:91`). The legacy booleans in the body are ignored entirely.
2. Else, if any of the three legacy booleans is present and true, they map to the caller org's `vendedor` / `finder` / `prestador` funções. `vendedor` and `finder` are guaranteed to exist by the 0012 seed; `prestador` is created on demand (`isSystem: false`) if `isCollaborator: true` and no `prestador` row exists yet.
3. If neither path yields at least one função, `400 { error: 'validation_error', reason: 'funcao_required' }`.

After resolution the service, inside one `withTenant` transaction: inserts/updates the `sales_ops_people` row, replaces the whole `sales_ops_person_funcoes` set for that person (delete-then-insert scoped by `and(eq(orgId), eq(personId))`), and writes the three derived boolean mirrors.
Responses:

- `201 { person: PersonResponse }`
- `400 { error: 'validation_error', ... }` per above
- `403 { error: 'forbidden', reason: 'admin_role_required' }`

**`PATCH /people/:id`** - unchanged path, `requireAdmin`.
All fields partial.
`funcaoIds`, when present, is a **full set replacement**, not a merge, and an empty array is rejected with `funcao_required`.
When `funcaoIds` is absent the assignment set is left untouched.
Responses: `200 { person: PersonResponse }`, `404 { error: 'not_found' }`, plus the 400/403 shapes above.

**No `DELETE /people/:id`.**
Pessoas are never hard-deleted - `status: 'inactive'` is the soft delete, and it is already what every picker filters on (`SalesOpsApp.tsx:3669-3677`).
The "deleting a pessoa referenced by a proposta must be prevented" requirement is therefore satisfied structurally: there is no delete path to prevent, and `salesOpsSales.sellerPersonId` / `finderPersonId` / `salesOpsSaleProfessionals.personId` keep resolving forever.
This is stated in the plan rather than implemented as a guard, because adding a DELETE route just to refuse it would be worse than having none.

**Assignment management lives on the person endpoints, not a sub-resource.**
No `POST /people/:id/funcoes` or `DELETE /people/:id/funcoes/:funcaoId`.
Reasons: the slice-09 UI saves a whole pessoa in one dialog, so a set-replace is one round trip instead of N; the router has no DELETE convention to extend; and one write path means one place where the derived boolean mirrors are recomputed, which removes any chance of the mirrors drifting.

### Bootstrap

**`GET /bootstrap`** - unchanged path and auth.
`getSalesOpsSnapshot` gains two keys and enriches one:

```ts
{
  sales, products, clients,
  people: PersonResponse[],          // now carries funcaoIds + funcoes
  funcoes: FuncaoResponse[],         // NEW
  personFuncoes: Array<{ id, orgId, personId, funcaoId, createdAt }>, // NEW
  payables, saleItems, areas, receivables, saleProfessionals, settings
}
```

Both new reads are `withTenant` + `eq(table.orgId, orgId)`.
`summarizeSalesOpsState` (`service.ts:612-617`) is untouched; `counts.people` keeps its meaning.

## Compatibility matrix

| Consumer | Location | Fate |
| --- | --- | --- |
| `GET /api/v1/sales-ops/people` | `routes.ts:56` | **Unchanged contract, additive response.** Gains `funcaoIds` + `funcoes`; the three booleans stay. |
| `POST /api/v1/sales-ops/people` | `routes.ts:61` | **Adapted, backward compatible.** `funcaoIds` added as the forward contract; the boolean payload keeps working via the compat shim. |
| `PATCH /api/v1/sales-ops/people/:id` | `routes.ts:70` | **Adapted, backward compatible.** Same rule; `funcaoIds` is a set replacement. |
| `GET /api/v1/sales-ops/bootstrap` | `routes.ts:46` | **Adapted, additive.** Two new arrays, enriched `people`. |
| `GET/POST/PATCH /funcoes` | new | **Added.** |
| `sales_ops_people.is_seller/is_finder/is_collaborator` | `schema.ts:440-442` | **Kept, demoted to derived deprecated mirrors.** Recomputed on every person write. Dropped by a later contract slice, not here. |
| `salesOpsSales.sellerPersonId` FK | `schema.ts:560` | **Untouched.** Still `-> sales_ops_people.id`. No proposta loses its seller. |
| `salesOpsSales.finderPersonId` FK | `schema.ts:562` | **Untouched.** Still `-> sales_ops_people.id`. |
| `salesOpsSaleProfessionals.personId` FK | `schema.ts:621` | **Untouched.** |
| `salesOpsPayables` | `schema.ts:646` | **Untouched.** No person FK exists; `beneficiaryName` is free text. |
| `materializeWonPayables` | `service.ts:496-566` | **Untouched.** Reads `sale.sellerName` / `sale.finderName` / `professional.personName`, never a role flag. Payables generation path cannot break. |
| `createSale` / `updateSale` / `transitionSale` / `cancelContract` | `routes.ts:165,216,184,199` | **Untouched.** `sellerPersonId` / `finderPersonId` / `professionals[].role` (free text) keep their exact shapes. |
| `sales_ops_products.providers` jsonb (`personName` + commission) | `schema.ts:495`, `service.ts:58-62` | **Untouched in 05.** Slice 07 replaces it with per-função cost defaults; this slice only makes the funções available to it. |
| `salesOpsSaleProfessionals.role` free text | `schema.ts:623` | **Untouched in 05.** Binding it to a `funcaoId` is slice 12's call, not this slice's. |
| Affiliate `sellers` table + `domains/sellers/admin-routes.ts` | `schema.ts:82`, route file | **Untouched. Different domain.** |
| Affiliate `finders` table + `domains/finders/*`, `domains/finder/routes.ts` | `schema.ts:42`, route files | **Untouched. Different domain.** |
| `referralLinks` / `clicks` / `conversions` / `commissions` / `payouts` FKs to affiliate finders/sellers | `schema.ts:246,286,327-330,372,413` | **Untouched.** |
| `apps/web/src/sales-ops/types.ts` `SalesOpsPerson` | `types.ts:6-17` | **Untouched in 05.** Extended in slice 09. The additive API response is structurally compatible with the current type. |
| `SalesOpsApp.tsx` boolean readers | `:1101, :1824, :3401-3404, :3452-3454, :3669-3677` | **Untouched in 05, replaced in slice 09.** Keep working because the mirrors keep being written. |
| `navigation.ts` `cadastros` entries `vendedores` / `finders` | `navigation.ts:56-63` | **Untouched in 05.** Replaced by `pessoas` + `funcoes` in slice 09. Backend has no route dependency on them. |
| `apps/web/src/sales-ops/__tests__/*` fixtures with the three booleans | 8 files | **Untouched in 05.** Still green because the API still emits the booleans. |
| `apps/api/src/domains/sales-ops/__tests__/routes.test.ts` | whole file | **Extended.** New funções gate cases; existing person cases keep passing because the boolean payload path is preserved. |
| `apps/api/src/domains/sales-ops/__tests__/service.test.ts` | whole file | **Untouched.** No ledger or payables behaviour changes. |
| `apps/api/test/rls/*` existing files | 12 files | **Untouched.** No existing table or policy changes. |
| `getVisibleWorkspaces` / `AppRole` Hub role rules | `navigation.ts:90`, `auth/claims.ts` | **Untouched.** Funções are org data; Hub `AppRole` stays the authority for workspace visibility. Batch scope limit respected. |

## Red

Write these first and watch them fail.

### 1. `apps/api/test/rls/funcoes-rls.test.ts` (new)

Model on `apps/api/test/rls/areas-rls.test.ts` - same `APP_DB_URL` / `ADMIN_DB_URL` / `ADMIN_CONNECTION_OPTIONS` preamble (`:15-20`), same `withRole` helper (`:28-33`), same `afterAll` cleanup loop deleting `sales_ops_person_funcoes`, then `sales_ops_funcoes`, then `sales_ops_people` per collected org id.

- `it('função CRUD stays tenant-scoped through the service layer')` - `createFuncao(db, orgA, ...)` then assert `listFuncoes(db, orgB)` is `[]`, `getFuncao(db, orgB, idA)` is `null`, `updateFuncao(db, orgB, idA, { name: 'hijack' })` is `null`, and `updateFuncao(db, orgA, idA, { status: 'archived' })` sets `status: 'archived'` with a non-null `updatedAt`.
- `it('createFuncao reports duplicates per org but allows the same name in another org')` - second create in org A returns `'duplicate'`; same name in org B succeeds.
- `it('createFuncao refuses the reserved vendedor and finder slugs')` - both return `'reserved_slug'`.
- `it('updateFuncao refuses to rename or archive a system função')` - seed a system função via the admin client, then assert both `{ name: 'Outro' }` and `{ status: 'archived' }` return `'is_system'` and the row is unchanged in the DB.
- `it('org A cannot read org B pessoas or funções')` - the required tenant-isolation oracle. Create a pessoa with funções in org A and in org B, then assert `listPeople(db, orgA)` and `listFuncoes(db, orgA)` contain only org A ids and never an org B id, and symmetrically for org B.
- `it('assignFuncoes refuses a funcao id belonging to another org')` - `createPerson(db, orgA, { ..., funcaoIds: [funcaoFromOrgB.id] })` rejects with `unknown_funcao` and inserts no assignment row.
- `it('listPeople returns each pessoa with its funções attached and the derived boolean mirrors')` - a pessoa assigned `vendedor` + a dynamic `Desenvolvedor` comes back with `funcoes.length === 2`, `isSeller === true`, `isFinder === false`, `isCollaborator === true`.
- `it('raw RLS blocks cross-org reads of funcoes and person_funcoes and WITH CHECK blocks smuggled inserts')` - the policy-level oracle. Copy the scoped-role block at `areas-rls.test.ts:120-181`: `CREATE ROLE ... NOSUPERUSER NOBYPASSRLS`, `GRANT SELECT, INSERT, UPDATE, DELETE ON sales_ops_funcoes, sales_ops_person_funcoes, sales_ops_people`, insert under `app.current_org_id = ORG_A`, prove the row is invisible under `ORG_B`, prove an insert of an `ORG_B` row while the context says `ORG_A` `rejects.toThrow()`, then `DROP OWNED BY` / `DROP ROLE` in the `finally`. Run it for both new tables.
- `it('a cross-org assignment is rejected by the composite foreign key even in the admin context')` - insert directly with the admin client, pairing org A's `person_id` with org B's `funcao_id`; assert it throws. Proves the composite FK, not just the service filter.

### 2. `apps/api/test/rls/funcoes-schema-migration.test.ts` (new)

Model on `apps/api/test/rls/proposal-schema-migration.test.ts` - admin client throughout (`:22-29`), and the shipped-SQL replay technique at `:96-115`: read `drizzle/0012_*.sql`, split on `--> statement-breakpoint`, find the index of the statement containing `set_config('app.fxl_admin'`, slice from there, and execute those statements inside one `adminClient.begin`.

Fixture per test: an org id, plus `sales_ops_people` rows inserted with the legacy booleans only and **no** assignment rows.

- `it('seeds vendedor and finder exactly once per org, both flagged is_system')` - after replay, the org has exactly two `is_system = true` funções with slugs `vendedor` and `finder` and names `Vendedor` / `Finder`.
- `it('backfills an is_seller person as one pessoa carrying the vendedor função')` - one person row, one assignment, slug `vendedor`.
- `it('backfills an is_finder person as one pessoa carrying the finder função')` - one person row, one assignment, slug `finder`.
- `it('backfills a person who is both seller and finder as ONE pessoa with BOTH funções')` - the load-bearing case. Assert `sales_ops_people` still has exactly one row for that person id and `sales_ops_person_funcoes` has exactly two rows for it, slugs `{vendedor, finder}`.
- `it('maps is_collaborator to a non-system prestador função and skips orgs with no collaborator')` - org X has a collaborator and gets `prestador` (`is_system = false`); org Y has none and has no `prestador` row.
- `it('is idempotent when the backfill statements are replayed')` - run the replay twice; assert identical funções and assignment counts.
- `it('leaves the legacy boolean columns and every sales FK intact')` - the no-regression oracle. Insert a `sales_ops_sales` row with `seller_person_id` / `finder_person_id` set, replay, then assert both columns still resolve to the same person ids and the person's booleans are unchanged.

### 3. `apps/api/src/domains/sales-ops/__tests__/funcoes-contract.test.ts` (new, unit)

Model on `apps/api/src/domains/sales-ops/__tests__/areas-contract.test.ts`, including its file-content migration assertions at `:37-63`.

- `it('accepts a minimal função payload and defaults status to active')`
- `it('rejects an empty or blank função name')`
- `it('rejects unsupported função statuses')`
- `it('derives a slug from the função name, stripping diacritics and punctuation')` - `'P.O.' -> 'p-o'`, `'Desenvolvedor Sênior' -> 'desenvolvedor-senior'`
- `it('never accepts slug or isSystem from the request body')` - `FuncaoSchema.parse({ name: 'X', slug: 'vendedor', isSystem: true })` yields an object with neither key
- `it('requires at least one função on a person create payload')` - the service-level resolver returns `funcao_required` for `{ displayName: 'X' }`
- `it('accepts the legacy boolean person payload as a deprecated compat shim')` - `{ displayName: 'X', isSeller: true }` resolves to the `vendedor` slug
- `it('prefers funcaoIds over the legacy booleans when both are present')`
- `it('the shipped 0012 migration enables and forces RLS on both tables and seeds behind the admin context')` - read `drizzle/0012_sales_ops_funcoes.sql` and assert, by index ordering exactly as `areas-contract.test.ts:41-63` does, that `ENABLE ROW LEVEL SECURITY` and `FORCE ROW LEVEL SECURITY` appear for both `sales_ops_funcoes` and `sales_ops_person_funcoes`, that all four policy names are present, that `set_config('app.fxl_admin', 'true', true)` comes **after** the policies and **before** the first `INSERT INTO "sales_ops_funcoes"`, that `'vendedor'`, `'finder'`, `'prestador'` are seeded, and that every backfill INSERT carries `ON CONFLICT ... DO NOTHING`.
- `it('registers migration 0012 in the drizzle journal after 0011')` - `_journal.json` has `idx: 12`, `tag: '0012_sales_ops_funcoes'`, and `when > 1785349621521`.

### 4. `apps/api/src/domains/sales-ops/__tests__/routes.test.ts` (extend)

Add to the existing mock surface (`:5-16` and `:22-36`) and the existing `beforeEach` defaults (`:154-168`): `listFuncoes`, `createFuncao`, `updateFuncao`, `getFuncao`.
New `describe('Sales Ops funções routes')`:

- `it.each(['seller', 'finder'])('keeps GET /funcoes available to %s')` - 200, service called with `(mockedDb, 'verified-org')`
- `it.each(['seller', 'finder', undefined])('rejects POST /funcoes for role %s before service execution')` - 403 `admin_role_required`, `createFuncao` not called
- `it.each(['seller', 'finder', undefined])('rejects PATCH /funcoes/:id for role %s before service execution')` - same
- `it('never trusts orgId from a função request body')` - post `{ name: 'Dev', orgId: 'body-org-must-not-be-used' }` as admin, assert `createFuncao` received `'verified-org'`
- `it('maps a duplicate função name to 409 funcao_name_taken')`
- `it('maps a system função patch to 409 funcao_is_system')`
- `it('returns 404 when PATCH /funcoes/:id targets another org')`
- `it('rejects an unknown funcaoId on POST /people with 400 unknown_funcao')`
- `it('has no DELETE route for people or funcoes')` - `app.request('/people/<uuid>', { method: 'DELETE' })` and the same for `/funcoes/<uuid>` both return 404, pinning the no-DELETE convention.

### ORACLE commands

```bash
# 1. Local Docker test DB must be up (integration suite is pinned to it via
#    TEST_DATABASE_URL / TEST_MIGRATE_DATABASE_URL / ADMIN_DATABASE_URL in apps/api/.env,
#    connecting as the non-superuser fxl_sales_test role so RLS is genuinely enforced).
docker compose up -d

# 2. PRIMARY oracle - schema, migration, backfill, RLS.
pnpm --filter @fxl-sales/api test:integration

# 3. Unit + guard suite (does NOT run the integration tests).
CI=true pnpm test

# 4. Static gates.
pnpm run lint
pnpm run type-check
pnpm run build
```

All five must exit 0.

## Green

1. `apps/api/src/db/schema.ts` - add `foreignKey` to the `drizzle-orm/pg-core` import list (`:24-37`), then add `salesOpsFuncoes` and `salesOpsPersonFuncoes` between `salesOpsAreas` (`:449-460`) and `salesOpsProducts` (`:462`), exactly as specified in `## Target schema`.
2. `apps/api/src/db/schema.ts` - append `uniqueIndex('sales_ops_people_org_id_id_idx').on(t.orgId, t.id)` to the `salesOpsPeople` index array (`:446`) and add the `@deprecated - derived mirror of sales_ops_person_funcoes; drop after slice 09` comment above `isSeller` (`:440`).
3. Run `pnpm --filter @fxl-sales/api db:generate`, then hand-rename the emitted file to `apps/api/drizzle/0012_sales_ops_funcoes.sql` and its `tag` in `apps/api/drizzle/meta/_journal.json` to `0012_sales_ops_funcoes` with `idx: 12`.
4. Hand-edit `0012_sales_ops_funcoes.sql` to contain, in order, migration-plan steps 1 through 8: DDL, indexes, composite FKs, the four RLS statements per table, `set_config('app.fxl_admin', ...)`, the two seed INSERTs, and the three backfill INSERTs. Every statement separated by `--> statement-breakpoint`.
5. `apps/api/src/domains/sales-ops/service.ts` - add `slugifyFuncao(name: string): string` (lowercase, `normalize('NFD')` + strip combining marks, non-alphanumerics to `-`, collapse and trim `-`, cap 120) and the module constant `SYSTEM_FUNCAO_SLUGS = ['vendedor', 'finder'] as const`.
6. Same file - add `FuncaoSchema`, `UpdateFuncaoSchema`, and `export type FuncaoInput`, placed next to `AreaSchema` (`:96-101`).
7. Same file - rewrite `PersonFieldsSchema` (`:26-33`) to the shape in `## API contract`: drop both `.refine()` wrappers, make the three booleans optional, add optional `funcaoIds`. `PersonSchema` and `UpdatePersonSchema` become the plain and `.partial()` forms.
8. Same file - add `listFuncoes`, `getFuncao`, `createFuncao`, `updateFuncao`, each wrapping `withTenant(db, orgId, ...)` and filtering `eq(salesOpsFuncoes.orgId, orgId)`, modelled 1:1 on `listAreas` / `getArea` / `createArea` / `updateArea` (`:778-835`). `createFuncao` returns `'duplicate' | 'reserved_slug' | row`; `updateFuncao` returns `'duplicate' | 'reserved_slug' | 'is_system' | null | row`.
9. Same file - add `resolvePersonFuncoes(tx, orgId, input)`: returns `{ funcaoIds, isSeller, isFinder, isCollaborator }` or a `'unknown_funcao' | 'funcao_required'` sentinel, implementing the three-step resolution rule, including on-demand creation of the non-system `prestador` função for the legacy `isCollaborator: true` path.
10. Same file - add `replacePersonFuncoes(tx, orgId, personId, funcaoIds)`: delete-then-insert scoped by `and(eq(salesOpsPersonFuncoes.orgId, orgId), eq(salesOpsPersonFuncoes.personId, personId))`.
11. Same file - rewrite `createPerson` (`:638`) and `updatePerson` (`:648`) to run resolve, upsert the person row with the three derived mirrors, call `replacePersonFuncoes`, and return the row with `funcaoIds` + `funcoes` attached. All inside the single existing `withTenant` transaction so a partial write is impossible.
12. Same file - add `attachPersonFuncoes(tx, orgId, people)` (one grouped read of `salesOpsPersonFuncoes` joined to `salesOpsFuncoes`, ordered `isSystem DESC, name ASC`) and use it from `listPeople` (`:628`) and from `getSalesOpsSnapshot` (`:1317-1321`).
13. Same file - add the `funcoes` and `personFuncoes` reads to `getSalesOpsSnapshot` (`:1300-1358`), both `eq(table.orgId, orgId)`, and add both keys to the returned object (`:1345-1356`).
14. `apps/api/src/domains/sales-ops/routes.ts` - add `GET /funcoes`, `POST /funcoes` (`requireAdmin`), `PATCH /funcoes/:id` (`requireAdmin`) directly after the `/areas` block (`:134-158`), mapping the service sentinels to the status codes in `## API contract`. Import the four new service symbols and the two new schemas into the existing alphabetised import list (`:5-40`).
15. Same file - extend the `POST /people` (`:61`) and `PATCH /people/:id` (`:70`) handlers to map `'unknown_funcao'` and `'funcao_required'` to `400 { error: 'validation_error', reason }`.
16. Run the ORACLE commands. Everything green in one commit.

## Refactor

- Once green, collapse `createFuncao` / `updateFuncao` duplicate-name detection and `createArea` / `updateArea`'s identical logic (`service.ts:799-835`) into one `assertUniquePerOrg(tx, table, orgId, column, value, excludeId)` helper. Two near-identical copies is the threshold where the third would be a smell; do it now while both are in scope.
- Extract the repeated `withTenant` + `eq(orgId)` + `orderBy` list shape into a small `listForOrg(table, orderColumn)` factory only if it does not obscure the explicit `eq(table.orgId, orgId)` that CLAUDE.md requires to be visible at each call site. If it hides the filter, do not do it - explicitness wins here.
- Keep `slugifyFuncao` in `service.ts` for this slice. Move it to `packages/shared-utils` only when slice 09 or 10 needs the same slug rule in the browser.
- Do not touch `SalesOpsApp.tsx`, `types.ts`, `api.ts`, `hooks.ts`, or `navigation.ts` - that is slice 09.

## Out of scope

- Any web change: routes, screens, dialogs, pickers, `navigation.ts` cadastros entries, `types.ts`. That is slice 09.
- Dropping `is_seller` / `is_finder` / `is_collaborator`. A later contract slice, after 09 lands.
- Adding a Hub `account_id` / `user_id` to `sales_ops_people`, and any per-user scoping of "Meus dados". No linkage exists today and the panels are org-wide by construction; introducing one here would silently change what a seller sees. **Flag to the human as a follow-up:** "Meus dados" currently shows every seller/finder in the org rather than only the signed-in person, and closing that gap needs a pessoa-to-Hub-account link plus a `userId` filter in the service layer - a slice of its own.
- The affiliate/referral domain: `sellers`, `finders`, `referral_links`, `clicks`, `conversions`, `commissions`, `payouts`, and every route under `domains/sellers`, `domains/finders`, `domains/finder`, `domains/links`, `domains/referrals`, `domains/conversions`, `domains/commissions`, `domains/payouts`.
- Binding `salesOpsSaleProfessionals.role` (free text) to a `funcaoId`, and replacing `sales_ops_products.providers` jsonb with per-função cost defaults. Slices 07 and 12.
- Any change to the propostas status machine, payables/receivables materialization, or the `"N/M"` / `"MN/M"` receivable label conventions. Batch scope limit.
- Any change to `getVisibleWorkspaces`, `AppRole`, or `getRolesFromHubClaims`. Hub roles stay the authority for workspace visibility; funções are org data. Batch scope limit.
- A DELETE verb anywhere in `salesOpsRouter`.
- i18n extraction. New pt-BR strings ("Vendedor", "Finder", "Prestador") are seeded as literals in the migration, matching how `0010` seeds the six áreas.

## Risks

- **Atomicity of schema + migration + API in one commit.** Assessed and accepted: the slice is expand-only, so nothing existing breaks mid-commit and there is no ordering hazard between the DDL and the code. This lands as one commit. *Contingency only if the Verify agent times out:* split into `05a-funcoes-schema-migration` (steps 1-4 plus red test files 2 and the migration assertions of 3; oracle `pnpm --filter @fxl-sales/api test:integration`) and `05b-funcoes-api` (steps 5-15 plus red test files 1, 4 and the schema assertions of 3; `05b` `depends_on: [05a]`). Slices 09 and 12 would then depend on `05b`. Do not pre-emptively split - the split costs a second Verify cycle for no correctness gain.
- **A missing RLS policy silently false-passes.** Avoided by test 1's scoped `NOSUPERUSER NOBYPASSRLS` probe role, which is the only construction that actually exercises the policies (the local dev `postgres` superuser bypasses even `FORCE ROW LEVEL SECURITY`), plus test 3's file-content assertion that both tables get `ENABLE` + `FORCE` + both policies.
- **Cross-org assignment through a plain single-column FK.** A foreign key does not consult the RLS predicate, so `person_id uuid references sales_ops_people(id)` alone would let org A assign org B's função if a service filter were ever forgotten. Avoided by the two composite `(org_id, <fk>)` foreign keys, and pinned by the "rejected by the composite foreign key even in the admin context" test.
- **The derived boolean mirrors drifting from the join table.** Avoided by funnelling every write through the two person handlers (no assignment sub-resource endpoints, no direct boolean write path) and recomputing all three mirrors inside the same transaction as the assignment replace.
- **The backfill missing an org.** `0010` seeded from `sales_ops_settings` alone, but that table can legitimately have no row for an org (`getSettings` returns `null`). Avoided by unioning `sales_ops_people`, `sales_ops_settings`, and `sales_ops_sales`, and pinned by the per-org seed test.
- **The backfill running twice** (re-applied migration, or the test replaying the shipped SQL). Avoided by `ON CONFLICT ... DO NOTHING` on every seed and backfill INSERT, and pinned by the explicit idempotency test.
- **`prestador` being mistaken for a predefined app role.** Avoided by seeding it with `is_system = false` and by the `sales_ops_funcoes_system_slug_check` constraint, which makes `vendedor` and `finder` the only slugs that can ever be flagged system.
- **An org renaming its way into the reserved slugs.** Avoided by deriving the slug server-side, rejecting a derived `vendedor` / `finder` with `reserved_funcao_slug`, and the `(org_id, slug)` unique index.
- **A pessoa referenced by a proposta being deleted.** Structurally impossible: `salesOpsRouter` has no DELETE verb and this slice adds none; `status: 'inactive'` is the soft delete and pickers already filter on it. Pinned by the "has no DELETE route" test.
- **Root `pnpm test` not covering the migration.** Root `pnpm test` runs the unit project only (`vitest.config.ts:35-41`), so a broken migration would pass it. Avoided by putting the file-content and journal assertions in the **unit** contract test (test 3) as well as the DB replay in the integration test (test 2), so both gates catch it.
- **The integration suite silently hitting staging.** `apps/api/.env` points `DATABASE_URL` at staging in this repo. Avoided by `apps/api/test/rls/setup-env.ts:21`, which hard-overrides `DATABASE_URL` from `TEST_DATABASE_URL`. Do not weaken that override, and do not add a new test file that reads `DATABASE_URL` before `setupFiles` runs.
