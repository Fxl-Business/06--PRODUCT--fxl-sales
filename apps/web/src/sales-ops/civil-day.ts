import { todayInSaoPaulo } from '@fxl-sales/shared-utils/sao-paulo-day';
import { formatIsoDateBr } from './calculations';

/**
 * The stored civil day of a due_date/base_date value: the API stores day D as
 * D T00:00:00Z, so the first ten characters ARE the day. Never `new Date(value)`
 * in the browser timezone, which prints the previous day west of UTC.
 */
export function civilDayOf(value: string): string {
  return value.slice(0, 10);
}

/** `dd/mm/aaaa` of a stored civil day; accepts a timestamp or a date-only string. */
export function displayDate(value: string): string {
  return formatIsoDateBr(civilDayOf(value));
}

/** The default for a date input: today in America/Sao_Paulo, not the UTC day. */
export function inputDateToday(now: Date = new Date()): string {
  return todayInSaoPaulo(now);
}
