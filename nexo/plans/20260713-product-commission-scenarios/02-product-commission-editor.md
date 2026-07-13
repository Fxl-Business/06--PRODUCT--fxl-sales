---
id: 02-product-commission-editor
milestone: null
status: done
depends_on: [01-product-commission-contract]
files_modified: [apps/web/src/sales-ops/SalesOpsApp.tsx, apps/web/src/sales-ops/types.ts, apps/web/src/sales-ops/api.ts, apps/web/src/sales-ops/__tests__/product-commission-editor.test.tsx]
acceptance:
  - "given a product editor contains seller-only 10 percent and seller-with-finder 7 percent plus finder 3 percent, when the operator switches tabs, then each tab retains its own values and types"
  - "given both scenarios are configured, when the product is saved and reopened from the returned product row, then seller-only 10 percent and seller-with-finder 7 percent plus finder 3 percent are restored"
  - "given either scenario uses fixed commissions, when tabs are switched and the product is saved and reopened, then each fixed type and value remains unchanged"
  - "given the product list contains both scenarios, when its row renders, then seller-only commission is shown separately from the seller-with-finder plus finder split"
  - "given the operator selects a commission tab, when the active view changes, then tab selection does not erase or overwrite persisted commission fields"
---

# Slice 02 - Product commission editor

## Goal

Make the product commission tabs independent editors over the persisted contract from slice 01.
Save and reopen the seller-only pair, seller-with-finder pair, and finder pair without cross-tab overwrites.
Show both scenarios clearly in the product table.

## Scope limits

This slice changes only Sales Ops product types, product form behavior, save payload typing, product table presentation, focused web tests, and browser verification.
It does not change API validation, database migrations, sale wizard defaults, sale calculations, organization settings, provider commissions, recurring commission behavior, or historical sales.
It retains `hasFinderCommission` on `SalesOpsProduct` for backward response compatibility but stops using it as product-editor tab state or as a condition for showing the saved split.
It does not introduce a new enable or disable switch for finder commissions.
It does not change the established dialog shell, colors, typography, spacing system, or table component primitives beyond the commission content required here.

## UI and state design

Keep the existing `Somente vendedor` and `Vendedor + Finder` segmented control.
Introduce a local editor-only state named `commissionMode` with the union `'seller_only' | 'with_finder'`.
Initialize it to `'seller_only'` every time the keyed product dialog opens.
Clicking a tab changes only `commissionMode`.
It must not mutate `hasFinderCommission` or any commission value or type.

Extend `ProductForm` with these required string-backed controls:

```ts
sellerCommissionType: 'pct' | 'fix';
sellerCommissionValue: string;
sellerWithFinderCommissionType: 'pct' | 'fix';
sellerWithFinderCommissionValue: string;
finderCommissionType: 'pct' | 'fix';
finderCommissionValue: string;
```

Remove `hasFinderCommission` from `ProductForm` because it is no longer view state.
Do not include `hasFinderCommission` in the product dialog save payload.
The API retains its current value on patch and applies its existing default on create.
No visible product behavior in this slice may depend on that legacy boolean.

For a new product, initialize seller-only to `pct/10`, seller-with-finder to `pct/7`, and finder to `pct/3`.
For an existing product, initialize each control from its matching persisted type and value.
For defensive compatibility during a staggered local rollout, if an existing runtime object lacks a new seller-with-finder field, fall back to that product's seller-only field.
Do not use the new-product `7` default when rehydrating an older product object because that would silently reduce its former seller rate.

When `commissionMode` is `seller_only`, bind the seller controls only to `sellerCommissionType` and `sellerCommissionValue`.
Do not render the finder row in this mode.
When `commissionMode` is `with_finder`, bind the seller controls only to `sellerWithFinderCommissionType` and `sellerWithFinderCommissionValue` and render the finder controls bound to `finderCommissionType` and `finderCommissionValue`.
The two seller pairs must never share an input value or update handler.

Add unique accessible labels to the three amount inputs and their `%` and `R$` unit buttons so tests and keyboard or assistive users can target the intended scenario unambiguously.
Use labels equivalent to `Comissão do vendedor - somente vendedor`, `Comissão do vendedor - com finder`, and `Comissão do finder`.
Keep the active tab and active unit button dark with white text, matching the supplied screenshots.
Keep both tab buttons equal width.
The finder mode may grow vertically by one row, but switching modes must not shift or resize the segmented control itself.

## Web type and save contract

Add these required response fields to `SalesOpsProduct` in `types.ts`:

```ts
sellerWithFinderCommissionType: CommissionType;
sellerWithFinderCommissionValue: string;
```

Keep all three persisted numeric commission values as strings in `SalesOpsProduct`, matching the Drizzle JSON response.

Update `SaveProductPayload` in `api.ts` so `sellerWithFinderCommissionValue` follows the existing numeric request convention.
Add it to the `Omit` list beside the existing seller and finder values, then reintroduce it as `sellerWithFinderCommissionValue?: number`.
The type fields continue to come from `Partial<SalesOpsProduct>` and remain `'pct' | 'fix'`.

On submit, always include all three type and value pairs, regardless of the active tab.
Parse seller-only with fallback `10`, seller-with-finder with fallback `7`, and finder with fallback `3`.
Never zero the finder value merely because the seller-only tab is active.
Tab selection is not persisted and must not change the body sent by `salesOpsApi.saveProduct`.

## Product table contract

Replace the ambiguous `Com. vend.` and `Com. finder` presentation with two scenario columns.
Use headings `Somente vendedor` and `Vendedor + Finder`, allowing visually compact line breaks if needed without abbreviating away the distinction.

The seller-only cell must format `sellerCommissionType` plus `sellerCommissionValue`.
The split cell must format `sellerWithFinderCommissionType` plus `sellerWithFinderCommissionValue`, then ` + `, then `finderCommissionType` plus `finderCommissionValue`.
For the motivating percentage example, the row must visibly read `10%` and `7% + 3%` in separate cells.
For `fix`, include an explicit `R$` prefix and format the decimal as Brazilian currency so the table never displays an unlabeled number.
Fixed commission values are stored in BRL major units, so do not pass them to the existing cents-based `formatMoneyBrl` helper.
Do not hide the split behind `hasFinderCommission`.
Use the same small formatting helper for all three values to keep percentage and fixed formatting consistent.

## RED test contract

Create `apps/web/src/sales-ops/__tests__/product-commission-editor.test.tsx` before changing production code.
Mark it with the `happy-dom` Vitest environment.
Render the exported `ProductDialog` and `ProductsView` directly with lightweight mocks for the Radix dialog wrappers so the tests exercise React state and DOM events without mounting the whole authenticated application.
Use React `act`, `createRoot`, native DOM queries, and native click or input events because Testing Library is not installed.
Clean up and unmount after every test.

Run the focused test once and record RED:

```bash
pnpm --filter @fxl-sales/web test -- src/sales-ops/__tests__/product-commission-editor.test.tsx
```

The locked tests are:

- `keeps seller-only 10 percent independent from seller-with-finder 7 percent plus finder 3 percent`
  Open a new product dialog and assert the seller-only input is `10`.
  Enter a valid name, switch to `Vendedor + Finder`, assert the seller input is `7` and finder input is `3`, change the split seller to `6.5`, switch back, and prove the seller-only input is still `10`.
  Switch again and prove `6.5` and `3` remain.
- `submits every commission pair regardless of the active tab`
  Configure seller-only `pct/10`, seller-with-finder `pct/7`, and finder `pct/3`, finish on either tab, submit, and assert the save spy receives all six fields with numeric values `10`, `7`, and `3`.
  Assert the payload contains no tab-derived zeroing of the finder value.
- `rehydrates saved independent scenarios when the product dialog is reopened`
  Unmount after a save, render the dialog again with a returned `SalesOpsProduct` containing `pct/10`, `pct/7`, and `pct/3`, switch between both tabs, and assert each matching control restores its persisted value.
- `preserves fixed type and value controls across switching, save, and reopen`
  Set seller-only to `fix/1000`, seller-with-finder to `fix/700`, and finder to `fix/300` through the uniquely labeled unit buttons and inputs.
  Switch between tabs twice, submit, and assert all three `fix` types and numeric values are present.
  Reopen with decimal-string response values and prove every `R$` toggle and input remains selected and unchanged.
- `shows seller-only and seller-with-finder scenarios separately in the product table`
  Render one product row with `pct/10`, `pct/7`, and `pct/3` while `hasFinderCommission` is false.
  Assert the headings `Somente vendedor` and `Vendedor + Finder` exist and the row contains `10%` and `7% + 3%` in separate cells.
  Render a fixed-value variant and assert every amount has an explicit `R$` marker.

The initial RED must fail because the response and payload types lack the new fields, both tabs currently bind the same seller controls, seller-only mode zeros finder commission on save, and the table shows only the legacy pair.
Keep the behavioral assertions locked after observing RED.
Only change the test if the test harness itself is proven invalid.

## GREEN implementation steps

1. Add the two required seller-with-finder response fields to `SalesOpsProduct`.
2. Add the numeric seller-with-finder request value override to `SaveProductPayload`.
3. Export `ProductDialog` and `ProductsView` as named components for focused behavioral tests without changing their production call sites.
4. Add the two seller-with-finder controls to `ProductForm`, remove tab use of `hasFinderCommission`, and implement the exact new and existing product initialization rules above.
5. Add local `commissionMode` state to `ProductDialogBody` and wire both segmented buttons only to that state.
6. Render seller-only controls against the old seller pair and split seller controls against the new pair.
7. Keep finder controls bound to their existing pair and visible only in split mode.
8. Add unique accessible labels to scenario inputs and unit buttons without changing the visual treatment.
9. Build a save payload that always includes all three pairs and never gates finder data on the active tab.
10. Add the shared display formatter and update the product table to render the two scenario columns without consulting `hasFinderCommission`.
11. Run the focused test until green.
12. Run web type-check, lint, and the existing Sales Ops tests before refactoring.

## Refactor on green

Keep scenario selection local to the dialog and keep persisted form data in one flat object that mirrors the API names.
If rendering duplicate seller control markup becomes noisy, extract one small local commission control component only after the focused test is green.
The extracted component must receive explicit type and value props and must not own cross-scenario state.
Keep the commission display formatter pure and colocated with `ProductsView` unless another existing consumer needs it.
Do not split unrelated parts of the large `SalesOpsApp.tsx` in this slice.
Re-run the focused and existing Sales Ops suites after refactoring.

## Browser visual and E2E oracle

Use the in-app browser against the locally built application and its normal authenticated Sales Ops API path.
Prefer build plus start or preview processes over watch-mode development servers.
Track every process group started for the check and stop the whole process groups before finishing the turn.

Exercise this exact end-user flow at a desktop viewport of at least `1440 x 900`:

1. Open the team Sales Ops workspace, go to `Configuração`, and open `Produtos`.
2. Create or edit a disposable product and open the `Somente vendedor` tab.
3. Select `%`, enter `10`, switch to `Vendedor + Finder`, select `%`, enter seller `7` and finder `3`, then switch back and verify `10` is still visible.
4. Switch to the split tab again and verify `7` and `3` are still visible before saving.
5. Save, wait for the product list refetch, and verify the row shows `10%` under `Somente vendedor` and `7% + 3%` under `Vendedor + Finder`.
6. Reopen the saved product, inspect both tabs, and verify all three values survived the API round trip.
7. Repeat with a disposable fixed-value product using seller-only `R$ 1000`, seller-with-finder `R$ 700`, and finder `R$ 300`, then save and reopen it to prove the unit selections and values persist.

Capture screenshots of seller-only mode, split mode, and the product table row.
Compare the modal visually with the supplied references.
The segmented control must remain a single light rounded track with an equal-width near-black active segment, white active text, muted inactive text, and stable dimensions between modes.
The amount rows must align their unit toggle, input, and trailing unit markers on one baseline.
The split mode must show seller and finder rows with consistent vertical spacing and no clipping.
The dialog must remain fully usable without horizontal scrolling and the product table must communicate both scenarios without truncated or ambiguous headers.
Treat missing labels, misaligned controls, clipped currency text, layout jumps, and unclear scenario values as failures even if the save request succeeds.

## Regression and security notes

The UI must send only product fields and must never add `orgId`, account identifiers, or workspace identifiers to the body.
The existing token-authenticated `salesOpsApi.saveProduct` path remains unchanged.
The product mutation continues to invalidate and refetch the Sales Ops bootstrap through its existing hook behavior.
Fixed values must remain numeric request values and decimal-string response values without currency-to-cents conversion.
Percentage values must retain decimals such as `6.5` without integer rounding.
Provider commission controls and values must remain untouched.
Existing loading, empty, and loaded product states must remain intact.

## Verification commands

Run each command once and do not use watch mode:

```bash
pnpm --filter @fxl-sales/web test -- src/sales-ops/__tests__/product-commission-editor.test.tsx
pnpm --filter @fxl-sales/web test -- src/sales-ops/__tests__/calculations.test.ts src/sales-ops/__tests__/navigation.test.ts src/sales-ops/__tests__/sale-wizard-ui-contract.test.ts
pnpm --filter @fxl-sales/web type-check
pnpm --filter @fxl-sales/web lint
git diff --check
```

The focused component suite and browser save, reopen, and table flow are this slice's named oracle.
Gate 2 must be run by a separate Verify agent under the Nexo execution flow.
