/**
 * Pins the BFF router's error handler, which is the only place the
 * session-store 503 comes from now that the hydrate/flush middleware is gone.
 *
 * The load-bearing rule is unchanged: a store outage must NOT read as "no
 * session", because the SDK would then answer `401 no_session` and DELETE the
 * session cookie (@fxl-business/hub-sdk@1.3.0 dist/server.js:467), so a
 * two-second database blip would permanently log out every user. The stand-in
 * sub-app below reproduces that exact cookie-deleting 401 on its non-throwing
 * branch, so a degrade is visible as a `Set-Cookie` rather than as a green test.
 */
import { Hono } from 'hono';
import { deleteCookie } from 'hono/cookie';
import { HTTPException } from 'hono/http-exception';
import { describe, expect, it, vi } from 'vitest';
import { hubBffErrorHandler } from '../hub-bff-errors.js';
import { HubSessionStoreUnavailableError } from '../hub-session-store.js';

/** Stands in for the SDK's /auth/refresh: it reads the store, then branches. */
function bffLike(load: () => Promise<string | null>) {
  const sub = new Hono();
  sub.all('/auth/refresh', async (c) => {
    const token = await load();
    if (token === null) {
      // The SDK's own degrade path, reproduced.
      deleteCookie(c, 'fxl_hub_session', { path: '/' });
      return c.json({ error: 'no_session' }, 401);
    }
    return c.json({ ok: true });
  });
  return sub;
}

function routerWith(load: () => Promise<string | null>) {
  const router = new Hono();
  router.onError(hubBffErrorHandler);
  router.route('', bffLike(load));
  return router;
}

const storeIsDown = async (): Promise<string | null> => {
  throw new HubSessionStoreUnavailableError('hub session transaction failed');
};

describe('hubBffErrorHandler', () => {
  it('answers 503 with the session cookie intact when the store is unavailable, through the double route() mount server.ts uses', async () => {
    // THE CONSTRAINT-2 ORACLE. Requesting the router directly would pass even
    // if `app.route` had dropped the handler, because a directly-requested
    // router composes with its own errorHandler. Going through the outer
    // `app.route('', router)` is what reproduces server.ts:33 and makes this
    // assertion non-vacuous.
    const router = routerWith(storeIsDown);
    const app = new Hono();
    app.route('', router);

    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    let res: Response;
    try {
      res = await app.request('http://localhost/auth/refresh', {
        method: 'POST',
        headers: { cookie: 'fxl_hub_session=session-alpha' },
      });
    } finally {
      errorLog.mockRestore();
    }

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'unavailable', code: 'session_store_unavailable' });
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('answers 503 when the router is requested directly as well', async () => {
    const router = routerWith(storeIsDown);

    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    let res: Response;
    try {
      res = await router.request('http://localhost/auth/refresh', { method: 'POST' });
    } finally {
      errorLog.mockRestore();
    }

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'unavailable', code: 'session_store_unavailable' });
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('leaves any other error as a plain 500 and never claims session_store_unavailable', async () => {
    const router = routerWith(async () => {
      throw new Error('some other failure');
    });
    const app = new Hono();
    app.route('', router);

    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    let res: Response;
    try {
      res = await app.request('http://localhost/auth/refresh', { method: 'POST' });
    } finally {
      errorLog.mockRestore();
    }

    expect(res.status).toBe(500);
    const body = await res.text();
    expect(body).toBe('Internal Server Error');
    expect(body).not.toContain('session_store_unavailable');
  });

  it('reproduces hono default handling for an error that carries its own response', async () => {
    const router = routerWith(async () => {
      throw new HTTPException(403, { message: 'forbidden by the sub-app' });
    });
    const app = new Hono();
    app.route('', router);

    const res = await app.request('http://localhost/auth/refresh', { method: 'POST' });

    expect(res.status).toBe(403);
    expect(await res.text()).toBe('forbidden by the sub-app');
  });

  it('degrading to a null store read instead of throwing would be visible as a cookie-clearing 401', async () => {
    // The anti-oracle for the test above: this is exactly what the 503 exists to
    // prevent, so it is asserted here rather than left implicit.
    const router = routerWith(async () => null);
    const app = new Hono();
    app.route('', router);

    const res = await app.request('http://localhost/auth/refresh', { method: 'POST' });

    expect(res.status).toBe(401);
    expect(res.headers.get('set-cookie')).not.toBeNull();
  });
});
