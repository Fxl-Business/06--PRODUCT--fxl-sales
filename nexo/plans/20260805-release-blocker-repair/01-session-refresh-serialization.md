---
id: 01-session-refresh-serialization
milestone: v2.4.0
status: todo
depends_on: []
files_modified: [apps/api/src/auth/hub-session-store.ts, apps/api/src/auth/__tests__/hub-session-store.test.ts, apps/api/test/rls/hub-bff-session-store.test.ts]
acceptance: "given two concurrent refresh requests for one durable Hub session through independent store instances backed by the real Postgres integration database, when the first request rotates and commits the refresh token, then the second request waits for that session, reads the committed token, does not delete the row or clear the browser cookie, and requests for a different session remain independent"
---

# Session Refresh Serialization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.
> Use `superpowers:test-driven-development` for Red, Green, and Refactor, and do not change the locked Red oracle after recording its failure.

**Goal:** Serialize one durable Hub session's hydration, BFF handler, and mutation flush across API replicas without blocking requests for other session rows.

**Architecture:** Keep the synchronous `HubSessionStore` API and request-scoped `AsyncLocalStorage` unit of work unchanged.
Move the existing hydrate, handler, and ordered flush into one admin-database transaction, acquire a PostgreSQL row lock when hydrating a live session, and hold that lock until the request transaction commits or rolls back.
Classify transaction failures by request phase so hydrate failures remain fail-closed, handler failures remain the original errors, and flush or commit failures retain the formed response while rolling back every buffered mutation.

**Tech Stack:** TypeScript, Hono 4, Drizzle ORM 0.45, postgres-js, PostgreSQL row locks, Vitest 3, and `@fxl-business/hub-sdk` 1.2.0.

## Global Constraints

- Do not change the public `DurableHubSessionStore`, `HubSessionHydrateInput`, or synchronous Hub SDK store method signatures.
- Do not modify `hub-session-scope.ts`, `app-auth.ts`, database schema, migrations, cookies, Hub SDK routes, encryption, TTLs, or cleanup behavior.
- Do not add an in-process mutex, advisory lock, Redis dependency, retry loop, timeout, or optimistic compare-and-swap.
- Lock only the matching live `hub_bff_sessions` row when `input.sessionId` is present.
- Keep login transaction consumption in the same request transaction and preserve its consume-on-callback behavior.
- Keep every `SessionOp` applied in order.
- Hydrate or transaction-acquisition failure must throw `HubSessionStoreUnavailableError('hub session hydrate failed', { cause })` before the BFF handler runs.
- A handler rejection must escape as the identical error object and the request transaction must roll back.
- A flush or transaction-commit failure after the handler returns must roll back all request mutations, call `console.error('[hub-session-store] flush failed', err)`, and return the already formed handler value.
- Requests without a session id still use one request transaction because callback login consumption and session creation must remain atomic.
- The first failing test is the locked oracle and may not be weakened, skipped, deleted, or rewritten during Green.
- Run every command once without watch mode and stop every process started for this slice.

---

## File Map

- Modify `apps/api/test/rls/hub-bff-session-store.test.ts` to add the real Postgres concurrency oracle and transaction rollback coverage.
- Modify `apps/api/src/auth/__tests__/hub-session-store.test.ts` to pin transaction-acquisition, handler, and post-handler flush error classification with narrow database doubles.
- Modify `apps/api/src/auth/hub-session-store.ts` to pass one transaction handle through hydrate and flush, lock the hydrated session row, and preserve the three failure phases.
- Read but do not modify `apps/api/src/auth/hub-session-scope.ts` because its existing tests already pin 503 conversion, no cookie teardown on hydrate failure, and rethrowing of non-store errors.

## Exact Interfaces and Internal Types

The public interface remains exactly:

```ts
export interface DurableHubSessionStore extends HubSessionStore {
  withRequest<T>(input: HubSessionHydrateInput, fn: () => Promise<T>): Promise<T>;
}

export function createDurableHubSessionStore(deps: {
  db: NodeDb;
  sealer: SessionSealer;
  now?: () => Date;
}): DurableHubSessionStore;
```

Add only these private type aliases in `hub-session-store.ts`:

```ts
type RequestDb = Parameters<Parameters<NodeDb['transaction']>[0]>[0];
type RequestPhase = 'hydrate' | 'handler' | 'flush';
```

Change the two private methods to consume the transaction handle instead of opening or using a separate database operation boundary:

```ts
async #hydrate(db: RequestDb, uow: UnitOfWork, input: HubSessionHydrateInput): Promise<void>;
async #flush(db: RequestDb, uow: UnitOfWork): Promise<void>;
```

`#hydrate` must use `db` for both the locked session read and the callback-only login transaction delete.
`#flush` must use `db` for every buffered operation and must not open a nested transaction or catch its own error.

### Task 1: Lock the end-user-aligned stale-delete oracle

**Files:**

- Modify: `apps/api/test/rls/hub-bff-session-store.test.ts`
- Test: `apps/api/test/rls/hub-bff-session-store.test.ts`

**Interfaces:**

- Consumes: `createDurableHubSessionStore`, `createHubSessionScopeMiddleware`, `DurableHubSessionStore.withRequest`, `DurableHubSessionStore.get`, `DurableHubSessionStore.update`, and `DurableHubSessionStore.delete`.
- Produces: the locked test `serializes a stale refresh rejection behind a committed token rotation across replicas`.
- Produces: the regression test `rolls back every buffered mutation when persistence fails after the handler returns`.

- [ ] **Step 1: Add deterministic request gates and the real HTTP/Postgres oracle**

Import `Hono`, `deleteCookie`, `vi`, and `createHubSessionScopeMiddleware` into the existing integration file.
Add these local helpers, using the timer only to determine whether the second handler observed the stale token before the first request was released:

```ts
function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
```

Build two real Hono refresh paths over two independent `newStore()` instances.
The first path must hydrate `token-old`, wait on `releaseRotation`, call `storeA.update(sessionId, 'token-new')`, and return 200.
The second path must delete the session and expire `fxl_hub_session` only if it sees `token-old`; if serialization makes it see `token-new`, it must return 200 without a `Set-Cookie` header.
While the first request is held, resolve a request for a separately created session through `storeB` and include that result in the final assertion so a table-wide or process-wide lock cannot satisfy the oracle.

Use this exact request and assertion structure:

```ts
it('serializes a stale refresh rejection behind a committed token rotation across replicas', async () => {
  const storeA = newStore();
  const storeB = newStore();
  const finalStore = newStore();
  const sessionId = trackSession(
    await storeA.withRequest({ consumeLoginTx: false }, async () =>
      storeA.create({ hubRefreshToken: 'token-old' }),
    ),
  );
  const otherSessionId = trackSession(
    await storeA.withRequest({ consumeLoginTx: false }, async () =>
      storeA.create({ hubRefreshToken: 'token-other' }),
    ),
  );

  const rotationEntered = deferred<void>();
  const releaseRotation = deferred<void>();
  const staleTokenObserved = deferred<void>();
  const releaseStaleDelete = deferred<void>();

  const rotatingApp = new Hono();
  rotatingApp.use('/auth/*', createHubSessionScopeMiddleware(storeA, { secureCookies: false }));
  rotatingApp.post('/auth/refresh', async (c) => {
    expect(storeA.get(sessionId)).toEqual({ hubRefreshToken: 'token-old' });
    rotationEntered.resolve();
    await releaseRotation.promise;
    storeA.update(sessionId, 'token-new');
    return c.json({ ok: true });
  });

  const competingApp = new Hono();
  competingApp.use('/auth/*', createHubSessionScopeMiddleware(storeB, { secureCookies: false }));
  competingApp.post('/auth/refresh', async (c) => {
    const session = storeB.get(sessionId);
    if (session?.hubRefreshToken === 'token-old') {
      staleTokenObserved.resolve();
      await releaseStaleDelete.promise;
      storeB.delete(sessionId);
      deleteCookie(c, 'fxl_hub_session', { path: '/' });
      return c.json({ error: 'session_expired' }, 401);
    }
    expect(session).toEqual({ hubRefreshToken: 'token-new' });
    return c.json({ ok: true });
  });

  const firstResponsePromise = rotatingApp.request('http://localhost/auth/refresh', {
    method: 'POST',
    headers: { cookie: `fxl_hub_session=${sessionId}` },
  });
  await rotationEntered.promise;

  const secondResponsePromise = competingApp.request('http://localhost/auth/refresh', {
    method: 'POST',
    headers: { cookie: `fxl_hub_session=${sessionId}` },
  });
  const otherSessionPromise = storeB.withRequest(
    { sessionId: otherSessionId, consumeLoginTx: false },
    async () => storeB.get(otherSessionId),
  );

  const otherWhileLocked = await Promise.race([
    otherSessionPromise,
    delay(1_000).then(() => 'blocked' as const),
  ]);
  const staleBeforeRelease = await Promise.race([
    staleTokenObserved.promise.then(() => true),
    delay(1_000).then(() => false),
  ]);

  releaseRotation.resolve();
  const firstResponse = await firstResponsePromise;
  releaseStaleDelete.resolve();
  const secondResponse = await secondResponsePromise;
  const finalSession = await finalStore.withRequest(
    { sessionId, consumeLoginTx: false },
    async () => finalStore.get(sessionId),
  );

  expect({
    firstStatus: firstResponse.status,
    secondStatus: secondResponse.status,
    secondClearedCookie: secondResponse.headers.get('set-cookie') !== null,
    staleBeforeRelease,
    otherWhileLocked,
    finalSession,
  }).toEqual({
    firstStatus: 200,
    secondStatus: 200,
    secondClearedCookie: false,
    staleBeforeRelease: false,
    otherWhileLocked: { hubRefreshToken: 'token-other' },
    finalSession: { hubRefreshToken: 'token-new' },
  });
});
```

Place the concurrent request section inside `try/finally`, release both deferred gates again in `finally`, and await any started request promises with `Promise.allSettled` so no lock or request can survive a failed assertion.
Collect each request promise in `const startedRequests: Promise<unknown>[] = []` immediately after starting it and use this cleanup shape:

```ts
} finally {
  releaseRotation.resolve();
  releaseStaleDelete.resolve();
  await Promise.allSettled(startedRequests);
}
```
Do not replace the two independent stores, real middleware, Hono request handling, Postgres-backed setup, or final fresh-store read with mocks.

- [ ] **Step 2: Run the named oracle alone and record Red before production edits**

Run:

```bash
pnpm --filter @fxl-sales/api test:integration -- test/rls/hub-bff-session-store.test.ts -t "serializes a stale refresh rejection behind a committed token rotation across replicas"
```

Expected Red on the current implementation is a failed aggregate assertion showing `staleBeforeRelease: true`, `secondStatus: 401`, `secondClearedCookie: true`, and `finalSession: null` instead of the serialized Green values.
If the current implementation does not produce that stale-delete failure, strengthen only the scheduling gates before locking the test.
Do not proceed to production code without recorded Red evidence.

- [ ] **Step 3: Add a real transaction rollback regression for post-handler persistence failure**

Add `rolls back every buffered mutation when persistence fails after the handler returns` to the same integration suite.
Inside one `withRequest`, enqueue `store.create()` first and capture its session id, enqueue `store.createLogin()` second and capture its login id, then use the independent `adminClient` to insert a conflicting `hub_bff_login_txns` row with that login id before the handler returns a sentinel response value.
The ordered flush must insert the session first, fail on the duplicate login primary key second, roll back the session insert, log exactly `[hub-session-store] flush failed` with the error object, preserve the handler's sentinel return value, and leave only the independently inserted login row for `afterAll` cleanup.

```ts
it('rolls back every buffered mutation when persistence fails after the handler returns', async () => {
  const store = newStore();
  let createdSessionId = '';
  let conflictingLoginId = '';
  const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});

  try {
    const result = await store.withRequest({ consumeLoginTx: false }, async () => {
      createdSessionId = trackSession(store.create({ hubRefreshToken: 'token-rollback' }));
      conflictingLoginId = trackLogin(
        store.createLogin({ codeVerifier: 'verifier-rollback', state: 'state-rollback' }),
      );
      await adminClient`
        INSERT INTO hub_bff_login_txns (id, code_verifier_enc, state, expires_at)
        VALUES (${conflictingLoginId}, 'v1.a.b.c', 'conflict', now() + interval '10 minutes')
      `;
      return 'formed-response';
    });

    expect(result).toBe('formed-response');
    expect(errorLog).toHaveBeenCalledWith('[hub-session-store] flush failed', expect.anything());
    expect(
      await adminClient`SELECT id FROM hub_bff_sessions WHERE id = ${createdSessionId}`,
    ).toHaveLength(0);
    expect(
      await adminClient`SELECT id FROM hub_bff_login_txns WHERE id = ${conflictingLoginId}`,
    ).toHaveLength(1);
  } finally {
    errorLog.mockRestore();
  }
});
```

### Task 2: Pin hydrate, handler, and flush error phases

**Files:**

- Modify: `apps/api/src/auth/__tests__/hub-session-store.test.ts`
- Test: `apps/api/src/auth/__tests__/hub-session-store.test.ts`
- Regression Test: `apps/api/src/auth/__tests__/hub-session-scope.test.ts`

**Interfaces:**

- Consumes: the unchanged `DurableHubSessionStore.withRequest<T>(input, fn): Promise<T>` interface.
- Produces: `wraps transaction acquisition failure as hydrate unavailable and skips the handler`.
- Produces: `propagates the handler error object unchanged`.
- Produces: `logs and swallows a flush failure after returning the handler value`.

- [ ] **Step 1: Add narrow database doubles around the transaction boundary**

Add this `storeWithDb(db: unknown)` helper that passes `db as never` to `createDurableHubSessionStore` with the existing test sealer:

```ts
function storeWithDb(db: unknown) {
  return createDurableHubSessionStore({
    db: db as never,
    sealer: createSessionSealer(IKM),
  });
}
```

Do not export a production test seam.

Add these exact behavioral tests:

```ts
it('wraps transaction acquisition failure as hydrate unavailable and skips the handler', async () => {
  const cause = new Error('database unavailable');
  const handler = vi.fn();
  const store = storeWithDb({ transaction: vi.fn().mockRejectedValue(cause) });

  await expect(
    store.withRequest({ sessionId: 'session-alpha', consumeLoginTx: false }, handler),
  ).rejects.toMatchObject({
    name: 'HubSessionStoreUnavailableError',
    message: 'hub session hydrate failed',
    cause,
  });
  expect(handler).not.toHaveBeenCalled();
});

it('propagates the handler error object unchanged', async () => {
  const handlerError = new Error('handler failed');
  const store = storeWithDb({
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
  });

  await expect(
    store.withRequest({ consumeLoginTx: false }, async () => {
      throw handlerError;
    }),
  ).rejects.toBe(handlerError);
});

it('logs and swallows a flush failure after returning the handler value', async () => {
  const flushError = new Error('flush failed');
  const values = vi.fn().mockRejectedValue(flushError);
  const store = storeWithDb({
    transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ insert: vi.fn(() => ({ values })) }),
  });
  const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});

  try {
    const result = await store.withRequest({ consumeLoginTx: false }, async () => {
      store.create({ hubRefreshToken: 'token-alpha' });
      return 'formed-response';
    });
    expect(result).toBe('formed-response');
    expect(errorLog).toHaveBeenCalledWith('[hub-session-store] flush failed', flushError);
  } finally {
    errorLog.mockRestore();
  }
});
```

Keep the existing scope-guard, factory fallback, cookie-name, and TTL tests unchanged.

- [ ] **Step 2: Add the real handler rollback assertion**

Add `propagates handler failure and leaves the durable token unchanged` to `apps/api/test/rls/hub-bff-session-store.test.ts`.
Create a session containing `token-old`, enter a request through a second store, call `update(sessionId, 'token-never-committed')`, and throw one captured `handlerError` object.
Assert `withRequest` rejects with that identical object and a fresh third store still resolves `token-old`.
This test intentionally fails on the current separate-flush implementation because its `finally` block commits the update before rethrowing the handler error.

```ts
it('propagates handler failure and leaves the durable token unchanged', async () => {
  const creator = newStore();
  const failingStore = newStore();
  const finalStore = newStore();
  const sessionId = trackSession(
    await creator.withRequest({ consumeLoginTx: false }, async () =>
      creator.create({ hubRefreshToken: 'token-old' }),
    ),
  );
  const handlerError = new Error('handler failed');

  await expect(
    failingStore.withRequest({ sessionId, consumeLoginTx: false }, async () => {
      failingStore.update(sessionId, 'token-never-committed');
      throw handlerError;
    }),
  ).rejects.toBe(handlerError);

  const finalSession = await finalStore.withRequest(
    { sessionId, consumeLoginTx: false },
    async () => finalStore.get(sessionId),
  );
  expect(finalSession).toEqual({ hubRefreshToken: 'token-old' });
});
```

- [ ] **Step 3: Run all locked and regression tests before Green**

Run:

```bash
pnpm --filter @fxl-sales/api test -- src/auth/__tests__/hub-session-store.test.ts src/auth/__tests__/hub-session-scope.test.ts
pnpm --filter @fxl-sales/api test:integration -- test/rls/hub-bff-session-store.test.ts
```

Expected before Green is failure in the named stale-delete oracle and the handler rollback assertion.
The existing `answers 503 and never deletes the session cookie when hydrate fails` and `rethrows anything that is not a store-unavailable error` scope tests must remain Green.
Lock every new test after this run.

### Task 3: Implement one transaction and one row lock per session request

**Files:**

- Modify: `apps/api/src/auth/hub-session-store.ts`
- Test: `apps/api/src/auth/__tests__/hub-session-store.test.ts`
- Test: `apps/api/test/rls/hub-bff-session-store.test.ts`

**Interfaces:**

- Consumes: `NodeDb.transaction`, the existing `UnitOfWork`, and the unchanged synchronous SDK store methods.
- Produces: transaction-scoped private `#hydrate(db, uow, input)` and `#flush(db, uow)` methods.
- Produces: unchanged public `withRequest<T>(input, fn): Promise<T>` behavior with cross-replica per-session serialization.

- [ ] **Step 1: Thread the transaction handle through hydration**

Add `RequestDb` and `RequestPhase` as specified above.
Change `#hydrate` to use its `db` parameter for every query.
For a present `input.sessionId`, preserve the existing `id` and `expiresAt > now` predicates, add `.for('update')`, and keep `.limit(1)`.

```ts
const rows = await db
  .select()
  .from(hubBffSessions)
  .where(and(eq(hubBffSessions.id, input.sessionId), gt(hubBffSessions.expiresAt, now)))
  .for('update')
  .limit(1);
```

The lock must remain inside the transaction that later runs the handler and flush.
An absent or expired row returns no working-set entry and acquires no useful long-lived row lock, preserving the current unknown-session behavior.
Keep decrypting only after the locked row is read.
Keep login transaction deletion through the same `db` transaction handle so callback consumption commits or rolls back with the request.
Remove the private hydrate `try/catch` only after `withRequest` owns the hydrate-phase wrapping described below.

- [ ] **Step 2: Flatten flush into the request transaction**

Change `#flush` to return immediately for an empty operation list and otherwise replay the existing `SessionOp` switch directly against its `db` parameter.
Remove the nested `this.#db.transaction` and the private flush `try/catch`.
Do not change operation order, update fields, predicates, encryption, or TTL calculations.

```ts
async #flush(db: RequestDb, uow: UnitOfWork): Promise<void> {
  if (uow.ops.length === 0) {
    return;
  }
  for (const op of uow.ops) {
    switch (op.kind) {
      case 'session.create':
        await db.insert(hubBffSessions).values({
          id: op.id,
          hubRefreshTokenEnc: op.tokenEnc,
          accountId: op.accountId,
          expiresAt: op.expiresAt,
        });
        break;
      case 'session.update':
        await db
          .update(hubBffSessions)
          .set({
            hubRefreshTokenEnc: op.tokenEnc,
            expiresAt: op.expiresAt,
            updatedAt: new Date(),
          })
          .where(eq(hubBffSessions.id, op.id));
        break;
      case 'session.delete':
        await db.delete(hubBffSessions).where(eq(hubBffSessions.id, op.id));
        break;
      case 'login.create':
        await db.insert(hubBffLoginTxns).values({
          id: op.id,
          codeVerifierEnc: op.verifierEnc,
          state: op.state,
          expiresAt: op.expiresAt,
        });
        break;
      case 'login.delete':
        await db.delete(hubBffLoginTxns).where(eq(hubBffLoginTxns.id, op.id));
        break;
    }
  }
}
```

- [ ] **Step 3: Make `withRequest` own the transaction and phase-specific failures**

Use one transaction around hydration, the handler, and flush.
Capture the handler value before changing the phase to `flush`, because a flush or commit rejection must return that value after logging.

```ts
async withRequest<T>(input: HubSessionHydrateInput, fn: () => Promise<T>): Promise<T> {
  const uow: UnitOfWork = { sessions: new Map(), logins: new Map(), ops: [] };
  let phase: RequestPhase = 'hydrate';
  let handlerResult: { value: T } | undefined;

  return this.#als.run(uow, async () => {
    try {
      return await this.#db.transaction(async (tx) => {
        await this.#hydrate(tx, uow, input);
        phase = 'handler';
        const value = await fn();
        handlerResult = { value };
        phase = 'flush';
        await this.#flush(tx, uow);
        return value;
      });
    } catch (err) {
      if (phase === 'hydrate') {
        if (err instanceof HubSessionStoreUnavailableError) {
          throw err;
        }
        throw new HubSessionStoreUnavailableError('hub session hydrate failed', { cause: err });
      }
      if (phase === 'handler') {
        throw err;
      }
      console.error('[hub-session-store] flush failed', err);
      return handlerResult!.value;
    }
  });
}
```

The non-null assertion is valid only in the `flush` phase, which is assigned after `handlerResult` is stored.
Do not catch errors inside the transaction callback because PostgreSQL must observe the rejection to roll back.

- [ ] **Step 4: Run the focused Green tests**

Run:

```bash
pnpm --filter @fxl-sales/api test -- src/auth/__tests__/hub-session-store.test.ts src/auth/__tests__/hub-session-scope.test.ts
pnpm --filter @fxl-sales/api test:integration -- test/rls/hub-bff-session-store.test.ts
```

Expected Green is that every named test passes, the concurrent second request returns 200 without clearing the cookie, the final store sees `token-new`, the unrelated session completes while the first row is locked, and rollback tests preserve committed state.

### Task 4: Refactor only on Green and verify the slice

**Files:**

- Modify: `apps/api/src/auth/hub-session-store.ts`
- Test: `apps/api/src/auth/__tests__/hub-session-store.test.ts`
- Test: `apps/api/test/rls/hub-bff-session-store.test.ts`

**Interfaces:**

- Consumes: the Green implementation and locked tests from Tasks 1 through 3.
- Produces: one reviewable auth-session serialization diff with no public API or schema change.

- [ ] **Step 1: Apply bounded refactoring limits**

Keep the phase state local to `withRequest` and the transaction type private to this module.
Extract no coordinator, mutex, repository, transaction wrapper, or generalized unit-of-work abstraction.
Do not split `hub-session-store.ts` or rename existing public symbols.
Do not alter comments outside the hydrate, flush, and request-transaction explanation except to remove statements that are no longer true.

- [ ] **Step 2: Run the per-slice Gate 2 commands**

Run each command once:

```bash
pnpm --filter @fxl-sales/api test -- src/auth/__tests__/hub-session-store.test.ts src/auth/__tests__/hub-session-scope.test.ts
pnpm --filter @fxl-sales/api test:integration -- test/rls/hub-bff-session-store.test.ts
pnpm --filter @fxl-sales/api exec eslint src/auth/hub-session-store.ts src/auth/__tests__/hub-session-store.test.ts test/rls/hub-bff-session-store.test.ts
pnpm --filter @fxl-sales/api type-check
git diff --check
```

Expected result is PASS for every command.
The separate Verify agent must rerun these commands from a clean view and must not receive the planner context pack.

- [ ] **Step 3: Preserve wave-level verification for the orchestrator**

After this slice is merged with its wave, the separate wave Verify agent must run:

```bash
CI=true pnpm test
CI=true pnpm --filter @fxl-sales/api test:integration
CI=true pnpm run lint
CI=true pnpm run type-check
CI=true pnpm run build
pnpm audit --prod --audit-level high
git diff --check v2.3.1..HEAD
```

The dependency slice owns the full dependency-audit repair, so this slice must not change package manifests or `pnpm-lock.yaml`.

- [ ] **Step 4: Commit atomically after separate verification passes**

Stage only the three declared files:

```bash
git add apps/api/src/auth/hub-session-store.ts apps/api/src/auth/__tests__/hub-session-store.test.ts apps/api/test/rls/hub-bff-session-store.test.ts
git commit -m "fix(api): serialize durable session refreshes"
```

Do not include Nexo run artifacts, generated context packs, `.vscode/`, or unrelated worktree changes in the implementation commit.

## Self-Review Checklist

- The acceptance test uses two independent durable stores, real Hono middleware, and the real Postgres integration database.
- The Red expectation exposes the actual stale delete, 401 response, cookie clearing, and final missing row.
- The Green expectation proves row-level serialization, observation of the committed token, durable survival, and independence of another session.
- Transaction acquisition and hydration errors remain a 503-producing `HubSessionStoreUnavailableError` before the handler.
- Handler errors remain unchanged and roll back request mutations.
- Flush and commit errors roll back all operations, log once, and preserve the handler value.
- Login transaction consumption stays inside the request transaction.
- The plan modifies no middleware, SDK route, schema, migration, dependency, or browser behavior.
- All file paths, test names, commands, and commit scope are exact.
