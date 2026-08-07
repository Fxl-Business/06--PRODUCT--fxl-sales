# Slice 01 - SDK 1.3.0 bump and session-store port

Working notes.
Slices 02 and 06 build directly on this file, so every deviation from the plan is recorded explicitly below.

## Result

PASS.
The four named oracles are green, `type-check`, `lint`, `pnpm test` and `pnpm run build` are green, and the integration suite passes against the local Docker test database.

## What shipped

- `@fxl-business/hub-sdk` `^1.2.0` to `^1.3.0` in `apps/api` and `apps/web`.
- `hono` `4.12.25` to `4.12.28` in `apps/api/package.json` AND in the `pnpm-workspace.yaml` override (see deviation D1).
- `apps/api/src/auth/hub-session-store.ts` rewritten to the 1.3.0 contract (`create` / `withSession` / `createLoginTransaction` / `consumeLoginTransaction`), exactly as the plan specifies.
- `apps/api/src/auth/hub-bff-errors.ts` added and mounted as the BFF router's `onError`.
- `apps/api/src/auth/hub-session-scope.ts` and its test deleted.
- `timeoutMs: 5_000` passed to `createHubBff`; `sessionTtlSeconds` / `sessionAbsoluteTtlSeconds` deliberately NOT passed, and deliberately NOT asserted absent, so slice 02 can add them.
- `patches/@fxl-business__hub-sdk@1.3.0.patch` added (see deviation D2 - this is the big one).
- `CLAUDE.md` Auth Model rewritten, `nexo/ROADMAP.md` given two backlog entries, `HUB-RESPONSE.md` given a new section 1b.

## Deviations from the plan

### D1. The `hono` pin lives in a `pnpm-workspace.yaml` OVERRIDE, which the plan did not know about

The plan said to move `apps/api/package.json`'s `"hono": "4.12.25"` to `4.12.28`.
That alone does NOTHING: `pnpm-workspace.yaml` carries `overrides: { hono: '4.12.25' }`, and an override wins over every workspace specifier.
The first `pnpm install` after editing only `apps/api/package.json` still resolved `hono@4.12.25` and still linked the SDK as `1.3.0(hono@4.12.25)` - i.e. exactly the unmet-peer state the plan's risk section warns about, silently.

Both were moved.
The override is the load-bearing one, and it is also what guarantees a single Hono copy across the workspace.
A future SDK bump must edit `pnpm-workspace.yaml`, not just the app manifest.

The plan's unverified claim was re-checked as instructed: `hono/dist/compose.js` and `hono/dist/hono-base.js` are BYTE-IDENTICAL between `4.12.25` and `4.12.28` (`diff` exit 0 on both, comparing a pre-install copy of 4.12.25 against the installed 4.12.28).
So the Hono bump carries no behavioural change of its own, and the `onError` mechanism the slice relies on is unchanged.
`pnpm-lock.yaml` now contains exactly one `hono@` entry (`4.12.28`) and no `@fxl-business/hub-sdk@1.2.0`.

Side effect: `pnpm` rewrote `pnpm-workspace.yaml` (reordered the top-level keys, unquoted the override keys) when it added `patchedDependencies`. That reformat is pnpm's, not hand-made.

### D2. The published `@fxl-business/hub-sdk@1.3.0` tarball is BROKEN and had to be patched

**This is the most important thing in this file. Slices 02 to 06 all inherit it.**

The `1.3.0` on npm cannot be resolved by anything:

```
$ npm view @fxl-business/hub-sdk@1.3.0 main exports
main = './src/index.ts'
exports = { '.': {...'./src/index.ts'}, './server': {...'./src/server.ts'}, './client': {...'./src/client.ts'} }
```

while `files` is `["dist", "schema", "MIGRATION.md"]`, so `src/` is not in the tarball at all.
Both Node (`ERR_MODULE_NOT_FOUND: .../hub-sdk/src/server.ts`) and Vite (`Failed to resolve entry for package "@fxl-business/hub-sdk"`) fail on every import.
`1.2.0` is fine - its published `package.json` has `main: "./dist/index.cjs"` and `exports` pointing at `dist`.
So the `publishConfig` main/module/types/exports swap was applied for `1.2.0` and was NOT applied for `1.3.0` (npm does not honour those fields inside `publishConfig`; pnpm does).

The plan and the plan-check both read the staged tarball's `dist/` and verified every line-number citation, but neither ever installed the package, so neither caught this.

**Bridge applied:** `pnpm patch @fxl-business/hub-sdk@1.3.0`, rewriting ONLY `main`, `module`, `types` and `exports` to the `publishConfig` values already sitting in the same `package.json`.
No code is patched; `dist/` in the tarball is complete and correct, only the pointers are wrong.
The patch is one hunk and is deliberately surgical - a first attempt that round-tripped the JSON also normalised a unicode-escaped `comment` field, and was regenerated to avoid that noise.

**This patch must be deleted, together with its `patchedDependencies` entry in `pnpm-workspace.yaml`, the moment the Hub republishes.**
Filed in `nexo/ROADMAP.md` and reported to the Hub in `HUB-RESPONSE.md` section 1b, with a request for `1.3.1` and for a `prepublishOnly`/`postpack` assertion that the resolved entry points exist inside the packed tarball.

A human should decide at Gate 2 or Gate 3 whether shipping on a patched dependency is acceptable, or whether the whole feature waits for `1.3.1`.
Nothing else in this slice depends on the patch surviving: once `1.3.1` lands, deleting the patch and bumping the range is the only change.

### D3. The wiring test had to take `HubSessionStoreUnavailableError` from the mocked module graph

The plan's `answers 503 rather than a cookie-clearing 401 ... through app.route('', authBff)` test failed at first with `expected 500 to be 503`, which reads exactly like a broken mount.
It was not.
`app-auth-bff-wiring.test.ts` calls `vi.resetModules()` in `beforeAll`, so the file's own top-level `import { HubSessionStoreUnavailableError }` resolves in a DIFFERENT module registry from the one `app-auth.ts` later loads.
`hubBffErrorHandler`'s `instanceof` therefore missed, and the error fell through to the generic 500 branch.

Fixed by capturing the class from `await import('../../auth/hub-session-store.js')` inside `beforeAll`, after the `doMock` calls, and documenting why at the declaration.
Worth knowing for slice 06, which adds tests to this same file: any `instanceof` against a class from `apps/api/src` in this file has the same trap.

### D4. Two small test-mechanics fixes, no design change

- The integration test's `slides expires_at on update` read `expires_at` through `postgres`'s raw tagged template, which returns it as a string here rather than a `Date`; the assertion now goes through `new Date(value).getTime()`.
- `adminClient` in the integration file was raised from `max: 5` to `max: 8`, because the two new concurrency tests hold a transaction open while asserting from a second connection.

### D5. Extra tests beyond the plan's list

`hub-bff-errors.test.ts` carries two tests the plan did not name:

- `reproduces hono default handling for an error that carries its own response` - covers the duck-typed `getResponse` branch, which otherwise had none.
- `degrading to a null store read instead of throwing would be visible as a cookie-clearing 401` - the anti-oracle, asserting that the stand-in sub-app really does produce the cookie-clearing 401 the 503 exists to prevent, so the main test cannot pass vacuously.

## Non-vacuity checks actually run (both mutations, both reverted)

- Deleted `.for('update')` from `withSession`: `serializes two concurrent refreshes on one session id so no rotation is lost` went red with `bSaw: 'token-old'` instead of `'token-a'`, exactly as the plan predicted. Every other test in that file stayed green, so this is the only oracle for the lock.
- Deleted `router.onError(hubBffErrorHandler)` from `createAppAuthBff`: the wiring test's `answers 503 ... through app.route('', authBff)` went red with `expected 500 to be 503`. The isolated `hub-bff-errors.test.ts` cannot catch that, which is why the wiring test exists.

RED-before-GREEN was confirmed for every new test before any implementation was written: `withSession is not a function`, `Cannot find module '../hub-bff-errors.js'`, `expected undefined to be 5000`, and the 1.2.0 SDK calling `store.get`.

## What slice 02 needs to know

- `withSession`'s expiry branch is ONE predicate over the row, as the plan intended:
  `if (row && row.expiresAt.getTime() <= now) { delete; row = null; }`
  Slice 02 adds `|| row.absoluteExpiresAt.getTime() <= now` to it and a second column to `create`'s `values` and to `update`'s `.set`.
- `create` currently ignores `data.expiresAt` AND `data.absoluteExpiresAt` with a comment saying so. Slice 02 changes the second half of that decision, so the comment must be updated with it.
- `sessionTtlSeconds` / `sessionAbsoluteTtlSeconds` are NOT passed to `createHubBff` and there is NO test asserting their absence, so slice 02 can add them freely.
- `tx.get()` already returns `expiresAt` as an ISO string, which the SDK re-checks at `dist/server.js:424`/`:483`. Slice 02's `absoluteExpiresAt` goes in the same object.

## What slice 06 needs to know

- `DurableHubSessionStore` is GONE. `createDurableHubSessionStore` returns the SDK's `HubSessionStore`, and `createHubSessionStore` returns `{ kind: 'durable' | 'memory'; store: HubSessionStore }` - a single non-discriminated type, so `session.kind === 'durable'` does NOT narrow `session.store` to anything richer.
  Blocking issue B2 in `plan-check.md` is therefore live exactly as written: slice 06 must either reinstate the interface (now non-empty, so no longer noise) and restore the discriminated return, or type its middleware structurally and guard the mount on `session.kind === 'durable'`.
- `createAppAuthBff` no longer has an `if (session.kind === 'memory') return bff;` early return. Both paths go through the same router, so a middleware mounted there is handed the SDK's `InMemoryHubSessionStore` on the memory path - which is precisely the `TypeError: store.withLoginContext is not a function` that B2 predicts.
- The router tail slice 06 must preserve verbatim, adding its `router.use` between the two lines:
  ```ts
  const router = new Hono();
  router.onError(hubBffErrorHandler);
  router.route('', bff);
  return router;
  ```
  Dropping `router.onError` is caught by the wiring test, but do not copy the plan's snippet, which omits it.
- The cookie-name pin is now behavioural, in `app-auth-bff-wiring.test.ts` under `createAppAuthBff cookie routing, against the real SDK`. There is no `SESSION_COOKIE` constant anywhere in `apps/api/src` any more; the SDK reads its own cookies. Slice 06's middleware needs its own cookie read and should derive the name from the same `secureCookies` boolean.
- See D3 above before adding any `instanceof` assertion to that file.

## Verification run

| Check | Result |
| --- | --- |
| `vitest run` on the three named unit oracle files | 20 passed |
| `vitest run test/rls/hub-bff-session-store.test.ts` (`VITEST_INTEGRATION=1`) | 12 passed |
| `pnpm run type-check` | green |
| `pnpm run lint` | green |
| `pnpm test` | api 366, web 592, shared-utils 80, plus the legacy-auth guard and build-contract |
| `pnpm run build` | green |
| `pnpm --filter @fxl-sales/api test:integration` | 24 files, 159 tests, green against local Docker |
| `grep hub-sdk pnpm-lock.yaml` | `1.3.0` only, no `1.2.0` entry |
