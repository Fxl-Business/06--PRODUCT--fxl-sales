# AUDIT - 20260928T220106Z-sales-finance-control-plane

Autopilot run. This file records decisions taken without the human, drift from the Hub prompt (dated 2026-09-24) found in current code, and any parked/blocked work.

## Passo 0 findings (preflight, all resolved)

- **Clean-tree blocker (resolved by human choice).** At start the tree had uncommitted work outside `.vscode/`: the paused, different-feature planning run `hub-sdk-25-switch-account-invites` (9 slice plans + run artifacts). Per the operator prompt this is a hard STOP. Surfaced to the human, who chose "commit the parked run, then go". Parked as its own atomic commit `ba0fd82` (`chore(nexo): park paused hub-sdk-25-switch-account-invites planning run`); its live Finance twin was not touched.
- **Sibling run status.** `.nexo/runs/20260928T184208Z-hub-sdk-25-switch-account-invites/status.json` shows `state: running` but is a stale/parked discuss-mode run (mode discuss, no live process, ~3h since last update, waiting at Gate 1). Judged safe to run alongside; this run touches none of its files.
- **G5.** `@fxl-business/fxl-contracts@0.1.0` is published; all 32 root symbols + both `/testing` symbols export; fake authority does not leak into the root barrel; `schema/integration-transport.sql` ships; zero runtime/peer deps.
- **Baseline green before any change:** unit 1953 (auth-fake 35 + shared-utils 155 + api 680 + web 1083); integration 272.

## Drift from the Hub prompt (prompt written 2026-09-24; code changed after)

- **Role gate (§7, §10) is ALREADY DONE (PC23).** The prompt says five sales-ops routes lack a role gate. In current code only `POST /sales` (routes.ts:320) is ungated, and that is deliberate (seller lead-conversion path, with a body-level admin check rejecting a non-admin `status:'won'`). `POST /sales/:id/transition` (:349), `POST /sales/:id/cancel-contract` (:367), `PUT /sales/:id` (:387), `PUT /settings` (:458) are already `requireAdmin`. **Decision:** the section-10 "gate before production" is NOT rebuilt in this run; noted as satisfied.
- All other §7/§2 claims about this repo verified CONFIRMED against live code (PC2 in-place `updateSale`, `sales_ops_settlements` with `origin in ('manual','finance')` + `FXS01` trigger, `reduzirLiquidacao`, settlement routes `requireAdmin`, `statusCacheDaLinha`, `revision`+`updated_at`, `SALE_TRANSITIONS`, active-baixa can't-leave-won guard, SP-day dates, `asDateOnly` intentional). None rebuilt.

## Decisions taken without the human (HOW)

- **Migration numbering.** Highest committed migration is `0024`. The parked `hub-sdk-25` run planned a `0025` for a sellers-invitation schema, but that is NOT in code (parked). This run takes `0025_integration_transport` for the transport DDL. If the parked run later resumes it must renumber; recorded here so the collision is visible.
- **Execution topology.** Location test says Main checkout. This project uses the orchestrator+dispatch model, but no live executor/Harness is consuming dispatches (the sibling run is parked). Per standalone mode (`standalone.md`) and the operator's intent ("execute" + "end with a local E2E"), this session acts as the standalone orchestrator and builds via sub-agents/worktrees. Autopilot stops at LOCAL `master`; per the operator override there is NO `git push` and NO promotion/tag.
- **Harness fit for the sub-agent handshake.** Claude Code delivers reliable completion notifications, so those are used as the "finished" signal and each agent's durable `result.json` as the verdict (files as the medium, never the task registry). `status.json` is updated at phase boundaries rather than via background heartbeat processes, to avoid leaving stray processes running.

## Decisions resolved during planning (recorded, not asked)

- **deepLinkPath: emit the warm path.** The published `OBLIGATION_UPSERTED_V1_SCHEMA` marks `source.deepLinkPath` as REQUIRED, so omitting it is impossible. Emit `/operacional/vendas/<saleId>` (byte-matching the web `buildSaleDetailPath`). The cold-entry (no-session) route remains a separate, out-of-scope gap; the warm path resolves for a signed-in operator. (slice 03)
- **Outbox prune low-water: fail-closed `null`.** The five Application-facing Hub routes expose no consumer-cursor read, so the low-water is unknowable in the pilot (and absent in fake mode). `resolveOutboxLowWater()` returns `null`, so the nightly prune deletes nothing and never drops below `OUTBOX_MIN_RETENTION_DAYS` (30). (slice 08)
- **voidReason strings:** `contract-reverted` (won->open), `contract-cancelled` (cancelContract), `edited-out-of-plan` (updateSale). (slice 07)
- **disputed / "registrada em duplicidade" are pure derivations,** via a new `deriveSettlementAnomaly` (disputed = active baixa on a voided row; duplicidade = overpaid with >1 active baixa). No new status enum, no new column; the immutable `origin='finance'` fact is what is recorded, and `statusCacheDaLinha` stays mirror-parity-locked. (slice 04)
- **kind/role taxonomy on obligation events:** kinds `sale_installment|sale_recurring|seller_commission|finder_commission|professional_cost|tax|other_cost`; roles `client|seller|finder|professional|tax|other`. Only `tax` maps to a `syncedObligationSubset`-excluded kind (indefinite recurrence is already excluded upstream; affiliate `payouts` is a different system, out of scope). NOTE: the package golden example uses `role:"customer"` where this repo uses `client` - divergence flagged for the executor to confirm against the live schema. (slice 03)
- **Connected-org gate:** a single default-closed boot-injected predicate `isProducerFlowLive(orgId)`; unconnected orgs behave byte-identically to today and existing unit tests stay green with no edits. (slice 07)
- **Consumer version policy:** `SUPPORTED_FINANCE_SETTLEMENT_VERSIONS=[1]` (N, N-1); a permanent reject (unknown version/bad shape/non-finance origin/amount mismatch) counts toward `rejectedCount` and advances the cursor past the poison event; only a reversal citing a not-yet-landed baixa throws to retry. (slice 04)
- **Migration 0025** confirmed free (journal ends idx 24); RLS uses the sales_ops two-policy model (tenant_isolation on `app.current_org_id` + admin_context on `app.fxl_admin`) on the three org-scoped tables, admin-only on the global counter. (slice 01, consistent with 03/04/05)

## Tooling issue handled

- **`waves.sh` block-list frontmatter trap.** Several planners wrote `depends_on`/`files_modified` as block-list YAML; `waves.sh` only parses inline arrays and silently collapsed 04/05/08/09 into wave 1 (which would build file-overlapping slices concurrently). Normalized all nine plans' `depends_on`/`files_modified` to inline `[...]` form; re-derived waves are W1={01} W2={02,03,06} W3={04,05} W4={07,08} W5={09}, file-disjoint within each wave.

## Cross-process E2E gaps (no real Finance app / real Hub in this repo)

- The in-repo E2E (slice 09) drives the CONSUMER cases with a simulated Finance feed through the package's `fetchFeedPage` seam (real inbox/cursor/handler run; only the network fetch is doubled) and the PRODUCER cases against this app's own feed route with fake-authority tickets.
- The fake authority's ticket verify is per-instance (a verifier accepts only tickets its own instance issued), so a true cross-process ticket handshake is not exercisable here. Untested until the Finance side of the layer and a shared/real Hub exist: true two-app cross-process delivery, cross-process ticket introspection, and end-to-end convergence with the real Finance producer/consumer. Slice 09 lists the exact cases verbatim.
