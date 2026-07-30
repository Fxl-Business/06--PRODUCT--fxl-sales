export type SalesOpsStatus = 'draft' | 'open' | 'won' | 'lost' | 'cancelled';
export type PaymentMethod = 'pix' | 'card' | 'boleto' | 'transfer';
export type PaymentCondition = 'cash' | 'installments' | 'recurring';
export type CommissionType = 'pct' | 'fix';

/**
 * An org-scoped função. `vendedor` and `finder` are the only two that can carry
 * `isSystem: true`; every other one is created by the org and fully editable.
 */
export type SalesOpsFuncao = {
  id: string;
  orgId: string;
  name: string;
  slug: string;
  isSystem: boolean;
  status: 'active' | 'archived';
  createdAt: string;
  updatedAt: string | null;
};

/** A função as it is nested on a pessoa. Note the key is `id`, not `funcaoId`. */
export type SalesOpsPersonFuncao = Pick<
  SalesOpsFuncao,
  'id' | 'name' | 'slug' | 'isSystem'
>;

/**
 * The API still returns the deprecated `is_seller` / `is_finder` /
 * `is_collaborator` mirrors on the wire, and this type deliberately does not
 * declare them: `pnpm run type-check` is then the mechanical proof that no web
 * code reads a mirror instead of the `funcoes` assignments.
 */
export type SalesOpsPerson = {
  id: string;
  orgId: string;
  displayName: string;
  contactEmail: string | null;
  status: 'active' | 'inactive';
  funcaoIds: string[];
  funcoes: SalesOpsPersonFuncao[];
  createdAt: string;
  updatedAt: string | null;
};

export type SalesOpsProductModule = {
  name: string;
  type: string;
  valueBrl: number;
};

export type SalesOpsProductProvider = {
  personName: string;
  commissionType: CommissionType;
  commissionValue: number;
};

/**
 * Produto | Serviço, the single classification axis on a catalog row. Storage
 * values are English to match every other enum on the wire; the pt-BR labels
 * live in the view layer.
 */
export type SalesOpsProductKind = 'product' | 'service';

/**
 * One default cost for one função on one produto/serviço. Cost rows come back
 * FLAT under `bootstrap.productFuncaoCosts`, never nested on a product, so every
 * consumer looks them up by `productId`.
 *
 * `valuePct` is a percent (drizzle serializes `numeric` as a string) and
 * `valueBrl` is integer CENTS. Exactly one of them is set, discriminated by
 * `mode`, which is what keeps "5.00 percent" and "30000 cents" from ever sharing
 * a field.
 */
export type SalesOpsProductFuncaoCost = {
  id: string;
  orgId: string;
  productId: string;
  funcaoId: string;
  mode: CommissionType;
  valuePct: string | null;
  valueBrl: number | null;
  createdAt: string;
  updatedAt: string | null;
};

export type SalesOpsProduct = {
  id: string;
  orgId: string;
  name: string;
  /**
   * Optional because a locally constructed row (and any response that predates
   * the `kind` column) simply does not carry it. Absent is read as a Produto,
   * which is the conservative direction: it keeps every per-item requirement in
   * place rather than relaxing one on a row we cannot classify. `productRowRequirements`
   * is what makes that true, by falling back to `openPrice` for the classification
   * question when `kind` is missing.
   *
   * That fallback is about REQUIREMENTS only. The money question - what a row's own
   * value is - goes through `productBaseValueBrl`, which reads setupBrl/monthlyBrl
   * directly and never consults either flag, because both kinds may carry a value.
   */
  kind?: SalesOpsProductKind;
  codeSuffix: string;
  areaId: string | null;
  openPrice: boolean;
  setupBrl: number;
  hasMonthly: boolean;
  monthlyBrl: number;
  recurringCommission: boolean;
  hasFinderCommission: boolean;
  sellerCommissionType: CommissionType;
  sellerCommissionValue: string;
  sellerWithFinderCommissionType: CommissionType;
  sellerWithFinderCommissionValue: string;
  finderCommissionType: CommissionType;
  finderCommissionValue: string;
  /**
   * The default payment plan TEMPLATE: six flat columns, no nested object and no
   * absolute dates. `defaultEntradaMode: 'none'` plus
   * `defaultRemainingInstallments: 1` IS the app default and reproduces a single
   * cash parcela, so there is no "this product has no plan" state.
   *
   * Optional for the same reason `kind` is: a locally constructed row does not
   * carry them, so every reader falls back to the app default rather than
   * printing `undefined`. `defaultEntradaPct` is a percent serialized by drizzle
   * as a string; `defaultEntradaBrl` is integer cents;
   * `defaultRecurringCycles: null` means indefinite recurrence. The recurring
   * AMOUNT is deliberately absent: it already lives in `monthlyBrl`, and
   * `hasMonthly` already expresses "this thing recurs".
   */
  defaultPaymentMethod?: PaymentMethod;
  defaultEntradaMode?: 'none' | 'pct' | 'fix';
  defaultEntradaPct?: string | null;
  defaultEntradaBrl?: number | null;
  defaultRemainingInstallments?: number;
  defaultRecurringCycles?: number | null;
  modules: SalesOpsProductModule[];
  /** @deprecated superseded by `SalesOpsProductFuncaoCost`; read-only from here on. */
  providers: SalesOpsProductProvider[];
  status: 'active' | 'archived';
  createdAt: string;
  updatedAt: string | null;
};

export type SalesOpsClient = {
  id: string;
  orgId: string;
  name: string;
  contact: string | null;
  legalName?: string | null;
  document?: string | null;
  address?: string | null;
  legalRepName?: string | null;
  legalRepDocument?: string | null;
  createdAt: string;
  updatedAt: string | null;
};

export type SalesOpsArea = {
  id: string;
  orgId: string;
  name: string;
  status: 'active' | 'archived';
  createdAt: string;
  updatedAt: string | null;
};

export type SalesOpsSale = {
  id: string;
  orgId: string;
  sequence: number;
  code: string;
  clientId: string | null;
  clientNameSnapshot: string;
  sellerPersonId: string | null;
  sellerNameSnapshot: string;
  finderPersonId: string | null;
  finderNameSnapshot: string | null;
  status: SalesOpsStatus;
  paymentMethod: PaymentMethod;
  condition: PaymentCondition;
  installments: number;
  baseDate: string;
  notes: string | null;
  wonAt: string | null;
  lostAt: string | null;
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
  updatedAt: string | null;
};

export type SalesOpsSaleItem = {
  id?: string;
  orgId?: string;
  saleId: string;
  productId: string | null;
  productNameSnapshot: string;
  productTypeSnapshot: string;
  quantity: number;
  unitBrl: number;
  subtotalBrl: number;
  areaId?: string | null;
  areaNameSnapshot?: string;
};

export type SalesOpsReceivable = {
  id: string;
  orgId?: string;
  saleId: string;
  label?: string; // '1/n' for installment rows, 'M1/c' for bounded recurring rows (slice 03 ledger contract)
  dueDate: string;
  amountBrl: number;
  method: PaymentMethod;
  status: 'open' | 'paid' | 'void';
  createdAt?: string;
  updatedAt?: string | null;
};

export type SalesOpsSaleProfessional = {
  id?: string;
  orgId?: string;
  saleId: string;
  personId: string | null;
  personNameSnapshot: string;
  /**
   * `null` on a legacy row whose free-text `role` matched no função in the org's
   * cadastro. Such a row keeps its label in `funcaoNameSnapshot` and renders
   * through the picker's `valueLabel`; no função is invented from historical text.
   */
  funcaoId?: string | null;
  /** Server-derived from the resolved cadastro row; never authored by the client. */
  funcaoNameSnapshot?: string;
  /** @deprecated derived mirror of `funcaoNameSnapshot`; kept while legacy rows exist. */
  role: string;
  costBrl: number;
};

export type SalesOpsPayable = {
  id?: string;
  orgId?: string;
  saleId: string;
  beneficiaryName: string;
  kind: string;
  dueDate: string;
  amountBrl: number;
  status: 'open' | 'paid' | 'void';
};

export type SalesOpsSettings = {
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
  tableDensity: 'comfortable' | 'compact';
  dateFormat: string;
  language: string;
  commissionOnRecurring: boolean;
  sellerCanBeFinder: boolean;
  createdAt: string;
  updatedAt: string | null;
};

export type SalesOpsBootstrap = {
  sales: SalesOpsSale[];
  products: SalesOpsProduct[];
  productFuncaoCosts: SalesOpsProductFuncaoCost[];
  clients: SalesOpsClient[];
  areas: SalesOpsArea[];
  funcoes: SalesOpsFuncao[];
  people: SalesOpsPerson[];
  payables: SalesOpsPayable[];
  saleItems: SalesOpsSaleItem[];
  receivables: SalesOpsReceivable[];
  saleProfessionals: SalesOpsSaleProfessional[];
  settings: SalesOpsSettings | null;
};

export type DashboardModel = {
  kpis: {
    wonRevenueBrl: number;
    activeMrrBrl: number;
    payableBrl: number;
    wonSalesCount: number;
  };
  revenueByProduct: Array<{ name: string; amountBrl: number; widthPct: number }>;
  topSellers: Array<{ name: string; totalBrl: number; commissionBrl: number; count: number }>;
  topFinders: Array<{ name: string; totalBrl: number; commissionBrl: number; count: number }>;
  latestSales: SalesOpsSale[];
};

export type SaleDraftItem = {
  productId?: string;
  areaId?: string;
  productName: string;
  productType: string;
  quantity: string | number;
  unitBrl: string | number;
};

export type SaleDraftProfessional = {
  personId?: string;
  personName: string;
  funcaoId?: string;
  /**
   * Optional because a `funcaoId` row does not need it. The API's
   * `SaleProfessionalSchema` requires one of the two, and the payload builder
   * emits the função name here so a legacy free-text row stays valid.
   */
  role?: string;
  costBrl: string | number;
};

export type SaleDraftInstallment = { dueDate: string; amountBrl: string | number; method: PaymentMethod };
export type SaleDraftRecurring = {
  monthlyBrl: string | number;
  startDate: string;
  cycles: number | null;
  method?: PaymentMethod;
};

export type SaleDraft = {
  clientId?: string;
  clientName: string;
  sellerPersonId?: string;
  sellerName: string;
  finderPersonId?: string;
  finderName?: string;
  status: SalesOpsStatus;
  baseDate: string;
  notes?: string;
  sellerCommissionPct: string | number;
  finderCommissionPct: string | number;
  taxPct: string | number;
  otherCostsBrl: string | number;
  installments: SaleDraftInstallment[];
  recurring?: SaleDraftRecurring | null;
  items: SaleDraftItem[];
  professionals: SaleDraftProfessional[];
};

export type CreateSalePayload = {
  clientId?: string;
  clientName: string;
  sellerPersonId?: string;
  sellerName: string;
  finderPersonId?: string;
  finderName?: string | null;
  status: SalesOpsStatus;
  baseDate: string;
  notes: string | null;
  sellerCommissionPct: number;
  finderCommissionPct: number;
  taxPct: number;
  otherCostsBrl: number;
  installments: Array<{ dueDate: string; amountBrl: number; method: PaymentMethod }>;
  recurring: { monthlyBrl: number; startDate: string; cycles: number | null; method?: PaymentMethod } | null;
  items: Array<{
    productId?: string;
    areaId?: string;
    productName: string;
    productType: string;
    quantity: number;
    unitBrl: number;
  }>;
  professionals: Array<{
    personId?: string;
    personName: string;
    funcaoId?: string;
    role?: string;
    costBrl: number;
  }>;
};
