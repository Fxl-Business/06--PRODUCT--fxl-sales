/**
 * Cadastro sheets planner: Áreas, Funções, Produtos (+ Custos por produto), Pessoas, Clientes, Etapas.
 * Pure and deterministic: slice 04 calls it internally.
 */
import {
  AreaSchema,
  ClientSchema,
  FuncaoSchema,
  PersonSchema,
  ProductFuncaoCostSchema,
  ProductSchema,
  SYSTEM_FUNCAO_SLUGS,
  slugifyFuncao,
} from '../../sales-ops/service.js';
import { LeadStageSchema } from '../../sales-ops/leads/schemas.js';
import { normalizeLabel } from '../cells.js';
import { cellReader } from '../parse.js';
import { assignProductCodes, refKey, type ImportRefIndex } from '../refs.js';
import type {
  EntityRef,
  ImportCatalog,
  ImportIssue,
  ImportOperation,
  ParsedWorkbook,
  SheetKey,
  SheetPlanResult,
} from '../types.js';
import {
  PLACEHOLDER_UUID,
  countOperations,
  erroredRowKeys,
  header,
  lookupIssue,
  planKeyOf,
  rowError,
  rowWarning,
  withoutKeys,
  zodIssuesToImportIssues,
} from './plan-helpers.js';

type Part = { operations: ImportOperation[]; issues: ImportIssue[] };

const RESTORE_GERAL = 'restaure em Cadastros > Geral (Histórico de arquivamentos)';

function hasError(issues: readonly ImportIssue[]): boolean {
  return issues.some((i) => i.severity === 'error');
}

/** An operation is emitted only when neither the parser nor the planner reported an error for the row. */
function allowed(blocked: Set<string>, sheet: SheetKey, row: number, issues: readonly ImportIssue[]): boolean {
  return !blocked.has(planKeyOf(sheet, row)) && !hasError(issues);
}

function digits(text: string | null | undefined): string {
  return (text ?? '').replace(/\D/g, '');
}

// ---------------------------------------------------------------------------
// Áreas
// ---------------------------------------------------------------------------

function planAreas(parsed: ParsedWorkbook, catalog: ImportCatalog, blocked: Set<string>): Part {
  const out: Part = { operations: [], issues: [] };
  const seen = new Map<string, number>();
  for (const row of parsed.sheets.areas.rows) {
    const nome = cellReader('areas', row).text('nome');
    if (nome === null) continue;
    const key = normalizeLabel(nome);
    const issues: ImportIssue[] = [];
    const col = header('areas', 'nome');

    const found = catalog.areas.find((a) => normalizeLabel(a.name) === key);
    if (found) {
      issues.push(
        found.status === 'active'
          ? rowError('areas', row.row, col, 'duplicate_existing', `A área "${nome}" já existe no cadastro; remova esta linha (as outras abas já usam a área existente).`)
          : rowError('areas', row.row, col, 'duplicate_archived', `A área "${nome}" já existe arquivada; ${RESTORE_GERAL} e remova esta linha.`),
      );
    }
    const earlier = seen.get(key);
    if (earlier !== undefined) {
      issues.push(rowError('areas', row.row, col, 'duplicate_in_sheet', `A área "${nome}" já aparece na linha ${earlier} desta aba.`));
    } else {
      seen.set(key, row.row);
    }
    const candidate = { name: nome, status: 'active' };
    const result = AreaSchema.safeParse(candidate);
    if (!result.success) {
      issues.push(
        ...zodIssuesToImportIssues(result.error, { sheet: 'areas', row: row.row, columns: { name: col }, fallbackColumn: null, values: candidate }),
      );
    }
    out.issues.push(...issues);
    if (result.success && allowed(blocked, 'areas', row.row, issues)) {
      out.operations.push({ op: 'createArea', planKey: planKeyOf('areas', row.row), input: result.data });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Funções
// ---------------------------------------------------------------------------

function planFuncoes(parsed: ParsedWorkbook, catalog: ImportCatalog, blocked: Set<string>): Part {
  const out: Part = { operations: [], issues: [] };
  const seenKey = new Map<string, number>();
  const seenSlug = new Map<string, { row: number; nome: string }>();
  const systemSlugs: readonly string[] = SYSTEM_FUNCAO_SLUGS;
  for (const row of parsed.sheets.funcoes.rows) {
    const nome = cellReader('funcoes', row).text('nome');
    if (nome === null) continue;
    const key = normalizeLabel(nome);
    const slug = slugifyFuncao(nome);
    const col = header('funcoes', 'nome');
    const issues: ImportIssue[] = [];

    if (systemSlugs.includes(slug)) {
      issues.push(rowError('funcoes', row.row, col, 'reserved_funcao', `Vendedor e Finder já existem em toda organização; remova a linha "${nome}".`));
      out.issues.push(...issues);
      continue;
    }
    if (slug === '') {
      issues.push(rowError('funcoes', row.row, col, 'invalid_funcao_name', `O nome "${nome}" precisa ter ao menos uma letra ou um número.`));
      out.issues.push(...issues);
      continue;
    }

    const sameName = catalog.funcoes.find((f) => normalizeLabel(f.name) === key);
    if (sameName) {
      issues.push(
        sameName.status === 'active'
          ? rowError('funcoes', row.row, col, 'duplicate_existing', `A função "${nome}" já existe no cadastro; remova esta linha (as outras abas já usam a função existente).`)
          : rowError('funcoes', row.row, col, 'duplicate_archived', `A função "${nome}" já existe arquivada; ${RESTORE_GERAL} e remova esta linha.`),
      );
    } else {
      const sameSlug = catalog.funcoes.find((f) => f.slug === slug);
      if (sameSlug) {
        issues.push(rowError('funcoes', row.row, col, 'duplicate_slug', `A função "${nome}" é parecida demais com "${sameSlug.name}", que já existe; use outro nome ou a função existente.`));
      }
    }

    const earlierKey = seenKey.get(key);
    const earlierSlug = seenSlug.get(slug);
    if (earlierKey !== undefined) {
      issues.push(rowError('funcoes', row.row, col, 'duplicate_in_sheet', `A função "${nome}" já aparece na linha ${earlierKey} desta aba.`));
    } else if (earlierSlug) {
      issues.push(rowError('funcoes', row.row, col, 'duplicate_slug', `A função "${nome}" é parecida demais com "${earlierSlug.nome}" da linha ${earlierSlug.row}; use nomes diferentes.`));
    } else {
      seenKey.set(key, row.row);
      seenSlug.set(slug, { row: row.row, nome });
    }

    const candidate = { name: nome, status: 'active' };
    const result = FuncaoSchema.safeParse(candidate);
    if (!result.success) {
      issues.push(
        ...zodIssuesToImportIssues(result.error, { sheet: 'funcoes', row: row.row, columns: { name: col }, fallbackColumn: null, values: candidate }),
      );
    }
    out.issues.push(...issues);
    if (result.success && allowed(blocked, 'funcoes', row.row, issues)) {
      out.operations.push({ op: 'createFuncao', planKey: planKeyOf('funcoes', row.row), input: result.data });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Produtos + Custos por produto
// ---------------------------------------------------------------------------

type CommissionPair = { type: 'pct' | 'fix'; value: number } | null;

function readPair(
  sheet: 'produtos',
  rowNumber: number,
  pct: number | null,
  brl: number | null,
  pctKey: string,
  brlKey: string,
  issues: ImportIssue[],
): CommissionPair {
  if (pct !== null && brl !== null) {
    issues.push(
      rowError(sheet, rowNumber, header(sheet, brlKey), 'both_pct_and_brl', `Preencha "${header(sheet, pctKey)}" ou "${header(sheet, brlKey)}", não as duas.`),
    );
    return null;
  }
  if (pct !== null) return { type: 'pct', value: pct };
  if (brl !== null) return { type: 'fix', value: brl / 100 };
  return null;
}

function planProdutos(
  parsed: ParsedWorkbook,
  catalog: ImportCatalog,
  refs: ImportRefIndex,
  blocked: Set<string>,
): Part & { costCount: number } {
  const out: Part & { costCount: number } = { operations: [], issues: [], costCount: 0 };
  const codes = assignProductCodes(parsed, catalog);
  const seen = new Map<string, number>();
  const opByPlanKey = new Map<string, Extract<ImportOperation, { op: 'createProduct' }>>();

  for (const row of parsed.sheets.produtos.rows) {
    const c = cellReader('produtos', row);
    const nome = c.text('nome');
    const area = c.text('area');
    if (nome === null || area === null) continue;
    const key = normalizeLabel(nome);
    const issues: ImportIssue[] = [];
    const colNome = header('produtos', 'nome');

    const sameName = catalog.products.filter((p) => normalizeLabel(p.name) === key);
    if (sameName.some((p) => p.status === 'active')) {
      issues.push(rowError('produtos', row.row, colNome, 'duplicate_existing', `O produto "${nome}" já existe no cadastro; remova esta linha (as outras abas já usam o produto existente).`));
    } else if (sameName.length > 0) {
      issues.push(rowWarning('produtos', row.row, colNome, 'possible_duplicate', `Já existe um produto arquivado chamado "${nome}"; esta linha cria um produto novo.`));
    }
    const earlier = seen.get(key);
    if (earlier !== undefined) {
      issues.push(rowError('produtos', row.row, colNome, 'duplicate_in_sheet', `O produto "${nome}" já aparece na linha ${earlier} desta aba.`));
    } else {
      seen.set(key, row.row);
    }

    const assignment = codes.get(row.row);
    if (assignment && !assignment.ok) {
      issues.push(rowError('produtos', row.row, header('produtos', 'codigo'), assignment.code, assignment.message));
    }
    const code = assignment && assignment.ok ? assignment.code : 0;

    let areaRef: EntityRef | null = null;
    const areaLookup = refs.resolve('area', area);
    if (areaLookup.ok) areaRef = areaLookup.ref;
    else issues.push(lookupIssue('produtos', row.row, header('produtos', 'area'), areaLookup));

    const seller = readPair('produtos', row.row, c.number('comissaoVendedorPct'), c.number('comissaoVendedorBrl'), 'comissaoVendedorPct', 'comissaoVendedorBrl', issues);
    const sellerWithFinder = readPair('produtos', row.row, c.number('comissaoVendedorComFinderPct'), c.number('comissaoVendedorComFinderBrl'), 'comissaoVendedorComFinderPct', 'comissaoVendedorComFinderBrl', issues);
    const finder = readPair('produtos', row.row, c.number('comissaoFinderPct'), c.number('comissaoFinderBrl'), 'comissaoFinderPct', 'comissaoFinderBrl', issues);
    const entradaPct = c.number('entradaPct');
    const entradaBrl = c.number('entradaBrl');
    let entradaMode: 'none' | 'pct' | 'fix' = 'none';
    if (entradaPct !== null && entradaBrl !== null) {
      issues.push(rowError('produtos', row.row, header('produtos', 'entradaBrl'), 'both_pct_and_brl', `Preencha "${header('produtos', 'entradaPct')}" ou "${header('produtos', 'entradaBrl')}", não as duas.`));
    } else if (entradaPct !== null) {
      entradaMode = 'pct';
    } else if (entradaBrl !== null) {
      entradaMode = 'fix';
    }

    const temMensalidade = c.bool('temMensalidade');
    const mensalidade = c.number('mensalidade');
    if (temMensalidade === false && (mensalidade ?? 0) > 0) {
      issues.push(rowError('produtos', row.row, header('produtos', 'mensalidade'), 'conflicting_values', 'Tem mensalidade é Não, mas a Mensalidade (R$) está preenchida; corrija uma das duas colunas.'));
    }
    const hasMonthly = temMensalidade ?? (mensalidade ?? 0) > 0;

    const parcelas = c.number('parcelas');
    if (entradaMode !== 'none' && (parcelas ?? 1) > 119) {
      issues.push(rowError('produtos', row.row, header('produtos', 'parcelas'), 'too_many_installments', 'Com entrada padrão, as parcelas padrão vão até 119, porque a entrada ocupa uma das 120.'));
    }

    const candidate: Record<string, unknown> = {
      name: nome,
      kind: c.text('tipo') ?? 'product',
      codeSuffix: String(code),
      areaId: PLACEHOLDER_UUID,
      setupBrl: c.number('valor') ?? 0,
      hasMonthly,
      monthlyBrl: mensalidade ?? 0,
      recurringCommission: c.bool('comissaoRecorrente') ?? false,
      hasFinderCommission: c.bool('comissionaFinder') ?? false,
      defaultPaymentMethod: c.text('formaPagamento') ?? 'pix',
      defaultEntradaMode: entradaMode,
      defaultEntradaPct: entradaMode === 'pct' ? entradaPct : null,
      defaultEntradaBrl: entradaMode === 'fix' ? entradaBrl : null,
      defaultRemainingInstallments: parcelas ?? 1,
      defaultRecurringCycles: c.number('ciclosRecorrencia'),
      status: 'active',
    };
    if (seller) {
      candidate['sellerCommissionType'] = seller.type;
      candidate['sellerCommissionValue'] = seller.value;
    }
    if (sellerWithFinder) {
      candidate['sellerWithFinderCommissionType'] = sellerWithFinder.type;
      candidate['sellerWithFinderCommissionValue'] = sellerWithFinder.value;
    }
    if (finder) {
      candidate['finderCommissionType'] = finder.type;
      candidate['finderCommissionValue'] = finder.value;
    }

    const valueHeader = (pair: CommissionPair, pctKey: string, brlKey: string) =>
      header('produtos', pair?.type === 'fix' ? brlKey : pctKey);
    const result = ProductSchema.safeParse(candidate);
    if (!result.success) {
      issues.push(
        ...zodIssuesToImportIssues(result.error, {
          sheet: 'produtos',
          row: row.row,
          columns: {
            name: colNome,
            kind: header('produtos', 'tipo'),
            codeSuffix: header('produtos', 'codigo'),
            setupBrl: header('produtos', 'valor'),
            monthlyBrl: header('produtos', 'mensalidade'),
            sellerCommissionValue: valueHeader(seller, 'comissaoVendedorPct', 'comissaoVendedorBrl'),
            sellerWithFinderCommissionValue: valueHeader(sellerWithFinder, 'comissaoVendedorComFinderPct', 'comissaoVendedorComFinderBrl'),
            finderCommissionValue: valueHeader(finder, 'comissaoFinderPct', 'comissaoFinderBrl'),
            defaultPaymentMethod: header('produtos', 'formaPagamento'),
            defaultEntradaMode: header('produtos', 'entradaPct'),
            defaultEntradaPct: header('produtos', 'entradaPct'),
            defaultEntradaBrl: header('produtos', 'entradaBrl'),
            defaultRemainingInstallments: header('produtos', 'parcelas'),
            defaultRecurringCycles: header('produtos', 'ciclosRecorrencia'),
          },
          fallbackColumn: null,
          values: candidate,
        }),
      );
    }
    out.issues.push(...issues);
    if (result.success && areaRef && allowed(blocked, 'produtos', row.row, issues)) {
      const op: Extract<ImportOperation, { op: 'createProduct' }> = {
        op: 'createProduct',
        planKey: planKeyOf('produtos', row.row),
        input: withoutKeys(result.data, ['areaId', 'productFuncaoCosts']),
        areaRef,
        funcaoCosts: [],
      };
      opByPlanKey.set(op.planKey, op);
      out.operations.push(op);
    }
  }

  // Custos por produto
  const seenCost = new Map<string, number>();
  for (const row of parsed.sheets.custosProduto.rows) {
    const c = cellReader('custosProduto', row);
    const produto = c.text('produto');
    const funcao = c.text('funcao');
    if (produto === null || funcao === null) continue;
    const issues: ImportIssue[] = [];
    const colProduto = header('custosProduto', 'produto');
    const colFuncao = header('custosProduto', 'funcao');
    const colPct = header('custosProduto', 'custoPct');
    const colBrl = header('custosProduto', 'custoBrl');

    const p = refs.resolve('product', produto);
    if (!p.ok) {
      issues.push(lookupIssue('custosProduto', row.row, colProduto, p));
    } else if ('existingId' in p.ref) {
      issues.push(rowError('custosProduto', row.row, colProduto, 'existing_product_cost', `O produto "${p.label}" já existe no cadastro; custos padrão só podem ser importados para produtos criados nesta planilha (edite o produto existente em Cadastros > Produtos & Serviços).`));
    }
    const f = refs.resolve('funcao', funcao);
    if (!f.ok) {
      issues.push(lookupIssue('custosProduto', row.row, colFuncao, f));
    } else if (refs.funcaoIsSystem(f.ref)) {
      issues.push(rowError('custosProduto', row.row, colFuncao, 'system_funcao_cost', 'Vendedor e Finder não têm custo padrão; eles recebem comissão.'));
    }

    const custoPct = c.number('custoPct');
    const custoBrl = c.number('custoBrl');
    if (custoPct !== null && custoBrl !== null) {
      issues.push(rowError('custosProduto', row.row, colBrl, 'both_pct_and_brl', `Preencha "${colPct}" ou "${colBrl}", não as duas.`));
    } else if (custoPct === null && custoBrl === null) {
      issues.push(rowError('custosProduto', row.row, colPct, 'cost_required', `Preencha "${colPct}" ou "${colBrl}".`));
    }

    if (p.ok && f.ok) {
      const dupKey = `${refKey(p.ref)}|${refKey(f.ref)}`;
      const earlier = seenCost.get(dupKey);
      if (earlier !== undefined) {
        issues.push(rowError('custosProduto', row.row, colFuncao, 'duplicate_cost', `O produto "${p.label}" já tem um custo para a função "${f.label}" na linha ${earlier}.`));
      } else {
        seenCost.set(dupKey, row.row);
      }
    }

    let cost: { mode: 'pct'; valuePct: number } | { mode: 'fix'; valueBrl: number } | null = null;
    if (custoPct !== null && custoBrl === null) cost = { mode: 'pct', valuePct: custoPct };
    else if (custoBrl !== null && custoPct === null) cost = { mode: 'fix', valueBrl: custoBrl };
    let parsedCost: ReturnType<typeof ProductFuncaoCostSchema.parse> | null = null;
    if (cost) {
      const candidate = { funcaoId: PLACEHOLDER_UUID, ...cost };
      const result = ProductFuncaoCostSchema.safeParse(candidate);
      if (result.success) {
        parsedCost = result.data;
      } else {
        issues.push(
          ...zodIssuesToImportIssues(result.error, {
            sheet: 'custosProduto',
            row: row.row,
            columns: { valuePct: colPct, valueBrl: colBrl },
            fallbackColumn: null,
            values: candidate,
          }),
        );
      }
    }
    out.issues.push(...issues);
    if (parsedCost && p.ok && f.ok && 'planKey' in p.ref && allowed(blocked, 'custosProduto', row.row, issues)) {
      const op = opByPlanKey.get(p.ref.planKey);
      if (op) {
        op.funcaoCosts.push({ funcaoRef: f.ref, cost: withoutKeys(parsedCost, ['funcaoId']) });
        out.costCount += 1;
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Pessoas
// ---------------------------------------------------------------------------

function planPessoas(parsed: ParsedWorkbook, catalog: ImportCatalog, refs: ImportRefIndex, blocked: Set<string>): Part {
  const out: Part = { operations: [], issues: [] };
  const seen = new Map<string, number>();
  for (const row of parsed.sheets.pessoas.rows) {
    const c = cellReader('pessoas', row);
    const nome = c.text('nome');
    const funcoes = c.list('funcoes');
    if (nome === null || funcoes === null) continue;
    const email = c.text('email');
    const key = normalizeLabel(nome);
    const issues: ImportIssue[] = [];
    const colNome = header('pessoas', 'nome');
    const colEmail = header('pessoas', 'email');
    const colFuncoes = header('pessoas', 'funcoes');

    if (funcoes.length === 0) {
      issues.push(rowError('pessoas', row.row, colFuncoes, 'funcao_required', `Informe ao menos uma função para a pessoa "${nome}".`));
    }
    const funcaoRefs: EntityRef[] = [];
    const seenRefs = new Set<string>();
    for (const name of funcoes) {
      const r = refs.resolve('funcao', name);
      if (!r.ok) {
        issues.push(lookupIssue('pessoas', row.row, colFuncoes, r));
        continue;
      }
      if (seenRefs.has(refKey(r.ref))) continue;
      seenRefs.add(refKey(r.ref));
      funcaoRefs.push(r.ref);
    }

    const sameName = catalog.people.find((p) => normalizeLabel(p.displayName) === key);
    if (sameName) {
      issues.push(rowWarning('pessoas', row.row, colNome, 'possible_duplicate', `Já existe uma pessoa chamada "${nome}" no cadastro; se for a mesma, remova esta linha (um nome repetido não pode ser usado nas outras abas).`));
    }
    const mail = email?.trim().toLowerCase() ?? '';
    if (mail !== '') {
      const sameMail = catalog.people.find((p) => p.contactEmail?.trim().toLowerCase() === mail);
      if (sameMail) {
        issues.push(rowWarning('pessoas', row.row, colEmail, 'possible_duplicate', `O e-mail "${email}" já é da pessoa "${sameMail.displayName}" no cadastro.`));
      }
    }
    const earlier = seen.get(key);
    if (earlier !== undefined) {
      issues.push(rowWarning('pessoas', row.row, colNome, 'possible_duplicate', `A pessoa "${nome}" já aparece na linha ${earlier} desta aba; um nome repetido não pode ser usado nas outras abas.`));
    } else {
      seen.set(key, row.row);
    }

    const candidate = { displayName: nome, contactEmail: email ?? '', status: 'active', funcaoIds: [PLACEHOLDER_UUID] };
    const result = PersonSchema.safeParse(candidate);
    if (!result.success) {
      issues.push(
        ...zodIssuesToImportIssues(result.error, {
          sheet: 'pessoas',
          row: row.row,
          columns: { displayName: colNome, contactEmail: colEmail, funcaoIds: colFuncoes },
          fallbackColumn: null,
          values: candidate,
        }),
      );
    }
    out.issues.push(...issues);
    if (result.success && allowed(blocked, 'pessoas', row.row, issues)) {
      out.operations.push({
        op: 'createPerson',
        planKey: planKeyOf('pessoas', row.row),
        input: withoutKeys(result.data, ['funcaoIds']),
        funcaoRefs,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Clientes
// ---------------------------------------------------------------------------

function planClientes(parsed: ParsedWorkbook, catalog: ImportCatalog, blocked: Set<string>): Part {
  const out: Part = { operations: [], issues: [] };
  const seenName = new Map<string, number>();
  const seenDoc = new Map<string, number>();
  for (const row of parsed.sheets.clientes.rows) {
    const c = cellReader('clientes', row);
    const nome = c.text('nome');
    if (nome === null) continue;
    const documento = c.text('documento');
    const key = normalizeLabel(nome);
    const doc = digits(documento);
    const issues: ImportIssue[] = [];
    const colNome = header('clientes', 'nome');
    const colDoc = header('clientes', 'documento');

    const sameName = catalog.clients.find((x) => normalizeLabel(x.name) === key);
    if (sameName) {
      issues.push(rowWarning('clientes', row.row, colNome, 'possible_duplicate', `Já existe um cliente chamado "${nome}" no cadastro; se for o mesmo, remova esta linha (um nome repetido não pode ser usado nas outras abas).`));
    }
    if (doc !== '') {
      const sameDoc = catalog.clients.find((x) => digits(x.document) === doc);
      if (sameDoc) {
        issues.push(rowWarning('clientes', row.row, colDoc, 'possible_duplicate', `O documento "${documento}" já é do cliente "${sameDoc.name}" no cadastro.`));
      }
    }
    const earlierName = seenName.get(key);
    if (earlierName !== undefined) {
      issues.push(rowWarning('clientes', row.row, colNome, 'possible_duplicate', `O cliente "${nome}" já aparece na linha ${earlierName} desta aba; um nome repetido não pode ser usado nas outras abas.`));
    } else {
      seenName.set(key, row.row);
    }
    if (doc !== '') {
      const earlierDoc = seenDoc.get(doc);
      if (earlierDoc !== undefined) {
        issues.push(rowWarning('clientes', row.row, colDoc, 'possible_duplicate', `O documento "${documento}" já aparece na linha ${earlierDoc} desta aba.`));
      } else {
        seenDoc.set(doc, row.row);
      }
    }

    const candidate = {
      name: nome,
      contact: c.text('contato'),
      legalName: c.text('razaoSocial'),
      document: documento,
      address: c.text('endereco'),
      legalRepName: c.text('representante'),
      legalRepDocument: c.text('documentoRepresentante'),
    };
    const result = ClientSchema.safeParse(candidate);
    if (!result.success) {
      issues.push(
        ...zodIssuesToImportIssues(result.error, {
          sheet: 'clientes',
          row: row.row,
          columns: {
            name: colNome,
            contact: header('clientes', 'contato'),
            legalName: header('clientes', 'razaoSocial'),
            document: colDoc,
            address: header('clientes', 'endereco'),
            legalRepName: header('clientes', 'representante'),
            legalRepDocument: header('clientes', 'documentoRepresentante'),
          },
          fallbackColumn: null,
          values: candidate,
        }),
      );
    }
    out.issues.push(...issues);
    if (result.success && allowed(blocked, 'clientes', row.row, issues)) {
      out.operations.push({ op: 'createClient', planKey: planKeyOf('clientes', row.row), input: result.data });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Etapas
// ---------------------------------------------------------------------------

function planEtapas(parsed: ParsedWorkbook, catalog: ImportCatalog, blocked: Set<string>): Part {
  const out: Part = { operations: [], issues: [] };
  const seen = new Map<string, number>();
  for (const row of parsed.sheets.etapas.rows) {
    const nome = cellReader('etapas', row).text('nome');
    if (nome === null) continue;
    const key = normalizeLabel(nome);
    const col = header('etapas', 'nome');
    const issues: ImportIssue[] = [];

    const found = catalog.stages.find((s) => normalizeLabel(s.name) === key);
    if (found) {
      issues.push(
        found.status === 'active'
          ? rowError('etapas', row.row, col, 'duplicate_existing', `A etapa "${nome}" já existe no funil; remova esta linha (os leads já podem usar a etapa existente).`)
          : rowError('etapas', row.row, col, 'duplicate_archived', `A etapa "${nome}" já existe arquivada; restaure em Cadastros > Etapas e remova esta linha.`),
      );
    }
    const earlier = seen.get(key);
    if (earlier !== undefined) {
      issues.push(rowError('etapas', row.row, col, 'duplicate_in_sheet', `A etapa "${nome}" já aparece na linha ${earlier} desta aba.`));
    } else {
      seen.set(key, row.row);
    }
    const candidate = { name: nome, status: 'active' };
    const result = LeadStageSchema.safeParse(candidate);
    if (!result.success) {
      issues.push(
        ...zodIssuesToImportIssues(result.error, { sheet: 'etapas', row: row.row, columns: { name: col }, fallbackColumn: null, values: candidate }),
      );
    }
    out.issues.push(...issues);
    if (result.success && allowed(blocked, 'etapas', row.row, issues)) {
      out.operations.push({ op: 'createLeadStage', planKey: planKeyOf('etapas', row.row), input: result.data });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------

function sheetOf(op: ImportOperation): SheetKey | null {
  switch (op.op) {
    case 'createArea':
      return 'areas';
    case 'createFuncao':
      return 'funcoes';
    case 'createProduct':
      return 'produtos';
    case 'createPerson':
      return 'pessoas';
    case 'createClient':
      return 'clientes';
    case 'createLeadStage':
      return 'etapas';
    default:
      return null;
  }
}

export function planCadastros(parsed: ParsedWorkbook, catalog: ImportCatalog, refs: ImportRefIndex): SheetPlanResult {
  const blocked = erroredRowKeys(parsed.issues);
  const produtos = planProdutos(parsed, catalog, refs, blocked);
  const parts: Part[] = [
    planAreas(parsed, catalog, blocked),
    planFuncoes(parsed, catalog, blocked),
    produtos,
    planPessoas(parsed, catalog, refs, blocked),
    planClientes(parsed, catalog, blocked),
    planEtapas(parsed, catalog, blocked),
  ];
  const operations = parts.flatMap((p) => p.operations);
  const issues = parts.flatMap((p) => p.issues);
  const counts = countOperations(operations, sheetOf);
  if (produtos.costCount > 0) counts.custosProduto = produtos.costCount;
  return { operations, issues, counts };
}
