/**
 * THE ORACLE for the Sales edition gate map (edicao-leads, slice 02).
 *
 * It drives the REAL `appAuthMiddleware` and the REAL SDK verifier with tokens
 * signed by a keypair generated in this process (`fetch` serves the Hub's
 * discovery document and JWKS from memory), mirrors the `server.ts` mount
 * shapes for the seven gated routers, and enumerates every route registered on
 * them, so a route nobody classified as gated or open fails the suite.
 *
 * The database is a fake that throws on first use: reaching it means a handler
 * ran, and the app's `onError` turns that into the HANDLER_REACHED marker.
 */
import { randomUUID } from 'node:crypto';
import { exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';
import { Hono } from 'hono';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const HUB_CLIENT_ID = 'pk_fxl-sales_development_unit-test-only-0123456789';
const HUB_CLIENT_SECRET = 'sk_fxl-sales_development_unit-test-only-not-a-real-secret-0123456789';
const HUB_API_URL = 'http://localhost:9016';
const HUB_ISSUER = 'https://auth.fxlbusiness.test';
const AUDIENCE = 'app.fxl-sales';
const EDITION_BODY_TEXT = '{"error":"forbidden","code":"edition_capability"}';
const HANDLER_REACHED = { error: 'handler_reached' };

const dbCalls = vi.hoisted(() => ({ count: 0 }));

vi.mock('../../db/client.js', () => {
  // Any use of the database is a handler having been reached. It throws so the
  // test app's onError turns it into the HANDLER_REACHED marker.
  const fakeDb = new Proxy(
    {},
    {
      get: () => {
        throw new Error('edition-gate-map: fake database reached');
      },
    },
  );
  return {
    getDb: () => {
      dbCalls.count += 1;
      return fakeDb;
    },
    getAdminDb: () => {
      dbCalls.count += 1;
      return fakeDb;
    },
    closeDb: async () => undefined,
    resolveAdminDatabaseUrl: () => undefined,
  };
});

type RouterKey =
  | 'salesOps'
  | 'commissions'
  | 'commissionsAdmin'
  | 'payouts'
  | 'payoutsAdmin'
  | 'links'
  | 'finder';

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

interface RouteCase {
  router: RouterKey;
  method: Method;
  pattern: string;
  url: string;
}

const ROUTER_KEYS: readonly RouterKey[] = [
  'salesOps',
  'commissions',
  'commissionsAdmin',
  'payouts',
  'payoutsAdmin',
  'links',
  'finder',
];

const ID = '55555555-5555-4555-8555-555555555555';
const SO = '/api/v1/sales-ops';

function r(router: RouterKey, method: Method, pattern: string, url: string): RouteCase {
  return { router, method, pattern, url };
}

const GATED: readonly RouteCase[] = [
  r('salesOps', 'GET', '/summary', `${SO}/summary`),
  r('salesOps', 'GET', '/sales', `${SO}/sales`),
  r('salesOps', 'POST', '/sales', `${SO}/sales`),
  r('salesOps', 'POST', '/sales/:id/transition', `${SO}/sales/${ID}/transition`),
  r('salesOps', 'POST', '/sales/:id/cancel-contract', `${SO}/sales/${ID}/cancel-contract`),
  r('salesOps', 'PUT', '/sales/:id', `${SO}/sales/${ID}`),
  r('salesOps', 'GET', '/sales/:id/settlements', `${SO}/sales/${ID}/settlements`),
  r('salesOps', 'POST', '/settlements', `${SO}/settlements`),
  r('salesOps', 'POST', '/settlements/:id/reverse', `${SO}/settlements/${ID}/reverse`),
  r('salesOps', 'GET', '/products', `${SO}/products`),
  r('salesOps', 'POST', '/products', `${SO}/products`),
  r('salesOps', 'PATCH', '/products/:id', `${SO}/products/${ID}`),
  r('salesOps', 'GET', '/areas', `${SO}/areas`),
  r('salesOps', 'POST', '/areas', `${SO}/areas`),
  r('salesOps', 'PATCH', '/areas/:id', `${SO}/areas/${ID}`),
  r('salesOps', 'GET', '/funcoes', `${SO}/funcoes`),
  r('salesOps', 'POST', '/funcoes', `${SO}/funcoes`),
  r('salesOps', 'PATCH', '/funcoes/:id', `${SO}/funcoes/${ID}`),
  r('salesOps', 'PUT', '/settings', `${SO}/settings`),
  r('salesOps', 'GET', '/history', `${SO}/history`),
  r('commissions', 'GET', '/', '/api/v1/commissions'),
  r('commissionsAdmin', 'GET', '/', '/api/v1/admin/commissions'),
  r('commissionsAdmin', 'POST', '/promote-locked', '/api/v1/admin/commissions/promote-locked'),
  r('commissionsAdmin', 'POST', '/:commissionId/lock', `/api/v1/admin/commissions/${ID}/lock`),
  r('commissionsAdmin', 'POST', '/:commissionId/reverse', `/api/v1/admin/commissions/${ID}/reverse`),
  r('payouts', 'GET', '/', '/api/v1/payouts'),
  r('payoutsAdmin', 'GET', '/', '/api/v1/admin/payouts'),
  r('payoutsAdmin', 'POST', '/', '/api/v1/admin/payouts'),
  r('payoutsAdmin', 'POST', '/:payoutId/mark-paid', `/api/v1/admin/payouts/${ID}/mark-paid`),
  r('payoutsAdmin', 'GET', '/finders-ready', '/api/v1/admin/payouts/finders-ready'),
  r('payoutsAdmin', 'POST', '/batches', '/api/v1/admin/payouts/batches'),
  r('payoutsAdmin', 'GET', '/batches/:id/csv', `/api/v1/admin/payouts/batches/${ID}/csv`),
  r('links', 'POST', '/', '/api/v1/links'),
  r('links', 'GET', '/', '/api/v1/links'),
  r('links', 'DELETE', '/:linkId', `/api/v1/links/${ID}`),
  r('finder', 'GET', '/apps', '/api/v1/finder/apps'),
  r('finder', 'GET', '/apps/:appId/products', `/api/v1/finder/apps/${ID}/products`),
  r('finder', 'GET', '/clicks', '/api/v1/finder/clicks'),
  r('finder', 'GET', '/clicks/stats', '/api/v1/finder/clicks/stats'),
];

/**
 * Capability-gated routers that the LEADS edition is granted (`clients` + `import`).
 * They carry a `requireCapability` gate like the GATED set, but the leads edition
 * HAS those capabilities, so they never answer the edition 403 to a leads owner -
 * they reach their handler (or, for the admin-only importer, the admin gate). For
 * any edition lacking the capability they would 403, which the full-edition oracle
 * does not exercise but the route gate still enforces.
 */
const LEADS_GRANTED: readonly RouteCase[] = [
  r('salesOps', 'GET', '/clients', `${SO}/clients`),
  r('salesOps', 'POST', '/clients', `${SO}/clients`),
  r('salesOps', 'PATCH', '/clients/:id', `${SO}/clients/${ID}`),
  r('salesOps', 'GET', '/import/template', `${SO}/import/template`),
  r('salesOps', 'POST', '/import/preview', `${SO}/import/preview`),
  r('salesOps', 'POST', '/import/commit', `${SO}/import/commit`),
];

const OPEN: readonly RouteCase[] = [
  r('salesOps', 'GET', '/bootstrap', `${SO}/bootstrap`),
  r('salesOps', 'GET', '/settings', `${SO}/settings`),
  r('salesOps', 'GET', '/people', `${SO}/people`),
  r('salesOps', 'POST', '/people', `${SO}/people`),
  r('salesOps', 'PATCH', '/people/:id', `${SO}/people/${ID}`),
  r('salesOps', 'GET', '/lead-stages', `${SO}/lead-stages`),
  r('salesOps', 'POST', '/lead-stages/reorder', `${SO}/lead-stages/reorder`),
  r('salesOps', 'POST', '/lead-stages', `${SO}/lead-stages`),
  r('salesOps', 'PATCH', '/lead-stages/:id', `${SO}/lead-stages/${ID}`),
  r('salesOps', 'GET', '/leads', `${SO}/leads`),
  r('salesOps', 'POST', '/leads', `${SO}/leads`),
  r('salesOps', 'GET', '/leads/:id', `${SO}/leads/${ID}`),
  r('salesOps', 'PATCH', '/leads/:id', `${SO}/leads/${ID}`),
  r('salesOps', 'POST', '/leads/:id/move', `${SO}/leads/${ID}/move`),
];

let app: Hono;
let routers: Record<RouterKey, Hono>;
let signToken: (claims: Record<string, unknown>) => Promise<string>;
let tokens: { leadsOwner: string; leadsSeller: string; fullOwner: string; addonOwner: string };

function claims(
  modules: string[],
  roles: Record<string, unknown> = { workspace: 'owner' },
  access = true,
) {
  return {
    workspaceId: 'org_edition_gate',
    contractVersion: 1,
    entitlements: { access, modules },
    roles,
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
  vi.stubEnv('DATABASE_URL', 'postgresql://unused:unused@localhost:5006/fxl_sales_edition_gate_test');
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

  const { appAuthMiddleware } = await import('../app-auth.js');
  const { requireAdmin } = await import('../require-admin.js');
  const { salesOpsRouter } = await import('../../domains/sales-ops/routes.js');
  const { commissionsAdminRouter, commissionsRouter } = await import(
    '../../domains/commissions/routes.js'
  );
  const { payoutsAdminRouter, payoutsRouter } = await import('../../domains/payouts/routes.js');
  const { linksRouter } = await import('../../domains/links/routes.js');
  const { finderRouter } = await import('../../domains/finder/routes.js');

  app = new Hono();
  // Mirrors server.ts mount shapes and order for these seven routers.
  app.use('/api/v1/admin/commissions/*', appAuthMiddleware, requireAdmin);
  app.route('/api/v1/admin/commissions', commissionsAdminRouter);
  app.use('/api/v1/commissions/*', appAuthMiddleware);
  app.route('/api/v1/commissions', commissionsRouter);
  app.use('/api/v1/admin/payouts/*', appAuthMiddleware, requireAdmin);
  app.route('/api/v1/admin/payouts', payoutsAdminRouter);
  app.use('/api/v1/payouts/*', appAuthMiddleware);
  app.route('/api/v1/payouts', payoutsRouter);
  app.use('/api/v1/sales-ops/*', appAuthMiddleware);
  app.route('/api/v1/sales-ops', salesOpsRouter);
  app.use('/api/v1/links/*', appAuthMiddleware);
  app.route('/api/v1/links', linksRouter);
  app.use('/api/v1/finder/*', appAuthMiddleware);
  app.route('/api/v1/finder', finderRouter);
  app.onError((_error, c) => c.json(HANDLER_REACHED, 500));

  routers = {
    salesOps: salesOpsRouter,
    commissions: commissionsRouter,
    commissionsAdmin: commissionsAdminRouter,
    payouts: payoutsRouter,
    payoutsAdmin: payoutsAdminRouter,
    links: linksRouter,
    finder: finderRouter,
  };

  tokens = {
    leadsOwner: await signToken(claims(['sales.edition.leads'])),
    leadsSeller: await signToken(
      claims(['sales.edition.leads'], { workspace: 'member', productRoles: ['seller'] }),
    ),
    fullOwner: await signToken(claims([])),
    addonOwner: await signToken(claims(['sales.some-other-addon'])),
  };
});

beforeEach(() => {
  dbCalls.count = 0;
});

afterAll(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function send(route: RouteCase, token: string): Promise<Response> {
  const hasBody = route.method !== 'GET' && route.method !== 'DELETE';
  return app.request(`http://localhost${route.url}`, {
    method: route.method,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: hasBody ? '{}' : undefined,
  });
}

/** True only for the exact edition denial: status 403 AND the byte-exact body. */
async function isEditionDenial(res: Response): Promise<boolean> {
  if (res.status !== 403) return false;
  return (await res.text()) === EDITION_BODY_TEXT;
}

function registeredKeys(key: RouterKey): Set<string> {
  return new Set(
    routers[key].routes.filter((route) => route.method !== 'ALL').map((route) => `${route.method} ${route.path}`),
  );
}

function classifiedKeys(key: RouterKey): Set<string> {
  return new Set(
    [...GATED, ...OPEN, ...LEADS_GRANTED]
      .filter((route) => route.router === key)
      .map((route) => `${route.method} ${route.pattern}`),
  );
}

function route(method: Method, url: string): RouteCase {
  return { router: 'salesOps', method, pattern: url, url };
}

describe('the gate map is exhaustive', () => {
  it.each(ROUTER_KEYS)('every route registered on %s is classified as gated or open', (key) => {
    expect(classifiedKeys(key)).toEqual(registeredKeys(key));
  });

  it.each(['commissions', 'commissionsAdmin', 'payouts', 'payoutsAdmin', 'links', 'finder'] as const)(
    '%s registers its capability gate before any route',
    (key) => {
      expect(routers[key].routes[0]).toMatchObject({ method: 'ALL', path: '/*' });
    },
  );

  it('no open route belongs to a whole-router gated group', () => {
    expect(OPEN.every((openRoute) => openRoute.router === 'salesOps')).toBe(true);
  });
});

describe('the leads edition', () => {
  it.each(GATED)('$method $url answers the edition 403 to a leads-edition owner', async (gated) => {
    const res = await send(gated, tokens.leadsOwner);
    expect(res.status).toBe(403);
    expect(await res.text()).toBe(EDITION_BODY_TEXT);
    expect(dbCalls.count).toBe(0);
  });

  it.each(GATED.filter((gated) => gated.router === 'salesOps'))(
    '$method $url answers the edition 403 to a leads-edition seller too',
    async (gated) => {
      const res = await send(gated, tokens.leadsSeller);
      expect(res.status).toBe(403);
      expect(await res.text()).toBe(EDITION_BODY_TEXT);
      expect(dbCalls.count).toBe(0);
    },
  );

  it.each(OPEN)('$method $url is not edition-gated for a leads-edition owner', async (open) => {
    const res = await send(open, tokens.leadsOwner);
    expect(await isEditionDenial(res)).toBe(false);
  });

  it.each(LEADS_GRANTED)(
    '$method $url is granted (never the edition 403) to a leads-edition owner',
    async (granted) => {
      const res = await send(granted, tokens.leadsOwner);
      expect(await isEditionDenial(res)).toBe(false);
    },
  );

  it('GET /clients reaches its handler for a leads-edition owner (clients capability granted)', async () => {
    const res = await send(route('GET', `${SO}/clients`), tokens.leadsOwner);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual(HANDLER_REACHED);
    expect(dbCalls.count).toBeGreaterThan(0);
  });

  it('GET /bootstrap reaches its handler for a leads-edition owner (non-vacuity)', async () => {
    const res = await send(route('GET', `${SO}/bootstrap`), tokens.leadsOwner);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual(HANDLER_REACHED);
    expect(dbCalls.count).toBeGreaterThan(0);
  });

  it('GET /settings reaches its handler while PUT /settings is gated', async () => {
    const getRes = await send(route('GET', `${SO}/settings`), tokens.leadsOwner);
    expect(getRes.status).toBe(500);
    expect(await getRes.json()).toEqual(HANDLER_REACHED);
    expect(dbCalls.count).toBeGreaterThan(0);

    const putRes = await send(route('PUT', `${SO}/settings`), tokens.leadsOwner);
    expect(putRes.status).toBe(403);
    expect(await putRes.text()).toBe(EDITION_BODY_TEXT);
  });
});

describe('the full edition (FXL oracle)', () => {
  it.each([...GATED, ...OPEN, ...LEADS_GRANTED])(
    '$method $url never answers the edition 403 with modules []',
    async (anyRoute) => {
      expect(await isEditionDenial(await send(anyRoute, tokens.fullOwner))).toBe(false);
    },
  );

  it.each([...GATED, ...OPEN, ...LEADS_GRANTED])(
    '$method $url never answers the edition 403 with an unrelated add-on module',
    async (anyRoute) => {
      expect(await isEditionDenial(await send(anyRoute, tokens.addonOwner))).toBe(false);
    },
  );

  it('GET /summary reaches its handler for a full-edition owner (non-vacuity)', async () => {
    const res = await send(route('GET', `${SO}/summary`), tokens.fullOwner);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual(HANDLER_REACHED);
    expect(dbCalls.count).toBeGreaterThan(0);
  });

  it('GET /api/v1/admin/commissions reaches its handler for a full-edition owner (non-vacuity)', async () => {
    const res = await send(
      { router: 'commissionsAdmin', method: 'GET', pattern: '/', url: '/api/v1/admin/commissions' },
      tokens.fullOwner,
    );
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual(HANDLER_REACHED);
    expect(dbCalls.count).toBeGreaterThan(0);
  });
});

describe('the access gate is unchanged', () => {
  it('a leads-edition token without access still answers 402 no_org_access', async () => {
    const token = await signToken(claims(['sales.edition.leads'], { workspace: 'owner' }, false));
    const res = await send(route('GET', `${SO}/bootstrap`), token);
    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({ error: 'payment_required', code: 'no_org_access' });
  });

  it('a request with no token answers 401 before any edition gate', async () => {
    const res = await app.request(`http://localhost${SO}/summary`);
    expect(res.status).toBe(401);
  });
});
