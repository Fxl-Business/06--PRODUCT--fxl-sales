# State

**Active milestone:** v1.0 — FXL Finders MVP (started 2026-05-28)
**Active phase:** All 6 phases planned + adversarially reviewed + patched → GO for execution
**Workflow:** /nexo:add-feature with /nexo:autopilot active (single human gate at Phase 0 spec approval was skipped per autopilot rule 4 — choices logged inline in spec § 2)
**Token tier:** Tier 2 (6 phases)

## Failure list

(none yet)

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
