// @vitest-environment happy-dom

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
    // Explicitly typed rather than inferred from the factory, matching
    // `apps/web/src/auth/__tests__/react.test.tsx`, so a reader of `mock.calls` is
    // not typed `never`.
    createHubAccessTokenCache: vi.fn<typeof import('@/auth/token').createHubAccessTokenCache>(
      () => cache,
    ),
  };
});

vi.mock('@fxl-business/hub-sdk/client', () => ({
  createHubClient: mocks.createHubClient,
}));

/*
  The `@` alias in `apps/web/vitest.config.ts` resolves to `./src`, so this is the same
  module id as `react.tsx`'s own `./token` import.

  `../refresh` is deliberately NOT mocked: `react.tsx` hands `requestHubAccessToken` to
  `createHubAccessTokenCache`, which IS mocked, so the real refresher is constructed and
  never called, and `apps/web/src/auth/refresh.ts` has no module-scope side effects.
*/
vi.mock('@/auth/token', () => ({
  createHubAccessTokenCache: mocks.createHubAccessTokenCache,
}));

/**
 * Exactly the mock `apps/web/src/sales-ops/__tests__/routing.test.tsx` already proves is
 * sufficient for this component, with the empty bootstrap fixture. It removes every
 * network path in one line, which is why no query is ever created here.
 */
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

vi.mock('../hooks', () => ({
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

import type { HubTokenResult } from '@/auth/refresh';
import { AppAuthProvider, Protected, useAccessToken } from '@/auth/react';
import { RETURN_TO_KEY } from '@/auth/session-recovery';
import { SalesOpsApp } from '../SalesOpsApp';

/**
 * `expired` is the BFF's own `401` verdict, the only result that may tear a session
 * down, and it reaches `failSession()` with no ladder rung ever scheduled.
 */
const ok = (token: string): HubTokenResult => ({ token });
const expired: HubTokenResult = { token: null, failure: 'session_expired' };
const transient: HubTokenResult = { token: null, failure: 'transient' };

function jwt(claims: Record<string, unknown>): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `header.${payload}.signature`;
}

/**
 * `getRolesFromHubClaims` maps `roles.workspace === 'admin'` to all three `AppRole`s,
 * which makes all four workspaces visible and `/tatico/dashboard` canonical.
 * Workspaces are keyed `workspaceId`, which is the shape the Hub actually mints.
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
function TokenProbe({ onReady }: { onReady?: (getToken: TokenReader) => void }) {
  const { getToken } = useAccessToken();

  React.useEffect(() => {
    onReady?.(getToken);
  }, [getToken, onReady]);

  return null;
}

function LocationProbe({ testId = 'location' }: { testId?: string }) {
  const { pathname, search } = useLocation();
  return <output data-testid={testId}>{`${pathname}${search}`}</output>;
}

/**
 * Mirrors `apps/web/src/router.tsx`: `/no-role` and `/:workspace/:view` are two SEPARATE
 * route objects, each with its own `Protected`, which is why the production bug unmounts
 * the whole Sales Ops element rather than swapping a panel inside it.
 *
 * A plain `MemoryRouter` with no `future` flags, matching `react.test.tsx`.
 * `v7_startTransition` would wrap navigations in a transition and make these assertions
 * timing-dependent for no benefit.
 */
function renderApp(entry: string, held: { current: TokenReader | null }) {
  const host = document.createElement('div');
  document.body.append(host);
  const nextRoot = createRoot(host);

  act(() => {
    nextRoot.render(
      <QueryClientProvider client={queryClient}>
        <AppAuthProvider>
          {/*
            Outside the router and outside `Protected`, so the token reader that drives
            the loss stays reachable in every branch. `TokenProbe` uses no router hook.
          */}
          <TokenProbe
            onReady={(getToken) => {
              held.current = getToken;
            }}
          />
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

async function flushReact() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
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

/**
 * `SalesOpsApp`'s own page title. Scoped to `main` on purpose: `SignedOutPanel` also
 * renders an `h1`, and it sits in the overlay sibling rather than inside `main`, so this
 * selector can only ever match the still-mounted shell.
 */
const shellTitle = (host: HTMLElement) => host.querySelector('main h1')?.textContent?.trim();

/** Mounts signed in as an admin, then drives the session to the BFF's own 401. */
async function loseSessionWhileSignedIn(
  entry: string,
  beforeLoss?: (host: HTMLElement) => Promise<void>,
) {
  mocks.cache.getToken.mockResolvedValueOnce(ok(adminToken)).mockResolvedValue(expired);
  const held: { current: TokenReader | null } = { current: null };
  const mounted = renderApp(entry, held);
  container = mounted.container;
  root = mounted.root;
  await flushReact();

  await beforeLoss?.(mounted.container);

  if (!held.current) throw new Error('token reader never became ready');
  await act(async () => {
    await held.current?.();
  });
  await flushReact();
  return mounted.container;
}

/** Mounts and stays signed in, for the two must-not-break cases. */
async function renderSignedIn(entry: string, token: string) {
  mocks.cache.getToken.mockResolvedValue(ok(token));
  const held: { current: TokenReader | null } = { current: null };
  const mounted = renderApp(entry, held);
  container = mounted.container;
  root = mounted.root;
  await flushReact();
  return mounted.container;
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let queryClient: QueryClient;

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.stubEnv('VITE_FXL_HUB_API_URL', 'http://hub.test');
  vi.stubEnv('VITE_FXL_HUB_PUBLISHABLE_KEY', 'pk_fxl-sales_test');
  mocks.createHubClient.mockReturnValue(mocks.client);
  mocks.createHubAccessTokenCache.mockReturnValue(mocks.cache);
  /*
    `null` is "this cache holds no token expiry". Pinned so the proactive renewal can
    never arm its timer: happy-dom reports `visibilityState` as `visible` whenever the
    document has a `defaultView`, so a visibility guard alone would not keep it inert.
    This file asserts nothing about timers and never calls `vi.useFakeTimers()`.
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
  if (root) {
    await act(async () => {
      root?.unmount();
    });
  }
  container?.remove();
  root = null;
  container = null;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('Sales Ops keeps its route when a live session is lost', () => {
  it('keeps the URL on the route the operator was on instead of rewriting it to /no-role', async () => {
    const host = await loseSessionWhileSignedIn('/tatico/dashboard');

    expect(locationText(host)).toBe('/tatico/dashboard');
    expect(host.querySelector('[data-testid="no-role-page"]')).toBeNull();
    expect(host.textContent).toContain('Sua sessão expirou');
  });

  it('keeps the Sales Ops shell and its own component state mounted underneath the overlay', async () => {
    const host = await loseSessionWhileSignedIn('/tatico/dashboard', async (mountedHost) => {
      /*
        Real `SalesOpsApp` state to lose. `sidebarCollapsed` is `useState` on the
        component itself, so it survives if and only if the component keeps rendering
        its shell. A `return null`, a `return <Skeleton />` and a `return <Navigate />`
        all destroy it.
      */
      const recolher = mountedHost.querySelector<HTMLButtonElement>(
        'button[aria-label="Recolher menu"]',
      );
      if (!recolher) throw new Error('sidebar collapse button not found');
      await act(async () => {
        recolher.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        await Promise.resolve();
      });
      expect(mountedHost.querySelector('button[aria-label="Expandir menu"]')).not.toBeNull();
    });

    expect(shellTitle(host)).toBe('Visão geral');
    expect(host.querySelector('aside')).not.toBeNull();
    expect(host.querySelector('button[aria-label="Expandir menu"]')).not.toBeNull();
    expect(host.textContent).toContain('Sua sessão expirou');
  });

  it('captures the route the operator was on when the operator clicks Entrar', async () => {
    const host = await loseSessionWhileSignedIn('/tatico/dashboard');

    /*
      Read the slot directly rather than through `consumeReturnTo()`, which destroys it
      BEFORE it validates by design. Asserting it is empty here is what proves the value
      below was produced by the click.
    */
    expect(sessionStorage.getItem(RETURN_TO_KEY)).toBeNull();
    expect(mocks.client.login).not.toHaveBeenCalled();

    await clickButton(host, 'Entrar');

    expect(mocks.client.login).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(RETURN_TO_KEY)).toBe('/tatico/dashboard');
    expect(sessionStorage.getItem(RETURN_TO_KEY)).not.toBe('/no-role');
  });

  it('still redirects a signed-in operator with no visible workspaces to /no-role', async () => {
    const host = await renderSignedIn('/tatico/dashboard', noRoleToken);

    expect(locationText(host)).toBe('/no-role');
    expect(host.querySelector('[data-testid="no-role-page"]')).not.toBeNull();
    expect(host.textContent).not.toContain('Sua sessão expirou');
  });

  it('still rewrites the legacy cadastros alias for a signed-in operator', async () => {
    const host = await renderSignedIn('/cadastros/vendedores', adminToken);

    expect(locationText(host)).toBe('/cadastros/pessoas');
    expect(shellTitle(host)).toBe('Pessoas');
  });
});
