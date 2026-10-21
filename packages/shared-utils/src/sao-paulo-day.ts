/**
 * Civil days in America/Sao_Paulo.
 *
 * Storage is unchanged: a civil day D is stored in a timestamptz as D T00:00:00Z
 * and read back with the UTC slice. Only decisions about "today" (the clock) go
 * through this module, because the UTC slice of an instant is one day ahead of
 * Sao Paulo between 21:00 and 23:59 local time.
 */
export const SAO_PAULO_TIME_ZONE = 'America/Sao_Paulo';

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

const saoPauloDayFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: SAO_PAULO_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function saoPauloDayOf(instant: Date): string {
  if (!(instant instanceof Date) || Number.isNaN(instant.getTime())) {
    throw new RangeError('invalid_instant');
  }
  const parts = saoPauloDayFormatter.formatToParts(instant);
  const part = (type: 'year' | 'month' | 'day') =>
    parts.find((candidate) => candidate.type === type)?.value ?? '';
  return `${part('year').padStart(4, '0')}-${part('month')}-${part('day')}`;
}

export function todayInSaoPaulo(now: Date = new Date()): string {
  return saoPauloDayOf(now);
}

export function isIsoDay(value: string): boolean {
  if (typeof value !== 'string') return false;
  const match = ISO_DAY.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(0);
  probe.setUTCFullYear(year, month - 1, day);
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

export function isAfterTodayInSaoPaulo(day: string, now: Date = new Date()): boolean {
  if (!isIsoDay(day)) throw new RangeError('invalid_iso_day');
  return day > todayInSaoPaulo(now);
}

/** Brazil has no daylight saving time since 2019, so a Sao Paulo midnight is 03:00Z. */
const SAO_PAULO_OFFSET_HOURS = 3;

/** The civil day after `day` (`YYYY-MM-DD`), by calendar arithmetic and never through the local timezone. */
export function addDaysToIsoDay(day: string, days: number): string {
  if (!isIsoDay(day)) throw new RangeError('invalid_iso_day');
  const [year, month, date] = day.split('-').map(Number) as [number, number, number];
  const moved = new Date(Date.UTC(year, month - 1, date + days));
  return moved.toISOString().slice(0, 10);
}

/**
 * A civil-day range in America/Sao_Paulo (both ends inclusive, both optional) as the half-open
 * instant interval `[start, endExclusive)`: `from` 00:00 -03:00 up to the day AFTER `to` 00:00 -03:00.
 * A lead created at 02:30Z on day D+1 is 23:30 on day D in Sao Paulo and belongs to day D.
 * Used for every period filter on a timestamp column; a `date` column compares the civil days directly.
 */
export function saoPauloDayRangeToInstants(
  from?: string | null,
  to?: string | null,
): { start: Date | null; endExclusive: Date | null } {
  const midnight = (day: string) => {
    const [year, month, date] = day.split('-').map(Number) as [number, number, number];
    return new Date(Date.UTC(year, month - 1, date, SAO_PAULO_OFFSET_HOURS));
  };
  if (from != null && !isIsoDay(from)) throw new RangeError('invalid_iso_day');
  if (to != null && !isIsoDay(to)) throw new RangeError('invalid_iso_day');
  return {
    start: from == null ? null : midnight(from),
    endExclusive: to == null ? null : midnight(addDaysToIsoDay(to, 1)),
  };
}
