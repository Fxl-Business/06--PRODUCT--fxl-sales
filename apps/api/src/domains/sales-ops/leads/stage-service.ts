import { planPipelineTransitions, type TransitionPlanStage } from '@fxl-sales/shared-utils/crm-model';
import { and, asc, eq, max, ne, or } from 'drizzle-orm';
import type { getDb } from '../../../db/client.js';
import { salesOpsPipelineStages, salesOpsPipelineTransitions } from '../../../db/schema.js';
import { defaultPipelineId, listPipelineStages, pipelineExists } from '../../crm/pipeline-read.js';
import { ensureBareDefaultPipeline } from '../../crm/pipeline-write.js';
import { legacyStageIsSystem, toLeadStageView, type LeadStageView } from '../../crm/stage-view.js';
import { ensureLeadStages } from './stages-seed.js';
import { withTenant } from './with-tenant.js';
import type { LeadStageInput } from './schemas.js';

type Db = ReturnType<typeof getDb>;

export type LeadStageRow = LeadStageView;

/**
 * Phase 2 cutover: these functions read and write the unified `sales_ops_pipeline_stages`. The
 * response keeps the old row shape (`kind`, `isSystem`, derived) and adds `pipelineId`, `type`,
 * `behavior`, `exitKind` and `requiresReason`. Without an explicit pipeline every function works
 * on the org's DEFAULT pipeline.
 *
 * There is exactly ONE duplicate sentinel on this surface.
 *
 * Unlike createFuncao there is no 'duplicate_slug' and no 'reserved_slug': 01
 * ships one uniqueness rule a caller can trip, sales_ops_lead_stages_org_name_idx
 * on (org_id, name), while `kind` carries the stage semantics and is unreachable
 * from the API. Do not re-add the funções' second member by symmetry.
 */
export type LeadStageDuplicate = 'duplicate';

/**
 * Maps a Postgres unique violation on sales_ops_lead_stages onto the service
 * sentinel, so a lost race reports the same reason the pre-check would have.
 * Same shape as mapFuncaoUniqueViolation, keyed on the ONE index name.
 *
 * The (org_id, kind) index is also unique, but nothing in this slice can write
 * `kind`, so it can never be the constraint a PATCH violates.
 */
const LEAD_STAGE_UNIQUE_VIOLATIONS: Record<string, LeadStageDuplicate> = {
  sales_ops_pipeline_stages_org_pipeline_name_idx: 'duplicate',
};

function mapLeadStageUniqueViolation(error: unknown): LeadStageDuplicate | null {
  // postgres.js puts code/constraint_name on the error; drizzle re-throws it
  // wrapped, exposing the original under `cause`.
  const candidates = [error, (error as { cause?: unknown } | null)?.cause];
  for (const candidate of candidates) {
    const pgError = candidate as
      | { code?: string; constraint_name?: string; constraint?: string }
      | null
      | undefined;
    if (!pgError || pgError.code !== '23505') continue;
    const constraint = pgError.constraint_name ?? pgError.constraint;
    const mapped = constraint ? LEAD_STAGE_UNIQUE_VIOLATIONS[constraint] : undefined;
    if (mapped) return mapped;
  }
  return null;
}

/** Per-pipeline uniqueness for the display name. One rule, so one probe. */
async function findLeadStageClash(
  tx: Db,
  orgId: string,
  pipelineId: string,
  name: string,
  excludeId?: string,
): Promise<LeadStageDuplicate | null> {
  const notSelf = excludeId ? [ne(salesOpsPipelineStages.id, excludeId)] : [];
  const [byName] = await tx
    .select({ id: salesOpsPipelineStages.id })
    .from(salesOpsPipelineStages)
    .where(
      and(
        eq(salesOpsPipelineStages.orgId, orgId),
        eq(salesOpsPipelineStages.pipelineId, pipelineId),
        eq(salesOpsPipelineStages.name, name),
        ...notSelf,
      ),
    )
    .limit(1);
  return byName ? 'duplicate' : null;
}

/** The pipeline a request addresses: the explicit one when it exists in the org, else the default. */
async function resolvePipeline(tx: Db, orgId: string, requested?: string): Promise<string | null> {
  if (requested !== undefined) return (await pipelineExists(tx, orgId, requested)) ? requested : null;
  return defaultPipelineId(tx, orgId);
}

/**
 * The pipeline's stages in board order.
 *
 * It returns ARCHIVED stages too, a deliberate divergence from the four audited
 * cadastros. A lead can still be sitting on a stage an admin just archived, and
 * a lead stage writes NO audit_log entry, so `Histórico de arquivamentos` is not
 * a restore surface for it: the `cadastros/etapas` screen is the only place a
 * stage can be restored from, and it can only offer that if this read returns
 * the archived row. The board filters to `status === 'active'` itself.
 *
 * Seeds the default CRM pipeline when the org has no pipeline row at all (ECV bug); see
 * ensureLeadStages. An unknown `pipelineId` answers an empty list.
 */
export function listLeadStages(db: Db, orgId: string, pipelineId?: string): Promise<LeadStageRow[]> {
  return withTenant(db, orgId, async (tx) => {
    const seeded = await ensureLeadStages(tx, orgId);
    if (pipelineId === undefined) return seeded;
    if (!(await pipelineExists(tx, orgId, pipelineId))) return [];
    return (await listPipelineStages(tx, orgId, pipelineId)).map(toLeadStageView);
  });
}

export type LeadStageCreateInput = LeadStageInput & { pipelineId?: string | undefined };

/** Creates a stage in the org's DEFAULT pipeline (the import executor and every pre-cutover caller). */
export async function createLeadStage(
  db: Db,
  orgId: string,
  data: LeadStageInput,
): Promise<LeadStageRow | LeadStageDuplicate> {
  // Without a pipelineId the default pipeline is used, so 'pipeline_not_found' is unreachable.
  return (await createLeadStageInPipeline(db, orgId, data)) as LeadStageRow | LeadStageDuplicate;
}

export function createLeadStageInPipeline(
  db: Db,
  orgId: string,
  data: LeadStageCreateInput,
): Promise<LeadStageRow | LeadStageDuplicate | 'pipeline_not_found'> {
  return withTenant(db, orgId, async (tx) => {
    // An org that never read its etapas has no pipeline yet: its first etapa creates the bare
    // default pipeline and the org is then never seeded (the pre-cutover "own first etapa" rule).
    const pipelineId =
      data.pipelineId === undefined
        ? await ensureBareDefaultPipeline(tx, orgId)
        : await resolvePipeline(tx, orgId, data.pipelineId);
    if (pipelineId === null) return 'pipeline_not_found' as const;

    // Fast path, purely for the error message: it names which rule was hit
    // without waiting on a lock. It is NOT the guard - see the conflict clause.
    const clash = await findLeadStageClash(tx, orgId, pipelineId, data.name);
    if (clash) return clash;

    // The max is taken over EVERY stage in the pipeline, archived included, so a new
    // stage can never land on an archived stage's position and a later restore
    // cannot collide. A count(*)-based position would.
    const [{ value: highest } = { value: null }] = await tx
      .select({ value: max(salesOpsPipelineStages.position) })
      .from(salesOpsPipelineStages)
      .where(and(eq(salesOpsPipelineStages.orgId, orgId), eq(salesOpsPipelineStages.pipelineId, pipelineId)));
    const position = (highest ?? -1) + 1;

    const [stage] = await tx
      .insert(salesOpsPipelineStages)
      // `type`, `behavior` and `exitKind` are written LITERALLY here and never spread from
      // `data`: a stage minted through this API is always an ordinary open stage.
      .values({
        orgId,
        pipelineId,
        name: data.name,
        status: data.status,
        position,
        type: 'normal',
        behavior: 'none',
        exitKind: null,
        requiresReason: false,
      })
      // The probe above is a time-of-check/time-of-use race: a concurrent writer
      // (an admin double-clicking Save is enough) can land the same name in
      // between, and a plain INSERT would raise 23505 and escape as an HTTP 500
      // instead of the designed 409. Absorbing the conflict here makes
      // sales_ops_pipeline_stages_org_pipeline_name_idx the ACTUAL guard.
      .onConflictDoNothing()
      .returning();
    if (!stage) {
      // Lost the race. Re-probe under a fresh statement snapshot, which now sees
      // the committed winner, and fall back to the name reason.
      return (await findLeadStageClash(tx, orgId, pipelineId, data.name)) ?? ('duplicate' as const);
    }
    await addTransitionsForNewStage(tx, orgId, pipelineId, stage.id);
    return toLeadStageView(stage);
  });
}

/**
 * A stage restored from the archive that has NO edge in either direction (it was migrated or
 * created while archived, so the rule never linked it) gets the edges the shared rule gives a new
 * stage. A stage that already has any edge keeps the graph the org shaped.
 */
async function restoreTransitionsIfDisconnected(
  tx: Db,
  orgId: string,
  pipelineId: string,
  stageId: string,
): Promise<void> {
  const [edge] = await tx
    .select({ id: salesOpsPipelineTransitions.id })
    .from(salesOpsPipelineTransitions)
    .where(
      and(
        eq(salesOpsPipelineTransitions.orgId, orgId),
        or(eq(salesOpsPipelineTransitions.fromStageId, stageId), eq(salesOpsPipelineTransitions.toStageId, stageId)),
      ),
    )
    .limit(1);
  if (edge) return;
  await addTransitionsForNewStage(tx, orgId, pipelineId, stageId);
}

/**
 * A new open stage must be reachable: the explicit transition graph says "a pair that is absent is
 * not allowed". The pairs the shared rule (`planPipelineTransitions`) gives the new stage - to and
 * from the previous open stage, to every exit, and from the pausado exit - are inserted; pairs
 * between OTHER stages are never touched, so a graph the org shaped stays as it is.
 */
async function addTransitionsForNewStage(
  tx: Db,
  orgId: string,
  pipelineId: string,
  stageId: string,
): Promise<void> {
  const stages = await listPipelineStages(tx, orgId, pipelineId);
  const plan = stages.map((stage) => ({ ...stage, type: stage.type as TransitionPlanStage['type'], exitKind: stage.exitKind as TransitionPlanStage['exitKind'], status: stage.status as TransitionPlanStage['status'] }));
  const pairs = planPipelineTransitions(plan).filter(([from, to]) => from === stageId || to === stageId);
  if (pairs.length === 0) return;
  await tx
    .insert(salesOpsPipelineTransitions)
    .values(pairs.map(([fromStageId, toStageId]) => ({ orgId, pipelineId, fromStageId, toStageId })))
    .onConflictDoNothing();
}

export function updateLeadStage(
  db: Db,
  orgId: string,
  id: string,
  data: Partial<LeadStageInput>,
): Promise<LeadStageRow | null | 'is_system' | LeadStageDuplicate> {
  return withTenant(db, orgId, async (tx) => {
    const [current] = await tx
      .select()
      .from(salesOpsPipelineStages)
      .where(and(eq(salesOpsPipelineStages.orgId, orgId), eq(salesOpsPipelineStages.id, id)))
      .limit(1)
      .for('update');
    if (!current) return null;
    // Byte-for-byte the funções rule: a system stage (the conversion and the lost etapa) is fully
    // immutable through this endpoint - no rename, no archive, no restore. Its POSITION is still
    // reorderable, which reorderLeadStages does without going through here.
    if (legacyStageIsSystem(current) && (data.name !== undefined || data.status !== undefined)) {
      return 'is_system' as const;
    }

    if (data.name !== undefined) {
      // Fast path for the error message only; the unique index is the real guard.
      const clash = await findLeadStageClash(tx, orgId, current.pipelineId, data.name, id);
      if (clash) return clash;
    }

    // UPDATE has no ON CONFLICT clause, so the same TOCTOU race as
    // createLeadStage is handled by catching the unique violation. The write runs
    // inside a SAVEPOINT (a nested drizzle transaction) so a rejected rename
    // leaves the surrounding transaction usable rather than poisoned.
    let stage: LeadStageRow | null;
    try {
      stage = await tx.transaction(async (nested) => {
        const [row] = await nested
          .update(salesOpsPipelineStages)
          .set({
            ...data,
            ...archivedAtPatch(current.status, data.status ?? current.status),
            updatedAt: new Date(),
          })
          .where(and(eq(salesOpsPipelineStages.orgId, orgId), eq(salesOpsPipelineStages.id, id)))
          .returning();
        return row ? toLeadStageView(row) : null;
      });
    } catch (error) {
      const violated = mapLeadStageUniqueViolation(error);
      if (violated) return violated;
      throw error;
    }
    if (current.status === 'archived' && stage?.status === 'active') {
      await restoreTransitionsIfDisconnected(tx, orgId, current.pipelineId, id);
    }
    // Deliberately NO auditCadastroLifecycle call. The ledger is a closed wire
    // contract whose CadastroEntityTypeSchema is the four audited cadastros, and
    // a fifth entity type would be an entity the history UI cannot render and the
    // nightly purge would eventually hard-delete a stage leads still point at.
    return stage;
  });
}

/**
 * The same rule as sales_ops_areas.archived_at, written locally because
 * `archivedAtPatch` in service.ts is private there. It is set so a future purge
 * has the timestamp it would need; nothing in this feature reads it, and
 * runArchivedCadastroPurge is deliberately NOT extended to lead stages.
 */
function archivedAtPatch(before: string, after: string): { archivedAt?: Date | null } {
  if (before !== 'archived' && after === 'archived') return { archivedAt: new Date() };
  if (before === 'archived' && after !== 'archived') return { archivedAt: null };
  return {};
}

/**
 * Writes a total order over the pipeline's ACTIVE stages, in ONE transaction.
 *
 * - The payload is the COMPLETE ordered set of the pipeline's active stage ids, or it
 *   is rejected. A partial "move stage X to index 3" payload cannot express the
 *   result without the server re-deriving every other position, and two admins
 *   doing that concurrently interleave into an order neither asked for. A total
 *   payload makes the write idempotent and replay safe.
 * - ARCHIVED stages are excluded and keep their stored positions: they are not on
 *   the board, so they have no order to express.
 * - `.for('update')` runs before any write, so two concurrent reorders serialize
 *   at Postgres rather than half-applying each other.
 * - `position` is deliberately NOT unique-indexed. The loop necessarily passes
 *   through states where two rows share an index, and a non-deferrable unique
 *   index would abort the transaction. This endpoint is the only writer of
 *   position after create and it writes a total order, so uniqueness is an
 *   invariant of the writer rather than of the schema.
 * - It writes the stage rows and NOTHING else. No lead row is read or written, so no lead's
 *   stage_changed_at can move, and the transition graph is explicit data: reordering never
 *   regenerates it.
 */
/** Reorders the DEFAULT pipeline's active stages. */
export async function reorderLeadStages(
  db: Db,
  orgId: string,
  stageIds: string[],
): Promise<LeadStageRow[] | 'set_mismatch'> {
  return (await reorderLeadStagesInPipeline(db, orgId, stageIds, undefined)) as LeadStageRow[] | 'set_mismatch';
}

export function reorderLeadStagesInPipeline(
  db: Db,
  orgId: string,
  stageIds: string[],
  pipelineId: string | undefined,
): Promise<LeadStageRow[] | 'set_mismatch' | 'pipeline_not_found'> {
  return withTenant(db, orgId, async (tx) => {
    const resolved = await resolvePipeline(tx, orgId, pipelineId);
    if (resolved === null) return (pipelineId === undefined ? 'set_mismatch' : 'pipeline_not_found') as 'set_mismatch';
    const active = await tx
      .select({ id: salesOpsPipelineStages.id })
      .from(salesOpsPipelineStages)
      .where(
        and(
          eq(salesOpsPipelineStages.orgId, orgId),
          eq(salesOpsPipelineStages.pipelineId, resolved),
          eq(salesOpsPipelineStages.status, 'active'),
        ),
      )
      .orderBy(asc(salesOpsPipelineStages.position))
      .for('update');

    // Full-set equality, both directions. The schema already refused duplicates,
    // so equal lengths plus every id known is set equality.
    if (active.length !== stageIds.length) return 'set_mismatch' as const;
    const known = new Set(active.map((row) => row.id));
    if (stageIds.some((id) => !known.has(id))) return 'set_mismatch' as const;

    for (const [index, id] of stageIds.entries()) {
      await tx
        .update(salesOpsPipelineStages)
        .set({ position: index, updatedAt: new Date() })
        .where(and(eq(salesOpsPipelineStages.orgId, orgId), eq(salesOpsPipelineStages.id, id)));
    }

    return (await listPipelineStages(tx, orgId, resolved)).map(toLeadStageView);
  });
}
