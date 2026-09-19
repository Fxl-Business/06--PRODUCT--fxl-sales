import { and, asc, eq, max, ne } from 'drizzle-orm';
import type { getDb } from '../../../db/client.js';
import { salesOpsLeadStages } from '../../../db/schema.js';
import { withTenant } from './with-tenant.js';
import type { LeadStageInput } from './schemas.js';

type Db = ReturnType<typeof getDb>;

export type LeadStageRow = typeof salesOpsLeadStages.$inferSelect;

/**
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
  sales_ops_lead_stages_org_name_idx: 'duplicate',
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

/** Per-org uniqueness for the display name. One rule, so one probe. */
async function findLeadStageClash(
  tx: Db,
  orgId: string,
  name: string,
  excludeId?: string,
): Promise<LeadStageDuplicate | null> {
  const notSelf = excludeId ? [ne(salesOpsLeadStages.id, excludeId)] : [];
  const [byName] = await tx
    .select({ id: salesOpsLeadStages.id })
    .from(salesOpsLeadStages)
    .where(and(eq(salesOpsLeadStages.orgId, orgId), eq(salesOpsLeadStages.name, name), ...notSelf))
    .limit(1);
  return byName ? 'duplicate' : null;
}

/**
 * The org's stages in board order.
 *
 * It returns ARCHIVED stages too, a deliberate divergence from the four audited
 * cadastros. A lead can still be sitting on a stage an admin just archived, and
 * a lead stage writes NO audit_log entry, so `Histórico de arquivamentos` is not
 * a restore surface for it: the `cadastros/etapas` screen is the only place a
 * stage can be restored from, and it can only offer that if this read returns
 * the archived row. The board filters to `status === 'active'` itself.
 *
 * `name` is the tiebreaker so the order is total even before the first reorder,
 * when the seed may have written equal positions.
 */
export function listLeadStages(db: Db, orgId: string): Promise<LeadStageRow[]> {
  return withTenant(db, orgId, (tx) =>
    tx
      .select()
      .from(salesOpsLeadStages)
      .where(eq(salesOpsLeadStages.orgId, orgId))
      .orderBy(asc(salesOpsLeadStages.position), asc(salesOpsLeadStages.name)),
  );
}

export function createLeadStage(
  db: Db,
  orgId: string,
  data: LeadStageInput,
): Promise<LeadStageRow | LeadStageDuplicate> {
  return withTenant(db, orgId, async (tx) => {
    // Fast path, purely for the error message: it names which rule was hit
    // without waiting on a lock. It is NOT the guard - see the conflict clause.
    const clash = await findLeadStageClash(tx, orgId, data.name);
    if (clash) return clash;

    // The max is taken over EVERY stage in the org, archived included, so a new
    // stage can never land on an archived stage's position and a later restore
    // cannot collide. A count(*)-based position would.
    const [{ value: highest } = { value: null }] = await tx
      .select({ value: max(salesOpsLeadStages.position) })
      .from(salesOpsLeadStages)
      .where(eq(salesOpsLeadStages.orgId, orgId));
    const position = (highest ?? -1) + 1;

    const [stage] = await tx
      .insert(salesOpsLeadStages)
      // `isSystem` and `kind` are written LITERALLY here and never spread from
      // `data` - the same reason createFuncao writes isSystem: false literally.
      // Only the migration seed may mint a system stage.
      .values({ ...data, orgId, position, isSystem: false, kind: 'normal' })
      // The probe above is a time-of-check/time-of-use race: a concurrent writer
      // (an admin double-clicking Save is enough) can land the same name in
      // between, and a plain INSERT would raise 23505 and escape as an HTTP 500
      // instead of the designed 409. Absorbing the conflict here makes
      // sales_ops_lead_stages_org_name_idx the ACTUAL guard.
      .onConflictDoNothing()
      .returning();
    if (stage) return stage;
    // Lost the race. Re-probe under a fresh statement snapshot, which now sees
    // the committed winner, and fall back to the name reason.
    return (await findLeadStageClash(tx, orgId, data.name)) ?? ('duplicate' as const);
  });
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
      .from(salesOpsLeadStages)
      .where(and(eq(salesOpsLeadStages.orgId, orgId), eq(salesOpsLeadStages.id, id)))
      .limit(1)
      .for('update');
    if (!current) return null;
    // Byte-for-byte the funções rule: a system stage is fully immutable through
    // this endpoint - no rename, no archive, no restore. Its POSITION is still
    // reorderable, which reorderLeadStages does without going through here.
    if (current.isSystem && (data.name !== undefined || data.status !== undefined)) {
      return 'is_system' as const;
    }

    if (data.name !== undefined) {
      // Fast path for the error message only; the unique index is the real guard.
      const clash = await findLeadStageClash(tx, orgId, data.name, id);
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
          .update(salesOpsLeadStages)
          .set({
            ...data,
            ...archivedAtPatch(current.status, data.status ?? current.status),
            updatedAt: new Date(),
          })
          .where(and(eq(salesOpsLeadStages.orgId, orgId), eq(salesOpsLeadStages.id, id)))
          .returning();
        return row ?? null;
      });
    } catch (error) {
      const violated = mapLeadStageUniqueViolation(error);
      if (violated) return violated;
      throw error;
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
 * Writes a total order over the org's ACTIVE stages, in ONE transaction.
 *
 * - The payload is the COMPLETE ordered set of the org's active stage ids, or it
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
 * - It writes sales_ops_lead_stages and NOTHING else. No lead row is read or
 *   written, so no lead's stage_changed_at can move.
 */
export function reorderLeadStages(
  db: Db,
  orgId: string,
  stageIds: string[],
): Promise<LeadStageRow[] | 'set_mismatch'> {
  return withTenant(db, orgId, async (tx) => {
    const active = await tx
      .select({ id: salesOpsLeadStages.id })
      .from(salesOpsLeadStages)
      .where(and(eq(salesOpsLeadStages.orgId, orgId), eq(salesOpsLeadStages.status, 'active')))
      .orderBy(asc(salesOpsLeadStages.position))
      .for('update');

    // Full-set equality, both directions. The schema already refused duplicates,
    // so equal lengths plus every id known is set equality.
    if (active.length !== stageIds.length) return 'set_mismatch' as const;
    const known = new Set(active.map((row) => row.id));
    if (stageIds.some((id) => !known.has(id))) return 'set_mismatch' as const;

    for (const [index, id] of stageIds.entries()) {
      await tx
        .update(salesOpsLeadStages)
        .set({ position: index, updatedAt: new Date() })
        .where(and(eq(salesOpsLeadStages.orgId, orgId), eq(salesOpsLeadStages.id, id)));
    }

    return tx
      .select()
      .from(salesOpsLeadStages)
      .where(eq(salesOpsLeadStages.orgId, orgId))
      .orderBy(asc(salesOpsLeadStages.position), asc(salesOpsLeadStages.name));
  });
}
