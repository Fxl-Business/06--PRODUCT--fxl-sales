# 01 - Classify the entitlement 402 - execute note

Slice: `01-entitlement-classifier`
Branch: `feat/01-entitlement-classifier`
Status: PASS

## What changed

Three files, exactly the set the plan names.

`apps/web/src/lib/api-client.ts`
- `ApiError` gains an optional `code?: string` directly after `error`, carrying the plan's verbatim comment explaining that classification keys on `status` and never on this field.
- `code: body.code,` added between `error:` and `message:` in the `if (!res.ok)` block of BOTH `apiFetch` and `apiFetchBlob`.
  The two blocks remain character-for-character identical.
  They were deliberately not refactored into a shared helper: that is an unrelated change and does not belong on the critical path of a wave-1 slice four later slices depend on.

`apps/web/src/lib/require-token.ts`
- New exported `isEntitlementFailure(error: unknown): boolean`, placed between `isAuthFailure` and `assertBearerToken` so the two classifiers sit together.
- It duck-types `status === 402` and nothing looser.
  No import was added; the file still imports NOTHING, so no cycle with `api-client.ts` is possible.
- `isAuthFailure`, `isAuthTokenUnavailableError`, `assertBearerToken` and `requireToken` are byte-unchanged.

`apps/web/src/lib/__tests__/api-client-token-guard.test.ts`
- Import line extended with `isEntitlementFailure`.
- One appended `describe('402 missing_entitlement classification')` with the six locked test names from the plan.
  The existing `vi.stubGlobal('fetch', ...)` harness is reused as-is; no sibling test file was created.

## Why the predicate keys on status alone

`apps/api/src/middleware/app-auth.ts` is the only emitter of a 402 in the whole API, so `code` buys zero additional discrimination today.
Requiring it would fail CLOSED: the error branch does `res.json().catch(() => ({}))`, so a 402 whose body does not parse, or one from an older API build, carries no `code` and would classify as NOT an entitlement failure - landing straight back on the "verifique o servidor local" panel this feature exists to remove, silently and with a green suite.
`ApiError.code` is preserved so a later slice, a log line or a human in the console can read it, not so the classifier can branch on it.
The regression pin for exactly this is `isEntitlementFailure is true for a 402 that carries no code at all`, which goes red the moment someone makes `code` mandatory.

## Test results

Named locked oracle, run-once:

```
pnpm --filter @fxl-sales/web exec vitest run src/lib/__tests__/api-client-token-guard.test.ts
```

- RED first, before any implementation: `Tests 5 failed | 7 passed (12)`.
  The five failures were the four new predicate tests (`isEntitlementFailure is not a function` at import) and the two `code`-on-`ApiError` cases reporting `(1 matching property omitted from actual)` - the right reason in each case.
- GREEN after implementation: `Test Files 1 passed (1)`, `Tests 12 passed (12)`.
  Matches the plan's prediction of 6 before, 12 after.

Lint on the diff: `pnpm --filter @fxl-sales/web lint` - clean, no output.
Type-check: `pnpm --filter @fxl-sales/web type-check` (`tsc --noEmit`) - clean, no output.
`body.code` type-checked with no cast, exactly as `body.message` already does; the anticipated `tsc` complaint did not materialise.

Full web suite as a must-not-break check: `Test Files 52 passed (52)`, `Tests 724 passed (724)`.

Diff scanned for U+2014 and U+2013 on added lines: none found.

## Non-vacuity check

Run in both directions, one block at a time, restoring from a backup between them.

1. Deleted `code: body.code,` from `apiFetch` ONLY.
   Result: `apiFetch surfaces the body code on the thrown ApiError for a 402` went red ALONE; the blob test stayed green.
   `Tests 1 failed | 11 passed (12)`.
2. Restored, then deleted `code: body.code,` from `apiFetchBlob` ONLY - the check the contract names.
   Result: `apiFetchBlob surfaces the body code on the thrown ApiError for a 402` went red ALONE; the apiFetch test stayed green.
   `Tests 1 failed | 11 passed (12)`.
3. Restored both. Oracle back to 12 passed.

So the two duplicated error blocks are each independently pinned, and neither test is riding on the other.
The blob path is genuinely tested, which is what stops a payout CSV download hitting the entitlement gate from drifting away from a JSON read.

## Notes for downstream slices

- `isEntitlementFailure` is exported from `apps/web/src/lib/require-token.ts`. Slices 03 and 04 consume it from there.
- Nothing renders differently yet. This slice changes no copy, adds no dependency and does not touch `apps/web/src/auth/react.tsx` or `apps/web/src/sales-ops/SalesOpsApp.tsx`.
