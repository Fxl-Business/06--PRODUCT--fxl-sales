import { apiFetch } from '@/lib/api-client';
import {
  LEADS_PAGE_SIZE,
  type LeadBoardFilters,
  type LeadResponse,
  type LeadStageResponse,
  type LeadStageStatus,
  type LeadStagesReorderResponse,
  type LeadStageSummary,
  type LeadStagesResponse,
  type LeadsPage,
} from './types';

/**
 * The lead pipeline's HTTP client. Same style as `salesOpsApi`: every function
 * takes `token` as its LAST argument and hands it straight to `apiFetch`, which
 * calls `assertBearerToken` BEFORE building the request. A blank token therefore
 * throws `AuthTokenUnavailableError` instead of becoming an anonymous request
 * that reads as a server outage (CLAUDE.md, "A missing access token is never
 * defaulted").
 *
 * There is NO DELETE verb here and there must never be one: a stage is archived
 * with `PATCH {status:'archived'}`, a lead that goes nowhere ends in the
 * terminal `lost` stage, and a lead removed by mistake goes to the lixeira
 * through the `POST /leads/:id/delete` ACTION (`deleteLead` below), a soft
 * delete the gestor can restore.
 */

type Token = string;

export const LEADS_PATH = '/api/v1/sales-ops/leads';
export const LEAD_STAGES_PATH = '/api/v1/sales-ops/lead-stages';

export type LeadFieldWriteValue = string | number | null | Array<{ id: string | null; name: string }>;
export type LeadFieldWrite = { fieldId: string; value: LeadFieldWriteValue };
/** THE single lead write body of the phase 2 API (LeadWriteSchema). */
export type LeadWritePayload = {
  id?: string;
  contactName: string;
  /** Absent (not null) when an edit leaves a contact-less lead contact-less: the API keeps the stored value. */
  contactPhone?: string | null;
  contactEmail?: string | null;
  clientId: string | null;
  clientName: string | null;
  estimatedValueBrl: number;
  sellerPersonId?: string | null;
  pipelineId?: string;
  fields: LeadFieldWrite[];
};

/**
 * `toIndex` is the destination index INSIDE the destination column, 0-based, as
 * the operator sees it. The server owns the resulting `position` integers; the
 * client never sends one, because two browsers reordering the same column would
 * otherwise race on an absolute value.
 *
 * `reason` is REQUIRED by the API when the destination stage is `kind: 'lost'`.
 * It is optional on this type because one payload serves every destination;
 * slice 06 gates it in the UI before the request is built, and the API answers
 * `400 validation_error / lost_reason_required` if it ever gets through.
 */
export type MoveLeadPayload = {
  leadId: string;
  toStageId: string;
  toIndex: number;
  reason?: string | null;
  /**
   * REQUIRED by the API iff the destination stage is `kind: 'conversion'`
   * (`400 sale_required_for_conversion` without it), and REFUSED for every other
   * destination (`400 sale_not_allowed`).
   *
   * Its ONLY producer is slice 08's conversion handler, and it produces it only
   * from a `POST /sales` that already answered `201` - which is exactly why the
   * card can move to the conversion column only after the proposta really
   * exists. Nothing else in the app may write it.
   */
  saleId?: string;
};

export type SaveLeadStagePayload = { id?: string; name: string; status?: LeadStageStatus };
export type SetLeadStageStatusPayload = { id: string; status: LeadStageStatus };
export type ReorderLeadStagesPayload = { stageIds: string[] };

export type ListLeadsParams = {
  /**
   * REQUIRED: the shipped `ListLeadsQuerySchema` declares `stageId` as a
   * non-optional uuid, so the list is per COLUMN and a request without one is a
   * `400 validation_error`. The caller is `useLeadsBoard`'s fan-out, which always
   * has a real stage in hand.
   */
  stageId: string;
  cursor?: string | null;
  sellerPersonId?: string;
  limit?: number;
};

/**
 * Built with URLSearchParams and never by hand: the cursor is the opaque literal
 * pair `"<position>:<uuid>"` and must be encoded.
 */
function listLeadsQuery(params: ListLeadsParams): string {
  const search = new URLSearchParams();
  search.set('stageId', params.stageId);
  search.set('limit', String(params.limit ?? LEADS_PAGE_SIZE));
  if (params.cursor) search.set('cursor', params.cursor);
  if (params.sellerPersonId) search.set('sellerPersonId', params.sellerPersonId);
  return search.toString();
}

export const leadsApi = {
  listLeads: (params: ListLeadsParams, token: Token) =>
    apiFetch<LeadsPage>(`${LEADS_PATH}?${listLeadsQuery(params)}`, {
      method: 'GET',
      token,
    }),

  /**
   * The board's per-stage totals over EVERY live lead in scope, loaded or not.
   * `sellerPersonId` rides only when the board filter has one: the API answers
   * 400 to an empty string, exactly as on the list. A seller's scope is applied
   * server-side from the token; the param is an admin narrowing only.
   */
  stageSummary: (filters: LeadBoardFilters, token: Token) => {
    const search = new URLSearchParams();
    if (filters?.sellerPersonId) search.set('sellerPersonId', filters.sellerPersonId);
    const query = search.toString();
    return apiFetch<LeadStageSummary>(`${LEADS_PATH}/summary${query ? `?${query}` : ''}`, {
      method: 'GET',
      token,
    });
  },

  saveLead: ({ id, ...body }: LeadWritePayload, token: Token) =>
    apiFetch<LeadResponse>(id ? `${LEADS_PATH}/${id}` : LEADS_PATH, {
      method: id ? 'PATCH' : 'POST',
      token,
      body: JSON.stringify(body),
    }),

  /**
   * The body is built EXPLICITLY, key by key, and the payload is NEVER spread.
   * The shipped `MoveLeadSchema` is `.strict()`, so a spread that leaked
   * `toStageId`, `toIndex` or `leadId` onto the wire would be a `400` for every
   * move. Both optional keys are CONDITIONAL for the same reason: their schema
   * members are `z.string().optional()`, so an explicit `null` or `undefined` is
   * a shape this repo must not rely on. `reason` is dropped when it is `null`,
   * `undefined` or `''`, which is also what keeps a reason typed and then
   * re-targeted at a non-lost stage off the wire.
   *
   * `leadId` never enters the body; it is the path segment.
   */
  moveLead: ({ leadId, toStageId, toIndex, reason, saleId }: MoveLeadPayload, token: Token) =>
    apiFetch<LeadResponse>(`${LEADS_PATH}/${leadId}/move`, {
      method: 'POST',
      token,
      body: JSON.stringify({
        stageId: toStageId,
        position: toIndex,
        ...(reason ? { reason } : {}),
        ...(saleId ? { saleId } : {}),
      }),
    }),

  listStages: (token: Token) =>
    apiFetch<LeadStagesResponse>(LEAD_STAGES_PATH, { method: 'GET', token }),

  saveStage: ({ id, ...body }: SaveLeadStagePayload, token: Token) =>
    apiFetch<LeadStageResponse>(id ? `${LEAD_STAGES_PATH}/${id}` : LEAD_STAGES_PATH, {
      method: id ? 'PATCH' : 'POST',
      token,
      body: JSON.stringify(body),
    }),

  /**
   * Sends `{status}` and NOTHING else, the same reason `setCadastroStatus` does:
   * a stale cached `name` must never ride back as a side effect of archiving.
   */
  setStageStatus: ({ id, status }: SetLeadStageStatusPayload, token: Token) =>
    apiFetch<LeadStageResponse>(`${LEAD_STAGES_PATH}/${id}`, {
      method: 'PATCH',
      token,
      body: JSON.stringify({ status }),
    }),

  reorderStages: (payload: ReorderLeadStagesPayload, token: Token) =>
    apiFetch<LeadStagesReorderResponse>(`${LEAD_STAGES_PATH}/reorder`, {
      method: 'POST',
      token,
      body: JSON.stringify(payload),
    }),
};

/**
 * Moves one lead to the lixeira: `POST /leads/:id/delete`, no body, `204` on
 * success. A soft delete and an ACTION like `/move`, never the DELETE verb: the
 * row stays, flagged, and the gestor restores it from `Cadastros > Leads
 * excluídos`. Rejects with the `ApiError` of a `404` (absent, out of scope or
 * already deleted) or a `409 lead_already_converted`; `useDeleteLead` decides
 * what each means for the board.
 *
 * Token FIRST, unlike `leadsApi`, because that is the lixeira seam's fixed
 * signature (`SEAM-CONTRACT.md`), shared with `listDeletedLeads` and `restoreLead`.
 */
export function deleteLead(token: Token, id: string): Promise<void> {
  return apiFetch<void>(`${LEADS_PATH}/${id}/delete`, { method: 'POST', token });
}
