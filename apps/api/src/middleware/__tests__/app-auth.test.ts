import { describe, expect, it } from 'vitest';
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
