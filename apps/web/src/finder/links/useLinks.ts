import { useAccessToken } from '@/auth/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { finderCatalogApi, finderClicksApi, finderLinksApi } from '@/lib/api-client';
import type {
  ClickStats,
  CreateLinkBody,
  FinderApp,
  FinderProduct,
  ReferralLink,
} from '@/finder/types';

/**
 * Finder links TanStack Query hooks (Phase 04, T08). Each resolves the active auth
 * token and threads it into the apiFetch call (D-J).
 * App/product selectors use the FIRST-CLASS finder routes (NOT admin hooks -
 * admin routes are requireAdmin-gated; a finder JWT would 403).
 */

export function useFinderLinks() {
  const { getToken } = useAccessToken();
  return useQuery({
    queryKey: ['finder', 'links'],
    queryFn: async () => finderLinksApi.list((await getToken()) ?? ''),
    select: (d): ReferralLink[] => (Array.isArray(d.links) ? d.links : []),
  });
}

export function useFinderApps() {
  const { getToken } = useAccessToken();
  return useQuery({
    queryKey: ['finder', 'apps'],
    queryFn: async () => finderCatalogApi.listApps((await getToken()) ?? ''),
    select: (d): FinderApp[] => (Array.isArray(d.apps) ? d.apps : []),
  });
}

export function useFinderProducts(appId?: string) {
  const { getToken } = useAccessToken();
  return useQuery({
    queryKey: ['finder', 'apps', appId, 'products'],
    queryFn: async () => finderCatalogApi.listProducts(appId!, (await getToken()) ?? ''),
    enabled: !!appId,
    select: (d): FinderProduct[] => (Array.isArray(d.products) ? d.products : []),
  });
}

export function useCreateLink() {
  const { getToken } = useAccessToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: CreateLinkBody) => finderLinksApi.create(data, (await getToken()) ?? ''),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['finder', 'links'] });
    },
  });
}

export function useRevokeLink() {
  const { getToken } = useAccessToken();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ linkId, reason }: { linkId: string; reason?: string }) =>
      finderLinksApi.revoke(linkId, reason, (await getToken()) ?? ''),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['finder', 'links'] });
    },
  });
}

export function useFinderClickStats() {
  const { getToken } = useAccessToken();
  return useQuery({
    queryKey: ['finder', 'clicks', 'stats'],
    queryFn: async (): Promise<ClickStats> => finderClicksApi.getStats((await getToken()) ?? ''),
  });
}
