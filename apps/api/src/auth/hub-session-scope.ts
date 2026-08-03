/**
 * The async boundary the durable Hub BFF session store needs.
 *
 * `HubSessionStore` is synchronous, so every database read has to happen BEFORE
 * the BFF handler runs and every write AFTER it returns. This middleware is
 * that boundary: it reads the two BFF cookies, hydrates a request-scoped unit
 * of work, runs the handler inside it, and flushes on the way out.
 */
import { getCookie } from 'hono/cookie';
import type { MiddlewareHandler } from 'hono';
import {
  HubSessionStoreUnavailableError,
  type DurableHubSessionStore,
} from './hub-session-store.js';

// Mirrors @fxl-business/hub-sdk@1.2.0 dist/server.js:271-273. A future SDK bump
// must re-check those three lines; the unit test pins both names.
export const SESSION_COOKIE = 'fxl_hub_session';
export const SESSION_COOKIE_SECURE = '__Host-fxl_hub_session';
export const LOGIN_TX_COOKIE = 'fxl_hub_login';

/**
 * Derived from the SAME `secureCookies` boolean that is handed to
 * `createHubBff`, so the SDK's cookie name and our cookie read can never
 * disagree.
 */
export function hubSessionCookieName(secureCookies: boolean): string {
  return secureCookies ? SESSION_COOKIE_SECURE : SESSION_COOKIE;
}

export function createHubSessionScopeMiddleware(
  store: DurableHubSessionStore,
  options: { secureCookies: boolean },
): MiddlewareHandler {
  const sessionCookieName = hubSessionCookieName(options.secureCookies);

  return async (c, next) => {
    const sessionId = getCookie(c, sessionCookieName);
    const loginTxId = getCookie(c, LOGIN_TX_COOKIE);
    // /auth/callback is the only route that consumes a login transaction, so on
    // every other route the fxl_hub_login cookie is left untouched.
    const consumeLoginTx = c.req.path.endsWith('/auth/callback');

    try {
      await store.withRequest({ sessionId, loginTxId, consumeLoginTx }, async () => {
        await next();
      });
    } catch (err) {
      if (err instanceof HubSessionStoreUnavailableError) {
        // Deliberately NOT a degrade to an empty working set: the BFF would
        // then see store.get(...) === null, answer 401 no_session and DELETE
        // the session cookie, so a two-second database blip would permanently
        // log out every user. A 503 is honest and leaves the cookie intact.
        console.error('[hub-session-scope] session store unavailable', err);
        return c.json({ error: 'unavailable', code: 'session_store_unavailable' }, 503);
      }
      throw err;
    }
    return;
  };
}
