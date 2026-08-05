# Plan-check reconciliation report

Run: `feature-20260805-cadastro-archive-history`
Branch: `feat/cadastro-archive-history` (nothing committed, nothing switched)
Scope: the Frame plus the four plans in `nexo/plans/feature-20260805-cadastro-archive-history/`.

Verdict: **PASS.** The four plans are now mutually consistent and collectively satisfy the Frame's five
acceptance criteria, with criterion 1 amended to the four status-bearing cadastros.

Ten collisions were resolved - the five named in the brief plus five found adversarially. Every
resolution was applied by editing the plan files; no production code was written.

---

## Ground truth established first

| Claim | Verified |
| --- | --- |
| Highest migration on disk | `0018_professional_payable_identity`; `meta/_journal.json` last `idx: 18` |
| `sales_ops_clients` columns | `id, org_id, name, contact, legal_name, document, address, legal_rep_name, legal_rep_document, created_at, updated_at` - **no `status`** (`apps/api/src/db/schema.ts:683-699`) |
| `audit_log` columns | `id, ts, actor_user_id, actor_org_id, action, entity_type, entity_id, before_jsonb, after_jsonb, request_id, prev_hash, entry_hash` - no `org_id` |
| `writeAuditEntry` input | `WriteAuditEntryInput` has no place for an actor name; `after_jsonb` is the only free slot |
| `userLabel` / `isUserLabelFallback` | `apps/web/src/lib/displayNames.ts`; fallback order name -> email -> raw id |

---

## COLLISION 1 - migration number

**Found:** slice 01 claimed `apps/api/drizzle/0019_cadastro_archive_lifecycle.sql` (a cliente `status`
column); slice 02 claimed `0019_audit_log_org_history_idx.sql`. Both cannot be `0019`.

**Decision:** renumbered from reality, not from the brief's assumption. Because collision 2 deferred
cliente, **slice 01 lost its migration entirely**, so slice 02 keeps `0019` rather than moving to `0020`.

That is not a stylistic choice. `drizzle-kit generate` derives the next tag from the journal's last
`idx` (18), so `0019` is the number the tool will actually emit. Forcing `0020` would require
hand-editing `meta/_journal.json`, which slice 02's own plan explicitly forbids.

**Edits applied:**
- `01` frontmatter: removed `apps/api/drizzle/0019_cadastro_archive_lifecycle.sql`,
  `apps/api/drizzle/meta/_journal.json`, `apps/api/drizzle/meta/0019_snapshot.json` and
  `apps/api/src/db/schema.ts` from `files_modified`.
- `01` body: deleted the schema section and the whole migration section; added an explicit
  "This slice has NO migration and does NOT modify `apps/api/src/db/schema.ts`" statement, and
  corrected the "How to run" comment that claimed `global-setup.ts` applies `0019` for it.
- `02` section 0 item 1 and section 4.4: `0019` restated with the journal evidence, the expected
  `_journal.json` entry spelled out, a "if drizzle-kit emits anything other than 0019, stop" rule
  added, and the phased-header prohibition moved in from slice 01.

---

## COLLISION 2 - cliente scope

**Found:** slice 01 planned the `sales_ops_clients.status` column, the zod key, the service plumbing and
audit coverage. Slices 03 and 04 had each **independently** decided to defer cliente, both citing that
`ClientSchema` silently strips an unknown `status` key so a `PATCH` would answer `200` on an unchanged
row.

**Decision: DEFER cliente out of the whole feature.** Weighed as instructed:

- The user asked for "products, persons, roles and so on" and did not name clientes.
- Two independent planners hit the same blocker and both refused to build the UI.
- Shipping slice 01's half alone means an **irreversible migration** behind a code path with no caller
  anywhere in the product. That is strictly worse than a smaller coherent feature.
- Nothing else in the feature depends on it: the history read, the archive affordance and the restore
  all work identically over four cadastros.

The alternative (adding the control to 03 and the restore to 04 in full) was rejected because it
expands two already-large web slices to serve a cadastro nobody asked for, and because the cliente
picker in the proposta wizard would then also need the archived-row treatment - a third surface.

**Edits applied:**
- `01`: the "Frame correction" section replaced by "Cliente is OUT of this feature, and this slice
  carries no migration", stating the ruling and its four consequences. `CadastroEntityTypeSchema` cut
  from five members to four. `updateClient` and `ClientSchema` removed from the change list and from
  the update-function table. Acceptance rewritten. Oracle assertion 5 cut to four entity types; new
  assertion **5b** added, pinning that a cliente write produces **zero** ledger rows so nobody quietly
  re-instruments it. `client-legal-fields.test.ts` removed from `files_modified` with an explicit note
  saying why it needs no edit. Risk 5 (the cliente column reaching the web) deleted as moot.
- `03` §7: the "Note for the API slice" rewritten from "here is how to add the column" to "the column
  was struck feature-wide, here is where the deferral note lives".
- `04` §1.5: the cliente paragraph rewritten - no `cliente` entry is ever written, but the
  `{ state: 'none' }` branch for an unrecognized `entityType` is **kept and still tested**, so a future
  cliente entry renders read-only instead of producing a button that sends an unknown field.
- `00-OVERVIEW.md`: the CORRECTION block extended with a RESOLUTION block; acceptance criterion 1
  amended to "every **status-bearing** cadastro (produto, pessoa, função, área)"; a new
  **"Deferred: archiving a cliente (ROADMAP-ready)"** section appended with a verified six-step
  recipe (schema, generated migration with its exact expected SQL and the phased-header prohibition,
  `ClientSchema` + `updateClient` with the conditional-spread detail, audit enrolment including
  replacing oracle assertion 5b with its positive case, the five web edits, and the wizard client
  picker), plus the `getSalesOpsSnapshot` `select *` gotcha.

---

## COLLISION 3 - actor contract

**Found:** slice 04 assumed `actor: { id, name, email }`. Slice 02 returns `actorUserId: string` plus
`actorDisplayName: string | null`.

**Decision:** slice 04 rebound to slice 02's real shape - **and the gap underneath it was closed**,
because binding alone would have left the Frame's acceptance criterion 3 unmet.

Slice 02's resolution chain was self, then org-scoped `finders`, else `null`. That names **you** and
resolves a finder, but a second workspace admin's archive would read as an unnamed actor forever -
there is no Hub account directory (`@fxl-business/hub-sdk/server` exports only `createHubBff` and
`requireHubAuth`) and `sales_ops_people` has no account-id column. Slice 02 itself flagged the durable
fix as "snapshot the name at write time" and correctly said it could not do it, since that is the write
path. Slice 01 **is** the write path and is in this feature.

So: **slice 01 now snapshots the actor's display name from the verified token** into
`after_jsonb.actorLabel`, and slice 02 reads it as step 0 of the chain. The `getHubActorDisplayName`
helper and the `MinimalHubAuthContext` widening **moved from slice 02 to slice 01** - both slices had
planned the identical edit to `apps/api/src/middleware/app-auth.ts`, which would have been a guaranteed
conflict.

**What is displayed when `actorDisplayName` is null**, stated exactly as required:

> primary label `Autor não identificado` in the ordinary cell style, and `actorUserId` **beneath it**
> as muted monospace secondary text (`font-mono text-xs text-muted-foreground`).

The raw account id is never the row's headline in any branch. `actorUserId === 'system'` renders the
`Sistema` badge and no id.

**Edits applied:**
- `01`: `CadastroActor` gains `displayName: string | null`; `afterJsonb` gains `actorLabel` with the
  rationale; new section 2 adds `app-auth.ts` (with an explicit "this helper lives in slice 01, not
  slice 02" note); routes pass `getHubActorDisplayName(c.get('hubAuth'))`; `files_modified` gains
  `apps/api/src/middleware/app-auth.ts`. Oracle assertions 1 and 2 updated for the new `after_jsonb`;
  new assertion **2b** pins `actorLabel === null` and `!== ACTOR.userId`, the guard against someone
  writing `displayName ?? userId`. `routes.test.ts` gains a `displayName: null` case.
- `02`: `app-auth.ts` removed from `files_modified`; section 4.5 rewritten to **"DO NOT EDIT, slice 01
  owns it"**; resolution chain gains step 0; `actorLabelSnapshot` added to the projection but
  deliberately **not** to the response type, so there is exactly one field the web can render as a
  person. Oracle assertion 10 expanded to all four branches including a third-party actor. Fixtures
  extended with an `actorStranger` row carrying a snapshot and rows deliberately lacking one.
- `04`: A4 replaced by **C4** with the three rendering branches; the IA table's `Quem` row rewritten;
  the panel's actor cell rewritten; test 2 renamed and strengthened to assert the primary label is a
  phrase, that it does **not** carry `font-mono`, and that the id does.

---

## COLLISION 4 - route path and response shape

**Found:** slice 04 wrote `GET /api/v1/sales-ops/cadastro-history`, envelope `{entries}`, no pagination,
`action: "<entity>.<verb>"`, `entityType` as an English singular noun, `entityLabel` present.
Slice 02 ships `GET /api/v1/sales-ops/history`, `{entries, nextCursor}`, keyset pagination,
`String(row.id)`, and **omits the jsonb blobs**.

**Decision:** slice 04 rewritten to slice 02 exactly. Three sub-decisions:

**(a) The name snapshot.** Slice 04 needed `entityLabel`; slice 02's projection had no such field.
Resolved in slice 02's favour of *adding* it, because slice 01 already writes exactly that scalar
(`after_jsonb.label`) for exactly this purpose, and no other source exists - the live row carries only
its *current* name, so without it the "renamed since archiving" disclosure is impossible.
It is projected as `after_jsonb ->> 'label'`, a **named scalar extraction**, so section 2.6's PII rule
survives intact: the blob is still never selected, and `->>` returns `NULL` for every pre-existing
writer. An explicit prohibition was added against "simplifying" it into selecting `afterJsonb` and
picking keys in JS, which would pull every payout blob across the wire.

**(b) The action filter had to become a set.** Slice 02 returns *every* action for the org. Slice 04's
panel renders two. With a single-value `action` filter, slice 04 would have to merge two independently
keyset-paginated streams (impossible - two cursors, one list) or filter client-side, which silently
turns `limit=50` into "however many of the last 50 org events were archives" and can render an empty
panel for an org with a busy commission ledger. So slice 02's `action` now accepts a comma-separated
set of up to 10 values applied with `inArray`. Slice 02's decoupling argument is preserved: the server
still hard-codes no action name; the *client* chooses the set.

**(c) The truncation footer.** Slice 04 derived it from `entries.length === 50`. Slice 02 fetches
`limit + 1` precisely so `nextCursor` is exact, making the length heuristic strictly worse - it claims
truncation on an org whose history is exactly 50 events and complete. Slice 04 now reads
`nextCursor !== null`, which is why `normalizeCadastroHistory` returns `{rows, hasMore}` rather than a
bare array.

**Also corrected in slice 04, all three of which would have produced a silently read-only history:**
`action` is `cadastro.archived` / `cadastro.restored` (two actions, entity carried on `entityType`),
**not** `"<entity>.<verb>"`; `entityType` is pt-BR `produto` / `pessoa` / `funcao` / `area`, **not**
`product` / `products` / `sales_ops_products`; the actor is two flat fields, not an object, and there
is no `email` in the payload at all.

The old draft's normalizer tolerance (both tenses, three entityType spellings) was **deleted**: it was
the price of planning against an unwritten sibling, and with one known writer it would only hide a real
contract break. Test 8 now asserts the English and plural spellings resolve to `null`, so the tolerance
cannot creep back.

**Edits applied:** `04` sections 0 (A1-A4 -> C1-C5), 1.3, 1.4, 1.5, 1.9, 2.1, 2.3, 2.4, 2.5 and all of
section 3's tests; `02` sections 0, 2.4, 2.6, 4.1, 4.2, 5, 6.1 (assertions 5, 5b, 7, 9, 10, 11 and the
fixtures) and 6.2 (assertion 6b).

---

## COLLISION 5 - file overlap and `depends_on`

**Found:** slices 03 and 04 both modify `apps/web/src/sales-ops/api.ts`, `hooks.ts` and
`SalesOpsApp.tsx`. Slice 03 declared `depends_on: []`; slice 04 declared `depends_on: [02]`.

**Decision:**
- **Slice 03 keeps `depends_on: []`** - verified correct. Every endpoint it calls exists on `master`;
  it needs nothing from 01 or 02 and may run in the same wave as 01.
- **Slice 04 becomes `depends_on: [02-org-scoped-history-read, 03-archive-affordance]`**, so the
  execution order is unambiguous: `01` and `03` may run together, then `02`, then `04`.

The dependency on 03 is not merely file-serialization. Collision 9 below makes slice 04 *consume*
`useSetSalesOpsCadastroStatus`, `SetCadastroStatusPayload`, `CadastroResource` and `CadastroStatus` from
slice 03, so running out of order is a compile error, not a merge conflict.

**Edits applied:** `04` frontmatter `depends_on` and `files_modified` (converted to block list);
`03` frontmatter `files_modified` converted to block list for consistency; a new `03` section 0
records the ordering; `04` risk 6 rewritten to state the compile-order consequence.

All `files_modified` paths in all four plans were re-checked as repo-relative and canonical.

---

# Additional collisions found adversarially

## COLLISION 6 - slice 04 would have rendered non-cadastro ledger rows

Slice 02 returns every action for the org; slice 04's normalizer dropped only entries missing `id`/`ts`
and fell back to "the raw action, muted" for an unknown verb. A `commission.created` row would have
rendered inside a card titled `Histórico de arquivamentos` **and** consumed the 50-row budget.
Resolved by collision 4(b): slice 04 now sends the mandatory `action` set, and slice 02 supports it.

## COLLISION 7 - `entityType` vocabulary mismatch

Slice 01 writes pt-BR (`produto`, `pessoa`, `funcao`, `area`); slice 04 matched English singular nouns.
Every history row would have resolved to `kind: null` and rendered read-only - the feature would have
listed archives it could never restore, with no error anywhere. Slice 04 now matches slice 01's four
literals exactly. Recorded as a live risk in **all three** of 01, 02 and 04, because nothing
type-checks the API/web pair; slice 01's oracle assertion 5 and slice 04's test 8 are the only guard.

## COLLISION 8 - two different exported types named `CadastroKind`

Slice 03 exports `CadastroKind = 'produto'|'servico'|'area'|'funcao'|'pessoa'` from `SalesOpsApp.tsx`;
slice 04 exported `CadastroKind = 'product'|'area'|'funcao'|'person'|'client'` from
`cadastro-history.ts`. Same name, same directory, different members - it compiles, and it is a trap.
Slice 04's is renamed **`HistoryEntityKind`** and adopts slice 01's pt-BR values. The two vocabularies
are genuinely different and the plan now says why: slice 03 splits produto from serviço for
confirmation copy, which a ledger row cannot (`entity_type` is `produto` for both).

## COLLISION 9 - two competing restore implementations

Slice 03 §2.3 promised slice 04 would reuse `useSetSalesOpsCadastroStatus` verbatim. Slice 04 instead
built its own `useRestoreCadastro` fanning out over `saveProduct`/`saveArea`/`saveFuncao`/`savePerson`
with `{id, name, status}` bodies.

**Slice 03's design wins**, and the decisive argument is not tidiness: the history panel renders from a
cached bootstrap, so echoing a cached `name` back on a restore can **silently revert a rename made in
another tab**. A status-only body cannot. Slice 04's `useRestoreCadastro` is struck; with it go its
four `salesOpsApi` dependencies, its pessoa `funcaoIds` special case (restore condition 6, now
unnecessary since a status-only PATCH omits `funcaoIds` and `planPersonFuncoes` returns
`{kind:'unchanged'}`), and its old risk 4. Test 3 now asserts `toEqual({resource, id, status})` on the
whole object, which pins the absence of a `name` key.

## COLLISION 10 - a wrong cache-invalidation instruction

Slice 03 §7 told slice 04 to add its history key to `useSetSalesOpsCadastroStatus`'s `invalidates` list
"or a restore will not refresh the history". That is wrong, and slice 04's own §1.7 had it right:
TanStack invalidates by prefix, `queryKeys.salesOps.all` is `['sales-ops']`, and the history key is
`['sales-ops','cadastro-history',limit]`. Following slice 03's note would have been the only thing
forcing slice 03 to know the panel exists - defeating the reason the key is nested there. Corrected in
both plans, with the reasoning recorded so it is not "fixed" back.

Slice 03 §7 also credited **slice 02** with owning `writeAuditEntry` on the sales-ops write path. That
is slice 01. Corrected.

---

# Adversarial sweep - the checklist

### Does the set deliver the Frame's five acceptance criteria?

| # | Criterion | Status |
| --- | --- | --- |
| 1 | Every cadastro archivable from the UI behind a naming confirmation | **Met, amended.** Slice 03 covers produto, serviço, área, função, pessoa with per-cadastro pt-BR copy. Cliente deferred; criterion amended in the OVERVIEW with a ROADMAP-ready note. |
| 2 | Archive and restore append a hash-chained entry in the same transaction | **Met.** Slice 01, with two rollback oracles (assertions 8 and 9) that a fire-and-forget write cannot satisfy. |
| 3 | Configurações shows an org-scoped history naming the actor as a person | **Met - and this was a real gap before plan-check.** Slice 02 alone would have named only the caller and org-scoped finders. Slice 01 now snapshots the actor name at write time (collision 3), which is the only mechanism that can name a third party. |
| 4 | Restore from that history is a NEW ledger entry, never a rewrite | **Met.** Slice 01 assertion 2 pins the first row byte-identical after a restore; slice 04 states it on screen and refuses restore on a restore event (test 5). |
| 5 | `verifyChain` still valid after archive/restore traffic | **Met.** Slice 01 assertions 3 and 10, plus the E2E pass in slice 04 §4. |

### Missing or untestable acceptance?

All four frontmatter `acceptance` strings are single, mechanically checkable claims. Slice 01's and
slice 04's were rewritten during this pass (cliente removed / actor snapshot added; real endpoint,
real hook and the null-actor label added). Slice 02's gained `entityLabel`. No slice lacks one, and
none is untestable as written.

### CLAUDE.md compliance

- **No DELETE verb anywhere.** Confirmed: no plan adds one; slice 03 §1 and slice 02 §5 both say so
  explicitly. Slice 01's raw `DELETE FROM audit_log` is integration-test fixture cleanup, not a route.
- **System funções unarchivable with NO affordance at all.** Slice 03 §2.6 renders the control only in
  the `isSystem === false` branch (never disabled), Block C pins both negatives plus a positive control
  on `Designer`. Slice 04 restore condition 5 refuses it too, and the plan now notes this state is
  already unreachable because slice 01's `updateFuncao` guard returns before any write - the UI guard
  is belt-and-braces, which is correct for a guaranteed-409 button.
- **No raw account/workspace id as a primary label.** The weakest point in the set before this pass.
  Now: slice 02 never emits the id as a label and its assertion 10 pins `actorDisplayName !== actorUserId`;
  slice 01's assertion 2b pins the same at the write side; slice 04's C4 states the exact null-case
  rendering and test 2 asserts the primary label is a phrase, is not `font-mono`, and that the id is.
- **Native `select`/`option`/`datalist` banned.** Neither web slice adds a picker. Slice 04 §1.10 pre-commits
  a future filter to `Combobox` with `comboboxTriggerClass`.
- **`useInlineLayer` for inline layers inside a dialog.** Correctly identified as not applicable in both
  web slices, with the reasoning stated: both confirmations are page-level `AlertDialog` siblings
  containing no `Combobox` and no `InfoHint`. Slice 03 §2.8 additionally notes that *removing* three
  `Combobox` instances cannot strand a registration, since release is idempotent.
- **Every mutation through `useAppMutation` declaring its invalidated keys.** Slice 03's
  `useSetSalesOpsCadastroStatus` declares `[queryKeys.salesOps.all]`. After collision 9 it is the only
  mutation in the feature.
- **Tenant queries filtered by `orgId`.** Slice 01 keeps `withTenant` throughout. Slice 02 carries five
  independent mechanisms plus an oracle assertion 3 that proves the assertion *can* fail (the tenant
  connection really can see org B's rows), which is the difference between a real isolation test and a
  green one.

### Slice 03's three "is this scope creep?" items - judged and recorded

Recorded in the new slice 03 §0. All three **stay in scope**:

1. **Removing the `Status` `Combobox` from `AreaDialogBody` / `FuncaoDialogBody` / `PersonDialogBody`.**
   The debatable one. It stays because leaving it is the produto bug generalised: an edit dialog opened
   on an archived row silently reactivates it on `Salvar`. That directly contradicts the feature's
   central promise. It is three deletions plus three test updates in files already open, and slice 03
   adds source assertions so the pickers cannot return as a third door.
2. **Fixing `ProductDialogBody`'s hardcoded `status: 'active'`.** Required - without it a produto cannot
   be archived at all and slice 03 has no produto story.
3. **Filtering archived produtos out of the wizard picker.** Required - the confirmation copy this
   slice ships literally promises `sai das listas de seleção de novas propostas`. Shipping false
   confirmation copy is worse than shipping no confirmation.

### The `areas-rls` / `funcoes-rls` ledger-cleanup hazard

Slice 01 handles it and the fix is in the right slice: it adds
`DELETE FROM audit_log WHERE actor_org_id = ...` to both files' `afterAll`, and correctly identifies
that `product-funcao-costs-rls`, `product-commission-contract` and `funcoes-concurrency` touch no
`status` and need none.

One thing it left implicit, now made explicit: deleting ledger rows is only safe because
`apps/api/vitest.config.ts` sets `fileParallelism: false`, so a file's `afterAll` runs before the next
file starts and its rows are still the **tail**. A tail delete leaves the chain contiguous; a mid-chain
delete would break `verifyChain` everywhere. Added as a required comment on each `afterAll` that
touches `audit_log`, with the `fileParallelism` dependency named.

### `GET /api/v1/admin/audit` BigInt 500

Correctly left alone. It is a cross-tenant `getAdminDb()` reader, and touching it would mean this
feature modified exactly the boundary the Frame's "security trap" section draws. Slice 02 records it as
a risk and the new endpoint is immune (`String(row.id)`, pinned by oracle assertion 8). One
strengthening applied: slice 02 said it "should be logged as a doubt in `nexo/ROADMAP.md`"; that is now
a **required capture-step action**, not a suggestion.

---

## Residual risks carried forward

1. **The six wire literals are unenforced across the API/web boundary.** `cadastro.archived`,
   `cadastro.restored`, `produto`, `pessoa`, `funcao`, `area` are free text on the wire by slice 02's
   deliberate design. A rename on either side degrades **silently** - the history still lists the row
   but renders it read-only, with no error. Slice 01's oracle assertion 5 and slice 04's test 8 are the
   only guard. Recorded in the risk sections of 01, 02 and 04.
2. **A fifth cadastro action would be invisible.** Slice 04 sends the action set, so an action added to
   `CADASTRO_LIFECYCLE_ACTIONS` must be added to `CADASTRO_HISTORY_ACTIONS` on the same commit. This is
   the price of collision 4(b) and it is recorded on both sides.
3. **`actorLabel` is a snapshot, so a Hub rename does not propagate to old rows.** Correct ledger
   behaviour, but it will look like staleness to an operator who renames themselves.
4. **Cliente remains unarchivable** until the OVERVIEW's deferred note is picked up.
5. **`db` where `tx` was meant** remains slice 01's highest-value review point - both are typed `Db`, so
   it compiles and only oracle assertion 8 catches it. Unchanged by this pass; flagged because it is the
   single most likely way this feature ships broken while green.
