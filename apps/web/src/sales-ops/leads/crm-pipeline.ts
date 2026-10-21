import { defaultStageBehavior, effectiveStageBehavior, type OrgModules } from '@fxl-sales/shared-utils/crm-model';
import type { CrmPipeline, CrmPipelineStage, PipelineExitKind, PipelineStageType } from './crm-types';
import type { LeadStageKind, SalesOpsLeadStage } from './types';

export const OPENS_ORCAMENTOS_BEHAVIOR = 'opens_orcamentos';

export const LEGACY_KIND_BY_EXIT: Record<PipelineExitKind, LeadStageKind> = {
  ganho: 'normal',
  perdido: 'lost',
  pausado: 'normal',
};

/**
 * The conversion kind follows the EFFECTIVE behavior the API projects (`none` while
 * `orcamentos` is off), never the stored `type`: an orcamento stage of an org without
 * the module is an ordinary board stage, so a drop on it moves the lead and never
 * opens the proposta wizard. Unknown behaviours read as `normal`.
 */
const LEGACY_KIND_BY_BEHAVIOR: Partial<Record<string, LeadStageKind>> = {
  [OPENS_ORCAMENTOS_BEHAVIOR]: 'conversion',
};

export function legacyKindOf(stage: Pick<CrmPipelineStage, 'behavior' | 'exitKind'>): LeadStageKind {
  if (stage.exitKind) return LEGACY_KIND_BY_EXIT[stage.exitKind];
  return LEGACY_KIND_BY_BEHAVIOR[stage.behavior] ?? 'normal';
}

/**
 * The kind of a stage on the lead SUMMARY, whose projection carries no `behavior`. The
 * behaviour is the seeded rule (`defaultStageBehavior`) effective for the organization's
 * modules (the shell's `OrgModulesContext`; outside the shell the whole product applies).
 */
export function summaryStageKind(
  stage: { type: PipelineStageType; exitKind: PipelineExitKind | null },
  modules: OrgModules | null,
): LeadStageKind {
  const seeded = defaultStageBehavior(stage);
  const behavior = modules ? effectiveStageBehavior({ type: stage.type, behavior: seeded }, modules) : seeded;
  return legacyKindOf({ behavior, exitKind: stage.exitKind });
}

/** Selected pipeline, else the default one, else the first (position order). undefined when there is none. */
export function pickPipeline(pipelines: readonly CrmPipeline[], selectedId: string | null): CrmPipeline | undefined {
  const active = pipelines.filter((p) => p.status === 'active');
  return active.find((p) => p.id === selectedId) ?? active.find((p) => p.isDefault) ?? active[0];
}

/** One board stage per ACTIVE pipeline stage, in position order, with the legacy kind filled by lookup. */
export function pipelineStagesAsBoardStages(pipeline: CrmPipeline | undefined): SalesOpsLeadStage[] {
  if (!pipeline) return [];
  return [...pipeline.stages]
    .filter((s) => s.status === 'active')
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, 'pt-BR'))
    .map((s) => ({
      id: s.id,
      orgId: '',
      name: s.name,
      position: s.position,
      kind: legacyKindOf(s),
      isSystem: s.type !== 'normal',
      status: s.status,
      archivedAt: null,
      createdAt: '',
      updatedAt: null,
      pipelineId: pipeline.id,
      type: s.type,
      behavior: s.behavior,
      exitKind: s.exitKind,
      requiresReason: s.requiresReason,
    }));
}

/** A stage always "allows" itself (reorder inside the column). */
export function isTransitionAllowed(pipeline: CrmPipeline | undefined, fromStageId: string, toStageId: string): boolean {
  if (fromStageId === toStageId) return true;
  if (!pipeline) return false;
  return pipeline.transitions.some((t) => t.fromStageId === fromStageId && t.toStageId === toStageId);
}

export function allowedTargetIds(pipeline: CrmPipeline | undefined, fromStageId: string): Set<string> {
  const ids = new Set<string>([fromStageId]);
  for (const t of pipeline?.transitions ?? []) if (t.fromStageId === fromStageId) ids.add(t.toStageId);
  return ids;
}

export function stageOpensOrcamentos(stage: Pick<CrmPipelineStage, 'behavior'> | undefined): boolean {
  return stage?.behavior === OPENS_ORCAMENTOS_BEHAVIOR;
}
