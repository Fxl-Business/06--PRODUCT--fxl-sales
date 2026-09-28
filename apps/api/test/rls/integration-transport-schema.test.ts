/**
 * Integration oracle for migration 0025: the Sales<->Finance transport tables
 * (integration_outbox, integration_outbox_position, integration_inbox,
 * integration_cursor), their named indexes and constraints, the seed row and RLS.
 *
 * Requires Docker Postgres running + migrations applied (vitest globalSetup -
 * see test/rls/global-setup.ts).
 * Run with: pnpm --filter @fxl-sales/api test:integration
 */
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const APP_DB_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5006/fxl_sales';
const ADMIN_DB_URL = process.env.ADMIN_DATABASE_URL ?? APP_DB_URL;
const ADMIN_CONNECTION_OPTIONS = { connection: { 'app.fxl_admin': 'true' } } as const;

type Sql = postgres.Sql;
type ColumnRow = { column_name: string; data_type: string; is_nullable: string };

const TSTZ = 'timestamp with time zone';

const EXPECTED_COLUMNS: Record<string, Record<string, [string, 'YES' | 'NO']>> = {
  integration_outbox: {
    id: ['text', 'NO'],
    organization_id: ['text', 'NO'],
    event_name: ['text', 'NO'],
    event_version: ['integer', 'NO'],
    idempotency_key: ['text', 'NO'],
    payload: ['jsonb', 'NO'],
    occurred_at: [TSTZ, 'NO'],
    created_at: [TSTZ, 'NO'],
    position: ['bigint', 'YES'],
    published_at: [TSTZ, 'YES'],
  },
  integration_outbox_position: {
    id: ['text', 'NO'],
    last_position: ['bigint', 'NO'],
    updated_at: [TSTZ, 'NO'],
  },
  integration_inbox: {
    producer_application_id: ['text', 'NO'],
    organization_id: ['text', 'NO'],
    idempotency_key: ['text', 'NO'],
    event_name: ['text', 'NO'],
    event_version: ['integer', 'NO'],
    position: ['bigint', 'NO'],
    occurred_at: [TSTZ, 'NO'],
    applied_at: [TSTZ, 'NO'],
  },
  integration_cursor: {
    producer_application_id: ['text', 'NO'],
    organization_id: ['text', 'NO'],
    position: ['bigint', 'NO'],
    updated_at: [TSTZ, 'NO'],
  },
};

async function insertOutbox(sql: Sql | postgres.TransactionSql, orgId: string, id: string, position: number | null) {
  await sql`
    INSERT INTO integration_outbox (
      id, organization_id, event_name, event_version, idempotency_key, payload, occurred_at, position
    ) VALUES (
      ${id}, ${orgId}, 'test.event', 1, ${`idem-${id}`}, ${sql.json({ ok: true })}, now(), ${position}
    )
  `;
}

describe('integration transport schema (migration 0025)', () => {
  let appClient: Sql;
  let adminClient: Sql;
  const orgIds: string[] = [];
  const outboxIds: string[] = [];

  function newOrgId(label: string): string {
    const orgId = `org_transport_${label}_${Date.now()}_${randomUUID().slice(0, 8)}`;
    orgIds.push(orgId);
    return orgId;
  }
  function newOutboxId(): string {
    const id = `obx_${randomUUID()}`;
    outboxIds.push(id);
    return id;
  }

  beforeAll(async () => {
    appClient = postgres(APP_DB_URL, { max: 4 });
    adminClient = postgres(ADMIN_DB_URL, { max: 2, ...ADMIN_CONNECTION_OPTIONS });

    const rows = await appClient<{ rolsuper: boolean; rolbypassrls: boolean; current_user: string }[]>`
      SELECT rolsuper, rolbypassrls, current_user
      FROM pg_roles WHERE rolname = current_user
    `;
    const me = rows[0];
    if (!me) throw new Error('could not resolve current_user role');
    if (me.rolsuper || me.rolbypassrls) {
      throw new Error(
        `RLS tests must run as a non-superuser, non-BYPASSRLS role; got ${me.current_user}`,
      );
    }
  });

  afterAll(async () => {
    for (const id of outboxIds) {
      await adminClient`DELETE FROM integration_outbox WHERE id = ${id}`;
    }
    for (const orgId of orgIds) {
      await adminClient`DELETE FROM integration_outbox WHERE organization_id = ${orgId}`;
      await adminClient`DELETE FROM integration_inbox WHERE organization_id = ${orgId}`;
      await adminClient`DELETE FROM integration_cursor WHERE organization_id = ${orgId}`;
    }
    await appClient.end();
    await adminClient.end();
  });

  it('creates the four tables with the exact columns, types and nullability', async () => {
    for (const [table, expected] of Object.entries(EXPECTED_COLUMNS)) {
      const rows = await adminClient<ColumnRow[]>`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = ${table}
      `;
      const actual = Object.fromEntries(
        rows.map((r) => [r.column_name, [r.data_type, r.is_nullable]]),
      );
      expect(actual, table).toEqual(expected);
    }
  });

  it('creates the named indexes, partial predicates and primary keys', async () => {
    const indexes = await adminClient<{ indexname: string; indexdef: string }[]>`
      SELECT indexname, indexdef FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'integration_outbox'
    `;
    const byName = new Map(indexes.map((i) => [i.indexname, i.indexdef]));
    expect(byName.get('integration_outbox_idempotency_key_uq')).toMatch(/UNIQUE.*\(organization_id, idempotency_key\)/);
    expect(byName.get('integration_outbox_pending_idx')).toMatch(/\(occurred_at, id\) WHERE \(?"?position"? IS NULL\)?/);
    expect(byName.get('integration_outbox_position_uq')).toMatch(/UNIQUE.*\("?position"?\) WHERE \(?"?position"? IS NOT NULL\)?/);
    expect(byName.get('integration_outbox_feed_idx')).toMatch(/\(organization_id, "?position"?\) WHERE \(?"?position"? IS NOT NULL\)?/);

    const constraints = await adminClient<{ conname: string; conrelid: string }[]>`
      SELECT conname, conrelid::regclass::text AS conrelid FROM pg_constraint
      WHERE conname IN ('integration_inbox_pkey', 'integration_cursor_pkey') AND contype = 'p'
    `;
    const byCon = Object.fromEntries(constraints.map((c) => [c.conname, c.conrelid]));
    expect(byCon).toEqual({
      integration_inbox_pkey: 'integration_inbox',
      integration_cursor_pkey: 'integration_cursor',
    });
  });

  it('seeds exactly one integration_outbox_position row with column default 0', async () => {
    const rows = await adminClient<{ id: string }[]>`
      SELECT id FROM integration_outbox_position
    `;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe('default');
    // The counter is a live global row other integration tests advance, so assert
    // the seeded schema property (the migration's DEFAULT 0), never the mutable value.
    const def = await adminClient<{ column_default: string | null }[]>`
      SELECT column_default FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'integration_outbox_position'
        AND column_name = 'last_position'
    `;
    expect(def[0]!.column_default).toBe('0');
  });

  it('enables and forces RLS on all four tables with the two-policy model (admin-only on the counter)', async () => {
    const flags = await adminClient<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }[]>`
      SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
      WHERE relnamespace = 'public'::regnamespace AND relname = ANY(${Object.keys(EXPECTED_COLUMNS)})
    `;
    expect(flags).toHaveLength(4);
    for (const f of flags) {
      expect(f.relrowsecurity, f.relname).toBe(true);
      expect(f.relforcerowsecurity, f.relname).toBe(true);
    }

    const policies = await adminClient<{ tablename: string; policyname: string }[]>`
      SELECT tablename, policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename = ANY(${Object.keys(EXPECTED_COLUMNS)})
    `;
    const byTable = new Map<string, string[]>();
    for (const p of policies) {
      byTable.set(p.tablename, [...(byTable.get(p.tablename) ?? []), p.policyname].sort());
    }
    for (const t of ['integration_outbox', 'integration_inbox', 'integration_cursor']) {
      expect(byTable.get(t), t).toEqual([`${t}_admin_context`, `${t}_tenant_isolation`]);
    }
    expect(byTable.get('integration_outbox_position')).toEqual([
      'integration_outbox_position_admin_context',
    ]);
  });

  it('isolates outbox rows by org and refuses a smuggled organization_id with 42501', async () => {
    const orgA = newOrgId('a');
    const orgB = newOrgId('b');
    const rowId = newOutboxId();

    await appClient.begin(async (tx) => {
      await tx`SELECT set_config('app.current_org_id', ${orgA}, true)`;
      await insertOutbox(tx, orgA, rowId, null);
      const seen = await tx`SELECT id FROM integration_outbox WHERE id = ${rowId}`;
      expect(seen).toHaveLength(1); // positive control
    });

    await appClient.begin(async (tx) => {
      await tx`SELECT set_config('app.current_org_id', ${orgB}, true)`;
      const byId = await tx`SELECT id FROM integration_outbox WHERE id = ${rowId}`;
      expect(byId).toHaveLength(0);
      const byOrg = await tx`SELECT id FROM integration_outbox WHERE organization_id = ${orgA}`;
      expect(byOrg).toHaveLength(0);
    });

    // The smuggled insert is the only write of its transaction: the whole
    // `.begin(...)` promise rejects.
    await expect(
      appClient.begin(async (tx) => {
        await tx`SELECT set_config('app.current_org_id', ${orgB}, true)`;
        await insertOutbox(tx, orgA, newOutboxId(), null);
      }),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('tolerates many NULL positions and refuses a duplicate non-null position with 23505', async () => {
    const orgId = newOrgId('p');
    await insertOutbox(adminClient, orgId, newOutboxId(), null);
    await insertOutbox(adminClient, orgId, newOutboxId(), null);
    const nulls = await adminClient`
      SELECT id FROM integration_outbox WHERE organization_id = ${orgId} AND position IS NULL
    `;
    expect(nulls).toHaveLength(2);

    const position = 9_000_000_000 + Math.floor(Math.random() * 1_000_000);
    await insertOutbox(adminClient, orgId, newOutboxId(), position);
    await expect(insertOutbox(adminClient, orgId, newOutboxId(), position)).rejects.toMatchObject({
      code: '23505',
      constraint_name: 'integration_outbox_position_uq',
    });
  });

  it('gates the global counter to the admin context', async () => {
    const orgId = newOrgId('c');
    const before = await adminClient<{ last_position: string }[]>`
      SELECT last_position FROM integration_outbox_position WHERE id = 'default'
    `;
    await appClient.begin(async (tx) => {
      await tx`SELECT set_config('app.current_org_id', ${orgId}, true)`;
      const rows = await tx`SELECT id FROM integration_outbox_position`;
      expect(rows).toHaveLength(0);
      const updated = await tx`UPDATE integration_outbox_position SET last_position = 5 RETURNING id`;
      expect(updated).toHaveLength(0);
    });
    // The tenant context sees and writes nothing, so the admin-visible counter is
    // unchanged by the blocked write (its absolute value is other tests' business).
    const adminRows = await adminClient<{ id: string; last_position: string }[]>`
      SELECT id, last_position FROM integration_outbox_position
    `;
    expect(adminRows).toHaveLength(1);
    expect(adminRows[0]!.last_position).toBe(before[0]!.last_position);
  });
});
