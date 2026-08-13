// @vitest-environment happy-dom

/**
 * The COMPOSED session journey, which is the only thing the operator ever experiences:
 * lose the session, click `Entrar`, complete the Hub round trip, and arrive somewhere.
 *
 * `feature-20260812-session-survives-one-refresh` fixed the every-two-minutes logout with
 * four slices, three of which touch this one story from different angles and each of which
 * is tested in isolation:
 *
 * - slice 02 keeps the URL when a live session is lost (`session-loss-keeps-route.test.tsx`)
 * - slice 03 refuses `/no-role` as a returnTo (`auth/__tests__/session-recovery.test.ts`)
 * - slice 04 lets an entitled operator out of `/no-role` (`no-role-redirect.test.tsx`)
 *
 * Every one of those thirds passed while the whole was broken, three separate times. This
 * file is the whole, and it is deliberately built so that reverting ANY of the three turns
 * it red - see `nexo/runs/batch-20260813-session-followups/slice-05-notes.md` for the three
 * revert proofs.
 *
 * Everything under test is REAL: the provider, `Protected`, `SalesOpsApp`, `NoRoleGuard`
 * wrapping `NoRolePage` exactly as `router.tsx` wires them, and the real
 * `captureReturnTo` / `consumeReturnTo` / `sanitizeReturnTo` path through `sessionStorage`.
 * Only the Hub client, the token cache and the Sales Ops data hooks are mocked, because
 * those are the network and nothing else.
 */

import type { HubClient } from '@fxl-business/hub-sdk/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const act = (
  React as typeof React & { act: typeof import('react-dom/test-utils').act }
).act;

const mocks = vi.hoisted(() => {
  const client = {
    login: vi.fn<HubClient['login']>(),
    getToken: vi.fn<HubClient['getToken']>(),
    setActive: vi.fn<HubClient['setActive']>(),
    logout: vi.fn<HubClient['logout']>(),
    checkoutUrl: vi.fn<HubClient['checkoutUrl']>(),
    manageUrl: vi.fn<HubClient['manageUrl']>(),
  } satisfies HubClient;
  const cache = {
    getToken: vi.fn<() => Promise<import('@/auth/refresh').HubTokenResult>>(),
    renew: vi.fn<() => Promise<import('@/auth/refresh').HubTokenResult>>(),
    expiresAt: vi.fn<() => number | null>(),
    seed: vi.fn<(accessToken: string, expiresInSeconds: number) => void>(),
    clear: vi.fn<() => void>(),
  };

  return {
    client,
    cache,
    createHubClient: vi.fn<typeof import('@fxl-business/hub-sdk/client').createHubClient>(
      () => client,
    ),
    createHubAccessTokenCache: vi.fn<typeof import('@/auth/token').createHubAccessTokenCache>(
      () => cache,
    ),
  };
});

vi.mock('@fxl-business/hub-sdk/client', () => ({
  createHubClient: mocks.createHubClient,
}));

/*
  `../refresh` is deliberately NOT mocked: `react.tsx` hands `requestHubAccessToken` to
  `createHubAccessTokenCache`, which IS mocked, so the real refresher is constructed and
  never called, and `apps/web/src/auth/refresh.ts` has no module-scope side effects.
*/
vi.mock('@/auth/token', () => ({
  createHubAccessTokenCache: mocks.createHubAccessTokenCache,
}));

/** The empty bootstrap fixture the sales-ops route tests already prove is sufficient. */
const bootstrapFixture = {
  sales: [],
  products: [],
  productFuncaoCosts: [],
  clients: [],
  areas: [],
  funcoes: [],
  people: [],
  payables: [],
  saleItems: [],
  receivables: [],
  saleProfessionals: [],
  settings: null,
};

const mutation = {
  isPending: false,
  mutate: vi.fn(),
  mutateAsync: vi.fn(async () => ({})),
};

vi.mock('@/sales-ops/hooks', () => ({
  useSalesOpsBootstrap: () => ({
    data: bootstrapFixture,
    isLoading: false,
    isError: false,
    isFetching: false,
    isSuccess: true,
    error: null,
  }),
  useCreateSalesOpsSale: () => mutation,
  useUpdateSalesOpsSale: () => mutation,
  useTransitionSalesOpsSale: () => mutation,
  useCancelSalesOpsContract: () => mutation,
  useSaveSalesOpsArea: () => mutation,
  useSaveSalesOpsClient: () => mutation,
  useSaveSalesOpsFuncao: () => mutation,
  useSaveSalesOpsPerson: () => mutation,
  useSaveSalesOpsProduct: () => mutation,
  useSaveSalesOpsSettings: () => mutation,
  useSetSalesOpsCadastroStatus: () => mutation,
}));

import '@/i18n';
import type { HubTokenResult } from '@/auth/refresh';
import { AppAuthProvider, Protected, useAccessToken } from '@/auth/react';
import { RETURN_TO_KEY } from '@/auth/session-recovery';
import { NoRoleGuard } from '@/components/auth/RoleGuard';
import { NoRolePage } from '@/pages/errors/NoRolePage';
import { SalesOpsApp } from '@/sales-ops/SalesOpsApp';

/**
 * `expired` is the BFF's own `401` verdict, the only result that may tear a session down,
 * and it reaches `failSession()` with no ladder rung ever scheduled.
 */
const ok = (token: string): HubTokenResult => ({ token });
const expired: HubTokenResult = { token: null, failure: 'session_expired' };
const transient: HubTokenResult = { token: null, failure: 'transient' };

/** `NoRolePage`'s own copy, read through the real i18n bundle rather than a stub testid. */
const UNAUTHORIZED = 'Acesso não autorizado';
const SESSION_LOST = 'Sua sessão expirou';

function jwt(claims: Record<string, unknown>): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `header.${payload}.signature`;
}

/**
 * `getRolesFromHubClaims` maps `roles.workspace === 'admin'` to all three `AppRole`s, which
 * makes all four workspaces visible and `/tatico/dashboard` the default route.
 */
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

type TokenReader = () => Promise<string | null>;

/** Stands in for any of the ~40 data hooks that read the token per screen. */
function TokenProbe({ onReady }: { onReady: (getToken: TokenReader) => void }) {
  const { getToken } = useAccessToken();

  React.useEffect(() => {
    onReady(getToken);
  }, [getToken, onReady]);

  return null;
}

/**
 * Every location the router settles on, across every mount in one test.
 *
 * The throw converts an unbounded ping-pong into ONE named failure that prints the cycle.
 * Without it a regression here shows up as a vitest timeout with no explanation, or as a
 * `Maximum update depth exceeded` stack pointing at react-router rather than at the two
 * guards that disagree. Five is the longest legitimate journey in this file (three mounts
 * plus their settling hops), so eight leaves room without hiding a loop.
 */
const MAX_VISITED = 8;
let visited: string[] = [];

function LocationProbe() {
  const { pathname, search } = useLocation();

  React.useEffect(() => {
    visited.push(pathname);
    if (visited.length > MAX_VISITED) {
      throw new Error(`redirect loop: ${visited.join(' -> ')}`);
    }
  }, [pathname]);

  return <output data-testid="location">{`${pathname}${search}`}</output>;
}

type MountedApp = {
  host: HTMLDivElement;
  root: Root;
  held: { current: TokenReader | null };
};

let mountedApps: MountedApp[] = [];

/**
 * ONE document's worth of app, mirroring `router.tsx`: `/no-role` and the two Sales Ops
 * routes are separate route objects, each with its own `Protected`, and `/no-role` really
 * is `NoRoleGuard` wrapping `NoRolePage`.
 *
 * A fresh `QueryClient` per mount, because a full-page navigation destroys the module-level
 * singleton along with the rest of the document. `sessionStorage` is the one thing that
 * deliberately survives, which is exactly why the returnTo lives there.
 *
 * A plain `MemoryRouter` with no `future` flags, matching `react.test.tsx`:
 * `v7_startTransition` would wrap navigations in a transition and make these assertions
 * timing-dependent for no benefit.
 */
function mountApp(entry: string): MountedApp {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const held: { current: TokenReader | null } = { current: null };
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  act(() => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <AppAuthProvider>
          {/*
            Outside the router and outside `Protected`, so the token reader that drives the
            loss stays reachable in every branch. `TokenProbe` uses no router hook.
          */}
          <TokenProbe
            onReady={(getToken) => {
              held.current = getToken;
            }}
          />
          <MemoryRouter initialEntries={[entry]}>
            {/* Outside `Routes`, so the URL is readable whichever route matches. */}
            <LocationProbe />
            <Routes>
              <Route
                element={
                  <Protected>
                    <NoRoleGuard>
                      <NoRolePage />
                    </NoRoleGuard>
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
                path="/"
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

  const app: MountedApp = { host, root, held };
  mountedApps.push(app);
  return app;
}

async function unmountApp(app: MountedApp) {
  await act(async () => {
    app.root.unmount();
  });
  app.host.remove();
  mountedApps = mountedApps.filter((entry) => entry !== app);
}

async function flushReact(passes = 4) {
  for (let index = 0; index < passes; index += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

/** Drives a panel button the way an operator does, by its visible pt-BR label. */
async function clickButton(host: HTMLElement, label: string) {
  const match = [...host.querySelectorAll('button')].find(
    (button) => button.textContent?.trim() === label,
  );
  if (!match) throw new Error(`button not found: ${label}`);
  await act(async () => {
    match.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await Promise.resolve();
  });
}

const locationText = (host: HTMLElement) =>
  host.querySelector('[data-testid="location"]')?.textContent;

/** Every read from here on answers with this token, for a document that holds a session. */
function serveToken(token: string) {
  mocks.cache.getToken.mockReset();
  mocks.cache.getToken.mockResolvedValue(ok(token));
}

/** Mounts a document that already holds a session. */
async function enterSignedIn(entry: string, token: string) {
  serveToken(token);
  const app = mountApp(entry);
  await flushReact();
  return app;
}

/** Mounts signed in as an admin, then drives the session to the BFF's own `401`. */
async function loseSessionAt(entry: string) {
  mocks.cache.getToken.mockReset();
  mocks.cache.getToken.mockResolvedValueOnce(ok(adminToken)).mockResolvedValue(expired);
  const app = mountApp(entry);
  await flushReact();

  if (!app.held.current) throw new Error('token reader never became ready');
  await act(async () => {
    await app.held.current?.();
  });
  await flushReact();
  return app;
}

/**
 * The Hub round trip, modelled the way the browser really performs it.
 *
 * `login()` is `client.login()`, a full `window.location.assign`, so the document is
 * DESTROYED and a new one is built at the callback's landing route. Unmounting the root and
 * mounting a fresh tree is what reproduces that. Flipping a token on the still-mounted tree
 * instead would skip the unmount entirely and would never exercise `HubProtected`'s restore
 * effect, which is half of what this file exists to pin.
 *
 * `sessionStorage` is deliberately NOT cleared between the two: it survives a same-tab
 * navigation, and that survival is the entire mechanism under test.
 */
async function completeHubRoundTrip(app: MountedApp, token: string, landing = '/') {
  await unmountApp(app);
  serveToken(token);
  const next = mountApp(landing);
  await flushReact();
  return next;
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  visited = [];
  vi.stubEnv('VITE_FXL_HUB_API_URL', 'http://hub.test');
  vi.stubEnv('VITE_FXL_HUB_PUBLISHABLE_KEY', 'pk_fxl-sales_test');
  mocks.createHubClient.mockReturnValue(mocks.client);
  mocks.createHubAccessTokenCache.mockReturnValue(mocks.cache);
  /*
    `null` is "this cache holds no token expiry". Pinned so the proactive renewal can never
    arm its timer: happy-dom reports `visibilityState` as `visible` whenever the document
    has a `defaultView`, so a visibility guard alone would not keep it inert.
  */
  mocks.cache.expiresAt.mockReturnValue(null);
  mocks.cache.renew.mockResolvedValue(transient);
  mocks.client.login.mockReturnValue(undefined);
  mocks.client.logout.mockResolvedValue(undefined);
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  for (const app of [...mountedApps]) {
    await unmountApp(app);
  }
  mountedApps = [];
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('the composed session journey', () => {
  it('returns the operator to the route they were on after a lost session and a successful login', async () => {
    /*
      The entry route is deliberately NOT `/tatico/dashboard`.

      This scenario carries the feature's acceptance criterion as its title, and while it
      entered on the admin DEFAULT landing route it structurally could not fail: "restored
      to the route I was on" and "fell back to the role default" were the same string, so
      the post-remount URL assertion passed with the restore deleted. The slice 05 Gate 2
      verifier proved exactly that by neutering only the `navigate(target, ...)` in
      `react.tsx` and leaving `consumeReturnTo` in place: this scenario stayed green while
      the two below went red.

      `/operacional/vendas` is a route the default landing can never produce, so a missing
      restore now lands provably elsewhere.
    */
    const app = await loseSessionAt('/operacional/vendas');

    expect(locationText(app.host)).toBe('/operacional/vendas');
    expect(app.host.textContent).toContain(SESSION_LOST);
    expect(app.host.textContent).not.toContain(UNAUTHORIZED);
    /*
      Read the slot directly rather than through `consumeReturnTo()`, which destroys it
      BEFORE it validates by design. Asserting it is empty here is what proves the value
      below was produced by the click.
    */
    expect(sessionStorage.getItem(RETURN_TO_KEY)).toBeNull();
    expect(mocks.client.login).not.toHaveBeenCalled();

    await clickButton(app.host, 'Entrar');

    expect(mocks.client.login).toHaveBeenCalledTimes(1);
    const captured = sessionStorage.getItem(RETURN_TO_KEY);
    expect(captured).toBe('/operacional/vendas');

    const next = await completeHubRoundTrip(app, adminToken);

    /*
      The callback lands on `/`, so all three endings are now distinguishable: a restore
      arrives at `captured`, a deleted restore falls through to the admin default
      `/tatico/dashboard`, and a login that never took hold stays at `/`.
    */
    expect(locationText(next.host)).toBe(captured);
    expect(next.host.textContent).not.toContain(SESSION_LOST);
    expect(next.host.textContent).not.toContain(UNAUTHORIZED);
    /*
      An empty slot on its own proves only that SOMETHING consumed it, and `consumeReturnTo`
      destroys before it validates, so the slot empties whether or not a navigation follows.
      Asserting it against `captured`, the value the URL above had to come from, is what
      separates a consumed-and-navigated slot from a merely consumed one.
    */
    expect({ slot: sessionStorage.getItem(RETURN_TO_KEY), url: locationText(next.host) }).toEqual({
      slot: null,
      url: captured,
    });
  });

  it('returns the operator to a non-tatico route, where the second guard is load-bearing', async () => {
    /*
      `/tatico/dashboard` is the admin default route, so on that one URL the second early
      return in `SalesOpsApp` self-navigates and its rewrite is invisible. `/cadastros/produtos`
      is where an unguarded `resolution.redirect` really does destroy the operator's URL.
    */
    const app = await loseSessionAt('/cadastros/produtos');

    expect(locationText(app.host)).toBe('/cadastros/produtos');
    expect(app.host.textContent).toContain(SESSION_LOST);

    await clickButton(app.host, 'Entrar');

    expect(sessionStorage.getItem(RETURN_TO_KEY)).toBe('/cadastros/produtos');

    const next = await completeHubRoundTrip(app, adminToken);

    expect(locationText(next.host)).toBe('/cadastros/produtos');
    expect(next.host.textContent).not.toContain(SESSION_LOST);
  });

  it('consumes the returnTo exactly once, so a later mount cannot replay it', async () => {
    /*
      Driven from `/cadastros/produtos` rather than `/tatico/dashboard` on purpose: the
      admin default route IS `/tatico/dashboard`, so a replayed returnTo and a plain default
      landing would be the same string and the assertion would prove nothing.
    */
    const app = await loseSessionAt('/cadastros/produtos');
    await clickButton(app.host, 'Entrar');

    const restored = await completeHubRoundTrip(app, adminToken);
    expect(locationText(restored.host)).toBe('/cadastros/produtos');
    expect(sessionStorage.getItem(RETURN_TO_KEY)).toBeNull();

    await unmountApp(restored);
    serveToken(adminToken);
    const third = mountApp('/');
    await flushReact();

    expect(locationText(third.host)).toBe('/tatico/dashboard');
    expect(sessionStorage.getItem(RETURN_TO_KEY)).toBeNull();
  });

  it('never restores a returnTo of /no-role, even if one is somehow stored', async () => {
    sessionStorage.setItem(RETURN_TO_KEY, '/no-role');

    const app = await enterSignedIn('/', adminToken);

    expect(locationText(app.host)).toBe('/tatico/dashboard');
    /*
      The oracle. `NoRoleGuard` would bounce an entitled operator back out, so a final URL
      alone cannot tell a refused restore from a rescued one - only the fact that `/no-role`
      was never visited at all can.
    */
    expect(visited).not.toContain('/no-role');
    expect(app.host.textContent).not.toContain(UNAUTHORIZED);
    expect(sessionStorage.getItem(RETURN_TO_KEY)).toBeNull();
  });

  it('sends an operator who lost entitlement to /no-role and leaves them there without looping', async () => {
    const app = await loseSessionAt('/tatico/dashboard');
    await clickButton(app.host, 'Entrar');
    expect(sessionStorage.getItem(RETURN_TO_KEY)).toBe('/tatico/dashboard');

    // The login succeeded and the account is real; what changed is the entitlement.
    const next = await completeHubRoundTrip(app, noRoleToken);

    expect(locationText(next.host)).toBe('/no-role');
    expect(next.host.textContent).toContain(UNAUTHORIZED);
    // Settles on the dead end exactly once. `LocationProbe` throws on a genuine loop, so
    // this is the assertion that a single arrival is not a first lap.
    expect(visited.filter((path) => path === '/no-role')).toHaveLength(1);
  });

  it('lets an entitled operator out of /no-role even when nothing is stored to restore', async () => {
    /*
      The third line of defence, and the only one this file can observe on its own: with the
      returnTo slot EMPTY, nothing but `NoRoleGuard` can move an entitled operator off the
      dead end. A browser restoring the tab, a bookmark, or a Back into a URL an earlier
      build left in history all land exactly here.

      `no-role-redirect.test.tsx` proves the guard's condition; it mocks `@/auth/react`
      wholesale, so it cannot show the guard working inside the REAL `Protected` over a
      profile derived from a real token, which is what this case adds.
    */
    expect(sessionStorage.getItem(RETURN_TO_KEY)).toBeNull();

    const app = await enterSignedIn('/no-role', adminToken);

    expect(locationText(app.host)).toBe('/tatico/dashboard');
    expect(app.host.textContent).not.toContain(UNAUTHORIZED);
  });
});
