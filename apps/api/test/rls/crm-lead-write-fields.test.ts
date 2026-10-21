/**
 * The unified lead write path (vendas-crm-unificado slice 07a): typed dynamic fields, the legacy
 * keys mapped onto them, the Cliente backing column, the initial history event, the create
 * pipeline/stage rules, the patch contact rule and the transitions of a new etapa.
 *
 * Run: pnpm --filter @fxl-sales/api exec env VITEST_INTEGRATION=1 vitest run test/rls/crm-lead-write-fields.test.ts
 */
import { randomUUID } from 'node:crypto';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deleteCrmForOrgs } from '../../src/db/__tests__/settlement-test-cleanup.js';
import { testDatabaseUrls } from '../../src/db/__tests__/test-database-urls.js';
import * as schema from '../../src/db/schema.js';
import { LeadPatchSchema, LeadWriteBaseSchema } from '../../src/domains/sales-ops/leads/lead-schemas.js';
import { LeadInputError, createLead, updateLead, type LeadScope } from '../../src/domains/sales-ops/leads/lead-service.js';
import { LeadStageSchema } from '../../src/domains/sales-ops/leads/schemas.js';
import { createLeadStage } from '../../src/domains/sales-ops/leads/stage-service.js';
import { ensureLeadStagesForOrg } from '../../src/domains/sales-ops/leads/stages-seed.js';
import { AreaSchema, ProductSchema, createArea, createClient, createProduct, ClientSchema } from '../../src/domains/sales-ops/service.js';

const { appUrl, adminUrl } = testDatabaseUrls();
const ADMIN = { connection: { 'app.fxl_admin': 'true' } } as const;
const SCOPE: LeadScope = { userId: 'hub_admin', email: 'adm@x.com', name: 'Admin Nome', isAdmin: true };

describe('unified lead write: dynamic fields and legacy keys', () => {
  const orgIds: string[] = [];
  let appClient: postgres.Sql;
  let adminClient: postgres.Sql;
  let db: ReturnType<typeof drizzle<typeof schema>>;

  beforeAll(() => {
    appClient = postgres(appUrl, { max: 3 });
    adminClient = postgres(adminUrl, { max: 2, ...ADMIN });
    db = drizzle(appClient, { schema });
  });

  afterAll(async () => {
    for (const orgId of orgIds) {
      await deleteCrmForOrgs([orgId]);
      await adminClient`DELETE FROM sales_ops_products WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_areas WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_clients WHERE org_id = ${orgId}`;
    }
    await appClient.end();
    await adminClient.end();
  });

  const newOrg = (label: string) => {
    const orgId = `org_crmw_${label}_${Date.now()}_${randomUUID().slice(0, 6)}`;
    orgIds.push(orgId);
    return orgId;
  };
  const body = (extra: Record<string, unknown> = {}) =>
    LeadWriteBaseSchema.parse({ contactName: 'Ana', contactEmail: 'ana@x.com', ...extra });
  async function ok(orgId: string, extra: Record<string, unknown> = {}) {
    const result = await createLead(db, orgId, body(extra), SCOPE);
    if (!result.ok) throw new Error(`refused: ${result.reason}`);
    return result.lead;
  }
  async function reason(promise: Promise<unknown>): Promise<{ code: string; index: number }> {
    try {
      await promise;
    } catch (error) {
      if (error instanceof LeadInputError) return { code: error.code, index: error.itemIndex };
      throw error;
    }
    throw new Error('expected a LeadInputError');
  }
  async function defineField(orgId: string, key: string, kind: string, extra: Record<string, unknown> = {}) {
    const [row] = await adminClient<{ id: string }[]>`
      INSERT INTO sales_ops_field_definitions (org_id, key, label, kind, reference_target, multiple, options, position)
      VALUES (${orgId}, ${key}, ${key}, ${kind}, ${(extra.referenceTarget as string) ?? null}, ${(extra.multiple as boolean) ?? false},
              ${extra.options ? JSON.stringify(extra.options) : null}::jsonb, 10)
      RETURNING id`;
    return row!.id;
  }

  it('stores each kind in its typed slot and reads it back on the wire', async () => {
    const orgId = newOrg('kinds');
    await ensureLeadStagesForOrg(db, orgId);
    await defineField(orgId, 'obs', 'text');
    await defineField(orgId, 'qtd', 'number');
    await defineField(orgId, 'verba', 'money');
    await defineField(orgId, 'visita', 'date');
    await defineField(orgId, 'origem', 'options', { options: [{ key: 'site', label: 'Site' }] });
    const lead = await ok(orgId, {
      fields: [
        { key: 'obs', value: 'texto' },
        { key: 'qtd', value: 2.5 },
        { key: 'verba', value: 150000 },
        { key: 'visita', value: '2026-10-20' },
        { key: 'origem', value: 'site' },
      ],
    });
    const by = Object.fromEntries(lead.fields.map((f) => [f.key, f.value]));
    expect(by).toMatchObject({ obs: 'texto', qtd: 2.5, verba: 150000, visita: '2026-10-20', origem: 'site', cliente: null });
    const [slots] = await adminClient<{ n: number }[]>`
      SELECT count(*)::int AS n FROM sales_ops_crm_lead_field_values WHERE lead_id = ${lead.id}`;
    expect(slots?.n).toBe(5);
  });

  it('null clears a field and an omitted field stays untouched', async () => {
    const orgId = newOrg('clear');
    await ensureLeadStagesForOrg(db, orgId);
    await defineField(orgId, 'obs', 'text');
    await defineField(orgId, 'qtd', 'number');
    const lead = await ok(orgId, { fields: [{ key: 'obs', value: 'a' }, { key: 'qtd', value: 1 }] });
    const patched = await updateLead(db, orgId, lead.id, LeadPatchSchema.parse({ fields: [{ key: 'obs', value: null }] }), SCOPE);
    if (!patched.ok) throw new Error('refused');
    const by = Object.fromEntries(patched.lead.fields.map((f) => [f.key, f.value]));
    expect(by).toMatchObject({ obs: null, qtd: 1 });
    const untouched = await updateLead(db, orgId, lead.id, LeadPatchSchema.parse({ contactName: 'Novo nome' }), SCOPE);
    if (!untouched.ok) throw new Error('refused');
    expect(untouched.lead.fields.find((f) => f.key === 'qtd')!.value).toBe(1);
  });

  it('refuses a bad field with the entry index: unknown, wrong shape, duplicate, single-valued with two, missing reference', async () => {
    const orgId = newOrg('invalid');
    await ensureLeadStagesForOrg(db, orgId);
    await defineField(orgId, 'qtd', 'number');
    await defineField(orgId, 'origem', 'options', { options: [{ key: 'site', label: 'Site' }] });
    await defineField(orgId, 'item', 'reference', { referenceTarget: 'produto', multiple: false });
    const attempt = (fields: unknown[]) => reason(createLead(db, orgId, body({ fields }), SCOPE));
    expect(await attempt([{ key: 'nope', value: 'x' }])).toEqual({ code: 'field_not_found', index: 0 });
    expect(await attempt([{ key: 'qtd', value: 1 }, { key: 'qtd', value: 2 }])).toEqual({ code: 'field_invalid', index: 1 });
    expect(await attempt([{ key: 'qtd', value: 'abc' }])).toEqual({ code: 'field_invalid', index: 0 });
    expect(await attempt([{ key: 'origem', value: 'telefone' }])).toEqual({ code: 'field_invalid', index: 0 });
    expect(await attempt([{ key: 'item', value: [{ name: 'a' }, { name: 'b' }] }])).toEqual({ code: 'field_invalid', index: 0 });
    expect(await attempt([{ key: 'item', value: [{ id: randomUUID() }] }])).toEqual({ code: 'field_reference_not_found', index: 0 });
    const [count] = await adminClient<{ n: number }[]>`SELECT count(*)::int AS n FROM sales_ops_crm_leads WHERE org_id = ${orgId}`;
    expect(count?.n).toBe(0);
  });

  it('Cliente is the backing column: a cliente entry sets client_id and the snapshot; naming clientId too is refused', async () => {
    const orgId = newOrg('cliente');
    await ensureLeadStagesForOrg(db, orgId);
    const cliente = await createClient(db, orgId, ClientSchema.parse({ name: 'Empresa Real' }));
    const lead = await ok(orgId, { fields: [{ key: 'cliente', value: [{ id: cliente.id }] }] });
    expect(lead.clientId).toBe(cliente.id);
    expect(lead.clientNameSnapshot).toBe('Empresa Real');
    expect(lead.fields.find((f) => f.key === 'cliente')!.value).toEqual([{ id: cliente.id, name: 'Empresa Real' }]);
    const [stored] = await adminClient<{ n: number }[]>`
      SELECT count(*)::int AS n FROM sales_ops_crm_lead_field_values WHERE lead_id = ${lead.id}`;
    expect(stored?.n).toBe(0);
    expect(await reason(createLead(db, orgId, body({ clientId: cliente.id, fields: [{ key: 'cliente', value: [{ id: cliente.id }] }] }), SCOPE))).toEqual({
      code: 'field_invalid',
      index: 0,
    });
    const cleared = await updateLead(db, orgId, lead.id, LeadPatchSchema.parse({ fields: [{ key: 'cliente', value: null }] }), SCOPE);
    if (!cleared.ok) throw new Error('refused');
    expect(cleared.lead.clientId).toBeNull();
    expect(cleared.lead.clientNameSnapshot).toBe('Empresa Real');
  });

  it('maps description, contactBirthDate and products onto descricao, nascimento and produtos (definitions created on first use)', async () => {
    const orgId = newOrg('legacy');
    await ensureLeadStagesForOrg(db, orgId);
    const area = await createArea(db, orgId, AreaSchema.parse({ name: 'Tech' }));
    if (area === 'duplicate') throw new Error('dup');
    const { product } = await createProduct(db, orgId, ProductSchema.parse({ name: 'Sistema', areaId: area.id }));
    const lead = await ok(orgId, {
      description: 'obs',
      contactBirthDate: '1990-01-02',
      products: [{ productId: product.id }, { productName: 'Avulso' }],
    });
    expect(lead).toMatchObject({ description: 'obs', contactBirthDate: '1990-01-02' });
    expect(lead.products).toEqual([
      { productId: null, productNameSnapshot: 'Avulso' },
      { productId: product.id, productNameSnapshot: 'Sistema' },
    ]);
    const defs = await adminClient<{ key: string; kind: string; position: number; multiple: boolean }[]>`
      SELECT key, kind, position, multiple FROM sales_ops_field_definitions WHERE org_id = ${orgId} ORDER BY position`;
    expect(defs).toEqual([
      { key: 'cliente', kind: 'reference', position: 1, multiple: false },
      { key: 'produtos', kind: 'reference', position: 2, multiple: true },
      { key: 'descricao', kind: 'text', position: 3, multiple: false },
      { key: 'nascimento', kind: 'date', position: 4, multiple: false },
    ]);
    const cleared = await updateLead(db, orgId, lead.id, LeadPatchSchema.parse({ description: '', contactBirthDate: null, products: [] }), SCOPE);
    if (!cleared.ok) throw new Error('refused');
    expect(cleared.lead).toMatchObject({ description: null, contactBirthDate: null, products: [] });
  });

  it('a missing produto in the legacy products array is product_not_found with the row index', async () => {
    const orgId = newOrg('prodmissing');
    await ensureLeadStagesForOrg(db, orgId);
    expect(await reason(createLead(db, orgId, body({ products: [{ productName: 'ok' }, { productId: randomUUID() }] }), SCOPE))).toEqual({
      code: 'product_not_found',
      index: 1,
    });
  });

  it('writes exactly one initial history event on create, by the server, with the actor name; a patch writes none', async () => {
    const orgId = newOrg('event');
    const stages = await ensureLeadStagesForOrg(db, orgId);
    const lead = await ok(orgId);
    await updateLead(db, orgId, lead.id, LeadPatchSchema.parse({ contactName: 'Outro' }), SCOPE);
    const events = await adminClient<{ kind: string; from_stage_id: string | null; to_stage_id: string; actor_user_id: string; actor_name_snapshot: string }[]>`
      SELECT kind, from_stage_id, to_stage_id, actor_user_id, actor_name_snapshot FROM sales_ops_crm_lead_events WHERE lead_id = ${lead.id}`;
    expect(events).toEqual([
      { kind: 'stage_changed', from_stage_id: null, to_stage_id: stages.find((s) => s.name === 'Novo')!.id, actor_user_id: 'hub_admin', actor_name_snapshot: 'Admin Nome' },
    ]);
  });

  it('a create names a pipeline and an open stage; an exit stage, another pipeline or an unknown pipeline are refused', async () => {
    const orgId = newOrg('createstage');
    const stages = await ensureLeadStagesForOrg(db, orgId);
    const second = stages.find((s) => s.name === 'Qualificação')!;
    const lead = await ok(orgId, { pipelineId: second.pipelineId, stageId: second.id });
    expect(lead.stageId).toBe(second.id);
    expect(lead.pipelineId).toBe(second.pipelineId);
    expect(lead.stageType).toBe('normal');
    expect(lead.stageExitKind).toBeNull();
    const ganho = stages.find((s) => s.name === 'Ganho')!;
    expect((await reason(createLead(db, orgId, body({ stageId: ganho.id }), SCOPE))).code).toBe('stage_not_open');
    expect((await reason(createLead(db, orgId, body({ pipelineId: randomUUID() }), SCOPE))).code).toBe('pipeline_not_found');
    const [other] = await adminClient<{ id: string }[]>`
      INSERT INTO sales_ops_pipelines (org_id, name, position) VALUES (${orgId}, 'Carteira', 1) RETURNING id`;
    expect((await reason(createLead(db, orgId, body({ pipelineId: other!.id, stageId: second.id }), SCOPE))).code).toBe('stage_not_found');
  });

  it('a PATCH that would leave no phone and no e-mail is contact_required, and writes nothing', async () => {
    const orgId = newOrg('contact');
    await ensureLeadStagesForOrg(db, orgId);
    const lead = await ok(orgId, { contactPhone: '119' });
    expect((await reason(updateLead(db, orgId, lead.id, LeadPatchSchema.parse({ contactPhone: '', contactEmail: '' }), SCOPE))).code).toBe('contact_required');
    const ok2 = await updateLead(db, orgId, lead.id, LeadPatchSchema.parse({ contactPhone: '' }), SCOPE);
    if (!ok2.ok) throw new Error('refused');
    expect(ok2.lead.contactPhone).toBeNull();
    expect(ok2.lead.contactEmail).toBe('ana@x.com');
  });

  it('a new etapa gets the transitions the shared rule gives it, and no other pair changes', async () => {
    const orgId = newOrg('transitions');
    const stages = await ensureLeadStagesForOrg(db, orgId);
    const [{ n: before } = { n: 0 }] = await adminClient<{ n: number }[]>`SELECT count(*)::int AS n FROM sales_ops_pipeline_transitions WHERE org_id = ${orgId}`;
    expect(before).toBe(22);
    const created = await createLeadStage(db, orgId, LeadStageSchema.parse({ name: 'Diagnóstico' }));
    if (typeof created === 'string') throw new Error('dup');
    const pairs = await adminClient<{ from_stage_id: string; to_stage_id: string }[]>`
      SELECT from_stage_id, to_stage_id FROM sales_ops_pipeline_transitions
       WHERE org_id = ${orgId} AND (from_stage_id = ${created.id} OR to_stage_id = ${created.id})`;
    const byName = (id: string) => stages.find((s) => s.id === id)?.name ?? 'Diagnóstico';
    const label = pairs.map((p) => `${byName(p.from_stage_id)}>${byName(p.to_stage_id)}`).sort();
    // The new stage is the last open one by position (after the exits): previous open is Proposta.
    expect(label).toEqual(
      ['Proposta>Diagnóstico', 'Diagnóstico>Proposta', 'Diagnóstico>Ganho', 'Diagnóstico>Perdido', 'Diagnóstico>Pausado', 'Pausado>Diagnóstico'].sort(),
    );
    const [{ n: after } = { n: 0 }] = await adminClient<{ n: number }[]>`SELECT count(*)::int AS n FROM sales_ops_pipeline_transitions WHERE org_id = ${orgId}`;
    expect(after).toBe(22 + 6);
  });
});
