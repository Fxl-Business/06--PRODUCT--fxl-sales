# exec-06 - `CUSTO ALOCADO` accepts `%` or `R$`

Slice: `06-wizard-custo-mode`
Branch: `feat/06-wizard-custo-mode`
Plan: `nexo/plans/batch-01K9NX4QPTUI0730CADPRODWIZ/06-wizard-custo-mode.md`

## What changed

Implemented as planned, option (a): the unit is an INPUT MODE only.
No migration, no schema change, no API file touched.
`sales_ops_sale_professionals.cost_brl` stays a single integer-cents column and a `%` resolves to cents before it ever reaches the payload.

### `apps/web/src/sales-ops/calculations.ts`

Three new exports plus one private helper, inserted directly after `describeFuncaoCostBasis` so the wizard-side resolution sits next to the cadastro-side one it delegates to.

- `ProfessionalCostUnit = 'pct' | 'fix'` - reuses the produto cadastro's own literals, so `fix` is the one spelling in the codebase.
- `professionalCostBaseCents(entry, productItemsSubtotalCents)` - the base a wizard `%` is measured against.
- `describeProfessionalCostBase(pct, entry, productItemsSubtotalCents)` - the derivation line, reading the same entry the cents came from.
- `resolveProfessionalCostCents(row, baseCents)` - the ONE place a wizard professional row turns into cents; `pct` delegates to `resolveFuncaoCostCents` so there is a single percentage-of-basis implementation in the app.
- `scopedBaseCents(entry)` (private) - the summed `contributions[].subtotalBrl`, factored out because both exported functions branch on it and they must not be able to disagree about which branch was taken.

The `%` basis is NOT the proposta total.
It is the summed `contributions[].subtotalBrl` of the entry `buildFuncaoCostBasis` already computed, which is exactly "the item subtotals of the items whose produto declares this função".
Neither function takes a recurring value at all, so the recorrência exclusion is structural rather than a rule that could be forgotten.

### `apps/web/src/sales-ops/SalesOpsApp.tsx`

- Imports: `describeProfessionalCostBase`, `professionalCostBaseCents`, `resolveProfessionalCostCents`, `type ProfessionalCostUnit`, kept alphabetical in the existing `./calculations` block.
- `ProfessionalForm` gains `costUnit: ProfessionalCostUnit` and `costPct: string`, both documented as input-mode-only; the existing `costManual` doc comment is kept verbatim with one appended sentence.
- Both row constructors seed `costUnit: 'fix'` / `costPct: '0'` - the `+ profissional` seed and `deriveWizardPrefill`, so a fresh row and a reopened proposta both behave exactly as before.
- `productItemsSubtotalCents` computed beside `funcaoCostBasis`: product items only, item subtotals only.
- Three new row-scoped helpers next to `selectedProduct`: `professionalRowBaseCents`, `professionalRowCents`, `setProfessionalCostUnit`, plus one shared `restoreProfessionalDefault(index, defaultCents)`.
- Every consumer of a professional cost now routes through `professionalRowCents`: the step-3/step-4 `professionalCents` sum, the payables preview row value, and the save payload.
  `parseCurrencyToCents(professional.costBrl)` appears nowhere in the file any more (verified by grep: the only `professional.cost*` reads left are the JSX ones that pick which field the input displays).
- Grid track `150px` -> `212px` in BOTH the header and the row; the header's `Custo alocado` span drops `text-right`.
  Geometry: toggle group is `p-[3px]` + 42px + `gap-[3px]` + 42px = 93px, plus the `gap-2` 8px, leaving 111px for the input.
- The `% | R$` control reuses `UnitToggle` / `UnitInput` verbatim from lines ~3171-3224. No second toggle was built and no prop was added to either component.
- The footer is now a three-branch chain with the `%` branch FIRST (see `costManual` argument below).

### `CLAUDE.md`

One paragraph appended to the Propostas domain section, after the existing `buildFuncaoCostBasis` paragraph, stating the input-mode decision, the base and its fallback, the empty-basis behaviour, and the pinning contract.

## Red-then-green evidence

### Red

Tests written first and run against unmodified production code.

```
   × professional cost unit resolution > resolves a wizard percent against the funcao-scoped item subtotal, floors it, and reads costBrl verbatim in fix mode 2ms
     → (0 , resolveProfessionalCostCents) is not a function
   × professional cost unit resolution > bases a percent on the summed subtotals of the items whose produto declares the funcao 0ms
     → (0 , professionalCostBaseCents) is not a function
   × professional cost unit resolution > falls back to the product-item subtotal total only when no produto declares the funcao 0ms
     → (0 , professionalCostBaseCents) is not a function
   × professional cost unit resolution > never lets the recurring mensalidade into the percent base 0ms
     → (0 , professionalCostBaseCents) is not a function
   × professional cost unit resolution > describes which base a percent was taken from, naming the declaring produtos 0ms
     → (0 , describeProfessionalCostBase) is not a function
   × sale wizard UI contract > keeps the proposal dialog aligned with the Nova proposta wizard shell 12ms
     → expected 'import {\n  AlertTriangle,\n  Calenda…' to contain 'Custo do profissional ${index + 1} em…'
   × sale wizard profissionais alocados > toggles CUSTO ALOCADO to % and resolves against the funcao-scoped item subtotal 10ms
     → toggle not found: Custo do profissional 1 em porcentagem
   × sale wizard profissionais alocados > warns instead of silently writing zero when no product item backs the percentage 6ms
     → button not found: Remover item 1
   × sale wizard profissionais alocados > toggling back to R$ freezes the resolved cents 7ms
     → toggle not found: Custo do profissional 1 em porcentagem
   × sale wizard profissionais alocados > does not let a produto default clobber a percent row, and re-bases it live 5ms
     → toggle not found: Custo do profissional 1 em porcentagem
   × sale wizard profissionais alocados > returns a percent row to R$ and to the produto default on Restaurar padrão 6ms

 Test Files  3 failed (3)
      Tests  11 failed | 38 passed (49)
```

Every failure is the real reason: the pure functions did not exist, the source string was not in the file, and the toggle was not in the DOM.
The one non-oracle failure (`button not found: Remover item 1`) was my own test helper reaching an icon-only button with `buttonByText`; fixed by adding a `buttonByLabel` helper before implementing.

### Green

```
 Test Files  3 passed (3)
      Tests  49 passed (49)
```

### Full verify

```
pnpm run lint        packages/shared-types Done, packages/shared-utils Done, apps/api Done, apps/web Done
pnpm run type-check  packages/shared-types Done, packages/shared-utils Done, apps/api Done, apps/web Done
pnpm test            shared-utils  2 files /  23 tests passed
                     apps/api     29 files / 300 tests passed
                     apps/web     39 files / 381 tests passed
```

Web baseline was 371 across 39 files; 381 is that baseline plus the 10 new tests (5 pure, 5 DOM), with no file added and none lost.
API is 300 across 29 files, exactly the baseline - no API file was touched.

`pnpm --filter @fxl-sales/api test:integration` was not run, per the plan: no API file, schema or migration changed.

## How `costManual` is preserved

The invariant is "a `%` row is always `costManual`", and it is established at the only two places a row can become `pct`:

1. `setProfessionalCostUnit(index, 'pct')` returns `{...item, costUnit: 'pct', costPct: seeded, costManual: true}`.
2. There is no other writer of `costUnit: 'pct'`. `deriveWizardPrefill` and the `+ profissional` seed both write `'fix'`, and `restoreProfessionalDefault` writes `'fix'`.

Every documented event behaves as the plan's table specifies:

| event | `costManual` after | how |
| --- | --- | --- |
| `+ profissional` | `false` | seed unchanged |
| prefill from a stored proposta | `true` | `deriveWizardPrefill` unchanged, still unconditional |
| first keystroke in either input | `true` | the `UnitInput` `onChange` sets it on whichever field the current unit selects |
| toggle `R$` -> `%` | `true` | `setProfessionalCostUnit` |
| toggle `%` -> `R$` | `true`, never cleared | `setProfessionalCostUnit`, deliberately not resetting it |
| `Restaurar padrão` | `false`, and `costUnit: 'fix'`, `costPct: '0'` | `restoreProfessionalDefault` |
| pessoa change | untouched | that handler was not modified |
| função change on a non-manual row | untouched | `applyFuncaoToProfessional` was not modified |

Why a unit toggle cannot resurrect a stale produto default over a hand-typed number:
the render-phase guard's skip condition is now `row.costManual || row.costUnit === 'pct' || !row.funcaoId`, and its body still writes only `costBrl`, which is the `fix`-mode field.
The `costUnit === 'pct'` clause is redundant by the invariant above and is written out on purpose, with a comment, so the invariant is visible at the guard that depends on it.
Because toggling pins the row in BOTH directions, a row that has been toggled even once can never be re-derived from the cadastro again - which is precisely what makes the `%` -> `R$` freeze durable.

`applyFuncaoToProfessional` (slice 05) needed no change: it already re-derives only when `!item.costManual`, and a `%` row never is.
A `%` row whose função changes therefore keeps its percentage and re-bases automatically, because the cents are DERIVED on every render rather than mirrored into `costBrl`.
That derivation is also why this slice adds no fifth render-phase setState sync next to the four documented ones.

The footer's `%` branch comes FIRST in the chain.
It has to: a `%` row is always `costManual`, so the chip branch would otherwise swallow the derivation line the operator needs in order to read the number.
The `Alterado manualmente` string still lives in the `fix` branch, so the existing `sale-wizard-ui-contract.test.ts` assertion on it still passes, and `sale-wizard-funcao-costs.test.tsx` still asserts the chip on the `fix` path.

Pinned by tests: `does not let a produto default clobber a percent row, and re-bases it live` toggles to `%`, types `10`, goes back to step 1, moves the item unit price from R$ 20.000,00 to R$ 40.000,00, returns to step 3, and asserts the input still reads `10` while the resolved money moved to R$ 4.000,00.
`toggling back to R$ freezes the resolved cents` asserts the input reads `2000` and the payload carries `200000`.

## The empty-basis case

`professionalCostBaseCents` returns 0 only when the proposta has no product item at all.
The `%` footer then renders, instead of a derivation, the amber line:

```
Nenhum item de produto na proposta - o percentual resolve para R$ 0,00.
```

Pinned twice: by `warns instead of silently writing zero when no product item backs the percentage` (a proposta whose only item is free-form; asserts the message and that the payload carries `costBrl: 0`), and by the source-contract assertion in `sale-wizard-ui-contract.test.tsx`.

## The vetoable fallback - exact location

`apps/web/src/sales-ops/calculations.ts`, inside `professionalCostBaseCents`:

```ts
const scoped = scopedBaseCents(entry);
if (scoped > 0) return scoped;
return Math.max(0, Math.floor(productItemsSubtotalCents));
```

Strict mode (return `0` when no produto declares the função) is `return scopedBaseCents(entry);` - a three-line deletion inside this one function.
The blast radius of a veto is exactly:

- those three lines,
- the `'total dos itens de produto'` arm of the ternary in `describeProfessionalCostBase` (which then always takes the named-produtos arm),
- the `professionalCostBaseCents(undefined, 3000000) === 3000000` assertion in the `falls back to the product-item subtotal total only when no produto declares the funcao` test, and the matching `describeProfessionalCostBase('10', undefined, 3000000)` assertion.

Nothing in `SalesOpsApp.tsx` moves either way: the wizard passes `productItemsSubtotalCents` in and never branches on which base came back.
The reason the fallback exists is slice 05: the operator can create a função inline from this very picker, and a brand-new função is declared by no produto, so strict mode would resolve `%` to zero for exactly the case the operator is most likely to hit.
Both branches live in that one function, both are pinned by tests, and the derivation line names which branch it took, so the number on screen and the sentence explaining it cannot disagree.

## Divergences from the plan

1. **One private helper added, `scopedBaseCents`.**
   The plan inlined the same `contributions.reduce` three times across two functions.
   Factoring it out is what guarantees `describeProfessionalCostBase` names the branch `professionalCostBaseCents` actually took; two hand-copied reduces could drift.
   Behaviour is identical.

2. **`Restaurar padrão` is one named function, `restoreProfessionalDefault(index, defaultCents)`, rather than a body duplicated at both call sites.**
   The plan says "Both call sites use one handler" but sketched it as an inline object literal; this is that requirement, named.

3. **Test helper `buttonByLabel` added to `sale-wizard-funcao-costs.test.tsx`.**
   Needed because `Remover item N` is an icon-only button with an `aria-label` and no text, so the file's existing `buttonByText` cannot reach it. Test-only.

4. **Not visually verified at a narrow viewport.**
   The plan's risk note asks for one manual check of the 150px -> 212px column. Running the app end to end needs a Hub session this executor does not have.
   Geometry was checked arithmetically instead (93px toggle group + 8px gap + 111px input = 212px), and the same `UnitToggle`/`UnitInput` pair already renders inside the narrower produto dialog cost rows.
   Flagging it for the verify pass rather than claiming it.

5. **`%` is not durable, by design.** Reopening a saved proposta shows `R$` with the resolved cents.
   The plan calls for confirming the operator understands this before shipping. Stated here and written into CLAUDE.md; not re-litigated.
