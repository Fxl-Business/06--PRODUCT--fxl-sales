# Final cumulative review - 01-session-refresh-serialization

Reviewed HEAD: `69b355c0995c4675c947f0735e6012f39e3fb25b`

Reviewed commits:

- `448a4bab42228f964deb54dd97024a1f50502c7a fix(api): serialize durable session refreshes`
- `69b355c0995c4675c947f0735e6012f39e3fb25b test(api): harden session transaction coverage`

Overall verdict: **PASS**

## Spec verdict: PASS

The cumulative implementation satisfies the approved slice contract.

- The end-user-aligned oracle uses real Hono middleware, two independent durable store instances, the real PostgreSQL integration database, browser cookie behavior, a separately locked session control, and a fresh-store final read in `apps/api/test/rls/hub-bff-session-store.test.ts:139-248`.
- Hydration selects only the requested live primary-key row and applies `FOR UPDATE` in `apps/api/src/auth/hub-session-store.ts:199-206`.
- One transaction covers hydrate, handler, ordered flush, and commit in `apps/api/src/auth/hub-session-store.ts:286-301`.
- Callback-only login consumption uses the same transaction handle in `apps/api/src/auth/hub-session-store.ts:223-240`.
- Every buffered `SessionOp` is replayed sequentially through the same transaction handle in `apps/api/src/auth/hub-session-store.ts:244-283`.
- Transaction acquisition and hydrate failures are wrapped fail-closed before the handler, handler errors are rethrown unchanged, and post-handler flush or commit errors are logged and return the formed value in `apps/api/src/auth/hub-session-store.ts:288-314`.
- The real rollback regressions prove flush atomicity and same-object handler-error rollback in `apps/api/test/rls/hub-bff-session-store.test.ts:250-305`.
- No table-wide or process-wide lock was introduced, and the unrelated-session control completes while the target row remains locked in `apps/api/test/rls/hub-bff-session-store.test.ts:204-217`.
- Public interfaces, schema, migrations, middleware, cookie behavior, TTLs, cleanup implementation, dependencies, and production file scope remain unchanged.

## Quality verdict: PASS

Both prior Minor findings are fully resolved without weakening the locked concurrency oracle.

- `rotationEntered` is now resolved before the required `token-old` assertion in `apps/api/test/rls/hub-bff-session-store.test.ts:164-167`, so an assertion failure cannot strand the controller at the gate.
  The assertion remains active, executes synchronously before the handler yields, and any failure still rejects the first request.
  The two-store middleware path, stale-token branch, unrelated-session control, aggregate expectations, deferred releases, and `Promise.allSettled` cleanup remain intact at lines 139-247.
- The new narrow transaction double completes its callback and then rejects with the exact commit error in `apps/api/src/auth/__tests__/hub-session-store.test.ts:126-145`.
  It directly proves that a commit-phase rejection logs `[hub-session-store] flush failed` with the identical error and returns the already formed handler value.
  The recorded phase-misclassification mutation failed this test, demonstrating that the new oracle detects its intended regression.

The follow-up commit changes only the two test files, with 22 insertions and one ordering change.
Production behavior remains exactly the reviewed implementation.
The updated evidence records 14 focused unit tests, all 11 integration tests, focused ESLint, API type-check, and diff-check passing at the reviewed HEAD.

## Findings

### Critical

None.

### Important

None.

### Minor

None.
