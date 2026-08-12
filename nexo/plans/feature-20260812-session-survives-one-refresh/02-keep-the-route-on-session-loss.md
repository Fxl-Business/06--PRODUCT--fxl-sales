---
id: 02-keep-the-route-on-session-loss
milestone: v2.8.0
status: todo
depends_on: []
files_modified:
  - apps/web/src/sales-ops/SalesOpsApp.tsx
  - apps/web/src/sales-ops/__tests__/session-loss-keeps-route.test.tsx
acceptance: "given a live session is lost while the operator is on /tatico/dashboard, when the signed-out overlay renders, then the URL stays /tatico/dashboard and Entrar captures that route rather than /no-role"
goal: Stop a signed-out render of the still-mounted children from rewriting the URL to /no-role.
must_not_break:
  - the keep-children-mounted overlay branch that preserves unsaved wizard state
  - the genuine no-role redirect for a signed-in operator who really has zero visible workspaces
  - the legacy-view alias redirect to /cadastros/pessoas
rules:
  - SalesOpsApp must never unmount its subtree on a session loss
  - do not edit apps/web/src/auth/react.tsx in this slice
  - no em dashes anywhere
verifier_focus: that the fix suppresses only the navigation and does not unmount the subtree, and that the new test genuinely fails when the guard is removed
---

# 02 - Keep the route on session loss

## Context

This slice fixes amplifier B from `nexo/plans/feature-20260812-session-survives-one-refresh/00-OVERVIEW.md`.
It is a web-only slice and it is independent of slices 01, 03 and 04.

### What is correct today and must stay correct

`HubProtected` in `apps/web/src/auth/react.tsx:813-837` is the `liveSessionLoss` branch.
It renders `SignedOutPanel` with the title `Sua sessão expirou` inside a `fixed inset-0 z-50 overflow-y-auto bg-background/95 backdrop-blur-sm` overlay, and it renders `{children}` as a sibling ABOVE that overlay in the fragment.
It is the only branch in that component that does not replace the subtree.
CLAUDE.md states the reason in the "Auth Model" section: React state lives exactly as long as the component holding it, so the operator's half-filled proposta wizard survives precisely because the subtree underneath the overlay is never unmounted.
That branch was shipped by `nexo/runs/quick-20260810-preserve-work-on-session-loss`.

This slice does not touch `apps/web/src/auth/react.tsx` at all.
Slice 03 owns the return-to hardening in `apps/web/src/auth/session-recovery.ts`, and slice 04 owns `apps/web/src/pages/errors/NoRolePage.tsx`.
Do not edit either file here.

### What is broken

`SalesOpsApp` in `apps/web/src/sales-ops/SalesOpsApp.tsx` is the child that stays mounted under the overlay.
At line 1005 it reads `const profile = useAuthProfile()`.
When the session is lost, `applyToken(null)` in `apps/web/src/auth/react.tsx:243-273` pushes `{ isLoaded: true, isSignedIn: false, roles: [] }`, so `profile.roles` becomes `[]` while the component is still mounted.

`getVisibleWorkspaces([])` in `apps/web/src/sales-ops/navigation.ts:95-105` returns `[]`, so line 1245 fires:

```tsx
if (visibleWorkspaceIds.length === 0) {
  return <Navigate to="/no-role" replace />;
}
```

Two things go wrong at once, and both matter.

First, the URL is rewritten to `/no-role`.
CLAUDE.md's "Sales Ops Routing" section declares that the URL is the single source of truth for the active Sales Ops workspace and page, so the branch that exists to preserve the operator's work destroys the one durable record of where they were.
`HubProtected`'s login effect then calls `captureReturnTo(currentPath, currentOrigin())` at `apps/web/src/auth/react.tsx:769` with `/no-role`, so after `Entrar` and the Hub round trip the operator is restored to a dead end.
This is the confirmed production report: `Sua sessão expirou` rendered at `sales.fxlbusiness.com/no-role` for an operator who had been on `/tatico/dashboard`.

Second, and less obvious, `return <Navigate .../>` is itself an unmount.
`SalesOpsApp` stops rendering its shell, so every piece of React state it holds and every subtree beneath it is destroyed on that render, before the URL even changes.
So today the keep-children-mounted branch is already load-bearing in name only for this app: `Protected` keeps `SalesOpsApp` mounted, and `SalesOpsApp` immediately throws the work away itself.

The second early return, line 1249, has exactly the same shape and exactly the same two defects:

```tsx
if (resolution.redirect) {
  return <Navigate to={resolution.path} replace />;
}
```

`resolveSalesOpsRoute(params, [])` in `apps/web/src/sales-ops/navigation.ts:175-194` cannot match any workspace against an empty role set, so it falls through to `getDefaultSalesOpsRoute([])`, which returns `{ workspace: 'tatico', view: 'dashboard' }` with `redirect: true`.
With an empty role set that resolution is `redirect: true` for EVERY url.
So on `/tatico/dashboard` the second branch would unmount the subtree and re-navigate to the path it is already on, and on `/cadastros/produtos` it would unmount the subtree AND rewrite the url to `/tatico/dashboard`.
Guarding only the first branch would move the bug rather than fix it.

### Why the obvious fix is forbidden

Returning `null`, a `Skeleton`, a `LoadingPanel` or any other early return while signed out UNMOUNTS the subtree.
That destroys exactly the React state the overlay branch exists to protect, which silently re-breaks `quick-20260810-preserve-work-on-session-loss`.
Do not do it.
The fix must suppress ONLY the two navigations and leave the rest of the render untouched.

## Design decisions

### 1. The guard term is `profile.isSignedIn`, and nothing else

Add one derived constant and reference it from both early returns:

```tsx
const rolesAreAuthoritative = profile.isSignedIn;
```

Justification, term by term.

`profile.isSignedIn` is the necessary and sufficient term.
`applyToken` sets `isSignedIn: token !== null` in the same `setProfile` call that sets `roles: next.roles`, and `profileFromToken(null)` returns `roles: []`.
So `isSignedIn === true` is exactly the condition under which `profile.roles` is a real answer about this operator, derived from real claims, and `isSignedIn === false` is exactly the condition under which `roles === []` is the empty default of a session that is gone.
The question the two early returns want to ask is "does this operator really have no workspace", and `isSignedIn` is the one flag that says whether the role set is entitled to answer it.

`profile.isLoaded` is deliberately NOT added, because it is redundant and its presence would be misleading.
The provider's initial state is `{ isLoaded: false, isSignedIn: false, roles: [] }` and `applyToken` only ever writes `isLoaded: true`.
There is therefore no reachable state in which `isSignedIn === true` while `isLoaded === false`, so `isLoaded && isSignedIn` is identical to `isSignedIn` for every input.
Adding it would invite a future reader to believe the two can differ and to start branching on the difference.

The cold-boot case is covered by the same single term.
While `isLoaded` is false, `isSignedIn` is false, so both navigations are suppressed.
That is inert in practice, because both route definitions in `apps/web/src/router.tsx` (`/` at line 74 and `/:workspace/:view` at line 154) wrap `SalesOpsApp` in `Protected`, and `Protected` renders a `Skeleton` while `!isLoaded || !isSignedIn` unless the live-loss or logout branch fires first.
So `SalesOpsApp` can only ever render in two situations: signed in, or signed out under the live-loss overlay.
The guard is written to be correct in both without depending on that fact.

`profile.roles.length` is not a usable term and must not be used instead, because a signed-in operator with genuinely zero recognized roles has `roles === []` too, and that operator is the one who really does belong on `/no-role`.

### 2. BOTH early returns get the guard

```tsx
if (visibleWorkspaceIds.length === 0 && rolesAreAuthoritative) {
  return <Navigate to="/no-role" replace />;
}

if (resolution.redirect && rolesAreAuthoritative) {
  return <Navigate to={resolution.path} replace />;
}
```

Three reasons the second one needs it as much as the first.

1. Each is a `return <Navigate .../>` and therefore an unmount, which is the thing this slice exists to prevent.
2. With `roles === []` the resolution is `redirect: true` on every url, so on any route other than `/tatico/dashboard` the second branch rewrites the url on its own once the first is suppressed.
3. The alias redirect's actual job is role-dependent. `aliasLegacyView` only fires when the RESOLVED workspace is `cadastros`, and a workspace can only resolve when the role set admits it. A signed-out resolution cannot compute the alias correctly, so running it while signed out is not defence in depth, it is a wrong answer with confidence.

The genuine alias behaviour is unchanged for a signed-in operator, because `rolesAreAuthoritative` is true for them.
Test 5 below pins that.

A single shared constant rather than two copies of `profile.isSignedIn` is deliberate: it gives one place to document the decision, and it gives the verifier one term to delete when checking that the new test really fails.

### 3. What renders on fallthrough, and why nothing throws

This was checked line by line against the code below 1245.
Take the production case: url `/tatico/dashboard`, `roles === []`.

- `resolution` is `{ route: { workspace: 'tatico', view: 'dashboard' }, path: '/tatico/dashboard', redirect: true }`, so `workspace = 'tatico'` and `view = 'dashboard'`.
- `activeWorkspaceVisual = workspaceVisuals[workspace]` at line 1242 is SAFE and cannot be `undefined`. Note that `workspace` is NOT the raw url param: it comes from `resolution.route.workspace`, which is typed `SalesOpsWorkspace` and is produced either by a successful match against `getVisibleWorkspaces` or by `getDefaultSalesOpsRoute`, whose final fallback is the literal `{ workspace: 'tatico', view: 'dashboard' }`. `workspaceVisuals` is a total `Record<SalesOpsWorkspace, ...>` at line 263, so the index always hits and `ActiveWorkspaceIcon` at line 1243 is always a component.
- `activeWorkspaceMeta = salesOpsWorkspaces.find(...)` at line 1241 also always hits, and both of its read sites already carry `?? 'Tático'` fallbacks at lines 1318 and 1325.
- `availableWorkspaces` at line 1238 becomes `[]`. Its only consumer is the workspace dropdown at line 1349, which renders only while `workspaceMenuOpen && !sidebarCollapsed`. An empty `.map` renders nothing and cannot throw.
- `navItems = getSalesOpsNavigation('tatico', [])` returns the single `Visão geral` item, because only the `meus-dados` case reads `roles`.
- `roleSummaryLabel([])` at line 411 returns `''`, which renders as an empty muted line in the account tile.
- `userName = profile.name ?? 'FXL'` at line 1175 becomes `'FXL'`, and `initials('FXL')` is fine.
- `canManageCadastros`, `canManagePeople`, `canManageFuncoes` all become false, which only removes header actions.
- `bootstrap` is `bootstrapQuery.data ?? emptyBootstrap` at line 1042, so every downstream memo has real arrays. The bootstrap query is not flushed on a live loss: `queryClient.clear()` runs only on logout, on a signed-out to signed-in transition and on a workspace switch, never on `failSession()`.

So nothing throws and nothing needs to change below line 1245.
No defensive rewrite is required or permitted in this slice.

The one visible consequence, accepted deliberately: on a route outside `tatico`, the shell underneath the overlay flips to the Tático shell, because the resolution falls back to the default while the url is preserved.
That is invisible behind `bg-background/95 backdrop-blur-sm`, and it is the correct trade.
Crucially it does NOT cost the operator any work, because every piece of in-progress state is a shell-level sibling of the `view` switch rather than a child of it:
`SaleWizardDialog` (line 1815), `ProductDialog`, `ClientDialog`, `AreaDialog`, `FuncaoDialog` and `PersonDialog` all render after `</main>` and are driven by the `saleWizard` and `modal` state that lives on `SalesOpsApp` itself.
A `view` flip unmounts only the read-only list view, whose filter state (`salesFilters`, `productKind`, `filtersOpen`) also lives on `SalesOpsApp` and therefore survives.
When the operator signs back in, `captureReturnTo` restores the original url and the correct view comes back.

Do NOT try to improve on this by freezing the last signed-in `resolution` in a ref or in state.
That is a second source of truth for the active route, it contradicts CLAUDE.md's "the URL is the single source of truth" rule, and it buys nothing the operator can see.

## Implementation

### Step 1 - `apps/web/src/sales-ops/SalesOpsApp.tsx`

One edit, at lines 1243-1251.
Insert the derived constant with its comment after `const ActiveWorkspaceIcon = activeWorkspaceVisual.icon;`, then add the term to both conditions.
Change nothing else in the file.

Exact replacement for the block that currently reads:

```tsx
  const ActiveWorkspaceIcon = activeWorkspaceVisual.icon;

  if (visibleWorkspaceIds.length === 0) {
    return <Navigate to="/no-role" replace />;
  }

  if (resolution.redirect) {
    return <Navigate to={resolution.path} replace />;
  }
```

becomes:

```tsx
  const ActiveWorkspaceIcon = activeWorkspaceVisual.icon;

  /**
   * Whether `profile.roles` is an ANSWER about this operator or merely the empty
   * default of a session that is gone.
   *
   * `applyToken` writes `isSignedIn` and `roles` in one `setProfile`, and
   * `profileFromToken(null)` returns `roles: []`, so the two can never disagree:
   * a signed-out profile always reports zero roles, and zero roles from a signed-out
   * profile say nothing at all about entitlement.
   *
   * This gates both early returns below, and it exists because of the live-loss
   * overlay in `HubProtected`. That branch keeps `children` MOUNTED under
   * `Sua sessão expirou` precisely so the operator's half-filled proposta wizard
   * survives, and a `return <Navigate />` from here is an unmount: it throws that
   * work away and, worse, rewrites the URL that CLAUDE.md ("Sales Ops Routing")
   * makes the single source of truth for the active workspace and page. The login
   * effect then captures `/no-role` as the return-to, so `Entrar` restores a dead
   * end instead of the screen the operator was on. Measured in production.
   *
   * `profile.isLoaded` is deliberately absent: the provider's initial state is
   * `{ isLoaded: false, isSignedIn: false }` and `applyToken` only ever writes
   * `isLoaded: true`, so `isSignedIn === true` already implies it and adding the
   * term would suggest a state that does not exist.
   *
   * Do NOT "fix" this by returning `null` or a Skeleton while signed out. That
   * unmounts the subtree too, which is the exact regression
   * `quick-20260810-preserve-work-on-session-loss` closed.
   */
  const rolesAreAuthoritative = profile.isSignedIn;

  if (visibleWorkspaceIds.length === 0 && rolesAreAuthoritative) {
    return <Navigate to="/no-role" replace />;
  }

  /*
    Same guard, and it is not optional. With an empty role set every URL resolves to
    `redirect: true` on the `getDefaultSalesOpsRoute` fallback, so leaving this one
    unguarded simply relocates the bug: it would unmount the subtree and rewrite any
    non-`/tatico/dashboard` URL to `/tatico/dashboard`. The alias this branch really
    exists for (`/cadastros/vendedores` to `/cadastros/pessoas`) is role-dependent by
    construction, since `aliasLegacyView` only fires once the workspace has resolved
    to `cadastros`, which an empty role set can never do.
  */
  if (resolution.redirect && rolesAreAuthoritative) {
    return <Navigate to={resolution.path} replace />;
  }
```

No import changes.
No other file in `apps/web/src/sales-ops/` changes.

### Step 2 - `apps/web/src/sales-ops/__tests__/session-loss-keeps-route.test.tsx` (new)

Write the oracle FIRST and watch it go red on unmodified `SalesOpsApp.tsx`, then apply step 1.

#### What the harness has to provide

`SalesOpsApp` needs three things, and each has a settled answer.

1. Auth. The REAL `AppAuthProvider` and the REAL `Protected` from `@/auth/react`. This test must NOT mock `@/auth/react`, which is what `routing.test.tsx` and `blank-bearer-token.test.tsx` both do. Mocking it would delete the component under observation.
2. Data hooks. Mock `../hooks` exactly the way `apps/web/src/sales-ops/__tests__/routing.test.tsx:95-125` already does. That mock is proven against this component and it removes every network path in one line. Reuse it verbatim, with an empty bootstrap fixture.
3. i18n. Nothing to do. `SalesOpsApp.tsx` imports no `react-i18next` and calls no `useTranslation`; confirmed against its import block.

A `QueryClient` is still required, because `HubAuthProvider` calls `useQueryClient()`.
Mount it exactly as `App.tsx` does, `QueryClientProvider` OUTSIDE `AppAuthProvider`.
With `../hooks` mocked no query is ever created, so the client is only there to satisfy the provider.

Do NOT mock `@/components/ui/dialog`.
No dialog opens in this test: every `*Dialog` in `SalesOpsApp` early-returns `null` on `modal === null`, and `SaleWizardDialog` early-returns `null` on `!props.open`.
If the executor hits an unexpected Radix or happy-dom problem, lift the five-component dialog mock from `routing.test.tsx:127-141` verbatim rather than inventing one.

#### Helpers to lift from `apps/web/src/auth/__tests__/react.test.tsx`

Lift these verbatim, adjusting only import specifiers:

- The `vi.hoisted(() => ({ client, cache, createHubClient, createHubAccessTokenCache }))` block at lines 14-45, including the `satisfies HubClient` shape and the explicit generic on `createHubAccessTokenCache`.
- `vi.mock('@fxl-business/hub-sdk/client', ...)` at lines 47-49.
- The token-cache mock, lines 51-53, respelled as `vi.mock('@/auth/token', () => ({ createHubAccessTokenCache: mocks.createHubAccessTokenCache }))`. The `@` alias in `apps/web/vitest.config.ts` resolves to `./src`, so this resolves to the same file id as `react.tsx`'s own `./token` import and the mock applies. If it somehow does not, use the relative specifier `'../../auth/token'`, which resolves identically.
- The `ok` / `expired` / `transient` result constructors, lines 81-83.
- `jwt()` at lines 98-101 and the `profileToken` claim shape at lines 103-125, in particular `roles: { workspace: 'admin' }` and workspaces keyed `workspaceId`.
- `TokenProbe` at lines 160-168 and the `TokenReader` type, which is how a live session loss is driven.
- `LocationProbe` at lines 209-212.
- `flushReact()` at lines 256-261.
- `clickButton(host, label)` at lines 269-279.
- The `beforeEach` / `afterEach` bodies at lines 316-355, specifically: `vi.clearAllMocks()`, `sessionStorage.clear()`, a fresh `QueryClient` with `retry: false`, `vi.stubEnv('VITE_FXL_HUB_API_URL', 'http://hub.test')`, `vi.stubEnv('VITE_FXL_HUB_PUBLISHABLE_KEY', 'pk_fxl-sales_test')`, `mocks.cache.expiresAt.mockReturnValue(null)`, `mocks.cache.renew.mockResolvedValue(transient)`, `mocks.client.login.mockReturnValue(undefined)`, `mocks.client.logout.mockResolvedValue(undefined)`, `IS_REACT_ACT_ENVIRONMENT = true`, and the unmount plus `vi.unstubAllEnvs()` teardown.

Do NOT lift `vi.mock('../refresh', ...)`.
`react.tsx` hands `requestHubAccessToken` to `createHubAccessTokenCache`, which is mocked, so the real refresher is constructed and never called.
`apps/web/src/auth/refresh.ts` has no module-scope side effects.

Do NOT lift `useLadderTimers` and do NOT call `vi.useFakeTimers()` at all.
This test drives the loss with `expired`, which is the BFF's own `401`, and `observeToken` routes that straight to `failSession()` with no rung ever scheduled.
`mocks.cache.expiresAt` is pinned to `null`, so `scheduleRenewal()` clears and returns without arming the second timer source.
There is therefore nothing to advance, and no `vi.getTimerCount()` assertion belongs in this file.
CLAUDE.md's warning applies to the ladder oracle in `react.test.tsx`, not here: `vi.getTimerCount()` is only a ladder oracle while the renewal provably cannot arm, and this file asserts nothing about timers.
Note also the related trap it documents: happy-dom reports `visibilityState` as `visible` whenever the document has a `defaultView`, so a visibility guard alone would not keep anything inert. Pinning `expiresAt()` to `null` is what does the work.

#### The render tree

Mirror `apps/web/src/router.tsx` rather than inventing a shape.
There, `/no-role` and `/:workspace/:view` are two SEPARATE route objects, each with its own `<Protected>`, which is why the production bug unmounts the whole Sales Ops element.

```tsx
function renderApp(entry: string, held: { current: TokenReader | null }) {
  const host = document.createElement('div');
  document.body.append(host);
  const nextRoot = createRoot(host);

  act(() => {
    nextRoot.render(
      <QueryClientProvider client={queryClient}>
        <AppAuthProvider>
          {/*
            Outside the router and outside `Protected`, so the token reader that
            drives the loss stays reachable in every branch. `TokenProbe` uses no
            router hook.
          */}
          <TokenProbe onReady={(getToken) => { held.current = getToken; }} />
          <MemoryRouter initialEntries={[entry]}>
            {/*
              Outside `Routes`, so the URL is readable whichever route matches -
              including `/no-role`, which is where the unfixed code lands.
            */}
            <LocationProbe />
            <Routes>
              <Route
                element={
                  <Protected>
                    <div data-testid="no-role-page">Acesso não autorizado</div>
                  </Protected>
                }
                path="/no-role"
              />
              <Route
                element={
                  <Protected>
                    <SalesOpsApp />
                  </Protected>
                }
                path="/:workspace/:view"
              />
            </Routes>
          </MemoryRouter>
        </AppAuthProvider>
      </QueryClientProvider>,
    );
  });

  return { container: host, root: nextRoot };
}
```

Use a plain `MemoryRouter` with no `future` flags, matching `react.test.tsx`.
`v7_startTransition` would wrap navigations in a transition and make the assertions timing-dependent for no benefit.

#### Fixtures

Two tokens, both built with the lifted `jwt()`:

```tsx
const adminToken = jwt({
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  workspaceName: 'Alpha',
  roles: { workspace: 'admin' },
  workspaces: [{ workspaceId: 'workspace-alpha', name: 'Alpha' }],
});

/** Signed in and genuinely entitled to nothing. This is who `/no-role` is for. */
const noRoleToken = jwt({
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  workspaceName: 'Alpha',
  roles: { workspace: 'member', productRoles: [] },
  workspaces: [{ workspaceId: 'workspace-alpha', name: 'Alpha' }],
});
```

`getRolesFromHubClaims` in `apps/web/src/auth/claims.ts` maps `roles.workspace === 'admin'` to all three `AppRole`s, which makes all four workspaces visible and makes `/tatico/dashboard` canonical with `redirect: false`.
It maps `roles.workspace === 'member'` with empty `productRoles` to `[]`.

The bootstrap fixture is the empty one, matching `emptyBootstrap` at `SalesOpsApp.tsx:172`:

```tsx
const bootstrapFixture = {
  sales: [], products: [], productFuncaoCosts: [], clients: [], areas: [],
  funcoes: [], people: [], payables: [], saleItems: [], receivables: [],
  saleProfessionals: [], settings: null,
};
```

and the `../hooks` mock returns `{ data: bootstrapFixture, isLoading: false, isError: false, isFetching: false, isSuccess: true, error: null }` from `useSalesOpsBootstrap`, with the other eleven hooks returning the shared `{ isPending: false, mutate: vi.fn(), mutateAsync: vi.fn(async () => ({})) }` object copied from `routing.test.tsx:61-67`.
The eleven are `useCreateSalesOpsSale`, `useUpdateSalesOpsSale`, `useTransitionSalesOpsSale`, `useCancelSalesOpsContract`, `useSaveSalesOpsArea`, `useSaveSalesOpsClient`, `useSaveSalesOpsFuncao`, `useSaveSalesOpsPerson`, `useSaveSalesOpsProduct`, `useSaveSalesOpsSettings`, `useSetSalesOpsCadastroStatus`.
That is the exact set `SalesOpsApp.tsx` imports from `./hooks`, and it is the set `routing.test.tsx` already proves is sufficient.

#### Driving the loss

```tsx
/** Mounts signed in as an admin, then drives the session to the BFF's own 401. */
async function loseSessionWhileSignedIn(entry: string) {
  mocks.cache.getToken.mockResolvedValueOnce(ok(adminToken)).mockResolvedValue(expired);
  const held: { current: TokenReader | null } = { current: null };
  const mounted = renderApp(entry, held);
  container = mounted.container;
  root = mounted.root;
  await flushReact();

  if (!held.current) throw new Error('token reader never became ready');
  await act(async () => {
    await held.current?.();
  });
  await flushReact();
  return mounted.container;
}
```

#### Assertion helpers

```tsx
const locationText = (host: HTMLElement) =>
  host.querySelector('[data-testid="location"]')?.textContent;

/**
 * `SalesOpsApp`'s own page title. Scoped to `main` on purpose: `SignedOutPanel`
 * also renders an `h1`, and it sits in the overlay sibling rather than inside
 * `main`, so this selector can only ever match the still-mounted shell.
 */
const shellTitle = (host: HTMLElement) => host.querySelector('main h1')?.textContent?.trim();
```

The captured return-to is observed by reading the slot DIRECTLY:

```tsx
import { RETURN_TO_KEY } from '@/auth/session-recovery';
// ...
expect(sessionStorage.getItem(RETURN_TO_KEY)).toBe('/tatico/dashboard');
```

`RETURN_TO_KEY` is `'fxl-sales.auth.returnTo'` and `captureReturnTo` writes the sanitized path into `sessionStorage` under it.
Do NOT observe it with `consumeReturnTo()`: that function destroys the slot BEFORE it validates, by design, so calling it in an assertion would make any second read in the same test return `null` for the wrong reason.
Assert `sessionStorage.getItem(RETURN_TO_KEY)` is `null` immediately after the loss and before the click, so the post-click value is provably produced by the click.

#### The tests

One `describe`, exactly five `it`s, with these exact names.

`describe('Sales Ops keeps its route when a live session is lost')`

1. `it('keeps the URL on the route the operator was on instead of rewriting it to /no-role')`

   `const host = await loseSessionWhileSignedIn('/tatico/dashboard');`
   - `expect(locationText(host)).toBe('/tatico/dashboard')`
   - `expect(host.querySelector('[data-testid="no-role-page"]')).toBeNull()`
   - `expect(host.textContent).toContain('Sua sessão expirou')`

   This is acceptance assertions 1 and 2.
   On unmodified code it fails on the first expectation with `/no-role`.

2. `it('keeps the Sales Ops shell and its own component state mounted underneath the overlay')`

   Mount signed in at `/tatico/dashboard`, then BEFORE the loss collapse the sidebar so there is real `SalesOpsApp` state to lose:

   ```tsx
   const recolher = host.querySelector<HTMLButtonElement>('button[aria-label="Recolher menu"]');
   ```

   dispatch a bubbling `MouseEvent('click')` inside `act`, assert `button[aria-label="Expandir menu"]` is now present, then drive the loss, then assert all of:
   - `expect(shellTitle(host)).toBe('Visão geral')`
   - `expect(host.querySelector('aside')).not.toBeNull()`
   - `expect(host.querySelector('button[aria-label="Expandir menu"]')).not.toBeNull()`
   - `expect(host.textContent).toContain('Sua sessão expirou')`

   This is acceptance assertion 3, and the `Expandir menu` line is the specific oracle against the forbidden fixes.
   `sidebarCollapsed` is `useState` on `SalesOpsApp` itself, so it survives if and only if the component keeps rendering its shell.
   A `return null`, a `return <Skeleton />` or a `return <Navigate />` all fail it.

   Structure this test with its own inline mount rather than through `loseSessionWhileSignedIn`, or give that helper an optional `beforeLoss` callback. Either is fine; do not duplicate the mock setup.

3. `it('captures the route the operator was on when the operator clicks Entrar')`

   `const host = await loseSessionWhileSignedIn('/tatico/dashboard');`
   - `expect(sessionStorage.getItem(RETURN_TO_KEY)).toBeNull()`
   - `expect(mocks.client.login).not.toHaveBeenCalled()`
   - `await clickButton(host, 'Entrar')`
   - `expect(mocks.client.login).toHaveBeenCalledTimes(1)`
   - `expect(sessionStorage.getItem(RETURN_TO_KEY)).toBe('/tatico/dashboard')`
   - `expect(sessionStorage.getItem(RETURN_TO_KEY)).not.toBe('/no-role')`

   This is acceptance assertion 4 and the sharpest encoding of the user-visible bug.
   `Entrar` is unambiguous: `SalesOpsApp` renders no button with that exact text, and `SignedOutPanel` is the only source of one.
   On unmodified code this fails with `'/no-role'`.

4. `it('still redirects a signed-in operator with no visible workspaces to /no-role')`

   `mocks.cache.getToken.mockResolvedValue(ok(noRoleToken))`, render at `/tatico/dashboard`, `await flushReact()`.
   - `expect(locationText(host)).toBe('/no-role')`
   - `expect(host.querySelector('[data-testid="no-role-page"]')).not.toBeNull()`
   - `expect(host.textContent).not.toContain('Sua sessão expirou')`

   This is the must-not-break for the genuine no-role redirect.
   It passes both before and after the change, which is the point.

5. `it('still rewrites the legacy cadastros alias for a signed-in operator')`

   `mocks.cache.getToken.mockResolvedValue(ok(adminToken))`, render at `/cadastros/vendedores`, `await flushReact()`.
   - `expect(locationText(host)).toBe('/cadastros/pessoas')`
   - `expect(shellTitle(host)).toBe('Pessoas')`

   This is the must-not-break for `resolution.redirect`, proven against the real auth provider rather than the mocked profile `routing.test.tsx` uses.
   It passes both before and after the change.

## Verification

Red first, on unmodified `SalesOpsApp.tsx`:

```bash
pnpm --filter @fxl-sales/web test -- src/sales-ops/__tests__/session-loss-keeps-route.test.tsx
```

Expected before step 1: tests 1, 2 and 3 fail, tests 4 and 5 pass.
Test 1 fails with `'/no-role'` instead of `'/tatico/dashboard'`.
Test 2 fails because `main h1` is gone once the route no longer matches `/:workspace/:view`.
Test 3 fails with `'/no-role'` in the return-to slot.

Green after step 1: all five pass.

Then the mutation check the verifier owns.
Delete `&& rolesAreAuthoritative` from the FIRST condition only and re-run: tests 1, 2 and 3 must go red again.
Restore it, delete it from the SECOND condition only and re-run test 1 with the entry changed to `/cadastros/produtos` as a scratch probe, or simply confirm by reading that with `roles === []` every url resolves `redirect: true`; then restore.
Replace the guarded return with `return null` and re-run: test 2 must go red.
Restore.

Finally the full local gate:

```bash
pnpm --filter @fxl-sales/web test
pnpm run lint
pnpm run type-check
```

`apps/web`'s `test` script is already `vitest run`, so it is run-once by construction; do not invoke a bare `vitest`.
Pay attention to `apps/web/src/sales-ops/__tests__/routing.test.tsx` and `apps/web/src/auth/__tests__/react.test.tsx` in that full run: the first pins the alias and the role defaults, the second pins the live-loss overlay, and neither may move.

## Out of scope

- Any edit to `apps/web/src/auth/react.tsx`. Slice 03 and slice 04 own the other halves of amplifiers B and C.
- Any change to `getVisibleWorkspaces`, `resolveSalesOpsRoute` or anything else in `apps/web/src/sales-ops/navigation.ts`. The pure routing functions are correct; only their caller's gating was wrong.
- Persisting form state across the Hub redirect. Still deliberately out of scope, still filed in `nexo/ROADMAP.md`.
- Freezing or caching the last signed-in route resolution.
