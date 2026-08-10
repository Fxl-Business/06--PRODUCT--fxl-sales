// @vitest-environment happy-dom

import type { HubClient } from '@fxl-business/hub-sdk/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
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
    getToken: vi.fn<() => Promise<import('../refresh').HubTokenResult>>(),
    renew: vi.fn<() => Promise<import('../refresh').HubTokenResult>>(),
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
    // Explicitly typed rather than inferred from the factory: the drift-guard test below
    // reads the refresher back out of `mock.calls`, which an argument-less signature
    // would type as `never`.
    createHubAccessTokenCache: vi.fn<typeof import('../token').createHubAccessTokenCache>(
      () => cache,
    ),
    requestHubAccessToken: vi.fn<typeof import('../refresh').requestHubAccessToken>(),
  };
});

vi.mock('@fxl-business/hub-sdk/client', () => ({
  createHubClient: mocks.createHubClient,
}));

vi.mock('../token', () => ({
  createHubAccessTokenCache: mocks.createHubAccessTokenCache,
}));

/**
 * Spread over the real module rather than replaced: `react.tsx` also imports
 * `TRANSIENT_TOKEN_RESULT` from here, and the ladder's own semantics depend on it
 * being the genuine value.
 */
vi.mock('../refresh', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../refresh')>()),
  requestHubAccessToken: mocks.requestHubAccessToken,
}));

import type { HubTokenResult } from '../refresh';
import {
  AppAuthProvider,
  Protected,
  SESSION_REVALIDATE_DELAYS_MS,
  UserControls,
  useAccessToken,
  useAuthProfile,
} from '../react';
import { LOGIN_ATTEMPTS_KEY, LOGOUT_INTENT_KEY, RETURN_TO_KEY } from '../session-recovery';

/**
 * The three shapes the provider now branches on. `expired` is the BFF's own `401`
 * verdict and is the only one that may tear a session down; `transient` covers a
 * `503`, a `502`, a network throw and an unparseable body alike.
 */
const ok = (token: string): HubTokenResult => ({ token });
const expired: HubTokenResult = { token: null, failure: 'session_expired' };
const transient: HubTokenResult = { token: null, failure: 'transient' };

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function jwt(claims: Record<string, unknown>): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `header.${payload}.signature`;
}

function profileToken(
  workspaceName: string,
  /*
    Keyed `workspaceId`, which is what the Hub actually mints - see
    `packages/shared-types/src/hub/claims.ts` in the Hub repo. The earlier
    fixtures used `id`, matching the web type rather than the token, so they
    agreed with the bug that made `readWorkspaces` drop every entry and left the
    workspace switcher invisible in production. A fixture written against our own
    shape instead of the wire shape can only ever confirm our own assumption.
  */
  workspaces: Array<{ workspaceId?: string; id?: string; name: string }> = [
    { workspaceId: 'workspace-alpha', name: 'Alpha' },
    { workspaceId: 'workspace-beta', name: 'Beta' },
  ],
): string {
  return jwt({
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    workspaceName,
    roles: { workspace: 'admin' },
    workspaces,
  });
}

/**
 * Commits of `Probe`, i.e. how many times an auth consumer actually re-rendered.
 * Counted in a dep-less effect rather than in the render body: React only re-runs a
 * component's effects when that component re-rendered, so this is a faithful proxy,
 * and mutating an outer binding during render is an ESLint error (`react-hooks/globals`).
 */
let probeRenders = 0;

function Probe({ onWorkspace }: { onWorkspace?: (workspaceName?: string) => void }) {
  const profile = useAuthProfile();

  React.useEffect(() => {
    probeRenders += 1;
  });

  React.useEffect(() => {
    if (profile.isLoaded) {
      onWorkspace?.(profile.workspaceName);
    }
  }, [onWorkspace, profile.isLoaded, profile.workspaceName]);

  return (
    <output data-testid="profile">
      {profile.isLoaded
        ? `${profile.isSignedIn ? 'signed-in' : 'signed-out'}:${profile.workspaceName ?? ''}`
        : 'loading'}
    </output>
  );
}

type TokenReader = () => Promise<string | null>;

/** Stands in for any of the ~40 data hooks that read the token per screen. */
function TokenProbe({ onReady }: { onReady?: (getToken: TokenReader) => void }) {
  const { getToken } = useAccessToken();

  React.useEffect(() => {
    onReady?.(getToken);
  }, [getToken, onReady]);

  return null;
}

/**
 * `QueryClientProvider` wraps `AppAuthProvider`, mirroring `src/App.tsx` exactly.
 * `HubAuthProvider` reads the client with `useQueryClient()` so it can only ever flush
 * the client its own subtree reads, so the nesting is a precondition, not decoration.
 *
 * `TokenProbe` is mounted here and not only in `renderProtected` because `Protected`
 * renders a Skeleton while signed out, which unmounts the probe exactly when a
 * signed-out to signed-in transition needs to read a token.
 */
function renderProvider(
  onWorkspace?: (workspaceName?: string) => void,
  onReady?: (getToken: TokenReader) => void,
) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <AppAuthProvider>
          <Probe onWorkspace={onWorkspace} />
          <UserControls />
          <TokenProbe onReady={onReady} />
        </AppAuthProvider>
      </QueryClientProvider>,
    );
  });

  return { container, root };
}

/**
 * Renders the router location, so a restore can be asserted without stubbing
 * `window.location`. The default `location` instance lives inside `Protected`, which
 * renders a Skeleton while signed out, so it is only readable once the profile is
 * signed in. `renderProtected` mounts a second one OUTSIDE `Protected` under the
 * `outer-location` id, which is the only way to read the URL while a panel is up.
 */
function LocationProbe({ testId = 'location' }: { testId?: string }) {
  const { pathname, search } = useLocation();
  return <output data-testid={testId}>{`${pathname}${search}`}</output>;
}

function renderProtected(initialEntries: string[], onReady?: (getToken: TokenReader) => void) {
  const host = document.createElement('div');
  document.body.append(host);
  const nextRoot = createRoot(host);

  act(() => {
    nextRoot.render(
      <QueryClientProvider client={queryClient}>
        <AppAuthProvider>
          {/*
            Outside `MemoryRouter` on purpose: `UserControls` reads only
            `useHubAuthContext`, never a router hook, and mounting it outside `Protected`
            is what keeps the `Sair` button reachable after the sign-out replaces the
            protected subtree with a panel.
          */}
          <UserControls />
          <MemoryRouter initialEntries={initialEntries}>
            <Probe />
            <LocationProbe testId="outer-location" />
            <Protected>
              <LocationProbe />
              <TokenProbe onReady={onReady} />
            </Protected>
          </MemoryRouter>
        </AppAuthProvider>
      </QueryClientProvider>,
    );
  });

  return { container: host, root: nextRoot };
}

const profileText = (host: HTMLElement) =>
  host.querySelector('[data-testid="profile"]')?.textContent;

const locationText = (host: HTMLElement) =>
  host.querySelector('[data-testid="location"]')?.textContent;

/** Readable even while a panel has replaced `Protected`'s children. */
const outerLocationText = (host: HTMLElement) =>
  host.querySelector('[data-testid="outer-location"]')?.textContent;

async function flushReact() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
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

function workspaceTrigger(host: HTMLElement): HTMLButtonElement {
  const match = host.querySelector('button[role="combobox"][aria-label="Workspace"]');
  if (!(match instanceof HTMLButtonElement)) throw new Error('workspace combobox not found');
  return match;
}

/**
 * Drive the workspace picker the way an operator does: open it, then commit the row
 * whose visible label is the workspace name. `orgLabel` is what renders, so a raw
 * workspace id never appears in the assertion or on screen.
 */
async function switchWorkspace(host: HTMLElement, workspaceName: string) {
  const trigger = workspaceTrigger(host);
  await act(async () => {
    trigger.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  const row = [...host.querySelectorAll('[role="option"]')].find(
    (candidate) => candidate.textContent?.trim() === workspaceName,
  );
  if (!(row instanceof HTMLElement)) throw new Error(`workspace option not found: ${workspaceName}`);
  await act(async () => {
    row.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await Promise.resolve();
  });
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;
/**
 * One fresh client per test, so a leaked cache entry cannot make the next test pass.
 * `retry: false` so a fetch cancelled by the flush does not enter a retry ladder of its
 * own and outlive the test that started it.
 */
let queryClient: QueryClient;

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  probeRenders = 0;
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.stubEnv('VITE_FXL_HUB_API_URL', 'http://hub.test');
  vi.stubEnv('VITE_FXL_HUB_PUBLISHABLE_KEY', 'pk_fxl-sales_test');
  mocks.createHubClient.mockReturnValue(mocks.client);
  mocks.createHubAccessTokenCache.mockReturnValue(mocks.cache);
  /*
    `null` is "this cache holds no token expiry", which is what the proactive renewal
    schedules against. Pinned here rather than per test so that no test outside the
    renewal block below can arm the renewal timer, which is what keeps
    `vi.getTimerCount()` a LADDER-specific count everywhere else in this file. See
    `useLadderTimers`.
  */
  mocks.cache.expiresAt.mockReturnValue(null);
  mocks.cache.renew.mockResolvedValue(transient);
  mocks.client.login.mockReturnValue(undefined);
  mocks.client.logout.mockResolvedValue(undefined);
  mocks.client.checkoutUrl.mockResolvedValue('http://hub.test/checkout');
  mocks.client.manageUrl.mockResolvedValue('http://hub.test/manage');
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
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('AppAuthProvider token cache wiring', () => {
  it('hydrates the provider through the token cache instead of the SDK client', async () => {
    mocks.cache.getToken.mockResolvedValue(ok(profileToken('Alpha')));
    ({ container, root } = renderProvider());

    await flushReact();

    // The cache is handed a refresher, not the SDK client: classification lives in
    // `refresh.ts` and the cache stays a cache.
    expect(mocks.createHubAccessTokenCache).toHaveBeenCalledWith(expect.any(Function));
    expect(mocks.cache.getToken).toHaveBeenCalledTimes(1);
    // Permanent rather than incidental now. `HubClient.getToken()` discards the BFF's
    // status, so the app must never call it again.
    expect(mocks.client.getToken).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="profile"]')?.textContent).toBe(
      'signed-in:Alpha',
    );
  });

  /**
   * The drift guard for the hand-rolled fetch. `refresh.ts` spells out the BFF path
   * itself, so the ONE thing that keeps it from resolving to a different origin than
   * the SDK client is that both are handed the same `getHubBffBasePath` result. If a
   * future edit computes either one separately, the app posts its refresh somewhere
   * the BFF is not mounted and every page load reads as a Hub outage.
   */
  it('wires the token cache to the BFF refresh endpoint at the same base path as the SDK client', async () => {
    // The var `getHubBffBasePath` reads FIRST. `VITE_API_URL` is only its fallback, and
    // the shipped `.env` defines `VITE_AUTH_BFF_BASE_PATH` as `''`, which `??` does not
    // fall through.
    vi.stubEnv('VITE_AUTH_BFF_BASE_PATH', 'http://localhost:3006');
    mocks.requestHubAccessToken.mockResolvedValue(transient);
    mocks.cache.getToken.mockResolvedValue(ok(profileToken('Alpha')));
    ({ container, root } = renderProvider());

    await flushReact();

    const refresher = mocks.createHubAccessTokenCache.mock.calls[0]?.[0];
    if (typeof refresher !== 'function') throw new Error('no refresher was handed to the cache');
    await refresher();

    expect(mocks.requestHubAccessToken).toHaveBeenCalledWith('http://localhost:3006');
    expect(mocks.createHubClient).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ bffBasePath: 'http://localhost:3006' }),
    );
  });

  it('seeds the workspace-switch token before exposing the switched profile', async () => {
    const observeWorkspace = vi.fn<(workspaceName?: string) => void>();
    const switchedToken = profileToken('Beta');
    mocks.cache.getToken.mockResolvedValue(ok(profileToken('Alpha')));
    mocks.client.setActive.mockResolvedValue({
      accessToken: switchedToken,
      expiresIn: 120,
      workspaceId: 'workspace-beta',
    });
    ({ container, root } = renderProvider(observeWorkspace));
    await flushReact();

    // The picker renders workspace names, never raw ids (CLAUDE.md, UI Identifiers).
    expect(workspaceTrigger(container).textContent?.trim()).toBe('Alpha');
    expect(container.textContent).not.toContain('workspace-beta');
    await switchWorkspace(container, 'Beta');

    expect(mocks.client.setActive).toHaveBeenCalledWith('workspace-beta');
    expect(mocks.cache.seed).toHaveBeenCalledTimes(1);
    expect(mocks.cache.seed).toHaveBeenCalledWith(switchedToken, 120);
    const betaCall = observeWorkspace.mock.calls.findIndex(([name]) => name === 'Beta');
    expect(betaCall).toBeGreaterThanOrEqual(0);
    expect(mocks.cache.seed.mock.invocationCallOrder[0]).toBeLessThan(
      observeWorkspace.mock.invocationCallOrder[betaCall]!,
    );
    expect(mocks.cache.getToken).toHaveBeenCalledTimes(1);
    expect(mocks.client.getToken).not.toHaveBeenCalled();
  });

  it('clears browser token state before SDK logout', async () => {
    const logout = deferred<void>();
    mocks.cache.getToken.mockResolvedValue(ok(profileToken('Alpha')));
    mocks.client.logout.mockReturnValue(logout.promise);
    ({ container, root } = renderProvider());
    await flushReact();

    const button = container.querySelector<HTMLButtonElement>('button[aria-label="Sair"]');
    expect(button).not.toBeNull();
    await act(async () => {
      button?.click();
      await Promise.resolve();
    });

    expect(mocks.cache.clear).toHaveBeenCalledTimes(1);
    expect(mocks.cache.clear.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.client.logout.mock.invocationCallOrder[0]!,
    );
    expect(container.querySelector('[data-testid="profile"]')?.textContent).toBe('signed-out:');

    logout.resolve();
    await flushReact();
    expect(container.querySelector('[data-testid="profile"]')?.textContent).toBe('signed-out:');
  });

  it('does not restore authentication when a workspace switch resolves after logout begins', async () => {
    const switchRequest = deferred<Awaited<ReturnType<HubClient['setActive']>>>();
    const logout = deferred<void>();
    const observeWorkspace = vi.fn<(workspaceName?: string) => void>();
    const switchedToken = profileToken('Beta');
    mocks.cache.getToken.mockResolvedValue(ok(profileToken('Alpha')));
    mocks.client.setActive.mockReturnValue(switchRequest.promise);
    mocks.client.logout.mockReturnValue(logout.promise);
    ({ container, root } = renderProvider(observeWorkspace));
    await flushReact();

    const button = container.querySelector<HTMLButtonElement>('button[aria-label="Sair"]');
    expect(button).not.toBeNull();
    await switchWorkspace(container, 'Beta');
    expect(mocks.client.setActive).toHaveBeenCalledWith('workspace-beta');

    await act(async () => {
      button?.click();
      await Promise.resolve();
    });
    expect(mocks.cache.clear).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-testid="profile"]')?.textContent).toBe('signed-out:');

    switchRequest.resolve({
      accessToken: switchedToken,
      expiresIn: 120,
      workspaceId: 'workspace-beta',
    });
    await flushReact();
    expect(mocks.cache.seed).not.toHaveBeenCalled();
    expect(observeWorkspace.mock.calls.some(([name]) => name === 'Beta')).toBe(false);
    expect(container.querySelector('[data-testid="profile"]')?.textContent).toBe('signed-out:');

    logout.resolve();
    await flushReact();
    expect(container.querySelector('[data-testid="profile"]')?.textContent).toBe('signed-out:');
  });

  it('keeps the newest requested workspace authoritative when switches resolve out of order', async () => {
    const workspaces = [
      { id: 'workspace-alpha', name: 'Alpha' },
      { id: 'workspace-beta', name: 'Beta' },
      { id: 'workspace-gamma', name: 'Gamma' },
    ];
    const betaSwitch = deferred<Awaited<ReturnType<HubClient['setActive']>>>();
    const gammaSwitch = deferred<Awaited<ReturnType<HubClient['setActive']>>>();
    const observeWorkspace = vi.fn<(workspaceName?: string) => void>();
    const betaToken = profileToken('Beta', workspaces);
    const gammaToken = profileToken('Gamma', workspaces);
    mocks.cache.getToken.mockResolvedValue(ok(profileToken('Alpha', workspaces)));
    mocks.client.setActive.mockImplementation((workspaceId) => {
      if (workspaceId === 'workspace-beta') return betaSwitch.promise;
      if (workspaceId === 'workspace-gamma') return gammaSwitch.promise;
      throw new Error(`Unexpected workspace: ${workspaceId}`);
    });
    ({ container, root } = renderProvider(observeWorkspace));
    await flushReact();

    await switchWorkspace(container, 'Beta');
    await switchWorkspace(container, 'Gamma');
    expect(mocks.client.setActive).toHaveBeenNthCalledWith(1, 'workspace-beta');
    expect(mocks.client.setActive).toHaveBeenNthCalledWith(2, 'workspace-gamma');

    gammaSwitch.resolve({
      accessToken: gammaToken,
      expiresIn: 120,
      workspaceId: 'workspace-gamma',
    });
    await flushReact();
    expect(mocks.cache.seed).toHaveBeenCalledTimes(1);
    expect(mocks.cache.seed).toHaveBeenCalledWith(gammaToken, 120);
    const gammaCall = observeWorkspace.mock.calls.findIndex(([name]) => name === 'Gamma');
    expect(gammaCall).toBeGreaterThanOrEqual(0);
    expect(mocks.cache.seed.mock.invocationCallOrder[0]).toBeLessThan(
      observeWorkspace.mock.invocationCallOrder[gammaCall]!,
    );

    betaSwitch.resolve({
      accessToken: betaToken,
      expiresIn: 120,
      workspaceId: 'workspace-beta',
    });
    await flushReact();
    expect(mocks.cache.seed).toHaveBeenCalledTimes(1);
    expect(observeWorkspace.mock.calls.some(([name]) => name === 'Beta')).toBe(false);
    expect(container.querySelector('[data-testid="profile"]')?.textContent).toBe(
      'signed-in:Gamma',
    );
  });
});

describe('session preservation and route restore', () => {
  type Reader = { current: TokenReader | null };

  function reader(): Reader {
    return { current: null };
  }

  async function readToken(held: Reader) {
    if (!held.current) throw new Error('token reader never became ready');
    await act(async () => {
      await held.current?.();
    });
  }

  /**
   * Only `setTimeout`/`clearTimeout` are faked, and leaving React's scheduler and `Date`
   * on real implementations keeps `act` deterministic.
   *
   * `react.tsx` now has TWO timer sources: this ladder and the proactive renewal. So
   * `vi.getTimerCount()` is only a ladder oracle while the renewal provably cannot arm,
   * and the renewal arms only from a FINITE `tokenCache.expiresAt()`. The global
   * `beforeEach` pins that to `null`, and this helper re-states it at the point of use,
   * so every count in this block is ladder-specific BY CONSTRUCTION rather than by luck.
   * Verified rather than assumed: happy-dom reports `document.visibilityState` as
   * `visible` whenever the document has a `defaultView`, so a visibility guard alone
   * would NOT have kept these tests inert.
   *
   * Non-vacuity for the pin lives in `proactive token renewal` below, which asserts that
   * a finite `expiresAt` really does arm exactly one timer.
   */
  function useLadderTimers() {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    mocks.cache.expiresAt.mockReturnValue(null);
  }

  /**
   * The oracle for "did this outcome enter the ladder" is `vi.getTimerCount()`, never a
   * latency observation. The ladder is the only thing in `react.tsx` that schedules a
   * timer, so a count of `0` after a `401` is proof that no rung EXISTS - not evidence
   * that none has fired yet. CLAUDE.md records a DOM-level test in this exact
   * environment passing with the bug fully present; this is the invariant that makes
   * that impossible.
   */
  it('signs out at once when the BFF says the session expired, without entering the ladder', async () => {
    useLadderTimers();
    const token = profileToken('Alpha');
    mocks.cache.getToken.mockResolvedValueOnce(ok(token)).mockResolvedValue(expired);
    const held = reader();

    ({ container, root } = renderProtected(['/cadastros/produtos'], (getToken) => {
      held.current = getToken;
    }));
    await flushReact();
    expect(profileText(container)).toBe('signed-in:Alpha');

    await readToken(held);

    // No timer advance at all: the sign-out is on this single response.
    expect(profileText(container)).toBe('signed-out:');
    expect(vi.getTimerCount()).toBe(0);
    // Mount read plus the probe read. A third would mean a rung ran.
    expect(mocks.cache.getToken).toHaveBeenCalledTimes(2);
  });

  it('keeps the session and enters the ladder when a refresh is transiently unavailable', async () => {
    useLadderTimers();
    const token = profileToken('Alpha');
    mocks.cache.getToken
      .mockResolvedValueOnce(ok(token))
      .mockResolvedValueOnce(transient)
      .mockResolvedValue(ok(token));
    const held = reader();

    ({ container, root } = renderProtected(['/cadastros/produtos'], (getToken) => {
      held.current = getToken;
    }));
    await flushReact();
    await readToken(held);

    // A Hub outage is not a verdict on the session, so nothing about the profile moves.
    expect(profileText(container)).toBe('signed-in:Alpha');
    expect(mocks.client.login).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(1);

    await advance(SESSION_REVALIDATE_DELAYS_MS[0]);
    expect(profileText(container)).toBe('signed-in:Alpha');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('holds a cold start on a transient failure instead of signing out', async () => {
    useLadderTimers();
    mocks.cache.getToken.mockResolvedValue(transient);

    ({ container, root } = renderProtected(['/cadastros/produtos']));
    await flushReact();

    /*
      Cold start is no longer a special case. An immediate redirect during a Hub outage
      lands on a login that also fails, burns the `registerLoginAttempt` budget and
      strands the operator on `SessionRecoveryPanel` - the same class of bug the ladder
      exists to prevent, reached from the other end. `isLoaded` stays false meanwhile, so
      `Protected` holds its Skeleton rather than flashing a signed-out screen.
    */
    expect(profileText(container)).toBe('loading');
    expect(vi.getTimerCount()).toBe(1);
    expect(mocks.client.login).not.toHaveBeenCalled();

    for (const delay of SESSION_REVALIDATE_DELAYS_MS) {
      await advance(delay);
    }

    // The ladder TERMINATES; it does not hang. A Hub that never recovers still ends in
    // exactly today's behaviour.
    expect(profileText(container)).toBe('signed-out:');
    expect(mocks.client.login).toHaveBeenCalledTimes(1);
  });

  it('signs out at cold start when the BFF says the session expired', async () => {
    useLadderTimers();
    mocks.cache.getToken.mockResolvedValue(expired);

    ({ container, root } = renderProtected(['/cadastros/produtos']));
    await flushReact();

    // The anonymous-visitor path: no session cookie, `401 no_session`, straight to
    // login. It must keep today's latency exactly.
    expect(profileText(container)).toBe('signed-out:');
    expect(vi.getTimerCount()).toBe(0);
    expect(mocks.client.login).toHaveBeenCalledTimes(1);
  });

  it('keeps the signed-in session when a refresh fails transiently once', async () => {
    useLadderTimers();
    const token = profileToken('Alpha');
    mocks.cache.getToken
      .mockResolvedValueOnce(ok(token))
      .mockResolvedValueOnce(transient)
      .mockResolvedValue(ok(token));
    const held = reader();

    ({ container, root } = renderProtected(['/cadastros/produtos'], (getToken) => {
      held.current = getToken;
    }));
    await flushReact();
    expect(profileText(container)).toBe('signed-in:Alpha');

    await readToken(held);

    // The behavioural core: one failed read signs nobody out and navigates nobody away.
    expect(mocks.client.login).not.toHaveBeenCalled();
    expect(profileText(container)).toBe('signed-in:Alpha');
    expect(locationText(container)).toBe('/cadastros/produtos');
    expect(sessionStorage.getItem(RETURN_TO_KEY)).toBeNull();

    await advance(SESSION_REVALIDATE_DELAYS_MS[0]);
    expect(mocks.client.login).not.toHaveBeenCalled();
    expect(profileText(container)).toBe('signed-in:Alpha');
  });

  /**
   * The ladder counter must be a count of CONSECUTIVE failures, never a lifetime total.
   * Deleting `revalidateAttempts.current = 0` from the recovery branch leaves every
   * other test in this file green, yet it reships the reported bug: the counter
   * accumulates across unrelated blips, so roughly the fourth transient null of a long
   * session exhausts the ladder outright and destroys the operator's half-filled form.
   *
   * One blip cannot catch that. The sequence has to drive the counter PAST the ladder
   * length in total while never failing twice in a row.
   */
  it('resets the ladder after each recovery, so unrelated blips never accumulate', async () => {
    useLadderTimers();
    const token = profileToken('Alpha');
    const blips = SESSION_REVALIDATE_DELAYS_MS.length + 1;
    // Mount, then per blip: the probe read that returns null, and the ladder read that
    // recovers. A lifetime counter exhausts the ladder on the last blip; a consecutive
    // one never gets past rung 1.
    mocks.cache.getToken.mockResolvedValueOnce(ok(token));
    for (let blip = 0; blip < blips; blip += 1) {
      mocks.cache.getToken.mockResolvedValueOnce(transient).mockResolvedValueOnce(ok(token));
    }
    mocks.cache.getToken.mockResolvedValue(ok(token));
    const held = reader();

    ({ container, root } = renderProtected(['/cadastros/produtos?f=1'], (getToken) => {
      held.current = getToken;
    }));
    await flushReact();
    expect(profileText(container)).toBe('signed-in:Alpha');

    for (let blip = 0; blip < blips; blip += 1) {
      await readToken(held);
      // Long enough to fire whichever rung the ladder is actually sitting on, so a
      // failure here is an exhausted ladder and never an un-fired timer.
      await advance(SESSION_REVALIDATE_DELAYS_MS[SESSION_REVALIDATE_DELAYS_MS.length - 1]!);
      expect({ blip, profile: profileText(container) }).toEqual({
        blip,
        profile: 'signed-in:Alpha',
      });
    }

    expect(mocks.client.login).not.toHaveBeenCalled();
    expect(profileText(container)).toBe('signed-in:Alpha');
    expect(locationText(container)).toBe('/cadastros/produtos?f=1');
    expect(sessionStorage.getItem(RETURN_TO_KEY)).toBeNull();
    // Every blip really did run a ladder read; otherwise the loop above proves nothing.
    expect(mocks.cache.getToken).toHaveBeenCalledTimes(1 + blips * 2);
  });

  it('clears the login attempt counter once a token is observed', async () => {
    sessionStorage.setItem(LOGIN_ATTEMPTS_KEY, JSON.stringify({ count: 2, firstAt: Date.now() }));
    mocks.cache.getToken.mockResolvedValue(ok(profileToken('Alpha')));

    ({ container, root } = renderProtected(['/cadastros/produtos']));
    await flushReact();

    expect(profileText(container)).toBe('signed-in:Alpha');
    // A successful read means the loop the guard exists to stop did not happen, so the
    // next genuine re-login must start from a full budget rather than from a stale 2.
    expect(sessionStorage.getItem(LOGIN_ATTEMPTS_KEY)).toBeNull();
  });

  it('clears a still-pending ladder timer at unmount', async () => {
    useLadderTimers();
    mocks.cache.getToken.mockResolvedValueOnce(ok(profileToken('Alpha'))).mockResolvedValue(transient);
    const held = reader();

    ({ container, root } = renderProtected(['/cadastros/produtos'], (getToken) => {
      held.current = getToken;
    }));
    await flushReact();
    await readToken(held);
    expect(vi.getTimerCount()).toBe(1);

    await act(async () => {
      root?.unmount();
    });
    container?.remove();
    root = null;
    container = null;

    expect(vi.getTimerCount()).toBe(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    // Mount read plus the probe read, and nothing else: an uncleared rung would fire a
    // refresh request for a screen the operator has already left.
    expect(mocks.cache.getToken).toHaveBeenCalledTimes(2);
  });

  it('drops a ladder refresh that resolves after unmount instead of rescheduling', async () => {
    useLadderTimers();
    const token = profileToken('Alpha');
    const ladderRead = deferred<HubTokenResult>();
    mocks.cache.getToken
      .mockResolvedValueOnce(ok(token))
      .mockResolvedValueOnce(transient)
      .mockReturnValueOnce(ladderRead.promise)
      .mockResolvedValue(ok(token));
    const held = reader();

    ({ container, root } = renderProtected(['/cadastros/produtos'], (getToken) => {
      held.current = getToken;
    }));
    await flushReact();
    await readToken(held);

    // Fire the pending rung, leaving its refresh IN FLIGHT. This is the interleaving the
    // unmount cleanup alone does not cover: `revalidateTimer` is already null, so there
    // is nothing left for it to clear.
    await advance(SESSION_REVALIDATE_DELAYS_MS[0]!);
    expect(mocks.cache.getToken).toHaveBeenCalledTimes(3);

    await act(async () => {
      root?.unmount();
    });
    container?.remove();
    root = null;
    container = null;

    // The refresh lands on a component that no longer exists. It must be dropped, not
    // turned into another rung: a post-unmount reschedule leaks a timer forever and
    // ends in a setState on an unmounted root.
    await act(async () => {
      ladderRead.resolve(transient);
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(mocks.cache.getToken).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
    expect(mocks.client.login).not.toHaveBeenCalled();
  });

  /**
   * The route restore is unchanged; what changed is who triggers the navigation. A LIVE
   * loss no longer redirects on its own (see `live session loss` below), so the capture
   * now happens on the operator's own `Entrar` click. The restore half - storage written,
   * consumed once, applied on the next mount - is exactly what it always was.
   */
  it('captures and restores the pre-login route across a genuine re-login', async () => {
    useLadderTimers();
    mocks.cache.getToken.mockResolvedValueOnce(ok(profileToken('Alpha'))).mockResolvedValue(transient);
    const held = reader();

    ({ container, root } = renderProtected(['/cadastros/produtos?f=1'], (getToken) => {
      held.current = getToken;
    }));
    await flushReact();
    expect(profileText(container)).toBe('signed-in:Alpha');

    await readToken(held);
    for (const delay of SESSION_REVALIDATE_DELAYS_MS) {
      expect(mocks.client.login).not.toHaveBeenCalled();
      await advance(delay);
    }

    expect(profileText(container)).toBe('signed-out:');
    // Still nothing: an exhausted ladder is a live loss, and a live loss waits.
    expect(mocks.client.login).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(RETURN_TO_KEY)).toBeNull();

    await clickButton(container, 'Entrar');

    expect(mocks.client.login).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(RETURN_TO_KEY)).toBe('/cadastros/produtos?f=1');

    // The browser round trip: full navigation, callback, server-chosen landing route.
    await act(async () => {
      root?.unmount();
    });
    container?.remove();
    root = null;
    container = null;
    mocks.cache.getToken.mockReset();
    mocks.cache.getToken.mockResolvedValue(ok(profileToken('Alpha')));

    ({ container, root } = renderProtected(['/']));
    await flushReact();

    expect(locationText(container)).toBe('/cadastros/produtos?f=1');
    expect(sessionStorage.getItem(RETURN_TO_KEY)).toBeNull();
  });

  it.each(['https://evil.example/', '//evil.example/x'])(
    'discards the hostile stored return path %j instead of navigating to it',
    async (hostile) => {
      sessionStorage.setItem(RETURN_TO_KEY, hostile);
      mocks.cache.getToken.mockResolvedValue(ok(profileToken('Alpha')));

      ({ container, root } = renderProtected(['/']));
      await flushReact();

      expect(locationText(container)).toBe('/');
      expect(container.textContent).not.toContain('evil.example');
      expect(sessionStorage.getItem(RETURN_TO_KEY)).toBeNull();
    },
  );

  it('stops re-logging in and offers a manual retry after repeated failures', async () => {
    sessionStorage.setItem(
      LOGIN_ATTEMPTS_KEY,
      JSON.stringify({ count: 3, firstAt: Date.now() }),
    );
    mocks.cache.getToken.mockResolvedValue(expired);

    ({ container, root } = renderProtected(['/']));
    await flushReact();

    expect(mocks.client.login).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Não foi possível restabelecer sua sessão');

    const retry = [...container.querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === 'Tentar novamente',
    );
    if (!retry) throw new Error('manual retry button not found');
    await act(async () => {
      retry.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });

    expect(mocks.client.login).toHaveBeenCalledTimes(1);
  });

  it('does not re-render auth consumers when a refresh returns the same token', async () => {
    mocks.cache.getToken.mockResolvedValue(ok(profileToken('Alpha')));
    const held = reader();

    ({ container, root } = renderProtected(['/cadastros/produtos'], (getToken) => {
      held.current = getToken;
    }));
    await flushReact();
    expect(profileText(container)).toBe('signed-in:Alpha');

    const before = probeRenders;
    await readToken(held);
    await readToken(held);
    await flushReact();

    expect(probeRenders).toBe(before);
  });
});

/**
 * The reported bug: "if I leave the tab open for a few minutes, when I come back the
 * whole page reloads and I lose the form I was filling."
 *
 * `login()` is `window.location.assign` to the Hub, so calling it destroys the document
 * and every byte of unsaved form state with it. `captureReturnTo` restores the ROUTE and
 * has never restored form state. So the oracle is `mocks.client.login`: a live loss must
 * not call it at all, and a cold entry must still call it exactly once.
 */
describe('live session loss', () => {
  const LIVE_LOSS_COPY = 'Sua sessão expirou';
  const SIGNED_OUT_COPY = 'Você saiu da sua conta';

  type Reader = { current: TokenReader | null };

  function reader(): Reader {
    return { current: null };
  }

  async function readToken(held: Reader) {
    if (!held.current) throw new Error('token reader never became ready');
    await act(async () => {
      await held.current?.();
    });
  }

  function useLadderTimers() {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    mocks.cache.expiresAt.mockReturnValue(null);
  }

  /** Mounts signed in, then drives the session to a permanent failure. */
  async function loseSessionWhileSignedIn(entry = '/cadastros/produtos?f=1') {
    mocks.cache.getToken.mockResolvedValueOnce(ok(profileToken('Alpha'))).mockResolvedValue(expired);
    const held = reader();
    const mounted = renderProtected([entry], (getToken) => {
      held.current = getToken;
    });
    container = mounted.container;
    root = mounted.root;
    await flushReact();
    expect(profileText(mounted.container)).toBe('signed-in:Alpha');

    await readToken(held);
    return mounted.container;
  }

  it('does not navigate to the Hub when a session is lost while the app is signed in', async () => {
    useLadderTimers();
    const host = await loseSessionWhileSignedIn();

    expect(profileText(host)).toBe('signed-out:');
    // THE oracle for the report. `login()` is a full-page navigation, so not calling it
    // is the whole fix; everything else in this block describes what happens instead.
    expect(mocks.client.login).not.toHaveBeenCalled();
    expect(host.textContent).toContain(LIVE_LOSS_COPY);
    // Nothing captured and no attempt spent, because the login effect's body never ran.
    expect(sessionStorage.getItem(RETURN_TO_KEY)).toBeNull();
    expect(sessionStorage.getItem(LOGIN_ATTEMPTS_KEY)).toBeNull();
  });

  it('keeps the page mounted when a session is lost', async () => {
    useLadderTimers();
    const host = await loseSessionWhileSignedIn();

    /*
      The INNER location probe renders inside `Protected`. Reading it proves the
      protected subtree was never replaced, which at this level is what "the operator's
      half-filled form is still there" means: React state survives exactly as long as the
      component holding it stays mounted.
    */
    expect(locationText(host)).toBe('/cadastros/produtos?f=1');
    // And the URL is untouched too, so the page underneath is still the page they were on.
    expect(outerLocationText(host)).toBe('/cadastros/produtos?f=1');
  });

  it('still redirects to the Hub when the app is opened with no session', async () => {
    useLadderTimers();
    mocks.cache.getToken.mockResolvedValue(expired);

    ({ container, root } = renderProtected(['/cadastros/produtos?f=1']));
    await flushReact();

    /*
      The slice's must-not-break. Cold entry destroys nothing, because there is nothing on
      screen yet, and breaking it means nobody can ever sign in - strictly worse than the
      bug above. This is also what stops "never call login()" being an acceptable fix.
    */
    expect(mocks.client.login).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem(RETURN_TO_KEY)).toBe('/cadastros/produtos?f=1');
    expect(container.textContent).not.toContain(LIVE_LOSS_COPY);
  });

  it('redirects on a cold entry whose very first read is a transient ladder exhaustion', async () => {
    useLadderTimers();
    mocks.cache.getToken.mockResolvedValue(transient);

    ({ container, root } = renderProtected(['/cadastros/produtos?f=1']));
    await flushReact();
    for (const delay of SESSION_REVALIDATE_DELAYS_MS) {
      await advance(delay);
    }

    // A cold entry stays a cold entry however long it took to fail: no token was ever
    // applied in this document, so there is still nothing on screen to protect.
    expect(profileText(container)).toBe('signed-out:');
    expect(mocks.client.login).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toContain(LIVE_LOSS_COPY);
  });

  it('navigates only when the operator asks, capturing the route they were on', async () => {
    useLadderTimers();
    const host = await loseSessionWhileSignedIn();

    await clickButton(host, 'Entrar');

    expect(mocks.client.login).toHaveBeenCalledTimes(1);
    // The redirect is now THEIRS, so the loss is expected rather than inflicted - and the
    // route restore still happens, through the one path into `login()`.
    expect(sessionStorage.getItem(RETURN_TO_KEY)).toBe('/cadastros/produtos?f=1');
  });

  it('shows the explicit sign-out state rather than the session-loss state after Sair', async () => {
    mocks.cache.getToken.mockResolvedValue(ok(profileToken('Alpha')));

    ({ container, root } = renderProtected(['/cadastros/produtos?f=1']));
    await flushReact();

    // An explicit `Sair` is also a live loss by the discriminator - a token was applied,
    // then it was not - so the durable intent has to keep winning, or the operator would
    // be told their session expired when they ended it themselves.
    const sair = container.querySelector<HTMLButtonElement>('button[aria-label="Sair"]');
    if (!sair) throw new Error('sign-out button not found');
    await act(async () => {
      sair.click();
      await Promise.resolve();
    });

    expect(container.textContent).toContain(SIGNED_OUT_COPY);
    expect(container.textContent).not.toContain(LIVE_LOSS_COPY);
    expect(mocks.client.login).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(LOGOUT_INTENT_KEY)).toBe('1');
  });

  it('does not carry a spent sign-in request into a later loss in the same document', async () => {
    useLadderTimers();
    const token = profileToken('Alpha');
    mocks.cache.getToken
      .mockResolvedValueOnce(ok(token))
      .mockResolvedValueOnce(expired)
      .mockResolvedValueOnce(ok(token))
      .mockResolvedValue(expired);
    const held = reader();
    const mounted = renderProtected(['/cadastros/produtos'], (getToken) => {
      held.current = getToken;
    });
    container = mounted.container;
    root = mounted.root;
    await flushReact();

    await readToken(held);
    await clickButton(mounted.container, 'Entrar');
    expect(mocks.client.login).toHaveBeenCalledTimes(1);

    // `login()` is a navigation REQUEST, not a guarantee: a blocked assign leaves this tab
    // alive. So the tab signs back in, and then loses the session a second time.
    await readToken(held);
    expect(profileText(mounted.container)).toBe('signed-in:Alpha');
    await readToken(held);

    expect(profileText(mounted.container)).toBe('signed-out:');
    // A spent request must not silently restore the auto-navigation this block removed.
    expect(mocks.client.login).toHaveBeenCalledTimes(1);
    expect(mounted.container.textContent).toContain(LIVE_LOSS_COPY);
  });

  it('keeps offering a working sign-in after a live loss inside a blocked login window', async () => {
    useLadderTimers();
    sessionStorage.setItem(LOGIN_ATTEMPTS_KEY, JSON.stringify({ count: 3, firstAt: Date.now() }));
    const host = await loseSessionWhileSignedIn();

    // The loop guard exists to stop AUTOMATIC re-login loops. A live loss never spends an
    // attempt on its own, so a counter left over from an earlier episode must not turn the
    // operator's own click into a dead button on top of their unsaved work.
    expect(host.textContent).toContain(LIVE_LOSS_COPY);
    await clickButton(host, 'Entrar');

    expect(mocks.client.login).toHaveBeenCalledTimes(1);
  });
});

/**
 * Part B. Nothing in the app reads a token while the tab is idle, so the cached token
 * simply lapses and the FIRST read after the operator returns pays for a refresh - and,
 * if it fails, used to pay with their form. Renewing at `exp - 60s` while the tab is
 * visible means an open tab holds a valid token continuously and that read never happens.
 */
describe('proactive token renewal', () => {
  const TOKEN_LIFETIME_MS = 180_000;
  const RENEWAL_LEAD_MS = 60_000;

  /**
   * happy-dom derives `visibilityState` from `defaultView` and has no setter, so the
   * property is redefined on the instance and restored in `afterEach`.
   */
  function setVisibility(state: 'visible' | 'hidden') {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => state,
    });
  }

  function fireVisibilityChange() {
    document.dispatchEvent(new Event('visibilitychange'));
  }

  afterEach(() => {
    // The own-property shadow would otherwise outlive the test and hide the real getter.
    delete (document as unknown as Record<string, unknown>).visibilityState;
  });

  function useRenewalTimers() {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  }

  async function mountSignedIn() {
    mocks.cache.getToken.mockResolvedValue(ok(profileToken('Alpha')));
    const mounted = renderProtected(['/cadastros/produtos']);
    container = mounted.container;
    root = mounted.root;
    await flushReact();
    expect(profileText(mounted.container)).toBe('signed-in:Alpha');
    return mounted.container;
  }

  it('renews the token before it expires while the document is visible', async () => {
    useRenewalTimers();
    setVisibility('visible');
    mocks.cache.expiresAt.mockReturnValue(Date.now() + TOKEN_LIFETIME_MS);
    mocks.cache.renew.mockResolvedValue(ok(profileToken('Alpha')));

    const host = await mountSignedIn();
    // Non-vacuity for the `expiresAt: null` pin the ladder block relies on: a finite
    // expiry really does arm exactly one timer.
    expect(vi.getTimerCount()).toBe(1);

    await advance(TOKEN_LIFETIME_MS - RENEWAL_LEAD_MS);

    // `renew`, never `getToken`: at `exp - 60s` the cache still serves from memory
    // (`ACCESS_TOKEN_EXPIRY_SKEW_MS` is 30s), so a `getToken` renewal would be a no-op
    // that issues no request at all.
    expect(mocks.cache.renew).toHaveBeenCalledTimes(1);
    // The mount read, and nothing else: no consumer read the token to make this happen.
    expect(mocks.cache.getToken).toHaveBeenCalledTimes(1);
    expect(profileText(host)).toBe('signed-in:Alpha');
  });

  /**
   * `scheduleRenewal` runs on EVERY observed non-null token - roughly forty per screen -
   * and on every visibilitychange back to visible. Its idempotency is two lines, the
   * `renewalTarget` early return and the `clearRenewalTimer()` under it, and without
   * them each of those calls arms an additional live `setTimeout` that nothing will ever
   * clear.
   *
   * The oracle is therefore the timer COUNT and not "a renewal happened": every other
   * test in this block still passes with the guard deleted, because one renewal per token
   * lifetime and forty of them look identical from the outside. Asserted after each
   * individual read rather than only at the end, so the first leaked timer names the
   * event that leaked it.
   */
  it('arms exactly one renewal however many times the token is read', async () => {
    useRenewalTimers();
    setVisibility('visible');
    mocks.cache.expiresAt.mockReturnValue(Date.now() + TOKEN_LIFETIME_MS);
    mocks.cache.renew.mockResolvedValue(ok(profileToken('Alpha')));
    mocks.cache.getToken.mockResolvedValue(ok(profileToken('Alpha')));

    const held: { current: TokenReader | null } = { current: null };
    const mounted = renderProtected(['/cadastros/produtos'], (getToken) => {
      held.current = getToken;
    });
    container = mounted.container;
    root = mounted.root;
    await flushReact();
    expect(profileText(mounted.container)).toBe('signed-in:Alpha');
    expect(vi.getTimerCount()).toBe(1);

    // Stands in for the ~40 data hooks that read the token on one screen.
    for (let read = 0; read < 5; read += 1) {
      await act(async () => {
        await held.current?.();
      });
      expect(vi.getTimerCount()).toBe(1);
    }

    // And for an operator tabbing away and back, which re-arms through the other path.
    for (let focus = 0; focus < 3; focus += 1) {
      fireVisibilityChange();
      expect(vi.getTimerCount()).toBe(1);
    }

    // None of that renewed anything: the pending rung is still the one the mount armed.
    expect(mocks.cache.renew).not.toHaveBeenCalled();

    /*
      Non-vacuity for the count: the single surviving timer really is the renewal, it
      still fires at `exp - 60s`, and it fires ONCE. Eight leaked timers armed at eight
      different moments would each renew in turn.
    */
    await advance(TOKEN_LIFETIME_MS - RENEWAL_LEAD_MS);
    expect(mocks.cache.renew).toHaveBeenCalledTimes(1);
  });

  it('does not schedule a renewal while the document is hidden', async () => {
    useRenewalTimers();
    setVisibility('hidden');
    mocks.cache.expiresAt.mockReturnValue(Date.now() + TOKEN_LIFETIME_MS);

    await mountSignedIn();

    // A hidden tab is throttled, so the rung would fire late and useless, and holding a
    // session alive for a tab nobody is looking at is not a service to anyone.
    expect(vi.getTimerCount()).toBe(0);
    await advance(TOKEN_LIFETIME_MS * 4);
    expect(mocks.cache.renew).not.toHaveBeenCalled();
  });

  it('renews immediately on becoming visible with an expired token', async () => {
    useRenewalTimers();
    setVisibility('hidden');
    mocks.cache.expiresAt.mockReturnValue(Date.now() + TOKEN_LIFETIME_MS);
    mocks.cache.renew.mockResolvedValue(ok(profileToken('Alpha')));
    const host = await mountSignedIn();

    // The tab was hidden long enough for the token to lapse.
    mocks.cache.expiresAt.mockReturnValue(Date.now() - 1_000);
    setVisibility('visible');
    fireVisibilityChange();

    /*
      Asserted with no flush and no timer advance at all: the renewal is requested
      SYNCHRONOUSLY on the visibilitychange event. That is the whole point - a query
      refetch on window focus would otherwise race it, read a lapsed token and reach the
      failure path this slice exists to avoid.
    */
    expect(mocks.cache.renew).toHaveBeenCalledTimes(1);
    expect(mocks.cache.getToken).toHaveBeenCalledTimes(1);

    // And the renewal really is ahead of the consumer read that follows it.
    await flushReact();
    await act(async () => {
      await Promise.resolve();
    });
    expect(profileText(host)).toBe('signed-in:Alpha');
  });

  it('schedules rather than renews when the tab becomes visible with a healthy token', async () => {
    useRenewalTimers();
    setVisibility('hidden');
    mocks.cache.expiresAt.mockReturnValue(Date.now() + TOKEN_LIFETIME_MS);
    await mountSignedIn();
    expect(vi.getTimerCount()).toBe(0);

    setVisibility('visible');
    fireVisibilityChange();

    // Still inside its life, so there is nothing to fix - only a rung to arm.
    expect(mocks.cache.renew).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(1);
  });

  it('drops a pending renewal when the tab is hidden again', async () => {
    useRenewalTimers();
    setVisibility('visible');
    mocks.cache.expiresAt.mockReturnValue(Date.now() + TOKEN_LIFETIME_MS);
    await mountSignedIn();
    expect(vi.getTimerCount()).toBe(1);

    setVisibility('hidden');
    fireVisibilityChange();

    expect(vi.getTimerCount()).toBe(0);
    await advance(TOKEN_LIFETIME_MS * 4);
    expect(mocks.cache.renew).not.toHaveBeenCalled();
  });

  it('does not renew for a tab that is not signed in', async () => {
    useRenewalTimers();
    setVisibility('visible');
    mocks.cache.expiresAt.mockReturnValue(null);
    mocks.cache.getToken.mockResolvedValue(expired);

    ({ container, root } = renderProtected(['/cadastros/produtos']));
    await flushReact();
    expect(profileText(container)).toBe('signed-out:');

    fireVisibilityChange();

    expect(mocks.cache.renew).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears a pending renewal at unmount', async () => {
    useRenewalTimers();
    setVisibility('visible');
    mocks.cache.expiresAt.mockReturnValue(Date.now() + TOKEN_LIFETIME_MS);
    await mountSignedIn();
    expect(vi.getTimerCount()).toBe(1);

    await act(async () => {
      root?.unmount();
    });
    container?.remove();
    root = null;
    container = null;

    expect(vi.getTimerCount()).toBe(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(TOKEN_LIFETIME_MS * 4);
    });
    // An uncleared rung would refresh a session for a screen the operator has left.
    expect(mocks.cache.renew).not.toHaveBeenCalled();
  });

  it('shows the session-loss state instead of navigating when a renewal finds the session dead', async () => {
    useRenewalTimers();
    setVisibility('visible');
    mocks.cache.expiresAt.mockReturnValue(Date.now() + TOKEN_LIFETIME_MS);
    mocks.cache.renew.mockResolvedValue(expired);
    const host = await mountSignedIn();

    await advance(TOKEN_LIFETIME_MS - RENEWAL_LEAD_MS);

    // The two halves of the slice meeting: the renewal is what NOTICES the dead session
    // now, and it must land on the in-place panel rather than on a navigation.
    expect(mocks.cache.renew).toHaveBeenCalledTimes(1);
    expect(profileText(host)).toBe('signed-out:');
    expect(mocks.client.login).not.toHaveBeenCalled();
    expect(host.textContent).toContain('Sua sessão expirou');
  });
});

/**
 * The oracle throughout this block is a STORAGE INVARIANT, never an observed redirect.
 * CLAUDE.md records that a DOM-level test in this exact environment once passed with a
 * bug fully present, so none of these tries to watch the race. `LOGIN_ATTEMPTS_KEY`
 * being null after a sign-out proves the login effect's BODY never ran, because
 * `registerLoginAttempt()` is its first statement and it always writes on a fresh
 * counter. That is an invariant that makes the failure impossible rather than evidence
 * that it has not happened yet.
 */
describe('explicit logout intent', () => {
  const SIGNED_OUT_COPY = 'Você saiu da sua conta';
  const LIVE_LOSS_COPY = 'Sua sessão expirou';

  function signOutButton(host: HTMLElement): HTMLButtonElement {
    const match = host.querySelector<HTMLButtonElement>('button[aria-label="Sair"]');
    if (!match) throw new Error('sign-out button not found');
    return match;
  }

  async function clickSignOut(host: HTMLElement) {
    const button = signOutButton(host);
    await act(async () => {
      button.click();
      await Promise.resolve();
    });
  }

  function remount() {
    container?.remove();
    root = null;
    container = null;
  }

  it('does not capture the route or spend a login attempt when the operator signs out', async () => {
    mocks.cache.getToken.mockResolvedValue(ok(profileToken('Alpha')));

    ({ container, root } = renderProtected(['/cadastros/produtos?f=1']));
    await flushReact();
    expect(profileText(container)).toBe('signed-in:Alpha');

    await clickSignOut(container);

    expect(sessionStorage.getItem(RETURN_TO_KEY)).toBeNull();
    // Unspent, so the login effect's body never ran at all.
    expect(sessionStorage.getItem(LOGIN_ATTEMPTS_KEY)).toBeNull();
    expect(mocks.client.login).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(LOGOUT_INTENT_KEY)).toBe('1');
  });

  it('keeps the return-to slot empty across a remount after an explicit sign-out', async () => {
    mocks.cache.getToken.mockResolvedValue(ok(profileToken('Alpha')));

    ({ container, root } = renderProtected(['/cadastros/produtos?f=1']));
    await flushReact();
    await clickSignOut(container);

    // The full-page navigation an in-memory flag cannot survive.
    await act(async () => {
      root?.unmount();
    });
    remount();
    mocks.cache.getToken.mockReset();
    mocks.cache.getToken.mockResolvedValue(expired);

    ({ container, root } = renderProtected(['/cadastros/produtos?f=1']));
    await flushReact();

    expect(sessionStorage.getItem(RETURN_TO_KEY)).toBeNull();
    expect(sessionStorage.getItem(LOGIN_ATTEMPTS_KEY)).toBeNull();
    expect(mocks.client.login).not.toHaveBeenCalled();
    expect(container.textContent).toContain(SIGNED_OUT_COPY);
  });

  it('does not auto-login while the logout intent is set', async () => {
    sessionStorage.setItem(LOGOUT_INTENT_KEY, '1');
    mocks.cache.getToken.mockResolvedValue(expired);

    ({ container, root } = renderProtected(['/cadastros/produtos?f=1']));
    await flushReact();

    expect(mocks.client.login).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(LOGIN_ATTEMPTS_KEY)).toBeNull();
    expect(sessionStorage.getItem(RETURN_TO_KEY)).toBeNull();
    expect(container.textContent).toContain(SIGNED_OUT_COPY);
  });

  it('resets the URL to the default route while the logout intent is set', async () => {
    sessionStorage.setItem(LOGOUT_INTENT_KEY, '1');
    mocks.cache.getToken.mockResolvedValue(expired);

    ({ container, root } = renderProtected(['/cadastros/produtos?f=1']));
    await flushReact();

    expect(outerLocationText(container)).toBe('/');
  });

  it('resets the URL to the default route after an explicit sign-out', async () => {
    mocks.cache.getToken.mockResolvedValue(ok(profileToken('Alpha')));

    ({ container, root } = renderProtected(['/cadastros/produtos?f=1']));
    await flushReact();
    expect(outerLocationText(container)).toBe('/cadastros/produtos?f=1');

    await clickSignOut(container);

    expect(outerLocationText(container)).toBe('/');
  });

  it('clears the intent and re-arms the login effect when the operator clicks Entrar', async () => {
    sessionStorage.setItem(LOGOUT_INTENT_KEY, '1');
    mocks.cache.getToken.mockResolvedValue(expired);

    ({ container, root } = renderProtected(['/cadastros/produtos?f=1']));
    await flushReact();

    const entrar = [...container.querySelectorAll('button')].find(
      (button) => button.textContent?.trim() === 'Entrar',
    );
    if (!entrar) throw new Error('sign-in button not found');
    await act(async () => {
      entrar.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });

    expect(sessionStorage.getItem(LOGOUT_INTENT_KEY)).toBeNull();
    expect(mocks.client.login).toHaveBeenCalledTimes(1);
    // The URL was already reduced to `/`, and `sanitizeReturnTo` rejects it, so the
    // capture on the way out stores nothing.
    expect(sessionStorage.getItem(RETURN_TO_KEY)).toBeNull();
  });

  /**
   * The same click as the test above, reached from the other side. That one seeds the
   * intent in storage BEFORE mount, so it exercises a COLD document where no token was
   * ever applied and `sessionLost` is false throughout. This one signs out INSIDE a live
   * signed-in tab, which is the only way an operator actually reaches that panel, and it
   * is the case that regressed: `logout()` reaches `applyToken(null)` while a token
   * string is still held, so the loss discriminator would fire for a departure the
   * operator asked for.
   *
   * Three assertions because the one cause had three separate consequences: a dead
   * button, the wrong copy, and the protected subtree re-mounting under the overlay for
   * someone who deliberately signed out.
   */
  it('signs in on the first Entrar click after a Sair inside a live tab', async () => {
    mocks.cache.getToken.mockResolvedValue(ok(profileToken('Alpha')));

    ({ container, root } = renderProtected(['/cadastros/produtos?f=1']));
    await flushReact();
    expect(profileText(container)).toBe('signed-in:Alpha');

    await clickSignOut(container);
    expect(container.textContent).toContain(SIGNED_OUT_COPY);

    await clickButton(container, 'Entrar');

    // ONE click, exactly as on a cold document. A second click reaching the Hub is not a
    // pass: the operator pressed the only button on the screen and nothing happened.
    expect(mocks.client.login).toHaveBeenCalledTimes(1);
    /*
      An explicit `Sair` is not a loss, so the operator is never told their session
      expired, and never told that nothing they typed was lost on a page they chose to
      leave.
    */
    expect(container.textContent).not.toContain(LIVE_LOSS_COPY);
    /*
      The INNER location probe renders only inside `Protected`'s children, and the
      live-loss branch is the one branch that keeps them mounted. Absent here is the proof
      that a signed-out operator's tab is not left holding an authenticated tree behind an
      overlay - the shared-machine reason `SignedOutPanel` exists at all.
    */
    expect(locationText(container)).toBeUndefined();
  });

  it('clears the intent whenever a live token is observed, so a stale intent can never lock the tab out', async () => {
    sessionStorage.setItem(LOGOUT_INTENT_KEY, '1');
    mocks.cache.getToken.mockResolvedValue(ok(profileToken('Alpha')));

    ({ container, root } = renderProtected(['/cadastros/produtos?f=1']));
    await flushReact();

    expect(sessionStorage.getItem(LOGOUT_INTENT_KEY)).toBeNull();
    expect(profileText(container)).toBe('signed-in:Alpha');
    // The INNER probe: readable only when `Protected` rendered its children, which is
    // the proof the panel did not win. This is the test that fails if the clear is put
    // in `applyToken`, behind its unchanged-token early return.
    expect(locationText(container)).toBe('/cadastros/produtos?f=1');
    expect(container.textContent).not.toContain(SIGNED_OUT_COPY);
  });
});

/**
 * Every key in `src/lib/query-keys.ts` is account- and org-agnostic - the bootstrap key
 * is literally `['sales-ops','bootstrap']` - and `queryClient` is a module-level
 * singleton that survives every auth event short of a page reload. So without a flush
 * one cache entry is shared by every identity the tab ever holds: the next operator is
 * served the previous one's rows, and a workspace switch renders the previous TENANT's
 * rows in place, with no reload at all.
 *
 * `['sales-ops','bootstrap']` is spelled literally in this file rather than imported
 * from the factory, because the leak is about the SHAPE of the key and a future
 * workspace-scoped factory must not be able to make these tests pass by changing it.
 */
const BOOTSTRAP_KEY = ['sales-ops', 'bootstrap'] as const;

describe('identity-scoped query cache', () => {
  type Cached = { products: string[] };

  const ALPHA_ROWS: Cached = { products: ['alpha-only'] };

  function seedAlphaCache() {
    queryClient.setQueryData(BOOTSTRAP_KEY, ALPHA_ROWS);
    // Non-vacuity: if the seed never landed, an empty cache afterwards proves nothing.
    expect(queryClient.getQueryData(BOOTSTRAP_KEY)).toEqual(ALPHA_ROWS);
  }

  function expectEmptyCache() {
    expect(queryClient.getQueryData(BOOTSTRAP_KEY)).toBeUndefined();
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
  }

  /** Same shape, and the same `expiresAt` pin, as the ladder block above. */
  function useLadderTimers() {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    mocks.cache.expiresAt.mockReturnValue(null);
  }

  it('drops every cached entry on logout', async () => {
    mocks.cache.getToken.mockResolvedValue(ok(profileToken('Alpha')));
    ({ container, root } = renderProvider());
    await flushReact();
    // AFTER the mount flush: the cold-start flush fires on the first token, so a seed
    // written before the mount resolves would be wiped and this would pass for the
    // wrong reason.
    seedAlphaCache();

    const button = container.querySelector<HTMLButtonElement>('button[aria-label="Sair"]');
    if (!button) throw new Error('sign-out button not found');
    await act(async () => {
      button.click();
      await Promise.resolve();
    });

    expectEmptyCache();
  });

  it('drops every cached entry on a workspace switch', async () => {
    mocks.cache.getToken.mockResolvedValue(ok(profileToken('Alpha')));
    mocks.client.setActive.mockResolvedValue({
      accessToken: profileToken('Beta'),
      expiresIn: 120,
      workspaceId: 'workspace-beta',
    });
    ({ container, root } = renderProvider());
    await flushReact();
    seedAlphaCache();

    await switchWorkspace(container, 'Beta');

    // Asserted together on purpose: the flush has to be proven on a switch that
    // actually COMPLETED, not on one that failed or was superseded.
    expect(profileText(container)).toBe('signed-in:Beta');
    expectEmptyCache();
  });

  /**
   * The ordering oracle for `await client.setActive(...)`, and the ONLY test in this
   * file that fails when the flush is hoisted above that `await`. Verified by mutation:
   * moving `queryClient.clear()` to the top of `setActive` leaves every other test in
   * this file green.
   *
   * A switch that is still in flight has not happened. The operator is still looking at
   * the current tenant's screen, and emptying it early strands them on a blank page for
   * a workspace they never left - and permanently so if the switch then fails.
   */
  it("keeps the current tenant's cache while a workspace switch is still in flight", async () => {
    const switchRequest = deferred<Awaited<ReturnType<HubClient['setActive']>>>();
    mocks.cache.getToken.mockResolvedValue(ok(profileToken('Alpha')));
    mocks.client.setActive.mockReturnValue(switchRequest.promise);
    ({ container, root } = renderProvider());
    await flushReact();
    seedAlphaCache();

    await switchWorkspace(container, 'Beta');

    expect(mocks.client.setActive).toHaveBeenCalledWith('workspace-beta');
    expect(profileText(container)).toBe('signed-in:Alpha');
    expect(queryClient.getQueryData(BOOTSTRAP_KEY)).toEqual(ALPHA_ROWS);

    // And the flush is merely DEFERRED, not absent - otherwise this test would pass
    // just as well against a `setActive` that never flushed at all.
    switchRequest.resolve({
      accessToken: profileToken('Beta'),
      expiresIn: 120,
      workspaceId: 'workspace-beta',
    });
    await flushReact();
    expect(profileText(container)).toBe('signed-in:Beta');
    expectEmptyCache();
  });

  /**
   * The ordering oracle for the `operationGeneration` check. A superseded switch
   * discards its result whole, so it must discard its flush too: the newest switch has
   * already completed and its screen has already refetched, and a late loser wiping
   * that is a blank screen for the tenant the operator is actually looking at.
   */
  it('does not flush when a superseded workspace switch resolves late', async () => {
    const workspaces = [
      { id: 'workspace-alpha', name: 'Alpha' },
      { id: 'workspace-beta', name: 'Beta' },
      { id: 'workspace-gamma', name: 'Gamma' },
    ];
    const betaSwitch = deferred<Awaited<ReturnType<HubClient['setActive']>>>();
    const gammaSwitch = deferred<Awaited<ReturnType<HubClient['setActive']>>>();
    mocks.cache.getToken.mockResolvedValue(ok(profileToken('Alpha', workspaces)));
    mocks.client.setActive.mockImplementation((workspaceId) => {
      if (workspaceId === 'workspace-beta') return betaSwitch.promise;
      if (workspaceId === 'workspace-gamma') return gammaSwitch.promise;
      throw new Error(`Unexpected workspace: ${workspaceId}`);
    });
    ({ container, root } = renderProvider());
    await flushReact();

    await switchWorkspace(container, 'Beta');
    await switchWorkspace(container, 'Gamma');

    gammaSwitch.resolve({
      accessToken: profileToken('Gamma', workspaces),
      expiresIn: 120,
      workspaceId: 'workspace-gamma',
    });
    await flushReact();
    expect(profileText(container)).toBe('signed-in:Gamma');

    // Gamma's own screen, refetched after the switch the operator actually made.
    const gammaRows = { products: ['gamma-only'] };
    queryClient.setQueryData(BOOTSTRAP_KEY, gammaRows);

    betaSwitch.resolve({
      accessToken: profileToken('Beta', workspaces),
      expiresIn: 120,
      workspaceId: 'workspace-beta',
    });
    await flushReact();

    expect(profileText(container)).toBe('signed-in:Gamma');
    expect(queryClient.getQueryData(BOOTSTRAP_KEY)).toEqual(gammaRows);
  });

  /**
   * The in-flight oracle. It fails if the flush is downgraded to `invalidateQueries` or
   * narrowed to a filtered `removeQueries`.
   */
  it('drops a query issued before a workspace switch instead of letting it repopulate the cache after it', async () => {
    mocks.cache.getToken.mockResolvedValue(ok(profileToken('Alpha')));
    mocks.client.setActive.mockResolvedValue({
      accessToken: profileToken('Beta'),
      expiresIn: 120,
      workspaceId: 'workspace-beta',
    });
    ({ container, root } = renderProvider());
    await flushReact();

    const pending = deferred<Cached>();
    // `clear()` rejects an outstanding fetch with a silent CancelledError, and an
    // uncaught rejection fails the run.
    const fetched = queryClient
      .fetchQuery({ queryKey: BOOTSTRAP_KEY, queryFn: () => pending.promise })
      .catch(() => undefined);

    await switchWorkspace(container, 'Beta');
    expect(queryClient.getQueryData(BOOTSTRAP_KEY)).toBeUndefined();

    pending.resolve(ALPHA_ROWS);
    await act(async () => {
      await fetched;
    });
    await flushReact();

    // The request was issued as Alpha. It must not be able to write into Beta's cache.
    expectEmptyCache();
  });

  it("drops the previous identity's cache on an in-page signed-out to signed-in transition", async () => {
    useLadderTimers();
    // `transient` and NOT `expired`: an expired read short-circuits straight to
    // `failSession()` with no ladder at all, so the rung walk below would never run and
    // the test would reach the signed-out state by a path it is not exercising.
    mocks.cache.getToken.mockResolvedValueOnce(ok(profileToken('Alpha'))).mockResolvedValue(transient);
    const held: { current: TokenReader | null } = { current: null };

    ({ container, root } = renderProvider(undefined, (getToken) => {
      held.current = getToken;
    }));
    await flushReact();
    expect(profileText(container)).toBe('signed-in:Alpha');

    if (!held.current) throw new Error('token reader never became ready');
    await act(async () => {
      await held.current?.();
    });
    for (const delay of SESSION_REVALIDATE_DELAYS_MS) {
      await advance(delay);
    }
    expect(profileText(container)).toBe('signed-out:');

    // Alpha's rows, still sitting in a cache nobody emptied.
    seedAlphaCache();

    mocks.cache.getToken.mockReset();
    mocks.cache.getToken.mockResolvedValue(ok(profileToken('Beta')));
    await act(async () => {
      await held.current?.();
    });

    expect(profileText(container)).toBe('signed-in:Beta');
    expectEmptyCache();
  });

  /**
   * The guard against implementing the login-side flush as "flush on every non-null
   * token". Without this, that obvious wrong implementation passes every test above and
   * destroys the operator's cached screen on every transient blip - the same failure
   * mode `SESSION_REVALIDATE_DELAYS_MS` exists to prevent.
   */
  it('keeps the cache when the revalidation ladder recovers from a blip', async () => {
    useLadderTimers();
    const token = profileToken('Alpha');
    mocks.cache.getToken
      .mockResolvedValueOnce(ok(token))
      .mockResolvedValueOnce(transient)
      .mockResolvedValue(ok(token));
    const held: { current: TokenReader | null } = { current: null };

    ({ container, root } = renderProvider(undefined, (getToken) => {
      held.current = getToken;
    }));
    await flushReact();
    expect(profileText(container)).toBe('signed-in:Alpha');
    seedAlphaCache();

    if (!held.current) throw new Error('token reader never became ready');
    await act(async () => {
      await held.current?.();
    });
    await advance(SESSION_REVALIDATE_DELAYS_MS[0]);

    expect(profileText(container)).toBe('signed-in:Alpha');
    expect(queryClient.getQueryData(BOOTSTRAP_KEY)).toEqual(ALPHA_ROWS);
  });
});
