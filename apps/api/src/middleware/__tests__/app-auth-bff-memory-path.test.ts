/**
 * The MEMORY-fallback branch of `createAppAuthBff()`, which nothing else covers.
 *
 * Since slice 01 there is no `if (session.kind === 'memory') return bff;` early
 * return: both stores flow through the same router. So anything mounted on that
 * router is handed the SDK's `InMemoryHubSessionStore` on a local dev machine
 * without `DATABASE_URL`, and that store has exactly the four interface members -
 * no `withLoginContext`. An unnarrowed slice-06 mount would therefore make every
 * `/auth/callback` throw `TypeError: store.withLoginContext is not a function`,
 * which `hubBffErrorHandler` turns into a bare 500 with no clue what happened.
 *
 * This lives in its own file rather than in `app-auth-bff-wiring.test.ts`
 * because it needs a DIFFERENT module graph (`DATABASE_URL` unset), and vitest
 * isolates per file. Re-resetting modules inside that file would overwrite the
 * captures its other tests assert on.
 */
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * Obviously synthetic fixtures. The secret is long enough to clear the sealer's
 * 32-character floor on its own.
 */
const HUB_CLIENT_ID = 'pk_fxl-sales_development_unit-test-only-0123456789';
const HUB_CLIENT_SECRET = 'sk_fxl-sales_development_unit-test-only-not-a-real-secret-0123456789';

let sessionStoreKind: string | undefined;
let authBff: Hono | null = null;
let warned: ReturnType<typeof vi.spyOn> | undefined;

beforeAll(async () => {
  vi.resetModules();

  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('CORS_ORIGIN', 'http://localhost:8006');
  // The whole point of this file: no database, so createHubSessionStore falls
  // back to the SDK's in-memory store. `env.ts` maps '' to undefined.
  vi.stubEnv('DATABASE_URL', '');
  vi.stubEnv('ADMIN_DATABASE_URL', '');
  vi.stubEnv('FXL_HUB_API_URL', 'http://localhost:9016');
  // NODE_ENV is stubbed to 'test' in this very block, so this file is a live
  // demonstration that the Hub environment and the process environment are
  // independent: the Hub environment is explicit configuration and is never
  // inferred.
  vi.stubEnv('FXL_HUB_ENVIRONMENT', 'development');
  vi.stubEnv('FXL_HUB_CLIENT_ID', HUB_CLIENT_ID);
  vi.stubEnv('FXL_HUB_CLIENT_SECRET', HUB_CLIENT_SECRET);
  vi.stubEnv('FXL_HUB_AUDIENCE', 'app.fxl-sales');
  // Blank reads as unset. A developer's own apps/api/.env could otherwise carry
  // the JSON form and make this file throw on ambiguity at import.
  vi.stubEnv('FXL_HUB_CONFIG', '');
  vi.stubEnv('FXL_HUB_REDIRECT_URI', 'http://localhost:8006/auth/callback');
  vi.stubEnv('FXL_HUB_POST_LOGIN_REDIRECT', 'http://localhost:8006');
  vi.stubEnv('FXL_HUB_POST_LOGIN_ERROR_REDIRECT', 'http://localhost:8006/?error=auth');
  vi.stubEnv('HUB_SESSION_ENCRYPTION_KEY', '');

  vi.doMock('../../auth/hub-session-store.js', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../auth/hub-session-store.js')>();
    return {
      ...actual,
      createHubSessionStore: (deps: Parameters<typeof actual.createHubSessionStore>[0]) => {
        const result = actual.createHubSessionStore(deps);
        sessionStoreKind = result.kind;
        return result;
      },
    };
  });

  // The memory fallback warns loudly on purpose; keep the run quiet.
  warned = vi.spyOn(console, 'warn').mockImplementation(() => {});

  const appAuth = await import('../app-auth.js');
  authBff = appAuth.createAppAuthBff() as Hono | null;
});

afterAll(() => {
  warned?.mockRestore();
  vi.doUnmock('../../auth/hub-session-store.js');
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('createAppAuthBff without DATABASE_URL', () => {
  it('falls back to the SDK in-memory store', () => {
    expect(sessionStoreKind).toBe('memory');
    expect(authBff).not.toBeNull();
  });

  it('still serves /auth/callback without throwing', async () => {
    // 302 to the post-login ERROR redirect, because there is no login
    // transaction cookie - dist/server.js:377. What matters is that it is not a
    // 500: the memory store has no withLoginContext, so mounting the supersede
    // middleware unconditionally reads exactly like a broken auth deploy on
    // every local machine without a database.
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    let res: Response;
    try {
      res = await authBff!.request('http://localhost/auth/callback?state=x&code=abc', {
        headers: { cookie: 'fxl_hub_session=sid-prior; fxl_hub_login=login-alpha' },
      });
    } finally {
      errorLog.mockRestore();
    }

    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('http://localhost:8006/?error=auth');
  });
});
