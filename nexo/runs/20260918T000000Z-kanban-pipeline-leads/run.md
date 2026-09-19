# Run record - `20260918T000000Z-kanban-pipeline-leads`

- **Flow:** feature, **mode:** autopilot (Gate 1 skipped by dispatch), **token:** `q7k4n2ma`.
- **Milestone:** `v4.1.0`.
- **Plan set:** `nexo/plans/feature-20260918-kanban-pipeline-leads/` (8 slices, all `status: done`).
- **Trunk:** `master`, `f4ea821..master` is 34 commits.
- **Final gates on integrated `master`:** web 915 tests / 73 files, api unit 526, api integration 217, `pnpm run lint`, `pnpm run type-check`, `pnpm run build` all green.

---

## 1. What was asked

The dispatched REQUEST, verbatim:

> Adicionar um quadro Kanban de prospeccao (CRM simples) ANTES da proposta.
> Um lead carrega nome do contato, empresa, um ou mais produtos em negociacao, valor estimado, descricao e vendedor responsavel, e anda por etapas configuraveis.
> Mover um lead para a etapa de conversao abre automaticamente o wizard de proposta e so permite o movimento depois que a proposta for criada.

Twenty-four acceptance criteria came with it, reproduced in full in `nexo/plans/feature-20260918-kanban-pipeline-leads/00-OVERVIEW.md`.
They were unusually prescriptive because the analysis that produced them had already rejected the obvious cheap design: widening `sales_ops_sales.status` with pre-proposta stages.
`total_brl` and `net_margin_pct` are `NOT NULL` and feed `getSalesOpsSummary`, the dashboard and `computeSaleFinancials`, so a pre-proposta sale row would either lie with zeroes in every financial panel or force those three to learn a status meaning "no numbers yet".

## 2. What shipped

A lead is a first-class entity with its own tables, its own paginated endpoint, its own two screens and exactly one door into the proposta.

- **Schema.** Migration `0022` adds `sales_ops_lead_stages`, `sales_ops_leads` and `sales_ops_lead_products`, all three under `FORCE ROW LEVEL SECURITY` with two policies each, plus an idempotent per-org stage seed.
  Migration `0023` adds `sales_ops_people.hub_account_id` (see §6.1).
- **Stage cadastro.** `leadStagesRouter` in `apps/api/src/domains/sales-ops/leads/stage-routes.ts`: list, create, rename, reorder, archive.
  A system etapa answers `409 stage_is_system`, a duplicate name answers `409 stage_name_taken` backed by a real unique index, and there is still no DELETE verb anywhere on `salesOpsRouter`.
- **Lead API.** `leadsRouter` in `leads/lead-routes.ts`: CRUD, a per-column cursor list, and one `move` endpoint that owns `stage_changed_at`, `position` and `sale_id`.
  Seller scoping is applied on the server inside `withTenant` and proven over an `app.fxl_admin` connection where RLS hides nothing.
- **Web data layer.** `apps/web/src/sales-ops/leads/{types,api,hooks,optimistic,calculations}.ts`, one flat board cache entry, and an optimistic move that reverts to the exact prior stage AND prior index.
- **Screens.** `LeadStagesView` (`cadastros/etapas`) and `LeadsBoard` (`operacional/leads`, `meus-dados/leads`), both in `apps/web/src/sales-ops/leads/` and never inside `SalesOpsApp.tsx`.
  The keyboard `Mover para` dialog is the single emitter; `@dnd-kit` is pinned exactly and is a convenience whose deletion leaves all twelve keyboard oracles green.
- **Conversion.** One optional `onRequestConversion` prop, one optional `leadPrefill` prop on `SaleWizardDialog`, and a promise that resolves with a sale id or `null`.
  The card moves only after `POST /sales` answers `201`; cancelling persists nothing.

`SALE_TRANSITIONS` and its `EXPECTED_MATRIX` are byte-unchanged.
No board action writes `sale.status`, no card move writes `audit_log`, and no lead value reaches `getSalesOpsSummary`, the dashboard, `computeSaleFinancials` or `/bootstrap`.

## 3. Slices, waves and merge commits

| wave | slice | merge commit | branch commits |
|---|---|---|---|
| 1 | `01-leads-schema` | `0d9a80b` | `501fabf` |
| 2 | `02-api-stage-cadastro` | `b874a29` | `76d6bed` |
| 3 | `03-api-leads` | `59eac03` | `6cc830b`, `861fb76` (test pin) |
| 4 | `04-web-data-layer` | `5c9dcf7` | `5b5530d`, `132d6ae` (test pin) |
| 5 | `05-web-stage-cadastro` | `136090f`, reinstated by `bc226b3` | `91565e3` |
| 5 | `06-web-kanban-board` | `d202fad`, reinstated by `f501271` then `ce12b96` | `2336d60`, `e64863b`, `c04bf32`, `6746ff4` (test pin) |
| 5f | flake fix | `701452d` | `7650e44` |
| 6 | `07-web-routing` | `fb8bdb9` | `0796839`, `10db715`, `cd3ac60` |
| 7 | `08-web-conversion` | `dec3a8b` | `559a4e7`, `f6ae17e` |
| fence | mutation-pass repair | `dae59f8` | `260feab` |

Wave 5 is the only parallel wave: slices 05 and 06 touch disjoint files and do not depend on each other.
Its history is not linear, and §7 explains why.

Three extra commits beyond the eight slices are worth naming because none of them was planned:

- `861fb76`, `132d6ae` and `6746ff4` are **test pins added in response to a verifier's named gap**, each landed on the slice branch before merge with the mutation that reddens it demonstrated.
- `7650e44` is the **flake fix** (§8).
- `260feab` is the **fence repair** the feature-tier mutation pass forced (§9, survivor 1).

## 4. Planning: eight parallel planners produced an inconsistent plan set

The eight slice plans were written concurrently.
They disagreed with each other about the schema and the wire contract they shared, and the first plan-check REJECTED the set with six findings, three of them HIGH.

The three HIGH ones would each have broken execution outright:

1. Slice 02 was planned against a `sales_ops_lead_stages` with a `slug` column and a four-value `kind` including `'converted'`.
   Slice 01, the schema owner, has no `slug` column and a three-value `kind` CHECK.
   Slice 02's service would have failed at `INSERT` time with `column "slug" does not exist`, and several of its own named oracles could never pass.
2. Slices 02 and 03 each instructed `routes.ts` to `import { leadsRouter }` from a different module.
   Applied literally in sequence that is a duplicate-identifier compile error, and neither plan named the fix.
3. The phantom `'converted'` kind was only half-repaired.
   Slice 06 built `stageIsReadOnly(stage) === (stage.kind === 'converted')` on a value the schema can never produce, and slice 08 diagnosed the problem without saying what should replace it - a real design decision left in an executor's hands, which the planner contract forbids.

The orchestrator resolved all six without reopening the WHAT, under one rule: **slice 01 owns the schema and wins every dispute; slice 03 owns the wire contract.**
The resolutions are recorded permanently in `00-OVERVIEW.md` §"Contrato reconciliado" so no later reader reopens them.
The most consequential is item 3: **read-only is a property of the CARD, never of a column.**
`leadIsConverted(lead) === lead.saleId !== null`; the single `kind: 'conversion'` stage is both the door that opens the wizard and the column those cards land in, and it stays an active drop target for a lead with no proposta yet.

A second, independent plan-check rejected the revision again, for two residues:

- slice 07 still instructed the executor to write `LeadMoveCommand` **into `CLAUDE.md`**, a type the reconciliation had just declared nonexistent;
- slice 04's code block used a `BOARD_KEY` constant that the paragraph immediately below it explained could not exist.

Both were repaired directly by the orchestrator because both were mechanical and fully specified by the report.
A third full plan-check was waived: the second report carried an exhaustive live-vs-documentary table of all ~40 occurrences, and the closure of the two residues was confirmed by deterministic grep rather than by an agent's reading.

Two further defects were found during the replan and accepted without consultation:

- **R7:** slice 03's `ListLeadsQuerySchema` requires `stageId`, so slice 04's board-wide list would have 400ed on every board load.
  Resolved by fanning out per column inside one `queryFn`, which preserves the single flat cache entry that acceptance 10's rollback depends on.
- **R8:** the move body is `{stageId, position, reason?, saleId?}` under a `.strict()` schema, while the web client would have sent `toStageId`/`toIndex`.
  Resolved by one explicit translation inside `leadsApi.moveLead`.

## 5. Verification evidence, slice by slice

Each slice ran its named oracles, the full tier suites, lint and type-check, and a mutation battery in which every mutation had to turn a **named** test red.

| slice | verdict | mutations | headline evidence |
|---|---|---|---|
| 01 | PASS | 7 applied, 7 named reds | Migration `0022` applied end to end to a brand-new empty database. Dropping `FORCE RLS` reddens `forces row level security on all three lead tables and carries both org policies`; dropping the partial index reddens `allows exactly one conversion stage and one lost stage per org`. Mutation 5 (neutralising the seed's early return) proves the idempotency contract is live. Mutation 6 (dropping the explicit `orgId` filter) is red only over the `app.fxl_admin` connection, which is the proof the filter is load-bearing independently of RLS. |
| 02 | PASS | 12 applied, 12 named reds | Deleting `.onConflictDoNothing()` reddens the duplicate-name oracle, which proves the `409 stage_name_taken` is index-backed rather than probe-backed. Adding a `DELETE` route reddens `has no DELETE route for lead stages`. Writing an `audit_log` row inside `updateLeadStage` reddens `archiving a lead stage writes no audit_log row`. Making the reorder touch `stage_changed_at` reddens the sole oracle for acceptance 8. |
| 03 | PASS | 10 applied | Seller scoping is the strongest area of the feature. Deleting the seller predicate reddens three separately-keyed tests (`serves a seller only their own leads, over the admin connection where RLS hides nothing`, `ignores a sellerPersonId query parameter for a non-admin caller`, `keeps an unassigned lead out of every seller's board and on the admin's`). Making the identity gate fail OPEN reddens `refuses a caller with no mapped pessoa with seller_person_unmapped and returns no rows`. The verifier reported one HIGH gap - `updatePerson`'s `hubAccountId` preservation was correct but unpinned - which was closed by `861fb76` with the clobbering mutation demonstrated red. |
| 04 | PASS | 6 applied, 6 named reds | Hard-coding `boardKey` to `queryKeys.leads.board(undefined)` reddens `patches the cache entry the board with the SAME filters is reading`. Mutation C is the decisive one: a *reimplemented* `onError` that restores only the moved lead's `stageId` still reddens `restores the lead's exact previous index inside its own column when a reorder fails`, so the rollback oracle pins position and not merely column. The verifier's own gap - nothing couples the web types to the API zod schemas - was closed by hand field-by-field and filed. `132d6ae` pins the per-column fan-out and its flat cache entry. |
| 05 | PASS | 12 applied, 10 named reds | The reorder-revert oracle is decisive on the ORDER assertion rather than on the message. Two mutations stayed green and were recorded rather than hidden: the `next === current` short-circuit in `move()`, and both status-write failure copies. Diff is exactly the two planned files. |
| 06 | PASS | 3 batteries | **Amputation:** every `@dnd-kit` import, `useSensors`, `PointerSensor`, `SortableLeadCard`, `DndContext`, `SortableContext`, `useSortable` and `handleDragEnd` was stripped from `LeadsBoard.tsx`, and all 12 keyboard oracles still passed - the menu is the real control, proved rather than asserted. **Read-only:** re-keying the refusal onto the column reddens `keeps a NON-converted card in the conversion column fully movable`, an oracle that deliberately puts a converted and a non-converted card in the SAME column. **Inline layer:** see §10. The verifier's one gap - no oracle pinned the days badge to `stageChangedAt` - was closed by `6746ff4`. |
| 07 | FAIL, then PASS | 8 applied, 8 named reds | See §6.2. |
| 08 | FAIL, then PASS | 7 applied, 7 named reds | See §6.3. The ghost-card oracle is the best in the feature: it asserts `Salvar rascunho` is disabled with nothing written, **then picks an área and asserts the same button becomes enabled**, and a mutation forcing `draftValid` to `false` reddens that second half - which is what proves the control is live. The wizard-open predicate keys on the wizard's own `DialogDescription`, not on `Nova proposta`, and a mutation re-keying it onto that ambiguous string reddens the cancellation test, confirming the trap was real. |

## 6. The two verify FAILs, and what they actually were

Both FAILs were **false statements in `CLAUDE.md`**.
Neither had any defect in the code, in the tests or in the control flow.
That is not a technicality: this repository treats `CLAUDE.md` as load-bearing law, so a false assertion committed into it is a defect in a shipped artefact.

### 6.1 Background: the one structural decision taken without the human

Acceptance 15 requires seller scoping to be applied on the SERVER inside `withTenant`.
Planning proved that was impossible as the code stood: `sales_ops_people` has no Hub account column, and `CLAUDE.md` itself records that there is no join path from a Hub account id to a pessoa.
The decision, taken under autopilot and recorded in `AUDIT.md`, was to add `sales_ops_people.hub_account_id` (migration `0023`, partial unique per org), written either by an admin `PATCH /people/:id` or self-claimed once from the caller's own verified token e-mail under four guards.
The alternative was a client-side filter, which acceptance 15 forbids by name.
The operational cost - an org whose pessoas' `contact_email` does not match their Hub login needs an admin PATCH before those sellers see any board - is filed in `nexo/ROADMAP.md`.

### 6.2 Slice 07 FAIL: a law the feature's own contract had deleted

The new `## Kanban de leads` section asserted:

> After conversion the card sits in a final READ-ONLY column that mirrors `sale.status` (`draft|open|won|lost|cancelled`) and is not draggable.

Three falsehoods in one sentence.
No column is read-only - `readOnlyCardClass` is named for a card precisely so this cannot be misread, and the conversion column is an active drop target.
There is no final column - the `kind: 'conversion'` stage is both the door and the landing column, and a fourth `'converted'` kind is forbidden by `LeadStageKind` and by reconciliation item 1.
And it is the CARD that mirrors `sale.status`, not any column.

The shipped code says the opposite three times, unprompted, in `LeadsBoard.tsx`, `board-ui.ts` and `types.ts`.
The text had been copied from acceptance 13's raw wording without applying reconciliation item 3, which supersedes it.

Why it mattered rather than being pedantry: the sentence was a standing instruction to a future implementer to build exactly the status-driven read-only column that the plan-check had deleted.

Fixed by `10db715`, one file, four insertions and one deletion.
The re-check verified the replacement clause by clause against the shipped code (thirteen clauses, all TRUE) and confirmed by residue grep that the only surviving mention of a read-only column is the new bullet's deliberate record that the request's wording was superseded - the same device this file already uses for `sales.core` and for the renamed `FXL_HUB_*` variables.

### 6.3 Slice 08 FAIL: a number the commit deliberately rewrote, wrongly

The diff changed `CLAUDE.md`'s `SalesOpsApp.tsx` line count to **9227**.
The shipped file was **9233**.

The sentence carries a self-exemption - "The number is here to justify the fence, not to be maintained: if it is stale, the fence still stands" - which excuses a number going stale under a LATER commit.
It does not excuse a commit that deliberately rewrites the number and writes the wrong one.
This was the second occurrence of that exact defect class in the same feature: `cd3ac60` had already had to repair the same number once, in slice 07.

The same hoist also left two in-code comments false.
`hasFuncao` and `FUNCAO_SLUG_VENDEDOR` moved out of `SalesOpsApp.tsx` into `calculations.ts` (because `react-refresh/only-export-components` allows only component exports from that file, so a second consumer could never import them from there), and two comments still called them module-local.
Neither is caught by lint, by type-check or by any test.

Fixed by `f6ae17e`, comment and prose only.

## 7. The wave-5 recovery: a good slice was parked by the harness, not by its own defect

Wave 5 merged slices 05 and 06 in parallel, and the integrated `--wave-verify` failed: every `@dnd-kit` import in the trunk failed to resolve.

`nexo-wave-exec.sh` did the right thing with the evidence it had.
It reverted to the last green trunk, re-ran the two slices serially, identified 06 as the culprit, parked it, re-merged 05, and left `master` green with append-only reverts.
That is the non-linear stretch in the history: `92fd14a`, `2a31fe5`, `bc226b3`, `f501271`, `b03db10`, `ce12b96`.

**The true cause was the gate, not the slice.**
`--wave-verify` ran `lint`/`test`/`build` in the main checkout **without `pnpm install`**.
Slice 06 adds `@dnd-kit` to `apps/web/package.json`, and `git merge` does not materialize a new dependency into `node_modules`.
Every import failed for a reason that had nothing to do with the code.

A second failure made it hard to diagnose: the wave log was written per *target*, truncating on every invocation, so the run that FAILED was overwritten by the recovery run that PASSED.

Two repairs, both load-bearing:

1. `pnpm install --frozen-lockfile` plus `build:packages` now run before anything else in the gate.
2. The wave log is now written **per invocation**, with a `.latest` symlink, so a failing run's evidence survives the run that follows it.

Slice 06 was reinstated by `git revert` of the revert - append-only, no `reset --hard`.

## 8. The flake

With the install fixed, one real failure remained:

```
stage_changed_at advances when and only when stage_id actually changes
AssertionError: expected 1789785147396 to be greater than 1789785147396
```

Measured at **2 failures in 5 consecutive runs**.
It had passed slice 03's verification and two wave gates by luck.

The first diagnosis - that the test read the stamp at millisecond resolution while Postgres stores microseconds - was only half right, and the commit message records the correction.
The move stamps do not come from Postgres at all: they are a `new Date()` inside `moveLead`, which has no digit below the millisecond.
Reading at higher precision alone would therefore not have fixed it, because two move stamps inside one millisecond are *genuinely equal* at their own resolution and a strict `>` has nothing left to stand on.

The fix does both halves:

- the stamp is read as a `bigint` of MICROSECONDS computed in SQL, never through `new Date(...)`, so no precision is discarded on the way in;
- before each write that MUST advance, the test waits, boundedly, for this process's clock to pass the stored stamp, so the `new Date()` the service is about to mint cannot collide with it.

The strict `>` was **kept**.
Relaxing it to `>=` would let through a regression that never advances the field at all - which is the whole property.
The "does not advance" half became exact equality at microsecond precision, strictly stronger than the millisecond-truncated comparison it replaced.

Proof: 10 consecutive green runs, and both mutations (always-advance, never-advance) red.
Only the test file changed.

## 9. The feature-tier mutation pass

Run by hand in a throwaway worktree at integrated `master` (`dec3a8b`); this repository configures no mutation tool.
Nothing was committed and every mutation was restored.
Full report: `nexo/runs/20260918T000000Z-kanban-pipeline-leads/mutation-report.md`.

**22 mutations, 18 KILLED, 4 SURVIVED.**

The pass deliberately targeted cross-slice and cross-boundary properties, because each slice's verifier only ever saw one slice's diff.

### Survivor 1 - the acceptance-13 fence had a hole. FIXED IN THIS RUN.

`board-write-surface.test.ts` is a source scanner enforcing "no board action calls `POST /sales/:id/transition`", and it is a good guard: it carries a mandatory planted-violation positive control, and injecting a transition call into `LeadsBoard.tsx` killed it instantly.

Its `OWNED_FILES` list covers only `apps/web/src/sales-ops/leads/*`.
**The real board-to-proposta path is not there.**
It is `saveLeadConversion` inside `apps/web/src/sales-ops/SalesOpsApp.tsx`, which the scanner never read.
Adding `transitionSale.mutate({ saleId, status: 'open' })` to its success path left **all 911 web tests green** - a board action materializing a sale status change, and one `status: 'won'` away from materializing payables, with a fully green suite.

Fixed by `260feab`.
`SalesOpsApp.tsx` could not simply join `OWNED_FILES`, because that same file also hosts the propostas screen whose `onTransition` is the *rightful* caller of that endpoint; a file-wide ban would fail on correct code.
Instead the board-owned regions carry `BOARD-WRITE-FENCE:START/END` sentinels and only the text between them is scanned, so the fence travels with the code.
Three properties keep it honest: the fenced regions must still contain the code they are named for (so hoisting out of a fence reddens rather than escapes); `does not overshoot onto the propostas screen` asserts the UNFENCED remainder still reaches a transition endpoint, proving the narrow scope is genuinely narrow; and the two wiring one-liners outside the fence are pinned to their exact delegating shape.
Extraction of the two handlers was rejected for this slice - they close over six pieces of component state and the move could not be proven behaviour-preserving in a guard-only change.

### Survivor 2 - the API/web wire is two independent literal pins with nothing between them

Renaming `stageId` to `destinationStageId` in the API's `MoveLeadSchema` *and* service killed 4 api-unit and 6 api-integration tests, and left the **entire web suite green**.
The reverse is equally true.
`MoveLeadSchema` is `.strict()`, so a renamed key is a hard `400` on every card move in production while both suites are green.
This was already filed as missing coupling; the pass measured it as real and total.
Oracle that would kill it: one shared wire-shape fixture both suites import.

### Survivor 3 - `createdSaleIdentity`'s documented fail-closed has no oracle

The comment says it fails CLOSED: no id means no move, which leaves a real proposta and an unmoved card, the recoverable direction.
Making it fail OPEN left 911 web tests green.
The blast radius is bounded by the API's own `sale_required_for_conversion` guard, which is why this ranks third - but the documented invariant itself is unverified.
Oracle that would kill it: one case where `POST /sales` answers 201 with no usable `id`, asserting no move is issued.

### Survivor 4 - reported for honesty, not as a defect

Summing `sales_ops_leads.estimated_value_brl` into `getSalesOpsSummary` with a raw query placed OUTSIDE `withTenant` survived, because the app connection is the non-superuser `fxl_sales_test` role and RLS returned zero rows in both snapshots.
The identical leak placed INSIDE `withTenant` was killed instantly by the whole-object `toEqual`.
Acceptance 17 is genuinely well defended for every leak that could actually return data.
What this records is that `leads-no-financial-impact.test.ts` is load-bearing on the RLS posture of `sales_ops_leads`.
No oracle is worth adding.

### Two weak kills worth recording

Both "a converted card may be moved" and "a converted lead may be PATCHed" died - but on `a move into the conversion stage requires a saleId that resolves in-org`, a test about something else that happens to move an already-converted card as a fixture step.
No named test asserts "a converted lead refuses a PATCH".
A future refactor of that fixture would silently un-defend the read-only-card rule, which is the headline of acceptance 13.

### Honest overall read

Strong on the server half.
Seller scoping (15) is the best-defended area in the feature.
`stage_changed_at` (7, 8) is defended twice over, structurally by a source regex and behaviourally by a test, and the behavioural oracle was proved decisive on its own: a mutation that hid itself from the regex still died.
Financial isolation (16, 17) uses whole-object `toEqual` rather than a field list.
The lost-reason rule (6) is enforced and pinned on both sides.
Conversion ordering (11, 12) is pinned with unusual precision.

Thin in three seams: the scanner's scope (now fixed), the API/web wire, and the converted-card rule at service level.

## 10. The `useInlineLayer` false positive, in a second form - and how it was escaped

`CLAUDE.md` already records that a regression test for the inline-layer Escape guard must render inside a REAL `Dialog` and assert on `onOpenChange`, because a spy on a React sibling's `onKeyDown` passes even with the protection deleted.
That exact false positive shipped once before.

Slice 06's `move-dialog-inline-layer.test.tsx` does render a real Radix dialog.
The verifier then applied the second-order mutation: replace `DialogContent` with a plain `<div role="dialog">`.
With a hand-rolled div there is **no Radix capture-phase listener at all**, so a bare `expect(onOpenChange).not.toHaveBeenCalled()` would pass for the wrong reason - the same vacuity in a new costume.

The test survives that because each guard case ends with an **in-test positive control**: it dispatches Escape with no inner layer open and asserts `onOpenChange` WAS called with `false`.
Against the hand-rolled div that assertion fails, and the mutation went red on two named tests.
The mutation that disables the real registration (`useInlineLayer(open)` to `useInlineLayer(false)` in `combobox.tsx`) also went red on two named tests.
Proven both ways.

## 11. What was deferred, and why

All filed in `nexo/ROADMAP.md`.

- **A web control for `sales_ops_people.hub_account_id`.** Today it is written by an admin PATCH or by a one-shot self-claim, and neither is a screen. An org whose sellers' `contact_email` does not match their Hub login gets `403 seller_person_unmapped` until an admin PATCHes - a refusal, never an unscoped read. The Pessoa dialog is where the control belongs, and a person write is a full-set replacement, so it must carry `contactEmail`.
- **A shareable `?vendedor=` deep link.** The vendedor filter is deliberately component state, under the `productKind` precedent: `CLAUDE.md` makes the URL the source of truth for the painel and the page, and a narrowing filter is neither. Making it a URL parameter needs a decision about what the URL means, first.
- **`Alt+Arrow` to move the focused card one column.** Asked for by slice 06 and declined by slice 07: it would be a THIRD command path duplicating `Mover para`, with nowhere to type the reason the terminal `Perdido` etapa requires.
- **Coupling the web lead types to the API zod schemas.** Nothing structural connects them; a field rename stays green on both sides and breaks only at runtime. Measured as total by mutation survivor 2. The real fix is a shared contract type or a client generated from the zod, which is its own work.
- **The three remaining mutation survivors** (§9), each recorded with the oracle that would kill it.
- **One orphaned rascunho after a failed move plus a page reload.** `convertedSales` closes the duplicate-proposta window within a session and the API's `409 already_converted` closes the sub-case where the first move landed. The remaining case issues a second `POST /sales` while `sale_id` is still null. It is visible on the propostas screen as a `Rascunho` and can be archived. Closing it properly needs a transactional `POST /leads/:id/convert`, which would duplicate the whole `CreateSaleSchema` surface and create a SECOND writer of `sales_ops_sales` - a design change, not a fix.
- **`sales_ops_clients` has no unique index on `(org_id, name)`.** `findClientByName` folds case, accents and whitespace, but reads a possibly stale snapshot with no `ON CONFLICT` available, so two concurrent conversions of the same empresa still create two clientes. Adding the index is a destructive migration against live data that may already violate it, on a table this feature does not own.
- **Copy defect in `LeadStagesView`.** A `409 stage_name_taken` is rendered with a message ending in "Tente novamente", but repeating the action can never work - the operator must choose another name. Written that way because the plan prescribed the text; not changed inside the run so as not to spend a verify cycle on a slice already ready to merge.
- **A loose phrase in `CLAUDE.md`.** The prose says "slice 03's `409 already_converted`", which is the service's internal reason, while the wire body is `lead_already_converted`. Both tokens exist and the sentence does not claim to quote the body, so it is loose rather than false - it did not justify a third documentation-correction cycle in this run.
- **One recorded oracle weakness, slice 02.** `createLeadStage appends after the highest position` archives the MIDDLE etapa, so an implementation computing `max(position)` over active rows only would survive. Archiving the LAST one would be stronger. Not a failure: the mutation the plan named (positioning by count) IS caught. Recorded for follow-up rather than spending a verify cycle under a finite autopilot budget.

## 12. `CLAUDE.md` curation

The merged `## Kanban de leads` section was fact-checked twice, clause by clause, against the shipped code - once in slice 07's re-verify (thirteen clauses) and once in slice 08's.
Re-read in full for this record, it contains **no false statement**.

**One genuinely missing item is proposed, and one non-issue is explicitly left alone.**

### Proposed addition

The section is silent about `BOARD-WRITE-FENCE:START/END`.
Those four comment sentinels in `SalesOpsApp.tsx` (lines 345, 362, 1417, 1498 on `master`) are the *entire* enforcement of acceptance 13 in the file where the conversion actually happens.
They look like ordinary comments, nothing in the file explains why they must survive an edit, and deleting them or moving code out from between them would silently reopen the exact hole the mutation pass found.
This repository writes down precisely this class of load-bearing invisible structure, and this one is currently written down only in a commit message.

Suggested text, to be appended to the `READ-ONLY IS A PROPERTY OF THE CARD` bullet:

> That fence is enforced by `board-write-surface.test.ts`, a source scanner - and its scope, not its mechanism, is the thing to protect.
> It originally read only `apps/web/src/sales-ops/leads/*`, where the board lives, while the real board-to-proposta path is `saveLeadConversion` in `SalesOpsApp.tsx`; injecting a `transitionSale.mutate` there left all 911 web tests green, which the feature's mutation pass measured rather than guessed.
> That file cannot simply join the scanned list, because it also hosts the propostas screen, whose `onTransition` IS the rightful caller of that endpoint.
> So the board-owned regions carry `BOARD-WRITE-FENCE:START/END` sentinels and ONLY the text between them is scanned: the fence travels with the code.
> Those four comments are load-bearing - deleting one, or hoisting `saveLeadConversion` above a `START`, disarms the guard.
> Three properties stop that being silent: each fenced region must still contain the symbol it is named for, `does not overshoot onto the propostas screen` asserts the UNFENCED remainder still reaches a transition endpoint so the narrow scope is proven narrow rather than assumed, and the two wiring one-liners outside the fence are pinned to their exact delegating shape.

### Deliberately not changed

The section says `SalesOpsApp.tsx` is "9235 lines"; on `master` it is 9248, because `260feab` added 13 comment lines to it.
The sentence already carries its own exemption - "The number is here to justify the fence, not to be maintained: if it is stale, the fence still stands" - and that exemption is exactly for a number going stale under a LATER commit, which is what happened.
Rewriting it would be the third documentation-number churn in one feature for no gain.
Left alone, deliberately.

The scribe wrote no `CLAUDE.md` change: this run worktree predates the feature and does not carry the section, so applying the addition there would produce a conflicting edit.
The proposal above is for the orchestrator to apply on `master`.

## 13. Durable lessons distilled

Six written to `nexo/knowledge/decisions/`:

- `2026-09-19-a-source-scanning-guard-is-only-as-wide-as-its-file-list.md`
- `2026-09-19-a-green-suite-is-not-a-measurement-until-you-mutate-it.md`
- `2026-09-19-a-guard-test-must-carry-its-own-positive-control.md`
- `2026-09-19-parallel-planners-drift-on-the-contract-they-share.md`
- `2026-09-19-a-strict-comparison-against-a-clock-you-mint-yourself.md`
- `2026-09-19-documentation-that-is-law-is-code.md`
