import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAccessToken } from '@/auth/react';
import {
  salesOpsApi,
  type SaveAreaPayload,
  type SaveClientPayload,
  type SavePersonPayload,
  type SaveProductPayload,
  type SaveSettingsPayload,
  type TransitionSalePayload,
} from './api';
import type { CreateSalePayload, SalesOpsBootstrap } from './types';

export const salesOpsKeys = {
  all: ['sales-ops'] as const,
  bootstrap: () => [...salesOpsKeys.all, 'bootstrap'] as const,
};

async function requireToken(getToken: () => Promise<string | null>): Promise<string> {
  return (await getToken()) ?? '';
}

export function useSalesOpsBootstrap() {
  const { getToken } = useAccessToken();
  return useQuery({
    queryKey: salesOpsKeys.bootstrap(),
    queryFn: async () => salesOpsApi.bootstrap(await requireToken(getToken)),
    select: (data): SalesOpsBootstrap => ({
      sales: Array.isArray(data.sales) ? data.sales : [],
      products: Array.isArray(data.products) ? data.products : [],
      clients: Array.isArray(data.clients) ? data.clients : [],
      areas: Array.isArray(data.areas) ? data.areas : [],
      people: Array.isArray(data.people) ? data.people : [],
      payables: Array.isArray(data.payables) ? data.payables : [],
      saleItems: Array.isArray(data.saleItems) ? data.saleItems : [],
      receivables: Array.isArray(data.receivables) ? data.receivables : [],
      saleProfessionals: Array.isArray(data.saleProfessionals) ? data.saleProfessionals : [],
      settings: data.settings ?? null,
    }),
  });
}

function useInvalidateSalesOps() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: salesOpsKeys.all });
}

export function useSaveSalesOpsPerson() {
  const { getToken } = useAccessToken();
  const invalidate = useInvalidateSalesOps();
  return useMutation({
    mutationFn: async (payload: SavePersonPayload) =>
      salesOpsApi.savePerson(payload, await requireToken(getToken)),
    onSuccess: () => {
      void invalidate();
    },
  });
}

export function useSaveSalesOpsProduct() {
  const { getToken } = useAccessToken();
  const invalidate = useInvalidateSalesOps();
  return useMutation({
    mutationFn: async (payload: SaveProductPayload) =>
      salesOpsApi.saveProduct(payload, await requireToken(getToken)),
    onSuccess: () => {
      void invalidate();
    },
  });
}

export function useSaveSalesOpsClient() {
  const { getToken } = useAccessToken();
  const invalidate = useInvalidateSalesOps();
  return useMutation({
    mutationFn: async (payload: SaveClientPayload) =>
      salesOpsApi.saveClient(payload, await requireToken(getToken)),
    onSuccess: () => {
      void invalidate();
    },
  });
}

export function useSaveSalesOpsArea() {
  const { getToken } = useAccessToken();
  const invalidate = useInvalidateSalesOps();
  return useMutation({
    mutationFn: async (payload: SaveAreaPayload) =>
      salesOpsApi.saveArea(payload, await requireToken(getToken)),
    onSuccess: () => {
      void invalidate();
    },
  });
}

export function useCreateSalesOpsSale() {
  const { getToken } = useAccessToken();
  const invalidate = useInvalidateSalesOps();
  return useMutation({
    mutationFn: async (payload: CreateSalePayload) =>
      salesOpsApi.createSale(payload, await requireToken(getToken)),
    onSuccess: () => {
      void invalidate();
    },
  });
}

export function useUpdateSalesOpsSale() {
  const { getToken } = useAccessToken();
  const invalidate = useInvalidateSalesOps();
  return useMutation({
    mutationFn: async ({ saleId, payload }: { saleId: string; payload: CreateSalePayload }) =>
      salesOpsApi.updateSale(saleId, payload, await requireToken(getToken)),
    onSuccess: () => {
      void invalidate();
    },
  });
}

export function useTransitionSalesOpsSale() {
  const { getToken } = useAccessToken();
  const invalidate = useInvalidateSalesOps();
  return useMutation({
    mutationFn: async (payload: TransitionSalePayload) =>
      salesOpsApi.transitionSale(payload, await requireToken(getToken)),
    onSuccess: () => {
      void invalidate();
    },
  });
}

export function useCancelSalesOpsContract() {
  const { getToken } = useAccessToken();
  const invalidate = useInvalidateSalesOps();
  return useMutation({
    mutationFn: async (saleId: string) =>
      salesOpsApi.cancelContract(saleId, await requireToken(getToken)),
    onSuccess: () => {
      void invalidate();
    },
  });
}

export function useSaveSalesOpsSettings() {
  const { getToken } = useAccessToken();
  const invalidate = useInvalidateSalesOps();
  return useMutation({
    mutationFn: async (payload: SaveSettingsPayload) =>
      salesOpsApi.saveSettings(payload, await requireToken(getToken)),
    onSuccess: () => {
      void invalidate();
    },
  });
}
