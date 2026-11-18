import type { getDb } from '../../../db/client.js';
import { salesOpsCrmLeadEvents } from '../../../db/schema.js';

/**
 * The two primitives every stage change shares (`moveLead`, `advanceLead`, a restore that lands in
 * another etapa): the history event. Kept free of the lead service so the
 * service can import them without a cycle.
 */
type Db = ReturnType<typeof getDb>;

export type StageChange = {
  orgId: string;
  leadId: string;
  fromStageId: string;
  toStageId: string;
  reason: string | null;
  actorUserId: string;
  actorName: string | null;
};

/** One `stage_changed` event, actor name snapshotted from the verified token. Returns the event id. */
export async function recordStageChange(tx: Db, change: StageChange): Promise<string> {
  const [event] = await tx
    .insert(salesOpsCrmLeadEvents)
    .values({
      orgId: change.orgId,
      leadId: change.leadId,
      kind: 'stage_changed',
      fromStageId: change.fromStageId,
      toStageId: change.toStageId,
      reason: change.reason,
      actorUserId: change.actorUserId,
      actorNameSnapshot: change.actorName,
    })
    .returning({ id: salesOpsCrmLeadEvents.id });
  return event!.id;
}

/** Rows per INSERT of `recordStageChanges`, well below the 65535-parameter cap. */
const STAGE_CHANGE_INSERT_ROWS = 500;

/** The batch form of `recordStageChange`: one `stage_changed` event per change, inserted in chunks. */
export async function recordStageChanges(tx: Db, changes: StageChange[]): Promise<void> {
  for (let start = 0; start < changes.length; start += STAGE_CHANGE_INSERT_ROWS) {
    await tx.insert(salesOpsCrmLeadEvents).values(
      changes.slice(start, start + STAGE_CHANGE_INSERT_ROWS).map((change) => ({
        orgId: change.orgId,
        leadId: change.leadId,
        kind: 'stage_changed' as const,
        fromStageId: change.fromStageId,
        toStageId: change.toStageId,
        reason: change.reason,
        actorUserId: change.actorUserId,
        actorNameSnapshot: change.actorName,
      })),
    );
  }
}
