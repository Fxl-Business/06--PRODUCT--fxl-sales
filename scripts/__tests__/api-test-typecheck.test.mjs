import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

/**
 * The API test tree is type-checked.
 *
 * `apps/api/tsconfig.json` roots only `src/**` and `tsconfig.scripts.json` adds
 * only `scripts/**`, so for a long time nothing type-checked `apps/api/test/**`
 * and 115 type errors accumulated there unseen (vitest strips types, it never
 * checks them). `tsconfig.test.json` roots the test tree too, and the api
 * `type-check` script must run it, so `pnpm run type-check` fails on a type
 * error in any integration test.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const API = path.join(ROOT, 'apps/api');

/** tsconfig files are JSONC; drop whole-line `//` comments before parsing. */
function readJsonc(file) {
  const text = fs.readFileSync(file, 'utf8');
  return JSON.parse(text.replace(/^\s*\/\/.*$/gm, ''));
}

test('apps/api/tsconfig.test.json roots the test tree without emitting', () => {
  const file = path.join(API, 'tsconfig.test.json');
  assert.ok(fs.existsSync(file), 'apps/api/tsconfig.test.json is missing');
  const config = readJsonc(file);
  assert.equal(config.extends, './tsconfig.json');
  assert.equal(config.compilerOptions?.noEmit, true);
  assert.equal(config.compilerOptions?.rootDir, '.');
  assert.ok(Array.isArray(config.include), 'include must be an array');
  assert.ok(config.include.includes('test/**/*'), `include ${JSON.stringify(config.include)} lacks test/**/*`);
  assert.ok(config.include.includes('src/**/*'), `include ${JSON.stringify(config.include)} lacks src/**/*`);
});

test('the api type-check script runs tsconfig.test.json alongside the existing projects', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(API, 'package.json'), 'utf8'));
  const script = pkg.scripts?.['type-check'];
  assert.equal(typeof script, 'string', 'apps/api has no type-check script');
  const steps = script.split('&&').map((step) => step.trim());
  assert.ok(steps.includes('tsc --noEmit'), `${script} dropped the src project`);
  assert.ok(steps.includes('tsc --noEmit -p tsconfig.scripts.json'), `${script} dropped the scripts project`);
  assert.ok(steps.includes('tsc --noEmit -p tsconfig.test.json'), `${script} does not type-check the test tree`);
});

test('the root type-check reaches the api package', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.match(pkg.scripts['type-check'], /pnpm -r (--if-present )?type-check/);
});
