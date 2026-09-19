# Plan-check report — feature-20260918-kanban-pipeline-leads

Verdict: **FAIL**

The plan set covers all 24 acceptance criteria on paper and the DAG/wave structure is sound, but
there are several concrete, execution-breaking inconsistencies between slices that were drafted in
parallel against different versions of the schema/wire contract. Two of them will not compile or
will fail at the database layer exactly as written (slice 02's `slug`/4-kind schema vs. slice
01/03's real 3-kind, no-`slug` schema; the duplicate `leadsRouter` import binding in `routes.ts`
across slices 02 and 03). A third (the phantom `'converted'` stage kind used by slices 02/04/06 and
only partially repaired by slice 08) leaves a real design question — how `stageIsReadOnly` and
`onDragEnd`'s read-only/hand-back branches should behave now that there is no separate terminal
stage — unresolved, in violation of the planner contract's "zero further design decisions" bar. A
fourth is a wrong relative import path in slice 05. None of these are unfixable, but as written the
plan set is not directly executable; an executor will have to make non-trivial judgment calls the
contract says should not be necessary.

## FINDINGS (ranked)

1. **[HIGH] Slice 02 is planned against a schema slice 01 explicitly rejected.** Slice 02's
   "Inherited contract from slice 01" block describes `sales_ops_lead_stages` with a `slug` column
   and a 4-value `kind` (`'normal'|'conversion'|'lost'|'converted'`). Slice 01 (the schema owner,
   finalized) explicitly has **no `slug` column** ("No `slug` column, deliberately", §2.1) and a
   3-value `kind` CHECK (`'normal'|'conversion'|'lost'`). Slice 03, which reconciled against 01 as
   written, confirms this in its own §0: *"There is no `slug` column; `kind` is the machine key."*
   Slice 02's `stage-service.ts` design (imports `slugifyFuncao`, computes and stores `slug`,
   probes `(org_id, slug)` for duplicates, returns `'duplicate_slug'`/`409 stage_slug_taken`) and
   its contract tests ("never accepts slug... from the request body", "maps a colliding derived
   slug to 409 stage_slug_taken") all reference a column and an index that will not exist in the
   database 01 ships. As literally written, slice 02's service layer will fail at
   `INSERT`/`UPDATE` time (`column "slug" does not exist`) and several of its own named oracle
   tests cannot pass. This is not a naming nit — it is a behavioural design built on a rejected
   schema. See Q1/Q5/Q6 detail below.

2. **[HIGH] `routes.ts` gets two conflicting `import { leadsRouter } from ...}` statements.**
   Slice 02 §4 instructs: `import { leadsRouter } from './leads/router.js'; salesOpsRouter.route('/', leadsRouter);`
   Slice 03 §4 instructs: `import { leadsRouter } from './leads/lead-routes.js'; salesOpsRouter.route('/leads', leadsRouter);`
   Both import statements bind the same local identifier `leadsRouter` from two different modules
   in the same file. As literally given, this is a duplicate-identifier compile error in
   `routes.ts`. Slice 02 even anticipates a *different* resolution — "Slice 03 extends **this
   same router**... that is why the file is named `router.ts` and the export is `leadsRouter`
   rather than `leadStagesRouter`" — but slice 03 does not extend `leads/router.ts`; it creates an
   independent `leads/lead-routes.ts` with its own `leadsRouter` export and its own mount call.
   Neither slice's exact code, applied literally in sequence, produces a compiling `routes.ts`.
   Fixable with an import alias, but that is a fix the executor must invent, not one either plan
   states. See Q3/Q4.

3. **[HIGH] The phantom `'converted'` stage kind is only half-repaired.** Slices 02 and 04 both
   spell `LeadStageKind` with four members including `'converted'`, and slice 06 builds
   `stageIsReadOnly(stage) === (stage.kind === 'converted')`, `moveTargetsFor`'s exclusion of
   `kind:'converted'` stages, and `onDragEnd`'s "early-return when the resolved destination is
   read-only" all around a kind value that slice 01/03's schema can never produce (only
   `'normal'|'conversion'|'lost'` exist; the single `'conversion'` stage is *both* the door and the
   post-conversion read-only column, since a lead can only ever enter it together with a resolved
   `sale_id`). Slice 08 (§1, DEFECT 3) correctly diagnoses this and says "`LeadStageKind` is
   `'normal'|'conversion'|'lost'`... fix every reader" — but it does not say what
   `stageIsReadOnly` should become, nor how `onDragEnd`'s two different `'conversion'`-triggered
   branches (the dead "read-only early return" vs. the intended "hand back to the dialog because a
   drag can't fill a wizard") are supposed to coexist once both are keyed off the same `kind`
   value. This is a genuine, non-trivial design question left to the slice-08 executor, which the
   planner contract says a fast executor should not have to resolve. See Q1/Q3/Q5 detail.

4. **[MEDIUM] Slice 08's own defect-repair section cites artifacts slice 06 never created.**
   Slice 08 §1 DEFECT 2 says the type to repair is `LeadMoveCommand` in a file
   `apps/web/src/sales-ops/leads/board-model.ts`, and its §7.3 regression list runs
   `leads/__tests__/board-model.test.ts`. Slice 06 (which 08 states it read "in full") declares no
   such file, no such type, and no such test anywhere in its `files_modified` or its body — 06's
   real `emitMove` operates directly on slice 04's `MoveLeadPayload`, with no intermediate
   "command" type at all ("The move payload type is slice 04's `MoveLeadPayload`. This slice
   declares no command type of its own." — 06's own `rules`). Slice 08's `files_modified` list
   nonetheless includes `board-model.ts`, a file no other slice creates. The underlying fix (thread
   the resolved `saleId` into the payload before calling `onMoveLead`) is simple once translated to
   06's real code (`onMoveLead({ ...payload, saleId })`), but the plan as written points the
   executor at a file and type that do not exist, which is exactly the kind of cross-slice drift
   the plan-set's own "reconcile against the shipped code" discipline (used correctly in slices 03
   and 06) was supposed to prevent here and was not applied.

5. **[LOW] Slice 05 has a wrong relative import path.** `apps/web/src/sales-ops/leads/LeadStagesView.tsx`
   imports `import type { SalesOpsLeadStage } from '../types';`. `LeadStagesView.tsx` lives in
   `apps/web/src/sales-ops/leads/`; `'../types'` resolves to `apps/web/src/sales-ops/types.ts` —
   the pre-existing, shared file slice 04 explicitly leaves byte-unchanged and which does not
   declare `SalesOpsLeadStage` at all. The type is declared by slice 04's
   `apps/web/src/sales-ops/leads/types.ts`, a sibling of `LeadStagesView.tsx`, so the import should
   be `'./types'`. Trivial to fix, but as written it is a compile error (`optimistic.ts`'s adjacent
   `'../optimistic'` import in the same block is correct, which makes the `'../types'` line read as
   a copy-paste slip rather than a deliberate choice).

6. **[LOW] `AUDIT.md` mis-numbers the acceptance criterion it cites.** `AUDIT.md`'s Gate-1-skip
   note says "a aceitação 14 exige que o escopo por vendedor seja aplicado NO SERVIDOR" — the
   seller-scoping requirement is acceptance **15** in `00-OVERVIEW.md` (14 is
   "`SALE_TRANSITIONS`/`EXPECTED_MATRIX` byte-inalteradas"). Cosmetic; does not affect any plan
   file or any test, but worth fixing so a later reader does not chase the wrong criterion.

---

## 1. COVERAGE

All 24 criteria have at least one slice that targets them directly. Mapping (slice numbers only):

| # | criterion (short) | delivering slice(s) | status |
|---|---|---|---|
| 1 | lead is its own entity, no `sales_ops_sales` insert / no sequence | 01, 03 | covered |
| 2 | lead fields incl. optional `client_id` + free text; no auto-create of cliente | 01, 03 | covered |
| 3 | lead produtos in child table, nullable `product_id` + snapshot, not jsonb | 01 | covered |
| 4 | vendedor via `person_funcoes`/`vendedor` função, never `is_seller` | 03 (API), 06/07 (web `hasFuncao`) | covered |
| 5 | etapas own table, per-org seed, admin CRUD, 409 on system, no DELETE | 01, 02, 05, 07 | **covered but defective** — see Finding 1: 02's implementation targets a schema (`slug`, 4-kind) that does not exist |
| 6 | `Perdido` requires reason; API 400 + UI block | 03, 06 | covered |
| 7 | days-parked badge from `stage_changed_at`, unaffected by ordinary edits | 03, 04, 06 | covered |
| 8 | manual in-column order persists via `position`; reorder doesn't touch `stage_changed_at` | 03, 04 | covered |
| 9 | drag + keyboard "Mover para" parity; Combobox only | 06 | covered |
| 10 | optimistic move w/ exact revert | 04 | covered |
| 11 | move-to-conversion opens wizard prefilled; card moves only after 201; cancel leaves no state; ghost-card guard | 06, 08 | covered, contingent on Finding 3/4 repairs landing correctly |
| 12 | conversion resolves/creates cliente at conversion time only | 08 | covered |
| 13 | post-conversion read-only column mirrors `sale.status`; no `/transition` call | 03, 06, 08 | **covered but at risk** — see Finding 3 |
| 14 | `SALE_TRANSITIONS`/`EXPECTED_MATRIX` byte-unchanged | 01, 02, 03, 08 (each declares `must_not_break`) | covered |
| 15 | admin full board + seller filter under `operacional/`; own-leads only under `meus-dados/`; server-side scoping proven in `apps/api/test/rls/` | 03, 06, 07 | covered |
| 16 | leads not on `/bootstrap`; own paginated endpoint | 03, 04 | covered |
| 17 | no lead value in `getSalesOpsSummary`/dashboard/`computeSaleFinancials`, proven by test | 03 (`leads-no-financial-impact.test.ts`), 04 | covered |
| 18 | no new screen inside `SalesOpsApp.tsx` (8946 lines) | 05, 06, 07, 08 | covered |
| 19 | stage movement writes no `audit_log` | 02, 03 | covered |
| 20 | every query filters `orgId`; no `org_id`/`user_id`/`person_id` from body | 01, 02, 03 | covered |
| 21 | new routes go through `resolveSalesOpsRoute`/`buildSalesOpsPath`; canonical routes unchanged | 07 | covered |
| 22 | drag-and-drop dep added, pinned exactly, justified in commit | 06 | covered (verified: no such dependency exists in `apps/web/package.json` today) |
| 23 | lint/type-check/test/build/`test:integration` all green at wave end | every slice's own command list + Nexo's per-wave full-suite gate | covered at the process level (not a single slice's deliverable, correctly) |
| 24 | `CLAUDE.md` gains leads-domain section + `navigation.ts` claim fixed in the same commit | 07 (opens section, fixes the stale claim), 08 (appends more paragraphs to the same section) | covered |

No criterion is entirely undelivered. Criterion 5 and criterion 13 are the two whose delivering
slices contain the defects described in Findings 1 and 3 respectively — "covered" on paper, but the
plan text for the delivering slice will not produce the described behaviour without the executor
independently discovering and re-deriving the fix.

## 2. TESTABLE ACCEPTANCE

Every slice's frontmatter `acceptance` is a concrete given/when/then naming a real oracle (a status
code + body shape, a named test file, a specific invariant like "position `[0,1,2]`" or "no
`POST /sales/:id/transition` reachable"). None are restatements of the goal with no falsifiable
check. No changes needed here — this is the strongest part of the plan set. Representative
examples: 01's acceptance names the exact CHECK/index/FK behaviours it must reject; 04's acceptance
is a single concrete drag-then-fail-then-revert scenario with an exact expected card position; 06's
acceptance enumerates five distinct behaviours (keyboard emit, lost-reason gate, conversion-wait,
converted-column immovability, no second mutation path) each with its own decisive-mutation test.

## 3. DEPENDS_ON SANITY

DAG: `01 → 02 → 03 → 04 → {05, 06} → 07 → 08`. No cycle, no dangling id (every `depends_on` entry
names a slice that exists in the index). Waves as declared: 1:{01}, 2:{02}, 3:{03}, 4:{04},
5:{05,06}, 6:{07}, 7:{08}.

Every edge is genuinely required:
- **02 needs 01**: reads `sales_ops_lead_stages` (schema), needs the seeded rows to exist.
  Real, though the specific shape 02 assumes is wrong (Finding 1).
- **03 needs 02**: 03's plan explicitly collapses the duplicate `withTenant` 02 was forced to
  introduce, and both routers mount into the same `routes.ts` region. Real, and 03 did the
  reconciliation work correctly (unlike 02, which was not revisited after 01 landed).
- **04 needs 03**: consumes the real wire shapes; 04's own plan flags this and instructs the
  executor to reconcile field names against the shipped API. Real.
- **05 needs 04**: imports `SalesOpsLeadStage` (Finding 5: import path is wrong, but the
  dependency itself is real).
- **06 needs 04**: consumes `types`, `api`, `calculations`, `hooks` by exact name throughout. Real,
  and heavily documented.
- **07 needs {05, 06}**: mounts both screens; needs the containers/components to exist. Real.
- **08 needs 07**: needs the mount site inside `SalesOpsApp.tsx` where `onRequestConversion` can be
  wired, and 08 says so explicitly (§0). Real. (08 transitively needs 04/05/06 too, which the chain
  supplies.)

No missing edge found: nothing in a later slice reaches for a symbol an earlier slice in the chain
does not (eventually) provide. The one soft spot is that 08 is asked to *repair* files owned by 04
and 06 after they are already merged (see Findings 3/4) — that is allowed by Nexo's serial-merge
model and is explicitly budgeted for in 08's plan (§1's "Executor: check each one first..."), so it
is not a DAG defect, but it is a real execution-order risk (Finding 3/4) since the repair
instructions target artifacts that in one case (04's `LeadStageKind`) exist but are wrong, and in
another case (06's `board-model.ts`) do not exist at all.

## 4. FILES_MODIFIED

All paths are repo-relative and canonical (no leading slash, no `..`, consistent with the rest of
the tree). Wave 5 is the only parallel wave (05 + 06); their `files_modified` sets are **disjoint**:

- 05: `apps/web/src/sales-ops/leads/LeadStagesView.tsx`,
  `apps/web/src/sales-ops/leads/__tests__/lead-stages-view.test.tsx` — two files.
- 06: `apps/web/package.json`, `apps/web/vite.config.ts`, `pnpm-lock.yaml`,
  `apps/web/src/sales-ops/leads/{board-labels,board-move,board-ui}.ts`,
  `apps/web/src/sales-ops/leads/{LeadCard,LeadsBoard,MoveLeadDialog,LeadDialog,LeadsBoardContainer}.tsx`,
  and six test files.

No overlap. Both slices' own text calls this out explicitly and correctly (05: "`apps/web/package.json`
must be byte-unchanged by this slice"; 06: "`apps/web/package.json`... belong to this slice alone in
wave 5"). This is the one part of the parallel-safety signal that is done right.

Cross-wave (non-parallel) file reuse is fine by construction (01 → 03 both touch `service.ts`/`schema.ts`
sequentially; 06 → 07 → 08 all touch `LeadsBoardContainer.tsx` sequentially; 07 → 08 both touch
`SalesOpsApp.tsx` sequentially) — none of these are same-wave, so they are not a parallel-safety
violation, just a normal serial edit chain.

Two concrete problems found under this question, both severity-relevant:

- **`board-model.ts` in slice 08's `files_modified`** names a file no other slice creates and that
  slice 06 explicitly says it does not create (Finding 4). Since 08 is a solo wave, this is not a
  *parallel*-safety violation, but it is a `files_modified` entry describing a "repair" to an
  artifact that does not exist — the list is misleading about what 08 will actually have to build.
- **`routes.ts` is edited by both 02 and 03** (correctly listed in both `files_modified`, since it's
  sequential, not parallel) but the two edits are not composable as literally specified — see
  Finding 2. This is not a wave-parallelism defect (the tool correctly did not flag it, since 02 and
  03 are different waves), but it is exactly the kind of "a slice will obviously have to touch a
  file/identifier it did not declare a resolution for" gap the question asks about: neither plan's
  `routes.ts` snippet, taken in sequence, produces working code.

No file is missing that a slice will "obviously have to touch": each slice's `apps/api` or
`apps/web` edits line up with what its body describes, module for module.

## 5. HOUSE RULES

Checked against every named invariant:

- **`SALE_TRANSITIONS`/`EXPECTED_MATRIX` byte-unchanged** — declared in `must_not_break` by 01, 02,
  03, 08, and 08 explicitly notes `apps/api` is not touched by it at all. No plan edits either
  symbol. Pass.
- **No DELETE verb on `salesOpsRouter`** — 01 ships none, 02 explicitly enumerates the four routes
  with no DELETE and tests for it, 03 does the same for `/leads`. Pass.
- **`<select>`/`<option>`/`<datalist>` banned, Combobox only** — 05 has no picker at all (correctly
  reasoned, and pinned by a UI-contract test scanning its own source); 06 uses `Combobox`
  throughout for every picker and pins the ban with a source-scan test (`board-write-surface` /
  `uses no native picker` test in 05, similar intent in 06). Pass.
- **Raw `<input type="number">` banned** — 06 uses `<Input type="number">` from `@/components/ui/input`
  (the wrapped component), never a raw element. Pass.
- **`useInlineLayer` for absolutely-positioned layers inside a Dialog** — 06 uses the real
  `Dialog`/`DialogContent` (the registry host) for both `MoveLeadDialog` and `LeadDialog`, and has a
  dedicated, non-mocked-Dialog regression test (§7.5) modeled on the existing false-positive trap.
  05 needs no `useInlineLayer` call (no absolutely-positioned layer on that screen) and says so.
  Pass.
- **No lead value reaching `getSalesOpsSummary`/dashboard/`computeSaleFinancials`** — 03 has a
  dedicated integration test file for exactly this (`leads-no-financial-impact.test.ts`), and 04's
  optimistic-move oracle #5 independently asserts the sales-ops bootstrap cache entry is never
  touched. Pass.
- **Leads not in `/bootstrap`** — 03 gives leads their own paginated endpoint and tests
  `getSalesOpsSnapshot` deep-equality before/after; 04 gives leads their own top-level query-key
  root, explicitly not nested under `salesOps`. Pass.
- **No new screen inside `SalesOpsApp.tsx`** — 05/06 build both screens as standalone files; 07's
  edit to `SalesOpsApp.tsx` is imports + two `titleForView` entries + two conditional mount blocks +
  one `headerAction` guard + one `useMemo`, no view component declared there; 08 adds a union arm
  and a handler to the *existing* wizard dialog, not a new screen. Pass.
- **Tenant queries filter by `orgId`; no `org_id`/`user_id`/`person_id` from request bodies** —
  explicit rules and dedicated tests in 01, 02, 03 (e.g. "never trusts orgId, slug, kind or isSystem
  from a lead stage request body", "passes the VERIFIED org and never an orgId from the body or the
  query"). Pass.
- **Wizard's `type="button"` rule** — 05, 06 and 08 each state every button is `type="button"` on
  every render, with the dialog's own submit as the sole exception where applicable, matching
  CLAUDE.md's rule about never deriving the attribute from state. Pass.

The one house-rule-adjacent area that is **not** cleanly satisfied is the "one gate, no drift"
spirit CLAUDE.md repeatedly enforces elsewhere in this repo (e.g. the `requireHubAuth` /
`classifyHubAccess` history, the `hub-rotated-cookie.ts` deletion): slices 02, 04 and 06 built a
second, non-existent stage-kind vocabulary (`'open'`/`'converted'`) alongside 01/03's real one
(`'normal'`/no fourth kind), which is precisely the class of drift this repo's own history says to
avoid. See Finding 3.

## 6. MIGRATION NUMBERING

Checked against the actual `apps/api/drizzle` directory in this worktree: the highest existing
migration is `0021_hub_session_absolute_ttl.sql` (journal `idx: 21`, 22 total entries `0000`–`0021`,
including a legitimate precedent of two files sharing numeric prefix `0007` distinguished by tag).
`0022` is therefore genuinely the next free integer, and slice 01 claims it correctly.

Slice 03 claims `0023`, and — because 01 → 02 → 03 is a strictly sequential chain with no other
slice adding a migration in between — by the time 03 executes, 01 (and its `0022` entry) is already
merged, so `0023` is the correct next number with no race. Slice 03's own text hedges this
correctly ("if 01 and 02 took more, shift"), which is the right level of caution.

Both 01 and 03 regenerate `meta/_journal.json` via `pnpm db:generate` rather than hand-editing it,
and both instruct the executor to verify via `git diff --stat` that exactly one new entry was
appended and no existing entry was rewritten. Since 01 and 03 are never in the same wave, there is
no concurrent-write collision on `_journal.json` to worry about. No defect found here.

## 7. RISK

Ranked by likelihood of actually biting during execution:

1. **Slice 02 executed literally will not run against the real (01/03) schema.** This is the
   highest-probability failure: 02's service layer computes and writes a `slug` column that does
   not exist, and several of its own named oracle tests assert `409 stage_slug_taken` behaviour that
   cannot occur. The plan *does* say "If 01 shipped different identifiers, 01 wins. Adapt the
   names, never the behaviour" — but the behaviour itself (slug-based duplicate detection, a fourth
   `kind` value) is what's wrong, not just the names, so that escape clause does not actually cover
   the gap. **What the plan should say and does not:** an explicit instruction to drop slug-based
   duplicate detection entirely and probe uniqueness on `(org_id, name)` alone, and to drop the
   `'duplicate_slug'`/`stage_slug_taken` sentinel and its tests.
2. **`routes.ts`'s two `leadsRouter` imports collide.** Concrete compile break unless the executor
   notices and aliases one import. **What the plan should say and does not:** either 02 or 03 should
   spell out the exact import alias (`import { leadsRouter as leadStagesRouter } ...`) so the two
   mounts compose without a second design decision.
3. **The `'converted'` kind cleanup in slice 08 is underspecified.** Slice 08 correctly identifies
   the defect but does not specify the resulting behaviour of `stageIsReadOnly` / `onDragEnd`'s
   read-only branch once there is no fourth kind, and its own repair instructions for DEFECT 2 point
   at a file (`board-model.ts`) and type (`LeadMoveCommand`) that slice 06 never created. **What the
   plan should say and does not:** the exact post-repair definition of `stageIsReadOnly` (most
   likely: delete the stage-level read-only column concept entirely and gate purely on
   `leadIsConverted(lead)` per card, since every lead in the `'conversion'` stage is definitionally
   already converted), and the exact real file/line in `LeadsBoard.tsx`'s `emitMove` to edit instead
   of `board-model.ts`.

Two secondary, lower-probability risks worth a one-line mention: the `pnpm add --save-exact` network
dependency for `@dnd-kit/*` in slice 06 is already well-handled (explicit park condition, no
workaround permitted) and is not a plan defect; and the wrong `'../types'` import path in slice 05
(Finding 5) is trivial enough that most executors will self-correct it on the first type-check
failure, but it is still a defect in the plan text as written.
