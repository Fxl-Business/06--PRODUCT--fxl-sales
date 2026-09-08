/**
 * The end-to-end oracle for `appAuthMiddleware`, driving the REAL
 * `requireHubAuth` from `@fxl-business/hub-sdk@2.2.0`.
 *
 * This file used to STUB `requireHubAuth` and assert a gate this repo
 * implemented itself. That gate is gone: 2.2.0 answers the whole 401/402/403
 * taxonomy natively, and CLAUDE.md's rule is that there must be exactly ONE live
 * gate, because two would mean one live and one unreachable with a green suite
 * over the dead one. A stub would now prove only that the stub works, so the
 * verifier runs for real here.
 *
 * It stays OFFLINE by signing its own tokens: `globalThis.fetch` is stubbed to
 * serve the Hub's discovery document and a JWKS carrying the public half of a
 * key generated in this process. Nothing leaves the machine and no fixture
 * carries a real credential.
 */
import { exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';
import { Hono } from 'hono';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * Obviously synthetic fixtures. The secret is long enough to clear the sealer's
 * 32-character floor on its own.
 */
const HUB_CLIENT_ID = 'pk_fxl-sales_development_unit-test-only-0123456789';
const HUB_CLIENT_SECRET = 'sk_fxl-sales_development_unit-test-only-not-a-real-secret-0123456789';
const HUB_API_URL = 'http://localhost:9016';
const HUB_ISSUER = 'https://auth.fxlbusiness.test';
const AUDIENCE = 'app.fxl-sales';

let app: Hono;
let signToken: (claims: Record<string, unknown>) => Promise<string>;

/** Claims a healthy, entitled ordinary member carries. */
function entitledClaims(overrides: Record<string, unknown> = {}) {
  return {
    workspaceId: 'org_active_1',
    contractVersion: 1,
    entitlements: { access: true, modules: [] },
    roles: { workspace: 'member' },
    ...overrides,
  };
}

async function get(path: string, token: string | null) {
  return app.request(`http://localhost${path}`, {
    headers: token === null ? {} : { authorization: `Bearer ${token}` },
  });
}

beforeAll(async () => {
  vi.resetModules();

  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const publicJwk: JWK = { ...(await exportJWK(publicKey)), kid: 'test-key', alg: 'RS256' };

  signToken = async (claims) =>
    new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key', typ: 'at+jwt' })
      .setIssuer(HUB_ISSUER)
      .setAudience(AUDIENCE)
      .setSubject((claims.sub as string | undefined) ?? 'hub-account-1')
      .setIssuedAt()
      .setExpirationTime('5m')
      .setJti('test-jti')
      .sign(privateKey);

  // The Hub, served entirely from memory. Any other URL is a hard failure rather
  // than a silent pass, so a test can never accidentally reach the network.
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url === `${HUB_API_URL}/.well-known/oauth-authorization-server`) {
      return Response.json({
        issuer: HUB_ISSUER,
        authorization_endpoint: `${HUB_ISSUER}/authorize`,
        token_endpoint: `${HUB_ISSUER}/token`,
        fxl_web_url: 'http://localhost:8006',
      });
    }
    if (url === `${HUB_API_URL}/.well-known/jwks.json`) {
      return Response.json({ keys: [publicJwk] });
    }
    throw new Error(`unexpected fetch in an offline test: ${url}`);
  });

  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('CORS_ORIGIN', 'http://localhost:8006');
  // No connection is opened: `createAppAuthBff()` is never called in this file.
  vi.stubEnv('DATABASE_URL', 'postgresql://postgres:postgres@localhost:5006/fxl_sales_wiring_test');
  vi.stubEnv('ADMIN_DATABASE_URL', '');
  vi.stubEnv('FXL_HUB_API_URL', HUB_API_URL);
  vi.stubEnv('FXL_HUB_ENVIRONMENT', 'development');
  vi.stubEnv('FXL_HUB_CLIENT_ID', HUB_CLIENT_ID);
  vi.stubEnv('FXL_HUB_CLIENT_SECRET', HUB_CLIENT_SECRET);
  vi.stubEnv('FXL_HUB_AUDIENCE', AUDIENCE);
  // Blank reads as unset. A developer's own apps/api/.env could otherwise carry
  // the JSON form and make this file throw on ambiguity at import.
  vi.stubEnv('FXL_HUB_CONFIG', '');
  vi.stubEnv('FXL_HUB_REDIRECT_URI', 'http://localhost:8006/auth/callback');
  vi.stubEnv('SALES_POST_LOGIN_REDIRECT', 'http://localhost:8006');
  vi.stubEnv('SALES_POST_LOGIN_ERROR_REDIRECT', 'http://localhost:8006/?error=auth');
  vi.stubEnv('SALES_SESSION_ENCRYPTION_IKM', '');

  const appAuth = await import('../app-auth.js');
  const { requireAdmin } = await import('../require-admin.js');

  app = new Hono();
  app.use('/probe', appAuth.appAuthMiddleware);
  app.get('/probe', (c) => c.json({ ok: true, orgId: c.get('orgId'), userId: c.get('userId') }));
  app.use('/admin-probe', appAuth.appAuthMiddleware, requireAdmin);
  app.get('/admin-probe', (c) => c.json({ ok: true }));
});

afterAll(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('appAuthMiddleware access gate, through the real SDK verifier', () => {
  it('allows a protected route when entitlements.access is true', async () => {
    const res = await get('/probe', await signToken(entitledClaims()));
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
    const token = await signToken(
      entitledClaims({ entitlements: { access: false, modules: [] } }),
    );
    const res = await get('/probe', token);
    expect(res.status).toBe(402);
    /* toEqual, not toMatchObject: the web half branches on this exact body. */
    await expect(res.json()).resolves.toEqual({
      error: 'payment_required',
      code: 'no_org_access',
    });
  });

  it('denies, and does not allow, when the claim set has no access key at all', async () => {
    /*
      A BEHAVIOUR CHANGE recorded rather than smoothed over. This repo's own gate
      answered 402 here, because it read `access` off a claim shape it did not
      validate. 2.2.0 validates the token against the contract FIRST, and an
      `entitlements` object with no `access` member is not a well-formed Hub
      token, so the verifier refuses it as 401 before the entitlement gate is
      ever reached.

      401 is the right answer and not a regression: per CLAUDE.md a 401 reaches
      the login screen, which is the correct destination for a token this app
      cannot use, exactly as for `contract_version_mismatch`. 402 is reserved for
      a WELL-FORMED token whose Organization simply has no access, and that case
      is pinned by the two tests above.

      What must never change is that it FAILS CLOSED, so the assertion is on the
      denial rather than on the number alone.
    */
    const token = await signToken(entitledClaims({ entitlements: { modules: [] } }));
    const res = await get('/probe', token);
    expect(res.status).toBe(401);
    expect(res.status).not.toBe(200);
  });

  it('answers 402 for a workspace that still carries the deleted core module but no access', async () => {
    // The whole point of access-model-v1: a module string is not access.
    const token = await signToken(
      entitledClaims({ entitlements: { access: false, modules: ['sales.core'] } }),
    );
    expect((await get('/probe', token)).status).toBe(402);
  });

  it('answers 401 when the token is missing', async () => {
    const res = await get('/probe', null);
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toMatchObject({ error: 'unauthorized' });
  });

  it('answers 401 for a token this app cannot verify', async () => {
    const res = await get('/probe', 'not.a.jwt');
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toMatchObject({ error: 'unauthorized' });
  });

  it('answers 401 contract_version_mismatch for a token minted against another contract', async () => {
    // New in 2.2.0, and it reaches the login screen rather than the buy screen:
    // a token this app cannot use is answered by a fresh login and nothing else.
    const token = await signToken(entitledClaims({ contractVersion: 2 }));
    const res = await get('/probe', token);
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({
      error: 'unauthorized',
      code: 'contract_version_mismatch',
    });
  });

  it('answers 403 for a role the route requires but the entitled token does not carry', async () => {
    /*
      An entitled ordinary member: 402 is not the answer to "you may not do
      THIS", and 401 is not the answer to "we know exactly who you are".
    */
    const res = await get('/admin-probe', await signToken(entitledClaims()));
    expect(res.status).toBe(403);
  });

  it('lets an entitled workspace owner through the same admin route', async () => {
    const token = await signToken(entitledClaims({ roles: { workspace: 'owner' } }));
    expect((await get('/admin-probe', token)).status).toBe(200);
  });
});
