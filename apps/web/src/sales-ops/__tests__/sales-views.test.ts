import { describe, expect, it } from 'vitest';
import { PERIOD_ALL, type PeriodRange } from '../period';
import {
  SALES_VIEW_STATUSES,
  effectiveSalesStatus,
  filterSalesList,
  isSalesListView,
  salesStatusOptionsForView,
} from '../sales-views';
import type { SalesOpsSale, SalesOpsSaleItem } from '../types';

const ALL_OPTIONS = [
  { value: 'all', label: 'Todos os status' },
  { value: 'draft', label: 'Rascunho' },
  { value: 'open', label: 'Aberta' },
  { value: 'won', label: 'Ganha' },
  { value: 'lost', label: 'Perdida' },
  { value: 'cancelled', label: 'Cancelada' },
];

function sale(id: string, status: SalesOpsSale['status'], createdAt: string, wonAt: string | null = null): SalesOpsSale {
  return { id, status, createdAt, wonAt } as SalesOpsSale;
}

const OCTOBER: PeriodRange = { from: '2026-10-01', to: '2026-10-31' };
const SAO_PAULO_TODAY: PeriodRange = { from: '2026-10-20', to: '2026-10-20' };

describe('sales list views', () => {
  it('groups the statuses: Proposta is draft and open, Vendido is won, encerradas are lost and cancelled', () => {
    expect(SALES_VIEW_STATUSES.vendas).toBeNull();
    expect(SALES_VIEW_STATUSES['vendas-abertas']).toEqual(['draft', 'open']);
    expect(SALES_VIEW_STATUSES['vendas-ganhas']).toEqual(['won']);
    expect(SALES_VIEW_STATUSES['vendas-encerradas']).toEqual(['lost', 'cancelled']);
  });

  it('recognises only the four sales list views', () => {
    expect(isSalesListView('vendas-ganhas')).toBe(true);
    expect(isSalesListView('vendas')).toBe(true);
    expect(isSalesListView('comissoes')).toBe(false);
    expect(isSalesListView('constructor')).toBe(false);
  });

  it('offers only the status options of the view, always with all', () => {
    expect(salesStatusOptionsForView('vendas-ganhas', ALL_OPTIONS).map((o) => o.value)).toEqual(['all', 'won']);
    expect(salesStatusOptionsForView('vendas', ALL_OPTIONS)).toHaveLength(ALL_OPTIONS.length);
  });

  it('reads a stale status outside the view as all', () => {
    expect(effectiveSalesStatus('vendas-ganhas', 'open')).toBe('all');
    expect(effectiveSalesStatus('vendas-ganhas', 'won')).toBe('won');
    expect(effectiveSalesStatus('vendas', 'lost')).toBe('lost');
  });

  it('keeps only the statuses of the view', () => {
    const sales = [sale('a', 'draft', '2026-10-02T12:00:00Z'), sale('b', 'open', '2026-10-02T12:00:00Z'), sale('c', 'won', '2026-10-02T12:00:00Z', '2026-10-03T12:00:00Z')];
    const ids = (view: 'vendas-abertas' | 'vendas-ganhas') =>
      filterSalesList({ sales, saleItems: [], view, status: 'all', areaId: 'all', range: PERIOD_ALL }).map((s) => s.id);
    expect(ids('vendas-abertas')).toEqual(['a', 'b']);
    expect(ids('vendas-ganhas')).toEqual(['c']);
  });

  it('dates a won sale by its won day and any other sale by its creation', () => {
    const sales = [
      sale('won-in-october', 'won', '2026-09-10T12:00:00Z', '2026-10-05T12:00:00Z'),
      sale('created-in-october', 'open', '2026-10-06T12:00:00Z'),
    ];
    const octoberIds = filterSalesList({ sales, saleItems: [], view: 'vendas', status: 'all', areaId: 'all', range: OCTOBER }).map((s) => s.id);
    expect(octoberIds).toEqual(['won-in-october', 'created-in-october']);
    const septemberWon = filterSalesList({
      sales: [sales[0]!],
      saleItems: [],
      view: 'vendas-ganhas',
      status: 'all',
      areaId: 'all',
      range: { from: '2026-09-01', to: '2026-09-30' },
    });
    expect(septemberWon).toEqual([]);
  });

  it('applies the area rule through the sale items', () => {
    const sales = [sale('a', 'open', '2026-10-02T12:00:00Z'), sale('b', 'open', '2026-10-02T12:00:00Z')];
    const items = [{ saleId: 'a', areaId: 'area-1' } as SalesOpsSaleItem];
    const ids = filterSalesList({ sales, saleItems: items, view: 'vendas-abertas', status: 'all', areaId: 'area-1', range: PERIOD_ALL }).map((s) => s.id);
    expect(ids).toEqual(['a']);
  });

  it('places a sale created at 22:30 on the 20th in Sao Paulo inside that day', () => {
    const late = sale('late', 'open', '2026-10-21T01:30:00Z');
    const ids = filterSalesList({ sales: [late], saleItems: [], view: 'vendas-abertas', status: 'all', areaId: 'all', range: SAO_PAULO_TODAY }).map((s) => s.id);
    expect(ids).toEqual(['late']);
  });
});
