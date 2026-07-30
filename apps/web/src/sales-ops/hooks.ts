import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAccessToken } from '@/auth/react';
import { useAppMutation } from '@/lib/app-mutation';
import { queryKeys } from '@/lib/query-keys';
import {
  salesOpsApi,
  type SaveAreaPayload,
  type SaveClientPayload,
  type SaveFuncaoPayload,
  type SavePersonPayload,
  type SaveProductPayload,
  type SaveSettingsPayload,
  type TransitionSalePayload,
} from './api';
import {
  optimisticArea,
  optimisticClient,
  optimisticPerson,
  reconcileOptimisticRow,
  type CollectionRow,
  type OptimisticCollection,
  type OptimisticPatch,
} from './optimistic';
import type {
  CreateSalePayload,
  SalesOpsArea,
  SalesOpsBootstrap,
  SalesOpsClient,
  SalesOpsPerson,
} from './types';

async function requireToken(getToken: () => Promise<string | null>): Promise<string> {
  return (await getToken()) ?? '';
}

/**
 * Hoisted so its identity is stable across renders. An inline `select` arrow
 * defeats TanStack's per-selector memo and hands every render a brand new
 * SalesOpsBootstrap object, which in turn recomputes every downstream useMemo.
 */
function selectSalesOpsBootstrap(data: SalesOpsBootstrap): SalesOpsBootstrap {
  return {
    sales: Array.isArray(data.sales) ? data.sales : [],
    products: Array.isArray(data.products) ? data.products : [],
    clients: Array.isArray(data.clients) ? data.clients : [],
    areas: Array.isArray(data.areas) ? data.areas : [],
    funcoes: Array.isArray(data.funcoes) ? data.funcoes : [],
    people: Array.isArray(data.people) ? data.people : [],
    payables: Array.isArray(data.payables) ? data.payables : [],
    saleItems: Array.isArray(data.saleItems) ? data.saleItems : [],
    receivables: Array.isArray(data.receivables) ? data.receivables : [],
    saleProfessionals: Array.isArray(data.saleProfessionals) ? data.saleProfessionals : [],
    settings: data.settings ?? null,
  };
}

export function useSalesOpsBootstrap() {
  const { getToken } = useAccessToken();
  return useQuery({
    queryKey: queryKeys.salesOps.bootstrap(),
    queryFn: async () => salesOpsApi.bootstrap(await requireToken(getToken)),
    select: selectSalesOpsBootstrap,
  });
}

/**
 * Shared optimistic plumbing for the three cadastros whose row the client can
 * compute in full. The patch is written into the raw cache entry (`select` runs on
 * top of it), rolled back from `previous` on failure, and reconciled with the row
 * the server returned on success so the real id lands before the refetch arrives.
 */
function useOptimisticBootstrapWrite<
  K extends OptimisticCollection,
  TPayload,
  TResponse,
>(
  collection: K,
  build: (previous: SalesOpsBootstrap, payload: TPayload) => OptimisticPatch,
  label: (row: CollectionRow<K>) => string,
  persistedRow: (response: TResponse) => CollectionRow<K>,
) {
  const queryClient = useQueryClient();
  return {
    onMutate: async (payload: TPayload): Promise<OptimisticPatch | undefined> => {
      // Mirrors the house pattern in admin/products/useProducts.ts: an in-flight
      // snapshot fetch must not land on top of the optimistic write.
      await queryClient.cancelQueries({ queryKey: queryKeys.salesOps.all });
      const previous = queryClient.getQueryData<SalesOpsBootstrap>(
        queryKeys.salesOps.bootstrap(),
      );
      if (!previous) return undefined;
      const patch = build(previous, payload);
      queryClient.setQueryData(queryKeys.salesOps.bootstrap(), patch.next);
      return patch;
    },
    onError: (_error: Error, _payload: TPayload, patch: OptimisticPatch | undefined) => {
      if (!patch) return;
      queryClient.setQueryData(queryKeys.salesOps.bootstrap(), patch.previous);
    },
    onSuccess: (
      response: TResponse,
      _payload: TPayload,
      patch: OptimisticPatch | undefined,
    ) => {
      if (!patch) return;
      const current = queryClient.getQueryData<SalesOpsBootstrap>(
        queryKeys.salesOps.bootstrap(),
      );
      if (!current) return;
      queryClient.setQueryData(
        queryKeys.salesOps.bootstrap(),
        reconcileOptimisticRow(current, collection, patch.rowId, persistedRow(response), label),
      );
    },
  };
}

export function useSaveSalesOpsPerson() {
  const { getToken } = useAccessToken();
  const optimistic = useOptimisticBootstrapWrite<
    'people',
    SavePersonPayload,
    { person: SalesOpsPerson }
  >('people', optimisticPerson, (row) => row.displayName, (response) => response.person);
  return useAppMutation<
    { person: SalesOpsPerson },
    Error,
    SavePersonPayload,
    OptimisticPatch | undefined
  >({
    mutationFn: async (payload) => salesOpsApi.savePerson(payload, await requireToken(getToken)),
    invalidates: [queryKeys.salesOps.all],
    ...optimistic,
  });
}

export function useSaveSalesOpsProduct() {
  const { getToken } = useAccessToken();
  // No optimistic write: `type` is dropped from the payload (see api.ts
  // SaveProductPayload) and the three commission values come back re-serialised by
  // Postgres `numeric`, so the client cannot build the persisted row.
  return useAppMutation({
    mutationFn: async (payload: SaveProductPayload) =>
      salesOpsApi.saveProduct(payload, await requireToken(getToken)),
    invalidates: [queryKeys.salesOps.all],
  });
}

export function useSaveSalesOpsClient() {
  const { getToken } = useAccessToken();
  const optimistic = useOptimisticBootstrapWrite<
    'clients',
    SaveClientPayload,
    { client: SalesOpsClient }
  >('clients', optimisticClient, (row) => row.name, (response) => response.client);
  return useAppMutation<
    { client: SalesOpsClient },
    Error,
    SaveClientPayload,
    OptimisticPatch | undefined
  >({
    mutationFn: async (payload) => salesOpsApi.saveClient(payload, await requireToken(getToken)),
    invalidates: [queryKeys.salesOps.all],
    ...optimistic,
  });
}

export function useSaveSalesOpsArea() {
  const { getToken } = useAccessToken();
  const optimistic = useOptimisticBootstrapWrite<'areas', SaveAreaPayload, { area: SalesOpsArea }>(
    'areas',
    optimisticArea,
    (row) => row.name,
    (response) => response.area,
  );
  return useAppMutation<{ area: SalesOpsArea }, Error, SaveAreaPayload, OptimisticPatch | undefined>(
    {
      mutationFn: async (payload) => salesOpsApi.saveArea(payload, await requireToken(getToken)),
      invalidates: [queryKeys.salesOps.all],
      ...optimistic,
    },
  );
}

export function useSaveSalesOpsFuncao() {
  const { getToken } = useAccessToken();
  // No optimistic write: the server derives `slug` from `name`, so the client cannot
  // build the persisted row.
  return useAppMutation({
    mutationFn: async (payload: SaveFuncaoPayload) =>
      salesOpsApi.saveFuncao(payload, await requireToken(getToken)),
    invalidates: [queryKeys.salesOps.all],
  });
}

export function useCreateSalesOpsSale() {
  const { getToken } = useAccessToken();
  // No optimistic write: the server materialises receivables and payables with the
  // "N/M" / "MN/M" label conventions plus code, sequence and every derived
  // commission, tax and margin value, none of which the client can compute.
  return useAppMutation({
    mutationFn: async (payload: CreateSalePayload) =>
      salesOpsApi.createSale(payload, await requireToken(getToken)),
    invalidates: [queryKeys.salesOps.all],
  });
}

export function useUpdateSalesOpsSale() {
  const { getToken } = useAccessToken();
  // No optimistic write: same server-derived ledger as useCreateSalesOpsSale.
  return useAppMutation({
    mutationFn: async ({ saleId, payload }: { saleId: string; payload: CreateSalePayload }) =>
      salesOpsApi.updateSale(saleId, payload, await requireToken(getToken)),
    invalidates: [queryKeys.salesOps.all],
  });
}

export function useTransitionSalesOpsSale() {
  const { getToken } = useAccessToken();
  // No optimistic write: a transition materialises or voids payables and
  // receivables server-side, so the client cannot predict the resulting rows.
  return useAppMutation({
    mutationFn: async (payload: TransitionSalePayload) =>
      salesOpsApi.transitionSale(payload, await requireToken(getToken)),
    invalidates: [queryKeys.salesOps.all],
  });
}

export function useCancelSalesOpsContract() {
  const { getToken } = useAccessToken();
  // No optimistic write: mid-contract cancellation voids open ledger rows
  // server-side and leaves paid rows untouched.
  return useAppMutation({
    mutationFn: async (saleId: string) =>
      salesOpsApi.cancelContract(saleId, await requireToken(getToken)),
    invalidates: [queryKeys.salesOps.all],
  });
}

export function useSaveSalesOpsSettings() {
  const { getToken } = useAccessToken();
  // No optimistic write: the default percentages come back re-serialised by
  // Postgres `numeric`, and SettingsView remounts on the persisted `updatedAt`.
  return useAppMutation({
    mutationFn: async (payload: SaveSettingsPayload) =>
      salesOpsApi.saveSettings(payload, await requireToken(getToken)),
    invalidates: [queryKeys.salesOps.all],
  });
}
