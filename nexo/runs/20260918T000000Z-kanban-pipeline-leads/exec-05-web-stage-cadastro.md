# exec 05-web-stage-cadastro

Branch `feat/20260918-05-web-stage-cadastro`, commit `91565e3`.
`git diff --name-only master...HEAD` lists exactly the two files in `files_modified`.

## What shipped

- `apps/web/src/sales-ops/leads/LeadStagesView.tsx` - one exported view, one exported pure
  helper (`reorderStageIds`), one exported props type. No query, no mutation, no `apiFetch`,
  no token: every side effect is a prop.
- `apps/web/src/sales-ops/leads/__tests__/lead-stages-view.test.tsx` - 15 tests, the 15 the
  plan names.

`SalesOpsApp.tsx`, `navigation.ts`, `apps/web/package.json` and everything slice 06 owns are
byte-unchanged. Nothing outside `files_modified` was touched.

## Where the SHIPPED slice 04 code and the plan disagreed (shipped code won)

1. **`ReorderLeadStagesPayload` is `{ stageIds: string[] }`**, not `{ orderedIds }`. The plan's
   slice-07 wiring block said `reorderLeadStages.mutateAsync({ orderedIds })`. The wiring comment
   at the top of the file spells it `{ stageIds: orderedIds }`. This component's own prop stays
   `onReorderStages(orderedIds: string[])` as planned.
2. **`SetLeadStageStatusPayload` is `{ id, status }` and carries NO `name`.** The plan's
   `onSetStageStatus` prop takes `{ id, name, status }`, and that is kept, because the prop is
   this screen's own contract and the name is what the confirmation copy reads. The wiring
   comment says explicitly that slice 07 drops `name` on the way to the mutation.
3. **`SalesOpsLeadStage` carries `kind` and `archivedAt`** beyond the five fields the plan lists.
   Both are ignored here, as planned: this screen reads exactly `id`, `name`, `isSystem`,
   `position`, `status`. The fixture models the full shipped type.
4. The plan's correction was already applied: the type imports from `'./types'`, the sibling.

## Two deliberate deviations from the plan's letter, both forced by lint

- **The `pendingOrder` clear is a RENDER-PHASE guard, not a `useEffect`.** The plan writes it as
  an effect; `react-hooks/set-state-in-effect` is an ERROR in this repo and rejected it. A
  render-phase write is the dominant pattern in `SalesOpsApp.tsx` (five of them) and is strictly
  better here: an effect would paint the settled order once before clearing. It terminates by
  construction, because the write makes its own condition false on the next render. Oracles 2 and
  3 are unchanged and still decisive.
- **A file-top `/* eslint-disable react-refresh/only-export-components */`** with a written
  justification, because exporting the pure `reorderStageIds` beside the component warns
  otherwise. Precedent: `apps/web/src/router.tsx` and `apps/web/src/auth/react.tsx` carry the same
  line. The repo lints clean with zero warnings again.

## Red then green

The test file was written first and failed to resolve `../LeadStagesView` (right reason, zero
tests collected). Every named oracle was then proven decisive by mutating the implementation and
watching the NAMED test go red:

| mutation | red test |
|---|---|
| `catch` no longer clears `pendingOrder` | `reverts the row order when the reorder request fails` |
| system fork collapsed into one shared branch | `offers no rename and no archive affordance for a system etapa` |
| archived section deleted | `restores an archived etapa from the Etapas arquivadas section` |
| row archive button wired straight to the mutation | `archives only after the confirmation is accepted` |
| `onSave(...).catch(() => undefined)` before the close | `keeps the dialog open when the save is rejected` |
| first-row up arrow no longer `disabled` | `does not move the first etapa up or the last one down` |
| `reorderStageIds` returns a fresh array out of range | `returns the same array reference when the move is out of range` |
| `status === 'active'` filter deleted | `lists no archived etapa in the active table` (and the restore oracle) |

The two mutations M1 and M2 were re-run AFTER the effect-to-render-phase refactor and are still
red, so the refactor did not weaken them.

## One measured limit, recorded rather than left to be rediscovered

Deleting the `next === current` guard inside `move()` does NOT go red, and cannot be made to.
React resolves a click listener from its OWN props, so a button React rendered with `disabled`
never runs the handler; `removeAttribute('disabled')` on the DOM node does not change that
(proved with a throwaway probe: the handler fired 0 times both before and after). The guard is
therefore unreachable defence in depth while the `disabled` expressions are correct, and the two
things that ARE reachable are pinned: dropping either `disabled` expression goes red on oracle 4,
and the same-reference rule itself goes red on oracle 14. The comment in oracle 4 says this.

## Commands actually run, at the end, on the committed tree

- `pnpm --filter @fxl-sales/web test src/sales-ops/leads/__tests__/lead-stages-view.test.tsx`
  -> `Test Files 1 passed (1)`, `Tests 15 passed (15)`
- `pnpm --filter @fxl-sales/web test` -> `Test Files 62 passed (62)`, `Tests 832 passed (832)`
- `pnpm run lint` -> `apps/api lint: Done`, `apps/web lint: Done`, no error and no warning
- `pnpm run type-check` -> all four packages `Done`
- `pnpm run build` -> packages, api and web all built, `built in 1.82s`

No process was left running.
