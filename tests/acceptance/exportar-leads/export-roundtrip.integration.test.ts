/**
 * Acceptance: GET /import/export/leads on the REAL router and database, then the EXISTING import
 * (POST /import/commit) of that same file into another organization.
 *
 * Run: VITEST_INTEGRATION=1 vitest run -c tests/acceptance/exportar-leads/vitest.api.config.ts
 * (needs the local Docker test database, like every *.integration.test.ts).
 */
import { and, eq, isNull } from 'drizzle-orm';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';

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

import { buildXlsx, headerRow } from '../../../apps/api/src/domains/import/__tests__/xlsx-fixture.js';
import { closeDb, getAdminDb } from '../../../apps/api/src/db/client.js';
import { salesOpsClients, salesOpsCrmLeads } from '../../../apps/api/src/db/schema.js';
import { WORKBOOK_SHEETS } from '../../../apps/api/src/domains/import/workbook-schema.js';
import { salesOpsRouter } from '../../../apps/api/src/domains/sales-ops/routes.js';
import { EXPORT_PATH, XLSX_TYPE, appFor, cleanupOrgs, newOrgId, readTabs } from './_fixtures.js';

afterEach(cleanupOrgs);
afterAll(closeDb);

/** Org A is populated through the existing import, so no lead/cliente API shape is guessed here. */
async function seedOrgA(orgId: string): Promise<void> {
  const clientes = [headerRow('clientes'), ['Padaria Pão Quente', 'Marcos Pereira', null, '12.345.678/0001-90', null, null, null]];
  const leads = [
    headerRow('leads'),
    ['Carlos Lima', 'Padaria Pão Quente', 'R$ 12.000,00', 'Quer trocar o caixa.', null, null, null, null],
    ['Ana Prado', 'Empresa Solta Ltda', 'R$ 500,50', null, null, null, null, null],
    ['Bruno Dias', 'Padaria Pão Quente', null, null, null, null, null, null],
  ];
  const tabs = WORKBOOK_SHEETS.map((def) => ({
    name: def.tab,
    rows: def.key === 'clientes' ? clientes : def.key === 'leads' ? leads : [headerRow(def.key)],
  }));
  const bytes = await buildXlsx(tabs);
  const form = new FormData();
  form.set('file', new File([new Uint8Array(bytes)], 'a.xlsx'));
  const res = await appFor(salesOpsRouter, orgId).request('/import/commit', { method: 'POST', body: form });
  expect(res.status).toBe(201);
}

async function liveLeadNames(orgId: string): Promise<string[]> {
  const rows = await getAdminDb()
    .select({ name: salesOpsCrmLeads.contactName })
    .from(salesOpsCrmLeads)
    .where(and(eq(salesOpsCrmLeads.orgId, orgId), isNull(salesOpsCrmLeads.deletedAt)));
  return rows.map((r) => r.name as string).sort();
}

describe('GET /import/export/leads', () => {
  it('downloads an xlsx with the import template tabs and headers, filled with live leads and their clients', async () => {
    const orgA = newOrgId('a');
    const orgOther = newOrgId('other');
    await seedOrgA(orgA);
    // Another organization's data must never show up.
    await seedOrgA(orgOther);

    const res = await appFor(salesOpsRouter, orgA).request(EXPORT_PATH);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain(XLSX_TYPE);
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="[^"]+\.xlsx"$/);

    const tabs = await readTabs(await res.arrayBuffer());
    for (const def of WORKBOOK_SHEETS) {
      const rows = tabs[def.tab];
      expect(rows, `tab ${def.tab}`).toBeDefined();
      expect(rows![0]).toEqual(headerRow(def.key));
      if (def.key !== 'leads' && def.key !== 'clientes') expect(rows!.length, `tab ${def.tab} is empty`).toBe(1);
    }
    expect(tabs['Leads']!.slice(1).map((r) => r[0]).sort()).toEqual(['Ana Prado', 'Bruno Dias', 'Carlos Lima']);
    // Referenced clientes only, each once even when several leads point at it.
    expect(tabs['Clientes']!.slice(1).map((r) => r[0])).toEqual(['Padaria Pão Quente']);
    const carlos = tabs['Leads']!.find((r) => r[0] === 'Carlos Lima')!;
    expect(carlos[1]).toBe('Padaria Pão Quente');
    expect(carlos[3]).toBe('Quer trocar o caixa.');
  });

  it('leaves out deleted leads, and the clientes only they referenced', async () => {
    const orgA = newOrgId('del');
    await seedOrgA(orgA);
    await getAdminDb()
      .update(salesOpsCrmLeads)
      .set({ deletedAt: new Date(), deletedByUserId: 'u1', deletedByName: 'Admin' })
      .where(and(eq(salesOpsCrmLeads.orgId, orgA), eq(salesOpsCrmLeads.contactName, 'Ana Prado')));
    const res = await appFor(salesOpsRouter, orgA).request(EXPORT_PATH);
    const tabs = await readTabs(await res.arrayBuffer());
    expect(tabs['Leads']!.slice(1).map((r) => r[0]).sort()).toEqual(['Bruno Dias', 'Carlos Lima']);
  });

  it('is refused for a non-admin', async () => {
    const orgA = newOrgId('seller');
    await seedOrgA(orgA);
    const res = await appFor(salesOpsRouter, orgA, 'seller').request(EXPORT_PATH);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'forbidden', reason: 'admin_role_required' });
  });

  it('writes nothing: the exporting organization is unchanged', async () => {
    const orgA = newOrgId('ro');
    await seedOrgA(orgA);
    const before = await liveLeadNames(orgA);
    const clientsBefore = await getAdminDb().select().from(salesOpsClients).where(eq(salesOpsClients.orgId, orgA));
    await appFor(salesOpsRouter, orgA).request(EXPORT_PATH);
    expect(await liveLeadNames(orgA)).toEqual(before);
    const clientsAfter = await getAdminDb().select().from(salesOpsClients).where(eq(salesOpsClients.orgId, orgA));
    expect(clientsAfter.length).toBe(clientsBefore.length);
  });

  it('round trip: the file exported from A imports into B with zero errors and recreates the same leads and clientes', async () => {
    const orgA = newOrgId('rt-a');
    const orgB = newOrgId('rt-b');
    await seedOrgA(orgA);

    const exported = await appFor(salesOpsRouter, orgA).request(EXPORT_PATH);
    expect(exported.status).toBe(200);
    const bytes = new Uint8Array(await exported.arrayBuffer());

    const form = () => {
      const f = new FormData();
      f.set('file', new File([bytes], 'exportacao.xlsx'));
      return f;
    };
    const preview = await appFor(salesOpsRouter, orgB).request('/import/preview', { method: 'POST', body: form() });
    expect(preview.status).toBe(200);
    const previewBody = (await preview.json()) as { issues: Array<{ severity: string }> };
    expect(previewBody.issues.filter((i) => i.severity === 'error')).toEqual([]);

    const commit = await appFor(salesOpsRouter, orgB).request('/import/commit', { method: 'POST', body: form() });
    expect(commit.status).toBe(201);

    expect(await liveLeadNames(orgB)).toEqual(await liveLeadNames(orgA));
    const names = async (orgId: string) =>
      (await getAdminDb().select({ n: salesOpsClients.name }).from(salesOpsClients).where(eq(salesOpsClients.orgId, orgId)))
        .map((r) => r.n)
        .sort();
    expect(await names(orgB)).toEqual(await names(orgA));
  });
});
