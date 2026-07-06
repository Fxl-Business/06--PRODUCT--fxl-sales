# FXL Sales v1.0 — Design Spec

**Date:** 2026-05-28
**Status:** Draft (under autopilot — `/nexo:autopilot` active; user-review gate skipped per autopilot rule 4)
**Milestone target:** v1.0
**Phase tier:** Tier 2 (6 phases)

---

## 1. Problem & scope

FXL operates a portfolio of SaaS products (fxl-financiero, gps-comercial, aluga-flow, dm-logistica, universal-laudos, apice-laudos, fxl-support). The first production SaaS, fxl-financiero, already carries a partner program inside its own admin panel — `org_attribution(indicated_by_user_id, sold_by_user_id)` plus a `commission_ledger` — but it has three structural limits:

1. Finders are admin-managed records, not first-class users with their own application
2. Attribution is single-product (financeiro only); no concept of a cross-portfolio Finder
3. Checkout setup fee is hard-coded; Finder cannot quote a price within an admin-defined band

FXL Sales v1.0 builds the standalone Finders platform and wires the first cross-product integration (fxl-financiero) so commission data flows end-to-end on day one.

### In scope (v1.0)

- Standalone FXL Sales SaaS (apps/api, apps/web finder+admin portal, apps/site public)
- Finder onboarding (public signup → admin approval → Clerk invite)
- Seller entity (FXL employees, first-class with read-only dashboard)
- Apps registry + per-app webhook secrets (fxl-support dual-key pattern)
- Per-product price bands `(setup_min, setup_list, setup_max, monthly_min, monthly_list, monthly_max)`
- Per-product commission rules `(setup_rate_pct, recurring_rate_pct, recurring_months)`
- Referral link generation, signed URL, click telemetry
- Conversion ingestion API (HMAC-verified webhook from sibling apps)
- Commission ledger with state machine `pending → approved → locked → paid → reversed`, 30-day hold
- fxl-financiero integration (cross-repo): `?ref` accepted on checkout, outbound webhook on `first_paid_at`
- Payout: admin marks paid + CSV export (PIX key + CPF + amount). No payment-rail integration in v1.0
- Append-only audit ledger for money-mutating actions (hash-chained)
- PT-BR primary, EN secondary

### Out of scope (deferred)

- Mobile app (apps/mobile scaffold stays untouched in v1.0)
- Asaas auto-PIX payouts
- Finder tier overrides on commission rates (per-product flat for v1.0)
- gps-comercial / aluga-flow / other sibling integrations (separate milestones)
- Two-person approval for high-value adjustments (data model supports it; UI deferred)
- DSAR self-service UI (admin handles requests manually)
- Multi-touch attribution payout splitting (last-touch only; multi-touch audit log retained)
- Markup-above-list 100%-to-finder mechanism (price-band supports it numerically; logic deferred)
- Finder-specific commission rate overrides
- Cookieless tracking fallback for the referral cookie (HttpOnly cookie + click_id in URL is sufficient)

---

## 2. Decisions & rationale

| Decision | Choice | Rationale |
|---|---|---|
| v1.0 integration scope | Platform + fxl-financiero only | User-confirmed. Only app with live revenue; validates the contract before fanning out |
| Finder onboarding | Public signup + admin approval | User-confirmed. Reduces friction vs invite-only while keeping a contract gate |
| Payout method | Manual + CSV export | User-confirmed. Zero payment-rail risk in v1.0; matches fxl-financiero's current pattern |
| Price band model | Per-product (min, list, max) tuple | User-confirmed. Simple, transparent, supports both discount and markup |
| Sellers | First-class in Finders, opt-in Clerk login | User-confirmed. Read-only dashboard; actual seller pay stays in HR |
| Sale-close trigger | Reuse fxl-financiero's `first_paid_at` | Autopilot. Minimal new business logic in financeiro repo |
| Commission rate model | Per-product flat `(setup_rate_pct, recurring_rate_pct, recurring_months)` | Autopilot. Finder tiers deferred |
| Attribution window | 30-day last-touch (per-app configurable) | Autopilot. Affiliate-industry default |
| Webhook direction | Push (sibling app → FXL Sales), HMAC-signed | Autopilot. Real-time, matches fxl-support direction |
| Apps split | api=backend, web=finder+admin, site=public+`/r/:code`, mobile=defer | Autopilot. Matches template scaffold |

---

## 3. System boundaries

```
┌─────────────────────────────────────────────────────────────────────┐
│                        FXL Sales v1.0                             │
│                                                                     │
│  apps/site (Next.js)        apps/web (Vite + React)                │
│  ─────────────────────      ──────────────────────                 │
│  /                          /                                       │
│  /signup                    /links            (finder portal)       │
│  /r/:code  ──redirect──>    /commissions      (finder portal)       │
│             ↓               /payouts          (finder portal)       │
│  (drops HttpOnly cookie,    /seller/deals     (seller portal)       │
│   mints click_id ULID,      /admin/finders    (admin)               │
│   redirects to sibling      /admin/apps       (admin)               │
│   with ?ref=<click_id>      /admin/products   (admin)               │
│   &fxl_sig=<hmac>)          /admin/payouts    (admin)               │
│                             /admin/audit      (admin)               │
│                                                                     │
│              ┌───────────────────────────────────┐                  │
│              │     apps/api (Hono, port 3006)    │                  │
│              │     /api/v1/finders/*             │                  │
│              │     /api/v1/admin/*               │                  │
│              │     /api/v1/links/*               │                  │
│              │     /api/v1/clicks (public, /r)   │                  │
│              │     /api/v1/conversions (HMAC)    │                  │
│              │     /api/v1/payouts/*             │                  │
│              └─────────────────┬─────────────────┘                  │
│                                │                                    │
│                    ┌───────────▼──────────┐                         │
│                    │  Postgres (Drizzle)  │                         │
│                    │  RLS enforced        │                         │
│                    └──────────────────────┘                         │
└─────────────────────────────────────────────────────────────────────┘
                                ▲
                  HMAC-signed webhook (POST)
                                │
┌─────────────────────────────────────────────────────────────────────┐
│   Sibling FXL apps (v1.0: fxl-financiero only)                      │
│   ─────────────────────────────────────────                         │
│   On `first_paid_at` → POST /api/v1/conversions                     │
│   Body signed with X-FXL-Signature: t=<ts>,v1=<hmac_sha256>         │
│   Includes idempotency_key = sha256(source + external_order_id      │
│                                      + event_type)                  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 4. Data model (Drizzle)

All tables include `id uuid PK`, `created_at timestamptz NOT NULL DEFAULT now()`, `updated_at timestamptz`. RLS enforced via `FORCE ROW LEVEL SECURITY` and `current_setting('app.current_org_id')` on every tenant-scoped table. Tenant scoping notes are per-table below — note that "tenant" for FXL Sales is the **finder's own org**, and admin/seller tables sit outside that scope with a `BYPASSRLS`-equivalent role.

### `finders`
Finder record. One per Clerk user. Tenant-scoped by `org_id` (finder's own org).
```
id uuid PK
clerk_user_id text UNIQUE NOT NULL
clerk_org_id text UNIQUE NOT NULL  -- one org per finder
status text NOT NULL  -- 'pending' | 'approved' | 'suspended'
display_name text NOT NULL
contact_email text NOT NULL
cpf text  -- payout identity
phone text
pix_key text
pix_key_type text  -- 'cpf' | 'email' | 'phone' | 'random'
payout_address jsonb
approved_at timestamptz
approved_by_user_id text  -- admin Clerk user_id
suspended_at timestamptz
suspended_reason text
```

### `sellers`
FXL employee record. One per Clerk user. Cross-org, admin-managed.
```
id uuid PK
clerk_user_id text UNIQUE NOT NULL
display_name text NOT NULL
contact_email text NOT NULL
status text NOT NULL  -- 'active' | 'inactive'
```

### `apps`
Registry of FXL product apps that integrate with Finders. fxl-support dual-key pattern.
```
id uuid PK
slug text UNIQUE NOT NULL  -- e.g. 'fxl-financiero'
name text NOT NULL
publishable_key text UNIQUE NOT NULL  -- pk_<random>
secret_key_hash text NOT NULL  -- sha256(sk_<random>)
secret_key_prefix text NOT NULL  -- sk_xxx for UI display
webhook_signing_secret text NOT NULL  -- separate from secret_key; for inbound HMAC
allowed_redirect_hosts text[] NOT NULL  -- referral redirect destination allowlist
attribution_window_days int NOT NULL DEFAULT 30  -- max click→sale gap for last-touch linkage
commission_hold_days int NOT NULL DEFAULT 30    -- clawback hold; commission stays 'pending' this long
status text NOT NULL  -- 'active' | 'disabled'
created_by_user_id text NOT NULL
```

### `products`
Per-app product/SKU.
```
id uuid PK
app_id uuid FK -> apps(id)
slug text NOT NULL  -- e.g. 'core', 'addon-pro'
name text NOT NULL
description text
status text NOT NULL  -- 'active' | 'archived'
UNIQUE(app_id, slug)
```

### `price_bands`
Per-product price band per component. Two rows per product (setup, monthly) typical.
```
id uuid PK
product_id uuid FK -> products(id)
component text NOT NULL  -- 'setup' | 'monthly'
min_brl int NOT NULL  -- cents
list_brl int NOT NULL
max_brl int NOT NULL
CHECK (min_brl <= list_brl AND list_brl <= max_brl)
UNIQUE(product_id, component)
```

### `commission_rules`
Per-product commission. v1.0: per-product flat. Finder overrides deferred.
```
id uuid PK
product_id uuid FK -> products(id) UNIQUE
setup_rate_pct numeric(5,2) NOT NULL  -- e.g. 30.00 = 30%
recurring_rate_pct numeric(5,2) NOT NULL
recurring_months int NOT NULL  -- 0 = setup-only, N = N months of recurring, 999 = lifetime
basis text NOT NULL DEFAULT 'quoted_net'  -- 'quoted_net' | 'list_net'
```

### `referral_links`
Generated by a finder. Carries quoted prices signed into the URL.
```
id uuid PK
code text UNIQUE NOT NULL  -- short ULID-derived, ~10 chars
finder_id uuid FK -> finders(id)
app_id uuid FK -> apps(id)
product_id uuid FK -> products(id)
quoted_setup_brl int NOT NULL  -- cents, within price band
quoted_monthly_brl int NOT NULL
signature text NOT NULL  -- hmac_sha256(finder_id + product_id + quoted_setup + quoted_monthly, app.webhook_signing_secret)
destination_url text NOT NULL  -- full deep-link with ?ref placeholder pre-resolved
status text NOT NULL  -- 'active' | 'revoked'
expires_at timestamptz  -- nullable; default null (never expires until revoked)
revoked_at timestamptz
revoked_reason text
```

### `clicks`
Append-only. One row per `/r/:code` redirect hit.
```
id uuid PK
click_id text UNIQUE NOT NULL  -- ULID, the opaque attribution ID
link_id uuid FK -> referral_links(id)
finder_id uuid  -- denormalized for fast finder dashboards
app_id uuid
product_id uuid
ip_hash text  -- sha256(ip + daily_salt) first 16 chars
ua_family text  -- 'chrome' | 'safari' | 'bot' | etc.
referer text
utm_source text
utm_medium text
utm_campaign text
country text
INDEX(link_id, created_at DESC)
INDEX(finder_id, created_at DESC)
```

### `conversions`
One row per recorded sale. Idempotent on `(source, external_order_id)`.
```
id uuid PK
source text NOT NULL  -- app.slug; e.g. 'fxl-financiero'
external_order_id text NOT NULL  -- e.g. fxl-financiero subscription_id
event_type text NOT NULL DEFAULT 'sale'  -- 'sale' | 'refund'
idempotency_key text UNIQUE NOT NULL  -- sha256(source + external_order_id + event_type)
link_id uuid FK -> referral_links(id)
click_id text  -- last-touch click_id within attribution window
finder_id uuid FK -> finders(id)
seller_id uuid FK -> sellers(id)  -- nullable
app_id uuid FK -> apps(id)
product_id uuid FK -> products(id)
quoted_setup_brl int NOT NULL  -- snapshot from referral_links at conversion time
quoted_monthly_brl int NOT NULL
realized_setup_brl int NOT NULL  -- actual amount charged by sibling app (may differ from quoted on partial pay)
realized_monthly_brl int NOT NULL
customer_email_hash text  -- sha256(email + finder.org_id); for self-referral fraud check
customer_org_id text  -- Clerk org_id in the sibling app
hold_until timestamptz NOT NULL  -- created_at + app.commission_hold_days
closed_at timestamptz NOT NULL  -- sibling app's sale-close timestamp
UNIQUE(source, external_order_id, event_type)
```

### `commissions`
One or two rows per conversion (setup + recurring). State machine drives payouts.
```
id uuid PK
conversion_id uuid FK -> conversions(id)
finder_id uuid FK -> finders(id)
app_id uuid FK -> apps(id)
product_id uuid FK -> products(id)
kind text NOT NULL  -- 'setup' | 'recurring'
basis_brl int NOT NULL  -- amount commission was calculated against
rate_pct numeric(5,2) NOT NULL  -- snapshot from commission_rules
amount_brl int NOT NULL  -- basis * rate / 100
status text NOT NULL  -- 'pending' | 'approved' | 'locked' | 'paid' | 'reversed'
hold_until timestamptz NOT NULL
approved_at timestamptz
approved_by_user_id text
locked_at timestamptz
paid_at timestamptz
paid_payout_id uuid FK -> payouts(id)
reversed_at timestamptz
reversed_reason text
INDEX(finder_id, status)
INDEX(status, hold_until)  -- for batch promotion pending → locked
```

### `payouts`
Admin-initiated batch. One row per payout cycle per finder.
```
id uuid PK
finder_id uuid FK -> finders(id)
total_brl int NOT NULL
status text NOT NULL  -- 'draft' | 'exported' | 'paid' | 'voided'
csv_export_id uuid  -- nullable, links to a per-batch export record
exported_at timestamptz
paid_at timestamptz
paid_by_user_id text
note text
```

### `webhook_events`
Idempotency + replay defense for inbound webhooks.
```
id uuid PK
source text NOT NULL
event_id text NOT NULL  -- sibling app's idempotency_key
body_hash text NOT NULL  -- sha256(raw_body) for paranoia
signature_valid boolean NOT NULL
processed_at timestamptz
processing_error text
UNIQUE(source, event_id)
```

### `audit_log`
Append-only, hash-chained. Money-mutating actions only.
```
id bigserial PK
ts timestamptz NOT NULL DEFAULT now()
actor_user_id text NOT NULL  -- Clerk user_id, or 'system' for webhook-triggered
actor_org_id text
action text NOT NULL  -- 'commission.approve' | 'commission.reverse' | 'payout.mark_paid' | ...
entity_type text NOT NULL
entity_id text NOT NULL
before_jsonb jsonb
after_jsonb jsonb
request_id text
prev_hash text NOT NULL  -- sha256 of prior row, '0'*64 for first row
entry_hash text NOT NULL  -- sha256(prev_hash || canonical_json(row_without_hashes))
```

### `leads`
Schema ships in Phase 01 (cheap; needed for LGPD design). Population by sibling-app lead-stage events is **deferred post-v1.0**; v1.0 only writes `leads` rows when `conversions` lands (denormalized customer PII copy for anonymization). PII isolated for LGPD anonymization-not-deletion path.
```
id uuid PK
click_id text  -- FK-soft to clicks(click_id)
link_id uuid FK -> referral_links(id)
customer_name text
customer_email text
customer_phone text
customer_cpf text
status text NOT NULL  -- 'clicked' | 'lead' | 'converted' | 'churned'
anonymized_at timestamptz  -- when set, name/email/phone/cpf NULLed; row preserved for audit
```

---

## 5. Service-to-service auth

### Inbound webhook (sibling app → FXL Sales)

`POST /api/v1/conversions` and `POST /api/v1/conversions/refund`.

Header: `X-FXL-Signature: t=<unix_ts>,v1=<hex_hmac_sha256>`

Verification (in Hono middleware, runs on raw body before JSON parse):
1. Parse header → `(ts, sig)`
2. Reject if `|now - ts| > 300`
3. Lookup app by body's `source` field (read enough JSON to get it, then re-verify)
4. Recompute: `hmac_sha256(app.webhook_signing_secret, ts + "." + raw_body)`
5. Constant-time compare
6. Insert into `webhook_events` with `ON CONFLICT DO NOTHING RETURNING id` — if no row returned, it's a dupe; return 200 with `{status: 'duplicate'}` and skip
7. Enqueue to processing queue (BullMQ on Redis; queue setup is part of Phase 5)
8. Return 200 within 1s

Source identity = `apps.slug`; signing secret = `apps.webhook_signing_secret`. Each sibling app has its own secret. Rotation: dual-secret cutover via a `apps.webhook_signing_secret_previous` column with a 7-day overlap (deferred to a follow-up if needed — v1.0 ships single-secret with manual rotation note in admin UI).

### Outbound from FXL Sales

None in v1.0. (Future: notify sibling apps when a commission is reversed so they can flag the customer record. Defer.)

### Public referral redirect

`GET /r/:code` (on apps/site, Next.js):
1. Lookup `referral_links.code` → row
2. If `revoked_at IS NOT NULL` or `expires_at < now()` → 410 Gone with branded page
3. Validate `link.destination_url` host is in `app.allowed_redirect_hosts` — guard against admin misconfiguration
4. Mint `click_id` (ULID)
5. Insert `clicks` row (hashed IP, UA family, referer, UTMs from query)
6. Set HttpOnly+Secure+SameSite=Lax cookie `fxl_ref=<click_id>` with 90-day max-age (cookie is a session bridge; click_id is the SoT)
7. 302 to `link.destination_url` with `?ref=<click_id>&fxl_sig=<signature>` appended (sig prevents customer tampering)
8. Rate limit: per-IP 60/min, per-code 300/min (Cloudflare rules or Upstash Ratelimit — Phase 4 picks)

### Frontend API (finder portal + admin)

Standard Clerk JWT in `Authorization: Bearer`. Hono middleware extracts `org_id` (finder portal) or asserts admin role (admin routes) and runs `SELECT set_config('app.current_org_id', $1, true)` per-transaction.

---

## 6. Referral flow end-to-end

```
1. Finder logs into apps/web → /links → "Generate link"
2. Picks app (fxl-financiero) → product (core) → enters quoted_setup (within band) + quoted_monthly (within band)
3. API: validates band, computes signature, inserts referral_links, returns code + full URL
4. Finder shares URL: https://finders.fxl.com.br/r/abc12345
5. Customer clicks
6. apps/site /r/:code handler:
   - lookup code → link + app
   - mint click_id ULID
   - insert clicks row (ip_hash, ua, referer, country)
   - set fxl_ref HttpOnly cookie (90d)
   - 302 to link.destination_url + ?ref=<click_id>&fxl_sig=<hmac(click_id+quoted, app.webhook_signing_secret)>
7. Customer lands on fxl-financiero /precos?ref=<click_id>&fxl_sig=...
8. fxl-financiero:
   - reads ?ref + ?fxl_sig from query, stores on session/checkout_attempt
   - on signup, attaches click_id to org_attribution row
   - normal checkout flow continues
9. Customer pays setup + first month → fxl-financiero sets org_attribution.first_paid_at
10. fxl-financiero outbound webhook fires:
    POST https://finders.fxl.com.br/api/v1/conversions
    X-FXL-Signature: t=...,v1=...
    Body: {
      source: "fxl-financiero",
      external_order_id: "<subscription_id>",
      event_type: "sale",
      idempotency_key: sha256("fxl-financiero" + subscription_id + "sale"),
      click_id: "<from org_attribution.click_id>",
      finder_code: "<from referral_links via click_id lookup>",  // redundant safety
      seller_clerk_id: "<from org_attribution.sold_by_user_id>",  // nullable
      customer_email: "...",
      customer_org_id: "org_xyz",
      realized_setup_brl: 80000,  // R$800 (quoted was R$800; customer paid in full)
      realized_monthly_brl: 10700,
      closed_at: "2026-06-15T..."
    }
11. FXL Sales /api/v1/conversions:
    - HMAC verify on raw body
    - Insert webhook_events ON CONFLICT DO NOTHING → if dupe, 200 + skip
    - Parse body → resolve link by click_id (within 30-day window) → resolve finder_id, app_id, product_id
    - Insert conversions row (idempotency_key UNIQUE protects against any race)
    - Resolve seller_id from seller_clerk_id if present
    - Look up commission_rules(product_id)
    - Insert commissions row for setup: amount = realized_setup * setup_rate_pct / 100
    - Insert commissions row for recurring (if recurring_months > 0): amount = realized_monthly * recurring_rate_pct / 100 * recurring_months
    - Set hold_until = now() + 30 days
    - Audit log: 'conversion.recorded' + 'commission.created' x2 (actor='system')
    - 200 OK
12. Finder dashboard /commissions shows new pending commission
13. After 30 days: nightly job promotes pending → locked (where hold_until < now())
14. Admin reviews /admin/payouts → selects locked commissions → creates payout batch → CSV export
15. Treasurer pays out-of-band → admin marks payout 'paid' → commissions.status = 'paid'
```

---

## 7. Phase plan (preview — formalized via /gsd-plan-phase per phase)

Tier 2: 6 phases. `/nexo:plan-all` spawns ≤3 planner agents.

| # | Phase | Scope | Wave |
|---|---|---|---|
| 01 | **Schema foundation + Clerk auth + RLS** | Drizzle: finders, sellers, apps, products, price_bands, commission_rules, audit_log, webhook_events. Clerk wiring in apps/api/src/middleware/auth.ts. RLS policies + non-owner app role. CI cross-tenant test harness. | W1 |
| 02 | **Apps + products + price bands admin** | apps/web/admin: CRUD UI for apps, products, price bands, commission rules. Key rotation. Allowed-redirect-host editor. | W2 (after 01) |
| 03 | **Finder onboarding + portal shell** | apps/site /signup public form. apps/web finder portal layout + auth-gated dashboard skeleton. apps/web admin approval queue (pending → approved → Clerk invite sent). Seller invite UI. | W2 (parallel with 02; both depend only on 01) |
| 04 | **Referral links + signed redirect + click telemetry** | apps/web finder portal: link generator (validates band, computes signature). apps/api links service. apps/site /r/:code handler with click insert + rate limit + redirect. Clicks dashboard for finder. | W3 (after 02, 03) |
| 05 | **Conversion ingestion + commission ledger + audit** | apps/api /conversions HMAC webhook handler with idempotency. Commission row creation. State machine + nightly hold-promotion job. audit_log hash-chain. Admin reconciliation views. | W4 (after 04) |
| 06 | **fxl-financiero integration + payout CSV** | Cross-repo: fxl-financiero accepts ?ref + ?fxl_sig, persists click_id on checkout_attempts + org_attribution. Outbound webhook on first_paid_at. FXL Sales payout batch UI + CSV export. | W5 (after 05) |

**Cross-repo work (Phase 06):** outside this repo. The phase plan will include explicit instructions to clone/branch fxl-financiero, make changes there, type-check both repos, and call out the cross-repo nature in the audit + handoff. No automated commit to fxl-financiero — surface a diff for human review.

---

## 8. Test strategy (per FXL TDD methodology)

- **Logic-heavy units (commission calc, HMAC verify, idempotency, state machine):** TDD with Vitest. Tests in `apps/api/src/**/__tests__/*.test.ts`. Coverage gate on these files only.
- **Drizzle schema + RLS:** integration tests against the Docker Postgres in `apps/api/test/rls/*.test.ts`. Cross-tenant assertions on every tenant-scoped table — set context to org A, attempt to read org B's row, assert 0 rows. Run in CI on every PR.
- **API routes:** Hono test client + Supertest pattern.
- **Frontend:** smoke-level Playwright E2E for the finder happy path (signup → approval → log in → generate link → see commission appear after simulated webhook).
- **Cross-repo integration (Phase 06):** end-to-end manual test scripted in `docs/nexo/verify/06-financeiro-integration-uat.md`. Run fxl-financiero local + FXL Sales local + Docker Postgres for each, simulate full referral → checkout → commission flow.

---

## 9. Security checklist (from research)

- [x] `FORCE ROW LEVEL SECURITY` on every tenant table (Phase 01)
- [x] Per-transaction `set_config('app.current_org_id')` in Hono middleware (Phase 01)
- [x] Non-owner app role for runtime DB connection (Phase 01)
- [x] Composite indexes leading on `org_id` (Phase 01)
- [x] HMAC-SHA256 + timestamped signatures on inbound webhooks, raw-body verify, ≤300s replay window (Phase 05)
- [x] Per-app webhook secret, never shared (Phase 02)
- [x] Idempotency table with `UNIQUE(source, event_id)` (Phase 05)
- [x] Referral redirect: server-side code lookup, allowlist enforcement, two-axis rate limit (Phase 04)
- [x] HttpOnly+Secure+SameSite=Lax cookie for click bridge (Phase 04)
- [x] IP hashed before logging (Phase 04)
- [x] Append-only hash-chained audit ledger for money mutations (Phase 05)
- [x] Numeric money type (`int` cents in v1.0; can migrate to `NUMERIC(14,2)` later if international currencies appear) (Phase 01)
- [x] Clerk Restricted mode + no end-user org creation (Phase 01 — Clerk dashboard config call-out)
- [x] HttpOnly cookies for Clerk session (default); no localStorage tokens (Phase 03)
- [x] LGPD: `leads` table separable PII with anonymization-not-deletion path (Phase 05)
- [ ] Two-person approval CHECK constraint on high-value commission adjustments — **deferred to post-v1.0**
- [ ] Cloudflare Turnstile on /r/:code — **deferred to post-v1.0; basic Upstash Ratelimit instead**
- [ ] sa-east-1 production residency — **operations concern, called out in handoff**
- [ ] DSAR self-service workflow UI — **deferred to post-v1.0**

---

## 10. Open questions / explicitly accepted gaps

- **Multi-touch attribution audit log.** v1.0 records last-touch only; multi-touch retention is deferred. If a dispute requires multi-touch reconstruction, admin will have to query `clicks` directly. Accept.
- **Clawback semantics on refund > paid commission.** If a refund arrives after the commission was paid (`status='paid'`), v1.0 records a `commissions` row with negative amount and `status='reversed'`, leaving netting against the next payout to manual admin process. Documented in admin UI. Accept.
- **Currency.** v1.0 BRL-only; `int` cents throughout. Multi-currency deferred indefinitely.
- **Quoted vs realized price mismatch.** If customer pays a partial amount (e.g., installment that fails partway), `realized_setup_brl` differs from `quoted_setup_brl`. Commission is calculated on **realized** under `basis='quoted_net'` semantics — meaning even if basis is "quoted_net", realized takes precedence if it's lower. Rationale: never pay commission on revenue not actually collected. Documented in commission_rules description.
- **Finder org model.** Each finder = one Clerk org. A finder can NOT belong to multiple orgs in v1.0. If a real person wants to operate two finder identities, they create two Clerk accounts. Accept.

---

## 11. Handoff cues

After milestone completion, the handoff (per nexo:add-feature Phase 4 + handoff-template.md) must explicitly note:

1. The cross-repo change in fxl-financiero (Phase 06). Provide the diff path and the type-check verification log.
2. Operational TODOs: production sa-east-1 deploy, Clerk Restricted mode toggle, Cloudflare Turnstile setup, two-person approval rollout.
3. Sequence for v1.1 / v2.0: add gps-comercial integration, then aluga-flow, then finder commission rate tiers, then Asaas payouts, then DSAR UI.
4. Reset of `.planning/PROJECT.md` from `fxl-template` → `fxl-sales` (part of Phase 0 in this workflow, called out in handoff so future operators know the milestone history).
