# VERIFY report - slice 03-preserve-session-and-route

- Branch: `feat/03-preserve-session-and-route` (uncommitted)
- Auditor: independent VERIFY sub-agent (did not write this code)
- Date: 2026-08-03

## Verdict

**FAIL.**

All four commands pass, and the primary acceptance oracle is genuinely non-vacuous - reintroducing the
original bug turns it RED, which is the single most important thing this audit had to establish.

The slice fails on audit point 2. The open-redirect sanitizer, `sanitizeReturnTo`, has a demonstrable
escape class: seven of the inputs I tried return a **protocol-relative URL** (`//evil.example`) from a
function whose documented contract is "a value is honoured only as a same-origin RELATIVE path". The
value reaches `history.pushState` unmodified. Nothing in the slice's own code stops it; the only thing
that prevents an off-origin resolution is the browser's own same-origin check on the History API, which
throws a `SecurityError` instead. A security control must not depend on a downstream backstop it does
not own - especially in this file, where `login()` already navigates via `window.location.assign`, and
`window.location.assign('//evil.example')` **does** go off-origin with no browser guard at all.

The fix is one line and I verified it closes all seven escapes with zero false rejections. See
[Point 2](#2-open-redirect---attack-table).

Two secondary findings (non-blocking, listed for the record): a timer that survives unmount in one
reachable interleaving, and three behaviours that are implemented correctly but have no oracle at all.

---

## Commands - real output

Each run exactly once, no watch mode.

### `pnpm --filter @fxl-sales/web test`

```
 Test Files  44 passed (44)
      Tests  470 passed (470)
   Start at  12:53:27
   Duration  4.36s (transform 1.89s, setup 0ms, collect 32.83s, tests 6.72s, environment 10.14s, prepare 2.65s)
```

Relevant files:

```
 ✓ src/auth/__tests__/react.test.tsx (11 tests) 59ms
 ✓ src/auth/__tests__/session-recovery.test.ts (29 tests) 4ms
 ✓ src/auth/__tests__/token.test.ts (8 tests) 6ms
 ✓ src/lib/__tests__/api-client-token-guard.test.ts (6 tests) 4ms
 ✓ src/sales-ops/__tests__/blank-bearer-token.test.tsx (3 tests) 72ms
```

### `pnpm --filter @fxl-sales/web lint`

```
> @fxl-sales/web@1.0.0 lint /Users/cauetpinciara/Documents/fxl/projects/06--PRODUCT--fxl-sales/apps/web
> eslint src/
```

Clean, no output.

### `pnpm run type-check`

```
Scope: 4 of 5 workspace projects
packages/shared-types type-check$ tsc --noEmit
packages/shared-utils type-check$ tsc --noEmit
packages/shared-types type-check: Done
packages/shared-utils type-check: Done
apps/web type-check$ tsc --noEmit
apps/api type-check$ tsc --noEmit
apps/api type-check: Done
apps/web type-check: Done
```

### `pnpm run lint`

```
Scope: 4 of 5 workspace projects
packages/shared-types lint: no lint for shared-types
packages/shared-utils lint: no lint for shared-utils
apps/api lint$ eslint src/
apps/web lint$ eslint src/
apps/api lint: Done
apps/web lint: Done
```

All four commands were re-run on the restored tree after every mutation experiment and produced
identical results.

---

## 1. Non-vacuity - mutation experiments

Eight mutations. Each was applied to the working tree, the suite was run, and the tree was restored
from a byte-for-byte backup before the next one.

| # | Mutation | Expected | Observed | Verdict |
|---|---|---|---|---|
| 1 | **The original bug restored**: `observeToken`'s null branch calls `applyToken(null)` unconditionally, ladder bypassed | RED | **RED**, 2 failures | non-vacuous |
| 2 | `sanitizeReturnTo` returns `value` unvalidated | RED | **RED**, 18 failures | non-vacuous |
| 3 | `consumeReturnTo` validates first, drops only on success | RED | **RED**, 3 failures | non-vacuous |
| 4 | Loop guard disabled (`isLoginBlocked` always false, `registerLoginAttempt` always true) | RED | **RED**, 5 failures | non-vacuous |
| 5 | `applyToken` dedupe guard removed | RED | **RED**, 1 failure | non-vacuous |
| 6 | Unmount timer cleanup removed | RED | **GREEN** | **no oracle** |
| 7 | `clearLoginAttempts()` removed from the success branch | RED | **GREEN** | **no oracle** |
| 8 | `revalidateAttempts.current = 0` removed from the success branch | RED | **GREEN** | **no oracle** |

### Mutation 1 - the decisive one

This is the experiment the audit brief singled out. Applied to `apps/web/src/auth/react.tsx`:

```ts
      // MUTATION 1: old behaviour restored - a null always signs the user out.
      applyToken(null);
      if (false as boolean) scheduleRevalidate();
```

replacing the `hasSessionRef` gate and the `scheduleRevalidate()` call. Result:

```
   × session preservation and route restore > keeps the signed-in session when a refresh resolves null once 5ms
     → expected "spy" to not be called at all, but actually been called 1 times
   × session preservation and route restore > captures and restores the pre-login route across a genuine re-login 1ms
     → expected "spy" to not be called at all, but actually been called 1 times
 Test Files  1 failed (1)
      Tests  2 failed | 9 passed (11)
```

The transient-failure oracle goes RED with the exact symptom of the reported bug: `login()` called once
after a single null token read. Restored, then re-run:

```
 Test Files  1 passed (1)
      Tests  11 passed (11)
```

**The primary acceptance oracle is real.** It fails for the right reason and passes on the honest code.

### Mutations 6, 7 and 8 - coverage gaps

Three behaviours are implemented correctly but nothing asserts them. All three mutations left the whole
`src/auth/__tests__/` suite at `61 passed (61)`.

- **Mutation 6** - deleting `useEffect(() => () => clearRevalidateTimer(), [clearRevalidateTimer])`
  changes no test result. The cleanup is unverified. See Point 4.
- **Mutation 7** - deleting `clearLoginAttempts()` from `observeToken`'s success branch changes no test
  result. This is precisely the "does a later successful token read genuinely reset it?" question the
  audit brief asked. The code does it; **no oracle proves it.** Low severity in practice, because the
  60-second window self-heals the counter anyway.
- **Mutation 8** - deleting `revalidateAttempts.current = 0` from the success branch changes no test
  result. **This is the most consequential gap.** Without that reset the ladder counter accumulates
  across recoveries, so the fourth transient blip of a session would exhaust the ladder immediately and
  sign the operator out - reintroducing the exact reported symptom ("roughly every five minutes... the
  whole app reloaded and destroyed the half-filled form"), just after a few blips instead of one. A
  future refactor could delete this line and ship the original bug back with a fully green suite. The
  missing test is cheap: null, recover, null, recover, null, recover, null - and assert the profile is
  still signed in and `login()` was never called.

---

## 2. Open redirect - attack table

Run against the real exported `sanitizeReturnTo` from `apps/web/src/auth/session-recovery.ts`, with
`origin = 'https://app.example'`. `resolvesTo` is `new URL(result, origin).href`, i.e. where the
returned value actually points.

| # | Input | Result | Resolves to | Off-origin |
|---|---|---|---|---|
| 1 | `https://evil.example/` | REJECTED | - | no |
| 2 | `//evil.example/x` | REJECTED | - | no |
| 3 | `/\evil.example` | REJECTED | - | no |
| 4 | `\\evil.example` | REJECTED | - | no |
| 5 | `/%2f%2fevil.example` | `/%2f%2fevil.example` | `https://app.example/%2f%2fevil.example` | no |
| 6 | `/%2F%2Fevil.example` | `/%2F%2Fevil.example` | `https://app.example/%2F%2Fevil.example` | no |
| 7 | `javascript:alert(1)` | REJECTED | - | no |
| 8 | `JaVaScRiPt:alert(1)` | REJECTED | - | no |
| 9 | `https:/\evil.example` | REJECTED | - | no |
| 10 | `\t/cadastros` (leading tab) | REJECTED | - | no |
| 11 | `\n/cadastros` (leading newline) | REJECTED | - | no |
| 12 | `\r/cadastros` (leading CR) | REJECTED | - | no |
| 13 | `/cadastros` (leading NUL) | REJECTED | - | no |
| 14 | `/cadastros` (embedded NUL) | REJECTED | - | no |
| 15 | `/cadastros` (embedded DEL) | REJECTED | - | no |
| 16 | `" /cadastros"` (leading space) | REJECTED | - | no |
| 17 | `/ca\tdastros` (tab inside) | REJECTED | - | no |
| 18 | `/cad astros` (line separator) | REJECTED | - | no |
| 19 | `/cad astros` (nbsp) | REJECTED | - | no |
| 20 | `/` + `a`x5000 (very long) | REJECTED | - | no |
| 21 | `/` + `a`x2047 (exactly 2048) | accepted | `https://app.example/aaa...` | no |
| 22 | `/` + `a`x2048 (exactly 2049) | REJECTED | - | no |
| 23 | `/x@evil.example` | `/x@evil.example` | `https://app.example/x@evil.example` | no |
| 24 | `HtTps://evil.example` | REJECTED | - | no |
| 25 | **`/..//evil.example`** | **`//evil.example`** | **`https://evil.example/`** | **YES** |
| 26 | `/.\\evil.example` | `/evil.example` | `https://app.example/evil.example` | no |
| 27 | **`/./\evil.example`** | **`//evil.example`** | **`https://evil.example/`** | **YES** |
| 28 | **`/..\\\\evil.example`** | **`//evil.example`** | **`https://evil.example/`** | **YES** |
| 29 | **`/../\evil.example`** | **`//evil.example`** | **`https://evil.example/`** | **YES** |
| 30 | `/%5C%5Cevil.example` | `/%5C%5Cevil.example` | `https://app.example/%5C%5Cevil.example` | no |
| 31 | **`/..//user@evil.example/`** | **`//user@evil.example/`** | **`https://user@evil.example/`** | **YES** |
| 32 | `data:text/html,<script>1</script>` | REJECTED | - | no |
| 33 | `cadastros/produtos` (no leading slash) | REJECTED | - | no |
| 34 | `/auth/callback` | REJECTED | - | no |
| 35 | `/authx/ok` (prefix lookalike) | `/authx/ok` | `https://app.example/authx/ok` | no |
| 36 | `/` | REJECTED | - | no |
| 37 | `""` | REJECTED | - | no |
| 38 | `///evil.example` | REJECTED | - | no |
| 39 | **`/.//evil.example`** | **`//evil.example`** | **`https://evil.example/`** | **YES** |
| 40 | `/?next=https://evil.example` | `/?next=https://evil.example` | `https://app.example/?next=...` | no |
| 41 | `/x#https://evil.example` | `/x` | `https://app.example/x` | no |
| 42 | `/／／evil.example` (fullwidth solidus) | `/%EF%BC%8F%EF%BC%8Fevil.example` | `https://app.example/...` | no |
| 43 | **`/a/../..//evil.example`** | **`//evil.example`** | **`https://evil.example/`** | **YES** |

**7 escapes.** Every input the audit brief named explicitly is correctly rejected. The escape class is
the one the brief did not name: **dot-segment normalization**.

### Root cause

`sanitizeReturnTo` performs its two structural character checks on the **raw** input:

```ts
  if (value[0] !== '/') return null;
  if (value[1] === '/' || value[1] === '\\') return null;
```

but returns the **normalized** value:

```ts
  const normalized = `${url.pathname}${url.search}`;
  return normalized === '/' ? null : normalized;
```

For `/..//evil.example` the raw second character is `.`, so both checks pass. `url.origin` is
`https://app.example`, so the origin check passes too - `new URL()` resolved it same-origin. But
`url.pathname` is `//evil.example`: the `/..` segment popped nothing at the root, leaving a
protocol-relative path. The origin check validates the *parsed* URL while the character checks validate
the *raw* string, and the returned value is neither - it is the normalized path, which nothing
re-validates. `\` variants reach the same place because the WHATWG URL parser treats `\` as a path
separator for special schemes.

The module docstring's stated invariant - "A value is honoured only as a same-origin RELATIVE path" -
is therefore false as implemented.

### Does it actually navigate off-origin?

I drove the escaped value through the real consumer path. Probe output:

```
ORIGIN: http://localhost:3000 SANITIZED: "//evil.example"
RAW_HISTORY_REPLACESTATE: THREW SecurityError: Failed to execute 'pushState' on 'History':
  A history state object with URL '//evil.example' cannot be created in a document with
  origin 'http://localhost:3000' and URL 'http://localhost:3000/'.
REACT_ROUTER_NAVIGATE: THREW SecurityError: Failed to execute 'pushState' on 'History':
  A history state object with URL '//evil.example' cannot be created in a document with
  origin 'http://localhost:3000' and URL 'http://localhost:3000/'.
```

So, stated precisely and without overclaiming: **today, on the current call path, the browser does not
navigate off-origin.** `HubProtected`'s restore uses `navigate(target, { replace: true })`, which routes
into `history.pushState`, and the History API enforces same-origin itself. The observable outcome is an
uncaught `SecurityError` thrown from inside the restore effect - a crash of the restore, not a redirect.

That is a mitigation the slice does not own, and it is thin:

1. The sanitizer is the app's declared open-redirect control. It is the thing a future reader will trust.
   It currently emits `//evil.example` and is documented as being incapable of that.
2. The mitigation is call-site-specific. `login()` in this very same file navigates with
   `window.location.assign`. `window.location.assign('//evil.example')` navigates straight to
   `https://evil.example` with no browser guard whatsoever. Any future change of the restore to a
   location assignment, a `<a href>`, a `window.open`, or a server round trip converts this into a live
   open redirect with no code change to the sanitizer.
3. The current behaviour is itself a defect: an uncaught throw in an effect during the sign-in restore
   path.

Per the audit brief - "The stored return path must only ever produce a same-origin relative navigation"
- this is a **FAIL**.

### Verified fix

One line, inserted after `normalized` is computed:

```ts
  const normalized = `${url.pathname}${url.search}`;
  if (normalized[1] === '/' || normalized[1] === '\\') return null;
  return normalized === '/' ? null : normalized;
```

Re-running the full table with that line applied: **`ESCAPE_COUNT: 0`**. All 7 escapes become `REJECTED`,
and both benign controls still pass (`/cadastros/produtos?kind=service` and `/a/../cadastros` ->
`/cadastros`). The existing `session-recovery.test.ts` suite stays green. I reverted the fix before
finishing; applying it is the implementer's call.

Recommend also adding the dot-segment cases to the `rejects %j` table in
`apps/web/src/auth/__tests__/session-recovery.test.ts`, since the current table covers only the raw-prefix
family and would not have caught this.

### Consume-exactly-once

**PASS.** `consumeReturnTo` reads, then calls `dropItem` **before** `sanitizeReturnTo`:

```ts
  const raw = readItem(storage, RETURN_TO_KEY);
  dropItem(storage, RETURN_TO_KEY);
  return sanitizeReturnTo(raw, origin);
```

Probe against a real `sessionStorage` seeded with `https://evil.example/`:

```
CONSUME_ONCE {"first":null,"after":null,"second":null}
```

The hostile value is destroyed on the same read that rejects it, so it cannot be retried on a later
mount, and a throw downstream cannot replay it. Mutation 3 (validate-first, drop-on-success-only) turns
this RED in 3 places, so the ordering is genuinely pinned. `HubProtected` additionally guards with
`restoredRef` so a StrictMode double effect is inert.

---

## 3. Redirect loop

**PASS**, with one coverage gap (Mutation 7) and one documented trade-off.

Cannot bounce indefinitely:

- `registerLoginAttempt` allows `MAX_LOGIN_ATTEMPTS = 3` per `LOGIN_ATTEMPT_WINDOW_MS = 60_000` per tab.
- The counter lives in `sessionStorage`, so it survives the full-page `login()` navigation that is the
  loop's own mechanism. This is the right store for the job.
- While blocked it returns `false` **without incrementing**, so the counter cannot run away.

Boundary, exercised at exactly the threshold by the `isLoginBlocked` differential test:

| State | `isLoginBlocked` | `registerLoginAttempt` |
|---|---|---|
| count 0-2, in window | false | true (increments) |
| **count 3, in window (threshold)** | **true** | **false, no increment** |
| count 3, window elapsed (`now - firstAt > 60000`) | false | true, resets to `{count: 1}` |
| after `clearLoginAttempts` | false | true |
| corrupt JSON | false | true |
| storage throws | false | true (fails open) |

The differential test `isLoginBlocked > answers exactly what registerLoginAttempt is about to answer`
asserts the two agree at every step for `MAX_LOGIN_ATTEMPTS + 2` iterations. That is the right shape:
the recovery panel is derived from the predicate while the counter is written by the register call, and
a disagreement would either strand a user who could still log in or bounce a user the guard claims to
have stopped. Mutation 4 turns 5 tests RED, so this is non-vacuous.

Cannot be left half-authenticated with no way forward: at the threshold `HubProtected` renders
`SessionRecoveryPanel`, a pt-BR panel with a `Tentar novamente` button. The retry clears the counter and
forces a re-read via `useReducer`, which flips `loginBlocked` false and re-arms the login effect on the
next render - no direct `login()` call, so there is one code path into login rather than two. The
integration test asserts `login` is not called while blocked and is called exactly once after the click.
Verified non-vacuous by Mutation 4.

Does a successful token read reset it? **Yes in the code** - `observeToken`'s non-null branch calls
`clearLoginAttempts()`. **But nothing asserts it** (Mutation 7 stays green). Low severity: the 60-second
window resets the counter regardless, so the explicit clear is belt-and-braces. Worth an assertion.

Two observations, neither blocking:

- The guard is a rate limiter, not a hard cap. Three attempts per rolling 60 seconds. If each
  login round trip took longer than 60 seconds the window would reset and the loop would continue
  slowly. Real round trips are seconds, so 3 attempts land well inside the window and the guard fires as
  intended. Acceptable.
- If `sessionStorage` throws, both halves fail **open** and the loop is unbounded. This is a deliberate,
  documented decision in the module ("refusing to log a user in because their browser blocks storage
  would be a worse bug than the loop this prevents"). I agree with the trade-off; noting it so it is a
  known property rather than a surprise.

---

## 4. Timer hygiene

**Mostly clean, one real leak in a reachable interleaving. Non-blocking.**

Clean parts, confirmed by reading and by probe:

- Ladder concurrency: `scheduleRevalidate` returns early while `revalidateTimer.current !== null`, so
  ~40 concurrent token readers produce **one** ladder, not 40. Probe measured exactly 1 pending timer
  after the first null.
- `failSession` and `logout` both call `clearRevalidateTimer()`, so an explicit sign-out kills the ladder
  and clears `hasSessionRef`, preventing a late resolution from resurrecting a profile.
- `useEffect(() => () => clearRevalidateTimer(), [clearRevalidateTimer])` clears a **pending** timer at
  unmount. `clearRevalidateTimer` has a stable identity (`useMemo` over `[applyToken, tokenCache]`, both
  stable), so the effect does not re-run and re-arm spuriously. Release is idempotent.

### The leak

There is one interleaving the cleanup does not cover: the timer has **already fired** and its
`tokenCache.getToken()` promise is **still in flight** when the component unmounts. At that instant
`revalidateTimer.current` is `null`, so the cleanup clears nothing. When the promise later resolves,
`observeToken(null)` runs with `hasSessionRef.current` still `true` and calls `scheduleRevalidate()`,
which schedules a **new** `setTimeout` after the component is gone. Nothing will ever clear it.

Probe output on the unmutated code:

```
timers after first null: 1
timers while rung-1 refresh in flight: 0
timers immediately after unmount: 0
LEAKED TIMERS AFTER UNMOUNT: 1
tokenCache.getToken calls at unmount: 3 -> after draining: 5 (post-unmount refreshes: 2)
timers still pending at end: 0
```

So: one timer scheduled post-unmount, two further `tokenCache.getToken()` network refreshes fired after
unmount, and the chain ends in `failSession()` -> `applyToken(null)` -> `setProfile` on an unmounted root.

**Severity: low, and I do not consider it blocking.** It is self-terminating (the ladder is bounded, so
it drains in ~5.5s and leaves 0 pending timers), `setState` on an unmounted root is a silent no-op in
React 18, and `AppAuthProvider` sits above the router in `apps/web/src/router.tsx`, so in production the
provider unmounts only when the whole app tears down. The cost is 2 stray refresh requests during
teardown.

The clean fix, if the implementer wants it, is a `mountedRef` (or reusing `operationGeneration`) checked
at the top of `observeToken`, so a resolution arriving after unmount is dropped instead of rescheduling.
Note this is exactly the seam Mutation 6 showed to be untested.

### act() warnings and unhandled rejections

**None in the delivered suite.** Full `pnpm --filter @fxl-sales/web test` output contains no
`Warning: An update to ... was not wrapped in act(...)`, no `Unhandled Rejection`, and no
`Unhandled Errors` block. The only `stderr` in the auth tests is:

```
⚠️ React Router Future Flag Warning: React Router will begin wrapping state updates in `React.startTransition` in v7.
⚠️ React Router Future Flag Warning: Relative route resolution within Splat routes is changing in v7.
```

These are react-router v6 forward-compat notices, not defects, and the identical pair already appears in
the pre-existing `src/__tests__/route-error-and-auth-context.test.tsx`. Not introduced by this slice.

(The `Warning: The current testing environment is not configured to support act(...)` lines that appear
above are from **my own throwaway probe files**, which did not set `globalThis.IS_REACT_ACT_ENVIRONMENT`.
The delivered `react.test.tsx` sets it correctly and is clean. Probe files were deleted.)

---

## 5. Token contract - no regression

**PASS** on all four CLAUDE.md requirements.

- **Memory-only browser tokens.** `apps/web/src/auth/token.ts` is **not modified by this slice**
  (`git status` shows only `react.tsx` and the two test files plus new `session-recovery.ts`). The new
  `sessionStorage` usage stores exactly two things: a relative path string under
  `fxl-sales.auth.returnTo` and `{count, firstAt}` under `fxl-sales.auth.loginAttempts`. No token, no
  claim, no account or workspace id is persisted. `sanitizeReturnTo` strips the hash and keeps only
  `pathname + search`. The invariant holds.
- **Cached until JWT `exp` minus 30s.** `token.ts` untouched; `src/auth/__tests__/token.test.ts`
  (8 tests) passes **unmodified** - it is not in the diff at all.
- **One in-flight refresh per provider.** `token.ts` untouched. The ladder adds extra `getToken()` calls
  but every one goes through `tokenCache.getToken()`, so the cache's existing single-flight dedupe still
  governs. The slice adds no second refresh path.
- **Logout and workspace-generation guards reject late responses.** `setActive` keeps
  `operationGeneration` unchanged and merely swaps `applyToken` for `observeToken` on the success path,
  which is behaviourally identical for a non-null token. `logout` is **strengthened**: it previously did
  `applyToken(null)`, and now calls `failSession()`, which additionally kills any in-flight ladder and
  clears `hasSessionRef`, so a late ladder resolution cannot resurrect a profile after sign-out. It also
  clears the login counter and consumes the stored return path, so a deliberate logout cannot bounce the
  next operator into the previous operator's screen. The two pre-existing guard tests
  (`does not restore authentication when a workspace switch resolves after logout begins`,
  `keeps the newest requested workspace authoritative when switches resolve out of order`) pass unchanged.

### Were existing tests weakened?

`apps/web/src/auth/__tests__/react.test.tsx` is the only pre-existing test file modified. I reviewed
every non-additive hunk:

1. The import line was expanded (`Protected`, `SESSION_REVALIDATE_DELAYS_MS`, `useAccessToken` added).
   Additive.
2. `flushReact()` gained a second `await Promise.resolve()`. This flushes **more** microtasks, needed
   because the ladder adds a promise hop. It strengthens or is neutral; it cannot mask a failure.
3. `beforeEach` gained `sessionStorage.clear()` and `probeRenders = 0`; `afterEach` gained
   `vi.useRealTimers()`. Correct hygiene, and `vi.useRealTimers()` in `afterEach` is the right way to
   stop fake timers leaking between files.
4. `Probe` gained a dep-less effect incrementing `probeRenders`.

**No existing `expect` was changed, weakened, or removed.** The diff contains no removed assertion lines.
All 5 pre-existing `AppAuthProvider token cache wiring` tests pass untouched.

One pre-existing hole I noticed while auditing this point, **not introduced by this slice**: if a
`getToken()` issued before `logout()` resolves with a token afterwards, `observeToken(token)` will apply
it and resurrect the session, because `getToken` does not consult `operationGeneration` the way
`setActive` does. The old code had the identical hole (`applyToken(token)` in the same position). Out of
scope for this slice; worth a `nexo/ROADMAP.md` note.

---

## 6. Composition with slice 02 (`require-token.ts`)

**PASS.** The ladder and the throwing helper do not fight.

`getToken` returns the raw token synchronously with respect to the ladder:

```ts
  const getToken = useCallback(async () => {
    const token = await tokenCache.getToken();
    observeToken(token);
    return token;
  }, [observeToken, tokenCache]);
```

`observeToken` is fire-and-forget - it schedules the revalidation as a side effect and `getToken` still
returns `null` immediately. Therefore:

- **A genuine dead session cannot become an endless spinner.** `requireToken` calls
  `assertBearerToken(null)` and throws `AuthTokenUnavailableError` on the very first null, exactly as
  before. The ladder never delays, retries, or swallows that throw. `isAuthFailure` still classifies it,
  so the UI still shows "your session ended" rather than a server fault.
- **The ladder is independently bounded** at 3 rungs / ~6 seconds and then calls `failSession()`, so even
  ignoring `require-token` entirely the app cannot sit half-authenticated forever.
- The pre-existing guard tests still pass: `src/lib/__tests__/api-client-token-guard.test.ts` (6 tests)
  and `src/sales-ops/__tests__/blank-bearer-token.test.tsx` (3 tests).

Behavioural note, not a defect - this is the slice's intended trade: during the ~6s ladder window
`isSignedIn` stays `true` while every `getToken()` returns `null`, so in-flight data hooks will surface
`AuthTokenUnavailableError` states while the chrome still reads as signed in. That is the whole point:
the operator sees a few seconds of transient errors instead of losing a half-filled produto form. Correct
call, and worth keeping in mind if an error boundary ever decides to hard-redirect on that error.

---

## 7. CLAUDE.md compliance

**PASS.**

- **No em dash.** `grep -c` for U+2014 over `git diff master -- apps/web` returns `0`; over both new
  untracked files, `0` and `0`. Prose consistently uses the plain dash. Verified mechanically, not by eye.
- **CHANGELOG.md not touched.** Not present in `git status`.
- **No auto-generated file hand-edited.** No lockfile, no migration, no generated type file in the diff.
- Product conventions respected: no native `<select>`/`<option>`/`<datalist>` introduced (web lint's
  `no-restricted-syntax` passes); the recovery panel uses `Button` from `@/components/ui/button`.
- The pt-BR hardcoded strings in `SessionRecoveryPanel` match the existing convention in this file
  (`Sair`, `Buscar workspace...`), and the code comments say so explicitly.

---

## 8. Scope

**PASS.** Every changed and added source file is inside `apps/web/src/auth/**`:

```
 M apps/web/src/auth/__tests__/react.test.tsx
 M apps/web/src/auth/react.tsx
?? apps/web/src/auth/__tests__/session-recovery.test.ts
?? apps/web/src/auth/session-recovery.ts
```

No edit to `apps/api/**`, `apps/web/src/lib/**`, `apps/web/src/sales-ops/**`, `apps/web/src/admin/**`,
`apps/web/src/finder/**`, or `CLAUDE.md`. `apps/web/src/router.tsx` is **not** modified - `Protected`
already sits inside the router at all six mount points, so `useLocation`/`useNavigate` resolve without a
routing change. That is a clean seam.

Also present in `git status`, neither a scope violation:

- `?? nexo/runs/batch-20260803-auth-session/verify-03-exec-report.md` - the implementer's own run record.
  **Not read**, per the audit brief.
- `?? .vscode/` - pre-existing untracked directory, present before this branch's work began.

---

## Tree restoration

The working tree was restored to exactly the state it was found in. Byte-for-byte backups of
`react.tsx` and `session-recovery.ts` were taken before the first mutation and restored after the last.

```
 M apps/web/src/auth/__tests__/react.test.tsx
 M apps/web/src/auth/react.tsx
?? .vscode/
?? apps/web/src/auth/__tests__/session-recovery.test.ts
?? apps/web/src/auth/session-recovery.ts
?? nexo/runs/batch-20260803-auth-session/verify-03-exec-report.md
```

Identical to the pre-audit status. `grep -rn "MUTATION\|PROBE-FIX\|zzprobe" apps/web/src` returns nothing.
All four probe files were deleted. All four commands were re-run on the restored tree and pass:
`44 files / 470 tests passed`, web lint clean, type-check clean, root lint clean.

No long-running process was started, so none needed killing. Every vitest invocation used `vitest run`.

---

## Summary of required actions

**Blocking:**

1. `sanitizeReturnTo` must re-validate the **normalized** value, not only the raw input. Seven
   dot-segment inputs currently yield `//evil.example`. One-line fix verified above
   (`ESCAPE_COUNT: 0`, no benign regressions). Add the dot-segment family to the `rejects %j` table in
   `session-recovery.test.ts`.

**Recommended, non-blocking:**

2. Add an oracle for the ladder counter reset on recovery (Mutation 8). Without one, deleting
   `revalidateAttempts.current = 0` silently reintroduces the reported bug with a green suite. This is
   the highest-value missing test in the slice.
3. Drop a post-unmount resolution in `observeToken` (a `mountedRef`), so an in-flight refresh cannot
   schedule a timer after unmount. Add an oracle for the unmount cleanup (Mutation 6).
4. Assert that a successful token read clears the login counter (Mutation 7).
