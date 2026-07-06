import { useAccessToken } from '@/auth/react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { adminAuditApi } from '@/lib/api-client';

/**
 * Admin audit log hooks (Phase 05 T12, D-J). The list endpoint returns a per-page
 * chain check (page_chain_valid); verifyChain is the authoritative whole-ledger check
 * (D-R NIT). Both read-only.
 */
export function useAuditLog(page = 1, action?: string) {
  const { getToken } = useAccessToken();
  return useQuery({
    queryKey: ['admin', 'audit', page, action],
    queryFn: async () => adminAuditApi.list({ page, action }, (await getToken()) ?? ''),
  });
}

export function useVerifyChain() {
  const { getToken } = useAccessToken();
  return useMutation({
    mutationFn: async () => adminAuditApi.verifyChain((await getToken()) ?? ''),
  });
}
