// @vitest-environment happy-dom

import type { HubClient } from '@fxl-business/hub-sdk/client';
import * as React from 'react';
import { createRoot, type Root } from 'react-dom/client';
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

import { AppAuthProvider, UserControls, useAuthProfile } from '../react';

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

function Probe({ onWorkspace }: { onWorkspace?: (workspaceName?: string) => void }) {
  const profile = useAuthProfile();

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

async function flushReact() {
  await act(async () => {
    await Promise.resolve();
  });
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  vi.clearAllMocks();
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

    const select = container.querySelector('select');
    expect(select).not.toBeNull();
    await act(async () => {
      if (!select) return;
      select.value = 'workspace-beta';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
    });

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

    const select = container.querySelector('select');
    const button = container.querySelector<HTMLButtonElement>('button[aria-label="Sair"]');
    expect(select).not.toBeNull();
    expect(button).not.toBeNull();
    await act(async () => {
      if (!select) return;
      select.value = 'workspace-beta';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
    });
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

    const select = container.querySelector('select');
    expect(select).not.toBeNull();
    await act(async () => {
      if (!select) return;
      select.value = 'workspace-beta';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
      select.value = 'workspace-gamma';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      await Promise.resolve();
    });
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
