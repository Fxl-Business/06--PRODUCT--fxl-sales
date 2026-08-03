# Verify report - slice 01, durable BFF session store

- Branch: `feat/01-durable-bff-session-store`
- Diff inspected: `git diff --cached master -- apps/api` (15 files, 5276 insertions, 3 deletions)
- Verdict: **FAIL**
- Reason in one line: two defects introduced by this slice, one of which stops the API booting under the slice's own documented configuration, and one of which makes a required command flaky at roughly one run in four.

The core engineering is sound.
The oracle is genuinely non-vacuous, durability survives a real process restart, the refresh token is genuinely encrypted at rest with a genuine row binding, RLS is a genuine boundary, and the 503 failure semantics work exactly as designed.
Every one of those was proven by experiment, not read off the source.
The two blockers below are narrow and independently fixable, but both are real and both are in code this slice added.

---

## 1. Required commands

### `pnpm --filter @fxl-sales/api test`

Recorded run (tail):

```
 ✓ src/auth/__tests__/hub-session-store.test.ts (6 tests) 3ms
 ✓ src/domains/payouts/__tests__/idempotency-key.test.ts (3 tests) 1ms

 Test Files  31 passed (31)
      Tests  313 passed (313)
   Start at  11:52:32
   Duration  1.24s
```

Passed on the recorded run.
**It does not pass reliably.** See Blocker B.

### `pnpm --filter @fxl-sales/api test:integration`

```
 ✓ test/rls/hub-bff-session-store.test.ts (8 tests) 85ms
 ...
 Test Files  20 passed (20)
      Tests  109 passed (109)
   Start at  11:52:38
   Duration  7.44s
```

Passed. Stable across every repetition.

### `pnpm --filter @fxl-sales/api lint`

```
> @fxl-sales/api@1.0.0 lint /Users/cauetpinciara/Documents/fxl/projects/06--PRODUCT--fxl-sales/apps/api
> eslint src/
```

Passed, no output.

### `pnpm run type-check`

```
Scope: 4 of 5 workspace projects
packages/shared-types type-check: Done
packages/shared-utils type-check: Done
apps/api type-check: Done
apps/web type-check: Done
```

Passed.

---

## 2. Blocker A - a blank `HUB_SESSION_ENCRYPTION_KEY` stops the API booting

This slice adds to `apps/api/.env.dev.example`:

```dotenv
HUB_SESSION_ENCRYPTION_KEY=
```

`CLAUDE.md` documents the local setup as "`.env.dev.example` copied to `.env`", so this blank value is the default an operator ends up with.
`env.ts`'s own header comment states the problem exactly: "Treat empty strings as 'unset' ... Without this, `SENTRY_DSN=` (no value after the =) reaches zod as '' and fails".

This slice added the correct coercion to `env.ts`:

```ts
HUB_SESSION_ENCRYPTION_KEY: emptyToUndefined,
```

and then did not read it.
`app-auth.ts` reads `process.env` directly with `??`:

```ts
encryptionIkm: process.env.HUB_SESSION_ENCRYPTION_KEY ?? hubAuthConfig.secretKey,
```

`??` tests for `null | undefined` only, so `'' ?? secretKey` evaluates to `''`.
`createSessionSealer('')` then throws its length floor, and `server.ts:31` calls `createAppAuthBff()` at module top level, so the throw is a boot failure rather than a degraded route.

Proven end to end with a temporary probe that set the variable to the shipped blank value and called the real `createAppAuthBff`:

```
BOOT THREW -> hub session encryption key must be at least 32 characters
```

Fix is one token: read `env.HUB_SESSION_ENCRYPTION_KEY` (the entry this slice already added), or change `??` to `||`.

---

## 3. Blocker B - `session-crypto.test.ts > refuses a tampered ciphertext` is ~25% flaky

Observed twice across roughly ten runs of the required unit command:

```
 FAIL  src/auth/__tests__/session-crypto.test.ts > session sealer > refuses a tampered ciphertext
AssertionError: expected 'refresh-token-alpha' to be null

- Expected:
null

+ Received:
"refresh-token-alpha"

 ❯ src/auth/__tests__/session-crypto.test.ts:29:43
     29|     expect(sealer.open(flipped, 'row-1')).toBeNull();

 Test Files  1 failed | 30 passed (31)
      Tests  1 failed | 312 passed (313)
```

Loop evidence:

```
run 1 exit=1 ::       Tests  1 failed | 312 passed (313)
run 2 exit=0 ::       Tests  313 passed (313)
run 3 exit=0 ::       Tests  313 passed (313)
run 4 exit=0 ::       Tests  313 passed (313)
run 5 exit=0 ::       Tests  313 passed (313)
run 6 exit=0 ::       Tests  313 passed (313)
```

Root cause, measured over 20000 seals with a probe replicating the sealer:

```
plaintext bytes: 19
distinct final base64url chars: [ [ 'A', 5130 ], [ 'Q', 5005 ], [ 'g', 4885 ], [ 'w', 4980 ] ]
flip decoded to IDENTICAL ciphertext bytes in 5130/20000 = 25.6% of seals
```

The plaintext is 19 bytes, so the base64url ciphertext ends in a group carrying one byte.
Its final character encodes 2 significant bits plus 4 padding bits and can therefore only be one of `A`, `Q`, `g`, `w`.
The test's mutation is `last === 'A' ? 'B' : 'A'`.
When the final character is `A` (25.6% of seals) the flip to `B` changes only a padding bit, `Buffer.from(..., 'base64url')` decodes to byte-identical ciphertext, GCM verifies correctly, and `open` correctly returns the plaintext.
The test then fails.

This is a defect in the test, not in the AEAD: the implementation is behaving correctly, and the test simply does not always tamper with anything.
It still counts as a blocker, because a required command fails roughly one run in four, and `CLAUDE.md` is explicit that test flakiness must be fixed rather than tolerated.

A correct mutation flips a byte of the decoded ciphertext and re-encodes, or flips a character of the auth tag, rather than flipping a character that may land in base64 padding bits.

---

## 4. Non-vacuity experiments

### Experiment A - neutralise the durable store (the decisive one)

Changed `#hydrate` in `apps/api/src/auth/hub-session-store.ts` so the session load never runs:

```ts
if (false && input.sessionId) {
```

Result, the named oracle went red:

```
 FAIL  test/rls/hub-bff-session-store.test.ts > durable Hub BFF session store > resolves a session created by another store instance, which the in-memory default cannot
AssertionError: expected null to deeply equal { Object (hubRefreshToken) }
- Expected: { "hubRefreshToken": "refresh-token-alpha" }
+ Received: null
 ❯ test/rls/hub-bff-session-store.test.ts:91:22

 FAIL  test/rls/hub-bff-session-store.test.ts > durable Hub BFF session store > carries a rotated refresh token across store instances

 Test Files  1 failed (1)
      Tests  2 failed | 6 passed (8)
```

Restored, confirmed byte-identical against a backup copy, and `git diff` for that file is empty.

**The oracle is real.**
`storeA` and `storeB` are two separate `createDurableHubSessionStore(...)` objects.
Each owns its own `AsyncLocalStorage` and builds a fresh `UnitOfWork` per `withRequest`.
They share only the drizzle connection, which is the point.
The inline in-memory control (`memB.get(memSid)` null, `memA.get(memSid)` not null) is present and correctly discriminates a restart from a broken `create`.

### Experiment B - remove the wiring (`sessionStore: session.store`)

Deleted that single line from `createHubBff(...)` in `apps/api/src/middleware/app-auth.ts`, which restores the exact bug this slice fixes, and ran both suites:

```
 Test Files  31 passed (31)      <- unit (runs 2-6; run 1 hit the unrelated flake above)
      Tests  313 passed (313)

 Test Files  20 passed (20)      <- integration, including the oracle
      Tests  109 passed (109)
```

**Nothing in the repository catches it.**
The oracle constructs the durable store directly and never goes through `createAppAuthBff`, so it proves the store is durable but not that the store is handed to the SDK.
`app-auth.test.ts` (14 tests) never touches `createAppAuthBff` at all.

This is a coverage gap on the single line whose absence was the production bug.
It is not by itself a reason to fail the slice, since the written acceptance criterion is about the store rather than the wiring, and the wiring is correct in the shipped diff.
It should be closed, and it is cheap to close: assert that `createAppAuthBff()` returns a router (not the bare BFF) and that a `/auth/*` request reaches the scope middleware.

---

## 5. Audit points

### 1. Is the oracle real? **PASS**

Proven above by Experiment A.
Two genuinely independent store instances, no shared in-memory state, red when durability is removed.

### 2. Does it survive a real process restart, or only one process? **PASS**

The two-instances-in-one-process test is not the strongest available evidence, so I ran a genuine cross-process check with two separate `tsx` invocations:

```
PID=37654 CREATED 2Jm4qNzdR4DyAALLK-DXvVZ3QQvtwWDToMp9ufFTdL4
--- second, INDEPENDENT process (a genuine restart) ---
PID=37673 RESOLVED {"hubRefreshToken":"cross-process-token-alpha"}
```

Different OS processes, no shared memory of any kind, session resolved.
This is restart survival in the literal sense.

No long-lived process cache exists.
`hub-session-store.ts` has no module-level mutable state.
`#als` is a per-instance field, the `UnitOfWork` is a local built fresh inside each `withRequest` and dropped when it returns, and Experiment A shows `get` returns `null` the moment the database read is removed, which it could not do if anything were cached across requests.
The only module-level singletons in play are the `_adminDb` connection pool in `db/client.ts`, which caches a pool and not session state.

### 3. Is the refresh token encrypted at rest, and is the AAD binding real? **PASS**

Every persisted secret goes through `sealer.seal` before it reaches an op.
I traced all five ops: `session.create` and `session.update` carry `tokenEnc`, `login.create` carries `verifierEnc`, and the two delete ops carry no payload.
There is no code path that writes `hubRefreshToken` or `codeVerifier` as plaintext.
`state` is plaintext by an explicit, documented decision, and `account_id` is not a secret.

The AAD row binding is real, and I checked it at the database level rather than trusting the unit test.
I copied a valid ciphertext verbatim from its own row onto a different row id and asked the real store to resolve it:

```
PID=37688 SWAPPED_ROW_RESOLVES null
PID=37688 SWAPPED_ROW_CIPHERTEXT_PRESENT true
```

The ciphertext column is populated and the store still resolves `null`, because the row id is the AEAD additional data.
Moving a ciphertext between rows yields nothing.

### 4. Is RLS a genuine boundary? **PASS**

This is the point most at risk of a decorative pass, so I checked the mechanism directly rather than relying on the test.

Roles on the test cluster:

```
    rolname     | rolsuper | rolbypassrls
----------------+----------+--------------
 postgres       | t        | t
 fxl_sales_test | f        | f
```

Both tables carry the flags and the policy:

```
      relname       | relrowsecurity | relforcerowsecurity
--------------------+----------------+---------------------
 hub_bff_login_txns | t              | t
 hub_bff_sessions   | t              | t

             polname              |      relname       |            using_expr
----------------------------------+--------------------+-----------------------------------
 hub_bff_login_txns_admin_context | hub_bff_login_txns | (current_setting('app.fxl_admin'::text, true) = 'true'::text)
 hub_bff_sessions_admin_context   | hub_bff_sessions   | (current_setting('app.fxl_admin'::text, true) = 'true'::text)
```

Critically, the tenant role holds full DML grants, so a zero-row result is RLS and not a missing privilege:

```
    grantee     |     table_name     |          string_agg
----------------+--------------------+------------------------------
 fxl_sales_test | hub_bff_login_txns | SELECT,UPDATE,DELETE,INSERT
 fxl_sales_test | hub_bff_sessions   | UPDATE,SELECT,INSERT,DELETE
```

With a row present, over the ordinary tenant connection:

```
== app conn, RLS ON ==
 visible_rows
--------------
            0

== app conn INSERT attempt (expect RLS error) ==
ERROR:  new row violates row-level security policy for table "hub_bff_sessions"
```

Guard-deleted control, which is what makes the above non-vacuous:

```
== GUARD-DELETED CONTROL: disable RLS ==
 visible_rows_with_guard_deleted
---------------------------------
                               1
```

The same row becomes visible the instant RLS is disabled, so the zero is the policy doing work.
Restored immediately afterwards and re-confirmed (`rls=true force=true`, tables empty).

One thing the repo's own test does not prove, which I checked separately.
The test's `adminClient` connects as `postgres`, which is `rolsuper` and `rolbypassrls`, so its "the admin context sees it" assertion passes by superuser bypass and never exercises the policy's positive branch.
In production `getAdminDb()` normally reuses `DATABASE_URL`, an ordinary role, so the policy's positive branch is what has to work.
I verified that branch directly on the non-superuser role:

```
SET app.fxl_admin='true';
INSERT 0 1
 nonsuperuser_admin_can_read
-----------------------------
                           1
```

So the design holds for production, not only for a superuser test fixture.
Worth noting in the test file, but not a defect.

### 5. Failure semantics on a database outage. **PASS**

The concern is correct and the SDK confirms it. `dist/server.js` `/auth/refresh`:

```js
const record = sessionId ? store.get(sessionId) : null;
if (!sessionId || !record) {
  deleteCookie(c, sessionCookieName, baseCookieOptions());
  return c.json({ error: "no_session" }, 401);
}
```

So degrading a hydrate failure to an empty working set really would delete the cookie and log everyone out on a blip.

I proved the middleware does not do that, with a temporary test that mounted the real `createHubSessionScopeMiddleware` in a real Hono app over a store whose `withRequest` throws `HubSessionStoreUnavailableError`, behind a route that mimics the SDK's cookie-deleting 401:

```
 ✓ src/auth/__tests__/__verify_tmp_503.test.ts (1 test) 4ms
```

Asserted, and all four held: status is `503`, body is `{error:'unavailable', code:'session_store_unavailable'}`, the downstream handler never ran, and no `Set-Cookie` header was emitted.
The hydrate sits before the `try` in `withRequest`, so a hydrate failure skips both the handler and the flush, which is what makes this correct rather than incidental.
Flush failures are logged and swallowed, which is right, since the response is already formed.

Gap, not a failure: this behaviour has no test in the shipped diff.
`hub-session-scope.ts` has no test file at all.
The 503-without-cookie-deletion rule is the single most load-bearing failure decision in the slice and should be pinned by roughly the test I wrote and deleted.

### 6. CLAUDE.md compliance. **PASS**

- Em dash (U+2014) in the staged `apps/api` diff: none. En dash (U+2013): none. Checked by grep over the diff.
- `CHANGELOG.md` and auto-generated files: untouched. No file matching `changelog` or `generated` appears in the change list.
- Tenant queries: no existing tenant query was modified. The two new tables are deliberately non-tenant and cannot carry `org_id`, since a session row is written at `/auth/callback` before a workspace exists. They are reached only through `getAdminDb()` and are protected by the admin-context policy proven above, which is a stronger boundary than the `webhook_events` precedent.

### 7. Scope. **PASS with one note**

Every code change is under `apps/api/**`.
Nothing under `apps/web/**` and no edit to `CLAUDE.md`.

One file outside `apps/api`: `nexo/runs/batch-20260803-auth-session/verify-01-exec-report.md`.
That is the Nexo flow's own run capture rather than product code, and it is the directory this report is also written to, so I record it rather than count it against the slice.

### 8. Migration safety. **PASS**

`0016_hub_bff_session_store.sql` is purely additive: two `CREATE TABLE`, two `CREATE INDEX`, then `ENABLE`/`FORCE ROW LEVEL SECURITY` and one policy per table.
No `DROP`, no `ALTER COLUMN`, no `TRUNCATE`, no `RENAME`.
The only `drop` matches in the file are inside the header comment describing the rollback path.

No collision: `hub_bff` appears in no earlier migration, and neither table nor either index nor either policy name exists elsewhere.

Journal and snapshot chain intact:

```
journal entries: 17
{'idx': 16, 'version': '7', 'when': 1785768405092, 'tag': '0016_hub_bff_session_store', 'breakpoints': True}
0016.prevId == c4f4846e-1037-40f7-918b-2e9194b33257
0015.id     == c4f4846e-1037-40f7-918b-2e9194b33257
chain ok: True
tables added: ['public.hub_bff_login_txns', 'public.hub_bff_sessions']
tables removed: []
```

No schema drift between `schema.ts` and the migrations:

```
$ pnpm exec drizzle-kit check
Everything's fine 🐶🔥
```

The file name matches its `_journal.json` tag, as the plan required.

---

## 6. SDK claims, checked against the real package

Every comment in the diff that cites `@fxl-business/hub-sdk@1.2.0` internals is accurate.
Resolved package: `@fxl-business+hub-sdk@1.2.0`.

```
271:var SESSION_COOKIE = "fxl_hub_session";
272:var SESSION_COOKIE_SECURE = "__Host-fxl_hub_session";
273:var LOGIN_TX_COOKIE = "fxl_hub_login";
275:var LOGIN_TX_MAX_AGE_SECONDS = 600;
300:  const store = options.sessionStore ?? new InMemoryHubSessionStore();
305:  const secure = options.secureCookies ?? globalThis.process?.env?.["NODE_ENV"] === "production";
306:  const sessionCookieName = secure ? SESSION_COOKIE_SECURE : SESSION_COOKIE;
```

- The bug is real: line 300 is the in-memory fallback, and the `sessionStore` seam exists.
- `LOGIN_TX_TTL_MS === 600_000` matches line 275 exactly.
- `hubSessionCookieName` reproduces line 306 exactly.
- Passing `secureCookies` explicitly is behaviour-neutral: the value passed, `NODE_ENV === 'production'`, is byte-identical to the SDK's own default on line 305. No drift introduced.
- `InMemoryHubSessionStore` is exported from the package root (`dist/index.d.ts:2`), as claimed.
- All store call sites in the SDK (`createLogin` 316, `consumeLogin` 339, `delete` 404/449/480, `create` 375, `update` 412) live inside `/auth/*` handlers, so all of them fall inside the middleware's scope. No store method is ever reached outside a request, which is what makes the loud `HubSessionScopeError` safe.

---

## 7. Tree restoration

Restored to exactly the state found.

```
$ git diff --stat        # working tree vs index
(empty)

$ git diff --cached master --stat | tail -1
 15 files changed, 5276 insertions(+), 3 deletions(-)

$ git status --porcelain
... 15 staged entries, unchanged ...
?? .vscode/            # pre-existing, present at start
```

Both temporarily edited files (`hub-session-store.ts`, `middleware/app-auth.ts`) were restored from backups and verified byte-identical.
All temporary probe files were deleted.
Database side effects were cleaned up: both tables are empty and both carry `rls=true force=true`.
No process was left running; the only long-lived processes started were short `psql`, `tsx` and `vitest run` invocations, all of which exited on their own.

---

## 8. Overall reasoning

The design is good and the hard parts are right.
Hydrate-around-the-handler is the correct answer to a synchronous store interface, the request-scoped working set is genuinely request-scoped, the rejected alternatives in the plan are rejected for real reasons, and the security posture (AEAD with a row binding, FORCE RLS with an admin-context policy, 503 rather than a silent degrade) is stronger than the repo's existing precedent for a global table.
I tried to break each of those five claims and could not.

I am failing the slice on two concrete defects, both introduced here.

Blocker A is the serious one.
The slice ships a `.env.dev.example` line that, when copied as documented, prevents the API from starting.
The irony is that the slice added the exact zod coercion that fixes it and then read `process.env` instead of `env`.
A one-token change resolves it.

Blocker B makes a required command fail roughly one run in four.
The implementation is correct; the test's mutation just does not always mutate anything.
Under this repo's stated standard on flakiness that has to be fixed before the slice ships, and the fix is confined to one test.

Two further items should be addressed while those are in hand, neither of them a blocker on its own:

- Nothing catches the removal of `sessionStore: session.store`, which is the literal line whose absence was the production bug.
- `hub-session-scope.ts` has no test, so the 503-without-cookie-deletion rule is unpinned.

None of the four require touching the design.
Re-verification after the fixes should be quick.
