# VERDICT: PASS

Slice `03-refresh-failure-classification`, commit `f10668c` on `feat/03-refresh-failure-classification`, verified against `master`.
Every acceptance clause is proven by a live oracle, every commanded gate is green, and all six mutations went red exactly where they had to.
No file was left mutated; the working tree is byte-identical to how it was found.

## 1. Command results

| Command | Result | Detail |
| --- | --- | --- |
| `pnpm run type-check` | PASS (exit 0) | all packages |
| `pnpm run lint` | PASS (exit 0) | `apps/api` and `apps/web`, no warnings emitted |
| `pnpm test` | PASS (exit 0) | shared-utils 80/80, api 375/375, web 633/633; `build-contract: ok` |
| `pnpm run build` | PASS (exit 0) | web bundle built in 1.78s |
| `pnpm --filter @fxl-sales/api test:integration` | PASS (exit 0) | 24 files, 161 tests, against the local Docker DB |

Slice-01 precondition re-checked independently rather than taken on trust.
`apps/api/node_modules/@fxl-business/hub-sdk/package.json` reports `1.3.0`, and `grep -c refresh_unavailable dist/server.js` prints `4`, so the installed BFF really does classify.
`dist/server.js:416` mounts `app.post("/auth/refresh", ...)` and returns `401 no_session` at `:420`/`:426`, `401 session_expired` at `:452`, and `502 invalid_refresh_response` at `:454`/`:461`.
The hazard in plan section 1.4 (a 1.2.0 BFF answering `401` for everything) is therefore not present.

## 2. Mutation results

All mutations were applied with a script that asserts the target text exists first, so a silent no-op mutation was impossible.
Each was reverted with `git checkout -- <file>` and the revert confirmed by `git status`.

| # | Mutation | Expected | Observed | Reverted |
| --- | --- | --- | --- | --- |
| M1 | `refresh.ts:76` non-200 branch returns `session_expired` instead of `TRANSIENT_TOKEN_RESULT` (a 503 becomes permanent) | `classifies a transient status as transient so the session survives a Hub outage` goes red | RED, 5 failed / 10 passed; all five statuses (503, 502, 500, 429, 418) reported `session_expired` where `transient` was expected | yes, clean |
| M2 | `react.tsx:268` branch widened to `=== 'session_expired' \|\| === 'transient'` (a transient failure tears the session down) | `keeps the session and enters the ladder when a refresh is transiently unavailable` goes red | RED, 7 failed / 20 passed, including that named oracle plus the cold-start hold, the ladder-reset pin, both unmount tests and the route-restore test | yes, clean |
| M3a | `refresh.ts:73` returns `TRANSIENT_TOKEN_RESULT` for a 401 | `classifies every 401 as session_expired, whichever body the BFF sends` goes red | RED, 3 failed / 12 passed; all three bodies (`session_expired`, `no_session`, empty) | yes, clean |
| M3b | `react.tsx:268-271` `session_expired` branch deleted, so a 401 falls through into `scheduleRevalidate()` | `signs out at once when the BFF says the session expired, without entering the ladder` goes red | RED, 7 failed / 20 passed, including that oracle and `signs out at cold start when the BFF says the session expired` | yes, clean |
| M4 | `react.tsx:247` `revalidateAttempts.current = 0;` deleted from the recovery branch (counter becomes a lifetime total) | `resets the ladder after each recovery, so unrelated blips never accumulate` goes red | RED, and it was the ONLY failure: 1 failed / 26 passed, `expected { blip: 3, profile: 'signed-out:' } to deeply equal { blip: 3, profile: 'signed-in:Alpha' }` | yes, clean |
| M5 | `react.tsx` 401 branch calls `failSession(); scheduleRevalidate();` (signs out correctly BUT schedules a rung) | only the `vi.getTimerCount()` assertion can catch it | RED, 2 failed / 25 passed, both failures `expected 1 to be +0` at `react.test.tsx:541` and `:609`, which are exactly the two `expect(vi.getTimerCount()).toBe(0)` lines | yes, clean |
| M6 | `app-auth-bff-wiring.test.ts` asks the real BFF for `/auth/refreshMOVED` instead of `/auth/refresh` (simulating an SDK path move) | the real-SDK contract pin goes red | RED, `expected 404 to be 401`, 1 failed / 10 passed | yes, clean |

M5 is the one that matters most for check 3 and it is not in the brief.
I added it because M3b makes the profile text wrong as well, so it does not isolate the timer oracle.
M5 leaves `profileText` at the correct `'signed-out:'` and the call count at the correct 2, so `vi.getTimerCount()` is the only assertion left standing, and it fired.
The oracle is live, not decorative.

## 3. Findings against checks 1-8

### Check 1 - non-vacuity by mutation: PASS

Covered by M1/M2 (a 503 made permanent) and M3a/M3b (a 401 made transient).
Note that the classification chain is split across two modules by design, so each half needed its own mutation.
`refresh.ts` maps status to verdict and is pinned by `apps/web/src/auth/__tests__/refresh.test.ts`.
`react.tsx` maps verdict to behaviour and is pinned by `apps/web/src/auth/__tests__/react.test.tsx`, which mocks the cache and therefore never executes `refresh.ts`.
Mutating only one side would have left the other's oracle green, which is why both were mutated.
The seam between them is not left unpinned: `react.test.tsx:327` (`wires the token cache to the BFF refresh endpoint at the same base path as the SDK client`) pulls the refresher back out of `createHubAccessTokenCache.mock.calls[0][0]`, invokes it, and asserts it lands in `requestHubAccessToken` with the same `bffBasePath` that `createHubClient` received.
So "the provider's refresher is the classifier" is itself an assertion, and the discriminated union `HubTokenResult` plus a clean `type-check` closes the type side.

### Check 2 - the consecutive-failure reset: PASS, and the pin is live

The pin is `apps/web/src/auth/__tests__/react.test.tsx:651`, `resets the ladder after each recovery, so unrelated blips never accumulate`.
It is present, green, and NOT weakened.
The whole-file diff for that test against `master` is exactly three lines, and all three are mocked-value shape changes required by the new type:
`mockResolvedValueOnce(token)` to `mockResolvedValueOnce(ok(token))`, and `mockResolvedValueOnce(null).mockResolvedValueOnce(token)` to `mockResolvedValueOnce(transient).mockResolvedValueOnce(ok(token))`.
Its loop bound (`SESSION_REVALIDATE_DELAYS_MS.length + 1` blips), its per-blip `advance`, its per-blip profile assertion, its `login` assertion, its location assertion and its final `toHaveBeenCalledTimes(1 + blips * 2)` call-count assertion are all character-identical to `master`.
That last call count is what stops the loop degenerating into a no-op, and it survived.

M4 proves the pin is not dormant.
Deleting `revalidateAttempts.current = 0;` from the recovery branch turned exactly one test red out of 27 in that file, and it was this one.
That is the same one-of-N signature CLAUDE.md records for the produto-dialog activation-behaviour invariant, and it is the correct shape for a pin of this class.

`react.tsx` keeps two resets and both are intact: `failSession()` at `:219` and the recovery branch at `:247`.
The slice's own diff touches neither line.

### Check 3 - does a 401 schedule no timer: PASS

`grep -n "setTimeout\|setInterval\|requestAnimationFrame\|queueMicrotask" apps/web/src/auth/react.tsx` returns exactly two hits: `:168`, the `useRef` type annotation, and `:233`, the ladder's own `setTimeout`.
The ladder is genuinely the only scheduler in the file, so `vi.getTimerCount() === 0` measures the right thing.
`useLadderTimers()` fakes only `setTimeout`/`clearTimeout`, leaving React's scheduler and `Date` real, and the tests assert exact counts of `0` and `1` rather than "at most", which they could not do if anything else in the mounted tree were scheduling under the faked timer.
M5 then proved the assertion is sensitive to a single extra rung.

### Check 4 - classification reads the status, never the body: PASS

`apps/web/src/auth/refresh.ts:73` is `if (res.status === 401) return { token: null, failure: 'session_expired' };`.
The response body is not read at all before that line, and after it the body is read only at `:78` on the 200 path to extract the token.
There is no string comparison against `session_expired` or `no_session` anywhere in the module.
The pin is `refresh.test.ts:11-30`, an `it.each` over `{error:'session_expired'}`, `{error:'no_session'}` and `{}`, all three of which must resolve to the same verdict.
M3a turned all three red together, which is the correct signature for a status-keyed rule.
I confirmed against the installed SDK that both bodies really exist: `dist/server.js:420`/`:426`/`:474`/`:485` emit `no_session` and `:452`/`:513` emit `session_expired`, both at `401`.
Note that the SDK's `PERMANENT_REFRESH_CODES` at `:280` also contains `no_session`, which is consistent.

### Check 5 - the real-SDK contract pin (plan-check N2): PASS

It exists at `apps/api/src/middleware/__tests__/app-auth-bff-wiring.test.ts:276-328`, in `describe('the SDK BFF route contract apps/web/src/auth/refresh.ts is coupled to')`.
It genuinely exercises the SDK router rather than a fake, on three counts I checked individually.

1. `realBff()` obtains `createHubBff` through `vi.importActual('@fxl-business/hub-sdk/server')` at `:294`, which bypasses even this file's own `vi.doMock` spy at `:85` (and that spy is itself a pass-through to `actual.createHubBff`, not a stub).
2. It hands the real `InMemoryHubSessionStore` imported from the package root, which the SDK's `assertModernSessionStore` would reject were it a stand-in.
3. It asserts a NEGATIVE as well as a positive: `POST /auth/refreshx` must answer `404`, which is what rules out a catch-all satisfying the `401`.

M6 confirms it is not vacuous.
Pointing the same request at `/auth/refreshMOVED` produced `404`, so a future SDK path move fails this test loudly instead of leaving `apps/web` to 404 silently.
Its placement in `apps/api` rather than beside `refresh.test.ts` is justified in the test's own header comment (`hono` is not resolvable from `apps/web`), and the placement is expressly permitted by plan section 6.1.7.
The web-side literal pin (`refresh.test.ts:83`, `posts to the BFF refresh endpoint with credentials included`) still exists and still covers the request shape including the empty-base-path case.

### Check 6 - `hasSessionRef` fully deleted: PASS

`grep -rn hasSessionRef` over all `*.ts`/`*.tsx`/`*.md` outside `nexo/` returns nothing.
Inside `nexo/` the only hits are plan and run prose, which is expected and correct.
The diff removes all four sites named by plan section 2.4: the declaration and its doc comment at old `react.tsx:157-158`, the write in `failSession`, and the write in `observeToken`'s live-token branch.
The two comments that merely NAMED it (above `failSession()` inside `logout()`, and on the mount effect's `.catch`) were rewritten rather than left lying, so no stale reference survives.
Slice 05 can rely on its absence.
For that slice's benefit: `lastAppliedToken` at `react.tsx:166` is intact, still `useRef<string | null | undefined>(undefined)` with the `undefined` sentinel, and `applyToken`'s early return at `:188` is unchanged.

### Check 7 - slice 04 not disturbed: PASS

`markLogoutIntent()` is at `react.tsx:317` and is the FIRST statement of `logout()`, above `operationGeneration.current += 1`, `tokenCache.clear()`, `failSession()`, `clearLoginAttempts()` and `consumeReturnTo()`.
The only `await` in that function is `await client.logout()` at `:334`, so the intent is still written before any suspension point.
Its full doc comment survives verbatim.
`clearLogoutIntent()` is still in `observeToken`'s live-token branch at `:259`, with its "BACKSTOP" comment intact, and it is still NOT inside `applyToken`.
`hasLogoutIntent()` still gates the login effect: `logoutIntent` is derived at `:453` and appears in the effect guard at `:485` and in the `SignedOutPanel` render guard at `:502`, ahead of `loginBlocked`.
`apps/web/src/auth/session-recovery.ts` is not in the diff at all.
All seven tests in `describe('explicit logout intent')` pass.
Their diff against `master` is confined to mocked-value shapes: `profileToken('Alpha')` became `ok(profileToken('Alpha'))`, and `null` became `expired`.
`expired` is the faithful translation there, since every one of those tests is modelling a dead session reached after a sign-out, and using `transient` would have held `isLoaded` at `false` and never rendered the panel.
No assertion in that block was touched.

### Check 8 - scope: PASS

The full changed-file list is `CLAUDE.md`, `nexo/ROADMAP.md`, `nexo/runs/.../notes-03.md`, `apps/api/src/middleware/__tests__/app-auth-bff-wiring.test.ts`, and the six `apps/web/src/auth` files the plan's `files_modified` names.
No production file under `apps/api/src/**` is touched; the only API change is the added test block.
No `queryClient`, `QueryClientProvider` or `App.tsx` edit appears anywhere in the diff, so slice 05's territory is untouched.
The Hub BFF session store is untouched: `apps/api/src/auth/hub-session-store.ts` and `app-auth.ts` are not in the diff, and the single `new InMemoryHubSessionStore()` the diff introduces is local to the new test's own throwaway BFF.

On "supersede behaviour", one nuance worth stating rather than glossing.
The generation guard in `token.ts` is unchanged in its DETECTION: `generation !== refreshGeneration` at `:63`, and `seed`/`clear` still each bump `generation` and null `inFlight`.
What the slice adds inside that branch is what a superseded refresh REPORTS, at `:67-68`: it re-reads the cache and, finding nothing fresh, returns `TRANSIENT_TOKEN_RESULT` rather than passing a `session_expired` through.
That is mandated by plan section 4.2 and is the correct rule, since a late answer is not a verdict on the session that replaced it.
It is pinned by the new `token.test.ts:161`, `reports a superseded refresh as transient, never as an expired session`.
I read this as within scope rather than a violation: the supersede decision itself is untouched, only the classification carried out of it is new, and the classification is this slice's whole subject.

## 4. Acceptance clause, mapped to oracles

> given the provider holds a signed-in session, a 401 from `/auth/refresh` signs the operator out on that single response with no revalidation timer ever scheduled

`react.test.tsx:525`, `signs out at once when the BFF says the session expired, without entering the ladder`.
Mounts signed in, resolves the probe read to `expired`, and asserts with NO timer advance that the profile is `'signed-out:'`, `vi.getTimerCount()` is `0`, and the cache was read exactly twice.
Killed by M3b and by M5.
The 401-to-`expired` half is `refresh.test.ts:11`, killed by M3a.

> while a 503 or a 502 preserves the session and is retried on the unchanged `SESSION_REVALIDATE_DELAYS_MS` ladder

`react.test.tsx:546`, `keeps the session and enters the ladder when a refresh is transiently unavailable`: still `'signed-in:Alpha'`, `login` not called, `getTimerCount()` is `1`, and after one rung the recovery brings it back to `0`.
Killed by M2.
The 503/502-to-`transient` half is `refresh.test.ts:32`, an `it.each` over `[503, 502, 500, 429, 418]`, killed by M1.
`SESSION_REVALIDATE_DELAYS_MS` is textually unchanged at `[500, 1_500, 4_000]`; only its doc comment was rewritten.

> whose consecutive-failure counter still resets on every recovery

`react.test.tsx:651`, unweakened and killed by M4 alone out of 27 tests in the file.

The cold-start half of the design (plan section 2.4) is additionally covered by `holds a cold start on a transient failure instead of signing out` and `signs out at cold start when the BFF says the session expired`, both of which also assert the timer count.

## 5. Green, but worth recording

None of these is a defect and none affects the verdict.

**5.1 No single test walks a real HTTP 401 through to a sign-out.**
The chain is proven in two halves that meet at `HubTokenResult`, joined by the wiring test described under check 1 and by the type checker.
That is a deliberate and reasonable seam given `react.test.tsx` mocks the cache, but it does mean the end-to-end claim rests on composition rather than on one observation.
I judged the composition adequately pinned; a future slice that changes the refresher's identity in the provider would need to keep `react.test.tsx:327` honest.

**5.2 A proxy-issued non-401 now costs a cold-start visitor about six seconds of Skeleton.**
This is plan risk R2, accepted there.
It is a real behaviour change for anyone behind a CDN that rewrites the BFF's `401`, and it is not observable from any test because no test models a rewriting proxy.
The bound is the ladder, and the terminal state is exactly today's, which `holds a cold start on a transient failure instead of signing out` does prove.

**5.3 A ladder can now start after an explicit `Sair`.**
Plan risk R4, and the reasoning holds: `applyToken(null)` is idempotent through `lastAppliedToken`, the unmount effect clears the timer, and slice 04's durable intent plus the `SignedOutPanel` guard own the UI outcome.
Worth noting only because nothing tests it directly.

**5.4 `vi.getTimerCount()` is a global count, not a per-module one.**
`useLadderTimers()` fakes `setTimeout`/`clearTimeout` process-wide, so in principle a future dependency scheduling a timeout inside the mounted tree would pollute the oracle.
Empirically it does not today: the assertions are exact equalities against `0` and `1` and they pass, and M5 showed a single extra rung moves the number.
If a component that debounces is ever added under `AppAuthProvider` in these tests, this oracle will need re-checking.

**5.5 `refresh.test.ts` covers `418` as transient.**
Fine and deliberate, but it is worth being explicit that the rule is "everything that is not 401 and not 200 is transient", so a `403` or a `404` also enters the ladder.
That is exactly what makes an SDK path move a six-second delay rather than an instant sign-out, which is why the real-SDK pin from check 5 matters as much as it does.

## 6. Working tree

Restored exactly as found.
`git status --short` reports only what was there before verification began: the pre-existing modification to `nexo/runs/.../budget.json`, the untracked `.vscode/`, and the untracked `agents/exec-03.result.json`.
No source file under `apps/` or `packages/` differs from `HEAD`.
The full auth surface plus `blank-bearer-token.test.tsx` was re-run after the last revert: 7 files, 119 tests, all passing, and the API wiring file 11/11.
No dev server, watcher or background process was left running.
