# VERDICT: PASS

Slice `04-durable-logout-intent`, commit `3303d8e`, branch `feat/04-durable-logout-intent`, baseline `master`.
Every acceptance clause is proven, every gate command is green, and every mutation I applied killed its named oracle.
One theoretical lockout path exists and is recorded below under "Green but concerning"; it requires a browser in which `setItem` succeeds and `removeItem` throws, which the plan already enumerated as case 8 and which no shipping browser implements.

## Command results

| Command | Result | Notes |
| --- | --- | --- |
| `pnpm run type-check` | PASS | `shared-types`, `shared-utils`, `apps/api`, `apps/web` all Done |
| `pnpm run lint` | PASS | `apps/api` and `apps/web` eslint Done, zero findings |
| `pnpm test` | PASS | shared-utils 80/80, apps/api 366/366 (37 files), apps/web 611/611 (48 files); `no-legacy-auth` and `build-contract: ok` |
| `pnpm run build` | PASS | built in 1.67s |

Run once each, non-watching, before and after all mutation work.
The post-mutation run above is the authoritative one; the tree was byte-identical to `3303d8e` at that point.

The 611 web tests include the 12 new `session-recovery.test.ts` cases (W1-W5, W5 being an 8-case `it.each`) and the 7 new `react.test.tsx` cases (R1-R6 plus the split URL-reset case).
`apps/web/src/auth` alone is 94 tests across 5 files.

## Mutation testing results

All mutations applied to a clean tree, run with `pnpm --filter @fxl-sales/web exec vitest run src/auth`, then reverted with `git checkout --`.

| # | Mutation | Expected | Observed | Reverted |
| --- | --- | --- | --- | --- |
| M1 | Delete `\|\| logoutIntent` from `HubProtected`'s login effect guard (`react.tsx:457`) - **the mutation named in the brief** | RED | **RED, 4 tests**: R1 `does not capture the route or spend a login attempt...`, R2 `keeps the return-to slot empty across a remount...`, R3 `does not auto-login while the logout intent is set`, R5 `clears the intent and re-arms...Entrar`. 90 passed. | yes, then re-ran 94/94 green |
| M2 | Delete `clearLogoutIntent()` from `observeToken`'s live-token branch (`react.tsx:251`) - kills the anti-lockout backstop | RED | **RED, 1 test**: R6 `clears the intent whenever a live token is observed, so a stale intent can never lock the tab out` | yes |
| M3 | Delete `clearLogoutIntent()` from the `Entrar` handler (`react.tsx:484`) - kills the deliberate clearing point | RED | **RED, 1 test**: R5 `clears the intent and re-arms the login effect when the operator clicks Entrar` | yes |
| M4 | Delete the URL-reset effect (`react.tsx:451-454`) | RED | **RED, 3 tests**: both `resets the URL to the default route...` cases plus R5 (the return-to slot refills with the leaked route) | yes |
| M5 | `hasLogoutIntent` -> `Boolean(readItem(...))`, i.e. an over-broad truthy match (`session-recovery.ts:264`) | RED | **RED, 7 tests**: the W5 `it.each` on `'0'`, `'true'`, `'"1"'`, `'{}'`, `' 1'`, `'1 '`, `'01'` | yes |
| M6 | `logoutIntent = isLoaded && !isSignedIn` - the over-broad gate, i.e. risk R2 in the plan | RED | **RED, 3 tests**, and critically including the pre-existing `captures and restores the pre-login route across a genuine re-login` and `stops re-logging in and offers a manual retry after repeated failures` | yes |

M1's failure message is the reported bug reproduced verbatim:

```
AssertionError: expected '/cadastros/produtos?f=1' to be null
- Expected: null
+ Received: "/cadastros/produtos?f=1"
 ❯ src/auth/__tests__/react.test.tsx:758:51
    758|     expect(sessionStorage.getItem(RETURN_TO_KEY)).toBeNull();
```

Final `git status --short` matches the pre-verification snapshot exactly: `M nexo/.../budget.json`, `?? .vscode/`, `?? nexo/.../agents/exec-04.result.json`.
No mutation survives in the tree, and no probe file survives.

## Lockout analysis

The sharpest risk. I read both clearing points in the code, then enumerated paths adversarially, then built a throwaway probe file (`apps/web/src/auth/__tests__/zz-verify-lockout-probe.test.tsx`, 7 cases, since deleted) to settle the ones that reasoning alone could not.

Both clearing points exist and are load-bearing:

1. `apps/web/src/auth/react.tsx:484` - the `Entrar` handler calls `clearLogoutIntent()` then `recheckRecoveryGuards()`. Killing it goes red (M3).
2. `apps/web/src/auth/react.tsx:251` - `observeToken`'s live-token branch, sitting beside `clearLoginAttempts()` and above `applyToken(token)`. Killing it goes red (M2). It is correctly NOT inside `applyToken`, whose `lastAppliedToken.current === token` early return at `react.tsx:180` would skip it on a byte-identical re-login token.

| # | Path attempted | Result |
| --- | --- | --- |
| P1 | Full cycle: sign in at `/cadastros/produtos?f=1`, click `Sair`, click `Entrar`, unmount, remount with a live token | ESCAPES. Probe L1 passed. Intent `'1'` after `Sair`, `null` after `Entrar`, `login()` called once, profile `signed-in` after the round trip. |
| P2 | Reload while the intent is set (unmount, remount, dead-session token read) | ESCAPES. Probe L4 ran 3 consecutive remounts at deep URLs; the panel and a live `Entrar` button rendered every time, `login()` never fired automatically, outer URL `/` every time. Also pinned in-repo by R2. |
| P3 | Navigate directly to a deep URL with the intent set | ESCAPES. R3 and probe L4. `HubProtected` is mounted on every route in `apps/web/src/router.tsx` (`/`, `/admin`, `/finder`, `/seller`, `/no-role`, `/:workspace/:view`), and the catch-all `{ path: '*', element: <Navigate to="/" replace /> }` funnels anything unmatched into `/`, which is itself `<Protected>`. There is no route that renders outside `Protected` and could strand the intent unobserved. |
| P4 | `sessionStorage` throws on READ | NO LOCKOUT. `readItem` catches, `hasLogoutIntent` returns `false`, the intent is never observable. W4 pins it. |
| P5 | `sessionStorage` throws on WRITE (Safari private mode, quota exceeded) | NO LOCKOUT. `markLogoutIntent` is a silent no-op, so no intent is ever set. This slice's protection is simply absent there - the documented fail-open trade. W4 pins it. |
| P6 | The whole `sessionStorage` object throws on access (hardened enterprise profile) | NO LOCKOUT. `defaultStorage()` returns `null`, all three accessors no-op. |
| P7 | A token arrives BEFORE `Entrar` is clicked | NO LOCKOUT - the opposite. Probe L6 and R6: `observeToken` clears the intent and the operator is signed straight back in. This is the plan's pre-existing R3 resurrection window, not widened here. |
| P8 | Tab closed and reopened | NO LOCKOUT. `sessionStorage` dies with the tab. Cannot be tested in-process; it is a browser guarantee, and `localStorage` was correctly rejected precisely because it would not have it. |
| P9 | The intent key is hand-set to a value the module did not write | NO LOCKOUT. Exact-sentinel match; W5's 8 cases. M5 proves the pin is live. |
| P10 | Intent set AND the login-attempt counter already exhausted | ESCAPES IN TWO CLICKS. Probe L2: `Entrar` clears the intent and hands off to `SessionRecoveryPanel` (`Não foi possível restabelecer sua sessão`), whose `Tentar novamente` clears the counter and reaches `login()`. Verified end to end. |
| P11 | URL-reset effect render loop (`navigate('/')` re-firing forever) | NO LOOP. Probe L5 completed in ~30ms with the outer location at `/`. Structurally safe: the effect returns early on `currentPath === '/'`, `/` maps to `<Protected><SalesOpsApp/></Protected>` with no `Navigate` of its own, and the children that could re-navigate (`SalesOpsApp`'s `resolveSalesOpsRoute`, the shells' index `Navigate`s) never mount while the panel is up. |
| P12 | `client.login()` throws from the effect after `Entrar` | NO LOCKOUT. The intent is already cleared before `login()` is reached; a throw lands on the route `errorElement`. |
| P13 | **`setItem`/`getItem` work but `removeItem` throws** | **LOCKOUT for the life of the tab.** Probe L3, with the spy retargeted at the `sessionStorage` instance (a `Storage.prototype` spy is inert under happy-dom - my first attempt silently did nothing and I caught it with a sanity assertion): `still on the signed-out panel after Entrar = true`, `login() calls = 0`, and still stuck after a second click. Both clearing points route through `dropItem`, which swallows the throw, so neither can succeed. See the assessment below. |

**Assessment of P13.** This is the plan's section 4.5 case 8, which calls it "a browser that does not exist", and I agree it is not reachable in practice.
The Web Storage spec allows `removeItem` to throw only a `SecurityError` when storage is disabled outright, in which case `setItem` throws too (P5) and no intent is ever written.
Safari private mode - the usual real-world asymmetry - throws on `setItem` with a zero quota while `removeItem` works, which is P5, not P13.
The escape is closing the tab, which wipes `sessionStorage` wholesale via the browser rather than via `removeItem`, so even the hypothetical is bounded at one tab close.
I do not treat this as a FAIL: it is enumerated in the plan, it is unreachable, and it is bounded.
It is recorded below because the module's own `dropItem` comment ("an unwritable storage is an empty storage") is the one place that reasoning inverts - for `clearLogoutIntent`, a failed drop means a permanently NON-empty storage.

**Conclusion on lockout.** No reachable lockout. The backstop at `react.tsx:251` is genuinely strong: because it fires on any live token from any source (callback round trip, workspace switch, ladder recovery), the intent can only ever persist while no token is obtainable, and while no token is obtainable the operator had to sign in regardless.

## Findings against checks 1-6

### 1. Lockout - PASS
Both clearing points verified present in the code and both proven load-bearing by mutation (M2, M3).
13 paths enumerated above. The only surviving one, P13, is unreachable in any shipping browser and bounded at one tab close.

### 2. Non-vacuity by mutation - PASS
M1, the mutation named in the brief, turns four tests RED including the two headline oracles (R1, R3), and the R1 failure is a literal reproduction of the reported route leak.
Five further mutations (M2-M6) each kill their own named oracle, so no protection point in this slice is untested.
Reverted and re-confirmed 94/94 green in `src/auth`, then 611/611 across `apps/web`.

### 3. Does it fix the reported bug - PASS
Confirmed independently and specifically against the "cleared then undone" trap the brief flags.

- The immediate assertion is NOT vacuous. R1 asserts `RETURN_TO_KEY === null` right after the `Sair` click, and under M1 it fails with the received value `'/cadastros/produtos?f=1'`. The re-capture really does happen inside the click's synchronous flush in this harness, so the assertion does survive the re-render that re-captures.
- The durability assertion is separate and real. R2 (`react.test.tsx:762-786`) performs a genuine `root.unmount()`, `container.remove()`, nulls both, switches the token read to the dead-session value, and re-renders `renderProtected(['/cadastros/produtos?f=1'])` before asserting `RETURN_TO_KEY` null, `LOGIN_ATTEMPTS_KEY` null, `login` not called, and the signed-out copy on screen. It went red under M1 too.
- R3 is the independent durability proof and does not depend on `logout()` at all: it seeds only `sessionStorage[LOGOUT_INTENT_KEY] = '1'`, mounts fresh, and asserts no auto-login, no attempt spent, no capture and the panel. An in-memory flag cannot pass it. Red under M1.
- The oracle choice is right for this environment. `LOGIN_ATTEMPTS_KEY === null` proves the login effect's *body* never ran, because `registerLoginAttempt()` is its first statement and always writes on a fresh counter. That is an invariant, not an observation of the race - correctly heeding the CLAUDE.md warning that a DOM-level test in happy-dom once passed with a bug fully present.

One honest limitation, which does not change the verdict: R2's remount step is not *independently* mutation-distinguished from R1, because under M1 the slot is already dirty before the remount. R3 supplies that independence, so the acceptance clause "stays empty across a remount" is proven compositionally (R1: logout writes the durable key; R3: a fresh mount reading only that key suppresses capture and auto-login) as well as directly (R2's literal unmount/remount).

### 4. Must-not-break - PASS
- `sanitizeReturnTo` is byte-identical to `master`. `git diff master...HEAD -- apps/web/src/auth/session-recovery.ts` grepped for `sanitizeReturnTo|normalized|captureReturnTo|consumeReturnTo` returns nothing; the file's only changes are the new constants block (lines 25-32) and the three new accessors appended after `clearLoginAttempts` (lines 240-269). The normalized re-assertion at `session-recovery.ts:142-143` and its doc-comment clause 7 about `/..//evil.example` are untouched.
- Both `discards the hostile stored return path %j instead of navigating to it` cases (`"https://evil.example/"` and `"//evil.example/x"`) are green.
- `captures and restores the pre-login route across a genuine re-login` is green - and, more usefully, I proved it is a LIVE guard rather than a dormant one: mutation M6 (gating on plain "signed out" instead of "explicitly signed out") turns it RED. That is exactly the R2-risk regression the plan names as the single most likely wrong implementation, and the repo detects it.
- `stops re-logging in and offers a manual retry after repeated failures` is green (and also red under M6), so the render precedence putting `logoutIntent` ahead of `loginBlocked` has not broken the recovery panel.
- `clears browser token state before SDK logout` and `does not restore authentication when a workspace switch resolves after logout begins` are green, unedited.

### 5. Scope - PASS
`git diff master...HEAD --name-only` is exactly seven files: `CLAUDE.md`, `nexo/ROADMAP.md`, `nexo/runs/.../notes-04.md`, `apps/web/src/auth/react.tsx`, `apps/web/src/auth/session-recovery.ts`, and the two auth test files.

- No `apps/api` file touched. Zero matches.
- Query cache untouched (slice 05's territory). Grepping the web diff for `queryClient|QueryClient|invalidateQueries` returns nothing.
- Token classification untouched (slice 03's territory). Grepping for `HubTokenResult|hasSessionRef|function observeToken|session_expired` returns nothing; `observeToken` keeps its `(token: string | null)` signature and the `hasSessionRef` machinery at `react.tsx:212` and `:239`/`:257` is unmodified. The slice adds exactly one line inside the live-token branch, which is the composition point slice 03's plan anticipated.
- Nothing new reads `hasSessionRef`, so slice 03's planned deletion of it will not collide.
- The `markLogoutIntent()` position is compatible with slice 05's stated rule (synchronous, before the first `await`); it is the first statement in `logout()` at `react.tsx:292`, above `tokenCache.clear()` and `failSession()`.

### 6. UI quality - PASS
`SignedOutPanel` is at `apps/web/src/auth/react.tsx:395-405`.

- **Structurally a twin of `SessionRecoveryPanel`.** The wrapper class string is character-identical (`flex h-screen flex-col items-center justify-center gap-4 px-6 text-center`), same `h1` at `text-2xl font-semibold`, same `p` at `max-w-md text-muted-foreground`, one button. Visually consistent by construction, not by eye.
- **The copy makes no false claim of automatic retries.** "Você saiu da sua conta" / "Sua sessão foi encerrada neste navegador. Entre novamente para continuar." Nothing suggests an attempt was made. This matters because `SessionRecoveryPanel`'s "Tentamos entrar novamente algumas vezes" WOULD be a lie here, and the render precedence at `react.tsx:474` correctly puts `logoutIntent` first so that copy can never appear after an explicit `Sair`. I confirmed the precedence empirically in probe L2: with both conditions true, the signed-out copy renders and the recovery copy does not.
- **pt-BR is correct and idiomatic**, and consistent with the file's existing hardcoded strings (`Sair`, `Buscar workspace...`, `Tentar novamente`). Not routed through `src/i18n/**`, matching the precedent the sibling panel already documents. `i18n/__tests__/keys-resolve.test.ts` is green.
- **`Entrar` is a real accessible button.** Probe L7 dumped the rendered element: `<button class="inline-flex ... focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2">Entrar</button>`. `tagName` is `BUTTON`, not disabled, keyboard focusable with a visible focus ring, 40px `h-10` primary. The `default` variant against the sibling's `outline` is the right call - this is the single primary action on the screen, not a secondary retry under an error.
- **Exactly one `h1` on the page**, verified by probe L7 (`['Você saiu da sua conta']`).
- No native `<select>`/`<option>`/`<datalist>` and no raw numeric input, so the CLAUDE.md control bans are not engaged; lint confirms.
- No raw account or workspace id is rendered.

## Green but concerning

1. **`clearLogoutIntent` inherits `dropItem`'s fail-open comment, but the failure direction is inverted for this key.** `session-recovery.ts:85-92` documents "an unwritable storage is an empty storage", which is right for the return-to slot and the attempt counter. For the logout intent, a swallowed `removeItem` throw means a permanently *non*-empty storage, and both clearing points go through it - which is P13 above. Unreachable today, but the cheap hardening is one line: have `clearLogoutIntent` fall back to `writeItem(storage, LOGOUT_INTENT_KEY, '')`, since `''` is already pinned by W5 to read as "no intent". I did not apply it (verify does not fix), and I do not consider it blocking. Worth a ROADMAP line.

2. **No focus management or live-region announcement when the panel replaces the tree.** After `Sair`, `HubProtected` swaps the whole subtree for `SignedOutPanel`; focus falls to `<body>` and nothing is announced to a screen reader. A keyboard user must Tab to reach `Entrar`. This is not a regression - `SessionRecoveryPanel` behaves identically and predates the slice - so it is consistent rather than newly broken. Both panels would benefit from an `autoFocus` on the button or a `role="status"` on the heading.

3. **A one-frame window where the panel is painted at the old URL.** `useEffect` is a passive effect, so between the commit that renders `SignedOutPanel` and the effect that calls `navigate('/', {replace: true})` there is one paint at the previous operator's URL. Clicking `Entrar` inside that frame is not humanly achievable, and the slice's design deliberately makes the URL reset structural rather than batching-dependent, which is the right call. Recording it only for completeness; it is not a defect.

4. **The intent is per-tab, so a second tab still auto-re-logins.** `client.logout()` destroys the BFF session, so tab B's next `/auth/refresh` 401s and tab B redirects to the Hub, where the Hub's SSO cookie may complete the login with no prompt. The slice's threat model names the same-tab case and `localStorage` was correctly rejected as a lockout vector. The residual is now filed accurately in `nexo/ROADMAP.md` (the old inert-`consumeReturnTo` entry was deleted and replaced with the Hub-side follow-up), so it is tracked rather than lost.

5. **A behaviour change beyond the literal bug: after `Sair` the address bar reads `/`.** Plan risk R5, accepted there with an argument I find sound (leaving the route in `location` reintroduces the leak the moment the intent clears, and the URL bar is itself visible to the next person). It fires only while the intent is set, so no signed-in or ordinarily-expired session is affected. Flagging it so the release note can mention it rather than have an operator discover it.

6. **CLAUDE.md and ROADMAP claims spot-checked against the code and hold.** The new "Auth Model" paragraph correctly states `markLogoutIntent()` is the first statement above `tokenCache.clear()` and `failSession()` (matches `react.tsx:292-297`), that the gate precedes `registerLoginAttempt()` (matches `:457` vs `:460`), that the two clearing points are the button and `observeToken`'s live-token branch (matches `:484` and `:251`), and that it must not move into `applyToken` (whose early return is at `:180`). It also correctly declines to conflate this with the proposta wizard's submit-button race - the plan's own N1 correction - which I verified is accurate: everything from `markLogoutIntent()` to `consumeReturnTo()` is one uninterrupted synchronous block, so R1 is an effect-body-never-ran oracle and not an ordering oracle. The doc does not overclaim.
