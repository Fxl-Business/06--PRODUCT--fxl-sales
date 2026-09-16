# exec-02 working notes - slice `02-local-database-guard`

NOT COMMITTED, deliberately: a committed notes file rides the branch diff into the Verify agent's
context and breaks the isolation Gate 2 depends on.

## What landed

- `apps/api/src/db/local-database-guard.ts` (new) - pure module, imports NOTHING, never reads
  `process.env`. Exports `describeDatabaseTarget`, `isLocalDatabaseHost`, `assertLocalDatabase`.
  The two human-verbatim signatures are unchanged.
  Bracket-stripping for the WHATWG IPv6 serialization (`new URL(...).hostname` yields `'[::1]'`) is
  implemented and pinned by its own named test, not only inside the `it.each` loop.
- `apps/api/src/db/__tests__/local-database-guard.test.ts` (new) - 24 tests, connects to nothing,
  reads no environment variable, remote fixture is the RFC 6761 reserved `db.example.invalid`.
  The plan sketch's unused `LOCAL_URL` constant was DELETED per the correction block.
  `describeDatabaseTarget` is asserted with the correction block's two exact assertions.
- `apps/api/src/db/migrate.ts` - slice 01's existing `loadEnvFiles(...)` statement was DESTRUCTURED
  (`const { namedEnvFile } = loadEnvFiles(...)`), not deleted and not duplicated. `nodeEnv` and
  `url` are read AFTER it. Guard -> `DATABASE_URL is required` -> `[fxl-sales-migrate]` boot line ->
  `runDatabaseMigrations`.
- `apps/api/src/server.ts` - the existing `./env.js` import was WIDENED to
  `import { env, namedEnvFile } from './env.js'`. Guard + `[fxl-sales-api]` boot line are the first
  executable statements.

Both call sites keep the opening paren on the symbol's line
(`const databaseViolations = assertLocalDatabase({`), for slice 04's line-filter mutation.

## The one deviation from the plan sketch, and why

The plan placed the guard as the first statement of `server.ts`'s module body, below the full
static import list. That is NOT first: ESM evaluates the ENTIRE static import graph before the
first statement of the module body runs, and `./middleware/app-auth.js` loads the Hub configuration
at ITS module top level. Empirically, the first run of the server arm printed
`HubConfigError: FXL_HUB_CONFIG.environment must be ...` and NEVER the guard lines - the guard was
buried under an unrelated module-load failure, and any future module-scope database work in that
graph would have beaten it the same way.

Fix, inside the four permitted files: `server.ts` now imports ONLY `./env.js` and the guard module
statically - both pure with respect to the database - runs the guard, and then loads every other
module with `await import(...)`, in the original order with the original binding names. Top-level
await was already in use in this package (`migrate.ts`). No behaviour of the app changed; only the
moment at which the guard gets to speak.

The guard is still invoked at EXACTLY TWO call sites. Nothing was added to `env.ts`.

## Verification, all local

| check | result |
| --- | --- |
| `pnpm --filter @fxl-sales/api test` | 46 files / 478 tests pass; new file `src/db/__tests__/local-database-guard.test.ts` = 24 tests |
| `pnpm --filter @fxl-sales/api lint` | clean |
| `pnpm --filter @fxl-sales/api type-check` | clean |
| `pnpm --filter @fxl-sales/api build` | clean |
| `node scripts/no-legacy-auth.mjs` | clean |
| `node scripts/no-legacy-env-names.mjs` | clean |
| `pnpm --filter @fxl-sales/api db:migrate` (local) | `exit=0`, prints `[fxl-sales-migrate] database host=localhost port=5006`, `Done.` |
| `git status --porcelain` | no `.env`, no `.env.staging` |

### Refusal proof 1 - migrate arm

```
DATABASE_URL='postgresql://u:p@db.example.invalid:5432/fxl_sales' pnpm --filter @fxl-sales/api db:migrate; echo "exit=$?"
```

**exit=1.** Three `[local-database-guard]` lines, naming `db.example.invalid` and `make stg`.
No `Running migrations from ./drizzle`, so `runDatabaseMigrations` - the only `postgres()` call on
that path - was never reached.

### Refusal proof 2 - server arm

```
DATABASE_URL='postgresql://u:p@db.example.invalid:5432/fxl_sales' node apps/api/dist/server.js; echo "exit=$?"
```

**exit=1.** Output is the two dotenv notices and then ONLY the three `[local-database-guard]` lines.
The `HubConfigError` is NOT reached - that is the ordering oracle.

### Local server ordering check

`node apps/api/dist/server.js` with the local `.env` prints
`[fxl-sales-api] database host=localhost port=5006` and THEN fails with the pre-existing
`HubConfigError: FXL_HUB_CONFIG.environment must be ...`.

That HubConfigError is a PRE-EXISTING condition of this machine's untracked, stale `apps/api/.env`
against hub-sdk 2.3.0. It is not caused by this slice, `apps/api/.env` is off-limits to this run,
and it is not fixed here. The boot line printing BEFORE it is the proof this slice owed.

## Prohibitions observed

No connection to anything but `localhost:5006`. `fxl-db-server`, `tail89bca3.ts.net` and
`100.81.240.91` never appear in a command, a file or a diff. `SALES_ENV_FILE` is never SET anywhere;
the test passes `namedEnvFile` as a plain string argument. `apps/api/.env.staging` was never opened.
`make db-reset` was never run. No `.env` was edited. No process was left running.
