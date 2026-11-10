import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test } from 'node:test';

/**
 * The prototype page (`apps/web/prototype.html`) is a dev-only second Vite entry: the real App over a
 * fake network. These tests prove it never reaches production and that the manifest the Harness reads
 * is coherent. The portao runs no `pnpm run build`, so the build proof lives here, in `pnpm test`.
 *
 * DECISIVE MUTATIONS: importing `src/prototype` from `main.tsx` (or any non-prototype file), listing
 * `prototype.html` as a build input, or naming the auth-fake package under `src/prototype` turns this red.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const WEB = path.join(ROOT, 'apps/web');
const PROTOTYPE_DIR = path.join(WEB, 'src/prototype');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** The strings only the fake network layer carries. Their presence in the source is asserted, so the
 *  scans below can never be vacuously green. */
const SENTINELS = ['FXL_SALES_PROTOTYPE_FAKE_NETWORK_SENTINEL', 'not_in_prototype'];

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|mjs|html)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const relative = (file) => path.relative(ROOT, file).split(path.sep).join('/');

test('the fake network layer carries the sentinels the scans look for', () => {
  const source = walk(PROTOTYPE_DIR)
    .map((file) => fs.readFileSync(file, 'utf8'))
    .join('\n');
  for (const sentinel of SENTINELS) assert.ok(source.includes(sentinel), `${sentinel} missing from src/prototype`);
});

test('vite.config.ts lists no build input and does not mention the prototype', () => {
  const config = read('apps/web/vite.config.ts');
  assert.doesNotMatch(config, /\binput\s*:/, 'a build input would make prototype.html shippable');
  assert.doesNotMatch(config, /prototype/i);
});

test('index.html, the only build input, never references the prototype', () => {
  assert.doesNotMatch(read('apps/web/index.html'), /prototype/i);
});

test('nothing outside src/prototype imports it', () => {
  const offenders = walk(path.join(WEB, 'src'))
    .filter((file) => !file.startsWith(PROTOTYPE_DIR + path.sep))
    .filter((file) => /(from\s+|import\s*\()\s*['"][^'"]*\/prototype(\/|['"])/.test(fs.readFileSync(file, 'utf8')))
    .map(relative);
  assert.deepEqual(offenders, []);
  assert.doesNotMatch(read('apps/web/src/main.tsx'), /prototype/i);
});

test('the prototype adds no second fake login: it never names the auth-fake package', () => {
  const offenders = walk(PROTOTYPE_DIR)
    .filter((file) => fs.readFileSync(file, 'utf8').includes('@fxl-sales/auth-fake'))
    .map(relative);
  assert.deepEqual(offenders, []);
  const entry = read('apps/web/src/prototype/main.tsx');
  assert.match(entry, /import\('\.\.\/dev\/install-dev-identity'\)/);
  assert.match(entry, /installDevIdentityIfEnabled\(\)/);
  assert.ok(
    entry.indexOf('installFakeSource()') < entry.indexOf('render('),
    'the network must be swapped before the app mounts',
  );
});

/** The `prototipo:` block as written, read without a YAML dependency (flat fields plus the `fence` and `exclusivos` lists). */
function readPrototipoBlock() {
  const lines = read('project.fxl.yaml').split('\n');
  const start = lines.findIndex((line) => /^prototipo:\s*$/.test(line));
  assert.ok(start >= 0, 'project.fxl.yaml has no prototipo block');
  const block = { modo: '', command: '', page: '', fence: [], fixtures: '', exclusivos: [], servicos: false };
  let key = null;
  for (const raw of lines.slice(start + 1)) {
    if (/^\S/.test(raw)) break;
    const line = raw.replace(/\s+#.*$/, '');
    if (/^\s*#/.test(raw) || line.trim() === '') continue;
    const item = /^\s+-\s+(.+)$/.exec(line);
    if (item && (key === 'fence' || key === 'exclusivos')) {
      block[key].push(item[1].trim());
      continue;
    }
    const field = /^\s+(modo|command|page|fence|fixtures|exclusivos|servicos):\s*(.*)$/.exec(line);
    if (!field) continue;
    key = field[1];
    if (key === 'servicos') block.servicos = true;
    else if (key !== 'fence' && key !== 'exclusivos') block[key] = field[2].trim();
  }
  return block;
}

test('project.fxl.yaml declares a valid app prototipo block whose script and folders exist', () => {
  const block = readPrototipoBlock();
  assert.equal(block.modo, 'app');
  assert.ok(block.servicos, 'an app block declares the services the engine starts');
  assert.match(read('project.fxl.yaml'), /servico: db\n\s+porta: 5006/);
  assert.match(read('docker-compose.yml'), /^ {2}db:/m, 'the declared compose service must exist');
  assert.ok(block.command.includes('{port}'), 'command must carry {port}');
  const script = block.command.split(/\s+/).find((word) => /\.ts$/.test(word));
  assert.equal(script, 'scripts/prototipo/run.ts');
  assert.ok(fs.existsSync(path.join(ROOT, 'apps/api', script)), `${script} must exist under apps/api`);
  assert.equal(block.page, '/');
  assert.ok(block.fence.length > 0);
  for (const folder of [...block.fence, block.fixtures, ...block.exclusivos]) {
    assert.ok(fs.statSync(path.join(ROOT, folder)).isDirectory(), `${folder} must be a folder`);
  }
  assert.ok(block.fence.includes(block.fixtures), 'the fixtures folder is the data a prototype edits');
  assert.deepEqual(block.exclusivos, ['apps/api/scripts/prototipo/']);
});

test('the fence covers only screens, the seed and the identity roster, never the API, auth wiring or config', () => {
  const { fence } = readPrototipoBlock();
  const allowed = ['apps/web/src/sales-ops/', 'apps/web/src/components/', 'apps/api/scripts/seed/', 'packages/auth-fake/src/'];
  assert.deepEqual([...fence].sort(), [...allowed].sort());
  const forbidden = ['apps/web/src/auth/', 'apps/web/src/dev/', 'apps/web/src/lib/', 'apps/web/src/prototype/', 'apps/api/src/', 'apps/api/scripts/prototipo/'];
  for (const folder of fence) {
    for (const banned of forbidden) {
      assert.ok(!folder.startsWith(banned), `${folder} must not be inside the fence`);
    }
  }
});

function containsSentinel(dir) {
  const hits = [];
  const scan = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) scan(full);
      else {
        const text = fs.readFileSync(full, 'utf8');
        if (SENTINELS.some((sentinel) => text.includes(sentinel)) || /prototype\.html/.test(text)) hits.push(full);
      }
    }
  };
  scan(dir);
  return hits;
}

test('the production build of apps/web contains none of the prototype (with a positive control)', async () => {
  const webRequire = createRequire(path.join(WEB, 'package.json'));
  const { build } = await import(pathToFileURL(webRequire.resolve('vite')).href);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fxl-sales-prototype-isolation-'));
  const shipped = path.join(tmp, 'shipped');
  const control = path.join(tmp, 'control');
  const quiet = { logLevel: 'silent', root: WEB, configFile: path.join(WEB, 'vite.config.ts'), mode: 'production' };
  // PostCSS and Tailwind resolve their config from the working directory, as `pnpm --filter ... build` runs it.
  const startedIn = process.cwd();
  process.chdir(WEB);
  try {
    await build({ ...quiet, build: { outDir: shipped, emptyOutDir: true, sourcemap: true } });
    assert.ok(fs.existsSync(path.join(shipped, 'index.html')), 'the real build produced no index.html');
    assert.deepEqual(containsSentinel(shipped), [], 'the shipped bundle must not contain the prototype');

    // Positive control: the same build with the prototype page as the entry MUST carry the sentinel,
    // or the scan above proves nothing.
    await build({
      ...quiet,
      build: {
        outDir: control,
        emptyOutDir: true,
        rollupOptions: {
          input: path.join(WEB, 'prototype.html'),
          // The dev identity tree reaches Node-only modules a browser bundle cannot resolve; it is not
          // what the control measures, so it stays external.
          external: (id) => /[\\/]src[\\/]dev[\\/]|auth-fake|fxl-contracts/.test(id),
        },
      },
    });
    assert.ok(containsSentinel(control).length > 0, 'the control build carried no sentinel: the scan is vacuous');
  } finally {
    process.chdir(startedIn);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
