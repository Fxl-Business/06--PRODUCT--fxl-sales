import { describe, expect, it } from 'vitest';
import {
  coerceCell,
  coercePctList,
  normalizeLabel,
  rawCell,
  type RawCell,
  type RawScalar,
} from '../cells.js';
import type { CellKind } from '../workbook-schema.js';
import { PAYMENT_METHOD_OPTIONS, SALE_STATUS_OPTIONS } from '../workbook-schema.js';

const money: CellKind = { type: 'money' };
const run = (kind: CellKind, v: RawScalar, percent = false) => coerceCell(kind, rawCell(v, percent));
const val = (kind: CellKind, v: RawScalar, percent = false) => {
  const r = run(kind, v, percent);
  if (!r.ok) throw new Error(`expected ok, got ${r.code}: ${r.message}`);
  return r.value;
};
const code = (kind: CellKind, v: RawScalar, percent = false) => {
  const r = run(kind, v, percent);
  if (r.ok) throw new Error(`expected failure, got ${JSON.stringify(r.value)}`);
  return r.code;
};

describe('coerceCell money', () => {
  it('parses Brazilian currency text to cents', () => {
    expect(val(money, 'R$ 1.234,56')).toBe(123456);
    expect(val(money, '1234,56')).toBe(123456);
    expect(val(money, 'R$ 1.234,56')).toBe(123456);
    expect(val(money, 'R$ 0,00')).toBe(0);
    expect(val(money, '1,5')).toBe(150);
  });
  it('reads dots as thousands only in groups of three', () => {
    expect(val(money, '1.234')).toBe(123400);
    expect(val(money, '1.500.000')).toBe(150000000);
    expect(val(money, '1234.5')).toBe(123450);
    expect(val(money, '1.50')).toBe(150);
  });
  it('converts numeric cells to cents without float drift', () => {
    expect(val(money, 1234.56)).toBe(123456);
    expect(val(money, 0.1 + 0.2)).toBe(30);
    expect(val(money, 10)).toBe(1000);
  });
  it('refuses negatives, extra decimals, garbage and overflow', () => {
    expect(code(money, '-5')).toBe('negative_value');
    expect(code(money, -1)).toBe('negative_value');
    expect(code(money, '1,234')).toBe('too_many_decimals');
    expect(code(money, 1.005)).toBe('too_many_decimals');
    expect(code(money, 'abc')).toBe('invalid_money');
    expect(code(money, '12,34,5')).toBe('invalid_money');
    expect(code(money, 21474836.48)).toBe('out_of_range');
    expect(code(money, true)).toBe('invalid_money');
  });
});

describe('coerceCell int', () => {
  const int: CellKind = { type: 'int', min: 1, max: 120 };
  it('coerces integers and refuses the rest', () => {
    expect(val(int, 3)).toBe(3);
    expect(val(int, ' 3 ')).toBe(3);
    expect(code(int, 2.5)).toBe('invalid_int');
    expect(code(int, '3,0')).toBe('invalid_int');
    expect(code(int, 0)).toBe('out_of_range');
    expect(code(int, 121)).toBe('out_of_range');
  });
});

describe('coerceCell pct', () => {
  const pct: CellKind = { type: 'pct' };
  it('coerces percentages', () => {
    expect(val(pct, 10)).toBe(10);
    expect(val(pct, '10%')).toBe(10);
    expect(val(pct, '12,5 %')).toBe(12.5);
    expect(val(pct, '12.5')).toBe(12.5);
    expect(val(pct, 0.1, true)).toBe(10);
    expect(val(pct, 0.125, true)).toBe(12.5);
    expect(val(pct, 0.1)).toBe(0.1);
    expect(code(pct, 101)).toBe('out_of_range');
    expect(code(pct, '-1')).toBe('out_of_range');
    expect(code(pct, 'dez')).toBe('invalid_pct');
  });
});

describe('coerceCell day', () => {
  const day: CellKind = { type: 'day' };
  it('takes the UTC civil day of a Date', () => {
    expect(val(day, new Date(Date.UTC(2026, 0, 15)))).toBe('2026-01-15');
    expect(val(day, new Date(Date.UTC(2026, 0, 15, 23, 59, 59)))).toBe('2026-01-15');
  });
  it('parses dd/mm/aaaa and ISO text', () => {
    expect(val(day, '15/01/2026')).toBe('2026-01-15');
    expect(val(day, '5/1/2026')).toBe('2026-01-05');
    expect(val(day, '2026-01-15')).toBe('2026-01-15');
  });
  it('converts an unformatted Excel serial', () => {
    expect(val(day, 46037)).toBe('2026-01-15');
    expect(val(day, 46037.75)).toBe('2026-01-15');
  });
  it('refuses impossible or ambiguous days', () => {
    for (const bad of ['31/02/2026', '2026-13-01', '15/01/26', '15-01-2026', '1899-12-31', 10, true]) {
      expect(code(day, bad)).toBe('invalid_day');
    }
  });
});

describe('coerceCell enum', () => {
  const status: CellKind = { type: 'enum', options: SALE_STATUS_OPTIONS };
  const method: CellKind = { type: 'enum', options: PAYMENT_METHOD_OPTIONS };
  it('matches labels and values ignoring case and accents', () => {
    for (const s of ['Ganha', 'ganha', 'GANHA', '  Ganha ']) expect(val(status, s)).toBe('won');
    expect(val(method, 'Cartao')).toBe('card');
    expect(val(method, 'pix')).toBe('pix');
  });
  it('lists the options on a miss', () => {
    const r = run(status, 'Fechada');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('invalid_option');
      expect(r.message).toContain('Rascunho, Aberta, Ganha, Perdida ou Cancelada');
    }
  });
});

describe('coerceCell bool', () => {
  const bool: CellKind = { type: 'bool' };
  it('coerces truthy and falsy spellings', () => {
    for (const t of ['Sim', 'sim', 'S', 'x', 'true', true, 1]) expect(val(bool, t)).toBe(true);
    for (const f of ['Não', 'nao', 'N', false, 0]) expect(val(bool, f)).toBe(false);
    expect(code(bool, 'talvez')).toBe('invalid_bool');
    expect(code(bool, 2)).toBe('invalid_bool');
  });
});

describe('coerceCell list', () => {
  it('splits, trims and dedupes', () => {
    const kind: CellKind = { type: 'list', max: 20 };
    expect(val(kind, 'A, B; c')).toEqual(['A', 'B', 'c']);
    expect(val(kind, 'Á; a; A')).toEqual(['Á']);
    expect(val(kind, ' ; , ')).toBeNull();
    expect(val(kind, 123)).toEqual(['123']);
    const many = Array.from({ length: 21 }, (_, i) => `n${i}`).join('; ');
    expect(code(kind, many)).toBe('too_many_items');
  });
});

describe('coerceCell text', () => {
  const text: CellKind = { type: 'text', max: 120 };
  it('trims, stringifies and limits', () => {
    expect(val(text, '  Ana  ')).toBe('Ana');
    expect(val(text, 123)).toBe('123');
    expect(code(text, 'a'.repeat(121))).toBe('too_long');
    expect(code(text, new Date(Date.UTC(2026, 0, 1)))).toBe('date_in_text_column');
  });
  it('treats null, empty and whitespace as blank for every kind', () => {
    const kinds: CellKind[] = [
      text,
      money,
      { type: 'int', min: 1, max: 2 },
      { type: 'pct' },
      { type: 'day' },
      { type: 'enum', options: SALE_STATUS_OPTIONS },
      { type: 'bool' },
      { type: 'list', max: 2 },
    ];
    for (const k of kinds) {
      for (const blank of [null, '', '   ']) {
        expect(run(k, blank)).toEqual({ ok: true, value: null });
      }
    }
  });
  it('reports formula and Excel error problems', () => {
    const f: RawCell = { value: null, percent: false, problem: 'formula_without_result' };
    const e: RawCell = { value: '#N/A', percent: false, problem: 'cell_error' };
    expect(coerceCell(text, f)).toMatchObject({ ok: false, code: 'formula_without_result' });
    expect(coerceCell(text, e)).toMatchObject({ ok: false, code: 'cell_error' });
  });
  it('messages are pt-BR and quote the value', () => {
    const r = run(money, 'abc');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).toContain('"abc"');
      expect(r.message).toContain('1.234,56');
    }
  });
});

describe('normalizeLabel', () => {
  it('trims, folds case and diacritics, collapses spaces', () => {
    expect(normalizeLabel('  Áreas ')).toBe('areas');
    expect(normalizeLabel('Funções')).toBe('funcoes');
    expect(normalizeLabel('Custos   por produto')).toBe('custos por produto');
  });
});

describe('coercePctList', () => {
  it('parses semicolon separated percentages', () => {
    expect(coercePctList('50; 50')).toEqual({ ok: true, value: [50, 50] });
    expect(coercePctList('12,5; 87,5')).toEqual({ ok: true, value: [12.5, 87.5] });
    expect(coercePctList('')).toEqual({ ok: true, value: null });
    expect(coercePctList('50; x')).toMatchObject({ ok: false, code: 'invalid_pct' });
    expect(coercePctList('50; 120')).toMatchObject({ ok: false, code: 'out_of_range' });
  });
});
