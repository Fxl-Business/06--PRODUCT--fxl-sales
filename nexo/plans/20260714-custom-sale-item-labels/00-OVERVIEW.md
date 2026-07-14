---
id: 20260714-custom-sale-item-labels
milestone: null
status: complete
mode: autopilot
---

# Custom sale item labels

## Frame

An operator must be able to add the same custom product to one sale multiple times and give every line its own meaningful name or short description.
The motivating example is a SegPro sale containing `Módulo Vendas` for R$ 4.000,00 and `Módulo RH` for R$ 9.000,00 as separate FXL Custom items.

## Why

The current sale wizard stores every custom line with the catalog name `FXL Custom`.
Even when the prices differ, operators cannot identify which module or negotiated deliverable each line represents during review or after the sale is persisted.

## Acceptance criteria

1. Given an open-price product is selected in the sale wizard, when the item row renders, then it exposes a per-item name or description input.
2. Given the same open-price product is added more than once, when distinct labels and prices are entered, then each row retains its own values and order.
3. Given an open-price item has no non-blank label or no positive negotiated value, when the operator tries to advance toward a completed sale, then the wizard remains on the item step and identifies the missing custom-item information.
4. Given an incomplete draft is saved before a custom label is entered, when its payload is built, then it remains valid by falling back to the catalog product name.
5. Given a labeled custom item is reviewed and submitted, when the payload and persisted snapshot are read, then the custom label is used as `productNameSnapshot` while the original custom `productId` remains attached.
6. Given a fixed-price catalog product is selected, when the item row, review, and payload render, then the catalog product name is used and no custom-label input is required.

## Scope limits

This feature changes new-sale item entry, validation, review, and the submitted product-name snapshot.
It reuses the existing `productNameSnapshot` field and does not add or apply a database migration.
It does not add long-form rich text, edit historical sales, create a reusable product for every module, or change commission and payment calculations.
It does not release or promote any commit beyond `master` under Autopilot.

## Design decision

The selected design treats a custom line label as the display name of that sold item and stores it in the existing immutable product-name snapshot.
The catalog `productId` remains unchanged, so reporting can still identify the originating FXL Custom product while user-facing sale details can distinguish each module.
This approach is backward-compatible because existing rows already contain `FXL Custom` in the snapshot and need no migration.

Adding a separate sale-item description column was rejected because it would require a database migration and would leave existing screens and summaries choosing between two competing display fields.
Creating one catalog product per negotiated module was rejected because these labels belong to a particular sale and should not pollute the reusable product catalog.

## Slice index

| Slice | Intent | Dependency |
| --- | --- | --- |
| `01-custom-sale-item-labels` | Capture, validate, review, submit, and verify independent labels for open-price sale items. | None |

## Gate 1

Skipped by the user's explicit Autopilot instruction on 2026-07-14.
