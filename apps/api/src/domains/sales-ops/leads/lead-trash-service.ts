import { randomUUID } from 'node:crypto';
import { and, asc, count, desc, eq, isNotNull, isNull, sql, type SQL } from 'drizzle-orm';
import type { getDb } from '../../../db/client.js';
import { auditLog, salesOpsCrmLeads, salesOpsPipelineStages } from '../../../db/schema.js';
import { type WriteAuditEntryInput, writeAuditEntries, writeAuditEntry } from '../../audit/service.js';
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
import { recordStageChange, recordStageChanges, type StageChange } from './lead-history.js';
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
 *
 * The batch pair (`deleteStageLeads`, `restoreLeadBatch`) takes that same order for a
 * whole etapa in ONE transaction: one `lockLeadBoard`, every card locked by one read,
 * set-based UPDATEs, one renumber per column, and every ledger entry at the end through
 * `writeAuditEntries` (one unbroken stretch of the chain). Same rules as the single pair,
 * never a loop over them (a renumber and two ledger round trips per lead is quadratic at
 * a few thousand leads). Neither touches the clientes table or any `client_id`.
 */

type Db = ReturnType<typeof getDb>;

/** Who deletes or restores, from the VERIFIED context only (route boundary). */
export type LeadActor = { userId: string; name: string | null };

export type DeleteLeadResult =
  | { ok: true }
  | { ok: false; reason: 'not_found' | 'seller_person_unmapped' | 'already_converted' };

export type RestoreLeadResult = { ok: true; lead: LeadView } | { ok: false; reason: 'not_found' };

/** `batchId` is null when the etapa had nothing to delete: no batch exists then. */
export type DeleteStageLeadsResult =
  | { ok: true; batchId: string | null; deletedCount: number; skippedConvertedCount: number }
  | { ok: false; reason: 'not_found' };

export type StageDeletePreviewResult =
  | { ok: true; stageName: string; deletableCount: number; skippedConvertedCount: number }
  | { ok: false; reason: 'not_found' };

export type RestoreLeadBatchResult = { ok: true; restoredCount: number } | { ok: false; reason: 'not_found' };

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
  /** The bulk-delete act this lead belongs to; null for a lead deleted on its own. */
  batchId: string | null;
};

export type ListDeletedLeadsResult = { items: DeletedLeadView[]; nextCursor: string | null };

/** The inverse of liveLeadCondition(), for the two reads that want deleted rows on purpose. */
function deletedLeadCondition(): SQL {
  return isNotNull(salesOpsCrmLeads.deletedAt);
}

/** The etapa's CURRENT name, for the ledger snapshot. The composite FK guarantees the row. */
async function stageName(tx: Db, orgId: string, stageId: string): Promise<string> {
  const [stage] = await tx
    .select({ name: salesOpsPipelineStages.name })
    .from(salesOpsPipelineStages)
    .where(and(eq(salesOpsPipelineStages.orgId, orgId), eq(salesOpsPipelineStages.id, stageId)))
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
      .from(salesOpsCrmLeads)
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
      .update(salesOpsCrmLeads)
      .set({
        deletedAt,
        deletedByUserId: actor.userId,
        deletedByName: actor.name,
        // A delete on its own never belongs to a batch.
        deletedBatchId: null,
        updatedAt: deletedAt,
      })
      .where(and(eq(salesOpsCrmLeads.orgId, orgId), eq(salesOpsCrmLeads.id, id), liveLeadCondition()));

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

/** Admins restore any org lead; others restore only their own deletion. */
export function restoreLead(
  db: Db,
  orgId: string,
  id: string,
  isAdmin: boolean,
  actor: LeadActor,
): Promise<RestoreLeadResult> {
  return withTenant(db, orgId, async (tx) => {
    const restoreConditions = and(
      eq(salesOpsCrmLeads.orgId, orgId),
      eq(salesOpsCrmLeads.id, id),
      deletedLeadCondition(),
      ...(isAdmin ? [] : [eq(salesOpsCrmLeads.deletedByUserId, actor.userId)]),
    );
    // A restore writes stage_id and position: same lock order as every board writer.
    await lockLeadBoard(tx, orgId);

    const [current] = await tx
      .select()
      .from(salesOpsCrmLeads)
      .where(restoreConditions)
      .limit(1)
      .for('update');
    // A live, unknown or other-org id: there is nothing to restore.
    if (!current) return { ok: false, reason: 'not_found' } as const;

    const [own] = await tx
      .select({
        id: salesOpsPipelineStages.id,
        name: salesOpsPipelineStages.name,
        status: salesOpsPipelineStages.status,
      })
      .from(salesOpsPipelineStages)
      .where(and(eq(salesOpsPipelineStages.orgId, orgId), eq(salesOpsPipelineStages.id, current.stageId)))
      .limit(1);
    // Its own etapa when it is still on the board; an archived etapa is not a
    // move target, so the lead goes where a new lead would. Never seeds one: the
    // leads edition may have none, and that is the existing 400.
    const target =
      own && own.status === 'active'
        ? { id: own.id, name: own.name }
        : await firstOpenLeadStage(tx, orgId, current.pipelineId);
    if (!target) throw new LeadInputError('no_open_stage');

    const stageChanged = target.id !== current.stageId;
    const position = await nextLeadPosition(tx, orgId, target.id);
    await tx
      .update(salesOpsCrmLeads)
      .set({
        deletedAt: null,
        deletedByUserId: null,
        deletedByName: null,
        // Every restore clears the batch: a lead restored on its own has left it.
        deletedBatchId: null,
        stageId: target.id,
        position,
        // KEY OMISSION, the moveLead rule: stage_changed_at moves only when the
        // etapa changes. The fallback target is a normal etapa, which carries no
        // lost reason, so the reason is cleared with it.
        ...(stageChanged ? { stageChangedAt: sql`now()`, lostReason: null } : {}),
        updatedAt: new Date(),
      })
      .where(restoreConditions);
    // Appended at the end; the renumber keeps the column dense even if it was not.
    await renumberStage(tx, orgId, target.id, null);
    // A restore that lands in another etapa is a stage change like any other: one history event.
    if (stageChanged) {
      await recordStageChange(tx, {
        orgId,
        leadId: id,
        fromStageId: current.stageId,
        toStageId: target.id,
        reason: null,
        actorUserId: actor.userId,
        actorName: actor.name,
      });
    }

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

/** Live, unconverted cards of one etapa: what "Excluir todos os leads desta etapa" takes. */
function deletableInStage(orgId: string, stageId: string): SQL {
  return and(
    eq(salesOpsCrmLeads.orgId, orgId),
    eq(salesOpsCrmLeads.stageId, stageId),
    liveLeadCondition(),
    isNull(salesOpsCrmLeads.saleId),
  ) as SQL;
}

/** Live converted cards of one etapa: they belong to their proposta and are never deleted here. */
function convertedInStage(orgId: string, stageId: string): SQL {
  return and(
    eq(salesOpsCrmLeads.orgId, orgId),
    eq(salesOpsCrmLeads.stageId, stageId),
    liveLeadCondition(),
    isNotNull(salesOpsCrmLeads.saleId),
  ) as SQL;
}

async function countWhere(tx: Db, where: SQL): Promise<number> {
  const [row] = await tx.select({ n: count() }).from(salesOpsCrmLeads).where(where);
  return Number(row?.n ?? 0);
}

/**
 * What the bulk delete would do right now, for the confirmation dialog: the etapa's name,
 * how many cards go and how many converted ones stay. Read only, admin-only at the route.
 */
export function previewStageDelete(db: Db, orgId: string, stageId: string): Promise<StageDeletePreviewResult> {
  return withTenant(db, orgId, async (tx) => {
    const [stage] = await tx
      .select({ name: salesOpsPipelineStages.name })
      .from(salesOpsPipelineStages)
      .where(and(eq(salesOpsPipelineStages.orgId, orgId), eq(salesOpsPipelineStages.id, stageId)))
      .limit(1);
    if (!stage) return { ok: false, reason: 'not_found' } as const;
    return {
      ok: true,
      stageName: stage.name,
      deletableCount: await countWhere(tx, deletableInStage(orgId, stageId)),
      skippedConvertedCount: await countWhere(tx, convertedInStage(orgId, stageId)),
    } as const;
  });
}

/**
 * Soft-deletes every live, unconverted lead of one etapa in ONE transaction, all stamped with
 * one batch id, with the rules of `deleteLead`: `lockLeadBoard` first, the cards locked by
 * one read, no seller/stage/position write, the column renumbered (only converted cards are
 * left in it), one `lead.deleted` entry per lead LAST. Converted cards stay live and are only
 * counted. An unknown or other-org etapa is `not_found`; an etapa with nothing to delete
 * writes nothing and answers a null batch. Admin-only at the route, so there is no scope gate.
 */
export function deleteStageLeads(
  db: Db,
  orgId: string,
  stageId: string,
  actor: LeadActor,
): Promise<DeleteStageLeadsResult> {
  return withTenant(db, orgId, async (tx) => {
    const [stage] = await tx
      .select({ name: salesOpsPipelineStages.name })
      .from(salesOpsPipelineStages)
      .where(and(eq(salesOpsPipelineStages.orgId, orgId), eq(salesOpsPipelineStages.id, stageId)))
      .limit(1);
    if (!stage) return { ok: false, reason: 'not_found' } as const;
    // A board writer: the one lock order (see lockLeadBoard), before any card row lock.
    await lockLeadBoard(tx, orgId);

    const cards = await tx
      .select({
        id: salesOpsCrmLeads.id,
        contactName: salesOpsCrmLeads.contactName,
        clientName: salesOpsCrmLeads.clientNameSnapshot,
        sellerName: salesOpsCrmLeads.sellerNameSnapshot,
      })
      .from(salesOpsCrmLeads)
      .where(deletableInStage(orgId, stageId))
      .orderBy(asc(salesOpsCrmLeads.position), asc(salesOpsCrmLeads.id))
      .for('update');
    const skippedConvertedCount = await countWhere(tx, convertedInStage(orgId, stageId));
    if (cards.length === 0) return { ok: true, batchId: null, deletedCount: 0, skippedConvertedCount } as const;

    const batchId = randomUUID();
    const deletedAt = new Date();
    // The same columns as deleteLead plus the batch id: no seller column, no stage_id, no
    // position, so a restore knows the etapa each card returns to.
    const updated = await tx
      .update(salesOpsCrmLeads)
      .set({
        deletedAt,
        deletedByUserId: actor.userId,
        deletedByName: actor.name,
        deletedBatchId: batchId,
        updatedAt: deletedAt,
      })
      .where(deletableInStage(orgId, stageId))
      .returning({ id: salesOpsCrmLeads.id });
    // The cards are locked, so the two reads agree; a difference would be a lost write.
    if (updated.length !== cards.length) throw new Error('lead_batch_delete_mismatch');

    await renumberStage(tx, orgId, stageId, null);

    // LAST: the ledger tail lock is global and held until COMMIT.
    await writeAuditEntries(
      tx,
      cards.map(
        (card): WriteAuditEntryInput => ({
          actorUserId: actor.userId,
          actorOrgId: orgId,
          action: 'lead.deleted',
          entityType: 'lead',
          entityId: card.id,
          beforeJsonb: { deleted: false },
          afterJsonb: {
            deleted: true,
            label: card.contactName,
            actorLabel: actor.name,
            // Lets a batch restore tell "already restored" from "never existed".
            batchId,
            metadata: {
              contactName: card.contactName,
              clientName: card.clientName,
              stageName: stage.name,
              sellerName: card.sellerName,
            },
          },
        }),
      ),
    );
    return { ok: true, batchId, deletedCount: cards.length, skippedConvertedCount } as const;
  });
}

/**
 * Restores every lead still in a bulk-delete batch with the rules of `restoreLead`: its own
 * etapa when still active, else the first open etapa of its pipeline (one `stage_changed`
 * event each, `lost_reason` cleared); appended at the end of the column in the order they
 * had; the column renumbered dense; one `lead.restored` entry per lead LAST. A lead that left
 * the batch (restored on its own, or restored and deleted again) is not touched. Admin-only
 * at the route. A batch that was fully restored answers 0; a batch that never existed in the
 * org is `not_found`.
 */
export function restoreLeadBatch(
  db: Db,
  orgId: string,
  batchId: string,
  actor: LeadActor,
): Promise<RestoreLeadBatchResult> {
  return withTenant(db, orgId, async (tx) => {
    // A restore writes stage_id and position: same lock order as every board writer.
    await lockLeadBoard(tx, orgId);

    const cards = await tx
      .select({
        id: salesOpsCrmLeads.id,
        stageId: salesOpsCrmLeads.stageId,
        pipelineId: salesOpsCrmLeads.pipelineId,
        contactName: salesOpsCrmLeads.contactName,
        clientName: salesOpsCrmLeads.clientNameSnapshot,
        sellerName: salesOpsCrmLeads.sellerNameSnapshot,
      })
      .from(salesOpsCrmLeads)
      .where(
        and(
          eq(salesOpsCrmLeads.orgId, orgId),
          eq(salesOpsCrmLeads.deletedBatchId, batchId),
          deletedLeadCondition(),
        ),
      )
      .orderBy(asc(salesOpsCrmLeads.position), asc(salesOpsCrmLeads.id))
      .for('update');

    if (cards.length === 0) {
      // Restores clear the batch id, so "restored already" and "never existed" look alike on
      // the rows; the delete entries (org-scoped) tell them apart.
      const [seen] = await tx
        .select({ id: auditLog.id })
        .from(auditLog)
        .where(
          and(
            eq(auditLog.actorOrgId, orgId),
            eq(auditLog.action, 'lead.deleted'),
            sql`${auditLog.afterJsonb}->>'batchId' = ${batchId}`,
          ),
        )
        .limit(1);
      return seen ? ({ ok: true, restoredCount: 0 } as const) : ({ ok: false, reason: 'not_found' } as const);
    }

    const byStage = new Map<string, typeof cards>();
    for (const card of cards) {
      const group = byStage.get(card.stageId);
      if (group) group.push(card);
      else byStage.set(card.stageId, [card]);
    }

    const changes: StageChange[] = [];
    const entries: WriteAuditEntryInput[] = [];
    for (const [ownStageId, group] of byStage) {
      const [own] = await tx
        .select({
          id: salesOpsPipelineStages.id,
          name: salesOpsPipelineStages.name,
          status: salesOpsPipelineStages.status,
        })
        .from(salesOpsPipelineStages)
        .where(and(eq(salesOpsPipelineStages.orgId, orgId), eq(salesOpsPipelineStages.id, ownStageId)))
        .limit(1);
      // The restoreLead rule: its own etapa while it is on the board, else where a new lead
      // would land. Never seeds one; none open is the existing 400.
      const target =
        own && own.status === 'active'
          ? { id: own.id, name: own.name }
          : await firstOpenLeadStage(tx, orgId, group[0]!.pipelineId);
      if (!target) throw new LeadInputError('no_open_stage');
      const stageChanged = target.id !== ownStageId;
      const base = await nextLeadPosition(tx, orgId, target.id);

      // One set-based UPDATE per etapa; the ids ride as ONE jsonb parameter and their order
      // (WITH ORDINALITY) is the original card order, appended after the live cards.
      await tx.execute(sql`
        UPDATE sales_ops_crm_leads AS l SET
          deleted_at = NULL, deleted_by_user_id = NULL, deleted_by_name = NULL, deleted_batch_id = NULL,
          stage_id = ${target.id}::uuid,
          "position" = (${base}::int + v.ord::int - 1),
          ${stageChanged ? sql`stage_changed_at = now(), lost_reason = NULL,` : sql``}
          updated_at = now()
        FROM jsonb_array_elements_text(${JSON.stringify(group.map((card) => card.id))}::jsonb)
          WITH ORDINALITY AS v(id, ord)
        WHERE l.org_id = ${orgId} AND l.id = v.id::uuid
          AND l.deleted_batch_id = ${batchId}::uuid AND l.deleted_at IS NOT NULL
      `);
      // Appended at the end; the renumber keeps the column dense even if it was not.
      await renumberStage(tx, orgId, target.id, null);

      for (const card of group) {
        if (stageChanged) {
          changes.push({
            orgId,
            leadId: card.id,
            fromStageId: ownStageId,
            toStageId: target.id,
            reason: null,
            actorUserId: actor.userId,
            actorName: actor.name,
          });
        }
        entries.push({
          actorUserId: actor.userId,
          actorOrgId: orgId,
          action: 'lead.restored',
          entityType: 'lead',
          entityId: card.id,
          beforeJsonb: { deleted: true, stageName: own?.name ?? '' },
          afterJsonb: {
            deleted: false,
            label: card.contactName,
            actorLabel: actor.name,
            batchId,
            metadata: {
              contactName: card.contactName,
              clientName: card.clientName,
              stageName: target.name,
              sellerName: card.sellerName,
            },
          },
        });
      }
    }
    await recordStageChanges(tx, changes);
    // LAST: the ledger tail lock is global and held until COMMIT. A restore is a NEW entry.
    await writeAuditEntries(tx, entries);
    return { ok: true, restoredCount: cards.length } as const;
  });
}

/** Admin-only at the route. */
export function listDeletedLeads(
  db: Db,
  orgId: string,
  query: ListDeletedLeadsQuery,
): Promise<ListDeletedLeadsResult> {
  return withTenant(db, orgId, async (tx) => {
    const conditions: SQL[] = [eq(salesOpsCrmLeads.orgId, orgId), deletedLeadCondition()];
    if (query.cursor) {
      const [deletedAt, cursorId] = query.cursor.split('_');
      conditions.push(
        sql`(${salesOpsCrmLeads.deletedAt}, ${salesOpsCrmLeads.id}) < (${deletedAt}::timestamptz, ${cursorId}::uuid)`,
      );
    }
    const limit = query.limit ?? LEADS_DEFAULT_LIMIT;
    const rows = await tx
      .select({
        id: salesOpsCrmLeads.id,
        contactName: salesOpsCrmLeads.contactName,
        clientName: salesOpsCrmLeads.clientNameSnapshot,
        // The etapa's CURRENT name, joined live, so a renamed etapa reads renamed.
        stageName: salesOpsPipelineStages.name,
        sellerName: salesOpsCrmLeads.sellerNameSnapshot,
        estimatedValueBrl: salesOpsCrmLeads.estimatedValueBrl,
        deletedAt: salesOpsCrmLeads.deletedAt,
        deletedByName: salesOpsCrmLeads.deletedByName,
        batchId: salesOpsCrmLeads.deletedBatchId,
        // Rendered by Postgres with all six fractional digits: see the cursor
        // comment in lead-schemas.ts for why a JS Date cannot build it.
        cursorAt: sql<string>`to_char(${salesOpsCrmLeads.deletedAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
      })
      .from(salesOpsCrmLeads)
      .innerJoin(
        salesOpsPipelineStages,
        and(
          eq(salesOpsPipelineStages.orgId, salesOpsCrmLeads.orgId),
          eq(salesOpsPipelineStages.id, salesOpsCrmLeads.stageId),
        ),
      )
      .where(and(...conditions))
      .orderBy(desc(salesOpsCrmLeads.deletedAt), desc(salesOpsCrmLeads.id))
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
        batchId: row.batchId,
      })),
      nextCursor: hasMore && last ? `${last.cursorAt}_${last.id}` : null,
    };
  });
}
