# Execute 02 - Product commission editor

## Status

PASS pending independent Gate 2 verification.

Commit: `39a773d` (`feat(products): edit commission scenarios independently`).

## RED evidence

The focused component suite was created before production changes.
Its first run failed all five tests because `ProductDialog` and `ProductsView` were not exported and the independent editor contract did not exist.
The failure was the expected missing-feature failure.

## GREEN implementation

- Added seller-with-finder commission fields to the web product response and save payload types.
- Replaced the legacy boolean-backed tab selection with local `commissionMode` state.
- Bound seller-only and seller-with-finder controls to independent type and value pairs.
- Kept the finder pair independent and stopped zeroing it when the seller-only tab is active.
- Added scenario-specific accessible labels to amount and unit controls.
- Updated the product table to show `Somente vendedor` and `Vendedor + Finder` as separate columns.
- Added explicit percentage and Brazilian fixed-value formatting without converting BRL major units to cents.

## Verification evidence

- Focused product editor suite: 5 tests passed.
- Full web suite: 48 tests passed across 10 files.
- Web lint: passed.
- Web typecheck: passed.
- Production web build: passed.
- `git diff --check`: passed.
- No preview, watcher, or test process remained running.

## Visual check

The production preview started successfully at `http://127.0.0.1:4176` and was stopped after the check attempt.
The in-app browser backend reported no available browser, so the authenticated live visual flow and screenshots could not be completed in this session.
The happy-dom interaction oracle exercised tab switching, save payloads, reopening persisted values, fixed-value controls, and separate table output.
