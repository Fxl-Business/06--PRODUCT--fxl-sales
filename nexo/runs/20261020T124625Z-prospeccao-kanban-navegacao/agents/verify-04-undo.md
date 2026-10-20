# Verify 04 - Desfazer

Verdict: **FAIL** for commit `5fc43e9d682af3172764c0110f4bb273dbb3fa7e` against `9701eab`.
I read the dispatch and amended slice plan from the run worktree, the changed source, and the tests independently.

## Automated evidence

- Locked oracle: `NODE_ENV=test pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/leads/__tests__/lead-undo.test.tsx` passed, 10/10.
- Affected leads suite: `NODE_ENV=test pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/leads/__tests__` passed, 423/423 across 36 files.
- `pnpm --filter @fxl-sales/web type-check`, `pnpm --filter @fxl-sales/web lint`, and `git diff --check 9701eab..5fc43e9d682af3172764c0110f4bb273dbb3fa7e` passed.
- A temporary mutation suppressing `publishUndo('Lead movido', ...)` caused the oracle to fail 5 of 10 tests.
  The original source was restored and `git status --short` was clean afterward.

## Blocking findings

1. **An inverse request can fail after the notice expires, leaving no retry despite the error saying "Tente novamente."**
   `LeadsBoardContainer.tsx:179-185` starts a five second timeout when the notice appears and never pauses it when `runUndo` starts at lines 197-213.
   If the inverse request takes longer than the remaining window, the timeout removes the notice and its action while the request is pending.
   A rejection then renders only the error.
   The user cannot retry from the board, contrary to the plan's failed inverse behavior.
   Keep the action available through a pending inverse and its failure, and test a delayed rejected request with fake timers.

2. **A stale undo can overwrite another actor's change while claiming success.**
   Lines 216-239 capture the pre-write snapshot and later send that snapshot as an unconditional inverse move or PATCH.
   There is no read, version check, or conflict handling before undo.
   If another actor changes the lead after the forward write, this inverse can replace their stage or writable fields, then remove the notice with no warning.
   The amended plan explicitly says, "If another actor changed the lead, never claim an exact reversal."
   Add a concurrency guard or an explicit partial/conflict outcome, and cover it with an HTTP backed oracle.

## Oracle gaps to close

The new oracle exercises the Mover button but does not drive drag and drop, so it does not prove both board inputs publish undo.
It does not test timer cleanup on unmount.
Its summary stub always returns empty stages, so the delete assertion proves card restoration but not totals reconciliation.
The single row fixture only proves index zero, and the full edition fixture has no products, so position and product restoration are weakly covered.
The inverse failure test checks duplicate clicks and the error but not notice availability after a slow failure.
The retained create test remains meaningful: it asserts the awaited `mutateAsync` call and absence of an edit undo for creation.

No build, watcher, server, or long running process was left active.
