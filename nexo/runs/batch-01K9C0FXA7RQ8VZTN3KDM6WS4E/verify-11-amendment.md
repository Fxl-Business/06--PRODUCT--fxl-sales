# Verify 11 - amendment re-verify (Gate 2)

Branch `feat/11-payment-plan-builder`, commit `39103eb` on `f9f869c`.
Narrow re-verify of the amendment `aebf8ce..39103eb`.

**Verdict: PASS.**

## 1. Gates

All run locally, exit codes captured explicitly.

| Gate | Exit | Result |
| --- | --- | --- |
| `pnpm run lint` | 0 | clean |
| `pnpm run type-check` | 0 | clean |
| `CI=true pnpm test` | 0 | web 35 files / 320 tests, api 27 / 283, shared-utils 1 / 17 |
| `pnpm run build` | 0 | built |

Counts match the expected figures exactly.
No `it.skip` / `it.only` / `describe.skip` / `.todo` anywhere in `apps/web/src`, `apps/api/src`, `packages/shared-utils`.
The suite was re-run after all probes were reverted and returned the identical 35/320, 27/283, 1/17.

## 2. Scope of the amendment

`git diff --stat aebf8ce..39103eb` touches exactly four files:

- `CLAUDE.md` (5 lines)
- `apps/web/src/sales-ops/SalesOpsApp.tsx` (9 lines - import added, duplicate function deleted)
- `apps/web/src/sales-ops/__tests__/payment-plan-generation.test.ts` (98 lines added)
- `apps/web/src/sales-ops/calculations.ts` (30 lines)

The `calculations.ts` change is precisely: add `maxRemainingInstallments`, have `restanteCountFor` clamp against it, delete the `.slice`, rewrite the doc comment.
**Nothing else in the payment-generation logic changed**, so the previous PASS transfers.
`apps/api/**` and `packages/**` are untouched across the whole branch (`git diff --name-only f9f869c..39103eb -- apps/api packages` returns 0 files).

## 3. Is the invariant in the right place?

I called `generateInstallmentPlan` **directly**, bypassing `wizardPlanShape`, via a temporary probe test.

- **`restanteCount: 120` across all modes**: 16 totals (1, 2, 3, 7, 99, 100, 101, 999, 1000, 100000, 100001, 123457, 999999937, 100000000, 100000001, 2147483647) x 8 entrada configurations (`none`; `pct` at 10 / 33.33 / 0.0001 / 99.9999 / 100; `fix` at 1 / 33333) = 128 direct calls. Every sum exact, every row count in `[1, 120]`, every amount a non-negative integer.
- **Hostile direct inputs**: 7 totals (incl. `-5` and `NaN`) x 13 entrada configs (incl. negative, `NaN`, `Infinity`, entrada equal to total, entrada above total) x 15 counts (incl. `-1000`, `0`, `0.5`, `121`, `9999`, `1e9`, `NaN`, `±Infinity`, `MAX_SAFE_INTEGER`) = 1365 direct calls. Every sum equals `max(0, floor(total))` exactly. No call lost or invented a cent.
- **Entrada >= total**: returns exactly one row equal to the total, no phantom zero-cent parcela.
- **Exhaustive count sweep**: counts 1..300 x 3 modes against an indivisible total (1000003). Row count is always exactly `(entrada > 0 ? 1 : 0) + min(count, maxRemainingInstallments(mode))`, always `<= 120`, sum always exact.

**No truncation path survives.** The `.slice` is gone and the array is returned unmodified. Algebraically the length is `(entrada>0?1:0) + min(count, ceiling(mode))`, which is 120 for `none` (no entrada row) and at most `1 + 119 = 120` for `pct`/`fix`, so the cap is structurally satisfied rather than enforced after the fact.

**Single definition confirmed.** `maxRemainingInstallments` is declared once, at `apps/web/src/sales-ops/calculations.ts:251`, and consumed at `calculations.ts:257` and `SalesOpsApp.tsx:3284, 3357, 4750, 6128`. No second copy anywhere in the repo.

Remaining `MAX_PLAN_INSTALLMENTS` references are a different axis and not duplicates of the rule: recurring-cycle inputs (`SalesOpsApp.tsx:3393, 3831, 6190`) and `defaultPlanShapeForProduct` (`calculations.ts:426`).

*Observation, not a defect:* `defaultPlanShapeForProduct` clamps `restanteCount` to the raw 120 rather than to the entrada-aware ceiling, so a product template carrying an entrada plus `defaultRemainingInstallments: 120` would seed the header input with 120 while generation uses 119. Money stays exact either way (`restanteCountFor` clamps downstream), the produto cadastro clamps on save so such a row cannot be created through the UI, and this line predates the amendment and was inside the previously-passed scope. Flagged for awareness only.

### The fix is load-bearing, not cosmetic

I reconstructed the pre-amendment behaviour (restored the `MAX_PLAN_INSTALLMENTS` clamp in `restanteCountFor` **and** the `.slice`) and re-ran the direct-call probe. It failed with `expected 100000 to be 100001` and `expected 1 to be 2` - i.e. the old pure function genuinely lost cents on a direct call. The amendment closes a real money bug.

## 4. Ruling on the dead-`.slice` argument: **UPHELD**

Three experiments:

1. **Re-added `.slice(0, MAX_PLAN_INSTALLMENTS)`** -> full web suite **green** (36 files / 329 tests, including my 9 probes).
2. **Tightened it to `.slice(0, MAX_PLAN_INSTALLMENTS - 1)`** -> **Red**, and critically the repo's *own committed* test `generateInstallmentPlan > stays exact and within the row cap when the restante count is at the ceiling` failed, not only my probes. This proves the 120-row boundary **is** covered by the committed suite.
3. **Implementer's mutation (`restanteCountFor` ignores the entrada)** -> **Red** with `expected 121 to be less than or equal to 120`, from the same committed test.

Experiments 2 and 3 pin the boundary from both directions. The green in experiment 1 is therefore an **equivalent mutant** - `slice(0, 120)` cannot drop a row because 120 is the maximum achievable length - and not a coverage gap. An equivalent mutant is not a defect. The implementer's reasoning is correct and honestly stated.

## 5. Is the CLAUDE.md sentence true?

All three cases run against the code, not read.

| Case | Result |
| --- | --- |
| no-entrada `[33334, 33333, 33333]`, total 100000 | `{entradaMode: 'fix', entradaValue: 33334, restanteCount: 2}`, `matchesFormula: true`; regeneration reproduces `[33334, 33333, 33333]` exactly |
| with-entrada `[50000, 16668, 16666, 16666]`, total 100000 | `matchesFormula: false` |
| evenly divisible `[30000, 30000, 30000]`, total 90000 | `{entradaMode: 'none', restanteCount: 3}`, `matchesFormula: true` |

**The with-entrada branch is general, not incidental.** I simulated the API's remainder-first generator and swept **195,807** with-entrada plans whose restante does not divide evenly (totals 1000-6000, 11 entrada percentages, counts 2-6). **Zero** matched as a formula. A second independent sweep of 2212 cases agreed. The mechanism is as the implementer describes: candidate 1 needs a zero remainder, and candidates 2 and 3 place the remainder last, so any non-zero remainder mismatches all three.

**Other sentences in the touched section verified:**

- "`materializeDefaultPaymentPlan` puts that remainder on the FIRST restante row" - confirmed at `apps/api/src/domains/sales-ops/service.ts:527`, `amountBrl: i === 1 ? base + rest : base`. True.
- "that is inert today because the function has no production caller" - `grep` finds only the function definition and its own test file. True.
- "Both cases are pinned in `payment-plan-generation.test.ts`" - true, and proven by 5b below.
- "a false positive is impossible" - 25,000 randomised row sets, 9019 inferred as formulas, **every one** regenerated to byte-identical amounts and due dates. No false positive.
- "three ordered candidates (`none`, a clean percentage, a fixed value)" - matches the code.
- The `not.toContain` guards for `Dividir em` / `+ parcela` / `Adicionar recorrência` / `Número de parcelas` / `Remover parcela` all exist at `sale-wizard-ui-contract.test.ts:55-59`. True.

### One imprecision worth reporting (non-blocking)

The sentence says the no-entrada case reads "as a `R$ fixo` entrada plus n-1 parcelas". I swept 10,296 no-entrada uneven API plans (totals 100-3000, counts 2-6):

- **10,296 / 10,296** read as a formula (never as hand-edited), and **all** reproduced the stored rows to the cent. The operative claim - it is read as an entrada plus n-1 parcelas, exactly, mislabelling what the API meant as an ordinary first parcela - is **true without exception**.
- **10,259** used mode `fix`; **37** used mode `pct` instead, when the leading row happens to be a clean two-decimal percentage of the total. Counterexample: total 400 -> `[134, 133, 133]` -> `{entradaMode: 'pct', entradaValue: 33.5, restanteCount: 2}`, `matchesFormula: true`.

So `R$ fixo` is the mode in 99.6% of cases but not universally. The described *behaviour and consequence* are correct in 100% of cases, and the following sentence ("arithmetically exact and loses nothing... but it labels as an entrada what the API meant as an ordinary first parcela") is true without qualification. I judge this an incomplete enumeration of the mode label, not a false claim about behaviour, and therefore not a blocker - unlike the previously-flagged sentence, which got the *outcome* wrong. The orchestrator may wish to soften `R$ fixo` to "an entrada (usually `R$ fixo`, occasionally a clean `%`)".

## 5b. Does the new test pin the claim?

Yes. I mutated `inferPaymentPlanShape` to corrupt the fixed-entrada candidate (`entradaValue: entradaCents + 1`, gated on `!cleanPct`). The new test `inferPaymentPlanShape > reads an API-shaped remainder-first plan the way CLAUDE.md documents` went **Red**, alongside two pre-existing inference tests. The claim is executable, not decorative.

## 6. Previously-passed properties still hold

- **Three product-owner phrases**: `1x`, `50% + 3x`, `R$ fixo + 1 mês` all sum exactly across totals 1, 99, 100000, 100001, 999999937.
- **False positives**: none in 25,000 cases (see above).
- **No pre-existing test weakened**: per-file `it()` / `expect()` counts against `master` all grew, none shrank - `calculations.test.ts` 13/39 -> 14/46, `payment-plan-generation.test.ts` 0/0 -> 20/44, `sale-wizard-edit.test.tsx` 4/28 -> 7/47, `sale-wizard-payment-plan.test.tsx` 4/18 -> 12/85, `sale-wizard-ui-contract.test.ts` 2/33 -> 2/41. The amendment itself touched no test file other than `payment-plan-generation.test.ts`, so the previously-reviewed files are unchanged since the PASS.
- **Persisted plan shape and label conventions**: `deriveWizardPrefill`, the `M`-prefix split, and the `"N/M"` / `"MN/M"` conventions produce no diff lines vs `master`. `calculations.ts` has exactly one deletion vs `master` - the old `addMonthsToIsoDate` rollover line, already reviewed and passed. Everything else is additive. `buildSalePayload` appears in the diff only as context.
- **The hint** still cannot state a value the table lacks (unchanged from the previous PASS; the hint code is untouched by the amendment).
- `apps/api/**` and `packages/**`: untouched.

## 7. Hygiene

- One commit, `39103eb`, authored `CauetPinciara <cauetpinciara@gmail.com>`.
- Conventional Commit subject: `feat(sales-ops): generate proposta parcelas from a declarative entrada plus restante builder`.
- No trailers at all - no co-author, no AI attribution. `grep -i "claude|co-authored|generated with|anthropic"` over the commit body returns nothing.
- No em dash in any added line across the whole branch diff.
- UI strings are pt-BR (`Entrada`, `Restante`, `Recorrência`, `Parcelas a receber`, `sem entrada`, `entrada cobre o total`, `Plano ajustado manualmente`).
- The commit body was updated to describe the ceiling relocation honestly, including that the old code "silently lost money".

## Probe hygiene

Two temporary probe files were created and deleted:
`apps/web/src/sales-ops/__tests__/zzprobe-verify.test.ts`, `apps/web/src/sales-ops/__tests__/zzprobe2-verify.test.ts`.
`calculations.ts` was mutated four times and restored from a byte-copy each time.

Final state verified:

- `git hash-object` on `calculations.ts`, `SalesOpsApp.tsx`, `payment-plan-generation.test.ts`, `CLAUDE.md` matches the baseline captured before probing, all four identical.
- `git diff HEAD` is **empty**.
- `git status --porcelain` shows only the four untracked entries present when I started (`.vscode/`, and three `nexo/runs/batch-.../` files). Nothing added, nothing left behind.
- Full suite re-run after restore: exit 0, 35/320, 27/283, 1/17.

## Defects

None blocking. One non-blocking documentation imprecision (the `R$ fixo` qualifier, section 5).
