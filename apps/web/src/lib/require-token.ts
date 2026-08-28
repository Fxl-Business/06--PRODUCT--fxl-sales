/**
 * The one door between "the auth layer may not have a token" and "this request
 * carries a bearer token".
 *
 * Before this module, `(await getToken()) ?? ""` was copy-pasted at 37 call
 * sites. `apiFetch` treats `''` as falsy and omits the Authorization header
 * entirely, so a missing token produced an anonymous request, a 401, and a
 * generic "the API is broken" panel - an auth failure displayed as a server
 * fault. A missing token now throws before any request is built.
 *
 * This module imports NOTHING, and must keep importing nothing: `api-client.ts`
 * imports it, so any import back the other way is a cycle. That is why the 401
 * branch of `isAuthFailure` duck-types instead of importing `ApiError`.
 */

const AUTH_TOKEN_UNAVAILABLE = 'AuthTokenUnavailableError';

export class AuthTokenUnavailableError extends Error {
  constructor(message = 'Nenhum token de acesso do Hub disponível para esta requisição.') {
    super(message);
    this.name = AUTH_TOKEN_UNAVAILABLE;
  }
}

/**
 * Name-based as well as `instanceof`, so a duplicated module instance (HMR, a
 * second bundle chunk) cannot make a real auth failure read as an API fault.
 */
export function isAuthTokenUnavailableError(error: unknown): error is AuthTokenUnavailableError {
  if (error instanceof AuthTokenUnavailableError) return true;
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === AUTH_TOKEN_UNAVAILABLE
  );
}

/**
 * True for both halves of an auth failure: no token was available (this slice),
 * and a token was sent but rejected (a stale access token). Both must read as
 * "your session ended", never as "the server is down".
 */
export function isAuthFailure(error: unknown): boolean {
  if (isAuthTokenUnavailableError(error)) return true;
  return (
    typeof error === 'object' && error !== null && (error as { status?: unknown }).status === 401
  );
}

/**
 * True for the entitlement gate's 402, and for nothing else.
 *
 * `apps/api/src/middleware/app-auth.ts` answers
 * `402 {error: 'payment_required', code: 'missing_entitlement'}` when the active
 * Hub Organization does not carry FXL Sales. That 402 is CORRECT; what was wrong
 * was that nothing could tell it apart from a dead server, so it rendered as
 * "verifique o servidor local".
 *
 * It keys on the STATUS alone. That 402 is the only 402 this API emits, so `code`
 * adds no discrimination, and requiring it would fail closed: an older API build,
 * or a 402 whose body does not parse, carries no `code` and would silently land
 * back on the server-fault copy. `ApiError.code` is preserved for reading, not
 * for branching. The predicate stays deliberately narrow - `status === 402` and
 * nothing looser - because only this one failure may reach the entitlement panel.
 *
 * Duck-typed rather than `instanceof ApiError`, for the reason given at the top
 * of this file: importing api-client.ts back would be a cycle.
 */
export function isEntitlementFailure(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { status?: unknown }).status === 402
  );
}

/** TypeScript cannot express "non-empty string", so emptiness is a runtime check. */
export function assertBearerToken(token: unknown): asserts token is string {
  if (typeof token !== 'string' || token.trim() === '') {
    throw new AuthTokenUnavailableError();
  }
}

export async function requireToken(getToken: () => Promise<string | null>): Promise<string> {
  const token = await getToken();
  assertBearerToken(token);
  return token;
}
