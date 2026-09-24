---
id: 09-sale-deep-link
milestone: v4.1.0
status: parked
depends_on: [08-settlements-ui]
files_modified: [apps/web/src/sales-ops/navigation.ts, apps/web/src/router.tsx, apps/web/src/sales-ops/SalesOpsApp.tsx, apps/web/src/sales-ops/__tests__/navigation.test.ts, apps/web/src/sales-ops/__tests__/sale-deep-link.test.tsx, apps/web/src/sales-ops/__tests__/sales-view.test.tsx, apps/web/src/sales-ops/__tests__/sales-transition-actions.test.tsx, apps/web/src/__tests__/sale-deep-link-route.test.ts, apps/web/src/__tests__/session-journey.test.tsx, apps/web/src/auth/__tests__/session-recovery.test.ts, CLAUDE.md, nexo/knowledge/reference/sales-ops-routing.md]
goal: "C8: /operacional/vendas/:saleId opens that proposta's detail from the URL, including cold entry through login, with a pt-BR not-found state and the URL as the only source of the open detail"
acceptance: ["buildSalesOpsPath({workspace:'operacional',view:'vendas',saleId}) returns '/operacional/vendas/<encoded id>' and buildSaleDetailPath(id) returns the same string", "resolveSalesOpsRoute keeps saleId only on the vendas view of a visible workspace; on any other view it redirects to the path without the id; for an operator without the workspace it redirects to the role default with no id", "router.tsx serves /:workspace/:view/:saleId? (SALES_OPS_ROUTE_PATTERN) inside Protected, so a 3-segment proposta URL never falls to the '*' catch-all", "Rendering SalesOpsApp at /operacional/vendas/<id> of an existing proposta shows 'Proposta <code>' detail without any click", "Clicking a row pushes /operacional/vendas/<id>; closing the detail returns to /operacional/vendas by popping history (Back afterwards leaves the list, never reopens the detail); closing after a cold entry replaces the URL with /operacional/vendas", "An unknown or other-org id renders 'Proposta não encontrada' with a 'Voltar para a lista' button that navigates to the list, and the raw id never appears in the rendered text", "The detail (or the not-found dialog) renders even when the list is empty or the filters hide every row", "Cold entry at /operacional/vendas/<id> with no session calls login once, stores returnTo '/operacional/vendas/<id>', and after the Hub round trip lands on exactly that path with the detail open", "A converted lead card's proposta link opens /operacional/vendas/<saleId> instead of the bare list", "CLAUDE.md Sales Ops Routing and nexo/knowledge/reference/sales-ops-routing.md describe the saleId segment in the same change"]
---

# 09 - Proposta deep link (C8)

## Context

Verified against the worktree at plan time (line numbers will have drifted after slices 04 to 08; search by symbol, not by line).

- `apps/web/src/router.tsx:155-163` has ONE Sales Ops route, `path: '/:workspace/:view'`, wrapped in `<Protected><SalesOpsApp /></Protected>`.
  `router.tsx:164` is `{ path: '*', element: <Navigate to="/" replace /> }`, OUTSIDE `Protected`.
  So today `/operacional/vendas/<id>` matches only `*`, which rewrites the URL to `/` BEFORE any `Protected` mounts; on a cold entry `HubProtected` then captures `/`, `sanitizeReturnTo('/')` is `null`, and the id is lost for good. This is the real bug behind C8's cold-entry clause, and it is fixed by the route, not by the auth code.
- `apps/web/src/sales-ops/navigation.ts`: `SalesOpsRoute = { workspace, view }`, `SalesOpsRouteParams = { workspace?, view? }`, `buildSalesOpsPath(route)` returns `/${workspace}/${view}`, `resolveSalesOpsRoute(params, roles)` returns `{ route, path, redirect }` and falls back to `getDefaultSalesOpsRoute(roles)` with `redirect: true` for any invisible workspace or unknown view.
- `apps/web/src/sales-ops/SalesOpsApp.tsx`:
  - `SalesOpsApp` (around `:1215`) reads `useParams()` and `resolveSalesOpsRoute(routeParams, profile.roles)` (`:1267`), and has the two signed-in-gated early returns `<Navigate to="/no-role">` and `<Navigate to={resolution.path}>` (`:1643-1658`).
  - `SalesView` (around `:2559`) holds the open detail as LOCAL state: `const [detailSaleId, setDetailSaleId] = useState<string | null>(null)` (`:2575`), row `onClick={() => setDetailSaleId(sale.id)}`, and renders `<SaleDetailDialog bootstrap sale={detailSale} onClose={() => setDetailSaleId(null)} />` only in the final return. The two early returns (`bootstrap.sales.length === 0`, `sales.length === 0`) render an `EmptyPanel` and NO detail.
  - `detailSale` is `sales.find(id) ?? bootstrap.sales.find(id) ?? null`.
  - `SalesView` is rendered for `view === 'vendas'` in BOTH `operacional` (`canManage`) and `meus-dados` (the finder's read-only `Indicações`), only once `!bootstrapQuery.isLoading && !bootstrapQuery.isError`.
  - `openSaleFromBoard(_saleId)` (inside `BOARD-WRITE-FENCE:START/END conversion-handlers`) navigates to the bare `/operacional/vendas` and discards the id.
- `apps/web/src/auth/react.tsx` `HubProtected` (around `:760-860`): on cold entry with no session it runs `captureReturnTo(`${location.pathname}${location.search}`)` then `login()`; once signed in it runs `consumeReturnTo()` and `navigate(target, { replace: true })`.
  `apps/web/src/auth/session-recovery.ts` `sanitizeReturnTo` keeps `url.pathname + url.search` of any same-origin relative path under 2048 chars, refusing only `/auth*`, `/no-role` and `/`. A uuid segment passes untouched. No auth code change is needed; the proof is the journey oracle below.
- Production SPA fallback: `vercel.json` rewrites `/(.*)` to `/index.html`, and `index.html` uses absolute `/src/...` and `/favicon.svg`, so a 3-segment path loads the app. Vite dev serves `index.html` for unknown HTML paths.
- The dev-fake stand-in (`apps/web/src/dev/install-dev-identity.ts`) mints a token on every cold boot and its `login()` is `window.location.reload()`, so dev-fake can never show a cold entry WITHOUT a session. The login round trip is therefore proven in happy-dom (`session-journey.test.tsx`), and the browser check proves the signed-in cold entry.
- `/bootstrap` is org-scoped and not role-scoped, so a finder in `meus-dados/vendas` already sees and can click every proposta of the org. No new data is exposed by this slice, and no new API call is made.

## Design

### navigation.ts (pure, no React)

```ts
export const SALES_OPS_ROUTE_PATTERN = '/:workspace/:view/:saleId?';

export type SalesOpsRoute = Readonly<{
  workspace: SalesOpsWorkspace;
  view: SalesOpsView;
  /** The open proposta. Only ever present on the `vendas` view. */
  saleId?: string;
}>;

export type SalesOpsRouteParams = Readonly<{
  workspace?: string;
  view?: string;
  saleId?: string;
}>;

export function buildSalesOpsPath(route: SalesOpsRoute): string {
  const base = `/${route.workspace}/${route.view}`;
  return route.saleId === undefined ? base : `${base}/${encodeURIComponent(route.saleId)}`;
}

/** The Finance `deepLinkPath` (audit 11.4): the team proposta detail. */
export function buildSaleDetailPath(saleId: string): string {
  return buildSalesOpsPath({ workspace: 'operacional', view: 'vendas', saleId });
}
```

`resolveSalesOpsRoute` changes only in its success branch:

```ts
if (workspace && view) {
  const saleId = view === 'vendas' && params.saleId ? params.saleId : undefined;
  const route: SalesOpsRoute = saleId === undefined ? { workspace, view } : { workspace, view, saleId };
  const droppedSaleId = params.saleId !== undefined && saleId === undefined;
  return {
    route,
    path: buildSalesOpsPath(route),
    redirect: view !== params.view || droppedSaleId,
  };
}
```

The fallback branch is untouched, so an invisible workspace drops the id and lands on the role default (the existing visibility rule).
Never write the key `saleId: undefined`: existing tests compare routes with `toEqual`, and a present-but-undefined key is a trap for any later `toStrictEqual`.
Any non-empty string is accepted as an id: it is never rendered, never sent to the API, and only compared with `===` against bootstrap ids; a malformed id is simply "not found".

### router.tsx

- Change the Sales Ops route's `path: '/:workspace/:view'` to `path: SALES_OPS_ROUTE_PATTERN` (import it from `./sales-ops/navigation`). ONE route object with an optional segment, not a second route: the same route object guarantees `SalesOpsApp` is never remounted between the list and the detail, so filters, the open wizard and `convertedSales` survive.
- Export the table for the route oracle: change `const routes: RouteObject[] = [` to `export const routes: RouteObject[] = [`. The file already disables `react-refresh/only-export-components`.
- No other route changes. The `*` catch-all stays; 4+ segment paths still fall to it.

### SalesOpsApp.tsx (localized edits only)

1. Import `useLocation` next to `useNavigate, useParams`.
2. Module-local (NOT exported, `react-refresh` allows only component exports) near `SalesView`:

```ts
/**
 * History-entry marker for a detail opened by an in-app click. Closing such a detail
 * POPS history so Back never reopens it; a detail entered from outside (Finance's
 * "Editar no Sales", a pasted link, a restored returnTo) carries no marker and is closed
 * by REPLACING the entry with the list. The marker decides history mechanics only; what
 * is on screen is decided by the URL alone.
 */
const SALE_DETAIL_OPENED_IN_APP = { saleDetailOpenedInApp: true } as const;

function isSaleDetailOpenedInApp(state: unknown): boolean {
  return (
    typeof state === 'object' &&
    state !== null &&
    (state as { saleDetailOpenedInApp?: unknown }).saleDetailOpenedInApp === true
  );
}
```

3. In `SalesOpsApp`, after `const { workspace, view } = resolution.route;`:

```ts
const location = useLocation();            // with the other hooks at the top of the component
const detailSaleId = resolution.route.saleId ?? null;

function openSaleDetail(saleId: string) {
  navigate(buildSalesOpsPath({ workspace, view: 'vendas', saleId }), {
    state: SALE_DETAIL_OPENED_IN_APP,
  });
}

function closeSaleDetail() {
  if (isSaleDetailOpenedInApp(location.state)) navigate(-1);
  else navigate(buildSalesOpsPath({ workspace, view: 'vendas' }), { replace: true });
}
```

   Place `useLocation()` with the other hooks at the top of `SalesOpsApp` (before any early return; rules of hooks).
4. `<SalesView ... />` call site gains `detailSaleId={detailSaleId}`, `onOpenDetail={openSaleDetail}`, `onCloseDetail={closeSaleDetail}`. Nothing else at that call site changes.
5. `openSaleFromBoard(saleId: string)` becomes:

```ts
navigate(buildSaleDetailPath(saleId), { state: SALE_DETAIL_OPENED_IN_APP });
```

   Rename the parameter from `_saleId`, keep it inside the fence, and append one sentence to its doc comment: the link now opens the proposta itself (`/operacional/vendas/:saleId`), still writing nothing. No transition call is added, so `board-write-surface.test.ts` stays green.
6. `SalesView` props gain:

```ts
detailSaleId: string | null;
onOpenDetail: (saleId: string) => void;
onCloseDetail: () => void;
```

   - Delete the `useState` for `detailSaleId` and its setter.
   - Row `onClick={() => onOpenDetail(sale.id)}`.
   - Build one layer, used by EVERY return branch:

```tsx
const detailLayer =
  detailSaleId === null ? null : detailSale ? (
    <SaleDetailDialog /* keep every prop slice 08 added */ bootstrap={bootstrap} onClose={onCloseDetail} sale={detailSale} />
  ) : (
    <SaleNotFoundDialog onBack={onCloseDetail} />
  );
```

   - The two `EmptyPanel` early returns become `<>{<EmptyPanel ... />}{detailLayer}</>` (same `EmptyPanel` props as today).
   - The final return replaces the existing `<SaleDetailDialog ... />` element with `{detailLayer}`.
   - IMPORTANT: slice 08 (settlements UI) edits `SaleDetailDialog` and probably passes it more props (for example `canManage` or settlement handlers). Keep every prop that exists at execution time; this slice only changes where `sale` comes from and what `onClose` does.
7. New module-local component beside `SaleDetailDialog`:

```tsx
function SaleNotFoundDialog({ onBack }: { onBack: () => void }) {
  return (
    <Dialog onOpenChange={(open) => (!open ? onBack() : undefined)} open>
      <DialogContent className="w-[calc(100vw-48px)] max-w-[440px] gap-0 rounded-[20px] border-none bg-white p-0">
        <DialogHeader className="border-b border-[#e8e8ec] px-6 py-5 text-left">
          <DialogTitle className="text-[19px] font-bold text-[#201f24]">Proposta não encontrada</DialogTitle>
          <DialogDescription className="text-[13px] text-[#8b8b92]">
            Esta proposta não existe ou não pertence à organização ativa. Confira a organização selecionada ou volte para a lista.
          </DialogDescription>
        </DialogHeader>
        <div className="flex justify-end px-6 py-4">
          <button className={wizardPrimaryButtonClass} onClick={onBack} type="button">
            Voltar para a lista
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

   The copy names no id. It is only reachable after the bootstrap has loaded, because `SalesView` itself only mounts when `!isLoading && !isError`, so a slow load shows `LoadingPanel`, never a false "não encontrada".
   If `wizardPrimaryButtonClass` renders oddly at this size in the browser check, use the same class the `AlertDialogAction` buttons use; do not introduce a new button style.

### `meus-dados/vendas/:saleId` decision

It exists, as a consequence of one rule, and is NOT published anywhere.
The rule is "the `saleId` segment is honoured on the `vendas` view", not "on `operacional/vendas`".
Reason: `SalesView` (and its detail) is the same component in `operacional/vendas` and in the finder's `meus-dados/vendas`. Restricting the segment to `operacional` would force `SalesView` to keep TWO mechanisms for the same dialog (URL in one workspace, `useState` in the other), which contradicts "the URL is the single source of truth" and doubles the tests. Honouring it on both costs zero extra code and exposes nothing new (the finder can already click every row of the org-scoped bootstrap, and the detail stays read-only there because `canManage` is `false`).
The published Finance link (`buildSaleDetailPath`) is ONLY `/operacional/vendas/<id>`. A finder-only or seller-only operator following it gets the existing visibility rule: the workspace is invisible, so the resolver redirects to their role default and drops the id. We deliberately do NOT re-map it to `/meus-dados/vendas/<id>`: that would be a second routing rule for a link whose only audience (the Finance operator) is an admin.

## Steps

Each step: write the named test first, watch it fail for the stated reason, then implement.

1. Red: `apps/web/src/sales-ops/__tests__/navigation.test.ts`, new tests:
   - `builds the proposta detail path with the id as its own segment`: `buildSalesOpsPath({ workspace: 'operacional', view: 'vendas', saleId: SALE_ID })` is `/operacional/vendas/${SALE_ID}` (use a uuid literal); `buildSaleDetailPath(SALE_ID)` is the same; `buildSalesOpsPath({ workspace: 'operacional', view: 'vendas', saleId: 'a/b' })` is `/operacional/vendas/a%2Fb`; `buildSalesOpsPath({ workspace: 'operacional', view: 'vendas' })` is still `/operacional/vendas`.
   - `keeps a proposta id only on the vendas view`: team roles `['admin','seller','finder']`, params `{ workspace: 'operacional', view: 'vendas', saleId }` resolve to `{ route: { workspace: 'operacional', view: 'vendas', saleId }, path: '/operacional/vendas/<id>', redirect: false }`; `['finder']` with `{ workspace: 'meus-dados', view: 'vendas', saleId }` keeps it (`redirect: false`); `{ workspace: 'operacional', view: 'comissoes', saleId }` gives route `{ workspace: 'operacional', view: 'comissoes' }` (assert `'saleId' in route` is false), path `/operacional/comissoes`, `redirect: true`; `{ workspace: 'cadastros', view: 'vendedores', saleId }` gives `/cadastros/pessoas`, `redirect: true`.
   - `drops a proposta id for an operator who cannot see the workspace`: `['finder']` with `{ workspace: 'operacional', view: 'vendas', saleId }` gives path `/meus-dados/finders` and `redirect: true` and no `saleId` key; `['seller']` gives `/meus-dados/vendedores`; `[]` gives `/tatico/dashboard`.
   Green: implement the navigation.ts design above.
2. Red: new `apps/web/src/__tests__/sale-deep-link-route.test.ts` (`// @vitest-environment happy-dom`), `import { matchRoutes } from 'react-router-dom'`, `import { routes } from '../router'`, `import { SALES_OPS_ROUTE_PATTERN } from '@/sales-ops/navigation'`:
   - `serves a proposta deep link from the protected Sales Ops route, not the catch-all`: `matchRoutes(routes, '/operacional/vendas/<uuid>')`, last match has `route.path === SALES_OPS_ROUTE_PATTERN` and `params.saleId === '<uuid>'`.
   - `serves the list from the same route object as the detail`: the last match's `route` for `/operacional/vendas` is the SAME object (`toBe`) as for `/operacional/vendas/<uuid>`, with `params.saleId` undefined.
   - `still sends a four-segment path to the catch-all`: `/a/b/c/d` last match `route.path === '*'`.
   If importing `../router` throws in happy-dom because of a module side effect, `vi.mock` only the offending module and say so in the exec notes; do not move the route table.
   Green: router.tsx changes.
3. Red: update the two direct `SalesView` harnesses so they compile against the new props, and add the branch oracle.
   - `apps/web/src/sales-ops/__tests__/sales-transition-actions.test.tsx`: pass `detailSaleId={null}`, `onOpenDetail={vi.fn()}`, `onCloseDetail={vi.fn()}`.
   - `apps/web/src/sales-ops/__tests__/sales-view.test.tsx`: `renderSalesView` renders a tiny `ControlledSalesView` test component holding `const [detailSaleId, setDetailSaleId] = useState<string | null>(props.detailSaleId ?? null)` and passing `onOpenDetail={setDetailSaleId}`, `onCloseDetail={() => setDetailSaleId(null)}`, so `opens the read-only detail on row click in read-only mode` keeps its title and body unchanged.
   - New test in `sales-view.test.tsx`: `renders the open proposta even when the filters hide every row`: `renderSalesView({ sales: [], detailSaleId: wonSale.id })` shows `Nenhuma proposta encontrada` AND `Plano de pagamento`.
   - New test in `sales-view.test.tsx`: `renders the not-found state over an empty organization`: bootstrap override with `sales: []`, `detailSaleId: 'no-such-sale'`, shows `Nenhuma proposta registrada` AND `Proposta não encontrada`, and `container.textContent` does not contain `no-such-sale`.
   Green: `SalesView` and `SaleNotFoundDialog` changes (step 6 and 7 of the design).
4. Red: new `apps/web/src/sales-ops/__tests__/sale-deep-link.test.tsx` (`// @vitest-environment happy-dom`). Clone the harness of `routing.test.tsx` (the `@/auth/react` mock with mutable `profileRoles`, the `../hooks` mock, `LocationProbe` with Back/Forward buttons, `renderHistory(entries, roles)`), with these differences:
   - Do NOT mock `@/components/ui/dialog`: the real Radix dialog provides the `Fechar` close button. Radix portals into `document.body`, so query `document.body`, and remove `[data-radix-portal]` nodes in `afterEach` as `routing.test.tsx` does.
   - Mock `@/components/ui/dropdown-menu` and `@/components/ui/alert-dialog` exactly as `sales-view.test.tsx` does if the real ones get in the way.
   - Routes: `<Route element={<SalesOpsApp />} path="/" />` and `<Route element={<SalesOpsApp />} path={SALES_OPS_ROUTE_PATTERN} />`.
   - The bootstrap mock returns a mutable `let bootstrapData` reset in `beforeEach` to a fixture with one won proposta `P-003` (reuse the `sale()` factory and the won-sale rows from `sales-view.test.tsx`, adapted to whatever fields slices 03 to 08 added to the types) plus `funcoes`/`people` as in `routing.test.tsx`.
   Tests (titles exact):
   - `opens the proposta named by the URL without a click`: `/operacional/vendas/<SALE_ID>`, admin roles; pathname unchanged; `h1` is `Propostas`; body text contains `Proposta P-003` and `Plano de pagamento`.
   - `pushes the detail on a row click and pops it on close`: `renderHistory(['/tatico/dashboard', '/operacional/vendas'], team)`; click the `P-003` row; pathname is `/operacional/vendas/<SALE_ID>`; click the `Fechar` button; pathname is `/operacional/vendas` and the detail text is gone; click `Back`; pathname is `/tatico/dashboard` (a push-on-close implementation would land on the detail instead).
   - `replaces the deep link with the list when a cold-entered detail closes`: `renderHistory(['/tatico/dashboard', '/operacional/vendas/<SALE_ID>'], team)`; click `Fechar`; pathname `/operacional/vendas`; click `Back`; pathname `/tatico/dashboard` (a `navigate(-1)` here would be wrong only if the entry were missing, and a push would leave the detail one Back away; assert the Back lands on the dashboard).
   - `shows Proposta não encontrada for an unknown or other-organization id`: `/operacional/vendas/<OTHER_UUID>`; text contains `Proposta não encontrada` and not `<OTHER_UUID>`; click `Voltar para a lista`; pathname `/operacional/vendas`; not-found text gone.
   - `follows the visibility rules for an operator without Operacional`: roles `['finder']` at `/operacional/vendas/<SALE_ID>` gives pathname `/meus-dados/finders` and no `Proposta P-003` text; roles `['seller']` gives `/meus-dados/vendedores`.
   - `drops the id on a page that is not the propostas list`: admin at `/operacional/comissoes/<SALE_ID>` gives `/operacional/comissoes`.
   - `opens the read-only detail from the finder Indicações link as well`: `['finder']` at `/meus-dados/vendas/<SALE_ID>` stays there and shows `Proposta P-003`.
   Green: SalesOpsApp items 1 to 5 of the design.
5. Red: `apps/web/src/auth/__tests__/session-recovery.test.ts`, inside `describe('sanitizeReturnTo')`: `keeps a proposta deep link with its id segment` (`sanitizeReturnTo('/operacional/vendas/<uuid>', ORIGIN)` equals the input), and inside `describe('captureReturnTo / consumeReturnTo')`: `round-trips a proposta deep link with its id segment`. These should pass immediately; they pin the contract C8 relies on, and a mutation that trims `sanitizeReturnTo` to two segments turns them red.
6. Red: `apps/web/src/__tests__/session-journey.test.tsx`:
   - `mountApp` mirrors `router.tsx` again: replace the `path="/:workspace/:view"` route's path with `SALES_OPS_ROUTE_PATTERN`, and add a last `<Route element={<Navigate replace to="/" />} path="*" />` (import `Navigate`), exactly like `router.tsx`. Update the comment above `mountApp` from "the two Sales Ops routes" to name the optional segment and the catch-all.
   - Make the bootstrap mock read a mutable `let bootstrapData = bootstrapFixture`, reset to `bootstrapFixture` in `beforeEach`, so existing tests are byte-identical in behaviour.
   - New test: `lands on the proposta deep link after a cold entry with no session and a login`: set `bootstrapData` to a fixture containing proposta `P-003` with id `SALE_ID`; `mocks.cache.getToken.mockResolvedValue(expired)`; `mountApp('/operacional/vendas/' + SALE_ID)`; `flushReact()`; expect `mocks.client.login` called once and `sessionStorage.getItem(RETURN_TO_KEY)` to be `/operacional/vendas/${SALE_ID}`; `completeHubRoundTrip(app, adminToken)` (lands on `/`); expect `locationText(next.host)` to be `/operacional/vendas/${SALE_ID}` and `document.body.textContent` to contain `Proposta P-003` (the dialog portals to `document.body`; if this file mocks nothing about dialogs the real one is used, which is fine).
   Green: already green after step 2 (the route is the fix); if it is not, the failure is the evidence and must be fixed in the route, never by special-casing the auth code.
7. Docs (below), in the same change.
8. Refactor: none expected. Run the full web suite, lint and type-check once:
   `pnpm --filter @fxl-sales/web exec vitest run`, `pnpm --filter @fxl-sales/web run lint`, `pnpm --filter @fxl-sales/web run type-check`.

## Oracle tests

Command (run from the worktree root):

```bash
pnpm --filter @fxl-sales/web exec vitest run \
  src/sales-ops/__tests__/navigation.test.ts \
  src/sales-ops/__tests__/sale-deep-link.test.tsx \
  src/sales-ops/__tests__/sales-view.test.tsx \
  src/sales-ops/__tests__/sales-transition-actions.test.tsx \
  src/sales-ops/__tests__/routing.test.tsx \
  src/__tests__/sale-deep-link-route.test.ts \
  src/__tests__/session-journey.test.tsx \
  src/__tests__/route-error-and-auth-context.test.tsx \
  src/auth/__tests__/session-recovery.test.ts \
  src/sales-ops/leads/__tests__/board-write-surface.test.ts
pnpm --filter @fxl-sales/web exec eslint src/sales-ops/navigation.ts src/router.tsx src/sales-ops/SalesOpsApp.tsx src/sales-ops/__tests__/sale-deep-link.test.tsx src/__tests__/sale-deep-link-route.test.ts src/__tests__/session-journey.test.tsx
```

Check the vitest summary reports the new test files by name and a non-zero test count (a missing file exits 0).

Named oracles and the mutation that proves each is not vacuous:

| Oracle | Mutation that must turn it red |
| --- | --- |
| `keeps a proposta id only on the vendas view` | drop the `saleId` handling in `resolveSalesOpsRoute` (id never kept), or remove `view === 'vendas' &&` (id kept on comissoes) |
| `drops a proposta id for an operator who cannot see the workspace` | carry `params.saleId` into the fallback route |
| `builds the proposta detail path with the id as its own segment` | remove `encodeURIComponent` (the `a/b` case) or return the base path |
| `serves a proposta deep link from the protected Sales Ops route, not the catch-all` | revert the route path to `'/:workspace/:view'` |
| `serves the list from the same route object as the detail` | add a second route object for `/:workspace/:view/:saleId` instead of the optional segment |
| `opens the proposta named by the URL without a click` | keep `detailSaleId` in `SalesView` local state initialised to `null` |
| `pushes the detail on a row click and pops it on close` | make `closeSaleDetail` always `navigate(listPath)` (push) |
| `replaces the deep link with the list when a cold-entered detail closes` | make `closeSaleDetail` always `navigate(-1)` |
| `shows Proposta não encontrada for an unknown or other-organization id` | render `null` when the sale is missing, or interpolate the id into the copy |
| `renders the open proposta even when the filters hide every row` | drop `{detailLayer}` from the `sales.length === 0` early return |
| `renders the not-found state over an empty organization` | drop `{detailLayer}` from the `bootstrap.sales.length === 0` early return |
| `follows the visibility rules for an operator without Operacional` | special-case the deep link to bypass `getVisibleWorkspaces` |
| `lands on the proposta deep link after a cold entry with no session and a login` | revert the route path (the harness `*` then rewrites to `/` before `Protected` captures, so returnTo is `null`) |
| `keeps a proposta deep link with its id segment` | make `sanitizeReturnTo` return only the first two path segments |

Verify performs at least the route-path revert and the push-on-close mutation for real and records the red output.

### Real-browser check (Verify, `make dev-fake`)

1. `make dev-fake-setup` if the local DB is not seeded, then `make dev-fake` in the background; record the process-group id and kill exactly that group at the end.
2. As `team-owner`, open `http://localhost:8006/operacional/vendas`, click a proposta row: the address bar shows `/operacional/vendas/<uuid>` and the detail opens. Close with the X: back to `/operacional/vendas`. Press browser Back: you leave the list (previous page), the detail does NOT reopen.
3. Copy a detail URL, open a NEW tab (a fresh document), paste it: the loading panel shows first, then the detail opens with no click and no flash of `Proposta não encontrada`. Reload: still open. Close: URL becomes `/operacional/vendas` and Back does not reopen it.
4. Change one hex digit of the id: `Proposta não encontrada`, the id appears nowhere on screen, `Voltar para a lista` goes to `/operacional/vendas`. Escape does the same.
5. With a detail URL open, switch Organization from the account menu (if the identity holds two): the detail becomes `Proposta não encontrada`, and `Voltar para a lista` shows the new org's list.
6. Prospecção board: a converted card's proposta link opens that proposta's detail; closing returns to the board via Back semantics.
7. Paste `/meus-dados/vendas/<uuid>` of a seeded proposta: read-only detail opens under `Meus dados`.
8. Paste `/operacional/comissoes/<uuid>`: rewritten to `/operacional/comissoes`.
9. Pixel pass: the not-found dialog is centred, its button aligned right with the same padding as the detail header, no horizontal scroll at 375px width, and the Radix X does not overlap the title.
10. The no-session login round trip cannot happen in dev-fake (the stand-in always mints a token and `login()` reloads). It is proven by `lands on the proposta deep link after a cold entry with no session and a login`. If a local Hub answers at `http://localhost:9016`, additionally run `make dev`, open the deep URL in a private window, sign in at the Hub, and confirm you land on `/operacional/vendas/<uuid>` with the detail open; otherwise record in the verify notes that step 10 was covered by the oracle only.

## Docs

CLAUDE.md, `## Sales Ops Routing` (one sentence per line, no em dash):

- Replace the `- Routes:` line with:
  `- Routes: `tatico/dashboard`, `operacional/vendas|comissoes|leads`, `cadastros/produtos|areas|clientes|pessoas|funcoes|etapas|geral`, `meus-dados/vendedores|comissoes|leads|finders|vendas`, plus the proposta detail `operacional/vendas/:saleId` (and `meus-dados/vendas/:saleId`).`
- Insert after `- The URL is the single source of truth for the active workspace and page.`:
  `- The open proposta detail is URL state too: one route `SALES_OPS_ROUTE_PATTERN` (`/:workspace/:view/:saleId?`) and `saleId` is honoured only on the `vendas` view; never hold the open detail in component state.`
  `- `buildSaleDetailPath` builds `/operacional/vendas/<id>`, the Finance `deepLinkPath`; an invisible workspace drops the id through the ordinary role default.`
  `- An unknown or other-org id renders `Proposta não encontrada` without the id; closing pops history when opened in-app (`SALE_DETAIL_OPENED_IN_APP`) and otherwise replaces the URL with the list.`

`nexo/knowledge/reference/sales-ops-routing.md`, append a bullet block (one sentence per line):

- `- The proposta detail has a URL, added for the Finance "Editar no Sales" link (audit 11.4 `deepLinkPath`, contract C8 of feature `20260924T013019Z-finance-prereqs`).`
- `  Before it, `/operacional/vendas/<id>` matched only the `*` catch-all, which sits OUTSIDE `Protected` and rewrote the URL to `/` before a cold entry could capture it, so the id was lost on the way to login.`
- `  The fix is the route, not the auth code: the Sales Ops route became `/:workspace/:view/:saleId?`, one route object, so the list and the detail never remount `SalesOpsApp`.`
- `  `sanitizeReturnTo` already keeps any same-origin path, so the id survives the Hub round trip untouched; `lands on the proposta deep link after a cold entry with no session and a login` in `session-journey.test.tsx` is the oracle, and its harness mirrors the `*` route on purpose.`
- `  The segment is honoured on the `vendas` view of BOTH workspaces because `SalesView` is one component in both; restricting it to `operacional` would leave two mechanisms for one dialog. Only `/operacional/vendas/<id>` is ever published.`
- `  A finder-only or seller-only operator following the Finance link lands on their role default; it is deliberately not re-mapped to `meus-dados/vendas/<id>`, because the link's audience is an admin.`
- `  Closing pops history only when the entry carries the in-app marker; a cold-entered detail is replaced by the list, so Back never reopens a closed detail. The marker decides history mechanics only, never what is on screen.`
- `  The not-found dialog can only mount after the bootstrap loads, because `SalesView` mounts only then, so a slow load never flashes `Proposta não encontrada`.`
- `  Oracles: `navigation.test.ts` (`keeps a proposta id only on the vendas view`, `drops a proposta id for an operator who cannot see the workspace`), `sale-deep-link-route.test.ts`, `sale-deep-link.test.tsx`.`

`nexo/knowledge/reference/propostas.md` is not touched: no proposta domain rule changes.

## Security notes

- The id never reaches the API from this slice: lookup is `===` against the already org-scoped `/bootstrap`, so an other-org id is indistinguishable from a nonexistent one (no existence oracle across tenants), and the copy is the same for both.
- The id is never rendered (CLAUDE.md `## UI Identifiers`); the not-found oracle asserts its absence.
- `returnTo` keeps using `sanitizeReturnTo` unchanged; the new segment adds no new redirect surface (same-origin relative path only).
- `location.state` is read only as a boolean marker through a type guard; it never selects a destination, so a forged state can at most turn a close into a Back.
- Visibility is still `getVisibleWorkspaces` only; the deep link grants nothing a row click did not already grant.

## Contract deviations

None. C8's path is implemented exactly; the extra `meus-dados/vendas/:saleId` is a consequence of the same rule and is not part of the published contract.

## Decisions for AUDIT

- D09-1: `meus-dados/vendas/:saleId` exists (the finder's read-only Indicações detail), unpublished, because `SalesView` is one component and the URL must be the single source of the open detail everywhere it renders. The Finance link is only `/operacional/vendas/:saleId`.
- D09-2: A non-admin following the Finance link gets the existing role default (id dropped), not a re-map into `meus-dados`.
- D09-3: Unknown and other-org ids share one `Proposta não encontrada` state with no id and no org name, shown as a dialog over the list with `Voltar para a lista`.
- D09-4: Closing a detail pops history when it was opened in-app and replaces the URL with the list otherwise, so Back never reopens a closed detail.
- D09-5: The lead board's converted-card link now opens the proposta detail itself instead of the bare list (it already carried the id and discarded it).

## Out of scope

- Any API change, including a server-side `deepLinkPath` builder (that belongs to the integration work; the format is fixed here as `/operacional/vendas/<saleId>`).
- Settlement UI and the wizard (slices 05 and 08); `SaleDetailDialog` internals are untouched apart from its caller.
- Opening the wizard from the URL (`/edit`), filters in the URL, and re-mapping non-admin deep links.
- The auth code (`react.tsx`, `session-recovery.ts`): proven, not changed.
