import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const PACKAGE = '@fxl-business/fxl-contracts';
const PIN = '0.1.0';
const IMPORTERS = ['apps/api/package.json', 'packages/auth-fake/package.json'];

function specifier(file) {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
  return manifest.dependencies?.[PACKAGE];
}

for (const file of IMPORTERS) {
  test(`${file} pins ${PACKAGE} at exactly ${PIN} under dependencies`, () => {
    assert.equal(specifier(file), PIN);
  });
}

test('the two importers agree on the same specifier', () => {
  assert.equal(specifier(IMPORTERS[0]), specifier(IMPORTERS[1]));
});

test('no vendored copy of the package is tracked in the repository', () => {
  assert.equal(fs.existsSync(path.join(ROOT, 'packages/fxl-contracts')), false);
  const tracked = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter((f) => /(^|\/)fxl-contracts(\/|$)/.test(f) && !f.startsWith('nexo/'));
  assert.deepEqual(tracked, []);
});
