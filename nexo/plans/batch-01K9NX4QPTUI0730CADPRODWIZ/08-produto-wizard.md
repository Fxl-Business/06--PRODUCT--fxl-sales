---
id: 08-produto-wizard
milestone: v2.3.0
status: todo
depends_on: ["02-wizard-shell-footer", "07-servico-base-value"]
files_modified: []
acceptance: "given the operator opens Cadastros > Produtos & Serviços and clicks Novo produto, when they walk the four numbered steps Identificação > Valores > Pagamento > Comissões e custos filling the same fields the old single-page dialog held, then the dialog renders at the proposta wizard's 940px width with the same stepper and footer chrome, Avançar stays disabled until Nome and Área are both filled, Plano de pagamento padrão is rendered on a step strictly after Setup and Possui mensalidade, and onSave receives byte-for-byte the SaveProductPayload the single-page dialog emitted for the same inputs."
---

# 08 - produto/serviço dialog becomes a stepped wizard

## Intent

`ProductDialogBody` in `apps/web/src/sales-ops/SalesOpsApp.tsx` (currently lines 3224-4050) is one 640px column of eight stacked sections.
`SaleWizardDialogBody` in the same file (lines 4965-7175) is a 940px four-step wizard with a numbered stepper and a `Voltar / Passo N de 4 / Avançar` footer.
The operator asked for the first to look and behave like the second, and gave one hard ordering constraint: `Plano de pagamento padrão` must sit after Setup and Mensalidade so the payment rules are fixed once the values are known.

This slice is a **pure re-layout**.
No field is added, removed, renamed or re-typed, and the emitted `SaveProductPayload` is byte-for-byte identical for identical inputs.
The executor MOVES existing JSX blocks between step containers and MUST NOT rewrite their internals.
That constraint matters because slice `07-servico-base-value` lands first and changes what the Setup and Mensalidade fields render for a Serviço; moving the block verbatim inherits whatever 07 left there, rewriting it would silently revert 07.

## 1. Field inventory (nothing may be lost)

Every control, conditional and derived string in `ProductDialogBody` today.
The executor ticks each one off after the restructure by finding it in the new step tree.

### Form state (`ProductForm`, seeded by `productForm()` at line 3037)

| # | State key | Control today | Seed |
|---|---|---|---|
| F01 | `kind` | `Produto | Serviço` segmented pair (`SegmentedButton`, aria-labels `Classificar como produto` / `Classificar como serviço`) | `product?.kind ?? kindHint ?? 'product'` |
| F02 | `name` | `<Field label="Nome" required>` + `Input` with `placeholder="Nome"` and `required` | `product?.name ?? prefillName ?? ''` |
| F03 | `codeSuffix` | `Final do código da venda` card, bespoke 2-char `inputMode="numeric"` input inside the `0000-` prefix chip | `product?.codeSuffix ?? '0'` |
| F04 | `areaId` | `<FieldBlock label="Área" required>` + `Combobox` aria-label `Área do produto`, `onCreate` wired when `onCreateArea` is passed | `product?.areaId ?? ''` |
| F05 | `setupBrl` | `<Field label="Setup (R$)">` + numeric `Input`, replaced by `<DefinedOnSaleNotice />` when `isService` (subject to slice 07) | `centsToInput(product?.setupBrl)` |
| F06 | `hasMonthly` | `Possui mensalidade` toggle button (aria-pressed) inside the grey `#fafafb` card | `product?.hasMonthly ?? false` |
| F07 | `monthlyBrl` | `<Field label="Valor da mensalidade (R$)">`, mounted only when `hasMonthly`, `DefinedOnSaleNotice` when `isService` (subject to slice 07) | `centsToInput(product?.monthlyBrl)` |
| F08 | `recurringCommission` | `Incide sobre recorrente` toggle, mounted only when `hasMonthly` | `product?.recurringCommission ?? false` |
| F09 | `sellerCommissionType` | `UnitToggle` pair, shown while `commissionMode === 'seller_only'` | `?? 'pct'` |
| F10 | `sellerCommissionValue` | `UnitInput` aria-label `Comissão do vendedor - somente vendedor` | `pctToInput(..., 10)` |
| F11 | `sellerWithFinderCommissionType` | same `UnitToggle` pair while `commissionMode === 'with_finder'` | `?? sellerCommissionType ?? 'pct'` |
| F12 | `sellerWithFinderCommissionValue` | `UnitInput` aria-label `Comissão do vendedor - com finder` | `pctToInput(..., product ? 10 : 7)` |
| F13 | `finderCommissionType` | `UnitToggle` pair, only while `commissionMode === 'with_finder'` | `?? 'pct'` |
| F14 | `finderCommissionValue` | `UnitInput` aria-label `Comissão do finder`, only while `with_finder` | `pctToInput(..., 3)` |
| F15 | `defaultPaymentMethod` | `Combobox` aria-label `Forma de pagamento padrão` | `?? 'pix'` |
| F16 | `defaultEntradaMode` | `Combobox` aria-label `Tipo de entrada`, options `nenhuma / % / R$ fixo`, routed through `setEntradaMode` | `?? 'none'` |
| F17 | `defaultEntradaValue` | `UnitInput` aria-label `Valor da entrada`, UNMOUNTED when mode is `none` | `pct` or cents branch, `''` for `none` |
| F18 | `defaultRemainingInstallments` | `Input` aria-label `Parcelas restantes`, `min=1`, `max={parcelasCeiling}`, followed by the literal `x` | `String(?? 1)` |
| F19 | `defaultRecurringCycles` | `Input` aria-label `Número de ciclos`, `placeholder="Indeterminado"`, mounted only when `hasMonthly` | `''` when null |
| F20 | `modules[]` | `ListEditor title="Módulos"`, produto-only (`isService ? null :`); per row a name `Input` (`placeholder="Nome do módulo"`), a `Combobox` aria-label `Tipo do módulo N` over `Módulo/Upsell/Downsell/Cross-sell/Add-on`, an `R$`-prefixed numeric `Input`, and a `Remover módulo` button | mapped from `product?.modules` |
| F21 | `funcaoCosts[]` | `ListEditor title="Custos padrão por função"`; per row a `Combobox` aria-label `Função do custo padrão N`, a `%`/`R$` `UnitToggle` pair aria-labelled `Custo da função N em porcentagem|reais`, a `UnitInput` aria-label `Custo da função N`, and a `Remover custo padrão N` button | mapped from the `funcaoCosts` prop |

### Local (non-payload) state and derived values

| # | Thing | Note |
|---|---|---|
| L01 | `commissionMode: 'seller_only' \| 'with_finder'` | drives the `Somente vendedor` / `Vendedor + Finder` segmented pair; NOT persisted |
| L02 | `createdAreas` | áreas created from the picker's own create row, kept locally until the bootstrap refetch |
| L03 | `selectableAreas` | active áreas, PLUS the product's own área when archived, PLUS `createdAreas` |
| L04 | `eligibleFuncoes` | `status === 'active' && !isSystem` |
| L05 | `usedFuncaoIds` / `usedEligibleCount` / `allFuncoesUsed` / `noFuncoesAvailable` | gate the `Adicionar` button of the custos section and its `title` tooltip |
| L06 | `costRowFuncaoOptions(row)` | eligible pool minus already-used, plus the row's OWN stored função |
| L07 | `costRowFuncaoValueLabel(row)` | `Função não encontrada` when the stored id resolves to nothing |
| L08 | `legacyProviderNames` | read-only footer of the custos section listing deprecated `providers[].personName` |
| L09 | `parcelasCeiling` | `maxRemainingInstallments(form.defaultEntradaMode)`, 120 or 119 |
| L10 | `planSummary()` | the green `RotateCcw` strip: `Entrada de 50% + 3x do restante · PIX · mensal por 12 ciclos` |
| L11 | `isService` | `form.kind === 'service'` |

### Static copy and conditional blocks

| # | Block |
|---|---|
| C01 | Dialog title, four-way: `Novo produto` / `Novo serviço` / `Editar produto` / `Editar serviço` |
| C02 | Dialog description, two-way: `Catálogo, valores e comissões padrão` (produto) / `Valor variável, custos por função e padrões de proposta` (serviço) |
| C03 | Yellow banner `Tudo aqui é padrão: dentro da proposta você pode alterar qualquer valor sem mexer no cadastro.` (KEEP AS IS; slice 10 converts it to an on-demand hint) |
| C04 | Amber serviço notice `Serviços têm valor variável, definido em cada proposta.`, `isService` only (slice 07 may have already changed or removed it; move whatever exists) |
| C05 | `Final do código da venda` blue card with its subtitle `Todo código gerado para vendas deste produto termina neste número` (slice 09 changes only the default value) |
| C06 | `Possui mensalidade` / `Cobrança recorrente além do setup` labels |
| C07 | `Incide sobre recorrente` / `Aplicar comissão também na mensalidade` labels |
| C08 | `DialogSection title="Comissionamento padrão" subtitle="Sugestão aplicada ao criar a proposta"` |
| C09 | `Comissão do vendedor` / `Comissão do finder` sub-labels |
| C10 | `DialogSection title="Plano de pagamento padrão" subtitle="Aplicado ao gerar as parcelas da proposta - sem datas fixas"` |
| C11 | `Deixe em branco para prazo indeterminado`, `hasMonthly` only |
| C12 | `ListEditor` custos: title `Custos padrão por função`, subtitle `Quanto cada função custa neste item por padrão`, empty `Nenhum custo padrão definido`, empty-when-no-funcoes and `addTitle` copy `Nenhuma função cadastrada ainda. Cadastre as funções em Cadastros > Funções para definir custos padrão.`, `addTitle` when full `Todas as funções já têm custo padrão` |
| C13 | `Prestadores antigos deste cadastro não foram convertidos automaticamente: <nomes>. Recadastre o custo por função acima.` |
| C14 | `ListEditor` módulos: title `Módulos`, subtitle `Upsell, downsell e complementos`, empty `Nenhum módulo adicionado` |
| C15 | Footer `Cancelar` and `Adicionar` / `Salvar alterações` / `Salvando` |

### Submit-time transforms (`submit()`, lines 3378-3443) - MUST survive untouched

| # | Rule |
|---|---|
| S01 | early return when `!form.areaId` |
| S02 | `codeSuffix` -> digits only, first 2, `'0'` when empty |
| S03 | `kind` sent, `openPrice` NEVER sent |
| S04 | `setupBrl` forced to 0 for a serviço (slice 07 owns this; do not touch) |
| S05 | `monthlyBrl` forced to 0 when serviço or `!hasMonthly` |
| S06 | `recurringCommission` ANDed with `hasMonthly` |
| S07 | `defaultEntradaPct` set only in `pct` mode, else null; `defaultEntradaBrl` only in `fix` mode, else null |
| S08 | `defaultRemainingInstallments` clamped into `[1, parcelasCeiling]` at submit (third clamp layer, the only one a hand-typed value passes through) |
| S09 | `defaultRecurringCycles` null when `!hasMonthly` or blank, else clamped into `[1, MAX_PLAN_INSTALLMENTS]` |
| S10 | `productFuncaoCosts` drops rows with no `funcaoId`, discriminates `pct` -> `valuePct` (decimal) vs `fix` -> `valueBrl` (CENTS) |
| S11 | `modules` drops unnamed rows, defaults `type` to `Upsell`, value in cents |
| S12 | `providers` OMITTED from the payload, never sent as `[]` |
| S13 | `status: 'active'` always |

## 2. Shared chrome: what to extract, what to copy

Slice `02-wizard-shell-footer` has already converted `SaleWizardDialogBody` to a flex-column shell.
Do not reintroduce a `calc(...vh-...)` body height anywhere, in either dialog.

**EXTRACT (used by both dialogs):**

1. `WizardStepper` - a new module-level component in `SalesOpsApp.tsx`, placed just above `ProductDialog`.
   Signature:
   ```ts
   function WizardStepper<S extends number>(props: {
     steps: Array<{ step: S; label: string }>;
     current: S;
     onSelect: (step: S) => void;
     isEnabled: (step: S) => boolean;
   }): JSX.Element
   ```
   Body is the existing wizard markup at lines 5850-5891 moved verbatim: the `flex items-center gap-1 overflow-x-auto border-b border-[#e8e8ec] bg-white px-[26px] py-4` bar, the 26px round badge (`bg-[#2f7d4b]` done, `bg-[#eaa81a]` active, `bg-[#ececf1]` pending), the `Check` icon for done steps, the 13px semibold label, and the `mx-1 h-0.5 w-[22px] bg-[#e7e2d6]` connector between entries.
   `SaleWizardDialogBody` is converted to call it with `isEnabled` returning the same three-clause expression it inlines today.
   This is pure presentation with no state, so the conversion is mechanically safe and `sale-wizard-ui-contract.test.ts` must stay green with no edit.

2. Four module-level class constants next to `formInputClass` (line 172):
   - `wizardDialogContentClass` - whatever shape slice 02 left on the wizard's `DialogContent`, verbatim, including `max-w-[940px]`, `rounded-[22px]`, `bg-[#f4f4f6]`, and the `[&>button]:...` close-button block.
   - `wizardHeaderClass` = `border-b border-[#e8e8ec] bg-white px-[26px] py-5 pr-[78px] text-left`
   - `wizardBodyClass` - the scrolling body class slice 02 left in place (flex-based, no `calc`).
   - `wizardFooterClass` = `flex items-center justify-between border-t border-[#e8e8ec] bg-white px-[26px] py-4`
   plus the two button recipes `wizardSecondaryButtonClass` and `wizardPrimaryButtonClass` (lines 7153 and 7163 verbatim).
   Both dialogs consume these; the wizard's JSX changes only by swapping literal strings for the constants.

**DO NOT extract, copy deliberately:**

3. The footer as a whole component.
   The two footers differ in kind, not in degree: the proposta footer carries a conditional `Salvar rascunho` and a `Loader2` spinner tied to a draft/open status model the produto cadastro does not have, while the produto footer carries `Cancelar` and a submit button.
   A component parameterised over both would take five slot props and be harder to read than the twenty lines it replaces.
   The produto dialog therefore builds its own footer out of `wizardFooterClass` plus the two button-class constants, which is where the actual visual duplication was.

4. The header.
   The produto dialog renders its own `Fechar` X and hides Radix's with `[&>button:last-child]:hidden`; the wizard restyles Radix's.
   Unifying that is a DOM change to the proposta wizard with no user-visible payoff, and the wizard's close button is not even mounted under the test file's `@/components/ui/dialog` mock.
   The produto dialog keeps its bespoke X button unchanged, and only adopts the wizard's header padding and typography through `wizardHeaderClass` (dropping its own `flex-row items-start justify-between space-y-0 px-6 py-5`, keeping the X absolutely positioned in the same place the wizard puts Radix's, via `relative` on the header and `absolute right-[26px] top-[31px]` on the button).

## 3. The step split

Four steps, matching the proposta wizard's rhythm one for one.

| Step | Label | Contents |
|---|---|---|
| 1 | `Identificação` | C03 yellow banner, F01 kind segmented pair, F02 Nome, F04 Área, F03 Final do código da venda, C04 serviço notice |
| 2 | `Valores` | F05 Setup, the mensalidade card (F06 + F07 + F08), F20 Módulos (produto only) |
| 3 | `Pagamento` | the whole `Plano de pagamento padrão` section: F16, F17, F18, F15, F19, C11, L10 summary strip |
| 4 | `Comissões e custos` | `Comissionamento padrão` (L01 + F09-F14), `Custos padrão por função` (F21 + C12 + C13 legacy providers footer) |

### Justification

The operator's hard constraint is satisfied structurally rather than by ordering within one scroll: `Pagamento` is step 3, strictly after `Valores` on step 2, so it is impossible to reach the plan builder before Setup and Mensalidade are settled.

That ordering is not merely aesthetic, it is a real data dependency.
`Número de ciclos` (F19) only exists when `hasMonthly` (F06) is on, and `hasMonthly` is set on step 2.
Putting the plan first would mean a control that appears and disappears based on a decision the operator has not been asked to make yet, which is exactly the confusion the operator described.

`kind` stays on step 1 because it changes what steps 2 and 4 render: a Serviço hides `Módulos` entirely and (pre-slice-07) replaces both money inputs with `Definido na venda`.
A wizard whose later steps mutate under you is only acceptable if the mutating control is on the first step, before anything downstream has been filled.

`Módulos` goes on `Valores` rather than with the custos, because a módulo is priced sellable value (`valueBrl` in cents added to the catalog), not a cost.
Grouping it with Setup and Mensalidade puts every number the org CHARGES on one step and every number it PAYS OUT on another, which is the same seam the proposta wizard draws between its step 1 (itens) and step 3 (custos e margem).

Four steps rather than three keeps the stepper geometrically identical to the proposta wizard the operator was comparing against, which is the literal ask, and keeps each step to one screen at 940px without internal scrolling on a 900px-tall viewport.

## 4. Per-step validation

Add exactly one new gate.
Everything else stays as permissive as it is today, because this slice is a re-layout and a new blocking rule is a behaviour change that belongs to its own slice.

```ts
const nameValid = Boolean(form.name.trim());
const areaValid = Boolean(form.areaId);
const canAdvanceStepOne = nameValid && areaValid;
```

| Step | Gate on `Avançar` | Rationale |
|---|---|---|
| 1 | `canAdvanceStepOne` | `Área` already hard-blocks submit today (S01) and `Nome` is `required` on its `Input`. Both are genuinely required by the API, and both live on step 1, so once step 1 passes the record is savable. |
| 2 | none | A blank Setup or Mensalidade parses to 0 cents today and is a legitimate value. Adding a `> 0` rule here would reject records the current dialog accepts. |
| 3 | none | A blank `Valor da entrada` parses to 0 and a blank `Parcelas restantes` floors to 1; both are already clamped at submit (S08/S09). |
| 4 | n/a, primary button submits | |

Behaviour:

- `advanceProductWizard()` mirrors `advanceWizard()` (line 5723): on step 1 it sets `showIdentityErrors` to true and returns when `!canAdvanceStepOne`; on step 4 it calls `submit()`.
- The primary footer button is `disabled={saving || (step === 1 && !canAdvanceStepOne)}`, matching the proposta wizard's `disabled={saving || (wizardStep === 1 && !canSave)}` exactly.
- `WizardStepper`'s `isEnabled(step)` returns `step === 1 || canAdvanceStepOne`, so steps 2-4 cannot be jumped to from an incomplete step 1.
- `showIdentityErrors` renders a destructive message under whichever of the two is empty, using the wizard's existing recipe (line 6257): `<span className="flex flex-col gap-1 text-[11.5px] font-semibold text-destructive">`.
  Copy: `Informe o nome do produto.` and `Selecione a área.`
  Add `aria-invalid` and `border-destructive` on the offending control, as the wizard does at lines 6080-6086.
- `submit()` gains `if (!form.name.trim()) return;` next to the existing `if (!form.areaId) return;`.
  This makes the two guards symmetric and stops a synthetic form submit from emitting a nameless produto now that the native `required` attribute is unmounted on steps 2-4.

## 5. Edit path

`ProductDialog` (line 3191) keys `ProductDialogBody` on `props.modal.product?.id ?? "new-<kind>-<prefillName>"`, so opening a different record or a different create row remounts the body and re-runs the `useState` initialiser `productForm(...)`.
That mechanism is untouched: `wizardStep` is new `useState<1|2|3|4>(1)` state inside the SAME component, so the same key change that reseeds the form also resets the wizard to step 1.
An existing produto therefore lands on step 1 with everything prefilled, exactly as required, with no extra effect.

Saving from any step, for an existing record: **yes, and it is offered in the UI.**
Because both required fields live on step 1, `canAdvanceStepOne` is also the full save predicate, so an existing produto is always savable the moment step 1 is valid.
Render a secondary `Salvar alterações` button in the footer on steps 1-3, mounted only when `activeModal.product` is truthy, `disabled={!canAdvanceStepOne || saving}`, `type="submit"`.
This occupies the exact slot and class (`wizardSecondaryButtonClass`) the proposta wizard gives `Salvar rascunho`, and the analogy is deliberate: it is the same affordance for the same reason.
For a NEW produto that button is absent, so the create path walks all four steps and the operator sees the commission and cost defaults at least once before the record exists.

Footer layout, mirroring the proposta wizard:

- left: `Voltar`, `invisible` on step 1 (keeps the row from shifting), plus `Cancelar` beside it on step 1 only.
- right: `Passo N de 4` label, then the conditional `Salvar alterações`, then the primary button.
- primary label: `Avançar` on steps 1-3; on step 4 `Salvando` when `saving`, else `Salvar alterações` when editing, else `Adicionar`.

The whole step tree stays inside ONE `<form onSubmit={submit}>` so that state for unmounted steps is untouched React state and a submit from any step emits the complete payload.
This is also what keeps a synthetic `form.dispatchEvent(new Event('submit'))` usable from every step in the tests.

## 6. Preserved-rules checklist (CLAUDE.md)

Tick each after the restructure.

- [ ] `selectableAreas` still prepends the product's own archived-but-current área into the `Área do produto` picker, and still appends `createdAreas`.
- [ ] `onCreate` is still wired on the área picker (and only when `onCreateArea` is passed).
- [ ] A NEW função cost row still draws from active, non-system funções only (`eligibleFuncoes`).
- [ ] A funcão already used by another row is still filtered out of the other rows' options.
- [ ] A row's OWN stored função is still admitted into that row's options, labelled `<nome> (arquivada)` via `funcaoCostOptionLabel` when archived.
- [ ] An unresolvable `funcaoId` still reads `Função não encontrada` on the trigger, never a raw uuid.
- [ ] The função-cost picker still has NO create row; the empty state still points at `Cadastros > Funções`.
- [ ] `providers` is still surfaced read-only in the custos section footer and still OMITTED from the payload (S12).
- [ ] The entrada mode literal is still `'fix'`, never `'fixed'`, in state, in `entradaModeOptions`, and in the payload.
- [ ] A blank `Número de ciclos` still submits `defaultRecurringCycles: null`, and no `Prazo indeterminado` checkbox exists.
- [ ] `maxRemainingInstallments` still yields 120 with no entrada and 119 with one, still enforced in three layers: the `max` attribute, `setEntradaMode`'s clamp, and the submit clamp (S08).
- [ ] `isServiceProduct` / the `kind` discriminator is still the only branch; no `openPrice` switch reappears.
- [ ] No native `<select>`, `<option>`, `<datalist>` or raw `<input type="number">` is introduced; every picker stays a `Combobox` with `formSelectClass` geometry.
- [ ] The C03 yellow banner stays; slice 10 converts it, not this one.

## 7. Oracle tests

**File:** `apps/web/src/sales-ops/__tests__/product-service-dialog.test.tsx` (extend; do not create a new file).

### Order of work (this is a TDD sequence, follow it)

**Step A - write the payload oracle FIRST, against the CURRENT single-page dialog, and watch it pass.**

Add:

```
it('emits the identical SaveProductPayload for a fully filled produto', ...)
```

It fills every field the dialog owns (name, área, código suffix, kind, setup, mensalidade on with a value and `Incide sobre recorrente` on, both commission scenarios in both units, entrada `%` with a value, parcelas restantes, forma de pagamento, ciclos, one `pct` função cost row, one `fix` função cost row, one módulo) and asserts the FULL payload with `toEqual`, not `toMatchObject`, over all 24 keys:

`id, name, areaId, codeSuffix, kind, setupBrl, hasMonthly, monthlyBrl, recurringCommission, sellerCommissionType, sellerCommissionValue, sellerWithFinderCommissionType, sellerWithFinderCommissionValue, finderCommissionType, finderCommissionValue, defaultPaymentMethod, defaultEntradaMode, defaultEntradaPct, defaultEntradaBrl, defaultRemainingInstallments, defaultRecurringCycles, productFuncaoCosts, modules, status`

`toEqual` is the load-bearing choice: it fails both if a field is dropped and if one appears (which is what would catch an accidental `providers: []` or `openPrice`).
Commit this expectation literal, then NEVER edit it again.
After the refactor the same test navigates the four steps and must produce the same literal.
That is the payload-equivalence guard the slice hinges on.

**Step B - restructure `ProductDialogBody`.**

**Step C - adapt the test file mechanically.**

1. Replace `chooseArea()` with `fillIdentity()`, which types into `input[placeholder="Nome"]` and then picks the área, and is called at the TOP of every test (step 1 is where both controls now live).
   Every existing `await chooseArea()` call becomes `await fillIdentity()` moved to before the first navigation.
2. Add `async function goToStep(target: 1|2|3|4)` that clicks the stepper button whose text ends with the step label, and use it to reach the controls each existing test touches:
   - step 2: `Setup (R$)`, `Possui mensalidade`, `Valor da mensalidade (R$)`, `Incide sobre recorrente`, `Módulos`
   - step 3: `Tipo de entrada`, `Valor da entrada`, `Parcelas restantes`, `Forma de pagamento padrão`, `Número de ciclos`, the plan summary strip
   - step 4: `Comissionamento padrão`, `Custos padrão por função`, the legacy prestador notice
3. `submit()` (the direct `form.dispatchEvent`) keeps working from any step, so only the navigation to reach an INPUT needs adding, never navigation to submit.
4. `text()`-based assertions that span two steps (for example `states that every value here is only a default`, which asserts both the C03 banner and `Comissionamento padrão`) must be split across a `goToStep(4)`.

### New tests to add (the named oracles)

In a new `describe('the produto wizard shell', ...)` block:

1. `it('renders the four numbered steps in order')` - asserts the stepper shows `Identificação`, `Valores`, `Pagamento`, `Comissões e custos` and that the footer reads `Passo 1 de 4`.
2. `it('puts Plano de pagamento padrão on a step after the mensalidade controls')` - on step 2, `text()` contains `Possui mensalidade` and NOT `Plano de pagamento padrão`; after `goToStep(3)`, `text()` contains `Plano de pagamento padrão` and NOT `Possui mensalidade`.
   This is the operator's constraint pinned as a test, and it is directional in both halves so it cannot pass on an empty render.
3. `it('blocks Avançar until nome and área are both filled')` - with an empty form the `Avançar` button is `disabled` and every stepper button except step 1 is `disabled`; typing only a name leaves it disabled; picking only an área (fresh render) leaves it disabled; doing both enables it and a click lands on step 2.
4. `it('shows which identity field is missing after a blocked Avançar')` - click `Avançar` with an empty form, assert `Informe o nome do produto.` and `Selecione a área.` are on screen and `onSave` was not called.
5. `it('emits the identical SaveProductPayload for a fully filled produto')` - the Step A test, now navigating.
6. `it('lands on step 1 with an existing produto prefilled and saves from any step')` - render with `existing: product({...})`, assert the footer reads `Passo 1 de 4` and the name input holds the stored name, assert a `Salvar alterações` button exists on step 1, click it, and assert `onSave` fired with `id` equal to the stored id.
7. `it('offers no mid-wizard save for a new produto')` - render with `productKind: 'product'`, fill identity, assert `maybeButton('Salvar alterações')` is `undefined` on steps 1-3.

### Other test files that must be adapted (same mechanical recipe)

- `apps/web/src/sales-ops/__tests__/product-commission-editor.test.tsx` - all `ProductDialog` tests touch the commission editor, now on step 4. Add `fillIdentity()` + `goToStep(4)`.
- `apps/web/src/sales-ops/__tests__/areas-view.test.tsx` - the `ProductDialog` case types a name and picks an área, both still on step 1. Its `expect(onSave).not.toHaveBeenCalled()` after an area-less submit still holds under S01.
- `apps/web/src/sales-ops/__tests__/combobox-adoption.test.tsx` - the área create-row case is entirely on step 1; verify no navigation is needed.
- `apps/web/src/sales-ops/__tests__/optimistic-row-guard.test.tsx` - drives the real app and opens the dialog to inspect the função cost pool, now on step 4. Needs identity fill + navigation.

### Gate

```bash
pnpm run lint
pnpm run type-check
pnpm test
```

## 8. Risks

1. **Test blast radius.**
   Five test files drive `ProductDialog`, and roughly forty assertions reach controls that move behind a step.
   Mitigated by the `fillIdentity()` + `goToStep()` helper pair and by keeping one `<form>` around the whole wizard so `submit()` never needs navigation.
   This is the largest single cost of the slice and the executor should budget for it.

2. **The new `Nome` submit guard is a real behaviour change.**
   Today a synthetic submit with an empty name emits a payload with `name: ''`; after this slice it emits nothing.
   The change is correct (the name is required by the field's own `required` attribute and by the API) and is forced by the restructure, since `required` is unmounted on steps 2-4.
   It is called out here so it is not mistaken for a regression when roughly fifteen existing tests start needing a name.

3. **Ordering against slices 07, 09 and 10.**
   07 rewrites the Setup and Mensalidade branches, 09 changes the `codeSuffix` default, 10 converts the yellow banners.
   08 must MOVE those blocks and change nothing inside them.
   The `depends_on` on 07 exists precisely so the move happens after the rewrite.

4. **`addButtonOf()` in the test file resolves a section's `Adicionar` through `closest('div.border-t')`.**
   `DialogSection`'s root carries `border-t`, and so will the new `wizardFooterClass`.
   The footer contains no `Adicionar` button, so the helper still resolves correctly, but the executor must not put an `Adicionar` inside the footer.

5. **Converting `SaleWizardDialogBody` to `WizardStepper`.**
   A pure-presentation extraction, but it touches the proposta wizard's DOM.
   `sale-wizard-ui-contract.test.ts` and the eight `sale-wizard-*.test.tsx` files must pass with zero edits; if any of them needs an edit, the extraction was not verbatim and should be redone rather than patched.
