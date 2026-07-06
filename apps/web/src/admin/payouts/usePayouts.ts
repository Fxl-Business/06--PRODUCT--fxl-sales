import { useAccessToken } from '@/auth/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  adminPayoutsApi,
  type FinderCommissionSummary,
  type PayoutRow,
} from '@/lib/api-client';

/**
 * Admin payouts hooks (Phase 06 T09/T10, D-J/D-Q). All calls go through the
 * api-client (apiFetch + Bearer token). Mutations invalidate BOTH the finders-ready
 * list and the payouts list (a batch-create empties finders-ready and adds payouts;
 * mark-paid moves a payout to 'paid' and may free reserved commissions).
 */

export function useFindersReady() {
  const { getToken } = useAccessToken();
  return useQuery({
    queryKey: ['payouts', 'finders-ready'],
    queryFn: async () => adminPayoutsApi.findersReady((await getToken()) ?? ''),
    select: (d): FinderCommissionSummary[] => (Array.isArray(d.finders) ? d.finders : []),
  });
}

export function usePayoutsList() {
  const { getToken } = useAccessToken();
  return useQuery({
    queryKey: ['payouts', 'list'],
    queryFn: async () => adminPayoutsApi.list((await getToken()) ?? ''),
    select: (d): PayoutRow[] => (Array.isArray(d.payouts) ? d.payouts : []),
  });
}

export function useCreatePayoutBatches() {
  const { getToken } = useAccessToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (finderIds: string[]) =>
      adminPayoutsApi.createBatches(finderIds, (await getToken()) ?? ''),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['payouts', 'finders-ready'] });
      void queryClient.invalidateQueries({ queryKey: ['payouts', 'list'] });
    },
  });
}

export function useMarkPayoutPaid() {
  const { getToken } = useAccessToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payoutId: string) =>
      adminPayoutsApi.markPaid(payoutId, (await getToken()) ?? ''),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['payouts', 'list'] });
      void queryClient.invalidateQueries({ queryKey: ['payouts', 'finders-ready'] });
    },
  });
}

/**
 * Downloads a payout CSV through apiFetchBlob (carries the Bearer token) and
 * triggers a browser download via an object URL + <a download> — NOT a token-less
 * window.location.href navigation (D-J).
 */
export function useDownloadPayoutCsv() {
  const { getToken } = useAccessToken();
  return useMutation({
    mutationFn: async (payoutId: string) => {
      const { blob, filename } = await adminPayoutsApi.downloadCsv(payoutId, (await getToken()) ?? '');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename ?? `payout-${payoutId}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    },
  });
}
