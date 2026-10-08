/**
 * Which Clientes rows ARE an existing cliente (D12). Pure: no I/O, no clock, no env.
 * Computed ONCE, inside buildRefIndex, so the Clientes planner and every name lookup
 * read the same answer (ImportRefIndex.recognizedClient). A recognized row is reused,
 * never written: the import stays create-only.
 *
 * 1. Document first: the existing clientes whose document digits equal the row's.
 *    Exactly one is the match, even under another name. Several narrow to the ones
 *    with the row's normalized name; if no single one is left the row is NOT
 *    recognized and never falls back to the name.
 * 2. Otherwise by name: exactly one existing cliente with the row's normalized name,
 *    and every document attached to that name agrees (the existing cliente's and the
 *    documents of every Clientes row with that name, blanks ignored, at most one
 *    distinct value).
 * 3. Anything else is not recognized: the planner creates the row and warns.
 */
import { normalizeLabel } from './cells.js';
import { cellReader } from './parse.js';
import type { ClientRecognition, ImportCatalog, ParsedWorkbook, RecognizedClient } from './types.js';

/** The one document rule: digits only, so "12.345.678/0001-90" equals "12345678000190". */
export function documentDigits(text: string | null | undefined): string {
  return (text ?? '').replace(/\D/g, '');
}

export function recognizeClientRows(parsed: ParsedWorkbook, catalog: ImportCatalog): ClientRecognition {
  const rows = parsed.sheets.clientes.rows.flatMap((row) => {
    const cells = cellReader('clientes', row);
    const nome = cells.text('nome');
    if (nome === null) return [];
    return [{ row: row.row, key: normalizeLabel(nome), doc: documentDigits(cells.text('documento')) }];
  });
  const sheetDocsByName = new Map<string, Set<string>>();
  for (const r of rows) {
    if (r.doc === '') continue;
    const docs = sheetDocsByName.get(r.key) ?? new Set<string>();
    docs.add(r.doc);
    sheetDocsByName.set(r.key, docs);
  }
  const existing = catalog.clients.map((c) => ({
    client: { existingId: c.id, name: c.name } satisfies RecognizedClient,
    key: normalizeLabel(c.name),
    doc: documentDigits(c.document),
  }));

  const result = new Map<number, RecognizedClient>();
  for (const r of rows) {
    if (r.doc !== '') {
      const byDoc = existing.filter((e) => e.doc === r.doc);
      const candidates = byDoc.length > 1 ? byDoc.filter((e) => e.key === r.key) : byDoc;
      const match = candidates.length === 1 ? candidates[0] : undefined;
      if (match) {
        result.set(r.row, match.client);
        continue;
      }
      if (byDoc.length > 0) continue;
    }
    const byName = existing.filter((e) => e.key === r.key);
    const match = byName.length === 1 ? byName[0] : undefined;
    if (!match) continue;
    const docs = new Set<string>(sheetDocsByName.get(r.key));
    if (match.doc !== '') docs.add(match.doc);
    if (docs.size <= 1) result.set(r.row, match.client);
  }
  return result;
}
