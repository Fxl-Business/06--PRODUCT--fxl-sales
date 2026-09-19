# Verify - slice 08-web-conversion

Branch `feat/20260918-08-web-conversion`, commit `559a4e7`, one ahead of `master`.
Worktree: `.worktrees/20260918T000000Z-kanban-pipeline-leads/08-web-conversion`.

**VERDICT: FAIL.**

Every gate is green, every named oracle is non-vacuous, and the ghost-card oracle carries a real
and provably live positive control.
The slice fails on ONE thing only: the diff adds a statement to `CLAUDE.md` that is FALSE at the
moment it was written, and it is the exact defect class this feature already corrected once
(commit `cd3ac60`, "docs(leads): state the real SalesOpsApp.tsx line count (slice 07)").

The engineering is otherwise the strongest of this feature. The fix is a documentation edit of two
numbers and two stale source comments. Nothing about the behaviour, the tests or the control flow
needs to change.

---

## 1. The blocking defect

`CLAUDE.md:544`, added by this diff:

> which this feature left at **9227 lines** (8946 before it)

The shipped file is **9233** lines.

```
$ wc -l < apps/web/src/sales-ops/SalesOpsApp.tsx
    9233
$ git show HEAD:apps/web/src/sales-ops/SalesOpsApp.tsx | wc -l
    9233
```

Off by 6. `master` carried `9010` and `master`'s own file is exactly 9010 lines, so the previous
revision was true and this one is not. The `8946 before it` half is consistent and is fine.

The sentence does carry a self-exemption - "The number is here to justify the fence, not to be
maintained: if it is stale, the fence still stands". That excuses a number going stale under a
LATER commit. It does not excuse a commit that deliberately rewrites the number and writes the
wrong one, which is what happened here and what `cd3ac60` already had to repair once.

### Secondary, same cause, in the diff's own touched file

The hoist of `hasFuncao` / `FUNCAO_SLUG_VENDEDOR` / `FUNCAO_SLUG_FINDER` out of `SalesOpsApp.tsx`
correctly rewrote the `CLAUDE.md` bullet, but left two in-code comments that now contradict the
shipped code:

- `apps/web/src/sales-ops/SalesOpsApp.tsx:1282`
  `* in leads/, because hasFuncao and FUNCAO_SLUG_VENDEDOR are module-local`
  Both are imported from `./calculations` at line 150-153 of that same file. The comment is now
  simply false, and it is the justification comment for `leadSellerOptions`.
- `apps/web/src/sales-ops/SalesOpsApp.tsx:997`
  `* ALREADY hold the system função. Module-local for the same reason as FUNCAO_SLUG_VENDEDOR`
  A dangling back-reference: `FUNCAO_SLUG_VENDEDOR` is no longer module-local, so the reason it
  points at no longer exists. `professionalPersonOptions` itself IS still module-local, so only the
  cross-reference is wrong, not the claim about that function.

Neither is caught by lint, type-check or any test.

---

## 2. Gates - all green, real output

| gate | result |
|---|---|
| `pnpm run build:packages` | exit 0 |
| `pnpm --filter @fxl-sales/web test` | **72 files, 911 tests, 911 passed**, exit 0 |
| `pnpm run lint` | exit 0 |
| `pnpm run type-check` | exit 0 (4 projects, all Done) |
| `pnpm run build` | exit 0 (api + web, `built in 2.08s`) |
| `pnpm test` (root) | exit 0, incl. `# pass 21 / # fail 0`, `build-contract: ok` |
| `pnpm --filter @fxl-sales/api test:integration` | **30 files, 217 tests, 217 passed**, exit 0 |

Named slice oracles, both present and green inside the full run:

```
 ✓ src/sales-ops/leads/__tests__/lead-conversion.test.tsx (8 tests) 700ms
 ✓ src/sales-ops/leads/__tests__/lead-conversion-prefill.test.ts (9 tests) 3ms
```

All eight C-cases and all seven P-cases the plan names exist, plus two extra prefill cases.

---

## 3. Mutation battery - every oracle proved non-vacuous

Each mutation applied, run, then `git checkout --` restored. Final `git status --porcelain` empty.

| # | mutation | result |
|---|---|---|
| **M1** | `emitMove` calls `onMoveLead(payload)` BEFORE awaiting `onRequestConversion` (optimistic-first conversion) | **RED - 6 of 8 tests fail**, incl. the in-flight case and `converts once and retries only the move` (`expected length 1, got 2`) |
| **M2** | `toSaleItemForm` seeds a real `areaId` on a FREE row | **RED** on `refuses to convert a lead whose only produto is free text` at line 500 (`expected true to be false`) - the ghost-card guard |
| **M3** | `draftValid` forced to `false` (button can never enable) | **RED at line 519**, the POSITIVE CONTROL half of the ghost-card test. This is the decisive proof that the control is live and the test is not vacuous |
| **M4** | `wizardIsOpen()` re-keyed onto the ambiguous string `Nova proposta` | **RED** on the cancellation test (`expected true to be false`). Confirms the trap is REAL - `Nova proposta` is present with the wizard closed, because it is the shell header action - and that the shipped code correctly avoided it |
| **M5** | `findClientByName` branch removed (create-always) | **RED** on `reuses an existing cliente by name instead of creating a second one` |
| **M6** | `convertedSales` early return removed | **RED** on `converts once and retries only the move, never a second proposta` |
| **M7** | vendedor seeded from `lead.sellerPersonId` unconditionally | **RED** on `leaves the vendedor blank when the pessoa is inactive or does not carry the vendedor função` |

**No named oracle in this slice would pass with its feature removed.**

### The ghost-card oracle specifically (the thing I was asked to be decisive about)

`apps/web/src/sales-ops/leads/__tests__/lead-conversion.test.tsx:488-522`.

- It asserts `Salvar rascunho` is `disabled`, `writes` is `[]`, and the card is still in
  `STAGE_NOVO` and absent from `STAGE_CONVERSAO`.
- **It then picks an área in the item's `Combobox` and asserts the SAME button becomes enabled**,
  and that still nothing was written. M3 proves that half is load-bearing.
- The wizard-open predicate keys on the wizard's own `DialogDescription` text
  (`Cliente, itens, pagamento e custos`), NOT on `Nova proposta`, and the test file documents
  exactly why. M4 proves the alternative really would have been a false pass.

The trap named in my brief was hit and correctly escaped.

---

## 4. Acceptance 11 - the card moves only after 201

Structural, not merely tested. `LeadsBoard.tsx:144-170`:

```
const saleId = await onRequestConversion({ lead: row, ... });
if (saleId === null) return;          // cancelled: nothing persisted
onMoveLead({ ...payload, saleId });
```

`requestLeadConversion` in `SalesOpsApp.tsx` returns a promise and calls NO lead mutation itself;
`saveLeadConversion` resolves it only after `createSale.mutateAsync` has returned and
`createdSaleIdentity` has extracted an id. Every failure path `return`s WITHOUT settling, leaving
the wizard open and the card home.

- **Cancel path:** `onClose` calls `settle.resolve(null)` before `setSaleWizard(null)`. Oracle C1
  asserts `writes` is `[]` both at wizard-open and after closing, and that both columns are
  unchanged. No optimistic cache write, no request.
- **Unmount safety:** a dedicated `useEffect` cleanup resolves a still-open `'convert'` request
  with `null`, so the board can never await forever. Correctly read through a ref with `[]` deps.
- **In-flight:** C3 holds `POST /sales` on a manual promise and asserts no `/move` exists and the
  card has not moved; after resolving it asserts exactly ONE move whose body carries
  `{stageId, saleId}` in the WIRE spelling.

## 5. Acceptance 12 - cliente resolved at conversion and never before

`saveLeadConversion` STEP 1 is the only `POST /clients` on the path, and it runs inside the save.
C5 asserts `writes` is `[]` at wizard-open, then `writes[0]` is `/clients`, `writes[1]` is `/sales`
in that order, and the sale body's `clientId` is the id the create returned.
`LeadDialog.tsx:189` confirms the lead dialog's company `Combobox` still has NO `onCreate`, so
creating or editing a lead still creates no cliente.

## 6. Acceptance 13 and 14 - the hard fence

- **`git diff --stat master...HEAD -- apps/api packages` is EMPTY.** `SALE_TRANSITIONS` and
  `EXPECTED_MATRIX` are byte-unchanged by construction.
- No `stageIsReadOnly` exists anywhere in `apps/web/src` or `apps/api/src` (only prose saying it
  must not). No `'converted'` stage kind: `LeadStageKind` is the three-member union, and
  `board-write-surface.test.ts` plants `const kind = 'converted';` as a negative fixture.
- Read-only is per-card: `leadIsConverted(lead)` is `lead.saleId !== null`;
  `moveTargetsFor` returns `[]` for such a lead; `LeadsBoard.tsx:189` refuses it as a drag source
  and `:253` filters it out of the sortable set. C8 asserts a converted card renders no
  `[data-move-trigger]`, carries `[data-read-only-card]`, sits in `[data-conversion-column]` and
  mirrors `sale.status` as `Ganha`, and that no recorded url contains `/transition` or
  `cancel-contract`.
- `conversion.ts` was correctly ADDED to `board-write-surface.test.ts`'s `OWNED_FILES`, so slice
  06's source scanner now covers the new module. That is the right call, not scope creep.

## 7. Prefill correctness

- Money crosses `conversion.ts` as integer CENTS only (`unitCents`), widened at the single call
  site through `centsToInput`, which is `/100` then `toFixed(2)` - no drift.
- An unresolvable `productId` degrades to `{kind:'free', customLabel: productNameSnapshot}` with
  `areaId: ''`, so the operator's words survive and the wizard demands an área. P3 pins it.
- Vendedor is seeded only for a pessoa that is in the snapshot, `status === 'active'` AND
  `hasFuncao(seller, FUNCAO_SLUG_VENDEDOR)`. Never the deprecated `is_seller` mirror; the web
  `SalesOpsPerson` does not even declare it. No `firstSeller` fallback on the conversion path -
  the initializer is shaped `prefill?.x ?? (leadPrefill ? leadPrefill.sellerPersonId : firstSeller?.id ?? '')`
  specifically to remove it. M7 proves it.
- The estimated value is written onto item 0 only when every item's `unitCents` is 0, and never
  split. Four cases pinned in P4 including the zero-estimate case.

## 8. Acceptance 18 - no new screen body

`SalesOpsApp.tsx` 9010 -> **9233 lines, delta +223** (the diff reports 291 changed lines including
the removed hoisted block and comments). Reading the diff, every added line is one of: imports, the
`'convert'` union arm and its two helper types, `createdSaleIdentity`, `convertedSales` state, the
`saleWizardRef` mirror and unmount cleanup, `requestLeadConversion`, `saveLeadConversion`, one prop
on `LeadsBoardContainer`, the `leadPrefill` prop plumbing, `toSaleItemForm`, and five `useState`
initializers. **No JSX screen body.** The fence holds.

The five initializers are `clientId`, `clientName`, `sellerPersonId`, `notes`, `items` - exactly
five, and every one reads `leadPrefill` strictly AFTER the existing `prefill?.x ??`, so the edit
path is provably unaffected and the ordinary create path is unchanged.
`canSave`, `canSaveBasics`, `draftValid`, `createPayload` and `submit` are untouched in the diff.

## 9. UI law

- No native `<select>` / `<option>` / `<datalist>` added; this slice adds no picker at all.
- The only `type="number"` under `leads/` is `LeadDialog.tsx:302` on the `<Input>` component, which
  is the sanctioned form, and it is pre-existing (slice 05), not this diff.
- No new absolutely-positioned layer inside a `Dialog`, so no new `useInlineLayer` obligation. The
  existing one has its own oracle in `move-dialog-inline-layer.test.tsx`.
- Wizard primary buttons: **checked in source, not by a DOM click**. `SalesOpsApp.tsx:9214` and
  `:9224` both carry a LITERAL `type="button"`; `primaryLabel` varies with the step but the
  attribute does not. Nothing derives `type` from `wizardStep` (the only mention is the tombstone
  comment at `:5282` recording the old produto-dialog bug).

## 10. Files outside `files_modified` - both justified

- `apps/web/src/sales-ops/calculations.ts` (+20): the `hasFuncao` / slug hoist. **In scope and
  necessary.** `conversion.ts` genuinely needs the vendedor-função test, and
  `react-refresh/only-export-components` genuinely forbids exporting it from `SalesOpsApp.tsx`, so
  the alternative was the per-call-site slug comparison `CLAUDE.md` bans. The function BODY is
  byte-identical to master's; only the parameter type widened from `SalesOpsPerson` to
  `Pick<SalesOpsPerson,'funcoes'>`, which is a strict widening and breaks no caller.
- `.../leads/__tests__/board-write-surface.test.ts` (+4): adding `conversion.ts` to `OWNED_FILES`.
  **Required**, otherwise the new module sits outside slice 06's scanner.

The plan's `files_modified` also lists `LeadsBoard.tsx`, `LeadsBoardContainer.tsx` and
`leads/api.ts`, which this diff does NOT touch - correctly, because DEFECT 1 and DEFECT 2 were
already repaired upstream: `MoveLeadPayload.saleId` exists, `leadsApi.moveLead` spreads it
conditionally, and `emitMove` already spells `onMoveLead({ ...payload, saleId })`. The plan told
the executor to skip an already-applied repair, and it did.

The plan's staleness (`board-model.ts`, `LeadMoveCommand`) is confirmed: neither exists anywhere,
which matches the reconciled contract in `00-OVERVIEW.md` §5.

## 11. CLAUDE.md fact-check, statement by statement

All TRUE except the line count:

| statement | verdict |
|---|---|
| the three symbols moved to `calculations.ts` | TRUE |
| vendedor option list built in `SalesOpsApp.tsx` and passed down | TRUE (`leadSellerOptions`) |
| `leads/conversion.ts` is the second consumer | TRUE |
| "The bodies are byte-identical" | TRUE (body identical; only the param type widened) |
| sequence is cliente, then `POST /sales`, then the move | TRUE |
| the move is the BOARD's and never the handler's | TRUE |
| a `'convert'` request always settles, including on unmount | TRUE |
| conversion is never a synthetic `editSale`; seam is one `leadPrefill` prop | TRUE |
| "read by exactly five `useState` initializers, each strictly AFTER `prefill?.x ??`" | TRUE, counted |
| `canSave` / `canSaveBasics` / `draftValid` / `createPayload` / `submit` byte-unchanged | TRUE |
| free lead produto seeds `areaId: ''` on purpose | TRUE |
| the oracle proves non-vacuity by picking an área | TRUE, and M3 proves it live |
| vendedor seeded only for active + `vendedor` função, no `firstSeller` | TRUE |
| estimate onto item 0 only when no produto supplies a price, never split | TRUE |
| `findClientByName` folds case, accents, whitespace; no unique index; best-effort | TRUE |
| `convertedSales` keyed by lead id closes the window within a session | TRUE |
| `salesOpsApi.createSale` stays `{ sale: unknown; ledger: unknown }` | TRUE, verified in `api.ts` |
| `createdSaleIdentity` fails closed | TRUE |
| **"this feature left at 9227 lines"** | **FALSE - it is 9233** |

`nexo/ROADMAP.md`'s two recorded costs are accurate and correctly scoped.

---

## 12. What must change to turn this PASS

1. `CLAUDE.md:544` - `9227` to `9233`.
2. `apps/web/src/sales-ops/SalesOpsApp.tsx:1282` - the `leadSellerOptions` comment still says
   `hasFuncao` and `FUNCAO_SLUG_VENDEDOR` are module-local. They are imported.
3. `apps/web/src/sales-ops/SalesOpsApp.tsx:997` - the `professionalPersonOptions` comment's
   "same reason as `FUNCAO_SLUG_VENDEDOR`" back-reference no longer resolves.

No code, test or control-flow change is required. Re-running the slice's two oracles plus
`pnpm run lint` is sufficient to re-verify a docs-only fix.

---

## 13. Hygiene

- Every mutation restored via `git checkout --`.
- `git status --porcelain` is **EMPTY** at the time of writing this verdict.
- No watcher started; every run was `vitest run` / a one-shot script. No process left running.
- Nothing committed, nothing amended, no `git add`.

---

# Attempt 2 - re-verification of the three documentation defects

Commit `f6ae17e` ("docs(leads): correct the line count and two comments the hoist made false")
landed on `feat/20260918-08-web-conversion`, on top of `559a4e7`.

**VERDICT: PASS.**

All three attempt-1 findings are fixed, no new false statement was introduced, and no executable
line changed. Everything else in the attempt-1 report stands unchanged and was not redone: the
seven mutations, the acceptance walkthroughs and the API/packages fence were not re-run, per the
coordinator's instruction.

## Scope of the fix commit

```
$ git show --stat f6ae17e
 CLAUDE.md                              |  2 +-
 apps/web/src/sales-ops/SalesOpsApp.tsx | 18 ++++++++++--------
 2 files changed, 11 insertions(+), 9 deletions(-)
```

Exactly the two expected files. I proved the `SalesOpsApp.tsx` half is comment-only rather than
trusting the diff's appearance: stripping every line that begins with `*`, `/*`, `*/` or `//` from
the `+`/`-` set leaves NOTHING.

```
$ git diff 559a4e7 f6ae17e -- apps/web/src/sales-ops/SalesOpsApp.tsx \
    | grep -E "^[+-]" | grep -vE "^(\+\+\+|---)" \
    | grep -vE "^[+-]\s*(\*|/\*|\*/|//)" | grep -vE "^[+-]\s*$"
NONE - every changed line is a comment line
```

## Finding 1 - the line count. FIXED.

`CLAUDE.md:544` now says 9235, and the file really is 9235 lines, on this branch as it now stands:

```
$ wc -l < apps/web/src/sales-ops/SalesOpsApp.tsx
    9235
$ git show HEAD:apps/web/src/sales-ops/SalesOpsApp.tsx | wc -l
    9235
```

The arithmetic is self-consistent and I checked it rather than accepting it: the file was 9233 at
attempt 1; the two comment rewrites are net `+10 / -8` inside `SalesOpsApp.tsx`, i.e. **+2**, which
lands exactly on 9235. The commit message states this reasoning explicitly, so the number was
cross-checked at authoring time rather than guessed. The `8946 before it` half is unchanged and was
already true.

## Finding 2 - the `leadSellerOptions` comment. FIXED, and the new text is true in all three claims.

New text (`SalesOpsApp.tsx:1278-1290`):

> `hasFuncao` and `FUNCAO_SLUG_VENDEDOR` now live in `calculations.ts` and are IMPORTED here; they
> were hoisted out of this file by slice 08 precisely so this builder and `leads/` could share one
> resolver rather than re-deriving it per call site, which is the slug comparison CLAUDE.md forbids.
> The builder itself stays HERE because `react-refresh/only-export-components` allows only component
> exports from this module, so it cannot be exported to `leads/`.

- **"now live in `calculations.ts` and are IMPORTED here"** - TRUE. Both appear in the import block
  at `SalesOpsApp.tsx:150-153` alongside `FUNCAO_SLUG_FINDER`, and they are declared and exported
  from `apps/web/src/sales-ops/calculations.ts:28-33`.
- **"so this builder and `leads/` could share one resolver rather than re-deriving it per call
  site"** - TRUE and it matches what the code does. `leadSellerOptions` calls
  `hasFuncao(person, FUNCAO_SLUG_VENDEDOR)` and `leads/conversion.ts:1` imports the same two
  symbols from `../calculations` and calls the same function. There is exactly one resolver and no
  slug comparison written inline anywhere.
- **"the builder itself stays HERE because `react-refresh/only-export-components` allows only
  component exports from this module"** - TRUE and still accurate. Every VALUE exported from
  `SalesOpsApp.tsx` is a React component (`SalesOpsApp`, `SalesView`, `ProductsView`, `AreasView`,
  `PessoasView`, `FuncoesView`, `ProductDialog`, `ClientDialog`, `AreaDialog`, `FuncaoDialog`,
  `PersonDialog`, `SaleWizardDialog`); the only two non-component exports are `export type`, which
  the rule permits because types are erased. `pnpm run lint` passing on this shape corroborates it.
  The claim is also self-consistent with the previous bullet rather than contradicting it: the
  SYMBOLS moved out because they could not be exported, and the BUILDER stays because it equally
  cannot be. (It is additionally a `useMemo` bound to the component's own state, so it could not
  move regardless, but the stated reason is not false.)

The superseded "are module-local to this file" wording is gone.

## Finding 3 - the `professionalPersonOptions` comment. FIXED and self-contained.

New text (`SalesOpsApp.tsx:994-999`):

> Module-local because `react-refresh/only-export-components` allows only component exports from
> this module, so this builder cannot be exported.

The dangling "for the same reason as `FUNCAO_SLUG_VENDEDOR`" back-reference is gone, the reason is
now stated directly, it needs no other comment to be understood, and it is true on the same
evidence as finding 2. `professionalPersonOptions` is genuinely still module-local: it appears in
no export line.

## Finding 4 - no new false statement.

I re-read both rewritten comments and the entire `Kanban de leads` section of `CLAUDE.md`
(lines 511-545) with fresh eyes. Every statement in it holds against the shipped code. Two I had
not previously spot-checked and verified now:

- "it retitles the dialog `Editar proposta`" - TRUE, `SalesOpsApp.tsx:7656` is
  `{editSale ? 'Editar proposta' : 'Nova proposta'}`.
- "`salesOpsRouter` has no DELETE verb" - unchanged and still true; `apps/api` is untouched by this
  branch.

One IMPRECISION, recorded but explicitly NOT a blocker and NOT introduced by `f6ae17e`: the prose
says "slice 03's `409 already_converted`". `already_converted` is the internal service reason
(`lead-service.ts:634`, `lead-routes.ts:69,72`) while the WIRE body is
`{error:'conflict', reason:'lead_already_converted'}` (`lead-routes.ts:73`). Both tokens really
exist in slice 03's own files and the sentence does not claim to quote the response body, so it is
loose rather than false. The wire spelling is documented accurately in
`apps/web/src/sales-ops/leads/optimistic.ts:50`. Worth tightening the next time that bullet is
touched; not worth a commit of its own.

## Gates re-run after the fix

| gate | result |
|---|---|
| `pnpm --filter @fxl-sales/web test` | exit 0, **72 files, 911 tests, 911 passed** |
| `pnpm run lint` | exit 0 |
| `pnpm run type-check` | exit 0 |
| `pnpm run build` | exit 0, `built in 1.84s` |

Both named slice oracles still green and unchanged in count:

```
 ✓ src/sales-ops/leads/__tests__/lead-conversion.test.tsx (8 tests) 684ms
 ✓ src/sales-ops/leads/__tests__/lead-conversion-prefill.test.ts (9 tests) 3ms
```

Identical totals to attempt 1 (911/911), which is the expected result for a comment-and-prose-only
commit and is itself a small check that nothing executable moved.

## Hygiene

- No mutations applied in this attempt, so nothing to restore.
- The code worktree's `git status --porcelain` is EMPTY.
- Nothing committed, nothing amended, no `git add`.
- No watcher started, no process left running.

## Final verdict

**PASS.** The slice meets acceptance 11, 12, 13, 14 and 18, its oracles are non-vacuous with a
proven-live ghost-card positive control, `apps/api` and `packages` are byte-unchanged, and every
statement the branch adds to `CLAUDE.md` is now true.
