import { __clearDiscoveryCache } from '@fxl-business/hub-sdk';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createAppAuthBff,
  createAppAuthMiddleware,
  getHubLegacyAuthContext,
  hasHubCoreEntitlement,
  resolveHubPostLoginErrorRedirect,
  resolveHubPostLoginRedirect,
  resolveHubRedirectUri,
  type AppHubAuthContext,
} from '../app-auth.js';

type IsAny<Value> = 0 extends 1 & Value ? true : false;

function expectCompileTimeFalse<Value extends false>(value?: Value): void {
  void value;
}

function expectAppHubAuthContext(auth: AppHubAuthContext): void {
  void auth;
}

expectCompileTimeFalse<IsAny<AppHubAuthContext['accountId']>>();
expectCompileTimeFalse<IsAny<AppHubAuthContext['workspaceId']>>();
expectCompileTimeFalse<IsAny<AppHubAuthContext['entitlements']>>();
expectCompileTimeFalse<IsAny<AppHubAuthContext['entitlements']['modules']>>();
expectCompileTimeFalse<IsAny<AppHubAuthContext['roles']>>();
expectCompileTimeFalse<IsAny<AppHubAuthContext['roles']['workspace']>>();

expectAppHubAuthContext({
  // @ts-expect-error Verified Hub account ids must be strings.
  accountId: 123,
  workspaceId: 'workspace-1',
  entitlements: { modules: ['sales.core'] },
  roles: { workspace: 'member' },
});
expectAppHubAuthContext({
  accountId: 'account-1',
  // @ts-expect-error Verified Hub workspace ids must be strings.
  workspaceId: null,
  entitlements: { modules: ['sales.core'] },
  roles: { workspace: 'member' },
});
expectAppHubAuthContext({
  accountId: 'account-1',
  workspaceId: 'workspace-1',
  // @ts-expect-error Verified Hub entitlements must expose string modules.
  entitlements: 'not-entitlements',
  roles: { workspace: 'member' },
});
expectAppHubAuthContext({
  accountId: 'account-1',
  workspaceId: 'workspace-1',
  entitlements: { modules: ['sales.core'] },
  // @ts-expect-error Verified Hub roles must expose a string workspace role.
  roles: false,
});

const registeredEnv = {
  NODE_ENV: 'test',
  FXL_HUB_API_URL: 'http://hub.test',
  FXL_HUB_PUBLISHABLE_KEY: 'pk_fxl-sales_VzQ9-LUONCnlKllxCRLffN3nw6Z9PQl2',
  FXL_HUB_SECRET_KEY: 'sk_test_not-production',
  FXL_HUB_REDIRECT_URI: 'http://localhost:8006/auth/callback',
  FXL_HUB_POST_LOGIN_REDIRECT: 'http://web.test/after-login',
  FXL_HUB_POST_LOGIN_ERROR_REDIRECT: 'http://web.test/auth-error',
};

const baseHubAuth: AppHubAuthContext = {
  accountId: 'hub-account-1',
  workspaceId: 'org_existing_1',
  entitlements: { modules: ['sales.core'] },
  roles: { workspace: 'member' },
};

const discoveryDocument = {
  issuer: 'http://hub.test',
  authorization_endpoint: 'http://hub.test/oauth/authorize',
  token_endpoint: 'http://hub.test/oauth/token',
  fxl_web_url: 'http://hub.test',
};

function requestUrl(input: string | URL | Request): string {
  if (typeof input === 'string') {
    return input;
  }
  return input instanceof URL ? input.toString() : input.url;
}

function discoveryFetch(): typeof fetch {
  return async (input) => {
    const url = requestUrl(input);
    if (url === 'http://hub.test/.well-known/oauth-authorization-server') {
      return Response.json(discoveryDocument);
    }
    throw new Error(`Unexpected upstream request: ${url}`);
  };
}

function cookiePair(setCookie: string | null, name: string): string {
  const match = new RegExp(`(?:^|,\\s*)${name}=([^;]+)`).exec(setCookie ?? '');
  if (!match?.[1]) {
    throw new Error(`Missing ${name} cookie`);
  }
  return `${name}=${match[1]}`;
}

describe('verified Hub claims mapping', () => {
  it('maps verified Hub account and workspace ids into the Hono auth context', () => {
    expect(getHubLegacyAuthContext(baseHubAuth)).toEqual({
      userId: 'hub-account-1',
      orgId: 'org_existing_1',
      userRole: undefined,
      userRoles: [],
    });
  });

  it('maps verified workspace owners and admins to the existing admin guard role', () => {
    for (const workspace of ['owner', 'admin']) {
      expect(
        getHubLegacyAuthContext({
          ...baseHubAuth,
          roles: { workspace },
        }).userRole,
      ).toBe('admin');
    }
  });

  it('does not elevate a member from optional raw product or super-admin claims', () => {
    const authWithRawClaims = {
      ...baseHubAuth,
      claims: {
        isSuperAdmin: true,
        roles: { workspace: 'owner', productRoles: ['admin', 'seller', 'finder'] },
      },
    };

    expect(getHubLegacyAuthContext(authWithRawClaims)).toMatchObject({
      userRole: undefined,
      userRoles: [],
    });
  });

  it('accepts sales.core from verified entitlements.modules', () => {
    expect(hasHubCoreEntitlement(baseHubAuth, 'sales.core')).toBe(true);
  });

  it('rejects a workspace without sales.core even when optional raw claims advertise it', () => {
    const authWithRawClaims = {
      ...baseHubAuth,
      entitlements: { modules: [] },
      claims: { entitlements: { modules: ['sales.core'] } },
    };

    expect(hasHubCoreEntitlement(authWithRawClaims, 'sales.core')).toBe(false);
  });
});

describe('real Hub SDK composition', () => {
  beforeEach(() => {
    __clearDiscoveryCache();
  });

  afterEach(() => {
    __clearDiscoveryCache();
  });

  it('exposes the complete SDK BFF route surface at same-origin auth paths', async () => {
    const authBff = createAppAuthBff(registeredEnv, { fetchImpl: discoveryFetch() });
    if (!authBff) {
      throw new Error('Expected the registered Hub BFF config to load');
    }
    const app = new Hono();
    app.route('', authBff);

    const loginResponse = await app.request('/auth/login');
    const loginUrl = new URL(loginResponse.headers.get('location') ?? '');
    expect(loginResponse.status).toBe(302);
    expect(`${loginUrl.origin}${loginUrl.pathname}`).toBe('http://hub.test/oauth/authorize');
    expect(loginUrl.searchParams.get('client_id')).toBe(registeredEnv.FXL_HUB_PUBLISHABLE_KEY);
    expect(loginUrl.searchParams.get('redirect_uri')).toBe(registeredEnv.FXL_HUB_REDIRECT_URI);
    expect(loginUrl.searchParams.get('state')).toBeTruthy();
    expect(loginUrl.searchParams.get('code_challenge')).toBeTruthy();
    expect(loginUrl.searchParams.get('code_challenge_method')).toBe('S256');

    const callbackResponse = await app.request('/auth/callback?code=invalid&state=invalid');
    expect(callbackResponse.status).toBe(302);
    expect(callbackResponse.headers.get('location')).toBe(
      registeredEnv.FXL_HUB_POST_LOGIN_ERROR_REDIRECT,
    );

    for (const path of ['/auth/refresh', '/auth/switch']) {
      const response = await app.request(path, { method: 'POST' });
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: 'no_session' });
    }

    const logoutResponse = await app.request('/auth/logout', { method: 'POST' });
    expect(logoutResponse.status).toBe(204);
  });

  it('fails a protected route closed through the SDK verifier when no bearer token is present', async () => {
    let probeReached = false;
    const app = new Hono();
    app.use('/probe', createAppAuthMiddleware(registeredEnv, { fetchImpl: discoveryFetch() }));
    app.get('/probe', (c) => {
      probeReached = true;
      return c.json({ ok: true });
    });

    const response = await app.request('/probe');

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: 'unauthorized', code: 'missing_token' });
    expect(probeReached).toBe(false);
  });

  it('uses product.fxl-sales in SDK refresh requests', async () => {
    const upstreamRequests: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      const url = requestUrl(input);
      upstreamRequests.push(url);
      if (url === 'http://hub.test/.well-known/oauth-authorization-server') {
        return Response.json(discoveryDocument);
      }
      if (url === discoveryDocument.token_endpoint) {
        return Response.json({
          access_token: 'access-token',
          refresh_token: 'opaque-refresh-token',
        });
      }
      if (url.startsWith('http://hub.test/auth/refresh?')) {
        return Response.json({ accessToken: 'refreshed-access-token', expiresIn: 300 });
      }
      throw new Error(`Unexpected upstream request: ${url}`);
    };
    const authBff = createAppAuthBff(registeredEnv, { fetchImpl });
    if (!authBff) {
      throw new Error('Expected the registered Hub BFF config to load');
    }
    const app = new Hono();
    app.route('', authBff);

    const loginResponse = await app.request('/auth/login');
    const loginLocation = new URL(loginResponse.headers.get('location') ?? '');
    const loginCookie = cookiePair(loginResponse.headers.get('set-cookie'), 'fxl_hub_login');
    const callbackResponse = await app.request(
      `/auth/callback?code=valid-code&state=${loginLocation.searchParams.get('state')}`,
      { headers: { Cookie: loginCookie } },
    );
    const sessionCookie = cookiePair(
      callbackResponse.headers.get('set-cookie'),
      'fxl_hub_session',
    );

    const refreshResponse = await app.request('/auth/refresh', {
      method: 'POST',
      headers: { Cookie: sessionCookie },
    });
    expect(refreshResponse.status).toBe(200);

    const refreshRequest = upstreamRequests.find((url) => url.includes('/auth/refresh?'));
    expect(refreshRequest).toBeTruthy();
    const productId = new URL(refreshRequest ?? '').searchParams.get('productId');
    expect(productId).toBe('product.fxl-sales');
    expect(productId).not.toBe(registeredEnv.FXL_HUB_PUBLISHABLE_KEY);
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
