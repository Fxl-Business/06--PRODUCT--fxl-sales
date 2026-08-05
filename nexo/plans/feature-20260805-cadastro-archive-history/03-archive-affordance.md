---
id: 03-archive-affordance
milestone: v2.4.0
status: todo
depends_on: []
files_modified:
  - apps/web/src/sales-ops/api.ts
  - apps/web/src/sales-ops/hooks.ts
  - apps/web/src/sales-ops/SalesOpsApp.tsx
  - apps/web/src/sales-ops/__tests__/cadastro-archive.test.tsx
  - apps/web/src/sales-ops/__tests__/areas-view.test.tsx
  - apps/web/src/sales-ops/__tests__/pessoas-funcoes-view.test.tsx
  - apps/web/src/sales-ops/__tests__/produtos-servicos-view.test.tsx
  - apps/web/src/sales-ops/__tests__/product-commission-editor.test.tsx
  - apps/web/src/sales-ops/__tests__/cadastros-refresh.test.tsx
acceptance: "given an admin on cadastros/produtos, cadastros/areas, cadastros/pessoas or cadastros/funcoes, when they click the row's Arquivar control and confirm the dialog that names the record and states that it leaves the pickers but stays on the records that already use it, then exactly one PATCH /api/v1/sales-ops/<resource>/<id> with body {\"status\":\"archived\"} (or \"inactive\" for a pessoa) is issued, no DELETE is ever issued, cancelling the dialog issues nothing at all, and no archive control is rendered for the system funções vendedor and finder."
---

# 03 - archive affordance on the cadastros

Web only.
No `apps/api/**` change, no migration, no new verb.

## 0. Plan-check rulings that bind this slice

**`depends_on: []` is correct and was re-verified.** Every endpoint this slice calls already exists on `master`; it needs nothing from slice 01 or 02. It may run in the same wave as slice 01.

**Slice 04 depends on THIS slice**, not the other way round. `waves.sh` must serialize them, because both edit `apps/web/src/sales-ops/api.ts`, `hooks.ts` and `SalesOpsApp.tsx`. Slice 04 declares `depends_on: [02-org-scoped-history-read, 03-archive-affordance]`.

**Three in-scope decisions that were challenged and upheld** (see the reconciliation report for the full argument):

1. **Removing the `Status` `Combobox` from the three dialogs stays in scope** (section 2.2). Leaving it is the produto bug of section 1 generalised: an edit dialog opened on an archived row silently reactivates it on `Salvar`. That directly undermines the feature's central promise, so it is a fix, not creep.
2. **Fixing `ProductDialogBody`'s hardcoded `status: 'active'` stays in scope.** Without it a produto cannot be archived at all and this slice has no produto story.
3. **Filtering archived produtos out of the wizard picker stays in scope** (section 2.10). The confirmation copy this slice ships literally promises `sai das listas de seleção de novas propostas`. Without the filter that sentence is false, and shipping false confirmation copy is worse than shipping no confirmation.

**Cliente stays out**, and it is out of the whole feature, not just this slice. Slice 01 no longer adds the column. See section 7.

## 1. What is actually true today, verified in the code

These are the facts the design rests on.
Each was read, not assumed.

**There is no DELETE and there must not be one.**
`apps/api/src/domains/sales-ops/routes.ts` declares 24 routes and none of them is a DELETE.
The file even says so in a comment above the funções block: *"There is deliberately no DELETE verb: removal is PATCH { status: 'archived' }"*.
Archiving is therefore an ordinary `PATCH` on an endpoint that already exists.

**A `{ "status": ... }`-only PATCH is valid on all four endpoints.**
- `PATCH /products/:id` parses through `UpdateProductSchema = ProductFieldsSchema.partial().superRefine(validateProductFields)`; `validateProductFields` skips every rule whose inputs are `undefined`, `resolveProductRefs` skips the área lookup when `areaId` is `undefined`, and `updateProduct` leaves `productFuncaoCosts` untouched when the key is absent.
- `PATCH /areas/:id` parses through `UpdateAreaSchema = AreaSchema.partial()` and `updateArea` only runs the duplicate-name probe when `data.name !== undefined`.
- `PATCH /funcoes/:id` parses through `UpdateFuncaoSchema = FuncaoSchema.partial()`; `updateFuncao` returns the `is_system` sentinel when `current.isSystem && (data.name !== undefined || data.status !== undefined)`, which is exactly the 409 this plan must never provoke.
- `PATCH /people/:id` parses through `UpdatePersonSchema = PersonFieldsSchema.partial()`; `planPersonFuncoes` returns `{ kind: 'unchanged' }` on `update` when `funcaoIds` is absent, so omitting the assignment set is the correct and only safe way to touch a pessoa's status.

**A pessoa does not have `archived`.**
`sales_ops_people.status` is `'active' | 'inactive'` in both `PersonFieldsSchema` and `apps/web/src/sales-ops/types.ts`.
Every other cadastro here is `'active' | 'archived'`.

**A cliente has no status column at all.**
`salesOpsClients` in `apps/api/src/db/schema.ts` (line 683) has `id, orgId, name, contact, legalName, document, address, legalRepName, legalRepDocument, createdAt, updatedAt` and nothing else.
`ClientSchema` declares no `status` either, and `SalesOpsClient` in the web types does not carry one.
Because zod strips unknown keys by default, a `PATCH /clients/:id` carrying `{"status":"archived"}` would return **200 with an unchanged row** - a silent no-op that looks like success.
Cliente is therefore out of scope for this slice; see §7.

**Pessoas and funções are the only admin-gated cadastros.**
`salesOpsRouter.post/patch('/people'|'/funcoes')` carry `requireAdmin`; products, areas and clients do not.
On the web side `pessoas` and `funcoes` appear only in the `cadastros` navigation list (`apps/web/src/sales-ops/navigation.ts`), and `getVisibleWorkspaces` grants `cadastros` only to `admin`.
`resolveSalesOpsRoute` resolves a view solely from `getSalesOpsNavigation(workspace, roles)`, so `view === 'pessoas'` implies `workspace === 'cadastros'` implies the `admin` role.
No `meus-dados` route can reach these views: `MeuPainelView` is a different component and takes no `onEdit` at all.

**Áreas, funções and pessoas can already be archived - badly.**
`AreaDialogBody`, `FuncaoDialogBody` and `PersonDialogBody` each carry a `Status` `Combobox` (`Ativa`/`Arquivada`, `Ativo`/`Inativo`).
It is undiscoverable, has no confirmation, and fires only as a side effect of pressing `Salvar` on an edit form.

**A produto cannot be archived at all today, and worse.**
`ProductDialogBody`'s payload hardcodes `status: 'active'` (SalesOpsApp.tsx line 3808).
So there is no way to archive a produto from the UI, and if a produto were ever archived by any other means, the next edit of that produto would silently un-archive it.
This is a live bug and this slice fixes it.

**The wizard's produto picker does not filter archived rows.**
`options={productOptions(bootstrap.products, areaNameById)}` (SalesOpsApp.tsx line 7206) reads the raw list.
Every other picker already filters: áreas at lines 3564 and 6073, funções at 3604 and 5608, pessoas at 5555, 5562 and 5576.
Produtos is the one hole, and it has to be closed here or the confirmation copy below would be a lie.

**The house confirmation pattern already exists.**
`SalesView` holds `pendingAction` state, renders one `AlertDialog` after its `<Table>`, drives it from a `confirmCopy` record keyed by action, and uses `Voltar` as the cancel label.
`@/components/ui/alert-dialog` exists and its `AlertDialogContent` already hardcodes the outside-click guard.
This slice reuses that shape verbatim rather than inventing a second one.

## 2. The design

### 2.1 Where the affordance lives: a row action, not a dialog field

The archive control is a **second icon button in each row's `Ações` cell**, beside `Editar`.

Rationale.
Archiving is a decision *about* a record, not a field *of* it.
The row is where the operator is already looking at the thing they want gone.
Burying it in the edit dialog's `Status` picker is undiscoverable, has no confirmation step, and couples a consequential act to an unrelated `Salvar`.

Rejected: a `MoreHorizontal` dropdown per row, as `SalesView` uses.
`SalesView` has four to six contextual actions per row and genuinely needs a menu.
A cadastro row has two.
A dropdown would hide a two-item menu behind a click and would drag `@radix-ui/react-dropdown-menu` portalling into four more test files for no gain.

Rejected: a `Trash2` icon.
`Trash2` is already imported in this file and means *remove a row from a client-side list editor* (modules, cost rows, plan rows).
Reusing it for a server-side archive would make one glyph mean two different things.
This slice uses `Archive` and `ArchiveRestore` from `lucide-react` (both verified present in `lucide-react@0.475.0`).

### 2.2 The `Status` picker leaves the three dialogs

`AreaDialogBody`, `FuncaoDialogBody` and `PersonDialogBody` lose their `Status` `Combobox` and its `useState`.
Each dialog instead submits the status the record already had: `modal.area?.status ?? 'active'`, `modal.funcao?.status ?? 'active'`, `modal.person?.status ?? 'active'`.
`ProductDialogBody`'s hardcoded `status: 'active'` becomes `activeModal.product?.status ?? 'active'` for the same reason.

Rationale.
After this slice there is exactly one way to change a cadastro's status, it always passes a confirmation, and it is always a single-purpose write.
Two competing doors to one fact is precisely the shape CLAUDE.md rejects elsewhere ("creating two competing ways to pay one role").
Leaving the picker in place would also mean an edit dialog opened on an archived row could silently reactivate it on `Salvar` without the operator noticing - which is the produto bug above, generalised.

The `??` fallback on the edit path is the same short-circuit shape the `name` seed uses, so a create still submits `'active'` and an edit can never renumber or reactivate.

### 2.3 Restore is in this slice, and it is not confirmed

An archived row renders `Restaurar` (`ArchiveRestore`) where an active row renders `Arquivar` (`Archive`).
Never both.
Restoring fires the mutation directly with `status: 'active'`, with no confirmation.

Rationale.
Without restore on the list, the confirmation copy could not honestly say the action is reversible, and §2.2 would have removed the only existing way back.
Restoring is not destructive, so it gets no confirmation - exactly the asymmetry `SalesView` already applies, where `Marcar como ganha` fires directly and only the voiding transitions confirm.

This does not step on slice 04.
Slice 04 owns the audit-history panel in `cadastros/geral` and the restore *from that history*; it reuses `useSetSalesOpsCadastroStatus` and `SetCadastroStatusPayload` from this slice **verbatim and exclusively**, which is why the hook takes `status: 'active' | 'archived' | 'inactive'` rather than an `archive()` verb.
Slice 04 is forbidden from building a second restore path - an earlier draft of it fanned out over `saveProduct` / `saveArea` / `saveFuncao` / `savePerson` with `{id, name, status}` bodies, which would have been a second door to one fact and would have written a cached name back on every restore. That was struck at plan-check.

### 2.4 Archived rows stay in the list, never hidden, never behind a filter

Rationale.
1. Áreas, funções and pessoas already list archived rows inline with a status badge; hiding them now would change three screens to make one consistent with nothing.
2. An archived produto **permanently occupies its `code_suffix`** (`sales_ops_products_org_code_suffix_idx` has no `WHERE`), and `nextProductCodeSuffix` counts both statuses. If archived produtos vanished from the list, the operator would see a free slot that is not free and would hit the bare 500 that CLAUDE.md records under the missing 23505 handling.
3. With restore living on the list (§2.3), a row that disappeared on archive would leave the operator with no evidence anything happened and no way back on that screen.

Archived rows are **not** re-sorted to the bottom.
The server orders by name and the optimistic comparators mirror that ordering exactly; a client-side status sort would fight both for cosmetics.

How the operator sees it:
- **Áreas / Funções / Pessoas**: the existing `Status` column already prints `Arquivada` / `Inativo`. Nothing is added.
- **Produtos & Serviços**: no `Status` column is added. The table already carries nine columns and a tenth would squeeze every one of them. Instead the `Nome` cell renders a muted `Arquivado` `Badge` beside the name, and only when the row is archived - so the common case costs zero width.
- **All four**: the `<TableRow>` gets `archivedRowClass` when the row is not active, so "this one is archived" reads the same everywhere even though the badge sits in a different column.

### 2.5 No optimistic write

`useSetSalesOpsCadastroStatus` declares `invalidates: [queryKeys.salesOps.all]` and nothing else.

Rationale.
`useOptimisticBootstrapWrite` covers `areas | clients | funcoes | people` only; produtos are deliberately excluded and `hooks.ts` states why ("the client cannot build the persisted row").
Making four of the five cadastros feel instant and the fifth not would give one gesture two different latencies on adjacent screens, which is worse than one honest latency.
Extending `OptimisticCollection` to `products` would also mean touching `withoutOptimisticRows` and `reconcileOptimisticRow` for a collection whose row the client provably cannot compute.
Disclosure is already handled: the header's `Atualizando` indicator (driven by `bootstrapQuery.isFetching`, already covered by `cadastros-refresh.test.tsx`) lights up for the round trip.
A double archive is idempotent, and the confirmation closes on the first confirm, so no in-flight lock is needed.

### 2.6 Absent, not disabled, for a system função

`FuncoesView` already renders a disabled `Lock` button *instead of* `Editar` for `funcao.isSystem`, and `pessoas-funcoes-view.test.tsx` already pins that.
That cell is left exactly as it is: the lock, and nothing else.
The archive control is rendered only in the non-system branch.

An already-archived row shows `Restaurar` and no `Arquivar`, so there is never a disabled archive control anywhere in the app.

An **optimistic** row (`isOptimisticId(row.id)`) renders the archive control **disabled**, for the same reason the edit control already is: a placeholder id would fail the Postgres uuid cast on the PATCH path.
Produtos are not an optimistic collection, so `ProductsView` needs no such guard.

### 2.7 No new admin gate

`PessoasView` and `FuncoesView` are reachable only under `cadastros`, which requires `admin` (§1).
They already expose an unconditional `Editar` button, which is the same admin-gated write.
Adding a `canManage` prop that gates only the new control while `Editar` stays ungated would be theatre.
No prop is added, and §5 records the navigation evidence as the reason.

### 2.8 `useInlineLayer` is not needed here, and this is why

`useInlineLayer(open)` is required of anything that opens an **inline layer inside a `Dialog`** - a `Combobox` panel or an `InfoHint` disclosure - because Radix's `useEscapeKeydown` runs on `document` in the capture phase and no in-tree handler can pre-empt it.
The confirmation added by this slice contains no `Combobox` and no `InfoHint`; it is a title, a body paragraph and two buttons.
It is also an `AlertDialog` root rendered as a **sibling of the table at page level**, not nested inside a `Dialog`.
So there is no layer to register and no `DialogContent` registry in scope.

This slice *removes* three `Combobox` instances from three `Dialog`s.
Removal cannot strand a registration: `useInlineLayer`'s effect cleanup runs on unmount and its release is idempotent.

### 2.9 The exact pt-BR copy

One table, five entries, in `SalesOpsApp.tsx`.
The verb follows each cadastro's own stored vocabulary, so the word on the button always matches the badge the row will show afterwards: `Arquivar` for produto, serviço, área and função; `Inativar` for a pessoa, whose status literal is `inactive` and whose badge reads `Inativo`.

| cadastro | resource | archived status | confirm title | confirm body | confirm action | cancel |
| --- | --- | --- | --- | --- | --- | --- |
| `produto` | `products` | `archived` | `Arquivar o produto "<nome>"?` | `Ele sai das listas de seleção de novas propostas, mas continua nas propostas que já o utilizam. Nada é apagado: o código continua reservado para ele e você pode restaurá-lo aqui a qualquer momento.` | `Arquivar produto` | `Voltar` |
| `servico` | `products` | `archived` | `Arquivar o serviço "<nome>"?` | `Ele sai das listas de seleção de novas propostas, mas continua nas propostas que já o utilizam. Nada é apagado: o código continua reservado para ele e você pode restaurá-lo aqui a qualquer momento.` | `Arquivar serviço` | `Voltar` |
| `area` | `areas` | `archived` | `Arquivar a área "<nome>"?` | `Ela sai das listas de seleção de novos produtos e itens de proposta, mas continua nos produtos e propostas que já a utilizam. Nada é apagado e você pode restaurá-la aqui a qualquer momento.` | `Arquivar área` | `Voltar` |
| `funcao` | `funcoes` | `archived` | `Arquivar a função "<nome>"?` | `Ela sai das listas de seleção de novas atribuições e custos padrão, mas continua nas pessoas e propostas que já a utilizam. Nada é apagado e você pode restaurá-la aqui a qualquer momento.` | `Arquivar função` | `Voltar` |
| `pessoa` | `people` | `inactive` | `Inativar a pessoa "<nome>"?` | `Ela sai das listas de seleção de vendedor, finder e profissional, mas continua nas propostas que já a utilizam. Nada é apagado e você pode reativá-la aqui a qualquer momento.` | `Inativar pessoa` | `Voltar` |

Every clause above is verifiable against the code after this slice:
"sai das listas de seleção" is true for produtos only because §2.10 closes the wizard hole, and is already true for áreas, funções and pessoas;
"continua nas propostas que já o utilizam" is true because the sale item carries `productNameSnapshot` and the professional row carries `funcaoNameSnapshot`;
"o código continua reservado" is true because the unique index has no `WHERE` clause;
"você pode restaurá-lo aqui" is true because of §2.3.

Row control labels, built from the same table:
- archive `aria-label` = `` `${archiveVerb} ${noun} ${name}` `` - e.g. `Arquivar produto FXL Finance`, `Inativar pessoa Alex Silva`.
- archive `title` = `Arquivar` or `Inativar`.
- restore `aria-label` = `` `${restoreVerb} ${noun} ${name}` `` - e.g. `Restaurar função Designer`, `Reativar pessoa Alex Silva`.
- restore `title` = `Restaurar` or `Reativar`.

No raw account id, workspace id or row id appears in any of these strings.
Both controls use the existing `iconButtonClass`; no destructive red variant is introduced, because archiving is reversible and a red control would overstate it.

### 2.10 Closing the produto picker hole

`productOptions` gains an archived marker, mirroring `funcaoCostOptionLabel` exactly:
`label: product.status === 'archived' ? `${product.name} (arquivado)` : product.name`.

A new pure helper filters the picker's options:

```ts
/**
 * Active produtos, plus the one THIS item already references. An archived produto
 * has to vanish from the picker - that is what archiving means - without erasing
 * the label of an item a stored proposta already carries. Same rule as
 * `selectableAreas` in this file and as the função cost row in ProductDialog.
 */
function selectableProducts(products: SalesOpsProduct[], currentId: string): SalesOpsProduct[] {
  const active = products.filter((product) => product.status === 'active');
  if (!currentId || active.some((product) => product.id === currentId)) return active;
  const current = products.find((product) => product.id === currentId);
  return current ? [current, ...active] : active;
}
```

`productOptions` has exactly one call site, so both edits are contained.

## 3. Exact file changes

### 3.1 `apps/web/src/sales-ops/api.ts`

Add, beside the other payload types:

```ts
/**
 * The four cadastros that carry a status column. `clients` is deliberately absent:
 * sales_ops_clients has no status column and `ClientSchema` declares none, so a
 * status key would be stripped by zod and answered 200 with an unchanged row.
 */
export type CadastroResource = 'products' | 'people' | 'funcoes' | 'areas';

/** A pessoa stores `inactive`; every other cadastro stores `archived`. */
export type CadastroStatus = 'active' | 'archived' | 'inactive';

export type SetCadastroStatusPayload = {
  resource: CadastroResource;
  id: string;
  status: CadastroStatus;
};
```

Add to the `salesOpsApi` object:

```ts
  /**
   * Archive and restore. Deliberately a status-only PATCH on the endpoint that
   * already exists: `salesOpsRouter` has no DELETE verb and must not gain one, and
   * every one of the four PATCH schemas is `.partial()`, so an omitted key is left
   * untouched server-side. Sending only `status` also means a stale cached name or
   * função set can never be written back as a side effect of archiving.
   */
  setCadastroStatus: ({ resource, id, status }: SetCadastroStatusPayload, token: Token) =>
    apiFetch<unknown>(`/api/v1/sales-ops/${resource}/${id}`, {
      method: 'PATCH',
      token,
      body: JSON.stringify({ status }),
    }),
```

### 3.2 `apps/web/src/sales-ops/hooks.ts`

Import `type SetCadastroStatusPayload` from `./api`, then add:

```ts
export function useSetSalesOpsCadastroStatus() {
  const { getToken } = useAccessToken();
  /*
    No optimistic write on purpose. `useOptimisticBootstrapWrite` covers areas,
    clients, funções and pessoas only - produtos are server-derived and excluded -
    so an optimistic archive would make one gesture feel instant on four screens
    and slow on the fifth. The header's `Atualizando` indicator already discloses
    the round trip, and the write is idempotent.
  */
  return useAppMutation({
    mutationFn: async (payload: SetCadastroStatusPayload) =>
      salesOpsApi.setCadastroStatus(payload, await requireToken(getToken)),
    invalidates: [queryKeys.salesOps.all],
  });
}
```

### 3.3 `apps/web/src/sales-ops/SalesOpsApp.tsx`

**Imports.**
Add `Archive` and `ArchiveRestore` to the `lucide-react` import (alphabetical: after `Check`? no - the list is alphabetical, so `Archive, ArchiveRestore` go first, before `CalendarDays`).
Add `useSetSalesOpsCadastroStatus` to the `./hooks` import.
Add `type CadastroResource, type CadastroStatus` to the `./api` type import.

**New module-level constants and helpers**, placed next to `statusMeta` / `payableTypeMeta` (around line 425):

```ts
/** One visual language for an archived row across all four cadastro tables. */
const archivedRowClass = 'opacity-55';

/**
 * Which cadastro a row belongs to, for copy purposes. `produto` and `servico` are
 * one API resource and two words: the operator picked a bucket in the segmented
 * bar and the confirmation has to use the same noun they just clicked.
 */
export type CadastroKind = 'produto' | 'servico' | 'area' | 'funcao' | 'pessoa';

export type CadastroArchiveTarget = {
  cadastro: CadastroKind;
  id: string;
  name: string;
  /** The status to write. `'active'` is a restore; anything else is an archive. */
  status: CadastroStatus;
};

/**
 * Everything that differs per cadastro, in one table.
 *
 * `archivedStatus` is `inactive` for a pessoa because that is the literal her
 * column stores, and `archiveVerb` follows it, so the word on the button always
 * matches the badge the row shows afterwards.
 *
 * Every clause in `confirmBody` is load-bearing and true:
 * an archived row leaves the pickers (see `selectableProducts` here and the
 * `status === 'active'` filters on áreas, funções and pessoas), stays on the
 * records that already reference it (`productNameSnapshot`, `funcaoNameSnapshot`),
 * keeps its `code_suffix` slot (the unique index has no WHERE clause), and can be
 * restored from this same table.
 */
const cadastroArchive: Record<
  CadastroKind,
  {
    resource: CadastroResource;
    archivedStatus: CadastroStatus;
    noun: string;
    archiveVerb: string;
    restoreVerb: string;
    confirmTitle: (name: string) => string;
    confirmBody: string;
    confirmAction: string;
  }
> = { /* the five rows of the table in §2.9, verbatim */ };
```

**New shared pieces**, placed immediately after the table:

```ts
/**
 * The archive/restore gesture, shared by the four cadastro tables. Archiving goes
 * through the confirmation; restoring does not, because restoring is not
 * destructive - the same asymmetry SalesView applies, where `Marcar como ganha`
 * fires directly and only the voiding transitions confirm.
 */
function useCadastroArchive(onArchive: (target: CadastroArchiveTarget) => void) {
  const [pending, setPending] = useState<CadastroArchiveTarget | null>(null);
  return {
    pending,
    select: (target: CadastroArchiveTarget) =>
      target.status === 'active' ? onArchive(target) : setPending(target),
    cancel: () => setPending(null),
    confirm: () => {
      if (pending) onArchive(pending);
      setPending(null);
    },
  };
}

/**
 * One row's archive control. An active row offers `Arquivar`, an archived one
 * offers `Restaurar`, and neither ever renders as a disabled version of the other:
 * `type="button"` on both, because a row control must never be a submit.
 */
function CadastroArchiveButton({
  cadastro, id, name, archived, disabled, onSelect,
}: {
  cadastro: CadastroKind;
  id: string;
  name: string;
  archived: boolean;
  disabled?: boolean;
  onSelect: (target: CadastroArchiveTarget) => void;
}) { /* renders one <button type="button"> per §2.9 */ }

/** The confirmation. Null target renders nothing. */
function CadastroArchiveConfirm({
  target, onCancel, onConfirm,
}: {
  target: CadastroArchiveTarget | null;
  onCancel: () => void;
  onConfirm: () => void;
}) { /* AlertDialog, shaped exactly like SalesView's */ }
```

`CadastroArchiveConfirm` renders:

```tsx
<AlertDialog onOpenChange={(open) => (!open ? onCancel() : undefined)} open={target !== null}>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>{target ? copy.confirmTitle(target.name) : ''}</AlertDialogTitle>
      <AlertDialogDescription>{target ? copy.confirmBody : ''}</AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel>Voltar</AlertDialogCancel>
      <AlertDialogAction onClick={onConfirm}>{target ? copy.confirmAction : ''}</AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
```

**`ProductsView`.**
- New required prop `onArchive: (target: CadastroArchiveTarget) => void`.
- `const archive = useCadastroArchive(onArchive);` at the top of the body (this view has no early return, so placement is unconstrained).
- The `Nome` cell becomes name plus, when `product.status !== 'active'`, `<Badge className={neutralBadgeClass}>Arquivado</Badge>`. `neutralBadgeClass` is declared at line 2797, *below* `ProductsView`; a `const` at module scope is hoisted in the TDZ sense only until evaluation, and it is read inside a render function, so this is safe - the same way `ProductsView` already reads `panelClass`.
- `<TableRow key={product.id} className={product.status !== 'active' ? archivedRowClass : undefined}>`.
- The `Ações` cell becomes `<div className="flex items-center justify-center gap-1.5">` wrapping the existing edit button plus `<CadastroArchiveButton cadastro={productKindOf(product) === 'service' ? 'servico' : 'produto'} archived={product.status !== 'active'} id={product.id} name={product.name} onSelect={archive.select} />`.
- The existing edit button gains `aria-label={`Editar ${product.name}`}` and `title="Editar"`. It has neither today, unlike the other three views; this is a small accessibility gap closed while the cell is open, and the new test relies on it.
- `<CadastroArchiveConfirm onCancel={archive.cancel} onConfirm={archive.confirm} target={archive.pending} />` after `</Table>`, inside the panel div (so it renders in both the empty and non-empty branches - place it as the last child of the outer `<div className={`${panelClass} overflow-hidden`}>`).

**`AreasView`, `PessoasView`, `FuncoesView`.**
Same four edits each, with two things to get right:

1. **`useCadastroArchive` must be called before the early empty-state return.**
   All three currently open with `if (bootstrap.X.length === 0) return <EmptyPanel .../>;` and have no hooks at all.
   The hook call goes on the line *above* that `if`, or `react-hooks/rules-of-hooks` fails lint.
2. `FuncoesView` renders `CadastroArchiveButton` **only in the `funcao.isSystem === false` branch**; the `isSystem` branch keeps the disabled `Lock` button and nothing else.

Per-view specifics:
- `AreasView`: `cadastro="area"`, `archived={area.status !== 'active'}`, `name={area.name}`, `disabled={pending}` (the existing `isOptimisticId` flag).
- `PessoasView`: `cadastro="pessoa"`, `archived={person.status !== 'active'}`, `name={person.displayName}`, `disabled={pending}`.
- `FuncoesView`: `cadastro="funcao"`, `archived={funcao.status !== 'active'}`, `name={funcao.name}`, `disabled={pending}`.
- All three: `<TableRow>` gains the `archivedRowClass` conditional, and the `Ações` cell wraps its buttons in `<div className="flex items-center justify-center gap-1.5">`.

**`ClientsView`: unchanged.** See §7.

**`SalesOpsApp` wiring.**

```ts
const setCadastroStatus = useSetSalesOpsCadastroStatus();
```

```ts
/**
 * Archive and restore for every cadastro that has a status column. One handler for
 * all four, because the only thing that varies is the resource segment and the
 * archived literal, and both live in `cadastroArchive`.
 */
function changeCadastroStatus(target: CadastroArchiveTarget) {
  setCadastroStatus.mutate({
    resource: cadastroArchive[target.cadastro].resource,
    id: target.id,
    status: target.status,
  });
}
```

Pass `onArchive={changeCadastroStatus}` to `ProductsView`, `AreasView`, `PessoasView` and `FuncoesView`.

**Wizard picker (§2.10).**
Add `selectableProducts` next to `productOptions`, change `productOptions`'s `label` to carry the `(arquivado)` marker, and change line 7206 to `options={productOptions(selectableProducts(bootstrap.products, item.productId), areaNameById)}`.

**Dialogs (§2.2).**
- `AreaDialogBody`: delete the `status` `useState` and the whole `<FieldBlock label="Status">` block; `submit` sends `status: modal.area?.status ?? 'active'`.
- `FuncaoDialogBody`: same; `submit` sends `status: modal.funcao?.status ?? 'active'`. The `isSystem` guard, the disabled name input, the disabled `Salvar` and the `Função predefinida do app` note all stay. Its text changes from `o nome e o status não podem ser alterados.` to `o nome não pode ser alterado.` since the dialog no longer offers a status control.
- `PersonDialogBody`: same; `submit` sends `status: modal.person?.status ?? 'active'`.
- `ProductDialogBody`: line 3808 becomes `status: activeModal.product?.status ?? 'active',` and the comment above it is extended to say that an edit must never silently reactivate an archived produto.

`SettingsView` is **not touched**. See §7 for the note handed to slice 04.

## 4. Named oracle test

**New file: `apps/web/src/sales-ops/__tests__/cadastro-archive.test.tsx`** (`// @vitest-environment happy-dom`).

House harness, copied from the two nearest neighbours:
`sales-transition-actions.test.tsx` for the `@/components/ui/alert-dialog` mock (the `CloseCtx` version, so `AlertDialogCancel` really closes) and the `React.act` / `createRoot` scaffolding;
`pessoas-funcoes-view.test.tsx` for the `@/components/ui/dialog` mock and the `buttonByAriaLabel` helper.
Fixtures are local copies of the `area`, `funcao`, `pessoa` and `product` builders already in those files.

### Block A - the transport is a PATCH, never a DELETE

Stubs `globalThis.fetch` with a `vi.fn()` returning `{ ok: true, json: async () => ({}) }` and calls `salesOpsApi.setCadastroStatus` directly, so the assertion is about the real request and not about a mocked module.

```
it('archives a produto with a status-only PATCH')
  await salesOpsApi.setCadastroStatus({ resource: 'products', id: PRODUCT_ID, status: 'archived' }, 'test-token');
  expect(url).toBe(`${base}/api/v1/sales-ops/products/${PRODUCT_ID}`)
  expect(init.method).toBe('PATCH')
  expect(JSON.parse(init.body)).toEqual({ status: 'archived' })

it('uses the same PATCH shape for área, função and pessoa')
  areas   -> /api/v1/sales-ops/areas/<id>   { status: 'archived' }
  funcoes -> /api/v1/sales-ops/funcoes/<id> { status: 'archived' }
  people  -> /api/v1/sales-ops/people/<id>  { status: 'inactive' }
  // A pessoa stores `inactive`, not `archived`; sending `archived` would be stripped by zod.

it('never issues a DELETE and never sends a body key other than status')
  for every call above: expect(init.method).not.toBe('DELETE')
  expect(Object.keys(JSON.parse(init.body))).toEqual(['status'])
  // The last assertion is the real guard: a name or funcaoIds key smuggled in here
  // would let an archive write back a stale cached value.

it('restores with the same endpoint and status active')
  { resource: 'funcoes', id, status: 'active' } -> PATCH, body { status: 'active' }
```

### Block B - the confirmation gates the archive

Renders each view directly with a `vi.fn()` `onArchive`, `@/components/ui/alert-dialog` mocked as above.

```
it.each over the four views: 'requires a confirmation before archiving'
  click buttonByAriaLabel('Arquivar produto FXL Finance')     // and área / função / pessoa variants
  expect(onArchive).not.toHaveBeenCalled()
  expect(text()).toContain('Arquivar o produto "FXL Finance"?')
  expect(text()).toContain('continua nas propostas que já o utilizam')
  click the LAST button whose text is 'Arquivar produto'      // confirmActionButton helper
  expect(onArchive).toHaveBeenCalledTimes(1)
  expect(onArchive).toHaveBeenCalledWith({
    cadastro: 'produto', id: PRODUCT_ID, name: 'FXL Finance', status: 'archived',
  })

it('cancelling the confirmation archives nothing')
  click 'Arquivar produto FXL Finance'
  click buttonByText('Voltar')
  expect(onArchive).not.toHaveBeenCalled()
  expect(text()).not.toContain('Arquivar o produto "FXL Finance"?')

it('uses the pessoa vocabulary for a pessoa')
  buttonByAriaLabel('Inativar pessoa Alex Silva') is not null
  buttonByAriaLabel('Arquivar pessoa Alex Silva') is null
  confirm title contains 'Inativar a pessoa "Alex Silva"?'
  onArchive called with { cadastro: 'pessoa', status: 'inactive', ... }

it('names the serviço bucket when the row is a serviço')
  ProductsView kind="service" with a product({ kind: 'service' })
  buttonByAriaLabel('Arquivar serviço <nome>') is not null
  confirm action button text is 'Arquivar serviço'

it('restores without any confirmation')
  render AreasView with an archived área
  buttonByAriaLabel('Arquivar área FXL Visual') is null      // never both
  click buttonByAriaLabel('Restaurar área FXL Visual')
  expect(onArchive).toHaveBeenCalledWith({ cadastro: 'area', id, name: 'FXL Visual', status: 'active' })
  expect(text()).not.toContain('Arquivar a área')            // no confirm was raised

it('both row controls are type="button"')
  // happy-dom's dispatchEvent never runs a click's activation behaviour, so a
  // click test cannot see a button whose type makes it submit. Assert the attribute.
  expect(buttonByAriaLabel('Arquivar área FXL Tech').type).toBe('button')
  expect(buttonByAriaLabel('Restaurar área FXL Visual').type).toBe('button')
```

### Block C - a system função has no archive affordance at all

```
it('offers no archive affordance for vendedor or finder')
  render FuncoesView with [vendedor (isSystem), finder (isSystem), designer]
  expect(buttonByAriaLabel('Arquivar função Vendedor')).toBeNull()
  expect(buttonByAriaLabel('Arquivar função Finder')).toBeNull()
  expect(buttonByAriaLabel('Restaurar função Vendedor')).toBeNull()
  // Positive control: the affordance exists at all, so the negatives above are
  // about the system flag and not about a control that was never rendered.
  expect(buttonByAriaLabel('Arquivar função Designer')).not.toBeNull()
  // The existing lock stays, and it is still the only thing in that cell.
  const locked = buttonByAriaLabel('Função predefinida do app')
  expect(locked.disabled).toBe(true)
  await click(locked); expect(onArchive).not.toHaveBeenCalled()

it('offers no archive affordance for an optimistic row')
  render AreasView with area({ id: 'optimistic:areas:Nova' })
  expect(buttonByAriaLabel('Arquivar área Nova').disabled).toBe(true)
  await click(it); expect(onArchive).not.toHaveBeenCalled()
```

### Block D - the dialogs no longer own status

```
it('an edit never rewrites the stored status') // the produto bug
  render ProductDialog with an existing product({ status: 'archived' })
  submit
  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ status: 'archived' }))

it('a create still submits active')
  render ProductDialog with modal={{ kind: 'product' }}, fill name + área, submit
  expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ status: 'active' }))

it('no cadastro dialog offers a status picker any more')
  for AreaDialog / FuncaoDialog / PersonDialog on an existing row:
    expect(container.querySelector('button[role="combobox"][aria-label^="Status d"]')).toBeNull()
    submit -> onSave carries the row's stored status unchanged
```

### Block E - an archived produto leaves the wizard picker

```
it('keeps an archived produto out of the wizard picker but on the item that uses it')
  SaleWizardDialog with products [active 'FXL Finance', archived 'FXL Legado']
  open 'Produto / serviço do item 1' -> options contain 'FXL Finance', not 'FXL Legado'
  editSale whose item references the archived produto ->
    the trigger reads 'FXL Legado (arquivado)' and the option is offered on that row
  // Same rule the função cost row already proves in product-service-dialog.test.tsx.
```

If Block E proves awkward to drive through the whole wizard harness, it may instead be written against the exported pure helper (`selectableProducts`) plus a source assertion that line 7206 calls it - but the picker-level test is preferred, because a pure-function test cannot catch a call site that was never changed.

## 5. Existing tests that must be updated

These fail after the change and the executor must fix them; none of them is being weakened.

- **`apps/web/src/sales-ops/__tests__/areas-view.test.tsx`**
  - `creates an área submitting trimmed name and status` - drop the three `Status da área` combobox lines; the expected payload becomes `{ id: undefined, name: 'FXL BPO Sales', status: 'active' }`. Rename the test to `creates an área submitting the trimmed name`.
  - `edits an existing área keeping its id` - unchanged expectation (`status: 'active'` still holds, now sourced from the row).
  - Add `onArchive={vi.fn()}` to the four `<AreasView>` / `<ProductsView>` renders in this file (lines ~153, ~178, ~290).
- **`apps/web/src/sales-ops/__tests__/pessoas-funcoes-view.test.tsx`**
  - `creates a custom função submitting trimmed name and status` - drop the `Status da função` lines; expected payload becomes `{ id: undefined, name: 'Designer', status: 'active' }`. Rename to `creates a custom função submitting the trimmed name`.
  - `edits a custom função keeping its id and locks a system one` - drop `expect(combobox('Status da função').disabled).toBe(true)`; keep the disabled name input, the disabled `Salvar`, the `Função predefinida do app` text and the `onSave` not-called assertion.
  - Add `onArchive={vi.fn()}` to the four `<PessoasView>` / `<FuncoesView>` renders (lines ~250, ~276, ~480, ~510, ~521).
  - The `pessoa dialog UI contract` source-assertion block: add `expect(source).not.toContain('Status da pessoa')` and `expect(source).not.toContain('Status da área')` and `expect(source).not.toContain('Status da função')` so the three pickers cannot come back, in the same idiom the file already uses for `Adicionar função`.
- **`apps/web/src/sales-ops/__tests__/produtos-servicos-view.test.tsx`** - add `onArchive: vi.fn()` to the `renderView` helper's `<ProductsView>`.
- **`apps/web/src/sales-ops/__tests__/product-commission-editor.test.tsx`** - add `onArchive={vi.fn()}` to the `<ProductsView>` render at ~line 300.
- **`apps/web/src/sales-ops/__tests__/product-service-dialog.test.tsx`** - the create-path payload assertion at line ~1291 already expects `status: 'active'` and stays green, because the create path still resolves to `'active'` through the `??`. No edit expected; if it fails, the `??` fallback was written wrong.
- **`apps/web/src/sales-ops/__tests__/cadastros-refresh.test.tsx`** - mocks `../api` with an explicit object literal; add `setCadastroStatus: vi.fn()` to it so the module shape still matches.

## 6. How to run

```bash
pnpm --filter @fxl-sales/web test -- cadastro-archive
pnpm --filter @fxl-sales/web test
pnpm run lint
pnpm run type-check
pnpm test
```

`vitest run` is what `@fxl-sales/web`'s `test` script already invokes, so nothing here leaves a watcher behind.
No dev server, no API server and no database are needed: every test in this slice is happy-dom with a stubbed `fetch` or a mocked module.

Manual check, one pass per screen at `/cadastros/produtos`, `/cadastros/areas`, `/cadastros/pessoas`, `/cadastros/funcoes`:
archive a row, read the confirmation, confirm, watch the badge flip and the control become `Restaurar`, restore it, and confirm the row returns to `Ativa`.
Then open a proposta wizard and confirm an archived produto is absent from the item picker while a stored proposta that uses one still names it `(arquivado)`.

## 7. Deliberate exclusions, and what they hand to other slices

**Cliente has no archive affordance in this slice.**
`sales_ops_clients` has no `status` column, `ClientSchema` declares none, and `SalesOpsClient` carries none.
Shipping a control here would send a key zod silently strips and answer `200` on a row that did not change - a no-op that reads as success, which is worse than no control.
Slice 04 reached the identical conclusion independently, and slice 01 originally planned to add the column.
**At plan-check the column was struck from the whole feature**: shipping a migration plus a zod key plus service plumbing that no UI in the feature calls is dead code behind an irreversible schema change.
The full deferral note - exactly what a future slice must do - lives in `nexo/runs/feature-20260805-cadastro-archive-history/00-OVERVIEW.md`, ready for `nexo/ROADMAP.md`.
Should it land, this slice's UI absorbs cliente by adding `'cliente'` to `CadastroKind`, `'clients'` to `CadastroResource`, one row to `cadastroArchive`, and the three-line block to `ClientsView` - no other change. The client picker in the proposta wizard would then need the `selectableProducts` treatment.

**`SettingsView` is not touched.**
Slice 04 owns the history panel in `cadastros/geral`.

**Notes for slice 04, corrected at plan-check:**

- The restore control it needs already exists as `useSetSalesOpsCadastroStatus` in `apps/web/src/sales-ops/hooks.ts`, plus `SetCadastroStatusPayload`, `CadastroResource` and `CadastroStatus` in `apps/web/src/sales-ops/api.ts`. Slice 04 **must** use these and is forbidden from building a second restore path.
- Slice 04 does **not** reuse `cadastroArchive`. Its history kinds come from slice 01's ledger `entity_type` (`produto` / `pessoa` / `funcao` / `area`), which is a different vocabulary from this slice's `CadastroKind` (`produto` / `servico` / `area` / `funcao` / `pessoa` - it splits produto from serviço for confirmation copy, which a ledger row cannot). Slice 04 maps `entity_type` to a `CadastroResource` with its own two-line table.
- The hook takes `status: 'active' | 'archived' | 'inactive'` precisely so slice 04 can call it with `'active'` for a restore instead of needing a second endpoint. For a pessoa it must send `'inactive'`/`'active'`, never `'archived'`.
- It declares `invalidates: [queryKeys.salesOps.all]`, which is `['sales-ops']`. **Slice 04 does NOT need to add its history key to that list** - an earlier version of this note said it did, and that was wrong. TanStack invalidates by prefix and slice 04's key is `['sales-ops', 'cadastro-history', ...]`, so it is already covered. That prefix relationship is exactly why slice 04 nests its key under `salesOps` rather than at the root.

**No audit entry is written by this slice.**
**Slice 01** (not 02) owns `writeAuditEntry` on the sales-ops write path.
Because this slice archives through the *existing* PATCH endpoints rather than a new one, slice 01's instrumentation of `updateProduct` / `updateArea` / `updateFuncao` / `updatePerson` covers it automatically with no further web change - including if this slice lands first, in which case the ledger simply starts recording once slice 01 lands.

**No proposta, receivable or payable is archivable.**
Those have their own lifecycle (`transition`, `cancel-contract`) and the Frame puts them out of scope.

## 8. Risks

- **Removing the three `Status` pickers is a visible behaviour change.** An operator who learned to archive through the edit dialog will find it gone. Mitigated by the row control being strictly more discoverable and by `Restaurar` living on the same row. The source assertions in §5 keep the pickers from being reinstated as a third door.
- **`FuncoesView` is the one place where getting the branch wrong is a 409.** The archive control must be inside the `isSystem === false` branch, not merely disabled inside a shared branch. Block C's negative assertions plus the positive control on `Designer` are what catch a mis-wire.
- **Hooks-before-early-return.** Three of the four views return early for the empty state. `useCadastroArchive` placed after that `if` is a `react-hooks/rules-of-hooks` lint failure, and it is the single most likely mechanical mistake in this slice.
- **happy-dom activation behaviour.** `dispatchEvent` never runs a click's activation behaviour, so a DOM-level click test cannot see a button whose `type` makes it submit a form. The row controls are not inside a form, but Block B asserts `type === 'button'` on both rather than trusting the click.
- **`selectableProducts` and the edit path.** If the "keep the currently referenced produto" branch is dropped, a stored proposta that references an archived produto would render its item picker on the placeholder and an operator could save the item with an empty `productId`. Block E's second half is the guard.
- **`neutralBadgeClass` is declared below `ProductsView`.** It is a module-scope `const` read inside a render function, so evaluation order is fine, but an executor who moves the declaration into a component would break it. Leave it where it is.
- **The `Nome` cell badge is the only archived marker on produtos.** If someone later hides archived produtos behind a filter, the `code_suffix` argument in §2.4 has to be revisited first.
