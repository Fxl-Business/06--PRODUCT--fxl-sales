---
id: 04-wizard-plano-layout
milestone: v2.3.0
status: todo
depends_on: ["02-wizard-shell-footer"]
files_modified: []
acceptance: "given the proposta wizard on step 2, when the Plano de pagamento card renders, then Entrada, Restante and Recorrência sit in ONE three-column grid on a single left axis with each derived line left-aligned directly beneath the control it describes, while every generated parcela, the Soma das parcelas footer, the planDirty confirm bar and the blank-ciclos rule behave byte-for-byte as before"
---

# 04 - step-2 `Plano de pagamento` header alignment

Layout only.
No state, no handler, no exported function, no user-visible copy changes except relocating one existing hint line to sit under the control it describes.

## 1. Current state

All line numbers are against `apps/web/src/sales-ops/SalesOpsApp.tsx` at `master` (`ee249b2`), inside `SaleWizardDialogBody`.

### 1.1 The step-2 card

| Lines | What |
| --- | --- |
| 6308 | `{wizardStep === 2 ? (` opens |
| 6310 | card `<div className="rounded-[14px] border border-[#e8e8ec] bg-white p-4">` |
| 6311-6322 | title row: `Plano de pagamento` + the `Regerar plano` button (rendered only when `planDirty`) |
| 6324-6328 | the "declarative and always visible" comment |
| **6329** | **`<div className="grid gap-[9px] md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">`** - the two-column header grid |
| 6330-6359 | `<FieldBlock label="Entrada">`: control row (`Tipo de entrada` Combobox in a `w-[132px] flex-none` wrapper + conditional `UnitInput` for `Valor da entrada`), then the derived line |
| 6361-6388 | `<FieldBlock label="Restante">`: control row (`Parcelas restantes` `Input` at `w-[72px] text-center` + a bare `<span>x</span>`), then the derived line |
| 6389 | header grid closes |
| **6391** | **`<div className="mt-[14px]">`** - a SEPARATE, full-width sibling block |
| 6392-6403 | `<FieldBlock label="Recorrência">` with its Combobox in a `w-[132px]` wrapper |
| 6404-6483 | `{recurringMode === 'monthly' ? (<> ... </>) : null}`: the `md:grid-cols-3` sub-grid (`Mensalidade (R$)` / `Início` / `Nº de ciclos`) at 6406-6436, the `Deixe em branco para prazo indeterminado` line at 6437-6439, the validation lines at 6440-6452, the green `RotateCcw` summary at 6453-6466, the indefinite/bounded footnote at 6467-6481 |
| 6484 | the `mt-[14px]` sibling closes |
| 6486 | `Parcelas a receber` section opens (`mt-4 border-t border-[#eeeef1] pt-3`) |
| 6497-6521 | the amber `planPendingRegeneration` confirm bar with `Aplicar` / `Manter parcelas` |
| 6526 | table column-header row: `grid grid-cols-[44px_minmax(0,1fr)_150px_150px] gap-[9px] px-0.5 pb-[7px] ...` |
| 6538 | table body row: `grid grid-cols-[44px_minmax(0,1fr)_150px_150px] items-center gap-[9px]` - note: **no `px-0.5`** |
| 6547-6551 / 6562-6566 | the `Vencimento` / `Valor` inputs: `cn('sales-ops-num h-10 rounded-[9px]', formInputClass, ...)` |
| 6574-6583 | the `Forma` Combobox at `formSelectClass` |
| 6588-6595 | the `Soma das parcelas` footer |
| 6596-6601 | the `planDeltaCents !== 0` warning |

### 1.2 Why the three controls land on three different axes

`FieldBlock` (line 570-588) is `flex flex-col gap-[6px]`, so within one block the label, the control row and the derived line already stack correctly. The breakage is entirely at the level above.

**Axis 1 - `Entrada`.** Column 1 of a `1fr 1fr` grid, so the block starts at the card's left padding edge. Its control is only `132px + 9px + flex-1`, which does fill the column. Fine on its own.

**Axis 2 - `Restante`.** Column 2 of the same `1fr 1fr` grid, so the block *starts at the card's horizontal midpoint*. Its control is `72px + a bare "x"` ≈ 90px wide, so the visible control sits at the midpoint with ~250px of dead space to its right and ~150px of dead space between it and the Entrada control. That is the "large empty gap" and the "top-RIGHT" reading in the report.

**Axis 3 - `Recorrência`.** It is **not in the grid at all**. Line 6391 opens a sibling `<div className="mt-[14px]">` after the grid closed at 6389, so `Recorrência` is a full-width block starting back at the card's left edge, one row below, separated by `14px` instead of the grid's `9px` gutter. Three logical siblings, two different containers, three different left origins.

**The floating helper lines.** Both derived lines carry `text-right` (line 6353 and line 6376, both exactly `'sales-ops-num text-right text-[12.5px] font-bold'`). Inside a `1fr` grid column, `text-right` pins the text to the *column's* right edge, which is nowhere near the narrow control above it:

- `sem entrada` is right-aligned to the end of column 1 = the card's midpoint, so it reads as "floating mid-row" while its control sits at the far left.
- `1 x R$ 12,00` is right-aligned to the end of column 2 = the card's right edge, ~350px away from the `72px` input it describes.

So: the derived line is never under its control, and the third control is not on the grid.

### 1.3 Geometry audit (CLAUDE.md "UI Controls")

Every control in the step-2 card is already on the correct **44px form geometry** - no `comboboxTriggerClass` (40px `Filtros`-bar) leak anywhere:

| Control | Line | Class | Verdict |
| --- | --- | --- | --- |
| `Tipo de entrada` Combobox | 6335 | `formSelectClass` | correct (44px) |
| `Valor da entrada` UnitInput | 6343 → 3170 | `formInputClass` | correct (44px) |
| `Parcelas restantes` Input | 6365 | `formInputClass` | correct (44px) |
| `Recorrência` Combobox | 6396 | `formSelectClass` | correct (44px) |
| `Mensalidade` / `Início` / `Nº de ciclos` | 6410/6418/6427 | `formInputClass` | correct (44px) |
| table `Vencimento` / `Valor` | 6548 / 6563 | `cn('… h-10 rounded-[9px]', formInputClass, …)` | **dead tokens** - see below |
| table `Forma` Combobox | 6576 | `formSelectClass` | correct (44px) |

The one mismatch is a *stated* one, not a rendered one. `cn` is `twMerge(clsx(...))` (`apps/web/src/lib/utils.ts`), and `formInputClass` (line 172-173) carries `h-11 rounded-[10px]` and appears **after** the literal `'sales-ops-num h-10 rounded-[9px]'` in both `cn` calls. tailwind-merge resolves the `h-10`/`h-11` and `rounded-[9px]`/`rounded-[10px]` conflicts in favour of the later token, so those inputs already render at 44px / 10px radius, matching the `formSelectClass` `Forma` picker beside them. The `h-10 rounded-[9px]` prefix is dead code that misdescribes the row's geometry. Delete it (step 3.4) - this changes zero rendered pixels and is verified by the geometry assertions in the oracle.

The second real misalignment is 2px: the table's column-header row (6526) has `px-0.5` and its body rows (6538) do not, so `Nº / VENCIMENTO / VALOR / FORMA` sit 2px right of the columns they head. Fixed in step 3.4.

### 1.4 What `calculations.ts` contributes

`apps/web/src/sales-ops/calculations.ts` contains **no JSX and no Tailwind class**. Its exports consumed by this card are `entradaCentsFor` (313), `restanteCountFor` (342), `generateInstallmentPlan` (362), `inferPaymentPlanShape` (408), `defaultPlanShapeForProduct` (489), `maxRemainingInstallments` (338), `MAX_PLAN_INSTALLMENTS` (275), `PaymentPlanShape` (291), `PaymentPlanEntradaMode` (277), `addMonthsToIsoDate` (241), `installmentSumCents` (267). All are pure functions over numbers/strings. Nothing in this slice can reach them: the slice edits only JSX element structure and `className` strings inside `SaleWizardDialogBody`.

The derived values the card renders - `entradaCents` (5379), `restanteCents` (5380), `restanteCount` (5381), `restanteBaseCents` (5388), `restanteLastCents` (5389), `recurringMonthlyCents` (5390), `recurringIndefinite` (5392), `recurringCyclesCount` (5393), `recurringCyclesValid` (5394), `planSumCents` (5371), `planDeltaCents` (5372), `planPendingRegeneration` (5314) - are all computed **above** the JSX and are read verbatim by the new markup. Do not move, rename or recompute any of them.

## 2. Target layout

One grid. Three columns. One 9px gutter for the whole card. Every derived line left-aligned directly beneath the control it describes.

### 2.1 The header grid

Replace lines **6329-6403** (the two-column grid, the `mt-[14px]` opener and the `Recorrência` `FieldBlock`) with a single three-column grid holding all three `FieldBlock`s. The `recurringMode === 'monthly'` block (6404-6483) moves out to become a sibling **below** the grid, and the `mt-[14px]` wrapper `div` disappears.

```tsx
{/*
  Declarative and always visible: nothing to toggle and no per-row add or remove
  affordance. "50% de entrada + o resto em 3x" is two controls, and the table below
  follows them as they are typed.

  One grid, three columns, one 9px gutter - the same gutter the `Parcelas a receber`
  table below uses. Each control's derived line is the next child of its OWN
  `FieldBlock` and is left-aligned, so it sits under the control it describes instead
  of being pushed to that grid column's right edge.
*/}
<div className="grid gap-x-[9px] gap-y-3 md:grid-cols-3">
  <FieldBlock label="Entrada">
    <div className="flex items-center gap-[9px]">
      {/* With no value input beside it the picker takes the whole column, so all
          three columns read as one filled 44px control on one axis. */}
      <div className={entradaMode === 'none' ? 'flex-1' : 'w-[116px] flex-none'}>
        <Combobox
          aria-label="Tipo de entrada"
          className={formSelectClass}
          onChange={(value) => setEntradaMode(value as PaymentPlanEntradaMode)}
          options={entradaModeOptions}
          searchPlaceholder="Buscar tipo de entrada..."
          value={entradaMode}
        />
      </div>
      {entradaMode === 'none' ? null : (
        <UnitInput
          ariaLabel="Valor da entrada"
          onChange={setEntradaValueInput}
          unit={entradaMode === 'fix' ? 'R$' : '%'}
          value={entradaValueInput}
        />
      )}
    </div>
    <div
      className={cn(
        'sales-ops-num text-[12.5px] font-bold',
        entradaMode === 'none' ? 'text-[#9b9ba3]' : 'text-[#2f7d4b]',
      )}
    >
      {entradaMode === 'none' ? 'sem entrada' : formatMoneyBrl(entradaCents)}
    </div>
  </FieldBlock>

  <FieldBlock label="Restante">
    {/* Same suffix affordance as `UnitInput`, kept local because this input carries
        `min`/`max` clamps that `UnitInput` does not accept - routing it through the
        shared helper would silently drop them. */}
    <div className="relative">
      <Input
        aria-label="Parcelas restantes"
        className={`sales-ops-num ${formInputClass} pr-8`}
        max={maxRemainingInstallments(entradaMode)}
        min={1}
        onChange={(event) => setRestanteCountInput(event.target.value)}
        type="number"
        value={restanteCountInput}
      />
      <span className="pointer-events-none absolute right-[13px] top-1/2 -translate-y-1/2 text-[13px] font-bold text-[#9b9ba3]">
        x
      </span>
    </div>
    <div
      className={cn(
        'sales-ops-num text-[12.5px] font-bold',
        restanteCents === 0 ? 'text-[#9b9ba3]' : 'text-[#2f7d4b]',
      )}
    >
      {restanteCents === 0
        ? 'entrada cobre o total'
        : `${restanteCount} x ${formatMoneyBrl(restanteBaseCents)}${
            restanteLastCents === restanteBaseCents
              ? ''
              : ` (última ${formatMoneyBrl(restanteLastCents)})`
          }`}
    </div>
  </FieldBlock>

  <FieldBlock label="Recorrência">
    <Combobox
      aria-label="Recorrência"
      className={formSelectClass}
      onChange={(value) => setRecurringMode(value as 'none' | 'monthly')}
      options={recurringModeOptions}
      searchPlaceholder="Buscar recorrência..."
      value={recurringMode}
    />
  </FieldBlock>
</div>
```

Exact changes encoded above, and nothing else:

1. `md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]` → `md:grid-cols-3`; `gap-[9px]` → `gap-x-[9px] gap-y-3`.
2. The `Recorrência` `FieldBlock` moves inside that grid as the third child; its `w-[132px]` wrapper `div` is dropped so the Combobox fills its column.
3. The `w-[132px] flex-none` wrapper around the entrada mode Combobox becomes `w-[116px] flex-none`, or `flex-1` when `entradaMode === 'none'`.
4. The `Parcelas restantes` `Input` loses `w-[72px] text-center` and gains `pr-8` inside a `relative` wrapper; the bare `<span>x</span>` becomes the same absolutely-positioned suffix span `UnitInput` uses (line 3176-3178). `aria-label`, `min`, `max`, `type`, `value` and `onChange` are byte-identical to today.
5. Both derived-line `div`s drop **only** the `text-right` token. Colours, `sales-ops-num`, font size, weight and the ternary expressions are untouched.
6. `Recorrência` gets **no** derived line. Do not invent copy such as `sem recorrência` for grid symmetry - `FieldBlock` children stretch in a grid row, so a shorter third column is correct and adds no new user-visible string for the contract test to have to pin.

### 2.2 The recurring sub-block

Lines 6404-6483 move out of the deleted `mt-[14px]` wrapper and become a direct sibling **after** the header grid, wrapped as:

```tsx
{recurringMode === 'monthly' ? (
  <div className="mt-3">
    {/* ... 6406-6481 verbatim, with the two edits below ... */}
  </div>
) : null}
```

Two edits inside it, both layout-only:

- **6406**: `className="mt-[9px] grid gap-3 md:grid-cols-3"` → `className="grid gap-x-[9px] gap-y-3 md:grid-cols-3"`. Identical column template and gutter to the header grid, so `Mensalidade (R$)` sits under `Entrada`, `Início` under `Restante` and `Nº de ciclos` under `Recorrência` - the last pairing being exactly the semantic one.
- **6437-6439**: the `Deixe em branco para prazo indeterminado` line moves **inside** the `<Field label="Nº de ciclos">` block (6424-6435), immediately after its `Input`, as `<span className="text-[11.5px] text-[#8b8b92]">Deixe em branco para prazo indeterminado</span>`. It describes only that one control; today it spans the whole card. The string is unchanged verbatim. `Field` renders a `<label>` and a `<span>` is not a labelable element, so this does not create a second labelable child.

Everything else in 6440-6481 (the two validation messages, the green `RotateCcw` summary, the indefinite/bounded footnote) keeps its markup and its `mt-*` spacing exactly as-is.

### 2.3 `Parcelas a receber` and `Soma das parcelas`

Structurally unchanged. Two 2px/dead-token corrections only:

- **6526**: drop `px-0.5` from the table's column-header row so `Nº / VENCIMENTO / VALOR / FORMA` sit exactly over the body columns at 6538, which have no such padding.
- **6547-6551** and **6562-6566**: drop the dead `h-10 rounded-[9px]` from both `cn` calls, leaving `cn('sales-ops-num', formInputClass, showPlanErrors && !dateValid && 'border-destructive')` and `cn('sales-ops-num text-right', formInputClass, showPlanErrors && !amountValid && 'border-destructive')`. Renders identically (§1.3) and stops the source claiming a 40px row.

Do **not** touch: the `planPendingRegeneration` confirm bar (6497-6521), the `Soma das parcelas` footer (6588-6595), the `planDeltaCents` warning (6596-6601), the four-column table template, or any `aria-label` in the table.

## 3. Execution order

1. Rewrite 6329-6403 per §2.1.
2. Re-wrap 6404-6483 per §2.2 and relocate the `Deixe em branco...` line.
3. Delete the now-empty `</div>` that closed the `mt-[14px]` wrapper at 6484.
4. Apply the two corrections in §2.3.
5. Extend the oracles per §5.
6. `pnpm run lint && pnpm run type-check && pnpm test`.

## 4. Behavior-unchanged checklist

Tick each explicitly before handing off. Every item below must be verifiable as "no diff touches it".

- [ ] `PaymentPlanShape` (calculations.ts:291) - type untouched; no field added, removed or renamed.
- [ ] `entradaCentsFor` (calculations.ts:313) - not edited; still called once, at SalesOpsApp.tsx:5379, with the same arguments.
- [ ] `generateInstallmentPlan` (calculations.ts:362) - not edited; its call site inside `regeneratePlan` is not in the edited range.
- [ ] `inferPaymentPlanShape` (calculations.ts:408) - not edited; the edit-path seeding at ~5281 is not in the edited range.
- [ ] `defaultPlanShapeForProduct` (calculations.ts:489) - not edited; the render-phase product-template guard is untouched.
- [ ] `restanteCountFor` / `maxRemainingInstallments` / `MAX_PLAN_INSTALLMENTS` - not edited; `maxRemainingInstallments(entradaMode)` stays the `max` of the `Parcelas restantes` input, and `min={1}` stays.
- [ ] `planDirty` - `markPlanDirty` is called from exactly the same places (the table's date and amount `onChange`, 6553 and 6568); no header control gains or loses a `markPlanDirty` call, and the `Forma` picker still deliberately does not set it.
- [ ] The amber confirm bar - `planPendingRegeneration` (5314), `regeneratePlan`, `keepEditedRows`, and the `Aplicar` / `Manter parcelas` buttons are outside the edited range and are not moved.
- [ ] `appliedPlanKey` / `currentPlanKey` - not read or written by any edited line.
- [ ] Blank-`Número de ciclos`-means-indefinite - `recurringIndefinite = recurringCycles.trim() === ''` (5392) is untouched; the `Nº de ciclos` `Input` keeps `placeholder="Indeterminado"`, `min={1}`, `max={MAX_PLAN_INSTALLMENTS}` and its `onChange`; the hint string moves position but not content; no checkbox is introduced.
- [ ] No `useState`, `useEffect`, `useMemo` or handler is added, removed, reordered or given a new dependency.
- [ ] No `aria-label` changes anywhere. `Tipo de entrada`, `Valor da entrada`, `Parcelas restantes`, `Recorrência`, `Valor da mensalidade`, `Início da recorrência`, `Número de ciclos` and every `... da parcela N` label are byte-identical, which is what keeps the six existing DOM suites green.
- [ ] No user-visible string is added or altered. `Deixe em branco para prazo indeterminado` is relocated verbatim; every other label, hint and message is untouched.
- [ ] `calculations.ts` has **zero** diff.
- [ ] `packages/shared-utils/src/sale-financials.ts` has zero diff.

## 5. Oracles

### 5.1 Primary - DOM (fails before, passes after)

Add to `apps/web/src/sales-ops/__tests__/sale-wizard-payment-plan.test.tsx`, in that file's existing idiom (`container.querySelector` + `aria-label`, no `data-testid` - production source in this repo carries none and must not start).

Add one helper beside `comboboxTrigger`:

```tsx
/** The single grid the three declarative header controls share. */
function planHeaderGrid(): HTMLElement {
  const grid = comboboxTrigger('Tipo de entrada').closest('div.grid');
  if (!(grid instanceof HTMLElement)) throw new Error('plan header grid not found');
  return grid;
}
```

Then:

```tsx
it('aligns the three declarative header controls on one grid with each derived line under its own control', async () => {
  await click(buttonByText('Avançar'));

  const grid = planHeaderGrid();
  // One grid, three columns: `Recorrência` used to live in a sibling block below.
  expect(grid.className).toContain('md:grid-cols-3');
  expect(grid.querySelector('input[aria-label="Parcelas restantes"]')).not.toBeNull();
  expect(grid.querySelector('button[role="combobox"][aria-label="Recorrência"]')).not.toBeNull();

  // Each derived line is a child of its own FieldBlock and is NOT pushed to that
  // grid column's right edge, which is what made it float across the card.
  const hints = [...grid.querySelectorAll('div')].filter((node) =>
    ['sem entrada', '1 x R$ 2.500,00'].includes(node.textContent?.trim() ?? ''),
  );
  expect(hints).toHaveLength(2);
  for (const hint of hints) expect(hint.className).not.toContain('text-right');

  // Form geometry, not the 40px `Filtros` bar: every header control is 44px.
  expect(comboboxTrigger('Tipo de entrada').className).toContain('h-11');
  expect(comboboxTrigger('Recorrência').className).toContain('h-11');
  expect(labeledInput('Parcelas restantes').className).toContain('h-11');
});

it('keeps the recorrência sub-fields below the header grid, not inside it', async () => {
  await pickOption('Produto / serviço do item 1', 'FXL Advisor');
  await click(buttonByText('Avançar'));
  expect(comboboxText('Recorrência')).toBe('mensal');

  const grid = planHeaderGrid();
  expect(grid.querySelector('input[aria-label="Valor da mensalidade"]')).toBeNull();
  expect(grid.querySelector('input[aria-label="Número de ciclos"]')).toBeNull();

  // The hint belongs to the control it describes.
  const ciclos = labeledInput('Número de ciclos').closest('label');
  expect(ciclos?.textContent).toContain('Deixe em branco para prazo indeterminado');
});
```

Failure mode today: the first test throws/fails on `md:grid-cols-3` and on the `Recorrência` combobox being absent from the grid, and on both hints carrying `text-right`. The second fails on the `Deixe em branco...` assertion. Both pass after the change.

The default fixture total is `2500,00` with `entradaMode: 'none'` and `restanteCount: 1`, so the two hints are exactly `sem entrada` and `1 x R$ 2.500,00` (existing tests at that file's line ~288 already assert both `nenhuma` and `sem entrada` on this fixture). If `formatMoneyBrl` output differs in the executor's run, read the real value off `container.textContent` rather than loosening the assertion to a substring.

### 5.2 Secondary - source contract

Add to `apps/web/src/sales-ops/__tests__/sale-wizard-ui-contract.test.ts` as a new `it` block, in that file's substring idiom:

```ts
it('keeps the step-2 payment plan header on one grid with no right-flown derived lines', () => {
  /*
    Both negatives below were real strings in this file before the alignment fix, so
    each is about markup that was removed rather than markup that never existed. The
    structural claim itself is asserted in the DOM by `sale-wizard-payment-plan.test.tsx`,
    where it can actually fail.
  */
  // The two-column header grid that put `Recorrência` on its own row underneath.
  expect(source).not.toContain('md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]');
  // The derived lines pinned to their grid column's right edge.
  expect(source).not.toContain('sales-ops-num text-right text-[12.5px] font-bold');
  // Positive control: the derived lines still exist, just left-aligned.
  expect(source).toContain('sales-ops-num text-[12.5px] font-bold');
  expect(source).toContain('entrada cobre o total');
});
```

`md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]` is unique to line 6329 - the other `minmax(0,1fr)_minmax(0,1fr)` occurrences (6638, 6661) are the four-column `grid-cols-[minmax(0,1fr)_minmax(0,1fr)_150px_36px]` template and are not matched by the fuller string. Do not shorten the negative.

### 5.3 Must pass untouched

`apps/web/src/sales-ops/__tests__/payment-plan-generation.test.ts` imports only `defaultPlanShapeForProduct`, `entradaCentsFor`, `generateInstallmentPlan`, `inferPaymentPlanShape` and `PaymentPlanShape` from `../calculations`, and never imports `SalesOpsApp`. This slice's diff does not reach `calculations.ts` at all (§1.4), so the file must pass with **zero edits**.

> **If executing this plan requires editing `payment-plan-generation.test.ts`, stop.** That means generation semantics moved, which puts the work outside this slice. Report it rather than adjusting the test.

Also expected green untouched: `sale-wizard-edit.test.tsx`, `sale-wizard-overrides.test.tsx`, `sale-wizard-commission-defaults.test.tsx`, `sale-wizard-funcao-costs.test.tsx`, `sale-wizard-state-preservation.test.tsx`, `sale-wizard-free-items.test.tsx`, `combobox-adoption.test.tsx`, `calculations.test.ts` - all of which reach step 2 through the same `aria-label`s this slice preserves.

## 6. Risks

- **JSX nesting slip.** The edit deletes one wrapper `div` (`mt-[14px]`, opened 6391, closed 6484) while moving its two children to different parents. Miscounting the closing tags is the single most likely failure and shows up as a `type-check` error, not a silent one. Do the rewrite as one contiguous replacement of 6329-6484, not as three separate edits.
- **`closest('div.grid')` in the oracle.** The selector matches the exact class token `grid`, so `grid-cols-3` on the same element does not confuse it and no `Combobox`-internal wrapper carries a bare `grid` class. If the shadcn `Combobox` trigger ever gains one, the helper would grab the wrong ancestor - it throws rather than silently passing, so the failure is loud.
- **`pr-8` on a `type="number"` input.** OS spin buttons are already suppressed by the base-layer rule in `apps/web/src/index.css` (CLAUDE.md "UI Controls"), so `pr-8` clears only the `x` suffix and cannot collide with a spinner. Same construction `UnitInput` already ships with `pr-11`.
- **Column semantics after `md:grid-cols-3`.** `Nº de ciclos` landing under `Recorrência` is intentional and correct; `Mensalidade` under `Entrada` and `Início` under `Restante` are incidental but harmless, since the sub-block only renders when `recurringMode === 'monthly'` and is visually separated by its own `mt-3`.
- **Below `md`.** The grid collapses to one column at small widths, which it already does today. The three blocks then stack with a `gap-y-3` rhythm, each hint still under its own control. No `sm:` breakpoint work is needed.
- **Out of scope, flag only.** `SalesOpsApp.tsx:6197` builds a class with a template string rather than `cn`: `` `sales-ops-num h-10 rounded-[9px] text-center ${formInputClass}` ``. Because that path has no tailwind-merge, both `h-10` and `h-11` land on the element and the winner depends on Tailwind's emitted source order. That is a step-1 item-row control and belongs to slice `03-wizard-itens-row`; do not fix it here, but hand the observation to that slice.
