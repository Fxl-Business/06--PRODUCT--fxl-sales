---
id: 01-produto-wizard-step3
milestone: v2.4.0
status: todo
depends_on: []
files_modified: [apps/web/src/sales-ops/SalesOpsApp.tsx, apps/web/src/sales-ops/__tests__/product-service-dialog.test.tsx]
acceptance: "given a new produto on wizard step 3 (Pagamento), when the operator presses Enter in Parcelas restantes, then the wizard shows step 4 (Comissões e custos) and onSave has not been called"
---

# Slice 01 — the produto wizard saves from step 3 instead of advancing

## 1. Root cause

The screen is NOT `apps/web/src/admin/products/ProductDialog.tsx` (that is the dead legacy
admin tree — a 155-line single-page dialog with no wizard at all). `/cadastros/produtos`
opens `ProductDialog` / `ProductDialogBody`, both declared inside
`apps/web/src/sales-ops/SalesOpsApp.tsx` (`ProductDialog` at :3392, `ProductDialogBody` at
:3433). Do not touch the legacy file.

### What is NOT the cause (all three of the usual suspects were checked and ruled out)

- **Not a step-count off-by-one.** `productWizardSteps` at `SalesOpsApp.tsx:3385-3390` has
  exactly four entries, `advanceProductWizard` at :3617-3623 is
  `setWizardStep((current) => (current < 4 ? ((current + 1) as 2 | 3 | 4) : current))`, and
  the body renders `wizardStep === 1|2|3|4` at :3807 / :3901 / :4050 / :4140. All consistent.
- **Not a `<button>` defaulting to `type="submit"`.** Every `<button>` inside the form
  (`SalesOpsApp.tsx:3792-4405`) carries an explicit `type`, and so does every component it
  renders: `SegmentedButton` (:3243), `UnitToggle` (:3277), `WizardStepper` (:3338),
  `ListEditor`'s `Adicionar` (:4480), `Combobox`'s trigger (`components/ui/combobox.tsx:325`)
  and `InfoHint`'s trigger (`components/ui/info-hint.tsx:120`).
- **Not the `Avançar` button itself.** `SalesOpsApp.tsx:4389-4402`:

  ```tsx
  <button
    className={wizardPrimaryButtonClass}
    disabled={saving || (wizardStep === 1 && !canAdvanceStepOne)}
    onClick={wizardStep < 4 ? advanceProductWizard : undefined}
    type={wizardStep < 4 ? 'button' : 'submit'}
  >
  ```

  On step 3 that resolves to `type="button"` + `onClick={advanceProductWizard}`, so a MOUSE
  CLICK on `Avançar` provably cannot submit. Executor: do not go looking for a click bug.

### What IS the cause

**`SalesOpsApp.tsx:3792` — one `<form onSubmit={submit}>` wraps all four steps, and
`submit` (:3629) persists unconditionally, so ANY submission raised from steps 1-3 saves the
produto. The submission the operator actually raises there is the browser's HTML *implicit
submission*: Enter in a text control.**

```tsx
// SalesOpsApp.tsx:3792
<form className="flex min-h-0 flex-1 flex-col" onSubmit={submit}>
```

The comment two lines above it states the design intent — "a submit from any step emits the
complete payload and no step needs to be visited for its fields to be sent" — which is
correct for the EDIT path's deliberate `Salvar alterações`, but it also leaves Enter wired
straight to `onSave`.

Why step 3 specifically, and why the operator experiences it as "Avançar did it":

- HTML "implicit submission": a form with **no submit button** is submitted *from the form
  element itself* when it has **no more than one** field that blocks implicit submission
  (`input` of type text/number/etc.).
- On the CREATE path the form has **zero** submit buttons while `wizardStep < 4`:
  `Salvar alterações` at :4379 is gated on `activeModal.product`, and the primary is
  `type="button"` until step 4.
- `productForm` (:3160) seeds `hasMonthly: false` (:3180) and `defaultEntradaMode: 'none'`
  (:3194). So step 3 (:4050) mounts **exactly one** blocking control — `Parcelas restantes`,
  `<input type="number">` at :4085-4095. `Valor da entrada` is unmounted (:4070) and
  `Número de ciclos` is unmounted (:4110). The two Comboboxes are `<button>`s, not inputs.
- Result: Enter anywhere in `Parcelas restantes` on step 3 → `onSubmit` → `submit()` →
  `onSave(payload)` → `SalesOpsApp.tsx:1447` `saveProduct.mutate(payload, { onSuccess: () =>
  setModal(null) })` → the produto is created and the dialog closes. Exactly the report.
- Step 2 (:3901) has the same one-field shape (`Setup (R$)` at :3905, the mensalidade and
  módulo inputs are unmounted by default), so it is equally exposed. Step 1 has **two**
  blocking inputs (`Nome` :3828 and the código suffix `<input type="text">` :3884), so Enter
  there is inert — which is exactly why an operator who habitually presses Enter to mean
  "next" sees nothing happen on step 1 and then a silent save on step 2/3, and reports it as
  "Avançar saved the product".
- The repo already half-knows this. `product-service-dialog.test.tsx:1183-1187` says: *"`Avançar` is disabled while step 1 is incomplete, so the operator's real route to a
  blocked step 1 is the implicit form submission Enter gives them from either field."*
  Nobody then asked what that same Enter does on steps 2 and 3.
- **The EDIT path is strictly worse:** `SalesOpsApp.tsx:4380-4387` renders
  `Salvar alterações` with `type="submit"` on steps 1-3, making it the form's **default
  button**, so Enter in *any* field on *any* of steps 1-3 activates it and saves.
- The proposta wizard never had this bug for a structural reason worth preserving: it has no
  `<form>` at all and its footer buttons are all `type="button"` (`SalesOpsApp.tsx:7853-7883`).

## 2. The fix

Three edits, all in `apps/web/src/sales-ops/SalesOpsApp.tsx`. Nothing else changes — no
payload change, no `submit()` change, no button `type` change.

### 2a. Import the React keyboard-event type (line 25)

Current:

```ts
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
```

Becomes (prettier will wrap it; let it):

```ts
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
```

The `as ReactKeyboardEvent` alias is required, not cosmetic: an unaliased
`type KeyboardEvent` shadows the DOM global for the whole module.

### 2b. Add the guard inside `ProductDialogBody`, immediately after `goBackProductWizard` (which ends at :3627) and before `submit` (:3629)

```ts
  /*
    Enter means `Avançar`, never `salvar`, until the last step. All four steps share ONE
    <form>, and steps 2 and 3 each mount exactly one control that blocks implicit
    submission (`Setup (R$)`, `Parcelas restantes`), so with no submit button on the
    create path the browser submits the form FROM THE FORM ELEMENT ITSELF the moment the
    operator hits Enter in one - and on the edit path `Salvar alterações` is the form's
    default button, so Enter from any field activates it. Both persisted a produto whose
    comissões and custos padrão the operator had never seen.

    Scoped to an <input> on purpose: a focused <button> keeps its own Enter, so Voltar,
    Cancelar, the stepper, the X and every toggle still do what they say. The
    `defaultPrevented` check is what keeps `Combobox` - which already swallows Enter to
    commit a row (components/ui/combobox.tsx:223) and does NOT stopPropagation - from
    advancing the wizard behind the operator's back.
  */
  function handleWizardKeyDown(event: ReactKeyboardEvent<HTMLFormElement>) {
    if (event.key !== 'Enter' || event.defaultPrevented) return;
    if (!(event.target instanceof HTMLInputElement)) return;
    if (wizardStep === 4) return;
    event.preventDefault();
    advanceProductWizard();
  }
```

`wizardStep === 4` is left alone deliberately: on the last step the primary button really is
`type="submit"`, so Enter saving there is the correct behaviour and stays.

### 2c. Wire it onto the form (:3792), keeping the codebase's alphabetical prop order

```tsx
        <form
          className="flex min-h-0 flex-1 flex-col"
          onKeyDown={handleWizardKeyDown}
          onSubmit={submit}
        >
```

### Why this shape and not a `submit()` guard

Guarding `submit()` on `wizardStep` would break 28 existing tests that legitimately dispatch
a bare `submit` event from an early step (26 in `product-service-dialog.test.tsx`, 2 in
`product-commission-editor.test.tsx`) plus
`cadastros-refresh.test.tsx:363`, and it would also break the documented edit-path
`Salvar alterações` mid-wizard save (`SalesOpsApp.tsx:4372-4378`,
`product-service-dialog.test.tsx:1279`). Cancelling the keydown is the complete cure because
implicit submission and default-button activation are both *default actions of the keydown*,
so `preventDefault()` stops them in every browser, and it costs zero existing tests.

## 3. The named oracle test

**File (extend, do not create):**
`apps/web/src/sales-ops/__tests__/product-service-dialog.test.tsx`

**Helper** — add next to the existing `submit()` helper (~:232):

```tsx
/**
 * A browser's implicit submission, in two halves: Enter runs the keydown handlers
 * first, and the form is submitted only if nothing cancelled the default action.
 * happy-dom implements the first half and not the second (it only calls
 * `form.requestSubmit` from a real submit-button click), so this helper does the
 * second half itself - which is what makes these tests a regression guard for the
 * browser behaviour and not only for the keydown handler.
 */
async function pressEnter(input: HTMLInputElement) {
  const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
  await act(async () => {
    input.dispatchEvent(event);
  });
  if (!event.defaultPrevented) await submit();
}
```

**Tests** — add to the existing `describe('the produto wizard shell', ...)` block (opens at
:1099), reusing `renderDialog`, `fillIdentity`, `goToStep`, `labeledInput`, `moneyInput`,
`text`, `pickOption`, `comboboxTrigger`:

1. `it('advances instead of saving when Enter is pressed on the pagamento step', ...)`
   create path (`{ productKind: 'product' }`), `fillIdentity()`, `goToStep(3)`,
   `pressEnter(labeledInput('Parcelas restantes'))` →
   `expect(onSave).not.toHaveBeenCalled()`,
   `expect(text()).toContain('Passo 4 de 4')`,
   `expect(text()).toContain('Comissionamento padrão')`.
   *This is the acceptance sentence. It is RED at HEAD on both assertions.*

2. `it('advances instead of saving when Enter is pressed on the valores step', ...)`
   same, `goToStep(2)`, `pressEnter(moneyInput('Setup (R$)'))` →
   `onSave` not called, `Passo 3 de 4`, `Plano de pagamento padrão` on screen.

3. `it('advances instead of saving when Enter is pressed on an existing produto', ...)`
   `renderDialog({ existing: product() })`, `goToStep(3)`,
   `pressEnter(labeledInput('Parcelas restantes'))` → `onSave` not called and
   `Passo 4 de 4`. Covers the edit path's default-button half.

4. `it('leaves Enter inside the tipo de entrada picker to the picker', ...)`
   `fillIdentity()`, `goToStep(3)`, `click(comboboxTrigger('Tipo de entrada'))`, then
   `pressEnter` on `container.querySelector('input[placeholder="Buscar tipo de entrada..."]')`
   → still `Passo 3 de 4` and `onSave` not called. This is the guard on the
   `event.defaultPrevented` clause; deleting that clause makes this test fail.

5. `it('does not hijack Enter on a footer button', ...)`
   `fillIdentity()`, `goToStep(3)`, dispatch the same Enter keydown on `button('Voltar')`
   → still `Passo 3 de 4`. This is the guard on the `instanceof HTMLInputElement` clause.

**Command (run-once, this file only):**

```bash
pnpm --filter @fxl-sales/web test -- --run src/sales-ops/__tests__/product-service-dialog.test.tsx
```

(`@fxl-sales/web`'s `test` script is `vitest run`; the extra `--run` is harmless and keeps
the batch's run-once convention. Paths are relative to `apps/web`, per
`apps/web/vitest.config.ts`.)

**Also re-run, because they exercise the same form and must stay green unchanged:**

```bash
pnpm --filter @fxl-sales/web test -- --run src/sales-ops/__tests__/product-commission-editor.test.tsx src/sales-ops/__tests__/cadastros-refresh.test.tsx src/sales-ops/__tests__/optimistic-row-guard.test.tsx src/sales-ops/__tests__/combobox-adoption.test.tsx
```

## 4. Scope limits (YAGNI)

- **The optimistic-update half of the item is deliberately NOT changed. The produtos list
  already refreshes on its own after a create or an update.** Evidence:
  `useSaveSalesOpsProduct` (`apps/web/src/sales-ops/hooks.ts:136-146`) declares
  `invalidates: [queryKeys.salesOps.all]`, and `useAppMutation`
  (`apps/web/src/lib/app-mutation.ts:53-66`) invalidates every listed key in `onSettled`, on
  success and on failure alike. `cadastros-refresh.test.tsx:363` —
  *"shows a new produto in the list once the create POST resolves, with no further user
  action"* — already pins that end to end. What produtos does not have is a *pre-response*
  optimistic row: `OptimisticCollection` in `apps/web/src/sales-ops/optimistic.ts:31` is
  `'areas' | 'clients' | 'funcoes' | 'people'`, and the comment at `hooks.ts:138-140` gives
  the reason — the payload drops `type` and the three commission values come back
  re-serialised by Postgres `numeric`, so the client cannot build the persisted row. Making
  produtos optimistic means designing a product row builder plus its reconcile, which is a
  separate slice with its own acceptance (the precedent is
  `nexo/plans/20260707-optimistic-product-create/`). It is NOT a step-3 bug fix and must not
  ride along here.
- Does not change `submit()`, `SaveProductPayload`, any button `type`, or the "one form
  around the whole step tree" design.
- Does not move the invalidation out of `onSettled`, and therefore does not touch the
  related `code_suffix` staleness note in `nexo/ROADMAP.md:11`. That entry stays open.
- Does not touch the legacy `apps/web/src/admin/products/**` tree.
- Does not convert the two documented shadcn `Select` sites to `Combobox`
  (CLAUDE.md "UI Controls") — that exception names the LEGACY
  `apps/web/src/admin/products/ProductDialog.tsx`, not this file, and this file already uses
  `Combobox` throughout.
- Does not add Enter-to-advance anywhere else (the proposta wizard has no `<form>` and is
  structurally immune).

## 5. Risk / invariants touched

- **CLAUDE.md > UI Controls, the inline-layer rule.** The new handler is Enter-only and
  never touches Escape, `useInlineLayer`, or `DialogContent`'s `onEscapeKeyDown`. Nothing in
  the Escape blast radius moves.
- **`Combobox`'s "a surrounding `<form>` never submits on Enter" contract**
  (`components/ui/combobox.tsx:223-225`). `Combobox` calls `preventDefault()` but not
  `stopPropagation()`, so its Enter *does* reach the form handler. The
  `event.defaultPrevented` early return is the only thing keeping a row-commit from also
  advancing the wizard. Oracle test 4 exists for exactly this; do not simplify the clause away.
- **CLAUDE.md > Produtos & Serviços.** No schema, payload, `kind`/`openPrice`,
  `defaultEntradaMode` (`'fix'`, never `'fixed'`), `defaultRecurringCycles: null`
  (blank = indeterminado) or `productFuncaoCosts` semantics change. The 120/119 parcela cap
  and `nextProductCodeSuffix` are untouched.
- **Behaviour change to state plainly in the commit body:** Enter in a field on steps 1-3
  now advances instead of saving. On step 1 that runs `advanceProductWizard`, which sets
  `showIdentityErrors` and refuses to move when `canAdvanceStepOne` is false — the same copy
  the operator already gets today, so `product-service-dialog.test.tsx:1191` stays green.
  On the edit path, Enter no longer fires `Salvar alterações`; that button still works by
  click and is still the only mid-wizard save (`product-service-dialog.test.tsx:1279`,
  `:1291`).
- **Low blast radius, one component.** `handleWizardKeyDown` is local to
  `ProductDialogBody`; no other dialog and no other wizard is reached.
