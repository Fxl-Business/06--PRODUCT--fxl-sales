import { describe, expect, it } from 'vitest';
import { addDaysToIsoDay, saoPauloDayOf, saoPauloDayRangeToInstants } from '../sao-paulo-day.js';

describe('saoPauloDayRangeToInstants', () => {
  it('turns inclusive civil days into [from 00:00 -03:00, to+1 00:00 -03:00)', () => {
    const { start, endExclusive } = saoPauloDayRangeToInstants('2026-10-20', '2026-10-20');
    expect(start!.toISOString()).toBe('2026-10-20T03:00:00.000Z');
    expect(endExclusive!.toISOString()).toBe('2026-10-21T03:00:00.000Z');
  });

  it('puts 02:30Z of day D+1 inside day D and 03:00Z inside D+1', () => {
    const { start, endExclusive } = saoPauloDayRangeToInstants('2026-10-20', '2026-10-20');
    const inside = new Date('2026-10-21T02:30:00.000Z');
    expect(inside >= start! && inside < endExclusive!).toBe(true);
    expect(saoPauloDayOf(inside)).toBe('2026-10-20');
    const next = new Date('2026-10-21T03:00:00.000Z');
    expect(next < endExclusive!).toBe(false);
    expect(saoPauloDayOf(next)).toBe('2026-10-21');
  });

  it('leaves an open end null and refuses an impossible day', () => {
    expect(saoPauloDayRangeToInstants(undefined, undefined)).toEqual({ start: null, endExclusive: null });
    expect(saoPauloDayRangeToInstants('2026-10-20', null).endExclusive).toBeNull();
    expect(() => saoPauloDayRangeToInstants('2026-02-30', null)).toThrow(RangeError);
  });

  it('adds days across month and year ends', () => {
    expect(addDaysToIsoDay('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDaysToIsoDay('2026-03-01', -1)).toBe('2026-02-28');
  });
});
