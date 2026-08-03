import { useAccessToken } from '@/auth/react';
import {
  useQuery,
  useQueryClient,
  type QueryClient,
  type QueryKey,
} from '@tanstack/react-query';
import { adminProductsApi } from '@/lib/api-client';
import { useAppMutation } from '@/lib/app-mutation';
import { queryKeys } from '@/lib/query-keys';
import { requireToken } from '@/lib/require-token';
import type {
  AppRow,
  CreateProductBody,
  PriceBandComponent,
  ProductListRow,
  ProductRow,
  UpdateProductBody,
  UpsertCommissionRuleBody,
  UpsertPriceBandBody,
} from '@/admin/types';

/**
 * Admin products / price-bands / commission-rules hooks (Phase 02, T07). Token
 * resolved via useAccessToken(), threaded into adminProductsApi (D-J).
 */

type ProductsListData = { products: ProductListRow[] };
type AppsListData = { apps: AppRow[] };
type ProductListSnapshot = { queryKey: QueryKey; data: ProductsListData };
type OptimisticProductContext = {
  optimisticId: string;
  optimisticRow: ProductListRow;
  snapshots: ProductListSnapshot[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isProductsListData(data: unknown): data is ProductsListData {
  return isRecord(data) && Array.isArray(data.products);
}

function isAppsListData(data: unknown): data is AppsListData {
  return isRecord(data) && Array.isArray(data.apps);
}

function productListQueryMatchesApp(queryKey: QueryKey, appId: string): boolean {
  if (queryKey[0] !== 'admin' || queryKey[1] !== 'products') return false;
  const filter = queryKey[2];
  // 'detail' is the single-product key segment, never a list filter.
  if (filter === 'detail') return false;
  return filter === 'all' || filter === appId;
}

function sortedProducts(products: ProductListRow[]): ProductListRow[] {
  return [...products].sort((a, b) => a.name.localeCompare(b.name));
}

function findCachedApp(queryClient: QueryClient, appId: string): AppRow | undefined {
  const data = queryClient.getQueryData<unknown>(queryKeys.adminApps.list());
  if (!isAppsListData(data)) return undefined;
  return data.apps.find((app) => app.id === appId);
}

function productListRowFromProduct(
  product: ProductRow,
  app: Pick<AppRow, 'name' | 'slug'> | undefined,
  fallback?: Pick<ProductListRow, 'appName' | 'appSlug'>,
): ProductListRow {
  return {
    ...product,
    appName: app?.name ?? fallback?.appName ?? '',
    appSlug: app?.slug ?? fallback?.appSlug ?? '',
  };
}

function optimisticProductRowFromBody(
  data: CreateProductBody,
  app: AppRow | undefined,
): ProductListRow {
  return {
    id: `optimistic:${data.appId}:${data.slug}`,
    appId: data.appId,
    appName: app?.name ?? '',
    appSlug: app?.slug ?? '',
    slug: data.slug,
    name: data.name,
    description: data.description ?? null,
    status: data.status ?? 'active',
    createdAt: new Date().toISOString(),
    updatedAt: null,
  };
}

function applyOptimisticProductCreate(
  queryClient: QueryClient,
  data: CreateProductBody,
): OptimisticProductContext {
  const app = findCachedApp(queryClient, data.appId);
  const optimisticRow = optimisticProductRowFromBody(data, app);
  const snapshots = queryClient
    .getQueriesData<unknown>({ queryKey: queryKeys.adminProducts.all })
    .reduce<ProductListSnapshot[]>((acc, [queryKey, listData]) => {
      if (!productListQueryMatchesApp(queryKey, data.appId) || !isProductsListData(listData)) {
        return acc;
      }

      acc.push({ queryKey, data: listData });
      queryClient.setQueryData<ProductsListData>(queryKey, {
        products: sortedProducts([
          ...listData.products.filter((product) => product.id !== optimisticRow.id),
          optimisticRow,
        ]),
      });
      return acc;
    }, []);

  return { optimisticId: optimisticRow.id, optimisticRow, snapshots };
}

function reconcileOptimisticProductCreate(
  queryClient: QueryClient,
  context: OptimisticProductContext | undefined,
  product: ProductRow,
) {
  if (!context) return;
  const app = findCachedApp(queryClient, product.appId);
  const persistedRow = productListRowFromProduct(product, app, context.optimisticRow);

  for (const snapshot of context.snapshots) {
    const current = queryClient.getQueryData<unknown>(snapshot.queryKey);
    if (!isProductsListData(current)) continue;
    queryClient.setQueryData<ProductsListData>(snapshot.queryKey, {
      products: sortedProducts(
        current.products.map((row) => (row.id === context.optimisticId ? persistedRow : row)),
      ),
    });
  }
}

function rollbackOptimisticProductCreate(
  queryClient: QueryClient,
  context: OptimisticProductContext | undefined,
) {
  if (!context) return;
  for (const snapshot of context.snapshots) {
    const current = queryClient.getQueryData<unknown>(snapshot.queryKey);
    if (!isProductsListData(current)) {
      queryClient.setQueryData<ProductsListData>(snapshot.queryKey, snapshot.data);
      continue;
    }
    queryClient.setQueryData<ProductsListData>(snapshot.queryKey, {
      products: current.products.filter((row) => row.id !== context.optimisticId),
    });
  }
}

export function useAdminProducts(appId?: string) {
  const { getToken } = useAccessToken();
  return useQuery({
    queryKey: queryKeys.adminProducts.list(appId),
    queryFn: async () => adminProductsApi.list(appId, await requireToken(getToken)),
    select: (d): ProductListRow[] => (Array.isArray(d.products) ? d.products : []),
  });
}

export function useAdminProduct(id: string) {
  const { getToken } = useAccessToken();
  return useQuery({
    queryKey: queryKeys.adminProducts.detail(id),
    queryFn: async () => adminProductsApi.get(id, await requireToken(getToken)),
    enabled: Boolean(id),
  });
}

export function useCreateProduct() {
  const { getToken } = useAccessToken();
  const queryClient = useQueryClient();
  return useAppMutation({
    mutationFn: async (data: CreateProductBody) =>
      adminProductsApi.create(data, await requireToken(getToken)),
    invalidates: [queryKeys.adminProducts.all],
    onMutate: async (data) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.adminProducts.all });
      return applyOptimisticProductCreate(queryClient, data);
    },
    onSuccess: (res, _data, context) => {
      reconcileOptimisticProductCreate(queryClient, context, res.product);
    },
    onError: (_error, _data, context) => {
      rollbackOptimisticProductCreate(queryClient, context);
    },
  });
}

export function useUpdateProduct() {
  const { getToken } = useAccessToken();
  return useAppMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdateProductBody }) =>
      adminProductsApi.update(id, data, await requireToken(getToken)),
    invalidates: ({ variables }) => [
      queryKeys.adminProducts.all,
      queryKeys.adminProducts.detail(variables.id),
    ],
  });
}

export function useUpsertPriceBand(productId: string) {
  const { getToken } = useAccessToken();
  return useAppMutation({
    mutationFn: async ({
      component,
      data,
    }: {
      component: PriceBandComponent;
      data: UpsertPriceBandBody;
    }) =>
      adminProductsApi.upsertPriceBand(productId, component, data, await requireToken(getToken)),
    invalidates: [queryKeys.adminProducts.detail(productId)],
  });
}

export function useUpsertCommissionRule(productId: string) {
  const { getToken } = useAccessToken();
  return useAppMutation({
    mutationFn: async (data: UpsertCommissionRuleBody) =>
      adminProductsApi.upsertCommissionRule(productId, data, await requireToken(getToken)),
    invalidates: [queryKeys.adminProducts.detail(productId)],
  });
}
