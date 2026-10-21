import { and, asc, eq } from 'drizzle-orm';
import type { getDb } from '../../db/client.js';
import { salesOpsPipelines, salesOpsPipelineStages } from '../../db/schema.js';
import type { PipelineStageRow } from './stage-view.js';

/**
 * Read helpers for the unified pipeline tables. Every function takes the tenant transaction its
 * caller already opened and filters by `org_id` itself (defence in depth: over the `app.fxl_admin`
 * connection RLS shows every org, and this filter is then the only scoping).
 */
type Db = ReturnType<typeof getDb>;

export type PipelineRow = typeof salesOpsPipelines.$inferSelect;

/**
 * The org's default pipeline id: the `is_default` row, else the first active pipeline by board
 * order. Null only when the org has no pipeline at all (callers that must write seed first).
 */
export async function defaultPipelineId(tx: Db, orgId: string): Promise<string | null> {
  const [row] = await tx
    .select({ id: salesOpsPipelines.id })
    .from(salesOpsPipelines)
    .where(and(eq(salesOpsPipelines.orgId, orgId), eq(salesOpsPipelines.status, 'active')))
    .orderBy(asc(salesOpsPipelines.isDefault), asc(salesOpsPipelines.position), asc(salesOpsPipelines.name))
    .limit(1);
  return row?.id ?? null;
}

export async function pipelineExists(tx: Db, orgId: string, pipelineId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: salesOpsPipelines.id })
    .from(salesOpsPipelines)
    .where(and(eq(salesOpsPipelines.orgId, orgId), eq(salesOpsPipelines.id, pipelineId)))
    .limit(1);
  return row !== undefined;
}

/** A pipeline's stages in board order, archived ones included. */
export function listPipelineStages(tx: Db, orgId: string, pipelineId: string): Promise<PipelineStageRow[]> {
  return tx
    .select()
    .from(salesOpsPipelineStages)
    .where(and(eq(salesOpsPipelineStages.orgId, orgId), eq(salesOpsPipelineStages.pipelineId, pipelineId)))
    .orderBy(asc(salesOpsPipelineStages.position), asc(salesOpsPipelineStages.name));
}
