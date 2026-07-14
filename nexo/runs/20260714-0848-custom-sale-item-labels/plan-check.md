# Plan check: Custom sale item labels

## Verdict

PASS after bounded plan corrections.

The revised plan is executable and covers the user's migration-free custom sale-item naming goal without changing the wire shape or the current incomplete-draft prerequisites.

## Evidence reviewed

- `SaleWizardDialogBody` currently stores one object per sale row, preserves array order, builds `SaleDraft.items[].productName` from the selected catalog product, gates `Salvar incompleto` with `canSaveBasics`, and guards submission with `canSave`.
- `buildSalePayload` already trims `SaleDraft.items[].productName` without changing the request field.
- `CreateSaleSchema` already accepts `items[].productName`, and `buildSaleLedger` maps it directly to `productNameSnapshot` while retaining `productId`, request order, quantities, and cents.
- `createSale` already inserts the mapped ledger items without deduplication, so no schema or data migration is required.
- Fixed-price products and existing snapshots remain compatible because the revised chooser falls back to the selected catalog name.
- The four declared `files_modified` paths are canonical, repo-relative, complete for the planned source and test changes, and non-overlapping concerns do not apply because this plan-set has one slice.
- `depends_on: []` is correct, and the Nexo wave helper resolves the plan to `wave 1: 01-custom-sale-item-labels` without a cycle.
- The root scripts support `test`, `lint`, `type-check`, and `build`, and both package scripts use run-once `vitest run`.
- `pnpm audit --audit-level high` is a valid root security command for this workspace.
- The browser contract covers authenticated real-API save and refresh, 1440 by 900 and 1024 by 768 pixel checks, dialog scrolling, validation states, review ordering, persisted primary snapshot display, and mandatory audit recording when local infrastructure blocks the flow.

## Defects found and corrected

### Focused test commands were not focused

The original commands inserted `--` before the Vitest path.
An observed baseline run of `pnpm --filter @fxl-sales/api test -- src/domains/sales-ops/__tests__/service.test.ts` executed all 19 API test files, so it was not a realistic per-slice oracle command.
The plan now uses `pnpm --filter <package> test <path>` for both focused files.
Baseline execution confirmed that this corrected form runs exactly the requested API file and exactly the requested existing web file.

### The accessible product-select contract was not implementable as written

The local `NativeSelect` wrapper does not currently accept or forward an accessible-name prop.
The plan now instructs the executor to add and forward an optional `aria-label` in the same already-declared source file before applying the row-specific product label.

### Two state-integrity requirements lacked locked oracles

The fixed-price test previously switched products before entering a custom label, so it could not detect stale custom-label leakage.
The revised test enters stale text first and proves that review and submission use only the fixed catalog name after the switch.
The plan also named deletion behavior as required but left it as an informal refactor confirmation.
The revised plan adds an accessible delete-button contract and a rendered test that proves deleting one repeated row preserves the surviving row's original label and price.

### The desktop pixel-QA wording miscounted columns

The current row has product, quantity, unit price, subtotal, and delete columns, not four numeric columns.
The revised browser contract names the actual columns and delete controls so the visual verdict is objective.

## Acceptance and execution assessment

The overview acceptance covers open-price-only input visibility, repeated independent values and order, per-row completed-sale validation, incomplete-draft fallback, snapshot persistence with the original product identifier, and unchanged fixed-price behavior.
The slice turns those outcomes into named API and rendered UI tests, followed by Green steps that change only the existing schema seam and wizard seam.
The Red phases fail for the intended missing behavior, the Green phases are limited to the corresponding production changes, and refactoring is explicitly deferred until both focused oracles pass.
The separate Gate 2 contract includes the focused oracles, full run-once test suite, lint, type-check, build, high-severity dependency audit, diff whitespace check, source inspection, and separate browser evidence.

## Non-blocking observations

The focused package command syntax is intentionally different from the full repository command `CI=true pnpm test`, which remains correct for wave verification.
The authenticated browser flow may depend on local credentials and seed data, but the plan treats that as auditable infrastructure evidence instead of allowing component tests to masquerade as browser E2E coverage.
The current sales table exposes only the first persisted sale item as the primary product, while both ordered labels remain persisted in `productNameSnapshot`; the plan states this existing consumer behavior explicitly and does not silently expand the feature into a sale-details redesign.
