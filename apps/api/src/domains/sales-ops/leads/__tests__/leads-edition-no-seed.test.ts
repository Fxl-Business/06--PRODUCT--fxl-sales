/**
 * The leads edition has no system etapa (edicao-leads decision 5): a new org
 * starts with zero etapas and only the admin creates them. So nothing on a
 * request path may seed the default etapas, except the spreadsheet import route,
 * which the `import` capability keeps closed in that edition.
 *
 * Non-vacuous by construction: the walker must visit a real tree and must find
 * the seed module's own definition, so a broken walker or a wrong root fails.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const SEED_CALL = /\bensureLeadStages(ForOrg)?\s*\(/;

function walk(dir: string, visited: { count: number }, hits: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') continue;
      walk(path, visited, hits);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts')) {
      continue;
    }
    visited.count += 1;
    if (SEED_CALL.test(readFileSync(path, 'utf8'))) {
      hits.push(relative(SRC_ROOT, path).split(sep).join('/'));
    }
  }
}

describe('leads edition: no lazy etapa seed', () => {
  it('only the import route and the seed module itself can seed default etapas', () => {
    const visited = { count: 0 };
    const hits: string[] = [];
    walk(SRC_ROOT, visited, hits);

    expect(visited.count).toBeGreaterThan(50);
    expect(hits).toContain('domains/sales-ops/leads/stages-seed.ts');
    expect(hits.sort()).toEqual([
      'domains/import/routes.ts',
      'domains/sales-ops/leads/stages-seed.ts',
    ]);
  });
});
