import { useAccessToken } from '@/auth/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  adminCommissionsApi,
  type AdminCommissionRow,
  type CommissionStatus,
} from '@/lib/api-client';

/**
 * Admin commissions hooks (Phase 05 T11, D-J/D-K). The lock mutation is the manual
 * "approve / lock-now" fast-track (pending→locked) — there is NO /approve endpoint.
 * Both mutations invalidate ['admin','commissions'] on success.
 */
export function useAdminCommissions(filters?: { status?: CommissionStatus; finderId?: string }) {
  const { getToken } = useAccessToken();
  return useQuery({
    queryKey: ['admin', 'commissions', filters],
    queryFn: async () => adminCommissionsApi.list(filters, (await getToken()) ?? ''),
    select: (d): AdminCommissionRow[] => (Array.isArray(d.commissions) ? d.commissions : []),
  });
}

export function useLockCommission() {
  const { getToken } = useAccessToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (commissionId: string) =>
      adminCommissionsApi.lock(commissionId, (await getToken()) ?? ''),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'commissions'] });
    },
  });
}

export function useReverseCommission() {
  const { getToken } = useAccessToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ commissionId, reason }: { commissionId: string; reason: string }) =>
      adminCommissionsApi.reverse(commissionId, reason, (await getToken()) ?? ''),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'commissions'] });
    },
  });
}
