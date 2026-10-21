/**
 * Default etapa seed: the allow-list of callers (vendas-crm-unificado slice 02).
 *
 * The leads edition used to seed no etapa at all. The owner reversed that: an org
 * with NO stage row gets the four default etapas on first read, in both editions.
 * So a request path may seed in exactly four places: the stage read
 * (`listLeadStages`), the bootstrap route, the spreadsheet import route and the
 * seed module itself. Any other caller is a new seed site and must be added here
 * deliberately.
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

describe('default etapa seed: only the allowed callers', () => {
  it('only the import route, listLeadStages, the bootstrap route and the seed module itself call the seed', () => {
    const visited = { count: 0 };
    const hits: string[] = [];
    walk(SRC_ROOT, visited, hits);

    expect(visited.count).toBeGreaterThan(50);
    expect(hits).toContain('domains/sales-ops/leads/stages-seed.ts');
    expect(hits.sort()).toEqual([
      'domains/import/routes.ts',
      'domains/sales-ops/leads/stage-service.ts',
      'domains/sales-ops/leads/stages-seed.ts',
      'domains/sales-ops/routes.ts',
    ]);
  });
});
