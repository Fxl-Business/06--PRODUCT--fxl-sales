import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';

const GUARD = fileURLToPath(new URL('../no-legacy-env-names.mjs', import.meta.url));

// Spelled by character code, exactly as the guard itself spells it. A literal
// here would be found by the very grep this file exercises, and the guard could
// then never pass on this repository.
const retired = String.fromCharCode(
  72, 85, 66, 95, 83, 69, 83, 83, 73, 79, 78, 95, 69, 78, 67, 82, 89, 80, 84, 73, 79, 78, 95, 75,
  69, 89,
);

const tempRoots = [];

after(() => {
  for (const dir of tempRoots) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * Build a REAL throwaway git repository. `git` is never mocked: the guard shells
 * out to `git grep`, and a mock would prove nothing about the pathspec or about
 * `-w`, which are the whole subject.
 */
function makeRepo(files) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'no-legacy-env-')));
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

  // `git grep` reads the INDEX, so an unstaged file is invisible to it and every
  // oracle here would pass for the wrong reason. -f so a developer's global
  // gitignore cannot silently leave a seeded file untracked either.
  const add = spawnSync('git', ['add', '-A', '-f', '.'], { cwd: dir, encoding: 'utf8' });
  assert.equal(add.status, 0, add.stderr);

  return dir;
}

function runGuard(dir) {
  return spawnSync(process.execPath, [GUARD], { cwd: dir, encoding: 'utf8' });
}

test('fails when the retired env name appears under apps/', () => {
  const dir = makeRepo({
    'apps/api/src/env.ts': `export const x = process.env.${retired};\n`,
    'README.md': 'nothing to see here\n',
  });

  const result = runGuard(dir);

  assert.notEqual(result.status, 0, 'the guard must reject a retired env name under apps/');
  assert.match(result.stderr, /apps\/api\/src\/env\.ts/);
  assert.match(result.stderr, /SALES_SESSION_ENCRYPTION_IKM/);
});

test('passes when the retired env name appears only under nexo/', () => {
  const dir = makeRepo({
    'nexo/runs/20260907-run/notes.md': `We renamed ${retired} to SALES_SESSION_ENCRYPTION_IKM.\n`,
    'apps/api/src/env.ts': 'export const ok = true;\n',
  });

  const result = runGuard(dir);

  assert.equal(result.status, 0, `guard rejected the append-only record: ${result.stderr}`);
});

test('passes when the retired env name appears only in CLAUDE.md', () => {
  const dir = makeRepo({
    'CLAUDE.md': `That variable was named ${retired}; this line is the prose record.\n`,
    'apps/api/src/env.ts': 'export const ok = true;\n',
  });

  const result = runGuard(dir);

  assert.equal(result.status, 0, `guard rejected the prose record: ${result.stderr}`);
});

test("tolerates the SDK's canonical name, of which the retired one is a suffix", () => {
  // FXL_HUB_SESSION_ENCRYPTION_KEY is a REAL name the SDK owns. A plain
  // substring ban would reject it; `-w` is what makes the guard usable once
  // 2.3.0 lands.
  const dir = makeRepo({
    'apps/api/.env.example': `FXL_${retired}=\n`,
  });

  const result = runGuard(dir);

  assert.equal(result.status, 0, `guard rejected the SDK's own name: ${result.stderr}`);
});

test('passes on a repository that names nothing retired', () => {
  const dir = makeRepo({
    'apps/api/src/env.ts': 'export const SALES_SESSION_ENCRYPTION_IKM = true;\n',
  });

  const result = runGuard(dir);

  assert.equal(result.status, 0, result.stderr);
});
