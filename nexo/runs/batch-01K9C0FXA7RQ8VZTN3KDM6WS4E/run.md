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
| 02 | dialog-no-outside-close | done | feat/02-dialog-no-outside-close | PASS 2/3 | e2d8b9b | wave 1 |
| 03 | combobox-primitive | done | feat/03-combobox-primitive | PASS 2/3 | 1fb35e9 | wave 1 |
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

**Severity upgraded during 01.1 planning.** The planner found nine affected sites, not three, and the
six beyond the cadastro edit affordances are worse than the original finding suggested: the produto
área select (`SalesOpsApp.tsx:2639` via `:1109`), the wizard item área select (`:3824`), the wizard
cliente input (`:4216-4229`), the vendedor/finder selects (`:3683-3690`) and the prestador options
(`:3691-3694`) all feed a row id into a request body, so a placeholder id reaching a
`POST /sales-ops/sales` body discards an entire wizard of typing rather than merely failing one
`PATCH`.
`go()` at `:587-594` clears only `person` modals, so an área or cliente dialog survives a route
change and those pickers are reachable without dismissing anything.
Slice 02 confirmed not to close the path: every create dialog ships an always-enabled `Cancelar`
(`:3369`, `:3468`) and only the submit button is gated on `saving`.
The fix became one invariant rather than nine patches - an optimistic row is visible in the cadastro
that created it and nowhere else - via a memoised `withoutOptimisticRows(snapshot)` handed to every
consumer except the three cadastro lists.

### 02-dialog-no-outside-close - Gate 2 FAIL, attempt 1 of 3

First Verify failure of the batch, and it caught something a green suite would have hidden.

The production change is correct and Verify proved it independently rather than trusting the slice's
own tests: a throwaway probe drove the real `@radix-ui/react-dialog` in happy-dom and confirmed an
unguarded dialog fires `onOpenChange(false)` on an outside pointerdown while the branch's
`DialogContent` never fires, across three different outside sequences.
Esc and X still close, `alert-dialog.tsx`'s comment-only change was verified true against Radix
1.1.18, menus were untouched, anti-gaming was clean (two added files, zero deletions, no pre-existing
test modified), scope held, hygiene was clean, and every gate was green at web 27 files / 150 tests.

What failed is the oracle. `dialog-outside-close.test.tsx` asserts as established fact that
outside-click dismissal "provably does not fire inside happy-dom" and that a DOM-driven test "could
therefore never go Red and would be a vacuous oracle".
Both claims are false, and they are the only justification for the weaker prop-capture oracle.
Verify demonstrated two working behavioural probes with no new dependencies: `new Event('pointerdown',
{ bubbles: true })` dispatched at a sibling node outside the content, or a `MouseEvent` `pointerdown`
followed by a `click`.
The trap that misled the planner: `DialogContentImpl` passes `deferPointerDownOutside: true` and Radix
defers only when `event.button === 0`, so a lone button-0 `MouseEvent` genuinely looks inert - which
is not the same as the behaviour being undrivable.

The consequence is substantive rather than pedantic.
The shipped tests assert Radix prop names while the acceptance criterion is about behaviour, so a
future Radix rename of `onPointerDownOutside` would leave all five tests green while every dialog in
the app silently resumes dismissing on outside click - exactly the regression the slice exists to
prevent.
In fairness the prop-capture tests are not vacuous: repointed at `master`'s `dialog.tsx`, 4 of 5 go
Red including the strong "call site cannot override" case.
They are simply not sufficient alone.

Remediation sent back to the same executor: keep both source files byte-identical, delete the false
paragraph, add a real-primitive behavioural test proven to invert against `master`, keep the
prop-contract tests reframed as a complement, correct the plan file so the next reader is not misled,
and amend rather than add a commit.

### 02-dialog-no-outside-close - Gate 2 PASS on attempt 2, merged

Commit amended to `e2d8b9b`. A **fresh** Verify agent, explicitly told not to trust the remediation
claims, cleared it.

It reproduced the inversion itself rather than accepting the executor's word: it overwrote
`dialog.tsx` with `git show master:...`, confirmed byte-identity with master, ran only the behavioural
file and watched both outside-pointerdown tests fail with `onOpenChange` called once with `false`
while the Esc and X tests stayed green, then restored the branch file and verified the restore with
`git hash-object`.
It also confirmed the false claim was removed rather than reworded, that the replacement text asserts
the opposite of the old claim, and that `git diff 9a70c45..e2d8b9b` over both production files is
empty so the amend touched only tests plus the plan file.

The behavioural test settles a macrotask **after** dispatch so a deferred button-0 dismissal gets its
chance to land - it cannot pass for the wrong reason. That detail is what makes it evidence.

Residual judged acceptable rather than waved through: the type-level `Omit` has no direct
`@ts-expect-error` probe, but the verifier ran a throwaway `tsc` probe confirming the `Omit` does
reject both props with TS2322, and noted the behaviour-critical defence is the post-spread ordering,
which two verified-inverting oracles lock. Deleting the `Omit` could not resurface the user-visible
bug.

Gates: `lint=0 type-check=0 test=0`, web 27 files / 152 tests, api 23 / 215 unchanged.
Test diff 288 additions, zero deletions, no pre-existing test touched.
Menus confirmed unaffected; no dialog became a trap; `alert-dialog.tsx` comment verified true against
`@radix-ui/react-alert-dialog@1.1.18`.
Report: `verify-02-attempt2.md`.

### 03-combobox-primitive - Gate 2 FAIL then PASS, merged at `1fb35e9`

Three new files under `apps/web/src/components/ui/`, no new dependency, inline non-portalled panel.
Web 27 files / 152 tests to 28 / 181.

**Attempt 1 FAIL.** The component was correct on every acceptance clause - the verifier proved that
by dumping the real rendered markup - and 25 of 29 mutations were killed, but four survived:
the create row could be moved outside `role="listbox"` with all tests green; `aria-activedescendant`
could be pointed at a non-existent id with all tests green; `does not open when disabled` was vacuous
because a programmatic click on a `disabled` button never reaches the React handler; and the
trigger-toggle deviation shipped untested.
Two of those are clauses the acceptance criterion names explicitly, so the oracle did not cover its
own criterion.

**Remediation was test-only.** `combobox.tsx` (blob `b0cfae0d`) and `combobox-filter.ts` (`1239554b`)
verified byte-identical pre-amend, post-amend and in the worktree; the amend touched only the test
file, +55/-1 where the deletion is a renamed title.

**The executor pushed back on one finding, with evidence, and was right.** It argued that deleting
`if (disabled) return;` from `openPanel` is an *equivalent mutant* rather than a coverage hole, because
`openPanel` has exactly two callers and both are already closed while disabled.
The attempt-2 verifier adjudicated this independently rather than taking either side on faith: it
probed a disabled Combobox with 63 distinct input paths (`ref.current.click()`, dispatched clicks on
the button, inner span and chevron svg, mousedown/mouseup, focus/blur, `form.reset()`, dispatched
submit, keydown and keyup for nine keys on two targets).
All 63 leave the panel closed pristine, and all 63 still leave it closed with the guard deleted.
Claim upheld - redundant defence, not untested logic.

**Attempt 2 PASS.** All four original mutations now killed. The attempt-2 verifier ran 39 mutations of
its own and killed 35; the four survivors are all non-defects: the `openPanel` guard and
`stopImmediatePropagation` are equivalent mutants (the latter proved by probing with a native
`document` keydown listener - removing the load-bearing `stopPropagation` does go Red), while an
untrimmed `onCreate(query)` and a `overflow-y-auto` negative assertion without a positive control are
minor gaps outside the criterion.
Gates `lint=0 type-check=0 test=0`. Report: `verify-03-attempt2.md`.

**Carried forward to slice 06 (adoption), non-blocking:**

- Assert `onCreate('Maria')` for the input `"  Maria  "` - no test currently commits a create with
  surrounding whitespace.
- Add the positive half of the pinned-footer assertion; test 10's `closest(...) === null` is a bare
  negative with no positive control, so it does not lock the design it claims to.
- If a parent flips `disabled` to `true` while the panel is already open, the panel stays mounted with
  an enabled search input and keyboard commit still works. No call site exists yet, so slice 06 is the
  first place this could matter.

### Deferred: the same defect in the frozen `/admin/*` tree

`apps/web/src/admin/products/ProductsPage.tsx:80` and `:88` carry the identical defect
(`setEditProduct(product)` and `navigate('/admin/products/' + product.id)` with an
`optimistic:<appId>:<slug>` id).
It pre-dates slice 01 and `CLAUDE.md` fences the legacy `/admin/*` route tree off as unchanged, so it
is deliberately not fixed here.
Needs a human decision: a dedicated slice, or a logged doubt.
