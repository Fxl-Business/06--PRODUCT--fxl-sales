import { describe, expect, it } from 'vitest';
import {
  DEFAULT_IDENTITY_ID,
  DEV_TOKEN_SIGNATURE,
  DEV_TOKEN_TTL_SECONDS,
  FXL_SALES_DEV_FAKE_ROSTER_SENTINEL,
  IDENTITIES,
  SALES_APPLICATION,
  WORKSPACES_CLAIM_CAP,
  allFakeOrgIds,
  findIdentity,
  findIdentityByAccountId,
  identityHasWorkspace,
  mintDevToken,
  readTokenSubject,
  readTokenWorkspaceId,
  toHubAuthContext,
  toHubClaims,
  type FakeIdentity,
} from '../index.js';

const FIXED_NOW = 1_700_000_000;

function base64UrlDecodeJson(part: string): unknown {
  const restored = part.replace(/-/g, '+').replace(/_/g, '/');
  const padded = restored.padEnd(Math.ceil(restored.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  const json = new TextDecoder().decode(bytes);
  return JSON.parse(json);
}

describe('roster coherence', () => {
  it('has unique switch keys', () => {
    const ids = IDENTITIES.map((identity) => identity.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has unique account ids, so bearer-subject resolution is unambiguous', () => {
    const accountIds = IDENTITIES.map((identity) => identity.accountId);
    expect(new Set(accountIds).size).toBe(accountIds.length);
  });

  it('gives every identity an active Organization it is actually a member of', () => {
    for (const identity of IDENTITIES) {
      const memberIds = identity.workspaces.map((workspace) => workspace.workspaceId);
      expect(memberIds).toContain(identity.activeWorkspaceId);
    }
  });

  it('resolves the default identity, and refuses an unknown one', () => {
    expect(findIdentity(DEFAULT_IDENTITY_ID)).toBeDefined();
    expect(findIdentity('nobody')).toBeUndefined();
    expect(findIdentity(undefined)).toBeUndefined();
    expect(findIdentity(null)).toBeUndefined();
    expect(findIdentityByAccountId('user_nobody')).toBeUndefined();
    expect(findIdentityByAccountId(null)).toBeUndefined();
  });
});

describe('branch coverage', () => {
  it('covers every role set the real claim translation can produce', () => {
    const roleSets = new Set(IDENTITIES.map((identity) => identity.expectedRoles.join('|')));
    expect(roleSets).toEqual(
      new Set(['admin|seller|finder', 'seller', 'finder', 'seller|finder', '']),
    );
  });

  it('covers every painel set the real visibility rule can produce', () => {
    const paineisSets = new Set(IDENTITIES.map((identity) => identity.expectedPaineis.join('|')));
    expect(paineisSets).toEqual(
      new Set(['tatico|operacional|cadastros|meus-dados', 'meus-dados', '']),
    );
  });

  it('records that the admin-only role set is unreachable through the real claim translation', () => {
    // F3: every branch in getRolesFromHubClaims that can yield 'admin' returns the whole
    // full-access array, so no claim shape produces ['admin'] alone. Faking that role set
    // directly would model a state the real app can never reach.
    const hasAdminOnly = IDENTITIES.some(
      (identity) => identity.expectedRoles.length === 1 && identity.expectedRoles[0] === 'admin',
    );
    expect(hasAdminOnly).toBe(false);
  });

  it('reaches the full-access role set by three DIFFERENT claim shapes', () => {
    const fullAccess = IDENTITIES.filter(
      (identity) => identity.expectedRoles.join('|') === 'admin|seller|finder',
    );
    expect(fullAccess.some((identity) => identity.workspaceRole === 'owner')).toBe(true);
    expect(fullAccess.some((identity) => identity.workspaceRole === 'admin')).toBe(true);
    expect(
      fullAccess.some(
        (identity) =>
          identity.workspaceRole === 'member' && identity.productRoles?.includes('admin'),
      ),
    ).toBe(true);
  });

  it('names exactly one identity whose Organization carries no access, and gives it somewhere to switch to', () => {
    const noAccess = IDENTITIES.filter((identity) => !identity.hasAccess);
    expect(noAccess.map((identity) => identity.id)).toEqual(['no-access']);
    const identity = noAccess[0]!;
    expect(identity.workspaces.length).toBeGreaterThan(1);
    expect(
      identity.workspaces.some(
        (workspace) =>
          workspace.workspaceId !== identity.activeWorkspaceId &&
          workspace.products.includes(SALES_APPLICATION),
      ),
    ).toBe(true);
  });

  it('gives the no-role identity a role the app does not recognize, not an empty list', () => {
    const identity = findIdentity('no-role')!;
    expect(identity.productRoles).toEqual(['viewer']);
    expect(identity.expectedRoles).toEqual([]);
  });

  it('gives the multi-org identity two ENTITLED Organizations', () => {
    const identity = findIdentity('multi-org')!;
    expect(identity.workspaces.length).toBe(2);
    expect(identity.hasAccess).toBe(true);
    for (const workspace of identity.workspaces) {
      expect(workspace.products).toContain(SALES_APPLICATION);
    }
  });
});

describe('toHubClaims', () => {
  it('announces contract version 1, which is the only version requireHubAuth accepts', () => {
    for (const identity of IDENTITIES) {
      expect(toHubClaims(identity).contractVersion).toBe(1);
    }
  });

  it('carries Effective Access explicitly and never derives it from modules', () => {
    for (const identity of IDENTITIES) {
      expect(identity.modules).toEqual([]);
      expect(toHubClaims(identity).entitlements).toEqual({
        access: identity.hasAccess,
        modules: [],
      });
    }
    expect(IDENTITIES.some((identity) => identity.hasAccess && identity.modules.length === 0)).toBe(
      true,
    );
  });

  it('names the Audience as app.fxl-sales', () => {
    expect(SALES_APPLICATION).toBe('app.fxl-sales');
    for (const identity of IDENTITIES) {
      expect(toHubClaims(identity).aud).toBe(SALES_APPLICATION);
    }
  });

  it('emits the Organization preview keyed workspaceId, which is what the web reader reads', () => {
    const identity = findIdentity('multi-org')!;
    const claims = toHubClaims(identity) as { workspaces: unknown };
    const workspaces = claims.workspaces as Array<Record<string, unknown>>;
    expect(workspaces.length).toBeGreaterThan(0);
    for (const entry of workspaces) {
      expect(typeof entry.workspaceId).toBe('string');
      expect(typeof entry.name).toBe('string');
      expect(entry.role).toBeDefined();
      expect(Array.isArray(entry.products)).toBe(true);
      expect('id' in entry).toBe(false);
    }
  });

  it('caps the Organization preview at WORKSPACES_CLAIM_CAP', () => {
    for (const identity of IDENTITIES) {
      const claims = toHubClaims(identity) as { workspaces: unknown[] };
      expect(claims.workspaces.length).toBeLessThanOrEqual(WORKSPACES_CLAIM_CAP);
    }
  });

  it('emits isSuperAdmin only when true', () => {
    for (const identity of IDENTITIES) {
      expect('isSuperAdmin' in toHubClaims(identity)).toBe(false);
    }
  });

  it('names the ACTIVE Organization so no surface renders a raw id', () => {
    for (const identity of IDENTITIES) {
      const claims = toHubClaims(identity) as {
        workspaceId: string;
        workspaceName: string;
        workspaces: Array<{ workspaceId: string; name: string }>;
      };
      const match = claims.workspaces.find((entry) => entry.workspaceId === claims.workspaceId);
      expect(match).toBeDefined();
      expect(claims.workspaceName).toBe(match!.name);
    }
  });

  it('omits avatarUrl, which the reader already handles', () => {
    for (const identity of IDENTITIES) {
      expect('avatarUrl' in toHubClaims(identity)).toBe(false);
    }
  });

  it('emits productRoles only when the identity has a Seat', () => {
    for (const identity of IDENTITIES) {
      const claims = toHubClaims(identity) as { roles: Record<string, unknown> };
      if (identity.productRoles) {
        expect('productRoles' in claims.roles).toBe(true);
      } else {
        expect('productRoles' in claims.roles).toBe(false);
      }
    }
  });

  it('is deterministic for a given nowSeconds', () => {
    for (const identity of IDENTITIES) {
      const first = toHubClaims(identity, { nowSeconds: FIXED_NOW });
      const second = toHubClaims(identity, { nowSeconds: FIXED_NOW });
      expect(first).toEqual(second);
      const claims = first as { iat: number; exp: number };
      expect(claims.exp - claims.iat).toBe(DEV_TOKEN_TTL_SECONDS);
    }
  });
});

describe('toHubAuthContext', () => {
  it('projects the same claims object it exposes, never a rebuild', () => {
    for (const identity of IDENTITIES) {
      const ctx = toHubAuthContext(identity, { nowSeconds: FIXED_NOW });
      const claims = toHubClaims(identity, { nowSeconds: FIXED_NOW });
      expect(ctx.claims).toEqual(claims);
      expect(ctx.accountId).toBe((claims as { sub: string }).sub);
      expect(ctx.workspaceId).toBe((claims as { workspaceId: string }).workspaceId);
      expect(ctx.entitlements).toEqual((claims as { entitlements: unknown }).entitlements);
      expect(ctx.roles).toEqual((claims as { roles: unknown }).roles);
      expect(ctx.aud).toBe((claims as { aud: string }).aud);
    }
  });
});

describe('mintDevToken', () => {
  it('mints a structurally valid three-part JWT whose payload decodes to the same claims', () => {
    for (const identity of IDENTITIES) {
      const token = mintDevToken(identity, { nowSeconds: FIXED_NOW });
      const parts = token.split('.');
      expect(parts.length).toBe(3);
      expect(parts[2]).toBe(DEV_TOKEN_SIGNATURE);
      const decodedPayload = base64UrlDecodeJson(parts[1]!);
      expect(decodedPayload).toEqual(toHubClaims(identity, { nowSeconds: FIXED_NOW }));
    }
  });

  it('announces alg none and typ at+jwt in the header', () => {
    const identity = IDENTITIES[0]!;
    const token = mintDevToken(identity, { nowSeconds: FIXED_NOW });
    const [headerPart] = token.split('.');
    const header = base64UrlDecodeJson(headerPart!);
    expect(header).toEqual({ alg: 'none', typ: 'at+jwt' });
  });

  it('never claims to be signed', () => {
    const identity = IDENTITIES[0]!;
    const token = mintDevToken(identity, { nowSeconds: FIXED_NOW });
    const parts = token.split('.');
    expect(parts[2]).toBe('development-not-a-signature');
  });

  it('survives a non-ASCII display name', () => {
    const base = findIdentity('seller')!;
    const identity: FakeIdentity = {
      ...base,
      profile: { ...base.profile, name: 'Joao Coracao' },
    };
    const accented: FakeIdentity = {
      ...identity,
      profile: { ...identity.profile, name: 'João Coração' },
    };
    const token = mintDevToken(accented, { nowSeconds: FIXED_NOW });
    const parts = token.split('.');
    const payload = base64UrlDecodeJson(parts[1]!) as { name: string };
    expect(payload.name).toBe('João Coração');
  });
});

describe('readTokenSubject', () => {
  it('recovers the account id from a minted token', () => {
    for (const identity of IDENTITIES) {
      const token = mintDevToken(identity, { nowSeconds: FIXED_NOW });
      const sub = readTokenSubject(token);
      expect(sub).toBe(identity.accountId);
      expect(findIdentityByAccountId(sub)).toBe(identity);
    }
  });

  it('returns null for anything that is not a decodable three-part JWT', () => {
    expect(readTokenSubject(null)).toBeNull();
    expect(readTokenSubject(undefined)).toBeNull();
    expect(readTokenSubject('')).toBeNull();
    expect(readTokenSubject('a.b')).toBeNull();
    expect(readTokenSubject('a.b.c.d')).toBeNull();
    expect(readTokenSubject('a..c')).toBeNull();
    expect(readTokenSubject('a.%%%.c')).toBeNull();

    const arrayPayload = btoa('[1,2,3]').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(readTokenSubject(`a.${arrayPayload}.c`)).toBeNull();

    const nonStringSubPayload = btoa(JSON.stringify({ sub: 42 }))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    expect(readTokenSubject(`a.${nonStringSubPayload}.c`)).toBeNull();
  });
});

describe('the active Organization override', () => {
  it('pins hasAccess as a declared expectation against what toHubClaims computes', () => {
    for (const identity of IDENTITIES) {
      const claims = toHubClaims(identity) as { entitlements: { access: boolean } };
      expect(claims.entitlements.access).toBe(identity.hasAccess);
    }
  });

  it('mints an entitled token for an entitled Organization the identity switched to', () => {
    const identity = findIdentity('no-access')!;
    const claims = toHubClaims(identity, { organizationId: 'org_fake_norte' }) as {
      entitlements: { access: boolean };
      workspaceId: string;
    };
    expect(claims.entitlements.access).toBe(true);
    expect(claims.workspaceId).toBe('org_fake_norte');
  });

  it('ignores an Organization the identity does not belong to, rather than honouring it', () => {
    const identity = findIdentity('seller')!;
    const claims = toHubClaims(identity, { organizationId: 'org_fake_sul' }) as {
      workspaceId: string;
    };
    expect(claims.workspaceId).toBe(identity.activeWorkspaceId);
    expect(identityHasWorkspace(identity, 'org_fake_sul')).toBe(false);
  });

  it('readTokenWorkspaceId recovers the ACTIVE Organization from a minted token', () => {
    for (const identity of IDENTITIES) {
      const token = mintDevToken(identity, { nowSeconds: FIXED_NOW });
      const claims = toHubClaims(identity, { nowSeconds: FIXED_NOW }) as { workspaceId: string };
      expect(readTokenWorkspaceId(token)).toBe(claims.workspaceId);
    }

    const identity = findIdentity('no-access')!;
    const options = { nowSeconds: FIXED_NOW, organizationId: 'org_fake_norte' };
    const token = mintDevToken(identity, options);
    const claims = toHubClaims(identity, options) as { workspaceId: string };
    expect(readTokenWorkspaceId(token)).toBe(claims.workspaceId);

    expect(readTokenWorkspaceId(null)).toBeNull();
    expect(readTokenWorkspaceId(undefined)).toBeNull();
    expect(readTokenWorkspaceId('')).toBeNull();
    expect(readTokenWorkspaceId('a.b')).toBeNull();
    expect(readTokenWorkspaceId('a.b.c.d')).toBeNull();
    expect(readTokenWorkspaceId('a..c')).toBeNull();
    expect(readTokenWorkspaceId('a.%%%.c')).toBeNull();
  });

  it('exports the bundle sentinel', () => {
    expect(FXL_SALES_DEV_FAKE_ROSTER_SENTINEL).toBe('FXL_SALES_DEV_FAKE_ROSTER_SENTINEL');
  });
});

describe('allFakeOrgIds', () => {
  it('lists every org id the roster references, deduplicated', () => {
    const ids = allFakeOrgIds();
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBe(3);
    expect(new Set(ids)).toEqual(
      new Set(['org_fake_norte', 'org_fake_sul', 'org_fake_sem_acesso']),
    );
  });

  it("covers every identity's active Organization", () => {
    const ids = allFakeOrgIds();
    for (const identity of IDENTITIES) {
      expect(ids).toContain(identity.activeWorkspaceId);
    }
  });
});
