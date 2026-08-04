# Verify — 05-professional-split-core

Branch `feat/05-professional-split-core`, commit `7ed051e`.
Verifier did not read `exec-05-notes.md`, per instruction.

## Scope of the diff

```
$ git diff master...HEAD --stat
 packages/shared-utils/package.json                 |   4 +
 .../src/__tests__/professional-split.test.ts       | 245 +++++++++++++++++++++
 packages/shared-utils/src/index.ts                 |   1 +
 packages/shared-utils/src/professional-split.ts    | 132 +++++++++++
 4 files changed, 382 insertions(+)
```

Two new files (implementation + tests), plus two wiring lines:
`index.ts` gains `export * from './professional-split.js';` appended after
the existing `sale-financials` export (order preserved, nothing else in the
file touched), and `package.json` gains a `./professional-split` subpath
export block mirroring `./sale-financials` exactly. `git log master..HEAD`
shows exactly one commit. Nothing else changed. **Diff is purely additive —
confirmed.**

`grep -rn "professional-split\|resolveProfessionalSplit\|splitCentsByWeights\|defaultSplitBp\|isRecurringReceivableLabel" apps/` returns nothing: no consumer exists yet, matching the stated scope ("nothing consumes it yet").

## Gates (run-once, real tails)

All four green, no watch mode used.

**`pnpm run build:packages`** — `tsc --build --force` for `shared-types` then
`shared-utils`. Clean, no errors.

**`pnpm run lint`** — `eslint src/` for `apps/api` and `apps/web` (packages
have no lint config, unchanged from before this branch). Clean.

**`pnpm run type-check`** — rebuilds packages then `tsc --noEmit` across all
four workspaces. Clean.

**`pnpm test`** — `pnpm -r --if-present test` + tracked-file guard +
build-contract check:
- `packages/shared-utils`: 3 test files, **80 passed** (17 hmac, 6
  sale-financials, **57 professional-split**, all new).
- `apps/api`: 33 files, 323 passed.
- `apps/web`: 45 files, 519 passed.
- `node scripts/no-legacy-auth.mjs` and `node scripts/build-contract.mjs`:
  both `ok`.

No skips, no flakes observed.

## Independent property test (decisive check)

Wrote a throwaway script (`/private/tmp/.../scratchpad/verify-split.mjs`,
deleted after the run) that imports the **built** `dist/professional-split.js`
directly — not the source, not the test file — and:

- independently re-derives the expected vector from the contract stated in
  the task ("every part but the last is `floor(total × wᵢ / Σw)`, the LAST
  part is `total − Σ(the others)`"), written from scratch without looking at
  the implementation's control flow;
- asserts `Σ parts === total` (except the documented `n === 0 → []`
  degenerate case, which has no total to conserve) and `parts[i] >= 0` for
  every case;
- compares its own contract-derived vector to the actual output element-wise.

Coverage: fixed edge cases (empty weights, zero total, zero weights, the
`2_147_483_647` ceiling alone / with a `10_000` bp weight / skewed / with 120
equal weights) plus **4,708 total cases** including 3,000 pure-random
`(total, weights)` pairs up to `2^31`, 500 with zero weights mixed in, 200
all-zero-weight vectors, 200 single-weight vectors, 300 highly skewed
(bp-like, one weight ≈9990 against noise), and 500 proper basis-point
vectors (random partitions summing to exactly 10000).

**Result: 4,708 cases run, 0 mismatches.** Every part non-negative, every sum
exact, every element matched the independently-derived contract vector.

## Anti-drift check

Read `splitInstallmentsEqually` in `apps/web/src/sales-ops/calculations.ts:468-481`
directly:

```ts
const n = Math.max(1, Math.floor(count));
const base = Math.floor(totalCents / n);
// out[i] = base for i < n-1, out[n-1] = totalCents - base * (n-1)
```

Re-implemented that formula verbatim in the scratch script (not imported —
the web app isn't buildable as a standalone ESM import here — but transcribed
character-for-character from the read source) and ran it against
`splitCentsByWeights(total, Array(n).fill(1))` over `n = 1..120` for 12 fixed
totals (0, 1, 2, 3, 100, 999, 1000, 123456, 2_147_483_647, 7, 13, 999999999)
plus 2,000 random `(total, n)` pairs.

**Result: 3,440 cases, 0 mismatches.** Algebraically this must hold — with
equal weights `w`, `floor(total·w / (n·w)) === floor(total/n)` for any `w > 0`
— and the run confirms it holds in the actual JS float/int arithmetic too, at
every scale tested including the `2^31` ceiling. **Anti-drift claim holds.**

## Design conformance — `resolveProfessionalSplit` (Decision 2)

Ran each case directly against the built module (not the shipped test file),
independently:

| # | Case | Result | Verdict |
|---|------|--------|---------|
| 1 | 10k/20k/20k/50k weights, cost 1,000,000 | `[100000, 200000, 200000, 500000]` on r1-r4, sum 1,000,000 | **PASS** — matches the user's own 1k/2k/2k/5k case exactly, bound to the right receivables in order |
| 2 | `[3000, 7000]` override over 3 parcelas | `[300000, 700000]` on `a`, `b` only, length 2 — `c` gets no part at all | **PASS** — third parcela pays nothing |
| 3 | `[10000]` override over 2 parcelas | `[1000000]` on `a` only | **PASS** — entirely from the first parcela |
| 4 | `[2500,2500,2500,2500]` override over 2 parcelas (fold) | `[250000, 750000]` on `a`,`b`; sum 1,000,000 | **PASS** — tail folds into the last parcela (2500+2500+2500 folded onto `b`), exact-sum preserved |
| 5 | Receivables passed out of order (r3, r1, r2) | Parts come back `['r1','r2','r3']` | **PASS** — sorted to due-date order regardless of caller order |
| 6 | Zero eligible receivables | `[{receivableId: null, dueDate: '2026-09-09', amountBrl: 999}]` — exactly one part | **PASS** — fallback one-shot at the given date, full cost |
| 7 | `isRecurringReceivableLabel` | `'M1/12'→true`, `'1/3'→false`, `''→false`, `undefined→false` | **PASS** |

All seven lines PASS.

## Overflow

`splitCentsByWeights` doc comment and code confirm the only multiplication is
`totalCents * weights[i]`, guarded by construction: `defaultSplitBp` is the
sole place a raw amount is used as a weight, and its own total is fixed at
`SPLIT_BP_TOTAL = 10_000` (`defaultSplitBp(amounts) = splitCentsByWeights(10_000, amounts)`
— i.e. it normalizes to bp *before* any caller sees a weight vector).
`resolveProfessionalSplit` only ever passes `costSplitBp` (a stored bp array,
contractually summing to 10000) or `defaultSplitBp(...)` (also bp) into
`splitCentsByWeights` — never a raw receivable amount as a weight against
`costBrl`. Grepped the file: no other multiplication site exists.

Tested the stated ceiling directly: `splitCentsByWeights(2_147_483_647,
[10_000])` (the `total × 10^4` bound at the Postgres-`integer` ceiling) →
`[2147483647]`, exact, no precision loss (`2.147...e13` is far inside
`2^53 ≈ 9.007e15`). Also ran the property test's max-int cases (single
weight, 120 equal weights, `[1, 999999]` skew) at `total = 2^31-1` — all
exact-sum, no overflow artifacts. **Overflow bound holds as claimed.**

## Package wiring

`packages/shared-utils/package.json` `exports` block:

```json
"./professional-split": {
  "types": "./dist/professional-split.d.ts",
  "import": "./dist/professional-split.js"
}
```

Structurally identical in shape to the existing `./sale-financials` entry.
Inspected the **built** `dist/professional-split.js`: zero `import`
statements — it is a fully standalone module (only uses `Array.from`, plain
arithmetic, `.sort`, `.reduce`). Confirmed via
`import('./dist/professional-split.js')` in isolation — resolves cleanly and
exports exactly `SPLIT_BP_TOTAL`, `defaultSplitBp`, `isRecurringReceivableLabel`,
`resolveProfessionalSplit`, `splitCentsByWeights`, nothing else, no
transitive load of `hmac.js` (which is where the Node-only crypto import
lives, per CLAUDE.md's note on why `apps/web` imports the `/sale-financials`
subpath rather than the package root). The root `index.ts` still re-exports
`hmac.js`, so root-import would still pull it in — the subpath is what keeps
professional-split independent, exactly as designed. **Wiring confirmed
correct.**

## Verdict: PASS

- All four gates green, run-once, no leftover processes.
- Independent property test: 4,708 cases, 0 mismatches against the contract
  (not the tests, not the implementation's own logic — a from-scratch
  re-derivation).
- Anti-drift equivalence with `splitInstallmentsEqually` holds: 3,440 cases,
  0 mismatches.
- All 7 design-conformance lines (Decision 2) hold, independently exercised.
- Overflow bound holds at the stated `2^31 × 10^4` ceiling, verified directly.
- Package wiring correct: subpath mirrors `./sale-financials`, built module
  has no imports, does not pull in `hmac.js`.
- Diff is purely additive: two new files + two wiring lines, one commit, no
  existing behaviour touched, no consumer exists yet.
