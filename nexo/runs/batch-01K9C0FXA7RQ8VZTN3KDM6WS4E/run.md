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
| 01.1 | optimistic-row-edit-guard | done | feat/01.1-optimistic-row-edit-guard | PASS 1/3 | 320668c | wave 1, inserted from verify-01 |
| 02 | dialog-no-outside-close | done | feat/02-dialog-no-outside-close | PASS 2/3 | e2d8b9b | wave 1 |
| 03 | combobox-primitive | done | feat/03-combobox-primitive | PASS 2/3 | 1fb35e9 | wave 1 |
| 04 | itens-section-align | cancelled | - | - | - | wave 1, executor stopped by the user - awaiting a human decision |
| 05 | pessoas-funcoes-api | done | feat/05-pessoas-funcoes-api | PASS 2/3 | 69feb51 | wave 1 |
| 06 | combobox-adoption | done | feat/06-combobox-adoption | PASS 2/3 | 762232b | wave 2 |
| 07 | produtos-servicos-api | done | feat/07-produtos-servicos-api | PASS 1/3 | 5859b80 | wave 2 |
| 08 | service-description-optional | done | feat/08-service-description-optional | PASS 1/3 | 045bd72 | wave 3 |
| 09 | pessoas-funcoes-web | done | feat/09-pessoas-funcoes-web | PASS 2/3 | 12aa1dc | wave 3 |
| 10 | produtos-servicos-web | done | feat/10-produtos-servicos-web | PASS 3/3 | e356c99 | wave 3 |
| 11 | payment-plan-builder | done | feat/11-payment-plan-builder | PASS 2/3 | 39103eb | wave 3 |
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

### 07-produtos-servicos-api - Gate 2 PASS first attempt, merged at `5859b80`

`type` renamed to `kind` (`'product' | 'service'`) with DB CHECKs, `open_price` surviving as a
CHECK-enforced projection of `kind` and still accepted on the wire as a deprecated alias, six
default-config columns, and `sales_ops_product_funcao_costs` as a child table with a composite
`(org_id, funcao_id)` FK. Migration 0013. `materializeDefaultPaymentPlan` ships as the normative
template-to-installments reference that slice 11 mirrors.
api unit 24 files / 248 tests to 27 / 283; integration 16 / 73 to 18 / 88. `apps/web` byte-untouched.

The verifier proved rather than read every load-bearing claim. It rolled the database genuinely back -
dropped the table, six columns and seven CHECKs, renamed `kind` back to `type`, deleted the journal row -
seeded a **contradictory legacy row** (`open_price=true` carrying `250000/9900`), and replayed via
`globalSetup`; the post-replay catalog was byte-identical apart from the journal surrogate id.
It mounted the real unmocked router and sent the byte-exact body `master`'s product dialog builds, so the
deprecated `openPrice` alias is confirmed working and `master` is not broken in the window before slice
10. Eight contradictory raw superuser writes were all rejected by the CHECKs, so `kind`/`open_price`
drift is impossible. The cost-set replace held atomic under 40-way concurrency including the empty-list
case, and a mid-replace FK failure rolled back with the original set intact.
`materializeDefaultPaymentPlan` was checked against seven adversarial vectors: every one sums exactly,
in integer cents, with correct month-end clamping.

**The RLS-masking finding reproduced a second time.** Deleting the cost-row `orgId` filter left all eight
app-role tests green, and only the admin-connection test caught it. Two slices in a row now, which makes
it a property of this test suite rather than a one-off.
The verifier also identified the two `updateProduct` filters as **equivalent mutants singly** - each
backstops the other, and removing both is caught - and said so explicitly rather than counting it as a
defect.

**A pre-existing defect proven, not merely suspected.** 30 parallel `POST /products` with a duplicate
`codeSuffix` returned `{"500":29,"201":1}` from an unhandled `23505`. Rather than reason about
attribution, the verifier created a throwaway database and a `master` worktree and ran the identical
probe against master's own code: `sequential: 201 500, parallel: {"500":20}`. Identical, so it is
pre-existing and not introduced here. It needs its own slice; the codebase's own `'duplicate'` sentinel
idiom from `createArea` is the fix.

Judged acceptable on merit: the additive `entrada_mode_value_mismatch` extension (it genuinely prevents a
500 of the same class slice 05 shipped, and is strictly additive so slices 08/10/12 are unaffected), and
deferring the 121-installment ceiling edge to slice 10's editor (pinned by a test, not yet wired to any
endpoint, and fails as a clean 400 - clamping server-side would silently drop an operator's parcela).
The plan's Risk 16 correction was upheld: `apps/web/src/sales-ops/types.ts` is a hand-written mirror, so
the API rename does not touch web typing.

Report: `verify-07.md`.

### Wave 2 integration gate - green

Integrated `master` at `603a324` after slices 06 and 07: `lint=0 type-check=0 build=0`, unit web 30 / 210
and api 27 / 283 and shared-utils 1 / 17, integration 18 / 88.

### 08-service-description-optional - Gate 2 PASS first attempt, merged at `045bd72`

User item 7. Web 30 files / 210 tests to 31 / 220, one new test file, zero existing test files edited.

**The trap and the near-miss.** The requirement lived in one boolean fusing the description check and
the negotiated-value check, so a careless relaxation drops both. The executor split them - but its first
zero-value test **stayed green** under the fused-form mutation, because `canAdvanceStepOne` is
`canSaveBasics && itemsValid` and `canSaveBasics` already demands `totalCents > 0`, so a lone zero-value
row is blocked by the total even when `itemsValid` wrongly passes. It restructured the test to park a
priced produto in row 2, isolating `itemsValid` as the only possible blocker, and the mutation then went
Red properly.

The verifier settled that confound in **both** directions rather than accepting the account: with row 2
present the test is Red under the mutation, and with row 2 removed the identical test stays green. The
second row is genuinely load-bearing.

**An unreachable branch handled well.** Slice 07's `CHECK ((kind = 'service') = open_price)` makes
`kind='product'` with `openPrice=true` DB-impossible, so that truth-table row cannot occur in production.
The executor declined to fabricate a DB-impossible fixture, and the verifier agreed - but also found the
branch is pinned anyway, because the web mirror makes `kind` optional so the reachable analogue is
kind-absent plus `openPrice` true, which the test does cover.

**A gap in slice 07's delivery, closed here.** Slice 07's `files_modified` listed
`apps/web/src/sales-ops/types.ts`, but commit `5859b80` touched zero web files, so the web mirror still
declared a `type` column the API had renamed away and had no `kind` at all. This slice added
`kind?: SalesOpsProductKind` as a fourth file beyond its own plan. Optional, so the 10 existing product
fixtures need no churn.

**A deliberate deviation judged better than the plan.** The plan said not to lift the requirement pair
into a helper at its two call sites; the executor lifted it into `productRowRequirements` anyway, because
those two sites are a validity gate and its own error rendering - if they disagree the wizard blocks with
no visible reason. The verifier upheld this and swept the whole gate: every conjunct implies a rendered
error, so there is no silent-block path.

**One inaccuracy to correct when the file is next touched.** The code comment and commit message justify
the `|| 'Produto'` terminator with "`ProductSchema.name` is `.min(1)` without `.trim()`". That is false -
it is `z.string().trim().min(1).max(140)` at `service.ts:174`, including on `master`, so the API already
rejects a whitespace-only name. The terminator is still load-bearing against an empty snapshot (proven by
mutation), but the stated rationale is wrong.

**Pre-existing issue handed to slice 10:** `productType: product?.type ?? 'SaaS'` now always takes the
fallback, since the API stopped returning `type`. Harmless today because the API strips `productType`,
but it is a type-level lie, and fixing it touches 10 fixture files plus the product dialog.

Report: `verify-08.md`.

### 09-pessoas-funcoes-web - Gate 2 FAIL then PASS, merged at `12aa1dc`

User item 11, web half. `cadastros/pessoas` and `cadastros/funcoes` replace the two special-cased
Vendedores and Finders screens; `vendedor` and `finder` become immutable predefined funções rendered with
a disabled `Lock` rather than an edit action that must fail. Web 31 files / 220 tests to 32 / 240.

The routing trap was handled correctly: "Vendedores" and "Finders" were never two screens but one
component with a `mode` prop that `meus-dados` also reuses, so the legacy `/cadastros/vendedores` alias is
scoped to the cadastros workspace. Dropping that scope fails 8 tests.
Dropping the three legacy booleans from the web type produced 26 type errors, all in fixtures and none in
source - the mechanical proof no web code reads a deprecated mirror. 14 test files churned, not the 7 the
plan predicted, because slices 01.1, 06 and 08 had added more since.

**Attempt 1 FAIL - a silent visibility narrowing in a slice mandated visibility-neutral.** `master` had
**two different** prestador pools: `ProductDialog` filtered only on `isCollaborator`, while the wizard memo
also required `status === 'active'`. The new `collaboratorPool` helper unified them, so an inactive pessoa
carrying a custom função silently stopped being offered in the produto picker. Coupled to that, a
`CLAUDE.md` sentence claimed the helper matched "exactly how the API derives `is_collaborator`", which was
false: `deriveBooleanMirrors` has no status component.

The executor accepted the finding and went further than the report - it discovered the two-pool asymmetry
the first verifier had not identified, replaced the pre-filtered pool with a per-person
`isCollaboratorPerson` predicate, moved the status filter back to the one call site that had it, commented
both sites, and added a `CLAUDE.md` bullet warning not to unify the pools without deciding and pinning the
behaviour. It also closed a carried-forward debt (the `MeuPainelView` slug-swap mutation, which survived on
`master` too) and explained why its own original mutation missed it: it had used a bogus slug rather than
swapping, and the fixture person carried both funções.

**Attempt 2 PASS.** The verifier proved population equivalence empirically rather than by reading, with a
seven-person probe set - inactive plus custom função, prestador-only, archived função, system-only,
vendedor plus prestador, inactive system-only, and no função - each carrying `deriveBooleanMirrors`-computed
booleans so both sides read the same payload. Produto and wizard pickers matched `master` exactly, with the
inactive pessoa offered by one and withheld from the other. The produto side was driven through the full
`SalesOpsApp`, so the wiring was under test rather than just the dialog.
It confirmed every edited `CLAUDE.md` sentence is now true, including that line 70's narrower claim is
correct where the broader one would have been false, because `headerAction` still yields "Nova proposta" on
`/meus-dados/vendas` and `/meus-dados/comissoes`.
Reports: `verify-09.md`, `verify-09-attempt2.md`.

**Three false `CLAUDE.md` sentences so far in this batch** - one blocked slice 06, one was a pre-existing
ambiguity slice 09 rewrote, and this one. Treating a false rule there as a real defect is deliberate:
`CLAUDE.md` is the standing instruction set every future agent in this repo reads.

**Follow-up recommended, deliberately not smuggled in:** filtering inactive pessoas out of the produto
Prestador picker does look like the better behaviour. Scope is one call site, the asymmetry bullet, and
inverting the new test's assertion rather than deleting it. Blast radius is low because the field stores a
name snapshot with a free-text `onCreate`, so an already-saved inactive prestador keeps rendering either
way and only the suggestion list changes.

### 10-produtos-servicos-web - Gate 2 FAIL, FAIL, then PASS, merged at `e356c99`

User items 5 and 9. `cadastros/produtos` (route unchanged) is labelled "Produtos & Serviços" with a
`Produto | Serviço` segmented filter over one table and per-kind columns; the dialog adapts by kind via
sections, gains a default payment plan template over the six flat columns and a `Custos padrão por função`
editor, and the `Preço em aberto` switch is gone because `openPrice` is a server-written projection of
`kind`. Web 32 files / 240 tests to 34 / 288.

The executor declared **seven behaviour changes with tests** rather than shipping any silently - the right
response to slice 09 being blocked for a silent one. All seven were judged acceptable on merit.

**Attempt 1 FAIL - an archived función made its cost row read as unset.** `eligibleFuncoes` filtered to
active non-system funções and the per-row escape hatch operated *inside* that filtered list, so a stored
cost row whose función had been archived rendered with a placeholder trigger. No data loss, but the row read
"R$ 300,00 for no função", the value was unrestorable, and picking anything silently retargeted the cost.
Funções here are never deleted, only archived, so this was the expected end state rather than an edge case,
and it contradicted a convention `CLAUDE.md` documents one section above.

The executor found a **second symptom of the same root cause** that the report had not identified:
`allFuncoesUsed` compared `usedFuncaoIds.size` against `eligibleFuncoes.length`, so an archived-función row
consumed a slot in a pool it is not in and wrongly disabled `Adicionar` while an assignable função was free.
It also **declined the prescribed `valueLabel` fix**, correctly arguing that `valueLabel` alone repairs
display while leaving the value unrestorable and retargeting silent. Admission into the row's options is the
load-bearing half; `valueLabel` was given a reachable job instead, so an unresolvable id reads
`Função não encontrada` rather than a placeholder and never a raw uuid. The verifier judged this the better
call.

**Attempt 2 FAIL - `CLAUDE.md` then asserted the opposite of the fix.** The bullet still read "The função
cost picker offers active, non-system funções only", which the fix deliberately violates. Since this repo
declares `CLAUDE.md` overrides default behaviour, as written it instructed the next agent to remove the
escape hatch - and slice 11 rewrites that exact region next.

**Attempt 3 PASS.** The clause was split into two individually-true bullets, and while drafting the
replacement the executor caught a **fifth** false sentence before shipping it: its draft claimed the escape
hatch follows "the same rule as the pessoa assignment picker", which is false because the Pessoa dialog
splits the job across two controls - `assignedFuncoes` resolves unfiltered so chips survive, while
`selectableFuncoes` filters to active with no prepend, so an archived função genuinely does vanish there. A
cost row is one control doing both jobs. The verifier upheld that reading independently and confirmed the
named precedent (`selectableAreas` in the same dialog) has the claimed shape.
It also proved the amend was documentation and formatting only by getting a byte-identical
whitespace-stripped md5 on the `ProductsView` region, so attempt 2's clean functional findings transferred.
Reports: `verify-10.md`, `verify-10-attempt2.md`, `verify-10-attempt3.md`.

**A methodological correction the orchestrator got wrong.** The whitespace check was originally specified as
`git diff -w`, which is **structurally blind to added lines** - so the instrument could not have caught what
was actually wrong. Prettier at the repo's own config is the right tool, and it is not installed, so
`pnpm exec prettier` fails silently and returns empty output; `pnpm dlx prettier@3` is required. Measured
end state: 23 whitespace-only deltas on the branch against master's 27, with **zero attributable to the
branch** - `ProductsView` is now cleaner than master, which carried 12 drift lines there.

**Two non-blocking items recorded:** `SalesOpsApp.tsx:3289-3295` has `const usedEligibleCount` at 4 spaces
where its siblings are at 2 (it escaped the whitespace metric legitimately but by luck, since the re-wrap
made prettier classify it as content reflow), and `CLAUDE.md:93` calls the list filter bar `Produto | Serviço`
in the singular while the rendered segments are plural.

**Data-loss window restated:** the `providers` removal omits the key on write so a PATCH cannot clear the
deprecated column - verified byte-identical against the real database, with `providers: []` as the control
that does clear it. Before any later slice drops the column, run the audit query recorded above.

### 11-payment-plan-builder - Gate 2 PASS, then an orchestrator-requested amendment, merged at `39103eb`

User item 10. Wizard step 2 is declarative: `Entrada (nenhuma | % | R$ fixo)` plus `Restante em N x` plus
`Recorrência`, always visible, regenerating the parcelas table live. `Dividir em`, `Dividir`, `+ parcela`,
`Remover parcela N`, `Prazo indeterminado`, `Adicionar recorrência` and `Número de parcelas` are all gone.
Generation, rounding, due-date and round-trip rules are pure exported functions in `calculations.ts`.
Web 34 files / 288 tests to 35 / 320.

**The mockup's own arithmetic was wrong and was not copied.** `3 x R$ 12.166,67` is one cent over the total,
so the hint renders `3 x R$ 12.166,66 (última R$ 12.166,68)`. It can never state a value the table lacks.

**A real pre-existing date bug fixed.** The web's `addMonthsToIsoDate` overflowed month ends
(`2026-01-31` to `2026-03-03`) while the API's `addMonths` clamps to `2026-02-28`, so the wizard previewed
recurring due dates the server would never write for any base day 29 to 31.

**The executor found a bug in its own plan's test spec.** The Red case for "infers a fixed entrada when the
percentage is not clean" used rows `100000/100000/100000` against a 300000 total, which *is* an exact even
3x split, so `nenhuma + 3x` is the truthful inference. Rewritten with rows where the entrada genuinely
differs, plus an even-split positive control.

**It also caught the edit path inventing data:** a proposta with `recurringBrl > 0` and zero `M` receivables
was prefilling ciclos as `'12'`, fabricating a bounded plan. Now blank.

**A contradiction in the orchestrator's own brief, surfaced rather than papered over.** It was told both to
mirror the API's `materializeDefaultPaymentPlan` exactly and to reuse `splitInstallmentsEqually`. Those
conflict: the web helper puts the floor remainder on the **last** restante row, the API on the **first**. It
followed the mandated helper and documented the divergence. The verifier ruled deferral correct, since
unifying would require either editing `apps/api/**` or abandoning a helper whose last-row remainder is pinned
by a pre-existing master test. `materializeDefaultPaymentPlan` genuinely has no production caller.

**First Gate 2 PASS**, with money exactness probed across 13 totals by 3 modes by 18 entrada values by 7
counts plus a DOM grid, and no false positive in `inferPaymentPlanShape` across 25,000 cases. It flagged two
non-blocking items.

**The orchestrator declined to merge on the PASS and requested an amendment**, because one of those was a
latent money bug: `generateInstallmentPlan`'s docstring promised exactness while `.slice(0, MAX)` trimmed the
tail - and the tail carries the floor remainder. Unreachable from the UI only because the clamp lived in the
caller rather than in the pure function making the promise, which is backwards for a layer extracted
specifically to be called directly. The Red test made it concrete: **R$ 7.500,00 vanished** at
`restanteCount: 120` with an entrada. `maxRemainingInstallments(entradaMode)` now lives in `calculations.ts`
as the single definition, `restanteCountFor` clamps against it, and the `.slice` was deleted rather than kept
as a guard.

**Amendment PASS.** The verifier ran 128 direct calls at the boundary plus a 1365-case hostile sweep
(negative, `NaN` and `Infinity` entradas and counts, entrada equal to and above total) plus an exhaustive
counts 1 to 300 sweep on an indivisible total: every sum exact, every row count within `[1,120]`. It
confirmed the fix was load-bearing by reconstructing the pre-amendment code and watching the probe fail with
`expected 100000 to be 100001`. It upheld the executor's honest report that re-adding the `.slice` now stays
green, proving it an equivalent mutant rather than a coverage gap by tightening it to `.slice(0,119)` and
watching the repo's own committed test go Red.
Reports: `verify-11.md`, `verify-11-amendment.md`.

**Sixth false `CLAUDE.md` sentence, corrected.** Its note on the remainder divergence claimed an
API-generated uneven split reads as hand-edited; in fact the no-entrada case `[33334, 33333, 33333]` reads as
`fix entrada 33334 + 2x` with `matchesFormula: true` - mislabelled rather than misread. The correction was
made executable by a test pinning all three inference cases.

**One imprecision recorded, not fixed:** the corrected sentence says the no-entrada case reads as an `R$ fixo`
entrada. Across 10,296 such plans all read as a formula and reproduced rows to the cent, but **37 read as
mode `pct`** rather than `fix` (for example total 400 giving `[134,133,133]` and `{pct, 33.5, 2}`). The
described outcome holds universally; only the mode qualifier is incomplete. Suggested wording: "usually
`R$ fixo`, occasionally a clean `%`".

**Two more items recorded for later:** a proposta whose receivables are all `void` (won, cancel-contract,
revert to open) opens step 2 with an R$ 0,00 row where master auto-generated a full-total row - exotic,
recoverable with one nudge of `Parcelas restantes`, and nothing invalid can be saved meanwhile. And
`defaultPlanShapeForProduct` clamps to the raw 120 rather than the entrada-aware ceiling, so a template with
an entrada plus 120 parcelas would display 120 while generating 119; money stays exact and the cadastro
clamps on save, so it is unreachable through the UI.

### SAFETY: `db:migrate` reads the staging `DATABASE_URL`

Found while executing slice 07 and worth stating loudly, because a plan step caused it.

`apps/api/src/db/migrate.ts` reads `DATABASE_URL` with no test override, and `apps/api/.env` sets
`DATABASE_URL` to **staging**. So `pnpm --filter @fxl-sales/api db:migrate` applies pending migrations
to staging. Slice 07's own plan contained a Green step that, followed literally, would have migrated
staging by accident. The executor recognised this and never ran it.

The safe local path is the integration suite's `globalSetup`, which migrates via
`TEST_MIGRATE_DATABASE_URL` against the local Docker DB. Never use `db:migrate` to migrate locally.

Corollary for the irreversible step in this batch: slice 07's pre-migration data audit found 0 product
rows and 0 rows that would be altered, but it ran against the **local** database, which is empty.
That result says nothing about staging or production. The audit query must be re-run against the real
target before 0013 is applied there:

```sql
-- re-run against the REAL target before applying 0013
SELECT id, name, open_price, setup_brl, monthly_brl
FROM sales_ops_products
WHERE open_price = true AND (setup_brl <> 0 OR monthly_brl <> 0);
```

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

### 04-itens-section-align - cancelled mid-build, awaiting a human decision

The executor was stopped by the user partway through the Green phase.
It had modified `SalesOpsApp.tsx` (+255/-207 versus `master`) and written an untracked test file, with
no commit and no result file, so the tree held a half-applied change to a 5200-line file.

The partial work was preserved as a 522-line patch plus the 349-line test in the session scratchpad
(`slice-04-cancelled-partial.patch`, `slice-04-cancelled-test.tsx`), the working tree was restored and
the branch deleted, so `master` was never touched.
Nothing depends on this slice - it is a pure leaf - so the rest of the batch proceeds regardless.
The human chooses: redo with a fresh agent on the same plan, resume from the preserved patch, or drop
the slice.

### 05-pessoas-funcoes-api - Gate 2 FAIL then PASS, merged at `69feb51`

The largest and most consequential slice in the batch: `sales_ops_funcoes` and
`sales_ops_person_funcoes`, migration 0012 with an RLS-bypassing data backfill, funções CRUD, and
`funcaoIds` as a set-replace on the existing `/people` endpoints.
api unit 23 files / 215 tests to 24 / 248; integration 13 / 47 to 16 / 73.

**A methodological finding worth keeping.** Mutation testing exposed that this repo's tenancy tests
can be silently satisfied by database RLS rather than by the service filter `CLAUDE.md` mandates:
deleting `eq(salesOpsFuncoes.orgId, orgId)` from `listFuncoes` originally survived, because the
non-superuser role's RLS policy covered for it.
The fix is to drive the same service functions over an `app.fxl_admin` connection, where the
admin-context policy exposes every org and only the explicit filter can scope the result.
**The same blind spot exists in `apps/api/test/rls/areas-rls.test.ts` today** - its tenant assertions
would also pass with the explicit filter removed. Recorded below as a follow-up.

Also caught before it could ship: `drizzle-kit` emitted the two composite foreign keys **before** the
unique indexes they target, which would have failed on apply. Hand-reordered, then proved by dropping
the tables and replaying 0012 from scratch.

**Attempt 1 FAIL - three real product defects**, not test-quality gaps:

1. `createFuncao` TOCTOU. A SELECT pre-check followed by a plain INSERT with no conflict handling, so
   60 of 90 concurrent same-name calls raised an unhandled `23505` as HTTP 500 instead of the designed
   409. An admin double-clicking Save hits it. `updateFuncao` had the same shape.
2. The on-demand legacy seed's `ON CONFLICT (org_id, slug)` arbiter missed the second unique index on
   `(org_id, name)`, so concurrent first person writes in a freshly provisioned org failed roughly 10
   to 15 percent of the time with a 500 and a rolled-back create. The code's own race fallback was
   unreachable because the error threw first.
3. `PATCH /people/:id` silently stopped clearing `contactEmail`. The web client omits the key when the
   input is blank; `master` cleared it via an unconditional `contactEmail: data.contactEmail || null`
   while the new conditional spread retained the old value. That broke the only way the shipped Pessoa
   dialog can clear an e-mail, so the criterion's "every pre-existing endpoint still resolves
   unchanged" genuinely failed.

**Remediation.** `onConflictDoNothing()` plus a re-probe under a fresh statement snapshot for the
insert path, a `SAVEPOINT` with constraint-name mapping for the update path, a bare arbiter covering
every unique index for the seed, and the unconditional `contactEmail` clear restored after checking
what the client actually serializes.

**The executor refused to ship a test that could not fail.** Its first defect-2 concurrency test
survived the mutation, so rather than shipping it, it measured the real hit rate and established that
the race window is **per fresh org** rather than per call - concentrating attempts on few orgs does
nothing. It then shipped two oracles: a deterministic guard that directly constructs the state
invisible to the arbiter (a row holding the seed's name but not its slug, which is genuinely
API-unreachable since slug always tracks name), plus a 30-org race test.

**Attempt 2 PASS.** The second verifier reproduced every fix independently: a 90-way same-name probe
gave 0 unhandled with 1 winner and 89 sentinels, and both 409 reasons stayed independently reachable
under concurrency (66 `duplicate` plus 21 `duplicate_slug` on the rename probe).
It read the postgres.js driver source rather than assuming, confirming `sql.savepoint` rolls back on
any throw with zero backends left idle-in-transaction, and confirmed the brittle constraint-name
coupling is *guarded* - renaming the keys reddens the gate, so it cannot silently degrade to a 500.
It judged the two-test approach legitimate, finding that both tests catch the mutation on 5 of 5 runs.
Five consecutive integration runs were stable, so the concurrency tests are not flaky.
Contract confirmed byte-identical to attempt 1 across all seven contract-carrying files, so slices 07,
09 and 12 are safe.

It also corrected the executor's own measurement: the claimed "0 of 96" for the 4-orgs-by-24 shape was
optimistic, and actually hit 3 of 6 runs against the mutant. The per-fresh-org characterisation is
directionally right, not absolute.

Report: `verify-05-attempt2.md`.

**Follow-ups recorded, not fixed here:**

- `apps/api/test/rls/areas-rls.test.ts` carries the same RLS-masking blind spot. The `adminDb`
  technique added in this slice is the fix.
- `createPerson` via `funcaoIds` has no assertion on the derived boolean mirrors, so one drift mutation
  survives there. The shipped code is correct and the path is not reachable from the UI; worth one
  assertion in a later slice.
- `attachPersonFuncoes`'s `orgId` filter is a provably equivalent mutant given the composite FK plus
  caller-side scoping. Kept anyway, because `CLAUDE.md` mandates the explicit filter.

### 01.1-optimistic-row-edit-guard - Gate 2 PASS first attempt, merged at `320668c`

The first slice in the batch to clear Verify on its first submission.
Three files, web 28 files / 181 tests to 29 / 190.

The invariant shipped as designed - an optimistic row is visible in the cadastro that created it and
nowhere else - via a memoised pure `withoutOptimisticRows(snapshot)` plus a disabled edit affordance
while the create POST is in flight.

The verifier built its own inventory rather than trusting the implementer's and confirmed it exactly:
filtered at the dashboard model, área filter options, DashboardView, SalesView, CommissionsView,
ProductsView, ProductDialog and SaleWizardDialog; raw surviving only at the four by-design cadastro
reads plus the `sales` / `saleItems` / payables / settings reads.
`useSalesOpsBootstrap` is called in exactly one place, so there is no bypass.
Transitivity checked directly: `SaleWizardDialog` hands down nothing but `props.bootstrap`, and its
`sellers` / `finders` / `collaborators` memos, `activeAreas`, `areaNameById`, cliente datalist and both
prestador surfaces all derive from that single prop. One seam, no hole.

Three things it verified by experiment rather than by reading:

- **Memo reference stability**, the highest-risk defect shape here, since a new object per render would
  re-render every consumer and could reintroduce the wizard-remount bug slice 01 had just fixed. It
  instrumented the component and drove extra renders: `persistedBootstrap` *is* `bootstrap` when
  nothing is optimistic, and allocates once per data change rather than per render otherwise.
- **The reconcile inversion.** No-oping `onSuccess` reddened exactly the intended test while the other
  8 new and 8 pre-existing tests stayed green - the precise gap verify-01 had named, where the pure
  function was covered but the wiring was not. The refetch cannot mask it because bootstrap deferred #1
  is asserted issued and deliberately never resolved, and the assertion is on the real PATCH payload.
- **The disabled state is never stuck.** On the reject path the row rolls out entirely with no pending
  button, because `useAppMutation` invalidates in `onSettled` on failure as well as success.

Report: `verify-01.1.md`.

Two pre-existing observations flagged rather than blocked on: the failed-create rollback is silent once
the dialog is dismissed (slice-01 behaviour, no toast), and two concurrent creates where the second
fails momentarily resurrect the first optimistic id before `onSettled`'s refetch heals it - during
which the row is now disabled rather than dangerous, so strictly better than before this slice.

Accepted forward coupling: the picker test asserts the literal nav label `Produtos`, which slice 10
renames. It breaks loudly at one line with an explicit `nav Produtos not found` throw, and slice 10
owns the update.

### Wave 1 integration gate - green

Run on integrated `master` at `e2c43a0` after slices 01, 01.1, 02, 03 and 05 merged (04 cancelled):
`lint=0 type-check=0 build=0`, unit web 29 / 190 and api 24 / 248 and shared-utils 1 / 17,
integration 16 / 73.
Batch baseline for comparison was web 21 / 122, api 23 / 215, integration 13 / 47.

### 06-combobox-adoption - Gate 2 FAIL then PASS, merged at `762232b`

The slice that actually delivers items 3 and 4 to the screen. `NativeSelect` deleted, all 17 call sites
plus both bespoke `datalist` typeaheads routed through the merged `Combobox`, picker geometry unified,
the rule written into `CLAUDE.md` and enforced by `no-restricted-syntax`.
Web 29 files / 190 tests to 30 / 210.

The executor's first run died mid-stream on an API error with only the rule, the ESLint config, the
token fix and the spinner suppression written; `SalesOpsApp.tsx` had 16 lines changed. It was resumed
from transcript, told to re-read its own diff rather than trust memory in case the stall truncated a
file, and completed the migration. Eleven mutations were applied to production source, each watched
Red and each reverted byte-identical.

**Attempt 1 FAIL, on one false sentence rather than any code defect.** The new `## UI Controls` section
asserted "Every single-select picker in `apps/web/src` uses `Combobox`", which is untrue: two Radix
`Select` sites remain at `admin/products/ProductDialog.tsx:132` (status) and
`admin/products/CommissionRuleForm.tsx:94` (basis).
The exclusion was judged correct - a Radix `Select` is not a browser-native picker, so the user's core
rule is satisfied and machine-enforced at all 19 sites - but `CLAUDE.md` governs every future agent in
this repo, so a documented rule the codebase violates is a real defect.

The remediation was documentation only, and the executor caught two problems in its own draft while
making it: an opening line reading "No browser-native picker anywhere in `apps/web/src`" that
contradicted the pre-existing `<input type="date">` carve-out three lines below, and an initial
justification of "frozen legacy tree" that was wrong because this very slice edits siblings of both
excepted files. The reason now given is the true one - both option sets are closed enums, so search
buys nothing.

**Attempt 2 PASS.** The verifier confirmed `git diff 8dd3273..762232b` touches only `CLAUDE.md`, so
attempt 1's clean findings transfer. It then checked every claim against the tree rather than the commit
message, and found the mandate's scoping is load-bearing rather than hedging: `auth/react.tsx:240`
passes its own `h-9`, which would falsify the "exactly two canonical sizes" bullet if that bullet were
not itself scoped to sales-ops.
It verified the exception is honest - both option sets are two literal JSX children enumerating a full
TypeScript union (`ProductStatus`, `CommissionBasis`) with no `.map()` and no query, while the same
`ProductDialog` file renders its one genuinely data-driven picker as a `Combobox`.
And it planted a lint probe **inside `admin/products/` itself** to prove the documented exception is not
a lint escape hatch.
Reports: `verify-06.md`, `verify-06-attempt2.md`.

**A correction to the orchestrator's own brief, recorded so it does not propagate:** the claim that raw
`<input type="number">` existed in `admin/*` and `finder/*` on `master` was false - those files already
used the shadcn `Input`. It came from the repo-mapping agent and was passed on unverified.

**Deliberate visible changes for the human to sanity-check:** the two inert comissões filter pickers are
gone; the admin and finder `Select` panels now have a background where they previously had none; and
parcelas and profissionais rows grow from 40px to 44px.

**Still visually unverified - no agent had a browser.** Carried to the visual pass:

1. The create rows working end to end against the real API.
2. The two CSS-only claims: no OS spin buttons, and the admin/finder popover backgrounds.
3. Rendered pixel geometry. The tests assert class tokens only, so 44px-matches-44px is unproven in a
   real browser.
4. The inline panel on the **last** parcela or profissional row - does it float above, or extend the
   dialog's scroll area?
5. Two stacked Radix modal dialogs when `Cadastrar produto` opens `ProductDialog` over the wizard, a
   state unreachable on `master`.

**Three non-blocking follow-ups noted, all outside the diff:** the `eslint.config.js` rationale comment
still says "exactly one single-select control" and is now mildly out of step with the documented
exception; an `index.css` comment calls spin buttons "the last browser-native picker"; and the sales-ops
sidebar workspace switcher (`SalesOpsApp.tsx:789-870`) is a hand-rolled routing menu that a future agent
could misread the Combobox mandate as covering.

### Deferred: the same defect in the frozen `/admin/*` tree

`apps/web/src/admin/products/ProductsPage.tsx:80` and `:88` carry the identical defect
(`setEditProduct(product)` and `navigate('/admin/products/' + product.id)` with an
`optimistic:<appId>:<slug>` id).
It pre-dates slice 01 and `CLAUDE.md` fences the legacy `/admin/*` route tree off as unchanged, so it
is deliberately not fixed here.
Needs a human decision: a dedicated slice, or a logged doubt.
