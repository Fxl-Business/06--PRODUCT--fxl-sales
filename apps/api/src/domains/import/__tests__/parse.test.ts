import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { cellReader, parseWorkbook } from '../parse.js';
import { SHEET_KEYS, WORKBOOK_SHEETS } from '../workbook-schema.js';
import { buildXlsx, exampleTabs, headerRow } from './xlsx-fixture.js';

describe('parseWorkbook', () => {
  it('parses a minimal Áreas tab', async () => {
    const out = await parseWorkbook(await buildXlsx([{ name: 'Áreas', rows: [['Nome'], ['Tecnologia']] }]));
    expect(out.sheets.areas.rows).toEqual([{ row: 2, cells: { nome: 'Tecnologia' } }]);
    expect(out.issues).toEqual([]);
  });

  it('returns every SheetKey even when absent', async () => {
    const out = await parseWorkbook(await buildXlsx([{ name: 'Áreas', rows: [['Nome'], ['A']] }]));
    expect(Object.keys(out.sheets)).toEqual([...SHEET_KEYS]);
    expect(out.sheets.funcoes).toEqual({ key: 'funcoes', rows: [] });
  });

  it('matches tab names ignoring case and accents', async () => {
    const out = await parseWorkbook(
      await buildXlsx([
        { name: 'areas', rows: [['Nome'], ['A']] },
        { name: 'FUNCOES', rows: [['Nome'], ['F']] },
      ]),
    );
    expect(out.sheets.areas.rows).toHaveLength(1);
    expect(out.sheets.funcoes.rows).toHaveLength(1);
  });

  it('matches headers ignoring case, accents and order', async () => {
    const out = await parseWorkbook(
      await buildXlsx([{ name: 'Produtos', rows: [['área', 'NOME'], ['Tecnologia', 'Sistema']] }]),
    );
    expect(out.sheets.produtos.rows[0]?.cells.area).toBe('Tecnologia');
    expect(out.sheets.produtos.rows[0]?.cells.nome).toBe('Sistema');
    expect(out.issues).toEqual([]);
  });

  it('skips blank rows without renumbering', async () => {
    const out = await parseWorkbook(
      await buildXlsx([{ name: 'Áreas', rows: [['Nome'], ['A'], [null], ['   '], ['B']] }]),
    );
    expect(out.sheets.areas.rows.map((r) => r.row)).toEqual([2, 5]);
  });

  it('treats a header-only or absent tab as empty and reports nothing', async () => {
    const out = await parseWorkbook(
      await buildXlsx([
        { name: 'Etapas', rows: [['Nome']] },
        { name: 'Áreas', rows: [['Cor']] },
        { name: 'Clientes', rows: [['Nome'], ['Padaria']] },
      ]),
    );
    expect(out.sheets.etapas.rows).toEqual([]);
    expect(out.sheets.areas.rows).toEqual([]);
    expect(out.issues).toEqual([]);
  });

  it('reports a missing required column once at row 1', async () => {
    const out = await parseWorkbook(await buildXlsx([{ name: 'Produtos', rows: [['Nome'], ['A'], ['B']] }]));
    const missing = out.issues.filter((i) => i.code === 'missing_column');
    expect(missing).toHaveLength(1);
    expect(missing[0]).toMatchObject({ sheet: 'produtos', row: 1, column: 'Área', severity: 'error' });
    expect(out.issues.some((i) => i.code === 'required' && i.column === 'Área')).toBe(false);
  });

  it('fills a missing optional column with null silently', async () => {
    const out = await parseWorkbook(
      await buildXlsx([{ name: 'Produtos', rows: [['Nome', 'Área'], ['A', 'T']] }]),
    );
    expect(out.sheets.produtos.rows[0]?.cells.tipo).toBeNull();
    expect(out.issues).toEqual([]);
  });

  it("warns about an unknown column using the user's header text", async () => {
    const out = await parseWorkbook(
      await buildXlsx([{ name: 'Áreas', rows: [['Nome', 'Cor favorita'], ['A', 'azul']] }]),
    );
    expect(out.issues).toHaveLength(1);
    expect(out.issues[0]).toMatchObject({ severity: 'warning', code: 'unknown_column', column: 'Cor favorita', row: 1 });
  });

  it('refuses a duplicated column', async () => {
    const out = await parseWorkbook(await buildXlsx([{ name: 'Áreas', rows: [['Nome', 'Nome'], ['A', 'B']] }]));
    expect(out.issues.filter((i) => i.code === 'duplicate_column')).toHaveLength(1);
    expect(out.sheets.areas.rows[0]?.cells.nome).toBe('A');
  });

  it('reports a blank required cell with sheet, Excel row and header', async () => {
    const out = await parseWorkbook(
      await buildXlsx([{ name: 'Produtos', rows: [['Nome', 'Área'], ['A', 'T'], [null, 'T']] }]),
    );
    expect(out.issues).toHaveLength(1);
    expect(out.issues[0]).toMatchObject({ sheet: 'produtos', row: 3, column: 'Nome', code: 'required' });
  });

  it('reports a coercion failure with header text and a pt-BR message', async () => {
    const out = await parseWorkbook(
      await buildXlsx([{ name: 'Parcelas', rows: [['Ref', 'Vencimento', 'Valor (R$)'], ['P1', '20/01/2026', 'abc']] }]),
    );
    expect(out.issues).toHaveLength(1);
    expect(out.issues[0]).toMatchObject({ sheet: 'parcelas', row: 2, column: 'Valor (R$)', code: 'invalid_money' });
    expect(out.issues[0]?.message).toContain('"abc"');
    expect(out.sheets.parcelas.rows[0]?.cells.valor).toBeNull();
  });

  it('reads Date cells as UTC civil days', async () => {
    const out = await parseWorkbook(
      await buildXlsx([
        { name: 'Parcelas', rows: [['Ref', 'Vencimento', 'Valor (R$)'], ['P1', new Date(Date.UTC(2026, 0, 20)), 10]] },
      ]),
    );
    expect(out.sheets.parcelas.rows[0]?.cells.vencimento).toBe('2026-01-20');
    expect(out.issues).toEqual([]);
  });

  it('reads percent-formatted cells as percentages', async () => {
    const out = await parseWorkbook(
      await buildXlsx([
        {
          name: 'Custos por produto',
          rows: [['Produto', 'Função', 'Custo (%)'], ['P', 'F', { value: 0.2, numFmt: '0%' }]],
        },
      ]),
    );
    expect(out.sheets.custosProduto.rows[0]?.cells.custoPct).toBe(20);
  });

  it('unwraps rich text, hyperlinks and cached formula results', async () => {
    const out = await parseWorkbook(
      await buildXlsx([
        {
          name: 'Pessoas',
          rows: [
            ['Nome', 'E-mail', 'Funções'],
            [{ richText: [{ text: 'Ana ' }, { text: 'Souza' }] }, { text: 'ana@x.com', hyperlink: 'mailto:ana@x.com' }, 'Vendedor'],
          ],
        },
        { name: 'Parcelas', rows: [['Ref', 'Vencimento', 'Valor (R$)'], ['P1', '20/01/2026', { formula: '2500*2', result: 5000 }]] },
      ]),
    );
    expect(out.sheets.pessoas.rows[0]?.cells.nome).toBe('Ana Souza');
    expect(out.sheets.pessoas.rows[0]?.cells.email).toBe('ana@x.com');
    expect(out.sheets.parcelas.rows[0]?.cells.valor).toBe(500000);
  });

  it('refuses a formula without a cached result and an Excel error cell', async () => {
    const out = await parseWorkbook(
      await buildXlsx([
        {
          name: 'Parcelas',
          rows: [
            ['Ref', 'Vencimento', 'Valor (R$)'],
            ['P1', '20/01/2026', { formula: '1+1' }],
            ['P2', '20/01/2026', { error: '#N/A' }],
          ],
        },
      ]),
    );
    expect(out.issues.map((i) => i.code)).toEqual(['formula_without_result', 'cell_error']);
  });

  it('ignores Leia-me and a hidden Listas tab, warns on other tabs', async () => {
    const out = await parseWorkbook(
      await buildXlsx([
        { name: 'Leia-me', rows: [['Instruções']] },
        { name: 'Listas', rows: [['x']], hidden: true },
        { name: 'Rascunho do João', rows: [['a']] },
        { name: 'Áreas', rows: [['Nome'], ['A']] },
      ]),
    );
    expect(out.issues).toHaveLength(1);
    expect(out.issues[0]).toMatchObject({ code: 'unknown_sheet', severity: 'warning', sheet: null });
    expect(out.issues[0]?.message).toContain('Rascunho do João');
  });

  it('refuses two tabs that map to the same sheet', async () => {
    const out = await parseWorkbook(
      await buildXlsx([
        { name: 'Áreas', rows: [['Nome'], ['A']] },
        { name: 'areas', rows: [['Nome'], ['B']] },
      ]),
    );
    const dup = out.issues.filter((i) => i.code === 'duplicate_sheet');
    expect(dup).toHaveLength(1);
    expect(dup[0]).toMatchObject({ severity: 'error', sheet: 'areas' });
  });

  it('turns a non-xlsx buffer into one invalid_file issue without throwing', async () => {
    for (const bytes of [Buffer.from('hello'), Buffer.alloc(0), randomBytes(64)]) {
      const out = await parseWorkbook(bytes);
      expect(out.issues).toHaveLength(1);
      expect(out.issues[0]?.code).toBe('invalid_file');
      for (const k of SHEET_KEYS) expect(out.sheets[k].rows).toEqual([]);
    }
  });

  it('refuses an xlsx with no template tab', async () => {
    const out = await parseWorkbook(await buildXlsx([{ name: 'Plan1', rows: [['a']] }]));
    expect(out.issues.map((i) => i.code)).toEqual(['unknown_sheet', 'no_known_sheets']);
    expect(out.issues.find((i) => i.code === 'no_known_sheets')?.severity).toBe('error');
  });

  it('refuses a sheet over its maxRows', async () => {
    const rows: string[][] = [['Nome']];
    for (let i = 0; i < 51; i++) rows.push([`E${i}`]);
    const out = await parseWorkbook(await buildXlsx([{ name: 'Etapas', rows }]));
    expect(out.issues).toHaveLength(1);
    expect(out.issues[0]).toMatchObject({ code: 'too_many_rows', sheet: 'etapas', row: null });
    expect(out.sheets.etapas.rows).toEqual([]);
  });

  it('refuses a workbook over MAX_TOTAL_ROWS', { timeout: 30000 }, async () => {
    const clientes: string[][] = [['Nome']];
    for (let i = 0; i < 3000; i++) clientes.push([`C${i}`]);
    const leads: string[][] = [['Contato', 'Empresa']];
    for (let i = 0; i < 2001; i++) leads.push([`L${i}`, `E${i}`]);
    const out = await parseWorkbook(
      await buildXlsx([
        { name: 'Clientes', rows: clientes },
        { name: 'Leads', rows: leads },
      ]),
    );
    expect(out.issues).toHaveLength(1);
    expect(out.issues[0]).toMatchObject({ code: 'too_many_rows', sheet: null });
    for (const k of SHEET_KEYS) expect(out.sheets[k].rows).toEqual([]);
  });

  it('accepts a Uint8Array as well as a Buffer', async () => {
    const buf = await buildXlsx([{ name: 'Áreas', rows: [['Nome'], ['A']] }]);
    expect(await parseWorkbook(new Uint8Array(buf))).toEqual(await parseWorkbook(buf));
  });

  it('orders issues by file, sheet order, row, then column', async () => {
    const out = await parseWorkbook(
      await buildXlsx([
        { name: 'Parcelas', rows: [['Ref', 'Vencimento', 'Valor (R$)'], ['P1', 'x', 'abc'], ['P2', 'y', 'def']] },
        { name: 'Rascunho', rows: [['a']] },
        { name: 'Produtos', rows: [['Nome', 'Área'], [null, 'T']] },
      ]),
    );
    expect(out.issues.map((i) => [i.sheet, i.row, i.column])).toEqual([
      [null, null, null],
      ['produtos', 2, 'Nome'],
      ['parcelas', 2, 'Vencimento'],
      ['parcelas', 2, 'Valor (R$)'],
      ['parcelas', 3, 'Vencimento'],
      ['parcelas', 3, 'Valor (R$)'],
    ]);
  });

  it('round-trips the example row of every sheet with zero issues', async () => {
    const tabs = exampleTabs();
    expect(tabs.map((t) => t.rows[0])).toEqual(WORKBOOK_SHEETS.map((s) => headerRow(s.key)));
    const out = await parseWorkbook(await buildXlsx(tabs));
    expect(out.issues).toEqual([]);
    for (const def of WORKBOOK_SHEETS) {
      expect(out.sheets[def.key].rows.map((r) => r.row)).toEqual([2]);
    }
    const cell = (k: (typeof SHEET_KEYS)[number], c: string) => out.sheets[k].rows[0]?.cells[c];
    expect(cell('produtos', 'valor')).toBe(500000);
    expect(cell('propostas', 'situacao')).toBe('won');
    expect(cell('propostas', 'dataBase')).toBe('2026-01-15');
    expect(cell('pessoas', 'funcoes')).toEqual(['Vendedor', 'Desenvolvedor']);
    expect(cell('custosProduto', 'custoPct')).toBe(20);
    expect(cell('pagamentos', 'repassesPagos')).toBe(true);
    expect(cell('pagamentos', 'parcela')).toBe('1/1');
  });

  it('cellReader returns typed values and throws on a type mismatch', async () => {
    const out = await parseWorkbook(await buildXlsx(exampleTabs()));
    const prod = out.sheets.produtos.rows[0]!;
    expect(cellReader('produtos', prod).number('valor')).toBe(500000);
    expect(cellReader('produtos', prod).text('nome')).toBe('Sistema de gestão');
    expect(cellReader('produtos', prod).bool('temMensalidade')).toBe(true);
    expect(cellReader('produtos', prod).text('codigo' as 'nome')).toBeNull();
    expect(cellReader('pessoas', out.sheets.pessoas.rows[0]!).list('funcoes')).toEqual(['Vendedor', 'Desenvolvedor']);
    expect(() => cellReader('produtos', prod).number('nome')).toThrow(TypeError);
  });
});
