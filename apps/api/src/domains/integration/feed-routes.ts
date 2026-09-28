/**
 * Producer feed route: `GET /feed`, cursor-paginated and ascending by position.
 *
 * Server-to-server, protected by Hub ticket introspection. It deliberately
 * carries NO `appAuthMiddleware` / `requireHubAuth` / `requireAdmin`: the caller
 * is Finance, not a Hub user.
 *
 * Slice 08 mounts it at `/integration/v1`, so the final path is
 * `/integration/v1/feed`: `app.route('/integration/v1', createIntegrationFeedRouter({ adapter, verifier }))`.
 * It is NOT mounted from here.
 *
 * The Organization read comes ONLY from the introspection decision through
 * `organizationForFeedRead`. The caller's `?organizationId=` can only be checked
 * against it, never used as the read's org. The ticket is never logged.
 */
import {
  clampFeedLimit,
  organizationForFeedRead,
  readIntegrationFeed,
  type IntrospectionVerifier,
  type SqlIntegrationAdapter,
} from '@fxl-business/fxl-contracts';
import { Hono } from 'hono';

export interface IntegrationFeedRouterDeps {
  /** Pooled service adapter (admin session). The org boundary is the introspected org. */
  adapter: SqlIntegrationAdapter;
  /** Injected: real verifier in production, the fake authority's in dev/fake mode. */
  verifier: IntrospectionVerifier;
}

const BEARER = /^bearer\s+(.+)$/i;
const DIGITS = /^\d+$/;

function bearerTicket(header: string | undefined): string | null {
  if (header === undefined) return null;
  const match = BEARER.exec(header.trim());
  const ticket = match?.[1]?.trim();
  return ticket ? ticket : null;
}

export function createIntegrationFeedRouter(deps: IntegrationFeedRouterDeps): Hono {
  const router = new Hono();

  router.get('/feed', async (c) => {
    const ticket = bearerTicket(c.req.header('Authorization'));
    if (ticket === null) return c.json({ error: 'unauthorized' }, 401);

    const outcome = await deps.verifier.verify(ticket);
    if (outcome.status === 'refused') return c.json({ error: 'unauthorized' }, 401);
    if (outcome.status === 'unavailable') {
      // Never the ticket: only the reason and status.
      console.warn(
        `integration feed: introspection unavailable (${outcome.reason}${
          outcome.httpStatus === undefined ? '' : ` ${outcome.httpStatus}`
        })`,
      );
      return c.json({ error: 'unavailable' }, 503);
    }

    const org = organizationForFeedRead(outcome.decision, c.req.query('organizationId'));
    if (org.status === 'mismatch') return c.json({ error: 'forbidden' }, 403);

    const rawAfter = c.req.query('after');
    if (rawAfter !== undefined && !DIGITS.test(rawAfter)) {
      return c.json({ error: 'validation_error' }, 400);
    }
    const after = rawAfter === undefined ? 0n : BigInt(rawAfter);

    const rawLimit = c.req.query('limit');
    const parsed = rawLimit === undefined ? undefined : Number(rawLimit);
    const limit = clampFeedLimit(parsed !== undefined && Number.isFinite(parsed) ? parsed : undefined);

    const page = await readIntegrationFeed({
      adapter: deps.adapter,
      organizationId: org.organizationId,
      after,
      limit,
    });

    return c.json({
      events: page.events.map((e) => ({
        position: e.position.toString(),
        eventName: e.eventName,
        eventVersion: e.eventVersion,
        idempotencyKey: e.idempotencyKey,
        payload: e.payload,
        occurredAt: e.occurredAt,
      })),
      nextCursor: page.nextCursor.toString(),
    });
  });

  return router;
}
