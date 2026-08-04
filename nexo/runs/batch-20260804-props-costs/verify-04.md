# Verify 04 - prefill profissionais do produto

Branch: `feat/04-prefill-profissionais-do-produto` at `feecbfa`, against `master` at `8891304`.
Verified cold: the executor notes were not read.

**Verdict: FAIL.**
Narrow, single finding, everything else is clean.
`Salvar rascunho` silently discards every produto-seeded row and persists a `net_margin_brl` that disagrees with the `Margem líquida` the operator was just shown, which breaks the invariant CLAUDE.md pins and defeats the slice's own purpose on the ordinary save-a-draft-and-come-back workflow.
Detail in section 5.

---

## 1. Gates

All three run once, from the repo root, on the branch tip.

### `pnpm run lint` - exit 0

```
Scope: 4 of 5 workspace projects
packages/shared-utils lint$ echo 'no lint for shared-utils'
packages/shared-types lint$ echo 'no lint for shared-types'
packages/shared-types lint: no lint for shared-types
packages/shared-types lint: Done
packages/shared-utils lint: no lint for shared-utils
packages/shared-utils lint: Done
apps/api lint$ eslint src/
apps/web lint$ eslint src/
apps/api lint: Done
apps/web lint: Done
```

### `pnpm run type-check` - exit 0

```
Scope: 4 of 5 workspace projects
packages/shared-types type-check$ tsc --noEmit
packages/shared-utils type-check$ tsc --noEmit
packages/shared-types type-check: Done
packages/shared-utils type-check: Done
apps/api type-check$ tsc --noEmit
apps/web type-check$ tsc --noEmit
apps/api type-check: Done
apps/web type-check: Done
```

### `pnpm test` - exit 0

```
packages/shared-utils test:  Test Files  2 passed (2)
packages/shared-utils test:       Tests  23 passed (23)
apps/api test:  Test Files  33 passed (33)
apps/api test:       Tests  323 passed (323)
apps/web test:  ✓ src/sales-ops/__tests__/funcao-cost-seeding.test.ts (10 tests) 4ms
apps/web test:  Test Files  45 passed (45)
apps/web test:       Tests  515 passed (515)
build-contract: ok
```

---

## 2. Oracle proof

Method: `git worktree add` a scratch checkout of `master`, symlink `node_modules` from the main repo, and run.

**Baseline.**
The unmodified `master` copy of `sale-wizard-funcao-costs.test.tsx` passes 29/29 in the scratch worktree, so the harness itself is sound.

**Step 1 - new tests over the ORIGINAL implementation.**
Copied ONLY the two new/changed test files onto `master`'s `SalesOpsApp.tsx` and `calculations.ts`.

```
Test Files  2 failed (2)
     Tests  18 failed | 29 passed (47)
```

All 18 new `it()` blocks fail (10 in `funcao-cost-seeding.test.ts`, 8 in the new `produto-seeded profissional rows` describe), and all 29 pre-existing blocks still pass under the new shared helper.
So the helper change did not neutralize the old suite, and no new test is a pass-on-master negative control by count.

Two of the 18 fail on `master` for a *shallower* reason than the behaviour they name: every `funcao-cost-seeding.test.ts` block fails at import (`planFuncaoCostSeeds` does not exist on `master`), and `seeds nothing when reopening a saved proposta` fails because the `aria-label="Remover profissional N"` its row counter addresses is itself new in this slice.
Both were therefore **mutation-tested against the NEW implementation** instead, along with the other high-risk guards.

**Step 2 - five mutations of the new implementation.**
Each applied alone to a scratch worktree holding the branch code, then reverted.

| # | Mutation | Caught by |
| --- | --- | --- |
| A | `if (!editSale)` to `if (true)` (kill the create-vs-edit discriminator) | 1 failure, exactly `seeds nothing when reopening a saved proposta` |
| B | `new Set(seededKeys)` to `new Set<string>()` (forget what was already seeded) | 35 failures, including `does not resurrect a seeded row the operator deleted` and `does not re-emit a key for a row the operator deleted`; the render guard also stops terminating |
| C | `new Set(allocatedFuncaoIds…)` to `new Set<string>()` (forget hand-added rows) | 2 failures: `records the key but emits no row for a funcao already allocated by hand`, `does not seed a second row for a funcao the operator already allocated` |
| D | delete `if (allocated.has(cost.funcaoId)) continue;` (kill the per-função row dedupe) | 4 failures, including `emits one row with the summed cents when two produtos declare the same funcao` |
| E | `costCents: basis.get(...)?.cents ?? 0` to `costCents: 0` (kill the money) | 4 failures, including `seeds a row per declared funcao…` and `sends the seeded rows with their funcaoId and resolved cents` |

Every guard in the slice is load-bearing and independently pinned.
Oracle **PROVEN**, nothing left UNPROVEN.
Both worktrees removed; `git worktree list` shows only the main checkout and `git status` is unchanged from the session start.

---

## 3. Behaviour lines

### 3.1 A produto with a declared função cost seeds a row: função filled, cost from `buildFuncaoCostBasis`, pessoa empty - **PASS**

How checked: read `SalesOpsApp.tsx:5928-5988` plus mutation E, plus the test `seeds a row per declared funcao on a new proposta, funcao filled and pessoa empty`.
The seed writes `personId: ''`, `personName: ''`, `funcaoId`, `funcaoName` resolved from `allocatableFuncoes`, `costUnit: 'fix'`, `costBrl: centsToInput(seed.costCents)`.
`seed.costCents` comes from `basis.get(funcaoId)?.cents`, where `basis` is the hoisted `funcaoCostBasis` built by the existing `buildFuncaoCostBasis` over the identical item projection the wizard already uses.
Test asserts `Desenvolvedor`/`1000` and `Testador`/`300` on a `FXL Custom` item, with `Nenhum profissional alocado` gone.

Worth recording: the seeded row is deliberately `costManual: false`, unlike a `deriveWizardPrefill` row.
I checked this is safe rather than a leak: the `funcaoCostKey` guard at `SalesOpsApp.tsx:5911-5924` rewrites exactly `centsToInput(funcaoCostBasis.get(funcaoId)?.cents ?? 0)`, byte for byte the expression the seed used, so it can only ever re-write the same value or track a changed item value. The test `does not duplicate a seeded row when the item value changes` pins the tracking (`1000` becomes `2000` at double the item value).

### 3.2 Idempotency, once per (produto, função) - **PASS**

How checked: read the guard, then mutation B and C, then three tests.

The guard is a fifth render-phase source-key sync in the shape of the four already in the file.
`seededFuncaoCostKeys` is `useState<string[]>` that only ever grows; `planFuncaoCostSeeds` returns only keys not already in it, over the finite `items x productFuncaoCosts` set, so the next render returns nothing and no setter runs.
The choice of `useState` over a render-mutated `useRef` is correct and matters: a ref would be marked seeded on React's discarded StrictMode pass while that pass's `setProfessionals` is thrown away.

- Re-render does not duplicate: `does not duplicate a seeded row when the item value changes` goes step 3 → step 1 → edit the value → step 3 and asserts `professionalRowCount()` stays 2.
- Removing a produto and re-adding does not double up: the key is `(productId, funcaoId)`, recorded on first sight and never removed, pinned by `returns nothing once every declaration key has been seen`.
- A hand-added função gains no seeded twin: `planFuncaoCostSeeds` takes `professionals.map(row => row.funcaoId)` as `allocatedFuncaoIds` and skips the row while STILL recording the key. Pinned by `does not seed a second row for a funcao the operator already allocated` (adds `Testador` by hand, then adds a `Landing Page` item that also declares `Testador`, asserts one row) and by mutation C.

### 3.3 A DELETED row must not come back - **PASS**

How checked: `does not resurrect a seeded row the operator deleted` deletes `Desenvolvedor`, then changes the item value to force a re-render and a basis-key change, returns to step 3, and asserts one row remaining whose função is `Testador`.
That test would genuinely catch a regression: it forces the exact state change most likely to re-trigger a seed, and mutation B (forgetting the seeded keys) makes it fail.
The mechanism is right by construction as well: the key set is decoupled from the row array, so deleting a row cannot un-record a key.

### 3.4 The EDIT path must not re-seed, and the discriminator is real - **PASS**

How checked: read `SalesOpsApp.tsx:5950` and `5555`, plus mutation A.
The discriminator is `if (!editSale)`, where `editSale` is the prop that decides `prefill` itself (`const prefill = editSale ? deriveWizardPrefill(editSale, bootstrap) : null`).
It is NOT a heuristic on `professionals.length === 0` or on "no row carries this função", so a stored proposta with zero professionals is correctly left alone.
`seeds nothing when reopening a saved proposta` asserts exactly one row (`Dev Externo`) and that neither `Desenvolvedor` nor `Testador` appears anywhere.
Mutation A (`if (true)`) fails precisely that one test and nothing else, which converts it from a possible negative control into a proven oracle for the discriminator.

### 3.5 Two produtos declaring the SAME função produce one row - **PASS**

How checked: `emits one row with the summed cents when two produtos declare the same funcao` asserts one seed carrying `1530000` cents (R$ 15.000 from Advisor 360 at 75% plus R$ 300 from Landing Page fixed), and `keys a declaration on (productId, funcaoId), never on funcaoId alone` asserts both keys are still recorded.
Mutation D confirms the dedupe is what produces that.
The two dedup rules are deliberately different (declaration keyed on the pair, row keyed on the função) and that is the correct pairing: removing one produto must not un-propose the other's declaration, but the operator must not be shown Mentor twice.

### 3.6 A personless seeded row cannot silently reach the API, reusing slice 03's gate - **PASS (as scoped), with the caveat in section 5**

How checked: grepped for every occurrence of `professionalPeopleValid` and of the error string.
There is exactly one `professionalPeopleValid` definition (`SalesOpsApp.tsx:6044`), one `canAdvanceStepThree = professionalsValid`, and exactly one render of `Selecione a pessoa de cada profissional alocado.` (`SalesOpsApp.tsx:7805-7809`).
No second competing gate and no duplicate error bar were added; the slice adds no validation code at all.
`blocks Avancar until every seeded row has a pessoa` proves `Avançar` is refused with the bar visible, then admitted once both rows name a pessoa.
`unblocks Avancar when the operator removes the seeded rows instead` proves removal is the other accepted exit.
`sends the seeded rows with their funcaoId and resolved cents` proves the happy path reaches `onSave` with `funcaoId`, `role` and `costBrl: 100000` / `30000`.

The `Salvar rascunho` escape hatch past this gate is section 5.

---

## 4. Interaction with slice 03

None regressed.
All 29 pre-existing `it()` blocks in `sale-wizard-funcao-costs.test.tsx`, including the whole slice-03 `sale wizard profissionais alocados` describe, pass unmodified.

| Line | Verdict | Method |
| --- | --- | --- |
| FUNÇÃO is still the first column | PASS | Read the row grid at `SalesOpsApp.tsx:7612-7650`: `grid-cols-[minmax(0,1fr)_minmax(0,1fr)_212px_36px]` with the função `Combobox` as first child, untouched by the diff |
| Person picker still locked until a função is named | PASS | `personPickerLocked` at `7609` unchanged; the pre-existing `locks the profissional picker until the row names a funcao` still passes |
| A SEEDED row has an ENABLED person picker | PASS | Checked specifically: a seeded row carries `funcaoId`, so `personPickerLocked` is false. `seeds a row per declared funcao…` asserts `comboboxTrigger('Profissional 1').disabled === false` and `…('Profissional 2').disabled === false`, and that the placeholder is `Buscar ou digitar um nome...` rather than `Selecione a função primeiro` |
| grant-on-select still works | PASS | `selectProfessionalPerson` untouched; `grants the funcao to a flagged pessoa with her FULL existing funcaoIds`, `omits contactEmail…` and `does not write when the pessoa already carries the row s funcao` all still pass |
| `Selecione a pessoa de cada profissional alocado.` bar still appears | PASS | Single render site at `7805`, asserted by `blocks Avancar until every seeded row has a pessoa` |

One additive change touches slice 03's markup: the remove button gains `aria-label={`Remover profissional ${index + 1}`}`.
It was icon-only before and had no accessible name at all, so this is a genuine accessibility improvement, not a test affordance bolted on.

---

## 5. Money check - **FAIL on the second clause**

**Clause 1, the seeded cost equals what the produto declares, through the existing path: PASS.**
`planFuncaoCostSeeds` takes the already-built `Map<string, FuncaoCostBasisEntry>` as a parameter and only calls `.get()`.
It performs no arithmetic of its own: no percentage, no multiplication, no cents math anywhere in the function.
The wizard hoists `funcaoCostItems` specifically so the seed and `buildFuncaoCostBasis` consume the identical projection.
Grepped the diff for any new derivation: none. No parallel cost path was introduced.

**Clause 2, `computeSaleFinancials` / the margin panel still agree with the persisted value: FAIL.**

CLAUDE.md pins that the on-screen `Margem líquida` equals the persisted `net_margin_brl`.
That now breaks by default on any new proposta whose produto declares a função cost.

Reproduced directly, in a scratch worktree at `feecbfa`, using the suite's own fixtures and helpers:

```
PROBE rows on step 3: 2
PROBE step-3 panel: Margem líquidaR$ 15.500(77.5%)Comissão vendedor · R$ 2.000Custos profissionais · R$ 1.300Imposto · R$ 1.200VoltarPasso 3 de 4Salvar rascunhoAvançar
PROBE draft professionals: []
```

The operator is looking at `Margem líquida R$ 15.500` with `Custos profissionais R$ 1.300`.
`Salvar rascunho` sits in the same footer, on that same screen, ungated by step.
It sends `professionals: []`, because `createPayload` filters `personName.trim() !== ''` and no seeded row has a pessoa yet.
`apps/api/src/domains/sales-ops/service.ts:776` derives `professionalCostsBrl` by reducing `input.professionals`, so the row that gets persisted is `net_margin_brl = R$ 16.800`, R$ 1.300 above the number on screen.

Two consequences, both real:

1. **The displayed margin and the persisted margin disagree, with no operator action.**
   On `master` a fresh proposta reaches step 3 with zero professional rows, so both numbers are R$ 16.800 and they agree. The divergence is introduced by this slice.
   The pre-existing hand-added-row path could produce the same divergence, but only after the operator deliberately added a row, picked a função, and left the pessoa blank. It is now the default state of every qualifying proposta.

2. **A saved rascunho loses the seeding permanently, which defeats the slice's purpose.**
   Verified that the seeds exist from the first render, before step 3 is ever visited:

   ```
   PROBE2 step-1 text has table? true
   PROBE2 draft-from-step-1 professionals: []
   ```

   So the ordinary "start a proposta, save a draft, finish it tomorrow" flow discards the produto's declared funções.
   On reopen, `if (!editSale)` correctly refuses to re-seed, and correctly so, since the absence of a stored row is a decision. But here the absence was never the operator's decision; it was manufactured by the drop on the way out.
   The operator is then back to the exact complaint that opened this slice, having to reopen the produto cadastro to rediscover that Mentor is needed.

CLAUDE.md's own justification for the drop is half true.
"Its cents can never reach a persisted margin the operator approved, because step 4 is unreachable while any row lacks a pessoa" is correct about the persisted number.
It does not address the inverse, that the DISPLAYED step-3 margin now counts cents the draft path will not persist, nor that a dropped seeded row is unrecoverable once the rascunho is reopened.

This is a considered decision that came out wrong, not an oversight, and it is narrow.
Plausible fixes, for the executor to choose between rather than a prescription: gate `Salvar rascunho` on `professionalPeopleValid` when any row exists, or let a personless row persist with a null person, or drop the personless rows from `professionalCents` so the panel shows what the draft will actually save.

---

## 6. Coverage integrity

| File | `it()` on master | `it()` on branch |
| --- | --- | --- |
| `sale-wizard-funcao-costs.test.tsx` | 29 | 37 |
| `funcao-cost-seeding.test.ts` | 0 (new) | 10 |
| Total | 29 | 47 |

`git diff master...HEAD -- '*test*' | grep -c "^-[^-]"` returns **0**.
Not one line was deleted from a test file.
The plan expected roughly 24 existing blocks to need mechanical updating; the actual approach needed none.
The whole adaptation is one shared helper, `clearSeededProfessionals()`, called once per test at the top of `addProfessional()` and guarded by a `seedsCleared` flag.

I checked this helper does not weaken anything.
It runs only inside `addProfessional()`, so the edit-path tests that reach step 3 without adding a row keep their stored row untouched.
It is a no-op after the first call, so a test that adds two profissionais keeps both, and leaving step 3 and returning never removes the row the test added.
It clears rows before clicking `+ profissional`, so `profissional 1` still means "the row I just added" for every legacy assertion.
It is deliberately not an assertion, so if the seeding regressed to zero rows the loop is simply inert and the legacy suite stays green. That is correct separation: the legacy suite is not the oracle for seeding, and the 18 new blocks are, as section 2 proves.

No coverage lost.

---

## 7. Scope, style and UI rules

**Files changed** exactly match the plan's `files_modified`, no more and no less:

```
CLAUDE.md
apps/web/src/sales-ops/SalesOpsApp.tsx
apps/web/src/sales-ops/__tests__/funcao-cost-seeding.test.ts
apps/web/src/sales-ops/__tests__/sale-wizard-funcao-costs.test.tsx
apps/web/src/sales-ops/calculations.ts
```

**Em dash**: grepping the diff's added lines for U+2014 returns a count of 0.
**Native pickers**: `git diff master...HEAD | grep "^+" | grep -E "<select|<option|<datalist"` returns nothing. The seeded row reuses the existing `Combobox` call sites; no picker was added at all.
**Repo state**: no commit, no merge, no worktree left behind. `git worktree list` shows only the main checkout; `git status --porcelain` is unchanged from session start (`.vscode/`, `nexo/plans/…`, `nexo/runs/…` untracked, as before).

---

## 8. Overall verdict

**FAIL.**

Everything the slice set out to do, it does, and the engineering is unusually careful.
Gates are green, the oracle is proven twice over (18/18 new tests fail on `master`, and five separate mutations of the new code are each caught), all six behaviour lines hold, all five slice-03 interaction lines hold, not a single test line was deleted, the diff stayed exactly in scope, and the seeded money goes through the one existing `buildFuncaoCostBasis` path with no parallel derivation.
The idempotency design in particular is the right one: a growing key set decoupled from the row array, keyed on the pair and deduped per função, in `useState` rather than a render-mutated ref.

It fails on one thing, and it is a thing this repo has explicitly pinned.
`Salvar rascunho` is reachable from every step, it drops every personless row, and every seeded row is personless by definition.
So a new proposta now displays a `Margem líquida` that the draft it saves will not reproduce (R$ 15.500 shown, R$ 16.800 persisted, on the suite's own fixture), and a rascunho round-trip silently and permanently discards the produto's declared funções, which returns the operator to the original complaint.
The seeding is correct; what happens to it on the draft path is not.
Fix that one seam and this passes.
