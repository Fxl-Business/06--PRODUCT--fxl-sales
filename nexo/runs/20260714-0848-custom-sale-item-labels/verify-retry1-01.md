# Gate 2 Retry 1 Verification: 01-custom-sale-item-labels

## Verdict

PASS.
The complete branch at `b24e33ef10011bf9c67658ffd4077e207b76521a` satisfies the acceptance contract, and every requested automated check passes.

## Acceptance review

- PASS: The API trims `items[].productName`, rejects blank names, and enforces a 140-character maximum through `z.string().trim().min(1).max(140)` in `apps/api/src/domains/sales-ops/service.ts:109`.
- PASS: Repeated open-price rows retain the same original `productId`, preserve their array order, and persist each independent label as `productNameSnapshot` through the ordered ledger mapping in `apps/api/src/domains/sales-ops/service.ts:322`.
- PASS: The wizard review preserves row order with `items.map(saleItemDisplayName)`, and payload creation preserves the same order with `items.map` in `apps/web/src/sales-ops/SalesOpsApp.tsx:3064` and `apps/web/src/sales-ops/SalesOpsApp.tsx:3712`.
- PASS: Every open-price row requires a non-blank trimmed label and a negotiated unit value greater than zero before the first wizard step advances in `apps/web/src/sales-ops/SalesOpsApp.tsx:2866`.
- PASS: Incomplete drafts fall back to the catalog name when the custom label is blank through `saleItemDisplayName` in `apps/web/src/sales-ops/SalesOpsApp.tsx:2960`.
- PASS: Fixed-price products always use the catalog name, and changing products clears stale custom-label state in `apps/web/src/sales-ops/SalesOpsApp.tsx:2962` and `apps/web/src/sales-ops/SalesOpsApp.tsx:2972`.
- PASS: Deleting one repeated row preserves the surviving row's label and negotiated value, as covered by the focused web test.
- PASS: Every repeated row now exposes unique accessible names for product, quantity, unit value, custom label, and removal controls.
- PASS: Quantity inputs specifically use `Quantidade do item ${index + 1}` in `apps/web/src/sales-ops/SalesOpsApp.tsx:3310`.
- PASS: The focused web test locks the unique quantity names by requiring both `Quantidade do item 1` and `Quantidade do item 2` in `apps/web/src/sales-ops/__tests__/sale-wizard-custom-item-labels.test.tsx:208`.
- PASS: No schema or migration file is changed.
- PASS: The external request shape is unchanged because custom labels continue to travel through the existing `items[].productName` field, while `customLabel` remains local form state.
- PASS: No deduplication is introduced because the web payload, review, and API ledger all retain ordered array mapping.
- PASS: No unsafe HTML API is introduced because labels render as ordinary React text content.
- PASS: No existing test assertion is removed or weakened, and retry commit `b24e33e` adds focused accessibility assertions without altering prior coverage.

## Requested command evidence

- PASS: `pnpm --filter @fxl-sales/api test src/domains/sales-ops/__tests__/service.test.ts` completed with 1 file and 4 tests passed.
- PASS: `pnpm --filter @fxl-sales/web test src/sales-ops/__tests__/sale-wizard-custom-item-labels.test.tsx` completed with 1 file and 5 tests passed.
- PASS: `pnpm --filter @fxl-sales/api lint` exited 0.
- PASS: `pnpm --filter @fxl-sales/web lint` exited 0.
- PASS: `pnpm --filter @fxl-sales/api type-check` exited 0.
- PASS: `pnpm --filter @fxl-sales/web type-check` exited 0.
- PASS: `git diff --check master...HEAD` exited 0 with no output.

Each requested command was run once in the slice worktree on branch `feat/01-custom-sale-item-labels`.
No persistent process remained after verification.
