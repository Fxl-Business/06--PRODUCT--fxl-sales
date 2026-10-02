import { describe, expect, it } from 'vitest';
import { AreaSchema, PersonSchema, ProductSchema } from '../../sales-ops/service.js';
import {
  PLACEHOLDER_UUID,
  countOperations,
  erroredRowKeys,
  joinPt,
  planKeyOf,
  rowError,
  rowWarning,
  withoutKeys,
  zodIssuesToImportIssues,
} from '../plan/plan-helpers.js';
import type { ImportOperation } from '../types.js';

describe('plan-helpers', () => {
  it('builds planKeys as sheet colon row', () => {
    expect(planKeyOf('produtos', 7)).toBe('produtos:7');
  });

  it('collects only error rows into erroredRowKeys', () => {
    const keys = erroredRowKeys([
      rowError('areas', 2, 'Nome', 'x', 'm'),
      rowWarning('areas', 3, 'Nome', 'x', 'm'),
      { severity: 'error', sheet: null, row: null, column: null, code: 'x', message: 'm' },
      { severity: 'error', sheet: 'produtos', row: null, column: null, code: 'x', message: 'm' },
    ]);
    expect([...keys]).toEqual(['areas:2']);
  });

  it('maps zod issues to header text with pt-BR messages', () => {
    const person = { displayName: 'Ana', contactEmail: 'x@', funcaoIds: [PLACEHOLDER_UUID] };
    const r1 = PersonSchema.safeParse(person);
    expect(r1.success).toBe(false);
    if (r1.success) return;
    const issues = zodIssuesToImportIssues(r1.error, {
      sheet: 'pessoas', row: 2, columns: { contactEmail: 'E-mail' }, fallbackColumn: null, values: person,
    });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ code: 'invalid_value', column: 'E-mail', severity: 'error', sheet: 'pessoas', row: 2 });
    expect(issues[0]?.message).toContain('"x@"');

    const area = { name: 'a'.repeat(121) };
    const r2 = AreaSchema.safeParse(area);
    if (r2.success) throw new Error('expected failure');
    expect(
      zodIssuesToImportIssues(r2.error, { sheet: 'areas', row: 2, columns: { name: 'Nome' }, fallbackColumn: null, values: area })[0]?.message,
    ).toBe('O texto passa do limite de 120 caracteres.');

    const product = {
      name: 'P', areaId: PLACEHOLDER_UUID, defaultEntradaMode: 'pct', defaultEntradaPct: null,
    };
    const r3 = ProductSchema.safeParse(product);
    if (r3.success) throw new Error('expected failure');
    expect(
      zodIssuesToImportIssues(r3.error, {
        sheet: 'produtos', row: 2, columns: { defaultEntradaMode: 'Entrada padrão (%)' }, fallbackColumn: null, values: product,
      })[0]?.message,
    ).toBe('Preencha a entrada padrão em percentual ou em valor, não nas duas colunas.');

    const r4 = AreaSchema.safeParse({ name: '' });
    if (r4.success) throw new Error('expected failure');
    const unmapped = zodIssuesToImportIssues(r4.error, {
      sheet: 'areas', row: 2, columns: {}, fallbackColumn: 'Fallback', values: {},
    });
    expect(unmapped[0]?.column).toBe('Fallback');
    expect(unmapped[0]?.message).toBe('Preencha a coluna "Fallback".');
  });

  it('withoutKeys drops keys without mutating the source', () => {
    const source = { a: 1, b: 2, c: 3 };
    const copy = withoutKeys(source, ['a', 'c']);
    expect(copy).toEqual({ b: 2 });
    expect(source).toEqual({ a: 1, b: 2, c: 3 });
  });

  it('countOperations omits zero counts', () => {
    const ops: ImportOperation[] = [
      { op: 'createArea', planKey: 'areas:2', input: { name: 'A', status: 'active' } },
      { op: 'createArea', planKey: 'areas:3', input: { name: 'B', status: 'active' } },
      { op: 'createLeadStage', planKey: 'etapas:2', input: { name: 'E', status: 'active' } },
    ];
    const counts = countOperations(ops, (op) => (op.op === 'createArea' ? 'areas' : null));
    expect(counts).toEqual({ areas: 2 });
    expect('etapas' in counts).toBe(false);
  });

  it('joinPt joins with commas and e', () => {
    expect(joinPt([])).toBe('');
    expect(joinPt(['A'])).toBe('A');
    expect(joinPt(['A', 'B'])).toBe('A e B');
    expect(joinPt(['A', 'B', 'C'])).toBe('A, B e C');
  });
});
