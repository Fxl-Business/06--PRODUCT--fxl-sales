import type { ComboboxOption } from '@/components/ui/combobox';
import { filterSalesByPeriod, type PeriodRange } from './period';
import type { SalesOpsSale, SalesOpsSaleItem, SalesOpsStatus } from './types';

/**
 * The Propostas lists, one route each. Pure: the route, the status options, the
 * status a stale URL falls back to, and the filtering all live here so the view
 * and the tests read the same rule.
 *
 * `vendas` keeps every status; the three others are the groups the operator
 * works in: Proposta (draft and open), Vendido (won) and the closed ones.
 */
export type SalesListView = 'vendas' | 'vendas-abertas' | 'vendas-ganhas' | 'vendas-encerradas';

export const SALES_VIEW_STATUSES: Record<SalesListView, readonly SalesOpsStatus[] | null> = {
  vendas: null,
  'vendas-abertas': ['draft', 'open'],
  'vendas-ganhas': ['won'],
  'vendas-encerradas': ['lost', 'cancelled'],
};

export function isSalesListView(view: string): view is SalesListView {
  return Object.hasOwn(SALES_VIEW_STATUSES, view);
}

/** The status picker for a view: `all` plus the view's own statuses, in the given order. */
export function salesStatusOptionsForView(view: SalesListView, all: ComboboxOption[]): ComboboxOption[] {
  const statuses = SALES_VIEW_STATUSES[view];
  return all.filter((option) => option.value === 'all' || statuses === null || statuses.includes(option.value as SalesOpsStatus));
}

/** A status outside the view (left in state by another list) reads as `all`. */
export function effectiveSalesStatus(view: SalesListView, status: SalesOpsStatus | 'all'): SalesOpsStatus | 'all' {
  if (status === 'all') return 'all';
  const statuses = SALES_VIEW_STATUSES[view];
  if (statuses === null || statuses.includes(status)) return status;
  return 'all';
}

export function filterSalesList(input: {
  sales: SalesOpsSale[];
  saleItems: SalesOpsSaleItem[];
  view: SalesListView;
  status: SalesOpsStatus | 'all';
  areaId: string | 'all';
  range: PeriodRange;
}): SalesOpsSale[] {
  const { sales, saleItems, view, areaId, range } = input;
  const statuses = SALES_VIEW_STATUSES[view];
  const status = effectiveSalesStatus(view, input.status);
  const byStatus = sales.filter(
    (sale) =>
      (statuses === null || statuses.includes(sale.status)) && (status === 'all' || sale.status === status),
  );
  const byArea =
    areaId === 'all'
      ? byStatus
      : byStatus.filter((sale) => saleItems.some((item) => item.saleId === sale.id && item.areaId === areaId));
  return filterSalesByPeriod(byArea, range);
}
