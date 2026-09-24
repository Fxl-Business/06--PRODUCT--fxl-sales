/**
 * The PURE plan builder for the local development seed.
 *
 * DECIDES, does not ACT: no I/O, no `process.env`, no wall clock, and no import
 * of the dev-fake identity package (not even a type) - see `SeedIdentity` below.
 * `node:crypto` is the one Node import this module makes, and it is pure
 * (`createHash` performs no I/O). The two shared-utils subpaths it also imports
 * are pure arithmetic modules with no environment or database dependency of
 * their own, and importing the SAME implementations the server uses for
 * commissions, tax and the professional split is what keeps this seed's money
 * from silently drifting away from what the app would actually persist.
 *
 * `apps/api/scripts/seed-dev.ts` is the WRITER: it performs the dynamic import
 * of the roster, maps it onto `SeedIdentity[]`, calls `buildDevSeedPlan`, and
 * inserts `plan.rows` verbatim. This module never reads a table object, never
 * opens a connection, and never knows what `getDb()` is.
 */

import { createHash } from 'node:crypto';
import { computeSaleFinancials, pctOfCents } from '@fxl-sales/shared-utils/sale-financials';
import { defaultSplitBp, splitCentsByWeights } from '@fxl-sales/shared-utils/professional-split';

// ─────────────────────────────────────────────────────────────────────────────
// Structural input types. Deliberately NOT imported from @fxl-sales/auth-fake:
// this keeps the module testable with literal fixtures and keeps every access
// to the roster package dynamic (slice 05's tracked-file guard enforces that a
// static import never returns). If the roster's real field names ever differ
// from this shape, `seed-dev.ts` adapts its MAPPING; this file never changes to
// chase the roster.
// ─────────────────────────────────────────────────────────────────────────────

export interface SeedIdentity {
  accountId: string;
  /** Every org this identity can ever be active in, including activeWorkspaceId. */
  workspaceIds: string[];
  workspaceRole: 'owner' | 'admin' | 'member';
  productRoles: string[];
  name: string;
  email: string;
}

/** `{ iso, year, month, day }` - the single time anchor. No wall clock anywhere
 *  else in this module. */
export interface SeedCutoff {
  iso: string;
  year: number;
  month: number;
  day: number;
}

/** Pure parse of a `YYYY-MM-DD` string. The caller (seed-dev.ts) validates the
 *  shape and supplies the default; this function trusts its input. */
export function parseSeedCutoff(iso: string): SeedCutoff {
  const [yearRaw, monthRaw, dayRaw] = iso.split('-').map(Number);
  return { iso, year: yearRaw ?? 1970, month: monthRaw ?? 1, day: dayRaw ?? 1 };
}

/** Every org id this seed will ever touch must carry this prefix. The second
 *  rail: even a local database pointed at a restored production dump cannot
 *  have its rows matched and deleted by this seed, because a real org id can
 *  never start with it. */
export const DEV_SEED_ORG_PREFIX = 'org_fake_';

/** Violation LINES, empty when clean - the same decide-do-not-print shape as
 *  `assertLocalDatabase`. */
export function assertFakeOrgIds(orgIds: string[]): string[] {
  return orgIds
    .filter((orgId) => !orgId.startsWith(DEV_SEED_ORG_PREFIX))
    .map(
      (orgId) =>
        `[dev-seed] org id "${orgId}" is not prefixed "${DEV_SEED_ORG_PREFIX}" - refusing to seed or delete it.`,
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Determinism. Every primary key is deterministicUuid(<stable name>), never
// defaultRandom(). SHA-256 of 'fxl-sales-dev-seed:' + name, first 16 bytes,
// version nibble forced to 4, variant bits forced to 10, canonical hyphenation.
// This is what makes "delete then insert" produce byte-identical state.
// ─────────────────────────────────────────────────────────────────────────────
export function deterministicUuid(name: string): string {
  const digest = createHash('sha256').update(`fxl-sales-dev-seed:${name}`).digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure date arithmetic. Month arithmetic clamps to the last valid day of the
// target month and is always an ABSOLUTE offset from the anchor, matching
// `addMonths` in apps/api/src/domains/sales-ops/service.ts and
// `addMonthsToIsoDate` in the web calculations - a January anchor must not
// drift after a clamped February. Re-implemented here rather than imported,
// because service.ts is not a pure module (it pulls in drizzle, zod and the
// whole sales-ops domain) and this file imports nothing that is not pure.
// ─────────────────────────────────────────────────────────────────────────────
function addMonthsIso(iso: string, months: number): string {
  const [yearRaw, monthRaw, dayRaw] = iso.split('-').map(Number);
  const year = yearRaw ?? 1970;
  const month = (monthRaw ?? 1) - 1;
  const day = dayRaw ?? 1;
  const target = new Date(Date.UTC(year, month + months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString().slice(0, 10);
}

function addDaysIso(iso: string, days: number): string {
  const [yearRaw, monthRaw, dayRaw] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(yearRaw ?? 1970, (monthRaw ?? 1) - 1, (dayRaw ?? 1) + days));
  return date.toISOString().slice(0, 10);
}

/** Every timestamp column is `timestamp with time zone`; every date-only value
 *  this module computes is widened to midnight UTC before it is stored. */
function isoDateTime(dateOnly: string): string {
  return `${dateOnly}T00:00:00.000Z`;
}

// ─────────────────────────────────────────────────────────────────────────────
// The funcao rule for an identity-bound pessoa. Mirrors
// getRolesFromHubClaims (workspace owner/admin, or productRoles.has('admin'),
// yields full access) and the fact that a person write is a full-set
// replacement the API refuses empty (funcao_required) - see CLAUDE.md.
// ─────────────────────────────────────────────────────────────────────────────
export function seededFuncaoSlugsFor(identity: SeedIdentity): string[] {
  const isAdminLike =
    identity.workspaceRole === 'owner' ||
    identity.workspaceRole === 'admin' ||
    identity.productRoles.includes('admin');
  if (isAdminLike) return ['vendedor', 'finder'];

  const slugs: string[] = [];
  if (identity.productRoles.includes('seller')) slugs.push('vendedor');
  if (identity.productRoles.includes('finder')) slugs.push('finder');
  return slugs.length > 0 ? slugs : ['vendedor'];
}

// ─────────────────────────────────────────────────────────────────────────────
// Table order. Write order is parents-first; delete order is the reverse-
// dependency order the restrict FKs require. Every SEED_WRITE_ORDER entry
// appears in SEED_DELETE_ORDER - pinned by the pure test.
// ─────────────────────────────────────────────────────────────────────────────
export const SEED_WRITE_ORDER = [
  'salesOpsSettings',
  'salesOpsAreas',
  'salesOpsFuncoes',
  'salesOpsPeople',
  'salesOpsPersonFuncoes',
  'salesOpsClients',
  'salesOpsProducts',
  'salesOpsProductFuncaoCosts',
  'salesOpsLeadStages',
  'salesOpsSales',
  'salesOpsSaleItems',
  'salesOpsSaleProfessionals',
  'salesOpsReceivables',
  'salesOpsPayables',
  'salesOpsLeads',
  'salesOpsLeadProducts',
] as const;

export const SEED_DELETE_ORDER = [
  'salesOpsPayables',
  'salesOpsReceivables',
  'salesOpsSaleProfessionals',
  'salesOpsSaleItems',
  'salesOpsLeadProducts',
  'salesOpsLeads',
  'salesOpsSales',
  'salesOpsLeadStages',
  'salesOpsProductFuncaoCosts',
  'salesOpsProducts',
  'salesOpsPersonFuncoes',
  'salesOpsPeople',
  'salesOpsFuncoes',
  'salesOpsClients',
  'salesOpsAreas',
  'salesOpsSettings',
] as const;

export type TableKey = (typeof SEED_WRITE_ORDER)[number];

// ─────────────────────────────────────────────────────────────────────────────
// Row shapes. Every timestamp is an ISO 8601 STRING, never a Date: that is what
// lets the pure test assert determinism with JSON.stringify and what lets
// "starts with the cutoff's year" be checked with a plain string comparison.
// seed-dev.ts converts to Date at the insert boundary, where the schema wants
// one. Money is always integer cents; percentages are numeric(5,2) STRINGS.
// ─────────────────────────────────────────────────────────────────────────────

export interface SettingsRow {
  orgId: string;
  legalName: string;
  document: string;
  phone: string;
  financeEmail: string;
  defaultSellerCommissionPct: string;
  defaultFinderCommissionPct: string;
  defaultTaxPct: string;
  currency: string;
  taxRegime: string;
  periodClosingDay: number;
  tableDensity: string;
  dateFormat: string;
  language: string;
  commissionOnRecurring: boolean;
  sellerCanBeFinder: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AreaRow {
  id: string;
  orgId: string;
  name: string;
  status: 'active' | 'archived';
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FuncaoRow {
  id: string;
  orgId: string;
  name: string;
  slug: string;
  isSystem: boolean;
  status: 'active' | 'archived';
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PersonRow {
  id: string;
  orgId: string;
  displayName: string;
  contactEmail: string | null;
  hubAccountId: string | null;
  status: 'active' | 'inactive';
  archivedAt: string | null;
  isSeller: boolean;
  isFinder: boolean;
  isCollaborator: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PersonFuncaoRow {
  id: string;
  orgId: string;
  personId: string;
  funcaoId: string;
  createdAt: string;
}

export interface ClientRow {
  id: string;
  orgId: string;
  name: string;
  contact: string | null;
  legalName: string | null;
  document: string | null;
  address: string | null;
  legalRepName: string | null;
  legalRepDocument: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProductRow {
  id: string;
  orgId: string;
  name: string;
  kind: 'product' | 'service';
  codeSuffix: string;
  areaId: string;
  openPrice: boolean;
  setupBrl: number;
  hasMonthly: boolean;
  monthlyBrl: number;
  recurringCommission: boolean;
  hasFinderCommission: boolean;
  sellerCommissionType: 'pct' | 'fix';
  sellerCommissionValue: string;
  sellerWithFinderCommissionType: 'pct' | 'fix';
  sellerWithFinderCommissionValue: string;
  finderCommissionType: 'pct' | 'fix';
  finderCommissionValue: string;
  defaultPaymentMethod: string;
  defaultEntradaMode: 'none' | 'pct' | 'fix';
  defaultEntradaPct: string | null;
  defaultEntradaBrl: number | null;
  defaultRemainingInstallments: number;
  defaultRecurringCycles: number | null;
  modules: string[];
  providers: unknown[];
  status: 'active' | 'archived';
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProductFuncaoCostRow {
  id: string;
  orgId: string;
  productId: string;
  funcaoId: string;
  mode: 'pct' | 'fix';
  valuePct: string | null;
  valueBrl: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface LeadStageRow {
  id: string;
  orgId: string;
  name: string;
  kind: 'normal' | 'conversion' | 'lost';
  isSystem: boolean;
  position: number;
  status: 'active' | 'archived';
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SaleRow {
  id: string;
  orgId: string;
  sequence: number;
  code: string;
  clientId: string;
  clientNameSnapshot: string;
  sellerPersonId: string;
  sellerNameSnapshot: string;
  finderPersonId: string | null;
  finderNameSnapshot: string | null;
  status: 'draft' | 'open' | 'won' | 'lost' | 'cancelled';
  wonAt: string | null;
  lostAt: string | null;
  paymentMethod: 'pix' | 'card' | 'boleto' | 'transfer';
  condition: 'cash' | 'installments' | 'recurring';
  installments: number;
  baseDate: string;
  notes: string | null;
  totalBrl: number;
  recurringBrl: number;
  sellerCommissionPct: string;
  finderCommissionPct: string;
  taxPct: string;
  otherCostsBrl: number;
  professionalCostsBrl: number;
  sellerCommissionBrl: number;
  finderCommissionBrl: number;
  taxBrl: number;
  netMarginBrl: number;
  netMarginPct: string;
  createdAt: string;
  updatedAt: string;
}

export interface SaleItemRow {
  id: string;
  orgId: string;
  saleId: string;
  productId: string;
  productNameSnapshot: string;
  productTypeSnapshot: string;
  areaId: string;
  areaNameSnapshot: string;
  quantity: number;
  unitBrl: number;
  subtotalBrl: number;
}

export interface SaleProfessionalRow {
  id: string;
  orgId: string;
  saleId: string;
  personId: string;
  personNameSnapshot: string;
  funcaoId: string;
  funcaoNameSnapshot: string;
  role: string;
  costBrl: number;
  costSplitBp: number[] | null;
}

export interface ReceivableRow {
  id: string;
  orgId: string;
  saleId: string;
  label: string;
  dueDate: string;
  amountBrl: number;
  method: 'pix' | 'card' | 'boleto' | 'transfer';
  status: 'open' | 'paid' | 'void';
}

export interface PayableRow {
  id: string;
  orgId: string;
  saleId: string;
  beneficiaryName: string;
  kind: 'seller_commission' | 'finder_commission' | 'professional_cost' | 'tax' | 'other_cost';
  receivableId: string | null;
  saleProfessionalId: string | null;
  dueDate: string;
  amountBrl: number;
  status: 'open' | 'paid' | 'void';
}

export interface LeadRow {
  id: string;
  orgId: string;
  contactName: string;
  clientId: string | null;
  clientNameSnapshot: string;
  estimatedValueBrl: number;
  description: string | null;
  sellerPersonId: string | null;
  sellerNameSnapshot: string;
  stageId: string;
  stageChangedAt: string;
  position: number;
  lostReason: string | null;
  saleId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LeadProductRow {
  id: string;
  orgId: string;
  leadId: string;
  productId: string | null;
  productNameSnapshot: string;
  createdAt: string;
}

export interface DevSeedPlan {
  rows: {
    salesOpsSettings: readonly SettingsRow[];
    salesOpsAreas: readonly AreaRow[];
    salesOpsFuncoes: readonly FuncaoRow[];
    salesOpsPeople: readonly PersonRow[];
    salesOpsPersonFuncoes: readonly PersonFuncaoRow[];
    salesOpsClients: readonly ClientRow[];
    salesOpsProducts: readonly ProductRow[];
    salesOpsProductFuncaoCosts: readonly ProductFuncaoCostRow[];
    salesOpsLeadStages: readonly LeadStageRow[];
    salesOpsSales: readonly SaleRow[];
    salesOpsSaleItems: readonly SaleItemRow[];
    salesOpsSaleProfessionals: readonly SaleProfessionalRow[];
    salesOpsReceivables: readonly ReceivableRow[];
    salesOpsPayables: readonly PayableRow[];
    salesOpsLeads: readonly LeadRow[];
    salesOpsLeadProducts: readonly LeadProductRow[];
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Fixed catalog data. Pure module-level constants: same shape in every org.
// ─────────────────────────────────────────────────────────────────────────────

const FUNCAO_DEFS = [
  { slug: 'vendedor', name: 'Vendedor', isSystem: true },
  { slug: 'finder', name: 'Finder', isSystem: true },
  { slug: 'designer', name: 'Designer', isSystem: false },
  { slug: 'desenvolvedor', name: 'Desenvolvedor', isSystem: false },
] as const;

const AREA_DEFS = [
  { slug: 'desenvolvimento', name: 'Desenvolvimento' },
  { slug: 'design', name: 'Design' },
  { slug: 'consultoria', name: 'Consultoria' },
] as const;

const STAGE_DEFS = [
  { slug: 'novo', name: 'Novo', kind: 'normal', isSystem: false, position: 1 },
  { slug: 'em-negociacao', name: 'Em negociação', kind: 'normal', isSystem: false, position: 2 },
  { slug: 'proposta', name: 'Proposta', kind: 'conversion', isSystem: true, position: 3 },
  { slug: 'perdido', name: 'Perdido', kind: 'lost', isSystem: true, position: 4 },
] as const;

const CLIENT_DEFS = [
  { slug: 'construtora-ipe', name: 'Construtora Ipê' },
  { slug: 'aurora-labs', name: 'Aurora Labs' },
  { slug: 'meridiano-log', name: 'Meridiano Log' },
] as const;

const PRODUCT_DEFS = [
  {
    slug: 'plataforma-fxl',
    name: 'Plataforma FXL',
    kind: 'product',
    areaSlug: 'desenvolvimento',
    codeSuffix: '1',
    setupBrl: 2_000_000,
    hasMonthly: true,
    monthlyBrl: 150_000,
    entradaMode: 'pct',
    entradaPct: '30.00',
    entradaBrl: null,
    remainingInstallments: 2,
    recurringCycles: 12,
  },
  {
    slug: 'landing-page',
    name: 'Landing Page',
    kind: 'product',
    areaSlug: 'design',
    codeSuffix: '2',
    setupBrl: 450_000,
    hasMonthly: false,
    monthlyBrl: 0,
    entradaMode: 'none',
    entradaPct: null,
    entradaBrl: null,
    remainingInstallments: 2,
    recurringCycles: null,
  },
  {
    slug: 'consultoria-estrategica',
    name: 'Consultoria Estratégica',
    kind: 'service',
    areaSlug: 'consultoria',
    codeSuffix: '3',
    setupBrl: 800_000,
    hasMonthly: false,
    monthlyBrl: 0,
    entradaMode: 'fix',
    entradaPct: null,
    entradaBrl: 200_000,
    remainingInstallments: 4,
    recurringCycles: null,
  },
  {
    slug: 'suporte-dedicado',
    name: 'Suporte Dedicado',
    kind: 'service',
    areaSlug: 'consultoria',
    codeSuffix: '4',
    setupBrl: 0,
    hasMonthly: true,
    monthlyBrl: 300_000,
    entradaMode: 'none',
    entradaPct: null,
    entradaBrl: null,
    remainingInstallments: 1,
    recurringCycles: null,
  },
] as const;

const PRODUCT_FUNCAO_COST_DEFS = [
  { productSlug: 'plataforma-fxl', funcaoSlug: 'designer', mode: 'pct', valuePct: '5.00', valueBrl: null },
  {
    productSlug: 'plataforma-fxl',
    funcaoSlug: 'desenvolvedor',
    mode: 'fix',
    valuePct: null,
    valueBrl: 400_000,
  },
] as const;

const FIXED_PEOPLE_DEFS = [
  { key: 'marina', name: 'Marina Vendas', email: 'marina.vendas@fake.local', slugs: ['vendedor'] },
  { key: 'caio', name: 'Caio Indica', email: 'caio.indica@fake.local', slugs: ['finder'] },
  {
    key: 'rita',
    name: 'Rita Projeto',
    email: 'rita.projeto@fake.local',
    slugs: ['designer', 'desenvolvedor'],
  },
] as const;

/** A readable label derived from the org id - never a raw org id rendered in
 *  place of one. `org_fake_norte` -> `Norte Ltda`. */
function legalNameForOrg(orgId: string): string {
  const stripped = orgId.startsWith(DEV_SEED_ORG_PREFIX)
    ? orgId.slice(DEV_SEED_ORG_PREFIX.length)
    : orgId;
  const titled = stripped
    .split('_')
    .filter((part) => part.length > 0)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join(' ');
  return `${titled} Ltda`;
}

/** Deprecated mirrors, character for character what `deriveBooleanMirrors`
 *  writes in apps/api/src/domains/sales-ops/service.ts. */
function booleanMirrorsFor(slugs: readonly string[]): {
  isSeller: boolean;
  isFinder: boolean;
  isCollaborator: boolean;
} {
  const systemSlugs = new Set(['vendedor', 'finder']);
  return {
    isSeller: slugs.includes('vendedor'),
    isFinder: slugs.includes('finder'),
    isCollaborator: slugs.some((slug) => !systemSlugs.has(slug)),
  };
}

type PersonSeed = {
  key: string;
  id: string;
  displayName: string;
  contactEmail: string;
  hubAccountId: string | null;
  funcaoSlugs: string[];
  accountId: string | null;
};

type OrgRows = {
  settings: SettingsRow;
  areas: AreaRow[];
  funcoes: FuncaoRow[];
  people: PersonRow[];
  personFuncoes: PersonFuncaoRow[];
  clients: ClientRow[];
  products: ProductRow[];
  productFuncaoCosts: ProductFuncaoCostRow[];
  leadStages: LeadStageRow[];
  sales: SaleRow[];
  saleItems: SaleItemRow[];
  saleProfessionals: SaleProfessionalRow[];
  receivables: ReceivableRow[];
  payables: PayableRow[];
  leads: LeadRow[];
  leadProducts: LeadProductRow[];
};

/** One receivable + finder/seller/tax commission payables, per non-void
 *  receivable row. Character for character what `materializeWonPayables`
 *  computes in apps/api/src/domains/sales-ops/service.ts, given the same
 *  inputs, so a seeded S1 is shaped exactly like a row the API would write. */
function buildCommissionPayables(params: {
  orgId: string;
  saleId: string;
  saleKey: string;
  receivables: readonly ReceivableRow[];
  sellerName: string;
  finderName: string | null;
  sellerPct: number;
  finderPct: number;
  taxPct: number;
  paidReceivableIds: ReadonlySet<string>;
}): PayableRow[] {
  const out: PayableRow[] = [];
  for (const receivable of params.receivables) {
    const paid = params.paidReceivableIds.has(receivable.id);

    const sellerAmountBrl = pctOfCents(receivable.amountBrl, params.sellerPct);
    if (sellerAmountBrl > 0) {
      out.push({
        id: deterministicUuid(
          `${params.orgId}:sale:${params.saleKey}:payable:seller:${receivable.label}`,
        ),
        orgId: params.orgId,
        saleId: params.saleId,
        beneficiaryName: params.sellerName,
        kind: 'seller_commission',
        receivableId: receivable.id,
        saleProfessionalId: null,
        dueDate: receivable.dueDate,
        amountBrl: sellerAmountBrl,
        status: paid ? 'paid' : 'open',
      });
    }

    if (params.finderName) {
      const finderAmountBrl = pctOfCents(receivable.amountBrl, params.finderPct);
      if (finderAmountBrl > 0) {
        out.push({
          id: deterministicUuid(
            `${params.orgId}:sale:${params.saleKey}:payable:finder:${receivable.label}`,
          ),
          orgId: params.orgId,
          saleId: params.saleId,
          beneficiaryName: params.finderName,
          kind: 'finder_commission',
          receivableId: receivable.id,
          saleProfessionalId: null,
          dueDate: receivable.dueDate,
          amountBrl: finderAmountBrl,
          status: paid ? 'paid' : 'open',
        });
      }
    }

    const taxAmountBrl = pctOfCents(receivable.amountBrl, params.taxPct);
    if (taxAmountBrl > 0) {
      out.push({
        id: deterministicUuid(
          `${params.orgId}:sale:${params.saleKey}:payable:tax:${receivable.label}`,
        ),
        orgId: params.orgId,
        saleId: params.saleId,
        beneficiaryName: 'Impostos',
        kind: 'tax',
        receivableId: receivable.id,
        saleProfessionalId: null,
        dueDate: receivable.dueDate,
        amountBrl: taxAmountBrl,
        status: paid ? 'paid' : 'open',
      });
    }
  }
  return out;
}

/** One professional's cost_brl split pro rata across the INSTALLMENT
 *  receivables only, via the same `defaultSplitBp` / `splitCentsByWeights` the
 *  server calls - never the recurring `M`-prefixed rows. */
function buildProfessionalCostPayables(params: {
  orgId: string;
  saleId: string;
  saleKey: string;
  professionalId: string;
  beneficiaryName: string;
  costBrl: number;
  installmentReceivables: readonly ReceivableRow[];
}): PayableRow[] {
  const weights = defaultSplitBp(params.installmentReceivables.map((row) => row.amountBrl));
  const parts = splitCentsByWeights(params.costBrl, weights);
  return parts.map((amountBrl, index) => {
    const receivable = params.installmentReceivables[index]!;
    return {
      id: deterministicUuid(
        `${params.orgId}:sale:${params.saleKey}:payable:professional:${receivable.label}`,
      ),
      orgId: params.orgId,
      saleId: params.saleId,
      beneficiaryName: params.beneficiaryName,
      kind: 'professional_cost',
      receivableId: receivable.id,
      saleProfessionalId: params.professionalId,
      dueDate: receivable.dueDate,
      amountBrl,
      status: 'open',
    };
  });
}

function buildOrgRows(orgId: string, identities: readonly SeedIdentity[], cutoff: SeedCutoff): OrgRows {
  const nowIso = isoDateTime(cutoff.iso);

  // ── Settings (the org "row") ────────────────────────────────────────────
  const settings: SettingsRow = {
    orgId,
    legalName: legalNameForOrg(orgId),
    document: '',
    phone: '',
    financeEmail: '',
    defaultSellerCommissionPct: '5.00',
    defaultFinderCommissionPct: '3.00',
    defaultTaxPct: '12.00',
    currency: 'BRL',
    taxRegime: 'Simples Nacional',
    periodClosingDay: 1,
    tableDensity: 'comfortable',
    dateFormat: 'dd/mm/aaaa',
    language: 'pt-BR',
    commissionOnRecurring: true,
    sellerCanBeFinder: true,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  // ── Areas ────────────────────────────────────────────────────────────────
  const areas: AreaRow[] = AREA_DEFS.map((def) => ({
    id: deterministicUuid(`${orgId}:area:${def.slug}`),
    orgId,
    name: def.name,
    status: 'active',
    archivedAt: null,
    createdAt: nowIso,
    updatedAt: nowIso,
  }));
  const areaIdBySlug = new Map<string, string>(AREA_DEFS.map((def, i) => [def.slug, areas[i]!.id]));
  const areaNameBySlug = new Map<string, string>(AREA_DEFS.map((def) => [def.slug, def.name]));

  // ── Funcoes ──────────────────────────────────────────────────────────────
  const funcoes: FuncaoRow[] = FUNCAO_DEFS.map((def) => ({
    id: deterministicUuid(`${orgId}:funcao:${def.slug}`),
    orgId,
    name: def.name,
    slug: def.slug,
    isSystem: def.isSystem,
    status: 'active',
    archivedAt: null,
    createdAt: nowIso,
    updatedAt: nowIso,
  }));
  const funcaoIdBySlug = new Map<string, string>(FUNCAO_DEFS.map((def, i) => [def.slug, funcoes[i]!.id]));
  const funcaoNameBySlug = new Map<string, string>(FUNCAO_DEFS.map((def) => [def.slug, def.name]));

  // ── People: identity-bound, then the fixed cast ─────────────────────────
  const identityPeople: PersonSeed[] = identities
    .filter((identity) => identity.workspaceIds.includes(orgId))
    .map((identity) => ({
      key: identity.accountId,
      id: deterministicUuid(`${orgId}:person:account:${identity.accountId}`),
      displayName: identity.name,
      contactEmail: identity.email,
      hubAccountId: identity.accountId,
      funcaoSlugs: seededFuncaoSlugsFor(identity),
      accountId: identity.accountId,
    }));

  const fixedPeople: PersonSeed[] = FIXED_PEOPLE_DEFS.map((def) => ({
    key: def.key,
    id: deterministicUuid(`${orgId}:person:fixed:${def.key}`),
    displayName: def.name,
    contactEmail: def.email,
    hubAccountId: null,
    funcaoSlugs: [...def.slugs],
    accountId: null,
  }));

  const allPeople = [...identityPeople, ...fixedPeople];

  const people: PersonRow[] = allPeople.map((seed) => {
    const mirrors = booleanMirrorsFor(seed.funcaoSlugs);
    return {
      id: seed.id,
      orgId,
      displayName: seed.displayName,
      contactEmail: seed.contactEmail,
      hubAccountId: seed.hubAccountId,
      status: 'active',
      archivedAt: null,
      isSeller: mirrors.isSeller,
      isFinder: mirrors.isFinder,
      isCollaborator: mirrors.isCollaborator,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
  });

  const personFuncoes: PersonFuncaoRow[] = allPeople.flatMap((seed) =>
    seed.funcaoSlugs.map((slug) => ({
      id: deterministicUuid(`${orgId}:person-funcao:${seed.key}:${slug}`),
      orgId,
      personId: seed.id,
      funcaoId: funcaoIdBySlug.get(slug)!,
      createdAt: nowIso,
    })),
  );

  const marina = fixedPeople.find((p) => p.key === 'marina')!;
  const caio = fixedPeople.find((p) => p.key === 'caio')!;
  const rita = fixedPeople.find((p) => p.key === 'rita')!;

  // primarySeller(org): the identity-bound pessoa carrying 'vendedor', lowest
  // accountId wins for determinism, falling back to Marina Vendas.
  const vendedorIdentityPeople = identityPeople.filter((p) => p.funcaoSlugs.includes('vendedor'));
  const primarySeller =
    vendedorIdentityPeople.length > 0
      ? [...vendedorIdentityPeople].sort((a, b) =>
          a.accountId! < b.accountId! ? -1 : a.accountId! > b.accountId! ? 1 : 0,
        )[0]!
      : marina;

  // ── Clients ──────────────────────────────────────────────────────────────
  const clients: ClientRow[] = CLIENT_DEFS.map((def) => ({
    id: deterministicUuid(`${orgId}:client:${def.slug}`),
    orgId,
    name: def.name,
    contact: null,
    legalName: null,
    document: null,
    address: null,
    legalRepName: null,
    legalRepDocument: null,
    createdAt: nowIso,
    updatedAt: nowIso,
  }));
  const clientIdBySlug = new Map<string, string>(CLIENT_DEFS.map((def, i) => [def.slug, clients[i]!.id]));

  // ── Products ─────────────────────────────────────────────────────────────
  const products: ProductRow[] = PRODUCT_DEFS.map((def) => ({
    id: deterministicUuid(`${orgId}:product:${def.slug}`),
    orgId,
    name: def.name,
    kind: def.kind,
    codeSuffix: def.codeSuffix,
    areaId: areaIdBySlug.get(def.areaSlug)!,
    openPrice: def.kind === 'service',
    setupBrl: def.setupBrl,
    hasMonthly: def.hasMonthly,
    monthlyBrl: def.monthlyBrl,
    recurringCommission: false,
    hasFinderCommission: false,
    sellerCommissionType: 'pct',
    sellerCommissionValue: '5.00',
    sellerWithFinderCommissionType: 'pct',
    sellerWithFinderCommissionValue: '3.00',
    finderCommissionType: 'pct',
    finderCommissionValue: '3.00',
    defaultPaymentMethod: 'pix',
    defaultEntradaMode: def.entradaMode,
    defaultEntradaPct: def.entradaPct,
    defaultEntradaBrl: def.entradaBrl,
    defaultRemainingInstallments: def.remainingInstallments,
    defaultRecurringCycles: def.recurringCycles,
    modules: [],
    providers: [],
    status: 'active',
    archivedAt: null,
    createdAt: nowIso,
    updatedAt: nowIso,
  }));
  const productIdBySlug = new Map<string, string>(PRODUCT_DEFS.map((def, i) => [def.slug, products[i]!.id]));

  const productFuncaoCosts: ProductFuncaoCostRow[] = PRODUCT_FUNCAO_COST_DEFS.map((def) => ({
    id: deterministicUuid(`${orgId}:product-funcao-cost:${def.productSlug}:${def.funcaoSlug}`),
    orgId,
    productId: productIdBySlug.get(def.productSlug)!,
    funcaoId: funcaoIdBySlug.get(def.funcaoSlug)!,
    mode: def.mode,
    valuePct: def.valuePct,
    valueBrl: def.valueBrl,
    createdAt: nowIso,
    updatedAt: nowIso,
  }));

  // ── Lead etapas ──────────────────────────────────────────────────────────
  const leadStages: LeadStageRow[] = STAGE_DEFS.map((def) => ({
    id: deterministicUuid(`${orgId}:stage:${def.slug}`),
    orgId,
    name: def.name,
    kind: def.kind,
    isSystem: def.isSystem,
    position: def.position,
    status: 'active',
    archivedAt: null,
    createdAt: nowIso,
    updatedAt: nowIso,
  }));
  const stageIdBySlug = new Map<string, string>(STAGE_DEFS.map((def, i) => [def.slug, leadStages[i]!.id]));

  // ── Propostas (S1..S4) ───────────────────────────────────────────────────
  const sales: SaleRow[] = [];
  const saleItems: SaleItemRow[] = [];
  const saleProfessionals: SaleProfessionalRow[] = [];
  const receivables: ReceivableRow[] = [];
  const payables: PayableRow[] = [];

  const saleIdS1 = deterministicUuid(`${orgId}:sale:1:id`);
  const saleIdS2 = deterministicUuid(`${orgId}:sale:2:id`);
  const saleIdS3 = deterministicUuid(`${orgId}:sale:3:id`);
  const saleIdS4 = deterministicUuid(`${orgId}:sale:4:id`);

  // ── S1: won, Plataforma FXL, recorrencia + won-only payables ────────────
  {
    const productId = productIdBySlug.get('plataforma-fxl')!;
    const itemsTotalBrl = 2_000_000;
    const monthlyBrl = 150_000;
    const cycles = 12;
    const boundedRecurringBrl = monthlyBrl * cycles;

    const installmentReceivables: ReceivableRow[] = [
      {
        id: deterministicUuid(`${orgId}:sale:1:receivable:1`),
        orgId,
        saleId: saleIdS1,
        label: '1/3',
        dueDate: isoDateTime(cutoff.iso),
        amountBrl: 600_000,
        method: 'pix',
        status: 'paid',
      },
      {
        id: deterministicUuid(`${orgId}:sale:1:receivable:2`),
        orgId,
        saleId: saleIdS1,
        label: '2/3',
        dueDate: isoDateTime(addMonthsIso(cutoff.iso, 1)),
        amountBrl: 700_000,
        method: 'pix',
        status: 'open',
      },
      {
        id: deterministicUuid(`${orgId}:sale:1:receivable:3`),
        orgId,
        saleId: saleIdS1,
        label: '3/3',
        dueDate: isoDateTime(addMonthsIso(cutoff.iso, 2)),
        amountBrl: 700_000,
        method: 'pix',
        status: 'open',
      },
    ];
    const recurringReceivables: ReceivableRow[] = Array.from({ length: cycles }, (_, i) => ({
      id: deterministicUuid(`${orgId}:sale:1:receivable:M${i + 1}`),
      orgId,
      saleId: saleIdS1,
      label: `M${i + 1}/${cycles}`,
      dueDate: isoDateTime(addMonthsIso(cutoff.iso, i + 1)),
      amountBrl: monthlyBrl,
      method: 'pix' as const,
      status: 'open' as const,
    }));
    const s1Receivables = [...installmentReceivables, ...recurringReceivables];

    const professionalId = deterministicUuid(`${orgId}:sale:1:professional:rita`);
    const professionalCostBrl = 300_000;

    const financials = computeSaleFinancials({
      itemsTotalBrl,
      boundedRecurringBrl,
      receivableAmountsBrl: s1Receivables.map((row) => row.amountBrl),
      sellerCommissionPct: 5,
      finderCommissionPct: 3,
      hasFinder: true,
      taxPct: 12,
      otherCostsBrl: 50_000,
      professionalCostsBrl: professionalCostBrl,
    });

    sales.push({
      id: saleIdS1,
      orgId,
      sequence: 1,
      code: `0001-${PRODUCT_DEFS[0]!.codeSuffix}`,
      clientId: clientIdBySlug.get('construtora-ipe')!,
      clientNameSnapshot: CLIENT_DEFS[0]!.name,
      sellerPersonId: primarySeller.id,
      sellerNameSnapshot: primarySeller.displayName,
      finderPersonId: caio.id,
      finderNameSnapshot: caio.displayName,
      status: 'won',
      wonAt: isoDateTime(cutoff.iso),
      lostAt: null,
      paymentMethod: 'pix',
      condition: 'recurring',
      installments: installmentReceivables.length,
      baseDate: isoDateTime(cutoff.iso),
      notes: null,
      totalBrl: financials.totalBrl,
      recurringBrl: monthlyBrl,
      sellerCommissionPct: '5.00',
      finderCommissionPct: '3.00',
      taxPct: '12.00',
      otherCostsBrl: 50_000,
      professionalCostsBrl: financials.professionalCostsBrl,
      sellerCommissionBrl: financials.sellerCommissionBrl,
      finderCommissionBrl: financials.finderCommissionBrl,
      taxBrl: financials.taxBrl,
      netMarginBrl: financials.netMarginBrl,
      netMarginPct: financials.netMarginPct,
      createdAt: isoDateTime(cutoff.iso),
      updatedAt: isoDateTime(cutoff.iso),
    });

    saleItems.push({
      id: deterministicUuid(`${orgId}:sale:1:item:1`),
      orgId,
      saleId: saleIdS1,
      productId,
      productNameSnapshot: PRODUCT_DEFS[0]!.name,
      productTypeSnapshot: PRODUCT_DEFS[0]!.kind,
      areaId: areaIdBySlug.get('desenvolvimento')!,
      areaNameSnapshot: areaNameBySlug.get('desenvolvimento')!,
      quantity: 1,
      unitBrl: itemsTotalBrl,
      subtotalBrl: itemsTotalBrl,
    });

    saleProfessionals.push({
      id: professionalId,
      orgId,
      saleId: saleIdS1,
      personId: rita.id,
      personNameSnapshot: rita.displayName,
      funcaoId: funcaoIdBySlug.get('designer')!,
      funcaoNameSnapshot: funcaoNameBySlug.get('designer')!,
      role: funcaoNameBySlug.get('designer')!,
      costBrl: professionalCostBrl,
      costSplitBp: null,
    });

    receivables.push(...s1Receivables);

    const paidReceivableIds = new Set([installmentReceivables[0]!.id]);
    payables.push(
      ...buildCommissionPayables({
        orgId,
        saleId: saleIdS1,
        saleKey: '1',
        receivables: s1Receivables,
        sellerName: primarySeller.displayName,
        finderName: caio.displayName,
        sellerPct: 5,
        finderPct: 3,
        taxPct: 12,
        paidReceivableIds,
      }),
      ...buildProfessionalCostPayables({
        orgId,
        saleId: saleIdS1,
        saleKey: '1',
        professionalId,
        beneficiaryName: rita.displayName,
        costBrl: professionalCostBrl,
        installmentReceivables,
      }),
      {
        id: deterministicUuid(`${orgId}:sale:1:payable:other-cost`),
        orgId,
        saleId: saleIdS1,
        beneficiaryName: 'Outros custos',
        kind: 'other_cost',
        receivableId: null,
        saleProfessionalId: null,
        dueDate: isoDateTime(cutoff.iso),
        amountBrl: 50_000,
        status: 'open',
      },
    );
  }

  // ── S2: open, Landing Page, two installments, no finder, no payables ────
  {
    const productId = productIdBySlug.get('landing-page')!;
    const itemsTotalBrl = 450_000;
    const r1: ReceivableRow = {
      id: deterministicUuid(`${orgId}:sale:2:receivable:1`),
      orgId,
      saleId: saleIdS2,
      label: '1/2',
      dueDate: isoDateTime(cutoff.iso),
      amountBrl: 225_000,
      method: 'pix',
      status: 'open',
    };
    const r2: ReceivableRow = {
      id: deterministicUuid(`${orgId}:sale:2:receivable:2`),
      orgId,
      saleId: saleIdS2,
      label: '2/2',
      dueDate: isoDateTime(addMonthsIso(cutoff.iso, 1)),
      amountBrl: 225_000,
      method: 'pix',
      status: 'open',
    };

    const financials = computeSaleFinancials({
      itemsTotalBrl,
      boundedRecurringBrl: 0,
      receivableAmountsBrl: [r1.amountBrl, r2.amountBrl],
      sellerCommissionPct: 5,
      finderCommissionPct: 3,
      hasFinder: false,
      taxPct: 12,
      otherCostsBrl: 0,
      professionalCostsBrl: 0,
    });

    sales.push({
      id: saleIdS2,
      orgId,
      sequence: 2,
      code: `0002-${PRODUCT_DEFS[1]!.codeSuffix}`,
      clientId: clientIdBySlug.get('aurora-labs')!,
      clientNameSnapshot: CLIENT_DEFS[1]!.name,
      sellerPersonId: marina.id,
      sellerNameSnapshot: marina.displayName,
      finderPersonId: null,
      finderNameSnapshot: null,
      status: 'open',
      wonAt: null,
      lostAt: null,
      paymentMethod: 'pix',
      condition: 'installments',
      installments: 2,
      baseDate: isoDateTime(cutoff.iso),
      notes: null,
      totalBrl: financials.totalBrl,
      recurringBrl: 0,
      sellerCommissionPct: '5.00',
      finderCommissionPct: '3.00',
      taxPct: '12.00',
      otherCostsBrl: 0,
      professionalCostsBrl: 0,
      sellerCommissionBrl: financials.sellerCommissionBrl,
      finderCommissionBrl: financials.finderCommissionBrl,
      taxBrl: financials.taxBrl,
      netMarginBrl: financials.netMarginBrl,
      netMarginPct: financials.netMarginPct,
      createdAt: isoDateTime(cutoff.iso),
      updatedAt: isoDateTime(cutoff.iso),
    });

    saleItems.push({
      id: deterministicUuid(`${orgId}:sale:2:item:1`),
      orgId,
      saleId: saleIdS2,
      productId,
      productNameSnapshot: PRODUCT_DEFS[1]!.name,
      productTypeSnapshot: PRODUCT_DEFS[1]!.kind,
      areaId: areaIdBySlug.get('design')!,
      areaNameSnapshot: areaNameBySlug.get('design')!,
      quantity: 1,
      unitBrl: itemsTotalBrl,
      subtotalBrl: itemsTotalBrl,
    });

    receivables.push(r1, r2);
  }

  // ── S3: draft, Consultoria Estrategica, single installment, no finder ───
  {
    const productId = productIdBySlug.get('consultoria-estrategica')!;
    const itemsTotalBrl = 800_000;
    const r1: ReceivableRow = {
      id: deterministicUuid(`${orgId}:sale:3:receivable:1`),
      orgId,
      saleId: saleIdS3,
      label: '1/1',
      dueDate: isoDateTime(cutoff.iso),
      amountBrl: itemsTotalBrl,
      method: 'pix',
      status: 'open',
    };

    const financials = computeSaleFinancials({
      itemsTotalBrl,
      boundedRecurringBrl: 0,
      receivableAmountsBrl: [r1.amountBrl],
      sellerCommissionPct: 5,
      finderCommissionPct: 3,
      hasFinder: false,
      taxPct: 12,
      otherCostsBrl: 0,
      professionalCostsBrl: 0,
    });

    sales.push({
      id: saleIdS3,
      orgId,
      sequence: 3,
      code: `0003-${PRODUCT_DEFS[2]!.codeSuffix}`,
      clientId: clientIdBySlug.get('meridiano-log')!,
      clientNameSnapshot: CLIENT_DEFS[2]!.name,
      sellerPersonId: primarySeller.id,
      sellerNameSnapshot: primarySeller.displayName,
      finderPersonId: null,
      finderNameSnapshot: null,
      status: 'draft',
      wonAt: null,
      lostAt: null,
      paymentMethod: 'pix',
      condition: 'cash',
      installments: 1,
      baseDate: isoDateTime(cutoff.iso),
      notes: null,
      totalBrl: financials.totalBrl,
      recurringBrl: 0,
      sellerCommissionPct: '5.00',
      finderCommissionPct: '3.00',
      taxPct: '12.00',
      otherCostsBrl: 0,
      professionalCostsBrl: 0,
      sellerCommissionBrl: financials.sellerCommissionBrl,
      finderCommissionBrl: financials.finderCommissionBrl,
      taxBrl: financials.taxBrl,
      netMarginBrl: financials.netMarginBrl,
      netMarginPct: financials.netMarginPct,
      createdAt: isoDateTime(cutoff.iso),
      updatedAt: isoDateTime(cutoff.iso),
    });

    saleItems.push({
      id: deterministicUuid(`${orgId}:sale:3:item:1`),
      orgId,
      saleId: saleIdS3,
      productId,
      productNameSnapshot: PRODUCT_DEFS[2]!.name,
      productTypeSnapshot: PRODUCT_DEFS[2]!.kind,
      areaId: areaIdBySlug.get('consultoria')!,
      areaNameSnapshot: areaNameBySlug.get('consultoria')!,
      quantity: 1,
      unitBrl: itemsTotalBrl,
      subtotalBrl: itemsTotalBrl,
    });

    receivables.push(r1);
  }

  // ── S4: lost, Suporte Dedicado, single installment, WITH finder ─────────
  {
    const productId = productIdBySlug.get('suporte-dedicado')!;
    const itemsTotalBrl = 500_000;
    const r1: ReceivableRow = {
      id: deterministicUuid(`${orgId}:sale:4:receivable:1`),
      orgId,
      saleId: saleIdS4,
      label: '1/1',
      dueDate: isoDateTime(cutoff.iso),
      amountBrl: itemsTotalBrl,
      method: 'pix',
      status: 'open',
    };

    const financials = computeSaleFinancials({
      itemsTotalBrl,
      boundedRecurringBrl: 0,
      receivableAmountsBrl: [r1.amountBrl],
      sellerCommissionPct: 5,
      finderCommissionPct: 3,
      hasFinder: true,
      taxPct: 12,
      otherCostsBrl: 0,
      professionalCostsBrl: 0,
    });

    sales.push({
      id: saleIdS4,
      orgId,
      sequence: 4,
      code: `0004-${PRODUCT_DEFS[3]!.codeSuffix}`,
      clientId: clientIdBySlug.get('aurora-labs')!,
      clientNameSnapshot: CLIENT_DEFS[1]!.name,
      sellerPersonId: marina.id,
      sellerNameSnapshot: marina.displayName,
      finderPersonId: caio.id,
      finderNameSnapshot: caio.displayName,
      status: 'lost',
      wonAt: null,
      lostAt: isoDateTime(cutoff.iso),
      paymentMethod: 'pix',
      condition: 'cash',
      installments: 1,
      baseDate: isoDateTime(cutoff.iso),
      notes: null,
      totalBrl: financials.totalBrl,
      recurringBrl: 0,
      sellerCommissionPct: '5.00',
      finderCommissionPct: '3.00',
      taxPct: '12.00',
      otherCostsBrl: 0,
      professionalCostsBrl: 0,
      sellerCommissionBrl: financials.sellerCommissionBrl,
      finderCommissionBrl: financials.finderCommissionBrl,
      taxBrl: financials.taxBrl,
      netMarginBrl: financials.netMarginBrl,
      netMarginPct: financials.netMarginPct,
      createdAt: isoDateTime(cutoff.iso),
      updatedAt: isoDateTime(cutoff.iso),
    });

    saleItems.push({
      id: deterministicUuid(`${orgId}:sale:4:item:1`),
      orgId,
      saleId: saleIdS4,
      productId,
      productNameSnapshot: PRODUCT_DEFS[3]!.name,
      productTypeSnapshot: PRODUCT_DEFS[3]!.kind,
      areaId: areaIdBySlug.get('consultoria')!,
      areaNameSnapshot: areaNameBySlug.get('consultoria')!,
      quantity: 1,
      unitBrl: itemsTotalBrl,
      subtotalBrl: itemsTotalBrl,
    });

    receivables.push(r1);
  }

  // ── Leads (L1..L6) ───────────────────────────────────────────────────────
  // createdAt is fixed 60 days before the cutoff for every lead, so it always
  // differs from stageChangedAt (the parked-days pin) regardless of which
  // etapa a card currently sits in.
  const leadCreatedAt = isoDateTime(addDaysIso(cutoff.iso, -60));

  const leads: LeadRow[] = [
    {
      id: deterministicUuid(`${orgId}:lead:1`),
      orgId,
      contactName: 'Marcos Ipê',
      clientId: clientIdBySlug.get('construtora-ipe')!,
      clientNameSnapshot: CLIENT_DEFS[0]!.name,
      estimatedValueBrl: 1_200_000,
      description: 'Negociação de nova plataforma para Construtora Ipê.',
      sellerPersonId: primarySeller.id,
      sellerNameSnapshot: primarySeller.displayName,
      stageId: stageIdBySlug.get('novo')!,
      stageChangedAt: isoDateTime(addDaysIso(cutoff.iso, -2)),
      position: 1,
      lostReason: null,
      saleId: null,
      createdAt: leadCreatedAt,
      updatedAt: isoDateTime(addDaysIso(cutoff.iso, -2)),
    },
    {
      id: deterministicUuid(`${orgId}:lead:2`),
      orgId,
      contactName: 'Fernanda Padaria',
      clientId: null,
      clientNameSnapshot: 'Padaria Aurora',
      estimatedValueBrl: 350_000,
      description: 'Novo site institucional.',
      sellerPersonId: marina.id,
      sellerNameSnapshot: marina.displayName,
      stageId: stageIdBySlug.get('novo')!,
      stageChangedAt: isoDateTime(addDaysIso(cutoff.iso, -12)),
      position: 2,
      lostReason: null,
      saleId: null,
      createdAt: leadCreatedAt,
      updatedAt: isoDateTime(addDaysIso(cutoff.iso, -12)),
    },
    {
      id: deterministicUuid(`${orgId}:lead:3`),
      orgId,
      contactName: 'Julio Aurora',
      clientId: clientIdBySlug.get('aurora-labs')!,
      clientNameSnapshot: CLIENT_DEFS[1]!.name,
      estimatedValueBrl: 900_000,
      description: 'Consultoria estratégica em andamento.',
      sellerPersonId: primarySeller.id,
      sellerNameSnapshot: primarySeller.displayName,
      stageId: stageIdBySlug.get('em-negociacao')!,
      stageChangedAt: isoDateTime(addDaysIso(cutoff.iso, -30)),
      position: 1,
      lostReason: null,
      saleId: null,
      createdAt: leadCreatedAt,
      updatedAt: isoDateTime(addDaysIso(cutoff.iso, -30)),
    },
    {
      id: deterministicUuid(`${orgId}:lead:4`),
      orgId,
      contactName: 'Patricia Log',
      clientId: clientIdBySlug.get('meridiano-log')!,
      clientNameSnapshot: CLIENT_DEFS[2]!.name,
      estimatedValueBrl: 400_000,
      description: 'Proposta recusada por orçamento.',
      sellerPersonId: marina.id,
      sellerNameSnapshot: marina.displayName,
      stageId: stageIdBySlug.get('perdido')!,
      stageChangedAt: isoDateTime(addDaysIso(cutoff.iso, -5)),
      position: 1,
      lostReason: 'Preço acima do orçamento',
      saleId: null,
      createdAt: leadCreatedAt,
      updatedAt: isoDateTime(addDaysIso(cutoff.iso, -5)),
    },
    {
      id: deterministicUuid(`${orgId}:lead:5`),
      orgId,
      contactName: 'Renata Ipê',
      clientId: clientIdBySlug.get('construtora-ipe')!,
      clientNameSnapshot: CLIENT_DEFS[0]!.name,
      estimatedValueBrl: 2_000_000,
      description: 'Convertido para a proposta 0001.',
      sellerPersonId: primarySeller.id,
      sellerNameSnapshot: primarySeller.displayName,
      stageId: stageIdBySlug.get('proposta')!,
      stageChangedAt: isoDateTime(addDaysIso(cutoff.iso, -1)),
      position: 1,
      lostReason: null,
      saleId: saleIdS1,
      createdAt: leadCreatedAt,
      updatedAt: isoDateTime(addDaysIso(cutoff.iso, -1)),
    },
    {
      id: deterministicUuid(`${orgId}:lead:6`),
      orgId,
      contactName: 'Oficina Norte',
      clientId: null,
      clientNameSnapshot: 'Oficina Norte',
      estimatedValueBrl: 600_000,
      description: 'Lead sem vendedor designado.',
      sellerPersonId: null,
      sellerNameSnapshot: '',
      stageId: stageIdBySlug.get('em-negociacao')!,
      stageChangedAt: isoDateTime(addDaysIso(cutoff.iso, -45)),
      position: 2,
      lostReason: null,
      saleId: null,
      createdAt: leadCreatedAt,
      updatedAt: isoDateTime(addDaysIso(cutoff.iso, -45)),
    },
  ];

  const leadProducts: LeadProductRow[] = [
    {
      id: deterministicUuid(`${orgId}:lead:1:product:1`),
      orgId,
      leadId: leads[0]!.id,
      productId: productIdBySlug.get('plataforma-fxl')!,
      productNameSnapshot: PRODUCT_DEFS[0]!.name,
      createdAt: leadCreatedAt,
    },
    {
      id: deterministicUuid(`${orgId}:lead:2:product:1`),
      orgId,
      leadId: leads[1]!.id,
      productId: null,
      productNameSnapshot: 'Site institucional',
      createdAt: leadCreatedAt,
    },
    {
      id: deterministicUuid(`${orgId}:lead:3:product:1`),
      orgId,
      leadId: leads[2]!.id,
      productId: productIdBySlug.get('consultoria-estrategica')!,
      productNameSnapshot: PRODUCT_DEFS[2]!.name,
      createdAt: leadCreatedAt,
    },
  ];

  return {
    settings,
    areas,
    funcoes,
    people,
    personFuncoes,
    clients,
    products,
    productFuncaoCosts,
    leadStages,
    sales,
    saleItems,
    saleProfessionals,
    receivables,
    payables,
    leads,
    leadProducts,
  };
}

export function buildDevSeedPlan(input: {
  orgIds: string[];
  identities: SeedIdentity[];
  cutoff: SeedCutoff;
}): DevSeedPlan {
  const settings: SettingsRow[] = [];
  const areas: AreaRow[] = [];
  const funcoes: FuncaoRow[] = [];
  const people: PersonRow[] = [];
  const personFuncoes: PersonFuncaoRow[] = [];
  const clients: ClientRow[] = [];
  const products: ProductRow[] = [];
  const productFuncaoCosts: ProductFuncaoCostRow[] = [];
  const leadStages: LeadStageRow[] = [];
  const sales: SaleRow[] = [];
  const saleItems: SaleItemRow[] = [];
  const saleProfessionals: SaleProfessionalRow[] = [];
  const receivables: ReceivableRow[] = [];
  const payables: PayableRow[] = [];
  const leads: LeadRow[] = [];
  const leadProducts: LeadProductRow[] = [];

  for (const orgId of input.orgIds) {
    const org = buildOrgRows(orgId, input.identities, input.cutoff);
    settings.push(org.settings);
    areas.push(...org.areas);
    funcoes.push(...org.funcoes);
    people.push(...org.people);
    personFuncoes.push(...org.personFuncoes);
    clients.push(...org.clients);
    products.push(...org.products);
    productFuncaoCosts.push(...org.productFuncaoCosts);
    leadStages.push(...org.leadStages);
    sales.push(...org.sales);
    saleItems.push(...org.saleItems);
    saleProfessionals.push(...org.saleProfessionals);
    receivables.push(...org.receivables);
    payables.push(...org.payables);
    leads.push(...org.leads);
    leadProducts.push(...org.leadProducts);
  }

  return {
    rows: {
      salesOpsSettings: settings,
      salesOpsAreas: areas,
      salesOpsFuncoes: funcoes,
      salesOpsPeople: people,
      salesOpsPersonFuncoes: personFuncoes,
      salesOpsClients: clients,
      salesOpsProducts: products,
      salesOpsProductFuncaoCosts: productFuncaoCosts,
      salesOpsLeadStages: leadStages,
      salesOpsSales: sales,
      salesOpsSaleItems: saleItems,
      salesOpsSaleProfessionals: saleProfessionals,
      salesOpsReceivables: receivables,
      salesOpsPayables: payables,
      salesOpsLeads: leads,
      salesOpsLeadProducts: leadProducts,
    },
  };
}
