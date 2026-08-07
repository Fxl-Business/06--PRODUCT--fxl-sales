# Slice 04 - durable logout intent, working notes

## What changed

`apps/web/src/auth/session-recovery.ts`

- New `LOGOUT_INTENT_KEY` plus a module-private `LOGOUT_INTENT_VALUE = '1'` sentinel.
- New `markLogoutIntent` / `hasLogoutIntent` / `clearLogoutIntent`, all going through the existing `writeItem` / `readItem` / `dropItem` helpers with the same `StorageLike` default.
- `sanitizeReturnTo`, `captureReturnTo` and `consumeReturnTo` are byte-identical.

`apps/web/src/auth/react.tsx`

- `logout()` now opens with `markLogoutIntent()`, synchronous and before the first `await`.
  The comment above `consumeReturnTo()` was rewritten so it no longer claims an outcome the code did not produce.
- `observeToken`'s live-token branch calls `clearLogoutIntent()` beside the existing `clearLoginAttempts()`.
  This is the anti-lockout backstop.
- New `SignedOutPanel` beside `SessionRecoveryPanel`, default `Button` variant, hardcoded pt-BR.
- `HubProtected`: the reducer is renamed `recheckRecoveryGuards`, a derived `logoutIntent` sits above `loginBlocked`, a new effect reduces the URL to `/` while the intent is set, the login effect gained a `|| logoutIntent` clause checked before `registerLoginAttempt()`, and the render returns `SignedOutPanel` ahead of `SessionRecoveryPanel`.

`CLAUDE.md` gained the "Auth Model" paragraph from the plan's section 7.1, with the corrected mechanism.
`nexo/ROADMAP.md`: the inert-`consumeReturnTo` entry was deleted and replaced by the Hub-side residual (closing the tab discards the intent, and the Hub's SSO cookie may then complete a login with no prompt).

## Test evidence

RED first, confirmed by running before any source change: 19 failures across the two files.
The five new `session-recovery` cases failed on `is not a function`; all seven new `react.test.tsx` cases failed on the stated assertions - the return-to slot holding `/cadastros/produtos?f=1`, `client.login` called once, the outer location still on the old route, the intent still `'1'`.
All 15 pre-existing `react.test.tsx` tests stayed green through the harness change alone, which is what makes those failures attributable to the missing feature rather than to the harness.

Two mutations run against the finished implementation, to check the oracles are real rather than incidental:

- Deleting `clearLogoutIntent()` from `observeToken` turns exactly ONE test red, R6 (`clears the intent whenever a live token is observed`).
  So the backstop has a dedicated oracle and nothing else covers it.
- Deleting `|| logoutIntent` from the login effect's guard turns four red (R1, R2, R3, R5).

Final: `pnpm run type-check`, `pnpm run lint`, `pnpm test` (611 web tests, 48 files) and `pnpm run build` all green.
`apps/web/src/auth` alone is 94 tests, 5 files, green.

## What the plan got wrong, or left to the executor

- The N1 correction was applied as instructed.
  R1 is doc-commented as proof that the login effect's BODY never ran, via the unspent `LOGIN_ATTEMPTS_KEY`, and NOT as an ordering oracle.
  The CLAUDE.md paragraph states the invariant as "synchronous, and before the first `await` in `logout()`" and explicitly disclaims the proposta-wizard analogy.
  Confirmed empirically while checking the mutations: nothing in the suite distinguishes `markLogoutIntent()` first from `markLogoutIntent()` anywhere else above the `await`, exactly as N1 predicted.
- The plan's W5 list was extended from five values to eight (` 1`, `1 `, `01` added).
  Same decision, wider net, no behaviour change.
- Plan section 6.1 said to give `LocationProbe` an optional `testId` defaulting to `'location'` and render a second one as `outer-location`.
  Done, and the second probe sits inside `MemoryRouter` above `Protected`, so it reads the URL while a panel is up.
  `UserControls` sits under `AppAuthProvider` and OUTSIDE `MemoryRouter`; it reads no router hook, so this is legal and it keeps the `Sair` button reachable after the sign-out.
- Plan risk R6 (the workspace `Combobox` now renders in every `renderProtected` test) was checked and is a non-issue: nothing collides, and all 15 pre-existing tests in that file stayed green.

## Lockout walkthrough, re-verified against the code as written

All eight cases in plan section 4.5 hold.
The one worth restating: case 8 (a storage that accepts writes but silently refuses deletes) is not fully closed by the button, because `clearLogoutIntent` swallows the failure and the next render re-reads `'1'`.
`observeToken`'s clear cannot help there either, since no token is obtainable while the panel is up.
The real escape in that hypothetical browser is closing the tab, which is what the plan already says.
No such browser is known to exist and the fail-open read covers every browser that actually blocks storage.

## For slices 03 and 05

- Nothing added here reads `hasSessionRef`.
  `clearLogoutIntent()` is the last statement of `observeToken`'s live-token branch, immediately after `clearLoginAttempts()` and before `applyToken(token)`.
  Slice 03 can retype `observeToken(result: HubTokenResult)` and rewrite the branch condition freely; the clear just needs to stay in whichever branch means "a live token just arrived".
  It must NOT move into `applyToken` - R6 is the test that catches that.
- `logout()` now has `markLogoutIntent()` as its first statement.
  Slice 05's `queryClient.clear()` goes anywhere below it and above the `await client.logout()`.
  Do not reorder `markLogoutIntent()` below the `await`.
- `HubProtected` now has THREE effects in this order: route restore, URL reset, login.
  The reducer is `recheckRecoveryGuards` (was `recheckLoginGuard`) and has two call sites, one per panel.
- The render precedence in `HubProtected` is `logoutIntent` -> `loginBlocked` -> `Skeleton` -> children.
  Inverting the first two is caught by the existing `stops re-logging in and offers a manual retry after repeated failures`.
- `renderProtected` in `react.test.tsx` now mounts `UserControls` and a second `LocationProbe`.
  Slice 05 wraps this harness in a `QueryClientProvider`; the wrap goes outside `AppAuthProvider` per slice 05's own provider-nesting change, and none of the assertions here depend on the nesting.
- The single most likely wrong edit to this file remains an over-broad gate that suppresses the automatic login for every signed-out state rather than only after an explicit `Sair`.
  `captures and restores the pre-login route across a genuine re-login` is the test that catches it, and it is green.
