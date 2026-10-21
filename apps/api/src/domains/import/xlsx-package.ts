/*
 * exceljs reads the package shape it writes itself. A valid .xlsx re-saved by the Open XML SDK
 * (Excel for the web, converters, automations) differs in three ways exceljs cannot read, and
 * exceljs then throws, which the parser reports as `invalid_file`:
 * - SpreadsheetML elements carry a namespace prefix (`<x:workbook>`), and exceljs matches
 *   unprefixed tag names only;
 * - relationship targets are absolute (`/xl/comments1.xml`), and exceljs keys comments and VML
 *   drawings by the relative target;
 * - VML drawings are named `vmldrawing.vml`, and exceljs only routes `vmlDrawing<N>.vml`.
 * normalizeXlsxPackage rewrites the package shape only, never a cell. A package that needs
 * none of it is returned as the same bytes, so every file exceljs already read is untouched.
 */
import { posix } from 'node:path';
import JSZip from 'jszip';

const MAIN_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const BOM = '﻿';
const VML_DIR = 'xl/drawings/';
const EXCELJS_VML = /^xl\/drawings\/vmlDrawing\d+\.vml$/;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** `xl/worksheets/_rels/sheet1.xml.rels` -> `xl/worksheets`; the package root is ''. */
function relsSourceDir(relsPath: string): string {
  const dir = posix.dirname(posix.dirname(relsPath));
  return dir === '.' ? '' : dir;
}

/** Drops a prefix bound to the SpreadsheetML main namespace from a part that has no default namespace. */
function unprefixMainNamespace(xml: string): string {
  if (/\sxmlns="/.test(xml)) return xml;
  const decl = new RegExp(`\\sxmlns:([A-Za-z_][\\w.-]*)="${escapeRegExp(MAIN_NS)}"`).exec(xml);
  if (!decl) return xml;
  const prefix = escapeRegExp(decl[1] ?? '');
  return xml
    .replace(new RegExp(`<(/?)${prefix}:`, 'g'), '<$1')
    .replace(new RegExp(`\\sxmlns:${prefix}="${escapeRegExp(MAIN_NS)}"`), ` xmlns="${MAIN_NS}"`);
}

/** Rewrites absolute or renamed internal targets as paths relative to the rels' source part. */
function rewriteTargets(rels: string, relsPath: string, renamed: ReadonlyMap<string, string>): string {
  const dir = relsSourceDir(relsPath);
  return rels.replace(/<Relationship\b[^>]*>/g, (tag) => {
    if (/\bTargetMode="External"/.test(tag)) return tag;
    return tag.replace(/\bTarget="([^"]*)"/, (attr, target: string) => {
      const resolved = target.startsWith('/') ? target.slice(1) : posix.normalize(posix.join(dir, target));
      const final = renamed.get(resolved) ?? resolved;
      if (!target.startsWith('/') && final === resolved) return attr;
      return `Target="${posix.relative(`/${dir}`, `/${final}`)}"`;
    });
  });
}

/** Gives every VML drawing exceljs would not route a free `vmlDrawing<N>.vml` name. */
function planVmlRenames(names: readonly string[]): Map<string, string> {
  const renamed = new Map<string, string>();
  const taken = new Set(names);
  let n = 1;
  for (const name of names) {
    if (!name.startsWith(VML_DIR) || !name.toLowerCase().endsWith('.vml') || EXCELJS_VML.test(name)) continue;
    if (name.slice(VML_DIR.length).includes('/')) continue;
    while (taken.has(`${VML_DIR}vmlDrawing${String(n)}.vml`)) n += 1;
    const next = `${VML_DIR}vmlDrawing${String(n)}.vml`;
    taken.add(next);
    renamed.set(name, next);
  }
  return renamed;
}

export async function normalizeXlsxPackage(input: Uint8Array): Promise<Uint8Array> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(input);
  } catch {
    return input;
  }
  const names = Object.values(zip.files)
    .filter((f) => !f.dir)
    .map((f) => f.name);
  const renamed = planVmlRenames(names);
  let changed = renamed.size > 0;

  for (const name of names) {
    const file = zip.file(name);
    if (!file) continue;
    const isRels = name.endsWith('.rels');
    if (!isRels && !name.endsWith('.xml')) continue;
    const before = await file.async('string');
    let after = before.startsWith(BOM) ? before.slice(BOM.length) : before;
    after = isRels ? rewriteTargets(after, name, renamed) : unprefixMainNamespace(after);
    if (name === '[Content_Types].xml') {
      for (const [from, to] of renamed) after = after.split(`PartName="/${from}"`).join(`PartName="/${to}"`);
    }
    if (after !== before) {
      zip.file(name, after);
      changed = true;
    }
  }
  for (const [from, to] of renamed) {
    const file = zip.file(from);
    if (!file) continue;
    zip.file(to, await file.async('uint8array'));
    zip.remove(from);
  }

  if (!changed) return input;
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
