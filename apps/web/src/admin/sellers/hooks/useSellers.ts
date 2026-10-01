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

/**
 * Create a seller and send its Hub invitation. Resolves with the whole body: the
 * seller always exists, and the invite outcome (delivery or `inviteError`) is
 * for the page to show.
 */
export function useInviteSeller() {
  const { getToken } = useAccessToken();
  return useAppMutation({
    mutationFn: async (data: CreateSellerBody) =>
      adminSellersApi.create(data, await requireToken(getToken)),
    invalidates: [queryKeys.adminSellers.all],
  });
}

/**
 * Resend the stored Hub invitation of one seller (`POST /:id/resend`). The
 * response carries a fresh delivery (and possibly a new `acceptUrl`); a failure
 * rejects with an `ApiError` keyed by `code`.
 */
export function useResendSellerInvitation() {
  const { getToken } = useAccessToken();
  return useAppMutation({
    mutationFn: async (sellerId: string) =>
      adminSellersApi.resendInvitation(sellerId, await requireToken(getToken)),
    invalidates: [queryKeys.adminSellers.all],
  });
}

/** Revoke the stored Hub invitation of one seller (`POST /:id/revoke`). */
export function useRevokeSellerInvitation() {
  const { getToken } = useAccessToken();
  return useAppMutation({
    mutationFn: async (sellerId: string) =>
      adminSellersApi.revokeInvitation(sellerId, await requireToken(getToken)),
    invalidates: [queryKeys.adminSellers.all],
  });
}
