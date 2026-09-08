# Wave verify - integrated trunk, round 2

Agent: wave-verify (independent of every executing agent).
Branch: `master`, range `5eeff1e..HEAD` (21 commits, spanning the env-contract prep run and the 2.3.0 adoption run).
Date: 2026-09-08.

No merge, push, tag, amend or deploy was performed.

## Phase 1 - gate suite

All commands run once, non-watching, from the repository root. Real exit codes.

| Command | Exit | Result |
| --- | --- | --- |
| `pnpm run lint` | `0` | PASS - `apps/api` and `apps/web` both clean, packages have no lint step. |
| `pnpm run type-check` | `0` | PASS - all four projects `tsc --noEmit` clean. |
| `CI=true pnpm test` | `0` | PASS - counts below. |
| `pnpm run build` (after deleting every `*.tsbuildinfo` and all four `dist/`) | `0` | PASS - real cold build, web bundle emitted. |
| `node scripts/no-legacy-auth.mjs` | `0` | PASS |
| `node scripts/no-legacy-env-names.mjs` | `0` | PASS |

Per-package test counts, exactly as expected:

```
packages/shared-utils   Test Files  3 passed (3)     Tests  80 passed (80)
apps/api                Test Files 44 passed (44)    Tests 445 passed (445)
apps/web                Test Files 56 passed (56)    Tests 784 passed (784)
build-contract guards   # tests 11  # pass 11  # fail 0
```

Deleted before the build, to prove it was not incremental:
`packages/shared-types/tsconfig.tsbuildinfo`, `packages/shared-utils/tsconfig.tsbuildinfo`, and the `dist/` directories of all four projects.

### Integration suite

Preconditions checked BEFORE running, as required:
`apps/api/.env` carries `TEST_DATABASE_URL`, `TEST_MIGRATE_DATABASE_URL` and `ADMIN_DATABASE_URL` all pointed at `localhost:5006`, and the local Docker container `06--product--fxl-sales-db-1` is up with `5006->5432` mapped (`nc -z localhost 5006` succeeded).
There was no risk of a fall-through to the staging database that `DATABASE_URL` names.

| Command | Exit | Result |
| --- | --- | --- |
| `CI=true pnpm --filter @fxl-sales/api test:integration` | `0` | PASS - `Test Files 25 passed (25)`, `Tests 169 passed (169)`. |

## Phase 2 - integration checks

### 2.1 Boot path coherent - PASS

Traced by READING the source; the server was never executed.

- `apps/api/src/server.ts:31` - `const authBff = createAppAuthBff();` at MODULE top level, then `app.route('', authBff)` under a null guard.
- That is the ONLY production call site. `grep -rn createAppAuthBff apps/api/src` outside `__tests__` returns the import at `server.ts:7`, the call at `server.ts:31`, the declaration at `app-auth.ts:223`, and one prose mention in `hub-session-store.ts`.
- `apps/api/src/middleware/app-auth.ts:96` - `const hubSdkConfig: HubConfig | null = tryLoadHubAuthConfig(hubEnvBag(env));` also at module scope, so the resolve happens once per process, at import.
- `apps/api/src/middleware/app-auth.ts:266` - the single `createHubBff(hubSdkConfig, {...})`.
- `assertBootConfiguration` is called by NO production file. Every occurrence in `apps/*/src` outside `__tests__` is a comment; the only executable references are in `app-auth-bff-production-boot.test.ts`, which calls it directly as a test oracle.

So the boot gate runs exactly once, inside `createHubBff`, over one options object. There is no second options object and no second validation. The three formerly-local values (`healthToken`, `redirectUri`, `trustedOrigins`) are deliberately NOT re-passed as options, so the config that is validated is byte-identical to the config that is constructed - which was the divergence class the old `resolveHubRedirectUri` created.

### 2.2 Three env states - PASS

Proven through the EXISTING vitest suite, not by a hand-rolled probe. Each state lives in its own file because the verdict is decided at module load and vitest isolates per file. Command: `CI=true npx vitest run --reporter=verbose` over the three files, exit `0`, `Tests 11 passed (11)`.

| State | Method | Oracle | Verdict |
| --- | --- | --- | --- |
| No credentials (all six credential-bearing names blank) | existing test, isolated module graph | `app-auth-unconfigured.test.ts` - imports `app-auth.js` successfully (so the process WOULD have booted) and the middleware answers `503 {"error":"unavailable","code":"hub_auth_not_configured"}` | PASS |
| Partial (3 of 5 discrete set) | existing test, isolated module graph | `app-auth-partial-config.test.ts` - the import THROWS; `importedModule` is `undefined` and `importError` is a `HubConfigError` with `field === 'clientSecret'`. Since `server.ts` calls `createAppAuthBff()` at module top level, that throw is the boot failure | PASS |
| Complete | existing test, isolated module graph | `app-auth-bff-production-boot.test.ts` - `createAppAuthBff()` constructs through the REAL `createHubBff`, which runs `assertBootConfiguration` itself; seven assertions on the resulting config/options all pass, and the same file proves the negatives (missing health token and a Hub-origin redirect uri are both refused) | PASS |

No subprocess probe was needed, and none was written. Nothing was left behind.

### 2.3 Every artefact a human copies - PASS, and the class is now under test

The Gate 2 failure of this feature (an example shipping a PARTIAL config with nothing testing it) is now covered by a real oracle rather than by care: `apps/api/src/config/__tests__/env-example-contract.test.ts`, 17 tests, all green. It reads the actual shipped files and the actual fenced blocks and asserts, for each, that the Hub configuration is ABSENT (so it reaches the 503 door, not a boot failure), that the callback is not on the Hub's own origin, and that the known-good local values are still SHOWN, commented, so the file remains useful.

Files re-hunted by hand as well:

| Artefact | Yields a partial config? | Callback on the Hub's origin? | Verdict |
| --- | --- | --- | --- |
| `apps/api/.env.example` | No - all five identity vars and `FXL_HUB_CONFIG` ship blank; the three known-good values ship COMMENTED | No - `FXL_HUB_REDIRECT_URI=http://localhost:8006/auth/callback`, the web origin, while the Hub is `:9016` | PASS |
| `apps/api/.env.dev.example` | No, same shape | No, same value | PASS |
| `apps/web/.env.example` | n/a - browser holds no credential | n/a | PASS |
| `apps/web/.env.dev.example` | n/a | n/a | PASS |
| `README.md` fenced `dotenv` blocks | No - identity five blank, three commented | No - `:8006` callback | PASS |
| `CLAUDE.md` fenced `dotenv` blocks (lines 522-552) | No - same shape | No - `:8006` callback | PASS |
| `scripts/setup.sh` | No - it copies `.env.dev.example` verbatim (`scripts/setup.sh:263-266`) and injects no Hub value of its own | No | PASS |
| `docker-compose.yml` | No - only database service env | No | PASS |
| `apps/api/Dockerfile` | No - only `PNPM_HOME`, `PATH`, `NODE_ENV=production` | No | PASS |
| `.github/workflows/ci.yml` | No - names no `FXL_` or `SALES_` variable at all | No | PASS |

NOTE for the reader, not a repo defect: the CLAUDE.md snapshot injected into this verifying agent's own prompt at session start was STALE and still showed the pre-2.3.0 partial block (`FXL_HUB_API_URL=http://localhost:9016` alongside blank client id/secret). The file ON DISK at HEAD is correct - `sed -n '522,540p' CLAUDE.md` shows those three lines commented out with a blank assignment beneath each. Do not act on the stale copy.

### 2.4 Renames complete - PASS

`node scripts/no-legacy-env-names.mjs` exits `0`, and its own 11-test guard suite is green.

Manual sweep of `apps/`, `packages/`, `scripts/`, `.github/`, `docker-compose.yml`, `apps/api/Dockerfile` and every `.env*`:

- `FXL_HUB_POST_LOGIN_REDIRECT` - zero hits.
- `FXL_HUB_POST_LOGIN_ERROR_REDIRECT` - zero hits.
- `HUB_SESSION_ENCRYPTION_KEY` - every hit is the SDK's CANONICAL `FXL_HUB_SESSION_ENCRYPTION_KEY`, of which the retired bare name is a suffix. That is a different, real, SDK-owned variable. The guard has a dedicated test for exactly this false positive (`tolerates the SDK's canonical name, of which the retired one is a suffix`). No bare retired name survives anywhere.

`apps/api/src/env.ts` declares `SALES_POST_LOGIN_REDIRECT`, `SALES_POST_LOGIN_ERROR_REDIRECT`, `SALES_SESSION_ENCRYPTION_IKM` and the new `FXL_HUB_TRUSTED_ORIGINS`, and no longer declares any of the three retired names.

### 2.5 Session sealer intact - PASS

- `git diff 5eeff1e..HEAD -- apps/api/src/auth/session-crypto.ts` is COMMENT-ONLY. Not one line of executable code changed.
- HKDF constants unchanged and verified at HEAD: `HKDF_SALT = 'fxl-sales/hub-bff-session/v1'`, `HKDF_INFO = 'aes-256-gcm'`, `FORMAT_VERSION = 'v1'`, `KEY_BYTES = 32`, derivation `hkdfSync('sha256', ikm, HKDF_SALT, HKDF_INFO, KEY_BYTES)`. Existing seals still open; the rename causes no mass logout by itself.
- Still OPTIONAL and still `emptyToUndefined`: `apps/api/src/env.ts:75` - `SALES_SESSION_ENCRYPTION_IKM: emptyToUndefined`. The examples ship it blank, and `??` would not catch `''`, so this remains load-bearing.
- Exactly ONE read site: `apps/api/src/middleware/app-auth.ts:263` - `encryptionIkm: env.SALES_SESSION_ENCRYPTION_IKM ?? hubSdkConfig.clientSecret`. Grep over `apps`, `packages`, `scripts` finds no other read; every other occurrence is a comment, a test stub, or a guard-script string.
- Fallback to the Hub client secret when absent: preserved by that `??`, and pinned by `falls back to the client secret when SALES_SESSION_ENCRYPTION_IKM is absent` and `boots with the blank SALES_SESSION_ENCRYPTION_IKM that .env.dev.example ships` in `app-auth-bff-wiring.test.ts`.

### 2.6 Untouched parts really untouched - PASS

`git diff --stat 5eeff1e..HEAD` over the tree shows changes confined to: `apps/api/src/{config,env.ts,middleware/app-auth.ts,auth/session-crypto.ts}` plus their tests, `apps/api/test/unit-setup.ts`, `apps/api/vitest.config.ts`, both `package.json` pins, `scripts/`, the four `.env` examples, `README.md` and `CLAUDE.md`.

- `apps/web/src` - **zero** changed files in the whole range. So no UI change, and by construction no newly rendered raw account or workspace id, and the web-side deny-taxonomy branching (`isAuthFailure` / `isEntitlementFailure` / `isForbiddenFailure`) is byte-unchanged.
- `apps/api/src/domains`, `apps/api/src/db`, `apps/api/src/routes`, `apps/api/drizzle` - **zero** changed files. No tenant-scoping filter, no RLS policy, no migration touched. `apps/api/test` gained only the new `unit-setup.ts`.
- `packages/` - **zero** changed files.
- The single access gate: the non-comment diff of `app-auth.ts` touches only the config PLUMBING. `const hubAuthMiddleware = hubSdkConfig ? requireHubAuth(hubSdkConfig) : null;` is unchanged, `allowWithoutAccess` is still absent (default `false`, which IS the gate), and there is still exactly one gate. What changed is that `requireHubAuth` now receives the WHOLE config rather than a five-field projection - a superset, not a relaxation.
- The deny taxonomy: `appAuthMiddleware` is unchanged apart from dropping the now-redundant `|| !hubAuthConfig` from its null guard. The `503 hub_auth_not_configured` body and the `401 missing_hub_context` backstop are byte-identical, and the 401/402/403 bodies still come from the SDK. `app-auth-access-gate.test.ts`, which drives the REAL verifier against an in-process RSA keypair, is green.
- The session store contract: `apps/api/src/auth/hub-session-store.ts` is unchanged in the range. `sessionTtlSeconds` / `sessionAbsoluteTtlSeconds` are still derived from the store's own constants, the durable-store narrowing and the `/auth/callback` supersede mount are unchanged, and `timeoutMs: 5_000` is still passed.

One deliberate new file worth calling out, reviewed and judged sound: `apps/api/test/unit-setup.ts` blanks the six credential-bearing names for the UNIT branch only. It is necessary rather than cosmetic - because a partial config is now a boot failure, a developer `.env` predating the canonical names made three sales-ops route files fail to IMPORT. It cannot mask a real failure: `vi.stubEnv` overwrites, setup files run before the test module, and every file that wants a configured Hub stubs its own values behind `vi.resetModules()`. It is not applied to the integration or RLS branches.

## Phase 3 - security review of `5eeff1e..HEAD`

| Axis | Finding |
| --- | --- |
| Credential VALUE in a tracked file | **None.** The only `pk_`/`sk_`-shaped literals added anywhere in the range are two test fixtures that say so in their own text: `pk_fxl-sales_development_unit-test-only-0123456789` and `sk_fxl-sales_development_unit-test-only-not-a-real-secret-0123456789`. Every `.env` example, doc block and guard script ships the credential slots BLANK. |
| Auth or entitlement gate weakened | **None.** One gate, still `requireHubAuth(hubSdkConfig)` with `allowWithoutAccess` at its default `false`. No new bypass branch; the config it is given grew, it did not shrink. The boot posture got STRICTER in two places: a partial config is now a boot failure instead of a permanent 503, and a redirect uri on the Hub's own origin is now refused outside development, which nothing refused before. |
| Tenant-scoping filter touched | **None.** Zero changed files under `apps/api/src/domains`, `src/db`, `src/routes` or `drizzle`. `getHubLegacyAuthContext` still sets `orgId` from `auth.workspaceId` and is unchanged. |
| Raw account or workspace id newly rendered in UI | **None.** `apps/web/src` has zero changed files in the range. |
| New logging that could print a secret | **None.** The only `console.*` in the changed API config path is the pre-existing `apps/api/src/env.ts:84`, which prints zod `fieldErrors` - field NAMES and messages, no values - and is unchanged by this range. I additionally audited the SDK messages that now surface through our boot: the only value interpolations in `loadHubConfig` / `assertBootConfiguration` are for `trustedOrigins` entries, `redirectUri`, `apiUrl` and a URL protocol - all public, non-secret configuration - plus the session key's LENGTH in characters, never its bytes. `clientSecret` and `clientId` values are never interpolated into any message. `app-auth-partial-config.test.ts` additionally pins `expect(error.message).not.toContain(HUB_CLIENT_ID)`. |
| Em dash under `apps/`, `packages/`, `scripts/` | **None introduced.** `git diff 5eeff1e..HEAD -- apps packages scripts | grep '^+.*—'` is empty. |
| Commit attribution | **Clean.** No commit in the range carries a `Co-Authored-By:` trailer or a robot/agent attribution line (`git log 5eeff1e..HEAD --format=%B | grep -icE '^co-authored-by|🤖'` returns `0`). |

## Defects

**None blocking.** No defect was found in the integrated trunk.

One observation recorded, which is a property of this machine and not of the code: `apps/api/.env` (untracked) still carries the pre-2.2.0 era names - `FXL_HUB_API_URL` (set, non-empty), `FXL_HUB_PUBLISHABLE_KEY`, `FXL_HUB_SECRET_KEY`, `FXL_HUB_REDIRECT_URI` - and none of `FXL_HUB_ENVIRONMENT`, `FXL_HUB_CLIENT_ID`, `FXL_HUB_CLIENT_SECRET`, `FXL_HUB_AUDIENCE`. Under the new contract that is a PARTIAL configuration, so the local API will now refuse to boot with a `HubConfigError` naming the missing field. That is the intended v3.1.0 behaviour and is strictly better than the old silent 503, but it means the local dev server will not start until this file is updated. The same is true of any staging or production environment still set on the old names. I did not modify the file.

## What an OPERATOR must do before deploying

In this order. Items 1 and 2 are outage-grade.

1. **Set `FXL_HUB_TRUSTED_ORIGINS` in staging and in production, before the deploy.** This is the single highest-risk item in the whole feature. It used to be `env.CORS_ORIGIN` in code and now comes only from this variable, and I confirmed in the SDK's own `dist/server.js:474` that there is NO fallback - `new Set(normalizeTrustedOrigins(resolved.trustedOrigins))` over an absent value is an EMPTY set, and `dist/server.js:486` then answers `403 {"error":"forbidden","code":"origin_not_trusted"}` to every cross-origin POST. Because the web app is on `sales.fxlbusiness.com` and the API on `sales-api.fxlbusiness.com`, unset reproduces the 2026-08-10 outage exactly. Set it to the WEB origin. It is comma-separated and every entry must be an absolute http(s) origin.
2. **Migrate every environment onto the five canonical identity names** (`FXL_HUB_API_URL`, `FXL_HUB_ENVIRONMENT`, `FXL_HUB_CLIENT_ID`, `FXL_HUB_CLIENT_SECRET`, `FXL_HUB_AUDIENCE`), or onto the single `FXL_HUB_CONFIG` JSON object - never both, which is a boot failure naming the offenders. A partial set no longer degrades to a 503; it stops the process. Any environment still holding `FXL_HUB_PUBLISHABLE_KEY` / `FXL_HUB_SECRET_KEY` will fail to boot. This includes Infisical `staging` and `prod`, the Coolify service env, and the developer's own `apps/api/.env`.
3. **Set `FXL_HUB_REDIRECT_URI` explicitly everywhere.** It is no longer resolved locally and an absent value is NOT left absent - it defaults to `${FXL_HUB_API_URL}/auth/callback`, which is the HUB's own origin. Outside development the boot now refuses that, so an unset variable is a boot failure; in development it boots and fails at the login screen instead. It must match a redirect uri registered on the Client byte for byte.
4. **Set `FXL_HUB_HEALTH_TOKEN` in staging and production.** It is operator-generated, never issued by the Hub, and `assertBootConfiguration` now requires it whenever the environment is not `development`.
5. **Rename the three variables in every secret store**: `HUB_SESSION_ENCRYPTION_KEY` to `SALES_SESSION_ENCRYPTION_IKM`, `FXL_HUB_POST_LOGIN_REDIRECT` to `SALES_POST_LOGIN_REDIRECT`, `FXL_HUB_POST_LOGIN_ERROR_REDIRECT` to `SALES_POST_LOGIN_ERROR_REDIRECT`. Carry the VALUES across unchanged. The HKDF salt, info, version and key length are all unchanged, so a carried-across IKM keeps every stored session openable; DROPPING the value instead falls back to an HKDF derivation of `FXL_HUB_CLIENT_SECRET` and logs every user out once.
6. Do NOT set `FXL_HUB_SESSION_ENCRYPTION_KEY`. It is a real SDK-canonical name but it keys the SDK's own `SqlHubSessionStore`, which this repo does not use, so a value pasted there does nothing. It is deliberately absent from the examples.
7. Confirm `FXL_HUB_ENVIRONMENT` equals the environment segment inside `FXL_HUB_CLIENT_ID`, and `FXL_HUB_AUDIENCE` equals `app.` plus that client id's slug. Both are checked offline at boot, so a mismatch is a refusal to start rather than a runtime 401.

## Verdict

`master` is **SAFE** as the trunk.

Every Phase 1 gate passes with a real exit code of `0`, on a genuinely cold build, with per-package test counts matching expectation exactly (80 / 445 / 784 / 11) and the integration suite green against the local Docker database on 5006. The boot path resolves and validates the Hub contract exactly once. All three env states are proven by isolated tests rather than by argument. The artefact class that produced this feature's one Gate 2 failure is now under a 17-test oracle that reads the shipped files themselves. The renames are complete, the session sealer is byte-compatible with existing seals, and the access gate, deny taxonomy, tenant scoping and session-store contract are all provably untouched - `apps/web/src`, `apps/api/src/domains`, `src/routes`, `src/db`, `drizzle` and `packages/` have zero changed files in the entire range. The security review is clean on every axis.

The residual risk is entirely OPERATIONAL and is listed above: this feature converts several silent misconfigurations into loud boot failures, which is the improvement, but it means no environment may be deployed onto without first being migrated to the canonical names, and `FXL_HUB_TRUSTED_ORIGINS` in particular has no fallback left.
