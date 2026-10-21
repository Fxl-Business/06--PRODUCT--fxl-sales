import type { CrmPipeline, CrmPipelineStage, PipelineExitKind, PipelineStageType } from './crm-types';
import type { LeadStageKind, SalesOpsLeadStage } from './types';

export const OPENS_ORCAMENTOS_BEHAVIOR = 'opens_orcamentos';

export const LEGACY_KIND_BY_TYPE: Record<PipelineStageType, LeadStageKind> = {
  normal: 'normal',
  orcamento: 'conversion',
  saida: 'normal',
};

export const LEGACY_KIND_BY_EXIT: Record<PipelineExitKind, LeadStageKind> = {
  ganho: 'normal',
  perdido: 'lost',
  pausado: 'normal',
};

export function legacyKindOf(stage: Pick<CrmPipelineStage, 'type' | 'exitKind'>): LeadStageKind {
  return stage.exitKind ? LEGACY_KIND_BY_EXIT[stage.exitKind] : LEGACY_KIND_BY_TYPE[stage.type];
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
