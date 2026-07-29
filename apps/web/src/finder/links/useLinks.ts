import { useAccessToken } from '@/auth/react';
import { useQuery } from '@tanstack/react-query';
import { finderCatalogApi, finderClicksApi, finderLinksApi } from '@/lib/api-client';
import { useAppMutation } from '@/lib/app-mutation';
import { queryKeys } from '@/lib/query-keys';
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
    queryKey: queryKeys.finderLinks.list(),
    queryFn: async () => finderLinksApi.list((await getToken()) ?? ''),
    select: (d): ReferralLink[] => (Array.isArray(d.links) ? d.links : []),
  });
}

export function useFinderApps() {
  const { getToken } = useAccessToken();
  return useQuery({
    queryKey: queryKeys.finderCatalog.apps(),
    queryFn: async () => finderCatalogApi.listApps((await getToken()) ?? ''),
    select: (d): FinderApp[] => (Array.isArray(d.apps) ? d.apps : []),
  });
}

export function useFinderProducts(appId?: string) {
  const { getToken } = useAccessToken();
  return useQuery({
    queryKey: queryKeys.finderCatalog.products(appId),
    queryFn: async () => finderCatalogApi.listProducts(appId!, (await getToken()) ?? ''),
    enabled: !!appId,
    select: (d): FinderProduct[] => (Array.isArray(d.products) ? d.products : []),
  });
}

export function useCreateLink() {
  const { getToken } = useAccessToken();
  return useAppMutation({
    mutationFn: async (data: CreateLinkBody) =>
      finderLinksApi.create(data, (await getToken()) ?? ''),
    invalidates: [queryKeys.finderLinks.all],
  });
}

export function useRevokeLink() {
  const { getToken } = useAccessToken();
  return useAppMutation({
    mutationFn: async ({ linkId, reason }: { linkId: string; reason?: string }) =>
      finderLinksApi.revoke(linkId, reason, (await getToken()) ?? ''),
    invalidates: [queryKeys.finderLinks.all],
  });
}

export function useFinderClickStats() {
  const { getToken } = useAccessToken();
  return useQuery({
    queryKey: queryKeys.finderClicks.stats(),
    queryFn: async (): Promise<ClickStats> => finderClicksApi.getStats((await getToken()) ?? ''),
  });
}
