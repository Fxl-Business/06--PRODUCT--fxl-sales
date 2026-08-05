# Gate 2 Verification: Session Refresh Serialization

## Verdict

PASS.

The exact cumulative commit `69b355c0995c4675c947f0735e6012f39e3fb25b` satisfies the slice acceptance contract against base `980540f881b990736c86e7a82e326c704ec1787c`.

## Scope

The cumulative diff changes only the three files declared by the plan.

- `apps/api/src/auth/hub-session-store.ts`
- `apps/api/src/auth/__tests__/hub-session-store.test.ts`
- `apps/api/test/rls/hub-bff-session-store.test.ts`

No implementation file was edited during verification.

The pre-existing execute and review artifacts remained untracked and untouched.

## Acceptance Contract Inspection

- The concurrency oracle constructs `storeA`, `storeB`, and `finalStore` as independent durable store instances over the real PostgreSQL database.
- The first real Hono request holds a row lock for the target session while the second real Hono request waits before hydration can expose a token.
- The same oracle proves a different session request completes while the target row remains locked.
- The second handler observes `token-new`, returns 200, and emits no `Set-Cookie` header.
- A fresh final store reads the durable session as `{ hubRefreshToken: 'token-new' }`.
- The oracle releases both deferred gates in `finally` and awaits every started request with `Promise.allSettled`.
- The real rollback regression buffers a session insert before a conflicting login insert and proves the failed flush rolls back the session while preserving the independently committed conflicting login row.
- The handler rollback regression proves the identical handler error object escapes and the durable token remains `token-old`.
- The transaction-acquisition unit test proves the failure is wrapped as `HubSessionStoreUnavailableError` with message `hub session hydrate failed` and the handler is skipped.
- The session-scope regression proves hydrate unavailability returns 503 without running downstream code or clearing the browser cookie.
- The flush failure unit test proves exact error logging and preservation of the formed handler value.
- The commit failure unit test proves exact error logging and preservation of the formed handler value after a transaction commit rejection.
- The production implementation performs hydrate, handler, ordered flush, and commit within one request transaction, locks only the matching live session row with `FOR UPDATE`, and keeps login consumption on the same transaction handle.

## Command Evidence

1. `pnpm --filter @fxl-sales/api test -- src/auth/__tests__/hub-session-store.test.ts src/auth/__tests__/hub-session-scope.test.ts`
   Exit 0.
   The repository script ran 33 unit files and 332 tests, all passing, including the two requested auth files.

2. `pnpm --filter @fxl-sales/api exec vitest run src/auth/__tests__/hub-session-store.test.ts src/auth/__tests__/hub-session-scope.test.ts`
   Exit 0.
   The true focused run passed 2 files and 14 tests, including 10 session-store tests and 4 session-scope tests.

3. `TEST_DATABASE_URL=postgresql://fxl_sales_test:<redacted>@localhost:5006/fxl_sales TEST_MIGRATE_DATABASE_URL=postgresql://postgres:<redacted>@localhost:5006/fxl_sales ADMIN_DATABASE_URL=postgresql://postgres:<redacted>@localhost:5006/fxl_sales pnpm --filter @fxl-sales/api test:integration -- test/rls/hub-bff-session-store.test.ts`
   Exit 0.
   The local database accepted connections, and `fxl_sales_test` was independently confirmed as non-superuser and non-BYPASSRLS before the run.
   The repository script passed 20 integration files and 116 tests, including all 11 durable-store tests.
   The named serialization oracle passed in 1040 ms.

4. `pnpm --filter @fxl-sales/api exec eslint src/auth/hub-session-store.ts src/auth/__tests__/hub-session-store.test.ts test/rls/hub-bff-session-store.test.ts`
   Exit 0 with no diagnostics.

5. `pnpm --filter @fxl-sales/api type-check`
   Exit 0 from `tsc --noEmit`.

6. `git diff --check 980540f..HEAD`
   Exit 0 with no whitespace errors.

## Cleanup

No Vitest, TypeScript, TSX, Node, development server, watcher, or database client process started by this verification remained running.
