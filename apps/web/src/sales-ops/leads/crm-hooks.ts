import { useQuery } from '@tanstack/react-query';
import { useAccessToken } from '@/auth/react';
import { useAppMutation } from '@/lib/app-mutation';
import { queryKeys } from '@/lib/query-keys';
import { requireToken } from '@/lib/require-token';
import { crmApi } from './crm-api';
import type {
  AddLeadFollowupPayload,
  AddLeadNotePayload,
  AdvanceLeadPayload,
  CrmPipeline,
  FieldDefinition,
  FieldDefinitionsResponse,
  LeadSummaryResponse,
  PipelinesResponse,
} from './crm-types';
import type { LeadResponse } from './types';

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

/*
 * The CRM writes. Each refreshes the whole `['leads']` root, so the summary, the
 * board and the follow-ups list re-read the server. No optimistic write: the server
 * owns the next stage, the position and the follow-up rows.
 */
export function useAdvanceLead() {
  const { getToken } = useAccessToken();
  return useAppMutation<LeadResponse, Error, AdvanceLeadPayload>({
    mutationFn: async (payload) => crmApi.advanceLead(payload, await requireToken(getToken)),
    invalidates: [queryKeys.leads.all],
  });
}

export function useAddLeadNote() {
  const { getToken } = useAccessToken();
  return useAppMutation<unknown, Error, AddLeadNotePayload>({
    mutationFn: async (payload) => crmApi.addLeadNote(payload, await requireToken(getToken)),
    invalidates: [queryKeys.leads.all],
  });
}

export function useAddLeadFollowup() {
  const { getToken } = useAccessToken();
  return useAppMutation<unknown, Error, AddLeadFollowupPayload>({
    mutationFn: async (payload) => crmApi.addLeadFollowup(payload, await requireToken(getToken)),
    invalidates: [queryKeys.leads.all],
  });
}

/** The variable is the follow-up id. */
export function useMarkFollowupDone() {
  const { getToken } = useAccessToken();
  return useAppMutation<unknown, Error, string>({
    mutationFn: async (followupId) => crmApi.markFollowupDone(followupId, await requireToken(getToken)),
    invalidates: [queryKeys.leads.all],
  });
}
