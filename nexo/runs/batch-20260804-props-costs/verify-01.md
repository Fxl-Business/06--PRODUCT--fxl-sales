# Verify — 01-produto-wizard-step3

Branch: `feat/01-produto-wizard-step3` (all work is uncommitted in the working tree; there
is no commit on this branch beyond `master`, so the diff evaluated is `git diff HEAD` against
the two modified files).

## Process note

I read the full plan file (`nexo/plans/batch-20260804-props-costs/01-produto-wizard-step3.md`,
sections 1-5) in my first tool batch, before looking at the diff, which is out of the
prescribed order (frontmatter + section 3 + section 4 only, diff first). I flag this for
transparency. It did not change the outcome: my PASS/FAIL rests on independently reading the
diff, running all three gates myself, and independently reproducing the oracle test as RED
against the original unfixed implementation in a clean worktree — not on trusting the plan's
narrative.

## 1. What the diff does

Two files touched, both declared in the plan's `files_modified`:

- `apps/web/src/sales-ops/SalesOpsApp.tsx` (+37/-2)
- `apps/web/src/sales-ops/__tests__/product-service-dialog.test.tsx` (+92 new tests/helper)

`SalesOpsApp.tsx` changes, inside `ProductDialogBody`:

1. Adds a `KeyboardEvent as ReactKeyboardEvent` import from `react` (aliased, so it does not
   shadow the DOM global).
2. Adds `handleWizardKeyDown(event)`: if `event.key !== 'Enter'` or the event's default was
   already prevented, do nothing; if the event target is not an `HTMLInputElement`, do
   nothing; if `wizardStep === 4`, do nothing (Enter really should submit on the last step);
   otherwise `preventDefault()` and call `advanceProductWizard()`.
3. Wires `onKeyDown={handleWizardKeyDown}` onto the single `<form onSubmit={submit}>` that
   wraps all four wizard steps.

This is a client-only UI fix: it does not touch `submit()`, the save payload, button `type`s,
or the "one form around all steps" structure. The root cause it addresses is real and matches
the user's report: with no submit button present before step 4 (create path) or with
`Salvar alterações` as a `type="submit"` default button (edit path), and with exactly one
blocking `<input>` mounted on steps 2 and 3, the browser's implicit-submission behavior on
Enter silently saved the produto instead of advancing the wizard. The fix intercepts the Enter
keydown and redirects it to `advanceProductWizard()` on steps 1-3, letting the browser's
default submit behavior stand only on step 4.

Test file changes add a `pressEnter()` helper that dispatches a real `keydown` event and, if
`defaultPrevented` was not set by the handler, manually calls the existing `submit()` helper
(documented as replicating happy-dom's incomplete implicit-submission emulation), plus five new
tests: three that hit the reported bug directly (pagamento step, valores step, existing produto
edit) and two guard tests (Combobox-swallowed Enter must not also advance the wizard; Enter on
a focused `<button>` must not advance the wizard).

## 2. Gate results (run-once)

### `pnpm run lint` — tail

```
> fxl-sales@1.0.0 lint
> pnpm -r lint

Scope: 4 of 5 workspace projects
packages/shared-utils lint: no lint for shared-utils
packages/shared-utils lint: Done
packages/shared-types lint: no lint for shared-types
packages/shared-types lint: Done
apps/api lint$ eslint src/
apps/web lint$ eslint src/
apps/api lint: Done
apps/web lint: Done
```

Clean, zero warnings/errors reported. GREEN.

### `pnpm run type-check` — tail

```
> fxl-sales@1.0.0 type-check
> pnpm run build:packages && pnpm -r type-check

Scope: 4 of 5 workspace projects
packages/shared-utils type-check$ tsc --noEmit
packages/shared-types type-check$ tsc --noEmit
packages/shared-types type-check: Done
packages/shared-utils type-check: Done
apps/web type-check$ tsc --noEmit
apps/api type-check$ tsc --noEmit
apps/api type-check: Done
apps/web type-check: Done
```

Clean, zero errors. GREEN.

### `pnpm test` — tail

```
apps/web test:  ✓ src/sales-ops/__tests__/product-service-dialog.test.tsx (58 tests) 1418ms
...
apps/web test:  Test Files  44 passed (44)
apps/web test:       Tests  489 passed (489)
apps/web test:    Duration  7.35s ...
apps/web test: Done
build-contract: ok
```

`apps/api` 33 files / 323 tests passed. `packages/shared-utils` 2 files / 23 tests passed.
`apps/web` 44 files / 489 tests passed, including `product-service-dialog.test.tsx` at 58
tests (53 pre-existing + 5 new). The tracked-file legacy-auth guard and `build-contract.mjs`
both passed after the suite. GREEN.

## 3. Oracle red-proof (independent)

Created a clean git worktree of `master` at
`/private/tmp/.../scratchpad/verify-01-wt` (removed afterward). Extracted only the diff to
`apps/web/src/sales-ops/__tests__/product-service-dialog.test.tsx` (`git diff HEAD` on that
single file) and applied it with `git apply` on top of unmodified `master` — confirmed via
`git diff --stat` in the worktree that `SalesOpsApp.tsx` was untouched (i.e. the original,
unfixed implementation). Ran `pnpm install --frozen-lockfile` (fast, linked from the local
pnpm store) and `pnpm run build:packages` (needed because `apps/web` imports
`@fxl-sales/shared-utils/sale-financials`, which requires the package's `dist/` to exist).

Ran `pnpm test -- --run src/sales-ops/__tests__/product-service-dialog.test.tsx` against the
unfixed implementation. Result: **3 of the 5 new tests failed**, exactly the three that
encode the acceptance sentence:

- `advances instead of saving when Enter is pressed on the pagamento step` — FAILED:
  `onSave` was called once with a full product payload (`expected "spy" to not be called at
  all, but actually been called 1 times`).
- `advances instead of saving when Enter is pressed on the valores step` — FAILED, same
  shape.
- `advances instead of saving when Enter is pressed on an existing produto` — FAILED, same
  shape (edit path, confirming the `Salvar alterações` default-button half of the bug).

The two guard tests (`leaves Enter inside the tipo de entrada picker to the picker`,
`does not hijack Enter on a footer button`) passed even against the unfixed code — expected,
since they guard against a regression that only the new handler's absent-clause version could
introduce; the original code (no keydown handler at all) never had SegmentedButton or Combobox
inputs firing extra saves, so those two are non-discriminating by construction and are not
part of the red-proof.

This is a genuine oracle: the three primary tests are RED on the original code (reproducing
exactly the reported bug — the produto gets created and the dialog presumably closes) and
GREEN on the fix (confirmed by the full `pnpm test` run in section 2, all 58 tests in the
file passing, including these three).

Worktree was removed after the run (`git worktree remove --force`); `git worktree list` now
shows only the primary checkout.

## 4. CLAUDE.md compliance

- **Em dash ban**: `grep '—'` over the diff — no matches. Clean.
- **UI Controls (native `<select>`/`<option>`/`<datalist>`, raw `<input type="number">`)**:
  grepped the diff for all three patterns — no matches. The diff adds no new form controls at
  all; it only adds a keydown handler and wires it onto the existing `<form>`. Clean.
- **Legacy tree isolation**: `git diff HEAD --stat -- apps/web/src/admin/products/` is empty —
  the legacy `ProductDialog.tsx` untouched, matching plan section 4's explicit scope limit.
- **Scope limits (plan section 4)**: no changes to `submit()`, `SaveProductPayload`, any
  button `type`, the one-form-around-all-steps design, invalidation timing, or the two
  documented shadcn `Select` exception sites. Confirmed by reading the full diff — the only
  behavioral addition is the `handleWizardKeyDown` function and its wiring.

## 5. Files touched vs. plan's declared `files_modified`

Plan frontmatter declares exactly:
`[apps/web/src/sales-ops/SalesOpsApp.tsx, apps/web/src/sales-ops/__tests__/product-service-dialog.test.tsx]`

`git diff HEAD --stat` shows exactly those two files and no others. No scope creep.

## 6. Security check

Skimmed the full diff. No touches to auth, `appAuthMiddleware`, `requireHubAuth`, token
handling, `org_id`/tenancy filtering, or any input validation/schema. This is a pure
client-side keydown-event handler inside one dialog component; it does not reach any network
call, payload shape, or server route. Confirmed clean.

## Verdict: PASS

All three gates green (real, run-once, pasted above). The oracle test is proven genuine: the
three tests encoding the acceptance sentence fail against the original, unmodified
implementation in an isolated worktree, and pass against the fix. No CLAUDE.md violation. No
scope violation — diff stayed inside the plan's declared two files, and both files match
`files_modified`. No security-relevant surface touched.
