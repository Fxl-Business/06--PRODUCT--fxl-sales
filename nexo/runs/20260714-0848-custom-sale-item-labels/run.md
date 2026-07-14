# Run: Custom sale item labels

- Flow: `feature`
- Mode: `autopilot`
- Started: `2026-07-14T08:48:31-03:00`
- Ended: `2026-07-14T12:31:03Z`
- Feature plan: `nexo/plans/20260714-custom-sale-item-labels/`
- Current beat: `capture`
- Status: `completed`

## Frame

Allow multiple lines of the same custom product in one sale to carry independent names such as `Módulo Vendas` and `Módulo RH`.
Persist the line label through the existing product-name snapshot without a schema migration.

## Slice log

- Gate 1 was skipped by the user's explicit Autopilot instruction.
- The repository context pack was generated at `nexo/runs/20260714-0848-custom-sale-item-labels/context-pack.md`.
- Plan-check passed after focused test commands, select accessibility wiring, missing state oracles, and pixel-QA wording were corrected.
- Execute established RED with 2 of 4 API tests failing and all 5 rendered web tests failing before implementation.
- Execute reached GREEN with 4 of 4 focused API tests and 5 of 5 focused rendered web tests passing in commit `0d8b17bbdf714b8ba67288e13d5553de4a815c82`.
- Initial Gate 2 returned FAIL even though every requested command passed because repeated quantity spinbuttons had no accessible names.
- Accessibility repair retry added index-specific `Quantidade do item N` names and focused RED-GREEN coverage in commit `b24e33ef10011bf9c67658ffd4077e207b76521a`.
- Final focused Gate 2 returned PASS with 4 API tests and 5 rendered web tests passing, plus API and web lint, type-check, and diff checks passing.
- The verified slice merged to `master` as `33df3650af672924a413bc097be158687f2b0460` against baseline `e064fc52e30f361fdc1fb6472bb7d1496ae248e4`.
- Wave 01 verification returned PASS with 33 unit test files and 327 tests passing, 8 integration files and 27 tests passing, plus workspace lint, type-check, build, high-severity dependency audit, and diff checks passing.
- Feature-boundary mutation verification returned PASS after both targeted mutants were killed and the restored focused suites passed with 5 web tests and 4 API tests.
- Authenticated browser E2E and pixel QA could not run because browser runtime discovery found no available browser backend.
- Automated rendered tests passed, but authenticated pixel QA and real save-refresh persistence proof remain recorded in `AUDIT.md`.

## Outcome

Open-price sale rows now retain independent labels and negotiated values while preserving their original catalog `productId` and ordered snapshot persistence.
Incomplete drafts and fixed-price rows continue to use the catalog name.
The implementation reuses `items[].productName` and `productNameSnapshot`, so it adds no schema migration or new request field.

## Ready to ship

- [x] Slice plan is done and feature overview is complete.
- [x] Focused Gate 2, integrated wave verification, and feature-boundary mutation verification passed.
- [x] Authenticated browser follow-up is documented in `AUDIT.md`.
- [ ] Run `/nexo-ship` when a human is ready to approve the release cut and promotion gates.
