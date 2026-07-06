import { createHash } from 'node:crypto';
import { eq, and } from 'drizzle-orm';
import type { MiddlewareHandler } from 'hono';
import { verifyHmac } from '@fxl-sales/shared-utils';
import { getDb } from '../../db/client.js';
import { apps } from '../../db/schema.js';

/**
 * HMAC verify middleware for the inbound conversion webhook (Phase 05 T06).
 *
 * MUST run BEFORE any body-parse middleware so the raw byte string is captured
 * exactly once via `c.req.raw.clone().arrayBuffer()` (the `.clone()` preserves the
 * original stream for downstream `c.req.json()`). The signature is computed over the
 * IDENTICAL raw bytes the sender signed: `payload = ts + "." + rawBody` (D-O).
 *
 * D-O (LOCKED): EVERY failure mode — missing/malformed header, expired timestamp
 * (|now-ts| > 300s), unparseable JSON, unknown source, signature mismatch — returns
 * the SAME generic `401 { error: 'unauthorized' }`. No distinct error code (no
 * source-existence / failure-mode oracle). To avoid a timing oracle on unknown
 * source, verifyHmac still runs against a dummy secret when the app is missing.
 */

declare module 'hono' {
  interface ContextVariableMap {
    rawBody: Buffer;
    rawBodyHash: string;
    verifiedAppSlug: string;
  }
}

const REPLAY_WINDOW_SECONDS = 300;
const SIGNATURE_HEADER = 'X-FXL-Signature';
const DUMMY_SECRET = 'fxl-sales-dummy-secret-for-constant-time-compare';

function unauthorized(c: Parameters<MiddlewareHandler>[0]) {
  return c.json({ error: 'unauthorized' }, 401);
}

export const hmacVerifyMiddleware: MiddlewareHandler = async (c, next) => {
  // 1. Capture raw body (clone so the original stream survives for c.req.json()).
  const rawBody = Buffer.from(await c.req.raw.clone().arrayBuffer());
  c.set('rawBody', rawBody);

  // 2. raw body hash for the service (D-L: stored verbatim in webhook_events.body_hash).
  const rawBodyHash = createHash('sha256').update(rawBody).digest('hex');
  c.set('rawBodyHash', rawBodyHash);

  // 3. Parse signature header: t=<ts>,v1=<hex>.
  const header = c.req.header(SIGNATURE_HEADER);
  const match = header?.match(/^t=(\d+),v1=([a-f0-9]+)$/);
  if (!match) return unauthorized(c);
  const ts = Number(match[1]);
  const sig = match[2]!;

  // 4. Replay window.
  if (Math.abs(Date.now() / 1000 - ts) > REPLAY_WINDOW_SECONDS) return unauthorized(c);

  // 5. Read `source` from the raw body (a failed parse before auth is an auth failure).
  let source: string;
  try {
    const parsed = JSON.parse(rawBody.toString('utf-8')) as { source?: unknown };
    if (typeof parsed.source !== 'string' || parsed.source.length === 0) return unauthorized(c);
    source = parsed.source;
  } catch {
    return unauthorized(c);
  }

  // 6. Lookup the app's webhook_signing_secret. Run verifyHmac against a dummy secret
  // when the app is missing to keep timing constant (no unknown-source oracle, D-O).
  const [app] = await getDb()
    .select({ secret: apps.webhookSigningSecret })
    .from(apps)
    .where(and(eq(apps.slug, source), eq(apps.status, 'active')))
    .limit(1);

  const payload = ts + '.' + rawBody.toString('utf-8');
  const ok = verifyHmac(app?.secret ?? DUMMY_SECRET, payload, sig);
  if (!app || !ok) return unauthorized(c);

  c.set('verifiedAppSlug', source);
  return next();
};
