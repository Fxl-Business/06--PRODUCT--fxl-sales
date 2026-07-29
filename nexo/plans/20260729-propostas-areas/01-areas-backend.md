---
id: 01-areas-backend
milestone: v2.3.0
status: done
depends_on: []
files_modified: [apps/api/src/db/schema.ts, apps/api/drizzle/0010_sales_ops_areas.sql, apps/api/drizzle/meta/_journal.json, apps/api/drizzle/meta/0010_snapshot.json, apps/api/src/domains/sales-ops/service.ts, apps/api/src/domains/sales-ops/routes.ts, apps/api/src/domains/sales-ops/__tests__/areas-contract.test.ts, apps/api/src/domains/sales-ops/__tests__/routes.test.ts, apps/api/src/domains/sales-ops/__tests__/product-commission-contract.test.ts, apps/api/test/rls/areas-rls.test.ts, apps/api/test/rls/product-commission-contract.test.ts]
acceptance: "Given a migrated database with RLS enforced, when org A creates an area via POST /api/v1/sales-ops/areas and then calls GET /api/v1/sales-ops/bootstrap, then the area appears in bootstrap.areas for org A only, org B reads zero rows from sales_ops_areas, and POST /products without a same-org areaId is rejected with 400."
---

# Slice 01 - areas-backend

API-only slice.
It adds the `sales_ops_areas` table with RLS and a six-area seed, adds `sales_ops_products.area_id`, adds area CRUD service functions and routes, requires `areaId` on product create, and adds `areas` to the bootstrap snapshot.
No web files change in this slice.

## Step 1 - Drizzle schema (`apps/api/src/db/schema.ts`)

Insert the new table directly above the existing `salesOpsProducts` definition (currently at line 449), inside the `sales_ops_*` section:

```ts
export const salesOpsAreas = pgTable(
  'sales_ops_areas',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: text('org_id').notNull(),
    name: text('name').notNull(),
    status: text('status').notNull().default('active'), // 'active' | 'archived'
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }),
  },
  (t) => [uniqueIndex('sales_ops_areas_org_name_idx').on(t.orgId, t.name)],
);
```

Then add one column to `salesOpsProducts`, immediately after the `codeSuffix` line:

```ts
    areaId: uuid('area_id').references(() => salesOpsAreas.id),
```

The column stays nullable at the database level on purpose.
Existing products are backfilled to NULL and the overview locks the required-on-save behavior at the API and dialog layers, not the DB layer.
Do not add any other index; areas are a per-org handful of rows.

## Step 2 - Migration (`apps/api/drizzle/0010_sales_ops_areas.sql`)

Run the generator from the repo root:

```bash
pnpm --filter @fxl-sales/api db:generate
```

The journal's last entry is idx 9 (`0009_product_commission_scenarios`), so drizzle-kit will emit `0010_<random_name>.sql` plus `meta/0010_snapshot.json` and a new `meta/_journal.json` entry.
Rename the generated SQL file to `apps/api/drizzle/0010_sales_ops_areas.sql` and edit the new journal entry's `tag` to `"0010_sales_ops_areas"` (keep the generated `when` and `idx: 10`; do not touch the snapshot file name, which is keyed by idx).

The generated body must match this shape (verify, do not blindly trust):

```sql
CREATE TABLE "sales_ops_areas" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "sales_ops_products" ADD COLUMN "area_id" uuid;--> statement-breakpoint
ALTER TABLE "sales_ops_products" ADD CONSTRAINT "sales_ops_products_area_id_sales_ops_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."sales_ops_areas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sales_ops_areas_org_name_idx" ON "sales_ops_areas" USING btree ("org_id","name");
```

Then hand-append this exact block to the end of the file (RLS pattern copied from `apps/api/drizzle/0007_marvelous_valeria_richards.sql:163-172`, seed pattern from migration 0009):

```sql
--> statement-breakpoint
ALTER TABLE sales_ops_areas ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE sales_ops_areas FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY sales_ops_areas_tenant_isolation ON sales_ops_areas
  AS PERMISSIVE FOR ALL
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));--> statement-breakpoint
CREATE POLICY sales_ops_areas_admin_context ON sales_ops_areas
  AS PERMISSIVE FOR ALL
  USING (current_setting('app.fxl_admin', true) = 'true')
  WITH CHECK (current_setting('app.fxl_admin', true) = 'true');--> statement-breakpoint
SELECT set_config('app.fxl_admin', 'true', true);--> statement-breakpoint
INSERT INTO "sales_ops_areas" ("org_id", "name")
SELECT s."org_id", a."name"
FROM "sales_ops_settings" s
CROSS JOIN (VALUES ('FXL Tech'), ('FXL Visual'), ('FXL Advisor'), ('FXL BPO Sales'), ('FXL Influência Estratégica'), ('FXL Treinamentos')) AS a("name")
ON CONFLICT ("org_id", "name") DO NOTHING;
```

Notes that the executor must not second-guess:
The seed runs after FORCE RLS, so the transaction-local `set_config('app.fxl_admin', 'true', true)` is mandatory for both the `sales_ops_settings` read and the insert (the drizzle migrator runs each migration inside one transaction).
`ON CONFLICT ("org_id", "name")` infers the unique index and makes the migration re-runnable against partially seeded data.
No product backfill statement: existing products keep `area_id` NULL by design.

## Step 3 - Service (`apps/api/src/domains/sales-ops/service.ts`)

Add `ne` to the existing `drizzle-orm` import and `salesOpsAreas` to the schema import.

Add the Zod schemas next to `ClientSchema`:

```ts
export const AreaSchema = z.object({
  name: z.string().trim().min(1).max(120),
  status: z.enum(['active', 'archived']).default('active'),
});
export const UpdateAreaSchema = AreaSchema.partial();
export type AreaInput = z.infer<typeof AreaSchema>;
```

Change `ProductSchema`: add this line immediately after `codeSuffix`:

```ts
  areaId: uuid,
```

`areaId` is required on create; `ProductSchema.partial()` in the PATCH route keeps it optional there, and it is deliberately not nullable, so an area can never be unset through the API.
No change to `createProduct`/`updateProduct` bodies is needed: the `...data`/`...rest` spreads already carry `areaId` into the new column.

Add the CRUD functions after `updateClient`, following the exact `withTenant` + `eq(table.orgId, orgId)` double-guard used by every sibling:

```ts
export async function listAreas(db: Db, orgId: string) {
  return withTenant(db, orgId, (tx) =>
    tx
      .select()
      .from(salesOpsAreas)
      .where(eq(salesOpsAreas.orgId, orgId))
      .orderBy(salesOpsAreas.name),
  );
}

export async function getArea(db: Db, orgId: string, id: string) {
  return withTenant(db, orgId, async (tx) => {
    const [area] = await tx
      .select()
      .from(salesOpsAreas)
      .where(and(eq(salesOpsAreas.orgId, orgId), eq(salesOpsAreas.id, id)))
      .limit(1);
    return area ?? null;
  });
}

export async function createArea(db: Db, orgId: string, data: AreaInput) {
  return withTenant(db, orgId, async (tx) => {
    const [existing] = await tx
      .select({ id: salesOpsAreas.id })
      .from(salesOpsAreas)
      .where(and(eq(salesOpsAreas.orgId, orgId), eq(salesOpsAreas.name, data.name)))
      .limit(1);
    if (existing) return 'duplicate' as const;
    const [area] = await tx.insert(salesOpsAreas).values({ ...data, orgId }).returning();
    return area!;
  });
}

export async function updateArea(db: Db, orgId: string, id: string, data: Partial<AreaInput>) {
  return withTenant(db, orgId, async (tx) => {
    if (data.name !== undefined) {
      const [existing] = await tx
        .select({ id: salesOpsAreas.id })
        .from(salesOpsAreas)
        .where(
          and(
            eq(salesOpsAreas.orgId, orgId),
            eq(salesOpsAreas.name, data.name),
            ne(salesOpsAreas.id, id),
          ),
        )
        .limit(1);
      if (existing) return 'duplicate' as const;
    }
    const [area] = await tx
      .update(salesOpsAreas)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(salesOpsAreas.orgId, orgId), eq(salesOpsAreas.id, id)))
      .returning();
    return area ?? null;
  });
}
```

The duplicate pre-check is the locked design for name conflicts: it returns the `'duplicate'` sentinel so routes can answer 409 deterministically, and the unique index remains the backstop for the residual race (which then surfaces as a 500, acceptable).

Extend `getSalesOpsSnapshot` (currently at line 642): add this query after the `settings` query, and add `areas` to the returned object so the bootstrap payload becomes `{ sales, products, clients, people, payables, saleItems, areas, settings }`:

```ts
    const areas = await tx
      .select()
      .from(salesOpsAreas)
      .where(eq(salesOpsAreas.orgId, orgId))
      .orderBy(salesOpsAreas.name);
```

Do not add `areas` to the `SalesOpsSnapshot` type or to `summarizeSalesOpsState`; the summary math does not use areas in this feature.

## Step 4 - Routes (`apps/api/src/domains/sales-ops/routes.ts`)

Import `AreaSchema`, `UpdateAreaSchema`, `createArea`, `getArea`, `listAreas`, `updateArea` from `./service.js`.

Add the three area routes after the client routes, keeping the safeParse + envelope pattern:

```ts
salesOpsRouter.get('/areas', async (c) => {
  const areas = await listAreas(getDb(), c.get('orgId'));
  return c.json({ areas });
});

salesOpsRouter.post('/areas', async (c) => {
  const parsed = AreaSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: 'validation_error', issues: parsed.error.flatten() }, 400);
  }
  const area = await createArea(getDb(), c.get('orgId'), parsed.data);
  if (area === 'duplicate') return c.json({ error: 'conflict', reason: 'area_name_taken' }, 409);
  return c.json({ area }, 201);
});

salesOpsRouter.patch('/areas/:id', async (c) => {
  const parsed = UpdateAreaSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: 'validation_error', issues: parsed.error.flatten() }, 400);
  }
  const area = await updateArea(getDb(), c.get('orgId'), c.req.param('id'), parsed.data);
  if (area === 'duplicate') return c.json({ error: 'conflict', reason: 'area_name_taken' }, 409);
  if (!area) return c.json({ error: 'not_found' }, 404);
  return c.json({ area });
});
```

Locked decision: area routes do NOT use `requireAdmin`, matching the existing `/products` and `/clients` Cadastros routes (only `/people` is admin-gated because people grant roles); web-side admin gating stays a slice 05 concern.

Change `POST /products` to validate that the areaId belongs to the caller's org before creating (FK checks bypass RLS, so this route-level check is the cross-tenant guard):

```ts
salesOpsRouter.post('/products', async (c) => {
  const parsed = ProductSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return c.json({ error: 'validation_error', issues: parsed.error.flatten() }, 400);
  }
  const area = await getArea(getDb(), c.get('orgId'), parsed.data.areaId);
  if (!area) return c.json({ error: 'validation_error', reason: 'unknown_area' }, 400);
  const product = await createProduct(getDb(), c.get('orgId'), parsed.data);
  return c.json({ product }, 201);
});
```

Change `PATCH /products/:id` the same way, but only when the patch carries an areaId:

```ts
  if (parsed.data.areaId !== undefined) {
    const area = await getArea(getDb(), c.get('orgId'), parsed.data.areaId);
    if (!area) return c.json({ error: 'validation_error', reason: 'unknown_area' }, 400);
  }
```

Archived areas remain assignable at the API level (existence in the org is the only rule); filtering to active areas is a web concern for slice 05.

## Step 5 - Unit tests

### New file `apps/api/src/domains/sales-ops/__tests__/areas-contract.test.ts`

Model it on `product-commission-contract.test.ts` (Zod assertions plus migration source-grep with `readFileSync` on `drizzle/0010_sales_ops_areas.sql` resolved from `process.cwd()`).
Named tests:

- `'accepts a minimal area payload and defaults status to active'`: `AreaSchema.parse({ name: '  FXL Tech  ' })` yields `{ name: 'FXL Tech', status: 'active' }`.
- `'rejects an empty or blank area name'`: `AreaSchema.safeParse({ name: '' }).success` is false and `AreaSchema.safeParse({ name: '   ' }).success` is false.
- `'rejects unsupported area statuses'`: `AreaSchema.safeParse({ name: 'X', status: 'deleted' }).success` is false.
- `'requires areaId on product create payloads'`: `ProductSchema.safeParse(completeProductWithoutAreaId).success` is false and `ProductSchema.partial().safeParse({ name: 'x' }).success` is true (PATCH stays areaId-optional).
- `'seeds the six FXL areas behind the admin context after enabling forced RLS'`: grep the migration file for `ENABLE ROW LEVEL SECURITY`, `FORCE ROW LEVEL SECURITY`, both policy names `sales_ops_areas_tenant_isolation` and `sales_ops_areas_admin_context`, `SELECT set_config('app.fxl_admin', 'true', true)` occurring before the `INSERT INTO "sales_ops_areas"` index, all six seed names (`FXL Tech`, `FXL Visual`, `FXL Advisor`, `FXL BPO Sales`, `FXL Influência Estratégica`, `FXL Treinamentos`), `ON CONFLICT ("org_id", "name") DO NOTHING`, `ADD COLUMN "area_id" uuid`, and assert the file does NOT match `/set_config\('app\.fxl_admin',\s*'true',\s*false\)/i` and does NOT contain `NOT NULL` on the `area_id` column line.

### Extend `apps/api/src/domains/sales-ops/__tests__/routes.test.ts`

Add `listAreas`, `createArea`, `updateArea`, `getArea`, and `createProduct` to the hoisted `serviceMocks` and to the `vi.mock('../service.js', ...)` override.
Add a `describe('Sales Ops area routes', ...)` block with named tests:

- `'lists areas for the verified org'`: GET `/areas` returns 200 `{ areas: [areaResult] }` and `listAreas` was called with `(mockedDb, 'verified-org')`.
- `'creates an area with the verified org context and strips body org ids'`: POST `/areas` with `{ name: 'FXL Tech', status: 'active', orgId: 'body-org-must-not-be-used' }` returns 201 and `createArea` was called with `(mockedDb, 'verified-org', expect.not.objectContaining({ orgId: expect.anything() }))`.
- `'returns 409 when the area name already exists'`: `createArea` mock resolves `'duplicate'`, POST `/areas` returns 409 `{ error: 'conflict', reason: 'area_name_taken' }`.
- `'returns 404 when patching an unknown area'`: `updateArea` mock resolves `null`, PATCH `/areas/<uuid>` returns 404.
- `'rejects a blank area name before service execution'`: POST `/areas` with `{ name: '' }` returns 400 and `createArea` was not called.

Add a `describe('Sales Ops product area binding', ...)` block with named tests:

- `'rejects product creation when areaId is missing'`: POST `/products` with a valid product body minus `areaId` returns 400 and neither `getArea` nor `createProduct` was called.
- `'rejects product creation when the area is not in the verified org'`: `getArea` mock resolves `null`, POST `/products` with `areaId` set returns 400 `{ error: 'validation_error', reason: 'unknown_area' }` and `createProduct` was not called.
- `'creates a product when the area resolves in the verified org'`: `getArea` mock resolves an area row, POST `/products` returns 201 and `createProduct` received the parsed payload including `areaId`.

### Update `apps/api/src/domains/sales-ops/__tests__/product-commission-contract.test.ts`

Add `areaId: '33333333-3333-4333-8333-333333333333'` to `completeProduct` so the existing Zod assertions keep passing under the now-required field.
The 0009 migration-grep test is untouched.

`apps/api/src/domains/sales-ops/__tests__/service.test.ts` needs no change: `CreateSaleSchema` and `buildSaleLedger` are not touched by this slice (sale item areas arrive in slices 02 and 03).

## Step 6 - Integration tests (RLS harness)

### New file `apps/api/test/rls/areas-rls.test.ts`

Copy the harness shape of `apps/api/test/rls/product-commission-contract.test.ts` (drizzle over `postgres(APP_DB_URL)`, admin cleanup client with `{ connection: { 'app.fxl_admin': 'true' } }`, per-test unique `org_..._${Date.now()}` ids, `afterAll` deleting seeded rows by org via the admin client, deleting `sales_ops_products` before `sales_ops_areas` to respect the FK).
Named tests:

- `'area CRUD stays tenant-scoped through the service layer'`: `createArea(db, orgA, AreaSchema.parse({ name: 'FXL Tech' }))` returns a row with `status 'active'`; `listAreas(db, orgA)` returns exactly that row; `listAreas(db, orgB)` returns `[]`; `getArea(db, orgB, areaA.id)` returns `null`; `updateArea(db, orgB, areaA.id, { name: 'hijack' })` returns `null`; `updateArea(db, orgA, areaA.id, { status: 'archived' })` returns the row with `status 'archived'` and a non-null `updatedAt`.
- `'createArea reports duplicates per org but allows the same name in another org'`: a second `createArea(db, orgA, { name: 'FXL Tech', status: 'active' })` returns `'duplicate'` while `createArea(db, orgB, { name: 'FXL Tech', status: 'active' })` returns a row.
- `'raw RLS blocks cross-org reads and WITH CHECK blocks smuggled inserts'`: using a raw `postgres` client as in `cross-tenant.test.ts`, insert a row under `set_config('app.current_org_id', ORG_A, true)`, assert org A sees 1 row and org B sees 0 rows by primary key, and assert an insert claiming org B while set to org A rejects.
- `'getArea refuses to resolve another org area for product binding'`: create an area in org A, assert `getArea(db, orgB, areaA.id)` is `null` (this is the guard behind the 400 `unknown_area` route response, since FK validation bypasses RLS).

### Update `apps/api/test/rls/product-commission-contract.test.ts`

`ProductSchema.parse` now requires `areaId`, so in each of the two tests first create a real area with `createArea(db, orgId, AreaSchema.parse({ name: 'FXL Tech' }))` (import `AreaSchema` and `createArea` from the service) and pass `areaId: area.id` into the product payload.
Extend the first test's `expect.objectContaining` in the list assertion with `areaId: created.areaId`.
Extend `afterAll` cleanup with `await adminClient\`DELETE FROM sales_ops_areas WHERE org_id = ${orgId}\`` after the products delete.

## Oracle tests

- `apps/api/test/rls/areas-rls.test.ts` > `'area CRUD stays tenant-scoped through the service layer'` and `'raw RLS blocks cross-org reads and WITH CHECK blocks smuggled inserts'` (RLS isolation + tenancy CRUD).
- `apps/api/src/domains/sales-ops/__tests__/routes.test.ts` > `'rejects product creation when the area is not in the verified org'` and `'creates a product when the area resolves in the verified org'` (product areaId accept and require-on-create, together with `areas-contract.test.ts` > `'requires areaId on product create payloads'`).
- `apps/api/src/domains/sales-ops/__tests__/areas-contract.test.ts` > `'seeds the six FXL areas behind the admin context after enabling forced RLS'` (seed migration contract).
- Bootstrap coverage: extend `apps/api/test/rls/areas-rls.test.ts` with named test `'bootstrap snapshot includes the org areas'` calling `getSalesOpsSnapshot(db, orgA)` and asserting `snapshot.areas` equals the org A areas ordered by name while `getSalesOpsSnapshot(db, orgB).areas` is `[]`.

## Verification commands

```bash
pnpm run lint
pnpm run type-check
pnpm test
pnpm --filter @fxl-sales/api test:integration
```

The integration run applies migration 0010 through the existing `test/rls/global-setup.ts` migrator, which is the executable proof that the hand-appended RLS and seed SQL parses and runs inside one transaction.

## Out of scope (later slices)

Sale item `area_id`/`area_name_snapshot` (slice 02), CreateSale v2 payload (slice 03), any web change including the Cadastros areas page and product dialog area select (slice 05), and removal of the product `type` column (the column stays; only its UI dies in slice 05).
