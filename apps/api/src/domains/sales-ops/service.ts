import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { getDb } from '../../db/client.js';
import {
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
  contact: z.string().max(200).optional().or(z.literal('')),
});

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

export const SaleItemSchema = z.object({
  productId: uuid.optional(),
  productName: z.string().trim().min(1).max(140),
  productType: z.string().min(1).default('SaaS'),
  quantity: z.number().int().positive(),
  unitBrl: money,
});

export const SaleProfessionalSchema = z.object({
  personId: uuid.optional(),
  personName: z.string().min(1),
  role: z.string().min(1),
  costBrl: money,
});

export const CreateSaleSchema = z.object({
  clientId: uuid.optional(),
  clientName: z.string().min(1),
  sellerPersonId: uuid.optional(),
  sellerName: z.string().min(1),
  finderPersonId: uuid.optional(),
  finderName: z.string().optional().nullable(),
  status: z.enum(['draft', 'forecast', 'closed', 'in_progress', 'completed', 'cancelled']),
  paymentMethod: z.enum(['pix', 'card', 'boleto', 'transfer']),
  condition: z.enum(['cash', 'installments', 'recurring']),
  installments: z.number().int().min(1).max(120).default(1),
  baseDate: isoDate,
  notes: z.string().optional().nullable(),
  sellerCommissionPct: pct.default(10),
  finderCommissionPct: pct.default(3),
  taxPct: pct.default(6),
  otherCostsBrl: money.default(0),
  items: z.array(SaleItemSchema).min(1),
  professionals: z.array(SaleProfessionalSchema).default([]),
});

export type CreateSaleInput = z.infer<typeof CreateSaleSchema>;
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

function splitAmount(total: number, parts: number): number[] {
  const count = Math.max(1, parts);
  const base = Math.floor(total / count);
  const values = Array.from({ length: count }, () => base);
  values[count - 1] = (values[count - 1] ?? 0) + total - base * count;
  return values;
}

function pctOf(amount: number, rate: number): number {
  return Math.floor((amount * rate) / 100);
}

export function buildSaleLedger(input: CreateSaleInput) {
  const totalBrl = input.items.reduce((sum, item) => sum + item.quantity * item.unitBrl, 0);
  const recurringBrl = input.condition === 'recurring' ? totalBrl : 0;
  const professionalCostsBrl = input.professionals.reduce(
    (sum, professional) => sum + professional.costBrl,
    0,
  );
  const sellerCommissionBrl = pctOf(totalBrl, input.sellerCommissionPct);
  const finderCommissionBrl = input.finderPersonId ? pctOf(totalBrl, input.finderCommissionPct) : 0;
  const taxBrl = pctOf(totalBrl, input.taxPct);
  const netMarginBrl =
    totalBrl -
    sellerCommissionBrl -
    finderCommissionBrl -
    professionalCostsBrl -
    input.otherCostsBrl -
    taxBrl;
  const netMarginPct = totalBrl > 0 ? ((netMarginBrl / totalBrl) * 100).toFixed(2) : '0.00';
  const installmentCount = input.condition === 'cash' ? 1 : input.installments;
  const receivables = splitAmount(totalBrl, installmentCount).map((amountBrl, index) => ({
    label: `${index + 1}/${installmentCount}`,
    dueDate: addMonths(input.baseDate, index),
    amountBrl,
    status: 'open',
  }));

  const payables: Array<{
    beneficiaryName: string;
    kind:
      | 'seller_commission'
      | 'finder_commission'
      | 'professional_cost'
      | 'tax'
      | 'other_cost';
    dueDate: string;
    amountBrl: number;
    status: 'open';
  }> = [
    {
      beneficiaryName: input.sellerName,
      kind: 'seller_commission',
      dueDate: addMonths(input.baseDate, 1),
      amountBrl: sellerCommissionBrl,
      status: 'open',
    },
  ];

  if (input.finderPersonId && finderCommissionBrl > 0) {
    payables.push({
      beneficiaryName: input.finderName ?? 'Finder',
      kind: 'finder_commission',
      dueDate: addMonths(input.baseDate, 1),
      amountBrl: finderCommissionBrl,
      status: 'open',
    });
  }

  for (const professional of input.professionals) {
    if (professional.costBrl > 0) {
      payables.push({
        beneficiaryName: professional.personName,
        kind: 'professional_cost',
        dueDate: input.baseDate,
        amountBrl: professional.costBrl,
        status: 'open',
      });
    }
  }

  if (taxBrl > 0) {
    payables.push({
      beneficiaryName: 'Impostos',
      kind: 'tax',
      dueDate: addMonths(input.baseDate, 1),
      amountBrl: taxBrl,
      status: 'open',
    });
  }

  if (input.otherCostsBrl > 0) {
    payables.push({
      beneficiaryName: 'Outros custos',
      kind: 'other_cost',
      dueDate: input.baseDate,
      amountBrl: input.otherCostsBrl,
      status: 'open',
    });
  }

  return {
    sale: {
      clientId: input.clientId,
      clientNameSnapshot: input.clientName,
      sellerPersonId: input.sellerPersonId,
      sellerNameSnapshot: input.sellerName,
      finderPersonId: input.finderPersonId,
      finderNameSnapshot: input.finderName ?? null,
      status: input.status,
      paymentMethod: input.paymentMethod,
      condition: input.condition,
      installments: installmentCount,
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
    items: input.items.map((item) => ({
      productId: item.productId,
      productNameSnapshot: item.productName,
      productTypeSnapshot: item.productType,
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
    payables,
  };
}

export function summarizeSalesOpsState(snapshot: SalesOpsSnapshot) {
  const closedStatuses = new Set(['closed', 'completed']);
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

export async function createClient(db: Db, orgId: string, data: ClientInput) {
  return withTenant(db, orgId, async (tx) => {
    const [client] = await tx
      .insert(salesOpsClients)
      .values({ ...data, orgId, contact: data.contact || null })
      .returning();
    return client!;
  });
}

export async function updateClient(db: Db, orgId: string, id: string, data: Partial<ClientInput>) {
  return withTenant(db, orgId, async (tx) => {
    const [client] = await tx
      .update(salesOpsClients)
      .set({ ...data, contact: data.contact || null, updatedAt: new Date() })
      .where(and(eq(salesOpsClients.orgId, orgId), eq(salesOpsClients.id, id)))
      .returning();
    return client ?? null;
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

export async function createSale(db: Db, orgId: string, input: CreateSaleInput) {
  const ledger = buildSaleLedger(input);
  return withTenant(db, orgId, async (tx) => {
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
    await tx.insert(salesOpsReceivables).values(
      ledger.receivables.map((receivable) => ({
        ...receivable,
        orgId,
        saleId: sale.id,
        dueDate: dateFromIsoDay(receivable.dueDate),
      })),
    );
    if (ledger.payables.length > 0) {
      await tx.insert(salesOpsPayables).values(
        ledger.payables.map((payable) => ({
          ...payable,
          orgId,
          saleId: sale.id,
          dueDate: dateFromIsoDay(payable.dueDate),
        })),
      );
    }
    return { sale, ledger };
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
    return { sales, products, clients, people, payables, saleItems, settings: settings[0] ?? null };
  });
}

export async function getSalesOpsSummary(db: Db, orgId: string) {
  const snapshot = await getSalesOpsSnapshot(db, orgId);
  return summarizeSalesOpsState(snapshot);
}

export function serializeSaleForApi(sale: SaleSummaryRow) {
  return { ...sale, baseDate: asDateOnly(sale.baseDate) };
}
