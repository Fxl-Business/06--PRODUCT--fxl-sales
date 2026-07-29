import { apiFetch } from '@/lib/api-client';
import type {
  CreateSalePayload,
  SalesOpsArea,
  SalesOpsBootstrap,
  SalesOpsClient,
  SalesOpsPerson,
  SalesOpsProduct,
  SalesOpsSettings,
} from './types';

type Token = string;

export type SavePersonPayload = Omit<
  Partial<SalesOpsPerson>,
  'id' | 'orgId' | 'createdAt' | 'updatedAt'
> & { id?: string; displayName: string };

export type SaveProductPayload = Omit<
  Partial<SalesOpsProduct>,
  | 'id'
  | 'orgId'
  | 'createdAt'
  | 'updatedAt'
  | 'sellerCommissionValue'
  | 'sellerWithFinderCommissionValue'
  | 'finderCommissionValue'
> & {
  id?: string;
  name: string;
  sellerCommissionValue?: number;
  sellerWithFinderCommissionValue?: number;
  finderCommissionValue?: number;
};

export type SaveClientPayload = Omit<
  Partial<SalesOpsClient>,
  'id' | 'orgId' | 'createdAt' | 'updatedAt'
> & { id?: string; name: string };

export type SaveAreaPayload = Omit<
  Partial<SalesOpsArea>,
  'id' | 'orgId' | 'createdAt' | 'updatedAt'
> & { id?: string; name: string };

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
};
