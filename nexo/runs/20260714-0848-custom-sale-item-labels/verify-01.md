# Gate 2 Verification: 01-custom-sale-item-labels

## Verdict

FAIL.
All requested automated checks pass, but the explicit requirement for accessible repeated controls is not satisfied.

## Blocking finding

### Repeated quantity controls have no accessible name

Each sale-item row renders the quantity as an `<input type="number">` without an `aria-label`, associated `<label>`, or `aria-labelledby` reference in `apps/web/src/sales-ops/SalesOpsApp.tsx:3309`.
The visual `Qtd.` column header is a plain `<span>` and is not programmatically associated with the row inputs.
As a result, assistive technology encounters one or more unnamed `spinbutton` controls and cannot distinguish the quantity for item 1 from the quantity for item 2.
The new focused web test queries the named product, price, custom-label, and remove controls, but it does not assert an accessible name for the repeated quantity controls.
This fails the acceptance check for accessible repeated controls.

## Acceptance review

- PASS: API normalization and maximum length are enforced by `z.string().trim().min(1).max(140)` in `apps/api/src/domains/sales-ops/service.ts:109`, and the focused API test covers trimming, blank rejection, and 141-character rejection.
- PASS: Repeated labels retain the same original `productId`, preserve array order, and map each label to `productNameSnapshot` through the existing `input.items.map` ledger path in `apps/api/src/domains/sales-ops/service.ts:322`.
- PASS: The review uses `items.map(saleItemDisplayName)` in row order, and payload creation uses the same ordered `items.map` without deduplication in `apps/web/src/sales-ops/SalesOpsApp.tsx:3064` and `apps/web/src/sales-ops/SalesOpsApp.tsx:3711`.
- PASS: Every open-price row must have a non-blank trimmed label and a parsed unit value greater than zero before step one advances in `apps/web/src/sales-ops/SalesOpsApp.tsx:2866`.
- PASS: Draft submission falls back to the catalog name when a custom label is blank through `saleItemDisplayName` in `apps/web/src/sales-ops/SalesOpsApp.tsx:2960`.
- PASS: Fixed-price products always use the catalog name, and changing products clears stale `customLabel` state in `apps/web/src/sales-ops/SalesOpsApp.tsx:2962` and `apps/web/src/sales-ops/SalesOpsApp.tsx:2972`.
- PASS: Deleting one repeated row preserves the surviving row's controlled state, as covered by the focused web test.
- FAIL: The repeated quantity input lacks an accessible name, so the repeated-controls accessibility requirement is incomplete.
- PASS: No schema or migration file is changed.
- PASS: The external request shape is not expanded; custom labels continue to travel through the existing `items[].productName` field, while `customLabel` remains local form state.
- PASS: No deduplication is introduced; ordered array mapping is retained on the web and API paths.
- PASS: No unsafe HTML API is introduced; labels are rendered as React text content.
- PASS: No existing test assertion is removed or weakened; the API test file only gains cases and the web oracle is a new test file.

## Requested command evidence

- PASS: `pnpm --filter @fxl-sales/api test src/domains/sales-ops/__tests__/service.test.ts` completed with 1 file and 4 tests passed.
- PASS: `pnpm --filter @fxl-sales/web test src/sales-ops/__tests__/sale-wizard-custom-item-labels.test.tsx` completed with 1 file and 5 tests passed.
- PASS: `pnpm --filter @fxl-sales/api lint` exited 0.
- PASS: `pnpm --filter @fxl-sales/web lint` exited 0.
- PASS: `pnpm --filter @fxl-sales/api type-check` exited 0.
- PASS: `pnpm --filter @fxl-sales/web type-check` exited 0.
- PASS: `git diff --check master...HEAD` exited 0 with no output.

All commands were run once in the slice worktree on branch `feat/01-custom-sale-item-labels`.
No persistent process remained after verification.
