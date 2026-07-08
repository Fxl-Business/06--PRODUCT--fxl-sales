---
id: 03-visual-evidence-and-capture
milestone: sales-ops-pixel-parity
status: done
depends_on: [02-currency-parsing-hardening]
files_modified: [nexo/runs/20260708-1414-sales-ops-pixel-parity/sale-wizard-step1-headless.png, nexo/runs/20260708-1414-sales-ops-pixel-parity/sale-wizard-step1-metrics.json]
acceptance: "Given a fixture-rendered sale wizard, when headless Chrome captures step 1, then metrics confirm the reference copy, stepper, finder button, item headers, recurring line, footer, and correct R$ 8.000 total."
---

# Slice 03 - Visual Evidence And Capture

## Scope

Capture the restored sale wizard with a temporary Vite harness.
Do not keep the harness as a production route.
Preserve the screenshot and metrics in the run artifact.

## Test Contract

The visual oracle is `nexo/runs/20260708-1414-sales-ops-pixel-parity/sale-wizard-step1-metrics.json`.

## Result

The final metrics file confirms the expected title, subtitle, stepper, finder button, item headers, recurring line, footer, absence of `Salvar venda`, correct `R$ 8.000` total, and compact `8000` unit input.
