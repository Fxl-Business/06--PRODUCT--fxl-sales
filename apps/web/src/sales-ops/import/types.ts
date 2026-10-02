/**
 * Hand mirror of apps/api/src/domains/import/types.ts (slice 01) wire shapes. The web
 * never imports from apps/api. Keep SHEET_KEYS in the SEAM-CONTRACT sheet order.
 */
export const SHEET_KEYS = [
  'areas',
  'funcoes',
  'produtos',
  'custosProduto',
  'pessoas',
  'clientes',
  'etapas',
  'leads',
  'propostas',
  'itens',
  'profissionais',
  'parcelas',
  'pagamentos',
] as const;
export type SheetKey = (typeof SHEET_KEYS)[number];

export const SHEET_LABELS: Record<SheetKey, string> = {
  areas: 'Áreas',
  funcoes: 'Funções',
  produtos: 'Produtos',
  custosProduto: 'Custos por produto',
  pessoas: 'Pessoas',
  clientes: 'Clientes',
  etapas: 'Etapas',
  leads: 'Leads',
  propostas: 'Propostas',
  itens: 'Itens da proposta',
  profissionais: 'Profissionais da proposta',
  parcelas: 'Parcelas',
  pagamentos: 'Pagamentos',
};

export type ImportIssueSeverity = 'error' | 'warning';
export type ImportIssue = {
  severity: ImportIssueSeverity;
  sheet: SheetKey | null;
  row: number | null;
  column: string | null;
  code: string;
  message: string;
};
export type ImportCounts = Partial<Record<SheetKey, number | undefined>>;
export type ImportPreviewBody = {
  ok: boolean;
  counts: ImportCounts;
  issues: ImportIssue[];
  truncated: boolean;
};
export type ImportCommitBody = { counts: ImportCounts };

/** D9 mirror: the server refuses above this with 413; the screen refuses before uploading. */
export const MAX_IMPORT_UPLOAD_BYTES = 5 * 1024 * 1024;
export const MAX_RETURNED_ISSUES = 500;

export const IMPORT_TEMPLATE_FILENAME = 'fxl-sales-importacao.xlsx';
export const IMPORT_EXAMPLE_FILENAME = 'fxl-sales-importacao-exemplo.xlsx';
export const XLSX_ACCEPT =
  '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Structural guard for the 422 body of POST /commit. */
export function isImportPreviewBody(value: unknown): value is ImportPreviewBody {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.ok === 'boolean' &&
    typeof v.truncated === 'boolean' &&
    Array.isArray(v.issues) &&
    typeof v.counts === 'object' &&
    v.counts !== null
  );
}
