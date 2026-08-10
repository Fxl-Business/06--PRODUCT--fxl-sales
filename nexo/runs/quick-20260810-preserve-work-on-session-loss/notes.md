# 04 - Do not destroy unsaved work to re-authenticate

Branch `fix/preserve-work-on-session-loss`, off `master`.
Plan: `nexo/plans/feature-20260810-auth-boot-states/04-preserve-work-on-session-loss.md`.
Slices 02 and 03 were NOT implemented and were not needed: `SignedOutPanel` and `lastAppliedToken` already exist on `master`, and no `403`/`session_expired` split was added.

## What shipped

### A. A live session loss never navigates

`applyToken` now derives a `sessionLost` flag from `lastAppliedToken` before overwriting it: `undefined` before the first apply, `null` after a loss, a string while signed in, so a live loss is exactly "was a string, is now null".
It is pushed into state in the same batch as `setProfile`, so the pair cannot commit out of step, and it reaches `HubProtected` through the auth context.

`HubProtected`'s login effect now returns early on `sessionLost && !signInRequested.current`.
Cold entry is untouched and still redirects.
A live loss renders `SignedOutPanel` (`Sua sessão expirou`) in a `fixed inset-0 bg-background/95 backdrop-blur-sm` overlay WITH `children` still mounted underneath - the only branch in that component that does not replace the subtree, which is the whole mechanism by which the operator's form survives.

`SignedOutPanel` gained optional `title` / `description` props with the existing `Sair` copy as the defaults, so the explicit-sign-out state is byte-identical and the live-loss state gets honest copy.

Three ordering decisions, all deliberate:

- The live-loss branch sits AHEAD of `loginBlocked`, and its `Entrar` clears the attempt counter. The loop guard exists to stop AUTOMATIC re-login loops and a live loss never spends an attempt on its own, so a leftover counter must not swap in `SessionRecoveryPanel` and unmount the work this branch exists to protect. The click is the same deliberate retry `SessionRecoveryPanel`'s own button is.
- The durable logout intent still wins: `logoutIntent` is checked first and is excluded from `liveSessionLoss`, so an explicit `Sair` keeps its own copy and its own URL reset.
- `signInRequested` is a REF consumed by the login it re-arms, plus the existing `recheckRecoveryGuards` reducer (now read as `guardTick`) in the effect deps. First written as `useState` plus a reset effect; ESLint's `react-hooks/set-state-in-effect` rejected that, correctly, and the ref-plus-tick form matches how `loginBlocked` and `logoutIntent` already avoid mirroring a non-React fact into state. Consumed AFTER the `registerLoginAttempt` guard so a refusal there leaves the request intact rather than producing a dead button.

### B. Proactive renewal while visible

`SESSION_RENEWAL_LEAD_MS = 60_000` in `react.tsx`, next to the ladder delays, since both are timing policy.

`HubAccessTokenCache` gained `renew()` and `expiresAt()`.
`renew()` is required rather than optional: the lead (60s) is deliberately longer than `ACCESS_TOKEN_EXPIRY_SKEW_MS` (30s), so a renewal driven through `getToken()` would answer from memory and issue no request at all.
The network half was extracted into `requestRefresh`, shared by both, so a renewal that lands while a consumer read is in flight joins it instead of doubling traffic.
A failed renewal still discards the cached token - deliberately, because that is what makes the ladder rung a genuine retry rather than a vacuous cache hit that would silently abandon the renewal.

Scheduling rules, all pinned by tests:

- Nothing is scheduled while `document.visibilityState === 'hidden'`.
- `visibilitychange` to visible re-arms; if the token is expired, inside the window, or uncached, it renews SYNCHRONOUSLY on the event so a focus-triggered refetch cannot win the race.
- A non-positive delay never schedules. Arming the next rung out of the answer to this one is an unbounded loop for any token whose life is shorter than the lead; that case belongs to the visibility handler, which fires once per event.
- `renewalTarget` keeps ~40 token reads per screen from re-arming: one renewal per token lifetime, the same shape as the ladder's "while a timer is pending, further nulls are no-ops".

## The `vi.getTimerCount()` oracle - what I did, explicitly

**I scoped the new timer so the existing tests cannot arm it, and I made that scoping structural rather than incidental.**

The renewal arms only from a finite `tokenCache.expiresAt()`.
The global `beforeEach` pins the mocked cache's `expiresAt` to `null`, and BOTH `useLadderTimers` helpers re-state that pin at the point of use with a comment saying why.
So every `vi.getTimerCount()` assertion outside the renewal block is ladder-specific by construction: the renewal cannot arm there at all.

The oracle is not blunted, for two reasons:

1. Those assertions are EXACT counts (`toBe(0)` / `toBe(1)`), so a second timer source leaking in fails them rather than passing silently.
2. Non-vacuity is proven in the renewal block: `renews the token before it expires while the document is visible` asserts that a finite `expiresAt` really does arm exactly one timer. If the pin ever stopped meaning anything, that test would go red first.

**The plan's guess about happy-dom was wrong and I verified it rather than relying on it.**
`happy-dom@20.10.6` `Document.visibilityState` returns `visible` whenever the document has a `defaultView`, which it always does under vitest.
So the visibility guard alone would NOT have kept the existing tests inert; the `expiresAt: null` pin is what does it.
Recorded in the `useLadderTimers` comment and in CLAUDE.md so this cannot be re-derived wrongly later.

## Test-first, and the mutations run

RED first, confirmed before any implementation: 16 failures across the two files.
Test 1, `does not navigate to the Hub when a session is lost while the app is signed in`, failed on `master` with `expected "spy" to not be called at all, but actually been called 1 times` - the reported bug, exactly.

One pre-existing test was rewritten rather than kept: `captures and restores the pre-login route across a genuine re-login` asserted that an exhausted ladder calls `login()` and captures the route, which IS the behaviour this slice removes.
It now drives the same capture-and-restore through the operator's `Entrar` click, and additionally asserts that nothing was captured and no login happened before that click.
No other pre-existing test changed behaviour.

Mutations run to confirm the new oracles are not vacuous (each reverted immediately):

| Mutation | Red test |
| --- | --- |
| drop the `documentIsVisible()` guard in `scheduleRenewal` | 2 renewal tests |
| drop `scheduleRenewal()` from `observeToken`'s success branch | 4 renewal tests |
| drop `revalidateAttempts.current = 0` from the recovery branch | `resets the ladder after each recovery` (still non-vacuous) |
| drop `signInRequested.current = false` | `does not carry a spent sign-in request into a later loss` |
| drop `guardTick` from the login effect deps | 4 live-loss tests |

## Verification

- `pnpm --filter @fxl-sales/web vitest run src/auth/` - 143 passed.
- `pnpm run type-check` - clean.
- `pnpm run lint` - clean (after fixing the setState-in-effect it caught).
- `pnpm test` - 80 + 393 + 661 passed, `build-contract: ok`.
- `pnpm run build` - clean; confirmed the build really emits `bg-background\/95{background-color:hsl(var(--background) / .95)}` and `backdrop-blur-sm`, so the overlay is not a dead class.

## Not verified, honestly

No real-browser run: the task forbade starting a dev server, and the oracles here (`login()` not called, `children` still mounted, timers) are ones happy-dom observes faithfully - unlike the activation-behaviour class CLAUDE.md warns about.
The overlay's appearance over a live wizard has not been seen with human eyes.

## Follow-ups filed in `nexo/ROADMAP.md`

- The shipped fix replaced the old "losing a session destroys unsaved work" entry; the form-persistence-across-a-redirect entry stays, rewritten to say why it now rarely matters.
- New entry: the overlay leaves `children` mounted while signed out, so hooks underneath sit in an `AuthTokenUnavailableError` state behind the panel. Bounded (`retry: 1`, and `requireToken` throws before any fetch) and invisible today, but it would become load-bearing if a wizard were ever rebuilt to reset its own state on a query error.

---

# Gate 2 rework: F1 and F2

Two defects the independent Verify agent found on `3872d27`.
Both are in the blast radius the commit created rather than in its Part A or Part B contract, and both are fixed here test-first.

## F1 - an explicit `Sair` was being read as a session loss

The cause is one fact stated in one place: `logout()` calls `failSession()`, which reaches `applyToken(null)` while `lastAppliedToken` still holds a token string.
That is exactly the shape of the live-loss discriminator, so `sessionLost` became true for a departure the operator asked for.
Three consequences followed from that one cause: the `Entrar` button was dead on the first press, the panel said `Sua sessão expirou` to someone who had signed out on purpose, and the `liveSessionLoss` branch re-mounted the protected subtree under the overlay for a signed-out operator.

### The fix chosen, and why

`setSessionLost(false)` in `logout()`, immediately after `failSession()`.
`sessionLost` is defined as "the session went away WITHOUT the operator asking", and `logout()` is the one place in the codebase that knows the difference, so that is where the exclusion belongs.
React batches both writes in the same synchronous handler, so the last one wins and the flag never becomes true at all - there is no window in which anything reads it wrong.
All three consequences fall out at once: after `Sair` the state is `logoutIntent` true and `sessionLost` false, so the `Entrar` click clears the intent and the login effect's `if (sessionLost && !signInRequested.current) return;` guard passes on the very next render.

### The alternative rejected

Adding `signInRequested.current = true` to the logout panel's `onSignIn` fixes only consequence 1.
React renders before effects run, so there is still one render in which `logoutIntent` is already false and `sessionLost` is still true: the live-loss copy appears and `{children}` mounts, for one frame, for someone who deliberately signed out.
It also spreads the definition of `sessionLost` across its readers, where each one can only guess from whatever `logoutIntent` happens to say at the moment it renders.

### Cold entry re-checked against every path Verify enumerated

None changed branch.
`setSessionLost(false)` is reachable only from `logout()`, and every cold path reaches `applyToken(null)` with `lastAppliedToken.current === undefined`, which already yields `sessionLost === false`.
A post-logout ladder that exhausts later cannot resurrect the flag either: its `applyToken(null)` early-returns on the unchanged token before reaching `setSessionLost`.
The pinned cold-entry row `Cold entry carrying a stale logout_intent` still passes unchanged, which is what makes the new test a genuinely different case rather than a duplicate.

### The oracle

`signs in on the first Entrar click after a Sair inside a live tab`, in the `explicit logout intent` block.
It signs out INSIDE a live signed-in tab, which is the only way an operator actually reaches that panel; the pre-existing `clears the intent and re-arms the login effect when the operator clicks Entrar` seeds the intent in storage BEFORE mount and therefore exercises a cold document where `sessionLost` is false throughout.
Three assertions for the three consequences: `login` called exactly once, the live-loss copy absent, and the INNER `LocationProbe` absent - that probe renders only inside `Protected`'s children, so its absence is the proof the authenticated tree was not left mounted behind the overlay.

## F2 - the renewal re-arm guard had no oracle

`scheduleRenewal` runs on every observed non-null token (~40 per screen) and on every `visibilitychange` back to visible.
Its idempotency is two lines, the `renewalTarget` early return and the `clearRenewalTimer()` under it, and the code is correct - what was missing was any test that would notice if they went away.

The oracle is `arms exactly one renewal however many times the token is read`.
It mounts signed in with a finite expiry, then asserts `vi.getTimerCount()` is exactly 1 after each of 5 further token reads and after each of 3 further visibility transitions, asserts no renewal fired during any of them, and finally advances to `exp - 60s` and asserts the renewal fires exactly ONCE.
The count is asserted after each individual event rather than only at the end, so the first leaked timer names the event that leaked it.
Every other test in the renewal block passes with the guard deleted, because one renewal per token lifetime and forty of them look identical from the outside - which is why the count, and not "a renewal happened", had to be the assertion.

## Mutation evidence, all five run and all five reverted

| Mutation | Expected | Observed |
| --- | --- | --- |
| M1 - remove `setSessionLost(false)` from `logout()` | the new F1 test red | **exactly 1 red**: `signs in on the first Entrar click after a Sair inside a live tab` |
| M2 - remove the `renewalTarget` early return and the `clearRenewalTimer()` under it | the new F2 test red | **exactly 1 red**: `arms exactly one renewal however many times the token is read`, failing `expected 2 to be 1` on the FIRST extra read. Verify measured this same mutation leaving all 661 tests green |
| M3 - delete `if (sessionLost && !signInRequested.current) return;` | the bug oracle red | **6 red**, including `does not navigate to the Hub when a session is lost while the app is signed in` - unchanged from Verify's run, so the F1 fix did not blunt it |
| M4 - make the discriminator read a cold entry as a live loss | cold entry red | **6 red**, including `still redirects to the Hub when the app is opened with no session` |
| M5 - drop `revalidateAttempts.current = 0` from the recovery branch | ladder reset red | **exactly 1 red**: `resets the ladder after each recovery` - still the only one, so it is still non-vacuous |

M2 turning nothing else red also re-confirms that `vi.getTimerCount()` stays LADDER-specific elsewhere: the `expiresAt: null` pin in the global `beforeEach` is untouched, and the new test opts into a finite expiry for itself.

## Verification

- `pnpm run type-check` - clean.
- `pnpm run lint` - clean.
- `pnpm test` - 49 files, **663** tests (661 plus the two new oracles), `build-contract: ok`.
- `pnpm run build` - clean, built in 1.65s.

Working tree restored and verified after every mutation.

## Not verified, honestly

Still no real-browser run, for the same reason as the original slice: no dev server was started.
The oracles here are ones happy-dom observes faithfully - a spy call count, the presence of a component in the tree, and `vi.getTimerCount()` under faked `setTimeout`/`clearTimeout` - rather than the activation-behaviour class CLAUDE.md warns about.
