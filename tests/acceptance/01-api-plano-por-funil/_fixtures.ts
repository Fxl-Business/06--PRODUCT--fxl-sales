import { modulesForEdition } from '@fxl-sales/shared-utils/crm-model';
import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { hubAuthContext } from '../../../apps/api/src/auth/__tests__/hub-auth-context-fixture.js';
import { deleteCrmForOrgs, deleteSettlementsForOrgs } from '../../../apps/api/src/db/__tests__/settlement-test-cleanup.js';
import { getAdminDb } from '../../../apps/api/src/db/client.js';
import {
  salesOpsClients,
  salesOpsCrmLeads,
  salesOpsFuncoes,
  salesOpsPeople,
  salesOpsPersonFuncoes,
  salesOpsPipelineStages,
  salesOpsPipelines,
  salesOpsProducts,
  salesOpsSettings,
} from '../../../apps/api/src/db/schema.js';
import { buildXlsx, headerRow } from '../../../apps/api/src/domains/import/__tests__/xlsx-fixture.js';
import { WORKBOOK_SHEETS, getSheetDef } from '../../../apps/api/src/domains/import/workbook-schema.js';
import { salesOpsRouter } from '../../../apps/api/src/domains/sales-ops/routes.js';

const seededOrgIds: string[] = [];

export function newOrgId(tag: string): string {
  const orgId = `org_imfun_${tag}_${randomUUID()}`;
  seededOrgIds.push(orgId);
  return orgId;
}

export function appFor(orgId: string, role: 'admin' | 'seller' = 'admin') {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('userId', 'hub-account-imfun-4c1d');
    c.set('orgId', orgId);
    c.set('userRole', role);
    c.set('userRoles', role === 'admin' ? ['admin', 'seller', 'finder'] : ['seller']);
    c.set('hubAuth', hubAuthContext({ accountId: 'hub-account-imfun-4c1d', workspaceId: orgId, name: 'Equipe FXL' }));
    c.set('orgModules', modulesForEdition('full'));
    await next();
  });
  app.route('/', salesOpsRouter);
  return app;
}

/** Seeds the default funil of the org (GET /lead-stages seeds on read). Returns its id. */
export async function seedDefaultPipeline(orgId: string): Promise<string> {
  const res = await appFor(orgId).request('/lead-stages');
  if (res.status !== 200) throw new Error(`lead-stages answered ${res.status}`);
  const [row] = await getAdminDb()
    .select({ id: salesOpsPipelines.id })
    .from(salesOpsPipelines)
    .where(and(eq(salesOpsPipelines.orgId, orgId), eq(salesOpsPipelines.isDefault, true)));
  return row!.id;
}

/** Creates a funil through the real route POST /pipelines. Returns its id. */
export async function createPipeline(orgId: string, name: string, funcaoIds?: string[]): Promise<string> {
  const res = await appFor(orgId).request('/pipelines', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(funcaoIds ? { name, funcaoIds } : { name }),
  });
  if (res.status !== 201 && res.status !== 200) throw new Error(`POST /pipelines answered ${res.status}`);
  const [row] = await getAdminDb()
    .select({ id: salesOpsPipelines.id })
    .from(salesOpsPipelines)
    .where(and(eq(salesOpsPipelines.orgId, orgId), eq(salesOpsPipelines.name, name)));
  return row!.id;
}

/** Archives a funil through the real route PATCH /pipelines/:id. */
export async function archivePipeline(orgId: string, pipelineId: string): Promise<void> {
  const res = await appFor(orgId).request(`/pipelines/${pipelineId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ status: 'archived' }),
  });
  if (res.status !== 200) throw new Error(`PATCH /pipelines answered ${res.status}`);
}

/** name -> id of the etapas of one funil. */
export async function stageIdsOf(orgId: string, pipelineId: string): Promise<Record<string, string>> {
  const rows = await getAdminDb()
    .select({ id: salesOpsPipelineStages.id, name: salesOpsPipelineStages.name })
    .from(salesOpsPipelineStages)
    .where(and(eq(salesOpsPipelineStages.orgId, orgId), eq(salesOpsPipelineStages.pipelineId, pipelineId)));
  return Object.fromEntries(rows.map((r) => [r.name, r.id]));
}

export async function archiveStage(orgId: string, stageId: string): Promise<void> {
  await getAdminDb()
    .update(salesOpsPipelineStages)
    .set({ status: 'archived', archivedAt: new Date() })
    .where(and(eq(salesOpsPipelineStages.orgId, orgId), eq(salesOpsPipelineStages.id, stageId)));
}

export async function countStages(orgId: string): Promise<number> {
  const rows = await getAdminDb().select({ id: salesOpsPipelineStages.id }).from(salesOpsPipelineStages).where(eq(salesOpsPipelineStages.orgId, orgId));
  return rows.length;
}

export async function countPipelines(orgId: string): Promise<number> {
  const rows = await getAdminDb().select({ id: salesOpsPipelines.id }).from(salesOpsPipelines).where(eq(salesOpsPipelines.orgId, orgId));
  return rows.length;
}

export type LeadRow = { stageId: string; pipelineId: string };

/** Leads of the org: contact name -> {stageId, pipelineId}. */
export async function leadsOf(orgId: string): Promise<Record<string, LeadRow>> {
  const rows = await getAdminDb()
    .select({ name: salesOpsCrmLeads.contactName, stageId: salesOpsCrmLeads.stageId, pipelineId: salesOpsCrmLeads.pipelineId })
    .from(salesOpsCrmLeads)
    .where(eq(salesOpsCrmLeads.orgId, orgId));
  return Object.fromEntries(rows.map((r) => [r.name, { stageId: r.stageId, pipelineId: r.pipelineId }]));
}

/** A função of the org (custom) and its id. */
export async function createFuncao(orgId: string, name: string): Promise<string> {
  const [row] = await getAdminDb()
    .insert(salesOpsFuncoes)
    .values({ orgId, name, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), isSystem: false })
    .returning({ id: salesOpsFuncoes.id });
  return row!.id;
}

/** Seeds the system funções (the bootstrap does it on read) and returns the vendedor função id. */
export async function vendedorFuncaoId(orgId: string): Promise<string> {
  await appFor(orgId).request('/bootstrap');
  const [row] = await getAdminDb()
    .select({ id: salesOpsFuncoes.id })
    .from(salesOpsFuncoes)
    .where(and(eq(salesOpsFuncoes.orgId, orgId), eq(salesOpsFuncoes.slug, 'vendedor')));
  return row!.id;
}

/** An active pessoa holding the given funções. */
export async function createPessoa(orgId: string, name: string, funcaoIds: string[]): Promise<string> {
  const admin = getAdminDb();
  const [person] = await admin
    .insert(salesOpsPeople)
    .values({ orgId, displayName: name, contactEmail: `${name.toLowerCase().replace(/\s+/g, '.')}@exemplo.com.br`, status: 'active', isSeller: true })
    .returning({ id: salesOpsPeople.id });
  for (const funcaoId of funcaoIds) {
    await admin.insert(salesOpsPersonFuncoes).values({ orgId, personId: person!.id, funcaoId });
  }
  return person!.id;
}

export type LeadSpec = { contato: string; funil?: string | null; etapa?: string | null; vendedor?: string | null; motivoPerda?: string | null };
export type EtapaSpec = { nome: string; funil?: string | null };

/** Leads and Etapas rows built BY COLUMN KEY; every other tab is header only. */
export async function workbook(opts: { leads?: LeadSpec[]; etapas?: EtapaSpec[] }): Promise<Uint8Array> {
  const build = (key: 'leads' | 'etapas', specs: Array<Record<string, string | null | undefined>>) => [
    headerRow(key),
    ...specs.map((s) => getSheetDef(key).columns.map((c) => s[c.key] ?? null)),
  ];
  const leads = build(
    'leads',
    (opts.leads ?? []).map((l) => ({ ...l, empresa: `Empresa ${l.contato}` })),
  );
  const etapas = build('etapas', opts.etapas ?? []);
  const tabs = WORKBOOK_SHEETS.map((def) => ({
    name: def.tab,
    rows: def.key === 'leads' ? leads : def.key === 'etapas' ? etapas : [headerRow(def.key)],
  }));
  return new Uint8Array(await buildXlsx(tabs));
}

export type Maps = { stageMap?: unknown; pipelineMap?: unknown };

export function send(orgId: string, path: '/import/preview' | '/import/commit', bytes: Uint8Array, maps: Maps = {}, role: 'admin' | 'seller' = 'admin'): Promise<Response> {
  const form = new FormData();
  form.set('file', new File([new Uint8Array(bytes)], 'planilha.xlsx'));
  const put = (k: string, v: unknown) => {
    if (v !== undefined) form.set(k, typeof v === 'string' ? v : JSON.stringify(v));
  };
  put('stageMap', maps.stageMap);
  put('pipelineMap', maps.pipelineMap);
  return appFor(orgId, role).request(path, { method: 'POST', body: form });
}

export type Json = Record<string, unknown>;
export type Issue = { severity: string; sheet: string | null; row: number | null; column: string | null; code: string };

export const errorsOf = (body: Json): Issue[] => (body.issues as Issue[]).filter((i) => i.severity === 'error');

export async function cleanupOrgs(): Promise<void> {
  await deleteSettlementsForOrgs(seededOrgIds);
  const admin = getAdminDb();
  for (const orgId of seededOrgIds) {
    await admin.execute(sql`DELETE FROM integration_outbox WHERE organization_id = ${orgId}`);
    await admin.execute(sql`DELETE FROM audit_log WHERE actor_org_id = ${orgId}`);
    await deleteCrmForOrgs([orgId]);
    await admin.delete(salesOpsClients).where(eq(salesOpsClients.orgId, orgId));
    await admin.delete(salesOpsProducts).where(eq(salesOpsProducts.orgId, orgId));
    await admin.delete(salesOpsPersonFuncoes).where(eq(salesOpsPersonFuncoes.orgId, orgId));
    await admin.delete(salesOpsPeople).where(eq(salesOpsPeople.orgId, orgId));
    await admin.delete(salesOpsFuncoes).where(eq(salesOpsFuncoes.orgId, orgId));
    await admin.delete(salesOpsSettings).where(eq(salesOpsSettings.orgId, orgId));
  }
  seededOrgIds.length = 0;
}

export async function pipelineNameOf(orgId: string, pipelineId: string): Promise<string> {
  const [row] = await getAdminDb()
    .select({ name: salesOpsPipelines.name })
    .from(salesOpsPipelines)
    .where(and(eq(salesOpsPipelines.orgId, orgId), eq(salesOpsPipelines.id, pipelineId)));
  return row!.name;
}

export const HUB_ENV_RESET = [
  'FXL_HUB_CONFIG',
  'FXL_HUB_API_URL',
  'FXL_HUB_ENVIRONMENT',
  'FXL_HUB_CLIENT_ID',
  'FXL_HUB_CLIENT_SECRET',
  'FXL_HUB_AUDIENCE',
  'SALES_ENV_FILE',
  'SALES_AUTH_FAKE',
];

/** Two funis in one org: the default one and `Parcerias`, both with the seven default etapas. */
export async function twoFunis(tag: string) {
  const org = newOrgId(tag);
  const defaultId = await seedDefaultPipeline(org);
  const defaultName = await pipelineNameOf(org, defaultId);
  const parceriasId = await createPipeline(org, 'Parcerias');
  return {
    org,
    defaultId,
    defaultName,
    parceriasId,
    defaultStages: await stageIdsOf(org, defaultId),
    parceriasStages: await stageIdsOf(org, parceriasId),
  };
}
