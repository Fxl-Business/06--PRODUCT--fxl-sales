import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/*
  SEAM A5 (feature edicao-leads). A hand-written `vi.mock('@/auth/react', ...)` factory
  replaces the WHOLE module, so a component that calls `useSalesEdition()` under a mock
  without that export throws `useSalesEdition is not a function` at render. Every mock
  must therefore export it, and this guard keeps the rule from rotting as new tests land.
*/
const SRC_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const MOCK_MARKER = "vi.mock('@/auth/react'";
const MIN_EXPECTED_MOCKS = 24;

function collectTestFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      files.push(...collectTestFiles(path));
    } else if (/\.test\.tsx?$/.test(entry.name)) {
      files.push(path);
    }
  }
  return files;
}

const mockingFiles = collectTestFiles(SRC_ROOT).filter((file) =>
  readFileSync(file, 'utf8').includes(MOCK_MARKER),
);

describe('every @/auth/react mock exports useSalesEdition', () => {
  it('finds the mocks it guards (non-vacuous)', () => {
    expect(mockingFiles.length).toBeGreaterThanOrEqual(MIN_EXPECTED_MOCKS);
  });

  it.each(mockingFiles.map((file) => [relative(SRC_ROOT, file), file]))(
    '%s exports useSalesEdition from its mock',
    (name, file) => {
      expect(readFileSync(file, 'utf8').includes('useSalesEdition'), `${name} mocks @/auth/react without useSalesEdition`).toBe(true);
    },
  );
});
