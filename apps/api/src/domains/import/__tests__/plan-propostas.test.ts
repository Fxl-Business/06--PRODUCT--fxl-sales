import { describe, expect, it } from 'vitest';
import type { ZodIssue } from 'zod';
import { parseWorkbook } from '../parse.js';
import { buildRefIndex } from '../refs.js';
import { buildProposalProductIndex, mapSaleSchemaIssues, planPropostas, planPropostasWith, type DraftSources } from '../plan/propostas.js';
import type { CellValue, ImportCatalog, ImportIssue, ParsedWorkbook, SaleDraft, SheetKey, SheetPlanResult } from '../types.js';
import { buildXlsx, exampleTabs } from './xlsx-fixture.js';
import { IDS, probe, testCatalog } from './propostas-fixtures.js';
import { productEntry, seededCatalog, workbook } from './plan-fixtures.js';

type Rows = Partial<Record<SheetKey, Array<Record<string, CellValue> & { row?: number }>>>;

const BASE = { ref: 'P1', cliente: 'Padaria Pão Quente', vendedor: 'Ana Souza', dataBase: '2026-01-15' };
const ALL: SheetPlanResult[] = [];

function run(rows: Rows, catalog: ImportCatalog = testCatalog(), issues: ImportIssue[] = []): SheetPlanResult {
  const parsed = workbook(rows, issues);
  const result = planPropostas(parsed, catalog, buildRefIndex(parsed, catalog));
  ALL.push(result);
  return result;
}

function sale(rows: Rows, catalog?: ImportCatalog): SaleDraft {
  const result = run(rows, catalog);
  expect(result.issues.filter((i) => i.severity === 'error')).toEqual([]);
  const op = result.operations[0];
  if (op?.op !== 'createSale') throw new Error('no createSale op');
  return op.input;
}

const one = (extra: Record<string, CellValue>) => ({ propostas: [{ ...BASE, produto: 'Licença', ...extra }] });
const codes = (r: SheetPlanResult) => r.issues.map((i) => i.code);
const amounts = (d: SaleDraft) => d.installments.map((i) => i.amountBrl);
const dates = (d: SaleDraft) => d.installments.map((i) => i.dueDate);
const catalogWith = (patch: Parameters<typeof productEntry>[0]) =>
  testCatalog({ products: [productEntry({ areaId: IDS.area, ...patch })] });

describe('basic depth (AC5)', () => {
  it('creates an Aberta proposta from cliente, vendedor, produto and data base only', () => {
    const result = run({ propostas: [{ ...BASE, produto: 'Licença' }] });
    expect(result.operations).toHaveLength(1);
    const op = result.operations[0];
    expect(op).toMatchObject({ op: 'createSale', planKey: 'propostas:2', wonOn: null });
    expect(op?.op === 'createSale' && op.input).toEqual({
      clientRef: { existingId: IDS.padaria },
      clientName: 'Padaria Pão Quente',
      sellerRef: { existingId: IDS.ana },
      sellerName: 'Ana Souza',
      finderRef: null,
      finderName: null,
      status: 'open',
      baseDate: '2026-01-15',
      notes: null,
      sellerCommissionPct: 10,
      finderCommissionPct: 3,
      taxPct: 6,
      otherCostsBrl: 0,
      items: [{ productRef: { existingId: IDS.licenca }, areaRef: null, productName: 'Licença', quantity: 1, unitBrl: 100000 }],
      professionals: [],
      installments: [{ dueDate: '2026-01-15', amountBrl: 100000, method: 'pix' }],
      recurring: null,
    });
    expect(result.issues).toEqual([]);
    expect(result.counts).toEqual({ propostas: 1 });
  });

  it('splits the produto default parcelas with the remainder on the last row like the wizard', () => {
    const d = sale(
      { propostas: [{ ...BASE, dataBase: '2026-01-31', produto: 'P' }] },
      catalogWith({ id: IDS.licenca, name: 'P', setupBrl: 100000, defaultRemainingInstallments: 3, defaultPaymentMethod: 'card' }),
    );
    expect(amounts(d)).toEqual([33333, 33333, 33334]);
    expect(dates(d)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31']);
    expect(d.installments.every((i) => i.method === 'card')).toBe(true);
  });

  it('honours a produto default entrada percent with the restante one month later', () => {
    const d = sale(
      { propostas: [{ ...BASE, produto: 'P' }] },
      catalogWith({ id: IDS.licenca, name: 'P', setupBrl: 100000, defaultEntradaMode: 'pct', defaultEntradaPct: 30, defaultRemainingInstallments: 2 }),
    );
    expect(amounts(d)).toEqual([30000, 35000, 35000]);
    expect(dates(d)).toEqual(['2026-01-15', '2026-02-15', '2026-03-15']);
  });

  it('clamps a produto fixed entrada larger than the total to one parcela', () => {
    const d = sale(
      { propostas: [{ ...BASE, produto: 'P' }] },
      catalogWith({ id: IDS.licenca, name: 'P', setupBrl: 100000, defaultEntradaMode: 'fix', defaultEntradaBrl: 999999 }),
    );
    expect(d.installments).toEqual([{ dueDate: '2026-01-15', amountBrl: 100000, method: 'pix' }]);
  });

  it('caps the produto restante at 119 when it has an entrada', () => {
    const d = sale(
      { propostas: [{ ...BASE, produto: 'P' }] },
      catalogWith({ id: IDS.licenca, name: 'P', setupBrl: 1000000, defaultEntradaMode: 'pct', defaultEntradaPct: 10, defaultRemainingInstallments: 120 }),
    );
    expect(d.installments).toHaveLength(120);
  });

  it('takes the recorrência from the produto mensalidade and default cycles', () => {
    const d = sale({ propostas: [{ ...BASE, dataBase: '2026-01-31', produto: 'Sistema de gestão' }] });
    expect(d.recurring).toEqual({ monthlyBrl: 30000, startDate: '2026-02-28', cycles: 12, method: 'boleto' });
  });

  it('leaves the recorrência indefinite when the produto has no default cycles', () => {
    const d = sale({ propostas: [{ ...BASE, produto: 'Plano mensal' }] });
    expect(d.recurring?.cycles).toBeNull();
  });

  it('uses the mensalidade as the unit price of a produto without setup value', () => {
    const d = sale({ propostas: [{ ...BASE, produto: 'Plano mensal' }] });
    expect(d.items[0]?.unitBrl).toBe(25000);
    expect(d.recurring?.monthlyBrl).toBe(25000);
  });

  it('takes the seller commission from the produto percent and tax from the settings', () => {
    const catalog = testCatalog({
      settings: { defaultSellerCommissionPct: 9, defaultFinderCommissionPct: 2, defaultTaxPct: 7.5 },
    });
    const d = sale({ propostas: [{ ...BASE, produto: 'Sistema de gestão' }] }, catalog);
    expect([d.sellerCommissionPct, d.finderCommissionPct, d.taxPct]).toEqual([12, 2, 7.5]);
  });

  it('falls back to the settings when the produto commission is a fixed value', () => {
    const d = sale({ propostas: [{ ...BASE, produto: 'Consultoria', valorUnitario: 80000 }] });
    expect([d.sellerCommissionPct, d.finderCommissionPct]).toEqual([10, 3]);
  });

  it('uses the with-finder commissions when a Finder is filled', () => {
    const d = sale({ propostas: [{ ...BASE, produto: 'Sistema de gestão', finder: 'Bruno Lima' }] });
    expect(d).toMatchObject({
      sellerCommissionPct: 8,
      finderCommissionPct: 4,
      finderRef: { existingId: IDS.bruno },
      finderName: 'Bruno Lima',
    });
  });

  it('uses the Quantidade and Valor unitário shortcut columns', () => {
    const d = sale(one({ quantidade: 2, valorUnitario: 45000 }));
    expect(d.items[0]).toMatchObject({ quantity: 2, unitBrl: 45000 });
    expect(amounts(d)).toEqual([90000]);
  });

  it('maps Situação to the createSale status and wonOn', () => {
    const rows = [
      { ...BASE, ref: 'A', produto: 'Licença' },
      { ...BASE, ref: 'B', produto: 'Licença', situacao: 'draft' },
      { ...BASE, ref: 'C', produto: 'Licença', situacao: 'won', dataGanho: '2026-01-20' },
      { ...BASE, ref: 'D', produto: 'Licença', situacao: 'won' },
      { ...BASE, ref: 'E', produto: 'Licença', situacao: 'lost', dataGanho: '2026-01-20' },
      { ...BASE, ref: 'F', produto: 'Licença', situacao: 'cancelled', dataGanho: '2026-01-20' },
    ];
    const result = run({ propostas: rows });
    expect(result.issues).toEqual([]);
    const got = result.operations.map((o) => (o.op === 'createSale' ? [o.input.status, o.wonOn] : null));
    expect(got).toEqual([
      ['open', null],
      ['draft', null],
      ['won', '2026-01-20'],
      ['won', null],
      ['open', null],
      ['open', null],
    ]);
  });

  it('uses the produto default payment method and lets Forma de pagamento override it', () => {
    const a = sale({ propostas: [{ ...BASE, produto: 'Sistema de gestão' }] });
    expect(a.installments.every((i) => i.method === 'boleto')).toBe(true);
    expect(a.recurring?.method).toBe('boleto');
    const b = sale({ propostas: [{ ...BASE, produto: 'Sistema de gestão', formaPagamento: 'card' }] });
    expect(b.installments.every((i) => i.method === 'card')).toBe(true);
    expect(b.recurring?.method).toBe('card');
  });
});

describe('full depth', () => {
  it('builds items from Itens rows in sheet order, produto and free-form', () => {
    const result = run({
      propostas: [BASE],
      itens: [
        { ref: 'P1', produto: 'Licença', quantidade: 1 },
        { ref: 'P1', descricao: 'Treinamento', area: 'Tecnologia', valorUnitario: 20000 },
      ],
    });
    expect(result.issues).toEqual([]);
    const op = result.operations[0];
    expect(op?.op === 'createSale' && op.input.items).toEqual([
      { productRef: { existingId: IDS.licenca }, areaRef: null, productName: 'Licença', quantity: 1, unitBrl: 100000 },
      { productRef: null, areaRef: { existingId: IDS.area }, productName: 'Treinamento', quantity: 1, unitBrl: 20000 },
    ]);
    expect(result.counts).toEqual({ propostas: 1, itens: 2 });
  });

  it('takes the defaults from the first item only', () => {
    const a = sale({ propostas: [BASE], itens: [{ ref: 'P1', produto: 'Licença' }, { ref: 'P1', produto: 'Sistema de gestão' }] });
    expect(a.sellerCommissionPct).toBe(10);
    expect(a.recurring).toBeNull();
    const b = sale({ propostas: [BASE], itens: [{ ref: 'P1', produto: 'Sistema de gestão' }, { ref: 'P1', produto: 'Licença' }] });
    expect(b.sellerCommissionPct).toBe(12);
    expect(b.recurring?.monthlyBrl).toBe(30000);
  });

  it('uses Parcelas rows sorted by vencimento with the method falling back to the proposta then the produto', () => {
    const result = run({
      propostas: [{ ...BASE, produto: 'Licença', formaPagamento: 'boleto' }],
      parcelas: [
        { ref: 'P1', vencimento: '2026-03-01', valor: 40000 },
        { ref: 'P1', vencimento: '2026-02-01', valor: 60000, formaPagamento: 'card' },
      ],
    });
    expect(result.issues).toEqual([]);
    const op = result.operations[0];
    expect(op?.op === 'createSale' && op.input.installments).toEqual([
      { dueDate: '2026-02-01', amountBrl: 60000, method: 'card' },
      { dueDate: '2026-03-01', amountBrl: 40000, method: 'boleto' },
    ]);
    expect(result.counts).toEqual({ propostas: 1, parcelas: 2 });
  });

  it('refuses Parcelas that do not sum to the items total', () => {
    const result = run({
      propostas: [{ ...BASE, produto: 'Licença' }],
      parcelas: [
        { ref: 'P1', vencimento: '2026-02-01', valor: 40000 },
        { ref: 'P1', vencimento: '2026-03-01', valor: 50000 },
      ],
    });
    expect(result.operations).toEqual([]);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({ sheet: 'parcelas', row: 2, column: 'Valor (R$)', code: 'installments_sum_mismatch' });
    expect(result.issues[0]?.message).toContain('R$ 900,00');
    expect(result.issues[0]?.message).toContain('R$ 1.000,00');
  });

  it('refuses Parcelas that sum ABOVE the items total', () => {
    const result = run({
      propostas: [{ ...BASE, produto: 'Licença' }],
      parcelas: [
        { ref: 'P1', vencimento: '2026-02-01', valor: 60000 },
        { ref: 'P1', vencimento: '2026-03-01', valor: 50000 },
      ],
    });
    expect(result.operations).toEqual([]);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({ sheet: 'parcelas', row: 2, column: 'Valor (R$)', code: 'installments_sum_mismatch' });
    expect(result.issues[0]?.message).toContain('R$ 1.100,00');
    expect(result.issues[0]?.message).toContain('R$ 1.000,00');
  });

  it('refuses a zero-value parcela', () => {
    const result = run({
      propostas: [{ ...BASE, produto: 'Licença' }],
      parcelas: [{ ref: 'P1', vencimento: '2026-02-01', valor: 0 }, { ref: 'P1', vencimento: '2026-03-01', valor: 100000 }],
    });
    expect(result.issues.find((i) => i.code === 'zero_installment')).toMatchObject({ sheet: 'parcelas', row: 2 });
    expect(result.operations).toEqual([]);
  });

  it('refuses more than 120 parcelas', () => {
    const parcelas = Array.from({ length: 121 }, (_, i) => ({ ref: 'P1', vencimento: '2026-02-01', valor: 1, row: i + 2 }));
    const result = run({ propostas: [{ ...BASE, produto: 'Licença', valorUnitario: 121 }], parcelas });
    expect(result.issues.find((i) => i.code === 'too_many_installments')).toMatchObject({ sheet: 'parcelas', row: 122 });
    expect(result.operations).toEqual([]);
  });

  it('refuses Parcelas together with Entrada or Número de parcelas', () => {
    const result = run({
      propostas: [{ ...BASE, produto: 'Licença', entradaBrl: 1000 }],
      parcelas: [{ ref: 'P1', vencimento: '2026-02-01', valor: 100000 }],
    });
    expect(result.issues).toEqual([expect.objectContaining({ sheet: 'propostas', row: 2, column: 'Entrada (R$)', code: 'plan_conflict' })]);
  });

  it('generates parcelas from the Entrada and Número de parcelas columns over the produto shape', () => {
    const a = sale({ propostas: [{ ...BASE, produto: 'Sistema de gestão', entradaBrl: 100000, numeroParcelas: 2 }] });
    expect(amounts(a)).toEqual([100000, 200000, 200000]);
    expect(dates(a)).toEqual(['2026-01-15', '2026-02-15', '2026-03-15']);
    const b = sale({ propostas: [{ ...BASE, produto: 'Sistema de gestão', numeroParcelas: 4 }] });
    expect(amounts(b)).toEqual([125000, 125000, 125000, 125000]);
  });

  it('refuses an Entrada larger than the total and 120 parcelas with an entrada', () => {
    const a = run({ propostas: [{ ...BASE, produto: 'Licença', entradaBrl: 200000 }] });
    expect(a.issues).toEqual([expect.objectContaining({ code: 'entrada_exceeds_total', column: 'Entrada (R$)' })]);
    const b = run({ propostas: [{ ...BASE, produto: 'Licença', entradaBrl: 1000, numeroParcelas: 120 }] });
    expect(b.issues).toEqual([expect.objectContaining({ code: 'too_many_installments', column: 'Número de parcelas' })]);
  });

  it('overrides the recorrência with Mensalidade, Início and Ciclos', () => {
    const d = sale({
      propostas: [{ ...BASE, produto: 'Sistema de gestão', mensalidade: 40000, inicioRecorrencia: '2026-03-10', ciclosRecorrencia: 6 }],
    });
    expect(d.recurring).toEqual({ monthlyBrl: 40000, startDate: '2026-03-10', cycles: 6, method: 'boleto' });
  });

  it('turns the recorrência off with Mensalidade zero', () => {
    expect(sale({ propostas: [{ ...BASE, produto: 'Sistema de gestão', mensalidade: 0 }] }).recurring).toBeNull();
  });

  it('refuses Início or Ciclos without any mensalidade', () => {
    const result = run(one({ ciclosRecorrencia: 6 }));
    expect(result.issues).toEqual([expect.objectContaining({ code: 'recurrence_without_monthly', column: 'Ciclos da recorrência' })]);
  });

  it('builds professionals with função, pessoa, explicit cost and divisão in basis points', () => {
    const rows = (divisao: string) => ({
      propostas: [{ ...BASE, produto: 'Sistema de gestão' }],
      profissionais: [{ ref: 'P1', funcao: 'Desenvolvedor', pessoa: 'Carla Dias', custo: 150000, divisaoCusto: divisao }],
    });
    const a = sale(rows('50; 50'));
    expect(a.professionals).toEqual([
      { personRef: { existingId: IDS.carla }, funcaoRef: { existingId: IDS.dev }, personName: 'Carla Dias', costBrl: 150000, costSplitBp: [5000, 5000] },
    ]);
    expect(sale(rows('12,5; 87,5')).professionals[0]?.costSplitBp).toEqual([1250, 8750]);
  });

  it('defaults a blank professional cost to the produto função cost basis', () => {
    const d = sale({
      propostas: [{ ...BASE, produto: 'Sistema de gestão' }],
      profissionais: [
        { ref: 'P1', funcao: 'Desenvolvedor', pessoa: 'Carla Dias' },
        { ref: 'P1', funcao: 'Vendedor', pessoa: 'Ana Souza' },
      ],
    });
    expect(d.professionals.map((p) => p.costBrl)).toEqual([100000, 0]);
  });

  it('refuses a divisão that does not sum to 100, invalid text and more parts than parcelas', () => {
    const pro = (divisaoCusto: string) => ({
      propostas: [{ ...BASE, produto: 'Licença' }],
      profissionais: [{ ref: 'P1', funcao: 'Desenvolvedor', pessoa: 'Carla Dias', divisaoCusto }],
    });
    const sum = run(pro('50; 40'));
    expect(sum.issues).toEqual([expect.objectContaining({ code: 'cost_split_sum_mismatch', column: 'Divisão do custo (%)', sheet: 'profissionais' })]);
    expect(sum.issues[0]?.message).toContain('90%');
    expect(codes(run(pro('abc')))).toEqual(['invalid_pct']);
    expect(codes(run(pro('50; 50')))).toEqual(['cost_split_too_many_parts']);
  });

  it('warns when the pessoa lacks the função in the cadastro', () => {
    const result = run({
      propostas: [{ ...BASE, produto: 'Licença' }],
      profissionais: [{ ref: 'P1', funcao: 'Desenvolvedor', pessoa: 'Bruno Lima' }],
    });
    expect(result.issues).toEqual([expect.objectContaining({ severity: 'warning', code: 'person_lacks_funcao', column: 'Pessoa' })]);
    expect(result.operations).toHaveLength(1);
  });

  it('overrides commissions, tax, outros custos and observações from the columns', () => {
    const d = sale(one({ comissaoVendedorPct: 15, comissaoFinderPct: 5, impostoPct: 8, outrosCustos: 2500, observacoes: 'Nota' }));
    expect(d).toMatchObject({ sellerCommissionPct: 15, finderCommissionPct: 5, taxPct: 8, otherCostsBrl: 2500, notes: 'Nota' });
  });

  it('resolves a produto created in the same workbook through the cadastro planner', () => {
    const catalog = testCatalog();
    const parsed = workbook({
      produtos: [{ nome: 'Produto novo', tipo: 'product', area: 'Tecnologia', valor: 70000, parcelas: 2 }],
      propostas: [{ ...BASE, produto: 'Produto novo' }],
    });
    const result = planPropostas(parsed, catalog, buildRefIndex(parsed, catalog));
    expect(result.issues).toEqual([]);
    const op = result.operations[0];
    const d = op?.op === 'createSale' ? op.input : null;
    expect(d?.items[0]).toMatchObject({ productRef: { planKey: 'produtos:2' }, unitBrl: 70000 });
    expect(d && amounts(d)).toEqual([35000, 35000]);
  });
});

describe('validation', () => {
  it('refuses the Produto shortcut together with Itens rows', () => {
    const result = run({ propostas: [{ ...BASE, produto: 'Licença' }], itens: [{ ref: 'P1', produto: 'Licença' }] });
    expect(result.issues).toEqual([expect.objectContaining({ code: 'items_conflict', column: 'Produto' })]);
    expect(result.operations).toEqual([]);
  });

  it('refuses a proposta without Produto and without Itens', () => {
    expect(codes(run({ propostas: [BASE] }))).toEqual(['no_items']);
  });

  it('refuses Quantidade or Valor unitário without a Produto', () => {
    const result = run({ propostas: [{ ...BASE, quantidade: 2 }] });
    expect(result.issues).toEqual([expect.objectContaining({ code: 'no_items', column: 'Produto' })]);
  });

  it('refuses a duplicated Ref ignoring case and accents and attaches children to the first', () => {
    const result = run({
      propostas: [{ ...BASE, ref: 'Ação', produto: 'Licença' }, { ...BASE, ref: 'acao', produto: 'Licença' }],
      itens: [{ ref: 'AÇÃO', produto: 'Licença', quantidade: 2 }],
    });
    // the shortcut and the Itens row of the first proposta conflict, which proves the child attached to row 2
    expect(result.issues.find((i) => i.code === 'duplicate_ref')).toMatchObject({ sheet: 'propostas', row: 3, column: 'Ref' });
    expect(result.issues.find((i) => i.code === 'duplicate_ref')?.message).toContain('linha 2');
    expect(result.issues.some((i) => i.code === 'items_conflict' && i.row === 2)).toBe(true);
  });

  it('refuses child rows whose Ref is not in Propostas', () => {
    const result = run({
      propostas: [{ ...BASE, produto: 'Licença' }],
      itens: [{ ref: 'P9', produto: 'Licença' }],
      profissionais: [{ ref: 'P9', funcao: 'Desenvolvedor', pessoa: 'Carla Dias' }],
      parcelas: [{ ref: 'P9', vencimento: '2026-02-01', valor: 1 }],
    });
    const unknown = result.issues.filter((i) => i.code === 'unknown_proposta_ref');
    expect(unknown.map((i) => [i.sheet, i.row, i.column])).toEqual([
      ['itens', 2, 'Ref'],
      ['profissionais', 2, 'Ref'],
      ['parcelas', 2, 'Ref'],
    ]);
    expect(result.operations).toHaveLength(1);
  });

  it('refuses a vendedor without the Vendedor função and a finder without the Finder função', () => {
    const a = run({ propostas: [{ ...BASE, vendedor: 'Carla Dias', produto: 'Licença' }] });
    expect(a.issues).toEqual([expect.objectContaining({ code: 'seller_without_funcao', column: 'Vendedor' })]);
    const b = run({ propostas: [{ ...BASE, finder: 'Ana Souza', produto: 'Licença' }] });
    expect(b.issues).toEqual([expect.objectContaining({ code: 'finder_without_funcao', column: 'Finder' })]);
  });

  it('accepts a workbook pessoa whose Funções list includes Vendedor', () => {
    const rows = (funcoes: string[]) => ({
      pessoas: [{ nome: 'Nova Pessoa', funcoes }],
      propostas: [{ ...BASE, vendedor: 'Nova Pessoa', produto: 'Licença' }],
    });
    const ok = run(rows(['Vendedor']));
    expect(ok.issues).toEqual([]);
    const op = ok.operations[0];
    expect(op?.op === 'createSale' && op.input.sellerRef).toEqual({ planKey: 'pessoas:2' });
    expect(codes(run(rows(['Desenvolvedor'])))).toContain('seller_without_funcao');
  });

  it('reports a failed reference lookup with the lookup code and message on the right header', () => {
    const catalog = testCatalog();
    const parsed = workbook({
      propostas: [{ ...BASE, cliente: 'Desconhecido', produto: 'Licença' }, { ...BASE, ref: 'P2' }],
      itens: [{ ref: 'P2', produto: 'Produto antigo' }],
      profissionais: [{ ref: 'P2', funcao: 'Desenvolvedor', pessoa: 'Dupla Pessoa' }],
    });
    const refs = buildRefIndex(parsed, catalog);
    const result = planPropostas(parsed, catalog, refs);
    const find = (code: string) => result.issues.find((i) => i.code === code);
    expect(find('unknown_ref')).toMatchObject({ sheet: 'propostas', row: 2, column: 'Cliente', message: (refs.resolve('client', 'Desconhecido') as { message: string }).message });
    expect(find('archived_ref')).toMatchObject({ sheet: 'itens', column: 'Produto' });
    expect(find('ambiguous_ref')).toMatchObject({ sheet: 'profissionais', column: 'Pessoa' });
  });

  it('refuses a free-form item without Descrição, Área or value', () => {
    const result = run({
      propostas: [BASE],
      itens: [{ ref: 'P1' }, { ref: 'P1', descricao: 'Algo' }],
    });
    expect(result.issues.map((i) => [i.code, i.column, i.row])).toEqual([
      ['free_item_description_required', 'Descrição', 2],
      ['free_item_area_required', 'Área', 2],
      ['free_item_value_required', 'Valor unitário (R$)', 2],
      ['free_item_area_required', 'Área', 3],
      ['free_item_value_required', 'Valor unitário (R$)', 3],
    ]);
  });

  it('refuses a serviço with no value', () => {
    const result = run({ propostas: [{ ...BASE, produto: 'Consultoria' }] });
    expect(codes(result)).toEqual(['negotiated_value_required']);
  });

  it('uses Descrição as the item name only for a serviço and warns otherwise', () => {
    const svc = run({ propostas: [BASE], itens: [{ ref: 'P1', produto: 'Consultoria', descricao: 'Diagnóstico inicial', valorUnitario: 80000 }] });
    const op = svc.operations[0];
    expect(op?.op === 'createSale' && op.input.items[0]?.productName).toBe('Diagnóstico inicial');
    const lic = run({ propostas: [BASE], itens: [{ ref: 'P1', produto: 'Licença', descricao: 'Texto', area: 'Tecnologia' }] });
    expect(lic.issues.map((i) => [i.severity, i.code])).toEqual([['warning', 'description_ignored'], ['warning', 'area_ignored']]);
    const op2 = lic.operations[0];
    expect(op2?.op === 'createSale' && op2.input.items[0]?.productName).toBe('Licença');
  });

  it('refuses a proposta whose total is zero', () => {
    const result = run(one({ valorUnitario: 0 }));
    expect(result.issues).toEqual([expect.objectContaining({ code: 'zero_total', column: null })]);
  });

  it('emits no operation and no extra issue for a proposta with a parser error on its own row or a child row', () => {
    const parserIssue = (sheet: SheetKey, row: number): ImportIssue => ({ severity: 'error', sheet, row, column: 'Valor (R$)', code: 'invalid_money', message: 'x' });
    const child = run(
      { propostas: [{ ...BASE, produto: 'Licença' }], parcelas: [{ ref: 'P1', vencimento: '2026-02-01', valor: null }] },
      testCatalog(),
      [parserIssue('parcelas', 2)],
    );
    expect(child.operations).toEqual([]);
    expect(child.issues).toEqual([]);
    const own = run({ propostas: [{ ...BASE, produto: 'Licença' }] }, testCatalog(), [parserIssue('propostas', 2)]);
    expect(own.operations).toEqual([]);
    expect(own.issues).toEqual([]);
  });

  it('skips null required cells silently', () => {
    const result = run({ propostas: [{ ...BASE, cliente: null, produto: 'Licença' }] }, testCatalog(), [
      { severity: 'error', sheet: 'propostas', row: 2, column: 'Cliente', code: 'required', message: 'x' },
    ]);
    expect(result.operations).toEqual([]);
    expect(result.issues).toEqual([]);
  });

  it('never puts a raw uuid in a message', () => {
    const results = [
      run({ propostas: [BASE] }),
      run({ propostas: [{ ...BASE, produto: 'Licença' }], itens: [{ ref: 'P1', produto: 'Licença' }] }),
      run({ propostas: [{ ...BASE, vendedor: 'Carla Dias', produto: 'Licença' }, { ...BASE, produto: 'Licença' }] }),
      run({ propostas: [{ ...BASE, cliente: 'Zé', produto: 'Produto antigo' }] }),
      run(one({ valorUnitario: 0 })),
    ];
    for (const r of results) for (const i of r.issues) expect(i.message).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/i);
  });

  it('every emitted draft passes CreateSaleSchema once refs become ids', () => {
    const ops = ALL.flatMap((r) => r.operations);
    expect(ops.length).toBeGreaterThan(20);
    for (const op of ops) {
      if (op.op !== 'createSale') continue;
      const res = probe(op.input);
      expect(res.success, JSON.stringify(res.success ? null : res.error.issues)).toBe(true);
    }
  });

  it('maps CreateSaleSchema issues to sheet, row and header', () => {
    const sources: DraftSources = {
      propostaRow: 2,
      ref: 'P1',
      items: [{ sheet: 'propostas', row: 2 }, { sheet: 'itens', row: 5 }],
      professionals: [{ row: 7 }],
      installments: { kind: 'parcelas', rows: [9, 10] },
    };
    const z = (path: Array<string | number>): ZodIssue => ({ code: 'custom', path, message: 'english zod text' });
    const where = (path: Array<string | number>, s: DraftSources = sources) => {
      const [i] = mapSaleSchemaIssues([z(path)], s);
      return [i?.sheet, i?.row, i?.column];
    };
    expect(where(['items', 1, 'unitBrl'])).toEqual(['itens', 5, 'Valor unitário (R$)']);
    expect(where(['items', 0, 'productName'])).toEqual(['propostas', 2, 'Produto']);
    expect(where(['professionals', 0, 'costSplitBp'])).toEqual(['profissionais', 7, 'Divisão do custo (%)']);
    expect(where(['installments'])).toEqual(['parcelas', 9, 'Valor (R$)']);
    expect(where(['installments', 1, 'dueDate'])).toEqual(['parcelas', 10, 'Vencimento']);
    expect(where(['installments'], { ...sources, installments: { kind: 'generated' } })).toEqual(['propostas', 2, 'Número de parcelas']);
    expect(where(['recurring', 'cycles'])).toEqual(['propostas', 2, 'Ciclos da recorrência']);
    expect(where(['taxPct'])).toEqual(['propostas', 2, 'Imposto (%)']);
    expect(where(['unknown'])).toEqual(['propostas', 2, null]);
    const dup = mapSaleSchemaIssues([z(['taxPct']), z(['taxPct'])], sources);
    expect(dup).toHaveLength(1);
    expect(dup[0]).toMatchObject({ severity: 'error', code: 'invalid_proposta' });
    expect(dup[0]?.message).not.toContain('english');
  });

  it('counts created propostas and the child rows they consume', () => {
    const result = run({
      propostas: [{ ...BASE, produto: 'Licença' }, { ...BASE, ref: 'P2', produto: 'Inexistente' }],
      itens: [{ ref: 'P2', descricao: 'x' }],
    });
    expect(result.counts).toEqual({ propostas: 1 });
  });

  it('is pure and deterministic', () => {
    const catalog = testCatalog();
    const parsed = workbook({ propostas: [{ ...BASE, produto: 'Sistema de gestão' }], profissionais: [{ ref: 'P1', funcao: 'Desenvolvedor', pessoa: 'Carla Dias' }] });
    const refs = buildRefIndex(parsed, catalog);
    const freeze = (v: unknown): void => {
      if (v && typeof v === 'object' && !Object.isFrozen(v)) {
        Object.freeze(v);
        Object.values(v).forEach(freeze);
      }
    };
    freeze(parsed);
    freeze(catalog);
    expect(planPropostas(parsed, catalog, refs)).toEqual(planPropostas(parsed, catalog, refs));
  });

  it('round-trips the example workbook with zero errors', async () => {
    const parsed: ParsedWorkbook = await parseWorkbook(await buildXlsx(exampleTabs()));
    const catalog = seededCatalog();
    const result = planPropostas(parsed, catalog, buildRefIndex(parsed, catalog));
    expect(result.issues.filter((i) => i.severity === 'error')).toEqual([]);
    expect(result.operations).toHaveLength(1);
    const op = result.operations[0];
    expect(op).toMatchObject({ op: 'createSale', planKey: 'propostas:2', wonOn: '2026-01-20' });
    const d = op?.op === 'createSale' ? op.input : null;
    expect(d).toMatchObject({
      status: 'won',
      clientRef: { planKey: 'clientes:2' },
      sellerRef: { planKey: 'pessoas:2' },
      baseDate: '2026-01-15',
      sellerCommissionPct: 10,
      finderCommissionPct: 3,
      taxPct: 6,
      notes: 'Migrada da planilha antiga.',
      items: [{ productRef: { planKey: 'produtos:2' }, areaRef: null, productName: 'Sistema de gestão', quantity: 1, unitBrl: 500000 }],
      installments: [{ dueDate: '2026-01-20', amountBrl: 500000, method: 'pix' }],
      recurring: { monthlyBrl: 30000, startDate: '2026-02-20', cycles: 12, method: 'pix' },
      professionals: [
        { personRef: { planKey: 'pessoas:2' }, funcaoRef: { planKey: 'funcoes:2' }, personName: 'Ana Souza', costBrl: 100000, costSplitBp: null },
      ],
    });
    expect(result.counts).toEqual({ propostas: 1, itens: 1, profissionais: 1, parcelas: 1 });
    ALL.push(result);
  });
});

describe('buildProposalProductIndex', () => {
  it('projects catalog produtos and createProduct ops with the createProduct with-finder fallback', () => {
    const catalog = testCatalog();
    const parsed = workbook({ produtos: [{ nome: 'Novo', tipo: 'product', area: 'Tecnologia', valor: 1000, comissaoVendedorPct: 7 }] });
    const refs = buildRefIndex(parsed, catalog);
    void refs;
    const index = buildProposalProductIndex(catalog, [
      {
        op: 'createProduct',
        planKey: 'produtos:2',
        input: {
          name: 'Novo', kind: 'product', setupBrl: 1000, hasMonthly: false, monthlyBrl: 0,
          sellerCommissionType: 'pct', sellerCommissionValue: 7, finderCommissionType: 'pct', finderCommissionValue: 3,
          defaultPaymentMethod: 'pix', defaultEntradaMode: 'none', defaultRemainingInstallments: 1,
        } as never,
        areaRef: { existingId: IDS.area },
        funcaoCosts: [{ funcaoRef: { planKey: 'funcoes:2' }, cost: { mode: 'fix', valueBrl: 5000 } as never }],
      },
    ]);
    const created = index.get('plan:produtos:2');
    expect(created).toMatchObject({ sellerWithFinderCommissionType: 'pct', sellerWithFinderCommissionValue: 7, defaultRecurringCycles: null });
    expect(created?.funcaoCosts).toEqual([{ funcaoKey: 'plan:funcoes:2', mode: 'fix', valueBrl: 5000 }]);
    expect(index.get(`id:${IDS.sistema}`)?.funcaoCosts).toEqual([{ funcaoKey: `id:${IDS.dev}`, mode: 'pct', valuePct: 20 }]);
    // planPropostasWith accepts an injected index
    const p2 = workbook({ propostas: [{ ...BASE, produto: 'Licença' }] });
    expect(planPropostasWith(p2, catalog, buildRefIndex(p2, catalog), index).operations).toHaveLength(1);
  });
});
