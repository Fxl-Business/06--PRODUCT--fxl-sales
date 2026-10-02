/*
 * Handoff notes for the planners (slices 02-05):
 * - A null in a REQUIRED column means the parser already reported it (`required`,
 *   `missing_column` or a coercion error). Treat it as "skip this row silently".
 * - A null bool means "not given"; apply the default (false unless the column help says otherwise).
 * - Money cells are CENTS. Product commission (R$) columns are divided by 100 into the REAIS
 *   number ProductSchema stores for `fix`; funcao cost (R$) and every other money stay cents.
 * - propostas.ciclosRecorrencia blank means "product default"; produtos.ciclosRecorrencia blank
 *   means indefinite (null).
 * - divisaoCusto is text; parse it with coercePctList.
 * - Read cells only through cellReader(sheet, row): a typo in a key is a compile error.
 */
import ExcelJS from 'exceljs';
import {
  LEIAME_TAB,
  LISTAS_TAB,
  MAX_TOTAL_ROWS,
  SHEET_KEYS,
  WORKBOOK_SHEETS,
  type ColumnDef,
  type ColumnKey,
  type SheetDef,
} from './workbook-schema.js';
import {
  coerceCell,
  displayRaw,
  isBlankRaw,
  normalizeLabel,
  type CellIssueCode,
  type RawCell,
  type RawScalar,
} from './cells.js';
import type { ImportIssue, ParsedRow, ParsedSheet, ParsedWorkbook, SheetKey } from './types.js';

export type ParseIssueCode =
  | 'invalid_file'
  | 'no_known_sheets'
  | 'unknown_sheet'
  | 'duplicate_sheet'
  | 'too_many_rows'
  | 'missing_column'
  | 'unknown_column'
  | 'duplicate_column'
  | 'required'
  | CellIssueCode;

export const INVALID_FILE_CODE = 'invalid_file';

export function emptyParsedWorkbook(): ParsedWorkbook {
  const sheets = {} as Record<SheetKey, ParsedSheet>;
  for (const key of SHEET_KEYS) sheets[key] = { key, rows: [] };
  return { sheets, issues: [] };
}

function unwrap(v: unknown): { value: RawScalar; problem: RawCell['problem'] } {
  if (v === null || v === undefined) return { value: null, problem: null };
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
    return { value: v, problem: null };
  }
  if (v instanceof Date) return { value: v, problem: null };
  if (typeof v === 'object') {
    if ('richText' in v && Array.isArray(v.richText)) {
      const text = v.richText
        .map((part: unknown) =>
          typeof part === 'object' && part !== null && 'text' in part && typeof part.text === 'string'
            ? part.text
            : '',
        )
        .join('');
      return { value: text, problem: null };
    }
    if ('error' in v) return { value: String(v.error), problem: 'cell_error' };
    if ('formula' in v || 'sharedFormula' in v) {
      if ('result' in v && v.result !== undefined) return unwrap(v.result);
      return { value: null, problem: 'formula_without_result' };
    }
    if ('text' in v) return unwrap(v.text);
  }
  return { value: null, problem: 'cell_error' };
}

export function readRawCell(cell: ExcelJS.Cell): RawCell {
  const percent = typeof cell.numFmt === 'string' && cell.numFmt.includes('%');
  const { value, problem } = unwrap(cell.value);
  return { value, percent, problem };
}

function invalidFile(parsed: ParsedWorkbook): ParsedWorkbook {
  parsed.issues.push({
    severity: 'error',
    sheet: null,
    row: null,
    column: null,
    code: INVALID_FILE_CODE,
    message: 'O arquivo não é uma planilha .xlsx válida.',
  });
  return parsed;
}

type MatchedSheet = { def: SheetDef; ws: ExcelJS.Worksheet; tabName: string };
type SheetScan = {
  matched: MatchedSheet;
  columns: Map<string, number>;
  headerIssues: ImportIssue[];
  dataRows: ExcelJS.Row[];
};

function issue(
  severity: ImportIssue['severity'],
  sheet: SheetKey | null,
  row: number | null,
  column: string | null,
  code: ParseIssueCode,
  message: string,
): ImportIssue {
  return { severity, sheet, row, column, code, message };
}

function scanSheet(matched: MatchedSheet): SheetScan {
  const { def, ws } = matched;
  const columns = new Map<string, number>();
  const headerIssues: ImportIssue[] = [];
  ws.getRow(1).eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const text = displayRaw(readRawCell(cell)).trim();
    if (text === '') return;
    const hit = def.columns.find((c) => normalizeLabel(c.header) === normalizeLabel(text));
    if (!hit) {
      headerIssues.push(
        issue('warning', def.key, 1, text, 'unknown_column', `A coluna "${text}" não faz parte da aba e foi ignorada.`),
      );
    } else if (columns.has(hit.key)) {
      headerIssues.push(
        issue('error', def.key, 1, hit.header, 'duplicate_column', `A coluna "${hit.header}" aparece mais de uma vez.`),
      );
    } else {
      columns.set(hit.key, colNumber);
    }
  });
  const dataRows: ExcelJS.Row[] = [];
  ws.eachRow({ includeEmpty: false }, (row, n) => {
    if (n < 2) return;
    let blank = true;
    row.eachCell({ includeEmpty: false }, (cell) => {
      if (blank && !isBlankRaw(readRawCell(cell))) blank = false;
    });
    if (!blank) dataRows.push(row);
  });
  return { matched, columns, headerIssues, dataRows };
}

function coerceRow(def: SheetDef, columns: Map<string, number>, row: ExcelJS.Row, issues: ImportIssue[]): ParsedRow {
  const cells: ParsedRow['cells'] = {};
  for (const col of def.columns) {
    const colNumber = columns.get(col.key);
    if (colNumber === undefined) {
      cells[col.key] = null;
      continue;
    }
    const res = coerceCell(col.kind, readRawCell(row.getCell(colNumber)));
    if (!res.ok) {
      issues.push(issue('error', def.key, row.number, col.header, res.code, res.message));
      cells[col.key] = null;
    } else if (res.value === null && col.required) {
      issues.push(issue('error', def.key, row.number, col.header, 'required', `Preencha a coluna "${col.header}".`));
      cells[col.key] = null;
    } else {
      cells[col.key] = res.value;
    }
  }
  return { row: row.number, cells };
}

export async function parseWorkbook(input: Buffer | Uint8Array): Promise<ParsedWorkbook> {
  const parsed = emptyParsedWorkbook();
  if (input.byteLength === 0) return invalidFile(parsed);

  const ab = new ArrayBuffer(input.byteLength);
  new Uint8Array(ab).set(input);
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(ab);
  } catch {
    return invalidFile(parsed);
  }

  try {
    return await readLoaded(workbook, parsed);
  } catch {
    return invalidFile(emptyParsedWorkbook());
  }
}

async function readLoaded(workbook: ExcelJS.Workbook, parsed: ParsedWorkbook): Promise<ParsedWorkbook> {
  const fileIssues: ImportIssue[] = [];
  const skipTabs = new Set([normalizeLabel(LEIAME_TAB), normalizeLabel(LISTAS_TAB)]);
  const matchedByKey = new Map<SheetKey, MatchedSheet>();
  for (const ws of workbook.worksheets) {
    const n = normalizeLabel(ws.name);
    if (skipTabs.has(n)) continue;
    const def = WORKBOOK_SHEETS.find((s) => normalizeLabel(s.tab) === n);
    if (!def) {
      fileIssues.push(
        issue('warning', null, null, null, 'unknown_sheet', `A aba "${ws.name}" não faz parte do modelo e foi ignorada.`),
      );
      continue;
    }
    const first = matchedByKey.get(def.key);
    if (first) {
      fileIssues.push(
        issue('error', def.key, null, null, 'duplicate_sheet', `As abas "${first.tabName}" e "${ws.name}" são a mesma aba do modelo; deixe só uma.`),
      );
      continue;
    }
    matchedByKey.set(def.key, { def, ws, tabName: ws.name });
  }
  if (matchedByKey.size === 0) {
    fileIssues.push(
      issue('error', null, null, null, 'no_known_sheets', 'A planilha não tem nenhuma aba do modelo de importação; baixe o modelo e preencha as abas.'),
    );
    parsed.issues = fileIssues;
    return parsed;
  }

  const scans: SheetScan[] = [];
  for (const def of WORKBOOK_SHEETS) {
    const matched = matchedByKey.get(def.key);
    if (matched) scans.push(scanSheet(matched));
  }
  const nonEmpty = scans.filter((s) => s.dataRows.length > 0);

  const total = nonEmpty.reduce((sum, s) => sum + s.dataRows.length, 0);
  if (total > MAX_TOTAL_ROWS) {
    fileIssues.push(
      issue('error', null, null, null, 'too_many_rows', `A planilha tem ${total} linhas preenchidas; o limite é 5000 por importação.`),
    );
    parsed.issues = fileIssues;
    return parsed;
  }

  const issues: ImportIssue[] = [...fileIssues];
  for (const scan of nonEmpty) {
    const { def } = scan.matched;
    if (scan.dataRows.length > def.maxRows) {
      issues.push(...scan.headerIssues);
      issues.push(
        issue('error', def.key, null, null, 'too_many_rows', `A aba "${def.tab}" tem ${scan.dataRows.length} linhas; o limite é ${def.maxRows}.`),
      );
      continue;
    }
    issues.push(...scan.headerIssues);
    for (const col of def.columns as readonly ColumnDef[]) {
      if (col.required && !scan.columns.has(col.key)) {
        issues.push(issue('error', def.key, 1, col.header, 'missing_column', `Falta a coluna obrigatória "${col.header}".`));
      }
    }
    const rows = scan.dataRows.map((row) => coerceRow(def, scan.columns, row, issues));
    parsed.sheets[def.key] = { key: def.key, rows };
  }
  parsed.issues = issues;
  return parsed;
}

type CellTypeName = 'string' | 'number' | 'boolean';

export function cellReader<K extends SheetKey>(
  sheet: K,
  row: ParsedRow,
): {
  text(key: ColumnKey<K>): string | null;
  number(key: ColumnKey<K>): number | null;
  bool(key: ColumnKey<K>): boolean | null;
  list(key: ColumnKey<K>): string[] | null;
} {
  const mismatch = (key: string, type: string): never => {
    throw new TypeError(`cell ${sheet}.${key} is not ${type}`);
  };
  const scalar = (key: string, type: CellTypeName, label: string) => {
    const v = row.cells[key];
    if (v === undefined || v === null) return null;
    if (typeof v !== type) return mismatch(key, label);
    return v;
  };
  return {
    text: (key) => scalar(key, 'string', 'text') as string | null,
    number: (key) => scalar(key, 'number', 'a number') as number | null,
    bool: (key) => scalar(key, 'boolean', 'a boolean') as boolean | null,
    list: (key) => {
      const v = row.cells[key];
      if (v === undefined || v === null) return null;
      if (!Array.isArray(v)) return mismatch(key, 'a list');
      return v;
    },
  };
}
