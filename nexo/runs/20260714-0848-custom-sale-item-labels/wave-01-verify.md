# Wave 01 Independent Verification

Verdict: **PASS**.

The integrated `master` commit `33df3650af672924a413bc097be158687f2b0460` satisfies the custom sale item labels contract against baseline `e064fc52e30f361fdc1fb6472bb7d1496ae248e4`.
This verifier did not implement the slice and did not read executor reports or the context pack.

## Repository state

- Branch: `master`.
- Verified head: `33df3650af672924a413bc097be158687f2b0460`.
- Merge parents: `e064fc52e30f361fdc1fb6472bb7d1496ae248e4` and `b24e33ef10011bf9c67658ffd4077e207b76521a`.
- Verification started at `2026-07-14T09:18:57-03:00`.
- Verification ended at `2026-07-14T09:23:34-03:00`.

The pre-verification worktree contained untracked `.vscode/`, Nexo plan, doubt, and run artifacts.
No tracked source change was present outside the verified merge.

## Machine gates

| Command | Result | Evidence |
| --- | --- | --- |
| `CI=true pnpm test` | PASS | Exit 0 with 33 test files and 327 tests passing: shared utilities 17, API 164, and web 146. |
| `pnpm --filter @fxl-sales/api test:integration` | PASS | Exit 0 with 8 integration files and 27 tests passing in 147.98 seconds, including cross-tenant RLS suites. |
| `pnpm lint` | PASS | Exit 0 for API and web ESLint tasks. |
| `pnpm type-check` | PASS | Exit 0 for all four workspace projects. |
| `pnpm build` | PASS | Exit 0 for shared packages, API TypeScript build, and web production Vite build. |
| `pnpm audit --audit-level high` | PASS | Exit 0 with `No known vulnerabilities found`. |
| `git diff --check e064fc5..HEAD` | PASS | Exit 0 with no whitespace errors. |

No command was rerun and no command was executed in watch mode.

## Diff scope and integrity

`git diff --stat e064fc5..HEAD` reports exactly four files, 505 insertions, and 11 deletions.

- `apps/api/src/domains/sales-ops/__tests__/service.test.ts` adds 98 lines.
- `apps/api/src/domains/sales-ops/service.ts` changes one validation line.
- `apps/web/src/sales-ops/SalesOpsApp.tsx` adds 87 lines and removes 10 lines.
- `apps/web/src/sales-ops/__tests__/sale-wizard-custom-item-labels.test.tsx` is a new 319-line test file.

There are no changes outside the four planned code and test files.
There are no schema, migration, generated, distribution, lockfile, or changelog edits.
The existing tests were not weakened or removed.
The changed test files contain no focused, skipped, or todo tests.

The diff introduces no unsafe HTML path such as `dangerouslySetInnerHTML`, `innerHTML`, dynamic evaluation, or raw HTML rendering.
Custom labels remain ordinary React text and are escaped by React.
The diff contains no credentials, tokens, API keys, environment values, or other secrets.

The API route still parses `POST /sales` with `CreateSaleSchema` before calling `createSale` with the authenticated `orgId`.
The persistence path still runs inside `withTenant`, scopes product lookup by `orgId`, writes `orgId` to every item, and preserves the existing RLS and tenant boundaries.
No authorization, authentication, RLS, or tenant-selection code changed.

## Behavior contract

### Independent repeated custom items

Each sale item owns its own `customLabel`, `quantity`, and `unitBrl` state.
Adding a repeated custom product appends a distinct state object.
Payload construction maps the item array without grouping or deduplicating it.
Ledger construction also maps every item without grouping or deduplicating it.
The bulk database insert receives the full mapped ledger array.

The web regression test enters `Módulo Vendas` at R$ 4,000 and `Módulo RH` at R$ 9,000 for two rows sharing the same custom product.
It proves that both rows retain independent labels, quantities, values, and payload entries.

### Product identity, review order, and snapshots

Payload construction retains the selected catalog product ID for every repeated row.
The web test proves that both custom entries retain the same original `productId` while carrying different labels and prices.
The review renders `items.map(saleItemDisplayName).join(', ')`, which preserves the row order.
The API ledger maps items in input order and snapshots each trimmed `productName`, original `productId`, quantity, unit price, and subtotal.
The API test proves the ordered `Módulo Vendas`, then `Módulo RH` snapshot array with the shared product ID retained on both entries.

### Per-row closed-sale validation

Step-one validation checks every open-price row independently.
Each custom row must have a nonblank trimmed label and a negotiated value greater than zero before advancement.
After an advance attempt, each invalid row receives its own label and value message and its own `aria-invalid` state.
The regression test proves that a valid first row remains valid while a newly added second row is independently rejected until both of its fields are corrected.

### Draft fallback

Draft submission remains available with the existing basic sale requirements.
For an unlabeled custom draft, `saleItemDisplayName` falls back to the custom product's catalog name.
The regression test proves an unlabeled custom draft submits `FXL Custom`, retains the original product ID, and keeps the negotiated value.

### Fixed-price products and stale labels

Fixed-price rows do not render the custom label field and always use the catalog product name.
Changing `productId` to a different product explicitly clears `customLabel` and resets the unit value from the selected catalog product.
The regression test seeds a custom label, switches to the fixed `FXL Finance` product, and proves that the stale custom label is absent from review and the submitted payload.

### Deletion state and control names

Deletion filters only the selected row from the item array.
The regression test proves that deleting the first repeated row preserves the second row's custom label and negotiated value.
The surviving row is renumbered consistently and no stale second-row label control remains.

Every repeated interactive item control has an index-specific accessible name.
This includes product selection, quantity, unit value, removal, and the custom label field.
The names remain unique after addition and deletion because they are derived from the current row order.

### API normalization and limits

`SaleItemSchema.productName` now applies `trim()`, requires at least one character, and limits the normalized value to 140 characters.
The API regression proves surrounding whitespace is removed before snapshot creation.
It also proves whitespace-only names and 141-character names are rejected at the API boundary.
The UI additionally applies `maxLength={140}` to the custom label input.

### Migration contract

The existing sale item snapshot columns already hold the custom label and original product ID.
No schema or data migration is required or included.

## Process cleanup

All verifier commands completed and their sessions exited.
No test runner, compiler, build, audit, or other persistent process started by this verifier remains.
Process inspection found existing `fxl-sales` API and web development watchers whose elapsed times predate this verification by about one hour.
Those pre-existing process groups were not started, altered, or terminated by this verifier.

## Final verdict

PASS.
All mandated machine gates are green, the diff is limited to the planned files, the behavior contract is covered by implementation and passing regression tests, security and tenant boundaries remain intact, and no migration is present.
