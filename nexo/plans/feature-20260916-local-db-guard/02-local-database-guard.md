---
id: 02-local-database-guard
milestone: v4.1.0
status: done
depends_on: [01-env-file-resolution]
files_modified:
  - apps/api/src/db/local-database-guard.ts
  - apps/api/src/db/__tests__/local-database-guard.test.ts
  - apps/api/src/db/migrate.ts
  - apps/api/src/server.ts
acceptance: "given a remote DATABASE_URL host and no named env file, when `pnpm --filter @fxl-sales/api db:migrate` or `node dist/server.js` boots, then the process prints violation lines naming that host and exits with code 1 before any connection is opened; and given a local host, when boot proceeds, then exactly one line naming database host and port is printed and never the user, password or whole URL"
goal: A pure, exported local-database guard invoked at exactly two entrypoints (server boot and migrate) plus a host/port-only boot visibility line.
must_not_break:
  - "`pnpm --filter @fxl-sales/api test` (unit suite) stays green and stays environment-independent - no new module-load assertion anywhere, and NOTHING in `apps/api/src/env.ts` gains a guard call."
  - "`pnpm --filter @fxl-sales/api db:migrate` against the local Postgres (`localhost:5006/fxl_sales`) still applies migrations exactly as today."
  - "`make back` / `pnpm --filter @fxl-sales/api dev` still boots against the local Postgres with no new prompt, flag or variable."
  - "`apps/api/src/db/migrate.ts` must NOT start importing `apps/api/src/env.ts`; its zod schema would `process.exit(1)` on unrelated Hub configuration and turn migrations into a Hub-config gate."
  - "`pnpm run lint` and `pnpm run type-check` stay green under `strict` + `noUncheckedIndexedAccess` + `noUnusedLocals`."
  - "scripts/no-legacy-auth.mjs and scripts/no-legacy-env-names.mjs stay green; `SALES_ENV_FILE` is NOT added to the legacy-names list."
rules:
  - "`apps/api/src/db/local-database-guard.ts` is PURE: no imports of `node:fs`, `node:process`, `dotenv`, `../env.js`, and it NEVER reads `process.env`. Every input arrives as an argument."
  - "The two exported signatures are VERBATIM from the human and must not be altered in name, parameter shape or return type."
  - "The guard is invoked at EXACTLY TWO call sites - `apps/api/src/server.ts` and `apps/api/src/db/migrate.ts` - and nowhere else. Never at module load of any other module."
  - "Local hosts are EXACTLY `localhost`, `127.0.0.1`, `::1`, `db`. No suffix matching, no regex, no `.localhost` wildcard, no extra host."
  - "A `DATABASE_URL` that does not parse is NOT a violation. The guard answers one question: is the host local."
  - "The violation message NAMES the host it found and STATES the exit (`make stg`)."
  - "The boot line prints host and port ONLY - never the user, the password, the database name or the whole URL."
  - "Test fixtures use `db.example.invalid` for the remote host. NEVER `fxl-db-server`, NEVER any `*.tail89bca3.ts.net` host, NEVER a real credential."
  - "NEVER set `SALES_ENV_FILE` in any command, script, test or file. The test passes `namedEnvFile` as a plain function argument - it never touches the environment."
  - "The unit test connects to NOTHING. No `postgres()`, no docker, no network."
verifier_focus: "Prove by EXIT CODE, not message text, that `db:migrate` refuses a remote host with no named env file, and prove the unit test opens no socket."
---


> # CORRECTION - AUTHORITATIVE. READ THIS BEFORE ANY VERBATIM BLOCK BELOW.
>
> This plan was written before `01-env-file-resolution.md` existed. It refers throughout to a symbol
> `resolvedNamedEnvFile` imported from `'../env-file.js'` / `'./env-file.js'` and instructs you to
> "substitute the real names; change nothing else."
>
> **That instruction is WRONG and the plan-check graded it a BLOCKER.** There is no
> `resolvedNamedEnvFile` and no `env-file.js`. Slice 01 landed
> `apps/api/src/config/env-files.ts`, and the two call sites reach the named file by **two
> different mechanisms**. The block below supersedes every conflicting verbatim sketch in this
> file. Where this block and a later sketch disagree, THIS BLOCK WINS.
>
> ## Call site 1 - `apps/api/src/server.ts`
>
> Slice 01 made `env.ts` export the resolved path as a module-level binding. So widen the EXISTING
> import on line 4 - do NOT add an import from `./config/env-files.js`, and do NOT call
> `loadEnvFiles` here; `env.js` already ran it at module evaluation and a second call would re-run
> dotenv:
>
> ```ts
> import { env, namedEnvFile } from './env.js';
> ```
>
> (one widened statement, not a second `import` line - stated so you do not deliberate), plus, at
> the end of the import block:
>
> ```ts
> import { assertLocalDatabase, describeDatabaseTarget } from './db/local-database-guard.js';
> ```
>
> The guard expression uses the shorthand property, since the binding is already named right:
>
> ```ts
> const databaseViolations = assertLocalDatabase({
>   nodeEnv: env.NODE_ENV,
>   databaseUrl: env.DATABASE_URL,
>   namedEnvFile,
> });
> ```
>
> ## Call site 2 - `apps/api/src/db/migrate.ts`
>
> Slice 01 left this file CALLING the loader and DISCARDING its return. You **destructure that same
> existing statement**. You add nothing new for env resolution, and above all you do NOT delete the
> `loadEnvFiles(...)` call while replacing the file - that deletion type-checks and lints cleanly
> and silently breaks `make migrate` on every developer machine with `DATABASE_URL is required`:
>
> ```ts
> import { API_ROOT_DIR, loadEnvFiles } from '../config/env-files.js';
> import { assertLocalDatabase, describeDatabaseTarget } from './local-database-guard.js';
> import { runDatabaseMigrations } from './migration-runner.js';
>
> const { namedEnvFile } = loadEnvFiles({ baseDir: API_ROOT_DIR, bag: process.env });
> ```
>
> `const nodeEnv = process.env.NODE_ENV ?? 'development'` and `const url = process.env.DATABASE_URL`
> MUST be read **after** that `loadEnvFiles` line. dotenv populates `process.env` inside the call,
> so reading either before it yields the pre-dotenv values. Then:
>
> ```ts
> const databaseViolations = assertLocalDatabase({
>   nodeEnv,
>   databaseUrl: url,
>   namedEnvFile,
> });
> ```
>
> ## Three further corrections from the plan-check, also authoritative
>
> 1. **Delete the unused `LOCAL_URL` constant** from the test sketch. Nothing references it, and
>    `@typescript-eslint/no-unused-vars` is an ERROR here while `eslint src/` does lint `__tests__`,
>    so the sketch as written fails lint on its first run.
> 2. **`describeDatabaseTarget` must be asserted**, not merely exported. It produces the boot line
>    that satisfies the feature's acceptance criterion 4, and its two interesting branches are
>    otherwise pinned only indirectly. Add:
>    ```ts
>    expect(describeDatabaseTarget('postgresql://u:p@localhost/x')).toEqual({ host: 'localhost', port: '5432' });
>    expect(describeDatabaseTarget('postgresql://u:p@[::1]:5006/x')).toEqual({ host: '::1', port: '5006' });
>    ```
>    That also resolves the `noUnusedLocals` note telling you not to import it.
> 3. **Keep the call's opening paren on the same line as the symbol** -
>    `const databaseViolations = assertLocalDatabase({` - at BOTH sites. Slice 04's structural guard
>    mutates fixtures with a line filter on `\bassertLocalDatabase\s*\(`; reflowing the object
>    argument onto the next line makes that mutation remove nothing and the guard's own negative
>    case stops proving anything.
>
> ## The server arm needs its own proof command
>
> This plan's §6 gives the migrate-arm exit-code proof. The acceptance criterion also names
> `node dist/server.js`, and no slice supplied a command for it. Run this one too, and record both
> exit codes in your notes:
>
> ```sh
> pnpm --filter @fxl-sales/api build && \
>   DATABASE_URL='postgresql://u:p@db.example.invalid:5432/fxl_sales' node apps/api/dist/server.js; echo "exit=$?"
> ```
>
> Expect a non-zero exit and the three `[local-database-guard]` lines. It is safe for exactly the
> reason the migrate one is: `.invalid` is RFC 6761 reserved and unresolvable, and the guard is a
> string comparison that runs before any socket opens. **Never substitute a real host here.**

# 02 - The local database guard, and the boot visibility line

## What this slice is for

`apps/api/src/db/migrate.ts` reads `process.env.DATABASE_URL` raw and never passes through
`apps/api/src/env.ts`. On 2026-09-16 that path applied DDL to the staging database with nothing on
screen saying so. This slice adds the refusal and the visibility line. Covering `migrate.ts` is the
central requirement; it cannot be simplified away.

Slice 01 lands first and supplies the resolved path of the `SALES_ENV_FILE`-named file, or `null`
when that variable is unset. This slice CONSUMES that value; it never reads the variable itself.

> **Dependency note for the executor.** At the time this plan was written,
> `nexo/plans/feature-20260916-local-db-guard/01-env-file-resolution.md` did not exist yet. The
> contract is fixed: slice 01 ships a shared env-file resolver module under `apps/api/src/` that
> exports the RESOLVED ABSOLUTE PATH of the `SALES_ENV_FILE`-named file, or `null` when the
> variable is unset. **The exact module path and the exact exported symbol name must be read out of
> slice 01's landed code at execution time.** Throughout this plan that value is written as
> `resolvedNamedEnvFile` imported from `'../env-file.js'` (from `src/db/`) / `'./env-file.js'`
> (from `src/`). Substitute the real names; change nothing else.

## Part 1 - the new module

### File: `apps/api/src/db/local-database-guard.ts` (NEW)

Exact content sketch. The two exported signatures are verbatim and binding. `describeDatabaseTarget`
is a third export, added deliberately so the boot line reuses THIS module's parser instead of
introducing a second one.

```ts
/**
 * The local-database guard.
 *
 * PURE by construction: it imports nothing, performs no I/O, and NEVER reads
 * `process.env`. Every input arrives as an argument. That is what lets the unit
 * test cover it without a database, a file, or an ambient environment, and what
 * keeps it safe to import from `env.ts`-adjacent code without making the test
 * suite environment-dependent.
 *
 * Why it exists: on 2026-09-16 `apps/api/.env` carried an ACTIVE DATABASE_URL
 * pointing at a remote staging host. `make migrate` and `make db-reset` applied
 * DDL there, with nothing on screen naming the host. `db/migrate.ts` reads
 * `process.env.DATABASE_URL` raw and never passes through `env.ts`, so a check
 * living in the zod schema would have missed exactly the path that applies DDL.
 *
 * The ONLY escape hatch is the named env file (SALES_ENV_FILE, resolved by the
 * shared resolver in slice 01). There is deliberately no ALLOW_REMOTE and no CLI
 * flag: two exits for one rule is divergence.
 */

/**
 * The complete set of hosts that need no opt-in.
 *
 * `db` is the docker compose service name and MUST pass - inside the compose
 * network that is what the API resolves the database as.
 *
 * Matching is EXACT. No suffix matching, no wildcard, no regex: `evil-localhost`
 * and `localhost.attacker.example` are not local.
 */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', 'db']);

/**
 * The parsed host and port of a database URL, or `null` when the URL is absent
 * or does not parse.
 *
 * `new URL('postgresql://u:p@[::1]:5432/x').hostname` yields `'[::1]'` WITH the
 * brackets - that is the WHATWG URL serialization of an IPv6 literal, not a
 * quirk of this code. The brackets are stripped here so `::1` compares equal to
 * the entry in LOCAL_HOSTS. Getting this wrong silently breaks one of the four
 * required local hosts, and it breaks it in the SAFE-looking direction (an IPv6
 * loopback would be treated as remote and refused).
 */
function parseDatabaseTarget(
  databaseUrl: string | undefined,
): { host: string; port: string } | null {
  if (!databaseUrl) return null;
  let parsed: URL;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    return null;
  }
  const hostname = parsed.hostname;
  const host =
    hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
  if (host === '') return null;
  // An omitted port is Postgres' default of 5432, which is what the driver will
  // actually dial. Reporting '5432' is therefore the truth, not a guess.
  const port = parsed.port === '' ? '5432' : parsed.port;
  return { host, port };
}

/**
 * Host and port ONLY, for the boot visibility line. NEVER the user, the
 * password, the database name or the whole URL - the whole point of the line is
 * that it is safe to print in every log.
 *
 * Returns `null` when the URL is absent or does not parse; the caller decides
 * what to say about that.
 */
export function describeDatabaseTarget(
  databaseUrl: string | undefined,
): { host: string; port: string } | null {
  return parseDatabaseTarget(databaseUrl);
}

/**
 * True when the URL's host is one of the four local hosts.
 *
 * A URL that does not parse, or that is absent, is NOT local - but that is not
 * the same as being a violation. See `assertLocalDatabase`.
 */
export function isLocalDatabaseHost(databaseUrl: string | undefined): boolean {
  const target = parseDatabaseTarget(databaseUrl);
  if (!target) return false;
  return LOCAL_HOSTS.has(target.host);
}

/**
 * The guard. Returns the violation lines, or an empty array when there is
 * nothing to refuse. It decides; it does not print and it does not exit. The two
 * entrypoints print every line and `process.exit(1)`.
 *
 * A violation is returned ONLY when all three hold TOGETHER:
 *   1. `nodeEnv !== 'production'` - in production a remote host is the point.
 *   2. the host of `databaseUrl` PARSES and is NOT local.
 *   3. `namedEnvFile === null` - no named env file was in play, so nobody asked
 *      for a remote target on purpose.
 *
 * A `DATABASE_URL` that DOES NOT PARSE is NOT a violation of this guard. This
 * guard answers ONE question only: is the host local. Refusing an unparseable
 * URL here would produce a second, worse-worded version of the error the caller
 * already raises (`DATABASE_URL is required`) or that the driver raises on
 * connect, and it would attach that failure to the wrong cause.
 */
export function assertLocalDatabase(input: {
  nodeEnv: string;
  databaseUrl: string | undefined;
  namedEnvFile: string | null;
}): string[] {
  if (input.nodeEnv === 'production') return [];
  if (input.namedEnvFile !== null) return [];

  const target = parseDatabaseTarget(input.databaseUrl);
  if (!target) return [];
  if (LOCAL_HOSTS.has(target.host)) return [];

  return [
    `[local-database-guard] DATABASE_URL points at the non-local host "${target.host}".`,
    '[local-database-guard] Only localhost, 127.0.0.1, ::1 and db run without an opt-in. Refusing to connect or migrate.',
    '[local-database-guard] To target a remote environment on purpose, use the staging entrypoint: make stg',
  ];
}
```

### The exact violation wording, and why

The three lines above are the wording. They are verbatim and the executor does not reword them.

Line 1 NAMES THE HOST. A message that only says "refused" sends the person looking in the wrong
place - it reads as a bug in the tool rather than as a fact about their `.env`. Naming
`fxl-db-server` is the whole diagnosis, delivered in one line.

Line 2 states the rule so the reader does not have to find the source to learn what "local" means.

Line 3 STATES THE EXIT. Without it the only discoverable way forward is to disable the guard, which
is the failure mode the guard exists to prevent. `make stg` is delivered by slice 03; the message
naming it before it exists is correct - slices 02 and 03 are the same wave and ship together.

The `[local-database-guard]` prefix matches the repo's existing `[nightly-job]` /
`[hub-session-store]` / `[fxl-sales-api]` bracket-prefix logging convention.

### The exact boot-line format

`[fxl-sales-api] database host=localhost port=5006`

and, in migrate:

`[fxl-sales-migrate] database host=localhost port=5006`

Host and port ONLY. No user, no password, no database name, no URL. When the URL is absent or does
not parse, print instead:

`[fxl-sales-api] database target unknown - DATABASE_URL is absent or does not parse`

(that branch is unreachable in `migrate.ts`, which has already refused an absent URL by then; it IS
reachable in `server.ts`, which boots without `DATABASE_URL` on purpose - see `db/client.ts`'s lazy
initialization and `hub-session-store.ts`'s in-memory fallback).

## Part 2 - call site one: `apps/api/src/server.ts`

### Does any import in that file open a DB connection at module load?

Checked, and the answer is **no - but one gets close, and it decides the placement.**

- `src/db/client.ts` is lazy by design: `getDb()` / `getAdminDb()` build the `postgres()` pool on
  first call, and there is deliberately no `db` singleton and no `db/index.ts` barrel. Nothing at
  module scope in that file calls `postgres()`.
- `src/db/migration-runner.ts` calls `postgres()` only inside `runDatabaseMigrations`.
- Those are the only three `postgres(` call sites in `apps/api/src` outside tests.
- `setupNightlyJob()` runs at module top level but only registers cron tasks; `getAdminDb()` is
  reached inside the scheduled callbacks.
- **`createAppAuthBff()` runs at module top level and reaches `getAdminDb()` synchronously** via
  `createHubSessionStore` when `DATABASE_URL` is present. `postgres-js` builds the pool without
  opening a socket until the first query (the comment at `src/auth/hub-session-store.ts:427-429`
  says so explicitly), so no socket opens - but a pool is CONSTRUCTED against the remote URL. The
  guard therefore goes **before** that line, not merely before `serve(...)`.

### Exact placement

Add the imports at the end of the existing import block (after the last `./routes/health.js`
import), and insert the guard + boot line as the FIRST executable statements in the module body,
immediately before `const app = new Hono();`. That is the earliest point in the module and is
unambiguously before `createAppAuthBff()`, `setupNightlyJob()` and `serve(...)`.

Current code, unchanged, for reference:

```ts
import { setupNightlyJob } from './jobs/nightly-job.js';
import { healthRouter } from './routes/health.js';

const app = new Hono();
```

Becomes:

```ts
import { setupNightlyJob } from './jobs/nightly-job.js';
import { healthRouter } from './routes/health.js';
import { assertLocalDatabase, describeDatabaseTarget } from './db/local-database-guard.js';
import { resolvedNamedEnvFile } from './env-file.js'; // slice 01 - CONFIRM the real symbol/path

// The local-database guard runs FIRST, before anything else in this module
// body. `createAppAuthBff()` below reaches getAdminDb() synchronously and
// constructs a postgres-js pool against DATABASE_URL; no socket opens until the
// first query, but the guard belongs in front of it all the same. Deliberately
// NOT in env.ts: that module is imported by the unit suite, and an assertion
// there would make the whole suite environment-dependent.
const databaseViolations = assertLocalDatabase({
  nodeEnv: env.NODE_ENV,
  databaseUrl: env.DATABASE_URL,
  namedEnvFile: resolvedNamedEnvFile,
});
if (databaseViolations.length > 0) {
  for (const line of databaseViolations) console.error(line);
  process.exit(1);
}

// One line, every non-production boot, naming the database this process is
// about to use. Its absence is what made the 2026-09-16 staging write invisible.
// Host and port ONLY - never the user, the password or the whole URL.
if (env.NODE_ENV !== 'production') {
  const target = describeDatabaseTarget(env.DATABASE_URL);
  console.log(
    target
      ? `[fxl-sales-api] database host=${target.host} port=${target.port}`
      : '[fxl-sales-api] database target unknown - DATABASE_URL is absent or does not parse',
  );
}

const app = new Hono();
```

Nothing else in `server.ts` changes. The existing
`console.log(`[fxl-sales-api] listening on http://localhost:${port} (${env.NODE_ENV})`)` at the
bottom stays exactly as it is - it names the HTTP port, which is a different fact.

`env` is already imported at the top of the file (`import { env } from './env.js';`), so no new
import is needed for it.

## Part 3 - call site two: `apps/api/src/db/migrate.ts`

This is the path that applies DDL, and the one that was exposed. Current file in full:

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

Becomes:

```ts
import { resolvedNamedEnvFile } from '../env-file.js'; // slice 01 - CONFIRM the real symbol/path
import { assertLocalDatabase, describeDatabaseTarget } from './local-database-guard.js';
import { runDatabaseMigrations } from './migration-runner.js';

// Migrations run with the standard FXL project DATABASE_URL created by
// create-db.sh. Cluster roles are provisioned outside application migrations.
//
// This module deliberately does NOT import ../env.js. That module's zod schema
// process.exit(1)s on any invalid variable in the whole API surface - Hub
// credentials included - and a migration has no business failing on Hub
// configuration. NODE_ENV therefore comes from process.env here, read once.
const nodeEnv = process.env.NODE_ENV ?? 'development';
const url = process.env.DATABASE_URL;

// The guard runs BEFORE any connection is opened and BEFORE runDatabaseMigrations.
// This is the path that applies DDL. On 2026-09-16 it applied DDL to staging.
const databaseViolations = assertLocalDatabase({
  nodeEnv,
  databaseUrl: url,
  namedEnvFile: resolvedNamedEnvFile,
});
if (databaseViolations.length > 0) {
  for (const line of databaseViolations) console.error(line);
  process.exit(1);
}

if (!url) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const target = describeDatabaseTarget(url);
if (nodeEnv !== 'production') {
  console.log(
    target
      ? `[fxl-sales-migrate] database host=${target.host} port=${target.port}`
      : '[fxl-sales-migrate] database target unknown - DATABASE_URL does not parse',
  );
}

console.log('Running migrations from ./drizzle');
await runDatabaseMigrations({ databaseUrl: url, migrationsFolder: './drizzle' });
console.log('Done.');
```

Note `import 'dotenv/config'` is REMOVED - slice 01 replaces it with the shared resolver, which is
what makes `SALES_ENV_FILE` load LAST with override on this path too. If slice 01 landed a resolver
that does the loading as an import side effect, that import alone is enough; if slice 01 landed a
function that must be CALLED, call it as the first statement of this file and take
`resolvedNamedEnvFile` from its return. Read slice 01's module and follow it. Slice 04 adds a
structural guard that fails if `migrate.ts` ever regains raw `dotenv/config`.

### The ordering, and why it is that order

**env resolution (slice 01) -> guard -> `DATABASE_URL is required` -> boot line ->
`runDatabaseMigrations`.**

1. **Env resolution first.** The guard's third input is the resolved named file. Asking the guard
   before the resolver has run would hand it a `null` that means "not resolved yet" instead of
   "not requested", and the guard would refuse a legitimate staging migration.
2. **Guard before the required-check.** The guard is the first thing that happens once the
   environment is known, so no statement can ever be inserted between "we know the URL" and "we
   have decided about the URL". Behaviourally the two checks do not overlap - an absent URL yields
   no violation from the guard, by design - so putting the guard first costs nothing and buys a
   position that stays correct as the file grows. It also means the guard's verdict is the first
   thing on screen when both would fire.
3. **`DATABASE_URL is required` keeps its own message.** The guard deliberately does not claim the
   absent case (decision 5 in the overview: a URL that does not parse is not a violation of THIS
   guard). Its existing message is the right one and does not move.
4. **Boot line after the required-check.** By then `url` is narrowed to `string` and there is
   always something to describe. Printing it before would mean printing "unknown" and then exiting
   one line later, which is noise.
5. **`runDatabaseMigrations` last.** It is the first thing in this file that calls `postgres()`
   and therefore the first thing that can open a socket. Everything above it is pure or prints.

### Should `migrate.ts` print the boot line too? Yes - recommended, and here is why

**Recommendation: yes, print it, with the `[fxl-sales-migrate]` prefix.**

`make migrate` and `make db-reset` are separate processes from `make back`. A line printed only at
API boot tells the operator nothing about the process that is, right now, about to apply DDL - and
DDL is the irreversible half. `make db-reset` chains `$(MAKE) migrate`, so the migrate process is
exactly the one that ran against staging on 2026-09-16 while the API was not even running. A
visibility line that is absent from the dangerous path repeats the original defect in miniature.

The distinct prefix matters: with both processes emitting the same string, a scrollback would not
say which one spoke. `[fxl-sales-migrate]` vs `[fxl-sales-api]` makes that unambiguous.

Cost is one line of stdout on a command that already prints two.

### Where `nodeEnv` comes from - the decision, per entrypoint

| entrypoint | source | why |
| --- | --- | --- |
| `server.ts` | `env.NODE_ENV` | `env.js` is already imported at the top of that file, is already validated, and already defaults to `'development'`. Reading `process.env.NODE_ENV` beside an imported, validated `env` would be a second source of truth for one fact in one file. |
| `migrate.ts` | `process.env.NODE_ENV ?? 'development'` | `migrate.ts` deliberately does not import `env.ts` today. Importing it would drag in the whole zod schema and its `process.exit(1)` on ANY invalid variable across the API surface - Hub client ids, Sentry DSNs, CORS origins - turning a migration into a Hub-configuration gate and inventing a brand-new failure mode for `make migrate`. It would also load `env.ts`'s own `dotenv` calls, duplicating slice 01's resolution. |

The asymmetry is deliberate and is worth one comment in `migrate.ts` (included in the sketch above).

It is also SAFE in the only direction that matters: the guard's rule is `nodeEnv !== 'production'`,
so an unset or misspelled `NODE_ENV` lands on the guard-ACTIVE side. The `?? 'development'` is for
the `string` type, not for the semantics.

## Part 4 - the named oracle

### File: `apps/api/src/db/__tests__/local-database-guard.test.ts` (NEW)

House style, taken from `src/db/__tests__/single-role-db-contract.test.ts` and
`src/db/__tests__/migration-runner.test.ts`: named imports from `'vitest'`, `.js` extension on the
relative import, one `describe` per concern, `it.each` with an object table for parametrised cases.
The unit suite include glob is `src/**/__tests__/**/*.test.ts`, so this path is picked up with no
config change. `test/unit-setup.ts` runs first and blanks six Hub names; irrelevant here, and
deliberately not relied upon - **this test reads no environment variable at all.**

**This test connects to NOTHING.** No `postgres()`, no docker, no network, no filesystem. Every
input is a literal argument.

Fixtures: the remote host is `db.example.invalid` (RFC 6761 reserved TLD - it cannot resolve). The
real staging host and anything on `tail89bca3.ts.net` must never appear in a tracked file. Test
credentials are the literal `u:p`.

```ts
import { describe, expect, it } from 'vitest';
import { assertLocalDatabase, isLocalDatabaseHost } from '../local-database-guard.js';

const REMOTE_URL = 'postgresql://u:p@db.example.invalid:5432/fxl_sales';
const LOCAL_URL = 'postgresql://u:p@localhost:5006/fxl_sales';

// The four hosts that must pass, one row each. `hostLabel` is asserted against
// the expected roster below so this table can never go vacuously empty or short.
const localHostCases = [
  { hostLabel: 'localhost', url: 'postgresql://u:p@localhost:5006/fxl_sales' },
  { hostLabel: '127.0.0.1', url: 'postgresql://u:p@127.0.0.1:5006/fxl_sales' },
  { hostLabel: '::1', url: 'postgresql://u:p@[::1]:5006/fxl_sales' },
  { hostLabel: 'db', url: 'postgresql://u:p@db:5432/fxl_sales' },
] as const;

describe('isLocalDatabaseHost', () => { /* cases below */ });
describe('assertLocalDatabase', () => { /* cases below */ });
```

### Exact test names and assertions

`describe('local host roster')`

1. `it('covers exactly the four local hosts, and no more')`
   `expect(localHostCases.map((c) => c.hostLabel)).toEqual(['localhost', '127.0.0.1', '::1', 'db'])`
   **This is the anti-vacuity assertion.** A parametrised block over an accidentally emptied,
   shortened or renamed table would pass silently; this assertion pins the table's exact contents
   and order, so `it.each` over that same table can no longer pass for the wrong reason. It must
   live in the same file and read from the same `localHostCases` constant the `it.each` consumes.

`describe('isLocalDatabaseHost')`

2. `it.each(localHostCases)('accepts the local host $hostLabel', ({ url }) => ...)`
   `expect(isLocalDatabaseHost(url)).toBe(true)` - one `it` per host, four separate test names in
   the reporter, not one loop inside one `it`.
3. `it('rejects a remote host')` -> `expect(isLocalDatabaseHost(REMOTE_URL)).toBe(false)`
4. `it('rejects a host that only looks local')` ->
   `expect(isLocalDatabaseHost('postgresql://u:p@localhost.db.example.invalid:5432/x')).toBe(false)`
   and `expect(isLocalDatabaseHost('postgresql://u:p@notlocalhost:5432/x')).toBe(false)`
   (pins EXACT matching; a suffix/`includes` implementation fails here)
5. `it('returns false for a url that does not parse')` ->
   `expect(isLocalDatabaseHost('not a url')).toBe(false)`
6. `it('returns false for an absent url')` -> `expect(isLocalDatabaseHost(undefined)).toBe(false)`
7. `it('accepts the bracketed IPv6 loopback form that new URL() produces')` ->
   `expect(isLocalDatabaseHost('postgresql://u:p@[::1]:5432/x')).toBe(true)`, with a comment stating
   that `new URL(...).hostname` yields `'[::1]'` WITH brackets. This is the regression pin for the
   one host most likely to be broken silently.

`describe('assertLocalDatabase')`

8. `it.each(localHostCases)('does not violate for the local host $hostLabel', ...)`
   `expect(assertLocalDatabase({ nodeEnv: 'development', databaseUrl: url, namedEnvFile: null })).toEqual([])`
   - the four required hosts, ONE BY ONE, through the guard itself and not only through the predicate.
9. `it('does not violate for a remote host when a named env file is in play')`
   `assertLocalDatabase({ nodeEnv: 'development', databaseUrl: REMOTE_URL, namedEnvFile: '/abs/path/to/some.env' })`
   -> `toEqual([])`. The path is a plain string literal; no file is created and no variable is set.
10. `it('violates for a remote host with no named env file')`
    `const violations = assertLocalDatabase({ nodeEnv: 'development', databaseUrl: REMOTE_URL, namedEnvFile: null });`
    `expect(violations.length).toBeGreaterThan(0);`
11. `it('names the host it found in the violation message')`
    `expect(violations.join('\n')).toContain('db.example.invalid');` -- the message CITES THE HOST.
12. `it('states the way out in the violation message')`
    `expect(violations.join('\n')).toContain('make stg');`
13. `it('does not violate in production')`
    `expect(assertLocalDatabase({ nodeEnv: 'production', databaseUrl: REMOTE_URL, namedEnvFile: null })).toEqual([])`
14. `it('does not violate for a url that does not parse')`
    `expect(assertLocalDatabase({ nodeEnv: 'development', databaseUrl: 'not a url', namedEnvFile: null })).toEqual([])`
    with a comment: the guard answers one question only - is the host local.
15. `it('does not violate for an absent url')`
    `expect(assertLocalDatabase({ nodeEnv: 'development', databaseUrl: undefined, namedEnvFile: null })).toEqual([])`
16. `it('violates in the test environment too')`
    `nodeEnv: 'test'` with `REMOTE_URL` and `namedEnvFile: null` -> `length > 0`. Pins that the
    production exemption is an EQUALITY on `'production'` and not an inequality on `'development'`.

Tests 10-12 may share one `beforeEach`-free local helper that calls the guard; keep three separate
`it` names so the reporter distinguishes "it refused" from "it said which host" from "it said how
to proceed".

## Part 5 - lint / tsconfig conventions, so it lints clean first time

Verified against `apps/api/eslint.config.js`, `apps/api/tsconfig.json`, `tsconfig.base.json` and
`prettier.config.js`:

- ESLint is flat config: `js.configs.recommended` + `tseslint.configs.recommended`, plus
  `@typescript-eslint/no-explicit-any: 'error'` and
  `@typescript-eslint/no-unused-vars: ['error', { argsIgnorePattern: '^_' }]`. **No `any`, anywhere,
  including in the test.** No `no-console` rule, so `console.log` / `console.error` are fine and are
  already the house pattern in `server.ts` and `migrate.ts`.
- `pnpm lint` in `apps/api` runs `eslint src/`, which **includes `src/**/__tests__/`**. The test file
  is linted like production code.
- TypeScript: `module`/`moduleResolution` are `NodeNext`, so **every relative import carries the
  `.js` extension**, including from a `__tests__` directory (`'../local-database-guard.js'`).
- `strict: true`, `noImplicitAny: true`, `noUncheckedIndexedAccess: true`: never index an array
  without narrowing. The sketch avoids indexing entirely - it uses `for...of` over the violations
  and `.join('\n')` in the test.
- `noUnusedLocals: true`: do not import `describeDatabaseTarget` into the test unless it is asserted.
- `exactOptionalPropertyTypes: false`, so `databaseUrl: string | undefined` as a required property
  accepting `undefined` is fine - and it is what the verbatim signature says. Do NOT "tidy" it to
  `databaseUrl?: string`; that changes the human's signature.
- `"types": ["node"]` is set, so `process.exit` / `process.env` type-check in the entrypoints.
- Prettier: `singleQuote`, `semi`, `trailingComma: 'all'`, `printWidth: 100`, 2-space indent,
  `arrowParens: 'always'`. The violation line 2 string exceeds 100 characters; leave it on one line
  (Prettier does not break string literals) and do not concatenate it - a searchable single-line
  message is worth more than the column.
- `tsconfig.json` has `"include": ["src/**/*"]`, so both new files are type-checked by
  `pnpm --filter @fxl-sales/api type-check`.

## Part 6 - verification the executor runs (all local, nothing remote)

1. `pnpm --filter @fxl-sales/api lint`
2. `pnpm --filter @fxl-sales/api type-check`
3. `pnpm --filter @fxl-sales/api test` - the new unit file is green and opens no socket.
4. `node scripts/no-legacy-auth.mjs` and `node scripts/no-legacy-env-names.mjs` still green.
5. With the local Postgres up: `pnpm --filter @fxl-sales/api db:migrate` succeeds and prints
   `[fxl-sales-migrate] database host=localhost port=5006`.
6. The refusal, proven BY EXIT CODE and against a host that cannot resolve:
   `DATABASE_URL='postgresql://u:p@db.example.invalid:5432/fxl_sales' pnpm --filter @fxl-sales/api db:migrate; echo "exit=$?"`
   must print `exit=1` and the three violation lines. **`db.example.invalid` is unresolvable by
   construction - the guard must refuse BEFORE any DNS lookup, so the exit code is the guard's and
   not the driver's. Confirm the three `[local-database-guard]` lines are present, then trust the
   exit code, not the text.**
   NEVER run this with `fxl-db-server` or any `tail89bca3.ts.net` host. That host ANSWERS.
7. `git status --porcelain` shows only the four intended files and no `.env` of any kind.
8. `git diff` contains no credential, no remote database URL, and no occurrence of `SALES_ENV_FILE`
   being SET.

## Part 7 - what this slice does NOT do

- It does not add `make stg` / `back-stg` / `front-stg`. That is slice 03.
- It does not add the structural guard that fails when a call site disappears. That is slice 04.
- It does not touch `apps/api/src/env.ts` beyond whatever slice 01 already did there. **No guard
  call goes into `env.ts`, ever** - it is imported by the unit suite, and an assertion in its body
  would make the entire suite environment-dependent.
- It does not add `SALES_ENV_FILE` to `scripts/no-legacy-env-names.mjs`. That is a NEW name, not a
  retired one.
- It does not invent `ALLOW_REMOTE`, `--allow-remote`, `FORCE`, or any other second exit.
