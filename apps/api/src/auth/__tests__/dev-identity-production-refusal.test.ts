/**
 * ORACLE for the production refusal.
 *
 * Stubs `NODE_ENV=production` and `SALES_AUTH_FAKE=1`, with every Hub
 * variable blank, then `vi.resetModules()`. Both `installFakeAuthIfRequested`
 * and a direct `installAppAuthAdapter` call must refuse, throwing the SAME
 * exported constant, and the adapter slot must stay EMPTY: `appAuthMiddleware`
 * must still answer on the Hub path exactly as it does today.
 *
 * The third test is what makes this file a real oracle rather than a message
 * check: it proves the fake adapter did not take the slot, so deleting the
 * `isProductionEnv` throw turns it RED on a STATUS rather than only on a
 * string.
 */
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Proves the ORDERING half of the production refusal, not only the message:
// the production check in `installFakeAuthIfRequested` must run BEFORE the
// roster package is ever touched. If that check were deleted, execution would
// fall through to `await import('@fxl-sales/auth-fake')`, hit this mock, and
// reject with a DIFFERENT message than
// `DEV_IDENTITY_ADAPTER_IN_PRODUCTION_MESSAGE` - which is exactly what turns
// the first test below RED under that mutation, even though
// `installAppAuthAdapter`'s own independent guard would otherwise mask the
// deletion by throwing the identical string from a different call site.
vi.mock('@fxl-sales/auth-fake', () => {
  throw new Error(
    'dev-identity-production-refusal: the fake roster package must never be imported before the production check has run',
  );
});

async function freshModules() {
  vi.resetModules();

  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('SALES_AUTH_FAKE', '1');
  vi.stubEnv('CORS_ORIGIN', 'http://localhost:8006');
  vi.stubEnv('DATABASE_URL', 'postgresql://postgres:postgres@localhost:5006/fxl_sales_wiring_test');
  vi.stubEnv('ADMIN_DATABASE_URL', '');
  // Every Hub variable blank, so the module graph loads cleanly (no boot
  // failure) and the Hub path answers its own 503 rather than throwing on
  // import - the production refusal must be provable independent of that.
  vi.stubEnv('FXL_HUB_CONFIG', '');
  vi.stubEnv('FXL_HUB_API_URL', '');
  vi.stubEnv('FXL_HUB_ENVIRONMENT', '');
  vi.stubEnv('FXL_HUB_CLIENT_ID', '');
  vi.stubEnv('FXL_HUB_CLIENT_SECRET', '');
  vi.stubEnv('FXL_HUB_AUDIENCE', '');
  vi.stubEnv('FXL_HUB_HEALTH_TOKEN', '');
  vi.stubEnv('FXL_HUB_REDIRECT_URI', '');
  vi.stubEnv('FXL_HUB_TRUSTED_ORIGINS', '');
  vi.stubEnv('SALES_POST_LOGIN_REDIRECT', '');
  vi.stubEnv('SALES_POST_LOGIN_ERROR_REDIRECT', '');
  vi.stubEnv('SALES_SESSION_ENCRYPTION_IKM', '');
}

beforeEach(async () => {
  await freshModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('the development identity adapter under NODE_ENV=production', () => {
  it('refuses to install the development identity adapter under NODE_ENV=production', async () => {
    const { installFakeAuthIfRequested } = await import('../select.js');
    const { DEV_IDENTITY_ADAPTER_IN_PRODUCTION_MESSAGE } = await import(
      '../../middleware/app-auth.js'
    );

    await expect(installFakeAuthIfRequested()).rejects.toThrow();
    await expect(installFakeAuthIfRequested()).rejects.toMatchObject({
      message: DEV_IDENTITY_ADAPTER_IN_PRODUCTION_MESSAGE,
    });
  });

  it('refuses a direct installAppAuthAdapter call too, so the slot is not safe only because the caller checked first', async () => {
    const { installAppAuthAdapter, DEV_IDENTITY_ADAPTER_IN_PRODUCTION_MESSAGE } = await import(
      '../../middleware/app-auth.js'
    );

    let thrown: unknown;
    try {
      installAppAuthAdapter(async (_c, next) => {
        await next();
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe(DEV_IDENTITY_ADAPTER_IN_PRODUCTION_MESSAGE);
  });

  it('leaves the adapter slot empty, so appAuthMiddleware still answers on the Hub path', async () => {
    const { installFakeAuthIfRequested } = await import('../select.js');
    const appAuth = await import('../../middleware/app-auth.js');

    await expect(installFakeAuthIfRequested()).rejects.toThrow();

    const app = new Hono();
    app.use('/probe', appAuth.appAuthMiddleware);
    app.get('/probe', (c) => c.json({ ok: true }));

    const res = await app.request('http://localhost/probe');
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({
      error: 'unavailable',
      code: 'hub_auth_not_configured',
    });
  });
});
