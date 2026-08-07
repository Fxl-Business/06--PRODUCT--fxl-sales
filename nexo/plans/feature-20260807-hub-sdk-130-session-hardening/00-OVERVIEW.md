---
id: feature-20260807-hub-sdk-130-session-hardening
milestone: v2.6.0
flow: feature
mode: autopilot
trunk: master
---

# Hub SDK 1.3.0 upgrade and session-layer hardening

## Frame

### What

Upgrade `@fxl-business/hub-sdk` from the published `1.2.0` to `^1.3.0`, port our custom Hub BFF session store to the new async transactional `withSession` contract, and close the session-layer defects that the published `1.2.0` interface either caused or hid.

Six slices:

1. The SDK bump and the store port, including deleting the hydrate-around-the-handler bridge that exists only to work around the synchronous 1.x interface.
2. An absolute session lifetime, so a continuously-refreshing session cannot live forever.
3. The web retry ladder consuming the BFF's new `401` / `503` / `502` refresh-failure classification instead of guessing from a collapsed `null`.
4. A durable logout intent that stops the recovery path re-capturing the route the operator just signed out of.
5. A TanStack query-cache flush on logout, on login, and on workspace switch.
6. A prior session superseded server-side at login, so two accounts cannot be authenticated at once.

### Why

The FXL Hub reported that the `1.2.0` on npm has a weaker public API than the `1.2.0` in their repo: the hardened session contract landed on 2026-07-13 but was never version-bumped or republished. We built against the weaker one. `1.3.0` publishes the hardened contract.

Independent of the Hub's message, our own review of this repo found three defects that justify the work on their own:

- **The flush-failure hole.** `withRequest` in `apps/api/src/auth/hub-session-store.ts` swallows a failure in its flush phase and returns the handler's value as success. The transaction has already rolled back, so the Hub has rotated `RT1` to `RT2` while Postgres still holds `RT1`. The next refresh replays `RT1`, trips `reuse_detected`, and the family is revoked. Porting to `withSession` removes the separate flush phase and closes this structurally.
- **No absolute session lifetime.** The 30-day TTL is sliding: `update()` rewrites `expiresAt` on every rotation. An idle session dies; an active one never does.
- **The logout leak is a data leak, not a route leak.** The `ROADMAP.md` entry describes only the route re-capture. But there is no query-cache flush anywhere in the app, `queryClient` is a module-level singleton in `apps/web/src/App.tsx`, and every key in `apps/web/src/lib/query-keys.ts` is account- and org-agnostic. Worse, `setActive` never invalidates either, so a workspace switch renders the previous tenant's data. That last one is nowhere in the ROADMAP and is the sharpest of the three.

Full findings, including what we are reporting back to the Hub, are in `nexo/runs/feature-20260807-hub-sdk-130-session-hardening/HUB-RESPONSE.md`.

### Acceptance criteria (feature level)

1. `@fxl-business/hub-sdk` resolves to `1.3.0` in both `apps/api` and `apps/web`, and the API boots.
2. `apps/api/src/auth/hub-session-scope.ts` no longer exists, and no middleware hydrates a session working set around the BFF handler.
3. Concurrent refreshes on one session id are serialized by a row lock taken inside `withSession`, and a commit failure surfaces as a non-2xx rather than as a swallowed success.
4. A session past either `expiresAt` or `absoluteExpiresAt` is deleted inside the transaction and reported absent.
5. A `503` or `502` from `/auth/refresh` preserves the session and is retried; only a `401` tears it down.
6. After an explicit `Sair`, the stored return-to path is not re-captured, and the app does not immediately re-login.
7. No cached query data survives a logout, a login, or a workspace switch.
8. A second login in a browser supersedes the session id that browser presented at `/auth/callback`, deleting that row in the same transaction that inserts the new one, so the prior session is no longer live or rotatable. A session held by any other browser or device is untouched.

   **This criterion was AMENDED after planning, and the amendment narrows it.** It originally read "supersedes the prior session **for that account**", which is the Hub's own wording for their invariant 3. That form is provably unimplementable under SDK 1.3.0: `store.create` is called from exactly one place in the whole bundle (`dist/server.js:407-413`) and passes no `accountId`, so `hub_bff_sessions.account_id` is unconditionally `NULL` and a `WHERE account_id = ...` supersede would match zero rows forever while reading as a shipped feature. Verified independently by the slice 06 planner and by the plan-checker.

   The account-keyed form would also **fail to close the threat it names**: in one browser, A logs in, then B logs in and the supersede deletes B's other rows, leaving A's row live and rotatable - exactly the one-browser-two-identities condition invariant 3 exists to prevent. Meanwhile it would log every operator out of every other device.

   Session-id keying closes the actual threat and has no multi-device blast radius. Sessions orphaned without a subsequent login are bounded by `absoluteExpiresAt` (slice 02) and the nightly sweep instead. This deviation from the Hub's wording is deliberate and is reported back to them in `HUB-RESPONSE.md`.
9. `pnpm run lint`, `pnpm run type-check`, `pnpm test` and `pnpm run build` are green, and `pnpm --filter @fxl-sales/api test:integration` passes against the local Docker test database.

### Scope limits (YAGNI)

- We keep our own store. `SqlHubSessionStore` is **not** adopted: ours carries `FORCE` RLS reached only through `getAdminDb()`, an HKDF-SHA256 sealer keyed off `FXL_HUB_SECRET_KEY` with the row id as AEAD additional data, the Drizzle schema, and the nightly purge job. Decided at the front door, not deferred to Gate 1.
- No change to the `hub_bff_sessions` / `hub_bff_login_txns` table names or their non-tenant, FORCE-RLS, admin-connection posture.
- No rewrite of the anti-redirect-loop guard, `sanitizeReturnTo`, or the login-attempt counter beyond what the durable logout intent requires.
- No hosted CI, no GitHub Actions.
- Cutting a release is out of scope. This flow lands on `master` only; promotion to `staging` and `production` needs a separate human Gate 3.

### Must not break

- The `503`-on-store-unavailable behaviour. A hydrate or lock failure must never degrade to an empty working set, because the BFF would then answer `401 no_session` and delete the session cookie, logging every user out over a brief database blip.
- The consume-on-hydrate single-use guarantee for the PKCE verifier: only one replica's `DELETE ... RETURNING` may win.
- `apps/api/src/middleware/__tests__/app-auth-bff-wiring.test.ts` must keep asserting that the exact store instance reaches `createHubBff`.
- Cross-tenant isolation everywhere else in the app.

## Delivery

Trunk is `master` (promotion-mode repo, chain `master` to `staging` to `production`). Milestone `v2.6.0`.

**Execution is serial, stated explicitly per `standalone.md`.** Max wave width here is 2, and each parallel worktree would need its own `pnpm install` against a lockfile that slice 01 itself changes. Serial is cheaper and avoids the changed-lockfile hazard; this is a deliberate choice, not a silent degrade.

## Slice index

| # | Slice | depends_on | Wave |
|---|---|---|---|
| 01 | `01-sdk-130-store-port` | - | 1 |
| 02 | `02-session-absolute-ttl` | 01 | 2 |
| 03 | `03-refresh-failure-classification` | 01 | 2 |
| 04 | `04-durable-logout-intent` | - | 1 |
| 05 | `05-auth-cache-flush` | 03, 04 | 3 |
| 06 | `06-supersede-prior-session` | 02 | 3 |

## Reference material

Staged in `nexo/runs/feature-20260807-hub-sdk-130-session-hardening/sdk-1.3.0/`:
`MIGRATION.md`, `session-store.sql` (the bundled DDL, including its connection-pool warning), `session-store.d.ts`, `server.d.ts`, `client.d.ts`.

Two constraints found while reading them, both load-bearing:

- **`HubClient.getToken()` still returns `Promise<string | null>` in 1.3.0.** The browser client does not expose the new classification, so slice 03 must call `/auth/refresh` itself rather than reading a status off the client.
- **The BFF calls the Hub over HTTP from inside the transaction holding the row lock.** Our current store already has this shape, but on 1.2.0 with no `timeoutMs`, so a hung Hub pins a pooled connection with an open transaction indefinitely. Slice 01 must set `timeoutMs` and record the pool-sizing consequence.
