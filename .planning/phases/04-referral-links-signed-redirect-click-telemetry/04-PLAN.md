---
phase: "04"
name: "Referral links + signed redirect + click telemetry"
milestone: "v1.0 — FXL Finders MVP"
status: "planned"
wave: "W3"
depends_on: ["02", "03"]
plan_count: 10
mode: standard
autonomous: true
---

# Phase 04 — Referral links + signed redirect + click telemetry

**Milestone:** v1.0 — FXL Finders MVP
**Status:** ⏳ planned
**Wave:** W3 (depends on Phase 02 + Phase 03)

---

## PREREQUISITE — `/gsd:ui-phase` REQUIRED BEFORE T01

> `/gsd:ui-phase 04` MUST be run before executing any task in this phase.
> This phase has significant UI surface: the finder link generator form (app + product
> picker + price band inputs + generated-code display + copy button) and the clicks
> dashboard (list + KPICards). The UI-SPEC contract defines visual/interaction spec
> that all frontend tasks must follow.
>
> **Command to run first:**
> ```
> /gsd:ui-phase 04
> ```
> After UI-SPEC is written (`.planning/phases/04-*/04-UI-SPEC.md`), proceed with T01.

---

## Context sources (read before executing any task)

1. `.planning/plan-brief.md` — cascading decisions (READ FIRST — Wave 0, Wave 1, Wave 2)
2. `docs/superpowers/specs/2026-05-28-fxl-finders-v1-design.md` — canonical spec:
   - § 4 `referral_links` + `clicks` table schemas (Phase 04 OWNS these)
   - § 5 public referral redirect flow (steps 1–8)
   - § 6 referral flow end-to-end (steps 1–8)
3. `.planning/ROADMAP.md` — phase list and wave dependencies
4. `CLAUDE.md` — FXL contract (non-negotiable)
5. `.planning/phases/01-schema-foundation-clerk-auth-rls/01-PLAN.md` — `setTenantContext` export, DB roles, RLS conventions
6. `.planning/phases/02-apps-products-price-bands-admin/02-PLAN.md` — `apps`, `products`, `price_bands` schema and service patterns
7. `.planning/phases/03-finder-onboarding-portal-shell/03-PLAN.md` — finder portal shell structure, `FinderShell` router slots

---

## Architecture decisions (autopilot — logged inline per `/nexo:autopilot`)

| # | Decision | Choice | Reason |
|---|---|---|---|
| D1 | ULID library | `ulidx` (`pnpm add ulidx`) | `ulidx` is tree-shakable ESM-native, exports `ulid()` and `monotonicFactory()`. Ships as `ulidx` npm package — actively maintained, smaller bundle than `ulid`. Both `apps/api` and `apps/site` need ULID generation; install in each. |
| D2 | HMAC shared util | `packages/shared-utils/src/hmac.ts` (new) | Phase 05 webhook verification reuses the same HMAC sign/verify logic. Placing in `packages/shared-utils` avoids duplication. Util exports `signHmac(secret, payload)` + `verifyHmac(secret, payload, sig)` using Node `crypto` (available in both Hono and Next.js Node runtime). |
| D3 | Rate limiting | Upstash Ratelimit (`@upstash/ratelimit` + `@upstash/redis`) | Lightest option that survives distributed multi-instance deploys. Upstash Redis is already the BullMQ backing store referenced in spec § 5. No Cloudflare Turnstile in v1.0 per task constraint. In-memory rate limiting is an acceptable fallback for local dev (env variable `RATE_LIMIT_ENABLED=false` skips Upstash in dev). |
| D4 | Rate limit config | Per-IP: 60 req/min sliding window. Per-code: 300 req/min sliding window. | Matches spec § 5 step 8 requirements exactly. Both limiters instantiated in `apps/site/src/lib/rate-limit.ts`. |
| D5 | IP hashing | `sha256(ip + daily_salt)` first 16 hex chars. `daily_salt = sha256(yyyy-mm-dd + HASH_SALT_SECRET)`. | Daily rotation ensures privacy: same IP appears as different hash across days. `HASH_SALT_SECRET` is a new env var (backend-only — never `VITE_` prefixed). |
| D6 | UA family | Inline regex (no new dependency) in `apps/site/src/lib/ua-family.ts`. Ordered checks (bot/crawler → edge → opera → firefox → safari-not-chrome → chrome → unknown) so Edge/Opera (whose UAs also contain 'Chrome') are not misclassified. Full branch coverage in `apps/site/src/lib/__tests__/ua-family.test.ts` (T06, plan-brief WARN). Defaults to `'unknown'`. | Avoids a dependency for trivial classification. Phase 05+ can upgrade to full UA parser if needed. |
| D7 | `code` field format | `ulid().toLowerCase().slice(-10)` — last 10 chars of a ULID (monotonic, URL-safe). Stored UNIQUE in `referral_links.code`. | Short enough to share, unique enough at scale. ULID base32 chars are URL-safe (no encoding needed). |
| D8 | Destination URL construction + `fxl_sig` formula (plan-brief D-P — PINNED) | `link.destination_url` is stored fully-resolved at link creation time (no `?ref` placeholder — the placeholder is in the redirect handler, not the stored URL). At redirect time, the handler appends `?ref=<click_id>&fxl_sig=<fxl_sig>` where **`fxl_sig = hmac(click_id + "." + link.signature, app.webhook_signing_secret)`** (the `"."` separator is mandatory and byte-identical to plan-brief D-P) and **`link.signature = hmac([finderId, productId, quotedSetup, quotedMonthly].join(":"), app.webhook_signing_secret)`**. | Spec § 4 `referral_links.destination_url` says "full deep-link with ?ref placeholder pre-resolved" — interpreted as: the host+path is pre-resolved at creation; the `?ref` and `?fxl_sig` params are appended at click time (they depend on click_id which is minted at click time). Formula pinned per plan-brief D-P; v1.0 financeiro PERSISTS click_id + fxl_sig but verification is DEFERRED. |
| D9 | Host validation (plan-brief WARN — exact equality) | `new URL(link.destination_url).host` (or `.hostname` for bare hosts) checked with strict `=== entry` equality against each element of `app.allowed_redirect_hosts[]`. NEVER `.includes()`/`endsWith()`/substring/suffix match — a near-match like `evil-fxl.com.br` or `fxl.com.br.attacker.com` MUST be rejected. Throws if URL is unparseable. | Open-redirect defense per task constraint. Exact equality only; covered by `validateDestinationHost` near-match test (T04) + `click-handler` host-mismatch→500 test (T06). |
| D10 | `clicks` table org scoping | `clicks` rows carry `finder_id uuid` (denormalized from `referral_links.finder_id`). RLS on `clicks` uses `finder_id` join to `finders.org_id` — but since `clicks` is public-write (the /r/:code handler inserts without Clerk auth), RLS is skipped for INSERT (the insert uses a dedicated service function that runs as `fxl_finders_app` outside RLS). SELECT is scoped by finder_id match. **Simplification:** for v1.0, apply RLS to `clicks` using `org_id` column (denormalize `org_id` onto each click row from `referral_links.finder_id → finders.org_id`). | Cleanest pattern consistent with Phase 01 RLS design: every tenant-scoped table has `org_id text NOT NULL`. `clicks` gets `org_id` denormalized at insert time from the referral_link's finder org. |
| D11 | `referral_links` RLS (plan-brief D-E — split SELECT) | Tenant-scoped by `finder_id → finders.org_id`. Add `org_id text NOT NULL` column to `referral_links` (denormalized) for direct RLS. Finder dashboard reads its own links via the tenant policy. **Plan-brief D-E: ALSO add a PERMISSIVE `FOR SELECT` policy `referral_links_public_lookup TO fxl_finders_app USING (true)`** so the public `/r/[code]` handler (NO Clerk JWT, NO tenant context) can resolve a link by `code` — the 10-char code is the bearer secret. Without this policy `/r/[code]` returns 410 for every valid code. INSERT/UPDATE stay tenant-scoped (no public mutation). Admin reads via `getAdminDb()` BYPASSRLS connection (plan-brief D-C). | Consistent with FXL contract + the split-RLS public-read family (same as `clicks` public-write). |
| D12 | clicks dashboard data | Finder-specific clicks fetched via `GET /api/v1/links/:linkId/clicks` (paginated). KPI counts via `GET /api/v1/finder/clicks/stats`. Conversion rate placeholder shows `—` until Phase 05 delivers conversion data. | Minimal new endpoints; reuses Hono domain pattern. |
| D13 | /r/[code] runtime | Node.js runtime (not Edge). `export const runtime = 'nodejs'` in the route handler. Needs Node `crypto` for HMAC + sha256 + DB access. | Edge runtime lacks full Node crypto API. Node runtime is correct per task constraint. |
| D14 | Cookie attributes (plan-brief D-R) | No explicit `Domain` attribute on `fxl_ref` cookie (browser defaults to exact host). `HttpOnly=true`, `Secure` (always set — per spec; `click_id` is already in the URL so JS read is never needed), `SameSite=Lax`, `Max-Age=7776000` (90 days in seconds). | Per plan-brief D-R (finding tagged Phase 06). SameSite=Lax allows the cookie to be sent on top-level navigations (the 302 redirect) but not cross-site sub-resources. `Secure` is always present because the production redirect target is https; local dev over http simply ignores it without breaking the redirect. |

---

## Hard FK constraints (Phase 01 soft FKs promoted)

Phase 01 shipped `leads.link_id uuid` and `leads.click_id text` as **soft FKs** (no `references()`). Phase 04 adds the actual `referral_links` and `clicks` tables, then promotes these to **hard FK constraints** via a migration:

```sql
-- Phase 04 migration: add FK constraints from leads to new tables
ALTER TABLE leads
  ADD CONSTRAINT leads_link_id_fk FOREIGN KEY (link_id) REFERENCES referral_links(id),
  ADD CONSTRAINT leads_click_id_fk FOREIGN KEY (click_id) REFERENCES clicks(click_id);
```

This migration runs after the `referral_links` + `clicks` table creation migration.

---

## Plan summary (10 plans across 4 waves)

| Plan | ID | Wave | Objective |
|---|---|---|---|
| P01 | `04-P01` | W1 | `packages/shared-utils` — HMAC sign/verify util + TDD tests |
| P02 | `04-P02` | W1 | Drizzle schema — `referral_links` + `clicks` tables + hard FK migration on `leads` |
| P03 | `04-P03` | W1 | RLS policies for `referral_links` + `clicks` (hand-authored SQL migration) |
| P04 | `04-P04` | W2 | `apps/api` links domain — service (`resolveFinderId`, band validation, HMAC sign, ULID code gen, tx-scoped tenant fns) + TDD + cross-tenant RLS test |
| P05 | `04-P05` | W2 | `apps/api` links + finder domains — Hono routes (`/api/v1/links/*`) + first-class `finderRouter` (`/finder/apps`, `/finder/apps/:appId/products`, `/finder/clicks` paginated, `/finder/clicks/stats`) under `clerkAuthMiddleware` |
| P06 | `04-P06` | W2 | `apps/site` `/r/[code]` — Next.js Route Handler (redirect + click insert + cookie) |
| P07 | `04-P07` | W2 | `apps/site` `/r/[code]` — Upstash Ratelimit integration (per-IP + per-code) |
| P08 | `04-P08` | W3 | `apps/web` — link generator UI (form + generated code display + copy button) |
| P09 | `04-P09` | W3 | `apps/web` — clicks dashboard (list + KPICards) |
| P10 | `04-P10` | W4 | Type-check + lint gate (all apps + packages) |

---

## Tasks

---

### T01 · `packages/shared-utils` — HMAC sign/verify utility

**Plan:** `04-P01` — Wave 1
**Files:**
- `packages/shared-utils/src/hmac.ts` (new)
- `packages/shared-utils/src/__tests__/hmac.test.ts` (new — TDD)
- `packages/shared-utils/package.json` (verify `exports` field includes new file)

<read_first>
- `packages/shared-utils/package.json` — current exports field, existing dependencies, package name
- `packages/shared-utils/src/index.ts` — barrel export pattern (add new exports)
- `docs/superpowers/specs/2026-05-28-fxl-finders-v1-design.md` § 5 — HMAC signature format: `hmac_sha256(secret, ts + "." + raw_body)` for webhooks; for referral URL sig: `hmac_sha256(app.webhook_signing_secret, click_id + "." + link.signature)`
- `.planning/plan-brief.md` — Wave 0: webhook_signing_secret is plaintext in DB; used for both outbound referral sig + inbound webhook verify
- `CLAUDE.md` — named exports only; strict TypeScript; no `any`
</read_first>

<action>
Create `packages/shared-utils/src/hmac.ts`:

Named exports:
- `signHmac(secret: string, payload: string): string` — computes `crypto.createHmac('sha256', secret).update(payload).digest('hex')`. Uses Node built-in `crypto` only. Returns lowercase hex string.
- `verifyHmac(secret: string, payload: string, expectedSig: string): boolean` — recomputes `signHmac(secret, payload)` then constant-time compares via `crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(expectedSig))`. Returns `false` if lengths differ (timing-safe). Used by Phase 05 webhook handler to verify inbound signatures.
- `signReferralUrl(webhookSigningSecret: string, clickId: string, linkSignature: string): string` — convenience wrapper: `signHmac(webhookSigningSecret, clickId + '.' + linkSignature)`. This is the `fxl_sig` appended to the redirect URL.
- `verifyReferralSig(webhookSigningSecret: string, clickId: string, linkSignature: string, sig: string): boolean` — convenience wrapper: `verifyHmac(webhookSigningSecret, clickId + '.' + linkSignature, sig)`. Used by sibling apps to verify the `?fxl_sig` param.
- `hashIp(ip: string, dailySalt: string): string` — `crypto.createHash('sha256').update(ip + dailySalt).digest('hex').slice(0, 16)`. Returns first 16 hex chars of sha256(ip + dailySalt). Called from the /r/[code] handler.
- `dailySalt(date: Date, hashSaltSecret: string): string` — `crypto.createHash('sha256').update(date.toISOString().slice(0, 10) + hashSaltSecret).digest('hex')`. Produces the daily rotating salt.

Create `packages/shared-utils/src/__tests__/hmac.test.ts` with Vitest unit tests:
- `signHmac` returns a 64-char hex string (SHA-256 output)
- `signHmac('secret', 'payload')` is deterministic (same output on repeated calls)
- `verifyHmac('secret', 'payload', signHmac('secret', 'payload'))` returns `true`
- `verifyHmac('secret', 'payload', 'bad_sig')` returns `false`
- `verifyHmac('secret', 'payload', signHmac('wrong_secret', 'payload'))` returns `false`
- `signReferralUrl` and `verifyReferralSig` round-trip correctly
- `hashIp` returns a 16-char string (slice of hex)
- `dailySalt` with same date + secret is deterministic; different date → different salt

Autopilot decision D2 applies. Update `packages/shared-utils/src/index.ts` to barrel-export all new named exports.
</action>

<acceptance_criteria>
- [ ] `packages/shared-utils/src/hmac.ts` exports: `signHmac`, `verifyHmac`, `signReferralUrl`, `verifyReferralSig`, `hashIp`, `dailySalt`
- [ ] `verifyHmac` uses `crypto.timingSafeEqual` (not `===`) for constant-time compare
- [ ] All unit tests in `__tests__/hmac.test.ts` pass: `pnpm --filter @fxl-finders/shared-utils test`
- [ ] No third-party dependency — Node built-in `crypto` only
- [ ] Named exports only; no default export; no `any`
- [ ] `pnpm --filter @fxl-finders/shared-utils type-check` (or `tsc --noEmit`) exits 0
- [ ] `packages/shared-utils/src/index.ts` barrel-exports all new functions
</acceptance_criteria>

---

### T02 · Drizzle schema — `referral_links` + `clicks` tables

**Plan:** `04-P02` — Wave 1
**Files:**
- `apps/api/src/db/schema.ts` (update — add `referralLinks` + `clicks` table definitions)

<read_first>
- `apps/api/src/db/schema.ts` — existing table definitions; import list; Drizzle builder patterns already in use (`pgTable`, `uuid`, `text`, `integer`, `timestamp`, `index`, `uniqueIndex`)
- `docs/superpowers/specs/2026-05-28-fxl-finders-v1-design.md` § 4 `referral_links` + `clicks` schemas (authoritative column list)
- `.planning/plan-brief.md` — D10, D11: `org_id text NOT NULL` on both tables (denormalized for RLS)
- `.planning/phases/01-schema-foundation-clerk-auth-rls/01-PLAN.md` — T08: `leads` schema with soft FKs (`link_id uuid`, `click_id text`)
- `CLAUDE.md` — money = `integer` cents; no `any`; named exports
</read_first>

<action>
Add to `apps/api/src/db/schema.ts`:

```
referralLinks table:
  id: uuid PK defaultRandom
  org_id: text NOT NULL (denormalized from finders.org_id for RLS — autopilot D11)
  code: text UNIQUE NOT NULL (10-char ULID suffix — autopilot D7)
  finder_id: uuid NOT NULL references finders(id)
  app_id: uuid NOT NULL references apps(id)
  product_id: uuid NOT NULL references products(id)
  quoted_setup_brl: integer NOT NULL (cents)
  quoted_monthly_brl: integer NOT NULL (cents)
  signature: text NOT NULL (hmac_sha256(finder_id+product_id+quoted_setup+quoted_monthly, app.webhook_signing_secret))
  destination_url: text NOT NULL (full deep-link host+path, resolved at creation)
  status: text NOT NULL (default 'active' — 'active' | 'revoked')
  expires_at: timestamptz nullable (null = never expires)
  revoked_at: timestamptz nullable
  revoked_reason: text nullable
  created_at: timestamptz NOT NULL DEFAULT now()
  updated_at: timestamptz nullable
```

```
clicks table:
  id: uuid PK defaultRandom
  click_id: text UNIQUE NOT NULL (ULID minted at redirect time — the opaque attribution ID)
  org_id: text NOT NULL (denormalized from referral_links.org_id for RLS — autopilot D10)
  link_id: uuid NOT NULL references referral_links(id)
  finder_id: uuid NOT NULL (denormalized for fast finder dashboards)
  app_id: uuid NOT NULL (denormalized)
  product_id: uuid NOT NULL (denormalized)
  ip_hash: text nullable (sha256(ip+daily_salt) first 16 chars — autopilot D5)
  ua_family: text nullable ('chrome'|'safari'|'firefox'|'edge'|'opera'|'bot'|'unknown')
  referer: text nullable
  utm_source: text nullable
  utm_medium: text nullable
  utm_campaign: text nullable
  country: text nullable (2-letter ISO code from CF-IPCountry header or null)
  created_at: timestamptz NOT NULL DEFAULT now()
  (no updated_at — append-only)
```

Indexes (Drizzle `index()` builder):
- `referralLinks`: `uniqueIndex('referral_links_code_idx').on(t.code)` (already covered by UNIQUE but explicit for Drizzle)
- `clicks`: `index('clicks_link_id_created_at_idx').on(t.linkId, t.createdAt)` (DESC direction via Drizzle `.desc()` on createdAt)
- `clicks`: `index('clicks_finder_id_created_at_idx').on(t.finderId, t.createdAt)` (DESC)

Note: Drizzle does not support `DESC` index direction via the `index()` builder in all versions — if DESC is unsupported, create the index as ASC and document that the DB migration SQL will be amended to add the DESC direction manually (like the RLS migration pattern from Phase 01).
</action>

<acceptance_criteria>
- [ ] `referralLinks` exported from `schema.ts` with all columns listed above
- [ ] `clicks` exported from `schema.ts` with all columns listed above
- [ ] Both tables have `org_id text NOT NULL` (RLS requirement)
- [ ] `clicks` has NO `updated_at` (append-only per spec)
- [ ] `clicks` has `INDEX(link_id, created_at DESC)` and `INDEX(finder_id, created_at DESC)` (or documented as manual SQL amendment)
- [ ] All money columns are `integer` (cents) — no `numeric`/`float`
- [ ] `click_id` is `text UNIQUE NOT NULL` (not a UUID — it is a ULID string)
- [ ] `pnpm --filter @fxl-finders/api type-check` exits 0
</acceptance_criteria>

---

### T03 · Drizzle migration — generate schema + hard FK promotion + RLS policies (RLS APPENDED INTO journaled migration — plan-brief D-F)

**Plan:** `04-P02` + `04-P03` — Wave 1 (sequential: generate first, then append RLS into the SAME generated file)
**Files:**
- `apps/api/drizzle/` (Drizzle-generated migration for `referral_links` + `clicks` — RLS/policy/role-grant SQL is APPENDED INTO this file, NOT a standalone `.sql`)

<read_first>
- `apps/api/drizzle/` — existing migration files; naming convention; timestamp format used by drizzle-kit; `meta/_journal.json` (the migrator only runs files registered here)
- `.planning/plan-brief.md` — **D-F** (RLS SQL goes INTO the journaled Drizzle-generated migration, never a standalone unjournaled `.sql` — the migrator skips those) + **D-E** (`referral_links_public_lookup` policy) + **D-D** (`current_setting('app.current_org_id', true)` tenant key)
- `.planning/phases/01-schema-foundation-clerk-auth-rls/01-PLAN.md` T09 + T10 — role grants pattern + the Phase 01 pattern of APPENDING RLS into the generated migration (mirror exactly; do NOT create a separate file)
- `apps/api/src/db/schema.ts` — `referralLinks` + `clicks` definitions just added in T02
- `docs/superpowers/specs/2026-05-28-fxl-finders-v1-design.md` § 4 — `clicks` is append-only; `referral_links` has `status` mutations
</read_first>

<action>
Step 1 — Generate migration:
Run `pnpm --filter @fxl-finders/api db:generate`. This emits a SQL migration with `CREATE TABLE referral_links` and `CREATE TABLE clicks`.

Step 2 — Append DB role grants to the generated migration (after CREATE TABLE statements):
```sql
-- Phase 04 role grants
-- referral_links: finder-scoped; INSERT by API, SELECT/UPDATE by fxl_finders_app
GRANT SELECT, INSERT, UPDATE ON referral_links TO fxl_finders_app;
-- clicks: append-only; INSERT by /r/:code handler (public path, uses app DB role), SELECT by fxl_finders_app
GRANT SELECT, INSERT ON clicks TO fxl_finders_app;  -- no UPDATE, no DELETE
```

Step 3 — Append hard FK promotion for `leads`:
```sql
-- Promote soft FKs from Phase 01 leads table to hard constraints
ALTER TABLE leads
  ADD CONSTRAINT leads_link_id_fk FOREIGN KEY (link_id) REFERENCES referral_links(id) ON DELETE SET NULL,
  ADD CONSTRAINT leads_click_id_fk FOREIGN KEY (click_id) REFERENCES clicks(click_id) ON DELETE SET NULL;
```
Use `ON DELETE SET NULL` so that revoking a link or deleting a click (which should not happen in production — clicks are append-only) does not cascade-delete lead records.

Step 4 — APPEND the RLS / policy SQL block below INTO the SAME Drizzle-generated migration file from Step 1 (plan-brief **D-F**). Do NOT create a standalone `<ts>_phase04_rls.sql` — the migrator only runs files registered in `apps/api/drizzle/meta/_journal.json`, and a standalone `.sql` is unjournaled and silently skipped. Append after the `CREATE TABLE` + grants + FK-promotion statements, inside the one journaled file (mirror the Phase 01 append pattern). Verify after `pnpm db:migrate` that `SELECT * FROM pg_policies` shows every policy below.

```sql
-- Phase 04 RLS: referral_links + clicks (APPENDED INTO the journaled generated migration — D-F)
-- Runs as fxl_finders_owner. Runtime role: fxl_finders_app (no BYPASSRLS).
-- Admin/cross-tenant reads use getAdminDb() BYPASSRLS conn (plan-brief D-C), not these policies.

-- ── referral_links ──────────────────────────────────────────────────
ALTER TABLE referral_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE referral_links FORCE ROW LEVEL SECURITY;

-- Tenant isolation for finder dashboard reads + all mutations
CREATE POLICY referral_links_tenant_isolation ON referral_links
  AS PERMISSIVE FOR ALL TO fxl_finders_app
  USING (org_id = current_setting('app.current_org_id', true))
  WITH CHECK (org_id = current_setting('app.current_org_id', true));

-- Plan-brief D-E: public lookup for /r/[code] (NO JWT, NO tenant context).
-- The 10-char code is the bearer secret. Without this, /r/[code] returns 410 for
-- every valid code because the tenant policy's current_setting() is empty (-> false).
-- SELECT-only and additive (PERMISSIVE OR-combines with the tenant policy).
CREATE POLICY referral_links_public_lookup ON referral_links
  AS PERMISSIVE FOR SELECT TO fxl_finders_app
  USING (true);

-- ── clicks ──────────────────────────────────────────────────────────
-- clicks is append-only. The INSERT path (/r/:code handler) runs WITHOUT
-- tenant context (it is a public endpoint). The SELECT path (finder dashboard)
-- runs WITH tenant context. We split the policy:

ALTER TABLE clicks ENABLE ROW LEVEL SECURITY;
ALTER TABLE clicks FORCE ROW LEVEL SECURITY;

-- Allow INSERT without tenant context (public click handler inserts directly)
CREATE POLICY clicks_insert_public ON clicks
  AS PERMISSIVE FOR INSERT TO fxl_finders_app
  WITH CHECK (true);  -- inserts validated by application logic, not RLS

-- Allow SELECT only for own org
CREATE POLICY clicks_select_tenant ON clicks
  AS PERMISSIVE FOR SELECT TO fxl_finders_app
  USING (org_id = current_setting('app.current_org_id', true));

-- No UPDATE or DELETE policy (append-only; fxl_finders_app has no UPDATE/DELETE grant)

-- ── Click index hint (if DESC not emitted by drizzle-kit) ───────────
-- If drizzle-kit did not emit DESC indexes, add them inline IN THIS SAME journaled
-- migration (NOT a standalone file). NOTE: do NOT use CREATE INDEX CONCURRENTLY
-- inside the migration — Drizzle wraps each migration in a transaction and
-- CONCURRENTLY cannot run in a transaction block. Use plain CREATE INDEX:
-- CREATE INDEX IF NOT EXISTS clicks_link_id_created_at_idx
--   ON clicks (link_id, created_at DESC);
-- CREATE INDEX IF NOT EXISTS clicks_finder_id_created_at_idx
--   ON clicks (finder_id, created_at DESC);
-- (Uncomment only if drizzle-generated indexes are ASC-only)
```

Step 5 — Add an RLS integration test for the `referral_links_public_lookup` policy (plan-brief D-E acceptance). Add `apps/api/test/rls/referral-links-public-lookup.test.ts` (vitest integration project, connects as `fxl_finders_app` per plan-brief D-G — superuser bypasses RLS so it proves nothing):
  - Seed a `referral_links` row for org A (via owner/admin connection).
  - As `fxl_finders_app` with NO tenant context set (`app.current_org_id` unset — mirrors /r/[code]): `SELECT * FROM referral_links WHERE code = $code` returns exactly 1 row. This is the test that distinguishes a valid-code-302 from the bug where missing-policy yields 410.
  - As `fxl_finders_app` WITH org B tenant context set: the finder-dashboard query `SELECT * FROM referral_links WHERE finder_id = $orgB_finder` returns 0 rows for org A's link (cross-tenant isolation still holds on the tenant policy — the public policy is SELECT-only and only widens code lookups, it does not leak org A links into org B's dashboard list because the dashboard query is by finder_id).
  - Assert: public lookup by code succeeds with no org context (would be the 410 bug otherwise); tenant dashboard query stays org-isolated.
</action>

<acceptance_criteria>
- [ ] `pnpm --filter @fxl-finders/api db:generate` exits 0 and emits a migration with `CREATE TABLE referral_links` + `CREATE TABLE clicks`
- [ ] Generated migration includes `GRANT SELECT, INSERT, UPDATE ON referral_links TO fxl_finders_app`
- [ ] Generated migration includes `GRANT SELECT, INSERT ON clicks TO fxl_finders_app` (no UPDATE/DELETE)
- [ ] `leads` FK promotion present: `ADD CONSTRAINT leads_link_id_fk FOREIGN KEY (link_id) REFERENCES referral_links(id)`
- [ ] `leads` FK promotion present: `ADD CONSTRAINT leads_click_id_fk FOREIGN KEY (click_id) REFERENCES clicks(click_id)`
- [ ] Both use `ON DELETE SET NULL`
- [ ] RLS / policy / role-grant SQL is APPENDED INTO the Drizzle-generated migration file (plan-brief D-F) — NOT a standalone `<ts>_phase04_rls.sql`. After `pnpm --filter @fxl-finders/api db:migrate`, `SELECT * FROM pg_policies WHERE tablename IN ('referral_links','clicks')` returns all 4 policies (proves the SQL ran via the journal, not skipped)
- [ ] The generated migration file's hash is registered in `apps/api/drizzle/meta/_journal.json` (no unjournaled `.sql` exists in `apps/api/drizzle/`)
- [ ] `FORCE ROW LEVEL SECURITY` applied to both `referral_links` and `clicks`
- [ ] `referral_links` has a `PERMISSIVE FOR ALL` tenant-isolation policy using `current_setting('app.current_org_id', true)`
- [ ] `referral_links` ALSO has `referral_links_public_lookup AS PERMISSIVE FOR SELECT TO fxl_finders_app USING (true)` (plan-brief D-E)
- [ ] `clicks` has split policies: `FOR INSERT WITH CHECK (true)` + `FOR SELECT USING (org_id = ...)`
- [ ] Integration test `apps/api/test/rls/referral-links-public-lookup.test.ts` exists and passes (connects as `fxl_finders_app`): a valid `code` lookup with NO tenant context returns 1 row (the D-E acceptance: valid code -> resolvable -> 302, not 410); cross-tenant dashboard query by `finder_id` stays 0 rows for another org
- [ ] No `CREATE INDEX CONCURRENTLY` appears inside the journaled migration (cannot run in a transaction block)
- [ ] `pnpm --filter @fxl-finders/api type-check` exits 0
</acceptance_criteria>

---

### T04 · `apps/api` — links service: band validation + HMAC signing + ULID code gen (TDD)

**Plan:** `04-P04` — Wave 2 (after T01 + T02 + T03)
**Files:**
- `apps/api/src/domains/links/service.ts` (new — includes `resolveFinderId`)
- `apps/api/src/domains/links/__tests__/service.test.ts` (new — TDD, includes `resolveFinderId` + exact-host cases)
- `apps/api/test/rls/list-finder-links-cross-tenant.test.ts` (new — D-D cross-tenant integration test, connects as `fxl_finders_app` per D-G)

<read_first>
- `apps/api/src/db/schema.ts` — `referralLinks`, `clicks`, `priceBands`, `apps`, `finders` table column names (`finders.id` UUID PK, `finders.clerk_user_id`, `finders.org_id`)
- `packages/shared-utils/src/hmac.ts` — `signHmac` signature (T01)
- `packages/shared-utils/src/index.ts` — barrel export path for import
- `docs/superpowers/specs/2026-05-28-fxl-finders-v1-design.md` § 4 `referral_links` schema — `signature` field formula: `hmac_sha256(finder_id + product_id + quoted_setup + quoted_monthly, app.webhook_signing_secret)`; § 6 step 3 API behavior
- `.planning/plan-brief.md` — D1: `ulidx` for ULID; D7: code = `ulid().toLowerCase().slice(-10)`; D9: host validation = exact hostname compare; **D-P**: pinned `link.signature = hmac([finderId,productId,quotedSetup,quotedMonthly].join(":"), secret)`; **D-D**: `setTenantContext(tx, orgId)` is transaction-scoped — every tenant-scoped fn wraps in `db.transaction(async (tx) => { await setTenantContext(tx, orgId); /* queries via tx */ })`; **D-H**: `getDb()` lazy (no `db` singleton)
- `apps/api/src/middleware/auth.ts` (or wherever Phase 01 exports them) — `clerkAuthMiddleware` (plan-brief D-B; was `authMiddleware`, kept as alias) + `setTenantContext(tx, orgId)` transaction-scoped helper
- `apps/api/src/db/schema.ts` — `finders` table: `id uuid` PK, `clerk_user_id text`, `org_id text` (the columns `resolveFinderId` queries)
- `CLAUDE.md` — named exports; strict TypeScript; no `any`; Zod schemas in service.ts; FXL domain pattern
</read_first>

<action>
**TDD sequence: write tests first, then implementation.**

Create `apps/api/src/domains/links/__tests__/service.test.ts` with these test cases (before writing the implementation):

1. `validatePriceBand(band, quotedBrl)`:
   - Returns `true` when `quotedBrl` is within `[band.minBrl, band.maxBrl]` inclusive
   - Returns `false` when `quotedBrl < band.minBrl`
   - Returns `false` when `quotedBrl > band.maxBrl`
   - Returns `true` when `quotedBrl === band.minBrl` (boundary inclusive)
   - Returns `true` when `quotedBrl === band.maxBrl` (boundary inclusive)

2. `buildLinkSignature(finderId, productId, quotedSetupBrl, quotedMonthlyBrl, webhookSigningSecret)`:
   - Returns a non-empty string (64-char hex)
   - Is deterministic (same inputs → same output)
   - Changes when any input changes

3. `buildLinkCode()`:
   - Returns a string of length 10
   - Returns a string containing only lowercase alphanumeric chars (ULID base32 set)
   - Returns different values on repeated calls (non-deterministic — assert `!==`)

4. `validateDestinationHost(destinationUrl, allowedHosts)`:
   - Returns `true` when URL host EXACTLY equals one allowed host (`=== entry`)
   - Returns `false` when host is not in allowed list
   - Returns `false` when URL has a different subdomain (e.g., allowed='app.fxl.com.br', url host 'other.fxl.com.br')
   - **Returns `false` for a substring/suffix near-match** (e.g., allowed='fxl.com.br', url host 'evil-fxl.com.br' OR 'fxl.com.br.attacker.com') — proves exact equality, NOT `.includes()`/`endsWith()` (plan-brief WARN)
   - Throws when URL is not parseable (e.g., 'not-a-url')
   - Returns `false` for empty `allowedHosts[]`

5. `resolveFinderId(db, clerkUserId)` (NEW — D resolution helper):
   - Returns the `finders.id` UUID when a `finders` row matches `clerk_user_id`
   - Throws `Error('finder_not_found')` when no row matches (asserts on the thrown message)
   - Returned value is a UUID string, NOT the input `user_*` Clerk string (assert `result !== clerkUserId`)
   - (Use the integration-test DB harness / a stubbed `tx` as appropriate; this is the unit-level contract — the cross-tenant behavior is covered by the integration test in `apps/api/test/rls/list-finder-links-cross-tenant.test.ts`.)

Then implement `apps/api/src/domains/links/service.ts`:

Zod schemas (named exports):
- `CreateLinkSchema`: `{ appId: z.string().uuid(), productId: z.string().uuid(), quotedSetupBrl: z.number().int().nonnegative(), quotedMonthlyBrl: z.number().int().nonnegative() }`
- `RevokeLinkSchema`: `{ reason: z.string().min(1).max(255).optional() }`

Service functions (named exports):
- `validatePriceBand(band: { minBrl: number; maxBrl: number }, quotedBrl: number): boolean` — returns `quotedBrl >= band.minBrl && quotedBrl <= band.maxBrl`
- `buildLinkSignature(finderId: string, productId: string, quotedSetupBrl: number, quotedMonthlyBrl: number, webhookSigningSecret: string): string` — calls `signHmac(webhookSigningSecret, [finderId, productId, quotedSetupBrl, quotedMonthlyBrl].join(':'))`. **This IS `link.signature` per plan-brief D-P** — `finderId` MUST be the `finders.id` UUID (NOT the Clerk `user_*` string), so the signature is stable and verifiable against the persisted `referral_links.finder_id`.
- `buildLinkCode(): string` — imports `ulid` from `ulidx`, returns `ulid().toLowerCase().slice(-10)`
- `validateDestinationHost(destinationUrl: string, allowedHosts: string[]): boolean` — `new URL(destinationUrl).host` exact-equality (`=== entry`) against each element of `allowedHosts` (plan-brief WARN: NEVER substring/`.includes()`/suffix match); returns false if no match; throws if URL unparseable. (Uses `.host`, not `.hostname`, only if `allowed_redirect_hosts` entries may carry a port; v1.0 entries are bare hosts so `.hostname === entry` is equivalent — keep ONE consistent comparison and document which.)

- **`resolveFinderId(db, clerkUserId: string): Promise<string>` (NEW — Clerk-user-id → finders.id UUID resolution):**
  - `SELECT id FROM finders WHERE clerk_user_id = $clerkUserId LIMIT 1`
  - Returns the `finders.id` UUID string.
  - Throws `Error('finder_not_found')` when no `finders` row matches (clean 404/403 at the route boundary — NEVER pass the raw `user_*` string into `referral_links.finder_id`, which is a `finders(id)` UUID FK and would FK-violate or, worse, silently mis-scope).
  - Has its own TDD case (see test list below). Called by `createLink` / `listFinderLinks` / `revokeLink` / `getFinderClickStats` to convert the route-supplied Clerk `userId` into the `finders.id` UUID used for `finder_id`.

**D-D — every tenant-scoped service fn wraps its DB work in `db.transaction(async (tx) => { await setTenantContext(tx, orgId); /* all queries via tx */ })`** (plan-brief D-D: connection-level `set_config` does NOT survive pooling; the helper is transaction-scoped and takes the `tx` handle). `resolveFinderId` runs INSIDE the same `tx` (after `setTenantContext`) so the finders lookup is org-isolated too.

- `createLink(db, clerkUserId: string, orgId: string, input: CreateLinkInput): Promise<ReferralLinkRow>`:
  Wrap the whole body in `db.transaction(async (tx) => { await setTenantContext(tx, orgId); ... })`:
  1. `const finderId = await resolveFinderId(tx, clerkUserId)` — throws `finder_not_found` (route → 403) if no finders row
  2. Fetch `app` by `input.appId` — if not found or `status !== 'active'`, throw `Error('app_not_found')`
  3. Fetch `product` by `input.productId` where `product.appId === input.appId` — if not found, throw `Error('product_not_found')`
  4. Fetch `price_bands` for `input.productId` — expect rows for `'setup'` and `'monthly'` components
  5. Validate `input.quotedSetupBrl` against setup band — if fails, throw `Error('quoted_setup_out_of_band')`
  6. Validate `input.quotedMonthlyBrl` against monthly band — if fails, throw `Error('quoted_monthly_out_of_band')`
  7. Validate `app.allowed_redirect_hosts` is non-empty (at least one host configured) — else throw `Error('app_redirect_hosts_unconfigured')`
  8. Build `destination_url` = first allowed host + canonical path. **Autopilot/NIT (documented assumption): `destination_url = 'https://' + app.allowed_redirect_hosts[0] + '/precos'`** — `allowed_redirect_hosts[0]` is treated as the CANONICAL host and `/precos` as the canonical pricing path. This is an opinionated v1.0 convention (per-app configurable path deferred). The `?ref`/`?fxl_sig` params are NOT part of `destination_url` (added at redirect time per D8/D-P).
  9. Compute `signature = buildLinkSignature(finderId, product.id, quotedSetupBrl, quotedMonthlyBrl, app.webhookSigningSecret)` — `finderId` here is the resolved `finders.id` UUID (D-P invariant)
  10. Generate `code = buildLinkCode()`
  11. INSERT into `referral_links` via `tx` with `finder_id = finderId` (UUID), `org_id = orgId`, and all other fields
  12. Return the inserted row

- `listFinderLinks(db, orgId: string, clerkUserId: string): Promise<ReferralLinkRow[]>`:
  - `db.transaction(async (tx) => { await setTenantContext(tx, orgId); const finderId = await resolveFinderId(tx, clerkUserId); ... })`
  - `SELECT * FROM referral_links WHERE finder_id = $finderId ORDER BY created_at DESC` (via `tx`)
  - Returns array (never undefined — empty array if no links)
  - **Cross-tenant integration test required (D-D): a finder in org B calling `listFinderLinks` must NOT see org A's links — even with a forged/foreign finderId, the `setTenantContext(tx, orgB)` + RLS tenant policy returns 0 rows.** Add `apps/api/test/rls/list-finder-links-cross-tenant.test.ts` (connects as `fxl_finders_app` per D-G): seed org A link; call `listFinderLinks` under org B context; assert empty; positive control: under org A context returns the row.

- `revokeLink(db, linkId: string, orgId: string, clerkUserId: string, reason?: string): Promise<void>`:
  - `db.transaction(async (tx) => { await setTenantContext(tx, orgId); const finderId = await resolveFinderId(tx, clerkUserId); ... })`
  - `UPDATE referral_links SET status = 'revoked', revoked_at = now(), revoked_reason = $reason WHERE id = $linkId AND finder_id = $finderId AND org_id = $orgId` (via `tx`)
  - Throws `Error('link_not_found')` if 0 rows updated

- `getFinderClickStats(db, orgId: string, clerkUserId: string): Promise<{ total: number; unique: number }>`:
  - `db.transaction(async (tx) => { await setTenantContext(tx, orgId); const finderId = await resolveFinderId(tx, clerkUserId); ... })`
  - `SELECT COUNT(*) as total, COUNT(DISTINCT ip_hash) as unique FROM clicks WHERE finder_id = $finderId` (via `tx`)
  - Returns `{ total, unique }` (conversion rate is `—` until Phase 05 — NOT computed here)

- `listFinderClicks(db, orgId: string, clerkUserId: string, opts: { linkId?: string; limit?: number; cursor?: string }): Promise<{ clicks: ClickRow[]; nextCursor: string | null }>` (powers the T05 `GET /api/v1/finder/clicks` paginated route):
  - `db.transaction(async (tx) => { await setTenantContext(tx, orgId); const finderId = await resolveFinderId(tx, clerkUserId); ... })`
  - Clamp `limit` to `Math.min(opts.limit ?? 50, 100)`
  - `SELECT clicks.* WHERE finder_id = $finderId [AND link_id = $opts.linkId] [AND created_at < $opts.cursor] ORDER BY created_at DESC LIMIT $limit` (via `tx`)
  - `nextCursor` = `created_at` of the last row when a full page is returned, else `null`
  - Returns `{ clicks, nextCursor }` (org-isolation enforced by the `clicks_select_tenant` RLS policy)
</action>

<acceptance_criteria>
- [ ] `apps/api/src/domains/links/__tests__/service.test.ts` exists and all TDD tests pass BEFORE implementation is written (RED → GREEN sequence)
- [ ] `validatePriceBand` — 5 test cases all pass
- [ ] `buildLinkSignature` — deterministic + changes on input change; uses `[finderId,productId,quotedSetup,quotedMonthly].join(":")` exactly (plan-brief D-P `link.signature` formula); `finderId` is the `finders.id` UUID
- [ ] `buildLinkCode` — length=10, lowercase alphanumeric, non-deterministic
- [ ] `validateDestinationHost` — EXACT host equality (`=== entry`); throws on bad URL; false on subdomain mismatch; **false on substring/suffix near-match (`evil-fxl.com.br`, `fxl.com.br.attacker.com`)** — never `.includes()`/`endsWith()` (plan-brief WARN)
- [ ] `resolveFinderId(db, clerkUserId)` returns the `finders.id` UUID and throws `finder_not_found` when no row matches; never returns the raw `user_*` string
- [ ] `createLink` / `listFinderLinks` / `revokeLink` / `getFinderClickStats` accept the Clerk `userId` string and call `resolveFinderId` to obtain the `finders.id` UUID — `referral_links.finder_id` / `clicks.finder_id` filters use the UUID, NEVER the Clerk `user_*` string (plan-brief Clerk-resolution fix)
- [ ] `createLink` fetches app + product + price bands before inserting
- [ ] `createLink` throws on out-of-band quotes (not silently clamps)
- [ ] All four tenant-scoped fns wrap their body in `db.transaction(async (tx) => { await setTenantContext(tx, orgId); /* queries + resolveFinderId via tx */ })` (plan-brief D-D — transaction-scoped, takes the `tx` handle; connection-level set_config does not survive pooling)
- [ ] `revokeLink` uses `AND finder_id = $finderId AND org_id = $orgId` in WHERE clause (double-check: no cross-org revoke possible even if linkId known)
- [ ] Cross-tenant integration test `apps/api/test/rls/list-finder-links-cross-tenant.test.ts` passes: org A link is invisible to `listFinderLinks` under org B context; positive control returns it under org A context (plan-brief D-D)
- [ ] `pnpm --filter @fxl-finders/api test` (unit project) passes including new tests
- [ ] `pnpm --filter @fxl-finders/api type-check` exits 0
- [ ] No `any`; named exports only; Zod schemas exported from service
</acceptance_criteria>

---

### T05 · `apps/api` — links Hono routes + finder clicks stats route

**Plan:** `04-P05` — Wave 2 (after T04)
**Files:**
- `apps/api/src/domains/links/routes.ts` (new — `linksRouter`)
- `apps/api/src/domains/finder/routes.ts` (new — `finderRouter`: `GET /apps`, `GET /clicks` paginated, `GET /clicks/stats`)
- `apps/api/src/domains/links/service.ts` (update — add `listFinderClicks` paginated service fn if not already in T04)
- `apps/api/src/server.ts` (update — mount links + finder routers under `clerkAuthMiddleware`)

<read_first>
- `apps/api/src/domains/links/service.ts` — all service function signatures (T04); note all take the Clerk `userId` string and resolve to `finders.id` internally via `resolveFinderId`
- `apps/api/src/middleware/auth.ts` (Phase 01) — **`clerkAuthMiddleware`** (plan-brief D-B: renamed from `authMiddleware`, which remains as an alias) + `setTenantContext(tx, orgId)`; context vars `c.get('orgId')`, `c.get('userId')`, `c.get('userRole')` (augmented `ContextVariableMap` per D-B)
- `apps/api/src/server.ts` — mount pattern; existing router registrations (plan-brief D-R: server.ts is the mount point, NOT index.ts)
- `apps/api/src/domains/admin/apps/routes.ts` — Hono router pattern + the admin `listApps`/`listProducts` service fns (reuse the SERVICE functions for the finder read endpoints; the admin ROUTES are role-gated by `requireAdmin` and MUST NOT be reused as finder routes)
- `CLAUDE.md` — Hono domain pattern: routes.ts + service.ts; named exports; no `any`
- `docs/superpowers/specs/2026-05-28-fxl-finders-v1-design.md` § 6 step 3 — API creates link, returns code + full URL
</read_first>

<action>
Create `apps/api/src/domains/links/routes.ts`:

Named export `linksRouter` as `new Hono()`. All routes apply **`clerkAuthMiddleware`** (plan-brief D-B; finder JWT required).

Links endpoints:
- `POST /` → parse `CreateLinkSchema` body → extract `orgId = c.get('orgId')`, `userId = c.get('userId')` → call `createLink(getDb(), userId, orgId, body)` (service resolves `userId` → `finders.id` via `resolveFinderId`) → 201 + `{ link, fullUrl }` where `fullUrl = (process.env.SITE_URL ?? 'http://localhost:4006') + '/r/' + link.code`
- `GET /` → call `listFinderLinks(getDb(), orgId, userId)` → 200 + `{ links: ReferralLinkRow[] }`
- `DELETE /:linkId` → parse `RevokeLinkSchema` body (reason optional) → call `revokeLink(getDb(), linkId, orgId, userId, body.reason)` → 204 on success; 404 if `link_not_found` error thrown

Create `apps/api/src/domains/finder/routes.ts` (NEW — finder-auth read endpoints; named export `finderRouter`). All routes apply `clerkAuthMiddleware`. These are FIRST-CLASS finder-authed endpoints — do NOT reuse `useAdminApps`/admin routes (admin routes are `requireAdmin` role-gated). Reuse only the admin domain SERVICE functions (e.g. `listActiveApps`, `listActiveProducts`) where they accept no admin-only context, otherwise add finder-scoped service reads.

- `GET /apps` → mount path `GET /api/v1/finder/apps`. Returns active apps for the link-generator dropdown: `{ apps: { id, name, slug }[] }` (only `status='active'`; expose ONLY display fields the finder needs — never `secret_key_hash`, `webhook_signing_secret`, or other secrets). Source: call the admin domain's active-apps SERVICE fn (cross-tenant `apps` table has NO RLS — read directly; do NOT call `setTenantContext`).
- `GET /apps/:appId/products` → mount path `GET /api/v1/finder/apps/:appId/products`. Returns active products for the chosen app + their price bands (for the band-hint UI): `{ products: { id, name, slug, setupBand: { minBrl, listBrl, maxBrl }, monthlyBand: { minBrl, listBrl, maxBrl } }[] }` (only `status='active'`; cross-tenant `products`/`price_bands` have NO RLS — read directly, NO `setTenantContext`). Powers the T08 `useFinderProducts(appId)` hook. Do NOT reuse the role-gated admin products route.
- `GET /clicks` → mount path `GET /api/v1/finder/clicks` (PAGINATED). Query params: `linkId?` (uuid), `limit?` (default 50, max 100), `cursor?` (ISO timestamp). Call a new service fn `listFinderClicks(getDb(), orgId, userId, { linkId, limit, cursor })` (add to T04 service if not present — wraps in `db.transaction` + `setTenantContext(tx, orgId)` + `resolveFinderId`, `SELECT clicks.* WHERE finder_id = $finderId [AND link_id = $linkId] [AND created_at < $cursor] ORDER BY created_at DESC LIMIT $limit`). Returns `{ clicks: ClickRow[], nextCursor: string | null }` (do NOT expose `ip_hash`/`click_id` if the finder UI must not render them — return them only if needed; UI hides them per T09). SELECT is org-isolated by the `clicks_select_tenant` RLS policy.
- `GET /clicks/stats` → mount path `GET /api/v1/finder/clicks/stats`. Call `getFinderClickStats(getDb(), orgId, userId)` → 200 + `{ total, unique }`.

Error handling (shared error→status mapping for both routers):
- `finder_not_found` → **403 + `{ error: 'finder_not_found' }`** (authenticated Clerk user has no finders row — clean, not a 500/FK crash; plan-brief Clerk-resolution fix)
- `app_not_found` → 404 + `{ error: 'app_not_found' }`
- `product_not_found` → 404 + `{ error: 'product_not_found' }`
- `app_redirect_hosts_unconfigured` → 422 + `{ error: 'app_redirect_hosts_unconfigured' }`
- `quoted_setup_out_of_band` → 422 + `{ error: 'quoted_setup_out_of_band' }`
- `quoted_monthly_out_of_band` → 422 + `{ error: 'quoted_monthly_out_of_band' }`
- `link_not_found` → 404 + `{ error: 'link_not_found' }`
- Zod validation failures → 400

Update `apps/api/src/server.ts` (plan-brief D-R: server.ts, not index.ts):
- `import { linksRouter } from './domains/links/routes.js'`
- `import { finderRouter } from './domains/finder/routes.js'`
- `app.use('/api/v1/links/*', clerkAuthMiddleware)` then `app.route('/api/v1/links', linksRouter)`
- `app.use('/api/v1/finder/*', clerkAuthMiddleware)` then `app.route('/api/v1/finder', finderRouter)` (covers `/finder/apps`, `/finder/clicks`, `/finder/clicks/stats`)
</action>

<acceptance_criteria>
- [ ] `linksRouter` + `finderRouter` exported as named exports
- [ ] All routes apply `clerkAuthMiddleware` (plan-brief D-B name); `authMiddleware` is NOT referenced by new code (it is only a back-compat alias)
- [ ] `POST /api/v1/links` creates a link and returns `{ link, fullUrl }` where `fullUrl` includes `/r/<code>`
- [ ] `GET /api/v1/links` returns finder's links filtered by `orgId` (RLS enforced by `setTenantContext` inside the service transaction)
- [ ] `DELETE /api/v1/links/:linkId` revokes link; returns 404 if link not found or belongs to different finder
- [ ] `GET /api/v1/finder/apps` is a FIRST-CLASS finder-authed endpoint returning active apps (id, name, slug ONLY — no secrets); it does NOT reuse the role-gated admin route (admin routes are `requireAdmin`-gated)
- [ ] `GET /api/v1/finder/clicks` is PAGINATED (`linkId?`, `limit` default 50 / max 100, `cursor?`) and returns `{ clicks, nextCursor }`, org-isolated via `clicks_select_tenant` RLS
- [ ] `GET /api/v1/finder/clicks/stats` returns `{ total: number, unique: number }`
- [ ] An authenticated Clerk user with NO `finders` row gets a clean **403 `finder_not_found`** on any finder/links endpoint (not a 500 or FK violation)
- [ ] All routes return 401 without a valid Clerk JWT
- [ ] `SITE_URL` env var used for `fullUrl` construction; falls back to `http://localhost:4006`
- [ ] Routers mounted in `apps/api/src/server.ts` (NOT index.ts — plan-brief D-R)
- [ ] `pnpm --filter @fxl-finders/api type-check` exits 0
- [ ] No `any`; no default exports
</acceptance_criteria>

---

### T06 · `apps/site` — `/r/[code]` Next.js Route Handler (redirect + click insert + cookie)

**Plan:** `04-P06` — Wave 2 (after T01 + T02 + T03)
**Files:**
- `apps/site/src/app/r/[code]/route.ts` (new — Next.js App Router Route Handler)
- `apps/site/src/lib/click-handler.ts` (new — extracted logic for testability)
- `apps/site/src/lib/ua-family.ts` (new — inline UA classifier)
- `apps/site/src/lib/db.ts` (new — Drizzle/postgres-js connection for the Node-runtime route handler; uses `DATABASE_URL`)
- `apps/site/src/lib/__tests__/ua-family.test.ts` (new — TDD, plan-brief WARN)
- `apps/site/src/lib/__tests__/click-handler.test.ts` (new — branch tests: revoked→410, expired→410, host-mismatch→500, valid→302; plan-brief WARN)

<read_first>
- `docs/superpowers/specs/2026-05-28-fxl-finders-v1-design.md` § 5 "Public referral redirect" steps 1–8 (authoritative flow)
- `packages/shared-utils/src/hmac.ts` — `signReferralUrl`, `hashIp`, `dailySalt` (T01)
- `apps/api/src/db/schema.ts` — `referralLinks` + `clicks` column names (T02)
- `.planning/plan-brief.md` — D5: ip hashing; D6: UA family inline regex; D8 + **D-P**: `fxl_sig = hmac(click_id + "." + link.signature, app.webhook_signing_secret)`; D9 + WARN: host validation EXACT equality (never substring); D13: Node.js runtime; **D-R cookie**: `HttpOnly=true`, `Secure`, `SameSite=Lax`, 90-day; **D-E**: `referral_links_public_lookup` RLS policy makes the JWT-less code lookup succeed (valid code → 302, not 410)
- `apps/site/src/app/` — existing Next.js App Router file structure; any existing route.ts patterns
- `CLAUDE.md` — named exports; strict TypeScript; no `any`; `DATABASE_URL` backend-only (never VITE_)
</read_first>

<action>
Create `apps/site/src/lib/ua-family.ts`:
```
Named export: classifyUa(userAgent: string | null): string
Pattern (case-insensitive):
  - Contains 'bot'|'crawler'|'spider'|'slurp'|'facebookexternalhit' → 'bot'
  - Contains 'edg' → 'edge'
  - Contains 'opr'|'opera' → 'opera'
  - Contains 'firefox' → 'firefox'
  - Contains 'safari' but not 'chrome' → 'safari'
  - Contains 'chrome' → 'chrome'
  - Null or empty → 'unknown'
  - Fallback → 'unknown'
No external dependency.
```

Create `apps/site/src/lib/click-handler.ts`:
Named export `handleReferralClick(code: string, request: Request): Promise<Response>`

Implementation follows spec § 5 steps 1–8:
1. Lookup `referral_links` by `code` (direct Drizzle query via `apps/site/src/lib/db.ts`, which connects as the `fxl_finders_app` runtime role over `DATABASE_URL`). NO Clerk JWT and NO tenant context here — the lookup succeeds ONLY because of the `referral_links_public_lookup` PERMISSIVE SELECT policy from T03 (plan-brief D-E). Include JOIN with `apps` to get `allowed_redirect_hosts` + `webhook_signing_secret`. (If the policy is missing, this query returns 0 rows and every valid code becomes a spurious 410 — covered by the T03 integration test.)
2. If not found → return `Response` with 410 status + branded "Link inválido" HTML page (minimal inline HTML — no React, just plain HTML for speed).
3. If `link.revoked_at IS NOT NULL` (or `link.status === 'revoked'`) → return 410 + "Link inválido" page; if (`link.expires_at IS NOT NULL` AND `link.expires_at < new Date()`) → return 410 + "Link expirado" page.
4. Validate `link.destination_url` host with EXACT equality (plan-brief WARN — never substring/`.includes()`/`endsWith()`): compute `const destHost = new URL(link.destination_url).host` and require `app.allowed_redirect_hosts.some((h) => destHost === h)`. If no exact match → return 500 + log error (misconfiguration, not user error — do NOT expose details in response). If `new URL(...)` throws (unparseable) → also 500.
5. Mint `click_id = ulid()` (import `ulid` from `ulidx`).
6. Extract telemetry from request:
   - `ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim() ?? request.headers.get('cf-connecting-ip') ?? 'unknown'`
   - Compute `salt = dailySalt(new Date(), process.env.HASH_SALT_SECRET ?? 'dev_salt')`
   - `ip_hash = hashIp(ip, salt)` from shared-utils
   - `ua_family = classifyUa(request.headers.get('user-agent'))`
   - `referer = request.headers.get('referer') ?? null`
   - `country = request.headers.get('cf-ipcountry') ?? null`
   - UTM params: parse from URL search params (`utm_source`, `utm_medium`, `utm_campaign`)
7. INSERT `clicks` row (Drizzle db.insert — no setTenantContext needed for this INSERT per split RLS policy T03 `clicks_insert_public`):
   ```
   { clickId, orgId: link.orgId, linkId: link.id, finderId: link.finderId, appId: link.appId,
     productId: link.productId, ipHash, uaFamily, referer, utmSource, utmMedium, utmCampaign, country }
   ```
8. Build `fxl_sig = signReferralUrl(app.webhookSigningSecret, click_id, link.signature)` from shared-utils. Per plan-brief **D-P**, `signReferralUrl` computes `hmac(click_id + "." + link.signature, app.webhook_signing_secret)` — the `"."` separator is mandatory and byte-identical to D-P; do NOT concatenate without it.
9. Construct redirect URL: `link.destination_url + '?ref=' + encodeURIComponent(click_id) + '&fxl_sig=' + encodeURIComponent(fxl_sig)`.
10. Set cookie (plan-brief **D-R**): `fxl_ref=<click_id>; HttpOnly; Secure; SameSite=Lax; Max-Age=7776000; Path=/` — `HttpOnly` and `Secure` are ALWAYS set (the spec mandates Secure; click_id is already in the URL so JS read is never needed; over local-dev http the browser simply ignores `Secure` without breaking the 302).
11. Return `Response` with `status: 302`, `Location: <redirect_url>`, and `Set-Cookie: <fxl_ref=...>` header.

Create `apps/site/src/app/r/[code]/route.ts`:
```typescript
export const runtime = 'nodejs'

import { type NextRequest, NextResponse } from 'next/server'
import { handleReferralClick } from '../../../lib/click-handler'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> }
): Promise<Response> {
  const { code } = await params
  return handleReferralClick(code, request)
}
```

Note: Drizzle DB connection in apps/site uses `DATABASE_URL` env var (same Postgres instance as apps/api — same DB, different runtime). Import db from `apps/site/src/lib/db.ts` (create if not exists; same drizzle-orm/postgres-js pattern as apps/api).

Env vars required (add to `apps/site/.env.dev.example`):
- `DATABASE_URL` — Postgres connection string (same as apps/api; backend-only, never VITE_ prefixed)
- `HASH_SALT_SECRET` — secret for daily IP salt rotation

**Tests (plan-brief WARN — write these in this task):**

Create `apps/site/src/lib/__tests__/ua-family.test.ts` (Vitest unit) covering EVERY branch of `classifyUa`:
- bot/crawler UA (e.g. `Googlebot/2.1`, `facebookexternalhit/1.1`) → `'bot'`
- Edge UA (contains `Edg/`) → `'edge'` (asserts Edge is detected BEFORE chrome, since Edge UA also contains 'Chrome')
- Opera UA (contains `OPR/` or `Opera`) → `'opera'` (asserts BEFORE chrome)
- Firefox UA → `'firefox'`
- Safari UA that does NOT contain 'chrome' → `'safari'`
- Chrome UA → `'chrome'`
- `null` and `''` → `'unknown'`
- unrecognized string → `'unknown'`

Create `apps/site/src/lib/__tests__/click-handler.test.ts` (Vitest) covering the `handleReferralClick` branches (mock the `apps/site/src/lib/db.ts` query layer + shared-utils so no live DB is needed):
- revoked link (`revoked_at` set / `status='revoked'`) → Response status **410**
- expired link (`expires_at < now()`) → Response status **410**
- destination host NOT in `allowed_redirect_hosts` (and unparseable URL) → Response status **500** (no detail leaked in body)
- valid active link → Response status **302** with `Location` containing both `?ref=<click_id>` and `&fxl_sig=<sig>`, AND a `Set-Cookie: fxl_ref=...; HttpOnly; Secure; SameSite=Lax; Max-Age=7776000` header; assert a `clicks` insert was invoked (mock asserts the insert call happened before the redirect is returned)
- not-found code → Response status **410**
</action>

<acceptance_criteria>
- [ ] `apps/site/src/app/r/[code]/route.ts` exists with `export const runtime = 'nodejs'`
- [ ] Code lookup succeeds with NO Clerk JWT / NO tenant context (relies on `referral_links_public_lookup` RLS policy, T03 / plan-brief D-E): a valid code resolves to 302, NOT a spurious 410
- [ ] Route returns 302 to destination URL with `?ref=<click_id>&fxl_sig=<sig>` appended (fxl_sig = `hmac(click_id + "." + link.signature, secret)` per D-P)
- [ ] `Set-Cookie: fxl_ref=<click_id>; HttpOnly; Secure; SameSite=Lax; Max-Age=7776000` header present (HttpOnly AND Secure ALWAYS set — plan-brief D-R)
- [ ] Returns 410 when link not found or revoked
- [ ] Returns 410 when link expired (`expires_at < now()`)
- [ ] Host validation uses EXACT host equality against `allowed_redirect_hosts` (never substring/`endsWith`); returns 500 (not 302) if no exact match OR URL unparseable
- [ ] `click_id` is a ULID (from `ulidx`)
- [ ] `clicks` row inserted before redirect (synchronous — not fire-and-forget)
- [ ] `apps/site/src/lib/__tests__/ua-family.test.ts` passes and covers ALL branches: bot, edge, opera, firefox, safari-not-chrome, chrome, null/empty, unknown (plan-brief WARN)
- [ ] `apps/site/src/lib/__tests__/click-handler.test.ts` passes with branch tests: revoked→410, expired→410, host-mismatch→500, valid→302 (with `?ref=` + `&fxl_sig=` + Set-Cookie), not-found→410 (plan-brief WARN)
- [ ] `DATABASE_URL` and `HASH_SALT_SECRET` documented in `apps/site/.env.dev.example`
- [ ] `pnpm --filter @fxl-finders/site type-check` exits 0
- [ ] `pnpm --filter @fxl-finders/site test` passes (ua-family + click-handler tests)
- [ ] No `any`; no default exports in new files
</acceptance_criteria>

---

### T07 · `apps/site` — Upstash Ratelimit on `/r/[code]`

**Plan:** `04-P07` — Wave 2 (after T06)
**Files:**
- `apps/site/src/lib/rate-limit.ts` (new)
- `apps/site/src/app/r/[code]/route.ts` (update — add rate limit check before handleReferralClick)
- `apps/site/.env.dev.example` (update — add Upstash env vars)

<read_first>
- `apps/site/src/app/r/[code]/route.ts` — current GET handler (T06); rate limit check is inserted before `handleReferralClick`
- `.planning/plan-brief.md` — D3: Upstash Ratelimit; D4: per-IP 60/min sliding + per-code 300/min sliding; `RATE_LIMIT_ENABLED=false` bypasses in local dev
- `docs/superpowers/specs/2026-05-28-fxl-finders-v1-design.md` § 5 step 8 — "Rate limit: per-IP 60/min, per-code 300/min"
- `CLAUDE.md` — named exports; strict TypeScript; no `any`
</read_first>

<action>
Install Upstash packages in apps/site:
```bash
pnpm add @upstash/ratelimit @upstash/redis --filter @fxl-finders/site
```

Create `apps/site/src/lib/rate-limit.ts`:
```
Named export: checkRateLimit(ip: string, code: string): Promise<{ allowed: boolean; retryAfter?: number }>

Implementation:
- If RATE_LIMIT_ENABLED env var is 'false' (or absent in local dev), return { allowed: true } immediately
- Otherwise:
  - Create Upstash Redis client from UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN env vars
  - Instantiate two Ratelimit instances:
    - ipLimiter: Ratelimit.slidingWindow(60, '1 m') with prefix 'rl:ip'
    - codeLimiter: Ratelimit.slidingWindow(300, '1 m') with prefix 'rl:code'
  - Run both checks in parallel: Promise.all([ipLimiter.limit(ip), codeLimiter.limit(code)])
  - If either returns success=false:
    - Return { allowed: false, retryAfter: Math.ceil(resetTime / 1000) } where resetTime is the limiting result's reset field
  - If both pass: return { allowed: true }
- Singleton pattern: create Redis + Ratelimit instances once at module level (not per-request)
```

Update `apps/site/src/app/r/[code]/route.ts`:
```typescript
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ code: string }> }
): Promise<Response> {
  const { code } = await params

  // Extract IP for rate limiting
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0].trim()
    ?? request.headers.get('cf-connecting-ip')
    ?? '127.0.0.1'

  const rateResult = await checkRateLimit(ip, code)
  if (!rateResult.allowed) {
    return new Response('Too Many Requests', {
      status: 429,
      headers: {
        'Retry-After': String(rateResult.retryAfter ?? 60),
        'Content-Type': 'text/plain',
      },
    })
  }

  return handleReferralClick(code, request)
}
```

Add to `apps/site/.env.dev.example`:
```
# Upstash Ratelimit (optional in local dev — set RATE_LIMIT_ENABLED=false to skip)
RATE_LIMIT_ENABLED=false
UPSTASH_REDIS_REST_URL=https://your-upstash-endpoint.upstash.io
UPSTASH_REDIS_REST_TOKEN=your_token_here
```
</action>

<acceptance_criteria>
- [ ] `checkRateLimit` returns `{ allowed: true }` when `RATE_LIMIT_ENABLED=false` (local dev bypass)
- [ ] `checkRateLimit` uses `Ratelimit.slidingWindow(60, '1 m')` for IP limiter
- [ ] `checkRateLimit` uses `Ratelimit.slidingWindow(300, '1 m')` for code limiter
- [ ] Both limiters checked in parallel (`Promise.all`)
- [ ] `/r/[code]` returns 429 with `Retry-After` header when rate limit exceeded
- [ ] Upstash env vars documented in `apps/site/.env.dev.example` with `RATE_LIMIT_ENABLED=false` default
- [ ] Redis client and Ratelimit instances created at module level (singleton — not per-request)
- [ ] `pnpm --filter @fxl-finders/site type-check` exits 0
- [ ] No `any`; no default exports
</acceptance_criteria>

---

### T08 · `apps/web` — link generator UI (form + generated code display + copy button)

**Plan:** `04-P08` — Wave 3 (after T04 + T05)
**Files:**
- `apps/web/src/finder/links/LinksPage.tsx` (new — replaces placeholder from Phase 03 T11)
- `apps/web/src/finder/links/LinkGeneratorForm.tsx` (new)
- `apps/web/src/finder/links/LinkCard.tsx` (new)
- `apps/web/src/finder/links/useLinks.ts` (new — TanStack Query hooks)
- `apps/web/src/lib/api-client.ts` (update — add links API calls)
- `apps/web/src/i18n/pt-BR.json` (update — add `finder.links.*` keys)

<read_first>
- `.planning/phases/04-*/04-UI-SPEC.md` — UI design contract (REQUIRED — produced by /gsd:ui-phase 04 run before T01)
- `apps/web/src/finder/links/LinksPlaceholderPage.tsx` — existing placeholder to replace
- `apps/web/src/components/ui/kpi-card.tsx` — KPICard props (title, value, icon, isLoading, colorScheme)
- `apps/web/src/components/ui/skeleton.tsx` — Skeleton component
- `apps/web/src/components/ui/empty-state.tsx` — EmptyState props
- `apps/web/src/admin/apps/useApps.ts` — TanStack Query hook pattern to mirror
- `apps/api/src/domains/links/routes.ts` — exact request/response shapes (T05)
- `CLAUDE.md` — loading state rules; query invalidation; `useTranslation()`; KPICard for metrics; no raw Clerk IDs; named exports only
</read_first>

<action>
Update `apps/web/src/lib/api-client.ts` — add finder APIs. ALL calls MUST go through the existing `apiFetch(path, { method, token, body })` helper (plan-brief D-J — prepends `VITE_API_URL`, attaches the Clerk Bearer via `useAuth().getToken()`). Do NOT use bare relative `fetch('/api/...')` and do NOT reuse admin endpoints:
```
finderLinksApi = {
  list: (token) → apiFetch('/api/v1/links', { token }),
  create: (token, data: { appId, productId, quotedSetupBrl, quotedMonthlyBrl }) → apiFetch('/api/v1/links', { method: 'POST', token, body: data }),
  revoke: (token, linkId, reason?) → apiFetch('/api/v1/links/' + linkId, { method: 'DELETE', token, body: { reason } }),
  getStats: (token) → apiFetch('/api/v1/finder/clicks/stats', { token }),
}
finderCatalogApi = {
  listApps: (token) → apiFetch('/api/v1/finder/apps', { token }),
  listProducts: (token, appId) → apiFetch('/api/v1/finder/apps/' + appId + '/products', { token }),
}
```

Create `apps/web/src/finder/links/useLinks.ts` (pass the Clerk token from `useAuth().getToken()` into every call — D-J):
- `useFinderLinks()` — `useQuery({ queryKey: ['finder', 'links'], queryFn, select: (d) => Array.isArray(d.links) ? d.links : [] })`
- `useFinderApps()` — `useQuery({ queryKey: ['finder', 'apps'], queryFn: finderCatalogApi.listApps, select: (d) => Array.isArray(d.apps) ? d.apps : [] })` (REPLACES any `useAdminApps()` usage — admin route is role-gated)
- `useFinderProducts(appId?: string)` — `useQuery({ queryKey: ['finder', 'apps', appId, 'products'], queryFn: () => finderCatalogApi.listProducts(token, appId!), enabled: !!appId, select: (d) => Array.isArray(d.products) ? d.products : [] })` (REPLACES any `useAdminProducts()` usage)
- `useCreateLink()` — `useMutation({ mutationFn: ..., onSuccess: () => queryClient.invalidateQueries({ queryKey: ['finder', 'links'] }) })`
- `useRevokeLink()` — `useMutation({ mutationFn: ..., onSuccess: () => queryClient.invalidateQueries({ queryKey: ['finder', 'links'] }) })`
- `useFinderClickStats()` — `useQuery({ queryKey: ['finder', 'clicks', 'stats'], queryFn: finderLinksApi.getStats })`

Create `apps/web/src/finder/links/LinkGeneratorForm.tsx`:
- Named export `LinkGeneratorForm`
- Props: `{ onSuccess: (link: ReferralLink, fullUrl: string) => void }`
- State machine: `idle → filling → submitting → success(link, fullUrl) | error`
- Fields:
  - App selector: `<Select>` populated from a NEW `useFinderApps()` hook that calls `GET /api/v1/finder/apps` (the first-class finder-authed endpoint added in T05). Do NOT reuse `useAdminApps()` — the admin route is `requireAdmin` role-gated (plan-brief D-B) and a finder JWT would get 403.
  - Product selector: `<Select>` populated by a NEW `useFinderProducts(appId)` hook (calls a finder-accessible products read filtered by `appId`). If a finder-scoped products endpoint is not yet present, add `GET /api/v1/finder/apps/:appId/products` to the T05 `finderRouter` (active products + their price bands for band-hint display). Do NOT reuse `useAdminProducts` (admin route is role-gated). Re-enable the selector only once `appId` is chosen.
  - `quotedSetupBrl` input: number, labeled "Setup (R$)", displayed as R$ (enter in reais, convert to cents on submit: `Math.round(float * 100)`). Client-side validation: within selected product's setup band (`min/maxBrl ÷ 100` as R$ display values).
  - `quotedMonthlyBrl` input: number, labeled "Mensalidade (R$)", same pattern with monthly band.
  - Band hint text below each field: "Entre R$ {min} e R$ {max}" — fetched from price bands.
  - Submit button: `t('finder.links.generate')` — disabled when any field invalid or while submitting.
- On success: call `onSuccess(link, fullUrl)` — parent renders the generated URL.

Create `apps/web/src/finder/links/LinkCard.tsx`:
- Named export `LinkCard`
- Props: `{ link: ReferralLink; fullUrl?: string }`
- Displays: link `code`, short URL (`fullUrl ?? 'https://finders.fxl.com.br/r/' + link.code`), status badge (`active`/`revoked`), quoted prices (R$ setup + R$ monthly), created date
- Copy button: copies `fullUrl` to clipboard; shows "Copiado!" for 2s. Uses `navigator.clipboard.writeText`.
- Revoke button (only when `link.status === 'active'`): opens `<AlertDialog>` confirmation → calls `useRevokeLink()`.

Create `apps/web/src/finder/links/LinksPage.tsx`:
- Named export `LinksPage` (replaces the Phase 03 placeholder import in router.tsx)
- Top section: KPICards row:
  - "Links ativos" — `value = links.filter(l => l.status === 'active').length`, icon `Link2`, `isLoading`
  - "Total de cliques" — `value = stats?.total ?? '—'`, icon `MousePointerClick`, `isLoading = statsLoading`
  - "Cliques únicos" — `value = stats?.unique ?? '—'`, icon `Users`, `isLoading = statsLoading`
- "Gerar link" button → opens `<LinkGeneratorForm>` in a `<Dialog>` or inline expanded section
- On form success: close dialog + show `<LinkCard>` in a temporary "just generated" banner with the `fullUrl` visible + copy button
- Links list: `isLoading` → 3 skeleton rows; `!isLoading && empty` → `<EmptyState title={t('finder.links.empty')} description={...} action={generateButton} />`; `!isLoading && data.length > 0` → list of `<LinkCard>` components
- Update `apps/web/src/router.tsx` to import `LinksPage` from `./finder/links/LinksPage` (replace `LinksPlaceholderPage`)

i18n keys to add to `apps/web/src/i18n/pt-BR.json`:
```json
{
  "finder": {
    "links": {
      "title": "Meus Links",
      "generate": "Gerar Link",
      "empty": "Nenhum link gerado ainda",
      "emptyDesc": "Gere seu primeiro link de indicação para começar.",
      "kpi": {
        "active": "Links ativos",
        "totalClicks": "Total de cliques",
        "uniqueClicks": "Cliques únicos"
      },
      "form": {
        "app": "Produto",
        "product": "Versão",
        "setupPrice": "Setup (R$)",
        "monthlyPrice": "Mensalidade (R$)",
        "bandHint": "Entre R$ {{min}} e R$ {{max}}",
        "submit": "Gerar Link",
        "submitting": "Gerando..."
      },
      "card": {
        "code": "Código",
        "url": "URL",
        "copy": "Copiar",
        "copied": "Copiado!",
        "revoke": "Revogar",
        "revokeConfirm": "Tem certeza que deseja revogar este link? Esta ação não pode ser desfeita.",
        "status": {
          "active": "Ativo",
          "revoked": "Revogado"
        },
        "quotedSetup": "Setup cotado",
        "quotedMonthly": "Mensalidade cotada",
        "createdAt": "Criado em"
      }
    }
  }
}
```
</action>

<acceptance_criteria>
- [ ] `LinksPage` renders KPICards: "Links ativos", "Total de cliques", "Cliques únicos" — all using `KPICard` component
- [ ] `isLoading` → skeleton rows (never shows empty state or content while loading)
- [ ] `!isLoading && links.length === 0` → `<EmptyState>` with generate button
- [ ] `!isLoading && links.length > 0` → list of `<LinkCard>` components
- [ ] `LinkGeneratorForm` validates setup/monthly values against band min/max BEFORE submit
- [ ] Band hint text shows `min` and `max` values in R$ display format
- [ ] `LinkCard` copy button uses `navigator.clipboard.writeText(fullUrl)`; shows "Copiado!" for 2s
- [ ] App + product selectors use `useFinderApps()` / `useFinderProducts(appId)` hitting `GET /api/v1/finder/apps` + `GET /api/v1/finder/apps/:appId/products` — NOT `useAdminApps`/`useAdminProducts` (admin routes are role-gated; a finder JWT would 403)
- [ ] All API calls go through `apiFetch(path, { method, token, body })` with the Clerk token (plan-brief D-J) — no bare relative `fetch('/api/...')`
- [ ] `useCreateLink()` calls `invalidateQueries({ queryKey: ['finder', 'links'] })` on success
- [ ] `useRevokeLink()` calls `invalidateQueries({ queryKey: ['finder', 'links'] })` on success
- [ ] `select: (d) => Array.isArray(d.links) ? d.links : []` on `useFinderLinks`
- [ ] Router updated: `LinksPage` replaces `LinksPlaceholderPage` for `/finder/links` route
- [ ] All user-facing strings via `useTranslation()`; PT-BR keys added to pt-BR.json
- [ ] No raw Clerk IDs in any rendered UI element
- [ ] Named exports only; no default exports
- [ ] `pnpm --filter @fxl-finders/web type-check` exits 0
</acceptance_criteria>

---

### T09 · `apps/web` — clicks dashboard (list + KPICards)

**Plan:** `04-P09` — Wave 3 (parallel with T08)
**Files:**
- `apps/web/src/finder/clicks/ClicksPage.tsx` (new)
- `apps/web/src/finder/clicks/ClicksTable.tsx` (new)
- `apps/web/src/finder/clicks/useClicks.ts` (new — TanStack Query hooks)
- `apps/web/src/lib/api-client.ts` (update — add clicks list API call)
- `apps/web/src/finder/links/LinksPage.tsx` (update — add "Ver cliques" link from KPICards)
- `apps/web/src/router.tsx` (update — add `/finder/clicks` route)
- `apps/web/src/i18n/pt-BR.json` (update — add `finder.clicks.*` keys)

<read_first>
- `.planning/phases/04-*/04-UI-SPEC.md` — UI design contract (REQUIRED)
- `apps/web/src/components/ui/kpi-card.tsx` — KPICard props
- `apps/web/src/components/ui/table.tsx` — Table component (installed in Phase 02)
- `apps/web/src/admin/apps/AppsPage.tsx` — established table + empty state + loading skeleton pattern
- `apps/api/src/domains/finder/routes.ts` — the FIRST-CLASS paginated `GET /api/v1/finder/clicks?linkId=<uuid>&limit=50&cursor=<ts>` endpoint (added in T05 `finderRouter`; finder-auth, org-isolated via `clicks_select_tenant` RLS). This task CONSUMES it; it is no longer "autopilot maybe-add".
- `CLAUDE.md` — loading state rules; KPICard for metrics; no raw Clerk IDs; named exports
</read_first>

<action>
Update `apps/web/src/lib/api-client.ts` — add clicks list API (via `apiFetch` + Clerk token, plan-brief D-J):
```
finderClicksApi = {
  list: (token, params?: { linkId?: string; limit?: number; cursor?: string }) →
    apiFetch('/api/v1/finder/clicks?' + new URLSearchParams(params), { token }),
  getStats: (token) → apiFetch('/api/v1/finder/clicks/stats', { token }),
}
```

The `GET /api/v1/finder/clicks` endpoint is a FIRST-CLASS finder-authed route delivered in T05 (`finderRouter`). It is NOT added here. Contract (for reference): `clerkAuthMiddleware`; wraps in `db.transaction` + `setTenantContext(tx, orgId)` + `resolveFinderId`; `SELECT clicks.* WHERE finder_id = $finderId [AND link_id = $linkId] [AND created_at < $cursor] ORDER BY created_at DESC LIMIT $limit (max 100)`; returns `{ clicks: ClickRow[], nextCursor: string | null }`; org-isolation enforced by the `clicks_select_tenant` RLS policy.

Create `apps/web/src/finder/clicks/useClicks.ts`:
- `useFinderClicks(linkId?: string)` — `useQuery({ queryKey: ['finder', 'clicks', linkId], queryFn: () => finderClicksApi.list({ linkId }), select: (d) => Array.isArray(d.clicks) ? d.clicks : [] })`
- `useFinderClickStats()` — same as in `useLinks.ts` — can share the same query key `['finder', 'clicks', 'stats']` (will deduplicate via TanStack Query cache)

Create `apps/web/src/finder/clicks/ClicksTable.tsx`:
- Named export `ClicksTable`
- Props: `{ clicks: ClickRow[]; isLoading: boolean }`
- Loading: `<Skeleton className="h-8 w-full" />` × 5 rows
- Empty: `<EmptyState title={t('finder.clicks.empty')} />`
- Content: `<Table>` with columns:
  - Data/hora: `click.createdAt` formatted as `dd/MM/yyyy HH:mm` (use `date-fns` or `Intl.DateTimeFormat` — check existing format utilities; autopilot: use `new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(click.createdAt))`)
  - Navegador: `click.uaFamily` (capitalize first letter)
  - Origem: `click.referer ?? '—'`
  - País: `click.country ?? '—'`
  - UTM Source: `click.utmSource ?? '—'`
  - NOTE: Do NOT display `click_id`, `ip_hash`, or `link_id` in the table (privacy + raw ID rule)

Create `apps/web/src/finder/clicks/ClicksPage.tsx`:
- Named export `ClicksPage`
- Optional `linkId` from URL search param (`useSearchParams()`)
- KPICards at top (same stats as LinksPage — reuse `useFinderClickStats()`):
  - "Total de cliques" with total count
  - "Cliques únicos" with unique count
  - "Taxa de conversão" — value always `'—'` placeholder (spec: conversion rate deferred to Phase 05); colorScheme: `default`, isLoading: `false`
- Below KPICards: `<ClicksTable clicks={clicks} isLoading={isLoading} />`
- If `linkId` param present: show filter chip "Filtrando por link: {code}" with clear button

Update `apps/web/src/router.tsx`:
- Add `{ path: 'clicks', element: <ClicksPage /> }` under `/finder` children
- Update `FinderShell` sidebar to add "Cliques" nav item: `{ to: '/finder/clicks', icon: MousePointerClick, key: 'nav.clicks' }`

i18n keys to add:
```json
{
  "finder": {
    "clicks": {
      "title": "Cliques",
      "empty": "Nenhum clique registrado ainda",
      "emptyDesc": "Os cliques nos seus links aparecerão aqui.",
      "kpi": {
        "total": "Total de cliques",
        "unique": "Cliques únicos",
        "conversionRate": "Taxa de conversão"
      },
      "table": {
        "date": "Data/hora",
        "browser": "Navegador",
        "origin": "Origem",
        "country": "País",
        "utmSource": "UTM Source"
      },
      "filterLabel": "Filtrando por link: {{code}}",
      "clearFilter": "Limpar filtro"
    }
  },
  "nav": {
    "clicks": "Cliques"
  }
}
```
</action>

<acceptance_criteria>
- [ ] `ClicksPage` renders 3 KPICards: total clicks, unique clicks, conversion rate (value `'—'` placeholder)
- [ ] Conversion rate KPICard value is `'—'` (not a number — Phase 05 placeholder)
- [ ] `ClicksTable` shows skeleton while `isLoading`; EmptyState when no clicks; table with 5 columns when data present
- [ ] Table does NOT show `click_id`, `ip_hash`, or `link_id` columns (privacy rule)
- [ ] `useFinderClicks` uses `select: (d) => Array.isArray(d.clicks) ? d.clicks : []`
- [ ] Optional `linkId` filter in `ClicksPage` works via URL search param
- [ ] `/finder/clicks` route added to router; `FinderShell` sidebar has "Cliques" nav item
- [ ] All strings via `useTranslation()`; PT-BR keys added
- [ ] No raw Clerk IDs or `click_id` / `ip_hash` values rendered in UI
- [ ] `pnpm --filter @fxl-finders/web type-check` exits 0
- [ ] Named exports only
</acceptance_criteria>

---

### T10 · Type-check + lint gate (all apps + packages) — Phase 04 final

**Plan:** `04-P10` — Wave 4 (after T08 + T09)
**Files:** all modified files across `packages/shared-utils`, `apps/api`, `apps/site`, `apps/web`

<read_first>
- All modified files listed in T01–T09 (verify clean compilation)
- `CLAUDE.md` — performance audit: `pnpm run perf:audit` via husky pre-commit; `--no-verify` is forbidden
- `.planning/plan-brief.md` — cross-phase coordination flags; `DATABASE_URL` is backend-only (never `VITE_`); no `any`; named exports
</read_first>

<action>
Run verification commands in order:
```bash
pnpm --filter @fxl-finders/shared-utils test
pnpm --filter @fxl-finders/shared-utils type-check

pnpm --filter @fxl-finders/api type-check
pnpm --filter @fxl-finders/api lint
pnpm --filter @fxl-finders/api test       # unit project (includes links service TDD: resolveFinderId, exact-host, band, signature, code)
pnpm --filter @fxl-finders/api test:integration   # RLS project: referral-links-public-lookup + list-finder-links-cross-tenant (connects as fxl_finders_app per D-G)

pnpm --filter @fxl-finders/site type-check
pnpm --filter @fxl-finders/site lint
pnpm --filter @fxl-finders/site test      # ua-family + click-handler branch tests (plan-brief WARN)

pnpm --filter @fxl-finders/web type-check
pnpm --filter @fxl-finders/web lint
```

Security / contract grep checks:
```bash
# VITE_ prefix must never appear on DATABASE_URL or HASH_SALT_SECRET
grep -r 'VITE_DATABASE_URL\|VITE_HASH_SALT_SECRET' . --include='*.ts' --include='*.tsx' --include='*.env*'
# Should return 0 results

# setTenantContext must be called in all tenant-scoped domain functions (D-D: inside db.transaction)
grep -l 'setTenantContext' apps/api/src/domains/links/service.ts
# Should return the file (confirms it's present)
grep -c 'db.transaction' apps/api/src/domains/links/service.ts
# Should be >= 4 (createLink, listFinderLinks, revokeLink, getFinderClickStats[, listFinderClicks])

# resolveFinderId present + used (Clerk userId -> finders.id UUID; never raw user_* as finder_id)
grep -n 'resolveFinderId' apps/api/src/domains/links/service.ts
# Should appear in resolveFinderId def + each tenant fn

# Public-lookup RLS policy present in the journaled migration (D-E)
grep -rn 'referral_links_public_lookup' apps/api/drizzle/
# Should return >= 1 match in the generated (journaled) migration file

# clerkAuthMiddleware (D-B) is the auth name used by new routes; no stray bare authMiddleware import in new files
grep -rn 'clerkAuthMiddleware' apps/api/src/domains/links/routes.ts apps/api/src/domains/finder/routes.ts apps/api/src/server.ts
# Should return matches (confirms D-B middleware name wired)

# No standalone unjournaled RLS .sql for Phase 04 (D-F)
ls apps/api/drizzle/*phase04_rls.sql 2>/dev/null
# Should return nothing (RLS lives INSIDE the journaled generated migration)

# No raw Clerk IDs in web UI
grep -r 'user_\|org_\|usr_' apps/web/src --include='*.tsx' | grep -v '\.test\.' | grep -v 'publicMetadata'
# Should return 0 results (or only metadata access, not rendered values)

# No default exports in new files
grep -r '^export default' packages/shared-utils/src/hmac.ts apps/api/src/domains/links/ apps/site/src/lib/click-handler.ts apps/web/src/finder/links/ apps/web/src/finder/clicks/
# Should return 0 results

# Clicks table must not have UPDATE/DELETE grants
grep -i 'UPDATE\|DELETE' apps/api/drizzle/*_phase04*.sql | grep -i clicks
# Should return 0 results (only INSERT + SELECT granted to clicks)
```

Fix any issues found. Common pitfalls:
- `ulidx` import paths may differ across ESM/CJS environments — verify `import { ulid } from 'ulidx'` resolves
- `packages/shared-utils` may need `build` before it can be consumed by apps — run `pnpm --filter @fxl-finders/shared-utils build` if needed
- apps/site Drizzle DB connection needs `DATABASE_URL` (ensure it's wired in `apps/site/src/lib/db.ts`)
- Next.js 15 `params` is a `Promise<{code: string}>` — must be awaited (already done in T06; verify no regression)
</action>

<acceptance_criteria>
- [ ] `pnpm --filter @fxl-finders/shared-utils test` passes (HMAC + hashIp + dailySalt TDD tests)
- [ ] `pnpm --filter @fxl-finders/api type-check` exits 0
- [ ] `pnpm --filter @fxl-finders/api lint` exits 0
- [ ] `pnpm --filter @fxl-finders/api test` passes (includes links service TDD: validatePriceBand, buildLinkSignature, buildLinkCode, validateDestinationHost EXACT-host incl. near-match reject, resolveFinderId)
- [ ] `pnpm --filter @fxl-finders/api test:integration` passes (RLS: referral-links-public-lookup + list-finder-links-cross-tenant, as `fxl_finders_app`)
- [ ] `pnpm --filter @fxl-finders/site type-check` exits 0
- [ ] `pnpm --filter @fxl-finders/site lint` exits 0
- [ ] `pnpm --filter @fxl-finders/site test` passes (ua-family + click-handler branch tests)
- [ ] `pnpm --filter @fxl-finders/web type-check` exits 0
- [ ] `pnpm --filter @fxl-finders/web lint` exits 0
- [ ] `grep -r 'VITE_DATABASE_URL\|VITE_HASH_SALT_SECRET' .` returns 0 results
- [ ] `setTenantContext` called INSIDE `db.transaction` in `listFinderLinks`, `revokeLink`, `getFinderClickStats`, `createLink`, `listFinderClicks` (grep: `db.transaction` count >= 4)
- [ ] `resolveFinderId` defined and referenced by every tenant-scoped fn (grep confirms)
- [ ] `referral_links_public_lookup` present in the journaled migration (grep confirms — D-E/D-F); no standalone `*phase04_rls.sql`
- [ ] `clerkAuthMiddleware` wired in links/finder routes + server.ts (grep confirms — D-B)
- [ ] No default exports in any new file (grep confirms)
- [ ] `clicks` table grants: no UPDATE/DELETE (grep of migration SQL confirms)
- [ ] No `any` types in any new or modified TypeScript file
</acceptance_criteria>

---

## must_haves

The phase CANNOT be marked complete unless ALL of the following truths hold:

- [ ] `referral_links` + `clicks` tables exist in Drizzle schema with all columns per spec § 4
- [ ] `leads.link_id` and `leads.click_id` promoted to hard FK constraints via Phase 04 migration
- [ ] Both `referral_links` and `clicks` have `org_id text NOT NULL` and `FORCE ROW LEVEL SECURITY`
- [ ] `clicks` is append-only: only `INSERT + SELECT` granted to `fxl_finders_app`; no UPDATE/DELETE
- [ ] `referral_links` has `referral_links_public_lookup AS PERMISSIVE FOR SELECT TO fxl_finders_app USING (true)` (plan-brief D-E) — a valid code resolves under `fxl_finders_app` with NO org context → 302 (NOT 410); proven by `apps/api/test/rls/referral-links-public-lookup.test.ts`
- [ ] All RLS / policy / grant SQL is APPENDED INTO the journaled Drizzle migration (plan-brief D-F); `pg_policies` shows all 4 policies after `db:migrate`; no standalone unjournaled `.sql` exists
- [ ] `resolveFinderId(db, clerkUserId)` resolves the Clerk `userId` → `finders.id` UUID; `createLink`/`listFinderLinks`/`revokeLink`/`getFinderClickStats`/`listFinderClicks` use the UUID for `finder_id`, NEVER the raw `user_*` string; missing finders row → clean 403 `finder_not_found`
- [ ] Every tenant-scoped service fn wraps in `db.transaction(tx => { setTenantContext(tx, orgId); ... via tx })` (plan-brief D-D); cross-tenant integration test for `listFinderLinks` passes (org B cannot see org A links)
- [ ] `referral_links` HMAC signature (`link.signature`) uses `signHmac(webhookSigningSecret, [finderId, productId, quotedSetupBrl, quotedMonthlyBrl].join(':'))` with `finderId` = `finders.id` UUID — deterministic, reusable by Phase 05 (plan-brief D-P)
- [ ] `fxl_sig = hmac(click_id + "." + link.signature, app.webhook_signing_secret)` — the `"."` separator is byte-identical to plan-brief D-P
- [ ] `GET /api/v1/finder/apps`, `GET /api/v1/finder/apps/:appId/products`, `GET /api/v1/finder/clicks` (paginated), `GET /api/v1/finder/clicks/stats` are FIRST-CLASS finder-authed routes (not admin-route reuse); admin routes stay `requireAdmin`-gated
- [ ] All routes use `clerkAuthMiddleware` (plan-brief D-B); mounted in `apps/api/src/server.ts` (not index.ts — D-R)
- [ ] Frontend finder calls go through `apiFetch(path, { method, token, body })` with Clerk token (plan-brief D-J); no admin-hook reuse for finder data
- [ ] `packages/shared-utils/src/hmac.ts` exports `signHmac`, `verifyHmac`, `signReferralUrl`, `verifyReferralSig`, `hashIp`, `dailySalt` — all with Vitest TDD coverage
- [ ] `/r/[code]` route handler (apps/site) runs as Node.js runtime (`export const runtime = 'nodejs'`)
- [ ] `/r/[code]` inserts a `clicks` row synchronously before 302 redirect (not fire-and-forget)
- [ ] `/r/[code]` sets `fxl_ref=<click_id>; HttpOnly; Secure; SameSite=Lax; Max-Age=7776000` cookie (HttpOnly AND Secure ALWAYS — plan-brief D-R)
- [ ] `/r/[code]` appends `?ref=<click_id>&fxl_sig=<hmac>` to redirect URL
- [ ] `/r/[code]` returns 410 when link is revoked or expired
- [ ] Host validation uses EXACT host equality (`new URL(dest).host === entry`) against `app.allowed_redirect_hosts[]` — never substring/`.includes()`/`endsWith()` (plan-brief WARN); test proves a near-match like `evil-fxl.com.br` is rejected
- [ ] `apps/site/src/lib/__tests__/ua-family.test.ts` + `apps/site/src/lib/__tests__/click-handler.test.ts` exist and pass (bot/edge/opera/firefox/safari-not-chrome/chrome/unknown; revoked→410, expired→410, host-mismatch→500, valid→302) (plan-brief WARN)
- [ ] Rate limit: per-IP 60/min + per-code 300/min; bypassed via `RATE_LIMIT_ENABLED=false` in local dev
- [ ] Finder link generator UI validates quoted prices against band min/max before submit
- [ ] Clicks dashboard KPICards show total + unique clicks; conversion rate shows `'—'` (Phase 05 placeholder)
- [ ] `ip_hash` and `click_id` (raw values) are never rendered in the finder UI
- [ ] All finder UI strings via `useTranslation()`; PT-BR keys present for all new UI
- [ ] `DATABASE_URL` is never `VITE_DATABASE_URL` in apps/site (backend-only env var)
- [ ] `validateDestinationHost` throws on unparseable URL (defense against malformed destination_url)
- [ ] `/precos` canonical path assumption documented: `destination_url = 'https://' + allowed_redirect_hosts[0] + '/precos'` (NIT — captured as T04 acceptance)
- [ ] `pnpm --filter @fxl-finders/api type-check` exits 0
- [ ] `pnpm --filter @fxl-finders/site type-check` exits 0
- [ ] `pnpm --filter @fxl-finders/web type-check` exits 0

---

## Wave dependency notes

**Wave 1** (T01, T02, T03) — parallelizable foundational work:
- T01: shared-utils HMAC util (packages/shared-utils only)
- T02: Drizzle schema additions (apps/api schema.ts only)
- T03: Migration generation + RLS migration (depends on T02)

**Wave 2** *(blocked on Wave 1 completion)*:
- T04: links service TDD (depends on T01 HMAC util + T02 schema)
- T05: links Hono routes (depends on T04)
- T06: /r/[code] handler (depends on T01 HMAC util + T02 schema + T03 migration)
- T07: Upstash ratelimit (depends on T06)

**Wave 3** *(blocked on Wave 2 completion)*:
- T08: link generator UI (depends on T04 + T05 for API contract)
- T09: clicks dashboard (depends on T05 for clicks list endpoint)

**Wave 4** *(blocked on Wave 3 completion)*:
- T10: final gate (all apps + packages)

---

## Autopilot decisions log (Phase 04)

See inline `**Autopilot decision D#:**` callouts in each task and in the Architecture decisions table at the top of this plan. All gray-area decisions made to minimize scope, dependencies, and deferred technical debt consistent with v1.0 goals.

Summary of deviations from spec/task brief (now reconciled with plan-brief PRE-EXECUTION decisions):
1. **Finder-accessible catalog endpoints (FIRST-CLASS, not a reuse)**: `GET /api/v1/finder/apps` + `GET /api/v1/finder/apps/:appId/products` are first-class finder-authed routes in the new `finderRouter` (T05). The original "reuse useAdminApps" suggestion is REMOVED — admin routes are `requireAdmin` role-gated (plan-brief D-B), so a finder JWT would 403. The finder routes expose ONLY display fields (no secrets).
2. **Clicks list endpoint (FIRST-CLASS)**: `GET /api/v1/finder/clicks` (paginated) and `GET /api/v1/finder/clicks/stats` are first-class in `finderRouter` (T05). The clicks dashboard (T09) consumes them.
3. **`destination_url` construction + canonical path (NIT documented)**: Autopilot D8 / plan-brief D-P — `destination_url = 'https://' + app.allowed_redirect_hosts[0] + '/precos'`. `allowed_redirect_hosts[0]` is the CANONICAL host and `/precos` the canonical pricing path (v1.0 assumption; per-app path deferred). This is captured as a T04 `createLink` acceptance criterion.
4. **`clicks` + `referral_links` RLS split policies (plan-brief D-E / D-C)**: `clicks` INSERT uses `WITH CHECK (true)` (public insert path), SELECT uses `org_id` filtering. `referral_links` gets BOTH a tenant `FOR ALL` policy AND `referral_links_public_lookup AS PERMISSIVE FOR SELECT TO fxl_finders_app USING (true)` (plan-brief D-E) so the JWT-less `/r/[code]` lookup resolves valid codes (302) instead of always 410. Admin cross-tenant reads use `getAdminDb()` BYPASSRLS (plan-brief D-C). All RLS SQL is APPENDED INTO the journaled Drizzle migration (plan-brief D-F), not a standalone `.sql`.
5. **Clerk-user-id → finders.id resolution (plan-brief)**: `resolveFinderId(db, clerkUserId)` (T04) converts the route's Clerk `userId` into the `finders.id` UUID before any `finder_id` read/write/sign — never the raw `user_*` string. Missing finders row → clean 403 `finder_not_found`.
6. **Tenant fns are transaction-scoped (plan-brief D-D)**: every tenant-scoped service fn wraps in `db.transaction(tx => { setTenantContext(tx, orgId); ... })`. Cross-tenant integration test added for `listFinderLinks`.

---

## Failure list

1. **`ulidx` ESM/CJS compatibility**: `ulidx` is ESM-native. If `apps/api` or `apps/site` are configured as CommonJS, the import may fail. Resolution: verify `"type": "module"` in `apps/api/package.json` (it is, per template). If not, add `--esm` flag or dynamic import. Log as a sub-step in T04/T06 if import fails.

2. **`packages/shared-utils` build step**: apps/api and apps/site import from `@fxl-finders/shared-utils`. If the package is not pre-built, TypeScript may resolve types but the runtime import may fail. Resolution: run `pnpm --filter @fxl-finders/shared-utils build` before running the API or site. Add to setup docs.

3. **Drizzle DESC index**: Drizzle Kit may not support DESC index direction in the `index()` builder for all Postgres versions. Resolution: if generated migration omits DESC, the hand-authored RLS migration (T03) includes commented-out `CREATE INDEX CONCURRENTLY` statements to add them manually.

4. **`apps/site` DB connection**: apps/site is a Next.js app; it needs its own Drizzle/postgres connection to query `referral_links`. This requires `DATABASE_URL` in apps/site env and a `apps/site/src/lib/db.ts` file. This is a new pattern (apps/site previously had no DB access). If the template has no precedent for this, T06 must create the connection from scratch — flagged as a sub-step.

---

## Phase dependencies

**This phase depends on:** Phase 02 (apps/products/price_bands admin — needed for link generator to have real app+product data) AND Phase 03 (finder portal shell — `/finder/links` and `/finder/clicks` routes live in the finder shell created in Phase 03)

**This phase unblocks:** Phase 05 (conversion ingestion needs `clicks` table + `click_id` + `referral_links` table + Phase 04 HMAC util in shared-utils for webhook verify)

**Parallel with:** nothing — W3 is the only wave at this point

---

## Verify gate

After execution, run:
```bash
/gsd-verify-work 04
```

Verify checklist (confirm before marking phase complete):
- [ ] `pnpm --filter @fxl-finders/api db:generate` was run; `referral_links` + `clicks` tables present in latest migration
- [ ] `GET /api/v1/links` (with valid finder JWT) returns `{ links: [] }` for a new finder
- [ ] `POST /api/v1/links` with valid body creates a link and returns `{ link, fullUrl }` where `fullUrl` starts with `http://localhost:4006/r/`
- [ ] `GET http://localhost:4006/r/<generated_code>` returns 302 to destination URL with `?ref=...&fxl_sig=...` (valid code resolves — proves `referral_links_public_lookup` policy works with no JWT/tenant context, D-E)
- [ ] `Set-Cookie: fxl_ref=...` header present in 302 response; cookie is `HttpOnly; Secure; SameSite=Lax; Max-Age=7776000` (D-R)
- [ ] `fxl_sig` equals `hmac(click_id + "." + link.signature, app.webhook_signing_secret)` (D-P)
- [ ] `clicks` table has one row after the above redirect test
- [ ] `GET /api/v1/finder/apps` (finder JWT) returns active apps; same call with a NON-finder JWT (no finders row) returns 403 `finder_not_found`
- [ ] `GET /api/v1/finder/clicks` (paginated) returns `{ clicks, nextCursor }` scoped to the finder's org
- [ ] `GET /api/v1/finder/clicks/stats` returns `{ total: 1, unique: 1 }` after the redirect test
- [ ] `GET http://localhost:4006/r/<invalid_code>` returns 410
- [ ] `RATE_LIMIT_ENABLED=false` in local dev — confirm redirect works without Upstash configured
- [ ] `apps/web` finder portal: `/finder/links` renders link generator form + "Gerar Link" button
- [ ] Link generator form shows band validation error when quoted price is outside band
- [ ] `/finder/clicks` renders clicks table with data from the test redirect
- [ ] Conversion rate KPICard shows `'—'` (not a number)
- [ ] `pnpm --filter @fxl-finders/api type-check` exits 0
- [ ] `pnpm --filter @fxl-finders/site type-check` exits 0
- [ ] `pnpm --filter @fxl-finders/web type-check` exits 0
- [ ] `pnpm --filter @fxl-finders/api test` (unit project) passes — TDD tests for HMAC + band validation + EXACT host check + ULID code gen + `resolveFinderId`
- [ ] `pnpm --filter @fxl-finders/api test:integration` passes — `referral-links-public-lookup` (D-E) + `list-finder-links-cross-tenant` (D-D), both connecting as `fxl_finders_app` (D-G)
- [ ] `pnpm --filter @fxl-finders/site test` passes — `ua-family` (all branches) + `click-handler` (410/410/500/302) tests
- [ ] `pnpm --filter @fxl-finders/shared-utils test` passes
- [ ] No `any` in any new TypeScript file
- [ ] No default exports in any new file
- [ ] `grep -r 'VITE_DATABASE_URL' .` returns 0 results
- [ ] `grep -rn 'referral_links_public_lookup' apps/api/drizzle/` returns >= 1 (D-E policy is in the journaled migration, D-F)
