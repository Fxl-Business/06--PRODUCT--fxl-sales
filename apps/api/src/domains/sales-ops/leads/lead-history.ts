import { and, eq } from 'drizzle-orm';
import type { getDb } from '../../../db/client.js';
import { salesOpsCrmLeadEvents, salesOpsPipelineTransitions } from '../../../db/schema.js';

/**
 * The two primitives every stage change shares (`moveLead`, `advanceLead`, a restore that lands in
 * another etapa): the transition rule and the history event. Kept free of the lead service so the
 * service can import them without a cycle.
 */
type Db = ReturnType<typeof getDb>;

/** Is `from -> to` an edge of the pipeline graph? A pair that is absent is not allowed. */
export async function stageTransitionAllowed(
  tx: Db,
  orgId: string,
  pipelineId: string,
  fromStageId: string,
  toStageId: string,
): Promise<boolean> {
  const [row] = await tx
    .select({ id: salesOpsPipelineTransitions.id })
    .from(salesOpsPipelineTransitions)
    .where(
      and(
        eq(salesOpsPipelineTransitions.orgId, orgId),
        eq(salesOpsPipelineTransitions.pipelineId, pipelineId),
        eq(salesOpsPipelineTransitions.fromStageId, fromStageId),
        eq(salesOpsPipelineTransitions.toStageId, toStageId),
      ),
    )
    .limit(1);
  return row !== undefined;
}

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
