# Verify 10b - `10-info-hints` (re-verification)

**Verdict: PASS**

Branch `feat/10-info-hints`, uncommitted working tree, merge-base `f9ad914`.
Judged from the code as it stands.
`exec-10.md`, `verify-10.md` and the agent notes were not read.

## Command results

| Command | Result |
| --- | --- |
| `pnpm test` | PASS. web **425 tests / 41 files** (baseline 409/39, so +16/+2). api unit **300 tests / 29 files** (baseline 300/29, unchanged). shared-utils 23/2. |
| `pnpm run lint` | Clean, exit 0. |
| `pnpm run type-check` | Clean, exit 0. |

No test count dropped anywhere.
`git diff HEAD` and the four untracked source/test files were grepped for `.skip`, `.only`, `todo(` and the em dash `—`: zero matches in either set.

The suite was re-run a second time after all mutation work was reverted, and returned the same 425 / 300 / 23.

## 1-3. Empirical Escape behaviour

I did not trust the shipped tests for this.
I wrote my own probe (`zz-verify-probe.test.tsx`, since deleted) driving the **real** `@radix-ui/react-dialog` through a **controlled** `Dialog`, so "the dialog stays open" is observed as a live `[role="dialog"]` node in the DOM and not only as an un-called spy.

| Probe | Result |
| --- | --- |
| `InfoHint` open inside a real `DialogContent`, Escape on the trigger | Hint text leaves the DOM. `onOpenChange` NOT called. `[role="dialog"]` still present. **PASS** |
| Second Escape, hint now closed | `onOpenChange(false)` called, `[role="dialog"]` removed. Escape still works as the dialog-close affordance. **PASS** |
| `Combobox` panel open inside a real `DialogContent`, Escape on the search input | `[role="listbox"]` gone. `onOpenChange` NOT called. Dialog still present. **PASS** |
| Second Escape, panel now closed | `onOpenChange(false)`, dialog removed. **PASS** |
| Escape with nothing inner ever opened | Dialog closes on the first press. **PASS** |

So the fix is not a blanket disable: Escape closes the innermost open thing and nothing else, and with nothing inner open it is still the dialog-close affordance `dialog.tsx` documents.

The mechanism is sound in principle too, and the code says so honestly: `inline-layer.ts` states plainly that Radix's `useEscapeKeydown` uses `document.addEventListener(..., { capture: true })` and that therefore no React-tree `stopPropagation` can pre-empt it, which is exactly the reason the previous attempt failed.
The `preventDefault` therefore lives on `DialogContent`'s own `onEscapeKeyDown`, which is the only seam upstream of that listener.
The comments left behind in `combobox.tsx` and `info-hint.tsx` explicitly demote their own `stopPropagation` calls to "keeps Escape from a React handler ABOVE this one, does NOT protect the dialog", which removes the exact misconception that produced the first failure.

## 4. Mutation test of the shipped regression test

Four independent mutations. Each was applied to the working tree, the shipped `inline-layer-escape.test.tsx` was run, then the file was restored from a byte copy.

| # | Mutation | Shipped test result |
| --- | --- | --- |
| 1 | `dialog.tsx`: neuter the guard body to `void inlineLayers; void event;` | **4 of 5 shipped tests FAIL** (both InfoHint cases, both Combobox cases). |
| 2 | `dialog.tsx`: make it unconditional - `event.preventDefault()` with no `hasOpenLayer()` check | **3 of 5 shipped tests FAIL**, specifically the three that pin Escape *still closing* the dialog. A blanket disable is caught. |
| 3 | `info-hint.tsx`: replace `useInlineLayer(open)` with `void useInlineLayer` | **2 shipped tests FAIL** (the two InfoHint cases); the two Combobox cases correctly stay green. |
| 4 | `combobox.tsx`: replace `useInlineLayer(open)` with `void useInlineLayer` | **2 shipped tests FAIL** (the two Combobox cases); the two InfoHint cases correctly stay green. |

The test is not a false positive.
It is also correctly *scoped* - mutations 3 and 4 each kill only their own component's cases, so the two halves are independently pinned.

Restore verified byte-identical by SHA-256 over `dialog.tsx`, `info-hint.tsx`, `combobox.tsx` and `inline-layer.ts` before and after; `diff` of the two checksum files is empty.

## Leak test of the new registry

This was the sharpest risk: a stuck-open dialog is worse than the original bug.
Seven independent leak probes, all **PASS**:

- **Hint unmounted while open.** The layer is removed from the tree with `open === true`; the effect cleanup releases, and the next Escape closes the dialog.
- **Two hints open simultaneously**, closed one at a time. Escape on the second closes only it and the dialog survives (count still 1); Escape on the first closes it and the dialog still survives (count now 0 but that Escape was consumed by the hint's own handler); the next Escape closes the dialog. Count arithmetic is right at every step.
- **Hint dismissed by an outside `mousedown`** rather than by Escape - the dialog is still closable afterwards.
- **Combobox panel closed by selecting an option** rather than by Escape - still closable.
- **Dialog closed by the `X` while a hint was open, then reopened** - the reopened dialog closes on the first Escape, i.e. a stale count does not survive a portal unmount/remount.
- **StrictMode**, three open/close cycles of a hint (double-invoked effects): the dialog is still closable at the end, and an open hint still swallows Escape (so the double-invoke has not stranded the count at 0 either). The `released` idempotency flag in `useInlineLayerHost` is load-bearing here and it works.
- **Direct registry unit probe**: `releaseA()` called three times decrements exactly once, `releaseB()` twice decrements exactly once, and a fresh `register()` after all that churn re-arms `hasOpenLayer()`. The counter cannot be driven negative.

I could not construct a state in which the dialog becomes permanently un-closable.

## 5. `DialogContentProps` omissions

Still omitted, and both guards still proven:

```ts
type DialogContentProps = Omit<
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>,
  "onPointerDownOutside" | "onInteractOutside" | "onEscapeKeyDown"
>
```

`onPointerDownOutside` and `onInteractOutside` are intact, the two `preventDefault` handlers are still applied *after* `{...props}`, and the existing "ignores a call-site attempt to re-enable outside dismissal" test still passes.
`onEscapeKeyDown` is newly added to the same `Omit`, which is the right call - it is the guard's seam, not a switch a call site may flip - and it comes with a matching "ignores a call-site attempt to take over Escape" test. Nothing in the repo passed that prop (type-check is clean).

## 6. Classification

Correct, and verified by diffing the branch against `master` string by string rather than by reading.

| Element | Status |
| --- | --- |
| `Sem área` badge | Line content **identical to master**. Inline. |
| `Alterado manualmente` | Identical to master. Inline. |
| `Definido na venda` | Identical to master. Inline. Also given a positive-control DOM test in `product-service-dialog.test.tsx`. |
| `planDirty` `Aplicar` / `Manter parcelas` bar | Both buttons identical to master, and the bar's own amber className `mb-2.5 flex flex-wrap ... rounded-[10px] border border-[#f0dfae] bg-[#fdf0cf] px-3 py-2 text-[12.5px] font-semibold text-[#9c7210]` is **byte-identical to master**. |

`master` had four `#f0dfae` amber blocks; the branch has exactly one, and it is the `planDirty` bar.
The three that went are the produto step-1 tip, the wizard step-3 tip and the wizard step-4 tip - i.e. precisely the three first-run explanatory banners, and nothing else.
All three sentences survive verbatim inside their `InfoHint`.

## 7. Dependencies

No change to `package.json` (root or `apps/web`) and none to `pnpm-lock.yaml` - `git diff --stat` over those paths is empty.
No popover or tooltip import anywhere; the three mentions of those words in the diff are prose in comments explaining why the panel is hand-rolled.
The only new import is `Info` from `lucide-react`, already a direct dependency and already used across this file.

## 8. The two minor fixes

**Clipping.** Fixed correctly. `overflow-hidden` moved off the step-4 "Previsão de contas a pagar" card and onto a new wrapper around the `<Table>`, which carries `rounded-b-[13px]` - 14px card radius less the 1px border, i.e. the same inner curve the card was clipping to before, so the last row's bottom corners are unchanged. The header that now owns the `InfoHint` is no longer inside a clipping ancestor.
I checked the other two call sites for the same hazard and neither has one: the step-3 card is `rounded-[14px] border bg-white p-4` with no `overflow-hidden`, and `wizardHeaderClass` is `shrink-0 border-b ... bg-white ...` with none either. The wizard shell's own `overflow-hidden` sits at `h-[92vh]`, nowhere near a 280px panel dropping from a title at y≈60px. The panel's `z-50` resolves inside the `DialogContent` stacking context, so it paints over the scrolling body that follows it in DOM order.

**Contrast.** Computed independently from the sRGB relative-luminance formula:

| Colour | On `#ffffff` | Verdict |
| --- | --- | --- |
| `#8b8b92` (shipped trigger) | **3.3839 : 1** | Clears WCAG 1.4.11's 3:1 for a meaningful non-text graphic. |
| `#b0b0b8` (the tone it replaced) | 2.1542 : 1 | Would have failed. |
| `#9c7210` (hover / open state) | 4.3496 : 1 | Clears it comfortably. |

The in-code comment claims 3.39:1 and 2.15:1; both are correct to the stated precision.
Panel body text `#57575f` on `#fdf0cf` is 6.32:1, well clear of 4.5:1.

## Adversarial review

**Are the a11y tests behavioural or attribute-string checks?**
Mixed, and honestly labelled, which is the acceptable version of mixed.

- `info-hint.test.tsx` (7 tests) and `inline-layer-escape.test.tsx` (5 tests) are real DOM behaviour against real components with nothing mocked - real `react-dom/client` roots, real dispatched `MouseEvent`/`KeyboardEvent`, real Radix dialog. `inline-layer-escape.test.tsx` in particular carries a header comment that names the exact false-positive shape that sank the first attempt ("a probe against a mocked dialog, or a plain `<div onKeyDown>` wrapper ... cannot observe the capture-phase listener that is the actual hazard"), and my mutation testing confirms it is the real thing.
- `info-hint.test.tsx`'s single wrapper-spy test is explicitly scoped in a comment to "does not reach a React handler ABOVE the hint" and says outright that a wrapper spy like it "passes either way and would have hidden the bug". That is the correct disposition of the old broken assertion: kept for what it does prove, demoted from what it never proved.
- `dialog-outside-close.test.tsx`'s Escape tests are prop-contract checks against a mocked Radix. The file's own header already declares that trade-off and points at the behavioural file, and my mutation 2 shows the behavioural file catches the case these cannot.
- `sale-wizard-ui-contract.test.tsx`'s new test is source-string based. That is this file's pre-existing convention (it reads the component source), and the assertions are well built: every negative quotes a string that really was in the file before, so none can pass vacuously, and there are positive controls plus an exact `<InfoHint ` count of 3.

**Scope creep.** Essentially none. The diff is 6 files and touches nothing outside the three tips, the guard seam and their tests. The one edit that is not strictly "move a banner behind a hint" is F2 below, and it is argued in-code.

**Em dashes.** Zero introduced. All new copy uses `-`.

## Findings

All non-blocking. Nothing here changes the verdict.

- **F1 (minor, accessibility).** The two per-item helper lines went from `font-semibold text-[#9c7210]` plus an `AlertTriangle` (4.35:1) to plain `text-[#8b8b92]` (3.38:1) at 11.5px. Both values fail WCAG 1.4.3 AA's 4.5:1 for normal-size text, so this is not a new class of problem - and `#9b9ba3` at 11.5px (2.76:1) already ships two lines below one of them, so `#8b8b92` is actually the *darker* of the app's muted tones. Still, it is a small step down on a line that previously had margin. Worth a look next time the muted palette is revisited; not this slice's job to fix.
- **F2 (minor, borderline scope).** Dropping the warning skin from those same two lines is a restyle, not a disclosure move. The in-code comment argues it well ("per-row helper text, not a warning ... a popover trigger per item row would be strictly more noise than the sentence it hid") and it is coherent with the slice's own thesis that advice is not state. Not calling it creep, but it is the one edit outside the literal brief.
- **F3 (nit).** `InfoHint`'s `align` prop is implemented and documented but unused - all three call sites are left-aligned and take the default. Harmless, and plainly anticipating a right-half trigger.
- **F4 (observation).** The step-3 and step-4 wizard hints are pinned only by source strings; there is no DOM test opening them in the real wizard. The produto-title hint *does* have a real DOM test, and `InfoHint` itself is fully behaviourally covered, so the residual risk is narrow ("the wizard call site is mis-wired") and the source assertions cover most of it.

## Conclusion

The check that failed last time now passes on both halves, empirically, against the real Radix dialog, and the regression test that pins it dies under four separate mutations of the protecting code.
The new registry does not leak under unmount-while-open, sequential layers, non-Escape dismissal, dialog close-and-reopen, StrictMode double effects, or direct double-release.
Classification is intact, dependencies are untouched, both minor fixes are real, and the full suite, lint and type-check are green with the counts up and nothing skipped.

**PASS.**
