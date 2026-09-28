/**
 * Integration oracle for the producer outbox adapter (slice 03).
 * Run with: pnpm --filter @fxl-sales/api test:integration
 */
import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hasDrizzleTx } from '../outbox-adapter.js';
import { buildSettlementRecordedEvent } from '../events.js';

const APP_DB_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5006/fxl_sales';

let sql: postgres.Sql;
let db: ReturnType<typeof drizzle>;
let adapterMod: typeof import('../outbox-adapter.js');
const orgA = `org-a-${randomUUID()}`;
const orgB = `org-b-${randomUUID()}`;

function event(orgId: string, key: string) {
  return {
    ...buildSettlementRecordedEvent({
      organizationId: orgId,
      row: {
        id: key, type: 'baixa', reversesSettlementId: null, paidOn: '2026-10-14', amountBrl: 100,
        targetKind: 'receivable', receivableId: randomUUID(), payableId: null, actorName: 'Teste',
      },
      meta: { newId: () => randomUUID(), occurredAt: new Date('2026-10-01T12:00:00Z') },
    }),
  };
}

describe('outbox adapter (integration)', () => {
  beforeAll(() => {
    sql = postgres(APP_DB_URL, { max: 2 });
    db = drizzle(sql);
  });
  afterAll(async () => {
    await sql.end();
  });

  it('enqueues one pending row, dedups on (org, idempotency_key), and scopes by tenant', async () => {
    adapterMod = await import('../outbox-adapter.js');
    const ev = event(orgA, randomUUID());
    await db.transaction(async (tx) => {
      await tx.execute(
        (await import('drizzle-orm')).sql`SELECT set_config('app.current_org_id', ${orgA}, true)`,
      );
      await adapterMod.enqueueEvent(tx as never, ev);
      await adapterMod.enqueueEvent(tx as never, { ...ev, id: randomUUID() });
      await adapterMod.enqueueSaleEvents(adapterMod.createIntegrationTxAdapter(tx as never), [ev]);
      expect(hasDrizzleTx(adapterMod.createIntegrationTxAdapter(tx as never))).toBe(true);
    });
    const rows = await sql.begin(async (t) => {
      await t`SELECT set_config('app.current_org_id', ${orgA}, true)`;
      return t`SELECT position, published_at, idempotency_key FROM integration_outbox WHERE organization_id = ${orgA}`;
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.position).toBeNull();
    expect(rows[0]!.published_at).toBeNull();
    expect(rows[0]!.idempotency_key).toBe(ev.idempotencyKey);

    const other = await sql.begin(async (t) => {
      await t`SELECT set_config('app.current_org_id', ${orgB}, true)`;
      return t`SELECT id FROM integration_outbox WHERE organization_id = ${orgA}`;
    });
    expect(other).toHaveLength(0);

    // cleanup as admin
    const admin = postgres(APP_DB_URL, { max: 1, connection: { 'app.fxl_admin': 'true' } });
    await admin`DELETE FROM integration_outbox WHERE organization_id IN (${orgA}, ${orgB})`;
    await admin.end();
  });
});
