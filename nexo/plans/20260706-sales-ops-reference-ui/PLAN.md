# Sales Ops Reference UI Parity

## Frame

The Sales Ops application does not visually match the reference demo for the product dialog and sidebar.
The user expects the live app to follow the demo source under `.demo/fxl-vendas-finders/project`.

## Acceptance Criteria

Given the Sales Ops app is open on desktop, when the sidebar is expanded, then the workspace control is a compact selector matching the reference layout, colors, icons, and dropdown behavior.
Given the Sales Ops app is open on the products view, when a product dialog is opened, then the modal width, overlay, blur, header, field grouping, toggles, segmented commission controls, and footer match the reference demo.
Given the app is built and tested, when local verification runs, then lint, typecheck, tests, build, and production audit pass.

## Slice

Single slice: align the Sales Ops reference surfaces.

## Test Contract

Run the existing web tests plus full repo lint, typecheck, build, tests, and production audit.
Use a headless Chrome pass when possible to inspect rendered dimensions and preserve screenshots.

## Scope Limits

Do not change API behavior, product persistence behavior, auth flow, or unrelated admin/finder/seller surfaces.
Do not add a new component library.
