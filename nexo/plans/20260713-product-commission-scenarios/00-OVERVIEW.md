---
id: 20260713-product-commission-scenarios
milestone: null
status: complete
mode: autopilot
---

# Product commission scenarios

## Frame

An operator must be able to configure two seller commission outcomes on the same product.
A sale without a finder uses the seller-only commission, while a sale with a finder uses a separate seller commission plus the finder commission.
The motivating example is `10%` for seller-only sales and `7% + 3%` for sales with a finder.

## Why

The current product form shows two commission tabs but stores only one seller commission value.
Changing that value in either tab overwrites the value shown in the other tab, so the two business scenarios cannot coexist.

## Acceptance criteria

1. Given an operator configures a product with a `10%` seller-only commission and a `7% + 3%` seller-plus-finder split, when the product is saved and reopened, then both configurations retain their independent values.
2. Given the operator switches between `Somente vendedor` and `Vendedor + Finder`, when either scenario is edited, then the other scenario remains unchanged.
3. Given an existing product is migrated, when it is read after the additive schema change, then its current seller and finder values remain valid and no existing commission configuration is silently reduced.
4. Given a product commission payload is created or updated, when a negative value or an unsupported commission type is supplied, then the API rejects the payload.
5. Given the product list is shown, when a product has both scenarios configured, then the table communicates the seller-only value separately from the seller-plus-finder split.
6. Given a sale uses a product and the operator adds or removes a finder, when commission defaults are resolved from that product, then the seller rate changes between the saved seller-only and seller-with-finder values while the saved finder rate is used only for the finder scenario.

## Scope limits

This feature changes product commission configuration and the product-derived defaults used by the current sale wizard.
It does not change organization-level fallback settings, historical sale snapshots, payout state machines, provider commissions, or recurring commission rules.
The first product item remains the source for sale-level defaults, matching the existing primary-product behavior used for the sale code and recurring summary.
Percentage configurations are the acceptance oracle shown in the request.
Existing fixed-value controls must continue to persist without regression, but expanding sale-ledger storage to a new fixed-commission snapshot model is outside this slice set.
No production database migration or release promotion runs under autopilot.

## Design decision

The selected design keeps the existing `sellerCommissionType` and `sellerCommissionValue` as the seller-only configuration.
It adds explicit `sellerWithFinderCommissionType` and `sellerWithFinderCommissionValue` fields for the split scenario.
The existing `finderCommissionType` and `finderCommissionValue` remain the finder side of the split.
The form tabs become editor views over persistent fields instead of mutating whether a finder configuration exists.

Two alternatives were rejected.
A JSON commission-policy column would weaken schema validation and make querying and migration less transparent.
A child commission-rules table would add unnecessary joins and lifecycle complexity for exactly two stable scenarios.

## Slice index

| Slice | Intent | Dependency |
| --- | --- | --- |
| `01-product-commission-contract` | Add the persisted seller-with-finder fields, validation, and backward-compatible API contract. | None |
| `02-product-commission-editor` | Make both form modes independently editable and visible in the product list. | `01-product-commission-contract` |
| `03-product-aware-sale-defaults` | Resolve percentage commission defaults from the primary product when finder participation changes. | `01-product-commission-contract`, `02-product-commission-editor` |

## Gate 1

Skipped by the user's explicit mid-flow Autopilot instruction on 2026-07-13.
Independent plan-check passed after one bounded correction pass.
Derived waves are sequential: `01`, then `02`, then `03`.
