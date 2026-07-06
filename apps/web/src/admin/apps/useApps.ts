import { useAccessToken } from '@/auth/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { adminAppsApi } from '@/lib/api-client';
import type { AppRow, CreateAppBody, UpdateAppBody } from '@/admin/types';

/**
 * Admin apps TanStack Query hooks (Phase 02, T06). Each hook resolves the active
 * auth provider token and threads it into the adminAppsApi call (D-J).
 */

export function useAdminApps() {
  const { getToken } = useAccessToken();
  return useQuery({
    queryKey: ['admin', 'apps'],
    queryFn: async () => adminAppsApi.list((await getToken()) ?? ''),
    select: (d): AppRow[] => (Array.isArray(d.apps) ? d.apps : []),
  });
}

export function useCreateApp() {
  const { getToken } = useAccessToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: CreateAppBody) => adminAppsApi.create(data, (await getToken()) ?? ''),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'apps'] });
    },
  });
}

export function useUpdateApp() {
  const { getToken } = useAccessToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdateAppBody }) =>
      adminAppsApi.update(id, data, (await getToken()) ?? ''),
    onSuccess: (_res, { id }) => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'apps'] });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'apps', id] });
    },
  });
}

export function useSetAppStatus() {
  const { getToken } = useAccessToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: 'active' | 'disabled' }) =>
      adminAppsApi.setStatus(id, status, (await getToken()) ?? ''),
    onSuccess: (_res, { id }) => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'apps'] });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'apps', id] });
    },
  });
}

// Rotation hooks return plaintext for the reveal modal; they do NOT invalidate
// the apps list (the prefix is unchanged in the list view).
export function useRotateSecretKey() {
  const { getToken } = useAccessToken();
  return useMutation({
    mutationFn: async (id: string) => adminAppsApi.rotateSecretKey(id, (await getToken()) ?? ''),
  });
}

export function useRotateWebhookSecret() {
  const { getToken } = useAccessToken();
  return useMutation({
    mutationFn: async (id: string) =>
      adminAppsApi.rotateWebhookSecret(id, (await getToken()) ?? ''),
  });
}
