import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const PACKAGE = '@fxl-business/hub-sdk';
const PIN = '2.5.0';
const IMPORTERS = ['apps/api/package.json', 'apps/web/package.json'];
const BANNED = '@fxl-business/hub-sdk-testing';

function readManifest(file) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
}

function specifier(file) {
  return readManifest(file).dependencies?.[PACKAGE];
}

/** Every workspace manifest, enumerated from the filesystem, never a hard-coded list. */
function workspaceManifests() {
  const found = ['package.json'];
  for (const group of ['apps', 'packages']) {
    const dir = path.join(ROOT, group);
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const file = path.join(group, entry.name, 'package.json');
      if (fs.existsSync(path.join(ROOT, file))) found.push(file);
    }
  }
  return found;
}

for (const file of IMPORTERS) {
  test(`${file} pins ${PACKAGE} at exactly ${PIN} under dependencies`, () => {
    assert.equal(specifier(file), PIN);
  });
}

test('the two importers agree on the same specifier', () => {
  assert.equal(specifier(IMPORTERS[0]), specifier(IMPORTERS[1]));
});

test('the manifest enumeration is not vacuous', () => {
  const manifests = workspaceManifests();
  for (const file of IMPORTERS) assert.ok(manifests.includes(file), `${file} was not enumerated`);
  assert.ok(manifests.some((file) => file.startsWith('packages/')), 'no packages/* manifest was enumerated');
});

test(`${BANNED} appears in no workspace package.json`, () => {
  const offenders = workspaceManifests().filter((file) => {
    const manifest = readManifest(file);
    return ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'].some(
      (field) => manifest[field] && Object.hasOwn(manifest[field], BANNED),
    );
  });
  assert.deepEqual(offenders, []);
});

test(`${BANNED} is not resolved in pnpm-lock.yaml`, () => {
  const lock = fs.readFileSync(path.join(ROOT, 'pnpm-lock.yaml'), 'utf8');
  assert.ok(lock.includes(PACKAGE), 'the lockfile does not mention hub-sdk at all');
  assert.equal(lock.includes(BANNED), false);
});
