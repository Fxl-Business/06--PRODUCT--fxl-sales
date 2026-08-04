# exec-05 notes - 05-professional-split-core

Branch `feat/05-professional-split-core`. One commit, no dependencies.

## What shipped

- `packages/shared-utils/src/professional-split.ts`: `SPLIT_BP_TOTAL`, `splitCentsByWeights`, `defaultSplitBp`, `isRecurringReceivableLabel`, `resolveProfessionalSplit`, plus the `SplitReceivable` / `ProfessionalSplitPart` / `ResolveProfessionalSplitInput` types, exactly as specified in section 2 of the slice plan.
- `packages/shared-utils/src/index.ts`: `export * from './professional-split.js';` added beside the existing `./sale-financials.js` line.
- `packages/shared-utils/package.json`: `"./professional-split"` subpath entry added to `exports`, byte-for-byte the shape of the existing `"./sale-financials"` entry.
- `packages/shared-utils/src/__tests__/professional-split.test.ts`: 57 tests covering every case named in section 3 of the plan, including the two load-bearing ones.

## Red -> green

Ran the test file before the module existed: it failed on `Cannot find module '../professional-split.js'` (the expected first red - a missing-export failure, not an assertion failure). Implemented the module per the plan's algorithm verbatim, then reran: 57/57 passed, each on its own assertion.

## The two load-bearing tests

- **Equivalence with `splitInstallmentsEqually`**: for `totalCents` in `[123, 1000, 999999, 123456789]` crossed with `n` in `[1, 2, 3, 7, 12]`, asserts `splitCentsByWeights(total, Array(n).fill(1))` equals the exact same floor/remainder formula `splitInstallmentsEqually` uses (`apps/web/src/sales-ops/calculations.ts:468-481`), read directly rather than imported (the web module is not importable from `packages/shared-utils`).
- **Exhaustive sum invariant**: `resolveProfessionalSplit` looped over part counts 1..6 crossed with parcela counts 1..6 crossed with four costs (`1`, `999999`, `1_000_000`, `2_147_483_647`), asserting `Σ parts === costBrl` in every one of the 144 combinations.

Also included a 20-row weight-vector table (thirds, skewed, prime, zero-containing, large-skew, all-zero-but-one, weights-sum-greater-than-total, etc.) driving both the exact-sum and non-negative-part assertions via `it.each`.

## Notes on implementation

- `splitCentsByWeights`: `W <= 0` returns all-zero-except-last (`[0, ..., totalCents]`), matching the plan's stated degenerate limit.
- `resolveProfessionalSplit` sorts `input.receivables` by `dueDate` (stable, lexicographic since ISO `YYYY-MM-DD`), does NOT filter - the caller owns excluding void/recurring rows, per the plan.
- The `m === 0` fallback returns the single legacy one-shot part verbatim.
- Fold step (`weights.length > m`) slices the head and sums the tail into the last folded slot, preserving exact-sum by construction since `splitCentsByWeights` is applied to the folded vector, not reimplemented.
- Doc comment on `splitCentsByWeights` states the overflow bound reasoning from Decision 3 of the overview (basis-point normalization keeps every product inside `Number.MAX_SAFE_INTEGER`).

No deviations from the plan. Module is dead code until slice 06 wires it into `materializeWonPayables`.

## Gates

- `pnpm run build:packages` - green (shared-types, shared-utils both build)
- `pnpm run lint` - green (api, web; shared-types/shared-utils have no lint)
- `pnpm run type-check` - green (build:packages + all 4 packages/apps)
- `pnpm test` - green: shared-utils 80 tests (57 new + 23 pre-existing), api 323, web 519, plus `no-legacy-auth` and `build-contract` checks all passed

All run-once (`vitest run`), no watchers left behind.
