---
id: 20260708-sales-ops-pixel-parity
milestone: sales-ops-pixel-parity
status: doing
mode: autopilot
---

# Sales Ops Pixel Parity

## Frame

The Sales Ops application drifted from the `.demo/fxl-vendas-finders/project/FXL Vendas.dc.html` reference.
The most visible regression is the sale closing dialog.
The current app flattened the reference wizard into a single long form.
The previous pixel pass checked sidebar and product dialog only, so the sale wizard regression had no oracle.

## Why

The app needs to match the design source closely enough that the live product feels like the approved FXL Vendas interface.
The sale dialog is a core workflow and must not ship with a different information architecture from the reference.

## Source Order

1. User supplied target screenshot for the sale dialog.
2. `.demo/fxl-vendas-finders/project/FXL Vendas.dc.html`.
3. Existing live Sales Ops data and API contracts.
4. Existing app conventions in `apps/web/AGENTS.md`.

## Acceptance Criteria

Given the sale dialog opens, when step 1 renders, then it shows the reference shell with title, subtitle, stepper, client card, item card, payment card, finder reveal button, sticky footer, `Salvar incompleto`, and `Avançar`.
Given a sale item is initialized from an `8000.00` or `8.000,00` input, when totals are calculated, then the subtotal is `R$ 8.000` and not `R$ 800.000`.
Given the wizard reaches later steps, when the user advances, then costs, margin, review, and generated payable previews remain available before final confirmation.
Given verification runs, when the focused oracle, lint, type-check, build, and visual harness finish, then the sale wizard contract and screenshot metrics are green.

## Scope Limits

Do not change API behavior.
Do not add an auth bypass or production-only visual test route.
Do not add hosted CI.
Do not cut or promote a release.

## Slice Index

| Slice | Name | Depends On | Acceptance |
| --- | --- | --- | --- |
| 01 | Sale wizard visual parity | none | The sale wizard step 1 matches the reference structure and has a regression oracle. |
| 02 | Currency parsing hardening | 01 | Wizard and product money inputs parse both Brazilian and decimal formats correctly. |
| 03 | Visual evidence and capture | 02 | A headless screenshot and metrics prove the restored wizard shell without weakening auth. |
