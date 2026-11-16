import { and, asc, eq, inArray } from 'drizzle-orm';
import type { getDb } from '../../db/client.js';
import { salesOpsPipelineStages, salesOpsPipelineTransitions, salesOpsPipelines } from '../../db/schema.js';
import { withTenant } from '../sales-ops/leads/with-tenant.js';
import { ensureCrmDefaults } from './defaults.js';
import { readPipelineFuncaoLinks } from './pipeline-access.js';

/**
 * The read side of the CRM configuration: `GET /pipelines` and `GET /field-definitions`.
 * Both seed the org's defaults on first read (the default pipeline and the Cliente system field),
 * so a brand-new org answers a usable configuration. Field definitions have no write side, which is
 * what keeps the Cliente definition impossible to remove or archive; pipelines are written only by
 * `pipeline-admin-service.ts` (`POST /pipelines`, `PATCH /pipelines/:id`, admin only).
 */
type Db = ReturnType<typeof getDb>;

export type PipelineView = {
  id: string;
  name: string;
  isDefault: boolean;
  position: number;
  status: string;
  /** The funções whose pessoas reach this pipeline (vários funis). Empty: only the default rule. */
  funcaoIds: string[];
  stages: Array<{
    id: string;
    name: string;
    position: number;
    type: string;
    behavior: string;
    exitKind: string | null;
    requiresReason: boolean;
    status: string;
  }>;
  transitions: Array<{ fromStageId: string; toStageId: string }>;
};

export type ListPipelinesOptions = {
  /**
   * The pipeline ids the caller reaches, or null for every pipeline (an admin), resolved inside this
   * transaction AFTER the seed, so a brand-new org's default pipeline is already there. The route
   * passes `resolveCallerPipelineAccess`, the board's own gate.
   */
  reachable: (tx: Db) => Promise<string[] | null>;
  /** Archived pipelines too. Only an admin's Funis e etapas screen asks for them. */
  includeArchived?: boolean;
};

export function listPipelines(db: Db, orgId: string, options: ListPipelinesOptions): Promise<PipelineView[]> {
  return withTenant(db, orgId, async (tx) => {
    await ensureCrmDefaults(tx, orgId);
    const access = await options.reachable(tx);
    return readPipelineViews(tx, orgId, {
      ...(access === null ? {} : { ids: access }),
      includeArchived: options.includeArchived === true,
    });
  });
}

/**
 * The pipeline projection, in board order, inside the caller's tenant transaction: every pipeline of
 * the org (or the given ids), active ones only unless `includeArchived`. Shared by the list and by
 * the pipeline writes, so a write answers exactly the row the list would show.
 */
export async function readPipelineViews(
  tx: Db,
  orgId: string,
  filter: { ids?: readonly string[]; includeArchived: boolean },
): Promise<PipelineView[]> {
  if (filter.ids !== undefined && filter.ids.length === 0) return [];
  const pipelines = await tx
    .select()
    .from(salesOpsPipelines)
    .where(
      and(
        eq(salesOpsPipelines.orgId, orgId),
        filter.includeArchived ? undefined : eq(salesOpsPipelines.status, 'active'),
        filter.ids === undefined ? undefined : inArray(salesOpsPipelines.id, [...filter.ids]),
      ),
    )
    .orderBy(asc(salesOpsPipelines.position), asc(salesOpsPipelines.name));
  if (pipelines.length === 0) return [];
  const pipelineIds = pipelines.map((pipeline) => pipeline.id);
  const stages = await tx
    .select()
    .from(salesOpsPipelineStages)
    .where(and(eq(salesOpsPipelineStages.orgId, orgId), inArray(salesOpsPipelineStages.pipelineId, pipelineIds)))
    .orderBy(asc(salesOpsPipelineStages.position), asc(salesOpsPipelineStages.name));
  const transitions = await tx
    .select()
    .from(salesOpsPipelineTransitions)
    .where(
      and(eq(salesOpsPipelineTransitions.orgId, orgId), inArray(salesOpsPipelineTransitions.pipelineId, pipelineIds)),
    );
  const links = await readPipelineFuncaoLinks(tx, orgId, pipelineIds);
  return pipelines.map((pipeline) => ({
    id: pipeline.id,
    name: pipeline.name,
    isDefault: pipeline.isDefault,
    position: pipeline.position,
    status: pipeline.status,
    funcaoIds: links.get(pipeline.id) ?? [],
    stages: stages
      .filter((stage) => stage.pipelineId === pipeline.id)
      .map((stage) => ({
        id: stage.id,
        name: stage.name,
        position: stage.position,
        type: stage.type,
        behavior: stage.behavior,
        exitKind: stage.exitKind,
        requiresReason: stage.requiresReason,
        status: stage.status,
      })),
    transitions: transitions
      .filter((transition) => transition.pipelineId === pipeline.id)
      .map((transition) => ({ fromStageId: transition.fromStageId, toStageId: transition.toStageId })),
  }));
}

export type FieldDefinitionView = {
  id: string;
  key: string;
  label: string;
  kind: string;
  referenceTarget: string | null;
  multiple: boolean;
  options: unknown;
  filterable: boolean;
  isSystem: boolean;
  removable: boolean;
  position: number;
};

export function listFieldDefinitions(db: Db, orgId: string): Promise<FieldDefinitionView[]> {
  return withTenant(db, orgId, async (tx) => {
    const { fields } = await ensureCrmDefaults(tx, orgId);
    return fields
      .filter((field) => field.status === 'active')
      .map((field) => ({
        id: field.id,
        key: field.key,
        label: field.label,
        kind: field.kind,
        referenceTarget: field.referenceTarget,
        multiple: field.multiple,
        options: field.options,
        filterable: field.filterable,
        isSystem: field.isSystem,
        removable: field.removable,
        position: field.position,
      }));
  });
}
