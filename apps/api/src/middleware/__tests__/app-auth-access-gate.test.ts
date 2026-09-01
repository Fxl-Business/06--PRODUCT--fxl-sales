/**
 * The end-to-end oracle for `appAuthMiddleware` itself, which nothing covered
 * before: every existing app-auth test drives the exported helpers directly.
 *
 * The SDK is stubbed, so this file is OFFLINE: the real 1.3.1 `requireHubAuth`
 * calls `discover()` over HTTP on its first request. What is exercised for real
 * is the repo's own gate and the legacy-context assignment behind it.
 *
 * It lives in its own file because it needs a module graph in which
 * `@fxl-business/hub-sdk/server` is mocked, and vitest isolates per file.
 */
import type { Context, Next } from 'hono';
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * Obviously synthetic fixtures. The secret is long enough to clear the sealer's
 * 32-character floor on its own.
 */
const HUB_CLIENT_ID = 'pk_fxl-sales_development_unit-test-only-0123456789';
const HUB_CLIENT_SECRET = 'sk_fxl-sales_development_unit-test-only-not-a-real-secret-0123456789';

/** Type-only, so it is erased and cannot pull the module in before the mock. */
type MinimalHubAuthContext = import('../app-auth.js').MinimalHubAuthContext;

type StubOutcome =
  | { kind: 'context'; auth: unknown }
  | { kind: 'no-context' }
  | { kind: 'reject'; code: string };

/** Mutated per test; read by the stub middleware on every request. */
let outcome: StubOutcome = { kind: 'no-context' };

let app: Hono;

vi.doMock('@fxl-business/hub-sdk/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@fxl-business/hub-sdk/server')>();
  return {
    ...actual,
    /*
      Stands in for the REAL 1.3.1 requireHubAuth, whose only outcomes are
      `401 {error:'unauthorized', code}` (dist/server.js:236,243,245) and
      `c.set('hubAuth', ctx)` then `next()` (dist/server.js:240,247). Stubbing it
      keeps this file offline: the real one calls `discover()` over HTTP on its
      first request.
    */
    requireHubAuth: () => async (c: Context, next: Next) => {
      if (outcome.kind === 'reject') {
        return c.json({ error: 'unauthorized', code: outcome.code }, 401);
      }
      if (outcome.kind === 'context') {
        c.set('hubAuth', outcome.auth as MinimalHubAuthContext);
      }
      await next();
    },
  };
});

const entitled = {
  accountId: 'hub-account-1',
  workspaceId: 'org_active_1',
  claims: {
    entitlements: { access: true, modules: [] },
    roles: { workspace: 'member' },
  },
};

beforeAll(async () => {
  vi.resetModules();

  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('CORS_ORIGIN', 'http://localhost:8006');
  // No connection is opened: `createAppAuthBff()` is never called in this file.
  // The value keeps the memory-store warning off the run.
  vi.stubEnv('DATABASE_URL', 'postgresql://postgres:postgres@localhost:5006/fxl_sales_wiring_test');
  vi.stubEnv('ADMIN_DATABASE_URL', '');
  vi.stubEnv('FXL_HUB_API_URL', 'http://localhost:9016');
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

  const appAuth = await import('../app-auth.js');
  const { requireAdmin } = await import('../require-admin.js');

  app = new Hono();
  app.use('/probe', appAuth.appAuthMiddleware);
  app.get('/probe', (c) => c.json({ ok: true, orgId: c.get('orgId'), userId: c.get('userId') }));
  app.use('/admin-probe', appAuth.appAuthMiddleware, requireAdmin);
  app.get('/admin-probe', (c) => c.json({ ok: true }));
});

afterAll(() => {
  vi.doUnmock('@fxl-business/hub-sdk/server');
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('appAuthMiddleware access gate', () => {
  it('allows a protected route when entitlements.access is true', async () => {
    outcome = { kind: 'context', auth: entitled };
    const res = await app.request('http://localhost/probe');
    expect(res.status).toBe(200);
    /*
      Tenancy, pinned in the same breath: orgId is the ACTIVE HUB WORKSPACE ID
      off the `workspaceId` claim, not an `organizationId` claim, which the Hub
      does not mint.
    */
    await expect(res.json()).resolves.toEqual({
      ok: true,
      orgId: 'org_active_1',
      userId: 'hub-account-1',
    });
  });

  it('answers 402 payment_required with no_org_access when entitlements.access is false', async () => {
    outcome = {
      kind: 'context',
      auth: {
        ...entitled,
        claims: { ...entitled.claims, entitlements: { access: false, modules: [] } },
      },
    };
    const res = await app.request('http://localhost/probe');
    expect(res.status).toBe(402);
    /* toEqual, not toMatchObject: the web half branches on this exact body. */
    await expect(res.json()).resolves.toEqual({
      error: 'payment_required',
      code: 'no_org_access',
    });
  });

  it('answers 402 rather than allowing when the claim set has no access key', async () => {
    outcome = {
      kind: 'context',
      auth: { ...entitled, claims: { ...entitled.claims, entitlements: { modules: [] } } },
    };
    const res = await app.request('http://localhost/probe');
    expect(res.status).toBe(402);
  });

  it('answers 402 for a workspace that still carries the deleted core module but no access', async () => {
    outcome = {
      kind: 'context',
      auth: {
        ...entitled,
        claims: { ...entitled.claims, entitlements: { access: false, modules: ['sales.core'] } },
      },
    };
    expect((await app.request('http://localhost/probe')).status).toBe(402);
  });

  it('answers 401 when the token is missing or invalid', async () => {
    for (const code of ['missing_token', 'malformed', 'expired']) {
      outcome = { kind: 'reject', code };
      const res = await app.request('http://localhost/probe');
      expect(res.status).toBe(401);
      await expect(res.json()).resolves.toEqual({ error: 'unauthorized', code });
    }
  });

  it('answers 401 missing_hub_context when the SDK calls next without a context', async () => {
    outcome = { kind: 'no-context' };
    const res = await app.request('http://localhost/probe');
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({
      error: 'unauthorized',
      code: 'missing_hub_context',
    });
  });

  it('answers 403 for a role the route requires but the entitled token does not carry', async () => {
    /*
      An entitled ordinary member: 402 is not the answer to "you may not do
      THIS", and 401 is not the answer to "we know exactly who you are".
    */
    outcome = { kind: 'context', auth: entitled };
    const res = await app.request('http://localhost/admin-probe');
    expect(res.status).toBe(403);
  });

  it('lets an entitled workspace owner through the same admin route', async () => {
    outcome = {
      kind: 'context',
      auth: { ...entitled, claims: { ...entitled.claims, roles: { workspace: 'owner' } } },
    };
    expect((await app.request('http://localhost/admin-probe')).status).toBe(200);
  });
});
