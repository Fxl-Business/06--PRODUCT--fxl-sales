/**
 * ORACLE for the Hub-free authenticated request.
 *
 * Built on the template of `app-auth-unconfigured.test.ts`, the file in this
 * repo that already knows how to establish a credential-free module graph.
 * Every Hub variable is blank, `SALES_AUTH_FAKE=1`, and the whole file runs
 * with `fetch` stubbed to throw - "does not contact any Hub" is proven by
 * every case below passing under that stub, not assumed.
 *
 * None of these tests carries a static import of `@fxl-sales/auth-fake`; the
 * roster is always reached through `await import('@fxl-sales/auth-fake')`.
 */
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.stubGlobal('fetch', () => {
  throw new Error('dev-identity-no-hub: no code path under SALES_AUTH_FAKE may contact a Hub');
});

/** Hand-crafts a token carrying arbitrary claims, bypassing the package's own
 *  minter and its membership rail, to simulate a tampered bearer whose
 *  workspaceId names an Organization the identity is not a member of. Never
 *  verified by anything - same shape `mintDevToken` produces, encoded with
 *  Node's native base64url support instead of the package's browser-shaped
 *  helpers. */
function craftToken(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'at+jwt' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${header}.${body}.not-a-signature`;
}

let app: Hono;

beforeAll(async () => {
  vi.resetModules();

  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('SALES_AUTH_FAKE', '1');
  vi.stubEnv('CORS_ORIGIN', 'http://localhost:8006');
  vi.stubEnv('DATABASE_URL', 'postgresql://postgres:postgres@localhost:5006/fxl_sales_wiring_test');
  vi.stubEnv('ADMIN_DATABASE_URL', '');
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

  // Step 3 BEFORE step 4: installAppAuthAdapter writes module state on ONE
  // instance of app-auth.js. select.ts reaches it through
  // '../middleware/app-auth.js' while this file reaches it through
  // '../../middleware/app-auth.js' - the same resolved module id, but only if
  // neither was evaluated before the reset above.
  const { installFakeAuthIfRequested } = await import('../select.js');
  expect(await installFakeAuthIfRequested()).toBe(true);

  const appAuth = await import('../../middleware/app-auth.js');

  app = new Hono();
  app.use('/probe', appAuth.appAuthMiddleware);
  app.all('/probe', (c) =>
    c.json({
      userId: c.get('userId'),
      orgId: c.get('orgId'),
      userRole: c.get('userRole'),
      userRoles: c.get('userRoles'),
    }),
  );
});

afterAll(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('the development identity adapter with no Hub configuration at all', () => {
  it('serves an authenticated request with no Hub configuration at all, picked by the x-fake-identity header', async () => {
    const fake = await import('@fxl-sales/auth-fake');
    const identity = fake.findIdentity('team-admin')!;

    const res = await app.request('http://localhost/probe', {
      headers: { 'x-fake-identity': identity.id },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.userId).toBe(identity.accountId);
    expect(body.orgId).toBe(identity.activeWorkspaceId);
    expect(body.userRoles).toEqual(identity.expectedRoles);
  });

  it('resolves the identity from the bearer sub when no dev header is sent, so the shared api client needs no dev-only branch', async () => {
    const fake = await import('@fxl-sales/auth-fake');
    const nonDefault = fake.findIdentity('seller-finder')!;
    const defaultIdentity = fake.findIdentity(fake.DEFAULT_IDENTITY_ID)!;
    // Non-vacuity: the chosen fixture really is a different identity from the
    // default, so a bug that silently adopted the default cannot pass.
    expect(nonDefault.accountId).not.toBe(defaultIdentity.accountId);

    const token = fake.mintDevToken(nonDefault);
    const res = await app.request('http://localhost/probe', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.userId).toBe(nonDefault.accountId);
    expect(body.userId).not.toBe(defaultIdentity.accountId);
    expect(body.orgId).toBe(nonDefault.activeWorkspaceId);
    expect(body.userRoles).toEqual(nonDefault.expectedRoles);
  });

  it('answers 402 payment_required no_org_access for an identity whose Organization carries no access', async () => {
    const res = await app.request('http://localhost/probe', {
      headers: { 'x-fake-identity': 'no-access' },
    });

    expect(res.status).toBe(402);
    await expect(res.json()).resolves.toEqual({
      error: 'payment_required',
      code: 'no_org_access',
    });
  });

  it('answers 401 unknown_fake_identity rather than silently adopting the default identity', async () => {
    const res = await app.request('http://localhost/probe', {
      headers: { 'x-fake-identity': 'not-a-real-identity' },
    });

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toMatchObject({
      error: 'unauthorized',
      code: 'unknown_fake_identity',
      requested: 'not-a-real-identity',
    });
    expect(body).not.toHaveProperty('orgId');
    expect(Array.isArray(body.available)).toBe(true);
  });

  it('serves the Organization the token names, not the identity default, so a switch really switches', async () => {
    const fake = await import('@fxl-sales/auth-fake');
    const identity = fake.findIdentity('multi-org')!;
    const token = fake.mintDevToken(identity, { organizationId: 'org_fake_sul' });

    const res = await app.request('http://localhost/probe', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.orgId).toBe('org_fake_sul');
    expect(body.orgId).not.toBe(identity.activeWorkspaceId);
  });

  it('answers 401 unknown_fake_workspace for a token naming an Organization the identity does not belong to', async () => {
    const fake = await import('@fxl-sales/auth-fake');
    const identity = fake.findIdentity('team-owner')!;
    const claims = fake.toHubClaims(identity);
    const token = craftToken({ ...claims, workspaceId: 'org_fake_not_a_member' });

    const res = await app.request('http://localhost/probe', {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({
      error: 'unauthorized',
      code: 'unknown_fake_workspace',
    });
  });

  it('never reads an org, an account or a workspace off the request body', async () => {
    const fake = await import('@fxl-sales/auth-fake');
    const identity = fake.findIdentity('team-owner')!;

    const res = await app.request('http://localhost/probe', {
      method: 'POST',
      headers: { 'x-fake-identity': identity.id, 'Content-Type': 'application/json' },
      body: JSON.stringify({ orgId: 'other-org', workspaceId: 'other-org', accountId: 'someone-else' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.orgId).toBe(identity.activeWorkspaceId);
    expect(body.userId).toBe(identity.accountId);
  });

  it('does not contact any Hub', async () => {
    const res = await app.request('http://localhost/probe', {
      headers: { 'x-fake-identity': 'team-owner' },
    });
    expect(res.status).toBe(200);
  });
});
