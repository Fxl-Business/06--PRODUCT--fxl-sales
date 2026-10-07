---
id: 05-web-board-totals
milestone: v4.6.0
status: done
depends_on: [02-api-stage-summary, 03-web-delete-ui, 04-web-lixeira-screen]
files_modified: [apps/web/src/lib/query-keys.ts, apps/web/src/sales-ops/leads/types.ts, apps/web/src/sales-ops/leads/api.ts, apps/web/src/sales-ops/leads/calculations.ts, apps/web/src/sales-ops/leads/optimistic.ts, apps/web/src/sales-ops/leads/board-labels.ts, apps/web/src/sales-ops/leads/hooks.ts, apps/web/src/sales-ops/leads/deleted-leads.ts, apps/web/src/sales-ops/leads/LeadsBoard.tsx, apps/web/src/sales-ops/leads/LeadsFunnelView.tsx, apps/web/src/sales-ops/leads/LeadsBoardContainer.tsx, apps/web/src/sales-ops/leads/__tests__/lead-board-totals.test.tsx, apps/web/src/sales-ops/leads/__tests__/lead-funnel.test.tsx, apps/web/src/sales-ops/leads/__tests__/leads-contact-container.test.tsx]
oracle: [apps/web/src/sales-ops/leads/__tests__/lead-board-totals.test.tsx, apps/web/src/sales-ops/leads/__tests__/lead-funnel.test.tsx, apps/web/src/sales-ops/leads/__tests__/leads-contact-container.test.tsx, apps/web/src/sales-ops/leads/__tests__/leads-board-columns.test.tsx, apps/web/src/sales-ops/leads/__tests__/leads-list-view.test.tsx, apps/web/src/sales-ops/leads/__tests__/leads-contact-board.test.tsx, apps/web/src/sales-ops/leads/__tests__/leads-full-edition.test.tsx, apps/web/src/sales-ops/leads/__tests__/leads-move-rollback.test.ts, apps/web/src/sales-ops/leads/__tests__/leads-board-fanout.test.ts, apps/web/src/sales-ops/leads/__tests__/lead-conversion.test.tsx, apps/web/src/sales-ops/leads/__tests__/board-write-surface.test.ts, apps/web/src/sales-ops/leads/__tests__/leads-api-contract.test.ts]
acceptance: ["useLeadStageSummary(filters) reads GET /api/v1/sales-ops/leads/summary under leadStageSummaryKey(filters) = ['leads','summary', filters ?? null] and sends sellerPersonId only when the board filter has one", "LeadsBoardContainer hands the SAME memoized filters object to useLeadsBoard, useMoveLead and useLeadStageSummary and passes the summary to LeadsBoard as stageSummary", "With a summary of Novo 115 and only 100 cards loaded, the Quadro badge reads 115 while the column renders 100 cards", "The column R$ total, % do total and the proportion bar are computed from the summary summed over the board's active columns only", "The Lista Todas as fases chip, every phase chip (count and R$) and the footer count and TOTAL read the summary, while the table still lists only the loaded rows", "Funil Acumulado and Composicao rows, the lost aside and the footer grand totals read the summary in both the Faturamento and the Volume metric", "The funnel builders take per-stage aggregates (LeadStageAggregates) instead of a leads array, and lead-funnel.test.tsx asserts its unchanged numbers through aggregatesFromLeads", "While the summary is pending, failed, or a body without a stages array, every figure falls back to the loaded leads exactly as before and never shows 0 for a column that has loaded cards", "The load-more button reads Carregar mais leads (100 de 115) when the server total is known and larger than the loaded count, and the bare Carregar mais leads otherwise", "An optimistic move shifts one lead count and value from source to destination in the summary entry paired with the board filters in the same onMutate as the card, and a failed move restores that entry to the identical object", "An optimistic delete decrements the lead's stage in every summary entry paired with a board entry that held the lead, and a failed delete restores each entry to the identical object", "A pending conversion (wizard open) shows the shifted figures through summaryWithPendingMove, the same move primitive", "Create, update, move (success and failure), delete and restore each leave every cached ['leads','summary', ...] entry invalidated after settle", "The column count badge and the phase chip counts are tabular-nums, never shrink, and the share label never wraps, so a 3-digit count keeps the column header on one line", "Every pre-existing leads oracle listed in this plan stays green unchanged except the deliberate edits to lead-funnel.test.tsx and leads-contact-container.test.tsx"]
---

# 05 Board totals from the server summary

Serves AC11 of `00-OVERVIEW.md`.
Names come from `SEAM-CONTRACT.md` section "Web (slices 03, 04, 05)": `useLeadStageSummary(filters)`, `leadStageSummaryKey(filters)`, both in `apps/web/src/sales-ops/leads/hooks.ts`.
Every other name in this plan is new and owned by this slice.

## Context (verified at `1501b03`, before slices 01-04 land)

Why 115 reads 100:

- `useLeadsBoard` (`hooks.ts`) fans out one `GET /leads?stageId=&limit=100` per active column (`LEADS_PAGE_SIZE = 100` in `types.ts`; the overview's "50" is the API default, the web asks 100).
  A column with 115 leads loads 100 and keeps a cursor; the rest sit behind the `Carregar mais leads` footer.
- `LeadsBoard.tsx` derives every number from the loaded `leads` prop: `totalByStage`, `countByStage`, `totalGeral`, `shareByStage`, `listTotalCents`, `listCount`, the column badge `{column.length}` (from `visibleLeads`), the `Todas as fases` chip `{leads.length}`, and the Funil through `<LeadsFunnelView leads={leads} stages={stages} />`.
- `LeadsFunnelView.tsx` calls `buildLeadFunnel(leads, stages)` and `buildCumulativeFunnel(leads, stages)` from `calculations.ts`; the footer grand totals read `composition.totalCount` / `composition.totalBrl`.
- The `Carregar mais leads` button says nothing about how much is loaded.

What already exists and is reused:

- `queryKeys.leads.all = ['leads']` prefix-matches every lead key; `useAppMutation` invalidates its `invalidates` keys on success AND failure (`apps/web/src/lib/app-mutation.ts`).
  `useSaveLead`, `useMoveLead`, `useSaveLeadStage`, `useSetLeadStageStatus`, `useReorderLeadStages`, the import commit (`import/hooks.ts`) and the conversion path all invalidate `queryKeys.leads.all`.
  Slice 04's `useRestoreLead` (seen in its prototype) also invalidates `queryKeys.leads.all`.
  So a summary key nested under `['leads']` is invalidated by every lead write with no new key on any mutation; the oracle below is what keeps that true.
- `useMoveLead(filters)` already does `cancelQueries({ queryKey: queryKeys.leads.all })`, which also cancels an in-flight summary fetch before the optimistic write.
- Slice 02 (`02-api-stage-summary.md`): `GET /leads/summary?sellerPersonId=` answers `200 { stages: [{ stageId, count, estimatedValueBrl }] }`, one entry per stage with at least one visible live lead, scoped exactly like the list, ordered by stage id.
  It does NOT join stages, so an archived stage's leads may appear; the web therefore sums only over the board's active columns.
  An empty `sellerPersonId` is a 400, so the web sends the key only when it has a value.
- Slice 03 (seam): `useDeleteLead()` optimistically removes the lead from every cached board page, reverts on error, invalidates on settle.
- Slice 04 (seam and prototype): `useRestoreLead()` in `deleted-leads.ts`, variable is the lead id (`string`), `invalidates: [queryKeys.leads.all]`, HTTP through `apiFetch`.

Tests that already pin the loaded-leads numbers and must stay green UNCHANGED (they render `LeadsBoard` without a summary, so after this slice they are the fallback oracle): `leads-board-columns.test.tsx`, `leads-list-view.test.tsx`, `leads-contact-board.test.tsx`, `leads-full-edition.test.tsx`.
`lead-conversion.test.tsx` renders the whole `SalesOpsApp` over a stubbed `fetch` whose unknown GETs answer `json(200, {})`; the new `GET /leads/summary` therefore gets `{}`, which this plan treats as "no summary" (the `stages`-array guard), so that file needs no change.

## Preconditions (no design decision involved)

1. Slices 02, 03 and 04 are merged into the branch this slice starts from.
2. `apps/api` serves `GET /leads/summary` (grep `leadsRouter.get('/summary'` in `apps/api/src/domains/sales-ops/leads/lead-routes.ts`).
3. `apps/web/src/sales-ops/leads/hooks.ts` exports `useDeleteLead`; read its `onMutate` / `onError` / `invalidates` and its mutation variable shape before step 6.
4. `apps/web/src/sales-ops/leads/deleted-leads.ts` exports `useRestoreLead`; read its variable shape and `invalidates`.
5. `pnpm install --frozen-lockfile && pnpm run build:packages` once in a fresh worktree.

If 2, 3 or 4 is missing, STOP and report; do not re-implement another slice.

## Design (fixed)

### Decisions

- ONE per-stage source for every surface: `LeadsBoard` resolves `{ aggregates, fromServer }` once per render and every figure (badge, R$ total, share, bar, chips, footer, Funil, load-more) reads it.
  The server summary when it is a valid body, otherwise the loaded leads.
  This is the "never a flash of 0" rule: before the summary arrives the board shows exactly today's numbers, then the server's.
- Totals are summed over the board's active columns (`boardStages(stages)`), never over every summary row, so an archived stage's leads never reach a board total (slice 02 does not filter them).
- The funnel builders become pure functions of `(aggregates, stages)`.
  `aggregatesFromLeads(leads)` reproduces today's input exactly, so the existing funnel oracle keeps every number and changes only how it feeds the builders.
- Optimistic summary writes exactly where the board already writes optimistically, so the badge moves in the same tick as the card:
  - `useMoveLead`: shift the moving lead's count and value from source to destination in the summary entry PAIRED with the board entry it patches (same `filters`).
  - `useDeleteLead`: decrement the deleted lead's stage in the summary entry paired with each board entry that held the lead.
  - Both restore the identical previous summary object on error, and both are re-synced from the server by the existing `queryKeys.leads.all` invalidation on settle.
- No optimistic summary write for create, update and restore: none of them writes the board optimistically either, so board and summary refresh together on the same invalidation.
- A pending conversion (the wizard open over a dropped card) shifts the displayed figures through `summaryWithPendingMove`, which calls the same `summaryWithLeadMoved` the optimistic move uses, so the preview and the real move cannot disagree.
- The summary never blocks the board: no Skeleton waits on it and a failed summary renders no error (the board read keeps owning the error copy).

### 1. Query key - `apps/web/src/lib/query-keys.ts`

Inside `leads`, directly below `board`:

```ts
    /*
      The board's per-stage totals (`GET /leads/summary`). Keyed by the SAME
      filters value as `board(filters)`, so the optimistic move and delete patch
      the summary entry paired with the board entry they patch. Under the
      `['leads']` root on purpose: every lead write's `queryKeys.leads.all`
      refreshes it with no extra key on any mutation.
    */
    summary: (filters: LeadBoardFilters) => ['leads', 'summary', filters ?? null] as const,
```

Leave slice 04's `deleted` key where it is.

### 2. Wire types - `apps/web/src/sales-ops/leads/types.ts`

Directly below `export type LeadBoardFilters ...`:

```ts
/**
 * One row of `GET /api/v1/sales-ops/leads/summary`: every LIVE lead the caller
 * may see in that stage, loaded or not, scoped exactly like the list. Integer
 * cents. A stage with no row reads zero, and a row may name an archived stage,
 * which the board never draws.
 */
export type LeadStageSummaryRow = { stageId: string; count: number; estimatedValueBrl: number };

export type LeadStageSummary = { stages: LeadStageSummaryRow[] };
```

In the doc comment of `LeadsPage`, replace the paragraph that starts "`total` IS returned by the API and is deliberately not modelled" with:

```ts
 * `total` IS returned by the API and is deliberately not modelled: the board's
 * counts come from ONE `GET /leads/summary` read for every column (see
 * `LeadStageSummary`), never from N per-column page totals.
```

### 3. HTTP - `apps/web/src/sales-ops/leads/api.ts`

Add `type LeadBoardFilters` and `type LeadStageSummary` to the existing `import { ... } from './types'`.
Add to `leadsApi`, directly after `listLeads`:

```ts
  /**
   * The board's per-stage totals over EVERY live lead in scope, loaded or not.
   * `sellerPersonId` rides only when the board filter has one: the API answers
   * 400 to an empty string, exactly as on the list. A seller's scope is applied
   * server-side from the token; the param is an admin narrowing only.
   */
  stageSummary: (filters: LeadBoardFilters, token: Token) => {
    const search = new URLSearchParams();
    if (filters?.sellerPersonId) search.set('sellerPersonId', filters.sellerPersonId);
    const query = search.toString();
    return apiFetch<LeadStageSummary>(`${LEADS_PATH}/summary${query ? `?${query}` : ''}`, {
      method: 'GET',
      token,
    });
  },
```

### 4. Pure aggregates and funnel builders - `apps/web/src/sales-ops/leads/calculations.ts`

Change the type import to `import type { LeadStageKind, LeadStageSummary, SalesOpsLead, SalesOpsLeadStage } from './types';`.

Insert this block directly ABOVE `/** One funnel row: ...` (the funnel section):

```ts
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
    summary.stages.map((row) => [row.stageId, { count: row.count, totalBrl: row.estimatedValueBrl }]),
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
 */
export function resolveStageAggregates(
  summary: LeadStageSummary | undefined,
  loadedLeads: readonly SalesOpsLead[],
): ResolvedStageAggregates {
  return isLeadStageSummary(summary)
    ? { aggregates: aggregatesFromSummary(summary), fromServer: true }
    : { aggregates: aggregatesFromLeads(loadedLeads), fromServer: false };
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
```

Rewrite the two funnel builders to take aggregates (types `LeadFunnelRow`, `LeadFunnel`, `CumulativeFunnelRow`, `LostAside`, `CumulativeFunnel` are unchanged):

```ts
export function buildLeadFunnel(
  aggregates: LeadStageAggregates,
  stages: readonly SalesOpsLeadStage[],
): LeadFunnel {
  const columns = boardStages(stages);
  const base = columns.map((stage) => {
    const { count, totalBrl } = stageAggregate(aggregates, stage.id);
    return { stageId: stage.id, name: stage.name, kind: stage.kind, count, totalBrl };
  });
  // ...the rest of the body (totalBrl, totalCount, rows with share) stays byte-identical.
}

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
  // the existing bottom-up accumulation loop, byte-identical
  const lostAggregate = lost ? stageAggregate(aggregates, lost.id) : null;
  return {
    rows,
    lost:
      lost && lostAggregate
        ? { stageId: lost.id, name: lost.name, count: lostAggregate.count, totalBrl: lostAggregate.totalBrl }
        : null,
    topCount: rows[0]?.count ?? 0,
    topBrl: rows[0]?.totalBrl ?? 0,
  };
}
```

Doc comments of both builders: replace "reuses `boardStages` and `leadsInStage` so the funnel can never disagree with the board about which cards sit where" (and the cumulative variant mentioning `leadsInStage`) with "reads the SAME per-stage aggregates the board header reads (`resolveStageAggregates`), so the funnel can never disagree with the column badges".
Change the `LeadFunnelRow.share` doc only if it mentions leads; the semantics are unchanged.

### 5. Pure summary patches - `apps/web/src/sales-ops/leads/optimistic.ts`

Imports become:

```ts
import type { MoveLeadPayload } from './api';
import { isLeadStageSummary, leadsInStage } from './calculations';
import type { LeadStageSummary, LeadsInfiniteData, SalesOpsLead } from './types';
```

Append at the end of the file:

```ts
/** What a summary patch needs to know about one lead. */
type SummaryLead = Pick<SalesOpsLead, 'stageId' | 'estimatedValueBrl'>;

/**
 * One stage's count and value moved by a delta, never below zero. A stage with
 * no row is created on an increment and left alone on a decrement (a missing
 * row already reads zero). Every untouched row is the same object that went in.
 */
function adjustStage(
  summary: LeadStageSummary,
  stageId: string,
  countDelta: number,
  valueDelta: number,
): LeadStageSummary {
  const index = summary.stages.findIndex((row) => row.stageId === stageId);
  if (index < 0) {
    if (countDelta <= 0) return summary;
    return {
      ...summary,
      stages: [...summary.stages, { stageId, count: countDelta, estimatedValueBrl: valueDelta }],
    };
  }
  const row = summary.stages[index]!;
  const next = {
    stageId,
    count: Math.max(0, row.count + countDelta),
    estimatedValueBrl: Math.max(0, row.estimatedValueBrl + valueDelta),
  };
  return { ...summary, stages: summary.stages.map((current, i) => (i === index ? next : current)) };
}

/**
 * The summary twin of `moveLeadInList`: one lead's count and value leave its
 * stage and enter `toStageId`. A reorder inside one column, and a body that is
 * not a summary, come back as the IDENTICAL object.
 */
export function summaryWithLeadMoved(
  summary: LeadStageSummary,
  lead: SummaryLead,
  toStageId: string,
): LeadStageSummary {
  if (!isLeadStageSummary(summary) || lead.stageId === toStageId) return summary;
  const withoutLead = adjustStage(summary, lead.stageId, -1, -lead.estimatedValueBrl);
  return adjustStage(withoutLead, toStageId, 1, lead.estimatedValueBrl);
}

/** One lead leaves its stage (a soft delete). A non-summary body is returned as is. */
export function summaryWithLeadRemoved(
  summary: LeadStageSummary,
  lead: SummaryLead,
): LeadStageSummary {
  if (!isLeadStageSummary(summary)) return summary;
  return adjustStage(summary, lead.stageId, -1, -lead.estimatedValueBrl);
}

/**
 * The figures the board shows while the proposta wizard holds a dropped card in
 * the conversion column (`pendingConversion` in `LeadsBoard`). Same primitive as
 * the optimistic move, so the preview and the real move cannot disagree.
 */
export function summaryWithPendingMove(
  summary: LeadStageSummary | undefined,
  leads: readonly SalesOpsLead[],
  pending: MoveLeadPayload | null,
): LeadStageSummary | undefined {
  if (!summary || !pending) return summary;
  const lead = leads.find((row) => row.id === pending.leadId);
  return lead ? summaryWithLeadMoved(summary, lead, pending.toStageId) : summary;
}
```

Keep the file header comment; add one sentence to it: "The `summaryWith*` functions are the same contract over the `GET /leads/summary` cache entry."

### 6. Hooks - `apps/web/src/sales-ops/leads/hooks.ts`

Imports: `import { useInfiniteQuery, useQuery, useQueryClient, type QueryClient, type QueryKey } from '@tanstack/react-query';`; add `summaryWithLeadMoved` and `summaryWithLeadRemoved` to the `./optimistic` import; add `LeadStageSummary` to the `./types` type import.

6a. Directly below `useLeadsBoard`, add:

```ts
/**
 * The summary key, through the one query-key factory. The board, the move and
 * this read are handed the SAME memoized `filters` by `LeadsBoardContainer`, so
 * the summary entry a move patches is the one the board renders.
 */
export function leadStageSummaryKey(filters?: LeadBoardFilters) {
  return queryKeys.leads.summary(filters);
}

/**
 * The true per-stage count and value behind the board (`GET /leads/summary`),
 * scoped server-side exactly like the list. Never gates the board: while it is
 * pending or failed, `LeadsBoard` falls back to the loaded cards.
 *
 * No mutation names this key: it sits under `queryKeys.leads.all`, which every
 * lead write invalidates (create, update, move, delete, restore, stage writes,
 * import, conversion). `lead-board-totals.test.tsx` pins that for each one.
 */
export function useLeadStageSummary(filters?: LeadBoardFilters) {
  const { getToken } = useAccessToken();
  return useQuery({
    queryKey: leadStageSummaryKey(filters),
    queryFn: async () => leadsApi.stageSummary(filters, await requireToken(getToken)),
  });
}

/** One summary cache entry as it was before an optimistic patch, for an exact revert. */
type SummarySnapshot = { key: QueryKey; previous: LeadStageSummary };

/** The filters a `queryKeys.leads.board(filters)` key was built from (`null` is none). */
function boardFiltersOf(boardKey: QueryKey): LeadBoardFilters {
  const segment = boardKey[2];
  return segment && typeof segment === 'object' ? (segment as { sellerPersonId?: string }) : undefined;
}

/**
 * Patch the summary entry PAIRED with a board entry (same filters). No cached
 * summary, or a patch that changes nothing, writes nothing and returns null:
 * the same degrade-to-no-write direction as the board patch.
 */
function patchPairedSummary(
  queryClient: QueryClient,
  filters: LeadBoardFilters,
  patch: (summary: LeadStageSummary) => LeadStageSummary,
): SummarySnapshot | null {
  const key = leadStageSummaryKey(filters);
  const previous = queryClient.getQueryData<LeadStageSummary>(key);
  if (previous === undefined) return null;
  const next = patch(previous);
  if (next === previous) return null;
  queryClient.setQueryData(key, next);
  return { key, previous };
}

/** Write every snapshot back WHOLE, so the revert is exact by construction. */
function restoreSummaries(queryClient: QueryClient, snapshots: readonly SummarySnapshot[]): void {
  for (const { key, previous } of snapshots) queryClient.setQueryData(key, previous);
}
```

6b. `useMoveLead`: add `type MoveLeadContext = OptimisticLeadPatch & { summaries: SummarySnapshot[] };` above it, change the 4th generic from `OptimisticLeadPatch | undefined` to `MoveLeadContext | undefined`, and replace `onMutate` / `onError` with:

```ts
    onMutate: async (payload) => {
      // An in-flight page or summary fetch must not land on top of the optimistic write.
      await queryClient.cancelQueries({ queryKey: queryKeys.leads.all });
      const previous = queryClient.getQueryData<LeadsInfiniteData>(boardKey);
      if (!previous) return undefined;
      const patch = optimisticLeadMove(previous, payload);
      queryClient.setQueryData(boardKey, patch.next);
      // The column totals move in the SAME tick as the card: the summary entry
      // paired with this board entry shifts one lead from source to destination.
      const moving = flattenLeadPages(previous).find((row) => row.id === payload.leadId);
      const summary = moving
        ? patchPairedSummary(queryClient, filters, (current) =>
            summaryWithLeadMoved(current, moving, payload.toStageId),
          )
        : null;
      return { ...patch, summaries: summary ? [summary] : [] };
    },
    onError: (_error, _payload, context) => {
      if (!context) return;
      queryClient.setQueryData(boardKey, context.previous);
      restoreSummaries(queryClient, context.summaries);
    },
```

`onSuccess` and `invalidates: [queryKeys.leads.all]` stay as they are (rename its third parameter only if TypeScript asks).
Add one paragraph to the hook's doc comment: "The summary entry paired with the board entry is shifted in the same `onMutate` and written back whole on error; the settle invalidation re-reads both from the server."

6c. `useDeleteLead` (slice 03's hook; adapt to its exact structure, the rule is fixed):

- Its `onMutate` must start with `await queryClient.cancelQueries({ queryKey: queryKeys.leads.all })`; if slice 03 cancels a narrower key, widen it to `queryKeys.leads.all` (that also cancels an in-flight summary fetch).
- After slice 03's board patch, for EVERY board entry slice 03 enumerated (`[boardKey, data]` pairs from its `getQueriesData` sweep) whose `flattenLeadPages(data)` holds the deleted lead (`row`), call `patchPairedSummary(queryClient, boardFiltersOf(boardKey), (current) => summaryWithLeadRemoved(current, row))` and push each non-null result into a `summaries: SummarySnapshot[]` array.
  The lead is looked up in the PREVIOUS (unpatched) board data of that entry, because the patched data no longer holds it.
  If slice 03's hook takes `filters` and patches one board entry instead of sweeping, patch the one entry paired with those `filters` the same way.
- Return slice 03's context object extended with `summaries`.
- In `onError`, after slice 03's board restore, call `restoreSummaries(queryClient, context.summaries)` (guard `context` like slice 03 does).
- `invalidates` must contain `queryKeys.leads.all`; if slice 03 listed narrower lead keys, replace them with `queryKeys.leads.all` (keep any key outside the `['leads']` root).
- Add to its doc comment: "The summary entry paired with each board entry that held the lead loses that lead in the same `onMutate`, and is written back whole on error."

6d. `useSaveLead`: no code change (no optimistic write; `queryKeys.leads.all` covers the summary).

### 7. Restore - `apps/web/src/sales-ops/leads/deleted-leads.ts`

- `useRestoreLead`'s `invalidates` must contain `queryKeys.leads.all` (slice 04's prototype already does); if it lists only narrower lead keys, replace them with `queryKeys.leads.all`.
- No optimistic summary write: the restore happens on the Lixeira screen, the board is not on screen, and the server decides the target etapa (its own or the first open one), which the client cannot know.
- Edit its doc comment so it names the summary: "`queryKeys.leads.all` then refetches the trash, the board (the lead is back in a column), the column totals (`GET /leads/summary`) and the stage list on settle."

### 8. Copy - `apps/web/src/sales-ops/leads/board-labels.ts`

Add directly below `EMPTY_PHASE_LIST`:

```ts
export const LOAD_MORE_LABEL = 'Carregar mais leads';

/**
 * The load-more button, honest about how much of the board is on screen:
 * `Carregar mais leads (100 de 115)` once the server total is known and larger
 * than what is loaded; the bare label while the summary is unknown, failed, or
 * already caught up (a stale total never reads "120 de 115").
 */
export const loadMoreLabel = (loaded: number, total: number | null): string =>
  total !== null && total > loaded ? `${LOAD_MORE_LABEL} (${loaded} de ${total})` : LOAD_MORE_LABEL;
```

### 9. Board - `apps/web/src/sales-ops/leads/LeadsBoard.tsx`

9a. Props: add to `LeadsBoardProps`, directly after `leads`:

```ts
  /**
   * The server's per-stage totals (`GET /leads/summary`) for exactly the set this
   * board may show, loaded or not. Absent (pending, failed) means the figures
   * fall back to `leads`. Never a reason to wait: the cards render regardless.
   */
  stageSummary?: LeadStageSummary;
```

Destructure `stageSummary` in the component signature.

9b. Imports: from `./board-labels` add `loadMoreLabel`; from `./calculations` add `aggregatesFromLeads`, `resolveStageAggregates`, `stageAggregate`, `sumStageAggregates`; from `./optimistic` add `summaryWithPendingMove`; add `LeadStageSummary` to the `./types` type import.

9c. Replace everything from `const totalByStage = React.useMemo(` through `const listCount = orderedLeads.length;` AND move the existing `visibleLeads` `useMemo` (with its comment) up so it sits directly after `const colors = ...`.
The resulting block, in this order:

```ts
  const colors = React.useMemo(() => stageColors(columns), [columns]);

  /* the existing comment about `moveLeadInList`, unchanged */
  const visibleLeads = React.useMemo(/* unchanged */);

  /*
    THE per-stage figures every surface reads: the column badge, R$ total,
    `% do total` and bar, the Lista chips and footer, the Funil and the
    load-more total. The server summary counts every live lead in scope,
    loaded or not; until it arrives the loaded cards answer, so a slow summary
    shows the old numbers and never a 0. A card held in the conversion column
    while the wizard is open shifts the summary through the same primitive the
    optimistic move uses.
  */
  const displayedSummary = React.useMemo(
    () => summaryWithPendingMove(stageSummary, leads, pendingConversion),
    [stageSummary, leads, pendingConversion],
  );
  const { aggregates, fromServer } = React.useMemo(
    () => resolveStageAggregates(displayedSummary, visibleLeads),
    [displayedSummary, visibleLeads],
  );
  // Summed over the drawn columns only: a summary row for an archived stage
  // never reaches a board total.
  const allStages = React.useMemo(
    () => sumStageAggregates(columns, aggregates),
    [columns, aggregates],
  );
  const totalGeral = allStages.totalBrl;
  const shareByStage = (stageId: string) =>
    totalGeral > 0
      ? Math.round((stageAggregate(aggregates, stageId).totalBrl / totalGeral) * 100)
      : 0;
  const orderedLeads = React.useMemo(/* unchanged */);
  const listScope = leadStageFilter ? stageAggregate(aggregates, leadStageFilter) : allStages;
  const listTotalCents = listScope.totalBrl;
  const listCount = listScope.count;
  // How many cards are on screen, for the honest load-more label.
  const loadedCount = React.useMemo(
    () => sumStageAggregates(columns, aggregatesFromLeads(leads)).count,
    [columns, leads],
  );
```

`scopeLabel` and `fmtBrl0` stay as they are (keep them after this block).
`totalByStage` and `countByStage` disappear; every former read goes through `stageAggregate(aggregates, id)`.

9d. Column header (Quadro):

- The count badge becomes:

```tsx
                    <span
                      className="inline-flex min-w-[24px] shrink-0 justify-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px] font-bold tabular-nums"
                      data-stage-count
                      style={{ backgroundColor: c?.soft, color: c?.ink }}
                    >
                      {stageAggregate(aggregates, stage.id).count}
                    </span>
```

- The R$ total reads `{fmtBrl0(stageAggregate(aggregates, stage.id).totalBrl)}`.
- The baseline row `className="mt-2 flex items-baseline justify-between"` becomes `"mt-2 flex items-baseline justify-between gap-2"`, and the `PERCENT_OF_TOTAL(share)` span's className becomes `"shrink-0 whitespace-nowrap text-[11.5px] font-semibold text-[#9b9ba3]"`.
  Reason: totals now include unloaded leads, so `R$ 11.500.000` plus `81% do total` must stay on one baseline in a 300px column instead of wrapping the share label.
- The bar is unchanged (`share` still comes from `shareByStage`).

9e. Lista chips:

- `Todas as fases`: the R$ span reads `fmtBrl0(totalGeral)` (unchanged expression) and the count becomes `<span className="tabular-nums" data-phase-count>{allStages.count}</span>`.
- Each phase chip: R$ reads `fmtBrl0(stageAggregate(aggregates, stage.id).totalBrl)`, and the count span becomes:

```tsx
                  <span
                    className="inline-flex min-w-[20px] justify-center rounded-full px-1.5 text-[11px] font-semibold tabular-nums"
                    data-phase-count
                    style={{ backgroundColor: color?.soft, color: color?.ink }}
                  >
                    {stageAggregate(aggregates, stage.id).count}
                  </span>
```

- The footer `scopeLeadsCount(scopeLabel, listCount)` and `{fmtBrl0(listTotalCents)}` are unchanged expressions (their values now come from `listScope`).
- The table body still renders `orderedLeads` (loaded rows only) and its empty state is unchanged.

9f. Funil: `<LeadsFunnelView aggregates={aggregates} stages={stages} />`.

9g. Load more:

```tsx
      {hasMore ? (
        <footer>
          <button
            className={cardButtonClass}
            data-load-more
            disabled={loadingMore}
            onClick={onLoadMore}
            type="button"
          >
            {loadMoreLabel(loadedCount, fromServer ? allStages.count : null)}
          </button>
        </footer>
      ) : null}
```

### 10. Funnel view - `apps/web/src/sales-ops/leads/LeadsFunnelView.tsx`

- Props become `{ aggregates: LeadStageAggregates; stages: SalesOpsLeadStage[] }` (import the type from `./calculations`; drop the `SalesOpsLead` import if unused).
- `const composition = React.useMemo(() => buildLeadFunnel(aggregates, stages), [aggregates, stages]);` and the same for `buildCumulativeFunnel`.
- Header comment: add "Purely presentational over the board's per-stage aggregates (`resolveStageAggregates`): the server summary when it has arrived, the loaded cards until then, so the Funil always agrees with the column badges."
- No markup change.

### 11. Container - `apps/web/src/sales-ops/leads/LeadsBoardContainer.tsx`

- Import `useLeadStageSummary` from `./hooks`.
- Directly after `const boardQuery = useLeadsBoard(stages, filters);` add `const summaryQuery = useLeadStageSummary(filters);`.
- Pass `stageSummary={summaryQuery.data}` to `<LeadsBoard>`, directly before `stages={stages}`.
- Do not add `summaryQuery` to the Skeleton or the error conditions.
- Update the `filters` memo comment: "the same object reaches the board read, the move and the stage summary: the move patches the board and summary entries the board renders, so a mismatch would silently degrade to no optimistic write at all."

## Tests

Red first: write `lead-board-totals.test.tsx` and the two edits, run them, watch them fail on the missing exports, then implement.

### A. NEW oracle - `apps/web/src/sales-ops/leads/__tests__/lead-board-totals.test.tsx`

Header: `// @vitest-environment happy-dom`, then a doc comment naming AC11 and stating the three layers it covers (pure aggregates and patches, the presentational board over a summary larger than the loaded cards, the real container and hooks over a mocked `apiFetch`).

Mocks (the ONLY seams; everything else is real):

```ts
vi.mock('@/auth/react', () => ({
  useAccessToken: () => ({ getToken: async () => 'test-token' }),
  useSalesEdition: () => 'full',
  useAuthProfile: () => ({
    isLoaded: true,
    isSignedIn: true,
    roles: ['admin', 'seller'],
    name: 'Gestor',
    email: 'gestor@example.com',
  }),
}));

vi.mock('@/lib/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api-client')>()),
  apiFetch: vi.fn(),
}));
```

If vitest reports another missing export on the `@/auth/react` mock (a module merged by slice 03 or 04 imports one), add exactly that export with an inert value.
Every HTTP call of slices 02-04 goes through `apiFetch`; if slice 03's `deleteLead` does not, replace the `apiFetch` routing for delete with a partial `vi.mock('../api', async (importOriginal) => ({ ...(await importOriginal()), deleteLead: vi.fn() }))` and drive that instead.

Harness (in the file):

- `act` from React as in the sibling tests; `IS_REACT_ACT_ENVIRONMENT = true` in `beforeEach`; a fresh `container` and `Root`; `afterEach` unmounts, removes the container, `queryClient.clear()` and `vi.clearAllMocks()`.
- `createQueryClient()` with `retry: false` for queries and mutations.
- `waitFor(check, label)`: up to 50 rounds of `await act(async () => { await new Promise((r) => setTimeout(r, 0)); })`, throwing `timed out waiting for ${label}` if `check()` never holds.
- `mountHook(queryClient, useHook)`: renders a probe inside `QueryClientProvider` that stores `useHook()` on a handle, returns the handle (same shape as `leads-board-fanout.test.ts`).
- `createDeferred<T>()` as in `leads-move-rollback.test.ts`.
- `brl0(cents)` = `formatMoneyBrl(cents, { minimumFractionDigits: 0, maximumFractionDigits: 0 })` from `../../calculations` (never a hand-typed `R$` literal).
- `stage(id, name, kind, position)` and `lead(id, stageId, value, patch?)` fixture builders copied from `leads-board-columns.test.tsx`.

Fixtures for the presentational and pure cases:

- `STAGES`: Novo (normal, 1), Qualificado (normal, 2), Proposta (conversion, 3), Perdido (lost, 4), ids `cccccccc-0000-4000-8000-00000000000{1..4}`.
- `LOADED`: `l1` Novo 100_000 (position 1), `l2` Novo 200_000 (position 2), `l3` Qualificado 300_000.
- `SUMMARY: LeadStageSummary`: Novo `{ count: 115, estimatedValueBrl: 11_500_000 }`, Qualificado `{ 7, 2_100_000 }`, Perdido `{ 3, 600_000 }`, no Proposta row, plus a row for an ARCHIVED stage id `cccccccc-0000-4000-8000-0000000000aa` `{ 9, 900_000 }` that is not in `STAGES`.
  Board totals over the drawn columns: 125 leads, 14_200_000 cents; shares Novo 81, Qualificado 15, Proposta 0, Perdido 4.

`describe('per-stage aggregates (pure)')`:

1. `it('reads a server summary into per-stage aggregates, a missing stage reading zero')`: `aggregatesFromSummary(SUMMARY)` gives Novo `{ count: 115, totalBrl: 11_500_000 }`; `stageAggregate(map, PROPOSTA)` is `{ count: 0, totalBrl: 0 }`.
2. `it('resolves to the summary when present and to the loaded leads otherwise')`: with `SUMMARY` -> `fromServer: true` and Novo 115; with `undefined` -> `fromServer: false` and Novo `{ 2, 300_000 }`; with `{} as unknown as LeadStageSummary` -> `fromServer: false` (the `lead-conversion.test.tsx` stub shape).
3. `it('sums only the stages it is given, so an archived stage never reaches a board total')`: `sumStageAggregates(STAGES, aggregatesFromSummary(SUMMARY))` is `{ count: 125, totalBrl: 14_200_000 }` (the archived row's 9 excluded).
4. `it('builds both funnel shapes from aggregates, so 115 leads read 115 with none loaded')`: `buildLeadFunnel(aggregatesFromSummary(SUMMARY), STAGES)` rows `[name, count, totalBrl, share]` equal `['Novo',115,11_500_000,81]`, `['Qualificado',7,2_100_000,15]`, `['Proposta',0,0,0]`, `['Perdido',3,600_000,4]`, `totalCount` 125, `totalBrl` 14_200_000; `buildCumulativeFunnel(...)` rows `['Novo',122,13_600_000]`, `['Qualificado',7,2_100_000]`, `['Proposta',0,0]`, `lost` `{ stageId: PERDIDO, name: 'Perdido', count: 3, totalBrl: 600_000 }`, `topCount` 122; and the input map still reads Novo 115 afterwards (the accumulation did not write into it).

`describe('summary patches (pure)')`:

5. `it('moves one lead count and value from the source stage to the destination, creating the destination row')`: `summaryWithLeadMoved(SUMMARY, l1, PROPOSTA)` has Novo `{ 114, 11_400_000 }` and a new Proposta row `{ 1, 100_000 }`; every other row is `toBe` the input row object.
6. `it('returns the identical summary for a reorder inside one column and for a body that is not a summary')`: `summaryWithLeadMoved(SUMMARY, l1, NOVO)` `toBe(SUMMARY)`; `summaryWithLeadMoved({} as never, l1, QUAL)` and `summaryWithLeadRemoved({} as never, l1)` return the same object.
7. `it('removes one lead from its stage and never goes below zero')`: `summaryWithLeadRemoved(SUMMARY, l1)` Novo `{ 114, 11_400_000 }`; on a summary whose Novo row is `{ 0, 0 }` the row stays `{ 0, 0 }`; a lead in a stage with no row returns `toBe` the input.
8. `it('applies a pending conversion through the same move primitive')`: `summaryWithPendingMove(SUMMARY, LOADED, { leadId: 'l1', toStageId: PROPOSTA, toIndex: 0 })` toEqual `summaryWithLeadMoved(SUMMARY, l1, PROPOSTA)`; with `null` pending `toBe(SUMMARY)`; with `undefined` summary returns `undefined`; with an unknown `leadId` `toBe(SUMMARY)`.

`describe('load more label')`:

9. `it('shows loaded of total only when the server total is known and larger')`: `loadMoreLabel(100, 115)` is exactly `'Carregar mais leads (100 de 115)'`; `loadMoreLabel(100, null)`, `(115, 115)` and `(120, 115)` are `LOAD_MORE_LABEL`; no result contains the character U+2014.

`describe('LeadsBoard reads the summary, not the loaded cards')` (render `<LeadsBoard leads={LOADED} stageSummary={SUMMARY} lookups={LOOKUPS} now={NOW} onMoveLead={vi.fn()} stages={STAGES} hasMore />` unless stated):

10. `it('takes the column badge, R$ total, % do total and bar from the summary while only the loaded cards render')`: badges Novo `'115'`, Qualificado `'7'`, Proposta `'0'`, Perdido `'3'`; `[data-stage-total]` Novo `brl0(11_500_000)`; bar widths `'81%'`, `'15%'`, `'0%'`, `'4%'`; Novo column text contains `'81% do total'`; `[data-stage-column=NOVO] [data-lead-card]` count is 2.
11. `it('takes the Lista chips and footer from the summary while the table lists the loaded rows')`: switch to Lista; `[data-phase-chip=""]` contains `brl0(14_200_000)` and its `[data-phase-count]` is `'125'`; Novo chip contains `brl0(11_500_000)` and count `'115'`; Proposta chip count `'0'`; `[data-list-total]` is `brl0(14_200_000)`; list text contains `'Todas as fases · 125 leads'`; `[data-list-row]` count is 3; click the Novo chip: footer contains `'Novo · 115 leads'`, `[data-list-total]` is `brl0(11_500_000)`, rows 2.
12. `it('takes both Funil shapes and their footer grand totals from the summary in both metrics')`: switch to Funil; Acumulado: Novo row `[data-funnel-primary]` contains `brl0(13_600_000)`, `[data-funnel-secondary]` contains `'122 leads'`, share `'100% do topo'`; Qualificado share `'15% do topo'` and bar `'15%'`; `[data-funnel-lost]` contains `'Perdido'`, `'3 leads'` and `brl0(600_000)`; `[data-funnel-grand-count]` `'125 leads'`, `[data-funnel-grand-total]` contains `brl0(14_200_000)`.
    Click Composição: Novo primary contains `brl0(11_500_000)` and share `'81% do total'`; Perdido row present with `'4% do total'`; grand totals unchanged.
    Still in Composição, click Volume: Novo primary is `'115 leads'`.
    Click Acumulado (Volume kept): Novo primary is `'122 leads'`.
13. `it('falls back to the loaded cards when there is no summary, never to 0')`: render without `stageSummary`; badges Novo `'2'`, Qualificado `'1'`; `[data-stage-total]` Novo `brl0(300_000)`; `[data-load-more]` text is exactly `LOAD_MORE_LABEL`.
14. `it('treats a body without a stages array as no summary')`: `stageSummary={{} as unknown as LeadStageSummary}` renders the same badges as case 13.
15. `it('labels Carregar mais leads with loaded of total')`: with `SUMMARY`, `[data-load-more]` text is `'Carregar mais leads (3 de 125)'`; with `hasMore={false}` there is no `[data-load-more]`.
16. `it('keeps a 3-digit count from shrinking and the share label from wrapping')`: Novo `[data-stage-count]` classList contains `shrink-0`, `whitespace-nowrap`, `tabular-nums`, `min-w-[24px]`; the element whose text is `'81% do total'` has `shrink-0` and `whitespace-nowrap`; after switching to Lista, the Novo chip's `[data-phase-count]` has `tabular-nums` and `min-w-[20px]`.

`describe('LeadsBoardContainer over the real hooks')` (render `<QueryClientProvider><MemoryRouter><LeadsBoardContainer clients={[]} people={[]} products={[]} sellers={[]} /></MemoryRouter></QueryClientProvider>`; `apiFetch` routed by path and method):

- `GET /api/v1/sales-ops/lead-stages` -> `{ stages: [Novo, Qualificado, Proposta] }` (3 stages, no lost).
- `GET /api/v1/sales-ops/leads?...` -> parse the query: stage Novo with no cursor -> 100 leads `n0..n99` (positions 0..99, 10_000 cents each), `nextCursor: 'c1'`; Novo with `cursor=c1` -> 15 leads `n100..n114`, `nextCursor: null`; any other stage -> `{ leads: [], nextCursor: null }`.
- `GET /api/v1/sales-ops/leads/summary` (path starts with it) -> a per-test function, default `{ stages: [{ stageId: NOVO, count: 115, estimatedValueBrl: 1_150_000 }] }`.
- Anything else -> `throw new Error(\`unexpected ${method} ${path}\`)`.

17. `it('reads 115 with 100 loaded and says Carregar mais leads (100 de 115)')`: wait until 100 cards in Novo; badge `'115'`; `[data-stage-total]` `brl0(1_150_000)`; `[data-load-more]` text `'Carregar mais leads (100 de 115)'`.
18. `it('loading the last page keeps the badge at 115 and removes the button')`: click `[data-load-more]`, wait until 115 cards; badge `'115'`; no `[data-load-more]`.
19. `it('shows the loaded numbers while the summary is in flight, then the server numbers')`: the summary route returns a deferred; after the 100 cards render, badge `'100'` and `[data-load-more]` text `LOAD_MORE_LABEL`; resolve the deferred; wait until badge `'115'`; label `'Carregar mais leads (100 de 115)'`.
20. `it('keeps the loaded numbers and shows no error when the summary fails')`: the summary route rejects with `{ status: 500, error: 'request_failed' }`; after the cards render and one more `waitFor` round, badge `'100'`, label `LOAD_MORE_LABEL`, and the text `Não foi possível carregar o funil de leads.` is absent.
21. `it('asks for the summary once, with no query string when the board has no filter')`: exactly one `apiFetch` call whose path starts with `/api/v1/sales-ops/leads/summary`, and it is exactly `/api/v1/sales-ops/leads/summary` with `{ method: 'GET', token: 'test-token' }`.

`describe('useLeadStageSummary')`:

22. `it('keys on leadStageSummaryKey(filters) and sends sellerPersonId only when the filter has one')`: `leadStageSummaryKey(undefined)` toEqual `['leads', 'summary', null]` and equals `queryKeys.leads.summary(undefined)`; `leadStageSummaryKey({ sellerPersonId: 'p-7' })` toEqual `['leads', 'summary', { sellerPersonId: 'p-7' }]`; mount the hook with `undefined` and with `{ sellerPersonId: 'p-7' }`: the requested paths are `/api/v1/sales-ops/leads/summary` and `/api/v1/sales-ops/leads/summary?sellerPersonId=p-7`, and `queryClient.getQueryData(leadStageSummaryKey(filters))` holds each response.

Mutation fixtures: `seededBoard()` = one page with `L1` (S1, position 0, 100_000), `L2` (S1, 1, 200_000), `L9` (S2, 0, 300_000), `nextCursor: null`; `seededSummary()` = `{ stages: [{ stageId: 'S1', count: 40, estimatedValueBrl: 4_000_000 }, { stageId: 'S2', count: 9, estimatedValueBrl: 900_000 }] }` (larger than the loaded cards, so a patch that recomputed from cards would be caught).
Mutation probes mount ONLY the mutation hook, so no observer refetches the seeded entries.

`describe('optimistic summary on move')`:

23. `it('shifts the paired summary entry in the same tick as the card and restores it exactly on failure')`: seed board and summary for `undefined`; `apiFetch` returns a deferred; `mutateAsync({ leadId: 'L1', toStageId: 'S2', toIndex: 0 })`; after one flush the summary S1 is `{ 39, 3_900_000 }` and S2 `{ 10, 1_000_000 }`; reject; the summary entry `toBe` the seeded object.
24. `it('keeps the shifted summary on success and leaves it invalidated for the refetch')`: resolve with `{ lead: { ...L1, stageId: 'S2', position: 0 } }`; summary still S1 39 / S2 10; `getQueryState(leadStageSummaryKey(undefined))?.isInvalidated` is true.
25. `it('patches only the summary entry paired with the board filters')`: board and summary seeded for `{ sellerPersonId: 'p-1' }`, a second summary seeded for `undefined`; move with `useMoveLead({ sellerPersonId: 'p-1' })`; the p-1 summary is shifted; the `undefined` summary is `toBe` its seeded object.
26. `it('leaves the summary untouched for a reorder inside one column')`: move `L2` to `S1` index 0 (deferred); the summary entry is `toBe` the seeded object.
27. `it('still moves the card when no summary is cached')`: only the board seeded; after the deferred move the board has L1 in S2 and `getQueryData(leadStageSummaryKey(undefined))` is `undefined`; no throw.

`describe('optimistic summary on delete')` (slice 03's `useDeleteLead`, called with L1 in slice 03's variable shape):

28. `it('decrements every summary paired with a board that held the lead and restores them exactly on failure')`: seed board + summary for `undefined` and for `{ sellerPersonId: 'p-1' }` (both boards hold L1); `apiFetch` returns a deferred; after one flush both summaries read S1 `{ 39, 3_900_000 }` and S2 unchanged; reject; both summary entries `toBe` their seeded objects.
29. `it('leaves a summary whose board never held the lead untouched')`: also seed board `{ sellerPersonId: 'p-2' }` holding only L9, with its summary; after the deferred delete of L1 that summary is `toBe` its seeded object.

`describe('every lead write invalidates the summary')`:

30. One `it` per write, each seeding `leadStageSummaryKey(undefined)` and `leadStageSummaryKey({ sellerPersonId: 'p-7' })` (plus `seededBoard()` for `undefined` where the hook needs it), running the mutation to settle, then asserting BOTH entries `isInvalidated === true`:
    - `it('create invalidates the summary')`: `useSaveLead().mutateAsync({ contactName: 'Nova', clientName: 'Acme' })`, `apiFetch` resolves `{ lead: L1 }`.
    - `it('update invalidates the summary')`: same with `id: 'L1'`.
    - `it('a successful move invalidates the summary')`.
    - `it('a failed move invalidates the summary')`: `apiFetch` rejects.
    - `it('delete invalidates the summary')`: `useDeleteLead`, `apiFetch` resolves `undefined`.
    - `it('restore invalidates the summary')`: `useRestoreLead().mutateAsync('L1')` (slice 04's variable is the id), `apiFetch` resolves `{ lead: L1 }`.

### B. Deliberate update - `apps/web/src/sales-ops/leads/__tests__/lead-funnel.test.tsx`

- Import `aggregatesFromLeads` beside `buildCumulativeFunnel, buildLeadFunnel`.
- Every `buildLeadFunnel(X, S)` and `buildCumulativeFunnel(X, S)` becomes `buildLeadFunnel(aggregatesFromLeads(X), S)` / `buildCumulativeFunnel(aggregatesFromLeads(X), S)` (six call sites).
- Every `<LeadsFunnelView leads={X} stages={S} />` becomes `<LeadsFunnelView aggregates={aggregatesFromLeads(X)} stages={S} />`; `leads={[]}` becomes `aggregates={new Map()}`.
- Every expected number stays exactly as it is.
- Extend the header comment: "The builders read per-stage aggregates. These cases feed them `aggregatesFromLeads`, the board's loaded-cards fallback, so every number below is also the fallback's number; the server-summary path is pinned by `lead-board-totals.test.tsx`."
- Add to `describe('buildLeadFunnel')`: `it('ignores aggregates for a stage the board does not draw')`: aggregates from `LEADS` plus `['zzz', { count: 9, totalBrl: 900_000 }]` (no such active stage) give `totalCount` 3 and `totalBrl` 600_000, and no row named for `zzz`.
- The `LeadsBoard funnel toggle` test stays unchanged (no summary, fallback path).

### C. Deliberate update - `apps/web/src/sales-ops/leads/__tests__/leads-contact-container.test.tsx`

- Hoisted `mocks` gain `summary: undefined as unknown`, `boardFilters: [] as unknown[]`, `moveFilters: [] as unknown[]`, `summaryFilters: [] as unknown[]`, all reset in `beforeEach`.
- In the `vi.mock('../hooks', ...)` factory: `useLeadsBoard: (_stages: unknown, filters: unknown) => { mocks.boardFilters.push(filters); return { ...the existing object } }`, `useMoveLead: (filters: unknown) => { mocks.moveFilters.push(filters); return { mutate: vi.fn(), isPending: false } }`, and add `useLeadStageSummary: (filters: unknown) => { mocks.summaryFilters.push(filters); return { data: mocks.summary } }`.
  Keep whatever slice 03 added to this factory (for example `useDeleteLead`).
- The stub `LeadsBoard` gains a button `{ 'data-stub': 'seller', onClick: () => (props.sellerFilter as { onChange?: (v: string | null) => void } | undefined)?.onChange?.('p-7') }`.
- `renderContainer` takes an optional `{ showSellerFilter?: boolean }` and forwards it.
- New test `it('reads the stage summary with the same filters object as the board and the move, and hands it to the board')`: `mocks.summary = { stages: [{ stageId: STAGE_ID, count: 115, estimatedValueBrl: 0 }] }`; render with `showSellerFilter: true`; `lastBoardProps().stageSummary` `toBe(mocks.summary)`; click `[data-stub="seller"]`; then `mocks.summaryFilters.at(-1)` toEqual `{ sellerPersonId: 'p-7' }` and is `toBe(mocks.boardFilters.at(-1))` and `toBe(mocks.moveFilters.at(-1))`.

### D. Unchanged oracles that must stay green

`leads-board-columns.test.tsx`, `leads-list-view.test.tsx`, `leads-contact-board.test.tsx`, `leads-full-edition.test.tsx` (the fallback path, byte-identical numbers), `leads-move-rollback.test.ts` and `leads-board-fanout.test.ts` (the move hook with no summary cached), `lead-conversion.test.tsx` (the `{}` summary body), `board-write-surface.test.ts` (no inline kind comparison was added), `leads-api-contract.test.ts`.
Do not edit them; a failure there is a regression in this slice.

## Commands (run-once only, from `apps/web`)

```bash
pnpm exec vitest run src/sales-ops/leads/__tests__/lead-board-totals.test.tsx src/sales-ops/leads/__tests__/lead-funnel.test.tsx src/sales-ops/leads/__tests__/leads-contact-container.test.tsx
pnpm exec vitest run src/sales-ops/leads
pnpm exec vitest run
pnpm exec eslint src/lib/query-keys.ts src/sales-ops/leads/types.ts src/sales-ops/leads/api.ts src/sales-ops/leads/calculations.ts src/sales-ops/leads/optimistic.ts src/sales-ops/leads/board-labels.ts src/sales-ops/leads/hooks.ts src/sales-ops/leads/deleted-leads.ts src/sales-ops/leads/LeadsBoard.tsx src/sales-ops/leads/LeadsFunnelView.tsx src/sales-ops/leads/LeadsBoardContainer.tsx src/sales-ops/leads/__tests__/lead-board-totals.test.tsx src/sales-ops/leads/__tests__/lead-funnel.test.tsx src/sales-ops/leads/__tests__/leads-contact-container.test.tsx
pnpm run type-check
```

The web vitest config has `passWithNoTests: true`, so a mistyped path passes vacuously.
Read the output: the first command must list all three files, and `lead-board-totals.test.tsx` must report at least 35 passing tests.

## Visual check (Verify, real browser, throwaway, never committed)

The suite cannot see layout, and these totals now carry unloaded leads, so the header holds bigger numbers than before.

1. Create `apps/web/repro.html` (`<div id="root"></div><script type="module" src="/src/repro-main.tsx"></script>`) and `apps/web/src/repro-main.tsx` that imports `./index.css` and renders `<div className="sales-ops p-6"><LeadsBoard ... /></div>` with: stages `Primeiro contato com o cliente` (normal), `Qualificado` (normal), `Proposta` (conversion), `Perdido` (lost); 100 loaded leads in the first stage at 10_000_000 cents each; `stageSummary` first stage `{ 115, 1_150_000_000 }`, Qualificado `{ 7, 21_000_000 }`, Perdido `{ 3, 6_000_000 }`; `hasMore`.
2. `pnpm exec vite --port 8099 --strictPort` in the background; record its PID and process group.
3. At 1440x900 and 390x844 check: every column header is one line with the long name truncated by an ellipsis and the `115` badge fully visible (its `getBoundingClientRect().width` is at least its `scrollWidth`); header cards with 1-, 2- and 3-digit badges have equal heights; `R$ 11.500.000` and `81% do total` sit on one baseline without the share label wrapping; the Lista chip row wraps cleanly with `125` and `115` readable; the footer button reads `Carregar mais leads (100 de 115)`; both Funil shapes render the 122/125 figures.
4. Delete both files and kill the vite process group by its exact PGID (`kill -- -"$pgid"`).

When the local stack is available, also smoke it in `make dev-fake` as `team-owner` on `operacional/leads`: the badges match the seeded counts, the Network panel shows exactly one `GET /api/v1/sales-ops/leads/summary` per board mount, and dragging a card to another column changes both badges before the move request returns.
Stop every process started, by exact PID or process group.

## Capture notes (for the feature capture, AC12; not edited in this slice)

In `CLAUDE.md` "Kanban de leads", replace "Totals derive from the `leads` prop (already seller-scoped server-side), never a client filter." with: "Every per-stage figure (column badge, R$ total, `% do total` and bar, Lista chips and footer, both Funil shapes, the `Carregar mais leads (N de M)` total) reads ONE `resolveStageAggregates(summary, loadedLeads)`: the server's `GET /leads/summary` through `useLeadStageSummary(filters)` (`leadStageSummaryKey(filters)`, the board's memoized `filters`), summed over the active columns only, and the loaded cards until it arrives, never 0. The funnel builders take `LeadStageAggregates`, never a leads array. `useMoveLead` and `useDeleteLead` patch the paired summary entry (`summaryWithLeadMoved` / `summaryWithLeadRemoved`) in the same `onMutate` as the board and restore it whole on error; every lead write invalidates it through `queryKeys.leads.all`. Oracle: `lead-board-totals.test.tsx`."
Mirror it in `nexo/knowledge/reference/kanban-de-leads.md`.

## Out of scope

- Any API change (slice 02 owns the endpoint).
- A per-column "mostrando N de M" hint inside the column; the footer label carries that.
- Prefetching every page to make the cards complete; the totals are complete without it.
- Optimistic summary writes for create, update or restore (no optimistic board write exists for them).

## Rules to respect

- Every HTTP call goes through `leadsApi` / `apiFetch` with a required token; no `(await getToken()) ?? ...`.
- No inline stage-kind comparison in any board file (`board-write-surface.test.ts`); use `lostStage`, `stageIsNormal`, `stageOpensConversion`.
- No raw id rendered anywhere; the summary carries ids only as keys.
- `queryKeys` stays the single key factory; `leadStageSummaryKey` delegates to it.
- Never use the em dash character; one sentence per line in long Markdown; Conventional Commit; no Co-Authored-By trailer.
