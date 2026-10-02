import type { ZodError } from 'zod';
import type { ImportCounts, ImportIssue, ImportOperation, SheetKey } from '../types.js';
import { getColumnDef } from '../workbook-schema.js';

/** A syntactically valid uuid used only to run the domain schemas before the real id exists. Never reaches an operation. */
export const PLACEHOLDER_UUID = '00000000-0000-4000-8000-000000000000';

export function planKeyOf(sheet: SheetKey, row: number): string {
  return `${sheet}:${row}`;
}

/** The pt-BR header text of a column. */
export function header(sheet: SheetKey, key: string): string {
  return getColumnDef(sheet, key).header;
}

export function rowError(
  sheet: SheetKey,
  row: number,
  column: string | null,
  code: string,
  message: string,
): ImportIssue {
  return { severity: 'error', sheet, row, column, code, message };
}

export function rowWarning(
  sheet: SheetKey,
  row: number,
  column: string | null,
  code: string,
  message: string,
): ImportIssue {
  return { severity: 'warning', sheet, row, column, code, message };
}

/** `${sheet}:${row}` for every ERROR issue with a row (parser and planner issues alike). */
export function erroredRowKeys(issues: readonly ImportIssue[]): Set<string> {
  const keys = new Set<string>();
  for (const issue of issues) {
    if (issue.severity === 'error' && issue.sheet !== null && issue.row !== null) {
      keys.add(planKeyOf(issue.sheet, issue.row));
    }
  }
  return keys;
}

/** Turns a failed ref lookup into a row error. */
export function lookupIssue(
  sheet: SheetKey,
  row: number,
  column: string,
  failure: { code: string; message: string },
): ImportIssue {
  return rowError(sheet, row, column, failure.code, failure.message);
}

/** Shallow copy without the given keys (lint has no ignoreRestSiblings, so no rest-destructuring). */
export function withoutKeys<T extends object, K extends keyof T>(value: T, keys: readonly K[]): Omit<T, K> {
  const copy: T = { ...value };
  for (const key of keys) delete copy[key];
  return copy as Omit<T, K>;
}

/** Operations emitted per sheet; a key is present only when its count is above zero. */
export function countOperations(
  operations: readonly ImportOperation[],
  sheetOf: (op: ImportOperation) => SheetKey | null,
): ImportCounts {
  const counts: ImportCounts = {};
  for (const op of operations) {
    const sheet = sheetOf(op);
    if (sheet === null) continue;
    counts[sheet] = (counts[sheet] ?? 0) + 1;
  }
  return counts;
}

/** Renders a list for messages: "A", "A e B", "A, B e C". */
export function joinPt(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} e ${items[items.length - 1]}`;
}

export type ZodIssueContext = {
  sheet: SheetKey;
  row: number;
  /** schema field (first path segment) -> header text */
  columns: Readonly<Record<string, string>>;
  /** header used when the path is empty or unmapped */
  fallbackColumn: string | null;
  /** the candidate object that was parsed, to quote values */
  values: Readonly<Record<string, unknown>>;
};

/**
 * Safety net: the parser already enforces lengths and kinds, so most of these are
 * unreachable from a template file, but every schema refusal still becomes a row
 * issue instead of a failure at commit.
 */
export function zodIssuesToImportIssues(error: ZodError, ctx: ZodIssueContext): ImportIssue[] {
  const out: ImportIssue[] = [];
  const seen = new Set<string>();
  for (const issue of error.issues) {
    const field = String(issue.path[0] ?? '');
    const column = ctx.columns[field] ?? ctx.fallbackColumn;
    const label = column ?? 'o campo';
    const value = String(ctx.values[field]);
    let message: string;
    switch (issue.code) {
      case 'too_big':
        message =
          issue.type === 'string'
            ? `O texto passa do limite de ${String(issue.maximum)} caracteres.`
            : `O valor passa do máximo permitido (${String(issue.maximum)}).`;
        break;
      case 'too_small':
        message =
          issue.type === 'string'
            ? column === null
              ? 'Preencha o campo.'
              : `Preencha a coluna "${column}".`
            : `O valor fica abaixo do mínimo permitido (${String(issue.minimum)}).`;
        break;
      case 'invalid_string':
        message =
          issue.validation === 'email'
            ? `"${value}" não é um e-mail válido.`
            : `"${value}" não está no formato esperado.`;
        break;
      case 'custom':
        if (issue.message === 'entrada_mode_value_mismatch') {
          message = 'Preencha a entrada padrão em percentual ou em valor, não nas duas colunas.';
        } else if (issue.message === 'duplicate_funcao_cost') {
          message = 'A mesma função aparece duas vezes nos custos deste produto.';
        } else if (issue.message === 'invalid_iso_day') {
          message = `"${value}" não é uma data válida.`;
        } else {
          message = `O valor da coluna "${label}" não é aceito.`;
        }
        break;
      default:
        message = `O valor da coluna "${label}" não é aceito.`;
    }
    const dedupe = `${column ?? ''}|${message}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    out.push(rowError(ctx.sheet, ctx.row, column, 'invalid_value', message));
  }
  return out;
}
