/**
 * CRM default seed: the allow-list of callers (vendas-crm-unificado slice 05b).
 *
 * `ensureDefaultPipeline`, `ensureSystemFieldDefinitions`, `ensureCrmDefaults` and
 * `ensureCrmDefaultsForOrg` write on first use. In slice 05b NOTHING calls them but their own
 * module and the tests: the API is not cut over yet. Phase 2 appends its request paths to
 * ALLOWED_CALLERS deliberately (the same discipline as stages-seed-callers.test.ts).
 *
 * Non-vacuous by construction: the walker must visit a real tree and must find the seed
 * module's own definition, so a broken walker or a wrong root fails.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const SEED_CALL = /\bensure(DefaultPipeline|SystemFieldDefinitions|CrmDefaults|CrmDefaultsForOrg)\s*\(/;
const ALLOWED_CALLERS = ['domains/crm/defaults.ts', 'domains/sales-ops/leads/stages-seed.ts'];

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
    if (SEED_CALL.test(readFileSync(path, 'utf8'))) hits.push(relative(SRC_ROOT, path).split(sep).join('/'));
  }
}

describe('CRM default seed: only the allowed callers', () => {
  it('only the seed module itself calls the seed', () => {
    const visited = { count: 0 };
    const hits: string[] = [];
    walk(SRC_ROOT, visited, hits);
    expect(visited.count).toBeGreaterThan(50);
    expect(hits).toContain('domains/crm/defaults.ts');
    expect(hits.sort()).toEqual(ALLOWED_CALLERS);
  });
});
