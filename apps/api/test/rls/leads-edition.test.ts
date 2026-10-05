/**
 * The leads edition (edicao-leads) against the real database: contact-only
 * leads, vendedor-only pessoas and no system etapa, plus the FXL oracle that the
 * full-edition service calls behave exactly as before.
 *
 * Same harness as `leads-seller-scope.test.ts`: `db` is the app role under RLS,
 * `adminDb` and `adminClient` run with `app.fxl_admin`, where RLS hides nothing,
 * so every stored-value assertion is made over the admin connection.
 */
import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '../../src/db/schema.js';
import { testDatabaseUrls } from '../../src/db/__tests__/test-database-urls.js';
import {
  CreateContactLeadSchema,
  CreateLeadSchema,
  ListLeadsQuerySchema,
  MoveLeadSchema,
  UpdateContactLeadSchema,
} from '../../src/domains/sales-ops/leads/lead-schemas.js';
import {
  type LeadScope,
  type LeadView,
  type WriteLeadResult,
  createContactLead,
  createLead,
  getLead,
  listLeads,
  moveLead,
  updateContactLead,
} from '../../src/domains/sales-ops/leads/lead-service.js';
import { LeadStageSchema } from '../../src/domains/sales-ops/leads/schemas.js';
import {
  createLeadStage,
  updateLeadStage,
} from '../../src/domains/sales-ops/leads/stage-service.js';
import { ensureLeadStagesForOrg } from '../../src/domains/sales-ops/leads/stages-seed.js';
import {
  PersonSchema,
  UpdatePersonSchema,
  createPerson,
  updatePerson,
} from '../../src/domains/sales-ops/service.js';

const { appUrl: APP_DB_URL, adminUrl: ADMIN_DB_URL } = testDatabaseUrls();
const ADMIN_CONNECTION_OPTIONS = { connection: { 'app.fxl_admin': 'true' } } as const;

const ADMIN_SCOPE: LeadScope = { userId: 'hub_admin', email: null, isAdmin: true };
const ADMIN_ACTOR = { userId: 'hub_admin', displayName: 'Admin' } as const;
const LEADS = { edition: 'leads' } as const;

function sellerScope(userId: string, email: string | null = null): LeadScope {
  return { userId, email, isAdmin: false };
}

function okLead(result: WriteLeadResult): LeadView {
  if (!result.ok) throw new Error(`unexpected refusal: ${result.reason}`);
  return result.lead;
}

function slugsOf(person: { funcoes: Array<{ slug: string }> }): string[] {
  return person.funcoes.map((funcao) => funcao.slug).sort();
}

describe('sales operations leads edition: contact leads, vendedor-only pessoas, no system etapa', () => {
  let appClient: postgres.Sql;
  let adminClient: postgres.Sql;
  let adminDbClient: postgres.Sql;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let adminDb: ReturnType<typeof drizzle<typeof schema>>;
  const orgIds: string[] = [];

  function newOrg(label: string): string {
    const orgId = `org_led_${label}_${Date.now()}_${randomUUID().slice(0, 8)}`;
    orgIds.push(orgId);
    return orgId;
  }

  beforeAll(() => {
    appClient = postgres(APP_DB_URL, { max: 5 });
    adminClient = postgres(ADMIN_DB_URL, { max: 2, ...ADMIN_CONNECTION_OPTIONS });
    adminDbClient = postgres(ADMIN_DB_URL, { max: 5, ...ADMIN_CONNECTION_OPTIONS });
    db = drizzle(appClient, { schema });
    adminDb = drizzle(adminDbClient, { schema });
  });

  afterAll(async () => {
    // Archiving and restoring a pessoa (the status-only case) appends hash-chained
    // audit_log rows. Delete them while they are still the ledger TAIL (safe only
    // because the integration project runs files serially): a leftover tail makes
    // the next file that verifies a chain from genesis (conversion-ingest) fail,
    // depending on which file vitest happens to schedule in between.
    for (const orgId of orgIds) {
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
    await appClient.end();
    await adminDbClient.end();
    await adminClient.end();
  });

  async function normalStage(orgId: string, name: string) {
    const stage = await createLeadStage(db, orgId, LeadStageSchema.parse({ name }));
    if (stage === 'duplicate') throw new Error(`duplicate stage ${name}`);
    return stage;
  }

  async function leadsVendedor(orgId: string, displayName: string, contactEmail?: string) {
    const person = await createPerson(
      db,
      orgId,
      PersonSchema.parse({ displayName, ...(contactEmail ? { contactEmail } : {}) }),
      LEADS,
    );
    if (typeof person === 'string') throw new Error(`unexpected person outcome: ${person}`);
    return person;
  }

  function contactLead(overrides: Record<string, unknown> = {}) {
    return CreateContactLeadSchema.parse({ contactName: 'Contato Um', ...overrides });
  }

  async function systemStageCount(orgId: string): Promise<number> {
    const [row] = await adminClient<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM sales_ops_lead_stages
      WHERE org_id = ${orgId} AND kind <> 'normal'`;
    return row!.n;
  }

  async function stageIds(orgId: string): Promise<string[]> {
    const rows = await adminClient<Array<{ id: string }>>`
      SELECT id FROM sales_ops_lead_stages WHERE org_id = ${orgId}`;
    return rows.map((row) => row.id).sort();
  }

  async function personFuncaoRows(orgId: string, personId: string) {
    return adminClient<Array<{ id: string; funcao_id: string }>>`
      SELECT id, funcao_id FROM sales_ops_person_funcoes
      WHERE org_id = ${orgId} AND person_id = ${personId}`;
  }

  async function funcaoIdBySlug(orgId: string, slug: string): Promise<string> {
    const [row] = await adminClient<Array<{ id: string }>>`
      SELECT id FROM sales_ops_funcoes WHERE org_id = ${orgId} AND slug = ${slug}`;
    if (!row) throw new Error(`no ${slug} função`);
    return row.id;
  }

  it('creates a contact lead with only contactName and stores no empresa, value or produto', async () => {
    const orgId = newOrg('create');
    const stage = await normalStage(orgId, 'Contato');

    const lead = okLead(await createContactLead(db, orgId, contactLead(), ADMIN_SCOPE));
    expect(lead).toMatchObject({
      contactName: 'Contato Um',
      clientId: null,
      clientNameSnapshot: '',
      estimatedValueBrl: 0,
      products: [],
      contactPhone: null,
      contactEmail: null,
      contactBirthDate: null,
      stageId: stage.id,
    });

    const [row] = await adminClient<
      Array<{ client_id: string | null; client_name_snapshot: string; estimated_value_brl: number }>
    >`
      SELECT client_id, client_name_snapshot, estimated_value_brl FROM sales_ops_leads
      WHERE org_id = ${orgId} AND id = ${lead.id}`;
    expect(row).toEqual({ client_id: null, client_name_snapshot: '', estimated_value_brl: 0 });
    const [products] = await adminClient<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM sales_ops_lead_products
      WHERE org_id = ${orgId} AND lead_id = ${lead.id}`;
    expect(products!.n).toBe(0);
  });

  it('stores and projects every contact field', async () => {
    const orgId = newOrg('fields');
    await normalStage(orgId, 'Contato');

    const lead = okLead(
      await createContactLead(
        db,
        orgId,
        contactLead({
          contactPhone: ' (11) 98888-7777 ',
          contactEmail: 'Ana@Example.COM',
          contactBirthDate: '1990-05-17',
          description: 'Prefere WhatsApp',
        }),
        ADMIN_SCOPE,
      ),
    );
    expect(lead).toMatchObject({
      contactPhone: '(11) 98888-7777',
      contactEmail: 'ana@example.com',
      contactBirthDate: '1990-05-17',
      description: 'Prefere WhatsApp',
    });

    const [row] = await adminClient<
      Array<{ contact_phone: string; contact_email: string; birth: string }>
    >`
      SELECT contact_phone, contact_email, contact_birth_date::text AS birth
      FROM sales_ops_leads WHERE org_id = ${orgId} AND id = ${lead.id}`;
    expect(row).toEqual({
      contact_phone: '(11) 98888-7777',
      contact_email: 'ana@example.com',
      birth: '1990-05-17',
    });
  });

  it('updates contact fields partially', async () => {
    const orgId = newOrg('update');
    await normalStage(orgId, 'Contato');
    const created = okLead(
      await createContactLead(
        db,
        orgId,
        contactLead({
          contactPhone: '(11) 98888-7777',
          contactEmail: 'ana@example.com',
          contactBirthDate: '1990-05-17',
        }),
        ADMIN_SCOPE,
      ),
    );

    const first = okLead(
      await updateContactLead(
        db,
        orgId,
        created.id,
        UpdateContactLeadSchema.parse({ contactPhone: '' }),
        ADMIN_SCOPE,
      ),
    );
    expect(first).toMatchObject({
      contactName: 'Contato Um',
      contactPhone: null,
      contactEmail: 'ana@example.com',
      contactBirthDate: '1990-05-17',
    });

    const second = okLead(
      await updateContactLead(
        db,
        orgId,
        created.id,
        UpdateContactLeadSchema.parse({ contactBirthDate: '1991-01-02', contactName: 'Novo Nome' }),
        ADMIN_SCOPE,
      ),
    );
    expect(second).toMatchObject({
      contactName: 'Novo Nome',
      contactPhone: null,
      contactEmail: 'ana@example.com',
      contactBirthDate: '1991-01-02',
      clientNameSnapshot: '',
      estimatedValueBrl: 0,
    });
    expect(first.stageChangedAt).toBe(created.stageChangedAt);
    expect(second.stageChangedAt).toBe(created.stageChangedAt);
  });

  it('projects the contact fields on list, get and move', async () => {
    const orgId = newOrg('project');
    const a = await normalStage(orgId, 'A');
    const b = await normalStage(orgId, 'B');
    const lead = okLead(
      await createContactLead(db, orgId, contactLead({ contactEmail: 'x@y.co' }), ADMIN_SCOPE),
    );
    expect(lead.stageId).toBe(a.id);

    const list = await listLeads(
      db,
      orgId,
      ListLeadsQuerySchema.parse({ stageId: a.id }),
      ADMIN_SCOPE,
    );
    if (!list.ok) throw new Error(`unexpected refusal: ${list.reason}`);
    expect(list.leads).toHaveLength(1);
    expect(list.leads[0]!.contactEmail).toBe('x@y.co');

    const read = await getLead(db, orgId, lead.id, ADMIN_SCOPE);
    if (!read.ok) throw new Error(`unexpected refusal: ${read.reason}`);
    expect(read.lead.contactEmail).toBe('x@y.co');

    // An org with NO conversion and NO lost etapa: a move between normal etapas works.
    const moved = okLead(
      await moveLead(
        db,
        orgId,
        lead.id,
        MoveLeadSchema.parse({ stageId: b.id, position: 0 }),
        ADMIN_SCOPE,
      ),
    );
    expect(moved).toMatchObject({ stageId: b.id, lostReason: null, contactEmail: 'x@y.co' });
  });

  it('refuses a lead when the org has no etapa at all (no_open_stage)', async () => {
    const orgId = newOrg('nostage');
    await expect(createContactLead(db, orgId, contactLead(), ADMIN_SCOPE)).rejects.toMatchObject({
      name: 'LeadInputError',
      code: 'no_open_stage',
    });
    expect(await systemStageCount(orgId)).toBe(0);
    expect(await stageIds(orgId)).toEqual([]);
  });

  it('refuses a lead when the only normal etapa is archived', async () => {
    const orgId = newOrg('archived');
    const stage = await normalStage(orgId, 'Unica');
    const archived = await updateLeadStage(db, orgId, stage.id, { status: 'archived' });
    expect(archived).toMatchObject({ status: 'archived' });
    await expect(createContactLead(db, orgId, contactLead(), ADMIN_SCOPE)).rejects.toMatchObject({
      name: 'LeadInputError',
      code: 'no_open_stage',
    });
  });

  it('never creates a system etapa through any leads-edition operation', async () => {
    const orgId = newOrg('noseed');
    const a = await normalStage(orgId, 'A');
    const b = await normalStage(orgId, 'B');
    const vendedor = await leadsVendedor(orgId, 'Ana');
    const lead = okLead(
      await createContactLead(db, orgId, contactLead({ sellerPersonId: vendedor.id }), ADMIN_SCOPE),
    );
    okLead(
      await updateContactLead(
        db,
        orgId,
        lead.id,
        UpdateContactLeadSchema.parse({ contactPhone: '11 9999' }),
        ADMIN_SCOPE,
      ),
    );
    await listLeads(db, orgId, ListLeadsQuerySchema.parse({ stageId: a.id }), ADMIN_SCOPE);
    await getLead(db, orgId, lead.id, ADMIN_SCOPE);
    okLead(
      await moveLead(
        db,
        orgId,
        lead.id,
        MoveLeadSchema.parse({ stageId: b.id, position: 0 }),
        ADMIN_SCOPE,
      ),
    );
    const updated = await updatePerson(
      db,
      orgId,
      vendedor.id,
      UpdatePersonSchema.parse({ displayName: 'Ana B' }),
      ADMIN_ACTOR,
      LEADS,
    );
    expect(updated).toMatchObject({ displayName: 'Ana B' });

    expect(await systemStageCount(orgId)).toBe(0);
    expect(await stageIds(orgId)).toEqual([a.id, b.id].sort());
  });

  it('keeps seller scoping in the leads edition', async () => {
    const orgId = newOrg('scope');
    const stage = await normalStage(orgId, 'Contato');
    const ana = await leadsVendedor(orgId, 'Ana');
    const bruno = await leadsVendedor(orgId, 'Bruno');
    await adminClient`
      UPDATE sales_ops_people SET hub_account_id = 'hub_ana'
      WHERE org_id = ${orgId} AND id = ${ana.id}`;

    okLead(
      await createContactLead(db, orgId, contactLead({ sellerPersonId: ana.id }), ADMIN_SCOPE),
    );
    okLead(
      await createContactLead(db, orgId, contactLead({ sellerPersonId: bruno.id }), ADMIN_SCOPE),
    );

    const anaBoard = await listLeads(
      adminDb,
      orgId,
      ListLeadsQuerySchema.parse({ stageId: stage.id }),
      sellerScope('hub_ana'),
    );
    if (!anaBoard.ok) throw new Error(`unexpected refusal: ${anaBoard.reason}`);
    expect(anaBoard.leads.map((lead) => lead.sellerPersonId)).toEqual([ana.id]);

    expect(
      await createContactLead(
        db,
        orgId,
        contactLead({ sellerPersonId: bruno.id }),
        sellerScope('hub_ana'),
      ),
    ).toEqual({ ok: false, reason: 'seller_scope' });
    okLead(
      await createContactLead(
        db,
        orgId,
        contactLead({ sellerPersonId: ana.id }),
        sellerScope('hub_ana'),
      ),
    );

    await leadsVendedor(orgId, 'Carla', 'carla@construbom.test');
    const carlaBoard = await listLeads(
      db,
      orgId,
      ListLeadsQuerySchema.parse({ stageId: stage.id }),
      sellerScope('hub_carla', 'carla@construbom.test'),
    );
    expect(carlaBoard.ok).toBe(true);
    expect(
      await listLeads(
        db,
        orgId,
        ListLeadsQuerySchema.parse({ stageId: stage.id }),
        sellerScope('hub_nobody', 'ninguem@construbom.test'),
      ),
    ).toEqual({ ok: false, reason: 'seller_person_unmapped' });
  });

  it('seeds both system funções and makes a leads-edition pessoa exactly a vendedor', async () => {
    const orgId = newOrg('funcoes');
    const [before] = await adminClient<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM sales_ops_funcoes WHERE org_id = ${orgId}`;
    expect(before!.n).toBe(0);

    const ana = await leadsVendedor(orgId, 'Ana');
    expect(slugsOf(ana)).toEqual(['vendedor']);

    const funcoes = await adminClient<Array<{ slug: string; is_system: boolean }>>`
      SELECT slug, is_system FROM sales_ops_funcoes WHERE org_id = ${orgId} ORDER BY slug`;
    expect(funcoes).toEqual([
      { slug: 'finder', is_system: true },
      { slug: 'vendedor', is_system: true },
    ]);
  });

  it('ignores body funcaoIds in the leads edition', async () => {
    const orgId = newOrg('ignore');
    await leadsVendedor(orgId, 'Ana');
    const finderId = await funcaoIdBySlug(orgId, 'finder');
    const vendedorId = await funcaoIdBySlug(orgId, 'vendedor');

    const bodies = [
      { displayName: 'Bruno', funcaoIds: [finderId] },
      { displayName: 'Caio', funcaoIds: ['99999999-9999-4999-8999-999999999999'] },
      { displayName: 'Davi', isFinder: true, isCollaborator: true },
    ];
    for (const body of bodies) {
      const person = await createPerson(db, orgId, PersonSchema.parse(body), LEADS);
      if (typeof person === 'string') throw new Error(`unexpected person outcome: ${person}`);
      expect(slugsOf(person)).toEqual(['vendedor']);
      const rows = await personFuncaoRows(orgId, person.id);
      expect(rows.map((row) => row.funcao_id)).toEqual([vendedorId]);
    }
  });

  it('forces exactly vendedor on update in the leads edition', async () => {
    const orgId = newOrg('force');
    await leadsVendedor(orgId, 'Ana');
    const finderId = await funcaoIdBySlug(orgId, 'finder');
    const vendedorId = await funcaoIdBySlug(orgId, 'vendedor');

    const both = await createPerson(
      db,
      orgId,
      PersonSchema.parse({ displayName: 'Bruno', funcaoIds: [vendedorId, finderId] }),
    );
    if (typeof both === 'string') throw new Error(`unexpected person outcome: ${both}`);
    expect(slugsOf(both)).toEqual(['finder', 'vendedor']);

    const updated = await updatePerson(
      db,
      orgId,
      both.id,
      UpdatePersonSchema.parse({ displayName: 'Bruno B', funcaoIds: [finderId] }),
      ADMIN_ACTOR,
      LEADS,
    );
    if (updated === null || typeof updated === 'string') {
      throw new Error(`unexpected person outcome: ${String(updated)}`);
    }
    expect(slugsOf(updated)).toEqual(['vendedor']);
    const rows = await personFuncaoRows(orgId, both.id);
    expect(rows.map((row) => row.funcao_id)).toEqual([vendedorId]);

    const funcoesBefore =
      await adminClient`SELECT id FROM sales_ops_funcoes WHERE org_id = ${orgId}`;
    expect(
      await updatePerson(
        db,
        orgId,
        randomUUID(),
        UpdatePersonSchema.parse({ displayName: 'Ninguem' }),
        ADMIN_ACTOR,
        LEADS,
      ),
    ).toBeNull();
    const funcoesAfter =
      await adminClient`SELECT id FROM sales_ops_funcoes WHERE org_id = ${orgId}`;
    expect(funcoesAfter.length).toBe(funcoesBefore.length);
  });

  it('accepts an empty funcaoIds and a status-only PATCH in the leads edition (SEAM A3)', async () => {
    const orgId = newOrg('statusonly');
    const dani = await createPerson(
      db,
      orgId,
      PersonSchema.parse({ displayName: 'Dani', funcaoIds: [] }),
      LEADS,
    );
    if (typeof dani === 'string') throw new Error(`unexpected person outcome: ${dani}`);
    expect(slugsOf(dani)).toEqual(['vendedor']);
    const rowsBefore = await personFuncaoRows(orgId, dani.id);
    expect(rowsBefore).toHaveLength(1);

    const inactive = await updatePerson(
      db,
      orgId,
      dani.id,
      UpdatePersonSchema.parse({ status: 'inactive' }),
      ADMIN_ACTOR,
      LEADS,
    );
    if (inactive === null || typeof inactive === 'string') {
      throw new Error(`unexpected person outcome: ${String(inactive)}`);
    }
    expect(inactive.status).toBe('inactive');
    expect(slugsOf(inactive)).toEqual(['vendedor']);

    const active = await updatePerson(
      db,
      orgId,
      dani.id,
      UpdatePersonSchema.parse({ status: 'active' }),
      ADMIN_ACTOR,
      LEADS,
    );
    if (active === null || typeof active === 'string') {
      throw new Error(`unexpected person outcome: ${String(active)}`);
    }
    expect(active.status).toBe('active');
    expect(slugsOf(active)).toEqual(['vendedor']);

    // The same row id: the status-only PATCH never rewrote the função set.
    expect(await personFuncaoRows(orgId, dani.id)).toEqual(rowsBefore);
  });

  it('FXL oracle: full-edition people and leads are unchanged', async () => {
    const orgId = newOrg('fxl');
    expect(await createPerson(db, orgId, PersonSchema.parse({ displayName: 'Sem funcao' }))).toBe(
      'funcao_required',
    );

    await ensureLeadStagesForOrg(db, orgId);
    const lead = okLead(
      await createLead(
        db,
        orgId,
        CreateLeadSchema.parse({
          contactName: 'Contato Um',
          clientName: 'Empresa Um',
          estimatedValueBrl: 250000,
        }),
        ADMIN_SCOPE,
      ),
    );
    expect(lead).toMatchObject({
      clientNameSnapshot: 'Empresa Um',
      estimatedValueBrl: 250000,
      contactPhone: null,
      contactEmail: null,
      contactBirthDate: null,
    });
  });
});
