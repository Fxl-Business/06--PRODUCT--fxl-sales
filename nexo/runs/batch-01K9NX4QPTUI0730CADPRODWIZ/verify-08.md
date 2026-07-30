# Verify 08 - produto wizard

Gate 2, independent adversarial review.
Branch `feat/08-produto-wizard`, uncommitted working tree, reviewed against `master` (`207f09f`).

**Verdict: PASS**

Diffstat: 5 files, +1178 / -589.
`apps/web/src/sales-ops/SalesOpsApp.tsx` plus four test files.
No source file outside `sales-ops` touched, no API change, no migration.

## 1. Commands, verbatim

| Command | Result |
| --- | --- |
| `pnpm test` | exit 0 |
| `pnpm run lint` | exit 0, `apps/api lint: Done` / `apps/web lint: Done`, zero errors or warnings |
| `pnpm run type-check` | exit 0, all four projects `Done` |

Counts:

```
packages/shared-utils   Test Files   2 passed (2)     Tests   23 passed (23)
apps/api                Test Files  29 passed (29)    Tests  300 passed (300)
apps/web                Test Files  39 passed (39)    Tests  393 passed (393)
```

Baseline was 386 web / 39 files and 300 api / 29 files.
Web is **+7 tests, same file count**; api is unchanged.
No drop anywhere.

`git diff | grep -E '\.skip|\.only|todo\(|xit\(|xdescribe'` returns nothing.
`git diff | grep '^+' | grep '—'` returns nothing, so no em dash was introduced.

Per-file `it()` counts, master versus branch:

| File | master | branch |
| --- | --- | --- |
| `product-service-dialog.test.tsx` | 39 | 46 |
| `product-commission-editor.test.tsx` | 5 | 5 |
| `combobox-adoption.test.tsx` | 18 | 18 |
| `optimistic-row-guard.test.tsx` | 12 | 12 |

The whole +7 is the new `describe('the produto wizard shell')`.
No test was deleted anywhere.
`areas-view.test.tsx` was not modified at all and still passes its 7 tests.

## 2. The decisive risk - silent field loss

Clean on all three sub-checks, proven four independent ways.

### 2.1 The payload construction is byte-identical to master

The `ProductForm` type (lines 3108-3138 branch / 3085-3115 master), the `productForm()`
seeder (3139-3185 / 3116-3162) and the entire `const payload: SaveProductPayload = {...}`
block (3605-3681 / 3464-3540) all `diff` to zero lines against master.
This is the strongest single result in the review: the restructure moved JSX only and
did not touch the state shape, the prefill, or the serialization.

Payload key sets, extracted and sorted from both sides:

```
master: 24 keys      branch: 24 keys      diff: identical
areaId codeSuffix defaultEntradaBrl defaultEntradaMode defaultEntradaPct
defaultPaymentMethod defaultRecurringCycles defaultRemainingInstallments
finderCommissionType finderCommissionValue hasMonthly id kind modules monthlyBrl
name productFuncaoCosts recurringCommission sellerCommissionType sellerCommissionValue
sellerWithFinderCommissionType sellerWithFinderCommissionValue setupBrl status
```

### 2.2 The payload-equivalence oracle exists, is complete, and is not tautological

`product-service-dialog.test.tsx > the produto wizard shell > emits the identical
SaveProductPayload for a fully filled produto`.

- It uses `toEqual`, not `toMatchObject`, so it fails on an **added** key as well as a
  dropped one. That is what would catch an accidental `providers: []` or a resurrected
  `openPrice`.
- It asserts on **24 keys**, exactly the 24 the payload constructs. No gap.
- It is not tautological: **22 of the 24 keys are driven to a value that differs from the
  form default** before submitting (`codeSuffix` 42 vs 0, `setupBrl` 250000 vs 0,
  `hasMonthly` true vs false, `recurringCommission` true vs false,
  `sellerCommissionType` fix vs pct, `sellerCommissionValue` 1200 vs 10,
  `sellerWithFinderCommissionValue` 8 vs 7, `finderCommissionType` fix vs pct,
  `finderCommissionValue` 400 vs 3, `defaultPaymentMethod` boleto vs pix,
  `defaultEntradaMode` pct vs none, `defaultRemainingInstallments` 6 vs 1,
  `defaultRecurringCycles` 12 vs null, two `productFuncaoCosts` rows and one `modules`
  row against empty arrays, and so on).
  The only two that coincide with a default are `kind: 'product'` and
  `sellerWithFinderCommissionType: 'pct'`, and both have their own dedicated tests
  (`sends kind service when the serviço segment is active`, `preserves fixed type and
  value controls across switching, save, and reopen`).
- Because the test walks 1 to 2 to 3 to 4 and touches a control on each step, it doubles
  as a reachability proof for the whole form in one pass.

### 2.3 Independent field inventory, master versus branch

I enumerated the fields myself rather than trusting the oracle.

`ProductForm` declares **21** fields on both sides (identical type):
`name, areaId, codeSuffix, kind, setupBrl, hasMonthly, monthlyBrl, recurringCommission,
sellerCommissionType, sellerCommissionValue, sellerWithFinderCommissionType,
sellerWithFinderCommissionValue, finderCommissionType, finderCommissionValue,
defaultPaymentMethod, defaultEntradaMode, defaultEntradaValue,
defaultRemainingInstallments, defaultRecurringCycles, modules, funcaoCosts`.

Distinct `form.<field>` references in the rendered dialog body:

```
master (single page, 3560-4118): 20     branch (four steps, 3745-4298): 20
present on master but not branch: (none)
present on branch but not master: (none)
```

The twenty-first field, `kind`, is rendered on both sides through the derived
`const isService = form.kind === 'service'` and the
`Classificar como produto` / `Classificar como serviço` segmented pair.
**21 on master, 21 on the branch, same set.**

Per-step reachability, so nothing lives in state without a control:

| Step | Label | Fields rendered |
| --- | --- | --- |
| 1 | Identificação | `kind` (via `isService`), `name`, `areaId`, `codeSuffix` |
| 2 | Valores | `setupBrl`, `hasMonthly`, `monthlyBrl`, `recurringCommission`, `modules` |
| 3 | Pagamento | `defaultEntradaMode`, `defaultEntradaValue`, `defaultRemainingInstallments`, `defaultPaymentMethod`, `defaultRecurringCycles` (+ reads `hasMonthly`) |
| 4 | Comissões e custos | `sellerCommissionType/Value`, `sellerWithFinderCommissionType/Value`, `finderCommissionType/Value`, `funcaoCosts` |

4 + 5 + 5 + 7 = 21. Every field is on exactly one step. None orphaned.

### 2.4 Visible-string inventory

An independent cross-check on labels rather than state. Every `aria-label`,
`placeholder`, `title`, `subtitle` and `label` literal in the produto dialog:

```
master: 31 strings      branch: 32 strings
present on master, absent on branch: (none)
new on branch: title="Salvar sem passar pelos próximos passos"
```

Not one operator-visible label was lost. The single addition is the new mid-wizard save
button's tooltip.

### 2.5 The edit path

- `renderDialog({ existing })` renders `Passo 1 de 4`, `nameInput().value === 'FXL Finance'`
  and `comboboxText('Área do produto') === areaFixture.name`, so an existing produto lands
  on step 1 fully prefilled.
- `Salvar alterações` is rendered in the footer for `activeModal.product && wizardStep < 4`
  as `type="submit"`, so an existing record is savable from steps 1, 2 and 3 without
  walking to step 4; on step 4 the primary button carries the same label.
  Pinned by `lands on step 1 with an existing produto prefilled and saves from any step`,
  which asserts `onSave` receives `{ id: existing.id, name: 'FXL Finance' }`.
- A **new** produto deliberately gets no mid-wizard save, pinned by `offers no mid-wizard
  save for a new produto` across steps 1-3. Reasonable: the create path shows the
  commission and cost defaults at least once.
- Prefill correctness is guaranteed structurally, since `productForm()` is byte-identical
  to master.

## 3. Step order - the operator's explicit requirement

**Met.** `Plano de pagamento padrão` is the first section of step 3; `Setup (R$)` /
`Valor base (R$)` and `Possui mensalidade` are on step 2. 3 is strictly after 2.

Pinned directionally in both halves by `puts Plano de pagamento padrão on a step after the
mensalidade controls`, which asserts step 2 contains `Possui mensalidade` and does **not**
contain `Plano de pagamento padrão`, then that step 3 contains the plan and does **not**
contain the mensalidade switch. Two-sided, so it cannot pass against an empty render.

The ordering is also a real data dependency, not only taste: `Número de ciclos` on step 3
only exists while `hasMonthly` is on, and that switch is on step 2.

The stepper's rendered order is separately pinned by an index-monotonicity assertion in
`renders the four numbered steps in order on the proposta wizard shell`.

## 4. Changed-assertion audit

I diffed all four touched test files against master and classified every non-setup line.

**No assertion was weakened or deleted. Three were strengthened.**

### `product-service-dialog.test.tsx`

| Change | Verdict |
| --- | --- |
| `- await chooseArea();` replaced by `await fillIdentity()` earlier in the test, x11 | **Not a weakening.** `fillIdentity()` calls `change(nameInput(), name)` then `chooseArea()`, and `chooseArea()` still carries its own `expect(comboboxText('Área do produto')).toBe(areaFixture.name)`. The assertion is relocated, and a name assignment is added on top. Strictly a superset. |
| `hides the ciclos field...`: `- await chooseArea();` plus `+ expect(labeledInput('Parcelas restantes')).toBeInstanceOf(HTMLInputElement)` | **Strengthened.** A positive control was added so the `toBeNull()` above it cannot pass merely because the plan step is unmounted. This is exactly the failure mode a step split introduces, and the test now guards it. |
| `does not reintroduce any control the payment plan builder removes`: `const rendered = text()` became `let rendered`, accumulated across all four steps | **Strengthened, and materially so.** The naive adaptation would have left the `not.toContain` sweep looking at one step and silently gone blind to the other three. Instead it now sweeps every step, so a resurrected `Dividir em` / `+ parcela` / `Remover parcela` cannot hide behind an unmounted step. Best judgement call in the diff. |
| `renderDialog()` now does `await act(async () => root.render(null))` first | **Correctness fix, not a weakening.** `ProductDialog`'s key is identical for two identical create rows, so `clamps a hand-typed parcela count to the ceiling at submit` (which renders twice) was previously inheriting the first render's form state. It now genuinely remounts. Makes that test stricter. |
| ~60 added `fillIdentity()` / `goToStep(n)` lines | Pure navigation setup. Legitimate. |
| New helpers `nameInput`, `fillIdentity`, `stepLabels`, `stepButton`, `goToStep`, `codeSuffixInput`, `addModule` | Additive. |
| New `describe('the produto wizard shell')`, 7 tests | Additive, and it is where the real new coverage lives. |

### `product-commission-editor.test.tsx`

| Change | Verdict |
| --- | --- |
| `- await chooseArea();` replaced by `await fillIdentity()` moved to the top of the test, x2 | Relocation, superset, same reasoning as above. |
| Added `fillIdentity()` / `goToCommissionStep()` in 5 tests | Setup. |
| Every `expect(...)` byte-identical to master | Confirmed. |

### `combobox-adoption.test.tsx` and `optimistic-row-guard.test.tsx`

Additive only: two helpers plus a `fillIdentity` + navigate-to-step-4 preamble in
`combobox-adoption`, and an inline eight-line preamble in `optimistic-row-guard`.
**Not one `expect` line changed in either file.**

## 5. CLAUDE.md rules

All preserved. The governing logic block (branch 3459-3536) is unchanged from master;
only the JSX around it was relocated.

| Rule | Result |
| --- | --- |
| `selectableAreas` prepends an archived-but-current área | Intact. The área `Combobox` moved into step 1 with `options={areaOptions(selectableAreas)}` and `onCreate` unchanged (the only diff on those two lines is indentation). |
| A new função cost row draws from active non-system funções only | Intact. `eligibleFuncoes = funcoes.filter(f => f.status === 'active' && !f.isSystem)`, unchanged. Pinned by `never offers a system função as a cost default` and `never offers an archived função for a new row`. |
| A row's own stored função stays selectable, labelled `(arquivada)` | Intact. `costRowFuncaoOptions` still prepends `current` from the unfiltered `funcaoById`. Pinned, with `goToStep(4)` added. |
| Unresolvable `funcaoId` reads `Função não encontrada`, never a raw id | Intact via `costRowFuncaoValueLabel`. Pinned. |
| **No `onCreate` on the função-cost picker** | Confirmed. `grep 'onCreate'` over the whole step-4 block (4081-4298) returns nothing. The empty state still points at `Cadastros > Funções`. |
| Deprecated `providers` shown read-only | Intact. `legacyProviderNames` renders the `Prestadores antigos deste cadastro...` notice inside the cost section on step 4. Pinned. |
| Product writes **OMIT** `providers`, never `[]` | Confirmed twice: the payload block is byte-identical and still carries the omission comment, and both `expect(payload).not.toHaveProperty('providers')` and the `toEqual` oracle (which fails on any extra key) guard it. |
| `defaultEntradaMode` literal is `'fix'`, never `'fixed'` | Confirmed. `grep -c "'fixed'"` over `SalesOpsApp.tsx` returns **0**. |
| Blank `Número de ciclos` means indeterminado, no checkbox | Intact. Pinned by `treats a blank ciclos as prazo indeterminado and shows no checkbox`, now correctly navigating step 2 (switch) then step 3 (ciclos). |
| 120 / 119 parcela cap | Intact. `parcelasCeiling = maxRemainingInstallments(form.defaultEntradaMode)` and the submit clamp are unchanged. Both cap tests pass. |
| No native `<select>` / `<option>` / `<datalist>`; `Combobox` everywhere | Lint clean, so `no-restricted-syntax` did not fire. `datalist#sales-ops-collaborators` still asserted null. |

## 6. Slice 07's zero-state

**Survived.** `productForm()` still seeds through `centsToOptionalInput` for both
`setupBrl` (3150) and `monthlyBrl` (3152), so a stored 0 seeds blank, and
`placeholder={isService ? 'Definido na venda' : '0'}` is present on both inputs
(3853 and 3884). The two slice-07 tests are intact with only a `goToStep(2)` added, and
still assert `base.value === ''` and the placeholder text.

## 7. No `calc(...vh-...)` body height

**Clean.** The shell is the flex-column pattern:

```
wizardDialogContentClass = 'flex h-[92vh] max-h-[92vh] w-[calc(100vw-48px)] max-w-[940px] flex-col ... overflow-hidden ...'
wizardBodyClass          = 'min-h-0 flex-1 overflow-y-auto px-[26px] py-6'
wizardHeaderClass / wizardFooterClass / stepper: all shrink-0
```

The only `calc()` is `w-[calc(100vw-48px)]`, a width, inherited verbatim from master's
proposta wizard. The new shell test asserts `body.className` does not contain `calc(` and
that the body carries `min-h-0 flex-1 overflow-y-auto` while the stepper and footer carry
`shrink-0`.

## 8. Adversarial revert

Backed up `SalesOpsApp.tsx`, ran `git checkout master -- apps/web/src/sales-ops/SalesOpsApp.tsx`
leaving the branch's tests in place, and re-ran the suite:

```
Test Files  1 failed (1)
     Tests  38 failed | 8 passed (46)
```

The oracles fail, and **for the right reason**: `Error: step button not found: Valores`,
`expected '...' to contain 'Passo 1 de 4'`. The captured single-page render text confirms
master's layout, one long scroll ending in `Cancelar / Salvar alterações` with no stepper.
The 8 that still pass are the ones that never navigate (`sends kind and never sends
openPrice`, etc.), which is expected.

Restored from the backup; `shasum -a 256 -c` reports `OK` (byte-identical), and
`git status --porcelain` matches the five modified files and three untracked entries
found at the start. Nothing was left mutated.

No process was left running: both `pnpm test` and the scoped `vitest run` are run-once
invocations and exited.

## 9. UI judged on its merits

**The chrome really is the proposta wizard's.** This is not a lookalike: the two dialogs
now share six literal constants (`wizardDialogContentClass`, `wizardHeaderClass`,
`wizardBodyClass`, `wizardFooterClass`, `wizardSecondaryButtonClass`,
`wizardPrimaryButtonClass`) plus one `WizardStepper` component. Width goes from
`max-w-[640px]` on white to the shared `max-w-[940px]` on `#f4f4f6`. Four numbered steps,
green-check for done and amber for active, `Passo N de 4`, `Voltar` invisible on step 1.
The operator's ask is answered structurally rather than cosmetically, so the two cannot
drift apart later.

**Per-step validation is sensible and cannot be bypassed.** Three independent gates:
`Avançar` is `disabled` while `wizardStep === 1 && !canAdvanceStepOne`; the stepper's
`isEnabled={(step) => step === 1 || canAdvanceStepOne}` disables steps 2-4;
`advanceProductWizard()` re-guards. There is no route to a later step with an invalid step
1, and `blocks Avançar until nome and área are both filled` pins all of it including the
one-field-only negative cases. The gate is also correctly scoped: steps 2-4 add none of
their own, because every value on them has a legitimate zero state.

**The gate is strictly stronger than master's.** Master guarded on `!form.areaId` alone
and leaned on the `required` attribute for the name. Since `Nome` is unmounted on steps
2-4 now, `required` cannot fire there, and the branch correctly replaces it with an
explicit `if (!canAdvanceStepOne) { setShowIdentityErrors(true); setWizardStep(1); return; }`
in `submit()`. A nameless produto was reachable on master via a programmatic submit; it is
not now.

**The proposta wizard's DOM is unchanged.** I checked each extracted constant against the
literal it replaced and each is character-for-character identical, and `WizardStepper`
reproduces master's inlined stepper markup exactly, with the `disabled` predicate
correctly inverted into `isEnabled` (De Morgan, verified term by term).
`sale-wizard-shell-layout.test.tsx` and the five other sale-wizard suites pass unmodified,
which is independent confirmation.

**`DialogSection` gained an optional `flush` prop**, default off, used on exactly two
sections (`Plano de pagamento padrão`, `Comissionamento padrão`) that are first on their
step and so have nothing above to be separated from. The two **repeating** sections
(`Módulos`, `Custos padrão por função`) deliberately keep the `border-t`, which is what
keeps the tests' `closest('div.border-t')` lookup resolving. Correctly reasoned and
correctly applied.

## 10. Findings

No blocking findings. Three minor ones, all advisory.

**F1 (minor, dead-ish code plus an inaccurate comment).** The `showIdentityErrors` inline
messages (`Informe o nome do produto.` / `Selecione a área.`) are effectively unreachable
through real browser interaction. `Avançar` is disabled while step 1 is invalid so its
`onClick` cannot fire; `Salvar alterações` exists only on the edit path and is itself
`disabled={!canAdvanceStepOne || saving}`; and a new produto has **no** submit button at
all on steps 1-3. The test's justifying comment claims the route is "the implicit form
submission Enter gives them from either field", but step 1 has **two** implicit-submission-
blocking text inputs (`Nome` and the code-suffix `input type="text"`), and per the HTML
spec a form with no submit button and more than one such field does not implicitly submit.
The test passes only because its `submit()` helper dispatches a synthetic submit event
directly. Not a regression and not a correctness bug: the operator still sees a red `*` on
both required fields and a disabled `Avançar`, and the guard is sound defence in depth
against a programmatic submit. But the comment overstates the reachability and should be
corrected, or the gate softened so the messages are genuinely reachable.

**F2 (cosmetic, 2px).** The proposta wizard's `Salvar rascunho` uses an inline
`px-[18px]`, while the produto wizard's equivalent `Salvar alterações` uses
`wizardSecondaryButtonClass`, which is `px-5` (20px). Given that this slice's whole point
is making the two read as one piece of chrome, the proposta's literal is now the odd one
out and could fold into the shared constant.

**F3 (deliberate asymmetry, worth a decision).** The produto footer adds a `Cancelar`
button on step 1 that the proposta wizard does not have. It preserves the old produto
dialog's affordance, so it is defensible, but it is a visible difference between two
dialogs that are otherwise pixel-identical.

**Scope creep: none.** The only work outside the produto dialog is the shell-constant and
`WizardStepper` extraction, which is the correct mechanism for the operator's "same
chrome" ask rather than a copy-paste, and I verified it is behaviour-preserving and
DOM-identical for the proposta wizard.
