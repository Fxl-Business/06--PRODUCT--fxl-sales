# Verify - 03 `Profissional` picker, função first

Slice: `03-profissional-picker-funcao-first`
Branch: `feat/03-profissional-picker-funcao-first`
Verdict: **FAIL** (one money-critical test proven vacuous by mutation; everything else holds)

## 0. State of the branch

`git diff master...HEAD` is EMPTY: `HEAD` and `master` are the same commit (`106ed61`), and the slice is entirely UNCOMMITTED working-tree changes.
Everything below was therefore verified against `git diff master` (working tree vs `master`).

Files touched, exactly the five the plan declares under `files_modified`, no more:

```
CLAUDE.md
apps/web/src/sales-ops/SalesOpsApp.tsx
apps/web/src/sales-ops/__tests__/combobox-adoption.test.tsx
apps/web/src/sales-ops/__tests__/sale-wizard-funcao-costs.test.tsx
apps/web/src/sales-ops/__tests__/sale-wizard-ui-contract.test.tsx
```

## 1. Gates - all three GREEN

`pnpm run lint`, exit 0:

```
packages/shared-types lint: Done
packages/shared-utils lint: Done
apps/api lint$ eslint src/
apps/web lint$ eslint src/
apps/api lint: Done
apps/web lint: Done
```

`pnpm run type-check`, exit 0:

```
apps/api type-check$ tsc --noEmit
apps/web type-check$ tsc --noEmit
apps/api type-check: Done
apps/web type-check: Done
```

`pnpm test`, exit 0:

```
apps/web test:  Test Files  44 passed (44)
apps/web test:       Tests  496 passed (496)
apps/web test:    Duration  8.42s
build-contract: ok
```

All three run-once. No watcher left behind.

## 2. Oracle proof - PROVEN RED

`git worktree add` of `master` into the scratchpad, `node_modules` symlinked from the main checkout, ONLY the test patch (`git diff master -- 'apps/web/src/sales-ops/__tests__/*'`) applied on top of the original implementation.

Result against the unmodified `master` implementation:

```
 Test Files  3 failed (3)
      Tests  6 failed | 49 passed (55)
```

The six that go red:

- `sale-wizard-ui-contract` > puts FUNÇÃO NO PROJETO ahead of PROFISSIONAL and gates the person picker on it
- `sale-wizard-funcao-costs` > partitions the profissional picker by the row s funcao and flags the rest
- `sale-wizard-funcao-costs` > locks the profissional picker until the row names a funcao
- `sale-wizard-funcao-costs` > grants the funcao to a flagged pessoa with her FULL existing funcaoIds
- `sale-wizard-funcao-costs` > blocks advancing past Custos e margem when a profissional row has no funcao
- `combobox-adoption` > lets a name-only profissional survive through the picker

Then the implementation patch was applied in the same worktree: `Test Files 3 passed (3) / Tests 55 passed (55)`.

Two of the new tests are NEGATIVE controls and therefore pass on `master` too (`does not write when the pessoa already carries the row s funcao`, `keeps a legacy free-text funcao row s pessoa picker open and ungrouped`).
Rather than accept them on faith, both were mutation-tested against the new implementation - see section 4. Both are real.

Worktree removed (`git worktree list` shows only the main checkout; `git status` shows only the five modified files).

## 3. Behaviour grading

| # | Behaviour | Verdict |
|---|---|---|
| 1 | FUNÇÃO NO PROJETO first, PROFISSIONAL second, header AND row | **PASS** |
| 2 | Carriers list plain, non-carriers under a visible `Adicionar a esta função` group | **PASS** |
| 3 | Grant fires through the ordinary person mutation, not a bespoke fetch | **PASS** |
| 4 | MONEY: grant payload carries EXISTING `funcaoIds` PLUS the new one, asserted exactly | **PASS** |
| 5 | MONEY: grant payload carries `contactEmail`, with a test that catches its absence | **FAIL** |
| 6 | No write when the pessoa already carries the função | **PASS** |
| 7 | Legacy free-text `funcaoName` row stays editable | **PASS** |
| 8 | Inactive pessoas still excluded | **PASS** |

### 1. Column order - PASS

The header `<span>`s are reordered in place (`SalesOpsApp.tsx`, `Profissionais alocados` header grid): `Função no projeto` then `Profissional`, with `Custo alocado` and the trash column unchanged.
The row body is reordered the same way - the `flex flex-col gap-1` wrapper holding the função `Combobox` is now the first cell and the `Profissional` `Combobox` the second.
The four-column grid template is unchanged, so no layout drift.
Pinned by a source assertion that also carries its own negative (`not.toMatch` on the old order), and that assertion is one of the six proven red on `master`.

### 2. Partition and grant grouping - PASS

New module-level `professionalPersonOptions(people, rowFuncaoId)` beside `personOptions`; it tags every pessoa who does NOT hold `rowFuncaoId` with `group: FUNCAO_GRANT_GROUP_LABEL` (`'Adicionar a esta função'`), and tags nobody when `rowFuncaoId` is `''`.
`group` is an existing `ComboboxOption` field - `combobox.tsx` renders a headingless group as a bare `Fragment` and a labelled one as `role="group"`, so the assertion `optionRow('Ana Martins').closest('[role="group"]')` is genuinely structural, not a text match.
Deliberately a separate function from the shared `personOptions`, so the vendedor and finder pickers cannot grow a grant row.

The test asserts `options` equals `['Bruno Entrega', 'Ana Martins']` - order-sensitive, and alphabetically Ana sorts first, so the ordering assertion IS the partition rather than an accident.

Additionally the picker is `disabled` with the placeholder `Selecione a função primeiro` until the row names a função, and the test proves the lock is real by clicking the trigger and asserting zero `[role="option"]` nodes, plus a positive control that naming a função re-enables the same trigger.

### 3. Grant goes through the ordinary mutation - PASS

`SaleWizardDialogBody` takes an optional `onAssignFuncao` prop; `SalesOpsApp` wires it to `assignFuncaoToPerson`, which calls `savePerson.mutateAsync` where `const savePerson = useSaveSalesOpsPerson()`.
`hooks.ts:117-134` confirms that hook carries `invalidates: [queryKeys.salesOps.all]` plus `useOptimisticBootstrapWrite('people', ...)` and gets its token via `requireToken(getToken)`.
So invalidation, the optimistic bootstrap patch and the token guard are all inherited. No `fetch` was added anywhere in the diff.

### 4. MONEY - full existing `funcaoIds` plus the new one - PASS

Implementation: `funcaoIds: [...person.funcaoIds, funcaoId]`.

The test uses `toHaveBeenCalledWith` on the WHOLE object literal (no `objectContaining`) with `funcaoIds: [vendedorFuncaoId, devFuncaoId]`, and adds a second explicit `toContain(vendedorFuncaoId)`.

Proven non-vacuous by mutation. Replacing the spread with `funcaoIds: [funcaoId]` in the worktree:

```
FAIL src/sales-ops/__tests__/sale-wizard-funcao-costs.test.tsx > sale wizard profissionais alocados > grants the funcao to a flagged pessoa with her FULL existing funcaoIds
 Tests  1 failed | 27 passed (28)
```

### 5. MONEY - `contactEmail` - FAIL (test is vacuous)

The IMPLEMENTATION is correct: `contactEmail: person.contactEmail ?? undefined` is present, and `salesOpsApi.savePerson` `JSON.stringify`s the body, so a pessoa with a stored address re-sends it and only an already-null address omits the key.
The server side is exactly as the brief describes - `service.ts:1276` sets `contactEmail: data.contactEmail || null` unconditionally on the update path, with a comment spelling out that a caller sending `funcaoIds` must send `contactEmail` alongside.

The TEST cannot catch its absence. The fixture pessoa Ana Martins has `contactEmail: null` (`sale-wizard-funcao-costs.test.tsx:144`), so the implementation produces `contactEmail: undefined` and the assertion reads `contactEmail: undefined`.
`toHaveBeenCalledWith` uses `toEqual` semantics, under which an expected property whose value is `undefined` matches an argument object that omits the key entirely. The full-object assertion is therefore no stronger than an `objectContaining` on this one field.

Proven by mutation. Deleting the whole `contactEmail: person.contactEmail ?? undefined,` line from `grantFuncaoToPerson` in the worktree:

```
 Test Files  1 passed (1)
      Tests  28 passed (28)
```

Zero tests fail. The regression the brief names - the grant silently clearing the pessoa's e-mail - ships green.
The comment above the assertion explicitly claims the opposite ("only a full-object assertion fails on it"), so the prose is also wrong on this point.

Fix is small and local: give the fixture pessoa a real `contactEmail` (e.g. `'ana@exemplo.com'`) and assert that string, or switch the call assertion to `toStrictEqual` on `onAssignFuncao.mock.calls[0][0]` with the key present. Either makes the mutation red.

### 6. No write when she already carries the função - PASS

`selectProfessionalPerson` returns early on `person.funcaoIds.includes(rowFuncaoId)`.
The test picks `Bruno Entrega` (who holds `devFuncaoId`) under `Desenvolvedor` and asserts `onAssignFuncao` was never called.

Proven non-vacuous by mutation. Deleting the `includes` guard:

```
FAIL ... > does not write when the pessoa already carries the row s funcao
 Tests  1 failed | 27 passed (28)
```

### 7. Legacy free-text row still editable - PASS

`personPickerLocked = !professional.funcaoId && !professional.funcaoName.trim()`, so a stored row carrying a `funcaoName` snapshot with a null `funcaoId` keeps its picker enabled, and `professionalPersonOptions` groups nobody when `rowFuncaoId` is `''`.
The test renders the edit path and asserts the trigger is not disabled and `groupHeadingTexts()` is `[]`.

Proven non-vacuous by mutation. Narrowing the lock to `!professional.funcaoId`:

```
FAIL ... > keeps a legacy free-text funcao row s pessoa picker open and ungrouped
 Tests  1 failed | 27 passed (28)
```

### 8. Inactive pessoas excluded - PASS

`allocatablePeople` is untouched by this diff and still filters `status === 'active'`; the partition happens downstream in `professionalPersonOptions`, so nothing widened the source list.
The partition test's `toEqual(['Bruno Entrega', 'Ana Martins'])` is exhaustive and would fail if `Zulmira Inativa` (active `false`, holds `devFuncaoId`, so she would otherwise be a CARRIER and land in the ungrouped bucket) appeared; the explicit `not.toContain('Zulmira Inativa')` is retained on top.

### Incidental changes, judged sound

- A fresh `+ profissional` row no longer seeds `allocatablePeople[0]`. This is required by the lock (the picker is disabled at that moment, so a wrong seed could not be corrected in place) and fixes a real pre-existing defect: the first pessoa alphabetically was silently allocated.
- `professionalsValid` splits into `professionalFuncoesValid` and `professionalPeopleValid`, with a second step-3 error bar `Selecione a pessoa de cada profissional alocado.`; the existing gate test was extended to cover both bars and their clearing.
- `createPayload` drops a professional row whose `personName` is blank. Reachable only via `Salvar rascunho` (which does not gate on professionals), and the API's `personName: z.string().min(1)` would 400 on such a row, so the drop converts an opaque 400 into a silent no-op on a row that carries nothing addressable. Acceptable, though it is a silent drop rather than a message.

## 4. Coverage integrity - PASS

`it()` counts, `master` to now: `sale-wizard-funcao-costs` 24 to 28, `sale-wizard-ui-contract` 8 to 9, `combobox-adoption` 18 to 18. Net +5, nothing lost.

Exactly ONE `it()` title disappears, and it is precisely the sanctioned one:

```
- it('offers every active pessoa in the profissional picker and no longer offers Digite manualmente'
```

replaced by `partitions the profissional picker by the row s funcao and flags the rest`, which is the same subject re-stated under the new rule and keeps both of the old test's surviving guards (`not.toContain('Zulmira Inativa')`, `not.toContain('Digite manualmente')`).

Only three `expect` lines were removed across all three files:

```
- expect(comboboxText('Profissional 1')).toBe('Ana Martins');
- expect(options).toContain('Ana Martins');
- expect(options).toContain('Bruno Entrega');
```

The two `toContain`s are strictly superseded by the order-sensitive `toEqual(['Bruno Entrega', 'Ana Martins'])` in the same test. The seed assertion is superseded by `toBe('Selecione a função primeiro')` plus `disabled === true` in `combobox-adoption`, which is a stronger claim about the same moment.

Everything else in the test diff is either an addition or a mechanical reordering of `pickOption('Função...')` ahead of `pickOption('Profissional 1', ...)`, forced by the lock. Two tests were strengthened rather than merely adjusted:

- the step-3 gate test now asserts each bar appears and clears independently;
- the refused-inline-create test gained a real positive control (`toBe('Desenvolvedor')` and `payload.professionals[0].funcaoId === devFuncaoId`) where it previously only asserted the row had not adopted the placeholder.

No test was deleted or weakened to go green.

## 5. CLAUDE.md - PASS

Both edits match the code as written.

- The `isCollaboratorPerson` block is rewritten to say it is GONE from `apps/web` with a tombstone comment. Verified: `grep` finds zero call sites and zero declaration, only the tombstone. The old text claiming "exactly one call site left, the proposta wizard's Profissional picker" was already stale on `master` and is now correct.
- The `sales_ops_sale_professionals` block gains the new rules: função-first column order, the lock and its placeholder, the `Adicionar a esta função` group, the grant going through `useSaveSalesOpsPerson`, the existing-set-plus-one payload, the `contactEmail` requirement, the legacy-row exception, the removed seed and the new error message. Each of these is a true statement about the diff.
- The stale filename `sale-wizard-ui-contract.test.ts` is corrected to `.tsx`.

No native `<select>` / `<option>` / `<datalist>` appears in any added line (lint's `no-restricted-syntax` also passes). No em dash was added anywhere in the diff.

## 6. Security - PASS

- The grant reuses `salesOpsApi.savePerson`, i.e. `PATCH /api/v1/sales-ops/people/:id` through `apiFetch` with a Hub bearer token from `requireToken(getToken)`. No new endpoint, no unauthenticated path.
- The payload is `{id, displayName, contactEmail, status, funcaoIds}`. No `orgId`, `userId`, `accountId` or `workspaceId` is sent, and `savePerson` strips `id` into the URL.
- Cross-org grants are impossible server-side: `updatePerson` runs inside `withTenant(db, orgId, ...)` with `orgId` from the request context, the person lookup is `and(eq(orgId), eq(id))`, and `resolvePersonFuncoes` -> `selectFuncoesByIds(tx, orgId, ids)` returns `'unknown_funcao'` unless every id resolves under that org filter. The client's ids are validated, never trusted.
- `funcaoIds` is a full set replacement server-side (`replacePersonFuncoes` deletes then reinserts), which is exactly why behaviour line 4 matters; the implementation honours it.

## Verdict: FAIL

Three gates green, oracle proven red on six tests, seven of eight behaviour lines hold with four of them independently confirmed by mutation, coverage integrity clean, CLAUDE.md accurate, security sound.

The single blocking defect is behaviour line 5. `contactEmail` is present and correct in the implementation, but the test that is supposed to protect it cannot fail: the fixture pessoa's e-mail is `null`, so the expected value is `undefined`, and `toHaveBeenCalledWith` matches an omitted key against an expected `undefined`. Deleting the field from the implementation leaves all 28 tests green - demonstrated, not inferred.

The brief makes this an explicit FAIL condition ("Confirm both the implementation and a test that would catch its absence"), and the risk is exactly the kind this slice was told to guard: a proposta-side convenience write silently blanking a cadastro field. The fix is a one-line fixture change plus the matching assertion; nothing structural needs to move.
