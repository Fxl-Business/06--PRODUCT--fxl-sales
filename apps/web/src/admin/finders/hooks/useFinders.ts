import { useAuth } from '@clerk/clerk-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { adminFindersApi } from '@/lib/api-client';
import type { FinderRow, FinderStatus } from '@/admin/types';

/**
 * Admin finders TanStack Query hooks (Phase 03 T10). All calls go through
 * apiFetch + Clerk getToken() (D-J). approve/suspend invalidate BOTH the list
 * key ['admin','finders'] AND the detail key ['admin','finders', id] (WARN).
 */

export function useFinders(status?: FinderStatus) {
  const { getToken } = useAuth();
  return useQuery({
    queryKey: ['admin', 'finders', status],
    queryFn: async () => adminFindersApi.list(status, (await getToken()) ?? ''),
    select: (data): FinderRow[] => (Array.isArray(data.items) ? data.items : []),
  });
}

export function useFinder(id: string) {
  const { getToken } = useAuth();
  return useQuery({
    queryKey: ['admin', 'finders', id],
    queryFn: async () => adminFindersApi.get(id, (await getToken()) ?? ''),
    select: (data): FinderRow => data.finder,
  });
}

export function useApproveFinder() {
  const { getToken } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => adminFindersApi.approve(id, (await getToken()) ?? ''),
    onSuccess: (_data, id) => {
      void qc.invalidateQueries({ queryKey: ['admin', 'finders'] });
      void qc.invalidateQueries({ queryKey: ['admin', 'finders', id] });
    },
  });
}

export function useSuspendFinder() {
  const { getToken } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) =>
      adminFindersApi.suspend(id, reason, (await getToken()) ?? ''),
    onSuccess: (_data, { id }) => {
      void qc.invalidateQueries({ queryKey: ['admin', 'finders'] });
      void qc.invalidateQueries({ queryKey: ['admin', 'finders', id] });
    },
  });
}
