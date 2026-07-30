# exec-04 - step-2 `Plano de pagamento` header alignment

Slice: `04-wizard-plano-layout`
Branch: `feat/04-wizard-plano-layout`
Plan: `nexo/plans/batch-01K9NX4QPTUI0730CADPRODWIZ/04-wizard-plano-layout.md`

Layout only.
Zero state, zero handler, zero exported function, zero user-visible copy change beyond relocating one existing hint line under the control it describes.

## What changed

Three files, all under `apps/web/src/sales-ops`.

### `SalesOpsApp.tsx` (inside `SaleWizardDialogBody`, step-2 card)

1. The two-column header grid `grid gap-[9px] md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]` became `grid gap-x-[9px] gap-y-3 md:grid-cols-3`.
2. The `Recorrência` `FieldBlock` moved out of its `mt-[14px]` sibling `div` and into that grid as the third child.
   Its `w-[132px]` wrapper `div` is gone, so the Combobox fills its column; the `Combobox` trigger already carries `w-full`.
3. The `mt-[14px]` wrapper `div` is deleted.
   The `recurringMode === 'monthly'` sub-block is now a direct sibling of the grid, wrapped as `{recurringMode === 'monthly' ? (<div className="mt-3"> … </div>) : null}` in place of the old fragment.
4. The entrada mode Combobox wrapper `w-[132px] flex-none` became `entradaMode === 'none' ? 'flex-1' : 'w-[116px] flex-none'`, so the column reads as one filled 44px control when there is no value input beside it.
5. `Parcelas restantes` lost `w-[72px] text-center` and gained `pr-8` inside a `relative` wrapper; the bare `<span>x</span>` became the same absolutely-positioned suffix span `UnitInput` ships.
   `aria-label`, `min`, `max`, `type`, `value` and `onChange` are byte-identical.
6. Both derived-line `div`s dropped **only** the `text-right` token: `'sales-ops-num text-right text-[12.5px] font-bold'` to `'sales-ops-num text-[12.5px] font-bold'`.
   Colours, `sales-ops-num`, size, weight and both ternary expressions untouched.
7. The recurring sub-grid `mt-[9px] grid gap-3 md:grid-cols-3` became `grid gap-x-[9px] gap-y-3 md:grid-cols-3`, identical template and gutter to the header grid.
8. `Deixe em branco para prazo indeterminado` moved out of its own full-width `div` and into the `<Field label="Nº de ciclos">` block as `<span className="text-[11.5px] text-[#8b8b92]">`, immediately after that `Input`.
   The string is verbatim.
   `Field` renders a `<label>` and a `<span>` is not a labelable element, so no second labelable child was created.
9. `Parcelas a receber` column-header row dropped `px-0.5`, which the body rows never had, so the 2px offset between a column label and its column is gone.
10. Both table `cn` calls dropped the dead `h-10 rounded-[9px]` prefix.
    `cn` is `twMerge(clsx(...))` and `formInputClass` (`h-11 rounded-[10px]`) came after it in both calls, so tailwind-merge already resolved both conflicts in favour of the later token: zero rendered-pixel change, and the source stops claiming a 40px row.

Nothing else in the card moved.
The amber `planPendingRegeneration` confirm bar, the `Soma das parcelas` footer, the `planDeltaCents` warning, the four-column table template and every table `aria-label` are outside the diff.

### `__tests__/sale-wizard-payment-plan.test.tsx`

Added the `planHeaderGrid()` helper and two `it` blocks (plan §5.1).

### `__tests__/sale-wizard-ui-contract.test.tsx`

Added one `it` block (plan §5.2).
Note: the plan named this file `.test.ts`; on disk it is `.test.tsx`.
Same file, same substring idiom.

## Red-then-green evidence

### Red - oracles written and run BEFORE any source change

`pnpm vitest run src/sales-ops/__tests__/sale-wizard-payment-plan.test.tsx src/sales-ops/__tests__/sale-wizard-ui-contract.test.tsx`

```
   ✓ sale wizard payment plan > generates a single row for tudo pago em 1x 31ms
   × sale wizard payment plan > aligns the three declarative header controls on one grid with each derived line under its own control 8ms
     → expected 'grid gap-[9px] md:grid-cols-[minmax(0…' to contain 'md:grid-cols-3'
   × sale wizard payment plan > keeps the recorrência sub-fields below the header grid, not inside it 11ms
     → expected 'Nº de ciclos' to contain 'Deixe em branco para prazo indetermin…'
...
 ❯ src/sales-ops/__tests__/sale-wizard-ui-contract.test.tsx:392:24
    392|     expect(source).not.toContain('md:grid-cols-[minmax(0…

 Test Files  2 failed (2)
      Tests  3 failed | 17 passed (20)
```

All three failures are the real reason, not a broken query:
the header grid genuinely carried the two-column template, the `Nº de ciclos` `<label>` genuinely did not contain the hint, and the source genuinely still carried the two-column class.

### Green - same command after the change

```
 ✓ src/sales-ops/__tests__/sale-wizard-ui-contract.test.tsx (6 tests) 55ms
 ✓ src/sales-ops/__tests__/sale-wizard-payment-plan.test.tsx (14 tests) 161ms
 Test Files  2 passed (2)
      Tests  20 passed (20)
```

### Definition of done

```
pnpm run lint        → apps/api lint: Done / apps/web lint: Done
pnpm run type-check  → shared-types, shared-utils, apps/api, apps/web: Done
pnpm test            → packages/shared-utils  Test Files  2 passed (2)   Tests  23 passed (23)
                       apps/api               Test Files 29 passed (29)  Tests 300 passed (300)
                       apps/web               Test Files 39 passed (39)  Tests 368 passed (368)
```

Baseline was 365 web tests across 39 files and 300 api tests across 29 files.
Web is 368 = 365 + the 3 new oracle tests, same 39 files.
API is unchanged at 300/29.
Nothing was lost.

## Behavior-unchanged checklist

Every item confirmed against `git diff`, which is the authority: if a line is not in the diff, it did not change.

- [x] `PaymentPlanShape` - `git diff --stat -- apps/web/src/sales-ops/calculations.ts` is **empty**. The type is untouched; no field added, removed or renamed.
- [x] `entradaCentsFor` - same zero diff. Its single call site is outside the edited JSX range and is not in the diff.
- [x] `generateInstallmentPlan` - same zero diff. Its call site inside `regeneratePlan` is not in the diff.
- [x] `inferPaymentPlanShape` - same zero diff. The edit-path seeding is not in the diff.
- [x] `defaultPlanShapeForProduct` - same zero diff. The render-phase product-template guard is not in the diff.
- [x] `restanteCountFor` / `maxRemainingInstallments` / `MAX_PLAN_INSTALLMENTS` - same zero diff. `max={maxRemainingInstallments(entradaMode)}` and `min={1}` survive verbatim on the `Parcelas restantes` input, and `max={MAX_PLAN_INSTALLMENTS}` / `min={1}` survive verbatim on `Número de ciclos`.
- [x] `planDirty` - `grep -c 'markPlanDirty();'` returns **2**, the same two call sites (the table's date and amount `onChange`). Neither appears in the diff. No header control gained or lost one, and the `Forma` picker still deliberately has none - the `{/* No markPlanDirty: forma carries positionally through a regeneration. */}` comment is untouched.
- [x] The amber confirm bar - `planPendingRegeneration`, `regeneratePlan`, `keepEditedRows` and the `Aplicar` / `Manter parcelas` buttons produce no diff lines at all. The `does not silently discard a hand-edited row when a header control changes` test, which drives the whole `Aplicar` / `Manter parcelas` cycle, passes untouched.
- [x] `appliedPlanKey` / `currentPlanKey` - `git diff … | grep -E '^[-+].*appliedPlanKey'` returns nothing. Not read or written by any edited line.
- [x] Blank-`Número de ciclos`-means-indefinite - `recurringIndefinite = recurringCycles.trim() === ''` is not in the diff. The input keeps `placeholder="Indeterminado"`, `min={1}`, `max={MAX_PLAN_INSTALLMENTS}` and its `onChange`. The hint string moved position, not content. No checkbox introduced; the `generates no bounded rows for an indefinite recorrencia` test still passes and the new oracle now pins the hint to that control's `<label>`.
- [x] The exact-sum invariant - `splitInstallmentsEqually` and every consumer live in `calculations.ts` (zero diff) and in the unedited computation block above the JSX. The `Soma das parcelas` footer and the `planDeltaCents` warning produce no diff lines. `payment-plan-generation.test.ts` and `calculations.test.ts` both pass unedited.
- [x] No `useState`, `useEffect`, `useMemo` or handler added, removed, reordered or re-deped - `git diff … | grep -E '^[-+].*(useState|useEffect|useMemo)'` returns nothing.
- [x] No `aria-label` changed - the only `aria-label` lines in the diff are `Recorrência`, `Valor da mensalidade`, `Início da recorrência` and `Número de ciclos`, each appearing as a `-`/`+` pair whose sole difference is leading indentation from the dedent. Every value is byte-identical, which is what keeps the six existing DOM suites green.
- [x] No user-visible string added or altered - `Deixe em branco para prazo indeterminado` is relocated verbatim inside its `Field`. Every other label, hint and message is untouched; the `Nº` / `Vencimento` / `Valor` / `Forma` header spans are unchanged apart from their parent's `px-0.5`.
- [x] `calculations.ts` has **zero** diff - `git diff --stat -- apps/web/src/sales-ops/calculations.ts` prints nothing.
- [x] `payment-plan-generation.test.ts` has **zero** diff and passes untouched - `git diff --stat` on it prints nothing, and it is inside the 39 green web test files.
- [x] `packages/shared-utils/src/sale-financials.ts` has zero diff - `git diff --stat` on it prints nothing.

Final `git status --short` for tracked files:

```
 M apps/web/src/sales-ops/SalesOpsApp.tsx
 M apps/web/src/sales-ops/__tests__/sale-wizard-payment-plan.test.tsx
 M apps/web/src/sales-ops/__tests__/sale-wizard-ui-contract.test.tsx
```

`git diff -w --stat` on the source is 31 insertions / 21 deletions; the raw 212-line count is the dedent of the recurring sub-block after its wrapper `div` was removed.

## Divergences

1. **File extension.**
   The plan named the source-contract oracle `sale-wizard-ui-contract.test.ts`.
   On disk it is `sale-wizard-ui-contract.test.tsx` (it renders, so it needs JSX).
   Added the `it` block there.
   No other interpretation was available and the plan's substring idiom applies unchanged.

2. **`npx prettier` is not this repo's formatter - do not run it.**
   Mid-implementation I ran `npx prettier --write` on the three edited files.
   Prettier is **not** a dependency of this repo (no `prettier` in `node_modules`, not in any `package.json`), so `npx` fetched a newer major and reformatted 591 lines of `SalesOpsApp.tsx`, almost all of it unrelated to this slice.
   I reverted all three files with `git checkout --` and redid every edit by hand against the repo's existing style.
   The final diff above is the hand-made one; the prettier collateral is entirely gone.
   `pnpm run lint` does not run prettier, so nothing enforces it - worth knowing before the next slice reaches for it.

3. **Handed to slice 03, not fixed here (plan §6, out of scope).**
   `SalesOpsApp.tsx` builds an item-row class with a template string rather than `cn`:
   `` `sales-ops-num h-10 rounded-[9px] text-center ${formInputClass}` ``.
   With no tailwind-merge in that path both `h-10` and `h-11` land on the element and the winner depends on Tailwind's emitted source order.
   Slice 03 has already merged, so this observation now needs an owner - it is a real geometry bug on a step-1 control, not a style nit.

4. **No browser E2E was run.**
   The slice is layout-only with DOM oracles that assert the grid template, the grid membership of all three controls, the absence of `text-right` on both derived lines, the 44px geometry of all three header controls, and the hint's new parent.
   Standing up the dev server plus Hub auth for a class-level change the DOM suite already pins was not warranted.
   Visual confirmation of the rendered card is left to the Verify step if the operator wants it.
