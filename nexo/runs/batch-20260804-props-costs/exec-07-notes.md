# exec-07 — professional split UI

Slice: `07-professional-split-ui`.
Branch: `feat/07-professional-split-ui`.
Status: PASS.

## What landed

The last piece of the user's request: `Detalhe de pagamento`, a per-professional payment-schedule panel inside step 3 `Custos e margem`.

A professional row now carries a `costSplitBp` (basis points, `null` = default pro-rata) and a `splitOpen` disclosure flag, both REQUIRED on `ProfessionalForm`.
The trigger is the last child of the existing `CUSTO ALOCADO` cell and reads `Detalhe de pagamento (Nx)`.
Opening it shows either the read-only default pro-rata (one line per parcela, with its date, its percentage and its reais, plus a `Total`) or, after `Personalizar divisão`, an editable list of parts in percent with the resolved reais and the bound parcela date beside each.
`+ parte`, `Remover parte N`, `Distribuir igualmente`, `Usar padrão` and a live `Soma` line complete it.
`canAdvanceStepThree` now also requires `professionalSplitsValid`, and a second red bar reads `A divisão de pagamento de cada profissional deve somar 100%.`

WYSIWYG holds by construction: the panel calls the SAME `defaultSplitBp` / `splitCentsByWeights` from `@fxl-sales/shared-utils/professional-split` (the SUBPATH, never the root) that `resolveProfessionalSplit` calls server-side, over `installmentRows` — which is exactly the set the server's `isRecurringReceivableLabel` filter leaves.

## Deviations from the plan, and why

### 1. The panel is its own module, not inline JSX

The plan put the panel inline as a `col-span-full` sibling inside the row `div`.
It still IS a `col-span-full` sibling of that row, but the ~200 lines live in `apps/web/src/sales-ops/ProfessionalSplitPanel.tsx` and the wizard renders `<ProfessionalSplitPanel … />`.

Two reasons.
`SalesOpsApp.tsx` is 8215 lines and inlining would have made this slice's footprint in the file about 220 lines rather than about 60, which is the opposite of the "touch as little of the professionals table as possible" mitigation the plan itself argues for.
And it is what made the zero-parcela guard assertable — see 3.

The constraint the caller cared about is unchanged: NO grid-template string was edited, NO column header was added, and the only insertions in the table are one button at the end of the cost cell and one element after the remove button.

### 2. `splitParcelaCount` excludes zero-amount rows

The plan's `splitReceivableAmounts = installmentRows.map(parse…)`.
Shipped: the same map, then `.filter((row) => row.amountCents > 0)`.

A zero-amount row is not a parcela anyone is paid from, and a TRAILING zero-weight row would absorb the entire floor remainder of the bp vector under `splitCentsByWeights`'s last-part rule — the panel would then print the whole cost against a parcela worth nothing.
Step 2's `planRowsValid` already requires every amount `> 0` before step 3 is reachable, so the filter drops nothing in practice; it only makes the degenerate case honest.

### 3. The zero-parcela state is UNREACHABLE through the wizard

The plan says "`splitParcelaCount === 0`. Reachable while step 2 is mid-edit." It is not, and this was checked exhaustively:

- `canSaveBasics` requires `totalCents > 0`, so step 1 will not advance with a blank item.
- `planRowsValid` requires EVERY parcela amount `> 0` and `planDeltaCents === 0`, so step 2 will not advance with a blank or zeroed row.
- `WizardStepper` renders `disabled={!isEnabled(step)}` and `isEnabled(3)` is `canAdvanceStepOne && canAdvanceStepTwo`, so the header cannot jump past those gates either.
- `generateInstallmentPlan` never returns an empty array (`if (rows.length === 0) rows.push(...)`).
- The only unconditional `setWizardStep(3)` is the step-4 `editar` link, and reaching step 4 already required passing step 2.

So the operator cannot be on step 3 with no usable parcela.
The guard stays — it is the wizard's mirror of the server's `m === 0` one-shot fallback, and it is cheaper than reasoning about it again later — but the twelfth test renders `ProfessionalSplitPanel` DIRECTLY with `parcelas: []` rather than pretending the wizard can get there.
That is the second reason the panel is its own module.

### 4. Line numbers, as warned

Every one of the plan's line references was stale after 03 / 04 / 06.
Located by surrounding code instead:

- `ProfessionalForm` is at ~5118, not 5034; it already carried `funcaoId` / `funcaoName` / `costUnit` / `costPct` / `costManual` from 03.
- The grid template is `[minmax(0,1fr)_minmax(0,1fr)_212px_36px]` with FUNÇÃO first (03), not the plan's assumed order — irrelevant, because nothing here reads it.
- There are exactly THREE `ProfessionalForm` construction sites, as the plan predicted: the `+ profissional` handler, `deriveWizardPrefill`, and 04's `planFuncaoCostSeeds` guard. Making both new fields non-optional caught all three at compile time.
- `professionalsValid` is already split into `professionalFuncoesValid` / `professionalPeopleValid` (03), so `canAdvanceStepThree` became `professionalsValid && professionalSplitsValid` rather than the plan's two-term expression.
- `createPayload` already filters through `persistedProfessionals` (04's fix). `costSplitBp` was added INSIDE the mapped object; no second `personName` check was introduced anywhere, and `professionalRowWillPersist` remains the single predicate.

### 5. `ProfessionalForm.costUnit`'s comment did not contain the false premise

The plan pointed at `SalesOpsApp.tsx:5042-5046` for a "one-shot at win with `receivableId: null`" repair.
That comment (now ~5125) never contained the premise; it argues from `cost_brl` being a single integer-cents column.
It was extended rather than rewritten, to state the CONTRAST that this slice creates: a unit is how a number was typed and nothing re-evaluates it, while a split is a rule that must survive a later `costBrl` edit.

CLAUDE.md's own copies of the premise had already been rewritten by slice 06, so §2h's CLAUDE.md work was a no-op; only the three new bullets from §5 were appended.

### 6. Six existing payload assertions needed a line each

`buildSalePayload` now emits `costSplitBp: null` on every professional, so six whole-object `toEqual` / `toHaveBeenCalledWith` assertions failed until the key was added: one in `combobox-adoption.test.tsx`, two in `calculations.test.ts`, two in `sale-wizard-edit.test.tsx`, two in `sale-wizard-funcao-costs.test.tsx`.
Each got the key plus a sentence on why an explicit `null` and not an omitted key — on an UPDATE, `null` is what CLEARS a stored override, which is what `Usar padrão` means.

## New pure helpers

In `calculations.ts`, all pure and all covered by the panel tests:

- `formatIsoDateBr` — `2026-07-13` -> `13/07/2026`. `displayDate` in `SalesOpsApp.tsx` now delegates to it, so the app has one date formatter.
- `formatSplitPercent` — `3000` -> `30,00%`, the display form.
- `bpToPercentInput` — `3334` -> `'33.34'`, the `type="number"` edit form.
- `percentInputToBp` — the inverse, clamped to `[0, SPLIT_BP_TOTAL]` because the API declares each part `int().min(0).max(10_000)`. It deliberately does NOT enforce the sum: adding or removing a part must be able to break it so the `Soma` line goes red, exactly as step 2's `Soma das parcelas` behaves.

`calculations.ts` now imports `SPLIT_BP_TOTAL` from the shared subpath rather than restating `10000`.

## Red proof for the load-bearing test

`it('keeps the override when the cost changes')` is the test that justifies basis points, so it was proven to discriminate rather than assumed to.
With the panel temporarily patched to resolve its parts against the cost the schedule was authored at — which is what a cents-denominated `cost_split_bp` would store — the test fails on exactly the intended assertion:

```
AssertionError: expected '…Parte 1%= R$ 3.000,0004/08/2026…' to contain 'R$ 6.000,00'
```

The panel still read `R$ 3.000,00 / R$ 7.000,00` after `CUSTO ALOCADO` went from R$ 10.000,00 to R$ 20.000,00.
The patch was reverted and the whole file re-run green.

Honest note on method: the twelve tests were authored before the implementation, but the implementation landed before the full red run was captured, so only this one test has a recorded counterfactual.

## Scope limits held

No `R$` input mode per part, no per-part date override, no `other_cost` panel, no split on the recorrência, no new dialog, no `useInlineLayer` (the panel is in flow, mirroring `SaleItemForm.descriptionOpen`), and no second `Alterado manualmente` chip in the cost cell.
`#6a6a72` throughout for muted text; no new instance of the failing `#8b8b92`.

## Gates

```
pnpm run build:packages   ok
pnpm run lint             ok
pnpm run type-check       ok
pnpm test                 shared-utils 80/80, api 328/328, web 531/531
pnpm run build            ok
```

All run-once. No process left behind.
