# Execute evidence - 01-session-refresh-serialization

Tested commit: `69b355c0995c4675c947f0735e6012f39e3fb25b`

## Red evidence

`pnpm --filter @fxl-sales/api test:integration -- test/rls/hub-bff-session-store.test.ts -t "serializes a stale refresh rejection behind a committed token rotation across replicas"` exited 1 before production edits.

The locked PostgreSQL and Hono oracle received `staleBeforeRelease: true`, `secondStatus: 401`, `secondClearedCookie: true`, and `finalSession: null`.

The unrelated-session control returned `{ hubRefreshToken: 'token-other' }` while the first refresh request was gated.

The Red run also proved the existing implementation persisted `token-never-committed` after the handler threw.

The transaction-acquisition unit oracle failed before production edits because the old implementation never acquired the request transaction.

## Green implementation

The durable store now opens one database transaction for hydration, the BFF handler, ordered mutation flush, and commit.

Hydration locks only the matching live `hub_bff_sessions` row with `FOR UPDATE` and holds that lock through commit or rollback.

Session hydration and callback login consumption use the same transaction handle.

Buffered operations are replayed in their original order without a nested transaction.

Hydrate failures remain `HubSessionStoreUnavailableError('hub session hydrate failed', { cause })` and skip the handler.

Handler failures escape as the identical error object and roll back every request mutation.

Flush or commit failures roll back the transaction, log `[hub-session-store] flush failed`, and preserve the formed handler value.

No public interface, schema, migration, cookie, TTL, cleanup behavior, or package manifest changed.

## Verification evidence

`pnpm --filter @fxl-sales/api test -- src/auth/__tests__/hub-session-store.test.ts src/auth/__tests__/hub-session-scope.test.ts` exited 0 with all 331 API unit tests passing, including the 13 focused session-store and scope tests.

`VITEST_INTEGRATION=1 node --env-file=/Users/cauetpinciara/Documents/fxl/projects/06--PRODUCT--fxl-sales/apps/api/.env node_modules/vitest/vitest.mjs run test/rls/hub-bff-session-store.test.ts` exited 0 with all 11 durable-store integration tests passing.

The locked concurrency oracle passed with the second request observing `token-new`, returning 200 without clearing the cookie, and the fresh final store resolving `token-new`.

The unrelated session completed while the first session row was locked.

The real transaction regression proved an insert followed by a conflicting login insert rolls back the first insert while preserving the formed handler value.

The real handler regression proved `token-never-committed` is rolled back and a fresh store still resolves `token-old`.

`pnpm --filter @fxl-sales/api exec eslint src/auth/hub-session-store.ts src/auth/__tests__/hub-session-store.test.ts test/rls/hub-bff-session-store.test.ts` exited 0.

`pnpm --filter @fxl-sales/api type-check` exited 0.

`git diff --check` exited 0 before the implementation commit.

## Review fix evidence

The rotating request now resolves `rotationEntered` before its required `token-old` assertion, so a failed assertion cannot strand the controller before deferred-gate cleanup.

The assertion, two-store middleware path, scheduling gates, unrelated-session control, and locked aggregate oracle remain unchanged.

The new narrow unit double runs the transaction callback successfully and then rejects with an exact commit error.

The commit-phase test proves the formed handler value is returned and `console.error` receives `[hub-session-store] flush failed` with the identical commit error.

A deliberate phase-misclassification mutation made the new commit-phase test fail with `commit failed`, proving the test detects the targeted regression.

After restoring the reviewed implementation, `pnpm --filter @fxl-sales/api exec vitest run src/auth/__tests__/hub-session-store.test.ts src/auth/__tests__/hub-session-scope.test.ts` exited 0 with all 14 focused tests passing.

After the review fixes, `VITEST_INTEGRATION=1 node --env-file=/Users/cauetpinciara/Documents/fxl/projects/06--PRODUCT--fxl-sales/apps/api/.env node_modules/vitest/vitest.mjs run test/rls/hub-bff-session-store.test.ts` exited 0 with all 11 integration tests passing.

After the review fixes, focused ESLint, API type-check, and `git diff --check` all exited 0.

## Commit

`448a4bab42228f964deb54dd97024a1f50502c7a fix(api): serialize durable session refreshes`

`69b355c0995c4675c947f0735e6012f39e3fb25b test(api): harden session transaction coverage`

No long-running process was started or left active.
