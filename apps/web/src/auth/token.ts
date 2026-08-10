import { parseJwtPayload } from './claims';
import { TRANSIENT_TOKEN_RESULT, type HubTokenResult } from './refresh';

export const ACCESS_TOKEN_EXPIRY_SKEW_MS = 30_000;

export type HubAccessTokenCache = {
  getToken: () => Promise<HubTokenResult>;
  /**
   * Forces a refresh even while the cached token is still servable, joining an in-flight
   * one rather than adding a second.
   *
   * It exists for the proactive renewal, which fires at `exp - SESSION_RENEWAL_LEAD_MS`
   * while `getToken` serves from memory until `exp - ACCESS_TOKEN_EXPIRY_SKEW_MS`. The
   * lead is deliberately the longer of the two, so a renewal driven through `getToken`
   * would be a guaranteed no-op: it would hand back the very token that is about to
   * expire and issue no request at all.
   */
  renew: () => Promise<HubTokenResult>;
  /**
   * The wall-clock ms at which the cached token expires, or `null` when nothing is
   * cached. The renewal scheduler needs the expiry the cache is actually serving
   * against - parsing the JWT a second time in the provider would be a second source of
   * truth for one fact, and would miss the `seed` path's server-expiry floor entirely.
   */
  expiresAt: () => number | null;
  seed: (accessToken: string, expiresInSeconds: number) => void;
  clear: () => void;
};

function readJwtExpiry(accessToken: string): number | null {
  const claims = parseJwtPayload(accessToken);
  if (!claims) return null;
  if (typeof claims.exp !== 'number' || !Number.isFinite(claims.exp)) return null;
  const expiresAt = claims.exp * 1_000;
  return Number.isFinite(expiresAt) ? expiresAt : null;
}

function readServerExpiry(expiresInSeconds: number): number | null {
  if (!Number.isFinite(expiresInSeconds) || expiresInSeconds <= 0) return null;
  const expiresAt = Date.now() + expiresInSeconds * 1_000;
  return Number.isFinite(expiresAt) ? expiresAt : null;
}

/**
 * Takes an injected refresher rather than the SDK client, so this module is the CACHE
 * and `refresh.ts` is the CLASSIFICATION. One seam each: nothing here reinterprets a
 * verdict, and nothing there remembers a token.
 */
export function createHubAccessTokenCache(
  refresh: () => Promise<HubTokenResult>,
): HubAccessTokenCache {
  let cachedToken: string | null = null;
  let cachedExpiresAt: number | null = null;
  let inFlight: Promise<HubTokenResult> | null = null;
  let generation = 0;

  const readFreshToken = () => {
    if (
      cachedToken !== null &&
      cachedExpiresAt !== null &&
      Date.now() < cachedExpiresAt - ACCESS_TOKEN_EXPIRY_SKEW_MS
    ) {
      return cachedToken;
    }
    return null;
  };

  const discardCachedToken = () => {
    cachedToken = null;
    cachedExpiresAt = null;
  };

  /**
   * The network half, shared by `getToken` (on a cache miss) and `renew` (unconditionally).
   * Coalescing lives here rather than in either caller, so a renewal that lands while a
   * consumer read is already in flight joins it instead of doubling the traffic.
   */
  const requestRefresh = (): Promise<HubTokenResult> => {
    if (inFlight) return inFlight;

    const refreshGeneration = generation;
    const refreshPromise = refresh()
      .then((result): HubTokenResult => {
        if (generation !== refreshGeneration) {
          // Superseded by a `seed` (workspace switch) or a `clear` (logout). A late
          // answer proves nothing about the CURRENT session, so it is never allowed
          // to report `session_expired` and tear one down.
          const current = readFreshToken();
          return current === null ? TRANSIENT_TOKEN_RESULT : { token: current };
        }
        if (result.token === null) {
          discardCachedToken();
          return result;
        }

        const jwtExpiry = readJwtExpiry(result.token);
        if (jwtExpiry !== null) {
          cachedToken = result.token;
          cachedExpiresAt = jwtExpiry;
        } else {
          discardCachedToken();
        }
        return result;
      })
      .finally(() => {
        if (inFlight === refreshPromise) inFlight = null;
      });
    inFlight = refreshPromise;
    return refreshPromise;
  };

  const getToken = (): Promise<HubTokenResult> => {
    const freshToken = readFreshToken();
    if (freshToken !== null) return Promise.resolve({ token: freshToken });
    return requestRefresh();
  };

  /**
   * A failed renewal DISCARDS the cached token, which `requestRefresh` already does for
   * every null result and which is the behaviour wanted here too: it is what makes the
   * provider's revalidation ladder a genuine retry. Keeping the still-servable token
   * instead would make every ladder rung answer from memory, "recover" vacuously, and
   * silently abandon the renewal with the token minutes from expiry.
   */
  const renew = (): Promise<HubTokenResult> => requestRefresh();

  const expiresAt = (): number | null => cachedExpiresAt;

  const seed = (accessToken: string, expiresInSeconds: number) => {
    generation += 1;
    inFlight = null;
    const jwtExpiry = readJwtExpiry(accessToken);
    const serverExpiry = readServerExpiry(expiresInSeconds);
    const validExpiries = [jwtExpiry, serverExpiry].filter(
      (value): value is number => value !== null,
    );

    if (validExpiries.length === 0) {
      discardCachedToken();
      return;
    }
    cachedToken = accessToken;
    cachedExpiresAt = Math.min(...validExpiries);
  };

  const clear = () => {
    generation += 1;
    inFlight = null;
    discardCachedToken();
  };

  return { getToken, renew, expiresAt, seed, clear };
}
