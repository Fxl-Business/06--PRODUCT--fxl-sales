---
id: feature-20260810-auth-boot-states
milestone: v2.8.0
flow: feature
mode: autopilot
trunk: master
---

# Auth boot states

## Frame

### What

Replace the auth boot experience, which is currently a blank screen followed by one undifferentiated failure panel, with a visible authenticating indicator and distinct, actionable terminal states.

Three things:

1. **An authenticating indicator.** `HubProtected` renders `<Skeleton className="h-screen w-full" />` at `apps/web/src/auth/react.tsx:596` while `!isLoaded || !isSignedIn`. That renders as a blank page for as long as session resolution takes - about 6 seconds on the normal ladder, and roughly a minute when a redirect loop is involved. The operator is given no signal that anything is happening.
2. **A `403` becomes permanent and explanatory.** `apps/web/src/auth/refresh.ts` classifies on status alone: `401` is `session_expired`, everything else including `403` is `transient`. So a `403` is retried four times and lands on the generic recovery panel.
3. **Distinct terminal states**, replacing the single `Nao foi possivel restabelecer sua sessao` for every non-transient outcome:
   - not signed in
   - signed in, but this account is not entitled to the product
   - signed in, but the ACTIVE workspace is not entitled - listing the operator's other workspaces so they can switch

### Why

On 2026-08-10 a misconfiguration took production down and it was diagnosed with `curl`, not from the screen, because the UI could not distinguish a CSRF refusal from a dead session. See `nexo/milestones/v2.7.1/SUMMARY.md`.

The user reported it directly: a blank screen for about a minute, then a panel saying the session could not be restored, while holding `admin`, `Vendedor` and `Finder` on `sales.core`. Every one of those words was wrong for their situation.

### Decisions already made, do not re-litigate

- **The workspace switcher ALWAYS asks. It never auto-switches**, not even when exactly one other workspace qualifies. Silently moving an operator into a different tenant is the same class of surprise as the cross-tenant cache leak `v2.7.0` just fixed, and on a shared machine it could open an org they did not intend. Decided by the user.
- **The `403` reclassification is IN scope** for this feature, and lands together with the screens rather than before them. On its own it would only change which generic panel appears. Decided by the user.

### Added after the frame: losing a session must not destroy unsaved work

Reported after `v2.7.1` shipped: leaving a tab open for a few minutes and returning reloads the whole page and loses an in-progress form.
Measured over ten minutes on production - the app makes ZERO requests while idle and never reloads on its own, so elapsed time is not the trigger.
The cause is that `HubProtected` calls `login()` the instant `isSignedIn` goes false, and `login()` is a full `window.location.assign` to the Hub.
`captureReturnTo` restores the route; nothing restores the form.

Slice 04 covers it. Criterion 8 below is added for it.

### Acceptance criteria (feature level)

1. While a session is being resolved, the operator sees a visible indicator that authentication is in progress, not a blank page.
2. A `403` from `/auth/refresh` is treated as permanent: no revalidation timer is scheduled, and it surfaces its own explanatory state.
3. A `503` or `502` still preserves the session and still retries on the unchanged `SESSION_REVALIDATE_DELAYS_MS` ladder, and the ladder's consecutive-failure counter still resets on every recovery.
4. An operator who is not signed in sees a state that says so and offers to sign in.
5. An operator whose ACTIVE workspace lacks the product sees a state that says so and lists their other workspaces; choosing one switches to it. Nothing switches without an explicit choice.
6. An operator whose ACCOUNT is not entitled anywhere sees a state that says so and does not see a workspace list implying a way in that does not exist.
7. Losing a session while the app is open and in use keeps the operator on their page and asks them to sign in, instead of navigating to the Hub. Opening the app with no session still redirects as before.
8. While the tab is visible the access token is renewed before it expires, so returning to a long-open tab does not find it expired.
9. `pnpm run lint`, `pnpm run type-check`, `pnpm test` and `pnpm run build` are green.

### Scope limits (YAGNI)

- No change to the revalidation ladder itself, its delays, or its reset. Only which outcomes enter it.
- No change to `sanitizeReturnTo`, the login-attempt loop guard, or the durable logout intent beyond what the new states require.
- No change to the query-key factory. Workspace-scoped keys remain a separate ROADMAP item.
- No new backend endpoint. Everything needed should come from the Hub token claims the app already parses (`profileFromToken` already reads `claims.workspaces`, and `UserControls` already renders a workspace `Combobox`).
- Copy is pt-BR, matching the existing `Sair` / `Entrar` / `Buscar workspace...` convention in that file.

### Must not break

- The `403`-is-permanent change must not make a genuinely transient failure permanent. A `503`, a `502` and a network throw all stay on the ladder.
- The anti-redirect-loop guard and `SessionRecoveryPanel` must still exist for the case they were built for: repeated transient failure.
- The durable logout intent must still suppress auto-login after an explicit `Sair`.
- No raw account or workspace id in user-facing copy; use `orgLabel` / `userLabel` per `CLAUDE.md`.

## Delivery

Trunk `master`, milestone `v2.8.0`, serial execution. All three slices touch `apps/web/src/auth/**`, so no wave is conflict-free and serial is the honest choice rather than a degrade.

## Slice index

| # | Slice | depends_on |
|---|---|---|
| 01 | `01-auth-boot-indicator` | - |
| 02 | `02-refresh-403-permanent` | - |
| 03 | `03-auth-terminal-states` | 01, 02 |
| 04 | `04-preserve-work-on-session-loss` | 02, 03 |
