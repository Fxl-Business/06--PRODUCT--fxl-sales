# Verify 04 (re-verify) - prefill profissionais do produto

Branch: `feat/04-prefill-profissionais-do-produto` at `9378cd2`, against `master`.
Prior verify: `nexo/runs/batch-20260804-props-costs/verify-04.md`, verdict FAIL, blocking finding in its section 5 - `professionalCents` counted personless seeded rows that `createPayload` drops, so the displayed `Margem líquida` (R$ 15.500) disagreed with the persisted `net_margin_brl` (R$ 16.800) on the ordinary save-a-draft flow.
Fix commit read directly from `git diff feecbfa 9378cd2` (no executor notes read).

**Verdict: PASS.**

---

## 1. The shared predicate - proven real, by mutation

### 1.1 No duplicated `personName` filtering remains

```
grep -n "personName" apps/web/src/sales-ops/SalesOpsApp.tsx | grep -i "trim\|willPersist"
```
returns exactly one hit outside the predicate's own definition/uses:

```
3605:    .map((provider) => provider.personName.trim())
```

Read in context (`SalesOpsApp.tsx:3595-3606`): this is `legacyProviderNames`, built from `activeModal.product?.providers` inside the **produto dialog** - the deprecated `sales_ops_products.providers` read-only legacy list (per CLAUDE.md's "Produtos & Serviços" section). It has nothing to do with a wizard professional row and predates this slice entirely. Not a duplicate of the predicate under test.

The one true predicate, `professionalRowWillPersist(row: { personName: string })`, lives in `apps/web/src/sales-ops/calculations.ts:378-380` (`return row.personName.trim() !== ''`). Its three call sites in `SalesOpsApp.tsx`:

```
6045:  const professionalPeopleValid = professionals.every(professionalRowWillPersist);
6082:  const persistedProfessionals = professionals.filter(professionalRowWillPersist);
6093:      !professionalRowWillPersist(professional) &&   // hasUnsavedProfessionalRow
6689:      professionals: persistedProfessionals            // createPayload
```

`professionalCents` (line 6096) and the step-4 payables preview (line 6193) both consume the already-filtered `persistedProfessionals` array rather than re-testing `personName`. So the predicate is defined once and referenced everywhere the "will this row be sent" question is asked - genuinely shared, not duplicated.

### 1.2 Mutation: revert the cost-derivation site only

Edited `apps/web/src/sales-ops/SalesOpsApp.tsx` to change ONLY the `professionalCents` reduce from `persistedProfessionals.reduce(...)` back to `professionals.reduce(...)` (the pre-fix shape), leaving the payload filter, the gate, and the hint untouched.

Ran `pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/__tests__/sale-wizard-funcao-costs.test.tsx` (run-once) against the mutated tree:

```
Test Files  1 failed (1)
     Tests  1 failed | 39 passed (40)

 × produto-seeded profissional rows > shows a custo profissional the save will actually charge, in both directions
   AssertionError: expected 130000 to be +0 // Object.is equality
   ❯ src/sales-ops/__tests__/sale-wizard-funcao-costs.test.tsx:1314:54
     expect(panelFigureCents('Custos profissionais')).toBe(0);
```

Real counts: with two seeded personless rows (R$ 1.000 + R$ 300 = R$ 1.300 in cents = `130000`), the mutated panel showed `130000` where the test expects `0` immediately after `Salvar rascunho` with no pessoa picked - i.e. the mutation reproduces the exact bug (`professionalCents` counting rows the payload will not send). Exactly one test failed, and it is the parity test purpose-built for this defect; the other 39 (including the other two new tests) stayed green because they don't probe this exact panel/payload disagreement.

### 1.3 Restore

```
git checkout -- apps/web/src/sales-ops/SalesOpsApp.tsx
git status --short
```
Output after restore: only the pre-existing untracked `.vscode/`, `nexo/plans/...`, `nexo/runs/...` - no tracked-file diff. Mutation fully reverted.

**Conclusion: the fix is real and decisive.** The mutation is caught by name, with real before/after counts, and cleanly reverted.

---

## 2. Positive direction - a row WITH a pessoa still counts

Same test, `shows a custo profissional the save will actually charge, in both directions` (`sale-wizard-funcao-costs.test.tsx:1301-1327`), asserts three stages against the UNMODIFIED code:

```js
// stage 1: no pessoa picked
expect(savedProfessionalCents()).toBe(0);
expect(panelFigureCents('Custos profissionais')).toBe(0);

// stage 2 - positive control 1: ONE pessoa named
await pickOption('Profissional 1', 'Bruno Entrega');
await click(buttonByText('Salvar rascunho'));
expect(savedProfessionalCents()).toBe(100000);
expect(panelFigureCents('Custos profissionais')).toBe(100000);

// stage 3 - positive control 2: BOTH named
await pickOption('Profissional 2', 'Bruno Entrega');
await click(buttonByText('Salvar rascunho'));
expect(savedProfessionalCents()).toBe(130000);
expect(panelFigureCents('Custos profissionais')).toBe(130000);
expect(marginWithoutPeople - panelFigureCents('Margem líquida')).toBe(130000);
```

Confirmed this test passes on the unmodified branch tip (see the full-suite run in section 6, `sale-wizard-funcao-costs.test.tsx (40 tests)` all green). The test's own comment states the point explicitly: "Positive control 1: one pessoa named, and exactly that row's cents count. Without this, excluding EVERY row unconditionally would still pass above." So a one-directional (empty-only) implementation is explicitly ruled out by this test, not just by design intent.

---

## 3. The muted hint

Rendered at `SalesOpsApp.tsx:7828-7838`:

```jsx
{/*
  #6a6a72 and not #8b8b92: the lighter muted grey measures
  3.38:1 on white and fails WCAG AA (see nexo/ROADMAP.md).
*/}
{hasUnsavedProfessionalRow ? (
  <div className="mt-3 text-[12.5px] leading-5 text-[#6a6a72]">
    Profissionais sem pessoa selecionada não são salvos no rascunho.
  </div>
) : null}
```

Colour confirmed `#6a6a72`, not `#8b8b92` - `grep` shows exactly one `#6a6a72` at that hint site and the code comment cites the WCAG AA 3.38:1 failure of the alternative, matching `nexo/ROADMAP.md`'s color note.

`hasUnsavedProfessionalRow` (`SalesOpsApp.tsx:6091-6095`) is `true` iff some row is `!professionalRowWillPersist(row) && (funcaoId || funcaoName.trim())` - i.e. has a função but no pessoa. Both directions tested:

- **Shows it** - `warns that a row without a pessoa is not saved in a rascunho, and only then` (line ~1319): asserts the string is present with two seeded personless rows, stays present after only one gets a pessoa, and disappears once both do.
- **Does not show it for a genuinely blank new row** - `does not warn about a blank row the operator just added, until it names a funcao` (line ~1358): a fresh operator-added row with neither função nor pessoa shows no hint; the hint appears only once a função is picked on that row. Comment: "the warning tracks the loss, not the seeding."

Both directions pass in the full run (section 6).

---

## 4. ROADMAP line

`nexo/ROADMAP.md:17` (new line, confirmed present):

> `fix: a rascunho saved before the pessoas are picked permanently loses the produto's seeded funções. createPayload drops every row without a pessoa (the API rejects personName: ''), and on reopen if (!editSale) correctly refuses to re-seed, so the operator is back at the complaint batch batch-20260804-props-costs slice 04 opened. That slice only made the loss VISIBLE (a muted line in Profissionais alocados). Three candidate fixes, deliberately not chosen there: gate Salvar rascunho on professionalPeopleValid when any row exists (rejected for now...); let a personless row persist with a null person_id...; or persist the seeded (productId, funcaoId) keys with the draft...`

Matches the required description exactly: rascunho saved before pessoas are picked permanently loses the produto's seeded funções.

---

## 5. No regression from the prior PASS

`git diff master...HEAD --stat`:

```
CLAUDE.md                                          |  12 +-
apps/web/src/sales-ops/SalesOpsApp.tsx             | 178 ++++++++++--
.../__tests__/funcao-cost-seeding.test.ts          | 183 +++++++++++++
.../__tests__/sale-wizard-funcao-costs.test.tsx    | 297 +++++++++++++++++++++
apps/web/src/sales-ops/calculations.ts             |  85 ++++++
nexo/ROADMAP.md                                    |   1 +
6 files changed, 738 insertions(+), 18 deletions(-)
```

Same five files the prior verify checked plus `nexo/ROADMAP.md`, which is exactly the fix's own stated scope. The fix commit's diff (`feecbfa..9378cd2`, read directly above) touches only: the predicate, its three call sites, the hint block, its tests, `CLAUDE.md`'s paragraph, and `ROADMAP.md`. It does not touch:

- **Idempotency keying** - `seededFuncaoCostKeys` (`SalesOpsApp.tsx:5650`), the growing-set guard at `5946-5960`, untouched by the fix diff.
- **Deleted-row guard** - decoupled key-set-vs-row-array mechanism, untouched; `does not resurrect a seeded row the operator deleted` test still present and passing.
- **`if (!editSale)` discriminator** - `SalesOpsApp.tsx:5951`, byte-identical to the prior verify's citation, untouched by the fix diff.
- **Slice-03 interactions** - função-first column grid, `personPickerLocked` (`SalesOpsApp.tsx:7635`), and the seeded-row-enabled-picker behaviour: none of these lines appear in the fix diff; all 40 tests in `sale-wizard-funcao-costs.test.tsx` (29 pre-existing slice-03 + 8 slice-04 + 3 new fix-commit tests, one of which duplicated - see below) pass together in the full run.

**Coverage integrity:** `git diff master...HEAD -- '*test*' | grep -c "^-[^-]"` returns **0**. Not one test line was deleted across the whole batch (slice 04 base + fix). All new tests are additive.

---

## 6. Gates - full run, run-once, real tails

### `pnpm run lint` - exit 0

```
Scope: 4 of 5 workspace projects
packages/shared-types lint: no lint for shared-types ... Done
packages/shared-utils lint: no lint for shared-utils ... Done
apps/api lint$ eslint src/ ... Done
apps/web lint$ eslint src/ ... Done
```

### `pnpm run type-check` - exit 0

```
Scope: 4 of 5 workspace projects
packages/shared-types type-check$ tsc --noEmit ... Done
packages/shared-utils type-check$ tsc --noEmit ... Done
apps/api type-check$ tsc --noEmit ... Done
apps/web type-check$ tsc --noEmit ... Done
```

### `pnpm test` (full, not the web filter) - exit 0

```
packages/shared-utils test:  Test Files  2 passed (2)
packages/shared-utils test:       Tests  23 passed (23)
apps/api test:  Test Files  33 passed (33)
apps/api test:       Tests  323 passed (323)
apps/web test:  Test Files  45 passed (45)
apps/web test:       Tests  519 passed (519)
build-contract: ok
```

`apps/web` went from 515 (prior verify baseline) to 519 - the four new tests added by the fix commit (`professionalRowWillPersist admits...`, `shows a custo profissional...`, `warns that a row without a pessoa...`, `does not warn about a blank row...`), all passing.

`sale-wizard-funcao-costs.test.tsx` runs 40/40 including all 29 slice-03 blocks, all 8 slice-04 seeding blocks, and the 3 new parity/hint blocks.

Repo state after all gates: `git status --short` shows only the pre-existing untracked `.vscode/`, `nexo/plans/...`, `nexo/runs/...`; `git worktree list` shows only the main checkout. No commit, no merge.

---

## 7. CLAUDE.md accuracy and style

`CLAUDE.md`'s "Propostas domain" paragraph on produto-seeded profissionais now reads (diff against the prior-verify version):

> `draftValid` is deliberately still not gated on professionals, so `Salvar rascunho` stays reachable from step 1, and a personless row is dropped on the way out - the API declares `personName: z.string().min(1)`.
> That drop is expressed ONCE, by `professionalRowWillPersist` in `apps/web/src/sales-ops/calculations.ts`, which `createPayload`, the step-3 `professionalCents` sum and the `professionalPeopleValid` gate all reference: a personless row is excluded from BOTH the payload and the DISPLAYED cost, which is what keeps the `Margem líquida` on screen equal to the persisted `net_margin_brl`.
> ...remaining limitation is deliberate and filed in `nexo/ROADMAP.md`...

This matches the code exactly: verified in section 1 that `professionalRowWillPersist` has exactly those three consumers plus the payables-preview reuse of `persistedProfessionals`, and the money-parity claim is what section 1's mutation proves. No overclaim - CLAUDE.md does not claim the remaining limitation is fixed, and it isn't (ROADMAP line, section 4).

**Em dash check:** `git diff master...HEAD | grep '^+' | grep -c $'—'` returns **0**. No em dash added anywhere in the diff (CLAUDE.md's edit uses plain ` - ` throughout, consistent with the house style).

---

## 8. Overall verdict

**PASS.**

The blocking defect from `verify-04.md` section 5 is fixed at its root: one predicate, `professionalRowWillPersist`, now governs whether a professional row is sent, counted toward the displayed margin, and required by the step-3 gate. Mutating only the cost-derivation site reproduces the exact original bug (panel shows `R$ 1.300` of cost the payload drops) and is caught by a purpose-built test with real counts; restoring is clean. The positive direction (a row WITH a pessoa) is explicitly tested against a "drop everything" false-positive. The new hint fires only when a row has a função but no pessoa, is off for a genuinely blank new row, uses the correct `#6a6a72` (not the WCAG-failing `#8b8b92`), and both directions are tested. The remaining limitation (a rascunho saved pre-pessoa loses the seeded funções on reopen) is filed in `nexo/ROADMAP.md` with three candidate fixes, matching the fix commit's own stated scope decision. Nothing from the prior PASS regressed - idempotency keying, the deleted-row guard, the edit-path discriminator, and all five slice-03 interaction lines are untouched by the fix diff and still pass. Zero test lines deleted across the whole batch. All three gates green, run-once, from a clean repo state.
