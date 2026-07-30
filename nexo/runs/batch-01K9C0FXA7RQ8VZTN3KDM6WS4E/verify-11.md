# Verify 11 - payment plan builder

Slice: `11-payment-plan-builder`
Branch: `feat/11-payment-plan-builder`, single commit `aebf8ce` on `f9f869c`.
Verdict: **PASS**

A stream watchdog killed this run once, after all analysis was finished but before the
report was written.
Everything below was established before that stall; the run was resumed only to write
these two files.
Nothing in this report is inferred from memory of an unfinished check - see
"Stalled before completion" at the end.

## 1. Gates

Run from the repo root, on the branch, with the tree at `aebf8ce`.

| Gate | Exit |
| --- | --- |
| `pnpm run lint` | 0 |
| `pnpm run type-check` | 0 |
| `CI=true pnpm test` | 0 |
| `pnpm run build` | 0 |

Totals against the declared branch-point baseline:

| Package | Baseline | Now | Delta |
| --- | --- | --- | --- |
| web | 34 files / 288 tests | 35 / 318 | +1 file, +30 tests |
| api | 27 / 283 | 27 / 283 | unchanged |
| shared-utils | 1 / 17 | 1 / 17 | unchanged |

Nothing was removed.
`grep` for `it.only` / `describe.only` / `test.only` / `it.skip` / `describe.skip` /
`test.skip` across `apps` and `packages` returns nothing.

The full suite was run twice, once at the start and once after every probe and mutant
had been reverted; both were exit 0 with identical totals.

`pnpm --filter @fxl-sales/api test:integration` was **not** run.
It is not in the brief's gate list, and this slice does not touch `apps/api/**`.

## 2. The three user phrases, driven through the real wizard

I did not rely on the shipped tests for this.
I built a probe off the real `sale-wizard-payment-plan` harness and drove
`SaleWizardDialog` itself, reading the rendered inputs back out of the DOM.

| Phrase | Controls touched | Generated rows (cents) | Sum | Total |
| --- | --- | --- | --- | --- |
| "tudo pago em 1x" | **none** - just `Avançar` | `[250000]` | 250000 | 250000 |
| "50% de entrada + o resto em 3x" | `Tipo de entrada` = `%`, `Valor da entrada` = 50, `Parcelas restantes` = 3 | `[3650001, 1216666, 1216666, 1216668]` | 7300001 | 7300001 |
| "valor fixo R$ X de entrada + o resto em 1 mês" | `Tipo de entrada` = `R$ fixo`, `Valor da entrada` = 10000,33, `Parcelas restantes` = 1 | `[1000033, 6299968]` | 7300001 | 7300001 |

Every sum is **exactly** the total.
Phrases 2 and 3 were deliberately run against an ugly total (73000,01) that divides
evenly by neither 2 nor 3; the half-up entrada rounding put the odd cent on the entrada
and the floor remainder on the last restante row, and the two still reconcile to the
cent.
The rendered `Soma das parcelas` line read `R$ 73.000,01 / R$ 73.000,01` in both cases,
and the red mismatch banner never appeared.
All three reached step 3 (`Profissionais alocados`).

**No toggle was required for any of them.**
There is no intermediate "apply" step: the table follows the header controls as they
are typed.

### Removed controls are genuinely gone from the DOM

Enumerating every `<button>` rendered on step 2 gives exactly:

```
["Proposta","2Pagamento","3Custos e margem","4Revisão","nenhuma","nenhuma","Pix","Voltar","Salvar rascunho","Avançar"]
```

(the two `nenhuma` entries are the `Tipo de entrada` and `Recorrência` comboboxes, `Pix`
is the row's `Forma`).

Confirmed absent as DOM nodes, not merely as source substrings:
`Dividir`, `Dividir em`, `+ parcela`, `Remover parcela 1`
(also `button[aria-label^="Remover parcela"]` returns null), `Prazo indeterminado`,
`Adicionar recorrência`, and `input[aria-label="Número de parcelas"]`.
`container.textContent` contains neither `Dividir` nor `+ parcela`.

The negatives have positive controls: `input[aria-label="Parcelas restantes"]`,
`button[aria-label="Tipo de entrada"]` and `button[aria-label="Recorrência"]` are all
present, and the `Plano de pagamento` card title is still rendered.
The shipped `sale-wizard-ui-contract` test pins the removed strings at source level and
its comment correctly explains why the header's own labels are pinned by DOM query
instead (they are shared verbatim with the produto cadastro's editor further up the same
file, so a substring assertion there could not fail).

## 3. Money exactness

This got the most attention, and it holds.

**Pure-function grid.** 13 totals (`0, 1, 2, 3, 7, 99, 100, 101, 333, 100000, 7300000,
7300001, 999999999`) x 3 entrada modes x 18 entrada values (including `0`, `0.01`,
`33.33`, `33.333333`, `50`, `99.99`, `100`, `250` and `-10` for pct; `0`, `1`, `50`,
`12345`, `7300000`, `99900000` for fix) x 7 restante counts (1, 2, 3, 7, 12, 118, 119).
Zero cases where `entrada + Σrestante != total`.
Zero negative amounts.
Zero arrays longer than 120.

**The adversarial cases named in the brief, each explicitly:**

- Totals that do not divide evenly: `7300001 / 3`, `250000 / 3`, `100000 / 3`, `1 / 3`
  and the whole grid above.
- 1-cent total: `generateInstallmentPlan(1, ...)` over counts 1..12 and every entrada
  mode - always sums to 1.
- 100% entrada: collapses to a single row for the full total, no trailing 0-cent
  parcela.
- 0% entrada: falls through to a pure N-way split, sum exact.
- Maximum installment count: covered below.
- Total of 0: yields exactly one row of 0, `[{2026-07-29, 0, pix}]`, sum 0.

**Integer cents throughout.** A dedicated sweep over pathological percentages
(`33.333333`, `66.666667`, `0.01`, `12.5`) against totals `1, 3, 7, 99, 7300001,
100000003` and counts 1..13 found no non-integer `amountBrl`.
Reading the code confirms it: every money path goes through `Math.round` /
`Math.floor` on integer cents, `splitInstallmentsEqually` derives the last row by
subtraction (`totalCents - base * (n - 1)`) rather than by rounding, and the entrada is
clamped with `Math.min/Math.max` on integers.
No float arithmetic survives into a stored amount.

**Through the real DOM.** 4 ugly unit prices (`73000.01`, `0.03`, `1000.01`, `99.99`) x
4 entrada configurations x 5 restante counts, reading the amounts back out of the
rendered inputs and summing them: zero mismatches, and the red banner never appeared
where the sum was in fact exact.

**Maximum installment count.** Typing `130` into `Parcelas restantes` while a fixed
entrada is set produces 120 rows summing to 7300001 exactly.
`wizardPlanShape` clamps the count to `maxRemainingInstallments(entradaMode)`, i.e. 119
when an entrada exists, so the entrada row plus 119 restante rows is exactly the 120-row
ceiling and the terminal `.slice(0, MAX_PLAN_INSTALLMENTS)` never truncates.

One latent caveat, recorded in the findings below: that clamp lives in the wizard, not in
`generateInstallmentPlan`, so the generator's own docstring claim of exactness "for every
input" is not literally true for a hand-constructed `restanteCount: 120` *with* an
entrada. It is unreachable from the product.

## 4. The hint can never state a value the table lacks

`restanteBaseCents` / `restanteLastCents` in the wizard are computed with literally the
same two expressions the rows come from (`Math.floor(restanteCents / restanteCount)` and
`restanteCents - base * (count - 1)`).

I verified this behaviourally rather than by inspection: a grid of 9 totals x 4 entrada
configurations x counts 1..24 comparing the hint's `base` and `última` against the
actual generated restante rows found zero divergence, and also confirmed the hint's row
count always equals the number of restante rows.

The specific case from the mockup: 73000,00 with a 50% entrada in 3x renders

```
3 x R$ 12.166,66 (última R$ 12.166,68)
```

and the table is `[3650000, 1216666, 1216666, 1216668]`.
The string `12.166,67` appears nowhere in the DOM.
The one-cent-over figure from the mockup was correctly not reproduced.

The hint suppresses the `(última ...)` clause only when `restanteLastCents ===
restanteBaseCents`, which is exactly when it would be redundant, and shows
`entrada cobre o total` when the restante is zero rather than printing `N x R$ 0,00`.

This coupling is load-bearing and it is pinned: mutant B below (moving the remainder to
the first row) failed my hint-versus-table probe, proving the hint cannot silently drift
away from the placement.

## 5. Month-end dates

I copied the API's `addMonths` from `apps/api/src/domains/sales-ops/service.ts` verbatim
into a probe and diffed the two implementations exhaustively:

4 years (2026, 2027, 2028, 2029) x 12 months x base days `{1, 15, 28, 29, 30, 31}`
(skipping days that do not exist) x offsets 0..36.
**Zero mismatches.**

Specifically pinned, including base days 29/30/31 and a leap year:

| Input | Result |
| --- | --- |
| `2026-01-29 + 1` | `2026-02-28` |
| `2026-01-30 + 1` | `2026-02-28` |
| `2026-01-31 + 1` | `2026-02-28` |
| `2028-01-31 + 1` | `2028-02-29` (leap) |
| `2000-01-29 + 1` | `2000-02-29` (leap century) |
| `2100-01-29 + 1` | `2100-02-28` (non-leap century) |

No drift over many cycles, because offsets are absolute from the anchor rather than
stepped: `2026-01-31 + 2` is `2026-03-31` (not `2026-03-28`), `+ 3` is `2026-04-30`,
`+ 13` is `2027-02-28`, `+ 25` is `2028-02-29`, `+ 120` is `2036-01-31`.
I also confirmed at the plan level: a 24-parcela plan anchored on each of `2026-01-31`,
`2026-01-30`, `2026-01-29`, `2027-02-28` and `2028-08-31` produces due dates identical to
an API-style absolute-offset walk, row for row.

**The rewritten assertion.** `calculations.test.ts` previously pinned the old rollover:

```
it('rolls month-end split dates forward like native Date arithmetic', ...)
  expect(splitInstallmentsEqually(300, 2, '2026-01-31', 'pix')[1]!.dueDate).toBe('2026-03-03');
```

It was **not deleted**. It became two tests that assert the clamp
(`2026-02-28`, plus `2028-02-29` for the leap case) and a second one pinning the
no-drift property with an ordinary-day positive control.
That is a strictly stronger replacement, and the old expectation was provably wrong
against the API.

Mutant A (reverting the clamp to the native rollover) failed 4 tests across two files, so
the clamp is properly pinned.

## 6. Ruling on the remainder-placement divergence

**Verdict: acceptable to defer.** The implementer's decision to document rather than
silently resolve was correct, though its stated consequence is partly inaccurate.

Verified independently:

- Web: `splitInstallmentsEqually(100000, 3, ...)` gives `[33333, 33333, 33334]` - the
  **last** row absorbs the remainder.
- API: `materializeDefaultPaymentPlan`'s split (`i === 1 ? base + rest : base`) gives
  `[33334, 33333, 33333]` - the **first**.
- Both are exact. The divergence is placement only; no cent is lost on either side.

**Is it genuinely inert today?** Yes. `grep` for `materializeDefaultPaymentPlan` across
`apps` and `packages`, excluding `__tests__`, returns only its own definition
(`service.ts:493`), the compiled `apps/api/dist` declaration, and a prose reference in a
comment in the web `calculations.ts`. It has **no production caller**.

**Would `inferPaymentPlanShape` misread an API-generated uneven split?** I constructed
the case, and the answer is more nuanced than CLAUDE.md claims:

- No-entrada API split `[33334, 33333, 33333]` at offsets +0/+1/+2 is read as
  `entradaMode: 'fix', entradaValue: 33334, restanteCount: 2` with
  **`matchesFormula: true`** - because that formula *does* reproduce those rows exactly
  (entrada row on the anchor, two restante rows at +1 and +2).
  So it is **not** read as hand-edited, and it is **not** a false positive either: the
  description is arithmetically truthful. It is merely mislabelled, calling "entrada"
  something the API considered an ordinary first parcela.
- With-entrada API split `[50000, 16668, 16666, 16666]` **is** read as hand-edited
  (`matchesFormula: false`), which is the safe outcome.
- An evenly divisible API split is byte-identical to the web's and infers cleanly.

This makes the CLAUDE.md sentence "`inferPaymentPlanShape` would read an API-generated
uneven split as hand-edited" wrong for the no-entrada case. Recorded as a finding.

**Should it have been unified now?** No, and unifying would have been the riskier
choice:

- The API side is the declared normative reference and its arithmetic is pinned by 10
  unit vectors in `default-payment-plan.test.ts`. Changing it means editing `apps/api/**`,
  which this slice's scope explicitly excludes.
- The web side was mandated to reuse `splitInstallmentsEqually`, whose last-row remainder
  is itself pinned by a **pre-existing master test**
  (`splits a total into equal monthly installments with the remainder on the last row`).
  Flipping it would have weakened an inherited test.
- The brief contained both instructions, so this was a genuine conflict rather than
  carelessness, exactly as reported.
- The divergence is currently unobservable: no production code path runs the API
  generator.

Documenting it at the seam is the right call, and mutant B proves it cannot be unified
silently later: flipping the placement fails 11 tests across 5 files.

## 7. Round trip

**Hand-edited rows survive byte for byte.** Driving the real wizard: set restante 2, type
`900` into parcela 1, set parcela 2's date to `2027-03-31`, then move *every* header
control (restante to 6, entrada to 40%, recorrência to mensal and back), then go back to
step 1 and change the quantity to 3 (changing the total).
The rows did not budge - amounts and dates identical to the frozen snapshot throughout.
The amber confirm bar appeared and `Plano ajustado manualmente` stayed visible.

**Only an explicit `Aplicar` overwrites.** After all of the above, clicking `Aplicar`
regenerated to 7 rows summing to 750000 exactly and cleared the dirty flag. `Regerar
plano` does the same from the header. Nothing else regenerates a dirty plan - confirmed
by mutant E (removing the `!planDirty` guard), which fails 4 tests including two of my
own probes.

**`Manter parcelas`** rewinds the header to the formula that produced the rows
(restante back to 2), keeps the rows and the dirty flag, and dismisses the bar. Correct.

**A `Forma` edit does not dirty the plan** and methods carry positionally. Set restante 3,
change parcela 2 to Boleto: no dirty line. Then restante to 5: no confirm bar, 5 rows
generated, parcela 2 still Boleto, sum still exact.
The tail inherits the *last* known method (row 3's Pix), which matches the documented
`methods[index] ?? methods.at(-1) ?? 'pix'` rule.
Mutant F (making Forma dirty the plan) fails 2 tests.

**`cycles: null` generates no bounded rows.** Blank `Número de ciclos` shows the MRR
notice and `, por prazo indeterminado`, contributes no rows to the editable table
(`parcelaCount()` stays 1), contributes nothing to the payables preview, and saves
`recurring.cycles: null`.

**`deriveWizardPrefill`'s `M`-prefix split is untouched.** I diffed the region from
`function deriveWizardPrefill` to `const hasRecurring` between `master` and `HEAD`:
**IDENTICAL**.

**Best-effort description, not a false one.** A hand-edited plan seeds the header from
the `fix` fallback candidate and shows `Plano ajustado manualmente`, so the header
describes rather than claims. That is the correct failure mode.

## 8. False positives in `inferPaymentPlanShape`

**None exist.** I attacked this three ways:

1. **Brute force.** 4 totals x 10 adversarial amount sets (including `[0,0,3]`,
   `[1,1,1]`, `[299999,1]`, `[1,299999]`, `[100001,99999,100000]`) x 125 date
   permutations drawn from a pool containing an out-of-sequence `2026-11-30` and an
   off-by-one-day `2026-08-11`. For every case reporting `matchesFormula: true` I
   re-generated from the returned shape and compared. Zero divergences.
2. **Randomised sweep.** 20,000 pseudo-random plans (random totals up to 2,000,000,
   1-6 rows, random amounts, and a 25% chance per row of an out-of-sequence date).
   Every `matchesFormula: true` reproduced its rows exactly. Zero divergences.
3. **Code reading.** There are exactly two `matchesFormula: true` return paths: the empty
   row set, and the loop that returns only after a full regenerate-and-compare on both
   `dueDate` and `amountBrl`. `method` is excluded from the comparison, which is sound
   because the generator is handed the stored methods and carries them positionally, so
   they always match anyway.

The implementer's claim that false positives are impossible by construction is upheld.

Worth stating plainly, because it is easy to mistake for a false positive: if an operator
hand-edits amounts in a way that a formula *does* reproduce (say 2000/1000 on a 3000
total with generated dates), the inference reports that formula and the plan will follow
the total live. That is not a lie - the header truthfully describes the table - and it is
the requested automatic behaviour.

## 9. Plan-spec correction upheld

Confirmed. Rows `100000 / 100000 / 100000` against a 300000 total genuinely **are** an
even 3x split, so `nenhuma + 3x` is the truthful inference and the original spec case was
wrong.

The replacement case genuinely exercises a non-clean percentage: rows
`100001 / 99999 / 100000` give `pct = 33.3336666...%`, whose `cleanPct` test
(at most two decimals, and must reproduce the entrada to the cent) rejects it, so the
`fix` candidate wins with `entradaValue: 100001`. If the pct candidate had been accepted
the result would have been `pct`, not `fix`, so the rejection branch is really covered.
The test also carries the even-3x positive control alongside it.

## 10. Anti-gaming: were any pre-existing tests weakened?

**No.** Per-file counts, `master` -> `HEAD`:

| File | `it()` | `expect()` |
| --- | --- | --- |
| `calculations.test.ts` | 13 -> 14 | 39 -> 46 |
| `sale-wizard-edit.test.tsx` | 4 -> 7 | 28 -> 47 |
| `sale-wizard-payment-plan.test.tsx` | 4 -> 12 | 18 -> 85 |
| `sale-wizard-ui-contract.test.ts` | 2 -> 2 | 33 -> 41 |
| `payment-plan-generation.test.ts` (new) | 0 -> 18 | 0 -> 36 |

Every file rose on both metrics. Diffing the `it()` names shows only three rewrites, all
strengthening:

1. `rolls month-end split dates forward like native Date arithmetic` -> two tests
   asserting the clamp and the no-drift property. Covered in section 5.
2. `splits the plan into N equal monthly parcelas with the remainder on the last` ->
   `generates restante rows live from Parcelas restantes ...`. Same assertions, plus the
   hint check and the removed-control negatives; the only change is that two clicks
   (`Dividir`) became one input change. Stronger.
3. The `sale-wizard-edit` inversion, below.

### The `sale-wizard-edit.test.tsx` inversion

`keeps the prefilled plan when the total changes mid-edit` asserted that after changing
the quantity, the rows stayed `1500 / 1500` and the mismatch warning appeared.
It now asserts `2750 / 2750`, `R$ 5.500,00 / R$ 5.500,00`, no warning, and that the
wizard advances.

**(a) Is the inversion correct?** Yes. The prefilled plan is an even 2x split, which the
builder *proves* matches a formula. Following the total live is precisely the "more
automatic" behaviour the user asked for, and stranding the operator with a red mismatch
they did not cause would be the worse outcome. This is the intended, requested change.

**(b) Does the original intent survive?** Yes, genuinely. The new
`keeps a hand-edited plan when the total changes mid-edit` uses rows
`2000 / 500 / 500` with a third due date of `2026-11-30`.
I verified independently that no formula reproduces that: the amounts alone *would* be
`fix 200000 + 2x`, but that formula puts the third row at `2026-09-10`, so the date is
what makes it hand-edited, and the test's comment says so honestly.
The test asserts the rows byte for byte both on open and after the total changes, plus
the dirty line, the absence of the confirm bar, and that `Avançar` is blocked.
That is **stronger** than the assertion it replaced, not a weaker stand-in.
Two further tests were added around it (round-trip through save, and the blank-ciclos
prefill).

Mutant E confirms this test can fail: removing the dirty guard breaks it.

## 11. The two declared behaviour changes

**(a) `defaultPlanShapeForProduct` now reads the produto cadastro's stored template.**
**Correct.** The argument's justification holds: slice 10 shipped an editor writing
`defaultEntradaMode` / `defaultEntradaPct` / `defaultEntradaBrl` /
`defaultRemainingInstallments`, and without this seam nothing consumed them - the
function would have had to ignore its own parameter. It reads exactly three of the six
columns and documents why `defaultPaymentMethod` and `defaultRecurringCycles` are left
for later. It clamps hostile stored values (negative pct to 0, negative brl to 0,
`defaultRemainingInstallments: 0` to 1, `9999` to 120), so a bad cadastro row cannot
produce an unsavable proposta.
**Failing-capable:** mutant C (making the function ignore its argument) fails 3 tests,
including the DOM-level `seeds the header from the produto default payment plan`, which
carries a positive control (a template-less product still opens on `nenhuma` + 1).

**(b) Edit-path `recurringBrl > 0` with zero `M` receivables now prefills ciclos blank.**
**Correct.** A recurring sale with no `M`-labelled receivables *is* `cycles: null` per
CLAUDE.md, so the old `'12'` invented a bounded plan the proposta did not have - and
since the `Prazo indeterminado` checkbox is gone, blank is now the only way to express
it. Prefilling `'12'` would have silently converted an indefinite contract into a
12-cycle one on the next save. This fixes a real data-integrity bug.
I confirmed the `recurringSource` guard does not fire on the edit path and clobber the
blank back to `'12'`: it is seeded from `prefilledPrimaryProduct` and compared against
`primaryItemProduct`, which resolve to the same product because `items` is initialised
from `prefill.items`.
**Failing-capable:** mutant D (restoring `'12'`) fails
`prefills a blank ciclos field for an indefinite recorrencia`, which asserts both the
empty field and the saved `cycles: null`.

## 12. Scope, hygiene, invariants

- **Scope.** `git diff --name-only master..HEAD` outside `apps/web/` is `CLAUDE.md` only.
  `apps/api` and `packages` show **0** changed files.
- **Persisted shape unchanged.** The `installments` / `recurring` payload construction is
  untouched apart from the `recurringEnabled` -> `recurringMode === 'monthly'` rename.
  `deriveWizardPrefill`'s `M`-prefix region is byte-identical to master.
  Statuses, transition endpoints and payables materialization are not touched at all.
- **`entradaMode` literals.** `'fix'` everywhere; `grep` for `'fixed'` / `"fixed"` across
  `apps/web/src/sales-ops/` returns nothing. The two surfaces share one spelling.
- **Native `<input type="date">`** retained (3 occurrences, unchanged).
- **`Plano de pagamento`** card title kept; 6 other test files query it and all pass.
- **No raw account or workspace ids** are rendered by any added line.
- **pt-BR** throughout, with correct accents (`Recorrência`, `Número de ciclos`,
  `última`, `Avançar`).
- **No `any` casts, no `@ts-ignore`, no `@ts-expect-error`, no `eslint-disable`** in added
  lines. The single added `catch` is `planShapeFromKey`'s `JSON.parse` guard returning
  `null`, a deliberate documented fallback, not a swallowed error.
- **Commit hygiene.** One commit, Conventional Commit subject
  (`feat(sales-ops): ...`), authored by the user, no co-author trailer, no AI attribution,
  no em dash in any added line.
- **Out-of-slice edits.** Exactly one hunk in `SalesOpsApp.tsx` falls outside the wizard /
  plan surface: `@@ -3287` in `ProductDialogBody`, the inherited `usedEligibleCount`
  re-indentation. It is a pure whitespace fix (a mis-indented comment block plus
  unwrapping an 89-character expression onto one line); the expression is
  character-for-character identical. Verified as the only such hunk by listing all 15
  hunk headers.

## 13. Whitespace

`pnpm exec prettier` fails (`Command "prettier" not found`), as the brief warned, so I
measured with `pnpm dlx prettier@3` against a copy of the repo's `prettier.config.js`,
comparing the `master` and `HEAD` revisions of each changed file side by side.

| File | Drifting lines master -> HEAD | Hunks |
| --- | --- | --- |
| `SalesOpsApp.tsx` | 460 -> **412** | 79 -> 72 |
| `calculations.ts` | 5 -> 5 | 1 -> 1 |
| `calculations.test.ts` | 16 -> 16 | 3 -> 3 |
| `sale-wizard-payment-plan.test.tsx` | 14 -> 14 | 4 -> 4 |
| `sale-wizard-ui-contract.test.ts` | 0 -> 0 | 0 -> 0 |
| `payment-plan-generation.test.ts` (new) | 0 -> **15** | 0 -> 3 |
| `sale-wizard-edit.test.tsx` | 57 -> **127** | 3 -> 5 |

The `SalesOpsApp.tsx` improvement claim is **upheld**: drift genuinely fell, 460 -> 412 by
my measurement (the implementer reported 460 -> 415; the small delta is explained by a
different prettier patch release).

The claim of **zero new drift is not accurate**: the new test file adds 15 drifting lines
and `sale-wizard-edit.test.tsx` adds about 70. I inspected all of it. It is entirely
line-wrapping preference, and the `sale-wizard-edit.test.tsx` additions are long one-line
receivable fixtures written in exactly the same house style as the fixtures already on
master in that file. Prettier is not installed, not wired into `lint`, and not in any
gate, so this is a style observation only and I do not fail on it.

## 14. Findings

None of these block the merge.

1. **CLAUDE.md documents the divergence consequence inaccurately.** It states
   `inferPaymentPlanShape` "would read an API-generated uneven split as hand-edited".
   That is true only when the API plan has an entrada. Without one, the split is read as
   `fix entrada + (N-1)x` with `matchesFormula: true` - truthful arithmetic, misleading
   label. Worth correcting when the placement is eventually unified.
2. **`generateInstallmentPlan`'s exactness docstring overclaims.** With
   `restanteCount: 120` *and* an entrada, the terminal `.slice(0, 120)` drops the
   remainder-bearing last row and the sum falls short (probe: total 1,000,000 -> 120 rows
   summing 991,608). Unreachable today - `wizardPlanShape` clamps to 119 whenever an
   entrada exists (verified in the DOM by typing 130), `inferPaymentPlanShape` can only
   propose `rows.length - 1 <= 119`, and `defaultPlanShapeForProduct`'s output is always
   funnelled through `wizardPlanShape`. It is a trap for a future direct caller, since the
   invariant lives in the wizard rather than in the function that promises it.
3. **Minor regression vs master in one exotic edit state.** A draft/open proposta whose
   installment receivables are all `void` (reachable via won -> `cancel-contract` voiding
   every future parcela -> revert to open) now opens step 2 with a single R$ 0,00 row
   dated today plus the red mismatch banner, because `inferPaymentPlanShape([])` returns
   `matchesFormula: true` and the seeded `appliedPlanKey` already equals the current key,
   so no regeneration fires. Master's `planAuto` flag auto-generated a single full-total
   row here.
   **Not a trap and not a money issue:** I verified the operator recovers by nudging
   `Parcelas restantes` (to 2 gives a valid 2x plan; back to 1 gives the correct single
   R$ 3.000,00 row dated `2026-07-10`), and the banner correctly blocks saving anything
   invalid in the meantime.

## 15. Equivalent mutants / things that are not defects

Two of my own probe assertions failed and neither indicated a defect - both were my
expectations being wrong:

- I expected an API-generated uneven split to infer as hand-edited. It infers as a fixed
  entrada that reproduces the rows exactly. The code is right; CLAUDE.md's prose is not
  (finding 1).
- I expected the method tail to inherit the last *explicitly set* method. It inherits the
  last method in the array (`methods.at(-1)`), which is what the docstring says and what
  the shipped test pins.

The whitespace drift in the test files is style, not a defect.

## 16. Mutation testing

To confirm the suite is not decorative, I reverted six behaviours and re-ran the web
suite. Every one was caught.

| Mutant | Change | Failures |
| --- | --- | --- |
| A | Month-end clamp back to native rollover | 4 tests, 2 files |
| B | Remainder to the first restante row (API placement) | 11 tests, 5 files |
| C | `defaultPlanShapeForProduct` ignores its argument | 3 tests |
| D | Ciclos prefill back to `'12'` | 1 test |
| E | Regeneration ignores `planDirty` (silent discard) | 4 tests |
| F | A `Forma` edit marks the plan dirty | 2 tests |

Mutant B is the notable one: it broke my own hint-versus-table probe, which is direct
evidence that the header hint and the generated rows cannot drift apart.

## 17. Probe cleanup and final tree state

Three probe files were created and all three were deleted:
`apps/web/src/sales-ops/__tests__/zz-verify-probe.test.ts`,
`zz-verify-dom-probe.test.tsx`, `zz-verify-empty-probe.test.tsx`.
All six mutants were reverted with `git checkout --` and byte-identity re-confirmed by
hash after each.

Final state, re-confirmed on resuming after the stall:

```
$ git branch --show-current
feat/11-payment-plan-builder
$ git log --oneline -1
aebf8ce feat(sales-ops): generate proposta parcelas from a declarative entrada plus restante builder
$ git diff HEAD
(empty)
$ git status --porcelain
?? .vscode/
?? nexo/runs/batch-01K9C0FXA7RQ8VZTN3KDM6WS4E/agents/exec-11-payment-plan-builder.result.json
$ git hash-object apps/web/src/sales-ops/SalesOpsApp.tsx apps/web/src/sales-ops/calculations.ts
d0ddc19f3ffad17c99901ded82606eb3918093d4
0a050dddbc9a828c6b9be2c88e2a0979a5844835
```

Both hashes match the values recorded before any mutation.
`git status` is exactly what I found at the start of the run: the two untracked artefacts
(`.vscode/` and the exec result file) and nothing else.
No merge, push, commit or amend was performed.

## 18. Stalled before completion

**No verification check was left unfinished.**
The watchdog fired after every gate, probe, mutant and measurement in this report had
completed, at the point of writing these two files.
The run was resumed only to write them, after re-confirming the tree state above.

The one item deliberately not run is `pnpm --filter @fxl-sales/api test:integration`,
which is outside the brief's gate list and not indicated for a slice that leaves
`apps/api/**` untouched.
