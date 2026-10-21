/**
 * The three pre-cutover lead tables are a FROZEN copy (vendas-crm-unificado slice 07a): no product
 * source file may reference their Drizzle exports or their SQL names. Only `db/schema.ts` defines
 * them (the migrations and tests need the definitions) and the dev seed script is covered by its own
 * test. A new reader or writer of these tables fails here and must go through the unified tables.
 *
 * Non-vacuous: the walker must visit a real tree and must find the definition in schema.ts.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const FROZEN = /\b(salesOpsLeads|salesOpsLeadStages|salesOpsLeadProducts|sales_ops_leads|sales_ops_lead_stages|sales_ops_lead_products)\b/;
const ALLOWED = ['db/schema.ts'];

function walk(dir: string, visited: { count: number }, hits: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') continue;
      walk(path, visited, hits);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts')) continue;
    visited.count += 1;
    // Comments may name the tables (the cutover history); code may not.
    const code = readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    if (FROZEN.test(code)) hits.push(relative(SRC_ROOT, path).split(sep).join('/'));
  }
}

describe('frozen pre-cutover lead tables', () => {
  it('no product source file references them except db/schema.ts', () => {
    const visited = { count: 0 };
    const hits: string[] = [];
    walk(SRC_ROOT, visited, hits);
    expect(visited.count).toBeGreaterThan(50);
    expect(hits).toContain('db/schema.ts');
    expect(hits.sort()).toEqual(ALLOWED);
  });
});
