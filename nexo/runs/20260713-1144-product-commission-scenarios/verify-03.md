# Verify 03 - Product-aware sale defaults

Verdict: **PASS**

Verified `feat/03-product-aware-sale-defaults` at `b9f58400836a2994e450c3c3b736fa05b8334e8f` against base `342fefb8338abce5c99ea9b475cd2cea463f5dad`.
The merge base is the requested base commit, and the feature worktree was clean before and after verification.

## Command evidence

- Named calculation and rendered wizard oracles: PASS.
  `CI=true pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/__tests__/calculations.test.ts src/sales-ops/__tests__/sale-wizard-commission-defaults.test.tsx` passed 9 of 9 tests across 2 files.
- Full web tests: PASS.
  `CI=true pnpm --filter @fxl-sales/web test` passed 53 of 53 tests across 11 files.
- Web lint: PASS.
  `CI=true pnpm --filter @fxl-sales/web lint` exited 0 with no findings.
- Workspace typecheck: PASS.
  `CI=true pnpm type-check` built both shared packages and passed typechecking for shared types, shared utilities, API, and web.
- Production web build: PASS.
  `CI=true pnpm --filter @fxl-sales/web build` typechecked, transformed 1,807 modules, and completed the Vite production bundle.
- Diff whitespace check: PASS.
  `git diff --check 342fefb..b9f5840` exited 0 with no output.
- Focused security and scope inspection: PASS.
  The diff contains only the four declared web files, and scans found no secrets, credential storage, unsafe HTML execution, dynamic execution, network calls, raw SQL, API changes, database changes, migrations, or persistence-contract changes.

## Behavioral acceptance review

- The primary sale item drives product defaults because `primaryItemProduct` is resolved exclusively from `items[0]?.productId`.
  The rendered oracle proves seller-only `10%` changes to seller-with-finder `7%` plus finder `3%` for the same primary product.
- Finder participation drives the scenario because `hasFinderForSale` is the only finder-related input in the defaults source key.
  The rendered oracle proves adding a finder switches to `7% + 3%`, removing the finder restores `10%` plus the organization finder fallback, and both payload snapshots preserve those values.
- Secondary items do not reset commission values because the source key contains no secondary item state.
  The rendered oracle changes the second item to Product B and retains Product A's `7% + 3%`, then changes the primary item and observes Product B's `8% + 4%`.
- Finder identity does not reset commission values because neither `finderPersonId`, `sellerPersonId`, nor `sellerIsFinder` identity is present in the source key.
  Identity changes while finder participation remains true therefore leave the source key and current commission fields unchanged.
- Zero is preserved because percentage values are parsed with a finite-number check rather than nullish or truthy fallback logic.
  The calculation oracle explicitly proves a product seller percentage of string `"0"` resolves to numeric `0`.
- Fixed product sides fall back independently because seller and finder values are resolved through separate `percentageOrFallback` calls.
  The calculation oracle proves a fixed seller-with-finder side falls back to organization seller `9%` while the percentage finder side remains product `3%`.
- Primary removal is covered by the implementation path.
  Item removal filters the array, the next item becomes `items[0]`, and the primary product in the source key changes so defaults recompute for the newly promoted primary item; removing the sole item resolves an undefined product and therefore organization fallbacks.
- No API or database contract changed.
  `git diff --name-only 342fefb..b9f5840` lists only `SalesOpsApp.tsx`, `calculations.ts`, and their two web tests, while payload construction continues to use the existing `CreateSalePayload` and existing percentage fields.

## Visual QA limitation

The browser backend was unavailable by contract, so live browser visual verification is marked manual and is not treated as a code failure.
The rendered happy-dom oracle verifies the user-visible commission values, finder interaction, primary versus secondary product behavior, and saved payload snapshots.
Manual browser QA remains required to confirm the visible `10%` seller-only state and `7% + 3%` finder state, along with layout and focus treatment in a real browser.
