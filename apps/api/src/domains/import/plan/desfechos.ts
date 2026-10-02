import { normalizeLabel } from '../cells.js';
import { cellReader } from '../parse.js';
import type { ImportRefIndex } from '../refs.js';
import type {
  ImportCatalog,
  ImportCounts,
  ImportIssue,
  ImportOperation,
  ParsedRow,
  ParsedWorkbook,
  SaleDraft,
  SheetKey,
  SheetPlanResult,
} from '../types.js';
import { SALE_STATUS_OPTIONS } from '../workbook-schema.js';
import { header, rowError, rowWarning } from './plan-helpers.js';

export type DesfechoIssueCode =
  | 'won_date_required'
  | 'won_date_in_future'
  | 'won_date_ignored'
  | 'producer_flow_live'
  | 'unknown_proposta_ref'
  | 'proposta_not_won'
  | 'unknown_parcela'
  | 'duplicate_payment'
  | 'payment_in_future';

type SaleOp = Extract<ImportOperation, { op: 'createSale' }>;

/** The receivable labels createSale will write for this draft, in buildSaleLedger order. Pure mirror, proven by a parity test. */
export function plannedReceivableLabels(draft: Pick<SaleDraft, 'installments' | 'recurring'>): string[] {
  const kept = draft.installments.filter((row) => row.amountBrl > 0);
  const labels = kept.map((_, index) => `${index + 1}/${kept.length}`);
  const recurring = draft.recurring ?? null;
  if (recurring && recurring.cycles !== null) {
    for (let i = 0; i < recurring.cycles; i++) labels.push(`M${i + 1}/${recurring.cycles}`);
  }
  return labels;
}

/** How a typed Parcela is compared with a generated label: every whitespace removed, uppercased (`m 2/12` -> `M2/12`). */
export function canonicalParcelaLabel(text: string): string {
  return text.replace(/\s+/g, '').toUpperCase();
}

function dayBr(iso: string): string {
  const [year, month, day] = iso.split('-');
  return `${day}/${month}/${year}`;
}

function statusLabel(value: string | null): string {
  return SALE_STATUS_OPTIONS.find((option) => option.value === value)?.label ?? 'Aberta';
}

function hasCellIssue(parsed: ParsedWorkbook, sheet: SheetKey, row: number, column: string): boolean {
  return parsed.issues.some((i) => i.sheet === sheet && i.row === row && i.column === column);
}

const PRODUCER_WON_MESSAGE =
  'Esta organização está conectada ao FXL Finance, então propostas Ganhas não podem ser importadas: o histórico não chegaria ao Finance. Importe como Aberta e marque como ganha no app.';
const PRODUCER_PAYMENT_MESSAGE =
  'Esta organização está conectada ao FXL Finance, então o histórico de pagamentos não pode ser importado: as baixas não chegariam ao Finance. Registre os pagamentos no app.';

export function planDesfechos(
  parsed: ParsedWorkbook,
  catalog: ImportCatalog,
  _refs: ImportRefIndex,
  propostas: SheetPlanResult,
): SheetPlanResult {
  const transitions: ImportOperation[] = [];
  const settlements: ImportOperation[] = [];
  const issues: ImportIssue[] = [];

  // Step 1 - index the propostas.
  const saleOps = new Map<string, SaleOp>();
  for (const op of propostas.operations) {
    if (op.op === 'createSale') saleOps.set(op.planKey, op);
  }
  const refRows = new Map<string, ParsedRow[]>();
  for (const row of parsed.sheets.propostas.rows) {
    const ref = cellReader('propostas', row).text('ref');
    if (ref === null) continue;
    const key = normalizeLabel(ref);
    const list = refRows.get(key);
    if (list) list.push(row);
    else refRows.set(key, [row]);
  }

  // Step 2 - Propostas outcomes, in row order.
  for (const row of parsed.sheets.propostas.rows) {
    const r = cellReader('propostas', row);
    const status = r.text('situacao');
    const wonOn = r.text('dataGanho');
    const saleKey = `propostas:${row.row}`;
    const op = saleOps.get(saleKey);
    const wonColumn = header('propostas', 'dataGanho');

    if (status === 'won') {
      if (catalog.producerFlowLive) {
        issues.push(rowError('propostas', row.row, header('propostas', 'situacao'), 'producer_flow_live', PRODUCER_WON_MESSAGE));
        continue;
      }
      if (wonOn === null) {
        if (!hasCellIssue(parsed, 'propostas', row.row, wonColumn)) {
          issues.push(
            rowError('propostas', row.row, wonColumn, 'won_date_required', 'Preencha a Data de ganho: ela é obrigatória quando a situação é Ganha.'),
          );
        }
      } else if (wonOn > catalog.today) {
        issues.push(
          rowError(
            'propostas',
            row.row,
            wonColumn,
            'won_date_in_future',
            `A Data de ganho ${dayBr(wonOn)} está no futuro; use um dia até hoje (${dayBr(catalog.today)}).`,
          ),
        );
      }
      if (op && (op.input.status !== 'won' || op.wonOn !== wonOn)) {
        throw new Error(`planDesfechos seam: ${saleKey} must be createSale status won with wonOn = Data de ganho`);
      }
      continue;
    }

    if (wonOn !== null) {
      issues.push(
        rowWarning(
          'propostas',
          row.row,
          wonColumn,
          'won_date_ignored',
          `A Data de ganho ${dayBr(wonOn)} só vale para propostas Ganhas e foi ignorada.`,
        ),
      );
    }
    if ((status === 'lost' || status === 'cancelled') && op) {
      if (op.input.status !== 'open') {
        throw new Error(`planDesfechos seam: ${saleKey} must be createSale status open before its transition`);
      }
      transitions.push({ op: 'transitionSale', saleKey, to: status });
    }
  }

  // Step 3 - Pagamentos, in row order.
  const seen = new Map<string, number>();
  for (const row of parsed.sheets.pagamentos.rows) {
    const r = cellReader('pagamentos', row);
    const ref = r.text('ref');
    const parcela = r.text('parcela');
    const paidOn = r.text('dataPagamento');
    const settlePayables = r.bool('repassesPagos') === true;

    if (catalog.producerFlowLive) {
      issues.push(rowError('pagamentos', row.row, null, 'producer_flow_live', PRODUCER_PAYMENT_MESSAGE));
      continue;
    }
    if (ref === null) continue;
    const rows = refRows.get(normalizeLabel(ref));
    if (rows === undefined) {
      issues.push(
        rowError(
          'pagamentos',
          row.row,
          header('pagamentos', 'ref'),
          'unknown_proposta_ref',
          `O Ref "${ref}" não existe na aba Propostas; um pagamento só pode citar uma proposta desta planilha.`,
        ),
      );
      continue;
    }
    if (rows.length > 1) continue;
    const prow = rows[0];
    if (prow === undefined) continue;
    const pstatus = cellReader('propostas', prow).text('situacao');
    if (pstatus !== 'won') {
      issues.push(
        rowError(
          'pagamentos',
          row.row,
          header('pagamentos', 'ref'),
          'proposta_not_won',
          `A proposta "${ref}" está como ${statusLabel(pstatus)}; só propostas Ganhas podem ter pagamentos.`,
        ),
      );
      continue;
    }
    const op = saleOps.get(`propostas:${prow.row}`);
    if (op === undefined) continue;

    let clean = true;
    let match: string | undefined;
    if (parcela !== null) {
      const canonical = canonicalParcelaLabel(parcela);
      const labels = plannedReceivableLabels(op.input);
      match = labels.find((label) => label === canonical);
      if (match === undefined) {
        clean = false;
        const recurring = op.input.recurring ?? null;
        let message: string;
        if (canonical.startsWith('M') && recurring !== null && recurring.cycles === null) {
          message = `A recorrência da proposta "${ref}" é por prazo indeterminado e não gera mensalidades na importação, então a parcela "${parcela}" não existe.`;
        } else {
          const list = labels.slice(0, 12).join(', ') + (labels.length > 12 ? ` e mais ${labels.length - 12}` : '');
          message = `A proposta "${ref}" não tem a parcela "${parcela}"; as parcelas dela são ${list}.`;
        }
        issues.push(rowError('pagamentos', row.row, header('pagamentos', 'parcela'), 'unknown_parcela', message));
      } else {
        const key = `${normalizeLabel(ref)}|${match}`;
        const first = seen.get(key);
        if (first !== undefined) {
          clean = false;
          issues.push(
            rowError(
              'pagamentos',
              row.row,
              header('pagamentos', 'parcela'),
              'duplicate_payment',
              `A parcela "${match}" da proposta "${ref}" já foi paga na linha ${first}.`,
            ),
          );
        } else {
          seen.set(key, row.row);
        }
      }
    }
    if (paidOn !== null && paidOn > catalog.today) {
      clean = false;
      issues.push(
        rowError(
          'pagamentos',
          row.row,
          header('pagamentos', 'dataPagamento'),
          'payment_in_future',
          `A data do pagamento ${dayBr(paidOn)} está no futuro; use um dia até hoje (${dayBr(catalog.today)}).`,
        ),
      );
    }
    if (clean && match !== undefined && paidOn !== null) {
      settlements.push({ op: 'settleReceivable', saleKey: op.planKey, receivableLabel: match, paidOn, settlePayables });
    }
  }

  const counts: ImportCounts = settlements.length > 0 ? { pagamentos: settlements.length } : {};
  return { operations: [...transitions, ...settlements], issues, counts };
}
