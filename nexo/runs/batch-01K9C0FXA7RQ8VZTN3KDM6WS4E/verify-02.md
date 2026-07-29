# Verify (Gate 2) - slice 02-dialog-no-outside-close

Branch: `feat/02-dialog-no-outside-close` @ `9a70c45` on top of `master` @ `9fc47fd`.
Verdict: **FAIL** - production code is correct, the committed test oracle is not.

## Verdict in one paragraph

The implementation is right, minimal, in scope, and I proved behaviourally that it satisfies the acceptance criterion.
Nothing in `dialog.tsx` or `alert-dialog.tsx` needs to change.
The failure is confined to the test oracle: `dialog-outside-close.test.tsx` opens with a comment asserting as proven fact that outside-click dismissal "provably does not fire inside happy-dom" and that "a DOM driven test could therefore never go Red and would be a vacuous oracle", and uses that claim to justify a prop-capture oracle instead of a behavioural one.
I disproved that claim empirically in a throwaway probe.
A real outside-click test does go Red in this exact harness, with no new dependencies.
Because the criterion is behavioural and the shipped oracle is structural, the suite does not actually guard the criterion it was written for, and it ships a false "this is impossible" claim into the codebase that will steer the next maintainer wrong.

## 1. Gates

Run by me, on the branch, from a clean tree.

| Gate | Exit |
| --- | --- |
| `pnpm run lint` | 0 |
| `pnpm run type-check` | 0 |
| `CI=true pnpm test` | 0 |

Totals:

| Package | Branch | Baseline (`9fc47fd`) | Delta |
| --- | --- | --- | --- |
| apps/web | 27 files / 150 tests | 25 / 143 | +2 files / +7 tests |
| apps/api | 23 files / 215 tests | 23 / 215 | unchanged (correct, web-only slice) |
| packages/shared-utils | 1 file / 17 tests | - | unchanged |

Totals only went up. No skipped or todo tests reported.

## 2. Acceptance criterion

> given any open dialog rendered through the shared `DialogContent` primitive, when a pointer goes down anywhere outside the dialog content, then the dialog stays open and keeps its typed state, while Esc, the X affordance and Cancelar/Voltar still close it

**Behaviourally satisfied - I verified this myself, independently of the slice's tests.**

I wrote a temporary probe (`apps/web/src/components/ui/__tests__/zzz-verify-probe.test.tsx`, since deleted; tree confirmed clean) that drove the real `@radix-ui/react-dialog` in happy-dom and dispatched outside interactions at a sibling `<button>` in `document.body`:

| Scenario | Unguarded raw Radix `Dialog` | Branch `DialogContent` |
| --- | --- | --- |
| `new Event('pointerdown', {bubbles:true})` | `onOpenChange` called with `false` | never called |
| `MouseEvent` `pointerdown`(button 0) + `mousedown`/`mouseup`/`click` | `onOpenChange` called with `false` | never called |
| `MouseEvent` `pointerdown` button 2 | not called (Radix right-click guard) | never called |

So the guard genuinely works against the real primitive, and the baseline genuinely dismisses.

Esc and X: `dialog-close-affordances.test.tsx` drives the real primitive (no mock) and both tests pass.
`onEscapeKeyDown` is never passed anywhere in `apps/web/src` (grepped), so Esc is untouched.
The `X` affordance is rendered unconditionally by `DialogContent` itself, so **every** dialog retains at least two escape routes regardless of call site - no trap is reachable.
Focus management and scroll locking are untouched: the diff adds no `onOpenAutoFocus`/`onCloseAutoFocus`/`onFocusOutside` and does not touch `DialogOverlay` or the portal.

Note on `onInteractOutside`: it also fires for focus-outside. Preventing default there is already what Radix's modal `DialogContentModal` does for `onFocusOutside`, and no call site sets `modal={false}` (grepped), so the non-modal focus-return path is not reachable and not regressed.

## 3. Oracle honesty - the reason this FAILs

### 3a. The stated impossibility is false

The file comment says:

> Outside-click dismissal provably does not fire inside happy-dom: the Radix `pointerdown` listener registers and the event reaches `document` with the right target, yet `DismissableLayer` never dispatches its custom event. A DOM driven test could therefore never go Red and would be a vacuous oracle.

Row 1 and row 2 of my probe table above are direct counterexamples.
The mechanism is in `@radix-ui/react-dismissable-layer@1.1.14`: `DialogContentImpl` passes `deferPointerDownOutside: true`, and `usePointerDownOutside` only defers when `deferPointerDownOutside && event.button === 0`.
So the most likely failed experiment is dispatching a `MouseEvent('pointerdown', {button: 0})` alone, which is deferred to a follow-up `click` that never came, and concluding "never dispatches".
Either dispatching a plain `Event('pointerdown')` (`button` undefined, so the non-deferred branch fires synchronously) or following the pointerdown with a real `click` produces the dismissal.
The implementer already knew about the macrotask listener registration - the companion affordances file has the `setTimeout(5)` settle - so the ingredients were on hand.

Stating an unproven negative as "provably" in a committed comment is the specific problem: it is wrong, it is load-bearing (it is the entire justification for the weaker oracle), and it tells the next maintainer not to bother trying.

### 3b. The prop-capture oracle is structural, not behavioural

It is **not** vacuous. Against `master`'s `dialog.tsx` (I copied it to a scratch path and repointed the mock), 4 of 5 tests go Red:

- `passes a preventDefault-ing onPointerDownOutside` - `expected 'undefined' to be 'function'`
- `passes a preventDefault-ing onInteractOutside` - `expected 'undefined' to be 'function'`
- `labels the close affordance in pt-BR` - `expected 'TituloClose' to contain 'Fechar'`
- `ignores a call-site attempt to re-enable outside dismissal` - `expected "spy" to be called 1 times, but got 0 times`
- `does not intercept the Escape key` - still green (a non-discriminating regression guard; fine, and appropriate)

It also asserts the three things it needed to: the handlers exist, they call `preventDefault`, and a call site's handler is dropped rather than composed. That is above the "some function was passed" floor.

But it is coupled to Radix prop *names*, not to dialog *behaviour*. Concretely: on a future Radix major that renamed `onPointerDownOutside`, all five tests keep passing while every dialog in the app silently starts dismissing on outside click again. That is exactly the regression class the slice exists to prevent, and the shipped oracle is blind to it. A behavioural test - which I demonstrated is available - is immune.

### 3c. The cast in test 5

`renderDialog({ onPointerDownOutside: callSiteHandler })` launders `extraProps` through `as unknown as React.ComponentPropsWithoutRef<typeof DialogContent>` at the spread site.
This is legitimate and does not defeat the test's purpose: the cast only silences the compile error that the new `Omit` is supposed to raise, so that the *runtime* lockout can be observed. The assertions (`preventDefault` called once, `callSiteHandler` not called) are real and both go Red on revert.

Minor gap, not a defect: nothing asserts the type-level `Omit` itself (no `@ts-expect-error`-style probe), so the compile-time half of the lockout rests on `pnpm run type-check` over existing call sites only.

## 4. Anti-gaming

`git diff master..feat/02-dialog-no-outside-close -- '*test*' '*__tests__*'` is **two new files, 227 insertions, zero deletions**.
No pre-existing test file is touched at all. No `.only`, `.skip`, `xit`, `xdescribe`, or `todo:` in added lines. Nothing weakened, loosened, or deleted.

## 5. Scope discipline

- **Menus and pickers still close on outside click.** `dropdown-menu.tsx` and `select.tsx` are not in the diff and contain no `preventDefault`/outside-close guards. The hand-rolled workspace-menu scrim at `apps/web/src/sales-ops/SalesOpsApp.tsx:739` (`aria-label="Fechar workspaces"`, `fixed inset-0 z-[55]`, `onClick` closes) is untouched and still dismisses. No usability regression.
- **`alert-dialog.tsx` is comment-only** (8 added lines, no code), and the comment's claim is verifiably true. In `@radix-ui/react-alert-dialog@1.1.18`, `dist/index.mjs:67-68` sets `onPointerDownOutside`/`onInteractOutside` to `event.preventDefault()` *after* `...contentProps`, and `dist/index.d.mts:23` declares `AlertDialogContentProps extends Omit<DialogContentProps, 'onPointerDownOutside' | 'onInteractOutside'>`. So alert dialogs were already non-overridably immune. **No acceptance gap** for the "any open dialog" wording, and adding handlers there really would be a TS error.
- No unrelated changes: nothing under `apps/api`, no `navigation.ts`, no propostas status machine, no payables/receivables, no auth or tenancy, no `/admin/*` `/finder/*` `/seller/*` `/no-role` route trees. Only 4 files, all under `apps/web/src/components/ui/`.
- Batch YAGNI limits in `00-OVERVIEW.md` all respected.

## 6. Correctness review of the diff

- **Cannot be re-enabled at runtime.** Both handlers sit after `{...props}` in the JSX, so a call site's props are overwritten, not composed. Confirmed by test 5 and by the mock capture.
- **Cannot be re-enabled at the type level.** `DialogContentProps` = `Omit<..., "onPointerDownOutside" | "onInteractOutside">`.
- **pt-BR.** `sr-only` "Close" -> "Fechar" is confirmed. It was the only `sr-only` string in `apps/web/src/components/ui/*.tsx`, and it is now the only one. No new English user-facing string is introduced (the tests use "Titulo").
- **Commit hygiene.** Exactly one commit. `fix(web): keep dialogs open on outside click` - valid Conventional Commit. Author `CauetPinciara <cauetpinciara@gmail.com>`. No trailers at all, so no co-author and no AI attribution. No em dash in any added line or in the commit message.

No correctness defect found in the production code.

## Remediation to clear this gate

Cheap and mechanical. Keep `dialog.tsx` and `alert-dialog.tsx` exactly as they are.

1. Delete the false "provably does not fire in happy-dom" paragraph from `dialog-outside-close.test.tsx`.
2. Add a behavioural test that mounts the branch `DialogContent` with the **real** primitive (as the affordances file already does), dispatches `new Event('pointerdown', { bubbles: true })` on a sibling node in `document.body` after the macrotask settle, and asserts `onOpenChange` was never called. Optionally add the `pointerdown`(button 0) + `click` sequence as a second case. Both sequences dismiss an unguarded dialog, so both go Red on revert.
3. Keep the prop-contract tests. Test 5 (call site cannot override) is genuinely valuable and hard to express behaviourally - just reframe the file comment as "prop contract, complementing the behavioural test" rather than "behavioural testing is impossible".

## Appendix - repo state

Working tree left clean. Probe files created during verification (`zzz-verify-probe.test.tsx`, `zzz-revert-check.test.tsx`, `zzz-master-dialog.tsx`) were all deleted; `git status --short` shows only the pre-existing untracked `.vscode/` and the exec result JSON. No commit, merge, push, amend, or edit to any tracked file was made.
