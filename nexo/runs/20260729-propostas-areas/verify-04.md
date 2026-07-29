# Verify: 04-proposal-transition-backend

## Setup

Branch `feat/04-proposal-transition-backend` was already checked out in another worktree, so this agent checked out its tip SHA `fce7338984df7e983e9659d883532ce8f79c4333` detached in its own isolated worktree.
`pnpm install --prefer-offline` completed cleanly.
Copied `apps/api/.env` from the main repo into the worktree, pinning integration tests to the local Docker test DB on port 5006 (container `06--product--fxl-sales-db-1`, healthy).

## 1. Change surface vs plan

`git diff 8f94211 fce7338 --stat` shows exactly the five files listed in the plan's `files_modified` front matter, nothing more and nothing less: `apps/api/src/domains/sales-ops/service.ts`, `apps/api/src/domains/sales-ops/routes.ts`, `apps/api/src/domains/sales-ops/__tests__/sale-transitions.test.ts`, `apps/api/src/domains/sales-ops/__tests__/transition-routes.test.ts`, `apps/api/src/domains/sales-ops/__tests__/sale-transitions.integration.test.ts`.

## 2. Contract checks

(a) Transition matrix: `SALE_TRANSITIONS` in `service.ts` reads `draft: ['open','won','cancelled']`, `open: ['won','lost','cancelled']`, `won: ['open']`, `lost: ['open','cancelled']`, `cancelled: ['open']`.
This is character-for-character the plan's matrix table.
`canTransition` returns false for any status not in the record (covers legacy/unknown statuses), and the unit test `sale-transitions.test.ts` iterates the full 5x4 grid plus asserts `canTransition('forecast','won')` and `canTransition('closed','open')` are false.
PASS.

(b) Win path calls the shared `materializeWonPayables` (defined once, at line 491 of `service.ts`, unchanged by this diff since it belongs to the already-merged slice 03 base commit `8f94211`).
No second `PayableKind`, `PayableDraft`, or materialization function was declared in this diff; `grep -n "export type PayableKind\|export function materializeWonPayables"` shows exactly one of each in the whole file.
Payables are linked per row via `receivableId` (call-site maps `receivables: receivableRows.map(r => ({ id: r.id, ... }))` and the shared function attaches `receivableId: row.id` to each of the three per-row payable kinds).
Re-win idempotency: the shared function's `alreadyExists(kind, receivableId)` guard (status `!== 'void'`) is exercised standalone by the unit test `never duplicates a surviving paid payable on re-win`, and the call site correctly loads `existingPayableRows` scoped to `orgId` + `saleId` before calling the function.
No integration test explicitly re-wins after a revert (not required by the plan's oracle test list, which only lists a unit test for this rule), but the code path and unit-level proof are present.
PASS.

(c) Leaving won: in the `to === 'open'` branch, payables are voided only `if (sale.status === 'won')`, filtered on `status: 'open'`, leaving `paid` rows untouched; the sale patch sets `wonAt: null`.
Integration test `reverting a won sale voids open payables, keeps paid ones, and clears won_at` marks one payable `paid` via the admin connection, reverts, and asserts the paid row is still `paid`, all others are `void`, and `wonAt` is `null`.
Test passed (see section 3).
PASS.

(d) Lost sets `lostAt: now` via `patch = { status: 'lost', lostAt: now, updatedAt: now }` in the `to === 'lost'` branch.
Directly confirmed by code reading; not separately integration-tested but the logic is a one-line patch with no side branches, matching the plan verbatim.
PASS.

(e) `cancelContract` requires `sale.status === 'won'` (else `not_cancellable`), and gates further on `sale.recurringBrl > 0 || futureIds.length > 0` (the eligibility check `if (sale.recurringBrl <= 0 && futureIds.length === 0) return not_cancellable`).
Future receivables are selected with `gt(dueDate, cutoff)` and `status = 'open'` (strictly future, matching the plan's "due on the effective date is still owed" rule), then voided; their linked payables are voided via `inArray(receivableId, futureIds)` and `status = 'open'`, which by construction cannot match `receivableId: null` one-shot rows or any `paid` row.
Integration test `voids future open receivables and their linked open payables only` seeds three receivables (2026-08-01/09-01/10-01), wins, marks one payable inside the 09-01 receivable `paid`, cancels with cutoff 2026-08-15, and asserts the 08-01 row/payables stay `open`, the 09-01 and 10-01 receivables go `void`, the paid payable stays `paid`, the other 09-01/10-01 payables go `void`, one-shot payables stay `open`, and the sale keeps `status='won'` and its `updatedAt` unchanged.
Test passed (see section 3).
PASS.

(f) Row locking: both `transitionSale` and `cancelContract` open with `tx.select().from(salesOpsSales)...for('update').limit(1)` inside a single `withTenant` transaction, matching the plan's explicit locking instruction and giving genuine protection against concurrent transitions on the same sale row.
PASS.

(g) Org scoping: every new query in the diff filters on `eq(<table>.orgId, orgId)` (sale select/update, receivable select/update, professional select, existing-payables select, payable insert carries `orgId`, payable update-to-void carries `orgId`).
Cross-tenant behavior: `transitionSale`/`cancelContract` return `{ ok: false, reason: 'not_found' }` when the org-scoped row lookup misses, and the route layer maps that to HTTP 404.
Invalid transitions map to `{ ok: false, reason: 'invalid_transition', from, to }` -> HTTP 409; non-cancellable contracts map to HTTP 409 `contract_not_cancellable`.
Integration test `cross-tenant sale id behaves as not_found` proves both functions return `not_found` for an org-B call against an org-A sale id, and that org A's row is untouched.
Integration test `invalid transitions are rejected` proves `draft->lost`, `lost->won`, and `cancelContract` on a non-won sale all return the correct rejection.
PASS.

## 3. Verification commands

All run from the worktree `/Users/cauetpinciara/Documents/fxl/projects/06--PRODUCT--fxl-sales/.claude/worktrees/agent-a7d4e6062c203b181` at detached HEAD `fce7338`.

- `pnpm run lint`: PASS, 0 errors across api and web.
- `pnpm run type-check`: PASS, `tsc --noEmit` clean for shared-types, shared-utils, apps/api, apps/web.
- `CI=true pnpm test`: PASS, exit code 0.
  apps/api: 23 test files, 212 tests passed, including the two new unit files `sale-transitions.test.ts` (6 tests) and `transition-routes.test.ts` (7 tests).
  apps/web: 15 test files, 91 tests passed.
  packages/shared-utils: 1 test file, 17 tests passed.
  The tracked-file guard (`node scripts/no-legacy-auth.mjs`) ran as part of the `test` script and did not fail the run.
- `pnpm --filter @fxl-sales/api test:integration` (against the local Docker Postgres on port 5006, `.env` copied from the main repo): PASS, exit code 0, 12 test files / 46 tests passed, including the new `sale-transitions.integration.test.ts` (5 tests: win materializes linked payables, revert voids-only-open, cancel-contract voids-future-only, cross-tenant not_found, invalid transitions rejected).
  No test file failed and none were skipped.

## 4. Security lens

No raw SQL string interpolation, no `eval`/`Function` construction, no secrets or environment values introduced in the diff.
Both new routes read `orgId` exclusively from `c.get('orgId')` (the verified Hub claim), never from the request body, matching the project's tenancy rule.
Both routes validate `:id` as a UUID before it reaches any query, so a malformed id short-circuits to 404 rather than reaching Postgres as an invalid uuid cast.
Both routes validate the body with a strict zod schema (`SaleTransitionSchema` excludes `draft` as a target, so "transition to draft" is a 400, not a 409, exactly as specified) before calling into the service.
No new admin-gating regression: the two new routes intentionally do not use `requireAdmin`, which the plan explicitly calls out as matching the existing `POST /sales` posture (tightening is out of scope for this slice).
Row locking (`for('update')`) closes the concurrent-transition race the plan's contract requires.
No findings.

## Verdict

PASS. All contract points proven by direct code inspection and/or a passing test that exercises the behavior; lint, type-check, unit, and integration suites are all green with no skipped or omitted files.
