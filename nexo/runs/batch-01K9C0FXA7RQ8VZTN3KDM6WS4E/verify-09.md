# Verify (Gate 2) - slice 09-pessoas-funcoes-web

Branch: `feat/09-pessoas-funcoes-web`, one commit `f9d6077` on top of `master` (`04388b7`).
Verdict: **FAIL** - one silent behaviour change in an admin picker, plus a coupled `CLAUDE.md` sentence that asserts an equivalence the code does not hold.

Everything else in this slice is clean, and the engineering quality is high.
The blocking findings are narrow and cheap to fix.

## 1. Gates

All four run from the repo root, all exit 0.

| Gate | Exit | Result |
| --- | --- | --- |
| `pnpm run lint` | 0 | clean |
| `pnpm run type-check` | 0 | clean |
| `CI=true pnpm test` | 0 | clean |
| `pnpm run build` | 0 | built in 1.45s |

Test totals against the branch-point baseline:

| Package | Baseline | Now | Delta |
| --- | --- | --- | --- |
| apps/web | 31 files / 220 tests | 32 files / 238 tests | +1 file, +18 tests |
| apps/api | 27 / 283 | 27 / 283 | unchanged |
| packages/shared-utils | 1 / 17 | 1 / 17 | unchanged |

Nothing was removed.
I also compared per-file `it(`/`test(` counts and `expect(` counts for every modified test file between `master` and the branch: no file lost a single test or a single assertion.
No `.skip`, `.only` or `.todo` anywhere in `apps/web/src` or `apps/api/src`.

## 2. Meus dados and tático (highest-stakes check)

Confirmed intact. I wrote a throwaway probe (`zz-verify-probe.test.tsx`, since deleted) that drives the real `SalesOpsApp` through the router and asserts the resolved pathname plus the `<h1>` for each route:

- `/meus-dados/vendedores` (`seller`) - stays at that path, heading `Meu painel`
- `/meus-dados/comissoes` (`seller`) - stays, heading `Minhas comissões`
- `/meus-dados/finders` (`finder`) - stays, heading `Meu painel`
- `/meus-dados/vendas` (`finder`) - stays, heading `Minhas indicações`
- `/meus-dados/vendedores` and `/meus-dados/finders` for `['admin','seller','finder']` - both stay, both `Meu painel`
- `/tatico/dashboard` - `Visão geral`; `/operacional/vendas` - `Propostas`; `/operacional/comissoes` - `Comissões`
- all six cadastros screens - `produtos`, `areas`, `clientes`, `pessoas`, `funcoes`, `geral` resolve and render their own heading

### The alias guard is load-bearing

I reproduced the mutation myself: in `apps/web/src/sales-ops/navigation.ts`, `aliasLegacyView` changed from

```ts
if (workspace !== 'cadastros' || view === undefined) return view;
```

to `if (view === undefined) return view;`.

Result: **7 failures - 6 in `routing.test.tsx` and 1 in `navigation.test.ts`**, exactly as the implementer claimed.

- `navigation.test.ts > aliases only the cadastros-scoped legacy vendedores and finders views to pessoas`
- `routing.test.tsx > replaces invalid and role-forbidden routes with the role default`
- `routing.test.tsx > does not restore a role-forbidden route after canonical replacement`
- `routing.test.tsx > lands seller-only users in Meus dados and blocks team workspaces`
- `routing.test.tsx > keeps pessoas management in Cadastros and personal panels read-only`
- `routing.test.tsx > rewrites the legacy cadastros seller and finder URLs to Pessoas`
- `routing.test.tsx > closes people management when the mounted app leaves Cadastros`

The guard cannot be weakened with tests green. The `expect(pathname()).toBe(personal.path)` line added inside the `for (const personal of ...)` loop is precisely what catches the hijack.

A second mutation, `redirect: view !== params.view` to `redirect: false`, is also caught (2 failures).

`getVisibleWorkspaces` and the Hub-role visibility logic are untouched - the `navigation.ts` diff adds `pessoas`/`funcoes` to the view union and the cadastros list, adds `legacyCadastroViews`/`aliasLegacyView`, and changes nothing else.
No router file appears in the diff at all, so the legacy `/admin/*`, `/finder/*`, `/seller/*` and `/no-role` trees are unchanged.

## 3. Visibility - does any user see different data?

**Seller- and finder-facing populations: provably identical.** Two independent lines of evidence.

Mechanical: migration `apps/api/drizzle/0012_sales_ops_funcoes.sql` backfills assignments as the exact inverse of `deriveBooleanMirrors` (`apps/api/src/domains/sales-ops/service.ts:1075-1081`) - `is_seller=true` gets a `vendedor` row, `is_finder=true` a `finder` row, `is_collaborator=true` a non-system `prestador` row. Both `createPerson` and `updatePerson` recompute the mirrors from the resolved assignment set inside the same transaction as `replacePersonFuncoes`. So a row whose boolean disagrees with its assignments cannot exist, and `hasFuncao(person,'vendedor') === person.isSeller` holds for every row on the wire.

Empirical: my probe fixture carried the divergence cases - a **vendedor-only** pessoa, a **finder-only** pessoa, and a pessoa with **no função at all**. `meus-dados/vendedores` showed only the vendedor-only person (not the finder-only, not the no-função one); `meus-dados/finders` showed only the finder-only person. `cadastros/pessoas` lists all three. This matches what `master`'s `isSeller`/`isFinder` filters would render.

Other cases I reasoned through: an **archived** função cannot be a system one (`409 funcao_is_system`), so `vendedor`/`finder` are always active and `hasFuncao` is unaffected; an archived *custom* função still satisfies both the web `funcoes.some(f => !f.isSystem)` and the API `isCollaborator` since neither filters on status. A **prestador-only** pessoa is absent from sellers/finders and present in `collaboratorPool` on both sides.

### DEFECT 1 - the produto prestador picker silently narrowed

This is the one real behaviour delta, and it is not among the four self-reported deviations.

`master`, wiring `ProductDialog`:

```tsx
collaborators={persistedBootstrap.people.filter((person) => person.isCollaborator)}
```

branch:

```tsx
collaborators={collaboratorPool(persistedBootstrap.people)}
```

where `collaboratorPool` is

```ts
people.filter((person) => person.status === 'active' && person.funcoes.some((f) => !f.isSystem))
```

`master` applied **no status filter** at this call site. So an **inactive** pessoa carrying a custom função was offered in the produto "Prestador" dropdown before and is not offered now. `collaborators` feeds `options={collaborators.map(...)}` at `SalesOpsApp.tsx:3453`, so the option list really does shrink.

Blast radius is small and partly self-healing: the field stores a **name snapshot** with `valueLabel={provider.personName}` and a free-text `onCreate`, so an already-saved inactive prestador still renders and stays editable - only the suggestion list loses her. The sale wizard's `collaborators` already filtered `status === 'active'` on `master`, so the change makes the two consistent. No test covers it either way.

It is defensible as an improvement, but it is an unrequested, untested, undocumented-as-a-change narrowing in a slice mandated to be visibility-neutral. Either restore the old predicate at this call site, or keep the filter and call the change out explicitly.

## 4. CLAUDE.md truth check

I checked every sentence in `## UI Controls`, `## Sales Ops Routing` and the new `## Pessoas e Funções` against the code.

**True and verified:**

- The canonical route list matches `navigation.ts` exactly (cadastros `produtos|areas|clientes|pessoas|funcoes|geral`, meus-dados `vendedores|comissoes|finders|vendas`).
- The alias bullets. `aliasLegacyView` does return the view unchanged unless the workspace is `cadastros`, and it is called with the **resolved** workspace (`getVisibleWorkspaces(roles).find(...)`), not `params.workspace`. **The wording departure from the plan is correct**: the resolved workspace is strictly stronger, since it additionally requires that `cadastros` be visible to the caller. `params.workspace === 'cadastros'` would indeed have been necessary but not sufficient. Deviation upheld.
- `MeuPainelView` takes no `onEdit` prop at all - confirmed in the signature.
- The `onCreate` inventory. I enumerated every `onCreate` call site: área (3164, 5049), cliente (4900), produto (5159, opens the prefilled dialog), prestador (3448), profissional (5590), função (4069). The Vendedor (4917) and Finder (4940) comboboxes have **no** `onCreate`. "only where" holds.
- System funções: cannot be renamed or archived from the UI, API answers `409 funcao_is_system`, no DELETE verb, archived função stays on the people who carry it but leaves the picker.
- The mirrors bullet: zero source readers (grep over `apps/web/src` outside `__tests__` finds only three comments), API still returns them.
- `funcaoIds` is a full set replacement and the API rejects an empty set with `funcao_required`.
- Hub `AppRole` is unrelated to funções; visibility still derives purely from `profile.roles`.

**DEFECT 2 - line 81 asserts an equivalence that does not hold:**

> `collaboratorPool` is "any active pessoa carrying at least one non-system função", which is exactly how the API derives `is_collaborator`.

The API derivation has **no status component**:

```ts
isCollaborator: funcoes.some((funcao) => !funcao.isSystem),
```

For an inactive pessoa carrying a custom função the API returns `is_collaborator: true` while `collaboratorPool` excludes her. Note the API's own comment is precise about this - it says `isCollaborator` means "holds at least one non-system função", with no mention of activeness. Folding "active" into the definition and then calling it "exactly" the API derivation is what makes DEFECT 1 invisible in the documentation. Anyone who later trusts this line - say, to drop the web filter to "match the API", or to build a server-side prestador list - inherits the divergence.

Fix: either drop the "exactly how the API derives" clause, or state the delta explicitly ("the API's mirror ignores `status`; the web pool additionally requires an active pessoa").

**Lower-confidence, ambiguous - line 70:**

> Pessoa and função create or edit controls are admin-only and live under Cadastros (`cadastros/pessoas` and `cadastros/funcoes`); Meus dados reuses the same people panels in read-only mode.

The trailing clause is a vestige of the old design, where one component with a `mode` prop and a conditional `onEdit` served both `cadastros/vendedores` and `meus-dados/vendedores`. This slice deliberately split them - `PessoasView`'s own doc comment says "Deliberately a separate component from `MeuPainelView`" - so Meus dados no longer reuses the Cadastros people panel. There is an available reading under which the clause is still true ("the `vendedores` and `finders` views in meus-dados both reuse the same panel component"), and line 68 already carries the legitimate reuse claim, so I am **not** treating this as a blocking falsehood. But "in read-only mode" only means something as a contrast with an editable mode of the same panel, and line 69 says that mode was removed entirely. Worth tidying while fixing line 81; do not invent a behaviour change to satisfy it.

**The pre-existing-falsehood claim: UPHELD.** `master`'s `Pessoa pickers get no create row` was not true as written. On `master` the prestador picker (`entityLabel="prestador"`, line 3195) and the profissional picker (`entityLabel="profissional"`, line 5152) both select a pessoa out of `collaborators` and both wire `onCreate`. The sentence is also in tension with its own preceding clause, which lists exactly those two as `onCreate` sites. The replacement wording is unambiguous and true. Fair caveat: `master`'s sentence was ambiguous (it plausibly meant the id-selecting vendedor/finder pickers) rather than flatly wrong - but either way this slice did not introduce an error, it removed an ambiguity.

No contradiction found between the edited sections and the rest of `CLAUDE.md`.

## 5. Anti-gaming - every modified pre-existing test file

**No pre-existing assertion was weakened anywhere.** Verdict per file:

| File | Verdict | Notes |
| --- | --- | --- |
| `navigation.test.ts` | **stronger** | +1 test (the alias scope guard, incl. the `meus-dados` negative controls and the role-precedence cases); added a label-list assertion; 55 to 64 expects |
| `routing.test.tsx` | **stronger** | +1 test (legacy URL rewrite); added `expect(pathname()).toBe(personal.path)` inside the meus-dados loop - the exact hijack guard; 86 to 88 expects |
| `cadastros-refresh.test.tsx` | **stronger** | +2 tests (pessoa `funcaoIds` payload + optimistic badge, função create round-trip); 20 to 33 expects |
| `optimistic.test.ts` | **stronger** | +2 tests (unknown-id degradation, full-set replacement on edit); the old `isSeller` assertion translated into richer `funcaoIds`/`funcoes` assertions plus a `previous.funcoes` identity check |
| `optimistic-row-guard.test.tsx` | **equivalent** | same 9 tests, same 51 expects; fixture churn plus two extra dialog steps now that a função is mandatory |
| `combobox-adoption.test.tsx` | **equivalent** | same 18 tests, same 94 expects; pure fixture churn, and the fixtures preserve the old semantics (Carla keeps `isCollaborator`-equivalence via a non-system `prestador` função) |
| `areas-view`, `calculations`, all 7 `sale-wizard-*`, `sales-transition-actions`, `sales-view` | **equivalent** | identical test and expect counts; the diffs are only the `funcoes: []` bootstrap key and the boolean-to-função fixture swap |

The one test that was genuinely rewritten rather than translated is `routing.test.tsx > closes route-specific people dialogs when history switches people pages`, now `closes the pessoa dialog when history switches cadastros pages`. Its second half exercised the old `roleHint` route-matching between two people pages, which no longer exists as a concept. The core scenario (open the dialog on page A, navigate to page B, dialog must close) is preserved against `funcoes` to `pessoas`, and the implementer **added a positive control** ("the dialog does open here") to backstop the two negatives. Net: not weaker, arguably stronger.

## 6. The dropped booleans

Verified. `grep` for `isSeller|isFinder|isCollaborator|is_seller|is_finder|is_collaborator` across `apps/web/src` excluding `__tests__` returns **only three comments** (`types.ts:28-29`, `SalesOpsApp.tsx:361`) - zero reads. `type-check` exiting 0 with the fields absent from `SalesOpsPerson` is the mechanical proof the implementer intended.

The API still returns them on the wire: `attachPersonFuncoes` spreads the stored row (`{ ...person, funcoes, funcaoIds }`), and `createPerson`/`updatePerson` write `deriveBooleanMirrors(resolved)`. Nothing server-side broke; `apps/api` is untouched by this branch.

`optimisticPerson` is coherently updated: `funcaoIds` is taken verbatim from the payload, `funcoes` is resolved against `previous.funcoes`, an unknown id degrades to a missing badge rather than a crash, and the edit branch sets both keys explicitly after the `...payload` spread so an edit **replaces** rather than merges the set. All three behaviours are now asserted.

## 7. The optimistic invariant

Intact, and slightly tightened.

- `PessoasView` receives `bootstrap` (optimistic rows visible) - correct, it is the cadastro that creates them.
- `FuncoesView` receives `persistedBootstrap`, keeping an in-flight optimistic pessoa out of the "Nº pessoas" column.
- `PersonDialog`, `ProductDialog` and the sale wizard all receive `persistedBootstrap`.
- `MeuPainelView` moved from `bootstrap` to `persistedBootstrap` - a tightening, since an optimistic pessoa created in Cadastros no longer flashes into the Meus dados panel.

No placeholder id can reach a request body. Funções are never written optimistically (`useSaveSalesOpsFuncao` declares no optimistic patch), so `persistedBootstrap.funcoes` holds only real ids; `createdFuncoes` entries come straight from the server response; and an optimistic pessoa row's edit button is `disabled={pending}` under `isOptimisticId`, so her row cannot be reopened and re-submitted.

## 8. Predefined funções are protected

Confirmed. `FuncoesView` renders a **disabled `Lock` button** (`aria-label="Função predefinida do app"`) for `isSystem` rows instead of an edit button, so the UI never offers an action that must fail - mirroring the API's `409 funcao_is_system`. `FuncaoDialogBody` adds defence in depth: `isSystem` disables the name input, the status combobox and the submit button, and `submit()` returns early. Both layers are asserted (`offers no edit affordance for a system função`, `edits a custom função keeping its id and locks a system one`). There is no delete affordance anywhere.

## 9. Self-caught weak assertions - both fixes hold

Reproduced both mutations myself.

**Archived-função filter.** Removed `funcao.status === 'active'` from `selectableFuncoes`. Result: **1 failure**, `pessoas cadastro > keeps an archived função a pessoa already carries listed but out of the picker`. The fix is the `archivedUnassigned` ("Revisor") fixture, which is archived but *not* assigned, so only the status filter can keep it out of the picker. Genuinely Red now.

**Optimistic badge resolution.** Replaced the `funcoes` resolution in `optimisticPerson` with `[]`. Result: **4 failures**, including `cadastros list refresh after a create > sends funcaoIds when creating a pessoa and shows her before the POST resolves`. The fix is scoping the assertion to `container.querySelector('tbody tr')` instead of the whole-container `text()`, which previously matched the still-open dialog. Genuinely Red now.

## 10. Scope, correctness, hygiene

- **Scope clean.** `git diff --name-only master..feat/09` outside `apps/web/` and `CLAUDE.md` is empty. `apps/api/**` and `packages/**` untouched.
- No change to the propostas status machine, payables/receivables, or the `"N/M"` / `"MN/M"` conventions.
- **No raw account or workspace id rendered.** I read `PessoasView`, `FuncoesView`, `PersonDialogBody` and `FuncaoDialogBody`; the new tests also assert `not.toContain(orgId)`, `not.toContain(person.id)` and `not.toContain(funcao.id)`.
- pt-BR gender correct: the função picker passes `entityGender="f"` / `entityLabel="função"`, and the test pins the create row text to exactly `+ Criar nova função "P.O."`. Buttons read `Nova pessoa` / `Nova função`; badges `Predefinida`/`Personalizada`, `Ativa`/`Arquivada` (função) vs `Ativo`/`Inativo` (pessoa).
- **`funcaoIds` full-set replacement** cannot wipe assignments unintentionally from the UI: `assignedIds` is seeded from `modal.person?.funcoes`, an archived função the pessoa already carries is still resolved into `assignedFuncoes` (so it survives a save instead of being silently dropped), and submit is blocked when the set is empty.
- **No create-then-select race.** `createFuncaoByName` invalidates the bootstrap, but the modal is keyed on `person?.id ?? 'new-person'` and gated on route state, not on data, so `PersonDialogBody` does not remount and typed state survives. The unplanned `createdFuncoes` local list closes the window where the new função exists server-side but is not yet in the `persistedBootstrap.funcoes` prop - without it the just-created row would render nameless. Justified.
- **The picker can be cleared.** Each assigned row carries a `Remover função <name>` button; the staging combobox resets to `''` after an assign.
- No `as any`, `@ts-ignore`, `@ts-expect-error` or `eslint-disable` in added lines. Errors are not swallowed beyond the established `catch { return null }` pattern already used by `createAreaByName`/`createClientByName`.
- **Commit hygiene:** one commit, Conventional Commit subject, no co-author trailer, no AI attribution, no em dash in any added line.

### The four self-reported deviations

1. **Module-private helpers instead of exported** (`FUNCAO_SLUG_*`, `hasFuncao`, `collaboratorPool`) - **accept.** `react-refresh/only-export-components` permits only component exports from this module, and nothing outside it needs them.
2. **Nullable `onCreateFuncao` return** - **accept.** Matches the existing `createAreaByName` / `createClientByName` signatures exactly; a rejected create leaves the assignment list untouched.
3. **Unplanned `createdFuncoes` local list** - **accept, and it was necessary.** See the race note above.
4. **`CLAUDE.md` wording departure** ("resolved workspace" rather than `params.workspace === 'cadastros'`) - **accept, the shipped wording is the accurate one.** The code passes the resolved workspace, which additionally requires cadastros visibility.

### Pre-existing coverage gap (report only, not a regression)

Swapping the two slugs in `MeuPainelView` (`mode === 'seller' ? FINDER : VENDEDOR`) leaves the **entire** sales-ops suite green - 21 files / 153 tests all pass. The mutation is a real behaviour change: a seller-only pessoa would surface on the finder panel and vice versa. It survives because `routing.test.tsx`'s `personFixture` carries **both** funções.

This is **not** a weakening introduced here: `master`'s fixture had `isSeller: true, isFinder: true`, so the equivalent mutation would have survived on `master` too. It is carried-forward coverage debt. My probe (single-função fixtures) detects it; the repo's tests do not. Cheap to close by giving the routing fixture a seller-only and a finder-only pessoa.

## Restoration

Every probe and mutation was reverted. Confirmed byte-identical:

```
ab6153248a01baee8ee96502751bce6fb87dcdb8  navigation.ts
2e914410ed1cc2657d0d3e3aa7a284ea5e0f2a45  optimistic.ts
c6f2bb4b3ba5fd828e90e04f46c8a4f088311219  SalesOpsApp.tsx
353945793b3953becbe1985876c6ec202f47f812  types.ts
```

These match the hashes recorded before any mutation. `git diff` is empty, `HEAD` is still `f9d6077`, and the throwaway probe file was deleted. `git status --porcelain` shows only the two untracked paths that were already present when I started (`.vscode/` and the exec agent's own result file) - I created neither and touched neither. I did not merge, push, commit or amend.

## What would flip this to PASS

1. Resolve DEFECT 1 - either restore the `master` predicate at the `ProductDialog` call site, or keep the narrowing and state it deliberately (it is arguably the better behaviour and consistent with the sale wizard).
2. Fix DEFECT 2 - drop or qualify the "which is exactly how the API derives `is_collaborator`" clause on `CLAUDE.md` line 81 so it stops asserting an equivalence that fails for inactive people.
3. Optional: tidy the vestigial "Meus dados reuses the same people panels in read-only mode" clause on line 70, and give the routing fixture single-função people to close the `MeuPainelView` mutation gap.
