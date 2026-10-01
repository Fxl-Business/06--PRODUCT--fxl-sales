import { useAccessToken } from '@/auth/react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { adminSellersApi, type InviteLocale } from '@/lib/api-client';
import { useAppMutation } from '@/lib/app-mutation';
import { queryKeys } from '@/lib/query-keys';
import { requireToken } from '@/lib/require-token';
import type { CreateSellerBody, SellerRow } from '@/admin/types';

/**
 * Admin sellers TanStack Query hooks (Phase 03 T10). apiFetch + getToken() (D-J).
 */

/**
 * The ONE mapping from the active UI language to the invitation email locale:
 * any `en` variant is `en`, everything else (unknown or absent included) is
 * `pt-BR`, the product default. Used by create, send and resend.
 */
export function inviteLocaleOf(language: string | undefined): InviteLocale {
  return language?.startsWith('en') ? 'en' : 'pt-BR';
}

/** Reads the UI language at call time, so a switch is honoured by the next request. */
function useInviteLocale(): () => InviteLocale {
  const { i18n } = useTranslation();
  return () => inviteLocaleOf(i18n.resolvedLanguage ?? i18n.language);
}

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
  const localeNow = useInviteLocale();
  return useAppMutation({
    mutationFn: async (data: CreateSellerBody) =>
      adminSellersApi.create(data, localeNow(), await requireToken(getToken)),
    invalidates: [queryKeys.adminSellers.all],
  });
}

/**
 * Send a NEW Hub invitation to a seller with none or a revoked one
 * (`POST /:id/invite`). Resolves with a delivery like resend; a failure rejects
 * with an `ApiError` keyed by `code`.
 */
export function useSendSellerInvitation() {
  const { getToken } = useAccessToken();
  const localeNow = useInviteLocale();
  return useAppMutation({
    mutationFn: async (sellerId: string) =>
      adminSellersApi.sendInvitation(sellerId, localeNow(), await requireToken(getToken)),
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
  const localeNow = useInviteLocale();
  return useAppMutation({
    mutationFn: async (sellerId: string) =>
      adminSellersApi.resendInvitation(sellerId, localeNow(), await requireToken(getToken)),
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
