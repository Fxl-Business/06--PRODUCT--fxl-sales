---
id: 01-env-file-resolution
milestone: v4.1.0
status: todo
depends_on: []
files_modified:
  - apps/api/src/config/env-files.ts
  - apps/api/src/config/__tests__/env-files.test.ts
  - apps/api/src/config/__tests__/fixtures/named-env-file.fixture
  - apps/api/src/env.ts
  - apps/api/src/db/migrate.ts
  - apps/api/.env.staging.example
  - apps/api/.env.example
  - apps/api/.env.dev.example
  - apps/api/test/unit-setup.ts
acceptance: "given SALES_ENV_FILE is passed in an env bag to the shared resolver, when the value is absent it resolves to null, when it is relative it resolves against apps/api, when it is absolute it passes through unchanged, and when the resolved file cannot be read loadEnvFiles THROWS quoting that path instead of falling back to the default environment - and both apps/api/src/env.ts and apps/api/src/db/migrate.ts reach the environment through that one module, migrate.ts no longer carrying a bare `import 'dotenv/config'`."
goal: One shared env-file resolver for apps/api that both entrypoints consume, adding a named SALES_ENV_FILE opt-in that loads LAST with override and refuses loudly when unreadable.
must_not_break:
  - "`pnpm --filter @fxl-sales/api type-check` and `lint` stay green (eslint no-unused-vars is an ERROR here: the `config` and `resolve` imports in env.ts become unused and MUST be deleted)."
  - "`pnpm --filter @fxl-sales/api test` stays green, in particular `src/config/__tests__/env-example-contract.test.ts` (its vacuity guard, its `hubConfigIsAbsent` assertions and its `documentedIdentity` comment regex)."
  - "`pnpm --filter @fxl-sales/api db:migrate` keeps working against the LOCAL database with no SALES_ENV_FILE set, with cwd = apps/api and `migrationsFolder: './drizzle'` untouched."
  - "`apps/api/src/env.ts` keeps loading `.env` then `.env.local` with override, resolved relative to `apps/api`, identically from `src/env.ts` and from `dist/env.js`."
  - "`pnpm --filter @fxl-sales/api build` (`tsc && tsc-alias`): the new module's runtime path maths must give the same answer from `dist/config/env-files.js` as from `src/config/env-files.ts`."
  - "`node scripts/no-legacy-env-names.mjs` and `node scripts/no-legacy-auth.mjs` stay green."
  - "`apps/api/test/rls/setup-env.ts` and `global-setup.ts` keep their own `import 'dotenv/config'` - the integration suite is NOT in this slice's scope."
rules:
  - "NEVER set SALES_ENV_FILE as an environment variable in any command, script, Makefile, test or committed file. It is typed by a human, once, in front of a command. The tests pass it IN as an explicit bag."
  - "NEVER read, open, copy, move or quote apps/api/.env.staging. It holds a live credential. Its existence is all you may know."
  - "apps/api/.env.staging.example carries SHAPE ONLY: no host, no user, no password, no real URL, no token."
  - "NO guard logic, NO assertion and NO throw-on-environment in env.ts's body beyond the resolver call described here. Slice 02 owns the database guard and invokes it from entrypoints only."
  - "SALES_ENV_FILE must NOT be added to scripts/no-legacy-env-names.mjs. It is a NEW name, not a retired one."
  - "The resolver reads NOTHING from process.env itself. baseDir and bag are both required parameters."
  - "Do not edit apps/api/.env or apps/web/.env. Do not run `make db-reset`. Do not connect to any database in this slice - nothing here needs one."
verifier_focus: "That migrate.ts has no bare `import 'dotenv/config'` left and that the four named resolution cases plus the unreadable-file THROW are real assertions in src/config/__tests__/env-files.test.ts, driven through the exported functions with an injected bag and never through the ambient environment."
---


> # ADDENDUM - AUTHORITATIVE, from the plan-check. One extra file, one extra line.
>
> `loadEnvFiles` throws when `SALES_ENV_FILE` names an unreadable path, and you are calling it at
> `env.ts` MODULE SCOPE. `env.ts` is transitively imported by much of the unit suite (through
> `config/auth-provider.ts`, `middleware/app-auth.ts`, `db/client.ts` and others). So a developer
> who happens to have `SALES_ENV_FILE` exported in their shell would have `pnpm test` either throw
> at module load, or silently load staging values on top of the suite's blanking.
>
> That is the same class of ambient-environment leak `apps/api/test/unit-setup.ts` already exists to
> close for the six Hub credential names, and it is closed the same way. Add `SALES_ENV_FILE` to
> that file's blanking loop, with a short comment saying why - the suite must be decided by its own
> fixtures and never by the operator's shell. `vi.stubEnv` runs in a setup file, which vitest
> evaluates BEFORE the test module and therefore before `env.ts` is ever imported, so a blank there
> really does reach the resolver; and blank reads as absent, because `resolveNamedEnvFilePath` maps
> an empty string to `null`.
>
> This does NOT weaken the opt-in: it scopes it out of the TEST process only. `make back`,
> `make migrate` and `make back-stg` are unaffected.
>
> Everything else in this plan stands as written, including the COMMENT-ONLY documentation choice
> for the two `.env` examples, which the plan-check re-derived independently against all six
> mechanisms of `env-example-contract.test.ts` and confirmed green.

# Slice 01 - `env-file-resolution`

## Why this slice exists (one paragraph, so the executor does not re-derive it)

`apps/api/src/env.ts` loads `.env` then `.env.local`. `apps/api/src/db/migrate.ts` does
`import 'dotenv/config'`, which loads `.env` from the **cwd** and nothing else - it bypasses
`.env.local`, bypasses the `baseDir` computation and bypasses the zod schema entirely. Two
loaders, two behaviours, and the one that applies DDL is the dumber of the two. This slice
collapses them into one module and, in the same stroke, adds the only escape hatch the feature
will have: a file named BY THE OPERATOR, loaded last, with override. Slice 02 then refuses a
remote `DATABASE_URL` unless that named file is what put it there - which is why this slice must
hand slice 02 a `namedEnvFile` value, and why an unreadable named file must THROW rather than
degrade into the default environment.

---

## 1. The new module

### Path: `apps/api/src/config/env-files.ts`

**The one way to get this slice wrong, answered up front.**

`env.ts` computes `const baseDir = resolve(import.meta.dirname, '..')` and its comment says the
path must resolve identically from `src/env.ts` and from `dist/env.js`, because both sit exactly
one directory below `apps/api`. Moving the computation into `src/config/env-files.ts` changes the
depth to **two**: `apps/api/src/config/env-files.ts` and `apps/api/dist/config/env-files.js` are
each exactly two directories below `apps/api`. The correct expression in the new module is
therefore `resolve(import.meta.dirname, '../..')`, and it is correct in BOTH trees for a checkable
reason: `apps/api/tsconfig.json` sets `"rootDir": "./src"` and `"outDir": "./dist"`, so `dist/`
mirrors `src/` directory-for-directory. `tsc-alias` only rewrites `@/*` path-alias specifiers in
emitted imports; it does not touch a runtime `import.meta.dirname` computation, so it is not a
factor. Do not copy `'..'` across from `env.ts`. Do not let `env.ts` keep its own `baseDir`
either - after this slice there is exactly ONE place in the repo that knows how far the running
file sits from `apps/api`, and it is `API_ROOT_DIR` below.

**Exact content to write** (comments are part of the deliverable; this repo documents the *why*
in the file):

```ts
import { accessSync, constants } from 'node:fs';
import { resolve } from 'node:path';
import { config } from 'dotenv';

/**
 * The ONE env-file loader for apps/api, and the reason there is only one.
 *
 * `src/env.ts` loaded `.env` then `.env.local`; `src/db/migrate.ts` did a bare
 * `import 'dotenv/config'`, which reads `.env` from the CWD, ignores
 * `.env.local` and never sees this module's ordering at all. Two loaders is how
 * the entrypoint that applies DDL ended up with the weaker one. Both entrypoints
 * now come through here, so the two cannot diverge again.
 *
 * NOTHING in this module reads `process.env`. `baseDir` and `bag` are both
 * required parameters, which is what lets the unit test drive every branch by
 * passing values IN rather than by mutating the ambient environment - and
 * SALES_ENV_FILE is a name that must never be set by anything but a human
 * typing it in front of a command.
 */

/**
 * `apps/api`, resolved identically in dev and in prod.
 *
 * `../..` and not `../`: this file is `src/config/env-files.ts` in dev and
 * `dist/config/env-files.js` in prod, and `tsconfig.json`'s rootDir `./src` /
 * outDir `./dist` make `dist/` mirror `src/` directory-for-directory, so BOTH
 * sit exactly two directories below `apps/api`. `env.ts` used to compute this
 * itself with `..` from one level up; it no longer does, so this constant is the
 * single place in the tree that knows the depth.
 */
export const API_ROOT_DIR = resolve(import.meta.dirname, '../..');

/**
 * The operator's opt-in. Mirrors the Hub's `HUB_ENV_FILE`; one name per
 * repository, no alias.
 */
export const NAMED_ENV_FILE_VAR = 'SALES_ENV_FILE';

/** An injectable environment bag. `process.env` satisfies it. */
export type EnvBag = Record<string, string | undefined>;

export interface LoadEnvFilesOptions {
  /** Directory the `.env*` names resolve against. Pass `API_ROOT_DIR`. */
  baseDir: string;
  /** Where `SALES_ENV_FILE` is read FROM. Never `process.env` implicitly. */
  bag: EnvBag;
}

export interface LoadedEnvFiles {
  /**
   * The ABSOLUTE path of the file loaded by name, or null when
   * `SALES_ENV_FILE` was unset or empty.
   *
   * Slice 02's database guard consumes exactly this: a remote DATABASE_URL is
   * admissible only when a named file is what put it there.
   */
  namedEnvFile: string | null;
}

/**
 * Pure path resolution, no I/O. Absent or blank is null; a RELATIVE value
 * resolves against `baseDir`; an ABSOLUTE value passes through unchanged
 * (`resolve` already has both semantics, which is why there is no `isAbsolute`
 * branch here).
 */
export function resolveNamedEnvFilePath(bag: EnvBag, baseDir: string): string | null {
  const raw = bag[NAMED_ENV_FILE_VAR]?.trim();
  if (raw === undefined || raw === '') return null;
  return resolve(baseDir, raw);
}

/**
 * Loads `.env`, then `.env.local` with override, then - only when the operator
 * named one - that file LAST, with override, so it wins over both.
 *
 * READABILITY IS CHECKED BEFORE ANYTHING IS LOADED, deliberately. The refusal
 * has to happen with `process.env` untouched: a half-loaded default environment
 * plus a crash is worse to reason about than a crash, and the whole point of
 * this throw is that an operator who asked for another environment must never be
 * quietly handed the LOCAL one.
 */
export function loadEnvFiles({ baseDir, bag }: LoadEnvFilesOptions): LoadedEnvFiles {
  const namedEnvFile = resolveNamedEnvFilePath(bag, baseDir);

  if (namedEnvFile !== null) assertReadable(namedEnvFile);

  config({ path: resolve(baseDir, '.env') });
  config({ path: resolve(baseDir, '.env.local'), override: true });

  if (namedEnvFile === null) return { namedEnvFile: null };

  const result = config({ path: namedEnvFile, override: true });
  if (result.error) throw namedEnvFileRefusal(namedEnvFile);

  // ONE line, naming the file and nothing else. Never its contents: the file
  // this exists for holds a live credential.
  console.log(`[env] named env file loaded: ${namedEnvFile}`);

  return { namedEnvFile };
}

function assertReadable(path: string): void {
  try {
    accessSync(path, constants.R_OK);
  } catch {
    throw namedEnvFileRefusal(path);
  }
}

function namedEnvFileRefusal(path: string): Error {
  return new Error(
    `${NAMED_ENV_FILE_VAR} names ${path}, which cannot be read. ` +
      'Refusing to continue, deliberately: falling back to the default environment would run ' +
      'against the LOCAL database while you believe you asked for another one. ' +
      `Create the file, fix the path, or unset ${NAMED_ENV_FILE_VAR}.`,
  );
}
```

Notes the executor must not "improve":

- `resolveNamedEnvFilePath(bag, baseDir)` takes the bag FIRST. Keep that order; the test calls it
  positionally and slice 02 does not call it at all.
- No `default` parameter values anywhere. A default of `process.env` would reintroduce exactly the
  ambient read this design exists to prevent.
- `console.log`, not a logger. `migrate.ts` already prints with `console.log` and this line must
  appear on the same stream, before anything connects.
- The message string above is the EXACT wording. Slice 02's acceptance is proven by exit code and
  not by message text, but the executor should still not paraphrase this.

---

## 2. `apps/api/src/env.ts`

### The code being replaced, verbatim (lines 1-11 today)

```ts
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { z } from 'zod';

// Load apps/api/.env first (committed dev defaults from .env.dev.example),
// then apps/api/.env.local on top (gitignored per-dev override). Path
// resolves identically in dev (src/env.ts) and prod (dist/env.js) - both
// sit one dir below apps/api.
const baseDir = resolve(import.meta.dirname, '..');
config({ path: resolve(baseDir, '.env') });
config({ path: resolve(baseDir, '.env.local'), override: true });
```

### Replace it with exactly

```ts
import { z } from 'zod';
import { API_ROOT_DIR, loadEnvFiles } from './config/env-files.js';

// Load apps/api/.env first (committed dev defaults from .env.dev.example),
// then apps/api/.env.local on top (gitignored per-dev override), then - only
// when the operator named one - SALES_ENV_FILE last, with override.
//
// The ordering, the path maths and the refusal when a named file cannot be read
// all live in config/env-files.ts, because src/db/migrate.ts has to reach the
// SAME environment and used to reach a different one through a bare
// `import 'dotenv/config'`.
export const { namedEnvFile } = loadEnvFiles({ baseDir: API_ROOT_DIR, bag: process.env });
```

Hard points:

- **Delete** `import { config } from 'dotenv';` and `import { resolve } from 'node:path';`.
  Neither is used afterwards and `@typescript-eslint/no-unused-vars` is configured as an **error**
  in `apps/api/eslint.config.js`, so leaving them fails `pnpm lint`.
- `namedEnvFile` is EXPORTED (`export const { namedEnvFile } = ...`). That is what slice 02's
  `server.ts` call site will read, and exporting it also keeps lint quiet about an unused binding.
- This is the ONLY change to `env.ts` in this slice. The zod schema, `emptyToUndefined`, the
  `safeParse`, the `process.exit(1)` branch and the `env` / `Env` exports are untouched. **Add no
  `SALES_ENV_FILE` key to the schema** - it is an operator input read before the schema exists,
  not validated configuration, and adding it would invite someone to read it back off `env`.

### Is the THROW swallowed by env.ts's `process.exit(1)`?

No, and it cannot be. Checked rather than assumed:

1. The `process.exit(1)` in `env.ts` is reached only *after* `schema.safeParse(process.env)`
   returns `success: false`. `loadEnvFiles` runs strictly **before** that line, at module scope,
   and a throw there aborts module evaluation - `safeParse` never runs, so the exit branch is
   unreachable.
2. There is no `try` anywhere in `env.ts`, and nothing dynamic-imports it. Every importer is a
   static `import { env } from '.../env.js'`:
   `src/server.ts:4`, `src/middleware/app-auth.ts:12`, `src/middleware/cors.ts:2`,
   `src/domains/links/routes.ts:3`, `src/db/client.ts:3`, `src/routes/health.ts:2`, plus a
   `import type` in `src/config/auth-provider.ts:36` which emits nothing. A throw during ESM module
   evaluation with no handler is an uncaught exception: Node prints the stack and exits non-zero.
3. Do **not** wrap the `loadEnvFiles` call in a try/catch to "improve" the message. The message is
   already the whole explanation, and catching it is how it would end up as a silent fallback.

---

## 3. `apps/api/src/db/migrate.ts`

### The file today, verbatim and complete

```ts
import 'dotenv/config';
import { runDatabaseMigrations } from './migration-runner.js';

// Migrations run with the standard FXL project DATABASE_URL created by
// create-db.sh. Cluster roles are provisioned outside application migrations.
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

console.log('Running migrations from ./drizzle');
await runDatabaseMigrations({ databaseUrl: url, migrationsFolder: './drizzle' });
console.log('Done.');
```

### The file after this slice, verbatim and complete

```ts
import { API_ROOT_DIR, loadEnvFiles } from '../config/env-files.js';
import { runDatabaseMigrations } from './migration-runner.js';

// NOT `import 'dotenv/config'`. That read `.env` from the CWD, never saw
// `.env.local`, and never saw a named SALES_ENV_FILE - so the one entrypoint
// that applies DDL reached a DIFFERENT environment from the API it migrates
// for. This is the same loader `src/env.ts` uses, and that is the point.
loadEnvFiles({ baseDir: API_ROOT_DIR, bag: process.env });

// Migrations run with the standard FXL project DATABASE_URL created by
// create-db.sh. Cluster roles are provisioned outside application migrations.
const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

console.log('Running migrations from ./drizzle');
await runDatabaseMigrations({ databaseUrl: url, migrationsFolder: './drizzle' });
console.log('Done.');
```

Hard points:

- The return value is **discarded** in this slice. Do not write
  `const { namedEnvFile } = loadEnvFiles(...)` here yet: nothing reads it until slice 02 and
  `@typescript-eslint/no-unused-vars` is an error. Slice 02 destructures it when it adds the guard
  call.
- `migrationsFolder: './drizzle'` stays a **cwd-relative** string, unchanged.
  `db:migrate` is `tsx src/db/migrate.ts` run by pnpm with cwd = `apps/api`, so `./drizzle` and
  `API_ROOT_DIR` happen to agree today - but they agree for different reasons and this slice
  changes neither. Do not "unify" them.
- `migrate.ts` still reads `process.env.DATABASE_URL` raw and still does not import `env.ts`.
  Correct, and out of scope: importing `env.ts` would drag the whole zod schema and its
  `process.exit(1)` into the migration path.
- Leave `apps/api/drizzle.config.ts`, `apps/api/test/rls/setup-env.ts` and
  `apps/api/test/rls/global-setup.ts` alone. They also carry `import 'dotenv/config'`; they are
  not entrypoints this feature covers, and `setup-env.ts` deliberately hard-overrides
  `DATABASE_URL` at the local test database.

---

## 4. The test - the named oracle of this slice

### Path: `apps/api/src/config/__tests__/env-files.test.ts`

It must live under `src/**/__tests__/` because `apps/api/vitest.config.ts`'s unit project includes
exactly `['src/**/__tests__/**/*.test.ts']`.

### Fixture: `apps/api/src/config/__tests__/fixtures/named-env-file.fixture`

One line, and the extension is deliberate:

```
SALES_ENV_FILE_FIXTURE_MARKER=loaded
```

Named `.fixture` and **not** `.env` / `named.env`, because the repo `.gitignore` carries `.env`,
`.env.local`, `.env.*.local`, `.env.test` and `**/.env.test`; a fixture that a glob quietly
untracks would make the test pass locally and fail on a fresh clone. `dotenv` reads any filename,
so the extension costs nothing. It holds no credential and no URL.

### Exact content

```ts
/**
 * The resolution oracle for SALES_ENV_FILE.
 *
 * Every case here passes the bag IN. Nothing in this file writes
 * SALES_ENV_FILE into `process.env`, not even via `vi.stubEnv`: the name is an
 * operator opt-in typed once in front of a command, and a test that exported it
 * would be the first place it leaked.
 *
 * `baseDir` is this very directory in the cases that touch the disk, so the
 * `.env` / `.env.local` reads inside `loadEnvFiles` are guaranteed no-ops and
 * the test can never inherit `apps/api/.env`.
 */
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  API_ROOT_DIR,
  loadEnvFiles,
  resolveNamedEnvFilePath,
} from '../env-files.js';

const HERE = import.meta.dirname;

afterEach(() => {
  delete process.env.SALES_ENV_FILE_FIXTURE_MARKER;
  vi.restoreAllMocks();
});

describe('resolveNamedEnvFilePath', () => {
  it('returns null when the named env file variable is absent from the bag', () => {
    expect(resolveNamedEnvFilePath({}, HERE)).toBeNull();
  });

  it('returns null when the named env file variable is present but empty', () => {
    expect(resolveNamedEnvFilePath({ SALES_ENV_FILE: '' }, HERE)).toBeNull();
    expect(resolveNamedEnvFilePath({ SALES_ENV_FILE: '   ' }, HERE)).toBeNull();
  });

  it('resolves a RELATIVE value against baseDir', () => {
    expect(resolveNamedEnvFilePath({ SALES_ENV_FILE: '.env.staging' }, '/srv/apps/api')).toBe(
      '/srv/apps/api/.env.staging',
    );
  });

  it('passes an ABSOLUTE value through unchanged', () => {
    expect(
      resolveNamedEnvFilePath({ SALES_ENV_FILE: '/etc/fxl/sales.env' }, '/srv/apps/api'),
    ).toBe('/etc/fxl/sales.env');
  });

  it('points at apps/api when handed API_ROOT_DIR, in this tree and in dist', () => {
    // The depth check. `src/config/env-files.ts` and `dist/config/env-files.js`
    // are both two directories below apps/api, so `../..` is the only correct
    // expression - and copying env.ts's `..` across would silently resolve to
    // apps/api/src.
    expect(API_ROOT_DIR).toBe(resolve(HERE, '../../..'));
  });
});

describe('loadEnvFiles', () => {
  it('THROWS, naming the resolved path, when the named file cannot be read', () => {
    const missing = resolve(HERE, 'fixtures/there-is-no-such-file.fixture');

    expect(() =>
      loadEnvFiles({
        baseDir: HERE,
        bag: { SALES_ENV_FILE: 'fixtures/there-is-no-such-file.fixture' },
      }),
    ).toThrow(missing);
  });

  it('never falls back to the default environment when the named file is unreadable', () => {
    // The property the throw exists for, stated as behaviour. A fallback here is
    // an operator who asked for staging and got the LOCAL database with nothing
    // on screen saying so.
    expect(() =>
      loadEnvFiles({ baseDir: HERE, bag: { SALES_ENV_FILE: 'fixtures/nope.fixture' } }),
    ).toThrow(/deliberately/i);
  });

  it('returns a null namedEnvFile and prints nothing when no file was named', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    expect(loadEnvFiles({ baseDir: HERE, bag: {} })).toEqual({ namedEnvFile: null });
    expect(log).not.toHaveBeenCalled();
  });

  it('loads the named file LAST and prints ONE line naming it', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const named = resolve(HERE, 'fixtures/named-env-file.fixture');

    const result = loadEnvFiles({
      baseDir: HERE,
      bag: { SALES_ENV_FILE: 'fixtures/named-env-file.fixture' },
    });

    expect(result.namedEnvFile).toBe(named);
    expect(process.env.SALES_ENV_FILE_FIXTURE_MARKER).toBe('loaded');
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(`[env] named env file loaded: ${named}`);
  });
});
```

The four cases the slice was commissioned for are, by name:
`returns null when the named env file variable is absent from the bag`,
`resolves a RELATIVE value against baseDir`,
`passes an ABSOLUTE value through unchanged`,
`THROWS, naming the resolved path, when the named file cannot be read`.
The other four are the vacuity/behaviour companions and are not optional either.

**Do not** write a test that points `SALES_ENV_FILE` at `API_ROOT_DIR` and loads the real
`apps/api/.env` or `.env.example`: that pulls the developer's actual environment into the unit
worker and fights `apps/api/test/unit-setup.ts`, which blanks the six Hub credential names on
purpose.

---

## 5. `apps/api/.env.staging.example` (new, SHAPE ONLY)

The repo `.gitignore` already anticipates this file (`# Real staging credentials. .env.staging is
loaded BY NAME (see make stg) ... The committed shape lives in .env.staging.example instead.`), so
no `.gitignore` change is needed. `.env.staging.example` is **not** matched by any ignore pattern
and will be tracked.

Write exactly this. Every value is blank on purpose.

```
# apps/api/.env.staging.example
#
# SHAPE ONLY. Every value below is intentionally BLANK and this file must stay
# that way: no host, no user, no password, no URL, no token, ever.
#
# The real file, apps/api/.env.staging, is gitignored, holds a LIVE staging
# credential, and is never committed, never copied into .env and never quoted.
#
# THIS FILE IS NOT A DEFAULT ENVIRONMENT. Nothing loads it unless an operator
# names it, in front of one command, at the moment they mean it:
#
#   SALES_ENV_FILE=.env.staging pnpm --filter @fxl-sales/api <script>
#
# It is then loaded LAST, with override, on top of .env and .env.local, and the
# process prints one line naming the file it loaded. A named file that cannot be
# READ is a hard refusal, not a fallback: falling back would run against the
# LOCAL database while you believe you asked for staging, which is the 2026-09-16
# incident this file exists because of.
#
# NEVER export SALES_ENV_FILE from a shell profile, a Makefile default, a CI job
# or a committed script. The whole value of the name is that it is typed by a
# human who means it. One name per repository, mirroring the Hub's HUB_ENV_FILE.

# --- Server ---
NODE_ENV=production
PORT=3006
CORS_ORIGIN=

# --- Database ---
# The staging Postgres URL. A REMOTE host here is exactly why this file has to be
# named explicitly instead of being loaded by default.
DATABASE_URL=
ADMIN_DATABASE_URL=

# --- Auth: FXL Hub ---
# The staging Client credential. ALL FIVE IDENTITY NAMES TOGETHER, OR NONE - a
# partial set is a boot failure. Use FXL_HUB_CONFIG (one JSON object with exactly
# the five identity keys) OR the five discrete names below, never both.
FXL_HUB_CONFIG=
FXL_HUB_API_URL=
FXL_HUB_ENVIRONMENT=
FXL_HUB_CLIENT_ID=
FXL_HUB_CLIENT_SECRET=
FXL_HUB_AUDIENCE=

# The four OPERATIONAL values. Always discrete, in BOTH forms, because they
# rotate independently of the Client credential; FXL_HUB_CONFIG carrying any of
# them is a hard refusal at boot. The fourth canonical name,
# FXL_HUB_SESSION_ENCRYPTION_KEY, has no line here on purpose: it keys the SDK's
# own SqlHubSessionStore, which this repo does not use.
#
# FXL_HUB_HEALTH_TOKEN is generated by the OPERATOR and is REQUIRED whenever
# FXL_HUB_ENVIRONMENT is not development, so staging must set it.
# FXL_HUB_REDIRECT_URI is not a presence rule: unset, it DEFAULTS to the Hub's
# own origin and the boot refuses it outside development. Set the staging WEB
# origin plus /auth/callback, byte for byte as registered on the Client.
FXL_HUB_HEALTH_TOKEN=
FXL_HUB_REDIRECT_URI=
FXL_HUB_TRUSTED_ORIGINS=

# --- Auth: this app's own values, outside the FXL_HUB_ namespace ---
SALES_POST_LOGIN_REDIRECT=
SALES_POST_LOGIN_ERROR_REDIRECT=
SALES_SESSION_ENCRYPTION_IKM=

# --- Public links ---
PUBLIC_LINK_BASE_URL=

# --- Observability (optional) ---
SENTRY_DSN=

# --- Email (optional, Resend) ---
RESEND_API_KEY=
RESEND_FROM=
```

**Do not** add `.env.staging.example` to the `EXAMPLES` tuple in
`src/config/__tests__/env-example-contract.test.ts`. That test's vacuity guard asserts
`bag.CORS_ORIGIN === 'http://localhost:8006'`, which this file deliberately leaves blank, and its
redirect assertion demands `http://localhost:8006/auth/callback`. This file describes a remote
deployment; it is not a fresh-clone example and the contract that governs those two does not apply.

---

## 6. Documenting `SALES_ENV_FILE` in the two `.env` examples

### The contract question, answered

`apps/api/src/config/__tests__/env-example-contract.test.ts` **does** constrain these two files.
Three mechanisms matter here:

1. **The vacuity guard** (`parses at all, so a green run below cannot mean an empty bag`) asserts
   `bag.CORS_ORIGIN === 'http://localhost:8006'` and
   `Object.keys(bag).length > 10`. Its direction is one-way: it demands *at least* eleven SET keys.
   Adding a key cannot break it; removing ten could.
2. **The `hubConfigIsAbsent` assertions** (`describes an ABSENT Hub configuration in %s` and
   `reaches the 503 door rather than a boot failure from %s`) read only the six credential-bearing
   names - `FXL_HUB_CONFIG` plus the identity five. `SALES_ENV_FILE` is not one of them and
   `HUB_CREDENTIAL_ENV_VARS` in `src/config/auth-provider.ts` must not gain it.
3. **`documentedIdentity`** matches `^# <KEY>=(.+)$` for exactly `FXL_HUB_API_URL`,
   `FXL_HUB_ENVIRONMENT` and `FXL_HUB_AUDIENCE`. A commented `# SALES_ENV_FILE=...` line does not
   collide with any of those three keys.

So **both** forms - a SET-BUT-EMPTY `SALES_ENV_FILE=` line and a COMMENT-ONLY block - keep that
contract green. The test is not the deciding factor.

### The decision: COMMENT-ONLY. Never a `SALES_ENV_FILE=` line.

The reason is not the contract, it is the feature's own rule, and it is binding:

- `.env.dev.example` is copied **verbatim** to `apps/api/.env` by the setup step, and `.env` is
  loaded by default on every `make back`, `make migrate` and `make db-reset`. A
  `SALES_ENV_FILE=` line would put the name into `process.env` of every developer machine as the
  empty string. That is literally "SALES_ENV_FILE set in a committed file", which this run
  forbids outright.
- The empty string would be harmless *today* only because `resolveNamedEnvFilePath` trims and maps
  `''` to null. That is defence in depth being spent to buy back a hazard the file never had to
  create. One uncommented character away from a live line is the wrong distance for a variable
  whose only job is to reach a remote database.
- A comment also matches how the three known-good Hub identity values are already documented in
  both files: shown, commented, one uncomment away, deliberately not set.

### Exact text to append to BOTH `apps/api/.env.example` and `apps/api/.env.dev.example`

Insert it immediately **after** the `# --- Database ---` block in `.env.example` (i.e. after the
`DATABASE_URL=...` line) and, in `.env.dev.example`, immediately after the `ADMIN_DATABASE_URL=`
line - so it sits beside the value it protects. Identical text in both files:

```
# --- Naming another environment on purpose: SALES_ENV_FILE ---
#
# DELIBERATELY HAS NO LINE OF ITS OWN HERE, AND MUST NEVER GET ONE. This file is
# copied to apps/api/.env and loaded by DEFAULT on every command, so a
# `SALES_ENV_FILE=` line would put the name into every developer's environment.
# It is an opt-in typed by a human, in front of one command, at the moment they
# mean it:
#
#   SALES_ENV_FILE=.env.staging pnpm --filter @fxl-sales/api db:migrate
#
# Load order is .env, then .env.local with override, then the named file LAST
# with override, resolved against apps/api when the value is relative and taken
# as-is when it is absolute. The process prints one line naming the file it
# loaded.
#
# A named file that cannot be READ is a hard refusal, never a fallback: falling
# back would run against the LOCAL database while you believe you asked for
# another one. The committed shape of the staging file is
# apps/api/.env.staging.example; the real apps/api/.env.staging is gitignored and
# holds a live credential.
#
# One name per repository, mirroring the Hub's HUB_ENV_FILE. There is no alias
# and no second escape hatch.
```

Nothing else in either file changes. Do **not** touch the `dotenv` fenced blocks in `README.md`
or `CLAUDE.md` - the second half of the contract test governs those and they document the Hub
credential, not this.

---

## 7. Sequencing for the executor

1. Create `apps/api/src/config/env-files.ts`.
2. Create `apps/api/src/config/__tests__/fixtures/named-env-file.fixture`.
3. Create `apps/api/src/config/__tests__/env-files.test.ts`. Run
   `pnpm --filter @fxl-sales/api test` - the new file must pass on its own before anything else
   moves. (It needs no database.)
4. Rewrite the top of `apps/api/src/env.ts`, deleting the two now-unused imports.
5. Rewrite `apps/api/src/db/migrate.ts`.
6. Create `apps/api/.env.staging.example`.
7. Append the comment block to `apps/api/.env.example` and `apps/api/.env.dev.example`.
8. Verify, in this order:
   - `pnpm --filter @fxl-sales/api type-check`
   - `pnpm --filter @fxl-sales/api lint`
   - `pnpm --filter @fxl-sales/api test` (whole unit suite, so `env-example-contract.test.ts` runs)
   - `pnpm --filter @fxl-sales/api build`, then confirm `apps/api/dist/config/env-files.js` exists
     and that `apps/api/dist/env.js` imports `./config/env-files.js`
   - `node scripts/no-legacy-env-names.mjs`
   - `pnpm --filter @fxl-sales/api db:migrate` against the LOCAL Docker Postgres only. It must
     behave exactly as before and print no `[env]` line, because no file was named.
   - `git status --porcelain` - no `.env`, no `.env.staging`, no fixture that looks like a secret.

## 8. Anticipated ways this goes wrong

- **`'..'` copied over from `env.ts`.** `API_ROOT_DIR` would be `apps/api/src`, `.env` would never
  be found, and the API would boot on schema defaults pointing at nothing. The
  `points at apps/api when handed API_ROOT_DIR` test is the tripwire; do not delete it.
- **Leaving `import { config } from 'dotenv'` in `env.ts`.** Lint error, not a warning.
- **Destructuring `namedEnvFile` in `migrate.ts` this slice.** Lint error. Slice 02 does it.
- **Loading before checking readability.** Passes the throw test but loses the property the throw
  exists for. Keep `assertReadable` first.
- **A `SALES_ENV_FILE=` line sneaking into `.env.dev.example`** because it "documents better".
  It is forbidden; see section 6.
- **Adding `SALES_ENV_FILE` to `scripts/no-legacy-env-names.mjs`.** It is a new name. That guard
  has one purpose and gaining a second would make it mean two things.
