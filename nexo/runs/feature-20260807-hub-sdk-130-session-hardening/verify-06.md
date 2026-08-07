# VERDICT: PASS

Slice `06-supersede-prior-session`, commit `27a5e40` on `feat/06-supersede-prior-session`, baseline `master`.
Verified independently: I read the shipped code and the installed SDK bundle myself and re-derived the slice's premise rather than accepting the author's account.
Per the task brief I did not open `notes-06.md` or `agents/exec-06.result.json`.

## Acceptance criterion

> A second `/auth/callback` from a browser that already held session A deletes A's row in the SAME transaction that inserts the new session, so A no longer resolves through `withSession`, while a session held by any other browser or device is untouched.

Every clause is proven, and each by a test that I confirmed moves under mutation.

| Clause | Oracle | Proven by |
| --- | --- | --- |
| A second `/auth/callback` deletes A's row | `apps/api/test/rls/hub-bff-login-supersede.test.ts:191` `leaves one live session after a re-login in the same browser, and none of the previous ones` | Runs through the REAL SDK router: two `GET /auth/login` + `GET /auth/callback` navigations in one cookie jar against real Postgres. Asserts `rowCount(first) === 0`, `rowCount(second) === 1`. |
| in the SAME transaction as the insert | `apps/api/test/rls/hub-bff-session-store.test.ts:518` `keeps the prior session when the new insert fails` | Mutation 1 below. It is the ONLY test in 169 integration tests that moves. |
| A no longer resolves through `withSession` | `hub-bff-session-store.test.ts:501` `makes the superseded session unresolvable through withSession`, plus `hub-bff-login-supersede.test.ts:204` | Asserts `store.withSession(A, tx => tx.get())` resolves `null`, which is what `dist/server.js:422-426` turns into `401 no_session`. |
| any other browser or device untouched | `hub-bff-session-store.test.ts:479` `leaves a session held by another browser untouched` and `hub-bff-login-supersede.test.ts:207` `does not touch a session held by a second browser` | Mutation 5 below. Both go red when the key is widened. |

Non-vacuity is covered: `creates a session normally when no prior session was presented` (`:551`) and `creates a session for a browser that presents no prior one` (`hub-bff-login-supersede.test.ts:226`) prove a first login is not a supersede and that an absent context is never an error.

## Command results

All run-once. No watcher was started; no process from this verification survives it.

| Command | Exit | Result |
| --- | --- | --- |
| `pnpm run type-check` | 0 | pass |
| `pnpm run lint` | 0 | pass, `apps/api` and `apps/web` both clean |
| `pnpm test` | 0 | 1103 tests / 91 files pass (shared-utils 80/3, api 382/39, web 641/49) |
| `pnpm run build` | 0 | pass, web bundle built in 1.62s |
| `pnpm --filter @fxl-sales/api test:integration` | 0 | 169 tests / 25 files pass, against local Docker `06--product--fxl-sales-db-1` (port 5006, healthy) |

Re-run after every mutation was reverted: `pnpm test` 1103 pass, integration 169 pass, `git diff -- apps packages` empty.

## Mutation results

| # | Mutation | Expected | Observed | Reverted |
| --- | --- | --- | --- | --- |
| 1 | `hub-session-store.ts`: lift the supersede `DELETE` out of the insert transaction into a bare `this.#db.delete(...)` before it | atomicity oracle RED | RED, and ONLY it: `1 failed \| 168 passed`. `keeps the prior session when the new insert fails` - `AssertionError: expected +0 to be 1` at `hub-bff-session-store.test.ts:547`. The prior session was destroyed by a login that then failed. | yes, `git checkout` |
| 2 | `app-auth.ts`: delete the `if (session.kind === 'durable')` guard, mount unconditionally | memory-path test RED | RED: `still serves /auth/callback without throwing` - `AssertionError: expected 500 to be 302`. The `TypeError: store.withLoginContext is not a function` becomes a bare 500 exactly as predicted. | yes |
| 3 | `app-auth.ts`: delete the `router.use('/auth/callback', ...)` mount entirely | wiring test RED | RED: `mounts the login-supersede middleware on /auth/callback`. The integration oracles call `withLoginContext` directly and all stayed green, which is precisely the gap this test closes. | yes |
| 4 | `app-auth.ts`: drop `router.onError(hubBffErrorHandler)` | slice 01's 503 oracle RED | RED: `answers 503 rather than a cookie-clearing 401 when withSession rejects, through app.route('', authBff)` - `expected 500 to be 503`. | yes |
| 5 | `hub-session-store.ts`: widen the key from `eq(id, priorSessionId)` to `ne(id, newId)`, i.e. the account-id / one-session-per-user shape | both multi-device oracles RED | RED: `leaves a session held by another browser untouched` AND `does not touch a session held by a second browser`. `2 failed \| 167 passed`. | yes |

Working tree after all reverts: `git status --porcelain` shows only `M nexo/.../budget.json`, `?? .vscode/` and `?? nexo/.../agents/exec-06.result.json`, all pre-existing. No mutation survives.

## Findings against checks 1-7

### 1. Atomicity - PROVEN

`apps/api/src/auth/hub-session-store.ts:174-214`. The `DELETE` and the `INSERT` are both `tx.` statements inside one `this.#db.transaction`, delete first.
`priorSessionId` is read at `:173`, deliberately OUTSIDE the transaction callback, with a comment explaining that the callback is an async boundary drizzle may schedule freely - that is correct and it matters, since `AsyncLocalStorage` context could otherwise be lost across the scheduling boundary.

The oracle is honest. It forces a real `INSERT` failure by pre-inserting a decoy row that owns the id the store is about to mint, using the new test-only `newId` injection (`createDurableHubSessionStore`, `:344-357`), and then asserts the prior row is **still present AND still readable** (`readToken(newStore(), priorId) === 'token-prior'`), not merely that a row count is 1.
The failure lands AFTER the delete has executed, which is the only ordering that distinguishes one transaction from two.
Mutation 1 confirms it is the single point of failure across the whole 169-test integration suite.

The `newId` seam is documented at `:348-355` as test-only and is never passed by `createHubSessionStore` (`:377-388`). I confirmed that by reading the factory: it constructs with `db` and `sealer` only.

### 2. The memory-store path - COVERED, and the guard is load-bearing

I verified the premise directly rather than trusting it.
`InMemoryHubSessionStore` is at `dist/chunk-XO3FVZPK.js:6-88`; its members are exactly `create`, `withSession`, `createLoginTransaction`, `consumeLoginTransaction`, `isExpired` and a test-only `get`. There is **no** `withLoginContext`.
`createAppAuthBff` (`app-auth.ts:241-246`) mounts the middleware only under `if (session.kind === 'durable')`, and the type system backs that up: `createHubSessionStore` returns a discriminated union (`hub-session-store.ts:370-376`) so the narrowing is what makes the call compile at all.

`apps/api/src/middleware/__tests__/app-auth-bff-memory-path.test.ts` covers it, in its own file because it needs a different module graph (`DATABASE_URL` unset) and vitest isolates per file - a correct call, since re-resetting modules inside the wiring test would clobber the captures its other tests assert on.
It requests `/auth/callback` **with a `fxl_hub_session` cookie present**, which is the only shape that would trip the missing method, and asserts a 302 to the error redirect rather than a 500.
Mutation 2 confirms it goes red on exactly the regression the brief predicted.

### 3. `router.onError(hubBffErrorHandler)` - PRESENT and PROVEN

`app-auth.ts:250`, after the conditional `router.use` and before `router.route('', bff)`.
It was not dropped. The comment at `:247-249` records that mounting it on the memory path too is inert and removes a branch, which is right.
Mutation 4 confirms slice 01's 503 oracle is still live and still the only thing standing between a store outage and a cookie-clearing 500.

### 4. Only the presenting browser - PROVEN by code and by test

By code: `hub-login-scope.ts:55` reads a single cookie off the incoming request, and `hub-session-store.ts:191-193` deletes by `eq(hubBffSessions.id, priorSessionId)`. There is no other predicate. A second device's id is never in the request and is unguessable (256-bit, `randomBytes(32)`), so it is unreachable from this code path.

By test, at two levels:
- Unit-of-store: `leaves a session held by another browser untouched` asserts the second browser's session is not merely present but still resolves its original token through `withSession`.
- End to end through the real SDK: `does not touch a session held by a second browser` drives two independent cookie jars through real `/auth/login` + `/auth/callback` navigations, logs the laptop in twice, and asserts the desktop still resolves.

Both carry explicit comments naming themselves as the anti-oracle for account-id keying. Mutation 5 confirms both go red if anyone later broadens the key.

I also verified the deviation's premise independently against the installed bundle (`@fxl-business/hub-sdk@1.3.0`, pnpm-patched for its broken `exports` field only):
- `grep -n "store.create"` on `dist/server.js` returns exactly two call sites - `:348` `createLoginTransaction` and `:408` `create`. I read `:407-413`: three keys, `hubRefreshToken`, `expiresAt`, `absoluteExpiresAt`. No `accountId`.
- `grep -n accountId dist/server.js` returns exactly one hit, `:208`, inside `verifyHubToken`'s return for the bearer path. It never touches the store.
- `:464` and `:519` are both `if (rotated) await tx.update({ ...record, hubRefreshToken: rotated })`, spreading back what `get()` returned.

So `hub_bff_sessions.account_id` really is unconditionally NULL, and an account-keyed supersede really would match zero rows forever. The deviation recorded in amended acceptance criterion 8 is justified on the facts, not asserted.

### 5. Delete by primary key, safe when absent - CONFIRMED

`hub_bff_sessions.id` is `text('id').primaryKey()` (`schema.ts:950`), and the supersede is `eq(hubBffSessions.id, priorSessionId)`. Primary key, single row at most.

The absent-row case is not covered by a shipped test, so I proved it empirically: I dropped a throwaway probe into `apps/api/test/rls/`, ran `create()` inside `withLoginContext({ priorSessionId: 'never_existed_<uuid>' })` against the real database, and confirmed it neither throws nor prevents the insert (new row present, 1). The probe file was deleted immediately afterwards and is not in the tree.
This matches the plan's stated rule and Postgres semantics. See "green but concerning" for the coverage note.

### 6. Slices 01-05 undisturbed - ALL GREEN

I enumerated the oracle names and confirmed each is present and passing in the clean runs above.

| Invariant | Oracle | State |
| --- | --- | --- |
| Row lock spanning read and write in `withSession` | `serializes two concurrent refreshes on one session id so no rotation is lost`; `does not block a different session id while one row lock is held`; `rejects ... when the row lock cannot be taken, and never runs the operation` | green |
| 503 not 401 on store outage | `answers 503 rather than a cookie-clearing 401 ...`; `answers 503 with the session cookie intact ...`; `degrading to a null store read instead of throwing would be visible as a cookie-clearing 401` | green, and mutation 4 proves it is live |
| PKCE single-use | `consumes a login transaction exactly once across instances`; `deletes an expired login transaction on consume and returns null` | green |
| 90-day absolute TTL a rotation cannot extend | `does not extend the absolute expiry when the SDK spreads the record back into update`; `does not move absolute_expires_at when a rotation slides expires_at`; `sets the absolute expiry once at create from the store constant` | green |
| Only a 401 tears the session down | `signs out at once when the BFF says the session expired, without entering the ladder`; `keeps the session and enters the ladder when a refresh is transiently unavailable`; `holds a cold start on a transient failure instead of signing out` | green |
| Ladder consecutive-failure reset | `resets the ladder after each recovery, so unrelated blips never accumulate` | green |
| Slice 04 durable logout intent | `does not auto-login while the logout intent is set`; `resets the URL to the default route while the logout intent is set`; `clears the intent whenever a live token is observed, so a stale intent can never lock the tab out` | green |
| Slice 05 three cache-flush sites | `drops every cached entry on logout`; `drops every cached entry on a workspace switch`; `drops the previous identity's cache on an in-page signed-out to signed-in transition`; plus the negative `keeps the cache when the revalidation ladder recovers from a blip` | green |

Nothing in the slice 06 diff touches `withSession`, `createLoginTransaction`, `consumeLoginTransaction`, the expiry logic, or any web file. I diffed `hub-session-store.ts` against master and confirmed the changes are confined to the new `HubLoginContext` type, the reinstated `DurableHubSessionStore` interface, the `#newId` / `#loginAls` fields, `withLoginContext`, the `create()` supersede block, and the factory's return-type widening.

### 7. Schema change scope - CORRECT, no migration needed

`apps/api/src/db/schema.ts` changed by exactly 8 added lines, and I confirmed mechanically that every one is a comment line: filtering the diff for added non-comment lines returns nothing.
The change is a JSDoc block above `accountId: text('account_id')` recording that the 1.3.0 BFF can never populate it, with a pointer to `hub-login-scope.ts` and to `nexo/ROADMAP.md`.

No column was added, removed, retyped, or re-nulled. `git diff master...HEAD --name-only` matched against `migration|drizzle|\.sql` returns nothing, correctly - a comment generates no DDL.
The supersede itself needs no index: the lookup is the primary key. That is, as the plan notes, a genuine advantage of the chosen key over the rejected one, which would have needed an index on a nullable column.

The column was deliberately left in place rather than dropped, with the drop tracked in `nexo/ROADMAP.md`. That is the right call for an irreversible change that buys nothing.

## Green but concerning

None of these is a FAIL. Recording them so they are not lost.

1. **The absent-prior-row case has no standing test.**
   The plan explicitly reasons about it ("a prior id that names an already-swept row deletes zero rows and is fine") and it is genuinely fine - I proved it against the real database - but nothing in the suite pins it. A stale or already-swept session id is a realistic input: the nightly `deleteExpiredHubBffSessions` sweep can remove a row while the browser still holds its cookie, and the very next login presents it. A one-line addition to `creates a session normally when no prior session was presented` would cover it. Low risk, since the behaviour is Postgres's rather than ours.

2. **`hub-bff-login-supersede.test.ts` re-assembles the router by hand instead of calling `createAppAuthBff`.**
   Lines 175-181 replicate the three lines of `app-auth.ts:235-251` in the same order, with a comment saying so. If someone reorders the real assembly - for instance mounting `router.route('', bff)` before the `router.use` - this end-to-end test would keep passing over its own copy.
   That gap is closed in practice by `mounts the login-supersede middleware on /auth/callback` in the wiring test, which drives the real `createAppAuthBff` output and which mutation 3 proved goes red on an unmounted middleware. So the combination is sound; it is the duplication itself that is worth knowing about at the next SDK bump.

3. **A primary-key collision at `create()` surfaces as a 503, not a login error redirect.**
   `create()` wraps every throw in `HubSessionStoreUnavailableError` (`:215-217`), which `hubBffErrorHandler` turns into a 503. This is pre-existing slice 01 behaviour, not something slice 06 introduced, and a 256-bit collision cannot happen in practice. Noted only because the atomicity oracle is the first thing to exercise that branch.

4. **A login CSRF would now also log the victim out.**
   Before this slice a forced `/auth/callback` orphaned the victim's row; now it deletes it. That is strictly the desired direction - the same request was already going to overwrite the victim's session cookie - and the SDK's single-use login-transaction cookie plus PKCE state means a forced callback already requires the victim's own `/auth/login`. No new exposure, but the blast radius of that pre-existing class changed shape.

5. **`hub-login-scope.ts` is a slightly misleading filename** for a file that no longer has anything to do with the deleted `hub-session-scope.ts`. The file header goes to real lengths to say "THIS IS NOT A RESURRECTION", which is good, but the near-identical name is what created the need for the disclaimer. Cosmetic.
