# Verify report: 02-api-dev-adapter

Status: PASS

## Suites run (real output)

- `pnpm --filter @fxl-sales/api test` -> 53 test files, 542 tests, all passed.
- `pnpm run lint` (root) -> apps/api and apps/web eslint both clean, no errors.
- `pnpm run type-check` (root) -> packages/shared-types, packages/shared-utils, packages/auth-fake, apps/api, apps/web all `tsc --noEmit` clean.
- `pnpm test` (root, full suite) -> packages/auth-fake 35/35, packages/shared-utils 80/80, apps/api 542/542, apps/web 915/915, plus `node --test` guard suite (local-database-guard, no-legacy-auth, no-legacy-env-names) 21/21, then `node scripts/no-legacy-auth.mjs`, `node scripts/no-legacy-env-names.mjs`, `node scripts/build-contract.mjs` all exited 0. Zero failures anywhere.

## Scrutiny items

1. **One-gate invariant.** Confirmed. `appAuthMiddleware` in `apps/api/src/middleware/app-auth.ts` is now `(c, next) => (installedAppAuthAdapter ?? hubAppAuthMiddleware)(c, next)`: the adapter slot REPLACES the Hub gate, never stacks beside it. `installAppAuthAdapter` throws on a second call ("was called a second time... must never stack a second one beside it"). `hubAppAuthMiddleware` (the real Hub gate) is otherwise byte-identical logic to the pre-slice `appAuthMiddleware` body, just renamed and factored through the extracted `applyHubAuthContext`. `requireHubAuth(hubSdkConfig)` construction and its default `allowWithoutAccess: false` are untouched.

2. **Boot ordering.** `apps/api/src/server.ts` still has EXACTLY two static imports: `./env.js` and `./db/local-database-guard.js`. The new hook (`const { installFakeAuthIfRequested } = await import('./auth/select.js'); await installFakeAuthIfRequested();`) sits immediately after the guard's `console.log` boot-line block and immediately before the first pre-existing dynamic import (`@hono/node-server`). `installFakeAuthIfRequested` returns `false` at its very first statement (`if (!isFakeAuthRequested(env)) return false;`) when the flag is absent, before importing anything else - so the flag-absent path performs no additional module evaluation and the rest of the dynamic-import list keeps its original order and bindings verbatim (confirmed by reading the file directly).

3. **Flag-absent path byte-equivalent to today.** Verified structurally (not merely assumed): `isFakeAuthRequested` short-circuits before any `import()`, `unit-setup.ts` blanks `SALES_AUTH_FAKE` for every unit test so the whole existing suite runs the untouched Hub path, and `app-auth-unconfigured.test.ts` (`git diff HEAD` against it) is a byte-identical, zero-line diff - it still gets 503 `hub_auth_not_configured` exactly as before.

4. **No static import of `@fxl-sales/auth-fake`.** Grepped `apps/api/src` for `auth-fake`: the only import sites are `await import('@fxl-sales/auth-fake')` inside `installFakeAuthIfRequested` (runtime) and inside test files (`dev-identity-no-hub.test.ts`'s dynamic imports, `dev-identity-production-refusal.test.ts`'s `vi.mock('@fxl-sales/auth-fake', ...)`). No static `import`/`import type` of the package anywhere in shipped source. `select.ts` reaches the module's shape only through a structurally-declared local `FakeIdentityModule` interface, and `apps/api/package.json` lists it only under `devDependencies`, `workspace:*`.

5. **402 body byte-exact.** `apps/api/src/auth/select.ts:200`: `c.json({ error: 'payment_required', code: 'no_org_access' }, 402)`. Pinned by `dev-identity-no-hub.test.ts`'s `resolves.toEqual({ error: 'payment_required', code: 'no_org_access' })` (exact-shape `toEqual`, not `toMatchObject`).

6. **Active Organization from the token.** `buildFakeAuthMiddleware` reads `requestedWorkspaceId = bearerToken ? fake.readTokenWorkspaceId(bearerToken) : null` and only falls back to `identity.activeWorkspaceId` when no token-carried workspace id is present. Directly tested by `dev-identity-no-hub.test.ts`'s "serves the Organization the token names, not the identity default, so a switch really switches", which mints a token for `multi-org` naming `org_fake_sul` (not the identity's default `activeWorkspaceId`) and asserts the response's `orgId` is `org_fake_sul` and explicitly `not.toBe(identity.activeWorkspaceId)`. A companion test proves a token naming a workspace the identity does NOT belong to is refused `401 unknown_fake_workspace` rather than silently accepted or silently falling back.

7. **No pre-existing test weakened.** `git diff HEAD -- apps/api/src/middleware/__tests__/app-auth-unconfigured.test.ts` is empty (byte-unchanged). `git diff --stat HEAD -- apps/api` shows only `package.json`, `middleware/app-auth.ts`, `server.ts`, `test/unit-setup.ts` modified (plus new untracked files) - no existing test file appears in the diff at all, so no existing test title or assertion changed.

8. **No em/en dash.** `git diff HEAD -- apps/api | grep '^+' | grep -P '[—–]'` and a direct grep of the untracked new files for `[—–]` both returned nothing.

## Mutation probes (each applied, verified red, then reverted)

1. **Production refusal, guard A** - removed the `if (isProductionEnv(env)) throw ...` block inside `installFakeAuthIfRequested` (`apps/api/src/auth/select.ts`). Result: `dev-identity-production-refusal.test.ts` -> 1 failed test (`refuses to install the development identity adapter under NODE_ENV=production`), the rest of the suite (541/542) still green. Reverted; confirmed source restored to original.

2. **Production refusal, guard B** - removed the `if (process.env.NODE_ENV === 'production') throw ...` block inside `installAppAuthAdapter` (`apps/api/src/middleware/app-auth.ts`). Result: `dev-identity-production-refusal.test.ts` -> 1 failed test (`refuses a direct installAppAuthAdapter call too, so the slot is not safe only because the caller checked first`); notably the FIRST test in that file (`refuses to install...`, which exercises guard A via `installFakeAuthIfRequested`) still PASSED, proving guard A is not masked by guard B and vice versa - each of the two independent guards is independently exercised by its own assertion. Reverted; `git diff --stat HEAD -- apps/api/src/middleware/app-auth.ts` confirmed identical to the pre-probe diff (77 insertions/8 deletions, unchanged).

3. **402 code string** - changed `'no_org_access'` to `'missing_entitlement'` in `select.ts`. Result: `dev-identity-no-hub.test.ts` -> 1 failed test (`answers 402 payment_required no_org_access for an identity whose Organization carries no access`), exact-shape mismatch. Reverted.

4. **Organization resolution source** - replaced `const workspaceId = requestedWorkspaceId ?? identity.activeWorkspaceId;` with `const workspaceId = identity.activeWorkspaceId;` (dropping the token read entirely) in `select.ts`. Result: `dev-identity-no-hub.test.ts` -> 2 failed tests (the token-names-the-org switch test, and the unknown-workspace-401 test, since the identity's own default workspace is always a member and the crafted "not a member" token was never consulted). Reverted.

After each probe and revert, `pnpm --filter @fxl-sales/api test` was re-run and returned 53/53 files, 542/542 tests green. Final `git status --short` matches the tree as found at the start of this verification (only the same tracked-file modifications and untracked new files listed in the task brief; no stray changes, nothing staged, nothing stashed).

## Conclusion

All required suites pass with real (not vacuous) evidence, all eight scrutiny items check out against the actual diffs and test assertions, and all four mutation probes independently turn tests red, including both halves of the two-guard production refusal. No pre-existing test was touched or weakened. **PASS.**
