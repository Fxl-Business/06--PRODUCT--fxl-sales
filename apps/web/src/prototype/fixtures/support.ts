import { addDaysToIsoDay } from '@fxl-sales/shared-utils/sao-paulo-day';

/**
 * Helpers shared by the prototype fixtures. Everything here is pure: the day the
 * fixtures hang from is an ARGUMENT, so a reload seeds the same world for the same
 * day and no fixture reads the clock itself.
 */

const KIND_PREFIX = {
  org: 1,
  person: 2,
  funcao: 3,
  area: 4,
  client: 5,
  product: 6,
  sale: 7,
  item: 8,
  receivable: 9,
  payable: 10,
  professional: 11,
  settlement: 12,
  pipeline: 13,
  stage: 14,
  lead: 15,
  field: 16,
  followup: 17,
  history: 18,
  cost: 19,
} as const;

export type IdKind = keyof typeof KIND_PREFIX;

/** A stable uuid-shaped id: the kind picks the first block, `n` the last. */
export function fid(kind: IdKind, n: number): string {
  const head = KIND_PREFIX[kind].toString(16).padStart(8, '0');
  return `${head}-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

export type Clock = {
  /** The Sao Paulo civil day the fixtures hang from. */
  today: string;
  /** `today` shifted by `days` (negative is the past). */
  day: (days: number) => string;
  /** An ISO instant at 15:00Z on that day, so every timezone reads the same civil day. */
  at: (days: number) => string;
  /** `due_date` form: a civil day stored as midnight UTC. */
  due: (days: number) => string;
};

export function makeClock(today: string): Clock {
  return {
    today,
    day: (days) => addDaysToIsoDay(today, days),
    at: (days) => `${addDaysToIsoDay(today, days)}T15:00:00.000Z`,
    due: (days) => `${addDaysToIsoDay(today, days)}T00:00:00.000Z`,
  };
}
