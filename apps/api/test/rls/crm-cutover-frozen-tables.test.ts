/**
 * After the phase 2 cutover nothing writes the three pre-cutover lead tables (slice 07a).
 *
 * A legacy org keeps one etapa, one lead and one lead product in the OLD tables (the frozen copy).
 * A full flow then runs through the real services - seed on read, create etapa, reorder, create,
 * patch, move, delete, restore, the deleted list, the stage summary - and the old tables must be
 * byte-identical (row count and content hash) while the unified tables did all the work.
 *
 * Run: pnpm --filter @fxl-sales/api exec env VITEST_INTEGRATION=1 vitest run test/rls/crm-cutover-frozen-tables.test.ts
 */
import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deleteCrmForOrgs } from '../../src/db/__tests__/settlement-test-cleanup.js';
import { testDatabaseUrls } from '../../src/db/__tests__/test-database-urls.js';
import * as schema from '../../src/db/schema.js';
import { LeadWriteBaseSchema, MoveLeadSchema, LeadPatchSchema, ListLeadsQuerySchema } from '../../src/domains/sales-ops/leads/lead-schemas.js';
import {
  createLead,
  getLead,
  listLeads,
  moveLead,
  summarizeLeadStages,
  updateLead,
  type LeadScope,
} from '../../src/domains/sales-ops/leads/lead-service.js';
import { deleteLead, listDeletedLeads, restoreLead } from '../../src/domains/sales-ops/leads/lead-trash-service.js';
import { LeadStageSchema } from '../../src/domains/sales-ops/leads/schemas.js';
import { createLeadStage, reorderLeadStages, updateLeadStage } from '../../src/domains/sales-ops/leads/stage-service.js';
import { ensureLeadStagesForOrg } from '../../src/domains/sales-ops/leads/stages-seed.js';

const { appUrl, adminUrl } = testDatabaseUrls();
const ADMIN = { connection: { 'app.fxl_admin': 'true' } } as const;
const SCOPE: LeadScope = { userId: 'hub_admin', email: null, isAdmin: true };
const ACTOR = { userId: 'hub_admin', name: 'Admin' };
const FROZEN = ['sales_ops_lead_stages', 'sales_ops_leads', 'sales_ops_lead_products'] as const;

describe('the frozen pre-cutover lead tables are never written', () => {
  const orgId = `org_frozen_${Date.now()}_${randomUUID().slice(0, 8)}`;
  let appClient: postgres.Sql;
  let adminClient: postgres.Sql;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  beforeAll(async () => {
    appClient = postgres(appUrl, { max: 3 });
    adminClient = postgres(adminUrl, { max: 2, ...ADMIN });
    db = drizzle(appClient, { schema });
    await adminClient`
      INSERT INTO sales_ops_lead_stages (id, org_id, name, kind, is_system, position)
      VALUES ('11111111-1111-4111-8111-111111111111', ${orgId}, 'Etapa legada', 'normal', false, 1)`;
    await adminClient`
      INSERT INTO sales_ops_leads (id, org_id, contact_name, client_name_snapshot, stage_id)
      VALUES ('22222222-2222-4222-8222-222222222222', ${orgId}, 'Lead legado', 'Empresa', '11111111-1111-4111-8111-111111111111')`;
    await adminClient`
      INSERT INTO sales_ops_lead_products (org_id, lead_id, product_name_snapshot)
      VALUES (${orgId}, '22222222-2222-4222-8222-222222222222', 'Produto legado')`;
  });

  afterAll(async () => {
    // The flow writes lead.deleted and lead.restored into the hash-chained audit_log; drop them so the
    // ledger tail stays clean for the chain checks in conversion-ingest.test.ts.
    await adminClient`DELETE FROM audit_log WHERE actor_org_id = ${orgId}`;
    await deleteCrmForOrgs([orgId]);
    await adminClient`DELETE FROM sales_ops_lead_products WHERE org_id = ${orgId}`;
    await adminClient`DELETE FROM sales_ops_leads WHERE org_id = ${orgId}`;
    await adminClient`DELETE FROM sales_ops_lead_stages WHERE org_id = ${orgId}`;
    await appClient.end();
    await adminClient.end();
  });

  async function fingerprint(): Promise<Record<string, { n: number; hash: string }>> {
    const out: Record<string, { n: number; hash: string }> = {};
    for (const table of FROZEN) {
      const [row] = await adminClient.unsafe<{ n: number; hash: string }[]>(
        `SELECT count(*)::int AS n, coalesce(md5(string_agg(t::text, '|' ORDER BY t::text)), '') AS hash FROM ${table} t WHERE org_id = '${orgId}'`,
      );
      out[table] = row!;
    }
    return out;
  }

  async function crmCount(table: string): Promise<number> {
    const [row] = await adminClient.unsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM ${table} WHERE org_id = '${orgId}'`);
    return row!.n;
  }

  it('runs create, patch, move, delete, restore and the etapa cadastro against the unified tables only', async () => {
    const before = await fingerprint();
    expect(before['sales_ops_leads']!.n).toBe(1);
    expect(before['sales_ops_lead_products']!.n).toBe(1);
    expect(before['sales_ops_lead_stages']!.n).toBe(1);

    const stages = await ensureLeadStagesForOrg(db, orgId);
    const novo = stages.find((s) => s.name === 'Novo')!;
    const negociacao = stages.find((s) => s.name === 'Em negociação')!;
    const created = await createLeadStage(db, orgId, LeadStageSchema.parse({ name: 'Diagnóstico' }));
    if (typeof created === 'string') throw new Error('unexpected duplicate');
    await updateLeadStage(db, orgId, created.id, { name: 'Diagnóstico 2' });
    const active = (await ensureLeadStagesForOrg(db, orgId)).filter((s) => s.status === 'active').map((s) => s.id);
    await reorderLeadStages(db, orgId, [...active].reverse());

    const a = await createLead(db, orgId, LeadWriteBaseSchema.parse({ contactName: 'Ana', contactEmail: 'a@x.com', products: [{ productName: 'Livre' }], description: 'd' }), SCOPE);
    if (!a.ok) throw new Error('create refused');
    await updateLead(db, orgId, a.lead.id, LeadPatchSchema.parse({ contactName: 'Ana 2', products: [{ productName: 'Outro' }] }), SCOPE);
    const moved = await moveLead(db, orgId, a.lead.id, MoveLeadSchema.parse({ stageId: negociacao.id, position: 0 }), SCOPE);
    expect(moved.ok).toBe(true);
    expect((await getLead(db, orgId, a.lead.id, SCOPE)).ok).toBe(true);
    await listLeads(db, orgId, ListLeadsQuerySchema.parse({ stageId: negociacao.id }), SCOPE);
    await summarizeLeadStages(db, orgId, {}, SCOPE);
    expect(await deleteLead(db, orgId, a.lead.id, SCOPE, ACTOR)).toEqual({ ok: true });
    expect((await listDeletedLeads(db, orgId, {})).items).toHaveLength(1);
    expect((await restoreLead(db, orgId, a.lead.id, true, ACTOR)).ok).toBe(true);

    expect(await fingerprint()).toEqual(before);
    expect(await crmCount('sales_ops_crm_leads')).toBe(1);
    expect(await crmCount('sales_ops_pipeline_stages')).toBe(8);
    expect(await crmCount('sales_ops_crm_lead_field_values')).toBeGreaterThan(0);
    expect(await crmCount('sales_ops_crm_lead_events')).toBe(1);
    expect(novo.id).toBeDefined();
  });
});
