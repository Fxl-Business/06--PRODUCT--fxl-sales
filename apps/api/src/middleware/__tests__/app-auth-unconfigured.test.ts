/**
 * The `503 hub_auth_not_configured` branch of `appAuthMiddleware`, which is what a
 * fresh clone with no Hub credentials must answer.
 *
 * Its own file because it needs a DIFFERENT module graph from every other app-auth
 * test - no Hub configuration at all - and vitest isolates per file. That is the
 * same reason `app-auth-bff-memory-path.test.ts` is its own file.
 *
 * A bad Hub configuration is a BOOT FAILURE and not a 503; this covers the other
 * case, the machine that has simply not been given credentials yet, where
 * `tryLoadHubAuthConfig` answers null and the middleware must refuse rather than
 * fall through to a 401, a 402 or an allow.
 */
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

let app: Hono;

beforeAll(async () => {
  vi.resetModules();

  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('CORS_ORIGIN', 'http://localhost:8006');
  vi.stubEnv('DATABASE_URL', 'postgresql://postgres:postgres@localhost:5006/fxl_sales_wiring_test');
  vi.stubEnv('ADMIN_DATABASE_URL', '');
  // Every Hub variable blank, so `hubConfigPresence` is `absent` and
  // `tryLoadHubAuthConfig` returns null WITHOUT throwing. Blank reads as unset.
  vi.stubEnv('FXL_HUB_CONFIG', '');
  vi.stubEnv('FXL_HUB_API_URL', '');
  vi.stubEnv('FXL_HUB_ENVIRONMENT', '');
  vi.stubEnv('FXL_HUB_CLIENT_ID', '');
  vi.stubEnv('FXL_HUB_CLIENT_SECRET', '');
  vi.stubEnv('FXL_HUB_AUDIENCE', '');
  vi.stubEnv('FXL_HUB_HEALTH_TOKEN', '');
  vi.stubEnv('FXL_HUB_REDIRECT_URI', '');
  vi.stubEnv('FXL_HUB_POST_LOGIN_REDIRECT', '');
  vi.stubEnv('FXL_HUB_POST_LOGIN_ERROR_REDIRECT', '');
  vi.stubEnv('HUB_SESSION_ENCRYPTION_KEY', '');

  const appAuth = await import('../app-auth.js');
  app = new Hono();
  app.use('/probe', appAuth.appAuthMiddleware);
  app.get('/probe', (c) => c.json({ ok: true }));
});

afterAll(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('appAuthMiddleware without Hub configuration', () => {
  it('answers 503 hub_auth_not_configured and never a 401, 402 or an allow', async () => {
    const res = await app.request('http://localhost/probe');
    expect(res.status).toBe(503);
    await expect(res.json()).resolves.toEqual({
      error: 'unavailable',
      code: 'hub_auth_not_configured',
    });
  });
});
