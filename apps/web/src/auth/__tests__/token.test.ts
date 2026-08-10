import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HubTokenResult } from '../refresh';
import { ACCESS_TOKEN_EXPIRY_SKEW_MS, createHubAccessTokenCache } from '../token';

const NOW_MS = Date.UTC(2026, 0, 1, 12, 0, 0);

/** Every non-token resolution in this file is transient unless a case says otherwise. */
const TRANSIENT: HubTokenResult = { token: null, failure: 'transient' };

type Refresher = () => Promise<HubTokenResult>;

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

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('createHubAccessTokenCache', () => {
  it('coalesces concurrent cache misses into one SDK refresh', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW_MS);
    const pending = deferred<HubTokenResult>();
    const refresh = vi.fn<Refresher>(() => pending.promise);
    const cache = createHubAccessTokenCache(refresh);
    const token = jwtWithExpiry(NOW_MS + 120_000);

    const first = cache.getToken();
    const second = cache.getToken();
    const third = cache.getToken();
    pending.resolve({ token });

    await expect(Promise.all([first, second, third])).resolves.toEqual([
      { token },
      { token },
      { token },
    ]);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('serves a fresh JWT from memory until the expiry skew boundary', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW_MS);
    const expiresAt = NOW_MS + 120_000;
    const firstToken = jwtWithExpiry(expiresAt);
    const secondToken = jwtWithExpiry(expiresAt + 120_000);
    const refresh = vi
      .fn<Refresher>()
      .mockResolvedValueOnce({ token: firstToken })
      .mockResolvedValueOnce({ token: secondToken });
    const cache = createHubAccessTokenCache(refresh);

    await expect(cache.getToken()).resolves.toEqual({ token: firstToken });
    vi.setSystemTime(expiresAt - ACCESS_TOKEN_EXPIRY_SKEW_MS - 1);
    await expect(cache.getToken()).resolves.toEqual({ token: firstToken });
    expect(refresh).toHaveBeenCalledTimes(1);

    vi.setSystemTime(expiresAt - ACCESS_TOKEN_EXPIRY_SKEW_MS);
    await expect(cache.getToken()).resolves.toEqual({ token: secondToken });
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('reads JWT expiry from a token carrying multibyte display claims', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW_MS);
    const token = jwtWithExpiry(NOW_MS + 120_000, { name: 'Gestão FXL' });
    const refresh = vi.fn<Refresher>().mockResolvedValue({ token });
    const cache = createHubAccessTokenCache(refresh);

    await expect(cache.getToken()).resolves.toEqual({ token });
    vi.setSystemTime(NOW_MS + 120_000 - ACCESS_TOKEN_EXPIRY_SKEW_MS - 1);
    await expect(cache.getToken()).resolves.toEqual({ token });
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('does not cache a normal refresh token without a valid JWT expiry', async () => {
    const refresh = vi.fn<Refresher>().mockResolvedValue({ token: 'opaque-token' });
    const cache = createHubAccessTokenCache(refresh);

    await expect(cache.getToken()).resolves.toEqual({ token: 'opaque-token' });
    await expect(cache.getToken()).resolves.toEqual({ token: 'opaque-token' });

    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('clears cached state when the refresh reports no token', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW_MS);
    const expiresAt = NOW_MS + 120_000;
    const firstToken = jwtWithExpiry(expiresAt);
    const nextToken = jwtWithExpiry(expiresAt + 120_000);
    const refresh = vi
      .fn<Refresher>()
      .mockResolvedValueOnce({ token: firstToken })
      .mockResolvedValueOnce(TRANSIENT)
      .mockResolvedValueOnce({ token: nextToken });
    const cache = createHubAccessTokenCache(refresh);

    await expect(cache.getToken()).resolves.toEqual({ token: firstToken });
    vi.setSystemTime(expiresAt - ACCESS_TOKEN_EXPIRY_SKEW_MS);
    await expect(cache.getToken()).resolves.toEqual(TRANSIENT);
    await expect(cache.getToken()).resolves.toEqual({ token: nextToken });

    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it('passes the failure classification straight through to the caller', async () => {
    const expired: HubTokenResult = { token: null, failure: 'session_expired' };
    const refresh = vi.fn<Refresher>().mockResolvedValue(expired);
    const cache = createHubAccessTokenCache(refresh);

    // The cache is a CACHE. It must not reinterpret the verdict `refresh.ts` reached,
    // because the provider's ladder branches on exactly this field.
    await expect(cache.getToken()).resolves.toEqual(expired);
  });

  it('clear discards a cached token and a late in-flight refresh result', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW_MS);
    const cachedToken = jwtWithExpiry(NOW_MS + 120_000);
    const lateToken = jwtWithExpiry(NOW_MS + 240_000);
    const replacementToken = jwtWithExpiry(NOW_MS + 360_000);
    const lateRefresh = deferred<HubTokenResult>();
    const refresh = vi
      .fn<Refresher>()
      .mockResolvedValueOnce({ token: cachedToken })
      .mockImplementationOnce(() => lateRefresh.promise)
      .mockResolvedValueOnce({ token: replacementToken });
    const cache = createHubAccessTokenCache(refresh);

    await expect(cache.getToken()).resolves.toEqual({ token: cachedToken });
    cache.clear();
    const pending = cache.getToken();
    expect(refresh).toHaveBeenCalledTimes(2);

    cache.clear();
    lateRefresh.resolve({ token: lateToken });
    await expect(pending).resolves.toEqual(TRANSIENT);
    await expect(cache.getToken()).resolves.toEqual({ token: replacementToken });
    expect(refresh).toHaveBeenCalledTimes(3);
  });

  it('reports a superseded refresh as transient, never as an expired session', async () => {
    // A `clear()` (logout) or a `seed()` (workspace switch) that races a dying refresh
    // must not let the dead session's verdict tear down the one that replaced it.
    const lateRefresh = deferred<HubTokenResult>();
    const refresh = vi.fn<Refresher>(() => lateRefresh.promise);
    const cache = createHubAccessTokenCache(refresh);

    const pending = cache.getToken();
    cache.clear();
    lateRefresh.resolve({ token: null, failure: 'session_expired' });

    await expect(pending).resolves.toEqual(TRANSIENT);
  });

  it('seed makes the workspace-switch token authoritative over an older in-flight refresh', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW_MS);

    const oldResults: HubTokenResult[] = [{ token: jwtWithExpiry(NOW_MS + 240_000) }, TRANSIENT];
    for (const oldResult of oldResults) {
      const oldRefresh = deferred<HubTokenResult>();
      const refresh = vi.fn<Refresher>(() => oldRefresh.promise);
      const cache = createHubAccessTokenCache(refresh);
      const workspaceToken = jwtWithExpiry(NOW_MS + 120_000, {
        workspaceId: 'workspace-new',
      });

      const pending = cache.getToken();
      cache.seed(workspaceToken, 120);
      oldRefresh.resolve(oldResult);

      await expect(pending).resolves.toEqual({ token: workspaceToken });
      await expect(cache.getToken()).resolves.toEqual({ token: workspaceToken });
      expect(refresh).toHaveBeenCalledTimes(1);
    }
  });

  /**
   * `renew` exists because the proactive renewal fires at `exp - 60s` while `getToken`
   * still serves from memory until `exp - 30s`. Reusing `getToken` for the renewal would
   * therefore be a guaranteed no-op: it would hand back the very token that is about to
   * expire and never issue a request at all.
   */
  it('renew forces a refresh even while the cached token is still servable', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW_MS);
    const expiresAt = NOW_MS + 180_000;
    const cachedToken = jwtWithExpiry(expiresAt);
    const renewedToken = jwtWithExpiry(expiresAt + 180_000);
    const refresh = vi
      .fn<Refresher>()
      .mockResolvedValueOnce({ token: cachedToken })
      .mockResolvedValueOnce({ token: renewedToken });
    const cache = createHubAccessTokenCache(refresh);

    await expect(cache.getToken()).resolves.toEqual({ token: cachedToken });
    // Well inside the skew window, so `getToken` would answer from memory here.
    vi.setSystemTime(expiresAt - 60_000);
    await expect(cache.getToken()).resolves.toEqual({ token: cachedToken });
    expect(refresh).toHaveBeenCalledTimes(1);

    await expect(cache.renew()).resolves.toEqual({ token: renewedToken });
    expect(refresh).toHaveBeenCalledTimes(2);
    // And the renewed token is what every later read gets, so the renewal really
    // replaced the cache rather than merely fetching beside it.
    await expect(cache.getToken()).resolves.toEqual({ token: renewedToken });
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('renew joins an in-flight refresh instead of issuing a second one', async () => {
    const pending = deferred<HubTokenResult>();
    const refresh = vi.fn<Refresher>(() => pending.promise);
    const cache = createHubAccessTokenCache(refresh);

    const read = cache.getToken();
    const renewal = cache.renew();
    pending.resolve({ token: 'opaque-token' });

    await expect(Promise.all([read, renewal])).resolves.toEqual([
      { token: 'opaque-token' },
      { token: 'opaque-token' },
    ]);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  /**
   * The scheduler outside cannot compute `exp - 60s` without this, and it must read the
   * SAME number the cache serves from - a second JWT parse in the provider would be a
   * second source of truth for one fact.
   */
  it('reports the cached expiry, and null whenever nothing is cached', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW_MS);
    const expiresAt = NOW_MS + 180_000;
    const refresh = vi
      .fn<Refresher>()
      .mockResolvedValueOnce({ token: jwtWithExpiry(expiresAt) })
      .mockResolvedValueOnce(TRANSIENT);
    const cache = createHubAccessTokenCache(refresh);

    expect(cache.expiresAt()).toBeNull();
    await cache.getToken();
    expect(cache.expiresAt()).toBe(expiresAt);

    cache.clear();
    expect(cache.expiresAt()).toBeNull();

    // A seed (workspace switch) is the other writer, and it is the earlier of the two
    // expiries, exactly as `getToken` would serve it.
    cache.seed(jwtWithExpiry(expiresAt), 600);
    expect(cache.expiresAt()).toBe(expiresAt);

    // A failed refresh discards the cache, so the scheduler is told there is nothing
    // left to renew rather than being handed a stale target.
    vi.setSystemTime(expiresAt);
    await cache.getToken();
    expect(cache.expiresAt()).toBeNull();
  });

  it('does not report an expiry for a token it refused to cache', async () => {
    const refresh = vi.fn<Refresher>().mockResolvedValue({ token: 'opaque-token' });
    const cache = createHubAccessTokenCache(refresh);

    await expect(cache.getToken()).resolves.toEqual({ token: 'opaque-token' });
    expect(cache.expiresAt()).toBeNull();
  });

  it('seed uses the earlier JWT or server expiry and rejects immortal fallback lifetimes', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW_MS);

    const jwtEarlierRefresh = vi.fn<Refresher>().mockResolvedValue({ token: 'jwt-expired' });
    const jwtEarlierCache = createHubAccessTokenCache(jwtEarlierRefresh);
    jwtEarlierCache.seed(jwtWithExpiry(NOW_MS + 60_000), 600);
    vi.setSystemTime(NOW_MS + 60_000 - ACCESS_TOKEN_EXPIRY_SKEW_MS);
    await expect(jwtEarlierCache.getToken()).resolves.toEqual({ token: 'jwt-expired' });
    expect(jwtEarlierRefresh).toHaveBeenCalledTimes(1);

    vi.setSystemTime(NOW_MS);
    const serverEarlierRefresh = vi.fn<Refresher>().mockResolvedValue({ token: 'server-expired' });
    const serverEarlierCache = createHubAccessTokenCache(serverEarlierRefresh);
    serverEarlierCache.seed(jwtWithExpiry(NOW_MS + 600_000), 60);
    vi.setSystemTime(NOW_MS + 60_000 - ACCESS_TOKEN_EXPIRY_SKEW_MS);
    await expect(serverEarlierCache.getToken()).resolves.toEqual({ token: 'server-expired' });
    expect(serverEarlierRefresh).toHaveBeenCalledTimes(1);

    vi.setSystemTime(NOW_MS);
    const opaqueRefresh = vi.fn<Refresher>();
    const opaqueCache = createHubAccessTokenCache(opaqueRefresh);
    opaqueCache.seed('opaque-workspace-token', 120);
    await expect(opaqueCache.getToken()).resolves.toEqual({ token: 'opaque-workspace-token' });
    expect(opaqueRefresh).not.toHaveBeenCalled();

    for (const lifetime of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const invalidRefresh = vi.fn<Refresher>().mockResolvedValue({ token: 'refreshed-token' });
      const invalidCache = createHubAccessTokenCache(invalidRefresh);
      invalidCache.seed('opaque-workspace-token', lifetime);
      await expect(invalidCache.getToken()).resolves.toEqual({ token: 'refreshed-token' });
      expect(invalidRefresh).toHaveBeenCalledTimes(1);
    }
  });
});
