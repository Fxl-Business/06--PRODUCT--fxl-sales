---
id: 08-template
milestone: v4.2.0
status: done
depends_on: [01-contract-and-parser]
files_modified:
  - apps/api/src/domains/import/template.ts
  - apps/api/src/domains/import/__tests__/template.test.ts
  - apps/api/src/domains/import/__tests__/template-example.test.ts
acceptance: "buildTemplateWorkbook(catalog, { example }) returns xlsx bytes whose tabs are Leia-me, the 13 data tabs in WORKBOOK_SHEETS order and a hidden Listas tab; every data tab's row 1 equals the workbook-schema headers (bold, frozen, required ones filled amber with an Obrigatória note); every column with a list source carries a list validation over rows 2..maxRows+1 pointing at its Listas column (enum and bool columns blocking, reference columns non-blocking); the blank template parses with parseWorkbook to zero issues and every sheet empty; and the example template parses to zero issues with cells deep-equal to buildExampleDataset(catalog.today), whose first row per sheet is the schema example row and whose extra rows exercise basic and full propostas (Aberta, Rascunho, Ganha, Perdida, Cancelada) with every day on or before today."
goal: "Generate the import template server-side from the one column definition: a pt-BR Leia-me, the 13 data tabs with exact headers, formats and dropdowns sourced from the org's active cadastros, and an optional coherent example dataset that the slice 07 round trip imports into a fresh org with zero errors."
must_not_break:
  - "pnpm --filter @fxl-sales/api test (whole unit suite)"
  - "pnpm --filter @fxl-sales/api lint"
  - "pnpm --filter @fxl-sales/api type-check (tsconfig.json, tsconfig.scripts.json, tsconfig.test.json)"
  - apps/api/src/domains/import/__tests__/parse.test.ts
  - apps/api/src/domains/import/__tests__/workbook-schema.test.ts
  - scripts/__tests__/auth-fake-isolation.test.mjs
rules:
  - "template.ts is pure apart from exceljs: no database, no process.env, no `new Date()` without an argument, no `toISOString().slice(0, 10)`. Every day comes from `catalog.today` through the local civil-day helpers built on Date.UTC and getUTC* parts."
  - "Headers are written EXACTLY as `ColumnDef.header` (no ` *`, no suffix, no prefix). Required is shown only by the header fill colour and the header note."
  - "template.ts reads columns ONLY from WORKBOOK_SHEETS / getSheetDef; it never hand-lists a header, a tab name or an enum label. Tab names come from `def.tab`, `LEIAME_TAB`, `LISTAS_TAB`; option labels from the kind's options and `BOOL_LABELS`."
  - "Row 1 of every example sheet is the slice 01 schema example row (derived from `ColumnDef.example` through `coerceCell`), never a hand copy; extra example rows live only in `EXTRA_EXAMPLE_ROWS` inside template.ts."
  - "Money in the dataset is integer cents; it is written to Excel as reais (`cents / 100`) with the money number format. Percent is written as a fraction with a percent format. A day is written as a UTC Date with the day format. Never write a pct as a bare number into a percent-formatted cell."
  - "Every text and list column (and therefore `pagamentos.parcela`) is formatted as text (`@`) at column level so Excel never turns 1/3 into a date."
  - "Reference dropdowns (areas, funcoes, produtos, pessoas, vendedores, finders, clientes, etapas) are NON-blocking (`showErrorMessage: false`), because names can be created in the same workbook; enum and bool dropdowns are blocking (`errorStyle: 'stop'`). An empty reference list gets no validation at all."
  - "Leia-me: one sentence per row in column A, pt-BR, no em dash anywhere, no raw id."
  - "No `any`, no `as unknown as`; the untyped `worksheet.dataValidations` is reached through one narrowing helper. Relative imports end in `.js`."
  - "Do not touch apps/web/** (and never apps/web/src/sales-ops/leads/**), workbook-schema.ts, parse.ts, cells.ts, types.ts or xlsx-fixture.ts."
verifier_focus: "That headers are byte-identical to workbook-schema (the parser matches on them); that the blank template parses to zero issues and empty sheets (no stray cells below row 1, validations do not create rows); that the example round trip compares the parsed cells against buildExampleDataset with toEqual (not just issue count); that example row 1 is derived from ColumnDef.example and not hand-copied; that pct cells are written as fractions with a % format (a bare 10 in a % cell would parse as 1000); that no example day is after today for several todays; that reference dropdowns never block typing a new name; and that template.ts never reads the clock."
---

# Slice 08 - Template (Leia-me, headers, hidden Listas, dropdowns, example)

## Objective

`buildTemplateWorkbook(catalog, { example })` turns an `ImportCatalog` into the downloadable `.xlsx`.
Slice 07 calls it from `GET /api/v1/sales-ops/import/template?example=0|1` and its round-trip oracle imports the example output into a fresh org.
Nothing is mounted here and nothing touches the database.

## Code facts (verified while planning)

- Slice 01 (merged before this slice) exports, verbatim: from `./workbook-schema.js` `WORKBOOK_SHEETS` (`as const satisfies readonly SheetDef[]`), `SHEET_KEYS`, `LEIAME_TAB = 'Leia-me'`, `LISTAS_TAB = 'Listas'`, `MAX_TOTAL_ROWS = 5000`, `MAX_UPLOAD_BYTES`, `BOOL_LABELS = { true: 'Sim', false: 'Não' }`, `getSheetDef`, `getColumnDef`, types `CellKind`, `ColumnDef`, `SheetDef`, `ListSource`, `ColumnKey<K>`; from `./cells.js` `coerceCell`, `rawCell`, `normalizeLabel`, `coercePctList`; from `./parse.js` `parseWorkbook`; from `./types.js` `ImportCatalog`, `SheetKey`, `CellValue`. Test helper `./__tests__/xlsx-fixture.ts` (`buildXlsx`, `headerRow`, `exampleRow`, `exampleTabs`) is read-only for this slice.
- Slice 01's schema example story (row 1 of every sheet): área `Tecnologia`; função `Desenvolvedor`; produto `Sistema de gestão` (Produto, R$ 5.000,00, mensalidade Sim R$ 300,00, 3 parcelas, 12 ciclos, comissões 10% / 8% / 3%, Pix); custo `Sistema de gestão` / `Desenvolvedor` 20%; pessoa `Ana Souza` (`Vendedor; Desenvolvedor`); cliente `Padaria Pão Quente`; etapa `Diagnóstico`; lead `Carlos Lima` at `Diagnóstico`; proposta `P1` Ganha (data base 15/01/2026, ganho 20/01/2026, mensalidade R$ 300,00 from 20/02/2026, 12 ciclos); item `P1` Sistema de gestão 1 x R$ 5.000,00; profissional `P1` Desenvolvedor / Ana Souza R$ 1.000,00; parcela `P1` 20/01/2026 R$ 5.000,00 Pix; pagamento `P1` `1/1` 20/01/2026 Sim. All fixed days are in the past, so row 1 is never in the future.
- `exceljs@4.4.0` (`import ExcelJS from 'exceljs'`, `new ExcelJS.Workbook()`):
  - `wb.addWorksheet(name, { state: 'hidden' })` writes a hidden tab; `ws.state` reads back `'hidden'`.
  - `ws.views = [{ state: 'frozen', xSplit: 0, ySplit: 1, topLeftCell: 'A2', activeCell: 'A2' }]` freezes row 1.
  - `cell.note = 'texto'` writes a header comment; on reload `cell.note` may come back as a string or as `{ texts: [{ text }] }`.
  - `column.numFmt = '@'` applies to existing cells and is inherited by cells created afterwards (`Cell` constructor merges `row.style` and `column.style`). So a percent-formatted column turns a bare `10` into 1000%: always write the fraction.
  - `worksheet.dataValidations` exists at runtime (`lib/doc/worksheet.js` line 111, class with `add(address, validation)`), but is NOT in `index.d.ts`. `add('C2:C501', dv)` with a range key is written as one `<dataValidation sqref="C2:C501">` (`optimiseDataValidations` honours `addr.dimensions`). On reload the range is expanded per cell, so `ws.getCell('C2').dataValidation` (typed `DataValidation`) returns it. Validations create no rows and no cells.
  - `DataValidation` type: `{ type: 'list' | ...; formulae: any[]; allowBlank?; error?; errorTitle?; errorStyle?: string; showErrorMessage?; ... }`.
  - A Date cell is written as a serial computed from UTC milliseconds and read back as a UTC Date when its numFmt is a date format; `'"R$" #,##0.00'`, `'0'`, `'0.00%'` and `'@'` are not date formats.
  - `writeBuffer()` resolves to exceljs's own `Buffer extends ArrayBuffer`; `Buffer.from(await wb.xlsx.writeBuffer())` gives a Node Buffer. To load in tests, copy into a fresh ArrayBuffer exactly like parse.ts does.
- Fresh org facts: funções `Vendedor` (`vendedor`) and `Finder` (`finder`) are system funções seeded on demand by `LEGACY_FUNCAO_SEEDS` in `sales-ops/service.ts` (not exported), so a fresh org's catalog may list NO função at all; slice 02 makes `Vendedor`/`Finder` resolvable by name.
  Lead stages are seeded only by migration 0022 for orgs existing at that time; `ensureLeadStages` has no production caller, so a fresh org may have ZERO stages (slice 07 note: the round trip must not depend on seeds). Therefore every example lead uses the workbook etapa `Diagnóstico`, and no example lead uses a blank etapa or `Perdido`.
- Receivable labels (`buildSaleLedger`, service.ts ~line 985): installments `N/M` over positive rows, bounded recurring `M<i>/<cycles>`. `P1` therefore has `1/1` and `M1/12` .. `M12/12` (first due 2026-02-20).
- Statuses: `CreateSaleSchema.status` is `draft|open|won`; `lost`/`cancelled` come from `transitionSale` from `open` (slice 05 verdict: allowed even in a live org). People status is `active|inactive`; áreas, funções, produtos and etapas are `active|archived`; clientes have no status.
- Unit tests: `pnpm --filter @fxl-sales/api exec vitest run <path>` (unit config includes `src/**/__tests__/**/*.test.ts`); ESLint forbids explicit `any`.

## Decision: where the example rows live

The example template writes `buildExampleDataset(catalog.today)`, owned by `template.ts`:

- Row 1 of every sheet is the slice 01 schema example row, derived at runtime (`schemaExampleRow(def)`: each non-null `ColumnDef.example` coerced with `coerceCell(def.kind, rawCell(example))`, every other key `null`). So the SEAM sentence "`example` is the value the example template writes in its first row" stays true, and every slice 07 test that builds workbooks from `exampleTabs()` keeps telling the same story.
- Rows 2+ come from `EXTRA_EXAMPLE_ROWS(today)` in `template.ts`, with days relative to `today`, so the example exercises both depths and every outcome.
- Slice 07's round-trip counts must therefore be the dataset row counts, not 1 per sheet (see Seam deviations).

## File 1 - `apps/api/src/domains/import/template.ts`

Imports (exact):

```ts
import ExcelJS from 'exceljs';
import { coerceCell, normalizeLabel, rawCell } from './cells.js';
import {
  BOOL_LABELS, LEIAME_TAB, LISTAS_TAB, MAX_TOTAL_ROWS, MAX_UPLOAD_BYTES, SHEET_KEYS, WORKBOOK_SHEETS,
  type CellKind, type ColumnDef, type ColumnKey, type SheetDef,
} from './workbook-schema.js';
import type { CellValue, ImportCatalog, SheetKey } from './types.js';
```

Top-of-file comment (two sentences): the template is generated from `WORKBOOK_SHEETS` so the parser and the file can never disagree on a header; reference dropdowns are suggestions (names may be created in the same workbook) while enum dropdowns block.

### Exports (exact)

```ts
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
export const REQUIRED_HEADER_ARGB = 'FFFDE68A';  // amber
export const OPTIONAL_HEADER_ARGB = 'FFE2E8F0';  // slate
export const REQUIRED_NOTE_PREFIX = 'Obrigatória. ';

export async function buildTemplateWorkbook(catalog: ImportCatalog, opts: TemplateOptions): Promise<Buffer>;
export function createTemplateWorkbook(catalog: ImportCatalog, opts: TemplateOptions): ExcelJS.Workbook;
export function buildExampleDataset(today: string): ExampleDataset;
export function buildLeiameLines(catalog: ImportCatalog, opts: TemplateOptions): LeiameLine[];
export function buildListColumns(catalog: ImportCatalog): ListColumn[];
export function listIdOf(column: ColumnDef): string | null;
export function shiftCivilDay(day: string, days: number): string;
```

`buildTemplateWorkbook` = `Buffer.from(await createTemplateWorkbook(catalog, opts).xlsx.writeBuffer())`.

### `shiftCivilDay(day, days)`

Split `YYYY-MM-DD` into numbers; `const d = new Date(Date.UTC(y, m - 1, dd + days))`; return `pad4(d.getUTCFullYear())-pad2(d.getUTCMonth() + 1)-pad2(d.getUTCDate())`.
Throws `RangeError('invalid_iso_day')` when the input does not match `/^\d{4}-\d{2}-\d{2}$/`.

### `createTemplateWorkbook(catalog, opts)` algorithm

1. `const wb = new ExcelJS.Workbook()`; `wb.creator = 'FXL Sales'`; `const stamp = new Date(\`${catalog.today}T12:00:00.000Z\`)`; `wb.created = stamp`; `wb.modified = stamp` (deterministic metadata from the catalog, not the clock).
2. `writeLeiame(wb.addWorksheet(LEIAME_TAB), buildLeiameLines(catalog, opts))`.
3. `const dataSheets = WORKBOOK_SHEETS.map((def) => [def, wb.addWorksheet(def.tab)] as const)` (contract order).
4. `const listas = wb.addWorksheet(LISTAS_TAB, { state: 'hidden' })`; `const ranges = writeListas(listas, buildListColumns(catalog))` (`Map<string, string>` from list id to formula, only for non-empty lists).
5. `const dataset = opts.example ? buildExampleDataset(catalog.today) : null`.
6. For each `[def, ws]`: `writeDataSheet(ws, def, ranges, dataset ? dataset[def.key] : [])`.
7. Return `wb`. Tab order is therefore `Leia-me`, the 13 tabs, `Listas` (last, hidden).

### `writeLeiame(ws, lines)` (internal)

- `ws.getColumn(1).width = 120`.
- Row cursor `r = 1`. For each line: a `heading` that is not the first line is preceded by one empty row (`r += 1`). Write `ws.getCell(r, 1).value = line.text`; `alignment = { wrapText: true, vertical: 'top' }`; `title` -> `font = { bold: true, size: 16 }`; `heading` -> `font = { bold: true, size: 12 }`; `body` -> no font change. `r += 1`.

### `buildLeiameLines(catalog, opts)` (exact pt-BR text; `T` = title, `H` = heading, `B` = body)

```
T Modelo de importação do FXL Sales
B Esta é a planilha de exemplo: as linhas preenchidas contam uma história completa e podem ser importadas numa organização nova para testar.   (ONLY when opts.example)
B Esta organização está conectada ao FXL Finance, então propostas Ganhas e pagamentos serão recusados na conferência.   (ONLY when catalog.producerFlowLive)
H Para que serve
B Esta planilha importa cadastros, leads e propostas para a organização ativa no FXL Sales.
B Use-a no onboarding para trazer tudo de uma vez ou depois para acrescentar só alguns registros, por exemplo mais algumas propostas.
H Como preencher
B Preencha só as abas que precisar e deixe as outras vazias.
B Uma aba vazia, ou com apenas a linha de cabeçalho, é ignorada e não cria nada.
B Não altere, renomeie nem apague os cabeçalhos da linha 1; a ordem das colunas pode mudar, mas o texto do cabeçalho precisa continuar igual.
B Os cabeçalhos amarelos são colunas obrigatórias e os cinzas são opcionais; passe o mouse sobre um cabeçalho para ver a explicação da coluna.
B As listas suspensas mostram os cadastros que já existem na organização, mas você também pode digitar nomes criados nesta mesma planilha.
H Ordem das abas
B As abas estão na ordem em que são importadas, e cada aba pode usar o que foi criado nas abas anteriores.
B <def.tab>: <SHEET_PURPOSE[def.key]>      (one line per WORKBOOK_SHEETS entry, in order)
H Ligação pelo Ref
B Cada proposta tem um Ref que você escolhe, como P1 ou PROP-15, e que não pode se repetir na planilha.
B As abas Itens da proposta, Profissionais da proposta, Parcelas e Pagamentos usam o mesmo Ref para dizer a qual proposta cada linha pertence.
B O Ref só liga as linhas desta planilha e não é gravado na proposta.
B Os outros cadastros são ligados pelo nome, e um produto também pode ser indicado pelo código no formato #3.
H Proposta simples ou completa
B Na proposta simples, preencha na aba Propostas o cliente, o vendedor, a data base e o produto; os itens, as parcelas e a recorrência vêm dos padrões do produto.
B Na proposta completa, deixe Produto em branco na aba Propostas e descreva a proposta nas abas Itens da proposta, Profissionais da proposta e Parcelas.
B Quando uma proposta tem linhas na aba Parcelas, a soma das parcelas precisa ser igual ao total dos itens.
B Uma proposta Ganha precisa da Data de ganho, e as parcelas já pagas vão na aba Pagamentos.
B Propostas Perdidas ou Canceladas entram no FXL Sales já com essa situação.
H Só cria, nunca altera
B A importação só cria registros novos e nunca altera nem apaga o que já existe.
B Uma área, função, produto ou etapa com o mesmo nome de um cadastro existente é recusada; apague a linha, porque as outras abas já encontram o cadastro existente pelo nome.
B Clientes e pessoas parecidos com um cadastro existente aparecem como aviso na conferência e não impedem a importação.
H Datas, valores e percentuais
B Digite as datas no formato dd/mm/aaaa, por exemplo 15/01/2026.
B Nenhuma data de ganho ou de pagamento pode estar no futuro.
B Digite valores em reais como 1.234,56 ou R$ 1.234,56, com no máximo dois dígitos de centavos.
B Digite percentuais como 10 ou 12,5%.
B Na coluna Parcela da aba Pagamentos, use rótulos como 1/3 para parcelas e M2/12 para mensalidades.
H Limites desta versão
B Pagamentos só podem ser registrados para parcelas e mensalidades, então outros custos pagos de uma vez devem ser baixados no FXL Sales depois da importação.
B A coluna Repasses pagos também dá baixa nas comissões e custos ligados à parcela, no mesmo dia do pagamento.
B Se a organização estiver conectada ao FXL Finance, propostas Ganhas e pagamentos não podem ser importados, porque esse histórico não chegaria ao Finance; cadastros, leads e propostas em Rascunho, Aberta, Perdida ou Cancelada continuam permitidos.
B Uma importação aceita até <MAX_TOTAL_ROWS> linhas preenchidas e um arquivo de até <MAX_UPLOAD_BYTES / 1024 / 1024> MB.
H Como importar
B Em Cadastros, Importação, envie o arquivo para a conferência; nada é gravado nessa etapa.
B A conferência mostra cada erro com a aba, a linha, a coluna e o motivo.
B Corrija os erros nesta mesma planilha, salve e envie o arquivo de novo; não é preciso baixar outro modelo.
B O botão Importar só fica disponível quando não há nenhum erro, e a importação grava tudo de uma vez ou nada.
H Colunas de cada aba
then for each def in WORKBOOK_SHEETS:
H <def.tab>
B <col.header> (obrigatória): <col.help>     (required columns)
B <col.header>: <col.help>                   (optional columns)
```

`<MAX_TOTAL_ROWS>` renders `5000` (`String(MAX_TOTAL_ROWS)`, no thousands dot) and the MB figure renders `5`.

`SHEET_PURPOSE: Record<SheetKey, string>` (internal const, exact):

| key | purpose |
| --- | --- |
| areas | Áreas de atuação dos produtos e dos itens avulsos. |
| funcoes | Funções que as pessoas exercem, além de Vendedor e Finder, que já existem. |
| produtos | Produtos e serviços com valores, comissões e condições de pagamento padrão. |
| custosProduto | Custo padrão de cada função em um produto. |
| pessoas | Vendedores, finders e profissionais com as suas funções. |
| clientes | Clientes das propostas e dos leads. |
| etapas | Novas etapas do funil de leads. |
| leads | Leads da prospecção, cada um numa etapa do funil. |
| propostas | Propostas, uma por linha, identificadas pelo Ref. |
| itens | Itens de cada proposta completa. |
| profissionais | Profissionais e custos de cada proposta completa. |
| parcelas | Parcelas de cada proposta completa. |
| pagamentos | Parcelas já pagas de propostas Ganhas. |

### `buildListColumns(catalog)` (fixed order)

`active` means `status === 'active'`. Dedupe every list by `normalizeLabel`, keeping the first spelling; sort reference lists (except Etapas) with `a.localeCompare(b, 'pt-BR', { sensitivity: 'base' })` AFTER dedupe.

| id | header | values |
| --- | --- | --- |
| `areas` | Áreas | active área names |
| `funcoes` | Funções | active função names, plus `Vendedor` when no catalog função has slug `vendedor`, plus `Finder` when none has slug `finder` |
| `produtos` | Produtos | active produto names |
| `pessoas` | Pessoas | active people `displayName` |
| `vendedores` | Vendedores | active people whose `funcaoSlugs` includes `vendedor` |
| `finders` | Finders | active people whose `funcaoSlugs` includes `finder` |
| `clientes` | Clientes | every client name |
| `etapas` | Etapas | active stages with `kind !== 'conversion'`, ordered by `position` then name (no alphabetical sort) |
| then one enum list per distinct `listIdOf` of enum/bool columns, in order of first appearance across `WORKBOOK_SHEETS` columns | bool: `Sim/Não`; enum: the header of the FIRST column that uses it (`Tipo`, `Forma de pagamento padrão`, `Situação`) | bool: `[BOOL_LABELS.true, BOOL_LABELS.false]`; enum: option labels in option order |

`listIdOf(column)`: `column.list === undefined` -> `null`; `column.list !== 'enum'` -> `column.list`; `kind.type === 'bool'` -> `'enum:bool'`; `kind.type === 'enum'` -> `'enum:' + kind.options.map((o) => o.value).join('|')`; `list === 'enum'` on any other kind -> `throw new Error(\`column ${column.key} has list enum but kind ${column.kind.type}\`)`.

### `writeListas(ws, columns)` (internal) -> `Map<string, string>`

For column index `i` (1-based): `ws.getColumn(i).width = 32`; row 1 = `header` (bold); rows 2.. = values, each cell `numFmt = '@'`.
When `values.length > 0`, map `id` -> `\`'${LISTAS_TAB}'!$${letter}$2:$${letter}$${values.length + 1}\`` where `letter = ws.getColumn(i).letter`. Empty lists are not mapped.

### `writeDataSheet(ws, def, ranges, rows)` (internal)

1. For each column `c` at index `j` (1-based), `col = ws.getColumn(j)`:
   - `col.width = Math.min(40, Math.max(14, [...c.header].length + 4))`.
   - `fmt = numFmtOf(c.kind)`: text/list -> `NUM_FMT.text`; money -> `NUM_FMT.money`; int -> `NUM_FMT.int`; pct -> `NUM_FMT.pct`; day -> `NUM_FMT.day`; enum/bool -> none. When defined, `col.numFmt = fmt`.
   - Header cell `ws.getCell(1, j)`: `value = c.header`; `numFmt = '@'`; `font = { bold: true }`; `fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: c.required ? REQUIRED_HEADER_ARGB : OPTIONAL_HEADER_ARGB } }`; `alignment = { vertical: 'middle', wrapText: true }`; `border = { bottom: { style: 'thin' } }`; `note = c.required ? REQUIRED_NOTE_PREFIX + c.help : c.help`.
2. `ws.views = [{ state: 'frozen', xSplit: 0, ySplit: 1, topLeftCell: 'A2', activeCell: 'A2' }]`.
3. Validations: for each column with `id = listIdOf(c)` non-null and `formula = ranges.get(id)` defined: `addValidation(ws, \`${letter}2:${letter}${def.maxRows + 1}\`, dv)` where
   - enum/bool: `{ type: 'list', allowBlank: true, formulae: [formula], showErrorMessage: true, errorStyle: 'stop', errorTitle: 'Valor inválido', error: \`Escolha uma das opções da lista: ${labels.join(', ')}.\` }` (labels = the list's values);
   - reference: `{ type: 'list', allowBlank: true, formulae: [formula], showErrorMessage: false }`.
4. Example rows: row `i` of `rows` goes to Excel row `i + 2`; for each column, `v = row[c.key]`; `null`/`undefined` -> leave the cell untouched; else `writeExampleCell(ws.getCell(i + 2, j), c.kind, v)`.

### `addValidation(ws, range, dv)` (internal, the ONE untyped access)

```ts
type DataValidationsLike = { add(address: string, validation: ExcelJS.DataValidation): unknown };
function isDataValidationsLike(value: unknown): value is DataValidationsLike {
  return typeof value === 'object' && value !== null && 'add' in value && typeof value.add === 'function';
}
const store: unknown = Reflect.get(ws, 'dataValidations');
if (!isDataValidationsLike(store)) throw new Error('exceljs worksheet has no dataValidations');
store.add(range, dv);
```

### `writeExampleCell(cell, kind, value)` (internal)

Programmer errors throw `TypeError('example value for <kind.type> has type <typeof>')`.

| kind | accepted value | written `cell.value` | `cell.numFmt` |
| --- | --- | --- | --- |
| text | string | the string | `@` |
| list | string[] | `value.join('; ')` | `@` |
| money | integer number (cents) | `value / 100` | `NUM_FMT.money` |
| int | integer number | the number | `NUM_FMT.int` |
| pct | number 0..100 | `value / 100` | `NUM_FMT.pct` |
| day | ISO day string | `new Date(Date.UTC(y, m - 1, d))` | `NUM_FMT.day` |
| enum | option VALUE string | the matching option's `label` (no match -> throw `Error`) | - |
| bool | boolean | `value ? BOOL_LABELS.true : BOOL_LABELS.false` | - |

### `buildExampleDataset(today)`

```ts
export function buildExampleDataset(today: string): ExampleDataset
```

For every `key` of `SHEET_KEYS`: `def = getSheetDef(key)` (import it too); `[schemaExampleRow(def), ...EXTRA_EXAMPLE_ROWS(today)[key].map((r) => fullRow(def, r))]`.

- `schemaExampleRow(def)`: `Object.fromEntries(def.columns.map((c) => [c.key, c.example === null ? null : coerced(c)]))`, where `coerced(c)` = `coerceCell(c.kind, rawCell(c.example))`; `ok: false` -> `throw new Error(\`schema example ${def.key}.${c.key} does not coerce\`)`.
- `fullRow(def, partial)`: every column key, `partial[key] ?? null`; a key of `partial` that is not a column of `def` -> `throw new Error`.
- `EXTRA_EXAMPLE_ROWS(today)` returns `{ [K in SheetKey]: ReadonlyArray<Partial<Record<ColumnKey<K>, CellValue>>> }` (the mapped type makes a typo a compile error). With `d(n) = shiftCivilDay(today, -n)`, exactly:

| sheet | extra rows (values are POST-coercion: cents, percent numbers, ISO days, enum VALUES) |
| --- | --- |
| areas | `{ nome: 'Serviços profissionais' }` |
| funcoes | `{ nome: 'Consultor' }` |
| produtos | `{ nome: 'Consultoria', tipo: 'service', area: 'Serviços profissionais', valor: 75000, temMensalidade: false, comissionaFinder: false, comissaoVendedorPct: 12, formaPagamento: 'transfer', entradaPct: 50, parcelas: 2 }` |
| custosProduto | `{ produto: 'Consultoria', funcao: 'Consultor', custoBrl: 20000 }` |
| pessoas | `{ nome: 'Carla Dias', email: 'carla@exemplo.com.br', funcoes: ['Finder'] }`, `{ nome: 'Bruno Costa', email: 'bruno@exemplo.com.br', funcoes: ['Consultor'] }` |
| clientes | `{ nome: 'Mercado Bom Preço', contato: 'compras@bompreco.com.br', documento: '98.765.432/0001-10' }` |
| etapas | none |
| leads | `{ contato: 'Juliana Melo', empresa: 'Clínica Sorriso', valorEstimado: 450000, vendedor: 'Ana Souza', produtos: ['Consultoria', 'Treinamento avulso'], etapa: 'Diagnóstico' }` |
| propostas | P2 basic Aberta: `{ ref: 'P2', cliente: 'Mercado Bom Preço', vendedor: 'Ana Souza', situacao: 'open', dataBase: d(10), produto: 'Sistema de gestão' }`; P3 basic Perdida with finder: `{ ref: 'P3', cliente: 'Padaria Pão Quente', vendedor: 'Ana Souza', finder: 'Carla Dias', situacao: 'lost', dataBase: d(45), produto: 'Consultoria', quantidade: 1, valorUnitario: 120000 }`; P4 full Rascunho: `{ ref: 'P4', cliente: 'Mercado Bom Preço', vendedor: 'Ana Souza', situacao: 'draft', dataBase: d(20), formaPagamento: 'transfer', mensalidade: 0, observacoes: 'Proposta completa em rascunho.' }`; P5 basic Cancelada: `{ ref: 'P5', cliente: 'Mercado Bom Preço', vendedor: 'Ana Souza', situacao: 'cancelled', dataBase: d(60), produto: 'Sistema de gestão', quantidade: 2 }` |
| itens | `{ ref: 'P4', produto: 'Consultoria', quantidade: 2, valorUnitario: 75000 }`, `{ ref: 'P4', descricao: 'Treinamento da equipe', area: 'Serviços profissionais', quantidade: 1, valorUnitario: 150000 }` |
| profissionais | `{ ref: 'P4', funcao: 'Consultor', pessoa: 'Bruno Costa', custo: 40000, divisaoCusto: '50; 50' }` |
| parcelas | `{ ref: 'P4', vencimento: d(20), valor: 150000, formaPagamento: 'transfer' }`, `{ ref: 'P4', vencimento: d(5), valor: 150000 }` |
| pagamentos | `{ ref: 'P1', parcela: 'M1/12', dataPagamento: '2026-02-20', repassesPagos: false }` |

Resulting dataset row counts (slice 07 uses `buildExampleDataset(today)[k].length`, never these literals): areas 2, funcoes 2, produtos 2, custosProduto 2, pessoas 3, clientes 2, etapas 1, leads 2, propostas 5, itens 3, profissionais 2, parcelas 3, pagamentos 2.

Story coverage: a Serviço (Consultoria) and a recurring produto (Sistema de gestão); costs in % and in R$; a vendedor, a finder and a professional; an extra etapa; leads with and without a cadastro empresa and with a non-cadastro produto name; basic Aberta (P2), basic Perdida with finder and negotiated value (P3), full Rascunho with a produto item, a free-form item, a professional with a cost split and two parcelas that sum to the items (P4), basic Cancelada with quantity (P5), and full Ganha with recorrência and two payments, one of them a mensalidade (P1).

## File 2 - `apps/api/src/domains/import/__tests__/template.test.ts` (Red first)

Helpers in the file: `catalogFixture(overrides?: Partial<ImportCatalog>): ImportCatalog` (empty lists, `today: '2026-10-02'`, `producerFlowLive: false`, settings 10/3/6); `populatedCatalog()` with: áreas `Tecnologia` (active), `Antiga` (archived); funções `Vendedor`/`vendedor`/system, `Finder`/`finder`/system, `Designer` active, `Velha` archived; produtos `Site` active, `Legado` archived (full `ProductCatalogEntry` literals); people `Zé Vendas` (active, `['vendedor']`), `ana finder` (active, `['finder']`), `Inativo` (inactive, `['vendedor']`), `Beto` (active, `['designer']`); clients `Padaria`, `padaria` (dedupe case), `Ótica`; stages `Novo` (normal, active, 1), `Proposta` (conversion, active, 3), `Perdido` (lost, active, 4), `Arquivada` (normal, archived, 2). `reload(buf)` copies into a fresh ArrayBuffer and loads with exceljs. `noteText(cell)` returns the note string from either shape.

- `writes Leia-me first, the 13 data tabs in contract order and a hidden Listas tab last` - reloaded `worksheets.map(w => w.name)` equals `[LEIAME_TAB, ...WORKBOOK_SHEETS.map(s => s.tab), LISTAS_TAB]`; `Listas` state `hidden`, every other `visible`. Same for `{ example: true }`.
- `writes every data tab's header row exactly as workbook-schema` - for each def, row 1 values `[1..n]` equal `def.columns.map(c => c.header)` and `ws.getRow(1).cellCount === def.columns.length`.
- `freezes and styles the header row, marking required columns by fill and note only` - in-memory `createTemplateWorkbook`: `views[0]` has `state 'frozen'` and `ySplit 1`; every header `font.bold`; fill argb `REQUIRED_HEADER_ARGB` iff `required`; note (reloaded, `noteText`) equals `REQUIRED_NOTE_PREFIX + help` for required, `help` otherwise; no header text ends with `*`.
- `formats day, money, pct, int, text and list columns` - in-memory: `ws.getColumn(j).numFmt` equals the `NUM_FMT` entry for its kind (text and list `@`, e.g. `Pagamentos`.`Parcela` is `@`); enum/bool columns have no numFmt.
- `fills Listas with active cadastros, system funções and enum labels` - `buildListColumns(populatedCatalog())`: ids in order `areas, funcoes, produtos, pessoas, vendedores, finders, clientes, etapas, enum:...`; áreas `['Tecnologia']`; funções `['Designer', 'Finder', 'Vendedor']` (sorted, no duplicate Vendedor/Finder, no archived); produtos `['Site']`; pessoas `['ana finder', 'Beto', 'Zé Vendas']`; vendedores `['Zé Vendas']`; finders `['ana finder']`; clientes `['Ótica', 'Padaria']` (pt-BR sort, `padaria` deduped); etapas `['Novo', 'Perdido']` (position order, no conversion, no archived); enum lists include `{ header: 'Sim/Não', values: ['Sim', 'Não'] }` and a list whose values equal the `Situação` option labels; and `buildListColumns(catalogFixture())` gives funções `['Finder', 'Vendedor']` and every other reference list empty.
- `writes the Listas tab cells the dropdowns point at` - reloaded Listas row 1 headers equal the `buildListColumns` headers; values start at row 2.
- `adds a list validation to every column with a list source over rows 2 to maxRows + 1` - reloaded, populated catalog: for every column with `listIdOf` non-null and a non-empty list: `getCell(2, j).dataValidation` and `getCell(def.maxRows + 1, j).dataValidation` have `type 'list'` and `formulae[0]` equal to the Listas range of that list (`'Listas'!$X$2:$X$<n+1>`, X the column whose row 1 header is that list's header); `getCell(def.maxRows + 2, j).dataValidation` is undefined; columns without `list` have no validation at row 2.
- `blocks enum dropdowns and never blocks reference dropdowns` - every enum/bool validation: `showErrorMessage true`, `errorStyle 'stop'`, error text contains every label; every reference validation (incl. every `freeText` column, e.g. `Leads`.`Empresa`, `Pessoas`.`Funções`): `showErrorMessage` falsy.
- `skips the dropdown of an empty reference list` - `catalogFixture()`: `Produtos`.`Área` has no validation; `Custos por produto`.`Função` has one (Vendedor/Finder); `Produtos`.`Tipo` has one.
- `the blank template parses to zero issues and empty sheets` (ORACLE) - for `catalogFixture()` and `populatedCatalog()`: `parseWorkbook(await buildTemplateWorkbook(cat, { example: false }))` -> `issues` toEqual `[]`, every `sheets[k].rows` toEqual `[]`; in-memory every data tab `actualRowCount === 1`.
- `the example template parses to zero parser issues and exactly the example dataset` (ORACLE) - for `today` `'2026-10-02'` and `'2027-03-01'`: `parsed = await parseWorkbook(await buildTemplateWorkbook(catalogFixture({ today }), { example: true }))`; `parsed.issues` toEqual `[]`; for every SheetKey, `parsed.sheets[k].rows.map(r => r.cells)` toEqual `buildExampleDataset(today)[k]` and `rows.map(r => r.row)` equals `2..n+1`.
- `example mode keeps the blank layout` - tab names, headers and validations at row 2 identical between `{ example: false }` and `{ example: true }` for the same catalog.
- `writes percentages as fractions and money as reais` - in-memory example: `Produtos` row 2 `Comissão do vendedor (%)` value `0.1` with numFmt `NUM_FMT.pct`; `Valor (R$)` value `5000` with numFmt `NUM_FMT.money`; `Propostas` row 2 `Data base` is a Date equal to `Date.UTC(2026, 0, 15)`; `Pagamentos` row 2 `Parcela` is the string `1/1`.
- `Leia-me has one pt-BR sentence per row and covers the rules` - `buildLeiameLines(catalogFixture(), { example: false })`: no line contains the em dash (assert with the escape `"\u2014"` in the test source, never the literal character); every body line ends with `.` or `:` and does not match `/[.!?]\s+[A-ZÀ-Ý]/`; the joined text contains each tab name of `WORKBOOK_SHEETS`, every column header, and the substrings `Ref`, `proposta simples`, `proposta completa`, `nunca altera`, `dd/mm/aaaa`, `1.234,56`, `aba vazia`, `outros custos`, `FXL Finance`, `envie o arquivo de novo`, `5000`; the example line appears only with `{ example: true }` and the Finance-connected line only with `producerFlowLive: true`. Reloaded Leia-me: `A1` is the title, each line in its own row of column A, column B empty.
- `derives no metadata from the clock` - two `createTemplateWorkbook` calls for the same catalog have `created.getTime()` equal to `Date.parse('2026-10-02T12:00:00.000Z')`.

## File 3 - `apps/api/src/domains/import/__tests__/template-example.test.ts` (pure, no exceljs)

Imports `buildExampleDataset`, `shiftCivilDay` from `../template.js`; `getSheetDef`, `SHEET_KEYS` from `../workbook-schema.js`; `coercePctList`, `normalizeLabel` from `../cells.js`; `isIsoDay` from `@fxl-sales/shared-utils/sao-paulo-day`; `LEAD_STAGE_SEEDS` from `../../sales-ops/leads/stages-seed.js`. `TODAYS = ['2026-10-02', '2027-01-05', '2028-03-01']`.

- `shifts civil days across month, year and leap boundaries` - `('2026-03-01', -1)` -> `2026-02-28`; `('2028-03-01', -1)` -> `2028-02-29`; `('2027-01-05', -10)` -> `2026-12-26`; `('2026-01-31', 1)` -> `2026-02-01`; `'15/01/2026'` throws RangeError.
- `row 1 of every sheet is the schema example row` - for every SheetKey, row 0 equals the coercion of each `ColumnDef.example` (computed in the test with `coerceCell`/`rawCell`, null where example is null).
- `every row carries exactly its sheet's column keys` - `Object.keys(row).sort()` equals the def's keys sorted.
- `exercises every sheet, both depths and every outcome` - every SheetKey has at least one row; `situacao` values include `won`, `open`, `draft`, `lost`, `cancelled`; a basic proposta (non-null `produto`) and a full one (null `produto` with itens and parcelas); a produto with `tipo 'service'` and one with `temMensalidade true`; a free-form item (`produto` null, `descricao` and `area` set); a pagamento whose `parcela` starts with `M`.
- `no example day is after today` - for each of `TODAYS`, every `day`-kind value of every row is `isIsoDay` and `<= today`.
- `every reference resolves inside the example or to a system cadastro` - (normalized names) `produtos.area`, `itens.area` in `areas.nome`; `custosProduto.produto`, `propostas.produto`, `itens.produto` in `produtos.nome`; `custosProduto.funcao`, `profissionais.funcao` in `funcoes.nome` (and never Vendedor/Finder); `pessoas.funcoes` in `funcoes.nome` plus `Vendedor`, `Finder`; `propostas.cliente` in `clientes.nome`; `propostas.vendedor`, `leads.vendedor` are pessoas with `Vendedor`; `propostas.finder` is a pessoa with `Finder`; `profissionais.pessoa` in `pessoas.nome`; every child `ref` in `propostas.ref`; `propostas.ref` unique; every `leads.etapa` is non-null and in `etapas.nome`.
- `example cadastro names never collide with seeds` - `etapas.nome` not in `LEAD_STAGE_SEEDS` names; `funcoes.nome` not in `Vendedor`, `Finder`, `Prestador`.
- `full propostas add up` - for every ref with parcelas: sum of `parcelas.valor` equals sum of `quantidade x valorUnitario` of its itens (`quantidade` null = 1, `valorUnitario` non-null for every example item); every `divisaoCusto` parses with `coercePctList`, sums to 100 and has at most as many parts as the ref's parcelas.
- `payments hit real labels of won propostas` - for each pagamento: its proposta is `won` with non-null `dataGanho`; the label is `${i}/${n}` for its positive parcelas or `M${k}/${ciclosRecorrencia}` with `1 <= k <= ciclos`; `dataPagamento` is on or after the due day of that label (parcela `vencimento`, or `inicioRecorrencia` shifted by `k - 1` months via UTC arithmetic) and on or before today; no (ref, label) pair repeats.

## Commands (run once each, never watch mode)

```bash
pnpm --filter @fxl-sales/api exec vitest run src/domains/import/__tests__/template.test.ts src/domains/import/__tests__/template-example.test.ts
pnpm --filter @fxl-sales/api exec eslint src/domains/import/template.ts src/domains/import/__tests__/template.test.ts src/domains/import/__tests__/template-example.test.ts
pnpm --filter @fxl-sales/api type-check
pnpm --filter @fxl-sales/api test
```

If a test that builds and parses full templates exceeds the 5 s default, give it a 20 s per-test timeout; never skip it.
If `@fxl-sales/shared-utils/sao-paulo-day` fails to resolve, run `pnpm run build:packages` once at the repo root and retry.

Named locked oracles: `src/domains/import/__tests__/template.test.ts` (`the blank template parses to zero issues and empty sheets`, `the example template parses to zero parser issues and exactly the example dataset`, `writes every data tab's header row exactly as workbook-schema`, `adds a list validation to every column with a list source over rows 2 to maxRows + 1`) and `src/domains/import/__tests__/template-example.test.ts` (whole file).
The zero PLAN issues check for the example is slice 07's integration oracle.

## Seam deviations (proposed amendments to SEAM-CONTRACT.md)

1. Example dataset ownership: the example template writes `buildExampleDataset(catalog.today)` from `template.ts`. Its row 1 per sheet IS the `ColumnDef.example` row (the SEAM sentence stays true); rows 2+ are `EXTRA_EXAMPLE_ROWS` with days relative to `today`.
   Consequence for slice 07 (`round-trips the example template of a fresh org`): the expected preview `counts` must be `Object.fromEntries(SHEET_KEYS.map(k => [k, buildExampleDataset(catalog.today)[k].length]))` (import `buildExampleDataset` from `../template.js`; `catalog.today` = `todayInSaoPaulo()` of the test run) instead of 1 per sheet. "The sale row has status won" becomes "the sale created from `P1` (the only won sale) has `won_at` São Paulo day `2026-01-20`"; the org also ends with one `open`, one `draft`, one `lost` and one `cancelled` sale. All its other tests build from `exampleTabs()` and are unaffected.
2. `template.ts` exports more than the SEAM lists: `createTemplateWorkbook`, `buildExampleDataset`, `buildLeiameLines`, `buildListColumns`, `listIdOf`, `shiftCivilDay`, `NUM_FMT`, the header colour/prefix constants and the `TemplateOptions`, `ExampleRow`, `ExampleDataset`, `LeiameLine`, `ListColumn` types. `buildTemplateWorkbook` keeps the SEAM signature `Promise<Buffer>`.
3. Dropdown semantics: every REFERENCE dropdown is non-blocking, not only the `freeText` ones, because a fresh org's lists are empty and new names come from the same workbook; `freeText` is therefore subsumed. Enum and bool dropdowns block.
4. Product gap, for the orchestrator (not fixed here): a fresh org has no lead stages (`ensureLeadStages` has no production caller), so its `Listas` Etapas is empty and a lead with a blank etapa cannot be imported (`createLead` throws `no_open_stage` unless the workbook creates a normal etapa). The example avoids it by putting every lead in `Diagnóstico`. Seeding belongs in the executor (slice 07 note 3), outside this slice.
