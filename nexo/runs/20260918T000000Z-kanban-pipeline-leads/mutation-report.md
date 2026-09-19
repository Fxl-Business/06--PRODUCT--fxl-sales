# Feature-tier mutation pass - feature-20260918-kanban-pipeline-leads

Run by hand (this repository configures no mutation tool), in the throwaway worktree
`.worktrees/20260918T000000Z-kanban-pipeline-leads/mutation`, branch `feat/20260918-mutation`,
at integrated `master` (`dec3a8b`).
Nothing was committed and every mutation was restored before the next one; `git status --porcelain`
was confirmed empty at the end and both suites were re-run green.

The pass deliberately targets CROSS-SLICE and CROSS-BOUNDARY properties, because each slice's
verifier only ever saw one slice's diff.

## Baseline

| suite | command | files | tests |
|---|---|---|---|
| web | `pnpm --filter @fxl-sales/web test` | 72 | 911 |
| api unit | `pnpm --filter @fxl-sales/api test` | 50 | 526 |
| api integration | `pnpm --filter @fxl-sales/api test:integration` | 30 | 217 |

All three green before and after the pass.

## Mutations

22 mutations. 18 KILLED, 4 SURVIVED.

| # | mutation | file | suite | verdict |
|---|---|---|---|---|
| M1a | `emitMove` fetches `/api/v1/sales-ops/sales/:id/transition` | `apps/web/src/sales-ops/leads/LeadsBoard.tsx` | web | KILLED - `the board write surface > no board file can reach POST /sales/:id/transition` (+ `reports nothing at all over the real files`) |
| M1b | the CONVERSION handler transitions the new sale to `open` (`transitionSale.mutate`) | `apps/web/src/sales-ops/SalesOpsApp.tsx` | web | **SURVIVED** |
| M2 | server drops the converted-card move guard (`already_converted`) | `apps/api/.../leads/lead-service.ts` | api int | KILLED - `a move into the conversion stage requires a saleId that resolves in-org` (collateral kill, see survivors note) |
| M3 | API accepts a conversion move with NO `saleId` | `lead-service.ts` | api int | KILLED - `a move into the conversion stage requires a saleId that resolves in-org` |
| M4 | web settles the move BEFORE `POST /sales` is issued | `SalesOpsApp.tsx` | web | KILLED - `moves the card only after POST /sales resolves 201, and never while it is in flight`; `leaves the card in place and issues no lead move when POST /sales fails` |
| M5 | `createdSaleIdentity` fails OPEN (a 2xx body with no `sale.id` yields `saleId: ''`) | `SalesOpsApp.tsx` | web | **SURVIVED** |
| M6 | server seller predicate deleted from `listLeads` (`?sellerPersonId=` honoured for everyone) | `lead-service.ts` | api int | KILLED - `serves a seller only their own leads...`; `ignores a sellerPersonId query parameter for a non-admin caller`; `keeps an unassigned lead out of every seller's board and on the admin's` |
| M7 | `resolveLeadScopePredicate` fails OPEN for an unresolvable caller | `lead-service.ts` | api int | KILLED - `refuses a caller with no mapped pessoa with seller_person_unmapped and returns no rows`; `binds hub_account_id once from the verified token e-mail and never to a second pessoa` |
| M9 | lead estimated value summed into `getSalesOpsSummary` with a raw query OUTSIDE `withTenant` | `apps/api/src/domains/sales-ops/service.ts` | api int | **SURVIVED** (see note - RLS, not a test, absorbed it) |
| M9b | `leads` added to `getSalesOpsSnapshot` (= the `/bootstrap` payload) AND summed into the summary, inside `withTenant` | `service.ts` | api int | KILLED - `creating leads moves no number in getSalesOpsSummary, leaves the snapshot deep-equal and changes no persisted sale column` |
| M11 | `stage_changed_at` advanced on an ordinary `updateLead` | `lead-service.ts` | api int | KILLED - `stage_changed_at advances when and only when stage_id actually changes` |
| M12 | `stage_changed_at` advanced on a SAME-COLUMN reorder, via a second UPDATE that leaves the guarded `set` object byte-identical | `lead-service.ts` | api int + api unit | KILLED by the BEHAVIOURAL oracle alone - `stage_changed_at is byte-identical after a reorder inside the same stage`. The api-unit source-regex guard stayed GREEN, which is exactly the proof that the behavioural oracle is independently decisive. |
| M13 | API accepts a move into `lost` with no reason | `lead-service.ts` | api int | KILLED - `a move into the lost stage without a reason throws lost_reason_required and writes nothing` |
| M14 | `validateMove` drops the client-side lost-reason gate | `apps/web/.../leads/board-move.ts` | web | KILLED - 4 tests, incl. `blocks the confirm button until a lost reason is typed, and sends it trimmed` and `keys the reason requirement on the stage kind and not on its name` |
| M15 | lead CREATION resolve-or-creates a `sales_ops_clients` row, via RAW SQL so the source-reading contract guard cannot see it | `lead-service.ts` | api int + api unit | KILLED behaviourally - `creating a lead writes no sales_ops_clients row` (+ the snapshot deep-equal). api unit stayed green, so the kill is real, not a grep. |
| M16 | read-only re-keyed onto the COLUMN (`moveTargetsFor` returns `[]` for a card sitting in the conversion stage) | `board-move.ts` | web | KILLED - `still offers every target for a NON-converted lead sitting in the conversion stage`; `keeps a NON-converted card in the conversion column fully movable` |
| M16b | converted cards regain a move affordance (`leadIsConverted` check deleted) | `board-move.ts` | web | KILLED - 4 tests, incl. `offers no move target at all for a converted lead` and `never reaches a sale transition endpoint, and renders a converted card read-only` |
| M17a | web client emits `{toStageId, toIndex}` on the move wire | `apps/web/.../leads/api.ts` | web | KILLED - `moveLead posts to the lead own move path and never to a transition path`; `moves the card only after POST /sales resolves 201...` |
| M17b | API renames the move body key `stageId` -> `destinationStageId`, schema AND service, web untouched | `lead-schemas.ts`, `lead-service.ts` | api int + api unit | KILLED - `lead wire contract > accepts the move body and nothing else` plus 3 route tests and 6 integration tests |
| M17c | the SAME M17b mutation, judged by the WEB suite | (as M17b) | web | **SURVIVED** |
| M18 | `useMoveLead`'s `onError` rollback deleted | `apps/web/.../leads/hooks.ts` | web | KILLED - `restores the previous stage and the previous index when a cross-column move fails` (+2) |
| M20 | `updateLead`'s `already_converted` guard deleted (a converted lead becomes PATCHable) | `lead-service.ts` | api int | KILLED, but only COLLATERALLY - `a move into the conversion stage requires a saleId that resolves in-org`. No test names the PATCH case. |
| M21 | a system stage may be renamed or archived (409 guard disabled) | `.../leads/stage-service.ts` | api int | KILLED - `updateLeadStage refuses to rename or archive a system stage` |
| M23 | a lead move writes an `audit_log` row, via RAW SQL so no scanned symbol appears | `lead-service.ts` | api int | KILLED - `moving a lead writes no audit_log row` |
| M24 | a DELETE verb reappears on the leads router | `.../leads/lead-routes.ts` | api unit | KILLED - `exposes no DELETE verb on any lead route` |
| M25 | the cliente is created when the conversion wizard OPENS rather than when it is saved | `SalesOpsApp.tsx` | web | KILLED - `creates the cliente only when the conversion is saved, and never when the wizard opens` |

## SURVIVORS, ranked

### 1. M1b - the conversion handler can call `POST /sales/:id/transition` and nothing notices

**What ships silently.** Acceptance 13 says "Nenhuma ação do quadro chama `POST /sales/:id/transition`"
and acceptance 14 keeps `SALE_TRANSITIONS` untouched. The enforcement is
`board-write-surface.test.ts`, a source scanner - but its `OWNED_FILES` list covers only
`apps/web/src/sales-ops/leads/*`. The real board-to-proposta path does NOT live there: it lives in
`saveLeadConversion` / `requestLeadConversion` inside `apps/web/src/sales-ops/SalesOpsApp.tsx`,
which is not scanned. Adding `transitionSale.mutate({ saleId: created.saleId, status: 'open' })`
right after the proposta is created left all 911 web tests green. That is a board action
materializing a sale status change - and, one `status: 'won'` away, materializing payables - with
a fully green suite. This is precisely the fence the brief called "asserted mostly by absence".

**Oracle that would kill it.** Add `SalesOpsApp.tsx` (or, better, a narrow allow-list of the lead
conversion symbols it may use) to `board-write-surface.test.ts`'s scanned set; OR extend
`lead-conversion.test.tsx`'s existing `never reaches a sale transition endpoint` case - which today
only watches the BOARD - to assert over the whole `fetch` log of the full conversion flow that no
request path matches `/transition` or `/cancel-contract`.

### 2. M17c - the web half is blind to any API wire rename

**What ships silently.** `MoveLeadSchema` is `.strict()`, so a renamed key is a hard runtime 400 on
every card move. The API side IS pinned (M17b killed on 4 api-unit and 6 api-integration tests) and
the web side IS pinned (M17a killed on 2 web tests) - but by two INDEPENDENT hard-coded literals
with nothing in between. An API-side rename plus the natural "update the API tests" step leaves the
entire web suite green while every drag and every `Mover para` in production answers
`400 validation_error`. This is the structural gap already filed in `nexo/ROADMAP.md`; this pass
measures it as REAL and TOTAL rather than theoretical.

**Oracle that would kill it.** A single shared wire-shape fixture the two suites both import (a
`packages/shared-types` move-body type, or a checked-in JSON sample that the API parses with
`MoveLeadSchema` in one test and that the web asserts `leadsApi.moveLead` produces byte-for-byte in
another).

### 3. M5 - `createdSaleIdentity` is documented to fail CLOSED and has no oracle

**What ships silently.** The comment says "It fails CLOSED - no id means no move, which leaves a
real proposta and an unmoved card, the recoverable direction." Making it fail OPEN (returning
`{saleId: ''}` for a body with no usable id) left 911 web tests green. The card would then be moved
with no sale id; `leadsApi.moveLead` drops a falsy `saleId`, so the API answers
`400 sale_required_for_conversion`, the optimistic move reverts, and the operator sees a move that
failed for no visible reason while a real proposta now exists. The blast radius is bounded by the
API guard, which is why this ranks below the two above - but the documented invariant itself is
unverified.

**Oracle that would kill it.** One `lead-conversion.test.tsx` case: `POST /sales` answers 201 with
`{sale: {code: 'V-0001'}}` (no `id`); assert no `POST .../move` is issued and the card stays put.

### 4. M9 - the financial-isolation test is protected by RLS, not only by its own assertions

**What ships silently.** Nothing directly, and this survivor is reported for honesty rather than as
a defect. Summing `sales_ops_leads.estimated_value_brl` into `getSalesOpsSummary` with a raw query
placed OUTSIDE `withTenant` survived - because the app connection is the non-superuser
`fxl_sales_test` role, `sales_ops_leads` carries RLS keyed on the transaction-local org setting, and
the query therefore read zero rows in both the before and the after snapshot. The identical leak
placed INSIDE `withTenant` (M9b) was killed immediately by the whole-object `toEqual`. So acceptance
17 is genuinely well defended for every leak that could actually return data; the survivor only
records that one wrong shape of the same mistake is absorbed by the database rather than by the
suite, and would be invisible to the test if RLS were ever relaxed on that table.

**Oracle that would kill it.** None worth adding. Worth recording instead that
`leads-no-financial-impact.test.ts` is load-bearing on the RLS posture of `sales_ops_leads`.

## Two weak kills worth recording

Both M2 (converted card may be moved) and M20 (converted lead may be PATCHed) died, but on
`a move into the conversion stage requires a saleId that resolves in-org` - a test about something
else, which happens to move an already-converted card as a fixture step. No named test asserts
"a converted lead refuses a PATCH", and the `already_converted` MOVE case is named only at route
level (`answers a move on an already-converted lead with 409 lead_already_converted`, api unit) and
not at service level. A future refactor that changed that fixture would silently un-defend the
read-only-card rule, which is the headline of acceptance 13.

## Honest overall read

**Strong.** The server half of this feature is very well tested. Seller scoping (acceptance 15) is
the strongest area in the whole feature: three separate named tests, each keying on a different
aspect (own leads only, the query parameter ignored, unassigned leads), plus two more for the
fail-closed identity gate. `stage_changed_at` (acceptances 7 and 8) is defended twice over - once
structurally by a source regex and once behaviourally - and the behavioural oracle was proven
DECISIVE ON ITS OWN by M12, which hid the mutation from the regex and still died. Financial
isolation (16/17) uses whole-object `toEqual` rather than a field list, which is what killed M9b
instantly. The lost-reason rule (6) is genuinely enforced on BOTH sides and both sides are pinned.
The reconciled-contract defects that plan-check caught - a `'converted'` kind, read-only keyed on
the column - are now both caught by tests (M16, M16b, and the scanner's `'converted'` rule).
The conversion ordering (11, 12) is pinned with unusual precision: M4 and M25 each died on a test
whose name states exactly the property.

**Thin.** Three seams:

1. **The scanner's scope.** `board-write-surface.test.ts` is an excellent guard aimed at the wrong
   set of files for the property it claims. Acceptance 13's transition fence holds for
   `leads/*` and is wide open in `SalesOpsApp.tsx`, which is where the conversion actually happens.
   This is the single most valuable finding of the pass.
2. **The API/web wire.** Two independent literal pins with no shared contract between them. Either
   half can be renamed with its own suite green and the other half's suite equally green.
3. **The converted-card read-only rule at service level.** Defended only collaterally, by a fixture
   step inside a test about `saleId`.

A structural note on style, in the feature's favour: several of its guards are source-reading tests
with mandatory positive controls (`the scanner detects a planted violation`). That pattern worked -
M1a died on it. The failure mode it has is not vacuity but SCOPE, which is what M1b found, and
scope is the thing a positive control cannot check.
