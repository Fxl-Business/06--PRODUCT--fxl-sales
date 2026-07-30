---
id: 01-funcao-optimistic
milestone: v2.3.0
status: todo
depends_on: []
files_modified:
  - apps/web/src/sales-ops/optimistic.ts
  - apps/web/src/sales-ops/hooks.ts
  - apps/web/src/sales-ops/SalesOpsApp.tsx
  - apps/web/src/sales-ops/__tests__/optimistic.test.ts
  - apps/web/src/sales-ops/__tests__/optimistic-row-guard.test.tsx
  - apps/web/src/sales-ops/__tests__/cadastros-refresh.test.tsx
acceptance: "Given an admin on /cadastros/funcoes with the create POST still in flight, when she submits a new função in the FuncaoDialog, then the row is on screen immediately (empty state gone) with a disabled `Salvando <nome>` action, its placeholder id never reaches any request body or path, and the onSuccess reconcile swaps in the persisted uuid before the invalidated refetch lands."
---

# 01 - optimistic write for the funções cadastro

## 1. Diagnosis (confirmed by reading the code)

The operator's report is exact and the known root cause is the whole story. There are
**two** independent blockers, and fixing only the first would leave the defect standing.

### Blocker A - no optimistic write exists

`apps/web/src/sales-ops/hooks.ts:186-195`:

```ts
export function useSaveSalesOpsFuncao() {
  const { getToken } = useAccessToken();
  // No optimistic write: the server derives `slug` from `name`, so the client cannot
  // build the persisted row.
  return useAppMutation({
    mutationFn: async (payload: SaveFuncaoPayload) =>
      salesOpsApi.saveFuncao(payload, await requireToken(getToken)),
    invalidates: [queryKeys.salesOps.all],
  });
}
```

`useSaveSalesOpsPerson`, `useSaveSalesOpsClient` and `useSaveSalesOpsArea` all wrap
`useOptimisticBootstrapWrite` (`hooks.ts:73-117`); the função hook does not.
`OptimisticCollection` is `'areas' | 'clients' | 'people'` (`optimistic.ts:23`) and there
is no `optimisticFuncao` builder.

The invalidation is **not** broken: `invalidates: [queryKeys.salesOps.all]` is present and
`apps/web/src/sales-ops/__tests__/cadastros-refresh.test.tsx:421-450` already proves the row
appears once the POST resolves *and* the refetch lands. What the operator sees is exactly
that: two network round trips of nothing happening, then the row. So the defect is the
missing optimistic write and nothing else.

### Blocker B - `FuncoesView` is fed the stripped snapshot

`apps/web/src/sales-ops/SalesOpsApp.tsx:1307-1318`:

```tsx
{view === 'funcoes' ? (
  /*
    persistedBootstrap: no função is ever written optimistically, so
    `funcoes` is identical either way, and this keeps an in-flight
    optimistic pessoa out of the "Nº pessoas" column - an optimistic row
    belongs only to the cadastro that created it.
  */
  <FuncoesView bootstrap={persistedBootstrap} ... />
) : null}
```

`ClientsView` (1291), `AreasView` (1297) and `PessoasView` (1303) each get the RAW
`bootstrap`; `FuncoesView` is the only cadastro list on the persisted one. Once
`withoutOptimisticRows` learns to strip funções (which it MUST, see §4), this call site
would strip the very row we just inserted and the screen would stay exactly as broken as
today. Both halves ship together or neither works.

The comment's premise ("no função is ever written optimistically") becomes false with this
slice, but its *second* clause is still a real requirement: the `Nº pessoas` column counts
`bootstrap.people`, and an in-flight optimistic **pessoa** must not be counted there. So the
fix is not "swap to `bootstrap`" - it is a composed snapshot: raw `funcoes`, persisted
`people`.

### Blocker C (latent, must be closed in the same slice) - the edit affordance

`FuncoesView` renders an enabled `Editar <nome>` button for every non-system função
(`SalesOpsApp.tsx:2773-2783`). An optimistic função is `isSystem: false`, so the moment the
row appears the operator can click it, `FuncaoDialogBody.submit` sends
`{ id: 'optimistic:funcoes:Designer', ... }`, and `salesOpsApi.saveFuncao` builds
`PATCH /api/v1/sales-ops/funcoes/optimistic:funcoes:Designer` - a Postgres uuid cast
failure. `AreasView` (2562), `ClientsView` (2498) and `PessoasView` (2640) all already guard
this with `const pending = isOptimisticId(row.id)`. `FuncoesView` has no such guard because
it never needed one.

### What is already safe and needs no change

- `createFuncaoByName` (`SalesOpsApp.tsx:764-771`) `await`s `mutateAsync` and returns the
  **server** row; `handleCreateFuncao` (`SalesOpsApp.tsx:4523-4531`) assigns `created.id`.
  The inline-create path in `PersonDialog` therefore never touches a placeholder id.
- `FuncaoDialog` is keyed on `props.modal.funcao?.id ?? 'new-funcao'`, so no stale state.
- The API refuses `vendedor`/`finder` slugs (`reserved_slug`) and never lets a caller set
  `isSystem` (`apps/api/src/domains/sales-ops/service.ts:1329-1341`). The optimistic row
  must hard-code `isSystem: false` on insert and preserve `existing.isSystem` on edit.

### Ordering fact that the plan depends on

The API orders funções **`ORDER BY is_system DESC, name ASC`** - see
`service.ts:1075`, `service.ts:1312` and `service.ts:2374`. That is NOT the plain
name ordering the existing `sortRows(rows, label)` helper implements. An optimistic função
sorted by name alone would jump above `Finder`/`Vendedor` and then visibly hop down when the
refetch lands. The `upsert` helper must therefore take a **comparator**, not a label.

## 2. `apps/web/src/sales-ops/optimistic.ts`

### 2a. Imports

Add `SaveFuncaoPayload` to the `./api` type import and `SalesOpsFuncao` to the `./types`
type import.

### 2b. Collection union

```ts
export type OptimisticCollection = 'areas' | 'clients' | 'funcoes' | 'people';
```

`CollectionRow<'funcoes'>` then resolves to `SalesOpsFuncao` with no further work, because
`SalesOpsBootstrap['funcoes'][number]` is already that type.

### 2c. Replace the label-based sort with per-collection comparators

Delete `sortRows` and rewrite `upsert`. The `label` argument disappears from the module's
public surface entirely (see §3 for the two hook call sites it removes), because
`collection` already determines the ordering and a `label` parameter that the `funcoes`
branch must ignore is a trap for the next reader.

```ts
type Comparator<T> = (a: T, b: T) => number;

/** pt-BR collation so the optimistic order matches the server `ORDER BY name`. */
function byPtBrName(a: string, b: string): number {
  return a.localeCompare(b, 'pt-BR');
}

const areaOrder: Comparator<SalesOpsArea> = (a, b) => byPtBrName(a.name, b.name);
const clientOrder: Comparator<SalesOpsClient> = (a, b) => byPtBrName(a.name, b.name);
const personOrder: Comparator<SalesOpsPerson> = (a, b) =>
  byPtBrName(a.displayName, b.displayName);
/**
 * Mirrors the API's `ORDER BY is_system DESC, name ASC` (service.ts listFuncoes and the
 * bootstrap query). Plain name ordering would float a new função above Finder/Vendedor
 * and make it visibly hop down when the refetch lands.
 */
const funcaoOrder: Comparator<SalesOpsFuncao> = (a, b) =>
  Number(b.isSystem) - Number(a.isSystem) || byPtBrName(a.name, b.name);

function upsert<T extends { id: string }>(
  rows: readonly T[],
  rowId: string,
  nextRow: T,
  compare: Comparator<T>,
): T[] {
  const replaced = rows.some((row) => row.id === rowId)
    ? rows.map((row) => (row.id === rowId ? nextRow : row))
    : [...rows, nextRow];
  return [...replaced].sort(compare);
}
```

Update the three existing builders' `upsert` calls:

- `optimisticArea`: `upsert(previous.areas, rowId, nextRow, areaOrder)`
- `optimisticClient`: `upsert(previous.clients, rowId, nextRow, clientOrder)`
- `optimisticPerson`: `upsert(previous.people, rowId, nextRow, personOrder)`

Also update the module docstring at the top: it says "the three cadastros" - make it four,
and drop the implication that funções are server-derived-only.

### 2d. Provisional slug

Add, directly above `optimisticFuncao`:

```ts
/**
 * Mirrors `slugifyFuncao` in apps/api/src/domains/sales-ops/service.ts. It is a
 * PROVISIONAL value: the onSuccess reconcile in useOptimisticBootstrapWrite swaps the
 * whole row for the persisted one, so any drift from the server's derivation self-heals
 * inside a single round trip. Nothing renders a slug in FuncoesView (the columns are
 * Nome / Tipo / Status / Nº pessoas), and PersonDialog reads the PERSISTED snapshot, so
 * this value never reaches a screen or a request either.
 */
function provisionalFuncaoSlug(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120)
    .replace(/-+$/g, '');
}
```

Do **not** promote `slugifyFuncao` into `packages/shared-utils`. It would drag the API into a
web-only slice for a value that is invisible and self-healing; the local mirror plus this
comment is the cheaper and more honest arrangement.

### 2e. `optimisticFuncao`

Insert after `optimisticClient` (keeping the file's areas / clients / funcoes / people
order aligned with the union):

```ts
export function optimisticFuncao(
  previous: SalesOpsBootstrap,
  payload: SaveFuncaoPayload,
): OptimisticPatch {
  const existing = payload.id
    ? previous.funcoes.find((row) => row.id === payload.id)
    : undefined;
  const rowId = existing?.id ?? payload.id ?? optimisticId('funcoes', payload.name);
  const nextRow: SalesOpsFuncao = existing
    ? {
        ...existing,
        ...payload,
        id: existing.id,
        orgId: existing.orgId,
        slug: provisionalFuncaoSlug(payload.name),
        // Never taken from the payload: only a migration may flag a função as one of the
        // two predefined app roles, and the API answers 409 funcao_is_system to any write
        // that targets one at all.
        isSystem: existing.isSystem,
        createdAt: existing.createdAt,
        updatedAt: existing.updatedAt,
      }
    : {
        id: rowId,
        orgId: borrowedOrgId(previous.funcoes),
        name: payload.name,
        slug: provisionalFuncaoSlug(payload.name),
        isSystem: false,
        status: payload.status ?? 'active',
        createdAt: new Date().toISOString(),
        updatedAt: null,
      };

  return {
    next: { ...previous, funcoes: upsert(previous.funcoes, rowId, nextRow, funcaoOrder) },
    previous,
    rowId,
  };
}
```

### 2f. `reconcileOptimisticRow`

Drop the `label` parameter and add the `funcoes` branch:

```ts
/** Swap the optimistic row for the row the server returned. */
export function reconcileOptimisticRow<K extends OptimisticCollection>(
  snapshot: SalesOpsBootstrap,
  collection: K,
  rowId: string,
  persisted: CollectionRow<K>,
): SalesOpsBootstrap {
  if (collection === 'areas') {
    return {
      ...snapshot,
      areas: upsert(snapshot.areas, rowId, persisted as SalesOpsArea, areaOrder),
    };
  }
  if (collection === 'clients') {
    return {
      ...snapshot,
      clients: upsert(snapshot.clients, rowId, persisted as SalesOpsClient, clientOrder),
    };
  }
  if (collection === 'funcoes') {
    return {
      ...snapshot,
      funcoes: upsert(snapshot.funcoes, rowId, persisted as SalesOpsFuncao, funcaoOrder),
    };
  }
  return {
    ...snapshot,
    people: upsert(snapshot.people, rowId, persisted as SalesOpsPerson, personOrder),
  };
}
```

### 2g. `withoutOptimisticRows` - the safety requirement

```ts
export function withoutOptimisticRows(snapshot: SalesOpsBootstrap): SalesOpsBootstrap {
  const areas = snapshot.areas.filter((row) => !isOptimisticId(row.id));
  const clients = snapshot.clients.filter((row) => !isOptimisticId(row.id));
  const funcoes = snapshot.funcoes.filter((row) => !isOptimisticId(row.id));
  const people = snapshot.people.filter((row) => !isOptimisticId(row.id));
  if (
    areas.length === snapshot.areas.length &&
    clients.length === snapshot.clients.length &&
    funcoes.length === snapshot.funcoes.length &&
    people.length === snapshot.people.length
  ) {
    return snapshot;
  }
  return { ...snapshot, areas, clients, funcoes, people };
}
```

Extend the block comment above it to say a `funcaoId` reaches a request body through three
distinct paths (`savePerson.funcaoIds`, `saveProduct.productFuncaoCosts[].funcaoId`,
`createSale/updateSale.professionals[].funcaoId`).

## 3. Who reads the stripped snapshot vs the raw one (verified, not assumed)

`persistedBootstrap = useMemo(() => withoutOptimisticRows(bootstrap), [bootstrap])` is
declared once at `SalesOpsApp.tsx:715`. Every `funcoes` consumer was read directly:

**Reads the STRIPPED snapshot - a `funcaoId` from here can reach a request:**

| Line | Consumer | Where a `funcaoId` goes |
| --- | --- | --- |
| 1282 | `<ProductsView funcoes={persistedBootstrap.funcoes} />` | render-only (labels the flat `productFuncaoCosts` rows) |
| 1343 | `<ProductDialog funcoes={persistedBootstrap.funcoes} />` | `saveProduct` body -> `productFuncaoCosts[].funcaoId` |
| 1377 | `<PersonDialog funcoes={persistedBootstrap.funcoes} />` | `savePerson` body -> `funcaoIds[]` |
| 1388 | `<SaleWizardDialog bootstrap={persistedBootstrap} />` | `bootstrap.funcoes` at 5014-5023 (`allocatableFuncoes`) -> `createSale`/`updateSale` body -> `professionals[].funcaoId` |
| 716 | `buildDashboardModel(persistedBootstrap)` | render-only |
| 1257 / 1261 / 1272 / 1275 / 1277 | `DashboardView`, `SalesView`, two `MeuPainelView`, `CommissionsView` | render-only |

All four request-bearing paths already read the stripped snapshot, so extending
`withoutOptimisticRows` with `funcoes` is sufficient - **no call site needs to be re-pointed
to `persistedBootstrap`.** Nothing in the tree reads `bootstrap.funcoes` raw today
(`grep -n 'bootstrap\.funcoes'` returns only `FuncoesView` at 2713/2735 and the wizard at
5016, and the wizard is fed the persisted object).

**Reads the RAW snapshot - the three cadastros lists that own their optimistic rows:**
`ClientsView` (1291), `AreasView` (1297), `PessoasView` (1303). `FuncoesView` joins them in
§4, through a composed snapshot rather than the raw one.

## 4. `apps/web/src/sales-ops/SalesOpsApp.tsx`

### 4a. Composed snapshot for the funções cadastro

Immediately after the `persistedBootstrap` memo at line 715, add:

```tsx
/**
 * The funções cadastro is the one screen that must see its OWN optimistic funções and
 * nobody else's optimistic rows: the `Nº pessoas` column counts `people`, and an
 * in-flight optimistic PESSOA belongs to `cadastros/pessoas`, not here. The identity
 * short-circuit means nothing changes by reference while no função is in flight, which
 * is the normal case.
 */
const funcoesBootstrap = useMemo(
  () =>
    bootstrap.funcoes === persistedBootstrap.funcoes
      ? persistedBootstrap
      : { ...persistedBootstrap, funcoes: bootstrap.funcoes },
  [bootstrap.funcoes, persistedBootstrap],
);
```

### 4b. Re-point the call site and rewrite its stale comment

Replace lines 1307-1318 with:

```tsx
{view === 'funcoes' ? (
  /*
    funcoesBootstrap: raw `funcoes` so an optimistic função created here is visible
    immediately, persisted `people` so an in-flight optimistic pessoa never inflates
    the "Nº pessoas" column - an optimistic row belongs only to the cadastro that
    created it.
  */
  <FuncoesView
    bootstrap={funcoesBootstrap}
    onEdit={(funcao) => setModal({ kind: 'funcao', funcao })}
  />
) : null}
```

`FuncoesView`'s prop signature stays `{ bootstrap: SalesOpsBootstrap; onEdit }`, so
`apps/web/src/sales-ops/__tests__/pessoas-funcoes-view.test.tsx` (lines 436, 466, 477)
needs no change.

### 4c. Guard the edit affordance in `FuncoesView`

Inside the `bootstrap.funcoes.map` callback (line 2735), next to the existing `personCount`
computation, add:

```tsx
const pending = isOptimisticId(funcao.id);
```

Then replace the non-system branch of the Ações cell (lines 2773-2783) so the three states
are `predefinida` -> `salvando` -> `editável`, mirroring `PessoasView` at 2676-2689 verbatim:

```tsx
) : (
  <button
    aria-label={pending ? `Salvando ${funcao.name}` : `Editar ${funcao.name}`}
    className={pending ? iconButtonPendingClass : iconButtonClass}
    disabled={pending}
    onClick={() => onEdit(funcao)}
    title={pending ? 'Salvando...' : 'Editar'}
    type="button"
  >
    <Edit3 className="h-[15px] w-[15px]" />
  </button>
)}
```

`isOptimisticId` is already imported at line 91. Extend the `FuncoesView` docstring
(2699-2705) with one sentence: an optimistic row is visible but not editable, because its
placeholder id would fail the PATCH path's uuid cast.

## 5. `apps/web/src/sales-ops/hooks.ts`

### 5a. Imports

Add `optimisticFuncao` to the `./optimistic` import and `SalesOpsFuncao` to the `./types`
import.

### 5b. Drop `label` from `useOptimisticBootstrapWrite`

```ts
function useOptimisticBootstrapWrite<K extends OptimisticCollection, TPayload, TResponse>(
  collection: K,
  build: (previous: SalesOpsBootstrap, payload: TPayload) => OptimisticPatch,
  persistedRow: (response: TResponse) => CollectionRow<K>,
) {
```

and in `onSuccess`:

```ts
queryClient.setQueryData(
  queryKeys.salesOps.bootstrap(),
  reconcileOptimisticRow(current, collection, patch.rowId, persistedRow(response)),
);
```

Update the docstring above it: "the four cadastros whose row the client can compute in
full".

Then drop the third argument at each existing call site:

- `useSaveSalesOpsPerson`: `('people', optimisticPerson, (response) => response.person)`
- `useSaveSalesOpsClient`: `('clients', optimisticClient, (response) => response.client)`
- `useSaveSalesOpsArea`: `('areas', optimisticArea, (response) => response.area)`

### 5c. `useSaveSalesOpsFuncao`

```ts
export function useSaveSalesOpsFuncao() {
  const { getToken } = useAccessToken();
  /**
   * The provisional slug in `optimisticFuncao` is the only value the client cannot derive
   * exactly, and it is invisible: nothing renders a slug, and the onSuccess reconcile
   * replaces the whole row with the persisted one before the refetch lands.
   */
  const optimistic = useOptimisticBootstrapWrite<
    'funcoes',
    SaveFuncaoPayload,
    { funcao: SalesOpsFuncao }
  >('funcoes', optimisticFuncao, (response) => response.funcao);
  return useAppMutation<
    { funcao: SalesOpsFuncao },
    Error,
    SaveFuncaoPayload,
    OptimisticPatch | undefined
  >({
    mutationFn: async (payload) => salesOpsApi.saveFuncao(payload, await requireToken(getToken)),
    invalidates: [queryKeys.salesOps.all],
    ...optimistic,
  });
}
```

Note the `SalesOpsFuncao` return type is already what `salesOpsApi.saveFuncao` declares
(`api.ts:126-132`), so `createFuncaoByName`'s `const { funcao } = await mutateAsync(...)`
destructure keeps type-checking unchanged.

## 6. Oracle tests

### Primary oracle - the operator's exact complaint

**File:** `apps/web/src/sales-ops/__tests__/cadastros-refresh.test.tsx`
**Test:** `it('shows a new função in the list before the create POST resolves', ...)`

Add it as a new sibling immediately above the existing
`'shows a new função in the list once the create POST resolves, with no further user action'`
(line 421), which stays untouched as the post-resolve control. Body, modelled on the pessoa
test at 390-419:

```tsx
it('shows a new função in the list before the create POST resolves', async () => {
  const saveFuncaoDeferred = createDeferred<{ funcao: SalesOpsFuncao }>();
  vi.mocked(salesOpsApi.saveFuncao).mockReturnValueOnce(saveFuncaoDeferred.promise);

  await renderApp('/cadastros/funcoes');
  await resolveBootstrap(0, snapshot());
  expect(text()).toContain('Nenhuma função cadastrada');

  await click(buttonByText('Nova função'));
  await changeInput(requireInput('form input'), 'Designer');
  await submitDialogForm();

  // The POST is still in flight and the refetch has not been resolved, so the only
  // thing that can have put the row on screen is the optimistic write.
  expect(vi.mocked(salesOpsApi.saveFuncao)).toHaveBeenCalledTimes(1);
  const row = container.querySelector('tbody tr');
  expect(row?.textContent).toContain('Designer');
  expect(row?.textContent).toContain('Personalizada');
  expect(text()).not.toContain('Nenhuma função cadastrada');
});
```

**Fails before:** `FuncoesView` still renders the `Nenhuma função cadastrada` empty panel,
so `container.querySelector('tbody tr')` is `null` and the first `toContain` throws.
**Passes after:** both §2/§5 (the write) and §4 (the raw-funcoes call site) are in place -
either one alone still fails, which is exactly the coupling this test is meant to pin.

### Safety oracles - the placeholder id never escapes

**File:** `apps/web/src/sales-ops/__tests__/optimistic-row-guard.test.tsx`

1. `it('disables the função edit affordance while the create POST is in flight', ...)` -
   add to the `an optimistic row is visible but never actionable` describe, cloned from the
   pessoa case at 392-410: render `/cadastros/funcoes`, resolve an empty bootstrap, click
   `Nova função`, type `Função Optimista`, submit, then assert
   `requireButtonByAriaLabel('Salvando Função Optimista').disabled === true`, its `title`
   is `'Salvando...'`, and `container.querySelector('button[aria-label="Editar Função Optimista"]')`
   is `null`.

2. `it('keeps an unsaved função out of the pessoa função picker', ...)` - add to the
   `an unsaved row is never offered to a picker` describe, cloned from the área case at
   527-573. Render `/cadastros/funcoes` with `snapshot({ funcoes: [funcaoPrestador] })`,
   create `AAA Função Nova` with a deferred `saveFuncao`, click `Cancelar`, click
   `nav button[aria-label="Pessoas"]`, click `Nova pessoa`, open the
   `comboboxTrigger('Função da pessoa')` picker and assert the offered options are exactly
   `['Prestador']` and do not contain `AAA Função Nova`. Then pick `Prestador`, click
   `Adicionar função`, fill the name input, submit, and assert
   `savePerson.mock.calls[0][0].funcaoIds` equals `[funcaoPrestador.id]` with
   `String(...[0]).not.toMatch(/^optimistic:/)`. This is the test that proves §2g does its
   job; without the `funcoes` filter in `withoutOptimisticRows` the picker offers the
   placeholder and the payload assertion fails.

3. Extend the existing `withoutOptimisticRows` describe (470-524):
   - in `'returns the same snapshot reference when no row is optimistic'`, change
     `funcoes: []` to `funcoes: [funcaoVendedor, funcaoPrestador]` so the identity
     short-circuit is exercised with a populated collection.
   - rename `'strips optimistic áreas, clientes and pessoas and keeps every other collection by reference'`
     to `'strips optimistic áreas, clientes, funções and pessoas and keeps every other collection by reference'`,
     add a `funcoes` entry `[funcaoPrestador, { ...funcaoPrestador, id: optimisticId('funcoes', 'Nova'), name: 'Nova' }]`,
     and assert `result.funcoes` has length 1 with `result.funcoes[0]?.id === funcaoPrestador.id`.

### Unit oracles - the patch builder

**File:** `apps/web/src/sales-ops/__tests__/optimistic.test.ts` (import `optimisticFuncao`)

1. `it('inserts a new função after the system funções and ordered by name', ...)` - previous
   snapshot `{ funcoes: [vendedor, designer] }` (the fixtures at lines 33-39 already give a
   system `Vendedor` and a custom `Designer`); `optimisticFuncao(previous, { name: 'Arquiteto', status: 'active' })`
   must yield `['Vendedor', 'Arquiteto', 'Designer']`, an inserted row with
   `isSystem === false`, `slug === 'arquiteto'`, `status === 'active'`, an id matching
   `/^optimistic:/`, and `patch.next.people === previous.people`.
2. `it('derives a provisional slug that strips diacritics and punctuation', ...)` -
   `{ name: 'Gestão de Contas / P.O.' }` yields `slug === 'gestao-de-contas-p-o'`.
3. `it('reconciles the optimistic função with the persisted row', ...)` - mirrors the área
   reconcile test at 138-153, calling
   `reconcileOptimisticRow(patch.next, 'funcoes', patch.rowId, persisted)` (note the
   dropped `label` argument) and asserting no `isOptimisticId` row survives.
4. `it('never flips isSystem when editing a função optimistically', ...)` - edit `designer`
   with `{ id: designer.id, name: 'Design', status: 'archived' }`; the row keeps
   `isSystem: false`, gains `slug: 'design'` and `status: 'archived'`, and the collection
   length stays 2.

Note: tests 1, 3 and 4 in this file plus the reconcile call in item 3 also exercise the
`label`-parameter removal, so a half-applied §2f fails type-check immediately.

## 7. Risk notes

- **The two halves are coupled.** Adding `funcoes` to `withoutOptimisticRows` (§2g) without
  re-pointing the `FuncoesView` call site (§4b) leaves the operator's bug exactly as it is,
  and re-pointing without the strip lets a placeholder `funcaoId` into three request bodies.
  The primary oracle catches the first; safety oracle 2 catches the second.
- **`reserved_slug` rollback.** Typing `Vendedor` or `Finder` shows the row for one round
  trip, then the API answers 409 and `onError` restores `patch.previous`. That is the same
  flicker áreas and clientes already have for a duplicate name, and it is the correct
  behaviour for an optimistic write - do not add a client-side reserved-slug pre-check, it
  would be a second source of truth for a rule the DB CHECK already owns.
- **Sort drift.** `localeCompare(…, 'pt-BR')` is not bit-identical to the Postgres
  collation, so an optimistic row can sit one position off for a single round trip. Already
  documented at the top of `optimistic.ts`; the `is_system DESC` leading key is exact, so
  only the within-group name order can wobble.
- **No API change.** This slice is web-only. `slugifyFuncao`, `FuncaoSchema`, the
  `sales_ops_funcoes_system_slug_check` constraint and the `409 funcao_is_system` path are
  all untouched, so the "Pessoas e Funções" invariants in `CLAUDE.md` hold by construction:
  a system função still gets a `Lock` and no edit affordance (§4c only replaces the
  non-system branch), and there is still no delete verb anywhere.
- **`pessoas-funcoes-view.test.tsx` is unaffected** - `FuncoesView`'s prop shape does not
  change. If the executor is tempted to split the prop into `funcoes` + `people`, don't:
  it churns three call sites in that test for no gain.

## 8. Verification

```bash
pnpm --filter @fxl-sales/web test -- --run optimistic
pnpm --filter @fxl-sales/web test -- --run cadastros-refresh
pnpm run lint
pnpm run type-check
pnpm test
```
