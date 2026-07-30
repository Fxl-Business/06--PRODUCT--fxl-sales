# exec-01 - optimistic write for the funções cadastro

Slice: `01-funcao-optimistic`.
Branch: `feat/01-funcao-optimistic`.
Plan: `nexo/plans/batch-01K9NX4QPTUI0730CADPRODWIZ/01-funcao-optimistic.md`.

## What changed

### `apps/web/src/sales-ops/optimistic.ts`

- `OptimisticCollection` gained `'funcoes'`.
- `sortRows(rows, label)` is gone.
  `upsert` now takes a `Comparator<T>` instead of a label extractor, and the four collections have named comparators: `areaOrder`, `clientOrder`, `personOrder` and `funcaoOrder`.
  `funcaoOrder` mirrors the API's `ORDER BY is_system DESC, name ASC`, so a new função sorts below `Finder`/`Vendedor` and does not visibly hop down when the refetch lands.
- New `provisionalFuncaoSlug`, a character-for-character mirror of `slugifyFuncao` in `apps/api/src/domains/sales-ops/service.ts:261`.
  Not promoted into `packages/shared-utils`, per the plan.
- New `optimisticFuncao`.
  On insert it hard-codes `isSystem: false`; on edit it preserves `existing.isSystem` rather than reading the payload.
- `reconcileOptimisticRow` lost its `label` parameter and gained a `funcoes` branch.
- `withoutOptimisticRows` now strips optimistic `funcoes` too, and its block comment names the four request paths a `funcaoId` can reach.

### `apps/web/src/sales-ops/hooks.ts`

- `useOptimisticBootstrapWrite` lost its `label` parameter; the three existing call sites dropped their third argument.
- `useSaveSalesOpsFuncao` now wraps `useOptimisticBootstrapWrite<'funcoes', SaveFuncaoPayload, { funcao: SalesOpsFuncao }>`, replacing the "No optimistic write" comment.

### `apps/web/src/sales-ops/SalesOpsApp.tsx`

- New `funcoesBootstrap` memo right after `persistedBootstrap`: raw `funcoes`, persisted everything else, with an identity short-circuit so nothing changes by reference while no função is in flight.
- The `view === 'funcoes'` call site now feeds `FuncoesView` that composed snapshot, and its stale comment was rewritten.
  `FuncoesView`'s prop shape is unchanged, so `pessoas-funcoes-view.test.tsx` needed no edit.
- `FuncoesView` computes `const pending = isOptimisticId(funcao.id)` and its non-system Ações branch now mirrors `PessoasView` verbatim: `Salvando <nome>` / `iconButtonPendingClass` / `disabled` / `title="Salvando..."`.
  The system branch (`Lock`, no edit affordance) is untouched.
  The view docstring gained one sentence about the placeholder id and the uuid cast.

## Red then green

### Red - before any implementation

```
 ❯ src/sales-ops/__tests__/optimistic.test.ts (14 tests | 5 failed)
   × reconciles the optimistic row with the persisted row
     → label is not a function
   × inserts a new função after the system funções and ordered by name
     → (0 , optimisticFuncao) is not a function
   × derives a provisional slug that strips diacritics and punctuation
     → (0 , optimisticFuncao) is not a function
   × reconciles the optimistic função with the persisted row
     → (0 , optimisticFuncao) is not a function
   × never flips isSystem when editing a função optimistically
     → (0 , optimisticFuncao) is not a function
 ❯ src/sales-ops/__tests__/cadastros-refresh.test.tsx (8 tests | 1 failed)
   × shows a new função in the list before the create POST resolves
     → the given combination of arguments (undefined and string) is invalid ...
       expect(row?.textContent).toContain('Designer');   // row was null
 ❯ src/sales-ops/__tests__/optimistic-row-guard.test.tsx (12 tests | 3 failed)
   × disables the função edit affordance while the create POST is in flight
     → button not found: Salvando Função Optimista
   × strips optimistic áreas, clientes, funções and pessoas and keeps every other collection by reference
     → expected [ { …(8) }, { …(8) } ] to have a length of 1 but got 2
   × keeps an unsaved função out of the pessoa função picker
     → expected 'FXLVendasWorkspaceCadastros…' to contain 'AAA Função Nova'

 Test Files  3 failed (3)
      Tests  9 failed | 25 passed (34)
```

### Green - after implementation

```
 ✓ src/sales-ops/__tests__/optimistic.test.ts (14 tests) 8ms
 ✓ src/sales-ops/__tests__/cadastros-refresh.test.tsx (8 tests) 204ms
 ✓ src/sales-ops/__tests__/optimistic-row-guard.test.tsx (12 tests) 247ms

 Test Files  3 passed (3)
      Tests  34 passed (34)
```

## The coupling is real, and both halves were verified individually

The plan's §7 risk note claims each half alone leaves a defect standing.
Both were proven by mutation on the green tree, then reverted.

1. Reverted §4b only (`bootstrap={funcoesBootstrap}` back to `persistedBootstrap`), keeping the optimistic write:

```
   × cadastros list refresh after a create > shows a new função in the list before the create POST resolves
      Tests  1 failed | 7 passed (8)
```

The optimistic row is written into the cache and then stripped straight back out before `FuncoesView` ever sees it.

2. Reverted §2g only (`withoutOptimisticRows` stops filtering `funcoes`), keeping everything else:

```
   × withoutOptimisticRows > strips optimistic áreas, clientes, funções and pessoas ...
   × an unsaved row is never offered to a picker > keeps an unsaved função out of the pessoa função picker
      Tests  2 failed | 10 passed (12)
```

The placeholder `optimistic:funcoes:AAA Função Nova` reaches the `PersonDialog` picker and would land in a `savePerson.funcaoIds` body.

## Safety invariant - the four `funcaoId` request paths

`grep 'bootstrap\.funcoes\|funcoes=' apps/web/src` outside tests returns only:

| Site | Snapshot | Request path |
| --- | --- | --- |
| `SalesOpsApp.tsx:1296` `ProductsView` | `persistedBootstrap` | render-only |
| `SalesOpsApp.tsx:1357` `ProductDialog` | `persistedBootstrap` | `saveProduct` -> `productFuncaoCosts[].funcaoId` |
| `SalesOpsApp.tsx:1391` `PersonDialog` | `persistedBootstrap` | `savePerson` -> `funcaoIds[]` |
| `SalesOpsApp.tsx:5035` `allocatableFuncoes` (SaleWizardDialog) | `persistedBootstrap` (prop at 1402) | `createSale`/`updateSale` -> `professionals[].funcaoId` |
| `SalesOpsApp.tsx:2730/2752` `FuncoesView` | `funcoesBootstrap` (raw funções) | PATCH `saveFuncao`, blocked by the `pending` guard |

The fifth path, the PATCH path of `saveFuncao` itself, is closed by §4c: the row's only affordance is `disabled` while `isOptimisticId(funcao.id)`, so `onEdit` cannot fire and `FuncaoDialogBody.submit` can never carry the placeholder id.

`createFuncaoByName` was already safe and is unchanged: it `await`s `mutateAsync` and returns the server row.

## Definition of done

| Command | Result |
| --- | --- |
| `pnpm run lint` | clean (`apps/api`, `apps/web` both Done) |
| `pnpm run type-check` | clean (4 projects Done) |
| `pnpm test` | shared-utils 23 passed, api 300 passed (29 files), web 361 passed (38 files) |

Web baseline was 354; the 7 new tests (4 unit + 1 primary oracle + 2 safety oracles) take it to 361 with nothing lost.

## Divergence from the plan

None of substance. Two notes:

- The plan's safety oracle 2 sketch said "pick `Prestador`, click `Adicionar função`, fill the name input, submit".
  The implemented test fills the pessoa name BEFORE opening the picker, because `requireInput('form input')` would otherwise be ambiguous while the combobox search input is mounted.
  Every assertion the plan named is present unchanged.
- `apps/web/src/sales-ops/__tests__/optimistic.test.ts`'s pre-existing área reconcile test also had to drop its `label` argument (§2f), which is why it appears in the red output.
  That is the plan's own note at the end of §6, not a scope change.
