# Plan brief — FXL Finders v1.0

Cascading decisions log. Every planner / executor subagent reads this BEFORE starting work. Decisions land here after each wave completes (main context appends, no briefing subagent).

## Wave 0 — Spec anchor

**Canonical design spec:** `docs/superpowers/specs/2026-05-28-fxl-finders-v1-design.md` (every planner MUST read this in full).

**Stack (template-inherited, do not re-decide):**
- apps/api: Hono + Drizzle + Postgres + Clerk Backend SDK (port 3006)
- apps/web: React 18 + Vite + React Router v6 + Clerk React + TanStack Query + shadcn/ui + Tailwind + i18next (port 8006)
- apps/site: Next.js 15 (App Router) + Tailwind v4 (port 4006)
- apps/mobile: Expo Router + Clerk Expo — **deferred entirely in v1.0**

**FXL contract (CLAUDE.md, non-negotiable):**
- Every tenant table has `org_id text NOT NULL` with RLS policy
- Backend extracts `org_id` from Clerk JWT: `payload.org_id ?? payload.sub`
- All queries filter by org_id; mutations include `eq(id, ...)` AND `eq(orgId, ...)`
- `DATABASE_URL` backend-only — never prefix with `VITE_`
- Named exports only; functional components only; strict TypeScript (no `any`)
- Query invalidation via `invalidateQueries()` (never `resetQueries()`)
- Loading: `isLoading` → skeleton; `!isLoading && empty` → empty state; `!isLoading && data` → content
- KPICard for all metric displays (`title`, `value`, `icon`, `isLoading`, `colorScheme`)
- Hono domain pattern: `apps/api/src/domains/{name}/routes.ts` + `service.ts` (Zod schemas + Drizzle queries)
- i18n: PT-BR primary, EN secondary; all user-facing strings via `useTranslation()`

**Phase 0 decisions (locked):**
- Scope: Platform + fxl-financiero integration only (no gps-comercial, aluga-flow, etc.)
- Finder onboarding: public signup + admin approval workflow
- Payout: manual + CSV export (no Asaas integration)
- Price band model: per-product `(min, list, max)` for `setup` and `monthly` components
- Sellers: first-class entity with their own Clerk login + read-only dashboard
- Sale-close trigger: reuse fxl-financiero's `first_paid_at` on `org_attribution`
- Commission rate model: per-product flat `(setup_rate_pct, recurring_rate_pct, recurring_months)`
- Attribution window: 30-day last-touch (per-app configurable via `apps.attribution_window_days`)
- Commission hold: 30 days (per-app configurable via `apps.commission_hold_days`)
- Webhook direction: push (sibling app → FXL Finders), HMAC-SHA256+timestamp signature on raw body
- Money type: `int` cents (BRL only in v1.0)
- Identity model: each finder = one Clerk org

**Apps/web routing convention:**
- `/links`, `/commissions`, `/payouts` — finder portal
- `/seller/deals` — seller portal (read-only)
- `/admin/finders`, `/admin/apps`, `/admin/products`, `/admin/payouts`, `/admin/audit` — admin
- Route-level role gates via Clerk publicMetadata.role (`admin` | `seller` | `finder`)

**Apps/site routing convention:**
- `/` — landing page (template-inherited Hero/Features/HowItWorks/Footer; refactor copy in Phase 03)
- `/signup` — public finder signup form (Phase 03)
- `/r/:code` — referral redirect handler (Phase 04)
- `/legal/privacy`, `/legal/terms` — LGPD-compliant static pages (Phase 03)

**Apps/api routing convention:**
- `/api/v1/finders/*` — finder self-service
- `/api/v1/admin/*` — admin operations
- `/api/v1/links/*` — link generation
- `/api/v1/clicks` — public, called from /r/:code
- `/api/v1/conversions` — HMAC-verified webhook from sibling apps
- `/api/v1/payouts/*` — admin payout workflow

**Schema conventions (all tables):**
- `id uuid PK DEFAULT gen_random_uuid()`
- `created_at timestamptz NOT NULL DEFAULT now()`
- `updated_at timestamptz` (auto-updated via Drizzle hook or DB trigger — pick in Phase 01)
- Money: `int` (cents), never `numeric` or `float` in v1.0
- All FKs reference `id`; never `external_*_id` style

**RLS plan (Phase 01):**
- `FORCE ROW LEVEL SECURITY` on every tenant-scoped table
- Tenant context: `set_config('app.current_org_id', $org_id, true)` per-transaction (transaction-local)
- Policy: `USING (org_id = current_setting('app.current_org_id')) WITH CHECK (org_id = ...)`
- App-runtime DB role: `fxl_finders_app` — no `BYPASSRLS`, not table owner
- Migration DB role: `fxl_finders_owner` — owner, used only for migrations
- Admin endpoints use a separate `support_role` connection with audit logging

## Wave 1 decisions (Phase 01 — Schema foundation + Clerk auth + RLS)

- PLAN.md path: `.planning/phases/01-schema-foundation-clerk-auth-rls/01-PLAN.md` (15 tasks)
- 9 foundation tables shipped in Phase 01: `finders`, `sellers`, `apps`, `products`, `price_bands`, `commission_rules`, `audit_log`, `webhook_events`, `leads`
- Tables explicitly deferred to owning phase: `referral_links` + `clicks` (Phase 04), `conversions` + `commissions` + `payouts` (Phase 05)
- `leads.link_id` and `leads.click_id` ship as **soft FKs** in Phase 01 (no `references()`) because `referral_links` / `clicks` don't exist yet. Hard FK constraints added in Phase 04 migration. (01)
- Integration test harness for RLS: **vitest + raw `postgres` npm client** (not pgTAP — avoids Postgres-extension Docker complexity). Tests live in `apps/api/test/rls/cross-tenant.test.ts`. (01)
- Vitest config split: **unit project + integration project** — unit tests run on every commit, integration tests run in CI against the docker-compose Postgres. (01)
- RLS migration: **hand-authored SQL** (`CREATE POLICY`, `FORCE ROW LEVEL SECURITY`, role grants). Drizzle Kit doesn't generate policy statements. Lives alongside the auto-generated `drizzle/` migration. (01)
- DB roles: `fxl_finders_owner` (migration role, table owner) + `fxl_finders_app` (runtime role, no BYPASSRLS, not table owner). Set via grants in the RLS migration. (01)
- Auth middleware exports two helpers: `clerkAuthMiddleware` (verifies JWT, sets `c.set('orgId', ...)`) + `setTenantContext` (called inside transaction body to run `set_config('app.current_org_id', $1, true)`). Phases 02+ MUST call `setTenantContext` inside every transaction that touches a tenant-scoped table. (01)
- Clerk dashboard config (Restricted mode + no end-user org creation) handled out-of-band; documented as a checklist item with a call-out in `.env.dev.example` and the handoff. (01)
- Money columns stay `integer` cents; rate columns (`setup_rate_pct`, `recurring_rate_pct`) are `numeric(5,2)` (rates aren't money). (01)

## Wave 2 decisions (Phases 02 + 03)

**Phase 02 — Apps + products + price bands admin** (`.planning/phases/02-apps-products-price-bands-admin/02-PLAN.md`, 9 tasks)
- Admin tables (`apps`, `products`, `price_bands`, `commission_rules`) have **NO RLS** — admin-managed cross-tenant. `setTenantContext` MUST NEVER be called in admin domain routes. T09 has a grep assertion enforcing this. (02)
- Admin role check reads `publicMetadata.role` directly from already-verified Clerk JWT claims — no extra `clerkClient.users.getUser()` call per request. (02)
- Product detail at `/admin/products/:id` (separate page + tabs), NOT a modal — price-band + commission content too complex for dialog. (02)
- Key gen split to own TDD task (`keys.test.ts`) before service layer. pk_ plaintext lookup; sk_ SHA-256 hash; webhook_signing_secret plaintext. Reveal-once modal for secret. (02)
- `/gsd-ui-phase 02` is a REQUIRED prerequisite — executor runs it before T01.
- New shadcn components needed: table, dialog, badge, select, tabs.

**Phase 03 — Finder onboarding + portal shell** (`.planning/phases/03-finder-onboarding-portal-shell/03-PLAN.md`, 14 tasks)
- apps/site i18n: inline `getT()` + local JSON, **no next-intl package** (smallest footprint, PT-BR only on site). (03)
- LGPD consent: 4 consent columns added to `finders` via Phase 03 migration T01 (NOT in Phase 01 schema). If Phase 01 not yet executed at run time, executor folds them into 01 T02 instead. (03)
- `finders.org_id` = `''` empty-string placeholder at signup (before Clerk org exists); real org_id set at admin approval. (03)
- `sellers.clerk_user_id` = `''` until Clerk `user.created` webhook fires — backfill deferred to Phase 05. (03)
- Signup: Server Action + `useActionState` + honeypot field (no Turnstile in v1.0). Zod client+server validation. (03)
- Role routing via `RoleGuard` reading Clerk publicMetadata.role: admin→admin/, finder→finder/, seller→seller/, none→NoRolePage. (03)
- Approve flow: backend creates Clerk org + `clerkClient.invitations.createInvitation()`, flips status pending→approved. (03)
- `/gsd-ui-phase 03` is a REQUIRED prerequisite — executor runs it before T01.

**Cross-phase coordination flags (carry into execution):**
1. LGPD columns: Phase 03 T01 owns them; Phase 01 executor must NOT also add them (avoid dup migration). Resolve at execute time by ordering: 01 ships 9 tables WITHOUT consent cols; 03 T01 adds them.
2. `finders.org_id NOT NULL` + `''` placeholder — confirm Phase 01 schema allows empty string (NOT NULL satisfied by `''`). OK.
3. `sellers.clerk_user_id` backfill via Clerk webhook — Phase 05 owns the `user.created` handler.
4. Confirm `@hono/zod-validator` + `clerkClient` singleton present before Phase 02/03 execute; create as sub-step if missing.

## Wave 3 decisions (Phase 04 — Referral links + signed redirect + click telemetry)

PLAN.md: `.planning/phases/04-referral-links-signed-redirect-click-telemetry/04-PLAN.md` (10 tasks, 4 internal waves)
- ULID lib: **`ulidx`** (ESM-native tree-shaking) over `ulid`. (04)
- HMAC util lives in **`packages/shared-utils`** (sign + verify) so Phase 05 webhook verify imports it — no dup. `shared-utils` must be built before apps consume it. (04)
- `clicks` RLS = **split two-policy**: `INSERT WITH CHECK (true)` for public /r/[code] path (no JWT) + `SELECT USING (org_id=current_setting('app.current_org_id'))` for finder dashboard. (04) — Phase 05 conversion ingestion has the SAME no-JWT-on-write problem; reuse this pattern for any public-write table.
- `destination_url` stores resolved host+path at link creation (`https://<first_allowed_host>/precos`); `?ref=<click_id>&fxl_sig=<hmac>` appended at redirect time. (04)
- Two finder endpoints added: `GET /api/v1/finder/apps` (link-generator dropdown), `GET /api/v1/finder/clicks` (paginated dashboard list). (04)
- apps/site needs a NEW DB connection pattern `apps/site/src/lib/db.ts` (Next.js Route Handler on Node runtime needs Drizzle + crypto). (04) — Phase 06 payout/cross-repo work does NOT need this; only /r/[code] does.
- Rate limit: **Upstash Ratelimit** (per-IP 60/min + per-code 300/min). Needs UPSTASH_REDIS_REST_URL + TOKEN env vars. (04)
- Drizzle DESC index limitation → manual SQL in RLS/index migration. (04)
- `/gsd-ui-phase 04` REQUIRED before T01 (link generator + clicks dashboard UI).

**Wave 3 failure-list items (carry to execution):** ulidx ESM/CJS compat check; shared-utils build-before-consume ordering; Drizzle DESC index manual-SQL fallback; apps/site db.ts new pattern.

## Wave 4 decisions (Phase 05 — Conversion ingestion + commission ledger + audit)

PLAN.md: `.planning/phases/05-conversion-ingestion-commission-ledger-audit/05-PLAN.md` (14 tasks, 5 internal waves)
- Nightly hold-promotion job: **`node-cron`** inside apps/api process (`pnpm add node-cron`). Cron: `0 3 * * *` (03:00 UTC). Manual admin endpoint `POST /api/v1/admin/commissions/promote-locked` also exposed. BullMQ upgrade deferred to v1.1. (05)
- Hono raw body: `Buffer.from(await c.req.raw.clone().arrayBuffer())` — `.clone()` is MANDATORY so the body stream is preserved for downstream JSON parsing. Stored on context via `c.set('rawBody', rawBody)`. HMAC middleware MUST be registered BEFORE `@hono/zod-validator`. (05)
- `conversions` + `commissions` split-RLS: INSERT `WITH CHECK (true)` (webhook, no JWT); SELECT `USING (org_id=current_setting(...))` (finder/admin). `payouts` has NO RLS (admin-managed cross-tenant, same as `apps`/`products`). (05)
- Commission basis: always `realized_*_brl` (spec § 10). Zero-realized → no commission row inserted. Reversal of a `paid` commission inserts a NEW negative-amount row (immutable original). (05)
- Audit hash chain: `entry_hash = sha256(prev_hash || canonical_json(row_without_hashes))`. `canonical_json = JSON.stringify(obj, Object.keys(obj).sort())`. First-row `prev_hash = '0'.repeat(64)`. `writeAuditEntry` uses `FOR UPDATE` on tail row inside transaction. `actor_user_id = 'system'` for webhook-triggered entries. (05)
- Clerk webhook backfill: `svix` package (`pnpm add svix`); `POST /api/v1/webhooks/clerk`; verifies `user.created` event and backfills `sellers.clerk_user_id` by email match. (05)
- `/gsd-ui-phase 05` REQUIRED before T10 (admin reconciliation views: conversions, commissions, audit). (05)

**Wave 4 failure-list items (carry to execution):** svix version compat with Clerk (check docs); node-cron graceful shutdown (`.destroy()` in shutdown handler); audit `FOR UPDATE` deadlock risk on high-concurrency (upgrade to SERIALIZABLE if needed); Drizzle `numeric(5,2)` returns as string — cast with `Number(rate_pct)` in commission calc; `ingestConversion` attribution_not_found is a known v1.0 gap for direct sales; `CLERK_WEBHOOK_SIGNING_SECRET` must be in `.env.dev.example` + Clerk Dashboard checklist.

## Wave 5 decisions (Phase 06 — fxl-financiero integration + payout CSV)

PLAN.md: `.planning/phases/06-fxl-financeiro-integration-payout-csv/06-PLAN.md` (12 tasks). NOTE: hand-authored in GSD format (gsd-plan-phase internal checker skipped to avoid a re-timeout) — gets extra scrutiny in pre-execution review.
- `payout_batches` schema added in Phase 06 T02 (spec called it `payouts`; planner named it `payout_batches` — RECONCILE: spec § 4 table is `payouts`; treat `payout_batches` as the same table, prefer spec name `payouts` at execute time). (06)
- Outbound webhook `idempotency_key` = plain SHA-256 (`createHash`), NOT HMAC. HMAC is only the X-FXL-Signature transport auth. (06, aligns Phase 05 D11)
- fxl-financiero changes land on branch `feat/fxl-finders-integration` in that repo + patch exported to `docs/nexo/cross-repo/06-financeiro-integration.patch`. NEVER pushed. (06, autopilot guardrail 11)
- financeiro HMAC sign = ~15-line inline impl (can't import packages/shared-utils cross-repo) — MUST byte-match Phase 05 verify (`ts + "." + rawbody`, sha256). (06)
- Seed values are PLACEHOLDERS to confirm: financeiro price bands (setup 80000/100000/150000; monthly 8000/10700/20000 cents), commission rates 30/20/12. `allowed_redirect_hosts` real host TBD. `webhook_signing_secret` generated post-migration via admin UI (never commit a real secret). (06)
- CSV: UTF-8 BOM for Excel-PT; `Intl.NumberFormat('pt-BR')`. (06)
- fxl-financiero files the diff touches: `apps/api/src/db/schema/checkout.ts`, `apps/api/src/db/schema/org-attribution.ts`, `apps/api/src/lib/fxl-finders-webhook.ts` (new), `apps/api/src/domains/partners/service.ts`, `apps/site/src/app/precos/page.tsx`, `apps/site/src/app/checkout/credit-card/page.tsx`, `.env.example`, + generated migration.

**Wave 5 failure-list items:** allowed_redirect_hosts host placeholder; webhook_signing_secret post-migration gen; CSV pt-BR separators; checkout_attempts.org_id nullable at first_paid_at (T08 guard); fxl_ref cookie cross-subdomain domain attr; node-cron shutdown shared w/ Phase 05; idempotency_key collision surface; two-person-approval v1.1 deferral comment.

## Cross-phase reconciliation rules (apply at execute time)

1. **Table name `payouts` vs `payout_batches`:** spec says `payouts`. Use `payouts`. (Phase 05 declares payouts; Phase 06 also references — single table, Phase 05 owns the DDL, Phase 06 adds batch UI/service.)
2. **HMAC util single source:** `packages/shared-utils` sign+verify (Phase 04). Phase 05 imports verify. Phase 06 financeiro side reimplements inline (cross-repo) — keep test that asserts byte-match.
3. **Split-RLS public-write pattern** (Phase 04 clicks): reused by Phase 05 conversions/commissions webhook writes. Same `INSERT WITH CHECK (true)` + `SELECT USING (org_id=...)`.
4. **node-cron**: ONE scheduler instance in apps/api (Phase 05 owns it). Phase 06 must not spawn a second. Register both jobs (hold-promotion, any payout job) on the same scheduler.
5. **LGPD consent columns** on `finders`: Phase 03 T01 owns. Phase 01 must NOT add them.
6. **seller.clerk_user_id backfill**: Phase 05 Clerk `user.created` webhook owns it; Phase 03 ships `''` placeholder.
7. **Migration ordering** = phase order: 01 (9 tables) → 03 (LGPD cols) → 04 (referral_links, clicks, hard FKs) → 05 (conversions, commissions, payouts) → 06 (seed + financeiro-side via patch).

## ⛔ PRE-EXECUTION REVIEW RECONCILIATIONS (LOCKED — override any conflicting PLAN.md text)

Adversarial review (7 agents) returned 22 BLOCKERs across all phases. These decisions are AUTHORITATIVE. Where a PLAN.md contradicts a decision below, the decision wins. Executors apply these.

**D-A · Canonical app slug = `fxl-financiero`** (…ciero, spec spelling). Used byte-identically in seed, webhook `source`, conversions.source, all fixtures. Phase 06 verify gate: `grep -rn 'fxl-financeiro' apps/ docs/` (…ceiro) MUST return 0 (the phase DIRECTORY name keeps …ceiro — cosmetic, exempt).

**D-B · Admin auth — ONE mechanism:**
- Phase 01 `clerkAuthMiddleware` (rename export from `authMiddleware`; keep `authMiddleware` as alias) OWNS role extraction. Augment Hono `ContextVariableMap` with `userId: string`, `orgId: string`, `userRole: string | undefined`. Extract `userRole` from verified JWT payload `publicMetadata?.role`. NEVER call `clerkClient.users.getUser()` in a request path.
- ONE admin guard: `apps/api/src/middleware/require-admin.ts` → `requireAdmin` reading `c.get('userRole') === 'admin'`. Phase 02 DELETES its `adminAuth.ts`/`adminAuthMiddleware`/`isAdmin` var and consumes `requireAdmin`. Phases 05/06 reference `requireAdmin`.
- Clerk JWT custom-claim: Phase 01 documents (Clerk dashboard) a session-token claim injecting `publicMetadata.role` into the JWT, + `.env` note + handoff item. Without it the backend gate reads undefined → 403s every admin.

**D-C · Admin RLS-bypass connection:** `finders`, `leads`, `referral_links`, `clicks`, `conversions`, `commissions` are FORCE RLS. Admin/cross-tenant routes (Phase 03 finders approve/suspend; Phase 05 commissions/conversions admin reads + state transitions; Phase 06 payouts) use a dedicated BYPASSRLS connection. Phase 01 creates role `fxl_finders_admin` (LOGIN, BYPASSRLS) + exposes `ADMIN_DATABASE_URL` + `getAdminDb()` in `db/client.ts`. Admin domain routes use `getAdminDb()`; never `setTenantContext` on admin routes. Every admin money mutation still writes `audit_log`. This kills the `commissions_update_admin USING(true)` cross-tenant hole (admin runs as BYPASSRLS, not app role).

**D-D · `setTenantContext` is transaction-scoped:** signature `setTenantContext(tx, orgId)` takes a tx handle. Every tenant-scoped service fn: `await db.transaction(async (tx) => { await setTenantContext(tx, orgId); /* queries via tx */ })`. Connection-level set_config does NOT survive pooling. Phase 01 fixes helper (+ `import { sql } from 'drizzle-orm'`); Phases 04/05 consumers use the tx form. RLS integration test proves own-rows-visible + cross-org-zero under one tx.

**D-E · `referral_links` public read:** add policy `referral_links_public_lookup AS PERMISSIVE FOR SELECT TO fxl_finders_app USING (true)` — the 10-char code is the bearer secret. Without it /r/[code] returns 410 always. Phase 04 fix. (Same split-RLS family as `clicks`.)

**D-F · RLS applied via journaled migration:** RLS/policy/role-grant SQL is APPENDED INTO the Drizzle-generated migration file (registered in `_journal.json`), NOT a standalone unjournaled `.sql` (the migrator skips those). Phase 01 fix. Acceptance: after `pnpm db:migrate`, `SELECT * FROM pg_policies` shows the policies.

**D-G · RLS test harness:** integration tests connect as `fxl_finders_app` (Phase 01 must `CREATE ROLE fxl_finders_app LOGIN PASSWORD ...` — bare role can't connect). Superuser `postgres` BYPASSES RLS, so testing as postgres validates nothing. vitest `globalSetup` runs migrations against `TEST_DATABASE_URL` first. Include a positive control (org A reads its own row = 1 row) alongside the cross-org-zero assertion. Test the UPDATE path too, not just INSERT/SELECT.

**D-H · DB access pattern:** `getDb()` (lazy) from `apps/api/src/db/client.ts`. NO `db` singleton, NO `db/index.ts`. Add `getAdminDb()` (BYPASSRLS conn) per D-C. All backend tasks use these.

**D-I · `clerkClient` singleton:** Phase 01 creates `apps/api/src/lib/clerk.ts` → `export const clerkClient = createClerkClient({ secretKey: env.CLERK_SECRET_KEY })`. Phases 03/05 import it. Do NOT `import { clerkClient } from '@clerk/backend'` (not a bound default in v1.x).

**D-J · Frontend API client:** all calls use the existing `apiFetch(path, { method, token, body })` (prepends `VITE_API_URL`, attaches Bearer). Pass Clerk `useAuth().getToken()` into every authed call. NO bare relative `fetch('/api/...')`, NO `apiClient.get`. Fix `api-client.ts` default port `3000`→`3006`. Phases 02/03 fix.

**D-K · Commission lifecycle (spec §6 step 13 authoritative):** nightly job promotes `pending → locked` WHERE `hold_until < now()` (NO auto 'approved' step). Manual admin "approve/lock-now" is an OPTIONAL fast-track and shows for `status='pending'`. Enum keeps all 5 values but auto path is pending→locked→paid→(reversed). Fix Phase 05 T03 promote job, T08, T11 button gating, D6, must_haves, and the TDD cases (must assert a freshly-ingested commission reaches 'locked' after hold with NO manual action).

**D-L · `ingestConversion` completeness (Phase 05 T05):** in ONE tx — (1) snapshot `quoted_setup_brl`/`quoted_monthly_brl` from resolved `referral_links` row into conversions; (2) compute + store `customer_email_hash`; (3) INSERT a `leads` PII row (status='converted') from body PII (LGPD §9 deliverable); (4) receive `rawBodyHash` from the route handler for `webhook_events.body_hash` (service can't see raw body otherwise).

**D-M · Webhook body contract (ONE field set, Phase 05 schema == Phase 06 sender):**
`{ source, external_order_id, event_type, idempotency_key, click_id (nullable), finder_code (optional), seller_clerk_id (nullable), customer_email, customer_name, customer_phone, customer_cpf, customer_org_id, realized_setup_brl, realized_monthly_brl, closed_at }`.
Attribution: resolve link by click_id within window; else resolve finder by `finder_code`; else throw `attribution_not_found` (return 4xx so financeiro retries/alerts — never silently drop). Add `finder_code` to `WebhookBodySchema` (optional) + implement the fallback.

**D-N · `idempotency_key = createHash('sha256').update(source + external_order_id + event_type).digest('hex')`** everywhere (plain SHA-256, NOT HMAC). Fix Phase 06 T08 literal (delete the `createHmac('sha256','')` line). Phase 06 T04 adds byte-match TDD vs Phase 05 `buildIdempotencyKey`.

**D-O · HMAC util:** `verifyHmac(secret, payload, sig)` where `payload = ts + "." + rawBody`; header `t=<ts>,v1=<hex>` parsed by middleware. Phase 06 T04 uses `verifyHmac` (the `verify(header,...)` export does NOT exist). INVARIANT: sign and verify over the IDENTICAL raw byte string — never re-serialize between sign→send or receive→verify. HMAC middleware returns a GENERIC 401 for unknown-source/bad-sig/expired (no source-existence oracle).

**D-P · `fxl_sig` referral signature (pin Phase 04's actual construction):** `fxl_sig = hmac(click_id + "." + link.signature, app.webhook_signing_secret)`, `link.signature = hmac([finderId,productId,quotedSetup,quotedMonthly].join(":"), secret)`. v1.0: financeiro PERSISTS click_id + fxl_sig but verification of fxl_sig is DEFERRED (just store both) — reduces cross-repo coupling. Formula pinned here for when verification is added.

**D-Q · Payout domain — ONE design (Phase 05 owns):** single `payouts` table + `commissions.paid_payout_id` FK + `locked→paid` transition + payouts service/routes (Phase 05 T08). Phase 06 DELETES `payout_batches`/`payout_batch_items` (T02 removed), adds ONLY: `listFindersWithLockedCommissions` + `generateCsv(payoutIds[])` to the Phase 05 service + admin batch UI. NO `in_payout` status, NO `payout_batch_id` column. Reserve semantics: `createPayoutBatch` sets `commissions.paid_payout_id` (stays 'locked'); `markPayoutPaid` flips locked→paid. Finders missing cpf/pix_key are excluded/flagged with a clear error (not a NOT NULL crash). Admin payouts UI lives in Phase 06 (Phase 05 notes the deferral).

**D-R · Misc blocker/warn fixes:**
- honeypot (03 T02): `website: z.string().optional()`; decision in handler (non-empty → silent 201, no insert).
- mount (03 T02): `apps/api/src/server.ts` (NOT index.ts); create clerkAuthMiddleware-protected admin group + mount public signup unauthenticated.
- approve flow (03): idempotent — `SELECT ... FOR UPDATE`, create Clerk org only if `clerk_org_id` empty, handle invite-send failure explicitly. Add `suspendFinder` state guard. Add TDD for the approve/suspend state machine.
- signup client schema (03 T06): create `apps/site/src/app/signup/signup-schema-client.ts`.
- i18n merge (03): explicit task writes all new keys into `apps/web/src/i18n/pt-BR.json` + `en.json`; assert i18next resolves them.
- Phase 06 seed (T01): all NOT NULL cols on `apps` (publishable_key, secret_key_hash, secret_key_prefix, status='active', created_by_user_id='system') + generated real `webhook_signing_secret`; `products.status='active'`; price_bands cols `min_brl/list_brl/max_brl`.
- fxl_ref cookie (Phase 04 T06, finding tagged 06): `HttpOnly=true`, `Secure`, `SameSite=Lax`, 90-day (per spec; click_id already in URL so JS read not needed).
- classifyUa + click-handler tests (04): add `ua-family.test.ts` + branch tests (410/410/500/302).
- numeric rate_pct string TDD (05): test rate passed as string `'30.00'`.
- automated e2e conversion contract test (06): Hono test client posts exact T08 body w/ valid sig → 200 accepted + rows + 200 duplicate on replay (not manual-only).
- NITs to fold (cheap): org_id indexes on finders/leads (01); `UpdateAppSchema = CreateAppSchema.omit({slug:true}).partial()` (02); api-client port 3006 (02); remove stray `'use client'` from RoleGuard code fence (03); fix T03 `</read_first>` tag (06); audit badge label "Página íntegra" or full-chain endpoint (05).
- DEFER (note only, no v1.0 code): /signup rate-limit → v1.1; rotateSecret audit rows → with Phase 05 hash-chain; resolveActors/userLabel shared helper → accept per-endpoint display_name fields for v1.0.

**Sub-agent context-source order (use this exact prefix in every dispatched agent prompt):**
```
CONTEXT SOURCES (read these first, do NOT re-scan source files unless the task explicitly requires it):
1. .planning/plan-brief.md — cascading decisions (this file — read first)
2. docs/superpowers/specs/2026-05-28-fxl-finders-v1-design.md — canonical FXL Finders v1.0 design spec
3. .planning/ROADMAP.md — phase list and dependencies
4. ./CLAUDE.md — FXL contract (project instructions)
Only read source files when the task explicitly requires code-level detail.
```
