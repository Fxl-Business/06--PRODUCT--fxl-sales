import type { getDb } from '../../src/db/client.js';
import { MoveLeadSchema } from '../../src/domains/sales-ops/leads/lead-schemas.js';
import { moveLead, type LeadScope } from '../../src/domains/sales-ops/leads/lead-service.js';
import { listLeadStages } from '../../src/domains/sales-ops/leads/stage-service.js';

/**
 * Walks a lead along the default pipeline graph to the etapa just BEFORE the conversion etapa
 * (Novo -> Qualificação -> Em negociação), one allowed edge at a time. Since the phase 2b cutover a
 * cross-stage move must be an edge of the pipeline graph, so a fixture that wants a lead parked next
 * to Proposta walks there instead of jumping. A lead that is already past a step skips it.
 */
export async function walkToConversionDoor(
  db: ReturnType<typeof getDb>,
  orgId: string,
  leadId: string,
  scope: LeadScope,
): Promise<void> {
  const stages = (await listLeadStages(db, orgId)).filter((stage) => stage.status === 'active');
  const conversion = stages.find((stage) => stage.kind === 'conversion')!;
  // Assumes the seven default etapas: Novo is position 1 and is skipped as the start, so the walk is
  // Qualificação, Em negociação. A pipeline with another shape must revisit this helper.
  const path = stages
    .filter((stage) => stage.kind === 'normal' && stage.type === 'normal' && stage.position > 1 && stage.position < conversion.position)
    .sort((a, b) => a.position - b.position);
  for (const stage of path) {
    const moved = await moveLead(db, orgId, leadId, MoveLeadSchema.parse({ stageId: stage.id, position: 0 }), scope);
    if (!moved.ok) throw new Error(`walk refused at ${stage.name}: ${moved.reason}`);
  }
}
