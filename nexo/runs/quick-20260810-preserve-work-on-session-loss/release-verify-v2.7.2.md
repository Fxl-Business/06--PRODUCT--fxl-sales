# Release verify - v2.7.2

**VERDICT: PASS**

Release commit `3c26917` on `master`, proposed tag `v2.7.2`, production currently on `v2.7.1`.
Verified by an agent that wrote none of this code, on a clean tree at the exact release commit.

---

## 1. Command results

Every command was run once, never in watch mode, and the exit code below is the real `$?` of the command.

| Command | Exit | Result |
| --- | --- | --- |
| `pnpm install --frozen-lockfile` | 0 | Lockfile up to date, no resolution drift |
| `pnpm run type-check` | 0 | 4 projects, all clean |
| `pnpm run lint` | 0 | `apps/api` and `apps/web` eslint clean |
| `pnpm test` | 0 | 49 files, **663 tests passed**, plus `build-contract: ok` |
| `pnpm run build` | 0 | web + api build clean |
| `pnpm --filter @fxl-sales/api test:integration` | 0 | 25 files, **169 tests passed** against local Docker DB |

No failures, no skips of note, no flakiness observed.

---

## 2. Clean-clone deploy simulation

This is the check `v2.3.0` failed.
Cloned to a temp directory, checked out `3c26917`, deleted every `*.tsbuildinfo` outside `node_modules`, installed with `--frozen-lockfile`, then ran the literal `buildCommand` from `vercel.json`.

`vercel.json` declares `"buildCommand": "pnpm --filter @fxl-sales/web build"` and `"outputDirectory": "apps/web/dist"`, with `master` deployments disabled, so Vercel builds from `production`.

| Step | Exit | Result |
| --- | --- | --- |
| clone + checkout `3c26917` | 0 | HEAD confirmed `3c26917` |
| `*.tsbuildinfo` deleted | - | none were tracked, nothing stale to hide a failure |
| `pnpm install --frozen-lockfile` | 0 | clean |
| `pnpm --filter @fxl-sales/web build` (the literal Vercel command) | 0 | `apps/web/dist/index.html` produced |
| `pnpm --filter @fxl-sales/api build` | 0 | `tsc && tsc-alias` clean |

The clone was deleted afterwards and confirmed gone.
The working tree of the real repository is untouched: `git status --porcelain` reports only the pre-existing untracked `.vscode/`, and HEAD is still `3c26917`.

---

## 3. Deployment-topology analysis

This is the check that matters most, because `v2.7.0` passed every test and every build and still took production down.
That incident was the `hub-sdk` 1.3.x CSRF origin guard 403ing every BFF POST, invisible locally because Vite proxies `/auth/*` same-origin while production runs the web app and the API on different hosts.

The concern raised for this release is the new proactive renewal, which issues a cross-origin credentialed POST on a timer and on `visibilitychange`.
I traced it end to end.

**The renewal does NOT construct its own request. It reuses the exact same closure as the existing refresh.**

The chain is:

- `createHubAccessTokenCache(() => requestHubAccessToken(bffBasePath))` in `apps/web/src/auth/react.tsx` builds the cache with one `refresh` function.
- Inside `apps/web/src/auth/token.ts`, the diff **extracted** the network half into a single `requestRefresh()`, and both `getToken()` (on a cache miss) and the new `renew()` call it.
  `renew` is literally `const renew = (): Promise<HubTokenResult> => requestRefresh();`.
- `requestRefresh()` calls the one `refresh` argument, which is that same `() => requestHubAccessToken(bffBasePath)`.

So the renewal issues the identical request: same `POST`, same `${bffBasePath}/auth/refresh` URL, same `credentials: 'include'`, same absence of custom headers.

Corroborating evidence:

- `apps/web/src/auth/refresh.ts` is **untouched** in `v2.7.1^{}..3c26917`. A diffstat over that path is empty.
- Grepping the whole web diff for `fetch(`, `credentials`, `headers`, `XMLHttpRequest` and `new URL` on added lines returns **nothing**. No new request is constructed anywhere in this release.
- `bffBasePath` is computed once (`getHubBffBasePath(import.meta.env)`) and handed to both `createHubClient` and `createHubAccessTokenCache`, so the renewal cannot resolve to a different origin than the client.

On the API side:

- There are **zero** changes under `apps/api/` in this range.
- The CSRF shim `apps/api/src/auth/hub-bff-origin.ts` is untouched, and it is mounted as `router.all('/auth/*', createHubBffOriginShim(bff, { trustedOrigins: [env.CORS_ORIGIN] }))`.
  It is path-agnostic and trigger-agnostic: it keys only on the `Origin` header and rewrites it to the API's own origin when the caller's origin is trusted.

The browser sets `Origin` from the document's origin on every cross-origin POST, identically whether the fetch was initiated by page load, a `setTimeout` or a `visibilitychange` listener.
A timer cannot change the `Origin` header, the credential mode or the cookie attachment rules.

**Conclusion: no topology blind spot in this release.**
The only thing that changed is *when* the refresh fires, not *what* it is.
The request the renewal sends is byte-identical to the one production is already known to accept, and it traverses the same shim over the same allowlist.
`Secure` / `SameSite` cookie behaviour is likewise unchanged, because the cookie is attached by the browser to the same URL under the same credential mode as before.

One low-severity note, recorded for completeness rather than as a blocker: if the web origin and API origin are cross-*site* (not merely cross-origin), Safari ITP and third-party-cookie phase-outs can strip cookies from a credentialed cross-site POST issued without recent user interaction.
This is not introduced here, because the load-time refresh is the same cross-site credentialed POST, and the `visibilitychange` path is itself triggered by the operator returning to the tab.
Timer-driven renewal is the only genuinely interaction-free instance, and it is bounded to one request per token lifetime.

---

## 4. Findings

### Finding 1 - Clean-clone deploy simulation: PASS

Covered in section 2. Both the literal Vercel `buildCommand` and the api build succeed from a fresh clone with no build cache.

### Finding 2 - Topology blind spot: NONE FOUND

Covered in section 3. The renewal shares the existing refresh code path exactly, and the API side of the release is empty.

### Finding 3 - No migration is owed: CONFIRMED

`git diff --stat v2.7.1^{}..3c26917 -- apps/api/drizzle/` is **empty**. The migration directory is untouched.

The entire non-documentation surface of this release is four files:

```
CLAUDE.md
apps/web/src/auth/__tests__/react.test.tsx
apps/web/src/auth/__tests__/token.test.ts
apps/web/src/auth/react.tsx
apps/web/src/auth/token.ts
```

There are no changes under `apps/api/` at all, so no server code reads anything new.
Nothing in the diff reads a database column: the only new read is `workspace.workspaceId`, which is a **JWT claim minted by the Hub**, not a column in this product's database.
No migration is owed and none is possible to owe.

### Finding 4 - Cold entry must still redirect: CONFIRMED BY TEST AND BY CODE

**By code.** `sessionLost` starts as `useState(false)`.
In `applyToken`, the discriminator is `const wasSignedIn = typeof lastAppliedToken.current === 'string'`, read before the ref is overwritten.
On a cold entry the ref is still the `undefined` sentinel, so `wasSignedIn` is false and `setSessionLost(false)` runs.
The login effect's new guard is `if (sessionLost && !signInRequested.current) return;`, which therefore does not fire, and the effect proceeds to `captureReturnTo(...)` and `login()` exactly as it did in `v2.7.1`.
This holds however long the boot took to fail: a cold entry that exhausts the transient ladder still never applied a token, so it is still a cold entry.

**By test.** Two dedicated oracles exist, in `apps/web/src/auth/__tests__/react.test.tsx`:

- `still redirects to the Hub when the app is opened with no session` asserts `login` called exactly once and the return-to captured.
- `redirects on a cold entry whose very first read is a transient ladder exhaustion` asserts the same after draining the full ladder.

**By mutation.** I mutated the discriminator in a throwaway clone, forcing `const wasSignedIn = true` so a cold entry reads as a live loss:

```
Tests  7 failed | 656 passed (663)
```

Both cold-entry redirect tests went red, along with five others.
The must-not-break is genuinely pinned, not merely asserted.

I ran three further mutations, all killed:

| Mutation | Tests red | Killed by |
| --- | --- | --- |
| M1 - discriminator forced `true` (cold entry reads as live loss) | 7 | both cold-entry redirect oracles |
| M2 - remove `if (sessionLost && !signInRequested.current) return;` (restores the auto-redirect bug) | 6 | `does not navigate to the Hub when a session is lost while the app is signed in` |
| M3 - `logout()` no longer clears `sessionLost` | 1 | `signs in on the first Entrar click after a Sair inside a live tab` |
| M4 - revert the `workspaceId` claim fix | 5 | workspace-switch and identity-scoped cache tests |

Every deliberate regression I could construct against the three shipped fixes is caught.
M3 is thin at a single test, but see Finding 5: a second, independent guard makes that path safe even if M3 had gone unnoticed.

### Finding 5 - Security review of `v2.7.1^{}..3c26917`

**No secret added.** Grepping added lines for `secret`, `apikey`, `password`, `pk_`, `sk_` and token literals returns only test assertions against `sessionStorage` keys and a `profileToken('Alpha')` test fixture.
No token or credential is logged: there are no added `console.*` calls.

**No new env var.** Grepping added lines for `import.meta.env`, `process.env` and `VITE_` returns nothing. Nothing new must be provisioned before promoting.

**Tenant isolation not weakened.** There are zero API changes, so no `withTenant`, RLS policy or `eq(table.orgId, ...)` filter is touched.
On the web side, the `workspaceId` fix changes which id populates the workspace switcher, which flows to `setActive(workspaceId)` and then to `client.setActive()`.
That id is only a *request*: the Hub validates it against the account's memberships and mints the new access token, and `orgId` is derived from the minted claims rather than from the client-supplied value.
A client cannot escalate through it.
`setActive` also still calls `queryClient.clear()` after the await and before `seed`/`observeToken`, so no cross-tenant cache bleed is introduced.

**Durable logout intent still suppresses auto-login.** `logout()` calls `markLogoutIntent()`, and the login effect still early-returns on `logoutIntent`.
That guard is unchanged.

**The `SignedOutPanel` overlay does NOT leave an authenticated subtree readable after an explicit `Sair`.** This is the sharpest question in the review and it is correctly handled, with two independent guards:

1. `logout()` calls `setSessionLost(false)` in the same synchronous block as `failSession()`, so the loss discriminator never becomes true for a deliberate departure.
2. `liveSessionLoss` is `isLoaded && !isSignedIn && sessionLost && !logoutIntent`, so even if guard 1 regressed, the `!logoutIntent` term still excludes an explicit `Sair`.

And the render order settles it independently of both: in `HubProtected`, `if (logoutIntent)` is checked **first**, at line 785, and returns a bare `<SignedOutPanel />` with **no `children`**.
The `liveSessionLoss` branch that keeps `children` mounted sits after it, at line 813.
So an explicit `Sair` unmounts the protected subtree, and the next person at a shared machine sees nothing of the previous operator's screen.
The children-mounted overlay is reachable only by a genuine live loss, which is exactly the intended scope.

`logout()` additionally calls `queryClient.clear()` synchronously before the first await, and `consumeReturnTo(...)`, both unchanged.

### Finding 6 - Version sanity: `v2.7.2` is defensible, but the release note must not read as "three small bug fixes"

The mechanical check is clean.
The range contains three `fix:` commits, one `test:`, the rest documentation and merges.
There are **zero** `feat:` commits and **zero** `BREAKING CHANGE` footers.
Under SemVer that is a patch.

Judging it rather than just checking it, as asked: **patch understates this release, and I want to say so plainly.**
Two operator-visible changes ship here that a patch label does not lead anyone to expect.

1. The app no longer auto-redirects to the Hub on session loss.
   An operator who has seen the old behaviour for every prior version will now see an overlay saying `Sua sessão expirou` sitting on top of their work, and must click `Entrar`.
   That is the intended fix, and it is better, but it is a change in what the product does, not a silent correction.
2. The workspace switcher will render in production **for the first time ever**.
   `b38bb95` is typed `fix:` because the code always intended to render it and a claim-key bug made it impossible.
   From the operator's seat it is indistinguishable from a new feature appearing.

I would not block the release over the number.
`v2.7.2` is the honest SemVer reading of three bug fixes, and renumbering to `v2.8.0` would be a defensible alternative rather than a correction.
What does matter is that the release note names both behaviour changes explicitly, because an operator reading "patch: three auth fixes" will not anticipate either one.

### Finding 7 - Things that would be discovered painfully in production

I looked specifically for a timer loop, a request storm and a new startup throw.

**No new env var, and no startup path that now throws.** The diff adds no environment read and no module-level side effect. The provider's new work is inside `useMemo` and `useEffect` bodies that all guard `typeof document === 'undefined'`.

**No unbounded timer loop.** This was my main concern, and the guard is real.
`scheduleRenewal()` computes `const delay = expiresAt - SESSION_RENEWAL_LEAD_MS - Date.now()` and then `if (delay <= 0) return;`.
A non-positive delay arms **no** timer.
So a token whose whole remaining life is shorter than the 60s lead terminates the chain rather than immediately re-arming out of its own answer, which is the shape that would otherwise spin.
The renewal is `setTimeout`, never `setInterval`, and each firing clears its own handle before doing anything.

**No request storm on focus.** Three separate mechanisms bound it:

- Re-arm suppression: `if (renewalTimer.current !== null && renewalTarget.current === expiresAt) return;`.
  The token is read roughly 40 times per screen and every read reaches `observeToken` and therefore `scheduleRenewal`, so this guard is load-bearing.
  It is pinned by its own test, `arms exactly one renewal however many times the token is read`, added specifically for this in `1ecc0a4`.
- In-flight coalescing: `renew()` and `getToken()` share `requestRefresh()`, which returns the existing `inFlight` promise rather than issuing a second request.
  Rapid tab switching therefore yields at most one refresh in flight at any moment.
- Failure is bounded: a failed renewal feeds `observeToken(TRANSIENT_TOKEN_RESULT)`, which enters the existing three-rung ladder (`[500, 1500, 4000]` ms) and gives up after four consecutive failures. It does not retry freely.

The renewal is further suppressed entirely while the document is hidden, and for a tab with no session (`if (typeof lastAppliedToken.current !== 'string') return;`), so a signed-out or backgrounded tab generates no traffic at all.

Nine dedicated tests cover this surface, including `does not schedule a renewal while the document is hidden`, `drops a pending renewal when the tab is hidden again`, `does not renew for a tab that is not signed in` and `clears a pending renewal at unmount`.

---

## 5. Production risks the operator should know

None of these blocks the release. All are worth knowing before promoting.

1. **The workspace switcher goes live for the first time.**
   Because `workspaces` was always `[]` in production, the switcher has never rendered and the `setActive` path has never been exercised by a real operator against real claims.
   It is well covered by tests, but this is the one genuinely new runtime surface in the release.
   Worth watching a multi-workspace account switch once after promotion.
   Note the fix is written as `readString(workspace.workspaceId) ?? readString(workspace.id)`, so it is strictly additive: if the Hub claim key were *not* `workspaceId`, the fallback reproduces `v2.7.1` behaviour exactly and nothing regresses. I could not independently confirm the claim key from this repository, because the claim is minted Hub-side and `@fxl-business/hub-sdk@1.3.0` does not type it. The `??` fallback is what makes that unverifiability harmless.

2. **A pre-existing logout race remains open, and this release does not fix it.**
   Filed in `nexo/ROADMAP.md` by the Gate 2 verifier: a token read still in flight when the operator clicks `Sair` can resolve `transient`, schedule a ladder rung about 500ms after `failSession()`, and if that rung obtains a token before `client.logout()` lands server-side, the durable logout intent is cleared and the protected subtree re-mounts.
   It was reproduced byte-identically against `master`, so it is **pre-existing and not introduced here**.
   It is a shared-machine exposure, which is the class of risk `SignedOutPanel` exists to close, so it deserves a follow-up rather than a shrug.

3. **The live-loss overlay leaves data hooks failing underneath it.**
   `children` stay mounted while signed out, so every query below the overlay keeps failing on `AuthTokenUnavailableError`.
   This is bounded (`retry: 1`, and `requireToken` throws before any fetch) and invisible behind the backdrop, but the screen under the panel is in an error state rather than frozen.
   If a wizard is ever rebuilt to reset its own state on a query error, this becomes load-bearing and the overlay would need to suspend the subtree instead.

4. **A transient blip inside the renewal window now surfaces the overlay slightly earlier than before.**
   `renew()` deliberately discards the cached token on failure, so a failed renewal at `exp - 60s` drops a token that still had about a minute of life, then runs the ladder.
   If the Hub is unreachable for longer than the ladder (roughly 6 seconds), the operator sees the session-loss overlay up to a minute sooner than they would have previously.
   This is a clear net improvement, because the old behaviour in that same situation was a full-page navigation that destroyed their work, whereas the overlay preserves it.
   Flagged only so nobody reads an earlier overlay as a new defect.

5. **The CSRF shim is still a single-origin allowlist.**
   `trustedOrigins: [env.CORS_ORIGIN]` is correct today and untouched by this release.
   A preview deployment, a second web host or a custom tenant domain would each need it widened.
   Already recorded in `nexo/ROADMAP.md`.

---

## 6. Summary

The release is sound, and I will say so plainly.

The diff is unusually tight for an auth change: two production source files, both browser-side, no API code, no migration, no new environment variable, no new network request.
All six gate commands pass with a real exit code of 0, the clean-clone Vercel build reproduces, and the four mutations I constructed against the three shipped fixes were all caught by the suite.

The specific failure mode that took `v2.7.0` down is absent here, and absent for a structural reason rather than by luck: the new proactive renewal calls the same `requestRefresh()` closure as the existing refresh, so it cannot differ from it in URL, method, credential mode or headers, and the API-side origin shim it traverses is both unchanged and trigger-agnostic.

The must-not-break holds. A signed-out operator arriving cold still reaches the Hub login, proven by code inspection, by two dedicated tests, and by a mutation that turns both of them red.

**PASS. Tag `v2.7.2` and promote.**
