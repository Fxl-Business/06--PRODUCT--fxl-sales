export type SalesOpsStatus = 'draft' | 'forecast' | 'closed' | 'in_progress' | 'completed' | 'cancelled';
export type PaymentMethod = 'pix' | 'card' | 'boleto' | 'transfer';
export type PaymentCondition = 'cash' | 'installments' | 'recurring';
export type CommissionType = 'pct' | 'fix';

export type SalesOpsPerson = {
  id: string;
  orgId: string;
  displayName: string;
  contactEmail: string | null;
  status: 'active' | 'inactive';
  isSeller: boolean;
  isFinder: boolean;
  isCollaborator: boolean;
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

export type SalesOpsProduct = {
  id: string;
  orgId: string;
  name: string;
  type: string;
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
  modules: SalesOpsProductModule[];
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
};

export type SalesOpsPayable = {
  id?: string;
  orgId?: string;
  saleId: string;
  beneficiaryName: string;
  kind: string;
  dueDate: string;
  amountBrl: number;
  status: 'open' | 'paid' | 'voided';
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
  clients: SalesOpsClient[];
  areas: SalesOpsArea[];
  people: SalesOpsPerson[];
  payables: SalesOpsPayable[];
  saleItems: SalesOpsSaleItem[];
  settings: SalesOpsSettings | null;
};

export type DashboardModel = {
  kpis: {
    closedRevenueBrl: number;
    activeMrrBrl: number;
    payableBrl: number;
    closedSalesCount: number;
  };
  revenueByProduct: Array<{ name: string; amountBrl: number; widthPct: number }>;
  topSellers: Array<{ name: string; totalBrl: number; commissionBrl: number; count: number }>;
  topFinders: Array<{ name: string; totalBrl: number; commissionBrl: number; count: number }>;
  latestSales: SalesOpsSale[];
};

export type SaleDraftItem = {
  productId?: string;
  productName: string;
  productType: string;
  quantity: string | number;
  unitBrl: string | number;
};

export type SaleDraftProfessional = {
  personId?: string;
  personName: string;
  role: string;
  costBrl: string | number;
};

export type SaleDraft = {
  clientId?: string;
  clientName: string;
  sellerPersonId?: string;
  sellerName: string;
  finderPersonId?: string;
  finderName?: string;
  status: SalesOpsStatus;
  paymentMethod: PaymentMethod;
  condition: PaymentCondition;
  installments: string | number;
  baseDate: string;
  notes?: string;
  sellerCommissionPct: string | number;
  finderCommissionPct: string | number;
  taxPct: string | number;
  otherCostsBrl: string | number;
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
  paymentMethod: PaymentMethod;
  condition: PaymentCondition;
  installments: number;
  baseDate: string;
  notes: string | null;
  sellerCommissionPct: number;
  finderCommissionPct: number;
  taxPct: number;
  otherCostsBrl: number;
  items: Array<{
    productId?: string;
    productName: string;
    productType: string;
    quantity: number;
    unitBrl: number;
  }>;
  professionals: Array<{
    personId?: string;
    personName: string;
    role: string;
    costBrl: number;
  }>;
};
