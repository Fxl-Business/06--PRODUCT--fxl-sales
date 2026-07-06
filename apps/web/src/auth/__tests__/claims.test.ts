import { describe, expect, it } from 'vitest';
import { getRoleFromHubClaims, parseJwtPayload } from '../claims';

describe('getRoleFromHubClaims', () => {
  it('maps Hub super-admins to admin', () => {
    expect(getRoleFromHubClaims({ isSuperAdmin: true, roles: { workspace: 'member' } })).toBe(
      'admin',
    );
  });

  it('maps Hub workspace admins to admin', () => {
    expect(getRoleFromHubClaims({ roles: { workspace: 'admin' } })).toBe('admin');
  });

  it('maps ordinary Hub workspace members to finder', () => {
    expect(getRoleFromHubClaims({ roles: { workspace: 'member' } })).toBe('finder');
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
