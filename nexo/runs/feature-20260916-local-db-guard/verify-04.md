# Verify 04 - structural guard

Branch under test: `feat/04-structural-guard` (base `master`).
Verifier: independent Gate-2 agent. Node v22.22.3, darwin.
`FXL_LOCAL_DB_GUARD_ROOT` confirmed UNSET in this shell before every real run.

## VERDICT: PASS

The guard is non-vacuous, and the implementer caught a real vacuity bug that the plan text did not
contain (the `NODE_TEST_*` strip in `runAgainst`). Without it every negative case would have gone
green while proving nothing; I reproduced that hazard directly - see D.

---

## Diff read

```
git diff master...feat/04-structural-guard -- . ':(exclude)nexo'
```

```
 package.json                                    |   2 +-
 scripts/__tests__/local-database-guard.test.mjs | 229 ++++++++++++++++++++++++
 2 files changed, 230 insertions(+), 1 deletion(-)
```

Exactly the two files the spec names. Nothing else.

---

## A. MODULE SCOPE

By reading the file: the two `readFileSync` calls sit in a bare module-scope `try { } catch { }`
block (lines ~70-80), outside every `test`/`after` callback and outside the
`if (!IS_FIXTURE_RUN)` block. The error is stored in `loadError`, and the FIRST registered
`test('both inspected files exist and are readable')` asserts `loadError === null`.

**Proven, via the injectable root, without touching any real file.** My own fixture `s4` contains
`migrate.ts` only - no `server.ts`:

```
FXL_LOCAL_DB_GUARD_ROOT=$T/s4 node --test scripts/__tests__/local-database-guard.test.mjs
```

```
exit=1   # tests 5 # pass 1 # fail 4
not ok 1 - both inspected files exist and are readable
not ok 2 - the inspected files are the real entrypoints, not empty or substituted
not ok 3 - apps/api/src/server.ts invokes assertLocalDatabase
not ok 4 - apps/api/src/db/migrate.ts invokes assertLocalDatabase
```

Exit code NON-ZERO **and** 5 tests actually ran (not a zero-test green). PASS.

---

## B. THE THREE REGRESSIONS - my own fixture tree

I built my own tmpdir tree (`mktemp -d`), copied the real sources, and mutated them with `grep -v`
/ a prepended line - I did not reuse the implementer's `makeFixture`/`withoutCall`. Each fixture was
run through the guard with `env -u NODE_TEST_CONTEXT FXL_LOCAL_DB_GUARD_ROOT=<dir> node --test ...`.
Graded by exit code only.

| Fixture | Mutation | exit | failing test |
| --- | --- | --- | --- |
| `s1` | `assertLocalDatabase({` line deleted from `server.ts` | **1** | `not ok 3 - apps/api/src/server.ts invokes assertLocalDatabase` |
| `s2` | `assertLocalDatabase({` line deleted from `migrate.ts` | **1** | `not ok 4 - apps/api/src/db/migrate.ts invokes assertLocalDatabase` |
| `s3` | `import 'dotenv/config';` prepended to `migrate.ts` | **1** | `not ok 5 - apps/api/src/db/migrate.ts has no raw dotenv/config import` |
| `s4` | `server.ts` absent (A above) | **1** | 4 failures |

All three named regressions exit NON-ZERO. PASS.

---

## C. THE POSITIVE CONTROL

Present in the test file as `test('an unmutated fixture passes (positive control)')`, asserting
`result.status === 0`.

Verified independently with my own byte-copy fixture `clean`:

```
=== clean: exit=0  # tests 5 # pass 5 # fail 0
```

So the guard is not simply reddening everything. PASS.

---

## D. THE RECURSION - the decisive check

Termination: a child has `FXL_LOCAL_DB_GUARD_ROOT` set, so `IS_FIXTURE_RUN` is true and the whole
`if (!IS_FIXTURE_RUN)` block - every `test` that spawns - is never registered. Observed directly:
every fixture run reports `# tests 5`, never 10. Depth is exactly 2; no grandchild can be spawned.

**The `NODE_TEST_CONTEXT` hazard is REAL on this machine, and the implementation handles it.**
The committed `runAgainst` deletes every `NODE_TEST_*` key from the child env - a line that is NOT
in the plan's quoted source. I proved both halves against the SAME broken fixture `s1`:

```
# HAZARD (what the plan's version would have done - inherit NODE_TEST_CONTEXT)
NODE_TEST_CONTEXT=child FXL_LOCAL_DB_GUARD_ROOT=$T/s1 node --test <guard>
exit=0
(node:47461) Warning: node:test run() is being called recursively within a test file. skipping running files.

# CONTROL (what the committed code does - NODE_TEST_* stripped)
env -u NODE_TEST_CONTEXT FXL_LOCAL_DB_GUARD_ROOT=$T/s1 node --test <guard>
exit=1
```

A broken tree exits **0 with zero tests** when the variable leaks, and **1** when it is stripped.
Had this not been handled, all four negative cases would have passed vacuously.

Direct vs. `pnpm run test` comparison (the other half of D):

- `node --test scripts/__tests__/local-database-guard.test.mjs` -> `# tests 10 # pass 10 # fail 0`,
  exit 0.
- Under `pnpm run test` the same 10 tests appear by name, `ok 1` .. `ok 10`, all passing.

Counts and verdicts are IDENTICAL between the two invocations. PASS.

---

## E. NON-VACUITY ANCHORS, against the file AS IT IS NOW

Slice 02 restructured `server.ts` into a static `./env.js` + guard import plus `await import(...)`
for everything else. The anchors still match the current file with non-zero counts:

```
server.ts  '@hono/node-server'   : 1      (inside `await import('@hono/node-server')`)
server.ts  'app.fetch'           : 1      (`serve({ fetch: app.fetch, port })`)
migrate.ts 'runDatabaseMigrations': 3
migrate.ts 'migrationsFolder'    : 1
server.ts  bytes: 7910   (floor: > 500)
migrate.ts bytes: 2350   (floor: > 200)
```

Size floors and identity anchors are asserted by
`test('the inspected files are the real entrypoints, not empty or substituted')`, which went RED in
fixture `s4` - so a truncation or a substitution cannot make the guard trivially green. PASS.

Also confirmed by reading: the `CALL` / `NAMED_IMPORT` matching runs on a comment-stripped copy, and
the whole-line-only `//` stripper is correct against `http://localhost:${port}` in `server.ts`.

---

## Required runs

### 1. The guard alone

```
node --test scripts/__tests__/local-database-guard.test.mjs; echo "exit=$?"
```

```
ok 1 - both inspected files exist and are readable
ok 2 - the inspected files are the real entrypoints, not empty or substituted
ok 3 - apps/api/src/server.ts invokes assertLocalDatabase
ok 4 - apps/api/src/db/migrate.ts invokes assertLocalDatabase
ok 5 - apps/api/src/db/migrate.ts has no raw dotenv/config import
ok 6 - an unmutated fixture passes (positive control)
ok 7 - FAILS when server.ts stops invoking the guard
ok 8 - FAILS when migrate.ts stops invoking the guard
ok 9 - FAILS when migrate.ts regains a raw dotenv/config import
ok 10 - FAILS when an inspected file is missing
# tests 10
# pass 10
# fail 0
exit=0
```

PASS COUNT = 10, matching the plan's `pass 10` oracle exactly.

### 2. `pnpm run test`

```
exit=0
...
1..21
# tests 21
# pass 21
# fail 0
build-contract: ok
```

Confirmed **by reading the output**, not by the exit code alone:

- the new file's 10 tests ran (`ok 1` .. `ok 10`, the names listed in run 1 above);
- `no-legacy-auth.test.mjs` still ran (`ok 11` .. `ok 13`);
- `no-legacy-env-names.test.mjs` still ran (`ok 14` .. `ok 21`);
- the three `node scripts/*.mjs` gates still ran, ending `build-contract: ok`.

### 3. lint / type-check

```
pnpm run lint       -> exit=0
pnpm run type-check -> exit=0
```

### 4. The feature's central acceptance criterion

Remote case:

```
DATABASE_URL='postgresql://u:p@db.example.invalid:5432/fxl_sales' pnpm --filter @fxl-sales/api db:migrate
```

```
[local-database-guard] DATABASE_URL points at the non-local host "db.example.invalid".
[local-database-guard] Only localhost, 127.0.0.1, ::1 and db run without an opt-in. Refusing to connect or migrate.
[local-database-guard] To target a remote environment on purpose, use the staging entrypoint: make stg
 ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  @fxl-sales/api@1.0.0 db:migrate: `tsx src/db/migrate.ts`
exit=1
```

NON-ZERO, and it names `db.example.invalid`.

Local case (`apps/api/.env` untouched; its `DATABASE_URL` host/port confirmed as
`host=localhost port=5006` without reading the credential):

```
pnpm --filter @fxl-sales/api db:migrate
...
Done.
exit=0
```

So the guard refuses the remote host specifically, not everything. `make db-reset` was NOT run.

---

## Properties F-J

**F.** `package.json` `scripts.test` gained exactly ` scripts/__tests__/local-database-guard.test.mjs`
after `no-legacy-env-names.test.mjs` and before ` && node scripts/no-legacy-auth.mjs`. The rest of
the chain - `build:packages`, `pnpm -r --if-present test`, the three `node scripts/*.mjs` gates - is
byte-identical and in the same order. No other key in `package.json` changed. PASS.

**G.** `git diff master...feat/04-structural-guard --stat -- scripts/no-legacy-env-names.mjs scripts/no-legacy-auth.mjs`
is EMPTY. `grep -n "SALES_ENV_FILE" scripts/no-legacy-env-names.mjs` exits 1 (no match) - it was not
added to the retired-names list. PASS.

**H.** `git diff master...feat/04-structural-guard -- apps/api/src/server.ts apps/api/src/db/migrate.ts`
is EMPTY. The guard never needed to damage the files it inspects. PASS.

**I.** The slice diff contains no `fxl-db-server`, no `tail89bca3.ts.net`, no `100.81.240.91`, and no
`SALES_ENV_FILE` - including in comments. `git grep -n -E '^[[:space:]]*SALES_ENV_FILE='` finds only
`Makefile:56` (landed by slice 03) and plan/run prose under `nexo/`; nothing from this slice. PASS.

**J.** `git status --porcelain` is byte-identical to the session-start snapshot: only modified/
untracked files under `nexo/runs/...` plus the pre-existing `.vscode/`. No `.env`, no `.env.staging`,
no leftover fixtures. PASS.

---

## Verifier hygiene

- No real source file was modified at any point. Every negative case used the injectable root against
  my own tmpdir copies. `git status` confirmed clean afterwards (see J).
- Every tmpdir I created was removed; `ls -d $TMPDIR/local-db-guard-*` and `/tmp/claude-501/verify04-*`
  both report NONE, so the guard's own `after()` cleanup also works.
- Only the local Postgres (`localhost:5006`, container `06--product--fxl-sales-db-1`) was contacted.
  `apps/api/.env.staging` was never opened; `SALES_ENV_FILE` was never set; no tailnet host was used.
  No long-running process was started.

## Findings (non-blocking)

1. The committed `runAgainst` deviates from the plan's quoted source by stripping `NODE_TEST_*` from
   the child env. This is a CORRECTION, not a defect - I proved the plan's version would have made
   all four negative cases vacuously green. Worth recording in `AUDIT.md` as a plan deviation.
2. `server.ts`'s anchors `@hono/node-server` and `app.fetch` each occur exactly once, so a future
   refactor of the boot sequence will redden the identity test. That is the intended behaviour, but
   it is a single point of contact worth knowing about.
