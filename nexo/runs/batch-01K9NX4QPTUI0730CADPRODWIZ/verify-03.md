# Verify - slice 03 `wizard-itens-row`

Branch `feat/03-wizard-itens-row`, work uncommitted, graded against the working tree at
`SalesOpsApp.tsx` sha256 `c8e3d1dd4a2e8d2417315b3541bea898a2a1b15531f5eb2f8f0d304bd71172b4`.

Verdict: **PASS**.

## Files touched

Three, all inside the step-1 `Itens` block and its tests. No API, no schema, no migration.

- `apps/web/src/sales-ops/SalesOpsApp.tsx` (+214 / -84)
- `apps/web/src/sales-ops/__tests__/sale-wizard-service-description.test.tsx` (+14 / -3, net +11)
- `apps/web/src/sales-ops/__tests__/sale-wizard-ui-contract.test.ts` -> `.test.tsx` (rename staged, +355 / -8)

## Commands

### `pnpm test` - green

```
packages/shared-utils test:  Test Files  2 passed (2)
packages/shared-utils test:       Tests  23 passed (23)
apps/api test:  Test Files  29 passed (29)
apps/api test:       Tests  300 passed (300)
apps/web test:  Test Files  39 passed (39)
apps/web test:       Tests  365 passed (365)
EXIT=0
```

Against the stated baseline of 363 web tests / 39 files and 300 api tests / 29 files:

- web **363 -> 365** across the same 39 files. No drop. The file count is unchanged because the
  ui-contract test was renamed `.ts` -> `.tsx` rather than added; it went 3 tests -> 5.
- api **300 / 29**, byte-identical to baseline.

`git diff | grep -E "^\+.*(\.skip|\.only|it\.todo|describe\.todo|todo\()"` -> **NONE**.
A full grep of both touched test files for `.only`, `.skip`, `todo(` -> **NONE**.

### `pnpm run lint` - clean

```
apps/api lint$ eslint src/    -> Done
apps/web lint$ eslint src/    -> Done
LINT_EXIT=0
```

### `pnpm run type-check` - clean

```
packages/shared-types type-check: Done
packages/shared-utils type-check: Done
apps/api type-check: Done
apps/web type-check: Done
TC_EXIT=0
```

## Acceptance criteria

**1. Headers over their controls.** Met, and the alignment claim is checkable rather than asserted.
The header and every row now share one `saleItemGridClass`, and the header carries
`border border-transparent px-3` so its column edges land on the item block's. Per column:

- `Produto / serviço` gets `pl-3`, over a `formSelectClass` trigger whose `comboboxTriggerClass`
  base is `px-3`. Aligned.
- `Qtd.` is `text-center` over a `text-center` `Input` inside a symmetric `px-3`. Aligned.
- `Valor unit.` gets `pr-3`, over a `text-right` `Input` with `px-3`. Aligned.
- `Subtotal` gets no padding, and the cell under it is a bare
  `<div className="sales-ops-num text-right ...">` with none either. Aligned.

Two real causes of the old misalignment were removed, not papered over: the numeric inputs carried
`h-10 rounded-[9px]` in front of `formInputClass`'s `h-11 rounded-[10px]` (in the `Qtd.` case
through a plain template string, so no `cn` tailwind-merge was resolving it), and the área badge
used to stack under the produto picker, making column 1 roughly 68px tall against 40px everywhere
else and defeating `items-center`. The height claim is now pinned by
`expect(labeledInput('Quantidade do item 1').className).toContain('h-11')` plus a
`.not.toContain('h-10')`.

**2. One item reads as one item.** Met. Each row is wrapped in `saleItemBlockClass`
(bordered, `p-3`, `gap-[7px]`) and the outer list gap is `gap-[10px]`, larger than the inner gap,
so the block boundary reads. The description sits on the same grid in column 1 only, under the
picker it describes, not full-bleed.

**3. Opt-in description.** Met, via `+ Adicionar descrição` gated on
`descriptionOptional && !descriptionVisible`.

## Traps

### TRAP A - a required field is never hidden. PASS

Read independently from `productRowRequirements` (line 5634) and the row predicates (line 6257):

```
needsDescription     = hasVariableValue && !isService
descriptionOptional  = hasVariableValue && !needsDescription
descriptionVisible   = hasVariableValue && (needsDescription || item.descriptionOpen || Boolean(item.customLabel.trim()))
```

Substituting, `descriptionOptional` reduces to exactly `hasVariableValue && isService`. So the
affordance is reachable on a Serviço row and on nothing else, and `descriptionVisible` is
unconditionally true whenever `needsDescription` is - the open-price non-Serviço case. The free
(`productId`-null) branch is a separate code path entirely (line 6195): its description renders
with no `descriptionVisible` guard at all and no affordance is emitted anywhere in that branch.

Cross-checked against the gate that actually blocks submit, `itemsValid` (line 5475), which uses
the same `productRowRequirements` seam: `descriptionOk = !needsDescription || customLabel.trim()`
for product rows, and an unconditional `customLabel.trim()` for free rows. The set of rows whose
description can block submit is therefore precisely the set whose description is force-rendered.
They cannot drift, because both read the one helper.

Mutation-proved rather than taken on faith. Rewriting the predicate to
`descriptionOptional = hasVariableValue` / dropping `needsDescription ||` fails 3 tests:
`keeps the description required for an open-price row that is not a serviço`,
`keeps the produto copy verbatim for an open-price row that is not a serviço`, and
`renders the description as an opt-in affordance only where it is optional`.

One deliberate asymmetry, and it is the right one: clearing the text after revealing does not
re-collapse the field, because `descriptionOpen` stays true. A field vanishing from under the
caret would have been the worse bug. Pinned by an explicit assertion.

### TRAP B - the edit path. PASS

`deriveWizardPrefill` sets `descriptionOpen: false` on every row, so the reveal flag does no work
here. What opens the row is the third disjunct, `Boolean(item.customLabel.trim())`, fed by the
unchanged prefill expression
`product?.openPrice && item.productNameSnapshot !== product.name ? item.productNameSnapshot : ''`.
A stored description differing from the catalog name therefore lands in `customLabel` and forces
the input open with no click. When the snapshot equals the product name there is no description to
show, and collapsing is correct.

Mutation-proved: deleting `|| Boolean(item.customLabel.trim())` fails
`opens the stored description on the edit path with no click` with
`input not found: Nome / descrição do item 1`. The guard is real, not decorative.

Observation, not a finding: if a `kind: 'service'` product ever had `openPrice: false`, the prefill
would drop a stored description. That expression is untouched by this slice and `CLAUDE.md` states
`openPrice` is a server-written projection of `kind` behind a DB CHECK, so the case cannot arise.
Pre-existing and inert; noted only so it is on the record.

### TRAP C - errors are not collapsed. PASS

The message block is a sibling of the `descriptionVisible ? ... : null` block, not a child, and it
now houses all four messages that used to be split across two places: the two description errors,
`showCustomUnitError`, and the área error that previously had its own separate grid row.
`showRowMessages = showItemErrors ? (showCustomLabelError || showCustomUnitError || showAreaError)
: hasVariableValue`, so a blank-description Serviço with a zero value - exactly the collapsing case
- still renders its value error.

Mutation-proved, and this one needed two attempts, which is worth recording. My first mutation
(`showRowMessages = descriptionVisible && showItemErrors ? ... : ...`) passed all 15 tests, but
that is an artifact of `&&` binding tighter than `?:`: the gate flipped to the `hasVariableValue`
branch, which is still `true`, and the inner `showItemErrors ? errors : hint` still rendered the
errors. Ineffective mutation, not a test gap. Gating the JSX properly
(`{showRowMessages && descriptionVisible ? (`) fails 2 tests, including
`still blocks a serviço item whose negotiated value is zero` and its
`textOccurrences(valueError) === 1` assertion. The guard is real.

### TRAP D - modified existing assertions. PASS, 3 modified, none weakened

All three live in `sale-wizard-service-description.test.tsx`.

**1. `advances step 1 with a serviço item whose description is blank`**

```
- expect(labeledInput('Nome / descrição do item 1').value).toBe('');
+ expect(container.querySelector('input[aria-label="Nome / descrição do item 1"]')).toBeNull();
+ expect(buttonByText(revealDescription)).toBeInstanceOf(HTMLButtonElement);
```

Judgement: **not weakened, strengthened.** One assertion became two. The old line pinned
"the input exists and is empty"; the new pair pins "the input does not exist AND the affordance
that replaced it does". `buttonByText` throws when it finds nothing, so the second line is a hard
existence check, not a soft one. Both halves of the new behavior are held.

**2. `still blocks a serviço item whose negotiated value is zero`**

```
- expect(labeledInput('Nome / descrição do item 1').getAttribute('aria-invalid')).not.toBe('true');
+ expect(container.querySelector('input[aria-label="Nome / descrição do item 1"]')).toBeNull();
```

Judgement: **not weakened.** This is the one edit that could have been a quiet relaxation, so I
looked at it hardest. `.not.toBe('true')` is a negative assertion that passes on a missing
attribute; `.toBeNull()` is a positive assertion about the DOM. Absence strictly implies
not-invalid, so nothing the old line claimed is given up. The load-bearing part of this test -
`expect(textOccurrences(valueError)).toBe(1)` on the line above - is untouched, and it is precisely
the TRAP C guard: it proves the value error renders while the description is collapsed. My
mutation run confirms this test is what fails when the messages are moved back inside the
collapsible region.

**3. `labels the serviço description as optional and names the catalog fallback`**

```
+ expect(container.textContent).toContain('Serviço com valor variável - sem descrição, o item aparece como "Consultoria FXL"');
+ await click(buttonByText(revealDescription));
  expect(labeledInput('Nome / descrição do item 1')).toBeInstanceOf(HTMLInputElement);
```

Judgement: **not weakened, strengthened.** Nothing was removed. A new assertion was added ahead of
the interaction, pinning that the hint still renders while the field is collapsed. The click is a
required interaction step, not an assertion change.

Also modified, in `keeps the typed description when a serviço row has one`: a single
`await click(buttonByText(revealDescription))` inserted before typing. Interaction, no assertion
touched.

In `sale-wizard-ui-contract.test.tsx`, one existing test gained a line
(`expect(source).toContain('Adicionar descrição')`) and the `sourcePath` computation moved from
`new URL(..., import.meta.url)` to `node:path`, forced by the file switching to
`@vitest-environment happy-dom`. I verified this did not neuter the source-grep tests: on the
reverted source that suite fails at line 321 on `toContain('Adicionar descrição')`, so `sourcePath`
still resolves to the live file. No `not.toContain` guard was removed - the banned-string block
(`Dividir em`, `+ parcela`, `list="`, `NativeSelect`, ...) is intact.

## Are the new tests real?

Yes. `sale-wizard-ui-contract.test.tsx` now mounts the actual `SaleWizardDialog` through
`createRoot` under happy-dom and drives it with real click and input events. The two new tests
assert rendered DOM - element presence and absence, `document.activeElement`, input `.value`,
`className` - not source strings. `SaleWizardDialog` was already exported at HEAD
(`git show HEAD:...` line 4952), so no export was widened just to make it testable.

The first new test walks four regimes in one session: Serviço collapsed -> revealed and focused ->
text cleared but still mounted -> swapped to an open-price produto (forced open) -> free item added
(open, no affordance) -> swapped to a fixed-price produto (no field at all). The second covers the
edit path. Every one of these is falsifiable, which the three mutation runs above demonstrate
directly.

## Adversarial revert

Backed up `SalesOpsApp.tsx`, ran `git checkout -- ` on it alone, left both test files in place.
Result: **2 files failed, 6 tests failed, 9 passed (15)**.

Failures, all for the right reason - the old code renders the Serviço description unconditionally:

```
FAIL  sale-wizard-service-description > advances step 1 with a serviço item whose description is blank
FAIL  sale-wizard-service-description > keeps the typed description when a serviço row has one
FAIL  sale-wizard-service-description > still blocks a serviço item whose negotiated value is zero
FAIL  sale-wizard-service-description > labels the serviço description as optional and names the catalog fallback
FAIL  sale-wizard-ui-contract > keeps the proposal dialog aligned with the Nova proposta wizard shell
FAIL  sale-wizard-ui-contract > renders the description as an opt-in affordance only where it is optional
```

with `AssertionError: expected <input aria-label="Nome / descrição do item 1" …> to be null`.

Restored from the backup. `shasum -a 256` matches `c8e3d1dd...172b4` byte for byte, and
`git status --porcelain` diffs clean against the snapshot taken before I started. Re-ran the three
affected suites after restoring: **3 files, 18 tests, all passing.** Three further mutations
(TRAP A, TRAP B, TRAP C) were each restored and hash-verified the same way. Nothing is left behind
and no process was left running.

## Payload and calculations

Unchanged, verified by reading both write sites rather than trusting the diff:

- Product rows still send `productName: saleItemDisplayName(item)` (line 5875); free rows still
  send `productName: item.customLabel.trim() || 'Item avulso'`. The
  `items[].productName` -> `productNameSnapshot` path in `CLAUDE.md` is intact.
- `saleItemDisplayName`, `productRowRequirements`, `itemsValid`, `draftValid` and the
  `funcaoCostBasis` mapping are untouched by the diff.
- `descriptionOpen` is UI-only and cannot leak: both item payloads are built field by field with no
  spread of the form row. It is a required (non-optional) property on `SaleItemForm`, so the green
  `tsc --noEmit` is itself proof that no construction site was missed.

## Scope creep

None found. All four new constants (`saleItemGridClass`, `saleItemHeaderClass`,
`saleItemBlockClass`, `saleItemFieldLabelClass`) are referenced only between lines 6129 and 6365,
inside the `Itens` block. Two changes are adjacent but in scope, not creep: removing
`h-10 rounded-[9px]` from the numeric inputs and lifting the área badge out of column 1 are both
direct causes of criterion 1, and consolidating the standalone área-error row into the single
message home is a consequence of criterion 3's restructuring, not an unrelated edit.

## Project rules

- No native `<select>`, `<option>`, `<datalist>` or raw `<input type="number">` introduced; the
  `no-restricted-syntax` rule passes.
- The new affordance is a `<button type="button">`, not a picker.
- `git diff | grep "^+.*—"` -> **NONE**. No em dash introduced.
- No raw account or workspace id rendered.

## Verdict

**PASS.** All three commands green, no test count dropped (web 363 -> 365, api 300 -> 300, same
file counts), all four traps genuinely handled and each proved falsifiable by mutation rather than
by inspection alone, and every modified assertion either holds strictly more than it did or is a
pure interaction step. Gate 2 clears.
