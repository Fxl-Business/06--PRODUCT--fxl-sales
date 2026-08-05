---
id: 01-primary-button-never-flips-type
milestone: v2.4.0
status: todo
depends_on: []
files_modified: [apps/web/src/sales-ops/SalesOpsApp.tsx, apps/web/src/sales-ops/__tests__/product-service-dialog.test.tsx, CLAUDE.md]
acceptance: "given the produto/serviço dialog on step 3, when the operator clicks Avançar, then the dialog moves to step 4 and NO save is issued; and the dialog's primary button carries type=button on every step, so its activation behaviour can never change as a result of the click that advances the step"
---

# Produto wizard step 3 -> 4 silently saves

## Reported

On the produto/serviço dialog, clicking `Avançar` on step 3 saves the record instead of just moving
to step 4. Still happening after the deploy that was meant to fix it - and the deployed `production`
branch does contain that earlier fix (`868439c fix(produtos): stop Enter from saving a produto
mid-wizard`), so this is a second, different defect rather than an undeployed fix.

## Root cause - proven in a real browser, not inferred

The dialog's primary button changes its own `type` based on the step it is on:

```tsx
onClick={wizardStep < 4 ? advanceProductWizard : undefined}
type={wizardStep < 4 ? 'button' : 'submit'}
```

Step 3 is the one transition where a click flips that value from `button` to `submit`.

A click has two phases: the event dispatch, and then the browser's *activation behaviour* for the
element. React 18 flushes a discrete event's state update synchronously, so the re-render lands
BETWEEN those two phases. By the time the browser asks "is this a submit button?", React has already
rewritten the attribute to `submit` - so the browser submits the form, `onSubmit={submit}` runs, and
the produto is persisted with commissions and custos the operator never reviewed.

Instrumented in a real Chrome against the real component:

```
type at CAPTURE: button
type at BUBBLE (after React's onClick ran): button
SUBMIT FIRED
-> step "Passo 4 de 4", saves: 1
```

Steps 1->2 and 2->3 are unaffected because the value stays `button` across those clicks.

## Why the existing suite could not see it

`apps/web/src/sales-ops/__tests__/product-service-dialog.test.tsx` reaches later steps through
`goToStep`, which clicks the STEPPER, never `Avançar`. Nothing in the suite has ever clicked the
primary button from step 3.

Worse, adding such a test in happy-dom would be a FALSE GREEN: happy-dom does not model activation
behaviour running after a React flush, so a DOM-level click test passes with the bug fully present.
That was confirmed before writing this plan - a happy-dom reproduction of the exact click reported
`step 4 / 0 saves` while the same interaction in Chrome reported `step 4 / 1 save`.

## The change

Follow the proposta wizard, which is immune for exactly this reason: its primary button is
unconditionally `type="button"` and routes everything through `onClick` (`SalesOpsApp.tsx:8383-8390`).

- The produto dialog's primary button becomes `type="button"` on every step.
- Its `onClick` advances on steps 1-3 and submits on step 4.
- The form keeps `onSubmit={submit}`, so `Salvar alterações` (a real submit button) and the Enter
  handling added by `868439c` are untouched.

Step 4 needs to reach the same `submit` logic without a `FormEvent`. Make the event parameter
optional (`submit(event?: FormEvent)`) and guard the `preventDefault` call, rather than
manufacturing a synthetic event or calling `form.requestSubmit()` - `requestSubmit()` would walk
straight back into the browser's default-button machinery this change exists to leave.

## Tests

The browser race is not reproducible in happy-dom, so the guard is the INVARIANT that makes the race
impossible, plus the behaviour that must survive:

1. `the primary button never changes its activation behaviour between steps` - assert the primary
   button reports `type="button"` on all four steps. This fails on the current code at step 4 and is
   the regression guard that would have caught the defect.
2. `Avançar on step 3 moves to step 4 without saving` - the reported symptom, at DOM level. Honest
   about its limits: it passes on the broken code too, so it is documented as a companion to (1),
   never as the oracle.
3. `the last step still saves` - clicking the final-step button must still call `onSave`, so the fix
   cannot regress into a dialog that can never save.

## Risks

- If `submit` is ever given a required event again, step 4 breaks. Test (3) covers it.
- `Salvar alterações` and the Enter path must keep working; the existing tests in that file already
  cover both and must stay green untouched.
