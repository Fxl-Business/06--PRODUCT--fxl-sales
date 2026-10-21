import { apiFetch } from '@/lib/api-client';
import type {
  AddLeadFollowupPayload,
  AddLeadNotePayload,
  AdvanceLeadPayload,
  FieldDefinitionsResponse,
  FollowupsResponse,
  LeadSummaryResponse,
  ListFollowupsParams,
  PipelinesResponse,
} from './crm-types';
import type { LeadResponse } from './types';

type Token = string;

export const PIPELINES_PATH = '/api/v1/sales-ops/pipelines';
export const FIELD_DEFINITIONS_PATH = '/api/v1/sales-ops/field-definitions';
export const FOLLOWUPS_PATH = '/api/v1/sales-ops/followups';
const LEADS = '/api/v1/sales-ops/leads';

/**
 * The phase 2 CRM client. A second object on purpose: `leadsApi` keeps its
 * own contract test untouched. Wire assumptions A1-A3 (followups list shape,
 * advance envelope, body-less writes) are confined to this file and crm-types.ts.
 */
export const crmApi = {
  listPipelines: (token: Token) => apiFetch<PipelinesResponse>(PIPELINES_PATH, { method: 'GET', token }),
  listFieldDefinitions: (token: Token) =>
    apiFetch<FieldDefinitionsResponse>(FIELD_DEFINITIONS_PATH, { method: 'GET', token }),
  getLeadSummary: (leadId: string, token: Token) =>
    apiFetch<LeadSummaryResponse>(`${LEADS}/${leadId}/summary`, { method: 'GET', token }),
  advanceLead: ({ leadId, toStageId, nextStep, dueOn, note, reason }: AdvanceLeadPayload, token: Token) =>
    apiFetch<LeadResponse>(`${LEADS}/${leadId}/advance`, {
      method: 'POST',
      token,
      body: JSON.stringify({
        toStageId,
        ...(nextStep ? { nextStep } : {}),
        ...(dueOn ? { dueOn } : {}),
        ...(note ? { note } : {}),
        ...(reason ? { reason } : {}),
      }),
    }),
  addLeadNote: ({ leadId, body }: AddLeadNotePayload, token: Token) =>
    apiFetch<unknown>(`${LEADS}/${leadId}/notes`, { method: 'POST', token, body: JSON.stringify({ body }) }),
  addLeadFollowup: ({ leadId, nextStep, dueOn, ownerPersonId }: AddLeadFollowupPayload, token: Token) =>
    apiFetch<unknown>(`${LEADS}/${leadId}/followups`, {
      method: 'POST',
      token,
      body: JSON.stringify({ nextStep, dueOn, ...(ownerPersonId ? { ownerPersonId } : {}) }),
    }),
  listFollowups: (params: ListFollowupsParams, token: Token) => {
    const search = new URLSearchParams();
    search.set('scope', params.scope);
    search.set('status', params.status);
    if (params.from) search.set('from', params.from);
    if (params.to) search.set('to', params.to);
    return apiFetch<FollowupsResponse>(`${FOLLOWUPS_PATH}?${search.toString()}`, { method: 'GET', token });
  },
  markFollowupDone: (id: string, token: Token) =>
    apiFetch<unknown>(`${FOLLOWUPS_PATH}/${id}/done`, { method: 'POST', token }),
};
