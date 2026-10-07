import { and, desc, eq, isNotNull, sql, type SQL } from 'drizzle-orm';
import type { getDb } from '../../../db/client.js';
import { salesOpsLeadStages, salesOpsLeads } from '../../../db/schema.js';
import { writeAuditEntry } from '../../audit/service.js';
import { LEADS_DEFAULT_LIMIT, type ListDeletedLeadsQuery } from './lead-schemas.js';
import {
  LeadInputError,
  type LeadScope,
  type LeadView,
  firstOpenLeadStage,
  leadIdentityConditions,
  liveLeadCondition,
  lockLeadBoard,
  nextLeadPosition,
  readLeadView,
  renumberStage,
  resolveLeadScopePredicate,
} from './lead-service.js';
import { withTenant } from './with-tenant.js';

/**
 * The lead lixeira: soft delete, restore and the deleted list.
 *
 * This is the ONE lead file that writes the ledger. Moves stay unaudited in
 * `lead-service.ts` (high-frequency noise behind a global tail lock); a delete or
 * a restore is a rare, deliberate act the gestor must be able to trace, so it is
 * audited like an archive. `lead-contract.test.ts` keeps the audit writer out of
 * `lead-service.ts` and pins both writes here.
 *
 * It never claims a lead (no seller column is written) and never seeds an etapa.
 *
 * Lock order, the same one every board writer takes: scope gate, `lockLeadBoard`,
 * the card row `FOR UPDATE`, the column renumber, and the ledger entry LAST (its
 * global tail lock is held until COMMIT).
 */

type Db = ReturnType<typeof getDb>;

/** Who deletes or restores, from the VERIFIED context only (route boundary). */
export type LeadActor = { userId: string; name: string | null };

export type DeleteLeadResult =
  | { ok: true }
  | { ok: false; reason: 'not_found' | 'seller_person_unmapped' | 'already_converted' };

export type RestoreLeadResult = { ok: true; lead: LeadView } | { ok: false; reason: 'not_found' };

/** One row of Cadastros > Leads excluídos. `id` is the restore key and is never rendered. */
export type DeletedLeadView = {
  id: string;
  contactName: string;
  clientName: string;
  stageName: string;
  sellerName: string;
  estimatedValueBrl: number;
  deletedAt: string;
  deletedByName: string | null;
};

export type ListDeletedLeadsResult = { items: DeletedLeadView[]; nextCursor: string | null };

/** The inverse of liveLeadCondition(), for the two reads that want deleted rows on purpose. */
function deletedLeadCondition(): SQL {
  return isNotNull(salesOpsLeads.deletedAt);
}

/** The etapa's CURRENT name, for the ledger snapshot. The composite FK guarantees the row. */
async function stageName(tx: Db, orgId: string, stageId: string): Promise<string> {
  const [stage] = await tx
    .select({ name: salesOpsLeadStages.name })
    .from(salesOpsLeadStages)
    .where(and(eq(salesOpsLeadStages.orgId, orgId), eq(salesOpsLeadStages.id, stageId)))
    .limit(1);
  return stage?.name ?? '';
}

export function deleteLead(
  db: Db,
  orgId: string,
  id: string,
  scope: LeadScope,
  actor: LeadActor,
): Promise<DeleteLeadResult> {
  return withTenant(db, orgId, async (tx) => {
    // The same gate every lead read uses: an admin reaches any live lead, an
    // active vendedor his own and the unassigned pool, anyone else his own. A
    // lead outside it is not_found, never forbidden (a 403 confirms the row).
    const gate = await resolveLeadScopePredicate(tx, orgId, scope);
    if (!gate.ok) return { ok: false, reason: gate.reason } as const;
    // Before the card's row lock: a delete renumbers the column, so it is a board
    // writer and takes the one lock order (see lockLeadBoard).
    await lockLeadBoard(tx, orgId);

    const [current] = await tx
      .select()
      .from(salesOpsLeads)
      .where(and(...leadIdentityConditions(orgId, id, gate)))
      .limit(1)
      .for('update');
    // Already deleted is not_found too: leadIdentityConditions carries the live predicate.
    if (!current) return { ok: false, reason: 'not_found' } as const;
    // A converted card belongs to its proposta; deleting it would orphan the link.
    if (current.saleId !== null) return { ok: false, reason: 'already_converted' } as const;

    const fromStage = await stageName(tx, orgId, current.stageId);
    const deletedAt = new Date();
    // No seller column, no stage_id, no position: a delete never claims a pool
    // lead and keeps the etapa a restore returns it to.
    await tx
      .update(salesOpsLeads)
      .set({
        deletedAt,
        deletedByUserId: actor.userId,
        deletedByName: actor.name,
        updatedAt: deletedAt,
      })
      .where(and(eq(salesOpsLeads.orgId, orgId), eq(salesOpsLeads.id, id), liveLeadCondition()));

    // The column closes the gap at once, so it stays 1..N over live cards.
    await renumberStage(tx, orgId, current.stageId, null);

    // LAST: the ledger tail lock is global and held until COMMIT.
    await writeAuditEntry(tx, {
      actorUserId: actor.userId,
      // Never null: the org-scoped history read filters on actor_org_id.
      actorOrgId: orgId,
      action: 'lead.deleted',
      entityType: 'lead',
      entityId: id,
      beforeJsonb: { deleted: false },
      afterJsonb: {
        deleted: true,
        label: current.contactName,
        actorLabel: actor.name,
        metadata: {
          contactName: current.contactName,
          clientName: current.clientNameSnapshot,
          stageName: fromStage,
          sellerName: current.sellerNameSnapshot,
        },
      },
    });
    return { ok: true } as const;
  });
}

/** Admin-only at the route; the service takes no scope. */
export function restoreLead(
  db: Db,
  orgId: string,
  id: string,
  actor: LeadActor,
): Promise<RestoreLeadResult> {
  return withTenant(db, orgId, async (tx) => {
    // A restore writes stage_id and position: same lock order as every board writer.
    await lockLeadBoard(tx, orgId);

    const [current] = await tx
      .select()
      .from(salesOpsLeads)
      .where(and(eq(salesOpsLeads.orgId, orgId), eq(salesOpsLeads.id, id), deletedLeadCondition()))
      .limit(1)
      .for('update');
    // A live, unknown or other-org id: there is nothing to restore.
    if (!current) return { ok: false, reason: 'not_found' } as const;

    const [own] = await tx
      .select({
        id: salesOpsLeadStages.id,
        name: salesOpsLeadStages.name,
        status: salesOpsLeadStages.status,
      })
      .from(salesOpsLeadStages)
      .where(and(eq(salesOpsLeadStages.orgId, orgId), eq(salesOpsLeadStages.id, current.stageId)))
      .limit(1);
    // Its own etapa when it is still on the board; an archived etapa is not a
    // move target, so the lead goes where a new lead would. Never seeds one: the
    // leads edition may have none, and that is the existing 400.
    const target =
      own && own.status === 'active'
        ? { id: own.id, name: own.name }
        : await firstOpenLeadStage(tx, orgId);
    if (!target) throw new LeadInputError('no_open_stage');

    const stageChanged = target.id !== current.stageId;
    const position = await nextLeadPosition(tx, orgId, target.id);
    await tx
      .update(salesOpsLeads)
      .set({
        deletedAt: null,
        deletedByUserId: null,
        deletedByName: null,
        stageId: target.id,
        position,
        // KEY OMISSION, the moveLead rule: stage_changed_at moves only when the
        // etapa changes. The fallback target is a normal etapa, which carries no
        // lost reason, so the reason is cleared with it.
        ...(stageChanged ? { stageChangedAt: new Date(), lostReason: null } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(salesOpsLeads.orgId, orgId), eq(salesOpsLeads.id, id), deletedLeadCondition()));
    // Appended at the end; the renumber keeps the column dense even if it was not.
    await renumberStage(tx, orgId, target.id, null);

    const lead = await readLeadView(tx, orgId, id);
    // LAST: the ledger tail lock is global and held until COMMIT. A restore is a
    // NEW entry, never an undo of the delete entry.
    await writeAuditEntry(tx, {
      actorUserId: actor.userId,
      actorOrgId: orgId,
      action: 'lead.restored',
      entityType: 'lead',
      entityId: id,
      beforeJsonb: { deleted: true, stageName: own?.name ?? '' },
      afterJsonb: {
        deleted: false,
        label: current.contactName,
        actorLabel: actor.name,
        metadata: {
          contactName: current.contactName,
          clientName: current.clientNameSnapshot,
          stageName: target.name,
          sellerName: current.sellerNameSnapshot,
        },
      },
    });
    return { ok: true, lead } as const;
  });
}

/** Admin-only at the route. */
export function listDeletedLeads(
  db: Db,
  orgId: string,
  query: ListDeletedLeadsQuery,
): Promise<ListDeletedLeadsResult> {
  return withTenant(db, orgId, async (tx) => {
    const conditions: SQL[] = [eq(salesOpsLeads.orgId, orgId), deletedLeadCondition()];
    if (query.cursor) {
      const [deletedAt, cursorId] = query.cursor.split('_');
      conditions.push(
        sql`(${salesOpsLeads.deletedAt}, ${salesOpsLeads.id}) < (${deletedAt}::timestamptz, ${cursorId}::uuid)`,
      );
    }
    const limit = query.limit ?? LEADS_DEFAULT_LIMIT;
    const rows = await tx
      .select({
        id: salesOpsLeads.id,
        contactName: salesOpsLeads.contactName,
        clientName: salesOpsLeads.clientNameSnapshot,
        // The etapa's CURRENT name, joined live, so a renamed etapa reads renamed.
        stageName: salesOpsLeadStages.name,
        sellerName: salesOpsLeads.sellerNameSnapshot,
        estimatedValueBrl: salesOpsLeads.estimatedValueBrl,
        deletedAt: salesOpsLeads.deletedAt,
        deletedByName: salesOpsLeads.deletedByName,
        // Rendered by Postgres with all six fractional digits: see the cursor
        // comment in lead-schemas.ts for why a JS Date cannot build it.
        cursorAt: sql<string>`to_char(${salesOpsLeads.deletedAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
      })
      .from(salesOpsLeads)
      .innerJoin(
        salesOpsLeadStages,
        and(
          eq(salesOpsLeadStages.orgId, salesOpsLeads.orgId),
          eq(salesOpsLeadStages.id, salesOpsLeads.stageId),
        ),
      )
      .where(and(...conditions))
      .orderBy(desc(salesOpsLeads.deletedAt), desc(salesOpsLeads.id))
      .limit(limit + 1);

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page.at(-1);
    return {
      // Projected field by field: deleted_by_user_id is never selected, so it can
      // never reach a client.
      items: page.map((row) => ({
        id: row.id,
        contactName: row.contactName,
        clientName: row.clientName,
        stageName: row.stageName,
        sellerName: row.sellerName,
        estimatedValueBrl: row.estimatedValueBrl,
        deletedAt: row.deletedAt!.toISOString(),
        deletedByName: row.deletedByName,
      })),
      nextCursor: hasMore && last ? `${last.cursorAt}_${last.id}` : null,
    };
  });
}
