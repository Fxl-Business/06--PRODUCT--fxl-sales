import { describe, expect, it } from 'vitest';
import {
  buildLinkCode,
  buildLinkSignature,
  resolveFinderId,
  validateDestinationHost,
  validatePriceBand,
} from '../service.js';

describe('validatePriceBand', () => {
  const band = { minBrl: 80000, maxBrl: 150000 };

  it('returns true when within [min, max] inclusive', () => {
    expect(validatePriceBand(band, 100000)).toBe(true);
  });

  it('returns false when below min', () => {
    expect(validatePriceBand(band, 79999)).toBe(false);
  });

  it('returns false when above max', () => {
    expect(validatePriceBand(band, 150001)).toBe(false);
  });

  it('returns true at the min boundary (inclusive)', () => {
    expect(validatePriceBand(band, 80000)).toBe(true);
  });

  it('returns true at the max boundary (inclusive)', () => {
    expect(validatePriceBand(band, 150000)).toBe(true);
  });
});

describe('buildLinkSignature (D-P link.signature)', () => {
  const secret = 'whs_test_secret';

  it('returns a 64-char hex string', () => {
    const sig = buildLinkSignature('finder-uuid', 'product-uuid', 100000, 10000, secret);
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic (same inputs → same output)', () => {
    const a = buildLinkSignature('f', 'p', 1, 2, secret);
    const b = buildLinkSignature('f', 'p', 1, 2, secret);
    expect(a).toBe(b);
  });

  it('changes when any input changes', () => {
    const base = buildLinkSignature('f', 'p', 1, 2, secret);
    expect(buildLinkSignature('f2', 'p', 1, 2, secret)).not.toBe(base);
    expect(buildLinkSignature('f', 'p2', 1, 2, secret)).not.toBe(base);
    expect(buildLinkSignature('f', 'p', 99, 2, secret)).not.toBe(base);
    expect(buildLinkSignature('f', 'p', 1, 99, secret)).not.toBe(base);
    expect(buildLinkSignature('f', 'p', 1, 2, 'other_secret')).not.toBe(base);
  });

  it('uses the exact ":" join order [finderId,productId,setup,monthly] (D-P)', async () => {
    const { signHmac } = await import('@fxl-sales/shared-utils');
    const expected = signHmac(secret, ['f', 'p', '100', '200'].join(':'));
    expect(buildLinkSignature('f', 'p', 100, 200, secret)).toBe(expected);
  });
});

describe('buildLinkCode', () => {
  it('returns a 10-char string', () => {
    expect(buildLinkCode()).toHaveLength(10);
  });

  it('returns only lowercase alphanumeric chars (ULID base32 set)', () => {
    expect(buildLinkCode()).toMatch(/^[0-9a-z]{10}$/);
  });

  it('is non-deterministic across calls', () => {
    expect(buildLinkCode()).not.toBe(buildLinkCode());
  });
});

describe('validateDestinationHost (EXACT equality — open-redirect defense)', () => {
  it('returns true when URL host EXACTLY equals an allowed host', () => {
    expect(validateDestinationHost('https://app.fxl.com.br/precos', ['app.fxl.com.br'])).toBe(true);
  });

  it('returns false when host is not in the allowed list', () => {
    expect(validateDestinationHost('https://evil.com/precos', ['app.fxl.com.br'])).toBe(false);
  });

  it('returns false for a different subdomain', () => {
    expect(
      validateDestinationHost('https://other.fxl.com.br/x', ['app.fxl.com.br']),
    ).toBe(false);
  });

  it('returns false for a substring/suffix near-match (evil-fxl.com.br)', () => {
    expect(validateDestinationHost('https://evil-fxl.com.br/x', ['fxl.com.br'])).toBe(false);
  });

  it('returns false for an appended-suffix near-match (fxl.com.br.attacker.com)', () => {
    expect(validateDestinationHost('https://fxl.com.br.attacker.com/x', ['fxl.com.br'])).toBe(
      false,
    );
  });

  it('throws when the URL is unparseable', () => {
    expect(() => validateDestinationHost('not-a-url', ['fxl.com.br'])).toThrow();
  });

  it('returns false for an empty allowed-hosts list', () => {
    expect(validateDestinationHost('https://app.fxl.com.br/x', [])).toBe(false);
  });
});

describe('resolveFinderId', () => {
  it('falls back to preserved orgId when Hub accountId does not match legacy clerk_user_id', async () => {
    const calls: Array<Array<{ id: string }>> = [[], [{ id: 'finder-by-org' }]];
    const tx = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => calls.shift() ?? [],
          }),
        }),
      }),
    };

    await expect(resolveFinderId(tx as never, 'hub-account-id', 'org_existing_1')).resolves.toBe(
      'finder-by-org',
    );
  });
});
