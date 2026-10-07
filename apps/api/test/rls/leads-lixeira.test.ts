/**
 * The lead lixeira (lead-lixeira slice 01): soft delete, restore, the deleted
 * list and the audit ledger, against the real database.
 *
 * Every write goes over the APP connection (the tenant role, RLS live). The
 * admin `postgres.Sql` is only for fixtures, raw assertions, the commit probe
 * trigger and cleanup.
 *
 * Run once: `VITEST_INTEGRATION=1 pnpm exec vitest run test/rls/leads-lixeira.test.ts`
 */
import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import { Hono } from 'hono';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// lead-routes.ts imports middleware/app-auth.js, which resolves the Hub contract
// at module scope: blank the Hub names before anything is imported, or this file
// inherits whatever apps/api/.env holds.
vi.hoisted(() => {
  for (const name of [
    'FXL_HUB_CONFIG',
    'FXL_HUB_API_URL',
    'FXL_HUB_ENVIRONMENT',
    'FXL_HUB_CLIENT_ID',
    'FXL_HUB_CLIENT_SECRET',
    'FXL_HUB_AUDIENCE',
    'SALES_ENV_FILE',
    'SALES_AUTH_FAKE',
  ]) {
    process.env[name] = '';
  }
});

import { hubAuthContext } from '../../src/auth/__tests__/hub-auth-context-fixture.js';
import { closeDb } from '../../src/db/client.js';
import * as schema from '../../src/db/schema.js';
import { testDatabaseUrls } from '../../src/db/__tests__/test-database-urls.js';
import { computeEntryHash } from '../../src/domains/audit/service.js';
import {
  CreateContactLeadSchema,
  CreateLeadSchema,
  ListLeadsQuerySchema,
  MoveLeadSchema,
  UpdateLeadSchema,
} from '../../src/domains/sales-ops/leads/lead-schemas.js';
import {
  LeadInputError,
  type LeadScope,
  type LeadView,
  type WriteLeadResult,
  createContactLead,
  createLead,
  getLead,
  listLeads,
  moveLead,
  updateLead,
} from '../../src/domains/sales-ops/leads/lead-service.js';
import {
  type LeadActor,
  deleteLead,
  listDeletedLeads,
  restoreLead,
} from '../../src/domains/sales-ops/leads/lead-trash-service.js';
import { LeadStageSchema } from '../../src/domains/sales-ops/leads/schemas.js';
import { createLeadStage, updateLeadStage } from '../../src/domains/sales-ops/leads/stage-service.js';
import { ensureLeadStagesForOrg } from '../../src/domains/sales-ops/leads/stages-seed.js';
import { PersonSchema, createPerson } from '../../src/domains/sales-ops/service.js';

const { leadsRouter } = await import('../../src/domains/sales-ops/leads/lead-routes.js');

const { appUrl: APP_DB_URL, adminUrl: ADMIN_DB_URL } = testDatabaseUrls();
const ADMIN_CONNECTION_OPTIONS = { connection: { 'app.fxl_admin': 'true' } } as const;
const ADMIN_SCOPE: LeadScope = { userId: 'hub_admin', email: null, isAdmin: true };
const ADMIN_ACTOR: LeadActor = { userId: 'hub_admin', name: 'Gestora Teste' };
/** A full-edition non-admin, exactly as the FXL tests build one. */
function sellerScope(userId: string): LeadScope {
  return { userId, email: null, isAdmin: false };
}
/** A leads-edition non-admin, exactly as `leadScope` builds one. */
function leadsSellerScope(userId: string): LeadScope {
  return { userId, email: null, isAdmin: false, name: null, hasSellerRole: true, edition: 'leads' };
}
function okLead(result: WriteLeadResult): LeadView {
  if (!result.ok) throw new Error(`unexpected refusal: ${result.reason}`);
  return result.lead;
}
const NOT_FOUND = { ok: false, reason: 'not_found' } as const;

type RawAuditRow = {
  actor_user_id: string;
  actor_org_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string;
  before_jsonb: unknown;
  after_jsonb: unknown;
  request_id: string | null;
  prev_hash: string;
  entry_hash: string;
};

function expectEntryHashValid(row: RawAuditRow): void {
  const recomputed = computeEntryHash(row.prev_hash, {
    actorUserId: row.actor_user_id,
    actorOrgId: row.actor_org_id ?? null,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id,
    beforeJsonb: row.before_jsonb ?? null,
    afterJsonb: row.after_jsonb ?? null,
    requestId: row.request_id ?? null,
  });
  expect(recomputed).toBe(row.entry_hash);
}

/**
 * The write must reject because the deferred probe fires at COMMIT. Walks the
 * cause chain, since a transaction wrapper may re-throw the Postgres error.
 */
async function expectProbeRejection(promise: Promise<unknown>): Promise<void> {
  const thrown = await promise.then(
    () => null,
    (error: unknown) => ({ error }),
  );
  expect(thrown, 'expected the write to reject, but it resolved').not.toBeNull();
  const chain: string[] = [];
  let current: unknown = thrown!.error;
  for (let depth = 0; current !== undefined && current !== null && depth < 5; depth += 1) {
    chain.push(String((current as { message?: unknown }).message ?? current));
    current = (current as { cause?: unknown }).cause;
  }
  expect(chain.join(' | ')).toMatch(/fxl_lixeira_commit_probe/);
}

describe('sales operations leads: the lixeira', () => {
  let appClient: postgres.Sql;
  let adminClient: postgres.Sql;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  const orgIds: string[] = [];

  function newOrg(label: string): string {
    const orgId = `org_lix_${label}_${Date.now()}_${randomUUID().slice(0, 8)}`;
    orgIds.push(orgId);
    return orgId;
  }

  beforeAll(() => {
    appClient = postgres(APP_DB_URL, { max: 5 });
    adminClient = postgres(ADMIN_DB_URL, { max: 2, ...ADMIN_CONNECTION_OPTIONS });
    db = drizzle(appClient, { schema });
  });

  afterAll(async () => {
    for (const orgId of orgIds) {
      // Our entries are the ledger tail because the integration project runs files serially.
      await adminClient`DELETE FROM audit_log WHERE actor_org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_lead_products WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_leads WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_lead_stages WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_payables WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_receivables WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_sale_items WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_sale_professionals WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_sales WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_product_funcao_costs WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_products WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_areas WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_person_funcoes WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_people WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_funcoes WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_clients WHERE org_id = ${orgId}`;
    }
    await adminClient.unsafe(`DROP TRIGGER IF EXISTS fxl_lixeira_commit_probe_trg ON sales_ops_leads`);
    await adminClient.unsafe(`DROP FUNCTION IF EXISTS fxl_lixeira_commit_probe()`);
    await closeDb();
    await appClient.end();
    await adminClient.end();
  });

  async function vendedor(orgId: string, displayName: string, account: string, leads = false) {
    const person = await createPerson(
      db,
      orgId,
      PersonSchema.parse(leads ? { displayName } : { displayName, isSeller: true }),
      leads ? { edition: 'leads' } : {},
    );
    if (typeof person === 'string') throw new Error(`unexpected person outcome: ${person}`);
    await adminClient`
      UPDATE sales_ops_people SET hub_account_id = ${account}
      WHERE org_id = ${orgId} AND id = ${person.id}`;
    return person;
  }

  /** A full-edition org with the seeded etapas and two bound vendedores. */
  async function fullWorld(label: string) {
    const orgId = newOrg(label);
    const stages = await ensureLeadStagesForOrg(db, orgId);
    const pick = (kind: string, position?: number) =>
      stages.find((stage) => stage.kind === kind && (position === undefined || stage.position === position))!;
    const ana = await vendedor(orgId, 'Ana Martins', 'hub_ana');
    const bruno = await vendedor(orgId, 'Bruno Lima', 'hub_bruno');
    return {
      orgId,
      ana,
      bruno,
      open: pick('normal', 1),
      second: pick('normal', 2),
      conversion: pick('conversion'),
      lost: pick('lost'),
    };
  }

  /** A full-edition lead filed by an admin; `sellerPersonId` absent means unassigned. */
  async function fullLead(orgId: string, contactName: string, sellerPersonId?: string) {
    return okLead(
      await createLead(
        db,
        orgId,
        CreateLeadSchema.parse({
          contactName,
          clientName: 'Empresa Pool',
          estimatedValueBrl: 100000,
          ...(sellerPersonId ? { sellerPersonId } : {}),
        }),
        ADMIN_SCOPE,
      ),
    );
  }

  async function rowOf(leadId: string) {
    const [row] = await adminClient<
      Array<{
        seller_person_id: string | null;
        seller_name_snapshot: string;
        stage_id: string;
        position: number;
        contact_name: string;
        lost_reason: string | null;
        stage_changed_at: Date;
        deleted_at: Date | null;
        deleted_by_user_id: string | null;
        deleted_by_name: string | null;
        updated_at: Date | null;
      }>
    >`SELECT seller_person_id, seller_name_snapshot, stage_id, "position", contact_name, lost_reason,
             stage_changed_at, deleted_at, deleted_by_user_id, deleted_by_name, updated_at
      FROM sales_ops_leads WHERE id = ${leadId}`;
    return row!;
  }

  async function auditFor(entityId: string) {
    return (await adminClient<RawAuditRow[]>`
      SELECT actor_user_id, actor_org_id, action, entity_type, entity_id,
             before_jsonb, after_jsonb, request_id, prev_hash, entry_hash
      FROM audit_log WHERE entity_id = ${entityId} ORDER BY id`) as unknown as RawAuditRow[];
  }

  async function livePositions(orgId: string, stageId: string) {
    const rows = await adminClient<Array<{ contact_name: string; position: number }>>`
      SELECT contact_name, "position" FROM sales_ops_leads
      WHERE org_id = ${orgId} AND stage_id = ${stageId} AND deleted_at IS NULL
      ORDER BY "position"`;
    return rows.map((row) => [row.contact_name, row.position]);
  }

  async function board(orgId: string, stageId: string, scope: LeadScope) {
    const result = await listLeads(db, orgId, ListLeadsQuerySchema.parse({ stageId }), scope);
    if (!result.ok) throw new Error(`unexpected refusal: ${result.reason}`);
    return result;
  }

  async function withProbe<T>(leadId: string, run: () => Promise<T>): Promise<T> {
    await adminClient.unsafe(`
      CREATE OR REPLACE FUNCTION fxl_lixeira_commit_probe() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'fxl_lixeira_commit_probe'; END $$ LANGUAGE plpgsql`);
    await adminClient.unsafe(`
      CREATE CONSTRAINT TRIGGER fxl_lixeira_commit_probe_trg AFTER UPDATE ON sales_ops_leads
        DEFERRABLE INITIALLY DEFERRED
        FOR EACH ROW WHEN (NEW.id = '${leadId}')
        EXECUTE FUNCTION fxl_lixeira_commit_probe()`);
    try {
      return await run();
    } finally {
      await adminClient.unsafe(`DROP TRIGGER IF EXISTS fxl_lixeira_commit_probe_trg ON sales_ops_leads`);
      await adminClient.unsafe(`DROP FUNCTION IF EXISTS fxl_lixeira_commit_probe()`);
    }
  }

  it('an admin deletes any live lead: it leaves every read, the column renumbers dense, and nothing claims it', async () => {
    const w = await fullWorld('admin');
    const a = await fullLead(w.orgId, 'A', w.bruno.id);
    await fullLead(w.orgId, 'B');
    await fullLead(w.orgId, 'C', w.ana.id);

    expect(await deleteLead(db, w.orgId, a.id, ADMIN_SCOPE, ADMIN_ACTOR)).toEqual({ ok: true });

    const row = await rowOf(a.id);
    expect(row.deleted_at).not.toBeNull();
    expect(row.deleted_by_user_id).toBe('hub_admin');
    expect(row.deleted_by_name).toBe('Gestora Teste');
    expect(row.stage_id).toBe(w.open.id);
    expect(row.seller_person_id).toBe(w.bruno.id);
    expect(row.seller_name_snapshot).toBe('Bruno Lima');
    expect(row.position).toBe(1);

    const open = await board(w.orgId, w.open.id, ADMIN_SCOPE);
    expect(open.leads.map((lead) => lead.contactName)).toEqual(['B', 'C']);
    expect(open.total).toBe(2);
    expect(open.leads.map((lead) => lead.position)).toEqual([1, 2]);

    expect(await getLead(db, w.orgId, a.id, ADMIN_SCOPE)).toEqual(NOT_FOUND);
    expect(await updateLead(db, w.orgId, a.id, UpdateLeadSchema.parse({ contactName: 'X' }), ADMIN_SCOPE)).toEqual(
      NOT_FOUND,
    );
    expect(
      await moveLead(db, w.orgId, a.id, MoveLeadSchema.parse({ stageId: w.second.id, position: 0 }), ADMIN_SCOPE),
    ).toEqual(NOT_FOUND);
    const after = await rowOf(a.id);
    expect(after.contact_name).toBe('A');
    expect(after.stage_id).toBe(w.open.id);

    expect(await deleteLead(db, w.orgId, a.id, ADMIN_SCOPE, ADMIN_ACTOR)).toEqual(NOT_FOUND);

    const entries = await auditFor(a.id);
    expect(entries).toHaveLength(1);
    const entry = entries[0]!;
    expect(entry.actor_user_id).toBe('hub_admin');
    expect(entry.actor_org_id).toBe(w.orgId);
    expect(entry.action).toBe('lead.deleted');
    expect(entry.entity_type).toBe('lead');
    expect(entry.before_jsonb).toEqual({ deleted: false });
    expect(entry.after_jsonb).toEqual({
      deleted: true,
      label: 'A',
      actorLabel: 'Gestora Teste',
      metadata: { contactName: 'A', clientName: 'Empresa Pool', stageName: 'Novo', sellerName: 'Bruno Lima' },
    });
    expectEntryHashValid(entry);
  });

  it('create, move and renumber ignore a deleted card', async () => {
    const w = await fullWorld('dense');
    const a = await fullLead(w.orgId, 'A');
    const b = await fullLead(w.orgId, 'B');
    const c = await fullLead(w.orgId, 'C');
    // The LAST card: an unfiltered MAX(position) would answer 4 for the next create.
    expect(await deleteLead(db, w.orgId, c.id, ADMIN_SCOPE, ADMIN_ACTOR)).toEqual({ ok: true });

    const d = await fullLead(w.orgId, 'D');
    expect(d.position).toBe(3);

    okLead(
      await moveLead(db, w.orgId, b.id, MoveLeadSchema.parse({ stageId: w.open.id, position: 0 }), ADMIN_SCOPE),
    );
    expect(await livePositions(w.orgId, w.open.id)).toEqual([
      ['B', 1],
      ['A', 2],
      ['D', 3],
    ]);
    // The deleted row's stale position was never renumbered.
    expect((await rowOf(c.id)).position).toBe(3);
    expect((await board(w.orgId, w.open.id, ADMIN_SCOPE)).total).toBe(3);

    // Delete the FIRST card: an unfiltered renumber would keep B in the sequence.
    expect(await deleteLead(db, w.orgId, b.id, ADMIN_SCOPE, ADMIN_ACTOR)).toEqual({ ok: true });
    expect(await livePositions(w.orgId, w.open.id)).toEqual([
      ['A', 1],
      ['D', 2],
    ]);
    expect(a.position).toBe(1);
  });

  it('an active vendedor deletes exactly what he can read and never claims', async () => {
    const w = await fullWorld('seller');
    const own = await fullLead(w.orgId, 'Ana propria', w.ana.id);
    const pool = await fullLead(w.orgId, 'Pool');
    const brunos = await fullLead(w.orgId, 'Bruno proprio', w.bruno.id);
    const ana = sellerScope('hub_ana');
    const anaActor: LeadActor = { userId: 'hub_ana', name: 'Ana Martins' };

    expect(await deleteLead(db, w.orgId, brunos.id, ana, anaActor)).toEqual(NOT_FOUND);
    expect((await rowOf(brunos.id)).deleted_at).toBeNull();
    expect(await auditFor(brunos.id)).toHaveLength(0);

    expect(await deleteLead(db, w.orgId, pool.id, ana, anaActor)).toEqual({ ok: true });
    const poolRow = await rowOf(pool.id);
    expect(poolRow.seller_person_id).toBeNull();
    expect(poolRow.seller_name_snapshot).toBe('');
    expect(poolRow.deleted_by_user_id).toBe('hub_ana');
    expect(poolRow.deleted_by_name).toBe('Ana Martins');
    const poolAudit = (await auditFor(pool.id))[0]!;
    expect((poolAudit.after_jsonb as { metadata: { sellerName: string } }).metadata.sellerName).toBe('');

    expect(await deleteLead(db, w.orgId, own.id, ana, anaActor)).toEqual({ ok: true });

    expect((await board(w.orgId, w.open.id, ana)).total).toBe(0);
    expect((await board(w.orgId, w.open.id, ADMIN_SCOPE)).leads.map((lead) => lead.contactName)).toEqual([
      'Bruno proprio',
    ]);

    // Not an active vendedor any more: raw on purpose, updatePerson writes ledger rows.
    const pool2 = await fullLead(w.orgId, 'Pool 2');
    await adminClient`UPDATE sales_ops_people SET status = 'inactive' WHERE org_id = ${w.orgId} AND id = ${w.ana.id}`;
    expect(await deleteLead(db, w.orgId, pool2.id, ana, anaActor)).toEqual(NOT_FOUND);
    expect((await rowOf(pool2.id)).deleted_at).toBeNull();

    expect(
      await deleteLead(db, w.orgId, pool2.id, sellerScope('hub_nobody'), { userId: 'hub_nobody', name: null }),
    ).toEqual({ ok: false, reason: 'seller_person_unmapped' });
    expect(await auditFor(pool2.id)).toHaveLength(0);
  });

  it('a converted lead cannot be deleted and nothing is written', async () => {
    const w = await fullWorld('converted');
    const lead = await fullLead(w.orgId, 'Convertido');
    const [sale] = await adminClient<{ id: string }[]>`
      INSERT INTO sales_ops_sales
        (org_id, sequence, code, client_name_snapshot, seller_name_snapshot, payment_method,
         condition, base_date, total_brl, seller_commission_pct, finder_commission_pct, tax_pct,
         other_costs_brl, net_margin_brl, net_margin_pct)
      VALUES (${w.orgId}, 1, 'PROP-LIX-1', 'Empresa A', 'Vendedor A', 'pix', 'cash', now(),
              100000, 10, 3, 6, 0, 0, 0)
      RETURNING id`;
    okLead(
      await moveLead(
        db,
        w.orgId,
        lead.id,
        MoveLeadSchema.parse({ stageId: w.conversion.id, position: 0, saleId: sale!.id }),
        ADMIN_SCOPE,
      ),
    );

    expect(await deleteLead(db, w.orgId, lead.id, ADMIN_SCOPE, ADMIN_ACTOR)).toEqual({
      ok: false,
      reason: 'already_converted',
    });
    expect((await rowOf(lead.id)).deleted_at).toBeNull();
    expect(await auditFor(lead.id)).toHaveLength(0);
    expect((await getLead(db, w.orgId, lead.id, ADMIN_SCOPE)).ok).toBe(true);
  });

  it('the delete and its ledger entry commit together', async () => {
    const w = await fullWorld('probe-delete');
    const lead = await fullLead(w.orgId, 'Sentinela');
    await withProbe(lead.id, () =>
      expectProbeRejection(deleteLead(db, w.orgId, lead.id, ADMIN_SCOPE, ADMIN_ACTOR)),
    );
    const row = await rowOf(lead.id);
    expect(row.deleted_at).toBeNull();
    expect(row.deleted_by_user_id).toBeNull();
    // Written with the pooled db instead of tx, the entry would survive on its own connection.
    expect(await auditFor(lead.id)).toHaveLength(0);
  });

  it('an admin restores a lead into its own etapa, at the end of the column, as a new ledger entry', async () => {
    const w = await fullWorld('restore');
    const a = await fullLead(w.orgId, 'A');
    const b = await fullLead(w.orgId, 'B', w.bruno.id);
    const before = (await rowOf(a.id)).stage_changed_at;

    expect(await deleteLead(db, w.orgId, a.id, ADMIN_SCOPE, ADMIN_ACTOR)).toEqual({ ok: true });
    const c = await fullLead(w.orgId, 'C');
    expect(c.position).toBe(2);

    const restorer: LeadActor = { userId: 'hub_admin_2', name: 'Outra Gestora' };
    const result = await restoreLead(db, w.orgId, a.id, restorer);
    if (!result.ok) throw new Error('restore refused');
    const restored = result.lead;
    expect(restored.stageId).toBe(w.open.id);
    expect(restored.position).toBe(3);
    expect(restored.stageChangedAt).toBe(before.toISOString());
    const row = await rowOf(a.id);
    expect([row.deleted_at, row.deleted_by_user_id, row.deleted_by_name]).toEqual([null, null, null]);
    expect(await livePositions(w.orgId, w.open.id)).toEqual([
      ['B', 1],
      ['C', 2],
      ['A', 3],
    ]);
    expect((await getLead(db, w.orgId, a.id, ADMIN_SCOPE)).ok).toBe(true);

    const entries = await auditFor(a.id);
    expect(entries).toHaveLength(2);
    expect(entries[0]!.action).toBe('lead.deleted');
    const second = entries[1]!;
    expect(second.action).toBe('lead.restored');
    expect(second.actor_user_id).toBe('hub_admin_2');
    expect(second.before_jsonb).toEqual({ deleted: true, stageName: 'Novo' });
    expect(second.after_jsonb).toEqual({
      deleted: false,
      label: 'A',
      actorLabel: 'Outra Gestora',
      metadata: { contactName: 'A', clientName: 'Empresa Pool', stageName: 'Novo', sellerName: '' },
    });
    expect(second.prev_hash).toBe(entries[0]!.entry_hash);
    for (const entry of entries) expectEntryHashValid(entry);

    expect(await restoreLead(db, w.orgId, a.id, restorer)).toEqual(NOT_FOUND);
    expect(await restoreLead(db, w.orgId, randomUUID(), restorer)).toEqual(NOT_FOUND);

    // A lost card keeps its reason through a delete and a restore.
    okLead(
      await moveLead(
        db,
        w.orgId,
        b.id,
        MoveLeadSchema.parse({ stageId: w.lost.id, position: 0, reason: 'sem verba' }),
        ADMIN_SCOPE,
      ),
    );
    expect(await deleteLead(db, w.orgId, b.id, ADMIN_SCOPE, ADMIN_ACTOR)).toEqual({ ok: true });
    const back = await restoreLead(db, w.orgId, b.id, restorer);
    if (!back.ok) throw new Error('restore refused');
    expect(back.lead.stageId).toBe(w.lost.id);
    expect(back.lead.lostReason).toBe('sem verba');
  });

  it('the restore and its ledger entry commit together', async () => {
    const w = await fullWorld('probe-restore');
    const lead = await fullLead(w.orgId, 'Sentinela restore');
    expect(await deleteLead(db, w.orgId, lead.id, ADMIN_SCOPE, ADMIN_ACTOR)).toEqual({ ok: true });
    await withProbe(lead.id, () => expectProbeRejection(restoreLead(db, w.orgId, lead.id, ADMIN_ACTOR)));
    expect((await rowOf(lead.id)).deleted_at).not.toBeNull();
    expect(await auditFor(lead.id)).toHaveLength(1);
  });

  it('a lead whose etapa was archived restores into the first open etapa; with none the answer is no_open_stage', async () => {
    const w = await fullWorld('archived');
    const lead = await fullLead(w.orgId, 'Arquivada');
    okLead(
      await moveLead(db, w.orgId, lead.id, MoveLeadSchema.parse({ stageId: w.second.id, position: 0 }), ADMIN_SCOPE),
    );
    const s1 = (await rowOf(lead.id)).stage_changed_at;
    await fullLead(w.orgId, 'Ja no Novo');

    expect(await deleteLead(db, w.orgId, lead.id, ADMIN_SCOPE, ADMIN_ACTOR)).toEqual({ ok: true });
    const archived = await updateLeadStage(db, w.orgId, w.second.id, { status: 'archived' });
    expect(archived).toMatchObject({ status: 'archived' });

    const result = await restoreLead(db, w.orgId, lead.id, ADMIN_ACTOR);
    if (!result.ok) throw new Error('restore refused');
    expect(result.lead.stageId).toBe(w.open.id);
    expect(result.lead.position).toBe(2);
    expect(result.lead.lostReason).toBeNull();
    expect(new Date(result.lead.stageChangedAt).getTime()).toBeGreaterThan(s1.getTime());
    const restored = (await auditFor(lead.id))[1]!;
    expect((restored.before_jsonb as { stageName: string }).stageName).toBe('Em negociação');
    expect((restored.after_jsonb as { metadata: { stageName: string } }).metadata.stageName).toBe('Novo');

    // Leads edition with no open etapa left: the existing 400 sentinel, and nothing is seeded.
    const org2 = newOrg('noopen');
    const unico = await createLeadStage(db, org2, LeadStageSchema.parse({ name: 'Único' }));
    if (unico === 'duplicate') throw new Error('duplicate stage');
    const carla = await vendedor(org2, 'Carla', 'hub_carla', true);
    const contact = okLead(
      await createContactLead(
        db,
        org2,
        CreateContactLeadSchema.parse({ contactName: 'Contato' }),
        leadsSellerScope('hub_carla'),
      ),
    );
    expect(contact.sellerPersonId).toBe(carla.id);
    expect(
      await deleteLead(db, org2, contact.id, leadsSellerScope('hub_carla'), { userId: 'hub_carla', name: 'Carla' }),
    ).toEqual({ ok: true });
    await updateLeadStage(db, org2, unico.id, { status: 'archived' });

    await expect(restoreLead(db, org2, contact.id, ADMIN_ACTOR)).rejects.toBeInstanceOf(LeadInputError);
    await expect(restoreLead(db, org2, contact.id, ADMIN_ACTOR)).rejects.toMatchObject({ code: 'no_open_stage' });
    expect((await rowOf(contact.id)).deleted_at).not.toBeNull();
    expect(await auditFor(contact.id)).toHaveLength(1);
    const stageCount = await adminClient<{ n: number }[]>`
      SELECT count(*)::int AS n FROM sales_ops_lead_stages WHERE org_id = ${org2}`;
    expect(stageCount[0]!.n).toBe(1);
  });

  it('the deleted list is newest first, keyset-paginated to the microsecond, scoped to its org and never carries the actor id', async () => {
    const w = await fullWorld('list');
    const l1 = await fullLead(w.orgId, 'L1');
    const l2 = await fullLead(w.orgId, 'L2', w.ana.id);
    const l3 = await fullLead(w.orgId, 'L3');
    const l4 = await fullLead(w.orgId, 'L4');
    const live = await fullLead(w.orgId, 'Viva');
    for (const lead of [l1, l2, l4]) {
      expect(await deleteLead(db, w.orgId, lead.id, ADMIN_SCOPE, ADMIN_ACTOR)).toEqual({ ok: true });
    }
    expect(
      await deleteLead(db, w.orgId, l3.id, ADMIN_SCOPE, { userId: 'hub_admin', name: null }),
    ).toEqual({ ok: true });

    // Fix the instants in raw SQL: l2 and l3 tie at the microsecond.
    // Through ::text first: postgres.js serializes a timestamptz-typed parameter
    // via a JS Date and would round the instant to milliseconds.
    const setAt = (id: string, at: string) =>
      adminClient`UPDATE sales_ops_leads SET deleted_at = ${at}::text::timestamptz WHERE id = ${id}`;
    await setAt(l1.id, '2026-10-01T12:00:00.123456Z');
    await setAt(l2.id, '2026-10-01T12:00:00.123400Z');
    await setAt(l3.id, '2026-10-01T12:00:00.123400Z');
    await setAt(l4.id, '2026-10-01T11:00:00Z');

    const tied = [l2.id, l3.id].sort().reverse();
    const expected = [l1.id, ...tied, l4.id];

    const seen: string[] = [];
    let cursor: string | undefined;
    let pages = 0;
    for (; pages < 10; ) {
      const page = await listDeletedLeads(db, w.orgId, { limit: 1, ...(cursor ? { cursor } : {}) });
      pages += 1;
      seen.push(...page.items.map((item) => item.id));
      if (pages === 1) expect(page.nextCursor).toMatch(/^2026-10-01T12:00:00\.123456Z_/);
      if (page.nextCursor === null) break;
      expect(page.nextCursor).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z_[0-9a-f-]{36}$/);
      cursor = page.nextCursor;
    }
    // A millisecond cursor would skip l2 or l3.
    expect(seen).toEqual(expected);
    expect(pages).toBe(4);

    const all = await listDeletedLeads(db, w.orgId, {});
    expect(all.items.map((item) => item.id)).toEqual(expected);
    expect(all.nextCursor).toBeNull();
    expect(all.items.map((item) => item.id)).not.toContain(live.id);
    for (const item of all.items) {
      expect(Object.keys(item).sort()).toEqual([
        'clientName',
        'contactName',
        'deletedAt',
        'deletedByName',
        'estimatedValueBrl',
        'id',
        'sellerName',
        'stageName',
      ]);
    }
    const text = JSON.stringify(all);
    expect(text).not.toContain('hub_admin');
    expect(text).not.toContain('hub_ana');
    const byId = new Map(all.items.map((item) => [item.id, item]));
    expect(byId.get(l3.id)!.deletedByName).toBeNull();
    const first = byId.get(l1.id)!;
    expect(first.deletedByName).toBe('Gestora Teste');
    expect(first.clientName).toBe('Empresa Pool');
    expect(first.estimatedValueBrl).toBe(100000);
    expect(first.deletedAt).toBe('2026-10-01T12:00:00.123Z');
    expect(byId.get(l2.id)!.sellerName).toBe('Ana Martins');

    await updateLeadStage(db, w.orgId, w.open.id, { name: 'Prospecção' });
    const renamed = await listDeletedLeads(db, w.orgId, {});
    for (const item of renamed.items) expect(item.stageName).toBe('Prospecção');

    const wb = await fullWorld('other');
    const lb = await fullLead(wb.orgId, 'De B');
    expect(await deleteLead(db, wb.orgId, lb.id, ADMIN_SCOPE, ADMIN_ACTOR)).toEqual({ ok: true });
    expect((await listDeletedLeads(db, wb.orgId, {})).items.map((item) => item.id)).toEqual([lb.id]);
    expect((await listDeletedLeads(db, w.orgId, {})).items.map((item) => item.id)).not.toContain(lb.id);

    expect(await deleteLead(db, wb.orgId, live.id, ADMIN_SCOPE, ADMIN_ACTOR)).toEqual(NOT_FOUND);
    expect(await restoreLead(db, wb.orgId, l1.id, ADMIN_ACTOR)).toEqual(NOT_FOUND);
    expect((await rowOf(live.id)).deleted_at).toBeNull();
    expect((await rowOf(l1.id)).deleted_at).not.toBeNull();
  });

  it('the real router: a vendedor deletes with 204, the lixeira answers him 403, the admin lists and restores', async () => {
    const w = await fullWorld('router');
    const lead = await fullLead(w.orgId, 'Rota', w.ana.id);

    function app(identity: { userId: string; roles: string[]; name: string }) {
      const hono = new Hono();
      hono.use('*', async (c, next) => {
        c.set('userId', identity.userId);
        c.set('orgId', w.orgId);
        c.set('userRole', identity.roles[0]);
        c.set('userRoles', identity.roles as never);
        c.set(
          'hubAuth',
          hubAuthContext({ accountId: identity.userId, workspaceId: w.orgId, name: identity.name }),
        );
        await next();
      });
      hono.route('/leads', leadsRouter);
      return hono;
    }
    const ana = app({ userId: 'hub_ana', roles: ['seller'], name: 'Ana Martins' });
    const admin = app({ userId: 'hub_admin', roles: ['admin', 'seller', 'finder'], name: 'Gestora Teste' });

    const deleted = await ana.request(`/leads/${lead.id}/delete`, { method: 'POST' });
    expect(deleted.status).toBe(204);
    expect(await deleted.text()).toBe('');
    expect((await ana.request(`/leads/${lead.id}`)).status).toBe(404);

    const forbidden = { error: 'forbidden', reason: 'admin_role_required' };
    const noRestore = await ana.request(`/leads/${lead.id}/restore`, { method: 'POST' });
    expect(noRestore.status).toBe(403);
    expect(await noRestore.json()).toEqual(forbidden);
    const noList = await ana.request('/leads/deleted');
    expect(noList.status).toBe(403);
    expect(await noList.json()).toEqual(forbidden);
    expect((await rowOf(lead.id)).deleted_at).not.toBeNull();

    const listed = await admin.request('/leads/deleted');
    expect(listed.status).toBe(200);
    const raw = await listed.text();
    expect(raw).not.toContain('hub_ana');
    const body = JSON.parse(raw) as { items: Array<{ id: string; deletedByName: string | null }>; nextCursor: string | null };
    expect(body.items.map((item) => item.id)).toEqual([lead.id]);
    expect(body.items[0]!.deletedByName).toBe('Ana Martins');
    expect(body.nextCursor).toBeNull();

    const restored = await admin.request(`/leads/${lead.id}/restore`, { method: 'POST' });
    expect(restored.status).toBe(200);
    const restoredBody = (await restored.json()) as { lead: { id: string; sellerPersonId: string | null } };
    expect(restoredBody.lead.id).toBe(lead.id);
    expect(restoredBody.lead.sellerPersonId).toBe(w.ana.id);
    expect((await ana.request(`/leads/${lead.id}`)).status).toBe(200);
  });
});
