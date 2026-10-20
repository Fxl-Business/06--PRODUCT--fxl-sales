# Execute 04 - undo

Verdict: PASS, ready for separate Verify.

## Implementation

- Added a five second `Desfazer` notice for successful ordinary moves, existing lead edits, and soft deletes.
- Inverse writes use the existing move, save, and restore mutations, with their leads-root invalidation.
- Conversion moves and lead creation never publish an undo action.
- Full-edition saves now await the server result, preserve the dialog on failure, and show an inline error.
- Failed inverse writes display an error and never claim restoration.

## Test-first evidence

The locked oracle initially failed because no undo notice existed after a persisted delete.
The oracle now has ten real-container tests using a QueryClient and stubbed HTTP, including positive inverse requests for move, edit, and delete, conversion exclusion, original lost reason, failure handling, duplicate prevention, expiry, and notice replacement.
The move test exercises the Mover control, which shares `LeadsBoard.emitMove` with drag.

## Verification

- `NODE_ENV=test pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/leads/__tests__`: 36 files, 423 tests passed.
- `pnpm --filter @fxl-sales/web type-check`: passed.
- `pnpm --filter @fxl-sales/web lint`: passed.
- `git diff --check`: passed.

## Scope adjustment

One legacy container test asserted that a full-edition create uses fire-and-forget `mutate()`.
It was updated to expect awaited `mutateAsync()` and to retain the no-undo assertion for creation.
This changed a fifth file by seven lines of diff, reported to the orchestrator before expansion.
The total code and test change remains below 600 lines.

## Review

- A visual browser capture is owned by the integrated run and is not a slice gate.
- The oracle drives the shared `emitMove` path through Mover; it does not simulate pointer drag in happy-dom.
