# Slice 03 - refresh failure classification, working notes

## Guard, first action

`grep -c refresh_unavailable apps/api/node_modules/@fxl-business/hub-sdk/dist/server.js` printed `4`.
Slice 01 has landed and the installed BFF really does classify, so the hazard in plan section 1.4 (shipping onto a 1.2.0 BFF that answers `401` for every failure) does not apply.

## What changed

`apps/web/src/auth/refresh.ts` (new)

- `HubRefreshFailure`, `HubTokenResult`, `TRANSIENT_TOKEN_RESULT`, `requestHubAccessToken(bffBasePath, fetchImpl?)`, verbatim from plan section 3.
- The header comment gained one sentence naming the API-side contract pin as the second half of the drift guard.

`apps/web/src/auth/token.ts`

- `createHubAccessTokenCache` now takes `refresh: () => Promise<HubTokenResult>` instead of `Pick<HubClient, 'getToken'>`.
  The `import type { HubClient }` is gone.
- `getToken` returns `Promise<HubTokenResult>`; `inFlight` is `Promise<HubTokenResult> | null`; a cache hit resolves `{ token: freshToken }`.
- The superseded-generation branch resolves `TRANSIENT_TOKEN_RESULT` rather than the late result, so a `clear()` or `seed()` racing a dying refresh can never report `session_expired`.
- `seed`, `clear`, `readFreshToken`, `discardCachedToken`, `readJwtExpiry`, `readServerExpiry` are byte-identical.

`apps/web/src/auth/react.tsx`

- One `bffBasePath = useMemo(() => getHubBffBasePath(import.meta.env), [])` now feeds both `createHubClient` and `createHubAccessTokenCache(() => requestHubAccessToken(bffBasePath))`.
- `hasSessionRef` is fully deleted: declaration, doc comment, the write in `observeToken`, the write in `failSession`.
  Nothing reads it anywhere in the repo any more (grepped).
- `observeToken(result: HubTokenResult)` with three branches: live token, `session_expired` to `failSession()`, everything else to `scheduleRevalidate()`.
- `scheduleRevalidate`'s rung rejects into `observeToken(TRANSIENT_TOKEN_RESULT)`; the mount effect's `.catch` does the same.
- `setActive` passes `observeToken({ token: result.accessToken })`.
- The public `getToken` still returns `Promise<string | null>`.
- The `SESSION_REVALIDATE_DELAYS_MS` doc comment was rewritten per plan section 5.10.
- Two comments that named `hasSessionRef` were rewritten rather than left lying: the one above `failSession()` inside `logout()`, and the one on the mount effect's `.catch`.
  No other statement in `logout()` moved, and `markLogoutIntent()` is still its first statement.

`apps/api/src/middleware/__tests__/app-auth-bff-wiring.test.ts`

- One new describe block, the plan-check N2 real-SDK contract pin.
  Two cases: a cookieless `POST /auth/refresh` against a genuine `createHubBff(config, {sessionStore: new InMemoryHubSessionStore()})` answers `401`, and `POST /auth/refreshx` answers `404`.
  The second is load-bearing: without it the first would also be satisfied by a catch-all, so the pin would prove nothing about the path itself.

`CLAUDE.md` "Auth Model" and `nexo/ROADMAP.md` per plan section 7.

## Deviation from the plan, and why

**The N2 contract pin lives in `apps/api`, not `apps/web`.**
The plan's section 6.1.7 permits this ("Put it beside the slice 01 wiring tests if the environments differ") and it turned out to be forced: `hono` is not resolvable from `apps/web`, so `@fxl-business/hub-sdk/server` cannot be imported there.
Adding `hono` as a web devDependency to host one test would put a server framework in the browser package's dependency graph.
So this slice does touch one file under `apps/api/**`, contradicting the plan's own opening line - a test file only, no production API code.
The reason is written into the test's doc comment so it does not have to be rediscovered.

**The drift-guard test stubs `VITE_AUTH_BFF_BASE_PATH`, not `VITE_API_URL`.**
The plan said `VITE_API_URL`, and that silently produced `''`: `getHubBffBasePath` reads `env.VITE_AUTH_BFF_BASE_PATH ?? env.VITE_API_URL ?? ''`, and the shipped `.env` defines `VITE_AUTH_BFF_BASE_PATH` as the empty string, which `??` does not fall through.
Stubbing the var that is actually read is what makes the assertion non-trivial.

**Two logout-intent tests moved from `null` to `expired` rather than `transient`.**
`keeps the return-to slot empty across a remount after an explicit sign-out`, `does not auto-login while the logout intent is set`, `resets the URL to the default route while the logout intent is set` and `clears the intent and re-arms the login effect when the operator clicks Entrar` all assert the `SignedOutPanel` copy.
`logoutIntent` is gated on `isLoaded`, and a cold-start `transient` holds `isLoaded` at false for six seconds, so those would have asserted against a Skeleton.
`expired` is also the realistic state after a `Sair`: the session really was destroyed.
This is the same reasoning the plan already applied to `stops re-logging in and offers a manual retry after repeated failures`.

## Test evidence

RED confirmed before any production edit.

- `refresh.test.ts` failed to collect at all (`Failed to load url ../refresh`).
- `token.test.ts` + `react.test.tsx`: 35 failed, 2 passed.
  The four new `react.test.tsx` cases failed on their stated assertions - `expected 'loading' to be 'signed-in:Alpha'`, `token reader never became ready`, `expected 'loading' to be 'signed-out:'` twice.

Note honestly: unlike slice 04, the pre-existing `react.test.tsx` tests could NOT stay green through the harness change alone, because the cache's return type is what this slice changes.
So the RED run does not attribute failures the way slice 04's did.
The four mutations below are what carries that weight instead.

Four mutations run against the finished implementation:

1. Delete the `result.failure === 'session_expired'` branch (a `401` falls into the ladder): 7 red, including both new expired-path tests.
2. Replace `scheduleRevalidate()` with `failSession()` in the transient branch: 7 red, including both new transient-path tests, the pinned reset test and both unmount tests.
3. Delete `revalidateAttempts.current = 0` from the recovery branch: exactly 1 red, `resets the ladder after each recovery, so unrelated blips never accumulate`.
   That is the CLAUDE.md-pinned behaviour and it still has a dedicated oracle nothing else covers.
4. `token.ts`'s superseded branch returning `result` instead of `TRANSIENT_TOKEN_RESULT`: 2 red, including the new `reports a superseded refresh as transient, never as an expired session`.

`vi.getTimerCount()` is the oracle for "did it enter the ladder", per the plan.
Mutation 1 is the proof it is a real oracle rather than a decoration.

R5 checked against `git diff`: the pinned reset test's only changed lines are the three mocked values.
Its loop, its counts and its assertions are untouched.

Final gates, all run once, never in watch mode:

- `pnpm run type-check` green.
- `pnpm run lint` green.
- `pnpm test` green: api 375 tests / 37 files, web 633 tests / 49 files, plus the build contract.
- `pnpm run build` green.
- `apps/web/src/sales-ops/__tests__/blank-bearer-token.test.tsx` needed no change and is green, as the plan predicted.
- `pnpm --filter @fxl-sales/api test:integration` was NOT run; this slice touches no API production code and the plan does not require it.

No dev server, watcher or background process was started.

## For slice 05

The exact shapes slice 05 needs, since it edits the same function.

`apps/web/src/auth/refresh.ts`:

```ts
export type HubRefreshFailure = 'session_expired' | 'transient';
export type HubTokenResult = { token: string } | { token: null; failure: HubRefreshFailure };
export const TRANSIENT_TOKEN_RESULT: HubTokenResult;
export function requestHubAccessToken(
  bffBasePath: string,
  fetchImpl?: typeof fetch,
): Promise<HubTokenResult>;
```

`apps/web/src/auth/token.ts`:

```ts
export type HubAccessTokenCache = {
  getToken: () => Promise<HubTokenResult>;
  seed: (accessToken: string, expiresInSeconds: number) => void;
  clear: () => void;
};
export function createHubAccessTokenCache(
  refresh: () => Promise<HubTokenResult>,
): HubAccessTokenCache;
```

`observeToken` in `apps/web/src/auth/react.tsx`, final shape:

```ts
function observeToken(result: HubTokenResult) {
  if (!mountedRef.current) return;
  if (result.token !== null) {
    clearRevalidateTimer();
    revalidateAttempts.current = 0;
    clearLoginAttempts();
    clearLogoutIntent();
    applyToken(result.token);
    return;
  }
  if (result.failure === 'session_expired') {
    failSession();
    return;
  }
  scheduleRevalidate();
}
```

- **`hasSessionRef` is GONE**, as plan-check B1 predicted.
  Slice 05's login-side flush condition must use `lastAppliedToken` (`react.tsx`, declared just above `revalidateAttempts`), which this slice leaves untouched: `undefined` before any apply, `null` while signed out, a token string while signed in.
  The exact substitute for the old `!hasSessionRef.current` at the moment a token arrives is `lastAppliedToken.current !== result.token`, or `lastAppliedToken.current === null || lastAppliedToken.current === undefined` for "no session was held before this token".
- Slice 04's `clearLogoutIntent()` is still the last statement of the live-token branch, immediately after `clearLoginAttempts()` and before `applyToken`.
  It must not move into `applyToken` - the R6 test in `react.test.tsx` catches that.
- `logout()` is unchanged apart from one comment.
  `markLogoutIntent()` is still its first statement; slice 05's `queryClient.clear()` goes below it and above `await client.logout()`.
- `react.test.tsx`'s cache mock is now `vi.fn<() => Promise<HubTokenResult>>()` and the file has three module-level helpers, `ok(token)`, `expired`, `transient`.
  It also carries a `vi.mock('../refresh', ...)` that SPREADS the real module (`TRANSIENT_TOKEN_RESULT` must stay genuine) and replaces only `requestHubAccessToken`.
  `mocks.createHubAccessTokenCache` and `mocks.createHubClient` are explicitly typed off the real signatures, because the drift-guard test reads the refresher back out of `mock.calls` and an inferred argument-less mock types that as `never`.
- `TokenReader` in that file is still `() => Promise<string | null>`, which is the unchanged public shape of `useAccessToken`.

## Known residual, filed rather than fixed

A transient `503` still surfaces as `Sessão expirada` in the sales-ops panels, because the classification deliberately stops at the provider (plan section 2.5).
Recorded in `nexo/ROADMAP.md`.
Nothing got worse: before this slice a transient failure produced that same panel while signed in, and additionally signed the operator out at cold start.
