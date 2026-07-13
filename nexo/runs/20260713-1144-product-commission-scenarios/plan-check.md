# Plan check - Product commission scenarios

## Verdict

PASS after one bounded correction pass.

## Corrections applied

- Converted every load-bearing `depends_on` and `files_modified` list to the inline syntax consumed by the installed `waves.sh` parser.
  Before correction, slice 02 was incorrectly assigned to wave 1 with slice 01 and all multiline file declarations were invisible to overlap detection.
- Made the migration oracle path correct for the API package working directory and clarified that preservation checks inspect assignment targets.
- Clarified that fixed product commissions are BRL major-unit values and must not use the cents-based money formatter.
- Added a mixed fixed and percentage resolver assertion so per-side fallback behavior is locked by RED rather than described only in prose.

## Re-check evidence

- `waves.sh` now derives `wave 1: 01-product-commission-contract`, `wave 2: 02-product-commission-editor`, and `wave 3: 03-product-aware-sale-defaults`.
- The sequential waves expose no same-wave write overlap.
- Required frontmatter is present, uses canonical repository-relative paths, and matches the current `milestone: null` state.
- Cross-slice field names match exactly: `sellerCommissionType` and `sellerCommissionValue` remain seller-only, `sellerWithFinderCommissionType` and `sellerWithFinderCommissionValue` represent seller-with-finder, and the existing finder pair remains unchanged.
- Slice 01 uses an additive nullable-add, data-copy, default, and `NOT NULL` migration sequence that preserves existing seller, finder, and fixed-value data.
- Slice 02 locks independent tab state, all-pair submission, reopen behavior, fixed-value persistence, and separate list presentation.
- Slice 03 unambiguously uses the first sale item, switches rates only when finder participation changes, preserves zero, falls back per side for fixed types, and does not add fixed ledger semantics.
- Each named oracle has an exact run-once command and fails against the current code because the new fields, UI behavior, resolver, or migration do not yet exist.
- The plan remains within product commission configuration and the existing sale wizard defaulting path requested by the accepted autopilot frame.

No unresolved plan defect remains.
