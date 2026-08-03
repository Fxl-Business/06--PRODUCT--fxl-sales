# Slice 03 - executor report

Slice: `03-preserve-session-and-route`
Branch: `feat/03-preserve-session-and-route` (no commit made; the orchestrator commits)
Status: **PASS**

## Files changed

Scope stayed inside `apps/web/src/auth/**`.
`git status` shows exactly four touched paths plus the pre-existing untracked `.vscode/`.

### NEW `apps/web/src/auth/session-recovery.ts`

Pure module, no React and no SDK.
Holds everything that has to survive the `/auth/login` -> `/auth/callback` full-page round trip.

- `RETURN_TO_KEY`, `LOGIN_ATTEMPTS_KEY`, `LOGIN_ATTEMPT_WINDOW_MS = 60_000`, `MAX_LOGIN_ATTEMPTS = 3`.
- `StorageLike` = `Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>`; every helper takes an optional
  `storage` defaulting to `defaultStorage()` (`globalThis.sessionStorage`, `try/catch`, `null` on throw).
- `sanitizeReturnTo(value, origin)` - the seven-rule open-redirect guard (detail below).
- `captureReturnTo(path, origin, storage?)` - sanitizes on write, writes nothing when the result is `null`.
- `consumeReturnTo(origin, storage?)` - `removeItem` **before** validating.
- `registerLoginAttempt(now?, storage?)` - the anti-redirect-loop guard; does not increment while blocked.
- `clearLoginAttempts(storage?)`.
- `isLoginBlocked(now?, storage?)` - **added beyond the plan**, see "Deviations".

Every individual storage call is separately wrapped in `try/catch`, so a Safari private-mode or hardened
enterprise `sessionStorage` that throws is indistinguishable from an empty one and degrades to "no route
restore", never to a broken login.

### `apps/web/src/auth/react.tsx`

- New exported constant `SESSION_REVALIDATE_DELAYS_MS = [500, 1_500, 4_000] as const`.
- New local `currentOrigin()` (`''` when there is no `window`, which makes every `new URL(value, origin)`
  throw and therefore reads as "no restore").
- New imports: `useLocation`/`useNavigate` from `react-router-dom`, `Button`, `useReducer`, and the six
  session-recovery helpers.
- `HubAuthProvider` gained four refs: `lastAppliedToken` (sentinel `undefined`), `hasSessionRef`,
  `revalidateAttempts`, `revalidateTimer`.
- `applyToken` gained the identity memo as its first statement
  (`if (lastAppliedToken.current === token) return;`). `profileFromToken` is pure over the token, so this
  is behaviour-preserving by construction; the `undefined` sentinel guarantees the first apply - including
  a first apply of `null`, which must flip `isLoaded` - always runs.
- `clearRevalidateTimer` / `failSession` / `scheduleRevalidate` / `observeToken` are declared as hoisted
  function declarations inside ONE `useMemo` keyed on `[applyToken, tokenCache]`. The plan allowed either
  a latest-ref or a single `useMemo`; the `useMemo` was picked because it lets the mutually recursive
  `scheduleRevalidate` <-> `observeToken` pair call each other directly, keeps `react-hooks/exhaustive-deps`
  clean, and keeps every identity stable (both `applyToken` and `tokenCache` are stable, so `getToken` -
  handed to ~40 call sites - never changes).
- Rewired all four call sites exactly as specified: `getToken`, the hydration effect (`.then`/`.catch`),
  `setActive` (after `tokenCache.seed`), and `logout` (now `failSession()` + `clearLoginAttempts()` +
  a discarded `consumeReturnTo`).
- Added the unmount cleanup `useEffect(() => () => clearRevalidateTimer(), [clearRevalidateTimer])`.
- New local `SessionRecoveryPanel` with the plan's hardcoded pt-BR strings, styled after `NoRolePage.tsx`.
- `HubProtected` rewritten: `useLocation`/`useNavigate`, `restoredRef`, a restore effect, a login effect
  that captures before it navigates, and the terminal recovery panel.

### `apps/web/src/auth/__tests__/react.test.tsx` (extended; all five existing tests untouched and green)

Setup: `sessionStorage.clear()` and a `probeRenders` reset in `beforeEach`; `vi.useRealTimers()` before
`vi.restoreAllMocks()` in `afterEach`.
Added `LocationProbe`, `TokenProbe`, `renderProtected`, `profileText`, `locationText`, `advance`.
Added the four oracles plus the PERF test named in the plan.
`Probe` now counts commits in a dep-less `useEffect` rather than in its render body (see "Deviations").

### NEW `apps/web/src/auth/__tests__/session-recovery.test.ts`

29 tests, node environment, hand-rolled `Map`-backed `StorageLike` passed explicitly, plus a
`throwingStorage` whose three methods all throw. Covers the full accept/reject table for
`sanitizeReturnTo`, the capture/consume round trip, and the login-attempt guard.

## Red evidence

### Step 1 - the module does not exist

```
 FAIL  src/auth/__tests__/react.test.tsx [ src/auth/__tests__/react.test.tsx ]
Error: Failed to resolve import "../session-recovery" from "src/auth/__tests__/react.test.tsx". Does the file exist?
 FAIL  src/auth/__tests__/session-recovery.test.ts [ src/auth/__tests__/session-recovery.test.ts ]
Error: Cannot find module '../session-recovery' imported from '.../src/auth/__tests__/session-recovery.test.ts'

 Test Files  2 failed | 3 passed (5)
      Tests  21 passed (21)
```

### Step 2 - `session-recovery.ts` written, `react.tsx` still untouched

This is the meaningful red: the pure module passes (27 tests), and all six new behavioural tests fail
against the *existing* provider, each for the defect it is meant to pin.

```
 ✓ src/auth/__tests__/session-recovery.test.ts (27 tests) 4ms
 ❯ src/auth/__tests__/react.test.tsx (11 tests | 6 failed) 38ms
   ✓ AppAuthProvider token cache wiring > hydrates the provider through the token cache instead of the SDK client
   ✓ AppAuthProvider token cache wiring > seeds the workspace-switch token before exposing the switched profile
   ✓ AppAuthProvider token cache wiring > clears browser token state before SDK logout
   ✓ AppAuthProvider token cache wiring > does not restore authentication when a workspace switch resolves after logout begins
   ✓ AppAuthProvider token cache wiring > keeps the newest requested workspace authoritative when switches resolve out of order
   × session preservation and route restore > keeps the signed-in session when a refresh resolves null once
     -> expected "spy" to not be called at all, but actually been called 1 times
   × session preservation and route restore > captures and restores the pre-login route across a genuine re-login
     -> SESSION_REVALIDATE_DELAYS_MS is not iterable
   × session preservation and route restore > discards the hostile stored return path "https://evil.example/" instead of navigating to it
     -> expected 'https://evil.example/' to be null
   × session preservation and route restore > discards the hostile stored return path "//evil.example/x" instead of navigating to it
     -> expected '//evil.example/x' to be null
   × session preservation and route restore > stops re-logging in and offers a manual retry after repeated failures
     -> expected "spy" to not be called at all, but actually been called 1 times
   × session preservation and route restore > does not re-render auth consumers when a refresh returns the same token
     -> expected 4 to be 2 // Object.is equality

 Test Files  1 failed | 4 passed (5)
      Tests  6 failed | 53 passed (59)
```

Why each failure is the right failure:

- **ORACLE 1** - `mocks.client.login` was called once. That is defect B end to end: one `null` token read
  ran `applyToken(null)`, `isSignedIn` flipped to `false`, and `HubProtected` immediately navigated the
  operator out of `/cadastros/produtos`.
- **ORACLE 2** - `SESSION_REVALIDATE_DELAYS_MS` did not exist, so there was no ladder to drive.
- **ORACLE 3** (both hostile values) - the seeded key was still in `sessionStorage` after a signed-in
  mount, because nothing consumed it: no restore path existed at all.
- **GUARD** - `login()` fired even with the attempt counter already at `MAX_LOGIN_ATTEMPTS`. No loop cap
  existed.
- **PERF** - 4 consumer commits instead of 2: each of the two token reads built a fresh profile object and
  a fresh workspaces array and re-rendered every auth consumer.

### Step 3 - re-confirmed red after the lint-driven test rewrite

Counting commits in an effect instead of in the render body could in principle have weakened the PERF
oracle, and deriving `loginBlocked` instead of storing it could have weakened the GUARD oracle, so both
were re-proven against a temporarily neutered implementation (`if (false && lastAppliedToken.current ===
token)` and `const loginBlocked = false`), then the file was restored from a byte-for-byte backup:

```
   × session preservation and route restore > stops re-logging in and offers a manual retry after repeated failures
     -> expected 'signed-out:' to contain 'Não foi possível restabelecer sua ses…'
   × session preservation and route restore > does not re-render auth consumers when a refresh returns the same token
     -> expected 4 to be 2 // Object.is equality
      Tests  2 failed | 9 passed (11)
```

## Green evidence

```
### pnpm --filter @fxl-sales/web test

 Test Files  44 passed (44)
      Tests  470 passed (470)
   Start at  12:50:01
   Duration  4.43s (transform 1.63s, setup 0ms, collect 32.93s, tests 7.28s, environment 9.74s, prepare 2.49s)


### pnpm --filter @fxl-sales/web lint

> @fxl-sales/web@1.0.0 lint /Users/cauetpinciara/Documents/fxl/projects/06--PRODUCT--fxl-sales/apps/web
> eslint src/

(exit 0)

### pnpm run type-check
packages/shared-types type-check$ tsc --noEmit
packages/shared-utils type-check$ tsc --noEmit
packages/shared-types type-check: Done
packages/shared-utils type-check: Done
apps/web type-check$ tsc --noEmit
apps/api type-check$ tsc --noEmit
apps/api type-check: Done
apps/web type-check: Done
```

The five pre-existing `apps/web/src/auth/__tests__/react.test.tsx` tests were not modified and are green.
Total web tests went 468 -> 470 (11 new behavioural + 29 new unit, minus none removed; the suite count
reflects the two new files' totals against the previous run).

## How the open-redirect guard works

`sanitizeReturnTo(value, origin)` is the single mediator, applied on write **and** on read; the read side
is the security-critical one and the write side is defence in depth. A value is honoured only if all seven
hold, and the function returns the NORMALIZED `${url.pathname}${url.search}` rather than the input:

1. a non-empty string of at most 2048 characters;
2. no ASCII control character and no whitespace (`hasUnsafeReturnToChars`: a `\s` test plus a code-point
   scan for `< 0x20` and `0x7f`);
3. the first character is `/`, so every absolute URL is rejected - including a same-origin one, because
   "only ever a same-origin relative path" is far easier to keep true than "an absolute URL that happens
   to match";
4. the second character is neither `/` nor `\`, which kills `//evil.example/x` and `/\evil.example`
   (browsers normalize the backslash to a slash);
5. `new URL(value, origin)` parses and `url.origin === origin` - the backstop behind the character checks,
   because `URL` normalizes backslashes and percent-encodings that could otherwise slip past them;
6. `url.pathname` is neither `/auth` nor under `/auth/` - those are Vite-proxied to the API BFF and
   restoring one would bounce the operator straight back into the login flow;
7. the normalized result is not `/`, the default landing route, so there is nothing to restore.

The hash is dropped rather than treated as a rejection (`'/produtos#frag'` -> `'/produtos'`); no app route
uses it, and dropping it removes an injection class for free.

**Consume exactly once.** `consumeReturnTo` reads the raw value, calls `removeItem`, and only then
sanitizes. A hostile value is therefore destroyed on the same read that rejects it, and a throw anywhere
downstream cannot replay the restore. `HubProtected` additionally latches `restoredRef` before it calls
`consumeReturnTo`, so a React 18 StrictMode double effect invocation cannot restore twice.

Proven at both levels: exhaustively in `session-recovery.test.ts` (the accept/reject table plus a
"hostile value written directly into storage is removed by the failed consume" case) and behaviourally in
`react.test.tsx` ORACLE 3, which asserts the router location never leaves `/`, that `container.textContent`
never contains `evil.example`, and that the key was consumed.

## How the loop guard works

Two independent bounds, on two different axes.

**The wall-clock bound (session teardown).** A `null` observed while a token is held never touches the
profile; it schedules one re-read over `SESSION_REVALIDATE_DELAYS_MS = [500, 1500, 4000]`. While a timer
is pending further nulls are no-ops, so ~40 concurrent readers produce ONE ladder rather than 40. Any
attempt that yields a token resets the ladder. The fourth consecutive null - roughly 6 seconds of
continuous failure - exhausts it and `failSession()` applies `null` for real. So the half-authenticated
window is hard-bounded by construction, not by hoping something calls `getToken()` again; an idle user
cannot be stranded. The timer is cleared on unmount and inside `logout` (which also clears
`hasSessionRef`), so a late resolution cannot resurrect a profile after an explicit sign-out.

**The attempt bound (redirect loop).** The FRAME S1 replica mismatch can loop at full speed: sign out,
`login()`, callback lands on a replica that has the session, the first refresh lands on one that does not,
sign out again. `registerLoginAttempt()` records `{count, firstAt}` in `sessionStorage`; up to 3 attempts
inside 60s are allowed, and the 4th returns `false` **without incrementing**, so the counter cannot run
away. `HubProtected` then refuses to navigate and renders `SessionRecoveryPanel` - a terminal but not dead
end, with a `Tentar novamente` button that calls `clearLoginAttempts()` and forces a re-read, which flips
`loginBlocked` back to `false` and re-arms the login effect (no direct `login()` call).

The guard cannot fire in normal operation: every successfully observed token calls `clearLoginAttempts()`
inside `observeToken`, so a normal re-login (attempt 1 -> callback -> token) leaves the counter at zero.
A storage that throws makes `registerLoginAttempt` fail OPEN, because refusing to log a user in over a
blocked `sessionStorage` would be a worse bug than the loop it prevents.

## Deviations from the plan

Three, all forced by `pnpm --filter @fxl-sales/web lint`, which this repo runs at `error` and which
contains zero existing `react-hooks` disable comments (I did not want to introduce the first one).

1. **`loginBlocked` is derived, not React state.** The plan's `const [loginBlocked, setLoginBlocked] =
   useState(false)` with `setLoginBlocked(true)` inside the login effect trips the new
   `react-hooks/set-state-in-effect` rule. Instead `HubProtected` computes
   `const loginBlocked = isLoaded && !isSignedIn && isLoginBlocked();` and I added a pure
   `isLoginBlocked(now?, storage?)` to `session-recovery.ts` - the read-only mirror of
   `registerLoginAttempt`'s refusal condition, sharing `readLoginAttempts` and the same two conditions.
   A `useReducer` tick (`recheckLoginGuard`) forces the re-read after the manual retry, which is the only
   thing that can change the guard's answer while the component stays mounted.
   This is arguably better than the plan: the panel is now derived from the stored counter rather than
   mirrored into a React boolean that could drift from it. A new unit test asserts the two functions agree
   at every step (`expect(registerLoginAttempt(now, storage)).toBe(!blocked)` across the whole ladder),
   so the pair cannot drift. The login effect still calls `registerLoginAttempt()` and still bails on
   `false`, so the write path and the cap are unchanged.
   The plan's stated rationale ("clearing `loginBlocked` re-arms the login effect, so the retry button
   needs no direct `login()` call") holds verbatim.
2. **The PERF probe counts commits in an effect, not in the render body.** `probeRenders += 1` during
   render is `react-hooks/globals` ("Reassigning this value during render is a form of side effect...
   consider updating it in an effect"). A dep-less `useEffect` is a faithful proxy - React only re-runs a
   component's effects when that component re-rendered - and the oracle was re-proven red in that shape
   (step 3 above, 4 vs 2).
3. **`vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })` rather than a bare
   `vi.useFakeTimers()`.** The ladder is the only thing in this file that schedules a timer, and leaving
   React's scheduler and `Date` on real implementations keeps `act` deterministic and keeps the
   `registerLoginAttempt` window honest. `vi.useRealTimers()` still runs in `afterEach` as the plan
   requires.

One further small implementation choice inside the plan's own latitude: the mutually recursive
`scheduleRevalidate`/`observeToken` pair is implemented as hoisted function declarations inside a single
`useMemo` (the plan explicitly offered this or a latest-ref, "pick one").

## Residual finding for the orchestrator (NOT fixed here)

`logout()` calls `consumeReturnTo(currentOrigin())` to discard the stored path, with the plan's rationale
"a deliberate logout must not bounce the next login back into the previous operator's screen". That clear
is effectively inert in the mounted case, and the reason is pre-existing behaviour this slice did not
touch:

`HubClient.logout()` is a plain `fetch` to `${bffBase}/auth/logout` (verified in the SDK's `dist/client.js`)
- it does NOT navigate. `logout` applies `null` synchronously before awaiting that fetch, so React commits
`isSignedIn: false` and `HubProtected`'s login effect runs immediately: it re-captures the same
`currentPath` and calls `login()`. Both halves of that (the immediate re-login on sign-out, and therefore
the re-capture) exist identically on `master` today; the current code's `applyToken(null)` inside `logout`
already drove `HubProtected` straight into `login()`.

So `logout`'s `consumeReturnTo` is real defence in depth (it covers a logout raised from outside a mounted
`Protected` tree, and any path where the browser leaves before the effect runs) but it does not by itself
achieve the stated goal while `Protected` is mounted. Fixing it properly needs a "signing out" state on
the provider that suppresses the next capture and the automatic re-login - a behaviour change with no
oracle in this plan, and outside this slice's brief. Flagging rather than inventing.

## Process notes

- No commit, no branch/merge/rebase/push. Nothing outside `apps/web/src/auth/**` was touched
  (`git status`: `M apps/web/src/auth/__tests__/react.test.tsx`, `M apps/web/src/auth/react.tsx`,
  `?? apps/web/src/auth/__tests__/session-recovery.test.ts`, `?? apps/web/src/auth/session-recovery.ts`;
  the untracked `.vscode/` predates this session).
- `apps/api/**`, `apps/web/src/lib/**` (including slice 02's `require-token.ts`), `sales-ops/**`,
  `admin/**`, `finder/**` and `CLAUDE.md` are untouched. Slice 02's ESLint ban on
  `(await getToken()) ?? ...` is unaffected: this slice adds no such call site, and the ~6 second null
  window the ladder opens is exactly the window slice 02's `AuthTokenUnavailableError` is there to surface.
- Every command was a single run-once invocation (`vitest run`); no watcher, dev server or background
  process was started, so none was left running.

---

# REPAIR PASS - 2026-08-03 (post-audit)

Triggered by the independent audit `nexo/runs/batch-20260803-auth-session/verify-03-report.md`, verdict
FAIL.
Two blocking items were repaired: the open redirect (audit point 2) and the ladder counter reset
(audit's Mutation 8, promoted to blocking by the coordinator).
Both audit gaps around timers and the login counter were closed as well.
Scope stayed inside `apps/web/src/auth/**`; nothing was committed.

## 1. Open redirect - `sanitizeReturnTo` validated the raw input and returned the normalized one

`apps/web/src/auth/session-recovery.ts` checked `value[0]` and `value[1]` on the RAW string, checked
`url.origin` on the PARSED url, and then returned `` `${url.pathname}${url.search}` `` - a third value
that nothing re-validated.
Dot-segment normalization manufactures a prefix the raw input never had: for `/..//evil.example` the raw
second character is `.`, so both character checks pass, and `new URL()` resolves same-origin, so the
origin check passes, yet `url.pathname` is `//evil.example` because `/..` pops nothing at the root.

The fix re-asserts the invariant on the value actually being returned:

```ts
  const normalized = `${url.pathname}${url.search}`;
  // The invariant is on the RETURNED string, so re-assert it on the value being
  // returned rather than trusting the raw check above to still describe it.
  if (normalized[0] !== '/') return null;
  if (normalized[1] === '/' || normalized[1] === '\\') return null;
  return normalized === '/' ? null : normalized;
```

The module docstring gained a new numbered step 7 explaining why the same check has to run twice, so the
next reader does not delete it as redundant.

### Tests

`apps/web/src/auth/__tests__/session-recovery.test.ts`: the accepted and rejected tables were hoisted to
module scope as `ACCEPTED_RETURN_TO` / `REJECTED_RETURN_TO`, all seven confirmed escapes were added to
the rejection table, `/a/../cadastros -> /cadastros` and `/cadastros/produtos?kind=service` were added as
positive controls, and a new invariant test runs the WHOLE corpus (rejections included) and asserts that
any non-null result resolves same-origin under `new URL(result, ORIGIN)` and matches `/^\/[^/\\]/`.
The enumerated list catches the seven inputs someone thought of; the invariant catches the class.

## 2. Ladder counter reset - `revalidateAttempts.current = 0`

The code was already correct; nothing asserted it.
New test `resets the ladder after each recovery, so unrelated blips never accumulate` in
`apps/web/src/auth/__tests__/react.test.tsx` drives `SESSION_REVALIDATE_DELAYS_MS.length + 1` transient
nulls that each RECOVER, so the counter is driven past the ladder length in total while never failing
twice in a row.
It asserts the profile after every blip, that `login()` is never called, that the route is unchanged, and
that `tokenCache.getToken` was called `1 + blips * 2` times, so a blip that never ran a ladder read
cannot pass vacuously.

## 3. Timer hygiene - post-unmount leak (audit point 4)

Fixed, since a setState on a dead root is a real defect.
`HubAuthProvider` gained a `mountedRef`; `observeToken` returns immediately when it is false, so a
refresh that resolves after unmount is neither applied nor rescheduled.
The ref is re-armed in the cleanup effect's BODY, not only at `useRef(true)`, so a StrictMode
mount-unmount-mount cannot leave the provider permanently marked as unmounted.

## 4. Non-vacuity - real output

### Before the fix (new tests written, no source change yet)

```
 ❯ src/auth/__tests__/session-recovery.test.ts (39 tests | 8 failed) 8ms
 ❯ src/auth/__tests__/react.test.tsx (14 tests | 1 failed) 45ms
 FAIL  src/auth/__tests__/react.test.tsx > ... > schedules nothing after unmount, ...
AssertionError: expected "spy" to be called 3 times, but got 4 times
 FAIL  src/auth/__tests__/session-recovery.test.ts > sanitizeReturnTo > rejects "/..//evil.example"
 FAIL  src/auth/__tests__/session-recovery.test.ts > sanitizeReturnTo > rejects "/./\\evil.example"
 FAIL  src/auth/__tests__/session-recovery.test.ts > sanitizeReturnTo > rejects "/..\\\\evil.example"
 FAIL  src/auth/__tests__/session-recovery.test.ts > sanitizeReturnTo > rejects "/../\\evil.example"
 FAIL  src/auth/__tests__/session-recovery.test.ts > sanitizeReturnTo > rejects "/.//evil.example"
 FAIL  src/auth/__tests__/session-recovery.test.ts > sanitizeReturnTo > rejects "/a/../..//evil.example"
AssertionError: expected '//evil.example' to be null
 FAIL  src/auth/__tests__/session-recovery.test.ts > sanitizeReturnTo > rejects "/..//user@evil.example/"
AssertionError: expected '//user@evil.example/' to be null
 FAIL  src/auth/__tests__/session-recovery.test.ts > sanitizeReturnTo > never returns a value that resolves off-origin
AssertionError: expected { value: '/..//evil.example', ...(1) } to deeply equal { value: '/..//evil.example', ...(1) }
-   "origin": "https://app.example",
+   "origin": "https://evil.example",
      Tests  9 failed | 44 passed (53)
```

All seven escapes RED, the invariant test RED, and the post-unmount test RED at exactly the audit's
measured symptom (4 refreshes instead of 3).

### After the fix

```
 ✓ src/auth/__tests__/session-recovery.test.ts (39 tests) 4ms
 ✓ src/auth/__tests__/react.test.tsx (14 tests) 37ms
 Test Files  2 passed (2)
      Tests  53 passed (53)
```

### Mutation - delete `revalidateAttempts.current = 0` from `observeToken`'s recovery branch

```
 FAIL  src/auth/__tests__/react.test.tsx > session preservation and route restore >
       resets the ladder after each recovery, so unrelated blips never accumulate
AssertionError: expected { blip: 3, profile: 'signed-out:' } to deeply equal { blip: 3, profile: 'signed-in:Alpha' }
-   "profile": "signed-in:Alpha",
+   "profile": "signed-out:",
      Tests  1 failed | 73 passed (74)
```

RED on the FOURTH blip, signing the operator out mid-session - the reported symptom, reproduced exactly.
Restored from a byte-for-byte backup (`shasum 17294809630100b74b451f48b059a62dce69ff36`), re-run:
`Test Files 5 passed (5) / Tests 74 passed (74)`.

### Mutation - delete `clearLoginAttempts()` from the success branch (audit Mutation 7)

```
 FAIL  src/auth/__tests__/react.test.tsx > ... > clears the login attempt counter once a token is observed
AssertionError: expected '{"count":2,"firstAt":1785773284169}' to be null
      Tests  1 failed | 73 passed (74)
```

Previously green under this mutation; now RED.

### Mutation - delete `clearRevalidateTimer()` from the unmount cleanup (audit Mutation 6)

```
 FAIL  src/auth/__tests__/react.test.tsx > ... > clears a still-pending ladder timer at unmount
AssertionError: expected 1 to be +0 // Object.is equality
      Tests  1 failed | 74 passed (75)
```

Previously green under this mutation; now RED.
All four audit-identified oracle gaps are closed and every one was proven non-vacuous by mutation.

## 5. Commands - real output, each run exactly once

### `pnpm --filter @fxl-sales/web test`

```
 Test Files  44 passed (44)
      Tests  484 passed (484)
   Start at  13:08:42
   Duration  4.65s (transform 2.02s, setup 0ms, collect 33.51s, tests 7.10s, environment 10.73s, prepare 3.44s)
```

484 tests, up from the audit's 470: 6 new `sanitizeReturnTo` rejections, 1 new positive control,
1 new invariant test, 4 new `react.test.tsx` tests, plus the reshaped table entries.

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
apps/api type-check$ tsc --noEmit
apps/web type-check$ tsc --noEmit
apps/api type-check: Done
apps/web type-check: Done
```

## 6. Process notes for the repair pass

- No commit, branch switch, merge, rebase or push.
- `git status` is unchanged in shape from the audit's: `M apps/web/src/auth/__tests__/react.test.tsx`,
  `M apps/web/src/auth/react.tsx`, `?? apps/web/src/auth/__tests__/session-recovery.test.ts`,
  `?? apps/web/src/auth/session-recovery.ts`, plus the pre-existing `.vscode/` and the `nexo/runs/` records.
- Every mutation was restored from a byte-for-byte backup and verified by `shasum` before moving on.
- Every vitest invocation was `vitest run`. No watcher, dev server or background process was started, so
  none needed killing.
- Audit recommendation 3's second half is done (the post-unmount drop) and both of its oracles now exist.
  Nothing else from the audit's non-blocking list was left open.
