---
phase: "06"
name: "fxl-financeiro integration + payout CSV export"
milestone: "v1.0 — FXL Finders MVP"
status: "planned"
wave: "W5"
depends_on: ["05"]
plan_count: 12
# NOTE (pre-execution reconciliation): T02 (payout_batches/payout_batch_items) is REMOVED per D-Q —
# Phase 05 already owns the single `payouts` table + payouts/service.ts + payouts/routes.ts.
# Phase 06 only ADDS listFindersWithLockedCommissions + generateCsv(payoutIds[]) to that service + admin UI.
# A new automated e2e contract test (T13) replaces the deleted task, keeping plan_count = 12 active tasks.
mode: standard
autonomous: true
requirements_addressed: ["REQ-payouts", "REQ-payout-csv", "REQ-fxl-financeiro-integration", "REQ-seed-data", "REQ-cross-repo-webhook-sender"]
---

# Phase 06 — fxl-financeiro integration + payout CSV export

**Milestone:** v1.0 — FXL Finders MVP
**Status:** ⏳ planned
**Wave:** W5 (depends on Phase 05)

---

## PREREQUISITE — `/gsd-ui-phase` REQUIRED BEFORE T09

> `/gsd-ui-phase 06` MUST be run before executing T09 (payout admin UI tasks T09–T10).
> The payout batch creation, CSV download, and mark-paid flows require a UI-SPEC to
> define layout, column order, and interaction patterns.
>
> **Command to run first (before T09):**
> ```
> /gsd-ui-phase 06
> ```
> After UI-SPEC is written (`.planning/phases/06-*/06-UI-SPEC.md`), proceed with T09.
>
> Tasks T01, T03–T08, T11–T13 (schema seed, backend service, TDD, automated e2e, cross-repo patch)
> do NOT require the UI-SPEC and can be executed in parallel with UI-SPEC generation. (T02 is REMOVED.)

---

## ⛔ CANONICAL SLUG CONTRACT (D-A — LOCKED, applies to EVERY task)

The app slug is **`fxl-financiero`** (…ci**e**ro — the SPEC spelling). It MUST be used **byte-identically** in:
- the seed migration `apps.slug` (T01)
- the webhook `source` field and `idempotency_key` input (T08, T13)
- `conversions.source` resolution and all test fixtures (T04, T13)
- the seed file NAME and migration journal entry

The phase **directory** name (`06-fxl-financeiro-integration-payout-csv`, …ce**i**ro) keeps its current spelling — cosmetic, exempt.

**Verify gate (run after T01 + T13, before phase sign-off):**
```bash
# Scope to Phase 06 deliverables only (exclude pre-existing template/handoff docs that name the
# sibling repo directory `1-fxl-financeiro`, and exclude the phase dir name itself):
grep -rn 'fxl-financeiro' \
  apps/api/drizzle/0006_fxl_financiero_seed.sql \
  apps/api/src/domains/payouts/ \
  apps/api/test/ \
  docs/nexo/cross-repo/06-financeiro-integration.patch \
  docs/nexo/verify/06-financeiro-integration-uat.md
# MUST return 0 matches. Any hit is a blocker — fix to `fxl-financiero` (…ciero).
```
The seed file is named `0006_fxl_financiero_seed.sql` (…ciero) — NOT `0006_fxl_financeiro_seed.sql`.

---

## CROSS-REPO GUARDRAIL (autopilot — enforce at every step)

Side B tasks (T06–T08) touch the sibling **fxl-financeiro** repo (on-disk directory `1-fxl-financeiro`; the in-code app SLUG/webhook source is the canonical `fxl-financiero` per D-A). The executor MUST:
1. Write changes to a branch in that repo: `git checkout -b feat/fxl-finders-integration`
2. **NEVER push** (`git push` or `git push --force`) the branch.
3. Output the full diff via `git diff main...feat/fxl-finders-integration` and paste into `docs/nexo/cross-repo/06-financeiro-integration.patch`.
4. Run `pnpm tsc --noEmit` in fxl-financiero `apps/api` to confirm no type errors.
5. Surface the patch path in the handoff section at the end of execution.

Violation of any of these points is a blocker — the autopilot logs the violation and stops Side B execution.

---

## Context sources (read before executing any task)

1. `.planning/plan-brief.md` — cascading decisions (READ FIRST — all waves)
2. `docs/superpowers/specs/2026-05-28-fxl-finders-v1-design.md` — canonical spec:
   - § 4 `payouts` schema + CSV columns
   - § 6 steps 7–15 referral flow (conversion → commission → payout)
   - § 11 cross-repo handoff checklist
3. `.planning/phases/05-conversion-ingestion-commission-ledger-audit/05-PLAN.md` — webhook
   body contract (T06 + phase D3 for HMAC raw-body pattern)
4. `CLAUDE.md` — FXL contract (non-negotiable)

**Pre-researched fxl-financiero facts (use these; do NOT open the sibling repo for research):**
- `org_attribution` table: `org_id` (PK), `indicated_by_user_id` (finder, nullable),
  `sold_by_user_id` (seller, nullable), `first_paid_at` (sale-close trigger), `attributed_at`,
  `attributed_by`. File: `apps/api/src/db/schema/org-attribution.ts`
- `checkout_attempts` table: `customer_name`, `customer_email`, `cpf_cnpj`, `phone`,
  `status`, `setup_amount_brl`, `monthly_amount_brl`, `installment_count`, `org_id` (nullable),
  `purpose`, `modules` (jsonb), `clerk_user_id`, asaas refs, card `last4`/`brand`.
  File: `apps/api/src/db/schema/checkout.ts`
- Checkout pages (Next.js, apps/site): `/precos` (`apps/site/src/app/precos/page.tsx`),
  `/checkout/credit-card` (`apps/site/src/app/checkout/credit-card/page.tsx`)
  — query params today: `intent`, `plan_id`, `installment_count`. NO `ref` param today.
- Commission accrual fires when admin sets `first_paid_at`. Partners domain:
  `apps/api/src/domains/partners/admin-routes.ts` + `service.ts`.
  Commission ledger: `apps/api/src/db/schema/commission-ledger.ts`

---

## Architecture decisions (autopilot — logged inline per `/nexo:autopilot`)

| # | Decision | Choice | Reason |
|---|---|---|---|
| D1 | Seed mechanism | SQL appended INTO the Drizzle-journaled migration `drizzle/0006_fxl_financiero_seed.sql` (registered in `_journal.json` — NOT a standalone unjournaled `.sql`, which the migrator skips, per D-F) so it runs via `drizzle-kit migrate` and is tracked in migration history. | Consistent with Phase 01–05 pattern + D-F journaling rule; ensures CI repeatability. |
| D2 | Price bands / commission rates | Setup: min=80000 / list=100000 / max=150000 cents. Monthly: min=8000 / list=10700 / max=20000 cents. Commission: setup_rate_pct=30.00, recurring_rate_pct=20.00, recurring_months=12. **price_bands columns are `min_brl` / `list_brl` / `max_brl`** (Phase 01 schema — NOT `min_amount_brl`). All marked `-- PLACEHOLDER: confirm with stakeholders`. | Derived from spec § 11; column names verified against schema.ts in T01 read_first. |
| D3 | `allowed_redirect_hosts` placeholder | `['fxlfinanceiro.com.br']` — executor MUST verify real host during integration test and update if different. Documented as placeholder. | Best-known hostname from context. |
| D4 | CSV encoding + HEADER CONTRACT (pinned) | UTF-8 BOM (`\xEF\xBB\xBF` prefix) so Excel PT-BR opens without encoding dialog. **Header row (byte-exact, this exact order, comma-separated, no trailing space):** `finder_name,cpf,pix_key,pix_key_type,amount_brl,commission_ids`. `amount_brl` formatted via `Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })` → e.g. `1.234,56` (thousands `.`, decimal `,`, NO currency symbol). `commission_ids` = comma-joined UUIDs wrapped in double quotes in the cell. This header contract is asserted byte-for-byte in T04 TDD. | Spec § 4 payout CSV contract; header pinned per NIT. |
| D5 | Payout service location | **REUSE Phase 05's `apps/api/src/domains/payouts/service.ts` + `routes.ts` + `payouts` table.** Phase 06 does NOT create a new payout domain and does NOT add `payout_batches`/`payout_batch_items` (T02 REMOVED per D-Q). Phase 06 ADDS two functions to the existing service: `listFindersWithLockedCommissions` + `generateCsv(payoutIds: string[])`, plus the admin batch UI. | D-Q: single payout design owned by Phase 05; Phase 06 consumes + extends. |
| D6 | Two-person approval | **DEFERRED to v1.1 entirely — no columns added in Phase 06.** The Phase 05 `payouts` table has no `approved_by_*` columns; do NOT add them (T02 is removed). UI shows no approval badge in v1.0. Document the v1.1 deferral in a code comment in `payouts/service.ts`. | Spec § 4 "two-person approval — deferred"; D-Q removes the batch table that held those columns. |
| D7 | HMAC inline in fxl-financiero | ~15-line inline HMAC in `apps/api/src/lib/fxl-finders-webhook.ts` within fxl-financiero. MUST byte-match Phase 05 `verifyHmac`: `hmac = createHmac('sha256', secret).update(t + "." + rawBody).digest('hex')`; header `X-FXL-Signature: t=<unix_ts>,v1=<hmac>`. Sign and verify operate over the IDENTICAL raw byte string — never re-serialize between sign→send. Cannot import `@fxl-finders/shared-utils` cross-repo. Includes comment: `// MUST byte-match FXL Finders packages/shared-utils/src/hmac.ts verifyHmac()`. | Cross-repo isolation constraint + D-O invariant. |
| D8 | Retry strategy | Exponential backoff: 3 retries, delays 1s / 2s / 4s. On final failure: log error (`console.error`) for ops visibility. Do NOT throw — sale flow must not be blocked. (No new `webhook_send_failures` table in v1.0 — ops reads logs; a table is a v1.1 enhancement.) | Non-blocking fire-and-forget with ops observability. |
| D9 | `idempotency_key` computation | `createHash('sha256').update(source + external_order_id + event_type).digest('hex')` (plain SHA-256, NOT HMAC) where `source='fxl-financiero'`, `external_order_id=org_attribution.org_id`, `event_type='sale'`. Byte-identical to Phase 05 `buildIdempotencyKey`. | D-N (LOCKED) + spec § 6 step 10. |
| D10 | `finder_code` in webhook body | `referral_links.code` resolved from `click_id` stored in `checkout_attempts.click_id`. Optional — if `click_id` is NULL the field is sent as `null`. Phase 05 resolves attribution by `click_id` first, then falls back to `finder_code`, else throws `attribution_not_found` (4xx so financeiro retries/alerts). | D-M attribution fallback. |
| D11 | `fxl_sig` referral signature handling | financeiro PERSISTS `click_id` + `fxl_sig` on `checkout_attempts` (T06/T07). **VERIFICATION of `fxl_sig` is DEFERRED to a later version — store both raw, do NOT validate on the financeiro side in v1.0.** Pinned formula for when verification is added (per D-P): `fxl_sig = hmac(click_id + "." + link.signature, app.webhook_signing_secret)`. | D-P: reduces cross-repo coupling; store-only in v1.0. |

---

## Hard constraints (non-negotiable)

- **No push to fxl-financiero**: Executor writes branch + patch + diff only. NEVER runs `git push`.
- **CSV UTF-8 BOM**: Missing BOM breaks Excel PT-BR — tested in T05 TDD.
- **HMAC byte-match**: Phase 06 sign and Phase 05 verify MUST produce identical MACs for same input. Covered by TDD (T04).
- **`/gsd-ui-phase 06` before T09**: Do not start payout UI without UI-SPEC.
- **Seed is idempotent**: All seed INSERT statements use `ON CONFLICT DO NOTHING` or `ON CONFLICT (...) DO UPDATE` — safe to re-run.
- **No `setTenantContext` in payout admin routes**: Payouts are admin-managed cross-tenant — admin reads/mutations use `getAdminDb()` (BYPASSRLS, D-C from Phase 05). Never `setTenantContext` on admin routes.
- **i18n PT-BR**: Every user-facing string in T09–T10 uses `useTranslation()`. No hardcoded Portuguese in JSX.
- **Canonical slug `fxl-financiero`** (D-A): byte-identical in seed, webhook `source`, fixtures. The verify gate (top of plan) MUST return 0 matches for `fxl-financeiro` (…ceiro) in Phase 06 deliverables.
- **Single payout design (D-Q)**: NO `payout_batches`/`payout_batch_items` tables, NO `in_payout` status, NO `payout_batch_id` column. Phase 06 consumes the Phase 05 `payouts` table (`commissions.paid_payout_id` FK, `locked→paid`).
- **`idempotency_key = createHash('sha256')`** (D-N): NEVER `createHmac`. Byte-match Phase 05 `buildIdempotencyKey` (TDD in T04).
- **HMAC verify import is `verifyHmac`** (D-O): the export named `verify` does NOT exist. Payload = `ts + '.' + rawBody`; header parsed as `t=<ts>,v1=<hex>`.
- **Frontend API calls use `apiFetch(path, { method, token, body })`** (D-J): pass `useAuth().getToken()` into every authed call. No bare `fetch('/api/...')`, no `apiClient.get`.
- **Finders missing `cpf`/`pix_key` are excluded/flagged** (D-Q): `listFindersWithLockedCommissions` returns a clear flag; `createPayoutBatch` rejects with a typed error — NEVER a NOT NULL DB crash.

---

## Plan summary (12 active tasks across 4 waves; T02 REMOVED per D-Q, T13 added)

| Task | Wave | Type | Objective |
|---|---|---|---|
| T01 | W1 | execute | Seed migration — `apps`, `products`, `price_bands`, `commission_rules` rows for `fxl-financiero` (all NOT NULL cols supplied) |
| ~~T02~~ | — | REMOVED | ~~`payout_batches` + `payout_batch_items`~~ — **DELETED per D-Q.** Phase 05 owns the single `payouts` table; no batch tables. |
| T03 | W2 | execute | EXTEND Phase 05 `payouts/service.ts` — add `listFindersWithLockedCommissions` + `generateCsv(payoutIds[])` (reserve via `paid_payout_id`; `locked→paid` on mark-paid) |
| T04 | W2 | execute | TDD — CSV gen (BOM + pinned header) + HMAC sign byte-match (`verifyHmac`) + `idempotency_key` byte-match vs `buildIdempotencyKey` |
| T05 | W2 | execute | EXTEND Phase 05 `payouts/routes.ts` — add `GET .../finders-ready`, `POST .../batches`, `GET .../csv` (admin, `getAdminDb()`) |
| T06 | W3 | cross-repo | Side B: fxl-financiero schema — add `click_id` + `fxl_sig` to `checkout_attempts`; `click_id` to `org_attribution` |
| T07 | W3 | cross-repo | Side B: fxl-financiero checkout pages — accept `?ref` + `?fxl_sig`; persist (store-only, no verify); thread to `checkout_attempts` |
| T08 | W3 | cross-repo | Side B: fxl-financiero webhook sender — `lib/fxl-finders-webhook.ts` (D-M body, D-N idempotency, D-O HMAC) + trigger on `first_paid_at` |
| T09 | W4 | execute | `apps/web` admin payout UI — finder list with locked commissions + create batch (excludes/flags missing cpf/pix) |
| T10 | W4 | execute | `apps/web` admin payout UI — payout list, download CSV, mark paid |
| T11 | W4 | execute | Cross-repo patch export + type-check gate (branch `feat/fxl-finders-integration`, never push) |
| T12 | W4 | execute | Manual E2E UAT doc + type-check + lint gate + D-A slug verify gate |
| T13 | W2 | execute | **Automated e2e** — Hono test client posts exact T08 body w/ valid sig → 200 accepted + conversion + commission rows; replay → 200 duplicate (no dup rows) |

---

## Tasks

---

### T01 · Seed migration — fxl-financiero app + product + price bands + commission rules

**Plan:** `06-P01` — Wave 1
**Type:** execute

<read_first>
- **FIRST: grep the ACTUAL column identifiers in `apps/api/src/db/schema.ts` before writing any seed SQL** — do NOT trust the column names quoted below; confirm them:
  ```bash
  grep -nE "pgTable\\(|: (text|integer|numeric|boolean|timestamp|uuid)\\(|\\.notNull\\(\\)" apps/api/src/db/schema.ts | sed -n '1,200p'
  # specifically confirm the snake_case DB names for: apps (publishable_key, secret_key_hash,
  # secret_key_prefix, status, created_by_user_id, webhook_signing_secret, allowed_redirect_hosts,
  # attribution_window_days, commission_hold_days), products (slug, status), price_bands
  # (component + the THREE amount columns), commission_rules (setup_rate_pct, recurring_rate_pct, recurring_months).
  ```
  **price_bands amount columns are `min_brl` / `list_brl` / `max_brl`** (Phase 01 schema), NOT `min_amount_brl`/`list_amount_brl`/`max_amount_brl`. Use whatever the grep confirms; the names below assume Phase 01's `*_brl` form.
- `apps/api/drizzle/` directory — latest journaled migration number + the `_journal.json` entries to determine next sequence (e.g., `0005_...` → this becomes `0006_...`). Per D-F, the seed SQL is APPENDED into the journaled migration, not a standalone unjournaled `.sql`.
- `.planning/plan-brief.md` Wave 0 + D-A — attribution_window_days=30, commission_hold_days=30, canonical slug `fxl-financiero`.
- D2 + D3 above — price band values and allowed_redirect_hosts placeholder.
</read_first>

<action>
Create the journaled migration `apps/api/drizzle/0006_fxl_financiero_seed.sql` (file name uses `…financiero`, …ci**e**ro — see D-A) and **register it in `apps/api/drizzle/meta/_journal.json`** (D-F — an unjournaled standalone `.sql` is skipped by the migrator). Idempotent seed (use `ON CONFLICT DO NOTHING` on all inserts).

**`apps` supplies EVERY NOT NULL column** (the seed crashes otherwise — the row must satisfy `publishable_key`, `secret_key_hash`, `secret_key_prefix`, `status`, `created_by_user_id`, plus the webhook signing secret). Confirm the exact column names via the read_first grep first.

1. Insert into `apps`:
   ```sql
   -- PLACEHOLDER: canonical slug per D-A is 'fxl-financiero' (…ciero) — used byte-identically as webhook source
   INSERT INTO apps (
     id, slug, name,
     publishable_key, secret_key_hash, secret_key_prefix,
     webhook_signing_secret,
     status, created_by_user_id,
     attribution_window_days, commission_hold_days, allowed_redirect_hosts,
     created_at
   )
   VALUES (
     gen_random_uuid(),
     'fxl-financiero',                      -- D-A canonical slug (…ciero)
     'FXL Financeiro',
     'pk_fxlfin_seed_placeholder',          -- PLACEHOLDER publishable key (real key minted via apps admin UI)
     -- secret_key_hash: sha256 of a known-discarded seed secret (rotated immediately via admin UI)
     encode(digest('sk_fxlfin_seed_placeholder', 'sha256'), 'hex'),
     'sk_fxlfin',                           -- secret_key_prefix (first chars of the sk_ key)
     -- webhook_signing_secret: a REAL generated 32-byte hex secret (NOT a literal placeholder string).
     -- Generated at seed-author time, rotated post-migration via admin UI before go-live.
     encode(gen_random_bytes(32), 'hex'),
     'active',                              -- status MUST be 'active' (conversions resolve `WHERE status='active'`)
     'system',                              -- created_by_user_id
     30,
     30,
     ARRAY['fxlfinanceiro.com.br'],         -- PLACEHOLDER: confirm real hostname (D3)
     now()
   )
   ON CONFLICT (slug) DO NOTHING;
   ```
   > NOTE: `gen_random_bytes`/`digest` require the `pgcrypto` extension. Confirm Phase 01 enabled it; if not, add `CREATE EXTENSION IF NOT EXISTS pgcrypto;` at the top of this migration. (If schema uses `crypto.randomUUID()` defaults only, pgcrypto may already be present via `gen_random_uuid`, which is core in PG13+ — `gen_random_bytes` still needs pgcrypto.)

2. Insert into `products` (reference the app by slug subquery) — **`status='active'`**:
   ```sql
   INSERT INTO products (id, app_id, name, slug, status, created_at)
   SELECT gen_random_uuid(), a.id, 'FXL Financeiro Core', 'fxl-financiero-core', 'active', now()
   FROM apps a WHERE a.slug = 'fxl-financiero'
   ON CONFLICT (app_id, slug) DO NOTHING;
   ```

3. Insert into `price_bands` (setup + monthly) — columns `min_brl` / `list_brl` / `max_brl` (confirm via read_first grep):
   ```sql
   -- PLACEHOLDER: all amounts in cents BRL — confirm with stakeholders before go-live
   -- Setup component: min=R$800, list=R$1000, max=R$1500
   INSERT INTO price_bands (id, product_id, component, min_brl, list_brl, max_brl, created_at)
   SELECT gen_random_uuid(), p.id, 'setup', 80000, 100000, 150000, now()
   FROM products p JOIN apps a ON p.app_id = a.id
   WHERE a.slug = 'fxl-financiero' AND p.slug = 'fxl-financiero-core'
   ON CONFLICT (product_id, component) DO NOTHING;

   -- Monthly component: min=R$80, list=R$107, max=R$200
   INSERT INTO price_bands (id, product_id, component, min_brl, list_brl, max_brl, created_at)
   SELECT gen_random_uuid(), p.id, 'monthly', 8000, 10700, 20000, now()
   FROM products p JOIN apps a ON p.app_id = a.id
   WHERE a.slug = 'fxl-financiero' AND p.slug = 'fxl-financiero-core'
   ON CONFLICT (product_id, component) DO NOTHING;
   ```

4. Insert into `commission_rules`:
   ```sql
   -- PLACEHOLDER: rates are sane defaults — confirm with stakeholders
   -- setup_rate_pct=30% (one-time), recurring_rate_pct=20% (monthly), recurring_months=12
   INSERT INTO commission_rules (id, product_id, setup_rate_pct, recurring_rate_pct, recurring_months, created_at)
   SELECT gen_random_uuid(), p.id, 30.00, 20.00, 12, now()
   FROM products p JOIN apps a ON p.app_id = a.id
   WHERE a.slug = 'fxl-financiero' AND p.slug = 'fxl-financiero-core'
   ON CONFLICT (product_id) DO NOTHING;
   ```

Confirm `apps/api/drizzle/meta/_journal.json` has the `0006_fxl_financiero_seed.sql` entry so `drizzle-kit migrate` runs it (D-F).
</action>

<acceptance_criteria>
- `pnpm drizzle-kit migrate` completes without error on a fresh DB AND on a DB where the seed already ran (idempotency) — and crucially does NOT fail on a NOT NULL violation (all NOT NULL `apps` columns are supplied).
- The migration is registered in `_journal.json` (D-F) — verified by `SELECT slug FROM apps WHERE slug='fxl-financiero'` returning 1 row AFTER `pnpm db:migrate` on a fresh DB (proves the journaled file actually ran).
- `SELECT slug FROM apps WHERE slug='fxl-financiero'` returns exactly 1 row; `status='active'`.
- `SELECT status FROM products WHERE slug='fxl-financiero-core'` returns `active`.
- `SELECT component, min_brl, list_brl, max_brl FROM price_bands pb JOIN products p ON pb.product_id=p.id JOIN apps a ON p.app_id=a.id WHERE a.slug='fxl-financiero'` returns rows for both `setup` and `monthly` with the seeded amounts.
- `SELECT setup_rate_pct FROM commission_rules cr JOIN products p ON cr.product_id=p.id JOIN apps a ON p.app_id=a.id WHERE a.slug='fxl-financiero'` returns `30.00`.
- `webhook_signing_secret` is a real generated hex value (NOT the literal string `REPLACE_WITH_GENERATED_SECRET`); rotation-after-migration noted in a comment.
- D-A verify gate: `grep -rn 'fxl-financeiro' apps/api/drizzle/0006_fxl_financiero_seed.sql` returns 0 matches.
- All PLACEHOLDER comments are present in the SQL file.
</acceptance_criteria>

---

### ~~T02 · `payout_batches` + `payout_batch_items` Drizzle schema~~ — REMOVED (D-Q)

**Status:** ❌ REMOVED per LOCKED decision **D-Q**. Do NOT execute. Do NOT add these tables.

**Rationale:** Phase 05 already ships the canonical, single `payouts` table (per-finder payout row:
`id, finder_id, total_brl, status['draft'|'exported'|'paid'|'voided'], csv_export_id, exported_at,
paid_at, paid_by_user_id, note`) plus `commissions.paid_payout_id uuid FK -> payouts(id)` and the
`locked → paid` transition. There is NO multi-finder "batch" table, NO `in_payout` commission status,
and NO `payout_batch_id` column anywhere. Introducing `payout_batches`/`payout_batch_items` would
create a second, conflicting payout design.

**What Phase 06 does instead:** T03 EXTENDS the existing Phase 05 `payouts/service.ts` with
`listFindersWithLockedCommissions` + `generateCsv(payoutIds[])`; the "batch" UX (T09) creates one
`payouts` row per selected finder in a single transaction and groups them in the UI. The CSV export
(T10) aggregates multiple per-finder `payouts` rows into one file.

(Task number T02 is intentionally retired; the replacement automated e2e contract test is **T13**,
keeping 12 active tasks.)

---

### T03 · EXTEND Phase 05 `payouts/service.ts` — `listFindersWithLockedCommissions` + `generateCsv(payoutIds[])`

**Plan:** `06-P03` — Wave 2
**Type:** execute

> **D-Q:** This task does NOT create a new payout domain or any batch tables. It ADDS two functions
> to the EXISTING `apps/api/src/domains/payouts/service.ts` shipped in Phase 05 (which already exports
> `createPayoutBatch`, `markPayoutPaid`, `getPayoutsAdmin`, `getPayoutsByFinder`). Reuse the Phase 05
> `payouts` table + `commissions.paid_payout_id` FK + `locked→paid` transition. NO `in_payout` status,
> NO `payout_batch_id` column.

<read_first>
- `apps/api/src/domains/payouts/service.ts` (Phase 05) — existing exports + the `CreatePayoutSchema`/`MarkPaidSchema`, `createPayoutBatch`, `markPayoutPaid` signatures. Do NOT duplicate them; extend the file.
- `apps/api/src/db/schema.ts` — `payouts` (`id, finder_id, total_brl, status, csv_export_id, exported_at, paid_at, paid_by_user_id, note`), `commissions` (`finder_id, status, amount_brl, paid_payout_id`), `finders` (confirm the real `cpf` / `pix_key` / `pix_key_type` column identifiers — grep before coding).
- `apps/api/src/db/client.ts` — `getAdminDb()` (BYPASSRLS, per D-C). Admin payout reads/mutations use `getAdminDb()`, NOT `setTenantContext`.
- `apps/api/src/domains/audit/service.ts` (Phase 05) — `writeAuditEntry` signature.
- `.planning/plan-brief.md` D-C, D-Q — payouts admin uses BYPASSRLS conn; single payout design.
- D4 above — CSV format (UTF-8 BOM, PINNED header row, BRL `pt-BR` number formatting).
</read_first>

<action>
**1. Add `listFindersWithLockedCommissions` to the existing `payouts/service.ts`:**

```typescript
// All types inferred from Drizzle schema — no `any`.
export interface FinderCommissionSummary {
  finderId: string
  finderName: string
  cpf: string | null
  pixKey: string | null
  pixKeyType: string | null
  totalBrl: number              // sum of locked, not-yet-paid commission amount_brl
  commissionIds: string[]
  payable: boolean              // false when cpf OR pix_key is missing
  blockedReason: string | null  // e.g. 'missing_cpf' | 'missing_pix_key' when not payable
}

export async function listFindersWithLockedCommissions(): Promise<FinderCommissionSummary[]>
// Runs on getAdminDb() (BYPASSRLS) — no setTenantContext.
// SELECT commissions WHERE status='locked' AND paid_payout_id IS NULL  (reserve = paid_payout_id set)
//   JOIN finders, GROUP BY finder_id, SUM(amount_brl), array_agg(commission id).
// Compute payable = (finder.cpf != null && finder.cpf != '' && finder.pix_key != null && finder.pix_key != '').
// Finders missing cpf/pix_key are RETURNED with payable=false + blockedReason — they are NOT silently
// dropped and MUST NOT cause a NOT NULL crash anywhere downstream (D-Q).
```

**2. Reconcile the existing `createPayoutBatch` reserve semantics (D-Q) — confirm/patch in this file:**
   - `createPayoutBatch(finderId, commissionIds, actorUserId)` (Phase 05 signature, per-finder) MUST:
     1. Reject if the finder is not `payable` (missing cpf/pix_key) — throw a typed `Error('finder_not_payable')` (caught by the route → 422), NEVER insert a row that violates NOT NULL.
     2. Fetch the named `commissionIds` WHERE `status='locked'` AND `finder_id=$finderId` AND `paid_payout_id IS NULL` — throw `Error('commissions_not_locked')` if any are not eligible.
     3. INSERT one `payouts` row (`status='draft'`, `total_brl = SUM`).
     4. **RESERVE** the commissions: `UPDATE commissions SET paid_payout_id = $payout.id WHERE id IN (...)` — they STAY `status='locked'` (NOT `in_payout`, NOT `paid`). The `locked→paid` flip happens only in `markPayoutPaid`.
     5. `writeAuditEntry` for the reservation.
     - All in one transaction on `getAdminDb()`.
   - `markPayoutPaid(payoutId, actorUserId, note?)` MUST flip `payouts.status='paid'` AND `UPDATE commissions SET status='paid', paid_at=now() WHERE paid_payout_id=$payoutId AND status='locked'` (the `locked→paid` transition). `writeAuditEntry(action='payout.mark_paid', actor_user_id=actorUserId)`.
   > If Phase 05 already implemented step 4 as `status='paid'` at creation time, FIX it here to the reserve-then-pay semantics above (D-Q is authoritative over any conflicting Phase 05 text).

**3. Add `generateCsv(payoutIds: string[])` to the existing `payouts/service.ts`:**

```typescript
export async function generateCsv(payoutIds: string[]): Promise<Buffer>
// Runs on getAdminDb(). Fetches the named payouts + their reserved commissions + finder snapshot
// (finder_name, cpf, pix_key, pix_key_type) — ONE row per payout (i.e. per finder).
// Returns a UTF-8 BOM Buffer (\xEF\xBB\xBF prefix).
// Header row (BYTE-EXACT, D4): finder_name,cpf,pix_key,pix_key_type,amount_brl,commission_ids
// amount_brl: Intl.NumberFormat('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2}) of (total_brl/100) → "1.234,56"
// commission_ids: comma-joined UUIDs, double-quoted in the cell.
// Empty payoutIds → BOM + header row only (no data rows).
```

Zod schema `GenerateCsvSchema = { payoutIds: z.array(z.string().uuid()).min(0) }`. No `any`. Import `writeAuditEntry` from `apps/api/src/domains/audit/service.ts`.
</action>

<acceptance_criteria>
- `pnpm tsc --noEmit` passes; no `any`.
- `listFindersWithLockedCommissions` returns finders with `payable=false` + `blockedReason` when `cpf` or `pix_key` is null/empty — it does NOT throw and does NOT crash on missing values.
- `createPayoutBatch` reserves via `paid_payout_id` and leaves commissions in `status='locked'` (asserted: after creation, the commission rows still read `status='locked'` with `paid_payout_id` set; there is NO `in_payout` value and NO `payout_batch_id` column referenced anywhere).
- `createPayoutBatch` throws `finder_not_payable` (no DB write) when the finder lacks cpf/pix_key.
- `markPayoutPaid` flips `payouts.status='paid'` AND the reserved commissions `locked→paid` in one transaction, and writes an audit entry with `actor_user_id` = admin Clerk user ID.
- `generateCsv` buffer starts with `\xEF\xBB\xBF` and the first text line is exactly `finder_name,cpf,pix_key,pix_key_type,amount_brl,commission_ids`.
- Grep assertion: `grep -rn "in_payout\|payout_batch_id\|payoutBatches\|payoutBatchItems" apps/api/src` returns 0 matches.
- No `setTenantContext` in the payouts service (admin uses `getAdminDb()`); grep proves it.
</acceptance_criteria>

---

### T04 · TDD — CSV generation + HMAC sign byte-match (`verifyHmac`) + idempotency_key byte-match

**Plan:** `06-P04` — Wave 2
**Type:** execute

<read_first>
- `packages/shared-utils/src/hmac.ts` — Phase 04 HMAC exports. **The verify export is named `verifyHmac(secret, payload, sig): boolean`** (NOT `verify` — that name does not exist, D-O). Confirm the exact signature via grep before writing the test.
- `apps/api/src/domains/conversions/service.ts` — Phase 05 `buildIdempotencyKey(source, externalOrderId, eventType): string` = `createHash('sha256').update(source + externalOrderId + eventType).digest('hex')`.
- `apps/api/test/` — existing test file patterns (vitest, unit project).
- D4 above — CSV format spec (PINNED header row).
- D7 + D-O above — HMAC sign formula: `hmac = createHmac('sha256', secret).update(t + "." + rawBody).digest('hex')`; header `t=<ts>,v1=<hex>`.
- D9 + D-N above — `idempotency_key` is plain SHA-256, NOT HMAC.
</read_first>

<action>
Create three test files in the vitest unit project:

**`apps/api/test/unit/payouts/csv-gen.test.ts`**
Tests for `generateCsv(payoutIds[])`:
1. Buffer starts with UTF-8 BOM bytes `[0xEF, 0xBB, 0xBF]`.
2. The first text line equals **byte-exactly** `finder_name,cpf,pix_key,pix_key_type,amount_brl,commission_ids` (assert the FULL header row string, not a substring).
3. `amount_brl` from a 123456-cent payout renders as `1.234,56`.
4. `amount_brl` from a 1000-cent payout renders as `10,00`.
5. `commission_ids` array is joined and double-quoted in the cell.
6. Empty `payoutIds` → BOM + header row only (no data rows).

**`apps/api/test/unit/payouts/hmac-sign.test.ts`**
HMAC byte-match between Phase 05 `verifyHmac` and the Phase 06 (fxl-financiero) inline sign:
1. Import **`verifyHmac`** from `packages/shared-utils/src/hmac.ts` (NOT `verify`).
2. Implement the exact inline formula that goes in fxl-financiero T08:
   `const ts = '1700000000'; const hmac = createHmac('sha256', secret).update(ts + '.' + rawBody).digest('hex'); const header = 'v1=' + hmac;` — and build `payload = ts + '.' + rawBody` for the verify call.
3. Parse the header `t=<ts>,v1=<hex>` the SAME way the Phase 05 middleware does, then assert `verifyHmac(secret, payload, sig)` returns `true` (sign and verify operate over the IDENTICAL raw string — no re-serialization between them).
4. Assert `verifyHmac(wrongSecret, payload, sig)` returns `false`.
5. Assert `verifyHmac(secret, differentPayload, sig)` returns `false`.
6. Non-ASCII body content (UTF-8 chars in `customer_name`, e.g. "José Antônio Açaí") still byte-matches — the bytes are identical on both sides.

**`apps/api/test/unit/payouts/idempotency-key.test.ts`**
`idempotency_key` byte-match vs Phase 05 (D-N):
1. Import `buildIdempotencyKey` from `apps/api/src/domains/conversions/service.ts`.
2. Implement the fxl-financiero inline form: `createHash('sha256').update(source + externalOrderId + eventType).digest('hex')` with `source='fxl-financiero'`, `externalOrderId='org_abc'`, `eventType='sale'`.
3. Assert it equals `buildIdempotencyKey('fxl-financiero','org_abc','sale')` BYTE-FOR-BYTE.
4. Assert the result is a 64-char lowercase hex string.
5. Negative: a `createHmac('sha256', '')...` value must NOT equal the SHA-256 value (guards against the deleted HMAC mistake).

All tests use deterministic fixtures — no random values, fixed `ts`.
</action>

<acceptance_criteria>
- `pnpm vitest run --project=unit` passes all new tests.
- Zero TypeScript errors.
- The HMAC test imports **`verifyHmac`** from shared-utils (grep the test file: it references `verifyHmac`, never `verify(`).
- The idempotency test asserts byte-equality with Phase 05 `buildIdempotencyKey` and includes the negative HMAC guard.
- CSV test asserts the FULL pinned header row byte-for-byte.
- Test names are in PT-BR or English (consistent within each file).
</acceptance_criteria>

---

### T05 · EXTEND Phase 05 `payouts/routes.ts` — add finders-ready + batch-create + CSV admin endpoints

**Plan:** `06-P05` — Wave 2
**Type:** execute

> **D-Q / D-B / D-C:** Extend the EXISTING Phase 05 `apps/api/src/domains/payouts/routes.ts`
> (which already has `GET /admin`, `POST /admin`, `POST /admin/:payoutId/mark-paid`, `GET /` finder).
> Add the three new admin endpoints below. Reuse the ONE admin guard `requireAdmin`
> (`c.get('userRole') === 'admin'`) and `getAdminDb()` — do NOT add a second auth mechanism.

<read_first>
- `apps/api/src/domains/payouts/routes.ts` (Phase 05) — existing router + how it mounts; reuse `payoutsRouter`.
- `apps/api/src/domains/payouts/service.ts` (T03) — `listFindersWithLockedCommissions`, `generateCsv(payoutIds[])`, `createPayoutBatch`, `markPayoutPaid` signatures.
- `apps/api/src/middleware/auth.ts` (Phase 01) — `clerkAuthMiddleware` sets `c.get('userRole')` from JWT `publicMetadata.role` (D-B). NEVER call `clerkClient.users.getUser()` in a request path.
- `apps/api/src/middleware/require-admin.ts` (Phase 01/02, D-B) — the ONE `requireAdmin` guard reading `c.get('userRole') === 'admin'`. Reuse it; do NOT recreate an `adminAuth`/`isAdmin`.
- `apps/api/src/db/client.ts` — `getAdminDb()` (BYPASSRLS, D-C).
- `apps/api/src/server.ts` — where domain routers are mounted (NOT `index.ts`, per D-R mount note).
</read_first>

<action>
Add to the existing `payoutsRouter` in `apps/api/src/domains/payouts/routes.ts`. All new routes are guarded by `clerkAuthMiddleware` + `requireAdmin` and use `getAdminDb()` (no `setTenantContext`):

```
GET    /api/v1/admin/payouts/finders-ready
  → listFindersWithLockedCommissions()   // includes payable=false rows with blockedReason
  → 200 { finders: FinderCommissionSummary[] }

POST   /api/v1/admin/payouts/batches
  body: { finderIds: string[] }          // creates ONE payouts row per finder, in a single tx loop
  → for each finderId: resolve its locked commissionIds → createPayoutBatch(finderId, ids, adminUserId)
  → 422 { error: 'finder_not_payable', finderId } if any selected finder lacks cpf/pix_key (D-Q)
  → 201 { payouts: PayoutRow[] }

GET    /api/v1/admin/payouts/batches/:id/csv   // :id may be a comma-separated list of payout ids, or a single id
  → generateCsv(payoutIds)
  Response: Content-Type: text/csv; charset=utf-8
  Content-Disposition: attachment; filename="payout-<firstId>.csv"
  Body: generateCsv() Buffer (UTF-8 BOM)
```

Reuse the EXISTING Phase 05 admin endpoints for listing (`GET /admin`) and mark-paid (`POST /admin/:payoutId/mark-paid`) — do NOT duplicate them. Zod-validate `{ finderIds: z.array(z.string().uuid()).min(1) }`. Ensure the router is mounted in `apps/api/src/server.ts`.
</action>

<acceptance_criteria>
- `pnpm tsc --noEmit` passes.
- The three new endpoints return correct status codes on happy path; `POST .../batches` returns 422 with `finder_not_payable` when a selected finder lacks cpf/pix_key.
- `requireAdmin` (the single D-B guard) rejects non-admin with 403; NO `clerkClient.users.getUser()` in the request path (grep proves it).
- All new admin handlers use `getAdminDb()`; NO `setTenantContext` on any payout admin route (grep proves it).
- CSV endpoint sets `Content-Type: text/csv; charset=utf-8` and `Content-Disposition: attachment; filename=...`.
- No hardcoded org_id filtering; no `payout_batches`/`payout_batch_id` references.
</acceptance_criteria>

---

### T06 · Side B: fxl-financiero schema — `click_id` + `fxl_sig` + `org_attribution.click_id`

**Plan:** `06-P06` — Wave 3
**Type:** cross-repo
**CROSS-REPO GUARDRAIL APPLIES** — see top of plan. Branch only, no push.

<read_first>
Pre-researched facts (do NOT open fxl-financiero for discovery — use these):
- `checkout_attempts` file: `apps/api/src/db/schema/checkout.ts`
- `org_attribution` file: `apps/api/src/db/schema/org-attribution.ts`
- Both are Drizzle schema files in the fxl-financiero monorepo
</read_first>

<action>
In fxl-financiero repo on branch `feat/fxl-finders-integration`:

1. `apps/api/src/db/schema/checkout.ts` — add two nullable columns to `checkoutAttempts`. Per D-P, financeiro PERSISTS both raw but does NOT verify `fxl_sig` in v1.0 (store-only):
   ```typescript
   clickId: text('click_id'),   // FXL Finders click ULID (last-touch) — persisted for attribution
   fxlSig: text('fxl_sig'),     // raw ?fxl_sig HMAC from the referral redirect — STORED ONLY (verification deferred per D-P)
   ```

2. `apps/api/src/db/schema/org-attribution.ts` — add one nullable column to `orgAttribution`:
   ```typescript
   clickId: text('click_id'),   // propagated from checkout_attempts at attribution time
   ```

3. Generate Drizzle migration (use fxl-financiero's actual filter/scope — confirm its workspace name):
   `pnpm drizzle-kit generate` in fxl-financiero `apps/api`.

4. Add env vars to `.env.example` (fxl-financiero root):
   ```
   # FXL Finders webhook integration
   FXL_FINDERS_API_URL=https://api.fxlfinders.com.br  # PLACEHOLDER — set real URL before staging deploy
   FXL_FINDERS_WEBHOOK_SECRET=                         # generate in FXL Finders admin; MUST equal apps.webhook_signing_secret for slug 'fxl-financiero'
   ```
</action>

<acceptance_criteria>
- All Side-B work is on branch `feat/fxl-finders-integration` in the fxl-financiero repo; NEVER pushed.
- `pnpm tsc --noEmit` in fxl-financiero `apps/api` passes.
- Migration file generated without errors.
- Both schema files have the new nullable columns: `click_id` (both) + `fxl_sig` (checkout). Drizzle `text()` type.
- A code comment on `fxl_sig` documents "store-only, verification deferred per D-P".
- `.env.example` updated with both new env vars + PLACEHOLDER comments.
</acceptance_criteria>

---

### T07 · Side B: fxl-financiero checkout pages — accept `?ref` + `?fxl_sig`

**Plan:** `06-P07` — Wave 3
**Type:** cross-repo
**CROSS-REPO GUARDRAIL APPLIES** — branch only, no push.

<read_first>
Pre-researched facts:
- `/precos` page: `apps/site/src/app/precos/page.tsx` — current query params: `intent`, `plan_id`, `installment_count`
- `/checkout/credit-card` page: `apps/site/src/app/checkout/credit-card/page.tsx` — same params
- Both are Next.js App Router pages (async components) in the fxl-financiero apps/site
</read_first>

<action>
In fxl-financiero on branch `feat/fxl-finders-integration`:

1. `apps/site/src/app/precos/page.tsx`:
   - Accept `searchParams.ref` (FXL click_id ULID) and `searchParams.fxl_sig` (referral HMAC)
   - If present, pass them as hidden fields / URL params to the checkout flow
   - Store in a cookie `fxl_ref` with attributes (per D-R): **`HttpOnly=true`, `Secure`, `SameSite=Lax`, 90-day TTL** (the click_id is already in the URL, so client JS does NOT need to read the cookie — keep it HttpOnly). Store the raw `fxl_sig` alongside (e.g. a sibling `fxl_sig` cookie or as a second value) for threading into the checkout_attempts row.

2. `apps/site/src/app/checkout/credit-card/page.tsx`:
   - Read `ref` + `fxl_sig` from query params OR fallback to the `fxl_ref` cookie
   - Thread both values into the form submission payload (the Server Action / API call that creates the `checkout_attempts` row)

3. Update the checkout_attempts INSERT (wherever it lives — likely a Server Action or Route Handler) to set `click_id` and **`fxl_sig`** from the resolved values.

Implementation note (D-P): do NOT validate the `fxl_sig` HMAC on the checkout side in v1.0 — FXL Finders defers `fxl_sig` verification. Store the raw values only (audit / future verification). Add an inline code comment stating this.
</action>

<acceptance_criteria>
- All work on branch `feat/fxl-finders-integration`; never pushed.
- `pnpm tsc --noEmit` in fxl-financiero `apps/site` passes.
- Visiting `/precos?ref=01JTEST&fxl_sig=abc123` does not throw or show error.
- `checkout_attempts` row created from a checkout flow with `ref` param has non-null `click_id` and the `fxl_sig` stored verbatim.
- Cross-subdomain note (failure-list #5): set the cookie `domain` attribute so it propagates from `/precos` to the checkout subdomain; verify cookie read on `/checkout/credit-card`.
- `fxl_ref` cookie attributes are `HttpOnly`, `Secure`, `SameSite=Lax`, 90-day (per D-R).
- No `fxl_sig` HMAC validation added on this side (by design, D-P — comment in code).
</acceptance_criteria>

---

### T08 · Side B: fxl-financiero webhook sender — `lib/fxl-finders-webhook.ts` + trigger on `first_paid_at`

**Plan:** `06-P08` — Wave 3
**Type:** cross-repo
**CROSS-REPO GUARDRAIL APPLIES** — branch only, no push.

<read_first>
Pre-researched facts:
- Partners domain: `apps/api/src/domains/partners/admin-routes.ts` + `service.ts`
- Commission accrual fires when admin sets `first_paid_at` on `org_attribution`
- **Phase 05 webhook body contract — the EXACT D-M field set (the Phase 05 `WebhookBodySchema` MUST accept exactly this; the financeiro sender MUST emit exactly this):**
  ```json
  {
    "source": "fxl-financiero",
    "external_order_id": "<org_attribution.org_id>",
    "event_type": "sale",
    "idempotency_key": "<createHash('sha256').update(source+external_order_id+event_type).digest('hex')>",
    "click_id": "<checkout_attempts.click_id or null>",
    "finder_code": "<referral_links.code resolved from click_id, optional/null>",
    "seller_clerk_id": "<org_attribution.sold_by_user_id or null>",
    "customer_email": "<checkout_attempts.customer_email>",
    "customer_name": "<checkout_attempts.customer_name>",
    "customer_phone": "<checkout_attempts.phone>",
    "customer_cpf": "<checkout_attempts.cpf_cnpj>",
    "customer_org_id": "<org_attribution.org_id>",
    "realized_setup_brl": "<checkout_attempts.setup_amount_brl>",
    "realized_monthly_brl": "<checkout_attempts.monthly_amount_brl>",
    "closed_at": "<org_attribution.first_paid_at ISO8601>"
  }
  ```
  (Per D-M: `click_id`, `seller_clerk_id` are nullable; `finder_code` is optional/null. The PII fields
  `customer_name`/`customer_phone`/`customer_cpf` are REQUIRED in the contract — Phase 05 D-L inserts a
  `leads` PII row from them. The `source` value is the canonical slug `fxl-financiero` per D-A.)
- HMAC header format (Phase 05 D3 + D-O): `X-FXL-Signature: t=<unix_ts>,v1=<hmac>`
  where `hmac = createHmac('sha256', FXL_FINDERS_WEBHOOK_SECRET).update(t + "." + rawBody).digest('hex')`.
  Sign over the IDENTICAL raw byte string that is sent as the request body — never re-serialize.
</read_first>

<action>
In fxl-financiero on branch `feat/fxl-finders-integration`:

1. Create `apps/api/src/lib/fxl-finders-webhook.ts`:

```typescript
import { createHmac, createHash } from 'node:crypto'

// MUST byte-match FXL Finders packages/shared-utils/src/hmac.ts verifyHmac()
// Formula: hmac = createHmac('sha256', secret).update(t + "." + rawBody).digest('hex')
// INVARIANT (D-O): sign over the IDENTICAL raw byte string that is sent as the body.
function signPayload(rawBody: string, secret: string): string {
  const t = Math.floor(Date.now() / 1000).toString()
  const hmac = createHmac('sha256', secret)
    .update(`${t}.${rawBody}`)
    .digest('hex')
  return `t=${t},v1=${hmac}`
}

async function sendWithRetry(url: string, body: object, secret: string): Promise<void> {
  const rawBody = JSON.stringify(body)
  const signature = signPayload(rawBody, secret)
  const delays = [1000, 2000, 4000]
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-FXL-Signature': signature,
        },
        body: rawBody,
      })
      if (res.ok || res.status < 500) return  // success or 4xx (don't retry client errors)
    } catch (_) {}
    if (attempt < delays.length) await new Promise(r => setTimeout(r, delays[attempt]))
  }
  // Final failure: log for ops (do NOT throw — sale flow must not be blocked)
  console.error('[fxl-finders-webhook] final delivery failure', { url, body })
  // TODO: insert into webhook_send_failures table for ops visibility
}

export async function notifyFxlFindersConversion(params: {
  orgId: string
  clickId: string | null
  finderCode: string | null
  sellerClerkId: string | null
  customerEmail: string
  customerName: string
  customerPhone: string | null
  customerCpf: string | null
  setupAmountBrl: number
  monthlyAmountBrl: number
  firstPaidAt: Date
}): Promise<void> {
  const apiUrl = process.env.FXL_FINDERS_API_URL
  const secret = process.env.FXL_FINDERS_WEBHOOK_SECRET
  if (!apiUrl || !secret) {
    console.warn('[fxl-finders-webhook] FXL_FINDERS_API_URL or FXL_FINDERS_WEBHOOK_SECRET not set — skipping')
    return
  }
  const source = 'fxl-financiero'        // D-A canonical slug (…ciero) — byte-identical to seed apps.slug
  const externalOrderId = params.orgId
  const eventType = 'sale'
  // D-N / D9: idempotency_key is PLAIN SHA-256 (NOT HMAC). Byte-matches Phase 05 buildIdempotencyKey.
  const idempotencyKey = createHash('sha256')
    .update(source + externalOrderId + eventType)
    .digest('hex')
  await sendWithRetry(`${apiUrl}/api/v1/conversions`, {
    source,
    external_order_id: externalOrderId,
    event_type: eventType,
    idempotency_key: idempotencyKey,
    click_id: params.clickId,
    finder_code: params.finderCode,
    seller_clerk_id: params.sellerClerkId,
    customer_email: params.customerEmail,
    customer_name: params.customerName,
    customer_phone: params.customerPhone,
    customer_cpf: params.customerCpf,
    customer_org_id: params.orgId,
    realized_setup_brl: params.setupAmountBrl,
    realized_monthly_brl: params.monthlyAmountBrl,
    closed_at: params.firstPaidAt.toISOString(),
  }, secret)
}
```

> **D-N (LOCKED):** the `idempotency_key` line MUST be `createHash('sha256').update(source + external_order_id + event_type).digest('hex')`. The earlier draft's `createHmac('sha256','')...` line is DELETED — do NOT reintroduce it. `createHmac` is used ONLY by `signPayload` for the `X-FXL-Signature` transport auth.
>
> **D-M (LOCKED):** the body MUST include `customer_name`, `customer_phone`, `customer_cpf` (sourced from `checkout_attempts.customer_name` / `phone` / `cpf_cnpj`). Phase 05 inserts a `leads` PII row from these.

2. In `apps/api/src/domains/partners/service.ts` (or `admin-routes.ts`, wherever `first_paid_at` is set):
   - After updating `org_attribution.first_paid_at`, call `notifyFxlFindersConversion(...)` fire-and-forget (no `await` blocking the HTTP response — use `.catch(console.error)`).
   - Resolve the `checkout_attempts` row by `org_id` to get `click_id`, `fxl_sig`, `setup_amount_brl`, `monthly_amount_brl`, `customer_email`, `customer_name`, `phone`, `cpf_cnpj`.
   - Resolve `finder_code` from `referral_links.code` via the `click_id` (D10) — or `null` if no click.
   - **Guard (failure-list #4):** if no `checkout_attempts` row resolves for the `org_id` (e.g. `org_id` nullable at first_paid_at time), log a warning and SKIP the webhook send (do not throw, do not send a partial body).
</action>

<acceptance_criteria>
- All work on branch `feat/fxl-finders-integration`; never pushed.
- `pnpm tsc --noEmit` in fxl-financiero `apps/api` passes.
- `notifyFxlFindersConversion` is called after `first_paid_at` is set.
- Webhook body emits EXACTLY the D-M field set (incl. `finder_code`, `customer_name`, `customer_phone`, `customer_cpf`) with `source: 'fxl-financiero'`.
- `idempotency_key` uses `createHash('sha256')` (grep proves NO `createHmac` appears on the idempotency line); `createHmac` appears ONLY in `signPayload`.
- If `FXL_FINDERS_API_URL` or `FXL_FINDERS_WEBHOOK_SECRET` are missing, the function logs a warning and returns (does NOT throw).
- If no `checkout_attempts` row resolves for the `org_id`, the function logs a warning and skips (does NOT throw, does NOT send a partial body).
- HTTP 5xx retries 3 times with 1s/2s/4s backoff; HTTP 4xx does NOT retry.
- Delivery failure logs via `console.error` but does NOT throw (sale flow unblocked).
- D-A verify: `grep -rn 'fxl-financeiro' apps/api/src/lib/fxl-finders-webhook.ts` (in the fxl-financiero repo) returns 0 — the source string is `fxl-financiero` (…ciero).
</acceptance_criteria>

---

### T09 · `apps/web` admin payout UI — finder list + create batch

**Plan:** `06-P09` — Wave 4
**Type:** execute
**PREREQUISITE:** `/gsd-ui-phase 06` must have run and `06-UI-SPEC.md` must exist before starting this task.

<read_first>
- `.planning/phases/06-*/06-UI-SPEC.md` (generated by `/gsd-ui-phase 06`)
- `apps/web/src/admin/` — existing admin page pattern (layout, route guards, component structure)
- `apps/web/src/lib/api-client.ts` — the **`apiFetch(path, { method, token, body })`** helper (D-J). All calls go through it with a Clerk token from `useAuth().getToken()`. NO bare `fetch('/api/...')`, NO `apiClient.get`. (Confirm the default port is `3006`, not `3000` — D-J/D-R.)
- `apps/web/src/i18n/` — translation file structure for PT-BR
- Wave 0 routing convention: `/admin/payouts`
- T03/T05 — `FinderCommissionSummary` has `payable` + `blockedReason` (finders missing cpf/pix_key).
</read_first>

<action>
Create `apps/web/src/admin/payouts/` directory with:

1. `apps/web/src/admin/payouts/index.tsx` — Finders Ready for Payout page:
   - `useQuery(['payouts','finders-ready'])` → `apiFetch('/api/v1/admin/payouts/finders-ready', { method: 'GET', token })` (token from `useAuth().getToken()`). Apply the array hook guard `select: (data) => Array.isArray(data.finders) ? data.finders : []`.
   - Table columns: Finder Name, CPF (masked: `***.XXX.XXX-**`), PIX Key, PIX Key Type, Locked Amount (BRL formatted), Commission Count.
   - **Missing cpf/pix_key (D-Q):** rows with `payable === false` render a "Sem CPF/PIX" warning badge and their checkbox is DISABLED (cannot be selected for a payout) — they are shown, not hidden.
   - `isLoading` → skeleton rows (use shadcn `Skeleton`; KPICard pattern is N/A for a table).
   - `!isLoading && empty` → empty state: "Nenhum finder com comissões prontas para pagamento".
   - Row checkboxes for multi-select (payable finders only).
   - "Criar Pagamentos" button (disabled until ≥1 payable finder selected).
   - Button triggers `useMutation` → `apiFetch('/api/v1/admin/payouts/batches', { method: 'POST', token, body: { finderIds } })` (creates one `payouts` row per finder server-side).
   - On 422 `finder_not_payable` → toast the blocked finder; do NOT navigate.
   - On success: `invalidateQueries(['payouts','finders-ready'])` + `invalidateQueries(['payouts','list'])`, then navigate to `/admin/payouts/batches`.

2. Register route in `apps/web/src/router.tsx` (or wherever admin routes are defined): `/admin/payouts` → `PayoutsPage`.

3. Add navigation item "Pagamentos" to admin sidebar/nav (wherever it lives).

4. i18n keys in `apps/web/src/i18n/pt-BR.json` (and mirror EN keys in `en.json`):
   ```json
   "payouts": {
     "title": "Pagamentos",
     "findersReady": "Finders prontos para pagamento",
     "createBatch": "Criar Pagamentos",
     "empty": "Nenhum finder com comissões prontas para pagamento",
     "notPayable": "Sem CPF/PIX",
     "columns": { "finderName": "Finder", "cpf": "CPF", "pixKey": "Chave PIX", "pixKeyType": "Tipo", "amount": "Valor", "commissionCount": "Comissões" }
   }
   ```
</action>

<acceptance_criteria>
- Page renders at `/admin/payouts`.
- All data calls go through `apiFetch(..., { token })` (grep: no bare `fetch('/api` and no `apiClient.` in the new files).
- `isLoading` state shows skeleton rows; empty state shows the correct PT-BR message.
- Finders with `payable===false` show the "Sem CPF/PIX" badge and a DISABLED checkbox (cannot be selected) — and are NOT dropped from the list.
- Multi-select works; "Criar Pagamentos" button disabled when no payable finder selected.
- Mutation fires with correct `finderIds`; a 422 `finder_not_payable` shows a toast and does not navigate.
- On success, query cache invalidated and user navigated to `/admin/payouts/batches`.
- No hardcoded Portuguese strings outside i18n JSON; both pt-BR.json and en.json have the new keys.
- `pnpm tsc --noEmit` passes.
</acceptance_criteria>

---

### T10 · `apps/web` admin payout UI — payout list, download CSV, mark paid

**Plan:** `06-P10` — Wave 4
**Type:** execute
**PREREQUISITE:** `/gsd-ui-phase 06` must have run and `06-UI-SPEC.md` must exist.

<read_first>
- `.planning/phases/06-*/06-UI-SPEC.md`
- `apps/web/src/admin/payouts/index.tsx` (T09) — `apiFetch` usage, token pattern, query key conventions
- D6 above — two-person approval is DEFERRED to v1.1; there are NO `approved_by_*` columns and NO approval badge in v1.0.
- Phase 05 `payouts` status values are `draft | exported | paid | voided` (NOT `pending`). Phase 05 admin endpoints: `GET /api/v1/admin/payouts` (list), `POST /api/v1/admin/payouts/:payoutId/mark-paid`.
</read_first>

<action>
Create `apps/web/src/admin/payouts/batches.tsx` — Payouts page (route `/admin/payouts/batches`):

1. `useQuery(['payouts','list'])` → `apiFetch('/api/v1/admin/payouts', { method: 'GET', token })` (token from `useAuth().getToken()`); array hook guard `select`.
2. Table columns: ID (truncated), Created At, Finder, Total Amount (BRL), Status badge, Actions.
3. Status badges (shadcn `Badge`) — Phase 05 status set:
   - `draft` → yellow "Rascunho"
   - `exported` → blue "Exportado"
   - `paid` → green "Pago"
   - `voided` → gray "Anulado"
   (NO two-person-approval badge in v1.0 — D6 deferred.)
4. Actions per row:
   - "Baixar CSV" button → `apiFetch('/api/v1/admin/payouts/batches/<id>/csv', { method: 'GET', token })` returning a Blob, then trigger download via `<a download>` + `URL.createObjectURL` (NOT `window.location.href`, which would not carry the Bearer token). Filename from the `Content-Disposition` header.
   - "Marcar como Pago" button (only if status `draft` or `exported`) → `useMutation` → `apiFetch('/api/v1/admin/payouts/<payoutId>/mark-paid', { method: 'POST', token, body: {} })` + confirm dialog ("Confirmar pagamento? Esta ação não pode ser desfeita.").
5. On any mutation success: `invalidateQueries(['payouts','list'])` + `invalidateQueries(['payouts','finders-ready'])`.
6. Register route: `/admin/payouts/batches`.

i18n additions to `pt-BR.json` (mirror in `en.json`):
```json
"payouts.batches": {
  "title": "Pagamentos",
  "download": "Baixar CSV",
  "markPaid": "Marcar como Pago",
  "confirmPaid": "Confirmar pagamento? Esta ação não pode ser desfeita.",
  "status": { "draft": "Rascunho", "exported": "Exportado", "paid": "Pago", "voided": "Anulado" }
}
```
</action>

<acceptance_criteria>
- Payout list renders at `/admin/payouts/batches`.
- All calls go through `apiFetch(..., { token })` (grep: no bare `fetch('/api`, no `apiClient.`).
- CSV download fetches a Blob through `apiFetch` (carrying the Bearer token) and triggers a file download via `<a download>` — NOT a token-less `window.location.href` navigation.
- Confirm dialog appears before `mark-paid` mutation fires.
- Status badges use the Phase 05 `draft|exported|paid|voided` set with correct colors; NO "Aprovação pendente" badge (D6 deferred).
- Marking paid flips the payout to `paid` and (server-side, T03) the reserved commissions `locked→paid`.
- Mutations invalidate query cache correctly.
- No hardcoded Portuguese strings outside i18n JSON; both pt-BR.json and en.json have the new keys.
- `pnpm tsc --noEmit` passes.
</acceptance_criteria>

---

### T11 · Cross-repo patch export + type-check gate

**Plan:** `06-P11` — Wave 4
**Type:** execute

<read_first>
- `docs/nexo/cross-repo/` — check if directory exists; create if not
- fxl-financiero branch `feat/fxl-finders-integration` (created in T06–T08)
</read_first>

<action>
1. In fxl-financiero repo, run type-check:
   ```bash
   cd <fxl-financiero>/apps/api && pnpm tsc --noEmit
   cd <fxl-financiero>/apps/site && pnpm tsc --noEmit
   ```
   Fix any type errors before proceeding.

2. Generate patch:
   ```bash
   cd <fxl-financiero>
   git diff main...feat/fxl-finders-integration > /tmp/06-financeiro-integration.patch
   ```

3. Copy patch into this repo:
   - Create `docs/nexo/cross-repo/` if it doesn't exist
   - Write to `docs/nexo/cross-repo/06-financeiro-integration.patch`

4. Add a header comment to the patch file documenting:
   - Files touched (see acceptance criteria)
   - Required reviewer sign-off before merging to fxl-financiero main
   - New env vars needed: `FXL_FINDERS_API_URL`, `FXL_FINDERS_WEBHOOK_SECRET`
   - Instruction to update `FXL_FINDERS_API_URL` from placeholder to real URL before staging deploy
</action>

<acceptance_criteria>
- `pnpm tsc --noEmit` passes in BOTH fxl-financiero `apps/api` and `apps/site` with zero errors.
- `docs/nexo/cross-repo/06-financeiro-integration.patch` exists and is non-empty.
- Patch touches exactly these files in fxl-financiero:
  - `apps/api/src/db/schema/checkout.ts` (`click_id` + `fxl_sig` columns)
  - `apps/api/src/db/schema/org-attribution.ts` (`click_id` column)
  - `apps/api/src/lib/fxl-finders-webhook.ts` (new file)
  - `apps/api/src/domains/partners/service.ts` or `admin-routes.ts` (trigger call)
  - `apps/site/src/app/precos/page.tsx` (`ref` + `fxl_sig` acceptance, cookie)
  - `apps/site/src/app/checkout/credit-card/page.tsx` (thread params)
  - `.env.example` (new env vars)
  - `apps/api/drizzle/000X_add_click_id_fxl_sig.sql` (generated migration — `click_id` + `fxl_sig`)
- Header comment present in patch file (incl. D-A note: webhook `source` is `fxl-financiero`; secret MUST equal `apps.webhook_signing_secret` for that slug).
- D-A verify: `grep -rn 'fxl-financeiro' docs/nexo/cross-repo/06-financeiro-integration.patch` returns 0 — the patch source string is `fxl-financiero` (…ciero).
- NEVER pushed to remote — `git -C <fxl-financiero> branch -r --contains feat/fxl-finders-integration` returns empty; branch exists locally only. The executor never runs `git push` in the fxl-financiero repo.
</acceptance_criteria>

---

### T12 · Manual E2E UAT doc + type-check + lint gate

**Plan:** `06-P12` — Wave 4
**Type:** execute

<read_first>
- `.planning/phases/05-conversion-ingestion-commission-ledger-audit/05-PLAN.md` — UAT doc format reference (if one exists in Phase 05)
- `docs/nexo/verify/` — check if directory exists; create if not
- `apps/api/` + `apps/web/` — confirm `pnpm run check` passes (lint + type-check)
</read_first>

<action>
1. Run full lint + type-check gate (this repo only — NOT fxl-financiero, which is handled in T11):
   ```bash
   pnpm run check  # from root — runs lint + type-check across all workspaces
   ```
   Fix all errors. If `pnpm run check` doesn't exist, run `pnpm tsc --noEmit` in `apps/api` and `apps/web` plus `pnpm eslint` separately.

2. **D-A slug verify gate (must return 0 matches in Phase 06 deliverables):**
   ```bash
   grep -rn 'fxl-financeiro' \
     apps/api/drizzle/0006_fxl_financiero_seed.sql \
     apps/api/src/domains/payouts/ \
     apps/api/test/ \
     docs/nexo/cross-repo/06-financeiro-integration.patch \
     docs/nexo/verify/06-financeiro-integration-uat.md
   # 0 matches required. (The phase DIRECTORY name keeps …ceiro — exempt, cosmetic.)
   ```
   Any hit is a blocker — fix to `fxl-financiero` (…ciero) and re-run.

3. Confirm the automated e2e contract test (T13) passes — it is the primary regression gate; the manual TCs below are supplementary.

4. Create `docs/nexo/verify/06-financeiro-integration-uat.md` with the following manual E2E test cases:

   **Pre-conditions:**
   - fxl-financiero running locally with `feat/fxl-finders-integration` branch
   - FXL Finders api running locally (port 3006)
   - `FXL_FINDERS_API_URL=http://localhost:3006` + `FXL_FINDERS_WEBHOOK_SECRET=<local-test-secret>` set in fxl-financiero `.env`
   - The `apps.webhook_signing_secret` for slug `fxl-financiero` set in FXL Finders DB to the same `<local-test-secret>` (the seed generates a real secret; rotate it to the test value for local UAT)

   **Test cases (PT-BR step-by-step):**
   - TC01: Referral link click → checkout com `?ref` → verificar `checkout_attempts.click_id` e `fxl_sig` preenchidos
   - TC02: Admin seta `first_paid_at` → verificar webhook recebido em FXL Finders (log ou `webhook_events` row), body com `source='fxl-financiero'` e campos PII (`customer_name`/`customer_phone`/`customer_cpf`)
   - TC03: Conversão criada → comissão gerada com `status='pending'` → após `hold_until`, o nightly job promove direto `pending → locked` (SEM passo `approved` — D-K)
   - TC04: Admin acessa `/admin/payouts` → lista finders com comissões `locked`; finder sem CPF/PIX aparece com badge "Sem CPF/PIX" e checkbox desabilitado
   - TC05: Admin seleciona finders pagáveis → cria pagamentos (1 `payouts` row por finder) → verifica em `/admin/payouts/batches` (status `draft`)
   - TC06: Admin clica "Baixar CSV" → arquivo abre corretamente no Excel PT-BR (BOM presente, sem caracteres quebrados); header = `finder_name,cpf,pix_key,pix_key_type,amount_brl,commission_ids`
   - TC07: Comissões reservadas continuam `locked` com `paid_payout_id` preenchido (NÃO viram `in_payout`)
   - TC08: Admin marca como Pago (com confirmação) → status do payout muda para "Pago" → comissões reservadas mudam `locked → paid`
   - TC09: Reenvio do mesmo webhook → `idempotency_key` conflict → 200 `{ status: 'duplicate' }` sem duplicar conversão nem comissão
   - TC10: `FXL_FINDERS_WEBHOOK_SECRET` errado → webhook rejeitado com 401 genérico por FXL Finders (sem revelar se a `source` existe)
   - TC11: Verificar `audit_log` tem entradas para: pagamento criado/reservado, pagamento marcado pago

   Each TC has: steps, expected result, pass/fail checkbox.
</action>

<acceptance_criteria>
- `pnpm run check` (or equivalent) exits 0 in this repo.
- The D-A slug verify gate (step 2) returns 0 matches.
- The automated e2e test (T13) is green.
- `docs/nexo/verify/06-financeiro-integration-uat.md` exists with all 11 test cases.
- Each TC has clear steps + expected result; TC03 asserts the `pending → locked` auto-promotion with NO `approved` step; TC07/TC08 assert reserve-then-pay semantics (no `in_payout`).
- Document is in PT-BR.
- No `.md` file created for findings/analysis (this task creates a UAT checklist, not a report — allowed per task scope).
</acceptance_criteria>

---

### T13 · Automated e2e conversion-contract test (Hono test client) — replaces deleted T02

**Plan:** `06-P13` — Wave 2 (runs after T01 seed + Phase 05 conversions/ingestion exist)
**Type:** execute

> Added per the LOCKED WARN fix: the conversion contract MUST have an AUTOMATED end-to-end test
> (not manual-only). This is the primary regression gate for the cross-repo webhook contract.

<read_first>
- `apps/api/src/domains/conversions/routes.ts` + `hmac-middleware.ts` (Phase 05) — mount path `POST /api/v1/conversions`, HMAC middleware, returns `200 { status: 'accepted', conversionId }` / `200 { status: 'duplicate' }`.
- `apps/api/src/domains/conversions/service.ts` (Phase 05) — `WebhookBodySchema`, `buildIdempotencyKey`.
- `packages/shared-utils/src/hmac.ts` — `verifyHmac` (and how the middleware parses `t=<ts>,v1=<hex>`).
- `apps/api/test/` — vitest integration project config (uses `TEST_DATABASE_URL`, migrations via globalSetup, per Phase 01 D-G).
- T01 seed — provides the `fxl-financiero` app row + `webhook_signing_secret` the test signs with.
- The EXACT D-M body field set (T08 read_first) — the test posts this verbatim.
</read_first>

<action>
Create `apps/api/test/integration/conversions/webhook-contract.test.ts` in the vitest **integration** project (it needs a live DB; runs after migrations + the T01 seed). Use Hono's test client (`app.request(...)` or `testClient`) against the assembled app:

1. **Setup:** ensure the `fxl-financiero` app row + product + price_bands + commission_rules are seeded (run the T01 migration in globalSetup), and seed a `referral_link` + `click` so attribution resolves. Read the seeded `webhook_signing_secret` for slug `fxl-financiero`.
2. **Build the EXACT T08 body** (D-M field set) with `source: 'fxl-financiero'`, a resolvable `click_id`, and PII fields. Serialize ONCE to `rawBody`.
3. **Sign it** with the inline formula (D-O): `t = '<fixed ts within skew>'`, `v1 = createHmac('sha256', secret).update(t + '.' + rawBody).digest('hex')`, header `X-FXL-Signature: t=<t>,v1=<v1>`.
4. **POST** `rawBody` to `/api/v1/conversions` with that header.
   - Assert `200` and `{ status: 'accepted', conversionId }`.
   - Assert a `conversions` row exists for the `idempotency_key`.
   - Assert ≥1 `commissions` row was created for the resolved finder (status `pending`, basis = `realized_*_brl`).
   - Assert a `leads` PII row was inserted (D-L) and `webhook_events` recorded the event with `body_hash`.
5. **Replay** the IDENTICAL signed request → assert `200 { status: 'duplicate' }` and that NO additional `conversions`/`commissions`/`leads` rows were created (counts unchanged).
6. **Negative:** post the same body with a wrong secret signature → assert `401` (generic — no source-existence oracle, D-O).

Deterministic fixtures; clean up rows in `afterEach`/`afterAll` or use a transaction-rollback fixture.
</action>

<acceptance_criteria>
- `pnpm vitest run --project=integration` runs this test against `TEST_DATABASE_URL` and passes.
- The test posts the EXACT D-M body with a VALID signature and asserts `200 { status: 'accepted' }` + conversion row + ≥1 commission row + leads row + webhook_events row.
- The replay of the identical request asserts `200 { status: 'duplicate' }` and row counts UNCHANGED (no duplicates).
- A wrong-secret signature asserts `401`.
- The test signs with `verifyHmac`-compatible bytes (`t + '.' + rawBody`) and uses the seeded `fxl-financiero` `webhook_signing_secret`.
- D-A verify: `grep -rn 'fxl-financeiro' apps/api/test/integration/conversions/webhook-contract.test.ts` returns 0 (source is `fxl-financiero`).
- `pnpm tsc --noEmit` passes.
</acceptance_criteria>

---

## must_haves

- **Canonical slug `fxl-financiero`** (D-A): byte-identical in seed `apps.slug`, webhook `source`, fixtures, seed FILE name (`0006_fxl_financiero_seed.sql`). The verify gate (top of plan + T12 step 2 + T13) returns 0 matches for `fxl-financeiro` (…ceiro) in Phase 06 deliverables.
- **Single payout design (D-Q)**: NO `payout_batches`/`payout_batch_items` tables, NO `in_payout` status, NO `payout_batch_id` column. Phase 06 EXTENDS the Phase 05 `payouts` table + service with `listFindersWithLockedCommissions` + `generateCsv(payoutIds[])`. Reserve via `commissions.paid_payout_id` (stays `locked`); `markPayoutPaid` flips `locked → paid`.
- **Finders missing cpf/pix_key are excluded/flagged** (D-Q): `listFindersWithLockedCommissions` returns `payable=false` + `blockedReason`; `createPayoutBatch` throws `finder_not_payable` (422) — NEVER a NOT NULL DB crash. UI disables their checkbox + shows a badge.
- **Seed supplies ALL NOT NULL columns + a real generated `webhook_signing_secret`** (D-R): `apps` row sets `publishable_key`, `secret_key_hash`, `secret_key_prefix`, `status='active'`, `created_by_user_id='system'`; `products.status='active'`; `price_bands` cols are `min_brl/list_brl/max_brl`. Migration is journaled (D-F).
- **Seed idempotency**: All seed INSERTs use `ON CONFLICT DO NOTHING` — must not fail on re-run.
- **UTF-8 BOM + PINNED CSV header** (D4): missing BOM breaks Excel PT-BR silently; header is byte-exactly `finder_name,cpf,pix_key,pix_key_type,amount_brl,commission_ids`. Covered by TDD (T04).
- **HMAC byte-match via `verifyHmac`** (D-O): Phase 06 inline sign in fxl-financiero MUST produce a MAC that Phase 05 `verifyHmac` accepts over the IDENTICAL `t + '.' + rawBody` string. Covered by TDD (T04). No cross-repo import — inline formula only. The export is `verifyHmac`, never `verify`.
- **`idempotency_key` uses `createHash('sha256')` not `createHmac`** (D-N): `createHash('sha256').update(source+external_order_id+event_type).digest('hex')`, byte-matching Phase 05 `buildIdempotencyKey`. The `createHmac('sha256','')` line is DELETED. Covered by TDD (T04).
- **Webhook body = exact D-M field set** (D-M): incl. `finder_code`, `customer_name`, `customer_phone`, `customer_cpf`. Phase 05 schema == Phase 06 sender. Covered by the automated e2e (T13).
- **Automated e2e contract test (T13)**: Hono test client posts the exact body with a valid sig → 200 accepted + conversion + commission + leads rows; replay → 200 duplicate, no dup rows; wrong sig → 401. NOT manual-only.
- **`fxl_sig` stored, not verified** (D-P): financeiro persists `click_id` + `fxl_sig`; verification deferred to a later version (store-only in v1.0).
- **Frontend uses `apiFetch(..., { token })`** (D-J): no bare `fetch('/api/...')`, no `apiClient.get`; Clerk token from `useAuth().getToken()`.
- **No push to fxl-financiero**: NEVER push the integration branch (`feat/fxl-finders-integration`). The patch file in this repo is the handoff artifact.
- **fxl-financiero type-check clean**: T11 must pass `pnpm tsc --noEmit` in both `apps/api` and `apps/site` of fxl-financiero before patch is exported.
- **Payout UI gated on `/gsd-ui-phase 06`**: T09 and T10 must not start without the UI-SPEC.
- **i18n PT-BR + EN**: Every user-facing string in T09/T10 via `useTranslation()`; new keys written to both `pt-BR.json` and `en.json`. No hardcoded strings in JSX.
- **No `setTenantContext` in payout admin routes**: admin payouts use `getAdminDb()` (BYPASSRLS, D-C). One `node-cron` scheduler (Phase 05 owns it — Phase 06 adds no second cron).
- **Two-person approval DEFERRED to v1.1** (D6/D-Q): no `approved_by_*` columns added in Phase 06 (the batch table that held them is removed); no approval badge in v1.0 UI; deferral documented in a code comment.

---

## Wave 5 failure-list items (carry to execution)

1. **`allowed_redirect_hosts` hostname**: PLACEHOLDER `fxlfinanceiro.com.br` — executor must verify real hostname with fxl-financiero team and update seed SQL + `.env.example` comment.
2. **`webhook_signing_secret` in seed**: PLACEHOLDER — executor must generate a real secret via FXL Finders admin UI after migration and inject via Infisical (never commit real secret).
3. **CSV `amount_brl` PT-BR formatting**: `Intl.NumberFormat('pt-BR', {minimumFractionDigits:2})` produces correct `1.234,56` format — verify in T04 TDD that the specific thousand-separator (`.`) and decimal-separator (`,`) are correct.
4. **fxl-financiero `checkout_attempts` row by `org_id`**: At `first_paid_at` trigger time, `checkout_attempts.org_id` may be nullable until account is fully created — T08 must handle null gracefully (skip webhook send, log warning).
5. **Cookie attributes for cross-domain tracking**: `fxl_ref` cookie set on `fxlfinanceiro.com.br` sub-pages with `HttpOnly`, `Secure`, `SameSite=Lax`, 90-day (D-R). If checkout is on a different subdomain, set the `domain` attribute so it propagates — verify in T07.
6. **`node-cron` shutdown in Phase 05**: Phase 05 owns the single scheduler — Phase 06 introduces NO second cron job (D brief rule 4).
7. **`idempotency_key` collision on `createHash`**: Plain SHA-256 (no key, D-N) — collision probability acceptable for `source+external_order_id+event_type` with controlled inputs. Document.
8. **Two-person approval v1.1 deferral**: Per D-Q the batch table that held `approved_by_*` columns is REMOVED — NO approval columns added in Phase 06 and NO approval badge in v1.0 UI. Document "single-approver for v1.0" in a code comment in `payouts/service.ts`.

---

## Cross-repo handoff summary (for Phase 06 execution report)

The executor MUST include this section in the execution handoff:

```
CROSS-REPO HANDOFF — Phase 06
Branch: feat/fxl-finders-integration (fxl-financiero repo — NOT pushed)
Patch: docs/nexo/cross-repo/06-financeiro-integration.patch
Files touched in fxl-financiero:
  - apps/api/src/db/schema/checkout.ts
  - apps/api/src/db/schema/org-attribution.ts
  - apps/api/src/lib/fxl-finders-webhook.ts (NEW)
  - apps/api/src/domains/partners/service.ts (or admin-routes.ts)
  - apps/site/src/app/precos/page.tsx
  - apps/site/src/app/checkout/credit-card/page.tsx
  - .env.example
  - apps/api/drizzle/000X_add_click_id_fxl_sig.sql (NEW)
Webhook contract: source='fxl-financiero' (D-A); body = D-M field set (incl. customer_name/phone/cpf);
  idempotency_key = sha256(source+external_order_id+event_type) (D-N); X-FXL-Signature header
  t=<ts>,v1=hmac-sha256(t+'.'+rawBody, secret) (D-O). fxl_sig is stored only, not verified (D-P).
Action required: fxl-financiero tech lead reviews patch, merges to main, deploys with
FXL_FINDERS_API_URL + FXL_FINDERS_WEBHOOK_SECRET env vars set in Infisical staging.
The FXL_FINDERS_WEBHOOK_SECRET MUST equal apps.webhook_signing_secret for slug 'fxl-financiero' in FXL Finders.
```
