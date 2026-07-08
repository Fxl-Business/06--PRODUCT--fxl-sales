import { describe, expect, it } from 'vitest';
import { getRoleFromHubClaims, getRolesFromHubClaims, parseJwtPayload } from '../claims';

describe('getRoleFromHubClaims', () => {
  it('maps Hub super-admins to admin', () => {
    expect(getRoleFromHubClaims({ isSuperAdmin: true, roles: { workspace: 'member' } })).toBe(
      'admin',
    );
  });

  it('maps Hub workspace admins to admin', () => {
    expect(getRoleFromHubClaims({ roles: { workspace: 'admin' } })).toBe('admin');
  });

  it('maps product admin roles to full sales access', () => {
    expect(
      getRolesFromHubClaims({ roles: { workspace: 'member', productRoles: ['admin'] } }),
    ).toEqual(['admin', 'seller', 'finder']);
  });

  it('maps product seller and finder roles independently', () => {
    expect(
      getRolesFromHubClaims({
        roles: { workspace: 'member', productRoles: ['seller', 'finder'] },
      }),
    ).toEqual(['seller', 'finder']);
  });

  it('does not grant a sales role to ordinary Hub workspace members without product roles', () => {
    expect(getRoleFromHubClaims({ roles: { workspace: 'member' } })).toBeUndefined();
  });

  it('ignores unknown product roles from display claims', () => {
    expect(
      getRolesFromHubClaims({
        roles: { workspace: 'member', productRoles: ['billing', 'seller'] },
      }),
    ).toEqual(['seller']);
  });
});

describe('parseJwtPayload', () => {
  it('decodes a base64url JWT payload without verifying display-only claims', () => {
    const payload = Buffer.from(JSON.stringify({ sub: 'acct_1', workspaceId: 'org_1' })).toString(
      'base64url',
    );

    expect(parseJwtPayload(`header.${payload}.signature`)).toMatchObject({
      sub: 'acct_1',
      workspaceId: 'org_1',
    });
  });
});
