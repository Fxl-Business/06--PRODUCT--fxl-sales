// @vitest-environment happy-dom

import type { HubClient } from '@fxl-business/hub-sdk/client';
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
    getToken: vi.fn<HubClient['getToken']>(),
    seed: vi.fn<(accessToken: string, expiresInSeconds: number) => void>(),
    clear: vi.fn<() => void>(),
  };

  return {
    client,
    cache,
    createHubClient: vi.fn(() => client),
    createHubAccessTokenCache: vi.fn(() => cache),
  };
});

vi.mock('@fxl-business/hub-sdk/client', () => ({
  createHubClient: mocks.createHubClient,
}));

vi.mock('../token', () => ({
  createHubAccessTokenCache: mocks.createHubAccessTokenCache,
}));

import {
  AppAuthProvider,
  Protected,
  SESSION_REVALIDATE_DELAYS_MS,
  UserControls,
  useAccessToken,
  useAuthProfile,
} from '../react';
import { LOGIN_ATTEMPTS_KEY, RETURN_TO_KEY } from '../session-recovery';

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
  workspaces: Array<{ id: string; name: string }> = [
    { id: 'workspace-alpha', name: 'Alpha' },
    { id: 'workspace-beta', name: 'Beta' },
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

function renderProvider(onWorkspace?: (workspaceName?: string) => void) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <AppAuthProvider>
        <Probe onWorkspace={onWorkspace} />
        <UserControls />
      </AppAuthProvider>,
    );
  });

  return { container, root };
}

/**
 * Renders the router location, so a restore can be asserted without stubbing
 * `window.location`. Lives inside `Protected`, which renders a Skeleton while
 * signed out, so it is only readable once the profile is signed in.
 */
function LocationProbe() {
  const { pathname, search } = useLocation();
  return <output data-testid="location">{`${pathname}${search}`}</output>;
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

function renderProtected(initialEntries: string[], onReady?: (getToken: TokenReader) => void) {
  const host = document.createElement('div');
  document.body.append(host);
  const nextRoot = createRoot(host);

  act(() => {
    nextRoot.render(
      <AppAuthProvider>
        <MemoryRouter initialEntries={initialEntries}>
          <Probe />
          <Protected>
            <LocationProbe />
            <TokenProbe onReady={onReady} />
          </Protected>
        </MemoryRouter>
      </AppAuthProvider>,
    );
  });

  return { container: host, root: nextRoot };
}

const profileText = (host: HTMLElement) =>
  host.querySelector('[data-testid="profile"]')?.textContent;

const locationText = (host: HTMLElement) =>
  host.querySelector('[data-testid="location"]')?.textContent;

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

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  probeRenders = 0;
  vi.stubEnv('VITE_FXL_HUB_API_URL', 'http://hub.test');
  vi.stubEnv('VITE_FXL_HUB_PUBLISHABLE_KEY', 'pk_fxl-sales_test');
  mocks.createHubClient.mockReturnValue(mocks.client);
  mocks.createHubAccessTokenCache.mockReturnValue(mocks.cache);
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
    mocks.cache.getToken.mockResolvedValue(profileToken('Alpha'));
    ({ container, root } = renderProvider());

    await flushReact();

    expect(mocks.createHubAccessTokenCache).toHaveBeenCalledWith(mocks.client);
    expect(mocks.cache.getToken).toHaveBeenCalledTimes(1);
    expect(mocks.client.getToken).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="profile"]')?.textContent).toBe(
      'signed-in:Alpha',
    );
  });

  it('seeds the workspace-switch token before exposing the switched profile', async () => {
    const observeWorkspace = vi.fn<(workspaceName?: string) => void>();
    const switchedToken = profileToken('Beta');
    mocks.cache.getToken.mockResolvedValue(profileToken('Alpha'));
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
    mocks.cache.getToken.mockResolvedValue(profileToken('Alpha'));
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
    mocks.cache.getToken.mockResolvedValue(profileToken('Alpha'));
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
    mocks.cache.getToken.mockResolvedValue(profileToken('Alpha', workspaces));
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
   * Only `setTimeout`/`clearTimeout` are faked. The revalidation ladder is the
   * only thing in this file that schedules a timer, and leaving React's
   * scheduler and `Date` on real implementations keeps `act` deterministic.
   */
  function useLadderTimers() {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  }

  it('keeps the signed-in session when a refresh resolves null once', async () => {
    useLadderTimers();
    const token = profileToken('Alpha');
    mocks.cache.getToken
      .mockResolvedValueOnce(token)
      .mockResolvedValueOnce(null)
      .mockResolvedValue(token);
    const held = reader();

    ({ container, root } = renderProtected(['/cadastros/produtos'], (getToken) => {
      held.current = getToken;
    }));
    await flushReact();
    expect(profileText(container)).toBe('signed-in:Alpha');

    await readToken(held);

    // The behavioural core: one null read signs nobody out and navigates nobody away.
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
    mocks.cache.getToken.mockResolvedValueOnce(token);
    for (let blip = 0; blip < blips; blip += 1) {
      mocks.cache.getToken.mockResolvedValueOnce(null).mockResolvedValueOnce(token);
    }
    mocks.cache.getToken.mockResolvedValue(token);
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
    mocks.cache.getToken.mockResolvedValue(profileToken('Alpha'));

    ({ container, root } = renderProtected(['/cadastros/produtos']));
    await flushReact();

    expect(profileText(container)).toBe('signed-in:Alpha');
    // A successful read means the loop the guard exists to stop did not happen, so the
    // next genuine re-login must start from a full budget rather than from a stale 2.
    expect(sessionStorage.getItem(LOGIN_ATTEMPTS_KEY)).toBeNull();
  });

  it('clears a still-pending ladder timer at unmount', async () => {
    useLadderTimers();
    mocks.cache.getToken.mockResolvedValueOnce(profileToken('Alpha')).mockResolvedValue(null);
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
    const ladderRead = deferred<string | null>();
    mocks.cache.getToken
      .mockResolvedValueOnce(token)
      .mockResolvedValueOnce(null)
      .mockReturnValueOnce(ladderRead.promise)
      .mockResolvedValue(token);
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
      ladderRead.resolve(null);
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    expect(mocks.cache.getToken).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
    expect(mocks.client.login).not.toHaveBeenCalled();
  });

  it('captures and restores the pre-login route across a genuine re-login', async () => {
    useLadderTimers();
    mocks.cache.getToken.mockResolvedValueOnce(profileToken('Alpha')).mockResolvedValue(null);
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
    mocks.cache.getToken.mockResolvedValue(profileToken('Alpha'));

    ({ container, root } = renderProtected(['/']));
    await flushReact();

    expect(locationText(container)).toBe('/cadastros/produtos?f=1');
    expect(sessionStorage.getItem(RETURN_TO_KEY)).toBeNull();
  });

  it.each(['https://evil.example/', '//evil.example/x'])(
    'discards the hostile stored return path %j instead of navigating to it',
    async (hostile) => {
      sessionStorage.setItem(RETURN_TO_KEY, hostile);
      mocks.cache.getToken.mockResolvedValue(profileToken('Alpha'));

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
    mocks.cache.getToken.mockResolvedValue(null);

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
    mocks.cache.getToken.mockResolvedValue(profileToken('Alpha'));
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
