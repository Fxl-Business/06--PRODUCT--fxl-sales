import { describe, expect, it } from 'vitest';
import { parseWorkbook } from '../parse.js';
import { planCadastros } from '../plan/cadastros.js';
import { buildRefIndex } from '../refs.js';
import type { CellValue, ImportCatalog, ImportIssue, ImportOperation, SheetKey } from '../types.js';
import { WORKBOOK_SHEETS } from '../workbook-schema.js';
import { IDS, richCatalog, seededCatalog, workbook } from './plan-fixtures.js';
import { buildXlsx, exampleTabs } from './xlsx-fixture.js';

type Rows = Partial<Record<SheetKey, Array<Record<string, CellValue> & { row?: number }>>>;

function plan(sheets: Rows, catalog: ImportCatalog = seededCatalog(), parserIssues: ImportIssue[] = []) {
  const parsed = workbook(sheets, parserIssues);
  return planCadastros(parsed, catalog, buildRefIndex(parsed, catalog));
}
const errors = (r: { issues: ImportIssue[] }) => r.issues.filter((i) => i.severity === 'error');
const codes = (r: { issues: ImportIssue[] }) => r.issues.map((i) => i.code);
function productOp(r: { operations: ImportOperation[] }) {
  const op = r.operations.find((o) => o.op === 'createProduct');
  if (op?.op !== 'createProduct') throw new Error('no product op');
  return op;
}

describe('planCadastros', () => {
  it("plans the example workbook's cadastro sheets with zero errors", async () => {
    const parsed = await parseWorkbook(await buildXlsx(exampleTabs()));
    expect(parsed.issues.filter((i) => i.severity === 'error')).toEqual([]);
    const catalog = seededCatalog();
    const result = planCadastros(parsed, catalog, buildRefIndex(parsed, catalog));
    expect(errors(result)).toEqual([]);
    expect(result.counts).toEqual({ areas: 1, funcoes: 1, produtos: 1, custosProduto: 1, pessoas: 1, clientes: 1, etapas: 1 });
    expect(result.operations.map((o) => o.op)).toEqual(['createArea', 'createFuncao', 'createProduct', 'createPerson', 'createClient', 'createLeadStage']);
    const product = productOp(result);
    expect(product.input).toMatchObject({ codeSuffix: '0', setupBrl: 500000, sellerCommissionType: 'pct', sellerCommissionValue: 10 });
    expect(product.areaRef).toEqual({ planKey: 'areas:2' });
    expect(product.funcaoCosts).toEqual([{ funcaoRef: { planKey: 'funcoes:2' }, cost: { mode: 'pct', valuePct: 20 } }]);
    const person = result.operations.find((o) => o.op === 'createPerson');
    expect(person?.op === 'createPerson' ? person.funcaoRefs : null).toEqual([{ existingId: IDS.funcaoVendedor }, { planKey: 'funcoes:2' }]);
  });

  describe('áreas', () => {
    it('refuses an área that already exists active (D5)', () => {
      const r = plan({ areas: [{ nome: ' tecnologia' }] }, richCatalog());
      expect(codes(r)).toEqual(['duplicate_existing']);
      expect(r.operations).toEqual([]);
      expect(r.counts).toEqual({});
      expect(r.issues[0]).toMatchObject({ sheet: 'areas', row: 2, column: 'Nome' });
    });
    it('refuses an área that exists archived', () => {
      expect(codes(plan({ areas: [{ nome: 'Área antiga' }] }, richCatalog()))).toEqual(['duplicate_archived']);
    });
    it('refuses a repeated área in the sheet', () => {
      const r = plan({ areas: [{ nome: 'Vendas' }, { nome: 'VENDAS' }] });
      expect(codes(r)).toEqual(['duplicate_in_sheet']);
      expect(r.issues[0]?.message).toContain('linha 2');
      expect(r.counts).toEqual({ areas: 1 });
    });
  });

  describe('funções', () => {
    it('refuses Vendedor and Finder as reserved', () => {
      const r = plan({ funcoes: [{ nome: 'vendedor' }, { nome: ' FINDER ' }] });
      expect(codes(r)).toEqual(['reserved_funcao', 'reserved_funcao']);
    });
    it('refuses a name without letters or digits', () => {
      expect(codes(plan({ funcoes: [{ nome: '!!!' }] }))).toEqual(['invalid_funcao_name']);
    });
    it('refuses a slug clash with an existing função', () => {
      const catalog = richCatalog();
      catalog.funcoes.push({ id: 'x', name: 'Dev Ops', slug: 'dev-ops', isSystem: false, status: 'active' });
      expect(codes(plan({ funcoes: [{ nome: 'dev-ops' }] }, catalog))).toEqual(['duplicate_slug']);
    });
    it('refuses a slug clash inside the sheet', () => {
      const r = plan({ funcoes: [{ nome: 'Dev Ops' }, { nome: 'dev-ops' }] });
      expect(codes(r)).toEqual(['duplicate_slug']);
      expect(r.issues[0]?.message).toContain('linha 2');
    });
    it('refuses an existing archived função', () => {
      expect(codes(plan({ funcoes: [{ nome: 'Função antiga' }] }, richCatalog()))).toEqual(['duplicate_archived']);
      expect(codes(plan({ funcoes: [{ nome: 'Desenvolvedor' }] }, richCatalog()))).toEqual(['duplicate_existing']);
    });
  });

  describe('produtos', () => {
    const base = { nome: 'Novo', area: 'Tecnologia' };
    const withArea = (row: Record<string, CellValue>, catalog = richCatalog()) => plan({ produtos: [{ ...base, ...row }] }, catalog);

    it('fills defaults like the product dialog', () => {
      const r = plan({ produtos: [base] }, richCatalog());
      expect(errors(r)).toEqual([]);
      expect(productOp(r).input).toMatchObject({
        name: 'Novo', kind: 'product', codeSuffix: '8', setupBrl: 0, hasMonthly: false, monthlyBrl: 0,
        sellerCommissionType: 'pct', sellerCommissionValue: 10, finderCommissionType: 'pct', finderCommissionValue: 3,
        defaultPaymentMethod: 'pix', defaultEntradaMode: 'none', defaultRemainingInstallments: 1,
        defaultRecurringCycles: null, providers: [], modules: [],
      });
      expect(productOp(r).areaRef).toEqual({ existingId: IDS.areaTec });
    });
    it('converts a fixed commission from cents to reais', () => {
      const r = withArea({ comissaoVendedorBrl: 15050 });
      expect(productOp(r).input).toMatchObject({ sellerCommissionType: 'fix', sellerCommissionValue: 150.5 });
    });
    it('refuses pct and R$ in the same pair', () => {
      const pairs: Array<[string, string, string]> = [
        ['comissaoVendedorPct', 'comissaoVendedorBrl', 'Comissão do vendedor (R$)'],
        ['comissaoVendedorComFinderPct', 'comissaoVendedorComFinderBrl', 'Comissão do vendedor com finder (R$)'],
        ['comissaoFinderPct', 'comissaoFinderBrl', 'Comissão do finder (R$)'],
        ['entradaPct', 'entradaBrl', 'Entrada padrão (R$)'],
      ];
      for (const [pct, brl, column] of pairs) {
        const r = withArea({ [pct]: 10, [brl]: 1000 });
        expect(r.issues).toHaveLength(1);
        expect(r.issues[0]).toMatchObject({ code: 'both_pct_and_brl', column });
        expect(r.operations).toEqual([]);
      }
    });
    it('infers Tem mensalidade from a filled Mensalidade', () => {
      expect(productOp(withArea({ mensalidade: 30000 })).input).toMatchObject({ hasMonthly: true, monthlyBrl: 30000 });
    });
    it('refuses Mensalidade with Tem mensalidade Não', () => {
      const r = withArea({ temMensalidade: false, mensalidade: 100 });
      expect(r.issues[0]).toMatchObject({ code: 'conflicting_values', column: 'Mensalidade (R$)' });
    });
    it('caps default installments at 119 with an entrada', () => {
      expect(codes(withArea({ entradaPct: 10, parcelas: 120 }))).toEqual(['too_many_installments']);
      expect(errors(withArea({ entradaPct: 10, parcelas: 119 }))).toEqual([]);
      expect(errors(withArea({ parcelas: 120 }))).toEqual([]);
      expect(productOp(withArea({ entradaBrl: 5000 })).input).toMatchObject({ defaultEntradaMode: 'fix', defaultEntradaBrl: 5000, defaultEntradaPct: null });
    });
    it('refuses an existing active product name and warns on an archived same-name product', () => {
      const dup = withArea({ nome: 'sistema LEGADO' });
      expect(codes(dup)).toEqual(['duplicate_existing']);
      const arch = withArea({ nome: 'Produto antigo' });
      expect(arch.issues).toHaveLength(1);
      expect(arch.issues[0]).toMatchObject({ severity: 'warning', code: 'possible_duplicate' });
      expect(arch.operations).toHaveLength(1);
    });
    it('refuses a repeated product in the sheet', () => {
      expect(codes(plan({ produtos: [base, { ...base, nome: 'novo' }] }, richCatalog()))).toEqual(['duplicate_in_sheet']);
    });
    it('refuses a used code including archived', () => {
      const r = withArea({ codigo: 7 });
      expect(r.issues[0]).toMatchObject({ code: 'duplicate_code', column: 'Código' });
      expect(r.issues[0]?.message).toContain('Produto antigo (arquivado)');
    });
    it('resolves the Área column through refs and reports archived_ref', () => {
      const r = withArea({ area: 'Área antiga' });
      expect(r.issues[0]).toMatchObject({ code: 'archived_ref', column: 'Área' });
      expect(withArea({ area: 'Inexistente' }).issues[0]).toMatchObject({ code: 'unknown_ref' });
    });
    it('never emits an operation for a row with a parser error', () => {
      const issue: ImportIssue = { severity: 'error', sheet: 'produtos', row: 2, column: 'Valor (R$)', code: 'invalid_money', message: 'x' };
      const r = plan({ produtos: [base] }, richCatalog(), [issue]);
      expect(r.operations).toEqual([]);
      expect(r.counts).toEqual({});
    });
    it('skips a row with a null required cell without reporting it', () => {
      const r = plan({ produtos: [{ nome: 'X', area: null }] }, richCatalog());
      expect(r.issues).toEqual([]);
      expect(r.operations).toEqual([]);
    });
  });

  describe('custos por produto', () => {
    const catalog = richCatalog();
    const prod = { nome: 'Novo', area: 'Tecnologia' };
    const cost = (row: Record<string, CellValue>) => plan({ produtos: [prod], custosProduto: [{ produto: 'Novo', funcao: 'Desenvolvedor', ...row }] }, catalog);

    it('attaches costs to workbook products in row order', () => {
      const r = plan(
        {
          funcoes: [{ nome: 'Designer' }],
          produtos: [prod],
          custosProduto: [
            { produto: 'Novo', funcao: 'Desenvolvedor', custoPct: 20 },
            { produto: 'Novo', funcao: 'Designer', custoBrl: 5000 },
          ],
        },
        catalog,
      );
      expect(errors(r)).toEqual([]);
      expect(productOp(r).funcaoCosts).toEqual([
        { funcaoRef: { existingId: IDS.funcaoDev }, cost: { mode: 'pct', valuePct: 20 } },
        { funcaoRef: { planKey: 'funcoes:2' }, cost: { mode: 'fix', valueBrl: 5000 } },
      ]);
      expect(r.counts).toEqual({ funcoes: 1, produtos: 1, custosProduto: 2 });
    });
    it('refuses costs for an existing product', () => {
      const r = plan({ custosProduto: [{ produto: 'Sistema legado', funcao: 'Desenvolvedor', custoPct: 5 }] }, catalog);
      expect(codes(r)).toEqual(['existing_product_cost']);
    });
    it('refuses Vendedor and Finder costs', () => {
      expect(codes(cost({ funcao: 'Vendedor', custoPct: 5 }))).toEqual(['system_funcao_cost']);
    });
    it('requires exactly one of Custo (%) and Custo (R$)', () => {
      expect(codes(cost({}))).toEqual(['cost_required']);
      expect(cost({ custoPct: 5, custoBrl: 100 }).issues[0]).toMatchObject({ code: 'both_pct_and_brl', column: 'Custo (R$)' });
    });
    it('refuses the same função twice for one product', () => {
      const r = plan(
        { produtos: [prod], custosProduto: [{ produto: 'Novo', funcao: 'Desenvolvedor', custoPct: 5 }, { produto: 'novo', funcao: 'desenvolvedor', custoPct: 6 }] },
        catalog,
      );
      expect(codes(r)).toEqual(['duplicate_cost']);
      expect(r.issues[0]?.message).toContain('linha 2');
      expect(productOp(r).funcaoCosts).toHaveLength(1);
    });
    it('keeps a fixed cost in cents', () => {
      expect(productOp(cost({ custoBrl: 120000 })).funcaoCosts[0]?.cost).toEqual({ mode: 'fix', valueBrl: 120000 });
    });
    it('rejects a pct above 100 through the schema', () => {
      expect(cost({ custoPct: 120 }).issues[0]).toMatchObject({ code: 'invalid_value', column: 'Custo (%)' });
    });
  });

  describe('pessoas', () => {
    it('resolves Funções to existing and workbook funções', () => {
      const r = plan({ funcoes: [{ nome: 'Designer' }], pessoas: [{ nome: 'Bia', funcoes: ['Vendedor', 'designer', 'VENDEDOR'] }] });
      expect(errors(r)).toEqual([]);
      const op = r.operations.find((o) => o.op === 'createPerson');
      expect(op?.op === 'createPerson' ? op.funcaoRefs : null).toEqual([{ existingId: IDS.funcaoVendedor }, { planKey: 'funcoes:2' }]);
    });
    it('reports each unknown or archived função', () => {
      const r = plan({ pessoas: [{ nome: 'Bia', funcoes: ['Nada', 'Função antiga'] }] }, richCatalog());
      expect(codes(r)).toEqual(['unknown_ref', 'archived_ref']);
      expect(r.issues.every((i) => i.column === 'Funções')).toBe(true);
      expect(r.operations).toEqual([]);
    });
    it('warns on an existing same-name or same-e-mail pessoa without blocking', () => {
      const r = plan({ pessoas: [{ nome: 'ana souza', email: 'ANA@exemplo.com.br', funcoes: ['Vendedor'] }] }, richCatalog());
      expect(r.issues.map((i) => [i.severity, i.code, i.column])).toEqual([
        ['warning', 'possible_duplicate', 'Nome'],
        ['warning', 'possible_duplicate', 'E-mail'],
      ]);
      expect(r.operations).toHaveLength(1);
    });
    it('warns on a repeated name in the sheet', () => {
      const r = plan({ pessoas: [{ nome: 'Bia', funcoes: ['Vendedor'] }, { nome: 'bia', funcoes: ['Vendedor'] }] });
      expect(r.issues.map((i) => i.severity)).toEqual(['warning']);
      expect(r.counts).toEqual({ pessoas: 2 });
    });
    it('refuses an invalid e-mail through PersonSchema', () => {
      const r = plan({ pessoas: [{ nome: 'Bia', email: 'x@', funcoes: ['Vendedor'] }] });
      expect(r.issues[0]).toMatchObject({ code: 'invalid_value', column: 'E-mail' });
      expect(r.operations).toEqual([]);
    });
    it('the person input never carries funcaoIds, hubAccountId or legacy booleans', () => {
      const r = plan({ pessoas: [{ nome: 'Bia', funcoes: ['Vendedor'] }] });
      const op = r.operations[0];
      const input = op?.op === 'createPerson' ? op.input : {};
      for (const k of ['funcaoIds', 'hubAccountId', 'isSeller', 'isFinder', 'isCollaborator']) expect(input).not.toHaveProperty(k);
    });
  });

  describe('clientes', () => {
    it('creates a cliente with blanks as null', () => {
      const r = plan({ clientes: [{ nome: 'Loja' }] });
      expect(r.operations[0]).toMatchObject({ op: 'createClient', input: { name: 'Loja', contact: null, document: null } });
    });
    // Deliberate rewrite (D12): the old first row (same document as the cadastro) is now recognized,
    // so the row here carries another document and stays an unrecognized same-name cliente.
    it('warns on an unrecognized same-name cliente and on a document repeated inside the sheet (digits only)', () => {
      const r = plan({ clientes: [{ nome: 'padaria pão quente', documento: '99.999.999/0001-99' }, { nome: 'Outra', documento: '98.765.432/0001-10' }, { nome: 'Outra 2', documento: '98765432000110' }] }, richCatalog());
      expect(r.issues.map((i) => [i.row, i.column, i.severity, i.code])).toEqual([
        [2, 'Nome', 'warning', 'possible_duplicate'],
        [4, 'CNPJ/CPF', 'warning', 'possible_duplicate'],
      ]);
      expect(r.issues[0]?.message).toBe(
        'Já existe um cliente chamado "padaria pão quente" no cadastro; se for o mesmo, remova esta linha (um nome repetido não pode ser usado nas outras abas).',
      );
      expect(r.counts).toEqual({ clientes: 3 });
      expect(r.recognized).toEqual({});
    });
    it('recognizes an existing cliente by document or name: no operation, no issue, counted apart', () => {
      const catalog = richCatalog();
      catalog.clients.push({ id: IDS.clientPadaria.replace('e1', 'e2'), name: 'Mercado Sol', document: null });
      const r = plan(
        {
          clientes: [
            { nome: 'Padaria PQ', documento: '12.345.678/0001-90' },
            { nome: 'mercado sol', documento: '11.111.111/0001-11' },
            { nome: 'Loja Nova' },
          ],
        },
        catalog,
      );
      expect(r.operations).toHaveLength(1);
      expect(r.operations[0]).toMatchObject({ op: 'createClient', planKey: 'clientes:4', input: { name: 'Loja Nova' } });
      expect(r.issues).toEqual([]);
      expect(r.counts).toEqual({ clientes: 1 });
      expect(r.recognized).toEqual({ clientes: 2 });
    });
    it('two rows recognized as the same cliente raise no in-sheet duplicate warning', () => {
      const r = plan(
        { clientes: [{ nome: 'Padaria Pão Quente' }, { nome: 'padaria pão quente', documento: '12345678000190' }] },
        richCatalog(),
      );
      expect(r.operations).toEqual([]);
      expect(r.issues).toEqual([]);
      expect(r.counts).toEqual({});
      expect(r.recognized).toEqual({ clientes: 2 });
    });
    it('still warns and creates when several clientes carry the row document and none has its name', () => {
      const catalog = richCatalog();
      catalog.clients.push({ id: IDS.clientPadaria.replace('e1', 'e3'), name: 'Padaria Filial', document: '12.345.678/0001-90' });
      const r = plan({ clientes: [{ nome: 'Padaria Centro', documento: '12345678000190' }] }, catalog);
      expect(r.issues).toEqual([
        {
          severity: 'warning',
          sheet: 'clientes',
          row: 2,
          column: 'CNPJ/CPF',
          code: 'possible_duplicate',
          message: 'O documento "12345678000190" já é do cliente "Padaria Pão Quente" no cadastro.',
        },
      ]);
      expect(r.counts).toEqual({ clientes: 1 });
      expect(r.recognized).toEqual({});
    });
    it('reports no recognized key when nothing is recognized', () => {
      expect(plan({ clientes: [{ nome: 'Loja' }] }).recognized).toEqual({});
    });
  });

  describe('etapas', () => {
    it('refuses a default etapa name already in the funnel', () => {
      expect(codes(plan({ etapas: [{ nome: 'novo' }] }))).toEqual(['duplicate_existing']);
    });
    it('refuses an archived etapa name', () => {
      expect(codes(plan({ etapas: [{ nome: 'Etapa antiga' }] }, richCatalog()))).toEqual(['duplicate_archived']);
    });
    it('refuses a repeated etapa in the sheet', () => {
      expect(codes(plan({ etapas: [{ nome: 'X' }, { nome: 'x' }] }))).toEqual(['duplicate_in_sheet']);
    });
    it('creates a new etapa', () => {
      const r = plan({ etapas: [{ nome: 'Diagnóstico' }] });
      expect(r.operations).toEqual([{ op: 'createLeadStage', planKey: 'etapas:2', input: { name: 'Diagnóstico', status: 'active' } }]);
    });
  });

  it('issues carry sheet, Excel row, header text and never a uuid or planKey', () => {
    const r = plan(
      {
        areas: [{ nome: 'Tecnologia' }, { nome: 'X' }, { nome: 'x' }],
        funcoes: [{ nome: 'Vendedor' }, { nome: '!!!' }],
        produtos: [{ nome: 'Sistema legado', area: 'Nada', codigo: 3, comissaoFinderPct: 1, comissaoFinderBrl: 1 }],
        custosProduto: [{ produto: 'Sistema legado', funcao: 'Vendedor' }],
        pessoas: [{ nome: 'Z', email: 'x@', funcoes: ['Nada'] }],
        etapas: [{ nome: 'Novo' }],
      },
      richCatalog(),
    );
    expect(r.issues.length).toBeGreaterThan(8);
    const headers = new Set<string>(WORKBOOK_SHEETS.flatMap((s) => s.columns.map((c) => c.header)));
    for (const issue of r.issues) {
      expect(issue.sheet).not.toBeNull();
      expect(issue.row).not.toBeNull();
      expect(issue.column !== null && headers.has(issue.column)).toBe(true);
      expect(issue.message).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
      expect(issue.message).not.toMatch(/\b[a-z]+:\d+\b/);
    }
  });

  it('is deterministic and does not mutate its inputs', () => {
    const parsed = workbook({ areas: [{ nome: 'A' }], produtos: [{ nome: 'P', area: 'A' }] });
    const catalog = seededCatalog();
    const before = JSON.stringify([parsed, catalog]);
    const refs = buildRefIndex(parsed, catalog);
    const a = planCadastros(parsed, catalog, refs);
    const b = planCadastros(parsed, catalog, refs);
    expect(a).toEqual(b);
    expect(JSON.stringify([parsed, catalog])).toBe(before);
  });
});
