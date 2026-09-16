# Wave 3 verify - FINAL feature gate (Gate 2, full tier)

Feature: `feature-20260916-local-db-guard`
Branch: `master` at `ffb5245`, all four slices merged.
Agent: wave-verify (separate from every implementer).
Scope: the FEATURE'S acceptance criteria as a whole, not this wave's diff alone.

---

## Criterion 1 - `pnpm run type-check` and `pnpm run lint` are green

### `pnpm run type-check`

```
> pnpm run build:packages && pnpm -r type-check
Scope: 4 of 5 workspace projects
packages/shared-types type-check: Done
packages/shared-utils type-check: Done
apps/api type-check: Done
apps/web type-check: Done
exit=0
```

### `pnpm run lint`

```
> pnpm -r lint
apps/api lint$ eslint src/   -> Done
apps/web lint$ eslint src/   -> Done
packages/shared-types lint: no lint for shared-types
packages/shared-utils lint: no lint for shared-utils
exit=0
```

Also run for completeness, `pnpm run build`: `exit=0` (shared packages, api tsc, web vite `built in 5.48s`).

**MET.**

---

## Criterion 2 - `pnpm run test` is green with the local database up, INCLUDING `no-legacy-auth` and `no-legacy-env-names`

Local Postgres confirmed up first:

```
06--product--fxl-sales-db-1  postgres:16-alpine  Up 29 minutes (healthy)  0.0.0.0:5006->5432/tcp
Connection to localhost port 5006 succeeded
```

`pnpm run test` -> **`exit=0`**.

Workspace suites, read out of the real output:

| Workspace | Files | Tests |
| --- | --- | --- |
| `packages/shared-utils` | 3 passed (3) | 80 passed (80) |
| `apps/api` | 46 passed (46) | 478 passed (478) |
| `apps/web` | 56 passed (56) | 784 passed (784) |

The `node --test` block ran all THREE guard files in ONE invocation, 21 subtests, `# pass 21 # fail 0`.
The three files are accounted for by name and by count (`test(` call counts: 3 / 8 / 10 = 21):

- `scripts/__tests__/local-database-guard.test.mjs` - subtests 1-10
  (`both inspected files exist and are readable`, `the inspected files are the real entrypoints, not empty or substituted`,
  `apps/api/src/server.ts invokes assertLocalDatabase`, `apps/api/src/db/migrate.ts invokes assertLocalDatabase`,
  `apps/api/src/db/migrate.ts has no raw dotenv/config import`, `an unmutated fixture passes (positive control)`,
  `FAILS when server.ts stops invoking the guard`, `FAILS when migrate.ts stops invoking the guard`,
  `FAILS when migrate.ts regains a raw dotenv/config import`, `FAILS when an inspected file is missing`)
- `scripts/__tests__/no-legacy-auth.test.mjs` - subtests 11-13
- `scripts/__tests__/no-legacy-env-names.test.mjs` - subtests 14-21

The three standalone guard scripts then ran in the `&&` chain (the chain reaching `exit=0` is itself the proof each one exited 0):

```
... && node scripts/no-legacy-auth.mjs && node scripts/no-legacy-env-names.mjs && node scripts/build-contract.mjs
build-contract: ok
```

`no-legacy-auth.mjs` and `no-legacy-env-names.mjs` are silent on success; `build-contract.mjs` printed `build-contract: ok`.

**MET.**

---

## Criterion 3 - remote `DATABASE_URL` + no named env file REFUSES, naming the host, PROVEN BY EXIT CODE

Remote fixture used throughout: `db.example.invalid` (RFC 6761 reserved, unresolvable). No real host was ever contacted.
`SALES_ENV_FILE` was never set.

### Arm A - the migrate entrypoint

```
$ DATABASE_URL='postgresql://u:p@db.example.invalid:5432/fxl_sales' pnpm --filter @fxl-sales/api db:migrate
[local-database-guard] DATABASE_URL points at the non-local host "db.example.invalid".
[local-database-guard] Only localhost, 127.0.0.1, ::1 and db run without an opt-in. Refusing to connect or migrate.
[local-database-guard] To target a remote environment on purpose, use the staging entrypoint: make stg
ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL @fxl-sales/api@1.0.0 db:migrate
exit=1
```

Non-zero. Host named. `make stg` stated. No `Running migrations from ./drizzle` line, so nothing connected.

### Arm B - the built server entrypoint

```
$ pnpm --filter @fxl-sales/api build   (already green under `pnpm run build`)
$ DATABASE_URL='postgresql://u:p@db.example.invalid:5432/fxl_sales' node apps/api/dist/server.js
[local-database-guard] DATABASE_URL points at the non-local host "db.example.invalid".
[local-database-guard] Only localhost, 127.0.0.1, ::1 and db run without an opt-in. Refusing to connect or migrate.
[local-database-guard] To target a remote environment on purpose, use the staging entrypoint: make stg
exit=1
```

**The ORDERING requirement is satisfied.** `HubConfigError` NEVER printed. The guard spoke and the process died
before `./middleware/app-auth.js` was ever reached - which is exactly what `server.ts`'s two-static-import /
everything-else-dynamic structure exists to buy. (The stale `apps/api/.env` is pre-existing and out of scope; it
was not read beyond this, not edited, not "fixed".)

### Specificity - the guard is not a blanket refusal

```
$ DATABASE_URL='postgresql://postgres:postgres@localhost:5006/fxl_sales' pnpm --filter @fxl-sales/api db:migrate
[fxl-sales-migrate] database host=localhost port=5006
Running migrations from ./drizzle
Done.
exit=0
```

No `[local-database-guard]` line, migrations applied, exit 0.

**MET.**

---

## Criterion 4 - exactly ONE boot line naming HOST and PORT, never a user, password or whole URL

Judged under the documented `NODE_ENV !== 'production'` qualifier, which both emitters spell explicitly.

### Emitting code

`apps/api/src/db/migrate.ts`:

```ts
const target = describeDatabaseTarget(url);
if (nodeEnv !== 'production') {
  console.log(
    target
      ? `[fxl-sales-migrate] database host=${target.host} port=${target.port}`
      : '[fxl-sales-migrate] database target unknown - DATABASE_URL does not parse',
  );
}
```

`apps/api/src/server.ts`:

```ts
if (env.NODE_ENV !== 'production') {
  const target = describeDatabaseTarget(env.DATABASE_URL);
  console.log(
    target
      ? `[fxl-sales-api] database host=${target.host} port=${target.port}`
      : '[fxl-sales-api] database target unknown - DATABASE_URL is absent or does not parse',
  );
}
```

`describeDatabaseTarget` returns `{host, port}` ONLY - it is a thin projection of `parseDatabaseTarget`, which
never returns the username, password, or pathname. There is no other interpolation site. An omitted port is
reported as `5432`, which is what the driver will actually dial.

### Observed output, local configuration

Migrate entrypoint:

```
$ grep -c 'fxl-sales-migrate' mig-local.log  ->  1
7:[fxl-sales-migrate] database host=localhost port=5006
$ grep -E 'postgres:postgres|postgresql://|password' mig-local.log  ->  no url/user/password in output
```

Server entrypoint:

```
$ grep -c 'fxl-sales-api] database' srv-local.log  ->  1
3:[fxl-sales-api] database host=localhost port=5006
$ grep -E 'postgres:postgres|postgresql://' srv-local.log  ->  no url/user/password in output
```

Exactly one line each, host and port only, no user, no password, no database name, no whole URL.
The server then died on the pre-existing, out-of-scope `HubConfigError: FXL_HUB_CONFIG.environment must be ...`
from the stale untracked `apps/api/.env` - AFTER the boot line, which is the correct ordering.

**MET.**

---

## Criterion 5 - no tracked file gained a credential, a remote database URL or a secret

Note on method: every "must return nothing" grep below uses POSIX `[[:space:]]`, never `\s`, because `git grep`'s
ERE does not honour `\s` and a `\s` pattern reports "clean" without having looked. Each has a positive control.

### A. Remote host identifiers - must return NOTHING

```
$ git grep -n -i -E 'fxl-db-server|tail89bca3\.ts\.net|100\.81\.240\.91' -- . ':(exclude)nexo'
(no output)   grep-exit=1
```

Positive control, SAME pattern with the `nexo` exclusion dropped - it does still find hits, so the pattern works:

```
$ git grep -n -i -E 'fxl-db-server|tail89bca3\.ts\.net|100\.81\.240\.91' -- .
nexo/knowledge/decisions/2026-07-29-integration-tests-are-hermetic-local.md:5: ... @fxl-db-server:5432/fxl_sales_stg_db ...
nexo/milestones/v4.0.0/SUMMARY.md:80: ... `fxl-db-server` IS resolvable ...
nexo/plans/feature-20260916-local-db-guard/00-OVERVIEW.md:13,14,73
control-exit=0
```

Every hit is inside `nexo/`, which is documentation of the incident and is deliberately excluded. Outside `nexo/`
the tracked tree names no remote host at all. CLEAN.

### B. `SALES_ENV_FILE` assignments

```
$ git grep -n -E '^[[:space:]]*SALES_ENV_FILE=' -- . ':(exclude)nexo'
Makefile:56:	SALES_ENV_FILE=.env.staging pnpm --filter @fxl-sales/api dev
```

EXACTLY ONE hit, and it is the single assignment in the `back-stg` recipe - the only acceptable one.

Positive control / classification of every other occurrence of the bare name outside `nexo/`:

| Location | Classification |
| --- | --- |
| `Makefile:31`, `Makefile:42` | comment / `printf` help text, not an assignment |
| `Makefile:56` | **the one real assignment**, `back-stg` recipe - ACCEPTABLE |
| `apps/api/.env.dev.example:23,27,31` | `#`-prefixed prose + a commented example command |
| `apps/api/.env.example:9,13,17` | `#`-prefixed prose + a commented example command |
| `apps/api/.env.staging.example:12,20` | `#`-prefixed prose |
| `apps/api/src/config/__tests__/env-files.test.ts:2,5,33,43,44,48,54,75,85` | the resolver's own oracle; it passes the name as a literal object key in a bag, and its header states it never writes the name into `process.env` |

No committed script, CI job or shell profile exports it. CLEAN.

### C. Credentialed `postgres://` URLs - every hit inspected

```
$ git grep -n -E 'postgres(ql)?://[^[:space:]"'\'']*:[^[:space:]"'\'']*@' -- . ':(exclude)nexo'
```

All 46 hits, classified - every one a localhost / docker / test placeholder:

- `postgres:postgres@localhost:5006/fxl_sales` (the documented local Docker credential, published in
  `docker-compose.yml` itself): `apps/api/.env.dev.example:18`, `apps/api/.env.example:7`,
  `apps/api/drizzle.config.ts:9`, `apps/api/src/middleware/__tests__/app-auth-access-gate.test.ts:89`,
  `app-auth-bff-production-boot.test.ts:97`, `app-auth-bff-wiring.test.ts:118`, `app-auth-partial-config.test.ts:35`,
  `app-auth-unconfigured.test.ts:24`, and 28 files under `apps/api/test/rls/**` (areas, audit-history-org-scope,
  cadastro-archive-audit, cadastro-purge, client-legal-fields, conversion-ingest, conversion-webhook-contract,
  conversions-commissions, cross-tenant, funcoes-concurrency, funcoes-rls, funcoes-schema-migration, global-setup,
  hub-bff-login-supersede, hub-bff-session-store, list-finder-links-cross-tenant, product-commission-contract,
  product-funcao-costs-rls, produtos-servicos-schema-migration, professional-payable-migration.integration,
  proposal-schema-migration, proposal-write, referral-links-public-lookup, sale-professional-funcoes, setup-env x2).
- `postgres:postgres@db:5432/fxl_sales` - `docker-compose.yml:11`, the compose service name.
- `u:p@db.example.invalid:5432/fxl_sales` and the `u:p@localhost|127.0.0.1|[::1]|db` fixtures -
  `apps/api/src/db/__tests__/local-database-guard.test.ts:15,20-23,47,48,56,63,69,76` and one doc comment at
  `apps/api/src/db/local-database-guard.ts:36`. `u:p` is a literal placeholder; `.invalid` is RFC 6761 reserved.
- `invalid:invalid@127.0.0.1:1/invalid` - `apps/api/src/db/__tests__/migration-runner.test.ts:76`.
- `project_user:secret@localhost:5432/project_db` - `apps/api/src/db/__tests__/single-role-db-contract.test.ts:35,37`,
  a synthetic placeholder on loopback.

No remote host, no real credential. CLEAN.

### D. The two staging examples, read IN FULL

`apps/api/.env.staging.example` (74 lines) - **SHAPE ONLY.** Its own header says so
(`SHAPE ONLY. Every value below is intentionally BLANK ... no host, no user, no password, no URL, no token, ever.`).
Every credential-bearing key is empty: `CORS_ORIGIN=`, `DATABASE_URL=`, `ADMIN_DATABASE_URL=`, `FXL_HUB_CONFIG=`,
`FXL_HUB_API_URL=`, `FXL_HUB_ENVIRONMENT=`, `FXL_HUB_CLIENT_ID=`, `FXL_HUB_CLIENT_SECRET=`, `FXL_HUB_AUDIENCE=`,
`FXL_HUB_HEALTH_TOKEN=`, `FXL_HUB_REDIRECT_URI=`, `FXL_HUB_TRUSTED_ORIGINS=`, `SALES_POST_LOGIN_REDIRECT=`,
`SALES_POST_LOGIN_ERROR_REDIRECT=`, `SALES_SESSION_ENCRYPTION_IKM=`, `PUBLIC_LINK_BASE_URL=`, `SENTRY_DSN=`,
`RESEND_API_KEY=`, `RESEND_FROM=`. The only two non-blank values are `NODE_ENV=production` and `PORT=3006` -
neither is a credential, a host or a secret.

`apps/web/.env.staging.example` (20 lines) - **SHAPE ONLY.** `VITE_API_URL=`, `VITE_AUTH_PROXY_TARGET=`,
`VITE_AUTH_BFF_BASE_PATH=`, `VITE_FXL_HUB_API_URL=`, `VITE_SENTRY_DSN=` all blank. The two non-blank values are
`VITE_FXL_HUB_ENVIRONMENT=staging` and `VITE_FXL_HUB_AUDIENCE=app.fxl-sales` - public, non-secret Client
identifiers that `CLAUDE.md` documents as the browser-side naming of the Client, and the file states outright that
the browser holds NO key as of hub-sdk 2.2.0.

### E. No tracked real env file

```
$ git ls-files apps/api/.env apps/web/.env apps/api/.env.staging apps/web/.env.staging
(no output)
```

Positive control - tracked env EXAMPLES do exist, so `git ls-files` is looking in the right place:

```
$ git ls-files 'apps/*/.env*'
apps/api/.env.dev.example
apps/api/.env.example
apps/api/.env.staging.example
apps/web/.env.dev.example
apps/web/.env.example
apps/web/.env.staging.example
```

`.gitignore:12-13` carry `.env.staging` and `**/.env.staging`.

### F. The feature diff itself

Base `22a08a1` (parent of slice 01) to `HEAD`, tracked files outside `nexo/`: 16 files, +1051 / -33.
Every ADDED line matching `postgres(ql)?://|SECRET|PASSWORD|TOKEN=|KEY=|api_key|@<domain>` was inspected; each is
either a BLANK key in an example file (`FXL_HUB_CLIENT_SECRET=`, `FXL_HUB_HEALTH_TOKEN=`, `RESEND_API_KEY=`), a
`u:p@...` / `localhost` test fixture, or prose forbidding the printing of a password. Nothing was gained.

**MET.**

---

## Criterion 6 - `git status --porcelain` shows no local `.env` and no `.env.staging`

```
$ git status --porcelain
 M nexo/runs/feature-20260916-local-db-guard/AUDIT.md
 M nexo/runs/feature-20260916-local-db-guard/budget.json
?? .vscode/
?? nexo/runs/feature-20260916-local-db-guard/agents/{exec-02,exec-03,exec-04,verify-02,verify-03,verify-04,wave-2-verify}.result.json
?? nexo/runs/feature-20260916-local-db-guard/{exec-02,exec-03,exec-04}-notes.md
?? nexo/runs/feature-20260916-local-db-guard/{verify-02,verify-03,verify-04}.md
?? nexo/runs/feature-20260916-local-db-guard/wave-verify-2.md
```

No `.env`, no `.env.staging`, no stray fixture directory anywhere in the output. Every entry is a `nexo/` run
artefact, except `.vscode/`, which is an untracked editor directory that predates this run (it is present in the
session-start status snapshot) and is not a fixture of this feature.

The real files DO exist on disk and are correctly IGNORED rather than untracked:

```
$ git status --porcelain --ignored=matching -- 'apps/api/.env*' 'apps/web/.env*'
!! apps/api/.env
!! apps/api/.env.staging
!! apps/web/.env
```

`!!` is the ignored marker - these never reach `--porcelain`'s default output and can never be staged by accident.
Neither `apps/api/.env` nor `apps/api/.env.staging` was opened, read or modified by this verification.

**MET.**

---

## Feature-level coherence checks

### `assertLocalDatabase` - exactly the module, its test, and TWO call sites; nothing in `env.ts`

```
$ git grep -n 'assertLocalDatabase' -- apps/api/src
apps/api/src/db/__tests__/local-database-guard.test.ts   (the unit test)
apps/api/src/db/local-database-guard.ts:106              (the definition, + one doc mention at :81)
apps/api/src/db/migrate.ts:2,30                          (call site 1)
apps/api/src/server.ts:11,19                             (call site 2)
```

Four files, exactly as specified.

```
$ grep -n -E 'assertLocalDatabase|local-database-guard' apps/api/src/env.ts  ->  exit=1 (clean)
```

`env.ts` carries only `export const { namedEnvFile } = loadEnvFiles({ baseDir: API_ROOT_DIR, bag: process.env })`,
which is the shared resolver seam, not the guard. The guard module's own header records WHY it is not in `env.ts`:
`env.ts` is imported by the unit suite, and an assertion there would make the whole suite environment-dependent.
HOLDS.

### `make -n migrate-stg` still fails

```
$ make -n migrate-stg
make: *** No rule to make target `migrate-stg'.  Stop.
exit=2
```

Dry run only. No such target, as the Makefile's own comment block insists (`There is deliberately NO migrate-stg
target, and none is to be added.`). HOLDS.

### `make -n db-reset` - DRY RUN ONLY, never executed for real

```
$ make -n db-reset
node -e '...console.log("db-reset: migrations will target host "+host);'
docker compose down db -v
docker compose up db -d
echo "Waiting for PostgreSQL..."
sleep 3
make migrate
pnpm --filter @fxl-sales/api db:migrate
```

The announcement node one-liner is the FIRST recipe line, before `docker compose down db -v`, so the target host is
on screen before anything is destroyed. It prints `hostname + ":" + (port || "5432")` and nothing else - no user, no
password, no URL - and degrades to a parenthesised `(unknown - ...)` string on a missing or unparseable value.
`make db-reset` was NEVER run for real. HOLDS.

### The four local hosts are all still accepted, each by its own named assertion

`apps/api/src/db/__tests__/local-database-guard.test.ts` drives a `localHostCases` table of exactly four rows and
runs it through `it.each` twice, so each host gets its own NAMED test title in both directions:

- `isLocalDatabaseHost` -> `accepts the local host localhost` / `... 127.0.0.1` / `... ::1` / `... db`
- `assertLocalDatabase` -> `does not violate for the local host localhost` / `... 127.0.0.1` / `... ::1` / `... db`

An anti-vacuity assertion guards the table itself, so an emptied, shortened or renamed table cannot pass silently:

```ts
it('covers exactly the four local hosts, and no more', () => {
  expect(localHostCases.map((c) => c.hostLabel)).toEqual(['localhost', '127.0.0.1', '::1', 'db']);
});
```

Backed in the implementation by `const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', 'db'])` with EXACT
`Set.has` matching, pinned negatively by `rejects a host that only looks local`
(`localhost.db.example.invalid`, `notlocalhost`), and by the IPv6 bracket-stripping test
(`accepts the bracketed IPv6 loopback form that new URL() produces`) which is what keeps `::1` from silently
reading as remote. HOLDS.

### Additional structural notes

- The production exemption is pinned as an EQUALITY on `'production'`, not an inequality on `'development'`, by
  `violates in the test environment too`.
- The escape hatch is pinned as single: `does not violate for a remote host when a named env file is in play`, with
  a plain string literal - no file created, no variable set.
- An unparseable URL is deliberately NOT a violation, pinned by two tests, so the guard answers one question only.
- `scripts/__tests__/local-database-guard.test.mjs` makes the wiring structurally irremovable and is non-vacuous:
  it carries a positive control (`an unmutated fixture passes`) AND four mutation tests that each go red when a
  call site, the dotenv ban, or an inspected file is removed.

---

## No processes left running

Every command run here was foreground and run-once. No dev server, watcher or background job was started, so
nothing needed to be killed. No `pkill` or `killall` was used at any point.

## Prohibitions honoured

- No database other than local Postgres `localhost:5006` was connected to, read or written.
- `fxl-db-server` and `tail89bca3.ts.net` were never used. The only remote fixture was `db.example.invalid`.
- `SALES_ENV_FILE` was never set. `apps/api/.env.staging` was never opened.
- No file was edited. `apps/api/.env` was not read beyond the guard's own boot output.
- `make db-reset` was never run; only `make -n`.

---

## VERDICT: **PASS**

All six acceptance criteria are MET - criterion 4 judged under the documented `NODE_ENV !== 'production'`
qualifier - and every feature-level coherence check holds.

The central criterion is proven BOTH ways by process exit code, never by message text: the migrate entrypoint and
the built server entrypoint each exit non-zero on a remote `DATABASE_URL` with no named env file, each printing the
three `[local-database-guard]` lines that name `db.example.invalid` and state the exit `make stg`; the server arm
prints them BEFORE the pre-existing `HubConfigError`, which never appears at all. The refusal is specific, not
blanket: the same command against `localhost:5006` prints one host-and-port line and exits 0 having applied
migrations.

One out-of-scope condition is recorded and does not affect the verdict: the untracked `apps/api/.env` on this
machine is stale against `@fxl-business/hub-sdk@2.3.0`, so `node apps/api/dist/server.js` cannot complete a boot
locally. That is pre-existing, is explicitly outside this feature, and is visible only AFTER the guard and the
boot-visibility line have both done their work.
