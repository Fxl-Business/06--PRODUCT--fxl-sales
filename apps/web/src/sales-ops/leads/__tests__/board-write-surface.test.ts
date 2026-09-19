import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * THE STRUCTURAL GUARD.
 *
 * It reads the files THIS SLICE OWNS off disk with `node:fs` and never shells out
 * to `git grep`: a repo-wide grep passes with the offending call sitting in a
 * third, irrelevant file and would not notice either of these files being
 * renamed away. It scopes to this slice's own list so the data layer's entirely
 * legitimate `apiFetch` in `leads/api.ts` is not a false positive.
 *
 * The scanner is an exported PURE function, called twice: once over the real
 * files, and once over an in-memory fixture carrying planted violations. That
 * second call is not decoration - without it, a scanner that globbed zero files
 * would be a permanently green check over nothing, which is a failure mode this
 * repo has already paid for.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const LEADS_DIR = resolve(HERE, '..');

/** Exactly the non-test files this slice owns under `leads/`. */
const OWNED_FILES = [
  'board-labels.ts',
  'board-move.ts',
  'board-ui.ts',
  'LeadCard.tsx',
  'LeadDialog.tsx',
  'LeadsBoard.tsx',
  'LeadsBoardContainer.tsx',
  'MoveLeadDialog.tsx',
];

/** The one file allowed to spell the conversion kind, because it owns the question. */
const CONVERSION_KIND_OWNER = 'board-move.ts';

export function scanBoardSources(files: Map<string, string>): string[] {
  const violations: string[] = [];

  for (const [name, source] of files) {
    // 1. The sale transition surface. A lead card mirrors a sale status and
    //    offers no control at all; every transition belongs to the proposta.
    if (/\/transition\b/.test(source)) {
      violations.push(`${name}: reaches a sale transition endpoint`);
    }
    for (const symbol of [
      'transitionSale',
      'useTransitionSalesOpsSale',
      'cancelContract',
      'useCancelSalesOpsContract',
    ]) {
      if (source.includes(symbol)) violations.push(`${name}: names ${symbol}`);
    }

    // 2. A second write path. Every write in this slice goes through the data
    //    layer's hooks, so the optimistic move has exactly one implementation.
    for (const module of ['@/lib/app-mutation', '@/lib/api-client']) {
      if (source.includes(module)) violations.push(`${name}: imports ${module}`);
    }
    if (/useMutation[^a-zA-Z]/.test(source) && source.includes('@tanstack/react-query')) {
      violations.push(`${name}: declares a useMutation of its own`);
    }

    // 3. The stage-kind question, asked inline. Both the lost question and the
    //    conversion question have exactly one home each.
    if (/kind\s*===\s*['"](normal|lost)['"]/.test(source)) {
      violations.push(`${name}: compares a stage kind inline`);
    }
    if (name !== CONVERSION_KIND_OWNER && /kind\s*===\s*['"]conversion['"]/.test(source)) {
      violations.push(`${name}: compares the conversion kind outside ${CONVERSION_KIND_OWNER}`);
    }
    // There are exactly three kinds and `'converted'` is not one of them: a card
    // is read-only, a column never is.
    if (/['"]converted['"]/.test(source)) {
      violations.push(`${name}: spells a stage kind that does not exist`);
    }
  }

  return violations;
}

function readOwnedFiles(): Map<string, string> {
  return new Map(
    OWNED_FILES.map((name) => [name, readFileSync(join(LEADS_DIR, name), 'utf8')] as const),
  );
}

describe('the board write surface', () => {
  it('no board file can reach POST /sales/:id/transition', () => {
    const violations = scanBoardSources(readOwnedFiles()).filter(
      (line) => line.includes('transition') || line.includes('cancelContract'),
    );

    expect(violations).toEqual([]);
  });

  it('no board file declares a second write path', () => {
    const violations = scanBoardSources(readOwnedFiles()).filter(
      (line) => line.includes('imports') || line.includes('useMutation'),
    );

    expect(violations).toEqual([]);
  });

  it('no board file asks the stage-kind question inline', () => {
    const violations = scanBoardSources(readOwnedFiles()).filter((line) =>
      line.includes('kind'),
    );

    expect(violations).toEqual([]);
  });

  it('reports nothing at all over the real files', () => {
    expect(scanBoardSources(readOwnedFiles())).toEqual([]);
  });

  it('the scanner detects a planted violation', () => {
    // The mandatory positive control. A scanner that matched nothing would make
    // every assertion above vacuously true.
    const planted = new Map([
      ['Planted.tsx', "import { apiFetch } from '@/lib/api-client';"],
      ['Planted2.tsx', "fetch('/api/v1/sales-ops/sales/x/transition')"],
      ['Planted3.tsx', "if (stage.kind === 'lost') return true;"],
      ['Planted4.tsx', "const kind = 'converted';"],
    ]);

    const violations = scanBoardSources(planted);

    expect(violations).toContain('Planted.tsx: imports @/lib/api-client');
    expect(violations).toContain('Planted2.tsx: reaches a sale transition endpoint');
    expect(violations).toContain('Planted3.tsx: compares a stage kind inline');
    expect(violations).toContain('Planted4.tsx: spells a stage kind that does not exist');
  });

  it('the scanner actually read every file this slice owns', () => {
    const files = readOwnedFiles();

    expect(files.size).toBe(OWNED_FILES.length);
    for (const name of OWNED_FILES) {
      expect(files.get(name)?.length ?? 0).toBeGreaterThan(0);
    }
  });
});
