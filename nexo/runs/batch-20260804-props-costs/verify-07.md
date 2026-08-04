# verify-07 - professional split UI

Slice: `07-professional-split-ui`
Branch: `feat/07-professional-split-ui` at `46a7266`
Verdict: **PASS** (with 3 non-blocking findings, one of which is a real coverage gap)

`nexo/runs/batch-20260804-props-costs/exec-07-notes.md` was NOT read.
Two of its lines surfaced incidentally in a repo-wide `grep` for `—` and `8b8b92` before the grep was rescoped; nothing from it was used to form a verdict.

## 1. The twelve-test oracle table

### 1a. Red-on-master, literal run

A scratch worktree of `master` was created (`git worktree add`), the six new/changed test files were copied over the original implementation, and the suite was run.

The literal run is **uninformative**: `ProfessionalSplitPanel.tsx` does not exist on `master`, so the whole file fails at collection.

```
Error: Failed to resolve import "../ProfessionalSplitPanel" from
"src/sales-ops/__tests__/sale-wizard-professional-split.test.tsx". Does the file exist?
 Test Files  1 failed (1)
      Tests  no tests
```

That is a module-resolution failure, not twelve oracles firing. To get a per-test reading, a stub `ProfessionalSplitPanel` returning `null` was added to the master worktree - which is exactly the "no `Detalhe de pagamento`" state - and the suite re-run:

```
 Test Files  1 failed (1)
      Tests  12 failed (12)
```

Failure reasons, deduplicated:

| count | failure |
| --- | --- |
| 10 | `Error: button not found: Detalhe de pagamento do profissional 1` |
| 1 | `Error: split panel 1 is not open` (test 12) |
| 1 | `AssertionError: expected undefined to be null` (test 3) |

So 11 of the 12 die at the *first* new affordance they touch. That proves the trigger button and the panel are new; it proves nothing about the assertions that follow. **The master route is therefore a weak oracle for 11 of 12, and every one of the twelve was mutation-tested against the NEW implementation instead.** The worktree was removed (`git worktree remove --force`); `git worktree list` shows only the main checkout.

### 1b. Mutation testing against the new implementation

Each mutation targets the specific behaviour the test names, is applied to exactly one anchor (the runner aborts if the anchor count is not 1), and is reverted immediately; the runner prints `git diff --stat` for the file afterwards and it was empty every time. Each run is `npx vitest run <file> -t '<test name>'`, so `1 failed | 11 skipped (12)` means the targeted test went red.

| # | Test | Red on master? | Mutation | Result |
| --- | --- | --- | --- | --- |
| 1 | shows the default pro-rata split for the parcelas | yes, but only at the trigger lookup | M1: `splitBp ?? defaultSplitBp(...)` -> equal `SPLIT_BP_TOTAL/n` weights | **RED** `1 failed \| 11 skipped (12)` |
| 2 | reproduces the user 10k/20k/20k/50k case | yes, trigger lookup | M2: `splitCentsByWeights(costCents, weightsBp)` -> naive `floor(costCents/n)` per part | **RED** `1 failed \| 11 skipped (12)` |
| 3 | submits costSplitBp null while the split is untouched | yes, on its own assertion (`expected undefined to be null`) | M3: `buildSalePayload`'s `costSplitBp: … ?? null` -> `?? undefined` | **RED** `1 failed \| 11 skipped (12)` |
| 4 | submits a 30/70 override and shows its reais | yes, trigger lookup | M4: the part `<Input>`'s `onChange` maps `current` instead of `percentInputToBp(event.target.value)` (typed edits ignored) | **RED** `1 failed \| 11 skipped (12)` |
| 5 | submits a one-part override for a professional paid in a single time | yes, trigger lookup | M5: `{splitBp.length < parcelas.length ? (` -> `{false ? (` (the "parcelas N em diante não pagam" copy suppressed) | **RED** `1 failed \| 11 skipped (12)` |
| 6 | blocks advancing while the parts do not sum to 100% | yes, trigger lookup | M6: `canAdvanceStepThree = professionalsValid && professionalSplitsValid` -> `= professionalsValid` | **RED** `1 failed \| 11 skipped (12)` |
| 7 | **keeps the override when the cost changes** | yes, trigger lookup | M7: `splitCentsByWeights(costCents, …)` -> `splitCentsByWeights(Math.min(costCents, 1000000), …)`, i.e. the panel resolves against the cost the schedule was authored at - what a cents-denominated `cost_split_bp` would store | **RED** `1 failed \| 11 skipped (12)`, see §3 |
| 8 | distributes equally with the last part absorbing the remainder | yes, trigger lookup | M8: `Distribuir igualmente` -> `splitBp.map(() => floor(SPLIT_BP_TOTAL/n))` = `[3333,3333,3333]` | **RED** `1 failed \| 11 skipped (12)` |
| 9 | restores the default with Usar padrão | yes, trigger lookup | M9: `Usar padrão`'s `onChange(null)` -> `onChange([...weightsBp])` (keeps the override) | **RED** `1 failed \| 11 skipped (12)` |
| 10 | reopens a stored override on the edit path | yes, trigger lookup | M10: `deriveWizardPrefill`'s `costSplitBp: row.costSplitBp ?? null` -> `costSplitBp: null` | **RED** `1 failed \| 11 skipped (12)` |
| 11 | caps the part count at the parcela count | yes, trigger lookup | M11: `disabled={splitBp.length >= parcelas.length}` -> `disabled={false}` | **RED** `1 failed \| 11 skipped (12)` |
| 12 | tells the operator to set a plan when there is no parcela | yes, `split panel 1 is not open` | M12: `{parcelas.length === 0 ? (` -> `{parcelas.length < 0 ? (` (guard branch unreachable) | **RED** `1 failed \| 11 skipped (12)` |

**Vacuous tests: 0 of 12.** Every test can be made to fail by breaking the specific behaviour it names. The bar was "two or more vacuous is a FAIL, one is a finding"; neither applies.

### 1c. Two extra probes

Because 11 of the 12 die shallowly on `master`, two behaviour lines were probed for independent pinning:

| Probe | Mutation | Result |
| --- | --- | --- |
| PROBE-A | `Personalizar divisão`'s `onChange([...weightsBp])` -> `onChange(weightsBp.map(() => 0))` (seeds ZEROS instead of the default) | **SURVIVED** - `Tests  12 passed (12)`. See finding F1. |
| PROBE-B | the split error bar's `{showCostErrors && !professionalSplitsValid ? (` -> `{false ? (`, leaving the gate intact | **RED** `1 failed \| 11 passed (12)` - the bar's copy is asserted independently of the gate |

Both restored; `git diff --stat` empty after each.

## 2. Gates

All four run-once, from the repo root, on `46a7266`.

`pnpm run build:packages`
```
> @fxl-sales/shared-types@1.0.0 build … > tsc --build --force
> @fxl-sales/shared-utils@1.0.0 build … > tsc --build --force
```
Exit 0, no diagnostics.

`pnpm run lint`
```
apps/api lint$ eslint src/
apps/web lint$ eslint src/
apps/api lint: Done
apps/web lint: Done
LINT_EXIT=0
```

`pnpm run type-check`
```
packages/shared-types type-check: Done
packages/shared-utils type-check: Done
apps/api type-check: Done
apps/web type-check: Done
TC_EXIT=0
```

`pnpm test`
```
packages/shared-utils test:  Test Files  3 passed (3)
packages/shared-utils test:       Tests  80 passed (80)
apps/api test:  Test Files  33 passed (33)
apps/api test:       Tests  328 passed (328)
apps/web test:  Test Files  46 passed (46)
apps/web test:       Tests  531 passed (531)
apps/web test:  ✓ src/sales-ops/__tests__/sale-wizard-professional-split.test.tsx (12 tests) 608ms
build-contract: ok
TEST_EXIT=0
```
The tracked-file guard (`scripts/no-legacy-auth.mjs`) and `scripts/build-contract.mjs` both ran and passed.

## 3. The load-bearing design test - re-run, not trusted

Verdict: **HOLDS, and discriminates.**

The counterfactual was re-run independently. With the panel patched to resolve its parts against `Math.min(costCents, 1000000)` - a stand-in for a cents-denominated schedule that does not re-derive when the cost moves - the test fails on exactly the intended assertion:

```
FAIL  … > keeps the override when the cost changes
AssertionError: expected 'Detalhe de pagamento · Bruno EntregaP…' to contain 'R$ 6.000,00'

Expected: "R$ 6.000,00"
Received: "Detalhe de pagamento · Bruno EntregaParte 1%= R$ 3.000,0004/08/2026Remover
           Parte 2%= R$ 7.000,0004/09/2026RemoverSoma100,00%+ parteDistribuir igualmenteUsar padrão"
```

That received string IS the cents-denominated failure mode: the panel still reads R$ 3.000,00 / R$ 7.000,00 after `CUSTO ALOCADO` went from R$ 10.000,00 to R$ 20.000,00. Unmutated, the same test passes with R$ 6.000,00 / R$ 14.000,00 on screen and `costBrl: 2000000` + `costSplitBp: [3000, 7000]` in the payload. Basis points are justified by evidence, not by assertion.

## 4. WYSIWYG

Verdict: **HOLDS.**

- Import path. Every `@fxl-sales/shared-utils` import in `apps/web/src` is a subpath; there is no bare-root import anywhere in the web tree:
  - `apps/web/src/sales-ops/ProfessionalSplitPanel.tsx:5` `from '@fxl-sales/shared-utils/professional-split'`
  - `apps/web/src/sales-ops/calculations.ts:1` `from '@fxl-sales/shared-utils/professional-split'`
  - `apps/web/src/sales-ops/SalesOpsApp.tsx:124` `from '@fxl-sales/shared-utils/professional-split'`
  - (pre-existing) `SalesOpsApp.tsx:119` and `sale-margin-parity.test.ts:9` on `/sale-financials`
  The Node-only hmac module is only reachable through the package root, which nothing in `apps/web` imports.
- Same functions as the server. `resolveProfessionalSplit` (`packages/shared-utils/src/professional-split.ts`) composes exactly two things: `defaultSplitBp(eligible.map(r => r.amountBrl))` at line 115 and `splitCentsByWeights(input.costBrl, folded)` at line 125. The panel calls the same two, at `ProfessionalSplitPanel.tsx:65-66`, in the same order, on the same inputs.
- No parallel arithmetic. `grep` for `defaultSplitBp|splitCentsByWeights` across `apps/web/src` returns only those two call sites plus `Distribuir igualmente`'s `splitCentsByWeights(SPLIT_BP_TOTAL, splitBp.map(() => 1))`. No hand-rolled weight or remainder maths exists in the web layer. M1, M2 and M8 all confirm this by killing their tests the moment a bespoke division is substituted.
- Same input set. The panel is handed `installmentRows` only, filtered to `amountCents > 0`. The server is handed non-void, non-recurring receivables. Step 2's `planRowsValid` (`SalesOpsApp.tsx:6041-6045`) requires every row's amount `> 0` before `Avançar` unlocks, so the `> 0` filter drops nothing in practice, and the recorrência is separate state on the wizard side and `M`-labelled on the server side (`isRecurringReceivableLabel`). The two currency parsers involved are the same function - `parseCurrencyToCents` at `SalesOpsApp.tsx:446` is a one-line alias of `parseCurrencyInputToCents` - so there is no rounding seam between the gate and the panel.
- Payload is inside the API contract. `SaleProfessionalSchema` (`apps/api/src/domains/sales-ops/service.ts:365`) is `z.array(z.number().int().min(0).max(10_000)).min(1).max(120).nullish()` plus a sum-is-10000 refine. The web clamps each part to `[0, SPLIT_BP_TOTAL]` in `percentInputToBp`, requires `length >= 1`, `length <= parcela count` (itself capped at 120 by the installments cap) and `Σ === 10000` in `professionalSplitsValid`. The web gate is a strict subset of what the API accepts, so no wizard state can produce a 400.

## 5. Behaviour lines

| Line | Verdict | Evidence |
| --- | --- | --- |
| Default state shows the pro-rata split per parcela, summing to the cost | **HOLDS** | Test 1: `20,00%` / `40,00%` / `40,00%` and `R$ 100,00` / `R$ 200,00` over a 1000/2000/2000 plan, with a `Total` line of `R$ 500,00`. Killed by M1 (equal weights) and M2 (naive cents). Exact-sum is `splitCentsByWeights`'s own contract, pinned by the 57 tests in `packages/shared-utils/src/__tests__/professional-split.test.ts`. |
| `Personalizar divisão` seeds the editable state from that default | **HOLDS, but UNTESTED** | Source is `onChange([...weightsBp])`. Proven empirically with a throwaway test (since deleted): over a 10k/20k/20k/50k plan the four parts seed to `10` / `20` / `20` / `50`. But PROBE-A shows all twelve tests survive seeding zeros - only the seed's LENGTH is pinned (tests 8 and 11), never its values. See finding F1. |
| A `[10000]` one-part override says the later parcelas pay nothing | **HOLDS** | Test 5 asserts `As parcelas 2 em diante não pagam este profissional.` and `R$ 10.000,00` on the lone part, payload `[10000]`. Killed by M5. Matches the server: `resolveProfessionalSplit` binds parts front-aligned to `eligible[i]`, so receivables past `weights.length` get no `professional_cost` row at all. |
| `Distribuir igualmente` over three parts gives `[3333, 3333, 3334]` | **HOLDS** | Test 8 asserts the three input values `33.33` / `33.33` / `33.34` and the payload `[3333, 3333, 3334]`. Killed by M8 (naive floor division produces `[3333,3333,3333]`). Routed through `splitCentsByWeights`, so it obeys the same last-part-absorbs-the-remainder rule as the payables. |
| A sum other than 100% blocks `Avançar` and shows the bar | **HOLDS** | Test 6 sets 30 + 30, asserts `60,00%` in the panel, clicks `Avançar`, asserts the bar copy `A divisão de pagamento de cada profissional deve somar 100%.` AND asserts the Revisão card never mounted (`not.toContain('Dados da proposta')`). Killed by M6 (gate removed). PROBE-B separately confirms the bar assertion is not carried by the gate assertion. |
| `Usar padrão` restores `null` | **HOLDS** | Test 9 asserts no `Parte 1` input survives and that the payload carries `costSplitBp: null`. Killed by M9. The `null` reaches the wire as an explicit `null`, not an omitted key (`buildSalePayload`'s `?? null`), which is what clears a stored override on an UPDATE; M3 kills test 3 on exactly that. |
| A stored override reopens correctly on the edit path | **HOLDS** | Test 10 renders the wizard over a bootstrap whose `saleProfessionals[0].costSplitBp` is `[3000, 7000]`, advances to step 3, opens the panel and reads `30` / `70` out of the two inputs, then round-trips `[3000, 7000]` back through the payload. Killed by M10. |
| `+ parte` is capped at the parcela count | **HOLDS** | Test 11 over a 2-parcela plan: `+ parte` is `disabled === true` at 2 parts, and `disabled === false` after removing one. Killed by M11. This cap is also what keeps the server's `weights.length > m` fold branch unreachable from the wizard, so panel and server agree by construction. |

## 6. No regression from slices 03, 04 and 06

| Invariant | Verdict | Evidence |
| --- | --- | --- |
| FUNÇÃO is still the first column | **HOLDS** | The row grid is still `grid-cols-[minmax(0,1fr)_minmax(0,1fr)_212px_36px]` and column 1 is still the `Função do profissional N` `Combobox` (`SalesOpsApp.tsx` ~7719-7756). The slice edits no grid template and adds no column header - the trigger goes inside the existing `CUSTO ALOCADO` cell as its last child, and the panel is a `col-span-full` sibling. |
| Person picker is locked until a função is named | **HOLDS** | `personPickerLocked = !professional.funcaoId && !professional.funcaoName.trim()` is unchanged, still drives `disabled` on the `Profissional N` `Combobox` and still swaps the placeholder to `Selecione a função primeiro`. The legacy-row escape hatch (free-text `funcaoName`, no id) is intact. |
| Slice 04's seeding still fires | **HOLDS** | The produto-seeding guard at `SalesOpsApp.tsx:6018-6025` is untouched except for the two new seeds (`costSplitBp: null`, `splitOpen: false`). `funcao-cost-seeding.test.ts` (11 tests) and `sale-wizard-funcao-costs.test.tsx` (40 tests) both green; the only diff to the latter is comments plus two `costSplitBp: null` payload keys. |
| `professionalRowWillPersist` is the SOLE personName predicate | **HOLDS** (with note F2) | One definition, `calculations.ts:390`, three consumers (`SalesOpsApp.tsx:6084`, `:6154`, `:6165`). The full `personName.trim` grep over `apps/web/src` returns: the predicate body (`calculations.ts:391`), a payload normalization (`calculations.ts:820`, pre-existing), an unrelated product-providers map (`SalesOpsApp.tsx:3610`, pre-existing), and one NEW hit - `ProfessionalSplitPanel.tsx:68`. See F2. |
| The margin-parity fix still holds | **HOLDS** | `sale-margin-parity.test.ts` green (6 tests); the slice's only diff to it is a comment rewrite. `computeSaleFinancials` is untouched. `buildFuncaoCostBasis` and `professionalCostBaseCents` are untouched in behaviour - the diff to both is doc comment only, restating that a `professional_cost` remains a PAY-ONCE TOTAL and that the split decides only WHEN under `Σ parts === cost_brl`. |

## 7. `ProfessionalForm`'s two new fields are REQUIRED

Verdict: **HOLDS.**

Both are declared non-optional (`SalesOpsApp.tsx:5165` `costSplitBp: number[] | null;`, `:5172` `splitOpen: boolean;`) - no `?`, so every construction site is a compile error if it forgets the seed.

Three construction sites, all seeded:

| Site | Line | Seed |
| --- | --- | --- |
| `deriveWizardPrefill` (edit path) | 5416 / 5419 | `costSplitBp: row.costSplitBp ?? null`, `splitOpen: false` |
| the produto seeding guard | 6023 / 6024 | `costSplitBp: null`, `splitOpen: false` |
| the `+ profissional` handler | 7665 / 7666 | `costSplitBp: null`, `splitOpen: false` |

`pnpm run type-check` is green, which is what proves there is no fourth site. Both mutation runs that break a seed (M10) go red rather than silently passing.

## 8. No `useInlineLayer`, Escape unaffected

Verdict: **HOLDS.**

`grep useInlineLayer apps/web/src/sales-ops/ProfessionalSplitPanel.tsx` returns one hit and it is inside the header comment explaining why the hook is NOT called. The panel is rendered in flow as a `col-span-full` sibling - no `absolute`, no `z-50`, no portal - so an Escape aimed at it has nothing to dismiss and correctly reaches `DialogContent`. That matches the established `SaleItemForm.descriptionOpen` precedent.

The panel registers no `onKeyDown` of its own. The one nested component that IS an absolutely-positioned layer, `InfoHint`, calls `useInlineLayer(open)` itself (`components/ui/info-hint.tsx:59`), so nesting it here changes nothing about the contract. `inline-layer-escape.test.tsx` (5 tests), `info-hint.test.tsx` (7 tests) and every wizard suite are green.

## 9. Style and repo conventions

| Check | Verdict |
| --- | --- |
| `CLAUDE.md` accuracy | **ACCURATE.** Twelve added lines under the Propostas section; every claim was checked against the code - in-flow disclosure with no `useInlineLayer`, `col-span-full`, own module, trigger inside the existing `CUSTO ALOCADO` cell with no grid-template or column-header edit, percentage-only part inputs, same `defaultSplitBp`/`splitCentsByWeights` over `installmentRows`, both `ProfessionalForm` fields REQUIRED across three constructors, `canAdvanceStepThree` gating on `professionalSplitsValid` with 1..N parts summing to 10000 bp, no renormalization on add/remove, `Distribuir igualmente`/`Personalizar divisão` as the only guaranteed-100% writers, and the no-parcela branch as an unreachable guard justified by `canSaveBasics` + `planRowsValid`. One imprecision, F3. |
| No em dash added | **CLEAN** in `CLAUDE.md`, `apps/` and `packages/`. `git diff master...HEAD -- CLAUDE.md apps/ packages/ \| grep "^+" \| grep "—"` returns nothing. (`exec-07-notes.md` does contain em dashes; a run-log style nit, out of the shipped diff.) |
| No native `<select>` / `<option>` / `<datalist>` | **CLEAN.** None in the new panel or anywhere in the diff. The two part controls are `<Input type="number">` from `@/components/ui/input`; no raw `<input type="number">`. `pnpm run lint` green, so the `no-restricted-syntax` rules are satisfied. |
| Muted text is `#6a6a72`, not `#8b8b92` | **CLEAN.** `#6a6a72` appears 11 times in the panel and once on the new trigger button. The only `8b8b92` in source is inside a comment recording why the lighter grey was rejected (3.38:1 on white, fails WCAG AA); it is not a color value in use. |

## 10. Test coverage subtraction

```
$ git diff master...HEAD -- '*test*' | grep -c "^-[^-]"
6
```

All six lines accounted for; no assertion and no test case was removed.

| # | File | Removed line | Why |
| --- | --- | --- | --- |
| 1 | `calculations.test.ts` | `// cannot reach the base of a one-shot professional_cost.` | Comment rewrite. Replaced by a longer comment saying the same thing plus why the split does not weaken it. The assertions below it are unchanged. |
| 2 | `sale-margin-parity.test.ts` | `// reach this function: it takes items only, because a professional_cost payable` | Comment rewrite, same paragraph. |
| 3 | `sale-margin-parity.test.ts` | `// is one-shot at win and pricing it off a monthly stream would double-count it.` | Comment rewrite, same paragraph. |
| 4 | `sale-wizard-edit.test.tsx` | `{ personId: undefined, personName: 'Dev Externo', role: 'Operacional', costBrl: 50000 },` | Not a deletion: the single-line object literal was reflowed to multi-line to add `costSplitBp: null`. All four original keys survive verbatim in the replacement. |
| 5 | `sale-wizard-funcao-costs.test.tsx` | `// A professional_cost payable is one-shot at win, so a monthly stream must not` | Comment rewrite. |
| 6 | `sale-wizard-funcao-costs.test.tsx` | `// enter its base.` | Comment rewrite, same paragraph. |

Net: `727 insertions, 6 deletions` across six test files, of which 693 lines are the new `sale-wizard-professional-split.test.tsx`.

## 11. Findings (non-blocking)

**F1 - `Personalizar divisão`'s seed VALUES are untested (real coverage gap).**
PROBE-A replaced `onChange([...weightsBp])` with `onChange(weightsBp.map(() => 0))` and all twelve tests still passed. The suite pins only that the seed has the right LENGTH (test 8 finds three parts, test 11 finds two). The behaviour itself is correct - a throwaway test confirmed the four parts seed to `10` / `20` / `20` / `50` over a 10k/20k/20k/50k plan - but nothing in the repo would catch a regression that seeded zeros, equal weights, or anything else. Suggested fix: one assertion on the seeded input values in test 8, which already clicks `Personalizar divisão` on a three-parcela plan.

**F2 - one new `personName.trim()`, display-only.**
`ProfessionalSplitPanel.tsx:68` `const label = personName.trim();`, used solely as `Detalhe de pagamento{label ? \` · ${label}\` : ''}`. This is a rendering nicety on a prop inside a new presentational component: it gates no control, decides nothing about persistence, and cannot drift into the persistence question. `professionalRowWillPersist` remains the sole predicate that decides whether a professional row is written. Reported explicitly because it is a literal grep hit against the slice-04 rule; judged non-blocking on the rule's stated intent ("the SOLE personName predicate"). Flagging it so the call can be overridden if the strict reading is wanted.

**F3 - two small imprecisions worth knowing.**
(a) `CLAUDE.md` says an override must have "between 1 and `installmentRows.length` parts"; the code actually uses `Math.max(1, splitParcelaCount)` where `splitParcelaCount` is `installmentRows` filtered to `amountCents > 0`. Because `planRowsValid` forbids a non-positive amount before step 3, the two coincide for every reachable state - accurate in effect, loose in letter.
(b) WYSIWYG has one narrow edge the slice does not introduce and does not close: the panel binds part *i* to `installmentRows[i]` in array order, while `resolveProfessionalSplit` binds part *i* to the *i*-th receivable **sorted by `dueDate`**. Generated plans are always chronological, so the two agree; they can diverge only if the operator hand-edits a parcela date so the rows fall out of date order, in which case the dates printed beside the parts would not be the dates the payables land on. Pre-existing in shape since slice 05/06. Roadmap candidate, not a slice-07 defect.

## 12. Tree state

Every mutation and probe was reverted; the throwaway test file and the scratch worktree were deleted.

```
$ git status --short
?? .vscode/
?? nexo/plans/batch-20260804-props-costs/
?? nexo/runs/batch-20260804-props-costs/…        (pre-existing run artifacts)
$ git diff --stat
(empty)
$ git worktree list
/Users/cauetpinciara/…/06--PRODUCT--fxl-sales  46a7266 [feat/07-professional-split-ui]
```

No commit, no merge.
