---
id: 11-payment-plan-builder
milestone: v2.3.0
status: todo
depends_on: [06-combobox-adoption]
files_modified:
  - apps/web/src/sales-ops/calculations.ts
  - apps/web/src/sales-ops/SalesOpsApp.tsx
  - apps/web/src/sales-ops/__tests__/calculations.test.ts
  - apps/web/src/sales-ops/__tests__/payment-plan-generation.test.ts
  - apps/web/src/sales-ops/__tests__/sale-wizard-payment-plan.test.tsx
  - apps/web/src/sales-ops/__tests__/sale-wizard-edit.test.tsx
  - apps/web/src/sales-ops/__tests__/sale-wizard-ui-contract.test.ts
acceptance: "given a proposta whose itens total R$ 73.000,00, when the operator sets Entrada to 50% and Restante to 3 x on step 2 of the wizard, then 4 editable parcela rows are generated live (R$ 36.500,00 on the base date plus three monthly rows) whose Soma equals R$ 73.000,00 to the cent, and no Dividir, + parcela, or Adicionar recorrência control exists anywhere in step 2"
---

# Declarative payment plan builder (entrada + restante + recorrência)

## Goal

Replace the manual `Dividir` / `+ parcela` / `+ Adicionar recorrência` toggling in wizard step 2 with a declarative three-control header - `Entrada (nenhuma | % | R$ fixo)`, `Restante em N x`, `Recorrência (nenhuma | mensal)` - that regenerates the `Parcelas a receber` table live as the operator types, while keeping every generated row individually editable for exceptions.
The three phrases the human named must each be one obvious configuration: "50% de entrada + o resto em 3x", "valor fixo R$ X de entrada + o resto em 1 mês", and "tudo pago em 1x".
The generation, rounding, due-date and round-trip rules move into pure exported functions in `calculations.ts` so they are unit-testable without the DOM, and the persisted shape (`installments: [{dueDate, amountBrl, method}]` plus optional `recurring: {monthlyBrl, startDate, cycles|null}`) and the `"N/M"` / `"MN/M"` receivable label conventions are untouched.

## Current state

Anchors verified by reading the files at plan time.

- `apps/web/src/sales-ops/SalesOpsApp.tsx` is 5207 lines.
  `SaleWizardDialogBody` spans :3654-5207.
- Step 2 is gated by `wizardStep === 2` at :4567.
  The `Plano de pagamento` card is :4569-4705, the `Recorrência` card is :4707-4802.
- Manual controls to delete: the `Dividir em` label :4573, the `Número de parcelas` input :4574-4581, the `Dividir` button :4583-4589, the `+ parcela` button :4590-4596.
- The row grid is `grid-cols-[44px_minmax(0,1fr)_150px_150px_36px]` at :4599 and :4612, with per-row date input :4616-4635, amount input :4636-4654, `NativeSelect` forma :4655-4672, and a `Remover parcela N` trash button :4673-4686.
- `Soma das parcelas` is :4691-4698 and the mismatch warning is :4699-4704.
- The `Recorrência` card holds `Mensalidade (R$)` :4723-4730, `Início` :4731-4739, `Nº de ciclos` :4740-4750, the `Prazo indeterminado` checkbox button :4752-4767, the green mensalidade summary :4778-4785, the indefinite note :4786-4790, and the `Adicionar recorrência` dashed placeholder :4792-4801.
- Plan state: `installmentRows` :3736-3740, `planAuto` :3741, `planAutoKey` :3742, `splitCount` :3743, `showPlanErrors` :3744, `recurringEnabled` :3745, `recurringMonthlyBrl` :3746, `recurringStartDate` :3747-3749, `recurringCycles` :3750, `recurringIndefinite` :3751, `recurringSource` :3752-3760, `recurringMethod` :3761 (state with no UI, prefill-preserving only).
- The current auto behaviour is the render-phase block at :3789-3793: while `planAuto` is true, any change to `[totalCents, baseDate]` collapses the plan to a single row for the full total.
  `planAuto` starts false whenever an edit prefill supplied rows (:3741), which is what freezes an edited plan today.
- Derived validation: `planSumCents` :3811, `planDeltaCents` :3812, `planRowsValid` :3813-3817, `planValid` :3818, `recurringMonthlyCents` :3819, `recurringCyclesCount` :3820, `recurringValid` :3821-3825, `canAdvanceStepTwo` :3826.
- Handlers: `applySplit` :3985-3995, `addInstallmentRow` :3997-4006, `advanceWizard` :4034-4048, `createPayload` :4054-4117 (installments at :4075-4079, recurring at :4080-4087), `submit` :4119-4123.
- `previewReceivables` :3868-3879 feeds the step-4 `Previsão de contas a pagar` and reads `recurringIndefinite` at :3873.
- Form types: `SaleItemForm` :3495-3502, `InstallmentRowForm` :3504.
- `WizardPrefill` :3532-3554 and `deriveWizardPrefill` :3556-3630.
  It splits receivables on the `M` label prefix at :3564-3565, maps installment receivables verbatim into `installmentRows` at :3616-3620, and derives the recurring block at :3621-3628.
- Money and date helpers to reuse: `dateOnly` :245, `displayDate` :249, `inputDateToday` :256, `parseCurrencyToCents` :260, `centsToInput` :264, `parseDecimal` :269, `pctToInput` :276.
  Shared styles: `formInputClass` :142, `Field` :401-419, `NativeSelect` :421-447.
- `apps/web/src/sales-ops/calculations.ts` already owns the pieces this slice builds on: `parseCurrencyInputToCents` :86, `formatMoneyBrl` :112 (`Intl.NumberFormat('pt-BR')` at :117), `addMonthsToIsoDate` :127-131, `splitInstallmentsEqually` :133-146, `installmentSumCents` :148-150, `buildSalePayload` :152-195.
- `addMonthsToIsoDate` :127-131 currently **overflows** month ends via `Date.UTC(year, month - 1 + months, day)`, so `2026-01-31` plus one month yields `2026-03-03`.
  The API's equivalent `addMonths` at `apps/api/src/domains/sales-ops/service.ts:256-265` **clamps** with `Math.min(day, lastDay)`, so it yields `2026-02-28`.
  The two disagree today for any base day of 29-31, which means the web preview of recurring due dates does not match the receivables the API actually writes in `buildSaleLedger` :346-373.
- No `Combobox` component exists yet under `apps/web/src/components/ui/`; slices 03 and 06 introduce it, and this slice consumes it.
  Per slice 03 it is inline and non-portalled with no new dependency, so it is directly reachable from the `container` DOM queries in these tests without any `vi.mock`.
  It is single-select and takes an `entityGender?: 'm' | 'f'` prop for pt-BR agreement, and its accent palette is amber (`bg-[#fdf7e8] text-[#9c7210]`) rather than `bg-primary`, because `--primary` resolves to blue in this repo while the product's de-facto primary is `#eaa81a` / `#9c7210`.
- `SaleWizardDialog` :3644 remounts `SaleWizardDialogBody` on a composite `key` built from `bootstrap.clients[0]?.id`, `bootstrap.products[0]?.id` and `bootstrap.people.length`, and those lists are name-ordered server-side, so any bootstrap refetch that reorders them wipes all in-progress wizard state.
  Slice 01 (wave 1, lands before this slice) fixes that remount key.
- `SalesOpsProduct` in `apps/web/src/sales-ops/types.ts:31` has no `defaultPaymentPlan` field.

## Target UI

Step 2 becomes **one** card titled `Plano de pagamento` (the title is deliberately kept, see `## Test fallout`), followed by the recurrence sub-block inside the same card.
Vertical rhythm, control heights and radii match the rest of the wizard: every control is `h-10 rounded-[9px]` with `formInputClass`, matching the existing row inputs at :4620 and :4640, and the header grid uses the same `gap-[9px]` as the row grid so the header controls and the table columns share one optical baseline.
All accent styling in step 2 uses the product amber (`#eaa81a` / `#9c7210`, amber surfaces `#fdf0cf` / `#fdf7e8`) and never `bg-primary`, matching the palette decision slice 03 made for the Combobox because `--primary` is blue in this repo.

### Header - declarative, always visible, never a toggle

A `md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]` grid holding two labelled groups, then a full-width recurrence group.

1. `Entrada`
   - Combobox, `aria-label="Tipo de entrada"`, options `nenhuma` / `%` / `R$ fixo`, width `w-[132px]`.
   - Value input, `aria-label="Valor da entrada"`, `sales-ops-num text-right`, hidden and unmounted when the mode is `nenhuma`.
   - Right-aligned derived hint in `text-[12.5px] font-bold text-[#2f7d4b]`: `R$ 36.500,00`.
     When the mode is `nenhuma` the hint reads `sem entrada` in `text-[#9b9ba3]`.
2. `Restante`
   - Numeric text input, `aria-label="Parcelas restantes"`, `w-[72px] text-center`, followed by a static `x`.
   - Right-aligned derived hint: `3 x R$ 12.166,66 (última R$ 12.166,68)`.
     The parenthetical appears only when the remainder is non-zero.
     This deliberately refines the mock's `3 x R$ 12.166,67`, which is 1 cent above the real total; the hint must never state a value the table does not contain.
     When `restanteCents === 0` the hint reads `entrada cobre o total`.
3. `Recorrência`
   - Combobox, `aria-label="Recorrência"`, options `nenhuma` / `mensal`.
   - When `mensal`, a `md:grid-cols-3` row reveals `Mensalidade (R$)` (`aria-label="Valor da mensalidade"`), `Início` (`aria-label="Início da recorrência"`, native `<input type="date">`, unchanged per the overview's Deliberately excluded section), and `Nº de ciclos` (`aria-label="Número de ciclos"`, plain text input, no native number spinner) with the helper caption `Deixe em branco para prazo indeterminado`.
   - The green summary line from :4778-4785 is kept verbatim in wording: `Mensalidade de R$ 1.000 a partir de 29/08/2026, por 12 ciclos` or `..., por prazo indeterminado`.
   - When ciclos is blank, the existing note `Sem parcelas futuras geradas agora - a mensalidade entra como receita recorrente (MRR).` is kept.
   - When ciclos is filled, a muted read-only line `12 ciclos de R$ 1.000,00, de 29/08/2026 a 29/07/2027` replaces it.
   - The `Prazo indeterminado` checkbox button and the `Adicionar recorrência` dashed placeholder are both deleted; blank ciclos is the only expression of indefinite, and picking `mensal` in the combobox is the only way to enable recurrence.

### Table - `Parcelas a receber`

- Column header row `Nº | VENCIMENTO | VALOR | FORMA` in the existing `text-[11px] font-bold uppercase tracking-[0.05em] text-[#9b9ba3]` style.
- Grid becomes `grid-cols-[44px_minmax(0,1fr)_150px_150px]`.
  The 36px trash column is removed along with the `Remover parcela N` buttons, because `Restante em N x` now owns the row count and a manual remove would desynchronise it.
- `Vencimento` stays a native `<input type="date">`, `Valor` stays a right-aligned text input, `Forma` becomes the slice 06 Combobox with the same four options (`Pix`, `Cartão`, `Boleto`, `Transferência`) and the same `aria-label={`Forma de pagamento da parcela ${index + 1}`}`.
- All existing per-row `aria-label` values are preserved (`Vencimento da parcela N`, `Valor da parcela N`, `Forma de pagamento da parcela N`) and so is the `aria-invalid` / `border-destructive` treatment at :4617-4623 and :4637-4643.
- `Soma das parcelas` and the mismatch warning at :4691-4704 are kept unchanged, including the exact copy `A soma das parcelas precisa ser igual ao total da proposta.`.

### States

| State | Trigger | Rendering |
| --- | --- | --- |
| Clean generated | fresh wizard, or an edit whose rows match a formula | rows regenerate live on every header or total change, no banner |
| Entrada cobre o total | `entradaCents === totalCents` | one row only, restante hint reads `entrada cobre o total`, `Parcelas restantes` stays editable but generates nothing |
| Manually adjusted | any row date or amount edited | muted line `Plano ajustado manualmente` plus a `Regerar plano` link-button on the right of the card header; rows frozen |
| Pending regeneration | manually adjusted **and** a header control was then changed | amber bar: `Você ajustou as parcelas manualmente. Aplicar entrada + 3 x vai substituir as parcelas editadas.` with `Aplicar` and `Manter parcelas` buttons |
| Invalid | `showPlanErrors` and a row is empty or zero, or ciclos is a non-numeric non-blank string | existing red field borders plus the existing warning box |
| Recorrência mensal, ciclos blank | ciclos input empty | `cycles: null` in the payload, no bounded rows anywhere in the UI |

## Generation rules

All four rules live in pure exported functions in `apps/web/src/sales-ops/calculations.ts`.
The wizard holds only state and calls them.

```ts
export type PaymentPlanShape = {
  entradaMode: 'none' | 'pct' | 'fixed';
  entradaValue: number;   // percent (0-100) when 'pct', integer cents when 'fixed', ignored when 'none'
  restanteCount: number;  // 1-120
  anchorDate: string;     // yyyy-mm-dd, the due date of row 1
};

export function entradaCentsFor(totalCents: number, shape: PaymentPlanShape): number;

export function generateInstallmentPlan(
  totalCents: number,
  shape: PaymentPlanShape,
  methods: PaymentMethod[],
): Array<{ dueDate: string; amountBrl: number; method: PaymentMethod }>;

export function inferPaymentPlanShape(
  totalCents: number,
  rows: Array<{ dueDate: string; amountBrl: number; method: PaymentMethod }>,
  fallbackAnchorDate: string,
): { shape: PaymentPlanShape; matchesFormula: boolean };
```

### Rounding

1. `entradaCentsFor`: mode `none` gives `0`; mode `pct` gives `Math.round((totalCents * pct) / 100)` (half up, computed on integer cents, never on floats derived from reais); mode `fixed` gives the parsed cents as-is.
   Both non-`none` results are clamped to `[0, totalCents]`.
2. `restanteCents = totalCents - entradaCents`.
3. The restante rows are produced by the **existing** `splitInstallmentsEqually` :133-146: `base = Math.floor(restanteCents / n)`, rows 1..n-1 get `base`, and the **last row absorbs the whole remainder** (`restanteCents - base * (n - 1)`, which is `base` plus 0 to n-1 cents).
4. Therefore `entradaCents + sum(restanteRows) === totalCents` exactly, by construction, for every input.
   `Soma das parcelas` can only ever disagree with the total after a manual row edit, which is precisely what the existing warning is for.
5. `splitInstallmentsEqually` is **reused, not superseded**.
   Its floor-plus-remainder-on-last rule is already pinned by `apps/web/src/sales-ops/__tests__/calculations.test.ts:188-200`, it already satisfies the exactness requirement, and duplicating a second rounding rule in the same file would be the real defect.
   Worked example for the acceptance case: total `7300000`, entrada 50% gives `3650000`, restante `3650000` over 3 gives `1216666 + 1216666 + 1216668`, and `3650000 + 3650000 === 7300000`.

### Due dates

1. Row 1 (the entrada row when there is one, otherwise the first restante row) is dated `shape.anchorDate`.
2. When an entrada row exists, restante row `k` (1-based) is dated `addMonthsToIsoDate(anchorDate, k)`.
   When there is no entrada row, restante row `k` is dated `addMonthsToIsoDate(anchorDate, k - 1)`.
3. Every date is recomputed from `anchorDate` with an absolute month offset, never incrementally from the previous row, so month-end clamping cannot drift.
4. **Month-end rule: clamp to the last valid day of the target month.**
   `2026-01-31` plus one month is `2026-02-28`; plus two months is `2026-03-31` again, not `2026-03-28`.
   This requires rewriting `addMonthsToIsoDate` in `calculations.ts:127-131` to the clamping form already used by the API at `apps/api/src/domains/sales-ops/service.ts:256-265`.
   That is a deliberate behaviour change and it fixes a real latent bug: today the web previews recurring due dates that roll over (`2026-03-03`) while the API persists clamped ones (`2026-02-28`), so the wizard lies to the operator for any base day of 29-31.
   The single existing assertion pinning the old rollover, `calculations.test.ts:202-204`, is rewritten (see `## Test fallout`).
5. `anchorDate` is internal state (`planAnchorDate`), not a control.
   It is seeded from the proposta `baseDate` on create and from the first stored installment's due date on edit, and it is re-seeded to `baseDate` whenever the step-1 `Data-base` field changes.
   No `Data-base` control is added to step 2; the approved shape does not include one.

### Recurrence

1. The `Recorrência` combobox replaces the `recurringEnabled` boolean plus the dashed placeholder: `nenhuma` maps to `recurring: null`, `mensal` maps to the block.
2. `recurringIndefinite` stops being independent state and becomes derived: `recurringCycles.trim() === ''`.
   `recurringCyclesCount` keeps its existing `Math.max(1, Math.min(120, ...))` clamp for the bounded case only.
3. `cycles: null` (blank ciclos) generates **no** bounded rows anywhere: not in the `Parcelas a receber` table, not in `previewReceivables` :3868-3879, and not in the recurrence read-only line.
   Only the MRR note is shown.
   This preserves the CLAUDE.md rule verbatim.
4. Recurrence never contributes rows to the `Parcelas a receber` table and never affects `planSumCents`.
   The table is exactly the persisted `installments[]` array; the `M`-labelled rows are generated server-side by `buildSaleLedger` and are not editable, so mixing them into an editable table would break the persisted shape.
   `planValid` therefore keeps its current meaning: the installment rows must sum to the itens total.
5. `recurringMethod` :3761 stays a UI-less prefill-preserving state.
   The approved shape puts `Forma` only on installment rows, so no control is added for it.

### Manual-edit interaction

State added: `planDirty: boolean` and `appliedPlanKey: string`.
`planAuto`, `planAutoKey` and `splitCount` are deleted.

1. Regeneration is driven by a render-phase guard that mirrors the two guards the component already uses at :3772-3781 and :3795-3807, so no new state pattern is introduced:

   ```ts
   const planShapeKey = JSON.stringify([totalCents, planShape]);
   if (!planDirty && planShapeKey !== appliedPlanKey) {
     setAppliedPlanKey(planShapeKey);
     setInstallmentRows(
       generateInstallmentPlan(totalCents, planShape, installmentRows.map((row) => row.method))
         .map((row) => ({ dueDate: row.dueDate, amountBrl: centsToInput(row.amountBrl), method: row.method })),
     );
   }
   ```

2. **A row date or amount edit sets `planDirty = true` and changes nothing else.**
   The typed value is kept, no regeneration happens, and the muted `Plano ajustado manualmente` line plus a `Regerar plano` button appear.
3. **A `Forma` edit does not set `planDirty`.**
   Forma is genuinely free per row and carries no arithmetic, so it must survive regeneration instead of blocking it.
   `generateInstallmentPlan` therefore takes the current methods positionally: row `i` keeps `methods[i] ?? methods.at(-1) ?? 'pix'`.
   This is also what keeps `sale-wizard-payment-plan.test.tsx:273-291` meaningful.
4. **Changing a header control while `planDirty` is true does not silently regenerate.**
   The control value is applied to `planShape`, which makes `planShapeKey !== appliedPlanKey` while `planDirty` blocks the guard, and that exact condition renders the amber confirm bar.
   `Aplicar` is simply `setPlanDirty(false)`, which lets the guard fire on the next render.
   `Manter parcelas` restores `planShape` from `appliedPlanKey` (the shape the rows were last generated from) and keeps the rows.
   No extra state is needed for either branch.
5. **Changing a header control, the itens total, or the base date while `planDirty` is false regenerates immediately.**
   Nothing human-authored exists in that state, so there is nothing to protect, and "more automatic" is exactly what was asked for.
6. `Regerar plano` is `setPlanDirty(false)` as well, giving the operator a one-click way back to the formula.

Justification for choosing a whole-plan dirty flag over per-row pinning: entrada and restante recomputation redistributes value across every row to hold the exact-sum invariant, so honouring a pinned row 3 while regenerating rows 1-2 would either break `Soma === total` or produce amounts that follow no stateable rule.
One explicit, reversible, visible confirm beats a silent per-row heuristic the operator cannot predict.

### Product default seeding

`defaultPlanShapeForProduct(product, baseDate): PaymentPlanShape` is added next to the generator and is the single seam slices 07 and 10 wire the persisted template into.
Today it returns the app default `{ entradaMode: 'none', entradaValue: 0, restanteCount: 1, anchorDate: baseDate }`, which reproduces the current "tudo pago em 1x" behaviour.
The wizard calls it from a `planShapeSource` render-phase guard keyed on the primary item product id, byte-for-byte the same pattern as the existing `recurringSource` guard at :3795-3807, and only while `planDirty` is false.
The proposed persisted field is `SalesOpsProduct.defaultPaymentPlan: { entradaMode, entradaValue, restanteCount } | null`, reusing the `PaymentPlanShape` vocabulary minus `anchorDate` (which is always the proposta base date, never a product property).

## Round trip

`deriveWizardPrefill` :3556-3630 keeps its current receivable handling **exactly**: it still splits on the `M` label prefix at :3564-3565 to separate `"MN/M"` recurring rows from `"N/M"` installment rows, and it still maps the installment receivables verbatim into `installmentRows` at :3616-3620.
Those two conventions and this parse stay load-bearing and untouched.

Three fields are added to `WizardPrefill`: `planShape: PaymentPlanShape` and `planDirty: boolean`, plus `recurringCycles` keeps its existing string form where `''` now means indefinite (the current `recurringIndefinite` boolean is dropped from the prefill and derived from the string).

`inferPaymentPlanShape(totalCents, rows, fallbackAnchorDate)` rebuilds the builder state by **regenerate-and-compare**, not by bespoke pattern matching.
`totalCents` is the itens total recomputed from the prefilled items, matching what the wizard itself computes at :3784-3787.

1. If `rows.length === 0`, return `{ shape: { entradaMode: 'none', entradaValue: 0, restanteCount: 1, anchorDate: fallbackAnchorDate }, matchesFormula: true }`.
2. Let `n = rows.length` and `anchorDate = rows[0].dueDate`.
   The anchor comes from the rows, not from `sale.baseDate`, so a plan whose first parcela is later than the proposal date still infers cleanly.
3. Build candidate shapes in order:
   1. `{ entradaMode: 'none', restanteCount: n, anchorDate }`.
   2. `{ entradaMode: 'pct', entradaValue: pct, restanteCount: n - 1, anchorDate }`, only when `n >= 2` and the pct is *clean*: `pct = (rows[0].amountBrl * 100) / totalCents` must have at most 2 decimals (`Math.abs(pct * 100 - Math.round(pct * 100)) < 1e-9`) and must reproduce the entrada exactly (`Math.round((totalCents * pct) / 100) === rows[0].amountBrl`).
   3. `{ entradaMode: 'fixed', entradaValue: rows[0].amountBrl, restanteCount: n - 1, anchorDate }`, only when `n >= 2`.
      A fixed entrada always reproduces itself exactly, so this is the reliable fallback and `%` is only ever preferred when it is genuinely lossless and human-readable.
4. For each candidate, call `generateInstallmentPlan(totalCents, candidate, rows.map((row) => row.method))` and compare `dueDate` and `amountBrl` field-by-field against `rows`.
   `method` is excluded from the comparison because it is free per row and carried positionally.
   The first exact match returns `{ shape: candidate, matchesFormula: true }`.
5. **Hand-edited case.** When no candidate reproduces the rows, return `{ shape: <candidate 3 when n >= 2, else candidate 1>, matchesFormula: false }`.
   The wizard then seeds `planDirty = true`, which means:
   - `installmentRows` stay exactly as stored, so opening and saving an edited proposta round-trips the plan byte-for-byte and cannot rewrite a hand-tuned schedule.
   - The header controls are seeded to a best-effort description of the rows (entrada = the actual first row amount as `R$ fixo`, restante = the remaining row count) rather than to a lie, and they remain fully editable.
   - The `Plano ajustado manualmente` line is shown, so the operator can see at a glance that the header no longer describes the table.
   - Touching any header control goes through the amber confirm bar, so the only way a hand-edited plan is ever overwritten is an explicit `Aplicar` click.
6. The `2026-01-31` clamping change interacts with this correctly: a plan the API generated with clamped dates now reproduces under candidate 1, where before the change it would have been misclassified as hand-edited.
7. Indefinite recurrence round-trips through the existing branches at :3592-3593 and :3621-3628 with one substitution: `recurringCycles` becomes `bounded ? String(recurringRows.length) : ''`, and `recurringIndefinite` is dropped from `WizardPrefill` because `''` already carries it.
   `hasRecurring && !bounded` (a `recurringBrl > 0` sale with zero `M`-labelled receivables) is exactly `cycles: null`, and it must produce a blank ciclos field and zero generated rows.

## Test fallout

### `apps/web/src/sales-ops/__tests__/sale-wizard-ui-contract.test.ts`

This file `readFileSync`s `SalesOpsApp.tsx` and asserts literal substrings, so every removed string breaks it.

- :22 `expect(source).toContain('Plano de pagamento')` - **keep**.
  The card title is deliberately unchanged: it is accurate, and it is the step-2 marker three other tests rely on (`sale-wizard-payment-plan.test.tsx:235`, `sale-wizard-edit.test.tsx:317`, `:376`, `:384`).
- :23 `expect(source).toContain('Dividir em')` - **delete**, replace with:
  ```ts
  expect(source).toContain('Parcelas a receber');
  expect(source).toContain('Tipo de entrada');
  expect(source).toContain('Parcelas restantes');
  expect(source).toContain('Plano ajustado manualmente');
  ```
- :24 `'A soma das parcelas precisa ser igual ao total da proposta.'` - **keep**, the warning survives verbatim.
- :25 `expect(source).toContain('Adicionar recorrência')` - **delete**.
- :26 `expect(source).toContain('Prazo indeterminado')` - **replace** with `expect(source).toContain('por prazo indeterminado')` (the green summary wording at :4783 survives) and `expect(source).toContain('Deixe em branco para prazo indeterminado')`.
- :27 `'Previsão de contas a pagar'` and :28 `'Passo {wizardStep} de 4'` - **keep**, step 4 and the footer are untouched.
- **Add** negative guards next to the existing `not.toContain` block at :32-37:
  ```ts
  expect(source).not.toContain('Dividir em');
  expect(source).not.toContain('+ parcela');
  expect(source).not.toContain('Adicionar recorrência');
  expect(source).not.toContain('Número de parcelas');
  expect(source).not.toContain('Remover parcela');
  ```

### `apps/web/src/sales-ops/__tests__/calculations.test.ts`

- :202-204 `'rolls month-end split dates forward like native Date arithmetic'` - **rewrite** to `'clamps month-end split dates to the last valid day like the API does'`, asserting `splitInstallmentsEqually(300, 2, '2026-01-31', 'pix')[1]!.dueDate` is `'2026-02-28'`, plus a leap-year case (`'2028-01-31'` plus one month is `'2028-02-29'`) and a no-drift case (`addMonthsToIsoDate('2026-01-31', 2)` is `'2026-03-31'`).
- :188-200 `'splits a total into equal monthly installments with the remainder on the last row'` - **unchanged**, its dates are day-10 based and unaffected by clamping.
- Everything else in the file is unaffected.

### `apps/web/src/sales-ops/__tests__/sale-wizard-payment-plan.test.tsx`

- :208-225 `'splits the plan into N equal monthly parcelas with the remainder on the last'` - **rewritten** as the Red test `generates restante rows live from Parcelas restantes with the remainder on the last row`.
  The `Número de parcelas` input at :210 and the `Dividir` click at :211 are replaced by one `changeInput(labeledInput('Parcelas restantes'), '3')`.
  The expected values at :213-215 (`833.33` / `833.33` / `833.34`) and the monthly-step assertion at :216-221 are unchanged, which is the point: the arithmetic is identical, only the driver became declarative.
- :227-244 `'blocks advancing while the parcelas do not sum to the total'` - **kept**, still exercised through a manual row edit which is now the `planDirty` path.
  One assertion is added after :238: the muted `Plano ajustado manualmente` line is present once row 1 has been typed into.
- :246-271 `'prefills and submits the recurring block for a mensalidade product'` - the `Prazo indeterminado` click at :251 is **replaced** by `changeInput(labeledInput('Número de ciclos'), '')`.
  The `recurring: { ..., cycles: null }` expectation at :257-267 and the single-installment expectation at :269-270 are unchanged.
- :273-291 `'submits the edited plan rows with per-parcela method and date'` - the `Número de parcelas` + `Dividir` pair at :275-276 becomes `changeInput(labeledInput('Parcelas restantes'), '2')`.
  The payload expectation at :283-290 is unchanged, which proves forma survives regeneration.
- :199-205 `changeSelect` and :181-185 `labeledSelect` - these stop working for `Forma de pagamento da parcela N` and for `Produto / serviço do item 1` once slice 06 has migrated those pickers to the Combobox.
  Slice 06 lands first and owns that migration; at Green time re-read this file and use whatever combobox interaction helper slice 06 left in place, adding a local `selectCombobox(label, optionText)` only if it left none.

### `apps/web/src/sales-ops/__tests__/sale-wizard-edit.test.tsx`

- :309-330 `'prefills every step from the existing proposta'` - the plan assertions at :318-322 stay true (rows `1500` / `1500`, forma `boleto` on row 2, mensalidade `1000`, ciclos `2`).
  **Add** three assertions proving the inference: `Tipo de entrada` reads `nenhuma`, `Parcelas restantes` reads `2`, and `container.textContent` does **not** contain `Plano ajustado manualmente`.
  The fixture receivables at :182-185 (`150000` on `2026-07-10` and `150000` on `2026-08-10` against an itens total of `300000`) reproduce exactly under candidate 1, so `matchesFormula` is true.
- :332-358 `'submits the reconstructed update payload with status open'` - **unchanged and load-bearing**.
  It is the guard that a clean open-edit-save round trip does not mutate `installments` or `recurring`.
- :360-370 `'hides Salvar rascunho when editing an open proposta'` - unchanged.
- :372-386 `'keeps the prefilled plan when the total changes mid-edit'` - **this test inverts and must be rewritten.**
  It changes item 1 quantity from 1 to 2 (total `300000` to `550000`) and asserts the rows stay `1500` / `1500` with the mismatch warning showing.
  Under the new rules that prefill is clean (`planDirty === false`), so a total change regenerates live and the warning never appears.
  That is the behaviour the human explicitly asked for, so the test becomes `'regenerates a formula plan when the total changes mid-edit'`: rows become `2750` / `2750`, the mismatch warning is absent, and `Avançar` reaches `Profissionais alocados`.
  Its old intent is not lost - it moves to the new `keeps a hand-edited plan when the total changes mid-edit` Red test below, where it belongs.

## Red

### 1. `apps/web/src/sales-ops/__tests__/payment-plan-generation.test.ts` (new, node environment, pure)

- `it('expresses tudo pago em 1x as a single row for the full total')` - `generateInstallmentPlan(7300000, { entradaMode: 'none', entradaValue: 0, restanteCount: 1, anchorDate: '2026-07-29' }, [])` returns exactly one row `{ dueDate: '2026-07-29', amountBrl: 7300000, method: 'pix' }`.
- `it('expresses 50% de entrada mais o resto em 3x as four rows summing to the total')` - `entradaMode: 'pct', entradaValue: 50, restanteCount: 3` over `7300000` returns 4 rows dated `2026-07-29`, `2026-08-29`, `2026-09-29`, `2026-10-29` with amounts `3650000, 1216666, 1216666, 1216668`, and the sum is exactly `7300000`.
- `it('expresses valor fixo de entrada mais o resto em 1 mes as two rows')` - `entradaMode: 'fixed', entradaValue: 1000000, restanteCount: 1` over `7300000` returns `[{ '2026-07-29', 1000000 }, { '2026-08-29', 6300000 }]`.
- `it('puts the whole rounding remainder on the last restante row')` - `entradaMode: 'none', restanteCount: 3` over `7300000` returns `2433333, 2433333, 2433334`; over `250000` returns `83333, 83333, 83334`; and for every `n` in 1..12 and `total` in `{1, 99, 7300000, 7300001}` the generated sum equals the total.
- `it('clamps month-end due dates to the last valid day without drifting')` - `anchorDate: '2026-01-31'`, `entradaMode: 'none'`, `restanteCount: 4` yields `2026-01-31, 2026-02-28, 2026-03-31, 2026-04-30`; the same with `2028-01-31` yields `2028-02-29` in slot 2.
- `it('generates no rows beyond the total when the entrada covers everything')` - `entradaMode: 'pct', entradaValue: 100, restanteCount: 3` returns exactly one row for the full total.
- `it('carries per-row payment methods positionally through regeneration')` - passing `['pix', 'boleto']` into a 4-row generation gives `pix, boleto, boleto, boleto` (last-known method fills the tail).
- `it('infers nenhuma plus N when the rows are an even split')` - `inferPaymentPlanShape(300000, [150000@2026-07-10, 150000@2026-08-10], '2026-07-10')` returns `{ entradaMode: 'none', restanteCount: 2, anchorDate: '2026-07-10' }` and `matchesFormula: true`.
- `it('infers a clean percentage entrada in preference to a fixed one')` - rows `3650000@2026-07-29` then the three restante rows above infer `{ entradaMode: 'pct', entradaValue: 50, restanteCount: 3 }` with `matchesFormula: true`.
- `it('infers a fixed entrada when the percentage is not clean')` - total `300000` with rows `100000, 100000, 100000` monthly infers `{ entradaMode: 'fixed', entradaValue: 100000, restanteCount: 2 }` (33.333% is rejected as unclean) with `matchesFormula: true`.
- `it('anchors inference on the first row rather than the proposta base date')` - rows starting `2026-09-10` with `fallbackAnchorDate: '2026-07-10'` still infer `matchesFormula: true` with `anchorDate: '2026-09-10'`.
- `it('reports matchesFormula false for a hand-edited plan and preserves nothing implicitly')` - total `300000` with rows `200000@2026-07-10, 50000@2026-08-10, 50000@2026-11-30` returns `matchesFormula: false` and a best-effort `{ entradaMode: 'fixed', entradaValue: 200000, restanteCount: 2 }`.
- `it('returns a single-parcela default for an empty row set')` - `inferPaymentPlanShape(500000, [], '2026-07-29')` returns `restanteCount: 1`, `entradaMode: 'none'`, `matchesFormula: true`.

ORACLE: `CI=true pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/__tests__/payment-plan-generation.test.ts`

### 2. `apps/web/src/sales-ops/__tests__/sale-wizard-payment-plan.test.tsx` (rewrites plus new cases)

- `it('generates restante rows live from Parcelas restantes with the remainder on the last row')` - replaces :208-225 as described in `## Test fallout`; also asserts no `Dividir`, `+ parcela` or `Adicionar recorrência` button exists in the container.
- `it('generates an entrada row from a percentage plus the remaining parcelas')` - sets `Tipo de entrada` to `%`, `Valor da entrada` to `50`, `Parcelas restantes` to `3` on the 2500,00 fixture, and asserts 4 rows (`1250`, `416.66`, `416.66`, `416.68`), the green `Soma` state, and monthly due dates from the base date.
- `it('generates an entrada row from a fixed value plus one parcela one month later')` - `R$ fixo` 500 plus `Parcelas restantes` 1 gives rows `500` and `2000`, the second exactly one month after the first.
- `it('generates a single row for tudo pago em 1x')` - default state on open is one row for the full total with `Tipo de entrada` reading `nenhuma`, and `Avançar` reaches step 3 with no interaction at all.
- `it('blocks advancing while the parcelas do not sum to the total')` - :227-244 kept, plus the `Plano ajustado manualmente` assertion.
- `it('does not silently discard a hand-edited row when a header control changes')` - edit `Valor da parcela 1`, then change `Parcelas restantes`; asserts the amber confirm copy is present, the edited row still holds the typed value, then `Manter parcelas` restores `Parcelas restantes` to its previous value and keeps the rows, and finally re-changing it and clicking `Aplicar` regenerates and clears the `Plano ajustado manualmente` line.
- `it('keeps a per-row forma through a regeneration')` - set row 2 forma to `boleto`, then change `Parcelas restantes` from 2 to 3; asserts no confirm bar appeared, the rows regenerated, and rows 2 and 3 are `boleto`.
- `it('prefills and submits the recurring block for a mensalidade product')` - :246-271 with the blank-ciclos substitution.
- `it('generates no bounded rows for an indefinite recorrencia')` - with `Recorrência` set to `mensal` and `Número de ciclos` blank, asserts the `Parcelas a receber` table row count is unchanged, the MRR note is shown, step 4 shows no `M`-derived preview rows, and the payload carries `cycles: null`.
- `it('submits the edited plan rows with per-parcela method and date')` - :273-291 with the declarative driver.

ORACLE: `CI=true pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/__tests__/sale-wizard-payment-plan.test.tsx`

### 3. `apps/web/src/sales-ops/__tests__/sale-wizard-edit.test.tsx` (rewrites plus new cases)

- `it('prefills every step from the existing proposta')` - :309-330 plus the three inference assertions.
- `it('submits the reconstructed update payload with status open')` - :332-358 unchanged, guarding the persisted shape.
- `it('regenerates a formula plan when the total changes mid-edit')` - replaces :372-386 as described.
- `it('keeps a hand-edited plan when the total changes mid-edit')` - renders with a bootstrap whose receivables are `200000@2026-07-10`, `50000@2026-08-10`, `50000@2026-11-30` (labels `1/3`, `2/3`, `3/3`, itens total `300000`), asserts step 2 shows `Plano ajustado manualmente` on open, then changes item 1 quantity and asserts the three rows are byte-identical to the stored ones and the mismatch warning is what blocks `Avançar`.
- `it('round-trips a hand-edited plan through save without rewriting it')` - same bootstrap, but fixes the total by editing rows to sum correctly is **not** done; instead the itens are left untouched so `planValid` holds, then `Avançar` x3 and `Salvar proposta` assert `installments` equals the three stored rows exactly, including the `2026-11-30` date no formula would produce.
- `it('prefills a blank ciclos field for an indefinite recorrencia')` - bootstrap with `recurringBrl: 100000` and zero `M`-labelled receivables asserts `Recorrência` reads `mensal`, `Número de ciclos` is `''`, the MRR note is shown, and the submitted payload carries `cycles: null`.

ORACLE: `CI=true pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/__tests__/sale-wizard-edit.test.tsx`

### 4. Contract and pure-math guards

ORACLE: `CI=true pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/__tests__/sale-wizard-ui-contract.test.ts`
ORACLE: `CI=true pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/__tests__/calculations.test.ts`

Note on the oracle form: `pnpm --filter @fxl-sales/web test -- --run <path>` does **not** filter.
pnpm swallows the positional argument and all 21 web test files run (122 tests instead of the handful under test).
Always use the `exec vitest run <path>` form above, with the path relative to `apps/web`.

### Gate 2 full sweep

```bash
pnpm run lint
pnpm run type-check
pnpm test
pnpm run build
```

## Green

1. In `apps/web/src/sales-ops/calculations.ts`, rewrite `addMonthsToIsoDate` :127-131 to clamp to the last valid day of the target month, using the same `Math.min(day, lastDay)` construction as `apps/api/src/domains/sales-ops/service.ts:256-265`.
2. In the same file, add and export `PaymentPlanShape`, `entradaCentsFor`, `generateInstallmentPlan`, `inferPaymentPlanShape`, and `defaultPlanShapeForProduct`, with `generateInstallmentPlan` delegating the restante split to the existing `splitInstallmentsEqually` and `inferPaymentPlanShape` implemented as regenerate-and-compare over the three ordered candidates.
3. Update `apps/web/src/sales-ops/__tests__/calculations.test.ts:202-204` to the clamping expectations, and add the leap-year and no-drift cases.
4. In `SalesOpsApp.tsx`, extend `WizardPrefill` :3532-3554 with `planShape: PaymentPlanShape` and `planDirty: boolean`, and drop `recurringIndefinite` from the type.
5. In `deriveWizardPrefill` :3556-3630, keep the `M`-prefix split at :3564-3565 and the verbatim row mapping at :3616-3620 untouched; compute the itens total from the mapped `items`, call `inferPaymentPlanShape` with `sale.baseDate.slice(0, 10)` as the fallback anchor, and return `planShape` plus `planDirty: !matchesFormula`.
   Change `recurringCycles` at :3626 to `bounded ? String(recurringRows.length) : ''`.
6. Replace the plan state at :3736-3744: keep `installmentRows` and `showPlanErrors`, delete `planAuto`, `planAutoKey` and `splitCount`, and add `planShape`, `planDirty`, `appliedPlanKey`, and `planAnchorSourceBaseDate`.
7. Replace `recurringEnabled` :3745 with a `recurringMode: 'none' | 'monthly'` state, delete `recurringIndefinite` :3751, and derive `recurringIndefinite` as `recurringCycles.trim() === ''` next to `recurringCyclesCount` :3820.
   Update `recurringValid` :3821-3825 to accept a blank ciclos and reject a non-blank non-numeric one.
8. Delete the `planAuto` render-phase block :3789-3793 and put three render-phase guards in its place, in this order: re-anchor `planShape.anchorDate` to `baseDate` when `baseDate !== planAnchorSourceBaseDate`; seed `planShape` from `defaultPlanShapeForProduct` when the primary product changes and `planDirty` is false; regenerate `installmentRows` when `!planDirty && planShapeKey !== appliedPlanKey`.
   Extend the existing `recurringSource` guard :3795-3807 to set `recurringMode` instead of `recurringEnabled` and to set `recurringCycles` to `'12'`.
9. Delete `applySplit` :3985-3995 and `addInstallmentRow` :3997-4006.
   Add `markPlanDirty()` (sets `planDirty` true), `applyPendingShape()` (sets `planDirty` false), and `keepEditedRows()` (restores `planShape` from `appliedPlanKey`).
10. Rewrite the step-2 JSX :4567-4803 as one card: the three-control declarative header with its derived hints, the `Plano ajustado manualmente` line and `Regerar plano` button, the amber confirm bar, the `Parcelas a receber` table on the 4-column grid, and the kept `Soma das parcelas` block and mismatch warning.
    Delete the `Dividir em` label, the `Número de parcelas` input, the `Dividir` button, the `+ parcela` button, the `Remover parcela N` buttons, the `Prazo indeterminado` checkbox, and the `Adicionar recorrência` placeholder.
11. Wire the row handlers: the date and amount `onChange` call `markPlanDirty()` in place of `setPlanAuto(false)`, and the forma `onChange` updates only the row method with no dirty marking.
12. Swap the `Forma` picker and the two mode pickers to the slice 06 Combobox, preserving the existing `aria-label` strings so the DOM queries in the tests stay stable.
13. Update `previewReceivables` :3868-3879 and `createPayload` :4080-4087 to read `recurringMode` and the derived `recurringIndefinite`, leaving the emitted `recurring` object shape identical.
14. Rewrite the test files per `## Test fallout` and `## Red`, then run every ORACLE command and the Gate 2 sweep.

## Refactor

- Once the generator is pure, `installmentSumCents` :148-150 and the `planSumCents` / `planDeltaCents` derivation at :3811-3812 become the only remaining arithmetic inline in the component; leave them where they are, they are one-liners over the row array.
- `centsToInput` :264 and `parseCurrencyToCents` :260 stay thin wrappers in `SalesOpsApp.tsx`; do not move them, five other call sites depend on them.
- Consider (do not do here) exporting `PaymentPlanShape` from `packages/shared-types` once slice 07 needs it on the API side; until then a web-local type is the smaller commitment.

## Out of scope

- Any change to the persisted payment-plan shape, to `buildSalePayload` :152-195, or to the API `buildSaleLedger` :346-373.
- Any change to the `"N/M"` / `"MN/M"` receivable label conventions or to payables materialization.
- Replacing the native `<input type="date">` fields, per the overview's Deliberately excluded section.
- Adding a `Data-base` control to step 2, a `Forma` control for the recurring block, or recurring rows inside the editable table.
- Steps 1, 3 and 4 of the wizard, the footer, and the stepper.
- Persisting a product-level default payment plan; this slice only adds the `defaultPlanShapeForProduct` seam.

## Risks

- **Slices 07 and 10 do not exist yet.**
  Only `00-OVERVIEW.md` is present in `nexo/plans/batch-01K9C0FXA7RQ8VZTN3KDM6WS4E/`, so the product/service default-payment-plan shape and vocabulary could not be aligned against a written plan.
  Assumption recorded: the persisted field will be `SalesOpsProduct.defaultPaymentPlan: { entradaMode, entradaValue, restanteCount } | null` reusing the `PaymentPlanShape` names from this slice, and `defaultPlanShapeForProduct` is the single function slices 07 and 10 change.
  This slice ships that function returning the app default, so it is correct and inert either way, and no field is invented on `SalesOpsProduct`.
- **Slice 06 changes the picker DOM under the tests.**
  `labeledSelect` / `changeSelect` in both wizard test files stop matching once `Forma de pagamento da parcela N` is a Combobox.
  Mitigation: `depends_on: [06-combobox-adoption]` guarantees 06 lands first, and step 12 of `## Green` explicitly says to re-read the test helpers and reuse whatever interaction helper 06 left, rather than assuming `<select>`.
  The Combobox being inline and non-portalled means the existing `container.querySelector` style of query keeps working and no new `vi.mock` is needed; only the interaction verb changes.
- **The wizard body remount key destroys transient state.**
  `SaleWizardDialog` :3644 keys `SaleWizardDialogBody` on `bootstrap.clients[0]?.id`, `bootstrap.products[0]?.id` and `bootstrap.people.length`, all of which move when a name-ordered list is refetched, so a background bootstrap refresh remounts the wizard and wipes it.
  This builder holds strictly more transient state than the manual one did (`planShape`, `planDirty`, `appliedPlanKey`, `planAnchorSourceBaseDate`, plus the human's hand-edited rows), so a remount is now more destructive, not less.
  Mitigation: slice 01 lands in wave 1 and fixes the key.
  This slice must not reintroduce any dependency on it: none of the new state is derived from bootstrap list ordering, all of it is seeded once from `deriveWizardPrefill` or from `defaultPlanShapeForProduct` keyed on a product **id** rather than a list position, and no new `key` expression is added.
- **Changing `addMonthsToIsoDate` is a cross-cutting behaviour change.**
  It also affects the `recurringStartDate` fallback at :3625 and the recurring preview at :3875.
  In every one of those places clamping is the correct behaviour because it is what the API already does, so the change removes a divergence rather than adding one.
  Mitigation: exactly one existing assertion pins the old rollover (`calculations.test.ts:202-204`) and it is rewritten deliberately, not deleted.
- **Regenerating on a total change is a visible behaviour reversal for the edit path.**
  `sale-wizard-edit.test.tsx:372-386` currently pins the opposite.
  Mitigation: the reversal is exactly the "more automatic" behaviour the human asked for, it only ever applies to plans that provably match a formula, and the old intent is preserved verbatim by the new `keeps a hand-edited plan when the total changes mid-edit` test.
- **Render-phase `setState` guards.**
  Three guards in one render pass could loop if a key is not stable.
  Mitigation: each guard writes its own source key first and the keys are `JSON.stringify` of primitives only, which is the pattern already proven twice in this component at :3772-3781 and :3795-3807.
  The generator is deterministic, so the second render always finds `planShapeKey === appliedPlanKey`.
- **The hand-edited inference could misclassify a formulaic plan as custom.**
  Any false negative is safe by construction: the stored rows are kept verbatim and the operator only sees an extra `Plano ajustado manualmente` line.
  A false positive is the dangerous direction and cannot happen, because `matchesFormula` is only true after a full regenerate-and-compare on both dates and amounts.
- **Atomicity.**
  The slice lands as one commit.
  The web generator, the wizard rewrite and the seven test files are one behavioural unit: shipping the `addMonthsToIsoDate` clamp without the generator would leave `calculations.test.ts` red, and shipping the UI without the test rewrites would leave `sale-wizard-ui-contract.test.ts` red.
  No split is needed or possible.
