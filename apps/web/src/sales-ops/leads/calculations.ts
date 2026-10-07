import type { LeadStageKind, LeadStageSummary, SalesOpsLead, SalesOpsLeadStage } from './types';

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

/**
 * THE unassigned predicate: the lead sits in the shared pool, so any vendedor
 * may take it by moving or editing it first (the API claims it in that same
 * write). True exactly when no vendedor owns it AND it is not converted: a
 * converted lead is read-only (`already_converted`) and can never be claimed,
 * so it is not "disponível" even with no vendedor.
 *
 * Keyed on `sellerPersonId` alone, never on `sellerNameSnapshot`, mirroring
 * the API's `seller_person_id IS NULL`.
 */
export function leadIsUnassigned(lead: SalesOpsLead): boolean {
  return lead.sellerPersonId === null && !leadIsConverted(lead);
}

/** One funnel row: a stage with its lead count, value total (cents) and value share. */
export type LeadFunnelRow = {
  stageId: string;
  name: string;
  kind: LeadStageKind;
  count: number;
  totalBrl: number;
  /** 0-100 integer, the stage's share of the funnel's total VALUE (matches `% do total`). */
  share: number;
};

export type LeadFunnel = {
  rows: LeadFunnelRow[];
  totalCount: number;
  totalBrl: number;
};

/** One stage's lead count and estimated value (cents). */
export type LeadStageAggregate = { count: number; totalBrl: number };

/** Per-stage aggregates keyed by stage id. A stage with no entry reads zero. */
export type LeadStageAggregates = ReadonlyMap<string, LeadStageAggregate>;

const ZERO_AGGREGATE: LeadStageAggregate = Object.freeze({ count: 0, totalBrl: 0 });

/** The aggregate for one stage, zero when absent. Never `undefined`. */
export function stageAggregate(
  aggregates: LeadStageAggregates,
  stageId: string,
): LeadStageAggregate {
  return aggregates.get(stageId) ?? ZERO_AGGREGATE;
}

/**
 * A body is a summary only when it carries a `stages` array. Anything else (a
 * `{}` from a stubbed fetch, a proxy error page parsed as JSON) is treated as
 * no summary, so the board falls back to its loaded cards instead of zeros.
 */
export function isLeadStageSummary(value: unknown): value is LeadStageSummary {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as { stages?: unknown }).stages)
  );
}

/** The loaded-cards fallback: count and value per stage over the cards in hand. */
export function aggregatesFromLeads(
  leads: readonly SalesOpsLead[],
): Map<string, LeadStageAggregate> {
  const map = new Map<string, LeadStageAggregate>();
  for (const lead of leads) {
    const current = map.get(lead.stageId);
    map.set(lead.stageId, {
      count: (current?.count ?? 0) + 1,
      totalBrl: (current?.totalBrl ?? 0) + lead.estimatedValueBrl,
    });
  }
  return map;
}

/** The server summary keyed by stage id; `estimatedValueBrl` becomes `totalBrl`. */
export function aggregatesFromSummary(
  summary: LeadStageSummary,
): Map<string, LeadStageAggregate> {
  return new Map(
    summary.stages.map((row) => [
      row.stageId,
      { count: row.count, totalBrl: row.estimatedValueBrl },
    ]),
  );
}

export type ResolvedStageAggregates = {
  aggregates: LeadStageAggregates;
  /** True when the figures are the server's; the load-more total is shown only then. */
  fromServer: boolean;
};

/**
 * THE per-stage source of the board. The server summary counts every live lead
 * in scope, loaded or not; until it has arrived (or when it failed) the loaded
 * cards answer instead, which is exactly what the board showed before the
 * summary existed - so a slow summary degrades to the old numbers, never to 0.
 *
 * Per stage the larger count wins (`max(summary, loaded)`): a valid but stale
 * summary (a fresh create whose refetch has not landed) can never show fewer
 * leads than the cards visibly sitting in that column. When the loaded cards
 * win, their value total comes with them so count and value stay one reading.
 */
export function resolveStageAggregates(
  summary: LeadStageSummary | undefined,
  loadedLeads: readonly SalesOpsLead[],
): ResolvedStageAggregates {
  const loaded = aggregatesFromLeads(loadedLeads);
  if (!isLeadStageSummary(summary)) return { aggregates: loaded, fromServer: false };
  const merged = aggregatesFromSummary(summary);
  for (const [stageId, fromCards] of loaded) {
    const fromServer = merged.get(stageId);
    if (!fromServer || fromCards.count > fromServer.count) merged.set(stageId, fromCards);
  }
  return { aggregates: merged, fromServer: true };
}

/**
 * Count and value summed over the GIVEN stages only. The board passes its
 * active columns, so a summary row for an archived stage never reaches a total.
 */
export function sumStageAggregates(
  stages: readonly Pick<SalesOpsLeadStage, 'id'>[],
  aggregates: LeadStageAggregates,
): LeadStageAggregate {
  let count = 0;
  let totalBrl = 0;
  for (const stage of stages) {
    const aggregate = stageAggregate(aggregates, stage.id);
    count += aggregate.count;
    totalBrl += aggregate.totalBrl;
  }
  return { count, totalBrl };
}

/**
 * The sales funnel: volume (count) and value (cents) per active stage, in board
 * order. Shares are by VALUE, the same figure the Quadro column header shows as
 * `% do total`, so a zero-value funnel simply draws empty bars while the counts
 * still read. Pure; reads the SAME per-stage aggregates the board header reads
 * (`resolveStageAggregates`), so the funnel can never disagree with the column
 * badges.
 */
export function buildLeadFunnel(
  aggregates: LeadStageAggregates,
  stages: readonly SalesOpsLeadStage[],
): LeadFunnel {
  const columns = boardStages(stages);
  const base = columns.map((stage) => {
    const { count, totalBrl } = stageAggregate(aggregates, stage.id);
    return { stageId: stage.id, name: stage.name, kind: stage.kind, count, totalBrl };
  });
  const totalBrl = base.reduce((sum, row) => sum + row.totalBrl, 0);
  const totalCount = base.reduce((sum, row) => sum + row.count, 0);
  const rows: LeadFunnelRow[] = base.map((row) => ({
    ...row,
    share: totalBrl > 0 ? Math.round((row.totalBrl / totalBrl) * 100) : 0,
  }));
  return { rows, totalCount, totalBrl };
}

/** One row of the cumulative funnel: counts carry everything below in the progression. */
export type CumulativeFunnelRow = {
  stageId: string;
  name: string;
  kind: LeadStageKind;
  /** Leads in this stage PLUS all progression stages below it. */
  count: number;
  /** Value (cents) accumulated the same way. */
  totalBrl: number;
};

/** The lost stage reported apart from the funnel: its own leads only, never cumulative. */
export type LostAside = {
  stageId: string;
  name: string;
  count: number;
  totalBrl: number;
};

export type CumulativeFunnel = {
  /** Progression stages (board order, `lost` removed), top-to-bottom, cumulative. */
  rows: CumulativeFunnelRow[];
  /** The lost stage set apart, or null when the board has none. */
  lost: LostAside | null;
  topCount: number;
  topBrl: number;
};

/**
 * The true (cumulative) sales funnel. A lead in a given stage is assumed to have
 * passed through every earlier stage, so each row counts its own leads plus all
 * leads below it in the progression - the result tapers monotonically from the
 * top, the shape a funnel is supposed to have. This is the counterpart to
 * `buildLeadFunnel`, which shows each stage in isolation (a composition, not a
 * funnel). The progression is the board order with the `lost` stage removed,
 * because a lost lead has no known path - placing it in an earlier stage would
 * invent one - so it is reported apart in `lost` and never inflates a stage it may
 * never have reached. Pure; reads the SAME per-stage aggregates the board header
 * reads (`resolveStageAggregates`), so the funnel can never disagree with the
 * column badges.
 */
export function buildCumulativeFunnel(
  aggregates: LeadStageAggregates,
  stages: readonly SalesOpsLeadStage[],
): CumulativeFunnel {
  const lost = lostStage(stages);
  const progression = boardStages(stages).filter((stage) => stage.id !== lost?.id);
  // FRESH row objects: the accumulation below mutates them, and it must never
  // write into the caller's aggregate map.
  const rows: CumulativeFunnelRow[] = progression.map((stage) => {
    const { count, totalBrl } = stageAggregate(aggregates, stage.id);
    return { stageId: stage.id, name: stage.name, kind: stage.kind, count, totalBrl };
  });
  // Accumulate from the bottom up: every row absorbs the one below it.
  for (let i = rows.length - 2; i >= 0; i -= 1) {
    rows[i]!.count += rows[i + 1]!.count;
    rows[i]!.totalBrl += rows[i + 1]!.totalBrl;
  }
  const lostAggregate = lost ? stageAggregate(aggregates, lost.id) : null;
  return {
    rows,
    lost:
      lost && lostAggregate
        ? {
            stageId: lost.id,
            name: lost.name,
            count: lostAggregate.count,
            totalBrl: lostAggregate.totalBrl,
          }
        : null,
    topCount: rows[0]?.count ?? 0,
    topBrl: rows[0]?.totalBrl ?? 0,
  };
}
