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
export type ImportStageResolution =
  | { kind: 'existing'; stageId: string | null }
  | { kind: 'not_found' }
  | { kind: 'conversion' };
/** One distinct name of the Etapa column of the Leads tab. */
export type ImportLeadStage = { name: string; leads: number; resolution: ImportStageResolution };
/** An etapa a lead may be sent to (active, default pipeline, never the conversion one). */
export type ImportStageTarget = { id: string; name: string; kind: 'normal' | 'lost' };
/** Where the leads of one spreadsheet etapa name go (the multipart `stageMap` value, by sheet name). */
export type StageMapEntry = { stageId: string } | { create: true } | { first: true };
export type StageMap = Record<string, StageMapEntry>;

export type ImportPreviewBody = {
  ok: boolean;
  counts: ImportCounts;
  /**
   * Rows the server recognized as existing records and will not create (today only
   * `clientes`). Optional on purpose: an API deployed before it answers without the
   * key, which reads as zero.
   */
  recognized?: ImportCounts;
  issues: ImportIssue[];
  truncated: boolean;
  /** Optional on purpose: the commit's 422 body and an older API answer without them. */
  leadStages?: ImportLeadStage[];
  stageTargets?: ImportStageTarget[];
};
export type ImportCommitBody = { counts: ImportCounts; recognized?: ImportCounts };

/** D9 mirror: the server refuses above this with 413; the screen refuses before uploading. */
export const MAX_IMPORT_UPLOAD_BYTES = 5 * 1024 * 1024;
export const MAX_RETURNED_ISSUES = 500;

export const IMPORT_TEMPLATE_FILENAME = 'fxl-vendas-importacao.xlsx';
export const IMPORT_EXAMPLE_FILENAME = 'fxl-vendas-importacao-exemplo.xlsx';
export const IMPORT_EXPORT_FILENAME = 'fxl-leads-exportacao.xlsx';
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

/**
 * Reads `leadStages` defensively: the API answers `{ name, leads, resolution: { kind, stageId } }`, and a
 * flat `{ count, resolution: 'existing', stageId }` row is read the same way. Malformed rows are dropped.
 */
export function readLeadStages(preview: ImportPreviewBody | null): ImportLeadStage[] {
  const raw: unknown = preview?.leadStages;
  if (!Array.isArray(raw)) return [];
  const out: ImportLeadStage[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const r = item as Record<string, unknown>;
    if (typeof r.name !== 'string') continue;
    const leads = typeof r.leads === 'number' ? r.leads : typeof r.count === 'number' ? r.count : 0;
    const res = r.resolution;
    const flat = typeof res === 'string' ? { kind: res, stageId: r.stageId } : res;
    const kind =
      typeof flat === 'object' && flat !== null ? (flat as Record<string, unknown>).kind : undefined;
    const stageId =
      typeof flat === 'object' && flat !== null
        ? (flat as Record<string, unknown>).stageId
        : undefined;
    const resolution: ImportStageResolution =
      kind === 'existing'
        ? { kind, stageId: typeof stageId === 'string' ? stageId : null }
        : kind === 'conversion'
          ? { kind }
          : { kind: 'not_found' };
    out.push({ name: r.name, leads, resolution });
  }
  return out;
}
