---
id: 01-pkg-and-transport-ddl
milestone: v4.1.0
status: todo
depends_on: []
files_modified: [apps/api/package.json, packages/auth-fake/package.json, pnpm-lock.yaml, apps/api/drizzle/0025_integration_transport.sql, apps/api/drizzle/meta/_journal.json, apps/api/drizzle/meta/0025_snapshot.json, apps/api/src/db/schema.ts, apps/api/test/rls/integration-transport-schema.test.ts, scripts/__tests__/fxl-contracts-pin.test.mjs, package.json]
acceptance:
  - "apps/api/package.json lists `@fxl-business/fxl-contracts` at EXACT `0.1.0` (no caret/tilde) under `dependencies`; packages/auth-fake/package.json lists it at EXACT `0.1.0` under `dependencies`; both spellings are byte-for-byte the version string, mirroring the `@fxl-business/hub-sdk` `2.3.0` precedent."
  - "pnpm-lock.yaml is regenerated in the SAME change and resolves `@fxl-business/fxl-contracts@0.1.0` for both importers with no vendored copy anywhere in the repo; `pnpm install --frozen-lockfile` succeeds."
  - "A new ordinary migration `apps/api/drizzle/0025_integration_transport.sql` creates `integration_outbox`, `integration_outbox_position`, `integration_inbox`, `integration_cursor` with the exact columns/types/indexes of the package reference SQL, seeds the `integration_outbox_position` row id='default', and applies RLS (see RLS decision); it never touches 0024 or earlier."
  - "`apps/api/drizzle/meta/_journal.json` gains one entry idx 25, tag `0025_integration_transport`, with a `when` strictly greater than 0024's `1790217461336`; `apps/api/drizzle/meta/0025_snapshot.json` exists and matches the schema.ts tables."
  - "apps/api/src/db/schema.ts declares all four tables (drizzle `pgTable`) so `pnpm --filter @fxl-sales/api type-check` and `pnpm run build` stay green; the inbox composite PK is named `integration_inbox_pkey` and the cursor PK `integration_cursor_pkey`."
  - "Oracle `apps/api/test/rls/integration-transport-schema.test.ts` passes under `pnpm --filter @fxl-sales/api test:integration`: all four tables + expected columns + named indexes + the seed row exist, RLS is ENABLE+FORCE on the three org-scoped tables (both policies) and on the global counter (admin-only), and the org predicate isolates + WITH CHECK-refuses a smuggled org."
  - "Oracle `scripts/__tests__/fxl-contracts-pin.test.mjs` is wired into the root `pnpm test` `node --test` list and fails if either package.json drifts off the exact `0.1.0` pin."
  - "`pnpm run lint`, `pnpm run type-check`, `pnpm test`, `pnpm run build`, and `pnpm --filter @fxl-sales/api test:integration` are all green; the local-database-guard test and single-role-db-contract test still pass; `apps/api/src/db/migrate.ts` is unchanged."
---

# Slice 01 - Package pin + producer/consumer transport DDL

## Rationale

This slice is the foundation for the whole Sales<->Finance control-plane integration.
Every later slice (producer outbox, feed route, consumer puller, boot wiring, fake fixture) imports `@fxl-business/fxl-contracts` and writes/reads the four transport tables through the package's `SqlIntegrationAdapter` seam.
Nothing works until the package resolves at the exact pin and the tables exist with the shapes the package's helpers assume.

Three hard facts anchor the whole slice:

1. **The package reads no env and ships zero runtime/peer deps.**
   The Hub prompt (section 3) and the run's `package-surface.md` confirm it: installing it drags nothing in, so no `pnpm-workspace.yaml` override or catalog entry is needed (unlike `hono`, which is overridden precisely because two copies would otherwise resolve).
   The exact pin `"0.1.0"` is the only spelling that survives an unrelated `pnpm install`, and it is the same precedent already set by `@fxl-business/hub-sdk@2.3.0` (see `apps/api/package.json` line 20 and `pnpm-lock.yaml` line ~30: `specifier: 2.3.0`).

2. **The DDL is published in the package, not invented here.**
   The reference is `@fxl-business/fxl-contracts@0.1.0` `schema/integration-transport.sql` (extracted for reading at the scratchpad path in `package-surface.md`).
   We transcribe it verbatim - column names, types, index names, the `integration_inbox_pkey` constraint name, the seed row - and only *add* the repo's RLS convention on top, exactly as `0024` added its RLS/triggers on top of drizzle-generated tables.

3. **0025 is free.**
   The journal (`apps/api/drizzle/meta/_journal.json`) ends at idx 24 / tag `0024_sales_ops_settlements`; there is no `0025_snapshot.json` and no `0025_*.sql` on disk.
   A parked sibling planning run (`hub-sdk-25-switch-account-invites`, see the git log's "park paused" commit) once *planned* a 0025 for an unrelated feature, but it never reached code - so the `0025` migration number is unclaimed and this slice takes it.

Additive only: this slice creates new tables and one new migration, and does not alter `0024` or any earlier migration, does not touch `migrate.ts` behaviour, and keeps the local-database guard intact (no new guarded entrypoint is introduced).

## Gate G5 (stop condition, not work)

The package must already be **published to npm** (`@fxl-business/fxl-contracts@0.1.0`).
The run's `00-OVERVIEW.md` Passo 0 records it as published, but if `pnpm install` in step 1 fails with a 404, the correct response per Hub prompt section 3 is to **STOP and report that G5 is unmet** - never vendor or copy the package into this repo.

---

## Step-by-step edits

### Step 1 - Pin the package in both importers

**File: `apps/api/package.json`** - add one line to `dependencies`, alphabetical order puts it right after `@fxl-business/hub-sdk`:

```jsonc
"dependencies": {
  "@fxl-business/fxl-contracts": "0.1.0",
  "@fxl-business/hub-sdk": "2.3.0",
  ...
}
```

Exact string `"0.1.0"` - no `^`, no `~`. This is the runtime barrel used by the producer/consumer/feed/heartbeat helpers in later slices (Hub prompt section 3).

**File: `packages/auth-fake/package.json`** - this package is dev-only (consumed from source, declared by consumers as a devDependency) and its dev code will import `@fxl-business/fxl-contracts/testing` (`createFakeIntegrationAuthority`, `FIXTURE_INTEGRATED_ORGANIZATION_ID`) in slice 06.
Add a `dependencies` block (it currently has only `devDependencies`) so the `/testing` subpath resolves when auth-fake runs:

```jsonc
{
  "name": "@fxl-business/auth-fake"...  // keep existing fields
  "dependencies": {
    "@fxl-business/fxl-contracts": "0.1.0"
  },
  "devDependencies": {
    "typescript": "^5.7.3",
    "vitest": "^3.2.7"
  }
}
```

Same exact `"0.1.0"`. Nothing here ships to production: auth-fake is only ever installed as a devDependency of apps/api, and the `/testing` subpath is separate from the root barrel by design (Hub prompt section 8), which `scripts/assert-web-bundle-clean.mjs` (unchanged) keeps out of the web build.

**Do NOT** add anything to `pnpm-workspace.yaml` - no override, no catalog. The package has zero runtime/peer deps so there is no second-copy hazard to override, and this repo uses no pnpm catalog (the workspace file has only `packages:`, `allowBuilds:`, `overrides:`). State this explicitly in the commit body.

### Step 2 - Regenerate the lockfile in the same change

Run `pnpm install` from the repo root. This resolves `@fxl-business/fxl-contracts@0.1.0` for both importers and rewrites `pnpm-lock.yaml`. Commit the lockfile in this slice.
Verify with `pnpm install --frozen-lockfile` (must succeed with no diff) and confirm the lockfile now contains `@fxl-business/fxl-contracts@0.1.0` blocks under both `apps/api:` (line ~29) and `packages/auth-fake:` (line ~252) importer sections, mirroring the existing hub-sdk entries.

### Step 3 - Declare the four tables in `apps/api/src/db/schema.ts`

Add `bigint` and `primaryKey` to the `drizzle-orm/pg-core` import (the current import list at lines 24-39 has neither).
Append the four tables at the end of the file (after `hubBffLoginTxns`, line 1362), with a header comment matching the file's style. Positions are a monotonic counter well inside the JS safe-integer range and are read/written through the package's raw-SQL adapter, so `mode: 'number'` is used for ergonomics; the drizzle declaration exists so the ORM and `type-check` know the tables and so `db:generate` produces a coherent snapshot, not because app code queries them through the ORM.

```ts
// ─────────────────────────────────────────────────────────────────────────────
// Integration transport (Sales <-> Finance control plane, migration 0025).
//
// DDL transcribed VERBATIM from @fxl-business/fxl-contracts@0.1.0
// schema/integration-transport.sql; do not invent columns. The three org-scoped
// tables carry ENABLE+FORCE RLS with the sales_ops two-policy convention; the
// global integration_outbox_position counter carries the admin-context policy
// only (the hub_bff_* precedent). RLS lives in the .sql migration, never here,
// exactly as every other tenant table in this schema. `position` is born NULL on
// the outbox on purpose (see the migration header and the package's note).
// ─────────────────────────────────────────────────────────────────────────────
export const integrationOutbox = pgTable(
  'integration_outbox',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    eventName: text('event_name').notNull(),
    eventVersion: integer('event_version').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    payload: jsonb('payload').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    position: bigint('position', { mode: 'number' }),
    publishedAt: timestamp('published_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('integration_outbox_idempotency_key_uq').on(t.organizationId, t.idempotencyKey),
    index('integration_outbox_pending_idx')
      .on(t.occurredAt, t.id)
      .where(sql`${t.position} is null`),
    uniqueIndex('integration_outbox_position_uq')
      .on(t.position)
      .where(sql`${t.position} is not null`),
    index('integration_outbox_feed_idx')
      .on(t.organizationId, t.position)
      .where(sql`${t.position} is not null`),
  ],
);

export const integrationOutboxPosition = pgTable('integration_outbox_position', {
  id: text('id').primaryKey(),
  lastPosition: bigint('last_position', { mode: 'number' }).notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const integrationInbox = pgTable(
  'integration_inbox',
  {
    producerApplicationId: text('producer_application_id').notNull(),
    organizationId: text('organization_id').notNull(),
    idempotencyKey: text('idempotency_key').notNull(),
    eventName: text('event_name').notNull(),
    eventVersion: integer('event_version').notNull(),
    position: bigint('position', { mode: 'number' }).notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    appliedAt: timestamp('applied_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({
      name: 'integration_inbox_pkey',
      columns: [t.producerApplicationId, t.organizationId, t.idempotencyKey],
    }),
  ],
);

export const integrationCursor = pgTable(
  'integration_cursor',
  {
    producerApplicationId: text('producer_application_id').notNull(),
    organizationId: text('organization_id').notNull(),
    position: bigint('position', { mode: 'number' }).notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({
      name: 'integration_cursor_pkey',
      columns: [t.producerApplicationId, t.organizationId],
    }),
  ],
);
```

The `integration_inbox_pkey` name is **load-bearing**: the package applies events with `INSERT ... ON CONFLICT ON CONSTRAINT integration_inbox_pkey DO NOTHING` (reference SQL, CONSUMER SIDE comment). Do not let drizzle auto-name it.

### Step 4 - Generate the migration + snapshot, then hand-finish the SQL

Run `pnpm --filter @fxl-sales/api db:generate` (drizzle-kit; offline, no DB needed).
It reads the edited `schema.ts`, emits a new `apps/api/drizzle/00XX_<random>.sql` with the four `CREATE TABLE` + index statements, writes `apps/api/drizzle/meta/0025_snapshot.json`, and appends a journal entry.
Then:

1. **Rename** the generated `.sql` to `apps/api/drizzle/0025_integration_transport.sql` and set the journal entry's `tag` to `0025_integration_transport` (idx 25, `when` = the generated `Date.now()`, which is > 0024's `1790217461336`; keep `version: "7"`, `breakpoints: true`). The snapshot filename is numbered by idx, so it is already `0025_snapshot.json` - leave it.
2. **Verify** the generated CREATE/index statements match the reference SQL column-for-column (types, nullability, defaults, partial-index predicates, the `integration_inbox_pkey` / `integration_cursor_pkey` names). Drizzle emits plain `CREATE TABLE` (no `IF NOT EXISTS`), matching the 0024/0016 house style; that is expected - do not re-add `IF NOT EXISTS`.
3. **Hand-append** the seed row and the RLS block (drizzle-kit generates neither), so the final file body reads exactly:

```sql
-- 0025_integration_transport - producer outbox + publisher high-water mark and
-- consumer inbox + cursor for the Sales<->Finance control-plane integration.
--
-- DDL transcribed VERBATIM from @fxl-business/fxl-contracts@0.1.0
-- schema/integration-transport.sql (PRODUCER SIDE + CONSUMER SIDE). `position`
-- on integration_outbox is NULLABLE on purpose: it is assigned AFTER commit by a
-- single elected publisher, only to already-visible rows, so a bigserial (which
-- consumes its value at INSERT, not COMMIT) would reintroduce the skip-a-row bug
-- this table exists to close. Read the package's own note before "fixing" it.
--
-- TENANCY: the three org-scoped tables (outbox, inbox, cursor) are tenant data -
-- every row carries organization_id and a forgotten predicate would leak one
-- Organization's integration data to another. They get ENABLE + FORCE RLS with
-- the SAME two policies every sales_ops table carries (0008): a tenant_isolation
-- policy keyed on organization_id = current_setting('app.current_org_id') (the
-- producer enqueues inside the business withTenant transaction, which sets that
-- setting) and an admin_context policy keyed on app.fxl_admin (the position
-- publisher, the feed read and the consumer puller run cross-org through
-- getAdminDb). integration_outbox_position carries NO organization_id - it is a
-- single global counter row, exactly like hub_bff_* - so it gets ENABLE + FORCE
-- RLS with the admin_context policy ONLY (0016 precedent); the publisher touches
-- it through getAdminDb.
--
-- No privilege statement appears in this file (single-role database contract).
CREATE TABLE "integration_outbox" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"event_name" text NOT NULL,
	"event_version" integer NOT NULL,
	"idempotency_key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"position" bigint,
	"published_at" timestamp with time zone
);--> statement-breakpoint
CREATE UNIQUE INDEX "integration_outbox_idempotency_key_uq" ON "integration_outbox" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "integration_outbox_pending_idx" ON "integration_outbox" USING btree ("occurred_at","id") WHERE "integration_outbox"."position" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "integration_outbox_position_uq" ON "integration_outbox" USING btree ("position") WHERE "integration_outbox"."position" is not null;--> statement-breakpoint
CREATE INDEX "integration_outbox_feed_idx" ON "integration_outbox" USING btree ("organization_id","position") WHERE "integration_outbox"."position" is not null;--> statement-breakpoint
CREATE TABLE "integration_outbox_position" (
	"id" text PRIMARY KEY NOT NULL,
	"last_position" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "integration_inbox" (
	"producer_application_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"event_name" text NOT NULL,
	"event_version" integer NOT NULL,
	"position" bigint NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integration_inbox_pkey" PRIMARY KEY("producer_application_id","organization_id","idempotency_key")
);--> statement-breakpoint
CREATE TABLE "integration_cursor" (
	"producer_application_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"position" bigint DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integration_cursor_pkey" PRIMARY KEY("producer_application_id","organization_id")
);--> statement-breakpoint
ALTER TABLE integration_outbox ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE integration_outbox FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY integration_outbox_tenant_isolation ON integration_outbox
  AS PERMISSIVE FOR ALL
  USING (organization_id = current_setting('app.current_org_id', true))
  WITH CHECK (organization_id = current_setting('app.current_org_id', true));--> statement-breakpoint
CREATE POLICY integration_outbox_admin_context ON integration_outbox
  AS PERMISSIVE FOR ALL
  USING (current_setting('app.fxl_admin', true) = 'true')
  WITH CHECK (current_setting('app.fxl_admin', true) = 'true');--> statement-breakpoint
ALTER TABLE integration_inbox ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE integration_inbox FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY integration_inbox_tenant_isolation ON integration_inbox
  AS PERMISSIVE FOR ALL
  USING (organization_id = current_setting('app.current_org_id', true))
  WITH CHECK (organization_id = current_setting('app.current_org_id', true));--> statement-breakpoint
CREATE POLICY integration_inbox_admin_context ON integration_inbox
  AS PERMISSIVE FOR ALL
  USING (current_setting('app.fxl_admin', true) = 'true')
  WITH CHECK (current_setting('app.fxl_admin', true) = 'true');--> statement-breakpoint
ALTER TABLE integration_cursor ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE integration_cursor FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY integration_cursor_tenant_isolation ON integration_cursor
  AS PERMISSIVE FOR ALL
  USING (organization_id = current_setting('app.current_org_id', true))
  WITH CHECK (organization_id = current_setting('app.current_org_id', true));--> statement-breakpoint
CREATE POLICY integration_cursor_admin_context ON integration_cursor
  AS PERMISSIVE FOR ALL
  USING (current_setting('app.fxl_admin', true) = 'true')
  WITH CHECK (current_setting('app.fxl_admin', true) = 'true');--> statement-breakpoint
ALTER TABLE integration_outbox_position ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE integration_outbox_position FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY integration_outbox_position_admin_context ON integration_outbox_position
  AS PERMISSIVE FOR ALL
  USING (current_setting('app.fxl_admin', true) = 'true')
  WITH CHECK (current_setting('app.fxl_admin', true) = 'true');--> statement-breakpoint
SELECT set_config('app.fxl_admin', 'true', true);--> statement-breakpoint
INSERT INTO integration_outbox_position (id) VALUES ('default') ON CONFLICT (id) DO NOTHING;
```

Note the `SELECT set_config('app.fxl_admin', 'true', true)` immediately before the seed INSERT: `integration_outbox_position` is FORCE-RLS with an admin-only policy, and the whole migration runs in one transaction as the owner role with neither `app.current_org_id` nor `app.fxl_admin` set, so without this the seed INSERT would be refused by RLS. This is exactly the idiom `0024` uses before its backfill (`set_config('app.fxl_admin','true',true)` at 0024 line 150); `true` = transaction-local, so it does not leak.

Ordering matters only in that every table is created before its policies; the runner (`runOrdinaryMigration` in `migration-runner.ts`) executes all `--> statement-breakpoint` chunks in one transaction and then journals the file hash, so a single-transaction file is correct and needs no phased header.

### Step 5 - Oracle test A: transport schema (integration)

Create `apps/api/test/rls/integration-transport-schema.test.ts`, modelled on `settlements-schema.test.ts` (same `APP_DB_URL` / `ADMIN_DB_URL` / `ADMIN_CONNECTION_OPTIONS` setup, same non-superuser guard in `beforeAll`).
The journaled migration is applied to the test DB by `test/rls/global-setup.ts` before any test connects, so the tables already exist. It asserts:

1. **Tables + columns.** For each of the four tables, `information_schema.columns` returns the exact column set with the expected `data_type` / `is_nullable` (e.g. `integration_outbox.position` is `bigint` and `is_nullable = 'YES'`; `integration_inbox.position` is `NOT NULL`; `payload` is `jsonb`; every `*_at` is `timestamp with time zone`).
2. **Named indexes + PKs.** `pg_indexes` (or `pg_class`/`pg_index`) contains `integration_outbox_idempotency_key_uq`, `integration_outbox_pending_idx`, `integration_outbox_position_uq`, `integration_outbox_feed_idx`, and the constraints `integration_inbox_pkey` and `integration_cursor_pkey` exist by exact name (`pg_constraint.conname`).
3. **Seed row.** `SELECT id, last_position FROM integration_outbox_position` (admin client) returns exactly one row `{ id: 'default', last_position: 0 }`.
4. **RLS flags.** `pg_class.relrowsecurity AND relforcerowsecurity` is true for all four tables. `pg_policies` has 2 policies (`*_tenant_isolation`, `*_admin_context`) for each of outbox/inbox/cursor and exactly 1 (`integration_outbox_position_admin_context`) for `integration_outbox_position`.
5. **Behavioural isolation (outbox).** Under a tenant connection with `set_config('app.current_org_id', orgA, true)`, an INSERT into `integration_outbox` for `organization_id = orgA` succeeds and is visible; a SELECT under `orgB` returns 0 rows for orgA's data (positive control: orgA sees its own row); and a smuggled INSERT with `organization_id = orgA` while the session is `orgB` rejects with `42501` (WITH CHECK), exactly like the settlements oracle's smuggle case.
6. **NULL-position mechanics.** Two outbox rows inserted with `position = NULL` both persist (the `integration_outbox_position_uq` partial unique tolerates multiple NULLs); assigning the same non-null `position` to two rows (admin client) rejects with `23505` on `integration_outbox_position_uq`.
7. **Global counter is admin-gated.** From the tenant connection (no `app.fxl_admin`), `SELECT ... FROM integration_outbox_position` returns 0 rows and an UPDATE affects 0 rows / is refused; from the admin connection the seed row is visible.

Clean up any inserted rows in `afterAll` via the admin client (delete by the test org ids and by the synthetic outbox ids); the four tables have no immutability trigger, so ordinary DELETE works (no `settlement-test-cleanup` equivalent is needed).

### Step 6 - Oracle test B: exact-pin guard

Create `scripts/__tests__/fxl-contracts-pin.test.mjs` in the `node:test` style of the sibling guards (e.g. `no-legacy-env-names.test.mjs`). It reads `apps/api/package.json` and `packages/auth-fake/package.json` and asserts, for each, that the resolved `@fxl-business/fxl-contracts` specifier is **exactly** the string `0.1.0` - failing if it is missing, if it carries a `^`/`~`/range, or if the two disagree. Assert too that no vendored copy exists (no `packages/fxl-contracts/` directory and no `node_modules`-independent copy tracked in git).

Wire it into the root `package.json` `test` script's `node --test` list (append `scripts/__tests__/fxl-contracts-pin.test.mjs`) so `pnpm test` actually runs it - a guard that is never invoked is a vacuous green.

---

## RLS decision (spelled out)

| Table | org column | RLS | Policies | Why |
|---|---|---|---|---|
| `integration_outbox` | `organization_id` | ENABLE + FORCE | `integration_outbox_tenant_isolation` (org = `app.current_org_id`) **and** `integration_outbox_admin_context` (`app.fxl_admin`) | Producer enqueues inside the business `withTenant` tx (tenant context, `setTenantContext` sets `app.current_org_id`); the position publisher and feed read run cross-org via `getAdminDb`. Both paths must pass RLS, so both policies - the sales_ops convention (0008). |
| `integration_inbox` | `organization_id` | ENABLE + FORCE | tenant_isolation + admin_context | Written by the consumer puller (cross-org, admin) and read/asserted per-org; give it both policies for defence-in-depth, identical to every sales_ops table. |
| `integration_cursor` | `organization_id` | ENABLE + FORCE | tenant_isolation + admin_context | Same as inbox: puller advances it under `SELECT ... FOR UPDATE SKIP LOCKED`; both policies. |
| `integration_outbox_position` | (none - global) | ENABLE + FORCE | `integration_outbox_position_admin_context` (`app.fxl_admin`) **only** | A single global counter row `id='default'`, no `organization_id` to key a tenant policy on. Mirrors the `hub_bff_*` global tables (0016): FORCE RLS, admin-context policy only, touched exclusively through `getAdminDb` (here, by the position publisher). |

This satisfies the `single-role-db-contract` test (`FORCE ROW LEVEL SECURITY` and `app.fxl_admin` both appear; no `CREATE/ALTER ROLE`, no `BYPASSRLS`, no `GRANT ... TO fxl_sales_*`).
The package's reference SQL comment offers RLS as optional ("if the application connects as a role that is not the table owner"); this repo's single owner role is FORCE-RLS'd, so RLS is mandatory here and we adopt the repo's own two-policy / admin-only split rather than the package's illustrative snippet.

Note the policy predicate references `organization_id` (the transport tables' column), not `org_id` (the sales_ops column name); the comparison value stays `current_setting('app.current_org_id')`.

## What this slice does NOT do

- No adapter, config, event builder, feed route, puller, publisher, heartbeat, or boot wiring (slices 02-08).
- No emission call sites (slice 07).
- No fake fixture org or `createFakeIntegrationAuthority` wiring (slice 06) - only the auth-fake *dependency* pin lands here.
- No change to `migrate.ts`, `local-database-guard.ts`, or any guarded entrypoint; no new guarded entrypoint is added.
- No `pnpm-workspace.yaml` change (confirmed: no override/catalog needed).

## Verification (slice-local)

```bash
pnpm install --frozen-lockfile
pnpm --filter @fxl-sales/api type-check
pnpm run lint
pnpm --filter @fxl-sales/api test:integration   # runs the transport-schema oracle
node --test scripts/__tests__/fxl-contracts-pin.test.mjs
pnpm run build
```

Locked oracles for this slice: `apps/api/test/rls/integration-transport-schema.test.ts` and `scripts/__tests__/fxl-contracts-pin.test.mjs`, plus the pre-existing `apps/api/src/db/__tests__/single-role-db-contract.test.ts` (must stay green) and `scripts/__tests__/local-database-guard.test.mjs`.
