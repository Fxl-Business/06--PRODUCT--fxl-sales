# exec-03 - wizard step 1 `Itens` row alignment and opt-in description

Slice: `03-wizard-itens-row`.
Branch: `feat/03-wizard-itens-row`.
Plan: `nexo/plans/batch-01K9NX4QPTUI0730CADPRODWIZ/03-wizard-itens-row.md`.

## What changed

### `apps/web/src/sales-ops/SalesOpsApp.tsx`

Four module-level constants added right after `formSelectClass`:

- `saleItemGridClass` - the one grid the header and every item sub-row share.
  The literal `grid-cols-[minmax(0,1fr)_70px_130px_120px_36px] gap-[9px]` was copy-pasted six times; there is now exactly one occurrence in the file, inside this constant.
- `saleItemHeaderClass` - `border border-transparent px-3 ...`, so the header's column edges land on the item block's column edges.
- `saleItemBlockClass` - one bounded item block, `gap-[7px]` inside, bordered, `bg-[#fcfcfd]`.
- `saleItemFieldLabelClass` - the description caption, restyled to the same uppercase muted idiom as the column headers.
  Not named in the plan as a constant; the plan specified the class string inline in two places (product and free branch), so it is hoisted rather than duplicated. Same string, same result.

Header row: `pl-3` on `Produto / serviço` and `pr-3` on `Valor unit.` (the `px-3` of `formSelectClass` / `formInputClass`), `px-0.5` dropped.
Item list wrapper `gap-2` -> `gap-[10px]`, so the gap between items exceeds the `gap-[7px]` inside one.

Control heights: the `h-10 rounded-[9px]` prefix is gone from the three item `Input`s (free row `Valor unitário`, product row `Quantidade` and `Valor unitário`), so `formInputClass` supplies `h-11 rounded-[10px]` and every cell on the control row is 44px like the picker beside it.
The two description `Input`s keep their own `h-10 rounded-[9px]` as the plan requires.

Product block restructured into four sub-rows inside one `saleItemBlockClass`:

- A: the controls. Column 1 is now the `Combobox` and nothing else, which is what makes `items-center` line the numbers up with it.
- B: the área badge (moved out of column 1, `self-start` dropped, both ternary branches verbatim including `Sem área`) plus the `+ Adicionar descrição` button when the description is optional and collapsed.
- C: the description, on the same grid, rendered only when `descriptionVisible`.
- D: one home for every message the row emits, OUTSIDE the collapsible block.
  The `Defina a área deste produto...` error joined it, so its separate five-column grid is gone.

Free block restructured the same way, minus B and minus the affordance: its description is required and renders open unconditionally.
Its three error strings and the `Item avulso - informe a área, a descrição e o valor` hint moved out of the `<label>` into sub-row D, verbatim.

State model:

- `SaleItemForm` gained `descriptionOpen: boolean` (UI only, never sent). Seeded `false` at all five construction sites: both `deriveWizardPrefill` branches, the fresh-wizard `useState` seed, `addItem`, `addFreeItem`.
- `setItem` clears `descriptionOpen` alongside `customLabel` when the produto changes.
- `pendingDescriptionFocus = useRef<number | null>(null)` declared beside the `items` state (not after the function declarations, so the hook call order is unconditional), and `revealDescription(index)` sets it then patches the row.
- The description `Input` takes a callback `ref` that focuses only when `pendingDescriptionFocus.current === index`, rather than `autoFocus`.

Predicates:

```ts
const descriptionOptional = hasVariableValue && !needsDescription;
const descriptionVisible =
  hasVariableValue && (needsDescription || item.descriptionOpen || Boolean(item.customLabel.trim()));
```

Nothing in the calculation or payload path moved: `itemsValid`, `productRowRequirements`, `saleItemDisplayName`, `itemsTotalCents` and both payload builders are untouched, `descriptionOpen` is read by neither, and `items[].customLabel` still becomes `items[].productName` -> `productNameSnapshot`.
Every `aria-label` on every item control is byte-identical, including the frozen `Nome / descrição do item ${index + 1}` and its `Frozen:` comment.

### `apps/web/src/sales-ops/__tests__/sale-wizard-ui-contract.test.ts` -> `.tsx`

`git mv` (the diff records it as a rename, `R`), `@vitest-environment happy-dom` pragma added, dialog mock + render harness + `editSale` fixture added.

### `apps/web/src/sales-ops/__tests__/sale-wizard-service-description.test.tsx`

Six assertions across four tests updated - see the table below.

## Red-then-green evidence

### Red 1 - the oracle before implementation

```
 FAIL  src/sales-ops/__tests__/sale-wizard-ui-contract.test.tsx > sale wizard UI contract > keeps the proposal dialog aligned with the Nova proposta wizard shell
 ❯ src/sales-ops/__tests__/sale-wizard-ui-contract.test.tsx:321:20
    321|     expect(source).toContain('Adicionar descrição');

 FAIL  src/sales-ops/__tests__/sale-wizard-ui-contract.test.tsx > sale wizard UI contract > renders the description as an opt-in affordance only where it is optional
AssertionError: expected <input …(6)></input> to be null
- Expected: null
+ Received:
<input
  aria-invalid="false"
  aria-label="Nome / descrição do item 1"
  ...
  placeholder="Ex.: detalhe do escopo"
  value=""
/>
 ❯ src/sales-ops/__tests__/sale-wizard-ui-contract.test.tsx:420:57
    420|     expect(optionalInput('Nome / descrição do item 1')).toBeNull();

 Test Files  1 failed (1)
      Tests  2 failed | 3 passed (5)
```

Both failures are the real reason: the affordance string does not exist in the source, and the Serviço description input renders unconditionally.

### Red 2 - the four regressions the plan predicted, after implementation

```
   × sale wizard serviço description > advances step 1 with a serviço item whose description is blank
   × sale wizard serviço description > keeps the typed description when a serviço row has one
   × sale wizard serviço description > still blocks a serviço item whose negotiated value is zero
   × sale wizard serviço description > labels the serviço description as optional and names the catalog fallback
 Test Files  1 failed | 27 passed (28)
      Tests  4 failed | 276 passed (280)
```

Exactly the four tests and the six assertions the plan named, no others.

### Green

```
 ✓ src/sales-ops/__tests__/sale-wizard-ui-contract.test.tsx (5 tests) 50ms
 ✓ src/sales-ops/__tests__/sale-wizard-service-description.test.tsx (10 tests) 110ms
```

Full suite, `pnpm test`:

```
packages/shared-utils test:  Test Files  2 passed (2)
packages/shared-utils test:       Tests  23 passed (23)
apps/api test:  Test Files  29 passed (29)
apps/api test:       Tests  300 passed (300)
apps/web test:  Test Files  39 passed (39)
apps/web test:       Tests  365 passed (365)
```

Baseline was 363 web across 39 files and 300 api across 29 files.
Web is +2 (the two new `it` blocks in the renamed contract file); the file count is unchanged because the file was renamed, not added.
API and shared-utils are unchanged.

`pnpm run lint` - clean (`apps/api lint: Done`, `apps/web lint: Done`).
`pnpm run type-check` - clean (all four projects `Done`).
`pnpm run perf:audit` (the pre-commit gate) - `perf-audit: ok`.

## Existing assertions modified, and why

All six are in `sale-wizard-service-description.test.tsx` and all six are named by the plan.

| Test | Was | Now | Why |
| --- | --- | --- | --- |
| `advances step 1 with a serviço item whose description is blank` | `expect(labeledInput('Nome / descrição do item 1').value).toBe('')` | `expect(container.querySelector('input[aria-label="Nome / descrição do item 1"]')).toBeNull()` plus `expect(buttonByText(revealDescription)).toBeInstanceOf(HTMLButtonElement)` | The optional field is now collapsed on first render; the affordance assertion is the positive control that it is collapsed rather than deleted. |
| `keeps the typed description when a serviço row has one` | `changeInput(labeledInput(...), 'Escopo mensal')` on line 1 | prepended `await click(buttonByText(revealDescription));` | The field has to be revealed before it can be typed into. Every downstream assertion is verbatim. |
| `still blocks a serviço item whose negotiated value is zero` | `expect(labeledInput('Nome / descrição do item 1').getAttribute('aria-invalid')).not.toBe('true')` | `expect(container.querySelector('input[aria-label="Nome / descrição do item 1"]')).toBeNull()` | The stronger form of the same claim: a collapsed optional field cannot be invalid. This test's `expect(textOccurrences(valueError)).toBe(1)` on the line above is untouched and is what proves the value error moved OUT of the collapsible block - it is a blank-description Serviço row, exactly the collapsing case. |
| `labels the serviço description as optional and names the catalog fallback` | asserted the input and the `(opcional)` caption on first render | prepended a `container.textContent` assertion that the amber hint renders while collapsed, then `await click(buttonByText(revealDescription));`, then both original assertions verbatim | The hint deliberately stays visible while the field is collapsed (it explains what the item will be CALLED); the added assertion pins that so it cannot silently regress. The two original assertions and the two `not.toContain` guards below them are unchanged. |

One shared constant `revealDescription = '+ Adicionar descrição'` was added at the top of that file, beside the existing `descriptionError` / `valueError` constants.

No assertion was weakened. Lines 348, 365, 393-394 and 422 needed no change, as the plan predicted.
`sale-wizard-custom-item-labels.test.tsx`, `sale-wizard-free-items.test.tsx`, `sale-wizard-edit.test.tsx`, `combobox-adoption.test.tsx` and the five step-2-onwards suites all stayed green untouched.

## Divergences from the plan

1. **The contract file had THREE `it` blocks, not two.**
   The plan was written against `ee249b2`; slice 02 added `keeps the wizard shell free of a hand-computed body height`.
   All three existing blocks are byte-identical apart from the one `expect(source).toContain('Adicionar descrição');` line the plan asked for in the first block.
   The new render test is therefore the fourth block.

2. **`new URL('../SalesOpsApp.tsx', import.meta.url)` had to be replaced.**
   Adding the `happy-dom` pragma swaps the global `URL` for happy-dom's, which resolves relative to the document origin instead of the module's `file:` base, so `fileURLToPath` got `http://localhost:3000/src/sales-ops/SalesOpsApp.tsx` and threw `TypeError: The URL must be of scheme file` at collect time, killing the whole file.
   Replaced with `join(dirname(fileURLToPath(import.meta.url)), '..', 'SalesOpsApp.tsx')`, with a comment recording why.
   The plan did not anticipate this; it is a direct consequence of the rename it mandated.

3. **The plan's oracle test 7 (the edit path) is a separate `it`.**
   The plan listed it as point 7 of one test, but it needs a differently-parametrized render, so it is its own block (`opens the stored description on the edit path with no click`).
   This block passes before the implementation as well as after, because `deriveWizardPrefill` already seeded `customLabel` from `productNameSnapshot`.
   It is an anti-regression guard on the `Boolean(item.customLabel.trim())` arm of `descriptionVisible`, not a driver: drop that arm and it fails.
   Recorded here rather than presented as red-first evidence.

4. **Sub-row D's guard is tighter than the plan's literal `{showItemErrors || hasVariableValue ? ...}`.**
   That expression still emits an empty `<div>` for a fixed-price produto when `showItemErrors` is true and the row has no errors, which contradicts the plan's own stated intent ("render sub-row D only when it has something to say").
   Implemented as `showItemErrors ? (showCustomLabelError || showCustomUnitError || showAreaError) : hasVariableValue`.
   Behaviourally identical to the old code in every case: the old markup also suppressed the hint whenever `showItemErrors` was true.

5. **Verification is test-level, not browser-level.**
   The alignment claim is CSS geometry that the jsdom-class runner cannot measure; the one pinnable part (the `h-11` / not-`h-10` control height) is asserted.
   The plan's own risk note asks for a visual check of step 1 with four items after slices 02 and 03 both land - that belongs to the batch verify pass, not to this slice's tree.
