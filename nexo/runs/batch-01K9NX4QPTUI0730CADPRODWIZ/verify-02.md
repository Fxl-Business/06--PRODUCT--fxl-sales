# Verify 02 - wizard shell footer

Branch: `feat/02-wizard-shell-footer` (uncommitted working tree)
Verifier: independent Nexo VERIFY sub-agent. Executor notes were not read.

## Verdict

**PASS**

## Scope of the change

`git diff --stat`:

```
 apps/web/src/sales-ops/SalesOpsApp.tsx                       | 10 +++++-----
 .../src/sales-ops/__tests__/sale-wizard-ui-contract.test.ts  | 12 ++++++++++++
 2 files changed, 17 insertions(+), 5 deletions(-)
```

Plus one new untracked file: `apps/web/src/sales-ops/__tests__/sale-wizard-shell-layout.test.tsx`.

The source diff is exactly four `className` edits inside `SaleWizardDialogBody`, and nothing else.
No handler, no string, no JSX structure, no prop, no import moved.

1. `DialogContent`: added `flex h-[92vh] ... flex-col`, kept `max-h-[92vh]`.
2. `DialogHeader`: added `shrink-0`.
3. Stepper `div`: added `shrink-0`.
4. Body `div`: `max-h-[calc(92vh-210px)] overflow-y-auto` -> `min-h-0 flex-1 overflow-y-auto`.
5. Footer `div`: added `shrink-0`.

## Commands run

### `pnpm test`

Exit code `0`.

```
packages/shared-utils test:  Test Files  2 passed (2)
packages/shared-utils test:       Tests  23 passed (23)
apps/api test:  Test Files  29 passed (29)
apps/api test:       Tests  300 passed (300)
apps/web test:  Test Files  39 passed (39)
apps/web test:       Tests  363 passed (363)
```

The root script is `pnpm run build:packages && pnpm -r --if-present test && node scripts/no-legacy-auth.mjs`, so the tracked-file legacy-auth guard ran and passed inside that exit code.

Against the stated baseline:

| suite | baseline | now | delta |
| --- | --- | --- | --- |
| web files | 38 | 39 | +1 (`sale-wizard-shell-layout.test.tsx`) |
| web tests | 361 | 363 | +2 (1 new file test, 1 new case in `sale-wizard-ui-contract.test.ts`) |
| api files | 29 | 29 | 0 |
| api tests | 300 | 300 | 0 |

No drop anywhere. `grep` for `.skip`, `.only`, `todo(` across both touched/added test files returns nothing (exit 1).

### `pnpm run lint`

Clean.

```
apps/api lint$ eslint src/
apps/web lint$ eslint src/
apps/api lint: Done
apps/web lint: Done
```

### `pnpm run type-check`

Clean.

```
packages/shared-types type-check: Done
packages/shared-utils type-check: Done
apps/api type-check: Done
apps/web type-check: Done
```

## Adversarial checks

### 1. Does the oracle genuinely fail without the fix?

Yes. Procedure: sha256 of `SalesOpsApp.tsx` recorded, file copied to scratchpad, then `git checkout HEAD -- apps/web/src/sales-ops/SalesOpsApp.tsx` reverted ONLY the source while leaving both test changes in place. `git diff --stat` then showed only the test file, confirming a source-only revert.

Result with the fix reverted:

```
 Test Files  2 failed (2)
      Tests  2 failed | 2 passed (4)
```

Failure reasons, both correct:

- `sale-wizard-shell-layout.test.tsx`: `AssertionError: expected [ 'max-h-[92vh]', ...(23) ] to include 'flex'` - this is the RENDERED DOM `className` of the shell node, i.e. it failed because the real component emitted the old classes.
- `sale-wizard-ui-contract.test.ts:87`: the `toContain` on the flex-column shell string failed against the on-disk source.

Restore: file copied back from the scratchpad backup. sha256 after restore is `54ae666c5acef5ab36cfb2f76eb635fc852d874a30d01ccb1f294c5993095539`, byte-identical to the pre-experiment hash. `git status --porcelain` diffed against the recorded pre-experiment status: identical. Both oracle files re-run green (`4 passed`) after restore.

### 2. Is the test tautological?

No.

- `sale-wizard-ui-contract.test.ts` reads `SalesOpsApp.tsx` off disk with `readFileSync` and asserts on that text. It is a source assertion, not a fixture assertion, and it carries a positive control (asserting the flex-column shell IS present) before the negative (`not.toContain('calc(92vh-')`, `not.toContain('vh-210px')`), so the negative cannot pass vacuously.
- `sale-wizard-shell-layout.test.tsx` renders the real `SaleWizardDialog` into happy-dom, locates the shell via `div[class*="max-w-[940px]"]`, and asserts on `element.className` of four real DOM nodes. It proves node identity first (`header.textContent` contains `Nova proposta`, `footer.textContent` contains `Salvar rascunho` and `Avançar`, body contains `Cliente e responsáveis`, stepper contains `Pagamento`) before asserting classes, so it cannot be asserting on the wrong nodes. It also asserts the negatives `body.className` has no `max-h-` and `footer.className` has no `absolute`.

One honest limitation, noted below as an observation, not a defect.

### 3. Does the layout actually prevent the clip? (merits, not green ticks)

Yes. Reasoning from the resulting classes rather than from the test result:

- `DialogContent` resolves to `fixed left-[50%] top-[50%] translate-... flex flex-col h-[92vh] max-h-[92vh] overflow-hidden`. `h-[92vh]` gives the flex container a DEFINITE main-axis size, which is what makes `flex-1` on the body meaningful. `flex` beats the shadcn base `grid` because `cn` is `twMerge(clsx(...))` (`apps/web/src/lib/utils.ts`) and both are in tailwind-merge's `display` group, so the later class wins - and the identical merge already ships in production on `ProductDialogBody`.
- Header, stepper and footer carry `shrink-0`, so they hold their intrinsic heights and can never be compressed or pushed out.
- The body carries `min-h-0 flex-1 overflow-y-auto`. `flex-1` makes it absorb exactly the leftover space; `min-h-0` defeats the automatic `min-height: auto` on a flex item, which is the specific rule that would otherwise let tall step content grow the body past its share and shove the footer under the container's `overflow-hidden` edge. With `min-h-0` the overflow is resolved by the body's own scrollbar instead.
- The footer therefore always occupies its own intrinsic height at the bottom of a 92vh box, at any viewport height. There is no longer any constant anywhere that encodes an assumption about how tall the chrome is.
- The old bug is fully explained by this: the chrome is roughly 85px header + 66px stepper + 74px footer ~= 225px, while the removed constant budgeted 210px. The body was therefore allowed to be ~15px taller than the space actually available, pushing the footer past the 92vh cap where `overflow-hidden` sliced it. That matches the operator report of horizontally sliced buttons exactly.
- The Radix close button is a fifth child of `DialogContent` but is `absolute`, so it is out of flow and is not a flex item. Making the parent a flex column cannot disturb it, and the `[&>button]:right-[26px] [&>button]:top-[31px]` offsets it depends on are untouched.
- The stepper's `overflow-x-auto` is on the cross axis and is unaffected by `shrink-0`, which governs the main (vertical) axis here.
- Degenerate case for completeness: if 92vh were ever smaller than ~225px of chrome the footer would clip again, since all three chrome blocks are `shrink-0`. That requires a viewport under ~245px tall, which no supported browser window reaches, and the same limit applies to the already-shipped `ProductDialogBody`. Not a defect.

The chosen mechanism is character-for-character the `ProductDialogBody` shell at `apps/web/src/sales-ops/SalesOpsApp.tsx:3495` (`flex h-[92vh] max-h-[92vh] w-[calc(100vw-48px)] max-w-[640px] flex-col gap-0 overflow-hidden ...` with a `min-h-0 flex-1` scroll body and a `flex-none` footer), differing only in the width and radius that belong to the wizard. That is exactly the pattern the acceptance criteria named.

### 4. Chrome survival - each item verified by reading the diff and the final line

| required to survive | status |
| --- | --- |
| `max-w-[940px]` | present, unchanged |
| `rounded-[22px]` | present, unchanged |
| `sm:rounded-[22px]` | present, unchanged |
| `bg-[#f4f4f6]` | present, unchanged |
| `[&>button]:...` close-button positioning | all 12 arbitrary variants present, byte-identical tail of the string |

Also incidentally preserved: `w-[calc(100vw-48px)]`, `gap-0`, `overflow-hidden`, `border-none`, `p-0`, `shadow-[0_30px_80px_rgba(0,0,0,.3)]`, `max-h-[92vh]`.

### 5. No `calc(...vh-...)` body height remains

`grep -n "calc(9\|vh-2\|vh -" apps/web/src/sales-ops/SalesOpsApp.tsx` returns nothing (exit 1). `grep -c "max-h-\[calc"` returns `0`. The only surviving `calc` in the shell is `w-[calc(100vw-48px)]`, a WIDTH, which the acceptance criteria did not ask to remove and which was there before.

### 6. Em dashes

`git diff | grep "^+" | grep -c "—"` returns `0`; the new test file returns `0`. None introduced.

## Findings

**F1 (observation, non-blocking) - `h-[92vh]` makes the wizard a fixed-height dialog.**
Before, `max-h-[92vh]` alone let the dialog shrink-wrap short steps. Now it is always 92vh tall. This is a real visual change beyond the strict minimum: a `min-h-0 flex-1` body would also have worked under a bare `max-h`, with the container auto-sized and the body shrinking to scroll once content exceeded the cap. I am not treating it as scope creep because (a) the acceptance criteria explicitly named `ProductDialogBody` as the pattern to copy and that shell includes `h-[92vh]`, (b) a definite container height makes the flex distribution deterministic rather than dependent on auto-height flexbox subtleties, and (c) a fixed height removes the dialog-height jitter between the four wizard steps, which is better for a stepper anyway. Flagging it so a human can veto the aesthetic if they disagree.

**F2 (observation, non-blocking) - the DOM test mocks `@/components/ui/dialog`, so it proves the AUTHORED classes, not the tailwind-merged final classes.**
The mock passes `className` straight to a plain `div`, so nothing in the new test would catch a regression where the shadcn base `grid` beat the new `flex`. I closed that hole by hand: `cn` is `twMerge(clsx(...))`, `grid` and `flex` are in the same tailwind-merge `display` group so the caller's class wins, and the identical merge is already live on `ProductDialogBody`. The mock is otherwise the right call, since a real Radix portal render would put the shell outside `container` and make the four-children index walk fragile.

**F3 (informational) - untracked files present that are not this slice's source.**
`.vscode/` was already untracked on `master` before this branch existed (it is in the session-start status snapshot), so it is not scope creep from this work. `nexo/runs/batch-01K9NX4QPTUI0730CADPRODWIZ/exec-02.md` and `agents/exec-02.result.json` are the executor's own run record, expected, and were not read.

No behavior change, no string change, no handler change, no JSX restructure was found. Nothing else to report.

## Reasoning for the verdict

Every gate command is green with a zero exit code. No test count dropped in any package; the two added tests are net-new coverage with no `.skip` / `.only` / `todo(`. The oracle was proven to fail without the fix and to fail for the right reason, on the rendered DOM rather than on a fixture, and the source was restored byte-identically with `git status` matching what I found. All five named chrome properties survived verbatim. The `calc(92vh-210px)` magic height is gone with no viewport-height calc left in the shell. And the resulting class set does, on its own merits, make the footer unclippable at any realistic viewport height, for a mechanism reason I can state independently of the tests.

PASS.
