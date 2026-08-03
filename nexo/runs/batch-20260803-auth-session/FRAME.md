# Frame - auth session loss (batch-20260803-auth-session)

Milestone: v2.4.0
Trunk: `master` (promotion mode: master -> staging -> production)
Mode: `--batch --auto` (Gate 1 skipped by explicit user flag)

## Reported symptoms

**S1 - a logged-in user sees the app fail to load.**
A partner logged into FXL Sales and nothing loaded; the screen showed
"A API de vendas não respondeu corretamente. Verifique o servidor local e tente novamente."
The same moment, the reporter's own browser worked fine.
The partner's FXL Hub session was verified healthy in another tab.
Clearing the browser cache and reloading fixed it - and he came back **already logged in**.

**S2 - work is destroyed roughly every 5 minutes.**
While creating produtos, around the third one, clicking create made the app reload and land back on
the dashboard. It recurred: after roughly 5 minutes idle, the next action reloaded the app, the
half-filled form was lost, and the user had to navigate back to where they were.

## Diagnosis (established by reading the code, not assumed)

### Root cause - the BFF session store is in-process memory

`createAppAuthBff()` in `apps/api/src/middleware/app-auth.ts` calls
`createHubBff(hubSdkConfig, { redirectUri, postLoginRedirect, postLoginErrorRedirect })`
and passes **no `sessionStore`**. Per `@fxl-business/hub-sdk@1.2.0`
(`dist/server.d.ts`): *"Server-side session store. Defaults to an `InMemoryHubSessionStore`"*,
and that class is documented as *"Sessions + login txns live only in this process - gone on
restart."*

The browser only ever holds an opaque, HttpOnly session id in the `fxl_hub_session` cookie; the Hub
refresh token lives **only** in that in-process Map. So:

- every API restart or redeploy silently invalidates **every** logged-in user's session;
- with more than one API replica, a session created on replica A is invisible to replica B, so
  refresh succeeds or fails depending on which instance the request lands on. This is exactly the
  "broken for him, fine for me, at the same moment" shape of S1.

When the record is missing, `POST /auth/refresh` deletes the cookie and answers `401 refresh_failed`
(`dist/server.js`), so `HubClient.getToken()` resolves `null`.

### Defect A - a null token is laundered into an unauthenticated request

`requireToken` in `apps/web/src/sales-ops/hooks.ts:34-36` is
`return (await getToken()) ?? '';`. `apiFetch` treats `''` as falsy and therefore sends **no
`Authorization` header at all** (`apps/web/src/lib/api-client.ts:28`). The API answers 401, TanStack
Query surfaces `isError`, and `SalesOpsApp.tsx:1336` renders the generic
"A API de vendas não respondeu corretamente" panel. An auth failure is thus displayed as a server
fault, which is precisely S1's misleading message. The same `(await getToken()) ?? ''` pattern is
repeated at ~40 call sites across `admin/**` and `finder/**`.

### Defect B - a transient token failure hard-redirects and destroys in-progress work

`getToken` in `apps/web/src/auth/react.tsx:141-145` calls `applyToken(token)` on **every** token
read, and `applyToken(null)` sets `isSignedIn: false`. `HubProtected` (`react.tsx:199-213`) reacts to
`!isSignedIn` by calling `login()`, which is `window.location.assign('/auth/login')` - a full page
navigation. The Hub SSO cookie is still valid, so the user bounces straight back through
`/auth/callback`, which redirects to `resolveHubPostLoginRedirect` = `CORS_ORIGIN` = the web root =
the dashboard.

That is S2 end to end: token expires (or refresh fails), next action triggers a refresh, the refresh
returns null, the profile is torn down, the app navigates away mid-form, and the user reappears
"logged in" on the dashboard with the form gone. Nothing preserves the current route or the form.

## Acceptance criteria (batch level)

1. A Hub BFF session survives an API process restart and is readable by any replica.
2. A null access token never results in a request being sent with a blank/absent bearer token.
3. A transient refresh failure does not tear down the signed-in profile, and a genuine re-login
   returns the user to the route they were on rather than the dashboard.

## Scope limits (YAGNI)

- No change to the Hub SDK itself; it already exposes the `sessionStore` seam.
- No new auth provider, no token storage in the browser (tokens stay memory-only per CLAUDE.md).
- No redesign of the sales-ops error panel beyond distinguishing an auth failure from an API fault.
- No form-state autosave/draft persistence; the fix is to stop navigating away, not to add drafts.

## Must not break

- `userId` = Hub account id, `orgId` = active Hub workspace id; every tenant query still filters by
  `orgId`.
- Browser access tokens stay memory-only, cached to `exp - 30s`, one in-flight refresh per provider.
- The existing auth tests in `apps/web/src/auth/__tests__/` and
  `apps/api/src/middleware/__tests__/app-auth.test.ts`.
- RLS integration tests stay pinned to the local Docker test database.
