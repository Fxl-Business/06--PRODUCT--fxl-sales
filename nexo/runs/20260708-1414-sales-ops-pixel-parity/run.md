# Run 20260708-1414-sales-ops-pixel-parity

## Mode

Autopilot.
Gate 1 was skipped because the user explicitly approved autopilot.
Gate 2 remains mandatory and local.
Gate 3 is out of scope.

## Request

Review the Sales Ops application against the design source and restore pixel parity, starting with the sale dialog shown in the user screenshots.

## Source

Primary source: user supplied target screenshot for the sale dialog.
Design source: `.demo/fxl-vendas-finders/project/FXL Vendas.dc.html`.
Current implementation: `apps/web/src/sales-ops/SalesOpsApp.tsx`.

## Work Completed

Added a sale wizard UI contract test that failed against the flattened dialog.
Restored the sale dialog to the reference 3-step wizard shell.
Reintroduced the stepper, reference subtitle, finder reveal button, item table headers, payment preview, margin and review steps, and sticky footer actions.
Removed the old `Salvar venda` action from the wizard shell.
Added a tested currency parser so `8000.00`, `8000`, `8.000,00`, and `1200,50` normalize correctly.
Captured a headless wizard screenshot through a temporary Vite harness without adding a production auth bypass.
Refined the wizard unit-price display so whole-real values render as `8000`, matching the source design while still accepting decimal inputs.

## Verification Log

Baseline focused web tests passed before changes.
The sale wizard UI contract test failed before implementation.
The sale wizard UI contract test passed after implementation.
The currency parser test failed before implementation.
The currency parser test passed after implementation.
Focused web tests passed for calculations and sale wizard contract.
Web lint passed.
Web type-check passed.
Headless visual metrics passed for the restored sale wizard step 1.
Final fresh verification passed with `pnpm test`, `pnpm run lint`, `pnpm run type-check`, `pnpm run build`, and `pnpm audit --prod`.
Independent Gate 2 verifier reported PASS on the same commands and confirmed the visual metrics.

## Visual Evidence

Screenshot: `nexo/runs/20260708-1414-sales-ops-pixel-parity/sale-wizard-step1-headless.png`.
Metrics: `nexo/runs/20260708-1414-sales-ops-pixel-parity/sale-wizard-step1-metrics.json`.

## Gate 2 Verifier

Verifier: Popper.
Result: PASS.
The verifier confirmed the full test suite, lint, type-check, build, production audit, and visual metrics.
The verifier also noted unrelated untracked files that should not be included: `.vscode/settings.json` and `nexo/knowledge/doubts/20260707-missing-entitlement.md`.
