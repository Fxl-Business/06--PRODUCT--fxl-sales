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
  salesOpsProducts,
  salesOpsSettings,
} from '../../../apps/api/src/db/schema.js';
import { buildXlsx, headerRow } from '../../../apps/api/src/domains/import/__tests__/xlsx-fixture.js';
import { WORKBOOK_SHEETS } from '../../../apps/api/src/domains/import/workbook-schema.js';
import { salesOpsRouter } from '../../../apps/api/src/domains/sales-ops/routes.js';

const seededOrgIds: string[] = [];

export function newOrgId(tag: string): string {
  const orgId = `org_mapeta_${tag}_${randomUUID()}`;
  seededOrgIds.push(orgId);
  return orgId;
}

export function appFor(orgId: string) {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('userId', 'hub-account-mapeta-9b2e');
    c.set('orgId', orgId);
    c.set('userRole', 'admin');
    c.set('userRoles', ['admin', 'seller', 'finder']);
    c.set('hubAuth', hubAuthContext({ accountId: 'hub-account-mapeta-9b2e', workspaceId: orgId, name: 'Equipe FXL' }));
    c.set('orgModules', modulesForEdition('full'));
    await next();
  });
  app.route('/', salesOpsRouter);
  return app;
}

/** Seeds the default etapas of the org (GET /lead-stages seeds on read) and returns name -> id. */
export async function seedStages(orgId: string): Promise<Record<string, string>> {
  const res = await appFor(orgId).request('/lead-stages');
  if (res.status !== 200) throw new Error(`lead-stages answered ${res.status}`);
  return stageIds(orgId);
}

export async function stageIds(orgId: string): Promise<Record<string, string>> {
  const rows = await getAdminDb()
    .select({ id: salesOpsPipelineStages.id, name: salesOpsPipelineStages.name })
    .from(salesOpsPipelineStages)
    .where(eq(salesOpsPipelineStages.orgId, orgId));
  return Object.fromEntries(rows.map((r) => [r.name, r.id]));
}

export async function archiveStage(orgId: string, stageId: string): Promise<void> {
  await getAdminDb()
    .update(salesOpsPipelineStages)
    .set({ status: 'archived', archivedAt: new Date() })
    .where(and(eq(salesOpsPipelineStages.orgId, orgId), eq(salesOpsPipelineStages.id, stageId)));
}

/** Leads of the org: contact name -> stage id. */
export async function leadStages(orgId: string): Promise<Record<string, string>> {
  const rows = await getAdminDb()
    .select({ name: salesOpsCrmLeads.contactName, stageId: salesOpsCrmLeads.stageId })
    .from(salesOpsCrmLeads)
    .where(eq(salesOpsCrmLeads.orgId, orgId));
  return Object.fromEntries(rows.map((r) => [r.name, r.stageId]));
}

/** A leads workbook: [contato, etapa, motivoPerda]; every other tab is header only. */
export async function leadsWorkbook(rows: Array<[string, string | null, string | null?]>): Promise<Uint8Array> {
  const leads = [
    headerRow('leads'),
    ...rows.map(([contato, etapa, motivo]) => [contato, `Empresa ${contato}`, null, null, null, null, etapa, motivo ?? null]),
  ];
  const tabs = WORKBOOK_SHEETS.map((def) => ({ name: def.tab, rows: def.key === 'leads' ? leads : [headerRow(def.key)] }));
  return new Uint8Array(await buildXlsx(tabs));
}

export function send(
  orgId: string,
  path: '/import/preview' | '/import/commit',
  bytes: Uint8Array,
  stageMap?: unknown,
): Promise<Response> {
  const form = new FormData();
  form.set('file', new File([new Uint8Array(bytes)], 'planilha.xlsx'));
  if (stageMap !== undefined) form.set('stageMap', typeof stageMap === 'string' ? stageMap : JSON.stringify(stageMap));
  return appFor(orgId).request(path, { method: 'POST', body: form });
}

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
