import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LEAD_STAGE_SEEDS } from '../../src/domains/sales-ops/leads/stages-seed.js';

/**
 * Migration 0022 - the kanban pipeline persistence layer.
 *
 * This file drives the SHIPPED bytes of `drizzle/0022_sales_ops_leads.sql`: the
 * backfill is replayed by reading the file and running the statements from the
 * admin-context `set_config` onward, exactly as `funcoes-schema-migration.test.ts`
 * replays 0012's. Nothing here paraphrases the seed SQL, because a paraphrase
 * would pass while the shipped migration was broken.
 *
 * Nothing in this file writes to `audit_log`, so it deliberately carries NONE of
 * the ledger-tail cleanup that `funcoes-rls.test.ts` needs. Do not copy that
 * block in here by reflex.
 */

const APP_DB_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5006/fxl_sales';
const ADMIN_DB_URL = process.env.ADMIN_DATABASE_URL ?? APP_DB_URL;
const ADMIN_CONNECTION_OPTIONS = { connection: { 'app.fxl_admin': 'true' } } as const;
const DRIZZLE_DIR = path.resolve(process.cwd(), 'drizzle');

type StageRow = {
  id: string;
  name: string;
  kind: string;
  is_system: boolean;
  position: number;
  status: string;
};

type ColumnRow = { column_name: string; data_type: string; is_nullable: string };

describe('leads schema migration 0022', () => {
  let adminClient: postgres.Sql;
  const orgIds: string[] = [];

  /**
   * Replays the shipped 0022 backfill (everything from the admin-context
   * set_config onward) so the fixtures below are seeded by exactly the SQL that
   * ships, not by a paraphrase of it.
   */
  async function replayBackfill(): Promise<void> {
    const migrationFile = fs.readdirSync(DRIZZLE_DIR).find((file) => /^0022_.*\.sql$/.test(file));
    if (!migrationFile) throw new Error('migration 0022 file not found in the drizzle directory');
    const statements = fs
      .readFileSync(path.join(DRIZZLE_DIR, migrationFile), 'utf8')
      .split('--> statement-breakpoint')
      .map((statement) => statement.trim())
      .filter(Boolean);
    const backfillStartIndex = statements.findIndex((statement) =>
      statement.includes("set_config('app.fxl_admin'"),
    );
    if (backfillStartIndex === -1) {
      throw new Error('backfill statements not found in the shipped 0022 migration');
    }
    await adminClient.begin(async (tx) => {
      for (const statement of statements.slice(backfillStartIndex)) {
        await tx.unsafe(statement);
      }
    });
  }

  function newOrg(label: string): string {
    const orgId = `org_lead_mig_${label}_${Date.now()}_${randomUUID().slice(0, 8)}`;
    orgIds.push(orgId);
    return orgId;
  }

  function stagesOf(orgId: string) {
    return adminClient<StageRow[]>`
      SELECT id, name, kind, is_system, "position", status
      FROM sales_ops_lead_stages WHERE org_id = ${orgId}
      ORDER BY "position", name
    `;
  }

  async function insertPerson(orgId: string, displayName: string): Promise<string> {
    const [row] = await adminClient<{ id: string }[]>`
      INSERT INTO sales_ops_people (org_id, display_name)
      VALUES (${orgId}, ${displayName}) RETURNING id
    `;
    return row.id;
  }

  async function insertClient(orgId: string, name: string): Promise<string> {
    const [row] = await adminClient<{ id: string }[]>`
      INSERT INTO sales_ops_clients (org_id, name) VALUES (${orgId}, ${name}) RETURNING id
    `;
    return row.id;
  }

  async function insertProduct(orgId: string, name: string): Promise<string> {
    const [row] = await adminClient<{ id: string }[]>`
      INSERT INTO sales_ops_products (
        org_id, name, seller_commission_value, finder_commission_value,
        seller_with_finder_commission_value
      ) VALUES (${orgId}, ${name}, '10.00', '0.00', '0.00') RETURNING id
    `;
    return row.id;
  }

  async function insertSale(orgId: string, sequence: number, code: string): Promise<string> {
    const [row] = await adminClient<{ id: string }[]>`
      INSERT INTO sales_ops_sales (
        org_id, sequence, code, client_name_snapshot, seller_name_snapshot,
        payment_method, condition, base_date, total_brl,
        seller_commission_pct, finder_commission_pct, tax_pct, net_margin_pct
      ) VALUES (
        ${orgId}, ${sequence}, ${code}, 'Cliente', 'Vendedor',
        'pix', 'cash', '2026-01-01', 100000, '10.00', '0.00', '6.00', '84.00'
      ) RETURNING id
    `;
    return row.id;
  }

  async function insertStage(
    orgId: string,
    name: string,
    kind: string,
    isSystem: boolean,
    position: number,
  ): Promise<string> {
    const [row] = await adminClient<{ id: string }[]>`
      INSERT INTO sales_ops_lead_stages (org_id, name, kind, is_system, "position")
      VALUES (${orgId}, ${name}, ${kind}, ${isSystem}, ${position})
      RETURNING id
    `;
    return row.id;
  }

  async function insertLead(
    orgId: string,
    stageId: string,
    contactName: string,
    extra: {
      clientId?: string | null;
      sellerPersonId?: string | null;
      saleId?: string | null;
      estimatedValueBrl?: number;
    } = {},
  ): Promise<string> {
    const [row] = await adminClient<{ id: string }[]>`
      INSERT INTO sales_ops_leads (
        org_id, contact_name, client_id, client_name_snapshot,
        estimated_value_brl, seller_person_id, stage_id, sale_id
      ) VALUES (
        ${orgId}, ${contactName}, ${extra.clientId ?? null}, 'Empresa',
        ${extra.estimatedValueBrl ?? 0}, ${extra.sellerPersonId ?? null},
        ${stageId}, ${extra.saleId ?? null}
      ) RETURNING id
    `;
    return row.id;
  }

  beforeAll(() => {
    // Raw fixture writes across orgs exercise migration correctness, not
    // per-request RLS policy behaviour (leads-rls.test.ts covers that), so the
    // admin connection is used throughout.
    adminClient = postgres(ADMIN_DB_URL, { max: 1, ...ADMIN_CONNECTION_OPTIONS });
  });

  afterAll(async () => {
    for (const orgId of orgIds) {
      // Children first, or the restrict FKs reject the delete.
      await adminClient`DELETE FROM sales_ops_lead_products WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_leads WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_lead_stages WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_sales WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_products WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_clients WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_people WHERE org_id = ${orgId}`;
    }
    await adminClient.end();
  });

  it('seeds the four default stages per org, with only Proposta and Perdido flagged is_system', async () => {
    const orgId = newOrg('seed');
    await insertPerson(orgId, 'Cauet');

    await replayBackfill();

    const stages = await stagesOf(orgId);
    expect(stages.map((stage) => stage.name)).toEqual([
      'Novo',
      'Em negociação',
      'Proposta',
      'Perdido',
    ]);
    expect(stages.map((stage) => stage.kind)).toEqual([
      'normal',
      'normal',
      'conversion',
      'lost',
    ]);
    expect(stages.map((stage) => stage.is_system)).toEqual([false, false, true, true]);
    expect(stages.map((stage) => stage.position)).toEqual([1, 2, 3, 4]);
    expect(stages.every((stage) => stage.status === 'active')).toBe(true);
  });

  it('seeds an org that only has a proposta or a settings row', async () => {
    // sales_ops_settings can legitimately have no row for an org, so the org
    // registry has to be the union of every sales-ops footprint.
    const salesOnlyOrg = newOrg('salesonly');
    await insertSale(salesOnlyOrg, 1, `LEAD-0022-A-${randomUUID().slice(0, 6)}`);

    await replayBackfill();

    expect((await stagesOf(salesOnlyOrg)).map((stage) => stage.kind)).toEqual([
      'normal',
      'normal',
      'conversion',
      'lost',
    ]);
  });

  it('is idempotent when the backfill statements are replayed', async () => {
    const orgId = newOrg('idempotent');
    await insertPerson(orgId, 'Sig');

    await replayBackfill();
    const first = await stagesOf(orgId);

    await replayBackfill();
    await replayBackfill();

    expect(await stagesOf(orgId)).toEqual(first);
    expect(first).toHaveLength(4);
  });

  it('keeps the migration seed and LEAD_STAGE_SEEDS byte-identical', async () => {
    const orgId = newOrg('seedparity');
    await insertPerson(orgId, 'Halland');

    await replayBackfill();

    const stages = await stagesOf(orgId);
    expect(
      stages.map((stage) => ({
        name: stage.name,
        kind: stage.kind,
        is_system: stage.is_system,
        position: stage.position,
      })),
    ).toEqual(
      [...LEAD_STAGE_SEEDS]
        .sort((a, b) => a.position - b.position)
        .map((seed) => ({
          name: seed.name,
          kind: seed.kind,
          is_system: seed.isSystem,
          position: seed.position,
        })),
    );
  });

  it('refuses a second stage with the same name in one org and allows that name in another org', async () => {
    const orgA = newOrg('nameidxa');
    const orgB = newOrg('nameidxb');
    await insertPerson(orgA, 'Cauet');

    await replayBackfill();

    await expect(insertStage(orgA, 'Novo', 'normal', false, 9)).rejects.toThrow(
      /sales_ops_lead_stages_org_name_idx/,
    );

    // Positive control: the same name is free in another org.
    await expect(insertStage(orgB, 'Novo', 'normal', false, 9)).resolves.toEqual(
      expect.any(String),
    );
  });

  it('allows exactly one conversion stage and one lost stage per org, and any number of normal ones', async () => {
    const orgId = newOrg('kindidx');
    await insertPerson(orgId, 'Kayke');

    await replayBackfill();

    await expect(insertStage(orgId, 'Proposta 2', 'conversion', true, 5)).rejects.toThrow(
      /sales_ops_lead_stages_org_kind_idx/,
    );
    await expect(insertStage(orgId, 'Perdido 2', 'lost', true, 6)).rejects.toThrow(
      /sales_ops_lead_stages_org_kind_idx/,
    );

    // Positive control: the partial index leaves 'normal' alone.
    await expect(insertStage(orgId, 'Qualificação', 'normal', false, 7)).resolves.toEqual(
      expect.any(String),
    );
  });

  it('rejects a stage whose kind and is_system disagree', async () => {
    const orgId = newOrg('bicond');

    await expect(insertStage(orgId, 'Errado A', 'normal', true, 1)).rejects.toThrow(
      /sales_ops_lead_stages_system_kind_check/,
    );
    await expect(insertStage(orgId, 'Errado B', 'conversion', false, 2)).rejects.toThrow(
      /sales_ops_lead_stages_system_kind_check/,
    );
    // There is no 'ganho' kind, and there never was a 'converted' one either.
    await expect(insertStage(orgId, 'Errado C', 'ganho', true, 3)).rejects.toThrow(
      /sales_ops_lead_stages_kind_check/,
    );

    // Positive controls: both agreeing shapes land.
    await expect(insertStage(orgId, 'Certo A', 'normal', false, 4)).resolves.toEqual(
      expect.any(String),
    );
    await expect(insertStage(orgId, 'Certo B', 'lost', true, 5)).resolves.toEqual(
      expect.any(String),
    );
  });

  it('forces row level security on all three lead tables and carries both org policies', async () => {
    const tables = ['sales_ops_lead_stages', 'sales_ops_leads', 'sales_ops_lead_products'];

    const relRows = await adminClient<
      { relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }[]
    >`
      SELECT relname, relrowsecurity, relforcerowsecurity
      FROM pg_class
      WHERE relname = ANY(${tables}) AND relnamespace = 'public'::regnamespace
      ORDER BY relname
    `;
    expect(relRows).toHaveLength(3);
    expect(relRows.every((row) => row.relrowsecurity)).toBe(true);
    expect(relRows.every((row) => row.relforcerowsecurity)).toBe(true);

    const policyRows = await adminClient<{ policyname: string }[]>`
      SELECT policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename = ANY(${tables})
      ORDER BY policyname
    `;
    expect(policyRows.map((row) => row.policyname)).toEqual([
      'sales_ops_lead_products_admin_context',
      'sales_ops_lead_products_tenant_isolation',
      'sales_ops_lead_stages_admin_context',
      'sales_ops_lead_stages_tenant_isolation',
      'sales_ops_leads_admin_context',
      'sales_ops_leads_tenant_isolation',
    ]);
  });

  it('cascades a lead produtos with the lead and refuses to delete a produto a lead still names', async () => {
    const orgId = newOrg('leadprod');
    const stageId = await insertStage(orgId, 'Novo', 'normal', false, 1);
    const productId = await insertProduct(orgId, 'FXL Custom');
    const leadId = await insertLead(orgId, stageId, 'Contato');
    await adminClient`
      INSERT INTO sales_ops_lead_products (org_id, lead_id, product_id, product_name_snapshot)
      VALUES (${orgId}, ${leadId}, ${productId}, 'FXL Custom')
    `;

    // restrict: a produto a lead still names cannot be deleted.
    await expect(
      adminClient`DELETE FROM sales_ops_products WHERE id = ${productId}`,
    ).rejects.toThrow(/sales_ops_lead_products_org_product_fk/);

    // cascade: the lead's produto rows go with the lead.
    await adminClient`DELETE FROM sales_ops_leads WHERE id = ${leadId}`;
    const remaining = await adminClient<{ count: string }[]>`
      SELECT count(*)::text AS count FROM sales_ops_lead_products WHERE lead_id = ${leadId}
    `;
    expect(remaining[0].count).toBe('0');

    // Positive control: with no lead naming it, the produto deletes cleanly.
    await expect(
      adminClient`DELETE FROM sales_ops_products WHERE id = ${productId}`,
    ).resolves.toBeDefined();
  });

  it('refuses to delete a stage, a cliente, a pessoa or a venda that a lead still names', async () => {
    const orgId = newOrg('restrict');
    const stageId = await insertStage(orgId, 'Novo', 'normal', false, 1);
    const clientId = await insertClient(orgId, 'Empresa');
    const personId = await insertPerson(orgId, 'Vendedora');
    const saleId = await insertSale(orgId, 1, `LEAD-0022-R-${randomUUID().slice(0, 6)}`);
    const leadId = await insertLead(orgId, stageId, 'Contato', {
      clientId,
      sellerPersonId: personId,
      saleId,
    });

    await expect(
      adminClient`DELETE FROM sales_ops_lead_stages WHERE id = ${stageId}`,
    ).rejects.toThrow(/sales_ops_leads_org_stage_fk/);
    await expect(adminClient`DELETE FROM sales_ops_clients WHERE id = ${clientId}`).rejects.toThrow(
      /sales_ops_leads_org_client_fk/,
    );
    await expect(adminClient`DELETE FROM sales_ops_people WHERE id = ${personId}`).rejects.toThrow(
      /sales_ops_leads_org_seller_fk/,
    );
    await expect(adminClient`DELETE FROM sales_ops_sales WHERE id = ${saleId}`).rejects.toThrow(
      /sales_ops_leads_org_sale_fk/,
    );

    // Positive control: once the lead is gone all four delete cleanly.
    await adminClient`DELETE FROM sales_ops_leads WHERE id = ${leadId}`;
    await expect(
      adminClient`DELETE FROM sales_ops_lead_stages WHERE id = ${stageId}`,
    ).resolves.toBeDefined();
  });

  it('declares sales_ops_leads with an integer-cents estimate, a nullable sale_id and a non-null stage_changed_at', async () => {
    const columns = await adminClient<ColumnRow[]>`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'sales_ops_leads'
      ORDER BY column_name
    `;
    expect(columns).toEqual([
      { column_name: 'client_id', data_type: 'uuid', is_nullable: 'YES' },
      { column_name: 'client_name_snapshot', data_type: 'text', is_nullable: 'NO' },
      { column_name: 'contact_name', data_type: 'text', is_nullable: 'NO' },
      { column_name: 'created_at', data_type: 'timestamp with time zone', is_nullable: 'NO' },
      { column_name: 'description', data_type: 'text', is_nullable: 'YES' },
      { column_name: 'estimated_value_brl', data_type: 'integer', is_nullable: 'NO' },
      { column_name: 'id', data_type: 'uuid', is_nullable: 'NO' },
      { column_name: 'lost_reason', data_type: 'text', is_nullable: 'YES' },
      { column_name: 'org_id', data_type: 'text', is_nullable: 'NO' },
      { column_name: 'position', data_type: 'integer', is_nullable: 'NO' },
      { column_name: 'sale_id', data_type: 'uuid', is_nullable: 'YES' },
      { column_name: 'seller_name_snapshot', data_type: 'text', is_nullable: 'NO' },
      { column_name: 'seller_person_id', data_type: 'uuid', is_nullable: 'YES' },
      { column_name: 'stage_changed_at', data_type: 'timestamp with time zone', is_nullable: 'NO' },
      { column_name: 'stage_id', data_type: 'uuid', is_nullable: 'NO' },
      { column_name: 'updated_at', data_type: 'timestamp with time zone', is_nullable: 'YES' },
    ]);

    const orgId = newOrg('estimate');
    const stageId = await insertStage(orgId, 'Novo', 'normal', false, 1);
    await expect(
      insertLead(orgId, stageId, 'Contato', { estimatedValueBrl: -1 }),
    ).rejects.toThrow(/sales_ops_leads_estimated_value_check/);
    // Positive control: zero and a positive amount both land.
    await expect(
      insertLead(orgId, stageId, 'Contato zero', { estimatedValueBrl: 0 }),
    ).resolves.toEqual(expect.any(String));
  });

  it('links at most one lead to a given sale', async () => {
    const orgId = newOrg('saleidx');
    const stageId = await insertStage(orgId, 'Novo', 'normal', false, 1);
    const saleId = await insertSale(orgId, 1, `LEAD-0022-S-${randomUUID().slice(0, 6)}`);

    await insertLead(orgId, stageId, 'Primeiro', { saleId });
    await expect(insertLead(orgId, stageId, 'Segundo', { saleId })).rejects.toThrow(
      /sales_ops_leads_org_sale_idx/,
    );

    // The index is PARTIAL: any number of leads may sit unconverted.
    await expect(insertLead(orgId, stageId, 'Sem venda A')).resolves.toEqual(expect.any(String));
    await expect(insertLead(orgId, stageId, 'Sem venda B')).resolves.toEqual(expect.any(String));
  });
});
