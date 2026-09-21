/**
 * The production-unreachability oracle for the dev identity seam.
 *
 * It reads source files from disk rather than shelling out to `git grep`,
 * for the same reason `scripts/__tests__/local-database-guard.test.mjs`
 * does: a repo-wide grep passes with the call sitting in some third
 * irrelevant file and does not notice a rename.
 *
 * DECISIVE MUTATION: making `getDevIdentitySession` ignore
 * `import.meta.env.DEV`, or converting `main.tsx`'s dynamic import to a
 * static one, must turn this file red.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getDevIdentitySession, setDevIdentitySession } from '../dev-identity-registry';

const WEB_SRC = join(__dirname, '..', '..');
const PACKAGE_NAME = '@fxl-sales/auth-fake';

function listFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      listFiles(full, out);
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe('getDevIdentitySession production gate', () => {
  afterEach(() => {
    setDevIdentitySession(null);
    // vi.stubEnv is intentionally NOT unstubbed via afterEach here; the one
    // test that stubs it restores it itself so this suite's other files are
    // unaffected regardless of ordering.
  });

  it('answers null when import.meta.env.DEV is false, even after a session was installed', () => {
    vi.stubEnv('DEV', false);
    try {
      setDevIdentitySession({
        identityId: 'team-owner',
        label: 'Ana',
        // A minimal stand-in is enough: the gate must refuse before ever
        // touching these fields.
        client: {} as unknown as never,
        requestToken: async () => ({ token: 'x' }),
      });
      expect(getDevIdentitySession()).toBeNull();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe('production source isolation', () => {
  it('no web source outside src/dev names @fxl-sales/auth-fake', () => {
    const offenders: string[] = [];
    for (const file of listFiles(WEB_SRC)) {
      const rel = relative(WEB_SRC, file);
      if (rel === 'dev' || rel.startsWith(`dev${sep}`)) continue;
      const contents = readFileSync(file, 'utf8');
      if (contents.includes(PACKAGE_NAME)) {
        offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('install-dev-identity.ts names the roster package only inside a dynamic import', () => {
    const contents = readFileSync(join(WEB_SRC, 'dev', 'install-dev-identity.ts'), 'utf8');
    expect(contents).not.toMatch(/from\s+['"]@fxl-sales\/auth-fake['"]/);
    expect(contents).toMatch(/await\s+import\(\s*['"]@fxl-sales\/auth-fake['"]\s*\)/);
  });

  it('main.tsx reaches the dev tree only through a dynamic import inside an import.meta.env.DEV branch', () => {
    const contents = readFileSync(join(WEB_SRC, 'main.tsx'), 'utf8');
    // No STATIC import of anything under ./dev/.
    expect(contents).not.toMatch(/^\s*import .*['"]\.\/dev\//m);
    // A real `import.meta.env.DEV` branch exists.
    const devBranchIndex = contents.indexOf('if (import.meta.env.DEV)');
    expect(devBranchIndex).toBeGreaterThan(-1);

    // Every mention of './dev/install-dev-identity' - the real dynamic import,
    // and the docblock line describing it - is immediately preceded by
    // `import(`, never by a static `import ... from`. There is at least one
    // REAL dynamic import, and it sits after the DEV branch opens.
    const occurrences = [...contents.matchAll(/\.\/dev\/install-dev-identity/g)];
    expect(occurrences.length).toBeGreaterThan(0);
    for (const occurrence of occurrences) {
      const index = occurrence.index ?? -1;
      const precedingText = contents.slice(Math.max(0, index - 20), index);
      expect(precedingText).toMatch(/import\(\s*['"`]?$/);
    }
    const dynamicImportPattern = /await\s+import\(\s*['"]\.\/dev\/install-dev-identity['"]\s*\)/;
    expect(contents).toMatch(dynamicImportPattern);
    const realImportIndex = contents.search(dynamicImportPattern);
    expect(realImportIndex).toBeGreaterThan(devBranchIndex);
  });

  it('auth/react.tsx names only the registry, never the installer, the switcher or the roster package', () => {
    const contents = readFileSync(join(WEB_SRC, 'auth', 'react.tsx'), 'utf8');
    expect(contents).not.toContain(PACKAGE_NAME);
    expect(contents).not.toContain('install-dev-identity');
    expect(contents).not.toContain('dev-identity-switcher');
    expect(contents).toContain('dev-identity-registry');
  });

  it('the switcher builds no native select, option or datalist', () => {
    const contents = readFileSync(join(WEB_SRC, 'dev', 'dev-identity-switcher.ts'), 'utf8');
    const banned = /createElement\(\s*['"](select|option|datalist)['"]\s*\)/i;
    expect(contents).not.toMatch(banned);
  });
});
