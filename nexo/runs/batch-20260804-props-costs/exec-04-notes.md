# exec-04 notes - 04-prefill-profissionais-do-produto

Branch `feat/04-prefill-profissionais-do-produto`, run after `03-profissional-picker-funcao-first` merged to master.

## What shipped

- `planFuncaoCostSeeds` + `funcaoCostSeedKey` in `apps/web/src/sales-ops/calculations.ts`, pure and total, exactly as D1 specified.
- A fifth render-phase guard in `SaleWizardDialogBody`, wrapped in `if (!editSale)`, placed immediately after the `funcaoCostKey` guard.
- `seededFuncaoCostKeys` as `useState<string[]>`, never a render-mutated ref.
- `seedableFuncaoCosts` memo filtering the seed input by `allocatableFuncoes`, leaving `buildFuncaoCostBasis` unfiltered.
- `aria-label={`Remover profissional ${index + 1}`}` on the icon-only delete button, which had no accessible name at all.
- One new pure test file and one new `describe` block in the existing DOM file.
- Two CLAUDE.md edits inside `## Propostas domain`.

## Where the plan disagreed with the post-slice-03 code

### 1. D6 was already half-implemented by slice 03. Reused, not duplicated.

The plan told me to split `professionalsValid` into a função predicate and a pessoa predicate and to add a second banner.
Slice 03 had already done exactly that: `professionalFuncoesValid` / `professionalPeopleValid` at `SalesOpsApp.tsx:5941-5952`, two separate `showCostErrors`-gated bars at `7696-7705`, and the pessoa string `Selecione a pessoa de cada profissional alocado.`.
I added nothing.
A seeded row arrives with a `funcaoId`, so it satisfies `professionalFuncoesValid` on arrival and is stopped only by the pessoa bar, which is precisely the gate D6 asked for.

### 2. The pessoa banner stays gated on `showCostErrors`. The plan wanted it ungated.

The plan's argument was that a seeded row is the app's proposal and not yet anybody's mistake, so it should explain itself the moment step 3 renders.
That argument was written when the ONLY person-less row was a seeded one.
Slice 03 removed the `allocatablePeople[0]` seed from `+ profissional`, so a hand-added row is now person-less too, and ungating would fire a red error bar the instant the operator clicks `+ profissional`, before they have done anything wrong.
Keeping slice 03's gating is the choice that treats both row kinds the same way. `Avançar` is what surfaces the bar, and it is a single click away.

### 3. `draftValid` was NOT gated on professionals. Slice 03's `createPayload` drop governs.

The plan wanted `draftValid && professionalsValid` plus an explanatory `title` on `Salvar rascunho`.
Two of its premises no longer hold:

- It claimed "blast radius is nil for rows the operator adds, because `+ profissional` seeds `personId` from `allocatablePeople[0]`". Slice 03 deleted that seed, so the clause would also disable the button for any freshly added row.
- With seeding live, EVERY new proposta on a produto that declares função costs would open with `Salvar rascunho` disabled from step 1, for rows the operator has not even seen yet. That inverts the plan's own principle (a seeded row is the app's proposal, not the operator's mistake) into a punishment, and breaks the dialog's stated promise `salve como rascunho a qualquer momento`.

So the reconciliation is: **slice 03's `createPayload` drop governs the submit path, and `draftValid` is unchanged.**

The plan's strongest reason for blocking was margin parity: `professionalCents` counts a seeded row, so dropping it at submit could persist a margin larger than the one the operator read.
That hole is closed by the step-3 gate rather than by `draftValid`: step 4, where the Revisão card states the margin, is unreachable while any row lacks a pessoa.
The residual case is an operator who reads the step-3 margin panel and then clicks `Salvar rascunho` from step 3 without clicking `Avançar`. That is narrow, it produces a RASCUNHO rather than an approved proposta, and closing it would have cost the blanket disable above.
I rewrote the `createPayload` comment so this is stated in the code rather than left to the notes, because the old comment's justification ("the drop loses nothing addressable") became false the moment rows started being seeded.

### 4. The plan's DOM test 4 asserted behaviour its own D1 forbids.

The plan wrote: delete both seeded rows, add `Desenvolvedor` by hand, then add a `Landing Page` item, and expect no new row "because Landing Page declares only Testador, whose key was already recorded".
Under D1 the recorded key is `custom::tester`, not `landing::tester`, so `landing::tester` IS new and a Testador row WOULD be seeded. The parenthetical is a slip, not a spec.
I kept D1 verbatim (per-produto keying is the whole point of the key shape) and rewrote the test to pin the invariant it was named for: allocate **Testador** by hand, then add `Landing Page`, and assert exactly one row survives, because the ROW dedup is per função.
The behaviour the plan's prose accidentally described (a new produto's own declaration proposes a row) is correct and deliberate: that is what makes adding a produto mid-draft useful.

### 5. Line numbers throughout section 1 and section 2 are stale.

Every site was located by identifier and surrounding code, as instructed. Nothing else in the plan changed meaning.

## Idempotency, as actually implemented

| Event | Result |
| --- | --- |
| Re-render | Nothing. Every key is already in `seededFuncaoCostKeys`. |
| Item value edited | No new row; the existing seeded row re-derives through the `funcaoCostKey` guard, because it is `costManual: false`. |
| Seeded row deleted | Stays deleted for the session. The key was recorded at seed time and is never removed. |
| Função already allocated by hand | Key recorded, no row. |
| Two produtos declare the same função | Two keys, one row, summed cents. |
| Produto removed then re-added | No re-seed. |
| A different produto declares an unallocated função | New key, new row. This is the feature. |
| Saved proposta reopened | Nothing seeded, ever. `if (!editSale)`. |

## Gates

- `pnpm run lint` - green
- `pnpm run type-check` - green
- `pnpm --filter @fxl-sales/web test` - 45 files, 515 tests, green
- also ran full `pnpm test` - api 323, shared-utils 23, web 515, build-contract ok

The 29 pre-existing `it()` blocks in `sale-wizard-funcao-costs.test.tsx` were migrated by the plan's single mechanical helper (`clearSeededProfessionals`, called as the first line of `addProfessional`). No test was deleted or weakened.
