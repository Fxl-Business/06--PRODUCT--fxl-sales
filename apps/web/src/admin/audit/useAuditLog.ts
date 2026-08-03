import { useAccessToken } from '@/auth/react';
import { useQuery } from '@tanstack/react-query';
import { adminAuditApi } from '@/lib/api-client';
import { NO_CACHE_EFFECT, useAppMutation } from '@/lib/app-mutation';
import { queryKeys } from '@/lib/query-keys';
import { requireToken } from '@/lib/require-token';

/**
 * Admin audit log hooks (Phase 05 T12, D-J). The list endpoint returns a per-page
 * chain check (page_chain_valid); verifyChain is the authoritative whole-ledger check
 * (D-R NIT). Both read-only.
 */
export function useAuditLog(page = 1, action?: string) {
  const { getToken } = useAccessToken();
  return useQuery({
    queryKey: queryKeys.adminAudit.list(page, action),
    queryFn: async () => adminAuditApi.list({ page, action }, await requireToken(getToken)),
  });
}

export function useVerifyChain() {
  const { getToken } = useAccessToken();
  // NO_CACHE_EFFECT: verification only reads the ledger, it writes no row.
  return useAppMutation({
    mutationFn: async () => adminAuditApi.verifyChain(await requireToken(getToken)),
    invalidates: NO_CACHE_EFFECT,
  });
}
