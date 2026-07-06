# Learning: adversarial pre-execution plan review catches cross-phase blockers cheaply

> Captured 2026-05-28 from the FXL Sales v1.0 run (/nexo:add-feature + /nexo:autopilot, ultracode).
> **NOT yet submitted to nexo-forge.** Run `/nexo:learn` yourself to open the PR (autopilot does not push).

## Context

A 6-phase milestone (~90 tasks) was planned by separate per-phase planner agents that each saw only the shared `plan-brief.md`, not their sibling PLAN.md files. Before executing, a 7-agent review workflow (6 per-phase reviewers + 1 cross-phase integration auditor) read all 6 plans.

## What happened

All 7 reviewers returned BLOCKED: **22 BLOCKERs**, 17 WARNs, 12 NITs. The blockers were overwhelmingly **cross-phase wiring** bugs that no single-phase planner could see:

- An app-slug spelling split (`fxl-financeiro` vs `fxl-financiero`) that would have made the conversion webhook 401 on every call — the headline deliverable, dead on arrival.
- A commission lifecycle where rows were born `pending` but nothing ever promoted them (nightly job only handled `approved`) — no commission could ever be paid.
- A payout domain designed twice (Phase 05 `payouts` table + paid_payout_id vs Phase 06 `payout_batches` + `in_payout` + `payout_batch_id`) — same files, conflicting DDL.
- RLS policies that returned 0 rows (admin reads with no tenant context; `/r/[code]` public read missing), and a standalone RLS `.sql` the drizzle migrator silently skips.
- Non-existent imports (`db` singleton, `verify`, bound `clerkClient`) copied across phases.

## The fix pattern (worth promoting to the methodology)

1. Review plans **before** execution, with one reviewer per unit **plus** a dedicated cross-phase integration auditor (the cross-phase agent found the highest-impact bugs — single-phase reviewers structurally can't).
2. **Lock cross-cutting reconciliations in `plan-brief.md`** as authoritative decisions (we used `D-A..D-R`) that override any conflicting PLAN.md text. This gives per-phase patchers and executors a single source of truth.
3. Patch the plans (parallel, one editor per file), then **re-audit** to confirm resolution + catch newly-introduced blockers (the re-audit found 1).
4. Result: all 6 phases then executed with **zero cross-phase integration failures** at close (8/8 seams WIRED, full E2E flow complete). The up-front review cost (~3 workflow runs) was far cheaper than debugging a 401-ing webhook mid-execution across a cross-repo boundary.

## Suggested nexo-forge change

Add an optional "Phase 2.5 — adversarial plan review" gate to `add-feature.md` / `plan-all.md` for milestones with ≥4 phases or any cross-repo phase: fan out per-phase reviewers + a cross-phase auditor, lock reconciliations into the brief, patch, re-audit. Cheap insurance against the exact class of bug that makes autonomous execution stall.
