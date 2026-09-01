import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import {
  SESSION_COOKIE,
  SESSION_COOKIE_SECURE,
  createHubLoginSupersedeMiddleware,
  hubSessionCookieName,
} from '../hub-login-scope.js';
import type { DurableHubSessionStore, HubLoginContext } from '../hub-session-store.js';

/**
 * A store that records the login contexts it is handed and otherwise does
 * nothing. No database is needed: what is under test is which cookie is read and
 * that the downstream handler runs INSIDE the context, not what the store does
 * with it.
 */
function probeStore() {
  const seen: HubLoginContext[] = [];
  const store: DurableHubSessionStore = {
    kind: 'persistent',
    create: async () => 'session-new',
    withSession: async () => null as never,
    createLoginTransaction: async () => 'login-new',
    consumeLoginTransaction: async () => null,
    withLoginContext: async (context, fn) => {
      seen.push(context);
      return fn();
    },
  };
  return { seen, store };
}

function appWith(store: DurableHubSessionStore, secureCookies: boolean) {
  const app = new Hono();
  let ranInside = false;
  app.use('/auth/callback', createHubLoginSupersedeMiddleware(store, { secureCookies }));
  app.get('/auth/callback', (c) => {
    ranInside = true;
    return c.text('callback');
  });
  app.post('/auth/refresh', (c) => c.text('refresh'));
  return { app, ranInside: () => ranInside };
}

describe('createHubLoginSupersedeMiddleware', () => {
  it('captures the prior session id from the session cookie on /auth/callback', async () => {
    const { seen, store } = probeStore();
    const { app, ranInside } = appWith(store, false);

    const res = await app.request('http://localhost/auth/callback?state=x', {
      headers: { cookie: `${SESSION_COOKIE}=sid-prior; fxl_hub_login=login-alpha` },
    });

    expect(res.status).toBe(200);
    // The handler must run INSIDE the context, not after it: `store.create` is
    // called from the SDK handler this middleware wraps.
    expect(ranInside()).toBe(true);
    expect(seen).toEqual([{ priorSessionId: 'sid-prior' }]);
  });

  it('captures nothing on a request that carries no session cookie', async () => {
    // A fresh browser. The context is still established - absence of a prior id
    // is never an error, it just means there is nothing to supersede.
    const { seen, store } = probeStore();
    const { app, ranInside } = appWith(store, false);

    const res = await app.request('http://localhost/auth/callback?state=x', {
      headers: { cookie: 'fxl_hub_login=login-alpha' },
    });

    expect(res.status).toBe(200);
    expect(ranInside()).toBe(true);
    expect(seen).toEqual([{ priorSessionId: undefined }]);
  });

  it('reads __Host-fxl_hub_session when secureCookies is true', async () => {
    // Derived from the SAME boolean handed to createHubBff, so the SDK's cookie
    // name and our read cannot disagree. Both names mirror
    // @fxl-business/hub-sdk@1.3.0 dist/server.js:275-277, re-checked for 1.3.0.
    expect(SESSION_COOKIE).toBe('fxl_hub_session');
    expect(SESSION_COOKIE_SECURE).toBe('__Host-fxl_hub_session');
    expect(hubSessionCookieName(true)).toBe(SESSION_COOKIE_SECURE);
    expect(hubSessionCookieName(false)).toBe(SESSION_COOKIE);

    const { seen, store } = probeStore();
    const { app } = appWith(store, true);

    await app.request('http://localhost/auth/callback?state=x', {
      headers: { cookie: `${SESSION_COOKIE_SECURE}=right; ${SESSION_COOKIE}=wrong` },
    });

    expect(seen).toEqual([{ priorSessionId: 'right' }]);
  });

  it('is not established on any route but /auth/callback', async () => {
    // store.create is called from exactly one place in the whole SDK bundle
    // (dist/server.js:408, inside /auth/callback), so a context anywhere else
    // could only ever mislead a future reader.
    const { seen, store } = probeStore();
    const { app } = appWith(store, false);

    const res = await app.request('http://localhost/auth/refresh', {
      method: 'POST',
      headers: { cookie: `${SESSION_COOKIE}=sid-prior` },
    });

    expect(res.status).toBe(200);
    expect(seen).toEqual([]);
  });
});
