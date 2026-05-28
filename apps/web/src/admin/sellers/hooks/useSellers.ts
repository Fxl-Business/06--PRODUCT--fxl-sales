import { useAuth } from '@clerk/clerk-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { adminSellersApi } from '@/lib/api-client';
import type { CreateSellerBody, SellerRow } from '@/admin/types';

/**
 * Admin sellers TanStack Query hooks (Phase 03 T10). apiFetch + getToken() (D-J).
 * The invite mutation invalidates ['admin','sellers'].
 */

export function useSellers() {
  const { getToken } = useAuth();
  return useQuery({
    queryKey: ['admin', 'sellers'],
    queryFn: async () => adminSellersApi.list((await getToken()) ?? ''),
    select: (data): SellerRow[] => (Array.isArray(data.sellers) ? data.sellers : []),
  });
}

export function useInviteSeller() {
  const { getToken } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (data: CreateSellerBody) =>
      adminSellersApi.create(data, (await getToken()) ?? ''),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['admin', 'sellers'] });
    },
  });
}
