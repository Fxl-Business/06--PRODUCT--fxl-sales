---
milestone: null
question: "Why does the API return payment_required/missing_entitlement?"
answer: "The API returns this when Hub auth succeeds but the active workspace token lacks the product core entitlement."
---

# Missing Entitlement Response

The response `{"error":"payment_required","code":"missing_entitlement"}` comes from `apps/api/src/middleware/app-auth.ts`.
It is returned after `requireHubAuth` accepts the bearer token but before protected route code runs.
The gate checks whether `auth.claims.entitlements.modules` includes the configured product core module.

For FXL Sales, the audience is `product.fxl-sales`.
The derived core module is `sales.core`.
A workspace must have an `active` or `trialing` Hub entitlement for `sales.core` before it can call protected product APIs.

If this appears locally, inspect the active Hub workspace in the access token and seed or switch to a workspace with `sales.core`.
Also verify that the API and web publishable keys point at the same `product.fxl-sales` Hub client and that no unintended `FXL_HUB_AUDIENCE` override is set.
