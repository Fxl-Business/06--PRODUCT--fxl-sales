import type { ErrorHandler } from 'hono';
import { HubSessionStoreUnavailableError } from './hub-session-store.js';

/**
 * The BFF router's error handler, and the only place the session-store 503 comes
 * from now that the hydrate/flush middleware is gone.
 *
 * It has to be an `onError` and not a middleware: hono's `compose` catches a
 * thrown error at the dispatch level that threw and resolves upward, so an
 * upstream middleware's `try { await next() } catch` never fires.
 *
 * The 503 is load-bearing. A store outage must not read as "no session": the SDK
 * would answer 401 and delete the session cookie, and a two-second database blip
 * would permanently log out every user. The SDK already declines to do that - it
 * never catches a store throw (1.3.0 dist/server.js:422, 481, 535, 552) - but
 * without this handler the honest failure is a bare 500.
 *
 * Every other error reproduces hono's default handler byte for byte, so mounting
 * this changes nothing outside the store-outage branch. `getResponse` is
 * duck-typed rather than reached through an `HTTPException` import for exactly
 * that reason: it is what `hono-base.js`'s default handler does.
 */
export const hubBffErrorHandler: ErrorHandler = (err, c) => {
  if (err instanceof HubSessionStoreUnavailableError) {
    console.error('[hub-bff] session store unavailable', err);
    return c.json({ error: 'unavailable', code: 'session_store_unavailable' }, 503);
  }
  if ('getResponse' in err) {
    const res = (err as unknown as { getResponse(): Response }).getResponse();
    return c.newResponse(res.body, res);
  }
  console.error(err);
  return c.text('Internal Server Error', 500);
};
