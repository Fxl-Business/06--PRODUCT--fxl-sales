/**
 * Slice 05 oracle: `GET /feed` through the REAL router, the REAL
 * `readIntegrationFeed`, the pooled admin adapter and the local test DB. Only
 * the introspection verifier is a stub (it is the injected seam).
 * Run: pnpm --filter @fxl-sales/api test:integration feed-route
 */
import { randomUUID } from 'node:crypto';
import {
  enqueueIntegrationEvent,
  publishPendingPositions,
  type IntrospectionVerifier,
} from '@fxl-business/fxl-contracts';
import { Hono } from 'hono';
import { afterAll, describe, expect, it } from 'vitest';
import { closeDb, getAdminDb } from '../../../db/client.js';
import { sql } from 'drizzle-orm';
import { createIntegrationFeedRouter } from '../feed-routes.js';
import { buildSettlementRecordedEvent } from '../events.js';
import { createIntegrationPooledAdapter } from '../outbox-adapter.js';

const ORG_A = `org_feed_a_${randomUUID()}`;
const ORG_B = `org_feed_b_${randomUUID()}`;
const adapter = createIntegrationPooledAdapter();

function envelope(orgId: string, minute: number) {
  const key = randomUUID();
  return buildSettlementRecordedEvent({
    organizationId: orgId,
    row: {
      id: key, type: 'baixa', reversesSettlementId: null, paidOn: '2026-10-14', amountBrl: 100,
      targetKind: 'receivable', receivableId: randomUUID(), payableId: null, actorName: 'Teste',
    },
    meta: { newId: () => randomUUID(), occurredAt: new Date(Date.UTC(2026, 9, 1, 12, minute)) },
  });
}

const verifierFor = (org: string): IntrospectionVerifier =>
  ({
    verify: async (ticket: string) =>
      ticket === 'good'
        ? {
            status: 'authorized',
            fromCache: false,
            decision: {
              organizationId: org,
              consumerApplicationId: 'app.fxl-finance',
              producerApplicationId: 'app.fxl-sales',
              environment: 'development',
              eventNames: [],
              expiresAt: new Date(Date.now() + 60_000).toISOString(),
            },
          }
        : { status: 'refused' },
    clear: () => {},
  }) as unknown as IntrospectionVerifier;

function appFor(verifier: IntrospectionVerifier) {
  const app = new Hono();
  app.route('/integration/v1', createIntegrationFeedRouter({ adapter, verifier }));
  return app;
}

const good = { headers: { Authorization: 'Bearer good' } };

let seeded: Promise<void> | undefined;
function seed(): Promise<void> {
  seeded ??= (async () => {
    for (let i = 0; i < 3; i++) await enqueueIntegrationEvent(adapter, envelope(ORG_A, i));
    await enqueueIntegrationEvent(adapter, envelope(ORG_B, 9));
    await publishPendingPositions({ adapter });
  })();
  return seeded;
}

afterAll(async () => {
  await getAdminDb().execute(
    sql`DELETE FROM integration_outbox WHERE organization_id IN (${ORG_A}, ${ORG_B})`,
  );
  await closeDb();
});

describe('GET /integration/v1/feed', () => {
  it('returns ascending events for the introspected org only', async () => {
    await seed();
    const res = await appFor(verifierFor(ORG_A)).request('/integration/v1/feed?after=0', good);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      events: { position: string; idempotencyKey: string }[];
      nextCursor: string;
    };
    expect(body.events).toHaveLength(3);
    const positions = body.events.map((e) => BigInt(e.position));
    expect(positions).toEqual([...positions].sort((a, b) => (a < b ? -1 : 1)));
    expect(new Set(positions).size).toBe(3);
    expect(body.nextCursor).toBe(body.events[2]!.position);
  });

  it('applies and clamps the limit', async () => {
    await seed();
    const app = appFor(verifierFor(ORG_A));
    const one = (await (await app.request('/integration/v1/feed?limit=1', good)).json()) as {
      events: { position: string }[];
      nextCursor: string;
    };
    expect(one.events).toHaveLength(1);
    expect(one.nextCursor).toBe(one.events[0]!.position);

    const huge = await app.request('/integration/v1/feed?limit=100000', good);
    expect(huge.status).toBe(200);
    expect(((await huge.json()) as { events: unknown[] }).events).toHaveLength(3);

    const junk = await app.request('/integration/v1/feed?limit=abc', good);
    expect(junk.status).toBe(200);
    expect(((await junk.json()) as { events: unknown[] }).events).toHaveLength(3);
  });

  it('rejects a bad after cursor with 400', async () => {
    const res = await appFor(verifierFor(ORG_A)).request('/integration/v1/feed?after=-1', good);
    expect(res.status).toBe(400);
  });

  it('answers 401 with no detail for a refused ticket or a missing header', async () => {
    const app = appFor(verifierFor(ORG_A));
    const stale = await app.request('/integration/v1/feed', {
      headers: { Authorization: 'Bearer stale' },
    });
    expect(stale.status).toBe(401);
    expect(await stale.json()).toEqual({ error: 'unauthorized' });
    const none = await app.request('/integration/v1/feed');
    expect(none.status).toBe(401);
    expect(await none.json()).toEqual({ error: 'unauthorized' });
    const empty = await app.request('/integration/v1/feed', { headers: { Authorization: 'Bearer ' } });
    expect(empty.status).toBe(401);
  });

  it('answers 503 when introspection is unavailable', async () => {
    const verifier = {
      verify: async () => ({ status: 'unavailable', reason: 'network' }),
      clear: () => {},
    } as unknown as IntrospectionVerifier;
    const res = await appFor(verifier).request('/integration/v1/feed', good);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'unavailable' });
  });

  it('takes the org from introspection, never from the query', async () => {
    await seed();
    const app = appFor(verifierFor(ORG_A));
    const mismatch = await app.request(`/integration/v1/feed?organizationId=${ORG_B}`, good);
    expect(mismatch.status).toBe(403);
    expect(await mismatch.json()).toEqual({ error: 'forbidden' });
    const same = await app.request(`/integration/v1/feed?organizationId=${ORG_A}`, good);
    expect(same.status).toBe(200);
    expect(((await same.json()) as { events: unknown[] }).events).toHaveLength(3);
  });
});
