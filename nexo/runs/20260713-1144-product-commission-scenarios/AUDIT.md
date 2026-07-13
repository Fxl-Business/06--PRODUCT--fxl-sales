# Autopilot audit - run 20260713-1144-product-commission-scenarios

## Slice 02 - Product commission editor

- [ ] TEST: Open a product in a real browser and confirm the `Somente vendedor` and `Vendedor + Finder` tabs retain stable styling and dimensions, the split rows align without clipping, and the table clearly shows `10%` separately from `7% + 3%`.
  The in-app browser backend was unavailable during the run, while the DOM interaction, save, reopen, fixed-value, and table assertions passed automatically.

## Slice 03 - Product-aware sale defaults

- [ ] TEST: In an authenticated real browser, open the sale wizard with a primary product configured for `10%` seller-only and `7% + 3%` with a finder, then confirm the visible inputs, payable previews, and margin switch correctly when a finder is added or removed.
  Confirm that changing the primary product replaces the defaults, changing a secondary item does not, and the wizard remains aligned, unclipped, and keyboard-focusable throughout the flow.
  The in-app browser backend was unavailable during the run, while the rendered wizard interaction, primary-product selection, finder transition, and submitted snapshot assertions passed automatically.
