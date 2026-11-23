// The read-only reference tab `Funis e etapas` and the helper columns of the dependent Etapa dropdown.
// Pure: it takes the catalog and returns rows; the writer only styles a worksheet it is handed.
import type ExcelJS from 'exceljs';
import { normalizeLabel } from './cells.js';
import type { ImportCatalog, ImportCatalogPipeline, ImportCatalogStage } from './types.js';

export const FUNIS_SHEET_HEADERS = [
  'Funil',
  'Etapa',
  'Tipo',
  'Aceita lead na importação',
  'Exige motivo da perda',
  'Funções com acesso',
] as const;

export const FUNIS_SHEET_WIDTHS = [28, 28, 18, 26, 26, 48] as const;

export const TIPO_LABEL = {
  normal: 'Em andamento',
  proposta: 'Proposta',
  ganho: 'Saída: Ganho',
  perdido: 'Saída: Perdido',
  pausado: 'Saída: Pausado',
} as const;

export const DEFAULT_FUNIL_ACCESS_NOTE = 'Quem não tem função ligada a nenhum funil';
export const ADMIN_ONLY_ACCESS_NOTE = 'Só administradores';

/** Ids of the two aligned helper columns of the hidden Listas tab behind the dependent Etapa dropdown. */
export const ETAPA_FUNIL_LIST_ID = 'etapaFunil';
export const ETAPA_DO_FUNIL_LIST_ID = 'etapaDoFunil';

export type FunisRow = {
  funil: string;
  etapa: string;
  tipo: string;
  aceitaLead: string;
  exigeMotivo: string;
  funcoes: string;
};

export function activePipelines(catalog: ImportCatalog): ImportCatalogPipeline[] {
  return catalog.pipelines.filter((p) => p.status === 'active');
}

/** True when a lead must say its Funil, because more than one active funil exists. */
export function hasSeveralFunis(catalog: ImportCatalog): boolean {
  return activePipelines(catalog).length > 1;
}

function stagesOf(catalog: ImportCatalog, pipelineId: string): ImportCatalogStage[] {
  return catalog.stages
    .filter((s) => s.pipelineId === pipelineId && s.status === 'active')
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, 'pt-BR'));
}

function tipoOf(stage: ImportCatalogStage): string {
  if (stage.kind === 'conversion') return TIPO_LABEL.proposta;
  if (stage.type === 'saida') {
    if (stage.exitKind === 'ganho') return TIPO_LABEL.ganho;
    if (stage.exitKind === 'perdido') return TIPO_LABEL.perdido;
    if (stage.exitKind === 'pausado') return TIPO_LABEL.pausado;
  }
  // An orcamento etapa while the orcamentos module is off projects as a normal one (kind is not conversion).
  return TIPO_LABEL.normal;
}

function acessoOf(catalog: ImportCatalog, pipeline: ImportCatalogPipeline): string {
  const byId = new Map(catalog.funcoes.map((f) => [f.id, f] as const));
  const names = pipeline.funcaoIds.flatMap((id) => {
    const funcao = byId.get(id);
    if (funcao === undefined) return [];
    return [funcao.status === 'archived' ? `${funcao.name} (arquivada)` : funcao.name];
  });
  if (pipeline.isDefault) return [...names, DEFAULT_FUNIL_ACCESS_NOTE].join('; ');
  return names.length === 0 ? ADMIN_ONLY_ACCESS_NOTE : names.join('; ');
}

/** One row per active etapa of each active funil, board order, the Funil repeated on every row. */
export function buildFunisRows(catalog: ImportCatalog): FunisRow[] {
  const rows: FunisRow[] = [];
  for (const pipeline of activePipelines(catalog)) {
    const funcoes = acessoOf(catalog, pipeline);
    for (const stage of stagesOf(catalog, pipeline.id)) {
      rows.push({
        funil: pipeline.name,
        etapa: stage.name,
        tipo: tipoOf(stage),
        aceitaLead: stage.kind === 'conversion' ? 'Não' : 'Sim',
        exigeMotivo: stage.kind === 'lost' ? 'Sim' : 'Não',
        funcoes,
      });
    }
  }
  return rows;
}

export type EtapaPairs = { funis: string[]; etapas: string[] };

/** Two aligned columns, one row per importable (not conversion) active etapa, contiguous per funil. */
export function buildEtapaPairs(catalog: ImportCatalog): EtapaPairs {
  const funis: string[] = [];
  const etapas: string[] = [];
  for (const pipeline of activePipelines(catalog)) {
    const seen = new Set<string>();
    for (const stage of stagesOf(catalog, pipeline.id)) {
      if (stage.kind === 'conversion') continue;
      const key = normalizeLabel(stage.name);
      if (seen.has(key)) continue;
      seen.add(key);
      funis.push(pipeline.name);
      etapas.push(stage.name);
    }
  }
  return { funis, etapas };
}

/**
 * The list formula of the Leads Etapa cell: the etapas of the row's funil, read from the two aligned helper
 * columns. It matches the funil with `=` inside INDEX/SUMPRODUCT, never COUNTIF or a bare MATCH, because those
 * read `*`, `?` and `~` in a funil name as wildcards. A blank or unknown funil gives #N/A, so nothing is offered.
 * `funilCell` is the row's Funil cell (absolute column, relative row), the ranges are absolute.
 */
export function etapaDependentFormula(funilCell: string, funilRange: string, etapaFirstCell: string): string {
  const match = `MATCH(1,INDEX(--(${funilRange}=${funilCell}),0),0)`;
  const count = `SUMPRODUCT(--(${funilRange}=${funilCell}))`;
  return `OFFSET(${etapaFirstCell},${match}-1,0,${count},1)`;
}

export function writeFunisSheet(ws: ExcelJS.Worksheet, rows: readonly FunisRow[]): void {
  FUNIS_SHEET_HEADERS.forEach((header, idx) => {
    const col = ws.getColumn(idx + 1);
    col.width = FUNIS_SHEET_WIDTHS[idx] ?? 24;
    col.numFmt = '@';
    col.alignment = { vertical: 'top', wrapText: true };
    const head = ws.getCell(1, idx + 1);
    head.value = header;
    head.numFmt = '@';
    head.font = { bold: true };
    head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
    head.alignment = { vertical: 'middle', wrapText: true };
    head.border = { bottom: { style: 'thin' } };
  });
  ws.views = [{ state: 'frozen', xSplit: 0, ySplit: 1, topLeftCell: 'A2', activeCell: 'A2' }];
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: FUNIS_SHEET_HEADERS.length } };
  rows.forEach((row, i) => {
    const r = i + 2;
    const values = [row.funil, row.etapa, row.tipo, row.aceitaLead, row.exigeMotivo, row.funcoes];
    const newFunil = i > 0 && rows[i - 1]?.funil !== row.funil;
    values.forEach((value, idx) => {
      const cell = ws.getCell(r, idx + 1);
      cell.value = value;
      cell.numFmt = '@';
      cell.alignment = { vertical: 'top', wrapText: true };
      if (newFunil) cell.border = { top: { style: 'thin' } };
    });
  });
}
