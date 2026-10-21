import { describe, expect, it } from 'vitest';
import {
  PERIOD_ALL,
  PERIOD_COPY,
  filterSalesByPeriod,
  instantInPeriod,
  periodError,
  periodQuery,
  saleReferenceInstant,
  selectionToRange,
  type PeriodSelection,
} from '../period';

function custom(from: string, to: string): PeriodSelection {
  return { preset: 'custom', from, to };
}

function preset(name: PeriodSelection['preset']): PeriodSelection {
  return { preset: name, from: '', to: '' };
}

describe('period presets', () => {
  it('last7 and last30 end on today and span 7 and 30 civil days', () => {
    expect(selectionToRange(preset('last7'), '2026-10-20')).toEqual({ from: '2026-10-14', to: '2026-10-20' });
    expect(selectionToRange(preset('last30'), '2026-10-20')).toEqual({ from: '2026-09-21', to: '2026-10-20' });
  });

  it('next7 starts on today', () => {
    expect(selectionToRange(preset('next7'), '2026-10-20')).toEqual({ from: '2026-10-20', to: '2026-10-26' });
  });

  it('month covers the whole calendar month and lastMonth the previous one', () => {
    expect(selectionToRange(preset('month'), '2026-10-20')).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(selectionToRange(preset('lastMonth'), '2026-10-20')).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(selectionToRange(preset('lastMonth'), '2026-03-05')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(selectionToRange(preset('lastMonth'), '2028-03-05')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(selectionToRange(preset('lastMonth'), '2026-01-15')).toEqual({ from: '2025-12-01', to: '2025-12-31' });
  });

  it('all and today', () => {
    expect(selectionToRange(preset('all'), '2026-10-20')).toEqual(PERIOD_ALL);
    expect(selectionToRange(preset('today'), '2026-10-20')).toEqual({ from: '2026-10-20', to: '2026-10-20' });
  });
});

describe('custom ranges', () => {
  it('custom with from after to is reported and not applied', () => {
    const sel = custom('2026-10-20', '2026-10-01');
    expect(periodError(sel)).toBe(PERIOD_COPY.invalid);
    expect(selectionToRange(sel, '2026-10-20')).toEqual(PERIOD_ALL);
  });

  it('custom rejects a day that does not exist', () => {
    expect(periodError(custom('2026-02-30', ''))).toBe(PERIOD_COPY.badDay);
  });

  it('custom with one end keeps the other open', () => {
    expect(selectionToRange(custom('2026-10-01', ''), '2026-10-20')).toEqual({ from: '2026-10-01', to: null });
  });

  it('periodQuery drops open ends', () => {
    expect(periodQuery({ from: '2026-10-01', to: null })).toEqual({ from: '2026-10-01' });
    expect(periodQuery({ from: null, to: null })).toEqual({});
  });
});

describe('instants and sales', () => {
  it('instantInPeriod uses the Sao Paulo day, not the UTC day', () => {
    const range = { from: '2026-10-20', to: '2026-10-20' };
    expect(instantInPeriod('2026-10-21T01:30:00.000Z', range)).toBe(true);
    expect(instantInPeriod('2026-10-20T02:59:00.000Z', range)).toBe(false);
    expect(instantInPeriod('2026-10-20T03:00:00.000Z', range)).toBe(true);
  });

  it('an open range matches any instant, an invalid instant matches nothing once a bound is set', () => {
    expect(instantInPeriod('not a date', PERIOD_ALL)).toBe(true);
    expect(instantInPeriod('not a date', { from: '2026-10-01', to: null })).toBe(false);
  });

  it('saleReferenceInstant: won uses wonAt, everything else createdAt; a won sale without wonAt falls back to createdAt', () => {
    expect(saleReferenceInstant({ status: 'won', wonAt: '2026-10-10T12:00:00.000Z', createdAt: '2026-09-01T12:00:00.000Z' })).toBe(
      '2026-10-10T12:00:00.000Z',
    );
    expect(saleReferenceInstant({ status: 'open', wonAt: '2026-10-10T12:00:00.000Z', createdAt: '2026-09-01T12:00:00.000Z' })).toBe(
      '2026-09-01T12:00:00.000Z',
    );
    expect(saleReferenceInstant({ status: 'won', wonAt: null, createdAt: '2026-09-01T12:00:00.000Z' })).toBe(
      '2026-09-01T12:00:00.000Z',
    );
  });

  it('filterSalesByPeriod keeps a won sale by its won day even when it was created earlier', () => {
    const sale = { status: 'won', wonAt: '2026-10-10T12:00:00.000Z', createdAt: '2026-09-01T12:00:00.000Z' };
    expect(filterSalesByPeriod([sale], { from: '2026-10-01', to: '2026-10-31' })).toEqual([sale]);
    expect(filterSalesByPeriod([sale], { from: '2026-09-01', to: '2026-09-30' })).toEqual([]);
    expect(filterSalesByPeriod([sale], PERIOD_ALL)).toEqual([sale]);
  });
});
