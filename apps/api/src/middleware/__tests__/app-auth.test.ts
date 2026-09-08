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
  resolveHubPostLoginErrorRedirect,
  resolveHubPostLoginRedirect,
  resolveHubRedirectUri,
} from '../app-auth.js';
import { hubAuthContext } from '../../auth/__tests__/hub-auth-context-fixture.js';

/*
  `classifyHubAccess`, `hasHubOrgAccess`, `hasHubModule` and `requireHubModule`
  were unit-tested here and are DELETED: 2.2.0's `requireHubAuth` answers the
  whole 401/402/403 taxonomy itself, and CLAUDE.md's rule is exactly one live
  gate. Their coverage did not go with them - it moved UP a level, to
  `app-auth-access-gate.test.ts`, which now drives the real SDK verifier with a
  real signed token instead of asserting against helpers this repo owned.
*/
const baseHubAuth = hubAuthContext({ workspaceId: 'org_existing_1' });

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

  // EnvLike is Record<string, string | undefined>, so type-check cannot see a
  // key name here. These two are what pin the read to the renamed variables.
  it('prefers an explicit SALES_POST_LOGIN_REDIRECT over CORS_ORIGIN', () => {
    expect(
      resolveHubPostLoginRedirect({
        SALES_POST_LOGIN_REDIRECT: 'https://sales.fxlbusiness.com/tatico/dashboard',
        CORS_ORIGIN: 'http://localhost:8006',
      }),
    ).toBe('https://sales.fxlbusiness.com/tatico/dashboard');
  });

  it('prefers an explicit SALES_POST_LOGIN_ERROR_REDIRECT over the derived one', () => {
    expect(
      resolveHubPostLoginErrorRedirect({
        SALES_POST_LOGIN_ERROR_REDIRECT: 'https://sales.fxlbusiness.com/entrar',
        SALES_POST_LOGIN_REDIRECT: 'https://sales.fxlbusiness.com',
        CORS_ORIGIN: 'http://localhost:8006',
      }),
    ).toBe('https://sales.fxlbusiness.com/entrar');
  });

  it('falls back to / and /?error=auth when neither the pair nor CORS_ORIGIN is set', () => {
    expect(resolveHubPostLoginRedirect({})).toBe('/');
    expect(resolveHubPostLoginErrorRedirect({})).toBe('/?error=auth');
  });
});
