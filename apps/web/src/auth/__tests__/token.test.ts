import type { HubClient } from '@fxl-business/hub-sdk/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ACCESS_TOKEN_EXPIRY_SKEW_MS,
  createHubAccessTokenCache,
} from '../token';

const NOW_MS = Date.UTC(2026, 0, 1, 12, 0, 0);

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

function jwtWithExpiry(expiresAtMs: number, claims: Record<string, unknown> = {}): string {
  const payload = Buffer.from(
    JSON.stringify({ ...claims, exp: expiresAtMs / 1_000 }),
  ).toString('base64url');
  return `header.${payload}.signature`;
}

function fakeClient(getToken: HubClient['getToken']): Pick<HubClient, 'getToken'> {
  return { getToken };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('createHubAccessTokenCache', () => {
  it('coalesces concurrent cache misses into one SDK refresh', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW_MS);
    const refresh = deferred<string | null>();
    const getToken = vi.fn<HubClient['getToken']>(() => refresh.promise);
    const cache = createHubAccessTokenCache(fakeClient(getToken));
    const token = jwtWithExpiry(NOW_MS + 120_000);

    const first = cache.getToken();
    const second = cache.getToken();
    const third = cache.getToken();
    refresh.resolve(token);

    await expect(Promise.all([first, second, third])).resolves.toEqual([token, token, token]);
    expect(getToken).toHaveBeenCalledTimes(1);
  });

  it('serves a fresh JWT from memory until the expiry skew boundary', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW_MS);
    const expiresAt = NOW_MS + 120_000;
    const firstToken = jwtWithExpiry(expiresAt);
    const secondToken = jwtWithExpiry(expiresAt + 120_000);
    const getToken = vi
      .fn<HubClient['getToken']>()
      .mockResolvedValueOnce(firstToken)
      .mockResolvedValueOnce(secondToken);
    const cache = createHubAccessTokenCache(fakeClient(getToken));

    await expect(cache.getToken()).resolves.toBe(firstToken);
    vi.setSystemTime(expiresAt - ACCESS_TOKEN_EXPIRY_SKEW_MS - 1);
    await expect(cache.getToken()).resolves.toBe(firstToken);
    expect(getToken).toHaveBeenCalledTimes(1);

    vi.setSystemTime(expiresAt - ACCESS_TOKEN_EXPIRY_SKEW_MS);
    await expect(cache.getToken()).resolves.toBe(secondToken);
    expect(getToken).toHaveBeenCalledTimes(2);
  });

  it('reads JWT expiry from a token carrying multibyte display claims', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW_MS);
    const token = jwtWithExpiry(NOW_MS + 120_000, { name: 'Gestão FXL' });
    const getToken = vi.fn<HubClient['getToken']>().mockResolvedValue(token);
    const cache = createHubAccessTokenCache(fakeClient(getToken));

    await expect(cache.getToken()).resolves.toBe(token);
    vi.setSystemTime(NOW_MS + 120_000 - ACCESS_TOKEN_EXPIRY_SKEW_MS - 1);
    await expect(cache.getToken()).resolves.toBe(token);
    expect(getToken).toHaveBeenCalledTimes(1);
  });

  it('does not cache a normal refresh token without a valid JWT expiry', async () => {
    const getToken = vi.fn<HubClient['getToken']>().mockResolvedValue('opaque-token');
    const cache = createHubAccessTokenCache(fakeClient(getToken));

    await expect(cache.getToken()).resolves.toBe('opaque-token');
    await expect(cache.getToken()).resolves.toBe('opaque-token');

    expect(getToken).toHaveBeenCalledTimes(2);
  });

  it('clears cached state when the client resolves null', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW_MS);
    const expiresAt = NOW_MS + 120_000;
    const firstToken = jwtWithExpiry(expiresAt);
    const nextToken = jwtWithExpiry(expiresAt + 120_000);
    const getToken = vi
      .fn<HubClient['getToken']>()
      .mockResolvedValueOnce(firstToken)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(nextToken);
    const cache = createHubAccessTokenCache(fakeClient(getToken));

    await expect(cache.getToken()).resolves.toBe(firstToken);
    vi.setSystemTime(expiresAt - ACCESS_TOKEN_EXPIRY_SKEW_MS);
    await expect(cache.getToken()).resolves.toBeNull();
    await expect(cache.getToken()).resolves.toBe(nextToken);

    expect(getToken).toHaveBeenCalledTimes(3);
  });

  it('clear discards a cached token and a late in-flight refresh result', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW_MS);
    const cachedToken = jwtWithExpiry(NOW_MS + 120_000);
    const lateToken = jwtWithExpiry(NOW_MS + 240_000);
    const replacementToken = jwtWithExpiry(NOW_MS + 360_000);
    const lateRefresh = deferred<string | null>();
    const getToken = vi
      .fn<HubClient['getToken']>()
      .mockResolvedValueOnce(cachedToken)
      .mockImplementationOnce(() => lateRefresh.promise)
      .mockResolvedValueOnce(replacementToken);
    const cache = createHubAccessTokenCache(fakeClient(getToken));

    await expect(cache.getToken()).resolves.toBe(cachedToken);
    cache.clear();
    const pending = cache.getToken();
    expect(getToken).toHaveBeenCalledTimes(2);

    cache.clear();
    lateRefresh.resolve(lateToken);
    await expect(pending).resolves.toBeNull();
    await expect(cache.getToken()).resolves.toBe(replacementToken);
    expect(getToken).toHaveBeenCalledTimes(3);
  });

  it('seed makes the workspace-switch token authoritative over an older in-flight refresh', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW_MS);

    for (const oldResult of [jwtWithExpiry(NOW_MS + 240_000), null]) {
      const oldRefresh = deferred<string | null>();
      const getToken = vi.fn<HubClient['getToken']>(() => oldRefresh.promise);
      const cache = createHubAccessTokenCache(fakeClient(getToken));
      const workspaceToken = jwtWithExpiry(NOW_MS + 120_000, {
        workspaceId: 'workspace-new',
      });

      const pending = cache.getToken();
      cache.seed(workspaceToken, 120);
      oldRefresh.resolve(oldResult);

      await expect(pending).resolves.toBe(workspaceToken);
      await expect(cache.getToken()).resolves.toBe(workspaceToken);
      expect(getToken).toHaveBeenCalledTimes(1);
    }
  });

  it('seed uses the earlier JWT or server expiry and rejects immortal fallback lifetimes', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW_MS);

    const jwtEarlierClient = vi.fn<HubClient['getToken']>().mockResolvedValue('jwt-expired');
    const jwtEarlierCache = createHubAccessTokenCache(fakeClient(jwtEarlierClient));
    jwtEarlierCache.seed(jwtWithExpiry(NOW_MS + 60_000), 600);
    vi.setSystemTime(NOW_MS + 60_000 - ACCESS_TOKEN_EXPIRY_SKEW_MS);
    await expect(jwtEarlierCache.getToken()).resolves.toBe('jwt-expired');
    expect(jwtEarlierClient).toHaveBeenCalledTimes(1);

    vi.setSystemTime(NOW_MS);
    const serverEarlierClient = vi.fn<HubClient['getToken']>().mockResolvedValue('server-expired');
    const serverEarlierCache = createHubAccessTokenCache(fakeClient(serverEarlierClient));
    serverEarlierCache.seed(jwtWithExpiry(NOW_MS + 600_000), 60);
    vi.setSystemTime(NOW_MS + 60_000 - ACCESS_TOKEN_EXPIRY_SKEW_MS);
    await expect(serverEarlierCache.getToken()).resolves.toBe('server-expired');
    expect(serverEarlierClient).toHaveBeenCalledTimes(1);

    vi.setSystemTime(NOW_MS);
    const opaqueClient = vi.fn<HubClient['getToken']>();
    const opaqueCache = createHubAccessTokenCache(fakeClient(opaqueClient));
    opaqueCache.seed('opaque-workspace-token', 120);
    await expect(opaqueCache.getToken()).resolves.toBe('opaque-workspace-token');
    expect(opaqueClient).not.toHaveBeenCalled();

    for (const lifetime of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const invalidClient = vi.fn<HubClient['getToken']>().mockResolvedValue('client-token');
      const invalidCache = createHubAccessTokenCache(fakeClient(invalidClient));
      invalidCache.seed('opaque-workspace-token', lifetime);
      await expect(invalidCache.getToken()).resolves.toBe('client-token');
      expect(invalidClient).toHaveBeenCalledTimes(1);
    }
  });
});
