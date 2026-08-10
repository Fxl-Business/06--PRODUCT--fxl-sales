# VERDICT: FAIL

Branch `fix/preserve-work-on-session-loss`, commit `3872d27`, baseline `master`.

The reported bug IS fixed and the fix is proven by mutation.
Cold entry is intact and well guarded.
The ladder oracle is NOT blunted.

Two independent defects block the pass, both introduced by this commit:

- **F1** - an explicit `Sair` followed by `Entrar` no longer signs in on the first click, and shows the wrong panel in between.
  This is a behavioural regression against `master`, reproduced and measured below.
- **F2** - the renewal scheduler's re-arm guard is load-bearing and completely unpinned.
  Deleting it leaks one timer per token read and the entire 661-test suite stays green.
  That meets the stated FAIL condition "a mutation leaves the suite green".

Neither defect is in the slice's Part A or Part B contract, which both hold.
Both are in the blast radius the commit created.

---

## Command results

All four commands were run once, never in watch mode.

| Command | Exit | Result |
| --- | --- | --- |
| `pnpm run type-check` | 0 | PASS - shared-types, shared-utils, api, web all clean |
| `pnpm run lint` | 0 | PASS - api and web eslint clean |
| `pnpm test` | 0 | PASS - 49 files, 661 tests, plus `build-contract: ok` |
| `pnpm run build` | 0 | PASS - built in 1.75s |

No failures to report from the commands themselves.

---

## Mutation results

| # | Mutation | Expected | Observed | Reverted |
| --- | --- | --- | --- | --- |
| 0 | Swap `apps/web/src/auth/react.tsx` for the `master` version | bug oracle red | **12 red**, including `does not navigate to the Hub when a session is lost while the app is signed in` | yes |
| 1 | Delete `if (sessionLost && !signInRequested.current) return;` from the login effect | live-loss oracle red | **6 red**, oracle among them | yes |
| 2 | Make the discriminator treat a cold entry as a live loss | cold-entry test red | **6 red**, including `still redirects to the Hub when the app is opened with no session` | yes |
| 3 | Delete `revalidateAttempts.current = 0` from the recovery branch | ladder reset test red | **exactly 1 red**: `resets the ladder after each recovery` | yes |
| 4 | Make `scheduleRenewal` arm a timer with no known expiry (a stray extra timer) | ladder count assertions red | **2 red**: `keeps the session and enters the ladder...`, `clears a still-pending ladder timer at unmount` | yes |
| 5 | Remove `clearRenewalTimer()` and the `renewalTarget` early return, so the renewal re-arms without clearing | some test red | **SUITE STAYS GREEN (50/50)** | yes |

Working tree was restored and verified clean (`git diff --stat HEAD` empty for both source files) after every single mutation.

### Mutation 0 detail

The exact oracle named in the plan is red on `master` and green here.
The 12 failures on `master` were the 5 `live session loss` behavioural tests, the 6 `proactive token renewal` tests, and `captures and restores the pre-login route across a genuine re-login`.
Critically, `still redirects to the Hub when the app is opened with no session` PASSES on `master` and PASSES here, which is exactly right for a must-not-break guard: it pins behaviour that did not change.

### Mutation 3 detail

The pinned reset test is still non-vacuous.
It was the ONLY test in the file to go red, which is precisely the property its own doc comment claims.

### Mutation 4 detail

This also empirically settles the question the plan raised about happy-dom.
The ladder tests really do run with `document.visibilityState === 'visible'`, so a visibility guard alone would NOT have kept them inert.
What keeps `vi.getTimerCount()` ladder-specific is the `mocks.cache.expiresAt.mockReturnValue(null)` pin in the global `beforeEach`, restated at the point of use by `useLadderTimers()`.
An extra timer makes the exact `toBe(0)` / `toBe(1)` assertions RED rather than being absorbed.
This is the correct resolution of the plan's constraint and it is documented in the test file.

---

## Cold entry path enumeration

The discriminator is `lastAppliedToken.current`, read in `applyToken` BEFORE the ref is overwritten:
`const wasSignedIn = typeof lastAppliedToken.current === 'string'; setSessionLost(token === null && wasSignedIn);`

| Path | `lastAppliedToken` at the null apply | Branch | Right? |
| --- | --- | --- | --- |
| Brand-new tab, valid session cookie | n/a, token applied | signed in, `sessionLost` false | yes |
| Brand-new tab or hard reload, no cookie, BFF `401` | `undefined` | cold, `login()` fires | yes, pinned |
| Hard reload with an expired cookie | `undefined` | cold, `login()` fires | yes, same path |
| Cold entry, Hub blip, ladder runs to exhaustion | still `undefined` | cold, `login()` fires | yes, and this is the sharp one, pinned by `redirects on a cold entry whose very first read is a transient ladder exhaustion` |
| Login callback returning to the app | fresh document, `undefined`, then a token | signed in, route restored | yes |
| Live loss after a token was applied | a string | live loss, no navigation, children stay mounted | yes, the fix |
| Explicit `Sair` | a string | `sessionLost` true, but `logoutIntent` wins in both the effect and the render | yes for the panel, **NO for the follow-on click, see F1** |
| Cold entry carrying a stale `logout_intent` from a previous session | `undefined` | logout panel, `Entrar` signs in on the FIRST click | yes, pinned at `react.test.tsx:1447` |

The key subtlety is the transient-ladder cold start.
`applyToken` is never called during the transient rungs, so `isLoaded` stays false and the ref stays `undefined`, which is what makes a slow cold failure still read as a cold entry rather than as a live loss.
That is correct and it is tested.

The last two rows are the interesting pair.
They differ only in whether the document ever held a token, which is exactly why the existing test passes while the in-document variant is broken.

---

## Findings

### 1. Does it actually fix the reported bug? YES

The oracle is `react.test.tsx:1001`, `does not navigate to the Hub when a session is lost while the app is signed in`.
It asserts `mocks.client.login` was NOT called, that the live-loss copy renders, and that neither `RETURN_TO_KEY` nor `LOGIN_ATTEMPTS_KEY` was written, which proves the login effect's body never ran at all rather than merely that a redirect was not observed.
Red on `master` (mutation 0), green here, and red again when the live-loss guard is deleted (mutation 1).

`keeps the page mounted when a session is lost` reads the INNER `LocationProbe` rendered inside `Protected`, which is a sound proxy for "React state survived" at this level, since state lives exactly as long as the component holding it.
The `liveSessionLoss` branch is the only branch in `HubProtected` that renders `{children}`, so this is structurally right.

### 2. Cold entry still redirects. INTACT

`still redirects to the Hub when the app is opened with no session` is present, passes, and asserts `login` called exactly once plus the `RETURN_TO_KEY` capture.
Mutating the discriminator so a cold entry reads as a live loss turns 6 tests red, including that one and `redirects on a cold entry whose very first read is a transient ladder exhaustion`.
The must-not-break is genuinely guarded, from more than one angle.

### 3. The ladder's `vi.getTimerCount()` oracle. NOT BLUNTED

The plan offered two options and the executor took the first, correctly and explicitly.
`mocks.cache.expiresAt` is pinned to `null` in the global `beforeEach` and restated in `useLadderTimers()`, so the renewal provably cannot arm in any ladder test.
Non-vacuity for that pin is supplied by `renews the token before it expires while the document is visible`, which asserts a finite `expiresAt` really does arm exactly one timer.
Mutation 3 proves the ladder assertions still catch a ladder regression.
Mutation 4 proves a stray extra timer is caught rather than absorbed.
The comment in the test file states the reasoning and matches what the code does.

### 4. The durable logout intent. THREE NAMED CONDITIONS HOLD, BUT SEE F1

- After `Sair` the operator sees `Você saiu da sua conta`, not the session-loss copy: pinned by `shows the explicit sign-out state rather than the session-loss state after Sair`, and it is non-vacuous because it also asserts the live-loss copy is absent.
- Not auto-logged-in: pinned by `does not auto-login while the logout intent is set` and by the storage invariant `LOGIN_ATTEMPTS_KEY === null`, which proves the effect body never ran.
- A real login clears the intent: pinned by `clears the intent whenever a live token is observed`, which reads the INNER location probe so it cannot pass while a panel is up.

**F1, the defect.**
The existing `clears the intent and re-arms the login effect when the operator clicks Entrar` seeds `LOGOUT_INTENT_KEY` in storage BEFORE mount, so it exercises a COLD document where `sessionLost` is false.
The in-document sequence is not covered, and it is broken.

Measured with a temporary probe (since removed), signing out inside a live tab and then clicking `Entrar`:

```
PROBE  login calls: 0
PROBE  shows live-loss copy: true
PROBE  shows signed-out copy: false

PROBE2 after click 1, login calls: 0
PROBE2 inner protected subtree visible: /
PROBE2 after click 2, login calls: 1
```

The same probe against `master`'s `react.tsx`:

```
PROBEM login calls: 1
```

So on `master` one click signs in.
On this branch the first click clears the intent but the login effect bails at `if (sessionLost && !signInRequested.current) return;`, because `logout()` reaches `failSession()` while `lastAppliedToken` still holds a string and therefore sets `sessionLost` to true.
With `logoutIntent` now cleared, `liveSessionLoss` becomes true and the panel swaps to `Sua sessão expirou`.
A second click sets `signInRequested` and does navigate.

Three consequences, in descending severity:

1. The primary and only button on the screen is dead on first press.
2. The copy is wrong and actively misleading.
   An operator who deliberately signed out is told `Sua sessão expirou` and `Nada do que você digitou nesta página foi perdido`.
3. The `liveSessionLoss` branch renders `{children}`, so the protected subtree is re-mounted underneath the overlay for someone who explicitly signed out.
   The inner location probe reads `/`, which proves `Protected` rendered its children.
   This is mitigated but not eliminated by `bg-background/95 backdrop-blur-sm` and by the `queryClient.clear()` that ran at logout, so what is behind the overlay is an empty shell at `/` rather than the previous operator's rows.
   It still sits against the reason `SignedOutPanel` exists, quoted in its own doc comment: on a shared machine the next person at that desk must not find an authenticated app.

The narrow cause is that `sessionLost` is never reset when the logout intent is consumed.

### 5. Renewal must not fire while hidden, and must not leak. CODE CORRECT, ONE GUARD UNTESTED

Correct and pinned:

- `scheduleRenewal` returns early via `documentIsVisible()`; pinned by `does not schedule a renewal while the document is hidden`.
- Becoming hidden clears the pending timer; pinned by `drops a pending renewal when the tab is hidden again`.
- Unmount clears both timers through `clearTimers()`; pinned by `clears a pending renewal at unmount` and `clears a still-pending ladder timer at unmount`.
- A resolution landing after unmount is dropped whole by `if (!mountedRef.current) return;` at the top of `observeToken`, so it cannot reschedule.
- Stale closure after logout: `logout()` calls `failSession()` which calls `clearTimers()`, and `handleVisibilityChange` then returns at `typeof lastAppliedToken.current !== 'string'`; pinned by `does not renew for a tab that is not signed in`.
- The renewal callback nulls both `renewalTimer.current` and `renewalTarget.current` before calling `renewNow()`, so no stale handle survives.

**F2, the gap.**
`scheduleRenewal` is called from `observeToken` on EVERY observed non-null token, which per CLAUDE.md is roughly 40 times per screen.
Its idempotency rests entirely on two lines:

```js
if (renewalTimer.current !== null && renewalTarget.current === expiresAt) return;
clearRenewalTimer();
```

Removing both is mutation 5 and the whole suite stays green: 50/50 in the auth file, and the code comment's claim that "~40 token reads per screen re-arm nothing" is asserted nowhere.
Measured with a temporary probe (since removed), mounting signed-in with a finite expiry:

| | unmutated | mutation 5 |
| --- | --- | --- |
| after mount | 1 timer | 1 timer |
| after 5 more token reads | 1 timer | 6 timers |
| after 3 more `visibilitychange` to visible | 1 timer | 9 timers |

So the guard is real, load-bearing, and would leak roughly one live timer per token read if it were ever removed or refactored away.
No test would notice.
This is a missing oracle, not a live bug.

### 6. Refresh storm. HELD

- Single flight: `renew` IS `requestRefresh`, which returns the existing `inFlight` promise when one exists.
  A renewal racing a lazy read joins it; pinned by `renew joins an in-flight refresh instead of issuing a second one`.
- Many concurrent readers: `getToken` serves from cache while fresh and otherwise joins the same `inFlight`.
- Token whose `exp` is already past: `scheduleRenewal` computes `delay = expiresAt - lead - now` and returns without arming when `delay <= 0`.
  This is the anti-loop guard, and it is the right shape: the renewal can never arm the next rung out of the answer to this one.
  The expired case is handled only by `handleVisibilityChange`, which fires once per event; pinned by `renews immediately on becoming visible with an expired token`.
- Absent or `NaN` `exp`: `readJwtExpiry` returns null, the cache calls `discardCachedToken()`, `expiresAt()` returns null, and `scheduleRenewal` clears and returns.
  The renewal is DISABLED rather than looping; pinned by `does not report an expiry for a token it refused to cache` and `reports the cached expiry, and null whenever nothing is cached`.
- The `renew` vs `getToken` split is justified and tested: `SESSION_RENEWAL_LEAD_MS` (60s) is deliberately longer than `ACCESS_TOKEN_EXPIRY_SKEW_MS` (30s), so a renewal driven through `getToken` would answer from memory and issue no request; pinned by `renew forces a refresh even while the cached token is still servable`.

Residual, benign and pre-existing: a `renew()` in flight when `logout()` runs resolves after `tokenCache.clear()` has bumped the generation, so the cache returns `TRANSIENT_TOKEN_RESULT` and `observeToken` starts a post-logout ladder of at most 4 rungs over about 6 seconds.
It cannot flip `sessionLost`, because `applyToken(null)` early-returns on the unchanged token before reaching `setSessionLost`.
The `logout()` comment already documents this and the unmount effect clears any pending rung.

### 7. No regression. CLEAN

- Refresh classification: `apps/web/src/auth/refresh.ts` is not in the diff at all, and its 15 tests pass.
- Cache flush on logout, in-page re-login and workspace switch: the `identity-scoped query cache` block, 7 tests, all pass.
  `observeToken`'s flush still keys on `wasSignedIn` read before `applyToken`, so a ladder recovery still does NOT flush.
- `workspaceId` claim read: `readWorkspaces` is untouched on this branch, that fix arrived in `b38bb95` which is already in `master`.
- The only change inside `observeToken`'s success path is the added `scheduleRenewal()` AFTER `applyToken`, which is correct for the workspace-switch case, where `seed` replaces the expiry under an unchanged-looking read.

---

## Green but concerning

- The `liveSessionLoss` branch renders `{children}` and is placed AHEAD of `loginBlocked`.
  Both choices are argued in the comments and both are right for the live-loss case, but the branch is now reachable after an explicit `Sair` via F1, which is a context nobody designed it for.
- `handleVisibilityChange` calls `renewNow()` unconditionally when `expiresAt()` is null and a token string is held.
  That is one network request per tab focus for a token the cache refused to hold.
  It is bounded by operator action and cannot loop, so it is not a storm, but it is untested and slightly surprising.
- `budget.json` was already modified in the working tree at the start of this verify, and `.vscode/` and `agents/` were already untracked.
  Left exactly as found.

## Working tree

Restored and verified after every mutation and probe.
Final `git status --short` is byte-identical to the state at the start of this run.
`react.test.tsx` and `token.test.ts` re-run clean at HEAD: 2 files, 64 tests, all passing.
