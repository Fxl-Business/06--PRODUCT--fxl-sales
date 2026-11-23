/**
 * The Leads tab etapa step: the shape of a stage map and the pure summary the preview shows.
 * Pure and deterministic: no I/O, no clock, no env, no database. Every header comes from workbook-schema.ts.
 */
import { z } from 'zod';
import { normalizeLabel } from '../cells.js';
import { cellReader } from '../parse.js';
import { buildPipelineIndex, type PipelineMap } from '../pipeline-resolution.js';
import { buildRefIndex } from '../refs.js';
import type { ImportCatalog, ParsedWorkbook, StageMap } from '../types.js';

/** Sheet name -> destination. Strict: an unknown key inside an entry is a malformed body, never ignored. */
export const StageMapSchema = z.record(
  z.string(),
  z.union([
    z.object({ stageId: z.string().min(1) }).strict(),
    z.object({ create: z.literal(true) }).strict(),
    z.object({ first: z.literal(true) }).strict(),
  ]),
) satisfies z.ZodType<StageMap>;

/** Funil as written in the sheet -> its target pipeline and the etapa map inside it. Strict like the StageMap. */
export const PipelineMapSchema = z.record(
  z.string(),
  z
    .object({ pipelineId: z.string().min(1).optional(), stages: StageMapSchema.optional() })
    .strict(),
) satisfies z.ZodType<PipelineMap>;

export type LeadStageResolution =
  /** `stageId` is null when the Etapas tab of the same workbook creates the etapa. */
  | { kind: 'existing'; stageId: string | null }
  | { kind: 'not_found' }
  | { kind: 'conversion' };

/** One per (sheet funil, etapa); `funil` is null when the cell is blank. */
export type LeadStageSummary = { name: string; leads: number; resolution: LeadStageResolution; funil: string | null };
export type StageTarget = { id: string; name: string; kind: 'normal' | 'lost'; pipelineId: string };
export type LeadPipelineResolution = { kind: 'existing'; pipelineId: string } | { kind: 'not_found' };
export type LeadPipelineSummary = { name: string; leads: number; resolution: LeadPipelineResolution };
export type PipelineTarget = { id: string; name: string; isDefault: boolean };
export type LeadStageStep = {
  leadStages: LeadStageSummary[];
  stageTargets: StageTarget[];
  leadPipelines: LeadPipelineSummary[];
  pipelineTargets: PipelineTarget[];
};

/**
 * What the preview shows for the map steps, WITHOUT any stage map:
 *  - `leadStages`: the distinct (Funil, Etapa) pairs of the Leads tab (first spelling wins, order of first appearance)
 *    with the number of rows and how the etapa resolves inside the row's funil, the `pipelineMap` target applied;
 *    an etapa whose funil does not resolve is left out;
 *  - `leadPipelines`: the distinct non-blank Funil names of the Leads and Etapas tabs and how each resolves by name
 *    (an archived funil reads `not_found`: it must be asked, never silently used);
 *  - the etapas and funis a row may be sent to.
 */
export function summarizeLeadStages(
  parsed: ParsedWorkbook,
  catalog: ImportCatalog,
  pipelineMap?: PipelineMap,
): LeadStageStep {
  const pipelines = buildPipelineIndex(catalog, pipelineMap);
  const refs = buildRefIndex(parsed, catalog, pipelines);

  const byKey = new Map<string, LeadStageSummary>();
  for (const row of parsed.sheets.leads.rows) {
    const cells = cellReader('leads', row);
    const name = cells.text('etapa');
    if (name === null) continue;
    const funilCell = cells.text('funil');
    const funil = pipelines.resolve(funilCell);
    if (!funil.ok) continue;
    const key = `${funilCell === null ? '' : normalizeLabel(funilCell)}|${normalizeLabel(name)}`;
    const known = byKey.get(key);
    if (known) {
      known.leads += 1;
      continue;
    }
    const lookup = refs.resolveStage(funil.pipelineId, name);
    let resolution: LeadStageResolution = { kind: 'not_found' };
    if (lookup.ok) {
      if ('planKey' in lookup.ref) resolution = { kind: 'existing', stageId: null };
      else {
        const existingId = lookup.ref.existingId;
        const stage = catalog.stages.find((s) => s.id === existingId);
        resolution =
          stage?.kind === 'conversion' ? { kind: 'conversion' } : { kind: 'existing', stageId: existingId };
      }
    }
    byKey.set(key, { name: name.trim(), leads: 1, resolution, funil: funilCell === null ? null : funilCell.trim() });
  }

  const byFunil = new Map<string, LeadPipelineSummary>();
  const countFunil = (name: string | null, lead: boolean): void => {
    if (name === null) return;
    const key = normalizeLabel(name);
    const known = byFunil.get(key);
    if (known) {
      if (lead) known.leads += 1;
      return;
    }
    const lookup = pipelines.resolveUnmapped(name);
    byFunil.set(key, {
      name: name.trim(),
      leads: lead ? 1 : 0,
      resolution: lookup.ok ? { kind: 'existing', pipelineId: lookup.pipelineId } : { kind: 'not_found' },
    });
  };
  for (const row of parsed.sheets.leads.rows) countFunil(cellReader('leads', row).text('funil'), true);
  for (const row of parsed.sheets.etapas.rows) countFunil(cellReader('etapas', row).text('funil'), false);

  const activeFunis = catalog.pipelines.filter((p) => p.status === 'active');
  const funilOrder = new Map(activeFunis.map((p, index) => [p.id, index]));
  const stageTargets = catalog.stages
    .filter((s) => s.status === 'active' && s.kind !== 'conversion' && funilOrder.has(s.pipelineId))
    .sort((a, b) => (funilOrder.get(a.pipelineId) ?? 0) - (funilOrder.get(b.pipelineId) ?? 0) || a.position - b.position)
    .map((s): StageTarget => ({ id: s.id, name: s.name, kind: s.kind === 'lost' ? 'lost' : 'normal', pipelineId: s.pipelineId }));
  const pipelineTargets = activeFunis.map((p): PipelineTarget => ({ id: p.id, name: p.name, isDefault: p.isDefault }));
  return { leadStages: [...byKey.values()], stageTargets, leadPipelines: [...byFunil.values()], pipelineTargets };
}
