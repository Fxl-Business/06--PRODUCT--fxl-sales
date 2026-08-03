/**
 * Pins the failure semantics of the hydrate/flush boundary.
 *
 * The load-bearing rule is the 503: the middleware must NOT degrade a hydrate
 * failure to an empty working set, because the BFF would then see
 * `store.get(...) === null`, answer `401 no_session` and DELETE the session
 * cookie (@fxl-business/hub-sdk@1.2.0 dist/server.js:382-384). A two-second
 * database blip would permanently log out every user. The tests below mount the
 * REAL middleware in a REAL Hono app behind a route that mimics that
 * cookie-deleting 401, so a degrade would be visible as both a 200/401 and a
 * Set-Cookie header rather than as a passing test.
 */
import { Hono } from 'hono';
import { deleteCookie } from 'hono/cookie';
import { describe, expect, it, vi } from 'vitest';
import { createHubSessionScopeMiddleware } from '../hub-session-scope.js';
import {
  HubSessionStoreUnavailableError,
  type DurableHubSessionStore,
  type HubSessionHydrateInput,
} from '../hub-session-store.js';

function outsideScope(): never {
  throw new Error('no store method may run outside withRequest in these tests');
}

/** A store whose hydrate always fails, i.e. the database is down. */
function makeStore(
  withRequest: DurableHubSessionStore['withRequest'],
): DurableHubSessionStore {
  return {
    create: outsideScope,
    get: outsideScope,
    update: outsideScope,
    delete: outsideScope,
    createLogin: outsideScope,
    consumeLogin: outsideScope,
    withRequest,
  };
}

/**
 * The SDK's own cookie-deleting 401, reproduced. If the middleware ever
 * degrades instead of answering 503, THIS is what runs.
 */
function appWith(store: DurableHubSessionStore, secureCookies = false) {
  const downstream = vi.fn();
  const app = new Hono();
  app.use('/auth/*', createHubSessionScopeMiddleware(store, { secureCookies }));
  app.all('/auth/*', (c) => {
    downstream();
    deleteCookie(c, secureCookies ? '__Host-fxl_hub_session' : 'fxl_hub_session', {
      path: '/',
      secure: secureCookies,
    });
    return c.json({ error: 'no_session' }, 401);
  });
  return { app, downstream };
}

describe('hub session scope middleware, database outage', () => {
  it('answers 503 and never deletes the session cookie when hydrate fails', async () => {
    const store = makeStore(async () => {
      throw new HubSessionStoreUnavailableError('hub session hydrate failed');
    });
    const { app, downstream } = appWith(store);

    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await app.request('http://localhost/auth/refresh', {
      headers: { cookie: 'fxl_hub_session=session-alpha' },
    });
    error.mockRestore();

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'unavailable', code: 'session_store_unavailable' });
    // The downstream BFF handler never ran, so it never got the chance to read
    // an empty working set and log the user out.
    expect(downstream).not.toHaveBeenCalled();
    // The decisive assertion: no cookie teardown of any kind.
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('rethrows anything that is not a store-unavailable error', async () => {
    const store = makeStore(async () => {
      throw new Error('some other failure');
    });
    const { app } = appWith(store);
    app.onError((err, c) => c.json({ caught: (err as Error).message }, 500));

    const res = await app.request('http://localhost/auth/refresh');
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ caught: 'some other failure' });
  });
});

describe('hub session scope middleware, hydrate input', () => {
  function recordingStore() {
    const inputs: HubSessionHydrateInput[] = [];
    const store = makeStore(async (input, fn) => {
      inputs.push(input);
      return fn();
    });
    return { store, inputs };
  }

  it('consumes the login transaction only on /auth/callback', async () => {
    const { store, inputs } = recordingStore();
    const { app } = appWith(store);

    await app.request('http://localhost/auth/callback', {
      headers: { cookie: 'fxl_hub_session=session-alpha; fxl_hub_login=login-alpha' },
    });
    await app.request('http://localhost/auth/refresh', {
      headers: { cookie: 'fxl_hub_session=session-alpha; fxl_hub_login=login-alpha' },
    });

    expect(inputs).toEqual([
      { sessionId: 'session-alpha', loginTxId: 'login-alpha', consumeLoginTx: true },
      { sessionId: 'session-alpha', loginTxId: 'login-alpha', consumeLoginTx: false },
    ]);
  });

  it('reads the __Host- cookie when secureCookies is on', async () => {
    const { store, inputs } = recordingStore();
    const { app } = appWith(store, true);

    await app.request('http://localhost/auth/refresh', {
      headers: { cookie: '__Host-fxl_hub_session=session-alpha; fxl_hub_session=wrong-one' },
    });

    expect(inputs[0]?.sessionId).toBe('session-alpha');
  });
});
