import { and, asc, eq } from 'drizzle-orm';
import type { getDb } from '../../db/client.js';
import { salesOpsPipelineStages, salesOpsPipelineTransitions, salesOpsPipelines } from '../../db/schema.js';
import { withTenant } from '../sales-ops/leads/with-tenant.js';
import { ensureCrmDefaults } from './defaults.js';

/**
 * The read side of the CRM configuration: `GET /pipelines` and `GET /field-definitions`.
 * Both seed the org's defaults on first read (the default pipeline and the Cliente system field),
 * so a brand-new org answers a usable configuration. There is no write side in this run: pipelines,
 * stages and definitions are not editable through the API, which is what keeps the Cliente
 * definition impossible to remove or archive.
 */
type Db = ReturnType<typeof getDb>;

export type PipelineView = {
  id: string;
  name: string;
  isDefault: boolean;
  position: number;
  status: string;
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

export function listPipelines(db: Db, orgId: string): Promise<PipelineView[]> {
  return withTenant(db, orgId, async (tx) => {
    await ensureCrmDefaults(tx, orgId);
    const pipelines = await tx
      .select()
      .from(salesOpsPipelines)
      .where(and(eq(salesOpsPipelines.orgId, orgId), eq(salesOpsPipelines.status, 'active')))
      .orderBy(asc(salesOpsPipelines.position), asc(salesOpsPipelines.name));
    const stages = await tx
      .select()
      .from(salesOpsPipelineStages)
      .where(eq(salesOpsPipelineStages.orgId, orgId))
      .orderBy(asc(salesOpsPipelineStages.position), asc(salesOpsPipelineStages.name));
    const transitions = await tx
      .select()
      .from(salesOpsPipelineTransitions)
      .where(eq(salesOpsPipelineTransitions.orgId, orgId));
    return pipelines.map((pipeline) => ({
      id: pipeline.id,
      name: pipeline.name,
      isDefault: pipeline.isDefault,
      position: pipeline.position,
      status: pipeline.status,
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
  });
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
