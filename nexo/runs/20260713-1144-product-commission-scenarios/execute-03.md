# Execute 03 - Product-aware sale defaults

## Status

PASS pending independent Gate 2 verification.

## RED evidence

The pure resolver oracle was added before production changes.
Its first run failed three tests because `resolveSaleCommissionDefaults` did not exist.
The rendered wizard oracle was then added and failed both tests because the wizard still used the organization defaults of `9%` and `2%` instead of the product scenarios.

## GREEN implementation

- Added a pure resolver for seller-only and seller-with-finder percentage defaults.
- Preserved valid zero percentages and applied organization fallbacks independently for missing or fixed product sides.
- Initialized the sale wizard from the primary product's seller-only scenario.
- Resynchronized the commission fields only when the primary product commission record, finder participation, or organization fallback changes.
- Kept secondary item, finder identity, seller, price, quantity, payment, tax, and unrelated edits from resetting commission input.
- Reused the existing sale payload snapshot without changing API or database contracts.

The original plan proposed a synchronous state-writing effect.
Lint rejected that React anti-pattern, so the implementation uses a stable source key and React's conditional render-time state adjustment pattern.
This retains the specified dependency behavior and covers primary-item removal without event-specific reset logic.

## Verification evidence

- Full web suite: 53 tests passed across 11 files.
- Web lint: passed.
- Workspace typecheck: passed for shared packages, API, and web.
- Production web build: passed.
- `git diff --check`: passed.
- No preview, watcher, or test process remained running.

## Visual check

The rendered happy-dom test exercised the visible finder controls, primary and secondary product selectors, commission inputs, and submitted snapshots.
The authenticated browser flow remains a manual audit item because the in-app browser backend reported no available browser in this session.
