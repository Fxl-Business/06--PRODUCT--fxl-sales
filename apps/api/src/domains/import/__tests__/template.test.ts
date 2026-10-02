import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { parseWorkbook } from '../parse.js';
import {
  NUM_FMT,
  REQUIRED_HEADER_ARGB,
  REQUIRED_NOTE_PREFIX,
  buildExampleDataset,
  buildLeiameLines,
  buildListColumns,
  buildTemplateWorkbook,
  createTemplateWorkbook,
  listIdOf,
} from '../template.js';
import { LEIAME_TAB, LISTAS_TAB, SHEET_KEYS, WORKBOOK_SHEETS, getSheetDef, type ColumnDef } from '../workbook-schema.js';
import type { ImportCatalog, ProductCatalogEntry } from '../types.js';

function catalogFixture(overrides: Partial<ImportCatalog> = {}): ImportCatalog {
  return {
    today: '2026-10-02',
    producerFlowLive: false,
    settings: { defaultSellerCommissionPct: 10, defaultFinderCommissionPct: 3, defaultTaxPct: 6 },
    areas: [],
    funcoes: [],
    products: [],
    people: [],
    clients: [],
    stages: [],
    ...overrides,
  };
}

function productLiteral(id: string, name: string, status: string): ProductCatalogEntry {
  return {
    id,
    name,
    codeSuffix: '1',
    kind: 'product',
    areaId: null,
    status,
    setupBrl: 0,
    hasMonthly: false,
    monthlyBrl: 0,
    recurringCommission: false,
    hasFinderCommission: false,
    sellerCommissionType: 'pct',
    sellerCommissionValue: 10,
    sellerWithFinderCommissionType: 'pct',
    sellerWithFinderCommissionValue: 10,
    finderCommissionType: 'pct',
    finderCommissionValue: 3,
    defaultPaymentMethod: 'pix',
    defaultEntradaMode: 'none',
    defaultEntradaPct: null,
    defaultEntradaBrl: null,
    defaultRemainingInstallments: 1,
    defaultRecurringCycles: null,
    productFuncaoCosts: [],
  };
}

function populatedCatalog(): ImportCatalog {
  return catalogFixture({
    areas: [
      { id: 'a1', name: 'Tecnologia', status: 'active' },
      { id: 'a2', name: 'Antiga', status: 'archived' },
    ],
    funcoes: [
      { id: 'f1', name: 'Vendedor', slug: 'vendedor', isSystem: true, status: 'active' },
      { id: 'f2', name: 'Finder', slug: 'finder', isSystem: true, status: 'active' },
      { id: 'f3', name: 'Designer', slug: 'designer', isSystem: false, status: 'active' },
      { id: 'f4', name: 'Velha', slug: 'velha', isSystem: false, status: 'archived' },
    ],
    products: [productLiteral('p1', 'Site', 'active'), productLiteral('p2', 'Legado', 'archived')],
    people: [
      { id: 'u1', displayName: 'Zé Vendas', contactEmail: null, status: 'active', funcaoSlugs: ['vendedor'], funcaoIds: ['f1'] },
      { id: 'u2', displayName: 'ana finder', contactEmail: null, status: 'active', funcaoSlugs: ['finder'], funcaoIds: ['f2'] },
      { id: 'u3', displayName: 'Inativo', contactEmail: null, status: 'inactive', funcaoSlugs: ['vendedor'], funcaoIds: ['f1'] },
      { id: 'u4', displayName: 'Beto', contactEmail: null, status: 'active', funcaoSlugs: ['designer'], funcaoIds: ['f3'] },
    ],
    clients: [
      { id: 'c1', name: 'Padaria', document: null },
      { id: 'c2', name: 'padaria', document: null },
      { id: 'c3', name: 'Ótica', document: null },
    ],
    stages: [
      { id: 's1', name: 'Novo', kind: 'normal', status: 'active', position: 1 },
      { id: 's2', name: 'Proposta', kind: 'conversion', status: 'active', position: 3 },
      { id: 's3', name: 'Perdido', kind: 'lost', status: 'active', position: 4 },
      { id: 's4', name: 'Arquivada', kind: 'normal', status: 'archived', position: 2 },
    ],
  });
}

async function reload(buf: Buffer): Promise<ExcelJS.Workbook> {
  const ab = new ArrayBuffer(buf.byteLength);
  new Uint8Array(ab).set(buf);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(ab);
  return wb;
}

function noteText(cell: ExcelJS.Cell): string {
  const note = cell.note;
  if (typeof note === 'string') return note;
  if (note && typeof note === 'object' && 'texts' in note) {
    return (note.texts ?? []).map((t) => t.text).join('');
  }
  return '';
}

function sheet(wb: ExcelJS.Workbook, name: string): ExcelJS.Worksheet {
  const ws = wb.getWorksheet(name);
  if (!ws) throw new Error(`missing sheet ${name}`);
  return ws;
}

describe('template workbook', () => {
  it('writes Leia-me first, the 13 data tabs in contract order and a hidden Listas tab last', async () => {
    for (const example of [false, true]) {
      const wb = await reload(await buildTemplateWorkbook(catalogFixture(), { example }));
      expect(wb.worksheets.map((w) => w.name)).toEqual([LEIAME_TAB, ...WORKBOOK_SHEETS.map((s) => s.tab), LISTAS_TAB]);
      for (const ws of wb.worksheets) expect(ws.state).toBe(ws.name === LISTAS_TAB ? 'hidden' : 'visible');
    }
  });

  it("writes every data tab's header row exactly as workbook-schema", async () => {
    const wb = await reload(await buildTemplateWorkbook(populatedCatalog(), { example: false }));
    for (const def of WORKBOOK_SHEETS) {
      const ws = sheet(wb, def.tab);
      const row = ws.getRow(1);
      def.columns.forEach((c, i) => expect(row.getCell(i + 1).value).toBe(c.header));
      expect(row.cellCount).toBe(def.columns.length);
    }
  });

  it('freezes and styles the header row, marking required columns by fill and note only', async () => {
    const wb = createTemplateWorkbook(catalogFixture(), { example: false });
    const back = await reload(Buffer.from(await wb.xlsx.writeBuffer()));
    for (const def of WORKBOOK_SHEETS) {
      const ws = sheet(wb, def.tab);
      expect(ws.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
      const rb = sheet(back, def.tab);
      def.columns.forEach((c, i) => {
        const cell = ws.getCell(1, i + 1);
        expect(cell.font?.bold).toBe(true);
        const fill = cell.fill;
        const argb = fill && fill.type === 'pattern' ? fill.fgColor?.argb : undefined;
        expect(argb === REQUIRED_HEADER_ARGB).toBe(c.required);
        expect(noteText(rb.getCell(1, i + 1))).toBe(c.required ? REQUIRED_NOTE_PREFIX + c.help : c.help);
        expect(c.header.endsWith('*')).toBe(false);
      });
    }
  });

  it('formats day, money, pct, int, text and list columns', () => {
    const wb = createTemplateWorkbook(catalogFixture(), { example: false });
    for (const def of WORKBOOK_SHEETS) {
      const ws = sheet(wb, def.tab);
      def.columns.forEach((c, i) => {
        const fmt = ws.getColumn(i + 1).numFmt;
        const t = c.kind.type;
        if (t === 'text' || t === 'list') expect(fmt).toBe(NUM_FMT.text);
        else if (t === 'money') expect(fmt).toBe(NUM_FMT.money);
        else if (t === 'int') expect(fmt).toBe(NUM_FMT.int);
        else if (t === 'pct') expect(fmt).toBe(NUM_FMT.pct);
        else if (t === 'day') expect(fmt).toBe(NUM_FMT.day);
        else expect(fmt).toBeUndefined();
      });
    }
    const pagamentos = getSheetDef('pagamentos');
    const idx = pagamentos.columns.findIndex((c) => c.key === 'parcela');
    expect(sheet(wb, pagamentos.tab).getColumn(idx + 1).numFmt).toBe('@');
  });

  it('fills Listas with active cadastros, system funções and enum labels', () => {
    const cols = buildListColumns(populatedCatalog());
    expect(cols.slice(0, 8).map((c) => c.id)).toEqual([
      'areas', 'funcoes', 'produtos', 'pessoas', 'vendedores', 'finders', 'clientes', 'etapas',
    ]);
    const by = (id: string) => cols.find((c) => c.id === id)?.values;
    expect(by('areas')).toEqual(['Tecnologia']);
    expect(by('funcoes')).toEqual(['Designer', 'Finder', 'Vendedor']);
    expect(by('produtos')).toEqual(['Site']);
    expect(by('pessoas')).toEqual(['ana finder', 'Beto', 'Zé Vendas']);
    expect(by('vendedores')).toEqual(['Zé Vendas']);
    expect(by('finders')).toEqual(['ana finder']);
    expect(by('clientes')).toEqual(['Ótica', 'Padaria']);
    expect(by('etapas')).toEqual(['Novo', 'Perdido']);
    expect(cols.some((c) => c.header === 'Sim/Não' && c.values.join() === 'Sim,Não')).toBe(true);
    const situacao = getSheetDef('propostas').columns.find((c) => c.key === 'situacao');
    const labels = situacao && situacao.kind.type === 'enum' ? situacao.kind.options.map((o) => o.label) : [];
    expect(cols.some((c) => c.values.join() === labels.join())).toBe(true);

    const empty = buildListColumns(catalogFixture());
    expect(empty.find((c) => c.id === 'funcoes')?.values).toEqual(['Finder', 'Vendedor']);
    for (const id of ['areas', 'produtos', 'pessoas', 'vendedores', 'finders', 'clientes', 'etapas']) {
      expect(empty.find((c) => c.id === id)?.values).toEqual([]);
    }
  });

  it('writes the Listas tab cells the dropdowns point at', async () => {
    const cat = populatedCatalog();
    const wb = await reload(await buildTemplateWorkbook(cat, { example: false }));
    const ws = sheet(wb, LISTAS_TAB);
    buildListColumns(cat).forEach((col, i) => {
      expect(ws.getCell(1, i + 1).value).toBe(col.header);
      col.values.forEach((v, r) => expect(ws.getCell(r + 2, i + 1).value).toBe(v));
    });
  });

  it('adds a list validation to every column with a list source over rows 2 to maxRows + 1', async () => {
    const cat = populatedCatalog();
    const wb = await reload(await buildTemplateWorkbook(cat, { example: false }));
    const listas = sheet(wb, LISTAS_TAB);
    const lists = buildListColumns(cat);
    for (const def of WORKBOOK_SHEETS) {
      const ws = sheet(wb, def.tab);
      for (let j = 1; j <= def.columns.length; j++) {
        const c = def.columns[j - 1];
        const id = c ? listIdOf(c) : null;
        const first = ws.getCell(2, j).dataValidation;
        if (!c || id === null) {
          expect(first?.type).toBeUndefined();
          continue;
        }
        const list = lists.find((l) => l.id === id);
        if (!list || list.values.length === 0) continue;
        const idx = lists.findIndex((l) => l.id === id);
        const letter = listas.getColumn(idx + 1).letter;
        const formula = `'Listas'!$${letter}$2:$${letter}$${list.values.length + 1}`;
        for (const row of [2, def.maxRows + 1]) {
          const dv = ws.getCell(row, j).dataValidation;
          expect(dv.type).toBe('list');
          expect(dv.formulae[0]).toBe(formula);
        }
        expect(ws.getCell(def.maxRows + 2, j).dataValidation?.type).toBeUndefined();
      }
    }
  });

  it('blocks enum dropdowns and never blocks reference dropdowns', async () => {
    const cat = populatedCatalog();
    const lists = buildListColumns(cat);
    const wb = await reload(await buildTemplateWorkbook(cat, { example: false }));
    for (const def of WORKBOOK_SHEETS) {
      const ws = sheet(wb, def.tab);
      const defColumns: readonly ColumnDef[] = def.columns;
      defColumns.forEach((c, i) => {
        const id = listIdOf(c);
        if (id === null) return;
        const dv = ws.getCell(2, i + 1).dataValidation;
        if (c.list === 'enum') {
          expect(dv.showErrorMessage).toBe(true);
          expect(dv.errorStyle).toBe('stop');
          for (const v of lists.find((l) => l.id === id)?.values ?? []) expect(dv.error).toContain(v);
        } else {
          expect(dv.showErrorMessage).toBeFalsy();
        }
      });
    }
  });

  it('skips the dropdown of an empty reference list', async () => {
    const wb = await reload(await buildTemplateWorkbook(catalogFixture(), { example: false }));
    const col = (key: SheetKeyName, k: string) => {
      const def = getSheetDef(key);
      return def.columns.findIndex((c) => c.key === k) + 1;
    };
    expect(sheet(wb, 'Produtos').getCell(2, col('produtos', 'area')).dataValidation?.type).toBeUndefined();
    expect(sheet(wb, 'Custos por produto').getCell(2, col('custosProduto', 'funcao')).dataValidation.type).toBe('list');
    expect(sheet(wb, 'Produtos').getCell(2, col('produtos', 'tipo')).dataValidation.type).toBe('list');
  });

  it('the blank template parses to zero issues and empty sheets', async () => {
    for (const cat of [catalogFixture(), populatedCatalog()]) {
      const buf = await buildTemplateWorkbook(cat, { example: false });
      const parsed = await parseWorkbook(buf);
      expect(parsed.issues).toEqual([]);
      for (const k of SHEET_KEYS) expect(parsed.sheets[k].rows).toEqual([]);
      const wb = createTemplateWorkbook(cat, { example: false });
      for (const def of WORKBOOK_SHEETS) expect(sheet(wb, def.tab).actualRowCount).toBe(1);
    }
  }, 20_000);

  it('the example template parses to zero parser issues and exactly the example dataset', async () => {
    for (const today of ['2026-10-02', '2027-03-01']) {
      const parsed = await parseWorkbook(await buildTemplateWorkbook(catalogFixture({ today }), { example: true }));
      expect(parsed.issues).toEqual([]);
      const dataset = buildExampleDataset(today);
      for (const k of SHEET_KEYS) {
        expect(parsed.sheets[k].rows.map((r) => r.cells)).toEqual(dataset[k]);
        expect(parsed.sheets[k].rows.map((r) => r.row)).toEqual(dataset[k].map((_, i) => i + 2));
      }
    }
  }, 20_000);

  it('example mode keeps the blank layout', async () => {
    const cat = populatedCatalog();
    const a = await reload(await buildTemplateWorkbook(cat, { example: false }));
    const b = await reload(await buildTemplateWorkbook(cat, { example: true }));
    expect(b.worksheets.map((w) => w.name)).toEqual(a.worksheets.map((w) => w.name));
    for (const def of WORKBOOK_SHEETS) {
      const wa = sheet(a, def.tab);
      const wbb = sheet(b, def.tab);
      def.columns.forEach((_, i) => {
        expect(wbb.getCell(1, i + 1).value).toBe(wa.getCell(1, i + 1).value);
        expect(wbb.getCell(2, i + 1).dataValidation).toEqual(wa.getCell(2, i + 1).dataValidation);
      });
    }
  }, 20_000);

  it('writes percentages as fractions and money as reais', () => {
    const wb = createTemplateWorkbook(catalogFixture(), { example: true });
    const def = getSheetDef('produtos');
    const cell = (key: string) => sheet(wb, def.tab).getCell(2, def.columns.findIndex((c) => c.key === key) + 1);
    expect(cell('comissaoVendedorPct').value).toBe(0.1);
    expect(cell('comissaoVendedorPct').numFmt).toBe(NUM_FMT.pct);
    expect(cell('valor').value).toBe(5000);
    expect(cell('valor').numFmt).toBe(NUM_FMT.money);
    const prop = getSheetDef('propostas');
    const base = sheet(wb, prop.tab).getCell(2, prop.columns.findIndex((c) => c.key === 'dataBase') + 1).value;
    expect(base).toBeInstanceOf(Date);
    expect((base as Date).getTime()).toBe(Date.UTC(2026, 0, 15));
    const pag = getSheetDef('pagamentos');
    expect(sheet(wb, pag.tab).getCell(2, pag.columns.findIndex((c) => c.key === 'parcela') + 1).value).toBe('1/1');
  });

  it('Leia-me has one pt-BR sentence per row and covers the rules', async () => {
    const lines = buildLeiameLines(catalogFixture(), { example: false });
    const dash = String.fromCharCode(0x2014);
    for (const l of lines) expect(l.text).not.toContain(dash);
    for (const l of lines.filter((x) => x.kind === 'body')) {
      expect(/[.:]$/.test(l.text)).toBe(true);
      expect(/[.!?]\s+[A-ZÀ-Ý]/.test(l.text)).toBe(false);
    }
    const text = lines.map((l) => l.text).join('\n');
    for (const def of WORKBOOK_SHEETS) {
      expect(text).toContain(def.tab);
      for (const c of def.columns) expect(text).toContain(c.header);
    }
    for (const s of [
      'Ref', 'proposta simples', 'proposta completa', 'nunca altera', 'dd/mm/aaaa', '1.234,56',
      'aba vazia', 'outros custos', 'FXL Finance', 'envie o arquivo de novo', '5000',
    ]) {
      expect(text).toContain(s);
    }
    const example = 'Esta é a planilha de exemplo';
    const finance = 'Esta organização está conectada ao FXL Finance';
    expect(text).not.toContain(example);
    expect(text).not.toContain(finance);
    expect(buildLeiameLines(catalogFixture(), { example: true }).map((l) => l.text).join('\n')).toContain(example);
    expect(
      buildLeiameLines(catalogFixture({ producerFlowLive: true }), { example: false }).map((l) => l.text).join('\n'),
    ).toContain(finance);

    const wb = await reload(await buildTemplateWorkbook(catalogFixture(), { example: false }));
    const ws = sheet(wb, LEIAME_TAB);
    expect(ws.getCell('A1').value).toBe(lines[0]?.text);
    let r = 1;
    lines.forEach((l, i) => {
      if (l.kind === 'heading' && i > 0) r += 1;
      expect(ws.getCell(r, 1).value).toBe(l.text);
      expect(ws.getCell(r, 2).value).toBeNull();
      r += 1;
    });
  });

  it('derives no metadata from the clock', () => {
    for (let i = 0; i < 2; i++) {
      const wb = createTemplateWorkbook(catalogFixture(), { example: false });
      expect(wb.created.getTime()).toBe(Date.parse('2026-10-02T12:00:00.000Z'));
    }
  });
});

type SheetKeyName = (typeof SHEET_KEYS)[number];
