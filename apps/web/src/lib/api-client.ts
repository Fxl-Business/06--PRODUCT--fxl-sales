/**
 * Thin fetch wrapper for talking to apps/api.
 *
 * Usage with TanStack Query:
 *   useQuery({ queryKey: ['items'], queryFn: async () => apiFetch<Item[]>('/items', {
 *     method: 'GET', token: await requireToken(getToken),
 *   }) })
 *
 * Auth: `token` is REQUIRED and must be non-empty. It comes from
 * requireToken(getToken) in ./require-token, never from `(await getToken()) ?? ""`
 * - a blank token used to be laundered into a header-less anonymous request.
 */

import { assertBearerToken } from './require-token';

const baseUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:3006';

export type ApiError = {
  error: string;
  /**
   * The API's machine-readable sub-reason, when it sends one. Today the only
   * one that matters is `missing_entitlement` on a 402. Optional because an
   * older API build, or a 402 whose body does not parse, sends no `code` at
   * all - classification therefore keys on `status`, never on this field. See
   * `isEntitlementFailure` in ./require-token.
   */
  code?: string;
  message?: string;
  status: number;
  /**
   * The C5 `rows` of a 409 (`row_has_active_settlement`, `sale_has_active_settlements`):
   * the ledger rows that blocked the write. Display data only; never used to
   * classify auth failures, which key on `status` alone.
   */
  rows?: ApiErrorRow[];
  /**
   * The wait a `429` asked for, in seconds: the body's `retryAfterSeconds` when
   * the API sends one, else a numeric `Retry-After` header the browser could
   * read. Absent when neither is available. Display data only.
   */
  retryAfterSeconds?: number;
  /**
   * The parsed JSON error body, set ONLY by `apiUpload`. The import commit answers
   * `422` with a whole preview body that the screen must render. Display data only:
   * classification still keys on `status`.
   */
  body?: unknown;
};

/** One ledger row named by a 409 body. `id` is for logic only, never for display. */
export type ApiErrorRow = { kind: 'receivable' | 'payable'; id: string; label: string };

export async function apiFetch<T>(
  path: string,
  init: RequestInit & { token: string },
): Promise<T> {
  const { token, headers, ...rest } = init;
  // Throws BEFORE fetch: an empty token must never become an anonymous request.
  assertBearerToken(token);
  const res = await fetch(`${baseUrl}${path}`, {
    ...rest,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...headers,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err: ApiError = {
      error: body.error ?? 'request_failed',
      code: body.code,
      message: body.message,
      status: res.status,
      rows: Array.isArray(body.rows) ? (body.rows as ApiErrorRow[]) : undefined,
    };
    const retryAfterSeconds = retryAfterOf(body, res);
    if (retryAfterSeconds !== undefined) err.retryAfterSeconds = retryAfterSeconds;
    throw err;
  }

  return res.json() as Promise<T>;
}

function retryAfterOf(body: { retryAfterSeconds?: unknown }, res: Response): number | undefined {
  if (typeof body.retryAfterSeconds === 'number' && body.retryAfterSeconds >= 0) {
    return body.retryAfterSeconds;
  }
  // `headers` is optional on purpose: a cross-origin response hides
  // `Retry-After` unless exposed, and minimal fetch fakes carry no headers.
  const header = res.headers?.get('Retry-After') ?? null;
  if (header !== null && /^\d+$/.test(header.trim())) return Number(header.trim());
  return undefined;
}

/**
 * Blob variant of apiFetch (Phase 06 - CSV download, D-J). Goes through the SAME
 * base URL + Bearer token as apiFetch (NEVER a token-less window.location.href).
 * Returns the Blob + the Content-Disposition filename (if the server set one).
 */
export async function apiFetchBlob(
  path: string,
  init: RequestInit & { token: string },
): Promise<{ blob: Blob; filename: string | null }> {
  const { token, headers, ...rest } = init;
  assertBearerToken(token);
  const res = await fetch(`${baseUrl}${path}`, {
    ...rest,
    headers: {
      Authorization: `Bearer ${token}`,
      ...headers,
    },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err: ApiError = {
      error: body.error ?? 'request_failed',
      code: body.code,
      message: body.message,
      status: res.status,
      rows: Array.isArray(body.rows) ? (body.rows as ApiErrorRow[]) : undefined,
    };
    throw err;
  }
  const disposition = res.headers.get('Content-Disposition');
  const match = disposition?.match(/filename="?([^"]+)"?/);
  return { blob: await res.blob(), filename: match?.[1] ?? null };
}

/**
 * Multipart variant of apiFetch for file uploads (the spreadsheet import). Same base
 * URL and Bearer chokepoint; deliberately NO Content-Type header, because the browser
 * must write `multipart/form-data; boundary=...` itself. A failure throws an ApiError
 * that also carries the parsed `body`.
 */
export async function apiUpload<T>(
  path: string,
  init: { token: string; form: FormData },
): Promise<T> {
  assertBearerToken(init.token);
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${init.token}` },
    body: init.form,
  });
  if (!res.ok) {
    const body: unknown = await res.json().catch(() => ({}));
    const record =
      typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
    const err: ApiError = {
      error: typeof record.error === 'string' ? record.error : 'request_failed',
      code: typeof record.code === 'string' ? record.code : undefined,
      message: typeof record.message === 'string' ? record.message : undefined,
      status: res.status,
      body,
    };
    throw err;
  }
  return res.json() as Promise<T>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin API clients (Phase 02, D-J). Every call goes through apiFetch (NEVER a
// bare relative fetch, NEVER apiClient.get). Each call takes the active provider
// token resolved by useAccessToken().
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
import type {
  ClickRow,
  ClickStats,
  CreateLinkBody,
  FinderApp,
  FinderProduct,
  ReferralLink,
} from '@/finder/types';

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

// ─── Phase 03: finders + sellers (D-J - manual URLSearchParams, no `params`) ──

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
  /**
   * Always `201` once the seller row exists: the invite outcome is in the BODY,
   * either the delivery fields at top level or `inviteError`. Read the body,
   * never the HTTP status, to learn whether the invitation went out.
   */
  create: (data: CreateSellerBody, locale: InviteLocale, token: string) =>
    apiFetch<CreateSellerResult>('/api/v1/admin/sellers', {
      method: 'POST',
      token,
      body: JSON.stringify({ ...data, locale }),
    }),
  setStatus: (id: string, status: SellerStatus, token: string) =>
    apiFetch<{ seller: SellerRow }>(`/api/v1/admin/sellers/${id}/status`, {
      method: 'PATCH',
      token,
      body: JSON.stringify({ status }),
    }),
  /**
   * A NEW invitation for a seller with none or a revoked one (`POST /:id/invite`),
   * the same Hub call as create. Unlike create, a failure REJECTS with an
   * `ApiError` keyed by `code` (`seller_already_invited` included).
   */
  sendInvitation: (id: string, locale: InviteLocale, token: string) =>
    apiFetch<{ seller: SellerRow } & SellerInviteDelivery>(
      `/api/v1/admin/sellers/${id}/invite`,
      { method: 'POST', token, body: JSON.stringify({ locale }) },
    ),
  /** A failure rejects with an `ApiError` whose `code` names it (or `error` on a bare 404). */
  resendInvitation: (id: string, locale: InviteLocale, token: string) =>
    apiFetch<{ seller: SellerRow } & SellerInviteDelivery>(
      `/api/v1/admin/sellers/${id}/resend`,
      { method: 'POST', token, body: JSON.stringify({ locale }) },
    ),
  revokeInvitation: (id: string, token: string) =>
    apiFetch<{ seller: SellerRow }>(`/api/v1/admin/sellers/${id}/revoke`, {
      method: 'POST',
      token,
    }),
};

/**
 * The language of the invitation email, the closed set the API accepts
 * (`z.enum(['pt-BR', 'en'])`). Derived from the UI language by `inviteLocaleOf`,
 * never free text.
 */
export type InviteLocale = 'pt-BR' | 'en';

/** The closed set of warnings the Hub may attach to a sent invitation. */
export type SellerInviteWarningCode = 'application_url_missing' | 'email_not_configured' | 'email_failed';

/**
 * What a create or resend answers about a sent invitation. `acceptUrl` carries a
 * single-use token: it may be shown to the admin, never logged or stored.
 */
export type SellerInviteDelivery = {
  invitation: { id: string; email: string; status: string; expiresAt: string };
  acceptUrl: string;
  emailDelivery: { status: 'sent' | 'not_configured' | 'failed' };
  warnings: Array<{ code: SellerInviteWarningCode }>;
};

/** An invite the API could not send. `message` is server prose: never rendered. */
export type SellerInviteError = {
  status: number;
  error: string;
  code: string;
  message?: string;
  retryAfterSeconds?: number;
};

export type CreateSellerResult =
  | ({ seller: SellerRow; inviteError?: undefined } & SellerInviteDelivery)
  | { seller: SellerRow; inviteError: SellerInviteError };

// ─── Phase 04: finder links + catalog + clicks (D-J - apiFetch + Bearer token) ──
// FIRST-CLASS finder-authed endpoints — NOT admin-route reuse (admin routes are
// requireAdmin-gated; a finder JWT would 403).

export const finderLinksApi = {
  list: (token: string) =>
    apiFetch<{ links: ReferralLink[] }>('/api/v1/links', { method: 'GET', token }),
  create: (data: CreateLinkBody, token: string) =>
    apiFetch<{ link: ReferralLink; fullUrl: string }>('/api/v1/links', {
      method: 'POST',
      token,
      body: JSON.stringify(data),
    }),
  revoke: (linkId: string, reason: string | undefined, token: string) =>
    apiFetch<null>(`/api/v1/links/${linkId}`, {
      method: 'DELETE',
      token,
      body: JSON.stringify({ reason }),
    }),
};

export const finderCatalogApi = {
  listApps: (token: string) =>
    apiFetch<{ apps: FinderApp[] }>('/api/v1/finder/apps', { method: 'GET', token }),
  listProducts: (appId: string, token: string) =>
    apiFetch<{ products: FinderProduct[] }>(`/api/v1/finder/apps/${appId}/products`, {
      method: 'GET',
      token,
    }),
};

export const finderClicksApi = {
  list: (params: { linkId?: string; limit?: number; cursor?: string } | undefined, token: string) => {
    const qs = new URLSearchParams();
    if (params?.linkId) qs.set('linkId', params.linkId);
    if (params?.limit) qs.set('limit', String(params.limit));
    if (params?.cursor) qs.set('cursor', params.cursor);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return apiFetch<{ clicks: ClickRow[]; nextCursor: string | null }>(
      `/api/v1/finder/clicks${suffix}`,
      { method: 'GET', token },
    );
  },
  getStats: (token: string) =>
    apiFetch<ClickStats>('/api/v1/finder/clicks/stats', { method: 'GET', token }),
};

// ─────────────────────────────────────────────────────────────────────────────
// Phase 05 — admin reconciliation reads (conversions, commissions, audit). All via
// apiFetch + Bearer token (D-J). Responses carry resolved display names (no raw UUIDs).
// ─────────────────────────────────────────────────────────────────────────────

export type CommissionStatus = 'pending' | 'approved' | 'locked' | 'paid' | 'reversed';

export type AdminConversionRow = {
  id: string;
  source: string;
  externalOrderId: string;
  eventType: string;
  finderId: string;
  finderDisplayName: string | null;
  sellerId: string | null;
  sellerDisplayName: string | null;
  productId: string;
  realizedSetupBrl: number;
  realizedMonthlyBrl: number;
  closedAt: string;
  createdAt: string;
};

export type AdminCommissionRow = {
  id: string;
  finderId: string;
  productId: string;
  kind: 'setup' | 'recurring';
  basisBrl: number;
  ratePct: string;
  amountBrl: number;
  status: CommissionStatus;
  holdUntil: string;
  createdAt: string;
};

export type AuditLogEntry = {
  id: string;
  ts: string;
  actorUserId: string;
  actorOrgId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  requestId: string | null;
};

export const adminConversionsApi = {
  list: (params: { source?: string; finderId?: string } | undefined, token: string) => {
    const qs = new URLSearchParams();
    if (params?.source) qs.set('source', params.source);
    if (params?.finderId) qs.set('finderId', params.finderId);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return apiFetch<{ conversions: AdminConversionRow[] }>(`/api/v1/admin/conversions${suffix}`, {
      method: 'GET',
      token,
    });
  },
};

export const adminCommissionsApi = {
  list: (params: { status?: CommissionStatus; finderId?: string } | undefined, token: string) => {
    const qs = new URLSearchParams();
    if (params?.status) qs.set('status', params.status);
    if (params?.finderId) qs.set('finderId', params.finderId);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return apiFetch<{ commissions: AdminCommissionRow[] }>(`/api/v1/admin/commissions${suffix}`, {
      method: 'GET',
      token,
    });
  },
  lock: (commissionId: string, token: string) =>
    apiFetch<{ commission: AdminCommissionRow }>(
      `/api/v1/admin/commissions/${commissionId}/lock`,
      { method: 'POST', token },
    ),
  reverse: (commissionId: string, reason: string, token: string) =>
    apiFetch<{ reversed: boolean }>(`/api/v1/admin/commissions/${commissionId}/reverse`, {
      method: 'POST',
      token,
      body: JSON.stringify({ reason }),
    }),
};

export const adminAuditApi = {
  list: (params: { page?: number; action?: string } | undefined, token: string) => {
    const qs = new URLSearchParams();
    if (params?.page) qs.set('page', String(params.page));
    if (params?.action) qs.set('action', params.action);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return apiFetch<{
      entries: AuditLogEntry[];
      total: number;
      page: number;
      page_chain_valid: boolean;
    }>(`/api/v1/admin/audit${suffix}`, { method: 'GET', token });
  },
  verifyChain: (token: string) =>
    apiFetch<{ chain_valid: boolean; broken_at: number | null; total: number }>(
      '/api/v1/admin/audit/verify-chain',
      { method: 'GET', token },
    ),
};

// ─────────────────────────────────────────────────────────────────────────────
// Admin payouts API (Phase 06, D-J / D-Q). finders-ready, batch create, CSV
// download, list, mark-paid - all through apiFetch / apiFetchBlob (+ Bearer token).
// ─────────────────────────────────────────────────────────────────────────────

export type FinderCommissionSummary = {
  finderId: string;
  finderName: string;
  cpf: string | null;
  pixKey: string | null;
  pixKeyType: string | null;
  totalBrl: number;
  commissionIds: string[];
  payable: boolean;
  blockedReason: string | null;
};

export type PayoutStatus = 'draft' | 'exported' | 'paid' | 'voided';

export type PayoutRow = {
  id: string;
  finderId: string;
  totalBrl: number;
  status: PayoutStatus;
  csvExportId: string | null;
  exportedAt: string | null;
  paidAt: string | null;
  paidByUserId: string | null;
  note: string | null;
  createdAt: string;
  updatedAt: string | null;
};

export const adminPayoutsApi = {
  findersReady: (token: string) =>
    apiFetch<{ finders: FinderCommissionSummary[] }>('/api/v1/admin/payouts/finders-ready', {
      method: 'GET',
      token,
    }),
  list: (token: string) =>
    apiFetch<{ payouts: PayoutRow[] }>('/api/v1/admin/payouts', { method: 'GET', token }),
  createBatches: (finderIds: string[], token: string) =>
    apiFetch<{ payouts: PayoutRow[] }>('/api/v1/admin/payouts/batches', {
      method: 'POST',
      token,
      body: JSON.stringify({ finderIds }),
    }),
  markPaid: (payoutId: string, token: string) =>
    apiFetch<{ payout: PayoutRow }>(`/api/v1/admin/payouts/${payoutId}/mark-paid`, {
      method: 'POST',
      token,
      body: JSON.stringify({}),
    }),
  downloadCsv: (payoutId: string, token: string) =>
    apiFetchBlob(`/api/v1/admin/payouts/batches/${payoutId}/csv`, { method: 'GET', token }),
};
