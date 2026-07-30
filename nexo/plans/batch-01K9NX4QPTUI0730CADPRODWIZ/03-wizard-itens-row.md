---
id: 03-wizard-itens-row
milestone: v2.3.0
status: todo
depends_on: ["02-wizard-shell-footer"]
files_modified: []
acceptance: "given step 1 of the proposta wizard with two items, when the operator looks at the Itens block, then each column label sits exactly over the control it names, each item is one bounded block, and a row whose description is optional shows a `+ Adicionar descrição` affordance instead of an always-open label plus input; clicking it reveals the focused input, while a row whose description is required (open-price produto, item avulso) and a row prefilled from `productNameSnapshot` still render the input open."
---

# 03 - wizard step 1 `Itens` row alignment and opt-in description

## Reported defect

> its not with a good align the 'itens' section of the step 1, its not horizontal aligned, also the 'description' breaks the line and looks like to be another line of product, we must clearly view that is about one product only, and also make the description an option to do like 'adicionar descrição' instead of showing directly

## Current state

All of it is in `apps/web/src/sales-ops/SalesOpsApp.tsx`, inside `SaleWizardDialogBody` (declared at line 4965), in the `wizardStep === 1` branch.

| Lines | What is there |
| --- | --- |
| 6014-6043 | The `Itens` card shell: `rounded-[14px] border border-[#e8e8ec] bg-white p-4`, then the header strip with `Cadastrar produto` / `+ item avulso` / `+ item`. |
| 6044-6050 | The column header row. |
| 6051 | The item list wrapper, `flex flex-col gap-2`. |
| 6053-6139 | The `item.kind === 'free'` branch (item avulso). |
| 6142-6285 | The catalog-product branch. |
| 6290-6304 | `Observações` and the `Total da proposta` strip that follow the card. |

### The layout mechanism today

There is no shared grid. The template string `grid-cols-[minmax(0,1fr)_70px_130px_120px_36px] gap-[9px]` is copy-pasted six times, at lines 6044, 6060, 6104, 6166, 6229 and 6277. Each copy is an independent `<div>`: the header, the free row's control line, the free row's description line, the product row's control line, the product row's description line, and the product row's área-error line.

### Why the header labels drift out of alignment

Three separate causes, all of which have to be fixed together.

1. **Column-edge labels over padding-inset controls.** The header cells at 6045-6048 carry only `px-0.5` on the wrapper, so `Produto / serviço` starts 2px from the column's left edge. The `Combobox` below it uses `formSelectClass`, whose `comboboxTriggerClass` base carries `px-3`, so the trigger's own text starts 12px in. The label is therefore 10px to the left of the value it names. The same happens in reverse on `Valor unit.`: the header is `text-right` and flush to the column's right edge, while the `Input` under it is `text-right` inside `px-3`, so the number sits 12px further left than its label. Only `Subtotal` happens to line up, because the cell under it is a bare `<div>` with no padding.

2. **Vertical misalignment inside the control row, which is what "not horizontal aligned" is actually describing.** Line 6166 is `items-center`, and column 1 at 6167-6194 is a `flex flex-col gap-1` holding the 44px `Combobox` plus the ~20px área badge, so column 1 is roughly 68px tall while every other cell is 40px. `items-center` then centres the 40px cells against the 68px column, pushing `Qtd.`, `Valor unit.` and `Subtotal` about 14px below the produto picker. The picker and the numbers visibly sit on different baselines.

3. **Two different control heights on one row.** `formSelectClass` is `h-11` (44px) by construction, and CLAUDE.md states it is 44px precisely "matching `formInputClass` so a picker and the `Input` beside it line up". The item row breaks that on purpose: the `Input`s at 6197, 6207 and 6083 prepend `h-10 rounded-[9px]`, and `cn`'s tailwind-merge lets the later token win, so they render 40px with a 9px radius next to a 44px, 10px-radius picker.

### Why the description reads as a second product

The description block at 6229-6274 is its OWN five-column grid, a sibling of the control row, separated only by `gap-[5px]`, and the item list separates whole items by `gap-2` (8px). 5px inside an item versus 8px between items is not a legible difference, so the description line, its `Nome / descrição do item (opcional)` caption and the amber hint at 6268-6272 read as a second product row. Nothing bounds one item.

### The description field's three regimes

`productRowRequirements` (5572-5581) is the single source of truth:

- `hasVariableValue = openPrice || isService` gates whether the description block renders at all (6228).
- `needsDescription = hasVariableValue && !isService`, i.e. an open-price produto that is not a Serviço REQUIRES the description; that is what `itemsValid` enforces at 5421-5423.
- A Serviço has `hasVariableValue: true` and `needsDescription: false`: the description is genuinely optional, because `saleItemDisplayName` (5583-5592) falls back to the catalog name.
- A fixed-price Produto renders no description field at all.

For a free row the description is `item.customLabel` and it is REQUIRED: line 5415 gates advancement on `Boolean(item.customLabel.trim())` and 5787 sends `item.customLabel.trim() || 'Item avulso'` as `productName`. The free branch is a separate code path (6053-6139) with its own always-visible `Descrição do item` field.

So the ONLY regime that may be collapsed behind an affordance is the Serviço row. That is stated as a rule below.

### The edit path

`deriveWizardPrefill` (4833-4868) populates `items[].customLabel`:

- free rows (`!item.productId`): `customLabel: item.productNameSnapshot` verbatim, line 4851.
- product rows: `customLabel: product?.openPrice && item.productNameSnapshot !== product.name ? item.productNameSnapshot : ''`, lines 4861-4864.

So an edited proposta whose Serviço item carried a real description arrives with a non-empty `customLabel`, and an item whose snapshot merely echoed the catalog name arrives with `''`. The visibility predicate below ORs on `Boolean(item.customLabel.trim())`, so a prefilled description opens the input with no extra seeding and no reliance on a flag that `deriveWizardPrefill` would have to compute.

## Target design

### 1. One shared grid

Add three module-level constants immediately after `formSelectClass` (line 186), in the file's existing arbitrary-value idiom.

```ts
/**
 * The one grid the step-1 `Itens` header and every item row share. Before this
 * constant the template was copy-pasted six times and the header carried an extra
 * `px-0.5`, so a column label never sat exactly over the control it named.
 */
const saleItemGridClass = 'grid grid-cols-[minmax(0,1fr)_70px_130px_120px_36px] gap-[9px]';
/**
 * The header strip. `border border-transparent` reproduces the 1px border of the
 * item block below it and `px-3` reproduces that block's padding, so the header's
 * column edges land exactly on the rows' column edges. Each cell then repeats the
 * horizontal padding of the control in its own column - see the cells below.
 */
const saleItemHeaderClass =
  'border border-transparent px-3 pb-[7px] text-[11px] font-bold uppercase tracking-[0.05em] text-[#9b9ba3]';
/**
 * One item, bounded. Two items are two blocks and the description can no longer be
 * misread as a third product row.
 */
const saleItemBlockClass =
  'flex flex-col gap-[7px] rounded-[12px] border border-[#e8e8ec] bg-[#fcfcfd] p-3';
```

Column widths are deliberately unchanged (`minmax(0,1fr)_70px_130px_120px_36px`); only the inset and the heights move, so nothing reflows sideways.

Replace all six literal copies with `saleItemGridClass`, appending `items-center` only on the two control rows.

### 2. The header row

Replace lines 6044-6050 with:

```jsx
<div className={`${saleItemGridClass} ${saleItemHeaderClass}`}>
  <span className="pl-3">Produto / serviço</span>
  <span className="text-center">Qtd.</span>
  <span className="pr-3 text-right">Valor unit.</span>
  <span className="text-right">Subtotal</span>
  <span />
</div>
```

`pl-3` and `pr-3` are the `px-3` of `formSelectClass` and `formInputClass`. `Qtd.` needs none because its `Input` is `text-center` inside a symmetric `px-3`, so the centres already coincide. `Subtotal` needs none because the cell under it is a bare `<div>` with no padding.

Change the item list wrapper at 6051 from `flex flex-col gap-2` to `flex flex-col gap-[10px]`, so the gap BETWEEN items is larger than the `gap-[7px]` WITHIN one, and the border does the rest.

### 3. Equal control heights

Delete the `h-10 rounded-[9px]` prefix from the three item `Input`s, at lines 6083 (free row `Valor unitário`), 6197 (`Quantidade`) and 6207 (product row `Valor unitário`), leaving `formInputClass` to supply `h-11 rounded-[10px]`. That is the documented pairing in CLAUDE.md, and it makes every cell on the control row 44px tall, so `items-center` and `items-start` become indistinguishable.

Keep the description `Input`s' own `h-10 rounded-[9px]` (lines 6111 and 6243) as they are: those sit alone on their own sub-row with no picker beside them, and a slightly shorter secondary field is the point.

Keep the delete button at `h-8 w-8`; it centres inside the 36px column.

### 4. The catalog-product item block (rewrite of 6164-6285)

Four sub-rows inside one bounded block, in reading order.

```jsx
<div className={saleItemBlockClass} key={`${item.productId}-${index}`}>
  {/* A - the controls. Column 1 is now the picker and nothing else, which is what
      lets `items-center` line the numbers up with it. */}
  <div className={`${saleItemGridClass} items-center`}>
    <Combobox ... />          {/* unchanged, still formSelectClass */}
    <Input aria-label={`Quantidade do item ${index + 1}`} className={`sales-ops-num text-center ${formInputClass}`} ... />
    <Input aria-label={`Valor unitário do item ${index + 1}`} className={cn('sales-ops-num text-right', formInputClass, showCustomUnitError && 'border-destructive')} ... />
    <div className="sales-ops-num text-right text-[13.5px] font-bold">{...}</div>
    <button aria-label={`Remover item ${index + 1}`} ... />
  </div>

  {/* B - metadata about the produto in column 1, plus the reveal affordance. */}
  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5 pl-3">
    {areaBadge}
    {descriptionOptional && !descriptionVisible ? (
      <button
        className="rounded-[7px] border border-dashed border-[#dcdce2] px-2 py-[3px] text-[11.5px] font-semibold text-[#57575f] transition hover:border-[#eaa81a] hover:text-[#9c7210]"
        onClick={() => revealDescription(index)}
        type="button"
      >
        + Adicionar descrição
      </button>
    ) : null}
  </div>

  {/* C - the description, when it is visible. Same grid, so the input lands exactly
      under the produto picker and reads as a property of it. */}
  {descriptionVisible ? (
    <div className={saleItemGridClass}>
      <label className="flex min-w-0 flex-col gap-[6px]">
        <span className="text-[11px] font-bold uppercase tracking-[0.04em] text-[#9b9ba3]">
          {isService ? 'Nome / descrição do item (opcional)' : 'Nome / descrição do item'}
        </span>
        <Input ...unchanged props... ref={descriptionRef(index)} />
      </label>
    </div>
  ) : null}

  {/* D - every message this row can emit, in one always-present home. */}
  <div className="flex flex-col gap-1 pl-3">
    {showItemErrors ? (
      <span className="flex flex-col gap-1 text-[11.5px] font-semibold text-destructive">
        {showCustomLabelError ? <span>Informe o nome ou a descrição deste item personalizado.</span> : null}
        {showCustomUnitError ? <span>Informe um valor negociado maior que zero.</span> : null}
        {showAreaError ? <span>Defina a área deste produto em Cadastros {'>'} Produtos & Serviços.</span> : null}
      </span>
    ) : hasVariableValue ? (
      <span className="flex items-center gap-1.5 text-[11.5px] font-semibold text-[#9c7210]">
        <AlertTriangle className="h-[13px] w-[13px]" />
        {descriptionHint}
      </span>
    ) : null}
  </div>
```

Render sub-row D only when it has something to say, so a fixed-price Produto with no errors emits no empty div: guard it with `{showItemErrors || hasVariableValue ? ( ... ) : null}`.

Load-bearing details of this rewrite:

- The área badge (6185-6193) moves out of column 1 of the control row into sub-row B. Drop its `self-start` (the flex row handles it). Both branches of its ternary keep their exact classes and text, including `Sem área`.
- Every error and hint span moves OUT of the `<label>` at 6230 and out of the collapsible block, into sub-row D. This is REQUIRED, not cosmetic: `showCustomUnitError` is a VALUE error that today renders inside the description block, and a Serviço row with a blank description is exactly the case that collapses, so leaving it there would make `Informe um valor negociado maior que zero.` disappear for the one row that most needs it. `sale-wizard-service-description.test.tsx:328` asserts that message appears exactly once in precisely that scenario.
- The `Defina a área deste produto...` error, today its own five-column grid at 6277-6282, joins sub-row D. One fewer stray grid.
- `descriptionHint` (6155-6161) keeps all three of its strings verbatim, including the `Serviço com valor variável - sem descrição, o item aparece como "X"` variant, and keeps rendering while the description is collapsed. Collapsing hides the FIELD, not the explanation of what the item will be called. Restyling the amber hint itself is slice 10's job, not this slice's.
- The `Input`'s `aria-label={`Nome / descrição do item ${index + 1}`}` and its `Frozen:` comment stay character for character. Eight existing queries across three test files depend on it.
- The visible caption strings `Nome / descrição do item` and `Nome / descrição do item (opcional)` stay verbatim; only their classes change, to the same uppercase muted idiom as the column headers so the field reads as a sub-field of the item rather than as a new form group.

### 5. The item avulso block (rewrite of 6058-6139)

The same block shell, three sub-rows, no B row and no affordance.

```jsx
<div className={saleItemBlockClass} key={`free-${index}`}>
  <div className={`${saleItemGridClass} items-center`}>
    <Combobox aria-label={`Área do item ${index + 1}`} ... />   {/* unchanged */}
    <div className="sales-ops-num text-center text-[13.5px] text-[#57575f]">1</div>
    <Input aria-label={`Valor unitário do item ${index + 1}`} className={cn('sales-ops-num text-right', formInputClass, showItemErrors && !unitValid && 'border-destructive')} ... />
    <div className="sales-ops-num text-right text-[13.5px] font-bold">{...}</div>
    <button aria-label={`Remover item ${index + 1}`} ... />
  </div>
  <div className={saleItemGridClass}>
    <label className="flex min-w-0 flex-col gap-[6px]">
      <span className="text-[11px] font-bold uppercase tracking-[0.04em] text-[#9b9ba3]">Descrição do item</span>
      <Input aria-label={`Descrição do item ${index + 1}`} ... />   {/* unchanged props */}
    </label>
  </div>
  <div className="flex flex-col gap-1 pl-3">
    {showItemErrors ? ( ...the three existing error spans... ) : ( ...the existing amber `Item avulso - informe a área, a descrição e o valor` span... )}
  </div>
</div>
```

The free row's description is REQUIRED, so it renders open unconditionally and gets NO affordance. Its errors and hint move out of the `<label>` for the same reason as above, and all five strings (`Selecione a área deste item.`, `Informe a descrição deste item avulso.`, `Informe um valor negociado maior que zero.`, `Item avulso - informe a área, a descrição e o valor`, `Descrição do item`) stay verbatim.

## The reveal-affordance state model

### The rule, stated once

```
free row                                -> description REQUIRED  -> always open, no affordance
product row, !hasVariableValue          -> no description field at all (unchanged)
product row, needsDescription           -> description REQUIRED  -> always open, no affordance
product row, hasVariableValue && isService -> description OPTIONAL -> opt-in
```

An optional description that already has text is open. The affordance can never hide a required field, and it can never hide text the operator or the edit path already put there.

### Where the flag lives

Add a UI-only field to `SaleItemForm` (line 4650-4657):

```ts
type SaleItemForm = {
  kind: 'product' | 'free';
  productId: string; // '' on free rows
  areaId: string; // '' on product rows (derived from the product); picked on free rows
  customLabel: string; // open-price custom label on product rows; the description on free rows
  quantity: string; // always '1' on free rows
  unitBrl: string;
  /**
   * UI only, never sent. `true` once the operator opened the optional description
   * on THIS row. It rides on the row rather than in an index-keyed set because rows
   * are deleted with `filter((_, i) => i !== index)`, so index-keyed state would
   * slide onto the wrong row after a delete.
   */
  descriptionOpen: boolean;
};
```

The compiler then finds all five construction sites; each gets `descriptionOpen: false`:

| Line | Site |
| --- | --- |
| ~4848 | `deriveWizardPrefill`, free branch |
| ~4858 | `deriveWizardPrefill`, product branch |
| ~5088 | the `useState<SaleItemForm[]>` seed for a fresh wizard |
| ~5617 | `addItem` |
| ~5631 | `addFreeItem` |

`deriveWizardPrefill` seeds `false` even for a row that HAS a description: the visibility predicate ORs on the text, so the edit path opens without the flag, and keeping `deriveWizardPrefill` free of UI reasoning is worth more than the redundancy.

In `setItem` (5594-5609), inside the existing `if (patch.productId && patch.productId !== item.productId)` branch, add `next.descriptionOpen = false;` right beside the existing `next.customLabel = '';`. Swapping the produto is a fresh row, so a stale reveal must not survive it.

### The predicate

Inside the product branch of the map, beside the existing `customLabelValid` derivations (6145-6151):

```ts
const descriptionOptional = hasVariableValue && !needsDescription;
const descriptionVisible =
  hasVariableValue &&
  (needsDescription || item.descriptionOpen || Boolean(item.customLabel.trim()));
```

Note the deliberate asymmetry: once revealed, clearing the text does NOT re-collapse the field, because `descriptionOpen` stays true. A field must never vanish from under the caret.

### Focus on reveal

`useRef` is already imported (line 26). Add near the other `SaleWizardDialogBody` state:

```ts
/** Index whose description input should take focus on its next mount. */
const pendingDescriptionFocus = useRef<number | null>(null);

function revealDescription(index: number) {
  pendingDescriptionFocus.current = index;
  setItem(index, { descriptionOpen: true });
}
```

and on the product row's description `Input`:

```tsx
ref={(node) => {
  if (node && pendingDescriptionFocus.current === index) {
    pendingDescriptionFocus.current = null;
    node.focus();
  }
}}
```

A callback ref rather than `autoFocus`, because `autoFocus` fires on every mount and would steal focus when the wizard returns to step 1 or when the edit path mounts a prefilled row. `Input` is a `React.forwardRef<HTMLInputElement, ...>` (`apps/web/src/components/ui/input.tsx:4`), so the ref reaches the real `<input>`.

## What must NOT change

- No calculation moves. `itemsValid`, `productRowRequirements`, `saleItemDisplayName`, `itemsTotalCents` and `computeSaleFinancials` are untouched.
- No payload shape moves. `items[].customLabel` still becomes `items[].productName` at 5787 and 5797, and the API still maps it to `productNameSnapshot`. `descriptionOpen` is never read by either builder.
- Every `aria-label` on every item control is frozen.
- No new component, no new file. `Combobox` stays the only picker; no native `<select>` is introduced.

## Oracle tests

### Primary: `apps/web/src/sales-ops/__tests__/sale-wizard-ui-contract.test.ts`

The existing file is a source-grep suite with no DOM. Add a THIRD `it` to it that renders, in the idiom of `sale-wizard-service-description.test.tsx` (the `@vitest-environment happy-dom` pragma, the `@/components/ui/dialog` mock, `createRoot` + `React.act`, the `buttonByText` / `labeledInput` / `pickOption` helpers). Renaming the file to `.tsx` is required for JSX, so:

- rename `sale-wizard-ui-contract.test.ts` to `sale-wizard-ui-contract.test.tsx` and add the pragma;
- keep both existing `it` blocks byte-identical;
- add `expect(source).toContain('Adicionar descrição');` to the first block as the cheap string pin;
- add the new render block below.

New test name: **`renders the description as an opt-in affordance only where it is optional`**, asserting, on a catalog whose first product is a Serviço (`kind: 'service'`, `openPrice: true`), a second is open-price non-Serviço, and a third is fixed-price:

1. On first render, item 1 is the Serviço: `container.querySelector('input[aria-label="Nome / descrição do item 1"]')` is `null`, and `buttonByText('+ Adicionar descrição')` exists.
2. Clicking that button mounts the input, `document.activeElement` is it, and the button is gone.
3. Typing into it and then clearing it keeps the input mounted (no vanish-under-caret).
4. `pickOption('Produto / serviço do item 1', 'FXL Custom')` (open-price, not a Serviço) renders the input with NO `+ Adicionar descrição` button anywhere, because the field is required.
5. `+ item avulso` produces a row whose `Descrição do item 2` input is present immediately and which adds no `+ Adicionar descrição` button.
6. `pickOption('Produto / serviço do item 1', 'FXL Finance')` (fixed price) renders neither the input nor the affordance.
7. The edit path: render `SaleWizardDialog` with an `editSale` whose Serviço `saleItem` carries a `productNameSnapshot` different from the catalog name, and assert `labeledInput('Nome / descrição do item 1').value` equals that snapshot with no click, and that `+ Adicionar descrição` is absent. Build the `editSale` and `saleItems` fixtures the way `sale-wizard-edit.test.tsx` already does.
8. Grid contract: `container.querySelector('input[aria-label="Quantidade do item 1"]')!.className` contains `h-11` and not `h-10`, so the picker and the numeric inputs are the same height. This is the one assertion that pins the alignment fix itself; the rest of the geometry is CSS a jsdom-class runner cannot measure, and pinning class strings beyond this would be brittle.

### Regressions to repair in `apps/web/src/sales-ops/__tests__/sale-wizard-service-description.test.tsx`

Item 1 in that file is the Serviço, so six assertions now hit a collapsed field. Each is a real behaviour change, so each is updated deliberately rather than deleted:

| Line | Today | After |
| --- | --- | --- |
| 246 | `expect(labeledInput('Nome / descrição do item 1').value).toBe('')` | `expect(container.querySelector('input[aria-label="Nome / descrição do item 1"]')).toBeNull()` plus `expect(buttonByText('+ Adicionar descrição')).toBeInstanceOf(HTMLButtonElement)` |
| 288 | `changeInput(labeledInput(...), 'Escopo mensal')` | prepend `await click(buttonByText('+ Adicionar descrição'));` |
| 331 | `expect(labeledInput(...).getAttribute('aria-invalid')).not.toBe('true')` | `expect(container.querySelector('input[aria-label="Nome / descrição do item 1"]')).toBeNull()` - a collapsed optional field cannot be invalid, which is the stronger form of the same claim |
| 373-374 | asserts the input and the `(opcional)` caption on first render | prepend the reveal click, then keep both assertions verbatim |
| 382 | `changeInput(labeledInput(...), 'Escopo mensal')` | already after the reveal added for 373 |

Lines 348, 365, 393-394 and 422 need NO change: 348 and 393 run after `pickOption(..., 'FXL Custom')` (required, open), 365 is a free row (required, open), 422 is the fixed-price row that already asserts absence.

### Suites that must stay green untouched, and why

- `sale-wizard-custom-item-labels.test.tsx` - every description query there is on `FXL Custom`, an open-price non-Serviço, so the field is required and stays open. Its delete-a-row test at 351-361 is the incidental proof that `descriptionOpen` riding on the row survives an index shift.
- `sale-wizard-free-items.test.tsx`, `sale-wizard-edit.test.tsx`, `combobox-adoption.test.tsx` - all query `Descrição do item N` on free rows, which never collapse.
- `sale-wizard-payment-plan.test.tsx`, `sale-wizard-funcao-costs.test.tsx`, `sale-wizard-overrides.test.tsx`, `sale-wizard-commission-defaults.test.tsx`, `sale-wizard-state-preservation.test.tsx` - step 2 onwards, and they reach it through `Valor unitário` and `Avançar`, both untouched.

Run: `pnpm --filter @fxl-sales/web test -- --run sale-wizard`, then `pnpm run lint` and `pnpm run type-check`.

## Risks

- **Line drift from slice 02.** `02-wizard-shell-footer` edits the same `SaleWizardDialogBody` and lands first. Every line number above is against `ee249b2`; re-anchor by searching for `minmax(0,1fr)_70px_130px_120px_36px` (six hits today) rather than by line number.
- **The renamed contract test.** Renaming `sale-wizard-ui-contract.test.ts` to `.tsx` is a `git mv`; if the rename is done as delete-plus-create the two existing `it` blocks must be verified byte-identical afterwards, because they are the batch's standing wizard-string contract.
- **Height change ripple.** Dropping `h-10` from the three item `Input`s makes each control row 4px taller. Three items grow the step-1 panel by 12px, which interacts with the footer clipping that slice 02 fixes. Verify step 1 with four items after both slices land.
- **The amber hint stays visible while collapsed.** That is intentional here and NOT an oversight: hiding both the field and its explanation would leave a Serviço row silently named after its catalog entry. Slice 10 (`info-hints`) owns converting that banner into an on-demand hint, and it should be able to do so without touching this slice's structure, because sub-row D is a single, clearly bounded home for every message the row emits.
- **`descriptionOpen` and `not.toContain` guards.** The batch's contract test bans a set of removed strings. `+ Adicionar descrição` is new and collides with none of them; confirm with a grep for `Adicionar` in `SalesOpsApp.tsx` before adding, since `Adicionar recorrência` is one of the banned strings and a careless label like `Adicionar descrição do item` is fine but `Adicionar recorrência` must not reappear.
