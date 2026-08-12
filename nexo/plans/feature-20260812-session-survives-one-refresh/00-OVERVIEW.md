---
feature: feature-20260812-session-survives-one-refresh
milestone: v2.8.0
---

# A Hub session survives exactly one refresh

## Frame

### What

In production, every FXL Sales session dies roughly one to three minutes after login.
The operator opens the app, leaves the tab, comes back, and finds `Sua sessão expirou`.
Clicking `Entrar` lands them on `Acesso não autorizado`.
Quitting the browser and returning appears to fix it, for another minute or two.

This has been reported and "fixed" three times.
Every previous fix was on the browser side, and the defect is not on the browser side, which is
why none of them could ever have worked.

### Why it happens

Measured against production, not inferred.
Full evidence with citations is in
`nexo/runs/feature-20260812-session-survives-one-refresh/evidence.md`.

Three sequential `POST /auth/refresh` calls on one live session answer `200`, then
`401 session_expired`, then `401 no_session`.
The access token's own lifetime is **120 seconds**.

The chain:

1. The Hub's auth service runs with `NODE_ENV=production`, so on every successful refresh it
   rotates the session cookie as `Set-Cookie: __Host-fxl_hub_session=<rotated>`.
   Outside production it uses the unprefixed `fxl_hub_session=`.
2. `@fxl-business/hub-sdk@1.3.1` recovers the rotated refresh token **only** from that header,
   with `parseRotatedRefresh`'s regex `/(?:^|[,\s])fxl_hub_session=([^;]+)/`.
   The `__Host-` prefix leaves the cookie name preceded by `-`, which that regex cannot match.
3. So `rotated` is `undefined`, `tx.update()` is never called, and Postgres keeps the **old**
   refresh token, while the BFF still answers `200`. The loss is completely silent.
4. The Hub forgives exactly **one** stale generation, for 60 seconds
   (`HUB_SESSION_GRACE_SECONDS`).
   Because the BFF keeps replaying the same original token it falls further behind on every
   cycle: the first replay is forgiven, the second trips `reuse_detected`, and the Hub revokes
   the whole family.
5. `SESSION_RENEWAL_LEAD_MS` is 60 s against a 120 s token, so the app refreshes about once a
   minute. That is what makes the death clock about two minutes, every session, every user.

This is invisible locally, and always was: with `NODE_ENV !== 'production'` the Hub sends the
unprefixed name and the SDK's regex matches.
That is the whole reason three rounds of local fixes never touched it.

Our own `apps/api/src/auth/hub-session-store.ts` is correct and its commit **is** in
`origin/production`. It is simply never called.

### The missing oracle

Every rotation test we own calls `handle.update(...)` directly, and
`app-auth-bff-wiring.test.ts` stubs `withSession` to return a canned `REFRESH_OK`, so the SDK's
real refresh handler, the Hub round trip and the rotation write have never executed in any test
in this repo. That gap is what let this ship, and closing it is part of slice 01.

### The two damage amplifiers

Both were introduced by earlier attempts at this bug. They are what turn a lost session into a
dead end, and they are real defects in their own right even once the root cause is fixed.

- **B.** `HubProtected`'s `liveSessionLoss` branch deliberately keeps `children` mounted to
  protect unsaved form state. The mounted `SalesOpsApp` then sees `roles === []` and returns
  `<Navigate to="/no-role" replace />`, rewriting the URL underneath the overlay and destroying
  the route the overlay exists to preserve. `captureReturnTo` then captures `/no-role`.
- **C.** `/no-role` renders `NoRolePage` unconditionally with no role re-check, so a re-login
  returns the operator to a dead end while they hold full roles.

### Acceptance criteria

1. A BFF session survives an unbounded number of refreshes: the refresh token persisted by the
   store changes on every rotation, whether the Hub names the cookie `fxl_hub_session` or
   `__Host-fxl_hub_session`.
2. A tab left idle for 5+ minutes and returned to is still signed in, on its original route.
3. A session that genuinely is lost keeps the URL it was on, and `Entrar` returns there.
4. `/no-role` is never a dead end for an operator who holds roles.
5. Each of the three defects is pinned by a regression oracle that fails on the current code.

### Scope limits

- **Not** changing `hub-session-store.ts`. It is correct.
- **Not** patching `node_modules`, and **not** reintroducing `patchedDependencies`. The fix goes
  through `createHubBff`'s documented `fetchImpl` option.
- **Not** touching the access-token TTL or `SESSION_RENEWAL_LEAD_MS`. Once rotation persists, a
  60-second renewal cadence is correct behaviour, not a bug.
- **Not** editing the `16--INTERNAL--fxl-hub` repo in this run. The upstream SDK fix is filed to
  `nexo/ROADMAP.md` with the exact one-line patch; it is a different product's repository and a
  separate decision.

### The upstream fix, for the record

`packages/hub-sdk/src/server.ts` in `16--INTERNAL--fxl-hub` should read
`(?:^|[,\s])(?:__Host-)?fxl_hub_session=` and iterate `res.headers.getSetCookie()` rather than
the single joined header. Publishing that as `1.3.2` would make slice 01 redundant, and slice 01
is written so that it stays correct and inert if that ever lands.

## Slices

All four are independent, touch disjoint files, and form a single wave.

| id | slice | fixes | app |
| --- | --- | --- | --- |
| 01 | `persist-rotated-hub-session-cookie` | root cause A | api |
| 02 | `keep-the-route-on-session-loss` | amplifier B | web |
| 03 | `never-restore-the-no-role-route` | amplifier B, defence in depth | web |
| 04 | `no-role-redirects-when-entitled` | dead end C | web |
