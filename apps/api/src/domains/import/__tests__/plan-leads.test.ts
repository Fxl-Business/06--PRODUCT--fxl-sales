import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CreateLeadSchema } from '../../sales-ops/leads/lead-schemas.js';
import { planLeads } from '../plan/leads.js';
import { buildRefIndex } from '../refs.js';
import type { CellValue, ImportCatalog, ImportIssue, ImportOperation, SheetKey } from '../types.js';
import { IDS, productEntry, richCatalog, seededCatalog, workbook } from './plan-fixtures.js';

type Row = Record<string, CellValue> & { row?: number };
type Rows = Partial<Record<SheetKey, Row[]>>;

function plan(sheets: Rows, catalog: ImportCatalog = richCatalog(), parserIssues: ImportIssue[] = []) {
  const parsed = workbook(sheets, parserIssues);
  return planLeads(parsed, catalog, buildRefIndex(parsed, catalog));
}
let counter = 0;
const lead = (cells: Row): Row => ({
  contato: `Contato ${(counter += 1)}`,
  empresa: 'Empresa Nova',
  valorEstimado: null,
  descricao: null,
  vendedor: null,
  produtos: null,
  etapa: null,
  motivoPerda: null,
  ...cells,
});
const codes = (r: { issues: ImportIssue[] }) => r.issues.map((i) => i.code);
function leadOp(ops: ImportOperation[], index = 0) {
  const op = ops[index];
  if (op?.op !== 'createLead') throw new Error('no lead op');
  return op;
}

describe('planLeads', () => {
  it('returns nothing for an empty Leads sheet', () => {
    expect(plan({})).toEqual({ operations: [], issues: [], counts: {} });
  });

  it('plans a minimal lead with free-text empresa and default stage', () => {
    const r = plan({ leads: [lead({ contato: 'Carlos Lima' })] });
    expect(r.issues).toEqual([]);
    expect(r.counts).toEqual({ leads: 1 });
    expect(leadOp(r.operations)).toEqual({
      op: 'createLead',
      planKey: 'leads:2',
      input: { contactName: 'Carlos Lima', clientName: 'Empresa Nova', estimatedValueBrl: 0, description: null },
      clientRef: null,
      sellerRef: null,
      products: [],
      stageRef: null,
      lostReason: null,
    });
  });

  it('keeps the money in cents and the description', () => {
    const r = plan({ leads: [lead({ valorEstimado: 1200000, descricao: 'Quer trocar o caixa.' })] });
    expect(leadOp(r.operations).input).toMatchObject({ estimatedValueBrl: 1200000, description: 'Quer trocar o caixa.' });
  });

  it('links an existing or workbook cliente by ref and keeps clientName', () => {
    const r = plan({
      clientes: [{ nome: 'Mercado Novo' }],
      leads: [lead({ empresa: 'Padaria Pão Quente' }), lead({ empresa: 'Mercado Novo' })],
    });
    expect(r.issues).toEqual([]);
    expect(leadOp(r.operations, 0).clientRef).toEqual({ existingId: IDS.clientPadaria });
    expect(leadOp(r.operations, 0).input.clientName).toBe('Padaria Pão Quente');
    expect(leadOp(r.operations, 1).clientRef).toEqual({ planKey: 'clientes:2' });
    expect(leadOp(r.operations, 1).input.clientName).toBe('Mercado Novo');
  });

  it('warns and keeps free text when the empresa is ambiguous', () => {
    const catalog = richCatalog();
    catalog.clients.push({ id: 'dup', name: 'Padaria Pão Quente', document: null });
    const r = plan({ leads: [lead({ empresa: 'Padaria Pão Quente' })] }, catalog);
    expect(codes(r)).toEqual(['ambiguous_client']);
    expect(r.issues[0]).toMatchObject({ severity: 'warning', sheet: 'leads', row: 2, column: 'Empresa' });
    expect(leadOp(r.operations).clientRef).toBeNull();
  });

  it('links a lead to a recognized cliente with no ambiguous_client on a re-import', () => {
    const r = plan({
      clientes: [{ nome: 'Padaria Pão Quente', documento: '12.345.678/0001-90' }],
      leads: [lead({ empresa: 'Padaria Pão Quente' })],
    });
    expect(r.issues).toEqual([]);
    expect(leadOp(r.operations).clientRef).toEqual({ existingId: IDS.clientPadaria });
  });

  it('links a lead naming a recognized row spelled differently from the cadastro', () => {
    const r = plan({
      clientes: [{ nome: 'Padaria PQ', documento: '12345678000190' }],
      leads: [lead({ empresa: 'padaria pq' })],
    });
    expect(r.issues).toEqual([]);
    expect(leadOp(r.operations).clientRef).toEqual({ existingId: IDS.clientPadaria });
    // The sheet text stays the input; createLead snapshots the stored name from clientId.
    expect(leadOp(r.operations).input.clientName).toBe('padaria pq');
  });

  it('accepts an existing vendedor and a workbook pessoa carrying Vendedor (real RefIndex)', () => {
    const r = plan({
      pessoas: [{ nome: 'Duda Nova', funcoes: ['Vendedor', 'Desenvolvedor'] }],
      leads: [lead({ vendedor: 'Ana Souza' }), lead({ vendedor: 'Duda Nova' })],
    });
    expect(r.issues).toEqual([]);
    expect(leadOp(r.operations, 0).sellerRef).toEqual({ existingId: IDS.personAna });
    expect(leadOp(r.operations, 1).sellerRef).toEqual({ planKey: 'pessoas:2' });
  });

  it('refuses a pessoa without the Vendedor função', () => {
    const catalog = richCatalog();
    catalog.people.push({
      id: 'bia',
      displayName: 'Bia Dev',
      contactEmail: null,
      status: 'active',
      funcaoSlugs: ['desenvolvedor'],
      funcaoIds: [IDS.funcaoDev],
    });
    const r = plan(
      {
        pessoas: [{ nome: 'Caio Novo', funcoes: ['Desenvolvedor'] }],
        leads: [lead({ vendedor: 'Bia Dev' }), lead({ vendedor: 'Caio Novo' })],
      },
      catalog,
    );
    expect(codes(r)).toEqual(['seller_not_a_vendedor', 'seller_not_a_vendedor']);
    expect(r.issues[0]).toMatchObject({ severity: 'error', column: 'Vendedor', row: 2 });
    expect(r.issues[0]?.message).toContain('"Bia Dev"');
    expect(r.operations).toEqual([]);
  });

  it('refuses an inactive vendedor with the index message', () => {
    const r = plan({ leads: [lead({ vendedor: 'Beto Inativo' })] });
    expect(codes(r)).toEqual(['archived_ref']);
    expect(r.issues[0]?.message).toContain('Beto Inativo');
    expect(r.operations).toEqual([]);
  });

  it('passes RefIndex failures through with their own code and message', () => {
    const catalog = richCatalog();
    catalog.products.push(productEntry({ id: 'p-dup', name: 'Sistema legado', codeSuffix: '8' }));
    const r = plan(
      { leads: [lead({ vendedor: 'Ninguém', etapa: 'Etapa antiga', produtos: ['Sistema legado'] })] },
      catalog,
    );
    expect(r.issues.map((i) => [i.code, i.column])).toEqual([
      ['unknown_ref', 'Vendedor'],
      ['ambiguous_ref', 'Produtos'],
      ['archived_ref', 'Etapa'],
    ]);
    expect(r.issues[0]?.message).toBe('Não encontramos a pessoa "Ninguém" no cadastro nem na aba Pessoas.');
    expect(r.operations).toEqual([]);
  });

  it('resolves produtos to refs or free names and dedupes the same produto', () => {
    const r = plan({
      leads: [lead({ produtos: ['Sistema legado', '#3', 'Consultoria avulsa'] })],
    });
    expect(codes(r)).toEqual(['duplicate_product']);
    expect(r.issues[0]?.severity).toBe('warning');
    expect(leadOp(r.operations).products).toEqual([
      { productRef: { existingId: IDS.productSistema }, name: 'Sistema legado' },
      { productRef: null, name: 'Consultoria avulsa' },
    ]);
  });

  it('refuses an unknown produto code and a free name over 140 characters', () => {
    const r = plan({ leads: [lead({ produtos: ['#99'] }), lead({ produtos: ['x'.repeat(141)] })] });
    expect(r.issues.map((i) => [i.code, i.row, i.column])).toEqual([
      ['unknown_ref', 2, 'Produtos'],
      ['too_long', 3, 'Produtos'],
    ]);
    expect(r.issues[1]?.message).toContain('141');
    expect(r.operations).toEqual([]);
  });

  it('refuses an archived produto', () => {
    const r = plan({ leads: [lead({ produtos: ['Produto antigo'] })] });
    expect(codes(r)).toEqual(['archived_ref']);
    expect(r.operations).toEqual([]);
  });

  it('refuses the conversion etapa (D7)', () => {
    const r = plan({ leads: [lead({ etapa: 'Proposta' })] });
    expect(codes(r)).toEqual(['conversion_stage']);
    expect(r.issues[0]).toMatchObject({ severity: 'error', column: 'Etapa', row: 2 });
    expect(r.issues[0]?.message).toContain('"Proposta"');
    expect(r.operations).toEqual([]);
  });

  it('requires Motivo da perda for the lost etapa (D7)', () => {
    const missing = plan({ leads: [lead({ etapa: 'Perdido' })] });
    expect(codes(missing)).toEqual(['lost_reason_required']);
    expect(missing.issues[0]).toMatchObject({ column: 'Motivo da perda', severity: 'error' });
    expect(missing.operations).toEqual([]);
    const ok = plan({ leads: [lead({ etapa: 'Perdido', motivoPerda: 'Sem orçamento' })] });
    expect(ok.issues).toEqual([]);
    expect(leadOp(ok.operations)).toMatchObject({
      stageRef: { existingId: IDS.stagePerdido },
      lostReason: 'Sem orçamento',
    });
  });

  it('ignores Motivo da perda outside the lost etapa with a warning', () => {
    const r = plan({
      leads: [lead({ etapa: 'Em negociação', motivoPerda: 'x' }), lead({ contato: 'Outro', motivoPerda: 'y' })],
    });
    expect(codes(r)).toEqual(['lost_reason_ignored', 'lost_reason_ignored']);
    expect(r.issues.every((i) => i.severity === 'warning' && i.column === 'Motivo da perda')).toBe(true);
    expect(leadOp(r.operations, 0)).toMatchObject({ stageRef: { existingId: IDS.stageNegociacao }, lostReason: null });
    expect(leadOp(r.operations, 1)).toMatchObject({ stageRef: null, lostReason: null });
  });

  it('does not double-report Motivo da perda on a broken etapa', () => {
    const r = plan({ leads: [lead({ etapa: 'Inexistente', motivoPerda: 'x' })] });
    expect(codes(r)).toEqual(['unknown_ref']);
  });

  it('targets a workbook etapa by planKey', () => {
    const r = plan({ etapas: [{ nome: 'Diagnóstico' }], leads: [lead({ etapa: 'Diagnóstico' })] });
    expect(r.issues).toEqual([]);
    expect(leadOp(r.operations).stageRef).toEqual({ planKey: 'etapas:2' });
  });

  it('reports no_open_stage once when neither the org nor the workbook has an active normal etapa', () => {
    const catalog = seededCatalog({
      stages: seededCatalog().stages.filter((s) => s.kind !== 'normal'),
    });
    const r = plan({ leads: [lead({}), lead({ contato: 'Outro' })] }, catalog);
    expect(r.issues.filter((i) => i.code === 'no_open_stage')).toHaveLength(1);
    expect(r.issues.find((i) => i.code === 'no_open_stage')).toMatchObject({ severity: 'error', row: null, column: null, sheet: 'leads' });
    const withEtapa = plan({ etapas: [{ nome: 'Diagnóstico' }], leads: [lead({})] }, catalog);
    expect(codes(withEtapa)).not.toContain('no_open_stage');
  });

  it('warns possible_duplicate for a repeated contato and empresa inside the workbook', () => {
    const r = plan({
      leads: [
        lead({ contato: 'Carlos Lima', empresa: 'Padaria Pão Quente' }),
        lead({ contato: 'Outra' }),
        lead({ contato: 'x2' }),
        lead({ contato: 'carlos  lima', empresa: 'PADARIA PAO QUENTE', row: 5 }),
      ],
    });
    const dup = r.issues.filter((i) => i.code === 'possible_duplicate');
    expect(dup).toHaveLength(1);
    expect(dup[0]).toMatchObject({ severity: 'warning', row: 5, column: 'Contato' });
    expect(dup[0]?.message).toContain('linha 2');
    expect(r.operations).toHaveLength(4);
  });

  it('skips a row with a null required cell without reporting it again', () => {
    const r = plan({ leads: [lead({ contato: null })] });
    expect(r).toEqual({ operations: [], issues: [], counts: {} });
  });

  it('emits no operation for a row the parser flagged and omits counts when none remain', () => {
    const parserIssue: ImportIssue = {
      severity: 'error',
      sheet: 'leads',
      row: 3,
      column: 'Valor estimado (R$)',
      code: 'invalid_money',
      message: 'x',
    };
    const r = plan({ leads: [lead({}), lead({})] }, richCatalog(), [parserIssue]);
    expect(r.operations.map((o) => (o.op === 'createLead' ? o.planKey : ''))).toEqual(['leads:2']);
    expect(r.counts).toEqual({ leads: 1 });
    const none = plan({ leads: [lead({})] }, richCatalog(), [{ ...parserIssue, row: 2 }]);
    expect(none.operations).toEqual([]);
    expect(none.counts).toEqual({});
  });

  it('every emitted input passes CreateLeadSchema once refs are replaced by uuids', () => {
    const r = plan({
      pessoas: [{ nome: 'Duda Nova', funcoes: ['Vendedor'] }],
      clientes: [{ nome: 'Mercado Novo' }],
      leads: [
        lead({ empresa: 'Padaria Pão Quente', vendedor: 'Ana Souza', produtos: ['Sistema legado', 'Avulso'], valorEstimado: 5000 }),
        lead({ empresa: 'Mercado Novo', vendedor: 'Duda Nova', descricao: 'ok' }),
        lead({ etapa: 'Perdido', motivoPerda: 'Sem orçamento' }),
      ],
    });
    expect(r.issues).toEqual([]);
    expect(r.operations).toHaveLength(3);
    const uuid = '11111111-1111-4111-8111-111111111111';
    for (const op of r.operations) {
      const o = leadOp([op]);
      expect(() =>
        CreateLeadSchema.parse({
          ...o.input,
          clientId: o.clientRef ? uuid : null,
          sellerPersonId: o.sellerRef ? uuid : null,
          products: o.products.map((p) => (p.productRef ? { productId: uuid } : { productName: p.name })),
        }),
      ).not.toThrow();
    }
  });

  it('never puts an id, planKey or column key in a message', () => {
    const catalog = richCatalog();
    catalog.people.push({ id: 'P-BIA', displayName: 'Bia', contactEmail: null, status: 'active', funcaoSlugs: [], funcaoIds: [] });
    const r = plan(
      {
        pessoas: [{ nome: 'Caio Novo', funcoes: ['Desenvolvedor'] }],
        leads: [
          lead({ vendedor: 'Bia' }),
          lead({ vendedor: 'Caio Novo' }),
          lead({ vendedor: 'Beto Inativo', etapa: 'Proposta' }),
          lead({ etapa: 'Perdido' }),
          lead({ etapa: 'Em negociação', motivoPerda: 'z', produtos: ['#99', 'Sistema legado', '#3'] }),
          lead({ contato: 'Carlos Lima' }),
        ],
      },
      catalog,
    );
    expect(r.issues.length).toBeGreaterThan(5);
    for (const i of r.issues) {
      expect(i.message).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/i);
      expect(i.message).not.toMatch(/\b(pessoas|clientes|etapas|produtos|leads):\d+/);
      expect(i.message).not.toMatch(/P-BIA|contactName|sellerPersonId|valorEstimado|motivoPerda/);
    }
  });

  it('runs the CreateLeadSchema backstop and maps to headers', () => {
    const r = plan({ leads: [lead({ descricao: 'd'.repeat(4001) })] });
    expect(r.issues.map((i) => [i.code, i.column])).toEqual([['invalid_value', 'Descrição']]);
    expect(r.operations).toEqual([]);
  });

  it('is pure', () => {
    const src = readFileSync(new URL('../plan/leads.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/new Date/);
    expect(src).not.toMatch(/process\.env/);
    expect(src).not.toMatch(/^import (?!type\b)[^;]*from '\.\.\/refs\.js'/m);
    expect(src).not.toMatch(/sales-ops\/service\.js/);
    expect(src).not.toMatch(/lead-service\.js/);
    expect(src).not.toMatch(/db\//);
    expect(src).not.toMatch(/LEAD_PLACEHOLDER_ID/);
    expect(src).not.toContain(String.fromCharCode(0x2014));
  });
});
