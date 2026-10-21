import { useQuery } from '@tanstack/react-query';
import { useAccessToken } from '@/auth/react';
import { queryKeys } from '@/lib/query-keys';
import { requireToken } from '@/lib/require-token';
import { crmApi } from './crm-api';
import type {
  CrmPipeline,
  FieldDefinition,
  FieldDefinitionsResponse,
  LeadSummaryResponse,
  PipelinesResponse,
} from './crm-types';

/*
 * The READ hooks of the CRM layer. The mutation hooks join this file in 09c and 09d
 * through `useAppMutation`: `useMutation` stays banned outside `app-mutation`.
 */

function selectPipelines(data: PipelinesResponse): CrmPipeline[] {
  return Array.isArray(data.pipelines) ? data.pipelines : [];
}

function selectFieldDefinitions(data: FieldDefinitionsResponse): FieldDefinition[] {
  return Array.isArray(data.fields) ? data.fields : [];
}

export function usePipelines() {
  const { getToken } = useAccessToken();
  return useQuery({
    queryKey: queryKeys.leads.pipelines(),
    queryFn: async () => crmApi.listPipelines(await requireToken(getToken)),
    select: selectPipelines,
  });
}

export function useFieldDefinitions() {
  const { getToken } = useAccessToken();
  return useQuery({
    queryKey: queryKeys.leads.fieldDefinitions(),
    queryFn: async () => crmApi.listFieldDefinitions(await requireToken(getToken)),
    select: selectFieldDefinitions,
  });
}

/**
 * The lead summary (`GET /leads/:id/summary`). No `retry` override: a 404 must
 * reach the container at once so it can answer `Lead não encontrado.`.
 */
export function useLeadSummary(leadId: string) {
  const { getToken } = useAccessToken();
  return useQuery({
    queryKey: queryKeys.leads.detail(leadId),
    queryFn: async (): Promise<LeadSummaryResponse> => crmApi.getLeadSummary(leadId, await requireToken(getToken)),
  });
}
