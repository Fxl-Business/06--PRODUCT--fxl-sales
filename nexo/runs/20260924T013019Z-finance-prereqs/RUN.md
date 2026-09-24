# Run record - 20260924T013019Z-finance-prereqs

Feature: Sales-side prerequisites for the Sales-Finance two-way sync.
Mode: autopilot.
Plan set: `nexo/plans/20260924T013019Z-finance-prereqs/` (plan-check verdict PASS).

## Shipped (merged to master)

All six slices below merged serially, each with its own passing Gate 2 Verify.
Slice 03 needed a second Verify attempt after a lint fix (an unused test variable); every other slice passed on the first attempt.

| slice | goal | merge commit on master | verify attempts |
| --- | --- | --- | --- |
| 01-sao-paulo-day | São Paulo civil-day helper; API "today" decisions and web due-date display stop slipping a day | `7286f2c` | 1 |
| 02-liquidacao-reducer | Pure settlement reducer with Finance parity oracles | `46a3cd7` | 1 |
| 03-ledger-schema | Migration `0024`: revision, updated_at, immutable settlements table with RLS, synthetic baixas for existing paid rows | `e22b29b` | 2 |
| 04-update-sale-in-place | API: reconcile a proposta edit by row id, void removed rows, won becomes editable, lock rows with an active baixa, revision bumps | `4a4045a` | 1 |
| 06-settlements-api | Settlement routes (mark paid, reverse, history), reducer-backed paid cache, leave-won lock, cancel-contract lock | `ca847d9` | 1 |
| 05-wizard-row-ids | Web wizard sends row ids, edits a won proposta, shows which row blocked a save | `67872dd` | 1 |

Note on the three commit shas for 01/02/03: each was merged once (`a0790a4`, `a6eeedf`, `bdbb450`), reverted once during the incident below, then reapplied byte-identical to the original merge tree.
The shas in the table are the reapply commits, which is what master carries today.

Wave 1 (slices 01-03) passed one integrated full-suite Verify after the incident repair.
Wave 2 (slice 04) and wave 3 (slices 05, 06) share one integrated full-suite Verify, dispatched after slice 05 merged, to fit the budget left after the incident.
That integrated verify was still running when this record was written; its result is not claimed here.
See `nexo/runs/20260924T013019Z-finance-prereqs/AUDIT.md` for the full incident account and every per-slice product decision taken without the human.

No mutation-testing tool is configured for this repository.
Each slice's Verify ran a per-slice mutation battery by hand (introduce a targeted bug, confirm the named oracle goes red, revert) in place of a tool-driven mutation run.

## Parked (plans complete, not executed)

Slices 07, 08 and 09 are parked.
Cause: an account-level rate-limit outage (see AUDIT.md Incidents, 2026-09-24 00:05-01:40 -03) consumed about 1.5 h of the run's 4 h active budget, and the remaining time was not enough to execute, verify and integrate three more slices safely.
Their plans are complete and already reconciled by plan-check, so no replanning is needed to resume.

Resume order (each depends on the previous):

1. `07-admin-gate-and-brl` - `requireAdmin` on the financial routes (win, revert, cancel-contract, edit sale, edit settings; the settlement routes are already admin-only from slice 06) plus removing USD from the currency setting.
2. `08-settlements-ui` - mark-paid and reverse dialogs, settlement history, in the sale detail and the payables list. Needs slice 07's `MutationErrorBanner` (extended with named blocking rows) before it can render the leave-won / cancel-contract lock errors.
3. `09-sale-deep-link` - the `/operacional/vendas/:saleId` route, including cold entry through login.

To resume: re-dispatch 07, then 08, then 09 from their existing plan files in `nexo/plans/20260924T013019Z-finance-prereqs/`, each built from master after the previous one merges and verifies. Do not replan; the plan-check reconciliation already covers all nine slices.

## Operator notes

- Migration `0024` (added by slice 03) must run on staging and production as an explicit deploy step. It backfills a synthetic `baixa` settlement for every existing `paid` receivable or payable, using `LEAST(UTC civil due day, São Paulo today)` as the migrated `paid_on`. It is the only migration this feature needs (it also adds `removed_at` to sale items and professionals for slice 04).
- Acceptance items still unmet until 07-09 land:
  - `403` for non-admins on win, revert, cancel-contract, edit sale, and edit settings (the settlement routes themselves ARE already admin-only, shipped in slice 06).
  - Removing the USD option from the currency setting (BRL-only).
  - The settlement UI (mark paid, reverse, history) on parcelas and contas a pagar.
  - The `/operacional/vendas/:saleId` deep link, including cold entry through login.
- Everything else in the dispatch acceptance list (in-place edit with preserved ids, the immutable settlements table, the settlement reducer as the one source of truth for `paid`, full-only baixa with a São Paulo default date, the active-baixa locks on row edits and on leaving `won`, revision/updated_at, and the data migration) is done and verified on master.
