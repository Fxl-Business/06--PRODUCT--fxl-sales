import { and, desc, eq, gt, inArray, ne, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { getDb } from '../../db/client.js';
import {
  salesOpsAreas,
  salesOpsClients,
  salesOpsPayables,
  salesOpsPeople,
  salesOpsProducts,
  salesOpsReceivables,
  salesOpsSaleItems,
  salesOpsSaleProfessionals,
  salesOpsSales,
  salesOpsSettings,
} from '../../db/schema.js';
import { setTenantContext } from '../../middleware/auth.js';

type Db = ReturnType<typeof getDb>;
type Tx = { execute: (query: SQL) => Promise<unknown> };

const uuid = z.string().uuid();
const money = z.number().int().nonnegative();
const pct = z.number().min(0).max(100);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const PersonFieldsSchema = z.object({
  displayName: z.string().min(1).max(120),
  contactEmail: z.string().email().optional().or(z.literal('')),
  status: z.enum(['active', 'inactive']).default('active'),
  isSeller: z.boolean().default(false),
  isFinder: z.boolean().default(false),
  isCollaborator: z.boolean().default(false),
});

export const PersonSchema = PersonFieldsSchema.refine(
  (data) => data.isSeller || data.isFinder || data.isCollaborator,
  {
    message: 'at least one role is required',
  },
);
export const UpdatePersonSchema = PersonFieldsSchema.partial().refine(
  (data) =>
    data.isSeller === undefined ||
    data.isFinder === undefined ||
    data.isCollaborator === undefined ||
    data.isSeller ||
    data.isFinder ||
    data.isCollaborator,
  { message: 'at least one role is required' },
);

export const ProductModuleSchema = z.object({
  name: z.string().min(1),
  type: z.string().min(1),
  valueBrl: money,
});

export const ProductProviderSchema = z.object({
  personName: z.string().min(1),
  commissionType: z.enum(['pct', 'fix']),
  commissionValue: z.number().nonnegative(),
});

export const ProductSchema = z.object({
  name: z.string().min(1).max(140),
  type: z.string().min(1).max(60).default('SaaS'),
  codeSuffix: z.string().regex(/^\d{1,2}$/).default('0'),
  areaId: uuid,
  openPrice: z.boolean().default(false),
  setupBrl: money.default(0),
  hasMonthly: z.boolean().default(false),
  monthlyBrl: money.default(0),
  recurringCommission: z.boolean().default(false),
  hasFinderCommission: z.boolean().default(false),
  sellerCommissionType: z.enum(['pct', 'fix']).default('pct'),
  sellerCommissionValue: z.number().nonnegative().default(10),
  sellerWithFinderCommissionType: z.enum(['pct', 'fix']).optional(),
  sellerWithFinderCommissionValue: z.number().nonnegative().optional(),
  finderCommissionType: z.enum(['pct', 'fix']).default('pct'),
  finderCommissionValue: z.number().nonnegative().default(3),
  modules: z.array(ProductModuleSchema).default([]),
  providers: z.array(ProductProviderSchema).default([]),
  status: z.enum(['active', 'archived']).default('active'),
});

export const ClientSchema = z.object({
  name: z.string().min(1).max(160),
  contact: z.string().max(200).nullish(),
  legalName: z.string().max(200).nullish(),
  document: z.string().max(32).nullish(),
  address: z.string().max(400).nullish(),
  legalRepName: z.string().max(200).nullish(),
  legalRepDocument: z.string().max(32).nullish(),
});

export const AreaSchema = z.object({
  name: z.string().trim().min(1).max(120),
  status: z.enum(['active', 'archived']).default('active'),
});
export const UpdateAreaSchema = AreaSchema.partial();
export type AreaInput = z.infer<typeof AreaSchema>;

export const SettingsSchema = z.object({
  legalName: z.string().default(''),
  document: z.string().default(''),
  phone: z.string().default(''),
  financeEmail: z.string().email().optional().or(z.literal('')).default(''),
  defaultSellerCommissionPct: pct.default(10),
  defaultFinderCommissionPct: pct.default(3),
  defaultTaxPct: pct.default(6),
  currency: z.string().default('BRL'),
  taxRegime: z.string().default('Simples Nacional'),
  periodClosingDay: z.number().int().min(1).max(31).default(1),
  tableDensity: z.enum(['comfortable', 'compact']).default('comfortable'),
  dateFormat: z.string().default('dd/mm/aaaa'),
  language: z.string().default('pt-BR'),
  commissionOnRecurring: z.boolean().default(true),
  sellerCanBeFinder: z.boolean().default(true),
});

const MethodSchema = z.enum(['pix', 'card', 'boleto', 'transfer']);

export const SaleInstallmentSchema = z.object({
  dueDate: isoDate,
  amountBrl: money,
  method: MethodSchema,
});

export const SaleRecurringSchema = z.object({
  monthlyBrl: z.number().int().positive(),
  startDate: isoDate,
  cycles: z.number().int().min(1).max(120).nullable(),
  method: MethodSchema.default('pix'),
});

export const SaleItemSchema = z
  .object({
    productId: uuid.optional(),
    productName: z.string().trim().min(1).max(140),
    areaId: uuid.optional(),
    quantity: z.number().int().positive(),
    unitBrl: money,
  })
  .superRefine((item, ctx) => {
    if (!item.productId && !item.areaId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['areaId'],
        message: 'areaId is required when productId is absent',
      });
    }
  });

export const SaleProfessionalSchema = z.object({
  personId: uuid.optional(),
  personName: z.string().min(1),
  role: z.string().min(1),
  costBrl: money,
});

function validatePaymentPlan(
  data: {
    items: Array<{ quantity: number; unitBrl: number }>;
    installments: Array<{ amountBrl: number }>;
  },
  ctx: z.RefinementCtx,
) {
  const itemsTotalBrl = data.items.reduce((sum, item) => sum + item.quantity * item.unitBrl, 0);
  const planTotalBrl = data.installments.reduce((sum, row) => sum + row.amountBrl, 0);
  if (planTotalBrl !== itemsTotalBrl) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['installments'],
      message: `installments_sum_mismatch: expected ${itemsTotalBrl}, got ${planTotalBrl}`,
    });
  }
}

const SaleWriteBaseSchema = z.object({
  clientId: uuid.optional(),
  clientName: z.string().min(1),
  sellerPersonId: uuid.optional(),
  sellerName: z.string().min(1),
  finderPersonId: uuid.optional(),
  finderName: z.string().optional().nullable(),
  status: z.enum(['draft', 'open', 'won']),
  baseDate: isoDate,
  notes: z.string().optional().nullable(),
  sellerCommissionPct: pct.default(10),
  finderCommissionPct: pct.default(3),
  taxPct: pct.default(6),
  otherCostsBrl: money.default(0),
  items: z.array(SaleItemSchema).min(1),
  professionals: z.array(SaleProfessionalSchema).default([]),
  installments: z.array(SaleInstallmentSchema).min(1).max(120),
  recurring: SaleRecurringSchema.nullish(),
});

export const CreateSaleSchema = SaleWriteBaseSchema.superRefine(validatePaymentPlan);

export const UpdateSaleSchema = SaleWriteBaseSchema.extend({
  status: z.enum(['draft', 'open']),
}).superRefine(validatePaymentPlan);

export const SaleTransitionSchema = z.object({
  status: z.enum(['open', 'won', 'lost', 'cancelled']),
});

export const CancelContractSchema = z.object({
  effectiveDate: isoDate.optional(),
});

export type CreateSaleInput = z.infer<typeof CreateSaleSchema>;
export type UpdateSaleInput = z.infer<typeof UpdateSaleSchema>;
export type ProductInput = z.infer<typeof ProductSchema>;
export type ClientInput = z.infer<typeof ClientSchema>;
export type PersonInput = z.infer<typeof PersonSchema>;
export type SettingsInput = z.infer<typeof SettingsSchema>;

type SaleSummaryRow = {
  id: string;
  code: string;
  clientNameSnapshot: string;
  sellerNameSnapshot: string;
  finderNameSnapshot: string | null;
  status: string;
  totalBrl: number;
  recurringBrl: number;
  baseDate: Date | string;
  createdAt?: Date | string;
};

type ProductSummaryRow = { id: string; name: string; type?: string };
type PayableSummaryRow = { amountBrl: number; status: string };

export type SalesOpsSnapshot = {
  sales: SaleSummaryRow[];
  products: ProductSummaryRow[];
  clients: unknown[];
  people: unknown[];
  payables: PayableSummaryRow[];
  saleItems?: Array<{ saleId: string; productNameSnapshot: string; subtotalBrl: number }>;
  receivables?: unknown[];
  saleProfessionals?: unknown[];
};

function asDateOnly(value: string | Date): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value.slice(0, 10);
}

function dateFromIsoDay(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function addMonths(value: string, months: number): string {
  const [yearRaw, monthRaw, dayRaw] = value.split('-').map(Number);
  const year = yearRaw ?? 1970;
  const month = (monthRaw ?? 1) - 1;
  const day = dayRaw ?? 1;
  const target = new Date(Date.UTC(year, month + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString().slice(0, 10);
}

function pctOf(amount: number, rate: number): number {
  return Math.floor((amount * rate) / 100);
}

export class SaleInputError extends Error {
  constructor(
    readonly code: 'product_not_found' | 'product_area_missing' | 'area_not_found',
    readonly itemIndex: number,
  ) {
    super(code);
    this.name = 'SaleInputError';
  }
}

export type ResolvedItemContext = {
  areaId: string;
  areaNameSnapshot: string;
  productTypeSnapshot: string;
};

async function resolveSaleItemContexts(
  tx: Db,
  orgId: string,
  items: CreateSaleInput['items'],
): Promise<ResolvedItemContext[]> {
  const productIds = [
    ...new Set(items.map((item) => item.productId).filter((id): id is string => Boolean(id))),
  ];
  const products = productIds.length
    ? await tx
        .select({
          id: salesOpsProducts.id,
          type: salesOpsProducts.type,
          areaId: salesOpsProducts.areaId,
        })
        .from(salesOpsProducts)
        .where(and(eq(salesOpsProducts.orgId, orgId), inArray(salesOpsProducts.id, productIds)))
    : [];
  const productsById = new Map(products.map((product) => [product.id, product]));

  const areaIds = new Set<string>();
  for (const product of products) {
    if (product.areaId) areaIds.add(product.areaId);
  }
  for (const item of items) {
    if (!item.productId && item.areaId) areaIds.add(item.areaId);
  }
  const areaIdList = [...areaIds];
  const areas = areaIdList.length
    ? await tx
        .select({ id: salesOpsAreas.id, name: salesOpsAreas.name })
        .from(salesOpsAreas)
        .where(and(eq(salesOpsAreas.orgId, orgId), inArray(salesOpsAreas.id, areaIdList)))
    : [];
  const areasById = new Map(areas.map((area) => [area.id, area]));

  return items.map((item, index) => {
    if (item.productId) {
      const product = productsById.get(item.productId);
      if (!product) throw new SaleInputError('product_not_found', index);
      if (!product.areaId) throw new SaleInputError('product_area_missing', index);
      const area = areasById.get(product.areaId);
      if (!area) throw new SaleInputError('area_not_found', index);
      return { areaId: area.id, areaNameSnapshot: area.name, productTypeSnapshot: product.type };
    }
    const area = item.areaId ? areasById.get(item.areaId) : undefined;
    if (!area) throw new SaleInputError('area_not_found', index);
    return { areaId: area.id, areaNameSnapshot: area.name, productTypeSnapshot: '' };
  });
}

export type ReceivableDraft = {
  label: string;
  dueDate: string;
  amountBrl: number;
  method: 'pix' | 'card' | 'boleto' | 'transfer';
  status: 'open';
};

export function buildSaleLedger(input: CreateSaleInput, itemContexts: ResolvedItemContext[]) {
  if (itemContexts.length !== input.items.length) {
    throw new Error('item_context_mismatch');
  }

  const itemsTotalBrl = input.items.reduce((sum, item) => sum + item.quantity * item.unitBrl, 0);

  const keptInstallments = input.installments.filter((row) => row.amountBrl > 0);
  const receivables: ReceivableDraft[] = keptInstallments.map((row, index) => ({
    label: `${index + 1}/${keptInstallments.length}`,
    dueDate: row.dueDate,
    amountBrl: row.amountBrl,
    method: row.method,
    status: 'open',
  }));

  const recurring = input.recurring ?? null;
  if (recurring && recurring.cycles !== null) {
    for (let i = 0; i < recurring.cycles; i++) {
      receivables.push({
        label: `M${i + 1}/${recurring.cycles}`,
        dueDate: addMonths(recurring.startDate, i),
        amountBrl: recurring.monthlyBrl,
        method: recurring.method,
        status: 'open',
      });
    }
  }

  const boundedRecurringBrl =
    recurring && recurring.cycles !== null ? recurring.monthlyBrl * recurring.cycles : 0;
  const totalBrl = itemsTotalBrl + boundedRecurringBrl;
  const recurringBrl = recurring ? recurring.monthlyBrl : 0;

  const sellerCommissionBrl = receivables.reduce(
    (sum, row) => sum + pctOf(row.amountBrl, input.sellerCommissionPct),
    0,
  );
  const finderCommissionBrl = input.finderPersonId
    ? receivables.reduce((sum, row) => sum + pctOf(row.amountBrl, input.finderCommissionPct), 0)
    : 0;
  const taxBrl = receivables.reduce((sum, row) => sum + pctOf(row.amountBrl, input.taxPct), 0);
  const professionalCostsBrl = input.professionals.reduce(
    (sum, professional) => sum + professional.costBrl,
    0,
  );
  const netMarginBrl =
    totalBrl -
    sellerCommissionBrl -
    finderCommissionBrl -
    professionalCostsBrl -
    input.otherCostsBrl -
    taxBrl;
  const netMarginPct = totalBrl > 0 ? ((netMarginBrl / totalBrl) * 100).toFixed(2) : '0.00';

  const paymentMethod = input.installments[0]!.method;
  const condition = input.recurring
    ? 'recurring'
    : input.installments.length === 1
      ? 'cash'
      : 'installments';
  const installmentsColumn = input.installments.length;

  return {
    sale: {
      clientId: input.clientId,
      clientNameSnapshot: input.clientName,
      sellerPersonId: input.sellerPersonId,
      sellerNameSnapshot: input.sellerName,
      finderPersonId: input.finderPersonId,
      finderNameSnapshot: input.finderName ?? null,
      status: input.status,
      paymentMethod,
      condition,
      installments: installmentsColumn,
      baseDate: input.baseDate,
      notes: input.notes ?? null,
      totalBrl,
      recurringBrl,
      sellerCommissionPct: input.sellerCommissionPct.toFixed(2),
      finderCommissionPct: input.finderCommissionPct.toFixed(2),
      taxPct: input.taxPct.toFixed(2),
      otherCostsBrl: input.otherCostsBrl,
      professionalCostsBrl,
      sellerCommissionBrl,
      finderCommissionBrl,
      taxBrl,
      netMarginBrl,
      netMarginPct,
    },
    items: input.items.map((item, index) => ({
      productId: item.productId,
      productNameSnapshot: item.productName,
      productTypeSnapshot: itemContexts[index]!.productTypeSnapshot,
      areaId: itemContexts[index]!.areaId,
      areaNameSnapshot: itemContexts[index]!.areaNameSnapshot,
      quantity: item.quantity,
      unitBrl: item.unitBrl,
      subtotalBrl: item.quantity * item.unitBrl,
    })),
    professionals: input.professionals.map((professional) => ({
      personId: professional.personId,
      personNameSnapshot: professional.personName,
      role: professional.role,
      costBrl: professional.costBrl,
    })),
    receivables,
  };
}

export type SaleLedger = ReturnType<typeof buildSaleLedger>;

export type PayableKind =
  | 'seller_commission'
  | 'finder_commission'
  | 'professional_cost'
  | 'tax'
  | 'other_cost';

export type PayableDraft = {
  beneficiaryName: string;
  kind: PayableKind;
  dueDate: string;
  amountBrl: number;
  status: 'open';
  receivableId: string | null;
};

export type ExistingPayableRef = {
  kind: PayableKind;
  receivableId: string | null;
  status: string;
};

export type MaterializeWonPayablesInput = {
  sale: {
    sellerName: string;
    finderName: string | null;
    hasFinder: boolean;
    sellerCommissionPct: number;
    finderCommissionPct: number;
    taxPct: number;
    otherCostsBrl: number;
  };
  professionals: Array<{ personName: string; costBrl: number }>;
  receivables: Array<{ id: string; dueDate: string; amountBrl: number; status: string }>;
  existingPayables?: ExistingPayableRef[];
  wonDate: string;
};

export function materializeWonPayables(input: MaterializeWonPayablesInput): PayableDraft[] {
  const existingPayables = input.existingPayables ?? [];
  const alreadyExists = (kind: PayableKind, receivableId: string | null) =>
    existingPayables.some(
      (payable) =>
        payable.kind === kind &&
        payable.receivableId === receivableId &&
        payable.status !== 'void',
    );

  const drafts: PayableDraft[] = [];

  for (const row of input.receivables) {
    if (row.status === 'void') continue;

    const sellerAmountBrl = pctOf(row.amountBrl, input.sale.sellerCommissionPct);
    if (sellerAmountBrl > 0 && !alreadyExists('seller_commission', row.id)) {
      drafts.push({
        beneficiaryName: input.sale.sellerName,
        kind: 'seller_commission',
        dueDate: row.dueDate,
        amountBrl: sellerAmountBrl,
        status: 'open',
        receivableId: row.id,
      });
    }

    if (input.sale.hasFinder) {
      const finderAmountBrl = pctOf(row.amountBrl, input.sale.finderCommissionPct);
      if (finderAmountBrl > 0 && !alreadyExists('finder_commission', row.id)) {
        drafts.push({
          beneficiaryName: input.sale.finderName ?? 'Finder',
          kind: 'finder_commission',
          dueDate: row.dueDate,
          amountBrl: finderAmountBrl,
          status: 'open',
          receivableId: row.id,
        });
      }
    }

    const taxAmountBrl = pctOf(row.amountBrl, input.sale.taxPct);
    if (taxAmountBrl > 0 && !alreadyExists('tax', row.id)) {
      drafts.push({
        beneficiaryName: 'Impostos',
        kind: 'tax',
        dueDate: row.dueDate,
        amountBrl: taxAmountBrl,
        status: 'open',
        receivableId: row.id,
      });
    }
  }

  for (const professional of input.professionals) {
    if (professional.costBrl > 0 && !alreadyExists('professional_cost', null)) {
      drafts.push({
        beneficiaryName: professional.personName,
        kind: 'professional_cost',
        dueDate: input.wonDate,
        amountBrl: professional.costBrl,
        status: 'open',
        receivableId: null,
      });
    }
  }

  if (input.sale.otherCostsBrl > 0 && !alreadyExists('other_cost', null)) {
    drafts.push({
      beneficiaryName: 'Outros custos',
      kind: 'other_cost',
      dueDate: input.wonDate,
      amountBrl: input.sale.otherCostsBrl,
      status: 'open',
      receivableId: null,
    });
  }

  return drafts;
}

export function summarizeSalesOpsState(snapshot: SalesOpsSnapshot) {
  const closedStatuses = new Set(['won']);
  const activeSales = snapshot.sales.filter((sale) => sale.status !== 'cancelled');
  const closedSales = activeSales.filter((sale) => closedStatuses.has(sale.status));
  const payableBrl = snapshot.payables
    .filter((payable) => payable.status === 'open')
    .reduce((sum, payable) => sum + payable.amountBrl, 0);
  const revenueByProduct = new Map<string, number>();

  for (const item of snapshot.saleItems ?? []) {
    revenueByProduct.set(
      item.productNameSnapshot,
      (revenueByProduct.get(item.productNameSnapshot) ?? 0) + item.subtotalBrl,
    );
  }

  const latestSales = [...activeSales]
    .sort((a, b) => {
      const aDate = new Date(a.createdAt ?? a.baseDate).getTime();
      const bDate = new Date(b.createdAt ?? b.baseDate).getTime();
      return bDate - aDate;
    })
    .slice(0, 6);

  return {
    kpis: {
      closedRevenueBrl: closedSales.reduce((sum, sale) => sum + sale.totalBrl, 0),
      activeMrrBrl: activeSales.reduce((sum, sale) => sum + sale.recurringBrl, 0),
      payableBrl,
      closedSalesCount: closedSales.length,
    },
    latestSales,
    revenueByProduct: [...revenueByProduct.entries()]
      .map(([name, amountBrl]) => ({ name, amountBrl }))
      .sort((a, b) => b.amountBrl - a.amountBrl),
    counts: {
      products: snapshot.products.length,
      clients: snapshot.clients.length,
      people: snapshot.people.length,
      sales: activeSales.length,
    },
  };
}

async function withTenant<T>(db: Db, orgId: string, fn: (tx: Db) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await setTenantContext(tx as unknown as Tx, orgId);
    return fn(tx as unknown as Db);
  });
}

export async function listPeople(db: Db, orgId: string) {
  return withTenant(db, orgId, (tx) =>
    tx
      .select()
      .from(salesOpsPeople)
      .where(eq(salesOpsPeople.orgId, orgId))
      .orderBy(salesOpsPeople.displayName),
  );
}

export async function createPerson(db: Db, orgId: string, data: PersonInput) {
  return withTenant(db, orgId, async (tx) => {
    const [person] = await tx
      .insert(salesOpsPeople)
      .values({ ...data, orgId, contactEmail: data.contactEmail || null })
      .returning();
    return person!;
  });
}

export async function updatePerson(db: Db, orgId: string, id: string, data: Partial<PersonInput>) {
  return withTenant(db, orgId, async (tx) => {
    const [person] = await tx
      .update(salesOpsPeople)
      .set({ ...data, contactEmail: data.contactEmail || null, updatedAt: new Date() })
      .where(and(eq(salesOpsPeople.orgId, orgId), eq(salesOpsPeople.id, id)))
      .returning();
    return person ?? null;
  });
}

export async function listProducts(db: Db, orgId: string) {
  return withTenant(db, orgId, (tx) =>
    tx
      .select()
      .from(salesOpsProducts)
      .where(eq(salesOpsProducts.orgId, orgId))
      .orderBy(salesOpsProducts.name),
  );
}

export async function createProduct(db: Db, orgId: string, data: ProductInput) {
  return withTenant(db, orgId, async (tx) => {
    const [product] = await tx
      .insert(salesOpsProducts)
      .values({
        ...data,
        orgId,
        sellerCommissionValue: String(data.sellerCommissionValue),
        sellerWithFinderCommissionType:
          data.sellerWithFinderCommissionType ?? data.sellerCommissionType,
        sellerWithFinderCommissionValue: String(
          data.sellerWithFinderCommissionValue ?? data.sellerCommissionValue,
        ),
        finderCommissionValue: String(data.finderCommissionValue),
      })
      .returning();
    return product!;
  });
}

export async function updateProduct(
  db: Db,
  orgId: string,
  id: string,
  data: Partial<ProductInput>,
) {
  return withTenant(db, orgId, async (tx) => {
    const {
      sellerCommissionValue,
      sellerWithFinderCommissionValue,
      finderCommissionValue,
      ...rest
    } = data;
    const patch: Partial<typeof salesOpsProducts.$inferInsert> = {
      ...rest,
      ...(sellerCommissionValue !== undefined
        ? { sellerCommissionValue: String(sellerCommissionValue) }
        : {}),
      ...(sellerWithFinderCommissionValue !== undefined
        ? { sellerWithFinderCommissionValue: String(sellerWithFinderCommissionValue) }
        : {}),
      ...(finderCommissionValue !== undefined
        ? { finderCommissionValue: String(finderCommissionValue) }
        : {}),
      updatedAt: new Date(),
    };
    const [product] = await tx
      .update(salesOpsProducts)
      .set(patch)
      .where(and(eq(salesOpsProducts.orgId, orgId), eq(salesOpsProducts.id, id)))
      .returning();
    return product ?? null;
  });
}

export async function listClients(db: Db, orgId: string) {
  return withTenant(db, orgId, (tx) =>
    tx
      .select()
      .from(salesOpsClients)
      .where(eq(salesOpsClients.orgId, orgId))
      .orderBy(salesOpsClients.name),
  );
}

function clearableText(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  return value || null;
}

export async function createClient(db: Db, orgId: string, data: ClientInput) {
  return withTenant(db, orgId, async (tx) => {
    const [client] = await tx
      .insert(salesOpsClients)
      .values({
        orgId,
        name: data.name,
        contact: data.contact || null,
        legalName: data.legalName || null,
        document: data.document || null,
        address: data.address || null,
        legalRepName: data.legalRepName || null,
        legalRepDocument: data.legalRepDocument || null,
      })
      .returning();
    return client!;
  });
}

export async function updateClient(db: Db, orgId: string, id: string, data: Partial<ClientInput>) {
  return withTenant(db, orgId, async (tx) => {
    const [client] = await tx
      .update(salesOpsClients)
      .set({
        ...(data.name !== undefined ? { name: data.name } : {}),
        contact: clearableText(data.contact),
        legalName: clearableText(data.legalName),
        document: clearableText(data.document),
        address: clearableText(data.address),
        legalRepName: clearableText(data.legalRepName),
        legalRepDocument: clearableText(data.legalRepDocument),
        updatedAt: new Date(),
      })
      .where(and(eq(salesOpsClients.orgId, orgId), eq(salesOpsClients.id, id)))
      .returning();
    return client ?? null;
  });
}

export async function listAreas(db: Db, orgId: string) {
  return withTenant(db, orgId, (tx) =>
    tx
      .select()
      .from(salesOpsAreas)
      .where(eq(salesOpsAreas.orgId, orgId))
      .orderBy(salesOpsAreas.name),
  );
}

export async function getArea(db: Db, orgId: string, id: string) {
  return withTenant(db, orgId, async (tx) => {
    const [area] = await tx
      .select()
      .from(salesOpsAreas)
      .where(and(eq(salesOpsAreas.orgId, orgId), eq(salesOpsAreas.id, id)))
      .limit(1);
    return area ?? null;
  });
}

export async function createArea(db: Db, orgId: string, data: AreaInput) {
  return withTenant(db, orgId, async (tx) => {
    const [existing] = await tx
      .select({ id: salesOpsAreas.id })
      .from(salesOpsAreas)
      .where(and(eq(salesOpsAreas.orgId, orgId), eq(salesOpsAreas.name, data.name)))
      .limit(1);
    if (existing) return 'duplicate' as const;
    const [area] = await tx.insert(salesOpsAreas).values({ ...data, orgId }).returning();
    return area!;
  });
}

export async function updateArea(db: Db, orgId: string, id: string, data: Partial<AreaInput>) {
  return withTenant(db, orgId, async (tx) => {
    if (data.name !== undefined) {
      const [existing] = await tx
        .select({ id: salesOpsAreas.id })
        .from(salesOpsAreas)
        .where(
          and(
            eq(salesOpsAreas.orgId, orgId),
            eq(salesOpsAreas.name, data.name),
            ne(salesOpsAreas.id, id),
          ),
        )
        .limit(1);
      if (existing) return 'duplicate' as const;
    }
    const [area] = await tx
      .update(salesOpsAreas)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(salesOpsAreas.orgId, orgId), eq(salesOpsAreas.id, id)))
      .returning();
    return area ?? null;
  });
}

export async function upsertSettings(db: Db, orgId: string, data: SettingsInput) {
  return withTenant(db, orgId, async (tx) => {
    const [settings] = await tx
      .insert(salesOpsSettings)
      .values({
        ...data,
        orgId,
        defaultSellerCommissionPct: String(data.defaultSellerCommissionPct),
        defaultFinderCommissionPct: String(data.defaultFinderCommissionPct),
        defaultTaxPct: String(data.defaultTaxPct),
      })
      .onConflictDoUpdate({
        target: salesOpsSettings.orgId,
        set: {
          ...data,
          defaultSellerCommissionPct: String(data.defaultSellerCommissionPct),
          defaultFinderCommissionPct: String(data.defaultFinderCommissionPct),
          defaultTaxPct: String(data.defaultTaxPct),
          updatedAt: new Date(),
        },
      })
      .returning();
    return settings!;
  });
}

export async function getSettings(db: Db, orgId: string) {
  return withTenant(db, orgId, async (tx) => {
    const [settings] = await tx
      .select()
      .from(salesOpsSettings)
      .where(eq(salesOpsSettings.orgId, orgId))
      .limit(1);
    return settings ?? null;
  });
}

export async function createSale(
  db: Db,
  orgId: string,
  input: CreateSaleInput,
  now: Date = new Date(),
): Promise<{ sale: typeof salesOpsSales.$inferSelect; ledger: SaleLedger; payables: PayableDraft[] }> {
  return withTenant(db, orgId, async (tx) => {
    const itemContexts = await resolveSaleItemContexts(tx, orgId, input.items);
    const ledger = buildSaleLedger(input, itemContexts);

    const sequenceRows = await tx
      .select({ nextSequence: sql<number>`COALESCE(MAX(${salesOpsSales.sequence}), 0) + 1` })
      .from(salesOpsSales)
      .where(eq(salesOpsSales.orgId, orgId));
    const nextSequence = sequenceRows[0]?.nextSequence ?? 1;
    const firstProductId = input.items[0]?.productId;
    const [productCode] = firstProductId
      ? await tx
          .select({ codeSuffix: salesOpsProducts.codeSuffix })
          .from(salesOpsProducts)
          .where(and(eq(salesOpsProducts.orgId, orgId), eq(salesOpsProducts.id, firstProductId)))
          .limit(1)
      : [];
    const codeSuffix = productCode?.codeSuffix ?? '0';
    const code = `${String(nextSequence).padStart(4, '0')}-${codeSuffix}`;
    const [sale] = await tx
      .insert(salesOpsSales)
      .values({
        ...ledger.sale,
        orgId,
        sequence: nextSequence,
        code,
        clientId: ledger.sale.clientId ?? null,
        sellerPersonId: ledger.sale.sellerPersonId ?? null,
        finderPersonId: ledger.sale.finderPersonId ?? null,
        baseDate: dateFromIsoDay(ledger.sale.baseDate),
        netMarginPct: ledger.sale.netMarginPct,
        wonAt: input.status === 'won' ? now : null,
      })
      .returning();
    if (!sale) throw new Error('sale_insert_failed');

    if (ledger.items.length > 0) {
      await tx.insert(salesOpsSaleItems).values(
        ledger.items.map((item) => ({
          ...item,
          orgId,
          saleId: sale.id,
          productId: item.productId ?? null,
        })),
      );
    }
    if (ledger.professionals.length > 0) {
      await tx.insert(salesOpsSaleProfessionals).values(
        ledger.professionals.map((professional) => ({
          ...professional,
          orgId,
          saleId: sale.id,
          personId: professional.personId ?? null,
        })),
      );
    }

    let insertedReceivables: Array<{
      id: string;
      dueDate: Date;
      amountBrl: number;
      status: string;
    }> = [];
    if (ledger.receivables.length > 0) {
      insertedReceivables = await tx
        .insert(salesOpsReceivables)
        .values(
          ledger.receivables.map((receivable) => ({
            ...receivable,
            orgId,
            saleId: sale.id,
            dueDate: dateFromIsoDay(receivable.dueDate),
          })),
        )
        .returning({
          id: salesOpsReceivables.id,
          dueDate: salesOpsReceivables.dueDate,
          amountBrl: salesOpsReceivables.amountBrl,
          status: salesOpsReceivables.status,
        });
    }

    let payables: PayableDraft[] = [];
    if (input.status === 'won') {
      payables = materializeWonPayables({
        sale: {
          sellerName: input.sellerName,
          finderName: input.finderName ?? null,
          hasFinder: input.finderPersonId != null,
          sellerCommissionPct: input.sellerCommissionPct,
          finderCommissionPct: input.finderCommissionPct,
          taxPct: input.taxPct,
          otherCostsBrl: input.otherCostsBrl,
        },
        professionals: input.professionals.map((p) => ({
          personName: p.personName,
          costBrl: p.costBrl,
        })),
        receivables: insertedReceivables.map((r) => ({
          id: r.id,
          dueDate: asDateOnly(r.dueDate),
          amountBrl: r.amountBrl,
          status: r.status,
        })),
        wonDate: asDateOnly(now),
      });
      if (payables.length > 0) {
        await tx.insert(salesOpsPayables).values(
          payables.map((payable) => ({
            ...payable,
            orgId,
            saleId: sale.id,
            dueDate: dateFromIsoDay(payable.dueDate),
          })),
        );
      }
    }

    return { sale, ledger, payables };
  });
}

export type UpdateSaleResult =
  | { ok: true; sale: typeof salesOpsSales.$inferSelect; ledger: SaleLedger }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'not_editable'; status: string };

export async function updateSale(
  db: Db,
  orgId: string,
  saleId: string,
  input: UpdateSaleInput,
): Promise<UpdateSaleResult> {
  return withTenant(db, orgId, async (tx): Promise<UpdateSaleResult> => {
    const [existing] = await tx
      .select()
      .from(salesOpsSales)
      .where(and(eq(salesOpsSales.orgId, orgId), eq(salesOpsSales.id, saleId)))
      .limit(1);
    if (!existing) return { ok: false, reason: 'not_found' };
    if (existing.status === 'won' || existing.status === 'lost' || existing.status === 'cancelled') {
      return { ok: false, reason: 'not_editable', status: existing.status };
    }

    const itemContexts = await resolveSaleItemContexts(tx, orgId, input.items);
    const ledger = buildSaleLedger(input, itemContexts);

    await tx
      .delete(salesOpsPayables)
      .where(and(eq(salesOpsPayables.orgId, orgId), eq(salesOpsPayables.saleId, saleId)));
    await tx
      .delete(salesOpsReceivables)
      .where(and(eq(salesOpsReceivables.orgId, orgId), eq(salesOpsReceivables.saleId, saleId)));
    await tx
      .delete(salesOpsSaleProfessionals)
      .where(
        and(eq(salesOpsSaleProfessionals.orgId, orgId), eq(salesOpsSaleProfessionals.saleId, saleId)),
      );
    await tx
      .delete(salesOpsSaleItems)
      .where(and(eq(salesOpsSaleItems.orgId, orgId), eq(salesOpsSaleItems.saleId, saleId)));

    const [sale] = await tx
      .update(salesOpsSales)
      .set({
        ...ledger.sale,
        clientId: ledger.sale.clientId ?? null,
        sellerPersonId: ledger.sale.sellerPersonId ?? null,
        finderPersonId: ledger.sale.finderPersonId ?? null,
        baseDate: dateFromIsoDay(ledger.sale.baseDate),
        netMarginPct: ledger.sale.netMarginPct,
        updatedAt: new Date(),
      })
      .where(and(eq(salesOpsSales.orgId, orgId), eq(salesOpsSales.id, saleId)))
      .returning();
    if (!sale) throw new Error('sale_update_failed');

    if (ledger.items.length > 0) {
      await tx.insert(salesOpsSaleItems).values(
        ledger.items.map((item) => ({
          ...item,
          orgId,
          saleId: sale.id,
          productId: item.productId ?? null,
        })),
      );
    }
    if (ledger.professionals.length > 0) {
      await tx.insert(salesOpsSaleProfessionals).values(
        ledger.professionals.map((professional) => ({
          ...professional,
          orgId,
          saleId: sale.id,
          personId: professional.personId ?? null,
        })),
      );
    }
    if (ledger.receivables.length > 0) {
      await tx.insert(salesOpsReceivables).values(
        ledger.receivables.map((receivable) => ({
          ...receivable,
          orgId,
          saleId: sale.id,
          dueDate: dateFromIsoDay(receivable.dueDate),
        })),
      );
    }

    return { ok: true, sale, ledger };
  });
}

export type SaleStatus = 'draft' | 'open' | 'won' | 'lost' | 'cancelled';
export type TransitionTarget = 'open' | 'won' | 'lost' | 'cancelled';

export const SALE_TRANSITIONS: Record<SaleStatus, readonly TransitionTarget[]> = {
  draft: ['open', 'won', 'cancelled'],
  open: ['won', 'lost', 'cancelled'],
  won: ['open'],
  lost: ['open', 'cancelled'],
  cancelled: ['open'],
};

export function canTransition(from: string, to: TransitionTarget): boolean {
  const allowed = SALE_TRANSITIONS[from as SaleStatus];
  return allowed !== undefined && allowed.includes(to);
}

export type TransitionResult =
  | { ok: true; sale: typeof salesOpsSales.$inferSelect }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'invalid_transition'; from: string; to: TransitionTarget };

export async function transitionSale(
  db: Db,
  orgId: string,
  saleId: string,
  to: TransitionTarget,
): Promise<TransitionResult> {
  return withTenant(db, orgId, async (tx): Promise<TransitionResult> => {
    const [sale] = await tx
      .select()
      .from(salesOpsSales)
      .where(and(eq(salesOpsSales.orgId, orgId), eq(salesOpsSales.id, saleId)))
      .for('update')
      .limit(1);
    if (!sale) return { ok: false, reason: 'not_found' };

    if (!canTransition(sale.status, to)) {
      return { ok: false, reason: 'invalid_transition', from: sale.status, to };
    }

    const now = new Date();
    let patch: Partial<typeof salesOpsSales.$inferInsert>;

    if (to === 'won') {
      const receivableRows = await tx
        .select()
        .from(salesOpsReceivables)
        .where(and(eq(salesOpsReceivables.orgId, orgId), eq(salesOpsReceivables.saleId, saleId)))
        .orderBy(salesOpsReceivables.dueDate);
      const professionalRows = await tx
        .select()
        .from(salesOpsSaleProfessionals)
        .where(
          and(
            eq(salesOpsSaleProfessionals.orgId, orgId),
            eq(salesOpsSaleProfessionals.saleId, saleId),
          ),
        );
      const existingPayableRows = await tx
        .select()
        .from(salesOpsPayables)
        .where(and(eq(salesOpsPayables.orgId, orgId), eq(salesOpsPayables.saleId, saleId)));

      const drafts = materializeWonPayables({
        sale: {
          sellerName: sale.sellerNameSnapshot,
          finderName: sale.finderNameSnapshot,
          hasFinder: sale.finderPersonId !== null,
          sellerCommissionPct: Number(sale.sellerCommissionPct),
          finderCommissionPct: Number(sale.finderCommissionPct),
          taxPct: Number(sale.taxPct),
          otherCostsBrl: sale.otherCostsBrl,
        },
        professionals: professionalRows.map((p) => ({
          personName: p.personNameSnapshot,
          costBrl: p.costBrl,
        })),
        receivables: receivableRows.map((r) => ({
          id: r.id,
          dueDate: asDateOnly(r.dueDate),
          amountBrl: r.amountBrl,
          status: r.status,
        })),
        existingPayables: existingPayableRows.map((p) => ({
          kind: p.kind as PayableKind,
          receivableId: p.receivableId,
          status: p.status,
        })),
        wonDate: asDateOnly(now),
      });

      if (drafts.length > 0) {
        await tx.insert(salesOpsPayables).values(
          drafts.map((d) => ({ ...d, dueDate: dateFromIsoDay(d.dueDate), orgId, saleId })),
        );
      }
      patch = { status: 'won', wonAt: now, lostAt: null, updatedAt: now };
    } else if (to === 'open') {
      if (sale.status === 'won') {
        await tx
          .update(salesOpsPayables)
          .set({ status: 'void' })
          .where(
            and(
              eq(salesOpsPayables.orgId, orgId),
              eq(salesOpsPayables.saleId, saleId),
              eq(salesOpsPayables.status, 'open'),
            ),
          );
      }
      patch = { status: 'open', wonAt: null, lostAt: null, updatedAt: now };
    } else if (to === 'lost') {
      patch = { status: 'lost', lostAt: now, updatedAt: now };
    } else {
      patch = { status: 'cancelled', updatedAt: now };
    }

    const [updated] = await tx
      .update(salesOpsSales)
      .set(patch)
      .where(and(eq(salesOpsSales.orgId, orgId), eq(salesOpsSales.id, saleId)))
      .returning();
    return { ok: true, sale: updated! };
  });
}

export type CancelContractResult =
  | { ok: true; sale: typeof salesOpsSales.$inferSelect; voidedReceivables: number; voidedPayables: number }
  | { ok: false; reason: 'not_found' }
  | { ok: false; reason: 'not_cancellable' };

export async function cancelContract(
  db: Db,
  orgId: string,
  saleId: string,
  effectiveDate?: string,
): Promise<CancelContractResult> {
  return withTenant(db, orgId, async (tx): Promise<CancelContractResult> => {
    const [sale] = await tx
      .select()
      .from(salesOpsSales)
      .where(and(eq(salesOpsSales.orgId, orgId), eq(salesOpsSales.id, saleId)))
      .for('update')
      .limit(1);
    if (!sale) return { ok: false, reason: 'not_found' };
    if (sale.status !== 'won') return { ok: false, reason: 'not_cancellable' };

    const effective = effectiveDate ?? new Date().toISOString().slice(0, 10);
    const cutoff = dateFromIsoDay(effective);

    const future = await tx
      .select({ id: salesOpsReceivables.id })
      .from(salesOpsReceivables)
      .where(
        and(
          eq(salesOpsReceivables.orgId, orgId),
          eq(salesOpsReceivables.saleId, saleId),
          eq(salesOpsReceivables.status, 'open'),
          gt(salesOpsReceivables.dueDate, cutoff),
        ),
      );
    const futureIds = future.map((r) => r.id);

    if (sale.recurringBrl <= 0 && futureIds.length === 0) {
      return { ok: false, reason: 'not_cancellable' };
    }

    let voidedReceivables: Array<{ id: string }> = [];
    let voidedPayables: Array<{ id: string }> = [];
    if (futureIds.length > 0) {
      voidedReceivables = await tx
        .update(salesOpsReceivables)
        .set({ status: 'void' })
        .where(and(eq(salesOpsReceivables.orgId, orgId), inArray(salesOpsReceivables.id, futureIds)))
        .returning({ id: salesOpsReceivables.id });
      voidedPayables = await tx
        .update(salesOpsPayables)
        .set({ status: 'void' })
        .where(
          and(
            eq(salesOpsPayables.orgId, orgId),
            eq(salesOpsPayables.saleId, saleId),
            eq(salesOpsPayables.status, 'open'),
            inArray(salesOpsPayables.receivableId, futureIds),
          ),
        )
        .returning({ id: salesOpsPayables.id });
    }

    return {
      ok: true,
      sale,
      voidedReceivables: voidedReceivables.length,
      voidedPayables: voidedPayables.length,
    };
  });
}

export async function listSales(db: Db, orgId: string) {
  return withTenant(db, orgId, (tx) =>
    tx
      .select()
      .from(salesOpsSales)
      .where(eq(salesOpsSales.orgId, orgId))
      .orderBy(desc(salesOpsSales.createdAt)),
  );
}

export async function getSalesOpsSnapshot(db: Db, orgId: string) {
  return withTenant(db, orgId, async (tx) => {
    const sales = await tx
      .select()
      .from(salesOpsSales)
      .where(eq(salesOpsSales.orgId, orgId))
      .orderBy(desc(salesOpsSales.createdAt));
    const products = await tx
      .select()
      .from(salesOpsProducts)
      .where(eq(salesOpsProducts.orgId, orgId))
      .orderBy(salesOpsProducts.name);
    const clients = await tx
      .select()
      .from(salesOpsClients)
      .where(eq(salesOpsClients.orgId, orgId))
      .orderBy(salesOpsClients.name);
    const people = await tx
      .select()
      .from(salesOpsPeople)
      .where(eq(salesOpsPeople.orgId, orgId))
      .orderBy(salesOpsPeople.displayName);
    const payables = await tx.select().from(salesOpsPayables).where(eq(salesOpsPayables.orgId, orgId));
    const saleItems = await tx
      .select()
      .from(salesOpsSaleItems)
      .where(eq(salesOpsSaleItems.orgId, orgId));
    const settings = await tx
      .select()
      .from(salesOpsSettings)
      .where(eq(salesOpsSettings.orgId, orgId))
      .limit(1);
    const areas = await tx
      .select()
      .from(salesOpsAreas)
      .where(eq(salesOpsAreas.orgId, orgId))
      .orderBy(salesOpsAreas.name);
    const receivables = await tx
      .select()
      .from(salesOpsReceivables)
      .where(eq(salesOpsReceivables.orgId, orgId));
    const saleProfessionals = await tx
      .select()
      .from(salesOpsSaleProfessionals)
      .where(eq(salesOpsSaleProfessionals.orgId, orgId));
    return {
      sales,
      products,
      clients,
      people,
      payables,
      saleItems,
      areas,
      receivables,
      saleProfessionals,
      settings: settings[0] ?? null,
    };
  });
}

export async function getSalesOpsSummary(db: Db, orgId: string) {
  const snapshot = await getSalesOpsSnapshot(db, orgId);
  return summarizeSalesOpsState(snapshot);
}

export function serializeSaleForApi(sale: SaleSummaryRow) {
  return { ...sale, baseDate: asDateOnly(sale.baseDate) };
}
