# Slice 02 - Verify (Gate 2, fast tier)

Branch: `feat/02-organization-seam`
Diff under test: `git diff master...HEAD`
Verifier: independent Nexo VERIFY agent (did not write the code)

## Verdict

**PASS**

Every required command is green, every required must-not-break oracle survived, and all four
prescribed mutations went RED against the named oracle file, so the suite is non-vacuous on
exactly the properties the acceptance criterion names.

## Scope check

`git diff master...HEAD --stat`:

| File | +/- |
| --- | --- |
| `apps/web/src/auth/react.tsx` | +177 / -9 |
| `apps/web/src/auth/__tests__/react.test.tsx` | +296 |
| `nexo/runs/feature-20260828-organization-context-escape/02-execute.md` | +92 |

Exactly the two source files plus the run note. No scope violation.

Working tree at start and at end: `M nexo/runs/.../budget.json`, untracked `.vscode/` and
`nexo/runs/.../agents/execute-02.result.json`. Both were pre-existing and are unchanged by this
verification; every mutation was reverted with `git checkout --`.

## Commands run (all RUN-ONCE, no watcher)

1. `pnpm --filter @fxl-sales/web exec vitest run src/auth/__tests__/react.test.tsx`
   -> **63 passed / 63**, 1 file passed.
2. `pnpm --filter @fxl-sales/web exec vitest run`
   -> **735 passed / 735**, 52 files passed. No failures, no skips reported.
3. `pnpm --filter @fxl-sales/web lint` -> clean, no output from `eslint src/`.
4. `pnpm --filter @fxl-sales/web type-check` -> clean, no output from `tsc --noEmit`.

## Must-not-break checks (read + suite)

- **`queryClient.clear()` ordering in the provider's `setActive`.** Read the current body at
  `apps/web/src/auth/react.tsx:574-598`. The order is unchanged and still exactly:
  bump `operationGeneration` -> `await client.setActive(workspaceId)` -> generation check with
  early `return` -> `queryClient.clear()` -> `tokenCache.seed(...)` -> `observeToken(...)`.
  The diff touches no line inside this callback. Both dedicated oracles
  (`keeps the current tenant's cache while a workspace switch is still in flight`,
  `does not flush when a superseded workspace switch resolves late`) pass.
- **Exactly one flush per switch.** The seam hands `setActive` through by reference and calls no
  `queryClient` API of its own; the new test
  `reaches client.setActive through the seam and flushes the query cache exactly once` installs
  the `clear` spy after the mount flush and asserts `toHaveBeenCalledTimes(1)`. M4 proves it bites.
- **Ladder and proactive renewal timer invariants.** Unchanged code; all timer/`vi.getTimerCount()`
  tests in the file pass.
- **Memoized auth context identity.** `does not re-render auth consumers when a refresh returns the
  same token` passes. The seam deliberately aliases `Organization = HubWorkspacePreview` rather than
  mapping a new array, so the `workspaces` array identity is preserved out to callers.
- **`HubUserControls`.** Read at `apps/web/src/auth/react.tsx:1015-1069`: the `className` on the
  Combobox and on the button, `aria-label="Workspace"`, `searchPlaceholder="Buscar workspace..."`,
  the `Sair` button (`aria-label`, `title`, `LogOut` icon) and the `> 1` render gate are all
  byte-identical to master apart from the `workspaces` -> `organizations` rename and the `value`
  expression. New tests pin the single-organization no-picker case and the muted secondary id line.
- **Full web suite**: 735/735 green.

## Read checks

- **Dashes.** Scanned the whole diff with Python for U+2014 and U+2013: **0 hits**.
- **Native pickers.** No `<select>`, `<option>` or `<datalist>` introduced (grep over the diff:
  no matches). The picker remains `Combobox`.
- **Thin projection.** `useHubOrganizations` is three `useMemo` calls plus a returned memo object.
  No `useState`, no `useEffect`, no `useRef`, no request, no timer, no `queryClient` access, and
  `setActive` is destructured from the context and returned by reference - it is not reimplemented.
- **`profileToken`'s `workspaces` comment.** Still present verbatim at
  `apps/web/src/auth/__tests__/react.test.tsx:106-113` (the `workspaceId`-versus-`id` fixture-bug
  note). The new `workspaceId` parameter comment was added below it, not in place of it.
- **Commit trailers.** Single commit `fe1a8f4`, carrying
  `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>` and
  `Claude-Session: https://claude.ai/code/session_01SPY9R3AFFgJ2LrCwaAxtyU`. No other co-author
  trailer.

## Acceptance criterion, traced

- Active Organization resolved by id: `active` uses `workspaces.find((w) => w.id === workspaceId)`
  and synthesizes `{ id: workspaceId, name: workspaceName ?? match?.name, products }`, so it is
  correct even when the active Organization sits outside the capped preview. Pinned by
  `surfaces the active organization id from the token claims` and
  `resolves the active organization by id when two organizations share a name`.
- Name match survives only as the documented fallback for a token with no `workspaceId` claim,
  pinned by `falls back to the name claim when the token carries no workspaceId` and by the fact
  that every pre-existing test in the file (which mints no `workspaceId`) still passes.
- Organizations / others / setActive / client are all exposed and asserted, including
  `client.checkoutUrl` reachability.
- The picker marks the active entry by id: `value={active?.id ?? ''}`, pinned by
  `marks the active organization in the picker by id when two organizations share a name`, which
  first asserts the ambiguity is genuinely on screen (two rows, both labelled `Alpha`) and then
  that the single `aria-selected="true"` row is the SECOND one.

## Mutation table (each applied alone, oracle re-run, then reverted)

| # | Mutation | Result | Failing test(s) |
| --- | --- | --- | --- |
| M1 | Picker active entry reverted to the ORIGINAL name match (`organizations.find((w) => w.name === activeName)?.id ?? ''`) | **RED** | `marks the active organization in the picker by id when two organizations share a name` (1 failed / 63) |
| M2 | Seam's `others` returns `workspaces` unfiltered | **RED** | `lists the account organizations and excludes the active one from the others` (1 failed / 63) |
| M3 | `workspaceId: readString(claims.workspaceId)` deleted from `profileFromToken` | **RED** | `surfaces the active organization id from the token claims`, `resolves the active organization by id when two organizations share a name`, `marks the active organization in the picker by id when two organizations share a name` (3 failed / 63) |
| M4 | SECOND `queryClient.clear()` added inside a seam-level `setActive` wrapper | **RED** | `reaches client.setActive through the seam and flushes the query cache exactly once` (`expected "clear" to be called 1 times, but got 2 times`) and `does not flush when a superseded workspace switch resolves late` (2 failed / 63) |
| M5 (bonus) | Provider's own `queryClient.clear()` moved BEFORE the `await` | **RED** | `keeps the current tenant's cache while a workspace switch is still in flight` (1 failed / 63) |

M4 note: the seam does pass `setActive` through by reference, so the mutation was expressed by
wrapping it inside the seam with a `useQueryClient()` flush after the await - the closest
expressible form of "the seam grows a second flush". It went RED, and M5 was run anyway as the
prescribed alternative, which also went RED. Both flush-ordering oracles are therefore live.

No mutation stayed green.

## Observations (non-blocking, not defects against this criterion)

- `active.name` prefers the top-level `workspaceName` claim over the matched preview entry's name.
  If the two ever disagree, the seam's `active.name` and the picker row's label would differ. This
  is deliberate and documented in the code comment (the claim describes the ACTIVE Organization and
  is present even when the preview is not), and no criterion is stated over it.
- When the active Organization is outside the capped `workspaces` preview, `value={active?.id}`
  names an id that is not among the rendered options. That is strictly better than the previous
  behaviour (which marked nothing), and rendering the missing entry is not in this slice's scope.
