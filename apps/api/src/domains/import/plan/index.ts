import { buildRefIndex } from '../refs.js';
import type {
  ImportCatalog,
  ImportCounts,
  ImportIssue,
  ImportPlan,
  ImportPreviewBody,
  ParsedWorkbook,
  SheetKey,
} from '../types.js';
import { MAX_RETURNED_ISSUES, SHEET_KEYS } from '../workbook-schema.js';
import { planCadastros } from './cadastros.js';
import { planDesfechos } from './desfechos.js';
import { planLeads } from './leads.js';
import { planPropostas } from './propostas.js';

/** Pure: no I/O, no clock, no env. The four sheet planners run in contract order over one ref index. */
export function planImport(parsed: ParsedWorkbook, catalog: ImportCatalog): ImportPlan {
  const refs = buildRefIndex(parsed, catalog);
  const cadastros = planCadastros(parsed, catalog, refs);
  const leads = planLeads(parsed, catalog, refs);
  const propostas = planPropostas(parsed, catalog, refs);
  const desfechos = planDesfechos(parsed, catalog, refs, propostas);
  return {
    operations: [...cadastros.operations, ...leads.operations, ...propostas.operations, ...desfechos.operations],
    issues: sortIssues([
      ...parsed.issues,
      ...cadastros.issues,
      ...leads.issues,
      ...propostas.issues,
      ...desfechos.issues,
    ]),
    counts: mergeCounts(cadastros.counts, leads.counts, propostas.counts, desfechos.counts),
    recognized: mergeCounts(...[cadastros, leads, propostas, desfechos].map((part) => part.recognized ?? {})),
  };
}

const SEVERITY_RANK: Record<ImportIssue['severity'], number> = { error: 0, warning: 1 };

/** Errors first; inside a severity file-level, then sheet order, then row (null first). */
export function compareIssues(a: ImportIssue, b: ImportIssue): number {
  const sheetRank = (sheet: SheetKey | null): number => (sheet === null ? -1 : SHEET_KEYS.indexOf(sheet));
  const rowRank = (row: number | null): number => (row === null ? -1 : row);
  return (
    SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
    sheetRank(a.sheet) - sheetRank(b.sheet) ||
    rowRank(a.row) - rowRank(b.row)
  );
}

/** Stable: ties keep the planner order (column order inside a row). */
export function sortIssues(issues: readonly ImportIssue[]): ImportIssue[] {
  return [...issues].sort(compareIssues);
}

export function mergeCounts(...parts: readonly ImportCounts[]): ImportCounts {
  const result: ImportCounts = {};
  for (const part of parts) {
    // Object.entries widens the keys to string; they are SheetKeys by construction.
    for (const [key, n] of Object.entries(part) as Array<[SheetKey, number | undefined]>) {
      if (typeof n === 'number') result[key] = (result[key] ?? 0) + n;
    }
  }
  return result;
}

export function isPlanOk(plan: Pick<ImportPlan, 'issues'>): boolean {
  return !plan.issues.some((i) => i.severity === 'error');
}

/** The one place the issue list is truncated; `ok` comes from the FULL list. */
export function toPreviewBody(plan: ImportPlan): ImportPreviewBody {
  return {
    ok: isPlanOk(plan),
    counts: plan.counts,
    recognized: plan.recognized,
    issues: plan.issues.slice(0, MAX_RETURNED_ISSUES),
    truncated: plan.issues.length > MAX_RETURNED_ISSUES,
  };
}
