---
id: 06-wizard-custo-mode
milestone: v2.3.0
status: todo
depends_on: ["05-wizard-funcao-create"]
files_modified:
  - apps/web/src/sales-ops/calculations.ts
  - apps/web/src/sales-ops/SalesOpsApp.tsx
  - apps/web/src/sales-ops/__tests__/calculations.test.ts
  - apps/web/src/sales-ops/__tests__/sale-wizard-funcao-costs.test.tsx
  - apps/web/src/sales-ops/__tests__/sale-wizard-ui-contract.test.ts
  - CLAUDE.md
acceptance: "given a step-3 profissional row whose função is declared by a produto on a R$ 20.000,00 item, when the operator toggles CUSTO ALOCADO to % and types 10, then the row resolves to R$ 2.000,00, the line under it reads `10% de R$ 20.000,00 (FXL Custom)`, the save payload carries `costBrl: 200000`, and no new column or migration exists"
---

# Slice 06 - `CUSTO ALOCADO` accepts `%` or `R$`

## The gap

The produto cadastro's `CUSTOS PADRÃO POR FUNÇÃO` row has a `% | R$` segmented toggle
(`apps/web/src/sales-ops/SalesOpsApp.tsx:3923-3949`).
The proposta wizard's step-3 `Profissionais alocados` row has a plain number input only
(`apps/web/src/sales-ops/SalesOpsApp.tsx:6751-6769`), so the same money can be expressed two ways
in the cadastro and only one way in the proposta that consumes it.

## What is persisted today - evidence

A professional cost is stored as **one integer-cents column and nothing else**.

- `apps/api/src/db/schema.ts:791-826`, `salesOpsSaleProfessionals`: the only money column is
  `costBrl: integer('cost_brl').notNull()`.
  There is no `cost_mode`, no `cost_pct`, and no `cost_base` column.
  The other columns are `personId`, `personNameSnapshot`, `funcaoId`, `funcaoNameSnapshot` and the
  deprecated `role` mirror.
- `apps/api/src/domains/sales-ops/service.ts:358-374`, `SaleProfessionalSchema`: the wire shape is
  `{personId?, personName, funcaoId?, role?, costBrl}` where `costBrl` is the `money` schema
  (integer cents).
  No mode is accepted, so a mode sent today would be stripped by Zod.
- `apps/api/src/domains/sales-ops/service.ts:788`: `professionalCostsBrl` is a plain
  `reduce` over `input.professionals[].costBrl`.
  The margin never sees a percentage.
- `apps/web/src/sales-ops/SalesOpsApp.tsx:5810-5819`: the wizard already flattens the row to
  `costBrl: parseCurrencyToCents(professional.costBrl)` on save.
- Contrast with the produto side: `sales_ops_product_funcao_costs` really does carry
  `{mode, valuePct, valueBrl}`, which is why `resolveFuncaoCostCents`
  (`apps/web/src/sales-ops/calculations.ts:102-108`) exists at all.

So the produto row stores a **rule**; the proposta row stores a **result**.

## Persistence decision: option (a), input mode only. No migration.

**Recommendation: (a). The `%` is an INPUT MODE that resolves to cents on every render.
Nothing new is persisted, no column is added, no migration is written.**

Justification, in order of weight:

1. A `professional_cost` payable is one-shot at win with `receivableId: null` (CLAUDE.md,
   Propostas domain).
   It is generated once, against a basis that is frozen at that moment.
   There is no later event that would re-evaluate a stored percentage, so a stored
   `mode`/`pct` pair would be write-only data that nothing reads back except an edit form.
2. The one consumer that would want the rule back is the edit wizard, and it already declares that
   a stored cost is a decision, not a derivation: `deriveWizardPrefill` seeds
   `costManual: true` unconditionally (`SalesOpsApp.tsx:4905-4907`) precisely so nothing recomputes
   a persisted cost behind the operator.
   Persisting the percentage would create a second, contradictory answer to "may this number move".
3. The produto side is the correct home for a durable rule and already is one.
   `sales_ops_product_funcao_costs` stores `{funcaoId, mode, valuePct|valueBrl}` and reaches the
   wizard as a default through `buildFuncaoCostBasis`.
   A proposta that wants a reusable percentage rule edits the produto.
4. Scope: option (b) is a migration plus a Zod contract change plus an RLS test plus a backfill
   decision for every existing row, for zero behavioural gain over (a).

Concrete reason (a) could have been wrong, checked and rejected: if a `won` proposta ever
re-derived professional costs from a live basis, the stored cents would be insufficient.
It does not.
`service.ts:1971-1973` and `2113-2115` write the payable rows from `ledger.professionals`, which is
built from the submitted `costBrl` at write time; nothing re-reads a rule.

Consequence to state in the plan and in CLAUDE.md: **a `%` typed in the wizard is not durable.**
Reopening a saved proposta shows `R$` with the resolved cents, exactly as today.
That is correct, not a defect: the saved number is the decision.

## The base a `%` resolves against

**Constraint, restated so the executor cannot drift:** a `%` in the wizard resolves against the SAME
basis `buildFuncaoCostBasis` computes, **never** the proposta total and **never** anything that
includes the recurring mensalidade.
The recorrência is excluded on purpose: a `professional_cost` is one-shot at win, so pricing it off a
monthly stream would charge a pay-once cost against every cycle
(`calculations.ts:127-137`, pinned by
`sale-margin-parity.test.ts:69-87` and `sale-wizard-funcao-costs.test.tsx:506`).

`FuncaoCostBasisEntry.contributions[]` already carries `subtotalBrl` per contributing item, and a
função gets at most one contribution per item (one cost row per `(productId, funcaoId)`), so summing
`contributions[].subtotalBrl` is exactly "the item subtotals of the items whose produto declares this
função", with no double counting and no recorrência.
That sum is the primary base.

**Documented fallback, and the only deviation in this slice.**
When the row's função has no basis entry at all (no produto on this proposta declares it), the base
falls back to the sum of the subtotals of ALL **product** items on the proposta.
Free-form items still contribute nothing and the recorrência is still excluded, so the load-bearing
rule is untouched in both branches.

Why the fallback exists: slice 05 lets the operator create a função inline from this very picker, and
a brand-new função is declared by no produto.
Without the fallback the `%` toggle would resolve to zero for exactly the case the operator is most
likely to hit, which is a worse failure than the strict rule prevents.
Both branches live in ONE exported pure function, both are pinned by tests, and the derivation line
names which branch it took, so the number on screen and the sentence explaining it can never disagree.

If the human vetoes the fallback, deleting it is a three-line change inside
`professionalCostBaseCents` and one test case; nothing else in this plan moves.

Base is zero only when the proposta has no product items at all.
That case is handled by an explicit amber line, never a silent `0` (see UI below).

## Edits

### 1. `apps/web/src/sales-ops/calculations.ts`

Insert directly after `describeFuncaoCostBasis` (currently ends line 179), so the wizard-side
resolution sits next to the cadastro-side one it delegates to.

```ts
export type ProfessionalCostUnit = 'pct' | 'fix';

/**
 * The cents a wizard `%` professional cost is measured against.
 *
 * INPUT MODE ONLY: nothing here is persisted. `sales_ops_sale_professionals` stores a
 * single integer-cents `cost_brl`, so a `%` is resolved before it ever reaches the wire.
 *
 * Primary base: the item subtotals of the proposta items whose produto declares this
 * função, which is exactly what `buildFuncaoCostBasis` already summed. NOT the proposta
 * total, and never the recurring mensalidade - a `professional_cost` payable is one-shot
 * at win, so pricing it off a monthly stream would charge a pay-once cost against every
 * cycle.
 *
 * Fallback, when no produto on this proposta declares the função (the inline-created
 * função case): the sum of every PRODUCT item subtotal. Free-form items contribute
 * nothing and the recorrência is still excluded, so both branches obey the same rule.
 */
export function professionalCostBaseCents(
  entry: FuncaoCostBasisEntry | undefined,
  productItemsSubtotalCents: number,
): number {
  const scoped = (entry?.contributions ?? []).reduce(
    (sum, contribution) => sum + contribution.subtotalBrl,
    0,
  );
  if (scoped > 0) return scoped;
  return Math.max(0, Math.floor(productItemsSubtotalCents));
}

/** `10% de R$ 20.000,00 (FXL Custom)`, or `... (total dos itens de produto)` on the fallback base. */
export function describeProfessionalCostBase(
  pct: string | number,
  entry: FuncaoCostBasisEntry | undefined,
  productItemsSubtotalCents: number,
): string {
  const base = professionalCostBaseCents(entry, productItemsSubtotalCents);
  if (base <= 0) return '';
  const scoped = (entry?.contributions ?? []).reduce(
    (sum, contribution) => sum + contribution.subtotalBrl,
    0,
  );
  const source =
    scoped > 0
      ? [...new Set((entry?.contributions ?? []).map((c) => c.productName))].join(' + ')
      : 'total dos itens de produto';
  return `${toNumber(pct, 0)}% de ${formatMoneyBrl(base)} (${source})`;
}

/**
 * The ONE place a wizard professional row turns into cents. `fix` reads the reais input,
 * `pct` delegates to `resolveFuncaoCostCents` so there is a single percentage-of-basis
 * implementation in the app.
 */
export function resolveProfessionalCostCents(
  row: { costUnit: ProfessionalCostUnit; costPct: string; costBrl: string },
  baseCents: number,
): number {
  if (row.costUnit === 'fix') return parseCurrencyInputToCents(row.costBrl);
  return resolveFuncaoCostCents({ mode: 'pct', valuePct: row.costPct, valueBrl: null }, baseCents);
}
```

`toNumber`, `formatMoneyBrl`, `resolveFuncaoCostCents` and `parseCurrencyInputToCents` all already
live in this module; function declarations hoist, so placement above `parseCurrencyInputToCents`
(line 186) is fine.

### 2. `apps/web/src/sales-ops/SalesOpsApp.tsx` - imports

Add `describeProfessionalCostBase`, `professionalCostBaseCents`, `resolveProfessionalCostCents` and
`type ProfessionalCostUnit` to the existing `./calculations` import block (line 111-130), keeping it
alphabetical.

### 3. `ProfessionalForm` (line 4661-4676)

```ts
type ProfessionalForm = {
  personId: string;
  personName: string;
  funcaoId: string;
  funcaoName: string;
  /**
   * INPUT MODE only, never persisted: `sales_ops_sale_professionals.cost_brl` is a single
   * integer-cents column, so a `%` row resolves to cents before it reaches the payload and
   * an edited proposta always reopens in `fix`.
   */
  costUnit: ProfessionalCostUnit;
  /** Percent points as typed. Read only while `costUnit === 'pct'`. */
  costPct: string;
  /** Reais as typed. Read only while `costUnit === 'fix'`. */
  costBrl: string;
  costManual: boolean;
};
```

Keep the existing `costManual` doc comment verbatim, appending one sentence:
`A '%' row is costManual by construction, because choosing a percentage is itself a decision.`

### 4. Both row constructors

- `+ profissional` seed (line 6620-6630): add `costUnit: 'fix'`, `costPct: '0'`.
  `fix` is the default everywhere, so today's behaviour is unchanged for a fresh row.
- `deriveWizardPrefill` (line 4897-4908): add `costUnit: 'fix' as const`, `costPct: '0'`.
  A stored cost is cents, so it reopens in `R$`; `costManual: true` stays unconditional.

### 5. The product-items subtotal, beside the basis (after line 5348)

```ts
/*
  The fallback base for a wizard `%` whose função no produto declares. PRODUCT items
  only and item subtotals only, so the recorrência exclusion that governs
  `buildFuncaoCostBasis` governs this too.
*/
const productItemsSubtotalCents = items
  .filter((item) => item.kind === 'product' && item.productId)
  .reduce(
    (sum, item) =>
      sum + Math.max(1, Number(item.quantity) || 1) * parseCurrencyToCents(item.unitBrl),
    0,
  );
```

### 6. Two row helpers in the wizard body

Declare next to `selectedProduct` (line 5556); declarations hoist, so the earlier call sites are fine.

```ts
function professionalRowBaseCents(row: ProfessionalForm): number {
  return professionalCostBaseCents(
    row.funcaoId ? funcaoCostBasis.get(row.funcaoId) : undefined,
    productItemsSubtotalCents,
  );
}

/*
  The single seam every consumer of a professional cost goes through. A `%` row is
  DERIVED on every render rather than mirrored into `costBrl`, which is what keeps the
  number and the derivation line under it from ever disagreeing, and what avoids a second
  render-phase setState loop next to the four that already exist.
*/
function professionalRowCents(row: ProfessionalForm): number {
  return resolveProfessionalCostCents(row, professionalRowBaseCents(row));
}
```

### 7. Every consumer of the cost routes through `professionalRowCents`

- line 5438-5441 `professionalCents`: `(sum, professional) => sum + professionalRowCents(professional)`.
- line 5540 payables preview: `value: professionalRowCents(professional)`.
- line 5818 payload: `costBrl: professionalRowCents(professional)`.

After this, `parseCurrencyToCents(professional.costBrl)` must appear nowhere outside
`resolveProfessionalCostCents`.

### 8. The `% | R$` control, replacing the bare `Input` at 6751-6769

Grid track widens in BOTH the header (line 6638) and the row (line 6661):
`grid-cols-[minmax(0,1fr)_minmax(0,1fr)_150px_36px]` becomes
`grid-cols-[minmax(0,1fr)_minmax(0,1fr)_212px_36px]`
(96px toggle group + 8px gap + a ~108px input).
The header's `Custo alocado` span drops `text-right`, because the control group now starts at the
left edge of that cell.

```jsx
<div className="flex flex-col items-end gap-1">
  <div className="flex w-full gap-2">
    <div className="flex flex-none gap-[3px] rounded-[9px] bg-[#f2f2f4] p-[3px]">
      <UnitToggle
        active={professional.costUnit === 'pct'}
        /* Indexed, not name-interpolated: stable from the moment the row is added. */
        ariaLabel={`Custo do profissional ${index + 1} em porcentagem`}
        onClick={() => setProfessionalCostUnit(index, 'pct')}
        value="%"
      />
      <UnitToggle
        active={professional.costUnit === 'fix'}
        ariaLabel={`Custo do profissional ${index + 1} em reais`}
        onClick={() => setProfessionalCostUnit(index, 'fix')}
        value="R$"
      />
    </div>
    <UnitInput
      /* Unchanged label: the existing DOM tests address the row by it. */
      ariaLabel={`Custo alocado do profissional ${index + 1}`}
      onChange={(value) =>
        setProfessionals((current) =>
          current.map((item, itemIndex) =>
            itemIndex === index
              ? item.costUnit === 'pct'
                ? { ...item, costPct: value, costManual: true }
                : { ...item, costBrl: value, costManual: true }
              : item,
          ),
        )
      }
      unit={professional.costUnit === 'fix' ? 'R$' : '%'}
      value={professional.costUnit === 'fix' ? professional.costBrl : professional.costPct}
    />
  </div>
  {/* footer, section 10 */}
</div>
```

`UnitToggle` and `UnitInput` are reused verbatim from lines 3128-3181.
Do not build a second toggle and do not add props to either component.

### 9. `setProfessionalCostUnit`, and its exact `costManual` contract

Declare beside the two row helpers.

```ts
/*
  Toggling the unit is an explicit decision about this row's number, so it PINS the row in
  both directions and never un-pins it. That is what stops the render-phase produto-default
  guard from resurrecting a stale default over a number the operator just derived: a row
  that has been toggled even once can no longer be re-derived from the cadastro.
*/
function setProfessionalCostUnit(index: number, unit: ProfessionalCostUnit) {
  setProfessionals((current) =>
    current.map((item, itemIndex) => {
      if (itemIndex !== index || item.costUnit === unit) return item;
      if (unit === 'pct') {
        /*
          Seed the percentage that reproduces the cents currently on the row, to two
          decimals, so the toggle does not blank a number the operator can see. The
          rounding can move the resolved cents by up to half a basis point of the base;
          the derivation line states the percentage and the base, so what is on screen is
          always what is computed.
        */
        const base = professionalRowBaseCents(item);
        const cents = parseCurrencyToCents(item.costBrl);
        const seeded = base > 0 ? String(Math.round((cents / base) * 10000) / 100) : '0';
        return { ...item, costUnit: 'pct', costPct: seeded, costManual: true };
      }
      // Back to R$: freeze the exact cents the percentage resolved to, losslessly.
      return {
        ...item,
        costUnit: 'fix',
        costBrl: centsToInput(professionalRowCents(item)),
        costManual: true,
      };
    }),
  );
}
```

`costManual` semantics, stated exhaustively so nothing drifts:

| event | `costManual` after | why |
| --- | --- | --- |
| `+ profissional` | `false` (unchanged) | a fresh row still inherits the produto default |
| prefill from a stored proposta | `true` (unchanged) | a persisted cost is a saved decision |
| first keystroke in either input | `true` (unchanged) | the existing first-keystroke rule, now on both fields |
| toggle `R$` -> `%` | `true` | choosing a percentage is a decision |
| toggle `%` -> `R$` | `true`, never cleared | clearing it would let the guard clobber the derived number |
| `Restaurar padrão` | `false`, AND `costUnit: 'fix'`, `costPct: '0'` | restoring means going back to the produto default cents |
| pessoa change | untouched (unchanged) | a pessoa is not a cost driver |
| função change on a non-manual row | untouched (unchanged) | the row re-derives from the new função's default |

### 10. The render-phase guard and the função-change handler

Guard at 5352-5361, skip condition becomes:

```ts
row.costManual || row.costUnit === 'pct' || !row.funcaoId
```

with a comment: the `costUnit === 'pct'` clause is redundant by the invariant above (a `%` row is
always `costManual`), and is written out so the invariant is visible at the guard that depends on it.
The guard's body still writes only `costBrl`, which is the `fix`-mode field.

The função-change handler (6714-6737) needs no change: it already re-derives only when
`!item.costManual`, and a `%` row never is.
A `%` row whose função changes therefore keeps its percentage and re-bases automatically, because the
cents are derived rather than stored.

### 11. The footer under the input

Replace the current `costManual ? chip : derivation ? span : null` chain with a three-branch chain.
The `%` branch must come first, otherwise the always-true `costManual` on a `%` row would hide its
own derivation behind the `Alterado manualmente` chip.

```jsx
{professional.costUnit === 'pct' ? (
  <div className="flex flex-col items-end gap-1">
    {professionalRowBaseCents(professional) > 0 ? (
      <span className="text-right text-[11.5px] leading-tight text-[#9b9ba3]">
        {describeProfessionalCostBase(
          professional.costPct,
          basis,
          productItemsSubtotalCents,
        )}{' '}
        = {formatMoneyBrl(professionalRowCents(professional))}
      </span>
    ) : (
      /*
        The empty-basis case, never a silent zero: with no product item on the proposta a
        percentage has nothing to be a percentage OF.
      */
      <span className="text-right text-[11.5px] font-semibold leading-tight text-[#9c7210]">
        Nenhum item de produto na proposta - o percentual resolve para R$ 0,00.
      </span>
    )}
    {basis ? (
      <button className="text-[11px] font-semibold text-[#9c7210] underline" onClick={/* restore, section 12 */} type="button">
        Restaurar padrão
      </button>
    ) : null}
  </div>
) : professional.costManual ? (
  /* the existing chip + Restaurar padrão block, unchanged */
) : derivation ? (
  /* the existing derivation span, unchanged */
) : null}
```

The `Alterado manualmente` chip deliberately does not render in `%` mode: the derivation line already
states that the number is the operator's own rule, and a chip beside it would be noise.
The chip string stays in the file (the `fix` branch), so the existing
`sale-wizard-ui-contract.test.ts` assertion on it still passes.

### 12. `Restaurar padrão` resets the unit

Both call sites (the `fix` branch at 6776-6794 and the new `%` branch) use one handler:

```ts
{ ...item, costManual: false, costUnit: 'fix', costPct: '0', costBrl: centsToInput(basis.cents) }
```

Restoring the produto default means restoring its cents, so the row must land back in `R$`.

### 13. CLAUDE.md, Propostas domain

Append one paragraph after the existing `buildFuncaoCostBasis` paragraph, stating: the wizard's
`CUSTO ALOCADO` accepts `%` or `R$` through the same `UnitToggle`/`UnitInput` the produto dialog uses;
the unit is an INPUT MODE and is not persisted, because `sales_ops_sale_professionals.cost_brl` is a
single integer-cents column and a `professional_cost` payable is one-shot at win; a `%` resolves
through `resolveProfessionalCostCents` against `professionalCostBaseCents`, which is the função-scoped
item subtotal, falling back to the total of all product-item subtotals when no produto declares the
função, and never includes the recorrência; toggling the unit pins the row (`costManual: true`) in
both directions and only `Restaurar padrão` un-pins it, which also resets the unit to `fix`.

## Oracle tests

**Named oracle (pure function), `apps/web/src/sales-ops/__tests__/calculations.test.ts`,
new describe block `professional cost unit resolution`:**

> `it('resolves a wizard percent against the funcao-scoped item subtotal, floors it, and reads costBrl verbatim in fix mode')`

Chosen over `sale-margin-parity.test.ts` deliberately: that file declares itself a GOLDEN FIXTURE
that must stay aligned with its API twin, and these functions have no API counterpart.
`calculations.test.ts` is the general home for `../calculations` exports.

Cases to pin in that block:

1. `resolveProfessionalCostCents({costUnit:'pct', costPct:'10', costBrl:'0'}, 2000000) === 200000`.
2. Floors, never rounds: `costPct:'5'` against base `1999` is `99`.
3. `fix` ignores the base entirely: `{costUnit:'fix', costBrl:'300', costPct:'99'}` is `30000` for
   any base.
4. Negative and garbage percent clamp to `0`.
5. `professionalCostBaseCents` returns the SUM of `contributions[].subtotalBrl` for an entry built by
   `buildFuncaoCostBasis` over two declaring items, and does so for a `fix`-mode produto default too
   (the base is the subtotal, not the default's own cents).
6. `professionalCostBaseCents(undefined, 3000000) === 3000000` - the fallback branch.
7. `professionalCostBaseCents(undefined, 0) === 0` - the empty case the UI warns about.
8. Recorrência control, mirroring `sale-margin-parity.test.ts:69`: a basis built from a
   R$ 20.000,00 item gives base `2000000` no matter what recurring value the caller holds, because
   neither function takes one.
9. `describeProfessionalCostBase('10', entry, fallback)` is `10% de R$ 20.000,00 (FXL Custom)`;
   with two declaring items it joins names with ` + ` and dedupes a repeated produto;
   with `entry === undefined` it is `10% de R$ 30.000,00 (total dos itens de produto)`;
   with base `0` it is `''`.

**DOM oracle, `apps/web/src/sales-ops/__tests__/sale-wizard-funcao-costs.test.tsx`**, appended to the
existing `sale wizard profissionais alocados` describe (its fixtures already cover a 5% dev default on
a R$ 20.000,00 FXL Custom item, a fixed R$ 300,00 default, an archived função and a recorrência):

1. `toggles CUSTO ALOCADO to % and resolves against the funcao-scoped item subtotal` - click
   `Custo do profissional 1 em porcentagem`, type `10`, assert the input reads `10`, the footer
   contains `10% de R$ 20.000,00 (FXL Custom)`, and the payload after `Salvar proposta` carries
   `professionals[0].costBrl === 200000`.
2. `warns instead of silently writing zero when no product item backs the percentage` - a proposta
   whose only item is free-form, toggle to `%`, type `10`, assert the footer contains
   `Nenhum item de produto na proposta` and the payload carries `costBrl: 0`.
3. `toggling back to R$ freezes the resolved cents` - `%` `10` then `R$`, assert the input reads
   `2000` and the payload is `200000`.
4. `a produto default cannot clobber a percent row` - toggle to `%`, type `10`, go back to step 1,
   change the item unit price to R$ 40.000,00, return to step 3, assert the input still reads `10`
   and the resolved cents moved to `400000`.
   This is the guard test: the percentage is preserved and the cents follow the base.
5. `Restaurar padrão on a percent row returns to R$ and to the produto default` - assert the unit is
   `R$`, the input is the default cents, and `Alterado manualmente` is gone.

Update the local helper, no production markup hook needed:

```ts
function rowFooterText(index = 1): string {
  const cost = labeledInput(`Custo alocado do profissional ${index}`);
  return cost.closest('.items-end')?.textContent?.trim() ?? '';
}
```

The input is now nested inside `UnitInput`'s `relative flex-1` wrapper, so `parentElement` no longer
reaches the cell.
Every existing assertion on this helper is `toContain`, so the extra `%`/`R$` glyphs the cell now
contains break nothing.

**Source-contract oracle, `apps/web/src/sales-ops/__tests__/sale-wizard-ui-contract.test.ts`**, added
to the first `it`:

```ts
expect(source).toContain('Custo do profissional ${index + 1} em porcentagem');
expect(source).toContain('Custo do profissional ${index + 1} em reais');
expect(source).toContain('Nenhum item de produto na proposta');
```

These are distinct from the produto dialog's existing `Custo da função ${index + 1} em porcentagem`,
so they can only pass if the wizard toggle is really there.

## Verify

```bash
pnpm run lint
pnpm run type-check
pnpm test
```

`pnpm --filter @fxl-sales/api test:integration` is not required: no API file, schema or migration
changes in this slice.

## Risk notes

- **Merge order.** Slice 05 edits the `FUNÇÃO NO PROJETO` Combobox at
  `SalesOpsApp.tsx:6704-6749`, immediately above this slice's cost cell, and both change the same
  row's JSX block.
  Run 06 after 05 is merged to `master`, as the serial queue already prescribes.
- **The fallback base is the one judgement call.** It is delimited to a single `if` inside
  `professionalCostBaseCents` and one test case, and it is flagged here rather than buried so a
  reviewer can veto it cheaply.
  Strict mode (return `0` when no produto declares the função) is a three-line deletion.
- **The `%` is not durable.** Reopening a saved proposta shows `R$`.
  Confirm the operator understands this before the slice ships; if a durable per-proposta percentage
  rule is genuinely wanted, that is option (b), a separate slice with a migration, and it should be a
  Nexo doubt rather than a silent expansion of this one.
- **Seeding drift on `R$` -> `%`.** The seeded percentage is rounded to two decimals, so the resolved
  cents can move by up to half a basis point of the base (one cent on a R$ 2.000,00 base).
  The derivation line always states the percentage, the base and the resulting money, so nothing on
  screen is ever unexplained.
- **Grid width.** The cost column grows 150px -> 212px inside a dialog whose other two columns are
  `minmax(0,1fr)`; check the row at a narrow viewport once, since slice 02 is also moving the wizard
  shell.
- **No new render-phase setState.** The `%` cost is derived, not mirrored into `costBrl`, which is
  what keeps this slice from adding a fifth source-key sync next to the four documented ones.
