# Verify 02 - local database guard (Gate 2, fast per-slice tier)

Branch under test: `feat/02-local-database-guard`
Base: `master`
Date: 2026-09-16

Diff read with `git diff master...feat/02-local-database-guard -- . ':(exclude)nexo'`.
Nothing under `nexo/runs/` was read. The spec (`02-local-database-guard.md`, starting at its
`CORRECTION - AUTHORITATIVE` block) and `00-OVERVIEW.md` were read.

Diff surface (4 files, 385 insertions, 22 deletions):

```
 apps/api/src/db/__tests__/local-database-guard.test.ts  | 159 +++++++++++++++++++++
 apps/api/src/db/local-database-guard.ts                 | 123 ++++++++++++++++
 apps/api/src/db/migrate.ts                              |  38 ++++-
 apps/api/src/server.ts                                  |  87 ++++++++---
```

Hunk headers - note there is exactly ONE hunk in `server.ts`, covering old lines 1-24 only:

```
apps/api/src/db/__tests__/local-database-guard.test.ts  @@ -0,0 +1,159 @@
apps/api/src/db/local-database-guard.ts                 @@ -0,0 +1,123 @@
apps/api/src/db/migrate.ts                              @@ -1,20 +1,56 @@
apps/api/src/server.ts                                  @@ -1,24 +1,69 @@
```

---

## 1-4. The four required commands

### 1. `pnpm --filter @fxl-sales/api test`

```
 Test Files  46 passed (46)
      Tests  478 passed (478)
   Duration  1.46s
TEST exit=0
```

The new file is in that total: `✓ src/db/__tests__/local-database-guard.test.ts (24 tests) 3ms`.

### 2. `pnpm --filter @fxl-sales/api lint`

```
> @fxl-sales/api@1.0.0 lint
> eslint src/
LINT exit=0
```

(no output = clean; `eslint src/` does lint `src/**/__tests__/`)

### 3. `pnpm --filter @fxl-sales/api type-check`

```
> @fxl-sales/api@1.0.0 type-check
> tsc --noEmit
TYPECHECK exit=0
```

### 4. `pnpm --filter @fxl-sales/api build`

```
> @fxl-sales/api@1.0.0 build
> tsc && tsc-alias
BUILD exit=0
```

Supplementary (spec §6.4), both green:

```
node scripts/no-legacy-auth.mjs        -> exit=0
node scripts/no-legacy-env-names.mjs   -> exit=0
```

---

## The `server.ts` restructure

### (a) Is the ESM claim TRUE? YES.

The claim: ESM evaluates the entire static import graph before the first statement of the importing
module body, so a guard written as the "first body statement" of `server.ts` would still run AFTER
`middleware/app-auth.js`, which loads Hub configuration at ITS module top level and throws there.

Confirmed three independent ways.

**1. The offending top-level statement exists and is exactly as described.**

```
apps/api/src/middleware/app-auth.ts:96:
const hubSdkConfig: HubConfig | null = tryLoadHubAuthConfig(hubEnvBag(env));
```

That is module-scope, not inside a function, and it throws `HubConfigError` on a bad Hub
configuration. On `master` `app-auth.js` is static import #7 of 21 in `server.ts`.

**2. A minimal, self-contained ESM demonstration** (written to a scratch dir, not the repo):

```
side.mjs:  console.log("SIDE-EFFECT MODULE TOP LEVEL"); export const x = 1;
main.mjs:  import { x } from "./side.mjs"; console.log("GUARD FIRST BODY STATEMENT", x);

$ node main.mjs
SIDE-EFFECT MODULE TOP LEVEL
GUARD FIRST BODY STATEMENT 1
```

The imported module's top-level code runs first. A "first body statement" guard is therefore not
first.

**3. The live stack trace from the built artifact on this machine** (local-DB arm, below) shows the
error now arriving THROUGH the dynamic import, i.e. after the guard has already spoken:

```
at file:///.../apps/api/dist/middleware/app-auth.js:61:22
at ModuleJob.run (node:internal/modules/esm/module_job:343:25)
at async file:///.../apps/api/dist/server.js:44:49      <- the `await import(...)` line
```

`dist/server.js:44` is inside the dynamic-import block, well below the guard. With a static import
this frame would have been a `ModuleJob.run` during graph evaluation, before any body statement.

**Verdict on (a): the claim is TRUE and the restructure is justified, not stylistic.** The remote
refusal proof below is the decisive empirical evidence: the guard fires and the process exits
without ever reaching `HubConfigError`, which is impossible with a static import list on this
machine.

### (b) Is the REWRITE CORRECT? YES - registration order is byte-identical.

There is only ONE hunk in `server.ts` and it ends at `const app = new Hono();`. Everything below is
untouched context. Proven mechanically rather than by eye:

```
$ ON=$(grep -n 'const app = new Hono' old-server.ts | cut -d: -f1)   # 23
$ NN=$(grep -n 'const app = new Hono' apps/api/src/server.ts | cut -d: -f1)   # 68
$ diff <(tail -n +$ON old-server.ts) <(tail -n +$NN apps/api/src/server.ts)
BODY BYTE-IDENTICAL FROM 'const app = new Hono()' ONWARD
```

Zero lines differ from `const app = new Hono();` to the final `serve(...)`. Every `app.use` /
`app.route` / `app.get` / `app.notFound`, every comment (including "the admin group is mounted
BEFORE the finder group so /admin/* never falls through to it"), `setupNightlyJob()`, the listening
log and `serve(...)` are unchanged, in place, in order.

The only remaining order question is MODULE EVALUATION order, which also had to be preserved because
module top-level side effects (e.g. `createHubBff` config load) run in that order. It is identical:

| # | old static import specifier | new dynamic import specifier |
| --- | --- | --- |
| - | `'./env.js'` (4th) | `'./env.js'` - **static, promoted to first** (deliberate: it is the guard's input) |
| - | - | `'./db/local-database-guard.js'` - **new, static** (imports nothing) |
| 1 | `'@hono/node-server'` | `'@hono/node-server'` |
| 2 | `'hono'` | `'hono'` |
| 3 | `'hono/logger'` | `'hono/logger'` |
| 4 | `'./middleware/cors.js'` | `'./middleware/cors.js'` |
| 5 | `'./middleware/error.js'` | `'./middleware/error.js'` |
| 6 | `'./middleware/app-auth.js'` | `'./middleware/app-auth.js'` |
| 7 | `'./middleware/require-admin.js'` | `'./middleware/require-admin.js'` |
| 8 | `'./domains/admin/index.js'` | `'./domains/admin/index.js'` |
| 9 | `'./domains/finders/public-routes.js'` | `'./domains/finders/public-routes.js'` |
| 10 | `'./domains/links/routes.js'` | `'./domains/links/routes.js'` |
| 11 | `'./domains/referrals/routes.js'` | `'./domains/referrals/routes.js'` |
| 12 | `'./domains/finder/routes.js'` | `'./domains/finder/routes.js'` |
| 13 | `'./domains/conversions/hmac-middleware.js'` | `'./domains/conversions/hmac-middleware.js'` |
| 14 | `'./domains/conversions/routes.js'` | `'./domains/conversions/routes.js'` |
| 15 | `'./domains/commissions/routes.js'` | `'./domains/commissions/routes.js'` |
| 16 | `'./domains/payouts/routes.js'` | `'./domains/payouts/routes.js'` |
| 17 | `'./domains/sales-ops/routes.js'` | `'./domains/sales-ops/routes.js'` |
| 18 | `'./domains/audit/routes.js'` | `'./domains/audit/routes.js'` |
| 19 | `'./jobs/nightly-job.js'` | `'./jobs/nightly-job.js'` |
| 20 | `'./routes/health.js'` | `'./routes/health.js'` |

```
$ diff old-spec.txt new-spec.txt
SPECIFIER ORDER IDENTICAL
```

`./env.js` moving from 4th to 1st is the one order change and it is inert: on `master` it was
already evaluated before every consumer that reads `env` at module scope (`app-auth.js` imports
`../env.js` itself, so `env.js` was a transitive dependency evaluated before `app-auth.js` either
way). Moving it earlier cannot change any observable order.

### (c) Bindings: all 25 originals preserved, exactly 3 added, none dropped.

```
$ diff old-bind.txt new-bind.txt
3a4  > assertLocalDatabase
10a12 > describeDatabaseTarget
18a21 > namedEnvFile
```

`serve`, `Hono`, `logger`, `env`, `corsMiddleware`, `errorMiddleware`, `appAuthMiddleware`,
`createAppAuthBff`, `requireAdmin`, `adminRouter`, `findersPublicRouter`, `linksRouter`,
`referralsRouter`, `finderRouter`, `hmacVerifyMiddleware`, `conversionsAdminRouter`,
`conversionsRouter`, `commissionsAdminRouter`, `commissionsRouter`, `payoutsAdminRouter`,
`payoutsRouter`, `salesOpsRouter`, `auditRouter`, `setupNightlyJob`, `healthRouter` - all present,
all spelled identically. The three additions are exactly the guard's two exports plus slice 01's
`namedEnvFile`.

All 21 old imports were NAMED imports, so destructuring the dynamic namespace object is semantically
equivalent; `type-check` (exit 0) and `build` (exit 0) confirm it.

### (d) `setupNightlyJob()` and `serve()`

Both still present and at the same point, inside the byte-identical tail:

```
apps/api/src/server.ts:151:  setupNightlyJob();
apps/api/src/server.ts:153:  const port = env.PORT;
apps/api/src/server.ts:154:  console.log(`[fxl-sales-api] listening on http://localhost:${port} (${env.NODE_ENV})`);
apps/api/src/server.ts:156:  serve({ fetch: app.fetch, port });
```

### One consequence checked, not assumed

`server.ts` is now an async module (top-level `await import`). Nothing imports it:

```
$ git grep -n "server.js'\|server.ts'" -- apps/api/src apps/api/test
(no matches)
```

It is only ever the process entrypoint, so there is no consumer whose evaluation could be deferred.

---

## The refusal proofs (graded by EXIT CODE)

### Remote, migrate arm

```
$ DATABASE_URL='postgresql://u:p@db.example.invalid:5432/fxl_sales' pnpm --filter @fxl-sales/api db:migrate; echo "exit=$?"
> tsx src/db/migrate.ts
◇ injected env (13) from .env
◇ injected env (0) from .env.local
[local-database-guard] DATABASE_URL points at the non-local host "db.example.invalid".
[local-database-guard] Only localhost, 127.0.0.1, ::1 and db run without an opt-in. Refusing to connect or migrate.
[local-database-guard] To target a remote environment on purpose, use the staging entrypoint: make stg
 ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  @fxl-sales/api@1.0.0 db:migrate: `tsx src/db/migrate.ts`
Exit status 1
exit=1
```

NON-ZERO. Three `[local-database-guard]` lines, naming `db.example.invalid` and naming `make stg`.
No driver error and no DNS failure appears, so the refusal is the guard's and precedes any socket.

### Remote, server arm - INCLUDING THE CRITICAL ORDERING ORACLE

```
$ pnpm --filter @fxl-sales/api build   (exit 0)
$ DATABASE_URL='postgresql://u:p@db.example.invalid:5432/fxl_sales' node apps/api/dist/server.js; echo "exit=$?"
◇ injected env (13) from apps/api/.env
◇ injected env (0) from apps/api/.env.local
[local-database-guard] DATABASE_URL points at the non-local host "db.example.invalid".
[local-database-guard] Only localhost, 127.0.0.1, ::1 and db run without an opt-in. Refusing to connect or migrate.
[local-database-guard] To target a remote environment on purpose, use the staging entrypoint: make stg
exit=1
```

NON-ZERO, and **`HubConfigError` never appears**. On this machine the API otherwise cannot boot at
all (see the local arm below, where the same binary throws `HubConfigError` two lines later). The
guard beat it. ORDERING ORACLE: PASS.

### Local, migrate arm

```
$ DATABASE_URL='postgresql://postgres:postgres@localhost:5006/fxl_sales' pnpm --filter @fxl-sales/api db:migrate
[fxl-sales-migrate] database host=localhost port=5006
Running migrations from ./drizzle
... (two Postgres 42P06/42P07 "already exists, skipping" NOTICEs)
Done.
exit=0
```

Exit 0, migrations applied, and the visibility line prints HOST AND PORT ONLY - no `postgres:postgres`,
no `fxl_sales`, no URL.

### Local, server arm

```
$ DATABASE_URL='postgresql://postgres:postgres@localhost:5006/fxl_sales' node apps/api/dist/server.js
◇ injected env (13) from apps/api/.env
[fxl-sales-api] database host=localhost port=5006
HubConfigError: hub-sdk: FXL_HUB_CONFIG.environment must be exactly one of "production", "staging" or "development"...
    at file:///.../apps/api/dist/middleware/app-auth.js:61:22
    at async file:///.../apps/api/dist/server.js:44:49
exit=1
```

`[fxl-sales-api] database host=localhost port=5006` prints BEFORE the `HubConfigError`. That
`HubConfigError` is the **pre-existing** stale-`.env` boot blocker described in the brief; it is not
this slice's, `apps/api/.env` was not opened or edited, and it arrives strictly after the guard.

Environment notes: `apps/api/.env.local` does not exist, and `loadEnvFiles` loads `.env` WITHOUT
`override`, so the `DATABASE_URL` supplied on the command line is the effective one in every run
above (visible in the printed host/port, which differ between the two arms).

---

## Properties A-J

| # | Property | Verdict | Evidence |
| --- | --- | --- | --- |
| A | `local-database-guard.ts` is PURE | PASS | `grep -nE "^import\|require\(\|process\.\|node:\|dotenv"` matches only three **comment** lines (5, 13, 92). Zero `import` statements, zero `process.env`, no fs, no dotenv, no `../env.js`. Every input is an argument. |
| B | The exported signatures are verbatim | PASS | `assertLocalDatabase(input: { nodeEnv: string; databaseUrl: string \| undefined; namedEnvFile: string \| null }): string[]`; `isLocalDatabaseHost(databaseUrl: string \| undefined): boolean`; `describeDatabaseTarget(databaseUrl: string \| undefined): { host: string; port: string } \| null`. Character-for-character the spec's. `databaseUrl` was NOT "tidied" to an optional property. |
| C | Exactly four local hosts, exact matching, brackets stripped | PASS | `const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', 'db'])` with `.has()` - no regex, no suffix, no fifth host. Roster pinned by the anti-vacuity test `covers exactly the four local hosts, and no more` (`toEqual(['localhost','127.0.0.1','::1','db'])`). Brackets: `new URL('postgresql://u:p@[::1]:5432/x').hostname` verified to be `"[::1]"` in node; the module strips them. **`::1` has its OWN named assertions outside the loop**: `accepts the bracketed IPv6 loopback form that new URL() produces` and `describeDatabaseTarget > unwraps the bracketed IPv6 host`. Non-vacuity proven by MUTATION (below). |
| D | The three-condition rule; unparseable must NOT violate | PASS | Proven by real mutation, each restored afterwards (below). Unparseable/absent pinned by `does not violate for a url that does not parse` and `does not violate for an absent url`; `violates in the test environment too` pins the production check as an EQUALITY. |
| E | Exactly two call sites, nothing in `env.ts` | PASS | `git grep -n 'assertLocalDatabase' -- apps/api/src` returns: the module (decl + 1 comment), the test, and exactly two call sites - `apps/api/src/server.ts:19` and `apps/api/src/db/migrate.ts:30`. `apps/api/src/env.ts` is not in the diff at all and contains no guard call. |
| F | Boot line = host and port only | PASS | Both templates are `host=${target.host} port=${target.port}`. Observed live: `[fxl-sales-api] database host=localhost port=5006` and `[fxl-sales-migrate] database host=localhost port=5006` - no user, no password, no database name, no URL. |
| G | `migrate.ts` DESTRUCTURES the existing `loadEnvFiles` call | PASS | The diff is `-loadEnvFiles({...})` / `+const { namedEnvFile } = loadEnvFiles({...})` - the call is kept, not deleted and not duplicated. `const nodeEnv` and `const url` are both read AFTER it, with a comment saying why. Proven live: the local migrate arm exits 0. |
| H | Opening paren on the same line at both sites | PASS | `apps/api/src/server.ts:19:const databaseViolations = assertLocalDatabase({` and `apps/api/src/db/migrate.ts:30:const databaseViolations = assertLocalDatabase({`. Slice 04's line filter will match both. |
| I | No real host or credential in the diff | PASS | `grep -nE "fxl-db-server\|tail89bca3\|100\.81\.240\.91\|SALES_ENV_FILE *="` over the diff: NONE. `SALES_ENV_FILE` appears twice, both in prose comments, never being SET. Fixtures are `db.example.invalid` and the literal `u:p`. |
| J | `git status --porcelain` has no `.env` | PASS | Only `M nexo/.../budget.json`, `?? .vscode/`, and two `?? nexo/runs/...` entries. No `.env`, no `.env.staging`. (`apps/api/.env.staging` exists on disk, is gitignored, and was never opened.) |

### The D mutations, run for real and reverted

Each mutation was applied to `apps/api/src/db/local-database-guard.ts`, the named oracle run, and
the file restored from a scratch backup. `git diff --quiet` confirmed clean restoration after each
and at the end (`FINAL RESTORED CLEAN`).

| mutation | result |
| --- | --- |
| drop the bracket-stripping (`const host = hostname`) | **4 failed / 20 passed** - including `isLocalDatabaseHost > accepts the local host '::1'`, `accepts the bracketed IPv6 loopback form that new URL() produces`, `describeDatabaseTarget > unwraps the bracketed IPv6 host`, `assertLocalDatabase > does not violate for the local host '::1'`. The `::1` case is NOT vacuous. |
| delete `if (input.namedEnvFile !== null) return [];` | RED: `× assertLocalDatabase > does not violate for a remote host when a named env file is in play` |
| delete `if (input.nodeEnv === 'production') return [];` | RED: `× assertLocalDatabase > does not violate in production` |
| delete `if (LOCAL_HOSTS.has(target.host)) return [];` | RED (4): `× does not violate for the local host 'localhost' / '127.0.0.1' / '::1' / 'db'` |

All three conditions of the rule are genuinely required and each is pinned by a differently-named
test.

---

## Housekeeping

No long-running process was left behind. The two `node apps/api/dist/server.js` runs each exited on
their own (exit 1) before binding a port; nothing was backgrounded, and no `pkill`/`killall` was
used. No database other than `localhost:5006` was contacted. `SALES_ENV_FILE` was never set;
`apps/api/.env` and `apps/api/.env.staging` were never read or edited.

---

# VERDICT: PASS

All four commands are green (test 478/478 exit 0, lint exit 0, type-check exit 0, build exit 0).
Both refusal proofs exit 1 with the three `[local-database-guard]` lines naming `db.example.invalid`
and `make stg`, and the server arm reaches the guard BEFORE the pre-existing `HubConfigError` -
the ordering oracle the slice exists for. Properties A through J all hold.

The `server.ts` restructure is the one risky change and it survives scrutiny: the ESM claim behind
it is true (confirmed by the offending top-level statement at `app-auth.ts:96`, by an independent
minimal ESM experiment, and by the live stack trace), the module-evaluation order is identical
specifier-for-specifier, every registration statement from `const app = new Hono();` onward is
byte-identical, all 25 original bindings survive with exactly three additions, and `setupNightlyJob()`
and `serve()` are untouched in place.

## Findings (non-blocking, recorded)

1. `server.ts` is now an async module. Nothing imports it today (verified), so there is no
   consumer to defer. If anything ever does import it, that import becomes async - worth a comment
   if the file is ever made importable.
2. The move of `./env.js` from static position 4 to position 1 is inert (it was already a
   transitive dependency of `app-auth.js`), but it is the one order change in the file and is not
   itself covered by any test.
3. Pre-existing, NOT this slice: `apps/api/.env` is stale against hub-sdk 2.3.0 and the API cannot
   complete a boot on this machine (`HubConfigError: FXL_HUB_CONFIG.environment ...`). Recorded
   because it means the server arm's proof stops at the guard rather than at a full boot.
