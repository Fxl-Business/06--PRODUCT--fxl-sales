# v2.7.2 - stop losing unsaved work when a session ends

Tag: `v2.7.2` at `d1f3959`
Cut: 2026-08-10
Flow: `/nexo-ship-prod-ready --auto`
Chain: `master == staging == production == d1f3959`

Three `fix:` commits, no features, **no database migration and no `apps/api` source change at all**. This release is web-only, which is what made promoting it straight through safe: rolling back to `v2.7.1` is a pure code revert with no schema entanglement, unlike `v2.7.1` itself.

## What shipped

### Losing a session no longer destroys unsaved work

Reported by the operator: leaving a tab open for a few minutes and returning reloaded the whole page and lost an in-progress form.

`HubProtected` called `login()` the instant `isSignedIn` went false, and `login()` is `client.login()`, a full `window.location.assign` to the Hub. The document was destroyed. `captureReturnTo` restores the ROUTE and has never restored form state.

Now a LIVE loss renders `SignedOutPanel` in a `fixed inset-0` overlay with `children` still mounted underneath, and waits for the operator. It is the only branch in that component that does not replace the subtree, which is exactly the mechanism by which the form survives. COLD entry, where nothing is on screen yet, still redirects exactly as before - that was the slice's must-not-break, since breaking it means nobody can sign in at all.

### The token is renewed before it expires

Nothing renewed the access token proactively; it was refreshed lazily, only when something read it. Measured on production before the fix: an idle authenticated tab made ZERO requests over ten minutes. So a long-open tab drifted past expiry and took the failure path the moment the operator came back.

Now it renews at `exp - 60s` while the document is visible, and immediately on becoming visible before any query refetch can race it. Nothing is scheduled while hidden. The 60s lead is deliberately longer than the cache's 30s skew, because a renewal driven through `getToken()` would answer from memory and issue no request at all.

### `Sair` then `Entrar` signs in on the first click

### The workspace switcher renders for the first time ever

The Hub mints each workspace entry keyed `workspaceId`; `readWorkspaces` read `workspace.id` and dropped the entry, so the list was always empty and the switcher in `UserControls` (which renders only above one workspace) had never appeared in production. The fixtures used `id`, written against our own web type rather than the wire shape, so they confirmed the bug instead of catching it.

## Gate 2 failed the first attempt, on two real defects

Worth recording, because both were found by an independent verifier and neither would have been caught by the suite as written:

1. **`Sair` then `Entrar` needed two clicks** and showed `Sua sessão expirou` to someone who had deliberately signed out, with the protected subtree re-mounting under the overlay. A regression against `master`. Root cause: `logout()` reached `failSession()` while a token string was still held, so `sessionLost` became true for a deliberate sign-out. Fixed at the cause with `setSessionLost(false)` inside `logout()` - `sessionLost` means "the session went away WITHOUT the operator asking", and `logout()` is the one place that knows the difference. All three symptoms fall out at once with no one-render flash.
2. **A mutation left the whole suite green.** `scheduleRenewal`'s re-arm guard is called on every observed token, roughly 40 times per screen. Deleting it leaked one live timer per read - measured 1 unmutated versus 6 after five reads and 9 after three visibility events - and all 661 tests stayed green. The code was correct; the oracle was missing. Now pinned by a count asserted after each individual event, so the first leak names the event that caused it.

Both fixes are mutation-proven: deleting either turns exactly one test red.

## Release-verify

Full suite (663 tests), integration (169), lint, type-check, build, plus a clean-clone deploy simulation running the literal `vercel.json` build command.

The check that mattered most, given `v2.7.0` passed everything and then took production down on a deployment-topology blind spot: **the new proactive renewal does not construct its own request.** `token.ts` extracted the network half into one `requestRefresh()`, and `renew()` is literally that same function, resolving to the same closure `getToken()` uses. `refresh.ts` is untouched, the added web lines contain no `fetch`/`credentials`/`headers`/`new URL`, and `apps/api/` has zero changes so the CSRF origin shim is unchanged. Only WHEN the refresh fires changed, not WHAT it is. A timer cannot alter `Origin`, credential mode or cookie attachment.

## Confirmed in production

New bundle `index-BBrPAEYT.js` serving, `/tatico/dashboard` loaded signed-in with live data, two auth/api requests on boot as expected.

## Version note

Mechanically `v2.7.2` is correct: three `fix:`, no `feat:`, no breaking footer. The release-verifier's judgement, recorded rather than overridden: **patch understates it**, because two operator-visible things ship - the app no longer auto-redirects on session loss, and the workspace switcher appears in production for the first time. Named explicitly here for that reason.

## Open, filed in `nexo/ROADMAP.md`

- **A pre-existing logout race.** A token read still in flight when the operator clicks `Sair` resolves transient, schedules a ladder rung about 500ms after `failSession()` cleared everything, and if it obtains a token before `client.logout()` lands server-side it clears the durable logout intent and re-mounts the subtree. Reproduced byte-identically against `master`, so this release did not introduce it. Same shared-machine exposure `SignedOutPanel` exists to close. The narrow fix is a logout generation counter checked in `observeToken`, mirroring `operationGeneration` in `setActive`.
- A failed renewal discards a token with ~60s of life left, so a blip can surface the overlay up to a minute early. A large net win against destroying the form, but not free.
- Data hooks keep failing behind the overlay. Bounded and invisible today; load-bearing if a wizard ever resets its state on a query error.
- The CSRF allowlist is still a single origin (`CORS_ORIGIN`); a preview deployment or second web host would need it widened.
- The remaining `feature-20260810-auth-boot-states` slices (01 boot indicator, 02 `403` permanent, 03 terminal states with the workspace switcher) are planned and committed but NOT built.

## Not verified

No real-browser exercise of `Sair` / `Entrar` or of the overlay over a live wizard. There is no staging web deployment - Vercel builds the web app from `production` only - so the browser check happened after the production promotion rather than before it. The oracles behind this release are ones happy-dom observes faithfully (spy call counts, component presence, fake-timer counts), not the activation-behaviour class `CLAUDE.md` warns about.
