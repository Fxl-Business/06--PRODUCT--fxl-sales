/**
 * Phase 06 T04 — HMAC sign byte-match (D-O).
 *
 * The fxl-financiero sender (Side B, T08) reimplements the HMAC inline (it cannot
 * import packages/shared-utils cross-repo). This test pins the EXACT inline sign
 * formula and proves it produces a MAC that Phase 05's verifyHmac accepts over the
 * IDENTICAL `t + "." + rawBody` string. The export is verifyHmac (NOT verify, D-O).
 */
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyHmac } from '@fxl-sales/shared-utils';

const SECRET = 'test-webhook-signing-secret-abc123';
const TS = '1700000000'; // fixed ts — verifyHmac does NOT enforce the replay window

/** EXACT inline sign that ships in fxl-financiero apps/api/src/lib/fxl-sales-webhook.ts. */
function signInline(rawBody: string, secret: string, ts: string) {
  const hmac = createHmac('sha256', secret)
    .update(`${ts}.${rawBody}`)
    .digest('hex');
  return `t=${ts},v1=${hmac}`;
}

/** Parse the X-FXL-Signature header the SAME way the Phase 05 middleware does. */
function parseHeader(header: string): { ts: string; sig: string } {
  const match = header.match(/^t=(\d+),v1=([a-f0-9]+)$/);
  if (!match) throw new Error('bad header');
  return { ts: match[1]!, sig: match[2]! };
}

describe('HMAC sign byte-match vs Phase 05 verifyHmac (D-O)', () => {
  const rawBody = JSON.stringify({ source: 'fxl-financiero', external_order_id: 'org_abc' });

  it('a valid inline-signed header verifies true', () => {
    const header = signInline(rawBody, SECRET, TS);
    const { ts, sig } = parseHeader(header);
    const payload = ts + '.' + rawBody;
    expect(verifyHmac(SECRET, payload, sig)).toBe(true);
  });

  it('a wrong secret verifies false', () => {
    const header = signInline(rawBody, SECRET, TS);
    const { ts, sig } = parseHeader(header);
    const payload = ts + '.' + rawBody;
    expect(verifyHmac('wrong-secret', payload, sig)).toBe(false);
  });

  it('a different payload verifies false', () => {
    const header = signInline(rawBody, SECRET, TS);
    const { sig } = parseHeader(header);
    const payload = TS + '.' + JSON.stringify({ source: 'tampered' });
    expect(verifyHmac(SECRET, payload, sig)).toBe(false);
  });

  it('non-ASCII (UTF-8) body content still byte-matches', () => {
    const utf8Body = JSON.stringify({
      source: 'fxl-financiero',
      customer_name: 'José Antônio Açaí',
    });
    const header = signInline(utf8Body, SECRET, TS);
    const { ts, sig } = parseHeader(header);
    const payload = ts + '.' + utf8Body;
    expect(verifyHmac(SECRET, payload, sig)).toBe(true);
  });
});
