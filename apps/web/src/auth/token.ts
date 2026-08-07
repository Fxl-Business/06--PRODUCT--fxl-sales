import { parseJwtPayload } from './claims';
import { TRANSIENT_TOKEN_RESULT, type HubTokenResult } from './refresh';

export const ACCESS_TOKEN_EXPIRY_SKEW_MS = 30_000;

export type HubAccessTokenCache = {
  getToken: () => Promise<HubTokenResult>;
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
  let expiresAt: number | null = null;
  let inFlight: Promise<HubTokenResult> | null = null;
  let generation = 0;

  const readFreshToken = () => {
    if (
      cachedToken !== null &&
      expiresAt !== null &&
      Date.now() < expiresAt - ACCESS_TOKEN_EXPIRY_SKEW_MS
    ) {
      return cachedToken;
    }
    return null;
  };

  const discardCachedToken = () => {
    cachedToken = null;
    expiresAt = null;
  };

  const getToken = (): Promise<HubTokenResult> => {
    const freshToken = readFreshToken();
    if (freshToken !== null) return Promise.resolve({ token: freshToken });
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
          expiresAt = jwtExpiry;
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
    expiresAt = Math.min(...validExpiries);
  };

  const clear = () => {
    generation += 1;
    inFlight = null;
    discardCachedToken();
  };

  return { getToken, seed, clear };
}
