import type {
  AreaInput,
  ClientInput,
  CreateSaleInput,
  FuncaoInput,
  PaymentMethod,
  PersonInput,
  ProductEntradaMode,
  ProductFuncaoCostInput,
  ProductInput,
  ProductKind,
} from '../sales-ops/service.js';
import type { LeadStageInput } from '../sales-ops/leads/schemas.js';
import type { CreateLeadInput } from '../sales-ops/leads/lead-schemas.js';

/** The 13 data sheets, in dependency order. `Leia-me` and `Listas` are not SheetKeys. */
export type SheetKey =
  | 'areas'
  | 'funcoes'
  | 'produtos'
  | 'custosProduto'
  | 'pessoas'
  | 'clientes'
  | 'etapas'
  | 'leads'
  | 'propostas'
  | 'itens'
  | 'profissionais'
  | 'parcelas'
  | 'pagamentos';

/** After coercion: money/int/pct are numbers (money in CENTS), day is an ISO civil day, enum is the option VALUE, list is string[]. */
export type CellValue = string | number | boolean | string[] | null;
export type ParsedRow = { row: number; cells: Record<string, CellValue> };
export type ParsedSheet = { key: SheetKey; rows: ParsedRow[] };
export type ParsedWorkbook = { sheets: Record<SheetKey, ParsedSheet>; issues: ImportIssue[] };

export type ImportIssueSeverity = 'error' | 'warning';
export type ImportIssue = {
  severity: ImportIssueSeverity;
  sheet: SheetKey | null;
  row: number | null;
  column: string | null;
  code: string;
  message: string;
};

export type CommissionType = 'pct' | 'fix';

export type ProductCatalogFuncaoCost =
  | { funcaoId: string; mode: 'pct'; valuePct: number }
  | { funcaoId: string; mode: 'fix'; valueBrl: number };

/**
 * The full product row projection the planners need. Numeric DB columns are
 * NUMBERS here (slice 02 converts drizzle's numeric strings once).
 * Commission values: percent when the type is 'pct', REAIS (not cents) when 'fix',
 * exactly as ProductSchema stores them. Money fields are integer cents.
 */
export type ProductCatalogEntry = {
  id: string;
  name: string;
  codeSuffix: string;
  kind: ProductKind;
  areaId: string | null;
  status: string;
  setupBrl: number;
  hasMonthly: boolean;
  monthlyBrl: number;
  recurringCommission: boolean;
  hasFinderCommission: boolean;
  sellerCommissionType: CommissionType;
  sellerCommissionValue: number;
  sellerWithFinderCommissionType: CommissionType;
  sellerWithFinderCommissionValue: number;
  finderCommissionType: CommissionType;
  finderCommissionValue: number;
  defaultPaymentMethod: PaymentMethod;
  defaultEntradaMode: ProductEntradaMode;
  defaultEntradaPct: number | null;
  defaultEntradaBrl: number | null;
  defaultRemainingInstallments: number;
  defaultRecurringCycles: number | null;
  productFuncaoCosts: ProductCatalogFuncaoCost[];
};

/** The org's sales_ops_settings defaults a proposta falls back to (10 / 3 / 6 when the org has no row). */
export type ImportCatalogSettings = {
  defaultSellerCommissionPct: number;
  defaultFinderCommissionPct: number;
  defaultTaxPct: number;
};

export type ImportCatalog = {
  today: string;
  producerFlowLive: boolean;
  settings: ImportCatalogSettings;
  areas: Array<{ id: string; name: string; status: string }>;
  funcoes: Array<{ id: string; name: string; slug: string; isSystem: boolean; status: string }>;
  /** Every produto of the org, archived included (code suffixes stay unique across both). */
  products: ProductCatalogEntry[];
  people: Array<{
    id: string;
    displayName: string;
    contactEmail: string | null;
    status: string;
    funcaoSlugs: string[];
    funcaoIds: string[];
  }>;
  clients: Array<{ id: string; name: string; document: string | null }>;
  stages: Array<{
    id: string;
    name: string;
    kind: 'normal' | 'conversion' | 'lost';
    status: string;
    position: number;
  }>;
};

export type EntityRef = { existingId: string } | { planKey: string };

/** A Clientes row that IS this existing cliente (D12). `name` is the STORED name, the label every lookup answers. */
export type RecognizedClient = { existingId: string; name: string };
/** Excel row number of the Clientes tab -> the existing cliente that row is. */
export type ClientRecognition = ReadonlyMap<number, RecognizedClient>;

export type SaleDraft = Omit<
  CreateSaleInput,
  'clientId' | 'sellerPersonId' | 'finderPersonId' | 'items' | 'professionals'
> & {
  clientRef: EntityRef | null;
  sellerRef: EntityRef;
  finderRef: EntityRef | null;
  items: Array<
    Omit<CreateSaleInput['items'][number], 'productId' | 'areaId'> & {
      productRef: EntityRef | null;
      areaRef: EntityRef | null;
    }
  >;
  professionals: Array<
    Omit<CreateSaleInput['professionals'][number], 'personId' | 'funcaoId'> & {
      personRef: EntityRef | null;
      funcaoRef: EntityRef | null;
    }
  >;
};

export type ImportOperation =
  | { op: 'createArea'; planKey: string; input: AreaInput }
  | { op: 'createFuncao'; planKey: string; input: FuncaoInput }
  | {
      op: 'createProduct';
      planKey: string;
      input: Omit<ProductInput, 'areaId' | 'productFuncaoCosts'>;
      areaRef: EntityRef;
      funcaoCosts: Array<{ funcaoRef: EntityRef; cost: Omit<ProductFuncaoCostInput, 'funcaoId'> }>;
    }
  | { op: 'createPerson'; planKey: string; input: Omit<PersonInput, 'funcaoIds'>; funcaoRefs: EntityRef[] }
  | { op: 'createClient'; planKey: string; input: ClientInput }
  | { op: 'createLeadStage'; planKey: string; input: LeadStageInput }
  | {
      op: 'createLead';
      planKey: string;
      input: Omit<CreateLeadInput, 'clientId' | 'sellerPersonId' | 'products'>;
      clientRef: EntityRef | null;
      sellerRef: EntityRef | null;
      products: Array<{ productRef: EntityRef | null; name: string }>;
      stageRef: EntityRef | null;
      lostReason: string | null;
    }
  | { op: 'createSale'; planKey: string; input: SaleDraft; wonOn: string | null }
  | { op: 'transitionSale'; saleKey: string; to: 'lost' | 'cancelled' }
  | { op: 'settleReceivable'; saleKey: string; receivableLabel: string; paidOn: string; settlePayables: boolean };

export type ImportOperationKind = ImportOperation['op'];

export type ImportCounts = Partial<Record<SheetKey, number>>;

export type ImportPlan = {
  operations: ImportOperation[];
  issues: ImportIssue[];
  counts: ImportCounts;
  /** Rows recognized as EXISTING records and therefore not created (D12: only Clientes today). */
  recognized: ImportCounts;
};

export type SheetPlanResult = {
  operations: ImportOperation[];
  issues: ImportIssue[];
  counts: ImportCounts;
  /** Only planCadastros sets it; a key is present only above zero. */
  recognized?: ImportCounts;
};

export type RefKind = 'area' | 'funcao' | 'product' | 'person' | 'client' | 'stage';
export type RefLookupFailureCode = 'unknown_ref' | 'archived_ref' | 'ambiguous_ref';
export type RefLookup =
  | { ok: true; ref: EntityRef; label: string }
  | { ok: false; code: RefLookupFailureCode; message: string };
export interface RefIndex {
  resolve(kind: RefKind, name: string): RefLookup;
}

/** Wire bodies of POST /preview and POST /commit (slice 07 answers them, slice 09 mirrors them). */
export type ImportPreviewBody = {
  ok: boolean;
  counts: ImportCounts;
  recognized: ImportCounts;
  issues: ImportIssue[];
  truncated: boolean;
};
export type ImportCommitBody = { counts: ImportCounts; recognized: ImportCounts };
