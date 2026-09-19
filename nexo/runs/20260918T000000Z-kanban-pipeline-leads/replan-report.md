# Replan report - feature-20260918-kanban-pipeline-leads

Verdict: **PASS** for the six plan-check findings.
One NEW cross-slice defect was found during the repair and is also fixed (R7/R8 below); it is
called out separately because it was not in the work order and the orchestrator may want to review
the shape of the fix.

No application code was written, no test was run, nothing was committed.

---

## 1. The six findings, one by one

### Finding 1 [HIGH] - slice 02 planned against a rejected schema (`slug`, 4-kind) - **CLOSED**

Slice 01 already shipped what D2 asks for: `uniqueIndex('sales_ops_lead_stages_org_name_idx').on(t.orgId, t.name)`
is on line 135 of `01-leads-schema.md`'s Drizzle block and the migration's §3.2 already emits every
index. So the amendment to 01 was not an addition but a PROMOTION of an index that was present and
unargued: it is now named in the frontmatter `acceptance`, named in `verifier_focus`, given its own
column note explaining that it is the real `funcao_name_taken` precedent (a database UNIQUE index
surfaced as a 409, not a racy service probe), named explicitly in the migration's statement order,
and given its own integration oracle,
`refuses a second stage with the same name in one org and allows that name in another org`.
01's `No slug column` note now also states the consequence for 02 so the two cannot drift again.
That is the ONLY amendment 01 received.

Slice 02 was rewritten wherever the rejected schema had reached:
- The "Inherited contract from slice 01" block now carries 01's real shape (no `slug`, three kinds)
  plus every index and CHECK by name, and an explicit paragraph saying the `slug` column and the
  fourth kind were a drafting error.
- `stage-service.ts`: the `slugifyFuncao` import and its whole "reusing it is deliberate" paragraph
  are gone, replaced by an explicit "it imports no slugifier, because there is no slug". The
  sentinel unions lose `'duplicate_slug'`. `createLeadStage`'s steps are re-derived against the REAL
  `createFuncao` (`service.ts:1626-1653`), keeping its probe/`onConflictDoNothing`/re-probe shape and
  dropping every slug step. `updateLeadStage`'s clash probe is name-only, and
  `mapLeadStageUniqueViolation` is spelled out with ONE entry
  (`sales_ops_lead_stages_org_name_idx: 'duplicate'`), modelled on the real
  `mapFuncaoUniqueViolation` (`service.ts:1745-1764`) including the `error`/`error.cause` walk.
- The route error table loses the `duplicate_slug` row; the `409` mirror section now quotes the two
  real lines from `apps/api/src/domains/sales-ops/routes.ts` (`:276` and `:254`/`:277`) so the shape
  is copied from code rather than from memory.
- Tests: contract oracle 4 renamed to `never accepts kind, position or isSystem from the request body`
  (and it now also asserts no parsed result carries a `slug` key). Route oracle 5 renamed. The slug
  409 oracle is deleted and the list renumbered 1-12. Route oracle 7 gained a concrete body assertion
  whose `toEqual` on the whole body is what stops `stage_slug_taken` returning by symmetry. RLS
  oracle 2 gained a `2b` proving `.onConflictDoNothing()` is the real guard rather than the probe.
- The "Deliberately out of scope" list now names `slug`, the slugifier, `duplicate_slug`,
  `stage_slug_taken` and `reserved_slug` as things that do not exist.
- The frontmatter `acceptance` gained a testable `409 stage_name_taken` clause naming the real
  index; `rules` and `verifier_focus` lost `slug` and gained the "one duplicate sentinel" bar.
  No acceptance criterion was weakened.

### Finding 2 [HIGH] - two conflicting `leadsRouter` imports in `routes.ts` - **CLOSED**

Per D4, slice 02's file is renamed `leads/router.ts` -> `leads/stage-routes.ts` (frontmatter
`files_modified` updated) and its export renamed `leadsRouter` -> `leadStagesRouter`. The paragraph
claiming "slice 03 extends this same router" is replaced by a paragraph explaining why two distinct
names, and why an alias is deliberately NOT the answer (it hides that these are two routers and puts
the disambiguation in the consumer). A two-row table states each slice's file, export, mount prefix
and owned paths. §4 now spells all FOUR lines - 02's import and mount, and 03's import and mount -
so an executor applying 02 then 03 in sequence gets a file that compiles. Every other mention of
`leads/router.ts` in 02 (the harness's `await import(...)`, the `app.route` mount, the out-of-scope
note, the intro) was updated.

Slice 03 was left BYTE-UNCHANGED: it already spells its own exact import and mount lines
(`import { leadsRouter } from './leads/lead-routes.js';` / `salesOpsRouter.route('/leads', leadsRouter);`)
and its parenthetical about 02's separate mount is already correct. D4's "spell it out in both
slices" is satisfied because 02 now carries both pairs.

### Finding 3 [HIGH] - the phantom `'converted'` kind, half-repaired - **CLOSED**

D1 and D3 are implemented in 04, 06 and 08, and the design question the checker flagged is now
answered in the plan text rather than left to the executor.

`04-web-data-layer.md`:
- `LeadStageWire.kind` and `LeadStageKind` are both `'normal' | 'conversion' | 'lost'`.
- `stageIsReadOnly` is DELETED from `calculations.ts`, with a paragraph saying why re-pointing it at
  `'conversion'` would be wrong (it would make the conversion column un-droppable and acceptance 11
  unreachable) and invoking this repo's own one-gate history.
- `leadIsConverted` is promoted to THE read-only predicate, and its oracle row replaces the
  `stageIsReadOnly` one. The new oracle is decisive against a stage-keyed implementation: it asserts
  a NON-converted lead sitting in the `kind: 'conversion'` stage is not converted.
- `optimisticLeadMove`'s note is re-pointed, and gains an explicit rule that it never writes `saleId`
  optimistically.

`06-web-kanban-board.md`:
- The four-kind table becomes a three-kind table plus a "two roles of the `'conversion'` stage"
  table (source vs destination), which is the rule that resolves the contradiction.
- `stageIsReadOnly` is removed from `rules`, from the consumed-symbol list, and from every reader.
- `moveTargetsFor`'s contract is rewritten: `[]` only for `leadIsConverted(lead)`; the conversion
  stage IS a target whenever a handler is attached; no `'converted'` kind to exclude.
- `LeadsBoard`: no column is read-only; the conversion column is an ordinary droppable carrying
  `data-conversion-column`; a converted CARD carries `data-read-only-card`, gets no `onRequestMove`,
  no `dragHandleProps` and no `useSortable`. `board-ui.ts`'s `readOnlyColumnClass` becomes
  `readOnlyCardClass`.
- `onDragEnd` loses its dead "destination is read-only" branch and gains an explicit paragraph
  stating that a drag onto the conversion column moves nothing: it opens the dialog seeded there,
  and only a resolved `saleId` produces an `onMoveLead`. Drag and the keyboard menu do exactly the
  same thing because both end in `emitMove` (acceptance 9).
- `LeadDialog`'s creatable filter is `s.kind === 'normal'` (was `'open'`); the `'open'` fixture in
  board-move oracle 8 is now `'normal'`.
- Oracles: 7.1#2 is replaced by `still offers every target for a NON-converted lead sitting in the
  conversion stage` (the pair to #1, which is what proves read-only is per card); 7.1#4 is retitled
  and its decisive mutation is now "excluding the conversion stage outright". 7.3#5 is retitled to
  the card and gains a `5b` pinning that the conversion column stays a drop target. The 7.6 scanner
  regex becomes `/kind\s*===\s*'(normal|lost)'/` plus a `'conversion'`-outside-`board-move.ts` rule
  plus an assertion that the literal `'converted'` appears in no file at all.
- The frontmatter `acceptance` clause "a card in a `kind: 'converted'` column" is rewritten to
  "a CONVERTED card (`lead.saleId !== null`)" - a factual correction forced by D1, still a concrete
  given/when/then with the same oracle. `verifier_focus` (3) is rewritten around the two roles.

`08-web-conversion.md`: DEFECT 3 keeps its (correct) diagnosis and gains the second half the checker
said was missing: the exact post-repair definition, written out as four bullets, plus a note that 04
and 06 now carry it so there should be nothing left to repair.

### Finding 4 [MEDIUM] - slice 08 cites artifacts slice 06 never creates - **CLOSED**

Per D5:
- `apps/web/src/sales-ops/leads/board-model.ts` is removed from 08's `files_modified`.
- `board-model.test.ts` is removed from the §7.3 regression list and replaced with 06's real
  `board-move.test.ts`.
- DEFECT 2 is rewritten against the real code. It opens with a table naming the real artifacts
  (`MoveLeadPayload` in `leads/api.ts`, `emitMove` in `leads/LeadsBoard.tsx`, `buildMovePayload` in
  `leads/board-move.ts`), states plainly that there is no `board-model.ts`, no `LeadMoveCommand` and
  no `board-model.test.ts` in this feature, and reduces the repair to the one real line
  `onMoveLead({ ...payload, saleId })` inside `emitMove`'s conversion branch. It also records that
  `LeadsBoardContainer.tsx` needs no mapping edit (it already forwards the payload verbatim).
- `request.source` becomes `request.lead` in `requestLeadConversion`, with a comment naming 06's
  real `LeadConversionRequest` shape. 08's `verifier_focus` is rewritten to name the real artifacts.
- The repair is also now stated PRE-emptively in 04 (`MoveLeadPayload.saleId` with a doc comment
  naming `emitMove` as its only producer) and in 06 (`emitMove` spells it, and §8's handoff notes
  say `request.lead` and warn that `source` / `LeadMoveCommand` do not exist), so 08 should find
  nothing to repair.

### Finding 5 [LOW] - wrong relative import in slice 05 - **CLOSED**

`import type { SalesOpsLeadStage } from '../types';` becomes `from './types'`. The prose that said
"Slice 04 owns `apps/web/src/sales-ops/types.ts`" is corrected to `apps/web/src/sales-ops/leads/types.ts`
(04 declares the shared file byte-unchanged), and a new paragraph explains BOTH import lines in that
block - why `isOptimisticId` is `'../optimistic'` and `SalesOpsLeadStage` is `'./types'` - since the
two spellings sitting one line apart is exactly how this gets copy-pasted wrong. A note was added
that this screen deliberately reads no `kind`.

### Finding 6 [LOW] - `AUDIT.md` cites acceptance 14 - **CLOSED**

Both occurrences corrected to 15 (the heading bullet and the "que a aceitação 14 proíbe nominalmente"
line at the end of the same section). 14 is the `SALE_TRANSITIONS` / `EXPECTED_MATRIX` criterion.

---

## 2. NEW findings, not in the work order

These were found while making 04 consistent with 03. Both are hard wire mismatches that would have
broken wave 4, and both are fixed. **Flagging them explicitly because the fix for R7 is a design
choice the orchestrator did not delegate.**

### R7 - `GET /leads` is PER COLUMN; slice 04 planned a board-wide list

Slice 03's `ListLeadsQuerySchema` declares `stageId: uuid` as REQUIRED and its §3.7 argues the
choice at length ("A board loads one request per column ... the cursor stays the simple pair").
Slice 04's §1 documented `GET /leads?limit&cursor&sellerPersonId` with no `stageId`, and its
`ListLeadsParams` had no such key, so every board load would have been a `400 validation_error`.

**Fix chosen, and why.** Slice 04's whole optimistic design - `moveLeadInList` over a flat list, one
`BOARD_KEY`, `patch.previous` written back whole - exists because acceptance 10 demands an EXACT
revert of a move that crosses two columns. Splitting the cache into one entry per column would make
that rollback span two entries and would have forced a redesign of 04's §6 and its named rollback
oracle. So the per-column endpoint is reconciled by a FAN-OUT inside `useLeadsBoard`'s `queryFn`:
one "page" of the infinite query is one board-wide round of per-column requests, `Promise.all`-ed and
merged, with the page param a `Record<stageId, cursor|null>` map. The cache shape, `BOARD_KEY`,
`optimisticLeadMove`, `reconcileLeadRow`, every §8 oracle and 06's `hasMore`/`onLoadMore` props are
all unchanged. `useLeadsBoard` gains one leading argument (`stages`) and an `enabled` guard.

Propagated: 06 §4.5 (the container calls `useLeadStages()` first and passes the result), and 07 §4.2
(`useLeadsBoard(stagesQuery.data ?? EMPTY_STAGES, filters)`, with a module-level `EMPTY_STAGES` so
the identity is stable). **07 was not in the work order and this is its only edit.**

If the orchestrator prefers per-column cache entries instead, the alternative is
`queryKeys.leads.column(stageId, filters)` plus a two-entry optimistic patch, and 04's §6 and its
rollback oracle would have to be re-specified.

### R8 - the move body field names disagree

03's `MoveLeadSchema` is `{stageId, position, reason?, saleId?}` and is `.strict()`. 04's client used
`{toStageId, toIndex, reason?}` and `moveLead: ({leadId, ...body}) => ...` would have spread the
client names straight onto the wire, a guaranteed 400 on every move. Fixed by keeping the UI-facing
names on `MoveLeadPayload` (they say what the operator picked) and doing the ONE translation
explicitly in `leadsApi.moveLead`, with a mapping table in §1 and the exact code in §4, including
conditional spreads for `reason` and `saleId`. 08's acceptance and its C3 oracle were corrected to
assert `stageId` rather than `toStageId`.

---

## 3. Everything edited

| file | why |
|---|---|
| `nexo/plans/.../00-OVERVIEW.md` | new "Contrato reconciliado" section recording D1-D6 plus R7/R8, so no later reader reopens them. REQUEST, ACCEPTANCE, invariants and the slice index are byte-unchanged. |
| `nexo/plans/.../01-leads-schema.md` | D2 only: the `(org_id, name)` unique index promoted into `acceptance`, `verifier_focus`, the column notes, the migration statement order and a new oracle row. Nothing else touched. |
| `nexo/plans/.../02-api-stage-cadastro.md` | D1, D2, D4. Heaviest edit; see Findings 1 and 2. `files_modified` changed on one line only (the router file rename). `id`, `depends_on`, wave unchanged. |
| `nexo/plans/.../03-api-leads.md` | **byte-unchanged.** It is the wire source of truth and was already correct. |
| `nexo/plans/.../04-web-data-layer.md` | D1, D3, D5, plus R7/R8. `files_modified`, `id`, `depends_on`, `acceptance` unchanged. |
| `nexo/plans/.../05-web-stage-cadastro.md` | D6 only. |
| `nexo/plans/.../06-web-kanban-board.md` | D1, D3, D5, plus R7's one container line. `files_modified` unchanged (`board-ui.ts` keeps its path; only a constant inside it is renamed). |
| `nexo/plans/.../07-web-routing.md` | R7 only: one hook call in §4.2. Not in the work order; recorded here. |
| `nexo/plans/.../08-web-conversion.md` | D1, D3, D5. `files_modified` loses `board-model.ts`. |
| `nexo/runs/.../AUDIT.md` | D7: acceptance 14 -> 15, both occurrences. |

Invariants held across every edit: every slice's `id`, `depends_on` and wave are unchanged; the DAG
`01 -> 02 -> 03 -> 04 -> {05,06} -> 07 -> 08` is unchanged; wave 5's `files_modified` sets (05 vs 06)
remain disjoint; no acceptance criterion from `00-OVERVIEW.md` was weakened; the only two frontmatter
`acceptance` strings rewritten (02's and 06's) were rewritten because a decision above made the old
text factually wrong, and both remain concrete given/when/then naming a real oracle; no em dash was
introduced.
