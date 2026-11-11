/**
 * The lead lixeira in bulk (api-lote): delete every live, unconverted lead of one etapa as a
 * batch and restore the batch, against the real database.
 *
 * Every write goes over the APP connection (the tenant role, RLS live). The admin
 * `postgres.Sql` is only for fixtures, raw assertions and cleanup.
 *
 * Run once: `VITEST_INTEGRATION=1 pnpm exec vitest run test/rls/leads-lote.test.ts`
 */
import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { closeDb } from '../../src/db/client.js';
import * as schema from '../../src/db/schema.js';
import { deleteCrmForOrgs } from '../../src/db/__tests__/settlement-test-cleanup.js';
import { testDatabaseUrls } from '../../src/db/__tests__/test-database-urls.js';
import { LeadWriteBaseSchema } from '../../src/domains/sales-ops/leads/lead-schemas.js';
import {
  type LeadScope,
  type WriteLeadResult,
  createLead,
} from '../../src/domains/sales-ops/leads/lead-service.js';
import {
  type LeadActor,
  deleteLead,
  deleteStageLeads,
  previewStageDelete,
  restoreLeadBatch,
} from '../../src/domains/sales-ops/leads/lead-trash-service.js';
import { ensureLeadStagesForOrg } from '../../src/domains/sales-ops/leads/stages-seed.js';

const { appUrl: APP_DB_URL, adminUrl: ADMIN_DB_URL } = testDatabaseUrls();
const ADMIN_CONNECTION_OPTIONS = { connection: { 'app.fxl_admin': 'true' } } as const;
const ADMIN_SCOPE: LeadScope = { userId: 'hub_admin', email: null, isAdmin: true };
const ACTOR: LeadActor = { userId: 'hub_admin', name: 'Gestora Teste' };

function okLead(result: WriteLeadResult) {
  if (!result.ok) throw new Error(`unexpected refusal: ${result.reason}`);
  return result.lead;
}

describe('sales operations leads: the bulk lixeira', () => {
  let appClient: postgres.Sql;
  let adminClient: postgres.Sql;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  const orgIds: string[] = [];

  beforeAll(() => {
    appClient = postgres(APP_DB_URL, { max: 5 });
    adminClient = postgres(ADMIN_DB_URL, { max: 2, ...ADMIN_CONNECTION_OPTIONS });
    db = drizzle(appClient, { schema });
  });

  afterAll(async () => {
    for (const orgId of orgIds) {
      await adminClient`DELETE FROM audit_log WHERE actor_org_id = ${orgId}`;
      await deleteCrmForOrgs([orgId]);
      await adminClient`DELETE FROM sales_ops_sales WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_clients WHERE org_id = ${orgId}`;
    }
    await closeDb();
    await appClient.end();
    await adminClient.end();
  });

  async function world(label: string) {
    const orgId = `org_lote_rls_${label}_${Date.now()}_${randomUUID().slice(0, 8)}`;
    orgIds.push(orgId);
    const stages = await ensureLeadStagesForOrg(db, orgId);
    const pick = (position: number) => stages.find((s) => s.kind === 'normal' && s.position === position)!;
    return { orgId, open: pick(1), second: pick(2) };
  }

  async function client(orgId: string, name: string): Promise<string> {
    const [row] = await adminClient<{ id: string }[]>`
      INSERT INTO sales_ops_clients (org_id, name) VALUES (${orgId}, ${name}) RETURNING id`;
    return row!.id;
  }

  async function lead(orgId: string, contactName: string, clientId?: string) {
    return okLead(
      await createLead(
        db,
        orgId,
        LeadWriteBaseSchema.parse({ contactName, estimatedValueBrl: 1000, ...(clientId ? { clientId } : {}) }),
        ADMIN_SCOPE,
      ),
    );
  }

  async function convert(orgId: string, leadId: string): Promise<void> {
    const [sale] = await adminClient<{ id: string }[]>`
      INSERT INTO sales_ops_sales
        (org_id, sequence, code, client_name_snapshot, seller_name_snapshot, payment_method,
         condition, base_date, total_brl, seller_commission_pct, finder_commission_pct, tax_pct,
         other_costs_brl, net_margin_brl, net_margin_pct)
      VALUES (${orgId}, ${Math.floor(Math.random() * 1_000_000) + 1}, ${`PROP-RLS-${randomUUID().slice(0, 8)}`},
              'Empresa A', 'Vendedor A', 'pix', 'cash', now(), 100000, 10, 3, 6, 0, 0, 0)
      RETURNING id`;
    await adminClient`UPDATE sales_ops_crm_leads SET sale_id = ${sale!.id} WHERE org_id = ${orgId} AND id = ${leadId}`;
  }

  async function deletedCount(orgId: string): Promise<number> {
    const [row] = await adminClient<{ n: string }[]>`
      SELECT count(*)::text AS n FROM sales_ops_crm_leads WHERE org_id = ${orgId} AND deleted_at IS NOT NULL`;
    return Number(row!.n);
  }

  async function auditCount(orgId: string, action: string): Promise<number> {
    const [row] = await adminClient<{ n: string }[]>`
      SELECT count(*)::text AS n FROM audit_log WHERE actor_org_id = ${orgId} AND action = ${action}`;
    return Number(row!.n);
  }

  it('previews, deletes and restores a batch; converted cards stay; clientes and client_id never change', async () => {
    const w = await world('flow');
    const acme = await client(w.orgId, 'Acme Ltda');
    const leads = [];
    for (let i = 1; i <= 8; i += 1) leads.push(await lead(w.orgId, `L${i}`, i % 2 === 0 ? acme : undefined));
    const converted = await lead(w.orgId, 'Convertido', acme);
    await convert(w.orgId, converted.id);
    const clientsBefore = JSON.stringify(
      await adminClient`SELECT * FROM sales_ops_clients WHERE org_id = ${w.orgId} ORDER BY id`,
    );
    const clientIdsBefore = JSON.stringify(
      await adminClient`SELECT id, client_id FROM sales_ops_crm_leads WHERE org_id = ${w.orgId} ORDER BY id`,
    );

    expect(await previewStageDelete(db, w.orgId, w.open.id)).toEqual({
      ok: true,
      stageName: w.open.name,
      deletableCount: 8,
      skippedConvertedCount: 1,
    });

    const result = await deleteStageLeads(db, w.orgId, w.open.id, ACTOR);
    if (!result.ok || result.batchId === null) throw new Error('expected a batch');
    expect(result.deletedCount).toBe(8);
    expect(result.skippedConvertedCount).toBe(1);

    const stamped = await adminClient<{ n: string }[]>`
      SELECT count(*)::text AS n FROM sales_ops_crm_leads
      WHERE org_id = ${w.orgId} AND deleted_batch_id = ${result.batchId}
        AND deleted_at IS NOT NULL AND deleted_by_user_id = 'hub_admin' AND deleted_by_name = 'Gestora Teste'`;
    expect(stamped[0]!.n).toBe('8');
    expect(await auditCount(w.orgId, 'lead.deleted')).toBe(8);
    expect(await previewStageDelete(db, w.orgId, w.open.id)).toMatchObject({ deletableCount: 0, skippedConvertedCount: 1 });
    // The converted card is the only live one left and the column is dense.
    const live = await adminClient<{ contact_name: string; position: number }[]>`
      SELECT contact_name, "position" FROM sales_ops_crm_leads
      WHERE org_id = ${w.orgId} AND stage_id = ${w.open.id} AND deleted_at IS NULL`;
    expect(live.map((row) => [row.contact_name, row.position])).toEqual([['Convertido', 1]]);

    // The ledger entries of the act are one unbroken stretch of the hash chain.
    const chain = await adminClient<Array<{ prev_hash: string; entry_hash: string }>>`
      SELECT prev_hash, entry_hash FROM audit_log
      WHERE actor_org_id = ${w.orgId} AND action = 'lead.deleted' ORDER BY id`;
    expect(chain).toHaveLength(8);
    for (let i = 1; i < chain.length; i += 1) expect(chain[i]!.prev_hash).toBe(chain[i - 1]!.entry_hash);

    const restored = await restoreLeadBatch(db, w.orgId, result.batchId, ACTOR);
    expect(restored).toEqual({ ok: true, restoredCount: 8 });
    expect(await deletedCount(w.orgId)).toBe(0);
    expect(await auditCount(w.orgId, 'lead.restored')).toBe(8);
    const dense = await adminClient<{ n: string; max: number }[]>`
      SELECT count(*)::text AS n, max("position") AS max FROM sales_ops_crm_leads
      WHERE org_id = ${w.orgId} AND stage_id = ${w.open.id} AND deleted_at IS NULL`;
    expect(dense[0]).toEqual({ n: '9', max: 9 });
    expect(await restoreLeadBatch(db, w.orgId, result.batchId, ACTOR)).toEqual({ ok: true, restoredCount: 0 });

    expect(
      JSON.stringify(await adminClient`SELECT * FROM sales_ops_clients WHERE org_id = ${w.orgId} ORDER BY id`),
    ).toBe(clientsBefore);
    expect(
      JSON.stringify(await adminClient`SELECT id, client_id FROM sales_ops_crm_leads WHERE org_id = ${w.orgId} ORDER BY id`),
    ).toBe(clientIdsBefore);
  });

  it('is all or nothing: a failure while writing the ledger rolls every lead back', async () => {
    const w = await world('atomic');
    for (let i = 1; i <= 5; i += 1) await lead(w.orgId, `L${i}`);
    // A null actor id violates audit_log.actor_user_id NOT NULL, after the UPDATE and the renumber.
    await expect(
      deleteStageLeads(db, w.orgId, w.open.id, { userId: null as unknown as string, name: null }),
    ).rejects.toThrow();
    expect(await deletedCount(w.orgId)).toBe(0);
    expect(await auditCount(w.orgId, 'lead.deleted')).toBe(0);
  });

  it('touches only the token\'s org, and an etapa with nothing to delete writes nothing', async () => {
    const a = await world('org-a');
    const b = await world('org-b');
    const theirs = await lead(b.orgId, 'Deles');

    expect(await deleteStageLeads(db, a.orgId, b.open.id, ACTOR)).toEqual({ ok: false, reason: 'not_found' });
    expect(await previewStageDelete(db, a.orgId, b.open.id)).toEqual({ ok: false, reason: 'not_found' });
    expect(await deleteStageLeads(db, a.orgId, randomUUID(), ACTOR)).toEqual({ ok: false, reason: 'not_found' });
    expect(await deletedCount(b.orgId)).toBe(0);

    expect(await deleteStageLeads(db, a.orgId, a.open.id, ACTOR)).toEqual({
      ok: true,
      batchId: null,
      deletedCount: 0,
      skippedConvertedCount: 0,
    });
    expect(await auditCount(a.orgId, 'lead.deleted')).toBe(0);

    const batch = await deleteStageLeads(db, b.orgId, b.open.id, ACTOR);
    if (!batch.ok || batch.batchId === null) throw new Error('expected a batch');
    expect(await restoreLeadBatch(db, a.orgId, batch.batchId, ACTOR)).toEqual({ ok: false, reason: 'not_found' });
    expect(await restoreLeadBatch(db, a.orgId, randomUUID(), ACTOR)).toEqual({ ok: false, reason: 'not_found' });
    expect(await deletedCount(b.orgId)).toBe(1);
    expect(theirs.id).toBeTruthy();
  });

  it('a lead that left the batch is not restored a second time', async () => {
    const w = await world('left');
    const a = await lead(w.orgId, 'A');
    await lead(w.orgId, 'B');
    const batch = await deleteStageLeads(db, w.orgId, w.open.id, ACTOR);
    if (!batch.ok || batch.batchId === null) throw new Error('expected a batch');
    // A restored on its own (the single restore clears the batch id): the batch owns only B now.
    await adminClient`
      UPDATE sales_ops_crm_leads SET deleted_at = NULL, deleted_by_user_id = NULL, deleted_by_name = NULL,
        deleted_batch_id = NULL WHERE id = ${a.id}`;
    expect(await restoreLeadBatch(db, w.orgId, batch.batchId, ACTOR)).toEqual({ ok: true, restoredCount: 1 });
    expect(await deleteLead(db, w.orgId, a.id, ADMIN_SCOPE, ACTOR)).toEqual({ ok: true });
    const [row] = await adminClient<{ deleted_batch_id: string | null }[]>`
      SELECT deleted_batch_id FROM sales_ops_crm_leads WHERE id = ${a.id}`;
    expect(row!.deleted_batch_id).toBeNull();
  });

  it('deletes and restores a few hundred leads in one transaction each', async () => {
    const w = await world('scale');
    const [stage] = await adminClient<{ pipeline_id: string }[]>`
      SELECT pipeline_id FROM sales_ops_pipeline_stages WHERE id = ${w.open.id}`;
    await adminClient`
      INSERT INTO sales_ops_crm_leads (org_id, contact_name, contact_email, pipeline_id, stage_id, "position")
      SELECT ${w.orgId}, 'Lead ' || n, 'lead' || n || '@example.com', ${stage!.pipeline_id}, ${w.open.id}, n
      FROM generate_series(1, 600) AS n`;
    const batch = await deleteStageLeads(db, w.orgId, w.open.id, ACTOR);
    if (!batch.ok || batch.batchId === null) throw new Error('expected a batch');
    expect(batch.deletedCount).toBe(600);
    expect(await auditCount(w.orgId, 'lead.deleted')).toBe(600);
    expect(await restoreLeadBatch(db, w.orgId, batch.batchId, ACTOR)).toEqual({ ok: true, restoredCount: 600 });
    const [shape] = await adminClient<{ dense: boolean; ordered: boolean }[]>`
      SELECT min("position") = 1 AND max("position") = count(*) AND count(DISTINCT "position") = count(*) AS dense,
             bool_and(contact_name = 'Lead ' || "position") AS ordered
      FROM sales_ops_crm_leads WHERE org_id = ${w.orgId} AND stage_id = ${w.open.id} AND deleted_at IS NULL`;
    expect(shape).toEqual({ dense: true, ordered: true });
  });
});
