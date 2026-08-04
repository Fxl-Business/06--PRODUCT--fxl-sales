---
id: 07-professional-split-ui
milestone: v2.4.0
status: todo
depends_on: ["06-professional-split-persistence", "04-prefill-profissionais-do-produto"]
files_modified:
  - apps/web/src/sales-ops/types.ts
  - apps/web/src/sales-ops/SalesOpsApp.tsx
  - apps/web/src/sales-ops/calculations.ts
  - apps/web/src/sales-ops/__tests__/sale-wizard-professional-split.test.tsx
  - CLAUDE.md
acceptance: "given step 3 Custos e margem with a three-parcela plan and a professional costing R$ 10.000,00, when the operator opens Detalhe de pagamento and sets two parts of 30% and 70%, then the panel prints R$ 3.000,00 and R$ 7.000,00, blocks advancing while the parts do not sum to 100%, and the submitted payload carries costSplitBp: [3000, 7000]."
---

This slice runs AFTER `03-profissional-picker-funcao-first` (which makes FUNÇÃO
the first column and filters the person picker) and
`04-prefill-profissionais-do-produto` (which auto-seeds rows from produto função
costs). Assume both have landed. It is written to touch NEITHER the grid
template NOR the column order, so it cannot conflict with 03.

## 1. Current behaviour

* `ProfessionalForm` — `apps/web/src/sales-ops/SalesOpsApp.tsx:5034-5061`.
  Fields: `personId`, `personName`, `funcaoId`, `funcaoName`, `costUnit`,
  `costPct`, `costBrl`, `costManual`. No schedule.
* State — `SalesOpsApp.tsx:5528`,
  `useState<ProfessionalForm[]>(prefill?.professionals ?? [])`.
* Edit prefill — `SalesOpsApp.tsx:5285-5302`, maps `bootstrap.saleProfessionals`.
* Submit — `SalesOpsApp.tsx:6399-6409`, maps to `SaleDraftProfessional`.
* Step-3 table — `SalesOpsApp.tsx:7262-7524`. Grid template
  `[minmax(0,1fr)_minmax(0,1fr)_212px_36px]` at `:7299` (header) and `:7325`
  (rows). Each row's cost cell is a
  `<div className="flex flex-col items-end gap-1">` at `:7398`, holding the
  `UnitToggle` pair, the `UnitInput`, and then one of three mutually exclusive
  hints: the `%` derivation, the `Alterado manualmente` chip, or the plain
  derivation string (`:7444-7503`).
* Step-3 gate — `professionalsValid` at `:5851-5853`, `canAdvanceStepThree` at
  `:5854`, error banner at `:7519-7523`.
* Plan rows — `installmentRows: InstallmentRowForm[]` (type at `:5033`), each
  `{ dueDate, amountBrl: string, method }`. The recorrência is SEPARATE state
  (`recurringEnabled`, `recurringMonthlyBrl`, ...), which is why step 3 can
  preview exactly the rows the server will split against.
* Types — `SalesOpsSaleProfessional` at `types.ts:230-247` (the read model) and
  `SaleDraftProfessional` at `types.ts:318-329` (the write model).
* The in-flow disclosure precedent is `descriptionOpen` on `SaleItemForm`
  (`SalesOpsApp.tsx:5029`). It does NOT call `useInlineLayer`, and it is right
  not to: `useInlineLayer` guards ABSOLUTELY POSITIONED overlays
  (`Combobox`'s panel, `InfoHint`'s `absolute ... z-50` panel), where an Escape
  aimed at the layer would close the whole wizard. An in-flow expander is not
  such a layer. Mirror `descriptionOpen`.

## 2. The fix

### 2a. Types

`types.ts` — `SalesOpsSaleProfessional` gains:

```ts
/** Basis points, summing to exactly 10000. `null` = the default pro-rata split. */
costSplitBp?: number[] | null;
```

`SaleDraftProfessional` gains `costSplitBp?: number[] | null;` with the same
comment plus "omitted or null means the API applies the default".

### 2b. `ProfessionalForm`

Two new fields, after `costManual`:

```ts
/**
 * The manual payment schedule in BASIS POINTS, or `null` for the default
 * pro-rata over the parcelas. Unlike `costUnit` this IS persisted, in
 * `sales_ops_sale_professionals.cost_split_bp`, because it is a rule that must
 * survive a later `costBrl` edit rather than an input mode.
 */
costSplitBp: number[] | null;
/** Disclosure state for `Detalhe de pagamento`. Mirrors `SaleItemForm.descriptionOpen`. */
splitOpen: boolean;
```

Seed `costSplitBp: null, splitOpen: false` in BOTH row constructors: the
`+ profissional` handler at `:7285-7297` and whatever seeding
`04-prefill-profissionais-do-produto` introduces. On the edit path
(`:5285-5302`) seed `costSplitBp: row.costSplitBp ?? null` and
`splitOpen: false`.

### 2c. Derived state

Near `professionalCents` (`:5881`):

```ts
const splitReceivableAmounts = installmentRows.map((row) =>
  parseCurrencyInputToCents(row.amountBrl),
);
const splitParcelaCount = splitReceivableAmounts.length;
```

Per row, inside the map at `:7315`:

```ts
const rowCostCents = professionalRowCents(professional);
const rowWeightsBp = professional.costSplitBp ?? defaultSplitBp(splitReceivableAmounts);
const rowPartCents = splitCentsByWeights(rowCostCents, rowWeightsBp);
```

Import `defaultSplitBp` and `splitCentsByWeights` from
`@fxl-sales/shared-utils/professional-split`. The SUBPATH, not the root — same
reason CLAUDE.md gives for `/sale-financials`: the root re-exports the Node-only
hmac module.

This is what makes the panel WYSIWYG: the wizard and the server run literally the
same function over the same weights.

### 2d. Validation

```ts
const professionalSplitsValid = professionals.every(
  (row) =>
    row.costSplitBp === null ||
    (row.costSplitBp.length >= 1 &&
      row.costSplitBp.length <= Math.max(1, splitParcelaCount) &&
      row.costSplitBp.reduce((a, b) => a + b, 0) === SPLIT_BP_TOTAL),
);
```

`canAdvanceStepThree` (`:5854`) becomes
`professionalsValid && professionalSplitsValid`. Add a second banner beside
`:7519`, gated on `showCostErrors && !professionalSplitsValid`, in the same
`#fbeee9` / `#b23a22` styling:

> A divisão de pagamento de cada profissional deve somar 100%.

### 2e. The trigger

Inside the existing cost cell (`:7398`), as the LAST child, after the three
mutually exclusive hint branches. A plain text button in the established
`text-[11px] font-semibold ... underline` idiom already used by
`Restaurar padrão`, but in a muted tone so it does not read as a warning.

Note: use `#6a6a72`, not `#8b8b92`. `nexo/ROADMAP.md` records that `#8b8b92` on
white is 3.38:1, under WCAG AA's 4.5:1, and that `#6a6a72` (5.36:1) is the
established replacement. Do not introduce a new instance of the failing tone.

```tsx
<button
  aria-expanded={professional.splitOpen}
  aria-label={`Detalhe de pagamento do profissional ${index + 1}`}
  className="text-[11px] font-semibold text-[#6a6a72] underline hover:text-[#201f24]"
  onClick={() => setProfessionals((current) => current.map((item, i) =>
    i === index ? { ...item, splitOpen: !item.splitOpen } : item))}
  type="button"
>
  {professional.costSplitBp
    ? `Detalhe de pagamento (${professional.costSplitBp.length}x)`
    : `Detalhe de pagamento (${Math.max(1, splitParcelaCount)}x)`}
</button>
```

`aria-label` is INDEXED, not name-interpolated — the same rule the `UnitToggle`
labels already follow at `:7407`, and it is what makes the row addressable from a
test the moment it is added.

Putting the trigger inside the existing cell rather than in a new grid column is
what keeps this slice free of `03-profissional-picker-funcao-first`: the grid
template string is not edited at all.

### 2f. The panel

Rendered as the next child of the SAME grid row `div` (`:7325`), guarded on
`professional.splitOpen`, with `className="col-span-full ..."`. `col-span-full`
survives any column count, so 03's reorder cannot break it. It is IN FLOW — no
`absolute`, no `z-50`, no portal — therefore no `useInlineLayer`, matching
`descriptionOpen`.

Content:

* Header: `Detalhe de pagamento` plus the professional's name, and an
  `InfoHint label="Detalhe de pagamento"` reading:
  > Por padrão o custo é dividido entre as parcelas na mesma proporção do plano
  > de pagamento. Você pode definir uma divisão própria para este profissional.
* Zero-parcela guard: when `splitParcelaCount === 0`, render only
  > Defina o plano de pagamento na etapa 2 para dividir este custo.
  and no editor.
* **Default state** (`costSplitBp === null`): a read-only list, one line per
  parcela — `Parcela {i+1} · {formatIsoDateBr(installmentRows[i].dueDate)} · {bpToPercentLabel(rowWeightsBp[i])} · {formatMoneyBrl(rowPartCents[i])}`
  — then a footer `Total {formatMoneyBrl(rowCostCents)}`, then a button
  `Personalizar divisão`. That button sets
  `costSplitBp: defaultSplitBp(splitReceivableAmounts)`, so the operator EDITS
  the default rather than starting from an empty form.
* **Override state** (`costSplitBp !== null`): one editable line per part —
  `Parte {i+1}`, a `<UnitInput unit="%" ariaLabel={\`Parte ${i+1} do profissional ${index+1}\`}>`
  bound to the bp value shown as percent with up to 2 decimals, and beside it the
  read-only `= {formatMoneyBrl(rowPartCents[i])}` plus, when
  `i < splitParcelaCount`, the bound parcela's date. Then:
  * `+ parte`, disabled when `costSplitBp.length >= splitParcelaCount`.
  * `Remover parte N` per row, hidden when there is only one part.
  * `Distribuir igualmente` → `splitCentsByWeights(SPLIT_BP_TOTAL, Array(n).fill(1))`,
    which is exactly how the exact-sum rule reaches the editor.
  * A live sum line: `Soma {pct}%`, in a muted tone when it is exactly 100,00% and
    in `#b23a22` otherwise.
  * `Usar padrão` → `costSplitBp: null`.
* When `costSplitBp.length < splitParcelaCount`, a muted note:
  > As parcelas {n+1} em diante não pagam este profissional.

Percent conversion: `bp / 100` for display; on input, `Math.round(value * 100)`
for storage. Adding or removing a part does NOT auto-renormalize — the operator
sees the sum go off 100% and fixes it, which is the same discipline step 2 uses
with `Soma das parcelas`. Only `Distribuir igualmente` and `Personalizar divisão`
write a guaranteed-100% vector.

### 2g. Submit

At `:6399-6409`, add to the mapped object:

```ts
costSplitBp: professional.costSplitBp,
```

`null` travels as `null`; the API's `.nullish()` accepts it and stores `NULL`.

Note: slice 03 adds a `.filter()` on `personName` ahead of this `.map()`. Keep
that filter; add the field inside the mapped object only.

### 2h. Comment repairs

The premise "one-shot at win with `receivableId: null`" is now false. Rewrite it
wherever it appears in `apps/web`, keeping every conclusion:

* `calculations.ts:189-198` (`buildFuncaoCostBasis` doc comment)
* `calculations.ts:246-260` (`professionalCostBaseCents` doc comment)
* `SalesOpsApp.tsx:5042-5046` (`ProfessionalForm.costUnit` doc comment)
* the inline comments at `__tests__/calculations.test.ts:538`,
  `__tests__/sale-margin-parity.test.ts:76` and
  `__tests__/sale-wizard-funcao-costs.test.tsx:563`

Replacement reasoning, adapted per site: a `professional_cost` is a PAY-ONCE
TOTAL, so pricing it off a monthly stream would charge it against every cycle;
the per-receivable split changes only WHEN it is paid, under a
`Σ parts === cost_brl` contract, and it skips the `M`-labelled rows too.

NO behavioural change to any of those functions.

## 3. The named oracle test

File: `apps/web/src/sales-ops/__tests__/sale-wizard-professional-split.test.tsx`

Header `// @vitest-environment happy-dom`, then the established harness from
`sale-wizard-funcao-costs.test.tsx:1-30`: `createRoot`, the
`vi.mock('@/components/ui/dialog', ...)` block, `SaleWizardDialog` imported from
`../SalesOpsApp`.

Build first: `pnpm run build:packages`. Then run once:

```
pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/__tests__/sale-wizard-professional-split.test.tsx
```

* `it('shows the default pro-rata split for the parcelas')` — a 3-parcela plan
  of 1000 / 2000 / 2000 reais and a professional at R$ 500,00; open the panel;
  assert `R$ 100,00`, `R$ 200,00`, `R$ 200,00` and a `R$ 500,00` total.
* `it('reproduces the user 10k/20k/20k/50k case')` — a R$ 100.000,00 proposta,
  parcelas 10k/20k/20k/50k, professional at R$ 10.000,00; assert
  `R$ 1.000,00 / R$ 2.000,00 / R$ 2.000,00 / R$ 5.000,00`.
* `it('submits costSplitBp null while the split is untouched')` — save; assert
  `payload.professionals[0].costSplitBp` is `null`.
* `it('submits a 30/70 override and shows its reais')` — THE acceptance test.
  Click `Personalizar divisão`, remove the third part, type 30 and 70, assert
  `R$ 3.000,00` and `R$ 7.000,00` on screen and
  `costSplitBp: [3000, 7000]` in the payload.
* `it('submits a one-part override for a professional paid in a single time')` —
  `[10000]`, plus the "parcelas 2 em diante não pagam" note.
* `it('blocks advancing while the parts do not sum to 100%')` — set 30 / 30;
  assert the `Soma` line shows `60,00%`, the banner
  `A divisão de pagamento de cada profissional deve somar 100%.` appears, and
  step 4 is not reachable.
* `it('keeps the override when the cost changes')` — set `[3000, 7000]`, then
  change `CUSTO ALOCADO` from R$ 10.000,00 to R$ 20.000,00; assert the panel now
  reads `R$ 6.000,00` / `R$ 14.000,00` and the payload still carries
  `[3000, 7000]`. THIS IS THE TEST THAT JUSTIFIES BASIS POINTS. It fails
  outright under a cents-denominated column.
* `it('distributes equally with the last part absorbing the remainder')` —
  three parts via `Distribuir igualmente` → `[3333, 3333, 3334]`.
* `it('restores the default with Usar padrão')` — override then clear; payload
  `costSplitBp` is `null` again.
* `it('reopens a stored override on the edit path')` — a bootstrap
  `saleProfessionals` row with `costSplitBp: [3000, 7000]`; assert the panel
  opens in override state showing 30% / 70%, and that saving untouched
  round-trips `[3000, 7000]`.
* `it('caps the part count at the parcela count')` — a 2-parcela plan; assert
  `+ parte` is disabled at 2 parts.
* `it('tells the operator to set a plan when there is no parcela')` — the
  zero-parcela guard copy.

## 4. Scope limits (YAGNI)

* **No `R$` input mode per part.** Each part is entered as a percentage and
  PRINTS its resolved reais beside it. A reais input would have to convert to bp
  on every keystroke and would go stale the moment `CUSTO ALOCADO` changed —
  which is one control away in the same row. Reading the reais is what the
  operator actually needs; typing them is not. This is a deliberate reading of
  "a % or a cents value": the cents are always visible, never authored.
* **No per-part date override.** A part's date IS its parcela's date. Letting the
  two diverge would break the `receivable_id` link that makes `cancelContract`
  correct.
* **No `other_cost` panel.** Decided in `00-OVERVIEW-split.md` Decision 5.
* **No split on the recorrência.** Step 3 previews `installmentRows` only,
  matching the server exactly.
* **No changes to the grid template or column order.** That belongs to
  `03-profissional-picker-funcao-first`.
* **No new dialog.** The panel is an in-flow disclosure. A nested Radix `Dialog`
  inside the wizard would drag in the whole `useInlineLayer` Escape problem for
  zero benefit.
* **No `Alterado manualmente` chip for the split.** The trigger's own
  `(2x)` / `(3x)` suffix already says the schedule diverges from the parcela
  count, and a second amber chip in that cell would compete with the cost one.

## 5. CLAUDE.md edits

Under `## Propostas domain`, appended after the four paragraphs slice 06 added.

New:

> - `Detalhe de pagamento` is an IN-FLOW disclosure inside the step-3 professionals table, spanning the row with `col-span-full`, and it deliberately does NOT call `useInlineLayer`. That hook guards ABSOLUTELY POSITIONED layers — `Combobox`'s panel, `InfoHint`'s panel — where an Escape aimed at the layer would otherwise close the whole wizard. An expander that pushes content in flow is not such a layer, and the existing precedent is `SaleItemForm.descriptionOpen`, which does the same thing the same way.
> - Each part is entered as a PERCENTAGE and prints its resolved reais beside it; there is no `R$` input mode per part and there must not be one. A reais-denominated part would have to be reconverted on every `CUSTO ALOCADO` keystroke, one control away in the same row, and would be stale in between — which is the same reason `cost_split_bp` stores basis points rather than cents. The wizard's preview calls the SAME `defaultSplitBp` / `splitCentsByWeights` the server calls, so the parcela amounts on screen are the payables that will be written at win.
> - `canAdvanceStepThree` gates on `professionalSplitsValid` as well as `professionalsValid`: an override must have between 1 and `installmentRows.length` parts and must sum to exactly 10000 bp. Adding or removing a part deliberately does NOT renormalize — the `Soma` line goes red and the operator fixes it, exactly as step 2's `Soma das parcelas` behaves. Only `Distribuir igualmente` and `Personalizar divisão` write a guaranteed-100% vector, and both go through `splitCentsByWeights`, so the editor obeys the same last-part-absorbs-the-remainder rule as everything else.

## 6. Risk / invariants touched

* **Merge risk with 03 and 04.** Both own the professionals table. Mitigated
  structurally: this slice adds no grid column, edits no grid template string,
  and adds no column header. Its only row-level insertions are one button at the
  end of the existing cost cell and one `col-span-full` sibling. Take 03 and 04
  first; if the executor finds the cost cell restructured, the button still
  belongs at the end of whatever container holds `Restaurar padrão`.
* **`ProfessionalForm` gains two fields**, so every construction site must seed
  them. There are at least three (`+ profissional`, the edit prefill, and
  whatever 04 adds). A missing seed makes `costSplitBp` `undefined`, which
  `professionalSplitsValid` would pass and the payload would send as `undefined`
  — silently defaulting. Make the field REQUIRED and non-optional in the type so
  TypeScript catches every site.
* **WYSIWYG invariant:** the panel's amounts must equal the payables written at
  win. Held by calling the identical shared functions over
  `installmentRows` — which is exactly the set of receivables the server's
  `isRecurringReceivableLabel` filter leaves. If step 2 ever starts writing
  recurring rows into `installmentRows`, this breaks; that would break
  `deriveWizardPrefill` first, which already partitions on the `M` prefix at
  `SalesOpsApp.tsx:5226-5227`.
* **Subpath import.** Use `@fxl-sales/shared-utils/professional-split`, never the
  package root — the root pulls in the Node-only hmac module and will not bundle
  for the browser.
* **`splitParcelaCount === 0`.** Reachable while step 2 is mid-edit. The guard
  branch renders copy instead of an editor, and `Math.max(1, ...)` in the
  validator keeps the gate from rejecting a null-split row on an empty plan.
