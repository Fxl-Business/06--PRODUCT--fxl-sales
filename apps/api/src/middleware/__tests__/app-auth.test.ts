import { describe, expect, it, vi } from 'vitest';

/**
 * Blank reads as unset. This file imports `../app-auth.js` at MODULE scope, and
 * that module calls `tryLoadHubAuthConfig(hubEnvBag(env))` at its own top level.
 * There is no blanket try/catch behind that call, so whatever the developer's
 * `apps/api/.env` happens to carry decides whether this file can be imported at
 * all. `vi.stubEnv` ADDS to `process.env`; it does not clear it, and dotenv does
 * not override a key already present - so blanking here wins. `vi.hoisted` rather
 * than a `beforeAll` because a static import is evaluated first and a `beforeAll`
 * would be too late to matter.
 *
 * ALL SIX credential names, not just `FXL_HUB_CONFIG`. Blanking one of them
 * defended against only one ambient shape - the JSON form set beside the discrete
 * ones, which throws on ambiguity. As of v3.1.0 a PARTIAL discrete configuration
 * throws too, and a `.env` carrying `FXL_HUB_API_URL` and little else is the
 * ordinary state of a machine that predates the canonical names. Blanking all six
 * makes the graph unambiguously ABSENT, so `tryLoadHubAuthConfig` answers null and
 * this file's verdict depends on nothing outside it.
 *
 * Nothing here needs a configured Hub: every export under test is a pure function
 * of its argument.
 */
vi.hoisted(() => {
  vi.stubEnv('FXL_HUB_CONFIG', '');
  vi.stubEnv('FXL_HUB_API_URL', '');
  vi.stubEnv('FXL_HUB_ENVIRONMENT', '');
  vi.stubEnv('FXL_HUB_CLIENT_ID', '');
  vi.stubEnv('FXL_HUB_CLIENT_SECRET', '');
  vi.stubEnv('FXL_HUB_AUDIENCE', '');
});

import {
  getHubLegacyAuthContext,
  resolveHubPostLoginErrorRedirect,
  resolveHubPostLoginRedirect,
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

/*
  `resolveHubRedirectUri` was unit-tested here and is DELETED. Its whole job now
  belongs to `FXL_HUB_REDIRECT_URI` on the config plus the SDK's own boot check,
  and the coverage did not go with it - it moved UP a level, to
  `refuses a redirect uri on the Hub's own origin outside development` in
  `app-auth-bff-production-boot.test.ts`, which drives the REAL
  `assertBootConfiguration` instead of a local resolver this repo owned.

  Nothing is written here in its place ON PURPOSE. A presence assertion for
  FXL_HUB_REDIRECT_URI would be a second, weaker encoding of a rule the SDK owns,
  and it would pass for the operator who pastes the Hub's own callback - the one
  case the replacement exists to refuse.
*/

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
