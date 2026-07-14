# Run: FXL Hub SDK 1.2.0 reconciliation

- Flow: `feature`
- Mode: `autopilot`
- Started: `2026-07-13T20:31:32-03:00`
- Ended: `2026-07-14T01:12:36Z`
- Feature plan: `nexo/plans/20260713-hub-sdk-1-2-reconciliation/`
- Current beat: `complete`
- Status: `complete-with-parked-slices`

## Frame

Reconcile FXL Sales against every section of the regenerated Hub SDK 1.2.0 product prompt.
The dependency is already declared at `^1.2.0`, but correctness must be proved across SDK ownership, browser resume, request retry, workspace scale, server session durability, claims, and deployment/operator invariants.

## Gate decisions

Gate 1 is skipped by the user's explicit Autopilot selection.
Gate 2 remains mandatory through separate Verify agents.
Gate 3 is out of scope and no release or promotion will run.

## Initial evidence

The registry and lockfile resolve the same published SDK 1.2.0 integrity.
The installed SDK owns discovery, the BFF routes, and access-token verification.
The current browser provider has no focus or visibility resume listener and currently initiates login whenever initial profile hydration resolves unauthenticated.
The current API uses the SDK's default in-memory session store in production.
A prior parked branch contains useful server persistence experiments but is based before later migration and product work, so it will be treated as reference rather than merged wholesale.

## Planning log

- Slice `01-sdk-contract-baseline` committed a durable planner PASS.
- Slice `03-transactional-server-sessions` committed a durable planner PASS immediately after its initial wait boundary and before plan-set checking.
- Slice `02-browser-resume-and-workspaces` was parked after the original planner and one fresh retry both failed to commit an atomic verdict within their bounded waits and required late-file rechecks.
- Autopilot continues with slices 01 and 03; no browser implementation is inferred from the parked plan file.
- The first plan-check dispatch timed out without a durable result.
- A fresh independent plan-checker committed PASS for the executable subset.
- Derived waves are Wave 1 with slice 01, followed by Wave 2 with parked slice 02 and active slice 03.

## Execution and verification log

- The first slice 01 Execute dispatch failed before edits because its selected model was at capacity.
- A fresh Execute retry committed `3893f63`, and the first separate verifier failed because the SDK's exported `HubAuthContext` resolved through a missing dev-only package and became `any` under `skipLibCheck`.
- Repair 1 committed `bfa3900` with a local narrow claim type and an anti-`any` compile-time oracle; its separate slice verifier passed.
- The verified branch merged as `2d492b1`, but the full Wave 1 verifier failed the production build because the SDK root entrypoint pulled Node `crypto.randomUUID` into the browser bundle.
- The wave merge was reverted append-only as `e1f1dba`, restoring the exact last-green tree.
- Repair 2 committed `65ef971` with a browser-safe client import and a local product-key validation boundary; production build and all automated commands passed.
- The final separate verifier rejected the remaining local publishable-key parsing and claim-shape duplication because the requested contract makes those surfaces SDK-owned.
- After three machine-gate failures, Autopilot parked slice 01 rather than weakening the SDK-only acceptance contract.
- Slice 03 was parked without execution because it depends on slice 01.
- Zero product slices landed in the effective `master` tree.

## Capture

Capture completed after the run parked all three slices without landing product behavior.
The append-only merge and revert history is `2d492b1` followed by `e1f1dba`.
The trees for baseline `bb7e7ed`, effective `master` at `e1f1dba`, and the revert commit are all `bdd6ec4a335597397e2b5a0a0e1b5b713e7ca05a`.
`git diff --exit-code bb7e7ed..master` passed with no effective product-tree difference.
The rejected repair remains isolated on `feat/01-sdk-contract-baseline` at `65ef971` for upstream retry evidence.
The SDK 1.2.0 packaging and ownership blockers are distilled in `nexo/knowledge/doubts/20260713-hub-sdk-1-2-packaging-blockers.md`.
`CLAUDE.md` was intentionally not updated because the merge was reverted and no product behavior landed.
