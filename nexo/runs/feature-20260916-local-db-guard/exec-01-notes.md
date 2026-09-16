# exec-01 notes - `01-env-file-resolution`

## What landed

Exactly the nine files the plan scoped, no others.

- `apps/api/src/config/env-files.ts` (new) - written verbatim from the plan's "Exact content to write".
- `apps/api/src/config/__tests__/fixtures/named-env-file.fixture` (new) - one line, `.fixture` extension.
- `apps/api/src/config/__tests__/env-files.test.ts` (new) - the plan's nine cases, with ONE deviation recorded below.
- `apps/api/src/env.ts` - top eleven lines replaced by the `loadEnvFiles` call; `import { config } from 'dotenv'` and `import { resolve } from 'node:path'` deleted; `namedEnvFile` exported. Nothing else touched.
- `apps/api/src/db/migrate.ts` - bare `import 'dotenv/config'` gone, `loadEnvFiles({ baseDir: API_ROOT_DIR, bag: process.env })` in its place, return value DISCARDED (slice 02 destructures it). `migrationsFolder: './drizzle'` unchanged.
- `apps/api/test/unit-setup.ts` - the ADDENDUM: `SALES_ENV_FILE` appended to the blanking loop with a comment saying why.
- `apps/api/.env.staging.example` (new) - shape only, every value blank. Verified by eye and by the commit diff: no host, no user, no password, no URL, no token.
- `apps/api/.env.example` / `.env.dev.example` - the COMMENT-ONLY block, identical text, inserted after `DATABASE_URL=` and after `ADMIN_DATABASE_URL=` respectively. No `SALES_ENV_FILE=` line anywhere.

## The one deviation from the plan's literal text, and why

The plan's test asserts `expect(log).not.toHaveBeenCalled()` in the no-named-file case and
`expect(log).toHaveBeenCalledTimes(1)` in the named case. Both went RED on first run, for a reason
the plan could not have known from reading the source: the installed **dotenv is v17**, which prints
its own banner line through `console.log` on every `config()` call -

```
◇ injected env (0) from src/config/__tests__/.env // tip: ⌘ custom filepath { path: '/custom/path/.env' }
```

So a raw call count grades dotenv's banner, not this module. That banner is PRE-EXISTING behaviour -
`env.ts` has always called `config()` twice and those lines already print on every boot (they are
visible in the unit-suite stdout for `app-auth.test.ts`) - so it is not something this slice
introduced and it is not this slice's to silence.

Fix taken: a small `envLines(log)` helper filters the spy's calls to those whose first argument
starts with `[env]`, and the two assertions became
`expect(envLines(log)).toEqual([])` and
`expect(envLines(log)).toEqual(['[env] named env file loaded: <path>'])`.

That is STRICTER than the plan's version on the named case (it pins the exact string AND that there
is exactly one such line, in one assertion) and equivalent on the empty case. The module itself was
NOT changed to suit the test - in particular no `quiet: true` was added to the `config()` calls,
because that would be a behaviour change to boot output that this slice was not commissioned for.
The four named oracle cases and the unreadable-file THROW are untouched by this.

## Verification, all green

- `pnpm --filter @fxl-sales/api test` - 45 files, 454 tests passed.
- `pnpm --filter @fxl-sales/api lint` - clean (the two deleted imports would have been errors).
- `pnpm --filter @fxl-sales/api type-check` - clean.
- `pnpm --filter @fxl-sales/api build` - clean; `apps/api/dist/config/env-files.js` exists and
  `dist/env.js` line 2 is `import { API_ROOT_DIR, loadEnvFiles } from './config/env-files.js';`.
- Depth maths proven in BOTH trees, not just asserted in a unit test:
  `node -e "import('./dist/config/env-files.js').then(m=>console.log(m.API_ROOT_DIR))"` prints
  `.../apps/api`.
- `pnpm run test` (root) - exit 0. shared-utils 80, api 454, web 784, plus `no-legacy-auth`,
  `no-legacy-env-names` (11 node:test subtests, 0 fail) and `build-contract: ok`.
- `grep -n dotenv apps/api/src/db/migrate.ts` - one hit, line 4, and it is the COMMENT explaining
  why the import is gone. No import.
- `pnpm --filter @fxl-sales/api db:migrate` - ran against the LOCAL database only. `apps/api/.env`
  was checked first and every `*DATABASE_URL` in it is `localhost:5006`. Printed
  `Running migrations from ./drizzle` ... `Done.` and NO `[env]` line, because no file was named.
  This is the only database command run in this slice.
- `git status --porcelain` - no `.env`, no `.env.staging`, no stray fixture.

## Prohibitions honoured

- No database other than local `localhost:5006` was contacted. `fxl-db-server` / the tailnet were
  never named in any command.
- `SALES_ENV_FILE` was never SET as an environment variable anywhere. It appears only as: the
  `NAMED_ENV_FILE_VAR` constant, `#`-comments in the three `.env.*.example` files, the
  `vi.stubEnv` blanking entry in `unit-setup.ts`, and as a key inside test bag OBJECT LITERALS
  passed as arguments.
- `apps/api/.env.staging` was never read, opened, copied or quoted. `apps/api/.env` was read only
  by `grep -n DATABASE_URL` with the credential masked in the output, purely to confirm it is local
  before running `db:migrate`; it was not edited.
- `scripts/no-legacy-env-names.mjs` untouched.
- No guard, assertion or throw added to `env.ts` beyond the single `loadEnvFiles` call.
- `make db-reset` / `make migrate` / `make back` not run.
