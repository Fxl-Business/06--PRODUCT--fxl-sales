import {
  SHEET_KEYS,
  SHEET_LABELS,
  type ImportCounts,
  type ImportIssue,
  type SheetKey,
} from './types';

export type IssueGroup = { sheet: SheetKey | null; label: string; issues: ImportIssue[] };
export type GroupedIssues = {
  errors: IssueGroup[];
  warnings: IssueGroup[];
  errorCount: number;
  warningCount: number;
};

function isKnownSheet(sheet: unknown): sheet is SheetKey {
  return (SHEET_KEYS as readonly unknown[]).includes(sheet);
}

function groupBySheet(issues: readonly ImportIssue[]): IssueGroup[] {
  const buckets = new Map<SheetKey | null, ImportIssue[]>();
  for (const issue of issues) {
    const key = isKnownSheet(issue.sheet) ? issue.sheet : null;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(issue);
    else buckets.set(key, [issue]);
  }
  const order: Array<SheetKey | null> = [null, ...SHEET_KEYS];
  const groups: IssueGroup[] = [];
  for (const sheet of order) {
    const bucket = buckets.get(sheet);
    if (!bucket) continue;
    const sorted = bucket
      .map((issue, index) => ({ issue, index }))
      .sort((a, b) => {
        const ra = a.issue.row ?? -1;
        const rb = b.issue.row ?? -1;
        return ra - rb || a.index - b.index;
      })
      .map((entry) => entry.issue);
    groups.push({ sheet, label: sheet === null ? 'Arquivo' : SHEET_LABELS[sheet], issues: sorted });
  }
  return groups;
}

export function groupImportIssues(issues: readonly ImportIssue[]): GroupedIssues {
  const errors = issues.filter((issue) => issue.severity === 'error');
  const warnings = issues.filter((issue) => issue.severity !== 'error');
  return {
    errors: groupBySheet(errors),
    warnings: groupBySheet(warnings),
    errorCount: errors.length,
    warningCount: warnings.length,
  };
}

export function issueLocation(issue: ImportIssue): string {
  const parts = [issue.row !== null ? `Linha ${issue.row}` : null, issue.column].filter(
    (part): part is string => part !== null && part !== '',
  );
  if (parts.length > 0) return parts.join(' · ');
  return issue.sheet !== null ? 'Aba inteira' : 'Arquivo inteiro';
}

export function nonZeroCounts(
  counts: ImportCounts,
): Array<{ sheet: SheetKey; label: string; count: number }> {
  const rows: Array<{ sheet: SheetKey; label: string; count: number }> = [];
  for (const sheet of SHEET_KEYS) {
    const count = counts[sheet];
    if (typeof count === 'number' && Number.isFinite(count) && count > 0) {
      rows.push({ sheet, label: SHEET_LABELS[sheet], count });
    }
  }
  return rows;
}

export function totalCount(counts: ImportCounts): number {
  return nonZeroCounts(counts).reduce((sum, row) => sum + row.count, 0);
}

/** Clientes rows the server recognized as existing clientes; absent, zero or invalid reads as 0. */
export function recognizedClientCount(body: { recognized?: ImportCounts }): number {
  const count = body.recognized?.clientes;
  return typeof count === 'number' && Number.isFinite(count) && count > 0 ? count : 0;
}
