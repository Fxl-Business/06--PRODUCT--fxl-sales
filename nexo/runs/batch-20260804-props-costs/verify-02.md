# Verify — 02-pessoa-dialog-auto-funcao

## Methodology note

I was instructed to read only the plan's frontmatter `acceptance:` line, section 3, and
section 4 before forming my own view of the diff.
The `Read` tool has no partial-section mode, so my first read returned the whole file,
including section 2 (the prescribed fix).
I could not un-see it.
To compensate, I read the actual working-tree diff independently and line-by-line against
the user's stated requirement rather than against the plan's own description, and I built
the oracle proof (step 3 below) from first principles rather than by trusting the plan's
claims about what the old tests looked like.
The diff I found matches what section 2 describes; I am reporting that as an independent
confirmation, not taking it on faith.

## What actually changed

The branch `feat/02-pessoa-dialog-auto-funcao` has HEAD identical to `master`
(`24493ce`); all real changes are uncommitted working-tree edits (`git diff`, not
`git diff master...HEAD`, which is empty). Four files, matching the plan's
`files_modified` exactly, no more, no less:

- `apps/web/src/sales-ops/SalesOpsApp.tsx`
- `apps/web/src/sales-ops/__tests__/pessoas-funcoes-view.test.tsx`
- `apps/web/src/sales-ops/__tests__/cadastros-refresh.test.tsx`
- `apps/web/src/sales-ops/__tests__/optimistic-row-guard.test.tsx`

In `SalesOpsApp.tsx`'s `PersonDialogBody`:
- `pendingFuncaoId` state deleted.
- `assignFuncao(id)` no longer resets any parking state (nothing left to reset).
- The Combobox's `onChange` is wired directly to `assignFuncao` instead of to
  `setPendingFuncaoId`.
- `value=""` (a literal, not state) so the trigger always renders the placeholder.
- The `<SecondaryButton>Adicionar função</SecondaryButton>` and its `flex`/`flex-1`
  wrapper divs are deleted; `<Combobox>` is now a direct child of `FieldBlock`.
- `selectableFuncoes` (active + not-yet-assigned filter), `assignedFuncoes`,
  `onCreate={... handleCreateFuncao ...}`, `aria-label`, `className={formSelectClass}`,
  placeholders and the submit/disabled guards are all byte-for-byte unchanged.

In the three test files: every prior `await click(buttonByText('Adicionar função'));`
line was deleted at its call site (4 in `pessoas-funcoes-view.test.tsx`, 1 in
`cadastros-refresh.test.tsx`, 2 in `optimistic-row-guard.test.tsx`), with the
surrounding assertions left intact — no assertion was deleted to make a test pass.
One stale comment ("`Adicionar função` was clicked twice above...") was rewritten to
describe the new mechanism rather than just removed. Two new tests were added: a DOM
behaviour test ("assigns a função the moment it is picked, with no confirm button")
and a source-contract test ("leaves no `Adicionar função` confirm button behind"). Net
test count in `pessoas-funcoes-view.test.tsx` went from 12 to 14 — coverage grew, it
did not shrink.

## Gate results (run-once, real tails)

### `pnpm run lint`
```
apps/web lint$ eslint src/
apps/api lint$ eslint src/
apps/api lint: Done
apps/web lint: Done
```
Clean, no warnings, no errors. PASS.

### `pnpm run type-check`
```
apps/api type-check$ tsc --noEmit
apps/web type-check$ tsc --noEmit
apps/api type-check: Done
apps/web type-check: Done
```
Clean. PASS.

### `pnpm test` (via `CI=true`)
```
apps/api test:  Test Files  33 passed (33)
apps/api test:       Tests  323 passed (323)
apps/web test:  Test Files  44 passed (44)
apps/web test:       Tests  491 passed (491)
packages/shared-utils test:  Test Files  2 passed (2)
packages/shared-utils test:       Tests  23 passed (23)
build-contract: ok
```
Includes `pessoas-funcoes-view.test.tsx` (14 tests), `cadastros-refresh.test.tsx`
(8 tests) and `optimistic-row-guard.test.tsx` (12 tests) all green, plus the
`no-legacy-auth` tracked-file guard and the build-contract check both passing
implicitly (no failure reported). PASS.

## Oracle proof (independently reproduced)

1. `git worktree add <scratch>/oracle-master master` — a clean checkout of the
   original `SalesOpsApp.tsx` with the button still present (verified with
   `grep -n "Adicionar função"` → hit at line 5032).
2. Extracted `git diff` restricted to the three test files only
   (`pessoas-funcoes-view.test.tsx`, `cadastros-refresh.test.tsx`,
   `optimistic-row-guard.test.tsx`) into a standalone patch and applied it with
   `git apply` inside the worktree — applied clean, `SalesOpsApp.tsx` untouched.
3. Symlinked `node_modules` from the main checkout into the worktree (same pnpm
   workspace, same lockfile — no implementation code differs at this point) and ran
   `CI=true npx vitest run` over the three affected suites.
4. Result: **8 tests failed, 26 passed**, against the unmodified original
   implementation:
   - `pessoas-funcoes-view.test.tsx`: `assigns and removes funções before saving a
     pessoa`, `assigns a função the moment it is picked, with no confirm button`,
     `refuses to save a pessoa without a name or without any função`, `prefills the
     funções of the pessoa being edited and keeps its id`, and the new
     `pessoa dialog UI contract > leaves no 'Adicionar função' confirm button behind`
     — all failed.
   - `cadastros-refresh.test.tsx`: `sends funcaoIds when creating a pessoa and shows
     her before the POST resolves` — failed.
   - `optimistic-row-guard.test.tsx`: `disables the pessoa edit affordance while the
     create POST is in flight`, `keeps an unsaved função out of the pessoa função
     picker` — failed.

This is exactly the expected failure set: any test path that used to rely on the
button click to complete an assignment breaks once that line is gone and the old
`onChange`-only-parks-the-id code is still in place, and the new UI-contract test
fails because the old source still contains both `Adicionar função` and
`pendingFuncaoId`. Nothing failed for an unrelated reason.
5. Cleaned up: `git worktree remove <scratch>/oracle-master --force`,
   `git worktree list` confirms only the main worktree remains.

**Oracle proven red.**

## Behaviour checks

1. **Picking a função appends with no second click.** Confirmed by source: the
   Combobox's `onChange={assignFuncao}` calls `setAssignedIds` directly on selection;
   there is no intermediate state and no button to click. Confirmed dynamically by
   the new DOM test (`pickOption` → immediately `Remover função Designer` exists,
   `onSave` not called) passing in the real (fixed) tree and failing in the oracle
   worktree.
2. **Picker resets to empty state after each append.** `value=""` is a literal, not
   state, so there is nothing to go stale; `selectableFuncoes` also drops the just-
   picked id from its own options on the same render as a second, structural line of
   defense. The new test asserts both `textContent` = `'Selecione uma função'` and
   `hasAttribute('data-placeholder')` = `true` after a pick. Holds.
3. **Active-only, not-yet-assigned filter.** `selectableFuncoes` line is untouched:
   `[...funcoes, ...createdFuncoes].filter((funcao) => funcao.status === 'active' &&
   !assignedIds.includes(funcao.id))`. The pre-existing archived-função regression
   test (`'keeps an archived função a pessoa already carries listed but out of the
   picker'`) still passes untouched. Holds.
4. **Inline create (`onCreate`) still works and still assigns.** `handleCreateFuncao`
   is unchanged and still ends with `assignFuncao(created.id)`; the existing test
   `'offers a create row for a função that does not exist yet and assigns it'` passed
   in the full suite run. Holds — and per CLAUDE.md this picker is the one deliberate
   exception that keeps a create row, so this needed explicit checking. Holds.
5. **`funcao_required` guard not weakened.** `submit`'s
   `if (!displayName.trim() || assignedIds.length === 0) return;` line and the
   `PrimaryButton disabled` wiring are both untouched (confirmed by reading the
   surrounding code and by `git diff` showing no lines changed there). No API/schema
   file appears in `git status` at all, so the server-side `funcao_required` rejection
   is untouched. The existing test `'refuses to save a pessoa without a name or
   without any função'` still passes after its button-click line was deleted, and
   this exact test was one of the 4 that the oracle proof shows failing against the
   pre-fix code — i.e. it genuinely depends on the new behaviour, not vacuously
   passing either way. Holds.
6. **System funções (`vendedor`/`finder`) unaffected.** No `isSystem` filter was
   added to `selectableFuncoes`; system funções remain ordinary, assignable picker
   entries exactly as before. Not touched by the diff.

## Coverage-deletion check

Every one of the 7 button-click call sites removed had its surrounding assertions
left in place (verified by reading each hunk in the diff). One test comment was
rewritten to state the new invariant rather than silently dropped. Net test count
increased (2 new tests added, 0 removed). **No coverage was deleted to go green.**

## CLAUDE.md compliance

- **UI Controls — native picker ban.** No `<select>`, `<option>`, or `<datalist>`
  appears in any added line of the diff (`grep -iE '<select|<option|<datalist'` over
  added lines: no hits). `Combobox` remains the control. Lint (which enforces
  `no-restricted-syntax` for this) passed clean.
- **No em dash.** `grep '—'` over the full diff: no hits.
- **Scope.** Exactly the plan's 4 `files_modified`, no more, no less
  (`git status --short` shows only those 4 tracked files modified; untracked
  `.vscode/` and `nexo/plans|runs/...` are unrelated to this slice's code).

## Security check

This slice touches only client-side dialog UI in `apps/web`. No API route, schema,
middleware, or `org_id`/tenancy-filtering code appears anywhere in the diff (confirmed
by `git status` — only the one `.tsx` component and its three test files changed).
`funcao_required` is still enforced identically client- and server-side (see behaviour
check 5). No auth, tenancy, or validation logic was touched or weakened.

## Verdict: PASS

All three gates green (real run-once output above), the oracle was independently
built and proven red against the unmodified implementation (8/8 relevant tests fail
pre-fix, pass post-fix), every behaviour check in the assignment holds, no coverage
was deleted, CLAUDE.md UI-control and house-style rules are respected, and the diff
stayed strictly within the plan's declared scope. This is a purely additive UI
simplification with no security-relevant surface.
