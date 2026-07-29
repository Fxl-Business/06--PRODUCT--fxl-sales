---
id: 07-propostas-list-web
milestone: v2.3.0
status: done
depends_on: [04-proposal-transition-backend, 06-proposal-wizard-web]
files_modified:
  [
    apps/web/src/sales-ops/navigation.ts,
    apps/web/src/sales-ops/types.ts,
    apps/web/src/sales-ops/calculations.ts,
    apps/web/src/sales-ops/api.ts,
    apps/web/src/sales-ops/hooks.ts,
    apps/web/src/sales-ops/SalesOpsApp.tsx,
    apps/web/src/sales-ops/__tests__/navigation.test.ts,
    apps/web/src/sales-ops/__tests__/calculations.test.ts,
    apps/web/src/sales-ops/__tests__/routing.test.tsx,
    apps/web/src/sales-ops/__tests__/sales-view.test.tsx,
    apps/web/src/sales-ops/__tests__/sales-transition-actions.test.tsx,
  ]
acceptance: "Given a bootstrap with propostas in every status, when an admin in operacional/vendas opens the row menu of an open proposta and clicks Marcar como ganha, then the transition mutation is called with {saleId, status: 'won'}, the row chip renders Ganha in the green palette, and the same table rendered for meus-dados shows no row action menu while the read-only detail dialog still opens on row click."
---

# Slice 07: Propostas list view, transitions UI, and global status sweep

## Scope

This slice turns `operacional/vendas` into the Propostas operational table with real filters, row transition actions, a read-only detail dialog, and sweeps every web consumer of the old sale statuses (`forecast|closed|in_progress|completed`) to the new model (`draft|open|won|lost|cancelled`).
It also renames the operational nav label from Vendas to Propostas while the route slug stays `vendas`.
All work is in `apps/web/src`; the backend endpoints come from slice 04 and the wizard v2 from slice 06.

## Upstream interface assumptions (verify before coding)

Slices 01 to 06 execute before this slice but their plans were not yet written when this plan was authored, so verify each assumption by reading the code at execution time and reconcile names instead of duplicating.

1. `apps/web/src/sales-ops/types.ts` `SalesOpsStatus` is already `'draft' | 'open' | 'won' | 'lost' | 'cancelled'` (slice 06).
   If it still contains legacy values, update the union here.
2. `SalesOpsSale` already carries `wonAt: string | null` and `lostAt: string | null` (slice 06 payload work, backed by slice 02 columns).
   If missing, add both fields here; the API bootstrap returns them after slice 02/03.
3. `SalesOpsSaleItem` already carries `areaId: string | null` and `areaNameSnapshot: string` (slice 06).
   If missing, add both here.
4. `SalesOpsArea` type and `SalesOpsBootstrap.areas: SalesOpsArea[]` exist (slice 05).
   If missing, add `export type SalesOpsArea = { id: string; orgId: string; name: string; status: 'active' | 'archived'; createdAt: string; updatedAt: string | null };` and wire `areas` through the `useSalesOpsBootstrap` select with the same `Array.isArray` guard as the other arrays.
5. `SalesOpsBootstrap.receivables: SalesOpsReceivable[]` exists (slice 03 API, slice 06 web wiring).
   If the web type is missing, add `export type SalesOpsReceivable = { id: string; orgId?: string; saleId: string; dueDate: string; amountBrl: number; method: PaymentMethod; status: 'open' | 'paid' | 'void'; createdAt?: string; updatedAt?: string | null };` and add `receivables` to the bootstrap type, the `emptyBootstrap` constant, and the hook select guard.
6. Slice 06 already renamed the sidebar CTA (line ~796) and the header action fallback (line ~592) to "Nova proposta" and reworked `SaleWizardDialog`.
   Do not re-edit those strings; only verify they read "Nova proposta" and fail the slice if they do not, because that means wave ordering broke.
7. Read the slice 04 service code for the canonical voided payable status string (`void` per the overview for receivables; payables may stay `voided`).
   Mirror the exact backend string in the web `SalesOpsPayable['status']` union and in the badge logic below.
8. Slice 06 owns the wizard edit capability contract.
   If `SaleWizardDialog` already accepts an edit prop, adopt its exact prop name; otherwise implement the contract defined in "Edit-open mechanism" below and keep the wizard body prefill logic in slice 06's files untouched except for accepting the prop.

## 1. navigation.ts

Change the operational nav item label only; ids, icons, and the route slug stay unchanged.

```ts
const operational: SalesOpsNavigationItem[] = [
  { id: 'vendas', label: 'Propostas', icon: BriefcaseBusiness },
  { id: 'comissoes', label: 'Comissões', icon: BadgeDollarSign },
];
```

Update the workspace catalogue description for consistency with the rename:

```ts
{ id: 'operacional', label: 'Operacional', description: 'Propostas e conferência' },
```

`meusDadosFinder` keeps `{ id: 'vendas', label: 'Indicações' }` exactly as is.

## 2. types.ts

Beyond the verify-and-add items above, rename the dashboard KPI fields to the won vocabulary:

```ts
export type DashboardModel = {
  kpis: {
    wonRevenueBrl: number;
    activeMrrBrl: number;
    payableBrl: number;
    wonSalesCount: number;
  };
  // revenueByProduct, topSellers, topFinders, latestSales unchanged
};
```

## 3. calculations.ts

Replace the legacy closed set (line 12) and every use of it inside `buildDashboardModel` (lines ~164 to ~229):

```ts
const wonStatuses = new Set<string>(['won']);
```

Rename the local `closedSales` to `wonSales` (filter `wonStatuses.has(sale.status)` over `activeSales`, which stays `status !== 'cancelled'`).
`kpis` becomes `{ wonRevenueBrl: wonSales.reduce(...), activeMrrBrl, payableBrl, wonSalesCount: wonSales.length }`.
The seller and finder ranking loops keep iterating `wonSales` (renamed variable only).
`latestSales` stays `activeSales` sorted by time, so drafts and open propostas appear in the dashboard mini table.
`buildSalePayload` is untouched here; slice 06 owns the payload shape.

## 4. api.ts

Add the two transition functions to `salesOpsApi` following the existing `apiFetch` pattern:

```ts
export type TransitionSaleStatus = 'open' | 'won' | 'lost' | 'cancelled';
export type TransitionSalePayload = { saleId: string; status: TransitionSaleStatus };

transitionSale: ({ saleId, status }: TransitionSalePayload, token: Token) =>
  apiFetch<{ sale: unknown }>(`/api/v1/sales-ops/sales/${saleId}/transition`, {
    method: 'POST',
    token,
    body: JSON.stringify({ status }),
  }),
cancelContract: (saleId: string, token: Token) =>
  apiFetch<{ sale: unknown }>(`/api/v1/sales-ops/sales/${saleId}/cancel-contract`, {
    method: 'POST',
    token,
    body: JSON.stringify({}),
  }),
```

Reabrir is expressed as `status: 'open'`; there is no separate reopen endpoint per the overview contract.
If slice 04 shipped different paths, mirror slice 04 exactly and note the delta in the run capture.

## 5. hooks.ts

Two new mutations using the existing `useInvalidateSalesOps` pattern, exported next to `useCreateSalesOpsSale`:

```ts
export function useTransitionSalesOpsSale() {
  const { getToken } = useAccessToken();
  const invalidate = useInvalidateSalesOps();
  return useMutation({
    mutationFn: async (payload: TransitionSalePayload) =>
      salesOpsApi.transitionSale(payload, await requireToken(getToken)),
    onSuccess: () => {
      void invalidate();
    },
  });
}

export function useCancelSalesOpsContract() {
  const { getToken } = useAccessToken();
  const invalidate = useInvalidateSalesOps();
  return useMutation({
    mutationFn: async (saleId: string) =>
      salesOpsApi.cancelContract(saleId, await requireToken(getToken)),
    onSuccess: () => {
      void invalidate();
    },
  });
}
```

No toast layer exists in Sales Ops today; error handling stays at parity (mutation state only), do not introduce one.

## 6. SalesOpsApp.tsx

### 6.1 statusMeta rewrite (lines ~192 to ~202)

```ts
function statusMeta(status: SalesOpsStatus) {
  const map: Record<SalesOpsStatus, { label: string; className: string }> = {
    draft: { label: 'Rascunho', className: 'bg-[#e9e9ed] text-[#6a6a72]' },
    open: { label: 'Aberta', className: 'bg-[#d3e3f6] text-[#2664ad]' },
    won: { label: 'Ganha', className: 'bg-[#c9e7cf] text-[#1f7d43]' },
    lost: { label: 'Perdida', className: 'bg-[#f6d1c5] text-[#a5341c]' },
    cancelled: { label: 'Cancelada', className: 'bg-[#eeeef1] text-[#6a6a72]' },
  };
  return map[status] ?? { label: status, className: 'bg-[#e9e9ed] text-[#6a6a72]' };
}
```

The fallback keeps the UI alive if an unmigrated status ever leaks through.

### 6.2 titleForView (lines ~144 to ~181)

```ts
vendas: {
  title: personal ? 'Minhas indicações' : 'Propostas',
  subtitle: personal
    ? 'Registro operacional com código, cliente, produto, responsável e status'
    : 'Propostas com código, cliente, áreas, responsáveis, status e ciclo de vida',
},
```

The personal branch keeps the existing finder wording untouched.

### 6.3 Filter state and panel (state near line 495, panel lines ~909 to ~927)

Add next to `filtersOpen`:

```ts
type SalesFilters = { status: SalesOpsStatus | 'all'; areaId: string | 'all' };
const [salesFilters, setSalesFilters] = useState<SalesFilters>({ status: 'all', areaId: 'all' });
```

Add a memo after `dashboard`:

```ts
const filteredSales = useMemo(() => {
  return bootstrap.sales.filter((sale) => {
    if (salesFilters.status !== 'all' && sale.status !== salesFilters.status) return false;
    if (salesFilters.areaId !== 'all') {
      const match = bootstrap.saleItems.some(
        (item) => item.saleId === sale.id && item.areaId === salesFilters.areaId,
      );
      if (!match) return false;
    }
    return true;
  });
}, [bootstrap.sales, bootstrap.saleItems, salesFilters]);
```

Split the filters strip so vendas gets real controls and comissoes keeps its current placeholder block byte for byte:

```tsx
{filtersOpen && view === 'vendas' ? (
  <div className="flex flex-none flex-wrap items-center gap-3 border-b border-[#ececf1] bg-white px-[22px] py-[13px]">
    <span className="text-xs font-bold uppercase tracking-[0.08em] text-[#9b9ba3]">Filtros</span>
    <NativeSelect
      aria-label="Filtrar por status"
      className="w-[190px]"
      onChange={(value) => setSalesFilters((f) => ({ ...f, status: value as SalesFilters['status'] }))}
      value={salesFilters.status}
    >
      <option value="all">Todos os status</option>
      <option value="draft">Rascunho</option>
      <option value="open">Aberta</option>
      <option value="won">Ganha</option>
      <option value="lost">Perdida</option>
      <option value="cancelled">Cancelada</option>
    </NativeSelect>
    <NativeSelect
      aria-label="Filtrar por área"
      className="w-[190px]"
      onChange={(value) => setSalesFilters((f) => ({ ...f, areaId: value }))}
      value={salesFilters.areaId}
    >
      <option value="all">Todas as áreas</option>
      {bootstrap.areas.map((area) => (
        <option key={area.id} value={area.id}>{area.name}</option>
      ))}
    </NativeSelect>
    <span className="ml-auto text-[13px] text-[#8b8b92]">
      <span className="sales-ops-num font-bold text-[#201f24]">{filteredSales.length}</span> registros
    </span>
  </div>
) : null}
{filtersOpen && view === 'comissoes' ? (
  /* existing placeholder block unchanged, with the count reading bootstrap.payables.length */
) : null}
```

### 6.4 Edit-open mechanism (implemented by slice 06 - this slice only wires the row action)

Plan-check update (2026-07-29): slice 06 (`06-proposal-wizard-web.md`, "Edit support" section E1-E7) now ships the entire mechanism this section originally specified as a forward contract - the `SaleWizardRequest` union, the `saleWizard`/`setSaleWizard` state, the `<SaleWizardDialog>` wiring (`open`, `editSale`, the `onSave` branch that picks `createSale.mutate` vs `updateSale.mutate`), the remount key, `updateSale` in `api.ts`, and `useUpdateSalesOpsSale` in `hooks.ts`, all under the exact names below. This slice's executor MUST NOT redeclare `SaleWizardRequest`, `saleWizard`/`setSaleWizard`, or the `<SaleWizardDialog>` call site - that already exists in the file from slice 06's wave. This slice's only remaining job here is the row action call site in section 6.7 (`onEdit={(sale) => setSaleWizard({ mode: 'edit', sale })}`), which slice 06 explicitly left unset (no UI sets `mode: 'edit'` before this slice).

For reference, the shape already shipped by slice 06:

```ts
type SaleWizardRequest = { mode: 'create' } | { mode: 'edit'; sale: SalesOpsSale };
const [saleWizard, setSaleWizard] = useState<SaleWizardRequest | null>(null);
```

`SaleWizardDialog` receives `open={saleWizard !== null}` plus `editSale={saleWizard?.mode === 'edit' ? saleWizard.sale : null}`.
`SaleWizardDialog` accepts `editSale: SalesOpsSale | null`; when non-null the wizard body prefills from `editSale` plus `bootstrap.saleItems`, `bootstrap.receivables`, and `bootstrap.saleProfessionals` filtered by `editSale.id`, and submits through slice 06's `useUpdateSalesOpsSale` mutation (`PUT` replace of a non-won proposta).
The remount key is already extended with `editSale?.id ?? 'create'` so a stale draft never leaks between edits.
If slice 06's shipped code diverges from this (different names, missing pieces), stop and escalate as a blocking scope gap rather than silently re-implementing a parallel mechanism.

### 6.5 SalesView rewrite (lines ~1226 to ~1292)

Export `SalesView` (test seam, same pattern as `ProductsView`) with this signature:

```tsx
export function SalesView({
  bootstrap,
  sales,
  canManage,
  onEdit,
  onTransition,
  onCancelContract,
}: {
  bootstrap: SalesOpsBootstrap;
  sales: SalesOpsSale[];
  canManage: boolean;
  onEdit: (sale: SalesOpsSale) => void;
  onTransition: (sale: SalesOpsSale, status: TransitionSaleStatus) => void;
  onCancelContract: (sale: SalesOpsSale) => void;
})
```

Local state:

```ts
type PendingSaleAction =
  | { kind: 'lost'; sale: SalesOpsSale }
  | { kind: 'cancelled'; sale: SalesOpsSale }
  | { kind: 'reopen-won'; sale: SalesOpsSale }
  | { kind: 'cancel-contract'; sale: SalesOpsSale };
const [pendingAction, setPendingAction] = useState<PendingSaleAction | null>(null);
const [detailSaleId, setDetailSaleId] = useState<string | null>(null);
```

Áreas cell helper (module scope, next to `salePrimaryProductName`):

```ts
function saleAreaNames(bootstrap: SalesOpsBootstrap, saleId: string): string {
  const names = [
    ...new Set(
      bootstrap.saleItems
        .filter((item) => item.saleId === saleId)
        .map((item) => item.areaNameSnapshot)
        .filter(Boolean),
    ),
  ];
  return names.length > 0 ? names.join(', ') : '-';
}
```

Table columns become exactly: Código, Cliente, Vendedor, Áreas, Total, Status, Data, plus a trailing Ações column rendered only when `canManage`.
Cliente keeps the bold cell, Vendedor renders `sale.sellerNameSnapshot`, Áreas renders `saleAreaNames(bootstrap, sale.id)`, Total renders `formatMoneyBrl(sale.totalBrl, { maximumFractionDigits: 0 })` right aligned, Status renders the `statusMeta` Badge, Data renders `displayDate(sale.baseDate)` right aligned.
The Produto, Finder, and Condição columns are removed from this table (they live in the detail dialog).
Each `TableRow` gets `className="cursor-pointer"` and `onClick={() => setDetailSaleId(sale.id)}`; the Ações cell wraps its content in a div with `onClick={(event) => event.stopPropagation()}`.
The empty state copy becomes title "Nenhuma proposta registrada" and text "As propostas são carregadas da API de operações comerciais. Use Nova proposta para registrar a primeira.".
When `sales.length === 0` but `bootstrap.sales.length > 0` (filters excluded everything) render `EmptyPanel` with title "Nenhuma proposta encontrada" and text "Ajuste os filtros de status e área para ver outras propostas.".

Row actions menu, using the existing dropdown-menu component and a new `MoreHorizontal` lucide import:

```tsx
<DropdownMenu>
  <DropdownMenuTrigger asChild>
    <button aria-label={`Ações da proposta ${sale.code}`} className={iconButtonClass} type="button">
      <MoreHorizontal className="h-[15px] w-[15px]" />
    </button>
  </DropdownMenuTrigger>
  <DropdownMenuContent align="end" className="w-[220px] rounded-xl border-[#e5e5ea] bg-white p-1.5">
    {(sale.status === 'draft' || sale.status === 'open') ? (
      <>
        <DropdownMenuItem onSelect={() => onEdit(sale)}>Editar</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onTransition(sale, 'won')}>Marcar como ganha</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setPendingAction({ kind: 'lost', sale })}>Marcar como perdida</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setPendingAction({ kind: 'cancelled', sale })}>Cancelar</DropdownMenuItem>
      </>
    ) : null}
    {sale.status === 'won' ? (
      <>
        <DropdownMenuItem onSelect={() => setPendingAction({ kind: 'reopen-won', sale })}>Reabrir</DropdownMenuItem>
        {sale.recurringBrl > 0 ? (
          <DropdownMenuItem onSelect={() => setPendingAction({ kind: 'cancel-contract', sale })}>
            Cancelar contrato
          </DropdownMenuItem>
        ) : null}
      </>
    ) : null}
    {(sale.status === 'lost' || sale.status === 'cancelled') ? (
      <DropdownMenuItem onSelect={() => onTransition(sale, 'open')}>Reabrir</DropdownMenuItem>
    ) : null}
  </DropdownMenuContent>
</DropdownMenu>
```

Action gating rationale, locked: Editar only for draft and open (the update endpoint replaces non-won propostas); Marcar como ganha needs no confirmation because it is constructive; Reabrir from lost or cancelled needs no confirmation because no payables exist there; Reabrir from won, Marcar como perdida, Cancelar, and Cancelar contrato confirm through the alert dialog because they destroy or void ledger state; Cancelar contrato requires `status === 'won' && recurringBrl > 0`.
The backend from slice 04 remains the authority on legal transitions; an illegal request surfaces as a failed mutation and the table simply does not change.

Confirmation dialog, one controlled `AlertDialog` instance at the bottom of `SalesView` (new imports from `@/components/ui/alert-dialog`):

```tsx
const confirmCopy: Record<PendingSaleAction['kind'], { title: string; description: (code: string) => string; action: string }> = {
  lost: {
    title: 'Marcar proposta como perdida?',
    description: (code) => `A proposta ${code} será marcada como perdida.`,
    action: 'Marcar como perdida',
  },
  cancelled: {
    title: 'Cancelar proposta?',
    description: (code) => `A proposta ${code} será cancelada e as contas a pagar em aberto serão anuladas.`,
    action: 'Cancelar proposta',
  },
  'reopen-won': {
    title: 'Reabrir proposta ganha?',
    description: (code) => `As contas a pagar em aberto geradas pela proposta ${code} serão anuladas. Pagamentos já baixados não são afetados.`,
    action: 'Reabrir',
  },
  'cancel-contract': {
    title: 'Cancelar contrato?',
    description: (code) => `As parcelas futuras em aberto da proposta ${code} e as comissões vinculadas serão anuladas. Parcelas pagas não são afetadas.`,
    action: 'Cancelar contrato',
  },
};

<AlertDialog onOpenChange={(open) => (!open ? setPendingAction(null) : undefined)} open={pendingAction !== null}>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>{pendingAction ? confirmCopy[pendingAction.kind].title : ''}</AlertDialogTitle>
      <AlertDialogDescription>
        {pendingAction ? confirmCopy[pendingAction.kind].description(pendingAction.sale.code) : ''}
      </AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel>Voltar</AlertDialogCancel>
      <AlertDialogAction onClick={confirmPendingAction}>
        {pendingAction ? confirmCopy[pendingAction.kind].action : ''}
      </AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
```

```ts
function confirmPendingAction() {
  if (!pendingAction) return;
  const { kind, sale } = pendingAction;
  if (kind === 'cancel-contract') onCancelContract(sale);
  else if (kind === 'reopen-won') onTransition(sale, 'open');
  else onTransition(sale, kind);
  setPendingAction(null);
}
```

### 6.6 SaleDetailDialog (new component in SalesOpsApp.tsx)

Rendered inside `SalesView` after the table, using the existing `Dialog` primitives and the wizard dialog's visual shell classes:

```tsx
function SaleDetailDialog({
  bootstrap,
  sale,
  onClose,
}: {
  bootstrap: SalesOpsBootstrap;
  sale: SalesOpsSale | null;
  onClose: () => void;
})
```

`SalesView` derives `const detailSale = sales.find((s) => s.id === detailSaleId) ?? bootstrap.sales.find((s) => s.id === detailSaleId) ?? null;` so the dialog stays fresh after invalidation and survives filter changes.
Content, top to bottom, all read only:

1. `DialogHeader` with `DialogTitle` rendering `Proposta {sale.code}` plus the `statusMeta` Badge, and `DialogDescription` rendering `{clientNameSnapshot} · Vendedor {sellerNameSnapshot}` plus `· Finder {finderNameSnapshot}` when present and `· {displayDate(sale.baseDate)}`.
2. "Itens" table with columns Item (`productNameSnapshot`), Área (`areaNameSnapshot || '-'`), Qtd, Unitário, Subtotal from `bootstrap.saleItems.filter((item) => item.saleId === sale.id)`.
3. "Plano de pagamento" table from `bootstrap.receivables.filter((row) => row.saleId === sale.id)` sorted ascending by `dueDate`, columns Vencimento (`displayDate`), Método (label map pix PIX, card Cartão, boleto Boleto, transfer Transferência), Valor (`formatMoneyBrl`), Status chip (open Aberta amber `bg-[#fdf0cf] text-[#7a5a12]`, paid Paga green `bg-[#c9e7cf] text-[#1f7d43]`, void Anulada gray `bg-[#eeeef1] text-[#6a6a72]`).
   When the sale has `recurringBrl > 0`, append a muted footer line `Recorrência de {formatMoneyBrl(sale.recurringBrl)} por mês`.
   When there are no rows at all, render `EmptyPanel` with title "Sem plano de parcelas" and text "Esta proposta não possui parcelas registradas.".
4. "Contas a pagar" table, rendered only when `bootstrap.payables.some((p) => p.saleId === sale.id)` (which per the domain contract only happens at or after won), columns Beneficiário, Tipo (`payableTypeMeta` Badge), Vencimento, Valor, Status (same three-state chip: paid Pago, voided/void Anulado, else Aberto).
5. "Margem" summary grid with rows Total (`totalBrl`), Comissão vendedor (`sellerCommissionBrl`), Comissão finder (`finderCommissionBrl`, hidden when 0 and no finder), Imposto (`taxBrl`), Custos profissionais (`professionalCostsBrl`), Outros custos (`otherCostsBrl`), and a bold final row Margem líquida rendering `netMarginBrl` plus `({netMarginPct}%)`.
6. `sale.notes` rendered in a muted paragraph when present.

The dialog opens for every workspace; only the row action menu is admin gated.

### 6.7 SalesView call site (line ~942)

```tsx
{view === 'vendas' ? (
  <SalesView
    bootstrap={bootstrap}
    canManage={workspace === 'operacional'}
    onCancelContract={(sale) => cancelContract.mutate(sale.id)}
    onEdit={(sale) => setSaleWizard({ mode: 'edit', sale })}
    onTransition={(sale, status) => transitionSale.mutate({ saleId: sale.id, status })}
    sales={filteredSales}
  />
) : null}
```

`const transitionSale = useTransitionSalesOpsSale();` and `const cancelContract = useCancelSalesOpsContract();` join the other mutation hooks at the top of `SalesOpsApp`.
`canManage={workspace === 'operacional'}` is the whole meus-dados story: the same component renders read only there, actions column and menu absent, detail dialog still available.
Data scoping for meus-dados stays backend and RLS authoritative per the repo contract; the web layer adds no extra filtering.

### 6.8 Dashboard and global sweep

`DashboardView` (lines ~1032 to ~1130):

- `closedSalesLabel` becomes `wonSalesLabel = dashboard.kpis.wonSalesCount === 1 ? '1 proposta ganha' : `${dashboard.kpis.wonSalesCount} propostas ganhas`;`.
- KPI card 1: label "Receita ganha no mês", value `wonRevenueBrl`, sub `wonSalesLabel`.
- KPI card 4: label "Propostas ganhas", sub "Propostas com status ganha", value `String(dashboard.kpis.wonSalesCount)`.
- Panel heading "Últimas vendas" becomes "Últimas propostas" and its empty text becomes "Use o botão Nova proposta para registrar o primeiro negócio real.".
- `RankingPanel` empty text becomes "O ranking será calculado a partir das propostas ganhas.".

`personMetrics` (lines ~276 to ~290) switches its aggregate base from `status !== 'cancelled'` to `status === 'won'` so seller and finder cards never count open or lost propostas in commission and ticket, and the card sub line "vendas no período" becomes "propostas ganhas no período" in `PeopleView`.
`CommissionsView` payable status Badge gains the third state: paid renders Pago green, the slice 04 voided value renders Anulado with `bg-[#eeeef1] text-[#6a6a72]`, anything else renders Aberto amber.
Remove `conditionLabel` if the Propostas table was its only consumer after this rewrite; keep it if the detail dialog or another view still uses it (it is not used by the new detail dialog, so expect removal, and drop the now unused `PaymentCondition` import if nothing else needs it).
Grep the whole of `apps/web/src` for `'closed'`, `'completed'`, `'forecast'`, and `'in_progress'` string literals after the change; the only surviving hits must be in files outside sales-ops (referral admin pages use unrelated enums) and in slice-06-owned wizard fixtures already migrated.

## 7. Tests

All tests follow the existing harness conventions: `// @vitest-environment happy-dom` for component tests, `createRoot` plus `act`, module mocks for radix wrappers, no new test libraries.

### 7.1 apps/web/src/sales-ops/__tests__/navigation.test.ts (update)

In "renders fixed team navigation", additionally assert `getSalesOpsNavigation('operacional', team).map((item) => item.label)` equals `['Propostas', 'Comissões']`.
Update the workspace catalogue expectation to `description: 'Propostas e conferência'` for operacional.
Assert the meus-dados finder labels still equal `['Meu painel', 'Indicações']` (already covered, keep it green).

### 7.2 apps/web/src/sales-ops/__tests__/calculations.test.ts (update)

Add a `saleFixture(overrides)` factory producing a fully typed `SalesOpsSale` with the new status union.
New test "aggregates dashboard KPIs from won propostas only": bootstrap with one sale per status (won total 100000, open 50000, draft, lost, cancelled, the cancelled one carrying `recurringBrl`), assert `kpis.wonRevenueBrl === 100000`, `kpis.wonSalesCount === 1`, `topSellers` counts only the won sale, `activeMrrBrl` excludes the cancelled sale's recurring, and `latestSales` includes draft and open but not cancelled.
Update the existing empty-model test to the renamed `wonRevenueBrl` field.
If the `buildSalePayload` fixture still says `status: 'closed'` after slice 06, change it to `'open'`.

### 7.3 apps/web/src/sales-ops/__tests__/sales-view.test.tsx (new)

Harness: mock `@/components/ui/dialog` as pass-through elements (copy the mock from sale-wizard-custom-item-labels.test.tsx), mock `@/components/ui/dropdown-menu` so `DropdownMenu`, `DropdownMenuTrigger` (render children), and `DropdownMenuContent` render inline divs and `DropdownMenuItem` renders a button forwarding `onSelect` to `onClick`, and mock `@/components/ui/alert-dialog` so the root renders children only when `open` is true and `AlertDialogAction`/`AlertDialogCancel` render buttons.
Fixture: bootstrap with five sales, one per status (codes P-001 to P-005), the won one with `recurringBrl > 0`, saleItems carrying `areaNameSnapshot` values ('FXL Tech', 'FXL Advisor'), receivables for the won sale (one paid, one open), payables for the won sale.
Tests:

1. "renders the propostas columns and one chip per status": render `<SalesView canManage sales={all} ... />`, assert header cells Código, Cliente, Vendedor, Áreas, Total, Status, Data, Ações and chip labels Rascunho, Aberta, Ganha, Perdida, Cancelada each appear exactly once in the tbody (this is the statusMeta oracle).
2. "shows the joined área names per row": the won row's Áreas cell contains 'FXL Tech, FXL Advisor'.
3. "hides all row actions when canManage is false": render with `canManage={false}`, assert `container.querySelector('button[aria-label^="Ações da proposta"]')` is null and no 'Marcar como ganha' text exists.
4. "opens the read-only detail on row click in read-only mode": click the won row (dispatch click on the row containing P-003), assert the detail contains 'Plano de pagamento', the receivable due dates, 'Contas a pagar', and 'Margem líquida'.

### 7.4 apps/web/src/sales-ops/__tests__/sales-transition-actions.test.tsx (new, primary oracle)

Same harness and fixture module pattern as 7.3, with `onEdit`, `onTransition`, `onCancelContract` as `vi.fn()` and row scoping via `closest('tr')` from the code text.
Tests:

1. "marks an open proposta as ganha without confirmation": click 'Marcar como ganha' inside the open row, expect `onTransition` called with the open sale object and `'won'` and no alert dialog content in the document.
2. "confirms before marking as perdida": click 'Marcar como perdida' in the open row, expect `onTransition` not yet called and the text 'Marcar proposta como perdida?' present, click the 'Marcar como perdida' action button, expect `onTransition` with `'lost'`.
3. "confirms and voids on cancel": same flow for 'Cancelar' asserting the description mentions 'anuladas' and `onTransition` with `'cancelled'`.
4. "reopens a won proposta only after confirmation": won row 'Reabrir' opens 'Reabrir proposta ganha?', confirm, expect `onTransition` with `'open'`; also assert lost row 'Reabrir' calls `onTransition` with `'open'` immediately without dialog.
5. "offers cancelar contrato only for won recurring": 'Cancelar contrato' exists in the won recurring row only (absent for a second won sale fixture with `recurringBrl === 0`), confirm flow calls `onCancelContract` with the sale.
6. "routes edit to the wizard for draft and open only": 'Editar' in the draft row calls `onEdit(sale)`; the won, lost, and cancelled rows contain no 'Editar' item.
7. "cancel button closes without mutating": open any confirm, click 'Voltar', expect all three callbacks uncalled and the dialog text gone.

### 7.5 apps/web/src/sales-ops/__tests__/routing.test.tsx (update)

Extend the `vi.mock('../hooks', ...)` factory with `useTransitionSalesOpsSale: () => mutation` and `useCancelSalesOpsContract: () => mutation`, plus any hook slice 06 added, so `SalesOpsApp` keeps rendering.
Extend the mocked bootstrap data with `receivables: []` and `areas: []`.
Assert the operacional sidebar renders the 'Propostas' nav label when roles include admin (one added expectation in an existing operacional navigation case).

## 8. Execution order

1. Verify all upstream assumptions from the checklist and reconcile names.
2. types.ts and calculations.ts (compile-driven sweep of `wonRevenueBrl`/`wonSalesCount`).
3. api.ts and hooks.ts.
4. navigation.ts and its test.
5. SalesOpsApp.tsx: statusMeta, titleForView, filters, SalesView, SaleDetailDialog, confirmation dialog, call site, dashboard sweep, wizard request state.
6. New and updated tests.
7. `pnpm run lint`, `pnpm run type-check`, `pnpm test` from the repo root; all green before capture.

## Named oracle tests

- apps/web/src/sales-ops/__tests__/sales-transition-actions.test.tsx (primary).
- apps/web/src/sales-ops/__tests__/sales-view.test.tsx (statusMeta chips, áreas column, read-only meus-dados, detail dialog).
- apps/web/src/sales-ops/__tests__/calculations.test.ts (won-based dashboard aggregates).
- apps/web/src/sales-ops/__tests__/navigation.test.ts (Propostas label).
