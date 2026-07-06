---
id: 20260706-hub-auth-fxl-sales
milestone: hub-auth-fxl-sales
status: done
mode: autopilot
---

# Hub Auth Integration + FXL Sales Rename

## Frame

Replace Clerk as the primary auth and commerce integration with the FXL Hub SDK for `product.fxl-sales`.
Rename visible/package app identity to `fxl-sales`, while leaving the repository folder name unchanged.
Keep Clerk dormant behind reversible `AUTH_PROVIDER=clerk` / `VITE_AUTH_PROVIDER=clerk` flags during the rollback window.

## Acceptance

- Given `AUTH_PROVIDER=hub`, when the API boots, then it loads Hub env vars and mounts the Hub BFF at `/auth/*`.
- Given `AUTH_PROVIDER=hub`, when an API request carries a Hub bearer token, then protected routes read `userId`, `orgId`, `userRole`, and Hub auth context from verified Hub claims.
- Given `VITE_AUTH_PROVIDER=hub`, when the web app renders, then it uses the Hub browser client for login, token retrieval, logout, and workspace switching instead of Clerk.
- Given a workspace without `sales.core`, when a protected API request is made in Hub mode, then the app returns a gated entitlement error before tenant data access.
- Given the repo identity is renamed, when build/test commands run, then workspace package names, filters, page titles, health service names, and visible strings use `fxl-sales`.
- Given rollback is needed before user-id re-key, when `AUTH_PROVIDER=clerk` and `VITE_AUTH_PROVIDER=clerk` are used, then the Clerk path remains available.

## Scope Limits

- Do not rename the root folder in this session.
- Do not rotate or invent `FXL_HUB_SECRET_KEY`.
- Do not run user-id re-key migrations.
- Do not rename existing `fxl_finders_*` database roles or database names in this slice because that is an ops/schema migration.
- Do not remove Clerk packages until the dormant rollback window is intentionally closed.
- Leave standalone mobile out of the root cutover unless a later slice explicitly includes it.

## Slice Index

| Slice | Status | Depends on | Acceptance |
|---|---|---|---|
| 01-identity-and-config | done | [] | API/web package identity and auth-provider env config support `fxl-sales` + Hub flags. |
| 02-api-hub-bff-auth | done | [01-identity-and-config] | API mounts `/auth/*`, verifies Hub tokens, preserves Clerk fallback, and gates `sales.core`. |
| 03-web-hub-client-auth | done | [01-identity-and-config, 02-api-hub-bff-auth] | Web app uses provider-neutral auth hooks and Hub client in hub mode. |
| 04-clerk-operational-cutover | done | [02-api-hub-bff-auth] | Finder/seller invite and webhook paths stop hand-rolling Clerk in Hub mode and document operator-owned provisioning. |
| 05-rename-visible-identity | done | [01-identity-and-config] | Visible/runtime identity changes to FXL Sales without folder rename. |
| 06-verify-capture | done | [02-api-hub-bff-auth, 03-web-hub-client-auth, 04-clerk-operational-cutover, 05-rename-visible-identity] | Full local verification passes or blockers are recorded in `AUDIT.md`. |
