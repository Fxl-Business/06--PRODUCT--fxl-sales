import { apiFetch } from '@/lib/api-client';
import type {
  CreateSalePayload,
  SalesOpsArea,
  SalesOpsBootstrap,
  SalesOpsClient,
  SalesOpsFuncao,
  SalesOpsPerson,
  SalesOpsProduct,
  SalesOpsSettings,
} from './types';

type Token = string;

export type TransitionSaleStatus = 'open' | 'won' | 'lost' | 'cancelled';
export type TransitionSalePayload = { saleId: string; status: TransitionSaleStatus };

/**
 * Written out rather than derived from `Partial<SalesOpsPerson>`, because a
 * pessoa write sends an id list where the row carries resolved `funcoes`.
 * `funcaoIds` is authoritative server-side and is a full set replacement, so the
 * three deprecated booleans are never sent.
 */
export type SavePersonPayload = {
  id?: string;
  displayName: string;
  contactEmail?: string;
  status?: 'active' | 'inactive';
  funcaoIds: string[];
};

/**
 * Every `numeric(...)` column is a string on read and a number on write, so the
 * four rate fields are `Omit`ted from the read type and re-declared. `valuePct`
 * on a cost row crosses the same boundary, hence the explicit write union rather
 * than a `Partial<SalesOpsProductFuncaoCost>`; it mirrors the API's
 * `ProductFuncaoCostSchema` discriminated union so the units can never be
 * ambiguous (`valuePct` is a percent, `valueBrl` is integer cents).
 */
export type SaveProductPayload = Omit<
  Partial<SalesOpsProduct>,
  | 'id'
  | 'orgId'
  | 'createdAt'
  | 'updatedAt'
  | 'sellerCommissionValue'
  | 'sellerWithFinderCommissionValue'
  | 'finderCommissionValue'
  | 'defaultEntradaPct'
> & {
  id?: string;
  name: string;
  sellerCommissionValue?: number;
  sellerWithFinderCommissionValue?: number;
  finderCommissionValue?: number;
  defaultEntradaPct?: number | null;
  productFuncaoCosts?: Array<
    | { funcaoId: string; mode: 'pct'; valuePct: number }
    | { funcaoId: string; mode: 'fix'; valueBrl: number }
  >;
};

export type SaveClientPayload = Omit<
  Partial<SalesOpsClient>,
  'id' | 'orgId' | 'createdAt' | 'updatedAt'
> & { id?: string; name: string };

export type SaveAreaPayload = Omit<
  Partial<SalesOpsArea>,
  'id' | 'orgId' | 'createdAt' | 'updatedAt'
> & { id?: string; name: string };

/**
 * `slug` and `isSystem` are never sent: the API derives the slug from the name and
 * only a migration may flag a função as one of the two predefined app roles.
 */
export type SaveFuncaoPayload = { id?: string; name: string; status?: 'active' | 'archived' };

/**
 * The four cadastros that carry a status column. `clients` is deliberately absent:
 * `sales_ops_clients` has no status column and `ClientSchema` declares none, so a
 * status key would be stripped by zod and answered 200 with an unchanged row - a
 * silent no-op that reads as success. See the deferral note in
 * `nexo/runs/feature-20260805-cadastro-archive-history/00-OVERVIEW.md`.
 */
export type CadastroResource = 'products' | 'people' | 'funcoes' | 'areas';

/** A pessoa stores `inactive`; every other cadastro stores `archived`. */
export type CadastroStatus = 'active' | 'archived' | 'inactive';

export type SetCadastroStatusPayload = {
  resource: CadastroResource;
  id: string;
  status: CadastroStatus;
};

export type SaveSettingsPayload = Partial<
  Omit<
    SalesOpsSettings,
    | 'orgId'
    | 'createdAt'
    | 'updatedAt'
    | 'defaultSellerCommissionPct'
    | 'defaultFinderCommissionPct'
    | 'defaultTaxPct'
  >
> & {
  defaultSellerCommissionPct?: number;
  defaultFinderCommissionPct?: number;
  defaultTaxPct?: number;
};

export const salesOpsApi = {
  bootstrap: (token: Token) =>
    apiFetch<SalesOpsBootstrap>('/api/v1/sales-ops/bootstrap', { method: 'GET', token }),
  savePerson: (payload: SavePersonPayload, token: Token) => {
    const { id, ...body } = payload;
    return apiFetch<{ person: SalesOpsPerson }>(
      id ? `/api/v1/sales-ops/people/${id}` : '/api/v1/sales-ops/people',
      { method: id ? 'PATCH' : 'POST', token, body: JSON.stringify(body) },
    );
  },
  saveProduct: (payload: SaveProductPayload, token: Token) => {
    const { id, ...body } = payload;
    return apiFetch<{ product: SalesOpsProduct }>(
      id ? `/api/v1/sales-ops/products/${id}` : '/api/v1/sales-ops/products',
      { method: id ? 'PATCH' : 'POST', token, body: JSON.stringify(body) },
    );
  },
  saveClient: (payload: SaveClientPayload, token: Token) => {
    const { id, ...body } = payload;
    return apiFetch<{ client: SalesOpsClient }>(
      id ? `/api/v1/sales-ops/clients/${id}` : '/api/v1/sales-ops/clients',
      { method: id ? 'PATCH' : 'POST', token, body: JSON.stringify(body) },
    );
  },
  saveArea: (payload: SaveAreaPayload, token: Token) => {
    const { id, ...body } = payload;
    return apiFetch<{ area: SalesOpsArea }>(
      id ? `/api/v1/sales-ops/areas/${id}` : '/api/v1/sales-ops/areas',
      { method: id ? 'PATCH' : 'POST', token, body: JSON.stringify(body) },
    );
  },
  saveFuncao: (payload: SaveFuncaoPayload, token: Token) => {
    const { id, ...body } = payload;
    return apiFetch<{ funcao: SalesOpsFuncao }>(
      id ? `/api/v1/sales-ops/funcoes/${id}` : '/api/v1/sales-ops/funcoes',
      { method: id ? 'PATCH' : 'POST', token, body: JSON.stringify(body) },
    );
  },
  /**
   * Archive and restore. Deliberately a status-only PATCH on the endpoint that
   * already exists: `salesOpsRouter` has no DELETE verb and must not gain one, and
   * every one of the four PATCH schemas is `.partial()`, so an omitted key is left
   * untouched server-side. Sending only `status` also means a stale cached name or
   * função set can never be written back as a side effect of archiving.
   */
  setCadastroStatus: ({ resource, id, status }: SetCadastroStatusPayload, token: Token) =>
    apiFetch<unknown>(`/api/v1/sales-ops/${resource}/${id}`, {
      method: 'PATCH',
      token,
      body: JSON.stringify({ status }),
    }),
  createSale: (payload: CreateSalePayload, token: Token) =>
    apiFetch<{ sale: unknown; ledger: unknown }>('/api/v1/sales-ops/sales', {
      method: 'POST',
      token,
      body: JSON.stringify(payload),
    }),
  updateSale: (saleId: string, payload: CreateSalePayload, token: Token) =>
    apiFetch<{ sale: unknown; ledger: unknown }>(`/api/v1/sales-ops/sales/${saleId}`, {
      method: 'PUT',
      token,
      body: JSON.stringify(payload),
    }),
  saveSettings: (payload: SaveSettingsPayload, token: Token) =>
    apiFetch<{ settings: SalesOpsSettings }>('/api/v1/sales-ops/settings', {
      method: 'PUT',
      token,
      body: JSON.stringify(payload),
    }),
  transitionSale: ({ saleId, status }: TransitionSalePayload, token: Token) =>
    apiFetch<{ sale: unknown }>(`/api/v1/sales-ops/sales/${saleId}/transition`, {
      method: 'POST',
      token,
      body: JSON.stringify({ status }),
    }),
  cancelContract: (saleId: string, token: Token) =>
    apiFetch<{ sale: unknown }>(`/api/v1/sales-ops/sales/${saleId}/cancel-contract`, {
      method: 'POST',
      token,
      body: JSON.stringify({}),
    }),
};
