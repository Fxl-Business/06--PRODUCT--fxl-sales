import { accessiblePipelineIds } from '@fxl-sales/shared-utils/crm-model';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { getDb } from '../../db/client.js';
import { salesOpsPersonFuncoes, salesOpsPipelineFuncoes, salesOpsPipelines } from '../../db/schema.js';

/**
 * The read side of pipeline access by função (migration 0034). It loads what the pure rule
 * `accessiblePipelineIds` (`@fxl-sales/shared-utils/crm-model`) needs and nothing else decides:
 * the org's active pipelines in board order, the funções linked to each, and the pessoa's own
 * funções. The ONE caller on a request path is the lead scope gate (`resolveLeadScopePredicate`
 * in `sales-ops/leads/lead-service.ts`), so every lead read and write, the follow-ups and
 * `GET /pipelines` derive the same set from one place.
 *
 * Every read takes the caller's tenant transaction and filters by `org_id` itself (defence in depth
 * over the `app.fxl_admin` connection, where RLS shows every org).
 */
type Db = ReturnType<typeof getDb>;

export type PipelineFuncaoLinks = Map<string, string[]>;

/** The função ids linked to each of the given pipelines (an absent key means none). */
export async function readPipelineFuncaoLinks(
  tx: Db,
  orgId: string,
  pipelineIds: readonly string[],
): Promise<PipelineFuncaoLinks> {
  const links: PipelineFuncaoLinks = new Map();
  if (pipelineIds.length === 0) return links;
  const rows = await tx
    .select({ pipelineId: salesOpsPipelineFuncoes.pipelineId, funcaoId: salesOpsPipelineFuncoes.funcaoId })
    .from(salesOpsPipelineFuncoes)
    .where(and(eq(salesOpsPipelineFuncoes.orgId, orgId), inArray(salesOpsPipelineFuncoes.pipelineId, [...pipelineIds])))
    .orderBy(asc(salesOpsPipelineFuncoes.createdAt), asc(salesOpsPipelineFuncoes.funcaoId));
  for (const row of rows) {
    const bucket = links.get(row.pipelineId);
    if (bucket) bucket.push(row.funcaoId);
    else links.set(row.pipelineId, [row.funcaoId]);
  }
  return links;
}

/**
 * The pipeline ids a NON-ADMIN pessoa reaches, in board order. `personId` null (a caller with no
 * pessoa) holds no função, so it reaches only the default pipeline. An admin never comes here: an
 * admin reaches every pipeline and carries no pipeline predicate at all.
 *
 * Every função the pessoa holds counts, archived ones included, exactly as `person.funcaoIds` reads
 * on the web: archiving a função hides it from pickers and changes no one's access.
 */
export async function personPipelineAccess(tx: Db, orgId: string, personId: string | null): Promise<string[]> {
  const pipelines = await tx
    .select({ id: salesOpsPipelines.id, isDefault: salesOpsPipelines.isDefault, status: salesOpsPipelines.status })
    .from(salesOpsPipelines)
    .where(and(eq(salesOpsPipelines.orgId, orgId), eq(salesOpsPipelines.status, 'active')))
    .orderBy(asc(salesOpsPipelines.position), asc(salesOpsPipelines.name));
  if (pipelines.length === 0) return [];
  const links = await readPipelineFuncaoLinks(
    tx,
    orgId,
    pipelines.map((pipeline) => pipeline.id),
  );
  const held =
    personId === null
      ? []
      : (
          await tx
            .select({ funcaoId: salesOpsPersonFuncoes.funcaoId })
            .from(salesOpsPersonFuncoes)
            .where(and(eq(salesOpsPersonFuncoes.orgId, orgId), eq(salesOpsPersonFuncoes.personId, personId)))
        ).map((row) => row.funcaoId);
  return accessiblePipelineIds(
    pipelines.map((pipeline) => ({
      id: pipeline.id,
      isDefault: pipeline.isDefault,
      status: pipeline.status === 'archived' ? 'archived' : 'active',
      funcaoIds: links.get(pipeline.id) ?? [],
    })),
    held,
  );
}
