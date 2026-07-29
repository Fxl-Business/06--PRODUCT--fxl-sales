---
id: 09-pessoas-funcoes-web
milestone: v2.3.0
status: todo
depends_on: [05-pessoas-funcoes-api, 06-combobox-adoption]
files_modified:
  - apps/web/src/sales-ops/navigation.ts
  - apps/web/src/sales-ops/types.ts
  - apps/web/src/sales-ops/api.ts
  - apps/web/src/sales-ops/hooks.ts
  - apps/web/src/sales-ops/optimistic.ts
  - apps/web/src/sales-ops/SalesOpsApp.tsx
  - apps/web/src/sales-ops/__tests__/pessoas-funcoes-view.test.tsx
  - apps/web/src/sales-ops/__tests__/navigation.test.ts
  - apps/web/src/sales-ops/__tests__/routing.test.tsx
  - apps/web/src/sales-ops/__tests__/optimistic.test.ts
  - apps/web/src/sales-ops/__tests__/cadastros-refresh.test.tsx
  - apps/web/src/sales-ops/__tests__/areas-view.test.tsx
  - apps/web/src/sales-ops/__tests__/calculations.test.ts
  - apps/web/src/sales-ops/__tests__/sales-view.test.tsx
  - apps/web/src/sales-ops/__tests__/sales-transition-actions.test.tsx
  - apps/web/src/sales-ops/__tests__/sale-wizard-commission-defaults.test.tsx
  - apps/web/src/sales-ops/__tests__/sale-wizard-custom-item-labels.test.tsx
  - apps/web/src/sales-ops/__tests__/sale-wizard-edit.test.tsx
  - apps/web/src/sales-ops/__tests__/sale-wizard-free-items.test.tsx
  - apps/web/src/sales-ops/__tests__/sale-wizard-payment-plan.test.tsx
  - CLAUDE.md
acceptance: "Given an admin whose org carries the two system funções Vendedor and Finder plus a custom função Designer, when they open /cadastros/pessoas, create the pessoa Sig with the funções Vendedor and Designer, and then load the bookmarked legacy URL /cadastros/vendedores, then Sig appears in the Pessoas table with a Vendedor badge and a Designer badge, Sig is offered as a vendedor in the proposta wizard and as a prestador in the professionals picker, /cadastros/vendedores is rewritten to /cadastros/pessoas, /cadastros/funcoes offers no edit affordance for Vendedor or Finder, and /meus-dados/vendedores still renders the read-only Meu painel for a seller."
---

# 09-pessoas-funcoes-web - Pessoas and Funções as first-class Cadastros

## Goal

Replace the two special-cased `cadastros/vendedores` and `cadastros/finders` screens with one `cadastros/pessoas` cadastro plus one `cadastros/funcoes` cadastro, so an org registers people once and tags each of them with an open set of funções instead of three hardcoded booleans.
`vendedor` and `finder` stop being screens and become immutable system funções, while dynamic funções such as Designer, Desenvolvedor, Tester and P.O. become org-configurable rows that the proposta professionals picker draws from.
This is the slice that flips the web off the three legacy boolean mirrors that slice 05 deliberately kept alive: after this slice, `isSeller`, `isFinder` and `isCollaborator` are absent from the web type, so `pnpm run type-check` is the guard proving no web code reads a deprecated mirror.
The `meus-dados` performance panels, the tático dashboard and all four `meus-dados` routes keep working unchanged.

## Current state

Anchors are as of commit `b60fd2f`; match on the quoted code, never on the line number alone.
Slices 01, 02, 03 and 06 land before this one, so the anchors in `hooks.ts` and in the dialog and picker layers will have moved; the reconciliation notes below say exactly how.

- `apps/web/src/sales-ops/navigation.ts:16-25` holds the `SalesOpsView` union (`dashboard`, `vendas`, `vendedores`, `finders`, `comissoes`, `produtos`, `areas`, `clientes`, `geral`).
- `apps/web/src/sales-ops/navigation.ts:58-65` is the `cadastros` nav array with hardcoded pt-BR labels, currently ending `vendedores`, `finders`, `geral`.
- `apps/web/src/sales-ops/navigation.ts:67-75` are `meusDadosSeller` and `meusDadosFinder`, which reuse the view ids `vendedores` and `finders` under the label `Meu painel`.
- `apps/web/src/sales-ops/navigation.ts:88-98` is `getVisibleWorkspaces`, driven purely by `AppRole`. It is not changed by this slice.
- `apps/web/src/sales-ops/navigation.ts:145-161` is `resolveSalesOpsRoute`. It accepts a view only when that view appears in `getSalesOpsNavigation(workspace, roles)`, otherwise it falls back to `getDefaultSalesOpsRoute(roles)` with `redirect: true`.
- `apps/web/src/sales-ops/navigation.ts:163-173` is `workspaceForView`, which falls back to the default workspace when no visible workspace lists the view.
- `apps/web/src/sales-ops/SalesOpsApp.tsx:161-166` is `ModalState`, whose `person` variant carries `roleHint: 'seller' | 'finder' | 'collaborator'`.
- `apps/web/src/sales-ops/SalesOpsApp.tsx:172-215` is `titleForView`, a total `Record<SalesOpsView, ...>` map.
- `apps/web/src/sales-ops/SalesOpsApp.tsx:287-310` are `salesForPerson` and `personMetrics`, both keyed on a `mode: 'seller' | 'finder'` string, not on the booleans.
- `apps/web/src/sales-ops/SalesOpsApp.tsx:547-555` are `canManagePeople` and `personModalMatchesRoute`, both keyed on `view === 'vendedores' || view === 'finders'` and on `modal.roleHint`.
- `apps/web/src/sales-ops/SalesOpsApp.tsx:557-573` is the `mountedRef` plus `queueMicrotask` effect that clears a person modal stranded by a route change.
- `apps/web/src/sales-ops/SalesOpsApp.tsx:581-594` are `setWorkspace` and `go`, which both clear a `person` modal on navigation.
- `apps/web/src/sales-ops/SalesOpsApp.tsx:596-635` are `runHeaderAction` and the `headerAction` ternary chain, which produce `Novo vendedor` and `Novo finder`.
- `apps/web/src/sales-ops/SalesOpsApp.tsx:1043-1064` renders the SAME `PeopleView` component for both the `vendedores` and the `finders` views, differing only by `mode` and by whether `onEdit` is supplied. There is no separate `SellersView` or `FindersView`; the "two screens" are one component with a mode prop.
- `apps/web/src/sales-ops/SalesOpsApp.tsx:1815-1890` is `PeopleView`, whose only role logic is the single filter at `:1824`.
- `apps/web/src/sales-ops/SalesOpsApp.tsx:2139-2200` is `AreasView` and `:3294-3368` is `AreaDialog` plus `AreaDialogBody`. Áreas is the house pattern for a simple org-configurable cadastro and is the model for both new views.
- `apps/web/src/sales-ops/SalesOpsApp.tsx:3370-3470` are `PersonDialog` and `PersonDialogBody`, with the status field at `:3446` and three `RoleToggle` calls at `:3452-3454`.
- `apps/web/src/sales-ops/SalesOpsApp.tsx:3472-3493` is `RoleToggle`, whose only consumer is `PersonDialogBody`.
- `apps/web/src/sales-ops/SalesOpsApp.tsx:3668-3679` are the wizard `sellers`, `finders` and `collaborators` memos.
- `apps/web/src/sales-ops/types.ts:6-17` is `SalesOpsPerson` with `isSeller`, `isFinder`, `isCollaborator`; `:189` is `people` inside `SalesOpsBootstrap`.
- `apps/web/src/sales-ops/api.ts:17-20` is `SavePersonPayload`, currently `Omit<Partial<SalesOpsPerson>, ...>`; `:68-74` is `salesOpsApi.savePerson`; `:89-95` is `saveArea`, the POST/PATCH template to copy.

There are exactly five live web call sites reading the booleans: `SalesOpsApp.tsx:1101` (`isCollaborator`), `:1824` (`isSeller` / `isFinder`), `:3401-3404` plus `:3416-3418` and `:3452-3454` (`PersonDialogBody`), `:3669` (`isSeller`), `:3673` (`isFinder`) and `:3677` (`isCollaborator`).

## Backend contract consumed

From `nexo/plans/batch-01K9C0FXA7RQ8VZTN3KDM6WS4E/05-pessoas-funcoes-api.md`, read and reconciled.

```ts
type FuncaoResponse = {
  id: string;
  orgId: string;
  name: string;               // pt-BR label: 'Vendedor', 'Finder', 'Desenvolvedor'
  slug: string;               // 'vendedor' | 'finder' | slugified name
  isSystem: boolean;          // true ONLY for vendedor and finder
  status: 'active' | 'archived';
  createdAt: string;
  updatedAt: string | null;
};

type PersonResponse = {
  id: string;
  orgId: string;
  displayName: string;
  contactEmail: string | null;
  status: 'active' | 'inactive';
  funcaoIds: string[];
  funcoes: Array<Pick<FuncaoResponse, 'id' | 'name' | 'slug' | 'isSystem'>>;
  isSeller: boolean;          // @deprecated derived mirror, still on the wire
  isFinder: boolean;          // @deprecated derived mirror
  isCollaborator: boolean;    // @deprecated derived mirror
  createdAt: string;
  updatedAt: string | null;
};
```

Load-bearing facts taken from slice 05 and not to be re-derived:

- The immutability flag is **`isSystem: boolean`**, not a `kind` discriminator. Only `vendedor` and `finder` can ever carry it, enforced by a DB check constraint.
- The three booleans are **kept** as derived deprecated mirrors, recomputed server-side on every person write. The join table is the source of truth. `is_collaborator` is derived as "carries at least one função with `is_system = false`".
- **`Prestador` is a non-system função**, seeded only for orgs that already had collaborators. It can be renamed and archived like any other custom função, so web code must never special-case its slug.
- `funcoes` on a person is ordered `isSystem DESC, name ASC`, so `Vendedor` / `Finder` lead deterministically. The web does not re-sort it.
- `GET /funcoes` is open to any authenticated org member; `POST /funcoes` and `PATCH /funcoes/:id` are `requireAdmin`.
- `POST /funcoes` takes `{name, status?}` only. `slug` and `isSystem` are never accepted from the body.
- `PATCH /funcoes/:id` returns `409 { error: 'conflict', reason: 'funcao_is_system' }` when the target is a system função and the patch touches `name` or `status`. System funções are fully immutable through the API: no rename, no archive, no delete.
- Other funções errors: `409 funcao_name_taken`, `409 funcao_slug_taken`, `400 reserved_funcao_slug`.
- **There is no DELETE verb anywhere in `salesOpsRouter`** and slice 05 adds none. Removal is `PATCH { status: 'archived' }` for a função and `PATCH { status: 'inactive' }` for a pessoa, matching áreas and produtos.
- `POST /people` and `PATCH /people/:id` accept `funcaoIds: string[]`. When present it is **authoritative** and the legacy booleans in the body are ignored entirely. It is a full set replacement, never a merge. An empty array is rejected with `400 validation_error / funcao_required`; an unknown or foreign id with `400 validation_error / unknown_funcao`. Assignment management deliberately has no sub-resource endpoints.
- `GET /bootstrap` gains `funcoes: FuncaoResponse[]` and `personFuncoes: Array<{id, orgId, personId, funcaoId, createdAt}>`, and `people` is enriched with `funcaoIds` + `funcoes`.

## Route table

| Route | Before | After | Renders | Old URL behaviour |
| --- | --- | --- | --- | --- |
| `/tatico/dashboard` | valid, team | unchanged | `DashboardView` | n/a |
| `/operacional/vendas` | valid, team | unchanged | `SalesView` | n/a |
| `/operacional/comissoes` | valid, team | unchanged | `CommissionsView` | n/a |
| `/cadastros/produtos` | valid, team | unchanged, stays first in the array so it remains the Cadastros default | `ProductsView` | n/a |
| `/cadastros/areas` | valid, team | unchanged | `AreasView` | n/a |
| `/cadastros/clientes` | valid, team | unchanged | `ClientsView` | n/a |
| `/cadastros/pessoas` | does not exist | new, team | `PessoasView`, admin-only create and edit | n/a |
| `/cadastros/funcoes` | does not exist | new, team | `FuncoesView`, admin-only create and edit, no edit affordance for system funções | n/a |
| `/cadastros/vendedores` | valid, team, `PeopleView mode="seller"` with `onEdit` | removed from the `cadastros` nav array | nothing | aliased to `pessoas` inside `resolveSalesOpsRoute`, which returns `path: '/cadastros/pessoas'` with `redirect: true`, so `SalesOpsApp` rewrites the URL through the existing `<Navigate replace>` at `:647-649` |
| `/cadastros/finders` | valid, team, `PeopleView mode="finder"` with `onEdit` | removed from the `cadastros` nav array | nothing | same alias to `/cadastros/pessoas` |
| `/cadastros/geral` | valid, team | unchanged | `SettingsView` | n/a |
| `/meus-dados/vendedores` | valid, seller, `PeopleView mode="seller"` read-only | **unchanged**, still the seller `Meu painel` | `MeuPainelView mode="seller"`, read-only | n/a |
| `/meus-dados/comissoes` | valid, seller | unchanged | `CommissionsView` | n/a |
| `/meus-dados/finders` | valid, finder, read-only | **unchanged**, still the finder `Meu painel` | `MeuPainelView mode="finder"`, read-only | n/a |
| `/meus-dados/vendas` | valid, finder | unchanged | `SalesView` | n/a |
| `/tatico/vendedores`, `/tatico/finders` | invalid, redirect to `/tatico/dashboard` | unchanged; the alias is cadastros-scoped so it does not fire here | n/a | unchanged |
| `/admin/*`, `/finder/*`, `/seller/*`, `/no-role` | static legacy trees | **untouched** | unchanged | n/a |

Justification for the alias rather than a hard fallback to the role default: `/cadastros/vendedores` has a real successor screen, so dropping the user on `/tatico/dashboard` would lose their intent, and CLAUDE.md makes the URL the single source of truth, so the legacy URL must be rewritten rather than silently served.
The alias is scoped to `params.workspace === 'cadastros'`, which is what keeps `/meus-dados/vendedores` and `/meus-dados/finders` working; without that guard the alias would hijack the seller and finder `Meu painel` routes and break `routing.test.tsx:406-422`.
`vendedores` and `finders` stay in the `SalesOpsView` union and in `titleForView` precisely because `meus-dados` still uses those two ids.
A seller or finder hitting `/cadastros/vendedores` is unaffected by the alias, because `getVisibleWorkspaces` rejects the `cadastros` workspace first and the resolution falls through to `/meus-dados/vendedores` or `/meus-dados/finders` exactly as today.

## Component plan

### Shared função predicates (new, insert directly above `salesForPerson` at `:287`)

One adaptation point for the whole file, exported for the oracle test.

```ts
export const FUNCAO_SLUG_VENDEDOR = 'vendedor';
export const FUNCAO_SLUG_FINDER = 'finder';

export function hasFuncao(person: SalesOpsPerson, slug: string): boolean {
  return person.funcoes.some((funcao) => funcao.slug === slug);
}

/**
 * Prestadores: the professionals-cost population. Mirrors exactly how the API
 * derives the deprecated `is_collaborator` column (at least one non-system
 * função), so the web and the server never disagree on who is selectable.
 * Deliberately NOT keyed on the `prestador` slug: that função is non-system and
 * an org may rename or archive it.
 */
export function collaboratorPool(people: readonly SalesOpsPerson[]): SalesOpsPerson[] {
  return people.filter(
    (person) => person.status === 'active' && person.funcoes.some((funcao) => !funcao.isSystem),
  );
}
```

`collaboratorPool` replaces the `isCollaborator` filters at `:1101` and `:3677`.
`hasFuncao(person, FUNCAO_SLUG_VENDEDOR)` replaces `person.isSeller` at `:1824` and `:3669`; the finder form replaces `:1824` and `:3673`.
The `person.status === 'active'` filters already present at `:3669-3677` are kept verbatim on the seller and finder memos.

### `MeuPainelView` (renamed from `PeopleView`, `:1815-1890`)

`PeopleView` survives, because `meus-dados` still needs it, but it is renamed to `MeuPainelView` so it can never be confused with the new `PessoasView`, and its `onEdit` prop is **deleted**.
The panel becomes structurally read-only: every card renders as `<article>`, the `<button>` branch at `:1876-1886` disappears, and the `if (!onEdit)` split collapses.
This makes the CLAUDE.md rule "Meus dados reuses the same people panels in read-only mode" true in the type signature rather than only in the wiring.

```tsx
function MeuPainelView({
  bootstrap,
  mode,
}: {
  bootstrap: SalesOpsBootstrap;
  mode: 'seller' | 'finder';
}) {
  const people = bootstrap.people.filter((person) =>
    hasFuncao(person, mode === 'seller' ? FUNCAO_SLUG_VENDEDOR : FUNCAO_SLUG_FINDER),
  );
  // empty panel copy and the metric card grid stay byte-identical, minus the onEdit branch
}
```

Its filter semantics are otherwise preserved exactly: it still renders **every** matching pessoa in the org, not only the signed-in person.
That is a real pre-existing gap that slice 05 explicitly refused to close, and this slice must not close it either. See `## Risks`.

### `PessoasView` (new, insert after `AreasView` at `:2200`, exported for tests)

A new component rather than a widened `MeuPainelView`, because the two surfaces answer different questions: one is a personal performance card grid, the other is a cadastro table.
Sharing one component would force a mode matrix over both layout and permissions, which is exactly the special-casing this slice removes.

Modeled cell for cell on `AreasView`.
Columns: `Nome`, `E-mail`, `Funções`, `Status`, `Ações`.

- `Nome` renders `person.displayName` in `px-4 py-3 text-sm font-semibold`.
- `E-mail` renders `person.contactEmail` in `tableCellClass`, or the muted `-` fallback `ProductsView` uses for a null área.
- `Funções` renders one `<Badge>` per entry of `person.funcoes` using `funcao.name`, inside a `flex flex-wrap justify-center gap-1.5` cell. A system função gets `bg-[#fdf0cf] text-[#7a5a12]` (the accent pair the deleted `RoleToggle` used); a custom one gets `bg-[#eeeef1] text-[#6a6a72]`. A person with no assignment renders the muted `-`.
- `Status` renders a `<Badge>` reading `Ativo` (`bg-[#c9e7cf] text-[#1f7d43]`) or `Inativo` (`bg-[#eeeef1] text-[#6a6a72]`), keeping the masculine pt-BR forms `PersonDialogBody` already uses.
- `Ações` renders the standard `iconButtonClass` `Edit3` button with `aria-label={`Editar ${person.displayName}`}`, preserving the accessible name `routing.test.tsx` already queries.

`onEdit` is a required prop, because the view is only ever mounted on the admin-gated `cadastros/pessoas` route.
Empty panel: title `Nenhuma pessoa cadastrada`, text `Cadastre pessoas e atribua funções para usá-las como vendedor, finder ou prestador nas propostas.`
No id, `orgId` or `funcaoId` is ever rendered, satisfying the CLAUDE.md UI-identifier rule; no muted-monospace raw fallback is needed anywhere in this view.

### `FuncoesView` (new, insert after `PessoasView`, exported for tests)

Modeled cell for cell on `AreasView`.
Columns: `Nome`, `Tipo`, `Status`, `Nº pessoas`, `Ações`.

- `Tipo` renders a `<Badge>` reading `Predefinida` when `funcao.isSystem`, else `Personalizada`, with the same two class pairs as the `Funções` cell above.
- `Status` renders `Ativa` / `Arquivada` with the exact `AreasView` classes, feminine to agree with "função".
- `Nº pessoas` counts `bootstrap.people.filter((person) => person.funcoes.some((f) => f.id === funcao.id)).length`, mirroring the `Nº produtos` cell in `AreasView`. Note the join key is `funcao.id`, because a person's nested `funcoes` entries carry `id`, not `funcaoId`.
- `Ações` for a custom função renders the standard `Edit3` button with `aria-label={`Editar ${funcao.name}`}`. For a system função it renders a **disabled** button carrying the lucide `Lock` icon, with `aria-label="Função predefinida do app"` and the same `title`, styled `${iconButtonClass} disabled:cursor-not-allowed disabled:opacity-50`.

That disabled lock is the protection mechanism, and it mirrors the backend exactly: slice 05 returns `409 funcao_is_system` for any rename or archive of a system função, so the UI must never offer the action rather than offering it and failing.
There is no delete affordance anywhere in the funções surface, matching both the áreas precedent and the fact that `salesOpsRouter` has no DELETE verb.
Empty panel: title `Nenhuma função cadastrada`, text `Vendedor e finder são funções predefinidas do app; crie funções personalizadas para prestadores como designer, desenvolvedor ou P.O.`
This state is unreachable once slice 05's seed has run and exists only for the pre-bootstrap and degraded cases.

### `FuncaoDialog` plus `FuncaoDialogBody` (new, insert after `AreaDialogBody` at `:3368`, `FuncaoDialog` exported for tests)

A structural copy of `AreaDialog` / `AreaDialogBody`, with four deltas.

- `DialogTitle` reads `Função`; `DialogDescription` reads `Função atribuível a uma pessoa e usada nos custos de uma proposta.`
- Remount key is `props.modal.funcao?.id ?? 'new-funcao'`.
- The status picker is the Combobox from slice 03 rather than `NativeSelect`, with `aria-label="Status da função"`, `options` `[{value:'active',label:'Ativa'},{value:'archived',label:'Arquivada'}]` and no `onCreate`.
- Defence in depth for the system case: `const isSystem = modal.funcao?.isSystem === true;` disables the `Nome` `Input`, disables the status Combobox, renders a muted hint reading `Função predefinida do app: o nome e o status não podem ser alterados.` and disables `Salvar`. `FuncoesView` never wires `onEdit` for a system row, so this path is unreachable in normal use and exists so a future mis-wire cannot produce a request the API will reject.

Payload: `onSave({ id: modal.funcao?.id, name: name.trim(), status })`.
`slug` and `isSystem` are never sent; slice 05 derives the slug server-side and always writes `isSystem: false` on create.
Outside-click dismissal needs no handling here: slice 02 fixes it once inside `DialogContent`, so every dialog in the app inherits it.

### `PersonDialogBody` rework (`:3388-3470`) and `RoleToggle` deletion (`:3472-3493`)

`RoleToggle` is deleted outright; `PersonDialogBody` is its only consumer.
Its `Check` and `UserRound` lucide imports stay, because `Check` is still used at `:761` and `UserRound` in `workspaceVisuals` at `:158`.

`ModalState`'s `person` variant loses `roleHint` and becomes `{ kind: 'person'; person?: SalesOpsPerson }`; a `{ kind: 'funcao'; funcao?: SalesOpsFuncao }` variant is added after the `area` variant.
`PersonDialog`'s remount key becomes `props.modal.person?.id ?? 'new-person'`, matching `AreaDialog`'s `'new-area'`.

`PersonDialogBody` gains two props: `funcoes: SalesOpsFuncao[]` (the org catalogue from bootstrap) and `onCreateFuncao?: (name: string) => Promise<SalesOpsFuncao>`.

```ts
const [displayName, setDisplayName] = useState(modal.person?.displayName ?? '');
const [contactEmail, setContactEmail] = useState(modal.person?.contactEmail ?? '');
const [status, setStatus] = useState<'active' | 'inactive'>(modal.person?.status ?? 'active');
const [assignedIds, setAssignedIds] = useState<string[]>(
  () => modal.person?.funcoes.map((funcao) => funcao.id) ?? [],
);
const [pendingFuncaoId, setPendingFuncaoId] = useState('');
```

Because the slice 03 Combobox is single-select, multi-assignment is add-and-remove rows, not a multi-select.
The `Funções` field renders, in order:

1. One row per entry of `assignedIds`, resolved against `funcoes`, showing the `funcao.name` plus a small `Predefinida` marker when `funcao.isSystem`, and a trailing remove button carrying the lucide `X` with `aria-label={`Remover função ${funcao.name}`}`. A system função is removable from a pessoa: immutability protects the função row itself, not the assignment.
2. A single Combobox plus an `Adicionar função` `SecondaryButton`. Options are the funções with `status === 'active'` not already in `assignedIds`, mapped to `{ value: funcao.id, label: funcao.name }`.
3. When `assignedIds` is empty, a muted hint reading `Atribua ao menos uma função.`

An archived função that a pessoa already carries stays listed and removable but never reappears in the picker, mirroring the `selectableAreas` handling in `ProductDialogBody`.

Real slice 03 Combobox call shape, reconciled against `03-combobox-primitive.md`:

```tsx
<Combobox
  aria-label="Função da pessoa"
  entityGender="f"
  entityLabel="função"
  onChange={setPendingFuncaoId}
  onCreate={onCreateFuncao ? (query) => void handleCreateFuncao(query) : undefined}
  options={selectableFuncoes}
  placeholder="Selecione uma função"
  value={pendingFuncaoId}
/>
```

Three details that follow from the primitive's real API and must not be invented differently:
- the accessible-name prop is the hyphenated `'aria-label'`, not `ariaLabel`;
- `entityLabel="função"` with `entityGender="f"` is what makes the create row read `+ Criar nova função "P.O."`;
- `onCreate` is `(query: string) => void`, synchronous and fire-and-forget, so the async work is wrapped:

```ts
async function handleCreateFuncao(query: string) {
  if (!onCreateFuncao) return;
  const created = await onCreateFuncao(query.trim());
  setAssignedIds((current) => (current.includes(created.id) ? current : [...current, created.id]));
  setPendingFuncaoId('');
}
```

Submit:

```ts
onSave({
  id: modal.person?.id,
  displayName: displayName.trim(),
  contactEmail: contactEmail.trim() || undefined,
  status,
  funcaoIds: assignedIds,
});
```

`Salvar` is `disabled={saving || !displayName.trim() || assignedIds.length === 0}`, which preserves today's rule at `:3459` and mirrors the API's `funcao_required` guard so the dialog never sends a request the server will reject.
The status field becomes the same Combobox with `aria-label="Status da pessoa"` and options `Ativo` / `Inativo`.
`DialogDescription` changes from `Vendedores, finders e prestadores usam o mesmo cadastro.` to `Cadastro único de pessoas: atribua as funções que ela exerce.`

### `SalesOpsApp` wiring

- `canManagePeople` becomes `workspace === 'cadastros' && view === 'pessoas' && profile.roles.includes('admin')`, with a sibling `canManageFuncoes` on `view === 'funcoes'`. Both keep the redundant `admin` check even though `getVisibleWorkspaces` already gates `cadastros`, matching the existing belt-and-braces at `:550`.
- `personModalMatchesRoute` becomes `canManagePeople && modal?.kind === 'person'`, dropping the `roleHint` discrimination that only existed because there were two people pages.
- The `mountedRef` / `queueMicrotask` effect at `:557-573`, the `setModal` clears in `setWorkspace` at `:583` and `go` at `:589`, and the `personModalMatchesRoute &&` condition on the `PersonDialog` mount at `:1126` all stay exactly as they are. Those three mechanisms are what `routing.test.tsx:425-547` pins, and they keep working unchanged against the single `pessoas` route.
- The new `funcao` modal is deliberately **not** route-guarded, matching the existing `product`, `client` and `area` modals. Adding a second guard mechanism is out of scope; the asymmetry is recorded in `## Refactor`.
- `runHeaderAction` replaces its two `roleHint` branches with `if (canManagePeople) { setModal({ kind: 'person' }); return; }` and `if (canManageFuncoes) { setModal({ kind: 'funcao' }); return; }`.
- The `headerAction` chain becomes `geral` -> `null`, `produtos` -> `Novo produto`, `areas` -> `Nova área`, `clientes` -> `Novo cliente`, `pessoas` -> `Nova pessoa` when `canManagePeople` else `null`, `funcoes` -> `Nova função` when `canManageFuncoes` else `null`, `vendedores` or `finders` -> `null`, otherwise `Nova proposta`.
- `titleForView` gains `pessoas: { title: 'Pessoas', subtitle: 'Cadastro único de pessoas e das funções atribuídas a cada uma' }` and `funcoes: { title: 'Funções', subtitle: 'Funções predefinidas do app e funções personalizadas da organização' }`. The `vendedores` and `finders` entries drop their now-dead non-personal branch and become unconditional `title: 'Meu painel'`, keeping their existing subtitles. `personal` stays in use for `vendas` and `comissoes`.
- The render switch replaces the two `PeopleView` blocks at `:1043-1064` with two `MeuPainelView` blocks passing only `bootstrap` and `mode`, and adds a `pessoas` block rendering `PessoasView` and a `funcoes` block rendering `FuncoesView`.
- A `<FuncaoDialog>` mount is added after the `<AreaDialog>` mount, wired to `saveFuncao.mutate(payload, { onSuccess: () => setModal(null) })`.
- The `<PersonDialog>` mount gains `funcoes={bootstrap.funcoes}` and `onCreateFuncao={async (name) => (await saveFuncao.mutateAsync({ name })).funcao}`.
- `ProductDialog`'s `collaborators` prop at `:1101` becomes `collaboratorPool(bootstrap.people)`, dropping the now-absent `isCollaborator` read.

### Data layer, reconciled against slice 01

Slice 01 rewrites `hooks.ts`: it deletes the local `salesOpsKeys` and `useInvalidateSalesOps`, hoists the bootstrap `select` to a stable module-level function, converts all nine mutations to `useAppMutation` with a required non-empty `invalidates` tuple, adds `apps/web/src/sales-ops/optimistic.ts`, and adds an ESLint rule banning direct `useMutation` imports outside the wrapper module.
This slice must therefore not write `useMutation` or reintroduce `useInvalidateSalesOps`.

- `hooks.ts` gains `useSaveSalesOpsFuncao` written as `useAppMutation` with `invalidates: [queryKeys.salesOps.all]`, identical in shape to whatever `useSaveSalesOpsArea` looks like at execution time. No optimistic write for funções: the server derives `slug` from `name`, so the client cannot compute the row, and that reason goes in the one-line comment slice 01 requires on every non-optimistic hook.
- The hoisted `select` gains `funcoes: Array.isArray(data.funcoes) ? data.funcoes : [],` after the `areas` line. `personFuncoes` is deliberately **not** surfaced: `people[].funcoes` already carries every assignment the UI needs, and a second denormalised copy in the web type would be a drift hazard.
- `salesOpsKeys` is not touched. If slice 01 has already deleted it, use `queryKeys.salesOps`.
- `api.ts` gains, next to `SaveAreaPayload`:

  ```ts
  export type SaveFuncaoPayload = { id?: string; name: string; status?: 'active' | 'archived' };
  ```

  plus `salesOpsApi.saveFuncao`, a literal copy of `saveArea` against `/api/v1/sales-ops/funcoes`, returning `{ funcao: SalesOpsFuncao }`.
- `SavePersonPayload` is redefined explicitly, because it can no longer be derived from `Partial<SalesOpsPerson>`:

  ```ts
  export type SavePersonPayload = {
    id?: string;
    displayName: string;
    contactEmail?: string;
    status?: 'active' | 'inactive';
    funcaoIds: string[];
  };
  ```

  The three legacy booleans are no longer sent. Slice 05 treats `funcaoIds` as authoritative and ignores body booleans, so this is the intended forward contract.
- `apps/web/src/sales-ops/optimistic.ts`: `optimisticPerson` currently builds `isSeller`, `isFinder` and `isCollaborator` from `payload.<flag> ?? false`. Those three lines are replaced by one that resolves the assignment list from the cached catalogue:

  ```ts
  funcoes: (payload.funcaoIds ?? []).flatMap((id) => {
    const funcao = previous.funcoes.find((candidate) => candidate.id === id);
    return funcao ? [{ id: funcao.id, name: funcao.name, slug: funcao.slug, isSystem: funcao.isSystem }] : [];
  }),
  ```

  `funcaoIds: payload.funcaoIds ?? []` is set alongside it. Everything else in `optimisticPerson` (id minting, `orgId` copy, `createdAt`, the `byLabel` re-sort, carrying other collections by reference) is untouched. The `funcoes` array is carried by reference like every other untouched collection.
- `types.ts` adds:

  ```ts
  export type SalesOpsFuncao = {
    id: string;
    orgId: string;
    name: string;
    slug: string;
    isSystem: boolean;
    status: 'active' | 'archived';
    createdAt: string;
    updatedAt: string | null;
  };

  export type SalesOpsPersonFuncao = Pick<SalesOpsFuncao, 'id' | 'name' | 'slug' | 'isSystem'>;
  ```

  `SalesOpsPerson` **drops** `isSeller`, `isFinder` and `isCollaborator` and gains `funcaoIds: string[]` and `funcoes: SalesOpsPersonFuncao[]`.
  Dropping them is the point of the slice: the API still puts them on the wire as deprecated mirrors, and structural typing simply ignores the extra keys, exactly as it already does for every other unmodelled response field. Removing them from the type makes `pnpm run type-check` the mechanical proof that no web code reads a deprecated mirror, which no lint rule or review could guarantee as cheaply.
  `SalesOpsBootstrap` gains `funcoes: SalesOpsFuncao[]` after `areas`.
- `emptyBootstrap` in `SalesOpsApp.tsx:122-133` gains `funcoes: []` after `areas: []`.

## CLAUDE.md edits

All edits are inside the `## Sales Ops Routing` section plus one new section after it.
Each full sentence stays on its own physical line, matching the file's existing style.

**1. Line 43, replace the canonical routes bullet.**

Before:

```markdown
- Canonical Sales Ops routes are `tatico/dashboard`, `operacional/vendas|comissoes`, `cadastros/produtos|areas|clientes|vendedores|finders|geral`, and `meus-dados/vendedores|comissoes|finders|vendas`.
```

After:

```markdown
- Canonical Sales Ops routes are `tatico/dashboard`, `operacional/vendas|comissoes`, `cadastros/produtos|areas|clientes|pessoas|funcoes|geral`, and `meus-dados/vendedores|comissoes|finders|vendas`.
- `cadastros/vendedores` and `cadastros/finders` no longer exist; `resolveSalesOpsRoute` aliases both legacy views to `pessoas` and returns `redirect: true` so the URL is rewritten to `/cadastros/pessoas`.
- That alias is scoped to `params.workspace === 'cadastros'`. The `meus-dados/vendedores` and `meus-dados/finders` views keep those exact ids and must never be aliased.
```

**2. Line 48, append one bullet directly after the existing `meus-dados` reuse bullet, leaving that bullet unchanged.**

```markdown
- `MeuPainelView` (formerly `PeopleView`) in `apps/web/src/sales-ops/SalesOpsApp.tsx` is the read-only `meus-dados` performance panel behind the `vendedores` and `finders` views and takes no `onEdit` prop at all. People cadastro editing lives only in `PessoasView` under `cadastros/pessoas`.
```

**3. Line 49, replace the admin-only controls bullet.**

Before:

```markdown
- Seller and finder create or edit controls are admin-only and live under Cadastros; Meus dados reuses the same people panels in read-only mode.
```

After:

```markdown
- Pessoa and função create or edit controls are admin-only and live under Cadastros (`cadastros/pessoas` and `cadastros/funcoes`); Meus dados reuses the same people panels in read-only mode.
```

**4. Insert a new section immediately after the `## Sales Ops Routing` section, before `## Propostas domain`.**

```markdown
## Pessoas e Funções

- A Pessoa is the single people cadastro; a Função is an org-scoped role assigned to a pessoa. They are separate entities with separate Cadastros screens.
- `vendedor` and `finder` are the only system funções (`isSystem: true`), seeded per org. They cannot be renamed or archived, the API answers `409 funcao_is_system`, and the UI therefore exposes no edit affordance for them at all.
- Every other função is org-created and dynamic (designer, desenvolvedor, tester, P.O.) and is what the proposta professional-cost rows draw from. `Prestador` is one of these, not a system função, so never special-case its slug.
- A função is never deleted, only archived via `status`, exactly like an área. `salesOpsRouter` has no DELETE verb. An archived função stays visible on the people who already carry it but disappears from the assignment picker.
- The `sales_ops_people` columns `is_seller`, `is_finder` and `is_collaborator` are deprecated derived mirrors that the API still returns but the web type no longer declares. Web code goes through `hasFuncao` and `collaboratorPool` in `apps/web/src/sales-ops/SalesOpsApp.tsx`, never through a per-call-site slug comparison and never through a mirror.
- `collaboratorPool` is "any active pessoa carrying at least one non-system função", which is exactly how the API derives `is_collaborator`.
- Person writes send `funcaoIds` as a full set replacement; the API rejects an empty set with `funcao_required`. There are no assignment sub-resource endpoints.
- Hub `AppRole` values (`admin`, `seller`, `finder`) and `roleSummaryLabel` are unrelated to funções. Workspace visibility keeps deriving purely from `profile.roles`, never from a função assignment.
```

## Test fallout

### `apps/web/src/sales-ops/__tests__/navigation.test.ts`

| Anchor | Current assertion | Required rewrite |
| --- | --- | --- |
| `:53-60` | cadastros ids `['produtos','areas','clientes','vendedores','finders','geral']` | `['produtos','areas','clientes','pessoas','funcoes','geral']`, plus a new labels assertion `['Produtos','Áreas','Clientes','Pessoas','Funções','Geral']` |
| `:63-86` | meus-dados ids and labels | unchanged, and this is the regression guard proving the meus-dados ids survived |
| `:99-116` | `getDefaultSalesOpsRoute(team, 'cadastros')` -> `produtos` | unchanged, `produtos` stays first in the array |
| `:134-138` | `resolveSalesOpsRoute({cadastros, vendedores}, team)` -> `redirect: false` | replace the block with the same shape for `pessoas` -> `{route:{cadastros,pessoas}, path:'/cadastros/pessoas', redirect:false}` |
| `:139-143` | `resolveSalesOpsRoute({cadastros, finders}, team)` -> `redirect: false` | replace with the `funcoes` block -> `{route:{cadastros,funcoes}, path:'/cadastros/funcoes', redirect:false}` |
| `:151-202` | redirect cases | add the two alias cases: `{cadastros, vendedores}` and `{cadastros, finders}` for `team`, both -> `{route:{cadastros,pessoas}, path:'/cadastros/pessoas', redirect:true}`; add `{cadastros, pessoas}` for `seller` -> `/meus-dados/vendedores` with `redirect:true` |
| `:167`, `:172`, `:177`, `:182` | `meus-dados/vendedores` for team, `meus-dados/finders` for seller, empty params, unknown workspace | unchanged |
| `:187-196` | `{tatico, vendedores}` and `{tatico, finders}` for team -> `/tatico/dashboard`, `redirect: true` | unchanged, and these prove the alias did not leak outside `cadastros` |
| `:212` | `workspaceForView('vendedores', team)` -> `'cadastros'` | delete; no workspace visible to a team-only user lists `vendedores`, so the value degrades to the meaningless default fallback |
| `:213` | `workspaceForView('finders', team)` -> `'cadastros'` | delete, same reason |
| `:214` | `workspaceForView('vendedores', ['admin','seller'])` -> `'cadastros'` | change to `'meus-dados'`; that is the real new behaviour and is worth pinning |
| `:204-217` | view-to-workspace map | add `workspaceForView('pessoas', team)` -> `'cadastros'` and `workspaceForView('funcoes', team)` -> `'cadastros'` |
| `:20-27`, `:29-41`, `:43-52`, `:88-97`, `:219-224` | workspace catalogue, `getVisibleWorkspaces`, tactical and operational nav, defaults, path builder | unchanged. `getVisibleWorkspaces` must stay byte-identical: visibility remains purely `AppRole`-driven |

### `apps/web/src/sales-ops/__tests__/routing.test.tsx`

| Anchor | Current assertion | Required rewrite |
| --- | --- | --- |
| `:44-55` | `personFixture` with `isSeller: true, isFinder: true, isCollaborator: false` | replace the three booleans with `funcaoIds` and `funcoes: [{id: vendedorFuncao.id, name:'Vendedor', slug:'vendedor', isSystem:true}, {id: finderFuncao.id, name:'Finder', slug:'finder', isSystem:true}]`, and add `vendedorFuncao` / `finderFuncao` `SalesOpsFuncao` fixtures |
| `:57-83` | `vi.mock('../hooks')` bootstrap `data` and nine mutation mocks | add `funcoes: [vendedorFuncao, finderFuncao]` to `data`, and add `useSaveSalesOpsFuncao: () => mutation`. Without the latter the component crashes on the new unconditional hook call. If slice 01 changed the mocked module surface, mirror whatever it left |
| `:255` | switching to Cadastros lands on `/cadastros/produtos` | unchanged |
| `:296-299` | `/cadastros/produtos` as `seller` -> `/meus-dados/vendedores`, heading `Meu painel` | unchanged |
| `:374` | test name `keeps people management in Cadastros and personal people panels read-only` | rename to `keeps pessoas management in Cadastros and personal panels read-only` |
| `:382-383` | `main` has no `button[aria-label="Vendedores"]` / `"Finders"` | retarget to `"Pessoas"` and `"Funções"`, keeping the intent that the cadastro nav never leaks into the tactical main region |
| `:384-385` | `buttonByTextOrNull('Novo vendedor')` and `('Novo finder')` are null | replace with `('Nova pessoa')` and `('Nova função')` |
| `:387-389` | `/tatico/vendedores` -> `/tatico/dashboard` | unchanged; the alias is cadastros-scoped |
| `:391-399` | `/cadastros/vendedores` stays put, heading `Vendedores`, `Novo vendedor` exists, edit opens the `Pessoa` dialog | rewrite to `expect(pathname()).toBe('/cadastros/pessoas')`, `expectHeading('Pessoas')`, `buttonByText('Nova pessoa')`, `buttonByAccessibleName('Editar Alex Silva')` non-null, click it, `h2` is `Pessoa` |
| `:400-404` | `/cadastros/finders` stays put, heading `Finders`, `Novo finder` exists | rewrite to `expect(pathname()).toBe('/cadastros/pessoas')` and `expectHeading('Pessoas')` |
| `:406-422` | the three personal-path cases | keep the paths, roles, `Meu painel` heading, the `0 propostas ganhas no período` text and the `article` assertions verbatim; swap the two button texts to `Nova pessoa` / `Nova função`. This block is the load-bearing proof that `meus-dados` survived |
| `:426-427` | `renderRoute('/cadastros/vendedores', ...)` then click `Novo vendedor` | `'/cadastros/pessoas'` and `Nova pessoa` |
| `:441-442` | click `aria-label="Vendedores"`, expect `/cadastros/vendedores` | click `aria-label="Pessoas"`, expect `/cadastros/pessoas` |
| `:445-459` | edit opens `Pessoa`, workspace switch to Meus dados clears it, personal card click does not open it | unchanged in intent and in assertions |
| `:462-465` | re-enter Cadastros, click `Vendedores`, expect no stale `h2` | click `Pessoas`, expect `/cadastros/pessoas` |
| `:468-481` | `does not restore a stale people dialog through browser history` | swap `/cadastros/vendedores` -> `/cadastros/pessoas` and `Novo vendedor` -> `Nova pessoa`; the assertion set is otherwise unchanged |
| `:483-511` | `closes route-specific people dialogs when history switches people pages` | the premise dies with the two-page split. Rewrite as `closes the pessoa dialog when history switches cadastros pages`: `renderHistory(['/cadastros/funcoes', '/cadastros/pessoas'], ['admin'])`, click `Nova pessoa`, assert `h2` is `Pessoa`; Back -> `/cadastros/funcoes` with `expectHeading('Funções')`, `h2` null, `Salvar` null; Forward -> `/cadastros/pessoas` with `h2` null. Only the pessoa dialog may be opened in this test, because the funcao dialog is intentionally ungated |
| `:513-547` | `irrevocably clears people dialogs during rapid browser history transitions` | swap `/cadastros/vendedores` -> `/cadastros/pessoas` and `Novo vendedor` -> `Nova pessoa`; the `queueMicrotask` spy mechanics are unchanged |
| `:241-372` | canonical routing, history restore, seller landing, viewing-level switcher removal, account menu, four workspaces, dashboard card | unchanged |

Note on the two dialog-open clicks: after slice 06 the status field inside `PersonDialogBody` is a Combobox, but every assertion above only reads `h2` textContent and the `Salvar` button, so none of them is affected by the picker swap.

### `apps/web/src/sales-ops/__tests__/optimistic.test.ts` (created by slice 01)

Whatever case slice 01 wrote for `optimisticPerson` asserts an optimistic row carrying `isSeller` / `isFinder` / `isCollaborator` derived from the payload flags.
Rewrite it to seed `previous.funcoes` with a system `Vendedor` and a custom `Designer`, pass `funcaoIds: [vendedor.id, designer.id]`, and assert the optimistic row carries `funcaoIds` in that order and a `funcoes` array of the two resolved `{id, name, slug, isSystem}` objects.
Add one case: an id absent from `previous.funcoes` is dropped from `funcoes` but retained in `funcaoIds`, so a stale cache cannot crash the render.

### `apps/web/src/sales-ops/__tests__/cadastros-refresh.test.tsx` (created by slice 01)

If it enumerates the cadastros mutations, add the funções case: submitting the `Função` dialog on `/cadastros/funcoes` makes the row appear with no manual reload.
If it only covers áreas and clientes, leave it alone; `useSaveSalesOpsFuncao` is non-optimistic and is already covered by the invalidation rail.

### `apps/web/src/sales-ops/__tests__/sale-wizard-ui-contract.test.ts`

Untouched.
It is a source-text test over `SalesOpsApp.tsx` and asserts only wizard copy.
Verify before finishing that none of its `toContain` strings sits inside deleted code and that no new string collides with one of its `not.toContain` entries: `Nova pessoa`, `Nova função`, `Pessoas` and `Funções` collide with none of `Fechamento da venda`, `Nova venda`, `Salvar incompleto`, `Confirmar venda`, `Passo {wizardStep} de 3` or `Salvar venda`.

### Fixture-only compile fixes

Add `funcoes: []` to the `SalesOpsBootstrap` literal in each of `areas-view.test.tsx:68-82`, `calculations.test.ts:85`, `calculations.test.ts:118`, `sales-view.test.tsx:151` and `sales-transition-actions.test.tsx:159`.

In each `SalesOpsPerson` literal, replace the three booleans with `funcaoIds` plus a `funcoes` array carrying the assignment the test needs, and add a matching `funcoes` catalogue to that file's bootstrap literal so the wizard memos still find the person: `sale-wizard-custom-item-labels.test.tsx:90-92` (vendedor), `sale-wizard-edit.test.tsx:120-122` (vendedor) and `:132-134` (finder), `sale-wizard-payment-plan.test.tsx:92-94` (vendedor), `sale-wizard-commission-defaults.test.tsx:89-91` (vendedor) and `:101-103` (finder), `sale-wizard-free-items.test.tsx:84-86` (vendedor).
These are behaviour-preserving translations, not new assertions: each file's existing expectations must pass unchanged.
If one of them starts failing, the wizard memos were converted incorrectly, most likely by dropping the `status === 'active'` filter.

## Red

Write these first and watch them fail.

### New file: `apps/web/src/sales-ops/__tests__/pessoas-funcoes-view.test.tsx`

Copy the harness from `areas-view.test.tsx:1-121` verbatim: the `// @vitest-environment happy-dom` pragma on line 1, the `vi.mock('@/components/ui/dialog', ...)` block at `:9-23` that flattens the dialog into plain divs, the `React.act` cast at `:27-29`, the `createRoot` `beforeEach` / `afterEach` at `:87-99`, and the `change` and `submit` helpers at `:101-121`.
Add a `click` helper dispatching a bubbling `MouseEvent` inside `act`, copied from `routing.test.tsx:236-239`.
Import `{ FuncaoDialog, FuncoesView, PersonDialog, PessoasView }` from `../SalesOpsApp` **after** the dialog mock, exactly as `areas-view.test.tsx:25` does.
Add `funcao()` and `pessoa()` fixture factories and a `bootstrap()` helper in the style of `areas-view.test.tsx:31-82`.

The Combobox needs **no mock**: slice 03 ships it inline and non-portalled with no new dependency, so it is directly reachable. Drive it with these helpers, matching the ARIA contract slice 03 pins:

```tsx
const combobox = (label: string): HTMLButtonElement =>
  container.querySelector<HTMLButtonElement>(`[role="combobox"][aria-label="${label}"]`)!;
const panelSearch = (): HTMLInputElement =>
  container.querySelector<HTMLInputElement>('[role="listbox"]')!
    .closest('[data-combobox-panel], div')!
    .querySelector('input')!;
const optionRows = (): HTMLElement[] => [...container.querySelectorAll('[role="option"]')];
const createRow = (): HTMLElement | null =>
  container.querySelector('[data-combobox-create="true"]');
```

Pick an option by clicking the `[role="option"]` row whose `textContent` matches; that fires `onChange` with the option value.
If the search input is not reachable through the selector above, locate it as the single `input` inside the open panel; slice 03 gives it `aria-label` equal to its `searchPlaceholder`, default `Buscar...`, which is the more robust hook.

Tests, exactly these names:

1. `it('lists pessoas with their funções as badges')` - render `PessoasView` with three pessoas: one carrying a system `Vendedor` plus a custom `Designer`, one carrying nothing, one `inactive`. Assert the text contains `Vendedor`, `Designer`, `Ativo` and `Inativo`, assert a `-` cell exists for the unassigned pessoa, and assert the text contains neither pessoa `id` nor `orgId`.
2. `it('shows the empty panel when no pessoa exists')` - render `PessoasView` with `people: []`; assert the text contains `Nenhuma pessoa cadastrada`.
3. `it('assigns and removes funções before saving a pessoa')` - render `PersonDialog` with `modal={{ kind: 'person' }}`, `funcoes` = the two system funções plus `Designer`, and an `onSave` spy. Type `  Sig  ` into the Nome input, open `Função da pessoa`, pick `Vendedor`, click `Adicionar função`, repeat for `Designer`, then click `button[aria-label="Remover função Vendedor"]`, submit, and assert `onSave` was called with `{ id: undefined, displayName: 'Sig', contactEmail: undefined, status: 'active', funcaoIds: [designer.id] }`.
4. `it('refuses to save a pessoa without a name or without any função')` - render `PersonDialog` for a new pessoa; submit blank and assert the spy was never called and `Salvar` is disabled; type a name only and assert `Salvar` is still disabled and the hint `Atribua ao menos uma função.` is present; add one função and assert `Salvar` becomes enabled.
5. `it('prefills the funções of the pessoa being edited and keeps its id')` - render `PersonDialog` with `modal={{ kind: 'person', person: pessoa({ funcoes: [vendedorRef] }) }}`; assert the assigned row for `Vendedor` is present and that `Vendedor` is absent from the picker options once opened; add `Designer`, submit, and assert the payload is `{ id: pessoa().id, displayName: 'Alex Silva', contactEmail: 'alex.silva@fxl.example', status: 'active', funcaoIds: [vendedor.id, designer.id] }`.
6. `it('offers a create row for a função that does not exist yet and assigns it')` - render `PersonDialog` with an `onCreateFuncao` spy resolving to `funcao({ id: 'po-id', name: 'P.O.', slug: 'p-o', isSystem: false })`. Type a name, open the picker, type `P.O.` into the panel search, assert `createRow()!.textContent!.trim()` is exactly `+ Criar nova função "P.O."` (feminine agreement, proving `entityLabel` and `entityGender` are wired), click it, assert `onCreateFuncao` was called once with `'P.O.'`, then submit and assert `funcaoIds` contains `'po-id'`.
7. `it('lists funções marking predefinidas and counting assigned pessoas')` - render `FuncoesView` with the two system funções plus `Designer`, and two pessoas assigned to `Vendedor`. Assert the text contains `Predefinida`, `Personalizada` and `Ativa`, and that a count cell reads `2`.
8. `it('offers no edit affordance for a system função')` - same render with an `onEdit` spy. Assert `button[aria-label="Editar Designer"]` exists and is enabled, `button[aria-label="Editar Vendedor"]` is null, `button[aria-label="Função predefinida do app"]` exists with `disabled === true`; click it and assert the spy was never called.
9. `it('creates a custom função submitting trimmed name and status')` - render `FuncaoDialog` with `modal={{ kind: 'funcao' }}` and an `onSave` spy. Type `  Designer  `, set `Status da função` to `Arquivada` through the Combobox, submit, and assert the payload is `{ id: undefined, name: 'Designer', status: 'archived' }`.
10. `it('edits a custom função keeping its id and locks a system one')` - render `FuncaoDialog` for the custom `Designer`, rename it to `Design Lead`, submit, assert `{ id: designer.id, name: 'Design Lead', status: 'active' }`; re-render with the system `Vendedor` and assert the Nome input is `disabled`, `Salvar` is disabled, and the text contains `Função predefinida do app`.

### Amended existing oracle: `apps/web/src/sales-ops/__tests__/routing.test.tsx`

Add one new test after the rewritten `keeps pessoas management in Cadastros and personal panels read-only`:

`it('rewrites the legacy cadastros seller and finder URLs to Pessoas')` - `renderRoute('/cadastros/vendedores', ['admin'])`, assert `pathname()` is `/cadastros/pessoas`, `expectWorkspace('Cadastros')`, `expectHeading('Pessoas')`; repeat for `/cadastros/finders`; then `renderRoute('/cadastros/vendedores', ['seller'])` and assert `pathname()` is `/meus-dados/vendedores` with `expectHeading('Meu painel')`, proving the alias never overrides role visibility.

### Amended existing oracle: `apps/web/src/sales-ops/__tests__/navigation.test.ts`

The rewrites in `## Test fallout` are themselves the oracle for the route surface: they pin the exact `cadastros` array, the two new valid routes, the two alias redirects, the untouched `meus-dados` ids and the `workspaceForView` mapping.

### ORACLE commands

`pnpm --filter <pkg> test -- <path>` does **not** filter: pnpm swallows the positional argument and all 21 web test files run. Use `exec vitest run` with a path relative to `apps/web`.

```bash
# Primary oracle - the new view and dialog suite.
CI=true pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/__tests__/pessoas-funcoes-view.test.tsx

# Route surface oracles.
CI=true pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/__tests__/navigation.test.ts
CI=true pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/__tests__/routing.test.tsx

# Optimistic-row oracle (file owned by slice 01, amended here).
CI=true pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/__tests__/optimistic.test.ts
```

Full gate before handing to Verify, all four exiting 0:

```bash
pnpm run lint
pnpm run type-check
CI=true pnpm test
pnpm run build
```

## Green

1. `apps/web/src/sales-ops/types.ts`: add `SalesOpsFuncao` and `SalesOpsPersonFuncao` after `SalesOpsArea`; drop the three booleans from `SalesOpsPerson` and add `funcaoIds: string[]` plus `funcoes: SalesOpsPersonFuncao[]`; add `funcoes: SalesOpsFuncao[]` to `SalesOpsBootstrap` after `areas`.
2. `apps/web/src/sales-ops/api.ts`: import `SalesOpsFuncao`, redefine `SavePersonPayload` explicitly, add `SaveFuncaoPayload`, add `salesOpsApi.saveFuncao` as a copy of `saveArea` against `/api/v1/sales-ops/funcoes`.
3. `apps/web/src/sales-ops/hooks.ts`: add `funcoes` to the hoisted bootstrap selector, add `useSaveSalesOpsFuncao` as a `useAppMutation` with `invalidates: [queryKeys.salesOps.all]` and the required no-optimistic-write comment. Do not import `useMutation`; slice 01's ESLint rule fails the build if you do.
4. `apps/web/src/sales-ops/optimistic.ts`: rework `optimisticPerson` to resolve `funcoes` from `previous.funcoes` and set `funcaoIds`, dropping the three boolean lines.
5. `apps/web/src/sales-ops/navigation.ts`: add `Tags` to the lucide import and keep `UsersRound`; extend `SalesOpsView` with `| 'pessoas' | 'funcoes'`; rewrite the `cadastros` array to `produtos`, `areas`, `clientes`, `pessoas` (`UsersRound`), `funcoes` (`Tags`), `geral`. Leave `meusDadosSeller`, `meusDadosFinder`, `salesOpsWorkspaces`, `getVisibleWorkspaces`, `getSalesOpsNavigation`, `buildSalesOpsPath` and `getDefaultSalesOpsRoute` byte-identical. If the pinned lucide version lacks `Tags`, fall back to `Tag`; both are exported by `lucide-react@0.475`.
6. `apps/web/src/sales-ops/navigation.ts`: add the alias helper and thread it through `resolveSalesOpsRoute` only.

   ```ts
   const legacyCadastroViews: Readonly<Record<string, SalesOpsView>> = {
     vendedores: 'pessoas',
     finders: 'pessoas',
   };

   function aliasLegacyView(
     workspace: SalesOpsWorkspace,
     view: string | undefined,
   ): string | undefined {
     if (workspace !== 'cadastros' || view === undefined) return view;
     return legacyCadastroViews[view] ?? view;
   }
   ```

   In `resolveSalesOpsRoute`, look the view up through `aliasLegacyView(workspace, params.view)` and return `redirect: view !== params.view` on the success branch, so a canonical route still reports `redirect: false` and an aliased one reports `true`.
7. `SalesOpsApp.tsx` imports and constants: add `Lock` and `X` to the lucide import; add `useSaveSalesOpsFuncao` to the `./hooks` import; add `SalesOpsFuncao` to the `./types` import; add `SaveFuncaoPayload` to the `./api` type import; add the `Combobox` import from `@/components/ui/combobox`; add `funcoes: []` to `emptyBootstrap`.
8. `ModalState`: drop `roleHint` from the `person` variant, add the `funcao` variant.
9. `titleForView`: add the `pessoas` and `funcoes` entries; flatten the `vendedores` and `finders` titles to `'Meu painel'`.
10. Add `FUNCAO_SLUG_VENDEDOR`, `FUNCAO_SLUG_FINDER`, `hasFuncao` and `collaboratorPool` above `salesForPerson`.
11. `SalesOpsApp` body: add `const saveFuncao = useSaveSalesOpsFuncao();`; split the permission flag into `canManageCadastros`, `canManagePeople` and `canManageFuncoes`; simplify `personModalMatchesRoute`; update `runHeaderAction` and the `headerAction` chain. Leave the `mountedRef` effect, `setWorkspace` and `go` untouched.
12. Render switch: replace both `PeopleView` blocks with `MeuPainelView` blocks; add the `pessoas` and `funcoes` blocks.
13. Dialog mounts: change `collaborators` to `collaboratorPool(bootstrap.people)`; add `funcoes` and `onCreateFuncao` to `<PersonDialog>`; add the `<FuncaoDialog>` mount after `<AreaDialog>`.
14. Rename `PeopleView` to `MeuPainelView`, delete its `onEdit` prop and the `<button>` branch, swap its filter to `hasFuncao`.
15. Add `PessoasView` after `AreasView` and `FuncoesView` after `PessoasView`, both exported.
16. Add `FuncaoDialog` plus `FuncaoDialogBody` after `AreaDialogBody`, `FuncaoDialog` exported.
17. Rework `PersonDialogBody` per `## Component plan`, update `PersonDialog`'s props and remount key, delete `RoleToggle`.
18. Swap the wizard `sellers` and `finders` memos to `hasFuncao` and the `collaborators` memo to `collaboratorPool`, keeping the `status === 'active'` filters.
19. Apply the CLAUDE.md edits.
20. Apply the test rewrites in `## Test fallout`, then add the new `pessoas-funcoes-view.test.tsx`.
21. Run the four gate commands from `## Red` at the repo root, run-once only, and fix fallout until green.

## Refactor

- `SalesOpsApp.tsx` grows past 5200 lines with two more views and one more dialog. Do not split the file in this slice: `sale-wizard-ui-contract.test.ts` greps its source text and every existing view test imports components from it, so a split belongs in its own slice with its own oracle.
- The `funcao` modal is not route-guarded while the `person` modal is. That asymmetry already exists for `product`, `client` and `area`; unifying it means promoting the `queueMicrotask` guard into a general "this modal belongs to view X" mechanism, which is a separate slice with its own routing tests.
- `titleForView` still carries `vendedores` and `finders` entries that only ever render under `meus-dados`. Renaming those view ids would be honest but would change four `meus-dados` URLs that CLAUDE.md pins as canonical. Not now.
- `personMetrics` and `salesForPerson` still take a `mode: 'seller' | 'finder'` literal rather than a função slug. That is correct while only those two funções carry commission semantics, and it should be revisited when a dynamic função earns commission.
- After this slice lands, the three `sales_ops_people` boolean columns have no reader anywhere. That unlocks slice 05's promised contract slice to drop them; note it in the run capture so it does not get forgotten.

## Out of scope

- Any change to `getVisibleWorkspaces`, `AppRole`, `getRolesFromHubClaims` or `roleSummaryLabel`. Hub roles drive workspace visibility; funções drive nothing about navigation.
- The legacy route trees `/admin/*`, `/finder/*`, `/seller/*` and `/no-role`.
- Any change to the four `meus-dados` routes or to the tático dashboard.
- Scoping "Meus dados" to the signed-in person. See `## Risks`.
- Dropping the deprecated boolean columns from the database. That is slice 05's promised follow-up contract slice.
- Binding `salesOpsSaleProfessionals.role` free text to a `funcaoId`. That is slice 12.
- Product and service função cost defaults (slice 10) and per-proposta overrides (slice 12).
- Any migration, endpoint or RLS policy; slice 05 owns the backend entirely.
- Deleting funções or pessoas. Archival via `status` is the only removal path, and `salesOpsRouter` has no DELETE verb.
- Extracting pt-BR strings into i18n resources.

## Risks

- **"Meus dados" shows every seller in the org, not just the signed-in person.** This is a real pre-existing gap: `sales_ops_people` has no Hub `account_id`, no sales-ops query filters by `c.get('userId')`, and slice 05 explicitly refused to invent a linkage. `MeuPainelView` keeps the filter semantics of `PeopleView:1824` exactly, changing only the predicate from `person.isSeller` to `hasFuncao(person, 'vendedor')`, which selects the identical population because the API derives `is_seller` from precisely that assignment. So this slice neither fixes nor worsens it. **Flag to the human as a separate follow-up:** closing it needs a pessoa-to-Hub-account link plus a `userId` filter in the service layer, which is a slice of its own. Do not attempt it here.
- **Slice 06 has no plan file.** The Combobox contract used above comes from `03-combobox-primitive.md`, which is written and specific (`'aria-label'`, `entityLabel`, `entityGender`, `onCreate: (query: string) => void`, `role="combobox"` trigger, `data-combobox-create="true"` row, inline and non-portalled). If slice 06 has already converted the `PersonDialogBody` status field, keep its call site and only add the funções picker. If slice 06 has not run yet, this slice converts both fields itself, since it owns `PersonDialogBody` wholesale.
- **`onCreate` is synchronous and void, so it cannot return the created função.** Handled by wrapping: the Combobox `onCreate` fires a void arrow that awaits the separate `onCreateFuncao` prop and then appends the resulting id to `assignedIds`. If `useAppMutation` turns out not to expose `mutateAsync`, drop `onCreateFuncao` entirely, remove test 6, and let `cadastros/funcoes` be the only creation path. That is the single droppable sub-feature in this slice.
- **A failed inline função create is silent.** No dialog in this app surfaces API errors today; a failed mutation simply leaves the dialog open with the row unchanged. This slice keeps that parity rather than inventing an error surface for one picker. The realistic failure is `409 funcao_name_taken`, and the user's next action is to pick the existing row from the same picker. Recorded, not fixed.
- **Removing the cadastro routes could break `meus-dados`.** Two guards: `aliasLegacyView` returns early unless `workspace === 'cadastros'`, and `navigation.test.ts:63-86` plus `routing.test.tsx:406-422` stay unchanged as regression proof that the `vendedores` and `finders` view ids still resolve under `meus-dados`.
- **The `redirect: view !== params.view` change touches every route resolution.** For a canonical route the two are equal, so `redirect: false` is preserved and `navigation.test.ts:118-149` keeps passing apart from the two replaced blocks. Run the navigation oracle first after step 6, before touching `SalesOpsApp.tsx`.
- **`workspaceForView('vendedores', team)` silently degrades to `'tatico'`.** `go` is only ever called with a current nav item id (`SalesOpsApp.tsx:800`) or the literal `'vendas'` (`:1236`), so no code path reaches that branch; the two now-meaningless assertions are deleted rather than pinned to a nonsense value.
- **Dropping the booleans from the web type while the API still sends them.** Deliberate, and safe because the bootstrap selector passes `people` through wholesale, so the extra wire keys are simply unmodelled, exactly as they already are for every unlisted response field. The payoff is that `pnpm run type-check` mechanically proves no web code reads a deprecated mirror, which is the whole point of this slice in the expand/contract sequence.
- **Slice 01 rewrote `hooks.ts` and added `optimistic.ts` plus an ESLint ban on `useMutation`.** Addressed structurally: `useSaveSalesOpsFuncao` is specified as "identical in shape to whatever `useSaveSalesOpsArea` looks like at execution time", `salesOpsKeys` is not touched, and `optimisticPerson` plus its test are listed as files this slice must amend rather than discover.
- **Slice size.** This is the largest slice in the batch: 22 files, one union edit, two new views, one new dialog, one reworked dialog, five call-site conversions and twelve test files. It should still land as one atomic commit, because the halves are mutually load-bearing: removing the cadastro routes without `PessoasView` leaves Cadastros unable to manage people, and dropping the booleans from the type without the função picker leaves `PersonDialogBody` unable to produce a valid payload. If the executor cannot keep it green as one commit, split on the **pessoas / funções** boundary, never on a routes / dialog boundary:
  - `09a-funcoes-web`: `SalesOpsFuncao` and `SalesOpsPersonFuncao` types, `SaveFuncaoPayload` and `saveFuncao`, `useSaveSalesOpsFuncao`, `funcoes` in the selector and in `emptyBootstrap`, the `funcoes` view id and nav item, `titleForView.funcoes`, `FuncoesView`, `FuncaoDialog`, the `funcao` `ModalState` variant and its header action. Purely additive: no route is removed, `SalesOpsPerson` is untouched, `PersonDialogBody` is untouched, no boolean reader moves, and the only test changes are the `cadastros` array assertion plus the new-route cases in `navigation.test.ts` and one `useSaveSalesOpsFuncao` mock in `routing.test.tsx`.
  - `09b-pessoas-web`: the `pessoas` view id and nav item, removing `vendedores` and `finders` from the `cadastros` array, `aliasLegacyView`, `PessoasView`, the `MeuPainelView` rename, the `PersonDialogBody` rework, `RoleToggle` deletion, the `SalesOpsPerson` type change, `SavePersonPayload`, `optimisticPerson`, all five boolean call sites, the CLAUDE.md edits and the routing test rewrites.
  - `09a` must land first, because `09b`'s picker reads `bootstrap.funcoes`. The frontmatter acceptance then belongs to `09b`.
