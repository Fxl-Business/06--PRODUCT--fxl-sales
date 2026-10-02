/**
 * Propostas sheet planner (Propostas, Itens da proposta, Profissionais da proposta, Parcelas).
 * Pure and deterministic: no I/O, no clock, no env. Mirrors what the proposta wizard derives
 * from the same choices (apps/web/src/sales-ops/calculations.ts).
 */
import type { ZodIssue } from 'zod';
import {
  CreateSaleSchema,
  resolveProductKind,
  type PaymentMethod,
  type ProductEntradaMode,
  type ProductKind,
} from '../../sales-ops/service.js';
import { coercePctList, normalizeLabel } from '../cells.js';
import { cellReader } from '../parse.js';
import { refKey, type ImportRefIndex } from '../refs.js';
import type {
  CommissionType,
  EntityRef,
  ImportCatalog,
  ImportCounts,
  ImportIssue,
  ImportOperation,
  ParsedRow,
  ParsedWorkbook,
  RefKind,
  SaleDraft,
  SheetKey,
  SheetPlanResult,
} from '../types.js';
import { planCadastros } from './cadastros.js';
import {
  PLACEHOLDER_UUID,
  erroredRowKeys,
  header,
  lookupIssue,
  planKeyOf,
  rowError,
  rowWarning,
} from './plan-helpers.js';

// ---------------------------------------------------------------------------
// Produto defaults the planner reads
// ---------------------------------------------------------------------------

export type ProposalProductFuncaoCost =
  | { funcaoKey: string; mode: 'pct'; valuePct: number }
  | { funcaoKey: string; mode: 'fix'; valueBrl: number }; // valueBrl in CENTS

export type ProposalProduct = {
  ref: EntityRef;
  name: string;
  kind: ProductKind;
  setupBrl: number;
  monthlyBrl: number;
  hasMonthly: boolean;
  sellerCommissionType: CommissionType;
  sellerCommissionValue: number;
  sellerWithFinderCommissionType: CommissionType;
  sellerWithFinderCommissionValue: number;
  finderCommissionType: CommissionType;
  finderCommissionValue: number;
  defaultPaymentMethod: PaymentMethod;
  defaultEntradaMode: ProductEntradaMode;
  defaultEntradaPct: number | null;
  defaultEntradaBrl: number | null;
  defaultRemainingInstallments: number;
  defaultRecurringCycles: number | null;
  funcaoCosts: ProposalProductFuncaoCost[];
};

/** Keyed by `refKey(ref)`. */
export type ProposalProductIndex = ReadonlyMap<string, ProposalProduct>;

export function buildProposalProductIndex(
  catalog: ImportCatalog,
  cadastroOperations: readonly ImportOperation[],
): ProposalProductIndex {
  const index = new Map<string, ProposalProduct>();
  for (const p of catalog.products) {
    const ref: EntityRef = { existingId: p.id };
    index.set(refKey(ref), {
      ref,
      name: p.name,
      kind: p.kind,
      setupBrl: p.setupBrl,
      monthlyBrl: p.monthlyBrl,
      hasMonthly: p.hasMonthly,
      sellerCommissionType: p.sellerCommissionType,
      sellerCommissionValue: p.sellerCommissionValue,
      sellerWithFinderCommissionType: p.sellerWithFinderCommissionType,
      sellerWithFinderCommissionValue: p.sellerWithFinderCommissionValue,
      finderCommissionType: p.finderCommissionType,
      finderCommissionValue: p.finderCommissionValue,
      defaultPaymentMethod: p.defaultPaymentMethod,
      defaultEntradaMode: p.defaultEntradaMode,
      defaultEntradaPct: p.defaultEntradaPct,
      defaultEntradaBrl: p.defaultEntradaBrl,
      defaultRemainingInstallments: p.defaultRemainingInstallments,
      defaultRecurringCycles: p.defaultRecurringCycles,
      funcaoCosts: p.productFuncaoCosts.map((c): ProposalProductFuncaoCost => {
        const funcaoKey = refKey({ existingId: c.funcaoId });
        return c.mode === 'pct'
          ? { funcaoKey, mode: 'pct', valuePct: c.valuePct }
          : { funcaoKey, mode: 'fix', valueBrl: c.valueBrl };
      }),
    });
  }
  for (const op of cadastroOperations) {
    if (op.op !== 'createProduct') continue;
    const i = op.input;
    const ref: EntityRef = { planKey: op.planKey };
    index.set(refKey(ref), {
      ref,
      name: i.name,
      kind: resolveProductKind(i),
      setupBrl: i.setupBrl,
      monthlyBrl: i.monthlyBrl,
      hasMonthly: i.hasMonthly,
      sellerCommissionType: i.sellerCommissionType,
      sellerCommissionValue: i.sellerCommissionValue,
      // exactly what createProduct stores
      sellerWithFinderCommissionType: i.sellerWithFinderCommissionType ?? i.sellerCommissionType,
      sellerWithFinderCommissionValue: i.sellerWithFinderCommissionValue ?? i.sellerCommissionValue,
      finderCommissionType: i.finderCommissionType,
      finderCommissionValue: i.finderCommissionValue,
      defaultPaymentMethod: i.defaultPaymentMethod,
      defaultEntradaMode: i.defaultEntradaMode,
      defaultEntradaPct: i.defaultEntradaPct ?? null,
      defaultEntradaBrl: i.defaultEntradaBrl ?? null,
      defaultRemainingInstallments: i.defaultRemainingInstallments,
      defaultRecurringCycles: i.defaultRecurringCycles ?? null,
      funcaoCosts: op.funcaoCosts.map(({ funcaoRef, cost: loose }): ProposalProductFuncaoCost => {
        const funcaoKey = refKey(funcaoRef);
        // Omit<union, key> collapses the union; the discriminant is still intact at runtime.
        const cost = loose as { mode: 'pct'; valuePct: number } | { mode: 'fix'; valueBrl: number };
        return cost.mode === 'pct'
          ? { funcaoKey, mode: 'pct', valuePct: cost.valuePct }
          : { funcaoKey, mode: 'fix', valueBrl: cost.valueBrl };
      }),
    });
  }
  return index;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

const PAYMENT_METHODS: readonly PaymentMethod[] = ['pix', 'card', 'boleto', 'transfer'];

function asMethod(value: string | null): PaymentMethod | null {
  return PAYMENT_METHODS.find((m) => m === value) ?? null;
}

/** `R$ 1.234,56` from integer cents. */
function brl(cents: number): string {
  const reais = String(Math.floor(cents / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `R$ ${reais},${String(cents % 100).padStart(2, '0')}`;
}

function dayBr(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

const pad2 = (n: number) => String(n).padStart(2, '0');
const pad4 = (n: number) => String(n).padStart(4, '0');

/** Absolute month offset from the anchor with month-end clamping (never `toISOString`). */
function addMonths(iso: string, months: number): string {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  return `${pad4(t.getUTCFullYear())}-${pad2(t.getUTCMonth() + 1)}-${pad2(Math.min(d, last))}`;
}

type Shape = { entradaMode: ProductEntradaMode; entradaValue: number; restanteCount: number; anchorDate: string };
type Installment = SaleDraft['installments'][number];

/** The wizard generator: remainder on the LAST row. */
function generatePlan(total: number, shape: Shape, method: PaymentMethod): Installment[] {
  const entrada =
    shape.entradaMode === 'pct'
      ? Math.round((total * shape.entradaValue) / 100)
      : shape.entradaMode === 'fix'
        ? Math.floor(shape.entradaValue)
        : 0;
  const entradaCents = Math.min(Math.max(entrada, 0), total);
  const restante = total - entradaCents;
  const maxRest = shape.entradaMode === 'none' ? 120 : 119;
  const n = Math.max(1, Math.min(maxRest, Math.floor(shape.restanteCount) || 1));
  const rows: Installment[] = [];
  if (entradaCents > 0) rows.push({ dueDate: shape.anchorDate, amountBrl: entradaCents, method });
  if (restante > 0) {
    const base = Math.floor(restante / n);
    for (let i = 0; i < n; i += 1) {
      rows.push({
        dueDate: addMonths(shape.anchorDate, i + (entradaCents > 0 ? 1 : 0)),
        amountBrl: i === n - 1 ? restante - base * (n - 1) : base,
        method,
      });
    }
  }
  if (rows.length === 0) rows.push({ dueDate: shape.anchorDate, amountBrl: 0, method });
  return rows;
}

function productShape(product: ProposalProduct | undefined, baseDate: string): Shape {
  const mode = product?.defaultEntradaMode ?? 'none';
  const value =
    mode === 'pct'
      ? Math.max(0, product?.defaultEntradaPct ?? 0)
      : mode === 'fix'
        ? Math.max(0, Math.floor(product?.defaultEntradaBrl ?? 0))
        : 0;
  return {
    entradaMode: mode,
    entradaValue: value,
    restanteCount: Math.max(1, Math.min(120, Math.floor(product?.defaultRemainingInstallments ?? 1) || 1)),
    anchorDate: baseDate,
  };
}

function commissionDefaults(
  primary: ProposalProduct | undefined,
  hasFinder: boolean,
  settings: ImportCatalog['settings'],
): { seller: number; finder: number } {
  const pctOr = (type: CommissionType | undefined, value: number | undefined, fallback: number) =>
    type === 'pct' && value !== undefined ? value : fallback;
  if (!hasFinder) {
    return {
      seller: pctOr(primary?.sellerCommissionType, primary?.sellerCommissionValue, settings.defaultSellerCommissionPct),
      finder: settings.defaultFinderCommissionPct,
    };
  }
  return {
    seller: pctOr(
      primary?.sellerWithFinderCommissionType,
      primary?.sellerWithFinderCommissionValue,
      settings.defaultSellerCommissionPct,
    ),
    finder: pctOr(primary?.finderCommissionType, primary?.finderCommissionValue, settings.defaultFinderCommissionPct),
  };
}

const baseValue = (p: ProposalProduct) => p.setupBrl || p.monthlyBrl;

// ---------------------------------------------------------------------------
// Draft sources and the schema safety net
// ---------------------------------------------------------------------------

/** Where each draft array entry came from, so a schema issue can be pinned to a sheet, row and header. */
export type DraftSources = {
  propostaRow: number;
  ref: string;
  items: Array<{ sheet: 'propostas' | 'itens'; row: number }>;
  professionals: Array<{ row: number }>;
  installments: { kind: 'parcelas'; rows: number[] } | { kind: 'generated' };
};

const TOP_COLUMNS: Record<string, string> = {
  clientName: 'cliente',
  clientId: 'cliente',
  sellerName: 'vendedor',
  sellerPersonId: 'vendedor',
  finderName: 'finder',
  finderPersonId: 'finder',
  baseDate: 'dataBase',
  status: 'situacao',
  sellerCommissionPct: 'comissaoVendedorPct',
  finderCommissionPct: 'comissaoFinderPct',
  taxPct: 'impostoPct',
  otherCostsBrl: 'outrosCustos',
  notes: 'observacoes',
};

/** Maps CreateSaleSchema issues onto ImportIssues (one per distinct sheet/row/column). The zod text is never copied. */
export function mapSaleSchemaIssues(issues: readonly ZodIssue[], sources: DraftSources): ImportIssue[] {
  const out: ImportIssue[] = [];
  const seen = new Set<string>();
  for (const issue of issues) {
    const [head, second, third] = issue.path;
    let sheet: SheetKey = 'propostas';
    let row = sources.propostaRow;
    let column: string | null = null;

    if (head === 'items' && typeof second === 'number') {
      const src = sources.items[second];
      if (src) {
        sheet = src.sheet;
        row = src.row;
      }
      const field = typeof third === 'string' ? third : '';
      const itens = sheet === 'itens';
      column =
        field === 'quantity'
          ? header(sheet, 'quantidade')
          : field === 'unitBrl'
            ? header(sheet, 'valorUnitario')
            : (field === 'productName' || field === 'areaId') && itens
              ? header(sheet, field === 'productName' ? 'descricao' : 'area')
              : header(sheet, 'produto');
    } else if (head === 'professionals' && typeof second === 'number') {
      sheet = 'profissionais';
      row = sources.professionals[second]?.row ?? sources.propostaRow;
      const field = typeof third === 'string' ? third : '';
      column =
        field === 'costBrl'
          ? header(sheet, 'custo')
          : field === 'costSplitBp'
            ? header(sheet, 'divisaoCusto')
            : field === 'personName' || field === 'personId'
              ? header(sheet, 'pessoa')
              : field === 'funcaoId' || field === 'role'
                ? header(sheet, 'funcao')
                : null;
    } else if (head === 'installments') {
      if (sources.installments.kind === 'parcelas') {
        sheet = 'parcelas';
        const rows = sources.installments.rows;
        row = (typeof second === 'number' ? rows[second] : undefined) ?? rows[0] ?? sources.propostaRow;
        const field = typeof third === 'string' ? third : '';
        column = header(sheet, field === 'dueDate' ? 'vencimento' : field === 'method' ? 'formaPagamento' : 'valor');
      } else {
        column = header('propostas', 'numeroParcelas');
      }
    } else if (head === 'recurring') {
      const field = typeof second === 'string' ? second : '';
      column = header(
        'propostas',
        field === 'monthlyBrl'
          ? 'mensalidade'
          : field === 'startDate'
            ? 'inicioRecorrencia'
            : field === 'cycles'
              ? 'ciclosRecorrencia'
              : 'formaPagamento',
      );
    } else if (typeof head === 'string' && TOP_COLUMNS[head] !== undefined) {
      column = header('propostas', TOP_COLUMNS[head] as string);
    }

    const key = `${sheet}|${row}|${column ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(
      rowError(
        sheet,
        row,
        column,
        'invalid_proposta',
        column === null
          ? `A proposta "${sources.ref}" foi recusada; revise os dados da proposta e das abas ligadas a ela.`
          : `A proposta "${sources.ref}" foi recusada na coluna "${column}"; revise o valor.`,
      ),
    );
  }
  return out;
}

function probeInput(draft: SaleDraft): unknown {
  const { clientRef, sellerRef, finderRef, items, professionals, ...rest } = draft;
  const id = (ref: EntityRef | null) => (ref ? PLACEHOLDER_UUID : undefined);
  return {
    ...rest,
    ...(clientRef ? { clientId: id(clientRef) } : {}),
    sellerPersonId: id(sellerRef),
    ...(finderRef ? { finderPersonId: id(finderRef) } : {}),
    items: items.map(({ productRef, areaRef, ...item }) => ({
      ...item,
      ...(productRef ? { productId: id(productRef) } : {}),
      ...(areaRef ? { areaId: id(areaRef) } : {}),
    })),
    professionals: professionals.map(({ personRef, funcaoRef, ...pro }) => ({
      ...pro,
      ...(personRef ? { personId: id(personRef) } : {}),
      ...(funcaoRef ? { funcaoId: id(funcaoRef) } : {}),
    })),
  };
}

// ---------------------------------------------------------------------------
// The planner
// ---------------------------------------------------------------------------

type DraftItem = SaleDraft['items'][number];
type BuiltItem = { draft: DraftItem; product: ProposalProduct | null; source: { sheet: 'propostas' | 'itens'; row: number } };
type Kids = { itens: ParsedRow[]; profissionais: ParsedRow[]; parcelas: ParsedRow[] };

export function planPropostas(parsed: ParsedWorkbook, catalog: ImportCatalog, refs: ImportRefIndex): SheetPlanResult {
  return planPropostasWith(
    parsed,
    catalog,
    refs,
    buildProposalProductIndex(catalog, planCadastros(parsed, catalog, refs).operations),
  );
}

export function planPropostasWith(
  parsed: ParsedWorkbook,
  catalog: ImportCatalog,
  refs: ImportRefIndex,
  products: ProposalProductIndex,
): SheetPlanResult {
  const issues: ImportIssue[] = [];
  const operations: ImportOperation[] = [];
  const counts: ImportCounts = {};
  const errorRows = erroredRowKeys(parsed.issues);
  const P = 'propostas' as const;
  const h = (key: string) => header(P, key);

  // Step 1 - Ref index and duplicates
  const firstByRef = new Map<string, { row: ParsedRow; ref: string }>();
  for (const row of parsed.sheets.propostas.rows) {
    const ref = cellReader(P, row).text('ref');
    if (ref === null) continue;
    const k = normalizeLabel(ref);
    const first = firstByRef.get(k);
    if (first) {
      issues.push(
        rowError(
          P,
          row.row,
          h('ref'),
          'duplicate_ref',
          `O Ref "${ref}" já foi usado na linha ${first.row.row} da aba Propostas; cada proposta precisa de um Ref diferente.`,
        ),
      );
    } else {
      firstByRef.set(k, { row, ref });
    }
  }

  // Step 2 - group children
  const children = new Map<string, Kids>();
  for (const sheet of ['itens', 'profissionais', 'parcelas'] as const) {
    for (const row of parsed.sheets[sheet].rows) {
      const ref = cellReader(sheet, row).text('ref');
      if (ref === null) continue;
      const k = normalizeLabel(ref);
      if (!firstByRef.has(k)) {
        issues.push(
          rowError(
            sheet,
            row.row,
            header(sheet, 'ref'),
            'unknown_proposta_ref',
            `O Ref "${ref}" não existe na aba Propostas; use o Ref de uma proposta desta planilha.`,
          ),
        );
        continue;
      }
      let kids = children.get(k);
      if (!kids) {
        kids = { itens: [], profissionais: [], parcelas: [] };
        children.set(k, kids);
      }
      kids[sheet].push(row);
    }
  }

  // Step 3 - per proposta
  for (const [k, { row, ref }] of firstByRef) {
    const r = cellReader(P, row);
    const kids = children.get(k) ?? { itens: [], profissionais: [], parcelas: [] };
    const rowErrored = (sheet: SheetKey, n: number) => errorRows.has(planKeyOf(sheet, n));
    let failed =
      rowErrored(P, row.row) ||
      kids.itens.some((x) => rowErrored('itens', x.row)) ||
      kids.profissionais.some((x) => rowErrored('profissionais', x.row)) ||
      kids.parcelas.some((x) => rowErrored('parcelas', x.row));
    const push = (issue: ImportIssue) => {
      issues.push(issue);
      if (issue.severity === 'error') failed = true;
    };
    const resolve = (kind: RefKind, name: string, sheet: SheetKey, n: number, column: string) => {
      const l = refs.resolve(kind, name);
      if (!l.ok) {
        push(lookupIssue(sheet, n, column, l));
        return null;
      }
      return l;
    };

    // 3.1 Cliente
    let clientRef: EntityRef | null = null;
    let clientName = '';
    const cliente = r.text('cliente');
    if (cliente !== null) {
      const l = resolve('client', cliente, P, row.row, h('cliente'));
      if (l) {
        clientRef = l.ref;
        clientName = l.label;
      }
    }

    // 3.2 Vendedor / 3.3 Finder
    const personWithFuncao = (
      name: string | null,
      slug: 'vendedor' | 'finder',
      key: 'vendedor' | 'finder',
      code: string,
      funcaoLabel: string,
      advice: string,
    ): { ref: EntityRef; label: string } | null => {
      if (name === null) return null;
      const l = refs.resolvePersonWithFuncao(name, slug);
      if (l.ok) return { ref: l.ref, label: l.label };
      if (l.code === 'missing_funcao') {
        push(rowError(P, row.row, h(key), code, `"${name}" não tem a função ${funcaoLabel}; ${advice}`));
      } else {
        push(lookupIssue(P, row.row, h(key), l));
      }
      return null;
    };
    const vendedorName = r.text('vendedor');
    const seller = personWithFuncao(
      vendedorName,
      'vendedor',
      'vendedor',
      'seller_without_funcao',
      'Vendedor',
      'inclua a função Vendedor no cadastro da pessoa ou escolha outro vendedor.',
    );
    const finderNameCell = r.text('finder');
    const finder = personWithFuncao(
      finderNameCell,
      'finder',
      'finder',
      'finder_without_funcao',
      'Finder',
      'inclua a função Finder no cadastro da pessoa ou deixe o Finder em branco.',
    );
    const hasFinder = finderNameCell !== null;

    // 3.4 Items
    const shortcut = { produto: r.text('produto'), quantidade: r.number('quantidade'), valor: r.number('valorUnitario') };
    const anyShortcut = shortcut.produto !== null || shortcut.quantidade !== null || shortcut.valor !== null;
    const builtItems: BuiltItem[] = [];
    let itemFailed = false;
    const itemIssue = (issue: ImportIssue) => {
      push(issue);
      if (issue.severity === 'error') itemFailed = true;
    };

    const buildItem = (
      sheet: 'propostas' | 'itens',
      n: number,
      produto: string | null,
      descricao: string | null,
      area: string | null,
      quantidade: number | null,
      valor: number | null,
      valorHasParserError: boolean,
    ): void => {
      const col = (key: string) => header(sheet, key);
      const quantity = quantidade ?? 1;
      if (produto !== null) {
        const l = refs.resolve('product', produto);
        if (!l.ok) return itemIssue(lookupIssue(sheet, n, col('produto'), l));
        const product = products.get(refKey(l.ref));
        if (!product) {
          return itemIssue(
            rowError(sheet, n, col('produto'), 'product_has_errors', `O produto "${l.label}" tem erros na aba Produtos; corrija a linha do produto primeiro.`),
          );
        }
        const unitBrl = valor ?? baseValue(product);
        if (product.kind === 'service' && unitBrl === 0) {
          return itemIssue(
            rowError(sheet, n, col('valorUnitario'), 'negotiated_value_required', `O serviço "${l.label}" não tem valor no cadastro; informe o Valor unitário (R$) negociado.`),
          );
        }
        let productName = product.name;
        if (descricao !== null) {
          if (product.kind === 'service') productName = descricao;
          else {
            issues.push(
              rowWarning(sheet, n, col('descricao'), 'description_ignored', `A Descrição "${descricao}" foi ignorada: ela só vale para itens avulsos e para serviços.`),
            );
          }
        }
        if (area !== null) {
          issues.push(
            rowWarning(sheet, n, col('area'), 'area_ignored', `A Área "${area}" foi ignorada: o item usa a área do produto "${l.label}".`),
          );
        }
        builtItems.push({
          draft: { productRef: l.ref, areaRef: null, productName, quantity, unitBrl },
          product,
          source: { sheet, row: n },
        });
        return;
      }
      // free-form (Itens only)
      const shown = descricao ?? 'sem descrição';
      let ok = true;
      if (descricao === null) {
        itemIssue(rowError(sheet, n, col('descricao'), 'free_item_description_required', 'Preencha a Descrição do item avulso ou escolha um Produto.'));
        ok = false;
      }
      let areaRef: EntityRef | null = null;
      if (area === null) {
        itemIssue(rowError(sheet, n, col('area'), 'free_item_area_required', `Preencha a Área do item avulso "${shown}".`));
        ok = false;
      } else {
        const l = refs.resolve('area', area);
        if (l.ok) areaRef = l.ref;
        else {
          itemIssue(lookupIssue(sheet, n, col('area'), l));
          ok = false;
        }
      }
      if ((valor === null || valor === 0) && !valorHasParserError) {
        itemIssue(rowError(sheet, n, col('valorUnitario'), 'free_item_value_required', `Informe o Valor unitário (R$) do item avulso "${shown}".`));
        ok = false;
      }
      if (ok && descricao !== null && areaRef !== null && valor !== null) {
        builtItems.push({
          draft: { productRef: null, areaRef, productName: descricao, quantity, unitBrl: valor },
          product: null,
          source: { sheet, row: n },
        });
      }
    };

    if (anyShortcut && kids.itens.length > 0) {
      const first = shortcut.produto !== null ? 'produto' : shortcut.quantidade !== null ? 'quantidade' : 'valorUnitario';
      itemIssue(
        rowError(P, row.row, h(first), 'items_conflict', `A proposta "${ref}" tem Produto, Quantidade ou Valor unitário preenchidos e também linhas na aba Itens da proposta; use só uma das duas formas.`),
      );
    } else if (!anyShortcut && kids.itens.length === 0) {
      if (!rowErrored(P, row.row)) {
        itemIssue(rowError(P, row.row, h('produto'), 'no_items', `A proposta "${ref}" não tem itens; preencha o Produto ou adicione linhas na aba Itens da proposta.`));
      }
    } else if (kids.itens.length === 0) {
      if (shortcut.produto === null) {
        itemIssue(rowError(P, row.row, h('produto'), 'no_items', `A proposta "${ref}" não tem itens; preencha o Produto ou adicione linhas na aba Itens da proposta.`));
      } else {
        buildItem(P, row.row, shortcut.produto, null, null, shortcut.quantidade, shortcut.valor, rowErrored(P, row.row));
      }
    } else {
      for (const itemRow of kids.itens) {
        const c = cellReader('itens', itemRow);
        buildItem(
          'itens',
          itemRow.row,
          c.text('produto'),
          c.text('descricao'),
          c.text('area'),
          c.number('quantidade'),
          c.number('valorUnitario'),
          rowErrored('itens', itemRow.row),
        );
      }
    }

    const primary = builtItems[0]?.product ?? undefined;
    const total = builtItems.reduce((sum, b) => sum + b.draft.quantity * b.draft.unitBrl, 0);
    if (builtItems.length > 0 && !itemFailed && total === 0) {
      push(rowError(P, row.row, null, 'zero_total', `A proposta "${ref}" tem total ${brl(0)}; informe o Valor unitário de pelo menos um item.`));
    }

    // 3.5 Commissions, tax, other
    const defaults = commissionDefaults(primary, hasFinder, catalog.settings);
    const sellerCommissionPct = r.number('comissaoVendedorPct') ?? defaults.seller;
    const finderCommissionPct = r.number('comissaoFinderPct') ?? defaults.finder;
    const taxPct = r.number('impostoPct') ?? catalog.settings.defaultTaxPct;
    const otherCostsBrl = r.number('outrosCustos') ?? 0;
    const notes = r.text('observacoes');
    const baseDate = r.text('dataBase');

    // 3.6 Status
    const situacao = r.text('situacao');
    const status: SaleDraft['status'] = situacao === 'draft' ? 'draft' : situacao === 'won' ? 'won' : 'open';
    const wonOn = situacao === 'won' ? r.text('dataGanho') : null;

    // 3.7 Payment method
    const method: PaymentMethod = asMethod(r.text('formaPagamento')) ?? primary?.defaultPaymentMethod ?? 'pix';

    // 3.8 Installments
    let installments: Installment[] = [];
    let sources: DraftSources['installments'] = { kind: 'generated' };
    if (baseDate !== null && !itemFailed) {
      const entrada = r.number('entradaBrl');
      const count = r.number('numeroParcelas');
      if (kids.parcelas.length > 0) {
        if (entrada !== null || count !== null) {
          push(
            rowError(P, row.row, entrada !== null ? h('entradaBrl') : h('numeroParcelas'), 'plan_conflict', `A proposta "${ref}" tem parcelas na aba Parcelas; deixe Entrada e Número de parcelas em branco.`),
          );
        }
        if (kids.parcelas.length > 120) {
          const extra = kids.parcelas[120];
          push(rowError('parcelas', extra?.row ?? row.row, header('parcelas', 'ref'), 'too_many_installments', `A proposta "${ref}" tem ${kids.parcelas.length} parcelas; o limite é 120.`));
        }
        const rows: Array<{ n: number; item: Installment }> = [];
        for (const pr of kids.parcelas) {
          const c = cellReader('parcelas', pr);
          const dueDate = c.text('vencimento');
          const valor = c.number('valor');
          if (dueDate === null || valor === null) continue;
          if (valor === 0) {
            push(rowError('parcelas', pr.row, header('parcelas', 'valor'), 'zero_installment', `A parcela de ${dayBr(dueDate)} da proposta "${ref}" tem valor zero; remova a linha ou informe o valor.`));
          }
          rows.push({ n: pr.row, item: { dueDate, amountBrl: valor, method: asMethod(c.text('formaPagamento')) ?? method } });
        }
        rows.sort((a, b) => (a.item.dueDate < b.item.dueDate ? -1 : a.item.dueDate > b.item.dueDate ? 1 : a.n - b.n));
        installments = rows.map((x) => x.item);
        sources = { kind: 'parcelas', rows: rows.map((x) => x.n) };
        const clean = !kids.parcelas.some((x) => rowErrored('parcelas', x.row)) && rows.length === kids.parcelas.length;
        const sum = installments.reduce((s, i) => s + i.amountBrl, 0);
        if (clean && sum !== total) {
          push(
            rowError('parcelas', kids.parcelas[0]?.row ?? row.row, header('parcelas', 'valor'), 'installments_sum_mismatch', `As parcelas da proposta "${ref}" somam ${brl(sum)}, mas o total dos itens é ${brl(total)}.`),
          );
        }
      } else {
        const shape = productShape(primary, baseDate);
        if (entrada !== null) {
          shape.entradaMode = entrada > 0 ? 'fix' : 'none';
          shape.entradaValue = entrada;
        }
        if (count !== null) shape.restanteCount = count;
        if (entrada !== null && total > 0 && entrada > total) {
          push(rowError(P, row.row, h('entradaBrl'), 'entrada_exceeds_total', `A Entrada ${brl(entrada)} da proposta "${ref}" é maior que o total dos itens ${brl(total)}.`));
        } else if (count !== null && shape.entradaMode !== 'none' && count > 119) {
          push(rowError(P, row.row, h('numeroParcelas'), 'too_many_installments', `Com entrada, a proposta "${ref}" pode ter no máximo 119 parcelas além da entrada.`));
        } else if (total > 0) {
          installments = generatePlan(total, shape, method);
        }
      }
    }

    // 3.9 Recorrência
    let recurring: SaleDraft['recurring'] = null;
    const monthly = r.number('mensalidade');
    const start = r.text('inicioRecorrencia');
    const cycles = r.number('ciclosRecorrencia');
    const monthlyBrl = monthly !== null ? monthly : primary && primary.hasMonthly && primary.monthlyBrl > 0 ? primary.monthlyBrl : 0;
    if (monthlyBrl === 0) {
      if (start !== null || cycles !== null) {
        push(
          rowError(P, row.row, start !== null ? h('inicioRecorrencia') : h('ciclosRecorrencia'), 'recurrence_without_monthly', `A proposta "${ref}" tem Início ou Ciclos da recorrência, mas nenhuma mensalidade; preencha a Mensalidade (R$) ou deixe esses campos em branco.`),
        );
      }
    } else if (baseDate !== null) {
      recurring = {
        monthlyBrl,
        startDate: start ?? addMonths(baseDate, 1),
        cycles: cycles ?? primary?.defaultRecurringCycles ?? null,
        method,
      };
    }

    // 3.10 Professionals
    const professionals: SaleDraft['professionals'] = [];
    const proSources: Array<{ row: number }> = [];
    const costBasis = new Map<string, number>();
    for (const b of builtItems) {
      if (!b.product) continue;
      const subtotal = b.draft.quantity * b.draft.unitBrl;
      for (const cost of b.product.funcaoCosts) {
        const add = cost.mode === 'fix' ? Math.max(0, Math.floor(cost.valueBrl)) : Math.max(0, Math.floor((subtotal * cost.valuePct) / 100));
        costBasis.set(cost.funcaoKey, (costBasis.get(cost.funcaoKey) ?? 0) + add);
      }
    }
    const installmentCount = installments.filter((i) => i.amountBrl > 0).length;
    for (const pr of kids.profissionais) {
      const c = cellReader('profissionais', pr);
      const S = 'profissionais' as const;
      const funcaoName = c.text('funcao');
      const pessoaName = c.text('pessoa');
      const funcao = funcaoName !== null ? resolve('funcao', funcaoName, S, pr.row, header(S, 'funcao')) : null;
      const pessoa = pessoaName !== null ? resolve('person', pessoaName, S, pr.row, header(S, 'pessoa')) : null;
      const custoCell = c.number('custo');
      const costBrl = custoCell ?? (funcao ? costBasis.get(refKey(funcao.ref)) : undefined) ?? 0;
      let costSplitBp: number[] | null = null;
      const split = c.text('divisaoCusto');
      const who = pessoa?.label ?? pessoaName ?? 'profissional';
      if (split !== null) {
        const res = coercePctList(split);
        if (!res.ok) {
          push(rowError(S, pr.row, header(S, 'divisaoCusto'), res.code, res.message));
        } else if (res.value !== null) {
          const bp = res.value.map((p) => Math.round(p * 100));
          const sum = bp.reduce((s, x) => s + x, 0);
          if (sum !== 10000) {
            push(rowError(S, pr.row, header(S, 'divisaoCusto'), 'cost_split_sum_mismatch', `A divisão do custo de "${who}" soma ${String(sum / 100).replace('.', ',')}%; os percentuais precisam somar 100.`));
          } else if (installments.length > 0 && bp.length > Math.max(1, installmentCount)) {
            push(rowError(S, pr.row, header(S, 'divisaoCusto'), 'cost_split_too_many_parts', `A divisão do custo de "${who}" tem ${bp.length} partes, mas a proposta "${ref}" tem ${installmentCount} parcelas.`));
          } else {
            costSplitBp = bp;
          }
        }
      }
      if (pessoa && funcao && !refs.personHasFuncao(pessoa.ref, funcao.ref)) {
        issues.push(
          rowWarning(S, pr.row, header(S, 'pessoa'), 'person_lacks_funcao', `"${pessoa.label}" não tem a função ${funcao.label} no cadastro; a proposta registra a função, mas o cadastro da pessoa não é alterado.`),
        );
      }
      professionals.push({
        personRef: pessoa?.ref ?? null,
        funcaoRef: funcao?.ref ?? null,
        personName: pessoa?.label ?? '',
        costBrl,
        costSplitBp,
      });
      proSources.push({ row: pr.row });
    }

    // 3.11 Assemble and probe
    if (failed || baseDate === null || clientRef === null || seller === null || installments.length === 0) continue;
    const draft: SaleDraft = {
      clientRef,
      clientName,
      sellerRef: seller.ref,
      sellerName: seller.label,
      finderRef: finder?.ref ?? null,
      finderName: finder?.label ?? null,
      status,
      baseDate,
      notes,
      sellerCommissionPct,
      finderCommissionPct,
      taxPct,
      otherCostsBrl,
      items: builtItems.map((b) => b.draft),
      professionals,
      installments,
      recurring,
    };
    const probed = CreateSaleSchema.safeParse(probeInput(draft));
    if (!probed.success) {
      issues.push(
        ...mapSaleSchemaIssues(probed.error.issues, {
          propostaRow: row.row,
          ref,
          items: builtItems.map((b) => b.source),
          professionals: proSources,
          installments: sources,
        }),
      );
      continue;
    }
    operations.push({ op: 'createSale', planKey: planKeyOf(P, row.row), input: draft, wonOn });
    counts.propostas = (counts.propostas ?? 0) + 1;
    if (kids.itens.length > 0) counts.itens = (counts.itens ?? 0) + kids.itens.length;
    if (kids.profissionais.length > 0) counts.profissionais = (counts.profissionais ?? 0) + kids.profissionais.length;
    if (kids.parcelas.length > 0) counts.parcelas = (counts.parcelas ?? 0) + kids.parcelas.length;
  }

  return { operations, issues, counts };
}
