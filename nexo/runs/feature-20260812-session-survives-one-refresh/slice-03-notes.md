# Slice 03 - Never restore the `/no-role` route

Branch: `fix/03-never-restore-the-no-role-route`.
Plan: `nexo/plans/feature-20260812-session-survives-one-refresh/03-never-restore-the-no-role-route.md`.

## What changed

Two files, exactly the two the plan names.

### `apps/web/src/auth/session-recovery.ts`

- Added the module-private constant `TERMINAL_AUTH_ROUTES: readonly string[] = ['/no-role']`,
  between `dropItem` and the `sanitizeReturnTo` docstring, with the plan's docstring explaining why
  `/no-role` is the one member and why `/admin/*`, `/finder/*`, `/seller/*` and `/auth*` are not.
  It is NOT exported, so the oracle keeps pinning literal paths rather than whatever the
  implementation happens to hold.
- Added `isTerminalAuthRoute(pathname)`, mirroring how React Router matches: per-segment
  `decodeURIComponent` with the `/` re-encoding copied from `decodePath`, a `catch` that falls back
  to the undecoded value, all trailing slashes stripped, and `toLowerCase` (not
  `toLocaleLowerCase`).
- Added the single call `if (isTerminalAuthRoute(url.pathname)) return null;` INSIDE the
  post-normalization block, immediately after the two re-asserted structural checks and before the
  `normalized === '/'` check.
- Renumbered the docstring contract: the new rule is item 8, the old item 8 (`/` is nothing to
  restore) becomes item 9.

Nothing else in the file changed. No caller was touched: `null` already means "no restore" at every
consumption point.

### `apps/web/src/auth/__tests__/session-recovery.test.ts`

- `ACCEPTED_RETURN_TO` gained `/tatico/dashboard` and `/admin/finders` as the over-blocking guards.
- `REJECTED_RETURN_TO` gained the eight-member terminal-screen family: `/no-role`, `/no-role/`,
  `/no-role//`, `/no-role?x=1`, `/no-role#frag`, `/NO-ROLE`, `/No-Role/`, `/%6Eo-role`.
- Two named tests in `describe('sanitizeReturnTo')`:
  `refuses a terminal route that only appears after dot-segment normalization` and
  `does not over-block routes that merely start with a terminal route`.
- Two named tests in `describe('captureReturnTo / consumeReturnTo')`:
  `writes nothing when the captured path is the terminal /no-role screen` and
  `destroys a stored terminal route on the read that rejects it`.

No import changes were needed.

## Step 1 - the tests go red before the fix

`pnpm --filter @fxl-sales/web exec vitest run src/auth/__tests__/session-recovery.test.ts`

```
 Test Files  1 failed (1)
      Tests  11 failed | 54 passed (65)
```

Exactly the eleven the plan lists, and nothing else in the file:

```
 × sanitizeReturnTo > rejects "/no-role"
 × sanitizeReturnTo > rejects "/no-role/"
 × sanitizeReturnTo > rejects "/no-role//"
 × sanitizeReturnTo > rejects "/no-role?x=1"
 × sanitizeReturnTo > rejects "/no-role#frag"
 × sanitizeReturnTo > rejects "/NO-ROLE"
 × sanitizeReturnTo > rejects "/No-Role/"
 × sanitizeReturnTo > rejects "/%6Eo-role"
 × sanitizeReturnTo > refuses a terminal route that only appears after dot-segment normalization
 × captureReturnTo / consumeReturnTo > writes nothing when the captured path is the terminal /no-role screen
 × captureReturnTo / consumeReturnTo > destroys a stored terminal route on the read that rejects it
```

The dot-segment one failed with the exact shape the slice exists to close:

```
AssertionError: expected { value: '/foo/../no-role', ...(1) } to deeply equal { value: '/foo/../no-role', ...(1) }
- Expected
+ Received
  {
-   "result": null,
+   "result": "/no-role",
    "value": "/foo/../no-role",
  }
```

The two named guard tests that must pass today did pass today
(`does not over-block routes that merely start with a terminal route`, plus both new
`ACCEPTED_RETURN_TO` rows), so they are guards rather than proof, exactly as planned.

## Step 3 - green after the fix

```
 ✓ src/auth/__tests__/session-recovery.test.ts (65 tests)
 Test Files  1 passed (1)
      Tests  65 passed (65)
```

## Step 4 - the placement proof

The call was temporarily moved ABOVE the `new URL(...)` block so it tested the raw `value`
(`if (isTerminalAuthRoute(value)) return null;` immediately after the raw second-character check),
and removed from the post-normalization block.

```
 × sanitizeReturnTo > rejects "/no-role?x=1"
 × sanitizeReturnTo > rejects "/no-role#frag"
 × sanitizeReturnTo > refuses a terminal route that only appears after dot-segment normalization
      Tests  3 failed | 62 passed (65)
```

```
AssertionError: expected { value: '/foo/../no-role', ...(1) } to deeply equal { value: '/foo/../no-role', ...(1) }
- Expected
+ Received
  {
-   "result": null,
+   "result": "/no-role",
    "value": "/foo/../no-role",
  }
```

`refuses a terminal route that only appears after dot-segment normalization` went red as required,
so the oracle pins the PLACEMENT and not merely the behaviour. The wrong placement was reverted
immediately and the oracle re-run green.

### One observation, not a deviation

The plan predicted the misplacement would turn that one test red "while every other new test stays
green". Two other new tests also went red: `rejects "/no-role?x=1"` and `rejects "/no-role#frag"`.
That is correct and expected on reflection, and it makes the oracle stronger rather than weaker: a
raw-input check sees the whole string including the query and the fragment, so `/no-role?x=1` is
compared verbatim against `/no-role` and does not match. Only the post-normalization placement can
see `url.pathname`, which is what strips both. Nothing was changed in response to this; it is noted
because the plan's sentence is now known to be slightly understated.

## Final gate

All run-once, no watchers, no leftover processes.

| Command | Result |
| --- | --- |
| `pnpm --filter @fxl-sales/web exec vitest run src/auth/__tests__/session-recovery.test.ts` | 65 passed (65), 1 file |
| `pnpm --filter @fxl-sales/web test` | 682 passed (682), 50 files |
| `pnpm run lint` | Done, api and web both clean |
| `pnpm run type-check` | Done, all four projects clean |

## Disagreements

None with the design. The only note is the placement-proof observation above, which strengthens the
plan's claim rather than contradicting it.

## Filed, not done here

The plan's two Capture-time follow-ups are deliberately untouched by this slice, since
`files_modified` names two files and only two:

- CLAUDE.md's `sanitizeReturnTo` bullet should gain a sentence saying the same normalized value is
  refused outright when it names a terminal auth screen such as `/no-role`, matched the way React
  Router matches it.
- `url.pathname === '/auth'` and `startsWith('/auth/')` remain case-sensitive, so `/Auth/login`
  walks past check 6. That path is a server proxy target rather than a React route, so the impact is
  one wasted navigation. A ROADMAP line if anyone judges it worth one.
