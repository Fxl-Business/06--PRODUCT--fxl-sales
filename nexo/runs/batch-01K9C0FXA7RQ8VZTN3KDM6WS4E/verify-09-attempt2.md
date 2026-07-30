# Verify (Gate 2) - slice 09-pessoas-funcoes-web, attempt 2

Branch: `feat/09-pessoas-funcoes-web`, one commit `12aa1dc` on top of `master` (`04388b7`).
Verdict: **PASS**.

Both blocking defects from attempt 1 are genuinely fixed, the fix is empirically proven visibility-neutral against `master` at both call sites, the two new tests invert under the corresponding mutations and carry working positive controls, and the carried-forward `MeuPainelView` coverage debt is closed. No pre-existing test lost an assertion, the amend is scoped to exactly the two defects plus the debt, and I found no new defect.

I formed my own view rather than trusting the attempt-1 report or the commit message; every claim below is backed by a command I ran.

## 1. Gates

Run from the repo root on the pristine checkout, before any mutation.

| Gate | Exit |
| --- | --- |
| `pnpm run lint` | 0 |
| `pnpm run type-check` | 0 |
| `CI=true pnpm test` | 0 |
| `pnpm run build` | 0 (built in 1.41s) |

Counts, exactly as expected:

| Package | Files | Tests |
| --- | --- | --- |
| `apps/web` | 32 | 240 |
| `apps/api` | 27 | 283 |
| `packages/shared-utils` | 1 | 17 |

Nothing was removed. Attempt 1 stood at web 32/238; the two added tests take it to 240, and the arithmetic closes exactly: `master` was 31 files / 220 tests, and the per-file deltas (`cadastros-refresh` +2, `navigation` +1, `optimistic-row-guard` +1, `optimistic` +2, `routing` +2, new `pessoas-funcoes-view` +12) sum to +20.

`CI=true pnpm test` was re-run a second time after all mutations were reverted: still 0, same counts.

## 2. The crux - are the picker populations identical to `master`?

**Yes, at both call sites, proven empirically.**

### The call sites, read side by side

`master` genuinely had **two different pools**, confirming the implementer's refinement and correcting attempt 1's framing:

| Site | `master` | branch |
| --- | --- | --- |
| `ProductDialog` wiring | `people.filter((person) => person.isCollaborator)` (line 1200) | `people.filter(isCollaboratorPerson)` (line 1271) |
| wizard `collaborators` memo | `people.filter((person) => person.isCollaborator && person.status === 'active')` (line 3879) | `people.filter((person) => isCollaboratorPerson(person) && person.status === 'active')` (line 4311) |

Structurally equivalent with `person.isCollaborator` substituted by `isCollaboratorPerson(person)` and nothing else. `grep` confirms there are exactly two producers of a `collaborators` value on the branch (1271, 4311), matching `master`'s two (1200, 3879), so no third site was introduced or lost. Passing `isCollaboratorPerson` bare to `.filter` is safe: it declares one parameter, so the index/array arguments are ignored.

### Empirical proof

I wrote a throwaway probe (`apps/web/src/sales-ops/__tests__/zzverify-probe.test.tsx`, since deleted) that constructs one person set, computes what `master`'s two expressions would yield from it, then drives the **real** branch pickers and compares. Each fixture row also carries the three deprecated mirror booleans computed with `deriveBooleanMirrors` verbatim, so both sides read the same server payload.

The person set:

| # | status | funções | API `isCollaborator` |
| --- | --- | --- | --- |
| P1 Inativa Custom | inactive | `prestador` (custom) | true |
| P2 Prestador Only | active | `prestador` | true |
| P3 Arquivada Funcao | active | `revisor` (custom, **status archived**) | true |
| P4 Somente Sistema | active | `vendedor` + `finder` (both system) | false |
| P5 Vendedor E Prestador | active | `vendedor` + `prestador` | true |
| P6 Inativo Sistema | inactive | `vendedor` | false |
| P7 Sem Funcao | active | none | false |

The produto picker was driven through the full `SalesOpsApp` at `/cadastros/produtos` (so the wiring, not just `ProductDialog`, is under test); the wizard picker through the exported `SaleWizardDialog`. Result:

```
PRODUTO branch = ["P1 Inativa Custom","P2 Prestador Only","P3 Arquivada Funcao","P5 Vendedor E Prestador"]
PRODUTO master = ["P1 Inativa Custom","P2 Prestador Only","P3 Arquivada Funcao","P5 Vendedor E Prestador"]
WIZARD  branch = ["P2 Prestador Only","P3 Arquivada Funcao","P5 Vendedor E Prestador"]
WIZARD  master = ["P2 Prestador Only","P3 Arquivada Funcao","P5 Vendedor E Prestador"]
```

Exact match on both, and the discriminating cases all land the right way:

- **P1 (inactive + custom função)** is offered by the produto picker and withheld from the wizard - the precise asymmetry `master` had and attempt 1 found broken. **Defect 1 is fixed.**
- **P2 (prestador-only)** offered by both.
- **P3 (archived custom função)** offered by both, on both sides: neither derivation filters on função status.
- **P4 / P6 (system funções only)** and **P7 (no função)** offered by neither.

**Two-pool asymmetry restored: yes.**

### The regression test inverts, and has a working positive control

Mutation A - re-apply the narrowing at line 1271 (`&& p.status === 'active'`):

```
× the produto prestador pool > offers an inactive pessoa carrying a custom função, and never a vendedor
  AssertionError: expected [ 'Pessoa Persistida' ] to include 'Prestadora Inativa'
  Test Files 1 failed | 20 passed (21)    Tests 1 failed | 154 passed (155)
```

Red. The failure message is itself the proof of a **working positive control**: under the narrowing the pool is `['Pessoa Persistida']` - non-empty - and the test still fails. It therefore distinguishes a *narrowed* pool from a healthy one, not merely from an empty one.

Mutation B - `collaborators={[]}`: same test fails with `expected [] to include 'Prestadora Inativa'`. So a collapsed pool is caught too.

Mutation C - invert the predicate to `funcoes.some((f) => f.isSystem)`: **2 failures**, the new test (`expected [ 'Vendedor Ativo', …(1) ] to include 'Prestadora Inativa'`, so the `not.toContain('Vendedor Ativo')` negative is load-bearing too) plus `combobox-adoption > lets a name-only profissional survive through the picker`.

## 3. CLAUDE.md - every sentence in the edited sections

**All true.** I checked each factual claim against source, not against the commit message.

- **`isCollaboratorPerson` is "carries at least one non-system função" and nothing else.** Code: `return person.funcoes.some((funcao) => !funcao.isSystem);` (SalesOpsApp.tsx:371). TRUE.
- **"character for character how the API derives `is_collaborator` in `deriveBooleanMirrors`, and in particular neither side considers `status`".** API (`apps/api/src/domains/sales-ops/service.ts:1078`): `isCollaborator: funcoes.some((funcao) => !funcao.isSystem),`. The predicate `funcoes.some((funcao) => !funcao.isSystem)` is literally identical text, and neither side mentions `status`. **Defect 2 is fixed** - the false "active" component is gone from both the doc and the code. Style nit only: the receiver differs (`person.funcoes` vs the API's local `funcoes`), so "character for character" is a mild flourish; the predicate really is identical and the sentence is not false.
- **The new call-site-asymmetry bullet.** It says the produto Prestador picker offers every prestador including inactive ones "because that field stores a name snapshot", and the wizard's Profissional picker additionally requires `status === 'active'`. All three parts verified: the empirical comparison above for the behaviour; `SalesOpsProductProvider` in `apps/web/src/sales-ops/types.ts:51-55` is `{ personName, commissionType, commissionValue }` with **no `personId`**, so the name-snapshot rationale is factually correct and materially justifies the asymmetry; and `grep` confirms exactly two call sites, so "the two existing ones" is accurate. TRUE, and it describes the right site as the filtering one.
- **Line 70's replacement, "No `meus-dados` route exposes a pessoa or função create or edit affordance".** TRUE, and the implementer's reasoning for avoiding a broader claim checks out. `headerAction` (SalesOpsApp.tsx:772-791) returns `null` for `view === 'vendedores' || view === 'finders'` but falls through to `'Nova proposta'` for `comissoes` and `vendas` - so a broader "no create affordance on meus-dados" would indeed have been **false**. The narrower claim holds because `'Nova pessoa'` / `'Nova função'` are gated on `canManagePeople` / `canManageFuncoes`, both defined as `workspace === 'cadastros' && profile.roles.includes('admin') && view === 'pessoas' | 'funcoes'` (671-673), and `runHeaderAction`'s pessoa and função branches are gated on the same flags, so on any `meus-dados` route it falls through to `setSaleWizard({ mode: 'create' })`. `meus-dados` navigation never yields a `pessoas`/`funcoes` view id, and `aliasLegacyView` is scoped to `cadastros`, so neither view can resolve there. This also correctly retires the vestigial "read-only mode" clause attempt 1 flagged.
- No other false or self-contradictory sentence found, and no contradiction with the rest of `CLAUDE.md`. Re-verified while I was in there: the canonical route list, the alias bullets, the system-função bullet, the archived-função bullet, the `funcaoIds` full-set-replacement bullet, the mirrors bullet (zero non-comment readers in `apps/web/src`), the `AppRole`-unrelated bullet, and the `onCreate` inventory (the Vendedor and Finder comboboxes at 4927 and 4950 still carry no `onCreate`).

## 4. Anti-gaming

**Purely additive.** Per-file `it(`/`test(` and `expect(` counts, `master` vs branch:

| File | it | expect |
| --- | --- | --- |
| areas-view | 7 → 7 | 21 → 21 |
| cadastros-refresh | 5 → 7 | 20 → 33 |
| calculations | 13 → 13 | 39 → 39 |
| combobox-adoption | 18 → 18 | 94 → 94 |
| navigation | 10 → 11 | 55 → 64 |
| optimistic-row-guard | 9 → 10 | 51 → 54 |
| optimistic | 8 → 10 | 29 → 35 |
| pessoas-funcoes-view | new → 12 | new → 67 |
| routing | 14 → 16 | 86 → 92 |
| all 7 `sale-wizard-*`, `sales-transition-actions`, `sales-view` | unchanged | unchanged |

No file lost a test or an assertion. No `.skip`, `.only` or `.todo` anywhere in `apps/web/src` or `apps/api/src`.

**The extra routing fixture perturbs no existing assertion.** `finderOnlyFixture` ("Bia Indicadora") is referenced only inside the new test. Every pre-existing assertion in `routing.test.tsx` targets "Alex Silva" by name (`toContain('Alex Silva')`, `buttonByAccessibleName('Editar Alex Silva')`, and one `.toBeNull()` on that same accessible name), so a second person can neither satisfy them spuriously nor weaken them; if anything the `not.toContain` assertions get stricter. The full suite is green with the fixture in place.

## 5. Is the amend scoped to the two defects plus the debt?

**Yes.** `git diff f9d6077..12aa1dc --stat` touches exactly four files:

- `CLAUDE.md` (+7/-16 across two hunks) - defect 2 plus line 70 plus the new asymmetry bullet.
- `apps/web/src/sales-ops/SalesOpsApp.tsx` - `collaboratorPool` becomes `isCollaboratorPerson`, the two call sites, and their comments. Nothing else; defect 1 only.
- `apps/web/src/sales-ops/__tests__/optimistic-row-guard.test.tsx` - one appended `describe` block, no existing line touched.
- `apps/web/src/sales-ops/__tests__/routing.test.tsx` - `finderOnlyFixture`, its use in the mocked bootstrap, and one appended test. The debt fix.

Nothing unrelated. I did not need to re-verify any extra area.

## 6. Load-bearing properties re-confirmed on the amended source

- **Routes resolve.** Covered by the branch's own routing suite (16 tests, green), including all four `meus-dados` routes, `tatico/dashboard`, both `operacional` views and all six `cadastros` screens.
- **The alias guard is still load-bearing - and stronger.** Dropping the `cadastros` scope from `aliasLegacyView` (`if (workspace !== 'cadastros' || view === undefined)` → `if (view === undefined)`) now produces **8 failures** (7 in `routing.test.tsx`, 1 in `navigation.test.ts`), one more than attempt 1's 7, because the new Meu painel test also catches the hijack. Guard cannot be weakened with tests green.
- **Seller and finder populations identical to `master`.** Unchanged by the amend (`hasFuncao(person, VENDEDOR/FINDER) && status === 'active'` at 4297/4304, matching `master`'s `isSeller`/`isFinder` + active), and the mirror-equivalence argument from attempt 1 still holds; my probe fixture's `deriveBooleanMirrors`-computed booleans agreed with `hasFuncao` on every row.
- **Optimistic invariant intact.** `PessoasView` gets `bootstrap` (the cadastro that creates the rows); `FuncoesView`, `ProductDialog`, `SaleWizardDialog` (line 1316) and `MeuPainelView` all get `persistedBootstrap`. The amend kept line 1271 on `persistedBootstrap`.
- **System funções still protected.** `FuncoesView` renders a disabled `Lock` (`aria-label="Função predefinida do app"`) for `isSystem` rows instead of an edit button; `FuncaoDialogBody` disables the name input, the status combobox and submit, and `submit()` early-returns on `isSystem`. No delete affordance.
- **No raw account or workspace id rendered.** The new view tests assert `expect(text()).not.toContain(orgId)`.
- **`apps/api/**` and `packages/**` untouched.** `git diff master..12aa1dc --name-only` is confined to `CLAUDE.md` and `apps/web/src/sales-ops/`.

## 7. The closed debt

**Closed.** Swapping the two slugs in `MeuPainelView` (`mode === 'seller' ? FUNCAO_SLUG_FINDER : FUNCAO_SLUG_VENDEDOR`) now yields:

```
× Sales Ops canonical routing > scopes each Meu painel to the função its route stands for
  AssertionError: expected 'Meu painelPerformance, comissão, tick…' not to contain 'Bia Indicadora'
```

On `master` and at attempt 1 this mutation left the entire sales-ops suite green. The implementer's explanation is correct: the earlier mutation used a bogus slug, which any single-função-free fixture would have caught differently, whereas the swap needed a pessoa carrying exactly one of the two funções. The new test has a positive control - Alex Silva carries both funções and is asserted present on both panels - and the failure message confirms it was satisfied before the negative tripped.

## 8. Hygiene

- One commit (`git rev-list --count master..12aa1dc` = 1).
- Conventional Commit subject: `feat(sales-ops): make Pessoas and Funções first-class Cadastros`.
- No co-author trailer, no AI attribution. The one grep hit was the literal filename `CLAUDE.md` in the body.
- No em dash in any added line across `master..12aa1dc`; the body uses plain ` - `.
- pt-BR gender correct in the added strings: `Prestadora Inativa`, `Vendedor Ativo`, `Bia Indicadora`; the doc bullets keep `função`/`funções` agreement.
- The commit body is honest about the fix and does not overclaim: it states the visibility-neutrality by construction and names the asymmetry.

## 9. Equivalent mutants and non-defects

Stated explicitly, per the verdict rules: I found **no** real correctness defect. The `person.filter(isCollaboratorPerson)` bare-callback form is an equivalent refactor of `master`'s inline arrow, not a defect. The "character for character" wording is a rhetorical flourish over a genuinely identical predicate, a style note only, not a falsehood.

## Restoration

Every probe and mutation reverted. Confirmed byte-identical to the pre-mutation baseline by `git hash-object`:

```
9a38b581496a684150b6f9d9f58a7c561ca45597  apps/web/src/sales-ops/SalesOpsApp.tsx
ab6153248a01baee8ee96502751bce6fb87dcdb8  apps/web/src/sales-ops/navigation.ts
18a86e5d3e16d3f237a6e0e4edcde274de0ea2d9  CLAUDE.md
9e7cf36caa174700812f4892a32d6254afca8531  apps/web/src/sales-ops/__tests__/routing.test.tsx
90d2f42ced81dc0e7c8ce214b7f9e65b3da78ff9  apps/web/src/sales-ops/__tests__/optimistic-row-guard.test.tsx
```

`git diff HEAD` is empty. `HEAD` is still `12aa1dc`. The throwaway probe file is deleted (`ls` returns "No such file or directory"). `CI=true pnpm test` re-run on the restored tree: exit 0, web 32/240, api 27/283, shared-utils 1/17.

`git status --porcelain` shows exactly the four untracked paths that were present when I started, none of which I created or touched:

```
?? .vscode/
?? nexo/runs/batch-01K9C0FXA7RQ8VZTN3KDM6WS4E/agents/exec-09-pessoas-funcoes-web.result.json
?? nexo/runs/batch-01K9C0FXA7RQ8VZTN3KDM6WS4E/agents/verify-09-pessoas-funcoes-web.result.json
?? nexo/runs/batch-01K9C0FXA7RQ8VZTN3KDM6WS4E/verify-09.md
```

I did not merge, push, commit or amend. I stayed on `feat/09-pessoas-funcoes-web` throughout.
