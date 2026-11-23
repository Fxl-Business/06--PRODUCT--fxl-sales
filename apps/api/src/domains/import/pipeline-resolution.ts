/**
 * Funil (pipeline) resolution of the spreadsheet import. Pure and deterministic: no I/O, no clock, no env.
 * Name matching uses only normalizeLabel, exactly like every other name in the import.
 */
import { normalizeLabel } from './cells.js';
import type { ImportCatalog, StageMap, StageMapEntry } from './types.js';

/** One funil as the sheet writes it: the pipeline to use instead of the name, and the etapa map inside it. */
export type PipelineMapEntry = { pipelineId?: string; stages?: StageMap };
/** Key: the Funil cell as written in the sheet (matched by normalizeLabel). */
export type PipelineMap = Readonly<Record<string, PipelineMapEntry>>;

export type PipelineIssueCode = 'funil_required' | 'unknown_ref' | 'archived_ref' | 'invalid_pipeline_target';
export type PipelineLookup =
  | { ok: true; pipelineId: string; name: string }
  | { ok: false; code: PipelineIssueCode; message: string };

export interface PipelineIndex {
  /** The funil of a row: the map entry wins, then the name, then (blank) the only active funil. */
  resolve(funil: string | null): PipelineLookup;
  /** The same as `resolve` for a non-blank name, WITHOUT the map. */
  resolveUnmapped(funil: string): PipelineLookup;
  /** The etapa destination chosen for an etapa name: the top-level stage map only for a blank funil. */
  stageEntry(funil: string | null, etapa: string): StageMapEntry | undefined;
}

const isBlank = (funil: string | null): funil is null => funil === null || normalizeLabel(funil) === '';

function failure(code: PipelineIssueCode, message: string): PipelineLookup {
  return { ok: false, code, message };
}

/** Entries of a map by normalized label, so "Vendas " and "vendas" are one entry. */
function byLabel<T>(map: Readonly<Record<string, T>> | undefined): Map<string, T> {
  const out = new Map<string, T>();
  for (const [name, value] of Object.entries(map ?? {})) out.set(normalizeLabel(name), value);
  return out;
}

export function buildPipelineIndex(
  catalog: ImportCatalog,
  pipelineMap?: PipelineMap,
  stageMap?: StageMap,
): PipelineIndex {
  const mapped = byLabel(pipelineMap);
  const topStages = byLabel(stageMap);
  const active = catalog.pipelines.filter((p) => p.status === 'active');

  const resolveByName = (funil: string): PipelineLookup => {
    const typed = funil.trim();
    const key = normalizeLabel(funil);
    const matches = active.filter((p) => normalizeLabel(p.name) === key);
    if (matches.length === 1) return { ok: true, pipelineId: matches[0]!.id, name: matches[0]!.name };
    if (matches.length > 1) {
      const exact = matches.filter((p) => p.name.trim() === typed);
      if (exact.length === 1) return { ok: true, pipelineId: exact[0]!.id, name: exact[0]!.name };
      return failure('unknown_ref', `Há mais de um funil com o nome "${typed}"; escreva o nome exatamente como no cadastro.`);
    }
    if (catalog.pipelines.some((p) => p.status !== 'active' && normalizeLabel(p.name) === key)) {
      return failure('archived_ref', `O funil "${typed}" está arquivado; restaure em Cadastros > Funis e etapas ou use outro.`);
    }
    return failure('unknown_ref', `Não encontramos o funil "${typed}" no cadastro.`);
  };

  const resolve = (funil: string | null): PipelineLookup => {
    if (isBlank(funil)) {
      const only = active.length === 1 ? active[0] : undefined;
      if (only) return { ok: true, pipelineId: only.id, name: only.name };
      return failure('funil_required', 'Preencha o funil: a organização tem mais de um funil ativo e a linha não diz qual usar.');
    }
    const target = mapped.get(normalizeLabel(funil))?.pipelineId;
    if (target !== undefined) {
      const pipeline = active.find((p) => p.id === target);
      if (!pipeline) {
        return failure('invalid_pipeline_target', `O funil escolhido para "${funil.trim()}" não existe ou está arquivado; escolha outro funil de destino.`);
      }
      return { ok: true, pipelineId: pipeline.id, name: pipeline.name };
    }
    return resolveByName(funil);
  };

  return {
    resolve,
    resolveUnmapped: resolveByName,
    stageEntry: (funil, etapa) => {
      const key = normalizeLabel(etapa);
      if (isBlank(funil)) return topStages.get(key);
      return byLabel(mapped.get(normalizeLabel(funil))?.stages).get(key);
    },
  };
}
