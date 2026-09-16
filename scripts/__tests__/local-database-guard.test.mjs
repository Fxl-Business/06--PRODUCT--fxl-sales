import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';

/**
 * Structural guard for the local-database refusal added in v4.1.0.
 *
 * It answers three questions about two exact files, and nothing else:
 *   1. does apps/api/src/server.ts still INVOKE assertLocalDatabase?
 *   2. does apps/api/src/db/migrate.ts still INVOKE assertLocalDatabase?
 *   3. did apps/api/src/db/migrate.ts regain a RAW `dotenv/config` import?
 *
 * Question 3 is the one that caused the 2026-09-16 incident: migrate.ts read
 * process.env.DATABASE_URL raw, never passing through env.ts, so a guard in the
 * env schema would not have covered the path that applies DDL.
 *
 * Unlike its two siblings in this directory it does NOT shell out to `git grep`.
 * Their question is repository-wide ("does this banned string appear anywhere
 * tracked?"), which is what a pathspec and the git index are for. This one asks
 * about two named paths, so it reads them. A repo-wide grep would pass with the
 * call sitting in some third, irrelevant file - the exact false green this file
 * exists to prevent - and would not notice either file being renamed away.
 *
 * Consequently it needs neither the `git init` fixture idiom nor the
 * `:(exclude)nexo` / `:(exclude)CLAUDE.md` pathspec: prose naming the guard
 * anywhere else in the repository is invisible to it.
 */

// The one place the slice-02 symbol is spelled. Every regex derives from it.
const GUARD_SYMBOL = 'assertLocalDatabase';

const SELF = fileURLToPath(import.meta.url);

// Test-harness knob ONLY. It lets the negative cases below run this same file
// against a throwaway fixture tree, so proving the guard never requires damaging
// the real server.ts or migrate.ts. It is not an application variable, it is
// never set in any committed script, and it is unrelated to the named env-file
// opt-in, which nothing here sets.
const FIXTURE_ROOT_VAR = 'FXL_LOCAL_DB_GUARD_ROOT';
const injectedRoot = process.env[FIXTURE_ROOT_VAR];
const IS_FIXTURE_RUN = typeof injectedRoot === 'string' && injectedRoot.length > 0;

// Two levels up from scripts/__tests__/. Derived from import.meta.url and never
// from process.cwd(), so the verdict does not depend on where node was started.
const ROOT = IS_FIXTURE_RUN
  ? path.resolve(injectedRoot)
  : fileURLToPath(new URL('../../', import.meta.url));

const SERVER_REL = 'apps/api/src/server.ts';
const MIGRATE_REL = 'apps/api/src/db/migrate.ts';

// MODULE SCOPE, deliberately and load-bearingly. A throw inside a test callback
// can end the run with zero tests executed and exit 0 - the guard would pass
// while certifying nothing. The reads happen here; the error, if any, is turned
// into a real failing assertion below.
let loadError = null;
let serverSource = '';
let migrateSource = '';

try {
  serverSource = fs.readFileSync(path.join(ROOT, SERVER_REL), 'utf8');
  migrateSource = fs.readFileSync(path.join(ROOT, MIGRATE_REL), 'utf8');
} catch (error) {
  loadError = error;
}

/**
 * Strip comments so a commented-out call cannot satisfy the guard.
 * Whole-line `//` only: server.ts contains `http://localhost:${port}` inside a
 * template literal, and stripping from the first `//` anywhere would mutilate it.
 * A genuinely commented-out guard call sits on its own line.
 */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

const serverCode = stripComments(serverSource);
const migrateCode = stripComments(migrateSource);

const CALL = new RegExp(`\\b${GUARD_SYMBOL}\\s*\\(`);
const NAMED_IMPORT = new RegExp(`import[^;]*\\b${GUARD_SYMBOL}\\b[^;]*from`);
const RAW_DOTENV = /(?:import\s+|require\s*\(\s*)['"]dotenv\/config['"]/;

test('both inspected files exist and are readable', () => {
  assert.equal(
    loadError,
    null,
    `could not read the inspected files under ${ROOT}: ${loadError && loadError.message}. ` +
      'A rename or a move is a regression here, not an excuse to pass.',
  );
});

test('the inspected files are the real entrypoints, not empty or substituted', () => {
  assert.ok(serverSource.length > 500, `${SERVER_REL} is implausibly small`);
  assert.ok(migrateSource.length > 200, `${MIGRATE_REL} is implausibly small`);
  assert.match(serverSource, /@hono\/node-server/);
  assert.match(serverSource, /app\.fetch/);
  assert.match(migrateSource, /runDatabaseMigrations/);
  assert.match(migrateSource, /migrationsFolder/);
});

test(`${SERVER_REL} invokes ${GUARD_SYMBOL}`, () => {
  assert.match(serverCode, NAMED_IMPORT, `${SERVER_REL} must import ${GUARD_SYMBOL}`);
  assert.match(serverCode, CALL, `${SERVER_REL} must call ${GUARD_SYMBOL}`);
});

test(`${MIGRATE_REL} invokes ${GUARD_SYMBOL}`, () => {
  // The central requirement of v4.1.0: this is the path that applies DDL.
  assert.match(migrateCode, NAMED_IMPORT, `${MIGRATE_REL} must import ${GUARD_SYMBOL}`);
  assert.match(migrateCode, CALL, `${MIGRATE_REL} must call ${GUARD_SYMBOL}`);
});

test(`${MIGRATE_REL} has no raw dotenv/config import`, () => {
  assert.doesNotMatch(
    migrateCode,
    RAW_DOTENV,
    `${MIGRATE_REL} must load its environment through the shared resolver, never a raw import`,
  );
});

// ── Negative cases ───────────────────────────────────────────────────────────
// Each regression is proven by running THIS FILE as a child `node --test`
// process against a mutated copy of the real sources, and reading the child's
// EXIT CODE. The message text is never the oracle, and the real server.ts and
// migrate.ts are never written to. A child has FIXTURE_ROOT_VAR set, so it skips
// this block and never spawns a grandchild.
if (!IS_FIXTURE_RUN) {
  const tempRoots = [];

  after(() => {
    for (const dir of tempRoots) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function makeFixture(name, files) {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `local-db-guard-${name}-`)));
    tempRoots.push(dir);

    for (const [relative, contents] of Object.entries(files)) {
      const target = path.join(dir, relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, contents);
    }

    return dir;
  }

  function runAgainst(dir) {
    // `node --test` runs each test FILE in a child process carrying
    // NODE_TEST_CONTEXT (and its pipe/worker siblings). Inheriting those makes
    // the grandchild believe it is already inside a runner: it warns "run() is
    // being called recursively within a test file. skipping running files",
    // executes NOTHING and exits 0. Every negative case below would then read
    // as green while proving nothing - the precise vacuity this file exists to
    // prevent - so the runner's own variables are removed from the child env.
    const childEnv = { ...process.env, [FIXTURE_ROOT_VAR]: dir };
    for (const key of Object.keys(childEnv)) {
      if (key.startsWith('NODE_TEST_')) delete childEnv[key];
    }

    return spawnSync(process.execPath, ['--test', SELF], {
      cwd: ROOT,
      encoding: 'utf8',
      env: childEnv,
    });
  }

  // Delete every line carrying the call. Asserting the mutation CHANGED
  // something is what stops a negative case passing for the wrong reason.
  function withoutCall(source) {
    const mutated = source
      .split('\n')
      .filter((line) => !CALL.test(line))
      .join('\n');
    assert.notEqual(mutated, source, 'the mutation removed nothing - the fixture proves nothing');
    return mutated;
  }

  test('an unmutated fixture passes (positive control)', () => {
    const dir = makeFixture('clean', {
      [SERVER_REL]: serverSource,
      [MIGRATE_REL]: migrateSource,
    });

    const result = runAgainst(dir);

    assert.equal(result.status, 0, `a faithful copy must pass:\n${result.stdout}${result.stderr}`);
  });

  test('FAILS when server.ts stops invoking the guard', () => {
    const dir = makeFixture('no-server-call', {
      [SERVER_REL]: withoutCall(serverSource),
      [MIGRATE_REL]: migrateSource,
    });

    assert.notEqual(runAgainst(dir).status, 0);
  });

  test('FAILS when migrate.ts stops invoking the guard', () => {
    const dir = makeFixture('no-migrate-call', {
      [SERVER_REL]: serverSource,
      [MIGRATE_REL]: withoutCall(migrateSource),
    });

    assert.notEqual(runAgainst(dir).status, 0);
  });

  test('FAILS when migrate.ts regains a raw dotenv/config import', () => {
    const dir = makeFixture('raw-dotenv', {
      [SERVER_REL]: serverSource,
      [MIGRATE_REL]: `import 'dotenv/config';\n${migrateSource}`,
    });

    assert.notEqual(runAgainst(dir).status, 0);
  });

  test('FAILS when an inspected file is missing', () => {
    const dir = makeFixture('missing-server', {
      [MIGRATE_REL]: migrateSource,
    });

    assert.notEqual(runAgainst(dir).status, 0);
  });
}
