import { useAccessToken } from '@/auth/react';
import { useQuery } from '@tanstack/react-query';
import {
  adminPayoutsApi,
  type FinderCommissionSummary,
  type PayoutRow,
} from '@/lib/api-client';
import { NO_CACHE_EFFECT, useAppMutation } from '@/lib/app-mutation';
import { queryKeys } from '@/lib/query-keys';
import { requireToken } from '@/lib/require-token';

/**
 * Admin payouts hooks (Phase 06 T09/T10, D-J/D-Q). All calls go through the
 * api-client (apiFetch + Bearer token). Each mutation's `invalidates` declaration is
 * the source of truth for which caches it refreshes.
 */

export function useFindersReady() {
  const { getToken } = useAccessToken();
  return useQuery({
    queryKey: queryKeys.payouts.findersReady(),
    queryFn: async () => adminPayoutsApi.findersReady(await requireToken(getToken)),
    select: (d): FinderCommissionSummary[] => (Array.isArray(d.finders) ? d.finders : []),
  });
}

export function usePayoutsList() {
  const { getToken } = useAccessToken();
  return useQuery({
    queryKey: queryKeys.payouts.list(),
    queryFn: async () => adminPayoutsApi.list(await requireToken(getToken)),
    select: (d): PayoutRow[] => (Array.isArray(d.payouts) ? d.payouts : []),
  });
}

export function useCreatePayoutBatches() {
  const { getToken } = useAccessToken();
  return useAppMutation({
    mutationFn: async (finderIds: string[]) =>
      adminPayoutsApi.createBatches(finderIds, await requireToken(getToken)),
    invalidates: [queryKeys.payouts.all],
  });
}

export function useMarkPayoutPaid() {
  const { getToken } = useAccessToken();
  return useAppMutation({
    mutationFn: async (payoutId: string) =>
      adminPayoutsApi.markPaid(payoutId, await requireToken(getToken)),
    invalidates: [queryKeys.payouts.all],
  });
}

/**
 * Downloads a payout CSV through apiFetchBlob (carries the Bearer token) and
 * triggers a browser download via an object URL + <a download> - NOT a token-less
 * window.location.href navigation (D-J).
 */
export function useDownloadPayoutCsv() {
  const { getToken } = useAccessToken();
  // NO_CACHE_EFFECT: a blob download writes no row the query cache holds.
  return useAppMutation({
    mutationFn: async (payoutId: string) => {
      const { blob, filename } = await adminPayoutsApi.downloadCsv(
        payoutId,
        await requireToken(getToken),
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename ?? `payout-${payoutId}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    },
    invalidates: NO_CACHE_EFFECT,
  });
}
