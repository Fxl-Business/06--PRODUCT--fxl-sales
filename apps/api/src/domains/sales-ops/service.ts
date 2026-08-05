import {
  computeSaleFinancials,
  isRecurringReceivableLabel,
  pctOfCents,
  resolveProfessionalSplit,
} from '@fxl-sales/shared-utils';
import { and, asc, desc, eq, gt, inArray, ne, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { getDb } from '../../db/client.js';
import {
  salesOpsAreas,
  salesOpsClients,
  salesOpsFuncoes,
  salesOpsPayables,
  salesOpsPeople,
  salesOpsPersonFuncoes,
  salesOpsProductFuncaoCosts,
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
// Declared here rather than beside the sale schemas below because the product
// default-payment block also uses it, and a `const` referenced above its own
// declaration line would hit the temporal dead zone at module evaluation.
const MethodSchema = z.enum(['pix', 'card', 'boleto', 'transfer']);
export type PaymentMethod = z.infer<typeof MethodSchema>;

const PersonFieldsSchema = z.object({
  displayName: z.string().min(1).max(120),
  contactEmail: z.string().email().optional().or(z.literal('')),
  status: z.enum(['active', 'inactive']).default('active'),
  // Forward contract: the assignment set is authoritative when present.
  funcaoIds: z.array(uuid).optional(),
  /** @deprecated compat shim - accepted only while the web build predates slice 09. */
  isSeller: z.boolean().optional(),
  /** @deprecated compat shim - accepted only while the web build predates slice 09. */
  isFinder: z.boolean().optional(),
  /** @deprecated compat shim - accepted only while the web build predates slice 09. */
  isCollaborator: z.boolean().optional(),
});

// The at-least-one-função rule lives in the service (see planPersonFuncoes), not
// in a .refine(), because it now has to consult the caller org's função rows.
export const PersonSchema = PersonFieldsSchema;
export const UpdatePersonSchema = PersonFieldsSchema.partial();

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

/**
 * Produto | Serviço - the single classification axis on a product.
 *
 * Both kinds may carry an own value in setupBrl/monthlyBrl. The difference is what
 * the value MEANS: a Produto's is a catalog price, a Serviço's is a base value the
 * proposta prefills and the operator negotiates. `0` is how a Serviço says it has
 * no base value at all, which is what every pre-0015 Serviço stores.
 */
export const ProductKindSchema = z.enum(['product', 'service']);
export const ProductEntradaModeSchema = z.enum(['none', 'pct', 'fix']);
export type ProductKind = z.infer<typeof ProductKindSchema>;
export type ProductEntradaMode = z.infer<typeof ProductEntradaModeSchema>;

/** One default cost for one função. Discriminated so the units can never be ambiguous. */
export const ProductFuncaoCostSchema = z.discriminatedUnion('mode', [
  z.object({ funcaoId: uuid, mode: z.literal('pct'), valuePct: pct }),
  z.object({ funcaoId: uuid, mode: z.literal('fix'), valueBrl: money }),
]);

/**
 * `kind` wins; `openPrice` is the legacy alias the pre-slice-10 product dialog
 * still sends; `current` is the stored row on PATCH.
 */
export function resolveProductKind(
  data: { kind?: ProductKind; openPrice?: boolean },
  current?: ProductKind,
): ProductKind {
  if (data.kind !== undefined) return data.kind;
  if (data.openPrice !== undefined) return data.openPrice ? 'service' : 'product';
  return current ?? 'product';
}

type ProductFieldsForValidation = {
  kind?: ProductKind;
  openPrice?: boolean;
  defaultEntradaMode?: ProductEntradaMode;
  defaultEntradaPct?: number | null;
  defaultEntradaBrl?: number | null;
  productFuncaoCosts?: Array<{ funcaoId: string }>;
};

/**
 * Partial-tolerant product invariants: every rule is skipped when its inputs are
 * `undefined`, so the same refine serves ProductSchema and UpdateProductSchema.
 * The one rule a partial payload cannot see on its own - the entrada mode/value
 * pairing - is re-run on the merged row in `updateProduct`.
 */
function validateProductFields(data: ProductFieldsForValidation, ctx: z.RefinementCtx): void {
  if (
    data.kind !== undefined &&
    data.openPrice !== undefined &&
    data.openPrice !== (data.kind === 'service')
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['openPrice'],
      message: 'kind_open_price_conflict',
    });
  }

  if (data.defaultEntradaMode !== undefined) {
    const hasPct = data.defaultEntradaPct !== undefined && data.defaultEntradaPct !== null;
    const hasBrl = data.defaultEntradaBrl !== undefined && data.defaultEntradaBrl !== null;
    const valid =
      (data.defaultEntradaMode === 'none' && !hasPct && !hasBrl) ||
      (data.defaultEntradaMode === 'pct' && hasPct && !hasBrl) ||
      (data.defaultEntradaMode === 'fix' && hasBrl && !hasPct);
    if (!valid) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['defaultEntradaMode'],
        message: 'entrada_mode_value_mismatch',
      });
    }
  }

  if (data.productFuncaoCosts !== undefined) {
    const seen = new Set<string>();
    for (const cost of data.productFuncaoCosts) {
      if (seen.has(cost.funcaoId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['productFuncaoCosts'],
          message: 'duplicate_funcao_cost',
        });
        break;
      }
      seen.add(cost.funcaoId);
    }
  }
}

/**
 * Base product fields. Deliberately a plain z.object so `.partial()` stays
 * available for the PATCH schema - mirrors PersonFieldsSchema above.
 */
const ProductFieldsSchema = z.object({
  name: z.string().trim().min(1).max(140),
  kind: ProductKindSchema.optional(),
  /** @deprecated legacy alias for `kind`. Kept so the pre-slice-10 dialog keeps working. */
  openPrice: z.boolean().optional(),
  codeSuffix: z.string().regex(/^\d{1,2}$/).default('0'),
  areaId: uuid,
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
  defaultPaymentMethod: MethodSchema.default('pix'),
  defaultEntradaMode: ProductEntradaModeSchema.default('none'),
  defaultEntradaPct: pct.nullable().optional(),
  defaultEntradaBrl: money.nullable().optional(),
  defaultRemainingInstallments: z.number().int().min(1).max(120).default(1),
  /** null = indefinite recurrence; undefined on PATCH = leave unchanged. */
  defaultRecurringCycles: z.number().int().min(1).max(120).nullable().optional(),
  productFuncaoCosts: z.array(ProductFuncaoCostSchema).optional(),
  modules: z.array(ProductModuleSchema).default([]),
  /** @deprecated superseded by productFuncaoCosts; removed from the dialog in slice 10. */
  providers: z.array(ProductProviderSchema).default([]),
  status: z.enum(['active', 'archived']).default('active'),
});

export const ProductSchema = ProductFieldsSchema.superRefine(validateProductFields);
export const UpdateProductSchema = ProductFieldsSchema.partial().superRefine(validateProductFields);

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

// `slug` and `isSystem` are deliberately absent: the slug is always derived
// server-side from the name, and only migration 0012 (or the on-demand seed
// below) may ever flag a função as a predefined app role.
export const FuncaoSchema = z.object({
  name: z.string().trim().min(1).max(120),
  status: z.enum(['active', 'archived']).default('active'),
});
export const UpdateFuncaoSchema = FuncaoSchema.partial();
export type FuncaoInput = z.infer<typeof FuncaoSchema>;

/** The two predefined app roles. Reserved slugs, immutable through the API. */
export const SYSTEM_FUNCAO_SLUGS = ['vendedor', 'finder'] as const;

/**
 * The three slugs the deprecated boolean payload maps onto, with the seed used
 * when an org does not have the função yet.
 *
 * `prestador` is a compatibility bucket for the existing collaborator picker,
 * not a predefined app role, so it is seeded non-system and an org may rename or
 * archive it. `sales_ops_funcoes_system_slug_check` makes it impossible to flag
 * anything but the two reserved slugs as system.
 */
const LEGACY_FUNCAO_SEEDS = {
  vendedor: { name: 'Vendedor', isSystem: true },
  finder: { name: 'Finder', isSystem: true },
  prestador: { name: 'Prestador', isSystem: false },
} as const;

type LegacyFuncaoSlug = keyof typeof LEGACY_FUNCAO_SEEDS;

/**
 * Derives the stable machine key for a função display name: lowercase, without
 * diacritics, non-alphanumerics collapsed to single dashes, trimmed, capped at
 * the column's 120-char budget.
 */
export function slugifyFuncao(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120)
    .replace(/-+$/g, '');
}

export type PersonFuncaoPlan =
  | { kind: 'ids'; funcaoIds: string[] }
  | { kind: 'slugs'; slugs: LegacyFuncaoSlug[] }
  | { kind: 'unchanged' }
  | 'funcao_required';

/**
 * Decides, without touching the database, which funções a person write intends.
 *
 * Resolution order:
 *  1. `funcaoIds` is authoritative when present; an explicitly empty set is a
 *     rejection, never a silent no-op.
 *  2. Otherwise the deprecated booleans map onto the three legacy slugs.
 *  3. Otherwise a create is rejected and a patch leaves the set untouched.
 */
export function planPersonFuncoes(
  input: Partial<PersonInput>,
  mode: 'create' | 'update',
): PersonFuncaoPlan {
  if (input.funcaoIds !== undefined) {
    if (input.funcaoIds.length === 0) return 'funcao_required';
    return { kind: 'ids', funcaoIds: [...new Set(input.funcaoIds)] };
  }
  const slugs: LegacyFuncaoSlug[] = [];
  if (input.isSeller) slugs.push('vendedor');
  if (input.isFinder) slugs.push('finder');
  if (input.isCollaborator) slugs.push('prestador');
  if (slugs.length > 0) return { kind: 'slugs', slugs };
  return mode === 'create' ? 'funcao_required' : { kind: 'unchanged' };
}

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

/**
 * `funcaoNameSnapshot` is deliberately absent: the snapshot is derived server-side
 * from the resolved cadastro row, so a client can never author the label a
 * proposta stores. `role` stays accepted but optional, which keeps a legacy
 * free-text payload legal while a funcaoId-only payload becomes legal too.
 */
export const SaleProfessionalSchema = z
  .object({
    personId: uuid.optional(),
    personName: z.string().min(1),
    funcaoId: uuid.optional(),
    role: z.string().min(1).optional(),
    costBrl: money,
    /*
      The payment schedule, in BASIS POINTS. `null`/absent means the default
      pro-rata split over the sale's installment receivables; `.min(1)` forbids
      `[]`, because the empty schedule is spelled `null`. `.max(120)` mirrors the
      `installments` cap below, since a part can never usefully outnumber the
      parcelas it binds to.
    */
    costSplitBp: z.array(z.number().int().min(0).max(10_000)).min(1).max(120).nullish(),
  })
  .superRefine((row, ctx) => {
    if (!row.funcaoId && !row.role?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['funcaoId'],
        message: 'funcao_or_role_required',
      });
    }
    if (row.costSplitBp) {
      const total = row.costSplitBp.reduce((sum, part) => sum + part, 0);
      if (total !== 10_000) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['costSplitBp'],
          message: 'cost_split_sum_mismatch',
        });
      }
    }
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
export type ProductFuncaoCostInput = z.infer<typeof ProductFuncaoCostSchema>;
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

type ProductSummaryRow = { id: string; name: string; kind?: string };
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

/**
 * The stored default-payment block, exactly as a product row returns it
 * (`defaultEntradaPct` is a numeric(5,2) and therefore a string).
 */
export type ProductPaymentDefaults = {
  defaultPaymentMethod: PaymentMethod;
  defaultEntradaMode: ProductEntradaMode;
  defaultEntradaPct: string | null;
  defaultEntradaBrl: number | null;
  defaultRemainingInstallments: number;
  defaultRecurringCycles: number | null;
};

/**
 * Turns a product's stored payment TEMPLATE into concrete installments for one
 * proposta. The template deliberately carries no absolute dates, so the base date
 * and the total come from the proposta.
 *
 * This is the normative reference implementation: slice 11 mirrors it in the web
 * `calculations` module, and the unit vectors in default-payment-plan.test.ts pin
 * the arithmetic so the spec cannot silently drift. The split is exact by
 * construction (the first restante parcela absorbs the rounding remainder), which
 * is what `validatePaymentPlan` demands of any plan the write endpoints accept.
 */
export function materializeDefaultPaymentPlan(input: {
  defaults: ProductPaymentDefaults;
  totalBrl: number;
  baseDate: string;
  hasMonthly: boolean;
  monthlyBrl: number;
}): {
  installments: Array<{ dueDate: string; amountBrl: number; method: PaymentMethod }>;
  recurring: { monthlyBrl: number; startDate: string; cycles: number | null } | null;
} {
  const { defaults, totalBrl, baseDate, hasMonthly, monthlyBrl } = input;
  const method = defaults.defaultPaymentMethod;

  const rawEntradaBrl =
    defaults.defaultEntradaMode === 'pct'
      ? Math.round((totalBrl * Number(defaults.defaultEntradaPct ?? 0)) / 100)
      : defaults.defaultEntradaMode === 'fix'
        ? (defaults.defaultEntradaBrl ?? 0)
        : 0;
  // A fixed entrada larger than the proposta total is clamped rather than
  // rejected, so a cadastro default can never make a small proposta unsavable.
  const entradaBrl = Math.min(Math.max(rawEntradaBrl, 0), Math.max(totalBrl, 0));
  const remainingBrl = Math.max(totalBrl, 0) - entradaBrl;
  const parcelas = defaults.defaultRemainingInstallments;

  const installments: Array<{ dueDate: string; amountBrl: number; method: PaymentMethod }> = [];
  if (entradaBrl > 0) installments.push({ dueDate: baseDate, amountBrl: entradaBrl, method });
  if (remainingBrl > 0) {
    const base = Math.floor(remainingBrl / parcelas);
    const rest = remainingBrl - base * parcelas;
    for (let i = 1; i <= parcelas; i += 1) {
      installments.push({
        // With no entrada, parcela 1 lands on the base date, so a 1x plan
        // reproduces today's cash behaviour byte for byte.
        dueDate: addMonths(baseDate, entradaBrl > 0 ? i : i - 1),
        amountBrl: i === 1 ? base + rest : base,
        method,
      });
    }
  }
  // A 100 percent entrada must not produce a trailing 0-cent parcela, but the
  // array still has to satisfy `installments: min(1)`.
  if (installments.length === 0) installments.push({ dueDate: baseDate, amountBrl: 0, method });

  return {
    installments,
    recurring: hasMonthly
      ? {
          monthlyBrl,
          startDate: addMonths(baseDate, 1),
          // null means indefinite: no bounded rows are generated (CLAUDE.md).
          cycles: defaults.defaultRecurringCycles ?? null,
        }
      : null,
  };
}

export class SaleInputError extends Error {
  constructor(
    readonly code:
      | 'product_not_found'
      | 'product_area_missing'
      | 'area_not_found'
      | 'seller_not_found'
      | 'finder_not_found'
      | 'person_not_found'
      | 'funcao_not_found',
    /**
     * The offending `items[]` index, or the offending `professionals[]` index for
     * `person_not_found` / `funcao_not_found`. `-1` means the error is not about
     * an array row at all, which is the case for `seller_not_found` and
     * `finder_not_found`.
     */
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
          kind: salesOpsProducts.kind,
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
      // product_type_snapshot keeps its column name and its meaning ("the
      // product's classification at sale time"); it is now fed from `kind`, so new
      // rows snapshot 'product' or 'service' where they used to snapshot 'SaaS'.
      return { areaId: area.id, areaNameSnapshot: area.name, productTypeSnapshot: product.kind };
    }
    const area = item.areaId ? areasById.get(item.areaId) : undefined;
    if (!area) throw new SaleInputError('area_not_found', index);
    return { areaId: area.id, areaNameSnapshot: area.name, productTypeSnapshot: '' };
  });
}

/**
 * The four ids a sale write accepts that name an org-scoped cadastro row: the
 * vendedor, the finder, and each profissional's pessoa and função.
 *
 * Until this resolver existed they were written straight through as bare uuids
 * with no in-org check, and the single-column FKs to sales_ops_people do NOT
 * consult the RLS predicate, so org A could pin org B's pessoa onto its own
 * proposta. Resolving them here, inside the caller's `withTenant` transaction and
 * always through `and(eq(table.orgId, orgId), inArray(table.id, ids))`, is what
 * makes that impossible; the composite (org_id, funcao_id) FK is the second,
 * database-level defence for the função.
 *
 * The resolved rows are also the ONLY source of the two snapshots the ledger
 * writes, so a body that disagrees with the cadastro loses.
 */
export type ResolvedPartyContexts = {
  people: Map<string, { id: string; displayName: string }>;
  funcoes: Map<string, { id: string; name: string }>;
};

async function resolvePartyContexts(
  tx: Db,
  orgId: string,
  input: Pick<CreateSaleInput, 'sellerPersonId' | 'finderPersonId' | 'professionals'>,
): Promise<ResolvedPartyContexts> {
  const personIds = [
    ...new Set(
      [
        input.sellerPersonId,
        input.finderPersonId,
        ...input.professionals.map((professional) => professional.personId),
      ].filter((id): id is string => Boolean(id)),
    ),
  ];
  const people = personIds.length
    ? await tx
        .select({ id: salesOpsPeople.id, displayName: salesOpsPeople.displayName })
        .from(salesOpsPeople)
        .where(and(eq(salesOpsPeople.orgId, orgId), inArray(salesOpsPeople.id, personIds)))
    : [];
  const peopleById = new Map(people.map((person) => [person.id, person]));

  const funcaoIds = [
    ...new Set(
      input.professionals
        .map((professional) => professional.funcaoId)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const funcoes = funcaoIds.length
    ? await tx
        .select({ id: salesOpsFuncoes.id, name: salesOpsFuncoes.name })
        .from(salesOpsFuncoes)
        .where(and(eq(salesOpsFuncoes.orgId, orgId), inArray(salesOpsFuncoes.id, funcaoIds)))
    : [];
  const funcoesById = new Map(funcoes.map((funcao) => [funcao.id, funcao]));

  if (input.sellerPersonId && !peopleById.has(input.sellerPersonId)) {
    throw new SaleInputError('seller_not_found', -1);
  }
  if (input.finderPersonId && !peopleById.has(input.finderPersonId)) {
    throw new SaleInputError('finder_not_found', -1);
  }
  input.professionals.forEach((professional, index) => {
    if (professional.personId && !peopleById.has(professional.personId)) {
      throw new SaleInputError('person_not_found', index);
    }
    if (professional.funcaoId && !funcoesById.has(professional.funcaoId)) {
      throw new SaleInputError('funcao_not_found', index);
    }
  });

  return { people: peopleById, funcoes: funcoesById };
}

export type ReceivableDraft = {
  label: string;
  dueDate: string;
  amountBrl: number;
  method: 'pix' | 'card' | 'boleto' | 'transfer';
  status: 'open';
};

/** No pessoa and no função resolved: every snapshot falls back to the request body. */
export const EMPTY_PARTY_CONTEXTS: ResolvedPartyContexts = {
  people: new Map(),
  funcoes: new Map(),
};

export function buildSaleLedger(
  input: CreateSaleInput,
  itemContexts: ResolvedItemContext[],
  parties: ResolvedPartyContexts = EMPTY_PARTY_CONTEXTS,
) {
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
  const recurringBrl = recurring ? recurring.monthlyBrl : 0;

  /*
    The receivable rows and their "N/M" / "MN/M" labels are built here and stay
    here; only the money is delegated, to the ONE `computeSaleFinancials` the
    wizard also calls. That is what makes the margin the operator sees in steps 3
    and 4 the same number this function persists.
  */
  const financials = computeSaleFinancials({
    itemsTotalBrl,
    boundedRecurringBrl,
    receivableAmountsBrl: receivables.map((row) => row.amountBrl),
    sellerCommissionPct: input.sellerCommissionPct,
    finderCommissionPct: input.finderCommissionPct,
    hasFinder: Boolean(input.finderPersonId),
    taxPct: input.taxPct,
    otherCostsBrl: input.otherCostsBrl,
    professionalCostsBrl: input.professionals.reduce(
      (sum, professional) => sum + professional.costBrl,
      0,
    ),
  });

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
      recurringBrl,
      sellerCommissionPct: input.sellerCommissionPct.toFixed(2),
      finderCommissionPct: input.finderCommissionPct.toFixed(2),
      taxPct: input.taxPct.toFixed(2),
      ...financials,
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
    professionals: input.professionals.map((professional) => {
      /*
        Server-authoritative snapshots. A resolved cadastro row always wins over
        whatever label the body carried; the body is the fallback only on the
        legacy unregistered path, where there is no id to resolve. `role` is the
        deprecated mirror and is therefore written with exactly the same string as
        `funcaoNameSnapshot`, never independently.
      */
      const person = professional.personId
        ? parties.people.get(professional.personId)
        : undefined;
      const funcao = professional.funcaoId
        ? parties.funcoes.get(professional.funcaoId)
        : undefined;
      const funcaoNameSnapshot = funcao?.name ?? professional.role ?? '';
      return {
        personId: professional.personId,
        personNameSnapshot: person?.displayName ?? professional.personName,
        funcaoId: professional.funcaoId ?? null,
        funcaoNameSnapshot,
        role: funcaoNameSnapshot,
        costBrl: professional.costBrl,
        /*
          NOT a snapshot and NOT server-derived: unlike `personNameSnapshot`,
          this is the operator's own input, so the body wins. It is also
          orthogonal to `costBrl` — that says how much, this says when — which
          is exactly why it is stored in basis points. See CLAUDE.md.
        */
        costSplitBp: professional.costSplitBp ?? null,
      };
    }),
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
  saleProfessionalId: string | null;
};

export type ExistingPayableRef = {
  kind: PayableKind;
  receivableId: string | null;
  status: string;
  beneficiaryName: string;
  amountBrl: number;
  saleProfessionalId: string | null;
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
  professionals: Array<{
    id: string;
    personName: string;
    costBrl: number;
    costSplitBp?: number[] | null;
  }>;
  /*
    `label` is OPTIONAL and absent reads as an installment: the DB column is NOT
    NULL and `buildSaleLedger` always writes one, so only a synthetic test
    fixture can omit it, and treating those as installments is the conservative
    reading.
  */
  receivables: Array<{
    id: string;
    dueDate: string;
    amountBrl: number;
    status: string;
    label?: string;
  }>;
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
  const legacyProfessionalKey = (candidate: {
    beneficiaryName: string;
    receivableId: string | null;
    amountBrl: number;
  }): string => JSON.stringify([candidate.beneficiaryName, candidate.receivableId, candidate.amountBrl]);
  const legacyProfessionalCounts = new Map<string, number>();
  for (const payable of existingPayables) {
    if (
      payable.kind !== 'professional_cost' ||
      payable.status === 'void' ||
      payable.saleProfessionalId !== null
    ) {
      continue;
    }
    const key = legacyProfessionalKey(payable);
    legacyProfessionalCounts.set(key, (legacyProfessionalCounts.get(key) ?? 0) + 1);
  }
  const consumeLegacyProfessional = (candidate: {
    beneficiaryName: string;
    receivableId: string | null;
    amountBrl: number;
  }): boolean => {
    const key = legacyProfessionalKey(candidate);
    const remaining = legacyProfessionalCounts.get(key) ?? 0;
    if (remaining === 0) return false;
    if (remaining === 1) legacyProfessionalCounts.delete(key);
    else legacyProfessionalCounts.set(key, remaining - 1);
    return true;
  };

  const drafts: PayableDraft[] = [];

  for (const row of input.receivables) {
    if (row.status === 'void') continue;

    const sellerAmountBrl = pctOfCents(row.amountBrl, input.sale.sellerCommissionPct);
    if (sellerAmountBrl > 0 && !alreadyExists('seller_commission', row.id)) {
      drafts.push({
        beneficiaryName: input.sale.sellerName,
        kind: 'seller_commission',
        dueDate: row.dueDate,
        amountBrl: sellerAmountBrl,
        status: 'open',
        receivableId: row.id,
        saleProfessionalId: null,
      });
    }

    if (input.sale.hasFinder) {
      const finderAmountBrl = pctOfCents(row.amountBrl, input.sale.finderCommissionPct);
      if (finderAmountBrl > 0 && !alreadyExists('finder_commission', row.id)) {
        drafts.push({
          beneficiaryName: input.sale.finderName ?? 'Finder',
          kind: 'finder_commission',
          dueDate: row.dueDate,
          amountBrl: finderAmountBrl,
          status: 'open',
          receivableId: row.id,
          saleProfessionalId: null,
        });
      }
    }

    const taxAmountBrl = pctOfCents(row.amountBrl, input.sale.taxPct);
    if (taxAmountBrl > 0 && !alreadyExists('tax', row.id)) {
      drafts.push({
        beneficiaryName: 'Impostos',
        kind: 'tax',
        dueDate: row.dueDate,
        amountBrl: taxAmountBrl,
        status: 'open',
        receivableId: row.id,
        saleProfessionalId: null,
      });
    }
  }

  /*
    A professional is paid AS THE CLIENT PAYS: `professional_cost` is generated
    per INSTALLMENT receivable, like the commissions and the tax, split by the
    stored `costSplitBp` or pro rata by default. Recurring (`M`-prefixed) rows
    are deliberately excluded — an indefinite recorrência generates no bounded
    rows at all, and spreading a pay-once cost over 24 cycles would delay a
    professional's pay years past delivery. With NO eligible row the resolver
    returns the legacy one-shot part, which is what keeps a pure-recurring sale
    behaving exactly as before. See CLAUDE.md and 00-OVERVIEW-split.md.
  */
  const splitReceivables = input.receivables
    .filter((row) => row.status !== 'void' && !isRecurringReceivableLabel(row.label))
    .map((row) => ({ id: row.id, dueDate: row.dueDate, amountBrl: row.amountBrl }));

  for (const professional of input.professionals) {
    if (professional.costBrl <= 0) continue;
    const parts = resolveProfessionalSplit({
      costBrl: professional.costBrl,
      costSplitBp: professional.costSplitBp,
      receivables: splitReceivables,
      fallbackDueDate: input.wonDate,
    });
    for (const part of parts) {
      if (part.amountBrl <= 0) continue;
      const candidate = {
        beneficiaryName: professional.personName,
        receivableId: part.receivableId,
        amountBrl: part.amountBrl,
      };
      const identifiedPayableExists = existingPayables.some(
        (payable) =>
          payable.kind === 'professional_cost' &&
          payable.status !== 'void' &&
          payable.saleProfessionalId === professional.id &&
          payable.receivableId === part.receivableId,
      );
      if (identifiedPayableExists) continue;
      if (consumeLegacyProfessional(candidate)) continue;
      drafts.push({
        ...candidate,
        kind: 'professional_cost',
        dueDate: part.dueDate,
        status: 'open',
        saleProfessionalId: professional.id,
      });
    }
  }

  // `other_cost` stays ONE-SHOT on purpose: it names no beneficiary and has no
  // wizard row to hang a schedule on. See CLAUDE.md and Decision 5.
  if (input.sale.otherCostsBrl > 0 && !alreadyExists('other_cost', null)) {
    drafts.push({
      beneficiaryName: 'Outros custos',
      kind: 'other_cost',
      dueDate: input.wonDate,
      amountBrl: input.sale.otherCostsBrl,
      status: 'open',
      receivableId: null,
      saleProfessionalId: null,
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

type PersonRow = typeof salesOpsPeople.$inferSelect;
type FuncaoRow = typeof salesOpsFuncoes.$inferSelect;
type AttachedFuncao = Pick<FuncaoRow, 'id' | 'name' | 'slug' | 'isSystem'>;
export type PersonWithFuncoes = PersonRow & {
  funcaoIds: string[];
  funcoes: AttachedFuncao[];
};

/**
 * Reads the assignment sets for the given people in one grouped query and
 * attaches them, ordered so the predefined app roles lead deterministically.
 */
async function attachPersonFuncoes(
  tx: Db,
  orgId: string,
  people: PersonRow[],
): Promise<PersonWithFuncoes[]> {
  if (people.length === 0) return [];
  const rows = await tx
    .select({
      personId: salesOpsPersonFuncoes.personId,
      id: salesOpsFuncoes.id,
      name: salesOpsFuncoes.name,
      slug: salesOpsFuncoes.slug,
      isSystem: salesOpsFuncoes.isSystem,
    })
    .from(salesOpsPersonFuncoes)
    .innerJoin(
      salesOpsFuncoes,
      and(
        eq(salesOpsFuncoes.orgId, orgId),
        eq(salesOpsFuncoes.id, salesOpsPersonFuncoes.funcaoId),
      ),
    )
    .where(
      and(
        eq(salesOpsPersonFuncoes.orgId, orgId),
        inArray(
          salesOpsPersonFuncoes.personId,
          people.map((person) => person.id),
        ),
      ),
    )
    .orderBy(desc(salesOpsFuncoes.isSystem), asc(salesOpsFuncoes.name));

  const byPerson = new Map<string, AttachedFuncao[]>();
  for (const { personId, ...funcao } of rows) {
    const bucket = byPerson.get(personId);
    if (bucket) bucket.push(funcao);
    else byPerson.set(personId, [funcao]);
  }
  return people.map((person) => {
    const funcoes = byPerson.get(person.id) ?? [];
    return { ...person, funcoes, funcaoIds: funcoes.map((funcao) => funcao.id) };
  });
}

/**
 * Reads the caller-org rows for a set of função ids, inside an existing tenant
 * transaction. The `orgId` filter is the load-bearing part: an id that belongs to
 * another org is simply absent from the result, which every caller treats as
 * `unknown_funcao` rather than leaking that the id exists.
 */
async function selectFuncoesByIds(tx: Db, orgId: string, ids: string[]): Promise<FuncaoRow[]> {
  if (ids.length === 0) return [];
  return tx
    .select()
    .from(salesOpsFuncoes)
    .where(and(eq(salesOpsFuncoes.orgId, orgId), inArray(salesOpsFuncoes.id, ids)));
}

/** Public wrapper around {@link selectFuncoesByIds} for route-level pre-checks. */
export async function getFuncoesByIds(db: Db, orgId: string, ids: string[]): Promise<FuncaoRow[]> {
  if (ids.length === 0) return [];
  return withTenant(db, orgId, (tx) => selectFuncoesByIds(tx, orgId, ids));
}

/**
 * Resolves the intended função set to concrete org-scoped rows, creating the
 * three legacy slugs on demand so an org provisioned after migration 0012 still
 * has its predefined app roles.
 */
async function resolvePersonFuncoes(
  tx: Db,
  orgId: string,
  plan: Exclude<PersonFuncaoPlan, 'funcao_required' | { kind: 'unchanged' }>,
): Promise<FuncaoRow[] | 'unknown_funcao'> {
  if (plan.kind === 'ids') {
    const found = await selectFuncoesByIds(tx, orgId, plan.funcaoIds);
    // Any id that is unknown, or that belongs to another org and is therefore
    // invisible under this org filter, is a hard rejection.
    if (found.length !== plan.funcaoIds.length) return 'unknown_funcao';
    return found;
  }

  const existing = await tx
    .select()
    .from(salesOpsFuncoes)
    .where(and(eq(salesOpsFuncoes.orgId, orgId), inArray(salesOpsFuncoes.slug, [...plan.slugs])));
  const bySlug = new Map(existing.map((funcao) => [funcao.slug, funcao]));

  for (const slug of plan.slugs) {
    if (bySlug.has(slug)) continue;
    const seed = LEGACY_FUNCAO_SEEDS[slug];
    const [created] = await tx
      .insert(salesOpsFuncoes)
      .values({ orgId, name: seed.name, slug, isSystem: seed.isSystem })
      // Bare, i.e. every unique index, NOT a named (org_id, slug) arbiter. The
      // table also carries a unique index on (org_id, name), and this seed writes
      // both columns, so a concurrent seed of the same row violates both. Naming
      // only the slug arbiter means Postgres raises 23505 whenever it reports the
      // name index, which throws past the race fallback below and turns an
      // ordinary concurrent first person write into an HTTP 500.
      .onConflictDoNothing()
      .returning();
    if (created) {
      bySlug.set(slug, created);
      continue;
    }
    // A concurrent writer won the race; re-read the winner. Reachable now that
    // the conflict is absorbed instead of raised. Safe to key on the slug because
    // name and slug move together for these seeds (the slug is derived from the
    // name), so a name conflict implies the same-slug row is the winner.
    const [raced] = await tx
      .select()
      .from(salesOpsFuncoes)
      .where(and(eq(salesOpsFuncoes.orgId, orgId), eq(salesOpsFuncoes.slug, slug)))
      .limit(1);
    if (!raced) return 'unknown_funcao';
    bySlug.set(slug, raced);
  }

  return plan.slugs.map((slug) => bySlug.get(slug)!);
}

/**
 * Full set replacement, scoped to the caller org and the one person. Set replace
 * rather than merge is what keeps the derived boolean mirrors from drifting:
 * there is exactly one write path and the mirrors are recomputed alongside it.
 */
async function replacePersonFuncoes(
  tx: Db,
  orgId: string,
  personId: string,
  funcaoIds: string[],
): Promise<void> {
  await tx
    .delete(salesOpsPersonFuncoes)
    .where(
      and(
        eq(salesOpsPersonFuncoes.orgId, orgId),
        eq(salesOpsPersonFuncoes.personId, personId),
      ),
    );
  if (funcaoIds.length === 0) return;
  await tx
    .insert(salesOpsPersonFuncoes)
    .values(funcaoIds.map((funcaoId) => ({ orgId, personId, funcaoId })));
}

/**
 * The three deprecated boolean columns on sales_ops_people, recomputed from the
 * assignment set. `isCollaborator` means "holds at least one non-system função",
 * which is exactly how the prestador/professionals picker consumes it.
 */
function deriveBooleanMirrors(funcoes: Pick<FuncaoRow, 'slug' | 'isSystem'>[]) {
  return {
    isSeller: funcoes.some((funcao) => funcao.slug === 'vendedor'),
    isFinder: funcoes.some((funcao) => funcao.slug === 'finder'),
    isCollaborator: funcoes.some((funcao) => !funcao.isSystem),
  };
}

function toAttached(funcoes: FuncaoRow[]): AttachedFuncao[] {
  return [...funcoes]
    .sort(
      (a, b) => Number(b.isSystem) - Number(a.isSystem) || a.name.localeCompare(b.name, 'pt-BR'),
    )
    .map(({ id, name, slug, isSystem }) => ({ id, name, slug, isSystem }));
}

export async function listPeople(db: Db, orgId: string): Promise<PersonWithFuncoes[]> {
  return withTenant(db, orgId, async (tx) => {
    const people = await tx
      .select()
      .from(salesOpsPeople)
      .where(eq(salesOpsPeople.orgId, orgId))
      .orderBy(salesOpsPeople.displayName);
    return attachPersonFuncoes(tx, orgId, people);
  });
}

export async function createPerson(
  db: Db,
  orgId: string,
  data: PersonInput,
): Promise<PersonWithFuncoes | 'unknown_funcao' | 'funcao_required'> {
  return withTenant(db, orgId, async (tx) => {
    const plan = planPersonFuncoes(data, 'create');
    if (plan === 'funcao_required' || plan.kind === 'unchanged') return 'funcao_required';
    const resolved = await resolvePersonFuncoes(tx, orgId, plan);
    if (resolved === 'unknown_funcao') return 'unknown_funcao';

    const [person] = await tx
      .insert(salesOpsPeople)
      .values({
        displayName: data.displayName,
        status: data.status,
        orgId,
        contactEmail: data.contactEmail || null,
        ...deriveBooleanMirrors(resolved),
      })
      .returning();
    await replacePersonFuncoes(tx, orgId, person!.id, resolved.map((funcao) => funcao.id));
    const funcoes = toAttached(resolved);
    return { ...person!, funcoes, funcaoIds: funcoes.map((funcao) => funcao.id) };
  });
}

export async function updatePerson(
  db: Db,
  orgId: string,
  id: string,
  data: Partial<PersonInput>,
): Promise<PersonWithFuncoes | null | 'unknown_funcao' | 'funcao_required'> {
  return withTenant(db, orgId, async (tx) => {
    const plan = planPersonFuncoes(data, 'update');
    if (plan === 'funcao_required') return 'funcao_required';

    const [current] = await tx
      .select()
      .from(salesOpsPeople)
      .where(and(eq(salesOpsPeople.orgId, orgId), eq(salesOpsPeople.id, id)))
      .limit(1);
    if (!current) return null;

    let resolved: FuncaoRow[] | null = null;
    if (plan.kind !== 'unchanged') {
      const outcome = await resolvePersonFuncoes(tx, orgId, plan);
      if (outcome === 'unknown_funcao') return 'unknown_funcao';
      resolved = outcome;
    }

    const [person] = await tx
      .update(salesOpsPeople)
      .set({
        ...(data.displayName !== undefined ? { displayName: data.displayName } : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
        // Unconditional, matching the pre-slice behaviour exactly. contactEmail is
        // a full-replace field on this endpoint: the shipped Pessoa dialog builds
        // `contactEmail: contactEmail.trim() || undefined` and JSON.stringify then
        // DROPS the key, so an absent key is how the UI says "clear it". Making
        // this a conditional spread retains the old address instead and removes
        // the only way the UI can blank an e-mail.
        // Consequence for later slices: any PATCH that omits contactEmail clears
        // it, so a caller sending funcaoIds must send contactEmail alongside.
        contactEmail: data.contactEmail || null,
        ...(resolved ? deriveBooleanMirrors(resolved) : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(salesOpsPeople.orgId, orgId), eq(salesOpsPeople.id, id)))
      .returning();
    if (!person) return null;

    if (resolved) {
      await replacePersonFuncoes(tx, orgId, id, resolved.map((funcao) => funcao.id));
      const funcoes = toAttached(resolved);
      return { ...person, funcoes, funcaoIds: funcoes.map((funcao) => funcao.id) };
    }
    const [attached] = await attachPersonFuncoes(tx, orgId, [person]);
    return attached!;
  });
}

export async function listFuncoes(db: Db, orgId: string) {
  return withTenant(db, orgId, (tx) =>
    tx
      .select()
      .from(salesOpsFuncoes)
      .where(eq(salesOpsFuncoes.orgId, orgId))
      .orderBy(desc(salesOpsFuncoes.isSystem), asc(salesOpsFuncoes.name)),
  );
}

export async function getFuncao(db: Db, orgId: string, id: string) {
  return withTenant(db, orgId, async (tx) => {
    const [funcao] = await tx
      .select()
      .from(salesOpsFuncoes)
      .where(and(eq(salesOpsFuncoes.orgId, orgId), eq(salesOpsFuncoes.id, id)))
      .limit(1);
    return funcao ?? null;
  });
}

export async function createFuncao(db: Db, orgId: string, data: FuncaoInput) {
  return withTenant(db, orgId, async (tx) => {
    const slug = slugifyFuncao(data.name);
    if ((SYSTEM_FUNCAO_SLUGS as readonly string[]).includes(slug)) return 'reserved_slug' as const;
    // Fast path, purely for the error message: it names which rule was hit
    // without waiting on a lock. It is NOT the guard - see the conflict clause.
    const clash = await findFuncaoClash(tx, orgId, data.name, slug);
    if (clash) return clash;
    const [funcao] = await tx
      .insert(salesOpsFuncoes)
      // isSystem is never taken from the caller: only the two reserved slugs may
      // ever be flagged system, and only by the migration or the legacy seed.
      .values({ ...data, orgId, slug, isSystem: false })
      // The probe above is a time-of-check/time-of-use race: a concurrent writer
      // (an admin double-clicking Save is enough) can land the same name in
      // between, and a plain INSERT would raise 23505 and escape as an HTTP 500
      // instead of the designed 409. Absorbing the conflict here makes the unique
      // indexes the actual guard, and keeps the transaction usable so the probe
      // below can still say WHICH rule was hit.
      .onConflictDoNothing()
      .returning();
    if (funcao) return funcao;
    // Lost the race. Re-probe under a fresh statement snapshot, which now sees
    // the committed winner, and fall back to the name reason.
    return (await findFuncaoClash(tx, orgId, data.name, slug)) ?? ('duplicate' as const);
  });
}

export async function updateFuncao(
  db: Db,
  orgId: string,
  id: string,
  data: Partial<FuncaoInput>,
) {
  return withTenant(db, orgId, async (tx) => {
    const [current] = await tx
      .select()
      .from(salesOpsFuncoes)
      .where(and(eq(salesOpsFuncoes.orgId, orgId), eq(salesOpsFuncoes.id, id)))
      .limit(1);
    if (!current) return null;
    // The two predefined app roles are fully immutable through the API: no
    // rename, no archive, no delete.
    if (current.isSystem && (data.name !== undefined || data.status !== undefined)) {
      return 'is_system' as const;
    }

    let slug: string | undefined;
    if (data.name !== undefined) {
      slug = slugifyFuncao(data.name);
      if ((SYSTEM_FUNCAO_SLUGS as readonly string[]).includes(slug)) {
        return 'reserved_slug' as const;
      }
      // Fast path for the error message only; the constraint is the real guard.
      const clash = await findFuncaoClash(tx, orgId, data.name, slug, id);
      if (clash) return clash;
    }

    // UPDATE has no ON CONFLICT clause, so the same TOCTOU race as createFuncao is
    // handled by catching the unique violation and mapping it onto the same two
    // 409 reasons. The write runs inside a SAVEPOINT (a nested drizzle
    // transaction) so a rejected rename leaves the surrounding transaction usable
    // rather than poisoned.
    try {
      const funcao = await tx.transaction(async (nested) => {
        const [row] = await nested
          .update(salesOpsFuncoes)
          .set({ ...data, ...(slug !== undefined ? { slug } : {}), updatedAt: new Date() })
          .where(and(eq(salesOpsFuncoes.orgId, orgId), eq(salesOpsFuncoes.id, id)))
          .returning();
        return row ?? null;
      });
      return funcao;
    } catch (error) {
      const violated = mapFuncaoUniqueViolation(error);
      if (violated) return violated;
      throw error;
    }
  });
}

/**
 * Maps a Postgres unique violation on sales_ops_funcoes onto the service
 * sentinels, so a lost race reports the same reason the pre-check would have.
 *
 * The two indexes are reported separately on purpose: the API surfaces
 * `funcao_name_taken` and `funcao_slug_taken` as distinct 409 reasons, so a
 * distinct display name that collides on the derived machine key stays
 * distinguishable from a plain duplicate name.
 */
const FUNCAO_UNIQUE_VIOLATIONS: Record<string, 'duplicate' | 'duplicate_slug'> = {
  sales_ops_funcoes_org_name_idx: 'duplicate',
  sales_ops_funcoes_org_slug_idx: 'duplicate_slug',
};

function mapFuncaoUniqueViolation(error: unknown): 'duplicate' | 'duplicate_slug' | null {
  // postgres.js puts code/constraint_name on the error; drizzle re-throws it
  // wrapped, exposing the original under `cause`.
  const candidates = [error, (error as { cause?: unknown } | null)?.cause];
  for (const candidate of candidates) {
    const pgError = candidate as
      | { code?: string; constraint_name?: string; constraint?: string }
      | null
      | undefined;
    if (!pgError || pgError.code !== '23505') continue;
    const constraint = pgError.constraint_name ?? pgError.constraint;
    const mapped = constraint ? FUNCAO_UNIQUE_VIOLATIONS[constraint] : undefined;
    if (mapped) return mapped;
  }
  return null;
}

/**
 * Per-org uniqueness for both the display name and the derived machine key,
 * reported separately so the API can say which rule was hit.
 */
async function findFuncaoClash(
  tx: Db,
  orgId: string,
  name: string,
  slug: string,
  excludeId?: string,
): Promise<'duplicate' | 'duplicate_slug' | null> {
  const notSelf = excludeId ? [ne(salesOpsFuncoes.id, excludeId)] : [];
  const [byName] = await tx
    .select({ id: salesOpsFuncoes.id })
    .from(salesOpsFuncoes)
    .where(and(eq(salesOpsFuncoes.orgId, orgId), eq(salesOpsFuncoes.name, name), ...notSelf))
    .limit(1);
  if (byName) return 'duplicate';
  const [bySlug] = await tx
    .select({ id: salesOpsFuncoes.id })
    .from(salesOpsFuncoes)
    .where(and(eq(salesOpsFuncoes.orgId, orgId), eq(salesOpsFuncoes.slug, slug), ...notSelf))
    .limit(1);
  return bySlug ? 'duplicate_slug' : null;
}

export type ProductRow = typeof salesOpsProducts.$inferSelect;
export type ProductFuncaoCostRow = typeof salesOpsProductFuncaoCosts.$inferSelect;
export type ProductWithCosts = { product: ProductRow; productFuncaoCosts: ProductFuncaoCostRow[] };

/**
 * Sentinel for a PATCH whose MERGED entrada block contradicts itself, e.g.
 * `PATCH { defaultEntradaPct: 50 }` against a row whose stored mode is 'none' -
 * only visible once the patch is merged. Returning a sentinel keeps it a 400
 * instead of letting the DB CHECK surface as a 500. Mirrors the `'duplicate'`
 * sentinel idiom used by createArea.
 */
export const INVALID_PRODUCT_ENTRADA_VALUE = 'invalid_product_entrada_value';

/**
 * Every numeric(...) column drizzle exposes as a string. One coercion, used by
 * create and update alike, instead of an inline ternary per column: `undefined`
 * means "not in this patch", `null` means "store NULL".
 */
function numericColumn(value: number | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  return value === null ? null : String(value);
}

/**
 * The product columns written verbatim from the payload: everything except the
 * numeric(...) columns (coerced by productNumericPatch), the derived `kind` /
 * `openPrice` pair, and `productFuncaoCosts`, which lives in the child table.
 *
 * An explicit allow-list rather than a `...data` spread: it is what guarantees a
 * request body can never smuggle `orgId`, `id` or `createdAt` into a write.
 */
const PRODUCT_PLAIN_COLUMNS = [
  'name',
  'codeSuffix',
  'areaId',
  'setupBrl',
  'hasMonthly',
  'monthlyBrl',
  'recurringCommission',
  'hasFinderCommission',
  'sellerCommissionType',
  'sellerWithFinderCommissionType',
  'finderCommissionType',
  'defaultPaymentMethod',
  'defaultEntradaMode',
  'defaultEntradaBrl',
  'defaultRemainingInstallments',
  'defaultRecurringCycles',
  'modules',
  'providers',
  'status',
] as const;

function productPlainPatch(
  data: Partial<ProductInput>,
): Partial<typeof salesOpsProducts.$inferInsert> {
  const patch: Record<string, unknown> = {};
  for (const key of PRODUCT_PLAIN_COLUMNS) {
    const value = data[key];
    // `undefined` means "not in this payload"; drizzle skips it. `null` is kept,
    // because it is the explicit "store NULL" signal on the nullable columns.
    if (value !== undefined) patch[key] = value;
  }
  return patch as Partial<typeof salesOpsProducts.$inferInsert>;
}

/** The numeric(...) product columns a PATCH touches, coerced in one place. */
function productNumericPatch(
  data: Partial<ProductInput>,
): Partial<typeof salesOpsProducts.$inferInsert> {
  const patch: Partial<typeof salesOpsProducts.$inferInsert> = {};
  if (data.sellerCommissionValue !== undefined) {
    patch.sellerCommissionValue = String(data.sellerCommissionValue);
  }
  if (data.sellerWithFinderCommissionValue !== undefined) {
    patch.sellerWithFinderCommissionValue = String(data.sellerWithFinderCommissionValue);
  }
  if (data.finderCommissionValue !== undefined) {
    patch.finderCommissionValue = String(data.finderCommissionValue);
  }
  if (data.defaultEntradaPct !== undefined) {
    patch.defaultEntradaPct = numericColumn(data.defaultEntradaPct);
  }
  return patch;
}

/** Cost rows for one product, or for the whole org when productId is omitted. */
function selectProductFuncaoCosts(
  tx: Db,
  orgId: string,
  productId?: string,
): Promise<ProductFuncaoCostRow[]> {
  const scope = productId
    ? and(
        eq(salesOpsProductFuncaoCosts.orgId, orgId),
        eq(salesOpsProductFuncaoCosts.productId, productId),
      )
    : eq(salesOpsProductFuncaoCosts.orgId, orgId);
  return tx
    .select()
    .from(salesOpsProductFuncaoCosts)
    .where(scope)
    .orderBy(salesOpsProductFuncaoCosts.productId, salesOpsProductFuncaoCosts.funcaoId);
}

export async function listProductFuncaoCosts(
  db: Db,
  orgId: string,
  productId?: string,
): Promise<ProductFuncaoCostRow[]> {
  return withTenant(db, orgId, (tx) => selectProductFuncaoCosts(tx, orgId, productId));
}

/**
 * Full set replacement for one product's função cost defaults, exactly like the
 * `modules` and `providers` arrays: sending the key replaces the set, `[]` clears
 * it. There is deliberately no DELETE verb on the router.
 */
async function replaceProductFuncaoCosts(
  tx: Db,
  orgId: string,
  productId: string,
  costs: ProductFuncaoCostInput[],
): Promise<void> {
  await tx
    .delete(salesOpsProductFuncaoCosts)
    .where(
      and(
        eq(salesOpsProductFuncaoCosts.orgId, orgId),
        eq(salesOpsProductFuncaoCosts.productId, productId),
      ),
    );
  if (costs.length === 0) return;
  await tx.insert(salesOpsProductFuncaoCosts).values(
    costs.map((cost) => ({
      // org_id and product_id are always server-side values, never body-supplied.
      orgId,
      productId,
      funcaoId: cost.funcaoId,
      mode: cost.mode,
      valuePct: cost.mode === 'pct' ? String(cost.valuePct) : null,
      valueBrl: cost.mode === 'fix' ? cost.valueBrl : null,
    })),
  );
}

export type ProductRefsResult =
  | { ok: true }
  | { ok: false; reason: 'unknown_area' }
  | { ok: false; reason: 'unknown_funcao'; funcaoId: string };

/**
 * Resolves every foreign reference a product write carries against the CALLER's
 * org, so POST and PATCH share one guard instead of duplicating it.
 *
 * The função check is the tenancy gate: RLS `WITH CHECK` only validates the child
 * row's own `org_id` (which the server sets), so without this a caller could paste
 * another org's funcaoId. The composite FK is the in-transaction backstop for the
 * residual TOCTOU window.
 */
export async function resolveProductRefs(
  db: Db,
  orgId: string,
  data: Partial<ProductInput>,
): Promise<ProductRefsResult> {
  return withTenant(db, orgId, async (tx): Promise<ProductRefsResult> => {
    if (data.areaId !== undefined) {
      const [area] = await tx
        .select({ id: salesOpsAreas.id })
        .from(salesOpsAreas)
        .where(and(eq(salesOpsAreas.orgId, orgId), eq(salesOpsAreas.id, data.areaId)))
        .limit(1);
      if (!area) return { ok: false, reason: 'unknown_area' };
    }
    const funcaoIds = [...new Set((data.productFuncaoCosts ?? []).map((cost) => cost.funcaoId))];
    if (funcaoIds.length > 0) {
      const found = await selectFuncoesByIds(tx, orgId, funcaoIds);
      const foundIds = new Set(found.map((funcao) => funcao.id));
      const missing = funcaoIds.find((funcaoId) => !foundIds.has(funcaoId));
      if (missing !== undefined) return { ok: false, reason: 'unknown_funcao', funcaoId: missing };
    }
    return { ok: true };
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

export async function createProduct(
  db: Db,
  orgId: string,
  data: ProductInput,
): Promise<ProductWithCosts> {
  return withTenant(db, orgId, async (tx) => {
    const kind = resolveProductKind(data);
    const [product] = await tx
      .insert(salesOpsProducts)
      .values({
        ...productPlainPatch(data),
        name: data.name,
        orgId,
        kind,
        // open_price is a derived projection of kind, never authored
        // independently; sales_ops_products_kind_open_price_check enforces it.
        openPrice: kind === 'service',
        sellerCommissionValue: String(data.sellerCommissionValue),
        // The with-finder scenario falls back to the plain seller scenario, so an
        // org that never configured it still gets a coherent pair of columns.
        sellerWithFinderCommissionType:
          data.sellerWithFinderCommissionType ?? data.sellerCommissionType,
        sellerWithFinderCommissionValue: String(
          data.sellerWithFinderCommissionValue ?? data.sellerCommissionValue,
        ),
        finderCommissionValue: String(data.finderCommissionValue),
        defaultEntradaPct: numericColumn(data.defaultEntradaPct) ?? null,
      })
      .returning();
    await replaceProductFuncaoCosts(tx, orgId, product!.id, data.productFuncaoCosts ?? []);
    return {
      product: product!,
      productFuncaoCosts: await selectProductFuncaoCosts(tx, orgId, product!.id),
    };
  });
}

export async function updateProduct(
  db: Db,
  orgId: string,
  id: string,
  data: Partial<ProductInput>,
): Promise<ProductWithCosts | typeof INVALID_PRODUCT_ENTRADA_VALUE | null> {
  return withTenant(db, orgId, async (tx) => {
    const [current] = await tx
      .select()
      .from(salesOpsProducts)
      .where(and(eq(salesOpsProducts.orgId, orgId), eq(salesOpsProducts.id, id)))
      .limit(1);
    if (!current) return null;

    const kind = resolveProductKind(data, current.kind as ProductKind);

    const entradaMerged = {
      defaultEntradaMode: data.defaultEntradaMode ?? (current.defaultEntradaMode as ProductEntradaMode),
      defaultEntradaPct:
        data.defaultEntradaPct !== undefined
          ? data.defaultEntradaPct
          : current.defaultEntradaPct === null
            ? null
            : Number(current.defaultEntradaPct),
      defaultEntradaBrl:
        data.defaultEntradaBrl !== undefined ? data.defaultEntradaBrl : current.defaultEntradaBrl,
    };
    if (!UpdateProductSchema.safeParse(entradaMerged).success) return INVALID_PRODUCT_ENTRADA_VALUE;

    const patch: Partial<typeof salesOpsProducts.$inferInsert> = {
      ...productPlainPatch(data),
      kind,
      openPrice: kind === 'service',
      ...productNumericPatch(data),
      updatedAt: new Date(),
    };
    const [product] = await tx
      .update(salesOpsProducts)
      .set(patch)
      .where(and(eq(salesOpsProducts.orgId, orgId), eq(salesOpsProducts.id, id)))
      .returning();
    if (!product) return null;
    // Omitted key leaves the set untouched; present key is a full replace.
    if (data.productFuncaoCosts !== undefined) {
      await replaceProductFuncaoCosts(tx, orgId, id, data.productFuncaoCosts);
    }
    return {
      product,
      productFuncaoCosts: await selectProductFuncaoCosts(tx, orgId, id),
    };
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
    const parties = await resolvePartyContexts(tx, orgId, input);
    const ledger = buildSaleLedger(input, itemContexts, parties);

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
    let insertedProfessionalRows: Array<typeof salesOpsSaleProfessionals.$inferSelect> = [];
    if (ledger.professionals.length > 0) {
      insertedProfessionalRows = await tx
        .insert(salesOpsSaleProfessionals)
        .values(
          ledger.professionals.map((professional) => ({
            ...professional,
            orgId,
            saleId: sale.id,
            personId: professional.personId ?? null,
          })),
        )
        .returning();
    }

    let insertedReceivables: Array<{
      id: string;
      dueDate: Date;
      amountBrl: number;
      status: string;
      label: string;
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
          // The `M` prefix is what the professional-cost split reads to skip the
          // recurring rows, so it has to come back from the insert.
          label: salesOpsReceivables.label,
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
        professionals: insertedProfessionalRows.map((p) => ({
          id: p.id,
          personName: p.personNameSnapshot,
          costBrl: p.costBrl,
          costSplitBp: p.costSplitBp as number[] | null,
        })),
        receivables: insertedReceivables.map((r) => ({
          id: r.id,
          dueDate: asDateOnly(r.dueDate),
          amountBrl: r.amountBrl,
          status: r.status,
          label: r.label,
        })),
        // No `existingPayables`: a sale created straight into `won` has none.
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
    const parties = await resolvePartyContexts(tx, orgId, input);
    const ledger = buildSaleLedger(input, itemContexts, parties);

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
          id: p.id,
          personName: p.personNameSnapshot,
          costBrl: p.costBrl,
          // Drizzle types a `jsonb` column as `unknown`. This is the ONE boundary
          // where the cast happens; zod (`SaleProfessionalSchema`) already
          // validated the shape on the way in, so do not scatter more casts.
          costSplitBp: p.costSplitBp as number[] | null,
        })),
        receivables: receivableRows.map((r) => ({
          id: r.id,
          dueDate: asDateOnly(r.dueDate),
          amountBrl: r.amountBrl,
          status: r.status,
          label: r.label,
        })),
        existingPayables: existingPayableRows.map((p) => ({
          kind: p.kind as PayableKind,
          receivableId: p.receivableId,
          status: p.status,
          beneficiaryName: p.beneficiaryName,
          amountBrl: p.amountBrl,
          saleProfessionalId: p.saleProfessionalId,
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
    const productFuncaoCosts = await selectProductFuncaoCosts(tx, orgId);
    const clients = await tx
      .select()
      .from(salesOpsClients)
      .where(eq(salesOpsClients.orgId, orgId))
      .orderBy(salesOpsClients.name);
    const personRows = await tx
      .select()
      .from(salesOpsPeople)
      .where(eq(salesOpsPeople.orgId, orgId))
      .orderBy(salesOpsPeople.displayName);
    const people = await attachPersonFuncoes(tx, orgId, personRows);
    const funcoes = await tx
      .select()
      .from(salesOpsFuncoes)
      .where(eq(salesOpsFuncoes.orgId, orgId))
      .orderBy(desc(salesOpsFuncoes.isSystem), asc(salesOpsFuncoes.name));
    const personFuncoes = await tx
      .select()
      .from(salesOpsPersonFuncoes)
      .where(eq(salesOpsPersonFuncoes.orgId, orgId));
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
      productFuncaoCosts,
      clients,
      people,
      funcoes,
      personFuncoes,
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
