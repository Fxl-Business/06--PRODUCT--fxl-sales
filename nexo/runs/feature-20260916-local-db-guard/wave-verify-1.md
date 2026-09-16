# Wave 1 — integration verify (Gate 2, wave tier)

- Repo: `/Users/cauetpinciara/Documents/fxl/projects/06--PRODUCT--fxl-sales`
- Branch: `master`
- Integrated commit: `2facf27` (merge of slice `01-env-file-resolution`)
- Date: 2026-09-16
- Tier: FULL — full suite, full lint, security check, plus the integration-specific checks A/B/C.

## VERDICT: **FAIL**

Checks 1-4 are all green.
Check A is green.
Check C holds.
**Check B fails: the API does not boot against the repository's own configured local environment.**

The cause is isolated below and is **NOT** slice 01's code — it is the untracked, stale
`apps/api/.env`, which still carries the retired `FXL_HUB_PUBLISHABLE_KEY` /
`FXL_HUB_SECRET_KEY` names and none of the five canonical Hub identity variables.
The verdict is nonetheless FAIL, because the wave-tier gate's stated condition is that the
integrated trunk boots, and on this machine it does not.

---

## 1. `pnpm run type-check`

**Exit code: 0**

```
> fxl-sales@1.0.0 type-check
> pnpm run build:packages && pnpm -r type-check

> @fxl-sales/shared-types@1.0.0 build — tsc --build --force
> @fxl-sales/shared-utils@1.0.0 build — tsc --build --force

Scope: 4 of 5 workspace projects
packages/shared-types type-check$ tsc --noEmit
packages/shared-utils type-check$ tsc --noEmit
packages/shared-types type-check: Done
packages/shared-utils type-check: Done
apps/web type-check$ tsc --noEmit
apps/api type-check$ tsc --noEmit
apps/api type-check: Done
apps/web type-check: Done
```

GREEN.

## 2. `pnpm run lint`

**Exit code: 0**

```
> fxl-sales@1.0.0 lint
> pnpm -r lint

Scope: 4 of 5 workspace projects
packages/shared-types lint: no lint for shared-types — Done
packages/shared-utils lint: no lint for shared-utils — Done
apps/api lint$ eslint src/
apps/web lint$ eslint src/
apps/api lint: Done
apps/web lint: Done
```

GREEN. Zero warnings, zero errors.

## 3. `pnpm run test`

**Exit code: 0**

Script actually run:

```
pnpm run build:packages && pnpm -r --if-present test \
  && node --test scripts/__tests__/no-legacy-auth.test.mjs scripts/__tests__/no-legacy-env-names.test.mjs \
  && node scripts/no-legacy-auth.mjs && node scripts/no-legacy-env-names.mjs && node scripts/build-contract.mjs
```

Results:

| Workspace / guard | Files | Tests | Result |
| --- | --- | --- | --- |
| `packages/shared-utils` | 3 passed (3) | 80 passed (80) | pass |
| `apps/api` | 45 passed (45) | 454 passed (454) | pass |
| `apps/web` | 56 passed (56) | 784 passed (784) | pass |
| `node --test` legacy-name guards | — | 11 pass / 0 fail | pass |
| `scripts/no-legacy-auth.mjs` | — | — | pass |
| `scripts/no-legacy-env-names.mjs` | — | — | pass |
| `scripts/build-contract.mjs` | — | — | `build-contract: ok` |

Total 1318 tests, 0 failures. GREEN.

## 4. `pnpm run build`

**Exit code: 0**

Packages, API and web all built. Web bundle tail:

```
dist/assets/index-GDCgzJVC.js      262.79 kB │ gzip:  66.43 kB
dist/assets/vendor-DdtIS_KG.js     417.55 kB │ gzip: 128.83 kB
✓ built in 1.99s
```

GREEN.

---

## A. Local migration — `pnpm --filter @fxl-sales/api db:migrate`

Pre-flight, as required (file contents NOT printed):

```
$ grep -c 'localhost:5006' apps/api/.env
4
```

The configured database is the local one. Command:

**Exit code: 0**

```
> @fxl-sales/api@1.0.0 db:migrate
> tsx src/db/migrate.ts

◇ injected env (14) from .env
◇ injected env (0) from .env.local
Running migrations from ./drizzle
NOTICE 42P06: schema "drizzle" already exists, skipping
NOTICE 42P07: relation "__drizzle_migrations" already exists, skipping
Done.
```

GREEN. The new shared resolver (`loadEnvFiles({ baseDir: API_ROOT_DIR, ... })`) that replaced
`import 'dotenv/config'` in `src/db/migrate.ts` reaches `apps/api/.env` correctly — note it now
also reads `.env.local`, which the bare dotenv import never did. No database other than
`localhost:5006/fxl_sales` was contacted.

## B. The API boots — **FAIL**

`pnpm --filter @fxl-sales/api build` — exit code 0. Port 3006 confirmed free beforehand (`lsof -ti:3006` empty).

### B.1 — as configured (the graded run)

```
$ node dist/server.js &     # PID 77200
$ curl -s -o /dev/null -w '%{http_code}' http://localhost:3006/health
```

**HTTP status: `000` — nothing was listening. The process had already exited.**

Server output:

```
◇ injected env (14) from .env
◇ injected env (0) from .env.local
HubConfigError: hub-sdk: FXL_HUB_CONFIG.environment must be exactly one of "production",
"staging" or "development". It is EXPLICIT configuration and is never inferred from the
process environment.
    at parseHubConfig  (@fxl-business/hub-sdk/dist/chunk-DJ323EJE.js:4346)
    at loadHubConfig   (@fxl-business/hub-sdk/dist/chunk-DJ323EJE.js:4588)
    at loadHubAuthConfig     (apps/api/dist/config/auth-provider.js:59)
    at tryLoadHubAuthConfig  (apps/api/dist/config/auth-provider.js:68)
    at apps/api/dist/middleware/app-auth.js:61
  { field: 'environment' }
```

Killed by exact PID; `lsof -ti:3006` empty afterwards.

### B.2 — root cause isolation

Key NAMES present in `apps/api/.env` (no values read or printed):

```
ADMIN_DATABASE_URL, CORS_ORIGIN, DATABASE_URL,
FXL_HUB_API_URL, FXL_HUB_PUBLISHABLE_KEY, FXL_HUB_REDIRECT_URI, FXL_HUB_SECRET_KEY,
NODE_ENV, PORT, RESEND_API_KEY, RESEND_FROM, SENTRY_DSN,
TEST_DATABASE_URL, TEST_MIGRATE_DATABASE_URL
```

`grep -cE '^FXL_HUB_ENVIRONMENT=.+' apps/api/.env` → `0`.

The local file is **stale relative to the `@fxl-business/hub-sdk@2.3.0` contract**. It still
names `FXL_HUB_PUBLISHABLE_KEY` / `FXL_HUB_SECRET_KEY`, which that migration retired, and it
supplies none of `FXL_HUB_ENVIRONMENT`, `FXL_HUB_CLIENT_ID`, `FXL_HUB_CLIENT_SECRET`,
`FXL_HUB_AUDIENCE`, `FXL_HUB_HEALTH_TOKEN`, `FXL_HUB_TRUSTED_ORIGINS`.
Because `FXL_HUB_API_URL` *is* set, `hubConfigIsAbsent` is false, so this is a PARTIAL discrete
configuration — which `CLAUDE.md` records as a deliberate v3.1.0 boot failure rather than a
`503 hub_auth_not_configured`. The SDK is behaving exactly as documented.

### B.3 — counterfactual: the code path is sound

Same binary, same two env files, with the five identity values supplied in-process only
(no file written, `SALES_ENV_FILE` never set, Hub URL pinned at `localhost:9016` so nothing
remote is contacted, credentials are throwaway literals):

```
$ FXL_HUB_ENVIRONMENT=development FXL_HUB_CLIENT_ID=pk_fxl-sales_development_… \
  FXL_HUB_CLIENT_SECRET=sk_fxl-sales_development_… FXL_HUB_AUDIENCE=app.fxl-sales \
  FXL_HUB_API_URL=http://localhost:9016 … node dist/server.js &   # PID 95385

[fxl-sales-api] listening on http://localhost:3006 (development)
<-- GET /health
--> GET /health 200 3ms
```

**HTTP status: `200`**, body:

```json
{"ok":true,"service":"fxl-sales-api","env":"development","version":"unknown","timestamp":"2026-09-16T22:40:18.319Z"}
```

Killed by exact PID; `lsof -ti:3006` empty afterwards.

An intermediate probe with a malformed secret produced
`HubConfigError: … clientSecret is not a Hub Client secret`, i.e. the loader advanced field by
field through the SDK's validator — further evidence the resolver is delivering the file's
contents correctly.

Note also `injected env (12) from .env` in the probe runs versus `(14)` in the graded run: the
two variables I supplied on the command line were already in `process.env`, so dotenv skipped
them. That confirms the loader's non-override precedence AND that it resolves to
`apps/api/.env` from `dist/config/env-files.js` (`API_ROOT_DIR = resolve(import.meta.dirname, '../..')`).

### B.4 — attribution

Slice 01 is **not** the cause. With `SALES_ENV_FILE` unset — which it is, and must be —
`loadEnvFiles` performs exactly `config({path: baseDir/.env})` then
`config({path: baseDir/.env.local, override: true})`, byte-for-byte the behaviour of the
pre-slice `env.ts` (`git diff 22a08a1 2facf27 -- apps/api/src/env.ts` confirms only the loader
lines moved). The slice's diff touches no Hub-config code; `auth-provider.ts` is untouched. The
named-file throw this check was written to exercise is inert here because no file is named.

The boot failure therefore predates this wave and dates from the SDK 2.3.0 adoption run, which
updated `.env.example` / `.env.dev.example` but could not update the developer's untracked
`apps/api/.env`. It was never caught because nothing else in the suite starts the real server —
precisely the gap check B exists to close.

**Remediation (for the operator, not for me — I grade, I do not repair):** update
`apps/api/.env` to the nine-name contract, using `apps/api/.env.dev.example` as the source, and
drop the retired `FXL_HUB_PUBLISHABLE_KEY` / `FXL_HUB_SECRET_KEY` lines. This will also block
slice 02, whose database guard consumes `namedEnvFile` and needs a booting API.

## C. Security / secret-leak check — HOLDS

### C.1 Host and tailnet leak

```
$ git grep -n -i -E 'fxl-db-server|tail89bca3\.ts\.net|100\.81\.240\.91' -- . ':(exclude)nexo'
(no output)   exit 1
```

CLEAN.

### C.2 `SALES_ENV_FILE=` assignments

```
$ git grep -n -E '^\s*SALES_ENV_FILE=' -- .
nexo/plans/feature-20260916-local-db-guard/03-staging-make-targets.md:474:SALES_ENV_FILE=.env.staging pnpm --filter @fxl-sales/api dev

$ git grep -n -E '^\s*SALES_ENV_FILE=' -- . ':(exclude)nexo'
(no output)   exit 1
```

The single hit is inside a fenced ```` ``` ```` block in the **plan for slice 03** (not yet
executed), quoting the expected `make -n back-stg` output. It is a one-shot command-line prefix,
which is the sanctioned usage, in a document, not an assignment in any shipped file. Outside
`nexo/` there are zero hits. Every other tracked mention of the name is a `#` comment in the
three `.env*.example` files, or source/tests/JSDoc in `config/env-files.ts`,
`config/__tests__/env-files.test.ts`, `db/migrate.ts`, `env.ts` and `test/unit-setup.ts`
(which blanks the name for the suite). HOLDS.

### C.3 Credentialed Postgres URLs

38 hits, every one a localhost/docker/test placeholder. No remote credential. Full inventory:

- `apps/api/.env.dev.example:18`, `apps/api/.env.example:7`, `apps/api/drizzle.config.ts:9`
  — `postgresql://postgres:postgres@localhost:5006/fxl_sales` (local Docker default).
- `apps/api/src/db/__tests__/migration-runner.test.ts:76`
  — `postgresql://invalid:invalid@127.0.0.1:1/invalid` (deliberately unreachable).
- `apps/api/src/db/__tests__/single-role-db-contract.test.ts:35,37`
  — `postgresql://project_user:secret@localhost:5432/project_db` (literal placeholder).
- `apps/api/src/middleware/__tests__/` ×5 (`app-auth-access-gate`, `app-auth-bff-production-boot`,
  `app-auth-bff-wiring`, `app-auth-partial-config`, `app-auth-unconfigured`)
  — `vi.stubEnv` of `postgresql://postgres:postgres@localhost:5006/fxl_sales_*_test`.
- `apps/api/test/rls/` ×27 files incl. `setup-env.ts` (twice) and `global-setup.ts`
  — `postgresql://postgres:postgres@localhost:5006/fxl_sales`.
- `docker-compose.yml:11` — `postgresql://postgres:postgres@db:5432/fxl_sales` (compose service host).

HOLDS.

### C.4 Working tree carries no `.env`

```
$ git status --porcelain
 M nexo/runs/feature-20260916-local-db-guard/budget.json
?? .vscode/
?? nexo/runs/feature-20260916-local-db-guard/agents/exec-01.result.json
?? nexo/runs/feature-20260916-local-db-guard/agents/verify-01.result.json
?? nexo/runs/feature-20260916-local-db-guard/exec-01-notes.md
?? nexo/runs/feature-20260916-local-db-guard/verify-01.md
```

No `.env`, no `.env.staging`. HOLDS. (`.vscode/` is untracked and unrelated to this wave.)

### C.5 Env files untracked

```
$ git ls-files apps/api/.env apps/web/.env
(no output)
$ git check-ignore -v apps/api/.env apps/api/.env.staging apps/web/.env
.gitignore:4:.env              apps/api/.env
.gitignore:13:**/.env.staging  apps/api/.env.staging
.gitignore:4:.env              apps/web/.env
```

Neither is tracked, and all three are ignored by rule. `apps/api/.env.staging` was confirmed to
EXIST only; it was never opened, read or printed. HOLDS.

---

## Prohibitions observed

- Only `localhost:5006/fxl_sales` was contacted. `pnpm --filter @fxl-sales/api db:migrate` was
  the only database command run.
- `fxl-db-server` and the `tail89bca3.ts.net` tailnet were never resolved or contacted.
- `SALES_ENV_FILE` was never set, in any form.
- `apps/api/.env.staging` was never opened. `apps/api/.env` was only ever grepped for key NAMES
  and a match count; no value was read or printed.
- `make db-reset` was not run.
- Nothing committed, no branch switched, nothing repaired.
- Every process started was killed by its exact PID (77200, 89114, 95385) and `wait`ed on.
  Final state: `lsof -ti:3006` empty, `lsof -ti:8006` empty, no `apps/api/dist/server.js`
  process alive. No `pkill`/`killall` was used.

## Findings

1. **BLOCKER (environment, not code).** `apps/api/.env` on this machine is stale against the
   `@fxl-business/hub-sdk@2.3.0` contract, so the built API exits at module scope with
   `HubConfigError: FXL_HUB_CONFIG.environment must be exactly one of …`. Proven by counterfactual
   to be independent of slice 01: the identical binary boots and serves `/health 200` once the
   five identity variables are well formed.
2. **Observation (no action).** Slice 01 measurably widened `db:migrate`'s environment — it now
   reads `.env.local`, which the previous `import 'dotenv/config'` ignored. The migration ran
   green against the local database, so the widening is benign here, but it is a real behavioural
   change for any developer who keeps overrides in `.env.local`.
3. **Observation (no action).** `.vscode/` is untracked and unignored; it will appear in every
   future `git status`. Unrelated to this wave.
