import { modulesForEdition } from '@fxl-sales/shared-utils/crm-model';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import { Hono } from 'hono';
import { hubAuthContext } from '../../../apps/api/src/auth/__tests__/hub-auth-context-fixture.js';
import { deleteCrmForOrgs, deleteSettlementsForOrgs } from '../../../apps/api/src/db/__tests__/settlement-test-cleanup.js';
import { getAdminDb } from '../../../apps/api/src/db/client.js';
import {
  salesOpsClients,
  salesOpsFuncoes,
  salesOpsPeople,
  salesOpsPersonFuncoes,
  salesOpsProducts,
  salesOpsSettings,
} from '../../../apps/api/src/db/schema.js';
import { eq } from 'drizzle-orm';

/** Shared by the two integration files of this slice. The export route is GET /import/export/leads. */
export const EXPORT_PATH = '/import/export/leads';
export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const seededOrgIds: string[] = [];

export function newOrgId(tag: string): string {
  const orgId = `org_exp_${tag}_${randomUUID()}`;
  seededOrgIds.push(orgId);
  return orgId;
}

export function appFor(salesOpsRouter: Hono, orgId: string, role: 'admin' | 'seller' = 'admin') {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('userId', 'hub-account-export-3c1d');
    c.set('orgId', orgId);
    c.set('userRole', role);
    c.set('userRoles', role === 'admin' ? ['admin', 'seller', 'finder'] : ['seller']);
    c.set('hubAuth', hubAuthContext({ accountId: 'hub-account-export-3c1d', workspaceId: orgId, name: 'Equipe FXL' }));
    c.set('orgModules', modulesForEdition('full'));
    await next();
  });
  app.route('/', salesOpsRouter);
  return app;
}

/** Every worksheet as rows of cell text, header row first, keyed by the tab name. */
export async function readTabs(bytes: ArrayBuffer | Uint8Array): Promise<Record<string, string[][]>> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(bytes instanceof Uint8Array ? Buffer.from(bytes) : Buffer.from(new Uint8Array(bytes)));
  const out: Record<string, string[][]> = {};
  wb.eachSheet((ws) => {
    const rows: string[][] = [];
    ws.eachRow({ includeEmpty: false }, (row) => {
      const cells: string[] = [];
      for (let c = 1; c <= ws.columnCount; c += 1) cells.push(String(row.getCell(c).text ?? '').trim());
      rows.push(cells);
    });
    out[ws.name] = rows;
  });
  return out;
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
