import { addDaysToIsoDay, isIsoDay, saoPauloDayOf } from '@fxl-sales/shared-utils/sao-paulo-day';

/**
 * Period filter model shared by every list (propostas, prospecção, funil, follow-ups).
 * Pure and React-free. Civil days are `America/Sao_Paulo` days; "today" is always passed
 * in by the caller (`todayInSaoPaulo()`), never read from the clock here.
 */

export type PeriodPreset = 'all' | 'today' | 'last7' | 'last30' | 'next7' | 'month' | 'lastMonth' | 'custom';
/** `from` and `to` are only read for `custom`. */
export type PeriodSelection = { preset: PeriodPreset; from: string; to: string };
/** Inclusive ISO civil days; `null` is an open end. */
export type PeriodRange = { from: string | null; to: string | null };

export const PERIOD_ALL: PeriodRange = { from: null, to: null };
export const PERIOD_ALL_SELECTION: PeriodSelection = { preset: 'all', from: '', to: '' };

export const PERIOD_COPY = {
  label: 'Período',
  from: 'De',
  to: 'Até',
  invalid: 'A data inicial não pode ser depois da final.',
  badDay: 'Informe uma data válida.',
} as const;

export const PERIOD_PRESET_LABEL: Record<PeriodPreset, string> = {
  all: 'Todo o período',
  today: 'Hoje',
  last7: 'Últimos 7 dias',
  last30: 'Últimos 30 dias',
  next7: 'Próximos 7 dias',
  month: 'Este mês',
  lastMonth: 'Mês passado',
  custom: 'Personalizado',
};

export const DEFAULT_PERIOD_PRESETS: readonly PeriodPreset[] = [
  'all',
  'today',
  'last7',
  'last30',
  'month',
  'lastMonth',
  'custom',
];

/** Last calendar day of the month that holds `day`. Civil-day arithmetic, not a clock read. */
function endOfMonth(day: string): string {
  const [year, month] = day.split('-').map(Number) as [number, number];
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}

function startOfMonth(day: string): string {
  return `${day.slice(0, 7)}-01`;
}

type RangeForToday = (today: string) => PeriodRange;

const PRESET_RANGE: Record<Exclude<PeriodPreset, 'custom'>, RangeForToday> = {
  all: () => PERIOD_ALL,
  today: (today) => ({ from: today, to: today }),
  last7: (today) => ({ from: addDaysToIsoDay(today, -6), to: today }),
  last30: (today) => ({ from: addDaysToIsoDay(today, -29), to: today }),
  next7: (today) => ({ from: today, to: addDaysToIsoDay(today, 6) }),
  month: (today) => ({ from: startOfMonth(today), to: endOfMonth(today) }),
  lastMonth: (today) => {
    const previous = addDaysToIsoDay(startOfMonth(today), -1);
    return { from: startOfMonth(previous), to: endOfMonth(previous) };
  },
};

/** The custom range the operator typed is reported when it is malformed, and never applied. */
export function periodError(selection: PeriodSelection): string | null {
  if (selection.preset !== 'custom') return null;
  const { from, to } = selection;
  if ((from !== '' && !isIsoDay(from)) || (to !== '' && !isIsoDay(to))) return PERIOD_COPY.badDay;
  if (from !== '' && to !== '' && from > to) return PERIOD_COPY.invalid;
  return null;
}

export function selectionToRange(selection: PeriodSelection, today: string): PeriodRange {
  if (selection.preset === 'custom') {
    if (periodError(selection) !== null) return PERIOD_ALL;
    return { from: selection.from || null, to: selection.to || null };
  }
  return PRESET_RANGE[selection.preset](today);
}

export function periodQuery(range: PeriodRange): { from?: string; to?: string } {
  return {
    ...(range.from !== null ? { from: range.from } : {}),
    ...(range.to !== null ? { to: range.to } : {}),
  };
}

export function dayInPeriod(day: string, range: PeriodRange): boolean {
  return (range.from === null || day >= range.from) && (range.to === null || day <= range.to);
}

/** An instant belongs to the period by its Sao Paulo civil day. */
export function instantInPeriod(iso: string, range: PeriodRange): boolean {
  if (range.from === null && range.to === null) return true;
  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) return false;
  return dayInPeriod(saoPauloDayOf(instant), range);
}

/** Won sales are dated by the won day; everything else by its creation. */
export function saleReferenceInstant(sale: { status: string; wonAt: string | null; createdAt: string }): string {
  return sale.status === 'won' && sale.wonAt ? sale.wonAt : sale.createdAt;
}

export function filterSalesByPeriod<T extends { status: string; wonAt: string | null; createdAt: string }>(
  sales: readonly T[],
  range: PeriodRange,
): T[] {
  return sales.filter((sale) => instantInPeriod(saleReferenceInstant(sale), range));
}
