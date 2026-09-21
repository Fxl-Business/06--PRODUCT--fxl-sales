/**
 * ORACLE for slice 02.1: the development identity mode must survive a
 * PARTIAL or otherwise invalid Hub configuration, which is the state a real
 * developer machine is actually in (one leftover FXL_HUB_API_URL, the other
 * four identity variables blank).
 *
 * `tryLoadHubAuthConfig` throws `HubConfigError` for exactly that shape - see
 * `apps/api/src/config/auth-provider.ts`'s header - and that is correct on
 * the real path. This file proves the tolerance is CONDITIONAL on
 * `SALES_AUTH_FAKE` and never blanket: test 2 is the decisive one, because
 * without it the fix could quietly become a blanket try/catch and nothing in
 * the suite would notice.
 *
 * Each case reaches its own fresh module graph via `vi.resetModules()`, the
 * same pattern `dev-identity-no-hub.test.ts` and
 * `dev-identity-production-refusal.test.ts` already use, because
 * `hubSdkConfig` is resolved once at `app-auth.ts`'s module top level.
 */
import { Hono } from 'hono';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * A PARTIAL discrete Hub configuration: one identity variable set, the other
 * four blank. This is the exact shape recorded in the plan's evidence -
 * `apps/api/.env` on the machine that reproduced the defect - and it is
 * deliberately not "every variable blank", which is the ABSENT case
 * `tryLoadHubAuthConfig` already tolerates unconditionally.
 */
function stubPartialHubEnv() {
  vi.stubEnv('CORS_ORIGIN', 'http://localhost:8006');
  vi.stubEnv('DATABASE_URL', '');
  vi.stubEnv('ADMIN_DATABASE_URL', '');
  vi.stubEnv('FXL_HUB_CONFIG', '');
  vi.stubEnv('FXL_HUB_API_URL', 'http://localhost:9016');
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

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('development identity independence from a partial Hub configuration', () => {
  it('boots and installs the adapter when the Hub configuration is partial and the flag is set', async () => {
    vi.resetModules();
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('SALES_AUTH_FAKE', '1');
    stubPartialHubEnv();
    vi.stubGlobal('fetch', () => {
      throw new Error(
        'dev-identity-hub-config-independence: no code path under SALES_AUTH_FAKE may contact a Hub',
      );
    });

    const { installFakeAuthIfRequested } = await import('../select.js');
    await expect(installFakeAuthIfRequested()).resolves.toBe(true);

    const appAuth = await import('../../middleware/app-auth.js');
    expect(appAuth.getHubSdkConfig()).toBeNull();

    const app = new Hono();
    app.use('/probe', appAuth.appAuthMiddleware);
    app.all('/probe', (c) => c.json({ userId: c.get('userId'), orgId: c.get('orgId') }));

    const fake = await import('@fxl-sales/auth-fake');
    const identity = fake.findIdentity('team-admin')!;

    const res = await app.request('http://localhost/probe', {
      headers: { 'x-fake-identity': identity.id },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.userId).toBe(identity.accountId);
    expect(body.orgId).toBe(identity.activeWorkspaceId);
  });

  it('still fails the boot on a partial Hub configuration when the flag is absent', async () => {
    vi.resetModules();
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('SALES_AUTH_FAKE', '');
    stubPartialHubEnv();

    // THE DECISIVE ASSERTION: the identical partial configuration that test 1
    // tolerates must still throw here, with the SDK's own message, unchanged.
    // Without this test the tolerance above could silently become a blanket
    // try/catch and nothing in the suite would notice.
    await expect(import('../../middleware/app-auth.js')).rejects.toThrow(
      /FXL_HUB_CONFIG\.environment must be exactly one of/,
    );
  });

  it('refuses to boot on a partial Hub configuration when the flag is set but the process is production', async () => {
    vi.resetModules();
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('SALES_AUTH_FAKE', '1');
    stubPartialHubEnv();

    // Production must never become an escape hatch for the tolerance: the
    // flag alone is not enough, so the module-level throw must survive.
    await expect(import('../../middleware/app-auth.js')).rejects.toThrow(
      /FXL_HUB_CONFIG\.environment must be exactly one of/,
    );
  });

  it('absorbs only the SDK configuration error and lets any other boot failure escape', async () => {
    vi.resetModules();
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('SALES_AUTH_FAKE', '1');
    stubPartialHubEnv();
    vi.stubGlobal('fetch', () => {
      throw new Error(
        'dev-identity-hub-config-independence: no code path under SALES_AUTH_FAKE may contact a Hub',
      );
    });

    // Replace the Hub configuration resolver with one that throws a PLAIN
    // Error rather than the SDK's HubConfigError - a boot fault unrelated to
    // a partial or invalid Hub configuration (a coding bug in the loader
    // itself, say). The catch in app-auth.ts checks `instanceof
    // HubConfigError` before it checks the flag or the environment, so this
    // must reach the caller unabsorbed even though the flag is set and the
    // process is not production.
    vi.doMock('../../config/auth-provider.js', async (importOriginal) => {
      const actual = await importOriginal<typeof import('../../config/auth-provider.js')>();
      return {
        ...actual,
        tryLoadHubAuthConfig: () => {
          throw new Error('dev-identity-hub-config-independence: not a HubConfigError');
        },
      };
    });

    try {
      // THE DECISIVE ASSERTION: widening `instanceof HubConfigError` to
      // `instanceof Error` in app-auth.ts makes this plain Error match the
      // catch guard, so it would be absorbed and this import would resolve
      // instead of rejecting - which is exactly what must not happen.
      await expect(import('../../middleware/app-auth.js')).rejects.toThrow(
        /dev-identity-hub-config-independence: not a HubConfigError/,
      );
    } finally {
      vi.doUnmock('../../config/auth-provider.js');
    }
  });
});
