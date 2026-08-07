/**
 * The one place the browser asks the Hub BFF for an access token, and the one
 * place a refresh failure is classified.
 *
 * WHY THIS BYPASSES THE SDK CLIENT. `@fxl-business/hub-sdk@1.3.0` classifies
 * refresh failures at the BFF - a `401` means the session is dead, a `503`
 * (`refresh_unavailable`) and a `502` (`invalid_refresh_response`) are transient
 * and must be retried - but `HubClient.getToken()` still declares
 * `Promise<string | null>` and discards `res.status` before any consumer sees it
 * (`dist/client.js`, the `if (res.status !== 200) return null` branch). The
 * classification is unreachable through the client, so this module issues the
 * request itself.
 *
 * COUPLING, STATED LOUDLY. This module hard-codes two things the SDK also
 * hard-codes: the path `<bffBasePath>/auth/refresh` and `credentials: 'include'`.
 * They are the BFF's public HTTP contract, documented by the status table in the
 * SDK's MIGRATION.md, not SDK internals - and `bffBasePath` comes from the SAME
 * `getHubBffBasePath` call that is handed to `createHubClient`, so the two cannot
 * resolve to different origins. If a future SDK changes the method, the path or
 * the credential mode of `/auth/refresh`, THIS FILE MUST CHANGE WITH IT.
 * `__tests__/refresh.test.ts` pins the request shape, and
 * `apps/api/src/middleware/__tests__/app-auth-bff-wiring.test.ts` pins that the
 * REAL SDK router still answers that exact path, so such a change lands as a red
 * test rather than as a silent 404 that would read as a Hub outage.
 */

/**
 * Why a refresh produced no token.
 *
 * `session_expired` is the BFF's own `401` verdict and is the ONLY outcome that
 * proves the session is dead. Everything else is `transient`: it must preserve
 * the session and be retried.
 */
export type HubRefreshFailure = 'session_expired' | 'transient';

export type HubTokenResult = { token: string } | { token: null; failure: HubRefreshFailure };

/** Shared, so the several "this should be impossible" sites cannot disagree. */
export const TRANSIENT_TOKEN_RESULT: HubTokenResult = Object.freeze({
  token: null,
  failure: 'transient',
} as const);

function readAccessToken(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const accessToken = (body as { accessToken?: unknown }).accessToken;
  return typeof accessToken === 'string' && accessToken.length > 0 ? accessToken : null;
}

export async function requestHubAccessToken(
  bffBasePath: string,
  fetchImpl: typeof fetch = (input, init) => fetch(input, init),
): Promise<HubTokenResult> {
  let res: Response;
  try {
    res = await fetchImpl(`${bffBasePath}/auth/refresh`, {
      method: 'POST',
      credentials: 'include',
    });
  } catch {
    // The network threw. Indistinguishable from a Hub outage, so: transient.
    return TRANSIENT_TOKEN_RESULT;
  }

  /*
    Classified on the STATUS ALONE, deliberately. 1.3.0 answers `401` with TWO
    different bodies - `{error:'session_expired'}` when the Hub revoked the family,
    `{error:'no_session'}` when there is no cookie or the record has expired - and
    both mean exactly one thing here: sign in again. Reading the body would add a
    branch with no consumer, and would make a body-less 401 from a proxy read as
    transient, which is the wrong way round.
  */
  if (res.status === 401) return { token: null, failure: 'session_expired' };
  // A 503 `refresh_unavailable`, a 502 `invalid_refresh_response`, and the 500 an
  // unhandled store failure would produce all land here. Preserve; retry.
  if (res.status !== 200) return TRANSIENT_TOKEN_RESULT;

  const body = await res.json().catch(() => null);
  const token = readAccessToken(body);
  // A 200 whose body is not a refresh response is our own bug or a proxy's, never
  // a verdict on the session.
  return token === null ? TRANSIENT_TOKEN_RESULT : { token };
}
