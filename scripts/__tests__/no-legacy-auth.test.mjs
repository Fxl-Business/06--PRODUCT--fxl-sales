import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';

const GUARD = fileURLToPath(new URL('../no-legacy-auth.mjs', import.meta.url));

// Spelled by character code, exactly as the guard itself spells it. A literal here would be
// found by the very grep this file exercises, and the guard could then never pass.
const banned = String.fromCharCode(99, 108, 101, 114, 107);

const tempRoots = [];

after(() => {
  for (const dir of tempRoots) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * Build a REAL throwaway git repository. `git` is never mocked: the guard shells out to
 * `git grep`, and a mock would prove nothing about the pathspec, which is the whole subject.
 */
function makeRepo(files) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'no-legacy-auth-')));
  tempRoots.push(dir);

  const init = spawnSync('git', ['-c', 'init.defaultBranch=main', 'init', '-q', dir], {
    encoding: 'utf8',
  });
  assert.equal(init.status, 0, init.stderr);

  for (const [relative, contents] of Object.entries(files)) {
    const target = path.join(dir, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, contents);
  }

  // -f so a developer's global gitignore cannot silently leave a seeded file untracked,
  // which would make an oracle pass for the wrong reason.
  const add = spawnSync('git', ['add', '-A', '-f', '.'], { cwd: dir, encoding: 'utf8' });
  assert.equal(add.status, 0, add.stderr);

  return dir;
}

function runGuard(dir) {
  return spawnSync(process.execPath, [GUARD], { cwd: dir, encoding: 'utf8' });
}

test('fails when the banned provider appears under apps/', () => {
  const dir = makeRepo({
    'apps/web/src/x.ts': `import { useAuth } from '@${banned}/${banned}-react';\n`,
    'README.md': 'nothing to see here\n',
  });

  const result = runGuard(dir);

  assert.notEqual(result.status, 0, 'the guard must reject a reintroduction under apps/');
  assert.match(result.stderr, /apps\/web\/src\/x\.ts/);
});

test('passes when the banned provider appears only under nexo/', () => {
  const dir = makeRepo({
    'nexo/runs/20260907-ship/release-verify.md': `One dead \`VITE_${banned.toUpperCase()}_PUBLISHABLE_KEY\` key name survives in the vendored bundle.\n`,
    'apps/web/src/x.ts': 'export const ok = true;\n',
  });

  const result = runGuard(dir);

  assert.equal(result.status, 0, `guard rejected the append-only record: ${result.stderr}`);
});

test('passes when the banned provider appears only in CLAUDE.md', () => {
  const dir = makeRepo({
    'CLAUDE.md': `The ${banned} provider was removed; this line is the prose record of that.\n`,
    'apps/web/src/x.ts': 'export const ok = true;\n',
  });

  const result = runGuard(dir);

  assert.equal(result.status, 0, `guard rejected the prose record: ${result.stderr}`);
});
