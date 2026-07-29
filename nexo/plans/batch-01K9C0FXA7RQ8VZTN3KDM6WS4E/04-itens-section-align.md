---
id: 04-itens-section-align
milestone: v2.3.0
status: todo
depends_on: []
files_modified:
  - apps/web/src/sales-ops/SalesOpsApp.tsx
  - apps/web/src/sales-ops/__tests__/sale-items-grid-alignment.test.tsx
acceptance: "given the Nova proposta wizard is open on step 1 with a product item, an open-price item and an item avulso, when the Itens section renders, then the column header row, every item control row and every item sub-row resolve to one single grid template, the Qtd./Valor unit./Subtotal headers and their values are right-aligned on the same 12px inset edge, every control in a control row is 44px tall, and the área badge plus descrição plus aviso live in a subordinate sub-row nested inside the item row."
---

# Align the Itens section of the proposta wizard onto one shared grid

## Goal

The Itens block of the Nova proposta / Editar proposta wizard currently repeats its five-column grid template six times as a hand-written literal, offsets the header row by 2px against the rows it labels, mixes three font sizes and two control heights inside a single row, and lets the área badge grow the picker cell so the numeric cells drift off the picker's vertical rhythm.
This slice makes the header row and every item row share exactly one grid definition held in a single module-level constant, right-aligns the three numeric columns so header text and value text land on the same inset edge, normalises every control in the first row to the same 44px box, and demotes the per-item secondary content (área badge, descrição field, aviso line) into one clearly subordinate sub-row nested inside the item row.
It is layout only: no validation rule, no handler, no payload shape, no user-facing string changes.

## Current state

All anchors are `apps/web/src/sales-ops/SalesOpsApp.tsx` unless stated otherwise.
The section lives at `:4305-4547`, inside `SaleWizardDialogBody` (`:3654-5207`), in the `wizardStep === 1` branch that starts at `:4192`.
The panel is `<div className="rounded-[14px] border border-[#e8e8ec] bg-white p-4">` at `:4305`.

Relevant surroundings:

- Style constants that are the current source of truth: `panelClass` `:135`, `tableHeadClass` `:137`, `iconButtonClass` `:140`, `formInputClass` `:142` (`h-11 rounded-[10px] ... px-3 text-sm`), `formSelectClass` `:144`.
- `Field` (`:401-420`) is the wizard's label wrapper: `<label className="flex flex-col gap-[6px]">` plus `<span className="text-xs font-semibold text-[#8b8b92]">`.
- `NativeSelect` (`:421-448`) has base `h-10 rounded-md border border-[#dcdce2] bg-[#fafafb] px-3 text-sm font-medium`, and concatenates the caller `className` with a template string, so it does **not** run through `cn`/`tailwind-merge`.
- The same dialog's Cliente/Vendedor/Finder selects at `:4222` and `:4247` pass `className="h-11 rounded-[10px]"`, which is the established in-file convention for a wizard-sized select.
- Item handlers that must not change: `selectedProduct` `:3931`, `saleItemDisplayName` `:3936`, `setItem` `:3944`, `addItem` `:3961`, `addFreeItem` `:3977`.
- The dialog shell is `max-w-[940px] w-[calc(100vw-48px)]` (`:4135`), the scroll body adds `px-[26px]` (`:4184`), and the panel adds `p-4`, so the grid's usable inner width is `min(940, viewport - 48) - 84`.

Defects to fix, enumerated:

1. **Six copies of one grid template.** `grid-cols-[minmax(0,1fr)_70px_130px_120px_36px]` is written by hand at `:4333` (header), `:4349` (free control row), `:4388` (free sub-row), `:4438` (product control row), `:4496` (open-price sub-row), `:4537` (área-error row). Any edit to one drifts the others.
2. **The header is offset 2px from the rows.** The header grid carries `px-0.5` (`:4333`); no row grid carries any horizontal padding, so every column header sits 2px right of the control it labels.
3. **Header text is not on the same edge as the value it labels.** `Qtd.` is `text-center` (`:4335`) over a `text-center` input (`:4464`), while `Valor unit.` and `Subtotal` are `text-right` at the *cell* edge (`:4336-4337`) over an input whose text sits 12px inside that edge because `formInputClass` supplies `px-3`. The result is a systematic 12px mismatch on the two money columns.
4. **Three font sizes in one row.** The picker passes `text-[13.5px]` (`:4352`, `:4442`), the inputs inherit `text-sm` (14px) from `formInputClass`, and the subtotal cell is `text-[13.5px]` (`:4374`, `:4481`). Their text baselines cannot coincide.
5. **Two control heights in one row.** The pickers pass `h-10` (`:4352`, `:4442`) and `NativeSelect` does not merge classes, so they render 40px, while `Input` merges `h-10 rounded-[9px]` before `formInputClass` and therefore renders 44px with a 10px radius. The `h-10 rounded-[9px]` prefixes at `:4367` and `:4474` are dead classes today, which is exactly the kind of silent drift this slice removes.
6. **Two border radii in one row.** Pickers ask for `rounded-[9px]`, inputs resolve to `rounded-[10px]`, the delete button is `rounded-[8px]` (`:4379`, `:4486`).
7. **The delete button does not fill its column and is not centred on the row.** The column is `36px`, the button is `h-8 w-8` (32px), so it floats with 4px of unexplained slack.
8. **The área badge inflates the picker cell.** `:4439-4461` wraps the select and the badge in `flex flex-col gap-1` inside a grid that is `items-center`, so the picker cell is roughly 63px tall while every other cell is 40 to 44px. The qty, valor, subtotal and delete cells get vertically centred against that inflated cell instead of sitting on the picker's own line.
9. **The secondary content is split across up to three sibling grids.** For an open-price product with a missing área the row emits the control grid (`:4438`), the descrição grid (`:4496`) and the área-error grid (`:4537`), each re-declaring the template and each contributing its own vertical gap.
10. **Uneven vertical gaps.** Header `pb-[7px]` (`:4333`), rows stack `gap-2` (`:4340`), row internals `gap-[5px]` (`:4348`, `:4437`), sub-block internals `gap-[6px]`, aviso `pl-0.5` (`:4415`, `:4528`) which indents the warning 2px past the input it belongs to.
11. **The three header buttons are not the same height.** `Cadastrar produto` (`:4310`) and `+ item avulso` (`:4316`) carry `border`, `+ item` (`:4325`) does not, and all three size themselves from `py-[7px]`, so the bordered pair renders 2px taller than the dark one.
12. **Duplicated label markup.** The sub-block labels at `:4390` and `:4498` hand-copy `Field`'s label span instead of using `Field`, so the wizard has two independent definitions of the same label style.
13. **No narrow-viewport story.** The fixed columns plus gaps need 392px, the panel gives `min(940, vw - 48) - 84`, and nothing clips, scrolls or reflows, so below roughly 700px the picker column is crushed toward zero width.

## Target layout

### Single source of truth

Add one module-level constant next to `formSelectClass` (`:144`):

```ts
const saleItemGridClass =
  'grid grid-cols-[minmax(0,1fr)_72px_136px_128px_36px] items-center gap-x-3';
```

Every grid in the Itens section is rendered as `saleItemGridClass`, or as `cn(saleItemGridClass, ...)` when a row needs to override `items-center`.
The literal `grid-cols-[` must not appear anywhere else inside `:4305-4547` after this slice.
`cn` is already imported (`:64`) and resolves the `items-*` conflict correctly because it runs `tailwind-merge`.

### Columns and alignment

| # | Column | Width | Header cell | Row cell |
| --- | --- | --- | --- | --- |
| 1 | `Produto / serviço` | `minmax(0,1fr)` | `text-left` | picker select, stretched, no wrapper |
| 2 | `Qtd.` | `72px` | `pr-3 text-right` | `text-right` input (product) or `flex h-11 items-center justify-end pr-3` static `1` (avulso) |
| 3 | `Valor unit.` | `136px` | `pr-3 text-right` | `text-right` input |
| 4 | `Subtotal` | `128px` | `pr-3 text-right` | `flex h-11 items-center justify-end pr-3 text-sm font-bold` |
| 5 | (actions) | `36px` | `<span aria-hidden="true" />` | `h-9 w-9 rounded-[10px]` delete button |

The `pr-3` on the numeric header cells and on the two plain-text value cells is load-bearing: it matches the `px-3` that `formInputClass` puts inside the inputs, so the header text, the qty digits, the valor digits and the subtotal digits all terminate on the same vertical line 12px inside the cell edge.
Column widths grow slightly (70 to 72, 130 to 136, 120 to 128) because the gap moves from 9px to 12px and `Valor unit.` at `text-[11px]` uppercase with `tracking-[0.06em]` plus `pr-3` needs the extra room to never wrap.

### Row box model

Every cell in a control row resolves to a 44px box (`h-11`), and the grid is `items-center`, so all four text cells share an identical line box and therefore an identical text baseline.
This is preferred over `items-baseline`, which would misalign an `<input>` against a plain `<div>`; state this in the commit body so it is not "fixed" later.

- Picker: `className="h-11 rounded-[10px]"` only. Drop `h-10`, `rounded-[9px]` and `text-[13.5px]`, exactly matching `:4222` and `:4247`, so the select inherits the base `text-sm`.
- Qty input: `cn('sales-ops-num text-right', formInputClass)`. Keep `type="number"` and `min={1}`.
- Valor input: `cn('sales-ops-num text-right', formInputClass, error && 'border-destructive')`. Drop the dead `h-10 rounded-[9px]`.
- Subtotal: `flex h-11 items-center justify-end pr-3 text-sm font-bold` plus `sales-ops-num`, marked `data-sale-item-subtotal`.
- Delete: `flex h-9 w-9 items-center justify-center rounded-[10px] border border-[#f0dcd5] bg-[#fbeee9] text-[#b23a22] transition hover:bg-[#f6e0d9]`, icon stays `h-3.5 w-3.5`. Colours unchanged.

### Per-item structure

```
<div data-sale-item-row className="flex flex-col gap-1.5">
  <div data-sale-item-controls className={saleItemGridClass}>
    … exactly five children, one per column …
  </div>
  <div data-sale-item-subrow className={cn(saleItemGridClass, 'items-start')}>
    <div className="col-start-1 col-end-4 flex min-w-0 flex-col gap-[6px]">
      … área badge (product rows) …
      … Field("Nome / descrição do item" | "Descrição do item") + Input …
      … erro lines or the aviso line …
    </div>
  </div>
</div>
```

The sub-row is a sibling of the control grid inside the item row wrapper, never a cell of the control grid, and it re-uses the same template so its single cell starts precisely on the picker column's left edge.
That cell spans `col-start-1 col-end-4`, so the descrição input's right edge lands on the real grid line at the right of the `Valor unit.` column instead of on an arbitrary width.
Exactly one sub-row per item, so the área badge, the descrição field, the validation errors and the aviso line all share one vertical rhythm and the `:4537` área-error grid disappears.

Content of the sub-row cell:

- Product rows: the área badge moves here from the picker cell, unchanged in wording and colour (`bg-[#ececf1] text-[#57575f]`, or `bg-[#fdf0cf] text-[#9c7210]` for `Sem área`), given `inline-flex h-[22px] items-center rounded-full px-2 text-[11px] font-bold` and `self-start` so its height stops depending on line-height.
- Product rows with `product.openPrice`: `Field` with label `Nome / descrição do item` wrapping the existing `Input` (`aria-label` unchanged).
- Item avulso rows: `Field` with label `Descrição do item` wrapping the existing `Input` (`aria-label` unchanged). The área `NativeSelect` stays in column 1 of the control row, because for an avulso row the área *is* the row's identity and moving a live control between rows would be a behaviour change rather than an alignment fix.
- The `showAreaError` message (`Defina a área deste produto em Cadastros > Produtos.`) renders as the last line of this cell instead of its own grid.
- `pl-0.5` is removed from both aviso spans so the warning starts on the same left edge as the input above it.

### Header row

```
<div data-sale-items-header className={cn(saleItemGridClass, 'pb-2 text-[11px] font-bold uppercase tracking-[0.06em] text-[#9b9ba3]')}>
```

`px-0.5` is removed (defect 2); `tracking-[0.05em]` becomes `tracking-[0.06em]` to match `tableHeadClass` (`:137`) and every other column header in the app; `pb-[7px]` becomes `pb-2`.
Labels keep their exact current pt-BR text: `Produto / serviço`, `Qtd.`, `Valor unit.`, `Subtotal`.

### Header buttons

All three buttons get `h-9`, `rounded-[10px]` and `text-[12.5px] font-semibold px-3`, and `+ item` gains `border border-transparent` so its box model matches the two bordered siblings.
`py-[7px]` is dropped in favour of the explicit height.
Labels stay byte-identical: `Cadastrar produto`, `+ item avulso`, `+ item`.

### Narrow viewport

One template at every width; no layout-mode fork, no hidden column, no per-breakpoint override.
Wrap the header row and the rows stack together in a single scroll container:

```
<div className="-mx-0.5 overflow-x-auto">
  <div className="min-w-[600px] px-0.5">
    … header row … rows stack …
  </div>
</div>
```

- The fixed columns plus gaps consume 420px, so `min-w-[600px]` guarantees the picker column never drops below 180px.
- Header and rows are inside the *same* scroll container, so they scroll as one unit and can never desync horizontally.
- Usable inner width is `min(940, vw - 48) - 84`, so the horizontal scrollbar appears only below roughly a 732px viewport; at every larger width the `minmax(0,1fr)` picker column absorbs the extra space and no scrollbar is painted.
- `px-0.5` on the inner wrapper (cancelled by `-mx-0.5` on the scroller) keeps focus rings from being clipped by the scroll container; because it is applied once around both the header and the rows, it cannot reintroduce defect 2.

## Red

New test file: `apps/web/src/sales-ops/__tests__/sale-items-grid-alignment.test.tsx`.

It follows the repo idiom exactly: `// @vitest-environment happy-dom` on line 1, `vi.mock('@/components/ui/dialog')` into plain divs, `createRoot` from `react-dom/client`, `React.act` via the cast used at `sale-wizard-free-items.test.tsx:26-28`, and hand-written DOM queries.
Copy the `product()` / `baseBootstrap()` fixtures and the `renderWizard` / `buttonByText` / `labeledInput` / `labeledSelect` / `click` helpers from `apps/web/src/sales-ops/__tests__/sale-wizard-free-items.test.tsx:30-211`.
The wizard mounts on step 1 with exactly one product item, so a header row and one item row exist immediately; `+ item avulso` and `+ item` add more.

Keep the dialog mock rather than mounting the real Radix dialog.
The real dialog does render under happy-dom, so mounting it is available, but it buys this slice nothing: the Itens grid is the same subtree either way, and every assertion here is about class tokens and parent/child relationships inside that subtree.
It would cost something, though: Radix portals its content into `document.body`, so `container.querySelectorAll(...)` would silently return zero nodes and each helper would have to be rewritten against `document.body`.
A structural test that can pass vacuously because its query root is wrong is worse than no test, so the mock stays.
If a later slice does need the real dialog (slice 02 owns outside-click behaviour, which happy-dom cannot exercise at all), it must switch the query root at the same time.

Local helpers the test needs:

```ts
const gridTemplate = (element: Element) =>
  element.className.match(/grid-cols-\[[^\]]+\]/)?.[0] ?? null;
const header = () => query('[data-sale-items-header]');
const rows = () => [...container.querySelectorAll('[data-sale-item-row]')];
```

`describe('Itens section grid alignment')`, tests:

1. `it('renders the header, every control row and every sub-row from one grid template')`
   - Collect `[data-sale-items-header], [data-sale-item-controls], [data-sale-item-subrow]`.
   - Assert `gridTemplate` is non-null for each element, and `new Set(templates).size === 1`.
   - Click `+ item avulso` then `+ item`, re-collect, assert the element count is `1 + 3 * 2 === 7` and the set is still size 1.
   - This is the structural oracle for the whole slice: it fails the moment anyone hand-tunes one row's columns, and it cannot be satisfied by a coincidence of similar strings.
2. `it('right-aligns the numeric headers and their values on the same inset edge')`
   - Header children 1, 2, 3 each contain `text-right` and `pr-3`; child 0 contains `text-left`; child 4 is the empty spacer, so header children length is 5.
   - `labeledInput('Quantidade do item 1').className` and `labeledInput('Valor unitário do item 1').className` contain `text-right`.
   - `[data-sale-item-subtotal]` className contains `justify-end` and `pr-3`.
   - None of the above contains `text-center`.
   - This asserts a real geometric relation (same 12px inset on both the label and the value), not a decorative class.
3. `it('gives every control in the item row the same 44px box')`
   - Qty and valor inputs: rendered className (post `tailwind-merge`) contains `h-11` and does **not** contain `h-10`. This is a genuine assertion because `Input` merges through `cn`, so it proves the resolved height rather than the requested one.
   - Picker select className contains `h-11` and `rounded-[10px]`.
   - `[data-sale-item-subtotal]` contains `h-11`.
   - Delete button (`aria-label="Remover item 1"`) contains `h-9`, `w-9` and `rounded-[10px]`.
4. `it('nests the secondary block inside the item row, not in the control grid')`
   - `const row = rows()[0]`, `controls = row.querySelector('[data-sale-item-controls]')`, `subrow = row.querySelector('[data-sale-item-subrow]')`.
   - Assert both exist, `subrow.parentElement === row`, `controls.contains(subrow) === false`.
   - `controls.children.length === 5`, i.e. exactly one cell per column, which is what defect 8 violated.
   - `subrow.children.length === 1` and that child's className contains `col-start-1` and `col-end-4`.
   - `controls.querySelector('[data-sale-item-area]')` is `null` and `subrow.querySelector('[data-sale-item-area]')` is not, i.e. the área badge no longer inflates the picker cell.
5. `it('renders exactly one sub-row per item even when the área is missing and the price is open')`
   - Re-render with `baseBootstrap({ products: [product({ openPrice: true, areaId: null })] })` and click `Avançar` once to raise `showItemErrors`.
   - Assert `rows()[0].querySelectorAll('[data-sale-item-subrow]').length === 1`.
   - Assert `labeledInput('Nome / descrição do item 1')` and the text `Defina a área deste produto em Cadastros > Produtos.` are both inside that single sub-row.
   - Assert the wizard is still on step 1 (`container.textContent` contains `Cliente e responsáveis`), which pins that the validation behaviour did not move.
6. `it('sizes the three Itens header buttons identically')`
   - For `Cadastrar produto`, `+ item avulso`, `+ item`: className contains `h-9` and `rounded-[10px]`, and none contains `py-[7px]`.

`sale-wizard-ui-contract.test.ts` is deliberately **not** extended.
It is a literal-substring test over the source text, and the grid contract is exactly the kind of claim that substring assertions on class strings cannot prove; test 1 above proves it structurally instead.
That file must keep passing untouched, so this slice preserves every string it asserts: `'Cadastrar produto'`, `'+ item avulso'`, and the step-1 copy around them are unchanged, and none of its negative assertions (`'Nova venda'`, `'Salvar venda'`, `'Fechamento da venda'`, `'Salvar incompleto'`, `'Confirmar venda'`, `'Passo {wizardStep} de 3'`) can be introduced by a layout-only diff.
If the executor finds it needs to change a string in this section, that is a signal the diff has left the slice's scope.

**ORACLE**

```bash
CI=true pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/__tests__/sale-items-grid-alignment.test.tsx
```

Use this exact form. `pnpm --filter @fxl-sales/web test -- --run <path>` was measured on this repo and does **not** filter: it expands to `vitest run -- --run <path>` and runs all 21 files.

Full gate before commit:

```bash
pnpm run lint
pnpm run type-check
CI=true pnpm test
```

Baseline for `apps/web` is 21 files / 122 tests green, verified three consecutive times; this slice adds 6 tests in 1 file.

## Green

1. Add `saleItemGridClass` immediately after `formSelectClass` (`:144`) with the template from **Target layout**.
2. Add an optional `className?: string` prop to `Field` (`:401-420`) and render `<label className={cn('flex flex-col gap-[6px]', className)}>`. Purely additive: every existing call site is unaffected, and it lets the sub-row pass `min-w-0` without cloning the label markup.
3. In the Itens header row (`:4306-4332`), give the three buttons `h-9` and `rounded-[10px]`, drop `py-[7px]`, and add `border border-transparent` to `+ item`. Do not touch their labels, `disabled`, `title` or handlers.
4. Replace the header grid (`:4333-4339`) with `cn(saleItemGridClass, 'pb-2 text-[11px] font-bold uppercase tracking-[0.06em] text-[#9b9ba3]')`, add `data-sale-items-header`, set the cells to `text-left`, `pr-3 text-right`, `pr-3 text-right`, `pr-3 text-right`, `<span aria-hidden="true" />`.
5. Wrap the header row and the existing `<div className="flex flex-col gap-2">` rows stack (`:4340`) in the two-element scroll container from **Narrow viewport**.
6. Item avulso branch (`:4342-4423`): set the row wrapper to `flex flex-col gap-1.5` with `data-sale-item-row`; set the control grid to `saleItemGridClass` with `data-sale-item-controls`; give the área select `className="h-11 rounded-[10px]"`; convert the static qty cell to `sales-ops-num flex h-11 items-center justify-end pr-3 text-sm text-[#57575f]`; make the valor input `cn('sales-ops-num text-right', formInputClass, showItemErrors && !unitValid && 'border-destructive')`; convert the subtotal cell per the table and add `data-sale-item-subtotal`; resize the delete button to `h-9 w-9 rounded-[10px]`.
7. Item avulso sub-row (`:4388-4421`): render `cn(saleItemGridClass, 'items-start')` with `data-sale-item-subrow`, one child `div` with `col-start-1 col-end-4 flex min-w-0 flex-col gap-[6px]`, containing `Field` (label `Descrição do item`, `className="min-w-0"`) around the existing `Input`, then the existing error block or aviso span with `pl-0.5` removed. Keep every `aria-label`, `aria-invalid`, `maxLength`, `placeholder`, message string and conditional exactly as they are.
8. Product branch control row (`:4437-4494`): same treatment as step 6. Remove the `flex flex-col gap-1` wrapper around the picker so the select is a direct grid child; give it `className="h-11 rounded-[10px]"`; make the qty input `cn('sales-ops-num text-right', formInputClass)` (drop `text-center`, keep `type="number"` and `min={1}`); make the valor input `cn('sales-ops-num text-right', formInputClass, showCustomUnitError && 'border-destructive')`; convert subtotal and delete as above.
9. Product branch sub-row: emit exactly one `cn(saleItemGridClass, 'items-start')` block with `data-sale-item-subrow` and one `col-start-1 col-end-4` cell containing, in order: the área badge moved out of step 8's picker cell and marked `data-sale-item-area` (both the named-área and the `Sem área` variants, colours unchanged, sized `inline-flex h-[22px] items-center self-start rounded-full px-2 text-[11px] font-bold`); the `product?.openPrice` `Field` + `Input` block from `:4495-4535` with `pl-0.5` removed; the `showAreaError` message from `:4536-4542` as a trailing `<span className="text-[11.5px] font-semibold text-destructive">`. Delete the two now-empty extra grids.
10. Confirm no `grid-cols-[` literal remains between the panel open (`:4305`) and its close, and that `data-sale-item-row` / `data-sale-item-controls` / `data-sale-item-subrow` each appear once per branch.
11. Write the test file described in **Red** and run the ORACLE command, then the full gate.
12. Visually verify in the running app at 1440px, 1024px, 768px and 390px: header text ends on the same line as its column's digits, the picker/qty/valor/subtotal/delete tops and bottoms line up, the sub-row reads as subordinate, and below roughly 732px the section scrolls horizontally as one unit with the header still over its columns.

## Refactor

- After step 10, `saleItemGridClass` is the only place column widths exist for this section, so the payment-plan grid (`:4599`, `:4612`) and the costs grid (`:4833`, `:4847`) are now visibly the two remaining copy-paste grids in the file. Leave them alone in this slice and note them for slice 11.
- `Field` now owns the only label style in the wizard for this section; if a later slice finds another hand-rolled `text-xs font-semibold text-[#8b8b92]` span, it should be converted to `Field` rather than duplicated again.
- Do not "tidy" `NativeSelect` in this slice; see **Out of scope** for why.

## Out of scope

- **Slice 06 (`combobox-adoption`) owns the picker itself.** This slice runs first and must leave the picker markup mechanical to swap: the select stays a `NativeSelect` with the same `value`, `onChange`, `aria-label` and `<option>` children, and gains only `className="h-11 rounded-[10px]"`. Do not introduce a wrapper element around it, and do not move the item avulso área select out of column 1.
- **Migrating `NativeSelect` (`:421-448`) to `cn`.** It is the correct fix for the class-merge fragility behind defect 5, but its blast radius is app-wide: at `:2752` and `:2972` the caller passes classes that currently lose to the base string under Tailwind's stylesheet ordering (notably `bg-white` losing to the base `bg-[#fafafb]` at `:2972`), and merging would change those screens. Out of this layout-only, atomic slice. This slice instead uses the already-proven in-file convention from `:4222`/`:4247`.
- **Hiding the native number spinner** on the qty input (`:4467`). Removing native spinners is item 4's territory (slices 03/06) and suppressing them changes a mouse affordance, so it is a behaviour change, not alignment. At rest the spinner is not painted in Chrome or Firefox, so right-aligned digits already sit on the `px-3` edge.
- **The dead `Cadastrar produto` button** (`:4309-4314`) has no `onClick` today. Wiring it belongs to slice 10 (`produtos-servicos-web`). Keep it inert; only its box model changes here.
- **Item 7 (`service-description-optional`)**, which changes when the descrição field is required, and items 8 to 11. This slice must not touch `descriptionValid`, `customLabelValid`, `showItemErrors`, `canAdvanceStepOne` or any message string.
- **Payment-plan and costs grids**, the totals bar (`:4558`), and every screen outside `:4305-4547`.
- Renaming or re-casing any pt-BR string in the section.

## Risks

- **Risk: the sub-row's `col-start-1 col-end-4` span is read as a magic number.** Mitigation: it is expressed in grid lines of the shared template rather than pixels, so it survives any width change to the constant, and test 4 pins it.
- **Risk: moving the área badge changes what an operator sees first.** Mitigation: the badge keeps its exact text and colours, and it moves only one line down into the sub-row it always belonged to. Test 4 pins the new location; `sale-wizard-free-items.test.tsx` and `sale-wizard-custom-item-labels.test.tsx` query by `aria-label` and by text content, so they keep passing.
- **Risk: dropping `text-center` on the qty input looks wrong to whoever wrote it.** Mitigation: the brief mandates right alignment for all three numeric columns, and with `pr-3` the digits align with the `Qtd.` header and with the valor and subtotal digits. Record the reason in the commit body.
- **Risk: `items-center` plus explicit `h-11` is mistaken for baseline alignment.** Mitigation: **Target layout** states that equal-height, equal-font-size, vertically centred cells give identical baselines and that `items-baseline` would be wrong here; the commit body repeats it so a later reviewer does not "fix" it.
- **Risk: the `overflow-x-auto` container clips focus rings or paints a scrollbar on desktop.** Mitigation: `min-w-[600px]` is below the desktop inner width so no scrollbar is painted above roughly a 732px viewport, and `px-0.5` inside the scroller (cancelled by `-mx-0.5`) leaves room for the ring. Step 12 checks this at four widths.
- **Risk: `Field` gaining a `className` prop leaks into other call sites.** Mitigation: the prop is optional and merged with `cn`, so omitting it reproduces today's class string byte for byte. `pnpm run type-check` plus the existing wizard tests cover the call sites.
- **Risk: the executor "helpfully" unifies `Descrição do item` and `Nome / descrição do item`.** Mitigation: both strings are listed as unchanged in steps 7 and 9; the `aria-label`s they pair with are queried by three existing test files, and slice 08 owns that copy.
- **Risk: `sale-wizard-ui-contract.test.ts` breaks on a moved string.** Mitigation: the **Red** section enumerates its assertions that touch this section (`'Cadastrar produto'`, `'+ item avulso'`) and this slice changes neither; the file is not edited.
- **Risk: conflict with slice 06 in the same 5207-line file.** Mitigation: the diff is confined to `:4305-4547` plus two additive edits at `:144` and `:401-420`, and it leaves the picker call shape intact so slice 06's swap is a one-element replacement.
- **Observation, not a risk of this slice:** one ad-hoc run of the web suite under the malformed `test -- --run <path>` invocation reported 1 failing test, which did not reproduce in three subsequent clean `vitest run` executions (21 files / 122 tests green each time). If the executor sees a failure that is not in the Itens section, capture the test name before re-running rather than retrying blindly.
