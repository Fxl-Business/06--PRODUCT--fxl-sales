import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testDatabaseUrls } from '../../src/db/__tests__/test-database-urls.js';
import { firstRow } from './first-row.js';

/**
 * Migration 0028 - the lead lixeira columns, applied by global-setup.ts through
 * the real runner before this file runs. Fixtures go over the admin connection
 * (migration correctness, not RLS behaviour; leads-rls.test.ts covers that).
 */

const ADMIN_DB_URL = testDatabaseUrls().adminUrl;
const ADMIN_CONNECTION_OPTIONS = { connection: { 'app.fxl_admin': 'true' } } as const;

type ColumnRow = {
  column_name: string;
  data_type: string;
  is_nullable: string;
  column_default: string | null;
};

describe('lead soft delete migration 0028', () => {
  let adminClient: postgres.Sql;
  const orgIds: string[] = [];

  function newOrg(label: string): string {
    const orgId = `org_lead_softdel_${label}_${Date.now()}_${randomUUID().slice(0, 8)}`;
    orgIds.push(orgId);
    return orgId;
  }

  async function insertStage(orgId: string): Promise<string> {
    const row = firstRow(
      await adminClient<{ id: string }[]>`
        INSERT INTO sales_ops_lead_stages (org_id, name, kind, is_system, "position")
        VALUES (${orgId}, 'Novo', 'normal', false, 1)
        RETURNING id
      `,
      'stage',
    );
    return row.id;
  }

  beforeAll(() => {
    adminClient = postgres(ADMIN_DB_URL, { max: 1, ...ADMIN_CONNECTION_OPTIONS });
  });

  afterAll(async () => {
    for (const orgId of orgIds) {
      await adminClient`DELETE FROM sales_ops_leads WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_lead_stages WHERE org_id = ${orgId}`;
    }
    await adminClient.end();
  });

  it('adds three nullable columns with no default', async () => {
    const columns = await adminClient<ColumnRow[]>`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'sales_ops_leads'
        AND column_name IN ('deleted_at', 'deleted_by_user_id', 'deleted_by_name')
      ORDER BY column_name
    `;
    expect(columns).toEqual([
      { column_name: 'deleted_at', data_type: 'timestamp with time zone', is_nullable: 'YES', column_default: null },
      { column_name: 'deleted_by_name', data_type: 'text', is_nullable: 'YES', column_default: null },
      { column_name: 'deleted_by_user_id', data_type: 'text', is_nullable: 'YES', column_default: null },
    ]);
  });

  it('refuses a half-deleted row', async () => {
    const orgId = newOrg('pair');
    const stageId = await insertStage(orgId);

    const def = firstRow(
      await adminClient<{ def: string }[]>`
        SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conname = 'sales_ops_leads_deleted_pair_check'
      `,
      'constraint',
    );
    expect(def.def).toMatch(/\(deleted_at IS NULL\) = \(deleted_by_user_id IS NULL\)/);

    await expect(adminClient`
      INSERT INTO sales_ops_leads (org_id, contact_name, client_name_snapshot, stage_id, deleted_at)
      VALUES (${orgId}, 'Meio', '', ${stageId}, now())
    `).rejects.toThrow(/sales_ops_leads_deleted_pair_check/);
    await expect(adminClient`
      INSERT INTO sales_ops_leads (org_id, contact_name, client_name_snapshot, stage_id, deleted_by_user_id)
      VALUES (${orgId}, 'Meio', '', ${stageId}, 'hub_x')
    `).rejects.toThrow(/sales_ops_leads_deleted_pair_check/);

    // Positive controls: both NULL, and both set with a NULL name (a token may carry no name).
    await expect(adminClient`
      INSERT INTO sales_ops_leads (org_id, contact_name, client_name_snapshot, stage_id)
      VALUES (${orgId}, 'Viva', '', ${stageId})
    `).resolves.toBeDefined();
    await expect(adminClient`
      INSERT INTO sales_ops_leads (org_id, contact_name, client_name_snapshot, stage_id, deleted_at, deleted_by_user_id)
      VALUES (${orgId}, 'Excluida', '', ${stageId}, now(), 'hub_x')
    `).resolves.toBeDefined();
  });

  it('indexes deleted rows only', async () => {
    const row = firstRow(
      await adminClient<{ indexdef: string }[]>`
        SELECT indexdef FROM pg_indexes WHERE indexname = 'sales_ops_leads_org_deleted_idx'
      `,
      'index',
    );
    expect(row.indexdef).toMatch(/\(org_id, deleted_at, id\) WHERE \(deleted_at IS NOT NULL\)/);
  });

  it('reads every pre-0028 lead as live', async () => {
    const orgId = newOrg('legacy');
    const stageId = await insertStage(orgId);
    const raw = firstRow(
      await adminClient<{ id: string }[]>`
        INSERT INTO sales_ops_leads (
          org_id, contact_name, client_id, client_name_snapshot,
          estimated_value_brl, seller_person_id, stage_id, sale_id
        ) VALUES (
          ${orgId}, 'Contato antigo', NULL, 'Empresa', 150000, NULL, ${stageId}, NULL
        ) RETURNING id
      `,
      'raw lead',
    );
    const stored = firstRow(
      await adminClient<{ deleted_at: Date | null; deleted_by_user_id: string | null; deleted_by_name: string | null }[]>`
        SELECT deleted_at, deleted_by_user_id, deleted_by_name FROM sales_ops_leads WHERE id = ${raw.id}
      `,
      'stored',
    );
    expect(stored).toEqual({ deleted_at: null, deleted_by_user_id: null, deleted_by_name: null });
    const counted = firstRow(
      await adminClient<{ n: number }[]>`SELECT count(*)::int AS n FROM sales_ops_leads WHERE org_id = ${orgId}`,
      'count',
    );
    expect(counted.n).toBe(1);
  });
});
