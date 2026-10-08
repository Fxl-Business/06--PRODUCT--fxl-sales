/**
 * D12 oracle: which Clientes rows ARE an existing cliente. Document digits first, then the
 * normalized name when every document attached to that name agrees; anything else is created.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { documentDigits, recognizeClientRows } from '../client-recognition.js';
import type { CellValue, ImportCatalog } from '../types.js';
import { seededCatalog, workbook } from './plan-fixtures.js';

const A = '00000000-0000-4000-8000-00000000a001';
const A2 = '00000000-0000-4000-8000-00000000a002';
const B = '00000000-0000-4000-8000-00000000b001';
const C1 = '00000000-0000-4000-8000-00000000c001';
const C2 = '00000000-0000-4000-8000-00000000c002';
const C3 = '00000000-0000-4000-8000-00000000c003';
const D = '00000000-0000-4000-8000-00000000d001';
const E = '00000000-0000-4000-8000-00000000e001';

type Client = ImportCatalog['clients'][number];
type Row = Record<string, CellValue>;

const run = (rows: Row[], clients: Client[]) =>
  [...recognizeClientRows(workbook({ clientes: rows }), seededCatalog({ clients }))];

const PADARIA: Client = { id: A, name: 'Padaria Pão Quente', document: '12.345.678/0001-90' };
const LOJAS: Client[] = [
  { id: C1, name: 'Loja Um', document: '55.555.555/0001-55' },
  { id: C2, name: 'Loja Dois', document: '55555555000155' },
  { id: C3, name: 'Loja Três', document: null },
];
const LOJAS_ROWS: Row[] = [
  { nome: 'loja dois', documento: '55.555.555/0001-55' },
  { nome: 'Loja Três', documento: '55.555.555/0001-55' },
];

describe('documentDigits', () => {
  it('documentDigits keeps only the digits and reads null as empty', () => {
    expect(documentDigits('12.345.678/0001-90')).toBe('12345678000190');
    expect(documentDigits(null)).toBe('');
    expect(documentDigits(undefined)).toBe('');
    expect(documentDigits('ISENTO')).toBe('');
  });
});

describe('recognizeClientRows', () => {
  it('recognizes a row by its document digits even under another name', () => {
    expect(run([{ nome: 'Padaria PQ', documento: '12345678000190' }], [PADARIA])).toEqual([
      [2, { existingId: A, name: 'Padaria Pão Quente' }],
    ]);
  });

  it('recognizes a row without a document by its normalized name', () => {
    expect(run([{ nome: 'PADARIA PAO QUENTE', documento: null }], [PADARIA])).toEqual([
      [2, { existingId: A, name: 'Padaria Pão Quente' }],
    ]);
  });

  it('recognizes by name when the existing cliente has no document and the row has one', () => {
    expect(
      run([{ nome: 'Mercado Sol', documento: '98.765.432/0001-10' }], [{ id: B, name: 'Mercado Sol', document: null }]),
    ).toEqual([[2, { existingId: B, name: 'Mercado Sol' }]]);
  });

  it('recognizes by name when neither side has a document', () => {
    expect(run([{ nome: 'mercado sol' }], [{ id: B, name: 'Mercado Sol', document: null }])).toEqual([
      [2, { existingId: B, name: 'Mercado Sol' }],
    ]);
  });

  it('does not recognize the same name with a different document', () => {
    expect(run([{ nome: 'Padaria Pão Quente', documento: '99.999.999/0001-99' }], [PADARIA])).toEqual([]);
  });

  it('does not recognize a name two existing clientes share when the row has no document', () => {
    expect(
      run([{ nome: 'Padaria Pão Quente' }], [PADARIA, { id: A2, name: 'Padaria Pão Quente', document: null }]),
    ).toEqual([]);
  });

  it('lets the document win over a name match to another cliente', () => {
    expect(
      run(
        [{ nome: 'Padaria Pão Quente', documento: '11111111000111' }],
        [
          { id: A, name: 'Padaria Pão Quente', document: null },
          { id: B, name: 'Outro Nome', document: '11.111.111/0001-11' },
        ],
      ),
    ).toEqual([[2, { existingId: B, name: 'Outro Nome' }]]);
  });

  it('narrows several clientes with the row document to the one with its name and never falls back to the name', () => {
    expect(run(LOJAS_ROWS, LOJAS)).toEqual([[2, { existingId: C2, name: 'Loja Dois' }]]);
  });

  it('does not recognize by name when the tab gives that name two different documents', () => {
    const loja: Client[] = [{ id: D, name: 'Loja', document: null }];
    expect(
      run(
        [
          { nome: 'Loja', documento: '111' },
          { nome: 'loja', documento: '222' },
        ],
        loja,
      ),
    ).toEqual([]);
    // Positive control: the same two rows agreeing on one document are both the existing cliente.
    expect(
      run(
        [
          { nome: 'Loja', documento: '111' },
          { nome: 'loja', documento: '111' },
        ],
        loja,
      ),
    ).toEqual([
      [2, { existingId: D, name: 'Loja' }],
      [3, { existingId: D, name: 'Loja' }],
    ]);
  });

  it('recognizes two rows as the same cliente', () => {
    expect(
      run([{ nome: 'Padaria Pão Quente' }, { nome: 'Padaria PQ', documento: '12.345.678/0001-90' }], [PADARIA]),
    ).toEqual([
      [2, { existingId: A, name: 'Padaria Pão Quente' }],
      [3, { existingId: A, name: 'Padaria Pão Quente' }],
    ]);
  });

  it('skips a row without a name and treats a document without digits as none', () => {
    expect(
      run(
        [
          { nome: null, documento: '12.345.678/0001-90' },
          { nome: 'Outra', documento: 'ISENTO' },
        ],
        [PADARIA, { id: E, name: 'Isenta', document: 'ISENTO' }],
      ),
    ).toEqual([]);
  });

  it('is pure and deterministic', () => {
    const parsed = workbook({ clientes: LOJAS_ROWS });
    const catalog = seededCatalog({ clients: LOJAS });
    const before = JSON.stringify([parsed, catalog]);
    const first = [...recognizeClientRows(parsed, catalog)];
    const second = [...recognizeClientRows(parsed, catalog)];
    expect(second).toEqual(first);
    expect(JSON.stringify([parsed, catalog])).toBe(before);

    expect(run(LOJAS_ROWS, [...LOJAS].reverse())).toEqual(run(LOJAS_ROWS, LOJAS));
    const padariaRows: Row[] = [{ nome: 'Padaria PQ', documento: '12345678000190' }];
    expect(run(padariaRows, [PADARIA].reverse())).toEqual(run(padariaRows, [PADARIA]));
  });

  it('source is pure', () => {
    const source = readFileSync(new URL('../client-recognition.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/new Date/);
    expect(source).not.toMatch(/process\.env/);
    expect(source).not.toMatch(/db\//);
    expect(source).not.toMatch(/sales-ops\//);
  });
});
