# Run 20260706-2356-sales-ops-reference-ui

## Request

Make the Sales Ops application pixel perfect against the `.demo/fxl-vendas-finders/project` reference, starting with the product dialog and sidebar examples supplied by the user.

## Mode

Nexo autopilot.

## Branch

`fix/sales-ops-reference-ui`

## Local Verification

- `pnpm --filter @fxl-sales/web test` passed.
- `pnpm --filter @fxl-sales/web lint` passed.
- `pnpm --filter @fxl-sales/web type-check` passed.
- `pnpm run lint` passed.
- `pnpm run type-check` passed.
- `pnpm run test` passed.
- `pnpm run build` passed.
- `pnpm audit --prod` passed with no known vulnerabilities.

## Visual Evidence

- `sidebar-headless.png` captures the rendered sidebar after switching to Configurações.
- `product-dialog-headless.png` captures the rendered product dialog.
- `visual-metrics.json` records sidebar width `244`, workspace button `212x54`, active nav `rgb(243, 243, 245)`, modal width `560`, modal radius `20px`, and overlay blur `3px`.

## Independent Verify

PASS from verifier `Kant`.
The verifier reran web tests, root lint, root typecheck, root tests, root build, and `pnpm audit --prod`.
The verifier also confirmed the visual artifacts and metrics exist.
