import ExcelJS from 'exceljs';
import { WORKBOOK_SHEETS, getSheetDef } from '../workbook-schema.js';
import type { SheetKey } from '../types.js';

export type FixtureCell =
  | string
  | number
  | boolean
  | Date
  | null
  | { value: number | Date; numFmt: string }
  | { formula: string; result?: string | number }
  | { richText: Array<{ text: string }> }
  | { text: string; hyperlink: string }
  | { error: '#N/A' | '#DIV/0!' | '#VALUE!' };
export type FixtureTab = { name: string; rows: FixtureCell[][]; hidden?: boolean };

export async function buildXlsx(tabs: FixtureTab[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  for (const tab of tabs) {
    const ws = wb.addWorksheet(tab.name, tab.hidden ? { state: 'hidden' } : undefined);
    tab.rows.forEach((cells, r) => {
      cells.forEach((fx, c) => {
        if (fx === null) return;
        const cell = ws.getRow(r + 1).getCell(c + 1);
        if (typeof fx === 'object' && !(fx instanceof Date) && 'numFmt' in fx) {
          cell.value = fx.value;
          cell.numFmt = fx.numFmt;
        } else if (typeof fx === 'object' && !(fx instanceof Date) && 'error' in fx) {
          cell.value = { error: fx.error };
        } else {
          cell.value = fx as ExcelJS.CellValue;
        }
      });
    });
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Header row (schema header texts in schema order) for one sheet. */
export function headerRow(sheet: SheetKey): string[] {
  return getSheetDef(sheet).columns.map((c) => c.header);
}

/** The schema example values in header order (null where example is null). */
export function exampleRow(sheet: SheetKey): FixtureCell[] {
  return getSheetDef(sheet).columns.map((c) => c.example);
}

/** One tab per SheetDef (tab name = def.tab) with its header row and its example row. */
export function exampleTabs(): FixtureTab[] {
  return WORKBOOK_SHEETS.map((def) => ({
    name: def.tab,
    rows: [headerRow(def.key), exampleRow(def.key)],
  }));
}
