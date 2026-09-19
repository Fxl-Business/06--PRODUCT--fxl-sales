import type { SalesOpsLead, SalesOpsLeadStage } from './types';

/**
 * Pure board derivations. Imports only types, and every question the board, the
 * stage cadastro and the conversion flow ask about a lead or a column is asked
 * HERE, exactly once - the same discipline that routes every função question
 * through `hasFuncao` rather than a per-call-site slug comparison.
 */

const MS_PER_DAY = 86_400_000;

/**
 * Cards in one column, in board order: `position` ascending, `createdAt` as the
 * tiebreak. The tiebreak matters because `position` is deliberately not unique -
 * a reorder passes through transient duplicates - so without it two cards could
 * swap places between two renders of the same data.
 */
export function leadsInStage(
  leads: readonly SalesOpsLead[],
  stageId: string,
): SalesOpsLead[] {
  return leads
    .filter((lead) => lead.stageId === stageId)
    .sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt));
}

/** Every column at once. Key = stageId. Each value is already `leadsInStage`-ordered. */
export function groupLeadsByStage(
  leads: readonly SalesOpsLead[],
): Map<string, SalesOpsLead[]> {
  const grouped = new Map<string, SalesOpsLead[]>();
  for (const lead of leads) {
    const bucket = grouped.get(lead.stageId);
    if (bucket) bucket.push(lead);
    else grouped.set(lead.stageId, [lead]);
  }
  for (const [stageId, bucket] of grouped) {
    grouped.set(
      stageId,
      bucket.sort((a, b) => a.position - b.position || a.createdAt.localeCompare(b.createdAt)),
    );
  }
  return grouped;
}

/**
 * The columns a board draws, in `position` order, archived ones dropped. Ties
 * break on name, mirroring the API's `ORDER BY "position", name`.
 */
export function boardStages(
  stages: readonly SalesOpsLeadStage[],
): SalesOpsLeadStage[] {
  return stages
    .filter((stage) => stage.status === 'active')
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, 'pt-BR'));
}

/**
 * The single conversion stage, or null. Found by `kind` and NEVER by name: an
 * admin may rename the column, and a name match would silently stop finding it.
 */
export function conversionStage(
  stages: readonly SalesOpsLeadStage[],
): SalesOpsLeadStage | null {
  return stages.find((stage) => stage.kind === 'conversion') ?? null;
}

/** The terminal negative stage, or null. Found by `kind`, for the same reason. */
export function lostStage(
  stages: readonly SalesOpsLeadStage[],
): SalesOpsLeadStage | null {
  return stages.find((stage) => stage.kind === 'lost') ?? null;
}

/**
 * True when this destination demands a non-empty reason. A one-liner on purpose:
 * the point is that the question is asked in exactly ONE place, so no later slice
 * drifts into a per-call-site `kind === 'lost'` comparison.
 */
export function stageRequiresReason(stage: SalesOpsLeadStage | undefined): boolean {
  return stage?.kind === 'lost';
}

/**
 * Whole days parked in the current stage, floored and never negative, computed
 * from `stageChangedAt` alone - which is why a reorder inside one column must
 * leave that timestamp byte-identical.
 *
 * An unparseable timestamp returns `0` and never `NaN`, because a `NaN` reaches
 * the screen as "NaN dias".
 */
export function daysInCurrentStage(stageChangedAt: string, now: Date): number {
  const changed = Date.parse(stageChangedAt);
  if (Number.isNaN(changed)) return 0;
  const elapsed = now.getTime() - changed;
  if (!Number.isFinite(elapsed)) return 0;
  return Math.max(0, Math.floor(elapsed / MS_PER_DAY));
}

/**
 * THE read-only predicate, and the only one in this feature. True once the card
 * has a proposta behind it: that card renders the `sale.status` mirror, offers no
 * move affordance and is not a drag source.
 *
 * Keyed on the LEAD and never on the stage. A non-converted card may legitimately
 * sit in - or be dragged to - the `kind: 'conversion'` column, because entering
 * it is what hands control to the proposta wizard; a converted card has no
 * destinations at all, wherever it currently sits.
 */
export function leadIsConverted(lead: SalesOpsLead): boolean {
  return lead.saleId !== null;
}
