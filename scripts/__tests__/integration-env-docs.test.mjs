/**
 * The dev env example must carry what the integration suite requires.
 *
 * `apps/api/test/rls/assert-test-role.ts` (`resolveIntegrationDatabaseUrls`) refuses
 * to start the integration suite unless `TEST_DATABASE_URL` and `ADMIN_DATABASE_URL`
 * are named explicitly, with `TEST_MIGRATE_DATABASE_URL` optional and falling back to
 * `ADMIN_DATABASE_URL`. The example a fresh clone copies to `apps/api/.env` used to
 * call `ADMIN_DATABASE_URL` optional and never mention `TEST_DATABASE_URL`, so the
 * documented copy step produced an `.env` the suite refused.
 *
 * The names, the required subset, the fallback and the documented local values are
 * all read out of the resolver's SOURCE, never restated here, so the two cannot
 * drift apart again. Every parse fails loudly when it finds nothing, because an
 * empty name list would make every assertion below pass vacuously.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const RESOLVER = 'apps/api/test/rls/assert-test-role.ts';
const EXAMPLE = 'apps/api/.env.dev.example';
const THIS_FILE = 'scripts/__tests__/integration-env-docs.test.mjs';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1', 'db']);

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

function mustMatch(source, pattern, what) {
  const match = source.match(pattern);
  if (!match) throw new Error(`could not find ${what} in ${RESOLVER}; update this guard`);
  return match;
}

function nonEmpty(list, what) {
  if (list.length === 0) throw new Error(`found zero ${what} in ${RESOLVER}; update this guard`);
  return list;
}

/** What `resolveIntegrationDatabaseUrls` reads, requires, falls back to and documents. */
function resolverContract() {
  const source = read(RESOLVER);

  const body = mustMatch(
    source,
    /export function resolveIntegrationDatabaseUrls\([\s\S]*?\n}\n/,
    'resolveIntegrationDatabaseUrls',
  )[0];

  const names = nonEmpty(
    [...new Set([...body.matchAll(/\benv\.([A-Z][A-Z0-9_]*)/g)].map((m) => m[1]))],
    'env names read by resolveIntegrationDatabaseUrls',
  );

  const requiredLoop = mustMatch(
    body,
    /for \(const \[name, value\] of \[([\s\S]*?)\] as const\)/,
    'the "is not set" loop',
  )[1];
  const required = nonEmpty(
    [...requiredLoop.matchAll(/'([A-Z][A-Z0-9_]*)'/g)].map((m) => m[1]),
    'required names',
  );

  // `const adminUrl = present(env.ADMIN_DATABASE_URL);` maps locals to env names.
  const localToName = new Map(
    [...body.matchAll(/const (\w+) = present\(env\.([A-Z][A-Z0-9_]*)\)/g)].map((m) => [m[1], m[2]]),
  );
  // `present(env.TEST_MIGRATE_DATABASE_URL) ?? adminUrl` is a fallback.
  const fallbacks = new Map(
    [...body.matchAll(/present\(env\.([A-Z][A-Z0-9_]*)\)\s*\?\?\s*(\w+)/g)].map((m) => {
      const target = localToName.get(m[2]);
      if (!target) throw new Error(`fallback ${m[1]} ?? ${m[2]} names no env variable`);
      return [m[1], target];
    }),
  );

  const documentedBlock = mustMatch(
    source,
    /const DOCUMENTED_LOCAL_VALUES = \[([\s\S]*?)\];/,
    'DOCUMENTED_LOCAL_VALUES',
  )[1];
  const documented = nonEmpty(
    [...documentedBlock.matchAll(/'([A-Z][A-Z0-9_]*)=([^']+)'/g)].map((m) => ({
      name: m[1],
      value: m[2],
    })),
    'documented local values',
  );

  return { names, required, fallbacks, documented };
}

/** Active `KEY=VALUE` lines of the example, by key. */
function activeLines(text) {
  const bag = new Map();
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    bag.set(trimmed.slice(0, eq).trim(), trimmed.slice(eq + 1).trim());
  }
  return bag;
}

/** The contiguous comment block directly above the active `name=` line. */
function commentAbove(text, name) {
  const lines = text.split('\n');
  const at = lines.findIndex((line) => line.startsWith(`${name}=`));
  assert.notEqual(at, -1, `${EXAMPLE} has no active ${name}= line`);
  const block = [];
  for (let i = at - 1; i >= 0 && lines[i].startsWith('#'); i -= 1) block.unshift(lines[i]);
  return block.join('\n');
}

const contract = resolverContract();
const example = read(EXAMPLE);
const active = activeLines(example);

test('the resolver contract parses to the names the suite reads', () => {
  // Vacuity guard: everything below iterates these lists.
  assert.deepEqual(
    [...contract.documented.map((d) => d.name)].sort(),
    [...contract.names].sort(),
    'DOCUMENTED_LOCAL_VALUES and the names the resolver reads must be the same set',
  );
  for (const name of contract.required) assert.ok(contract.names.includes(name), name);
  for (const name of contract.names) {
    assert.ok(
      contract.required.includes(name) || contract.fallbacks.has(name),
      `${name} is neither required nor a fallback; update this guard`,
    );
  }
});

for (const { name, value } of contract.documented) {
  test(`${EXAMPLE} ships ${name} with its documented local value`, () => {
    assert.equal(active.get(name), value);
    const host = new URL(value).hostname;
    assert.ok(LOCAL_HOSTS.has(host), `${name} must point at a local host, got ${host}`);
  });
}

for (const name of contract.required) {
  test(`${EXAMPLE} never calls the required ${name} optional`, () => {
    assert.doesNotMatch(commentAbove(example, name), /optional/i);
    for (const line of example.split('\n')) {
      if (line.includes(name)) assert.doesNotMatch(line, /optional/i, line);
    }
    assert.match(commentAbove(example, name), /test:integration/);
  });
}

test(`${EXAMPLE} names each fallback the resolver applies`, () => {
  assert.ok(contract.fallbacks.size > 0, 'expected at least one fallback');
  for (const [name, target] of contract.fallbacks) {
    const comment = commentAbove(example, name);
    assert.match(comment, /optional/i, `${name} should be described as optional`);
    assert.ok(comment.includes(target), `${name}'s comment should name its fallback ${target}`);
  }
});

test(`${EXAMPLE} describes TEST_DATABASE_URL as the non-superuser fxl_sales_test role`, () => {
  const comment = commentAbove(example, 'TEST_DATABASE_URL');
  assert.match(comment, /fxl_sales_test/);
  assert.match(comment, /SUPERUSER|superuser/);
});

test(`${EXAMPLE} describes ADMIN_DATABASE_URL by what it does at runtime`, () => {
  const comment = commentAbove(example, 'ADMIN_DATABASE_URL');
  assert.match(comment, /getAdminDb/);
  assert.match(comment, /DATABASE_URL/);
  assert.match(comment, /SALES_ENV_FILE/);
});

test(`${EXAMPLE} uses no em dash`, () => {
  assert.ok(!example.includes('—'));
});

test('the root test script runs this guard and names only files that exist', () => {
  // `node --test a b c` with one MISSING file still exits 0 when another file is
  // given, so a dangling name is a silently skipped oracle.
  const script = JSON.parse(read('package.json')).scripts.test;
  const listed = [...script.matchAll(/scripts\/__tests__\/[\w.-]+\.test\.mjs/g)].map((m) => m[0]);
  assert.ok(listed.includes(THIS_FILE), `${THIS_FILE} is not in the root test script`);
  for (const file of listed) {
    assert.ok(fs.existsSync(path.join(ROOT, file)), `root test script names missing ${file}`);
  }
  for (const entry of fs.readdirSync(path.join(ROOT, 'scripts/__tests__'))) {
    if (!entry.endsWith('.test.mjs')) continue;
    const file = `scripts/__tests__/${entry}`;
    assert.ok(listed.includes(file), `${file} exists but the root test script never runs it`);
  }
});
