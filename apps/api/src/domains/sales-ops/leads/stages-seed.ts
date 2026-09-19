import { asc, eq } from 'drizzle-orm';
import type { getDb } from '../../../db/client.js';
import { salesOpsLeadStages } from '../../../db/schema.js';
import { withTenant } from '../service.js';

type Db = ReturnType<typeof getDb>;

export type LeadStageKind = 'normal' | 'conversion' | 'lost';
export type LeadStageRow = typeof salesOpsLeadStages.$inferSelect;

/**
 * The default pipeline written for every org. Byte-identical to the VALUES list
 * in migration 0022 - if these two ever disagree, an org provisioned before the
 * deploy and one provisioned after get different boards.
 * `leads-schema-migration.test.ts` asserts they agree.
 *
 * Four stages, only two of them system: two would leave an org with a conversion
 * column and a Perdido column and nowhere for a lead to start. `Novo` and
 * `Em negociação` are ordinary, renameable, archivable rows the org owns - the
 * same shape as 0012's `prestador` bucket next to its reserved rows.
 */
export const LEAD_STAGE_SEEDS = [
  { name: 'Novo', kind: 'normal', isSystem: false, position: 1 },
  { name: 'Em negociação', kind: 'normal', isSystem: false, position: 2 },
  { name: 'Proposta', kind: 'conversion', isSystem: true, position: 3 },
  { name: 'Perdido', kind: 'lost', isSystem: true, position: 4 },
] as const satisfies readonly {
  name: string;
  kind: LeadStageKind;
  isSystem: boolean;
  position: number;
}[];

/** The two stage kinds the API refuses to rename, archive or create. */
export const SYSTEM_LEAD_STAGE_KINDS = ['conversion', 'lost'] as const;

/**
 * Reads the org's stages in board order.
 *
 * The explicit `eq(salesOpsLeadStages.orgId, orgId)` is defence in depth and NOT
 * redundant with RLS: over the `app.fxl_admin` connection the admin policy makes
 * every org's rows visible, and this filter is then the only thing scoping the
 * read.
 */
function selectStages(tx: Db, orgId: string): Promise<LeadStageRow[]> {
  return tx
    .select()
    .from(salesOpsLeadStages)
    .where(eq(salesOpsLeadStages.orgId, orgId))
    .orderBy(asc(salesOpsLeadStages.position), asc(salesOpsLeadStages.name));
}

/**
 * Seeds the default pipeline for an org that does not have it yet and returns the
 * org's stages in board order. MUST be called inside an already tenant-scoped
 * transaction; see {@link ensureLeadStagesForOrg} for the entry point that opens
 * one.
 *
 * `isSystem` and `kind` are never taken from a caller - there is no caller
 * parameter at all.
 */
export async function ensureLeadStages(tx: Db, orgId: string): Promise<LeadStageRow[]> {
  const existing = await selectStages(tx, orgId);
  // "Has this org been seeded" is "does it have ANY stage row", not "does it have
  // each of the four". An org that renamed `Novo` to `Prospecção`, or archived
  // it, must never have `Novo` re-inserted underneath it.
  if (existing.length > 0) return existing;

  await tx
    .insert(salesOpsLeadStages)
    .values(
      LEAD_STAGE_SEEDS.map((seed) => ({
        orgId,
        name: seed.name,
        kind: seed.kind,
        isSystem: seed.isSystem,
        position: seed.position,
      })),
    )
    // Bare, i.e. every unique index, NOT a named arbiter. The table carries two
    // unique indexes this seed writes into - (org_id, name) and the partial
    // (org_id, kind) - and naming one makes Postgres raise 23505 whenever it
    // reports the other, turning a concurrent first read into an HTTP 500.
    .onConflictDoNothing();

  // Re-read rather than use `.returning()`: a concurrent first caller can win the
  // race, the conflict is absorbed, and `.returning()` would then come back short.
  return selectStages(tx, orgId);
}

/** Opens the tenant transaction and seeds. The public entry point. */
export async function ensureLeadStagesForOrg(db: Db, orgId: string): Promise<LeadStageRow[]> {
  return withTenant(db, orgId, (tx) => ensureLeadStages(tx, orgId));
}
