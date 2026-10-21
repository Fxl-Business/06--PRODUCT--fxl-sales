import { randomUUID } from 'node:crypto';
import {
  DEFAULT_PIPELINE_KEY,
  DEFAULT_PIPELINE_NAME,
  DEFAULT_PIPELINE_STAGES,
  DEFAULT_PIPELINE_TRANSITIONS,
} from '@fxl-sales/shared-utils/default-pipeline';
import {
  defaultStageBehavior,
  defaultStageRequiresReason,
  SYSTEM_FIELD_CLIENTE,
} from '@fxl-sales/shared-utils/crm-model';
import { asc, eq } from 'drizzle-orm';
import type { getDb } from '../../db/client.js';
import { salesOpsFieldDefinitions, salesOpsPipelines, salesOpsPipelineStages, salesOpsPipelineTransitions } from '../../db/schema.js';
import { withTenant } from '../sales-ops/leads/with-tenant.js';

type Db = ReturnType<typeof getDb>;

export type PipelineRow = typeof salesOpsPipelines.$inferSelect;
export type FieldDefinitionRow = typeof salesOpsFieldDefinitions.$inferSelect;

function selectPipelines(tx: Db, orgId: string): Promise<PipelineRow[]> {
  return tx
    .select()
    .from(salesOpsPipelines)
    .where(eq(salesOpsPipelines.orgId, orgId))
    .orderBy(asc(salesOpsPipelines.position), asc(salesOpsPipelines.name));
}

function selectFields(tx: Db, orgId: string): Promise<FieldDefinitionRow[]> {
  return tx
    .select()
    .from(salesOpsFieldDefinitions)
    .where(eq(salesOpsFieldDefinitions.orgId, orgId))
    .orderBy(asc(salesOpsFieldDefinitions.position), asc(salesOpsFieldDefinitions.key));
}

/**
 * Seeds the default CRM pipeline (stages and transitions from the shared constant) for an org
 * that has NO pipeline row at all and returns the org's pipelines in order. MUST run inside an
 * already tenant-scoped transaction (see {@link ensureCrmDefaultsForOrg}).
 *
 * "Seeded" means "has ANY pipeline row", never "has the default one": a renamed or archived
 * pipeline is never reinserted. The pipeline INSERT is a bare ON CONFLICT DO NOTHING (absorbs
 * every unique index: org+name, org+system_key, one default per org); a concurrent first caller
 * blocks on it until the winner commits, so the loser's INSERT returns no row and the re-read
 * sees the winner's complete pipeline. Stages and transitions are written only by the caller
 * whose pipeline INSERT returned a row, in the same transaction.
 */
export async function ensureDefaultPipeline(tx: Db, orgId: string): Promise<PipelineRow[]> {
  const existing = await selectPipelines(tx, orgId);
  if (existing.length > 0) return existing;

  const pipelineId = randomUUID();
  const inserted = await tx
    .insert(salesOpsPipelines)
    .values({
      id: pipelineId,
      orgId,
      name: DEFAULT_PIPELINE_NAME,
      systemKey: DEFAULT_PIPELINE_KEY,
      position: 0,
      isDefault: true,
    })
    .onConflictDoNothing()
    .returning({ id: salesOpsPipelines.id });

  if (inserted.length > 0) {
    const stageIds = new Map(DEFAULT_PIPELINE_STAGES.map((stage) => [stage.key as string, randomUUID()] as const));
    await tx.insert(salesOpsPipelineStages).values(
      DEFAULT_PIPELINE_STAGES.map((stage) => ({
        id: stageIds.get(stage.key)!,
        orgId,
        pipelineId,
        name: stage.label,
        position: stage.order,
        type: stage.type,
        behavior: defaultStageBehavior(stage),
        exitKind: stage.exitKind,
        requiresReason: defaultStageRequiresReason(stage),
      })),
    );
    await tx.insert(salesOpsPipelineTransitions).values(
      DEFAULT_PIPELINE_TRANSITIONS.map(([from, to]) => ({
        orgId,
        pipelineId,
        fromStageId: stageIds.get(from)!,
        toStageId: stageIds.get(to)!,
      })),
    );
  }

  return selectPipelines(tx, orgId);
}

/**
 * Ensures the Cliente system field exists. Unlike the pipeline it is re-inserted when missing
 * (it is not removable), keyed by the unique (org_id, key) index.
 */
export async function ensureSystemFieldDefinitions(tx: Db, orgId: string): Promise<FieldDefinitionRow[]> {
  await tx
    .insert(salesOpsFieldDefinitions)
    .values({ orgId, ...SYSTEM_FIELD_CLIENTE })
    .onConflictDoNothing();
  return selectFields(tx, orgId);
}

export async function ensureCrmDefaults(
  tx: Db,
  orgId: string,
): Promise<{ pipelines: PipelineRow[]; fields: FieldDefinitionRow[] }> {
  const pipelines = await ensureDefaultPipeline(tx, orgId);
  const fields = await ensureSystemFieldDefinitions(tx, orgId);
  return { pipelines, fields };
}

/** Opens the tenant transaction and seeds. The public entry point. */
export async function ensureCrmDefaultsForOrg(db: Db, orgId: string) {
  return withTenant(db, orgId, (tx) => ensureCrmDefaults(tx, orgId));
}
