# Plan report - Slice 02 browser resume and workspaces

## Verdict

PASS.

The complete mechanical plan is at `nexo/plans/20260713-hub-sdk-1-2-reconciliation/02-browser-resume-and-workspaces.md`.

## Evidence inspected

- Repository instructions in `AGENTS.md`, `CLAUDE.md`, and `apps/web/AGENTS.md`.
- Feature contract in `nexo/plans/20260713-hub-sdk-1-2-reconciliation/00-OVERVIEW.md`.
- Planner context in `nexo/runs/20260713-2031-hub-sdk-1-2-reconciliation/context-pack.md`.
- The installed published SDK 1.2.0 package metadata, browser declarations, browser runtime, BFF declarations, and BFF runtime.
- Current browser configuration, SDK provider, memory token cache, claims parser, protected route wrapper, role guards, user controls, API JSON and blob clients, QueryClient defaults, all query and mutation token callers, and their relevant tests.
- The canonical Hub `GET /me/workspaces` contract and its 40-entry claim cap in the sibling Hub source of truth.

## Key finding

Published SDK 1.2.0 has a lossy browser token result.
Its `getToken(): Promise<string | null>` collapses network errors, every non-200 response, and malformed payloads to `null`.
Its BFF emits exact `no_session` for a missing session but maps both upstream permanent 401 and temporary network failure to `refresh_failed`, and it does not emit `session_expired`.

The plan therefore forbids inferring sign-out from `null`, status 401 alone, or `refresh_failed`.
It specifies a thin compatibility observer using only the SDK's documented injected fetch seam, classifies only exact `no_session` and forward-compatible `session_expired` as permanent, and treats every other outcome as temporary.
The adapter observes SDK-owned requests but does not initiate BFF protocol calls or hand-wire OAuth, JWKS, discovery, callback, or Hub web-origin logic.

## Plan coverage

The plan locks:

- One disposable focus and visibility helper with one shared callback, in-flight coalescing, hidden-tab suppression, and complete disposal.
- Silent normal-cache resume that calls SDK `getToken()` only for a stale token and never logs in, navigates, reloads, or changes history.
- Signed-profile preservation on every temporary or ambiguous refresh failure.
- User-clicked login affordance only after confirmed `no_session` or `session_expired`.
- One forced SDK refresh and one replay for GET or HEAD 401, no second replay, no outer TanStack 401 retry, and no replay for POST, PUT, PATCH, or DELETE.
- Every current query and mutation caller moving from an eager token string to the stable getter callback.
- Optional name, email, avatar, workspace name, workspace preview, and products display claims without elevating them to verifier guarantees or entitlement inputs.
- Existing SDK `setActive` seed and generation ordering plus logout clearing and late-result rejection.
- Workspace-specific reauthentication through only the SDK-owned BFF `/auth/login?workspace=` route because SDK 1.2.0 `login()` accepts no workspace argument.
- `WORKSPACES_CLAIM_MAX = 40`, a TanStack infinite query over the configured Hub API `GET /me/workspaces?limit=100&cursor=`, canonical response normalization, de-duplication, preview fallback, load more, endpoint-only switching, and no raw workspace ids in visible labels.
- Locked RED tests, exact focused run-once commands, full Gate 2 commands, security review, and an end-user browser audit for idle resume, temporary failure, read replay, write non-replay, workspace paging, switching, logout, and permanent expiry.

## Scope

No product code, generated file, dependency declaration, changelog, unrelated doubt, or workspace setting was changed.
Only the requested plan and planner run artifacts were written.
