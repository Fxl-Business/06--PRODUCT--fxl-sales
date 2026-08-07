# Slice 06 - Supersede the prior session at login

Working notes.
This is the last slice of the feature.

## Result

PASS.

Every RED test named by the plan was confirmed red for the stated reason before any implementation was written.
All four mutations described under "Non-vacuity" below were run and reverted, and each one turned exactly the predicted test red and nothing else.
`type-check`, `lint`, `pnpm test`, `pnpm run build` and the integration suite are green.

## What shipped

- `apps/api/src/auth/hub-login-scope.ts` - new. `SESSION_COOKIE` / `SESSION_COOKIE_SECURE` / `hubSessionCookieName()` re-pinned to `@fxl-business/hub-sdk@1.3.0 dist/server.js:275-277`, plus `createHubLoginSupersedeMiddleware`.
- `apps/api/src/auth/hub-session-store.ts` - `HubLoginContext`, the reinstated `DurableHubSessionStore` interface, `withLoginContext`, the test-only `newId` injection, `create()` moved inside `db.transaction` with the supersede DELETE first, and `createHubSessionStore`'s discriminated return.
- `apps/api/src/middleware/app-auth.ts` - the middleware mounted on `/auth/callback`, guarded on `session.kind === 'durable'`, with `router.onError(hubBffErrorHandler)` untouched.
- `apps/api/src/db/schema.ts` - comment only, on `hubBffSessions.accountId`.
- Tests: the new `hub-login-scope.test.ts`, the new `app-auth-bff-memory-path.test.ts`, one new test in `app-auth-bff-wiring.test.ts`, five new integration tests in `hub-bff-session-store.test.ts`, and the new end-to-end `hub-bff-login-supersede.test.ts` (see deviation D3).
- `CLAUDE.md`, `nexo/ROADMAP.md` (two entries), `HUB-RESPONSE.md` (new contradiction 4b).

No migration, no schema change, no index.
The supersede lookup is by primary key.

## The three corrections carried in from plan-check B2 - all three were live

1. `DurableHubSessionStore` really was gone, and `createHubSessionStore` really did return a single non-discriminated type.
   Both are reinstated, with a comment at the interface saying why slice 01's "an empty extension is noise" reasoning no longer applies.
2. `createAppAuthBff` really had no `if (session.kind === 'memory') return bff;` early return, so the mount had to be narrowed explicitly.
   Proven, not assumed: mounting it unconditionally (mutation 2 below) turns `/auth/callback` on the memory path into a 500.
3. `router.onError(hubBffErrorHandler)` was preserved.
   The plan's corrected snippet was used verbatim; the original one, which drops it, was never written.

## Deviations from the plan

### D1. `HubLoginContext` is declared in `hub-session-store.ts`, not in `hub-login-scope.ts`

The plan's section 1 declares the type in the middleware file, but section 2 puts `withLoginContext` on `DurableHubSessionStore`, which lives in the store file.
Declaring it in the middleware file would make the store import a type from its own consumer - legal, since a type-only import is erased, but backwards.
The store owns the `AsyncLocalStorage`, so it owns the shape that goes into it, and the middleware imports the type from there.
No behavioural difference.

### D2. The memory-path test is its own file rather than a describe in `app-auth-bff-wiring.test.ts`

The plan asks for the assertion, not for a location.
It needs a DIFFERENT module graph (`DATABASE_URL` unset), and that file's `beforeAll` loads its graph once and captures `bffOptions`, `sessionStoreKind` and `durableStore` into module-level variables that every other test in the file asserts on.
A second `vi.resetModules()` mid-file would overwrite those captures with the memory build's, so the file would be asserting on whichever graph happened to load last.
Vitest isolates per file, so `app-auth-bff-memory-path.test.ts` gets the clean environment for free.

### D3. The manual browser E2E was replaced with an end-to-end integration test, deliberately

The plan asks for one manual two-browser-profile click-through.
It was NOT run, for a reason that is not convenience:

- `apps/api/.env` points `DATABASE_URL` at the **staging** database (`fxl_sales_stg_db`), and that is the database the local dev API is wired to.
  A manual login would create and then delete `hub_bff_sessions` rows in staging.
  Signing in also needs real Hub credentials, which are not available here.
- The dev servers on ports 3006 and 8006 were already running when this slice started.
  They were not started by this session, so they were left alone and nothing was killed.

The gap the manual run was there to close is real, though, and it is not covered by anything the plan lists: that the `AsyncLocalStorage` context the middleware establishes is still in scope when the SDK awaits `store.create` from inside its own handler, several awaits and one `fetch` deeper.
The integration oracles call `withLoginContext` themselves and the wiring test only proves the mount, so between them that seam is assumed rather than observed.

`apps/api/test/rls/hub-bff-login-supersede.test.ts` observes it.
It assembles the same three router lines `createAppAuthBff` does, over the real `createHubBff` and the real durable store against local Postgres, and drives a cookie-jar `Browser` through `GET /auth/login` then `GET /auth/callback` exactly as a browser does.
Only the Hub itself is stubbed, at `fetchImpl`: discovery and the token exchange.
Three tests - re-login in one browser leaves one row, a second browser's row survives, and a fresh browser with no cookie logs in normally.

This is stronger than the manual run in the ways that matter (deterministic, permanent, asserts rows rather than eyeballs a screen) and weaker in one (it is not a real browser, so it does not exercise real cookie storage or `SameSite=Lax` on a genuine cross-site redirect).
That residual is small: the `Lax` reasoning is about which cookie the browser SENDS, and the SDK's own `/auth/refresh` route depends on the same cookie arriving on an ordinary same-site request, which the app has been doing in production since the BFF landed.
A human should still do the two-profile click-through once against a local database before this reaches production.

## RED-before-GREEN, recorded

Run once with `vitest run`, before any implementation existed:

| Oracle | RED failure |
| --- | --- |
| `hub-login-scope.test.ts` (all four) | `Cannot find module '../hub-login-scope.js'` |
| `mounts the login-supersede middleware on /auth/callback` | `withLoginContext does not exist` |
| `deletes the session id the browser presented at login` | `store.withLoginContext is not a function` |
| `leaves a session held by another browser untouched` | same |
| `makes the superseded session unresolvable through withSession` | same |
| `keeps the prior session when the new insert fails` | `collidingStore.withLoginContext is not a function` |
| `creates a session normally when no prior session was presented` | same |

The memory-path test is a GUARD, not a RED test: it passes before the change (nothing was mounted) and its job is to fail on the wrong mount.
Its non-vacuity is mutation 2 below.

## Non-vacuity mutations actually run (all four reverted)

1. **Deleted `router.use('/auth/callback', ...)` from `createAppAuthBff`.**
   `mounts the login-supersede middleware on /auth/callback` went red; the other 27 tests in `src/middleware` stayed green.
   That is the gap the plan describes: every integration oracle calls `withLoginContext` directly and would stay green with the feature unreachable in production.
2. **Mounted the middleware unconditionally, dropping the `session.kind === 'durable'` guard.**
   `still serves /auth/callback without throwing` went red with `expected 500 to be 302`, which is the `TypeError: store.withLoginContext is not a function` plan-check B2 predicted, reaching a local dev machine with no database.
   Nothing else moved.
3. **Deleted the supersede DELETE from `create()`.**
   The three behavioural integration oracles went red (`expected 1 to be +0` twice, and the record instead of `null` once).
   `keeps the prior session when the new insert fails` and `creates a session normally ...` stayed green, correctly - neither is an oracle for the delete existing.
4. **Moved the DELETE outside the transaction**, to `this.#db.delete(...)` immediately before `this.#db.transaction(...)`.
   ONLY `keeps the prior session when the new insert fails` went red, with `expected +0 to be 1`: the prior session was destroyed by a login that then failed, so the operator is signed out by a failed login.
   That is exactly the mistake constraint 5 names, and it has exactly one oracle.

A fifth mutation was run on the end-to-end file: removing its own `router.use(...)`.
The first two of its three tests went red with `expected 1 to be +0`, i.e. the two-row state that existed before this slice, which is what makes that file's assertions non-vacuous.

## Decisions worth knowing

- **`priorSessionId` is read from the ALS OUTSIDE the `db.transaction` callback.**
  The callback is an async boundary drizzle schedules; reading the context before entering it keeps the value tied to the request that called `create()`.
- **The supersede runs BEFORE the insert inside the transaction**, which is also what makes the atomicity oracle meaningful: the primary-key violation lands after the delete, so a non-transactional implementation has already lost the row when it fails.
- **`accountId` is still written as `data.accountId ?? null`.**
  The column is not dropped and the write is not removed - if the Hub ever starts populating the field, the column starts working with no code change. The comment in `schema.ts` and the ROADMAP entry are what stop a future reader building a lookup on it in the meantime.
- **`newId` is documented at its declaration as test-only.**
  It is never passed by `createHubSessionStore`; the only caller that passes it is the atomicity oracle.

## Verification run

| Check | Result |
| --- | --- |
| `vitest run src/auth src/middleware` | 59 passed (7 files) |
| `VITEST_INTEGRATION=1 vitest run test/rls/hub-bff-session-store.test.ts` | 19 passed (was 14) |
| `VITEST_INTEGRATION=1 vitest run test/rls/hub-bff-login-supersede.test.ts` | 3 passed |
| `pnpm run type-check` | green |
| `pnpm run lint` | green |
| `pnpm test` | api 382, web 641, shared-utils 80, plus the legacy-auth guard and build-contract |
| `pnpm run build` | green |
| `pnpm --filter @fxl-sales/api test:integration` | 25 files, 169 tests, green against local Docker (`06--product--fxl-sales-db-1`, port 5006) |

## Standing limitations

- A session orphaned WITHOUT a subsequent login - the browser cleared its cookies, or the cookie expired first - is never presented and so is never superseded.
  Bounded by slice 02's `absoluteExpiresAt` and the nightly sweep, which is why this slice depends on 02.
- The superseded session's Hub-side refresh family is not revoked at the Hub, only made unreachable from this product.
  Filed in `nexo/ROADMAP.md` with the reasoning (a Hub round trip inside the login transaction is the pooled-connection hazard `session-store.sql` warns about).
- The supersede `DELETE` serializes behind a concurrent `/auth/refresh` holding `FOR UPDATE` on the prior row.
  Bounded by slice 01's `timeoutMs`, and it is the correct ordering.
