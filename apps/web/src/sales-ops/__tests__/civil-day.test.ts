process.env.TZ = 'America/Sao_Paulo';

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { displayDate, inputDateToday } from '../civil-day';
import { formatIsoDateBr } from '../calculations';

describe('process timezone positive control', () => {
  it('the process timezone is negative-offset (positive control)', () => {
    expect(new Date('2026-03-01T00:00:00.000Z').getDate()).toBe(28);
  });
});

describe('displayDate', () => {
  it('prints the stored civil day of a UTC-midnight timestamp in a negative-offset timezone', () => {
    expect(displayDate('2026-03-01T00:00:00.000Z')).toBe('01/03/2026');
    expect(displayDate('2026-03-01')).toBe('01/03/2026');
  });
});

describe('formatIsoDateBr', () => {
  it('accepts a full timestamp', () => {
    expect(formatIsoDateBr('2026-03-01T00:00:00.000Z')).toBe('01/03/2026');
  });
});

describe('inputDateToday', () => {
  it('is the Sao Paulo day, not the UTC day, near UTC midnight', () => {
    expect(inputDateToday(new Date('2026-03-01T01:30:00Z'))).toBe('2026-02-28');
    expect(inputDateToday(new Date('2026-03-01T03:30:00Z'))).toBe('2026-03-01');
  });
});

describe('source guard', () => {
  it('no sales-ops web source derives today from the UTC clock', () => {
    const dir = fileURLToPath(new URL('..', import.meta.url));
    const entries = readdirSync(dir, { recursive: true }) as string[];
    const files = entries.filter(
      (entry) =>
        (entry.endsWith('.ts') || entry.endsWith('.tsx')) && !entry.includes('__tests__'),
    );

    // Vacuity control: the directory must be substantial and must include the
    // two files we know derive dates.
    expect(files.length).toBeGreaterThan(20);
    expect(files).toContain('SalesOpsApp.tsx');
    expect(files).toContain('civil-day.ts');

    const utcSlicePattern = /new Date\(\)\.toISOString\(\)\.slice\(0,\s*10\)/;
    for (const file of files) {
      const source = readFileSync(path.join(dir, file), 'utf8');
      expect(source).not.toMatch(utcSlicePattern);
    }
  });
});
