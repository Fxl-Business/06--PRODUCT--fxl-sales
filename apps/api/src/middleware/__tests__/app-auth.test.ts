import { describe, expect, it, vi } from 'vitest';

/**
 * Blank reads as unset. This file imports `../app-auth.js` at MODULE scope, and
 * that module calls `tryLoadHubAuthConfig(hubEnvBag(env))` at its own top level.
 * There is no blanket try/catch behind that call any more, so a developer machine
 * whose `apps/api/.env` carries `FXL_HUB_CONFIG` beside the discrete variables
 * would make `hubConfigPresence` throw on ambiguity and crash this whole file at
 * import rather than fail one test. `vi.stubEnv` ADDS to `process.env`; it does
 * not clear it. `vi.hoisted` rather than a `beforeAll` because a static import is
 * evaluated first and a `beforeAll` would be too late to matter.
 */
vi.hoisted(() => {
  vi.stubEnv('FXL_HUB_CONFIG', '');
});

import { Hono } from 'hono';

import {
  classifyHubAccess,
  getHubLegacyAuthContext,
  hasHubModule,
  hasHubOrgAccess,
  requireHubModule,
  resolveHubPostLoginErrorRedirect,
  resolveHubPostLoginRedirect,
  resolveHubRedirectUri,
  type MinimalHubAuthContext,
} from '../app-auth.js';

const baseHubAuth: MinimalHubAuthContext = {
  accountId: 'hub-account-1',
  workspaceId: 'org_existing_1',
  claims: {
    entitlements: { access: true, modules: [] },
    roles: { workspace: 'member' },
  },
};

describe('getHubLegacyAuthContext', () => {
  it('maps Hub account and workspace ids into the Hono auth context', () => {
    expect(getHubLegacyAuthContext(baseHubAuth)).toEqual({
      userId: 'hub-account-1',
      orgId: 'org_existing_1',
      userRole: undefined,
      userRoles: [],
    });
  });

  it('maps Hub super-admins to the existing admin guard role', () => {
    expect(
      getHubLegacyAuthContext({
        ...baseHubAuth,
        claims: {
          ...baseHubAuth.claims,
          isSuperAdmin: true,
        },
      }).userRole,
    ).toBe('admin');
  });

  it('maps workspace owners and admins to the existing admin guard role', () => {
    expect(
      getHubLegacyAuthContext({
        ...baseHubAuth,
        claims: {
          ...baseHubAuth.claims,
          roles: { workspace: 'owner' },
        },
      }).userRole,
    ).toBe('admin');
  });

  it('maps product admin roles to the existing admin guard role', () => {
    expect(
      getHubLegacyAuthContext({
        ...baseHubAuth,
        claims: {
          ...baseHubAuth.claims,
          roles: { workspace: 'member', productRoles: ['admin'] },
        },
      }),
    ).toMatchObject({
      userRole: 'admin',
      userRoles: ['admin', 'seller', 'finder'],
    });
  });

  it('preserves multiple product roles for downstream app authorization', () => {
    expect(
      getHubLegacyAuthContext({
        ...baseHubAuth,
        claims: {
          ...baseHubAuth.claims,
          roles: { workspace: 'member', productRoles: ['seller', 'finder'] },
        },
      }),
    ).toMatchObject({
      userRole: 'seller',
      userRoles: ['seller', 'finder'],
    });
  });

  it('does not invent a role for ordinary members without product roles', () => {
    expect(getHubLegacyAuthContext(baseHubAuth)).toMatchObject({
      userRole: undefined,
      userRoles: [],
    });
  });
});

describe('classifyHubAccess', () => {
  it('allows a context whose entitlements.access is true', () => {
    expect(classifyHubAccess(baseHubAuth)).toEqual({ allowed: true, auth: baseHubAuth });
  });

  it('denies with 402 and the buy-screen code when entitlements.access is false', () => {
    expect(
      classifyHubAccess({
        ...baseHubAuth,
        claims: { ...baseHubAuth.claims, entitlements: { access: false, modules: [] } },
      }),
    ).toEqual({
      allowed: false,
      status: 402,
      body: { error: 'payment_required', code: 'no_org_access' },
    });
  });

  it('denies a claim set with no access key at all rather than allowing it', () => {
    /*
      The cast is the point of the test. The TYPE says `access: boolean`, but the
      value comes off a token, and a Hub or a fixture that omits the key must
      never be defaulted to true. Absent is a denial.
    */
    const noAccessKey = {
      ...baseHubAuth,
      claims: { ...baseHubAuth.claims, entitlements: { modules: [] } },
    } as unknown as MinimalHubAuthContext;
    expect(classifyHubAccess(noAccessKey).allowed).toBe(false);
    expect(classifyHubAccess(noAccessKey)).toMatchObject({ status: 402 });
  });

  it('denies when the entitlements object is missing entirely', () => {
    const noEntitlements = {
      ...baseHubAuth,
      claims: { roles: { workspace: 'member' } },
    } as unknown as MinimalHubAuthContext;
    expect(classifyHubAccess(noEntitlements).allowed).toBe(false);
  });

  it('denies a non-boolean access claim rather than coercing it', () => {
    for (const access of ['true', 1, {}, null]) {
      const coerced = {
        ...baseHubAuth,
        claims: { ...baseHubAuth.claims, entitlements: { access, modules: [] } },
      } as unknown as MinimalHubAuthContext;
      expect(classifyHubAccess(coerced).allowed).toBe(false);
    }
  });

  it('denies with 401 missing_hub_context when the SDK produced no auth context', () => {
    expect(classifyHubAccess(undefined)).toEqual({
      allowed: false,
      status: 401,
      body: { error: 'unauthorized', code: 'missing_hub_context' },
    });
  });

  it('never reads entitlements.modules for baseline access', () => {
    /*
      The exact shape of the defect, inverted: a workspace carrying every module
      string this product has ever spelled, and no access, is still denied.
    */
    expect(
      classifyHubAccess({
        ...baseHubAuth,
        claims: {
          ...baseHubAuth.claims,
          entitlements: { access: false, modules: ['sales.core', 'sales', 'core'] },
        },
      }).allowed,
    ).toBe(false);
    /* And the mirror: access alone is enough, with no module at all. */
    expect(hasHubOrgAccess(baseHubAuth)).toBe(true);
    expect(hasHubModule(baseHubAuth, 'sales.core')).toBe(false);
  });
});

/*
  BRIDGE COVERAGE, with a known removal date. `requireHubModule` exists only while
  this repo is on 1.3.1, which exports no access gate; slice 04 deletes the function
  and this whole describe block with it, in favour of `requireHubAuth`'s own
  `requiredModule` option. It is written anyway because the 403 half of the taxonomy
  is a feature acceptance criterion and an unexercised deny path is where a wrong
  status code hides.
*/
describe('requireHubModule', () => {
  function probe(auth: MinimalHubAuthContext | undefined) {
    const app = new Hono();
    app.use('/probe', async (c, next) => {
      if (auth) c.set('hubAuth', auth);
      await next();
    });
    app.use('/probe', requireHubModule('sales.forecasting'));
    app.get('/probe', (c) => c.json({ ok: true }));
    return app.request('http://localhost/probe');
  }

  it('answers 403 missing_module when the add-on module is absent', async () => {
    const res = await probe(baseHubAuth);
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      error: 'forbidden',
      code: 'missing_module',
      module: 'sales.forecasting',
    });
  });

  it('calls through when the add-on module is present', async () => {
    const res = await probe({
      ...baseHubAuth,
      claims: {
        ...baseHubAuth.claims,
        entitlements: { access: true, modules: ['sales.forecasting'] },
      },
    });
    expect(res.status).toBe(200);
  });

  it('answers 403 rather than throwing when there is no auth context at all', async () => {
    expect((await probe(undefined)).status).toBe(403);
  });
});

describe('resolveHubRedirectUri', () => {
  it('uses an explicit Hub redirect URI when provided', () => {
    expect(
      resolveHubRedirectUri({
        FXL_HUB_REDIRECT_URI: 'https://app.fxl-sales.com/auth/callback',
        PORT: '3006',
      }),
    ).toBe('https://app.fxl-sales.com/auth/callback');
  });

  it('uses the local web origin in development', () => {
    expect(
      resolveHubRedirectUri({ NODE_ENV: 'development', CORS_ORIGIN: 'http://localhost:8006' }),
    ).toBe('http://localhost:8006/auth/callback');
  });

  it('falls back to the local web dev port when CORS_ORIGIN is absent', () => {
    expect(resolveHubRedirectUri({ NODE_ENV: 'development', PORT: '3006' })).toBe(
      'http://localhost:8006/auth/callback',
    );
  });

  it('requires an explicit redirect URI in production', () => {
    expect(() => resolveHubRedirectUri({ NODE_ENV: 'production' })).toThrow(
      /FXL_HUB_REDIRECT_URI/,
    );
  });

  it("resolves the redirect to this app's own origin, never the Hub's", () => {
    const result = resolveHubRedirectUri({
      FXL_HUB_API_URL: 'http://localhost:9016',
      CORS_ORIGIN: 'http://localhost:8006',
      NODE_ENV: 'development',
    });

    expect(result).toBe('http://localhost:8006/auth/callback');
    // Goes red the day anyone adopts 2.x's `${config.apiUrl}/auth/callback` default.
    expect(String(result).startsWith('http://localhost:9016')).toBe(false);
  });

  it('keeps the redirect on this app origin when the Hub api url and the web origin differ', () => {
    const result = resolveHubRedirectUri({
      NODE_ENV: 'production',
      FXL_HUB_API_URL: 'https://auth.fxlbusiness.com',
      FXL_HUB_REDIRECT_URI: 'https://sales.fxlbusiness.com/auth/callback',
    });

    expect(result).toBe('https://sales.fxlbusiness.com/auth/callback');
    expect(String(result)).not.toContain('auth.fxlbusiness.com');
  });
});

describe('resolveHubPostLoginRedirect', () => {
  it('returns users to the web origin after Hub callback', () => {
    expect(resolveHubPostLoginRedirect({ CORS_ORIGIN: 'http://localhost:8006' })).toBe(
      'http://localhost:8006',
    );
  });

  it('adds an auth error query to the post-login error redirect', () => {
    expect(resolveHubPostLoginErrorRedirect({ CORS_ORIGIN: 'http://localhost:8006' })).toBe(
      'http://localhost:8006/?error=auth',
    );
  });
});
