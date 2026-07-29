import { useAccessToken } from '@/auth/react';
import { useQuery } from '@tanstack/react-query';
import {
  adminCommissionsApi,
  type AdminCommissionRow,
  type CommissionStatus,
} from '@/lib/api-client';
import { useAppMutation } from '@/lib/app-mutation';
import { queryKeys } from '@/lib/query-keys';

/**
 * Admin commissions hooks (Phase 05 T11, D-J/D-K). The lock mutation is the manual
 * "approve / lock-now" fast-track (pending→locked) - there is NO /approve endpoint.
 */
export function useAdminCommissions(filters?: { status?: CommissionStatus; finderId?: string }) {
  const { getToken } = useAccessToken();
  return useQuery({
    queryKey: queryKeys.adminCommissions.list(filters),
    queryFn: async () => adminCommissionsApi.list(filters, (await getToken()) ?? ''),
    select: (d): AdminCommissionRow[] => (Array.isArray(d.commissions) ? d.commissions : []),
  });
}

export function useLockCommission() {
  const { getToken } = useAccessToken();
  return useAppMutation({
    mutationFn: async (commissionId: string) =>
      adminCommissionsApi.lock(commissionId, (await getToken()) ?? ''),
    invalidates: [queryKeys.adminCommissions.all],
  });
}

export function useReverseCommission() {
  const { getToken } = useAccessToken();
  return useAppMutation({
    mutationFn: async ({ commissionId, reason }: { commissionId: string; reason: string }) =>
      adminCommissionsApi.reverse(commissionId, reason, (await getToken()) ?? ''),
    invalidates: [queryKeys.adminCommissions.all],
  });
}
