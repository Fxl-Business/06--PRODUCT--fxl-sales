# Wave 2 — integration gate (Gate 2, wave tier)

Verdict: **PASS**

- Repo: `/Users/cauetpinciara/Documents/fxl/projects/06--PRODUCT--fxl-sales`
- Branch: `master` @ `8f5660a`
- Slices integrated: `02-local-database-guard`, `03-staging-make-targets`
- Agent: wave-verify (separate from every implementer)
- Date: 2026-09-16

Note on method: `$PIPESTATUS` is a bash-ism and is empty under this host's zsh, so every
exit code below was captured with a plain `cmd > log 2>&1; echo "exit=$?"` rather than
through a pipe. The first type-check run reported an empty `exit=` for that reason and was
re-run; only the re-run is reported.

---

## 1. Full suite, full lint, type-check, build

### 1.1 `pnpm run type-check` — exit 0

```
> fxl-sales@1.0.0 type-check
> pnpm run build:packages && pnpm -r type-check

Scope: 4 of 5 workspace projects
packages/shared-types type-check: Done
packages/shared-utils type-check: Done
apps/api type-check$ tsc --noEmit
apps/web type-check$ tsc --noEmit
apps/api type-check: Done
apps/web type-check: Done
exit=0
```

### 1.2 `pnpm run lint` — exit 0

```
> fxl-sales@1.0.0 lint
> pnpm -r lint

packages/shared-types lint: no lint for shared-types
packages/shared-utils lint: no lint for shared-utils
apps/api lint$ eslint src/
apps/web lint$ eslint src/
apps/api lint: Done
apps/web lint: Done
exit=0
```

Zero warnings, zero errors on both linted workspaces.

### 1.3 `pnpm run test` — exit 0

The root script is `build:packages && pnpm -r --if-present test && node --test
scripts/__tests__/no-legacy-auth.test.mjs scripts/__tests__/no-legacy-env-names.test.mjs
&& node scripts/no-legacy-auth.mjs && node scripts/no-legacy-env-names.mjs && node
scripts/build-contract.mjs`. It is a `&&` chain, so exit 0 means every link ran and every
link was green.

| Workspace | Test files | Tests |
| --- | --- | --- |
| `packages/shared-utils` | 3 passed (3) | 80 passed (80) |
| `apps/api` | 46 passed (46) | 478 passed (478) |
| `apps/web` | 56 passed (56) | 784 passed (784) |
| **total** | **105** | **1342** |

Tail of the chain:

```
1..11
# tests 11
# suites 0
# pass 11
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 469.169125
build-contract: ok
exit=0
```

The two legacy-name guards (`node --test`, 11 subtests, 11 pass / 0 fail),
`no-legacy-auth.mjs`, `no-legacy-env-names.mjs` and `build-contract.mjs` (`build-contract:
ok`) all ran and all passed.

This wave's own new unit oracle is present and green inside the api suite:

```
apps/api test:  ✓ src/db/__tests__/local-database-guard.test.ts (24 tests) 4ms
apps/api test:  ✓ src/config/__tests__/env-files.test.ts (9 tests) 6ms
```

### 1.4 `pnpm run build` — exit 0

Packages, API and web all built. Web emitted its full asset graph, e.g.
`dist/assets/index-GDCgzJVC.js 262.79 kB │ gzip: 66.43 kB`, `✓ built in 1.75s`.
A second, isolated `pnpm --filter @fxl-sales/api build` for the refusal proof also exited 0.

---

## 2. Central acceptance criterion — the refusal, on the integrated trunk

Graded by **exit code**, never by message text. The only remote host used anywhere is
`db.example.invalid` (RFC 6761 reserved, unresolvable). No real host was contacted.

### 2.1 Migrate entrypoint, REMOTE `DATABASE_URL` — exit 1 ✅

```
DATABASE_URL='postgresql://u:p@db.example.invalid:5432/fxl_sales' pnpm --filter @fxl-sales/api db:migrate
```

```
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

Non-zero, names `db.example.invalid`, states the exit `make stg`. No connection attempted.

### 2.2 Server entrypoint, REMOTE `DATABASE_URL` — exit 1, and NO `HubConfigError` ✅

```
pnpm --filter @fxl-sales/api build && DATABASE_URL='postgresql://u:p@db.example.invalid:5432/fxl_sales' node apps/api/dist/server.js
```

```
build_exit=0
◇ injected env (13) from apps/api/.env
◇ injected env (0) from apps/api/.env.local
[local-database-guard] DATABASE_URL points at the non-local host "db.example.invalid".
[local-database-guard] Only localhost, 127.0.0.1, ::1 and db run without an opt-in. Refusing to connect or migrate.
[local-database-guard] To target a remote environment on purpose, use the staging entrypoint: make stg
exit=1
```

This is the **ordering property**, and it is the strong form: the guard's three lines are
the entire output, the process exits 1, and `HubConfigError` is never printed. The guard
therefore runs strictly BEFORE `./middleware/app-auth.js` is evaluated, so it protects
something rather than arriving after an unrelated failure has already killed the process.

### 2.3 Server entrypoint, LOCAL (as-configured) `DATABASE_URL` — announcement precedes the pre-existing boot blocker ✅

```
node apps/api/dist/server.js
```

```
◇ injected env (14) from apps/api/.env
◇ injected env (0) from apps/api/.env.local
[fxl-sales-api] database host=localhost port=5006      <-- line 3
file:///.../@fxl-business/hub-sdk/dist/chunk-DJ323EJE.js:4346
    throw new HubConfigError(
HubConfigError: hub-sdk: FXL_HUB_CONFIG.environment must be exactly one of "production",
  "staging" or "development". It is EXPLICIT configuration and is never inferred from the
  process environment.
    at parseHubConfig (.../chunk-DJ323EJE.js:4346:11)
    at loadHubConfig (.../chunk-DJ323EJE.js:4588:10)
    at loadHubAuthConfig (apps/api/dist/config/auth-provider.js:59:12)
    at tryLoadHubAuthConfig (apps/api/dist/config/auth-provider.js:68:12)
    at apps/api/dist/middleware/app-auth.js:61:22
    at async apps/api/dist/server.js:44:49
  { field: 'environment' }
exit=1
```

`[fxl-sales-api] database host=localhost port=5006` is printed BEFORE the `HubConfigError`,
as required. The `HubConfigError` itself is the **pre-existing, out-of-scope** operator-side
condition: this machine's untracked `apps/api/.env` is stale against
`@fxl-business/hub-sdk@2.3.0`. That file was not read, not edited and not "fixed"; it is
off-limits to this gate. The API's ability to serve `/health` was deliberately NOT graded.

The stack is itself corroborating evidence for slice 02's restructure: the throw arrives via
`async .../dist/server.js:44`, i.e. the dynamic `await import('./middleware/app-auth.js')`,
which is exactly the seam the slice introduced to get the guard in front of it.

### 2.4 Migrate entrypoint, LOCAL configuration — exit 0 ✅

```
pnpm --filter @fxl-sales/api db:migrate
```

```
> tsx src/db/migrate.ts
◇ injected env (14) from .env
◇ injected env (0) from .env.local
[fxl-sales-migrate] database host=localhost port=5006
Running migrations from ./drizzle
  NOTICE 42P06 schema "drizzle" already exists, skipping
  NOTICE 42P07 relation "__drizzle_migrations" already exists, skipping
Done.
exit=0
```

Exit 0 and the required `[fxl-sales-migrate] database host=localhost port=5006` line. The
only database touched by this gate at any point was the local `localhost:5006/fxl_sales`.

---

## 3. Make targets on the integrated trunk (dry run only)

### 3.1 `make help` — exit 0

Lists the three new staging targets alongside every pre-existing one:

```
stg             Interactive app selector for STAGING - pick api or web to run
front-stg       Run only the frontend against staging (reads apps/web/.env.staging)
back-stg        Run only the API against staging (reads apps/api/.env.staging)
```

Pre-existing targets all still listed: `dev front back install setup setup-no-db build
build-shared build-web build-api lint lint-fix type-check check doctor migrate db-up db-down
db-reset docker-up docker-down docker-build preview clean help`. Nothing was dropped.

### 3.2 `make -n back-stg` — exit 0

```
pnpm --filter @fxl-sales/shared-types build
pnpm --filter @fxl-sales/shared-utils build
SALES_ENV_FILE=.env.staging pnpm --filter @fxl-sales/api dev
```

Expected recipe: `build-shared` prerequisite, then the API dev server with the env file named
in front of the one command, exactly as documented.

### 3.3 `make -n front-stg` — exit 0

```
pnpm --filter @fxl-sales/web dev --mode staging
```

### 3.4 `make -n migrate-stg` — correctly absent

```
make: *** No rule to make target `migrate-stg'.  Stop.
exit=2
```

### 3.5 `make -n db-reset` — dry run only, NEVER run for real

```
node -e '...console.log("db-reset: migrations will target host "+host);'
docker compose down db -v
docker compose up db -d
echo "Waiting for PostgreSQL..."
sleep 3
/Library/.../make migrate
pnpm --filter @fxl-sales/api db:migrate
exit=0
```

The announcement line is present and is the recipe's FIRST line, ahead of `docker compose
down db -v`, so the host is visible while the prompt is still abortable. Reading the `node
-e` source: it derives `host = u.hostname + ":" + (u.port || "5432")` and prints only
`db-reset: migrations will target host <host:port>`. **No user, no password, no URL** — it
leaks nothing. Both failure paths degrade to a parenthesised `(unknown - ...)` string rather
than echoing the raw value.

`docker ps` was captured before and after the dry run and is byte-identical
(`06--product--fxl-sales-db-1 Up 23 minutes (healthy)`, plus two unrelated projects'
databases). Nothing was destroyed. The `$(MAKE) migrate` line does execute under `-n` by
GNU make's standard `$(MAKE)` semantics, but it recursed as a sub-make that inherited `-n`
and therefore only printed `pnpm --filter @fxl-sales/api db:migrate` without running it.

Observation, NOT a defect: `make -n stg` runs its `read choice` line and then fails with
`Invalid choice:` / `Error 1`, again because a recipe line containing `$(MAKE)` is always
executed under `-n`. This was checked against the pre-existing `make -n dev`, which fails
**identically** for the same reason. It is inherent to the interactive-selector shape that
slice 03 copied from `dev`, it is not a regression introduced by this wave, and both targets
work correctly when run interactively.

---

## 4. Security / secret-leak sweep on the integrated tree

### 4.1 Infrastructure hostnames — CLEAN

```
git grep -n -i -E 'fxl-db-server|tail89bca3\.ts\.net|100\.81\.240\.91' -- . ':(exclude)nexo'
exit=1   (no matches)
```

Nothing. The real staging host appears nowhere in the tracked tree.

### 4.2 `SALES_ENV_FILE` assignments — exactly one, as specified

The prescribed pattern `^\s*SALES_ENV_FILE=` returned **nothing**, which is a false
negative rather than a clean result: git's ERE does not honour the `\s` escape and the
Makefile recipe line begins with a literal TAB. Re-run with a POSIX class:

```
git grep -n -E '^[[:space:]]*SALES_ENV_FILE=' -- . ':(exclude)nexo'
Makefile:56:	SALES_ENV_FILE=.env.staging pnpm --filter @fxl-sales/api dev
exit=0
```

Exactly one assignment, and it is the single one inside the `back-stg` recipe. This is the
acceptable hit and the only one.

Every other occurrence of the bare name was then classified (unanchored grep, 30 hits):

| Location | Kind | Verdict |
| --- | --- | --- |
| `Makefile:56` | the one real assignment, in `back-stg` | acceptable, as specified |
| `Makefile:31`, `Makefile:42` | a comment and a `printf` help string | display text, not an assignment |
| `apps/api/.env.example`, `.env.dev.example`, `.env.staging.example` | commented usage docs, each `#`-prefixed | inert |
| `apps/api/src/config/env-files.ts`, `env.ts`, `db/migrate.ts`, `db/local-database-guard.ts` | the implementation and its prose | expected |
| `apps/api/src/config/__tests__/env-files.test.ts`, `fixtures/named-env-file.fixture` | the resolver oracle; passes the name in a **bag object**, never into `process.env` | correct by design |
| `apps/api/test/unit-setup.ts` | blanks the name for the whole unit suite | a protection, not a leak |

No shell profile, CI job or committed script exports it. The rule that it is only ever typed
by a human in front of one command holds on the integrated trunk.

### 4.3 Credentials embedded in Postgres URLs — all placeholders

```
git grep -n -E 'postgres(ql)?://[^[:space:]"'"'"']*:[^[:space:]"'"'"']*@' -- . ':(exclude)nexo'
```

49 hits, every one inspected and classified. They fall into exactly five groups and there is
no sixth:

| Credential | Host | Where | Verdict |
| --- | --- | --- | --- |
| `postgres:postgres` | `localhost:5006/fxl_sales` | `apps/api/.env.example:7`, `.env.dev.example:18`, `drizzle.config.ts:9` fallback, 5 × `src/middleware/__tests__/*` `vi.stubEnv`, 26 × `apps/api/test/rls/*` incl. `setup-env.ts` and `global-setup.ts` | local docker default, matches the committed compose file |
| `postgres:postgres` | `db:5432/fxl_sales` | `docker-compose.yml:11` | in-network docker service name |
| `u:p` | `localhost` / `127.0.0.1` / `[::1]` / `db` / `db.example.invalid` | 12 × `src/db/__tests__/local-database-guard.test.ts`, 1 × `src/db/local-database-guard.ts` comment | obvious throwaway fixtures; the only remote one is the RFC 6761 reserved `db.example.invalid` |
| `invalid:invalid` | `127.0.0.1:1/invalid` | `src/db/__tests__/migration-runner.test.ts:76` | deliberately unconnectable |
| `project_user:secret` | `localhost:5432/project_db` | `src/db/__tests__/single-role-db-contract.test.ts:35,37` | literal placeholder words, loopback |

Every host is `localhost`, `127.0.0.1`, `[::1]`, the docker service name `db`, or the
reserved `db.example.invalid`. **No real remote credential is present anywhere.**

### 4.4 `apps/api/.env.staging.example` — SHAPE ONLY ✅

Read in full. Its header states it plainly ("SHAPE ONLY. Every value below is intentionally
BLANK"). Every one of its 22 assignments is empty except three non-secret literals:
`NODE_ENV=production`, `PORT=3006` and the commented guidance. `CORS_ORIGIN=`,
`DATABASE_URL=`, `ADMIN_DATABASE_URL=`, `FXL_HUB_CONFIG=`, all five identity names, the
three operational names, `SALES_POST_LOGIN_REDIRECT=`,
`SALES_POST_LOGIN_ERROR_REDIRECT=`, `SALES_SESSION_ENCRYPTION_IKM=`,
`PUBLIC_LINK_BASE_URL=`, `SENTRY_DSN=`, `RESEND_API_KEY=`, `RESEND_FROM=` are **all blank**.
I state explicitly: it carries **no real host, no URL, no credential and no token**.
It also correctly omits `FXL_HUB_SESSION_ENCRYPTION_KEY`, per the CLAUDE.md contract.

### 4.5 `apps/web/.env.staging.example` — SHAPE ONLY ✅

Read in full. Blank: `VITE_API_URL=`, `VITE_AUTH_PROXY_TARGET=`,
`VITE_AUTH_BFF_BASE_PATH=`, `VITE_FXL_HUB_API_URL=`, `VITE_SENTRY_DSN=`. The only two filled
values are the non-secret public identifiers `VITE_FXL_HUB_ENVIRONMENT=staging` and
`VITE_FXL_HUB_AUDIENCE=app.fxl-sales`, both of which CLAUDE.md documents as the public
Client naming pair and neither of which is a credential. I state explicitly: it carries
**no real host, no URL, no credential and no token**. Its comment correctly records that the
browser holds no key as of SDK 2.2.0.

### 4.6 Working tree and index — no env file present or tracked ✅

```
git status --porcelain | grep -E '\.env'   ->  NONE
git ls-files apps/api/.env apps/web/.env apps/api/.env.staging apps/web/.env.staging
                                           ->  (empty, all untracked)
git check-ignore -v ...
  .gitignore:4:.env               apps/api/.env
  .gitignore:13:**/.env.staging   apps/api/.env.staging
  .gitignore:13:**/.env.staging   apps/web/.env.staging
```

`git status --porcelain` shows only this run's own `nexo/` artefacts and an untracked
`.vscode/`. No `.env` and no `.env.staging` anywhere in it. `apps/api/.env.staging` was
never opened.

---

## 5. Integration-specific regression check — registration order

Slice 02 restructured `apps/api/src/server.ts` to statically import only `./env.js` and the
guard, then pull every other module through `await import(...)`. Registration order there is
semantically load-bearing (the admin conversions group must mount BEFORE the finder group so
`/admin/*` never falls through), so it was verified independently against pre-feature
`master`.

```
git show 22a08a1:apps/api/src/server.ts   ->  111 lines
apps/api/src/server.ts (merged trunk)     ->  156 lines
diff -u  ->  ONE hunk, @@ -1,25 +1,70 @@ — the import prologue only
```

The diff contains a single hunk and it ends at `const app = new Hono();`. Isolating
everything from that line onward:

```
sed -n '/^const app = new Hono();/,$p' old > body.old   (89 lines)
sed -n '/^const app = new Hono();/,$p' new > body.new   (89 lines)
diff -u body.old body.new
body_diff_exit=0   (IDENTICAL)
```

**The entire registration body is byte-identical.** The mount sequence was also extracted
and compared independently; all 30 `app.use` / `app.route` / `app.get` / `app.notFound`
calls appear in the same relative order, shifted only by the +45-line prologue:

| # | old line | new line | call |
| --- | --- | --- | --- |
| 1-3 | 25-27 | 70-72 | `logger`, `corsMiddleware`, `errorMiddleware` on `*` |
| 4 | 29 | 74 | `/health` |
| 5 | 33 | 78 | `''` (auth BFF) |
| 6 | 39 | 84 | `/api/v1/finders` |
| 7-9 | 45-47 | 90-92 | conversions hmac + router |
| 10-11 | 50-51 | 95-96 | **`/api/v1/admin/conversions`** |
| 12 | 55 | 100 | `/api/v1/admin` |
| 13-16 | 61-64 | 106-109 | admin//commissions |
| 17-20 | 67-70 | 112-115 | admin/payouts |
| 21-22 | 74-75 | 119-120 | `/api/v1/sales-ops` |
| 23-24 | 78-79 | 123-124 | `/api/v1/admin/audit` |
| 25-26 | 86-87 | 131-132 | `/api/v1/links` |
| 27 | 90 | 135 | `/r` |
| 28-29 | 93-94 | 138-139 | **`/api/v1/finder`** |
| 30-31 | 96, 103 | 141, 148 | `/`, `notFound` |

The load-bearing property holds: `/api/v1/admin/conversions` (rows 10-11) still mounts
before `/api/v1/finder` (rows 28-29), and `/api/v1/admin` still mounts after the more
specific admin conversions group.

The dynamic `await import` sequence also reproduces the old static import list in its
original order (`@hono/node-server`, `hono`, `hono/logger`, cors, error, app-auth,
require-admin, admin, finders, links, referrals, finder, conversions/hmac,
conversions/routes, commissions, payouts, sales-ops, audit, nightly-job, health), so module
side-effect order is preserved too. The one module that moved is `./env.js`, promoted to a
static import ahead of everything; it is pure with respect to the database (env-file
resolution plus a zod parse), so nothing observable changed.

**No integration bug found.**

---

## 6. Process hygiene

Both server runs were launched with an explicit watchdog and reaped by exact PID
(`kill -9 $SRV` on a 25s timer, `kill $WD` afterwards); both in fact exited on their own
before the watchdog fired. `pgrep -f 'apps/api/dist/server.js'` afterwards returns nothing.
No `pkill`/`killall` by name was used at any point, which matters on this machine because
`docker ps` shows two unrelated projects' databases running alongside this one. No file in
the repository was created or modified by this gate except this report and the result JSON.

---

## Verdict

**PASS.**

1. `type-check`, `lint`, `test` and `build` are all exit 0; 1342 workspace tests across 105
   files, plus all three guard scripts and the 11 `node --test` subtests, green.
2. Both refusal proofs exit non-zero with correct `[local-database-guard]` lines naming
   `db.example.invalid` and stating `make stg`; the server arm prints the guard and
   **never** reaches `HubConfigError`, proving the ordering. Both local-configuration arms
   print their `host=localhost port=5006` announcement, migrate exits 0, and the server's
   announcement precedes the pre-existing out-of-scope Hub boot blocker.
3. Make targets are exactly as specified: `stg`/`back-stg`/`front-stg` present in `help`
   with the expected recipes, `migrate-stg` absent, `db-reset` announcement present and
   leaking nothing.
4. Security sweep clean: no infrastructure hostnames, exactly one `SALES_ENV_FILE`
   assignment (in `back-stg`), all 49 Postgres URLs are localhost/docker/test placeholders,
   both `.env.staging.example` files are shape-only, and no `.env` is tracked or staged.
5. Registration order in `server.ts` is byte-identical to pre-feature `master`.

### Findings carried forward (none blocking)

- **F1 (out of scope, pre-existing).** This machine's untracked `apps/api/.env` is stale
  against `@fxl-business/hub-sdk@2.3.0`: `FXL_HUB_CONFIG.environment must be exactly one of
  "production", "staging" or "development"`. The API cannot fully boot locally until an
  operator refreshes that file. Not touched by this gate, not caused by this wave, and it
  does not affect any graded property.
- **F2 (cosmetic, pre-existing).** `make -n stg` executes its `read` line and exits 2, by
  GNU make's rule that a recipe line containing `$(MAKE)` always runs. `make -n dev` behaves
  identically, so slice 03 inherited the shape rather than introducing a defect. Both work
  interactively. Worth knowing only so a future dry run is not misread as a failure.
- **F3 (documentation nit).** The `^\s*SALES_ENV_FILE=` pattern in the wave-verify brief
  silently returns nothing under git's ERE, because `\s` is not honoured and the Makefile
  line is tab-indented. Any future gate reusing that pattern should spell it
  `^[[:space:]]*` or it will report a clean sweep without having looked.
