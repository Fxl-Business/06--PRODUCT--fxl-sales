import { ALL_MODULES_ENABLED, stageActsAsOrcamento } from '@fxl-sales/shared-utils/crm-model';
import { and, asc, eq, isNull, or, sql, type SQL } from 'drizzle-orm';
import type { getDb } from '../../../db/client.js';
import {
  salesOpsCrmLeadEvents,
  salesOpsCrmLeadFollowups,
  salesOpsCrmLeadNotes,
  salesOpsCrmLeads,
  salesOpsPeople,
  salesOpsPipelineStages,
  salesOpsPipelineTransitions,
  salesOpsPipelines,
} from '../../../db/schema.js';
import { LeadInputError } from '../../crm/lead-input-error.js';
import type {
  AdvanceLeadInput,
  LeadFollowupInput,
  LeadNoteInput,
  ListFollowupsQuery,
} from './lead-schemas.js';
import { recordStageChange, stageTransitionAllowed } from './lead-history.js';
import {
  claimantFor,
  leadIdentityConditions,
  leadSellerCondition,
  liveLeadCondition,
  lockLeadBoard,
  readLeadView,
  renumberStage,
  resolveCallerPersonId,
  resolveLeadScopePredicate,
  resolveSellerPersonId,
  scopeActorName,
  type LeadScope,
  type LeadView,
  type WriteLeadResult,
} from './lead-service.js';
import { withTenant } from './with-tenant.js';

/**
 * Lead history, follow-ups and the Avançar act (phase 2b). Every function opens the caller's tenant
 * transaction, passes the one seller-scope gate and reads leads only through `leadIdentityConditions`
 * (org + live + seller rule), so an out-of-scope lead is `not_found` here exactly as it is on the
 * board. Actor names are snapshotted from the verified token (`scopeActorName`), never from a body.
 */
type Db = ReturnType<typeof getDb>;

/** Position far past any column length: `renumberStage` clamps it, so the card lands at the END. */
const APPEND = 100_000;

// ─────────────────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────────────────

export type TimelineItem = {
  kind: 'stage_changed' | 'note' | 'followup';
  at: string;
  actorName: string | null;
  fromStageName?: string | null;
  toStageName?: string | null;
  reason?: string | null;
  body?: string;
  nextStep?: string;
  dueOn?: string;
  doneAt?: string | null;
};

export type FollowupView = { id: string; nextStep: string; dueOn: string; ownerName: string | null; doneAt: string | null };

export type LeadSummary = {
  lead: LeadView;
  pipeline: { id: string; name: string };
  stage: { id: string; name: string; type: string; exitKind: string | null };
  nextStages: Array<{ id: string; name: string; type: string; exitKind: string | null; requiresReason: boolean }>;
  timeline: TimelineItem[];
  followups: FollowupView[];
};

export type LeadSummaryResult =
  | { ok: true; summary: LeadSummary }
  | { ok: false; reason: 'not_found' | 'seller_person_unmapped' };

const iso = (value: Date | null): string | null => (value ? value.toISOString() : null);

export function getLeadSummary(db: Db, orgId: string, id: string, scope: LeadScope): Promise<LeadSummaryResult> {
  return withTenant(db, orgId, async (tx) => {
    const gate = await resolveLeadScopePredicate(tx, orgId, scope);
    if (!gate.ok) return { ok: false, reason: gate.reason } as const;
    const [row] = await tx
      .select({ id: salesOpsCrmLeads.id, pipelineId: salesOpsCrmLeads.pipelineId, stageId: salesOpsCrmLeads.stageId })
      .from(salesOpsCrmLeads)
      .where(and(...leadIdentityConditions(orgId, id, gate)))
      .limit(1);
    if (!row) return { ok: false, reason: 'not_found' } as const;

    const lead = await readLeadView(tx, orgId, id);
    const [pipeline] = await tx
      .select({ id: salesOpsPipelines.id, name: salesOpsPipelines.name })
      .from(salesOpsPipelines)
      .where(and(eq(salesOpsPipelines.orgId, orgId), eq(salesOpsPipelines.id, row.pipelineId)))
      .limit(1);
    const stages = await tx
      .select()
      .from(salesOpsPipelineStages)
      .where(and(eq(salesOpsPipelineStages.orgId, orgId), eq(salesOpsPipelineStages.pipelineId, row.pipelineId)))
      .orderBy(asc(salesOpsPipelineStages.position), asc(salesOpsPipelineStages.name));
    const current = stages.find((stage) => stage.id === row.stageId)!;
    const nameOf = new Map(stages.map((stage) => [stage.id, stage.name]));

    // Only the stages the explicit graph allows from the current one, and only active ones.
    const edges = await tx
      .select({ toStageId: salesOpsPipelineTransitions.toStageId })
      .from(salesOpsPipelineTransitions)
      .where(
        and(
          eq(salesOpsPipelineTransitions.orgId, orgId),
          eq(salesOpsPipelineTransitions.pipelineId, row.pipelineId),
          eq(salesOpsPipelineTransitions.fromStageId, row.stageId),
        ),
      );
    const reachable = new Set(edges.map((edge) => edge.toStageId));
    const nextStages = stages
      .filter((stage) => reachable.has(stage.id) && stage.status === 'active')
      .map((stage) => ({ id: stage.id, name: stage.name, type: stage.type, exitKind: stage.exitKind, requiresReason: stage.requiresReason }));

    const events = await tx
      .select()
      .from(salesOpsCrmLeadEvents)
      .where(and(eq(salesOpsCrmLeadEvents.orgId, orgId), eq(salesOpsCrmLeadEvents.leadId, id)));
    const notes = await tx
      .select()
      .from(salesOpsCrmLeadNotes)
      .where(and(eq(salesOpsCrmLeadNotes.orgId, orgId), eq(salesOpsCrmLeadNotes.leadId, id)));
    const followupRows = await tx
      .select()
      .from(salesOpsCrmLeadFollowups)
      .where(and(eq(salesOpsCrmLeadFollowups.orgId, orgId), eq(salesOpsCrmLeadFollowups.leadId, id)))
      .orderBy(asc(salesOpsCrmLeadFollowups.dueOn), asc(salesOpsCrmLeadFollowups.id));

    const timeline: TimelineItem[] = [
      ...events.map((event) => ({
        kind: 'stage_changed' as const,
        at: event.occurredAt.toISOString(),
        actorName: event.actorNameSnapshot,
        fromStageName: event.fromStageId ? (nameOf.get(event.fromStageId) ?? null) : null,
        toStageName: event.toStageId ? (nameOf.get(event.toStageId) ?? null) : null,
        reason: event.reason,
      })),
      ...notes.map((note) => ({
        kind: 'note' as const,
        at: note.createdAt.toISOString(),
        actorName: note.authorNameSnapshot,
        body: note.body,
      })),
      ...followupRows.map((followup) => ({
        kind: 'followup' as const,
        at: followup.createdAt.toISOString(),
        actorName: followup.createdByName,
        nextStep: followup.nextStep,
        dueOn: followup.dueOn,
        doneAt: iso(followup.doneAt),
      })),
    ].sort((a, b) => a.at.localeCompare(b.at));

    return {
      ok: true,
      summary: {
        lead,
        pipeline: pipeline!,
        stage: { id: current.id, name: current.name, type: current.type, exitKind: current.exitKind },
        nextStages,
        timeline,
        followups: followupRows.map((followup) => ({
          id: followup.id,
          nextStep: followup.nextStep,
          dueOn: followup.dueOn,
          ownerName: followup.ownerNameSnapshot,
          doneAt: iso(followup.doneAt),
        })),
      },
    } as const;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Avançar
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Moves a lead along an edge of its pipeline graph and records why, in ONE transaction:
 *  - the move (end of the destination column, `stage_changed_at = now()`, the claim of a pool lead),
 *  - exactly one `stage_changed` event (actor name from the token),
 *  - the note (linked to that event) and the follow-up, when given.
 * Same lock order as `moveLead`: scope gate, board lock, then the card row.
 *
 * Refusals: `409 transition_not_allowed` (pair absent, or a stage of another pipeline);
 * `409 sale_required_for_conversion` (the destination opens a proposta, owned by the wizard);
 * `400 followup_required` (a non-exit destination without próximo passo AND data, or only one of the two);
 * `400 reason_required` (the destination requires a reason).
 */
export function advanceLead(
  db: Db,
  orgId: string,
  id: string,
  input: AdvanceLeadInput,
  scope: LeadScope,
): Promise<WriteLeadResult> {
  return withTenant(db, orgId, async (tx) => {
    const gate = await resolveLeadScopePredicate(tx, orgId, scope);
    if (!gate.ok) return { ok: false, reason: gate.reason } as const;
    await lockLeadBoard(tx, orgId);

    const [current] = await tx
      .select()
      .from(salesOpsCrmLeads)
      .where(and(...leadIdentityConditions(orgId, id, gate)))
      .limit(1)
      .for('update');
    if (!current) return { ok: false, reason: 'not_found' } as const;
    if (current.saleId !== null) return { ok: false, reason: 'already_converted' } as const;

    const [destination] = await tx
      .select()
      .from(salesOpsPipelineStages)
      .where(
        and(
          eq(salesOpsPipelineStages.orgId, orgId),
          eq(salesOpsPipelineStages.id, input.toStageId),
          eq(salesOpsPipelineStages.status, 'active'),
        ),
      )
      .limit(1);
    if (
      !destination ||
      destination.pipelineId !== current.pipelineId ||
      destination.id === current.stageId ||
      !(await stageTransitionAllowed(tx, orgId, current.pipelineId, current.stageId, destination.id))
    ) {
      return { ok: false, reason: 'transition_not_allowed' } as const;
    }
    if (stageActsAsOrcamento(destination, scope.modules ?? ALL_MODULES_ENABLED)) {
      return { ok: false, reason: 'sale_required_for_conversion' } as const;
    }

    const isExit = destination.type === 'saida';
    const hasStep = input.nextStep !== undefined;
    const hasDay = input.dueOn !== undefined;
    if ((!isExit && !(hasStep && hasDay)) || hasStep !== hasDay) throw new LeadInputError('followup_required');
    if (destination.requiresReason && input.reason === undefined) throw new LeadInputError('reason_required');

    const claimant = claimantFor(gate, current);
    const claimed = claimant !== null ? await resolveSellerPersonId(tx, orgId, claimant) : null;

    await tx
      .update(salesOpsCrmLeads)
      .set({
        stageId: destination.id,
        stageChangedAt: sql`now()`,
        lostReason: destination.exitKind === 'perdido' ? (input.reason ?? null) : null,
        ...(claimed ? { sellerPersonId: claimed.id, sellerNameSnapshot: claimed.displayName } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(salesOpsCrmLeads.orgId, orgId), eq(salesOpsCrmLeads.id, id), liveLeadCondition()));
    await renumberStage(tx, orgId, destination.id, { moved: id, at: APPEND });
    await renumberStage(tx, orgId, current.stageId, null);

    const actorName = scopeActorName(scope);
    const eventId = await recordStageChange(tx, {
      orgId,
      leadId: id,
      fromStageId: current.stageId,
      toStageId: destination.id,
      reason: input.reason ?? null,
      actorUserId: scope.userId,
      actorName,
    });
    if (input.note !== undefined) {
      await tx.insert(salesOpsCrmLeadNotes).values({
        orgId,
        leadId: id,
        eventId,
        body: input.note,
        authorUserId: scope.userId,
        authorNameSnapshot: actorName,
      });
    }
    if (hasStep && hasDay) {
      await tx.insert(salesOpsCrmLeadFollowups).values({
        orgId,
        leadId: id,
        nextStep: input.nextStep!,
        dueOn: input.dueOn!,
        ownerPersonId: claimed?.id ?? current.sellerPersonId,
        ownerNameSnapshot: claimed?.displayName ?? (current.sellerNameSnapshot || null),
        createdByUserId: scope.userId,
        createdByName: actorName,
      });
    }
    return { ok: true, lead: await readLeadView(tx, orgId, id) } as const;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Notes and follow-ups
// ─────────────────────────────────────────────────────────────────────────────

export type LeadNoteView = { id: string; body: string; authorName: string | null; createdAt: string };

export type AddNoteResult =
  | { ok: true; note: LeadNoteView }
  | { ok: false; reason: 'not_found' | 'seller_person_unmapped' };

async function inScopeLead(tx: Db, orgId: string, id: string, scope: LeadScope) {
  const gate = await resolveLeadScopePredicate(tx, orgId, scope);
  if (!gate.ok) return { gate, lead: null } as const;
  const [lead] = await tx
    .select({ id: salesOpsCrmLeads.id, sellerPersonId: salesOpsCrmLeads.sellerPersonId, sellerNameSnapshot: salesOpsCrmLeads.sellerNameSnapshot })
    .from(salesOpsCrmLeads)
    .where(and(...leadIdentityConditions(orgId, id, gate)))
    .limit(1);
  return { gate, lead: lead ?? null } as const;
}

export function addLeadNote(db: Db, orgId: string, id: string, input: LeadNoteInput, scope: LeadScope): Promise<AddNoteResult> {
  return withTenant(db, orgId, async (tx) => {
    const { gate, lead } = await inScopeLead(tx, orgId, id, scope);
    if (!gate.ok) return { ok: false, reason: gate.reason } as const;
    if (!lead) return { ok: false, reason: 'not_found' } as const;
    const [note] = await tx
      .insert(salesOpsCrmLeadNotes)
      .values({ orgId, leadId: id, eventId: null, body: input.body, authorUserId: scope.userId, authorNameSnapshot: scopeActorName(scope) })
      .returning();
    return {
      ok: true,
      note: { id: note!.id, body: note!.body, authorName: note!.authorNameSnapshot, createdAt: note!.createdAt.toISOString() },
    } as const;
  });
}

export type AddFollowupResult =
  | { ok: true; followup: FollowupView }
  | { ok: false; reason: 'not_found' | 'seller_person_unmapped' };

const toFollowupView = (row: typeof salesOpsCrmLeadFollowups.$inferSelect): FollowupView => ({
  id: row.id,
  nextStep: row.nextStep,
  dueOn: row.dueOn,
  ownerName: row.ownerNameSnapshot,
  doneAt: iso(row.doneAt),
});

export function addLeadFollowup(db: Db, orgId: string, id: string, input: LeadFollowupInput, scope: LeadScope): Promise<AddFollowupResult> {
  return withTenant(db, orgId, async (tx) => {
    const { gate, lead } = await inScopeLead(tx, orgId, id, scope);
    if (!gate.ok) return { ok: false, reason: gate.reason } as const;
    if (!lead) return { ok: false, reason: 'not_found' } as const;
    let ownerId = lead.sellerPersonId;
    let ownerName: string | null = lead.sellerNameSnapshot || null;
    if (input.ownerPersonId) {
      const [owner] = await tx
        .select({ id: salesOpsPeople.id, displayName: salesOpsPeople.displayName })
        .from(salesOpsPeople)
        .where(and(eq(salesOpsPeople.orgId, orgId), eq(salesOpsPeople.id, input.ownerPersonId)))
        .limit(1);
      if (!owner) throw new LeadInputError('owner_not_found');
      ownerId = owner.id;
      ownerName = owner.displayName;
    }
    const [row] = await tx
      .insert(salesOpsCrmLeadFollowups)
      .values({
        orgId,
        leadId: id,
        nextStep: input.nextStep,
        dueOn: input.dueOn,
        ownerPersonId: ownerId,
        ownerNameSnapshot: ownerName,
        createdByUserId: scope.userId,
        createdByName: scopeActorName(scope),
      })
      .returning();
    return { ok: true, followup: toFollowupView(row!) } as const;
  });
}

export type DoneResult =
  | { ok: true; followup: FollowupView }
  | { ok: false; reason: 'not_found' | 'seller_person_unmapped' };

/** Idempotent: marking an already-done follow-up keeps its original `done_at`. */
/**
 * Who may complete a follow-up: a seller in the lead's scope, or the follow-up's own owner. The
 * owner clause is the caller's own pessoa only, so an assignment never widens access to anyone
 * else's lead. It is the same identity `listFollowups` shows in `scope=mine`, so a task a seller
 * can see is a task they can complete.
 */
function followupCompletionCondition(sellerPersonId: string, canClaimUnassigned: boolean): SQL {
  return or(leadSellerCondition(sellerPersonId, canClaimUnassigned), eq(salesOpsCrmLeadFollowups.ownerPersonId, sellerPersonId))!;
}

export function markFollowupDone(db: Db, orgId: string, followupId: string, scope: LeadScope): Promise<DoneResult> {
  return withTenant(db, orgId, async (tx) => {
    const gate = await resolveLeadScopePredicate(tx, orgId, scope);
    if (!gate.ok) return { ok: false, reason: gate.reason } as const;
    const [row] = await tx
      .select({ followup: salesOpsCrmLeadFollowups })
      .from(salesOpsCrmLeadFollowups)
      .innerJoin(
        salesOpsCrmLeads,
        and(eq(salesOpsCrmLeads.orgId, salesOpsCrmLeadFollowups.orgId), eq(salesOpsCrmLeads.id, salesOpsCrmLeadFollowups.leadId)),
      )
      .where(
        and(
          eq(salesOpsCrmLeadFollowups.orgId, orgId),
          eq(salesOpsCrmLeadFollowups.id, followupId),
          liveLeadCondition(),
          ...(gate.sellerPersonId ? [followupCompletionCondition(gate.sellerPersonId, gate.canClaimUnassigned)] : []),
        ),
      )
      .limit(1)
      .for('update', { of: salesOpsCrmLeadFollowups });
    if (!row) return { ok: false, reason: 'not_found' } as const;
    if (row.followup.doneAt !== null) return { ok: true, followup: toFollowupView(row.followup) } as const;
    const [done] = await tx
      .update(salesOpsCrmLeadFollowups)
      .set({ doneAt: new Date(), updatedAt: new Date() })
      .where(and(eq(salesOpsCrmLeadFollowups.orgId, orgId), eq(salesOpsCrmLeadFollowups.id, followupId)))
      .returning();
    return { ok: true, followup: toFollowupView(done!) } as const;
  });
}

export type FollowupListRow = {
  id: string;
  leadId: string;
  leadContactName: string;
  nextStep: string;
  dueOn: string;
  ownerName: string | null;
  doneAt: string | null;
};

export type ListFollowupsResult =
  | { ok: true; followups: FollowupListRow[] }
  | { ok: false; reason: 'seller_person_unmapped' };

/**
 * `mine`: the caller's pessoa owns it, or the caller created it. `team`: every follow-up of the org
 * (the route admits only an admin). The period is on `due_on`, a civil `date`, so the days are
 * compared as written and no timezone is involved. Deleted leads' follow-ups are not listed.
 */
export function listFollowups(db: Db, orgId: string, query: ListFollowupsQuery, scope: LeadScope): Promise<ListFollowupsResult> {
  return withTenant(db, orgId, async (tx) => {
    const conditions: SQL[] = [eq(salesOpsCrmLeadFollowups.orgId, orgId), liveLeadCondition()];
    if (query.scope === 'mine') {
      const personId = await resolveCallerPersonId(tx, orgId, scope);
      const mine: SQL[] = [eq(salesOpsCrmLeadFollowups.createdByUserId, scope.userId)];
      if (personId) mine.push(eq(salesOpsCrmLeadFollowups.ownerPersonId, personId));
      conditions.push(mine.length === 1 ? mine[0]! : sql`(${mine[0]} OR ${mine[1]})`);
    }
    if (query.status === 'open') conditions.push(isNull(salesOpsCrmLeadFollowups.doneAt));
    if (query.status === 'done') conditions.push(sql`${salesOpsCrmLeadFollowups.doneAt} IS NOT NULL`);
    if (query.from) conditions.push(sql`${salesOpsCrmLeadFollowups.dueOn} >= ${query.from}::date`);
    if (query.to) conditions.push(sql`${salesOpsCrmLeadFollowups.dueOn} <= ${query.to}::date`);
    const rows = await tx
      .select({ followup: salesOpsCrmLeadFollowups, contactName: salesOpsCrmLeads.contactName })
      .from(salesOpsCrmLeadFollowups)
      .innerJoin(
        salesOpsCrmLeads,
        and(eq(salesOpsCrmLeads.orgId, salesOpsCrmLeadFollowups.orgId), eq(salesOpsCrmLeads.id, salesOpsCrmLeadFollowups.leadId)),
      )
      .where(and(...conditions))
      .orderBy(asc(salesOpsCrmLeadFollowups.dueOn), asc(salesOpsCrmLeadFollowups.id))
      .limit(query.limit);
    return {
      ok: true,
      followups: rows.map(({ followup, contactName }) => ({
        id: followup.id,
        leadId: followup.leadId,
        leadContactName: contactName,
        nextStep: followup.nextStep,
        dueOn: followup.dueOn,
        ownerName: followup.ownerNameSnapshot,
        doneAt: iso(followup.doneAt),
      })),
    } as const;
  });
}
