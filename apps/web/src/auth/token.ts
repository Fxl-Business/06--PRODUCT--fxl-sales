import type { HubClient } from '@fxl-business/hub-sdk/client';
import { parseJwtPayload } from './claims';

export const ACCESS_TOKEN_EXPIRY_SKEW_MS = 30_000;

export type HubAccessTokenCache = {
  getToken: () => Promise<string | null>;
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

export function createHubAccessTokenCache(
  client: Pick<HubClient, 'getToken'>,
): HubAccessTokenCache {
  let cachedToken: string | null = null;
  let expiresAt: number | null = null;
  let inFlight: Promise<string | null> | null = null;
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

  const getToken = (): Promise<string | null> => {
    const freshToken = readFreshToken();
    if (freshToken !== null) return Promise.resolve(freshToken);
    if (inFlight) return inFlight;

    const refreshGeneration = generation;
    const refreshPromise = client
      .getToken()
      .then((accessToken) => {
        if (generation !== refreshGeneration) return readFreshToken();
        if (accessToken === null) {
          discardCachedToken();
          return null;
        }

        const jwtExpiry = readJwtExpiry(accessToken);
        if (jwtExpiry !== null) {
          cachedToken = accessToken;
          expiresAt = jwtExpiry;
        } else {
          discardCachedToken();
        }
        return accessToken;
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
