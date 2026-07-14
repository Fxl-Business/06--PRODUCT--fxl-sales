---
id: 01-custom-sale-item-labels
milestone: null
status: done
depends_on: []
files_modified: [apps/api/src/domains/sales-ops/service.ts, apps/api/src/domains/sales-ops/__tests__/service.test.ts, apps/web/src/sales-ops/SalesOpsApp.tsx, apps/web/src/sales-ops/__tests__/sale-wizard-custom-item-labels.test.tsx]
acceptance: "Given repeated open-price products in one sale, when the operator enters independent non-blank labels and positive negotiated values, then the wizard retains their order, shows the labels in review, and submits each label as productNameSnapshot with the original productId, while incomplete drafts and fixed-price products continue to use the catalog name."
---

# Slice 01 - Custom sale item labels

## Goal

Allow an operator to add the same open-price catalog product to one sale multiple times and name every line independently.
The motivating sale must support `Módulo Vendas` at R$ 4.000,00 and `Módulo RH` at R$ 9.000,00 as two ordered lines that both retain the FXL Custom `productId`.
Use the existing `productName` request field and `productNameSnapshot` database column so no database migration is required.

## Existing data path

`SaleWizardDialogBody.createPayload` currently maps each rendered row to `SaleDraft.items[].productName`.
`buildSalePayload` already trims `SaleDraft.items[].productName` and sends it as `CreateSalePayload.items[].productName`.
`CreateSaleSchema` parses that request field.
`buildSaleLedger` already copies it to `ledger.items[].productNameSnapshot` while copying `productId` independently.
`createSale` already inserts both values into `sales_ops_sale_items`.
The implementation must change the value selected by the wizard and harden the existing API string contract, but it must not add another request field or persistence field.

## Scope

This slice changes the new-sale wizard item rows, step-one validation, review text, request name selection, API name normalization, and focused tests.
It does not edit existing sales, add descriptions to catalog products, create module products, change quantity or currency parsing, change sale totals, change commission or payment calculations, or add a migration.
It does not change the `CreateSalePayload`, `SaleDraftItem`, or `SalesOpsSaleItem` public type shapes because all three already carry the required name or snapshot field.
It does not add a second sale-item label column or overload the sale notes field.
It does not change bootstrap serialization because persisted snapshots already return as `SalesOpsSaleItem.productNameSnapshot`.
It does not release or promote the result beyond `master` under Autopilot.

## File map

- `apps/web/src/sales-ops/SalesOpsApp.tsx` owns transient per-row labels, validation, item-row UI, review rendering, and payload name selection.
- `apps/web/src/sales-ops/__tests__/sale-wizard-custom-item-labels.test.tsx` is the rendered user-flow oracle for repeated custom rows, validation, draft fallback, review, and fixed-price behavior.
- `apps/api/src/domains/sales-ops/service.ts` owns the server-side item-name boundary and the existing snapshot mapping.
- `apps/api/src/domains/sales-ops/__tests__/service.test.ts` locks normalization, length limits, independent ordered snapshots, and retained product identifiers.

## Exact transient state contract

Extend the local `SaleItemForm` type in `SalesOpsApp.tsx` with exactly one field.

```ts
type SaleItemForm = {
  productId: string;
  customLabel: string;
  quantity: string;
  unitBrl: string;
};
```

Initialize `customLabel` to `''` for the initial item and every item created by `addItem`.
Keep the label on the same array object as its row so adding, editing, and deleting repeated instances preserves each row's independent value and array order.
When `setItem` receives a changed `productId`, set `customLabel` to `''` before returning the next item and continue resetting `unitBrl` from the selected product as today.
This reset prevents a label entered for one product from leaking into a newly selected product.
Do not require labels to be unique because two separately priced deliverables may legitimately share a name.

Add a local helper named `saleItemDisplayName` with this exact rule.

```ts
function saleItemDisplayName(item: SaleItemForm): string {
  const product = selectedProduct(item);
  if (!product) return 'Produto';
  if (!product.openPrice) return product.name;
  return item.customLabel.trim() || product.name;
}
```

Use this helper in both the step-three `Produto(s)` summary and `createPayload`.
The final or draft payload must never send a stale custom label for a fixed-price product.
The fallback for an unlabeled open-price draft must be the selected catalog name, normally `FXL Custom`.

## Exact UI behavior

Keep the existing desktop five-column product, quantity, unit price, subtotal, and delete row unchanged on its first line.
For an open-price product only, render a second line directly below that row and aligned to the first `Produto / serviço` column.
The second line contains a visible label `Nome / descrição do item`, an `Input`, and the existing custom-system helper or validation messages.
Give the input `aria-label={`Nome / descrição do item ${index + 1}`}`, `maxLength={140}`, and placeholder `Ex.: Módulo Vendas`.
Give the product select `aria-label={`Produto / serviço do item ${index + 1}`}` and the unit-price input `aria-label={`Valor unitário do item ${index + 1}`}` so rendered tests and keyboard users can address repeated rows without DOM-position assumptions.
Extend the local `NativeSelect` wrapper in the same file with an optional `aria-label` prop and forward it to the underlying `<select>` before applying that prop to the product selector.
Do not replace `NativeSelect` or change its other call sites.
The custom-label input must occupy the same width as the first desktop column and must not push the quantity, value, subtotal, or delete controls out of alignment.
Before a failed advance attempt, show the amber helper text `Sistema personalizado - informe um nome/descrição e o valor negociado` beneath the input.
After a failed advance attempt, replace the helper with one red message per missing value.
Use `Informe o nome ou a descrição deste item personalizado.` when `customLabel.trim()` is empty.
Use `Informe um valor negociado maior que zero.` when `parseCurrencyToCents(item.unitBrl) <= 0`.
If both values are missing, show both messages in that order.
Apply the existing error color family to the invalid input border and message text without altering the valid neutral field styling.
Once a value becomes valid, remove its corresponding error immediately while leaving any other row error visible.
Fixed-price rows render no custom-label input, no custom helper, and no custom validation message.

## Exact validation and navigation behavior

Add `const [showCustomItemErrors, setShowCustomItemErrors] = useState(false)`.
Derive each open-price row's two validity flags from the currently selected product, the trimmed label, and parsed unit cents.
Derive `customItemsValid` as true when every open-price row has a non-blank label and a unit price greater than zero.
Define `canAdvanceStepOne` as the existing `canSaveBasics && customItemsValid`.
Do not add custom-label validation to `canSaveBasics` because `Salvar incompleto` must remain available for a positive-total draft whose custom label is not entered yet.

When `advanceWizard` runs on step 1, set `showCustomItemErrors` to true first.
If `canAdvanceStepOne` is false, return without changing `wizardStep`.
If it is true, advance to step 2 exactly as today.
Use `canAdvanceStepOne` instead of `canSaveBasics` to disable direct clicks on step 2 or step 3 in the wizard step header, which prevents bypassing custom validation.
For the primary footer action on step 1, disable only when `saving` is true or the existing `canSave` prerequisites are false.
This preserves a clickable validation attempt when a selected open-price item is still zero-valued or unlabeled.
Keep the footer action behavior for steps 2 and 3 unchanged except for `saving`.

`submit('draft')` must continue using the existing `canSave` guard and footer `canSaveBasics` disabled state.
It must not require `customItemsValid`.
A draft with a positive overall total and an empty custom label must submit the catalog name through `saleItemDisplayName`.
Do not loosen the existing positive-overall-total prerequisite for saving an incomplete draft.
`submit('closed')` remains reachable only after step-one final validation succeeds.

## Exact review and persistence behavior

Replace the step-three `Produto(s)` expression with the ordered list from `items.map(saleItemDisplayName).join(', ')`.
For the SegPro example, review must show `Módulo Vendas, Módulo RH` in that order rather than `FXL Custom, FXL Custom`.
In `createPayload`, set each draft item's `productName` to `saleItemDisplayName(item)` and leave `productId`, `productType`, `quantity`, and `unitBrl` mapping unchanged.
The API and ledger must retain both repeated instances as distinct array entries even though their `productId` values match.
The database insertion order remains the request order and no deduplication is added.
Existing sale-list and dashboard consumers continue reading `productNameSnapshot`, so the first labeled custom item becomes the sale's primary displayed product and revenue grouping may show custom labels separately.
Do not change those consumers in this slice.

## API boundary and security contract

Change `SaleItemSchema.productName` from an unbounded minimum-length string to `z.string().trim().min(1).max(140)`.
The server must therefore reject whitespace-only names and names longer than 140 characters even if browser validation is bypassed.
Accented text such as `Módulo RH` and punctuation remain valid.
Keep `productId` as the existing optional UUID and do not derive, replace, or authorize a product by the submitted label.
Keep all existing tenant-scoped create behavior unchanged.
React text rendering must remain plain text with no HTML injection path, and the implementation must not use `dangerouslySetInnerHTML`.
Do not add logging of the label or sale payload because it may contain client-specific commercial information.

## RED 1 - API normalization and snapshot oracle

Extend `apps/api/src/domains/sales-ops/__tests__/service.test.ts` first.
Add the following exact test names.

```ts
it('preserves ordered custom labels as snapshots while retaining the shared product id', () => {});
it('rejects blank and overlong sale item names at the API boundary', () => {});
```

For the first test, parse one complete sale input through `CreateSaleSchema` with two items that use the same valid UUID.
Use `productName: '  Módulo Vendas  '` with `unitBrl: 400000` for the first item and `productName: 'Módulo RH'` with `unitBrl: 900000` for the second item.
Call `buildSaleLedger` with the parsed result.
Assert that `ledger.items` has length two and preserves the exact order, shared `productId`, trimmed snapshots `Módulo Vendas` and `Módulo RH`, unit values, and subtotals.
For the second test, take the same otherwise-valid payload and assert `CreateSaleSchema.safeParse` fails once with a whitespace-only `productName` and once with `'x'.repeat(141)`.

Run this exact command from the repository root.

```sh
pnpm --filter @fxl-sales/api test src/domains/sales-ops/__tests__/service.test.ts
```

RED must fail because the current API schema neither trims item names nor caps them at 140 characters.
Do not insert `--` before the test path because the package script would pass it through to Vitest and run every API test instead of the named oracle file.

## GREEN 1 - Harden the existing API seam

Implement only the `SaleItemSchema.productName` change described above.
Do not change `buildSaleLedger`, `createSale`, the Drizzle schema, or any migration because their existing mapping already preserves `productNameSnapshot`, `productId`, order, and cents correctly.
Run the RED 1 command again and require PASS.

## RED 2 - Rendered repeated-row and validation oracle

Create `apps/web/src/sales-ops/__tests__/sale-wizard-custom-item-labels.test.tsx` with `// @vitest-environment happy-dom`.
Follow the React `createRoot`, `act`, dialog mock, portal cleanup, and input-event patterns already used by `sale-wizard-commission-defaults.test.tsx`.
Build a complete `SalesOpsBootstrap` fixture whose first product is an active open-price product named `FXL Custom`, whose second product is an active fixed-price product named `FXL Finance`, and which includes one active client and one active seller.
Use the same valid custom product UUID in every repeated custom row.
Query repeated controls by the exact `aria-label` contract from this plan rather than array position or CSS class.

Add these exact test names.

```ts
it('keeps repeated custom labels independent and submits them in review order', async () => {});
it('blocks advancement until every custom row has a label and positive negotiated value', async () => {});
it('saves an unlabeled custom draft with the catalog name fallback', async () => {});
it('uses the catalog name for a fixed-price item without rendering a custom label field', async () => {});
it('keeps the surviving custom row values when another repeated row is deleted', async () => {});
```

For `keeps repeated custom labels independent and submits them in review order`, enter `Módulo Vendas` and `4000` in item 1, click `+ item`, enter `Módulo RH` and `9000` in item 2, and assert the two inputs retain their own values.
Click `Avançar` twice, assert step 3 visibly contains `Módulo Vendas, Módulo RH`, and click `Confirmar venda`.
Assert the newest `onSave` payload has status `closed`, exactly two ordered items, the same custom `productId` on both, product names `Módulo Vendas` and `Módulo RH`, and unit values `400000` and `900000`.

For `blocks advancement until every custom row has a label and positive negotiated value`, start with the initial empty custom row and click `Avançar`.
Assert `Registro da venda` remains the active content and both exact red messages render.
Enter only `Módulo Vendas` and assert the label error disappears while the price error remains.
Enter `4000` and click `+ item`, leave item 2 empty, click `Avançar`, and assert item 2 is identified while item 1 has no error.
Enter `Módulo RH` and `9000` in item 2, click `Avançar`, and assert `Custos e margem` renders.

For `saves an unlabeled custom draft with the catalog name fallback`, enter a positive `4000` unit value but leave the custom label empty.
Click `Salvar incompleto` and assert the payload status is `draft`, the product name is `FXL Custom`, the custom `productId` is retained, and the unit value is `400000`.

For `uses the catalog name for a fixed-price item without rendering a custom label field`, first enter `Rótulo que não pode vazar` in item 1 and then change item 1 to `FXL Finance`.
Assert no `Nome / descrição do item 1` input exists, click `Avançar` twice without entering another label, assert review shows `FXL Finance` and does not show the stale custom text, confirm the sale, and assert the payload uses the fixed product's catalog name and `productId`.

For `keeps the surviving custom row values when another repeated row is deleted`, populate two custom rows with distinct labels and prices, delete item 1 through an accessible delete control, and assert the surviving visible item 1 contains item 2's original label and price.
Give each row delete button `aria-label={`Remover item ${index + 1}`}` so this test and keyboard users do not depend on the trash icon or DOM position.

Run this exact command from the repository root.

```sh
pnpm --filter @fxl-sales/web test src/sales-ops/__tests__/sale-wizard-custom-item-labels.test.tsx
```

RED must fail because no custom-label control exists, review always uses the catalog product name, and the submitted payload cannot distinguish repeated custom rows.
Do not insert `--` before the test path because the package script would pass it through to Vitest and run every web test instead of the named oracle file.

## GREEN 2 - Wire labels through the wizard

Implement the transient state, product-change reset, `saleItemDisplayName`, open-price UI, validation state, navigation guards, review text, accessibility labels, and payload mapping exactly as specified above.
Do not move the logic into `calculations.ts` because it depends on the wizard's selected product lookup and no reusable domain abstraction is needed.
Do not modify the API client or shared request types because the wire shape remains unchanged.
Run the RED 2 command again and require PASS.
Run both focused oracle files together before refactoring.

```sh
pnpm --filter @fxl-sales/api test src/domains/sales-ops/__tests__/service.test.ts
pnpm --filter @fxl-sales/web test src/sales-ops/__tests__/sale-wizard-custom-item-labels.test.tsx
```

## Refactor checks

Keep `saleItemDisplayName` as the only chooser between a custom label and catalog name.
Keep validity derived from current state rather than storing a second error object that can become stale after add, delete, or product changes.
Do not deduplicate items by `productId` in state, review, payload construction, or the API.
Do not mutate an existing `SaleItemForm` object in place.
Confirm deleting the first of two repeated custom rows leaves the second row's label and price intact at its new visible index.
Confirm switching an entered custom row to a fixed product clears its custom label and submits only the fixed catalog name.
Run `git diff --check` before implementation handoff.

## Browser E2E and pixel QA contract

Use the in-app browser with an authenticated local team account and a catalog containing active `FXL Custom` as an open-price product plus one fixed-price product.
Open `/operacional/vendas`, open `Fechamento da venda`, and perform this check at a 1440 by 900 viewport.
Capture a screenshot of step 1 with two FXL Custom rows after entering `Módulo Vendas` at `4.000,00` and `Módulo RH` at `9.000,00`.
Require the product selectors, quantity, unit-price, and subtotal columns, and delete controls to remain vertically aligned across rows.
Require each label input to align exactly with the product column, with no overlap, clipped text, horizontal page scroll, or collision with the warning, subtotal, or delete button.
Require the modal footer to remain reachable through the dialog's own scroll area.

Attempt to advance with a third blank custom row.
Require the dialog to remain on step 1, require both red messages to appear next to that row, and require existing valid rows to remain visually neutral.
Fill the third row, advance to review, and capture a screenshot showing all three names in their entered order with readable wrapping inside the `Produto(s)` value area.
Confirm the review names do not alter totals, installment values, commission values, or margin.

Save the SegPro-style two-item sale through the real API, wait for bootstrap invalidation, and verify the sales table displays `Módulo Vendas` as the primary item rather than `FXL Custom`.
Refresh `/operacional/vendas` and require that primary label to remain visible, proving the displayed value came back from `productNameSnapshot`.
Create or inspect the network response only as supplemental evidence, not as a substitute for the user-visible refresh check.

Repeat the item-row visual check at a 1024 by 768 viewport.
Require the five existing columns and the new label field to fit inside the dialog without clipping or covering the fixed footer.
This slice does not redesign the wizard's existing sub-1024 mobile table layout.
If authentication, seed data, or a local API prevents the browser flow, record the exact blocker in the run audit and do not claim browser E2E PASS from component tests alone.
Stop the web server, API server, and their complete process groups after browser verification.

## Edge cases

- Repeated custom rows with the same `productId` remain separate and retain array order.
- Duplicate labels are allowed.
- Whitespace surrounding a valid label is removed before submission and again at the API trust boundary.
- A whitespace-only label blocks completed-sale advancement and cannot pass the API schema.
- A label longer than 140 characters is prevented by the browser and rejected by the API.
- Unicode, accents, spaces, hyphens, slashes, and ordinary punctuation are valid label content.
- A custom unit value of zero, empty text, or an unparsable value blocks completed-sale advancement for that row.
- A positive total from another row does not make a zero-valued custom row valid for completion.
- `Salvar incompleto` may fall back to the custom catalog name when the label is absent, but it retains all existing draft prerequisites.
- Switching any row to a fixed product removes custom-label requirements and prevents stale label submission.
- Switching from one product to another clears the row label even when both products are open-price.
- Deleting one repeated row removes only that row's label and price state.
- Removing all items keeps the wizard unsaveable and must not throw.
- Labels change snapshot display and dashboard grouping only through existing `productNameSnapshot` consumers and do not affect money calculations.
- Historical sale-item snapshots remain unchanged.

## Separate Gate 2 verification

The implementer runs the focused RED and GREEN commands plus `git diff --check` before handoff.
A different Verify agent must run each command below once from the repository root without watch mode.

```sh
pnpm --filter @fxl-sales/api test src/domains/sales-ops/__tests__/service.test.ts
pnpm --filter @fxl-sales/web test src/sales-ops/__tests__/sale-wizard-custom-item-labels.test.tsx
CI=true pnpm test
pnpm lint
pnpm type-check
pnpm build
pnpm audit --audit-level high
git diff --check
```

The Verify agent must also inspect the diff and confirm there is no migration, no new persistence column, no request-shape change, no item deduplication, and no unsafe HTML rendering.
The browser E2E and pixel QA contract must pass separately or leave a concrete Autopilot audit entry.

## Done contract

The named API test proves two ordered labels become two ordered product-name snapshots with the same original product identifier and proves the item-name boundary rejects blank or overlong input.
The named rendered tests prove independent repeated-row state, per-row final validation, draft fallback, fixed-product behavior, ordered review text, and submitted request values.
All repository verification commands pass under the separate Verify agent.
The authenticated browser audit proves the labels survive a real save and refresh and that the changed item layout matches the required visual contract.
