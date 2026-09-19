import type { SalesOpsStatus } from '../types';

/**
 * The lead pipeline's WIRE types, reconciled against the shipped slice 03 API
 * (`apps/api/src/domains/sales-ops/leads/`). Where the plan and the shipped API
 * disagreed, the shipped API won; every such point is noted on the field.
 *
 * This file imports NOTHING but `SalesOpsStatus` - the five sale statuses a
 * converted CARD mirrors. Re-declaring them here would be a second door to one
 * fact.
 */

/**
 * Exactly three kinds, and there is no fourth. The column is
 * `kind text NOT NULL DEFAULT 'normal'` with
 * `sales_ops_lead_stages_kind_check` over these three values, plus a partial
 * unique index on `(org_id, kind) WHERE kind <> 'normal'` making the conversion
 * stage and the Perdido stage each at most one per org.
 *
 * There is no `'converted'` kind, because read-only is a property of the CARD
 * and not of the column: a card is read-only exactly when `leadIsConverted(lead)`
 * (`lead.saleId !== null`). The single `kind: 'conversion'` stage is BOTH the
 * door that opens the proposta wizard and the column those cards land in.
 */
export type LeadStageKind = 'normal' | 'conversion' | 'lost';

export type LeadStageStatus = 'active' | 'archived';

/**
 * `GET /api/v1/sales-ops/lead-stages` returns the raw stage row, archived ones
 * included: the board needs an archived stage's name to label a card still
 * sitting in it, and slice 05 filters for its own list.
 *
 * RECONCILED: the shipped row also carries `archivedAt`, which the plan's
 * `LeadStageWire` did not list. It is modelled here because the wire sends it.
 */
export type SalesOpsLeadStage = {
  id: string;
  orgId: string;
  name: string;
  /** Integer, ascending per org. Ties broken by name, exactly as the API orders. */
  position: number;
  kind: LeadStageKind;
  /** Held equal to `kind <> 'normal'` by a CHECK. Guards rename and archive. */
  isSystem: boolean;
  status: LeadStageStatus;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string | null;
};

/**
 * RECONCILED: the shipped `toLeadView` projects `{productId, productNameSnapshot}`
 * and no row id, so the plan's optional `id` is dropped rather than modelled as a
 * field nobody can ever read.
 */
export type SalesOpsLeadProduct = {
  productId: string | null;
  productNameSnapshot: string;
};

export type SalesOpsLead = {
  id: string;
  stageId: string;
  /** Integer, ascending within the stage. Server-owned; the client never sends one. */
  position: number;
  contactName: string;
  /** OPTIONAL link to sales_ops_clients. */
  clientId: string | null;
  /**
   * RECONCILED: the plan called this `companyName: string | null`. The shipped
   * wire field is `clientNameSnapshot` and it is NOT NULL - the API always writes
   * it, from the cadastro row when `clientId` resolves and from the free-text
   * `clientName` otherwise.
   */
  clientNameSnapshot: string;
  /**
   * Integer CENTS, and the name says "estimated" on purpose: this number is a
   * guess an operator typed on a card. It never reaches `computeSaleFinancials`,
   * `getSalesOpsSummary` or the dashboard; only a proposta's own numbers do.
   */
  estimatedValueBrl: number;
  description: string | null;
  sellerPersonId: string | null;
  /** RECONCILED: NOT NULL on the shipped wire (the plan had it nullable). */
  sellerNameSnapshot: string;
  lostReason: string | null;
  /**
   * ISO. Moves ONLY on a stage change, and is byte-unchanged by a reorder inside
   * one column. `daysInCurrentStage` is its only reader.
   */
  stageChangedAt: string;
  /** Non-null once converted. THE read-only discriminator - see `leadIsConverted`. */
  saleId: string | null;
  /** Mirrored from the proposta, read-only, and null whenever `saleId` is null. */
  saleStatus: SalesOpsStatus | null;
  products: SalesOpsLeadProduct[];
  createdAt: string;
  updatedAt: string | null;
};

/**
 * One keyset page. The same `{rows, nextCursor}` shape as
 * `CadastroHistoryResponse`, for the same reason.
 *
 * `total` IS returned by the API and is deliberately not modelled: nothing on the
 * board renders a server-side count, and a field nobody reads goes stale.
 *
 * `nextCursor` stays `string | null` because that is the WIRE shape. `useLeadsBoard`
 * carries its board-wide cursor MAP in this same slot; see the cast there.
 */
export type LeadsPage = { leads: SalesOpsLead[]; nextCursor: string | null };

/** The raw TanStack infinite-query cache entry. */
export type LeadsInfiniteData = { pages: LeadsPage[]; pageParams: unknown[] };

/** What `useLeadsBoard().data` hands a screen, after the hoisted select. */
export type LeadBoardModel = { leads: SalesOpsLead[]; hasMore: boolean };

/**
 * Structurally identical to the alias declared locally in
 * `apps/web/src/lib/query-keys.ts`, and deliberately duplicated: `query-keys.ts`
 * is imported by `admin/`, `finder/` and `lib/` and must not grow an edge into a
 * sales-ops subtree. It mirrors `CommissionFilters`, duplicated the same way.
 */
export type LeadBoardFilters = { sellerPersonId?: string } | undefined;

export type LeadStagesResponse = { stages: SalesOpsLeadStage[] };
export type LeadResponse = { lead: SalesOpsLead };
export type LeadStageResponse = { stage: SalesOpsLeadStage };
export type LeadStagesReorderResponse = { stages: SalesOpsLeadStage[] };

/**
 * How many cards one column asks for per page. Below the API's
 * `LEADS_MAX_LIMIT` (200) and above its `LEADS_DEFAULT_LIMIT` (50).
 */
export const LEADS_PAGE_SIZE = 100;
