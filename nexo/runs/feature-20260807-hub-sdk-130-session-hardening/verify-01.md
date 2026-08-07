# Verify - slice 01 `01-sdk-130-store-port`

VERDICT: **PASS**

Branch `feat/01-sdk-130-store-port`, slice commit `1d0b0a0`, baseline `master`.
Every acceptance clause is proven by a named oracle, and both required mutations turned the suite red.

## Command results

| Command | Exit | Headline |
| --- | --- | --- |
| `pnpm run type-check` | 0 | 4 projects (`shared-types`, `shared-utils`, `api`, `web`), all Done |
| `pnpm run lint` | 0 | `eslint src/` clean in `apps/api` and `apps/web` |
| `pnpm test` | 0 | 88 files / 1038 tests passed (api 37/366, web 48/592, shared-utils 3/80) |
| `pnpm run build` | 0 | api + web built, web bundle `built in 1.68s` |
| `pnpm --filter @fxl-sales/api test:integration` | 0 | 24 files / 159 tests passed, 13.44s |
| `pnpm install --frozen-lockfile` | 0 | `Lockfile is up to date, resolution step is skipped` |

No failures to report.

## Mutation testing

Both mutations were applied to the working tree, run, then restored from a byte copy taken beforehand.
`git status --porcelain` after the last revert shows only the two untracked files that were present when I started (`.vscode/`, `nexo/runs/.../AUDIT.md`).
The tree is clean of anything I introduced.

| # | Mutation | Expected | Observed | Reverted |
| --- | --- | --- | --- | --- |
| a | Delete `.for('update')` from `apps/api/src/auth/hub-session-store.ts:115` | Concurrency oracle red | **RED.** `test/rls/hub-bff-session-store.test.ts > serializes two concurrent refreshes...` failed with `bSaw: "token-old"` (expected `"token-a"`) and `bWhileLocked: "entered"` (expected `"blocked"`). 1 failed / 11 passed. | Yes - re-ran, 12/12 green |
| b | Replace `router.onError(hubBffErrorHandler)` with a no-op in `apps/api/src/middleware/app-auth.ts:226` | 503 oracle red | **RED.** `src/middleware/__tests__/app-auth-bff-wiring.test.ts > answers 503 rather than a cookie-clearing 401 ... through app.route('', authBff)` failed with `expected 500 to be 503`. 1 failed / 12 passed. | Yes - re-ran, 20/20 green across the three unit oracle files |

Mutation (a) failed on **both** halves of the assertion object at once - B entered the callback while A held the lock, and B then read the pre-rotation token.
That is the precise lost-update the lock exists to prevent, so the test is a genuine oracle rather than a timing coincidence.

Mutation (b) is worth one note: `src/auth/__tests__/hub-bff-errors.test.ts` stayed green under it, because that file constructs its own router and mounts the handler itself.
That is correct and expected - it is a unit test of the handler, not of the wiring - and the wiring test is what covers the mount.
So the two files are not redundant, and the one that must go red did.

## Findings against checks 1-7

### 1. Oracle non-vacuity - PASS

Covered above.
Both named oracles are load-bearing.

Two further non-vacuity controls already in the tree are real, not decorative:

- `test/rls/hub-bff-session-store.test.ts:110-116` asserts inline that `InMemoryHubSessionStore` **fails** the restart-survival assertion, and that `memA.get(memSid)` is non-null so the failure is about the restart rather than a broken `create`.
- `src/auth/__tests__/hub-bff-errors.test.ts:122-133` asserts the anti-oracle: a store that degrades to `null` instead of throwing produces `401` **with** a `Set-Cookie`. That pins the exact failure mode the 503 exists to prevent.

### 2. Lock inside the transaction, spanning read and write - PASS

`apps/api/src/auth/hub-session-store.ts:107-164`.
`db.transaction` opens at 107; the `SELECT ... FOR UPDATE` is the first statement inside it (111-116), before the `HubSessionTransaction` handle is built and before `operation(handle)` is called at 163.
`update` (144-157) and `delete` (158-160) both issue against the same `tx` handle, so the write is in the same transaction as the lock, and the lock releases only at commit when the callback returns.

The lock is not merely taken - it is proven to span the whole read-modify-write by the integration oracle: B is `'blocked'` for the full 1s window while A holds, and once A commits B reads `'token-a'`, which is only possible if A's write landed under the same lock B was waiting on.
A lock taken and released before the operation would have produced `bSaw: 'token-old'`, which is exactly what mutation (a) reproduced.

### 3. The 503 path is real - PASS

The end-to-end oracle is `src/middleware/__tests__/app-auth-bff-wiring.test.ts:246-278`.
It builds `const app = new Hono(); app.route('', authBff);` at 258-262 against the **real** `createAppAuthBff()` result and the **real** SDK, then requests `/auth/refresh`.
That is the mount `apps/api/src/server.ts:33` uses, not a bare sub-app, so the false-positive trap the plan named is avoided.
Mutation (b) confirms it: without the `onError`, this test - and only this test - reports `500`.

The plan's mechanism claim also checks out against the installed Hono.
`node_modules/.pnpm/hono@4.12.28/.../dist/hono-base.js:115-118` is `if (app.errorHandler === errorHandler) { ...unwrapped... } else { handler = async (c, next) => (await compose([], app.errorHandler)(c, () => r.handler(c, next))).res }` - so a non-default sub-app `errorHandler` really is wrapped around the flattened routes.
`hono-base.js:272-273` guards `if (err instanceof Error) return this.errorHandler(err, c)`, so `hubBffErrorHandler`'s `'getResponse' in err` can never be handed a primitive.
And `hono-base.js:10-12` is the default handler, which `hub-bff-errors.ts:28-33` reproduces line for line, so the non-store branches are provably unchanged.

That non-store branch is itself pinned twice: a bare `Error` must stay a plain-text `500` (`hub-bff-errors.test.ts:88-107`) and an `HTTPException(403)` must still surface its own response (109-120).

### 4. `hub-session-scope.ts` and its test are gone - PASS

Neither `apps/api/src/auth/hub-session-scope.ts` nor `apps/api/src/auth/__tests__/hub-session-scope.test.ts` exists.
A repo-wide grep across `apps/api/src` and `apps/web/src` for `hub-session-scope`, `createHubSessionScopeMiddleware`, `AsyncLocalStorage`, `withRequest`, `hubSessionCookieName` and `hydrate` returns **zero code hits**.
The only matches are three prose comments saying the middleware is gone, plus unrelated `rehydrates`/`hydrates` test titles in `apps/web`.
Nothing hydrates a working set around the BFF handler any more.

`server.ts:31-33` is unchanged (`const authBff = createAppAuthBff(); if (authBff) app.route('', authBff);`), which is what lets the `onError` live inside the returned router and not be forgettable at the call site.

### 5. Dependency resolution - PASS, with the patch explained

**hub-sdk.** `pnpm ls @fxl-business/hub-sdk -r` reports `1.3.0` for both `@fxl-sales/api` and `@fxl-sales/web`.
The lockfile carries exactly one entry (`pnpm-lock.yaml:750`, `3240`) and no `1.2.0` remains.
Both apps symlink to the **same** store directory, so there is one SDK copy, not two.

**hono.** `pnpm ls hono -r --depth 0` reports a single `hono 4.12.28`.
`pnpm-lock.yaml` contains exactly one `hono@` package entry (`2060`, `4496`), and every consumer (`hub-sdk`, `@hono/node-server`, `@hono/zod-validator`, `apps/api`) resolves to `4.12.28`.
`apps/api/node_modules/hono` symlinks to `.pnpm/hono@4.12.28`.
The pin is belt-and-braces: `apps/api/package.json:27` is the exact `"hono": "4.12.28"` **and** `pnpm-workspace.yaml` carries an `overrides: hono: 4.12.28`, which is what actually forces the SDK's `>=4.12.28` peer onto the same copy given `.npmrc` has `strict-peer-dependencies=false`.
No second Hono is live.

**The patch - what it actually changes.** `patches/@fxl-business__hub-sdk@1.3.0.patch` modifies **only `package.json`**, and only four fields: `main`, `module`, `types` and `exports`.
It changes **no dependency code**. I verified this by reading the whole patch - it is a single hunk in a single file.

It is load-bearing, and the reason is a genuine upstream packaging bug, which I confirmed directly against the unpatched tarball in the store:

- unpatched `1.3.0`: `main: "./src/index.ts"`, `exports` all pointing at `./src/*.ts`, but `files: ["dist","schema","MIGRATION.md"]`.
- the installed unpatched directory contains `dist/`, `schema/`, `MIGRATION.md`, `package.json` - **no `src/`**.
- `1.2.0` (the master baseline) shipped `main: "./dist/index.cjs"` and dist-pointing `exports` correctly.

So the published `1.3.0` is unresolvable by Node or Vite as-is; the Hub did not apply its `publishConfig` swap on this release.
The patch rewrites those fields to the dist paths, which is what `1.2.0` already had. Without it nothing imports and the slice cannot exist.
It is documented in `CLAUDE.md` and carries a `nexo/ROADMAP.md` entry saying to delete it (with the `patchedDependencies` line) once the Hub republishes.

**`pnpm-workspace.yaml`.** Two functional changes: `hono` override `4.12.25` to `4.12.28`, and a new `patchedDependencies` entry keyed to `@fxl-business/hub-sdk@1.3.0`.
The rest of the diff is pnpm's own writer reformatting the file (unquoting `apps/*`, alphabetizing `overrides`, reordering `allowBuilds` above `overrides`) - cosmetic churn with no semantic effect, but it does make the diff read larger than the change is.

### 6. Scope discipline - PASS

`absoluteExpiresAt` appears exactly once in the whole of `apps/api/src`, `apps/api/test` and `apps/web/src`: as a **comment** at `hub-session-store.ts:89` explaining that the SDK's create-time value is ignored.
No column, no migration, no read.

`sessionTtlSeconds` and `sessionAbsoluteTtlSeconds` appear **nowhere** - not passed to `createHubBff` (`app-auth.ts:211-218` passes `sessionStore`, `secureCookies`, `timeoutMs`, `redirectUri`, `postLoginRedirect`, `postLoginErrorRedirect` and nothing else), and, importantly, **not asserted absent** either.
The wiring test reads only `bffOptions?.sessionStore` and `bffOptions?.timeoutMs` (`app-auth-bff-wiring.test.ts:139-151`); there is no whole-object `toEqual` and no `toBeUndefined` on a TTL option, so slice 02 can add them without breaking a test.
Slice 02 is not pre-empted.

### 7. Must-not-break - PASS

**PKCE single-use at the database level.** `hub-session-store.ts:200-203` is one `delete(hubBffLoginTxns).where(eq(id)).returning()` with no `WHERE` on `expires_at`, executed on the pooled `#db` and therefore atomic on its own.
Only one statement can return the row, so a replayed `/auth/callback` cannot retry the verifier across replicas.
The expiry check runs **after** the delete (209-211), so an expired row is removed rather than left behind.
Both properties are pinned against real Postgres: `consumes a login transaction exactly once across instances` (312-327) asserts the second consume is `null` **and** the table row is gone, and `deletes an expired login transaction on consume and returns null` (329-342) asserts the row count is 0 afterwards.

**No degrade to an empty result.** Every failure path throws rather than returning absence:
`create` (96-98), `withSession` (165-171), `createLoginTransaction` (187-189) and `consumeLoginTransaction` (205-207) each wrap their catch in `#unavailable(...)`.
`withSession`'s single `catch` is outside the transaction and the operation's return value is never in scope there, so there is structurally no variable a catch could hand back - which is the flush-hole closure the Frame asked for.
Three unit tests pin it (`hub-session-store.test.ts:75-147`): commit failure, lock-read failure, operation failure, all rejecting with `HubSessionStoreUnavailableError` carrying the right `cause`, and the commit test additionally asserts `not.toHaveProperty('resolved')`.
The integration half (`rolls back the update and rejects when the operation fails after writing`, 227-250) proves the row still holds the pre-operation token against real Postgres.

The only `null` returns left are semantically correct absences: an unknown id, an expired row (deleted first), and a seal that will not open.
The seal case is deliberate and asserted to **leave the row** (`never stores the Hub refresh token in plaintext`, 291-310) so a wrong key costs one re-login rather than data.

**`app-auth-bff-wiring.test.ts` still asserts store identity.** Line 143: `expect(bffOptions?.sessionStore).toBe(durableStore)`, plus `not.toBeInstanceOf(InMemoryHubSessionStore)` at 140.
Intact.

**Cross-tenant isolation.** `is invisible to the ordinary tenant connection` (344-364) is unchanged and still proves FORCE RLS both ways: the admin context sees the row, the app connection sees zero and its `INSERT` rejects.

## Green but concerning

None of these is a failure. Recording them so they are not discovered later as surprises.

1. **The patch key is exact but the dependency range is a caret.** Both `apps/api/package.json:19` and `apps/web/package.json:16` declare `"^1.3.0"`, while `pnpm-workspace.yaml` keys the patch to `@fxl-business/hub-sdk@1.3.0` exactly.
   If the Hub publishes a `1.3.1` that still has the packaging bug, a `pnpm update` resolves it unpatched and the package becomes unresolvable again - the failure would land at import time, remote from the cause.
   `--frozen-lockfile` installs are safe today. Consider pinning the range exactly for as long as the patch exists.

2. **Store leftovers can be mistaken for a dual-Hono.** `node_modules/.pnpm/` still contains `hono@4.12.25` and three stale `@fxl-business+hub-sdk@*` directories (including `1.2.0_hono@4.12.25` and an unpatched `1.3.0_hono@4.12.28`).
   None is referenced by `pnpm-lock.yaml` and none is linked from any workspace `node_modules` - `pnpm ls -r` sees only `4.12.28` and the patched SDK, so this is garbage awaiting `pnpm store prune`, not a live second copy.
   Anyone re-checking the dual-Hono risk by `ls`-ing `.pnpm` will get a false alarm; check the symlink targets instead.

3. **`hub-bff-errors.test.ts` alone would not catch a mount regression**, since it builds its own router.
   That is by design and the wiring test covers it, but it means the wiring test is the single point of failure for the `route()` flatten-and-wrap behaviour the plan flagged as hono-bump-fragile.
   It is correctly written (real SDK, real `app.route('', authBff)`), so this is a note rather than a gap.

4. **The `pnpm-workspace.yaml` reformat** inflates the diff. Only two lines are semantic; the other 25 are pnpm's writer normalizing quoting and ordering. Harmless, but it obscures review.

## Conclusion

The acceptance criterion holds in full.
The SDK resolves to a single patched `1.3.0`, `hub-session-scope.ts` and its test are gone with no residual hydrate path, the row lock is taken inside `withSession` before the operation and is proven by mutation to be what serializes two concurrent refreshes, a commit failure rejects rather than resolving and reaches the client as a `503` with the session cookie intact through the real `app.route('', authBff)` mount, the PKCE verifier is consumed exactly once by a single `DELETE ... RETURNING`, and the durable store instance still reaches `createHubBff` alongside `timeoutMs: 5_000`.
All five gate commands are green and the slice stayed inside its scope.
