# Batch run — `batch-20260804-props-costs`

- **Milestone:** v2.4.0
- **Flow:** `/nexo-batch --auto` (front door pre-parsed: route=batch, mode=autopilot)
- **Trunk:** `master` (this repo's trunk is `master`, not `main`)
- **Gate 1:** skipped — `--auto` carried explicit autopilot.
- **Gate 2:** enforced per slice by a separate Verify agent, locally. Never skipped.
- **Gate 3:** not run. Batch never auto-cuts a release.

## Execution mode

`scripts/nexo-wave-exec.sh` hardcodes `main` as the trunk (`git switch -q main`,
`git merge --no-ff -m "Merge branch '<b>' into main"`), so it cannot drive this repo.
Execution is therefore **serial-on-`master`** — one slice = one local branch = one
`--no-ff` merge — which is also the correct call independently: nearly every slice in this
batch modifies `apps/web/src/sales-ops/SalesOpsApp.tsx`, so `files_modified` overlap
disqualifies parallel worktree builds anyway.

## The queue

`waves.sh` over the plan frontmatter:

```
wave 1: 01-produto-wizard-step3 02-pessoa-dialog-auto-funcao 03-profissional-picker-funcao-first 05-professional-split-core
wave 2: 04-prefill-profissionais-do-produto 06-professional-split-persistence
wave 3: 07-professional-split-ui
```

Execution order (a valid topological order, serial):

| # | Slice | User item | Wave | Status |
|---|---|---|---|---|
| 01 | `01-produto-wizard-step3` | 1 | 1 | todo |
| 02 | `02-pessoa-dialog-auto-funcao` | 5 | 1 | todo |
| 03 | `03-profissional-picker-funcao-first` | 4 | 1 | todo |
| 04 | `04-prefill-profissionais-do-produto` | 3 | 2 | todo |
| 05 | `05-professional-split-core` | 2 | 1 | todo |
| 06 | `06-professional-split-persistence` | 2 | 2 | todo |
| 07 | `07-professional-split-ui` | 2 | 3 | todo |

Item 2 (the professional payment split) was feature-sized, so its planner
produced a three-slice plan-set plus `00-OVERVIEW-split.md` rather than one
slice. That is the batch guardrail working as written: the item did not balloon
mid-run, it was sized correctly at triage.

## Planning notes

Two of the five planners ran with read-only tooling and returned their plans as
text instead of writing them. The orchestrator persisted
`03-profissional-picker-funcao-first.md`, `00-OVERVIEW-split.md`,
`05-professional-split-core.md`, `06-professional-split-persistence.md` and
`07-professional-split-ui.md` verbatim from those returns, and wrote their
`plan-*.result.json` handshakes itself. Recorded because a result file the
orchestrator authored is weaker evidence than one the agent committed.

`waves.sh` parses only the INLINE `depends_on: ["a", "b"]` form. Slices 06 and 07
were first written with the YAML block-list form and silently landed in wave 1
with no dependency at all. Converted to inline and re-derived. A silent
mis-ordering, not an error.

## Slice log

Every slice ran Execute then a SEPARATE Verify agent with fresh context.
Gate 2 was enforced locally on every one; nothing merged on a red or unknown verdict.

### 01 `01-produto-wizard-step3` - user item 1 - DONE

Merged as `24493ce`. The reported symptom was `Avançar` saving from step 3.
The real mechanism was HTML implicit submission: all four steps share one `<form>`, the create path has NO submit button while `wizardStep < 4`, and steps 2 and 3 each mount exactly ONE implicit-submission-blocking `<input>`, so Enter submitted the form itself.
The edit path was worse - `Salvar alterações` is `type="submit"` and was therefore the form's default button on every step.
Step 1 has two such inputs, which is why Enter looked inert there and the operator read the failure as "Avançar saved it".

The planner ruled out all three of the obvious causes by inspection first (a bare `<button>` defaulting to submit, an off-by-one on the last-step predicate, a 3-long step array) and only then found the real one.
It also corrected the brief: the screen is NOT `apps/web/src/admin/products/ProductDialog.tsx`, which is dead legacy, but `ProductDialogBody` inside `SalesOpsApp.tsx`.

The second half of the item - "double check if we have the optimistic update" - was answered and deliberately NOT built: `useSaveSalesOpsProduct` already declares `invalidates: [queryKeys.salesOps.all]` and `cadastros-refresh.test.tsx` pins the refresh end to end.
What is missing is a pre-response optimistic ROW, which `hooks.ts` documents as needing a client-side row builder. That is a separate slice with its own acceptance, not a rider on a bug fix.

### 02 `02-pessoa-dialog-auto-funcao` - user item 5 - DONE

Merged as `106ed61`. `onChange` now calls `assignFuncao` directly and the `Adicionar função` button is gone.
`pendingFuncaoId` was DELETED rather than cleared in the handler, and the Combobox takes the literal `value=""` - with no selection state there is nothing that can go stale.

The planner found the two paths already disagreed before this slice: `onCreate` called `assignFuncao` itself and never touched the button, so an inline-created função took one click and a picked one took two.

### 03 `03-profissional-picker-funcao-first` - user item 4 - DONE, after one Gate 2 FAIL

Merged as `8891304`. FUNÇÃO NO PROJETO is the first column; the person picker stays disabled behind `Selecione a função primeiro` until the row names a função, then lists carriers plainly and everyone else under an `Adicionar a esta função` group heading. Picking a flagged pessoa grants her the função through the ordinary `useSaveSalesOpsPerson`.

**Gate 2 rejected the first attempt.** The implementation was correct but the test guarding it was VACUOUS: the fixture pessoa's `contactEmail` was `null`, so the expected value was `undefined`, and `toHaveBeenCalledWith` uses `toEqual` semantics under which an expected `undefined` matches an OMITTED key. The verifier proved it by deleting `contactEmail` from the payload and watching all 28 tests stay green.
That is the exact regression the assertion existed to catch - the API sets `contactEmail: data.contactEmail || null` unconditionally, so an omitted key blanks the pessoa's e-mail.
Fixed by giving the fixture a real address; the re-verify re-ran the mutation and confirmed it now goes red.

Two facts the planner corrected before any code was written: `isCollaboratorPerson` was ALREADY deleted from `apps/web` (CLAUDE.md was stale), and the UI-contract file is `.tsx`, not the `.ts` CLAUDE.md named.

### 04 `04-prefill-profissionais-do-produto` - user item 3 - DONE, after one Gate 2 FAIL

Merged as `bf71271`. A proposta now auto-seeds one professional row per função its itens' produtos declare, função and cost filled, pessoa left to pick. Idempotent per `(produto, função)`, never resurrects a deleted row, and `if (!editSale)` keeps it off the edit path.

**Gate 2 rejected the first attempt**, and this was the most valuable catch of the batch. Seeded rows have no pessoa, so slice 03's `createPayload` filter dropped them - but `professionalCents` still counted them in the step-3 panel. The operator read `Margem líquida R$ 15.500 / Custos profissionais R$ 1.300` while `Salvar rascunho`, in that same footer, persisted `net_margin_brl = R$ 16.800`.
CLAUDE.md pins that the on-screen margin equals the persisted one; this slice broke it BY DEFAULT for every proposta whose produto declares a função cost. The verifier reproduced it with the suite's own fixtures rather than inferring it.

Fixed by extracting `professionalRowWillPersist` as the SINGLE predicate for "this row will be sent", now referenced by `createPayload`, `professionalCents`, `professionalPeopleValid` and `payablesPreview`. The duplication of `personName.trim()` at two sites was the whole cause, so the fix removes the duplication rather than patching the second site.

The verifier's second consequence - a rascunho saved before the pessoas are picked loses the seeding permanently - was NOT solved here. `draftValid` deliberately does not gate on professionals and slice 03 depends on that. Instead the loss was made visible with a muted line, and the underlying limitation was filed to `nexo/ROADMAP.md` with its three candidate fixes.

### 05 `05-professional-split-core` - user item 2 (1 of 3) - DONE

Merged as `b0a08a2`. Pure arithmetic in `packages/shared-utils/src/professional-split.ts`, following the `computeSaleFinancials` precedent of ONE shared implementation rather than two copies.

The verifier did not check the code against its own tests. It wrote a throwaway script against the BUILT module, re-derived the expected vector from the contract independently, and ran **4,708 cases** - zero mismatches - plus **3,440 cases** proving the equal-weight output is byte-identical to `splitInstallmentsEqually`, which is the assertion that stops the two rounding rules drifting.

### 06 `06-professional-split-persistence` - user item 2 (2 of 3) - DONE

Merged as `9283bca`. Migration `0017_professional_payment_split` adds a nullable `cost_split_bp jsonb`; `professional_cost` payables become one row per INSTALLMENT receivable.

The executor caught the plan being WRONG about its own arithmetic: the plan hardcoded `180000 / 29999 / 30001` for a fixture where the real split is `180000 / 29976 / 30024`. The plan's figures appear to have been carried over from the unrelated seller/tax `pctOfCents` results on the same fixture. It took the function's output and recorded the discrepancy, which is the correct precedence - the function is the oracle, not the plan.

The verifier ran **10 separate mutations**, every one caught by a test, including the subtle one: reverting the re-win guard to `(kind, receivableId)` lets one professional's PAID parcela-1 payable suppress a different professional's parcela-1 payable, so that professional silently loses money. `ExistingPayableRef.beneficiaryName` is REQUIRED so a forgotten call site is a type error.

`sale-margin-parity.test.ts` is the master-parity proof: its diff adds only three `costSplitBp: null` lines and changes ZERO numbers, so no persisted margin moved.

### 07 `07-professional-split-ui` - user item 2 (3 of 3) - DONE

Merged as `160691a`. The `Detalhe de pagamento` disclosure: closed it reads `Detalhe de pagamento (3x)`; open it shows the read-only pro-rata default per parcela, and `Personalizar divisão` turns it into an editable list of parts in percent with the resolved reais and the bound parcela date beside each, plus `+ parte`, `Remover parte N`, `Distribuir igualmente`, `Usar padrão` and a live `Soma`.

The panel was extracted to `apps/web/src/sales-ops/ProfessionalSplitPanel.tsx` rather than inlined into the already 8215-line `SalesOpsApp.tsx`. It is still exactly one `col-span-full` sibling inside the existing row, so no grid template and no column header moved - which is what kept it conflict-free against slice 03.

**The executor disclosed that it did not capture a full red run**, only one recorded counterfactual out of twelve tests. That disclosure is why the Verify brief made proving the other eleven its priority, and it is the reason the honesty was worth more than a clean-looking report.

The verifier found the master-worktree route was a WEAK oracle and said so rather than accepting it: `ProfessionalSplitPanel.tsx` does not exist on `master`, so the file fails at collection - twelve tests, zero information. With a `null`-returning stub added so it collects, all twelve go red but ten die at the same shallow point (`button not found`). So it mutation-tested **all twelve** against the new implementation instead, one anchored mutation per test. **Zero vacuous.**

The load-bearing test is the one that justifies storing basis points rather than cents: set `[3000, 7000]`, double `CUSTO ALOCADO`, and the panel must read R$ 6.000,00 / R$ 14.000,00 while the payload still carries `[3000, 7000]`. The verifier re-ran the counterfactual itself rather than trusting the executor's.

**One finding was fixed before merge rather than filed.** The verifier proved that replacing `Personalizar divisão`'s seed with all zeros survived all twelve tests - the suite pinned how many parts appeared, never what they were worth. Closed with an assertion on the seeded VALUES, deliberately on the uneven 10k/20k/20k/50k plan, because on an evenly split plan equal weights are indistinguishable from the real pro rata. Proven by mutation (`c802401`).

## Integrated `master` - full gates

Run on the integrated trunk after the last merge, all run-once:

| Gate | Result |
|---|---|
| `pnpm run build:packages` | 0 |
| `pnpm run lint` | 0 |
| `pnpm run type-check` | 0 |
| `pnpm test` | 0 - shared-utils 80, api 328, web 531 |
| `pnpm run build` | 0 |
| `pnpm --filter @fxl-sales/api test:integration` | 0 - 20 files, 113 tests |

## Outcome

7 done, 0 parked, 0 failed. All five user items delivered.

Two slices were rejected by Gate 2 on the first attempt and both rejections were real defects, not process noise:

- slice 03 shipped a test that could not fail, guarding the exact regression it named;
- slice 04 broke the displayed-equals-persisted margin invariant BY DEFAULT for every proposta whose produto declares a função cost.

Neither would have been caught by a green suite, which is the argument for Execute and Verify being different agents with different contexts.

Seven follow-ups were filed to `nexo/ROADMAP.md` rather than absorbed: the identical-`person_name_snapshot` payable collision, the cancel-revert-rewin sum question, the untested mixed receivable shape, the route-level `400` assertion, the panel's array-order vs due-date-order binding, one loose CLAUDE.md sentence, and the produtos optimistic row.

Not run: `/nexo-ship`. Batch never auto-cuts a release; Gate 3 is human.
