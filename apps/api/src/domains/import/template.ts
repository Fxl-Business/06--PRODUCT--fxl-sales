// The template is generated from WORKBOOK_SHEETS so the parser and the file can never disagree on a header.
// Reference dropdowns are suggestions (names may be created in the same workbook) while enum dropdowns block.
import ExcelJS from 'exceljs';
import { coerceCell, normalizeLabel, rawCell } from './cells.js';
import {
  BOOL_LABELS,
  LEIAME_TAB,
  LISTAS_TAB,
  MAX_TOTAL_ROWS,
  MAX_UPLOAD_BYTES,
  SHEET_KEYS,
  WORKBOOK_SHEETS,
  getSheetDef,
  type CellKind,
  type ColumnDef,
  type ColumnKey,
  type SheetDef,
} from './workbook-schema.js';
import type { CellValue, ImportCatalog, SheetKey } from './types.js';

export type TemplateOptions = { example: boolean };

/** Full rows: every column key of the sheet present, null where blank. Values are post-coercion (cents, ISO days, enum VALUES, booleans, string[]). */
export type ExampleRow = Readonly<Record<string, CellValue>>;
export type ExampleDataset = Readonly<Record<SheetKey, readonly ExampleRow[]>>;

export type LeiameLine = { kind: 'title' | 'heading' | 'body'; text: string };
export type ListColumn = { id: string; header: string; values: string[] };

export const NUM_FMT = {
  text: '@',
  money: '"R$" #,##0.00',
  int: '0',
  pct: '0.00%',
  day: 'dd/mm/yyyy',
} as const;
export const REQUIRED_HEADER_ARGB = 'FFFDE68A';
export const OPTIONAL_HEADER_ARGB = 'FFE2E8F0';
export const REQUIRED_NOTE_PREFIX = 'Obrigatória. ';

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}
function pad4(n: number): string {
  return String(n).padStart(4, '0');
}

function splitDay(day: string): { y: number; m: number; d: number } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new RangeError('invalid_iso_day');
  return { y: Number(day.slice(0, 4)), m: Number(day.slice(5, 7)), d: Number(day.slice(8, 10)) };
}

export function shiftCivilDay(day: string, days: number): string {
  const { y, m, d } = splitDay(day);
  const shifted = new Date(Date.UTC(y, m - 1, d + days));
  return `${pad4(shifted.getUTCFullYear())}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`;
}

export function listIdOf(column: ColumnDef): string | null {
  if (column.list === undefined) return null;
  if (column.list !== 'enum') return column.list;
  if (column.kind.type === 'bool') return 'enum:bool';
  if (column.kind.type === 'enum') return `enum:${column.kind.options.map((o) => o.value).join('|')}`;
  throw new Error(`column ${column.key} has list enum but kind ${column.kind.type}`);
}

// ---------------------------------------------------------------- Leia-me

const SHEET_PURPOSE: Record<SheetKey, string> = {
  areas: 'Áreas de atuação dos produtos e dos itens avulsos.',
  funcoes: 'Funções que as pessoas exercem, além de Vendedor e Finder, que já existem.',
  produtos: 'Produtos e serviços com valores, comissões e condições de pagamento padrão.',
  custosProduto: 'Custo padrão de cada função em um produto.',
  pessoas: 'Vendedores, finders e profissionais com as suas funções.',
  clientes: 'Clientes das propostas e dos leads.',
  etapas: 'Novas etapas do funil de leads.',
  leads: 'Leads da prospecção, cada um numa etapa do funil.',
  propostas: 'Propostas, uma por linha, identificadas pelo Ref.',
  itens: 'Itens de cada proposta completa.',
  profissionais: 'Profissionais e custos de cada proposta completa.',
  parcelas: 'Parcelas de cada proposta completa.',
  pagamentos: 'Parcelas já pagas de propostas Ganhas.',
};

export function buildLeiameLines(catalog: ImportCatalog, opts: TemplateOptions): LeiameLine[] {
  const lines: LeiameLine[] = [];
  const T = (text: string) => lines.push({ kind: 'title', text });
  const H = (text: string) => lines.push({ kind: 'heading', text });
  const B = (text: string) => lines.push({ kind: 'body', text });

  T('Modelo de importação do FXL Sales');
  if (opts.example) {
    B('Esta é a planilha de exemplo: as linhas preenchidas contam uma história completa e podem ser importadas numa organização nova para testar.');
  }
  if (catalog.producerFlowLive) {
    B('Esta organização está conectada ao FXL Finance, então propostas Ganhas e pagamentos serão recusados na conferência.');
  }
  H('Para que serve');
  B('Esta planilha importa cadastros, leads e propostas para a organização ativa no FXL Sales.');
  B('Use-a no onboarding para trazer tudo de uma vez ou depois para acrescentar só alguns registros, por exemplo mais algumas propostas.');
  H('Como preencher');
  B('Preencha só as abas que precisar e deixe as outras vazias.');
  B('Uma aba vazia, ou com apenas a linha de cabeçalho, é ignorada e não cria nada.');
  B('Não altere, renomeie nem apague os cabeçalhos da linha 1; a ordem das colunas pode mudar, mas o texto do cabeçalho precisa continuar igual.');
  B('Os cabeçalhos amarelos são colunas obrigatórias e os cinzas são opcionais; passe o mouse sobre um cabeçalho para ver a explicação da coluna.');
  B('As listas suspensas mostram os cadastros que já existem na organização, mas você também pode digitar nomes criados nesta mesma planilha.');
  H('Ordem das abas');
  B('As abas estão na ordem em que são importadas, e cada aba pode usar o que foi criado nas abas anteriores.');
  for (const def of WORKBOOK_SHEETS) B(`${def.tab}: ${SHEET_PURPOSE[def.key]}`);
  H('Ligação pelo Ref');
  B('Cada proposta tem um Ref que você escolhe, como P1 ou PROP-15, e que não pode se repetir na planilha.');
  B('As abas Itens da proposta, Profissionais da proposta, Parcelas e Pagamentos usam o mesmo Ref para dizer a qual proposta cada linha pertence.');
  B('O Ref só liga as linhas desta planilha e não é gravado na proposta.');
  B('Os outros cadastros são ligados pelo nome, e um produto também pode ser indicado pelo código no formato #3.');
  H('Proposta simples ou completa');
  B('Na proposta simples, preencha na aba Propostas o cliente, o vendedor, a data base e o produto; os itens, as parcelas e a recorrência vêm dos padrões do produto.');
  B('Na proposta completa, deixe Produto em branco na aba Propostas e descreva a proposta nas abas Itens da proposta, Profissionais da proposta e Parcelas.');
  B('Quando uma proposta tem linhas na aba Parcelas, a soma das parcelas precisa ser igual ao total dos itens.');
  B('Uma proposta Ganha precisa da Data de ganho, e as parcelas já pagas vão na aba Pagamentos.');
  B('Propostas Perdidas ou Canceladas entram no FXL Sales já com essa situação.');
  H('Só cria, nunca altera');
  B('A importação só cria registros novos e nunca altera nem apaga o que já existe.');
  B('Uma área, função, produto ou etapa com o mesmo nome de um cadastro existente é recusada; apague a linha, porque as outras abas já encontram o cadastro existente pelo nome.');
  B('Um cliente que já está no cadastro, com o mesmo CNPJ/CPF ou, sem conflito de CNPJ/CPF, com o mesmo nome, é reconhecido: a linha não cria outro cliente nem altera o existente, e as outras abas usam o cliente existente.');
  B('Pessoas parecidas com um cadastro existente, e clientes com o mesmo nome mas outro CNPJ/CPF, aparecem como aviso na conferência e não impedem a importação.');
  H('Datas, valores e percentuais');
  B('Digite as datas no formato dd/mm/aaaa, por exemplo 15/01/2026.');
  B('Nenhuma data de ganho ou de pagamento pode estar no futuro.');
  B('Digite valores em reais como 1.234,56 ou R$ 1.234,56, com no máximo dois dígitos de centavos.');
  B('Digite percentuais como 10 ou 12,5%.');
  B('Na coluna Parcela da aba Pagamentos, use rótulos como 1/3 para parcelas e M2/12 para mensalidades.');
  H('Limites desta versão');
  B('Pagamentos só podem ser registrados para parcelas e mensalidades, então outros custos pagos de uma vez devem ser baixados no FXL Sales depois da importação.');
  B('A coluna Repasses pagos também dá baixa nas comissões e custos ligados à parcela, no mesmo dia do pagamento.');
  B('Se a organização estiver conectada ao FXL Finance, propostas Ganhas e pagamentos não podem ser importados, porque esse histórico não chegaria ao Finance; cadastros, leads e propostas em Rascunho, Aberta, Perdida ou Cancelada continuam permitidos.');
  B(`Uma importação aceita até ${String(MAX_TOTAL_ROWS)} linhas preenchidas e um arquivo de até ${String(MAX_UPLOAD_BYTES / 1024 / 1024)} MB.`);
  H('Como importar');
  B('Em Cadastros, Importação, envie o arquivo para a conferência; nada é gravado nessa etapa.');
  B('A conferência mostra cada erro com a aba, a linha, a coluna e o motivo.');
  B('Corrija os erros nesta mesma planilha, salve e envie o arquivo de novo; não é preciso baixar outro modelo.');
  B('O botão Importar só fica disponível quando não há nenhum erro, e a importação grava tudo de uma vez ou nada.');
  H('Colunas de cada aba');
  for (const def of WORKBOOK_SHEETS) {
    H(def.tab);
    for (const col of def.columns) {
      B(col.required ? `${col.header} (obrigatória): ${col.help}` : `${col.header}: ${col.help}`);
    }
  }
  return lines;
}

function writeLeiame(ws: ExcelJS.Worksheet, lines: readonly LeiameLine[]): void {
  ws.getColumn(1).width = 120;
  let r = 1;
  lines.forEach((line, i) => {
    if (line.kind === 'heading' && i > 0) r += 1;
    const cell = ws.getCell(r, 1);
    cell.value = line.text;
    cell.alignment = { wrapText: true, vertical: 'top' };
    if (line.kind === 'title') cell.font = { bold: true, size: 16 };
    else if (line.kind === 'heading') cell.font = { bold: true, size: 12 };
    r += 1;
  });
}

// ---------------------------------------------------------------- Listas

function dedupeByLabel(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    const k = normalizeLabel(v);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out;
}

function sortedUnique(values: readonly string[]): string[] {
  return dedupeByLabel(values).sort((a, b) => a.localeCompare(b, 'pt-BR', { sensitivity: 'base' }));
}

export function buildListColumns(catalog: ImportCatalog): ListColumn[] {
  const active = <T extends { status: string }>(rows: readonly T[]): T[] => rows.filter((r) => r.status === 'active');
  const funcaoNames = active(catalog.funcoes).map((f) => f.name);
  if (!catalog.funcoes.some((f) => f.slug === 'vendedor')) funcaoNames.push('Vendedor');
  if (!catalog.funcoes.some((f) => f.slug === 'finder')) funcaoNames.push('Finder');
  const people = active(catalog.people);
  const stages = active(catalog.stages)
    .filter((s) => s.kind !== 'conversion')
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name, 'pt-BR'));

  const columns: ListColumn[] = [
    { id: 'areas', header: 'Áreas', values: sortedUnique(active(catalog.areas).map((a) => a.name)) },
    { id: 'funcoes', header: 'Funções', values: sortedUnique(funcaoNames) },
    { id: 'produtos', header: 'Produtos', values: sortedUnique(active(catalog.products).map((p) => p.name)) },
    { id: 'pessoas', header: 'Pessoas', values: sortedUnique(people.map((p) => p.displayName)) },
    {
      id: 'vendedores',
      header: 'Vendedores',
      values: sortedUnique(people.filter((p) => p.funcaoSlugs.includes('vendedor')).map((p) => p.displayName)),
    },
    {
      id: 'finders',
      header: 'Finders',
      values: sortedUnique(people.filter((p) => p.funcaoSlugs.includes('finder')).map((p) => p.displayName)),
    },
    { id: 'clientes', header: 'Clientes', values: sortedUnique(catalog.clients.map((c) => c.name)) },
    { id: 'etapas', header: 'Etapas', values: dedupeByLabel(stages.map((s) => s.name)) },
  ];

  const seen = new Set<string>();
  for (const def of WORKBOOK_SHEETS) {
    const defColumns: readonly ColumnDef[] = def.columns;
    for (const col of defColumns) {
      if (col.list !== 'enum') continue;
      const id = listIdOf(col);
      if (id === null || seen.has(id)) continue;
      seen.add(id);
      if (col.kind.type === 'bool') {
        columns.push({ id, header: 'Sim/Não', values: [BOOL_LABELS.true, BOOL_LABELS.false] });
      } else if (col.kind.type === 'enum') {
        columns.push({ id, header: col.header, values: col.kind.options.map((o) => o.label) });
      }
    }
  }
  return columns;
}

function writeListas(ws: ExcelJS.Worksheet, columns: readonly ListColumn[]): Map<string, string> {
  const ranges = new Map<string, string>();
  columns.forEach((col, idx) => {
    const wsCol = ws.getColumn(idx + 1);
    wsCol.width = 32;
    const head = ws.getCell(1, idx + 1);
    head.value = col.header;
    head.font = { bold: true };
    col.values.forEach((v, i) => {
      const cell = ws.getCell(i + 2, idx + 1);
      cell.value = v;
      cell.numFmt = NUM_FMT.text;
    });
    if (col.values.length > 0) {
      const letter = wsCol.letter;
      ranges.set(col.id, `'${LISTAS_TAB}'!$${letter}$2:$${letter}$${col.values.length + 1}`);
    }
  });
  return ranges;
}

// ---------------------------------------------------------------- data sheets

type DataValidationsLike = { add(address: string, validation: ExcelJS.DataValidation): unknown };
function isDataValidationsLike(value: unknown): value is DataValidationsLike {
  return typeof value === 'object' && value !== null && 'add' in value && typeof value.add === 'function';
}
function addValidation(ws: ExcelJS.Worksheet, range: string, dv: ExcelJS.DataValidation): void {
  const store: unknown = Reflect.get(ws, 'dataValidations');
  if (!isDataValidationsLike(store)) throw new Error('exceljs worksheet has no dataValidations');
  store.add(range, dv);
}

function numFmtOf(kind: CellKind): string | undefined {
  switch (kind.type) {
    case 'text':
    case 'list':
      return NUM_FMT.text;
    case 'money':
      return NUM_FMT.money;
    case 'int':
      return NUM_FMT.int;
    case 'pct':
      return NUM_FMT.pct;
    case 'day':
      return NUM_FMT.day;
    case 'enum':
    case 'bool':
      return undefined;
  }
}

function typeError(kind: CellKind, value: CellValue): TypeError {
  return new TypeError(`example value for ${kind.type} has type ${Array.isArray(value) ? 'array' : typeof value}`);
}

function writeExampleCell(cell: ExcelJS.Cell, kind: CellKind, value: CellValue): void {
  switch (kind.type) {
    case 'text':
      if (typeof value !== 'string') throw typeError(kind, value);
      cell.value = value;
      cell.numFmt = NUM_FMT.text;
      return;
    case 'list':
      if (!Array.isArray(value)) throw typeError(kind, value);
      cell.value = value.join('; ');
      cell.numFmt = NUM_FMT.text;
      return;
    case 'money':
      if (typeof value !== 'number' || !Number.isInteger(value)) throw typeError(kind, value);
      cell.value = value / 100;
      cell.numFmt = NUM_FMT.money;
      return;
    case 'int':
      if (typeof value !== 'number' || !Number.isInteger(value)) throw typeError(kind, value);
      cell.value = value;
      cell.numFmt = NUM_FMT.int;
      return;
    case 'pct':
      if (typeof value !== 'number') throw typeError(kind, value);
      cell.value = value / 100;
      cell.numFmt = NUM_FMT.pct;
      return;
    case 'day': {
      if (typeof value !== 'string') throw typeError(kind, value);
      const { y, m, d } = splitDay(value);
      cell.value = new Date(Date.UTC(y, m - 1, d));
      cell.numFmt = NUM_FMT.day;
      return;
    }
    case 'enum': {
      if (typeof value !== 'string') throw typeError(kind, value);
      const option = kind.options.find((o) => o.value === value);
      if (!option) throw new Error(`example enum value ${value} is not an option`);
      cell.value = option.label;
      return;
    }
    case 'bool':
      if (typeof value !== 'boolean') throw typeError(kind, value);
      cell.value = value ? BOOL_LABELS.true : BOOL_LABELS.false;
      return;
  }
}

function writeDataSheet(
  ws: ExcelJS.Worksheet,
  def: SheetDef,
  ranges: ReadonlyMap<string, string>,
  listValues: ReadonlyMap<string, readonly string[]>,
  rows: readonly ExampleRow[],
): void {
  def.columns.forEach((c, idx) => {
    const j = idx + 1;
    const col = ws.getColumn(j);
    col.width = Math.min(40, Math.max(14, [...c.header].length + 4));
    const fmt = numFmtOf(c.kind);
    if (fmt !== undefined) col.numFmt = fmt;
    const head = ws.getCell(1, j);
    head.value = c.header;
    head.numFmt = NUM_FMT.text;
    head.font = { bold: true };
    head.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: c.required ? REQUIRED_HEADER_ARGB : OPTIONAL_HEADER_ARGB },
    };
    head.alignment = { vertical: 'middle', wrapText: true };
    head.border = { bottom: { style: 'thin' } };
    head.note = c.required ? REQUIRED_NOTE_PREFIX + c.help : c.help;
  });
  ws.views = [{ state: 'frozen', xSplit: 0, ySplit: 1, topLeftCell: 'A2', activeCell: 'A2' }];

  def.columns.forEach((c, idx) => {
    const id = listIdOf(c);
    if (id === null) return;
    const formula = ranges.get(id);
    if (formula === undefined) return;
    const letter = ws.getColumn(idx + 1).letter;
    const range = `${letter}2:${letter}${def.maxRows + 1}`;
    if (c.kind.type === 'enum' || c.kind.type === 'bool') {
      const labels = listValues.get(id) ?? [];
      addValidation(ws, range, {
        type: 'list',
        allowBlank: true,
        formulae: [formula],
        showErrorMessage: true,
        errorStyle: 'stop',
        errorTitle: 'Valor inválido',
        error: `Escolha uma das opções da lista: ${labels.join(', ')}.`,
      });
    } else {
      addValidation(ws, range, { type: 'list', allowBlank: true, formulae: [formula], showErrorMessage: false });
    }
  });

  rows.forEach((row, i) => {
    def.columns.forEach((c, idx) => {
      const v = row[c.key];
      if (v === null || v === undefined) return;
      writeExampleCell(ws.getCell(i + 2, idx + 1), c.kind, v);
    });
  });
}

// ---------------------------------------------------------------- example dataset

function schemaExampleRow(def: SheetDef): ExampleRow {
  const entries: Array<[string, CellValue]> = def.columns.map((c) => {
    if (c.example === null) return [c.key, null];
    const res = coerceCell(c.kind, rawCell(c.example));
    if (!res.ok) throw new Error(`schema example ${def.key}.${c.key} does not coerce`);
    return [c.key, res.value];
  });
  return Object.fromEntries(entries);
}

function fullRow(def: SheetDef, partial: Readonly<Record<string, CellValue | undefined>>): ExampleRow {
  const keys = new Set(def.columns.map((c) => c.key));
  for (const k of Object.keys(partial)) {
    if (!keys.has(k)) throw new Error(`example row for ${def.key} has unknown column ${k}`);
  }
  return Object.fromEntries(def.columns.map((c) => [c.key, partial[c.key] ?? null]));
}

type ExtraRows = { [K in SheetKey]: ReadonlyArray<Partial<Record<ColumnKey<K>, CellValue>>> };

function extraExampleRows(today: string): ExtraRows {
  const d = (n: number) => shiftCivilDay(today, -n);
  return {
    areas: [{ nome: 'Serviços profissionais' }],
    funcoes: [{ nome: 'Consultor' }],
    produtos: [
      {
        nome: 'Consultoria',
        tipo: 'service',
        area: 'Serviços profissionais',
        valor: 75000,
        temMensalidade: false,
        comissionaFinder: false,
        comissaoVendedorPct: 12,
        formaPagamento: 'transfer',
        entradaPct: 50,
        parcelas: 2,
      },
    ],
    custosProduto: [{ produto: 'Consultoria', funcao: 'Consultor', custoBrl: 20000 }],
    pessoas: [
      { nome: 'Carla Dias', email: 'carla@exemplo.com.br', funcoes: ['Finder'] },
      { nome: 'Bruno Costa', email: 'bruno@exemplo.com.br', funcoes: ['Consultor'] },
    ],
    clientes: [{ nome: 'Mercado Bom Preço', contato: 'compras@bompreco.com.br', documento: '98.765.432/0001-10' }],
    etapas: [],
    leads: [
      {
        contato: 'Juliana Melo',
        empresa: 'Clínica Sorriso',
        valorEstimado: 450000,
        vendedor: 'Ana Souza',
        produtos: ['Consultoria', 'Treinamento avulso'],
        etapa: 'Diagnóstico',
      },
    ],
    propostas: [
      { ref: 'P2', cliente: 'Mercado Bom Preço', vendedor: 'Ana Souza', situacao: 'open', dataBase: d(10), produto: 'Sistema de gestão' },
      {
        ref: 'P3',
        cliente: 'Padaria Pão Quente',
        vendedor: 'Ana Souza',
        finder: 'Carla Dias',
        situacao: 'lost',
        dataBase: d(45),
        produto: 'Consultoria',
        quantidade: 1,
        valorUnitario: 120000,
      },
      {
        ref: 'P4',
        cliente: 'Mercado Bom Preço',
        vendedor: 'Ana Souza',
        situacao: 'draft',
        dataBase: d(20),
        formaPagamento: 'transfer',
        mensalidade: 0,
        observacoes: 'Proposta completa em rascunho.',
      },
      {
        ref: 'P5',
        cliente: 'Mercado Bom Preço',
        vendedor: 'Ana Souza',
        situacao: 'cancelled',
        dataBase: d(60),
        produto: 'Sistema de gestão',
        quantidade: 2,
      },
    ],
    itens: [
      { ref: 'P4', produto: 'Consultoria', quantidade: 2, valorUnitario: 75000 },
      { ref: 'P4', descricao: 'Treinamento da equipe', area: 'Serviços profissionais', quantidade: 1, valorUnitario: 150000 },
    ],
    profissionais: [{ ref: 'P4', funcao: 'Consultor', pessoa: 'Bruno Costa', custo: 40000, divisaoCusto: '50; 50' }],
    parcelas: [
      { ref: 'P4', vencimento: d(20), valor: 150000, formaPagamento: 'transfer' },
      { ref: 'P4', vencimento: d(5), valor: 150000 },
    ],
    pagamentos: [{ ref: 'P1', parcela: 'M1/12', dataPagamento: '2026-02-20', repassesPagos: false }],
  };
}

export function buildExampleDataset(today: string): ExampleDataset {
  const extra = extraExampleRows(today);
  const entries = SHEET_KEYS.map((key): [SheetKey, ExampleRow[]] => {
    const def = getSheetDef(key);
    const rows: ReadonlyArray<Readonly<Record<string, CellValue | undefined>>> = extra[key];
    return [key, [schemaExampleRow(def), ...rows.map((r) => fullRow(def, r))]];
  });
  // Object.fromEntries widens to a string-keyed record; the keys are exactly SHEET_KEYS.
  const dataset: Partial<Record<SheetKey, ExampleRow[]>> = Object.fromEntries(entries);
  return dataset as ExampleDataset;
}

// ---------------------------------------------------------------- workbook

export function createTemplateWorkbook(catalog: ImportCatalog, opts: TemplateOptions): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'FXL Sales';
  const stamp = new Date(`${catalog.today}T12:00:00.000Z`);
  wb.created = stamp;
  wb.modified = stamp;

  writeLeiame(wb.addWorksheet(LEIAME_TAB), buildLeiameLines(catalog, opts));
  const dataSheets = WORKBOOK_SHEETS.map((def) => [def, wb.addWorksheet(def.tab)] as const);
  const listas = wb.addWorksheet(LISTAS_TAB, { state: 'hidden' });
  const listColumns = buildListColumns(catalog);
  const ranges = writeListas(listas, listColumns);
  const listValues = new Map(listColumns.map((c) => [c.id, c.values] as const));
  const dataset = opts.example ? buildExampleDataset(catalog.today) : null;
  for (const [def, ws] of dataSheets) {
    writeDataSheet(ws, def, ranges, listValues, dataset ? dataset[def.key] : []);
  }
  return wb;
}

export async function buildTemplateWorkbook(catalog: ImportCatalog, opts: TemplateOptions): Promise<Buffer> {
  return Buffer.from(await createTemplateWorkbook(catalog, opts).xlsx.writeBuffer());
}
