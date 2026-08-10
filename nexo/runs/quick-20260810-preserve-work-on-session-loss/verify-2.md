# VERDICT: PASS

Branch `fix/preserve-work-on-session-loss`, head `6046e4f` (over `3872d27`, `f752bb7`, `1ecc0a4`), baseline `master`.
This is a re-verify of the FAIL recorded in `verify.md` against `3872d27`.

Both blocking defects are genuinely fixed, and both are now proven by mutation.

- **F1** is fixed at the source, by `setSessionLost(false)` inside `logout()`.
  One click on `Entrar` after an explicit `Sair` inside a live tab now signs in, the live-loss copy is never rendered, and the protected subtree never mounts while signed out.
  Deleting the fix turns exactly one test red.
- **F2** now has a genuine oracle.
  `arms exactly one renewal however many times the token is read` asserts a timer COUNT that stays at one across five token reads and three visibility transitions, and it goes red on the first extra timer from either path.

Nothing the previous report passed was sacrificed to get there.
All five of its regression mutations still behave, and the ladder mutation is still the exactly-one-red it was.

One pre-existing defect was found during the adversarial pass and reproduced byte-identically on `master`.
It does not block this slice; it is written up as finding 5.3 for the roadmap.

---

## Command results

All four run-once, never a watcher.

| Command | Exit | Result |
| --- | --- | --- |
| `pnpm run type-check` | 0 | PASS - shared-types, shared-utils, api, web all clean |
| `pnpm run lint` | 0 | PASS - api and web eslint clean |
| `pnpm test` | 0 | PASS - 49 files, 663 tests, plus `build-contract: ok` |
| `pnpm run build` | 0 | PASS - built in 1.67s |

The auth file alone is 52 tests, up from 50 at `3872d27`: the two new tests are the F1 and F2 oracles.
No failures to report.
`pnpm test` was re-run at the end, after every mutation and probe had been reverted, and was still 663/663.

---

## Mutation results

| # | Mutation | Expected | Observed | Reverted |
| --- | --- | --- | --- | --- |
| M1 | Delete `setSessionLost(false);` from `logout()` - the F1 fix | the new in-tab logout test red | **exactly 1 red**: `signs in on the first Entrar click after a Sair inside a live tab`, `expected "spy" to be called 1 times, but got 0 times` | yes |
| M1b | M1 plus deleting the live-loss login-effect guard, to unmask the F1 test's later assertions | copy assertion red | **red at the copy assertion**: `expected 'signed-out://Sua sessão expirou…' not to contain 'Sua sessão expirou'` | yes |
| M2 | Delete `scheduleRenewal`'s two-line re-arm guard - the F2 subject | the new renewal-count test red | **exactly 1 red**: `arms exactly one renewal however many times the token is read`, `expected 2 to be 1` at line 1246, the FIRST extra token read | yes |
| M2b | Leave the guard in place but let `handleVisibilityChange` arm its own timer, so only the visibility path leaks | same test red, at the visibility loop | **exactly 1 red**, `expected 2 to be 1` at line **1252**, inside the `fireVisibilityChange` loop | yes |
| M3 | Swap `apps/web/src/auth/react.tsx` for the `master` version | bug oracle red | **13 red**, including `does not navigate to the Hub when a session is lost while the app is signed in` and the new F2 test | yes |
| M4 | Delete `if (sessionLost && !signInRequested.current) return;` from the login effect | live-loss oracle red | **6 red**, oracle among them | yes |
| M5 | Make the discriminator treat a cold entry as a live loss (`lastAppliedToken.current !== null`) | cold-entry test red | **6 red**, including `still redirects to the Hub when the app is opened with no session` and `redirects on a cold entry whose very first read is a transient ladder exhaustion` | yes |
| M6 | Delete `revalidateAttempts.current = 0` from the recovery branch | ladder reset test red, and only that | **exactly 1 red**: `resets the ladder after each recovery` | yes |

M2b is the mutation the previous report could not run, because the oracle did not exist.
It is the one that settles the second half of the F2 question: the count is not merely asserted after the visibility loop, it is asserted INSIDE it, so a leak from that path alone is caught with the same precision as a leak from a token read.

`git diff --stat` was checked after every mutation and every probe.
The working tree is byte-identical to the state at the start of this run.

---

## Findings

### 1. F1 is actually fixed, measured

The oracle is `apps/web/src/auth/__tests__/react.test.tsx:1546`, `signs in on the first Entrar click after a Sair inside a live tab`.
It drives exactly the in-document sequence the previous report broke on: mount signed in at `/cadastros/produtos?f=1`, click the real `Sair` button by its `aria-label`, then click `Entrar` ONCE by its visible label.

It then asserts all three consequences the one cause had:

- `expect(mocks.client.login).toHaveBeenCalledTimes(1)` - one click, one sign-in.
- `expect(container.textContent).not.toContain('Sua sessão expirou')` - the live-loss copy is never rendered at any point in the sequence.
- `expect(locationText(container)).toBeUndefined()` - the INNER `LocationProbe`, which renders only inside `Protected`'s children, is absent, so the protected subtree never mounted while signed out.

This is complementary to the pre-existing `clears the intent and re-arms the login effect when the operator clicks Entrar`, which seeds `LOGOUT_INTENT_KEY` before mount and therefore only ever exercised a COLD document where `sessionLost` was false throughout.
Both survive; they cover the two sides.

M1 proves the first assertion is load-bearing: deleting `setSessionLost(false)` reproduces exactly the measured defect from the previous report, zero login calls on the first click.
M1b proves the second is load-bearing too, by removing the login-effect guard so the click gets through and only the copy is left wrong.
The third assertion is masked by the second under M1b, which is acceptable: the live-loss branch is the only branch in `HubProtected` that renders `{children}`, so the copy and the mounted subtree are one branch and cannot diverge.

The fix's placement is right.
`logout()` is the one function that knows the departure was deliberate, and the correction sits in the same synchronous block as `failSession()`, so React commits one render with the last write winning and the flag never becomes true at all.
The alternative the code comment rejects - an extra `!logoutIntent` term in each reader - really would have failed, because the `Entrar` click clears the intent one render before the login effect runs.
That is exactly the window the previous report measured.

A post-logout ladder cannot resurrect the flag: its `applyToken(null)` early-returns on the unchanged token before reaching `setSessionLost`.
Confirmed by probe P3 below, where `profileText` reads `signed-out:` and the signed-out copy is up throughout.

### 2. F1 was not fixed by breaking the live-loss path

The whole point of the slice still holds, and is still pinned from three angles.

- `does not navigate to the Hub when a session is lost while the app is signed in` passes.
  It asserts `login` was NOT called, that `Sua sessão expirou` IS rendered, and that neither `RETURN_TO_KEY` nor `LOGIN_ATTEMPTS_KEY` was written - the storage invariant that proves the login effect's body never ran, rather than evidence that a redirect merely was not observed.
- `keeps the page mounted when a session is lost` passes, reading the inner `LocationProbe` at `/cadastros/produtos?f=1` and the outer one at the same path, so both the subtree and the URL are untouched.
- `does not carry a spent sign-in request into a later loss in the same document` and `keeps offering a working sign-in after a live loss inside a blocked login window` both pass.

M1 - deleting the F1 fix - turned ONLY the F1 test red and left every one of those green.
That is the decisive measurement: the two paths are orthogonal, and the logout fix touches nothing the live-loss path depends on.
M4, deleting the live-loss guard, still turns the live-loss oracle red, so that guard is still doing its job.

`setSessionLost(false)` appears exactly once in the file, inside `logout()`, so there is no path by which a genuine loss can reach it.

### 3. F2's new oracle is genuine

Found at `react.test.tsx:1224`, `arms exactly one renewal however many times the token is read`.

It asserts a COUNT, not an event:

- `expect(vi.getTimerCount()).toBe(1)` immediately after mount.
- the same assertion INSIDE a five-iteration loop that calls the real `getToken` reader handed out by `TokenProbe`, standing in for the ~40 data hooks on one screen.
- the same assertion INSIDE a three-iteration loop firing `visibilitychange`, standing in for an operator tabbing away and back.
- `expect(mocks.cache.renew).not.toHaveBeenCalled()` - none of that renewed anything.
- and then, for non-vacuity of the count itself, `advance(120_000)` followed by `expect(mocks.cache.renew).toHaveBeenCalledTimes(1)`: the one surviving timer really is the renewal, it really fires at `exp - 60s`, and it fires once.

M2 deletes the guard's two lines and the test goes red at line 1246, the first token read, with `expected 2 to be 1`.
M2b leaks only on the visibility path and the test goes red at line 1252, inside the visibility loop.
Both halves are therefore non-vacuous, which is precisely what the task asked to confirm.

The last assertion also closes the gap the previous report identified in the count's own meaning.
Eight leaked timers armed at eight different moments would each renew in turn, so `renew` called once is what distinguishes "one timer" from "eight timers that happen to be pending".

### 4. Everything the previous report passed still passes

| Previous finding | Status | Evidence this run |
| --- | --- | --- |
| Bug oracle `does not navigate to the Hub when a session is lost while the app is signed in` | HOLDS | green at HEAD; red under M3 (master swap) and M4 |
| Cold entry still redirects | HOLDS | `still redirects to the Hub when the app is opened with no session` green at HEAD, and green under M3 - correct for a must-not-break; red under M5 |
| Discriminator mutation still turns tests red | HOLDS | M5, 6 red, including both cold-entry tests and the cold-document logout test |
| Ladder `vi.getTimerCount()` oracle still ladder-specific | HOLDS | M6 turns **exactly one** test red, `resets the ladder after each recovery`. The `mocks.cache.expiresAt.mockReturnValue(null)` pin is still in the global `beforeEach` at line 332 and restated in both `useLadderTimers()` helpers |
| Three durable-logout-intent conditions | HOLD, and the fourth is now covered | `shows the explicit sign-out state rather than the session-loss state after Sair`; `does not auto-login while the logout intent is set`; `clears the intent whenever a live token is observed`; plus the new in-tab click test |
| No timer leak | HOLDS, and is now PINNED | `clears a pending renewal at unmount`, `clears a still-pending ladder timer at unmount`, `drops a pending renewal when the tab is hidden again`, `does not renew for a tab that is not signed in`, plus the new count test. Probe P2 measured `vi.getTimerCount()` going 1 to 0 across an explicit `Sair` |
| Single flight | HOLDS | `renew joins an in-flight refresh instead of issuing a second one`; `renew` is literally `requestRefresh`, whose `if (inFlight) return inFlight` is the only coalescing point, shared by `getToken` |
| Absent or `NaN` expiry disables renewal rather than looping | HOLDS | `does not report an expiry for a token it refused to cache`, `reports the cached expiry, and null whenever nothing is cached`, `does not cache a normal refresh token without a valid JWT expiry`. `scheduleRenewal` clears and returns on `expiresAt === null`, and the `delay <= 0` return is still strictly positive |

M3 now turns 13 tests red rather than the previous run's 12.
The extra one is the new F2 test, which is the expected consequence of `master` having no renewal at all.
`still redirects to the Hub when the app is opened with no session` is still green under M3, which is the correct signature for a guard on behaviour that did not change.

### 5. Adversarial pass on the new logout path

Each case below was driven with a temporary probe block appended to `react.test.tsx` and since removed, except where noted as reasoning.

**5.1 `Sair` then `Entrar` twice rapidly. CORRECT.**
Measured: `login` called exactly **1** time across two clicks dispatched in the same `act`, one attempt registered.
The first click clears the intent and dispatches `recheckRecoveryGuards`; the login effect runs on the resulting render, spends the attempt, and calls `login()`.
The second click lands on a button that no longer exists, because the render after `login()` falls through to `!isLoaded || !isSignedIn` and shows the Skeleton.
No double navigation and no double attempt.

The residual is that if the `window.location.assign` is blocked, the operator is left on a full-screen Skeleton with no affordance until a reload.
That is byte-identical to `master`'s behaviour on the cold logout path and is not a regression; it is also the deliberate asymmetry with the LIVE-LOSS panel, which stays up after a blocked assign because `sessionLost` remains true and `signInRequested` is reset - pinned by `does not carry a spent sign-in request into a later loss in the same document`.

**5.2 `Sair` in one tab while another tab is live. CORRECT, by reasoning.**
`markLogoutIntent` writes to `sessionStorage`, which is per-tab, so tab B never sees tab A's intent - and that is right, `session-recovery.ts` argues the point explicitly.
The Hub BFF session cookie is shared, so tab B's next refresh gets a `401`, `refresh.ts` classifies it `session_expired`, `failSession()` runs with a token string still held, and tab B takes the LIVE-LOSS branch: panel up, children mounted, no navigation.
That is the right branch - from tab B's document, the session went away without anyone in that document asking - and tab B's operator can sign back in with one click.
The shared-machine concern about the mounted subtree is bounded: the session is dead server-side, every query underneath fails, and `queryClient.clear()` never ran in tab B so the stale rows behind the overlay are the same operator's.
This is a property of the live-loss branch generally, already filed as a `chore` in `nexo/ROADMAP.md` on this branch.

**5.3 `Sair` while the ladder is mid-run. PRE-EXISTING DEFECT, reproduced on `master`.**
`failSession()` clears the pending rung, so a ladder that is merely SCHEDULED is killed correctly.
The reachable case is a token read already IN FLIGHT at the moment of `Sair`.
`tokenCache.clear()` bumps the generation, so that read resolves as `TRANSIENT_TOKEN_RESULT` (verified in `token.ts:84-90`: a superseded answer with no fresh cached token becomes transient, never `session_expired`).
`observeToken` then calls `scheduleRevalidate()`, which arms a rung 500ms LATER - after `failSession()` already ran, so nothing clears it.

Measured (probe P3): one ladder timer is armed after the logout, and if that rung's `getToken()` comes back with a token, `observeToken`'s non-null branch runs `clearLogoutIntent()` and `applyToken(token)`.
The operator is signed back IN, the intent is gone, and the protected subtree re-mounts.
Measured output at HEAD:

```
P3 after Sair: signed-out: | intent: 1
P3 ladder timers scheduled after logout: 1
P3 after first rung: signed-in:Alpha
P3 intent now: null
P3 inner probe: /
```

The same probe against `git show master:apps/web/src/auth/react.tsx` produces **byte-identical** output, so this is NOT introduced by the slice and does not block it.
Reachability in production needs the ladder rung at +500ms to beat the `await client.logout()` round trip, which is the last statement in `logout()` and starts in the same tick; on a fast link the BFF session is gone well before the rung fires and the rung gets a `401`.
It is the "signed in when they asked not to be" case the task asked about, and it belongs in `nexo/ROADMAP.md`.
The narrow fix would be a logout generation checked in `observeToken`'s non-null branch, mirroring the one `setActive` already keeps in `operationGeneration`.

The slice widens the window very slightly, since a `renew()` in flight is one more kind of read that can be pending at `Sair`.
It does not create the path.

**5.4 `Sair` while a renewal timer is pending. CORRECT.**
Measured (probe P2): `vi.getTimerCount()` is 1 before the click and **0** after.
`logout()` reaches `failSession()`, which calls `clearTimers()`, which clears both the revalidate and the renewal timer, and `renewalTarget` with it.
The subsequent `visibilitychange` path is closed too: `handleVisibilityChange` returns at `typeof lastAppliedToken.current !== 'string'`, so a signed-out tab regaining focus never renews.
Pinned by `does not renew for a tab that is not signed in`.

**5.5 A token resolving late after `Sair`. CORRECT, via the real cache.**
`tokenCache.clear()` bumps the generation before any `await`, so `requestRefresh`'s `if (generation !== refreshGeneration)` branch converts the late answer to transient - it can never report `session_expired`, and it can never hand back a token, because `readFreshToken()` is null after `discardCachedToken()`.
Probe P4 confirms that WITHOUT that guard (the test harness mocks the cache and has no generation) a late token does sign the operator back in, which is exactly what the real guard exists to stop.
The workspace-switch analogue is separately pinned by `does not restore authentication when a workspace switch resolves after logout begins`.
The late answer's transient classification then feeds 5.3, which is where the residual actually lives.

Nothing found can leave the operator signed out with a dead button.

### 6. Green but concerning

- **5.3 above** is the one substantive item, and it is pre-existing.
- The F1 test's three assertions are ordered so the first failure masks the other two.
  M1b unmasks the second; the third shares a branch with it, so this is acceptable rather than a gap.
- `handleVisibilityChange` still calls `renewNow()` unconditionally when `expiresAt()` is null and a token string is held, which is one network request per tab focus for a token the cache refused to keep.
  Unchanged from the previous report, bounded by operator action, cannot loop, and still untested.
- The live-loss overlay leaves `children` mounted, so the hooks underneath keep failing on `AuthTokenUnavailableError` behind the panel.
  This branch correctly recorded it as a `chore` in `nexo/ROADMAP.md` rather than leaving it implicit.
- `CLAUDE.md` gained fourteen lines covering both parts of the slice, including the happy-dom `visibilityState` fact that made the previous run's mutation 4 informative.
  Read against the code, every claim in them is accurate.

---

## Working tree

Restored and verified after every mutation and every probe.
Final `git status --short` is identical to the state at the start of this run: `budget.json` modified, `.vscode/` and `agents/` and `verify.md` untracked, exactly as found.
`pnpm test` re-run at the end: 49 files, 663 tests, all green, `build-contract: ok`.
