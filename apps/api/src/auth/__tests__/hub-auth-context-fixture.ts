/**
 * One complete, valid `HubAuthContext`, for every test that needs to put an
 * already-verified caller on the Context.
 *
 * It exists because 2.2.0 ships the REAL contract types: `HubAuthContext`
 * carries top-level `entitlements`, `roles` and `aud` alongside the full
 * `HubTokenClaims`, so the partial object literals these tests used to inline
 * against the old hand-rolled `MinimalHubAuthContext` no longer type-check.
 *
 * Being forced to build a whole context is the point rather than a nuisance: a
 * partial literal is how a test ends up asserting against a claim shape the Hub
 * never mints. Overrides are DEEP on the two members tests actually vary, so a
 * caller changes one thing and inherits a valid rest.
 *
 * This is a fixture, not a token. Nothing here is signed and nothing here is a
 * credential; tests that need the verifier to run drive a real signed token
 * instead, in `app-auth-access-gate.test.ts`.
 */
import type { HubAuthContext, HubEntitlements, HubRoles } from '@fxl-business/hub-sdk';

const AUDIENCE = 'app.fxl-sales';

type Overrides = {
  accountId?: string;
  workspaceId?: string;
  entitlements?: Partial<HubEntitlements>;
  roles?: Partial<HubRoles>;
  name?: string;
  email?: string;
  isSuperAdmin?: boolean;
  contractVersion?: number;
};

export function hubAuthContext(overrides: Overrides = {}): HubAuthContext {
  const accountId = overrides.accountId ?? 'hub-account-1';
  const workspaceId = overrides.workspaceId ?? 'org_active_1';
  const entitlements: HubEntitlements = {
    access: true,
    modules: [],
    ...overrides.entitlements,
  };
  const roles: HubRoles = {
    workspace: 'member',
    ...overrides.roles,
  };
  const now = Math.floor(Date.now() / 1000);

  return {
    accountId,
    workspaceId,
    entitlements,
    roles,
    aud: AUDIENCE,
    claims: {
      iss: 'https://auth.fxlbusiness.test',
      aud: AUDIENCE,
      sub: accountId,
      workspaceId,
      contractVersion: overrides.contractVersion ?? 1,
      entitlements,
      roles,
      typ: 'at+jwt',
      iat: now,
      exp: now + 300,
      jti: 'test-jti',
      ...(overrides.name !== undefined ? { name: overrides.name } : {}),
      ...(overrides.email !== undefined ? { email: overrides.email } : {}),
      ...(overrides.isSuperAdmin !== undefined ? { isSuperAdmin: overrides.isSuperAdmin } : {}),
    },
  };
}
