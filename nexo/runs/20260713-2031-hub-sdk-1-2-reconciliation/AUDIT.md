# Autopilot audit - run 20260713-2031-hub-sdk-1-2-reconciliation

## Parked slice - browser resume and workspaces

- [ ] VERIFY PLAN: re-run a fresh planner against `nexo/plans/20260713-hub-sdk-1-2-reconciliation/02-browser-resume-and-workspaces.md` and require an atomic PASS result before execution.
- WHY: the original planner and one fresh retry both exceeded their bounded durable-result windows and neither committed `done: true` before the required late-file rechecks.
- SAFETY: no browser product code was changed and the slice will not enter an execution or merge queue without a durable plan verdict.
- WHERE: `nexo/plans/20260713-hub-sdk-1-2-reconciliation/02-browser-resume-and-workspaces.md`.

## Parked slice - SDK contract baseline

- [ ] UPSTREAM: publish a Hub SDK release whose browser-safe entrypoint exposes the required audience/config validation without importing Node `crypto` into Vite.
- [ ] UPSTREAM: publish `HubAuthContext` declarations that resolve without the SDK's dev-only `@fxl-hub/hub-auth` package becoming `any` under the product TypeScript configuration.
- [ ] RETRY: rebase or recreate `feat/01-sdk-contract-baseline` from current `master`, retain the locked contract and anti-`any` oracles, and repeat separate slice and wave verification against the corrected SDK artifact.
- WHY: three machine-gate failures proved that the exact published SDK 1.2.0 artifact cannot satisfy the requested SDK-only boundary without a product-owned publishable-key parser or duplicated verifier claim type.
- EVIDENCE: the first slice verifier found unresolved exported claim types; the first wave verifier found the SDK root bundle importing Node `crypto.randomUUID`; the final verifier rejected the product-local workarounds as violations of SDK ownership.
- SAFETY: the failed Wave 1 merge was reverted append-only, and `master` at `e1f1dba` has the same tree as last-green baseline `bb7e7ed`.
- PARKED: branch `feat/01-sdk-contract-baseline` at `65ef971` is not merged into the effective `master` tree.

## Parked slice - transactional server sessions

- [ ] RETRY: execute `03-transactional-server-sessions` only after `01-sdk-contract-baseline` receives an independent PASS and lands green on `master`.
- WHY: the server session slice explicitly depends on the SDK/config baseline and cannot safely compose its async persistence adapter on an unverified BFF boundary.
- SAFETY: no server-session product code, migration, or generated metadata was changed in this run.
- WHERE: `nexo/plans/20260713-hub-sdk-1-2-reconciliation/03-transactional-server-sessions.md`.

## Release

- [ ] No release is ready to cut because zero slices landed in the effective `master` tree.
