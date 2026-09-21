# Verify - slice 02.1-dev-fake-hub-config-independence

Verdict: PASS

## Scope reviewed

- `apps/api/src/middleware/app-auth.ts` (uncommitted diff)
- `apps/api/src/auth/__tests__/dev-identity-hub-config-independence.test.ts` (new, uncommitted)
- Confirmed byte-unchanged: `apps/api/src/config/auth-provider.ts`, `apps/api/src/auth/select.ts` (`git diff HEAD` empty for both)

## Code reading

`resolveHubSdkConfig()` wraps `tryLoadHubAuthConfig(hubEnvBag(env))` in a `try/catch` whose absorb condition is:

```
error instanceof HubConfigError && isDevIdentityFlagActive() && !isProductionProcess()
```

All three conjuncts are required. On absorb it returns `null` (the same value the pre-existing "machine has no credentials at all" path already returns) and logs a `[dev-identity]` warning naming the underlying message; otherwise it rethrows unchanged. `isDevIdentityFlagActive()` reads `process.env.SALES_AUTH_FAKE` directly (truthy set `{1,true,yes,on}`, case/whitespace tolerant) and `isProductionProcess()` reads `process.env.NODE_ENV` directly - both duplicated intentionally from `select.ts` to avoid a value-import cycle (documented in the code comment, and `select.ts` is confirmed unchanged so nothing there was touched to enable this). Everything downstream (`hubAuthMiddleware`, `hubAppAuthMiddleware`, `createAppAuthBff`, the `503 hub_auth_not_configured` branch) is unchanged and keys off `hubSdkConfig` exactly as before, so the "no credentials at all -> 503" path is untouched code, not a new branch.

## Test run - new oracle file

`npx vitest run src/auth/__tests__/dev-identity-hub-config-independence.test.ts` (apps/api): **3/3 pass**.

1. "boots and installs the adapter when the Hub configuration is partial and the flag is set" - drives `installFakeAuthIfRequested()` then a real Hono app through `appAuthMiddleware`, asserts `200` and the correct `userId`/`orgId` for a `team-admin` fake identity, with global `fetch` stubbed to throw (proves no Hub contact happens).
2. "still fails the boot on a partial Hub configuration when the flag is absent" - same partial env, `SALES_AUTH_FAKE=''`, asserts the import rejects with the SDK's own `FXL_HUB_CONFIG.environment must be exactly one of ...` message, unchanged.
3. "refuses to boot on a partial Hub configuration when the flag is set but the process is production" - `NODE_ENV=production`, flag set, asserts the same rejection - production is never an escape hatch.

## Check 2 - generic error must still escape (not covered by the shipped test, verified independently)

The shipped oracle file does not itself contain a case that throws a non-`HubConfigError` while the flag is active. I wrote and ran a throwaway probe (deleted immediately after, confirmed via `git status` that it left no trace) that mocks `tryLoadHubAuthConfig` to throw a plain `Error('a totally generic, non-HubConfigError failure')` with `SALES_AUTH_FAKE=1` and `NODE_ENV=test`, and asserted the import rejects with that message.

Result: **passes** - the plain `Error` escapes uncaught, exactly as the code's `instanceof HubConfigError` guard promises.

**Gap found**: this discrimination is not pinned by any test in the slice's own committed oracle. Mutation probe 3 below confirms the gap is real (widening the `instanceof` check to `Error` does not fail the shipped suite). The code is currently correct; the regression protection for "only `HubConfigError`, never anything broader" is currently supplied only by my throwaway probe, which does not survive this verification run. Recommend adding a dedicated case to the committed test file before merge, but I did not add it myself (out of scope: instructed not to fix).

## Mutation probes (each applied to `apps/api/src/middleware/app-auth.ts`, run against the new test file, then reverted; file diffed against the pre-mutation copy afterward and confirmed identical)

1. **Remove `!isProductionProcess()`** from the catch condition (leaving `error instanceof HubConfigError && isDevIdentityFlagActive()`):
   Result: test 3 ("refuses to boot ... but the process is production") goes **red** - the import resolves instead of rejecting. Confirms the production condition is load-bearing and tested.

2. **Remove `isDevIdentityFlagActive()`** from the catch condition (leaving `error instanceof HubConfigError && !isProductionProcess()`) - the decisive probe:
   Result: test 2 ("still fails the boot ... when the flag is absent") goes **red** - the import resolves instead of rejecting. Confirms the flag condition is load-bearing and tested; the tolerance cannot silently become unconditional-outside-production without the suite noticing.

3. **Widen the catch to `error instanceof Error`** instead of `error instanceof HubConfigError` (flag and production conditions kept):
   Result: all 3 shipped tests stay **green**. This is the gap noted above under "Check 2" - reported per the task's own instruction ("report it as a gap") rather than treated as an automatic fail, because the actual shipped code (unmutated) demonstrably still narrows to `HubConfigError` only (see the independent probe above). The gap is in test coverage, not in behavior.

All three mutations were reverted; `diff` against the pre-mutation copy of the file confirmed byte-identical restoration, and no `.bak` files were left behind.

## Live boot proof (reproduced independently)

`apps/api/.env` in this worktree carries a genuinely partial Hub configuration - `FXL_HUB_API_URL` and `FXL_HUB_REDIRECT_URI` set (via legacy `FXL_HUB_PUBLISHABLE_KEY`/`FXL_HUB_SECRET_KEY`, not the canonical `FXL_HUB_CLIENT_ID`/`FXL_HUB_CLIENT_SECRET`/`FXL_HUB_ENVIRONMENT`/`FXL_HUB_AUDIENCE`), with no `FXL_HUB_CONFIG`. Confirmed nothing was listening on 9016 or 3006 before starting.

```
SALES_AUTH_FAKE=1 pnpm --filter @fxl-sales/api dev
```

Log output:
```
[dev-identity] Ignoring the Hub configuration because SALES_AUTH_FAKE is active: hub-sdk: FXL_HUB_CONFIG.environment must be exactly one of "production", "staging" or "development". It is EXPLICIT configuration and is never inferred from the process environment.
[dev-identity] SALES_AUTH_FAKE is active. Roster: team-owner, team-admin, product-admin, seller, finder, seller-finder, no-role, no-access, multi-org. Default identity: team-owner. Switch with the "x-fake-identity" header.
[fxl-sales-api] listening on http://localhost:3006 (development)
```

`curl -s -o /dev/null -w '%{http_code}' http://localhost:3006/health` -> **200**.

Additionally probed `GET /api/v1/sales-ops/bootstrap` with header `x-fake-identity: team-admin` -> **200** with a real bootstrap payload, confirming an authenticated request is actually served through the installed adapter (not just `/health`). Note (out of scope for this slice, not a defect of it): the same endpoint with no `x-fake-identity` header also answered 200, because the dev-fake-identity adapter's own documented default-identity behavior (`team-owner`) applies when no header is sent - that is pre-existing behavior of the dev-fake-identity feature, not something this slice introduced or is responsible for.

Process cleanup: captured PID chain (`pnpm` -> `pnpm.cjs` -> `tsx watch` -> node server), killed each by exact PID from child to parent, verified all four gone via `kill -0`, and confirmed ports 3006 and 9016 both free afterward. No name-pattern kills were used; two unrelated tsx dev servers for other projects on the same machine (fxl-finance, fxl-harness) were left untouched.

## Full verification suite

- `pnpm --filter @fxl-sales/api test`: **54 files / 545 tests, all pass** (includes the new oracle file and all pre-existing `dev-identity-*` and `app-auth*` suites, unmodified).
- `pnpm run lint` (root): clean, no errors on either `apps/api` or `apps/web`.
- `pnpm run type-check` (root): clean, all workspaces (`shared-types`, `shared-utils`, `auth-fake`, `api`, `web`).
- `pnpm test` (root): exit 0. `shared-utils` 80/80, `auth-fake` 35/35, `api` 545/545, `web` 940/940, plus the tracked-file/build-contract guard scripts (21/21 subtests, including the local-database-guard and legacy-env-name guards).

## Other checks

- No existing test's title or assertion changed: `git diff HEAD` for `dev-identity-no-hub.test.ts` and `dev-identity-production-refusal.test.ts` is empty; the new file only adds a new `describe` block.
- No em dash or en dash in any added line (checked both the `app-auth.ts` diff and the full new test file byte-for-byte with a Unicode-aware grep).
- `apps/api/src/config/auth-provider.ts` and `apps/api/src/auth/select.ts`: confirmed byte-unchanged (`git diff HEAD` empty for both).

## Summary

Both acceptance conditions hold: with the flag set and not-production, a partial/invalid Hub configuration no longer aborts boot and an authenticated fake-identity request is served end to end (live-proven); with the flag absent, the identical configuration still throws the SDK's own unmodified message (test-proven and mutation-proven). The `503 hub_auth_not_configured` no-credentials path is untouched code and unaffected. The one real gap is that the shipped test file does not itself pin "only `HubConfigError`, nothing broader" - the code is correct today (verified independently) but that specific invariant currently relies on my throwaway probe rather than a committed regression test.
