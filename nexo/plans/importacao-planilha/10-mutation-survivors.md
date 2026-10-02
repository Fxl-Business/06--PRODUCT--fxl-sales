---
id: 10-mutation-survivors
milestone: v4.2.0
status: done
depends_on: [07-routes-and-roundtrip, 09.1-web-409-detail]
files_modified:
  - apps/api/src/domains/import/__tests__/plan-propostas.test.ts
  - apps/api/src/domains/import/__tests__/plan-index.test.ts
  - apps/api/src/domains/import/__tests__/executor.integration.test.ts
  - apps/web/src/sales-ops/import/__tests__/import-copy.test.ts
acceptance: "Each of the five mutation survivors reported by the feature mutation run is killed by a new, named test: (1) parcelas summing ABOVE the items total produce a row-level installments_sum_mismatch issue in planPropostas; (2) isPlanOk / planImport treat a file-level error (sheet null, e.g. too_many_rows) as not ok; (3) the executor refuses a settleReceivable op with producer_flow_live when the gate turns live AFTER the pre-scan; (4) the executor refuses a createSale op whose wonOn is after today with won_on_in_future; (5) the errors title is singular for one error and plural for two. No production code changes unless a test exposes a real defect."
goal: "Close the test gaps the manual mutation run found, so the guards they protect cannot silently regress."
must_not_break:
  - apps/api/src/domains/import/__tests__/plan-propostas.test.ts
  - apps/api/src/domains/import/__tests__/plan-index.test.ts
  - apps/api/src/domains/import/__tests__/executor.integration.test.ts
  - apps/web/src/sales-ops/import/__tests__/import-copy.test.ts
rules:
  - "Tests only. If a new test FAILS against the current code, that is a real defect: fix the production code minimally in the same slice, add the file to files_modified in your report, and say so."
  - "Each new test must fail when its mutant is applied: after writing it, apply the mutant by hand, run the test, see it fail, restore the code (git checkout -- <file>), and report that you did this for each of the five."
  - "Never write the literal U+2014 character; integration tests use the local DB only and the cleanup rules of executor.integration.test.ts."
verifier_focus: "That each test targets exactly its survivor (re-apply each mutant and confirm the test goes red), and that no production file changed without a stated defect."
---

# Slice 10 - kill the mutation survivors

The feature mutation run (45/50 killed) left five survivors. None breaks a safety property today, but each is an unpinned guard.

| # | File | Surviving mutant | Test to add |
| --- | --- | --- | --- |
| 1 | `plan/propostas.ts` | `sum !== total` -> `sum < total` in the installments sum check | In `plan-propostas.test.ts`: a full-depth proposta whose Parcelas rows sum to MORE than the items total yields an `installments_sum_mismatch` error on that proposta's row and emits no createSale op. Mirror the existing below-total case. |
| 2 | `plan/index.ts` | `isPlanOk` ignores issues with `sheet === null` | In `plan-index.test.ts`: `isPlanOk` returns false for a plan whose only error has `sheet: null` (e.g. `too_many_rows` / `no_known_sheets`), and `toPreviewBody(...).ok` is false for it. |
| 3 | `executor.ts` | the per-operation `isProducerFlowLive` re-check before `settleReceivable` removed | In `executor.integration.test.ts`: a hand-built plan with a won sale plus a settleReceivable; register a producer gate that returns false for the pre-scan calls and true from the moment the settlement is about to run (count calls, or flip a flag after the createSale op completes by wrapping the gate). Expect `ImportExecutionError` with reason `producer_flow_live` and zero new rows (reuse the snapshot helper). Restore the gate in afterEach. If the executor's call order makes this impossible to stage without production changes, assert the reason via the smallest seam the file already exposes and explain. |
| 4 | `executor.ts` | the executor's own `won_on_in_future` re-check removed | In `executor.integration.test.ts` (or `executor.test.ts` if it can run without the DB): a hand-built plan with `createSale` status won and `wonOn` = tomorrow relative to the `now` passed in; expect `ImportExecutionError` reason `won_on_in_future` and nothing written. |
| 5 | web `import-copy.ts` | errors title always plural | In `import-copy.test.ts`: the errors title for 1 is the singular form (`1 erro`) and for 2 the plural (`2 erros`); read the real copy function name from the file. |

## Commands (run once)

- `pnpm --filter @fxl-sales/api exec vitest run src/domains/import/__tests__/plan-propostas.test.ts src/domains/import/__tests__/plan-index.test.ts`
- `pnpm --filter @fxl-sales/api test:integration src/domains/import/__tests__/executor.integration.test.ts` (local DB env from the main checkout's apps/api/.env)
- `pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/import`
- eslint on the four test files; API and web type-check.

Commit: `test(import): pin the guards the mutation run left unprotected`.
