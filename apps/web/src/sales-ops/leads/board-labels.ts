import type { SalesOpsClient, SalesOpsPerson, SalesOpsProduct, SalesOpsStatus } from '../types';
import type { SalesOpsLead } from './types';

/**
 * Every identifier-to-label resolution the board performs, in one pure module,
 * so no component ever holds a raw id for display (CLAUDE.md, "UI Identifiers").
 * React-free.
 *
 * The resolution ladder is the same shape everywhere: the live cadastro row
 * first, then the server's own snapshot, then fixed pt-BR copy. An id that
 * resolves to nothing NEVER falls through to itself, which is the one failure
 * mode this module exists to make impossible.
 */

export type LabelLookups = {
  clientNameById: ReadonlyMap<string, string>;
  personNameById: ReadonlyMap<string, string>;
  productNameById: ReadonlyMap<string, string>;
};

export function buildLabelLookups(input: {
  clients: readonly SalesOpsClient[];
  people: readonly SalesOpsPerson[];
  products: readonly SalesOpsProduct[];
}): LabelLookups {
  return {
    clientNameById: new Map(input.clients.map((row) => [row.id, row.name])),
    personNameById: new Map(input.people.map((row) => [row.id, row.displayName])),
    productNameById: new Map(input.products.map((row) => [row.id, row.name])),
  };
}

/** Trimmed, or `undefined` when there is nothing to render. */
function present(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * The cadastro client's name, else the free-text snapshot the API always writes,
 * else `Sem empresa`. A `clientId` the cache does not know degrades to the free
 * text - never to the id.
 */
export function leadCompanyLabel(lead: SalesOpsLead, lookups: LabelLookups): string {
  const resolved = lead.clientId ? lookups.clientNameById.get(lead.clientId) : undefined;
  return present(resolved) ?? present(lead.clientNameSnapshot) ?? 'Sem empresa';
}

/** The pessoa's display name, else the server's snapshot, else `Sem vendedor`. Never an id. */
export function leadSellerLabel(lead: SalesOpsLead, lookups: LabelLookups): string {
  const resolved = lead.sellerPersonId
    ? lookups.personNameById.get(lead.sellerPersonId)
    : undefined;
  return present(resolved) ?? present(lead.sellerNameSnapshot) ?? 'Sem vendedor';
}

/**
 * One label per lead product: the catalog name when `productId` resolves,
 * otherwise the row's own snapshot - which is the whole point of the
 * snapshot-plus-null-id convention a free item is written with.
 *
 * Never an id, and never an empty string.
 */
export function leadProductLabels(lead: SalesOpsLead, lookups: LabelLookups): string[] {
  return lead.products.map((row) => {
    const resolved = row.productId ? lookups.productNameById.get(row.productId) : undefined;
    return present(resolved) ?? present(row.productNameSnapshot) ?? 'Produto sem nome';
  });
}

/**
 * pt-BR labels for the sale status a CONVERTED card mirrors. The card renders
 * this and no control of any kind: the proposta's own screen owns every
 * transition.
 */
export const SALE_STATUS_LABEL: Record<SalesOpsStatus, string> = {
  draft: 'Rascunho',
  open: 'Aberta',
  won: 'Ganha',
  lost: 'Perdida',
  cancelled: 'Cancelada',
};
