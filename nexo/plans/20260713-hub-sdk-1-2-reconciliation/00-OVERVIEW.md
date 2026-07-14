# FXL Hub SDK 1.2.0 reconciliation

## Frame

Reconcile FXL Sales against the complete current `@fxl-business/hub-sdk` 1.2.0 product integration contract.
The repository already resolves SDK 1.2.0, but its browser resume flow, large-workspace behavior, and production BFF session storage must be re-proven against the regenerated product prompt rather than assumed from the declared dependency.

The product audience is `product.fxl-sales` and the core entitlement module is `sales.core`.
The registered local Hub API URL is `http://localhost:9016` and the registered publishable key is `pk_fxl-sales_VzQ9-LUONCnlKllxCRLffN3nw6Z9PQl2`.

## Feature acceptance

1. Given a clean install, when dependencies resolve, then both product packages and the lockfile use `@fxl-business/hub-sdk@^1.2.0` with the published 1.2.0 artifact.
2. Given the API starts with Hub auth configured, when auth routes and protected API routes are composed, then the SDK alone supplies login, callback, refresh, switch, logout, discovery, and token verification for audience `product.fxl-sales`.
3. Given an authenticated browser becomes visible or focused, when its access token is stale, then one disposable listener silently calls the SDK `getToken()` through the same-origin BFF without navigating, reloading, or invoking login.
4. Given a resume refresh fails temporarily, when the browser remains open, then the existing signed-in profile is preserved and only a permanent missing or expired session can expose a login affordance.
5. Given an idempotent API request receives an authentication failure, when one forced token refresh succeeds, then that request is retried exactly once, while non-idempotent writes are never replayed automatically.
6. Given an account belongs to at least 40 workspaces, when the capped token claim cannot provide a complete selector, then the UI can page `GET /me/workspaces?limit=&cursor=` and still switch through SDK `setActive(workspaceId)` or start `/auth/login?workspace=`.
7. Given concurrent callback, refresh, switch, and logout requests for one BFF session, when refresh tokens rotate, then an awaited transactional store serializes that session's mutations and persists the final state before acknowledging the response.
8. Given two different BFF sessions mutate concurrently, when one is slow or fails recoverably, then the other can complete independently without a process-wide persistence barrier.
9. Given Hub returns a permanent session code, when the BFF handles it, then the session becomes unauthenticated, while network, timeout, 5xx, or malformed failures preserve the browser cookie for recovery.
10. Given production configuration, when the BFF starts, then it cannot use an in-memory-only session store and its clock and persistence dependencies are injectable for deterministic tests.
11. Given verified Hub claims, when authorization and display data are read, then authorization uses `entitlements.modules` and `roles.workspace`, while optional display claims remain optional and are not treated as verifier guarantees.
12. Given deployment and operator documentation is reviewed, when the integration is handed off, then it records the day-one entitlement, invite, registrable-domain cookie, reconciliation, and matching-auth-origin invariants without implementing Hub operator endpoints in this product repository.

## Scope limits

This feature does not modify the Hub SDK package, hand-roll OAuth, JWKS, discovery, token verification, or Hub web-origin logic.
It does not implement Hub Admin trials, grants, organizations, reconciliation workers, or invitation delivery inside FXL Sales.
It does not apply a database migration to staging or production, rotate secrets, cut a release, or promote any deployment branch.
It preserves unrelated untracked `.vscode/` content and `nexo/knowledge/doubts/20260707-missing-entitlement.md`.

## Slice index

| Slice | Status | Goal | Dependency |
| --- | --- | --- | --- |
| `01-sdk-contract-baseline` | active | Lock the published SDK, audience, config, BFF route, claims, and operator/deployment contract. | none |
| `02-browser-resume-and-workspaces` | parked | Add seamless resume, safe idempotent retry, optional display claims, and large-workspace fallback. | `01-sdk-contract-baseline` |
| `03-transactional-server-sessions` | active after slice 01 | Add durable awaited per-session persistence and serialized BFF mutations without a production memory-only store. | `01-sdk-contract-baseline` |

## Active execution boundary

Only slices `01-sdk-contract-baseline` and `03-transactional-server-sessions` are executable in the current run.
Slice `02-browser-resume-and-workspaces` remains parked and must not be scheduled, unparked, or represented as delivered.
The active subset covers feature acceptance 1, 2, and 7 through 12, except that acceptance 4's browser-profile preservation remains parked with slice 02 even though slice 03 preserves recoverable server sessions and cookies.
Feature acceptance 3, 5, and 6 also remains parked in full.
After slice 03, SDK 1.2.0 still collapses every non-200 browser refresh result to `null`, and the current browser provider can still clear its profile and invoke login after a temporary failure.
Therefore slice 03 may claim durable server persistence, per-session serialization, and recoverable-cookie preservation only.
It must not claim silent browser resume, preserved browser profile state, safe read replay, complete workspace selection, or completion of the full feature while slice 02 is parked.

Gate 1 is skipped because the user explicitly selected Nexo feature Autopilot.
Gate 2 and feature-boundary mutation verification remain mandatory.
