---
id: 02-currency-parsing-hardening
milestone: sales-ops-pixel-parity
status: done
depends_on: [01-sale-wizard-visual-parity]
files_modified: [apps/web/src/sales-ops/calculations.ts, apps/web/src/sales-ops/__tests__/calculations.test.ts, apps/web/src/sales-ops/SalesOpsApp.tsx]
acceptance: "Given a money input such as 8000.00 or 8.000,00, when the app parses it for product and wizard totals, then it becomes 800000 cents."
---

# Slice 02 - Currency Parsing Hardening

## Scope

Move currency input parsing into a tested sales-ops calculation helper.
Support plain integer BRL values, dot decimal values, and Brazilian formatted values.
Use the helper from the UI parser.

## Test Contract

The oracle command is `pnpm --filter @fxl-sales/web test -- src/sales-ops/__tests__/calculations.test.ts`.

## Result

The new parser test failed before implementation because the helper did not exist.
The test passed after the helper was added and wired into the UI.
