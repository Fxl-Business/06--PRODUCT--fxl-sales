/**
 * Slice 07 oracle: the import routes on the REAL salesOpsRouter and the real database
 * (tenant role, RLS live). The round trip downloads the example template through
 * GET /import/template?example=1, previews and commits it, and compares the returned counts
 * with SELECT counts per table. Fixtures are cleaned through getAdminDb(), settlements first
 * through deleteSettlementsForOrgs.
 *
 * Run: pnpm --filter @fxl-sales/api test:integration src/domains/import/__tests__/import-routes.integration.test.ts
 */
import { randomUUID } from 'node:crypto';
import { saoPauloDayOf, todayInSaoPaulo } from '@fxl-sales/shared-utils/sao-paulo-day';
import { and, asc, count, eq, isNotNull, notInArray, notLike, sql, type SQL } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import ExcelJS from 'exceljs';
import { Hono } from 'hono';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hubAuthContext } from '../../../auth/__tests__/hub-auth-context-fixture.js';
import { deleteSettlementsForOrgs } from '../../../db/__tests__/settlement-test-cleanup.js';
import { closeDb, getAdminDb, getDb } from '../../../db/client.js';
import {
  auditLog,
  integrationOutbox,
  salesOpsAreas,
  salesOpsClients,
  salesOpsFuncoes,
  salesOpsLeadProducts,
  salesOpsLeadStages,
  salesOpsLeads,
  salesOpsPayables,
  salesOpsPeople,
  salesOpsPersonFuncoes,
  salesOpsProductFuncaoCosts,
  salesOpsProducts,
  salesOpsReceivables,
  salesOpsSaleItems,
  salesOpsSaleProfessionals,
  salesOpsSales,
  salesOpsSettings,
  salesOpsSettlements,
} from '../../../db/schema.js';
import { registerProducerFlowGate } from '../../integration/producer-gate.js';
import { LEAD_STAGE_SEEDS } from '../../sales-ops/leads/stages-seed.js';
import { AreaSchema, createArea } from '../../sales-ops/service.js';

// The router transitively resolves the Hub contract at module scope; this file drives an
// already-verified context, so the ambient Hub configuration is made unambiguously absent.
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

const gate = vi.hoisted(() => ({ liveAfterCatalog: false, live: false, failAfterExecute: false }));

vi.mock('../catalog.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../catalog.js')>();
  return {
    ...actual,
    readImportCatalog: async (...args: Parameters<typeof actual.readImportCatalog>) => {
      const catalog = await actual.readImportCatalog(...args);
      if (gate.liveAfterCatalog) gate.live = true;
      return catalog;
    },
  };
});

vi.mock('../executor.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../executor.js')>();
  return {
    ...actual,
    executeImportPlan: async (...args: Parameters<typeof actual.executeImportPlan>) => {
      const result = await actual.executeImportPlan(...args);
      if (gate.failAfterExecute) {
        const plan = args[2];
        const last = plan.operations[plan.operations.length - 1];
        if (!last) throw new Error('plan without operations');
        throw new actual.ImportExecutionError(last, 'already_paid');
      }
      return result;
    },
  };
});

const { salesOpsRouter } = await import('../../sales-ops/routes.js');
const { EXAMPLE_TEMPLATE_FILENAME, FILE_TOO_LARGE_BODY, TEMPLATE_FILENAME, XLSX_CONTENT_TYPE } = await import(
  '../routes.js'
);
const { buildExampleDataset } = await import('../template.js');
const { MAX_UPLOAD_BYTES, SHEET_KEYS, WORKBOOK_SHEETS } = await import('../workbook-schema.js');
const { buildXlsx, exampleTabs, headerRow } = await import('./xlsx-fixture.js');
import type { FixtureCell, FixtureTab } from './xlsx-fixture.js';
import type { ImportCounts, ImportIssue, SheetKey } from '../types.js';

const ACCOUNT_ID = 'hub-account-import-7f3a';
const seededOrgIds: string[] = [];
let currentOrgId = '';

function createTestApp() {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('userId', ACCOUNT_ID);
    c.set('orgId', currentOrgId);
    c.set('userRole', 'admin');
    c.set('userRoles', ['admin', 'seller', 'finder']);
    c.set('hubAuth', hubAuthContext({ accountId: ACCOUNT_ID, workspaceId: currentOrgId, name: 'Equipe FXL' }));
    await next();
  });
  app.route('/', salesOpsRouter);
  return app;
}

function newOrg(tag: string): string {
  const orgId = `org_imp_${tag}_${randomUUID()}`;
  seededOrgIds.push(orgId);
  currentOrgId = orgId;
  return orgId;
}

function formWith(bytes: Uint8Array): FormData {
  const data = new FormData();
  data.set('file', new File([new Uint8Array(bytes)], 'planilha.xlsx'));
  return data;
}

function upload(path: '/import/preview' | '/import/commit', bytes: Uint8Array) {
  return createTestApp().request(path, { method: 'POST', body: formWith(bytes) });
}

function must<T>(v: T | undefined): T {
  if (v === undefined) throw new Error('expected a value, got undefined');
  return v;
}

type OrgTable = PgTable & { orgId: Parameters<typeof eq>[0] };
const ORG_TABLES: Array<[string, OrgTable]> = [
  ['areas', salesOpsAreas],
  ['funcoes', salesOpsFuncoes],
  ['products', salesOpsProducts],
  ['productFuncaoCosts', salesOpsProductFuncaoCosts],
  ['people', salesOpsPeople],
  ['personFuncoes', salesOpsPersonFuncoes],
  ['clients', salesOpsClients],
  ['leadStages', salesOpsLeadStages],
  ['leads', salesOpsLeads],
  ['leadProducts', salesOpsLeadProducts],
  ['sales', salesOpsSales],
  ['saleItems', salesOpsSaleItems],
  ['saleProfessionals', salesOpsSaleProfessionals],
  ['receivables', salesOpsReceivables],
  ['payables', salesOpsPayables],
  ['settlements', salesOpsSettlements],
] as unknown as Array<[string, OrgTable]>;

async function countWhere(table: PgTable, where: SQL | undefined): Promise<number> {
  const [row] = await getAdminDb().select({ n: count() }).from(table).where(where);
  return Number(must(row).n);
}

/** UNFILTERED count per org table (plus audit and outbox). */
async function orgTableCounts(orgId: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const [name, table] of ORG_TABLES) out[name] = await countWhere(table, eq(table.orgId, orgId));
  out.auditLog = await countWhere(auditLog, eq(auditLog.actorOrgId, orgId));
  out.integrationOutbox = await countWhere(integrationOutbox, eq(integrationOutbox.organizationId, orgId));
  return out;
}

async function expectNothingWritten(orgId: string): Promise<void> {
  const counts = await orgTableCounts(orgId);
  expect(Object.fromEntries(Object.entries(counts).filter(([, n]) => n !== 0))).toEqual({});
}

/** The per-sheet DB count the round trip compares to the returned counts. */
async function createdBySheet(orgId: string): Promise<ImportCounts> {
  const o = (t: OrgTable) => eq(t.orgId, orgId);
  return {
    areas: await countWhere(salesOpsAreas, o(salesOpsAreas)),
    // System and legacy seeds are created on demand and are not workbook rows.
    funcoes: await countWhere(
      salesOpsFuncoes,
      and(o(salesOpsFuncoes), notInArray(salesOpsFuncoes.slug, ['vendedor', 'finder', 'prestador'])),
    ),
    produtos: await countWhere(salesOpsProducts, o(salesOpsProducts)),
    custosProduto: await countWhere(salesOpsProductFuncaoCosts, o(salesOpsProductFuncaoCosts)),
    pessoas: await countWhere(salesOpsPeople, o(salesOpsPeople)),
    clientes: await countWhere(salesOpsClients, o(salesOpsClients)),
    // The D11 seeds Novo and Em negociação are not system rows, so match them by name.
    etapas: await countWhere(
      salesOpsLeadStages,
      and(
        o(salesOpsLeadStages),
        notInArray(
          salesOpsLeadStages.name,
          LEAD_STAGE_SEEDS.map((s) => s.name),
        ),
      ),
    ),
    leads: await countWhere(salesOpsLeads, o(salesOpsLeads)),
    propostas: await countWhere(salesOpsSales, o(salesOpsSales)),
    itens: await countWhere(salesOpsSaleItems, o(salesOpsSaleItems)),
    profissionais: await countWhere(salesOpsSaleProfessionals, o(salesOpsSaleProfessionals)),
    parcelas: await countWhere(
      salesOpsReceivables,
      and(o(salesOpsReceivables), notLike(salesOpsReceivables.label, 'M%')),
    ),
    pagamentos: await countWhere(
      salesOpsSettlements,
      and(
        o(salesOpsSettlements),
        eq(salesOpsSettlements.type, 'baixa'),
        isNotNull(salesOpsSettlements.receivableId),
      ),
    ),
  };
}

function setCell(tab: FixtureTab, sheet: SheetKey, header: string, value: FixtureCell, rowIndex = 1): void {
  const column = headerRow(sheet).indexOf(header);
  if (column < 0) throw new Error(`header ${header} not found in ${sheet}`);
  const row = must(tab.rows[rowIndex]);
  row[column] = value;
}

function tabOf(tabs: FixtureTab[], sheet: SheetKey): FixtureTab {
  const name = WORKBOOK_SHEETS.find((s) => s.key === sheet)?.tab;
  return must(tabs.find((t) => t.name === name));
}

async function invalidWorkbook(): Promise<Buffer> {
  const tabs = exampleTabs();
  setCell(tabOf(tabs, 'parcelas'), 'parcelas', 'Valor (R$)', 'abc');
  setCell(tabOf(tabs, 'propostas'), 'propostas', 'Cliente', 'Cliente Que Não Existe');
  return buildXlsx(tabs);
}

function errorsOf(issues: ImportIssue[]): ImportIssue[] {
  return issues.filter((i) => i.severity === 'error');
}

beforeEach(() => {
  registerProducerFlowGate((orgId) => gate.live && orgId === currentOrgId);
});

afterEach(async () => {
  gate.liveAfterCatalog = false;
  gate.live = false;
  gate.failAfterExecute = false;
  registerProducerFlowGate(() => false);
  await deleteSettlementsForOrgs(seededOrgIds);
  const admin = getAdminDb();
  for (const orgId of seededOrgIds) {
    await admin.execute(sql`DELETE FROM integration_outbox WHERE organization_id = ${orgId}`);
    // Chain-order oracles need the global audit chain free of leftovers, so each test removes
    // its own org's entries (the integration project is serial).
    await admin.execute(sql`DELETE FROM audit_log WHERE actor_org_id = ${orgId}`);
    await admin.delete(salesOpsPayables).where(eq(salesOpsPayables.orgId, orgId));
    await admin.delete(salesOpsReceivables).where(eq(salesOpsReceivables.orgId, orgId));
    await admin.delete(salesOpsSaleProfessionals).where(eq(salesOpsSaleProfessionals.orgId, orgId));
    await admin.delete(salesOpsSaleItems).where(eq(salesOpsSaleItems.orgId, orgId));
    await admin.delete(salesOpsSales).where(eq(salesOpsSales.orgId, orgId));
    await admin.delete(salesOpsLeadProducts).where(eq(salesOpsLeadProducts.orgId, orgId));
    await admin.delete(salesOpsLeads).where(eq(salesOpsLeads.orgId, orgId));
    await admin.delete(salesOpsLeadStages).where(eq(salesOpsLeadStages.orgId, orgId));
    await admin.delete(salesOpsProductFuncaoCosts).where(eq(salesOpsProductFuncaoCosts.orgId, orgId));
    await admin.delete(salesOpsProducts).where(eq(salesOpsProducts.orgId, orgId));
    await admin.delete(salesOpsPersonFuncoes).where(eq(salesOpsPersonFuncoes.orgId, orgId));
    await admin.delete(salesOpsPeople).where(eq(salesOpsPeople.orgId, orgId));
    await admin.delete(salesOpsFuncoes).where(eq(salesOpsFuncoes.orgId, orgId));
    await admin.delete(salesOpsClients).where(eq(salesOpsClients.orgId, orgId));
    await admin.delete(salesOpsAreas).where(eq(salesOpsAreas.orgId, orgId));
    await admin.delete(salesOpsSettings).where(eq(salesOpsSettings.orgId, orgId));
  }
  seededOrgIds.length = 0;
});

afterAll(async () => {
  await closeDb();
});

describe('import routes (real router, real database)', () => {
  it('downloads the blank and the example template as xlsx attachments', async () => {
    const orgId = newOrg('template');
    const app = createTestApp();
    for (const [query, filename] of [
      ['', TEMPLATE_FILENAME],
      ['?example=1', EXAMPLE_TEMPLATE_FILENAME],
    ] as const) {
      const response = await app.request(`/import/template${query}`);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe(XLSX_CONTENT_TYPE);
      expect(response.headers.get('content-disposition')).toBe(`attachment; filename="${filename}"`);
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()) as unknown as ExcelJS.Buffer);
      const visible = workbook.worksheets.filter((w) => w.state === 'visible').map((w) => w.name);
      expect(visible).toEqual(['Leia-me', ...WORKBOOK_SHEETS.map((s) => s.tab)]);
    }
    await expectNothingWritten(orgId);
  });

  it('preview seeds the default etapas and system funcoes only inside its rolled-back transaction', async () => {
    const orgId = newOrg('seedpreview');
    const tabs: FixtureTab[] = [
      {
        name: 'Leads',
        rows: [
          headerRow('leads'),
          headerRow('leads').map(() => null),
        ],
      },
      { name: 'Pessoas', rows: [headerRow('pessoas'), headerRow('pessoas').map(() => null)] },
    ];
    setCell(tabs[0]!, 'leads', 'Contato', 'Contato Avulso');
    setCell(tabs[0]!, 'leads', 'Empresa', 'Empresa Avulsa');
    setCell(tabs[0]!, 'leads', 'Etapa', 'Novo');
    setCell(tabs[1]!, 'pessoas', 'Nome', 'Pessoa Vendedora');
    setCell(tabs[1]!, 'pessoas', 'Funções', 'Vendedor');
    const response = await upload('/import/preview', await buildXlsx(tabs));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; issues: ImportIssue[] };
    expect(errorsOf(body.issues)).toEqual([]);
    expect(body.ok).toBe(true);
    await expectNothingWritten(orgId);
  });

  it('previews an invalid workbook with located pt-BR issues and writes nothing', async () => {
    const orgId = newOrg('invalid');
    const response = await upload('/import/preview', await invalidWorkbook());
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; issues: ImportIssue[] };
    expect(body.ok).toBe(false);
    expect(body.issues).toContainEqual(
      expect.objectContaining({
        severity: 'error',
        sheet: 'parcelas',
        row: 2,
        column: 'Valor (R$)',
        code: 'invalid_money',
      }),
    );
    const cliente = body.issues.find((i) => i.severity === 'error' && i.sheet === 'propostas' && i.row === 2 && i.column === 'Cliente');
    expect(cliente?.message).toContain('Cliente Que Não Existe');
    const firstWarning = body.issues.findIndex((i) => i.severity === 'warning');
    if (firstWarning >= 0) expect(errorsOf(body.issues.slice(firstWarning))).toEqual([]);
    for (const issue of body.issues) expect(issue.message).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
    await expectNothingWritten(orgId);
  });

  it('round-trips the example template of a fresh org', async () => {
    const orgId = newOrg('roundtrip');
    const today = todayInSaoPaulo(new Date());
    const dataset = buildExampleDataset(today);
    const expectedCounts = Object.fromEntries(SHEET_KEYS.map((k) => [k, dataset[k].length])) as ImportCounts;

    const template = await createTestApp().request('/import/template?example=1');
    expect(template.status).toBe(200);
    const bytes = new Uint8Array(await template.arrayBuffer());
    await expectNothingWritten(orgId);

    const preview = await upload('/import/preview', bytes);
    expect(preview.status).toBe(200);
    const previewBody = (await preview.json()) as {
      ok: boolean;
      counts: ImportCounts;
      issues: ImportIssue[];
      truncated: boolean;
    };
    expect(errorsOf(previewBody.issues)).toEqual([]);
    expect(previewBody.ok).toBe(true);
    expect(previewBody.truncated).toBe(false);
    expect(previewBody.counts).toEqual(expectedCounts);
    await expectNothingWritten(orgId);

    const commit = await upload('/import/commit', bytes);
    expect(commit.status).toBe(201);
    const commitBody = (await commit.json()) as { counts: ImportCounts };
    expect(commitBody.counts).toEqual(previewBody.counts);

    // One-to-one for every sheet except itens and parcelas: basic propostas (a produto and no
    // Itens/Parcelas rows) create items and receivables that no row of those sheets counts.
    const created = await createdBySheet(orgId);
    const { itens, parcelas, ...oneToOne } = created;
    const { itens: expectedItens, parcelas: expectedParcelas, ...expectedOneToOne } = commitBody.counts;
    expect(oneToOne).toEqual(expectedOneToOne);
    const hasRows = (sheet: 'itens' | 'parcelas', ref: unknown) => dataset[sheet].some((r) => r['ref'] === ref);
    const basic = dataset.propostas.filter(
      (p) => p['produto'] !== null && !hasRows('itens', p['ref']) && !hasRows('parcelas', p['ref']),
    );
    expect(basic.map((p) => p['ref'])).toEqual(['P2', 'P3', 'P5']);
    expect(itens).toBe(must(expectedItens) + basic.length);
    // Each basic proposta generates 3 installments from its produto defaults.
    expect(parcelas).toBe(must(expectedParcelas) + basic.length * 3);

    const admin = getAdminDb();
    const sales = await admin.select().from(salesOpsSales).where(eq(salesOpsSales.orgId, orgId));
    const byStatus = (status: string) => sales.filter((s) => s.status === status);
    expect(byStatus('won')).toHaveLength(1);
    expect(saoPauloDayOf(must(byStatus('won')[0]).wonAt as Date)).toBe('2026-01-20');
    for (const status of ['open', 'draft', 'lost', 'cancelled']) expect(byStatus(status)).toHaveLength(1);

    // AC5: the open basic proposta splits 500000 into 166666, 166666, 166668 plus 12 recurring.
    const open = must(byStatus('open')[0]);
    const items = await admin.select().from(salesOpsSaleItems).where(eq(salesOpsSaleItems.saleId, open.id));
    expect(items).toHaveLength(1);
    expect(Number(must(items[0]).unitBrl)).toBe(500000);
    const rows = await admin
      .select()
      .from(salesOpsReceivables)
      .where(eq(salesOpsReceivables.saleId, open.id))
      .orderBy(asc(salesOpsReceivables.dueDate));
    expect(rows.filter((r) => !r.label.startsWith('M')).map((r) => Number(r.amountBrl))).toEqual([
      166666, 166666, 166668,
    ]);
    expect(rows.filter((r) => r.label.startsWith('M'))).toHaveLength(12);

    // AC6: two receivable baixas, plus the payables of the first one.
    const settlements = await admin
      .select()
      .from(salesOpsSettlements)
      .where(eq(salesOpsSettlements.orgId, orgId));
    expect(settlements.filter((s) => s.type === 'baixa' && s.receivableId !== null)).toHaveLength(2);
    for (const settlement of settlements) expect(settlement.origin).toBe('manual');
    expect(settlements.some((s) => s.payableId !== null)).toBe(true);

    const audit = await admin.select().from(auditLog).where(eq(auditLog.actorOrgId, orgId));
    expect(audit.filter((a) => a.action === 'import.completed')).toHaveLength(1);
    expect(audit).toHaveLength(1);
    expect(await countWhere(integrationOutbox, eq(integrationOutbox.organizationId, orgId))).toBe(0);

    const stages = await admin
      .select({ name: salesOpsLeadStages.name })
      .from(salesOpsLeadStages)
      .where(eq(salesOpsLeadStages.orgId, orgId));
    expect(stages.map((s) => s.name).sort()).toEqual([...LEAD_STAGE_SEEDS.map((s) => s.name), 'Diagnóstico'].sort());
  });

  it('refuses to commit a workbook whose fresh plan has errors', async () => {
    const orgId = newOrg('rejected');
    const response = await upload('/import/commit', await invalidWorkbook());
    expect(response.status).toBe(422);
    const body = (await response.json()) as { ok: boolean; truncated: boolean; issues: ImportIssue[] };
    expect(body.ok).toBe(false);
    expect(body.truncated).toBe(false);
    expect(body.issues).toContainEqual(
      expect.objectContaining({ sheet: 'parcelas', row: 2, column: 'Valor (R$)', code: 'invalid_money' }),
    );
    await expectNothingWritten(orgId);
  });

  it('re-plans at commit instead of trusting the preview', async () => {
    const orgId = newOrg('replan');
    const template = await createTestApp().request('/import/template?example=1');
    const bytes = new Uint8Array(await template.arrayBuffer());
    const preview = await upload('/import/preview', bytes);
    expect(((await preview.json()) as { ok: boolean }).ok).toBe(true);

    const area = await createArea(getDb(), orgId, AreaSchema.parse({ name: 'Tecnologia' }));
    expect(area).not.toBe('duplicate');

    const commit = await upload('/import/commit', bytes);
    expect(commit.status).toBe(422);
    const body = (await commit.json()) as { issues: ImportIssue[] };
    expect(body.issues).toContainEqual(
      expect.objectContaining({ severity: 'error', sheet: 'areas', row: 2, code: 'duplicate_existing' }),
    );
    const counts = await orgTableCounts(orgId);
    expect(Object.fromEntries(Object.entries(counts).filter(([, n]) => n !== 0))).toEqual({ areas: 1 });
  });

  it('rolls everything back when the producer pre-scan refuses the commit', async () => {
    const orgId = newOrg('prescan');
    const template = await createTestApp().request('/import/template?example=1');
    const bytes = new Uint8Array(await template.arrayBuffer());
    // The catalog reads producerFlowLive: false, then the org turns live; the executor's
    // pre-scan throws before its first operation, so only the two D11 seeds were written.
    gate.liveAfterCatalog = true;
    const commit = await upload('/import/commit', bytes);
    expect(commit.status).toBe(409);
    const body = (await commit.json()) as { error: string; reason: string; message: string };
    expect(body).toEqual({ error: 'conflict', reason: 'import_execution_failed', message: expect.any(String) });
    expect(body.message).toContain('Aba Propostas, linha 2');
    await expectNothingWritten(orgId);
  });

  it('rolls back cadastros, sales and the audit entry when execution fails after writing', async () => {
    const orgId = newOrg('afterwrite');
    const template = await createTestApp().request('/import/template?example=1');
    const bytes = new Uint8Array(await template.arrayBuffer());
    gate.failAfterExecute = true;
    const commit = await upload('/import/commit', bytes);
    expect(commit.status).toBe(409);
    expect(((await commit.json()) as { reason: string }).reason).toBe('import_execution_failed');
    await expectNothingWritten(orgId);
  });

  it('refuses won propostas and payments in a Finance-connected org and emits nothing', async () => {
    const orgId = newOrg('producer');
    gate.live = true;
    const template = await createTestApp().request('/import/template?example=1');
    const bytes = new Uint8Array(await template.arrayBuffer());
    const preview = await upload('/import/preview', bytes);
    const previewBody = (await preview.json()) as { ok: boolean; issues: ImportIssue[] };
    expect(previewBody.ok).toBe(false);
    const live = errorsOf(previewBody.issues).filter((i) => i.code === 'producer_flow_live');
    expect(live).toContainEqual(expect.objectContaining({ sheet: 'propostas', row: 2 }));
    expect(live).toContainEqual(expect.objectContaining({ sheet: 'pagamentos', row: 2 }));

    const tabs = exampleTabs().filter((t) => t.name !== tabOf(exampleTabs(), 'pagamentos').name);
    const propostas = tabOf(tabs, 'propostas');
    setCell(propostas, 'propostas', 'Situação', 'Perdida');
    setCell(propostas, 'propostas', 'Data de ganho', null);
    const third = [...must(propostas.rows[1])];
    propostas.rows.push(third);
    setCell(propostas, 'propostas', 'Ref', 'P2', 2);
    setCell(propostas, 'propostas', 'Situação', 'Cancelada', 2);
    setCell(propostas, 'propostas', 'Produto', 'Sistema de gestão', 2);
    const liveBytes = await buildXlsx(tabs);

    const second = await upload('/import/preview', liveBytes);
    const secondBody = (await second.json()) as { ok: boolean; issues: ImportIssue[] };
    expect(errorsOf(secondBody.issues)).toEqual([]);
    expect(secondBody.ok).toBe(true);

    const commit = await upload('/import/commit', liveBytes);
    expect(commit.status).toBe(201);
    const commitBody = (await commit.json()) as { counts: ImportCounts };
    expect(commitBody.counts.propostas).toBe(2);
    const sales = await getAdminDb().select().from(salesOpsSales).where(eq(salesOpsSales.orgId, orgId));
    expect(sales.map((s) => s.status).sort()).toEqual(['cancelled', 'lost']);
    expect(await countWhere(integrationOutbox, eq(integrationOutbox.organizationId, orgId))).toBe(0);
  });

  it('refuses an oversize upload through the real router', async () => {
    const orgId = newOrg('oversize');
    const response = await upload('/import/preview', new Uint8Array(MAX_UPLOAD_BYTES + 1));
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual(FILE_TOO_LARGE_BODY);
    await expectNothingWritten(orgId);
  });
});
