# FXL Hub SDK integration

This document is the canonical operator handoff for FXL Sales authentication, authorization, and Hub integration.

## Product constants

The registered product audience is `product.fxl-sales`, and the core entitlement module is `sales.core`.
The local Hub API is `http://localhost:9016`.
The exact registered local callback is `http://localhost:8006/auth/callback`.
The registered local publishable key is `pk_fxl-sales_VzQ9-LUONCnlKllxCRLffN3nw6Z9PQl2`.
Secret keys come from the Hub operator or Infisical and must never enter source control, browser variables, logs, or screenshots.
Audience overrides normally remain unset because the SDK derives the audience from the registered key.
Any explicit API or browser audience override must be exactly `product.fxl-sales`.

## SDK ownership

The SDK alone owns login, callback, refresh, active-workspace switch, logout, discovery, JWKS access-token verification, checkout links, and subscription-management links.
FXL Sales may compose these SDK functions but may not duplicate their OAuth, discovery, verifier, or Hub web URL logic.
The API mounts every SDK BFF route at the root so the public paths remain `/auth/login`, `/auth/callback`, `/auth/refresh`, `/auth/switch`, and `/auth/logout`.

## Environment registration

### Local checklist

- Register a distinct local Hub client for `product.fxl-sales`.
- Register the exact callback URI `http://localhost:8006/auth/callback`.
- Put the operator-issued API secret only in the API environment.
- Put the matching publishable key in both API and browser public configuration.
- Keep `VITE_AUTH_BFF_BASE_PATH=` empty so browser auth uses same-origin `/auth/*` through the scoped Vite proxy.
- Keep the API callback, browser BFF route, and registered product audience aligned.

### Staging checklist

- Register a distinct staging Hub client for `product.fxl-sales`.
- Register the exact externally reachable staging callback URI.
- Store the staging API secret in the staging Infisical environment.
- Configure the matching staging browser publishable key.
- Configure API and web BFF routing values for the deployed origins.
- Confirm that the callback sent by the BFF matches the Hub registry byte-for-byte.

### Production checklist

- Register a distinct production Hub client for `product.fxl-sales`.
- Register the exact externally reachable production callback URI.
- Store the production API secret in the production Infisical environment.
- Configure the matching production browser publishable key.
- Configure API and web BFF routing values for the deployed origins.
- Confirm that the callback sent by the BFF matches the Hub registry byte-for-byte.

If the web and API origins differ, the operator must provide scoped `/auth/*` rewrites at the web origin or set `VITE_AUTH_BFF_BASE_PATH` to the API origin and register that same API-origin callback.
The catch-all SPA rewrite is not an auth proxy and must not be described or operated as one.

## Day-one provisioning and invitations

The Hub operator must create or preserve each workspace id so it equals the existing FXL Sales `org_id` before users enter the product.
The Hub operator must seed an `active` or `trialing` entitlement containing `sales.core` before first gated access.
Account creation, workspace membership, Hub-owned membership invitation creation, and invitation delivery belong to Hub operator workflows.
Existing FXL Sales seller or finder domain records do not replace a Hub account and workspace membership.

## Domain, cookie, and auth-origin invariants

Hub auth and the product web origin must share the same registrable domain in production when the deployment depends on first-party cookie behavior.
Hub-side `AUTH_PUBLIC_URL`, `HUB_ISSUER`, and the matching web auth origin must describe the same externally reachable auth origin.
Every proxy must preserve TLS, secure cookies, exact redirect registration, and matching forwarding headers.
A production deployment must provide the durable production session storage required by slice 03 and must not rely on the SDK in-memory development default.

## Reconciliation and incident checks

The operator or Hub platform automation owns periodic reconciliation of Hub workspace membership, entitlement status, module grants, and preserved workspace ids against FXL Sales tenancy.
Handoff checks must cover missing membership, missing `sales.core`, mismatched `workspaceId` and `org_id`, redirect mismatch, origin mismatch, clock skew, cookie loss, and stale secrets.
Clock synchronization is an operator responsibility because verifier time checks and OAuth flows require accurate hosts.

## Explicit non-ownership

FXL Sales does not implement Hub Admin trials, grants, organizations, reconciliation workers, or invitation delivery.
This repository does not implement Hub Admin trial, grant, organization, membership invitation, reconciliation-worker, or invitation-delivery endpoints.
Operators perform those actions in Hub or Hub-owned automation, and FXL Sales consumes only the SDK and verified Hub claims.
