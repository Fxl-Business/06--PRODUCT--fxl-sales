import { apiFetch } from '@/lib/api-client';
import {
  LEADS_PAGE_SIZE,
  type LeadResponse,
  type LeadStageResponse,
  type LeadStageStatus,
  type LeadStagesReorderResponse,
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
 * with `PATCH {status:'archived'}`, and a lead that goes nowhere ends in the
 * terminal `lost` stage.
 */

type Token = string;

export const LEADS_PATH = '/api/v1/sales-ops/leads';
export const LEAD_STAGES_PATH = '/api/v1/sales-ops/lead-stages';

/**
 * RECONCILED against the shipped `LeadProductSchema`: the wire takes
 * `{productId?, productName?}` on WRITE (at least one of the two), while it
 * READS back `{productId, productNameSnapshot}`. The write shape is the one
 * modelled here, because this is the write payload.
 */
export type SaveLeadProductPayload = { productId?: string; productName?: string };

/**
 * RECONCILED against the shipped `CreateLeadSchema` / `UpdateLeadSchema`, which
 * are both `.strict()`:
 *  - there is NO `stageId`: a new lead always lands in the first active
 *    `kind = 'normal'` stage by position, so a card born converted or lost is not
 *    expressible rather than merely rejected;
 *  - the empresa field is `clientName` (free text, REQUIRED, min 1) and not the
 *    plan's `companyName`. It maps to the NOT NULL `client_name_snapshot`, and it
 *    loses to the cadastro row whenever `clientId` resolves.
 */
export type SaveLeadPayload = {
  id?: string;
  contactName: string;
  clientId?: string | null;
  clientName: string;
  estimatedValueBrl?: number;
  description?: string | null;
  sellerPersonId?: string | null;
  products?: SaveLeadProductPayload[];
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

  saveLead: ({ id, ...body }: SaveLeadPayload, token: Token) =>
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
