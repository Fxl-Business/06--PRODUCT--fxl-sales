---
id: 05-areas-web
milestone: v2.3.0
status: done
depends_on: [01-areas-backend]
files_modified:
  - apps/web/src/sales-ops/navigation.ts
  - apps/web/src/sales-ops/types.ts
  - apps/web/src/sales-ops/api.ts
  - apps/web/src/sales-ops/hooks.ts
  - apps/web/src/sales-ops/SalesOpsApp.tsx
  - apps/web/src/sales-ops/__tests__/navigation.test.ts
  - apps/web/src/sales-ops/__tests__/areas-view.test.tsx
  - apps/web/src/sales-ops/__tests__/product-commission-editor.test.tsx
  - apps/web/src/sales-ops/__tests__/routing.test.tsx
  - apps/web/src/sales-ops/__tests__/calculations.test.ts
  - apps/web/src/sales-ops/__tests__/sale-wizard-commission-defaults.test.tsx
  - apps/web/src/sales-ops/__tests__/sale-wizard-custom-item-labels.test.tsx
  - CLAUDE.md
acceptance: "Given an admin on /cadastros/areas with bootstrap areas loaded, when they create an área named FXL Tech via the Nova área dialog and then open the product dialog, then the área row appears in the Áreas table and the product form refuses to submit until that área is selected and includes its areaId in the save payload."
---

# 05-areas-web - Áreas on the web (Cadastros view + product dialog swap)

## Scope guard

This slice touches only the Áreas surface on the web: the new `cadastros/areas` view, its CRUD dialog, the product dialog Tipo-to-Área swap, the ProductsView column, types/api/hooks plumbing, tests, and the CLAUDE.md routes line.
It does not touch the sale wizard, `SaleDraftItem.productType`, `buildSalePayload`, `calculations.ts`, `statusMeta`, or any proposal code (slices 06-08).
`sale-wizard-ui-contract.test.ts` asserts none of the strings this slice changes, so it stays untouched.
All line numbers below are anchors as of commit `1d0bab0`; match on the quoted code, not the number.

## Backend contract consumed (from slice 01)

Bootstrap gains `areas: SalesOpsArea[]` serialized like `clients` (camelCase, ISO timestamps).
Endpoints: `POST /api/v1/sales-ops/areas` with `{name, status?}` returning `{area}`, and `PATCH /api/v1/sales-ops/areas/:id` with a partial body returning `{area}`.
`sales_ops_products` rows gain `areaId: string | null` in the bootstrap payload, and product create requires `areaId`.
If slice 01's plan diverges from these shapes, slice 01 wins and this plan's executor adapts field names only, never structure.

## 1. types.ts

Add after `SalesOpsClient` (line 63):

```ts
export type SalesOpsArea = {
  id: string;
  orgId: string;
  name: string;
  status: 'active' | 'archived';
  createdAt: string;
  updatedAt: string | null;
};
```

In `SalesOpsProduct` (line 31), add `areaId: string | null;` directly after `codeSuffix: string;`.
Keep `type: string;` on `SalesOpsProduct` because the API still returns it until the backend drops the column.

In `SalesOpsBootstrap` (line 142), add `areas: SalesOpsArea[];` after `clients: SalesOpsClient[];`.

## 2. api.ts

Import `SalesOpsArea` in the type import block.

Add after `SaveClientPayload` (line 38):

```ts
export type SaveAreaPayload = Omit<
  Partial<SalesOpsArea>,
  'id' | 'orgId' | 'createdAt' | 'updatedAt'
> & { id?: string; name: string };
```

Add to `salesOpsApi` after `saveClient` (line 79), mirroring the `saveClient` POST/PATCH split:

```ts
saveArea: (payload: SaveAreaPayload, token: Token) => {
  const { id, ...body } = payload;
  return apiFetch<{ area: SalesOpsArea }>(
    id ? `/api/v1/sales-ops/areas/${id}` : '/api/v1/sales-ops/areas',
    { method: id ? 'PATCH' : 'POST', token, body: JSON.stringify(body) },
  );
},
```

## 3. hooks.ts

Import `SaveAreaPayload` from `./api`.

In the `useSalesOpsBootstrap` select coercion (lines 26-34), add after the `clients` line:

```ts
areas: Array.isArray(data.areas) ? data.areas : [],
```

Add after `useSaveSalesOpsClient` (line 77), identical in shape to it:

```ts
export function useSaveSalesOpsArea() {
  const { getToken } = useAccessToken();
  const invalidate = useInvalidateSalesOps();
  return useMutation({
    mutationFn: async (payload: SaveAreaPayload) =>
      salesOpsApi.saveArea(payload, await requireToken(getToken)),
    onSuccess: () => {
      void invalidate();
    },
  });
}
```

## 4. navigation.ts

Add `Layers` to the lucide-react import list (alphabetical, between `Database` and `Search`).

Extend the `SalesOpsView` union (line 15) with `| 'areas'` placed after `'produtos'`.

Insert into the `cadastros` array (line 56) directly after the `produtos` entry:

```ts
{ id: 'areas', label: 'Áreas', icon: Layers },
```

Final `cadastros` order: `produtos`, `areas`, `clientes`, `vendedores`, `finders`, `geral`.
No other navigation function changes; visibility falls out of the existing workspace logic.

## 5. SalesOpsApp.tsx

### 5.1 Imports and constants

Add `useSaveSalesOpsArea` to the `./hooks` import (line 55).
Add `SalesOpsArea` to the `./types` import (line 74).
Add `SaveAreaPayload` to the `./api` type import (line 94).
In `emptyBootstrap` (line 101), add `areas: [],` after `clients: [],`.
Delete line 122 entirely: `const productTypeOptions = ['SaaS', 'Custom', 'Advisor', 'Visual'];`.

### 5.2 ModalState (line 138)

Add a variant after the `client` entry:

```ts
| { kind: 'area'; area?: SalesOpsArea }
```

### 5.3 titleForView (line 144)

Add to the map after `produtos`:

```ts
areas: {
  title: 'Áreas',
  subtitle: 'Unidades de negócio que classificam produtos e itens de venda',
},
```

### 5.4 Component wiring

In `SalesOpsApp` (line 481), add `const saveArea = useSaveSalesOpsArea();` after the `saveClient` hook (line 489).

In `runHeaderAction` (line 559), insert after the `produtos` branch:

```ts
if (view === 'areas') {
  setModal({ kind: 'area' });
  return;
}
```

In the `headerAction` ternary (line 579), insert a branch so the chain reads:

```ts
view === 'geral'
  ? null
  : view === 'produtos'
    ? 'Novo produto'
    : view === 'areas'
      ? 'Nova área'
      : view === 'clientes'
        ? 'Novo cliente'
        // ...rest unchanged
```

### 5.5 Render switch (lines 939-985)

Pass areas into ProductsView (line 966):

```tsx
{view === 'produtos' ? (
  <ProductsView
    areas={bootstrap.areas}
    products={bootstrap.products}
    onEdit={(product) => setModal({ kind: 'product', product })}
  />
) : null}
```

Insert after the `clientes` block (line 977):

```tsx
{view === 'areas' ? (
  <AreasView
    bootstrap={bootstrap}
    onEdit={(area) => setModal({ kind: 'area', area })}
  />
) : null}
```

### 5.6 Dialog mounts (after line 1008)

Pass areas into the ProductDialog mount (line 992): add `areas={bootstrap.areas}` next to `collaborators`.

Insert after the `ClientDialog` mount:

```tsx
<AreaDialog
  modal={modal?.kind === 'area' ? modal : null}
  onClose={() => setModal(null)}
  onSave={(payload) => {
    saveArea.mutate(payload, { onSuccess: () => setModal(null) });
  }}
  saving={saveArea.isPending}
/>
```

### 5.7 AreasView (new, insert after ClientsView, line 1606)

Exported for tests, modeled cell-for-cell on `ClientsView`:

```tsx
export function AreasView({
  bootstrap,
  onEdit,
}: {
  bootstrap: SalesOpsBootstrap;
  onEdit: (area: SalesOpsArea) => void;
}) {
  if (bootstrap.areas.length === 0) {
    return (
      <EmptyPanel
        text="Cadastre áreas para classificar produtos e itens de venda por unidade de negócio."
        title="Nenhuma área cadastrada"
      />
    );
  }

  return (
    <div className={`${panelClass} overflow-hidden`}>
      <Table>
        <TableHeader>
          <TableRow className="bg-[#fafafb] hover:bg-[#fafafb]">
            <TableHead className={tableHeadClass}>Nome</TableHead>
            <TableHead className={`${tableHeadClass} text-center`}>Status</TableHead>
            <TableHead className={`${tableHeadClass} text-center`}>Nº produtos</TableHead>
            <TableHead className={`${tableHeadClass} text-center`}>Ações</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {bootstrap.areas.map((area) => {
            const productCount = bootstrap.products.filter(
              (product) => product.areaId === area.id,
            ).length;
            return (
              <TableRow key={area.id}>
                <TableCell className="px-4 py-3 text-sm font-semibold">{area.name}</TableCell>
                <TableCell className="px-4 py-3 text-center">
                  <Badge
                    className={
                      area.status === 'active'
                        ? 'bg-[#c9e7cf] text-[#1f7d43]'
                        : 'bg-[#eeeef1] text-[#6a6a72]'
                    }
                  >
                    {area.status === 'active' ? 'Ativa' : 'Arquivada'}
                  </Badge>
                </TableCell>
                <TableCell className="sales-ops-num px-4 py-3 text-center text-[13.5px]">
                  {productCount}
                </TableCell>
                <TableCell className="px-4 py-3 text-center">
                  <button className={iconButtonClass} onClick={() => onEdit(area)} type="button">
                    <Edit3 className="h-[15px] w-[15px]" />
                  </button>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
```

### 5.8 AreaDialog (new, insert after ClientDialogBody, line 2618)

Exported for tests, modeled on `ClientDialog` plus `ClientDialogBody`:

```tsx
export function AreaDialog(props: {
  modal: Extract<ModalState, { kind: 'area' }> | null;
  onClose: () => void;
  onSave: (payload: SaveAreaPayload) => void;
  saving: boolean;
}) {
  if (!props.modal) return null;
  return (
    <AreaDialogBody
      key={props.modal.area?.id ?? 'new-area'}
      modal={props.modal}
      onClose={props.onClose}
      onSave={props.onSave}
      saving={props.saving}
    />
  );
}

function AreaDialogBody({
  modal,
  onClose,
  onSave,
  saving,
}: {
  modal: Extract<ModalState, { kind: 'area' }>;
  onClose: () => void;
  onSave: (payload: SaveAreaPayload) => void;
  saving: boolean;
}) {
  const [name, setName] = useState(modal.area?.name ?? '');
  const [status, setStatus] = useState<'active' | 'archived'>(modal.area?.status ?? 'active');

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    onSave({ id: modal.area?.id, name: name.trim(), status });
  }

  return (
    <Dialog onOpenChange={(open) => (!open ? onClose() : undefined)} open>
      <DialogContent className="max-w-[520px] rounded-[20px] border-none bg-white p-0">
        <DialogHeader className="border-b border-[#e8e8ec] px-6 py-5 text-left">
          <DialogTitle className="sales-ops-num text-[19px]">Área</DialogTitle>
          <DialogDescription>Unidade de negócio usada em produtos e vendas.</DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4 px-6 py-5" onSubmit={submit}>
          <Field label="Nome" required>
            <Input
              className="bg-[#fafafb]"
              onChange={(event) => setName(event.target.value)}
              value={name}
            />
          </Field>
          <Field label="Status">
            <NativeSelect
              aria-label="Status da área"
              onChange={(value) => setStatus(value as 'active' | 'archived')}
              value={status}
            >
              <option value="active">Ativa</option>
              <option value="archived">Arquivada</option>
            </NativeSelect>
          </Field>
          <div className="flex justify-end gap-3 border-t border-[#e8e8ec] pt-4">
            <SecondaryButton onClick={onClose}>Cancelar</SecondaryButton>
            <PrimaryButton disabled={saving || !name.trim()} type="submit">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Salvar
            </PrimaryButton>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
```

### 5.9 ProductForm and productForm() (lines 1809-1859)

In the `ProductForm` type, replace `type: string;` with `areaId: string;`.
In `productForm()`, replace `type: product?.type ?? 'SaaS',` with `areaId: product?.areaId ?? '',`.

### 5.10 ProductDialog and ProductDialogBody (lines 1989-2065)

Add `areas: SalesOpsArea[];` to both prop types and thread the prop from `ProductDialog` into `ProductDialogBody`.

In `ProductDialogBody`, add below the `set` helper:

```ts
const activeAreas = areas.filter((area) => area.status === 'active');
const currentArea =
  modal.product?.areaId != null
    ? areas.find((area) => area.id === modal.product?.areaId)
    : undefined;
const selectableAreas =
  currentArea && currentArea.status !== 'active'
    ? [currentArea, ...activeAreas]
    : activeAreas;
```

In `submit()` (line 2030), add a guard as the first statement after `event.preventDefault()`:

```ts
if (!form.areaId) return;
```

In the payload object, replace `type: form.type.trim() || 'SaaS',` with `areaId: form.areaId,`.
Do not send `type` at all; the backend keeps its own default until the column dies.

Replace the `Field label="Tipo"` block (lines 2141-2156) with:

```tsx
<Field label="Área" required>
  <div className="relative">
    <NativeSelect
      aria-label="Área do produto"
      className={`${formSelectClass} w-full`}
      onChange={(value) => set('areaId', value)}
      value={form.areaId}
    >
      <option disabled value="">
        Selecione a área
      </option>
      {selectableAreas.map((area) => (
        <option key={area.id} value={area.id}>
          {area.name}
        </option>
      ))}
    </NativeSelect>
    <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-[13px] w-[13px] -translate-y-1/2 text-[#8b8b92]" />
  </div>
</Field>
```

Change the footer submit button (line 2489) from `disabled={saving}` to `disabled={saving || !form.areaId}` so the required área is enforced both at the button and in `submit()`.

### 5.11 ProductsView (lines 1464-1548)

Add `areas: SalesOpsArea[];` to the props and destructure it.
Replace the header cell `Tipo` (line 1486) with `Área`.
Replace the body cell (line 1500) with:

```tsx
<TableCell className={tableCellClass}>
  {areas.find((area) => area.id === product.areaId)?.name ?? '-'}
</TableCell>
```

## 6. CLAUDE.md (repo root)

In the Sales Ops Routing section, edit the canonical routes sentence so the cadastros segment reads `cadastros/produtos|areas|clientes|vendedores|finders|geral`.
Exact replacement: change `` `cadastros/produtos|clientes|vendedores|finders|geral` `` to `` `cadastros/produtos|areas|clientes|vendedores|finders|geral` `` inside the existing sentence, leaving the rest of the line untouched.
The file already keeps each full sentence on its own line, so no reflow is needed.

## 7. Test updates

### 7.1 apps/web/src/sales-ops/__tests__/navigation.test.ts

In `renders fixed team navigation for the team workspaces` (line 43), change the cadastros expectation to `['produtos', 'areas', 'clientes', 'vendedores', 'finders', 'geral']`.
In `keeps valid routes and reports no redirect` (line 113), add:

```ts
expect(resolveSalesOpsRoute({ workspace: 'cadastros', view: 'areas' }, team)).toEqual({
  route: { workspace: 'cadastros', view: 'areas' },
  path: '/cadastros/areas',
  redirect: false,
});
```

In `redirects routes pointing at an invisible or forbidden target` (line 141), add:

```ts
expect(resolveSalesOpsRoute({ workspace: 'cadastros', view: 'areas' }, seller)).toEqual({
  route: { workspace: 'meus-dados', view: 'vendedores' },
  path: '/meus-dados/vendedores',
  redirect: true,
});
```

In `maps a view to its workspace` (line 189), add `expect(workspaceForView('areas', team)).toBe('cadastros');`.
All other assertions stay byte-identical; `getDefaultSalesOpsRoute(team, 'cadastros')` still resolves to `produtos` because it stays first.

### 7.2 apps/web/src/sales-ops/__tests__/areas-view.test.tsx (new file)

Copy the harness pattern from `product-commission-editor.test.tsx`: `// @vitest-environment happy-dom`, the same `vi.mock('@/components/ui/dialog', ...)`, `createRoot` setup, `act`, `click`, `change`, and `submit` helpers.
Import `{ AreaDialog, AreasView, ProductDialog, ProductsView }` from `../SalesOpsApp` after the dialog mock.
Add a select helper because the área picker is a native select:

```tsx
async function changeSelect(select: HTMLSelectElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set;
    setter?.call(select, value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
```

Fixtures:

```tsx
const area = (patch: Partial<SalesOpsArea> = {}): SalesOpsArea => ({
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  orgId: 'org-test',
  name: 'FXL Tech',
  status: 'active',
  createdAt: '2026-07-29T12:00:00.000Z',
  updatedAt: null,
  ...patch,
});
```

Plus a `product()` factory copied from `product-commission-editor.test.tsx` with `areaId: area().id`, and a `bootstrap()` helper returning a full `SalesOpsBootstrap` with `areas`, `products`, and empty remaining arrays.

Tests, exactly these names:

1. `it('lists áreas with status badges and linked product counts')`: render `AreasView` with two áreas (one `active`, one `archived` named `FXL Visual`) and one product linked to the first; assert text contains `FXL Tech`, `Ativa`, `FXL Visual`, `Arquivada`, and the count cell `1`.
2. `it('shows the empty panel when no área exists')`: render `AreasView` with `areas: []`; assert text contains `Nenhuma área cadastrada`.
3. `it('creates an área submitting trimmed name and status')`: render `AreaDialog` with `modal={{ kind: 'area' }}` and an `onSave` spy; type `  FXL BPO Sales  ` into the Nome input, select `archived` via `changeSelect` on `select[aria-label="Status da área"]`, submit, and assert `onSave` was called with `{ id: undefined, name: 'FXL BPO Sales', status: 'archived' }`.
4. `it('does not save an área without a name')`: render `AreaDialog` for a new área, submit immediately, and assert the spy was never called and the Salvar button is disabled.
5. `it('edits an existing área keeping its id')`: render `AreaDialog` with `modal={{ kind: 'area', area: area() }}`, change the name to `FXL Advisor`, submit, and assert the payload is `{ id: area().id, name: 'FXL Advisor', status: 'active' }`.
6. `it('requires an área before saving a product')`: render `ProductDialog` with `areas={[area()]}`, no product, fill Nome via its input placeholder, submit without touching the área select, assert `onSave` not called; then `changeSelect` on `select[aria-label="Área do produto"]` to `area().id`, submit again, and assert `onSave` received `expect.objectContaining({ areaId: area().id })` and no `type` key via `expect(onSave.mock.calls[0][0]).not.toHaveProperty('type')`.
7. `it('shows the área name instead of the legacy type in the products table')`: render `ProductsView` with `areas={[area()]}` and one product with `areaId: area().id` plus one with `areaId: null`; assert text contains `Área` and `FXL Tech`, contains a `-` cell for the null product, and does not contain the removed header `Tipo`.

### 7.3 apps/web/src/sales-ops/__tests__/product-commission-editor.test.tsx

Add a `SalesOpsArea` import and an `areaFixture` constant shaped like section 7.2 (reuse the same uuid).
Add `areaId: areaFixture.id` to the `product()` factory (line 31) so the type stays total.
Pass `areas={[areaFixture]}` in `renderDialog` (line 74) and in both direct `ProductDialog` renders (lines 196-215) and both `ProductsView` renders (line 230), the latter as `areas={[areaFixture]}`.
Add the `changeSelect` helper from 7.2 and a one-liner `async function chooseArea()` that sets `select[aria-label="Área do produto"]` to `areaFixture.id`.
In `submits every commission pair regardless of the active tab` and `preserves fixed type and value controls across switching, save, and reopen`, call `await chooseArea();` before `await submit();` because a new product now blocks submit without an área.
The reopened-product assertions need no área action since `product()` carries `areaId`.

### 7.4 apps/web/src/sales-ops/__tests__/routing.test.tsx

In the `vi.mock('../hooks', ...)` factory (line 57), add `areas: [],` to the bootstrap `data` object and add `useSaveSalesOpsArea: () => mutation,` alongside the other mutation mocks; without the latter `SalesOpsApp` crashes on the new unconditional hook call.

### 7.5 Fixture-only compile fixes

`apps/web/src/sales-ops/__tests__/calculations.test.ts` line 40: add `areas: [],` to the `SalesOpsBootstrap` literal.
`apps/web/src/sales-ops/__tests__/sale-wizard-commission-defaults.test.tsx`: add `areaId: null,` to the `product()` factory (line 30 region) and `areas: [],` to the `bootstrap` literal (line 66).
`apps/web/src/sales-ops/__tests__/sale-wizard-custom-item-labels.test.tsx`: same two additions in its `product` factory and `bootstrap` literal (line 65 region).
No behavior assertions change in these three files.

## 8. Execution order

1. types.ts, api.ts, hooks.ts, navigation.ts.
2. SalesOpsApp.tsx sections 5.1 through 5.11.
3. CLAUDE.md routes line.
4. Test updates 7.1 and 7.3 through 7.5, then the new 7.2 file.
5. Run `pnpm run lint`, `pnpm run type-check`, and `pnpm test` (run-once, no watch) at the repo root and fix fallout until green.

## 9. Oracle tests

Primary oracle: `apps/web/src/sales-ops/__tests__/areas-view.test.tsx` (all seven tests above).
Secondary oracle: `apps/web/src/sales-ops/__tests__/navigation.test.ts`, which pins the exact cadastros nav array including `areas`.
