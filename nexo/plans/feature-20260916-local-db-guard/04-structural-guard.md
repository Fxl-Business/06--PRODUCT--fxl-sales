---
id: 04-structural-guard
milestone: v4.1.0
status: todo
depends_on: [02-local-database-guard]
files_modified:
  - scripts/__tests__/local-database-guard.test.mjs
  - package.json
acceptance: "given the two entrypoints that reach a database, when either `apps/api/src/server.ts` or `apps/api/src/db/migrate.ts` stops invoking `assertLocalDatabase`, or `migrate.ts` regains a raw `dotenv/config` import, then `pnpm run test` exits non-zero because `node --test scripts/__tests__/local-database-guard.test.mjs` fails - and each of those three regressions is proven inside the test file itself, by EXIT CODE, against a throwaway fixture tree, never by damaging the real sources"
goal: Make the slice-02 guard structurally irremovable by a tracked `node --test` file wired into the root `test` script.
must_not_break:
  - The root `test` script's existing chain - `build:packages`, `pnpm -r --if-present test`, the two existing `node --test` files, the three `node scripts/*.mjs` gates - all keep running, in the same order, with the same semantics.
  - `scripts/no-legacy-auth.mjs` and `scripts/no-legacy-env-names.mjs` are NOT edited. In particular `SALES_ENV_FILE` is never added to the retired-names list; it is a new name, not a retired one, and that guard keeps exactly one purpose.
  - No real source file is ever temporarily damaged to prove a negative case. `apps/api/src/server.ts` and `apps/api/src/db/migrate.ts` are read-only to this slice.
  - No database is contacted by anything this slice adds. The test file opens no socket.
rules:
  - The files under inspection are read at MODULE SCOPE, never inside a `test`/`describe` callback, and the read result is asserted by a real `test` so a load failure is a FAILING TEST and not a zero-test green run.
  - Every negative case is proven by the process EXIT CODE of a child `node --test` run against a fixture tree, never by matching message text.
  - The inspected root is injectable through the `FXL_LOCAL_DB_GUARD_ROOT` environment variable; that is the only mechanism by which a negative case is produced.
  - `SALES_ENV_FILE` is never set, mentioned in a command, or written into any file this slice touches.
  - The host `fxl-db-server`, and any host on `tail89bca3.ts.net`, appears nowhere - not in a test, not in a command, not in a comment. The only remote-looking host used anywhere in this slice is the RFC 6761 reserved, guaranteed-unresolvable `db.example.invalid`.
  - No credential and no real remote database URL enters a tracked file.
verifier_focus: Prove by exit code that the new `node --test` file goes RED for each of the three regressions (server call removed, migrate call removed, raw `dotenv/config` back in migrate) and GREEN on an unmutated fixture, without any edit to the real `server.ts` or `migrate.ts`.
---

# 04 - structural guard

## What this slice is for

Slice 02 put `assertLocalDatabase` into the two entrypoints that can reach a database. Nothing yet
stops a future edit - a refactor, a merge, an agent tidying imports - from deleting either call, or
from putting `import 'dotenv/config'` back at the top of `migrate.ts` and reopening the raw
`process.env.DATABASE_URL` path that caused the incident. A behavioural test cannot see that: the
code still compiles, the suite still passes, and the protection is simply gone.

So this slice adds a STRUCTURAL guard - a tracked `node --test` file that reads the two source files
as text and fails if the shape it depends on is no longer there.

## Preconditions the executor MUST confirm before writing a line

Slices 01 and 02 land first. Confirm the three facts this guard is written against:

```
cd /Users/cauetpinciara/Documents/fxl/projects/06--PRODUCT--fxl-sales
grep -n "assertLocalDatabase" apps/api/src/server.ts apps/api/src/db/migrate.ts
grep -rn "assertLocalDatabase" apps/api/src --include=*.ts | grep -v __tests__
grep -n "dotenv" apps/api/src/db/migrate.ts
```

Expected:

1. The exported symbol is spelled exactly `assertLocalDatabase`. If slice 02 landed a different
   spelling, change ONLY the `GUARD_SYMBOL` constant at the top of the new test file - every regex
   is derived from it - and record the deviation in the run's `AUDIT.md`.
2. Both `server.ts` and `migrate.ts` contain a NAMED import of it (`import { assertLocalDatabase }
   from '...'`) and a call `assertLocalDatabase(`. This is what slice 02's contract says: a pure,
   exported function invoked from entrypoints only. If the landed code instead uses a namespace
   import (`import * as guard from ...; guard.assertLocalDatabase(...)`), that is a deviation from
   the slice-02 contract - STOP, record it in `AUDIT.md`, and report it rather than quietly
   loosening the regex.
3. `apps/api/src/db/migrate.ts` no longer contains `import 'dotenv/config'` (slice 01 replaced it
   with the shared resolver). If it still does, slice 01 did not land and this slice cannot be green;
   stop.

Also confirm the identity anchors used for the non-vacuity assertions still hold:

```
grep -c "@hono/node-server" apps/api/src/server.ts
grep -c "app.fetch" apps/api/src/server.ts
grep -c "runDatabaseMigrations" apps/api/src/db/migrate.ts
grep -c "migrationsFolder" apps/api/src/db/migrate.ts
```

All four must print a non-zero count. If any is zero, substitute an equally distinctive substring
from the landed file and note the substitution in `AUDIT.md`.

## Design decisions, and why (the executor makes none of these again)

### Read the two files directly - do NOT `git grep`

`no-legacy-auth.mjs` and `no-legacy-env-names.mjs` shell out to `git grep` because their question is
repository-wide: *does this banned string appear ANYWHERE tracked?* A pathspec and the git index are
the right instrument for that, and `git grep` reading the INDEX is precisely why their tests must
`git add` their fixtures.

This guard's question is the opposite shape: *do these TWO EXACT FILES still have these shapes?*
Reading the two paths with `fs.readFileSync` is more precise and has strictly better failure modes:

- A repo-wide grep for `assertLocalDatabase` would pass while the call sat in a third, irrelevant
  file - the exact false green this slice exists to prevent.
- A direct read FAILS LOUDLY if either file is renamed or moved, which is the other way the
  protection can disappear. A grep would just report "no match" for the dotenv check and quietly pass.
- There is no index to keep in sync, so the fixture trees need no `git init` and no `git add -f`.

**Therefore the `makeRepo` idiom from `no-legacy-env-names.test.mjs` does NOT transfer.** Its git
plumbing exists solely to feed `git grep`. What DOES transfer is everything else about that file:
`spawnSync` a real child process, a `tmpdir` fixture, `after()` cleanup of `tempRoots`, and verdicts
read off `result.status`.

### Finding the repo root robustly, and making it injectable

The test file lives at `scripts/__tests__/`, so the repo root is `new URL('../../', import.meta.url)`
- two levels up from the file itself, resolved through `fileURLToPath`. This is cwd-independent by
construction.

The root is then overridable by the environment variable `FXL_LOCAL_DB_GUARD_ROOT`. This is the ONLY
way a negative case is produced: the test file re-invokes ITSELF as a child `node --test` process
with that variable pointed at a mutated fixture tree, and reads the child's exit code. The real
`server.ts` and `migrate.ts` are never written to.

Recursion is cut off by the variable itself: when `FXL_LOCAL_DB_GUARD_ROOT` is set, the file
registers ONLY the inspection tests and skips the fixture-spawning tests. A child therefore never
spawns a grandchild.

Note the variable is a TEST-HARNESS knob, not an application variable. It never reaches
`apps/api/src/env.ts`, it is never set in any committed script, and it has nothing to do with
`SALES_ENV_FILE`, which this slice must never set anywhere.

### What "module scope" means here, and why it is load-bearing

The human's rule: a throw inside a `describe`/`test` callback can terminate the runner having
executed ZERO tests while still exiting 0 - the guard passes while certifying nothing.

So the two `readFileSync` calls sit at MODULE SCOPE, at the top of the file, outside every callback,
exactly as the two existing guard tests compute their `GUARD` path and their banned literals at
module scope. Belt and braces on top: the reads are wrapped in a module-scope `try/catch` that
stores the error in a `loadError` binding, and the FIRST registered test asserts `loadError === null`.
That way a missing or renamed file is a REPORTED FAILING TEST with a non-zero exit, independent of
how any future Node version chooses to report an import-time throw. (Confirmed on this machine,
Node v22.22.3: `node --test <missing-file>` exits 1. CI runs Node 20; every API used here -
`node:test`'s `test`/`after`, `fs.mkdtempSync`, `spawnSync` - is available on both.)

### Non-vacuity

Three independent layers, so a renamed, emptied or substituted file cannot make the guard trivially
green:

1. `loadError === null` - the two paths exist and are readable.
2. Each source is non-empty and above a size floor (`server.ts` > 500 bytes, `migrate.ts` > 200
   bytes).
3. Each source contains its identity anchors - `server.ts` contains `@hono/node-server` and
   `app.fetch`; `migrate.ts` contains `runDatabaseMigrations` and `migrationsFolder`. A file that
   is merely *named* `server.ts` but is not the API entrypoint fails here.

Plus the decisive fourth layer, in the fixture tests: an UNMUTATED fixture (a byte copy of the real
two files) must come back GREEN. Without that positive control, a harness bug that made every child
red would read as "all three guards work".

### Comment stripping

Matching is done on a comment-stripped copy so a commented-out call cannot satisfy the guard. The
stripper is deliberately conservative:

- `/\*[\s\S]*?\*\//g` -> `''` removes block comments.
- `/^[ \t]*\/\/.*$/gm` -> `''` removes only WHOLE-LINE `//` comments.

The second pattern is anchored to the start of the line on purpose: `server.ts` contains
`http://localhost:${port}` inside a template literal, and a naive "strip from the first `//`" would
mutilate it. A genuine commented-out guard call would sit on its own line, so the anchored form
catches the case that matters and cannot damage a URL.

### Does it need the `nexo/` + `CLAUDE.md` pathspec?

No, and this is a deliberate decision rather than a copied reflex. That pathspec exists because the
other two guards grep the WHOLE repository for a banned string, and the append-only delivery record
under `nexo/` plus the prose record in `CLAUDE.md` legitimately NAME what was removed. This guard
reads two exact paths and searches nothing else, so prose about `assertLocalDatabase` anywhere in the
repository - including in this very plan file - is invisible to it. **Do not add a pathspec, and do
not add exclusions.**

### Is the root `test` script order- or cwd-sensitive?

No, on both counts, and the new file must not introduce sensitivity.

- **cwd**: `pnpm run test` executes with cwd = the root package directory, which is the repo root;
  that is what makes the existing relative paths `scripts/__tests__/*.test.mjs` resolve. The new
  file nonetheless derives every path from `import.meta.url`, never from `process.cwd()`, so it is
  correct regardless of cwd. The child spawn passes `cwd: ROOT` for tidiness only; nothing depends
  on it.
- **order**: `node --test a.mjs b.mjs c.mjs` runs each file in its OWN child process with no shared
  state. The three files share nothing; the new one creates only `os.tmpdir()` directories with
  unique `mkdtemp` suffixes and removes them in `after()`. Order is irrelevant.
- The `test` script is a `&&` chain, so a non-zero exit from the `node --test` step short-circuits
  the rest and the script exits non-zero. That is the mechanism by which this guard fails the build.

## Deliverable 1 - `scripts/__tests__/local-database-guard.test.mjs`

Create it with exactly this structure. It is ESM (`.mjs`), matching its two siblings. Formatting
follows `prettier.config.js` (single quotes, semicolons, trailing commas, print width 100).

```js
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
    return spawnSync(process.execPath, ['--test', SELF], {
      cwd: ROOT,
      encoding: 'utf8',
      env: { ...process.env, [FIXTURE_ROOT_VAR]: dir },
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
```

Notes for the executor, none of which are choices:

- Keep the tests' order as written. It is not required for correctness (each is independent) but it
  reads as: existence -> identity -> the three assertions -> the proofs.
- `tempRoots`, `after`, `makeFixture` and `runAgainst` live INSIDE the `if (!IS_FIXTURE_RUN)` block
  because nothing in the fixture run needs them. The two `readFileSync` calls stay OUTSIDE it, at
  true module scope, because both run modes depend on them.
- Do not add a `describe` wrapper. The siblings use bare `test()` and so does this.

## Deliverable 2 - the `package.json` edit

One line changes, in the root `package.json`, `scripts.test`. The new file joins the EXPLICIT
`node --test` list beside its two siblings. No glob: the explicit list is the house idiom and is what
makes an accidentally-unrun file visible in review.

BEFORE (exact, single line):

```
    "test": "pnpm run build:packages && pnpm -r --if-present test && node --test scripts/__tests__/no-legacy-auth.test.mjs scripts/__tests__/no-legacy-env-names.test.mjs && node scripts/no-legacy-auth.mjs && node scripts/no-legacy-env-names.mjs && node scripts/build-contract.mjs",
```

AFTER (exact, single line):

```
    "test": "pnpm run build:packages && pnpm -r --if-present test && node --test scripts/__tests__/no-legacy-auth.test.mjs scripts/__tests__/no-legacy-env-names.test.mjs scripts/__tests__/local-database-guard.test.mjs && node scripts/no-legacy-auth.mjs && node scripts/no-legacy-env-names.mjs && node scripts/build-contract.mjs",
```

The only difference is ` scripts/__tests__/local-database-guard.test.mjs` inserted after
`scripts/__tests__/no-legacy-env-names.test.mjs` and before the ` && node scripts/no-legacy-auth.mjs`.
Nothing else in `package.json` changes - not `version`, not `fxlContractVersion`, not the
dependency blocks.

There is no second entry to add: unlike `no-legacy-auth` and `no-legacy-env-names`, this slice ships
no standalone `scripts/*.mjs` gate. The test file IS the guard.

## Proof - commands, with expected exit codes

Run from the repo root. `$?` is the oracle everywhere; stdout is context, never the verdict.

### P1 - the new guard alone, green on the real tree

```
node --test scripts/__tests__/local-database-guard.test.mjs; echo "exit=$?"
```

Expect `exit=0`, and the summary must report `pass 10` / `fail 0`. **Ten is part of the oracle** (5 inspection tests + 5 fixture tests): a
run reporting `pass 0` is the vacuous green this file was written to prevent, and must be treated as
a failure even though the exit code is 0.

### P2 - each negative case, proven by exit code

P1 already proves all four negatives: the four mutation tests are themselves child `node --test`
runs whose non-zero exit is asserted. No extra command is needed and NO SOURCE FILE IS TOUCHED.

To see the proof rather than trust it, run the mutation tests by name:

```
node --test --test-name-pattern "FAILS when" scripts/__tests__/local-database-guard.test.mjs; echo "exit=$?"
```

Expect `exit=0` with four passing tests. Each of those four passes means a child process exited
non-zero on a broken tree.

### P3 - the whole suite

```
pnpm run test; echo "exit=$?"
```

Expect `exit=0`, with the local Postgres up (`docker compose up -d`, host `localhost`, port `5006`,
database `fxl_sales` - never any other database). This also re-runs `no-legacy-auth` and
`no-legacy-env-names`, which must stay green; this slice adds no banned string to any tracked file.

### P4 - type-check and lint unaffected

```
pnpm run type-check; echo "exit=$?"
pnpm run lint; echo "exit=$?"
```

Both `exit=0`. Neither covers `scripts/` - `type-check` and `lint` are `pnpm -r`, per workspace
package, and root `scripts/` belongs to no workspace package - so the new `.mjs` is outside both by
construction. Run them anyway to prove this slice changed nothing there.

### P5 - EXECUTOR CHECK: the feature's central acceptance criterion

This is not a committed test. It is run by hand, once, and its exit code recorded in the run's
`AUDIT.md`.

```
DATABASE_URL='postgres://guard:guard@db.example.invalid:5432/nope' \
  pnpm --filter @fxl-sales/api db:migrate; echo "exit=$?"
```

Expect a NON-ZERO exit (slice 02 refuses with `process.exit(1)`; assert `exit != 0`, and record the
exact code observed). Expect stderr to name `db.example.invalid`. **The exit code is the verdict.
The message text is context only.**

Why this command is safe, and why a synthetic host is a valid proof:

- `db.example.invalid` is in the `.invalid` TLD, reserved by RFC 6761 and guaranteed never to
  resolve. Even a total failure of the guard cannot reach anything.
- The guard's refusal is a pure string comparison of the URL's hostname against `localhost`,
  `127.0.0.1`, `::1`, `db`. It refuses BEFORE any socket is opened, so a reachable host would add
  nothing to the proof and would only add risk.
- Which is why the real staging host is NOT used. It resolves and answers on this machine over
  Tailscale; a command fired at it reaches live staging data. It must not appear in this command, in
  any test, or in any comment someone might copy.
- No named env file is set. `SALES_ENV_FILE` is not exported, not prefixed onto the command, not
  written anywhere. Setting it is exactly the escape hatch this check must NOT take.
- The inline `DATABASE_URL` wins over `apps/api/.env`: dotenv does not override an
  already-set `process.env` key unless asked to, and slice 01 only applies `override: true` to the
  named file, which is absent here. Confirm that by reading the refusal's host in the output.
- The credential is the throwaway literal `guard:guard` against a host that does not exist. It is
  typed at a shell, never written into a tracked file.

### P6 - the local path still works

With the local Postgres up and `apps/api/.env` untouched (it already points at `localhost:5006`):

```
pnpm --filter @fxl-sales/api db:migrate; echo "exit=$?"
```

Expect `exit=0`. This proves the guard refuses the remote host specifically, rather than refusing
everything. Do NOT run `make db-reset` as part of this - it drops the volume and chains `migrate`.

### P7 - nothing secret entered the tree

```
git status --porcelain
git diff --stat
```

Expect exactly two paths touched by this slice: `scripts/__tests__/local-database-guard.test.mjs`
(new) and `package.json` (one line). No `.env`, no `.env.staging`, no credential, no remote database
URL in any tracked file.

## Anticipated problems

1. **Slice 02 named the symbol differently.** Change `GUARD_SYMBOL` only, re-run P1, record in
   `AUDIT.md`. Every regex is built from that constant precisely so this is a one-line fix.
2. **Slice 02 wrapped the call in a helper** (say the entrypoint calls `bootGuards()` which calls
   `assertLocalDatabase`). Then `server.ts` no longer names the symbol and P1 goes red. That is a
   TRUE red: the invariant "the entrypoint invokes the guard" no longer holds as written. Stop,
   record it, and report - do not weaken the guard to match.
3. **`withoutCall` removes nothing** because the call spans lines (e.g. arguments on following
   lines). The `assert.notEqual` inside `withoutCall` catches this and the test fails loudly rather
   than passing vacuously. Fix by widening the mutation to also drop the continuation lines, or by
   asserting against a fixture whose call is written on one line - and say which was done.
4. **The child `node --test` inherits a stray `FXL_LOCAL_DB_GUARD_ROOT` from the developer's
   shell.** Then the parent itself would run in fixture mode and silently skip the four proofs. Guard
   against it by checking `env | grep FXL_LOCAL_DB_GUARD_ROOT` is empty before P1, and by the
   `pass 10` count in P1's oracle - a fixture-mode run reports 5.
5. **Windows path separators** in the `[SERVER_REL]` fixture keys. Not a concern: this repo is
   developed on darwin and CI is `ubuntu-latest`. `path.join` handles it regardless.

## Definition of done

- `scripts/__tests__/local-database-guard.test.mjs` exists, reads its two files at module scope, and
  reports `pass 10` / `fail 0` on the real tree.
- Root `package.json` `scripts.test` carries the new file in the explicit `node --test` list, exactly
  as quoted above.
- P1 through P7 all produced their expected exit codes, recorded in the run's `AUDIT.md` - including
  P5's non-zero refusal naming `db.example.invalid`.
- `apps/api/src/server.ts` and `apps/api/src/db/migrate.ts` are byte-identical to how slice 02 left
  them. `git diff` on both is empty.
- `scripts/no-legacy-auth.mjs` and `scripts/no-legacy-env-names.mjs` are untouched.
