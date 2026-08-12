# Evidence - a session survives exactly one refresh

Gathered 2026-08-12, before planning. Everything here is measured, not inferred.

## 1. Production: the failing sequence

Three sequential `POST https://sales-api.fxlbusiness.com/auth/refresh` calls with
`credentials: 'include'`, run from the live app's own origin, 1.2s apart:

| # | status | body / token |
| --- | --- | --- |
| 1 | 200 | `accessToken`, `iat`→`exp` span = **120 seconds** |
| 2 | 401 | `{"error":"session_expired"}` |
| 3 | 401 | `{"error":"no_session"}` |

Reproduced twice, on two independently established sessions.
The dashboard rendered normally between the page load and call #2, so the app's own
boot refresh is call #1 and it succeeds.

`session_expired` is the SDK's verdict for a Hub 401 whose body `code` is in
`PERMANENT_REFRESH_CODES` = `{invalid, expired, revoked, reuse_detected, no_session}`
(`dist/server.js:280,450`). The SDK calls `tx.delete()` on that branch, which is why
call #3 reports `no_session`.

## 2. Why this is a permanent, every-user, every-session failure

`SESSION_RENEWAL_LEAD_MS` is 60 000 ms and the access token lives 120 s, so the
proactive renewal in `apps/web/src/auth/react.tsx` fires ~60 s after login. That
renewal **is** call #2. So every session dies about a minute after it starts.

While the tab is hidden the renewal is deliberately not scheduled; on return,
`handleVisibilityChange` calls `renewNow()` synchronously, which is the same call #2.
That is the reported "leave it 5 minutes, come back, session gone".

## 3. Root cause, proven against the real SDK

`dist/server.js:463-464` in `@fxl-business/hub-sdk@1.3.1`:

```js
const rotated = parseRotatedRefresh(res.headers.get("set-cookie"));
if (rotated) await tx.update({ ...record, hubRefreshToken: rotated });
```

```js
function parseRotatedRefresh(setCookieHeader) {
  if (!setCookieHeader) return void 0;
  const match = /(?:^|[,\s])fxl_hub_session=([^;]+)/.exec(setCookieHeader);
  return match?.[1];
}
```

The rotated refresh token is recovered **only** from a `Set-Cookie: fxl_hub_session=…`
response header. `isRefreshSuccess` validates only `{accessToken, expiresIn}` and never
looks in the body. If the header is absent, `tx.update()` is never called, the store
keeps the old token, and the BFF still answers **200**.

Driving the genuine `createHubBff` refresh handler against a fake Hub (recording store):

| Hub response | store calls | stored token |
| --- | --- | --- |
| rotated token in JSON body only | `withSession -> get` | `RT1` - **rotation lost** |
| rotated token in `Set-Cookie` | `withSession -> get -> update(RT2)` | `RT2` - persisted |
| neither | `withSession -> get` | `RT1` - **rotation lost** |

All three answered `200`. The loss is silent.

## 4. Why none of our own code is at fault, and why three fixes missed it

`apps/api/src/auth/hub-session-store.ts` is correct: its `update` seals and writes
properly, and the commit that wrote it **is** in `origin/production`. The store simply
is never called. The defect is upstream of it.

Every existing rotation test calls `handle.update(...)` **directly**:

- `apps/api/src/auth/__tests__/hub-session-store.test.ts:278`
- `apps/api/test/rls/hub-bff-session-store.test.ts:120,136,306`

and `app-auth-bff-wiring.test.ts` stubs `withSession` to return a canned
`REFRESH_OK = { status: 200, body: { ok: true }, clear: false }` (line 52), so the SDK's
real refresh handler - the Hub round trip and the rotation write - never executes in any
test we own.

**The missing oracle:** drive the real SDK BFF `/auth/refresh` against a fake Hub and
assert the store's persisted refresh token actually changed. That test does not exist.

## 5. The two damage amplifiers (web)

Both were introduced by earlier attempts at this bug and are what turn a lost session
into a dead end.

**B.** `HubProtected`'s `liveSessionLoss` branch keeps `children` mounted to protect
unsaved form state. But the mounted child `SalesOpsApp` then reads `profile.roles === []`
and returns `<Navigate to="/no-role" replace />`
(`apps/web/src/sales-ops/SalesOpsApp.tsx:1245`), rewriting the URL **underneath** the
overlay. `captureReturnTo` then captures `/no-role`.

**C.** `/no-role` (`apps/web/src/router.tsx:144`) renders `NoRolePage` unconditionally,
with no role re-check. So after a successful re-login the operator lands on
"Acesso não autorizado" while holding full roles, and cannot escape without retyping the
URL.
