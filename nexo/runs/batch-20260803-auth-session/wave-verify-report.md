# Wave verify - batch-20260803-auth-session

Verifier: independent wave-verify agent (built none of the three slices).
Repo: `/Users/cauetpinciara/Documents/fxl/projects/06--PRODUCT--fxl-sales`
Branch: `master` @ `d13e410`
Baseline for the combined diff: `dfb955f`
Date: 2026-08-03

Slices under test, exercised together for the first time:

- 01 `6902b13` - durable Hub BFF session store in Postgres (migration `0016`).
- 02 `4777627` - `requireToken` / `assertBearerToken`, `apiFetch.token` required, new eslint ban.
- 03 `6acda51` - bounded revalidation ladder, sessionStorage route capture/restore behind a sanitizer.

**VERDICT: PASS** - all five gate commands green (build run twice, second from a fully clean
state), all six integration checks green. One must-fix housekeeping item and three observations
are recorded below; none of them is a code defect in the shipped product.

---

## 1. Gate commands

Each command run exactly once, non-watching. Real output tails.

### `pnpm run lint` - PASS

```
Scope: 4 of 5 workspace projects
packages/shared-types lint: no lint for shared-types
packages/shared-types lint: Done
packages/shared-utils lint: no lint for shared-utils
packages/shared-utils lint: Done
apps/api lint$ eslint src/
apps/web lint$ eslint src/
apps/api lint: Done
apps/web lint: Done
```

### `pnpm run type-check` - PASS

```
packages/shared-types type-check$ tsc --noEmit
packages/shared-utils type-check$ tsc --noEmit
packages/shared-types type-check: Done
packages/shared-utils type-check: Done
apps/api type-check$ tsc --noEmit
apps/web type-check$ tsc --noEmit
apps/api type-check: Done
apps/web type-check: Done
```

### `pnpm test` - PASS

```
apps/api test:  Test Files  33 passed (33)
apps/api test:       Tests  323 passed (323)
apps/api test:    Duration  2.20s
apps/api test: Done
...
apps/web test:  Test Files  44 passed (44)
apps/web test:       Tests  484 passed (484)
apps/web test:    Duration  5.55s
apps/web test: Done
build-contract: ok
```

The `scripts/no-legacy-auth.mjs` tracked-file guard and `scripts/build-contract.mjs` both ran
and passed (the run terminates on `build-contract: ok`).

New-in-this-batch suites all present and green in that run:

```
apps/api test:  ✓ src/auth/__tests__/hub-session-store.test.ts (6 tests)
apps/api test:  ✓ src/middleware/__tests__/app-auth.test.ts (14 tests)
apps/web test:  ✓ src/auth/__tests__/react.test.tsx (15 tests)
apps/web test:  ✓ src/auth/__tests__/session-recovery.test.ts (39 tests)
apps/web test:  ✓ src/lib/__tests__/api-client-token-guard.test.ts (6 tests)
apps/web test:  ✓ src/sales-ops/__tests__/blank-bearer-token.test.tsx (3 tests)
```

### `pnpm --filter @fxl-sales/api test:integration` - PASS

```
 ✓ test/rls/hub-bff-session-store.test.ts (8 tests) 83ms
 ✓ test/rls/sale-professional-funcoes.test.ts (13 tests) 423ms
 ✓ test/rls/funcoes-rls.test.ts (14 tests) 262ms
 ✓ test/rls/produtos-servicos-schema-migration.test.ts (6 tests) 42ms

 Test Files  20 passed (20)
      Tests  109 passed (109)
   Duration  7.28s
```

Confirmed pinned to the LOCAL Docker test DB, not staging:
`apps/api/.env` carries `TEST_DATABASE_URL` / `TEST_MIGRATE_DATABASE_URL` / `ADMIN_DATABASE_URL`
all pointing at `localhost:5006/fxl_sales`, while `DATABASE_URL` points at
`fxl-db-server:5432/fxl_sales_stg_db` (staging). `test/rls/setup-env.ts` hard-overrides
`DATABASE_URL`. No migration was ever run against the staging URL during this verification.

### `pnpm run build` (run 1, warm caches) - PASS

```
dist/assets/vendor-query-DlWkM2v7.js     41.37 kB │ gzip:  12.34 kB
dist/assets/vendor-radix-CKSyQtSC.js     72.24 kB │ gzip:  21.91 kB
dist/assets/index-BppUCxzV.js           229.30 kB │ gzip:  57.29 kB
dist/assets/vendor-BYmBfNsb.js          412.23 kB │ gzip: 127.05 kB
✓ built in 1.63s
```

### `pnpm run build` (run 2, clean state) - PASS

Deleted first (all confirmed gitignored via `git check-ignore` before removal):
`apps/api/dist`, `apps/web/dist`, `packages/shared-types/dist`, `packages/shared-utils/dist`,
`packages/shared-types/tsconfig.tsbuildinfo`, `packages/shared-utils/tsconfig.tsbuildinfo`.
A post-delete `find` confirmed zero `*.tsbuildinfo` remained outside `node_modules`.

```
cleaned
...
dist/assets/vendor-query-DlWkM2v7.js     41.37 kB │ gzip:  12.34 kB
dist/assets/vendor-radix-CKSyQtSC.js     72.24 kB │ gzip:  21.91 kB
dist/assets/index-BppUCxzV.js           229.30 kB │ gzip:  57.29 kB
dist/assets/vendor-BYmBfNsb.js          412.23 kB │ gzip: 127.05 kB
✓ built in 1.58s
```

Byte-identical chunk hashes across both runs. No stale artifact was masking anything.

---

## 2. Integration checks

### Check 1 - do slices 02 and 03 compose at runtime? - **PASS**

Neither slice's own tests cover the other: `react.test.tsx` mocks `../token` away and never calls
`requireToken`; `blank-bearer-token.test.tsx` mocks `@/auth/react` away entirely and never
exercises the provider. So I wrote a throwaway probe that composes the REAL `AppAuthProvider`,
the REAL `createHubAccessTokenCache`, and the REAL `requireToken`, mocking only
`@fxl-business/hub-sdk/client`. Probe deleted afterwards; `git status` verified clean.

Result over five consecutive runs: `Tests 5 passed (5)` each time - deterministic.

Traced behaviour:

- **Genuinely dead session terminates in a bounded way and surfaces
  `AuthTokenUnavailableError`.** With `client.getToken()` permanently null after a good start, the
  profile stays `signed-in` through the 500 ms, 1500 ms and 4000 ms rungs and flips to
  `signed-out` on the fourth null (~6 s). Advancing a further 60 s produced ZERO additional
  `client.getToken` calls - the ladder ends, it does not loop. A `requireToken(getToken)` after
  teardown rejects with `AuthTokenUnavailableError` (asserted via `isAuthTokenUnavailableError`).
- **A transient blip does not tear the session down.** One null followed by a healthy token:
  profile never leaves `signed-in` (asserted over the whole recorded state sequence, not just the
  final value), and the next `requireToken` after the 500 ms rung resolves a string.

**Documented nuance, not a defect:** the query that is in flight AT the moment of the blip *does*
see `AuthTokenUnavailableError` - `getToken()` still returns the null it observed, and slice 02
throws on it. Slice 03 protects the SESSION (and therefore the operator's in-progress form
state), not the individual request. The request-level recovery is TanStack's `retry: 1` in
`apps/web/src/App.tsx`, whose default first retry delay is 1000 ms and therefore lands after the
500 ms rung has already restored the token. That is the correct division of labour, but note the
consequence: a blip lasting longer than the retry delay but shorter than the full ladder leaves
`bootstrapQuery` in its error state showing "Sessão expirada / Atualize a página", while the
session underneath is in fact still alive and recovers. No refetch is triggered when the ladder
succeeds. This is strictly better than the pre-batch behaviour (which showed the generic
"the API is broken" panel AND signed the user out), so it is not a regression - it is a
follow-up candidate: have the provider invalidate the query cache when the ladder recovers.

### Check 2 - does the new eslint rule fire, and is the whole repo clean under it? - **PASS**

The whole repo is clean: `pnpm run lint` runs `eslint src/` over all of `apps/web/src`, not only
the files slice 02 migrated, and it passed. Slice 03's new files (`session-recovery.ts`, the
rewritten `react.tsx`) are inside that scope and produce no violation.

Proved the rule is not vacuous with a temporary file at `apps/web/src/zz-probe-lint.tsx`
(deleted immediately):

```
/…/apps/web/src/zz-probe-lint.tsx
  3:43  error  A missing access token must never be defaulted. Use `await requireToken(getToken)`
               from @/lib/require-token; `(await getToken()) ?? ""` sends an anonymous request
               that surfaces as a generic server fault  no-restricted-syntax

✖ 1 problem (1 error, 0 warnings)
```

**Observation on rule breadth.** The selector
`LogicalExpression[operator='??'] > AwaitExpression.left > CallExpression[callee.name='getToken']`
catches exactly the removed pattern and nothing adjacent. Verified NOT caught in the same probe
file: `(await getToken()) || ''`, `(await auth.getToken()) ?? ''` (member-expression callee), and
the two-statement form `const t = await getToken(); return t ?? ''`. That is a defensible scope
for a regression fence - `apiFetch`'s required non-empty `token` plus `assertBearerToken` is the
actual enforcement, and it catches all four - but the rule should be read as "this exact pattern
cannot come back", not as a general guard.

### Check 3 - two competing notions of "signed out"? - **PASS, no deadlock, no endless spinner**

There is one notion of "the session is dead" (`failSession` → `applyToken(null)`) and one notion
of "this request has no token" (`AuthTokenUnavailableError`). They are ordered, not competing:
slice 03 owns the session lifecycle, slice 02 owns a single request. `getToken` calls
`observeToken` before returning, so every null a caller sees has already been fed to the ladder.

Deadlock analysis, confirmed by probe:

- `HubProtected` renders the skeleton only while `!isLoaded || !isSignedIn`. `isLoaded` flips true
  on the FIRST apply (the `lastAppliedToken` sentinel is `undefined`, so a first apply of `null`
  still runs), and the cold-start effect always resolves through `observeToken` on both the
  fulfil and reject path.
- While the ladder runs, `isSignedIn` stays true, so `HubProtected` renders the app, not a
  spinner. It cannot sit there indefinitely: the ladder is capped at three rungs.
- Once the ladder exhausts, `isSignedIn` goes false and the login effect fires. Probe:
  `client.login` called exactly once and `sessionStorage['fxl-sales.auth.returnTo']` set to
  `/cadastros/produtos?q=abc` - the operator's route was captured, not lost.
- The pathological case (a replica that cannot hold a session) is capped by
  `registerLoginAttempt`: with the counter pre-seeded at 3 within the window, the probe saw
  `client.login` NOT called and the terminal panel rendered instead
  ("Não foi possível restabelecer sua sessão"). Bounded, with a manual retry.

Scenario worth naming because it only exists once both slices are live: if the API's `/auth/*`
BFF answers 503 `session_store_unavailable` (slice 01's honest response to a DB blip), the
browser's `getToken` sees null, the ladder runs 6 s, the session tears down, and the re-login is
capped at 3 tries per 60 s before the recovery panel. The composition terminates correctly.

### Check 4 - migration 0016 on a database at the previous migration - **PASS**

The local test DB already carried `0016` (applied 2026-08-03 during slice 01 development, row
id 20), so the ordinary integration run does not re-exercise the migration. I built the check
from scratch instead.

Method (nothing tracked was modified; the migration runner script was passed the URL explicitly
and hard-refuses any URL not matching `@localhost:5006/`):

1. Copied `apps/api/drizzle` to the scratchpad, deleted `0016_hub_bff_session_store.sql` and its
   snapshot, and stripped the `0016` entry from `_journal.json`
   (`journal entries 17 -> 16 last: 0015_servico_base_value`).
2. Created a scratch database `fxl_wave_verify` on the local Docker Postgres.
3. Migrated to 0015 only, then applied the real `./drizzle` folder, then re-applied it.

```
--- STEP 1: migrate to 0015 only ---
applied-count=16 folder=…/scratchpad/drizzle-0015
--- STEP 2: apply full folder (0016 on top of 0015) ---
applied-count=17 folder=./drizzle
--- STEP 3: re-run (no-op) ---
applied-count=17 folder=./drizzle
```

0016 applied cleanly on top of 0015 and re-running is a no-op. Resulting objects verified:

```
              relname              | relrowsecurity | relforcerowsecurity
-----------------------------------+----------------+---------------------
 hub_bff_login_txns                | t              | t
 hub_bff_sessions                  | t              | t

     tablename      |            policyname            | cmd | permissive
--------------------+----------------------------------+-----+------------
 hub_bff_login_txns | hub_bff_login_txns_admin_context | ALL | PERMISSIVE
 hub_bff_sessions   | hub_bff_sessions_admin_context   | ALL | PERMISSIVE

 hub_bff_login_txns_expires_at_idx / _pkey
 hub_bff_sessions_expires_at_idx   / _pkey
```

Both tables are `ENABLE` + `FORCE` row level security with only the admin-context policy, and all
11 columns match the schema (`account_id` the only nullable one).

Then, stronger than asked: I granted the non-superuser `fxl_sales_test` role on the scratch DB
and ran the FULL integration suite against that from-scratch database:

```
target db: postgresql://***@localhost:5006/fxl_wave_verify
 ✓ test/rls/hub-bff-session-store.test.ts (8 tests) 91ms
 Test Files  20 passed (20)
      Tests  109 passed (109)
   Duration  7.43s
```

Scratch DB dropped afterwards (`DROP DATABASE`; `select datname … like 'fxl_%'` returns only
`fxl_sales`).

### Check 5 - anything that should not ship - **PASS for shipped code, 1 housekeeping finding**

Scanned `git diff dfb955f..HEAD`.

- **`console.*` in added lines: 4 sites, all intentional operational logging**, each with a
  rationale comment, and all matching the pre-existing `[prefix]` house style:
  `hub-session-scope.ts:54` (`console.error` before answering 503),
  `hub-session-store.ts:288` (`console.error` on a flush that must not become a 500),
  `hub-session-store.ts:342` (`console.warn` for the dev-only in-memory fallback),
  `nightly-job.ts` (`console.log` / `console.error` around the sweeper, mirroring the existing
  hold-promotion task). No debug noise, no `debugger`.
- **TODO / FIXME / XXX / HACK / `@ts-ignore` / `eslint-disable` / `.only(` / `.skip(` in added
  lines: none.**
- **Commented-out code: none found.**
- **Secrets: none.** Every grep hit is an env-var NAME, a schema column name
  (`secret_key_hash`, `secret_key_prefix` in the drizzle snapshot), a doc comment, or the unit
  test constant `'unit-test-hub-secret-key-0123456789abcdef'`. `apps/api/.env.dev.example` adds
  `HUB_SESSION_ENCRYPTION_KEY=` blank, which is correct - `env.ts`'s `emptyToUndefined` is what
  makes the documented HKDF-from-`FXL_HUB_SECRET_KEY` default apply.
- **Accidentally committed files: none in `apps/**`, `packages/**` or `nexo/ROADMAP.md`.**

**MUST FIX (housekeeping, not product code):**
`nexo/runs/batch-20260803-auth-session/verify-03-report-round2.md` contains **2 embedded NUL
bytes** (byte 4946 / line 99, and byte 5211 / line 105, out of 21190 bytes / 415 lines). `file`
reports it as `data` and `git diff --stat` shows it as `Bin 0 -> 21190 bytes` rather than as text.
The content is otherwise valid UTF-8 and there is no `.gitattributes` forcing binary. A run record
that git cannot diff or show is a corrupted artifact; strip the two NULs and re-commit before the
release cut. (I did not read the file's content - only its bytes - to avoid contamination.)

### Check 6 - CLAUDE.md compliance across the combined diff - **PASS**

- **Em dashes in NEW code: zero.** Grepped `+` lines across `apps/api/src`, `apps/web/src`,
  `apps/api/drizzle`, `apps/web/eslint.config.js` and `CLAUDE.md` - no matches. The legacy
  `admin/**` and `finder/**` em dashes are untouched and already filed as a follow-up in
  `nexo/ROADMAP.md`.
- **CHANGELOG.md / auto-generated files: not touched.** `git diff --name-only` shows no
  changelog. The only generated files in the diff are `apps/api/drizzle/meta/0016_snapshot.json`
  and the `_journal.json` entry, which are drizzle-kit output belonging to the migration.
- **Tenant queries still filtered by `orgId`: yes, vacuously and correctly.** The diff adds no
  query against any `org_id`-bearing table. Every statement in `hub-session-store.ts` targets
  `hubBffSessions` / `hubBffLoginTxns`, keyed on `id` + `expiresAt`. Those two tables deliberately
  have no `org_id` - a session row is written at `/auth/callback` before any workspace is known -
  and the compensating control is `FORCE` RLS with an admin-context-only policy plus exclusive
  access through `getAdminDb()`, verified live in check 4 and covered by
  `test/rls/hub-bff-session-store.test.ts`.
- `CLAUDE.md` itself gained a four-line "Auth Model" paragraph describing the new invariant. It
  matches the shipped code.

---

## 3. Skipped, quarantined or non-deterministic tests

- **Skipped / quarantined: none.** `grep` for `it.skip` / `describe.skip` / `test.skip` /
  `it.todo` / `.only(` across `apps/api/src`, `apps/api/test`, `apps/web/src` and `packages`
  returns nothing.
- **Non-determinism: none observed.** Repeat runs:
  - New/changed web auth suites (`src/auth`, `src/lib`, `blank-bearer-token`) x3:
    `Test Files 8 passed (8) / Tests 90 passed (90)` on every run.
  - Full API integration suite x3: `Test Files 20 passed (20) / Tests 109 passed (109)` on every
    run.
  - Composition probe x5: `Tests 5 passed (5)` on every run.
  Nothing needed characterising as flaky.

---

## 4. Additional findings (not gate failures)

1. **The `nexo/ROADMAP.md` follow-up about `logout()` is real - independently reproduced.**
   The implementers filed it; I verified it rather than taking their word. With the real provider
   inside `Protected`, after a deliberate `logout()` from `/cadastros/produtos?f=1` the probe
   printed:
   `logout returnTo slot = "/cadastros/produtos?f=1" | login calls = 1`.
   `HubClient.logout()` does not navigate, so `applyToken(null)` immediately drives the login
   effect, which re-captures the path `consumeReturnTo` just cleared. Route leak (a second
   operator on the same tab lands on the first operator's screen), not a data leak. Correctly
   filed; the auto-login-after-logout half is pre-existing.
2. **Boot-time coupling to `FXL_HUB_SECRET_KEY` length.** When `HUB_SESSION_ENCRYPTION_KEY` is
   unset, the sealer's IKM is the Hub secret key, and `createSessionSealer` throws its 32-char
   floor. `createAppAuthBff` runs at server module top level, so a deployment whose
   `FXL_HUB_SECRET_KEY` is shorter than 32 characters will fail to boot rather than degrade. The
   local key is 45 chars and the thrown message is explicit, so the risk is low - but it is worth
   confirming the staging and prod Infisical values before promoting.
3. **New-table grants come from `ALTER DEFAULT PRIVILEGES`, not from the migration.** On the
   local DB `hub_bff_sessions` inherited `fxl_sales_test=arwd/postgres` from
   `pg_default_acl`, exactly like `sales_ops_products`. Migration `0016` issues no `GRANT` of its
   own. If a deployment target provisions privileges per-table instead of via default privileges,
   the two new tables would land ungranted. Worth a one-line check against Coolify staging before
   the promote.

---

## 5. Tree state

`git status --short` at the end of verification:

```
?? .vscode/
```

Identical to the pre-existing state at the start. Every temporary artifact was removed:
the composition probe (`apps/web/src/auth/__tests__/zz-wave-verify-probe.test.tsx`), the eslint
probe (`apps/web/src/zz-probe-lint.tsx`), the migration runner
(`apps/api/zz-migrate-probe.mts`) and the scratch database (`fxl_wave_verify`). No tracked file
was modified. No long-running process was started, so none was left behind.
