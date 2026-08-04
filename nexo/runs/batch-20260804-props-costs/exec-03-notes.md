# exec-03 - `03-profissional-picker-funcao-first`

Branch: `feat/03-profissional-picker-funcao-first`. No commit, no branch operation.

## Outcome

`PASS`. Oracle went red then green; `pnpm run lint`, `pnpm run type-check` and
`pnpm --filter @fxl-sales/web test` are all green (44 files, 496 tests).

## Red evidence

First run of the new oracle, before any implementation change:

| Test | Failure |
| --- | --- |
| `partitions the profissional picker by the row s funcao and flags the rest` | `expected [ 'Ana Martins', 'Bruno Entrega' ] to deeply equal [ 'Bruno Entrega', 'Ana Martins' ]` |
| `locks the profissional picker until the row names a funcao` | `expected 'Ana Martins' to be 'Selecione a função primeiro'` |
| `grants the funcao to a flagged pessoa with her FULL existing funcaoIds` | `expected "spy" to be called 1 times, but got 0 times` |
| `blocks advancing past Custos e margem when a profissional row has no funcao` | did not contain `Selecione a pessoa de cada profissional alocado.` |
| UI-contract `puts FUNÇÃO NO PROJETO ahead of PROFISSIONAL and gates the person picker on it` | header order regex did not match |
| combobox-adoption `lets a name-only profissional survive through the picker` | `expected 'Ana Martins' to be 'Selecione a função primeiro'` |

Two of the plan's five new tests passed at Red rather than failing, and that is
correct rather than a gap: `does not write when the pessoa already carries the
row's função` asserts `not.toHaveBeenCalled()`, which is trivially true while no
grant path exists at all, and `keeps a legacy free-text função row's pessoa picker
open and ungrouped` asserts the ABSENCE of a lock and of grouping, neither of which
existed yet. Both are guards against the change regressing, not drivers of it. The
three that drive the change all failed for the stated reasons.

## Mutation check on the two money-critical assertions

The task singled these out, so both were proven to bite. With
`funcaoIds: [...person.funcaoIds, funcaoId]` reduced to `[funcaoId]` AND the
`contactEmail` key deleted from the payload, the suite went to
`1 failed | 495 passed`, failing exactly on
`grants the funcao to a flagged pessoa with her FULL existing funcaoIds` with
`expected "spy" to be called with arguments: [ { …(5) } ]`. The implementation was
restored from a scratchpad copy and re-verified. The assertion is a whole-object
`toHaveBeenCalledWith`, never `objectContaining`, which is what makes a dropped
`contactEmail` key fail rather than pass silently.

## Where the plan disagreed with the real code

1. **Line numbers, as forecast.** Every site had drifted roughly +26 lines from the
   plan's `master`-tip numbers. Each was located by surrounding code and identifier
   name instead. Every one of them matched the plan's description of it exactly -
   the header `<span>`s, the row cell order, `allocatablePeople`, the
   `+ profissional` seed, `professionalsValid`, the single step-3 error bar,
   `createPayload`'s professionals map, `applyFuncaoToProfessional`, the three prop
   lists, `createFuncaoByName` and the `<SaleWizardDialog>` render. Nothing had to
   be guessed at.

2. **`expect(source).toContain('professionalPersonOptions(allocatablePeople, professional.funcaoId)')`
   cannot exist.** At the JSX indent of that prop the flat call is 105 columns and
   `prettier.config.js` sets `printWidth: 100`, so the call is necessarily broken
   across lines. Hoisting it to a `const` inside the `map` callback does not help
   either - at 24 spaces of indent the shortest such binding is 119 columns. The
   assertion was replaced with the whitespace-tolerant

   ```
   /options=\{professionalPersonOptions\(\s*allocatablePeople,\s*professional\.funcaoId,?\s*\)\}/
   ```

   which pins the identical fact: the person picker's options come from
   `professionalPersonOptions` fed by the ROW's `funcaoId`, not from the shared
   `personOptions` that the vendedor and finder pickers use. The comment above it in
   the test says why it is a regex. Nothing else in the plan's UI-contract block was
   changed, and every one of its `not.toContain` guards still passes as the plan
   predicted.

3. **The oracle's spy needed an explicit type.** The plan's
   `const onAssignFuncao = vi.fn(async () => null);` infers a ZERO-argument spy, so
   `onAssignFuncao.mock.calls[0]![0]` fails `tsc` with
   `TS2493: Tuple type '[]' of length '0' has no element at index '0'`. Both spies
   are now `vi.fn<(payload: SavePersonPayload) => Promise<SalesOpsPerson | null>>(async () => null)`.
   This strengthens the assertion rather than weakening it: the payload argument is
   now type-checked against `SavePersonPayload` as well as asserted at runtime.

4. **CLAUDE.md sentence-per-line.** Edit 3 was written one sentence per physical
   line, matching both the global markdown instruction and its immediate neighbours
   in the Propostas domain section. Edit 2 was left as a single physical line,
   matching its own neighbours in Pessoas e Funções, where every bullet is one line.
   The wording of all three edits is the plan's verbatim.

5. **`isCollaboratorPerson` was already gone,** exactly as the plan's own preamble
   said. The tombstone comment is at `apps/web/src/sales-ops/SalesOpsApp.tsx`
   immediately after `hasFuncao`. It was not resurrected, and CLAUDE.md edits 1 and
   2 land the correction that was stale before this slice started.

## Test churn, itemised

- `sale-wizard-funcao-costs.test.tsx`: the `offers every active pessoa...` test was
  REWRITTEN rather than deleted - its subject ("no função filter at all") is the
  precise rule this slice replaces. Its two negatives (`Zulmira Inativa`,
  `Digite manualmente`) were folded into the new partition test, so nothing it
  proved was lost. Five new tests added. Five tests had their `pickOption` pair
  swapped to função-first. `blocks advancing...` gained the pessoa-bar assertion and
  a person pick. `refuses an optimistic funcao handed back by the create handler`
  was restructured as the plan specified, and gained a positive control the old
  shape lacked: the row must still read `Desenvolvedor` after the refusal, and the
  saved `funcaoId` must be `devFuncaoId`, not merely non-optimistic.
- `sale-wizard-ui-contract.test.tsx`: one new test. No existing assertion touched.
- `combobox-adoption.test.tsx`: the `lets a name-only profissional survive through
  the picker` test now asserts the lock and the placeholder where it asserted the
  removed `Ana Martins` seed, and the `Prestador` pick moved ahead of the person
  interaction. Its `onSave` payload assertion is unchanged - a typed name still
  carries no `personId`, so no grant fires.
- `sale-wizard-edit.test.tsx` was not touched and passes: it addresses the row only
  through aria-labels, which survive the DOM reorder byte-identical.

## Deliberately not done

No file under `apps/api/` and no migration, per the plan's section 2h and 4. No
change to `personOptions`, to the `Combobox` primitive, to `combobox-filter.ts`, to
the cost cell or to `applyFuncaoToProfessional`.
