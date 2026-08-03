import { useAccessToken } from '@/auth/react';
import { useQuery } from '@tanstack/react-query';
import { adminAppsApi } from '@/lib/api-client';
import { useAppMutation } from '@/lib/app-mutation';
import { queryKeys } from '@/lib/query-keys';
import { requireToken } from '@/lib/require-token';
import type { AppRow, CreateAppBody, UpdateAppBody } from '@/admin/types';

/**
 * Admin apps TanStack Query hooks (Phase 02, T06). Each hook resolves the active
 * auth provider token and threads it into the adminAppsApi call (D-J). Cache
 * refresh is declared by each mutation's `invalidates` field.
 */

export function useAdminApps() {
  const { getToken } = useAccessToken();
  return useQuery({
    queryKey: queryKeys.adminApps.list(),
    queryFn: async () => adminAppsApi.list(await requireToken(getToken)),
    select: (d): AppRow[] => (Array.isArray(d.apps) ? d.apps : []),
  });
}

export function useCreateApp() {
  const { getToken } = useAccessToken();
  return useAppMutation({
    mutationFn: async (data: CreateAppBody) =>
      adminAppsApi.create(data, await requireToken(getToken)),
    invalidates: [queryKeys.adminApps.all],
  });
}

export function useUpdateApp() {
  const { getToken } = useAccessToken();
  return useAppMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdateAppBody }) =>
      adminAppsApi.update(id, data, await requireToken(getToken)),
    invalidates: ({ variables }) => [
      queryKeys.adminApps.all,
      queryKeys.adminApps.detail(variables.id),
    ],
  });
}

export function useSetAppStatus() {
  const { getToken } = useAccessToken();
  return useAppMutation({
    mutationFn: async ({ id, status }: { id: string; status: 'active' | 'disabled' }) =>
      adminAppsApi.setStatus(id, status, await requireToken(getToken)),
    invalidates: ({ variables }) => [
      queryKeys.adminApps.all,
      queryKeys.adminApps.detail(variables.id),
    ],
  });
}

// Rotation hooks return plaintext for the reveal modal and refresh the app row,
// because the stored secret metadata (prefix, rotation timestamps) changed.
export function useRotateSecretKey() {
  const { getToken } = useAccessToken();
  return useAppMutation({
    mutationFn: async (id: string) =>
      adminAppsApi.rotateSecretKey(id, await requireToken(getToken)),
    invalidates: ({ variables }) => [
      queryKeys.adminApps.all,
      queryKeys.adminApps.detail(variables),
    ],
  });
}

export function useRotateWebhookSecret() {
  const { getToken } = useAccessToken();
  return useAppMutation({
    mutationFn: async (id: string) =>
      adminAppsApi.rotateWebhookSecret(id, await requireToken(getToken)),
    invalidates: ({ variables }) => [
      queryKeys.adminApps.all,
      queryKeys.adminApps.detail(variables),
    ],
  });
}
