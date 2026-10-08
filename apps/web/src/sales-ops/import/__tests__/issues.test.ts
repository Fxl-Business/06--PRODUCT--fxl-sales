import { describe, expect, it } from 'vitest';
import {
  groupImportIssues,
  issueLocation,
  nonZeroCounts,
  recognizedClientCount,
  totalCount,
} from '../issues';
import { SHEET_KEYS, SHEET_LABELS, type ImportIssue } from '../types';

const issue = (over: Partial<ImportIssue>): ImportIssue => ({
  severity: 'error',
  sheet: null,
  row: null,
  column: null,
  code: 'x',
  message: 'm',
  ...over,
});

describe('import issues', () => {
  it('orders errors before warnings and groups by sheet in workbook order with Arquivo first', () => {
    const grouped = groupImportIssues([
      issue({ severity: 'warning', sheet: 'propostas', row: 4 }),
      issue({ sheet: 'areas', row: 9 }),
      issue({ sheet: null }),
      issue({ sheet: 'areas', row: 3 }),
      issue({ sheet: 'leads', row: 2 }),
    ]);
    expect(grouped.errors.map((g) => g.label)).toEqual(['Arquivo', 'Áreas', 'Leads']);
    expect(grouped.errors[1]?.issues.map((i) => i.row)).toEqual([3, 9]);
    expect(grouped.warnings.map((g) => g.label)).toEqual(['Propostas']);
    expect(grouped.errorCount).toBe(4);
    expect(grouped.warningCount).toBe(1);
  });

  it('formats the location as Linha N · Coluna', () => {
    expect(issueLocation(issue({ row: 7, column: 'Cliente' }))).toBe('Linha 7 · Cliente');
    expect(issueLocation(issue({ row: 1, column: 'Vendedor' }))).toBe('Linha 1 · Vendedor');
    expect(issueLocation(issue({ row: null, column: 'Valor' }))).toBe('Valor');
    expect(issueLocation(issue({ row: 12, column: null }))).toBe('Linha 12');
    expect(issueLocation(issue({ sheet: 'areas' }))).toBe('Aba inteira');
    expect(issueLocation(issue({}))).toBe('Arquivo inteiro');
  });

  it('keeps only non-zero counts in sheet order', () => {
    const counts = { propostas: 2, areas: 0, clientes: 5, leads: undefined };
    expect(nonZeroCounts(counts)).toEqual([
      { sheet: 'clientes', label: 'Clientes', count: 5 },
      { sheet: 'propostas', label: 'Propostas', count: 2 },
    ]);
    expect(totalCount(counts)).toBe(7);
  });

  it('recognizedClientCount reads recognized.clientes and reads absent, zero or invalid as zero', () => {
    expect(recognizedClientCount({ recognized: { clientes: 114 } })).toBe(114);
    expect(recognizedClientCount({})).toBe(0);
    expect(recognizedClientCount({ recognized: {} })).toBe(0);
    expect(recognizedClientCount({ recognized: { clientes: 0 } })).toBe(0);
    expect(recognizedClientCount({ recognized: { clientes: Number.NaN } })).toBe(0);
    expect(recognizedClientCount({ recognized: { leads: 3 } })).toBe(0);
  });

  it('SHEET_LABELS names the tabs of the seam contract in order', () => {
    expect(SHEET_KEYS.map((k) => SHEET_LABELS[k])).toEqual([
      'Áreas',
      'Funções',
      'Produtos',
      'Custos por produto',
      'Pessoas',
      'Clientes',
      'Etapas',
      'Leads',
      'Propostas',
      'Itens da proposta',
      'Profissionais da proposta',
      'Parcelas',
      'Pagamentos',
    ]);
  });
});
