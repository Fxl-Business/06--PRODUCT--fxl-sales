import { useAccessToken } from '@/auth/react';
import { useQuery } from '@tanstack/react-query';
import { adminSellersApi } from '@/lib/api-client';
import { useAppMutation } from '@/lib/app-mutation';
import { queryKeys } from '@/lib/query-keys';
import { requireToken } from '@/lib/require-token';
import type { CreateSellerBody, SellerRow } from '@/admin/types';

/**
 * Admin sellers TanStack Query hooks (Phase 03 T10). apiFetch + getToken() (D-J).
 */

export function useSellers() {
  const { getToken } = useAccessToken();
  return useQuery({
    queryKey: queryKeys.adminSellers.list(),
    queryFn: async () => adminSellersApi.list(await requireToken(getToken)),
    select: (data): SellerRow[] => (Array.isArray(data.sellers) ? data.sellers : []),
  });
}

export function useInviteSeller() {
  const { getToken } = useAccessToken();
  return useAppMutation({
    mutationFn: async (data: CreateSellerBody) =>
      adminSellersApi.create(data, await requireToken(getToken)),
    invalidates: [queryKeys.adminSellers.all],
  });
}
