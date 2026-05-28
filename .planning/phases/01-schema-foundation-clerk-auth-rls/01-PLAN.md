# Phase 01 — Schema foundation + Clerk auth + RLS

**Milestone:** v1.0 — FXL Finders MVP
**Status:** ⏳ pending
**Wave:** W1 (foundational — phases 02 + 03 both depend on this)
**Mode:** backend-only (no UI, no /gsd-ui-phase)

## Scope

Deliver the 9 foundation Drizzle tables, real Clerk JWT middleware (`clerkAuthMiddleware` with role extraction), three DB roles (`fxl_finders_owner` owner / `fxl_finders_app` runtime / `fxl_finders_admin` BYPASSRLS), RLS policies applied via the journaled migration, the `getDb()`/`getAdminDb()` connection getters, the `clerkClient` singleton, and a cross-tenant CI test harness that connects as the unprivileged app role. No data population; tables ship empty. Phases 02 and 03 can proceed in parallel once this phase is committed.

**Task count:** 17 (T01–T15 plus inserted T09b and T11b). T09b (admin BYPASSRLS connection, D-C) depends on T09; T11b (`clerkClient` singleton, D-I) is independent.

**Tables in this phase:** `finders`, `sellers`, `apps`, `products`, `price_bands`, `commission_rules`, `audit_log`, `webhook_events`, `leads`

**Tables deferred to their owning phase:** `referral_links` (04), `clicks` (04), `conversions` (05), `commissions` (05), `payouts` (05)

---

## Context sources (read before executing any task)

1. `.planning/plan-brief.md` — cascading decisions + schema/RLS conventions
2. `docs/superpowers/specs/2026-05-28-fxl-finders-v1-design.md` — canonical spec (§ 4 data model, § 5 auth, § 9 security checklist)
3. `.planning/ROADMAP.md` — phase list and dependencies
4. `CLAUDE.md` — FXL contract (non-negotiable)

---

## Tasks

### T01 · Install missing dev dependencies for test harness

**File(s):** `apps/api/package.json`, root `package.json`
**What:** Add `pg-tap` vitest-compatible wrapper **or** use raw `postgres` client in vitest for integration tests. Autopilot decision: use vitest + `postgres` (already in deps) for the cross-tenant test harness — no pgTAP wrapper needed, keeping the toolchain uniform. Also add `@types/pg` if needed. Docker Postgres already defined in `docker-compose.yml` on port 5006.

**Autopilot decision logged:** pgTAP requires a separate Postgres extension (`CREATE EXTENSION pgtap`) that adds Docker build complexity. Vitest integration tests calling raw SQL via the `postgres` npm package (already in `deps`) against the same Docker Postgres instance is simpler, faster in CI, and uses the same toolchain as the rest of the project. Choice: **vitest + postgres client for RLS integration tests**.

**Dev-vs-staging role split (NIT, plan-brief D-R / Phase 0 RLS plan):** the runtime `DATABASE_URL` SHOULD target the `fxl_finders_app` role (no `BYPASSRLS`, not table owner) so RLS is actually enforced at runtime. Migrations run as the OWNER role (`fxl_finders_owner`). On a fresh local Docker Postgres these may both collapse to `postgres` initially, but staging/prod MUST separate them. Document this split as a handoff item (see T14) and a comment in `.env.dev.example` (see T14). The admin connection (`ADMIN_DATABASE_URL`, role `fxl_finders_admin`, `BYPASSRLS`) is added in new task T09b (per D-C).

**Acceptance criteria:**
- [ ] `pnpm install` succeeds
- [ ] `apps/api/src/db/schema.ts` import from `drizzle-orm/pg-core` resolves without error (`pnpm type-check`)
- [ ] Handoff note records that runtime `DATABASE_URL` targets `fxl_finders_app` and migrations use `fxl_finders_owner` (dev may collapse to `postgres`; staging/prod must split)

---

### T02 · Drizzle schema — `finders` table

**File(s):** `apps/api/src/db/schema.ts`
**What:** Define `finders` table. Tenant-scoped by `org_id`.

**Schema:**
```typescript
export const finders = pgTable('finders', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: text('org_id').notNull(),               // finder's Clerk org_id ('' placeholder pre-approval — NOT NULL satisfied by empty string)
  clerkUserId: text('clerk_user_id').notNull().unique(),
  clerkOrgId: text('clerk_org_id').notNull().unique(),
  status: text('status').notNull(),               // 'pending' | 'approved' | 'suspended'
  displayName: text('display_name').notNull(),
  contactEmail: text('contact_email').notNull(),
  cpf: text('cpf'),
  phone: text('phone'),
  pixKey: text('pix_key'),
  pixKeyType: text('pix_key_type'),               // 'cpf' | 'email' | 'phone' | 'random'
  payoutAddress: jsonb('payout_address'),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  approvedByUserId: text('approved_by_user_id'),  // admin Clerk user_id
  suspendedAt: timestamp('suspended_at', { withTimezone: true }),
  suspendedReason: text('suspended_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }),
}, (t) => [
  // NIT (plan-brief D-R): composite index LEADING on org_id for RLS-filtered tenant reads.
  index('finders_org_id_idx').on(t.orgId, t.status),
]);
```

**Autopilot decision logged:** `updated_at` is a plain nullable `timestamptz` column (no DB trigger in Phase 01). Drizzle does not auto-set `updatedAt` at the DB level without a trigger; the service layer will pass `new Date()` on every update. A DB trigger can be added in a follow-up migration if desired. This keeps Phase 01 migration simple.

**Cross-phase note (plan-brief cross-phase rule #5):** LGPD consent columns are OWNED by Phase 03 T01 and MUST NOT be added here. Phase 01 ships `finders` WITHOUT consent columns.

**Acceptance criteria:**
- [ ] Table exported from `schema.ts`
- [ ] `org_id text NOT NULL` present (RLS hook); `''` empty-string placeholder is a valid pre-approval value (NOT NULL satisfied)
- [ ] All FK columns are `uuid` (consistent with spec § 4)
- [ ] Composite index `finders_org_id_idx` LEADING on `org_id` present (per D-R NIT) — verify in generated migration SQL: `grep -i 'org_id' apps/api/drizzle/*.sql` shows the index
- [ ] No LGPD consent columns added (owned by Phase 03 T01)
- [ ] `index` imported from `drizzle-orm/pg-core`
- [ ] `pnpm type-check` passes

---

### T03 · Drizzle schema — `sellers` table

**File(s):** `apps/api/src/db/schema.ts`
**What:** Define `sellers` table. Cross-org (admin-managed), no `org_id`.

**Schema:**
```typescript
export const sellers = pgTable('sellers', {
  id: uuid('id').primaryKey().defaultRandom(),
  clerkUserId: text('clerk_user_id').notNull().unique(),
  displayName: text('display_name').notNull(),
  contactEmail: text('contact_email').notNull(),
  status: text('status').notNull(),               // 'active' | 'inactive'
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }),
});
```

**Note:** `sellers` is cross-org (FXL employees). No `org_id` column; no RLS policy. Runtime role `fxl_finders_app` SELECT access granted explicitly (see T09).

**Acceptance criteria:**
- [ ] Table exported from `schema.ts`
- [ ] No `org_id` column (cross-org entity; admin endpoints bypass RLS per CLAUDE.md)
- [ ] `pnpm type-check` passes

---

### T04 · Drizzle schema — `apps` table

**File(s):** `apps/api/src/db/schema.ts`
**What:** Define `apps` table. Global registry (no `org_id` — admin-managed).

**Schema:**
```typescript
export const apps = pgTable('apps', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull().unique(),
  name: text('name').notNull(),
  publishableKey: text('publishable_key').notNull().unique(),
  secretKeyHash: text('secret_key_hash').notNull(),
  secretKeyPrefix: text('secret_key_prefix').notNull(),
  webhookSigningSecret: text('webhook_signing_secret').notNull(),
  allowedRedirectHosts: text('allowed_redirect_hosts').array().notNull(),
  attributionWindowDays: integer('attribution_window_days').notNull().default(30),
  commissionHoldDays: integer('commission_hold_days').notNull().default(30),
  status: text('status').notNull(),               // 'active' | 'disabled'
  createdByUserId: text('created_by_user_id').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }),
});
```

**Note:** `apps` is global admin-managed. No `org_id`; no per-tenant RLS. Admin role reads all rows.

**Acceptance criteria:**
- [ ] `allowedRedirectHosts` is `text[]` (Drizzle: `.array()`)
- [ ] `attributionWindowDays` and `commissionHoldDays` are `integer` (not `numeric`)
- [ ] `pnpm type-check` passes

---

### T05 · Drizzle schema — `products` + `price_bands` + `commission_rules` tables

**File(s):** `apps/api/src/db/schema.ts`
**What:** Define three related tables. All global (no `org_id`).

**Schemas:**
```typescript
export const products = pgTable('products', {
  id: uuid('id').primaryKey().defaultRandom(),
  appId: uuid('app_id').notNull().references(() => apps.id),
  slug: text('slug').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  status: text('status').notNull(),               // 'active' | 'archived'
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }),
}, (t) => [uniqueIndex('products_app_id_slug_idx').on(t.appId, t.slug)]);

export const priceBands = pgTable('price_bands', {
  id: uuid('id').primaryKey().defaultRandom(),
  productId: uuid('product_id').notNull().references(() => products.id),
  component: text('component').notNull(),         // 'setup' | 'monthly'
  minBrl: integer('min_brl').notNull(),           // cents
  listBrl: integer('list_brl').notNull(),
  maxBrl: integer('max_brl').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }),
}, (t) => [
  uniqueIndex('price_bands_product_component_idx').on(t.productId, t.component),
  check('price_bands_order_check', sql`min_brl <= list_brl AND list_brl <= max_brl`),
]);

export const commissionRules = pgTable('commission_rules', {
  id: uuid('id').primaryKey().defaultRandom(),
  productId: uuid('product_id').notNull().references(() => products.id).unique(),
  setupRatePct: numeric('setup_rate_pct', { precision: 5, scale: 2 }).notNull(),
  recurringRatePct: numeric('recurring_rate_pct', { precision: 5, scale: 2 }).notNull(),
  recurringMonths: integer('recurring_months').notNull(),
  basis: text('basis').notNull().default('quoted_net'), // 'quoted_net' | 'list_net'
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }),
});
```

**Autopilot decision logged:** `setup_rate_pct` / `recurring_rate_pct` use `numeric(5,2)` per spec § 4. Money columns (`min_brl`, `list_brl`, `max_brl`) use `integer` (cents) per spec and plan-brief. The `CHECK` constraint is expressed via Drizzle's `check()` builder + `sql` tag — this requires importing `{ sql }` from `drizzle-orm`. The CHECK will be emitted in the migration SQL; Drizzle Kit handles it.

**Import note:** `schema.ts` now imports `{ sql }` from `drizzle-orm` (CHECK) and `{ index }` from `drizzle-orm/pg-core` (the `finders`/`leads` composite org_id indexes added in T02/T08), alongside `uniqueIndex`, `check`, and the column builders.

**Acceptance criteria:**
- [ ] All money columns are `integer` (cents) — no `numeric` or `float` for money
- [ ] `commission_rules.setup_rate_pct` is `numeric(5,2)` (rate, not money)
- [ ] `price_bands` CHECK constraint present in migration SQL
- [ ] `UNIQUE(product_id, component)` and `UNIQUE(app_id, slug)` present
- [ ] `pnpm type-check` passes

---

### T06 · Drizzle schema — `audit_log` table

**File(s):** `apps/api/src/db/schema.ts`
**What:** Define `audit_log`. Append-only, hash-chained, `bigserial` PK (not uuid).

**Schema:**
```typescript
export const auditLog = pgTable('audit_log', {
  id: bigserial('id', { mode: 'bigint' }).primaryKey(),
  ts: timestamp('ts', { withTimezone: true }).defaultNow().notNull(),
  actorUserId: text('actor_user_id').notNull(),   // Clerk user_id or 'system'
  actorOrgId: text('actor_org_id'),
  action: text('action').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  beforeJsonb: jsonb('before_jsonb'),
  afterJsonb: jsonb('after_jsonb'),
  requestId: text('request_id'),
  prevHash: text('prev_hash').notNull(),          // sha256 of prior row, '0'*64 for row 1
  entryHash: text('entry_hash').notNull(),        // sha256(prevHash || canonical_json(row))
});
```

**Note:** `audit_log` is append-only and cross-org. No `org_id`; no per-tenant RLS. Only `fxl_finders_app` INSERT + SELECT (admin). No UPDATE, no DELETE via runtime role.

**Acceptance criteria:**
- [ ] PK is `bigserial` (auto-increment for chain ordering)
- [ ] `prev_hash` and `entry_hash` are `text NOT NULL`
- [ ] No `updated_at` (append-only)
- [ ] `pnpm type-check` passes

---

### T07 · Drizzle schema — `webhook_events` table

**File(s):** `apps/api/src/db/schema.ts`
**What:** Define `webhook_events`. Idempotency + replay defense.

**Schema:**
```typescript
export const webhookEvents = pgTable('webhook_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  source: text('source').notNull(),
  eventId: text('event_id').notNull(),
  bodyHash: text('body_hash').notNull(),
  signatureValid: boolean('signature_valid').notNull(),
  processedAt: timestamp('processed_at', { withTimezone: true }),
  processingError: text('processing_error'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (t) => [uniqueIndex('webhook_events_source_event_id_idx').on(t.source, t.eventId)]);
```

**Acceptance criteria:**
- [ ] `UNIQUE(source, event_id)` index present
- [ ] No `org_id` (global — cross-org webhook log)
- [ ] `pnpm type-check` passes

---

### T08 · Drizzle schema — `leads` table

**File(s):** `apps/api/src/db/schema.ts`
**What:** Define `leads`. Ships in Phase 01 (LGPD design); populated later. Tenant-scoped via `org_id` (finder's org that owns the lead attribution).

**Schema:**
```typescript
export const leads = pgTable('leads', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: text('org_id').notNull(),               // finder's org_id for RLS
  clickId: text('click_id'),                     // soft FK to clicks(click_id) — clicks table Phase 04
  linkId: uuid('link_id'),                       // soft FK to referral_links(id) — Phase 04
  customerName: text('customer_name'),
  customerEmail: text('customer_email'),
  customerPhone: text('customer_phone'),
  customerCpf: text('customer_cpf'),
  status: text('status').notNull(),              // 'clicked' | 'lead' | 'converted' | 'churned'
  anonymizedAt: timestamp('anonymized_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }),
}, (t) => [
  // NIT (plan-brief D-R): composite index LEADING on org_id for RLS-filtered tenant reads.
  index('leads_org_id_idx').on(t.orgId, t.status),
]);
```

**Autopilot decision logged:** `leads.link_id` and `leads.click_id` are soft FKs in Phase 01 (no `references()` call) because `referral_links` and `clicks` tables will be added in Phase 04. Adding hard FK constraints in Phase 01 would create a forward dependency. The FK constraints will be added via a follow-up migration in Phase 04 when those tables exist.

**Acceptance criteria:**
- [ ] `org_id text NOT NULL` present (RLS policy will be applied in T10)
- [ ] No hard FKs to Phase 04 tables (`referral_links`, `clicks`) — soft FKs only
- [ ] LGPD fields: `customer_name`, `customer_email`, `customer_phone`, `customer_cpf` all nullable
- [ ] `anonymized_at` column present
- [ ] Composite index `leads_org_id_idx` LEADING on `org_id` present (per D-R NIT) — verify in generated migration SQL
- [ ] `pnpm type-check` passes

---

### T09 · Generate Drizzle migration + APPEND role grants INTO the journaled file

**File(s):** `apps/api/drizzle/` (generated output — the single journaled migration `.sql`)
**What:** Run `pnpm db:generate` to emit the SQL migration, then **append the DB role-creation + grant SQL directly INTO that generated, journaled migration file** (the same `.sql` registered in `apps/api/drizzle/meta/_journal.json`). Do NOT put roles/grants in a standalone unjournaled `.sql` — the Drizzle migrator (`tsx scripts/migrate.ts` → `pnpm db:migrate`) ONLY runs files listed in `_journal.json`, so standalone files are silently skipped (per D-F).

**Steps:**
1. Run `pnpm --filter @fxl-finders/api db:generate`
2. Open the generated `.sql` file in `apps/api/drizzle/` (the one referenced by the latest entry in `apps/api/drizzle/meta/_journal.json`)
3. Append the following AFTER all `CREATE TABLE` statements, INSIDE that same generated file (this keeps the SQL journaled). NOTE: the `fxl_finders_admin` BYPASSRLS role + `ADMIN_DATABASE_URL` plumbing is owned by T09b; create the role here, wire the connection there.

```sql
-- ============================================================================
-- DB role grants (Phase 01) — APPENDED INTO THE JOURNALED MIGRATION (D-F)
-- fxl_finders_owner  → table owner, runs migrations
-- fxl_finders_app    → runtime role, NO BYPASSRLS, NOT table owner (RLS enforced)
-- fxl_finders_admin  → BYPASSRLS admin/cross-tenant role (see T09b + D-C)
-- ============================================================================

-- Create roles if not exists (idempotent; may already exist on shared dev Postgres).
-- LOGIN + PASSWORD are REQUIRED so the runtime + test harness can actually connect
-- as fxl_finders_app (a bare NOLOGIN role cannot open a connection — D-G).
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'fxl_finders_owner') THEN
    CREATE ROLE fxl_finders_owner;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'fxl_finders_app') THEN
    CREATE ROLE fxl_finders_app LOGIN PASSWORD 'fxl_finders_app';
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'fxl_finders_admin') THEN
    -- Cross-tenant admin connection (D-C). BYPASSRLS so admin reads/writes span orgs.
    CREATE ROLE fxl_finders_admin LOGIN PASSWORD 'fxl_finders_admin' BYPASSRLS;
  END IF;
END $$;

-- Tenant-scoped tables: finders, leads
GRANT SELECT, INSERT, UPDATE ON finders TO fxl_finders_app;
GRANT SELECT, INSERT, UPDATE ON leads TO fxl_finders_app;

-- Global admin-managed tables: apps, products, price_bands, commission_rules
GRANT SELECT, INSERT, UPDATE ON apps TO fxl_finders_app;
GRANT SELECT, INSERT, UPDATE ON products TO fxl_finders_app;
GRANT SELECT, INSERT, UPDATE ON price_bands TO fxl_finders_app;
GRANT SELECT, INSERT, UPDATE ON commission_rules TO fxl_finders_app;

-- Cross-org tables: sellers, webhook_events
GRANT SELECT, INSERT, UPDATE ON sellers TO fxl_finders_app;
GRANT SELECT, INSERT ON webhook_events TO fxl_finders_app;  -- no UPDATE (immutable after write)

-- Append-only: audit_log — INSERT + SELECT only, no UPDATE, no DELETE
GRANT SELECT, INSERT ON audit_log TO fxl_finders_app;
GRANT USAGE ON SEQUENCE audit_log_id_seq TO fxl_finders_app;

-- Admin BYPASSRLS role gets full DML on every table (cross-tenant) — D-C.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO fxl_finders_admin;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO fxl_finders_admin;
```

**Note:** Role creation is guarded with `DO $$ ... IF NOT EXISTS` to survive replay on a shared dev Postgres. Migration is designed to run as `fxl_finders_owner` (table owner). On fresh Docker DB the owner may collapse to `postgres` initially — but `DATABASE_URL` (runtime) MUST target `fxl_finders_app` and `ADMIN_DATABASE_URL` MUST target `fxl_finders_admin` (see T09b/T14). The `LOGIN PASSWORD` on `fxl_finders_app` is what lets T12 connect as a non-superuser so RLS is actually exercised (postgres superuser BYPASSES RLS — D-G).

**Acceptance criteria:**
- [ ] `pnpm db:generate` exits 0
- [ ] Migration SQL file exists in `apps/api/drizzle/` and is the file referenced by the newest entry in `apps/api/drizzle/meta/_journal.json`
- [ ] Role-creation + grant SQL is APPENDED INTO that journaled file (NOT a standalone unjournaled `.sql`) — confirm by checking the `.sql` named in `_journal.json` contains the `GRANT ... TO fxl_finders_app` lines
- [ ] `fxl_finders_app` created with `LOGIN PASSWORD` (so the test harness/runtime can connect as a non-superuser); `fxl_finders_admin` created `LOGIN ... BYPASSRLS`
- [ ] No money column is `numeric` (grep check: `grep -i 'numeric' apps/api/drizzle/*.sql` should return only `rate_pct` columns, never `_brl` columns)
- [ ] After `pnpm db:migrate`, the roles exist: `SELECT rolname FROM pg_roles WHERE rolname LIKE 'fxl_finders_%'` returns all three

---

### T09b · Admin BYPASSRLS connection — `getAdminDb()` + `ADMIN_DATABASE_URL` (D-C)

**File(s):** `apps/api/src/db/client.ts`, `apps/api/src/env.ts`, `apps/api/.env.dev.example`
**Depends on:** T09 (creates the `fxl_finders_admin` role).
**What:** Expose a dedicated cross-tenant admin DB connection so admin/cross-tenant routes (Phase 03 finders approve/suspend; Phase 05 commissions/conversions admin reads + state transitions; Phase 06 payouts) read/write across orgs WITHOUT calling `setTenantContext`. This connection authenticates as `fxl_finders_admin` (BYPASSRLS), which closes any `USING(true)` cross-tenant hole because RLS is bypassed at the role level, not via permissive policy (D-C).

**Steps:**
1. Add `ADMIN_DATABASE_URL` to the env schema in `src/env.ts` (same `emptyToUndefined` treatment as `DATABASE_URL`; backend-only, never `VITE_`-prefixed).
2. Confirm the existing `getDb()` lazy pattern is unchanged (D-H: no `db` singleton, no `db/index.ts`). Add a SECOND lazy getter `getAdminDb()` alongside it.

```typescript
// apps/api/src/db/client.ts (append — do NOT remove getDb()/closeDb())
let _adminClient: ReturnType<typeof postgres> | null = null;
let _adminDb: ReturnType<typeof drizzle<typeof schema>> | null = null;

/**
 * Admin / cross-tenant DB connection. Authenticates as the BYPASSRLS role
 * (fxl_finders_admin). Used ONLY by admin domain routes that legitimately span
 * orgs. NEVER call setTenantContext on this connection (D-C). Every admin money
 * mutation must still write audit_log.
 */
export function getAdminDb() {
  if (!env.ADMIN_DATABASE_URL) {
    throw new Error('ADMIN_DATABASE_URL not configured. Set it in apps/api/.env');
  }
  if (!_adminDb) {
    _adminClient = postgres(env.ADMIN_DATABASE_URL, { max: 5 });
    _adminDb = drizzle(_adminClient, { schema });
  }
  return _adminDb;
}
```
3. Extend `closeDb()` (or add `closeAdminDb()`) to also tear down `_adminClient` for clean shutdown.
4. Add `ADMIN_DATABASE_URL` to `.env.dev.example` with a comment (dev may point at the same Docker Postgres but with user `fxl_finders_admin`).

**Acceptance criteria:**
- [ ] `getAdminDb()` exported from `apps/api/src/db/client.ts`, lazy, mirroring `getDb()` (D-H: no singleton, no `db/index.ts`)
- [ ] `ADMIN_DATABASE_URL` added to `src/env.ts` schema (backend-only, no `VITE_` prefix)
- [ ] `ADMIN_DATABASE_URL` present in `.env.dev.example` with a call-out that it must use the `fxl_finders_admin` (BYPASSRLS) role
- [ ] Shutdown path closes the admin client
- [ ] Doc note: admin domain routes use `getAdminDb()` and NEVER call `setTenantContext`; every admin money mutation still writes `audit_log`
- [ ] `pnpm type-check` passes

---

### T10 · RLS policies — APPENDED INTO THE SAME JOURNALED MIGRATION (D-F)

**File(s):** `apps/api/drizzle/` (the SAME generated, journaled migration `.sql` from T09)
**Depends on:** T09 (the journaled migration file already holds the role grants).
**What:** Append `FORCE ROW LEVEL SECURITY` + policy definitions to the SAME generated migration file from T09 (the one registered in `apps/api/drizzle/meta/_journal.json`), AFTER the role grants. Do NOT create a separate `apps/api/drizzle/<ts>_rls_policies.sql` standalone file — the Drizzle migrator (`pnpm db:migrate`) only executes files listed in `_journal.json`, so a hand-authored standalone file would be silently skipped and the policies would never be applied (per D-F). Keeping policy SQL as a clearly commented block inside the journaled file preserves readability AND guarantees it runs.

**Migration content (append into the journaled file, after the T09 grants):**
```sql
-- ============================================================================
-- RLS policies for tenant-scoped tables (D-F: in the journaled migration).
-- Runs as fxl_finders_owner (table owner).
-- Runtime role: fxl_finders_app (no BYPASSRLS). Admin uses fxl_finders_admin
-- (BYPASSRLS) — policies below do not apply to it (D-C).
-- ============================================================================

-- ── finders ────────────────────────────────────────────────
ALTER TABLE finders ENABLE ROW LEVEL SECURITY;
ALTER TABLE finders FORCE ROW LEVEL SECURITY;  -- table owner is also subject to RLS

CREATE POLICY finders_tenant_isolation ON finders
  AS PERMISSIVE
  FOR ALL
  TO fxl_finders_app
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

-- ── leads ──────────────────────────────────────────────────
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads FORCE ROW LEVEL SECURITY;

CREATE POLICY leads_tenant_isolation ON leads
  AS PERMISSIVE
  FOR ALL
  TO fxl_finders_app
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

-- Tables without tenant RLS:
--   sellers       — cross-org; admin role access only
--   apps          — global registry; admin role access only
--   products      — global; admin role access only
--   price_bands   — global; admin role access only
--   commission_rules — global; admin role access only
--   audit_log     — append-only; admin SELECT; system INSERT
--   webhook_events   — global; idempotency table
-- Note: these tables do NOT have RLS enabled; access is controlled
-- by the DB role privilege grants in the prior migration.

-- ── Tenant context helper ──────────────────────────────────
-- Called by the service layer INSIDE each transaction (D-D):
--   SELECT set_config('app.current_org_id', $1, true);
-- The 3rd arg (true) makes it transaction-local (reset on COMMIT/ROLLBACK) and is
-- why connection-pooled set_config is unsafe — it MUST be set per-transaction.
-- No DB function needed — setTenantContext(tx, orgId) (T11) calls this via Drizzle
-- on the transaction handle.
```

**Acceptance criteria:**
- [ ] RLS SQL is APPENDED INTO the SAME journaled migration file from T09 (no standalone `<ts>_rls_policies.sql`) — confirm the `.sql` named in `_journal.json` contains `CREATE POLICY finders_tenant_isolation`
- [ ] `ALTER TABLE ... FORCE ROW LEVEL SECURITY` applied to `finders` and `leads` only
- [ ] Policy uses `current_setting('app.current_org_id', true)` (2nd arg `true` = no error if unset, returns NULL — policy evaluates to FALSE safely)
- [ ] **After `pnpm db:migrate`, `SELECT schemaname, tablename, policyname FROM pg_policies WHERE tablename IN ('finders','leads')` returns the two policies** (proves the journaled migration actually applied them — D-F acceptance)
- [ ] Comment block explains which tables do NOT have RLS and why, and that `fxl_finders_admin` (BYPASSRLS) is not subject to these policies

---

### T11 · Clerk auth middleware — `clerkAuthMiddleware` + role extraction + tx-scoped `setTenantContext`

**File(s):** `apps/api/src/middleware/auth.ts`
**What:** Replace the 501 stub with real `@clerk/backend` `verifyToken`. The `@clerk/backend` package is already in `package.json` at `^1.21.0`. This task implements three locked decisions:
- **D-B:** export the middleware as `clerkAuthMiddleware` (keep `authMiddleware` as a backward-compat alias). Augment Hono `ContextVariableMap` with `userId: string`, `orgId: string`, `userRole: string | undefined`. Extract `userRole` from the verified JWT payload `publicMetadata?.role`. This middleware OWNS role extraction; NEVER call `clerkClient.users.getUser()` in a request path (Phase 02's `requireAdmin` reads `c.get('userRole')`).
- **D-D:** `setTenantContext(tx, orgId)` takes a **transaction handle** (not a connection). Add `import { sql } from 'drizzle-orm'`. Tighten the param type so only a tx/db with a Drizzle `.execute()` is accepted. Connection-level `set_config` does NOT survive pooling, so it MUST run inside the same transaction as the queries.

**Implementation:**
```typescript
import { verifyToken } from '@clerk/backend';
import { sql } from 'drizzle-orm';
import type { MiddlewareHandler } from 'hono';
import type { PgTransaction } from 'drizzle-orm/pg-core';
import { env } from '../env.js';

declare module 'hono' {
  interface ContextVariableMap {
    userId: string;
    orgId: string;
    userRole: string | undefined; // from JWT publicMetadata.role — admin | seller | finder | undefined
  }
}

export const clerkAuthMiddleware: MiddlewareHandler = async (c, next) => {
  if (!env.CLERK_SECRET_KEY) {
    // Dev/template passthrough — never reaches production (env guard in src/env.ts)
    c.set('userId', 'dev_user');
    c.set('orgId', 'dev_org');
    c.set('userRole', 'admin'); // dev convenience; real role comes from JWT in staging/prod
    return next();
  }

  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'unauthorized', reason: 'missing_bearer_token' }, 401);
  }

  const token = authHeader.slice(7);

  try {
    const payload = await verifyToken(token, {
      secretKey: env.CLERK_SECRET_KEY,
    });

    // FXL contract: org_id takes precedence; fall back to sub (personal JWT)
    const orgId = (payload.org_id as string | undefined) ?? payload.sub;
    // D-B: role rides in the JWT via a Clerk session-token custom claim (see T14).
    // Without that dashboard claim, publicMetadata is absent → userRole undefined → admin gate 403s.
    const publicMetadata = payload.publicMetadata as { role?: string } | undefined;
    c.set('userId', payload.sub);
    c.set('orgId', orgId);
    c.set('userRole', publicMetadata?.role);
    return next();
  } catch {
    return c.json({ error: 'unauthorized', reason: 'invalid_token' }, 401);
  }
};

// Backward-compat alias (D-B). Prefer clerkAuthMiddleware in new code.
export const authMiddleware = clerkAuthMiddleware;

/**
 * Sets the per-TRANSACTION tenant context for RLS (D-D).
 * MUST be called as the first statement inside the transaction body, before any
 * tenant-scoped query, because transaction-local set_config (3rd arg true) does
 * NOT survive connection pooling:
 *
 *   await db.transaction(async (tx) => {
 *     await setTenantContext(tx, c.get('orgId'));
 *     // ...queries via tx...
 *   });
 */
export async function setTenantContext(
  tx: Pick<PgTransaction<never, typeof import('../db/schema.js'), never>, 'execute'>,
  orgId: string,
): Promise<void> {
  await tx.execute(sql`SELECT set_config('app.current_org_id', ${orgId}, true)`);
}
```

**Note:** `setTenantContext` takes a **transaction handle** (`tx`), not the pooled connection (D-D). Every tenant-scoped service fn in Phases 04/05 wraps its work in `db.transaction(async (tx) => { await setTenantContext(tx, orgId); /* queries via tx */ })`. If the executor finds the exact `PgTransaction` generic awkward to satisfy, the param type MAY be narrowed to `{ execute(query: ReturnType<typeof sql>): Promise<unknown> }` — but it MUST NOT be loosened to `unknown` or `any` (strict-TS contract). Admin routes use `getAdminDb()` and NEVER call `setTenantContext` (D-C).

**Autopilot decision logged:** `setTenantContext` stays a standalone exported function (not a transaction-wrapping middleware) because Drizzle transactions require the explicit `db.transaction(async (tx) => { ... })` callback. The function now requires the `tx` handle so the RLS context provably lives inside the same transaction as the queries.

**Acceptance criteria:**
- [ ] Exported as `clerkAuthMiddleware`; `authMiddleware` re-exported as an alias (D-B)
- [ ] `verifyToken` from `@clerk/backend` is called with `{ secretKey: env.CLERK_SECRET_KEY }`
- [ ] `orgId = payload.org_id ?? payload.sub` (FXL contract)
- [ ] `userRole` extracted from `payload.publicMetadata?.role` and set on context; `ContextVariableMap` augmented with `userId`, `orgId`, `userRole` (D-B)
- [ ] NO `clerkClient.users.getUser()` call in the middleware/request path (role comes from JWT only)
- [ ] `setTenantContext(tx, orgId)` takes a transaction handle, imports `{ sql }` from `drizzle-orm`, and is NOT typed `unknown`/`any` (D-D)
- [ ] Dev passthrough preserved for local dev (when `CLERK_SECRET_KEY` is unset)
- [ ] `pnpm type-check` passes

---

### T11b · `clerkClient` singleton — `apps/api/src/lib/clerk.ts` (D-I)

**File(s):** `apps/api/src/lib/clerk.ts` (new)
**What:** Create the single shared Clerk Backend SDK client so Phases 03/05 import ONE instance. Do NOT `import { clerkClient } from '@clerk/backend'` — in `@clerk/backend` v1.x there is no bound default `clerkClient`; you must construct it with `createClerkClient` (D-I).

**Implementation:**
```typescript
// apps/api/src/lib/clerk.ts
import { createClerkClient } from '@clerk/backend';
import { env } from '../env.js';

/**
 * Shared Clerk Backend SDK client (D-I). Single source for Phases 03 (org creation,
 * invitations) and 05 (user.created webhook backfill). Never construct ad-hoc clients.
 */
export const clerkClient = createClerkClient({ secretKey: env.CLERK_SECRET_KEY });
```

**Note:** `env.CLERK_SECRET_KEY` is `string | undefined`; if `createClerkClient`'s types reject `undefined`, pass `env.CLERK_SECRET_KEY ?? ''` (the dev passthrough in T11 already short-circuits auth when the key is unset, so an empty key is only ever used in local/template mode). This is a lazy-construct module — importing it does not perform network I/O.

**Acceptance criteria:**
- [ ] `apps/api/src/lib/clerk.ts` exists and exports `clerkClient`
- [ ] Built via `createClerkClient({ secretKey: env.CLERK_SECRET_KEY })` — NOT imported as a bound default from `@clerk/backend` (D-I)
- [ ] Named export only (no default export — FXL contract)
- [ ] `pnpm type-check` passes

---

### T12 · Cross-tenant RLS test harness — connect as `fxl_finders_app` (D-G)

**File(s):** `apps/api/test/rls/cross-tenant.test.ts` (new file + directory)
**Depends on:** T09 (creates `fxl_finders_app LOGIN`), T10 (policies), T13 (globalSetup runs migrations against `TEST_DATABASE_URL`).
**What:** Vitest integration tests that assert tenant isolation for every tenant-scoped table. **The test connection MUST authenticate as `fxl_finders_app`, NOT as the `postgres` superuser** — Postgres superusers (and `BYPASSRLS` roles like `fxl_finders_admin`) BYPASS RLS entirely, so a test that connects as `postgres` validates NOTHING (D-G). `TEST_DATABASE_URL` therefore points at the Docker Postgres with user `fxl_finders_app` (the password set in T09). Tests run against the Docker Postgres on port 5006 (defined in `docker-compose.yml`). Tests live under `test/rls/` and run only via `pnpm test:integration` (separate vitest project — see T13).

The suite MUST include, for the tenant-scoped tables `finders` and `leads`:
1. **Positive control** — org A, under its own context, reads its own row → exactly **1 row** (proves the policy isn't just blocking everything).
2. **Cross-org-zero** — org B reading org A's row by PK → **0 rows** (USING isolation).
3. **WITH CHECK on INSERT** — org A context inserting a row claiming org B's `org_id` → rejected.
4. **UPDATE path** — org B context attempting to UPDATE org A's row → **0 rows affected** (USING applies to UPDATE), AND org A context updating its own row → 1 row affected.

**Test structure:**
```typescript
/**
 * Cross-tenant RLS integration tests.
 *
 * Requires Docker Postgres running + migrations applied (vitest globalSetup, T13).
 * Run with: pnpm --filter @fxl-finders/api test:integration
 *
 * CRITICAL (D-G): connect as fxl_finders_app, NOT postgres. The postgres superuser
 * and the fxl_finders_admin BYPASSRLS role both BYPASS RLS — testing as either
 * proves nothing. TEST_DATABASE_URL must use the fxl_finders_app login.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import postgres from 'postgres';

// fxl_finders_app login — NOT postgres. globalSetup (T13) applies migrations first
// (it may use an owner/superuser URL); this URL is the RLS-enforced runtime role.
const TEST_DB_URL = process.env.TEST_DATABASE_URL
  ?? 'postgresql://fxl_finders_app:fxl_finders_app@localhost:5006/fxl_finders';

describe('RLS: cross-tenant isolation (as fxl_finders_app)', () => {
  let sql: postgres.Sql;

  beforeAll(async () => {
    sql = postgres(TEST_DB_URL);
    // Guard: fail loudly if someone points TEST_DATABASE_URL at a superuser/BYPASSRLS role.
    const [{ rolsuper, rolbypassrls, current_user: who }] = await sql`
      SELECT rolsuper, rolbypassrls, current_user
      FROM pg_roles WHERE rolname = current_user
    `;
    if (rolsuper || rolbypassrls) {
      throw new Error(`RLS tests must run as a non-superuser, non-BYPASSRLS role; got ${who}`);
    }
  });

  afterAll(async () => {
    await sql.end();
  });

  // ── finders ────────────────────────────────────────────────────────────────
  it('finders: positive control + cross-org-zero + WITH CHECK + UPDATE path', async () => {
    const ORG_A = 'org_test_a_' + Date.now();
    const ORG_B = 'org_test_b_' + Date.now();

    // Insert as org_A
    const [inserted] = await sql.begin(async (tx) => {
      await tx`SELECT set_config('app.current_org_id', ${ORG_A}, true)`;
      return tx`
        INSERT INTO finders (org_id, clerk_user_id, clerk_org_id, status, display_name, contact_email)
        VALUES (${ORG_A}, ${'usr_test_' + Date.now()}, ${'corg_' + Date.now()}, 'pending', 'Test Finder A', 'a@test.com')
        RETURNING id
      `;
    });
    const id = inserted.id as string;

    // (1) POSITIVE CONTROL — org_A reads its own row → exactly 1 row
    const ownRows = await sql.begin(async (tx) => {
      await tx`SELECT set_config('app.current_org_id', ${ORG_A}, true)`;
      return tx`SELECT id FROM finders WHERE id = ${id}`;
    });
    expect(ownRows).toHaveLength(1);

    // (2) CROSS-ORG-ZERO — org_B cannot read org_A row → 0 rows
    const otherRows = await sql.begin(async (tx) => {
      await tx`SELECT set_config('app.current_org_id', ${ORG_B}, true)`;
      return tx`SELECT id FROM finders WHERE id = ${id}`;
    });
    expect(otherRows).toHaveLength(0);

    // (4a) UPDATE PATH — org_B cannot update org_A's row → 0 rows affected
    const crossUpdate = await sql.begin(async (tx) => {
      await tx`SELECT set_config('app.current_org_id', ${ORG_B}, true)`;
      return tx`UPDATE finders SET display_name = 'hijacked' WHERE id = ${id} RETURNING id`;
    });
    expect(crossUpdate).toHaveLength(0);

    // (4b) UPDATE PATH — org_A updates its own row → 1 row affected
    const ownUpdate = await sql.begin(async (tx) => {
      await tx`SELECT set_config('app.current_org_id', ${ORG_A}, true)`;
      return tx`UPDATE finders SET display_name = 'renamed' WHERE id = ${id} RETURNING id`;
    });
    expect(ownUpdate).toHaveLength(1);

    // Cleanup as org_A (RLS lets it delete its own row; GRANT in T09 covers DELETE? — if not,
    // the globalSetup teardown / owner connection handles cleanup).
    await sql.begin(async (tx) => {
      await tx`SELECT set_config('app.current_org_id', ${ORG_A}, true)`;
      await tx`DELETE FROM finders WHERE id = ${id}`;
    });
  });

  // ── WITH CHECK: org_A context cannot insert a row claiming org_B ownership ──
  it('finders: WITH CHECK prevents cross-org insert', async () => {
    const ORG_A = 'org_test_a_' + Date.now();
    const ORG_B = 'org_test_b_' + Date.now();
    await expect(
      sql.begin(async (tx) => {
        await tx`SELECT set_config('app.current_org_id', ${ORG_A}, true)`;
        return tx`
          INSERT INTO finders (org_id, clerk_user_id, clerk_org_id, status, display_name, contact_email)
          VALUES (${ORG_B}, ${'usr_check_' + Date.now()}, ${'corg_chk_' + Date.now()}, 'pending', 'Smuggler', 'x@test.com')
          RETURNING id
        `;
      }),
    ).rejects.toThrow(); // Postgres raises on WITH CHECK violation
  });

  // ── leads: same matrix (positive control + cross-org-zero + UPDATE path) ──
  it('leads: positive control + cross-org-zero + UPDATE path', async () => {
    const ORG_A = 'org_test_a_' + Date.now();
    const ORG_B = 'org_test_b_' + Date.now();

    const [inserted] = await sql.begin(async (tx) => {
      await tx`SELECT set_config('app.current_org_id', ${ORG_A}, true)`;
      return tx`INSERT INTO leads (org_id, status) VALUES (${ORG_A}, 'clicked') RETURNING id`;
    });
    const id = inserted.id as string;

    const ownRows = await sql.begin(async (tx) => {
      await tx`SELECT set_config('app.current_org_id', ${ORG_A}, true)`;
      return tx`SELECT id FROM leads WHERE id = ${id}`;
    });
    expect(ownRows).toHaveLength(1); // positive control

    const otherRows = await sql.begin(async (tx) => {
      await tx`SELECT set_config('app.current_org_id', ${ORG_B}, true)`;
      return tx`SELECT id FROM leads WHERE id = ${id}`;
    });
    expect(otherRows).toHaveLength(0); // cross-org-zero

    const crossUpdate = await sql.begin(async (tx) => {
      await tx`SELECT set_config('app.current_org_id', ${ORG_B}, true)`;
      return tx`UPDATE leads SET status = 'lead' WHERE id = ${id} RETURNING id`;
    });
    expect(crossUpdate).toHaveLength(0); // UPDATE isolation

    await sql.begin(async (tx) => {
      await tx`SELECT set_config('app.current_org_id', ${ORG_A}, true)`;
      await tx`DELETE FROM leads WHERE id = ${id}`;
    });
  });
});
```

**Note (cleanup grants):** the runtime role's DELETE is not granted by T09 (app role is INSERT/UPDATE/SELECT only). If a test's own-context DELETE fails on a missing privilege, either (a) grant DELETE on `finders`/`leads` to `fxl_finders_app` in T09, or (b) clean up in the T13 globalTeardown using the owner connection. The executor picks one and keeps it consistent.

**Package.json addition** (`apps/api/package.json` scripts):
```json
"test:integration": "vitest run --project integration"
```

**Acceptance criteria:**
- [ ] `apps/api/test/rls/cross-tenant.test.ts` created
- [ ] Test connection authenticates as `fxl_finders_app` (NOT `postgres`/superuser, NOT `fxl_finders_admin`/BYPASSRLS) — guarded by the `rolsuper`/`rolbypassrls` assertion in `beforeAll` (D-G)
- [ ] Tests cover both `finders` and `leads` (the two tenant-scoped tables in Phase 01)
- [ ] Includes a **positive control** (org A reads its own row = 1) AND a cross-org-zero assertion (D-G)
- [ ] Includes the **UPDATE path** (cross-org UPDATE → 0 rows affected; own UPDATE → 1 row), not just INSERT/SELECT (D-G)
- [ ] Includes WITH CHECK (write isolation) rejection test
- [ ] Connection string via `TEST_DATABASE_URL` env var (Docker Postgres port 5006)
- [ ] `pnpm --filter @fxl-finders/api test:integration` runs and tests pass against a migrated DB
- [ ] Default `pnpm test` (unit tests) does NOT include these integration tests (separate vitest project — T13)

---

### T13 · Vitest config — split unit vs integration projects + globalSetup that migrates `TEST_DATABASE_URL` (D-G)

**File(s):** `apps/api/vitest.config.ts` (new or update existing), `apps/api/test/rls/global-setup.ts` (new)
**What:** Configure two vitest projects — `unit` (default, runs on `pnpm test`) and `integration` (runs only on `pnpm test:integration`) — AND wire a `globalSetup` on the integration project that runs the Drizzle migrations against `TEST_DATABASE_URL` BEFORE any RLS test connects (D-G). Without this, T12 would run against an unmigrated DB (no tables, no policies, no roles) and fail or false-pass.

**globalSetup:**
```typescript
// apps/api/test/rls/global-setup.ts
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';

/**
 * Vitest globalSetup for the integration project (D-G).
 * Applies the journaled Drizzle migrations (CREATE TABLE + role grants + RLS
 * policies, all in one journaled file per D-F) to TEST_DATABASE_URL before any
 * RLS test runs. Uses a migration/owner-capable URL (TEST_MIGRATE_DATABASE_URL),
 * falling back to TEST_DATABASE_URL. The RLS tests themselves then connect as
 * fxl_finders_app (T12).
 */
export async function setup() {
  const migrateUrl =
    process.env.TEST_MIGRATE_DATABASE_URL ??
    process.env.TEST_DATABASE_URL ??
    'postgresql://postgres:postgres@localhost:5006/fxl_finders';
  const client = postgres(migrateUrl, { max: 1 });
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: './drizzle' });
  await client.end();
}
```

**Config:**
```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        name: 'unit',
        test: {
          include: ['src/**/__tests__/**/*.test.ts'],
          exclude: ['test/rls/**'],
        },
      },
      {
        name: 'integration',
        test: {
          include: ['test/rls/**/*.test.ts'],
          globalSetup: ['./test/rls/global-setup.ts'], // D-G: migrate before RLS tests
          testTimeout: 30000,
          hookTimeout: 30000,
        },
      },
    ],
  },
});
```

**Note:** migrations are applied with an owner/superuser-capable URL (`TEST_MIGRATE_DATABASE_URL`, fallback `TEST_DATABASE_URL`) because `CREATE ROLE`/`CREATE POLICY` need elevated privileges; the RLS tests then deliberately reconnect as the unprivileged `fxl_finders_app` (T12). This mirrors the dev-vs-staging role split (owner migrates, app role at runtime).

**Acceptance criteria:**
- [ ] `apps/api/test/rls/global-setup.ts` created; runs `migrate(db, { migrationsFolder: './drizzle' })` against `TEST_MIGRATE_DATABASE_URL ?? TEST_DATABASE_URL` (D-G)
- [ ] Integration project references `globalSetup: ['./test/rls/global-setup.ts']`
- [ ] `pnpm --filter @fxl-finders/api test` runs only the unit project (no RLS tests, no globalSetup)
- [ ] `pnpm --filter @fxl-finders/api test:integration` applies migrations first, then runs the integration project
- [ ] `pnpm type-check` passes

---

### T14 · Clerk dashboard config call-out (documentation + env)

**File(s):** `apps/api/.env.dev.example`, `docs/nexo/decisions/phase01-clerk-config.md`
**What:** Add a human-readable call-out for the Clerk dashboard settings that must be configured for Phase 01 security requirements. This is a config task (not code), but must be tracked.

**Clerk settings required (per spec § 9 + D-B):**
- Clerk `Restrictions` → `Allowlist` mode: enable (prevents unauthorized end-user org creation)
- Clerk `Organizations` → `Allow end users to create organizations`: set to **Off** (admins create orgs only)
- Clerk `JWT Templates` / `Sessions` → ensure `org_id` is included in the JWT payload (it is by default for Clerk organizations, but must be verified)
- **Clerk session-token CUSTOM CLAIM (D-B, load-bearing):** add a session-token claim that injects `publicMetadata.role` into the JWT so the backend can read `payload.publicMetadata?.role` in `clerkAuthMiddleware` (T11) WITHOUT a per-request `clerkClient.users.getUser()` call. In the Clerk dashboard (Sessions → Customize session token), add:
  ```json
  { "publicMetadata": "{{user.public_metadata}}" }
  ```
  WITHOUT this claim, `payload.publicMetadata` is undefined → `userRole` is undefined → the Phase 02 `requireAdmin` gate 403s EVERY admin. This is a hard prerequisite for the admin path and MUST be in the handoff checklist.

**env.dev.example update** — ensure Clerk + DB role URLs have dev placeholders:
```
# Clerk — get from https://dashboard.clerk.com (FXL Local Sandbox app)
# NOTE (D-B): the Clerk session token MUST include a custom claim
#   { "publicMetadata": "{{user.public_metadata}}" }
# or the backend reads userRole=undefined and every admin request 403s.
CLERK_SECRET_KEY=sk_test_replace_me
CLERK_PUBLISHABLE_KEY=pk_test_replace_me

# DB roles (dev-vs-staging split). Runtime targets fxl_finders_app (RLS enforced);
# migrations run as the owner; admin/cross-tenant uses fxl_finders_admin (BYPASSRLS).
# On a fresh local Docker DB these may collapse to `postgres`, but staging/prod MUST split.
DATABASE_URL=postgresql://fxl_finders_app:fxl_finders_app@localhost:5006/fxl_finders
ADMIN_DATABASE_URL=postgresql://fxl_finders_admin:fxl_finders_admin@localhost:5006/fxl_finders
```

**Autopilot decision logged:** Creating a short `docs/nexo/decisions/phase01-clerk-config.md` to capture the Clerk dashboard config requirements (including the session-token custom claim). This is not a CLAUDE.md or README change — it's a decision record so future operators (or CI docs-check) can verify the dashboard state.

**Handoff items (carry to phase handoff):**
1. Clerk session-token custom claim `{ "publicMetadata": "{{user.public_metadata}}" }` MUST be configured in the dashboard before any admin login works (D-B).
2. Runtime `DATABASE_URL` MUST target `fxl_finders_app`; migrations use the owner role; admin uses `ADMIN_DATABASE_URL` → `fxl_finders_admin` (BYPASSRLS) (D-C, dev-vs-staging split NIT).

**Acceptance criteria:**
- [ ] `apps/api/.env.dev.example` has `CLERK_SECRET_KEY` + `CLERK_PUBLISHABLE_KEY` placeholders
- [ ] `apps/api/.env.dev.example` has `DATABASE_URL` (→ `fxl_finders_app`) and `ADMIN_DATABASE_URL` (→ `fxl_finders_admin`) with the role-split comment
- [ ] Decision record documents the required Clerk dashboard settings INCLUDING the session-token `publicMetadata` custom claim (D-B)
- [ ] Handoff records both the Clerk custom claim and the DB role split as prerequisites
- [ ] No actual secret keys committed

---

### T15 · Type-check + lint gate

**File(s):** (all modified files)
**What:** Final verification gate. Run the full type-check and lint before committing Phase 01.

**Commands:**
```bash
pnpm --filter @fxl-finders/api type-check
pnpm --filter @fxl-finders/api lint
```

**Acceptance criteria:**
- [ ] `pnpm --filter @fxl-finders/api type-check` exits 0
- [ ] `pnpm --filter @fxl-finders/api lint` exits 0 (or with only pre-existing warnings)
- [ ] `grep -i 'numeric\|float\|real' apps/api/drizzle/*.sql` returns only `rate_pct` columns — no money column uses float types
- [ ] No `any` types in modified TypeScript files

---

## Autopilot decisions log (Phase 01)

| # | Decision | Choice | Reason |
|---|---|---|---|
| 1 | `updated_at` strategy | Plain nullable timestamptz; service layer sets on update | Avoids DB trigger complexity in Phase 01; trigger can be added post-v1.0 if desired |
| 2 | RLS test toolchain | Vitest + `postgres` npm client, connecting as `fxl_finders_app` | pgTAP adds Docker extension complexity; postgres client already in deps. Superuser bypasses RLS, so tests MUST connect as the unprivileged app role (D-G) |
| 3 | `setTenantContext` signature | `setTenantContext(tx, orgId)` — takes a TRANSACTION handle (D-D) | Connection-level set_config does not survive pooling; RLS context must live inside the same tx as the queries. Imports `{ sql }` from `drizzle-orm` |
| 4 | `leads` FK strategy | Soft FKs to `referral_links`/`clicks` in Phase 01 | Those tables don't exist yet; hard FKs added in Phase 04 migration |
| 5 | RLS / role-grant SQL location | APPENDED INTO the journaled Drizzle migration file (D-F), NOT a standalone `.sql` | The migrator (`pnpm db:migrate`) only runs files in `_journal.json`; a standalone hand-authored file is silently skipped. Acceptance: `pg_policies` shows the policies after migrate |
| 6 | DB roles in migration | `DO $$ IF NOT EXISTS $$` guard; `fxl_finders_app` gets `LOGIN PASSWORD`; `fxl_finders_admin` `LOGIN ... BYPASSRLS` (D-C/D-G) | Idempotent on shared dev Postgres; app role needs LOGIN so the test harness/runtime can connect as a non-superuser and exercise RLS; admin role bypasses RLS for cross-tenant routes |
| 7 | `sellers` / `apps` / `products` / `price_bands` / `commission_rules` / `audit_log` / `webhook_events` — no org_id | Correct per spec § 4 | Cross-org or global tables; access controlled by DB role grants, not RLS |
| 8 | Clerk config docs | `docs/nexo/decisions/phase01-clerk-config.md` incl. session-token `publicMetadata` custom claim (D-B) | Required for security checklist (spec § 9) AND for the admin role gate to work (claim injects role into JWT) |
| 9 | Auth middleware export | `clerkAuthMiddleware` (rename) + `authMiddleware` alias; `ContextVariableMap` gains `userId`/`orgId`/`userRole`; role from `publicMetadata?.role` (D-B) | ONE auth mechanism owns role extraction; no `clerkClient.users.getUser()` in request path |
| 10 | Admin DB access | `getAdminDb()` lazy getter on `fxl_finders_admin` BYPASSRLS conn (`ADMIN_DATABASE_URL`); existing `getDb()` lazy pattern kept; NO db singleton / `db/index.ts` (D-C/D-H) | Cross-tenant admin routes bypass RLS at the role level (kills `USING(true)` holes); admin routes never call `setTenantContext` |
| 11 | `clerkClient` singleton | `apps/api/src/lib/clerk.ts` → `createClerkClient({ secretKey })` (D-I) | `@clerk/backend` v1.x has no bound default `clerkClient`; one shared instance for Phases 03/05 |
| 12 | org_id composite indexes | `finders_org_id_idx` / `leads_org_id_idx` leading on `org_id` (D-R NIT) | RLS-filtered tenant reads benefit from an index leading on the filtered column |

---

## Failure list

(none — all blockers resolved via the locked decisions D-B/D-C/D-D/D-F/D-G/D-H/D-I + NITs above; see decisions table)

---

## Phase dependencies

**This phase unblocks:** Phase 02 (admin CRUD for apps/products) and Phase 03 (finder onboarding) — both parallelizable after Phase 01 commit.

**This phase depends on:** nothing (W1 — first phase).

---

## Verify gate

After execution, run:
```bash
/gsd-verify-work 01
```

Verify checklist (manually confirm before marking phase complete):
- [ ] All 9 foundation tables present in `apps/api/src/db/schema.ts` (no LGPD consent cols — owned by Phase 03)
- [ ] Composite indexes leading on `org_id` exist for `finders` and `leads` (D-R NIT)
- [ ] Migration SQL generated in `apps/api/drizzle/`; role grants + RLS policies APPENDED INTO that SAME journaled file (referenced by `_journal.json`), NOT a standalone `.sql` (D-F)
- [ ] After `pnpm db:migrate`: `SELECT * FROM pg_policies WHERE tablename IN ('finders','leads')` returns the two `*_tenant_isolation` policies (D-F)
- [ ] After `pnpm db:migrate`: roles `fxl_finders_owner`, `fxl_finders_app` (LOGIN), `fxl_finders_admin` (LOGIN, BYPASSRLS) all exist (D-C/D-G)
- [ ] Auth middleware exported as `clerkAuthMiddleware` with `authMiddleware` alias; calls `verifyToken` from `@clerk/backend`; sets `userId`/`orgId`/`userRole`(from `publicMetadata?.role`) (D-B)
- [ ] `setTenantContext(tx, orgId)` takes a transaction handle, imports `{ sql }` from `drizzle-orm`, not typed `unknown`/`any` (D-D)
- [ ] `getAdminDb()` + `ADMIN_DATABASE_URL` exist; `getDb()` lazy pattern unchanged; NO db singleton / `db/index.ts` (D-C/D-H)
- [ ] `apps/api/src/lib/clerk.ts` exports `clerkClient` via `createClerkClient({ secretKey })` (D-I)
- [ ] `test/rls/cross-tenant.test.ts` connects as `fxl_finders_app` (guarded against superuser/BYPASSRLS) with positive control + cross-org-zero + WITH CHECK + UPDATE-path tests for `finders` and `leads` (D-G)
- [ ] `test/rls/global-setup.ts` migrates `TEST_DATABASE_URL` before integration tests run (D-G)
- [ ] Clerk session-token custom claim `{ "publicMetadata": "{{user.public_metadata}}" }` documented in decision record + `.env.dev.example` note + handoff (D-B)
- [ ] `pnpm --filter @fxl-finders/api type-check` exits 0
- [ ] `pnpm --filter @fxl-finders/api test:integration` passes (requires Docker Postgres running)
- [ ] No money column uses `numeric` or `float` — only `integer` (cents)
- [ ] No `any` in modified TypeScript files
