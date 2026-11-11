/**
 * System funcao seed: the allow-list of callers.
 *
 * `ensureSystemFuncoes` creates vendedor and finder for an org that lacks them. A request path
 * may call it in exactly these places: the bootstrap route (`routes.ts`), the spreadsheet import
 * route, the person writes of the leads edition (`service.ts`, which also defines it).
 * Any other caller is a new seed site and must be added here deliberately.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SEED_CALL = /\bensureSystemFuncoes\s*\(/;

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

describe('system funcao seed: only the allowed callers', () => {
  it('only the bootstrap route, the import route and service.ts call the seed', () => {
    const visited = { count: 0 };
    const hits: string[] = [];
    walk(SRC_ROOT, visited, hits);

    expect(visited.count).toBeGreaterThan(50);
    expect(hits).toContain('domains/sales-ops/service.ts');
    expect(hits.sort()).toEqual([
      'domains/import/routes.ts',
      'domains/sales-ops/routes.ts',
      'domains/sales-ops/service.ts',
    ]);
  });
});
