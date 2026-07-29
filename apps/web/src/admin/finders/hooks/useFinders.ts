import { useAccessToken } from '@/auth/react';
import { useQuery } from '@tanstack/react-query';
import { adminFindersApi } from '@/lib/api-client';
import { useAppMutation } from '@/lib/app-mutation';
import { queryKeys } from '@/lib/query-keys';
import type { FinderRow, FinderStatus } from '@/admin/types';

/**
 * Admin finders TanStack Query hooks (Phase 03 T10). All calls go through
 * apiFetch + useAccessToken() (D-J). Each mutation's `invalidates` declaration is
 * the source of truth for which caches it refreshes.
 */

export function useFinders(status?: FinderStatus) {
  const { getToken } = useAccessToken();
  return useQuery({
    queryKey: queryKeys.adminFinders.list(status),
    queryFn: async () => adminFindersApi.list(status, (await getToken()) ?? ''),
    select: (data): FinderRow[] => (Array.isArray(data.items) ? data.items : []),
  });
}

export function useFinder(id: string) {
  const { getToken } = useAccessToken();
  return useQuery({
    queryKey: queryKeys.adminFinders.detail(id),
    queryFn: async () => adminFindersApi.get(id, (await getToken()) ?? ''),
    select: (data): FinderRow => data.finder,
  });
}

export function useApproveFinder() {
  const { getToken } = useAccessToken();
  return useAppMutation({
    mutationFn: async (id: string) => adminFindersApi.approve(id, (await getToken()) ?? ''),
    invalidates: ({ variables }) => [
      queryKeys.adminFinders.all,
      queryKeys.adminFinders.detail(variables),
    ],
  });
}

export function useSuspendFinder() {
  const { getToken } = useAccessToken();
  return useAppMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) =>
      adminFindersApi.suspend(id, reason, (await getToken()) ?? ''),
    invalidates: ({ variables }) => [
      queryKeys.adminFinders.all,
      queryKeys.adminFinders.detail(variables.id),
    ],
  });
}
