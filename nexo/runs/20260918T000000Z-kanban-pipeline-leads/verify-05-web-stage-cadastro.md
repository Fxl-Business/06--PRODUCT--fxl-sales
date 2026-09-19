# Verify - 05-web-stage-cadastro

Worktree: `.worktrees/20260918T000000Z-kanban-pipeline-leads/05-web-stage-cadastro`
Branch: `feat/20260918-05-web-stage-cadastro`, one commit `91565e3` ahead of `master`.
Diff under review: `git diff master...HEAD`.

**Verdict: PASS.**

## 1. Diff shape

```
$ git diff master...HEAD --stat
 apps/web/src/sales-ops/leads/LeadStagesView.tsx    | 568 +++++++++++++++++++++
 .../leads/__tests__/lead-stages-view.test.tsx      | 468 +++++++++++++++++
 2 files changed, 1036 insertions(+)
```

Exactly the two files in `files_modified`. Two new files, zero modified lines elsewhere.

`git diff master...HEAD --stat` restricted to `SalesOpsApp.tsx`, `navigation.ts`,
`apps/web/package.json`, `sales-ops/types.ts`, `sales-ops/hooks.ts`, `sales-ops/optimistic.ts`
and the three slice-04 lead files returns **empty output**: every one of them is byte-unchanged.
Nothing slice 06 owns is touched (no board, no card, no drag dependency, no `package.json` line).

## 2. Green runs (real output)

Named oracle (the plan's command):

```
$ pnpm --filter @fxl-sales/web test src/sales-ops/leads/__tests__/lead-stages-view.test.tsx
 ✓ src/sales-ops/leads/__tests__/lead-stages-view.test.tsx (15 tests) 77ms
 Test Files  1 passed (1)
      Tests  15 passed (15)
```

Full web suite:

```
$ pnpm --filter @fxl-sales/web test
 Test Files  62 passed (62)
      Tests  832 passed (832)
   Duration  6.07s
```

```
$ pnpm run lint
apps/api lint$ eslint src/   -> Done
apps/web lint$ eslint src/   -> Done

$ pnpm run type-check
packages/shared-types, packages/shared-utils, apps/api, apps/web -> all Done

$ pnpm run build
✓ built in 1.70s
```

No watcher was started and no process was left running.

## 3. Mutation testing - is any named oracle vacuous?

Every mutation was applied to `LeadStagesView.tsx`, the oracle file was re-run, and the file was
restored with `git checkout --`. `git status --porcelain` is empty after each.

| # | Mutation | Result | Named test that went red |
|---|---|---|---|
| A | System fork collapsed: `{stage.isSystem ? (` -> `{false ? (`, so a system stage renders the ordinary rename/archive row | **RED** | `offers no rename and no archive affordance for a system etapa` - `expected <button …> to be null` |
| B | Reorder revert removed: `setPendingOrder(null)` deleted from `move()`'s catch, message kept | **RED** | `reverts the row order when the reorder request fails` - `expected ['Novo','Proposta','Contato',…] to deeply equal ['Novo','Contato','Proposta',…]` |
| C1 | Save error mapping swallowed: `setError(SAVE_ERROR)` removed | **RED** | `keeps the dialog open when the save is rejected` - message assertion |
| C2 | Dialog closes anyway on a rejected save: `onSaveStage(payload).catch(() => undefined)` | **RED** | `keeps the dialog open when the save is rejected` - `expected null not to be null` |
| D | `Etapas arquivadas` section deleted (`archived.length > 0` -> `false`) | **RED** | `restores an archived etapa from the Etapas arquivadas section` |
| E | `reorderStageIds` returns a fresh equal array on an out-of-range move | **RED** | `returns the same array reference when the move is out of range` |
| F | Row archive button wired straight to `onSetStageStatus` (no confirmation) | **RED** | `archives only after the confirmation is accepted` |
| G | `move()`'s `if (next === current) return;` guard deleted, `disabled` attributes intact | **GREEN** - see finding 1 | none |
| H | `disabled={pending \|\| index === 0}` dropped from the up arrow | **RED** (2 tests) | `does not move the first etapa up or the last one down`, `disables every control on an optimistic row` |
| I | Restore sends `'archived'` instead of `'active'` | **RED** | `restores an archived etapa from the Etapas arquivadas section` |
| J | `status === 'active'` list filter dropped | **RED** (2 tests) | `restores an archived etapa …`, `lists no archived etapa in the active table` |
| K | Both status-write failure copies swallowed (`ARCHIVE_ERROR`, restore error) | **GREEN** - see finding 2 | none |

Every **load-bearing** oracle proved non-vacuous. The four the orchestrator named specifically
(system stages, reorder revert, duplicate-name error mapping, archive/restore) are each pinned by a
mutation that goes red on a *named* test, and the revert one is decisive on the ORDER assertion
rather than merely on the message, which is the failure mode the plan called out.

## 4. UI law (read from the source, not only from lint)

- No `<select>`, `<option>` or `<datalist>` anywhere in either new file. The view's own UI-contract
  test (`uses no native picker and no drag dependency`) reads its source with `readFileSync` and
  pins the absence, plus the absence of `@dnd-kit` / `react-beautiful-dnd` / `@hello-pangea/dnd`.
- No `<input type="number">` and no numeric input at all - the only field is a text `Input` from
  `@/components/ui/input`.
- **No single-select picker exists on this screen**, so `Combobox` is not applicable. A stage is a
  name; its order is two arrow buttons. That satisfies the CLAUDE.md UI Controls rules vacuously and
  the UI-contract test keeps a "quick" native picker from slipping in later.
- Button `type` attributes: eight literal `type="button"` and one literal `type="submit"` (the
  dialog's `Salvar`, inside its own `<form onSubmit>`). **No `type` is derived from state anywhere**
  (`grep` for `type={` in the view returns nothing). The `type="submit"` spelling is the exact
  shape of the existing precedent `FuncaoDialogBody` in `SalesOpsApp.tsx:5446-5462`
  (`<form onSubmit={submit}>` + `<PrimaryButton disabled={saving || isSystem || !name.trim()}
  type="submit">`). A constant activation behaviour cannot exhibit the CLAUDE.md step-3-to-4
  autosave race, which is specifically about an attribute that *changes* between the event dispatch
  and the browser's activation phase.

## 5. `useInlineLayer`

**This view opens no absolutely-positioned layer inside a `Dialog`.** The `StageDialogBody` contains
a `Field` label, one text `Input`, an optional error paragraph and two plain buttons - no
`Combobox` panel, no `InfoHint` disclosure. The archive confirmation is a sibling `AlertDialog`, not
a layer nested inside the `Dialog`. `useInlineLayer` is therefore correctly absent, and the source
carries a comment saying exactly that at line 420-426. No regression test is owed here.

## 6. System stages

`LeadStagesView.tsx:332-367` is a true fork: `stage.isSystem` renders a single disabled
`Lock` button (`aria-label="Etapa predefinida do app"`) **and nothing else**; the `Editar` and
`Arquivar` controls live only in the non-system branch. It mirrors `FuncoesView`. `StageDialogBody`
carries an independent defence-in-depth `isSystem` guard that disables the input and the save and
returns early from `submit`.

Mutation A proves the fork: collapsing it to the ordinary row makes
`offers no rename and no archive affordance for a system etapa` red on the `toBeNull()` assertions
for both `Editar Novo` and `Arquivar etapa Novo` (and the same pair for `Perdido`). The test also
clicks the lock and asserts no dialog opened.

## 7. Archive, never delete

- No DELETE control and no DELETE call in the diff. `grep` for `DELETE` / `.delete(` /
  `method: 'DELETE'` in the two new files hits only a comment: *"Archive (`'archived'`) and restore
  (`'active'`) are the same status write. Never a DELETE."* The shipped `leadsApi` has no delete
  verb either.
- Archived stages remain visible in a dedicated `Etapas arquivadas` panel with a per-row
  `Restaurar etapa <nome>` button that calls `onSetStageStatus({id, name, status: 'active'})`
  directly (restore is the non-destructive direction, so no confirmation). Reversible from the same
  screen. Pinned by `restores an archived etapa from the Etapas arquivadas section`; mutations D, I
  and J each make it red.
- Archiving is behind an `AlertDialog` confirmation and the status write happens ONLY from its
  action, never from the row button - proven by mutation F.

## 8. Reorder

`move()` builds `current` from the rendered ids, computes `next = reorderStageIds(current, id, delta)`,
sets `pendingOrder` (optimistic) and awaits the prop. The callback receives **the full ordered id
vector** of every active stage, first to last - the oracle asserts
`toHaveBeenCalledWith([novo.id, proposta.id, contato.id, perdido.id])` and asserts the rendered
`Nome` cells are already in the new order **while the promise is still unresolved** (the test holds
a deferred `resolve`). On rejection the catch clears `pendingOrder`, which snaps the rows back to
the props' order, plus the inline copy
`Não foi possível reordenar as etapas. A ordem anterior foi restaurada.` Mutation B confirms the
revert is what the test catches, not the message.

`pendingOrder` is cleared by a render-phase guard once the props agree, not on resolve, so the
settled order never flashes back for a frame.

**`stage_changed_at`:** the reorder callback carries only `string[]` of stage ids. Nothing in this
view sends, implies or touches a lead's `stageChangedAt`; this screen never reads a lead at all.
Acceptance 8 is untouched from here.

## 9. Duplicate name / 409 `stage_name_taken`

The API answers `409 {error:'conflict',reason:'stage_name_taken'}`
(`apps/api/src/domains/sales-ops/leads/stage-routes.ts:58,69`). The dialog's `submit` catches the
rejection, sets `Não foi possível salvar a etapa. Tente novamente.` inline next to the field, and
**does not close** - so the operator's typed name survives. This is NOT the generic server-fault
copy (`A API de vendas não respondeu corretamente. Verifique o servidor local…`), which is
unreachable from here because the rejection never escapes the dialog. Pinned by
`keeps the dialog open when the save is rejected`, which is red under both C1 (message dropped) and
C2 (dialog closed anyway).

See finding 3 for the honest limitation on the copy's precision.

## 10. Payload agreement with the SHIPPED slice-04 data layer

Read directly from `apps/web/src/sales-ops/leads/{types,api,hooks}.ts` on this base. The plan was
indeed wrong about two of these and the executor reconciled against the real code, documenting it in
the file at lines 78-82.

| view callback | view's payload | shipped type | agrees? |
|---|---|---|---|
| `onSaveStage` | `{id?: string; name: string}` | `SaveLeadStagePayload = {id?; name; status?}` | **yes** - `status` optional and deliberately never sent, so a rename cannot resurrect or renumber |
| `onSetStageStatus` | `{id; name; status}` | `SetLeadStageStatusPayload = {id; status}` (no `name`) | **yes** - `name` is the view's own confirmation-copy field; the documented wiring destructures `({id, status}) => mutateAsync({id, status})`, so nothing extra reaches `leadsApi.setStageStatus`, which sends `{status}` and nothing else |
| `onReorderStages` | `string[]` | `ReorderLeadStagesPayload = {stageIds: string[]}` (NOT `orderedIds`) | **yes** - the wiring comment is `reorderLeadStages.mutateAsync({ stageIds: orderedIds })` |

The row type read is `SalesOpsLeadStage` imported from `'./types'` (the slice-04 sibling), not
`'../types'` - correct per binding contract point 6. The view reads `id`, `name`, `isSystem`,
`position`, `status` and nothing else; it deliberately reads no `kind`. The test fixture matches the
shipped shape field for field, including `kind` and `archivedAt` which the plan's fixture omitted
(type-check passes, which is what proves it).

No mismatch. Slice 07 can wire this without editing slice 04.

## 11. `must_not_break`

| item | result |
|---|---|
| `SalesOpsApp.tsx` byte-unchanged (acceptance 18) | PASS - absent from the diff |
| `apps/web/package.json` byte-unchanged | PASS - absent from the diff, and the UI-contract test pins that no drag package is imported |
| No board, no card, no routing/navigation change, no conversion flow | PASS - `navigation.ts` absent from the diff; the file contains no route, no `resolveSalesOpsRoute` reference and no wizard call |
| No native `<select>`/`<option>`/`<datalist>` | PASS - lint green plus the source-reading contract test |
| No raw entity id rendered | PASS - `stage.id` appears only as a React `key` and as a callback argument; the only user-facing label is `stage.name` |
| No DELETE verb reached, ever | PASS - see section 7 |
| slice-04 / slice-07 files read-only | PASS - all absent from the diff |

## Findings (none blocking)

1. **`move()`'s `if (next === current) return;` guard is not independently pinned** (mutation G is
   green). It is redundant defence in depth: the arrows for the first and last rows carry
   `disabled`, and React resolves a click listener from its own props, so a disabled button it
   rendered never runs the handler. Dropping the `disabled` expression IS caught (mutation H, two
   tests). The test file documents this exact limit in a comment at lines 294-304 rather than
   leaving it to be rediscovered, and the reference-identity behaviour the guard depends on is
   pinned in the `reorderStageIds` describe. Honest and correctly recorded; nothing to fix.
2. **The archive-failure and restore-failure copy is unpinned** (mutation K is green): swallowing
   both `statusError` writes leaves all 15 tests passing. The success paths for archive and restore
   are both pinned, as is the reorder-failure copy. This is a secondary error branch, not a
   feature, but it is a real gap in DOM coverage and is recorded here.
3. **The save error copy does not distinguish `stage_name_taken` from any other failure.** An
   operator who types a duplicate stage name is told `Não foi possível salvar a etapa. Tente
   novamente.` - a retry that can never succeed. The plan prescribes this exact string and no
   acceptance criterion requires per-reason copy, so this is not a slice defect; but naming the
   duplicate ("Já existe uma etapa com esse nome.") would be a small, contained improvement worth
   filing. The load-bearing halves - readable, inline, next to the field, dialog stays open, not the
   generic API-fault copy - all hold.

## Reachability note

Everything this component decides is reachable from a DOM test, because the component is fully
prop-driven: no query, no mutation, no `apiFetch`, no token. All three callbacks are `vi.fn()`s and
the optimistic window is observed with a deferred promise. The only halves NOT reachable from here
are on the other side of the props - that `mutateAsync` really rejects on a 409, and that the server
renumbers positions without touching `stage_changed_at`. Those belong to slices 02/04/07 and are
pinned there.

## Tree state

`git status --porcelain` is empty after every mutation and at the time of writing this verdict.
No commit, no amend, no `git add`.
