/**
 * Acceptance: above the import's row limit the export answers a clear warning instead of a file the
 * import would refuse. The limit is MAX_TOTAL_ROWS from workbook-schema.ts, lowered here to 2 so that
 * the test needs three rows rather than five thousand; Leads + Clientes rows add up against it.
 *
 * Run: VITEST_INTEGRATION=1 vitest run -c tests/acceptance/exportar-leads/vitest.api.config.ts
 */
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

vi.mock('../../../apps/api/src/domains/import/workbook-schema.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../apps/api/src/domains/import/workbook-schema.js')>()),
  MAX_TOTAL_ROWS: 2,
}));

import { buildXlsx, headerRow } from '../../../apps/api/src/domains/import/__tests__/xlsx-fixture.js';
import { closeDb } from '../../../apps/api/src/db/client.js';
import { WORKBOOK_SHEETS } from '../../../apps/api/src/domains/import/workbook-schema.js';
import { salesOpsRouter } from '../../../apps/api/src/domains/sales-ops/routes.js';
import { EXPORT_PATH, XLSX_TYPE, appFor, cleanupOrgs, newOrgId } from './_fixtures.js';

afterEach(cleanupOrgs);
afterAll(closeDb);

/** One lead per file: the (mocked) import limit of 2 would refuse a bigger seed. */
async function seedOneLead(orgId: string, n: number): Promise<void> {
  const leads = [headerRow('leads'), [`Contato ${n}`, `Empresa ${n}`, null, null, null, null, null, null]];
  const bytes = await buildXlsx(
    WORKBOOK_SHEETS.map((def) => ({ name: def.tab, rows: def.key === 'leads' ? leads : [headerRow(def.key)] })),
  );
  const form = new FormData();
  form.set('file', new File([new Uint8Array(bytes)], 's.xlsx'));
  const res = await appFor(salesOpsRouter, orgId).request('/import/commit', { method: 'POST', body: form });
  expect(res.status).toBe(201);
}

describe('GET /import/export/leads row limit', () => {
  it('answers 409 with a message and no xlsx when leads plus clientes exceed the import limit', async () => {
    const orgId = newOrgId('limit');
    // Free-text empresas create no cliente, so each lead is exactly one exported row.
    await seedOneLead(orgId, 1);
    await seedOneLead(orgId, 2);
    const ok = await appFor(salesOpsRouter, orgId).request(EXPORT_PATH);
    expect(ok.status).toBe(200);

    await seedOneLead(orgId, 3);
    const res = await appFor(salesOpsRouter, orgId).request(EXPORT_PATH);
    expect(res.status).toBe(409);
    expect(res.headers.get('content-type') ?? '').not.toContain(XLSX_TYPE);
    const body = (await res.json()) as { message?: string };
    expect(typeof body.message).toBe('string');
    expect((body.message ?? '').length).toBeGreaterThan(10);
  });
});
