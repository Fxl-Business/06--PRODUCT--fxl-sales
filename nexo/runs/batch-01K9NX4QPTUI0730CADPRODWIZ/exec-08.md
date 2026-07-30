# exec-08 - produto/serviço dialog becomes a stepped wizard

Slice: `08-produto-wizard`.
Branch: `feat/08-produto-wizard`.
Plan: `nexo/plans/batch-01K9NX4QPTUI0730CADPRODWIZ/08-produto-wizard.md`.

## What changed

`ProductDialogBody` in `apps/web/src/sales-ops/SalesOpsApp.tsx` went from one 640px column of eight stacked sections to a 940px four-step wizard wearing the proposta wizard's chrome.
No field was added, removed, renamed or re-typed, and the emitted `SaveProductPayload` is byte-for-byte what the single-page dialog emitted for the same inputs.

### Shared chrome extracted

Seven module-level constants next to `formInputClass`, all lifted verbatim from `SaleWizardDialogBody`:

- `wizardDialogContentClass` (940px, `rounded-[22px]`, `bg-[#f4f4f6]`, the `[&>button]:` close-button block)
- `wizardHeaderClass`, `wizardBodyClass`, `wizardFooterClass` - all three carrying the `shrink-0` / `min-h-0 flex-1 overflow-y-auto` shape slice 02 left in place. No `calc(...vh-...)` was reintroduced anywhere.
- `wizardSecondaryButtonClass`, `wizardPrimaryButtonClass`
- `wizardStepCardClass` - new, the `rounded-[14px] border border-[#e8e8ec] bg-white p-4` card the proposta wizard already puts its step content on. Needed because adopting `bg-[#f4f4f6]` on the shell would otherwise have left the produto step content grey on grey.

`WizardStepper<S extends number>` is a new module-level component placed just above `ProductDialog`, holding the stepper bar markup verbatim.
`SaleWizardDialogBody` now calls it with `isEnabled` returning the negation of the three-clause `disabled` expression it used to inline.

The footer and the header were deliberately NOT extracted, per the plan: the produto dialog builds its own footer from the class constants and keeps its bespoke `Fechar` X, now absolutely positioned at `right-[26px] top-[31px]` against a `relative` header, exactly where the wizard puts Radix's.

### The step split

| Step | Label | Contents |
|---|---|---|
| 1 | `Identificação` | yellow "tudo aqui é padrão" banner, `Produto \| Serviço` segmented pair, Nome, Área (side by side in a 2-col grid), `Final do código da venda` |
| 2 | `Valores` | Setup / `Valor base (R$)`, the mensalidade card (`Possui mensalidade` + `Valor da mensalidade` + `Incide sobre recorrente`), `Módulos` (produto only) |
| 3 | `Pagamento` | the whole `Plano de pagamento padrão` section: `Tipo de entrada`, `Valor da entrada`, `Parcelas restantes`, `Forma de pagamento padrão`, `Número de ciclos`, the blank-ciclos hint, the green plan summary strip |
| 4 | `Comissões e custos` | `Comissionamento padrão` (scenario pills + both commission pairs), `Custos padrão por função` (+ the read-only legacy prestador footer) |

The operator's hard constraint is satisfied structurally: `Pagamento` is step 3, strictly after `Valores` on step 2, so the plan builder cannot be reached before Setup and Mensalidade are settled.

`DialogSection` gained one optional `flush` prop that drops the `border-t pt-4` separating rule, used by the two sections that are now the FIRST thing on their step (`Plano de pagamento padrão`, `Comissionamento padrão`).
Every repeating section keeps its rule, which is what keeps the tests' `closest('div.border-t')` resolving each `Adicionar` button.

### Validation

Exactly one new gate, as planned:

```ts
const nameValid = Boolean(form.name.trim());
const areaValid = Boolean(form.areaId);
const canAdvanceStepOne = nameValid && areaValid;
```

- `Avançar` is `disabled={saving || (wizardStep === 1 && !canAdvanceStepOne)}`.
- `WizardStepper`'s `isEnabled` is `step === 1 || canAdvanceStepOne`, so steps 2-4 cannot be jumped to from an incomplete step 1.
- `submit()` replaced `if (!form.areaId) return;` with `if (!canAdvanceStepOne) { setShowIdentityErrors(true); setWizardStep(1); return; }`.
- `Informe o nome do produto.` / `Selecione a área.` render under the offending control with `aria-invalid` and `border-destructive`, using the wizard's existing recipe.

### Edit path

`ProductDialog`'s remount key is untouched, so `useState<1|2|3|4>(1)` in the same component means an existing produto lands on step 1 fully prefilled with no extra effect.
A secondary `Salvar alterações` button occupies the slot the proposta wizard gives `Salvar rascunho`, mounted only when `activeModal.product` is truthy and only on steps 1-3, `type="submit"`, `disabled={!canAdvanceStepOne || saving}`.
A NEW produto gets no such button, so the create path walks all four steps.

The whole step tree stays inside ONE `<form onSubmit={submit}>`, so an unmounted step's values are ordinary React state and a submit from any step emits the complete payload.

## Field inventory - completed checklist

Verified mechanically by locating each marker inside `ProductDialogBody` and reporting which `wizardStep === N` block it falls in.

### Form state (21/21)

| # | Key | Step |
|---|---|---|
| F01 | `kind` | 1 |
| F02 | `name` | 1 |
| F03 | `codeSuffix` | 1 |
| F04 | `areaId` | 1 |
| F05 | `setupBrl` | 2 |
| F06 | `hasMonthly` | 2 |
| F07 | `monthlyBrl` | 2 |
| F08 | `recurringCommission` | 2 |
| F09 | `sellerCommissionType` | 4 |
| F10 | `sellerCommissionValue` | 4 |
| F11 | `sellerWithFinderCommissionType` | 4 |
| F12 | `sellerWithFinderCommissionValue` | 4 |
| F13 | `finderCommissionType` | 4 |
| F14 | `finderCommissionValue` | 4 |
| F15 | `defaultPaymentMethod` | 3 |
| F16 | `defaultEntradaMode` | 3 |
| F17 | `defaultEntradaValue` | 3 |
| F18 | `defaultRemainingInstallments` | 3 |
| F19 | `defaultRecurringCycles` | 3 |
| F20 | `modules[]` | 2 |
| F21 | `funcaoCosts[]` | 4 |

### Derived / local (11/11)

L01 `commissionMode` step 4; L02 `createdAreas` and L03 `selectableAreas` reach the step-1 área picker (`areaOptions(selectableAreas)`); L04 `eligibleFuncoes` and L05 the `Adicionar` gate (`addDisabled`, `addTitle`) step 4; L06 `costRowFuncaoOptions` and L07 `costRowFuncaoValueLabel` step 4; L08 `legacyProviderNames` step 4; L09 `parcelasCeiling` step 3 (`max={parcelasCeiling}`); L10 `planSummary()` step 3; L11 `isService` unchanged and read on steps 1, 2 and in the title.

### Copy blocks (15/15)

C01 title and C02 description are in the header, outside the step blocks (four-way and two-way branches intact).
C03 step 1, C04 already removed by slice 07 (pinned by the still-passing `not.toContain('Serviços têm valor variável')`), C05 step 1, C06/C07 step 2, C08/C09 step 4, C10/C11 step 3, C12/C13 step 4, C14 step 2, C15 in the footer.

### Submit transforms (13/13)

S01 (now the symmetric `canAdvanceStepOne` guard), S02, S03, S04, S05, S06, S07, S08, S09, S10, S11, S12, S13 - all present and unmodified except S01.
`providers:` appears nowhere in the payload; `openPrice` appears only inside the explanatory comment.

### CLAUDE.md preserved-rules checklist

- [x] `selectableAreas` still prepends the archived-but-current área and appends `createdAreas`.
- [x] `onCreate` still wired on the área picker, only when `onCreateArea` is passed.
- [x] A NEW função cost row still draws from active, non-system funções.
- [x] A função already used by another row is still filtered out.
- [x] A row's OWN stored função stays selectable and is labelled `(arquivada)`.
- [x] An unresolvable `funcaoId` still reads `Função não encontrada`.
- [x] The função-cost picker still has NO create row; the empty state still points at `Cadastros > Funções`.
- [x] `providers` still surfaced read-only and still OMITTED from the payload.
- [x] The entrada literal is still `'fix'`, never `'fixed'`.
- [x] A blank `Número de ciclos` still submits `null`; no `Prazo indeterminado` checkbox.
- [x] `maxRemainingInstallments` still 120/119 across all three layers.
- [x] `kind` is still the only discriminator; no `openPrice` switch.
- [x] No native `<select>`, `<option>`, `<datalist>` or raw `<input type="number">` introduced (`leaves no native picker markup in any web source file` still green).
- [x] The C03 yellow banner stays.

## Red-then-green evidence

### Step A - the payload oracle, written FIRST and passing against the CURRENT single-page dialog

`it('emits the identical SaveProductPayload for a fully filled produto')` fills every field the dialog owns and asserts the full 24-key payload with `toEqual`. Run before any implementation change:

```
 ✓ src/sales-ops/__tests__/product-service-dialog.test.tsx (46 tests | 45 skipped) 70ms
 Test Files  1 passed (1)
      Tests  1 passed | 45 skipped (46)
```

The expectation literal was written once and never edited. After the restructure the ONLY change to that test is three `goToStep(2|3|4)` calls interleaved into the fill sequence.

### Red - the six wizard-shell oracles against the single-page dialog

```
 FAIL ... > renders the four numbered steps in order
 FAIL ... > puts Plano de pagamento padrão on a step after the mensalidade controls
   Error: step button not found: Valores
 FAIL ... > blocks Avançar until nome and área are both filled
   Error: button not found: Avançar
 FAIL ... > shows which identity field is missing after a blocked submit
   Error: button not found: Avançar
 FAIL ... > lands on step 1 with an existing produto prefilled and saves from any step
   AssertionError: expected 'Editar produtoCatálogo, valores e com…' to contain 'Passo 1 de 4'
 FAIL ... > offers no mid-wizard save for a new produto
   Error: step button not found: Valores

 Test Files  1 failed (1)
      Tests  6 failed | 40 passed (46)
```

### Green - after the restructure

```
 ✓ src/sales-ops/__tests__/product-service-dialog.test.tsx (46 tests) 244ms
 Test Files  1 passed (1)
      Tests  46 passed (46)
```

### The verbatim-extraction check (risk 5)

`sale-wizard-ui-contract.test.tsx` and every `sale-wizard-*.test.tsx` file passed with ZERO edits after converting the proposta wizard to `WizardStepper` and the class constants:

```
 Test Files  11 passed (11)
      Tests  86 passed (86)
```

`sale-wizard-shell-layout.test.tsx`, which asserts the shell's four children by index and their exact class tokens, is included and green.

### Final gate

```
pnpm run lint       -> apps/api Done, apps/web Done
pnpm run type-check -> all four projects Done
pnpm test           -> apps/web  39 files, 393 tests passed
                       apps/api  29 files, 300 tests passed
                       shared-utils 2 files, 23 tests passed
pnpm run build      -> built in 1.57s
```

Baseline was 386 web tests across 39 files and 300 api tests across 29 files. Nothing was lost; the 7 new tests are the plan's named oracles.

## Existing tests touched, and why

Every edit is navigation or an identity fill. No assertion was weakened or deleted; two were strengthened.

### `apps/web/src/sales-ops/__tests__/product-service-dialog.test.tsx`

New helpers: `nameInput()`, `fillIdentity()`, `stepLabels` / `stepButton()` / `goToStep()`, `codeSuffixInput()`, `addModule()`.

`renderDialog()` now does `root.render(null)` before rendering. `ProductDialog`'s key is identical for two identical create rows, so without this the second `renderDialog()` inside a test silently kept the first one's form state AND its wizard step. Three tests render twice and relied on that not mattering; it does now. This is a strengthening.

| Test | Change |
|---|---|
| `sends kind and never sends openPrice` | `chooseArea()` -> `fillIdentity()` |
| `sends kind service when the serviço segment is active` | `chooseArea()` -> `fillIdentity()` |
| `renders editable base value inputs for a serviço and submits them` | `fillIdentity()` + `goToStep(2)` |
| `keeps definido na venda as the zero state for a serviço with no base value` | `goToStep(2)` |
| `seeds the stored base value of a serviço that has one` | `goToStep(2)` |
| `keeps the own-value inputs editable for a produto` | `fillIdentity()` + `goToStep(2)` |
| `states that every value here is only a default` | `fillIdentity()`, banner asserted on step 1 then `goToStep(4)` for `Comissionamento padrão` |
| `submits the app-default plan when nothing is touched` | `chooseArea()` -> `fillIdentity()` |
| `submits a percentage entrada into defaultEntradaPct only` | `fillIdentity()` + `goToStep(3)` |
| `submits a fixed entrada into defaultEntradaBrl as integer cents` | `fillIdentity()` + `goToStep(3)` |
| `unmounts the entrada value input when the mode is nenhuma` | `fillIdentity()` + `goToStep(3)` |
| `caps the entrada plus parcelas pair at the 120 installment ceiling` | `fillIdentity()` + `goToStep(3)` |
| `clamps a hand-typed parcela count to the ceiling at submit` | `fillIdentity()` + `goToStep(3)` on both renders |
| `floors a hand-typed parcela count at one` | `fillIdentity()` + `goToStep(3)` |
| `treats a blank ciclos as prazo indeterminado and shows no checkbox` | `fillIdentity()`, `goToStep(2)` for the switch, `goToStep(3)` for the field |
| `submits a bounded cycle count` | same pattern |
| `hides the ciclos field and nulls the column when the product has no mensalidade` | `fillIdentity()` + `goToStep(3)`, **plus a new positive control** that `Parcelas restantes` IS mounted, so the null assertion cannot pass by way of an unmounted step |
| `never puts a date in the default payment plan controls` | `fillIdentity()`, `goToStep(2)`, `goToStep(3)` |
| `saves função costs as a discriminated pct row and a fix row in cents` | `fillIdentity()` + `goToStep(4)` |
| `never offers a system função as a cost default` | `fillIdentity()` + `goToStep(4)` |
| `never offers an archived função as a cost default` | `fillIdentity()` + `goToStep(4)` |
| `does not offer the same função twice` | `fillIdentity()` + `goToStep(4)` |
| `keeps naming an archived função on the cost row that already carries it` | `goToStep(4)` |
| `names a cost row whose função is missing from the bootstrap...` | `goToStep(4)` |
| `never offers an archived função to a row that does not already carry it` | `goToStep(4)` |
| `explains where to register funções when none exist` | `fillIdentity()` + `goToStep(4)` |
| `removes a função cost row` | `fillIdentity()` + `goToStep(4)` |
| `does not reintroduce any control the payment plan builder removes` | **strengthened**: the forbidden strings are now swept across ALL FOUR steps, not one, so a removed control cannot hide behind an unmounted step |
| `drops the free-text prestador picker and never writes providers` | `fillIdentity()` + `goToStep(4)` |
| `surfaces legacy prestador names read-only inside the função cost section` | `goToStep(4)` |
| `renders módulos only for a produto and preserves them when reclassified` | `goToStep(2)` to see Módulos, back to step 1 to reclassify, `goToStep(2)` again to assert absence |
| `rehydrates the stored plan columns and the funcaoCosts prop when reopened` | `goToStep(3)` for the plan half, `goToStep(4)` for the costs half |
| `keeps the commission editor working unchanged for a serviço` | `fillIdentity()` + `goToStep(4)` |
| `summarises the default plan back to the operator` | `fillIdentity()`, `goToStep(3)`, `goToStep(2)` for the switch, `goToStep(3)` again |

Untouched and still green: `titles and describes the dialog from the selected kind`, `titles an existing record from its stored kind`, `has no preço em aberto switch`, `preserves the own value when a produto is reclassified as a serviço`, `resubmits rehydrated função costs without changing their units`.

### `apps/web/src/sales-ops/__tests__/product-commission-editor.test.tsx`

Added `nameInput()`, `fillIdentity()`, `goToCommissionStep()`.
Four tests gained an identity fill and/or a hop to step 4; `submits every commission pair regardless of the active tab` swapped `chooseArea()` for `fillIdentity()` because the new name guard would otherwise block the submit.
No assertion changed.

### `apps/web/src/sales-ops/__tests__/areas-view.test.tsx`

**Not touched.** Its `ProductDialog` case already types a name and picks an área, both still on step 1, and its `expect(onSave).not.toHaveBeenCalled()` after an área-less submit still holds under the new guard. Verified green with zero edits.

### `apps/web/src/sales-ops/__tests__/combobox-adoption.test.tsx`

`never submits the product form when Enter is pressed in a picker panel` is entirely on step 1 - no navigation needed, verified green unchanged.
`offers a create row on the área picker and never on the função cost picker` gained `fillProductIdentity()` + `goToCostStep()` before reaching the `Custos padrão por função` list. The área create-row half is unchanged and still asserted on step 1.

### `apps/web/src/sales-ops/__tests__/optimistic-row-guard.test.tsx`

`keeps an unsaved área out of the produto área picker` already types a name and picks an área on step 1 - verified green unchanged.
`the produto função cost pool > offers the org custom funções...` gained an identity fill and a hop to step 4.

## Divergences from the plan

1. **`it('shows which identity field is missing after a blocked Avançar')` became `...after a blocked submit`.**
   The plan asks for two things that cannot both be true in a browser: `Avançar` is `disabled` while step 1 is incomplete (its own acceptance line: "Avançar stays disabled until Nome and Área are both filled"), AND clicking `Avançar` on an empty form shows the two error messages.
   A disabled button fires no click, in the DOM or in happy-dom - this was confirmed empirically, the click-based version of the test failed with the messages absent.
   Implementing it the plan's literal way would have made the error branch dead code that only a synthetic test could reach.
   Resolution: `Avançar` stays disabled exactly as the acceptance line requires, and `showIdentityErrors` is raised by the blocked `submit()` instead - which is a genuine browser path, since implicit form submission (Enter in Nome or in the área picker's search) lands there.
   The test asserts BOTH halves: that `Avançar` is disabled, and that the blocked submit names the missing field. It also adds that the message clears field by field.

2. **`wizardStepCardClass` is an eighth constant the plan did not name.**
   The plan says to adopt `wizardDialogContentClass` verbatim, which carries `bg-[#f4f4f6]`. The produto dialog's content was previously on white, and its `bg-[#fafafb]` sub-cards would have read as grey on grey. The proposta wizard already solves this by putting each step's content on a `rounded-[14px] border border-[#e8e8ec] bg-white p-4` card; the constant is that recipe, so the two dialogs stay identical rather than the produto one looking broken.

3. **`DialogSection` gained an optional `flush` prop.**
   Not in the plan. A section that is the first thing on a step has nothing above it to be separated from, so its `border-t` rule read as a stray line under the step card's own top edge. Only `Plano de pagamento padrão` and `Comissionamento padrão` pass it; every repeating section keeps its rule, which is also what keeps the tests' `closest('div.border-t')` helper working (plan risk 4).

4. **Nome and Área sit side by side in a 2-col grid on step 1.**
   The plan lists them as sequential items. At 940px a single full-width text input reads as stretched, and the pair is exactly the identity the step is named for. The Área picker keeps the `md:grid-cols-2` cell it already had; only its neighbour changed from Setup to Nome.

5. **`renderDialog()` in `product-service-dialog.test.tsx` now forces a remount.**
   Not in the plan, but required: three tests render twice with an identical `ProductDialog` key and previously inherited the first render's state without noticing. With a wizard step in that state the inheritance is no longer harmless.

6. **The proposta wizard's `Salvar rascunho` button was left on its own literal class**, not converted to `wizardSecondaryButtonClass`, because it uses `px-[18px]` where `Voltar` uses `px-5`. Converting it would have been a real 2px DOM change to the proposta wizard, which risk 5 forbids. The produto dialog's `Salvar alterações` in that same slot uses `wizardSecondaryButtonClass` plus the disabled variants.

## Not done

No browser E2E pass. The dialog depends on FXL Hub auth for a local run and no Hub is available in this session; the shell geometry is instead pinned at the DOM level by the strengthened first oracle (940px shell, flex column, `shrink-0` chrome, `min-h-0 flex-1 overflow-y-auto` body, no `calc(`), mirroring `sale-wizard-shell-layout.test.tsx`.
