---
phase: "05"
name: "Conversion ingestion + commission ledger + audit"
milestone: "v1.0 — FXL Finders MVP"
status: "planned"
wave: "W4"
depends_on: ["04"]
plan_count: 14
mode: standard
autonomous: true
requirements_addressed: ["REQ-conversions", "REQ-commissions", "REQ-payouts", "REQ-audit-log", "REQ-webhook-ingest", "REQ-state-machine", "REQ-clerk-webhook", "REQ-admin-reconciliation"]
---

# Phase 05 — Conversion ingestion + commission ledger + audit

**Milestone:** v1.0 — FXL Finders MVP
**Status:** ⏳ planned
**Wave:** W4 (depends on Phase 04)

---

## PREREQUISITE — `/gsd:ui-phase` REQUIRED BEFORE T09

> `/gsd:ui-phase 05` MUST be run before executing T09 (admin reconciliation views).
> This phase has significant admin UI surface: conversions list, commissions list with
> state, and audit log viewer. The UI-SPEC contract defines visual/interaction spec
> that all admin frontend tasks must follow.
>
> **Command to run first (before T09):**
> ```
> /gsd:ui-phase 05
> ```
> After UI-SPEC is written (`.planning/phases/05-*/05-UI-SPEC.md`), proceed with T09.
>
> Tasks T01–T08 and T11–T14 (backend, schema, TDD) do NOT require the UI-SPEC and
> can be executed in parallel with the UI-SPEC generation.

---

## Context sources (read before executing any task)

1. `.planning/plan-brief.md` — cascading decisions (READ FIRST — Wave 0/1/2/3 decisions)
2. `docs/superpowers/specs/2026-05-28-fxl-finders-v1-design.md` — canonical spec:
   - § 4 `conversions`, `commissions`, `payouts`, `webhook_events`, `audit_log` schemas
   - § 5 inbound webhook auth flow (HMAC verify, idempotency, raw body)
   - § 6 referral flow steps 9–15 (conversion ingestion + commission creation + hold)
   - § 10 open questions — realized vs quoted semantics
3. `.planning/ROADMAP.md` — phase list and wave dependencies
4. `CLAUDE.md` — FXL contract (non-negotiable)
5. `.planning/phases/01-schema-foundation-clerk-auth-rls/01-PLAN.md` — `setTenantContext`, DB roles, RLS, `audit_log` + `webhook_events` already shipped
6. `.planning/phases/04-referral-links-signed-redirect-click-telemetry/04-PLAN.md` — `shared-utils/hmac.ts` exports (T01), `clicks` split-RLS pattern (T03), `referral_links` + `clicks` schema

---

## Architecture decisions (autopilot — logged inline per `/nexo:autopilot`)

| # | Decision | Choice | Reason |
|---|---|---|---|
| D1 | Nightly hold-promotion job | `node-cron` inside apps/api process (`pnpm add node-cron --filter @fxl-finders/api`). Also expose manual endpoint `POST /api/v1/admin/commissions/promote-locked` for v1.0 ops. | "Pick lightest" per task scope. No additional Redis queue worker needed. Documented in admin UI. |
| D2 | Clerk webhook handler placement | `apps/api/src/domains/sellers/clerk-webhook.ts` mounted at `POST /api/v1/webhooks/clerk` | Consistent with Hono domain pattern. svix verification runs before any body parse. |
| D3 | Hono raw body for HMAC | `const rawBody = Buffer.from(await c.req.raw.clone().arrayBuffer())` in HMAC middleware. Store on context: `c.set('rawBody', rawBody)`. Middleware registered BEFORE `@hono/zod-validator` body parse so the stream is read once before the framework consumes it. | `c.req.raw` is the native `Request` object. `.clone()` preserves the body stream for downstream JSON parsing. |
| D4 | Commission basis on realized < quoted | Use `realized_*_brl` as the commission basis regardless of `commission_rules.basis`. If `realized === 0`, do not insert a commission row for that component (zero commission). Spec § 10: "never pay on revenue not actually collected." | Direct spec requirement. |
| D5 | svix for Clerk webhook | `pnpm add svix --filter @fxl-finders/api`. Use `svix`'s `Webhook.verify()` with `CLERK_WEBHOOK_SIGNING_SECRET` env var. | Clerk official recommendation. |
| D6 | State machine transitions (D-K LOCKED) | **Auto path is `pending → locked → paid → (reversed)`** — the nightly job promotes `pending → locked` WHERE `hold_until < now()` with NO manual action and NO `approved` step. Manual admin "approve/lock-now" is an OPTIONAL fast-track that ALSO goes `pending → locked` and shows for `status='pending'`. Allowed transitions: `pending→locked`, `locked→paid`, `any→reversed` (reversed always inserts a new negative-amount row when reversing a `paid` row; does NOT mutate the existing `paid` row). The enum keeps all 5 values (`pending|approved|locked|paid|reversed`) for forward-compat, but `approved` is never produced by the auto path in v1.0. Illegal transitions throw `Error('invalid_transition')`. Enforcement in `commissions/service.ts`. | D-K (plan-brief LOCKED): spec §6 step 13 — fresh commission must reach `locked` after hold with zero manual action. Manual approve is a fast-track to `locked`, not a separate state. |
| D7 | Audit `canonical_json` | `JSON.stringify(obj, Object.keys(obj).sort())` — alphabetically sorted keys, no whitespace. | Deterministic across Node.js versions. |
| D8 | Audit first-row `prev_hash` | `'0'.repeat(64)` per spec § 4. | Spec-prescribed. |
| D9 | `payouts` RLS scoping | `payouts` is admin-managed (like `apps`, `products`). NO RLS applied. Admin endpoints use the BYPASSRLS connection `getAdminDb()` (D-C) — NOT `setTenantContext`. Finder reads own payouts via a joined query filtered by `finder_id` over the tenant-scoped `getDb()` connection (same pattern as `commissions` finder view). | Consistent with Phase 02 admin-table pattern: "admin tables have NO RLS; `setTenantContext` MUST NEVER be called in admin domain routes." |
| D-C | Admin RLS-bypass connection (plan-brief LOCKED) | `conversions` + `commissions` are FORCE RLS. ALL admin/cross-tenant reads AND state transitions (commission approve/lock/reverse, conversion admin reads, payout create/mark-paid) run on `getAdminDb()` from `apps/api/src/db/client.ts` — a dedicated `fxl_finders_admin` (LOGIN, BYPASSRLS) connection created in Phase 01 via `ADMIN_DATABASE_URL`. Admin domain routes NEVER call `setTenantContext`. Every admin money mutation STILL writes an `audit_log` row in the same transaction. The old `commissions_update_admin ... USING(true) WITH CHECK(true)` app-role policy is DELETED (T02) — it is replaced by the BYPASSRLS admin connection, removing the cross-tenant hole where the app role could update any commission. | D-C (plan-brief LOCKED): kills the `USING(true)` cross-tenant write hole; admin runs as BYPASSRLS, not app role. |
| D10 | `conversions` + `commissions` split-RLS | Reuse Phase 04 `clicks` split-policy pattern: INSERT `WITH CHECK (true)` for webhook path (no finder JWT); SELECT `USING (org_id = current_setting(...))` for finder/admin reads. `org_id` denormalized on both tables from `finders.org_id` at conversion time. | Phase 04 plan-brief Wave 3 decisions: "Phase 05 conversion ingestion has the SAME no-JWT-on-write problem; reuse this pattern." |
| D11 | `idempotency_key` on `conversions` | `sha256(source + external_order_id + event_type)` — matches spec § 4. Set at insertion time from the webhook body field `idempotency_key` (sibling app pre-computes it per spec § 6 step 10). UNIQUE constraint is the final race guard. | Spec-prescribed. Two-level guard: `webhook_events ON CONFLICT` first (body-level), then `conversions.idempotency_key UNIQUE` (semantics-level). |

---

## Hard constraints (non-negotiable)

- **Raw body HMAC verify FIRST**: The HMAC middleware MUST read and store `rawBody` BEFORE any body parsing middleware runs. Violation = silent forgery vulnerability.
- **HMAC middleware returns a GENERIC 401 (D-O)**: For unknown-source, bad-signature, or expired-timestamp the middleware returns the SAME generic `401 { error: 'unauthorized' }` — NEVER a distinct `unknown_source` code (no source-existence oracle). Verify on the raw body BEFORE parse.
- **Admin reads + money mutations use `getAdminDb()` (D-C)**: All admin/cross-tenant `conversions`/`commissions`/`payouts` reads and state transitions run on the BYPASSRLS `getAdminDb()` connection. Admin routes NEVER call `setTenantContext`. Every admin money mutation writes an `audit_log` row in the same transaction.
- **No `setTenantContext` in webhook handler**: The `/api/v1/conversions` handler runs without a Clerk JWT. Calling `setTenantContext` would fail. RLS handled via the split-INSERT policy (D10).
- **`setTenantContext` REQUIRED in all finder reads**: Any SELECT on `conversions` or `commissions` in a finder-facing route MUST call `setTenantContext(tx, orgId)` inside the transaction (tx-scoped per D-D).
- **Payout domain is owned by Phase 05 (D-Q)**: ONE `payouts` table + `commissions.paid_payout_id` FK + `locked→paid` transition + payouts service/routes live here. Phase 06 adds only `listFindersWithLockedCommissions` + `generateCsv` + the admin payouts UI (deferred to Phase 06). NO `in_payout` status, NO `payout_batch_id` column, NO `payout_batches` table.
- **Commission auto path is `pending→locked` (D-K)**: nightly job promotes `pending → locked` WHERE `hold_until < now()` — no `approved` step. Manual "approve/lock-now" fast-track shows for `status='pending'` and also lands on `locked`.
- **Money = `int` cents**: All BRL amount columns are `integer`. `numeric(5,2)` only for rate percentages. Never `float`.
- **Realized ≠ Quoted**: Commission basis is always the `realized_*_brl` field, never `quoted_*_brl` (spec § 10).
- **Audit log is append-only**: No UPDATE or DELETE on `audit_log`. The `fxl_finders_app` role MUST have only `INSERT + SELECT` grants on `audit_log`.
- **Hash chain integrity**: Every `audit_log` INSERT must compute `entry_hash = sha256(prev_hash || canonical_json(row_without_hashes))`. Service must fetch the latest `prev_hash` INSIDE the same transaction that inserts the new row (serializable read + insert).

---

## Plan summary (14 plans across 5 waves)

| Plan | ID | Wave | Objective |
|---|---|---|---|
| P01 | `05-P01` | W1 | Drizzle schema — `conversions`, `commissions`, `payouts` tables |
| P02 | `05-P02` | W1 | RLS policies for `conversions` + `commissions` (split-INSERT pattern); `payouts` + admin-managed (no RLS) |
| P03 | `05-P03` | W1 | `commissions/service.ts` — commission calc + state machine (TDD) |
| P04 | `05-P04` | W1 | `audit/service.ts` — append-only hash-chain writer (TDD) |
| P05 | `05-P05` | W2 | `conversions/service.ts` — ingest logic (idempotency, link resolution, commission creation, audit write) (TDD) |
| P06 | `05-P06` | W2 | `conversions/routes.ts` — HMAC middleware + `POST /api/v1/conversions` + `POST /api/v1/conversions/refund` |
| P07 | `05-P07` | W2 | `sellers/clerk-webhook.ts` — Clerk `user.created` backfill via svix |
| P08 | `05-P08` | W3 | `commissions/routes.ts` — finder commission list + admin commission list + state transition endpoints |
| P09 | `05-P09` | W3 | `payouts/service.ts` + `payouts/routes.ts` (D-Q: Phase 05 OWNS the single `payouts` table + `commissions.paid_payout_id` + `locked→paid`) — payout creation (reserve) + mark-paid via `getAdminDb()`. Admin payouts UI deferred to Phase 06. |
| P10 | `05-P10` | W3 | `nightly-job.ts` — `node-cron` hold promotion (`pending→locked`, D-K) + manual admin endpoint |
| P11 | `05-P11` | W4 | `apps/web` — admin conversions list (reconciliation view) |
| P12 | `05-P12` | W4 | `apps/web` — admin commissions list with state badges |
| P13 | `05-P13` | W4 | `apps/web` — admin audit log viewer (read-only, hash-verified) |
| P14 | `05-P14` | W5 | Type-check + lint gate + RLS integration test extensions |

---

## Tasks

---

### T01 · Drizzle schema — `conversions`, `commissions`, `payouts` tables

**Plan:** `05-P01` — Wave 1
**Type:** execute
**Files:**
- `apps/api/src/db/schema.ts` (update — add `conversions`, `commissions`, `payouts` table definitions)

<read_first>
- `apps/api/src/db/schema.ts` — existing table definitions; import list; Drizzle builder patterns (`pgTable`, `uuid`, `text`, `integer`, `numeric`, `timestamp`, `boolean`, `index`, `uniqueIndex`)
- `docs/superpowers/specs/2026-05-28-fxl-finders-v1-design.md` § 4 `conversions`, `commissions`, `payouts` schemas (authoritative column list)
- `.planning/plan-brief.md` — Wave 0: money = `int` cents; rate columns = `numeric(5,2)`; FK conventions
- `.planning/phases/01-schema-foundation-clerk-auth-rls/01-PLAN.md` — existing `audit_log` + `webhook_events` already defined; do NOT redefine
- `CLAUDE.md` — money = `integer` cents; named exports; no `any`
</read_first>

<action>
Add to `apps/api/src/db/schema.ts` (do NOT touch existing `webhookEvents` or `auditLog` — they ship in Phase 01):

```
conversions table:
  id: uuid PK defaultRandom
  source: text NOT NULL (app.slug; e.g. 'fxl-financiero')
  external_order_id: text NOT NULL
  event_type: text NOT NULL DEFAULT 'sale' ('sale' | 'refund')
  idempotency_key: text UNIQUE NOT NULL (sha256(source+external_order_id+event_type))
  org_id: text NOT NULL (denormalized from finders.org_id — for RLS split-INSERT pattern, D10)
  link_id: uuid nullable FK -> referral_links(id)
  click_id: text nullable (last-touch ULID)
  finder_id: uuid NOT NULL FK -> finders(id)
  seller_id: uuid nullable FK -> sellers(id)
  app_id: uuid NOT NULL FK -> apps(id)
  product_id: uuid NOT NULL FK -> products(id)
  quoted_setup_brl: integer NOT NULL (cents — snapshot from referral_links at conversion)
  quoted_monthly_brl: integer NOT NULL (cents)
  realized_setup_brl: integer NOT NULL (cents — actual amount charged)
  realized_monthly_brl: integer NOT NULL (cents)
  customer_email_hash: text nullable (sha256(email + finder.org_id))
  customer_org_id: text nullable (Clerk org_id in the sibling app)
  hold_until: timestamptz NOT NULL (created_at + app.commission_hold_days)
  closed_at: timestamptz NOT NULL (sibling app's sale-close timestamp)
  created_at: timestamptz NOT NULL DEFAULT now()
  updated_at: timestamptz nullable
  UNIQUE(source, external_order_id, event_type)
```

```
commissions table:
  id: uuid PK defaultRandom
  conversion_id: uuid NOT NULL FK -> conversions(id)
  org_id: text NOT NULL (denormalized from conversions.org_id — for RLS split-INSERT pattern)
  finder_id: uuid NOT NULL FK -> finders(id)
  app_id: uuid NOT NULL FK -> apps(id)
  product_id: uuid NOT NULL FK -> products(id)
  kind: text NOT NULL ('setup' | 'recurring')
  basis_brl: integer NOT NULL (amount commission calculated against — realized_*_brl)
  rate_pct: numeric(5,2) NOT NULL (snapshot from commission_rules)
  amount_brl: integer NOT NULL (basis_brl * rate_pct / 100, rounded down to int cents)
  status: text NOT NULL DEFAULT 'pending' ('pending' | 'approved' | 'locked' | 'paid' | 'reversed')
  hold_until: timestamptz NOT NULL
  approved_at: timestamptz nullable
  approved_by_user_id: text nullable
  locked_at: timestamptz nullable
  paid_at: timestamptz nullable
  paid_payout_id: uuid nullable FK -> payouts(id)
  reversed_at: timestamptz nullable
  reversed_reason: text nullable
  created_at: timestamptz NOT NULL DEFAULT now()
  updated_at: timestamptz nullable
  INDEX(finder_id, status)
  INDEX(status, hold_until)
```

```
payouts table:
  id: uuid PK defaultRandom
  finder_id: uuid NOT NULL FK -> finders(id)
  total_brl: integer NOT NULL (cents)
  status: text NOT NULL DEFAULT 'draft' ('draft' | 'exported' | 'paid' | 'voided')
  csv_export_id: uuid nullable
  exported_at: timestamptz nullable
  paid_at: timestamptz nullable
  paid_by_user_id: text nullable
  note: text nullable
  created_at: timestamptz NOT NULL DEFAULT now()
  updated_at: timestamptz nullable
```

Indexes to add (Drizzle `index()` builder):
- `commissions`: `index('commissions_finder_id_status_idx').on(t.finderId, t.status)`
- `commissions`: `index('commissions_status_hold_until_idx').on(t.status, t.holdUntil)` (for nightly promotion query)
- `conversions`: `index('conversions_finder_id_created_at_idx').on(t.finderId, t.createdAt)` DESC
</action>

<acceptance_criteria>
- [ ] `conversions` exported from `schema.ts` with all columns; UNIQUE on `(source, external_order_id, event_type)`; `idempotency_key UNIQUE`
- [ ] `commissions` exported with all columns; `org_id text NOT NULL`; `rate_pct` is `numeric(5,2)` (not integer); `amount_brl` is `integer`
- [ ] `payouts` exported with all columns
- [ ] Both `conversions` and `commissions` have `org_id text NOT NULL` (split-RLS requirement per D10)
- [ ] `commissions` has INDEX on `(finder_id, status)` and INDEX on `(status, hold_until)`
- [ ] Existing `webhookEvents` and `auditLog` table definitions are NOT duplicated or modified
- [ ] All money columns are `integer` (cents); rate columns are `numeric(5,2)`
- [ ] `pnpm --filter @fxl-finders/api type-check` exits 0
</acceptance_criteria>

---

### T02 · Drizzle migration + RLS policies for `conversions`, `commissions`, `payouts`

**Plan:** `05-P01` + `05-P02` — Wave 1 (after T01)
**Type:** execute
**Files:**
- `apps/api/drizzle/` (the single generated migration for `conversions`, `commissions`, `payouts` — RLS + grants are APPENDED INTO this same journaled file per D-F; NO standalone `.sql`)

<read_first>
- `apps/api/drizzle/` — existing migration files; timestamp naming convention; Phase 04 RLS migration as pattern
- `.planning/phases/04-referral-links-signed-redirect-click-telemetry/04-PLAN.md` T03 — hand-authored RLS migration pattern to mirror exactly (role grants + FORCE ROW LEVEL SECURITY + split policies for public-write tables)
- `.planning/phases/01-schema-foundation-clerk-auth-rls/01-PLAN.md` T09–T10 — Phase 01 role grant + RLS migration pattern (original source of truth)
- `apps/api/src/db/schema.ts` — `conversions`, `commissions`, `payouts` definitions just added in T01
- `.planning/plan-brief.md` — D9: `payouts` has NO RLS (admin-managed); D10: `conversions` + `commissions` split-INSERT policy; **D-C: NO `commissions_update_admin USING(true)` policy — admin UPDATEs run on `fxl_finders_admin` (BYPASSRLS) via `getAdminDb()`; app role gets NO UPDATE on commissions; D-F: RLS SQL appended into a journaled migration (see Phase 01 pattern)**
- `.planning/phases/01-schema-foundation-clerk-auth-rls/01-PLAN.md` — `fxl_finders_admin` BYPASSRLS role + `ADMIN_DATABASE_URL` (D-C); RLS-into-journaled-migration pattern (D-F)
</read_first>

<action>
Step 1 — Generate migration:
Run `pnpm --filter @fxl-finders/api db:generate`. This emits a SQL migration with `CREATE TABLE conversions`, `CREATE TABLE commissions`, `CREATE TABLE payouts`.

Step 2 — Append DB role grants to the generated migration:
```sql
-- Phase 05 role grants
-- App role (fxl_finders_app) — RLS-enforced, finder/webhook path only:
GRANT SELECT, INSERT ON conversions TO fxl_finders_app;      -- no UPDATE (append-only for webhook path)
GRANT SELECT, INSERT ON commissions TO fxl_finders_app;      -- D-C: NO UPDATE — admin state transitions run on getAdminDb() (BYPASSRLS), not the app role
GRANT SELECT ON payouts TO fxl_finders_app;                  -- finder reads own payouts; INSERT/UPDATE happen on getAdminDb()
GRANT SELECT, INSERT ON audit_log TO fxl_finders_app;        -- append-only; re-assert here if Phase 01 grants were omitted

-- Admin role (fxl_finders_admin, BYPASSRLS — created in Phase 01 per D-C) — cross-tenant admin path:
GRANT SELECT, INSERT, UPDATE ON conversions TO fxl_finders_admin;
GRANT SELECT, INSERT, UPDATE ON commissions TO fxl_finders_admin;  -- lock/reverse/promote state transitions
GRANT SELECT, INSERT, UPDATE ON payouts TO fxl_finders_admin;       -- payout create + mark-paid
GRANT SELECT, INSERT ON audit_log TO fxl_finders_admin;             -- admin money-mutation audit rows (append-only)
```
NOTE (D-C): if Phase 01 created `fxl_finders_admin` with `BYPASSRLS`, these GRANTs make admin DML possible while RLS is bypassed. The app role intentionally LACKS UPDATE on `commissions`/`payouts` so the cross-tenant write hole is closed at the privilege layer too.

Step 3 — APPEND the RLS policies INTO THE SAME generated migration file from Step 1 (D-F — mirror Phase 01 T09–T10 and Phase 04 T03). Do **NOT** create a standalone `<ts>_phase05_rls.sql`: Drizzle's migrator (`migrate(db, { migrationsFolder: './drizzle' })`) only runs files registered in `drizzle/meta/_journal.json`; a bare standalone `.sql` dropped into `drizzle/` is silently skipped and the RLS policies would never be applied. Append this block to the end of the Step-1 generated migration (after the role grants from Step 2):
```sql
-- Phase 05 RLS: conversions + commissions (split-INSERT pattern)
-- payouts: NO RLS (admin-managed cross-tenant, consistent with apps/products/price_bands)
-- Runs as fxl_finders_owner. Runtime role: fxl_finders_app.

-- ── conversions ─────────────────────────────────────────────────────
ALTER TABLE conversions ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversions FORCE ROW LEVEL SECURITY;

-- INSERT path: webhook handler (no JWT, no tenant context) → allow all inserts
CREATE POLICY conversions_insert_webhook ON conversions
  AS PERMISSIVE FOR INSERT TO fxl_finders_app
  WITH CHECK (true);

-- SELECT path: finder reads own conversions; admin reads bypass RLS via the
-- fxl_finders_admin (BYPASSRLS) connection / getAdminDb() (D-C), NOT a policy.
CREATE POLICY conversions_select_tenant ON conversions
  AS PERMISSIVE FOR SELECT TO fxl_finders_app
  USING (org_id = current_setting('app.current_org_id', true));

-- ── commissions ─────────────────────────────────────────────────────
ALTER TABLE commissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE commissions FORCE ROW LEVEL SECURITY;

-- INSERT path: commission creation runs inside webhook handler (no JWT)
CREATE POLICY commissions_insert_webhook ON commissions
  AS PERMISSIVE FOR INSERT TO fxl_finders_app
  WITH CHECK (true);

-- SELECT path: finder reads own commissions. Admin state transitions run on the
-- fxl_finders_admin (BYPASSRLS) connection via getAdminDb() (D-C) — NOT the app role.
CREATE POLICY commissions_tenant ON commissions
  AS PERMISSIVE FOR SELECT TO fxl_finders_app
  USING (org_id = current_setting('app.current_org_id', true));

-- D-C (LOCKED): NO `commissions_update_admin ... USING(true) WITH CHECK(true)` policy.
-- The previous app-role UPDATE-all policy was a cross-tenant write hole. Admin commission
-- UPDATEs (lock/reverse) now run on the BYPASSRLS getAdminDb() connection (fxl_finders_admin),
-- which is not subject to RLS. The fxl_finders_app role gets NO UPDATE policy on commissions,
-- so the app role cannot mutate commissions at all (defence in depth).
-- (Do NOT GRANT/POLICY a wildcard UPDATE to fxl_finders_app — see T02 GRANT step.)

-- ── leads (D-L: webhook-path INSERT) ────────────────────────────────
-- D-L makes ingestConversion INSERT a leads PII row from the webhook path (no JWT, no
-- tenant context). If Phase 01 gave `leads` a tenant-only INSERT policy, the webhook INSERT
-- would be blocked. Add a split-INSERT policy mirroring conversions/commissions so the
-- app role can insert the converted-lead row without a JWT. (SELECT stays tenant-scoped —
-- do NOT widen finder visibility.) If Phase 01 already ships an equivalent
-- `leads_insert_webhook WITH CHECK (true)` policy, SKIP this block (idempotent — guard with
-- a DROP POLICY IF EXISTS / CREATE, or document the dependency in the executor note).
DROP POLICY IF EXISTS leads_insert_webhook ON leads;
CREATE POLICY leads_insert_webhook ON leads
  AS PERMISSIVE FOR INSERT TO fxl_finders_app
  WITH CHECK (true);
-- (leads SELECT tenant policy is owned by Phase 01; do not redefine it here.)
GRANT INSERT ON leads TO fxl_finders_app;   -- re-assert; needed for the webhook converted-lead row (D-L)

-- ── payouts ──────────────────────────────────────────────────────────
-- NO RLS on payouts — admin-managed cross-tenant (same as apps, products, commission_rules)
-- Admin endpoints use the fxl_finders_admin BYPASSRLS connection (getAdminDb(), D-C).
-- Finder reads own payouts via explicit WHERE finder_id = $finderId on the app connection.
-- No ENABLE ROW LEVEL SECURITY on payouts in v1.0
```
</action>

<acceptance_criteria>
- [ ] `pnpm --filter @fxl-finders/api db:generate` exits 0; migration contains `CREATE TABLE conversions`, `CREATE TABLE commissions`, `CREATE TABLE payouts`
- [ ] Generated migration includes `GRANT SELECT, INSERT ON conversions TO fxl_finders_app`
- [ ] Generated migration includes `GRANT SELECT, INSERT ON commissions TO fxl_finders_app` (NO `UPDATE` to the app role — D-C)
- [ ] Generated migration includes `GRANT ... ON commissions TO fxl_finders_admin` (BYPASSRLS admin role gets `SELECT, INSERT, UPDATE` — D-C)
- [ ] Generated migration includes `GRANT SELECT, INSERT ON audit_log TO fxl_finders_app` AND to `fxl_finders_admin`
- [ ] RLS + policy SQL is APPENDED INTO the Step-1 generated (journaled) migration file — NO standalone `<ts>_phase05_rls.sql` exists (D-F): `ls apps/api/drizzle/*phase05_rls*.sql` returns nothing
- [ ] After `pnpm --filter @fxl-finders/api db:migrate`, `SELECT tablename, policyname FROM pg_policies WHERE tablename IN ('conversions','commissions','leads')` returns the `*_insert_webhook` + `*_select_tenant`/`*_tenant` policies (proves the journaled migration actually ran the RLS SQL)
- [ ] `FORCE ROW LEVEL SECURITY` applied to `conversions` + `commissions`; NOT applied to `payouts`
- [ ] `conversions` has split policies: `FOR INSERT WITH CHECK (true)` + `FOR SELECT USING (org_id = ...)`
- [ ] `commissions` has split policies: `FOR INSERT WITH CHECK (true)` + `FOR SELECT USING (org_id = ...)` ONLY — there is NO `commissions_update_admin ... USING(true) WITH CHECK(true)` policy (D-C: REMOVED; admin UPDATE goes through BYPASSRLS connection)
- [ ] `grep -n "USING (true)" apps/api/drizzle/<the-generated-migration>.sql` returns ZERO matches on any UPDATE policy for `commissions` (D-C verification)
- [ ] `leads` has a `leads_insert_webhook ... WITH CHECK (true)` INSERT policy so the D-L webhook PII row can be inserted without a JWT (or Phase 01 already ships an equivalent — documented dependency); `leads` SELECT stays tenant-scoped
- [ ] `payouts` has no `ENABLE ROW LEVEL SECURITY` statement
- [ ] `pnpm --filter @fxl-finders/api type-check` exits 0
</acceptance_criteria>

---

### T03 · `commissions/service.ts` — commission calc + state machine (TDD)

**Plan:** `05-P03` — Wave 1
**Type:** tdd
**Files:**
- `apps/api/src/domains/commissions/service.ts` (new)
- `apps/api/src/domains/commissions/__tests__/service.test.ts` (new — TDD, RED first)

<read_first>
- `docs/superpowers/specs/2026-05-28-fxl-finders-v1-design.md` § 4 `commissions` schema; § 6 steps 11+13 (commission calc + hold→lock lifecycle); § 10 (realized vs quoted semantics)
- `apps/api/src/db/schema.ts` — `commissions`, `conversions`, `commissionRules` column names (T01 + Phase 01)
- `.planning/plan-brief.md` — **D-K (commission lifecycle: `pending→locked`, no `approved` auto step), D-C (`getAdminDb()` for admin reads + state transitions + audit on every money mutation), D-D (`setTenantContext(tx, orgId)` tx-scoped), D-H (`getDb()`/`getAdminDb()` from `db/client.ts`)**; Wave 0: `commission_rules` schema: `setup_rate_pct`, `recurring_rate_pct`, `recurring_months`; D4, D6, D7 decisions; Wave 4 failure-list: Drizzle `numeric` returns string
- `apps/api/src/db/client.ts` — `getDb()` (lazy, RLS) + `getAdminDb()` (BYPASSRLS, Phase 01 per D-C)
- `.planning/phases/01-schema-foundation-clerk-auth-rls/01-PLAN.md` — `setTenantContext(tx, orgId)` tx-scoped export signature (D-D)
- `apps/api/src/domains/audit/service.ts` — `writeAuditEntry` (T04) — called for every admin money mutation
- `CLAUDE.md` — named exports; strict TypeScript; no `any`; Zod schemas in service.ts
</read_first>

<action>
**TDD sequence: write all tests FIRST, run them (RED), then implement (GREEN).**

Create `apps/api/src/domains/commissions/__tests__/service.test.ts` with these test cases:

1. `calculateSetupCommission(realizedSetupBrl, setupRatePct)`:
   - `calculateSetupCommission(100000, 30.00)` → `30000` (R$1000 * 30% = R$300)
   - **`calculateSetupCommission(100000, '30.00')` → `30000` (rate passed as STRING — Drizzle `numeric(5,2)` returns string; `Number(setupRatePct)` coercion MUST yield correct integer)** (WARN TDD — plan-brief Wave 4 failure-list)
   - `calculateSetupCommission(80000, 25.50)` → `20400` (R$800 * 25.5% = R$204)
   - `calculateSetupCommission(80000, '25.50')` → `20400` (string rate, same assertion)
   - `calculateSetupCommission(0, 30.00)` → `0` (zero realized → zero commission)
   - `calculateSetupCommission(100001, 30.00)` → `30000` (floor: Math.floor(100001 * 30 / 100) = 30000)
   - Returns integer (not float)

2. `calculateRecurringCommission(realizedMonthlyBrl, recurringRatePct, recurringMonths)`:
   - `calculateRecurringCommission(10700, 20.00, 12)` → `25680` (R$107 * 20% * 12 = R$256.80 → 25680 cents)
   - **`calculateRecurringCommission(10700, '20.00', 12)` → `25680` (rate passed as STRING from Drizzle `numeric`; `Number(recurringRatePct)` MUST yield correct integer)** (WARN TDD)
   - `calculateRecurringCommission(10700, 20.00, 0)` → `0` (recurring_months=0 means no recurring commission)
   - `calculateRecurringCommission(0, 20.00, 12)` → `0` (zero realized → zero)
   - Returns integer

3. `isValidTransition(from: CommissionStatus, to: CommissionStatus)` — **D-K auto path is `pending→locked→paid→(reversed)`; NO `approved` auto step. Manual approve/lock-now is a `pending→locked` fast-track**:
   - `isValidTransition('pending', 'locked')` → `true` (auto path AND manual fast-track — D-K)
   - `isValidTransition('locked', 'paid')` → `true`
   - `isValidTransition('paid', 'reversed')` → `true`
   - `isValidTransition('pending', 'reversed')` → `true`
   - `isValidTransition('locked', 'reversed')` → `true`
   - `isValidTransition('pending', 'paid')` → `false` (must lock first)
   - `isValidTransition('locked', 'pending')` → `false` (backwards)
   - `isValidTransition('paid', 'locked')` → `false` (backwards)
   - `isValidTransition('reversed', 'pending')` → `false` (terminal state)
   - `isValidTransition('reversed', 'locked')` → `false` (terminal state)
   - NOTE: the `approved` enum value still exists for forward-compat but is NOT produced by the v1.0 auto path; do not write tests asserting any `*→approved` transition is valid.

4. `buildCommissionRows(conversion, commissionRule)`:
   - When `realized_setup_brl > 0` → includes a setup row with correct `basis_brl`, `rate_pct`, `amount_brl`
   - When `realized_setup_brl === 0` → does NOT include setup row
   - When `recurring_months > 0` and `realized_monthly_brl > 0` → includes recurring row
   - When `recurring_months === 0` → does NOT include recurring row
   - When `realized_monthly_brl === 0` and `recurring_months > 0` → does NOT include recurring row (zero commission check)
   - Returns array of commission-row objects (never undefined — empty array for zero-amount conversion)

Then implement `apps/api/src/domains/commissions/service.ts`:

Zod schemas (named exports):
- `CommissionStatusSchema`: `z.enum(['pending', 'approved', 'locked', 'paid', 'reversed'])`
- `ApproveCommissionSchema`: `z.object({ commissionId: z.string().uuid(), approvedByUserId: z.string() })`
- `ReverseCommissionSchema`: `z.object({ commissionId: z.string().uuid(), reason: z.string().min(1) })`

Types:
- `CommissionStatus`: inferred from `CommissionStatusSchema`

Pure functions (named exports):
- `calculateSetupCommission(realizedSetupBrl: number, setupRatePct: number | string): number` — `Math.floor(realizedSetupBrl * Number(setupRatePct) / 100)`. **`setupRatePct` param type accepts `number | string` because Drizzle `numeric(5,2)` columns return STRINGS in Node; `Number()` coercion is mandatory (WARN TDD).**
- `calculateRecurringCommission(realizedMonthlyBrl: number, recurringRatePct: number | string, recurringMonths: number): number` — `recurringMonths === 0 || realizedMonthlyBrl === 0 ? 0 : Math.floor(realizedMonthlyBrl * Number(recurringRatePct) / 100 * recurringMonths)`. Same `number | string` rate param.
- `isValidTransition(from: CommissionStatus, to: CommissionStatus): boolean` — **D-K transition table: allowed = `pending→locked`, `locked→paid`, and `from→reversed` for `from ∈ {pending, locked, paid}`; `reversed` is terminal (no outbound). NO `*→approved` and NO `approved→*` transition is produced by v1.0 logic.**
- `buildCommissionRows(conversion: ConversionRow, rule: CommissionRuleRow, holdUntil: Date): CommissionInsertRow[]` — applies D4: skip zero-amount rows. New rows start at `status='pending'` with `hold_until=holdUntil`.

DB functions (named exports):
- `getCommissionsByFinder(tx, orgId: string, finderId: string): Promise<CommissionRow[]>` — runs inside `db.transaction(async (tx) => { await setTenantContext(tx, orgId); ... })` (tx-scoped per D-D); SELECT WHERE `finder_id = $finderId` ORDER BY `created_at DESC`
- `getCommissionsAdmin(adminDb, filters?: { status?: CommissionStatus; finderId?: string }): Promise<CommissionRow[]>` — **uses `getAdminDb()` (BYPASSRLS, D-C); NO `setTenantContext`**; `SELECT * FROM commissions WHERE (status = $status OR $status IS NULL) AND (finder_id = $finderId OR $finderId IS NULL) ORDER BY created_at DESC`
- `lockCommission(adminDb, commissionId: string, actorUserId: string): Promise<CommissionRow>` — **manual "approve / lock-now" fast-track for `status='pending'` (D-K)**. Inside one tx on `getAdminDb()`: SELECT current row; validate `isValidTransition(current.status, 'locked')` (only `pending→locked`); UPDATE `status='locked', locked_at=now()` (record `actorUserId` in the audit row, not a column); throw `Error('invalid_transition')` if invalid; **write `audit_log` (`commission.approve` action, before/after JSONB) in the SAME tx (D-C admin-money-mutation rule)**.
- `promoteHoldExpired(adminDb): Promise<number>` — **D-K auto path**: `UPDATE commissions SET status='locked', locked_at=now() WHERE status='pending' AND hold_until < now() RETURNING id`; returns count of promoted rows. Runs on `getAdminDb()` (cross-tenant nightly job, no JWT). (NOTE: the old `WHERE status='approved'` is REMOVED — fresh commissions are `pending`, so this is what makes a freshly-ingested commission reach `locked` after the hold with NO manual action.)
- `reverseCommission(adminDb, commissionId: string, reason: string, actorUserId: string): Promise<CommissionRow>` — runs on `getAdminDb()` in one tx. If `status='paid'`: INSERT a new negative-amount commission row with `kind=original.kind`, `amount_brl = -original.amount_brl`, `status='reversed'`, `reversed_reason=reason`, `reversed_at=now()`, `org_id=original.org_id`; the original row is NOT mutated. If `status` in `['pending','locked']`: UPDATE original row `status='reversed', reversed_at=now(), reversed_reason`. Always writes an `audit_log` row (`commission.reverse`) in the SAME tx (D-C). Throws `Error('invalid_transition')` if current status is `'reversed'`.

NOTE: there is NO `approveCommission` function in v1.0 — the former `approveCommission` is replaced by `lockCommission` (manual fast-track `pending→locked`). Do not add a `pending→approved` mutation.
</action>

<acceptance_criteria>
- [ ] `apps/api/src/domains/commissions/__tests__/service.test.ts` exists; all tests written BEFORE implementation (RED phase documented in commit message or comments)
- [ ] `calculateSetupCommission` — all test cases pass including the STRING-rate cases (`'30.00'`, `'25.50'`); returns `integer` (WARN TDD)
- [ ] `calculateRecurringCommission` — all test cases pass including the STRING-rate case (`'20.00'`); returns `integer`; `recurring_months=0` → `0` (WARN TDD)
- [ ] `isValidTransition` — all D-K test cases pass: `pending→locked` is `true`; `pending→paid` is `false`; `reversed` is terminal; NO `*→approved` asserted valid
- [ ] `buildCommissionRows` — 6 test cases pass; empty array for zero-realized conversion; no zero-amount rows; new rows start `status='pending'`
- [ ] `lockCommission` (manual fast-track) allows `pending→locked` and throws `Error('invalid_transition')` for any non-`pending` source
- [ ] `promoteHoldExpired` updates `WHERE status='pending' AND hold_until < now()` (NOT `'approved'`) — TDD/integration asserts a freshly-ingested `pending` commission reaches `'locked'` after `hold_until` passes with NO manual action
- [ ] NO `approveCommission` function exists; the `approved` enum value is never written by v1.0 code
- [ ] `reverseCommission` inserts a NEW negative row when `status='paid'` (immutable audit trail) and writes an `audit_log` row in the same tx
- [ ] `lockCommission` + `reverseCommission` each write an `audit_log` row in the SAME transaction (D-C admin-money-mutation rule)
- [ ] `getCommissionsByFinder` runs inside `db.transaction` with tx-scoped `setTenantContext(tx, orgId)` (D-D)
- [ ] `getCommissionsAdmin`, `lockCommission`, `promoteHoldExpired`, `reverseCommission` use `getAdminDb()` (BYPASSRLS) and do NOT call `setTenantContext` (D-C)
- [ ] `pnpm --filter @fxl-finders/api test` (unit project) passes including all new tests
- [ ] `pnpm --filter @fxl-finders/api type-check` exits 0
- [ ] Named exports only; no `any`; Zod schemas exported
</acceptance_criteria>

---

### T04 · `audit/service.ts` — append-only hash-chain writer (TDD)

**Plan:** `05-P04` — Wave 1
**Type:** tdd
**Files:**
- `apps/api/src/domains/audit/service.ts` (new)
- `apps/api/src/domains/audit/__tests__/service.test.ts` (new — TDD, RED first)

<read_first>
- `docs/superpowers/specs/2026-05-28-fxl-finders-v1-design.md` § 4 `audit_log` schema (authoritative column list including `prev_hash`, `entry_hash`, `actor_user_id='system'`)
- `apps/api/src/db/schema.ts` — `auditLog` table definition (Phase 01 — verify column names match spec)
- `.planning/phases/01-schema-foundation-clerk-auth-rls/01-PLAN.md` — `audit_log` ships in Phase 01; do NOT redefine
- `.planning/plan-brief.md` — D7: `canonical_json = JSON.stringify(obj, Object.keys(obj).sort())`; D8: first-row `prev_hash = '0'.repeat(64)`
- `CLAUDE.md` — named exports; strict TypeScript; no `any`
</read_first>

<action>
**TDD sequence: write all tests FIRST (RED), then implement (GREEN).**

Create `apps/api/src/domains/audit/__tests__/service.test.ts`:

1. `canonicalJson(obj)`:
   - `canonicalJson({ b: 2, a: 1 })` → `'{"a":1,"b":2}'` (alphabetical key order)
   - `canonicalJson({ a: 1, b: 2 })` → `'{"a":1,"b":2}'` (same for already-sorted)
   - `canonicalJson({ z: null, a: 'x' })` → `'{"a":"x","z":null}'`
   - `canonicalJson({})` → `'{}'`

2. `computeEntryHash(prevHash, rowWithoutHashes)`:
   - Returns a 64-char hex string (SHA-256)
   - Is deterministic: same inputs → same output
   - Changes when `prevHash` changes
   - Changes when `rowWithoutHashes` changes (any field)
   - First-row convention: `computeEntryHash('0'.repeat(64), row)` returns consistent value

3. `verifyChain(entries)` (for audit log integrity verification):
   - `verifyChain([])` → `{ valid: true, brokenAt: null }`
   - Single-entry chain with correct hash → `{ valid: true, brokenAt: null }`
   - Two-entry chain where entry[1].prev_hash === entry[0].entry_hash → `{ valid: true }`
   - Two-entry chain where entry[1].prev_hash !== entry[0].entry_hash → `{ valid: false, brokenAt: 1 }`
   - Chain with tampered `entry_hash` → `{ valid: false, brokenAt: N }`

Then implement `apps/api/src/domains/audit/service.ts`:

Types:
- `AuditAction`: `z.enum(['conversion.recorded', 'commission.created', 'commission.approve', 'commission.reverse', 'payout.mark_paid'])`

Pure functions (named exports):
- `canonicalJson(obj: Record<string, unknown>): string` — `JSON.stringify(obj, Object.keys(obj).sort())`
- `computeEntryHash(prevHash: string, rowWithoutHashes: Record<string, unknown>): string` — `crypto.createHash('sha256').update(prevHash + canonicalJson(rowWithoutHashes)).digest('hex')`
- `verifyChain(entries: AuditLogRow[]): { valid: boolean; brokenAt: number | null }` — for each entry, recompute `entry_hash` and assert it matches; assert `entry.prev_hash === entries[i-1].entry_hash` for `i > 0`

DB function (named export):
- `writeAuditEntry(db, entry: { actorUserId: string; actorOrgId?: string; action: AuditAction; entityType: string; entityId: string; beforeJsonb?: unknown; afterJsonb?: unknown; requestId?: string }): Promise<AuditLogRow>` — MUST run inside a serializable transaction:
  1. `SELECT entry_hash FROM audit_log ORDER BY id DESC LIMIT 1 FOR UPDATE` — get latest `prev_hash` (or `'0'.repeat(64)` if table empty). Use `FOR UPDATE` to serialize concurrent writes.
  2. Build row object WITHOUT `entry_hash` (for canonical hash input): `{ ts, actor_user_id, actor_org_id, action, entity_type, entity_id, before_jsonb, after_jsonb, request_id, prev_hash }`
  3. Compute `entry_hash = computeEntryHash(prevHash, rowWithoutHashes)`
  4. INSERT `audit_log` with all fields including `entry_hash`
  5. Return inserted row
  6. If called from webhook handler: `actorUserId = 'system'`
</action>

<acceptance_criteria>
- [ ] `canonicalJson` — 4 test cases pass; alphabetical key sort; no whitespace
- [ ] `computeEntryHash` — deterministic; 64-char hex; changes on any input change; first-row convention works
- [ ] `verifyChain` — 5 test cases pass including tampered-hash detection
- [ ] `writeAuditEntry` uses `FOR UPDATE` on the `audit_log` tail row to serialize concurrent inserts
- [ ] `writeAuditEntry` uses `'0'.repeat(64)` as `prev_hash` when `audit_log` is empty
- [ ] `writeAuditEntry` does NOT call `setTenantContext` (audit_log is cross-tenant append-only)
- [ ] `actor_user_id = 'system'` accepted (string — not a UUID constraint)
- [ ] `pnpm --filter @fxl-finders/api test` passes all new tests
- [ ] `pnpm --filter @fxl-finders/api type-check` exits 0
- [ ] Named exports only; no `any`
</acceptance_criteria>

---

### T05 · `conversions/service.ts` — ingest logic (TDD)

**Plan:** `05-P05` — Wave 2 (after T01–T04)
**Type:** tdd
**Files:**
- `apps/api/src/domains/conversions/service.ts` (new)
- `apps/api/src/domains/conversions/__tests__/service.test.ts` (new — TDD, RED first)

<read_first>
- `docs/superpowers/specs/2026-05-28-fxl-finders-v1-design.md` § 6 steps 9–11 (full ingest flow); § 9 (LGPD `leads` PII deliverable); § 10 (realized vs quoted)
- `apps/api/src/db/schema.ts` — `conversions`, `commissions`, `webhookEvents`, `clicks`, `referralLinks`, `commissionRules`, `apps`, `finders`, `sellers`, **`leads`** column names
- `apps/api/src/domains/commissions/service.ts` — `buildCommissionRows`, `calculateSetupCommission`, `calculateRecurringCommission` (T03)
- `apps/api/src/domains/audit/service.ts` — `writeAuditEntry`, `AuditAction` (T04)
- `.planning/plan-brief.md` — **D-L (ingestConversion completeness: snapshot quoted_* from referral_links, compute customer_email_hash, INSERT leads PII row, receive rawBodyHash param); D-M (webhook body adds `finder_code` + `customer_name/phone/cpf`; attribution fallback via finder_code else `attribution_not_found` 4xx)**; D11: idempotency_key formula; D4: realized basis; attribution window = `app.attribution_window_days`
- `.planning/phases/01-schema-foundation-clerk-auth-rls/01-PLAN.md` — `leads` table columns (status, link_id, click_id, PII cols) + `leads.org_id`
- `CLAUDE.md` — named exports; strict TypeScript; no `any`; Zod schemas
</read_first>

<action>
**TDD sequence: write all tests FIRST (RED), then implement (GREEN).**

Create `apps/api/src/domains/conversions/__tests__/service.test.ts`:

1. `resolveAttribution(clicks, closedAt, attributionWindowDays)`:
   - Returns `click` with most recent `created_at` within `attributionWindowDays` before `closedAt`
   - Returns `null` if no clicks within window
   - Returns `null` if `clicks` array is empty
   - Returns the most recent click when multiple clicks exist within window
   - Boundary: click exactly at `closedAt - attributionWindowDays` is included (inclusive window start)

2. `buildIdempotencyKey(source, externalOrderId, eventType)`:
   - Returns a 64-char hex string (SHA-256)
   - Deterministic: same inputs → same output
   - Changes when any input changes

3. `parseWebhookBody` (Zod validation) — **D-M body contract (ONE field set, identical to Phase 06 sender)**:
   - Valid body passes: `{ source, external_order_id, event_type, idempotency_key, click_id (nullable), finder_code (optional), seller_clerk_id (nullable), customer_email, customer_name, customer_phone, customer_cpf, customer_org_id, realized_setup_brl, realized_monthly_brl, closed_at }`
   - Valid body with `click_id: null` + `finder_code: 'ABC123'` passes (finder_code fallback path)
   - Valid body with both `click_id` and `finder_code` omitted/null still passes Zod (attribution failure is resolved at ingest time, NOT by Zod)
   - Missing required fields → throws ZodError
   - `event_type` not in `['sale', 'refund']` → throws ZodError
   - `realized_setup_brl` negative → throws ZodError (must be `z.number().int().nonnegative()`)
   - `customer_name` / `customer_phone` / `customer_cpf` present and stored (PII for the `leads` row, D-L)

Then implement `apps/api/src/domains/conversions/service.ts`:

Zod schemas (named exports):
- `WebhookBodySchema` — **D-M ONE field set (must byte-match Phase 06 sender)**:
  ```typescript
  export const WebhookBodySchema = z.object({
    source: z.string().min(1),
    external_order_id: z.string().min(1),
    event_type: z.enum(['sale', 'refund']),
    idempotency_key: z.string().min(1),
    click_id: z.string().nullable(),
    finder_code: z.string().optional(),          // D-M attribution fallback
    seller_clerk_id: z.string().nullable(),
    customer_email: z.string().email(),
    customer_name: z.string().min(1),            // D-L leads PII
    customer_phone: z.string().nullable(),       // D-L leads PII
    customer_cpf: z.string().nullable(),         // D-L leads PII
    customer_org_id: z.string().nullable(),
    realized_setup_brl: z.number().int().nonnegative(),
    realized_monthly_brl: z.number().int().nonnegative(),
    closed_at: z.string().datetime(),            // ISO 8601; parsed to Date in service
  })
  ```
- `RefundBodySchema`: `{ conversion_id: z.string().uuid(), reason: z.string().min(1) }`

Types: `WebhookBody` inferred from `WebhookBodySchema`

Pure functions (named exports):
- `resolveAttribution(clicks: ClickRow[], closedAt: Date, attributionWindowDays: number): ClickRow | null` — find most recent click where `click.created_at >= closedAt - attributionWindowDays days`
- `buildIdempotencyKey(source: string, externalOrderId: string, eventType: string): string` — `crypto.createHash('sha256').update(source + externalOrderId + eventType).digest('hex')`
- `hashCustomerEmail(email: string, orgId: string): string` — `crypto.createHash('sha256').update(email + orgId).digest('hex')`

DB function (named export):
- `ingestConversion(db, body: WebhookBody, rawBodyHash: string): Promise<{ conversion: ConversionRow; commissions: CommissionRow[]; isDuplicate: boolean }>`:

  **D-L: `rawBodyHash` is passed IN by the route handler (T06) because the service never sees the raw HMAC body. It is stored verbatim in `webhook_events.body_hash` — the service must NOT recompute a hash of the parsed/re-serialized body.** Runs on `getDb()` (the conversion + commission INSERT paths are covered by the split `WITH CHECK (true)` policies; webhook path has no JWT so NO `setTenantContext`).

  Full ingest flow (runs in a single DB transaction):

  1. **Webhook dedup** (step 1 of two-level guard): `INSERT INTO webhook_events (source, event_id, body_hash, signature_valid, processed_at) VALUES ($source, $body.idempotency_key, $rawBodyHash, true, now()) ON CONFLICT (source, event_id) DO NOTHING RETURNING id` — uses the passed-in `rawBodyHash` (D-L), NOT a recomputed hash. If `RETURNING` returns no row → return `{ isDuplicate: true, conversion: null, commissions: [] }`.

  2. **Resolve app**: `SELECT * FROM apps WHERE slug = $body.source AND status = 'active'` — throw `Error('app_not_found')` if not found.

  3. **Resolve attribution (D-M two-step + hard fail)**:
     a. If `body.click_id` non-null → `SELECT * FROM clicks WHERE click_id = $body.click_id`. If found AND `click.created_at >= body.closed_at - app.attribution_window_days days` → resolve `link_id = click.link_id`, `click_id = body.click_id`.
     b. Else if `body.finder_code` provided → `SELECT * FROM referral_links WHERE finder_code = $body.finder_code` (or resolve finder by code per Phase 04 link model) → resolve `finder_id`/`link_id` from that link; `click_id = null`.
     c. Else → **throw `Error('attribution_not_found')`** — the route returns 4xx (422) so financeiro retries/alerts. NEVER silently drop or insert with null finder (D-M).

  4. **Resolve link, finder, quoted snapshot (D-L)**: From the resolved `referral_links` row, read `link.finder_id`, `link.app_id`, `link.product_id`, and **snapshot `quoted_setup_brl = link.quoted_setup_brl` and `quoted_monthly_brl = link.quoted_monthly_brl` INTO the conversions row** (these are the quoted amounts pinned at link-creation time, NOT recomputed). Load `finders` row by `link.finder_id` (need `org_id`).

  5. **Resolve seller**: If `body.seller_clerk_id` non-null → `SELECT id FROM sellers WHERE clerk_user_id = $body.seller_clerk_id` — store as `seller_id` (nullable if not found; log warning but do NOT block conversion).

  6. **Resolve commission rules**: `SELECT * FROM commission_rules WHERE product_id = $link.product_id` — throw `Error('commission_rules_not_found')` if not found.

  7. **Compute customer_email_hash (D-L)**: `customer_email_hash = hashCustomerEmail(body.customer_email, finder.org_id)` — store on the conversions row.

  8. **Insert conversion** (step 2 of two-level idempotency guard — UNIQUE on `idempotency_key`). Include `quoted_setup_brl`, `quoted_monthly_brl` (snapshot from step 4), `customer_email_hash` (step 7), `org_id = finder.org_id`:
     ```sql
     INSERT INTO conversions (...) VALUES (...) ON CONFLICT (idempotency_key) DO NOTHING RETURNING *
     ```
     If `RETURNING` returns no row → duplicate at conversion level → return `{ isDuplicate: true }`.

  9. **Insert leads PII row (D-L / LGPD §9 deliverable)**: `INSERT INTO leads (org_id, finder_id, link_id, click_id, status, customer_name, customer_email, customer_phone, customer_cpf, ...) VALUES (finder.org_id, finder_id, link_id, click_id, 'converted', body.customer_name, body.customer_email, body.customer_phone, body.customer_cpf, ...)`. This is the canonical PII landing row; the conversions row stores only the hash. (Reuse the `leads` table shipped in Phase 01.)

  10. **Build + insert commission rows**: Call `buildCommissionRows(conversion, rule, holdUntil)` where `holdUntil = new Date(Date.now() + app.commission_hold_days * 86400000)`. Insert each non-zero row, `status='pending'` (D-K). Set `org_id = finder.org_id` on each commission row.

  11. **Write audit entries** (actor='system'):
     - `writeAuditEntry(db, { actorUserId: 'system', action: 'conversion.recorded', entityType: 'conversion', entityId: conversion.id, afterJsonb: conversion })`
     - For each commission: `writeAuditEntry(db, { actorUserId: 'system', action: 'commission.created', entityType: 'commission', entityId: commission.id, afterJsonb: commission })`

  12. Return `{ conversion, commissions, isDuplicate: false }`.
</action>

<acceptance_criteria>
- [ ] `resolveAttribution` — 5 test cases pass; inclusive window boundary
- [ ] `buildIdempotencyKey` — deterministic; 64-char hex
- [ ] `parseWebhookBody` — valid + invalid test cases pass via Zod; schema includes `finder_code` (optional) + `customer_name`/`customer_phone`/`customer_cpf` (D-M)
- [ ] `ingestConversion(db, body, rawBodyHash)` accepts a `rawBodyHash` param and stores it verbatim in `webhook_events.body_hash` (D-L — does NOT recompute from the parsed body)
- [ ] `ingestConversion` snapshots `quoted_setup_brl` + `quoted_monthly_brl` from the resolved `referral_links` row into the conversions row (D-L)
- [ ] `ingestConversion` computes + stores `customer_email_hash = hashCustomerEmail(email, finder.org_id)` (D-L)
- [ ] `ingestConversion` INSERTs a `leads` row with `status='converted'` and the body PII (`customer_name`/`email`/`phone`/`cpf`) in the same tx (D-L / LGPD §9)
- [ ] Attribution: `click_id` resolves the link in-window; else `finder_code` fallback resolves the finder; else throws `Error('attribution_not_found')` (NO silent drop, NO null-finder insert) (D-M)
- [ ] `ingestConversion` returns `{ isDuplicate: true }` when `webhook_events ON CONFLICT DO NOTHING` returns no row
- [ ] `ingestConversion` returns `{ isDuplicate: true }` when `conversions ON CONFLICT (idempotency_key) DO NOTHING` returns no row
- [ ] Commission rows have `org_id` set from `finder.org_id` and start `status='pending'` (D-K)
- [ ] Zero-realized-amount commission components are NOT inserted (D4 from T03)
- [ ] `writeAuditEntry` called with `actorUserId: 'system'` for both `conversion.recorded` + `commission.created`
- [ ] `setTenantContext` NOT called anywhere in `ingestConversion` (webhook path, no JWT)
- [ ] `pnpm --filter @fxl-finders/api test` passes all new tests
- [ ] `pnpm --filter @fxl-finders/api type-check` exits 0
- [ ] Named exports only; Zod schemas exported; no `any`
</acceptance_criteria>

---

### T06 · `conversions/routes.ts` — HMAC middleware + ingest endpoint + refund endpoint

**Plan:** `05-P06` — Wave 2 (after T05)
**Type:** execute
**Files:**
- `apps/api/src/domains/conversions/hmac-middleware.ts` (new — raw body capture + HMAC verify)
- `apps/api/src/domains/conversions/routes.ts` (new)
- `apps/api/src/server.ts` (update — mount conversions router, BEFORE any body-parse middleware on this route)

<read_first>
- `apps/api/src/domains/conversions/service.ts` — `ingestConversion`, `WebhookBodySchema`, `RefundBodySchema` (T05)
- `apps/api/src/domains/audit/service.ts` — `writeAuditEntry` (T04)
- `packages/shared-utils/src/hmac.ts` — `verifyHmac(secret, payload, sig): boolean` (Phase 04 T01)
- `docs/superpowers/specs/2026-05-28-fxl-finders-v1-design.md` § 5 — webhook verify flow steps 1–7 (signature format: `X-FXL-Signature: t=<ts>,v1=<hmac_sha256>`; payload: `ts + "." + raw_body`; replay window: 300s)
- `apps/api/src/server.ts` — existing mount pattern; global middleware order
- `.planning/plan-brief.md` — **D-O (HMAC middleware returns GENERIC 401 for all failures — no unknown-source oracle; verify on raw body before parse); D-L (middleware computes `rawBodyHash` and passes it to the service via context for `webhook_events.body_hash`); D-M (route returns 4xx 422 on `attribution_not_found`)**; D3: Hono raw body approach (`c.req.raw.clone().arrayBuffer()`); D4: store rawBody on context via `c.set('rawBody', rawBody)`
- `apps/api/src/types/hono.d.ts` (or wherever `ContextVariableMap` is augmented in Phase 01 per D-B) — add `rawBody: Buffer`, `rawBodyHash: string`, `verifiedApp` to the variable map
- `CLAUDE.md` — Hono domain pattern; named exports; no `any`
</read_first>

<action>
**Hono raw body approach (MANDATORY — read carefully):**

The HMAC middleware MUST run BEFORE Hono/zod-validator parses the body. Hono's `c.req.raw` is the native `Request` object. The body stream can only be read once — use `.clone()` to preserve the stream for downstream JSON parsing:

```typescript
// In hmac-middleware.ts
const rawBody = Buffer.from(await c.req.raw.clone().arrayBuffer())
c.set('rawBody', rawBody)
// Continue — downstream middleware/handler can still call c.req.json() on the original stream
```

Create `apps/api/src/domains/conversions/hmac-middleware.ts`:

Named export `hmacVerifyMiddleware` (Hono `MiddlewareHandler`). **D-O: every auth failure (missing/malformed header, expired timestamp, unknown source, bad signature) returns the SAME generic `c.json({ error: 'unauthorized' }, 401)` — NO distinct `unknown_source` / `signature_expired` / `invalid_signature` codes (no source-existence oracle). Verify on the raw body BEFORE any parse.**

1. Capture raw body: `const rawBody = Buffer.from(await c.req.raw.clone().arrayBuffer())`
2. Store on context: `c.set('rawBody', rawBody)`
3. Compute + store raw body hash for the service (D-L): `const rawBodyHash = createHash('sha256').update(rawBody).digest('hex'); c.set('rawBodyHash', rawBodyHash)`
4. Parse `X-FXL-Signature` header: regex `t=(\d+),v1=([a-f0-9]+)` → extract `ts` (number) and `sig` (hex string). If header missing or malformed → return generic `c.json({ error: 'unauthorized' }, 401)`.
5. Replay window: `if (Math.abs(Date.now() / 1000 - ts) > 300)` → return generic `c.json({ error: 'unauthorized' }, 401)`.
6. Read `source` from raw body JSON: `const { source } = JSON.parse(rawBody.toString('utf-8'))`. If parse fails → return generic `c.json({ error: 'unauthorized' }, 401)` (do NOT leak a distinct `invalid_body` here — failed parse before auth is treated as auth failure).
7. Lookup app: `SELECT webhook_signing_secret FROM apps WHERE slug = $source AND status = 'active'`. If not found → return the SAME generic `c.json({ error: 'unauthorized' }, 401)` (D-O: no `unknown_source` oracle). To avoid a timing oracle, still run `verifyHmac` against a dummy secret when the app is missing.
8. Recompute and verify: `const payload = ts + '.' + rawBody.toString('utf-8')`. Call `verifyHmac(app.webhook_signing_secret, payload, sig)`. If `false` → return generic `c.json({ error: 'unauthorized' }, 401)`.
9. Store app on context: `c.set('verifiedApp', app)`.
10. `await next()`.

Mounting in `apps/api/src/server.ts`:
```typescript
// IMPORTANT: hmacVerifyMiddleware BEFORE any body-parse middleware on this path
app.use('/api/v1/conversions/*', hmacVerifyMiddleware)
// Mount router AFTER middleware
app.route('/api/v1/conversions', conversionsRouter)
```

Create `apps/api/src/domains/conversions/routes.ts`:

Named export `conversionsRouter` as `new Hono()`. No `authMiddleware` on these routes (webhook path, no Clerk JWT).

- `POST /` (handles `event_type: 'sale'`):
  - Parse body via `WebhookBodySchema` (zod-validator)
  - Read the raw body hash off context: `const rawBodyHash = c.get('rawBodyHash')` (set by the HMAC middleware, D-L)
  - Call `ingestConversion(db, body, rawBodyHash)`
  - If `isDuplicate` → return `200 { status: 'duplicate' }`
  - Else → return `200 { status: 'accepted', conversionId: conversion.id }`
  - On `app_not_found` | `commission_rules_not_found` | `attribution_not_found` → return `422 { error }` (D-M: a 4xx so financeiro retries/alerts — NEVER a silent 200/204 drop)

- `POST /refund`:
  - Parse body via `RefundBodySchema`
  - Fetch original conversion by `body.conversion_id`
  - Call `reverseCommission` on each commission row for that conversion (from commissions service)
  - Call `writeAuditEntry(db, { actorUserId: 'system', action: 'commission.reverse', ...})`
  - Return `200 { status: 'reversed', count: N }`

Env vars required (add to `apps/api/.env.dev.example` if not already present):
- `CLERK_WEBHOOK_SIGNING_SECRET` — for Clerk webhook handler (T07); note here for visibility
</action>

<acceptance_criteria>
- [ ] `hmacVerifyMiddleware` reads raw body via `c.req.raw.clone().arrayBuffer()` (clone, not direct read)
- [ ] `hmacVerifyMiddleware` sets `c.set('rawBodyHash', sha256(rawBody))` for the service (D-L)
- [ ] `hmacVerifyMiddleware` returns the SAME generic `401 { error: 'unauthorized' }` for ALL of: missing/malformed header, timestamp diff > 300s, JSON parse failure, unknown source, signature mismatch (D-O — no source-existence/error-code oracle)
- [ ] `grep -n "unknown_source\|signature_expired\|invalid_signature\|missing_signature\|invalid_body" apps/api/src/domains/conversions/hmac-middleware.ts` returns ZERO matches (D-O verification — only the generic `unauthorized` code remains)
- [ ] Verify uses `verifyHmac` from shared-utils on the raw body BEFORE parse; HMAC payload format is `ts + "." + rawBody` (string concatenation, NOT JSON-encoded)
- [ ] Route handler reads `c.get('rawBodyHash')` and passes it as the third arg to `ingestConversion(db, body, rawBodyHash)` (D-L)
- [ ] `POST /api/v1/conversions` returns `200 { status: 'duplicate' }` on duplicate event_id
- [ ] `POST /api/v1/conversions` returns `200 { status: 'accepted', conversionId }` on success
- [ ] `POST /api/v1/conversions` returns `422 { error: 'attribution_not_found' }` (a 4xx, never a silent 200) when neither click_id nor finder_code resolves a finder (D-M)
- [ ] `POST /api/v1/conversions/refund` reverses commissions and returns count
- [ ] Routes are mounted AFTER `hmacVerifyMiddleware` in `server.ts`
- [ ] No `authMiddleware` on conversion routes (webhook path, no JWT)
- [ ] `pnpm --filter @fxl-finders/api type-check` exits 0
- [ ] Named exports only; no `any`
</acceptance_criteria>

---

### T07 · `sellers/clerk-webhook.ts` — Clerk `user.created` backfill via svix

**Plan:** `05-P07` — Wave 2 (after T01)
**Type:** execute
**Files:**
- `apps/api/src/domains/sellers/clerk-webhook.ts` (new)
- `apps/api/src/server.ts` (update — mount clerk webhook route)
- `apps/api/package.json` (update — add `svix` dependency)

<read_first>
- `.planning/phases/03-finder-onboarding-portal-shell/03-PLAN.md` — `sellers.clerk_user_id = ''` placeholder at creation; Phase 05 owns the `user.created` backfill (cross-phase coordination flag #3)
- `apps/api/src/db/schema.ts` — `sellers` table column names (Phase 01)
- `apps/api/src/lib/clerk.ts` — **`clerkClient` singleton (D-I). If this handler needs any Clerk API call, import `clerkClient` from here. Do NOT `import { clerkClient } from '@clerk/backend'` (not a bound default in v1.x).**
- `apps/api/src/db/client.ts` — `getAdminDb()` (BYPASSRLS, D-C) — sellers backfill is cross-tenant admin write
- `docs/superpowers/specs/2026-05-28-fxl-finders-v1-design.md` § 3 — sellers entity; no RLS (admin-managed)
- `.planning/plan-brief.md` — D-I (`clerkClient` singleton import); D5 (svix verify); cross-phase flag #6 (Phase 05 owns this backfill)
- `CLAUDE.md` — named exports; strict TypeScript; no `any`; Hono domain pattern
</read_first>

<action>
Install svix:
```bash
pnpm add svix --filter @fxl-finders/api
```

Create `apps/api/src/domains/sellers/clerk-webhook.ts`:

Named export `clerkWebhookRouter` as `new Hono()`.

`POST /` handler:

1. Verify Clerk webhook signature using svix:
```typescript
import { Webhook } from 'svix'
const wh = new Webhook(process.env.CLERK_WEBHOOK_SIGNING_SECRET ?? '')
const payload = await c.req.text()  // raw body as text
const headers = {
  'svix-id': c.req.header('svix-id') ?? '',
  'svix-timestamp': c.req.header('svix-timestamp') ?? '',
  'svix-signature': c.req.header('svix-signature') ?? '',
}
let evt: unknown
try {
  evt = wh.verify(payload, headers)
} catch {
  return c.json({ error: 'invalid_signature' }, 400)
}
```

2. Parse event: if `evt.type !== 'user.created'` → return `200 { status: 'ignored' }` (only handle `user.created`).

3. Extract `clerk_user_id = evt.data.id`, `email = evt.data.email_addresses?.[0]?.email_address`, `first_name = evt.data.first_name`, `last_name = evt.data.last_name`. (D-I: if any additional Clerk lookup is needed, use the `clerkClient` singleton imported from `apps/api/src/lib/clerk.ts` — never the `@clerk/backend` bare import.)

4. Backfill sellers (cross-tenant admin write — use `getAdminDb()`, D-C): `UPDATE sellers SET clerk_user_id = $clerk_user_id WHERE contact_email = $email AND (clerk_user_id = '' OR clerk_user_id IS NULL) RETURNING id`. Log how many rows updated.

5. If no seller found by email, also check: if a seller was explicitly linked by email during Phase 03 admin invite flow → no-op (seller already has correct `clerk_user_id`).

6. Return `200 { status: 'processed', updated: count }`.

Mount in `apps/api/src/server.ts`:
```typescript
import { clerkWebhookRouter } from './domains/sellers/clerk-webhook.js'
// Clerk webhook: raw body needed for svix; no other body middleware on this path
app.route('/api/v1/webhooks/clerk', clerkWebhookRouter)
```

Env var required (add to `apps/api/.env.dev.example`):
- `CLERK_WEBHOOK_SIGNING_SECRET=whsec_...` — set in Clerk Dashboard → Webhooks → Signing Secret
</action>

<acceptance_criteria>
- [ ] `clerkWebhookRouter` exported; named export only
- [ ] Svix `Webhook.verify()` called with `svix-id`, `svix-timestamp`, `svix-signature` headers
- [ ] Returns `400` when svix signature verification fails
- [ ] Returns `200 { status: 'ignored' }` for non-`user.created` event types
- [ ] Updates `sellers.clerk_user_id` WHERE `contact_email` matches AND `clerk_user_id` is empty/null, using `getAdminDb()` (D-C — cross-tenant write, no `setTenantContext`)
- [ ] Any Clerk API usage imports the `clerkClient` singleton from `apps/api/src/lib/clerk.ts` (D-I); `grep -n "from '@clerk/backend'" apps/api/src/domains/sellers/clerk-webhook.ts` returns ZERO matches for a `clerkClient` import
- [ ] Returns `200 { status: 'processed', updated: N }` on success (N can be 0 — no match is not an error)
- [ ] Route mounted at `/api/v1/webhooks/clerk`
- [ ] `CLERK_WEBHOOK_SIGNING_SECRET` documented in `apps/api/.env.dev.example`
- [ ] `pnpm --filter @fxl-finders/api type-check` exits 0
- [ ] Named exports only; no `any`
</acceptance_criteria>

---

### T08 · `commissions/routes.ts` + `payouts/routes.ts` — state transition endpoints

**Plan:** `05-P08` + `05-P09` — Wave 3 (after T03 + T05)
**Type:** execute
**Files:**
- `apps/api/src/domains/commissions/routes.ts` (new)
- `apps/api/src/domains/payouts/service.ts` (new)
- `apps/api/src/domains/payouts/routes.ts` (new)
- `apps/api/src/server.ts` (update — mount both routers)

<read_first>
- `apps/api/src/domains/commissions/service.ts` — all DB function signatures (T03): `lockCommission` (manual fast-track `pending→locked`), `reverseCommission`, `getCommissionsByFinder`, `getCommissionsAdmin`, `promoteHoldExpired`. **NOTE: there is NO `approveCommission` (D-K).**
- `apps/api/src/domains/audit/service.ts` — `writeAuditEntry`, `AuditAction` (T04)
- `apps/api/src/middleware/require-admin.ts` — `requireAdmin` (D-B — reads `c.get('userRole') === 'admin'`; the ONE admin guard). `clerkAuthMiddleware` from Phase 01 sets `userId`/`orgId`/`userRole`.
- `apps/api/src/db/client.ts` — `getDb()` (RLS, finder reads) + `getAdminDb()` (BYPASSRLS, admin reads + state transitions, D-C)
- `apps/api/src/domains/admin/apps/routes.ts` — admin route pattern with role gate (Phase 02)
- `apps/api/src/db/schema.ts` — `payouts`, `commissions`, `finders` column names (note `finders.cpf` / `finders.pix_key` nullability — D-Q exclusion guard)
- `.planning/plan-brief.md` — **D-C (admin commission/conversion reads + state transitions use `getAdminDb()`; audit_log on every admin money mutation); D-K (`lockCommission` fast-track replaces `approveCommission`); D-Q (Phase 05 OWNS the single `payouts` table + `commissions.paid_payout_id` + `locked→paid`; admin payouts UI deferred to Phase 06; `createPayoutBatch` reserves by setting `paid_payout_id` while staying `locked`; `markPayoutPaid` flips `locked→paid`; finders missing cpf/pix flagged not crashed); D-B (`requireAdmin` is the ONE admin guard)**
- `CLAUDE.md` — Hono domain pattern; named exports; no `any`
</read_first>

<action>
Create `apps/api/src/domains/commissions/routes.ts`:

Named export `commissionsRouter` as `new Hono()`.

Finder routes (apply `clerkAuthMiddleware`, finder JWT) — use `getDb()` (RLS):
- `GET /` → `getCommissionsByFinder(getDb(), orgId, userId)` → `200 { commissions: [] }`. Array hook: `select: (d) => Array.isArray(d.commissions) ? d.commissions : []`

Admin routes (apply `clerkAuthMiddleware` + `requireAdmin` guard, D-B) — use `getAdminDb()` (BYPASSRLS, D-C):
- `GET /admin` → `getCommissionsAdmin(getAdminDb(), { status, finderId })` from query params → `200 { commissions: [] }`
- `POST /admin/:commissionId/lock` → `lockCommission(getAdminDb(), commissionId, userId)` — manual "approve / lock-now" fast-track for `status='pending'` (D-K). The service writes the `commission.approve` audit row in its tx (D-C). → `200 { commission }`
- `POST /admin/:commissionId/reverse` → body: `{ reason: string }` → `reverseCommission(getAdminDb(), commissionId, reason, userId)` — service writes `commission.reverse` audit in its tx (D-C). → `200 { reversed: true }`

NOTE (D-K): there is NO `/admin/:id/approve` endpoint — the route is `/admin/:id/lock` and it performs `pending→locked`. The `approved` enum value is never written.

Error handling:
- `invalid_transition` → `409 { error: 'invalid_transition' }`
- Not found → `404`

Create `apps/api/src/domains/payouts/service.ts`:

**D-Q (LOCKED — Phase 05 OWNS the payout domain): single `payouts` table + `commissions.paid_payout_id` FK + `locked→paid` transition. NO `payout_batches`, NO `payout_batch_id`, NO `in_payout` status. `createPayoutBatch` RESERVES commissions by stamping `paid_payout_id` while they STAY `locked`; `markPayoutPaid` is the ONLY place that flips `locked→paid`. Admin payouts UI is DEFERRED to Phase 06 (Phase 06 consumes this service + adds `listFindersWithLockedCommissions` + `generateCsv`). All functions run on `getAdminDb()` (BYPASSRLS, D-C) for admin paths.**

Zod schemas (named exports):
- `CreatePayoutSchema`: `{ finderId: z.string().uuid(), commissionIds: z.array(z.string().uuid()).min(1) }`
- `MarkPaidSchema`: `{ payoutId: z.string().uuid(), note: z.string().optional() }`

DB functions (named exports):
- `createPayoutBatch(adminDb, finderId: string, commissionIds: string[], actorUserId: string): Promise<PayoutRow>` — runs on `getAdminDb()` in ONE tx:
  1. **Finder payout-detail guard (D-Q): SELECT `finders.cpf`, `finders.pix_key` for `finderId`. If either is null/empty → throw `Error('finder_payout_details_missing')` (a clean, surfaced error — NOT a NOT NULL crash). The route returns 422 so the admin sees a flag, not a 500.**
  2. Fetch all commissions by `commissionIds` WHERE `status = 'locked'` AND `finder_id = $finderId` AND `paid_payout_id IS NULL` — throw `Error('commissions_not_locked')` if any requested id is not locked or already reserved
  3. Compute `total_brl = SUM(amount_brl)` from fetched commissions
  4. Insert `payouts` row: `{ finder_id, total_brl, status: 'draft' }`
  5. **RESERVE (D-Q): Update each commission `SET paid_payout_id = payout.id` — status STAYS `'locked'` (do NOT set `paid`/`paid_at` here; reservation only).**
  6. Write audit (D-C money mutation): `writeAuditEntry(adminDb, { actorUserId, action: 'payout.mark_paid', entityType: 'payout', entityId: payout.id, afterJsonb: payout })` — in the SAME tx
  7. Return payout row
- `markPayoutPaid(adminDb, payoutId: string, actorUserId: string, note?: string): Promise<PayoutRow>` — runs on `getAdminDb()` in ONE tx:
  - UPDATE `payouts SET status = 'paid', paid_at = now(), paid_by_user_id = $actorUserId, note = $note WHERE id = $payoutId AND status IN ('draft', 'exported')`
  - Throw `Error('payout_not_found')` if 0 rows updated
  - **FLIP (D-Q): `UPDATE commissions SET status = 'paid', paid_at = now() WHERE paid_payout_id = $payoutId AND status = 'locked'` — this is the ONLY `locked→paid` transition.**
  - Write audit (D-C money mutation): `writeAuditEntry(adminDb, { actorUserId, action: 'payout.mark_paid', entityType: 'payout', entityId: payoutId })` — in the SAME tx
  - Return updated row
- `getPayoutsAdmin(adminDb, finderId?: string): Promise<PayoutRow[]>` — runs on `getAdminDb()`; SELECT all or by finderId; NO `setTenantContext`
- `getPayoutsByFinder(db, orgId: string, finderId: string): Promise<PayoutRow[]>` — runs on `getDb()` inside `db.transaction` with tx-scoped `setTenantContext(tx, orgId)` (D-D); SELECT WHERE finder_id = $finderId

NOTE (D-Q): the admin payouts UI is NOT built in Phase 05 — Phase 06 owns `/admin/payouts` UI and the CSV export. Phase 05 ships only the service + routes consumed there.

Create `apps/api/src/domains/payouts/routes.ts`:

Named export `payoutsRouter` as `new Hono()`.

Admin routes (apply `clerkAuthMiddleware` + `requireAdmin`, D-B) — service uses `getAdminDb()` (D-C):
- `GET /admin` → `getPayoutsAdmin(getAdminDb(), finderId?)` → `200 { payouts: [] }`
- `POST /admin` → `CreatePayoutSchema` body → `createPayoutBatch(getAdminDb(), finderId, commissionIds, userId)` → `201 { payout }`. On `finder_payout_details_missing` → `422 { error: 'finder_payout_details_missing' }` (D-Q: surfaced, not a crash). On `commissions_not_locked` → `422`.
- `POST /admin/:payoutId/mark-paid` → `MarkPaidSchema` body → `markPayoutPaid(getAdminDb(), payoutId, userId, note)` → `200 { payout }`

Finder routes (apply `clerkAuthMiddleware`) — service uses `getDb()` (RLS):
- `GET /` → `getPayoutsByFinder(getDb(), orgId, userId)` → `200 { payouts: [] }`

Mount in `apps/api/src/server.ts`:
```typescript
app.use('/api/v1/commissions/*', clerkAuthMiddleware)
app.use('/api/v1/commissions/admin/*', requireAdmin)   // D-B: ONE admin guard after auth
app.route('/api/v1/commissions', commissionsRouter)
app.use('/api/v1/payouts/*', clerkAuthMiddleware)
app.use('/api/v1/payouts/admin/*', requireAdmin)
app.route('/api/v1/payouts', payoutsRouter)
```
</action>

<acceptance_criteria>
- [ ] `GET /api/v1/commissions` returns finder's own commissions via `getDb()` + tx-scoped `setTenantContext` (D-D)
- [ ] `GET /api/v1/commissions/admin` returns all commissions via `getAdminDb()`; gated by `requireAdmin` (non-admin → 403) (D-B/D-C)
- [ ] `POST /api/v1/commissions/admin/:id/lock` calls `lockCommission` (`pending→locked` fast-track, D-K) + an `audit_log` row is written in the same tx (D-C). There is NO `/approve` endpoint.
- [ ] `POST /api/v1/commissions/admin/:id/reverse` calls `reverseCommission` + writes `commission.reverse` audit in the same tx (D-C)
- [ ] Every admin commission/payout mutation writes an `audit_log` row in the SAME transaction as the mutation (D-C)
- [ ] Admin commission/payout reads + transitions run on `getAdminDb()` (BYPASSRLS); `grep -n "setTenantContext" apps/api/src/domains/commissions/routes.ts apps/api/src/domains/payouts/routes.ts` shows it ONLY on finder routes, never admin (D-C)
- [ ] Invalid state transition → `409 { error: 'invalid_transition' }`
- [ ] `createPayoutBatch` RESERVES commissions: stamps `paid_payout_id`, commissions STAY `status='locked'` (D-Q — does NOT set paid here)
- [ ] `markPayoutPaid` is the ONLY path that flips commissions `locked→paid` (sets `status='paid', paid_at`) (D-Q)
- [ ] `createPayoutBatch` throws `finder_payout_details_missing` (→ 422) when finder cpf/pix_key is missing — NOT a NOT NULL crash (D-Q)
- [ ] `markPayoutPaid` writes `payout.mark_paid` audit entry
- [ ] Finder payout list uses `getDb()` + `setTenantContext`; admin payout list uses `getAdminDb()` + does NOT
- [ ] NO `payout_batches` / `payout_batch_id` / `in_payout` artifacts introduced (D-Q)
- [ ] `pnpm --filter @fxl-finders/api type-check` exits 0
- [ ] Named exports only; no `any`; Zod schemas exported from service
</acceptance_criteria>

---

### T09 · `nightly-job.ts` — `node-cron` hold promotion + manual admin endpoint

**Plan:** `05-P10` — Wave 3 (after T03)
**Type:** execute
**Files:**
- `apps/api/src/jobs/nightly-job.ts` (new)
- `apps/api/src/server.ts` (update — start cron on server init; mount manual trigger endpoint)
- `apps/api/package.json` (update — add `node-cron`)

<read_first>
- `apps/api/src/domains/commissions/service.ts` — `promoteHoldExpired(adminDb): Promise<number>` (T03; `pending→locked`, D-K)
- `apps/api/src/db/client.ts` — `getAdminDb()` (BYPASSRLS, D-C) — nightly job runs cross-tenant with no JWT
- `apps/api/src/middleware/require-admin.ts` — `requireAdmin` (D-B) for the manual trigger endpoint
- `apps/api/src/server.ts` — server startup pattern; where to call `setupNightlyJob()`
- `apps/api/package.json` — devDependencies vs dependencies; existing cron or scheduler packages
- `.planning/plan-brief.md` — D-K (`pending→locked`); D-C (`getAdminDb()`); D-B (`requireAdmin`)
- `CLAUDE.md` — named exports; strict TypeScript; no `any`
</read_first>

<action>
Install node-cron:
```bash
pnpm add node-cron --filter @fxl-finders/api
pnpm add --save-dev @types/node-cron --filter @fxl-finders/api
```

Create `apps/api/src/jobs/nightly-job.ts`:

Named exports:
- `setupNightlyJob(): void` — schedules the cron job; pulls `getAdminDb()` internally (D-C — no `db` arg)
- `runHoldPromotion(): Promise<{ promoted: number }>` — extracted for testability + manual trigger; runs `promoteHoldExpired(getAdminDb())`

```typescript
import cron from 'node-cron'
import { promoteHoldExpired } from '../domains/commissions/service.js'
import { getAdminDb } from '../db/client.js'  // D-C: nightly job is cross-tenant, no JWT → BYPASSRLS conn

export function setupNightlyJob(): void {
  // Run at 03:00 UTC daily (off-peak for BRL timezone)
  cron.schedule('0 3 * * *', async () => {
    try {
      const promoted = await promoteHoldExpired(getAdminDb())  // pending→locked WHERE hold_until < now() (D-K)
      console.log(`[nightly-job] hold promotion: ${promoted} commissions promoted pending→locked`)
    } catch (err) {
      console.error('[nightly-job] hold promotion failed:', err)
    }
  })
}

export async function runHoldPromotion(): Promise<{ promoted: number }> {
  const promoted = await promoteHoldExpired(getAdminDb())
  return { promoted }
}
```

Update `apps/api/src/server.ts` — call `setupNightlyJob()` after server init (not inside a route).

Mount manual trigger endpoint (admin only — D-B `requireAdmin`):
```typescript
app.use('/api/v1/admin/commissions/promote-locked', clerkAuthMiddleware, requireAdmin)
app.post('/api/v1/admin/commissions/promote-locked', async (c) => {
  const { promoted } = await runHoldPromotion()
  return c.json({ status: 'ok', promoted })
})
```

Document in `apps/api/src/jobs/nightly-job.ts` header comment:
```
// Nightly hold promotion: runs pending→locked WHERE hold_until < now() (D-K: no approved step)
// A freshly-ingested commission (status='pending') reaches 'locked' here with NO manual action.
// Runs on getAdminDb() (BYPASSRLS) — cross-tenant, no JWT (D-C).
// Schedule: 03:00 UTC daily via node-cron (D1 autopilot decision)
// Manual trigger: POST /api/v1/admin/commissions/promote-locked (admin only, requireAdmin)
// v1.1 upgrade path: extract to a BullMQ worker job for distributed deploys
```
</action>

<acceptance_criteria>
- [ ] `setupNightlyJob` schedules `cron.schedule('0 3 * * *', ...)` (03:00 UTC)
- [ ] `runHoldPromotion` calls `promoteHoldExpired(getAdminDb())` (D-C) and returns `{ promoted: number }`
- [ ] `promoteHoldExpired` promotes `pending→locked` (D-K) — the job header comment and log say `pending→locked`, NOT `approved→locked`
- [ ] `setupNightlyJob()` called in `server.ts` after server initialization (no `db` arg — pulls `getAdminDb()` internally)
- [ ] `POST /api/v1/admin/commissions/promote-locked` returns `{ status: 'ok', promoted: N }` for admin (gated by `requireAdmin`, D-B)
- [ ] `POST /api/v1/admin/commissions/promote-locked` returns `403` for non-admin
- [ ] Cron error is caught and logged (does NOT crash the process)
- [ ] `pnpm --filter @fxl-finders/api type-check` exits 0
- [ ] Named exports only; no `any`
</acceptance_criteria>

---

### T10 · `apps/web` — admin conversions list (reconciliation view)

**Plan:** `05-P11` — Wave 4 (after T08; requires `/gsd:ui-phase 05`)
**Type:** execute
**Files:**
- `apps/web/src/admin/conversions/ConversionsPage.tsx` (new)
- `apps/web/src/admin/conversions/useConversions.ts` (new — TanStack Query hooks)
- `apps/web/src/lib/api-client.ts` (update — add conversions admin API call)
- `apps/web/src/router.tsx` (update — add `/admin/conversions` route)
- `apps/web/src/i18n/pt-BR.json` (update — add `admin.conversions.*` keys)

<read_first>
- `.planning/phases/05-*/05-UI-SPEC.md` — UI design contract (REQUIRED — produced by /gsd:ui-phase 05)
- `apps/api/src/domains/conversions/routes.ts` — response shape for admin GET (T06)
- `apps/web/src/admin/apps/AppsPage.tsx` — admin list page pattern to mirror (table + KPICards + loading state)
- `apps/web/src/components/ui/kpi-card.tsx` — KPICard props
- `apps/web/src/components/ui/skeleton.tsx` — Skeleton component
- `CLAUDE.md` — loading state rules (isLoading→skeleton; empty→EmptyState; data→content); KPICard; `useTranslation()`; no raw Clerk IDs; named exports
- `.planning/plan-brief.md` — Wave 0: route `/admin/conversions` (admin segment)
</read_first>

<action>
Update `apps/web/src/lib/api-client.ts` — add conversions admin API:
```
adminConversionsApi = {
  list: (params?: { source?: string; finderId?: string }) → GET /api/v1/conversions/admin with query params,
}
```

Note: `/api/v1/conversions/admin` is a new GET endpoint — add it to `conversions/routes.ts` (T06 update): `GET /admin` → SELECT from `conversions` with optional filters; **gated by `clerkAuthMiddleware` + `requireAdmin` (D-B); reads via `getAdminDb()` (BYPASSRLS, D-C — admin cross-tenant read; never `setTenantContext`)**. Response must include resolved `finder_display_name` / `seller_display_name` (no raw Clerk IDs / UUIDs in UI).

Create `apps/web/src/admin/conversions/useConversions.ts`:
- `useAdminConversions(filters?)` — `useQuery({ queryKey: ['admin', 'conversions', filters], queryFn: adminConversionsApi.list, select: (d) => Array.isArray(d.conversions) ? d.conversions : [] })`

Create `apps/web/src/admin/conversions/ConversionsPage.tsx`:

Named export `ConversionsPage`.

Layout (follow `05-UI-SPEC.md`):
- Page title: `t('admin.conversions.title')` — "Conversões"
- KPICards row:
  - "Total" — count of conversions; icon `TrendingUp`; `isLoading`
  - "Setup Total (R$)" — sum of `realized_setup_brl / 100`; icon `DollarSign`; `isLoading`
  - "Recorrente Total (R$)" — sum of `realized_monthly_brl / 100`; icon `RefreshCw`; `isLoading`
- Filters bar: `source` dropdown (fxl-financiero + other active apps); finder search text input
- Table columns: Source | External Order ID | Finder | Seller | Product | Setup (R$) | Monthly (R$) | Closed At | Status
- Loading: 5 skeleton rows
- Empty: `<EmptyState title={t('admin.conversions.empty')} />`
- Data: table rows. Money display: `(amount / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })`
- DO NOT render raw `finder_id` or `seller_id` UUID — display `finder.display_name` via a resolved field from API response (update API response to include `finder_display_name`, `seller_display_name`)

Update router: add `/admin/conversions` → `<ConversionsPage />` inside admin `RoleGuard`

i18n keys:
```json
{
  "admin": {
    "conversions": {
      "title": "Conversões",
      "empty": "Nenhuma conversão registrada",
      "kpi": { "total": "Conversões", "setupTotal": "Setup Total", "recurringTotal": "Recorrente Total" },
      "columns": { "source": "Origem", "orderId": "Pedido", "finder": "Indicador", "seller": "Vendedor", "product": "Produto", "setup": "Setup", "monthly": "Mensalidade", "closedAt": "Data", "status": "Status" }
    }
  }
}
```
</action>

<acceptance_criteria>
- [ ] `ConversionsPage` follows `05-UI-SPEC.md` design contract
- [ ] `isLoading → skeleton` (5 skeleton rows); `!isLoading && empty → EmptyState`; `!isLoading && data → table`
- [ ] KPICards use `KPICard` component with `isLoading` prop
- [ ] Money values displayed as `R$ X,XX` (pt-BR currency format)
- [ ] NO raw UUID rendered in UI (uses `finder_display_name`, `seller_display_name` from API)
- [ ] Route `/admin/conversions` accessible only to admin role (RoleGuard)
- [ ] `useAdminConversions` hook uses `select` with `Array.isArray` guard
- [ ] `pnpm --filter @fxl-finders/web type-check` exits 0
- [ ] i18n keys in `pt-BR.json`; all user-facing strings via `useTranslation()`
- [ ] Named exports only; no `any`
</acceptance_criteria>

---

### T11 · `apps/web` — admin commissions list with state badges

**Plan:** `05-P12` — Wave 4 (after T08; requires `/gsd:ui-phase 05`)
**Type:** execute
**Files:**
- `apps/web/src/admin/commissions/CommissionsPage.tsx` (new)
- `apps/web/src/admin/commissions/CommissionStateBadge.tsx` (new)
- `apps/web/src/admin/commissions/useAdminCommissions.ts` (new)
- `apps/web/src/lib/api-client.ts` (update — add admin commissions + mutations)
- `apps/web/src/router.tsx` (update — add `/admin/commissions` route)
- `apps/web/src/i18n/pt-BR.json` (update — add `admin.commissions.*` keys)

<read_first>
- `.planning/phases/05-*/05-UI-SPEC.md` — UI design contract (REQUIRED)
- `apps/api/src/domains/commissions/routes.ts` — admin endpoints: `GET /admin`, **`POST /admin/:id/lock`** (D-K fast-track — NOT `/approve`), `POST /admin/:id/reverse` (T08)
- `apps/web/src/admin/conversions/ConversionsPage.tsx` — admin list pattern to mirror (T10)
- `apps/web/src/lib/api-client.ts` — `apiFetch(path, { method, token, body })` (D-J — all calls go through this with Clerk `getToken()`)
- `apps/web/src/components/ui/badge.tsx` — Badge component for status display (Phase 02)
- `.planning/plan-brief.md` — D-K (lock-now fast-track shows for `status='pending'`); D-J (apiFetch + Clerk token)
- `CLAUDE.md` — loading rules; KPICard; named exports; query invalidation via `invalidateQueries()`
</read_first>

<action>
Update `apps/web/src/lib/api-client.ts` — add commissions admin API (all via `apiFetch` with Clerk token per D-J):
```
adminCommissionsApi = {
  list: (params?: { status?: CommissionStatus; finderId?: string }) → GET /api/v1/commissions/admin,
  lock: (commissionId: string) → POST /api/v1/commissions/admin/:commissionId/lock,   // D-K: "Aprovar / liberar agora" fast-track pending→locked (NOT /approve)
  reverse: (commissionId: string, reason: string) → POST /api/v1/commissions/admin/:commissionId/reverse,
}
```

Create `apps/web/src/admin/commissions/useAdminCommissions.ts`:
- `useAdminCommissions(filters?)` — `useQuery({ queryKey: ['admin', 'commissions', filters], ..., select: (d) => Array.isArray(d.commissions) ? d.commissions : [] })`
- `useLockCommission()` — `useMutation({ mutationFn: adminCommissionsApi.lock, onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'commissions'] }) })` (D-K: manual fast-track to `locked`)
- `useReverseCommission()` — `useMutation({ mutationFn: ..., onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'commissions'] }) })`

Create `apps/web/src/admin/commissions/CommissionStateBadge.tsx`:
Named export `CommissionStateBadge({ status: CommissionStatus })`. Map status to `<Badge variant>`:
- `pending` → variant `secondary` (gray) — "Pendente"
- `approved` → variant `outline` (blue outline) — "Aprovada"
- `locked` → variant `default` (solid blue) — "Bloqueada"
- `paid` → variant `default` (green) — "Paga"
- `reversed` → variant `destructive` (red) — "Revertida"

Create `apps/web/src/admin/commissions/CommissionsPage.tsx`:

Named export `CommissionsPage`.
- KPICards: "Total comissões" | "Pendentes" | "A Pagar (R$)" (sum of locked)
- Filter bar: status filter dropdown; finder search
- Table: Finder | Produto | Tipo (setup/recurring) | Base (R$) | Taxa (%) | Valor (R$) | Status Badge | Hold Until | Actions
- Row actions (D-K gating):
  - `status='pending'`: "Aprovar / liberar agora" button → `useLockCommission()` → `invalidateQueries`. This is the manual fast-track that lands the commission on `locked` (NOT a separate `approved` state). Button shows ONLY for `status='pending'`.
  - `status IN ['pending','locked']`: "Reverter" button → opens `<AlertDialog>` with reason textarea → `useReverseCommission()`. (`paid` rows are reversed via a separate negative-row flow; do not surface a plain reverse for them in v1.0 unless UI-SPEC says otherwise.)
  - Status badge uses `CommissionStateBadge`
- State: `isLoading → 5 skeleton rows`; `empty → EmptyState`; `data → table`

i18n keys:
```json
{
  "admin": {
    "commissions": {
      "title": "Comissões",
      "empty": "Nenhuma comissão registrada",
      "status": { "pending": "Pendente", "approved": "Aprovada", "locked": "Bloqueada", "paid": "Paga", "reversed": "Revertida" },
      "actions": { "lock": "Aprovar / liberar agora", "reverse": "Reverter", "reverseConfirm": "Confirmar Reversão", "reverseReason": "Motivo da reversão" },
      "kpi": { "total": "Comissões", "pending": "Pendentes", "toLock": "A Pagar" }
    }
  }
}
```
</action>

<acceptance_criteria>
- [ ] `CommissionsPage` follows `05-UI-SPEC.md`
- [ ] `CommissionStateBadge` renders all 5 status variants with correct pt-BR labels (`approved` mapped for forward-compat even though v1.0 never produces it)
- [ ] "Aprovar / liberar agora" (lock-now) button shows ONLY for `status='pending'` and calls `useLockCommission` (POST `.../lock`) + invalidates `['admin', 'commissions']` (D-K). There is NO call to a `/approve` endpoint.
- [ ] Reverse action opens AlertDialog with reason field; shows for `status IN ['pending','locked']`; calls `useReverseCommission` on confirm
- [ ] Both mutations call `queryClient.invalidateQueries({ queryKey: ['admin', 'commissions'] })`
- [ ] `isLoading → skeleton`; empty → EmptyState; data → table
- [ ] Route `/admin/commissions` accessible only to admin
- [ ] `pnpm --filter @fxl-finders/web type-check` exits 0
- [ ] Named exports only; no `any`; all strings via `useTranslation()`
</acceptance_criteria>

---

### T12 · `apps/web` — admin audit log viewer (read-only, hash-verified)

**Plan:** `05-P13` — Wave 4 (after T04 + T08; requires `/gsd:ui-phase 05`)
**Type:** execute
**Files:**
- `apps/web/src/admin/audit/AuditLogPage.tsx` (new)
- `apps/web/src/admin/audit/useAuditLog.ts` (new)
- `apps/api/src/domains/audit/routes.ts` (new — `GET /api/v1/admin/audit` paginated)
- `apps/web/src/lib/api-client.ts` (update — add audit log API call)
- `apps/web/src/router.tsx` (update — add `/admin/audit` route)
- `apps/web/src/i18n/pt-BR.json` (update — add `admin.audit.*` keys)

<read_first>
- `.planning/phases/05-*/05-UI-SPEC.md` — UI design contract (REQUIRED)
- `apps/api/src/domains/audit/service.ts` — `verifyChain`, `AuditAction` (T04)
- `apps/api/src/db/client.ts` — `getAdminDb()` (BYPASSRLS, D-C — `audit_log` is cross-tenant)
- `apps/api/src/middleware/require-admin.ts` — `requireAdmin` (D-B)
- `apps/api/src/db/schema.ts` — `auditLog` column names (Phase 01)
- `CLAUDE.md` — loading rules; named exports; no raw Clerk IDs
- `.planning/plan-brief.md` — Wave 0: route `/admin/audit`; D-B (`requireAdmin`); D-C (`getAdminDb()` for admin/cross-tenant reads); D-R NIT (per-page badge labeled "Página íntegra" OR a full-chain endpoint)
</read_first>

<action>
Create `apps/api/src/domains/audit/routes.ts`:

Named export `auditRouter` as `new Hono()`. Reads via `getAdminDb()` (BYPASSRLS — `audit_log` is cross-tenant append-only; D-C). Gated by `requireAdmin` (D-B).

- `GET /` (admin only):
  - Query params: `page?: number` (default 1), `limit?: number` (default 50, max 200), `action?: string`
  - SELECT from `audit_log ORDER BY id DESC LIMIT $limit OFFSET ($page-1)*$limit` via `getAdminDb()`
  - Response: `{ entries: AuditLogRow[], total: number, page: number, page_chain_valid: boolean }`
  - Compute `page_chain_valid`: call `verifyChain(entries)` on the returned page. **NIT (plan-brief D-R): this only verifies the page's internal chain, NOT the full ledger — so the field is named `page_chain_valid` (not `chain_valid`) and the UI badge says "Página íntegra" (per-page), not "Cadeia íntegra".**

- `GET /verify-chain` (admin only — full-ledger integrity check, NIT alternative):
  - Streams/loads ALL `audit_log` rows in `id ASC` order and runs `verifyChain(allEntries)`
  - Response: `{ chain_valid: boolean, broken_at: number | null, total: number }`
  - This is the authoritative whole-chain check; the per-page badge links to it.

Mount in `apps/api/src/server.ts`:
```typescript
app.use('/api/v1/admin/audit/*', clerkAuthMiddleware, requireAdmin)  // D-B: ONE admin guard
app.route('/api/v1/admin/audit', auditRouter)
```

Create `apps/web/src/admin/audit/useAuditLog.ts`:
- `useAuditLog(page?, action?)` — `useQuery({ queryKey: ['admin', 'audit', page, action], queryFn: adminAuditApi.list, select: (d) => d })`

Create `apps/web/src/admin/audit/AuditLogPage.tsx`:

Named export `AuditLogPage`.
- Page title: `t('admin.audit.title')` — "Ledger de Auditoria"
- **Per-page chain badge (NIT, D-R):** driven by `page_chain_valid` from the list endpoint. If `false` → red `<Badge variant='destructive'>{t('admin.audit.pageBroken')}</Badge>` ("Página comprometida"); if `true` → green `<Badge variant='default'>{t('admin.audit.pageValid')}</Badge>` ("Página íntegra"); if `isLoading` → skeleton badge. The label is explicitly PER-PAGE ("Página"), NOT "Cadeia", because the list endpoint only validates the visible page.
- **Full-chain check button:** a "Verificar cadeia completa" button calls `GET /api/v1/admin/audit/verify-chain` (via a `useVerifyChain()` mutation/query). On result, show a separate banner: green `{t('admin.audit.chainValid')}` ("Cadeia íntegra") or red `{t('admin.audit.chainBroken')}` ("Cadeia comprometida — quebra em #{broken_at}"). This is the authoritative whole-ledger badge.
- Filters: action type dropdown (all `AuditAction` values); actor filter text input
- Table (read-only — no action buttons): Timestamp | Actor | Action | Entity | Entity ID | Request ID | Chain
- "Chain" column: show `✓` (green check icon) when this entry's hash is verified within the page; `—` for the first entry on a page (no prior entry to compare to on pagination boundary)
- Pagination: prev/next buttons; display "Página N"
- Loading: 10 skeleton rows
- Empty: `<EmptyState title={t('admin.audit.empty')} />`
- DO NOT display raw `entry_hash` or `prev_hash` in the table (too noisy); accessible via row expand or tooltip if UI-SPEC permits

i18n keys:
```json
{
  "admin": {
    "audit": {
      "title": "Ledger de Auditoria",
      "empty": "Nenhum registro de auditoria",
      "pageValid": "Página íntegra",
      "pageBroken": "Página comprometida",
      "chainValid": "Cadeia íntegra",
      "chainBroken": "Cadeia comprometida",
      "verifyFullChain": "Verificar cadeia completa",
      "columns": { "ts": "Data/Hora", "actor": "Ator", "action": "Ação", "entity": "Entidade", "entityId": "ID", "requestId": "Request", "chain": "Cadeia" }
    }
  }
}
```
</action>

<acceptance_criteria>
- [ ] `AuditLogPage` is read-only — no action buttons that modify audit entries (the "Verificar cadeia completa" button is read-only)
- [ ] Per-page badge is labeled "Página íntegra"/"Página comprometida" (NOT "Cadeia") and is driven by `page_chain_valid` (NIT, D-R)
- [ ] A "Verificar cadeia completa" control calls `GET /api/v1/admin/audit/verify-chain` and shows the authoritative whole-ledger result ("Cadeia íntegra"/"Cadeia comprometida — quebra em #N")
- [ ] `isLoading → skeleton rows`; `empty → EmptyState`; `data → table`
- [ ] `GET /api/v1/admin/audit` + `GET /api/v1/admin/audit/verify-chain` paginated/whole; gated by `requireAdmin` (non-admin → 403, D-B); read via `getAdminDb()` (D-C)
- [ ] List API response includes `page_chain_valid: boolean` (page-scoped); `/verify-chain` returns `{ chain_valid, broken_at }` (full)
- [ ] `actor_user_id = 'system'` renders as "sistema" (not a raw Clerk ID — 'system' is a sentinel string, not `user_*`)
- [ ] `useAuditLog` hook with `select` returning full response object (not filtered array)
- [ ] Route `/admin/audit` accessible only to admin
- [ ] `pnpm --filter @fxl-finders/api type-check` exits 0
- [ ] `pnpm --filter @fxl-finders/web type-check` exits 0
- [ ] Named exports only; all strings via `useTranslation()`
</acceptance_criteria>

---

### T13 · `apps/web` — finder commissions view

**Plan:** `05-P12` — Wave 4 (after T08; requires `/gsd:ui-phase 05`)
**Type:** execute
**Files:**
- `apps/web/src/finder/commissions/CommissionsPage.tsx` (new — replaces Phase 03 placeholder)
- `apps/web/src/finder/commissions/useCommissions.ts` (new)
- `apps/web/src/lib/api-client.ts` (update — add finder commissions API)
- `apps/web/src/i18n/pt-BR.json` (update — add `finder.commissions.*` keys)

<read_first>
- `.planning/phases/05-*/05-UI-SPEC.md` — UI design contract (REQUIRED)
- `apps/api/src/domains/commissions/routes.ts` — `GET /api/v1/commissions` finder endpoint (T08)
- `apps/web/src/finder/links/LinksPage.tsx` — finder page pattern with KPICards (Phase 04 T08)
- `apps/web/src/admin/commissions/CommissionStateBadge.tsx` — reuse state badge component (T11)
- `CLAUDE.md` — loading rules; KPICard; named exports; no raw Clerk IDs
</read_first>

<action>
Add to `apps/web/src/lib/api-client.ts`:
```
finderCommissionsApi = {
  list: () → GET /api/v1/commissions (finder JWT),
}
```

Create `apps/web/src/finder/commissions/useCommissions.ts`:
- `useFinderCommissions()` — `useQuery({ queryKey: ['finder', 'commissions'], queryFn: finderCommissionsApi.list, select: (d) => Array.isArray(d.commissions) ? d.commissions : [] })`

Create `apps/web/src/finder/commissions/CommissionsPage.tsx`:

Named export `CommissionsPage` (replaces Phase 03 `CommissionsPlaceholderPage`).
- KPICards: "Total em Comissões (R$)" | "Pendente" | "A Pagar (R$)" (locked status)
- Table: Produto | Tipo (Setup/Recorrente) | Valor (R$) | Status Badge | Liberado Em | Pago Em
- Status badge: reuse `<CommissionStateBadge status={...} />` from T11
- Loading: skeleton; Empty: EmptyState "Nenhuma comissão ainda"
- Update `apps/web/src/router.tsx` to import `CommissionsPage` from `./finder/commissions/CommissionsPage`

i18n keys:
```json
{
  "finder": {
    "commissions": {
      "title": "Minhas Comissões",
      "empty": "Nenhuma comissão ainda",
      "kpi": { "total": "Total Comissões", "pending": "Pendente", "toPay": "A Pagar" },
      "columns": { "product": "Produto", "kind": "Tipo", "amount": "Valor", "status": "Status", "holdUntil": "Liberado Em", "paidAt": "Pago Em" },
      "kind": { "setup": "Setup", "recurring": "Recorrente" }
    }
  }
}
```
</action>

<acceptance_criteria>
- [ ] `CommissionsPage` replaces Phase 03 placeholder in router
- [ ] Reuses `CommissionStateBadge` from T11 (no duplicate status badge code)
- [ ] KPICards: "Total em Comissões", "Pendente", "A Pagar" with correct `isLoading` handling
- [ ] `useFinderCommissions` uses `select` with `Array.isArray` guard
- [ ] `isLoading → skeleton`; `empty → EmptyState`; `data → table`
- [ ] Amounts displayed as pt-BR currency; no raw UUIDs in UI
- [ ] `pnpm --filter @fxl-finders/web type-check` exits 0
- [ ] Named exports only; all strings via `useTranslation()`
</acceptance_criteria>

---

### T14 · Type-check + lint gate + RLS integration test extensions

**Plan:** `05-P14` — Wave 5 (after all prior tasks)
**Type:** execute
**Files:**
- `apps/api/test/rls/conversions-commissions.test.ts` (new — RLS cross-tenant integration tests)
- `apps/api/test/rls/audit-chain.test.ts` (new — audit hash chain integrity test)

<read_first>
- `.planning/phases/01-schema-foundation-clerk-auth-rls/01-PLAN.md` T12 — existing RLS integration test pattern (`apps/api/test/rls/cross-tenant.test.ts`); raw postgres client connecting as `fxl_finders_app` (D-G); `fxl_finders_admin` BYPASSRLS conn via `ADMIN_DATABASE_URL` (D-C); two-org fixture setup; positive control + UPDATE-path coverage (D-G)
- `apps/api/src/domains/audit/service.ts` — `verifyChain` (T04)
- `apps/api/src/db/schema.ts` — `conversions`, `commissions` column names
- `.planning/plan-brief.md` — D-C (admin BYPASSRLS UPDATE; no USING(true) policy); D-G (test as `fxl_finders_app`, not superuser; positive control; cover UPDATE)
- `CLAUDE.md` — vitest unit + integration project split; integration tests in `apps/api/test/`
</read_first>

<action>
Create `apps/api/test/rls/conversions-commissions.test.ts`:

Integration tests (run against Docker Postgres, vitest integration project):

1. **conversions INSERT bypass (split policy)**:
   - Set `app.current_org_id = ''` (empty) on the connection
   - Insert a `conversions` row — assert success (INSERT WITH CHECK true allows this)
   - This simulates the webhook path inserting without tenant context

2. **conversions SELECT tenant isolation**:
   - Create fixtures: org_A conversion + org_B conversion
   - Set `app.current_org_id = org_A_id`
   - `SELECT * FROM conversions` — assert only org_A row returned (org_B row not visible)

3. **commissions INSERT bypass (split policy)**:
   - Same as #1 for `commissions`

4. **commissions SELECT tenant isolation**:
   - Same as #2 for `commissions`

5. **commissions UPDATE path (D-C — RLS test MUST cover UPDATE, not just INSERT/SELECT)**:
   - Connect as `fxl_finders_app`. Set `app.current_org_id = org_A_id`. Attempt `UPDATE commissions SET status='locked' WHERE id = <org_B commission>` → assert ZERO rows affected (app role has NO UPDATE policy/grant on commissions, so it cannot mutate any commission — confirming the removed `USING(true)` hole is closed).
   - Attempt the same UPDATE on an org_A commission as `fxl_finders_app` → still ZERO rows (no UPDATE grant to app role at all, D-C).
   - Connect via the BYPASSRLS admin connection (`ADMIN_DATABASE_URL` / `fxl_finders_admin`) WITHOUT setting `app.current_org_id`; `UPDATE commissions SET status='locked' WHERE id = <org_B commission>` → assert 1 row affected (admin bypasses RLS, D-C).

6. **payouts cross-tenant (no RLS)**:
   - Insert payouts for two different finders
   - Without setting `app.current_org_id`, `SELECT * FROM payouts` returns both rows (no RLS on payouts)

Create `apps/api/test/rls/audit-chain.test.ts`:

Integration tests:

1. **chain integrity — single entry**: Insert one audit log entry; call `verifyChain([entry])` → `{ valid: true }`
2. **chain integrity — two entries**: Insert two entries in sequence; call `verifyChain([entry1, entry2])` → `{ valid: true }`
3. **chain broken — tampered hash**: Fetch two entries; mutate `entry2.prev_hash` to a wrong value in memory (NOT in DB — just for the verify test); call `verifyChain([entry1, tamperedEntry2])` → `{ valid: false, brokenAt: 1 }`
4. **parallel insert serialization**: Concurrent `writeAuditEntry` calls do NOT produce duplicate `prev_hash` values (the `FOR UPDATE` lock serializes them). Insert 5 audit entries concurrently; verify resulting chain with `verifyChain`.

Final gate:
```bash
pnpm run check  # lint + type-check all packages
pnpm --filter @fxl-finders/api test  # unit tests
# Integration tests run in CI: pnpm --filter @fxl-finders/api test:integration
```
</action>

<acceptance_criteria>
- [ ] `conversions-commissions.test.ts` — all 6 test cases pass against Docker Postgres (includes the D-C UPDATE-path case)
- [ ] `audit-chain.test.ts` — all 4 test cases pass
- [ ] Cross-tenant isolation confirmed: org_A cannot read org_B conversions or commissions via SELECT
- [ ] D-C UPDATE path confirmed: `fxl_finders_app` cannot UPDATE ANY commission (0 rows); the BYPASSRLS admin connection CAN (1 row) — proves the `USING(true)` hole is closed
- [ ] Tests connect as `fxl_finders_app` (not superuser `postgres`, which bypasses RLS) per D-G; positive control (own-row visible) included
- [ ] `payouts` has no tenant isolation (no RLS) — test confirms both orgs' payouts visible
- [ ] Concurrent audit inserts produce a valid chain (no duplicate prev_hash)
- [ ] `pnpm run check` exits 0 (all packages lint + type-check)
- [ ] `pnpm --filter @fxl-finders/api test` exits 0 (all unit tests pass)
- [ ] No `any`; named exports only in all new test files
</acceptance_criteria>

---

## must_haves

```yaml
truths:
  - "HMAC verify runs on raw body (Buffer) BEFORE any JSON middleware — no exceptions"
  - "HMAC middleware returns a GENERIC 401 'unauthorized' for missing/expired/unknown-source/bad-sig — no source-existence oracle (D-O)"
  - "conversions + commissions have split-RLS: INSERT WITH CHECK (true), SELECT USING org_id"
  - "NO commissions_update_admin USING(true) policy — admin UPDATEs run on the BYPASSRLS getAdminDb() connection (D-C)"
  - "app role (fxl_finders_app) has NO UPDATE grant on commissions/payouts; admin DML uses fxl_finders_admin BYPASSRLS (D-C)"
  - "every admin money mutation (lock/reverse/payout create/mark-paid) writes an audit_log row in the same tx (D-C)"
  - "payouts has NO RLS (admin-managed cross-tenant, same as apps/products); Phase 05 OWNS the single payouts table + commissions.paid_payout_id + locked→paid (D-Q)"
  - "createPayoutBatch RESERVES (stamps paid_payout_id, stays locked); markPayoutPaid is the ONLY locked→paid flip (D-Q)"
  - "admin payouts UI is deferred to Phase 06 (Phase 05 ships service + routes only) (D-Q)"
  - "commission basis = realized_*_brl always (spec § 10) — never quoted_*_brl"
  - "ingestConversion snapshots quoted_setup_brl/quoted_monthly_brl from referral_links, stores customer_email_hash, INSERTs a leads PII row (status='converted'), and stores the passed-in rawBodyHash in webhook_events.body_hash (D-L)"
  - "webhook body schema == Phase 06 sender: includes finder_code (optional) + customer_name/phone/cpf; attribution resolves click_id else finder_code else throws attribution_not_found (4xx, never silent drop) (D-M)"
  - "zero-realized-amount components produce NO commission row"
  - "reversal of a paid commission inserts a NEW negative-amount row (immutable original)"
  - "audit_log entries are never updated or deleted; fxl_finders_app has only INSERT + SELECT"
  - "entry_hash computed INSIDE the same transaction as insert with FOR UPDATE on tail row"
  - "actor_user_id = 'system' for all webhook-triggered audit entries"
  - "first-row prev_hash = '0'.repeat(64)"
  - "sellers.clerk_user_id backfilled by Clerk user.created webhook (svix verify); any Clerk call imports clerkClient from apps/api/src/lib/clerk.ts (D-I)"
  - "no setTenantContext in webhook path (conversions ingest, Clerk webhook) nor on any admin route (D-C)"
  - "setTenantContext (tx-scoped, D-D) REQUIRED in finder-facing GET routes for conversions + commissions"
  - "commission auto path is pending→locked→paid→(reversed): node-cron promotes pending→locked WHERE hold_until < now() with NO approved step and NO manual action (D-K)"
  - "manual 'Aprovar / liberar agora' (lock-now) fast-track shows for status='pending' and lands on locked (D-K) — there is NO /approve endpoint and no *→approved transition"

verification:
  - "pnpm run check (lint + type-check all packages) exits 0"
  - "pnpm --filter @fxl-finders/api test exits 0 (unit tests pass)"
  - "POST /api/v1/conversions with valid HMAC + new event_id returns 200 {status:'accepted'}"
  - "POST /api/v1/conversions with same event_id returns 200 {status:'duplicate'}"
  - "POST /api/v1/conversions with bad/missing/expired signature OR unknown source returns the SAME generic 401 {error:'unauthorized'} (D-O)"
  - "POST /api/v1/conversions with neither click_id nor finder_code resolvable returns 422 attribution_not_found (D-M)"
  - "commission amount_brl = floor(realized * rate / 100) — verified by TDD tests, INCLUDING rate passed as string '30.00' (Drizzle numeric returns string)"
  - "state machine rejects pending→paid (must lock first) and accepts pending→locked — verified by TDD tests (D-K)"
  - "a freshly-ingested commission (status='pending') reaches 'locked' after hold_until passes via promoteHoldExpired with NO manual action (D-K) — verified by TDD/integration"
  - "verifyChain returns { valid: false } on tampered entry — verified by TDD tests"
  - "RLS integration tests: org_A cannot read org_B conversions — verified by integration tests"
  - "RLS integration test: fxl_finders_app cannot UPDATE any commission; fxl_finders_admin (BYPASSRLS) can (D-C) — verified by integration test"
  - "admin /admin/conversions, /admin/commissions, /admin/audit all return 403 for non-admin JWT (requireAdmin, D-B)"
  - "finder /commissions returns only own org's commissions (setTenantContext enforced by RLS)"
```

---

## Failure-list items (carry to plan-brief.md Wave 4 after execution)

- **svix version compat**: confirm `svix` npm package version supports the `Webhook.verify()` API used by Clerk — check Clerk docs for the current recommended svix version
- **node-cron process exit**: verify `cron.schedule()` does not prevent graceful shutdown; may need `{ scheduled: true }` option + explicit `task.destroy()` in shutdown handler
- **audit FOR UPDATE serialization**: test concurrent `writeAuditEntry` calls in CI (race condition test in T14) — if deadlocks occur, upgrade isolation to `SERIALIZABLE` transaction
- **Drizzle `numeric` return type**: Drizzle returns `numeric(5,2)` columns as strings in Node. `rate_pct` will be a `string`, not a `number`. Cast with `Number(rate_pct)` in commission calc — TDD tests must cover this edge
- **`ingestConversion` attribution fallback (D-M)**: attribution resolves `click_id` (in-window) → else `finder_code` (optional body field) → else throws `attribution_not_found` which the route returns as a 4xx (422) so financeiro retries/alerts (NEVER a silent drop). Truly direct sales with neither click_id nor finder_code remain a known v1.0 gap (post-v1.0 `direct_sale` path), but they now surface as a 422 instead of vanishing
- **`CLERK_WEBHOOK_SIGNING_SECRET` env var**: must be added to `.env.dev.example` in BOTH `apps/api` and documented in the Clerk Dashboard setup checklist
