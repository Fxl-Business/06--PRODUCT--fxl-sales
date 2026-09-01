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

import {
  getHubLegacyAuthContext,
  hasHubCoreEntitlement,
  resolveHubPostLoginErrorRedirect,
  resolveHubPostLoginRedirect,
  resolveHubRedirectUri,
  type MinimalHubAuthContext,
} from '../app-auth.js';

const baseHubAuth: MinimalHubAuthContext = {
  accountId: 'hub-account-1',
  workspaceId: 'org_existing_1',
  claims: {
    entitlements: { modules: ['sales.core'] },
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

describe('hasHubCoreEntitlement', () => {
  it('accepts the configured core module', () => {
    expect(hasHubCoreEntitlement(baseHubAuth, 'sales.core')).toBe(true);
  });

  it('rejects workspaces without the configured core module', () => {
    expect(
      hasHubCoreEntitlement(
        {
          ...baseHubAuth,
          claims: { ...baseHubAuth.claims, entitlements: { modules: [] } },
        },
        'sales.core',
      ),
    ).toBe(false);
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
