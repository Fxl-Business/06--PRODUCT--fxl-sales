# Product Commission Scenario Mutation Verification

Verdict: **PASS**

The required behavioral mutation was killed by the locked focused tests.

## Mutation

The disposable detached worktree was created from `master` at `cb65cccd3871cabd0237f8968a2fa0f0aafde14f`.
In `apps/web/src/sales-ops/calculations.ts`, the seller-only branch of `resolveSaleCommissionDefaults` was changed to read `sellerWithFinderCommissionType` and `sellerWithFinderCommissionValue` instead of the seller-only fields.
No test or production file in the main checkout was modified.

## Locked focused test run

Command:

```text
pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/__tests__/calculations.test.ts src/sales-ops/__tests__/sale-wizard-commission-defaults.test.tsx
```

The command was run exactly once after applying the mutation.
It exited with code 1, which is the expected outcome for a killed mutation.
Vitest reported 2 failed test files, 3 failed tests, and 6 passed tests out of 9 total tests.

Expected mutation-killing failures:

- `calculations.test.ts`: seller-only product percentage expected `10` but received `7`.
- `calculations.test.ts`: seller-only zero commission expected `0` but received `7`.
- `sale-wizard-commission-defaults.test.tsx`: initial seller-only wizard default expected `"10"` but received `"7"`.

These failures prove that the locked tests distinguish seller-only commission defaults from seller-with-finder commission defaults at both calculation and wizard integration levels.

## Cleanup

The mutation was restored before removal.
The disposable worktree had a clean `git status --short` before removal.
`.worktrees/mutation-product-commission-scenarios` was removed and worktree metadata was pruned.
No temporary branch was created because the worktree used detached HEAD.
The single Vitest process exited normally, and no persistent process was started.
