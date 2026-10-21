/*
 * exceljs reads the package shape it writes itself. Valid .xlsx files from other writers differ
 * in ways exceljs cannot read, and exceljs then throws, which the parser reports as `invalid_file`:
 * - the Open XML SDK (Excel for the web, converters) prefixes SpreadsheetML elements
 *   (`<x:workbook>`), and exceljs matches unprefixed tag names only;
 * - the Open XML SDK and openpyxl (what ChatGPT and Claude use to fill a template) write
 *   absolute relationship targets (`/xl/comments1.xml`), and exceljs keys comments and VML
 *   drawings by the relative target;
 * - both name the comments and VML drawing parts their own way (`xl/comments/comment1.xml`,
 *   `commentsDrawing1.vml`, `vmldrawing.vml`), and exceljs only routes `xl/comments<N>.xml`
 *   and `xl/drawings/vmlDrawing<N>.vml`.
 * normalizeXlsxPackage rewrites the package shape only, never a cell. A package that needs
 * none of it is returned as the same bytes, so every file exceljs already read is untouched.
 */
import { posix } from 'node:path';
import JSZip from 'jszip';

const MAIN_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const BOM = '﻿';

/** The parts exceljs routes by path, found by the relationship type that points at them. */
const ROUTED_PARTS = [
  { relType: /\/relationships\/comments$/, routed: /^xl\/comments\d+\.xml$/, name: (n: number) => `xl/comments${String(n)}.xml` },
  { relType: /\/relationships\/vmlDrawing$/, routed: /^xl\/drawings\/vmlDrawing\d+\.vml$/, name: (n: number) => `xl/drawings/vmlDrawing${String(n)}.vml` },
] as const;

type Relationship = { tag: string; type: string; target: string; external: boolean };

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripBom(text: string): string {
  return text.startsWith(BOM) ? text.slice(BOM.length) : text;
}

/** `xl/worksheets/_rels/sheet1.xml.rels` -> `xl/worksheets`; the package root is ''. */
function relsSourceDir(relsPath: string): string {
  const dir = posix.dirname(posix.dirname(relsPath));
  return dir === '.' ? '' : dir;
}

function attr(tag: string, name: string): string | null {
  return new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1] ?? null;
}

function relationshipsOf(rels: string): Relationship[] {
  return [...rels.matchAll(/<Relationship\b[^>]*>/g)].map(([tag]) => ({
    tag,
    type: attr(tag, 'Type') ?? '',
    target: attr(tag, 'Target') ?? '',
    external: attr(tag, 'TargetMode') === 'External',
  }));
}

/** The package path a relationship target points at. */
function resolveTarget(relsPath: string, target: string): string {
  return target.startsWith('/') ? target.slice(1) : posix.normalize(posix.join(relsSourceDir(relsPath), target));
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
    return tag.replace(/\bTarget="([^"]*)"/, (whole, target: string) => {
      const resolved = resolveTarget(relsPath, target);
      const final = renamed.get(resolved) ?? resolved;
      if (!target.startsWith('/') && final === resolved) return whole;
      return `Target="${posix.relative(`/${dir}`, `/${final}`)}"`;
    });
  });
}

/** Gives every comments or VML drawing part exceljs would not route a free name it does route. */
function planPartRenames(names: readonly string[], rels: ReadonlyMap<string, string>): Map<string, string> {
  const present = new Set(names);
  const renamed = new Map<string, string>();
  for (const part of ROUTED_PARTS) {
    const targets = new Set<string>();
    for (const [relsPath, xml] of rels) {
      for (const rel of relationshipsOf(xml)) {
        if (rel.external || !part.relType.test(rel.type)) continue;
        const path = resolveTarget(relsPath, rel.target);
        if (present.has(path) && !part.routed.test(path)) targets.add(path);
      }
    }
    let n = 1;
    for (const path of [...targets].sort()) {
      while (present.has(part.name(n))) n += 1;
      present.add(part.name(n));
      renamed.set(path, part.name(n));
    }
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
  const rels = new Map<string, string>();
  for (const name of names.filter((n) => n.endsWith('.rels'))) {
    const file = zip.file(name);
    if (file) rels.set(name, stripBom(await file.async('string')));
  }
  const renamed = planPartRenames(names, rels);
  let changed = renamed.size > 0;

  for (const name of names) {
    const file = zip.file(name);
    if (!file) continue;
    const isRels = name.endsWith('.rels');
    if (!isRels && !name.endsWith('.xml')) continue;
    const before = await file.async('string');
    let after = stripBom(before);
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
