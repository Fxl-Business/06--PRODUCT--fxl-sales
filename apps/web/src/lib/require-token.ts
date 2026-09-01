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

/**
 * True for the 403 half of the deny taxonomy, and for nothing else.
 *
 * A 403 means the token is valid and the operator is correctly identified, and
 * they do not hold the membership, Seat, module or role the route requires. That
 * is neither a dead session nor a dead server, so it must reach neither
 * `Sessão expirada` nor "verifique o servidor local". `@fxl-business/hub-sdk@2.1.0`
 * answers `403 {error: 'forbidden', code: 'missing_module'}` and
 * `403 {error: 'forbidden', code: 'missing_role'}`; this repo's own
 * `requireHubModule` and `requireAdmin` answer 403 today.
 *
 * Keyed on the STATUS ALONE, exactly as `isEntitlementFailure` is, and for the same
 * asymmetry: `apiFetch` builds its error from `await res.json().catch(() => ({}))`,
 * so a 403 whose body does not parse - a proxy error page, a truncated response, a
 * gateway that rewrites the payload - carries no `code` at all. Requiring the code
 * would classify exactly that response as NOT forbidden and route it back onto the
 * server-outage copy this predicate exists to remove. Keying on the code fails
 * CLOSED onto that lie; keying on the status fails OPEN onto a panel that says
 * "peça a quem administra", which is true of every 403 this API can send.
 *
 * The predicate stays narrow otherwise: no `>= 400`, no error-string alternative,
 * strict `===`, and `null` and `undefined` handled by the object guard.
 */
export function isForbiddenFailure(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && (error as { status?: unknown }).status === 403
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
