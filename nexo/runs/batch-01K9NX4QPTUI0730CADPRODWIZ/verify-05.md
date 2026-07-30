# Verify 05 - wizard função inline create

**Verdict: PASS**

Branch `feat/05-wizard-funcao-create`, uncommitted working tree.
Diff touches `CLAUDE.md`, `apps/web/src/sales-ops/SalesOpsApp.tsx`, `apps/web/src/sales-ops/__tests__/sale-wizard-funcao-costs.test.tsx`, `apps/web/src/sales-ops/__tests__/sale-wizard-ui-contract.test.tsx`.
176 insertions, 32 deletions.

## Commands

| Command | Result |
| --- | --- |
| `pnpm test` (web) | **371 passed / 39 files** (baseline 368/39, +3) |
| `pnpm test` (api unit) | **300 passed / 29 files** (baseline 300/29, unchanged) |
| `pnpm run lint` | clean, `apps/api` and `apps/web` both Done with no output |
| `pnpm run type-check` | clean, all four projects Done |

No `.skip`, `.only` or `todo(` anywhere in the diff.
Zero em dash characters in the diff.

## Acceptance criteria

Met.
`apps/web/src/sales-ops/SalesOpsApp.tsx:6944` wires `onCreate` on the `Função do profissional N` Combobox, and the created função is selectable on that row immediately via the local `createdFuncoes` buffer merged into `allocatableFuncoes` (line 5096).
The buffer is deduped by id against `bootstrap.funcoes`, so the eventual refetch cannot double a row.

## The decisive check - optimistic-id invariant

All three defences are present and none is a no-op.

**Defence 1 - the create handler returns the API response row.**
`createFuncaoByName` at `SalesOpsApp.tsx:801` returns `const { funcao } = await saveFuncao.mutateAsync(...)`.
`useSaveSalesOpsFuncao` (`apps/web/src/sales-ops/hooks.ts:198-207`) builds `useAppMutation` whose `mutationFn` is `salesOpsApi.saveFuncao(...)`, so `mutateAsync` resolves with the HTTP response body.
The optimistic patch is spread in as `onMutate`/`onSuccess` handlers and does not substitute the resolved value.
Genuine, not a no-op.

**Defence 2 - the wizard renders from `persistedBootstrap`.**
`SalesOpsApp.tsx:1425` passes `bootstrap={persistedBootstrap}`, which is `withoutOptimisticRows(bootstrap)` (line 738).
The one surface that deliberately re-admits optimistic funções, `funcoesBootstrap` (line 746), is the funções cadastro only and is not passed to the wizard.
Genuine.

**Defence 3 - local `!isOptimisticId(...)` filter.**
`SalesOpsApp.tsx:5100`, inside `allocatableFuncoes`: `.filter((funcao) => funcao.status === 'active' && !isOptimisticId(funcao.id))`.
Proven non-vacuous by the new test `never offers an optimistic funcao row in the profissional picker`, which injects `optimistic:funcoes:Arquiteto` straight into the `bootstrap` prop and asserts the label is absent while a positive control (`Desenvolvedor`) is still present.
Against the reverted source that assertion fails with `expected [ 'Arquiteto Otimista', ...(3) ] to not include 'Arquiteto Otimista'`, i.e. the placeholder really did leak before.

**Attempt to defeat defence 3 - both write paths.**
`funcaoId` is written in exactly one function, `applyFuncaoToProfessional` (line ~5810), reached from two callers.

- Select path (`onChange`, line 6938): `value` can only be an id the Combobox was given in `options`, and `options` is built from the already-filtered `allocatableFuncoes` (line 6949). Covered by defence 3.
- Create path (`createFuncaoForProfessional`, line ~5836): calls `applyFuncaoToProfessional(index, created.id, created.name)` with the row returned by `onCreateFuncao`, **without** re-checking `isOptimisticId`. In-repo this id is the API response row (defence 1), so no placeholder can arise.

No path reaches the save payload with a placeholder.
The payload builder at line 5951 passes `professional.funcaoId` straight through, and the new test `sends the real server funcaoId for an inline-created funcao` asserts the emitted `payload.professionals[0].funcaoId` is the server uuid and does not match `/^optimistic:/`.

Prefill on the edit path reads `bootstrap.saleProfessionals` (line 4950), i.e. persisted server rows, so it cannot introduce one either.

### Finding (advisory, non-blocking)

The create path is the one `funcaoId` writer not covered by defence 3.
A hypothetical EXTERNAL caller of the exported `SaleWizardDialog` that passed an `onCreateFuncao` resolving with an optimistic row would set `funcaoId` to that placeholder; the row would then be filtered out of `allocatableFuncoes` but `valueLabel={professional.funcaoName}` would still render the name, so the leak would be invisible on screen and would reach the payload.
This is not reachable from any in-repo caller and requires a caller that itself breaks the contract the create handler documents, so it does not block.
A one-line `if (isOptimisticId(created.id)) return;` inside `createFuncaoForProfessional` would close it and make the stated rationale for defence 3 hold uniformly across both write paths.

## Scope boundaries

No violation.

- `ProductDialog` `Custos padrão por função` picker (`SalesOpsApp.tsx:3926-3942`) has `onChange` but no `onCreate`. Unchanged by this diff.
- Wizard `Vendedor` picker (line 6076) and `Finder` picker (line 6099): no `onCreate`. Unchanged.
- The complete `onCreate=` inventory in the file is 7 sites: área in ProductDialog (3626), função in PersonDialog (4665), cliente (6060), item área (6217), produto (6360), item área/produto (6912) and the new função-do-profissional (6944). Exactly one added.

The `CLAUDE.md` edit is a single added line under `UI Controls`.
It is accurate: the wizard picker does now have a create row, the stated reason ("a função needs only a name") matches the Pessoa dialog precedent it cites, and it explicitly reaffirms rather than weakens the two exclusions.
It follows the one-sentence-per-line convention and introduces no em dash.

## Adversarial checks

**Revert-the-source oracle.**
Backed up `SalesOpsApp.tsx` (sha256 `d0484a0c...4aee92`), ran `git checkout --` on that file only, left the tests in place, ran both touched suites.
Result: `Tests 4 failed | 20 passed (24)`, failing for exactly the right reasons.

- `offers an inline create row...` - `expected undefined to be '+ Criar nova função "Arquiteto"'` (no create row rendered)
- `sends the real server funcaoId...` - fails at the same missing create row
- `never offers an optimistic funcao row...` - `expected [ 'Arquiteto Otimista', ...(3) ] to not include 'Arquiteto Otimista'`
- `keeps every picker on the Combobox...` - `expected 'import {...' to contain 'createFuncaoForProfessional'`

Restored from the backup; sha256 matches byte for byte, and `git status --porcelain` plus `git diff --stat` are identical to the pre-check state (4 modified files, 176/32).

**Are the tests real?**
Yes, not tautologies.
The two behavioural tests drive the actual DOM: they open the trigger, type into the panel's search input, assert the create row's exact text `+ Criar nova função "Arquiteto"`, click it, and then assert either the trigger's rendered label or the real `onSave` payload.
The first carries a negative control (no create row on an empty query) and asserts the empty message is not what rendered instead; the third carries a positive control.
The payload test asserts `funcaoId`, a negative regex against `optimistic:`, and `role` (the snapshot mirror).
The one source-substring assertion in `sale-wizard-ui-contract.test.tsx` is correctly written as a count of 2 for `onCreateFuncao={createFuncaoByName}` rather than a `toContain`, so deleting the wizard's wiring while keeping the PersonDialog's would fail it - and the accompanying `createFuncaoForProfessional` check did fail against the reverted source.

**Housekeeping.**
The extracted `applyFuncaoToProfessional` is behaviour-preserving against the deleted inline `setProfessionals` block: same `costManual` guard, same `funcaoCostBasis.get(...)?.cents ?? 0` re-derivation, same `funcao?.name ?? ''` fallback at the call site.
No process was left running.
