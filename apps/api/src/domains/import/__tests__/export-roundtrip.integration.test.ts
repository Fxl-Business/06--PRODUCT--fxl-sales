/**
 * Round trip of the leads export on the REAL salesOpsRouter and database: organization A is populated through the
 * existing import, GET /import/export/leads downloads its leads and clientes, and the EXISTING preview and commit
 * load that same file into organization B. The import is not touched; B only needs the etapas (seeded by the
 * import itself), the vendedor and the produtos that A had.
 *
 * Run: pnpm --filter @fxl-sales/api test:integration src/domains/import/__tests__/export-roundtrip.integration.test.ts
 */
import { modulesForEdition } from '@fxl-sales/shared-utils/crm-model';
import { randomUUID } from 'node:crypto';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import { hubAuthContext } from '../../../auth/__tests__/hub-auth-context-fixture.js';
import { deleteCrmForOrgs, deleteSettlementsForOrgs } from '../../../db/__tests__/settlement-test-cleanup.js';
import { closeDb, getAdminDb } from '../../../db/client.js';
import {
  auditLog,
  salesOpsAreas,
  salesOpsClients,
  salesOpsCrmLeadFieldValues,
  salesOpsCrmLeads,
  salesOpsFieldDefinitions,
  salesOpsFuncoes,
  salesOpsPayables,
  salesOpsPeople,
  salesOpsPersonFuncoes,
  salesOpsPipelineStages,
  salesOpsProducts,
  salesOpsReceivables,
  salesOpsSaleItems,
  salesOpsSaleProfessionals,
  salesOpsSales,
  salesOpsSettings,
} from '../../../db/schema.js';

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

const { salesOpsRouter } = await import('../../sales-ops/routes.js');
const { WORKBOOK_SHEETS } = await import('../workbook-schema.js');
const { buildXlsx, headerRow } = await import('./xlsx-fixture.js');
import type { FixtureCell, FixtureTab } from './xlsx-fixture.js';
import type { ImportIssue, SheetKey } from '../types.js';

const EXPORT_PATH = '/import/export/leads';
const ACCOUNT_ID = 'hub-account-roundtrip-5b2e';
const seededOrgIds: string[] = [];

function newOrg(tag: string): string {
  const orgId = `org_rt_${tag}_${randomUUID()}`;
  seededOrgIds.push(orgId);
  return orgId;
}

function appFor(orgId: string): Hono {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('userId', ACCOUNT_ID);
    c.set('orgId', orgId);
    c.set('userRole', 'admin');
    c.set('userRoles', ['admin', 'seller', 'finder']);
    c.set('hubAuth', hubAuthContext({ accountId: ACCOUNT_ID, workspaceId: orgId, name: 'Equipe FXL' }));
    c.set('orgModules', modulesForEdition('full'));
    await next();
  });
  app.route('/', salesOpsRouter);
  return app;
}

function must<T>(v: T | undefined): T {
  if (v === undefined) throw new Error('expected a value, got undefined');
  return v;
}

/** One tab named from WORKBOOK_SHEETS: the header row, then each row's cells by header text (null when absent). */
function sheetTab(sheet: SheetKey, rows: Array<Record<string, FixtureCell>>): FixtureTab {
  const name = must(WORKBOOK_SHEETS.find((s) => s.key === sheet)).tab;
  const headers = headerRow(sheet);
  return { name, rows: [headers, ...rows.map((row) => headers.map((h) => row[h] ?? null))] };
}

function formWith(bytes: Uint8Array): FormData {
  const data = new FormData();
  data.set('file', new File([new Uint8Array(bytes)], 'planilha.xlsx'));
  return data;
}

async function importInto(orgId: string, path: '/import/preview' | '/import/commit', bytes: Uint8Array) {
  return appFor(orgId).request(path, { method: 'POST', body: formWith(bytes) });
}

/** The catalog both organizations share before any lead arrives: area, produtos and a vendedor. */
const CATALOG_TABS = (): FixtureTab[] => [
  sheetTab('areas', [{ Nome: 'Tecnologia' }]),
  sheetTab('produtos', [
    { Nome: 'Sistema de gestão', Área: 'Tecnologia', 'Valor (R$)': 'R$ 5.000,00' },
    { Nome: 'Consultoria', Tipo: 'Serviço', Área: 'Tecnologia' },
  ]),
  sheetTab('pessoas', [{ Nome: 'Ana Souza', 'E-mail': 'ana@exemplo.com.br', Funções: 'Vendedor' }]),
];

async function commitOk(orgId: string, tabs: FixtureTab[]): Promise<void> {
  const res = await importInto(orgId, '/import/commit', await buildXlsx(tabs));
  expect(res.status).toBe(201);
}

type LeadView = {
  contato: string;
  empresa: string;
  clientName: string | null;
  valor: number;
  vendedor: string | null;
  etapa: string;
  motivo: string | null;
  descricao: string | null;
  produtos: string[];
};

async function liveLeads(orgId: string): Promise<LeadView[]> {
  const admin = getAdminDb();
  const leads = await admin
    .select({
      id: salesOpsCrmLeads.id,
      contactName: salesOpsCrmLeads.contactName,
      snapshot: salesOpsCrmLeads.clientNameSnapshot,
      clientName: salesOpsClients.name,
      value: salesOpsCrmLeads.estimatedValueBrl,
      seller: salesOpsPeople.displayName,
      stage: salesOpsPipelineStages.name,
      lostReason: salesOpsCrmLeads.lostReason,
    })
    .from(salesOpsCrmLeads)
    .leftJoin(
      salesOpsClients,
      and(eq(salesOpsClients.orgId, salesOpsCrmLeads.orgId), eq(salesOpsClients.id, salesOpsCrmLeads.clientId)),
    )
    .leftJoin(
      salesOpsPeople,
      and(eq(salesOpsPeople.orgId, salesOpsCrmLeads.orgId), eq(salesOpsPeople.id, salesOpsCrmLeads.sellerPersonId)),
    )
    .innerJoin(
      salesOpsPipelineStages,
      and(eq(salesOpsPipelineStages.orgId, salesOpsCrmLeads.orgId), eq(salesOpsPipelineStages.id, salesOpsCrmLeads.stageId)),
    )
    .where(and(eq(salesOpsCrmLeads.orgId, orgId), isNull(salesOpsCrmLeads.deletedAt)))
    .orderBy(asc(salesOpsCrmLeads.contactName));
  const values = await admin
    .select({
      leadId: salesOpsCrmLeadFieldValues.leadId,
      key: salesOpsFieldDefinitions.key,
      text: salesOpsCrmLeadFieldValues.valueText,
      snapshot: salesOpsCrmLeadFieldValues.refNameSnapshot,
      position: salesOpsCrmLeadFieldValues.position,
    })
    .from(salesOpsCrmLeadFieldValues)
    .innerJoin(
      salesOpsFieldDefinitions,
      and(
        eq(salesOpsFieldDefinitions.orgId, salesOpsCrmLeadFieldValues.orgId),
        eq(salesOpsFieldDefinitions.id, salesOpsCrmLeadFieldValues.fieldId),
      ),
    )
    .where(eq(salesOpsCrmLeadFieldValues.orgId, orgId))
    .orderBy(asc(salesOpsCrmLeadFieldValues.position));
  return leads.map((l) => {
    const own = values.filter((v) => v.leadId === l.id);
    const descricao = own.find((v) => v.key === 'descricao')?.text ?? null;
    return {
      contato: l.contactName,
      empresa: l.snapshot,
      clientName: l.clientName,
      valor: l.value,
      vendedor: l.seller,
      etapa: l.stage,
      motivo: l.lostReason,
      descricao: descricao === '' ? null : descricao,
      produtos: own.filter((v) => v.key === 'produtos').map((v) => v.snapshot ?? v.text ?? ''),
    };
  });
}

async function clienteNames(orgId: string): Promise<string[]> {
  const rows = await getAdminDb()
    .select({ name: salesOpsClients.name })
    .from(salesOpsClients)
    .where(eq(salesOpsClients.orgId, orgId));
  return rows.map((r) => r.name).sort();
}

afterEach(async () => {
  await deleteSettlementsForOrgs(seededOrgIds);
  const admin = getAdminDb();
  for (const orgId of seededOrgIds) {
    await admin.execute(sql`DELETE FROM integration_outbox WHERE organization_id = ${orgId}`);
    await admin.execute(sql`DELETE FROM audit_log WHERE actor_org_id = ${orgId}`);
    await admin.delete(salesOpsPayables).where(eq(salesOpsPayables.orgId, orgId));
    await admin.delete(salesOpsReceivables).where(eq(salesOpsReceivables.orgId, orgId));
    await admin.delete(salesOpsSaleProfessionals).where(eq(salesOpsSaleProfessionals.orgId, orgId));
    await admin.delete(salesOpsSaleItems).where(eq(salesOpsSaleItems.orgId, orgId));
    await deleteCrmForOrgs([orgId]);
    await admin.delete(salesOpsSales).where(eq(salesOpsSales.orgId, orgId));
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

describe('leads export round trip (real router, real database)', () => {
  it('exports from A and imports into B with zero errors, recreating the same leads and clientes and leaving out the deleted, the converted and the other organization', async () => {
    const orgA = newOrg('a');
    const orgB = newOrg('b');
    const orgOther = newOrg('other');
    const admin = getAdminDb();

    // A: clientes, leads in a normal etapa and in Perdido, plus a lead to delete and a lead to convert.
    await commitOk(orgA, [
      ...CATALOG_TABS(),
      sheetTab('clientes', [
        { Nome: 'Padaria Pão Quente', Contato: 'Marcos Pereira', 'CNPJ/CPF': '12.345.678/0001-90' },
        { Nome: 'Oficina do Zé', 'Razão social': 'Oficina do Zé Ltda' },
        { Nome: 'Cliente Só do Excluído' },
        { Nome: 'Cliente Só do Convertido' },
      ]),
      sheetTab('propostas', [
        {
          Ref: 'P1',
          Cliente: 'Cliente Só do Convertido',
          Vendedor: 'Ana Souza',
          Situação: 'Aberta',
          'Data base': '15/01/2026',
          Produto: 'Sistema de gestão',
        },
      ]),
      sheetTab('leads', [
        {
          Contato: 'Carlos Lima',
          Empresa: 'Padaria Pão Quente',
          'Valor estimado (R$)': 'R$ 12.000,50',
          Descrição: 'Quer trocar o caixa.',
          Vendedor: 'Ana Souza',
          Produtos: 'Sistema de gestão; Item avulso',
          Etapa: 'Qualificação',
        },
        { Contato: 'Bruno Dias', Empresa: 'Padaria Pão Quente' },
        { Contato: 'Dora Reis', Empresa: 'Oficina do Zé', Etapa: 'Perdido', 'Motivo da perda': 'Foi para o concorrente.' },
        { Contato: 'Eva Solta', Empresa: 'Empresa Sem Cadastro Ltda', 'Valor estimado (R$)': 'R$ 500,00' },
        { Contato: 'Excluído Edu', Empresa: 'Cliente Só do Excluído' },
        { Contato: 'Convertido Cíntia', Empresa: 'Cliente Só do Convertido' },
      ]),
    ]);
    await commitOk(orgOther, [...CATALOG_TABS(), sheetTab('leads', [{ Contato: 'Intruso Ivo', Empresa: 'Outra Org SA' }])]);
    // B has the catalog the leads point at (vendedor, produtos) and the default etapas the import seeds.
    await commitOk(orgB, CATALOG_TABS());

    const leadOf = async (name: string) =>
      must(
        (
          await admin
            .select()
            .from(salesOpsCrmLeads)
            .where(and(eq(salesOpsCrmLeads.orgId, orgA), eq(salesOpsCrmLeads.contactName, name)))
        )[0],
      );
    const deleted = await appFor(orgA).request(`/leads/${(await leadOf('Excluído Edu')).id}/delete`, { method: 'POST' });
    expect(deleted.status).toBe(204);
    const sale = must(
      (await admin.select().from(salesOpsSales).where(eq(salesOpsSales.orgId, orgA)))[0],
    );
    await admin
      .update(salesOpsCrmLeads)
      .set({ saleId: sale.id })
      .where(and(eq(salesOpsCrmLeads.orgId, orgA), eq(salesOpsCrmLeads.id, (await leadOf('Convertido Cíntia')).id)));

    const fingerprintBefore = JSON.stringify(await liveLeads(orgA));
    const clientsBefore = await clienteNames(orgA);

    // Export from A.
    const exported = await appFor(orgA).request(EXPORT_PATH);
    expect(exported.status).toBe(200);
    const bytes = new Uint8Array(await exported.arrayBuffer());

    // The existing preview of the exported file into B: zero errors.
    const preview = await importInto(orgB, '/import/preview', bytes);
    expect(preview.status).toBe(200);
    const previewBody = (await preview.json()) as { ok: boolean; issues: ImportIssue[] };
    expect(previewBody.issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(previewBody.ok).toBe(true);

    // The existing commit creates B's leads and clientes.
    const commit = await importInto(orgB, '/import/commit', bytes);
    expect(commit.status).toBe(201);

    const inB = await liveLeads(orgB);
    const names = inB.map((l) => l.contato).sort();
    expect(names).toEqual(['Bruno Dias', 'Carlos Lima', 'Dora Reis', 'Eva Solta']);
    expect(names).not.toContain('Excluído Edu');
    expect(names).not.toContain('Convertido Cíntia');
    expect(names).not.toContain('Intruso Ivo');

    const inA = (await liveLeads(orgA)).filter((l) => names.includes(l.contato));
    expect(inB).toEqual(inA);
    expect(must(inB.find((l) => l.contato === 'Carlos Lima'))).toMatchObject({
      empresa: 'Padaria Pão Quente',
      valor: 1200050,
      descricao: 'Quer trocar o caixa.',
      vendedor: 'Ana Souza',
      etapa: 'Qualificação',
      produtos: ['Sistema de gestão', 'Item avulso'],
    });
    expect(must(inB.find((l) => l.contato === 'Dora Reis'))).toMatchObject({
      etapa: 'Perdido',
      motivo: 'Foi para o concorrente.',
    });

    // Only the clientes the exported leads reference travel: the two others stay in A.
    const clientesInB = await clienteNames(orgB);
    expect(clientesInB).toEqual(['Oficina do Zé', 'Padaria Pão Quente']);
    expect(await getAdminDb().select().from(salesOpsClients).where(eq(salesOpsClients.orgId, orgB))).toHaveLength(2);
    const padariaB = must(
      (await admin.select().from(salesOpsClients).where(and(eq(salesOpsClients.orgId, orgB), eq(salesOpsClients.name, 'Padaria Pão Quente'))))[0],
    );
    expect(padariaB).toMatchObject({ contact: 'Marcos Pereira', document: '12.345.678/0001-90' });
    // The lead without a cadastro stays free text.
    expect(must(inB.find((l) => l.contato === 'Eva Solta'))).toMatchObject({ clientName: null, empresa: 'Empresa Sem Cadastro Ltda' });

    // The export wrote nothing in A.
    expect(JSON.stringify(await liveLeads(orgA))).toBe(fingerprintBefore);
    expect(await clienteNames(orgA)).toEqual(clientsBefore);
    const exportAudits = await admin
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.actorOrgId, orgA), eq(auditLog.action, 'import.completed')));
    expect(exportAudits).toHaveLength(1);
  });
});
