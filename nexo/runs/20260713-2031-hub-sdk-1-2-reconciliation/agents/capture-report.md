# Capture report - Hub SDK 1.2.0 reconciliation

## Verdict

PASS.
The run record now preserves the objective failure chain, the parked disposition, and the exact effective-tree recovery evidence.

## Durable evidence

The run started at `2026-07-13T20:31:32-03:00` in feature Autopilot mode.
Capture completed at `2026-07-14T01:12:36Z`.
Slice 01 failed three machine-gate attempts across unresolved SDK claim declarations, a browser bundle that reached Node `crypto.randomUUID`, and final rejection of product-local key parsing and claim-shape duplication.
Slice 02 remains parked, and slice 03 remains parked behind slice 01.
The Wave 1 merge at `2d492b1` was reverted append-only at `e1f1dba`.
The Git tree IDs for `bb7e7ed`, `master`, and `e1f1dba` are all `bdd6ec4a335597397e2b5a0a0e1b5b713e7ca05a`.
`git diff --exit-code bb7e7ed..master` passed, so zero product changes remain in the effective `master` tree.
The rejected repair evidence remains on `feat/01-sdk-contract-baseline` at `65ef971` and is not merged into effective `master`.

## Knowledge capture

The upstream packaging blockers and exact retry contract are recorded in `nexo/knowledge/doubts/20260713-hub-sdk-1-2-packaging-blockers.md`.
The doubt records the browser-unsafe package root, the unresolved `HubAuthContext` declaration dependency, and why product-local replacements violate the requested SDK-only boundary.
`CLAUDE.md` was intentionally not updated because the append-only revert removed all product behavior from the effective tree.

## Scope hygiene

No product code, commit, merge, push, release, or deployment action was performed during Capture.
The user-owned `.vscode/` tree and `nexo/knowledge/doubts/20260707-missing-entitlement.md` were not modified.
No long-running process was started.
