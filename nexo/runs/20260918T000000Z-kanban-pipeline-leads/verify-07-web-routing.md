# Verify - 07-web-routing

Worktree: `.worktrees/20260918T000000Z-kanban-pipeline-leads/07-web-routing`
Branch `feat/20260918-07-web-routing`, one commit `0796839` ahead of `master`.

**VERDICT: FAIL.**

Everything runs green, the routing and mount oracles are real and non-vacuous, the payload
agreement with slices 04/05/06 is exact, and every `must_not_break` fence holds.
The single defect is in `CLAUDE.md`: the new `## Kanban de leads` section states as law a concept
that the feature's own BINDING contract deleted and that the shipped code refuses in capitals in
three places. This repo treats `CLAUDE.md` as load-bearing law, so a false assertion committed
into it is a FAIL on its own.

---

## 1. The defect

`CLAUDE.md`, new `## Kanban de leads` section, the bullet that reads:

> After conversion the card sits in a final READ-ONLY column that mirrors `sale.status`
> (`draft|open|won|lost|cancelled`) and is not draggable.

That is false on the shipped code, in the exact way the feature spent a plan-check closing.

`00-OVERVIEW.md`, "Contrato reconciliado", item 3, which the task names BINDING:

> **O conceito de etapa somente-leitura foi DELETADO. Somente-leitura é propriedade do CARD.**
> `stageIsReadOnly` não existe. Um card é somente-leitura sse o lead foi convertido
> (`leadIsConverted(lead) === lead.saleId !== null`) [...] como DESTINO é um alvo legítimo.

The code says the same thing, three times, unprompted:

- `apps/web/src/sales-ops/leads/LeadsBoard.tsx:36-38`
  `READ-ONLY IS A PROPERTY OF THE CARD. No column is read-only, the conversion column least of
  all: it is the DESTINATION a card is dropped onto to start a proposta.`
- `apps/web/src/sales-ops/leads/board-ui.ts:44-47`
  `Read-only is a property of the CARD (leadIsConverted) and never of a column, which is why this
  constant is named for a card. No column is read-only: the conversion column in particular is a
  drop target.`
- `apps/web/src/sales-ops/leads/types.ts:20-23`
  `There is no 'converted' kind, because read-only is a property of the CARD and not of the
  column [...] The single kind: 'conversion' stage is BOTH the door that opens the proposta wizard
  and the column those cards land in.`

Three separate falsehoods are packed into the one sentence:

1. **"READ-ONLY column"** - no column is read-only. `readOnlyCardClass` is named for a card
   precisely so this cannot be misread, and the conversion column is an active drop target.
2. **"a final column"** - there is no final column. The `kind: 'conversion'` stage is both the
   door and the landing column; a fourth stage kind (`'converted'`) is explicitly forbidden by
   `LeadStageKind` and by reconciliation item 1.
3. **"a column that mirrors `sale.status`"** - the CARD mirrors it (`LeadCard.tsx:117-120`,
   `lead.saleStatus`). Nothing about a column reads `sale.status`.

Why it matters rather than being pedantry: the sentence is a standing instruction to a future
implementer to build a status-driven read-only column, which is exactly the design the plan-check
deleted and which the code has three comments defending. The text appears to have been copied from
acceptance 13's raw wording (`00-OVERVIEW.md:28`) without applying reconciliation item 3, which
supersedes it.

The rest of that same bullet IS true and should survive the rewrite: no board action calls
`POST /sales/:id/transition` (verified - the only `transition` matches under `leads/` are CSS),
and `SALE_TRANSITIONS` / `EXPECTED_MATRIX` are byte-inaltered.

**Fix**: one sentence. E.g. "After conversion the CARD becomes read-only - `leadIsConverted(lead)`
is `lead.saleId !== null` - shows a chip mirroring `sale.status` (`draft|open|won|lost|cancelled`)
and is no longer draggable; read-only is a property of the card and never of a column, and the
`conversion` column stays a legitimate drop target. There is no `'converted'` stage kind."

### Minor, recorded not blocking

`CLAUDE.md` says SalesOpsApp.tsx "is already 8946 lines". 8946 is the count on `master`; after this
commit the file is 9010. The sentence is defensible as "was already", and its load-bearing half
(the file's whole share of this feature) is exactly right, so this is noted, not counted.

---

## 2. Everything that PASSED

### 2.1 Named oracles, real output

`npx vitest run navigation.test.ts leads-routing.test.tsx routing.test.tsx --reporter=verbose`
-> `Test Files 3 passed (3) / Tests 34 passed (34)`, including
`keeps every pre-existing canonical route at its exact segment`,
`routes the three lead screens and scopes each to its workspace`,
`does not alias either new view and keeps the alias scoped to cadastros`,
and all four `lead screens inside the Sales Ops shell` cases.

Full gates:

- `pnpm --filter @fxl-sales/web test` -> `Test Files 70 passed (70) / Tests 894 passed (894)`
- `pnpm run lint` -> api Done, web Done, no warnings
- `pnpm run type-check` -> all four projects Done
- `pnpm run build` -> `✓ built in 4.54s`

### 2.2 Mutation battery (8 mutations, each restored, tree clean after each)

| # | Mutation | Named test that went RED |
|---|---|---|
| 1 | Prepend `leads` to `meusDadosSeller` instead of appending | `keeps every pre-existing canonical route at its exact segment` (+6 more) |
| 2 | Rewrite the `cadastros` `areas` entry id to `etapas` (kills an existing route) | `keeps every pre-existing canonical route at its exact segment` (+3) |
| 3 | `getVisibleWorkspaces` also pushes `operacional` for seller/finder | `derives visible workspaces from the Hub role set` (+2) |
| 4 | Drop the `workspace !== 'cadastros'` scope from `aliasLegacyView` | `aliases only the cadastros-scoped legacy vendedores and finders views to pessoas` (+1) |
| 5 | Force `showSellerFilter` to a constant `true` on the mount | `mounts the same board at meus-dados/leads without the seller filter` |
| 6 | Replace both mount conditions with `false` (delete the mounts) | 3 of the 4 leads-routing cases |
| 7 | Drop `leads`/`etapas` from the `headerAction` guard | `offers no proposta header action on either lead screen` |
| 8 | Drop `status === 'active'` from the vendedor derivation | `mounts the leads board at operacional/leads with the seller filter offered` |

No oracle in this slice is vacuous. Two details worth naming:

- The canonical fence iterates a HAND-WRITTEN literal table of 13 routes plus 8
  `getDefaultSalesOpsRoute` assertions. It is not derived from `getSalesOpsNavigation`, so it does
  not move with the bug - this is `verifier_focus` (1) and it is satisfied.
- `leads-routing.test.tsx` carries its own non-vacuity control: the header-action test ends with
  `/operacional/vendas` asserting `Nova proposta` IS present, so the three `not.toContain`
  assertions cannot pass over a shell rendering no header. Mutation 6 confirms it: with both
  mounts deleted, that test stays green while the other three go red, which is the correct split.
- The `sellers` fixture set is adversarial by construction: an active vendedor, an active
  finder-only pessoa, and an archived vendedor. Mutation 8 proves both wrong derivations are
  caught.

### 2.3 Existing routes did not move

No canonical route changed name or segment. `navigation.ts` gains exactly: two lucide imports
(`LayoutGrid`, `ListChecks`), two `SalesOpsView` members, and three nav entries. Every function -
`getVisibleWorkspaces`, `getSalesOpsNavigation`, `buildSalesOpsPath`, `getDefaultSalesOpsRoute`,
`aliasLegacyView`, `legacyCadastroViews`, `resolveSalesOpsRoute`, `workspaceForView` - is
byte-unchanged (confirmed by reading the diff hunk by hunk).

- `aliasLegacyView` still returns early on `workspace !== 'cadastros'`; `legacyCadastroViews`
  gained no member (mutation 4 pins both).
- `meus-dados/vendedores` and `meus-dados/finders` keep their exact ids.
- `meusDadosFinder` is byte-unchanged - the diff shows only context lines around it, and the
  oracle asserts `['finders','vendas']` plus a `redirect: true` for a finder at
  `meus-dados/leads`. Acceptance 15's seller-only scoping holds.
- Placement: `leads` APPENDED in `operational` and in `meusDadosSeller`, `etapas` inserted before
  `geral` so `cadastros[0]` stays `produtos`. `getDefaultSalesOpsRoute` answers identically for
  every role set and both preferred workspaces (8 assertions).

### 2.4 New routes

`operacional/leads`, `meus-dados/leads`, `cadastros/etapas` all resolve with `redirect: false`
through `resolveSalesOpsRoute`, and `buildSalesOpsPath` produces the three canonical paths.
`workspaceForView('leads', ['admin','seller'])` is `operacional` (team precedence) and
`workspaceForView('leads', seller)` is `meus-dados`, so one view id serves two workspaces exactly
as `vendas` and `comissoes` already do. A seller at `/operacional/leads` redirects to
`/meus-dados/vendedores`; an admin-only operator at `/meus-dados/leads` redirects to
`/tatico/dashboard`. The URL remains the single source of truth: no new state source was added,
and the vendedor filter is deliberately component state (recorded in `nexo/ROADMAP.md` as a
future `?vendedor=` decision).

### 2.5 The seller filter is a convenience, never the control

`LeadsBoardContainer` computes `const sellerFilterValue = showSellerFilter ? sellerPersonId : null;`
and that value alone feeds the memoized `filters` object handed to BOTH `useLeadsBoard(stages,
filters)` and `useMoveLead(filters)`. A filter that is not offered therefore cannot narrow the
query key even if the state behind it were somehow set: the value is forced `null`. The shell
passes `showSellerFilter={workspace === 'operacional'}`, so an admin under `operacional` gets the
picker and a seller under `meus-dados` does not. Mutation 5 proves the split is pinned.
The real scoping stays server-side (`apps/api/test/rls/leads-seller-scope.test.ts` exists).

### 2.6 No new screen inside SalesOpsApp.tsx (acceptance 18)

Line-count delta: **8946 -> 9010, +64 lines**, of which roughly half are comment blocks.
The edit is wiring only, and nothing else:

1. two imports (`LeadsBoardContainer`, `LeadStagesContainer`);
2. two `titleForView` entries (`leads` with the `personal` ternary, `etapas`);
3. one `useMemo` (`leadSellerOptions`) over `persistedBootstrap.people`;
4. one `headerAction` guard widened to `view === 'geral' || view === 'leads' || view === 'etapas'`;
5. two conditional mount blocks.

No view component is declared in that file. `hasFuncao` and `FUNCAO_SLUG_VENDEDOR` remain
module-local (lines 715/718, not exported), as `react-refresh/only-export-components` requires.

### 2.7 Payload agreement with slices 04/05/06 (read from the real code)

- reorder: `ReorderLeadStagesPayload = { stageIds: string[] }`; the container sends
  `reorderLeadStages.mutateAsync({ stageIds: orderedIds })`. MATCH.
- set-status: `SetLeadStageStatusPayload = { id, status }` with no `name`; the container
  destructures `({ id, status })` and drops the view's `name`. MATCH.
- `LeadDialog` receives `clients`, `initial`, `key`, `onOpenChange`, `onSubmit`, `open`, `pending`,
  `products`, `sellers` - NO `stages` prop, and no `stageId` is constructed anywhere in
  `leadToSeed` or in the dialog. `CreateLeadSchema` being `.strict()` is therefore respected.
- `useLeadsBoard(stages, filters)` - the LEADING `stages` argument is present and is the memoized
  stage list, matching `hooks.ts:87`.
- Every stage callback uses `mutateAsync`, never `mutate`, so the 409 and revert behaviours keep
  their rejection.

### 2.8 must_not_break

- `SALE_TRANSITIONS` / `EXPECTED_MATRIX`: `git diff master...HEAD --stat -- apps/api packages` is
  EMPTY. The whole slice touches no API and no shared package, so both are byte-unchanged.
- No DELETE verb: `salesOpsRouter` has no `.delete(` route; untouched by this slice anyway.
- Leads absent from `/bootstrap`: no lead reference in `service.ts`'s snapshot path; untouched.
- No native `<select>`/`<option>`/`<datalist>` and no raw `<input type="number">` in the added
  lines (grep over the `+` side of the web diff: zero hits). Lint would have failed otherwise.
- No raw account, workspace or person id rendered: `leadSellerOptions` puts the id in a Combobox
  `value` and `displayName` in the label; no id reaches user-facing copy.
- The three shell tests that `vi.mock('../hooks')` are untouched and green; the new mount oracle is
  a separate file precisely because the lead hooks live in a different module.

### 2.9 Other CLAUDE.md assertions, fact-checked against shipped code

Checked and TRUE: lead is first-class in `sales_ops_leads` with no `sales_ops_sales` insert; the
column list (`contact_name`, nullable `client_id` + NOT NULL `client_name_snapshot`,
`estimated_value_brl` cents, `description`, `seller_person_id`, `stage_id`); `LeadDialog`'s company
picker has no `onCreate` (comment at line 189 confirms the reason); `sales_ops_lead_products` is a
child TABLE with nullable `product_id` + `product_name_snapshot`; `sales_ops_lead_stages` carries
`is_system`, `position` and an archivable `status` with `409 stage_is_system` and
`409 stage_name_taken`; the `lost` system stage is seeded literally as `Perdido` in migration
`0022` and `lost_reason_required` is a real service error mapped to `400 validation_error`;
`stage_changed_at` is documented in the schema as moving only on a stage change; `position` exists;
`MoveLeadDialog`/drag both terminate in the single `emitMove` and there is NO `KeyboardSensor`
(only the comment saying so); optimistic revert goes through `leads/optimistic.ts`;
`onRequestConversion` is an optional prop forwarded verbatim and gates the conversion target via
`hasConversionHandler`; no `audit_log` write on a move; no lead in `/bootstrap`; seller scoping
proven in `apps/api/test/rls/leads-seller-scope.test.ts` and
`leads-no-financial-impact.test.ts`; the routing paragraph and the append/insert rationale.

Also verified absent EVERYWHERE in the repo: `LeadMoveCommand` (zero hits) and any `board-model.ts`
(zero hits). The section names `MoveLeadPayload`, which is the real exported type.

---

## 3. Hygiene

Every mutation was reverted with `git checkout --`. Final `git status --porcelain` in the review
worktree is EMPTY. No watcher was started and no process was left running. Nothing was committed,
amended or staged.

## 4. What unblocks this

One sentence in `CLAUDE.md`. Rewrite the post-conversion bullet so read-only is a property of the
CARD, keep the `POST /sales/:id/transition` and `SALE_TRANSITIONS` halves verbatim, and re-verify.
Nothing in the code needs to change.

---

# Attempt 2 - re-check of the single finding

Commit `10db715` ("docs(leads): correct the read-only law in the CLAUDE.md leads section")
landed on top of `0796839`. The attempt-1 findings above stand as written; only the one defect
was re-checked, plus the four gates. The eight mutations were NOT re-run, as instructed.

**VERDICT: PASS.**

## 1. Scope of the new commit

`git show --stat 10db715` -> `CLAUDE.md | 5 ++++-`, one file, 4 insertions and 1 deletion.
No code, test, fixture or config file moved. The branch diff is still 8 files, now
655 insertions instead of 652.

## 2. The false claim is gone, with no residue

The sentence "After conversion the card sits in a final READ-ONLY column that mirrors
`sale.status` ... and is not draggable" no longer exists.

Residue grep over the whole of `CLAUDE.md` for `read-only column`, `final column`, `coluna final`,
`somente leitura` and `'converted'` returns exactly ONE line: 526, the new bullet, which QUOTES the
original request's wording only in order to record that it was superseded. That is a deliberate
prose record of a deleted concept, the same device this file already uses for `sales.core`, for
`HUB_SESSION_ENCRYPTION_KEY` and for `FXL_HUB_POST_LOGIN_REDIRECT`. Nowhere else in the file
asserts a read-only column.

## 3. The replacement, clause by clause, against the shipped code

| Clause | Verdict | Evidence |
|---|---|---|
| "READ-ONLY IS A PROPERTY OF THE CARD, NEVER OF A COLUMN" | TRUE | `LeadsBoard.tsx:36-38`, `board-ui.ts:44-47`, `types.ts:20-23`, and `00-OVERVIEW.md` reconciliation item 3 |
| "the ONE place the original request's wording was SUPERSEDED rather than implemented" | TRUE | Reconciliation items 1-8 are inter-slice plan disputes; item 3 is the only one that quotes and overrides an ACCEPTANCE (13) |
| "there is no final read-only column" | TRUE | No column-level read-only exists; `readOnlyCardClass` is named for a card and applied per card at `LeadCard.tsx:68` |
| "there is no `'converted'` stage kind" | TRUE | `LeadStageKind = 'normal' \| 'conversion' \| 'lost'`, backed by `sales_ops_lead_stages_kind_check` |
| "a lead can only ever enter the `conversion` stage together with a resolved `sale_id`" | TRUE | `lead-service.ts:737-751`: conversion without `saleId` throws `sale_required_for_conversion`; `saleId` on any other destination throws `sale_not_allowed`. The code's own comment: "sale_id and 'is in the conversion column' can never diverge" |
| "that one stage is BOTH the door and the landing column" | TRUE | `types.ts:22-23` says exactly this; the column renders with `data-conversion-column` and is inside the `DndContext` |
| "stays an ACTIVE drop target for a lead that has no proposta yet" | TRUE | `moveTargetsFor` filters the conversion stage only on `hasConversionHandler`, never on the card's column; the earlier bullet in the same section already states the absent-prop case, so the two agree |
| "`leadIsConverted(lead)` is `lead.saleId !== null`" | TRUE | `calculations.ts:110-112`, verbatim |
| "such a card is not draggable" | TRUE | `LeadsBoard.tsx:253` excludes converted rows from `movableIds`, and `handleDragEnd:189` refuses one as a drag source |
| "`moveTargetsFor` offers it nothing" | TRUE | `board-move.ts:54` `if (leadIsConverted(lead)) return [];` |
| "it is the CARD that mirrors `sale.status` (`draft\|open\|won\|lost\|cancelled`)" | TRUE | `LeadCard.tsx:117-120` renders `SALE_STATUS_LABEL[lead.saleStatus]`; `types.ts:96` declares `saleStatus: SalesOpsStatus \| null` |
| "No board action ever calls `POST /sales/:id/transition`" | TRUE | the only `transition` matches under `leads/` are CSS |
| "`SALE_TRANSITIONS` and its `EXPECTED_MATRIX` are byte-unchanged" | TRUE | the branch diff touches no file under `apps/api` or `packages` |

## 4. The named oracle is real and does what the text claims

`keeps a NON-converted card in the conversion column fully movable` exists at
`apps/web/src/sales-ops/leads/__tests__/leads-board-keyboard.test.tsx:335` and is green.

It renders `Bruno` (not converted) and `Dora` (`saleId` set, `saleStatus: 'won'`) into the SAME
column, `CONVERSAO_ID`, then asserts the converted card has no `[data-move-trigger]` while the
non-converted one does, and that opening Bruno's dialog still offers all four destinations
including the conversion stage itself. That is precisely the separation CLAUDE.md now claims for
it: a refusal re-keyed onto the COLUMN would strip Bruno's trigger too and turn the test red,
and a suite that put the two cards in different columns could not see the difference.

`npx vitest run leads-board-keyboard.test.tsx` -> `Tests 12 passed (12)`, including the two
neighbours `renders no move trigger and no drag handle on a converted card, and shows its sale
status` and `keeps the conversion column a drop target for a card that is not converted`.

## 5. No new false statement introduced

The whole `## Kanban de leads` section was re-read. The other fifteen bullets are unchanged from
attempt 1 and were fact-checked there (report section 2.9). The corrected bullet introduces no
claim that the code does not support, and the three added lines name only symbols that exist
(`leadIsConverted`, `moveTargetsFor`, `sale.status`, the conversion stage kind) and one oracle
that exists by that exact title.

The minor attempt-1 note stands unchanged and is still not counted: the section says
SalesOpsApp.tsx "is already 8946 lines", which is the `master` count, while the file is 9010 after
this slice.

## 6. Gates, re-run after the docs change

- `pnpm --filter @fxl-sales/web test` -> `Test Files 70 passed (70) / Tests 894 passed (894)`
- `pnpm run lint` -> api Done, web Done
- `pnpm run type-check` -> all four projects Done
- `pnpm run build` -> `✓ built in 1.75s`

`git status --porcelain` is EMPTY. Nothing was committed, amended or staged; no process was left
running.
