import { useQuery } from '@tanstack/react-query';
import { useAccessToken } from '@/auth/react';
import { queryKeys } from '@/lib/query-keys';
import { requireToken } from '@/lib/require-token';
import { crmApi } from './crm-api';
import type { CrmPipeline, FieldDefinition, PipelinesResponse, FieldDefinitionsResponse } from './crm-types';

/*
 * Only the READ hooks live here for slice 08. The mutation hooks join this file in
 * 09c and 09d. `useMutation` stays banned outside `app-mutation`, so this file reads only.
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
