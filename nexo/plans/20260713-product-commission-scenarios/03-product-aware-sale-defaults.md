---
id: 03-product-aware-sale-defaults
milestone: null
status: done
depends_on: [01-product-commission-contract, 02-product-commission-editor]
files_modified: [apps/web/src/sales-ops/calculations.ts, apps/web/src/sales-ops/SalesOpsApp.tsx, apps/web/src/sales-ops/__tests__/calculations.test.ts, apps/web/src/sales-ops/__tests__/sale-wizard-commission-defaults.test.tsx]
acceptance: "Given a sale's primary product and finder participation, when commission defaults are resolved, then a seller-only sale uses the product seller-only percentage, a sale with a finder uses the product seller-with-finder and finder percentages, and unsupported fixed product rates fall back to organization percentages."
---

# Slice 03 - Product-aware sale defaults

## Goal

Make the current sale wizard default its percentage commission snapshot from the first sale item.
A sale without a finder uses the product's seller-only percentage.
A sale with a finder uses the product's seller-with-finder percentage plus the product's finder percentage.
Changing the primary product or finder participation recomputes the defaults immediately.

## Upstream contract

Slice 01 adds `sellerWithFinderCommissionType: CommissionType` and `sellerWithFinderCommissionValue: string` to `SalesOpsProduct`.
Slice 02 makes those fields independently editable and returns them in the sales bootstrap product list.
Keep `sellerCommissionType` and `sellerCommissionValue` as the seller-only source.
Keep `finderCommissionType` and `finderCommissionValue` as the finder side of the split.

## Scope

This slice changes only browser-side default resolution and the existing percentage sale payload.
The first item in `items` is the primary product, matching the existing sale-code and recurring-summary rule.
Organization `defaultSellerCommissionPct` and `defaultFinderCommissionPct` remain the fallback.
Do not change API sale schemas, ledger columns, payables, historical sale snapshots, product persistence, or database migrations.
Do not convert a product `fix` amount into a percentage.
If a required product side is `fix`, use the corresponding organization percentage because fixed-amount sale snapshot semantics are outside this feature.

## File map

- `apps/web/src/sales-ops/calculations.ts` owns the pure commission-default resolver.
- `apps/web/src/sales-ops/__tests__/calculations.test.ts` locks product, organization-fallback, fixed-type, and zero-value behavior.
- `apps/web/src/sales-ops/SalesOpsApp.tsx` initializes and resynchronizes the wizard percentage fields from the resolver.
- `apps/web/src/sales-ops/__tests__/sale-wizard-commission-defaults.test.tsx` exercises the rendered wizard through product and finder controls and asserts the submitted snapshot.

## Exact interface

Add these exports to `calculations.ts`.

```ts
export type SaleCommissionDefaultsProduct = Pick<
  SalesOpsProduct,
  | 'sellerCommissionType'
  | 'sellerCommissionValue'
  | 'sellerWithFinderCommissionType'
  | 'sellerWithFinderCommissionValue'
  | 'finderCommissionType'
  | 'finderCommissionValue'
>;

export type SaleCommissionDefaults = {
  sellerCommissionPct: number;
  finderCommissionPct: number;
};

export function resolveSaleCommissionDefaults(
  product: SaleCommissionDefaultsProduct | undefined,
  hasFinder: boolean,
  settings: Pick<
    SalesOpsSettings,
    'defaultSellerCommissionPct' | 'defaultFinderCommissionPct'
  > | null,
): SaleCommissionDefaults;
```

The resolver returns finite numbers suitable for the existing `SaleDraft.sellerCommissionPct` and `SaleDraft.finderCommissionPct` fields.
The resolver must preserve a valid percentage value of `0` and must not use truthiness for fallback.

## RED 1 - Pure resolution contract

Extend `calculations.test.ts` with a small `SaleCommissionDefaultsProduct` fixture containing `10%` seller-only, `7%` seller-with-finder, and `3%` finder values.
Use organization settings containing seller `9%` and finder `2%`.

Add these exact test names.

```ts
it('resolves seller-only product percentage without applying the product finder rate', () => {
  expect(resolveSaleCommissionDefaults(product, false, organizationDefaults)).toEqual({
    sellerCommissionPct: 10,
    finderCommissionPct: 2,
  });
});

it('resolves seller-with-finder and finder percentages when a finder participates', () => {
  expect(resolveSaleCommissionDefaults(product, true, organizationDefaults)).toEqual({
    sellerCommissionPct: 7,
    finderCommissionPct: 3,
  });
});

it('falls back per side for missing products and fixed product commissions', () => {
  expect(resolveSaleCommissionDefaults(undefined, true, organizationDefaults)).toEqual({
    sellerCommissionPct: 9,
    finderCommissionPct: 2,
  });
  expect(
    resolveSaleCommissionDefaults(
      {
        ...product,
        sellerCommissionType: 'fix',
        sellerWithFinderCommissionType: 'fix',
        finderCommissionType: 'fix',
      },
      true,
      organizationDefaults,
    ),
  ).toEqual({ sellerCommissionPct: 9, finderCommissionPct: 2 });
  expect(
    resolveSaleCommissionDefaults(
      { ...product, sellerWithFinderCommissionType: 'fix' },
      true,
      organizationDefaults,
    ),
  ).toEqual({ sellerCommissionPct: 9, finderCommissionPct: 3 });
  expect(resolveSaleCommissionDefaults({ ...product, sellerCommissionValue: '0' }, false, null)).toEqual({
    sellerCommissionPct: 0,
    finderCommissionPct: 3,
  });
});
```

Run `pnpm --filter @fxl-sales/web test -- src/sales-ops/__tests__/calculations.test.ts`.
The RED result must fail because `resolveSaleCommissionDefaults` and its source type do not exist.

## GREEN 1 - Minimal resolver

Import `CommissionType`, `SalesOpsProduct`, and `SalesOpsSettings` as types in `calculations.ts`.
Implement one private selector with this exact behavior.

```ts
function percentageOrFallback(
  type: CommissionType | undefined,
  value: string | number | undefined,
  fallback: number,
): number {
  return type === 'pct' ? toNumber(value, fallback) : fallback;
}
```

Inside `resolveSaleCommissionDefaults`, parse organization defaults with the existing `toNumber` helper and hard fallbacks `10` and `3`.
When `hasFinder` is false, resolve the seller from `sellerCommissionType` and `sellerCommissionValue`, and return the organization finder default without reading the product finder fields.
When `hasFinder` is true, resolve the seller from `sellerWithFinderCommissionType` and `sellerWithFinderCommissionValue`, and resolve the finder independently from `finderCommissionType` and `finderCommissionValue`.
Run the RED 1 command again and require PASS.

## RED 2 - Rendered wizard behavior

Create `sale-wizard-commission-defaults.test.tsx` with `// @vitest-environment happy-dom`.
Render the exported `SaleWizardDialog` with `createRoot` and React `act`, following the cleanup pattern in `apps/web/src/auth/__tests__/react.test.tsx`.
Use a complete `SalesOpsBootstrap` fixture with one active seller, one active finder, one client, empty sales/payables/items, organization defaults `9%` and `2%`, and these two active products.

- Product A has seller-only `10%`, seller-with-finder `7%`, finder `3%`, and a nonzero setup price.
- Product B has seller-only `12%`, seller-with-finder `8%`, finder `4%`, and a nonzero setup price.

Add helpers named `buttonByText`, `fieldInput`, `productSelects`, `click`, `changeSelect`, and `flushReact`.
`fieldInput` must find the existing `Field` label by the exact visible text and return its descendant input.
`productSelects` must identify item selects by requiring both Product A and Product B in their option text, avoiding reliance on select position among seller and finder controls.
Always unmount the root and remove portal content in `afterEach`.

Add these exact test names and sequences.

### `starts with seller-only defaults and switches snapshots when finder participation changes`

1. Render the dialog and click `Avançar` to reach step 2.
2. Assert `Comissão vendedor %` is `10` and `Comissão finder %` is the organization fallback `2`.
3. Click `Voltar`, click `Essa venda teve um finder`, flush React effects, and click `Avançar`.
4. Assert the two inputs are `7` and `3`.
5. Click `Salvar incompleto` and assert `onSave` receives `sellerCommissionPct: 7`, `finderCommissionPct: 3`, and a defined `finderPersonId`.
6. Click `Voltar`, click `remover`, flush effects, and click `Avançar`.
7. Assert the inputs return to `10` and `2`.
8. Click `Salvar incompleto` and assert the newest payload contains `sellerCommissionPct: 10` and no `finderPersonId`.

### `uses only the primary item when product selection changes`

1. Render, reveal a finder, and click `+ item` so both item selects initially point to Product A.
2. Change only the second item to Product B and flush effects.
3. Click `Avançar` and assert the split remains Product A's `7` and `3`.
4. Click `Voltar`, change the first item to Product B, flush effects, and click `Avançar`.
5. Assert the split changes to Product B's `8` and `4`.

Run `pnpm --filter @fxl-sales/web test -- src/sales-ops/__tests__/sale-wizard-commission-defaults.test.tsx`.
The RED result must fail because the wizard still initializes both commission fields only from organization settings and does not recompute them from product or finder state.

## GREEN 2 - Wire the wizard

Import `useEffect` from React and `resolveSaleCommissionDefaults` from `calculations.ts`.
Before the commission state hooks, compute initial defaults from `firstProduct`, `false`, and `bootstrap.settings`.
Initialize `sellerCommissionPct` and `finderCommissionPct` from those resolved numbers instead of directly from active organization settings.
Keep both fields as strings because the inputs and existing payload builder already accept strings.

After `items`, `finderVisible`, and `sellerIsFinder` state exist, derive the primary product exclusively from `items[0]?.productId` and `bootstrap.products`.
Derive finder participation with the existing rule `finderVisible && (sellerIsFinder || Boolean(finderPersonId))`.
Add one `useEffect` that calls `resolveSaleCommissionDefaults(primaryItemProduct, hasFinderForSale, bootstrap.settings)` and writes both returned values to the commission string states.
Use exactly `primaryItemProduct`, `hasFinderForSale`, and `bootstrap.settings` as effect dependencies so manual input edits remain intact until the product, finder participation, product record, or settings record changes.
Reuse the same `primaryItemProduct` and `hasFinderForSale` variables for recurring summary, margin, finder payable visibility, and payload construction instead of duplicating participation logic.
Do not derive defaults from secondary items.
Do not alter `buildSalePayload`, `CreateSalePayload`, or API sale creation.

Run the RED 2 command and require PASS.
Then run both oracle files together with `pnpm --filter @fxl-sales/web test -- src/sales-ops/__tests__/calculations.test.ts src/sales-ops/__tests__/sale-wizard-commission-defaults.test.tsx`.

## Refactor checks

Keep the resolver pure and independent of React.
Avoid event-handler-specific commission resets because they miss primary-item removal and future finder controls.
Do not reset manually edited percentages on unrelated changes such as quantity, price, payment, seller, tax, or a secondary item.
Run `pnpm --filter @fxl-sales/web type-check`.
Run `pnpm --filter @fxl-sales/web lint`.

## Browser E2E behavior

Use an authenticated local organization with a saved Product A configuration of `10%` seller-only and `7% + 3%` with finder.
Open `Fechamento da venda` and keep Product A as the first item.
Advance to `Custos e margem` without a finder and verify the seller input and live seller payable preview use `10%` while no finder payable is shown.
Return to step 1, reveal and select a finder, advance again, and verify seller `7%`, finder `3%`, both live payable previews, and the recalculated margin.
Return, remove the finder, and verify the seller returns to `10%` and the finder payable disappears.
Select a differently configured product as the first item and verify its rates replace Product A's rates.
Add or edit a secondary item and verify it does not change the commission defaults.
Save one finder sale and one seller-only sale, then verify their submitted sale rows show the expected seller and finder commission amounts.
Stop the dev server and its whole process group after the browser check.

## Edge cases and non-goals

- A missing primary product falls back to organization `9%` and `2%` values, or hard defaults `10%` and `3%` when settings are absent.
- A valid product percentage of zero remains zero.
- Each split side falls back independently when that side is fixed, so a percentage seller side can still coexist with a fixed finder side without coercion.
- Removing the first item makes the next item primary and triggers recomputation.
- Removing all items leaves the wizard unsaveable and must not throw.
- Toggling `Vendedor é o finder desta venda` counts as finder participation whenever the seller is assigned as finder.
- Changing which person is the finder without changing participation does not reset manual percentage edits.
- Fixed product configuration persistence remains owned by slices 01 and 02.
- Creating fixed-amount sale ledger snapshots is explicitly out of scope.

## Done contract

The named calculation tests and rendered wizard tests are the slice oracles.
The web typecheck and lint must pass.
The browser flow must visibly demonstrate `10%` without a finder and `7% + 3%` with a finder from the same primary product.
