/**
 * Sales edition contract.
 *
 * The edition is DERIVED per request from the verified Hub token's
 * `entitlements.modules`; it is never stored and never read from a body.
 * Absent, empty or unknown modules resolve to 'full', which is the product
 * exactly as it was before editions existed. Only the exact module string
 * 'sales.edition.leads' selects the leads edition.
 *
 * Pure: imports nothing, reads no env, no clock, no locale.
 */
export const SALES_EDITION_LEADS_MODULE = 'sales.edition.leads';

export type SalesEdition = 'full' | 'leads';

export type SalesCapability =
  | 'proposals' // propostas, wizard, conversion, settlements, summary/dashboard
  | 'commissions' // comissoes, payouts, legacy commissions routes
  | 'catalog' // produtos, areas, funcoes cadastros
  | 'clients' // clientes cadastro (split from catalog so the leads edition can grant it alone)
  | 'import' // importacao por planilha
  | 'finders' // finder workspace and legacy finder/links routes
  | 'history' // Geral settings + historico de arquivamentos
  | 'leadFullFields'; // produtos on leads (empresa/valor are available to the leads edition too)

export type LeadFieldSet = 'full' | 'contact';

function rejectMutation(): never {
  throw new TypeError('Sales edition capabilities are immutable.');
}

function frozenCapabilitySet(
  capabilities: readonly SalesCapability[],
): ReadonlySet<SalesCapability> {
  const set = new Set<SalesCapability>(capabilities);
  Object.defineProperties(set, {
    add: { value: rejectMutation },
    delete: { value: rejectMutation },
    clear: { value: rejectMutation },
  });
  return Object.freeze(set);
}

const FULL_CAPABILITIES = frozenCapabilitySet([
  'proposals',
  'commissions',
  'catalog',
  'clients',
  'import',
  'finders',
  'history',
  'leadFullFields',
]);

/**
 * The leads edition (Construbom) grants exactly `clients` and `import`: the
 * Clientes cadastro and the spreadsheet importer, nothing else. It deliberately
 * does NOT grant `catalog` (produtos/areas/funcoes stay out of this edition) nor
 * `leadFullFields` (no produtos on a lead); empresa and valor estimado on a lead
 * are carried by the contact lead schema itself, not by a capability.
 */
const LEADS_CAPABILITIES = frozenCapabilitySet(['clients', 'import']);

/** Absent, empty or unknown modules => 'full'. Only the exact module string flips it. */
export function resolveSalesEdition(
  modules: readonly unknown[] | null | undefined,
): SalesEdition {
  if (!Array.isArray(modules)) return 'full';
  return modules.some((module) => module === SALES_EDITION_LEADS_MODULE) ? 'leads' : 'full';
}

/** 'full' => every capability; 'leads' => clients + import only. Frozen sets. */
export function editionCapabilities(edition: SalesEdition): ReadonlySet<SalesCapability> {
  return edition === 'leads' ? LEADS_CAPABILITIES : FULL_CAPABILITIES;
}

export function hasCapability(edition: SalesEdition, capability: SalesCapability): boolean {
  return editionCapabilities(edition).has(capability);
}

/** 'full' for the full edition, 'contact' for the leads edition. */
export function leadFieldSet(edition: SalesEdition): LeadFieldSet {
  return edition === 'leads' ? 'contact' : 'full';
}
