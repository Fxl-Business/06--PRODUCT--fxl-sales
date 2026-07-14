# Custom Sale Labels Use Product Name Snapshots

## Context

Open-price catalog products can appear more than once in a sale, but the repeated lines need sale-specific display names without losing their shared catalog identity.
Sale items already persist both `productId` and an immutable `productNameSnapshot` populated from the request's `items[].productName` value.

## Decision

Treat each open-price line label as that sold item's display name and send it through the existing `items[].productName` field into `productNameSnapshot`.
Keep the original `productId`, ordered item mapping, and catalog-name fallback for incomplete drafts and fixed-price products.

## Consequences

- Repeated custom lines can have independent user-facing names while reporting can still identify their shared catalog product.
- Existing sale and bootstrap consumers continue reading one authoritative display field.
- Existing rows remain valid and no schema migration, data backfill, or new request field is required.
- Sale-specific labels do not create disposable catalog products or overload sale notes.
