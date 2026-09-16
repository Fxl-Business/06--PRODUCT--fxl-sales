# exec-04 - structural-guard

Branch: `feat/04-structural-guard`. Files touched, and no others:

- `scripts/__tests__/local-database-guard.test.mjs` (new)
- `package.json` (one line: `scripts.test`)

`apps/api/src/server.ts` and `apps/api/src/db/migrate.ts` were never written to; they do not appear
in `git status --porcelain`.

## Preconditions confirmed against the LANDED code

Read both files directly rather than trusting the plan's pre-slice-02 assumption.

- `GUARD_SYMBOL` is spelled `assertLocalDatabase` in both entrypoints. No deviation, no change to
  the constant.
- Both files carry a NAMED import - `import { assertLocalDatabase, describeDatabaseTarget } from
  './db/local-database-guard.js';` in `server.ts` and `from './local-database-guard.js';` in
  `migrate.ts` - and a one-line-opening call `assertLocalDatabase({`. No namespace import, so the
  plan's STOP condition did not fire.
- `migrate.ts` carries no `import 'dotenv/config'`; it loads through `loadEnvFiles` from
  `../config/env-files.js`. Slice 01 landed.

Identity anchors, all non-zero on the CURRENT (slice-02 restructured) files, so none had to be
substituted:

| anchor | file | count |
| --- | --- | --- |
| `@hono/node-server` | `server.ts` | 1 (now inside `await import(...)`) |
| `app.fetch` | `server.ts` | 1 |
| `runDatabaseMigrations` | `migrate.ts` | 3 |
| `migrationsFolder` | `migrate.ts` | 1 |

Sizes: `server.ts` 7910 bytes, `migrate.ts` 2350 bytes - both clear of the 500/200 floors.

Slice 02 restructured `server.ts` so that only `./env.js` and the guard are static imports and
everything else is `await import(...)`. That does NOT weaken the two anchors: `@hono/node-server`
and `app.fetch` are both still present, they simply moved. No anchor substitution was needed and
none was made.

## ONE deviation from the plan's transcribed source, and why

The plan's `runAgainst` spawns the child with `env: { ...process.env, [FIXTURE_ROOT_VAR]: dir }`.
Transcribed verbatim, the file went RED: 6 pass / 4 fail, with ALL FOUR mutation cases reporting a
child exit status of `0`.

Cause, diagnosed with a scratch probe rather than guessed: `node --test` runs each test FILE in a
child process carrying `NODE_TEST_CONTEXT=child-v8`. Spreading `process.env` handed that variable to
the grandchild, which then believed it was already inside a runner, emitted

```
Warning: node:test run() is being called recursively within a test file. skipping running files.
```

executed ZERO tests, produced empty stdout and exited `0`.

That is exactly the vacuity class this file exists to prevent, arriving through the harness instead
of through the sources. Fix, confined to `runAgainst` and documented in a comment there: build the
child env, then delete every key beginning `NODE_TEST_`. Nothing else in the plan's source changed.

Worth recording: the POSITIVE CONTROL did not catch this - a vacuous child exits `0`, which is what
that test asserts. The four negative cases caught it. That is the non-vacuity argument working in
the direction the plan predicted, from the other side.

## Verification - real exit codes

| check | command | result |
| --- | --- | --- |
| P1 | `node --test scripts/__tests__/local-database-guard.test.mjs` | `exit=0`, **`# tests 10 / # pass 10 / # fail 0`** - the plan's `pass 10` oracle, so not a fixture-mode run |
| P2 | see the independent fixture probe below | all four negatives non-zero |
| P3 | `pnpm run test` | `exit=0`; the `node --test` line now carries the new file, and all 10 of its tests are visible in the output (`ok 1` .. `ok 10`) alongside the siblings' 11, `# pass 21 / # fail 0` |
| P4 | `pnpm run lint` / `pnpm run type-check` | `exit=0` / `exit=0` |
| P5 | `DATABASE_URL='postgresql://u:p@db.example.invalid:5432/fxl_sales' pnpm --filter @fxl-sales/api db:migrate` | **`exit=1`**, stderr names `db.example.invalid` |
| P6 | `pnpm --filter @fxl-sales/api db:migrate` (untouched `.env`, local Postgres) | `exit=0`, `Done.` |
| P7 | `git status --porcelain` | no `.env`, no `.env.staging`, no credential; only the two intended paths |
| - | `npx prettier --check` on the new file | `All matched files use Prettier code style!` |

P5 output, verbatim, for the record:

```
[local-database-guard] DATABASE_URL points at the non-local host "db.example.invalid".
[local-database-guard] Only localhost, 127.0.0.1, ::1 and db run without an opt-in. Refusing to connect or migrate.
[local-database-guard] To target a remote environment on purpose, use the staging entrypoint: make stg
```

The exit code is the verdict; the text above is context. P6's `exit=0` is what proves the guard
refuses the remote host SPECIFICALLY rather than refusing everything.

### Independent non-vacuity probe

The four negatives are asserted inside the test file itself, but they were ALSO reproduced from an
out-of-band scratch script (in the session scratchpad, not committed) that builds the same fixtures
and prints raw exit codes, so the numbers below are observed rather than inferred from a green test:

```
positive-control (unmutated)        exit = 0
server.ts call removed              exit = 1
migrate.ts call removed             exit = 1
migrate.ts raw dotenv/config back   exit = 1
server.ts missing entirely          exit = 1
cut() changed server.ts? true   migrate.ts? true
```

The last line is the `withoutCall` `assert.notEqual` precondition: the mutation really does remove
text from both files, so neither negative passes for the wrong reason. The plan's anticipated
problem 3 (a call spanning lines defeating the line filter) did not occur - both calls open on one
line, `assertLocalDatabase({`.

Environment check before P1: `env | grep FXL_LOCAL_DB_GUARD_ROOT` was empty, so the parent ran in
real mode (confirmed independently by the `pass 10` count; a fixture-mode parent reports 5).

## Prohibitions honoured

- `scripts/no-legacy-env-names.mjs` not opened, not edited; `SALES_ENV_FILE` appears nowhere in
  anything this slice wrote and was never set in any command.
- `fxl-db-server`, `tail89bca3.ts.net` and `100.81.240.91` appear in no file, command or comment.
  The only remote-looking host used anywhere is `db.example.invalid`.
- Only the local Postgres (`localhost:5006`) was contacted, by P6. The test file opens no socket.
- `apps/api/.env.staging` was never opened; `apps/api/.env` and `apps/web/.env` never edited.
- `make db-reset` not run.
- The real `server.ts` and `migrate.ts` were never damaged to prove a negative - every negative used
  a tmpdir fixture tree, removed in `after()`.
