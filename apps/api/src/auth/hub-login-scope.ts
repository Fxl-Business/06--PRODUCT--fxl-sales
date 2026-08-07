/**
 * Carries the session id the browser presented at `/auth/callback` down to the
 * `create()` the SDK makes from inside its own handler.
 *
 * WHY A SIDE CHANNEL. `store.create` is invoked BY the SDK, from inside
 * `createHubBff`'s `/auth/callback` handler (`@fxl-business/hub-sdk@1.3.0`
 * dist/server.js:407-413). There is no argument to add and no `createHubBff`
 * option that would carry one, so an `AsyncLocalStorage` is the only mechanism
 * available. A request-keyed `Map` would be strictly worse: it would need a key
 * the SDK also does not give us, plus its own eviction.
 *
 * THIS IS NOT A RESURRECTION of the deleted `hub-session-scope.ts`. That
 * middleware existed because the 1.2.0 `HubSessionStore` was synchronous: it read
 * rows out of Postgres before the handler, held a mutable working set across it,
 * flushed in a transaction afterwards, and needed its own `503` because an empty
 * working set would have logged every user out. This one carries a single string,
 * performs no I/O, holds no lock, hydrates nothing, and has no failure mode. The
 * `CLAUDE.md` paragraph forbidding a working set still stands.
 *
 * Mounted on `/auth/callback` ONLY. That is provably complete - `store.create`
 * has exactly one call site in the whole SDK bundle and it is in that handler -
 * and it means `/auth/refresh` and `/auth/logout` cannot accidentally acquire a
 * supersede context.
 */
import type { MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import type { DurableHubSessionStore } from './hub-session-store.js';

// Mirrors @fxl-business/hub-sdk@1.3.0 dist/server.js:275-277, unchanged from
// 1.2.0's 271-273. A future SDK bump must re-check those lines; the behavioural
// pin lives in app-auth-bff-wiring.test.ts, which asserts the REAL SDK reads the
// same cookie our middleware does.
export const SESSION_COOKIE = 'fxl_hub_session';
export const SESSION_COOKIE_SECURE = '__Host-fxl_hub_session';

/**
 * Derived from the SAME `secureCookies` boolean handed to `createHubBff`, so the
 * SDK's cookie name and our read can never disagree.
 */
export function hubSessionCookieName(secureCookies: boolean): string {
  return secureCookies ? SESSION_COOKIE_SECURE : SESSION_COOKIE;
}

export function createHubLoginSupersedeMiddleware(
  store: DurableHubSessionStore,
  options: { secureCookies: boolean },
): MiddlewareHandler {
  const sessionCookieName = hubSessionCookieName(options.secureCookies);

  return async (c, next) => {
    // The cookie is HttpOnly, SameSite=Lax, Path=/, and /auth/callback is a
    // top-level GET navigation - which Lax permits even though the Hub's
    // redirect initiated it cross-site. So the prior session id for THIS browser
    // is knowable at exactly the moment a new session is minted.
    const priorSessionId = getCookie(c, sessionCookieName);
    await store.withLoginContext({ priorSessionId }, async () => {
      await next();
    });
  };
}
