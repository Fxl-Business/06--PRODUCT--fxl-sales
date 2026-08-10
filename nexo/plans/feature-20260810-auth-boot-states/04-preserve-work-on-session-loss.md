---
id: 04-preserve-work-on-session-loss
milestone: v2.8.0
status: todo
depends_on: [02-refresh-403-permanent, 03-auth-terminal-states]
files_modified: [apps/web/src/auth/react.tsx, apps/web/src/auth/token.ts, apps/web/src/auth/__tests__/react.test.tsx, apps/web/src/auth/__tests__/token.test.ts, CLAUDE.md, nexo/ROADMAP.md]
acceptance: When a session is lost while the app is open, the operator stays on the page they were working on and is asked to sign in, rather than being navigated to the Hub; and while the tab is visible the access token is renewed before it expires, so returning to an open tab does not find it expired.
---

# 04 - Do not destroy unsaved work to re-authenticate

## The report

"If I leave the tab open for more than 3 minutes or so, when I come back the whole page is reloading, making me lose all the progress of a form I'm filling."

That is the destroyed-form failure `CLAUDE.md` already names as the reason the revalidation ladder exists: "Treating both as dead is what destroyed a half-filled form every time a refresh blipped."

## What was measured

An authenticated production tab was observed for over ten minutes, with the page's own `performance.getEntriesByType('resource')` read rather than any request being issued.

- Total requests in ten minutes: **two**, both at `t=1s` - the initial `/auth/refresh` and the initial `/api/v1/sales-ops/bootstrap`.
- The page never reloaded, never navigated, and `location.pathname` stayed `/tatico/dashboard`.
- Backgrounding the tab for three minutes and returning changed nothing.

So elapsed time alone does NOT cause the reload, and nothing in the app polls or renews in the background.
A genuine OS-level focus event could not be produced from automation (the tab reported `visibilityState: "hidden"` throughout), so the final link was established from the code rather than observed.

## Mechanism

Two facts in the source, both verified:

1. **There is no proactive refresh.** The only `setTimeout` in the auth layer is the revalidation ladder (`react.tsx:259`). The access token is cached until its JWT `exp` minus 30 seconds and is renewed ONLY when something reads it. Nothing reads it while the tab is idle, which is exactly why ten minutes produced zero requests.

2. **Losing the session triggers a full-page navigation, unconditionally.** `react.tsx:561-568`: the moment `isSignedIn` goes false the effect calls `captureReturnTo(...)` and then `login()`. `login()` is `client.login()`, which is `window.location.assign` to the Hub. The document is destroyed. `captureReturnTo` restores the ROUTE on the way back; it has never restored form state and cannot.

So the sequence is: the operator returns to the tab, the first thing to read the token (a TanStack refetch on window focus, or any click) finds the cache expired, a real `/auth/refresh` goes out, and if it fails the app navigates away from the half-filled form.

The "about 3 minutes" in the report is the Hub access-token lifetime, which is what decides when the cached token stops being usable.

## Why this got worse in v2.7.0, and why that is not the whole story

Slice 03 of the previous feature made a `401` permanent: it now calls `failSession()` on the FIRST response instead of after four ladder attempts.
That was correct in isolation - the SDK's `401` genuinely means the session is dead, and retrying it four times only delays the inevitable by six seconds.

But it removed the accidental grace period that had been absorbing this, so the redirect now fires immediately and far more reliably.

**Do not fix this by putting the `401` back on the ladder.** That would restore a six-second delay before destroying the form, which is not a fix. The defect is the navigation, not its timing.

## The fix

### A. Never navigate away from a live session loss

Split the two cases the auto-login effect currently conflates:

- **Cold entry** - the app is being opened and there is no session. Redirecting to the Hub is correct and destroys nothing, because there is nothing on screen yet. Keep today's behaviour.
- **Live loss** - the app was signed in, rendered, and the operator has been using it. Do NOT call `login()`. Render the signed-out terminal state from slice 03 IN PLACE, keeping the page mounted underneath, with an explicit control to sign in.

The discriminator is whether a token was ever applied in this document. `lastAppliedToken` (`react.tsx:153`) already carries exactly that: `undefined` before the first apply, `null` after a loss, a string while signed in. Slice 05 of the previous feature established this same ref as the substitute for the deleted `hasSessionRef`, so it is a known-good signal, and a live loss is precisely `lastAppliedToken.current === null` having previously been a string.

The operator loses nothing until they choose to sign in. When they do choose, the redirect is theirs and the loss is expected rather than inflicted.

### B. Renew before expiry while the tab is visible

Schedule a renewal at `exp - 60s` whenever a token is applied and the document is visible, and re-arm on `visibilitychange` to visible.
Then an open tab holds a valid token continuously and the return-from-idle path stops being a failure path at all.

Constraints the executor must honour:

- Do NOT schedule while `document.visibilityState === 'hidden'`. A hidden tab is throttled, the renewal would be late and useless, and it would hold a session alive for a tab nobody is looking at.
- On becoming visible, renew IMMEDIATELY if the token is expired or within the window, BEFORE any query refetch can read it. Otherwise the refetch races the renewal and the failure path is reached anyway.
- This adds a second timer source to `react.tsx`, and `vi.getTimerCount()` is the ladder's existing oracle at `react.test.tsx:542-549`. Those assertions will break or silently weaken. Either scope the new timer so the existing tests never arm it (they render with a hidden document by default in happy-dom - verify this) or convert those assertions to a ladder-specific count. State which, and do not leave the ladder oracle blunted.

### C. Out of scope, deliberately

Persisting form state across a redirect is NOT in this slice. It is a much larger change touching every wizard, and it is unnecessary once the app stops navigating away without being asked. Note it in the ROADMAP instead.

## RED tests, written FIRST

In `apps/web/src/auth/__tests__/react.test.tsx`:

1. `does not navigate to the Hub when a session is lost while the app is signed in` - mount signed in, drive the token to a permanent failure, assert `mocks.client.login` was NOT called and the signed-out state is rendered. This is the oracle for the reported bug and must fail on `master`.
2. `still redirects to the Hub when the app is opened with no session` - the cold-entry path must be unchanged; `mocks.client.login` IS called. Guards against fixing 1 by disabling login entirely.
3. `keeps the page mounted when a session is lost` - assert a child rendered inside `Protected` is still in the document after the loss, which is what "the form survives" means at this level.
4. `renews the token before it expires while the document is visible` - advance to just inside the renewal window, assert a refresh was requested without any consumer reading the token.
5. `does not schedule a renewal while the document is hidden`.
6. `renews immediately on becoming visible with an expired token` - and does so before a simulated query read.
7. The existing `resets the ladder after each recovery` must stay green and stay non-vacuous.

## Verification

```
pnpm --filter @fxl-sales/web vitest run src/auth/__tests__/react.test.tsx
pnpm --filter @fxl-sales/web vitest run src/auth/__tests__/token.test.ts
pnpm run type-check && pnpm run lint && pnpm test && pnpm run build
```

Run-once only, never a bare watching `vitest`.

## Risks

- **The cold-entry path is the one that must not regress.** Breaking it means nobody can ever log in, which is worse than the bug being fixed. Test 2 exists for that and should be treated as the slice's must-not-break.
- The new timer interacts with the ladder's `vi.getTimerCount()` oracle, as above. Handle it explicitly rather than letting the oracle quietly stop meaning anything.
- Holding a session alive while a tab is open is a deliberate behaviour change: an abandoned open tab now keeps its session fresh instead of drifting into expiry. That is what the operator wants, and the 90-day absolute ceiling from `v2.7.0` still bounds it.
