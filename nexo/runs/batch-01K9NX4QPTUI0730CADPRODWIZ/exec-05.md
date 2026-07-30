# exec-05 - `FUNÇÃO NO PROJETO` offers inline create

Slice: `05-wizard-funcao-create`
Branch: `feat/05-wizard-funcao-create`
Plan: `nexo/plans/batch-01K9NX4QPTUI0730CADPRODWIZ/05-wizard-funcao-create.md`

## What changed

`apps/web/src/sales-ops/SalesOpsApp.tsx`

- **E1** - `SaleWizardDialog` gained `onCreateFuncao?: (name: string) => Promise<SalesOpsFuncao | null>`, threaded through the `SaleWizardDialogBody` JSX and into that component's destructure and inline type, alphabetically between `onCreateClient` and `onCreateProduct`.
- **E2** - the parent render site now passes `onCreateFuncao={createFuncaoByName}`, the same handler already given to `PersonDialog`.
- **E3** - added the `createdFuncoes` local buffer and replaced `allocatableFuncoes` with a single merged, deduped, `isOptimisticId`-filtered list. There is exactly one such list; both remaining call sites read it.
- **E4** - extracted `applyFuncaoToProfessional(index, funcaoId, funcaoName)` as the one place a profissional row's função is written, and added `createFuncaoForProfessional(index, name)` mirroring `createAreaForItem` and `PersonDialogBody.handleCreateFuncao`.
- **E5** - the picker's `onChange` now delegates to `applyFuncaoToProfessional`, and `onCreate` was added immediately after it. `emptyMessage`, `entityGender`, `entityLabel` and every other prop are byte-identical.

`CLAUDE.md`

- **E6** - the `onCreate` bullet under UI Controls gained one clause naming the wizard's `FUNÇÃO NO PROJETO` picker. The two deliberate exclusions (`Custos padrão por função` in `ProductDialog`, the vendedor/finder pickers) are untouched, word for word.

Tests

- `apps/web/src/sales-ops/__tests__/sale-wizard-funcao-costs.test.tsx` - `renderWizard` gained optional `onCreateFuncao` and `bootstrapOverride` params (existing zero-arg call sites unchanged), plus `panelSearch()` and `createRow()` helpers, plus the three oracle tests.
- `apps/web/src/sales-ops/__tests__/sale-wizard-ui-contract.test.tsx` - the source pin inside the existing `keeps every picker on the Combobox...` test.

## Red then green

RED, before any source change (`vitest run` over the two test files):

```
 × sale wizard UI contract > keeps every picker on the Combobox with no native picker markup left behind
   → expected 'import {\n  AlertTriangle,\n  Calenda…' to contain 'createFuncaoForProfessional'
 × sale wizard profissionais alocados > offers an inline create row in the funcao picker and selects the created funcao immediately
   → expected undefined to be '+ Criar nova função "Arquiteto"' // Object.is equality
 × sale wizard profissionais alocados > sends the real server funcaoId for an inline-created funcao, never an optimistic placeholder
   → Cannot read properties of null (reading 'dispatchEvent')
 × sale wizard profissionais alocados > never offers an optimistic funcao row in the profissional picker
   → expected [ 'Arquiteto Otimista', …(3) ] to not include 'Arquiteto Otimista'

 Test Files  2 failed (2)
      Tests  4 failed | 20 passed (24)
```

Every failure reason is the real defect: no create row renders (so `createRow()` is `undefined`/`null` and cannot be clicked), an optimistic função is offered in the picker, and the wiring is absent from the source.

GREEN, after E1-E5:

```
 ✓ src/sales-ops/__tests__/sale-wizard-ui-contract.test.tsx (6 tests) 60ms
 ✓ src/sales-ops/__tests__/sale-wizard-funcao-costs.test.tsx (18 tests) 226ms
 Test Files  2 passed (2)
      Tests  24 passed (24)
```

## Definition of done

| Command | Result |
|---|---|
| `pnpm run lint` | clean (`apps/api` Done, `apps/web` Done) |
| `pnpm run type-check` | clean (all four projects Done) |
| `pnpm test` - web | `Test Files 39 passed (39)` / `Tests 371 passed (371)` - baseline 368, plus this slice's 3 |
| `pnpm test` - api | `Test Files 29 passed (29)` / `Tests 300 passed (300)` - baseline held exactly |
| `pnpm test` - shared-utils | `Test Files 2 passed (2)` / `Tests 23 passed (23)` |

No file count lost, no test lost.

## The three defences - verified by reading the code

**1. The id written to the row comes from the API response, not the cache.**
`createFuncaoByName` (`SalesOpsApp.tsx:801-808`) is unchanged by slice 01 and still returns `(await saveFuncao.mutateAsync({...})).funcao`.
`useSaveSalesOpsFuncao` (`apps/web/src/sales-ops/hooks.ts:186-208`) sets `mutationFn: async (payload) => salesOpsApi.saveFuncao(payload, ...)`, and `useOptimisticBootstrapWrite` (`hooks.ts:75-118`) returns **only** `onMutate` / `onError` / `onSuccess` - it declares no `mutationFn`, so the `...optimistic` spread that follows cannot shadow it. TanStack resolves `mutateAsync` with the mutationFn's value, so `created.id` in `createFuncaoForProfessional` is a server uuid even while an optimistic funções row sits in the cache. No revert was needed.

**2. The options list is filtered upstream.**
The wizard is rendered with `bootstrap={persistedBootstrap}` (`SalesOpsApp.tsx:1425`), and `persistedBootstrap = withoutOptimisticRows(bootstrap)` (`738`). Slice 01 did land the `funcoes` filter: `optimistic.ts:325` reads `const funcoes = snapshot.funcoes.filter((row) => !isOptimisticId(row.id));`, and it participates in the identity short-circuit at `327-334`.

**3. The wizard filters again at its own boundary.**
`allocatableFuncoes` (`SalesOpsApp.tsx:5092-5104`) filters `funcao.status === 'active' && !isOptimisticId(funcao.id)`. Oracle test 3 renders the exported `SaleWizardDialog` directly with an `optimistic:funcoes:Arquiteto` row inside the `bootstrap` prop - bypassing `persistedBootstrap` entirely - and asserts the label is absent while `Desenvolvedor` is still present. That test pins defence 3 independently of defences 1 and 2.

All three are in the tree. None was skipped or judged redundant.

## Divergence

One, forced by JavaScript rather than by judgement: the plan places the `createdFuncoes` `useState` "next to the existing `createdAreas` declaration". In the current file `createdAreas` sits *below* `allocatableFuncoes`, and `allocatableFuncoes` reads `createdFuncoes` in its `useMemo` dependency array, which is evaluated during render - so a `const` declared further down would be a temporal-dead-zone `ReferenceError` on first render. `createdFuncoes` is therefore declared immediately above `allocatableFuncoes`, with a comment stating that reason and pointing at `createdAreas` as the idiom being mirrored. Nothing else about the buffer differs from the plan.

Two harness details worth recording: `renderWizard` needed a third optional `bootstrapOverride` param for oracle test 3 (the plan named only `onCreateFuncao`), and oracle test 2 replays test 1's steps rather than literally continuing its state, because each `it` gets a fresh root.

Out of scope and confirmed untouched: `ProductDialogBody`'s `Custos padrão por função` picker and the vendedor / finder pickers have no `onCreate`; `git diff` touches only the five regions listed above.
