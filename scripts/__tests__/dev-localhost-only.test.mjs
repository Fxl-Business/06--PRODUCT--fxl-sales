import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

/**
 * Local development is reachable from this machine only.
 *
 * Before this guard the Vite dev server ran with `host: true` and the API and
 * the compose ports bound every interface, so anyone on the same Wi-Fi, the
 * tailnet or a Docker network could open the app - and under `make dev-fake`
 * enter it as `team-owner` with no login at all.
 *
 * It also pins the operator's entry point: a bare `make` prints the grouped
 * target list, so the development-identity targets are always discoverable.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('the Vite dev server binds localhost, never every interface', () => {
  const config = read('apps/web/vite.config.ts');
  const server = config.slice(config.indexOf('server: {'));
  assert.match(server, /^\s*host: 'localhost',$/m);
  assert.doesNotMatch(config, /host:\s*(true|'0\.0\.0\.0'|"0\.0\.0\.0")/);
});

test('the API passes its resolved listen host to serve()', () => {
  const server = read('apps/api/src/server.ts');
  assert.match(server, /resolveListenHost\(\{/);
  assert.match(server, /serve\(\{ fetch: app\.fetch, port, hostname \}\)/);
});

test('every port published by docker-compose is bound to 127.0.0.1', () => {
  const compose = read('docker-compose.yml');
  const published = [...compose.matchAll(/^\s*-\s*"([^"]+)"\s*$/gm)]
    .map((m) => m[1])
    .filter((value) => /^[\d.]+(:\d+)+$/.test(value));
  assert.ok(published.length >= 2, `expected the api and db ports, found ${published.length}`);
  for (const mapping of published) {
    assert.match(mapping, /^127\.0\.0\.1:\d+:\d+$/, `${mapping} is published on every interface`);
  }
});

test('the containerised API listens on every interface INSIDE its container', () => {
  // Loopback inside the container would make the published port unreachable.
  assert.match(read('docker-compose.yml'), /^\s*- SALES_LISTEN_HOST=0\.0\.0\.0$/m);
});

test('a bare `make` prints every target, the development-identity ones included', () => {
  const run = spawnSync('make', ['--no-print-directory'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  const plain = run.stdout.replace(/\x1b\[[0-9;]*m/g, '');
  const makefile = read('Makefile');
  const documented = [...makefile.matchAll(/^([a-zA-Z_-]+):.*?## /gm)].map((m) => m[1]);
  assert.ok(documented.length > 20, `expected the full target list, found ${documented.length}`);
  for (const target of documented) {
    assert.match(plain, new RegExp(`^\\s+${target}\\s`, 'm'), `bare make does not list ${target}`);
  }
  for (const target of ['dev-fake', 'back-fake', 'front-fake', 'dev-fake-setup']) {
    assert.ok(documented.includes(target), `${target} lost its ## description`);
  }
  assert.match(plain, /Development without the Hub/);
});
