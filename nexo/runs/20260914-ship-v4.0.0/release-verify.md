VERDICT: PASS

# Release verification - `a1be9d6` on `master`

Verified by an independent RELEASE-VERIFY agent on 2026-09-14.
No file was modified, nothing was committed, pushed or branched, and no process was killed.

## Commit identity

| Check | Result |
| --- | --- |
| `git rev-parse HEAD` | `a1be9d62cb051b2f0ef572e18f5ab19ae67a5ffd` |
| Branch | `master` |
| `git status --short` | `?? .vscode/` only - the single acceptable dirty entry |
| `v3.0.0` resolves to | `aaba28ca653c27794a93e1c3d51cfdb954ab9094` |
| `v3.0.0` is an ancestor of `a1be9d6` | yes |
| Worktree state after all five commands | unchanged, still `?? .vscode/` only |

## Command results

All five commands were run from the repo root, in the prescribed order.

| # | Command | Exit code | Headline numbers |
| --- | --- | --- | --- |
| 1 | `pnpm run lint` | **0** | `apps/api` eslint Done, `apps/web` eslint Done; `shared-types` / `shared-utils` have no lint script |
| 2 | `pnpm run type-check` | **0** | `tsc --noEmit` clean in all four projects (`shared-types`, `shared-utils`, `apps/api`, `apps/web`) |
| 3 | `CI=true pnpm test` | **0** | see the per-package table below - **1309 tests / 103 test files, 0 failures** |
| 4 | `pnpm run build` (COLD) | **0** | web `✓ built in 2.02s`; api `tsc && tsc-alias` clean; both shared packages rebuilt from scratch |
| 5 | `pnpm --filter @fxl-sales/api test:integration` | **0** | **169 tests / 25 test files, 0 failures** (run twice, both exit 0) |

### Step 3 - test counts per package

| Package | Test files | Tests |
| --- | --- | --- |
| `packages/shared-utils` | 3 passed (3) | 80 passed (80) |
| `apps/api` (unit) | 44 passed (44) | 445 passed (445) |
| `apps/web` | 56 passed (56) | 784 passed (784) |
| repo guards (`node --test` over `scripts/__tests__/no-legacy-auth.test.mjs` + `no-legacy-env-names.test.mjs`) | - | `# tests 11 / # pass 11 / # fail 0` |
| `scripts/no-legacy-auth.mjs`, `scripts/no-legacy-env-names.mjs`, `scripts/build-contract.mjs` | - | all ran, `build-contract: ok` |
| **Total** | **103 + 11 guard tests** | **1309 + 11 = 1320 passing, 0 failing** |

`packages/shared-types` has no test script and is skipped by `--if-present`.

### Step 4 - the build really was cold

Before running `pnpm run build` the following were deleted, and the deletion was verified:

- `./packages/shared-types/tsconfig.tsbuildinfo` (deleted)
- `./packages/shared-utils/tsconfig.tsbuildinfo` (deleted)
- `apps/api/dist`, `apps/web/dist`, `packages/shared-types/dist`, `packages/shared-utils/dist` (all removed; the follow-up `ls -d apps/*/dist packages/*/dist` returned `no matches found`, i.e. zero dist directories survived)

`find . -name '*.tsbuildinfo' -not -path '*/node_modules/*'` found and removed exactly those two files. The build then succeeded from a clean state, so the previously-observed warm-build masking cannot apply here.

### Step 5 - integration ran against the LOCAL database, PROVEN

This is the axis that required positive evidence, and there are four independent lines of it.

**1. Container and port, before the run.**

```
06--product--fxl-sales-db-1   Up 10 days (healthy)   0.0.0.0:5006->5432/tcp, [::]:5006->5432/tcp
nc -z localhost 5006 -> "Connection to localhost port 5006 succeeded"
```

**2. The hazard is real and was measured.** `apps/api/.env` genuinely points the default at staging:

```
DATABASE_URL=postgresql://***:***@fxl-db-server:5432/fxl_sales_stg_db     <-- STAGING
TEST_DATABASE_URL=postgresql://***:***@localhost:5006/fxl_sales
TEST_MIGRATE_DATABASE_URL=postgresql://***:***@localhost:5006/fxl_sales
ADMIN_DATABASE_URL=postgresql://***:***@localhost:5006/fxl_sales
```

Note that `fxl-db-server` IS resolvable from this machine (`fxl-db-server.tail89bca3.ts.net` -> `100.81.240.91`, over Tailscale), so "staging is unreachable" is NOT available as an argument and was not relied on. The pinning had to be proven positively.

**3. The override resolves to localhost:5006.** `apps/api/test/rls/setup-env.ts` contains a hard assignment, not a `??=`:

```ts
process.env.DATABASE_URL = appUrl;   // appUrl = TEST_DATABASE_URL ?? DATABASE_URL ?? localhost:5006
```

Executing that exact module with `tsx` from `apps/api` (the same cwd and the same `dotenv/config` load the suite uses) printed:

```
RESOLVED DATABASE_URL       = postgresql://***@localhost:5006/fxl_sales
RESOLVED TEST_DATABASE_URL  = postgresql://***@localhost:5006/fxl_sales
RESOLVED ADMIN_DATABASE_URL = postgresql://***@localhost:5006/fxl_sales
RESOLVED MIGRATE_URL        = postgresql://***@localhost:5006/fxl_sales
```

The staging URL is overwritten before any test connects.

**4. Runtime traffic landed on the local container.** `pg_stat_database.xact_commit` for database `fxl_sales` was sampled inside the local Docker container immediately before and immediately after a second full integration run:

```
BEFORE = 90383 committed transactions
AFTER  = 92935 committed transactions
DELTA  = 2552 transactions committed on the LOCAL container during the run
```

The suite also connects as the non-superuser `fxl_sales_test` role, which exists in the local container (`select rolname from pg_roles where rolname like 'fxl%'` -> `fxl_sales_test`), so RLS is genuinely enforced rather than bypassed by a superuser.

**Integration is marked PASS, not UNPROVEN.** The 2552-transaction delta on the local container is direct runtime evidence, independent of the static configuration reading.

## Security review of `v3.0.0..a1be9d6`

Scope of the diff: 82 files, +7931 / -426. Of these, **55 files are documentation under `nexo/`** (run records, verify reports, audits). Only **27 files sit outside `nexo/`**, and only **four are production source**:

```
apps/api/src/auth/session-crypto.ts     |  17 +++-
apps/api/src/config/auth-provider.ts    | 190 +++++++++-----------------
apps/api/src/env.ts                     |  33 ++++--
apps/api/src/middleware/app-auth.ts     | 135 ++++++++++-------
```

The remainder are `.env` examples, `README.md`, `CLAUDE.md`, `package.json` x3, `pnpm-lock.yaml`, test files, and the guard scripts under `scripts/`.

### a) Credential or secret VALUE committed anywhere in the diff

**No findings.**

A scan of every added line for `sk_live`/`sk_test`, a populated `pk_<slug>_<env>_<random>`, PEM private-key headers, `AKIA…`, `ghp_…`, JWT-shaped `eyJ…`, `postgres://user:pass@` with a non-trivial password, and `CLIENT_SECRET=`/`SECRET=`/`PASSWORD=` followed by a literal returned no real credential. The only matches were:

- `vi.stubEnv('DATABASE_URL', 'postgresql://postgres:postgres@localhost:5006/fxl_sales_partial_test')` in a new test - the standard local Docker `postgres:postgres` fixture, pointed at localhost, matching the pre-existing pattern already in `.env.example`.
- Prose in `nexo/` and `README.md` naming variables such as `FXL_HUB_CLIENT_SECRET=` as BLANK slots, and the guard script's embedded variable NAMES.

Both committed env examples were read in full and every secret slot ships blank:

```
FXL_HUB_CONFIG=   FXL_HUB_API_URL=   FXL_HUB_ENVIRONMENT=   FXL_HUB_CLIENT_ID=
FXL_HUB_CLIENT_SECRET=   FXL_HUB_AUDIENCE=   FXL_HUB_HEALTH_TOKEN=
SALES_POST_LOGIN_REDIRECT=   SALES_POST_LOGIN_ERROR_REDIRECT=
SALES_SESSION_ENCRYPTION_IKM=   SENTRY_DSN=   RESEND_API_KEY=
```

The only populated values are the documented local ones (`http://localhost:8006/auth/callback`, `http://localhost:8006`, `http://localhost:3006`, the local Docker DSN). This also satisfies the CLAUDE.md rule that all five identity variables ship blank so a fresh clone is "absent" rather than a partial-config boot failure.

### b) Changed lines touching the single access gate

**No findings that weaken the gate.** The gate logic is untouched.

Grepping the entire `apps/api/src` + `apps/web/src` diff for `requireHubAuth`, `appAuthMiddleware`, `entitlements`, `allowWithoutAccess`, `requiredModule`, `payment_required`, `no_org_access`, `402` and `isEntitlementFailure` returned four hits, and **all four are comment text**, not code:

- two prose lines about where `requireHubAuth` reads the audience from;
- one unrelated `indexOf('=')` in a guard script;
- one doc-comment line about `FXL_HUB_API_URL`.

`requireHubAuth` remains the single gate, `allowWithoutAccess` is still left at its default `false`, and no `requiredModule` was introduced anywhere. `appAuthMiddleware`'s body is unchanged. The one structural edit in `createAppAuthBff` is `if (!hubSdkConfig || !hubAuthConfig)` collapsing to `if (!hubSdkConfig)`, which is equivalence-preserving: both bindings were derived from the same single `tryLoadHubAuthConfig(hubEnvBag(env))` call, and that call is now assigned once. The dedicated oracles `app-auth-access-gate.test.ts` (9 tests) and the new `app-auth-partial-config.test.ts` (2 tests) both pass.

### c) Changed lines touching org scoping / tenancy

**No findings.** Grepping the full `apps/api/src`, `apps/web/src` and `apps/api/test` diff for `orgId`, `org_id`, `withTenant`, `RLS`, `getAdminDb`, `fxl_admin`, `POLICY` and `actorOrgId` returned **zero changed lines**. No tenant filter, RLS policy, admin-connection boundary or `withTenant` transaction was modified. The 25 RLS integration test files all pass against the real non-superuser role.

### d) `apps/web` lines that could leak raw account or workspace ids into user-facing UI

**No findings, structurally.** The entire `apps/web` change in this range is a single file:

```
M  apps/web/package.json
```

and its only hunk is the `@fxl-business/hub-sdk` version bump. **Not one line of `apps/web/src` changed**, so no rendering path, no label helper, and no identifier-handling code was touched. `userLabel` / `orgLabel` and the muted-monospace fallback rule are untouched by construction.

### e) New outbound network call or new dependency

**One dependency change, no new outbound calls.**

- **Dependency:** `@fxl-business/hub-sdk` `2.2.0` -> `2.3.0`, pinned exactly (no caret) in **both** `apps/api/package.json` and `apps/web/package.json`, as CLAUDE.md requires. The installed tree confirms `2.3.0`.
- **Transitive tree unchanged.** The whole `pnpm-lock.yaml` diff is 14 lines: the two importer specifiers, the package entry with its new integrity hash, and the snapshot key. The SDK's own dependency set is byte-identical (`hono: 4.12.28`, `jose: 5.10.0`), and its peer requirement is still `hono: 4.12.28`, so the `pnpm-workspace.yaml` Hono override did not need to move and did not move. **No new package was added to the tree.**
- **No new outbound calls.** Grepping every added non-test source line for `fetch(`, `axios`, `http.request`, `https.request`, `node-fetch`, `XMLHttpRequest`, `WebSocket` and `new URL(...http` returned **zero hits**. The diff in fact *removes* a network seam rather than adding one: `fetchImpl` is still not passed, and the deleted `resolveHubRedirectUri` / `hubConfigPresence` / `nameDiscreteVar` are all pure local functions.
- **The one script-level change** is `package.json`'s `test` script gaining `node --test scripts/__tests__/*.test.mjs` and `node scripts/no-legacy-env-names.mjs`. Both are local filesystem greps; neither opens a socket.
- **Net security direction is inward.** `trustedOrigins: [env.CORS_ORIGIN]` is no longer hand-passed as a `createHubBff` option; it now rides on the config, resolved by the SDK from `FXL_HUB_TRUSTED_ORIGINS`, and `assertBootConfiguration` runs exactly once inside `createHubBff` rather than twice over two different option objects. A partial discrete configuration is now a boot failure instead of a silent 503.

### Non-blocking operational notes (not security findings, but release-relevant)

These are documented in `CLAUDE.md` and `AUDIT.md`; they are recorded here because they are deploy-time actions, not code defects, and they fail CLOSED rather than open:

1. **`FXL_HUB_TRUSTED_ORIGINS` is a promotion gate.** The `trustedOrigins: [env.CORS_ORIGIN]` option was removed from `createHubBff`. Staging and production MUST set `FXL_HUB_TRUSTED_ORIGINS` before this deploy; unset, the list is `[]` and every browser POST to the BFF answers `403 origin_not_trusted`. Local development is unaffected (vite proxies `/auth` with `changeOrigin: false`).
2. **Two variable renames need value carry-over.** `HUB_SESSION_ENCRYPTION_KEY` -> `SALES_SESSION_ENCRYPTION_IKM` and `FXL_HUB_POST_LOGIN_REDIRECT` / `_ERROR_REDIRECT` -> `SALES_POST_LOGIN_REDIRECT` / `_ERROR_REDIRECT`. Semantics are byte-identical; an operator who had SET the old names must copy the values under the new names before the deploy that reads them. For the IKM specifically, not carrying a previously-set value means every stored seal stops opening and every user is logged out once. Blank in both environments (the documented default) means there is nothing to carry.
3. **Accepted diagnostic regression, already filed upstream as 2.4.0 feedback:** with `nameDiscreteVar` deleted, a misconfigured IDENTITY field reports as `FXL_HUB_CONFIG.<field>` even for an operator using the five discrete variables.

## Migration count

**Zero migration files added or changed in `v3.0.0..a1be9d6`. CONFIRMED - your belief is correct.**

Evidence:

```
$ git diff --name-only v3.0.0..a1be9d6 | grep -iE 'migrat|\.sql$|drizzle'
(no output, grep exit code 1)
```

```
$ git diff --name-status v3.0.0..a1be9d6 -- '*migration*' '*migrations*' '*drizzle*' '*.sql'
(no output)
```

No file matching `migrat`, `drizzle`, or `.sql` appears anywhere in the 82-file diff - not added, not modified, not deleted. The only `migration`-adjacent files that appear at all are pre-existing test files that were NOT touched (`migration-runner.test.ts`, `proposal-schema-migration.test.ts`, `produtos-servicos-schema-migration.test.ts`), all of which pass.

**Rollback is therefore a pure code revert.** There is no schema change to undo, no data backfill to reverse, and no forward-only DDL. Reverting to `v3.0.0` requires only redeploying that commit - plus, if the two renamed variables were set under their new names, restoring them under the old ones (`HUB_SESSION_ENCRYPTION_KEY`, `FXL_HUB_POST_LOGIN_REDIRECT`, `FXL_HUB_POST_LOGIN_ERROR_REDIRECT`), since `v3.0.0`'s code reads the old names. `FXL_HUB_TRUSTED_ORIGINS` can be left set; `v3.0.0` ignores it and uses `CORS_ORIGIN`.

## Conclusion

All five commands exited 0. The build was verified cold. The integration suite was proven to have run against the local Docker database on localhost:5006 by four independent lines of evidence, including a 2552-transaction commit delta measured on the container itself. The security review found no credential values, no change to the single access gate, no change to org scoping or RLS, no change to any `apps/web` source file at all, and no new outbound network call - the only dependency movement being the exact-pinned `@fxl-business/hub-sdk` 2.2.0 -> 2.3.0 with an unchanged transitive tree. Zero migrations.

**VERDICT: PASS**
