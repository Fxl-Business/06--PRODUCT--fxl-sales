/**
 * Leads sheet planner. Pure and deterministic: no I/O, no clock, no env, no database.
 * A lead never creates a cliente; the executor runs createLead and then moveLead.
 */
import { CreateLeadSchema } from '../../sales-ops/leads/lead-schemas.js';
import { normalizeLabel } from '../cells.js';
import { cellReader } from '../parse.js';
import type { ImportRefIndex } from '../refs.js';
import type {
  EntityRef,
  ImportCatalog,
  ImportIssue,
  ImportOperation,
  ParsedWorkbook,
  SheetPlanResult,
} from '../types.js';
import {
  PLACEHOLDER_UUID,
  erroredRowKeys,
  header,
  lookupIssue,
  planKeyOf,
  rowError,
  rowWarning,
  zodIssuesToImportIssues,
} from './plan-helpers.js';

const SHEET = 'leads' as const;
const MAX_PRODUCT_NAME = 140;

type StageKind = 'normal' | 'conversion' | 'lost';
type LeadProduct = { productRef: EntityRef | null; name: string };

const FIELD_COLUMNS = {
  contactName: header(SHEET, 'contato'),
  clientName: header(SHEET, 'empresa'),
  clientId: header(SHEET, 'empresa'),
  estimatedValueBrl: header(SHEET, 'valorEstimado'),
  description: header(SHEET, 'descricao'),
  sellerPersonId: header(SHEET, 'vendedor'),
  products: header(SHEET, 'produtos'),
} as const;

function sameEntity(a: EntityRef, b: EntityRef): boolean {
  if ('existingId' in a) return 'existingId' in b && a.existingId === b.existingId;
  return 'planKey' in b && a.planKey === b.planKey;
}

/** createLeadStage only mints normal stages, so a workbook etapa is always normal. */
function stageKind(ref: EntityRef, catalog: ImportCatalog): StageKind {
  if ('planKey' in ref) return 'normal';
  const stage = catalog.stages.find((s) => s.id === ref.existingId);
  if (!stage) throw new Error('planLeads: ref to unknown stage');
  return stage.kind;
}

function hasOpenStage(parsed: ParsedWorkbook, catalog: ImportCatalog): boolean {
  return (
    catalog.stages.some((s) => s.status === 'active' && s.kind === 'normal') ||
    parsed.sheets.etapas.rows.some((r) => cellReader('etapas', r).text('nome') !== null)
  );
}

export function planLeads(parsed: ParsedWorkbook, catalog: ImportCatalog, refs: ImportRefIndex): SheetPlanResult {
  const rows = parsed.sheets.leads.rows;
  if (rows.length === 0) return { operations: [], issues: [], counts: {} };

  const issues: ImportIssue[] = [];
  const operations: ImportOperation[] = [];
  const blocked = erroredRowKeys(parsed.issues);
  const seen = new Map<string, number>();

  if (!hasOpenStage(parsed, catalog)) {
    issues.push({
      severity: 'error',
      sheet: SHEET,
      row: null,
      column: null,
      code: 'no_open_stage',
      message:
        'O funil de leads não tem nenhuma etapa ativa para receber leads; crie uma etapa na aba Etapas ou em Cadastros > Etapas.',
    });
  }

  for (const row of rows) {
    const c = cellReader(SHEET, row);
    const rowIssues: ImportIssue[] = [];
    const contato = c.text('contato');
    const empresa = c.text('empresa');

    // Empresa: a lead never creates a cliente, an unmatched name stays free text.
    let clientRef: EntityRef | null = null;
    if (empresa !== null) {
      const l = refs.resolve('client', empresa);
      if (l.ok) clientRef = l.ref;
      else if (l.code === 'ambiguous_ref') {
        rowIssues.push(
          rowWarning(
            SHEET,
            row.row,
            header(SHEET, 'empresa'),
            'ambiguous_client',
            `Há mais de um cliente chamado "${empresa}"; o lead fica com o nome como texto, sem ligação a um cadastro.`,
          ),
        );
      } else if (l.code === 'archived_ref') {
        rowIssues.push(lookupIssue(SHEET, row.row, header(SHEET, 'empresa'), l));
      }
    }

    const estimated = c.number('valorEstimado') ?? 0;
    const description = c.text('descricao');

    // Vendedor
    let sellerRef: EntityRef | null = null;
    const vendedor = c.text('vendedor');
    if (vendedor !== null) {
      const l = refs.resolvePersonWithFuncao(vendedor, 'vendedor');
      if (l.ok) sellerRef = l.ref;
      else if (l.code === 'missing_funcao') {
        rowIssues.push(
          rowError(
            SHEET,
            row.row,
            header(SHEET, 'vendedor'),
            'seller_not_a_vendedor',
            `"${vendedor}" não tem a função Vendedor; só uma pessoa com essa função pode ser o vendedor de um lead.`,
          ),
        );
      } else {
        rowIssues.push(lookupIssue(SHEET, row.row, header(SHEET, 'vendedor'), l));
      }
    }

    // Produtos
    const products: LeadProduct[] = [];
    for (const name of c.list('produtos') ?? []) {
      const col = header(SHEET, 'produtos');
      const l = refs.resolve('product', name);
      if (l.ok) {
        const first = products.find((p) => p.productRef !== null && sameEntity(p.productRef, l.ref));
        if (first) {
          rowIssues.push(
            rowWarning(
              SHEET,
              row.row,
              col,
              'duplicate_product',
              `"${name}" é o mesmo produto de "${first.name}"; o lead fica com ele uma vez só.`,
            ),
          );
        } else products.push({ productRef: l.ref, name });
      } else if (l.code === 'unknown_ref' && !/^#\d+$/.test(name.trim())) {
        const length = [...name].length;
        if (length > MAX_PRODUCT_NAME) {
          rowIssues.push(
            rowError(
              SHEET,
              row.row,
              col,
              'too_long',
              `O produto "${name}" tem ${length} caracteres; o limite é ${MAX_PRODUCT_NAME}.`,
            ),
          );
        } else products.push({ productRef: null, name });
      } else {
        rowIssues.push(lookupIssue(SHEET, row.row, col, l));
      }
    }

    // Etapa and Motivo da perda
    const etapa = c.text('etapa');
    const motivo = c.text('motivoPerda');
    let stageRef: EntityRef | null = null;
    let kind: StageKind | null = null;
    let etapaFailed = false;
    if (etapa !== null) {
      const l = refs.resolve('stage', etapa);
      if (!l.ok) {
        etapaFailed = true;
        rowIssues.push(lookupIssue(SHEET, row.row, header(SHEET, 'etapa'), l));
      } else {
        kind = stageKind(l.ref, catalog);
        if (kind === 'conversion') {
          rowIssues.push(
            rowError(
              SHEET,
              row.row,
              header(SHEET, 'etapa'),
              'conversion_stage',
              `A etapa "${etapa}" é a de conversão; um lead só chega nela quando vira proposta dentro do Sales. Escolha outra etapa.`,
            ),
          );
        } else stageRef = l.ref;
      }
    }
    const motivoCol = header(SHEET, 'motivoPerda');
    if (kind === 'lost' && motivo === null) {
      rowIssues.push(
        rowError(
          SHEET,
          row.row,
          motivoCol,
          'lost_reason_required',
          `Preencha o motivo da perda, porque a etapa "${etapa ?? ''}" é a de leads perdidos.`,
        ),
      );
    } else if (kind !== 'lost' && motivo !== null && !etapaFailed) {
      rowIssues.push(
        rowWarning(
          SHEET,
          row.row,
          motivoCol,
          'lost_reason_ignored',
          'O motivo da perda só vale na etapa de leads perdidos e será ignorado nesta linha.',
        ),
      );
    }
    const lostReason = kind === 'lost' ? motivo : null;

    // Duplicate inside the workbook
    if (contato !== null && empresa !== null) {
      const key = `${normalizeLabel(contato)}|${normalizeLabel(empresa)}`;
      const first = seen.get(key);
      if (first === undefined) seen.set(key, row.row);
      else {
        rowIssues.push(
          rowWarning(
            SHEET,
            row.row,
            header(SHEET, 'contato'),
            'possible_duplicate',
            `O lead de "${contato}" na empresa "${empresa}" repete a linha ${first} desta aba; confira se não é o mesmo lead.`,
          ),
        );
      }
    }

    // Schema backstop (placeholder ids stand in for refs the executor resolves later)
    let data: ReturnType<typeof CreateLeadSchema.parse> | null = null;
    if (contato !== null && empresa !== null && !rowIssues.some((i) => i.severity === 'error')) {
      const candidate = {
        contactName: contato,
        clientName: empresa,
        clientId: clientRef ? PLACEHOLDER_UUID : null,
        estimatedValueBrl: estimated,
        description,
        sellerPersonId: sellerRef ? PLACEHOLDER_UUID : null,
        products: products.map((p) => (p.productRef ? { productId: PLACEHOLDER_UUID } : { productName: p.name })),
      };
      const res = CreateLeadSchema.safeParse(candidate);
      if (res.success) data = res.data;
      else {
        rowIssues.push(
          ...zodIssuesToImportIssues(res.error, {
            sheet: SHEET,
            row: row.row,
            columns: FIELD_COLUMNS,
            fallbackColumn: null,
            values: candidate,
          }),
        );
      }
    }

    issues.push(...rowIssues);

    if (data && !blocked.has(planKeyOf(SHEET, row.row)) && !rowIssues.some((i) => i.severity === 'error')) {
      operations.push({
        op: 'createLead',
        planKey: planKeyOf(SHEET, row.row),
        input: {
          contactName: data.contactName,
          clientName: data.clientName,
          estimatedValueBrl: data.estimatedValueBrl,
          description: data.description ?? null,
        },
        clientRef,
        sellerRef,
        products,
        stageRef,
        lostReason,
      });
    }
  }

  return { operations, issues, counts: operations.length > 0 ? { leads: operations.length } : {} };
}
