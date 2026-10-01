// Guard: every `workspace:` dependency of apps/api (dependencies AND
// devDependencies, followed transitively through the workspace) must be
// installed by the API image. The deps stage has to COPY its package.json
// before `pnpm install`, and the build stage has to COPY its node_modules from
// deps, or `tsc` cannot resolve that package's own dependencies.
//
// Added after the v4.1.0 release-verify FAIL: tsc followed src/auth/select.ts's
// dynamic import into packages/auth-fake, whose dependency
// `@fxl-business/fxl-contracts/testing` the deps stage never installed.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const API_MANIFEST = 'apps/api/package.json';
const DOCKERFILE = 'apps/api/Dockerfile';

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
}

function workspaceGlobs() {
  const text = fs.readFileSync(path.join(ROOT, 'pnpm-workspace.yaml'), 'utf8');
  const globs = [];
  let inPackages = false;
  for (const line of text.split('\n')) {
    if (/^packages:\s*$/.test(line)) {
      inPackages = true;
      continue;
    }
    if (inPackages) {
      const match = line.match(/^\s+-\s+['"]?([^'"\s]+)['"]?\s*$/);
      if (match) globs.push(match[1]);
      else if (/^\S/.test(line)) inPackages = false;
    }
  }
  assert.ok(globs.length > 0, 'pnpm-workspace.yaml lists no packages globs');
  return globs;
}

// Maps package name -> workspace-relative directory.
function workspacePackages() {
  const byName = new Map();
  for (const glob of workspaceGlobs()) {
    assert.match(glob, /^[\w.-]+\/\*$/, `unsupported workspace glob ${glob}`);
    const parent = glob.slice(0, -2);
    for (const entry of fs.readdirSync(path.join(ROOT, parent), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = `${parent}/${entry.name}`;
      const manifest = path.join(ROOT, dir, 'package.json');
      if (!fs.existsSync(manifest)) continue;
      byName.set(JSON.parse(fs.readFileSync(manifest, 'utf8')).name, dir);
    }
  }
  return byName;
}

function workspaceDepNames(manifest) {
  const names = [];
  for (const field of ['dependencies', 'devDependencies']) {
    for (const [name, spec] of Object.entries(manifest[field] ?? {})) {
      if (String(spec).startsWith('workspace:')) names.push(name);
    }
  }
  return names;
}

// Transitive closure of apps/api's workspace deps.
function apiWorkspaceDeps() {
  const packages = workspacePackages();
  const found = new Map();
  const queue = workspaceDepNames(readJson(API_MANIFEST));
  while (queue.length > 0) {
    const name = queue.shift();
    if (found.has(name)) continue;
    const dir = packages.get(name);
    assert.ok(dir, `workspace dependency ${name} matches no package in pnpm-workspace.yaml`);
    found.set(name, dir);
    queue.push(...workspaceDepNames(readJson(`${dir}/package.json`)));
  }
  return found;
}

// Splits the Dockerfile into stages keyed by their `AS` name, each holding its
// instructions with line continuations joined.
function dockerStages() {
  const text = fs.readFileSync(path.join(ROOT, DOCKERFILE), 'utf8').replace(/\\\r?\n/g, ' ');
  const stages = new Map();
  let current = null;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const from = line.match(/^FROM\s+\S+(?:\s+AS\s+(\S+))?/i);
    if (from) {
      current = [];
      stages.set(from[1] ?? `#${stages.size}`, current);
      continue;
    }
    if (current) current.push(line);
  }
  return stages;
}

function copyArgs(line) {
  const match = line.match(/^COPY\s+(.*)$/i);
  if (!match) return null;
  const tokens = match[1].split(/\s+/);
  const flags = tokens.filter((t) => t.startsWith('--'));
  const paths = tokens.filter((t) => !t.startsWith('--'));
  return { flags, sources: paths.slice(0, -1), dest: paths.at(-1) };
}

const strip = (p) => p.replace(/^\.\//, '').replace(/^\/app\//, '').replace(/\/$/, '');

const deps = apiWorkspaceDeps();
const stages = dockerStages();

test('apps/api has workspace dependencies to check (the guard is not vacuous)', () => {
  assert.ok(deps.size > 0, `found zero workspace: dependencies in ${API_MANIFEST}`);
  assert.ok(deps.has('@fxl-sales/auth-fake'), 'expected the auth-fake devDependency to be found');
  assert.ok(stages.has('deps'), `${DOCKERFILE} has no "deps" stage`);
  assert.ok(stages.has('build'), `${DOCKERFILE} has no "build" stage`);
});

for (const [name, dir] of deps) {
  test(`${DOCKERFILE} deps stage copies ${dir}/package.json (${name})`, () => {
    const copied = stages
      .get('deps')
      .map(copyArgs)
      .filter((c) => c && !c.flags.some((f) => f.startsWith('--from')))
      .some((c) => c.sources.map(strip).includes(`${dir}/package.json`) && strip(c.dest) === dir);
    assert.ok(copied, `the deps stage must "COPY ${dir}/package.json ${dir}/" before pnpm install`);
  });

  test(`${DOCKERFILE} build stage copies ${dir}/node_modules from deps (${name})`, () => {
    const copied = stages
      .get('build')
      .map(copyArgs)
      .filter((c) => c && c.flags.includes('--from=deps'))
      .some((c) => c.sources.map(strip).includes(`${dir}/node_modules`) && strip(c.dest) === `${dir}/node_modules`);
    assert.ok(
      copied,
      `the build stage must "COPY --from=deps /app/${dir}/node_modules ./${dir}/node_modules"`,
    );
  });
}
