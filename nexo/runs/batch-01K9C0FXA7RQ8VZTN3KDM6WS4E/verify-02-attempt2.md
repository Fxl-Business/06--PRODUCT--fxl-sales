# Verify (Gate 2, attempt 2) - slice 02-dialog-no-outside-close

Branch: `feat/02-dialog-no-outside-close` @ `e2d8b9b` on top of `master` @ `9fc47fd`.
Verdict: **PASS**.

I formed this view independently.
I read the attempt-1 report but re-derived every load-bearing claim myself, including the one thing attempt 1 could not accept on trust: that the behavioural oracle genuinely inverts.

## 1. Gates

Run by me, on the branch, from the tree as I found it.

| Gate | Exit |
| --- | --- |
| `pnpm run lint` | 0 |
| `pnpm run type-check` | 0 |
| `CI=true pnpm test` | 0 |

Totals:

| Package | Branch | Baseline (`9fc47fd`) | Delta |
| --- | --- | --- | --- |
| apps/web | 27 files / 152 tests | 25 / 143 | +2 files / +9 tests |
| apps/api | 23 files / 215 tests | 23 / 215 | unchanged (correct, web-only slice) |
| packages/shared-utils | 1 file / 17 tests | - | unchanged |

Totals only went up.
Zero skipped, zero todo.

## 2. The crux: does the behavioural test actually invert?

**Yes. I reproduced it myself rather than taking the implementer's word.**

Method: I recorded `git hash-object` of the branch `dialog.tsx`, copied it aside, overwrote it with `git show master:apps/web/src/components/ui/dialog.tsx` (confirmed byte-identical to `master`, and confirmed it contains no `onPointerDownOutside` / `onInteractOutside` and still says `sr-only`&nbsp;`Close`), then ran only the behavioural file.

Observed against the unguarded `master` version:

```
FAIL  dialogs never close on an outside pointer down > stays open when a bare pointerdown lands outside the content
AssertionError: expected "spy" to not be called at all, but actually been called 1 times
  1st spy call: [ false ]

FAIL  dialogs never close on an outside pointer down > stays open through a full outside primary-button click sequence
AssertionError: expected "spy" to not be called at all, but actually been called 1 times
  1st spy call: [ false ]

Tests  2 failed | 2 passed (4)
```

Both outside-pointerdown tests go Red, each with `onOpenChange(false)` fired exactly once.
The two affordance tests (`Esc`, `X`) stayed green, which is correct and desirable: they are non-discriminating regression guards against over-reach, not oracle for this change.

I then restored the branch file and verified the restore was byte-identical (`git hash-object` back to `1d8bd0f0bfe7517b42737567155f26ad0aa2ac5d`, `diff` clean), and re-ran both dialog test files on the branch: 9/9 green.

Judged against the four questions I was asked to answer:

- **Real primitive?** Yes. `dialog-close-affordances.test.tsx` has no `vi.mock` at all and imports `Dialog`/`DialogContent`/`DialogTitle` from `../dialog`, which pulls the real `@radix-ui/react-dialog`.
- **Observable behaviour, not props?** Yes. It asserts `expect(onOpenChange).not.toHaveBeenCalled()` plus `document.body.querySelector('[role="dialog"]')` still mounted. No prop introspection anywhere in that file.
- **Settles asynchronously after dispatch?** Yes, and this is the detail that matters. `await settle()` (a `setTimeout(5)` inside `act`) runs *after* the dispatch, not only after mount. So a dismissal that Radix deferred to a follow-up task has a chance to land before the assertion. The tests therefore cannot pass for the "deferred and never checked" wrong reason. My inversion run confirms this empirically: the deferred button-0 path does land, and is caught.
- **Fails against unguarded `dialog.tsx`?** Yes, proven above.

The oracle is now genuine behavioural evidence for the acceptance criterion.

## 3. Is the false claim gone?

**Yes, and it was not merely reworded into a differently-phrased version of the same untrue thing.**

The old committed claim - outside-click dismissal "provably does not fire inside happy-dom", so "a DOM driven test could therefore never go Red and would be a vacuous oracle" - appears nowhere in the tree.

What replaced it, in `dialog-close-affordances.test.tsx:16-24`, is the narrower and *true* observation: `deferPointerDownOutside: true` plus `usePointerDownOutside` deferring only when `event.button === 0` means a lone button-0 `MouseEvent('pointerdown')` "dismisses nothing by itself - it parks the dismissal on a follow-up `click` that a probe never sends". That is exactly the "a naive button-0 probe *appears* inert" framing the gate permits, and I verified the mechanism claim against `@radix-ui/react-dismissable-layer` behaviour in my own inversion run (the plain-`Event` case fires synchronously; the button-0 case needs the `click`).

Critically, the new comment makes the opposite claim to the old one: it says both shapes "dismiss an unguarded Radix dialog, so both invert when the guard is removed" - a testable assertion, which I tested and confirmed.

`dialog-outside-close.test.tsx:8-21` was also reframed honestly: it now calls itself the "prop-contract half ... complementing - never replacing" the behavioural tests, names the behavioural file as "the ones that prove the acceptance criterion", and volunteers its own weakness ("couples these five tests to Radix prop *names*, so an upstream rename would leave them green").

The plan file correction under `nexo/plans/` is in scope and authorised. It labels the old text **CORRECTED 2026-07-29 (Gate 2, attempt 1)**, states plainly that "**Both claims are false**", and explains the real mechanism. I checked its substantive claims against my own measurements and they hold, including "both call `onOpenChange(false)` exactly once" - which is precisely what I observed. No new false claims. It also honestly records a second planning error (the `as never` spread cast does not compile, `TS2698`).

## 4. Production files unchanged from attempt 1

`9a70c45` is still reachable.

```
git diff 9a70c45..e2d8b9b -- apps/web/src/components/ui/dialog.tsx apps/web/src/components/ui/alert-dialog.tsx
```

Empty output, exit 0. **Byte-identical.**
The whole amend touched only the two test files and the plan file (`git diff --stat 9a70c45..e2d8b9b` = 3 files). Since attempt 1 explicitly cleared the production code, nothing needs re-justification.

## 5. Anti-gaming

`git diff --numstat master..feat/02-dialog-no-outside-close -- '*test*' '*__tests__*'`:

```
133   0   apps/web/src/components/ui/__tests__/dialog-close-affordances.test.tsx
155   0   apps/web/src/components/ui/__tests__/dialog-outside-close.test.tsx
```

**Zero deletions.** Two new files, additions only. No pre-existing test file is touched.
Grepping added lines across the entire diff for `.only`, `.skip`, `xit(`, `xdescribe(`, `todo:`, `it.todo`: no matches.
Nothing weakened, loosened, skipped or deleted.

## 6. Scope discipline

- **Menus and pickers still close on outside click.** `dropdown-menu.tsx` and `select.tsx` are not in the diff, and a repo-wide grep shows the only `onPointerDownOutside` / `onInteractOutside` occurrences in `apps/web/src` are in `dialog.tsx` (the guard), `alert-dialog.tsx` (a comment), and the two new test files. The hand-rolled workspace-switcher scrim (`apps/web/src/sales-ops/SalesOpsApp.tsx:738`, `aria-label="Fechar workspaces"`) is not in the diff at all and still dismisses. No usability regression.
- **`alert-dialog.tsx` is comment-only** (8 added lines, zero code) and I independently confirmed the comment is true for the *installed* version, `@radix-ui/react-alert-dialog@1.1.18`: `dist/index.mjs:67-68` hardcodes both handlers to `event.preventDefault()`, and `dist/index.d.mts:23` declares `AlertDialogContentProps extends Omit<DialogContentProps, 'onPointerDownOutside' | 'onInteractOutside'>`. So alert dialogs were already non-overridably immune. The "any open dialog" wording of the criterion is fully covered with no gap.
- **Plan file change** is documentation-only, expected, authorised, and free of new false claims (section 3).
- **Nothing else.** Only 5 files. Nothing under `apps/api`, no `navigation.ts`, no propostas status machine, no payables/receivables, no auth or tenancy, no `/admin/*` `/finder/*` `/seller/*` `/no-role` route trees. The batch `### Scope limits (YAGNI)` items are all respected.

## 7. Correctness review

- **Cannot be re-enabled at runtime.** Both handlers sit *after* `{...props}` in the JSX, so a call site's props are overwritten rather than composed. Locked by test 5, which I watched go Red on the unguarded version.
- **Cannot be re-enabled at the type level - I verified this directly.** I wrote a throwaway probe passing each prop to `DialogContent` and ran `tsc --noEmit`:
  ```
  error TS2322: Type '{ children: string; onPointerDownOutside: (e: any) => any; }' is not assignable to type 'IntrinsicAttributes & DialogContentProps & RefAttributes<HTMLDivElement>'.
  error TS2322: Type '{ children: string; onInteractOutside: (e: any) => any; }' is not assignable to ...
  ```
  The `Omit` is genuinely enforced. Probe deleted.
- **Every dialog remains dismissible; no trap.** `DialogPrimitive.Close` (the `X`) is rendered *unconditionally* inside `DialogContent`, so all 9 `DialogContent` call sites inherit it regardless of their own children. `onEscapeKeyDown` is passed nowhere in `apps/web/src` (the only grep hit is the test asserting its absence), so `Esc` is untouched. All 5 `AlertDialogContent` call sites carry an `AlertDialogCancel`. Every dialog has at least two escape routes.
- **No non-modal regression.** `modal={false}` appears nowhere in `apps/web/src`, so the `onInteractOutside` focus-outside branch that `preventDefault` also suppresses is unreachable. Radix's own modal implementation does the same thing for `onFocusOutside`.
- **pt-BR.** `sr-only` `Close` -> `Fechar`, confirmed, and it was the only `sr-only` English string in the primitive. No new English user-facing string.
- **Commit hygiene.** Exactly one commit vs `master`. `fix(web): keep dialogs open on outside click` is a valid Conventional Commit. Author and committer both `CauetPinciara <cauetpinciara@gmail.com>`. `%(trailers)` is empty, so no co-author and no AI attribution. No em dash in any added line or in the message.

No correctness defect found.

## 8. The flagged residual: no `@ts-expect-error` probe for the `Omit`

**Acceptable, not a genuine gap.** Reasoning, since I was asked not to accept "flagged honestly" as self-justifying:

The real question is whether the *user-visible* bug can silently return. It cannot. The type-level `Omit` and the post-spread handler ordering are independent defences, and only the second one is load-bearing for behaviour: if the `Omit` were deleted tomorrow, a call site passing `onPointerDownOutside` would still be overwritten by the guard, so outside-click dismissal still would not resurface. That runtime half *is* locked by two committed, verified-inverting oracles (test 5 structurally, and the two behavioural tests end to end).

What is genuinely unguarded is narrower than it first looks: because no call site passes either prop, `pnpm run type-check` would keep passing if the `Omit` were removed, so the suite would not notice losing the compile-time *ergonomic* warning. That is a small oracle gap on a defence-in-depth nicety, not on the acceptance criterion. I also confirmed by direct probe that the `Omit` works today. Worth a follow-up hardening ticket at most; not a Gate 2 blocker.

## 9. Style notes (not grounds for failure)

- The comment block in `dialog-close-affordances.test.tsx` sits between the imports and the first statement, so it reads as documentation of the `act` cast below it rather than of the file. A position above the imports would read better. Cosmetic.
- `settle()` is defined below its first use in `mountDialog`. Legal via hoisting, slightly awkward to read.

## Appendix - repo state

I created exactly two throwaway artefacts and **deleted both**:

1. `apps/web/src/zzz-verify-omit-probe.tsx` (the `Omit` compile probe) - deleted, existence re-checked as `NO`.
2. A temporary overwrite of `apps/web/src/components/ui/dialog.tsx` with `master`'s version - restored via `git checkout --`, then verified byte-identical to a pre-swap copy by both `diff` and `git hash-object`.

Scratch logs were written only under the session scratchpad, outside the repo.

The tree I found already had one modified tracked file (`nexo/runs/batch-01K9C0FXA7RQ8VZTN3KDM6WS4E/run.md`) and six untracked paths; that was the pre-existing state, not my doing. I captured `git status --short` at the start and diffed it against `git status --short` at the end: **identical**. `HEAD` is still `e2d8b9b`. No commit, merge, push, amend, or edit to any tracked file was made by me.
