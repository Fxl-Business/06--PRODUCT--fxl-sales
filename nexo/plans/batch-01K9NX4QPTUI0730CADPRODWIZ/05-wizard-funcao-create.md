---
id: 05-wizard-funcao-create
milestone: v2.3.0
status: todo
depends_on: ["01-funcao-optimistic"]
files_modified: []
acceptance: "given the proposta wizard on step 3 with a profissional row whose FUNÇÃO NO PROJETO picker is open and a query matching no cadastro função, when the operator clicks the `+ Criar nova função \"<query>\"` row, then the função is created through the API, becomes the row's selected função immediately without waiting for the bootstrap refetch, and the saved payload's `professionals[].funcaoId` carries the real server uuid and never an `optimistic:` placeholder"
---

# 05 - `FUNÇÃO NO PROJETO` offers inline create

## Defect

Proposta wizard, step 3 `Profissionais alocados`, the `FUNÇÃO NO PROJETO` Combobox.
The operator typed `as`, and the panel showed only `Nenhuma função cadastrada` with no create row.
Every other picker in sales-ops that can yield a complete, valid record offers one.

`CLAUDE.md` > UI Controls names função as exactly such a record - "cliente, área and função create through the API" - and "the função picker inside the Pessoa dialog does have one, because a função needs only a name".
The wizard's picker is the same shape of decision and is simply missing the wiring.

**Out of scope, and must stay without a create row:** the `Custos padrão por função` picker inside `ProductDialogBody` (`apps/web/src/sales-ops/SalesOpsApp.tsx:3889`), and the vendedor / finder pickers.
Do not touch either.

## The precedent being mirrored

Two existing implementations, both in `apps/web/src/sales-ops/SalesOpsApp.tsx`. They agree on the mechanism, so there is nothing to invent.

### A. The função inline create - `PersonDialogBody`

| Line(s) | What it does |
|---|---|
| `4446`, `4457`, `4468`, `4475` | `onCreateFuncao?: (name: string) => Promise<SalesOpsFuncao \| null>` declared on `PersonDialog`, threaded to `PersonDialogBody` |
| `4486-4491` | `const [createdFuncoes, setCreatedFuncoes] = useState<SalesOpsFuncao[]>([])` - the local buffer, with a comment saying why: the `funcoes` prop only refreshes once the invalidated refetch lands |
| `4500-4506` | `assignedFuncoes` resolves labels against `funcoes` **and** `createdFuncoes` |
| `4507-4509` | `selectableFuncoes` = `[...funcoes, ...createdFuncoes]` filtered to `status === 'active'` |
| `4517-4531` | `handleCreateFuncao(query)`: `await onCreateFuncao(query.trim())`, bail on `null`, push into `createdFuncoes` deduped by id, then select it. Its comment is the house rule: `onCreate` is `(query: string) => void`, so the async create is wrapped rather than returned, and a rejected create resolves to `null` and leaves state unchanged |
| `4616-4627` | The Combobox: `entityGender="f"`, `entityLabel="função"`, `onCreate={onCreateFuncao ? (query) => void handleCreateFuncao(query) : undefined}` |

### B. The same buffer idiom already inside the wizard - `createdAreas`

| Line(s) | What it does |
|---|---|
| `5105-5109` | `const [createdAreas, setCreatedAreas] = useState<SalesOpsArea[]>([])` |
| `5363-5367` | `selectableAreas` merges `activeAreas` with `createdAreas` not already present |
| `5694-5702` | `createAreaForItem(index, name)` - await, bail on null, dedupe-push into the buffer, then write the id onto the row |
| `6068-6072` | `onCreate={onCreateArea ? (name) => void createAreaForItem(index, name) : undefined}` |

So the wizard already owns this exact pattern for áreas. Slice 05 is that pattern applied to funções, nothing more.

### C. The handler at the top

`createFuncaoByName` already exists at `SalesOpsApp.tsx:764-771`, in the same component body that renders `SaleWizardDialog` at `1386-1407`:

```ts
async function createFuncaoByName(name: string): Promise<SalesOpsFuncao | null> {
  try {
    const { funcao } = await saveFuncao.mutateAsync({ name: name.trim(), status: 'active' });
    return funcao;
  } catch {
    return null;
  }
}
```

It is already passed to `PersonDialog` at `1380`. Nothing new is needed at this end - only one more prop on the wizard.

## Current state of the target picker

`SalesOpsApp.tsx:6704-6749`, inside the `professionals.map` row:

```
aria-invalid={funcaoMissing}
aria-label={`Função do profissional ${index + 1}`}
className={cn(formSelectClass, funcaoMissing && 'border-destructive')}
emptyMessage="Nenhuma função cadastrada"
entityGender="f"
entityLabel="função"
onChange={...}                       // resolves the name from allocatableFuncoes, then re-derives
                                     // costBrl from funcaoCostBasis unless item.costManual
options={allocatableFuncoes.map((funcao) => ({ value: funcao.id, label: funcao.name }))}
placeholder="Selecionar função..."
searchPlaceholder="Buscar função..."
value={professional.funcaoId}
valueLabel={professional.funcaoName}
```

`entityGender` and `entityLabel` are already correct - they are dead props today because `onCreate` is absent. `allocatableFuncoes` has only three references in the whole file (`5014`, `6715`, `6738`), which is what makes folding the buffer into it safe.

## Empty-state check (step 5 of the brief)

`apps/web/src/components/ui/combobox.tsx:353-357` renders `emptyMessage` under `filtered.length === 0 && !showCreate`, and `360` renders the create row under `showCreate` alone.
`shouldShowCreateRow` (`apps/web/src/components/ui/combobox-filter.ts:100-109`) is true when a handler exists, the trimmed query is non-empty, and no option label equals it case-insensitively.

So with `onCreate` wired and the operator typing `as`, `showCreate` is true, the create row renders, and `Nenhuma função cadastrada` correctly disappears.
**The empty message does not block anything and needs no change.** Keep it verbatim - it is still the right copy for an empty query with no funções at all.

## Exact edits

All in `apps/web/src/sales-ops/SalesOpsApp.tsx` unless stated.

### E1 - thread the prop into the wizard

`SaleWizardDialog` props (`4933-4943`), add after `onCreateArea`:

```ts
onCreateFuncao?: (name: string) => Promise<SalesOpsFuncao | null>;
```

Pass it through in the `SaleWizardDialogBody` JSX (`4956-4958`), alphabetically between `onCreateClient` and `onCreateProduct`:

```tsx
onCreateFuncao={props.onCreateFuncao}
```

Add the identical prop to the `SaleWizardDialogBody` destructure and its inline type (`4965-4983`), matching where it sits in `SaleWizardDialog`'s type.

`SalesOpsFuncao` is already imported in this file (used at `4443`); no import change.

### E2 - wire the parent render site

`1386-1407`, add one line after `onCreateClient={createClientByName}` (`1392`):

```tsx
onCreateFuncao={createFuncaoByName}
```

There is no eslint prop-sort rule; alphabetical placement is convention only, but follow it.

### E3 - the local buffer, folded into `allocatableFuncoes`

Add next to the existing `createdAreas` declaration (`5109`):

```ts
/**
 * Funções created from a profissional row's own create row. `bootstrap` only
 * refreshes once the invalidated refetch lands, so without this the função the
 * operator just created would not be selectable for a beat. Same buffer idiom as
 * `createdAreas` above and as `createdFuncoes` in PersonDialogBody.
 */
const [createdFuncoes, setCreatedFuncoes] = useState<SalesOpsFuncao[]>([]);
```

Then REPLACE `allocatableFuncoes` (`5013-5023`) so there is exactly one list and both call sites (`6715`, `6738`) pick up the buffer automatically:

```ts
/**
 * System funções last, then alphabetical, matching the cadastro picker's order.
 * Merges in funções created from this wizard's own create row, deduped by id so
 * the refetch that eventually delivers them cannot double a row.
 *
 * The `isOptimisticId` filter is the local proof of the invariant in
 * `optimistic.ts`: a `funcaoId` chosen here lands in a request body, and a
 * placeholder id fails the Postgres uuid cast. `withoutOptimisticRows` already
 * strips one upstream, but `SaleWizardDialog` is exported and takes `bootstrap`
 * as a prop, so it must hold its own end of the contract.
 */
const allocatableFuncoes = useMemo(() => {
  const merged = [
    ...bootstrap.funcoes,
    ...createdFuncoes.filter(
      (created) => !bootstrap.funcoes.some((funcao) => funcao.id === created.id),
    ),
  ];
  return merged
    .filter((funcao) => funcao.status === 'active' && !isOptimisticId(funcao.id))
    .sort(
      (a, b) => Number(a.isSystem) - Number(b.isSystem) || a.name.localeCompare(b.name, 'pt-BR'),
    );
}, [bootstrap.funcoes, createdFuncoes]);
```

`isOptimisticId` is already imported at line `91`; no import change.

### E4 - extract the row-mutation so create and select cannot diverge

Add next to `createAreaForItem` (`5694-5702`). Function declarations hoist, so placement there is fine even though `funcaoCostBasis` is declared at `5341` (a `const` earlier in the same body).

```ts
/**
 * The one place a profissional row's função is written. Extracted so the picker's
 * `onChange` and its create row cannot drift apart on the cost re-derivation rule.
 */
function applyFuncaoToProfessional(index: number, funcaoId: string, funcaoName: string) {
  setProfessionals((current) =>
    current.map((item, itemIndex) => {
      if (itemIndex !== index) return item;
      const next = { ...item, funcaoId, funcaoName };
      // Re-derive only a cost the operator never typed into.
      return item.costManual
        ? next
        : { ...next, costBrl: centsToInput(funcaoCostBasis.get(funcaoId)?.cents ?? 0) };
    }),
  );
}

/**
 * Mirrors `createAreaForItem` above and `handleCreateFuncao` in PersonDialogBody:
 * the Combobox `onCreate` is `(query: string) => void`, so the async create is
 * wrapped rather than returned, and a rejected create resolves to null and leaves
 * the row untouched. No dialog in this app surfaces API errors today.
 *
 * `created` is the row the API RETURNED, never a row read back out of the query
 * cache, which is what keeps a placeholder id out of `professionals[].funcaoId`.
 */
async function createFuncaoForProfessional(index: number, name: string) {
  if (!onCreateFuncao) return;
  const created = await onCreateFuncao(name);
  if (!created) return;
  setCreatedFuncoes((current) =>
    current.some((funcao) => funcao.id === created.id) ? current : [...current, created],
  );
  applyFuncaoToProfessional(index, created.id, created.name);
}
```

A brand-new função has no `sales_ops_product_funcao_costs` rows, so `funcaoCostBasis.get(created.id)` is `undefined` and the cost lands at `0.00` - correct, and identical to what selecting a costless existing função already does.

### E5 - rewrite the picker's `onChange` in terms of E4, and add `onCreate`

At `6714-6737`, replace the inline `setProfessionals` body with a call:

```tsx
onChange={(value) => {
  const funcao = allocatableFuncoes.find((candidate) => candidate.id === value);
  applyFuncaoToProfessional(index, value, funcao?.name ?? '');
}}
```

and add, immediately after it (alphabetical, before `options`):

```tsx
onCreate={
  onCreateFuncao ? (name) => void createFuncaoForProfessional(index, name) : undefined
}
```

Everything else on this Combobox stays byte-identical, `emptyMessage` included.

### E6 - documentation

`CLAUDE.md` > UI Controls, the `onCreate` bullet, currently reads that `onCreate` is wired for "cliente, área and função" and calls out the two deliberate exclusions.
It never names the wizard's `FUNÇÃO NO PROJETO` picker, so after this slice the doc under-describes the code. Add one clause to that bullet:

> The proposta wizard's `FUNÇÃO NO PROJETO` picker has one too, for the same reason as the Pessoa dialog's; the two deliberate exclusions below are unchanged.

Do not weaken or reword the two exclusions.

## The optimistic-id safety argument

This is the load-bearing part of the slice. `professionals[].funcaoId` is serialised straight into the `POST /sales-ops/sales` body at `5810-5819`, and `optimistic.ts:218-227` states the invariant: a placeholder id must never reach a request body, because it fails the Postgres uuid cast and costs the operator a whole wizard of typing.

Three independent reasons the placeholder cannot get there, in order of strength:

1. **The id written to the row comes from the API response, not from the cache.**
   `createFuncaoByName` (`764-771`) returns `(await saveFuncao.mutateAsync(...)).funcao`.
   `useSaveSalesOpsFuncao` (`apps/web/src/sales-ops/hooks.ts:186-195`) has `mutationFn: salesOpsApi.saveFuncao(...)`, and TanStack Query resolves `mutateAsync` with the **mutationFn's** return value. An `onMutate` cache write, which is what slice 01 adds, does not and cannot change what `mutateAsync` resolves to.
   So `created.id` in E4 is a server uuid even while an optimistic funções row is sitting in the cache.
   **Executor must confirm** while implementing that slice 01 did not change `createFuncaoByName` to read the row back out of the cache. If it did, revert that part - the response row is the contract this slice depends on.

2. **The options list is filtered upstream.** The wizard is rendered with `persistedBootstrap` (`1388`), which is `withoutOptimisticRows(bootstrap)` (`715`). Slice 01 must extend `withoutOptimisticRows` to strip `funcoes` alongside `areas` / `clients` / `people`; that is inherent to slice 01's own invariant and is not this slice's job. If slice 01 lands without it, defence 3 still holds.

3. **The wizard filters again at its own boundary** (E3's `!isOptimisticId(funcao.id)`). `SaleWizardDialog` is an exported component taking `bootstrap` as a prop - the test harness passes one in directly - so it cannot rely on a caller-side filter for its own correctness. One line, at the exact seam where an id turns into money.

There is deliberately no fourth defence at submit time. Filtering the payload would hide a bug rather than prevent one, and the three above make the placeholder unreachable.

## Oracle tests

### ORACLE (behavioural) - `apps/web/src/sales-ops/__tests__/sale-wizard-funcao-costs.test.tsx`

This is the real oracle. The file already renders `SaleWizardDialog` against a full `bootstrap`, already drives step 3 (`goToCosts`, `addProfessional`, `pickOption('Função do profissional 1', ...)`), and already asserts on the save payload at `623-645`. Extend it, do not create a new file.

Harness changes:

- `renderWizard` gains an `onCreateFuncao` param passed to `SaleWizardDialog`; keep the existing zero-arg call sites working (default `undefined`).
- Add two helpers next to `comboboxTrigger`:

```ts
function panelSearch(placeholder: string): HTMLInputElement { /* input[aria-label="<placeholder>"] */ }
function createRow(): HTMLElement | null { /* container.querySelector('[data-combobox-create="true"]') */ }
```

`data-combobox-create="true"` is set by the primitive at `combobox.tsx:368`, so it is a stable hook.

Test 1 - **`offers an inline create row in the funcao picker and selects the created funcao immediately`**

```
const newFuncaoId = 'fc000013-0000-4000-8000-000000000013';
const onCreateFuncao = vi.fn(async (name: string) => funcao(newFuncaoId, name));
await renderWizard(null, onCreateFuncao);
await goToCosts();
await addProfessional();
await click(comboboxTrigger('Função do profissional 1'));
// Negative control first: the defect state.
expect(createRow()).toBeNull();
await typeInto(panelSearch('Buscar função...'), 'Arquiteto');
expect(createRow()?.textContent?.trim()).toBe('+ Criar nova função "Arquiteto"');
// The empty message must not be what renders instead.
expect(container.textContent).not.toContain('Nenhuma função cadastrada');
await click(createRow()!);
await flushReact();
expect(onCreateFuncao).toHaveBeenCalledWith('Arquiteto');
// Selectable immediately - the `bootstrap` prop is deliberately never refreshed here.
expect(comboboxText('Função do profissional 1')).toBe('Arquiteto');
```

Test 2 - **`sends the real server funcaoId for an inline-created funcao, never an optimistic placeholder`**

Continue from Test 1's state, pick `Profissional 1` = `Bruno Entrega`, click `Salvar rascunho`, then:

```
const payload = onSave.mock.calls.at(-1)![0];
expect(payload.professionals[0].funcaoId).toBe(newFuncaoId);
expect(String(payload.professionals[0].funcaoId)).not.toMatch(/^optimistic:/);
expect(payload.professionals[0].role).toBe('Arquiteto');
```

The `not.toMatch(/^optimistic:/)` form matches `optimistic-row-guard.test.tsx:466,572` exactly.

Test 3 - **`never offers an optimistic funcao row in the profissional picker`**

Render against `{...bootstrap, funcoes: [...bootstrap.funcoes, funcao('optimistic:funcoes:Arquiteto', 'Arquiteto Otimista')]}`, open the picker, and assert `optionLabels()` does not contain `Arquiteto Otimista` while still containing `Desenvolvedor` (positive control).
This pins defence 3 independently of whether slice 01 has landed.

The existing `picks a funcao from the registry and lists only active funcoes` test (`439-447`, `expect(options).toEqual(['Desenvolvedor', 'Testador', 'Vendedor'])`) is the regression guard on E3's re-sort and must keep passing untouched.

### SOURCE PIN - `apps/web/src/sales-ops/__tests__/sale-wizard-ui-contract.test.ts`

In the existing `keeps every picker on the Combobox...` test, add:

```ts
/*
  The wizard's FUNÇÃO NO PROJETO picker offers inline create like every other
  sales-ops picker. The create ROW is asserted in the DOM by
  sale-wizard-funcao-costs.test.tsx; what is pinned here is the wiring, because a
  substring test cannot see a rendered row.
  Two occurrences: PersonDialog and SaleWizardDialog. A count rather than
  `toContain`, which would still pass if the wizard's line were deleted.
*/
expect(source).toContain('createFuncaoForProfessional');
expect(source.match(/onCreateFuncao=\{createFuncaoByName\}/g)).toHaveLength(2);
```

## Risk notes

- **Slice 01 ordering.** `depends_on: ["01-funcao-optimistic"]`. Both slices touch `SalesOpsApp.tsx` and the batch runs serial on `master`, so no worktree conflict. If slice 01 slips, slice 05 is still correct and its tests still pass - the dependency exists so the executor verifies point 1 of the safety argument against slice 01's actual code, not because the code needs it.
- **`allocatableFuncoes` is now non-trivial.** Three call sites, all inside the wizard, all reading the merged list. Verify none of `5014` / `6715` / `6738` were left pointing at a stale second list; there must be exactly one.
- **Buffer lifetime.** `SaleWizardDialogBody`'s `key` is `editSale?.id ?? 'create'` (`4952`) and deliberately excludes bootstrap rows, so a mid-wizard refetch does not remount and does not drop `createdFuncoes`. Once the refetch lands, the dedupe in E3 keeps the row from appearing twice.
- **Non-admin operator.** The `Nova proposta` button (`1059`) is in the sidebar and not role-gated, so a seller-only operator can reach the wizard. A create attempt would 403, `createFuncaoByName` catches and returns `null`, and the row is left untouched with no message. That is the documented behaviour of every inline create in this app (`4517-4522`), so it is accepted here rather than newly solved.
- **Scope creep guard.** Do not add a create row to `ProductDialogBody`'s `Custos padrão por função` picker (`3889`) or to the vendedor / finder pickers. `CLAUDE.md` excludes both on purpose and E6 must not weaken those clauses.
- **Verification.** `pnpm run lint`, `pnpm run type-check`, `pnpm test`. The `no-restricted-syntax` picker ban is untouched by this slice.
