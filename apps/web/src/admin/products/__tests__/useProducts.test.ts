import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppRow, CreateProductBody, ProductListRow, ProductRow } from '@/admin/types';
import { adminProductsApi } from '@/lib/api-client';
import { useCreateProduct } from '../useProducts';

vi.mock('@/auth/react', () => ({
  useAccessToken: () => ({ getToken: async () => 'test-token' }),
  useSalesEdition: () => 'full',
}));

vi.mock('@/lib/api-client', () => ({
  adminProductsApi: {
    create: vi.fn(),
  },
}));

type CreateProductMutation = ReturnType<typeof useCreateProduct>;

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });
}

function captureCreateProductMutation(queryClient: QueryClient): CreateProductMutation {
  let mutation: CreateProductMutation | undefined;

  function CaptureMutation() {
    mutation = useCreateProduct();
    return null;
  }

  renderToString(
    createElement(
      QueryClientProvider,
      { client: queryClient },
      createElement(CaptureMutation),
    ),
  );

  if (!mutation) {
    throw new Error('useCreateProduct did not render');
  }

  return mutation;
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, reject, resolve };
}

async function flushPromises() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function productsFrom(queryClient: QueryClient, key: readonly unknown[]) {
  return queryClient.getQueryData<{ products: ProductListRow[] }>(key)?.products ?? [];
}

const app: AppRow = {
  id: '11111111-1111-4111-8111-111111111111',
  slug: 'fxl-sales',
  name: 'FXL Sales',
  publishableKey: 'pk_test',
  secretKeyPrefix: 'sk_test',
  allowedRedirectHosts: ['example.com'],
  attributionWindowDays: 30,
  commissionHoldDays: 7,
  status: 'active',
  createdByUserId: 'user-1',
  createdAt: '2026-07-07T12:00:00.000Z',
  updatedAt: null,
};

const existingProduct: ProductListRow = {
  id: '22222222-2222-4222-8222-222222222222',
  appId: app.id,
  appName: app.name,
  appSlug: app.slug,
  slug: 'existing-plan',
  name: 'Existing Plan',
  description: null,
  status: 'active',
  createdAt: '2026-07-07T12:00:00.000Z',
  updatedAt: null,
};

const createBody: CreateProductBody = {
  appId: app.id,
  slug: 'instant-plan',
  name: 'Instant Plan',
  description: 'Created from the dialog',
  status: 'active',
};

const serverProduct: ProductRow = {
  id: '33333333-3333-4333-8333-333333333333',
  appId: app.id,
  slug: createBody.slug,
  name: createBody.name,
  description: createBody.description ?? null,
  status: createBody.status ?? 'active',
  createdAt: '2026-07-07T12:01:00.000Z',
  updatedAt: null,
};

afterEach(() => {
  vi.clearAllMocks();
});

describe('useCreateProduct', () => {
  it('adds a product row to matching list caches before the create request settles', async () => {
    const queryClient = createQueryClient();
    const deferred = createDeferred<{ product: ProductRow }>();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
    vi.mocked(adminProductsApi.create).mockReturnValueOnce(deferred.promise);
    queryClient.setQueryData(['admin', 'apps'], { apps: [app] });
    queryClient.setQueryData(['admin', 'products', 'all'], { products: [existingProduct] });
    queryClient.setQueryData(['admin', 'products', app.id], { products: [existingProduct] });
    queryClient.setQueryData(['admin', 'products', 'other-app'], { products: [] });

    const mutation = captureCreateProductMutation(queryClient);
    const mutationPromise = mutation.mutateAsync(createBody);

    await flushPromises();

    expect(productsFrom(queryClient, ['admin', 'products', 'all'])).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: expect.stringMatching(/^optimistic:/),
          appId: app.id,
          appName: app.name,
          appSlug: app.slug,
          slug: createBody.slug,
          name: createBody.name,
          description: createBody.description,
          status: 'active',
        }),
      ]),
    );
    expect(productsFrom(queryClient, ['admin', 'products', app.id])).toHaveLength(2);
    expect(productsFrom(queryClient, ['admin', 'products', 'other-app'])).toHaveLength(0);

    deferred.resolve({ product: serverProduct });
    await mutationPromise;

    expect(productsFrom(queryClient, ['admin', 'products', 'all'])).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: serverProduct.id,
          appName: app.name,
          appSlug: app.slug,
          name: serverProduct.name,
        }),
      ]),
    );
    expect(
      productsFrom(queryClient, ['admin', 'products', 'all']).some((product) =>
        product.id.startsWith('optimistic:'),
      ),
    ).toBe(false);
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['admin', 'products'] });
  });

  it('restores the previous list cache when create fails', async () => {
    const queryClient = createQueryClient();
    const deferred = createDeferred<{ product: ProductRow }>();
    vi.mocked(adminProductsApi.create).mockReturnValueOnce(deferred.promise);
    queryClient.setQueryData(['admin', 'apps'], { apps: [app] });
    queryClient.setQueryData(['admin', 'products', 'all'], { products: [existingProduct] });

    const mutation = captureCreateProductMutation(queryClient);
    const mutationPromise = mutation.mutateAsync(createBody);

    await flushPromises();

    expect(productsFrom(queryClient, ['admin', 'products', 'all'])).toHaveLength(2);

    deferred.reject(new Error('network failed'));
    await expect(mutationPromise).rejects.toThrow('network failed');

    expect(productsFrom(queryClient, ['admin', 'products', 'all'])).toEqual([existingProduct]);
  });
});
