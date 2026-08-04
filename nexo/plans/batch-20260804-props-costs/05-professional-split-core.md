---
id: 05-professional-split-core
milestone: v2.4.0
status: todo
depends_on: []
files_modified:
  - packages/shared-utils/src/professional-split.ts
  - packages/shared-utils/src/index.ts
  - packages/shared-utils/package.json
  - packages/shared-utils/src/__tests__/professional-split.test.ts
acceptance: "given a professional costing R$ 10.000,00 on a plan of R$ 10k/20k/20k/50k, when resolveProfessionalSplit runs with costSplitBp null, then it returns four parts of 100000/200000/200000/500000 cents bound to those four receivables in due-date order and summing to exactly 1000000."
---

## 1. Current behaviour

There is no split. `apps/api/src/domains/sales-ops/service.ts:942-953` emits one
`professional_cost` draft per professional for the whole `costBrl`, dated
`input.wonDate`, with `receivableId: null`.

The only exact-sum distribution primitive in the repo is
`splitInstallmentsEqually` at `apps/web/src/sales-ops/calculations.ts:383-396`.
It is EQUAL-weight only, it returns dates and methods alongside the amounts, and
it lives in a web-only module the API cannot import. Its rounding contract —
`base = Math.floor(totalCents / n)` for every row but the last, and
`totalCents - base * (n - 1)` for the last — is the discipline this slice
generalizes to arbitrary weights.

The shared-module precedent is `packages/shared-utils/src/sale-financials.ts`,
imported by the API from the package root (`service.ts:1`) and by the web from
the `./sale-financials` subpath declared in
`packages/shared-utils/package.json:20-23`. `apps/web/src/sales-ops/__tests__/sale-margin-parity.test.ts`
exists specifically to pin that both sides get the same numbers. This slice
follows that shape exactly rather than writing the function twice.

## 2. The fix

Create `packages/shared-utils/src/professional-split.ts`.

```ts
export const SPLIT_BP_TOTAL = 10_000;

export function splitCentsByWeights(totalCents: number, weights: number[]): number[];
export function defaultSplitBp(amountsBrl: number[]): number[];
export function isRecurringReceivableLabel(label: string | null | undefined): boolean;

export type SplitReceivable = { id: string; dueDate: string; amountBrl: number };
export type ProfessionalSplitPart = {
  receivableId: string | null;
  dueDate: string;
  amountBrl: number;
};
export function resolveProfessionalSplit(input: {
  costBrl: number;
  costSplitBp: number[] | null | undefined;
  receivables: SplitReceivable[];
  fallbackDueDate: string;
}): ProfessionalSplitPart[];
```

### `splitCentsByWeights(totalCents, weights)`

* `n = weights.length`; `n === 0` → `[]`.
* `W = Σ weights`.
* `W <= 0` → an array of `n` entries, all `0` except the last, which is
  `totalCents`. This is the general formula's own degenerate limit and keeps the
  exact-sum invariant true even when every weight is zero.
* otherwise `out[i] = Math.floor((totalCents * weights[i]) / W)` for
  `i` in `0 .. n-2`, and `out[n-1] = totalCents - Σ out[0..n-2]`.

The LAST entry absorbs the whole floor remainder. Do not distribute the
remainder round-robin, do not `Math.round` anywhere, and do not sort: this is
`splitInstallmentsEqually`'s contract generalized, and the equality between the
two is a test below.

### `defaultSplitBp(amountsBrl)`

`splitCentsByWeights(SPLIT_BP_TOTAL, amountsBrl)`. That is the whole body — the
default weights ARE `10000` distributed across the receivable amounts under the
same contract, so a bp array always sums to exactly `10000`, including the
`Σ amounts === 0` case (which yields `[0, ..., 10000]`).

This function is what caps the arithmetic. It is the ONLY place a raw receivable
amount is ever used as a weight, and its total is the constant `10000`, so
`totalCents * weights[i]` there is at most `10^4 × 2^31 ≈ 2.1 × 10^13`. Every
other call to `splitCentsByWeights` passes bp, where `W === 10000` and the
product is at most `2^31 × 10^4`. Both are inside `Number.MAX_SAFE_INTEGER`.
Write that reasoning into the doc comment.

### `isRecurringReceivableLabel(label)`

`return (label ?? '').startsWith('M');`

Character for character what `deriveWizardPrefill` already does at
`apps/web/src/sales-ops/SalesOpsApp.tsx:5226-5227`. It moves here because the
API now needs the same predicate, and CLAUDE.md calls the `M` prefix
load-bearing. Do NOT refactor `deriveWizardPrefill` to call it in this slice —
that code splits rows into two arrays in one pass and the change buys nothing.

### `resolveProfessionalSplit(input)`

1. `eligible` = `input.receivables` sorted ASCENDING by `dueDate` with a STABLE
   sort (`[...input.receivables].sort((a, b) => a.dueDate < b.dueDate ? -1 : a.dueDate > b.dueDate ? 1 : 0)`).
   The sort lives here, not at the call sites, so both callers are correct
   regardless of the order their query returned. `dueDate` is an ISO `YYYY-MM-DD`
   string, so lexicographic ordering IS chronological ordering.
   The caller is responsible for having already excluded void and recurring rows.
2. `m = eligible.length`. If `m === 0`, return
   `[{ receivableId: null, dueDate: input.fallbackDueDate, amountBrl: input.costBrl }]`
   — the legacy one-shot, preserved verbatim as the degenerate branch.
3. `weights` = `input.costSplitBp` when it is a non-empty array, else
   `defaultSplitBp(eligible.map((r) => r.amountBrl))`.
4. If `weights.length > m`: `folded = [...weights.slice(0, m - 1), weights.slice(m - 1).reduce((a, b) => a + b, 0)]`.
   Else `folded = weights`. (When `m === 1` this correctly yields a single entry
   holding the whole sum.)
5. `parts = splitCentsByWeights(input.costBrl, folded)`.
6. Return `parts.map((amountBrl, i) => ({ receivableId: eligible[i]!.id, dueDate: eligible[i]!.dueDate, amountBrl }))`.

Note `folded.length <= m` always holds after step 4, so `eligible[i]` is never
`undefined`.

### Wiring

* `packages/shared-utils/src/index.ts` — add `export * from './professional-split.js';`
  beside the existing `./sale-financials.js` line. This is what the API imports
  through.
* `packages/shared-utils/package.json` — add a `"./professional-split"` entry to
  `exports`, byte-for-byte the shape of the existing `"./sale-financials"` entry.
  This is what the web imports through, and it exists for the reason CLAUDE.md
  gives: the package root also re-exports the Node-only hmac module.

## 3. The named oracle test

File: `packages/shared-utils/src/__tests__/professional-split.test.ts`

Run once:

```
pnpm --filter @fxl-sales/shared-utils exec vitest run src/__tests__/professional-split.test.ts
```

(The package's `test` script is `vitest run` and its config includes
`src/**/__tests__/**/*.test.ts`. Tests run against SOURCE, so no build step is
needed for this slice.)

`describe('splitCentsByWeights')`

* `it('puts the whole floor remainder on the last part so the sum is exact')` —
  `splitCentsByWeights(1000, [1, 1, 1])` → `[333, 333, 334]`.
* `it('reproduces splitInstallmentsEqually exactly for equal weights')` — for
  `totalCents` over `[123, 1000, 999999, 123456789]` and `n` over `[1, 2, 3, 7, 12]`,
  assert `splitCentsByWeights(total, Array(n).fill(1))` equals
  `[...Array(n)].map((_, i) => i === n - 1 ? total - Math.floor(total / n) * (n - 1) : Math.floor(total / n))`.
  This is the anti-drift assertion against
  `apps/web/src/sales-ops/calculations.ts:383-396`.
* `it('is exact-sum for every weight vector')` — a table of ~20 hand-written
  `(total, weights)` pairs including skewed, prime and zero-containing vectors;
  assert `Σ out === total` for each.
* `it('never emits a negative part')` — same table; assert `out.every(v => v >= 0)`.
* `it('gives the whole total to the last part when every weight is zero')` —
  `splitCentsByWeights(500, [0, 0, 0])` → `[0, 0, 500]`.
* `it('returns an empty array for an empty weight vector')`.
* `it('keeps the product inside MAX_SAFE_INTEGER at the domain ceiling')` —
  `splitCentsByWeights(2_147_483_647, [10_000])` → `[2147483647]`, and
  `Number.isSafeInteger` on the intermediate is implied by the exact result.

`describe('defaultSplitBp')`

* `it('always sums to exactly 10000')` — over amount vectors including
  `[10, 20, 20, 50]` (→ `[1000, 2000, 2000, 5000]`), `[1, 1, 1]`,
  `[999999, 1]`, and `[0, 0]` (→ `[0, 10000]`).

`describe('resolveProfessionalSplit')`

* `it('distributes a cost pro rata over the parcelas — the 10k/20k/20k/50k case')` —
  THE acceptance test. `costBrl: 1_000_000`, `costSplitBp: null`, receivables
  `r1..r4` at 1000000 / 2000000 / 2000000 / 5000000 cents on ascending dates.
  Assert the parts are `100000 / 200000 / 200000 / 500000` bound to `r1..r4`,
  each carrying its own receivable's `dueDate`, summing to `1000000`.
* `it('honours a 30/70 override and leaves the third parcela unpaid')` —
  three parcelas, `costSplitBp: [3000, 7000]`, cost `1_000_000` → two parts of
  `300000` and `700000` on `r1` and `r2`, and NO part for `r3`.
* `it('pays a one-part override entirely out of the first parcela')` —
  `costSplitBp: [10000]` over three parcelas → one part on `r1` for the full
  cost.
* `it('folds the tail of an override that has more parts than parcelas')` —
  `costSplitBp: [2500, 2500, 2500, 2500]` against two parcelas → two parts,
  `25%` and `75%`, exact-sum.
* `it('orders by due date regardless of the order the caller passed')` — pass the
  receivables shuffled; assert the parts come back chronological.
* `it('falls back to a single unlinked part when there is no eligible receivable')` —
  `receivables: []`, `fallbackDueDate: '2026-07-29'` → exactly
  `[{ receivableId: null, dueDate: '2026-07-29', amountBrl: costBrl }]`.
* `it('sums to cost_brl for every override and every parcela count')` — a loop
  over part counts 1..6 crossed with parcela counts 1..6 and a couple of costs;
  assert `Σ parts === costBrl` every time. This is the invariant slice 06 leans
  on to keep `net_margin_brl` unmoved.
* `it('treats a zero part as a parcela that pays nothing')` —
  `costSplitBp: [0, 10000]` → `[0, costBrl]`.

`describe('isRecurringReceivableLabel')`

* `it('reads the M prefix as recurring and everything else as an installment')` —
  `'M1/12'` true, `'1/3'` false, `''` false, `undefined` false.

## 4. Scope limits (YAGNI)

* No API change, no schema change, no UI change. This slice is one file, its
  two wiring lines and its tests.
* Do NOT refactor `splitInstallmentsEqually` to call `splitCentsByWeights`. It
  returns dates and methods, its callers are the step-2 plan builder, and the
  equality between the two is PINNED BY A TEST rather than by a shared body —
  which is the safer arrangement while step 2 is being reworked in sibling
  slices.
* Do NOT refactor `deriveWizardPrefill` to call `isRecurringReceivableLabel`.
* No cents-denominated override representation. Basis points are the only
  weight space; see `00-OVERVIEW-split.md` Decision 1.
* No `Intl` formatting, no i18n, no React. This module is pure arithmetic.

## 5. CLAUDE.md edits

None in this slice. The prose that must change describes persisted behaviour and
belongs with slice 06, which is what actually changes it. Landing the doc edit
here would describe a payable shape that does not exist yet.

## 6. Risk / invariants touched

* **Invariant introduced:** `Σ splitCentsByWeights(t, w) === t` for every input.
  Everything downstream — the persisted `net_margin_brl`, the payables total, the
  wizard's margin panel — depends on it.
* **Invariant preserved:** `splitInstallmentsEqually`'s output for equal weights.
  Pinned by a direct test so the two rounding rules cannot silently diverge.
* **Risk: floating-point.** `Math.floor(a * b / c)` is exact only while `a * b`
  is a safe integer. Mitigated structurally by normalizing every weight vector to
  basis points first, and asserted at the domain ceiling.
* **Risk: nothing consumes this yet.** The module is dead code until slice 06.
  That is deliberate — it makes 05 reviewable as pure arithmetic with no
  migration and no payable semantics in the diff.
* `pnpm run build:packages` must succeed before slices 06 and 07 can run their
  suites, because both resolve this package to `dist`.
