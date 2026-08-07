---
id: 04-durable-logout-intent
milestone: v2.6.0
status: todo
depends_on: []
files_modified:
  - apps/web/src/auth/session-recovery.ts
  - apps/web/src/auth/react.tsx
  - apps/web/src/auth/__tests__/session-recovery.test.ts
  - apps/web/src/auth/__tests__/react.test.tsx
  - CLAUDE.md
  - nexo/ROADMAP.md
acceptance: "after an explicit Sair the stored return-to slot is empty, the login-attempt counter is unspent and the URL is back at `/`; all three survive a remount; no automatic login fires while the durable logout intent is set; and the intent is cleared both by the panel's `Entrar` button and by any live token `observeToken` ever sees, so the tab can never be locked out"
---

# 04 - Durable logout intent

Web only.
No file under `apps/api/**` is touched by this slice, and nothing in it depends on the SDK bump, which is why `depends_on` is empty.

## 1. Context, verified against the code rather than taken on faith

### 1.1 The measured bug

`nexo/ROADMAP.md` carries this entry:

> `logout()`'s `consumeReturnTo` call in `apps/web/src/auth/react.tsx` is inert, and the comment above it claims the opposite. `HubClient.logout()` is a plain fetch that does not navigate, so `applyToken(null)` immediately drives `HubProtected`'s login effect, which re-captures the path it just cleared. Measured after a deliberate Sair from `/cadastros/produtos?f=1`: the slot holds that path again.

Re-read at plan time and confirmed line by line.

`logout()` (`apps/web/src/auth/react.tsx:263-274`) runs, in this order:

```ts
operationGeneration.current += 1;
tokenCache.clear();
failSession();              // -> applyToken(null) -> setProfile({isSignedIn: false, ...})
clearLoginAttempts();
consumeReturnTo(currentOrigin());
await client.logout();
```

`failSession()` calls `applyToken(null)`, which calls `setProfile`.
The click on `button[aria-label="Sair"]` is a discrete event, so React 18 flushes that state update synchronously: `HubProtected` re-renders and its effects run **before** `await client.logout()` is ever reached.

`HubProtected`'s login effect (`react.tsx:379-388`) then sees `isLoaded && !isSignedIn && !loginBlocked`, and does exactly three things:

```ts
if (!registerLoginAttempt()) return;
captureReturnTo(currentPath, currentOrigin());
login();
```

So a deliberate `Sair` spends a login attempt, re-captures the very route the logout was about to clear, and redirects the browser to the Hub.
The `consumeReturnTo` two lines further down then clears a slot that the login effect has already refilled, or refills after it clears - either way the net effect is that the previous operator's route is stored, and the comment above the call is false.

### 1.2 Why an in-memory flag is not the fix

The Hub's guidance, which we accept: a React ref or a piece of provider state would be destroyed by the first full-page navigation or reload.
`client.login()` IS a full-page navigation, and the operator can also just press F5 on the signed-out screen.
The intent has to outlive both, so it has to be durable in the browser.

### 1.3 What this slice does NOT touch

- `sanitizeReturnTo` and its re-assertion on the normalized value are not weakened, not reordered, and not called from anywhere new.
  The only new caller of anything in `session-recovery.ts` is the intent itself, which stores no path.
- `registerLoginAttempt` / `isLoginBlocked` / `clearLoginAttempts` keep their exact semantics, their window, and their fail-open behaviour.
  They are only GATED: the login effect returns before reaching `registerLoginAttempt` while the intent is set, so the counter is not spent.
- The query cache (slice 05) and the refresh classification (slice 03) are untouched.

## 2. Design decisions, resolved

### 2.1 Where the intent lives: `sessionStorage`, behind the same testable accessors

**Chosen.** A third key in `apps/web/src/auth/session-recovery.ts`, written and read through the module's existing `writeItem` / `readItem` / `dropItem` helpers with a `StorageLike` parameter defaulting to `defaultStorage()`.

This follows the rationale the module header already documents, and every clause of it holds for this fact too:

- **It survives the navigation.** That is the whole requirement of section 1.2.
- **It is scoped to the tab.** See 2.2.
- **It dies with the tab.** A logout intent is a statement about the CURRENT browsing session and must not outlive it. This is the decisive clause against `localStorage`.
- **It is never sent to the server.** The intent is a client-side UI decision; a cookie would put it on every request to the API and the BFF for no consumer.
- **Nothing stored is a token, a claim or an id.** The value is the literal `'1'`. CLAUDE.md's "browser Hub access tokens are memory-only" is untouched.

Rejected: `localStorage`.
It survives the tab's death, so a logout intent written on Monday would still be sitting there on Friday in a brand new tab, suppressing the automatic login for a session that has nothing to do with it.
That is a lockout vector (section 4) bought for no benefit, because the server-side session is already dead for every tab - see 2.2.

Rejected: a cookie.
Same durability as `localStorage` plus it travels to the server, where nothing reads it.

Rejected: the URL fragment.
The login and callback redirects are both server-controlled, so nothing written into the URL survives the trip. The module header already records this.

**The value is an exact sentinel, not "any truthy string".**
`hasLogoutIntent` returns `stored === LOGOUT_INTENT_VALUE`.
An exact match means a stray, corrupt or hand-set value cannot put the tab into a state where no automatic login fires, which is the lockout direction. Pinned by a test.

**Failure mode is fail-open, deliberately and symmetrically with `registerLoginAttempt`.**
A storage that throws makes `readItem` return `null`, so `hasLogoutIntent()` is `false` and the app behaves exactly as it does today.
A storage that throws on write makes `markLogoutIntent()` a silent no-op, so the same.
Refusing to log a user in because their browser blocks storage would be a worse bug than the one this slice fixes; `registerLoginAttempt` already documents that trade in those words.

### 2.2 Tab scoping: correct here, and the gap it leaves is already covered

`sessionStorage` is per tab, so an intent written in tab A is invisible to tab B.
That is right, and the reason is that tab B does not need it.

`logout()` awaits `client.logout()`, which destroys the Hub BFF session server-side.
The session cookie is shared by every tab on the origin, so tab B's next `/auth/refresh` gets a `401` and tab B signs out through the ordinary path.
The intent is not what signs other tabs out; the dead session is.

What the intent exists for is narrower and strictly same-tab: it suppresses THIS tab's synchronous re-capture-and-redirect, described in 1.1, which is a race inside one React tree.
And the threat model in the `## Why` of the overview is a second person at the same physical machine and the same tab, which is exactly the scope `sessionStorage` gives.

One residual, stated so it is not discovered later: if the operator closes the tab and opens a new one, the intent is gone.
The new tab cold-starts, `/auth/refresh` answers `401` because the session really was destroyed, and the app redirects to the Hub - where the Hub's own SSO cookie may sign the operator straight back in without a prompt.
That is a Hub-side property, not something this slice can reach from the browser, and it is filed in `nexo/ROADMAP.md` by section 7.2 rather than left implicit.

### 2.3 What the intent gates: no auto-login, and an explicit signed-out screen

**Recommendation, adopted: the app shows an explicit signed-out screen with an `Entrar` button instead of auto-bouncing to the Hub.**

Justification, and this is a security argument rather than a UX one.
Automatic re-login after an EXPLICIT `Sair` is wrong on a shared machine regardless of the route leak.
The operator presses `Sair` and walks away; the tab immediately navigates to the Hub; the Hub may complete the login from its own SSO cookie with no prompt; the next person at that desk finds an authenticated app.
The operator did the one thing the product offers to end their session and it was undone within a second, without their seeing it.
An explicit screen makes the next sign-in a deliberate act by whoever is actually sitting there.

It also gives the intent exactly one well-defined clearing point in the UI (section 4), which is what makes the lockout argument short enough to be checkable.

`SessionRecoveryPanel` is the shape precedent, and the new panel is deliberately its twin: same layout classes, same hardcoded pt-BR (`src/i18n/**` is outside this slice's boundary, as that component already records), one heading, one line of body copy, one button.

Gated, concretely:

1. **The login effect does not run at all.** Its guard returns before `registerLoginAttempt()`, so no attempt is spent, `captureReturnTo` never fires, and `login()` never fires. The unspent counter is also the test oracle in section 6.
2. **The URL is reset to `/`.** See 2.4.
3. **The render returns `SignedOutPanel`,** taking precedence over `SessionRecoveryPanel` and over the `Skeleton`.

Deliberately NOT gated: the route-restore effect (`react.tsx:369-377`).
It only runs when `isSignedIn`, and after a logout the slot is empty and stays empty, so gating it would add a condition with no reachable effect.
Leave it byte-identical.

### 2.4 The URL is reset to `/` while the intent is set

Without this, the intent alone is not enough.
`HubProtected` renders the panel, so the previous operator's SCREEN is hidden, but `location` is untouched, so the URL bar still reads `/cadastros/produtos?f=1` for the next person to see.
Worse, the moment the intent is cleared by `Entrar`, the login effect re-arms with `currentPath` still pointing at that route and captures it - reintroducing the exact leak from a new direction.

So `HubProtected` gains one effect that reduces the URL to `/` while the intent is set:

```ts
/**
 * An explicit `Sair` must not leave the previous operator's route in the URL bar,
 * and must not leave it sitting in `location` for the login effect to capture the
 * instant the intent is cleared. Reducing it to `/` here makes both structural
 * rather than dependent on the order two state updates happen to batch in:
 * `sanitizeReturnTo('/', origin)` is `null`, so by the time a capture is possible
 * there is nothing left to capture. `replace` so Back cannot walk into it either.
 */
useEffect(() => {
  if (!logoutIntent || currentPath === '/') return;
  navigate('/', { replace: true });
}, [currentPath, logoutIntent, navigate]);
```

Note the ordering-independence, which is the point: the alternative of clearing the intent and navigating in the same click handler and relying on React batching both into one commit would be a security property resting on a batching claim.
This is the same reasoning CLAUDE.md applies to the wizard's submit button, applied prophylactically.

`/` is itself a `Protected` route (`apps/web/src/router.tsx:72-81`), so the navigation remounts a `Protected` that reads the same intent and renders the same panel. There is no flash of anything else.

### 2.5 Not a React state mirror

`logoutIntent` is DERIVED at render time from the stored value, exactly as `loginBlocked` is:

```ts
const logoutIntent = isLoaded && !isSignedIn && hasLogoutIntent();
```

A `useState` mirror would be a second source of truth for one fact, which is the pattern the existing `loginBlocked` comment already rejects in this same component.

Both writers are covered without any subscription:

- `logout()` writes the intent and, in the same synchronous block, flips `isSignedIn`. That flip re-renders `HubProtected`, and the render reads the fresh value. This is precisely why the write must come FIRST (section 3.2).
- The `Entrar` click clears the intent and dispatches the existing `useReducer` tick, which forces the re-read. This is the mechanism `SessionRecoveryPanel`'s retry already uses; the reducer is renamed from `recheckLoginGuard` to `recheckRecoveryGuards` because it now serves both panels.

There is no third writer, so there is no writer whose effect could go unobserved.

## 3. The code

### 3.1 `apps/web/src/auth/session-recovery.ts`

Add, after the `LOGIN_ATTEMPTS_KEY` / `MAX_LOGIN_ATTEMPTS` block of constants:

```ts
export const LOGOUT_INTENT_KEY = 'fxl-sales.auth.logoutIntent';
/**
 * An EXACT sentinel, not "any truthy string". A corrupt, stale or hand-set value must
 * read as "no intent", because the intent's whole job is to suppress the automatic
 * login - so an over-broad match is a lockout, while an over-narrow one is only a
 * return to today's behaviour.
 */
const LOGOUT_INTENT_VALUE = '1';
```

Add, at the end of the file, after `clearLoginAttempts`:

```ts
/**
 * The durable logout intent: "someone pressed `Sair` in this tab".
 *
 * It has to be durable and not a React ref, because `client.login()` is a full-page
 * navigation and the operator can also just reload: an in-memory flag is destroyed by
 * both. It has to be per-tab and to die with the tab, which is what makes
 * `sessionStorage` right and `localStorage` wrong - a week-old intent from a closed
 * tab suppressing a fresh login is a lockout bought for nothing, and the server-side
 * session is destroyed by `client.logout()` anyway, so other tabs sign out on their
 * own next refresh rather than needing to read this.
 *
 * It stores no path, no token and no id, so it changes nothing about what this module
 * is allowed to hold.
 */
export function markLogoutIntent(storage: StorageLike | null = defaultStorage()): void {
  writeItem(storage, LOGOUT_INTENT_KEY, LOGOUT_INTENT_VALUE);
}

/**
 * Fails OPEN, the same direction and for the same reason as `registerLoginAttempt`:
 * an unreadable storage is an empty storage, so a browser that blocks storage gets
 * today's behaviour rather than a screen it can never leave.
 */
export function hasLogoutIntent(storage: StorageLike | null = defaultStorage()): boolean {
  return readItem(storage, LOGOUT_INTENT_KEY) === LOGOUT_INTENT_VALUE;
}

export function clearLogoutIntent(storage: StorageLike | null = defaultStorage()): void {
  dropItem(storage, LOGOUT_INTENT_KEY);
}
```

Nothing else in this file changes.
In particular `sanitizeReturnTo` is not touched, and neither are `captureReturnTo` and `consumeReturnTo`.

### 3.2 `apps/web/src/auth/react.tsx` - `logout()`, and the statement order

Import `clearLogoutIntent`, `hasLogoutIntent` and `markLogoutIntent` alongside the existing four names from `./session-recovery`.

```ts
const logout = useCallback(async () => {
  /*
    Synchronous, and BEFORE THE FIRST `await` in this function. Written first as the
    defensive position: it is the only placement that stays correct if an `await` is
    ever inserted above it.

    React 18 flushes a discrete event's state update when this handler returns, so
    `HubProtected` re-renders and its effects run BEFORE the `await` at the bottom
    resolves. Without a durable intent, `consumeReturnTo()` clears the slot and the
    login effect then refills it with the exact path this logout is clearing, spends
    a login attempt, and redirects to the Hub. That is the measured bug in
    `nexo/ROADMAP.md`.

    Note it is NOT an ordering bug within this synchronous block - React cannot
    re-render mid-function, so the statements below all complete before any flush.
    Do not describe this as the proposta wizard's submit-button race; that one is a
    genuine intra-click phase race and this is not.
  */
  markLogoutIntent();
  operationGeneration.current += 1;
  tokenCache.clear();
  // Kills any in-flight ladder, so a late resolution cannot resurrect a profile
  // after an explicit sign-out.
  failSession();
  clearLoginAttempts();
  /*
    No longer inert. `markLogoutIntent()` above is what stops `HubProtected`'s login
    effect refilling the slot on the synchronous re-render, so this really does leave
    it empty. The comment that used to sit here claimed that outcome without the
    intent that produces it.
  */
  consumeReturnTo(currentOrigin());
  await client.logout();
}, [client, failSession, tokenCache]);
```

The dependency array is unchanged; the three new functions are module imports, not values.

If slice 05 has already landed, its `queryClient.clear()` sits where slice 05 put it and `markLogoutIntent()` still goes above everything.
Slice 05's own rule is "synchronous and before the first `await`", which this satisfies.

### 3.3 `apps/web/src/auth/react.tsx` - the clearing point in `observeToken`

Inside the non-null branch of `observeToken`, immediately beside the existing `clearLoginAttempts()`:

```ts
// A token in hand is proof the session is live, so any intent still sitting in
// storage is stale by definition. This is the BACKSTOP that makes a lockout
// impossible: the intent can only ever persist while no token is obtainable, and
// the instant one is, it is gone - via the callback round trip, via a workspace
// switch, via a ladder recovery, via anything at all. It sits next to
// `clearLoginAttempts()` because it is the same argument about the same event.
clearLogoutIntent();
```

**This is the only load-bearing composition point with slice 03, and it is semantic, not textual.**
Slice 03 retypes `observeToken` to take a `HubTokenResult` and changes the branch condition from `token !== null` to `result.token !== null`.
It deletes `hasSessionRef` entirely.
Neither matters here: the clear goes in whichever branch means "a live token just arrived", and that branch exists in both shapes.
Do NOT build the clearing condition on `hasSessionRef` - it will not exist.

Do not put the clear in `applyToken` instead.
`applyToken` returns early when the token is unchanged (`react.tsx:177`), so a clear behind that guard would be skipped whenever a re-login happened to yield a byte-identical token.
This is the same trap slice 05 records for its own flush.

### 3.4 `apps/web/src/auth/react.tsx` - the panel

Add beside `SessionRecoveryPanel`:

```tsx
/**
 * The terminal state of an EXPLICIT `Sair`. Deliberately not an automatic redirect to
 * the Hub: on a shared machine, auto-re-login undoes the one action the product offers
 * for ending a session, and the Hub's own SSO cookie can complete it with no prompt at
 * all, so the next person at that desk finds an authenticated app. Signing back in has
 * to be a deliberate act by whoever is actually sitting there.
 *
 * Strings are hardcoded pt-BR to match the rest of this file; `src/i18n/**` is outside
 * this slice's boundary, exactly as `SessionRecoveryPanel` records.
 */
function SignedOutPanel({ onSignIn }: { onSignIn: () => void }) {
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-2xl font-semibold">Você saiu da sua conta</h1>
      <p className="max-w-md text-muted-foreground">
        Sua sessão foi encerrada neste navegador. Entre novamente para continuar.
      </p>
      <Button onClick={onSignIn}>Entrar</Button>
    </div>
  );
}
```

Default `Button` variant, not `variant="outline"`.
`SessionRecoveryPanel`'s retry is the secondary action under an error message; this is the single primary action on the screen.

### 3.5 `apps/web/src/auth/react.tsx` - `HubProtected`

Four edits.

**a. The reducer is renamed**, because it now re-arms two panels:

```ts
// The only things that can change either guard's answer while this component stays
// mounted are the two panel buttons, so they are the only things that force a re-read.
const [, recheckRecoveryGuards] = useReducer((ticks: number) => ticks + 1, 0);
```

Update the one existing call site inside `SessionRecoveryPanel`'s `onRetry`.

**b. The derived guard**, next to `loginBlocked` and above it:

```ts
/**
 * Derived from storage on every render, never mirrored into React state, for the
 * same reason `loginBlocked` is. Both writers re-render this component anyway:
 * `logout()` flips `isSignedIn` in the same synchronous block as the write, and the
 * `Entrar` click dispatches `recheckRecoveryGuards`.
 */
const logoutIntent = isLoaded && !isSignedIn && hasLogoutIntent();
const loginBlocked = isLoaded && !isSignedIn && isLoginBlocked();
```

**c. The URL reset effect** from section 2.4, placed after the existing restore effect and before the login effect.

**d. The login effect gains one clause**, and nothing else about it changes:

```ts
useEffect(() => {
  if (!isLoaded || isSignedIn || loginBlocked || logoutIntent) return;
  // Belt and braces: the render guard above already refuses, and `registerLoginAttempt`
  // refuses again here without incrementing, so the counter cannot run away.
  if (!registerLoginAttempt()) return;
  // CLAUDE.md, "Sales Ops Routing": the URL is the single source of truth for the
  // active workspace and page, so restoring the URL restores the screen.
  captureReturnTo(currentPath, currentOrigin());
  login();
}, [currentPath, isLoaded, isSignedIn, login, loginBlocked, logoutIntent]);
```

Note the placement of `logoutIntent` in the guard: it is checked BEFORE `registerLoginAttempt()`, so an explicit sign-out spends no attempt budget.
That is what makes "the counter is still unspent" a usable test oracle for "the effect body never ran".

**e. The render precedence**, with `logoutIntent` first:

```tsx
if (logoutIntent) {
  return (
    <SignedOutPanel
      onSignIn={() => {
        // Clearing the intent re-arms the login effect on the next render, exactly as
        // `SessionRecoveryPanel`'s retry re-arms it by clearing the counter. No direct
        // `login()` call: one path into `login()` is what keeps `captureReturnTo` and
        // `registerLoginAttempt` on that path too. By now the URL reset effect has
        // already reduced `currentPath` to `/`, and `sanitizeReturnTo('/')` is `null`,
        // so the capture that follows stores nothing.
        clearLogoutIntent();
        recheckRecoveryGuards();
      }}
    />
  );
}

if (loginBlocked) {
  return <SessionRecoveryPanel onRetry={...} />;  // unchanged
}

if (!isLoaded || !isSignedIn) {
  return <Skeleton className="h-screen w-full" />;
}
```

`logoutIntent` takes precedence over `loginBlocked` deliberately.
`SessionRecoveryPanel` says "Tentamos entrar novamente algumas vezes", which would be a lie after an explicit sign-out, since no automatic attempt was made at all.
In practice the two are almost never both true, because `logout()` calls `clearLoginAttempts()`, but the ordering must not depend on that.

## 4. Full lifecycle walkthrough, and the proof that nobody can be locked out

### 4.1 Set

Operator at `/cadastros/produtos?f=1`, signed in, clicks `Sair`.

1. `markLogoutIntent()` writes `fxl-sales.auth.logoutIntent = '1'`.
2. `tokenCache.clear()` bumps the cache generation and discards the cached token, so any refresh already in flight resolves through the superseded branch and yields `readFreshToken()`, which is now `null`. No token can come back from it.
3. `failSession()` -> `applyToken(null)` -> `setProfile({isSignedIn: false, ...})`, flushed synchronously.
4. `HubProtected` re-renders. `logoutIntent` reads `true`. The login effect's guard returns immediately: no attempt spent, no capture, no redirect.
5. The URL reset effect fires: `navigate('/', {replace: true})`.
6. `SignedOutPanel` renders.
7. `clearLoginAttempts()` and `consumeReturnTo(...)` run; the slot is empty and nothing has refilled it.
8. `await client.logout()` destroys the BFF session server-side.

### 4.2 Honoured on mount

Operator reloads, or the tab is restored, with the intent still in `sessionStorage`.

`isLoaded` is `false`, so `HubProtected` renders the `Skeleton`.
The mount read of `/auth/refresh` answers `401` (the session was destroyed), the profile goes signed-out, `logoutIntent` reads `true`, the login effect refuses, the URL reset effect reduces whatever path was reloaded to `/`, and `SignedOutPanel` renders.

This is the case an in-memory flag could not cover, and it is why the intent is durable.

### 4.3 Honoured on the recovery path

The intent gates the login effect, which is the only automatic caller of `login()` in the app.
`SessionRecoveryPanel` cannot be reached while the intent is set, because of the render precedence in 3.5e.
So while the intent is set there is no path from the app to the Hub that the operator did not click.

### 4.4 Cleared - two independent points

**Point 1, the deliberate one: the `Entrar` button.** `clearLogoutIntent()` then `recheckRecoveryGuards()`.
The next render has `logoutIntent === false`, `isSignedIn === false`, `loginBlocked === false` (logout cleared the counter), so the login effect runs: `registerLoginAttempt()` returns `true` from a fresh budget, `captureReturnTo('/')` stores nothing because `sanitizeReturnTo` rejects `/`, and `login()` navigates to the Hub.

**Point 2, the backstop: `observeToken`'s live-token branch.** Any token at all clears the intent.

### 4.5 Proof that the user cannot be locked out

The failure being ruled out is "the intent is set and can never be removed, so no login is possible".

By cases over every way the intent can be set and left set:

1. **Normal sign-out, operator clicks `Entrar`.** Point 1 clears it, then the Hub round trip returns with a token and point 2 clears it again. Two independent clears on one path. `sessionStorage` survives the same-tab navigation to the Hub and back - that is exactly why the return-to slot lives there - so the button's clear is the one that matters, and point 2 is the redundancy.
2. **Normal sign-out, operator reloads instead of clicking.** 4.2: the panel renders again with the button on it. One click away, not locked out.
3. **The tab is closed and reopened.** `sessionStorage` dies with the tab, so the intent is gone and the app cold-starts normally.
4. **The key is corrupt, stale, or hand-set to something else.** `hasLogoutIntent` matches the exact sentinel, so anything but `'1'` reads as no intent and the app behaves as today. Pinned by test W5.
5. **The key is hand-set to exactly `'1'` with no logout ever having happened.** The panel renders with `Entrar`. One click. Not a lockout, and there is no path by which the app itself produces this without a `Sair`.
6. **Storage throws on read.** `hasLogoutIntent` is `false`, so the intent was never observable and there is nothing to clear. Today's behaviour exactly.
7. **Storage throws on write.** `markLogoutIntent` is a silent no-op, so again there is nothing to clear. This slice's protection is absent in that browser, which is the documented fail-open trade, but no lockout.
8. **Storage can be written but not deleted** - a browser that does not exist. Even then, point 2 attempts the clear on every live token, and closing the tab clears it. Worst case is one tab close.

There is no case in which the app has both the intent set and no reachable clear.
The strongest guarantee is point 2: because it fires on ANY live token, the intent can only ever persist while no token is obtainable, and while no token is obtainable the operator was going to have to sign in anyway.

### 4.6 The one race, stated, bounded, and pre-existing

Between step 3 and step 8 of 4.1 there is a window in which the BFF session still exists.
A `getToken()` issued inside that window could return a live token, clear the intent via point 2, and flip `isSignedIn` back to true.

This is pre-existing - the same window already resurrects the profile today - and this slice does not widen it.
It is also very hard to enter: `HubProtected` replaces its children the instant `isSignedIn` goes false, so the roughly forty screen-level token readers are unmounted before any of them could issue a read, and `tokenCache.clear()` has already neutralized every refresh that was in flight.
The only remaining reader is a pending ladder rung, and once slice 03 lands, a post-`client.logout()` refresh classifies as `401 session_expired` and tears the session down rather than returning a token.
Recorded in section 8 as R3 rather than papered over.

## 5. Composition with slices 03 and 05

All three edit `apps/web/src/auth/react.tsx`, and execution is serial per the overview, so there is no worktree conflict to manage - only a semantic one.

**Slice 03.**
It retypes `observeToken(result: HubTokenResult)`, changes the branch condition to `result.token !== null`, rewrites the null branch, and DELETES `hasSessionRef`.
This slice adds exactly one line inside the live-token branch (`clearLogoutIntent()`, section 3.3), which survives all of that.
Nothing here reads `hasSessionRef`, by construction.
Slice 03's own risk R4 says "a ladder can now start after an explicit `Sair`, harmless, slice 04 owns the real fix" - that is this slice, and it holds: the ladder may still run, but when it exhausts, `failSession()` leaves the profile signed out and `HubProtected` renders `SignedOutPanel` instead of redirecting, because the intent is set.
Strictly better than slice 03's stated position.

**Slice 05.**
It swaps the provider nesting in `App.tsx` so `QueryClientProvider` is outermost, calls `useQueryClient()` inside `HubAuthProvider`, and adds `queryClient.clear()` at three sites.
One of those sites is `logout()`, and slice 05's own text says "if slice 04 added statements to `logout`, insert the flush beside them without reordering them, subject only to the before-the-first-`await` rule".
`markLogoutIntent()` must remain the FIRST statement in `logout()`; the flush goes anywhere below it and above the `await`.
The other two sites (`observeToken`'s live-token branch and `setActive`) are untouched by this slice apart from the one `clearLogoutIntent()` line, which composes freely with slice 05's `if (!hasSessionRef.current) queryClient.clear();` line - though note that slice 05 will itself have to restate that condition once slice 03 deletes `hasSessionRef`, which is slice 05's problem and not this one's.

Slice 05 also wraps this file's test harness in a `QueryClientProvider`.
If slice 05 landed first, the RED tests below must be written inside that wrapping; the assertions are unaffected.

## 6. RED tests, written and seen to fail first

### 6.1 Harness prerequisites in `apps/web/src/auth/__tests__/react.test.tsx`

Three changes, made before any test is written. They are not tests.

1. **`renderProtected` must expose the `Sair` button.** It currently renders only `Probe` and `Protected`; `UserControls` lives in `renderProvider`. Add `<UserControls />` directly under `<AppAuthProvider>` and ABOVE `<MemoryRouter>`. `UserControls` reads no router hook - it uses only `useHubAuthContext` - so this is legal, and placing it outside `Protected` is what keeps the button reachable after the sign-out.
2. **A location probe outside `Protected`.** `LocationProbe` currently renders inside `Protected`, so it is unreadable while the panel is up. Give it an optional `testId` prop defaulting to `'location'`, keep the existing usage untouched, and render a second `<LocationProbe testId="outer-location" />` inside `<MemoryRouter>` but above `<Protected>`. Add an `outerLocationText(host)` helper beside `locationText`.
3. **Import `LOGOUT_INTENT_KEY`** from `'../session-recovery'` alongside `LOGIN_ATTEMPTS_KEY` and `RETURN_TO_KEY`.

`beforeEach` already calls `sessionStorage.clear()`, so no per-test cleanup of the new key is needed.

**A note on the mocked "dead session" value.** Several tests below need the token read to mean "the session is gone". Pre-slice-03 that is `mocks.cache.getToken.mockResolvedValue(null)`. Post-slice-03 it is `mockResolvedValue({token: null, failure: 'session_expired'})`, and slice 03's own harness names that `expired`. Use whichever shape the file is in when you write these; the assertions do not change.

### 6.2 Unit tests in `apps/web/src/auth/__tests__/session-recovery.test.ts`

A new `describe('logout intent')` at the end, using the file's existing `fakeStorage()` and `throwingStorage` helpers.

- **W1** `records an intent that reads back` - `markLogoutIntent(storage)`, then `hasLogoutIntent(storage)` is `true` and `storage.getItem(LOGOUT_INTENT_KEY)` is `'1'`.
- **W2** `reports no intent for an empty storage` - `hasLogoutIntent(fakeStorage().storage)` is `false`.
- **W3** `clears the intent, so a fresh login is never blocked` - mark, clear, `hasLogoutIntent` is `false` and the key is absent from the map.
- **W4** `fails open when storage throws, in both directions` - `markLogoutIntent(throwingStorage)` does not throw, `hasLogoutIntent(throwingStorage)` is `false`, `clearLogoutIntent(throwingStorage)` does not throw. This is the lockout-safety pin for a hardened browser profile.
- **W5** `ignores a value it did not write` - `it.each` over `''`, `'0'`, `'true'`, `'"1"'`, `'{}'`: `hasLogoutIntent` is `false` for every one. This is the pin for section 2.1's exact-sentinel decision, and it is a lockout pin: an over-broad match would let a stray value suppress every automatic login.

### 6.3 Provider and route tests in `apps/web/src/auth/__tests__/react.test.tsx`

A new `describe('explicit logout intent')`.

The oracle throughout is a STORAGE INVARIANT, not an observed redirect.
CLAUDE.md records that a happy-dom DOM-level test once passed with the bug fully present, so none of these tests tries to observe the race.
`sessionStorage.getItem(LOGIN_ATTEMPTS_KEY) === null` after a sign-out proves the login effect's BODY never ran, because `registerLoginAttempt()` is the first statement in it and it always writes on a fresh counter.
That is an invariant that makes the failure impossible, rather than evidence that it has not happened yet.

- **R1** `does not capture the route or spend a login attempt when the operator signs out`.
  `renderProtected(['/cadastros/produtos?f=1'])` with `mocks.cache.getToken` resolving `profileToken('Alpha')`; flush; assert `profileText` is `'signed-in:Alpha'`.
  Click `button[aria-label="Sair"]` inside `act`.
  Assert all four: `sessionStorage.getItem(RETURN_TO_KEY)` is `null`, `sessionStorage.getItem(LOGIN_ATTEMPTS_KEY)` is `null`, `mocks.client.login` was not called, and `sessionStorage.getItem(LOGOUT_INTENT_KEY)` is `'1'`.
  **Corrected by plan-check N1. Do NOT doc-comment this as an "ordering oracle" - it is not one, and the claim is mechanically false.**

  The original draft asserted that moving `markLogoutIntent()` below `failSession()` turns the first three assertions red, by analogy with the proposta wizard's submit button. That analogy does not transfer. The wizard bug lives between two distinct browser phases - event dispatch, then the element's activation behaviour - and React's synchronous flush lands between them. Here, everything from `markLogoutIntent()` through `consumeReturnTo()` is one uninterrupted synchronous block inside `logout()`, and React cannot re-render in the middle of a synchronous function. The discrete-event flush happens when the `onClick` handler returns, which is after the entire synchronous block regardless of internal ordering. So `markLogoutIntent()` placed anywhere before the first `await` fixes the bug identically, and this test will NOT go red on that mutation.

  What R1 actually is, and it is a good oracle: proof that the login effect's **body never ran**, via the unspent `LOGIN_ATTEMPTS_KEY`. Doc-comment it as that.

  Keep `markLogoutIntent()` as the first statement anyway. It is the right defensive position and the only one that stays correct if an `await` is ever inserted above it. State the invariant the way slice 05 states it correctly: **synchronous, and before the first `await` in `logout()`** - not "the first statement".

  Today R1 fails on the first two assertions: the slot holds `/cadastros/produtos?f=1` and the counter holds `{count:1}`.

- **R2** `keeps the return-to slot empty across a remount after an explicit sign-out`.
  Continue from R1's state: unmount the root, `container?.remove()`, null both, set `mocks.cache.getToken` to the dead-session value, and `renderProtected(['/cadastros/produtos?f=1'])` again.
  Flush.
  Assert `RETURN_TO_KEY` is `null`, `LOGIN_ATTEMPTS_KEY` is `null`, `mocks.client.login` was not called, and `container.textContent` contains `'Você saiu da sua conta'`.
  This is the durability requirement: an in-memory flag passes R1 and fails R2.

- **R3** `does not auto-login while the logout intent is set`.
  Seed `sessionStorage.setItem(LOGOUT_INTENT_KEY, '1')` before mounting, dead-session token read, `renderProtected(['/cadastros/produtos?f=1'])`, flush.
  Assert `mocks.client.login` not called, `LOGIN_ATTEMPTS_KEY` is `null`, `RETURN_TO_KEY` is `null`, and the panel copy is on screen.
  Distinct from R2 in that it never performs a logout at all, so it pins the gate independently of `logout()`'s statement order.

- **R4** `resets the URL to the default route after an explicit sign-out`.
  Same setup as R3, then assert `outerLocationText(container)` is `'/'`.
  Also run the R1 variant: sign out from `/cadastros/produtos?f=1` and assert `outerLocationText(container)` is `'/'` after the click.
  Without section 2.4's effect the URL bar still shows the previous operator's route.

- **R5** `clears the intent and re-arms the login effect when the operator clicks Entrar`.
  From R3's state, find the button whose `textContent.trim()` is `'Entrar'` and click it inside `act`.
  Assert `sessionStorage.getItem(LOGOUT_INTENT_KEY)` is `null`, `mocks.client.login` was called exactly once, and `sessionStorage.getItem(RETURN_TO_KEY)` is `null` - the last because the URL was already `/` and `sanitizeReturnTo` rejects it, which is section 2.4's whole point.
  This is the primary anti-lockout test.

- **R6** `clears the intent whenever a live token is observed, so a stale intent can never lock the tab out`.
  Seed `LOGOUT_INTENT_KEY` to `'1'`, then mount with `mocks.cache.getToken` resolving `profileToken('Alpha')`.
  Flush.
  Assert `sessionStorage.getItem(LOGOUT_INTENT_KEY)` is `null`, `profileText(container)` is `'signed-in:Alpha'`, and `locationText(container)` (the INNER probe, inside `Protected`) is readable - proving the children rendered and the panel did not.
  This is the backstop of section 4.5 point 2, and it is the test that fails if someone puts the clear in `applyToken` behind its unchanged-token early return.

### 6.4 Existing tests: expected to stay green, checked deliberately

None of these should need editing. Confirm rather than assume.

- `clears browser token state before SDK logout` - uses `renderProvider`, which has no `Protected`, so no panel and no URL reset. It asserts `cache.clear` ran before `client.logout`; `markLogoutIntent()` is now above `cache.clear` and changes neither.
- `does not restore authentication when a workspace switch resolves after logout begins` - same harness, same reasoning. The intent is written but nothing in that test reads it.
- `stops re-logging in and offers a manual retry after repeated failures` - no intent is ever set, so `logoutIntent` is `false` and the render falls through to `SessionRecoveryPanel` exactly as before. This is the test that catches an inverted render precedence.
- `captures and restores the pre-login route across a genuine re-login` - no logout, no intent, so the capture still happens. This is the test that catches an over-broad gate that suppresses capture for every signed-out state rather than only after an explicit `Sair`.
- `discards the hostile stored return path %j instead of navigating to it` - unaffected; this slice does not touch `sanitizeReturnTo` or the restore effect.

If `captures and restores the pre-login route across a genuine re-login` goes red, the gate has been written as "signed out" rather than "explicitly signed out". That is the single most likely wrong implementation of this slice.

## 7. Documentation

### 7.1 `CLAUDE.md`, "Auth Model"

Append after the `sanitizeReturnTo` paragraph (do not modify that paragraph):

```
- An explicit `Sair` writes a DURABLE logout intent, `fxl-sales.auth.logoutIntent` in `sessionStorage`, and `markLogoutIntent()` is SYNCHRONOUS and lands BEFORE THE FIRST `await` in `logout()`; it is written as the first statement, above `tokenCache.clear()` and above `failSession()`.
  The measured bug is not an ordering bug INSIDE that synchronous block - React cannot re-render in the middle of a synchronous function, so every statement from `markLogoutIntent()` through `consumeReturnTo()` completes before any flush. It is that `logout()` had no durable intent at all: `consumeReturnTo()` cleared the slot, the discrete click's state update then flushed when the handler returned, and `HubProtected`'s login effect refilled the slot with the exact route the logout was clearing, spent a login attempt, and redirected to the Hub.
  The "before the first `await`" rule is what makes the intent visible to that flush, and it is the position that stays correct if an `await` is ever inserted above it.
  This is deliberately NOT the same mechanism as the proposta wizard's submit button, which races two browser phases within a single click; do not conflate them.
  While the intent is set, `HubProtected` refuses to auto-login BEFORE calling `registerLoginAttempt()`, so the attempt budget is unspent - which is also the test oracle, since it proves the effect body never ran rather than merely that no redirect was seen.
  It reduces the URL to `/` so the previous operator's route is neither on screen nor available to capture the instant the intent clears, and it renders `SignedOutPanel` in preference to `SessionRecoveryPanel`, whose "Tentamos entrar novamente algumas vezes" would be a lie when no automatic attempt was made.
  Auto-re-login after an explicit `Sair` is deliberately not offered: on a shared machine the Hub's own SSO cookie can complete it with no prompt, undoing the one action the product has for ending a session.
  The intent is cleared in exactly two places, and BOTH are needed: the panel's `Entrar` button, and `observeToken`'s live-token branch beside `clearLoginAttempts()`.
  The second is the anti-lockout backstop - any token at all proves the session is live, so the intent can only ever persist while no token is obtainable.
  It must not move into `applyToken`, whose unchanged-token early return would skip it whenever a re-login yielded a byte-identical token.
  `sessionStorage` and not `localStorage`: the intent must die with the tab, because a week-old intent from a closed tab suppressing a fresh login is a lockout bought for nothing, and `client.logout()` destroys the session server-side anyway, so other tabs sign out on their own next refresh.
  `hasLogoutIntent` matches an exact sentinel and fails OPEN on an unreadable storage, both for the same reason: an over-broad or fail-closed read is a lockout, while a narrow or fail-open one is only a return to the prior behaviour.
```

### 7.2 `nexo/ROADMAP.md`

**Delete** the existing backlog line beginning `- fix: `logout()`'s `consumeReturnTo` call in `apps/web/src/auth/react.tsx` is inert`.
This slice takes the second of the two options that line offers - a signing-out state that suppresses both the capture and the auto re-login - so the entry is resolved rather than restated.

**Add** to the Backlog list:

```
- fix: closing the tab after a `Sair` discards the durable logout intent along with `sessionStorage`, so a brand new tab cold-starts, gets a `401` from `/auth/refresh` because the session really was destroyed, and redirects to the Hub - where the Hub's own SSO cookie may complete the login with no prompt. `feature-20260807-hub-sdk-130-session-hardening` slice 04 closes the same-tab case, which is the one its threat model names, and deliberately did not reach for `localStorage`, which would trade this for a real lockout vector. The remaining case is Hub-side: it needs either a `prompt=login` on the post-logout authorize request or an RP-initiated logout that clears the Hub's own session, neither of which the browser can decide alone.
```

## 8. Risks and rollback

**R1. LOCKOUT. The intent is set and cannot be cleared, so the operator can never sign in again.**
This is the sharpest risk in the slice and the one to review hardest.
Mitigated structurally by TWO independent clearing points (the `Entrar` button and `observeToken`'s live-token branch), by the exact-sentinel read so a corrupt value cannot set it, by the fail-open read so a blocked storage cannot set it, and by `sessionStorage` scoping so closing the tab clears it unconditionally.
Argued case by case in section 4.5 and pinned by W3, W4, W5, R5 and R6.
The specific wrong implementation to watch for is putting the clear only on the button: R6 is the test that fails on it.

**R2. An over-broad gate suppresses the automatic login for every signed-out state, not only an explicit `Sair`.**
That would break the ordinary session-expiry path, where auto-login is correct and is what makes the route restore work at all.
Caught by the existing `captures and restores the pre-login route across a genuine re-login`, which must stay green, and named in section 6.4 as the most likely wrong implementation.

**R3. The resurrection window between `failSession()` and `client.logout()` resolving.**
A token read landing inside it could return a live token and clear the intent via the backstop.
Pre-existing, not widened here, very hard to enter because `HubProtected` unmounts the roughly forty token readers on the same commit and `tokenCache.clear()` neutralizes every in-flight refresh, and closed properly by slice 03 (a post-logout refresh classifies `401`) plus slice 06 (server-side supersede).
Analysed in section 4.6.

**R4. Statement order in `logout()` is silently regressed by a later edit.**
Slice 05 explicitly inserts into this function, so this is a live hazard rather than a theoretical one.
Mitigated by the loud comment in section 3.2, by the CLAUDE.md paragraph, and by R1's three-assertion oracle, which goes red on the reordering.

**R5. The URL reset to `/` surprises someone.**
It is a behaviour change beyond the literal bug: after `Sair` the address bar reads `/` rather than the last route.
Accepted, and argued in section 2.4 - leaving the route in `location` reintroduces the leak the moment the intent clears, and the URL bar is itself visible to the next person at the desk.
It only ever fires while the intent is set, so no signed-in or ordinarily-expired session is affected.

**R6. `renderProtected` now mounts `UserControls`,** which renders the workspace `Combobox` when the profile carries more than one workspace.
That adds DOM to every test using that helper.
Checked: no existing assertion in `react.test.tsx` queries by a selector the combobox would collide with (`[data-testid="profile"]`, `[data-testid="location"]`, `button[aria-label="Sair"]`, and the two panels' button text), and `container.textContent` is asserted only with `not.toContain('evil.example')`.
Re-run the whole file rather than only the new describe.

**Rollback.** `git revert` the slice commit.
There is no migration, no API surface, no persisted server state and no schema change.
The only durable artefact is one `sessionStorage` key, which is per tab and dies with it, so a revert needs no cleanup: an intent left behind by the reverted build is simply never read again.

## 9. Verification, run-once only

Never a bare watching `vitest`.
`@fxl-sales/web`'s `test` script is already `vitest run`.

```bash
# 1. narrowest first, while iterating
pnpm --filter @fxl-sales/web exec vitest run src/auth/__tests__/session-recovery.test.ts
pnpm --filter @fxl-sales/web exec vitest run src/auth/__tests__/react.test.tsx

# 2. the whole auth surface
pnpm --filter @fxl-sales/web exec vitest run src/auth

# 3. the web package whole
pnpm --filter @fxl-sales/web lint
pnpm --filter @fxl-sales/web type-check
pnpm --filter @fxl-sales/web test

# 4. the repo gates
pnpm run lint
pnpm run type-check
pnpm test
pnpm run build
```

Expected: W1-W5 and R1-R6 all fail before the source change and pass after, and every pre-existing test named in section 6.4 stays green without being edited.

`pnpm --filter @fxl-sales/api test:integration` is not required by this slice, which touches no API file; the feature-level gate still runs it.

No dev server, file watcher or background process is started by this slice, so there is nothing to kill afterwards.
