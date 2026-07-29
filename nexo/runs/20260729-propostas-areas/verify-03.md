# Verify report: 03-proposal-write-backend

## Verdict: PASS

## Setup

Checked out `feat/03-proposal-write-backend` at commit `891aaee70eaa641a8a45cbf0a9dd95af6e4eb83f` detached in the isolated worktree, since the branch was already checked out in a sibling worktree.
Ran `pnpm install --prefer-offline` (up to date, no new downloads) and copied `apps/api/.env` from the main repo to pin `TEST_DATABASE_URL` at the local Docker Postgres on port 5006 (container `06--product--fxl-sales-db-1`, confirmed running).

## 1. Change surface vs plan

The commit touches exactly the five files listed in `files_modified`, no more and no fewer:
`apps/api/src/domains/sales-ops/service.ts`, `apps/api/src/domains/sales-ops/routes.ts`, `apps/api/src/domains/sales-ops/__tests__/service.test.ts`, `apps/api/src/domains/sales-ops/__tests__/routes.test.ts`, `apps/api/test/rls/proposal-write.test.ts`.
Confirmed via `git show --stat HEAD`.

## 2. Service diff contract checks

(a) `validatePaymentPlan` in `service.ts` sums `items[].quantity*unitBrl` against `installments[].amountBrl` and adds a Zod issue on `installments` when they differ by even one cent; `CreateSaleSchema`/`UpdateSaleSchema` both apply it via `superRefine`, so a mismatch fails `safeParse` and the route returns 400 before the service runs (proven both by `service.test.ts` "rejects a payment plan that does not sum to the items total" and by `routes.test.ts` "returns 400 and skips the service when installments do not sum to the items total").
(b) `resolveSaleItemContexts` (service.ts lines 274-323) rejects product items whose product row is missing (`product_not_found`), whose product has `areaId` null (`product_area_missing`), or whose resolved area id has no matching row in the org (`area_not_found`); proven live against Postgres by the integration test "create rejects a product without an area" which seeds a real area-less product row and asserts the thrown `SaleInputError.code === 'product_area_missing'`.
(c) `SaleItemSchema.superRefine` rejects a free-form item (no `productId`) that also lacks `areaId`, proven by unit test "requires areaId on free-form items" and route test "returns 400 for a free-form item without areaId".
(d) `createSale` only calls `materializeWonPayables` and inserts into `salesOpsPayables` when `input.status === 'won'`; for `open`/`draft` it never touches `salesOpsPayables`.
Proven by the integration test "create v2 persists the explicit plan without payables until won" which creates with `status: 'open'` and asserts `SELECT count(*) FROM sales_ops_payables WHERE sale_id = ...` is 0, and by the unit assertion `expect(result.payables).toEqual([])` for that same scenario logic.
(e) `createSale` with `status: 'won'` calls `materializeWonPayables` with the `.returning()`-captured receivable rows, producing per-row `seller_commission`/`finder_commission`/`tax` payables each carrying `receivableId`, plus one-shot `professional_cost`/`other_cost` rows with `receivableId: null` at `wonDate`.
Proven by the integration test "create with status won materializes per-receivable payables immediately", which asserts `seller_commission`/`tax` rows join back via `receivable_id` and `professional_cost`/`other_cost` have `receivable_id` null.
(f) `buildSaleLedger` emits receivable labels `"${i+1}/${keptCount}"` for the filtered (amount > 0) installment rows in payload order, and `"M${i+1}/${cycles}"` for bounded recurring rows; verified exactly against the unit test oracles (both the 20k/3x-boleto case labelled `1/4..4/4` and the bounded-recurring case labelled `1/1, M1/3, M2/3, M3/3`) and independently re-derived by hand below.
(g) `updateSale` deletes children in the documented FK-safe order (payables, then receivables, then sale professionals, then sale items, each filtered by `and(eq(orgId), eq(saleId))`), re-inserts items/professionals/receivables inside the same `withTenant` transaction, and returns `{ok: false, reason: 'not_editable', status}` for `won|lost|cancelled` without writing anything.
Proven by "update fully replaces items, professionals, and receivables in one transaction" (old rows gone, new rows present, `code`/`sequence` unchanged) and "update is rejected for a won proposta" (row count before/after identical).
Every read and write in `service.ts` for people/products/clients/areas/settings/sales runs inside `withTenant`, which calls `setTenantContext(tx, orgId)`, and every query additionally carries an explicit `eq(table.orgId, orgId)` (or `and(eq(orgId), eq(id))`) filter; confirmed by reading the full file and by the cross-tenant integration test "update returns not_found across tenants", which shows org B cannot touch org A's sale and org A's row survives untouched.
(h) `getSalesOpsSnapshot` now runs a bare `select().from(salesOpsReceivables).where(eq(orgId))` and a bare `select().from(salesOpsSaleProfessionals).where(eq(orgId))`, and returns both under `receivables`/`saleProfessionals`; proven by the integration test "bootstrap snapshot includes receivables", which seeds a sale with a professional and asserts both arrays contain the expected rows via `getSalesOpsSnapshot`. `SalesOpsSnapshot` type was extended with `receivables?: unknown[]` and `saleProfessionals?: unknown[]` as specified. `summarizeSalesOpsState`'s `closedStatuses` is `new Set(['won'])`, proven by unit test "summarizes won sales as closed revenue" (counts `won`, excludes `open`).

## 3. Adversarial math recheck (20k PIX + 3x R$3.333,33 boleto oracle)

Independently recomputed without reading the implementation's intermediate values, using only the plan's stated rates (seller 10%, finder 3%, tax 6%, `pctOf` = floor):

- Item: `unitBrl=2999999`, qty 1 -> `itemsTotalBrl = 2999999`.
- Installments: `2000000 + 333333 + 333333 + 333333 = 2999999`, matches items total (schema accepts).
- Receivable rows: 4 kept rows (`amountBrl>0` for all), labels `1/4..4/4`, methods `pix, boleto, boleto, boleto` preserved in payload order. Matches asserted `ledger.receivables`.
- Seller commission per row (floor of 10%): `200000, 33333, 33333, 33333` -> sum `299999`. Matches asserted `sellerCommissionBrl: 299999`.
- Finder commission per row (floor of 3%): `60000, 9999, 9999, 9999` -> sum `89997`. Matches asserted `finderCommissionBrl: 89997`.
- Tax per row (floor of 6%): `120000, 19999, 19999, 19999` -> sum `179997`. Matches asserted `taxBrl: 179997`.
- `netMarginBrl = 2999999 - 299999 - 89997 - 0(professionals) - 0(otherCosts) - 179997 = 2430006`. Matches asserted `netMarginBrl: 2430006`.
- `netMarginPct = (2430006/2999999)*100 = 81.00003...% -> toFixed(2) = "81.00"`. Matches asserted `netMarginPct: '81.00'`.
- Legacy columns: `paymentMethod = installments[0].method = 'pix'`; `condition = 'installments'` (no recurring, length 4 > 1); `installments = 4` (raw payload length). All match.

The asserted totals are independently reproducible floored per-row sums from the plan's own formulas, not values back-derived from the implementation; the test is a genuine oracle.
The companion `materializeWonPayables` oracle (test "materializeWonPayables links per-row payables and skips voided rows") was cross-checked the same way against its own inputs (seller 10/finder 3/tax 6, receivable r2 voided): `r1` yields `200000/60000/120000`, `r3` and `r4` each yield `33333/9999/19999`, the voided `r2` yields nothing, and `professional_cost 240000`/`other_cost 60000` land once at `wonDate` with `receivableId: null`. All figures check out by hand.

## 4. Command results

- `pnpm run lint`: passes clean across `apps/api` and `apps/web` (eslint, no errors, no warnings printed).
- `pnpm run type-check`: passes clean across `shared-types`, `shared-utils`, `apps/api`, `apps/web` (`tsc --noEmit`, no errors).
- `CI=true pnpm test`: full monorepo unit suite passes, 21 API test files / 199 tests green, 15 web test files / 91 tests green, 1 shared-utils file / 17 tests green, and the tracked-file legacy-auth guard (`scripts/no-legacy-auth.mjs`) ran without failing the pipeline (exit code 0 on the whole `pnpm test` invocation).
- `pnpm --filter @fxl-sales/api test:integration` (with `VITEST_INTEGRATION=1`, against local Docker Postgres on port 5006): full integration suite passes, 11 files / 41 tests green, including the new `test/rls/proposal-write.test.ts` with all 7 named oracle tests green (create-without-payables, create-won-materializes-payables, update-full-replace, update-rejected-for-won, update-not-found-cross-tenant, create-rejects-product-without-area, bootstrap-snapshot-includes-receivables).
- `pnpm run build`: full monorepo build (api `tsc && tsc-alias`, web `tsc --noEmit && vite build`) succeeds with no errors, run as an extra confidence check beyond the four commands explicitly required.

## 5. Security lens

- Every service function that touches tenant data runs inside `withTenant`, which sets the Postgres session tenant context via `setTenantContext(tx, orgId)` before any query, and additionally every query carries an explicit `eq(table.orgId, orgId)` filter (belt-and-suspenders alongside RLS), including the four new `DELETE` statements in `updateSale`.
- `orgId` is sourced exclusively from `c.get('orgId')` in `routes.ts` (set upstream by `appAuthMiddleware`, mounted on `/api/v1/sales-ops/*` in `server.ts`, unchanged by this slice), never from the request body; `CreateSaleSchema`/`UpdateSaleSchema` contain no `orgId`/`workspaceId` field for a client to inject.
- The integration test "update returns not_found across tenants" proves a live cross-tenant write attempt (org B updating org A's sale id) is rejected with `not_found` and org A's data is provably untouched afterward, which is the strongest evidence available that the tenancy filtering works end-to-end against real RLS, not just in mocked unit tests.
- All DB access goes through Drizzle's query builder with parameterized values (`eq`, `inArray`, `.values(...)`); no raw string-interpolated SQL was introduced in `service.ts`. The new integration test file uses tagged-template `postgres` calls (`adminClient\`...\``) for verification/seeding only, which are parameterized by the `postgres` driver, not string concatenation.
- `resolveSaleItemContexts` treats a product item's server-derived area as authoritative and ignores any client-supplied `areaId` on product items (per the plan's locked decision), preventing a caller from attaching a product's items to an area of the caller's choosing.
- Neither `POST /sales` nor `PUT /sales/:id` gained `requireAdmin`, but this exactly matches the pre-existing `POST /sales` gating (confirmed by diffing against the parent commit's `routes.ts`) and is explicitly called out as out of scope by the plan; no regression introduced.
- No secrets, credentials, or environment values are logged or echoed in the new code paths.

## Conclusion

All five plan files were touched and only those five.
Every contract point (a) through (h) is proven either by a passing unit test, a passing integration test against real Postgres with RLS, or direct code reading, not merely asserted.
The payment-plan and payable-materialization math oracles were independently re-derived by hand and match the asserted test values exactly.
Lint, type-check, the full unit test suite, the full integration test suite, and the production build all pass with zero failures.
