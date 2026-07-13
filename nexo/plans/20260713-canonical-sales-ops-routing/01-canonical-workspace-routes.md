---
id: 01-canonical-workspace-routes
milestone: null
status: done
depends_on: []
files_modified: [apps/web/src/router.tsx, apps/web/src/sales-ops/navigation.ts, apps/web/src/sales-ops/SalesOpsApp.tsx, apps/web/src/sales-ops/__tests__/navigation.test.ts, apps/web/src/sales-ops/__tests__/routing.test.tsx]
acceptance: "Given a role-authorized Sales Ops user, when a canonical workspace URL is opened or shell navigation and browser history are used, then the URL is the single source of truth for the visible workspace and page, while invalid or unauthorized routes are replaced with that role's first valid canonical route."
---

# Slice 01 - Canonical workspace routes

## Goal

Make `/tatico/:page`, `/operacional/:page`, and `/cadastros/:page` canonical Sales Ops URLs.
Direct links, refreshes, shell navigation, and browser Back and Forward must render from the URL instead of mirrored React workspace or view state.

## Route and role contract

The canonical page matrix is fixed.

| Workspace | Canonical pages |
| --- | --- |
| `tatico` | `dashboard`, `vendedores`, `finders` |
| `operacional` | `vendas`, `comissoes` |
| `cadastros` | `produtos`, `clientes`, `geral` |

`equipe` can use the full matrix.
`vendedor` can use `/tatico/vendedores` plus both operational pages.
`finder` can use `/tatico/finders` plus both operational pages.
The role defaults are `/tatico/dashboard`, `/tatico/vendedores`, and `/tatico/finders`, respectively.
Root, unknown workspace slugs, mismatched workspace-page pairs, role-forbidden tactical pages, and every `/cadastros/*` request by a non-team role resolve to that role default with replace semantics.

## Exact pure helper interfaces

In `navigation.ts`, rename `SalesOpsWorkspace` member `config` to `cadastros` and rename the private `config` item array accordingly.
Set the workspace metadata label to exactly `Cadastros` so the domain name, URL, workspace switcher, collapsed workspace button, and tests use one visible vocabulary.
Export these exact interfaces and functions.

```ts
export type SalesOpsRoute = Readonly<{
  workspace: SalesOpsWorkspace;
  view: SalesOpsView;
}>;

export type SalesOpsRouteParams = Readonly<{
  workspace?: string;
  view?: string;
}>;

export type SalesOpsRouteResolution = Readonly<{
  route: SalesOpsRoute;
  path: string;
  redirect: boolean;
}>;

export function buildSalesOpsPath(route: SalesOpsRoute): string;

export function getDefaultSalesOpsRoute(
  role: SalesOpsRoleView,
  preferredWorkspace?: SalesOpsWorkspace,
): SalesOpsRoute;

export function resolveSalesOpsRoute(
  params: SalesOpsRouteParams,
  role: SalesOpsRoleView,
): SalesOpsRouteResolution;
```

`buildSalesOpsPath` returns exactly `/${workspace}/${view}`.
`getDefaultSalesOpsRoute` returns the first role-visible page in `preferredWorkspace` when that workspace is accessible, otherwise the role's tactical default.
`resolveSalesOpsRoute` preserves only an exact workspace-page pair present in `getSalesOpsNavigation(workspace, role)`.
For a preserved pair it returns the matching path and `redirect: false`.
For missing, unknown, mismatched, or forbidden params it returns the role's tactical default path and `redirect: true`.
`getSalesOpsNavigation('cadastros', 'vendedor')` and `getSalesOpsNavigation('cadastros', 'finder')` return `[]` exactly.
`getSalesOpsNavigation('operacional', role)` continues to return `vendas` and `comissoes` for every role.
Keep `workspaceForView` as the lookup used by page and dashboard navigation, but make it return `cadastros` for catalogue pages.

## RED 1 - Pure route matrix and redirects

Extend `navigation.test.ts`.
Change existing `config` expectations to `cadastros`.
Assert the `cadastros` workspace metadata label is exactly `Cadastros`.
Assert non-team `cadastros` navigation returns `[]`, while operational navigation remains `['vendas', 'comissoes']` for all three roles.
Add table-driven tests that lock all eight canonical pairs for `equipe` and the complete allowed matrices for `vendedor` and `finder`.
For every allowed pair, assert `resolveSalesOpsRoute` returns that route, its exact canonical path, and `redirect: false`.

Add table-driven role redirect cases for:

- `{}` and `{ workspace: 'unknown', view: 'vendas' }` for all three roles.
- Every mismatched pair formed by a valid workspace with a page owned by another workspace.
- `/tatico/dashboard` and `/tatico/finders` for `vendedor`.
- `/tatico/dashboard` and `/tatico/vendedores` for `finder`.
- `/cadastros/produtos`, `/cadastros/clientes`, and `/cadastros/geral` for both non-team roles.

Each redirect assertion must require the exact role default path and `redirect: true`.
Also assert `getDefaultSalesOpsRoute(role, workspace)` returns the first visible page of an allowed workspace and falls back to the tactical role default for inaccessible `cadastros`.
Assert `buildSalesOpsPath` for at least one route in each workspace.

Run:

```sh
pnpm --filter @fxl-sales/web test -- src/sales-ops/__tests__/navigation.test.ts
```

RED must fail because `cadastros` and the route helpers do not exist.

## GREEN 1 - Pure navigation model

Replace all internal `config` workspace identifiers with `cadastros`, including workspace metadata and visual lookup keys.
Rename the private item constant to `cadastros`, set its visible workspace label to `Cadastros`, and make the `cadastros` branch return that array only for `equipe` and `[]` for both non-team roles.
Implement the helpers from the existing navigation arrays so page membership has one owner.
Do not parse paths with substring checks or maintain a second route table in `SalesOpsApp.tsx`.
Run the RED 1 command and require PASS.

## RED 2 - Rendered shell, navigation, and history

Create `routing.test.tsx` with `// @vitest-environment happy-dom`.
Mock `useAuthProfile`, `useLogout`, all Sales Ops query and mutation hooks, and dialog portals so the real exported `SalesOpsApp` shell can render with an empty successful bootstrap.
Render it inside `MemoryRouter` and `Routes` with the same `/` and `/:workspace/:view` route patterns that production uses.
Add a `LocationProbe` based on `useLocation` that exposes `location.pathname` and buttons calling `navigate(-1)` and `navigate(1)`.
Use React `act`, unmount the root after every test, and remove portal content.
Keep a mutable `profileRoles` fixture read by the mocked `useAuthProfile`, and initialize it explicitly for every render so admin, seller, finder, and multi-role cases are deterministic.

Add these exact rendered test names.

```ts
it('renders a canonical deep link and drives shell navigation through the URL', async () => {});
it('restores the visible workspace and page through browser history', async () => {});
it('replaces invalid and role-forbidden routes with the role default', async () => {});
it('preserves or replaces the route when the active role changes', async () => {});
it('navigates from the dashboard sales card to operational sales', async () => {});
```

The first test starts at `/operacional/vendas`, asserts the Operacional workspace and `Vendas` heading, clicks `Comissões`, and asserts both `/operacional/comissoes` and the `Comissões` heading.
It then opens the workspace menu, clicks the exact visible label `Cadastros`, and asserts `/cadastros/produtos`, the Cadastros workspace, and the `Produtos` heading without a document reload.

The history test starts at `/tatico/dashboard`, navigates through shell controls to `/operacional/vendas` and then `/operacional/comissoes`, invokes the probe Back button twice and Forward once, and after each action asserts both the exact pathname and the visible heading/workspace.
This is the oracle that proves active UI state follows history entries rather than stale local state.

The redirect test rerenders role fixtures and covers `/` for `equipe`, `/cadastros/produtos` for `vendedor`, and `/tatico/dashboard` for `finder`.
Assert the probe reports `/tatico/dashboard`, `/tatico/vendedores`, and `/tatico/finders`, respectively, after replace navigation, with the matching heading.

The role-switch test uses the deterministic `['admin', 'seller', 'finder']` profile fixture.
First render `/operacional/vendas`, open the role menu, choose `Vendedor`, and assert the still-authorized `/operacional/vendas` route and Vendas heading are preserved.
Rerender at `/cadastros/produtos` with the same multi-role fixture, open the role menu, choose `Finder`, and assert replace navigation to `/tatico/finders` with the Finder tactical heading.
The test must select role menu options by their complete visible option identity, not by changing the mocked profile after render.

The dashboard test starts at `/tatico/dashboard` as `equipe`, clicks the DashboardView `Ver todas` button, and asserts `/operacional/vendas`, the Operacional workspace, and the Vendas heading.
This locks the dashboard-card `go('vendas')` path in addition to sidebar navigation.

Run:

```sh
pnpm --filter @fxl-sales/web test -- src/sales-ops/__tests__/routing.test.tsx
```

RED must fail because the shell still derives selection from `workspaceState` and `viewState`, does not navigate, and production does not mount canonical paths.

## GREEN 2 - Router and shell wiring

In `router.tsx`, keep the protected Sales Ops root route at `/`.
After all static `/admin/*`, `/finder/*`, `/seller/*`, and `/no-role` route declarations, mount the same protected `SalesOpsApp` element once at `/:workspace/:view` so both parameters are supplied to `useParams`.
React Router's static-route ranking keeps every legacy tree ahead of this dynamic two-segment Sales Ops route, and `resolveSalesOpsRoute` rejects every dynamic value outside the canonical matrix.
Keep `/admin/*`, `/finder/*`, `/seller/*`, `/no-role`, their guards, and their redirect behavior byte-for-byte unless formatting requires movement.
Keep the final catch-all redirect to `/`.

In `SalesOpsApp.tsx`, read `workspace` and `view` with `useParams`, derive `SalesOpsRouteResolution` from the active role, and use its route as the only active workspace and view.
Delete `workspaceState` and `viewState` completely.
After the no-role guard, return `<Navigate to={resolution.path} replace />` when `resolution.redirect` is true.

Use `useNavigate` in all route-changing handlers.
`setWorkspace` calls `navigate(buildSalesOpsPath(getDefaultSalesOpsRoute(activeRoleView, nextWorkspace)))`.
`go` navigates to `buildSalesOpsPath({ workspace: workspaceForView(nextView, activeRoleView), view: nextView })`.
`setRole` first computes `const nextResolution = resolveSalesOpsRoute({ workspace, view }, next)`.
It updates `selectedRoleView`, leaves the URL untouched when `nextResolution.redirect` is false, and otherwise calls `navigate(nextResolution.path, { replace: true })` so an allowed operational route is preserved and a newly forbidden Cadastros route is replaced by the new role's tactical default.
Workspace, page, dashboard-card, and role navigation must not write local route state or call `window.location`.
Menu-open, filters, dialogs, role selection, and other non-route state remain local.

Run the RED 2 command and require PASS.
Then run both route oracles together:

```sh
pnpm --filter @fxl-sales/web test -- src/sales-ops/__tests__/navigation.test.ts src/sales-ops/__tests__/routing.test.tsx
```

## Refactor and Gate 2 verification commands

The implementer runs the focused oracles above plus `git diff --check` before handoff.
The separate Verify agent runs these exact repository-root commands once, without watch mode.

```sh
CI=true pnpm test
pnpm lint
pnpm type-check
pnpm build
pnpm audit --audit-level high
git diff --check
```

Gate 2 must be run by a different Verify agent after implementation.
That agent must additionally inspect the route diff and confirm the legacy route trees are unchanged in behavior.

## Browser E2E behavior

With an authenticated team account, open `/operacional/vendas` directly and verify the Operacional workspace and Vendas page render.
Navigate to Comissões, switch to Cadastros, navigate to Clientes, and verify the URL after every click.
Use browser Back and Forward and verify the heading, active sidebar item, and workspace tile match each URL.
Refresh `/cadastros/clientes` and verify it remains selected.
With a seller or finder role, open `/cadastros/produtos` directly and verify replacement to `/tatico/vendedores` or `/tatico/finders`.
Open one existing `/admin/*`, `/finder/*`, `/seller/*`, and `/no-role` path to confirm the legacy trees remain intact.
Stop every dev or preview process started for this check, including its process group.

## Scope exclusions

- Do not change API endpoints, auth claims, role grants, server rewrites, database schemas, or persistence.
- Do not rename or redirect the independent `/admin/*`, `/finder/*`, `/seller/*`, or `/no-role` trees.
- Do not add per-page route components, nested layouts, URL query parameters, breadcrumbs, transition animations, or route analytics.
- Do not persist the selected role view in the URL or storage.
- Do not retain legacy `/config/*` Sales Ops aliases because `config` was internal state, not an existing browser route.
- Do not redesign the shell or modify page business behavior.

## Done contract

The pure navigation oracle passes the full route and role matrix.
The rendered MemoryRouter oracle proves deep linking, click navigation, replace redirects, and Back and Forward synchronization with the real shell.
The repository-wide `CI=true pnpm test`, `pnpm lint`, `pnpm type-check`, `pnpm build`, `pnpm audit --audit-level high`, and `git diff --check` commands pass.
A separate Verify agent reports PASS and confirms the existing legacy route trees remain behaviorally unchanged.
The authenticated browser audit passes or records a concrete environment blocker without substituting a non-user-equivalent test.
