/**
 * The sellers routes are admin-only, proven through the REAL `adminRouter`
 * (`domains/admin/index.ts`): its own `appAuthMiddleware` with the REAL SDK
 * verifier, then the real `requireAdmin`, then `sellersAdminRouter`.
 *
 * `seller-invite.test.ts` mounts `sellersAdminRouter` bare under a context that
 * is always admin, so it cannot see the gate. This file can: a non-admin token
 * must get the one `requireAdmin` body on every sellers route, and the Hub
 * invitations client (the slice 07 seam) must never be called.
 *
 * Offline, like `middleware/__tests__/app-auth-access-gate.test.ts`: tokens are
 * signed by a keypair generated in this process and `fetch` serves the Hub's
 * discovery document and JWKS from memory. The database is a fake that only an
 * admin request can reach.
 */
import { randomUUID } from 'node:crypto';
import { exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';
import type { Hono } from 'hono';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SalesInvitationsClient } from '../invitations-client.js';

const HUB_CLIENT_ID = 'pk_fxl-sales_development_unit-test-only-0123456789';
const HUB_CLIENT_SECRET = 'sk_fxl-sales_development_unit-test-only-not-a-real-secret-0123456789';
const HUB_API_URL = 'http://localhost:9016';
const HUB_ISSUER = 'https://auth.fxlbusiness.test';
const AUDIENCE = 'app.fxl-sales';
const ADMIN_BODY = { error: 'forbidden', reason: 'admin_role_required' };

const dbCalls = vi.hoisted(() => ({ count: 0 }));

/*
  Every entry point counts, so a non-admin case can assert the database was never
  reached. The select chain answers an empty seller list for the admin control.
*/
const fakeDb = {
  select: () => {
    dbCalls.count += 1;
    return { from: () => ({ orderBy: async () => [], where: () => ({ limit: async () => [] }) }) };
  },
  insert: () => {
    dbCalls.count += 1;
    throw new Error('insert must not be reached in this file');
  },
  update: () => {
    dbCalls.count += 1;
    throw new Error('update must not be reached in this file');
  },
};

vi.mock('../../../db/client.js', () => ({
  getAdminDb: () => fakeDb,
  getDb: () => fakeDb,
  closeDb: async () => undefined,
  resolveAdminDatabaseUrl: () => undefined,
}));

let app: Hono;
let signToken: (claims: Record<string, unknown>) => Promise<string>;
let invitations: typeof import('../invitations-client.js');
let fake: { [K in keyof SalesInvitationsClient]: ReturnType<typeof vi.fn> };

function claims(workspaceRole: string) {
  return {
    workspaceId: 'org_active_1',
    contractVersion: 1,
    entitlements: { access: true, modules: [] },
    roles: { workspace: workspaceRole },
  };
}

beforeAll(async () => {
  vi.resetModules();

  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const publicJwk: JWK = { ...(await exportJWK(publicKey)), kid: 'test-key', alg: 'RS256' };

  signToken = async (tokenClaims) =>
    new SignJWT(tokenClaims)
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key', typ: 'at+jwt' })
      .setIssuer(HUB_ISSUER)
      .setAudience(AUDIENCE)
      .setSubject('hub-account-1')
      .setIssuedAt()
      .setExpirationTime('5m')
      .setJti(randomUUID())
      .sign(privateKey);

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
  vi.stubEnv('DATABASE_URL', 'postgresql://unused:unused@localhost:5006/fxl_sales_gate_test');
  vi.stubEnv('ADMIN_DATABASE_URL', '');
  vi.stubEnv('FXL_HUB_API_URL', HUB_API_URL);
  vi.stubEnv('FXL_HUB_ENVIRONMENT', 'development');
  vi.stubEnv('FXL_HUB_CLIENT_ID', HUB_CLIENT_ID);
  vi.stubEnv('FXL_HUB_CLIENT_SECRET', HUB_CLIENT_SECRET);
  vi.stubEnv('FXL_HUB_AUDIENCE', AUDIENCE);
  vi.stubEnv('FXL_HUB_CONFIG', '');
  vi.stubEnv('FXL_HUB_REDIRECT_URI', 'http://localhost:8006/auth/callback');
  vi.stubEnv('SALES_POST_LOGIN_REDIRECT', 'http://localhost:8006');
  vi.stubEnv('SALES_POST_LOGIN_ERROR_REDIRECT', 'http://localhost:8006/?error=auth');
  vi.stubEnv('SALES_SESSION_ENCRYPTION_IKM', '');

  invitations = await import('../invitations-client.js');
  ({ adminRouter: app } = await import('../../admin/index.js'));
});

beforeEach(() => {
  dbCalls.count = 0;
  fake = {
    create: vi.fn(),
    list: vi.fn(async () => ({ invitations: [] })),
    revoke: vi.fn(),
    resend: vi.fn(),
  };
  invitations.setInvitationsClientForTests(fake as unknown as SalesInvitationsClient);
});

afterEach(() => {
  invitations.resetInvitationsClientForTests();
});

afterAll(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function call(method: 'GET' | 'POST', path: string, token: string, body?: unknown) {
  return app.request(`http://localhost${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const SELLER_ID = randomUUID();

const ROUTES = [
  { name: 'GET /sellers', method: 'GET', path: '/sellers', body: undefined },
  {
    name: 'POST /sellers',
    method: 'POST',
    path: '/sellers',
    body: { displayName: 'Ana', contactEmail: 'ana@example.com' },
  },
  { name: 'POST /sellers/:id/resend', method: 'POST', path: `/sellers/${SELLER_ID}/resend`, body: {} },
  { name: 'POST /sellers/:id/revoke', method: 'POST', path: `/sellers/${SELLER_ID}/revoke`, body: undefined },
] as const;

describe('the sellers routes behind the real adminRouter', () => {
  it.each(ROUTES)('$name answers the requireAdmin 403 to a non-admin token', async (route) => {
    const res = await call(route.method, route.path, await signToken(claims('member')), route.body);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual(ADMIN_BODY);
    for (const method of Object.values(fake)) expect(method).not.toHaveBeenCalled();
    expect(dbCalls.count).toBe(0);
  });

  it('lets an admin token through to the sellers handler (positive control)', async () => {
    const res = await call('GET', '/sellers', await signToken(claims('admin')));

    expect(res.status).toBe(200);
    expect(dbCalls.count).toBeGreaterThan(0);
  });
});
