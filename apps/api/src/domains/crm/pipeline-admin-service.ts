import { and, eq, inArray, ne } from 'drizzle-orm';
import type { getDb } from '../../db/client.js';
import { salesOpsFuncoes, salesOpsPipelineFuncoes, salesOpsPipelines } from '../../db/schema.js';
import { withTenant } from '../sales-ops/leads/with-tenant.js';
import { readPipelineViews, type PipelineView } from './crm-read-service.js';
import { createPipelineWithDefaultStages } from './defaults.js';
import type { CreatePipelineInput, UpdatePipelineInput } from './pipeline-schemas.js';

/**
 * The write side of the pipelines (vários funis por organização): `POST /pipelines` and
 * `PATCH /pipelines/:id`, both behind `requireAdmin` at the route. The org is only the verified
 * `c.get('orgId')`; nothing in the body names one.
 *
 *  - A new pipeline is born with the seven default etapas and their transition graph through
 *    `createPipelineWithDefaultStages` (the same writer the org's first pipeline uses).
 *  - The default pipeline cannot be archived (`is_default`), so an org always keeps one.
 *  - The funções that reach a pipeline are a FULL set replacement of `sales_ops_pipeline_funcoes`.
 *    A função must be the org's own and active, or already linked to this pipeline (an archived
 *    função keeps its link until an admin drops it); any other id is `unknown_funcao` and nothing
 *    is written.
 *  - There is no DELETE: removal is `status: 'archived'`, and a restore is `status: 'active'`.
 *  - It writes no `audit_log` entry, exactly like the etapa cadastro.
 */
type Db = ReturnType<typeof getDb>;

export type PipelineWriteRefusal = 'duplicate' | 'unknown_funcao' | 'is_default';

const PIPELINE_NAME_UNIQUE_INDEX = 'sales_ops_pipelines_org_name_idx';

function isPipelineNameViolation(error: unknown): boolean {
  // postgres.js puts code/constraint_name on the error; drizzle re-throws it wrapped under `cause`.
  for (const candidate of [error, (error as { cause?: unknown } | null)?.cause]) {
    const pgError = candidate as { code?: string; constraint_name?: string; constraint?: string } | null | undefined;
    if (pgError?.code !== '23505') continue;
    if ((pgError.constraint_name ?? pgError.constraint) === PIPELINE_NAME_UNIQUE_INDEX) return true;
  }
  return false;
}

/** Every id is a função of the org that is active, or already linked to `pipelineId`. */
async function funcoesAreLinkable(
  tx: Db,
  orgId: string,
  funcaoIds: readonly string[],
  pipelineId: string | null,
): Promise<boolean> {
  if (funcaoIds.length === 0) return true;
  const found = await tx
    .select({ id: salesOpsFuncoes.id, status: salesOpsFuncoes.status })
    .from(salesOpsFuncoes)
    .where(and(eq(salesOpsFuncoes.orgId, orgId), inArray(salesOpsFuncoes.id, [...funcaoIds])));
  if (found.length !== funcaoIds.length) return false;
  const archived = found.filter((funcao) => funcao.status !== 'active').map((funcao) => funcao.id);
  if (archived.length === 0) return true;
  if (pipelineId === null) return false;
  const linked = await tx
    .select({ funcaoId: salesOpsPipelineFuncoes.funcaoId })
    .from(salesOpsPipelineFuncoes)
    .where(
      and(
        eq(salesOpsPipelineFuncoes.orgId, orgId),
        eq(salesOpsPipelineFuncoes.pipelineId, pipelineId),
        inArray(salesOpsPipelineFuncoes.funcaoId, archived),
      ),
    );
  return linked.length === archived.length;
}

/** Full set replacement of the pipeline's funções, scoped to the org and the one pipeline. */
async function replacePipelineFuncoes(tx: Db, orgId: string, pipelineId: string, funcaoIds: readonly string[]) {
  await tx
    .delete(salesOpsPipelineFuncoes)
    .where(and(eq(salesOpsPipelineFuncoes.orgId, orgId), eq(salesOpsPipelineFuncoes.pipelineId, pipelineId)));
  if (funcaoIds.length === 0) return;
  await tx.insert(salesOpsPipelineFuncoes).values(funcaoIds.map((funcaoId) => ({ orgId, pipelineId, funcaoId })));
}

async function viewOf(tx: Db, orgId: string, pipelineId: string): Promise<PipelineView> {
  const [view] = await readPipelineViews(tx, orgId, { ids: [pipelineId], includeArchived: true });
  if (!view) throw new Error(`pipeline ${pipelineId} disappeared inside its own transaction`);
  return view;
}

export function createPipeline(
  db: Db,
  orgId: string,
  input: CreatePipelineInput,
): Promise<PipelineView | PipelineWriteRefusal> {
  return withTenant(db, orgId, async (tx) => {
    // Validated before anything is written: a refusal returns, it does not roll back.
    if (!(await funcoesAreLinkable(tx, orgId, input.funcaoIds, null))) return 'unknown_funcao' as const;
    const created = await createPipelineWithDefaultStages(tx, orgId, input.name);
    if (created === 'duplicate') return created;
    await replacePipelineFuncoes(tx, orgId, created.id, input.funcaoIds);
    return viewOf(tx, orgId, created.id);
  });
}

export function updatePipeline(
  db: Db,
  orgId: string,
  id: string,
  input: UpdatePipelineInput,
): Promise<PipelineView | PipelineWriteRefusal | null> {
  return withTenant(db, orgId, async (tx) => {
    const [current] = await tx
      .select()
      .from(salesOpsPipelines)
      .where(and(eq(salesOpsPipelines.orgId, orgId), eq(salesOpsPipelines.id, id)))
      .limit(1)
      .for('update');
    if (!current) return null;
    if (input.status === 'archived' && current.isDefault) return 'is_default' as const;
    if (input.funcaoIds !== undefined && !(await funcoesAreLinkable(tx, orgId, input.funcaoIds, id))) {
      return 'unknown_funcao' as const;
    }
    if (input.name !== undefined) {
      // Fast path for the answer only; the unique index is the guard (caught below).
      const [clash] = await tx
        .select({ id: salesOpsPipelines.id })
        .from(salesOpsPipelines)
        .where(and(eq(salesOpsPipelines.orgId, orgId), eq(salesOpsPipelines.name, input.name), ne(salesOpsPipelines.id, id)))
        .limit(1);
      if (clash) return 'duplicate' as const;
    }

    const status = input.status ?? current.status;
    try {
      // Inside a SAVEPOINT, so a rename that loses the race leaves the transaction usable.
      await tx.transaction(async (nested) => {
        await nested
          .update(salesOpsPipelines)
          .set({
            ...(input.name !== undefined ? { name: input.name } : {}),
            status,
            ...(current.status !== 'archived' && status === 'archived' ? { archivedAt: new Date() } : {}),
            ...(current.status === 'archived' && status !== 'archived' ? { archivedAt: null } : {}),
            updatedAt: new Date(),
          })
          .where(and(eq(salesOpsPipelines.orgId, orgId), eq(salesOpsPipelines.id, id)));
      });
    } catch (error) {
      if (isPipelineNameViolation(error)) return 'duplicate' as const;
      throw error;
    }
    if (input.funcaoIds !== undefined) await replacePipelineFuncoes(tx, orgId, id, input.funcaoIds);
    return viewOf(tx, orgId, id);
  });
}
