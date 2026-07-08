---
id: 01-sale-wizard-visual-parity
milestone: sales-ops-pixel-parity
status: done
depends_on: []
files_modified: [apps/web/src/sales-ops/SalesOpsApp.tsx, apps/web/src/sales-ops/__tests__/sale-wizard-ui-contract.test.ts]
acceptance: "Given the sale dialog opens, when step 1 renders, then the reference wizard shell, stepper, finder reveal button, and footer actions are present and the old Salvar venda action is absent."
---

# Slice 01 - Sale Wizard Visual Parity

## Scope

Restore the sale dialog from a one-screen form to the reference 3-step wizard.
Keep the existing sale payload path and mutation behavior.
Add a regression test that fails if the sale wizard shell is flattened again.

## Test Contract

The oracle command is `pnpm --filter @fxl-sales/web test -- src/sales-ops/__tests__/sale-wizard-ui-contract.test.ts`.

## Result

The oracle failed before implementation because the reference wizard copy and controls were absent.
The oracle passed after the restored wizard shell was implemented.
