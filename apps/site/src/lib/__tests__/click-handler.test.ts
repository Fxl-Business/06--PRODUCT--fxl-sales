import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Branch tests for handleReferralClick (plan-brief WARN): revoked→410,
 * expired→410, host-mismatch→500, valid→302 (with ?ref + &fxl_sig + Set-Cookie),
 * not-found→410. Mocks ./db (the query layer) + the shared HMAC util so no live
 * DB is needed.
 */

// Holds the link row the mocked SELECT will return for the next call.
let selectResult: unknown[] = [];
const insertValues = vi.fn().mockResolvedValue(undefined);

vi.mock('../db', () => {
  const selectChain = {
    from: () => selectChain,
    innerJoin: () => selectChain,
    where: () => selectChain,
    limit: () => Promise.resolve(selectResult),
  };
  return {
    getDb: () => ({
      select: () => selectChain,
      insert: () => ({ values: insertValues }),
    }),
    referralLinks: {},
    apps: {},
    clicks: {},
  };
});

vi.mock('@fxl-sales/shared-utils/hmac', () => ({
  signReferralUrl: () => 'fxlsig_mocked',
  hashIp: () => 'iphash_mocked',
  dailySalt: () => 'salt_mocked',
}));

// ulidx mocked to a deterministic click_id.
vi.mock('ulidx', () => ({ ulid: () => '01HXTESTCLICKID0000000000' }));

const { handleReferralClick } = await import('../click-handler');

const ACTIVE_LINK = {
  id: 'link-uuid',
  orgId: 'org_a',
  finderId: 'finder-uuid',
  appId: 'app-uuid',
  productId: 'product-uuid',
  signature: 'linksig',
  destinationUrl: 'https://checkout.example.com/precos',
  status: 'active',
  expiresAt: null as Date | null,
  revokedAt: null as Date | null,
  webhookSigningSecret: 'whs_secret',
  allowedRedirectHosts: ['checkout.example.com'],
};

function req(): Request {
  return new Request('https://finders.example.com/r/abc123', {
    headers: { 'user-agent': 'Mozilla/5.0 Chrome/120.0' },
  });
}

beforeEach(() => {
  insertValues.mockClear();
  selectResult = [];
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('handleReferralClick branches', () => {
  it('not-found code → 410', async () => {
    selectResult = [];
    const res = await handleReferralClick('nope', req());
    expect(res.status).toBe(410);
    expect(insertValues).not.toHaveBeenCalled();
  });

  it('revoked link → 410', async () => {
    selectResult = [{ ...ACTIVE_LINK, status: 'revoked', revokedAt: new Date() }];
    const res = await handleReferralClick('abc123', req());
    expect(res.status).toBe(410);
    expect(insertValues).not.toHaveBeenCalled();
  });

  it('expired link → 410', async () => {
    selectResult = [{ ...ACTIVE_LINK, expiresAt: new Date(Date.now() - 1000) }];
    const res = await handleReferralClick('abc123', req());
    expect(res.status).toBe(410);
    expect(insertValues).not.toHaveBeenCalled();
  });

  it('destination host NOT in allowlist → 500 (no detail leaked)', async () => {
    selectResult = [{ ...ACTIVE_LINK, allowedRedirectHosts: ['other.example.com'] }];
    const res = await handleReferralClick('abc123', req());
    expect(res.status).toBe(500);
    expect(insertValues).not.toHaveBeenCalled();
  });

  it('unparseable destination_url → 500', async () => {
    selectResult = [{ ...ACTIVE_LINK, destinationUrl: 'not-a-url' }];
    const res = await handleReferralClick('abc123', req());
    expect(res.status).toBe(500);
  });

  it('valid active link → 302 with ?ref + &fxl_sig + Set-Cookie, clicks inserted', async () => {
    selectResult = [{ ...ACTIVE_LINK }];
    const res = await handleReferralClick('abc123', req());
    expect(res.status).toBe(302);

    const location = res.headers.get('Location') ?? '';
    expect(location).toContain('https://checkout.example.com/precos');
    expect(location).toContain('ref=01HXTESTCLICKID0000000000');
    expect(location).toContain('fxl_sig=fxlsig_mocked');

    const cookie = res.headers.get('Set-Cookie') ?? '';
    expect(cookie).toContain('fxl_ref=01HXTESTCLICKID0000000000');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Max-Age=7776000');

    // clicks row inserted SYNCHRONOUSLY before the redirect.
    expect(insertValues).toHaveBeenCalledTimes(1);
    const inserted = insertValues.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(inserted.clickId).toBe('01HXTESTCLICKID0000000000');
    expect(inserted.orgId).toBe('org_a');
    expect(inserted.uaFamily).toBe('chrome');
  });
});
