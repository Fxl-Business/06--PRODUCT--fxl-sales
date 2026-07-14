# Execute 01 - Custom sale item labels

Status: PASS

## RED evidence

The API oracle ran first and failed 2 of 4 tests because `productName` retained surrounding whitespace and accepted blank input.
The rendered web oracle then ran before implementation and failed all 5 tests because the custom-label controls, per-row validation messages, and accessible repeated-row controls did not exist.

## GREEN evidence

The API oracle passed 4 of 4 tests after changing only the existing Zod `productName` boundary to trim and enforce a 140-character maximum.
The rendered web oracle passed 5 of 5 tests after wiring independent row labels, validation, draft fallback, review ordering, fixed-product reset behavior, deletion state, and accessible control labels.
No database schema, migration, API client, or shared request type changed.

## Verification

- `pnpm --filter @fxl-sales/api test src/domains/sales-ops/__tests__/service.test.ts` - PASS, 4 tests.
- `pnpm --filter @fxl-sales/web test src/sales-ops/__tests__/sale-wizard-custom-item-labels.test.tsx` - PASS, 5 tests.
- `pnpm --filter @fxl-sales/api lint` - PASS.
- `pnpm --filter @fxl-sales/web lint` - PASS.
- `pnpm --filter @fxl-sales/api type-check` - PASS.
- `pnpm --filter @fxl-sales/web type-check` - PASS.
- `git diff --check` - PASS.
- Browser E2E and pixel QA - BLOCKED because browser runtime discovery returned no available browser backend.
- The temporary worktree Vite server was stopped, and no worktree-owned watcher or server remained.

## Commit

`0d8b17bbdf714b8ba67288e13d5553de4a815c82 feat(sales): label custom sale items`

## Files touched

- `apps/api/src/domains/sales-ops/service.ts`
- `apps/api/src/domains/sales-ops/__tests__/service.test.ts`
- `apps/web/src/sales-ops/SalesOpsApp.tsx`
- `apps/web/src/sales-ops/__tests__/sale-wizard-custom-item-labels.test.tsx`
