# Exec 04 - fix - margin parity for produto-seeded profissional rows

Targeted fix after the Gate 2 FAIL in `verify-04.md`, section 5.
Branch `feat/04-prefill-profissionais-do-produto`, one additional commit on top of `feecbfa`.
Nothing else from that report was touched: idempotency, the deleted-row guard, the `if (!editSale)` discriminator, coverage integrity and the slice-03 interactions are all unchanged.

## The defect

A produto-seeded profissional row has no pessoa yet.
`createPayload` drops such a row (the API declares `personName: z.string().min(1)`), but `professionalCents` still counted it, and `professionalCents` is what feeds `computeSaleFinancials` on screen.
So step 3 showed `Margem líquida R$ 15.500 / Custos profissionais R$ 1.300` while `Salvar rascunho`, in that same footer, sent `professionals: []` and the API persisted `net_margin_brl = R$ 16.800`.
CLAUDE.md pins that those two numbers are equal; this slice broke it by default for every proposta whose produto declares a função cost.

The cause is duplication: `personName.trim() !== ''` was spelled at the payload call site and nowhere else, so the sum simply never learned the rule.

## Part 1 - one predicate, two references

`professionalRowWillPersist(row)` is new in `apps/web/src/sales-ops/calculations.ts`, beside `resolveProfessionalCostCents`.
It is the single expression of "this row is going to be sent", and it now has three references and no duplicates:

- `createPayload` filters the payload with it (via `persistedProfessionals`).
- `professionalCents` sums over the same filtered array, so the panel and the payload cannot diverge.
- `professionalPeopleValid` is now `professionals.every(professionalRowWillPersist)` rather than its own inline `Boolean(personName.trim())`.

`payablesPreview` was switched to the same array for consistency.
That is behaviour-neutral today - step 4 is unreachable while any row lacks a pessoa - but it removes the last place a personless row could be described as a payable.

Nothing about the money changed: `professionalRowCents` and `buildFuncaoCostBasis` are untouched, and a row rejoins the sum the instant it names a pessoa.

## Part 2 - the rascunho loss is now visible

`draftValid` still does not gate on professionals, deliberately: CLAUDE.md pins that a rascunho stays saveable from step 1 and slice 03 depends on it.
So the loss is surfaced instead of prevented.

`hasUnsavedProfessionalRow` is true while at least one row carries a função and no pessoa, and renders one muted pt-BR line inside `Profissionais alocados`:

> Profissionais sem pessoa selecionada não são salvos no rascunho.

`#6a6a72` (5.36:1), not `#8b8b92` (3.38:1, fails WCAG AA per `nexo/ROADMAP.md`).
It tracks the LOSS, not the seeding: a freshly added blank row does not raise it, and the same row does the moment it names a função.

The underlying limitation - a rascunho saved before the pessoas are picked loses the produto's seeded funções permanently - is filed in `nexo/ROADMAP.md` with the three candidate fixes the verify report listed, and is deliberately out of scope here.

## Oracle - mutations of the new code

Each applied alone, then reverted.

| # | Mutation | Result |
| --- | --- | --- |
| A | `professionalCents` reduces over `professionals` again instead of `persistedProfessionals` (the exact reported regression) | 1 failed / 39 passed, exactly `shows a custo profissional the save will actually charge, in both directions`, at the `Custos profissionais === 0` assertion (`expected 130000 to be +0`) |
| B | `professionalRowWillPersist` returns `true` unconditionally | 7 failed / 44 passed across both files: the unit test, the parity test, both new warning tests, both `Avançar` gate tests and the slice-03 função gate test - proving the predicate really is the one seam all three consumers read |
| C | the new hint's condition forced to `false` | 2 failed / 38 passed, exactly the two warning tests |

Mutation B is the important one: because the predicate is now shared, flipping it keeps the panel and the payload in agreement, and the parity test still fails - on the payload assertion (`savedProfessionalCents() === 0`), which is what makes the test an oracle for the rule rather than only for the equality.

The parity test asserts BOTH directions, so excluding every row unconditionally cannot pass it: zero pessoas is 0, one pessoa is exactly R$ 1.000, both is R$ 1.300, and the displayed `Margem líquida` falls by exactly the R$ 1.300 the payload then carries.

## Coverage

| File | before | after |
| --- | --- | --- |
| `sale-wizard-funcao-costs.test.tsx` | 37 | 40 |
| `funcao-cost-seeding.test.ts` | 10 | 11 |

No test line deleted; every change is additive.

`apps/web/src/sales-ops/__tests__/sale-margin-parity.test.ts` was reviewed and deliberately NOT extended.
It is a golden fixture mirrored against `apps/api/src/domains/sales-ops/__tests__/sale-margin-parity.test.ts` and pins `computeSaleFinancials` itself, which this fix does not touch: the defect was in which rows the wizard feeds it, not in the function.
That question is render-level and is pinned in the wizard suite.

## Gates

Run once each, from the repo root.

```
pnpm run lint        exit 0
pnpm run type-check  exit 0
pnpm test            exit 0
  packages/shared-utils  2 files / 23 tests
  apps/api              33 files / 323 tests
  apps/web              45 files / 519 tests   (was 515)
  build-contract: ok
```

No em dash in any added line; no native picker added.
