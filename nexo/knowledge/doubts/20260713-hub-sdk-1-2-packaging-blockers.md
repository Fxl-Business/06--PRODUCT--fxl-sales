---
milestone: null
question: "Why can FXL Sales not finish the requested SDK-only Hub SDK 1.2.0 boundary?"
answer: "The published artifact exposes browser config helpers through a Node-backed root bundle and re-exports HubAuthContext through an undeclared runtime type dependency, so product-local replacements would violate SDK ownership."
---

# Hub SDK 1.2.0 packaging blockers

## Answer

The published `@fxl-business/hub-sdk@1.2.0` root entrypoint exports browser configuration helpers and the server in-memory session store from the same graph.
That root graph reaches `node:crypto.randomUUID` through the session-store chunk, so Vite cannot produce the FXL Sales browser bundle when web code imports the root entrypoint.
The browser-safe `@fxl-business/hub-sdk/client` subpath does not directly export `deriveAudience`, `loadHubConfigFromEnv`, or their configuration types even though `createHubClient` uses audience derivation internally.
The published root declarations also re-export `HubAuthContext` from `@fxl-hub/hub-auth`, but the package lists `@fxl-hub/hub-auth` only as a development dependency.
The unresolved declaration becomes `any` under the product TypeScript configuration because `skipLibCheck` hides the missing package.
Product-local publishable-key parsing duplicates SDK configuration ownership and can drift from future key formats or audience rules.
Product-local claim-shape declarations duplicate the verifier contract and cannot fail compilation when the SDK changes its guaranteed authorization fields.
Both workarounds therefore violate the requested SDK-only boundary even when their focused tests, type checks, and production build pass mechanically.

## Evidence

The first verifier recorded the unresolved claim type in `nexo/runs/20260713-2031-hub-sdk-1-2-reconciliation/agents/verify-01-sdk-contract-baseline-report.md`.
The Wave 1 verifier recorded the root bundle reaching Node `crypto.randomUUID` in `nexo/runs/20260713-2031-hub-sdk-1-2-reconciliation/agents/wave-01-verify-report.md`.
The final verifier recorded the SDK-ownership violations in `nexo/runs/20260713-2031-hub-sdk-1-2-reconciliation/agents/verify-repair2-01-sdk-contract-baseline-report.md`.
The rejected product-local workarounds remain on branch `feat/01-sdk-contract-baseline` at commit `65ef971`.
The authoritative retry checklist remains in `nexo/runs/20260713-2031-hub-sdk-1-2-reconciliation/AUDIT.md`.
The effective `master` tree at `e1f1dba` is identical to baseline `bb7e7ed` after the append-only revert.

## Upstream resolution and retry conditions

Upstream must publish a corrected SDK artifact whose browser-safe public surface exposes the required audience and publishable-key validation without making Node `crypto` reachable from a browser import graph.
Upstream must publish `HubAuthContext` and its nested entitlement and role types as self-contained declarations or through a declared installed dependency so consumer type resolution never falls back to `any`.
FXL Sales must then update both SDK importers and the lockfile to the same corrected published version and integrity.
The retry must recreate or rebase `feat/01-sdk-contract-baseline` from current `master`, remove the product-local key parser and claim-shape duplication, and bind both boundaries to the corrected public SDK exports.
The retry must retain the locked SDK ownership and anti-`any` oracles, pass a fresh separate slice verifier, and pass the full wave production build and repository Gate 2 checks.
Slice `03-transactional-server-sessions` may execute only after slice 01 passes those conditions and lands green on `master`.
