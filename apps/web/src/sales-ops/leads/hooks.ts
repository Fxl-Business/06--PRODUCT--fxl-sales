import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
  type QueryClient,
  type QueryKey,
} from '@tanstack/react-query';
import { useAccessToken } from '@/auth/react';
import { useAppMutation } from '@/lib/app-mutation';
import { queryKeys } from '@/lib/query-keys';
import { requireToken } from '@/lib/require-token';
import {
  deleteLead,
  leadsApi,
  type MoveLeadPayload,
  type ReorderLeadStagesPayload,
  type SaveContactLeadPayload,
  type SaveLeadPayload,
  type SaveLeadStagePayload,
  type SetLeadStageStatusPayload,
} from './api';
import { boardStages } from './calculations';
import {
  flattenLeadPages,
  leadsHasMore,
  optimisticLeadMove,
  optimisticLeadRemoval,
  reconcileLeadRow,
  summaryWithLeadMoved,
  summaryWithLeadRemoved,
  type OptimisticLeadPatch,
} from './optimistic';
import type {
  LeadBoardFilters,
  LeadBoardModel,
  LeadResponse,
  LeadStageResponse,
  LeadStageSummary,
  LeadStagesReorderResponse,
  LeadStagesResponse,
  LeadsInfiniteData,
  LeadsPage,
  SalesOpsLeadStage,
} from './types';

/**
 * The lead pipeline's hooks. They hold no logic beyond wiring; every derivation
 * lives in `./calculations` or `./optimistic`. The one exception is the board
 * fan-out below, which needs to know which columns exist in order to ask for
 * them at all.
 */

/**
 * Hoisted so its identity is stable across renders, exactly as
 * `selectSalesOpsBootstrap` is. An inline `select` arrow defeats TanStack's
 * per-selector memo and hands every render a brand new object, which in turn
 * recomputes every downstream useMemo.
 */
function selectLeadBoardModel(data: LeadsInfiniteData): LeadBoardModel {
  return { leads: flattenLeadPages(data), hasMore: leadsHasMore(data) };
}

function selectLeadStages(data: LeadStagesResponse): SalesOpsLeadStage[] {
  return Array.isArray(data.stages) ? data.stages : [];
}

export function useLeadStages() {
  const { getToken } = useAccessToken();
  return useQuery({
    queryKey: queryKeys.leads.stages(),
    queryFn: async () => leadsApi.listStages(await requireToken(getToken)),
    select: selectLeadStages,
  });
}

/**
 * One cursor per stage id. `null` means that column is exhausted (or not
 * started). It never reaches the wire - `listLeads` sends the per-column string -
 * so it rides in `LeadsPage.nextCursor`'s slot rather than growing a second page
 * type that `flattenLeadPages`, `leadsHasMore` and `reconcileLeadRow` would all
 * have to learn.
 */
type BoardCursors = Record<string, string | null>;

/**
 * ONE flat board cache entry over a PER-COLUMN endpoint.
 *
 * The shipped `ListLeadsQuerySchema` REQUIRES `stageId`, so there is no
 * board-wide list endpoint, and one "page" of this infinite query is one
 * board-wide ROUND of "ask every unfinished column for its next slice". The
 * fan-out lives HERE and nowhere else, because a move crosses two columns and a
 * two-cache-entry patch would have to roll back two entries atomically.
 *
 * `useInfiniteQuery` and not a page-numbered `useQuery`, because the endpoint is
 * KEYSET-paginated: the cursor is the `pageParam`, so it stays OUT of the query
 * key, which is what lets `onMutate` write into one stable cache entry instead of
 * hunting for whichever page key happens to hold the card.
 */
export function useLeadsBoard(
  stages: readonly SalesOpsLeadStage[],
  filters?: LeadBoardFilters,
) {
  const { getToken } = useAccessToken();
  return useInfiniteQuery({
    queryKey: queryKeys.leads.board(filters),
    queryFn: async ({ pageParam }): Promise<LeadsPage> => {
      const token = await requireToken(getToken);
      const cursors = pageParam as BoardCursors | null;
      // Only the columns that still have something to give. On the FIRST page
      // that is every stage the board draws; afterwards it is the ones whose
      // cursor is non-null. A stage archived between two pages simply drops out
      // of `wanted`, while the cards already in the cache stay until the next
      // invalidation - a card sitting in a just-archived column is still a card.
      const wanted = boardStages(stages).filter(
        (stage) => cursors === null || cursors[stage.id] != null,
      );
      // Promise.all and not sequential: the columns are independent and the board
      // is one screen, so serialising them would make the first paint wait on the
      // slowest column times N.
      const answered = await Promise.all(
        wanted.map(async (stage) => ({
          stageId: stage.id,
          page: await leadsApi.listLeads(
            {
              stageId: stage.id,
              cursor: cursors?.[stage.id] ?? null,
              sellerPersonId: filters?.sellerPersonId,
            },
            token,
          ),
        })),
      );
      const next: BoardCursors = {};
      for (const { stageId, page } of answered) next[stageId] = page.nextCursor;
      return {
        leads: answered.flatMap(({ page }) => page.leads),
        nextCursor: Object.values(next).some((cursor) => cursor !== null)
          ? (next as unknown as string)
          : null,
      };
    },
    initialPageParam: null as BoardCursors | null,
    getNextPageParam: (lastPage: LeadsPage) =>
      lastPage.nextCursor as unknown as BoardCursors | null,
    // Without the stage list there is no `stageId` to send, and the API answers
    // 400 to a request without one. The container resolves the stages first.
    enabled: stages.length > 0,
    select: selectLeadBoardModel,
  });
}

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
  return segment && typeof segment === 'object'
    ? (segment as { sellerPersonId?: string })
    : undefined;
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

/**
 * No optimistic write: the server assigns `position`, `stageChangedAt` and the
 * product rows, so the client cannot build the persisted row - and guessing a
 * `position` is how a brand-new card flickers into the middle of a column. Same
 * reasoning as `useSaveSalesOpsProduct`.
 */
export function useSaveLead() {
  const { getToken } = useAccessToken();
  return useAppMutation<LeadResponse, Error, SaveLeadPayload | SaveContactLeadPayload>({
    mutationFn: async (payload) => leadsApi.saveLead(payload, await requireToken(getToken)),
    invalidates: [queryKeys.leads.all],
  });
}

type MoveLeadContext = OptimisticLeadPatch & { summaries: SummarySnapshot[] };

/**
 * THE optimistic one.
 *
 * The mutation patches the cache entry the board is reading, so both must be
 * given the SAME filters; a mismatch degrades to no optimistic write at all (the
 * `!previous` early return), never to a patch written into a cache entry nobody
 * renders. That degradation direction is why the early return exists and why it
 * must not be replaced by a `getQueriesData` sweep across every board key -
 * patching a filtered board the operator cannot see is how a card appears twice.
 *
 * Rolling back by writing `patch.previous` WHOLE is what makes the revert exact:
 * the previous snapshot carries every row's previous `stageId` AND its previous
 * `position` AND its previous `stageChangedAt`, so the revert is total by
 * construction rather than by a field list somebody has to remember to extend.
 *
 * The summary entry paired with the board entry is shifted in the same
 * `onMutate` and written back whole on error; the settle invalidation re-reads
 * both from the server.
 */
export function useMoveLead(filters?: LeadBoardFilters) {
  const { getToken } = useAccessToken();
  const queryClient = useQueryClient();
  const boardKey = queryKeys.leads.board(filters);
  return useAppMutation<LeadResponse, Error, MoveLeadPayload, MoveLeadContext | undefined>({
    mutationFn: async (payload) => leadsApi.moveLead(payload, await requireToken(getToken)),
    invalidates: [queryKeys.leads.all],
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
    onSuccess: (response, _payload, patch) => {
      if (!patch) return;
      const current = queryClient.getQueryData<LeadsInfiniteData>(boardKey);
      if (!current) return;
      queryClient.setQueryData(boardKey, reconcileLeadRow(current, response.lead));
    },
  });
}

/**
 * The prefix every board cache entry shares, whatever its filters
 * (`['leads', 'board']`). Derived from the factory, never hand-typed.
 */
const LEAD_BOARDS_PREFIX: QueryKey = queryKeys.leads.board(undefined).slice(0, 2);

/** What `useDeleteLead` wrote, one entry per board cache entry it patched. */
type LeadRemovalSnapshot = {
  boards: Array<{ key: QueryKey; previous: LeadsInfiniteData }>;
  summaries: SummarySnapshot[];
};

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { status?: unknown }).status === 404
  );
}

/**
 * Moves a lead to the lixeira (`POST /leads/:id/delete`), OPTIMISTICALLY.
 *
 * Unlike `useMoveLead`, the patch sweeps EVERY cached board entry, whatever its
 * filters. Removing a card can never make it appear twice, which is the hazard
 * that keeps the move patch on one key, and a lead deleted under one vendedor
 * filter must not survive in the unfiltered board the operator switches back to.
 *
 * Each patched entry is restored WHOLE from its own snapshot on error, so the
 * revert is exact by construction. A `404` is NOT an error here: the lead is
 * already gone (deleted elsewhere, or no longer in this viewer's scope), which
 * is the outcome the operator asked for, so the card stays removed and the
 * mutation resolves. Every outcome invalidates the leads root on settle.
 *
 * The summary entry paired with each board entry that held the lead loses that
 * lead in the same `onMutate`, and is written back whole on error.
 */
export function useDeleteLead() {
  const { getToken } = useAccessToken();
  const queryClient = useQueryClient();
  return useAppMutation<void, Error, string, LeadRemovalSnapshot>({
    mutationFn: async (leadId) => {
      try {
        await deleteLead(await requireToken(getToken), leadId);
      } catch (error: unknown) {
        if (isNotFound(error)) return;
        throw error;
      }
    },
    invalidates: [queryKeys.leads.all],
    onMutate: async (leadId) => {
      // An in-flight page fetch must not land on top of the optimistic removal.
      await queryClient.cancelQueries({ queryKey: queryKeys.leads.all });
      const boards: LeadRemovalSnapshot['boards'] = [];
      const summaries: SummarySnapshot[] = [];
      for (const [key, data] of queryClient.getQueriesData<LeadsInfiniteData>({
        queryKey: LEAD_BOARDS_PREFIX,
      })) {
        if (!data) continue;
        const patch = optimisticLeadRemoval(data, leadId);
        if (patch.next === data) continue;
        boards.push({ key, previous: data });
        queryClient.setQueryData(key, patch.next);
        // The lead is looked up in the PREVIOUS board data: the patched one no longer holds it.
        const row = flattenLeadPages(data).find((candidate) => candidate.id === leadId);
        const summary = row
          ? patchPairedSummary(queryClient, boardFiltersOf(key), (current) =>
              summaryWithLeadRemoved(current, row),
            )
          : null;
        if (summary) summaries.push(summary);
      }
      return { boards, summaries };
    },
    onError: (_error, _leadId, snapshot) => {
      for (const { key, previous } of snapshot?.boards ?? []) {
        queryClient.setQueryData(key, previous);
      }
      restoreSummaries(queryClient, snapshot?.summaries ?? []);
    },
  });
}

/**
 * No optimistic write: a low-frequency admin write on a small list behind an
 * `Atualizando` indicator. An optimistic stage row would buy nothing and would
 * need a second patch family.
 */
export function useSaveLeadStage() {
  const { getToken } = useAccessToken();
  return useAppMutation<LeadStageResponse, Error, SaveLeadStagePayload>({
    mutationFn: async (payload) => leadsApi.saveStage(payload, await requireToken(getToken)),
    invalidates: [queryKeys.leads.all],
  });
}

/**
 * No optimistic write, for the same reason as `useSaveLeadStage`. Archiving a
 * stage removes a COLUMN, so the one `queryKeys.leads.all` invalidation refreshes
 * the cadastro list and the board together.
 */
export function useSetLeadStageStatus() {
  const { getToken } = useAccessToken();
  return useAppMutation<LeadStageResponse, Error, SetLeadStageStatusPayload>({
    mutationFn: async (payload) => leadsApi.setStageStatus(payload, await requireToken(getToken)),
    invalidates: [queryKeys.leads.all],
  });
}

/**
 * No optimistic write, for the same reason as `useSaveLeadStage`: the server
 * renumbers the whole active set in one transaction, so the persisted positions
 * are not something the client can compute row by row.
 */
export function useReorderLeadStages() {
  const { getToken } = useAccessToken();
  return useAppMutation<LeadStagesReorderResponse, Error, ReorderLeadStagesPayload>({
    mutationFn: async (payload) => leadsApi.reorderStages(payload, await requireToken(getToken)),
    invalidates: [queryKeys.leads.all],
  });
}
