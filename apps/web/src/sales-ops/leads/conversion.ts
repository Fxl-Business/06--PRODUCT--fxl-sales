import { FUNCAO_SLUG_VENDEDOR, hasFuncao, productBaseValueBrl } from '../calculations';
import type { SalesOpsClient, SalesOpsPerson, SalesOpsProduct } from '../types';
import type { SalesOpsLead } from './types';

/**
 * The PURE half of the lead -> proposta conversion. No React, no fetch, no
 * formatting: it turns a lead plus the sales-ops snapshot into seed values the
 * proposta wizard can widen, and it answers the cliente-by-name question.
 *
 * Money crosses this boundary as integer CENTS and never as an input string,
 * because `centsToInput` and `parseCurrencyToCents` are module-private to
 * `SalesOpsApp.tsx` and reaching in for a formatting detail would widen that
 * file's public surface permanently.
 *
 * Every value it produces is a DEFAULT the operator may overwrite, exactly like
 * a produto's commission default. Nothing here is locked, and nothing here
 * relaxes a wizard gate: the wizard judges this seed with precisely the rules it
 * already had, which is the whole of the ghost-card guarantee.
 */

/**
 * A wizard seed item expressed in terms the wizard does not own. The two members
 * mirror `SaleItemForm`'s own discriminator without importing it, so this module
 * stays free of the wizard's private types and the widening happens at the one
 * call site that knows both.
 */
export type LeadConversionItem =
  | { kind: 'product'; productId: string; unitCents: number }
  | { kind: 'free'; customLabel: string; unitCents: number };

export type LeadConversionPrefill = {
  /**
   * Wizard session identity. It feeds `SaleWizardDialogBody`'s remount `key`, so
   * converting lead A, cancelling, then converting lead B re-seeds instead of
   * showing A's values.
   */
  leadId: string;
  clientId: string;
  clientName: string;
  sellerPersonId: string;
  notes: string;
  /** EMPTY means "no opinion": the wizard then takes its ordinary create-path seed. */
  items: LeadConversionItem[];
};

/** The slice of the sales-ops snapshot a conversion reads, and nothing more. */
export type LeadConversionSnapshot = {
  clients: readonly SalesOpsClient[];
  people: readonly SalesOpsPerson[];
  products: readonly SalesOpsProduct[];
};

/**
 * Accent, case and whitespace folding. `\p{Diacritic}` with the `u` flag is
 * ES2018 and well inside this repo's target.
 */
function normalizeName(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/**
 * The id of the first cliente whose name folds to the same string, in array
 * order, or `null`.
 *
 * Accent folding is deliberate: `Construtora Ipe` and `Construtora Ipê` are one
 * company, and creating the second is exactly the duplicate this function exists
 * to prevent.
 *
 * `sales_ops_clients` has NO unique index on `(org_id, name)` - only the
 * non-unique `sales_ops_clients_org_id_idx` - so this is a BEST-EFFORT dedupe
 * against a possibly stale snapshot and `ON CONFLICT` is not available to make it
 * race-free. Two operators converting the same empresa concurrently still create
 * two clientes; each proposta correctly points at one of them, nothing is lost,
 * and `cadastros/clientes` can merge them. Filed in `nexo/ROADMAP.md`.
 */
export function findClientByName(
  clients: readonly Pick<SalesOpsClient, 'id' | 'name'>[],
  name: string,
): string | null {
  const wanted = normalizeName(name);
  if (wanted === '') return null;
  return clients.find((client) => normalizeName(client.name) === wanted)?.id ?? null;
}

/**
 * Turns one lead into the wizard's seed values.
 *
 * The vendedor rule is the one worth reading twice: the lead's `sellerPersonId`
 * survives ONLY when that pessoa is in the snapshot, is `active`, and carries the
 * `vendedor` system função. Otherwise the field is left BLANK and is deliberately
 * NOT defaulted to the wizard's `firstSeller`. Attributing a real proposta - and
 * every commission derived from it - to whoever sorts first is the same class of
 * bug as the deleted `allocatablePeople[0]` professional seed. `''` is not a dead
 * end either: `canSave` requires a vendedor, so the wizard simply refuses to
 * advance until the operator picks one. An inactive or de-funcionado vendedor
 * must cost one click, never one silent misattribution.
 */
export function buildLeadConversionPrefill(
  lead: SalesOpsLead,
  snapshot: LeadConversionSnapshot,
): LeadConversionPrefill {
  const client = lead.clientId
    ? (snapshot.clients.find((row) => row.id === lead.clientId) ?? null)
    : null;

  const seller = lead.sellerPersonId
    ? (snapshot.people.find((row) => row.id === lead.sellerPersonId) ?? null)
    : null;
  const sellerIsSeedable =
    seller !== null && seller.status === 'active' && hasFuncao(seller, FUNCAO_SLUG_VENDEDOR);

  const items: LeadConversionItem[] = lead.products.map((row) => {
    const product = row.productId
      ? (snapshot.products.find((candidate) => candidate.id === row.productId) ?? null)
      : null;
    // A stale id is DOWNGRADED to free text rather than dropped: the operator's
    // words survive, and a free row then requires an área they must pick.
    if (!product) {
      return { kind: 'free', customLabel: row.productNameSnapshot, unitCents: 0 };
    }
    // `productBaseValueBrl` is the one place a catalog own value is read, so a
    // Serviço with no base value seeds 0 - which the wizard's own
    // `needsNegotiatedValue` gate then refuses to save.
    return { kind: 'product', productId: product.id, unitCents: productBaseValueBrl(product) };
  });

  /*
    The estimate is a GUESS an operator typed on a card; a catalog price is a
    number the cadastro asserts. So the estimate is written onto row 0 only when
    the catalog said nothing at all - every row free text, or every produto a
    Serviço with no base value - because then it is the only number anyone has and
    it beats zero. When the catalog does speak, overwriting it with one lump sum
    would destroy the per-item prices to make a total agree. It is NEVER split
    across rows: no defensible split exists, and `splitCentsByWeights` is a
    payment primitive, not a pricing one.
  */
  const first = items[0];
  if (first && lead.estimatedValueBrl > 0 && items.every((item) => item.unitCents === 0)) {
    items[0] = { ...first, unitCents: lead.estimatedValueBrl };
  }

  return {
    leadId: lead.id,
    // A `clientId` that does not resolve in the snapshot keeps the ID AND falls
    // back to the name snapshot: the wizard's cliente Combobox renders exactly
    // that through `valueLabel`, which is what it already does for a name typed
    // into its create row.
    clientId: lead.clientId ?? '',
    clientName: client?.name ?? lead.clientNameSnapshot,
    sellerPersonId: sellerIsSeedable ? seller.id : '',
    // Verbatim, whitespace included: `notes` is free text and trimming it would
    // silently edit the operator's own words.
    notes: lead.description ?? '',
    items,
  };
}
