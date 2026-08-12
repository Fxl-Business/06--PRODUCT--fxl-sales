# Wave verify: feature-20260812-session-survives-one-refresh

**Verdict: PASS**

Integration gate for wave 1, run once on integrated `master` at `1662d67`.
The integrated change is `git diff 5841e86^..HEAD -- apps/`: 11 files, 1602 insertions, 6 deletions.
I wrote none of this code and fixed nothing.

## 1. Gate commands

All four run first-hand, run-once, no watcher.

### `pnpm run lint` - PASS (exit 0)

```
Scope: 4 of 5 workspace projects
packages/shared-types lint: no lint for shared-types
packages/shared-utils lint: no lint for shared-utils
apps/api lint$ eslint src/
apps/web lint$ eslint src/
apps/api lint: Done
apps/web lint: Done
```

### `pnpm run type-check` - PASS (exit 0)

```
packages/shared-types type-check: Done
packages/shared-utils type-check: Done
apps/api type-check$ tsc --noEmit
apps/web type-check$ tsc --noEmit
apps/api type-check: Done
apps/web type-check: Done
EXIT=0
```

### `pnpm test` - PASS (exit 0), 1203 tests over 95 files

```
packages/shared-utils test:  Test Files  3 passed (3)
packages/shared-utils test:       Tests  80 passed (80)
apps/api test:  Test Files  41 passed (41)
apps/api test:       Tests  415 passed (415)
apps/web test:  Test Files  51 passed (51)
apps/web test:       Tests  708 passed (708)
EXIT=0
```

### `pnpm run build` - PASS (exit 0)

Before building I swept `*.tsbuildinfo` outside `node_modules`.
Two existed, both in `packages/` (`packages/shared-types/tsconfig.tsbuildinfo`, `packages/shared-utils/tsconfig.tsbuildinfo`); `apps/web` had none, so nothing there could have made the build vacuous.
I deleted any under `apps/web` anyway before running.
The Vite build really emitted assets:

```
dist/assets/index-BVoG4BbC.js                              253.57 kB │ gzip:  64.10 kB │ map:   920.85 kB
dist/assets/vendor-B7LXPR0Q.js                             412.61 kB │ gzip: 127.11 kB │ map: 1,596.61 kB
✓ built in 1.84s
EXIT=0
```

### Integration suite - NOT RUN

`pnpm --filter @fxl-sales/api test:integration` was not attempted: no local Docker Postgres was confirmed listening, and the brief says to skip it in that case.
Not a finding either way.

## 2. Repo rules

| Rule | Result |
| --- | --- |
| No em dash in `git diff 5841e86^..HEAD -- apps/` | PASS, zero hits |
| No agent attribution / `Co-Authored-By` in `git log 5841e86^..HEAD` | PASS, every commit is `CauetPinciara <cauetpinciara@gmail.com>` as both author and committer, and `%(trailers)` is empty on all 15 |
| `apps/api/src/auth/hub-session-store.ts` unmodified | PASS, `git diff --stat 5841e86^..HEAD -- <that file>` is empty |
| No new dependency, `pnpm patch` or `patchedDependencies` | PASS, `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, both app manifests, `packages/` and `.npmrc` are all untouched by the wave, and neither `patchedDependencies` nor `pnpm patch` appears anywhere in `package.json` or `pnpm-workspace.yaml` |

Three em dashes do exist under `nexo/runs/feature-20260812-.../`, all inside slice verify reports and all of them the reports *quoting their own em dash grep command*.
None is prose. Not a violation.

## 3. Question 1 - do slices 02, 03 and 04 compose?

### The trace

Operator is signed in as admin on `/tatico/dashboard`, wizard half filled.

1. **The loss.** `tokenCache.getToken()` returns the BFF's `401` (`failure: 'session_expired'`), `observeToken` calls `failSession()`, `applyToken(null)` writes `isSignedIn: false` and `roles: []` in one `setProfile` and flips `sessionLost` true.
2. **`HubProtected`.** `logoutIntent` false, `liveSessionLoss` true. It takes the one branch that keeps `children` mounted and lays `SignedOutPanel` ("Sua sessão expirou") over them in a `fixed inset-0` overlay.
3. **`SalesOpsApp`, still mounted (slice 02).** `rolesAreAuthoritative = profile.isSignedIn` is `false`, so *both* early returns are suppressed. The URL stays `/tatico/dashboard`. This is the load-bearing part: each `Navigate` is an unmount, and the second guard matters as much as the first, because with `roles === []` every URL resolves `redirect: true` on the `getDefaultSalesOpsRoute` fallback.
4. **`HubProtected`'s login effect.** Guards pass down to `if (sessionLost && !signInRequested.current) return;`, which returns. Nothing is captured, no attempt is spent, no navigation happens.
5. **`Entrar`.** `clearLoginAttempts()`, `signInRequested.current = true`, `recheckRecoveryGuards()`. The effect re-runs on `guardTick`, `registerLoginAttempt()` succeeds, and `captureReturnTo('/tatico/dashboard', origin)` runs.
6. **`sanitizeReturnTo` (slice 03).** `/tatico/dashboard` is not `/`, not `/auth*`, not a terminal route. Stored. Slice 03 is inert here *because* slice 02 kept `/no-role` out of the URL; it is the belt to slice 02's braces, not a competing mechanism.
7. **`login()`** is `window.location.assign` to the Hub. Document dies. `sessionStorage` survives.
8. **Re-login lands at `/`.** Fresh `AppAuthProvider`, good token, `isSignedIn` true, roles restored. `HubProtected`'s restore effect calls `consumeReturnTo()` -> `/tatico/dashboard`, which differs from `/`, so it navigates there with `replace`.
9. **`SalesOpsApp` at `/tatico/dashboard`.** `rolesAreAuthoritative` true, one visible workspace or more, `resolution.redirect` false. Renders. **The operator is exactly where they were.**
10. **`NoRoleGuard` (slice 04)** never entered the story, because the route never became `/no-role`.

### I proved it rather than only arguing it

The repo has no test for the composed round trip: slice 02's harness stops at the `Entrar` click, and it stubs the `/no-role` route with a plain `<div>` rather than the real `NoRoleGuard`.
So I built a throwaway on top of slice 02's own harness (real `AppAuthProvider`, real `HubProtected`, real `SalesOpsApp`, real `NoRoleGuard`), driving the loss, the click, an unmount modelling the full-page Hub navigation, and a remount at `/`.
Five scenarios, all green:

```
✓ src/sales-ops/__tests__/wave-verify-roundtrip.test.tsx (5 tests) 51ms
  Test Files  1 passed (1)
       Tests  5 passed (5)
```

- live loss on `/tatico/dashboard`, `Entrar`, successful re-login lands back on `/tatico/dashboard` (and `RETURN_TO_KEY` is consumed exactly once)
- a re-login that comes back with **no** roles lands on `/no-role` and stays there
- the real `NoRoleGuard` stays inert while the session-loss overlay is up on `/no-role`, and does not navigate
- a role-less operator clicking `Entrar` on `/no-role` stores nothing, because slice 03 refuses it
- an entitled operator mounting on `/no-role` is sent to `/tatico/dashboard`

The file was deleted after the run; `git status` is back to its starting state.

### Other composed states I checked

| State | Outcome |
| --- | --- |
| Entitled operator, session loss on `/cadastros/vendedores` | Alias rewrite is suppressed while signed out, so `/cadastros/vendedores` is captured. After login the restore lands there and `SalesOpsApp` then rewrites to `/cadastros/pessoas`. One extra hop, correct destination. |
| Re-login returns *fewer* roles than before | Restore goes to `/tatico/dashboard`, `SalesOpsApp` sends to `/no-role`, `NoRoleGuard` agrees and renders the page. Settles, no loop. Proven by test 2 above. |
| Role-less operator, session loss on `/no-role` | `NoRoleGuard` is inert (`getVisibleWorkspaces([]).length === 0`), page stays mounted under the overlay, `Entrar` stores nothing, re-login lands at `/` and `SalesOpsApp` routes to `/no-role`. Correct. Proven by tests 3 and 4. |
| A role the app does not recognize | `NoRoleGuard` and `SalesOpsApp` both decline to navigate. No ping-pong. |
| Cold entry on `/no-role` while signed out | `sessionLost` is false, so the login effect runs normally; slice 03 refuses to store `/no-role`, the operator lands at `/` after callback and is routed from there. No strand. |

**No stranded, looped or silently-relocated state found.**
The structural reason a loop is impossible is that `NoRoleGuard`'s condition is the literal complement of `SalesOpsApp`'s, evaluated by the same `getVisibleWorkspaces` over the same `useAuthProfile()` value, so at most one of the two can ever want to navigate.

## 4. Question 2 - did any test start passing for the wrong reason?

**No.** I mutation-tested each slice's oracle against the *integrated* tree.

**Probe A - revert slice 02** (`rolesAreAuthoritative = true`):

```
✓ src/__tests__/no-role-redirect.test.tsx (26 tests) 41ms
  × keeps the URL on the route the operator was on instead of rewriting it to /no-role
  × keeps the Sales Ops shell and its own component state mounted underneath the overlay
  × captures the route the operator was on when the operator clicks Entrar
  ✓ still redirects a signed-in operator with no visible workspaces to /no-role
  ✓ still rewrites the legacy cadastros alias for a signed-in operator
  Tests  3 failed | 28 passed (31)
```

Slice 02's oracle is live, and slice 04's 26 tests are **unaffected** by slice 02 either way, so slice 02 cannot have propped them up.

**Probe B - weaken slice 04 to `roles.length > 0`, with slice 02 present** (the exact over-correction slice 04's commit message names):

```
× keeps the unauthorized screen for a role the app does not recognize, and does not ping-pong
  → redirect loop: /no-role -> / -> /no-role -> / -> /no-role -> / -> /no-role
Tests  2 failed | 24 passed (26)
```

This is the specific concern the brief raised, and the answer is clean: slice 02 did **not** disarm slice 04's ping-pong oracle.
The reason is visible in the harness - `no-role-redirect.test.tsx` mocks `useAuthProfile` with `isSignedIn: profileLoaded`, and every navigating case sets `profileLoaded = true`, so `rolesAreAuthoritative` is `true` throughout and slice 02's guard is transparent to those tests.

**Probe C - remove slice 03's `isTerminalAuthRoute` check**: 11 tests red, including all eight spelling variants (`/no-role/`, `/no-role//`, `/no-role?x=1`, `/NO-ROLE`, `/%6Eo-role`, ...), the dot-segment case and both storage round-trip cases.

**Probe D - remove slice 01's `fetchImpl` line**: 7 tests red in `app-auth-bff-wiring.test.ts`, including both rotation oracles and `hands createHubBff a wrapped fetchImpl rather than the bare global fetch`.

Every source file was restored with `git checkout --` immediately after each probe, and `git diff HEAD -- apps/` is empty.

## 5. Question 3 - is the API change safe in local-dev cookie mode?

**Yes.** In dev the Hub sends the unprefixed `fxl_hub_session=`, which `PREFIXED_ROTATED_COOKIE` (`/^__Host-fxl_hub_session=/`, anchored and exact) cannot match, so `changed` stays `false` and the wrapper returns **the original `Response` object**: no `Headers` copy, no `Response` allocation, no body move, no observable difference. The same holds for a response with no `Set-Cookie` at all, which is every non-rotation backchannel call.

Two tests pin this directly: `leaves an already unprefixed fxl_hub_session alone` and `returns the original Response object untouched when nothing matched`, plus the end-to-end `still persists the rotated refresh token when the Hub sends the unprefixed fxl_hub_session` driving the real SDK handler.

One caveat a future reader should not misread. That end-to-end dev test goes **red** under probe D, which looks like "dev mode depends on the wrapper". It does not. `createAppAuthBff()` runs in `beforeAll`, `stubHub` does `vi.stubGlobal('fetch', ...)` per test, and `createHubBff` without `fetchImpl` captures the ambient `fetch` at construction time. The wrapper resolves `globalThis.fetch` per call, which is what keeps the stub reachable. The redness is a harness artifact of removing the seam, not a behavioural claim about the dev cookie. Filed as a follow-up note below.

The load-time `assertSetCookieSupport()` is satisfied on the Node 20 floor (root `engines`, `apps/api/Dockerfile`), and the whole 415-test API suite imports this module without tripping it.

## 6. Security review of the integrated diff

### Can the rotated refresh token leak to the browser or a log?

**No.**

- **To the browser:** the wrapper is wired only as `fetchImpl`, the BFF's outbound backchannel client. It never touches the BFF's own response. `app-auth-bff-wiring.test.ts` asserts this behaviourally with `does not leak the Hub Set-Cookie headers to the browser`, driving a real `/auth/refresh` through the real SDK router with `HUB_ROTATION_PROD` set and checking `res.headers.getSetCookie()` is `[]`.
- **The rewrite direction is correct and narrow.** It strips `__Host-` only on the *inbound* Hub cookie, never on the browser-facing cookie whose name comes from `secureCookies`. Stripping the prefix there would drop a real security attribute; the module's header calls this out explicitly and the regex cannot reach it.
- **To a log:** zero `console.*` / `logger.*` statements are added anywhere in the diff. Both throw sites in `hub-rotated-cookie.ts` carry static messages containing no cookie, no value and no session id. The pre-existing `console.error(err)` in `hubBffErrorHandler` receives an SDK error, not the response.
- **Matching is anchored and exact.** `^__Host-fxl_hub_session=` deliberately misses `__Secure-fxl_hub_session=`, `__Host-fxl_hub_session_v2=`, `x__Host-fxl_hub_session=` and `fxl_hub_login=`, each pinned by a test. Per-cookie via `getSetCookie()`, so a comma inside another cookie's `Expires` cannot cause a cross-cookie mis-parse.
- **No silent degradation.** A missing `getSetCookie` throws rather than returning `[]`, which the SDK converts to a `503` with the stored session untouched. Failing loud beats silently reinstating the write loss.

### Is `sanitizeReturnTo` still sound?

**Yes, and it is strictly stronger than before.**

The added line is `if (isTerminalAuthRoute(url.pathname)) return null;`. It sits in the post-normalization block beside checks 7 and 9, and there is no `return normalized` anywhere above it - every earlier exit returns `null`. So the new check can only ever **reject more**; it is structurally incapable of admitting a value the previous version rejected, which is the only way it could introduce an open-redirect bypass.

Placement is right. Asserting on the raw input would be bypassed by one dot segment (`/foo/../no-role`), exactly the class of bug check 7 exists for. `never returns a value that resolves off-origin` still passes over the full rejection corpus.

I looked for an *under*-block that could let `/no-role` through in a spelling React Router still matches, and found none:

- percent-decoding is per segment with `/` re-encoded, mirroring `decodePath` in `@remix-run/router`, so `/%6Eo-role` is caught and an encoded slash cannot manufacture a segment boundary
- case-insensitive with `toLowerCase` (not locale-dependent), matching `compilePath`'s `i` flag
- trailing slashes stripped, matching `compilePath`'s `\/*$`
- a malformed escape (`/no-role%`) falls back to the undecoded value, which is the *same* fallback `decodePath` makes, so the router does not match `/no-role` there either - consistent, not a hole
- `%2E%2E` dot segments resolve before the check and land on `/`, which check 9 rejects anyway

I also checked the over-block direction: the list is exactly `['/no-role']`, `/admin/*`, `/finder/*` and `/seller/*` are deliberately not members, so no legitimate restore is stranded.

### New secrets, credentials or realistic-looking values?

**None.** Every added fixture is obviously synthetic: `RT1` / `RT2` / `AT2` for tokens, `session-alpha` for a session id, `unit-test-hub-secret-key-0123456789abcdef`, `pk_fxl-sales_unit-test-publishable-key`. No JWT-shaped blob, no `sk_`, no bearer literal, no real key. Slice 03's storage tests hold only relative paths and a counter, so CLAUDE.md's "browser Hub access tokens are memory-only" is untouched.

### Dependencies and patches

None added, none changed, no `patchedDependencies`. The fix goes through `fetchImpl`, a documented SDK option, which is the right call given this workspace deleted its `pnpm patch` once already.

## 7. Follow-ups (none of these block the gate)

1. **Promote the composed round trip to a permanent test.** Nothing in the repo covers loss -> `Entrar` -> re-login -> land back on the original route. Slice 02's harness stops at the click and slice 04's mounts no provider. My throwaway proved it green, but it is gone; a regression in the restore effect or in `sanitizeReturnTo` would now be caught only by three separate tests that each see one third of the path.
2. **Use the real `NoRoleGuard` in `session-loss-keeps-route.test.tsx`.** That harness stubs the `/no-role` route with a plain `<div>`, so the guard's inertness during a live loss is currently asserted only by a doc comment. It is genuinely inert - I verified it - but the test could say so.
3. **Add a comment to the unprefixed-cookie test** noting that its redness under a `fetchImpl` removal comes from construction-time `fetch` capture, not from the dev path needing the wrapper. Without it, a future reader may conclude local dev depends on the shim.
4. **`console.error(err)` in `hubBffErrorHandler` is broad.** Pre-existing, no leak today, but it is the one place a future SDK error carrying response headers would reach a log. Worth a redaction pass whenever that file is next touched.
5. **Delete `hub-rotated-cookie.ts` when the SDK is fixed.** The module already carries its own deletion signal: `proves the rotation is genuinely lost without the wrapper` goes red when upstream accepts `(?:__Host-)?`. Already filed in `nexo/ROADMAP.md`; noting it so the wave record carries it too.

No bundle impact from slice 04: `RoleGuard.tsx` now imports `@/sales-ops/navigation`, but `router.tsx` already imports `SalesOpsApp` eagerly at line 11, so the module was in the eager graph before this wave.

## 8. Tree state

Left as found. `git status` shows only the pre-existing `M nexo/runs/feature-20260812-.../budget.json` and untracked `.vscode/`, neither of them mine, plus this report and the result JSON. `git diff HEAD -- apps/` is empty: every mutation probe was reverted and the throwaway test was deleted. Build artifacts under `dist/` were regenerated by the gate build.
