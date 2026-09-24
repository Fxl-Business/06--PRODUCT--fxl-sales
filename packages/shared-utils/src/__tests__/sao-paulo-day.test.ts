process.env.TZ = 'Asia/Tokyo';

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  isAfterTodayInSaoPaulo,
  isIsoDay,
  saoPauloDayOf,
  todayInSaoPaulo,
} from '../sao-paulo-day.js';
import * as indexExports from '../index.js';

describe('process timezone positive control', () => {
  it('the process timezone is Asia/Tokyo (positive control)', () => {
    expect(new Date('2026-03-01T01:30:00Z').getHours()).toBe(10);
  });
});

describe('saoPauloDayOf', () => {
  it('keeps an instant just after UTC midnight on the previous Sao Paulo day', () => {
    expect(saoPauloDayOf(new Date('2026-03-01T01:30:00Z'))).toBe('2026-02-28');
    expect(saoPauloDayOf(new Date('2026-03-01T02:59:59.999Z'))).toBe('2026-02-28');
    expect(saoPauloDayOf(new Date('2026-03-01T03:00:00Z'))).toBe('2026-03-01');
    expect(saoPauloDayOf(new Date('2026-12-31T23:30:00Z'))).toBe('2026-12-31');
    expect(saoPauloDayOf(new Date('2027-01-01T02:00:00Z'))).toBe('2026-12-31');
  });

  it('follows historical Brazilian daylight saving', () => {
    expect(saoPauloDayOf(new Date('2018-11-05T02:30:00Z'))).toBe('2018-11-05');
  });

  it('refuses an invalid instant', () => {
    expect(() => saoPauloDayOf(new Date('nope'))).toThrow(RangeError);
  });
});

describe('todayInSaoPaulo', () => {
  it('reads the injected clock', () => {
    expect(todayInSaoPaulo(new Date('2026-03-01T01:30:00Z'))).toBe('2026-02-28');
  });
});

describe('isIsoDay', () => {
  it('accepts only real calendar days', () => {
    expect(isIsoDay('2026-02-28')).toBe(true);
    expect(isIsoDay('2024-02-29')).toBe(true);
    expect(isIsoDay('2026-12-31')).toBe(true);
    expect(isIsoDay('0001-01-01')).toBe(true);

    expect(isIsoDay('2026-02-29')).toBe(false);
    expect(isIsoDay('2026-02-30')).toBe(false);
    expect(isIsoDay('2026-04-31')).toBe(false);
    expect(isIsoDay('2026-13-01')).toBe(false);
    expect(isIsoDay('2026-00-10')).toBe(false);
    expect(isIsoDay('2026-01-00')).toBe(false);
    expect(isIsoDay('2026-1-01')).toBe(false);
    expect(isIsoDay('2026-01-01T00:00:00Z')).toBe(false);
    expect(isIsoDay(' 2026-01-01')).toBe(false);
    expect(isIsoDay('')).toBe(false);
  });
});

describe('isAfterTodayInSaoPaulo', () => {
  it('compares against the Sao Paulo day, not the UTC day', () => {
    const now = new Date('2026-03-01T01:30:00Z');
    expect(isAfterTodayInSaoPaulo('2026-03-01', now)).toBe(true);
    expect(isAfterTodayInSaoPaulo('2026-02-28', now)).toBe(false);
    expect(isAfterTodayInSaoPaulo('2026-02-27', now)).toBe(false);
  });

  it('refuses a malformed day', () => {
    expect(() => isAfterTodayInSaoPaulo('2026-02-30')).toThrow(RangeError);
  });
});

describe('package exports', () => {
  it('the package root and the subpath export the Sao Paulo day helpers', () => {
    expect(typeof indexExports.todayInSaoPaulo).toBe('function');
    expect(typeof indexExports.saoPauloDayOf).toBe('function');
    expect(typeof indexExports.isIsoDay).toBe('function');
    expect(typeof indexExports.isAfterTodayInSaoPaulo).toBe('function');

    const pkg = JSON.parse(
      readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
    );
    expect(pkg.exports['./sao-paulo-day']).toEqual({
      types: './dist/sao-paulo-day.d.ts',
      import: './dist/sao-paulo-day.js',
    });
  });
});
