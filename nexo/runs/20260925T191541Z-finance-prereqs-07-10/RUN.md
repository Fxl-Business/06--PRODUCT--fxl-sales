# Run record - 20260925T191541Z-finance-prereqs-07-10

Feature: Sales-side prerequisites for the Sales-Finance two-way sync, part 2 (the parked slices 07, 08, 09 of run `20260924T013019Z-finance-prereqs`, plus the migration 0018 deadlock).
Mode: autopilot.
Plan set: `nexo/plans/20260925T191541Z-finance-prereqs-07-10/`.
Plans 07-09 are the prior run's reconciled plans (`prior/plan-check-20260924.md`), revalidated and reused without a replan.
Slice 10 was planned fresh and passed its own plan-check (`checks/plan-check-10.md`).
Slices 11, 12 and 13 were inserted mid-flight (AUDIT P6, P7, P8) and used all three `replans` units.
Baseline before the run: master `2f1f406`, unit suites green, integration 268/269 (the one failure being the 0018 deadlock this run fixed).
Final master: `39a8f50`, integration 272/272.

## Preflight (Passo 0), 2026-09-25

1. Main checkout on `master`, only `?? .vscode/` untracked: PASS.
2. `master` contains `origin/master` (0 behind, 35 ahead, unpushed): PASS.
3. Every `.nexo/runs/*/status.json` is `state = done` (six runs): PASS.
4. Leftover worktree `.worktrees/20260924T013019Z-finance-prereqs/run` carries an uncommitted `budget.json` change: FAIL on "no changes", so that worktree and its branch were left untouched (AUDIT P2).
5. Slices 01-06 present on master (`7286f2c`, `46a3cd7`, `e22b29b`, `4a4045a`, `ca847d9`, `67872dd`, run branch `16591be`): PASS.
6. Plans 07, 08, 09 revalidated against `2f1f406` by three read-only agents: all VALID, only line drift, no replan.
7. Baseline: `CI=true pnpm test` exit 0 (auth-fake 35, shared-utils 155, api 652, web 985, guard tests green); integration 268/269 with the allowed 0018 `deadlock detected` failure.

## Shipped (merged to master)

Every slice merged serially after its own passing Gate 2 Verify.

| slice | goal | merge commit on master | verify attempts |
| --- | --- | --- | --- |
| 07-admin-gate-and-brl | Admin gate (PC23) on transition, cancel-contract, `PUT /sales/:id`, `PUT /settings` and on `POST /sales` with `status: 'won'`; pt-BR in-page 403 banner; currency locked to BRL | `e8ea0b9` | 2 |
| 10-migration-0018-deadlock | Every lock-taking migration unit yields (`lock_timeout` below `deadlock_timeout`) and retries its rolled-back unit a bounded number of times | `c79abed` | 1 |
| 13-fake-identity-hubauth | `applyHubAuthContext` sets `hubAuth`, so dev-fake baixa authors and seller lead scope resolve | `c20d24f` | 1 |
| 11-api-test-typecheck | `pnpm run type-check` covers `apps/api/test/**`; the 115 existing type errors fixed without weakening a test | `575bc5a` | 1 |
| 08-settlements-ui | Mark paid with a São Paulo date, reverse with a reason, settlement history; lock errors name the blocking rows | `80d425c` | 2 |
| 09-sale-deep-link | `/operacional/vendas/:saleId` opens the proposta from the URL, including cold entry through login, with a pt-BR not-found state | `416c1a2` | 1 |
| 12-month-totals | `Total pago no mês` and `Receita ganha no mês` count only the São Paulo month (by `paidOn`, by the won day); settlement visibility oracle on the real shell | `39a8f50` | 2 |

Failed first attempts:
- 07: the 403 banner on transition and cancel-contract was implemented but not asserted; removing `reportMutation` from both calls left the whole web suite green.
- 08: a baixa or estorno moved the settled payable to the end of its list, because the bootstrap reads payables with no ORDER BY and both payables tables rendered that order verbatim.
- 12: the new CLAUDE.md "Civil days" bullet held two sentences on one physical line (docs rule), with code, oracles and mutations all green.

## Integrated wave verifies

| wave | master | slices covered | result |
| --- | --- | --- | --- |
| 1 | `c79abed` | 07, 10 | PASS: lint, type-check, unit (api 678, web 998, node 55/55), integration 272/272, cold build, web bundle clean |
| 2 | `80d425c` | 13, 11, 08 | PASS: lint, type-check (now including `tsconfig.test.json`), unit (api 680, web 1048, node 58/58), integration 272/272, cold build, web bundle clean |
| 3 | `39a8f50` | 09, 12 | PASS: lint, type-check, unit (api 680, web 1083, node 58/58), integration 272/272, cold build, web bundle clean |

Each wave verify also ran a security review of its diff (admin gate fails closed, org scoping unchanged, no raw ids rendered, no integration code, no open redirect in the deep link).
`nexo-wave-exec.sh` ran without `--wave-verify` (merge only), and each wave verify was a separate agent (AUDIT P5).
No wave verify failed, so no revert was needed.

## Mutation testing

No mutation-testing tool is configured for this repository.
Each slice's Verify ran a per-slice mutation battery by hand (introduce a targeted bug, confirm the named oracle goes red, restore) in place of a tool-driven feature-level run.
Two surviving probes were judged equivalent and documented: the `admin` term in `SalesView`'s `canManage` (07) and the call-site roles in `canSettleInWorkspace` (12), both unobservable because only an admin can reach `operacional`.

## Operator notes

- Migration `0024` is still the owner's decision for staging and production; this run did not run it anywhere but local and test databases.
- Nothing was promoted and nothing was tagged.
  `master` is not pushed.
- The migration runner now yields its locks (decision record `nexo/knowledge/decisions/2026-09-25-migrations-yield-locks-to-live-traffic.md`).
  At deploy time this means:
  - The container runs `node dist/db/migrate.js` before `server.js`; a migration that meets a lock held by live traffic gives up after `floor(deadlock_timeout / 2)` (500 ms on a default or RDS server), rolls back, and retries the whole unit up to 50 times, 200 ms apart.
  - Live requests are never the deadlock victim and are never retried or masked.
  - Under about 35 s of continuous contention the migrate step exits non-zero with `migration <tag> could not acquire its locks after <n> attempts`, journals nothing of that migration, and the next start resumes from the journal.
    A failed deploy of this kind is a retry, not a data repair.
  - Before this change the same contention deadlocked (failing a user request or the deploy) or queued every request on the table behind the migration without bound.
    Production held migrations only through 0021 when this landed, so the 0024 cycle never shipped.
  - Residual risk: a future multi-table migration that scans a large table between two lock acquisitions should take every lock up front with `LOCK TABLE ... IN ACCESS EXCLUSIVE MODE`.
- The previous run's leftover worktree (`.worktrees/20260924T013019Z-finance-prereqs/run`) still carries its uncommitted `budget.json` change and was left alone.

## Parked findings and open questions

Filed on `nexo/ROADMAP.md` in this capture unless marked as already recorded.

- P9 (not a bug): a `seller` identity redirected from `/meus-dados/vendas` to `/meus-dados/vendedores` is intended; `meus-dados/vendas` is the finder's `Indicações` view.
  Showing sellers their own propostas there would be a new product view.
- P11 (parked): the root `test` script lists `scripts/__tests__/dev-identity-docs-reconciliation.test.mjs`, which was never committed; `node --test` skips the missing file and exits 0, so that docs guard has never run.
- P12 (parked): at 390px the sales-ops shell is not responsive (the sidebar never collapses, content is about 130px wide on every screen).
  Pre-existing; needs its own responsive-shell slice.
- P13 (product question): a seller-only identity sees every org payable in `meus-dados/comissoes`, because `/bootstrap` is org-scoped and `CommissionsView` renders it whole.
  Whether a seller may see other people's commissions is a product and privacy decision.
- P15 (parked): a cold entry at `/` does not clear a stale `returnTo` in `sessionStorage` (`captureReturnTo` returns early on a null sanitize), so an old value can still win after login.
  The deep-link path overwrites it (slice 09, tested).
- P16 (product question): the sidebar `A pagar este mês` sums every open payable regardless of due month, and the dashboard subtitle says `do mês` while its rankings are all-time.
  Whether it means "due this São Paulo month" and whether overdue counts is undecided; noted in `propostas.md`.
- P18 (flake): under a machine load average near 60, three API unit files (`dev-identity-production-refusal`, `dev-identity-hub-config-independence`, the `app-auth-bff-memory-path` hook) hit their 5 s / 10 s timeouts once; they pass alone and on rerun.

Full decision log: `nexo/runs/20260925T191541Z-finance-prereqs-07-10/AUDIT.md`.
