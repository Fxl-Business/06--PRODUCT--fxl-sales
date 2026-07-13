import type {
  CommissionType,
  CreateSalePayload,
  DashboardModel,
  SaleDraft,
  SalesOpsBootstrap,
  SalesOpsProduct,
  SalesOpsSale,
  SalesOpsSettings,
} from './types';

const closedStatuses = new Set(['closed', 'completed']);

function toNumber(value: string | number | undefined, fallback = 0): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  if (typeof value !== 'string') return fallback;
  const parsed = Number(value.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : fallback;
}

export type SaleCommissionDefaultsProduct = Pick<
  SalesOpsProduct,
  | 'sellerCommissionType'
  | 'sellerCommissionValue'
  | 'sellerWithFinderCommissionType'
  | 'sellerWithFinderCommissionValue'
  | 'finderCommissionType'
  | 'finderCommissionValue'
>;

export type SaleCommissionDefaults = {
  sellerCommissionPct: number;
  finderCommissionPct: number;
};

function percentageOrFallback(
  type: CommissionType | undefined,
  value: string | number | undefined,
  fallback: number,
): number {
  return type === 'pct' ? toNumber(value, fallback) : fallback;
}

export function resolveSaleCommissionDefaults(
  product: SaleCommissionDefaultsProduct | undefined,
  hasFinder: boolean,
  settings: Pick<
    SalesOpsSettings,
    'defaultSellerCommissionPct' | 'defaultFinderCommissionPct'
  > | null,
): SaleCommissionDefaults {
  const sellerFallback = toNumber(settings?.defaultSellerCommissionPct, 10);
  const finderFallback = toNumber(settings?.defaultFinderCommissionPct, 3);

  if (!hasFinder) {
    return {
      sellerCommissionPct: percentageOrFallback(
        product?.sellerCommissionType,
        product?.sellerCommissionValue,
        sellerFallback,
      ),
      finderCommissionPct: finderFallback,
    };
  }

  return {
    sellerCommissionPct: percentageOrFallback(
      product?.sellerWithFinderCommissionType,
      product?.sellerWithFinderCommissionValue,
      sellerFallback,
    ),
    finderCommissionPct: percentageOrFallback(
      product?.finderCommissionType,
      product?.finderCommissionValue,
      finderFallback,
    ),
  };
}

function cleanId(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function parseCurrencyInputToCents(value: string | number | undefined): number {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
  }
  const trimmed = value?.trim();
  if (!trimmed) return 0;

  const hasComma = trimmed.includes(',');
  const hasDot = trimmed.includes('.');
  let normalized = trimmed;

  if (hasComma) {
    normalized = trimmed.replace(/\./g, '').replace(',', '.');
  } else if (hasDot) {
    const parts = trimmed.split('.');
    const lastPart = parts.at(-1) ?? '';
    normalized =
      lastPart.length > 0 && lastPart.length <= 2
        ? trimmed.replace(/,/g, '')
        : trimmed.replace(/\./g, '');
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed * 100)) : 0;
}

export function formatMoneyBrl(
  cents: number,
  options?: { minimumFractionDigits?: number; maximumFractionDigits?: number },
): string {
  const maximumFractionDigits = options?.maximumFractionDigits ?? 2;
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: options?.minimumFractionDigits ?? maximumFractionDigits,
    maximumFractionDigits,
  })
    .format(cents / 100)
    .replace(/\u00a0/g, ' ');
}

export function buildSalePayload(draft: SaleDraft): CreateSalePayload {
  return {
    clientId: cleanId(draft.clientId),
    clientName: draft.clientName.trim(),
    sellerPersonId: cleanId(draft.sellerPersonId),
    sellerName: draft.sellerName.trim(),
    finderPersonId: cleanId(draft.finderPersonId),
    finderName: cleanId(draft.finderName) ?? null,
    status: draft.status,
    paymentMethod: draft.paymentMethod,
    condition: draft.condition,
    installments: Math.max(1, Math.floor(toNumber(draft.installments, 1))),
    baseDate: draft.baseDate,
    notes: cleanId(draft.notes) ?? null,
    sellerCommissionPct: toNumber(draft.sellerCommissionPct),
    finderCommissionPct: toNumber(draft.finderCommissionPct),
    taxPct: toNumber(draft.taxPct),
    otherCostsBrl: Math.max(0, Math.floor(toNumber(draft.otherCostsBrl))),
    items: draft.items.map((item) => ({
      productId: cleanId(item.productId),
      productName: item.productName.trim(),
      productType: item.productType.trim() || 'SaaS',
      quantity: Math.max(1, Math.floor(toNumber(item.quantity, 1))),
      unitBrl: Math.max(0, Math.floor(toNumber(item.unitBrl))),
    })),
    professionals: draft.professionals.map((professional) => ({
      personId: cleanId(professional.personId),
      personName: professional.personName.trim(),
      role: professional.role.trim(),
      costBrl: Math.max(0, Math.floor(toNumber(professional.costBrl))),
    })),
  };
}

function saleTime(sale: SalesOpsSale): number {
  return new Date(sale.createdAt || sale.baseDate).getTime();
}

export function buildDashboardModel(bootstrap: SalesOpsBootstrap): DashboardModel {
  const activeSales = bootstrap.sales.filter((sale) => sale.status !== 'cancelled');
  const closedSales = activeSales.filter((sale) => closedStatuses.has(sale.status));
  const payableBrl = bootstrap.payables
    .filter((payable) => payable.status === 'open')
    .reduce((sum, payable) => sum + payable.amountBrl, 0);
  const revenueMap = new Map<string, number>();
  const sellerMap = new Map<string, { totalBrl: number; commissionBrl: number; count: number }>();
  const finderMap = new Map<string, { totalBrl: number; commissionBrl: number; count: number }>();

  for (const item of bootstrap.saleItems) {
    revenueMap.set(
      item.productNameSnapshot,
      (revenueMap.get(item.productNameSnapshot) ?? 0) + item.subtotalBrl,
    );
  }

  for (const sale of closedSales) {
    const seller = sellerMap.get(sale.sellerNameSnapshot) ?? {
      totalBrl: 0,
      commissionBrl: 0,
      count: 0,
    };
    seller.totalBrl += sale.totalBrl;
    seller.commissionBrl += sale.sellerCommissionBrl;
    seller.count += 1;
    sellerMap.set(sale.sellerNameSnapshot, seller);

    if (sale.finderNameSnapshot) {
      const finder = finderMap.get(sale.finderNameSnapshot) ?? {
        totalBrl: 0,
        commissionBrl: 0,
        count: 0,
      };
      finder.totalBrl += sale.totalBrl;
      finder.commissionBrl += sale.finderCommissionBrl;
      finder.count += 1;
      finderMap.set(sale.finderNameSnapshot, finder);
    }
  }

  const maxProductRevenue = Math.max(1, ...revenueMap.values());

  return {
    kpis: {
      closedRevenueBrl: closedSales.reduce((sum, sale) => sum + sale.totalBrl, 0),
      activeMrrBrl: activeSales.reduce((sum, sale) => sum + sale.recurringBrl, 0),
      payableBrl,
      closedSalesCount: closedSales.length,
    },
    revenueByProduct: [...revenueMap.entries()]
      .map(([name, amountBrl]) => ({
        name,
        amountBrl,
        widthPct: Math.round((amountBrl / maxProductRevenue) * 100),
      }))
      .sort((a, b) => b.amountBrl - a.amountBrl),
    topSellers: [...sellerMap.entries()]
      .map(([name, value]) => ({ name, ...value }))
      .sort((a, b) => b.commissionBrl - a.commissionBrl),
    topFinders: [...finderMap.entries()]
      .map(([name, value]) => ({ name, ...value }))
      .sort((a, b) => b.commissionBrl - a.commissionBrl),
    latestSales: [...activeSales].sort((a, b) => saleTime(b) - saleTime(a)).slice(0, 6),
  };
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return 'FX';
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase();
}
