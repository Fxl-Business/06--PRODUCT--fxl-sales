import { randomBytes } from 'node:crypto';
import { posix } from 'node:path';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { parseWorkbook } from '../parse.js';
import { buildTemplateWorkbook } from '../template.js';
import { SHEET_KEYS, WORKBOOK_SHEETS } from '../workbook-schema.js';
import { normalizeXlsxPackage } from '../xlsx-package.js';
import { seededCatalog } from './plan-fixtures.js';

const MAIN_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const BOM = '﻿';

function sourceDirOf(relsPath: string): string {
  return posix.dirname(posix.dirname(relsPath)).replace(/^\.$/, '');
}

/** exceljs numbers drawings by sheet (the first data tab is 2); the SDK counts from an unnumbered first. */
function sdkVmlName(path: string): string {
  const n = Number(/vmlDrawing(\d+)\.vml$/.exec(path)?.[1]) - 1;
  return `xl/drawings/vmldrawing${n === 1 ? '' : String(n)}.vml`;
}

/**
 * Re-saves an exceljs package the way the Open XML SDK writes it (the customer's file of
 * 2026-10-21): SpreadsheetML elements under an `x:` prefix, absolute relationship targets
 * with a BOM, and VML drawings named `vmldrawing.vml`, `vmldrawing2.vml`.
 */
async function toOpenXmlSdkShape(input: Buffer): Promise<Buffer> {
  const zip = await JSZip.loadAsync(input);
  const out = new JSZip();
  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue;
    let name = entry.name;
    let text = await entry.async('string');
    if (name.endsWith('.rels')) {
      const dir = sourceDirOf(name);
      text =
        BOM +
        text.replace(/Target="([^"]+)"/g, (_m, target: string) => {
          let abs = posix.normalize(posix.join(dir, target));
          if (/^xl\/drawings\/vmlDrawing\d+\.vml$/.test(abs)) abs = sdkVmlName(abs);
          return `Target="/${abs}"`;
        });
    } else if (name.endsWith('.xml') && text.includes(`xmlns="${MAIN_NS}"`)) {
      text = text
        .replace(`xmlns="${MAIN_NS}"`, `xmlns:x="${MAIN_NS}"`)
        .replace(/<(\/?)([A-Za-z_][\w.-]*)(?=[\s/>])/g, '<$1x:$2');
    } else if (/^xl\/drawings\/vmlDrawing\d+\.vml$/.test(name)) {
      name = sdkVmlName(name);
    }
    out.file(name, text);
  }
  return Buffer.from(await out.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
}

/** exceljs `xl/comments2.xml` and `vmlDrawing2.vml` are openpyxl's first: `comment1.xml`, `commentsDrawing1.vml`. */
function openpyxlPartName(path: string): string {
  const comments = /^xl\/comments(\d+)\.xml$/.exec(path);
  if (comments) return `xl/comments/comment${String(Number(comments[1]) - 1)}.xml`;
  const vml = /^xl\/drawings\/vmlDrawing(\d+)\.vml$/.exec(path);
  if (vml) return `xl/drawings/commentsDrawing${String(Number(vml[1]) - 1)}.vml`;
  return path;
}

/**
 * Re-saves an exceljs package the way openpyxl does when an AI assistant (ChatGPT, Claude)
 * opens and saves the template: header notes under `xl/comments/comment<N>.xml`, their
 * drawings as `xl/drawings/commentsDrawing<N>.vml`, absolute relationship targets.
 */
async function toOpenpyxlShape(input: Buffer): Promise<Buffer> {
  const zip = await JSZip.loadAsync(input);
  const out = new JSZip();
  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue;
    let text = await entry.async('string');
    if (entry.name.endsWith('.rels')) {
      const dir = sourceDirOf(entry.name);
      text = text.replace(
        /Target="([^"]+)"/g,
        (_m, target: string) => `Target="/${openpyxlPartName(posix.normalize(posix.join(dir, target)))}"`,
      );
    } else if (entry.name === '[Content_Types].xml') {
      text = text.replace(/PartName="\/([^"]+)"/g, (_m, part: string) => `PartName="/${openpyxlPartName(part)}"`);
    }
    out.file(openpyxlPartName(entry.name), text);
  }
  return Buffer.from(await out.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
}

async function exampleTemplate(): Promise<Buffer> {
  return buildTemplateWorkbook(seededCatalog(), { example: true });
}

/** exceljs takes an ArrayBuffer, the same copy parseWorkbook makes. */
function arrayBufferOf(bytes: Uint8Array): ArrayBuffer {
  const ab = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(ab).set(bytes);
  return ab;
}

async function headerNotes(bytes: Uint8Array): Promise<string[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(arrayBufferOf(bytes));
  const notes: string[] = [];
  for (const ws of wb.worksheets) {
    ws.getRow(1).eachCell((cell) => {
      if (cell.note) notes.push(`${ws.name}!${cell.address}`);
    });
  }
  return notes;
}

describe('xlsx package written by the Open XML SDK', () => {
  it('the fixture reproduces the refusal: plain exceljs cannot load it', async () => {
    const sdk = await toOpenXmlSdkShape(await exampleTemplate());
    const zip = await JSZip.loadAsync(sdk);
    expect(await zip.file('xl/workbook.xml')?.async('string')).toContain('<x:workbook');
    expect(zip.file('xl/drawings/vmldrawing.vml')).not.toBeNull();
    await expect(new ExcelJS.Workbook().xlsx.load(arrayBufferOf(sdk))).rejects.toThrow(TypeError);
  });

  it('parses into the same sheets and rows as the original, with no issue', async () => {
    const original = await exampleTemplate();
    const expected = await parseWorkbook(original);
    expect(expected.issues).toEqual([]);

    const actual = await parseWorkbook(await toOpenXmlSdkShape(original));
    expect(actual.issues).toEqual([]);
    for (const key of SHEET_KEYS) expect(actual.sheets[key]).toEqual(expected.sheets[key]);
    expect(SHEET_KEYS.some((k) => actual.sheets[k].rows.length > 0)).toBe(true);
  });

  it('keeps the header notes through the normalization', async () => {
    const original = await exampleTemplate();
    const normalized = await normalizeXlsxPackage(await toOpenXmlSdkShape(original));
    const notes = await headerNotes(normalized);
    expect(notes).toEqual(await headerNotes(original));
    expect(notes.length).toBe(WORKBOOK_SHEETS.reduce((n, s) => n + s.columns.length, 0));
  });

  it('returns a package exceljs already reads byte-identical', async () => {
    const original = await exampleTemplate();
    const normalized = await normalizeXlsxPackage(original);
    expect(Buffer.from(normalized).equals(original)).toBe(true);
  });

  it('returns bytes that are not a zip unchanged, and the parser still answers invalid_file', async () => {
    for (const bytes of [Buffer.from('hello'), randomBytes(64)]) {
      expect(Buffer.from(await normalizeXlsxPackage(bytes)).equals(bytes)).toBe(true);
      const out = await parseWorkbook(bytes);
      expect(out.issues.map((i) => i.code)).toEqual(['invalid_file']);
    }
  });
});

describe('xlsx package saved by openpyxl (an AI assistant filling the template)', () => {
  it('the fixture reproduces the refusal: plain exceljs cannot load it', async () => {
    const saved = await toOpenpyxlShape(await exampleTemplate());
    const zip = await JSZip.loadAsync(saved);
    expect(zip.file('xl/comments/comment1.xml')).not.toBeNull();
    expect(zip.file('xl/drawings/commentsDrawing1.vml')).not.toBeNull();
    await expect(new ExcelJS.Workbook().xlsx.load(arrayBufferOf(saved))).rejects.toThrow(TypeError);
  });

  it('parses into the same sheets and rows as the original, with no issue', async () => {
    const original = await exampleTemplate();
    const expected = await parseWorkbook(original);
    const actual = await parseWorkbook(await toOpenpyxlShape(original));
    expect(actual.issues).toEqual([]);
    for (const key of SHEET_KEYS) expect(actual.sheets[key]).toEqual(expected.sheets[key]);
  });

  it('keeps the header notes through the normalization', async () => {
    const original = await exampleTemplate();
    const normalized = await normalizeXlsxPackage(await toOpenpyxlShape(original));
    expect(await headerNotes(normalized)).toEqual(await headerNotes(original));
  });
});
