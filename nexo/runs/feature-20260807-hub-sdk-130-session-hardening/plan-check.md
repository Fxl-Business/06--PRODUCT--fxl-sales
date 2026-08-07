# Plan check - feature-20260807-hub-sdk-130-session-hardening

Auditor: plan-check sub-agent.
Scope: `00-OVERVIEW.md` plus slices 01 to 06, checked against `HUB-RESPONSE.md`, `CLAUDE.md`, the real `@fxl-business/hub-sdk@1.3.0` tarball at `nexo/runs/feature-20260807-hub-sdk-130-session-hardening/sdk-1.3.0/pkg/package/`, and the working tree at `6f6bf49`.
I wrote none of these plans.

## VERDICT: FAIL

Three blocking defects, all of them cross-slice seams that no single author could see.
None of them is a design error; each is a one-to-three-line correction to a plan file before execution starts.

The technical quality of the set is otherwise high, and unusually so.
I spot-checked every load-bearing SDK line-number citation and **every single one is exact** - see "SDK claims verified" below.
The repo-side citations I checked are exact too.
If the three items below are fixed, this set is safe to execute serially in the order 01, 02, 03, 04, 05, 06.

---

## SDK claims verified

Checked directly against `sdk-1.3.0/pkg/package/dist/server.js`, `dist/client.js`, `dist/session-store-COrln4Ro.d.ts` and `MIGRATION.md`.

| Claim | Cited by | Result |
| --- | --- | --- |
| `SESSION_COOKIE` / `SESSION_COOKIE_SECURE` / `LOGIN_TX_COOKIE` at `server.js:275-277` | 01, 06 | Exact |
| `LOGIN_TX_MAX_AGE_SECONDS = 600` at `server.js:279` | 01 | Exact |
| `assertModernSessionStore` at `server.js:304-310`, throws at construction | 01 | Exact |
| `store.createLoginTransaction` at `:348` with `now() + 6e5`, no `try` | 01 | Exact |
| `store.consumeLoginTransaction` at `:371`, no `try` | 01 | Exact |
| `store.create` at `:407-413`, three keys, **no `accountId`**, no `try` | 06 | Exact. This is the finding slice 06's whole rescope rests on, and it holds. `grep -n accountId dist/server.js` returns one hit, `:208`, inside `verifyHubToken`, never reaching the store. |
| `store.withSession` at `:422`, `:481`, `:535`, `:552`, none inside a `try` | 01 | Exact |
| `if (result.clear) deleteCookie(...)` at `:467` | 01 | Exact |
| The `Date.parse` expiry re-check at `:424` and `:483` | 02 | Exact, including `record.absoluteExpiresAt && now() >= Date.parse(...)`. Slice 02's `NaN`-disarms-the-gate reasoning for `toSessionRecord` is correct. |
| `if (rotated) await tx.update({ ...record, hubRefreshToken: rotated })` at `:464` and `:519` | 01, 02 | Exact. The SDK genuinely does not slide `expiresAt`, so slice 01's "recompute it ourselves" decision is required, not stylistic. |
| Defaults `sessionTtlSeconds = 7776e3`, `sessionAbsoluteTtlSeconds = 31536e3`, `timeoutMs = 1e4` at `:324-326` | 01, 02 | Exact |
| `dist/client.js` reads `res.status`, tests it, discards it | 03 | Exact. `MIGRATION.md`'s "it can now read it directly" really is false through the bundled client. |
| `peerDependencies: { hono: ">=4.12.28" }`, repo pins `4.12.25` | 01 | Exact, and `.npmrc` really does carry `strict-peer-dependencies=false` + `auto-install-peers=true`, so the duplicate-Hono hazard is real |
| `hono-base.js` `route(path, app)` wraps sub-app handlers in `compose([], app.errorHandler)` only when the sub-app's handler is non-default | 01 | Exact, verified at `node_modules/.pnpm/hono@4.12.25/node_modules/hono/dist/hono-base.js:111-124`. The `onError`-not-middleware mechanism is sound, and the "request through the outer `app.route`" false-positive trap slice 01 identifies is real. |
| Installed 1.2.0 answers `401 refresh_failed` for a network throw and an unparseable body (`:401`, `:406`, `:410`) | 03 | Exact. Slice 03's `depends_on: [01]` really is hard, not soft. |

Repo-side claims also verified: `lastAppliedToken` and `hasSessionRef` at `react.tsx:153`/`:155`; `hasSessionRef`'s only reader is `:245`; `sanitizeReturnTo` returns `null` for `/` (`session-recovery.ts:134`); `/` is a `Protected` route (`router.tsx:72-81`); `renderProvider` renders `UserControls` and `renderProtected` already takes `onReady`; `getHubBffBasePath` already strips trailing slashes so slice 03's un-stripped template literal cannot produce `//auth/refresh`; `migration-runner.ts:71` hardcodes `0018_professional_payable_identity` as the only phased tag; `0020` is the highest migration so `0021` is the right number; `hub_bff_sessions.created_at` is `NOT NULL DEFAULT now()` since `0016`; `adminClient` is `postgres(url, { max: 5 })` at `db/client.ts:64`; `server.ts:33` is `app.route('', authBff)`; `App.tsx` nests `AppAuthProvider` outside `QueryClientProvider` today.

One trivial inaccuracy, cosmetic only: slice 03 section 1.1 lists the permanent refresh codes as `invalid`, `expired`, `revoked`, `reuse_detected`.
`server.js:280` also includes `no_session`.
It changes nothing, because slice 03 classifies on the status and both bodies are `401`.

---

## BLOCKING issues

### B1. Slice 05's flush condition reads a ref that slice 03 provably deletes, and slice 05's stated fallback is false

**Slices:** 03 (deletes) and 05 (depends).

Slice 05 section 3b specifies the login-side flush as:

```ts
if (!hasSessionRef.current) queryClient.clear();
```

and hedges with: *"If slice 03 renamed `hasSessionRef`, use whatever flag it left that means 'a session was held before this token arrived'; the flush condition is semantic, not textual."*

Slice 03 does not rename it.
Section 2.4 deletes it outright - "`hasSessionRef` becomes dead and is REMOVED, along with its declaration, its comment, the write in `observeToken`, and the write in `failSession`. It has no other reader" - and that is correct: I confirmed the only reader is `apps/web/src/auth/react.tsx:245`, the cold-start branch slice 03 removes.

So after slice 03 there is **no flag at all** with that meaning, and slice 05's fallback instruction points at nothing.
The executor of slice 05 must invent the condition with no guidance.
The obvious wrong answer - flush on every non-null token - destroys the operator's cached screen on every transient blip, which is the same failure mode `SESSION_REVALIDATE_DELAYS_MS` exists to prevent.
Slice 04 section 5 actually spotted this and explicitly disowned it ("which is slice 05's problem and not this one's"), so the seam is genuinely unowned by all three.

**Fix.** Amend `05-auth-cache-flush.md` section 3b to name the post-03 condition explicitly. `lastAppliedToken` (`react.tsx:153`) is an exact behavioural substitute and already survives slice 03 untouched:

```ts
// `lastAppliedToken` is `undefined` before the first apply, `null` while signed out,
// and a token string while signed in. `hasSessionRef` is gone as of slice 03; this
// ref carries the same fact and is the one slice 03 leaves in place.
const wasSignedIn = typeof lastAppliedToken.current === 'string';
if (!wasSignedIn) queryClient.clear();
```

Case-by-case equivalence with the deleted ref: cold start `undefined` flushes (slice 05 argues that is a provable no-op); a ladder recovery leaves the previous token string in place so it does **not** flush, satisfying RED 5; a post-`failSession()` recovery sees `null` and flushes, satisfying RED 4; `setActive` sees the previous token string so this branch does not double-flush with 3c.
Also correct slice 05's section 3b code block, which still shows `function observeToken(token: string | null)` and `hasSessionRef.current = true`, both of which slice 03 removes.

### B2. Slice 06 types itself on `DurableHubSessionStore` and on a durable branch, both of which slice 01 deletes

**Slices:** 01 (deletes) and 06 (depends).

Slice 01, "What is deleted": *"The `DurableHubSessionStore` interface. It added exactly one member (`withRequest`) and now adds none; an empty extension is noise, so `createDurableHubSessionStore` returns `HubSessionStore` and `createHubSessionStore` returns `{ kind: 'durable' | 'memory'; store: HubSessionStore }`."*
Slice 01 also removes the `if (session.kind === 'memory') return bff;` early return from `createAppAuthBff()`.

Slice 06 then writes, in section 1:

```ts
export function createHubLoginSupersedeMiddleware(
  store: DurableHubSessionStore,
  options: { secureCookies: boolean },
): MiddlewareHandler;
```

and in section 2 "Add to `DurableHubSessionStore`: `withLoginContext<T>(...)`", and in section 3 "on the durable branch only".

After slice 01 there is no `DurableHubSessionStore` type and no durable branch, and `session.store` is typed as the SDK's `HubSessionStore`, which has no `withLoginContext`.
That is a type error, but the sharper problem is the runtime one it hides.
Slice 01 makes the memory fallback flow through the same router, so the middleware would be handed the SDK's `InMemoryHubSessionStore`, whose interface (`dist/session-store-COrln4Ro.d.ts`) has exactly four members and no `withLoginContext`.
Every `/auth/callback` in a local dev environment without `DATABASE_URL` would then throw `TypeError: store.withLoginContext is not a function`, and no test in slice 06 covers the memory branch.

Slice 06's own contingency notes cover `create()` not owning a transaction and the cookie constants moving, but not this.

**Fix.** Pick one and write it into `06-supersede-prior-session.md`:

- Reinstate the interface, which is now non-empty again and therefore no longer "noise":
  ```ts
  export interface DurableHubSessionStore extends HubSessionStore {
    withLoginContext<T>(context: HubLoginContext, fn: () => Promise<T>): Promise<T>;
  }
  ```
  and restore `createHubSessionStore`'s discriminated return (`{kind:'durable'; store: DurableHubSessionStore} | {kind:'memory'; store: HubSessionStore}`) so the `session.kind === 'durable'` narrowing type-checks at the mount site.
- Or type the middleware structurally as `store: { withLoginContext: ... }` and guard the mount with an explicit `session.kind === 'durable'` check.

Either way, slice 06 must state that the middleware is mounted **only** when the durable store is in play, and add a test that `createAppAuthBff()` on the memory path still serves `/auth/callback` without throwing.

**Second facet of the same issue, smaller but real.** Slice 06 section 3's `app-auth.ts` snippet is:

```ts
const router = new Hono();
router.use('/auth/callback', createHubLoginSupersedeMiddleware(session.store, { secureCookies }));
router.route('', bff);
return router;
```

It silently drops `router.onError(hubBffErrorHandler)`, which slice 01 puts on that exact router and which is the only thing turning a store outage into a `503` rather than a cookie-clearing `500`.
Slice 01's `it('answers 503 rather than a cookie-clearing 401 when withSession rejects, through app.route(\'\', authBff)')` would catch the regression, so this is defended, but the snippet should be corrected so the executor is not copying a regression out of the plan.

### B3. Frame acceptance criterion 8 is unimplementable as worded, and slice 06 rescopes it unilaterally

**Slices:** 00-OVERVIEW (contract) and 06 (deviates).

Criterion 8 reads: *"A second login supersedes the prior session **for that account** server-side rather than leaving it live and rotatable."*

Slice 06 opens with "READ THIS FIRST: the slice is rescoped, deliberately" and ships a supersede keyed on the prior **session id the browser presented**, not the account.
I verified the premise and it is correct: `dist/server.js:407-413` is the only `store.create` call site in the bundle and it passes no `accountId`, and `:464`/`:519` only spread the record back, so `hub_bff_sessions.account_id` is unconditionally `NULL` under 1.3.0.
Slice 06's argument that account keying would also fail to close the one-browser-two-identities case, while logging the operator out of every other device, is sound on the merits.

The problem is procedural, not technical.
The Frame is what the human approved at Gate 1, and an autopilot run should not silently narrow an approved acceptance criterion.
Left as-is, Gate 2's Verify agent is asked to prove a criterion that cannot be proven, and will either fail the run or hand-wave it.

**Fix.** Amend `00-OVERVIEW.md` criterion 8 before executing, and get it acknowledged:

> 8. A second login in a browser supersedes the session id that browser presented at `/auth/callback`, deleting that row in the same transaction that inserts the new one, so the prior session is no longer live or rotatable. Keying on the account id is impossible under SDK 1.3.0 (`hub_bff_sessions.account_id` is always `NULL`) and would not close the one-browser-two-identities case; sessions orphaned without a login are bounded by `absoluteExpiresAt` and the nightly sweep instead.

Also add `nexo/runs/feature-20260807-hub-sdk-130-session-hardening/HUB-RESPONSE.md` to slice 06's `files_modified` - the plan instructs edits to it in "Report back to the Hub" but does not declare it.

---

## NON-BLOCKING observations

### N1. Slice 04's ordering rationale is mechanically wrong, and it would enshrine that in CLAUDE.md

Slice 04 makes `markLogoutIntent()` being the **first** statement of `logout()` a load-bearing invariant, doc-comments R1 as "the ordering oracle", and asserts that "Moving `markLogoutIntent()` below `failSession()` turns the first three red."
It grounds this in the wizard-submit-button precedent from CLAUDE.md.

That precedent does not transfer.
The wizard bug lives between two distinct browser phases - event dispatch, then activation behaviour - and React's synchronous flush lands between them.
Here everything from `markLogoutIntent()` through `consumeReturnTo()` is one uninterrupted synchronous block inside `logout()`, and React cannot re-render in the middle of a synchronous function.
The discrete-event flush happens when the `onClick` handler returns, which is after the entire synchronous block regardless of internal ordering.
The measured bug in `ROADMAP.md` is therefore not an ordering bug at all: `consumeReturnTo` clears the slot, React then flushes, and the login effect refills it.
`markLogoutIntent()` placed anywhere before the first `await` fixes it identically.

Consequences: R1 will not go red on the mutation its doc comment claims it catches, and slice 04's CLAUDE.md paragraph (section 7.1) would permanently record an incorrect mechanism in the repo's invariants.

**Recommended fix, no behaviour change.** Keep `markLogoutIntent()` first - it is the right defensive position and it is the only one that stays correct if an `await` is ever inserted above it.
Restate the invariant as slice 05 already states it correctly: *"synchronous and before the first `await` in `logout()`"*.
Drop "the ordering oracle" doc comment from R1 and describe it as what it actually is: the oracle for "the login effect's body never ran", which it genuinely is via the unspent `LOGIN_ATTEMPTS_KEY`.
Correct section 1.1 and section 7.1's CLAUDE.md text accordingly.

### N2. Slice 03's coupling pin is self-referential, the exact failure mode slice 01 called out

Slice 01 makes a good argument that a constant comparison proves nothing: *"Comparing `SESSION_COOKIE === 'fxl_hub_session'` only ever proved our constant matched itself"*, and it replaces the pin with behavioural assertions against the **real** SDK.

Slice 03's equivalent pin, test 6.1.6 `posts to the BFF refresh endpoint with credentials included`, asserts a fake `fetch` was called with `<base>/auth/refresh` and `{method:'POST', credentials:'include'}`.
That asserts our literal against our literal.
If a future SDK moves the path or the method, that test stays green and the app silently 404s, which slice 03's own classifier reads as transient - a six-second Skeleton and then a login, on every page load.
Slice 03's R3 acknowledges the risk but the mitigation it names is this test.

**Suggested addition, cheap.** One Node-environment test that constructs the real `createHubBff(config, { sessionStore: new InMemoryHubSessionStore() })` and asserts `POST /auth/refresh` with no cookie answers `401`, and that `POST /auth/refreshx` does not exist.
That is the slice-01-grade version of the same pin and it fails loudly on an SDK path change.

### N3. Slice 02's "logs NOBODY out" claim has a shelf life

The backfill is `created_at + interval '90 days'`, and the safety argument is that `hub_bff_sessions` was created on 2026-08-03 so no row can be more than a few days old.
That is true today (2026-08-07) and the reasoning for `created_at` over `now()` is right.
It stops being true if this run sits unshipped: any row older than 90 days at deploy time is backfilled into the past and dies on its next access.
Worth one sentence in the migration comment ("this holds while the oldest row is under 90 days old; re-check before shipping if this migration is delayed").

### N4. Slice 06's AsyncLocalStorage is genuinely different from the one slice 01 removes - judged on the merits

I was asked to judge this specifically, so: **it is not a resurrection.**

What slice 01 removes is a request-scoped unit of work that read rows out of Postgres before the handler, held a mutable working set for the handler's synchronous store calls, flushed it in a transaction afterwards, and had a failure mode severe enough to need its own `503` because an empty working set would log every user out.
What slice 06 adds carries one `string | undefined` read from a cookie, performs no I/O, holds no lock, has no failure mode, and is mounted on exactly one path.
It is also forced: `store.create` is called by the SDK from inside `createHubBff`'s `/auth/callback` handler (`server.js:408`) with no seam for an extra argument and no `createHubBff` option to carry one.
Slice 06 already instructs a file header stating this.
Its "mounted on `/auth/callback` only, because that is provably the sole `store.create` call site" claim is correct - I checked the whole bundle.

One gap: slice 01's CLAUDE.md rewrite says "There is no hydrate phase, no flush phase and no `AsyncLocalStorage` working set".
That sentence survives literally, since a one-string context is not a working set, but slice 06's CLAUDE.md addition says nothing about the mechanism.
Slice 06 should add one sentence distinguishing the two, or a future reader will read slice 01's paragraph as forbidding what slice 06 ships.

### N5. Slice 05's test specs are written against the pre-03 mock shapes

Slice 05 was written before 03 and 04 existed and says so honestly.
Beyond B1, its RED 4 uses `mocks.cache.getToken.mockResolvedValueOnce(profileToken('Alpha')).mockResolvedValue(null)`; post-03 the cache resolves a `HubTokenResult`, so the `null` must become `{token: null, failure: 'transient'}`.
`transient` specifically, not `expired`: an `expired` read short-circuits `failSession()` with no ladder, so the "advance through every rung" step would never run.
Mechanical, but name it in the plan so the executor does not discover it.

### N6. The 01/02 `sessionTtlSeconds` contradiction resolves cleanly

Confirmed coherent.
Slice 01 says do not pass the two options; slice 02 supersedes and passes both.
Executed serially there is no conflict, and critically slice 01's test list contains **no** assertion that the options are absent - it only asserts `timeoutMs`.
Had slice 01 added `expect(bffOptions?.sessionTtlSeconds).toBeUndefined()`, slice 02 would have broken it.
Slice 02's claim that passing them is purely declarative is also correct: the SDK only uses them at `:410-411` to compute the `expiresAt`/`absoluteExpiresAt` it hands to `store.create`, which our store ignores by design.

### N7. Dependency graph

The declared edges are `01 <- 02`, `01 <- 03`, `02 <- 06`, `03,04 <- 05`, with `04` free.
The serial order 01, 02, 03, 04, 05, 06 satisfies every edge, so the order is valid.

- `01 <- 03` is correctly declared as hard. I verified the installed 1.2.0 answers `401 refresh_failed` for a network throw (`:401`) and an unparseable body (`:410`), so shipping 03 first really would convert every blip into an instant sign-out.
- `06` should also declare `depends_on: 01`. It is satisfied transitively through 02, and 06's own "Assumptions about slices 01 and 02" section admits it was planned blind, but the edge is missing from the graph.
- `04 depends_on: []` is defensible - it touches no API file and no SDK surface - and slice 04 handles both the pre-03 and post-03 mock shapes explicitly in section 6.1. Fine.
- No edge is unnecessary. `05 <- 04` is real (the `logout()` statement ordering), and `06 <- 02` is real in two ways: the absolute TTL is the backstop for the rows the session-id key cannot reach, and `create()`'s final shape comes from 02.

### N8. Testable acceptance

Every slice carries a frontmatter `acceptance` line that a separate verifier can judge without reading the implementation.
01 names the four behaviours its oracles prove; 02 names the column, the non-extension and the sweep; 03 states the `401` versus `503`/`502` split in observable terms; 04 states four storage and URL facts; 05 states `getQueryCache().getAll()` is empty; 06 states the row-level outcome plus the multi-device non-effect.
No gaps here.

### N9. Named oracle tests

Every slice names its RED tests by file and test name, and the discipline against observing-a-race is applied consistently and well:

- Slice 01's `bSaw === 'token-a'` is a genuine non-vacuity check (delete `.for('update')` and it becomes `'token-old'`), and the commit-failure oracle asserts a rejection plus the absence of the operation's sentinel rather than trying to observe a phase.
- Slice 02's `expect('absoluteExpiresAt' in setArg).toBe(false)` asserts key **absence** rather than value equality, which is the stronger form, and the three-row sweep test names its own non-vacuity row.
- Slice 03 uses `vi.getTimerCount()` explicitly because the ladder is the only timer scheduler in the file, so `0` after a `401` proves no rung exists rather than that none has fired yet. This is exactly the right response to the happy-dom precedent in CLAUDE.md.
- Slice 04 uses `sessionStorage.getItem(LOGIN_ATTEMPTS_KEY) === null` as proof the login effect's body never ran, and R6 is the anti-lockout test that goes red if the clear is put in `applyToken` behind its unchanged-token early return.
- Slice 05's RED 5 is the guard against the obvious wrong implementation, and RED 3 pins the in-flight cancellation semantics it read out of `query-core` rather than assumed.
- Slice 06's test 4 (`keeps the prior session when the new insert fails`) is a real atomicity oracle that goes red on exactly the mistake constraint 5 names, and test 2 is a standing anti-oracle for the rejected account-id key.

The one test whose claimed red-on-mutation property does not hold is slice 04's R1, covered in N1.
The one pin that is self-referential is slice 03's 6.1.6, covered in N2.

### N10. Danger review

Nothing in the set can lose data or break tenant isolation, and slice 05 materially improves cross-tenant exposure in the browser.
The three sharpest candidates:

- **Slice 02's NOT NULL migration.** Safe. The column is additive, the backfill is derived from a `NOT NULL DEFAULT now()` column, and the `set_config('app.fxl_admin', 'true', true)` line matches the precedent in `0020` and `0012` and is transaction-local, which the runner's single transaction preserves. The rolling-deploy window (an old replica inserting without the column) blocks **new** logins only, surfaces as a `503` rather than a cookie-clearing `401`, harms no existing session, and is documented with its rejected alternatives. Accepted.
- **Slice 04's durable logout intent.** The lockout analysis in section 4.5 is genuinely exhaustive and each mitigation is real: exact sentinel, fail-open in both directions, `sessionStorage` so a tab close clears it unconditionally, and two independent clearing points of which `observeToken`'s live-token branch is the one that makes lockout structurally impossible. I could not construct a case it misses.
- **Slice 06 changing who gets logged out when.** The `SameSite=Lax` reasoning is correct (the SDK sets `sameSite: "Lax", path: "/"` at `:328`, and `/auth/callback` is a top-level GET). Only the browser that presents the id can cause its deletion, the delete is by primary key so a stale id is a zero-row no-op, and the delete only runs on the success path (`create` is never reached on a failed callback). No multi-device blast radius. The one real hazard is B2's memory-store path.

---

## Coverage table

| # | Acceptance criterion (00-OVERVIEW) | Owner | Status |
| --- | --- | --- | --- |
| 1 | `@fxl-business/hub-sdk` resolves to 1.3.0 in `apps/api` and `apps/web`, and the API boots | 01 | Owned. The boot half is genuinely proven: `app-auth-bff-wiring.test.ts` delegates to the real `createHubBff`, so `assertModernSessionStore` runs for real against our store at construction time. |
| 2 | `apps/api/src/auth/hub-session-scope.ts` no longer exists, and no middleware hydrates a session working set around the BFF handler | 01 | Owned. Slice 06 mounts a new `/auth/callback` middleware, but it hydrates no working set, so the criterion as worded still holds. See N4. |
| 3 | Concurrent refreshes on one session id serialize behind a row lock inside `withSession`, and a commit failure surfaces as a non-2xx | 01 | Owned. Integration oracle for the lock, unit oracle for the commit failure, plus the `503` handler with a real-SDK end-to-end assertion. |
| 4 | A session past either `expiresAt` or `absoluteExpiresAt` is deleted inside the transaction and reported absent | 02 | Owned. Slice 01 deliberately shapes the predicate so 02 adds one term. |
| 5 | A `503` or `502` from `/auth/refresh` preserves the session and is retried; only a `401` tears it down | 03 | Owned |
| 6 | After an explicit `Sair`, the stored return-to path is not re-captured, and the app does not immediately re-login | 04 | Owned. The mechanism is correct; the rationale for it is not, see N1. |
| 7 | No cached query data survives a logout, a login, or a workspace switch | 05 | Owned, but **blocked by B1** - the login-side flush condition has no implementation after slice 03. |
| 8 | A second login supersedes the prior session for that account server-side rather than leaving it live and rotatable | 06 | **Partially owned, rescoped.** The account-keyed form is provably unimplementable under 1.3.0. Superseded by session-id keying, which is narrower and better against the stated threat. **Blocked by B3** until the Frame text is amended. |
| 9 | `pnpm run lint`, `type-check`, `test`, `build` green, and `pnpm --filter @fxl-sales/api test:integration` passes locally | 01, 02, 06 | Owned. Each of the three API slices runs the integration suite in its own Verify block; 03, 04 and 05 correctly note they touch no API file and defer to the feature-level gate. |

**No criterion is UNOWNED.**

---

## Unowned seams

1. **The `hasSessionRef` replacement.** B1. The only one that materially threatens correct behaviour.
2. **`HUB-RESPONSE.md`** is edited by slice 06 per its "Report back to the Hub" section but is absent from its `files_modified`. Bookkeeping only.
3. **`apps/web/src/auth/__tests__/react.test.tsx`** is rewritten by 03, extended by 04, extended by 05, and no slice owns a final reconciliation pass. Serial execution plus each slice's "re-run the whole file, not just the new describe" instruction covers it in practice. Worth an explicit note in slice 05's Verify block that the file it is extending is the post-04 version.
4. **Slice 06's test 9** says "same shape as the existing `mounts the session-scope middleware on /auth/*`", which slice 01 deletes. The shape is still describable from slice 01's replacements, so this is a wording fix only.
5. **Slice 01's claim that `compose.js` and `hono-base.js` are byte-identical between `hono@4.12.25` and `4.12.28`** is the one load-bearing claim I could not independently verify, because `4.12.28` is not installed. I verified `4.12.25` matches the described behaviour exactly. The executor should re-run that diff after `pnpm install` rather than trusting the plan.

---

## Summary of required fixes before execution

1. `05-auth-cache-flush.md` section 3b: replace `hasSessionRef.current` with the `lastAppliedToken`-derived condition given in B1, and update the code block to slice 03's `observeToken(result: HubTokenResult)` shape.
2. `06-supersede-prior-session.md` sections 1, 2 and 3: resolve `DurableHubSessionStore` and the durable-branch mount against slice 01's deletions, per B2, and restore `router.onError(hubBffErrorHandler)` in the `app-auth.ts` snippet.
3. `00-OVERVIEW.md` criterion 8: amend to the session-id-keyed wording per B3, with human acknowledgement, and add `HUB-RESPONSE.md` to slice 06's `files_modified`.

Recommended but not required: N1 (correct slice 04's ordering rationale before it reaches CLAUDE.md), N2 (add a real-SDK pin for the `/auth/refresh` contract), N3 (one sentence on the backfill's shelf life), N4 (one sentence in slice 06's CLAUDE.md text distinguishing its `AsyncLocalStorage` from the deleted one).
