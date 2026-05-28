/**
 * Thin fetch wrapper for talking to apps/api.
 *
 * Usage with TanStack Query:
 *   useQuery({ queryKey: ['items'], queryFn: () => apiFetch<Item[]>('/items') })
 *
 * Auth: pass the Clerk session token via getToken() — wire that up per project.
 * In the template, no pages call this — left here as the canonical helper to extend.
 */

const baseUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:3006';

export type ApiError = {
  error: string;
  message?: string;
  status: number;
};

export async function apiFetch<T>(
  path: string,
  init?: RequestInit & { token?: string },
): Promise<T> {
  const { token, headers, ...rest } = init ?? {};
  const res = await fetch(`${baseUrl}${path}`, {
    ...rest,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err: ApiError = {
      error: body.error ?? 'request_failed',
      message: body.message,
      status: res.status,
    };
    throw err;
  }

  return res.json() as Promise<T>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin API clients (Phase 02, D-J). Every call goes through apiFetch (NEVER a
// bare relative fetch, NEVER apiClient.get). Each call takes a Clerk token the
// hook resolved via useAuth().getToken().
// ─────────────────────────────────────────────────────────────────────────────

import type {
  AppRow,
  CommissionRule,
  CreateAppBody,
  CreateProductBody,
  CreateSellerBody,
  FinderListResponse,
  FinderRow,
  FinderStatus,
  PriceBand,
  PriceBandComponent,
  ProductListRow,
  ProductRow,
  SellerRow,
  SellerStatus,
  UpdateAppBody,
  UpdateProductBody,
  UpsertCommissionRuleBody,
  UpsertPriceBandBody,
} from '@/admin/types';

export const adminAppsApi = {
  list: (token: string) => apiFetch<{ apps: AppRow[] }>('/api/v1/admin/apps', { method: 'GET', token }),
  get: (id: string, token: string) =>
    apiFetch<{ app: AppRow }>(`/api/v1/admin/apps/${id}`, { method: 'GET', token }),
  create: (data: CreateAppBody, token: string) =>
    apiFetch<{ app: AppRow; secretKeyPlaintext: string; webhookSigningSecretPlaintext: string }>(
      '/api/v1/admin/apps',
      { method: 'POST', token, body: JSON.stringify(data) },
    ),
  update: (id: string, data: UpdateAppBody, token: string) =>
    apiFetch<{ app: AppRow }>(`/api/v1/admin/apps/${id}`, {
      method: 'PATCH',
      token,
      body: JSON.stringify(data),
    }),
  setStatus: (id: string, status: 'active' | 'disabled', token: string) =>
    apiFetch<{ app: AppRow }>(`/api/v1/admin/apps/${id}/status`, {
      method: 'PATCH',
      token,
      body: JSON.stringify({ status }),
    }),
  rotateSecretKey: (id: string, token: string) =>
    apiFetch<{ secretKeyPlaintext: string }>(`/api/v1/admin/apps/${id}/rotate-secret-key`, {
      method: 'POST',
      token,
    }),
  rotateWebhookSecret: (id: string, token: string) =>
    apiFetch<{ webhookSigningSecretPlaintext: string }>(
      `/api/v1/admin/apps/${id}/rotate-webhook-secret`,
      { method: 'POST', token },
    ),
};

export const adminProductsApi = {
  list: (appId: string | undefined, token: string) =>
    apiFetch<{ products: ProductListRow[] }>(
      `/api/v1/admin/products${appId ? `?appId=${appId}` : ''}`,
      { method: 'GET', token },
    ),
  get: (id: string, token: string) =>
    apiFetch<{ product: ProductRow; priceBands: PriceBand[]; commissionRule?: CommissionRule }>(
      `/api/v1/admin/products/${id}`,
      { method: 'GET', token },
    ),
  create: (data: CreateProductBody, token: string) =>
    apiFetch<{ product: ProductRow }>('/api/v1/admin/products', {
      method: 'POST',
      token,
      body: JSON.stringify(data),
    }),
  update: (id: string, data: UpdateProductBody, token: string) =>
    apiFetch<{ product: ProductRow }>(`/api/v1/admin/products/${id}`, {
      method: 'PATCH',
      token,
      body: JSON.stringify(data),
    }),
  upsertPriceBand: (
    id: string,
    component: PriceBandComponent,
    data: UpsertPriceBandBody,
    token: string,
  ) =>
    apiFetch<{ priceBand: PriceBand }>(`/api/v1/admin/products/${id}/price-bands/${component}`, {
      method: 'PUT',
      token,
      body: JSON.stringify(data),
    }),
  upsertCommissionRule: (id: string, data: UpsertCommissionRuleBody, token: string) =>
    apiFetch<{ commissionRule: CommissionRule }>(
      `/api/v1/admin/products/${id}/commission-rule`,
      { method: 'PUT', token, body: JSON.stringify(data) },
    ),
};

// ─── Phase 03: finders + sellers (D-J — manual URLSearchParams, no `params`) ──

export const adminFindersApi = {
  list: (status: FinderStatus | undefined, token: string) => {
    const qs = status ? `?${new URLSearchParams({ status }).toString()}` : '';
    return apiFetch<FinderListResponse>(`/api/v1/admin/finders${qs}`, { method: 'GET', token });
  },
  get: (id: string, token: string) =>
    apiFetch<{ finder: FinderRow }>(`/api/v1/admin/finders/${id}`, { method: 'GET', token }),
  approve: (id: string, token: string) =>
    apiFetch<{ id: string; status: FinderStatus }>(`/api/v1/admin/finders/${id}/approve`, {
      method: 'POST',
      token,
    }),
  suspend: (id: string, reason: string, token: string) =>
    apiFetch<{ id: string; status: FinderStatus }>(`/api/v1/admin/finders/${id}/suspend`, {
      method: 'POST',
      token,
      body: JSON.stringify({ reason }),
    }),
};

export const adminSellersApi = {
  list: (token: string) =>
    apiFetch<{ sellers: SellerRow[] }>('/api/v1/admin/sellers', { method: 'GET', token }),
  create: (data: CreateSellerBody, token: string) =>
    apiFetch<{ seller: SellerRow }>('/api/v1/admin/sellers', {
      method: 'POST',
      token,
      body: JSON.stringify(data),
    }),
  setStatus: (id: string, status: SellerStatus, token: string) =>
    apiFetch<{ seller: SellerRow }>(`/api/v1/admin/sellers/${id}/status`, {
      method: 'PATCH',
      token,
      body: JSON.stringify({ status }),
    }),
};
