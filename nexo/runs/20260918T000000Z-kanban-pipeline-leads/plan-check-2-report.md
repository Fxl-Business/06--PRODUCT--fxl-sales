# Plan-check 2 (audit of the revision) — feature-20260918-kanban-pipeline-leads

Verdict: **FAIL**

The revision genuinely closes all six original findings and coherently resolves R7/R8. The
02/01/04/05/06/08 slice bodies are, on their own, executable with no further design decisions. But
the revision did not sweep every file for the same defect class it fixed elsewhere, and one
independent code-block/prose contradiction survives inside slice 04. Neither is cosmetic:

## FINDINGS (ranked)

1. **[HIGH] Slice 07's CLAUDE.md draft text (§6.3, the new "Kanban de leads" section) still asserts
   a `LeadMoveCommand` type that the reconciled contract (00-OVERVIEW §"Contrato reconciliado",
   point 5) explicitly says does not exist anywhere in this feature.** Verbatim, the line the
   plan instructs the executor to commit into `CLAUDE.md` reads:
   > "The keyboard `Mover para` dialog is the SINGLE EMITTER of a `LeadMoveCommand`; the drag layer
   > calls that same emitter and installs no `KeyboardSensor` of its own..."
   Compare slice 06's own handoff note to "whoever writes the CLAUDE.md leads section" (06 §8, "To
   whoever writes the CLAUDE.md leads section"), which gives the CORRECT phrase: *"the keyboard
   `Mover para` dialog is the single emitter of a `MoveLeadPayload`"*. Slice 07 had that exact
   sentence available and still wrote the wrong type name. This is precisely the class of defect
   original Finding 4 was about (phantom `board-model.ts`/`LeadMoveCommand` artifacts), and 08's
   DEFECT 2 section was rewritten to purge it there — but nobody re-checked 07, and the replan
   report's own file-by-file accounting confirms it: "`07-web-routing.md` | R7 only: one hook call
   in §4.2. Not in the work order; recorded here." — meaning §6.3 was never touched by the revision.
   **This is committed documentation, not throwaway plan prose.** `CLAUDE.md` is this repo's
   load-bearing contract (see its own extensive self-corrections elsewhere, e.g. the dated
   "ONE-WAVE INTERNAL DISAGREEMENT" entries), and acceptance 24 requires this section to be
   written "verbatim." As written, the very first PR that lands this feature poisons `CLAUDE.md`
   with a type name that never existed, which is exactly the kind of drift the rest of `CLAUDE.md`
   is fanatical about preventing. Finding 4 is therefore **not fully closed** — it is closed in
   slice 08 only.
   *Fix required:* in `07-web-routing.md` §6.3, replace `LeadMoveCommand` with `MoveLeadPayload`
   (matching 06's own handoff sentence verbatim).

2. **[MEDIUM] Slice 04's `useMoveLead` code sample (§7, "The four phases") is internally
   self-contradictory, and the contradiction is not resolved anywhere in the slice text.** The
   literal code block calls `queryClient.getQueryData<LeadsInfiniteData>(BOARD_KEY)` /
   `setQueryData(BOARD_KEY, ...)` five times, treating `BOARD_KEY` as an already-defined constant.
   No such constant is ever declared anywhere in the slice. The paragraph immediately below the
   code block ("**`BOARD_KEY` problem, and its answer.**") explains that this cannot be a constant
   at all — because `useMoveLead` takes `filters` and the key must vary with them — and gives the
   fix as `const boardKey = queryKeys.leads.board(filters)` computed inside the hook body. The code
   block was never updated to match: it still reads `BOARD_KEY` (all-caps, i.e. a hoisted literal)
   in every one of its five use sites, which is exactly the naive, wrong reading ("hardcode
   `queryKeys.leads.board(undefined)`") the prose right below it warns against and rejects. An
   executor copying the code block literally gets a `ReferenceError`; an executor who "fixes" it by
   defining `const BOARD_KEY = queryKeys.leads.board(undefined)` at module scope reproduces the
   exact bug the surrounding prose exists to prevent (a filtered admin board's optimistic patch
   silently landing on the wrong cache entry, reverting nothing visible). This is a genuine
   "further design decision" left in the executor's hands, in direct tension with the "zero further
   design decisions" bar the plan-check exists to enforce, and it sits inside the mechanism R7's
   whole fan-out redesign depends on (one flat board cache entry, keyed by filters).
   *Fix required:* rewrite the code block to declare `const boardKey =
   queryKeys.leads.board(filters);` at the top of `useMoveLead`'s body and use `boardKey` (not
   `BOARD_KEY`) at all five call sites; or keep `BOARD_KEY` only as a doc-comment placeholder and
   say so explicitly next to the block.

Neither finding blocks slices 01, 02, 03, or the bulk of 05/06/08 from being executed as written.
Both are concentrated, single-paragraph fixes. But per the stated verdict rule — PASS only if
nothing is left for the executor to design — these two are enough to fail this audit.

---

## 1. Convergence — the six original findings

### LIVE vs DOCUMENTARY table, for every occurrence of the banned tokens

| file:line | token | text | classification |
|---|---|---|---|
| 00-OVERVIEW.md:105 | `'converted'` | "Não existe `'converted'` em camada nenhuma, e nunca existiu..." | DOCUMENTARY |
| 00-OVERVIEW.md:113-114 | `slugifyFuncao`, `duplicate_slug`, `stage_slug_taken` | "...não existem em lugar nenhum" | DOCUMENTARY |
| 00-OVERVIEW.md:116 | `stageIsReadOnly` | "`stageIsReadOnly` não existe." | DOCUMENTARY |
| 00-OVERVIEW.md:134-135 | `board-model.ts`, `LeadMoveCommand`, `board-model.test.ts` | "Não existe `board-model.ts`, não existe `LeadMoveCommand`..." | DOCUMENTARY |
| 01-leads-schema.md:178 | `duplicate_slug`, `stage_slug_taken` | "There is no `duplicate_slug`, no `stage_slug_taken`..." | DOCUMENTARY |
| 02-api-stage-cadastro.md:30,68,73,118,152,337-338,466,571 | `slug`/`'converted'`/`slugifyFuncao`/`duplicate_slug`/`stage_slug_taken` | all in "there is no X" / "do NOT import X" / "X was a drafting error" framing | DOCUMENTARY |
| 04-web-data-layer.md:73,233,236,242,441-442 | `stageIsReadOnly`, `'converted'` | "There is deliberately NO `stageIsReadOnly`... `'open'` and `'converted'` exist in no migration..." | DOCUMENTARY |
| 06-web-kanban-board.md:37,47,206,217,262,867 | `stageIsReadOnly`, `'converted'` | "`stageIsReadOnly` does not exist... asserts the literal `'converted'` appears in NO file" | DOCUMENTARY |
| 06-web-kanban-board.md:907 | `LeadMoveCommand`, `.source` | "there is no `source` field and no `LeadMoveCommand` type anywhere in this slice" | DOCUMENTARY |
| **07-web-routing.md:530** | **`LeadMoveCommand`** | **"The keyboard `Mover para` dialog is the SINGLE EMITTER of a `LeadMoveCommand`..."** | **LIVE — asserts the type EXISTS. This is the text committed to CLAUDE.md.** |
| 08-web-conversion.md:24,34,35,122-123,168-169,173,183,188,203,793 | `stageIsReadOnly`, `'converted'`, `'open'`, `board-model.ts`, `LeadMoveCommand`, `board-model.test.ts` | all "there is no X" / "X is DELETED" / "X was a drafting error" framing, or oracle names asserting absence | DOCUMENTARY |

**Verdict on Q1: five of six original findings are cleanly closed. Finding 4 is only closed inside
slice 08 — it has a live, uncorrected leak into slice 07's committed CLAUDE.md text (see Finding 1
above).** This is the one LIVE occurrence among ~40 grepped hits across the whole plan set; every
other hit is a deliberate "this does not exist" statement.

### Finding-by-finding

1. **[HIGH] slug/4-kind schema in slice 02 — CLOSED.** 02 was rewritten end to end against 01's
   real schema: one `'duplicate'` sentinel, `409 stage_name_taken` keyed on the real
   `sales_ops_lead_stages_org_name_idx`, `createLeadStage`/`updateLeadStage` re-derived against the
   real `createFuncao`/`updateFuncao` (verified against `apps/api/src/domains/sales-ops/service.ts`
   lines ~1626-1764: the mirroring is accurate down to the `.onConflictDoNothing()` /
   savepoint / `mapFuncaoUniqueViolation` shape). No `slug` anywhere. Tests renumbered and the
   `duplicate_slug` oracle deleted.

2. **[HIGH] duplicate `leadsRouter` import in `routes.ts` — CLOSED.** D4 gives the two routers
   distinct names (`leadStagesRouter` from `leads/stage-routes.ts`, mount `'/'`; `leadsRouter` from
   `leads/lead-routes.ts`, mount `'/leads'`). Slice 02 §4 spells out all four lines (both imports,
   both mounts) so the file compiles when 02 then 03 are applied in sequence. Slice 03 §4 is
   byte-consistent with what 02 predicts. Verified no alias anywhere.

3. **[HIGH] phantom `'converted'` kind, half-repaired — CLOSED, with one caveat.** D1/D3 are
   implemented consistently in 04, 06 and 08: exactly three kinds, `stageIsReadOnly` deleted,
   `leadIsConverted` is the one read-only predicate, `moveTargetsFor` offers the conversion stage as
   a destination whenever a handler is attached and excludes it only then a handler is absent, and
   the two-roles-of-one-stage table appears identically in 04's rationale and 06's contract. The
   caveat is Finding 4 below, which is adjacent but distinct (the artifact-naming defect, not the
   kind-vocabulary defect) — Finding 3 itself, narrowly read, is closed.

4. **[MEDIUM] slice 08 cited nonexistent `board-model.ts`/`LeadMoveCommand` — CLOSED IN SLICE 08
   ONLY, NOT ACROSS THE PLAN SET.** 08's DEFECT 2 section is rewritten correctly against the real
   artifacts (`MoveLeadPayload` in `api.ts`, `emitMove` in `LeadsBoard.tsx`,
   `buildMovePayload` in `board-move.ts`), and `board-model.ts` is removed from 08's
   `files_modified`. But the same wrong type name (`LeadMoveCommand`) survives, uncaught, in slice
   07's CLAUDE.md draft (§6.3) — see Finding 1. The revision's own accounting confirms 07 was only
   touched for R7's one-line hook edit, so this line was never revisited.

5. **[LOW] wrong `'../types'` import in slice 05 — CLOSED.** Fixed to `'./types'`, with an added
   paragraph distinguishing the two import paths and a comment noting the type actually lives in
   `apps/web/src/sales-ops/leads/types.ts` (slice 04's file), not the shared
   `apps/web/src/sales-ops/types.ts`.

6. **[LOW] `AUDIT.md` cites acceptance 14 instead of 15 — CLOSED.** Verified directly in
   `nexo/runs/20260918T000000Z-kanban-pipeline-leads/AUDIT.md`: both occurrences now read
   "aceitação 15".

---

## 2. R7 — the per-column list vs the flat board cache

(a) **Yes, slice 03 genuinely requires `stageId`.** `03-api-leads.md` §2:
`ListLeadsQuerySchema = z.object({ stageId: uuid, limit: ..., cursor: ..., sellerPersonId: ... })`
— `stageId` is a bare `uuid`, not `.optional()`. §3.7 argues the per-column design at length. A
board-wide request without it would indeed 400.

(b) **Yes, the fan-out design preserves slice 04's flat cache entry.** The `useInfiniteQuery`
`queryFn` in 04 §7 issues `Promise.all` of per-stage `leadsApi.listLeads` calls and merges them into
one `LeadsPage` per "round"; the outer cache entry is still one `LeadsInfiniteData` at
`queryKeys.leads.board(filters)`. `optimisticLeadMove`, `moveLeadInList`, `reconcileLeadRow` and the
rollback oracle (`leads-move-rollback.test.ts`) all operate on the flattened `leads` array across
`previous.pages[*].leads`, which is unaffected by how those pages were populated — the fan-out lives
entirely inside the `queryFn`, never in the optimistic-patch code. Acceptance 10's exact-revert
requirement is therefore preserved by construction.

(c) **The one-line change to 07 is correct in isolation, but it exposes Finding 2 above.** 07 §4.2's
`useLeadsBoard(stagesQuery.data ?? EMPTY_STAGES, filters)` matches 04's declared signature
`useLeadsBoard(stages: readonly SalesOpsLeadStage[], filters?: LeadBoardFilters)` exactly — argument
order and types agree. 06's own container prose (§4.5) already describes calling `useLeadStages()`
first and passing `(stages, filters)` to `useLeadsBoard`, so 07's concrete code is a completion of
06's prose rather than a contradiction of it. Where it goes wrong is one hop over, inside
`useMoveLead` itself (Finding 2): 07 correctly passes `filters` to `useMoveLead(filters)`, but 04's
own `useMoveLead` implementation is written against an undefined `BOARD_KEY` constant rather than
the `boardKey = queryKeys.leads.board(filters)` its own accompanying prose demands. That is a defect
inside 04, not one 07 introduced or could have caught by re-reading only its own file.

(d) **No, the fan-out does not break pagination or acceptance 16.** Wire-level pagination is
unchanged (still per-column keyset, still capped, still off `/bootstrap`); the fan-out only changes
how many per-column requests one "page" of the client-side infinite query issues. `hasMore` becoming
board-wide (true while ANY column still has a cursor) is a reasonable, explicitly-argued design
choice (04 §7), not a violation of any acceptance criterion's text.

## 3. R8 — move body field names

Confirmed byte-consistent across all four slices:

- **03** (`lead-schemas.ts`): `MoveLeadSchema = z.object({ stageId: uuid, position: ..., reason:
  ...optional(), saleId: uuid.optional() }).strict()`.
- **04** (`api.ts`): `MoveLeadPayload` keeps client names `toStageId`/`toIndex` and
  `leadsApi.moveLead` builds the wire body explicitly: `{ stageId: toStageId, position: toIndex,
  ...(reason ? {reason} : {}), ...(saleId ? {saleId} : {}) }` — field-for-field match with 03's
  schema, conditional spreads so `.strict()` never sees a stray key.
- **06** (`board-move.ts` / `LeadsBoard.tsx`): `buildMovePayload` returns a `MoveLeadPayload`;
  `emitMove` is the only place that adds `saleId` (`onMoveLead({ ...payload, saleId })`), never any
  other field.
- **08**: asserts the wire body directly (`stageId`/`saleId`, "the WIRE names, per slice 03's strict
  `MoveLeadSchema`") in oracle C3, matching 03 exactly.

No disagreement found anywhere in the chain.

## 4. D3 coherence — read-only / conversion, end to end

Exactly ONE predicate for card read-only-ness: `leadIsConverted(lead) === lead.saleId !== null`,
declared once in 04's `calculations.ts`, consumed by name in 06 (`LeadCard`, `LeadsBoard`,
`board-move.ts`'s `moveTargetsFor`) and referenced by name (never re-implemented) in 08's
`must_not_break`. No second predicate anywhere — verified via the grep table above: every
`stageIsReadOnly` hit in 04/06/08 is a "this is deleted" statement, never a live declaration.

- **A converted lead cannot be dragged anywhere.** 06 §4.3: a card where `leadIsConverted(lead)` is
  true gets no `dragHandleProps`, no `useSortable` wrapper, no `onRequestMove`. `moveTargetsFor`
  oracle 1 (`board-move.test.ts`) pins `[]` for exactly this case.
- **Dropping onto the conversion stage never moves the card before a 201.** `emitMove` (06 §4.3)
  `await`s `onRequestConversion` and only calls `onMoveLead` once it resolves a non-null id; 08's
  `saveLeadConversion` only calls `wizard.settle.resolve(created.id)` after `POST /sales` returns a
  parsed 201 body. C3 in 08's test plan explicitly asserts no `/leads/:id/move` request exists while
  `POST /sales` is in flight.
- **Keyboard and drag do exactly the same thing (acceptance 9).** Both `MoveLeadDialog.onSubmit`
  and `DndContext.onDragEnd` call the identical `emitMove`; 06's `verifier_focus` requires that
  deleting the entire dnd-kit layer leave every oracle green, which is the structural proof rather
  than an assertion about one code path.

No contradiction found in this dimension. The `LeadMoveCommand` defect (Finding 1) touches this
exact subsystem's *documentation*, not its *design* — the design itself (§2 of 06,
`MoveLeadPayload`-only, single emitter) is coherent everywhere it is actually implemented.

## 5. Frontmatter and structure

- All eight frontmatter blocks parse as valid YAML (spot-checked `id`, `depends_on`, `files_modified`,
  `acceptance`, `must_not_break`, `rules`, `verifier_focus` keys in each file).
- DAG unchanged: `01 → 02 → 03 → 04 → {05,06} → 07 → 08`, matching `depends_on` in every slice
  exactly (`02: [01-leads-schema]`, `03: [02-api-stage-cadastro]`, `04: [03-api-leads]`, `05: [04-...]`,
  `06: [04-...]`, `07: [05-..., 06-...]`, `08: [07-web-routing]`).
- `files_modified` updated where D2/D4/D5 required it: 02's router file renamed to
  `leads/stage-routes.ts` (was `leads/router.ts`); 08's `files_modified` no longer lists
  `board-model.ts` or `board-model.test.ts`.
- Wave 5 (05 ‖ 06) `files_modified` remain disjoint: 05 owns exactly
  `leads/LeadStagesView.tsx` + its test; 06 owns everything else under `leads/` plus
  `apps/web/package.json` / `vite.config.ts` / `pnpm-lock.yaml`. No overlap.
- No acceptance criterion in `00-OVERVIEW.md`'s 24-item list was reworded or weakened; the two
  frontmatter `acceptance` strings that *were* rewritten (02's, 06's) were rewritten only because a
  reconciliation decision made the old text factually wrong (slug→name index; stage-kind→card
  predicate), and both remain concrete given/when/then statements naming a real oracle, not
  softened restatements of the goal.

No structural defect found.

## 6. Anything new the revision broke

Beyond the two findings above (which are the substantive answer to this question), a systematic
house-rule pass across the revised plan set found no other new violation:

- **No DELETE verb** anywhere on `salesOpsRouter` (checked 02's and 03's route tables and their
  "has no DELETE route" oracles).
- **No native `<select>`/`<option>`/`<datalist>`, no raw `<input type="number">`** — every picker in
  05/06/08 is `Combobox`; the one numeric field (`Valor estimado (R$)`) is the wrapped
  `<Input type="number">` from `@/components/ui/input`.
- **`useInlineLayer`** — both 05 (defence-in-depth note that this screen needs none) and 06 (the
  dedicated `move-dialog-inline-layer.test.tsx`, modelled on the repo's real false-positive trap)
  handle this correctly; both new dialogs use the real `Dialog`/`DialogContent`.
- **`orgId` filtering / no ids from request bodies** — every zod schema in 02/03 is either bare
  (accepting no `orgId`/`kind`/`isSystem`/`stageId`/`saleId` key at all) or `.strict()`, and the
  contract tests assert the literal parsed result carries none of those keys.
- **`SALE_TRANSITIONS`/`EXPECTED_MATRIX`** — untouched by every slice's own `must_not_break`; no
  slice from 04 onward edits `apps/api` at all except 03 (which does not touch those symbols) and
  01/02 (schema/cadastro only). 06's `board-write-surface.test.ts` scanner and 08's C8 oracle jointly
  make "no board file reaches `/transition`" both statically and behaviourally enforced.

No other cross-slice symbol reference was found pointing at a file/type no slice creates, beyond
the `LeadMoveCommand` case already covered in Finding 1.

---

## Recommendation

Both findings are small, mechanical, single-paragraph edits (swap one type name in 07's CLAUDE.md
draft; rename one identifier consistently in 04's `useMoveLead` code block). Neither requires
touching the API layer, the schema, or any test file's assertions. A third, narrow replan pass
targeted at exactly these two spots should be sufficient to reach PASS without re-opening any of
the six original findings or R7/R8.
