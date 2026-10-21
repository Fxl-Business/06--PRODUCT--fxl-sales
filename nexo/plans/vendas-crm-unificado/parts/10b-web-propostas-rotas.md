# Part 10b - Propostas: one route per list, Proposta versus Vendido, period filter

Part of slice `10-web-kanban-funil-periodo`. Depends on part 10a (08b for the period helper, 09a for `navigation.ts` shape).

## Context

- Today Propostas is ONE view `vendas` (nav label `Propostas`, `navigation.ts` `operational` list) and the "submenu" is a status `Combobox` inside the `Filtros` bar (`SalesOpsApp.tsx` lines 2129-2149) driven by `salesFilters.status` (line 1343) and `salesStatusFilterOptions` (lines 395-402); the list is `filteredSales` (lines 1437-1449), mounted at line 2272 as `SalesView` with `detailSaleId` from `resolution.route.saleId`.
- `vendas` occurrences to touch: lines 1364 and 1373 (open/close detail navigate to `view: 'vendas'`), 2111 (Filtros button for `vendas`/`comissoes`), 2129 (filters bar), 2272 (mount), 2643 (`go('vendas')`, a link to the list; stays).
- Requirements: each Propostas submenu entry is its own route under the existing pattern `/:workspace/:view/:saleId?`; `buildSaleDetailPath` stays `/operacional/vendas/<id>` (Finance `deepLinkPath`); the detail id must work on `vendas` AND on each sub-list; Proposta versus Vendido is decided by `status` on the proposta side (open or draft = Proposta, `won` = Vendido) and by stage type on the lead side (done by the stage colours/type in 10a); period filter on Propostas with the contract's semantics: non-won by creation day, won by `won_at` day, in Sao Paulo (`filterSalesByPeriod`, part 08b).
- The bootstrap carries every sale (`bootstrap.sales`), so the period filter is applied client-side with the shared helper; no new endpoint.
- Finder `meus-dados/vendas` ("Indicações") is a different list and is not split.

## Design

1. New pure `apps/web/src/sales-ops/sales-views.ts`:
   ```ts
   export type SalesListView = 'vendas' | 'vendas-abertas' | 'vendas-ganhas' | 'vendas-encerradas';
   export const SALES_VIEW_STATUSES: Record<SalesListView, readonly SalesOpsStatus[] | null> = {
     vendas: null,                                  // all statuses
     'vendas-abertas': ['draft', 'open'],           // Proposta
     'vendas-ganhas': ['won'],                      // Vendido
     'vendas-encerradas': ['lost', 'cancelled'],
   };
   export function isSalesListView(view: string): view is SalesListView { return Object.hasOwn(SALES_VIEW_STATUSES, view); }
   export function salesStatusOptionsForView(view: SalesListView, all: ComboboxOption[]): ComboboxOption[]   // keeps 'all' + the statuses of the view
   export function effectiveSalesStatus(view: SalesListView, status: SalesOpsStatus | 'all'): SalesOpsStatus | 'all'   // a stale status outside the view reads 'all'
   export function filterSalesList(input: { sales: SalesOpsSale[]; saleItems: SalesOpsSaleItem[]; view: SalesListView; status: SalesOpsStatus | 'all'; areaId: string | 'all'; range: PeriodRange }): SalesOpsSale[]
   //   statuses of the view, then the effective status, then the area rule of the current memo, then filterSalesByPeriod
   ```
2. `navigation.ts`:
   - `SalesOpsView` adds `'vendas-abertas' | 'vendas-ganhas' | 'vendas-encerradas'`.
   - `operational` list (after `vendas`, before `comissoes`; `vendas` stays `[0]`, so the landing route does not move): `{ id: 'vendas-abertas', label: 'Em aberto', icon: BriefcaseBusiness }`, `{ id: 'vendas-ganhas', label: 'Vendidas', icon: BadgeDollarSign }`, `{ id: 'vendas-encerradas', label: 'Perdidas e canceladas', icon: Archive }` (import `Archive` from `lucide-react`). The leads-edition lists and `meusDadosSeller/Finder` do NOT get them (no propostas there).
   - `resolveSalesOpsRoute`: `const saleId = isSalesListView(view) && params.saleId ? params.saleId : undefined;` (replaces `view === 'vendas'`). `buildSalesOpsPath` needs no change (its non-leads branch writes `saleId`).
   - `buildSaleDetailPath` is unchanged.
   - `canSettleInWorkspace` unchanged.
3. `SalesOpsApp.tsx` (only these anchors):
   - `titleForView` (line 448) adds `'vendas-abertas': { title: 'Propostas em aberto', subtitle: 'Rascunhos e propostas abertas aguardando decisão' }`, `'vendas-ganhas': { title: 'Vendas ganhas', subtitle: 'Propostas ganhas, com recebíveis e baixas' }`, `'vendas-encerradas': { title: 'Perdidas e canceladas', subtitle: 'Propostas encerradas sem venda' }`.
   - `openSaleDetail` / `closeSaleDetail` (lines 1363-1374): `const salesView: SalesListView = isSalesListView(view) ? view : 'vendas';` and navigate with `view: salesView` instead of the literal `'vendas'`, so an id opened from `vendas-ganhas` stays on that list.
   - state next to line 1343: `const [salesPeriod, setSalesPeriod] = useState<PeriodSelection>(PERIOD_ALL_SELECTION);`
   - `filteredSales` (line 1437): body becomes `isSalesListView(view) ? filterSalesList({ sales: bootstrap.sales, saleItems: bootstrap.saleItems, view, status: salesFilters.status, areaId: salesFilters.areaId, range: selectionToRange(salesPeriod, todayInSaoPaulo()) }) : bootstrap.sales.filter(<unchanged body>)`; dependency list gains `view`, `salesPeriod`. (The `todayInSaoPaulo` import from `@fxl-sales/shared-utils/sao-paulo-day` exists already or is added.)
   - lines 2111 and 2129: `view === 'vendas'` -> `isSalesListView(view)` (the `Filtros` button and bar).
   - the status `Combobox` (line 2132): `options={salesStatusOptionsForView(isSalesListView(view) ? view : 'vendas', salesStatusFilterOptions)}` and `value={effectiveSalesStatus(..., salesFilters.status)}`.
   - header (line 2118-2124): the static `Julho 2026` chip is replaced, ONLY for sales list views, by `<PeriodFilter aria-label="Período das propostas" onChange={setSalesPeriod} value={salesPeriod} />`; other views and the leads-edition rule are untouched (`edition === 'leads' ? null : isSalesListView(view) ? <PeriodFilter/> : <chip/>`).
   - mount (line 2272): `{isSalesListView(view) ? (<SalesView ... />) : null}`.
4. Docs: `CLAUDE.md` Sales Ops Routing: `Routes:` gains `operacional/vendas-abertas|vendas-ganhas|vendas-encerradas`; the proposta detail bullet becomes `operacional/vendas/:saleId (and the same id on each vendas-* list, and meus-dados/vendas/:saleId)`, `saleId is honoured only on the vendas views`; add `Each Propostas list is its own route; the status groups live in sales-views.ts (Proposta = draft+open, Vendido = won).` Mirror in `nexo/knowledge/reference/sales-ops-routing.md` and `propostas.md` (one sentence per line).

## Steps (TDD)
1. Write `sales-views.test.ts` and the navigation/routing cases; red.
2. Create `sales-views.ts`; edit `navigation.ts`; edit `SalesOpsApp.tsx` at the anchors; docs.
3. Run `src/sales-ops` and `src/__tests__`.

## Tests
- `sales-views.test.ts` (node): the status groups; `isSalesListView('comissoes')` false; `salesStatusOptionsForView('vendas-ganhas', all)` is `[all, won]`; `effectiveSalesStatus('vendas-ganhas','open')` is `all`; `filterSalesList` for `vendas-abertas` returns only draft and open; with a `range` of October only a sale created in October stays, a `won` sale created in September and won in October stays in `vendas-ganhas` for October and drops for September (won uses `won_at`); the area rule still filters by `saleItems`; a sale created `2026-10-21T01:30Z` (22:30 on the 20th in Sao Paulo) is inside the range `2026-10-20..2026-10-20`.
- `navigation.test.ts` / `navigation-edition.test.ts`: the full-edition operacional list literal becomes `['vendas','vendas-abertas','vendas-ganhas','vendas-encerradas','comissoes','leads','funil','follow-ups']` (existing literals updated, never loosened); leads-edition lists are unchanged; `resolveSalesOpsRoute({workspace:'operacional', view:'vendas-ganhas', saleId:'S1'}, ['admin'])` keeps `saleId` and `redirect` false; `{view:'vendas', saleId:'S1'}` unchanged; `buildSaleDetailPath('S1')` still `/operacional/vendas/S1`; a seller-only operator gets no `vendas-*` (redirect to the role default).
- `routing.test.tsx` (existing SalesOpsApp harness) new cases: `/operacional/vendas-ganhas` lists only won sales and its title is `Vendas ganhas`; `/operacional/vendas-abertas` lists draft and open; `/operacional/vendas-ganhas/<id>` opens the detail dialog and closing it returns to `/operacional/vendas-ganhas`; `/operacional/vendas/<id>` (Finance deep link) still opens the detail (existing `sale-deep-link.test.tsx` stays unchanged and green); choosing a period in the header filters the rows and the `registros` counter.
- `sales-view.test.tsx` / `sales-settlement-visibility.test.tsx` use `ControlledSalesView`: unchanged.

## Affected tests search
Searched `'vendas'`, `getSalesOpsNavigation`, `salesStatusFilterOptions`, `Julho 2026` over `apps/web/src`: `navigation.test.ts`, `navigation-edition.test.ts`, `leads-stage-navigation.test.tsx` (literal operacional lists), `routing.test.tsx`, `sale-deep-link.test.tsx` (must stay green), `session-journey.test.tsx` (deep link through login, unchanged). The `Julho 2026` chip test, if any, keeps passing because only sales views swap it.

## Commands
- Oracle part: `pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/__tests__/sales-views.test.ts src/sales-ops/__tests__/navigation.test.ts src/sales-ops/__tests__/navigation-edition.test.ts src/sales-ops/__tests__/routing.test.tsx src/sales-ops/__tests__/sale-deep-link.test.tsx`
- Affected: `pnpm --filter @fxl-sales/web exec vitest run src/sales-ops src/__tests__`
- lint and type-check

## Risks
- Won propostas without `wonAt` fall back to creation; the helper pins it.
- The period state lives in `SalesOpsApp` (like `salesFilters`) and survives switching between sales lists, resets on remount.
