# Verify (re-run) - 03 `Profissional` picker, função first

Slice: `03-profissional-picker-funcao-first`
Branch: `feat/03-profissional-picker-funcao-first`, now committed (`684dbef`, `git diff master...HEAD` works)
Verdict: **PASS**

This is a re-verify after the Gate 2 FAIL recorded in `nexo/runs/batch-20260804-props-costs/verify-03.md`.
That report found one money-critical test vacuous: `grants the função to a flagged pessoa with her FULL existing funcaoIds` used a fixture pessoa (Ana Martins) whose `contactEmail` was `null`, so the implementation's `contactEmail: person.contactEmail ?? undefined` produced `undefined`, which `toHaveBeenCalledWith`'s `toEqual` semantics match against an omitted key - the test could not have failed even if the `contactEmail` line were deleted entirely.

## 0. Files touched - still exactly the plan's five

```
CLAUDE.md
apps/web/src/sales-ops/SalesOpsApp.tsx
apps/web/src/sales-ops/__tests__/combobox-adoption.test.tsx
apps/web/src/sales-ops/__tests__/sale-wizard-funcao-costs.test.tsx
apps/web/src/sales-ops/__tests__/sale-wizard-ui-contract.test.tsx
```

Matches `files_modified` in `nexo/plans/batch-20260804-props-costs/03-profissional-picker-funcao-first.md` frontmatter exactly, no more, no fewer.

## 1. The decisive mutation, re-run myself, both directions

### RED direction - contactEmail line deleted

Deleted `contactEmail: person.contactEmail ?? undefined,` from `grantFuncaoToPerson` in `apps/web/src/sales-ops/SalesOpsApp.tsx` (lines 6399-6405 including its comment), then ran:

```
pnpm --filter @fxl-sales/web test -- src/sales-ops/__tests__/sale-wizard-funcao-costs.test.tsx
```

Real result:

```
FAIL  src/sales-ops/__tests__/sale-wizard-funcao-costs.test.tsx > sale wizard profissionais alocados > grants the funcao to a flagged pessoa with her FULL existing funcaoIds
AssertionError: expected "spy" to be called with arguments: [ { …(5) } ]
Received:
  1st spy call:
  [
    {
-     "contactEmail": "ana@exemplo.com",
      "displayName": "Ana Martins",
      "funcaoIds": [ ... ],
      ...
    },
  ]

 Test Files  1 failed | 43 passed (44)
      Tests  1 failed | 496 passed (497)
```

Exactly the one targeted test fails, with a diff that names `contactEmail` explicitly as the missing key. This is the proof the prior report demanded and could not get: the fix makes the mutation RED.

### Restore

```
git checkout -- apps/web/src/sales-ops/SalesOpsApp.tsx
git status --short
```

`git status --short` after restore shows only the pre-existing untracked directories (`.vscode/`, `nexo/plans/...`, `nexo/runs/...`) - zero tracked-file diff. Confirmed the `contactEmail` line is back verbatim (`grep -n "contactEmail: person.contactEmail"` finds it at line 6405).

### GREEN direction - line present (the fixed state)

Same test file, full `pnpm test` run below (section 2) shows `sale-wizard-funcao-costs.test.tsx` passing all 29 tests (up from 28 pre-fix: one new negative-control test, `omits contactEmail from the grant payload for a pessoa with none, rather than sending null`, was added alongside the fix).

## 2. Gates - all three GREEN, run-once, real tails

### `pnpm run lint` - exit 0

```
packages/shared-types lint: Done
packages/shared-utils lint: Done
apps/api lint$ eslint src/
apps/web lint$ eslint src/
apps/api lint: Done
apps/web lint: Done
```

### `pnpm run type-check` - exit 0

```
packages/shared-types type-check: Done
packages/shared-utils type-check: Done
apps/api type-check$ tsc --noEmit
apps/web type-check$ tsc --noEmit
apps/api type-check: Done
apps/web type-check: Done
```

### `pnpm test` - exit 0

```
apps/api test:  Test Files  33 passed (33)
apps/api test:       Tests  323 passed (323)
apps/api test: Done
apps/web test:  Test Files  44 passed (44)
apps/web test:       Tests  497 passed (497)
apps/web test: Done
build-contract: ok
```

497 web tests, up from the 496 recorded pre-fix - the new `omits contactEmail...` negative control accounts for the +1. No watcher left behind; all three commands were run-once (`vitest run`, `tsc --noEmit`).

## 3. Was anything else weakened to accommodate Ana's new e-mail? - NOT WEAKENED, judged equivalent

Giving Ana Martins a real `contactEmail: 'ana@exemplo.com'` changes her rendered option-row text in the partition test (the picker renders `description` under the name), so the prior exact `toEqual(['Bruno Entrega', 'Ana Martins'])` could no longer hold verbatim. The diff (`apps/web/src/sales-ops/__tests__/sale-wizard-funcao-costs.test.tsx`) replaces it with:

```ts
expect(options).toHaveLength(2);
expect(options[0]).toBe('Bruno Entrega');
expect(options[1]?.startsWith('Ana Martins')).toBe(true);
```

Judgement: **equivalent in strength, not a weakening.**

- `toHaveLength(2)` preserves EXHAUSTIVENESS - exactly two options, nothing extra can sneak in (e.g. `Zulmira Inativa` reappearing would fail this).
- `options[0]` / `options[1]` preserve ORDER positionally, same as the array-literal `toEqual` did.
- `startsWith` is only applied to the one element whose full text now legitimately contains extra data (the e-mail description); `options[0]` for Bruno (who has `contactEmail: null` in the fixture) still uses an exact `toBe`.

This matches the brief's own acceptance bar: "a `startsWith`/prefix check that preserves ORDER and EXHAUSTIVENESS is acceptable; one that merely checks membership is a weakening." The old `not.toContain('Zulmira Inativa')` / `not.toContain('Digite manualmente')` guards are also retained verbatim beneath it. Nothing here reads as a membership-only check - it is the same claim, restated to tolerate one legitimately-widened string.

I also re-ran the fixture-email mutation implicitly via the section-1 mutation: the failure diff in section 1 shows the object comparison operates on the full literal (`toHaveBeenCalledWith` with no `objectContaining`), so the strength of the money assertion itself is unchanged - only the fixture value changed, from a null email (vacuous) to a real one (decisive).

## 4. Spot-check of the other seven behaviour lines from the prior report

Re-read the full `git diff master...HEAD -- apps/web/src/sales-ops/SalesOpsApp.tsx` (non-test) and the CLAUDE.md diff; nothing in either changed since the prior verify's working-tree diff except that they are now committed. Specifically re-checked by reading the diff directly (not re-mutation-tested, as the brief allows):

1. **Column order** (behaviour 1) - `<span>Função no projeto</span>` now precedes `<span>Profissional</span>` in the header grid diff; row body wrapper reordered to match. Unchanged from prior report.
2. **Partition/grouping** (behaviour 2) - `professionalPersonOptions(people, rowFuncaoId)` is present verbatim, tagging non-carriers with `group: FUNCAO_GRANT_GROUP_LABEL` (`'Adicionar a esta função'`), kept separate from `personOptions` so vendedor/finder pickers cannot inherit a grant row. Unchanged.
3. **Grant via ordinary mutation** (behaviour 3) - `assignFuncaoToPerson` in `SalesOpsApp` calls `savePerson.mutateAsync(payload)` where `savePerson = useSaveSalesOpsPerson()`; wired through `onAssignFuncao` prop down to `SaleWizardDialogBody`. No new `fetch` in the diff. Unchanged.
4. **MONEY: full funcaoIds set** (behaviour 4) - `funcaoIds: [...person.funcaoIds, funcaoId]` in `grantFuncaoToPerson`, asserted via the full-object `toHaveBeenCalledWith` plus a standalone `toContain(vendedorFuncaoId)`. Unchanged and still proven by mutation in the prior report (not re-run here, out of scope for this pass).
5. **MONEY: contactEmail** (behaviour 5) - now PASS, per sections 1-3 above.
6. **No write when already carrying the função** (behaviour 6) - `selectProfessionalPerson` still returns early via `if (person.funcaoIds.includes(rowFuncaoId)) return;` before calling `grantFuncaoToPerson`. Test `does not write when the pessoa already carries the row s funcao` unchanged in the diff. Unchanged.
7. **Legacy free-text row stays editable** (behaviour 7) - `professionalPersonOptions` groups nobody when `rowFuncaoId === ''`, and the lock condition (read in the diff around the `PROFISSIONAL` Combobox) still keys off `!professional.funcaoId && !professional.funcaoName.trim()`. Test `keeps a legacy free-text funcao row s pessoa picker open and ungrouped` unchanged. Unchanged.
8. **Inactive pessoas excluded** (behaviour 8) - `allocatablePeople` untouched by this diff (not present in the `SalesOpsApp.tsx` diff hunks at all), still the sole upstream filter; `toHaveLength(2)` in the partition test still makes a stray `Zulmira Inativa` appearance fail the count. Unchanged.

All seven hold; nothing beyond the fixture/assertion described in section 3 changed in the test files versus what the prior report already graded PASS.

## 5. CLAUDE.md, em dash, native pickers

- `git diff master...HEAD -- CLAUDE.md` matches the prior report's description exactly (the `isCollaboratorPerson` tombstone rewrite and the `sales_ops_sale_professionals` block gaining função-first, lock, grant, and dropped-row rules). No new inaccuracy introduced by the fix - the `contactEmail` sentence in CLAUDE.md ("The payload is her EXISTING `funcaoIds` PLUS the new one and must also carry `contactEmail`...") was already true of the implementation and remains true.
- `git diff master...HEAD | grep '—'` - zero matches. No em dash anywhere in the diff.
- `git diff master...HEAD | grep -E '^\+.*(<select|<option|<datalist)'` - zero matches. No native picker introduced.

## Verdict: PASS

- Mutation proven RED with real counts (1 failed / 496 passed on the broken implementation, diff naming `contactEmail` as the missing key), then the line restored with `git status --short` showing zero tracked-file diff.
- All three gates green, run-once, real tails captured above (lint exit 0, type-check exit 0, test: api 323/323, web 497/497, build-contract ok).
- The partition test's `toEqual` -> `toHaveLength` + positional `toBe`/`startsWith` change is judged equivalent in strength (order and exhaustiveness both preserved), not a weakening.
- The other seven behaviour lines from the prior report were spot-checked against the diff and still hold.
- Diff stays inside the plan's five `files_modified`; no em dash, no native `<select>`/`<option>`/`<datalist>` added.
