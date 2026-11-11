/**
 * The Leads tab etapa step: the shape of a stage map and the pure summary the preview shows.
 * Pure and deterministic: no I/O, no clock, no env, no database. Every header comes from workbook-schema.ts.
 */
import { z } from 'zod';
import { normalizeLabel } from '../cells.js';
import { cellReader } from '../parse.js';
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

export type LeadStageResolution =
  /** `stageId` is null when the Etapas tab of the same workbook creates the etapa. */
  | { kind: 'existing'; stageId: string | null }
  | { kind: 'not_found' }
  | { kind: 'conversion' };

export type LeadStageSummary = { name: string; leads: number; resolution: LeadStageResolution };
export type StageTarget = { id: string; name: string; kind: 'normal' | 'lost' };
export type LeadStageStep = { leadStages: LeadStageSummary[]; stageTargets: StageTarget[] };

/**
 * Distinct names of the Etapa column of the Leads tab (first spelling wins, order of first appearance) with the
 * number of rows and how the name resolves today, WITHOUT any stage map; plus the etapas a lead may be sent to.
 */
export function summarizeLeadStages(parsed: ParsedWorkbook, catalog: ImportCatalog): LeadStageStep {
  const refs = buildRefIndex(parsed, catalog);
  const byKey = new Map<string, LeadStageSummary>();
  for (const row of parsed.sheets.leads.rows) {
    const name = cellReader('leads', row).text('etapa');
    if (name === null) continue;
    const key = normalizeLabel(name);
    const known = byKey.get(key);
    if (known) {
      known.leads += 1;
      continue;
    }
    const lookup = refs.resolve('stage', name);
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
    byKey.set(key, { name: name.trim(), leads: 1, resolution });
  }
  const stageTargets = catalog.stages
    .filter((s) => s.status === 'active' && s.kind !== 'conversion')
    .sort((a, b) => a.position - b.position)
    .map((s): StageTarget => ({ id: s.id, name: s.name, kind: s.kind === 'lost' ? 'lost' : 'normal' }));
  return { leadStages: [...byKey.values()], stageTargets };
}
