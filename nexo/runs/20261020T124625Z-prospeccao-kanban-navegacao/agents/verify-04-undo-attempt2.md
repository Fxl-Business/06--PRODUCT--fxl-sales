# Verify 04 - Desfazer, attempt 2

Verdict: **PASS** for `19385245dc185405d360bb76c3a5b786a8d0780a` against `9701eab`.
I independently read the dispatch, amended slice plan, implementation, and locked oracle.

## Gates

- Locked oracle: `NODE_ENV=test pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/leads/__tests__/lead-undo.test.tsx` passed, 15/15.
- Affected leads suite: `NODE_ENV=test pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/leads/__tests__` passed, 428/428 in 36 files.
- `pnpm --filter @fxl-sales/web type-check`, `pnpm --filter @fxl-sales/web lint`, and `git diff --check 9701eab..HEAD` passed.
- The affected suite emitted React `act(...)` environment warnings in existing board tests, without test failures.

## Independent behavior review

- The notice timer is cleaned up while an inverse is pending, and remains suspended after an inverse error so retry stays available.
  The oracle advances past the original five second deadline during a delayed rejection, then retries successfully.
- Before inverse move or edit, `boardQuery.refetch({ throwOnError: true })` performs fresh per-stage HTTP reads and compares the server row to the forward response.
  The conflict oracle changes the server fixture after the forward write and confirms no inverse write occurs and the conflict copy is shown.
- The guard is a client-side read before write, not an atomic compare-and-swap.
  A change between that read and the inverse write can still race; the present API does not offer a row-version precondition.
  The implementation makes no exact-reversal claim when a detected conflict occurs, but cannot eliminate this final interval.
- Drag and Mover converge on `LeadsBoard.emitMove` and the same `onMoveLead` callback.
  The locked oracle drives Mover directly; it does not simulate drag gestures.
- The oracle covers source index 1, lost reason, both edit editions including products/contact fields, totals after delete restore, timer replacement and unmount, conversion exclusion, duplicate inverse prevention, and failed forward and inverse writes.
  The seller restore authorization is covered by slice 03 and the service, while this slice verifies the restore HTTP interaction.

## Oracle sensitivity

- Temporarily removing the board refetch guard caused `refuses a stale inverse move` to fail because a second mutation was sent.
- Temporarily removing `undoBusy` from the timer effect dependencies caused `keeps the action through a slow rejected inverse` to fail when the notice vanished.
- A narrower mutation removing only `undoBusy` from the effect guard did not fail because the dependency cleanup itself pauses the old timer; this was not treated as proof of sensitivity.
- Each temporary mutation was restored in `finally`; `git status --short` was clean before this report was written.

No server, watcher, or other persistent process was started.
