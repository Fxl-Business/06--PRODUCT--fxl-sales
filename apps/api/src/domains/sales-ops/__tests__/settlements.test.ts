import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  RecordSettlementSchema,
  ReverseSettlementSchema,
  attachSettlementState,
  isReversesUniqueViolation,
} from '../settlements.js';

type Fact = Parameters<typeof attachSettlementState>[1][number];

function baixa(id: string, paidOn: string, amountBrl: number, target: Partial<Fact> = {}): Fact {
  return {
    id,
    type: 'baixa',
    reversesSettlementId: null,
    paidOn,
    amountBrl,
    receivableId: 'r1',
    payableId: null,
    ...target,
  };
}

function estorno(id: string, reverses: string, paidOn: string, amountBrl: number): Fact {
  return {
    id,
    type: 'estorno',
    reversesSettlementId: reverses,
    paidOn,
    amountBrl,
    receivableId: 'r1',
    payableId: null,
  };
}

describe('attachSettlementState', () => {
  it('gives paidOn null without facts and the greatest active day with facts', () => {
    const rows = [
      { id: 'r1', amountBrl: 300 },
      { id: 'r2', amountBrl: 100 },
    ];
    const facts = [
      baixa('b1', '2026-09-10', 100),
      baixa('b2', '2026-09-12', 100),
      estorno('e2', 'b2', '2026-09-13', 100),
    ];
    const attached = attachSettlementState(rows, facts, 'receivable');
    expect(attached.find((r) => r.id === 'r1')?.paidOn).toBe('2026-09-10');
    expect(attached.find((r) => r.id === 'r2')?.paidOn).toBeNull();

    const more = attachSettlementState(rows, [...facts, baixa('b3', '2026-09-20', 100)], 'receivable');
    expect(more.find((r) => r.id === 'r1')?.paidOn).toBe('2026-09-20');
  });

  it('groups by the column that matches the kind', () => {
    const facts = [baixa('b1', '2026-09-10', 100, { receivableId: null, payableId: 'same-id' })];
    const receivables = attachSettlementState([{ id: 'same-id', amountBrl: 100 }], facts, 'receivable');
    expect(receivables[0]?.paidOn).toBeNull();
    const payables = attachSettlementState([{ id: 'same-id', amountBrl: 100 }], facts, 'payable');
    expect(payables[0]?.paidOn).toBe('2026-09-10');
  });
});

describe('settlement schemas', () => {
  const targetId = '55555555-5555-4555-8555-555555555555';

  it('RecordSettlementSchema refuses an amount in the body', () => {
    expect(RecordSettlementSchema.safeParse({ targetKind: 'receivable', targetId }).success).toBe(true);
    expect(
      RecordSettlementSchema.safeParse({ targetKind: 'receivable', targetId, amountBrl: 1 }).success,
    ).toBe(false);
  });

  it('ReverseSettlementSchema trims the reason and refuses more than 500 characters', () => {
    const parsed = ReverseSettlementSchema.safeParse({ reason: '  pago em duplicidade  ' });
    expect(parsed.success && parsed.data.reason).toBe('pago em duplicidade');
    expect(ReverseSettlementSchema.safeParse({ reason: 'x'.repeat(500) }).success).toBe(true);
    expect(ReverseSettlementSchema.safeParse({ reason: 'x'.repeat(501) }).success).toBe(false);
  });
});

describe('isReversesUniqueViolation', () => {
  it('reads the wrapped cause', () => {
    const pg = { code: '23505', constraint_name: 'sales_ops_settlements_one_estorno_per_baixa_idx' };
    expect(isReversesUniqueViolation(pg)).toBe(true);
    expect(isReversesUniqueViolation(Object.assign(new Error('wrapped'), { cause: pg }))).toBe(true);
    expect(
      isReversesUniqueViolation({ cause: { code: '23505', constraint_name: 'other_idx' } }),
    ).toBe(false);
    expect(isReversesUniqueViolation({ cause: { code: '23503', constraint_name: pg.constraint_name } })).toBe(
      false,
    );
  });
});

describe('settlements.ts source guard', () => {
  it('writes only manual facts and holds no integration code', () => {
    const source = readFileSync(fileURLToPath(new URL('../settlements.ts', import.meta.url)), 'utf8');
    expect(source.length).toBeGreaterThan(1000);
    expect(source).toContain("origin: 'manual'");
    expect(source).not.toMatch(/origin:\s*'finance'/);
    expect(source).not.toMatch(/\bfetch\(/);
    expect(source).not.toMatch(/outbox/i);
    expect(source).not.toMatch(/FXL_FINANCE|FXL_HUB/);
  });
});
