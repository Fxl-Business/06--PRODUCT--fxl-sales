# Part 09a - Lead routes (summary segment, stage query)

Part of slice `09-web-lead-resumo`.

## Context

- Today the one route is `SALES_OPS_ROUTE_PATTERN = '/:workspace/:view/:saleId?'` (`apps/web/src/sales-ops/navigation.ts` line 47). On the `leads` view the optional segment is a STAGE id: `buildSalesOpsPath` (lines 263-266) picks `route.stageId` for `leads`, `resolveSalesOpsRoute` (lines 337-364) maps `params.saleId` to `stageId` for `leads`, and a bare `leads` redirects to `funil` (line 345). `LeadSidebarNavigation.tsx` line 59 navigates with `buildLeadStagePath`; `LeadsBoardContainer.tsx` line 340 passes `onOpenStage` with it; `SalesOpsApp.tsx` lines 1951-1953 and 2378-2379 read `resolution.route.stageId`.
- The request needs `operacional/leads/:leadId` and `meus-dados/leads/:leadId` for the lead summary. The pattern has ONE optional segment, so the two uses collide.
- Decision (no open question): the SEGMENT belongs to the lead summary (`leadId`), a permalink-worthy identity. The stage selection becomes a QUERY parameter `?etapa=<stageId>` on `leads`. Reasons: a lead id is what other screens and bookmarks point at; a stage selection is a view filter (same class as the `Quadro`/`Lista` toggle, which is component state); the single route object stays (`SalesOpsApp` never remounts); no second route pattern is added. Old stage URLs `/operacional/leads/<stageId>` now parse as a lead id and the summary answers `Lead não encontrado`; that is accepted because these URLs were only ever produced by the sidebar of the prior release and the sidebar now writes the query form.
- `SalesOpsApp.tsx` already has `const location = useLocation();` (line 1295) and `const routeParams = useParams();` (line 1296). The resolution is computed at line 1358. `resolution.redirect && rolesAreAuthoritative` at line 1799 drives `<Navigate replace to={resolution.path}>`.
- Follow-ups need their own view id (`follow-ups`); its nav entries and screen come in 09d. This slice only reserves the id, title and header-action so the `Record<SalesOpsView, ...>` maps compile.

## Design

`navigation.ts`:

1. `SalesOpsView`: add `| 'follow-ups'` after `'leads-excluidos'` (line 36).
2. `SalesOpsRoute` (lines 55-64): keep `saleId?` and `stageId?`, add `/** The open lead summary. Only present on the leads view. */ leadId?: string;`. Update the `stageId` doc comment: "selected lead stage, from the `?etapa=` query, only on the leads view".
3. `SalesOpsRouteParams` (lines 66-70): add `etapa?: string;` (the caller reads it from the query string; the resolver stays a pure function of its arguments).
4. `buildSalesOpsPath(route)`:
   ```ts
   export function buildSalesOpsPath(route: SalesOpsRoute): string {
     const base = `/${route.workspace}/${route.view}`;
     if (route.view === 'leads') {
       if (route.leadId !== undefined) return `${base}/${encodeURIComponent(route.leadId)}`;
       return route.stageId === undefined ? base : `${base}?etapa=${encodeURIComponent(route.stageId)}`;
     }
     return route.saleId === undefined ? base : `${base}/${encodeURIComponent(route.saleId)}`;
   }
   ```
5. `buildLeadStagePath(workspace, stageId)` is unchanged in code (it calls `buildSalesOpsPath({ workspace, view: 'leads', stageId })`) and now yields `/operacional/leads?etapa=<id>`. Add `export function buildLeadSummaryPath(workspace: SalesOpsWorkspace, leadId: string): string { return buildSalesOpsPath({ workspace, view: 'leads', leadId }); }`.
6. `resolveSalesOpsRoute` inside `if (workspace && view)`: replace lines 345-359 by
   ```ts
   if (view === 'leads' && !params.saleId && !params.etapa) {
     const route: SalesOpsRoute = { workspace, view: 'funil' };
     return { route, path: buildSalesOpsPath(route), redirect: true };
   }
   const saleId = view === 'vendas' && params.saleId ? params.saleId : undefined;
   const leadId = view === 'leads' && params.saleId ? params.saleId : undefined;
   const stageId = view === 'leads' && !leadId && params.etapa ? params.etapa : undefined;
   const route: SalesOpsRoute = {
     workspace, view,
     ...(saleId !== undefined ? { saleId } : {}),
     ...(leadId !== undefined ? { leadId } : {}),
     ...(stageId !== undefined ? { stageId } : {}),
   };
   const droppedSaleId = params.saleId !== undefined && saleId === undefined && leadId === undefined;
   const droppedEtapa = params.etapa !== undefined && stageId === undefined;
   return { route, path: buildSalesOpsPath(route), redirect: view !== params.view || droppedSaleId || droppedEtapa };
   ```
   (`etapa` on a non-leads view, or next to a `leadId`, is dropped and the address bar is rewritten.)
7. `getDefaultSalesOpsRoute` and `workspaceForView` need no change.

`SalesOpsApp.tsx` (edits named by anchor; the file is ~9,700 lines, touch nothing else):

- line 1358: replace `const resolution = resolveSalesOpsRoute(routeParams, profile.roles, edition);` by
  ```ts
  const etapaParam = new URLSearchParams(location.search).get('etapa') ?? undefined;
  const resolution = resolveSalesOpsRoute(
    etapaParam === undefined ? routeParams : { ...routeParams, etapa: etapaParam },
    profile.roles, edition,
  );
  ```
- `titleForView` (line 448): add the map entry `'follow-ups': { title: personal ? 'Meus follow-ups' : 'Follow-ups', subtitle: 'Próximos passos combinados com cada lead' }`.
- `headerAction` chain (lines 1720-1727): add `view === 'follow-ups' ||` to the list that yields `null`.
- the leads mount at line 2365: change the guard to `{(view === 'funil' || (view === 'leads' && !resolution.route.leadId)) ? (` so an open lead never mounts the board. Slice 09b adds the summary mount for `resolution.route.leadId`; until then that URL renders no content area (it is unreachable from the UI before 09b).
- no other change: `activeStageId={view === 'leads' ? resolution.route.stageId : undefined}` (line 1952) and `selectedStageId={resolution.route.stageId}` (line 2379) already read `stageId`, which now comes from the query.

Docs (same change): `CLAUDE.md` section "Sales Ops Routing": in the `Routes:` bullet append `, plus the lead summary operacional/leads/:leadId and meus-dados/leads/:leadId`; add the bullet `- On the leads view the optional third segment is the LEAD id (the summary); the selected stage is the ?etapa=<stageId> query. buildLeadStagePath builds the query form, buildLeadSummaryPath the segment form, and a bare leads URL still redirects to funil.` and extend the bullet `The open proposta detail is URL state too` with `(and so is the open lead summary)`. `nexo/knowledge/reference/sales-ops-routing.md`: add a bullet group (one sentence per line) with the conflict, the decision and its reasons (copy the Context paragraph), the dropped-old-URL note, and the oracle names `lead-routes.test.ts`, `leads-stage-navigation.test.tsx`.

## Steps (TDD)

1. Write `lead-routes.test.ts`; run it: fails.
2. Edit `navigation.ts` (items 1-6); run it green.
3. Update `leads-stage-navigation.test.tsx` and append the `navigation.test.ts` cases (Tests); run both.
4. Edit `SalesOpsApp.tsx` (anchors above); run `src/sales-ops/__tests__` and `src/__tests__`.
5. Docs.

## Tests

`lead-routes.test.ts` (node, roles `['admin']` for operacional, `['seller']` for meus-dados):
- `a lead id in the third segment resolves to leadId, not stageId`: `{workspace:'operacional', view:'leads', saleId:'L1'}` -> `route` `toStrictEqual({workspace:'operacional', view:'leads', leadId:'L1'})`, `redirect` false, `path` `/operacional/leads/L1`.
- `the etapa query resolves to stageId without a redirect`: `{view:'leads', etapa:'S1'}` -> route `{..., stageId:'S1'}`, path `/operacional/leads?etapa=S1`, `redirect` false.
- `a bare leads URL still redirects to the Funil`.
- `a lead id wins over an etapa and the canonical URL drops the etapa`: both given -> route has `leadId` only, `redirect` true.
- `an etapa on any other view is dropped with a redirect` (`view:'funil', etapa:'S1'` -> route `{workspace, view:'funil'}`, redirect true).
- `meus-dados accepts the lead summary for a seller and drops it for a finder-only operator`.
- `buildLeadSummaryPath and buildLeadStagePath encode their ids`: `buildLeadSummaryPath('operacional','a/b')` is `/operacional/leads/a%2Fb`; `buildLeadStagePath('meus-dados','x y')` is `/meus-dados/leads?etapa=x%20y`.
- `a saleId is honoured only on vendas and a leadId only on leads`: `{view:'vendas', saleId:'V1'}` keeps `saleId`; `{view:'comissoes', saleId:'V1'}` drops it with `redirect` true.
- `the Finance deep link is unchanged`: `buildSaleDetailPath('abc')` is `/operacional/vendas/abc`.

`navigation.test.ts`: append `resolve and build round trip for the lead summary and the stage query` (the first two cases above through `buildSalesOpsPath(resolve(...).route)`), with no edit to existing cases.

`leads-stage-navigation.test.tsx` (update, not weaken):
- test 1: `expect(buildLeadStagePath('operacional', 'stage/a')).toBe('/operacional/leads?etapa=stage%2Fa')`; the resolve line becomes `resolveSalesOpsRoute({ workspace: 'meus-dados', view: 'leads', etapa: 'stage-2' }, ['seller']).route` `toEqual({ workspace: 'meus-dados', view: 'leads', stageId: 'stage-2' })`; the bare-leads and funil assertions stay.
- harness `RoutedLeads`: add `const [search] = useSearchParams();` and call `resolveSalesOpsRoute({ ...params, ...(search.get('etapa') ? { etapa: search.get('etapa')! } : {}) }, roles)`.
- the click test expects `LocationProbe` to show the pathname `/operacional/leads` and the probe also exposes `useLocation().search` -> `?etapa=won`; change `LocationProbe` to print `pathname + search`, expected `/operacional/leads?etapa=won`.

## Affected tests search

Searched `apps/web/src` for `buildLeadStagePath`, `stageId` on routes and `view: 'leads'`: `leads-stage-navigation.test.tsx` (updated), `navigation.test.ts` (appended), `leads-routing.test.tsx` / `vendedores-routing.test.tsx` / `no-role-redirect.test.tsx` mock `LeadsBoardContainer` and render through `SalesOpsApp` with bare `/operacional/leads` (still redirects to funil, no assertion on a stage path), `import-routing.test.tsx` and `sale-deep-link.test.tsx` only mock the container. No other file reads the stage segment.

## Commands

- Oracle: `pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/__tests__/lead-routes.test.ts`
- Affected: `pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/__tests__ src/__tests__`
- `pnpm --filter @fxl-sales/web lint` and `pnpm --filter @fxl-sales/web type-check`

## Risks

- `SalesOpsApp.tsx` is a hot file: only the four anchored edits above; any other edit is out of scope.
- `redirect` now also fires for a stray `?etapa=`; the Navigate in `SalesOpsApp` (line 1799) uses `resolution.path` and `replace`, so no history entry is added.
