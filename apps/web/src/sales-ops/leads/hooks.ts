import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAccessToken } from '@/auth/react';
import { useAppMutation } from '@/lib/app-mutation';
import { queryKeys } from '@/lib/query-keys';
import { requireToken } from '@/lib/require-token';
import {
  leadsApi,
  type MoveLeadPayload,
  type ReorderLeadStagesPayload,
  type SaveLeadPayload,
  type SaveLeadStagePayload,
  type SetLeadStageStatusPayload,
} from './api';
import { boardStages } from './calculations';
import {
  flattenLeadPages,
  leadsHasMore,
  optimisticLeadMove,
  reconcileLeadRow,
  type OptimisticLeadPatch,
} from './optimistic';
import type {
  LeadBoardFilters,
  LeadBoardModel,
  LeadResponse,
  LeadStageResponse,
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
 * No optimistic write: the server assigns `position`, `stageChangedAt` and the
 * product rows, so the client cannot build the persisted row - and guessing a
 * `position` is how a brand-new card flickers into the middle of a column. Same
 * reasoning as `useSaveSalesOpsProduct`.
 */
export function useSaveLead() {
  const { getToken } = useAccessToken();
  return useAppMutation<LeadResponse, Error, SaveLeadPayload>({
    mutationFn: async (payload) => leadsApi.saveLead(payload, await requireToken(getToken)),
    invalidates: [queryKeys.leads.all],
  });
}

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
 */
export function useMoveLead(filters?: LeadBoardFilters) {
  const { getToken } = useAccessToken();
  const queryClient = useQueryClient();
  const boardKey = queryKeys.leads.board(filters);
  return useAppMutation<LeadResponse, Error, MoveLeadPayload, OptimisticLeadPatch | undefined>({
    mutationFn: async (payload) => leadsApi.moveLead(payload, await requireToken(getToken)),
    invalidates: [queryKeys.leads.all],
    onMutate: async (payload) => {
      // An in-flight page fetch must not land on top of the optimistic write.
      await queryClient.cancelQueries({ queryKey: queryKeys.leads.all });
      const previous = queryClient.getQueryData<LeadsInfiniteData>(boardKey);
      if (!previous) return undefined;
      const patch = optimisticLeadMove(previous, payload);
      queryClient.setQueryData(boardKey, patch.next);
      return patch;
    },
    onError: (_error, _payload, patch) => {
      if (!patch) return;
      queryClient.setQueryData(boardKey, patch.previous);
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
