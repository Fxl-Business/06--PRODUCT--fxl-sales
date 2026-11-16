/**
 * Vários funis por organização, against the real database: the pipeline writes (seven default
 * etapas and their graph, the default pipeline that cannot be archived, the funções that reach a
 * pipeline) and the ONE access predicate every lead read and write goes through.
 *
 *  - A vendedor holding only the vendedor função reaches only the default pipeline (exactly as
 *    before pipelines could be linked).
 *  - A vendedor holding a função linked to the Funil Financeiro reaches only the pipelines of that
 *    função.
 *  - An admin reaches every pipeline.
 *  - A lead of a pipeline out of reach is `not_found` to get, PATCH, move, advance and delete; the
 *    unassigned pool, the board, the summary and the follow-ups shrink to the reachable pipelines,
 *    and a seller never creates a lead in a pipeline out of reach.
 *
 * The pipeline predicate is not an RLS policy, so it is load-bearing over the ordinary connection;
 * the org predicate is asserted over `adminDb`, where the admin policy exposes every org.
 *
 * Run: pnpm --filter @fxl-sales/api exec env VITEST_INTEGRATION=1 vitest run test/rls/pipeline-access.test.ts
 */
import { randomUUID } from 'node:crypto';
import { DEFAULT_PIPELINE_STAGES, DEFAULT_PIPELINE_TRANSITIONS } from '@fxl-sales/shared-utils/default-pipeline';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '../../src/db/schema.js';
import { testDatabaseUrls } from '../../src/db/__tests__/test-database-urls.js';
import { deleteCrmForOrgs } from '../../src/db/__tests__/settlement-test-cleanup.js';
import { listPipelines, type PipelineView } from '../../src/domains/crm/crm-read-service.js';
import { createPipeline, updatePipeline } from '../../src/domains/crm/pipeline-admin-service.js';
import { CreatePipelineSchema, UpdatePipelineSchema } from '../../src/domains/crm/pipeline-schemas.js';
import {
  addLeadFollowup,
  advanceLead,
  listFollowups,
  markFollowupDone,
} from '../../src/domains/sales-ops/leads/lead-history-service.js';
import {
  AdvanceLeadSchema,
  LeadFollowupSchema,
  LeadPatchSchema,
  LeadStageSummaryQuerySchema,
  LeadWriteBaseSchema,
  ListFollowupsQuerySchema,
  ListLeadsQuerySchema,
  MoveLeadSchema,
} from '../../src/domains/sales-ops/leads/lead-schemas.js';
import {
  LeadInputError,
  createLead,
  getLead,
  listLeads,
  moveLead,
  resolveCallerPipelineAccess,
  summarizeLeadStages,
  updateLead,
  type LeadScope,
} from '../../src/domains/sales-ops/leads/lead-service.js';
import { deleteLead } from '../../src/domains/sales-ops/leads/lead-trash-service.js';
import {
  FuncaoSchema,
  PersonSchema,
  createFuncao,
  createPerson,
} from '../../src/domains/sales-ops/service.js';

const { appUrl: APP_DB_URL, adminUrl: ADMIN_DB_URL } = testDatabaseUrls();
const ADMIN_CONNECTION_OPTIONS = { connection: { 'app.fxl_admin': 'true' } } as const;

const ADMIN_SCOPE: LeadScope = { userId: 'hub_admin', email: null, isAdmin: true };
const sellerScope = (userId: string): LeadScope => ({ userId, email: null, isAdmin: false });

describe('vários funis: pipeline writes and access by função', () => {
  let appClient: postgres.Sql;
  let adminClient: postgres.Sql;
  let adminDbClient: postgres.Sql;
  let db: ReturnType<typeof drizzle<typeof schema>>;
  let adminDb: ReturnType<typeof drizzle<typeof schema>>;
  const orgIds: string[] = [];

  function newOrg(label: string): string {
    const orgId = `org_pac_${label}_${Date.now()}_${randomUUID().slice(0, 8)}`;
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
    for (const orgId of orgIds) {
      await deleteCrmForOrgs([orgId]);
      await adminClient`DELETE FROM sales_ops_person_funcoes WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_people WHERE org_id = ${orgId}`;
      await adminClient`DELETE FROM sales_ops_funcoes WHERE org_id = ${orgId}`;
    }
    await appClient.end();
    await adminDbClient.end();
    await adminClient.end();
  });

  async function pipelinesFor(orgId: string, scope: LeadScope, includeArchived = false): Promise<PipelineView[]> {
    return listPipelines(db, orgId, { reachable: (tx) => resolveCallerPipelineAccess(tx, orgId, scope), includeArchived });
  }

  async function okPipeline(promise: Promise<PipelineView | string | null>): Promise<PipelineView> {
    const result = await promise;
    if (result === null || typeof result === 'string') throw new Error(`unexpected pipeline outcome: ${String(result)}`);
    return result;
  }

  /** A pessoa with the vendedor função (plus `extraFuncaoIds`), bound to a Hub account. */
  async function seller(orgId: string, name: string, hubAccountId: string, extraFuncaoIds: string[] = []) {
    const plain = await createPerson(db, orgId, PersonSchema.parse({ displayName: name, isSeller: true }));
    if (typeof plain === 'string') throw new Error(`unexpected person outcome: ${plain}`);
    if (extraFuncaoIds.length > 0) {
      for (const funcaoId of extraFuncaoIds) {
        await adminClient`
          INSERT INTO sales_ops_person_funcoes (org_id, person_id, funcao_id)
          VALUES (${orgId}, ${plain.id}, ${funcaoId})`;
      }
    }
    await adminClient`
      UPDATE sales_ops_people SET hub_account_id = ${hubAccountId} WHERE org_id = ${orgId} AND id = ${plain.id}`;
    return plain;
  }

  async function funcao(orgId: string, name: string): Promise<string> {
    const created = await createFuncao(db, orgId, FuncaoSchema.parse({ name }));
    if (typeof created === 'string') throw new Error(`unexpected função outcome: ${created}`);
    return created.id;
  }

  function openStages(pipeline: PipelineView) {
    return pipeline.stages
      .filter((stage) => stage.type === 'normal' && stage.status === 'active')
      .sort((a, b) => a.position - b.position);
  }

  async function okLead(promise: Promise<{ ok: boolean }>) {
    const result = (await promise) as { ok: boolean; reason?: string; lead?: { id: string; pipelineId: string } };
    if (!result.ok || !result.lead) throw new Error(`unexpected refusal: ${result.reason}`);
    return result.lead;
  }

  /**
   * One org shaped like the Construbom request: the default Comercial pipeline, a Funil Financeiro
   * linked to the Financeiro função, Ana (vendedor only), Bia (vendedor + Financeiro) and one lead
   * per pipeline, each assigned and one unassigned pool lead per pipeline.
   */
  async function construbom(label: string) {
    const orgId = newOrg(label);
    const [comercial] = await pipelinesFor(orgId, ADMIN_SCOPE);
    const financeiroFuncao = await funcao(orgId, 'Financeiro');
    const financeiro = await okPipeline(
      createPipeline(db, orgId, CreatePipelineSchema.parse({ name: 'Funil Financeiro', funcaoIds: [financeiroFuncao] })),
    );
    const ana = await seller(orgId, 'Ana', 'hub_ana');
    const bia = await seller(orgId, 'Bia', 'hub_bia', [financeiroFuncao]);
    const lead = (pipelineId: string, sellerPersonId: string | null) =>
      okLead(
        createLead(
          db,
          orgId,
          LeadWriteBaseSchema.parse({ contactName: 'Contato', contactPhone: '11999990000', pipelineId, sellerPersonId }),
          ADMIN_SCOPE,
        ),
      );
    return {
      orgId,
      comercial: comercial!,
      financeiro,
      financeiroFuncao,
      ana,
      bia,
      anaComercial: await lead(comercial!.id, ana.id),
      anaFinanceiro: await lead(financeiro.id, ana.id),
      biaFinanceiro: await lead(financeiro.id, bia.id),
      biaComercial: await lead(comercial!.id, bia.id),
      poolComercial: await lead(comercial!.id, null),
      poolFinanceiro: await lead(financeiro.id, null),
    };
  }

  it('POST /pipelines creates a non-default pipeline with the seven default etapas and the default graph', async () => {
    const orgId = newOrg('create');
    const created = await okPipeline(createPipeline(db, orgId, CreatePipelineSchema.parse({ name: 'Funil Financeiro' })));
    expect(created).toMatchObject({ name: 'Funil Financeiro', isDefault: false, status: 'active', funcaoIds: [] });

    // The org's default pipeline was seeded first, so the new one never became it.
    const all = await pipelinesFor(orgId, ADMIN_SCOPE);
    expect(all.map((pipeline) => [pipeline.name, pipeline.isDefault])).toEqual([
      [all[0]!.name, true],
      ['Funil Financeiro', false],
    ]);
    expect(created.position).toBeGreaterThan(all[0]!.position);

    const stages = [...created.stages].sort((a, b) => a.position - b.position);
    expect(stages.map((stage) => [stage.name, stage.position, stage.type, stage.exitKind])).toEqual(
      DEFAULT_PIPELINE_STAGES.map((stage) => [stage.label, stage.order, stage.type, stage.exitKind]),
    );
    const idByKey = new Map(DEFAULT_PIPELINE_STAGES.map((stage, index) => [stage.key as string, stages[index]!.id]));
    expect(new Set(created.transitions.map((t) => `${t.fromStageId}>${t.toStageId}`))).toEqual(
      new Set(DEFAULT_PIPELINE_TRANSITIONS.map(([from, to]) => `${idByKey.get(from)}>${idByKey.get(to)}`)),
    );
    expect(created.transitions).toHaveLength(DEFAULT_PIPELINE_TRANSITIONS.length);

    // Over the admin connection: every stage and edge is the org's own and the new pipeline's.
    const rows = await adminClient<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM sales_ops_pipeline_stages WHERE pipeline_id = ${created.id} AND org_id = ${orgId}`;
    expect(rows[0]!.n).toBe(DEFAULT_PIPELINE_STAGES.length);

    expect(await createPipeline(db, orgId, CreatePipelineSchema.parse({ name: 'Funil Financeiro' }))).toBe('duplicate');
  });

  it('the default pipeline cannot be archived; another one can, and is restored by status', async () => {
    const orgId = newOrg('archive');
    const [comercial] = await pipelinesFor(orgId, ADMIN_SCOPE);
    expect(await updatePipeline(db, orgId, comercial!.id, UpdatePipelineSchema.parse({ status: 'archived' }))).toBe('is_default');
    const [stillActive] = await adminClient<Array<{ status: string }>>`
      SELECT status FROM sales_ops_pipelines WHERE org_id = ${orgId} AND id = ${comercial!.id}`;
    expect(stillActive!.status).toBe('active');

    const financeiro = await okPipeline(createPipeline(db, orgId, CreatePipelineSchema.parse({ name: 'Financeiro' })));
    const archived = await okPipeline(updatePipeline(db, orgId, financeiro.id, UpdatePipelineSchema.parse({ status: 'archived' })));
    expect(archived.status).toBe('archived');
    expect((await pipelinesFor(orgId, ADMIN_SCOPE)).map((pipeline) => pipeline.id)).toEqual([comercial!.id]);
    expect((await pipelinesFor(orgId, ADMIN_SCOPE, true)).map((pipeline) => pipeline.id)).toEqual([comercial!.id, financeiro.id]);

    const restored = await okPipeline(updatePipeline(db, orgId, financeiro.id, UpdatePipelineSchema.parse({ status: 'active' })));
    expect(restored.status).toBe('active');
    const renamed = await okPipeline(updatePipeline(db, orgId, financeiro.id, UpdatePipelineSchema.parse({ name: 'Cobrança' })));
    expect(renamed.name).toBe('Cobrança');
    expect(await updatePipeline(db, orgId, financeiro.id, UpdatePipelineSchema.parse({ name: comercial!.name }))).toBe('duplicate');
    expect(await updatePipeline(db, orgId, randomUUID(), UpdatePipelineSchema.parse({ name: 'X' }))).toBeNull();
  });

  it('the funções of a pipeline are a full set of the org own active funções', async () => {
    const orgId = newOrg('funcoes');
    const financeiroFuncao = await funcao(orgId, 'Financeiro');
    const cobrancaFuncao = await funcao(orgId, 'Cobrança');
    const pipeline = await okPipeline(
      createPipeline(db, orgId, CreatePipelineSchema.parse({ name: 'Financeiro', funcaoIds: [financeiroFuncao] })),
    );
    expect(pipeline.funcaoIds).toEqual([financeiroFuncao]);
    const replaced = await okPipeline(
      updatePipeline(db, orgId, pipeline.id, UpdatePipelineSchema.parse({ funcaoIds: [cobrancaFuncao] })),
    );
    expect(replaced.funcaoIds).toEqual([cobrancaFuncao]);

    // Another org's função is invisible here and refused, and nothing is written.
    const otherOrg = newOrg('funcoes_other');
    const foreign = await funcao(otherOrg, 'Estrangeira');
    expect(
      await updatePipeline(db, orgId, pipeline.id, UpdatePipelineSchema.parse({ funcaoIds: [foreign] })),
    ).toBe('unknown_funcao');
    expect(await createPipeline(db, orgId, CreatePipelineSchema.parse({ name: 'Outro', funcaoIds: [foreign] }))).toBe(
      'unknown_funcao',
    );
    const links = await adminClient<Array<{ funcao_id: string }>>`
      SELECT funcao_id FROM sales_ops_pipeline_funcoes WHERE org_id = ${orgId}`;
    expect(links.map((link) => link.funcao_id)).toEqual([cobrancaFuncao]);
    const pipelines = await adminClient<Array<{ name: string }>>`
      SELECT name FROM sales_ops_pipelines WHERE org_id = ${orgId} ORDER BY position`;
    expect(pipelines.map((row) => row.name)).not.toContain('Outro');

    const cleared = await okPipeline(updatePipeline(db, orgId, pipeline.id, UpdatePipelineSchema.parse({ funcaoIds: [] })));
    expect(cleared.funcaoIds).toEqual([]);
  });

  it('GET /pipelines: vendedor-only sees the default, a linked função sees only its pipelines, an admin sees all', async () => {
    const org = await construbom('read');
    expect((await pipelinesFor(org.orgId, sellerScope('hub_ana'))).map((p) => p.id)).toEqual([org.comercial.id]);
    expect((await pipelinesFor(org.orgId, sellerScope('hub_bia'))).map((p) => p.id)).toEqual([org.financeiro.id]);
    expect((await pipelinesFor(org.orgId, ADMIN_SCOPE)).map((p) => p.id)).toEqual([org.comercial.id, org.financeiro.id]);
    // A caller with no pessoa holds no função: the default pipeline, like a vendedor-only one.
    expect((await pipelinesFor(org.orgId, sellerScope('hub_nobody'))).map((p) => p.id)).toEqual([org.comercial.id]);
    // includeArchived never widens a seller's set (the route ignores it for a non-admin anyway).
    expect((await pipelinesFor(org.orgId, sellerScope('hub_ana'), true)).map((p) => p.id)).toEqual([org.comercial.id]);

    // Linking the vendedor função to the Funil Financeiro gives Ana that pipeline instead.
    const vendedorId = (
      await adminClient<Array<{ id: string }>>`
        SELECT id FROM sales_ops_funcoes WHERE org_id = ${org.orgId} AND slug = 'vendedor'`
    )[0]!.id;
    await okPipeline(
      updatePipeline(db, org.orgId, org.financeiro.id, UpdatePipelineSchema.parse({ funcaoIds: [org.financeiroFuncao, vendedorId] })),
    );
    expect((await pipelinesFor(org.orgId, sellerScope('hub_ana'))).map((p) => p.id)).toEqual([org.financeiro.id]);
  });

  it('the board, the summary and the unassigned pool cover only the reachable pipelines', async () => {
    const org = await construbom('board');
    const board = async (scope: LeadScope, pipeline: PipelineView) => {
      const ids: string[] = [];
      for (const stage of openStages(pipeline)) {
        const page = await listLeads(
          adminDb,
          org.orgId,
          ListLeadsQuerySchema.parse({ stageId: stage.id, pipelineId: pipeline.id }),
          scope,
        );
        if (!page.ok) throw new Error(page.reason);
        ids.push(...page.leads.map((lead) => lead.id));
      }
      return ids.sort();
    };

    // Ana (vendedor only): her own Comercial lead and the Comercial pool, never Financeiro.
    expect(await board(sellerScope('hub_ana'), org.comercial)).toEqual([org.anaComercial.id, org.poolComercial.id].sort());
    expect(await board(sellerScope('hub_ana'), org.financeiro)).toEqual([]);
    // Bia (Financeiro): her Financeiro lead and the Financeiro pool, never Comercial, even her own.
    expect(await board(sellerScope('hub_bia'), org.financeiro)).toEqual([org.biaFinanceiro.id, org.poolFinanceiro.id].sort());
    expect(await board(sellerScope('hub_bia'), org.comercial)).toEqual([]);
    // The admin sees every lead of each pipeline.
    expect(await board(ADMIN_SCOPE, org.financeiro)).toEqual(
      [org.anaFinanceiro.id, org.biaFinanceiro.id, org.poolFinanceiro.id].sort(),
    );

    const total = async (scope: LeadScope, pipelineId?: string) => {
      const summary = await summarizeLeadStages(
        adminDb,
        org.orgId,
        LeadStageSummaryQuerySchema.parse(pipelineId ? { pipelineId } : {}),
        scope,
      );
      if (!summary.ok) throw new Error(summary.reason);
      return summary.stages.reduce((sum, stage) => sum + stage.count, 0);
    };
    expect(await total(sellerScope('hub_bia'), org.comercial.id)).toBe(0);
    // Without a pipelineId the summary covers the pipeline Bia's board opens on: her Financeiro.
    expect(await total(sellerScope('hub_bia'))).toBe(2);
    expect(await total(sellerScope('hub_ana'))).toBe(2);
    expect(await total(ADMIN_SCOPE)).toBe(3);
  });

  it('a lead of a pipeline out of reach is not_found to get, PATCH, move, advance and delete, and is never claimed', async () => {
    const org = await construbom('identity');
    const [first, second] = openStages(org.financeiro);
    const ana = sellerScope('hub_ana');
    const actor = { userId: 'hub_ana', name: 'Ana' };

    // Her OWN lead in the Funil Financeiro and the Financeiro pool lead alike.
    for (const lead of [org.anaFinanceiro, org.poolFinanceiro]) {
      expect(await getLead(db, org.orgId, lead.id, ana)).toEqual({ ok: false, reason: 'not_found' });
      expect(await updateLead(db, org.orgId, lead.id, LeadPatchSchema.parse({ contactName: 'Outro' }), ana)).toEqual({
        ok: false,
        reason: 'not_found',
      });
      expect(
        await moveLead(db, org.orgId, lead.id, MoveLeadSchema.parse({ stageId: second!.id, position: 0 }), ana),
      ).toEqual({ ok: false, reason: 'not_found' });
      expect(
        await advanceLead(
          db,
          org.orgId,
          lead.id,
          AdvanceLeadSchema.parse({ toStageId: second!.id, nextStep: 'Ligar', dueOn: '2026-12-01' }),
          ana,
        ),
      ).toEqual({ ok: false, reason: 'not_found' });
      expect(await deleteLead(db, org.orgId, lead.id, ana, actor)).toEqual({ ok: false, reason: 'not_found' });
    }

    // Nothing moved, nothing was claimed, nothing was deleted.
    const rows = await adminClient<Array<{ id: string; stage_id: string; seller_person_id: string | null; contact_name: string; deleted_at: Date | null }>>`
      SELECT id, stage_id, seller_person_id, contact_name, deleted_at FROM sales_ops_crm_leads
      WHERE org_id = ${org.orgId} AND id IN (${org.anaFinanceiro.id}, ${org.poolFinanceiro.id}) ORDER BY id`;
    for (const row of rows) {
      expect(row.stage_id).toBe(first!.id);
      expect(row.contact_name).toBe('Contato');
      expect(row.deleted_at).toBeNull();
    }
    expect(rows.find((row) => row.id === org.poolFinanceiro.id)!.seller_person_id).toBeNull();

    // Bia reaches the same leads: the pool lead is claimed by her first write.
    const claimed = await updateLead(db, org.orgId, org.poolFinanceiro.id, LeadPatchSchema.parse({ contactName: 'Bia' }), sellerScope('hub_bia'));
    expect(claimed).toMatchObject({ ok: true, lead: { sellerPersonId: org.bia.id } });
    expect(await getLead(db, org.orgId, org.biaFinanceiro.id, sellerScope('hub_bia'))).toMatchObject({ ok: true });
    expect(
      await moveLead(db, org.orgId, org.biaFinanceiro.id, MoveLeadSchema.parse({ stageId: second!.id, position: 0 }), sellerScope('hub_bia')),
    ).toMatchObject({ ok: true, lead: { stageId: second!.id } });
    // And Bia's own Comercial lead is out of HER reach.
    expect(await getLead(db, org.orgId, org.biaComercial.id, sellerScope('hub_bia'))).toEqual({ ok: false, reason: 'not_found' });
    // The admin reaches every pipeline.
    expect(await getLead(db, org.orgId, org.anaFinanceiro.id, ADMIN_SCOPE)).toMatchObject({ ok: true });
  });

  it('a seller never creates a lead in a pipeline out of reach; without a pipelineId the lead lands in a reachable one', async () => {
    const org = await construbom('create_scope');
    const body = (pipelineId?: string) =>
      LeadWriteBaseSchema.parse({ contactName: 'Novo', contactPhone: '11988887777', ...(pipelineId ? { pipelineId } : {}) });
    await expect(createLead(db, org.orgId, body(org.financeiro.id), sellerScope('hub_ana'))).rejects.toMatchObject({
      code: 'pipeline_not_found',
    });
    await expect(createLead(db, org.orgId, body(org.comercial.id), sellerScope('hub_bia'))).rejects.toBeInstanceOf(
      LeadInputError,
    );
    expect((await okLead(createLead(db, org.orgId, body(), sellerScope('hub_ana')))).pipelineId).toBe(org.comercial.id);
    expect((await okLead(createLead(db, org.orgId, body(), sellerScope('hub_bia')))).pipelineId).toBe(org.financeiro.id);
    expect((await okLead(createLead(db, org.orgId, body(org.financeiro.id), sellerScope('hub_bia')))).pipelineId).toBe(
      org.financeiro.id,
    );
    const [count] = await adminClient<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM sales_ops_crm_leads WHERE org_id = ${org.orgId} AND contact_name = 'Novo'`;
    expect(count!.n).toBe(3);
  });

  it('follow-ups of a lead out of reach are neither listed nor completed, even by their owner', async () => {
    const org = await construbom('followups');
    const followup = await addLeadFollowup(
      db,
      org.orgId,
      org.anaFinanceiro.id,
      LeadFollowupSchema.parse({ nextStep: 'Cobrar', dueOn: '2026-12-01', ownerPersonId: org.ana.id }),
      ADMIN_SCOPE,
    );
    if (!followup.ok) throw new Error(followup.reason);
    const mine = await listFollowups(db, org.orgId, ListFollowupsQuerySchema.parse({ scope: 'mine' }), sellerScope('hub_ana'));
    expect(mine).toEqual({ ok: true, followups: [] });
    expect(await markFollowupDone(db, org.orgId, followup.followup.id, sellerScope('hub_ana'))).toEqual({
      ok: false,
      reason: 'not_found',
    });
    const team = await listFollowups(db, org.orgId, ListFollowupsQuerySchema.parse({ scope: 'team' }), ADMIN_SCOPE);
    if (!team.ok) throw new Error(team.reason);
    expect(team.followups.map((row) => row.id)).toEqual([followup.followup.id]);
  });
});
