---
run: batch-01K9C0FXA7RQ8VZTN3KDM6WS4E
flow: batch
milestone: v2.3.0
mode: autopilot
trunk: master
started: 2026-07-29
gate1: skipped-autopilot
plan_set: nexo/plans/batch-01K9C0FXA7RQ8VZTN3KDM6WS4E/
---

# Run: UX rails + Pessoas/Funções + Produtos & Serviços + payment builder

Frame, locked design decisions, batch-level acceptance and scope limits live in
`nexo/plans/batch-01K9C0FXA7RQ8VZTN3KDM6WS4E/00-OVERVIEW.md`.

Execution is serial-on-`master` (batch tier). `nexo-wave-exec.sh` is **not** used: it hardcodes
`main` as the trunk and this repo's trunk is `master`. The orchestrator drives the merge sequence
directly, one slice at a time, each gated by a separate local Verify agent (Gate 2).

## Queue

| # | Slice | Status | Branch | Verify | Merge SHA | Note |
|---|---|---|---|---|---|---|
| 01 | query-cache-refresh | done | feat/01-query-cache-refresh | PASS | 482d499 | wave 1 |
| 01.1 | optimistic-row-edit-guard | todo | | | | wave 1, inserted from verify-01 |
| 02 | dialog-no-outside-close | todo | | | | wave 1 |
| 03 | combobox-primitive | todo | | | | wave 1 |
| 04 | itens-section-align | todo | | | | wave 1 |
| 05 | pessoas-funcoes-api | todo | | | | wave 1 |
| 06 | combobox-adoption | todo | | | | wave 2 |
| 07 | produtos-servicos-api | todo | | | | wave 2 |
| 08 | service-description-optional | todo | | | | wave 3 |
| 09 | pessoas-funcoes-web | todo | | | | wave 3 |
| 10 | produtos-servicos-web | todo | | | | wave 3 |
| 11 | payment-plan-builder | todo | | | | wave 3 |
| 12 | proposta-overrides | todo | | | | wave 4 |

## Oracle command forms (verified 2026-07-29 - overrides any plan file that says otherwise)

`pnpm --filter <pkg> test -- --run <path>` does **not** filter: pnpm swallows the positional and all
21 web test files run (measured: 21 files / 122 tests instead of 1 file / 7 tests).
Use `exec vitest run` instead:

```bash
# web, single file
CI=true pnpm --filter @fxl-sales/web exec vitest run <path-relative-to-apps/web>
# api unit, single file
CI=true pnpm --filter @fxl-sales/api exec vitest run <path-relative-to-apps/api>
# api integration, single file (needs the local Docker test DB up)
VITEST_INTEGRATION=1 CI=true pnpm --filter @fxl-sales/api exec vitest run <path>
```

Executors must use these forms for the per-slice fast verify regardless of what their plan file
states. Full-suite wave verify stays `pnpm run lint && pnpm run type-check && CI=true pnpm test`.

## Baseline (master, pre-batch)

`pnpm run lint` exit 0 · `pnpm run type-check` exit 0 · `CI=true pnpm test` exit 0
(21 web test files / 122 web tests passing, api suite passing).

## Planning outcome (beat 2-3, complete)

All 12 planners returned PASS. Waves derived by `waves.sh` with no cycle, matching the expected
assignment exactly. Plan set committed to `master` at `7e8cb0f`.

Pre-existing defects that planning surfaced, each now owned by a named slice:

| Defect | Owner |
|---|---|
| Cross-tenant write hole: `professionals[].personId`, `sellerPersonId`, `finderPersonId` accepted from the request body as bare uuids with no org check | 12 |
| Wizard remount key built from bootstrap list contents destroys in-progress proposta state on any cache refresh (`SalesOpsApp.tsx:3644`) | 01 |
| Web margin math and the persisted `net_margin_brl` are independent implementations that already disagree | 12 |
| `addMonthsToIsoDate` overflows month ends (`2026-01-31` -> `2026-03-03`) while the API clamps correctly, so the wizard previews recurring dates the server will not write | 11 |
| `bg-popover` / `text-popover-foreground` emit no CSS - `popover` is undefined in both `tailwind.config.ts` and `index.css` - so the Select and DropdownMenu panels have no background | 06 |
| `NativeSelect` composes classes with a template string instead of `cn`, so tailwind-merge never runs and pickers render 40px next to 44px inputs | 06 |
| An unmatched cliente name yields a `clientNameSnapshot` with no `sales_ops_clients` row - the API never auto-creates one | 06 |
| Defaults re-applied during render silently discard a manually typed commission percentage (`SalesOpsApp.tsx:3772-3781`) | 12 |

Deliberately deferred to their own future slices, recorded so they are not lost:

- No Hub `account_id` on `sales_ops_people`, so "Meus dados" shows a seller every seller in the org rather than only themselves.
- `commissionOnRecurring` is a dead setting: read by the step-4 preview, ignored by the server.
- `professional_cost` re-win dedup collapse - `alreadyExists('professional_cost', null)` keys on `(kind, receivableId)` and every professional row has a null `receivableId`, so one surviving `paid` row skips all of them.
- Products with `sellerCommissionType: 'fix'` silently fall back to the org settings percentage, so a fixed-amount seller commission never reaches a proposta.

One data-safety checkpoint before any deploy: slice 07's migration zeroes `setup_brl` / `monthly_brl`
on open-price rows to admit the Serviço invariant CHECK.
Its plan requires running a `SELECT` audit query and recording the result before the migration is
applied to staging or production.
This is the only step in the batch that is not safely reversible.

### Data preservation note: `products.providers`

Slices 07 and 10 deprecate the `providers` jsonb column and remove its editor, and both deliberately
refuse to backfill it into the new função cost rows: `providers` keys on a free-text `personName`
which has no deterministic mapping to a `funcaoId`, and fuzzy name matching would attach the wrong
money to the wrong role.
Slice 10 keeps a read-only notice listing the legacy names so an operator can re-enter them by hand.
Before the later contract slice drops the column, dump the data while it is still reachable:

```sql
SELECT id, name, providers FROM sales_ops_products WHERE jsonb_array_length(providers) > 0;
```

## Slice log

### 01-query-cache-refresh - done

Executed on `feat/01-query-cache-refresh`, one atomic commit `482d499`, 20 files, +1571/-224.
Gate 2 PASS by an independent Verify agent: `lint=0 type-check=0 test=0`, web 25 files / 143 tests,
api 23 files / 215 tests, shared-utils 1 / 17.
Verify confirmed the load-bearing tests genuinely invert on revert (the optimistic assertion flips to
an `EmptyPanel`, the rollback assertion flips to a surviving row), that no pre-existing test was
modified at all (four added files, zero deletions in test code, counts reconcile 21+4 and 122+21),
that scope held, and that the diff net-removes em dashes.
Report: `verify-01.md`.

Forced plan deviation, mechanical and behaviour-preserving: `@tanstack/react-query` is 5.101.2, whose
`onSettled` / `onError` callbacks take five arguments rather than the four the plan sketched, so the
wrapper forwards all five and names the fourth generic `TOnMutateResult` to match the library.

Root cause of the reported symptom, for the record: the invalidation was never missing.
`setModal(null)` closed the dialog while a ten-sequential-`SELECT` snapshot refetch was still in
flight, and `isLoading` was already `false`, so the list rendered stale with no pending affordance.

**Slice 01.1 inserted from the Verify report.** `isOptimisticId` ships exported but unused, so an
operator who dismisses the create dialog mid-POST (Esc still closes it by design, and slice 02
deliberately keeps Esc working) can click edit on the still-optimistic row.
That id is captured into React state and stays stale after reconcile, sending
`PATCH /areas/optimistic:areas:<name>` which fails the Postgres uuid cast with a 500.
Same shape for clientes and pessoas.
Low severity - a rejected request inside a one-round-trip window, no duplicate row and no
corruption - but it is a real defect with an already-exported guard sitting unused, so it gets its
own small slice rather than being folded into a verified commit.
Verify also noted the `onSuccess` reconcile wiring has no test that can fail, since the refetch
overwrites the whole snapshot and ids are never rendered; the pure `reconcileOptimisticRow` function
is covered. Slice 01.1 should close that gap too.
