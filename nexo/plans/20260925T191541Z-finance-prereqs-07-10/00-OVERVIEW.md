---
id: 00-OVERVIEW
milestone: v4.1.0
run: 20260925T191541Z-finance-prereqs-07-10
mode: autopilot
---

# Finance prerequisites, part 2: slices 07, 08, 09 and the 0018 flake

## Request (verbatim source)

The request is `nexo/playbooks/sales-finance-integration/04-prompt-sales-slices-07-09.md`, pasted as the invocation.
In short:
- 07-admin-gate-and-brl: `POST /sales`, `POST /sales/:id/transition`, `POST /sales/:id/cancel-contract`, `PUT /sales/:id` and `PUT /settings` admin-only, currency locked to BRL.
  It is also the Hub's G2 gate for turning the integration on in production.
- 08-settlements-ui: mark as paid (with a date), reverse (with a reason), and see the history.
- 09-sale-deep-link: `/operacional/vendas/:saleId` opens the proposta from the URL and survives a cold entry (login and back to the proposta).
  The Finance "Editar no Sales" button will use this path.
- New slice: the migration 0018 concurrency test deadlocked once and then passed.
  Reproduce it, find the cause, fix the instability in the test or in the code without weakening what it proves.
- Out of scope: the whole integration layer (outbox, feed, puller, inbox, ticket); any promotion or tag; running migration 0024 in staging or production.

## Acceptance

- The acceptance lists of `07-admin-gate-and-brl.md`, `08-settlements-ui.md`, `09-sale-deep-link.md` and `10-migration-0018-deadlock.md` in this folder.
- No integration code, no promotion, no tag.

## Passo 0 (preflight), 2026-09-25

1. Main checkout on `master`; `git status` shows only `?? .vscode/`. PASS.
2. `master` contains `origin/master` (0 behind, 35 ahead, unpushed). PASS.
3. Every `.nexo/runs/*/status.json` has `state = done` (six runs). PASS.
4. Leftover worktree `.worktrees/20260924T013019Z-finance-prereqs/run`: the run is `done` and `nexo/20260924T013019Z-finance-prereqs` is contained in `master`, but the worktree has an uncommitted change (`nexo/runs/20260924T013019Z-finance-prereqs/budget.json`: `active_accumulated_seconds` 0 -> 13585, `paused` false -> true).
   FAIL on "no changes", so the worktree and the branch were left as they are.
5. Slices 01-06 on master: merges `7286f2c`/`46a3cd7`/`e22b29b` (Reapply of 01, 02, 03 after the three wave-1 reverts), `4a4045a` (04), `ca847d9` (06), `67872dd` (05), and `16591be` (run branch). PASS.
6. Plans 07, 08, 09 revalidated against `2f1f406` by three read-only agents: all VALID, only line drift; notes appended to each plan under "Revalidation 2026-09-25". No replan.
7. Baseline: `CI=true pnpm test` exit 0 (auth-fake 35, shared-utils 155, api 652, web 985, plus the guard tests); `pnpm --filter @fxl-sales/api test:integration` 268/269, the one failure being the 0018 test `upgrades populated forced-RLS data in resumable phases while traffic continues` with `PostgresError: deadlock detected`. That is the allowed exception, so the run continues.

## Slices and waves

| slice | depends_on | wave |
| --- | --- | --- |
| 07-admin-gate-and-brl | - | 1 |
| 10-migration-0018-deadlock | - | 1 |
| 08-settlements-ui | 07 | 2 |
| 09-sale-deep-link | 08 | 3 |

Plans 07-09 are the parked plans of run `20260924T013019Z-finance-prereqs`, already reconciled by that run's plan-check (`prior/plan-check-20260924.md`).
Slice 10 is planned fresh in this run and gets its own plan-check.
