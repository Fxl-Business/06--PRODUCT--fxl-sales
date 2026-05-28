# State

**Active milestone:** v1.0 — FXL Finders MVP (started 2026-05-28)
**Active phase:** Phase 03 ✅ EXECUTED + verified + reviewed (2026-05-28). Phase 04 unblocked (finder portal shell + approved-finder users + admin approval queue now exist).
**Workflow:** /nexo:add-feature with /nexo:autopilot active (single human gate at Phase 0 spec approval was skipped per autopilot rule 4 — choices logged inline in spec § 2)
**Token tier:** Tier 2 (6 phases)

## Failure list

(none yet)

## Phase 01 — Schema foundation + Clerk auth + RLS (2026-05-28)

- Executed all 17 tasks (T01–T15 + T09b + T11b) + the dispatch-required `require-admin.ts`. 9 foundation tables shipped; migration `0000_fancy_klaw` journaled with role grants + RLS appended (D-F). 3 DB roles created (owner/app/admin BYPASSRLS). `clerkAuthMiddleware` + `setTenantContext(tx,orgId)` + `getAdminDb()` + `clerkClient` singleton + `requireAdmin` all in place (D-B/C/D/H/I).
- Gates: `pnpm -r type-check` 0 · api lint 0 · unit 0 (passWithNoTests) · RLS integration **4/4 pass** as `fxl_finders_app`. `pg_policies` confirms both `*_tenant_isolation` policies; RLS fails closed (0 rows with no context).
- verify-work → 01-UAT.md = PASS (19/19). code-review → 01-REVIEW.md = PASS (0 Critical / 0 Warning / 2 Info downstream notes).
- Deviations (in 01-SUMMARY.md): vitest v2 env-flag split instead of `test.projects` (v3 API); `passWithNoTests`; fixed pre-existing missing eslint devDeps (`@eslint/js`, `typescript-eslint`); added `MIGRATE_DATABASE_URL` to migrate script for role-creating first migrate.

## Phase 02 — Apps + products + price bands admin (2026-05-28)

- Executed all 9 tasks (T01–T09). Admin domain shipped: `apps/api/src/domains/admin/{index,apps/*,products/*}`. ONE admin mechanism — consumes Phase 01 `requireAdmin` + `clerkAuthMiddleware` (D-B); NO adminAuth.ts, NO `users.getUser` in request path. Admin tables (apps/products/price_bands/commission_rules) use `getAdminDb()` (BYPASSRLS), NO `setTenantContext` (D-C/02). Frontend admin UI: AdminShell/Nav/Guard, Apps + Products pages, dialogs, reveal-once KeyRevealModal; all calls via `apiFetch` + Clerk `getToken()`, api-client port 3000→3006 (D-J).
- Key gen (TDD): pk_ plaintext, sk_ SHA-256 hash + masked prefix, whs_ plaintext. Price-band min<=list<=max boundary tests + slug-immutability (`UpdateAppSchema = CreateAppSchema.omit({slug}).partial()`) + hostname (bare, not `.url()`) tests. 21 unit tests pass.
- Gates: `pnpm -r type-check` 0 (5/5) · api lint 0 · web lint 0 (6 pre-existing react-refresh warns) · api unit 21/21 · perf:audit ok. All 6 LOCKED grep gates pass (0 real matches). Live integration smoke vs Postgres:5006 (createApp/rotate/upsert/audit/JOIN) green.
- verify-work → 02-UAT.md = PASS. code-review → 02-REVIEW.md = PASS (1 Critical found+fixed: list/get/create leaked `webhook_signing_secret` + `secret_key_hash` → added `PublicAppRow`/`toPublicApp` projection; verified no leak).
- Deviations: UI-SPEC produced inline (autopilot, no pause); no toast lib (dialog-close + invalidation + inline "Saved!"); refactored 3 dialogs to keyed-remount (no reset effect) for `react-hooks/set-state-in-effect`; fixed pre-existing apps/web eslint missing devDeps (`@eslint/js`, `typescript-eslint`).

## Phase 03 — Finder onboarding + portal shell (2026-05-28)

- Executed all 14 tasks (T01–T14). Backend: public signup route (`POST /api/v1/finders/signup`, unauthenticated in server.ts, getAdminDb BYPASSRLS, honeypot decision in handler) + admin finders service (list/detail/approve/suspend, getAdminDb, idempotent approve via SELECT…FOR UPDATE, state-guarded suspend, audit_log on every mutation) + admin sellers service (create+invite). All mounted under the Phase-01 `clerkAuthMiddleware`+`requireAdmin` admin group (D-B/C/H/I). LGPD migration (0001) adds 4 consent cols to finders; migrations 0001/0002 drop NOT NULL on `finders.clerk_user_id`/`clerk_org_id`/`sellers.clerk_user_id` (fixes a unique-collision bug — see deviation 1).
- apps/site: inline getT()+pt-BR JSON i18n (no next-intl), `/signup` (Server Action + useActionState + honeypot + client schema with z.boolean().refine), LGPD legal pages (/legal/privacy 9 sections, /legal/terms 8 sections), landing copy refreshed to FXL Finders. `pnpm build` → 5 routes static.
- apps/web: RoleGuard + RoleRouter (publicMetadata.role → admin/finder/seller/no-role), AdminFindersPage (status tabs + masked-CPF table) + AdminFinderDetailPage (approve/suspend, LGPD section, RawId font-mono fallback) + AdminSellersPage (list + invite dialog), FinderShell/SellerShell + placeholder pages, NoRolePage. All calls via apiFetch + Clerk getToken() (D-J); approve/suspend invalidate ['admin','finders'] AND […,id]. New i18n keys merged into BOTH pt-BR.json + en.json.
- TDD: `finder-state-machine.test.ts` (7 tests — pending→approved happy, reject-non-pending, double-approve idempotency, invite-fail retry-safe, suspend guard ×3; clerkClient mocked, live admin DB). `keys-resolve.test.ts` (8 tests — pt-BR/en key-set equality + sampled non-raw resolution).
- Gates: `pnpm -r type-check` 5/5 · api lint 0 · web lint 0 (14 pre-existing-style react-refresh warns) · site lint 0 · api unit 28/28 · web unit 8/8 · apps/site build 5 routes · perf:audit ok. All LOCKED grep gates clean (db/index 0, setTenantContext real-calls 0, clerkClient-from-@clerk/backend 0, apiClient.get/params 0, findersPublicRouter-in-index.ts 0, z.string().max(0) 0). Live smoke vs Postgres:5006: signup 201 / honeypot silent-201-no-insert / lgpd-false 400 / admin-no-auth 401.
- verify-work → 03-UAT.md = PASS (26/26). code-review → 03-REVIEW.md = PASS (0 Critical / 0 Warning / 3 Info). Two would-be-Critical bugs caught + fixed during TDD: (a) unique-collision on '' Clerk-ID placeholders → columns made nullable, insert null; (b) plan-A3 getDb() signup insert rejected by FORCE RLS → switched to getAdminDb() per brief KEY reminder.
- Deviations: clerk_user_id/clerk_org_id nullable (dev. 1); signup/approval writes via getAdminDb not getDb (dev. 2, brief overrides A3); audit_log prev_hash/entry_hash='' placeholders pending Phase 05 hash-chain (dev. 3); apps/web gained a separate `vitest.config.ts` (vitest/config vite-version skew vs build vite@5) + zod added to apps/site; removed pre-existing dup `typescript-eslint` key in web package.json.

## Phase 2.5 — Adversarial pre-execution plan review (2026-05-28)

- Ran 7-agent review workflow (6 per-phase + 1 cross-phase auditor) over all 6 PLAN.md. Result: all 7 BLOCKED, **22 BLOCKERs** + 17 WARNs + 12 NITs. Caught real wiring bugs (slug `fxl-financeiro`≠`fxl-financiero` → every webhook 401; dead commission lifecycle pending→approved with nothing promoting; duplicated payout domain across 05/06; RLS policies returning 0 rows; non-existent `db`/`verify`/`clerkClient` imports; standalone RLS `.sql` skipped by drizzle migrator).
- Locked 18 cross-cutting reconciliations (D-A..D-R) in `plan-brief.md`.
- Ran 6-agent patch workflow → **107 edits** applied across the 6 plans.
- Post-patch re-audit: **22/22 original blockers RESOLVED**; found 1 NEW blocker (NC-1: Phase 05 T02 standalone RLS file = D-F violation). Fixed inline (RLS appended into journaled migration + `pg_policies` post-migrate assertion). Non-blocking residuals logged: NC-2 require-admin.ts ownership (resolved via conditional-create), NC-3 pgcrypto extension note, NC-4 column-name consistency (confirmed OK). **Verdict: GO.**

## Phase 0 decisions log (user-confirmed)

- v1.0 scope: Platform + fxl-financiero only
- Finder onboarding: Public signup + admin approval
- Payout method: Manual + CSV export
- Price band model: Per-product (min, list, max) tuple
- Sellers: First-class in Finders, opt-in Clerk login

## Phase 0 decisions log (autopilot)

- Sale-close trigger: reuse fxl-financiero's `first_paid_at` event on `org_attribution`
- Commission rate model: per-product flat `(setup_rate_pct, recurring_rate_pct, recurring_months)`
- Attribution window: 30-day last-touch, configurable per app (`apps.attribution_window_days`)
- Commission hold: 30-day default, configurable per app (`apps.commission_hold_days`)
- App roles: apps/api backend; apps/web finder portal + admin route-segmented; apps/site public landing + /signup + /r/:code; apps/mobile deferred
- Webhook direction: push (sibling app → FXL Finders), HMAC-SHA256+timestamp

## Deviations from /nexo:add-feature workflow

1. **2026-05-28** — Phase 0 spec-review gate skipped because /nexo:autopilot was activated after question #5. Per autopilot rule 4, autopilot decisions logged inline in spec § 2 ("Autopilot" rows) rather than waiting for user confirmation. User can still reject the spec on the final handoff if desired and we revert.

2. **2026-05-28** — Phase 1 of /nexo:add-feature (`/gsd-new-milestone`) skipped because the manual bootstrap done in Phase 0 (PROJECT.md, ROADMAP.md with 6 phases, STATE.md with active milestone v1.0) already produces the same outputs `/gsd-new-milestone` would. Repeating the GSD command would either no-op or overwrite the comprehensive scaffold. Same pattern as the template's v1.0 deviation #1. Per Nexo rule "Nexo ⊃ GSD", noted explicitly so future operators understand the chain was honored.

## Final integration verify v1.0

(not yet — pending Phase 06 + verify-work pass)
