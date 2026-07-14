# Plan report - 01-sdk-contract-baseline

Status: PASS

The plan locks the already-resolved published `@fxl-business/hub-sdk` 1.2.0 artifact across both product packages and the lockfile.
It replaces the API's manual audience and module derivation with SDK-backed configuration, fixes the authorization boundary to verified `entitlements.modules` and `roles.workspace`, and preserves the five root-mounted SDK BFF routes for `product.fxl-sales`.
It names three locked RED oracle groups with exact run-once commands, including a real SDK Hono route harness rather than product-owned OAuth mocks.
It assigns day-one entitlement, membership invitation, registrable-domain cookie, auth-origin matching, durable production session readiness, and reconciliation duties to operators and Hub-owned automation.
The plan explicitly excludes Hub Admin endpoints, browser resume and workspace scaling, transactional session storage, database changes, releases, and deployment promotion.

Plan: `nexo/plans/20260713-hub-sdk-1-2-reconciliation/01-sdk-contract-baseline.md`
