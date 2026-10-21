import { effectiveStageBehavior, stageActsAsOrcamento, type OrgModules } from '@fxl-sales/shared-utils/crm-model';
import type { salesOpsPipelineStages } from '../../db/schema.js';

/**
 * The legacy etapa vocabulary, derived from the unified pipeline stage (phase 2 cutover).
 *
 * The web of today still speaks `kind` (`normal | conversion | lost`) and `isSystem`, so
 * `GET /lead-stages` and every other legacy projection derive them from the new columns and
 * never store them. Pure: imports only a type, no database, no clock.
 */
export type PipelineStageRow = typeof salesOpsPipelineStages.$inferSelect;

export type LegacyStageKind = 'normal' | 'conversion' | 'lost';

type KindInput = Pick<PipelineStageRow, 'type' | 'exitKind'>;

/** `orcamento` is the old conversion etapa, exit `perdido` the old lost one, everything else is normal. */
export function legacyStageKind(stage: KindInput): LegacyStageKind {
  if (stage.type === 'orcamento') return 'conversion';
  if (stage.exitKind === 'perdido') return 'lost';
  return 'normal';
}

/**
 * The old rule "every non-normal etapa is a system etapa": the conversion and the lost etapa
 * cannot be renamed or archived through `PATCH /lead-stages/:id`. Ganho and Pausado are ordinary
 * etapas the org owns.
 */
export function legacyStageIsSystem(stage: KindInput): boolean {
  return legacyStageKind(stage) !== 'normal';
}

/** `GET /lead-stages` row: every field of the old table row plus the additive pipeline fields. */
export type LeadStageView = {
  id: string;
  orgId: string;
  name: string;
  kind: LegacyStageKind;
  isSystem: boolean;
  position: number;
  status: string;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date | null;
  pipelineId: string;
  type: string;
  behavior: string;
  exitKind: string | null;
  requiresReason: boolean;
};

export function toLeadStageView(row: PipelineStageRow): LeadStageView {
  return {
    id: row.id,
    orgId: row.orgId,
    name: row.name,
    kind: legacyStageKind(row),
    isSystem: legacyStageIsSystem(row),
    position: row.position,
    status: row.status,
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    pipelineId: row.pipelineId,
    type: row.type,
    behavior: row.behavior,
    exitKind: row.exitKind,
    requiresReason: row.requiresReason,
  };
}

/**
 * The projection of an `orcamento` stage for ONE organization (per-org modules, phase 3).
 * A stage opens a proposta only while `orcamentos` is on; with it off the stage is an
 * ordinary stage in every projection. The STORED `type` and `behavior` are never rewritten,
 * so turning the module back on restores the stage exactly.
 */
export function legacyStageKindFor(stage: KindInput & { behavior: string }, modules: OrgModules): LegacyStageKind {
  const acts = stageActsAsOrcamento({ type: stage.type, behavior: stage.behavior }, modules);
  return legacyStageKind({ type: acts ? stage.type : 'normal', exitKind: stage.exitKind });
}

/** `GET /lead-stages` row as this organization's modules let the stage act. */
export function leadStageViewFor(view: LeadStageView, modules: OrgModules): LeadStageView {
  const kind = legacyStageKindFor(view, modules);
  return {
    ...view,
    kind,
    isSystem: kind !== 'normal',
    behavior: effectiveStageBehavior({ type: view.type, behavior: view.behavior }, modules),
  };
}
