# Slice 02 - The Organization seam - execute notes

Branch: `feat/02-organization-seam`, cut from `master`.
Files touched: `apps/web/src/auth/react.tsx` and `apps/web/src/auth/__tests__/react.test.tsx`, and nothing else.

## What changed

`apps/web/src/auth/react.tsx`, in plan order:

1. `AuthProfile` gained the optional `workspaceId`, documented as the same claim `apps/api/src/middleware/app-auth.ts` reads as `MinimalHubAuthContext.workspaceId` and maps to `orgId`.
2. `profileFromToken` reads `readString(claims.workspaceId)` at the token's TOP LEVEL, above `workspaceName`.
   `readWorkspaces` is untouched; its `workspaceId ?? id` fallback is about entries inside the preview array and is a different question despite the shared spelling.
3. `applyToken` carries `workspaceId: next.workspaceId` into the object it already builds.
   No control-flow change at all, so the unchanged-token early return and every timer invariant sit exactly where they were.
4. `useHubProfile` destructures and returns the new field, so a component that needs only the active id has an escape hatch that does not go through the seam.
5. `export type Organization = HubWorkspacePreview` declared below the preview type.
   An alias rather than a redeclaration, so the seam never allocates a mapped copy of the preview array and the array identity survives out to the caller.
6. `useHubOrganizations`, placed between `useHubLogout` and `HubUserControls`.
   Three `useMemo` calls over context values: `active` (id first, name match kept only as the documented fallback), `others`, and the returned object.
   It holds no state, starts no request, schedules nothing, and hands `setActive` and `client` through BY REFERENCE.
   It contains no cache call of any kind.
7. `HubUserControls` now reads `useHubLogout()` plus the seam instead of `useHubAuthContext()`.
   Exactly three JSX changes: `workspaces.length > 1` to `organizations.length > 1`, the `options` map source and its parameter name, and `value={active?.id ?? ''}`.
   `aria-label="Workspace"`, `searchPlaceholder="Buscar workspace..."`, every class name, the `orgLabel` / `isOrgLabelFallback` mapping body and its comment, and the whole `Sair` button are byte-unchanged.
   No `valueLabel` prop was added.
8. `export const useOrganizations = useHubOrganizations;` added between `useLogout` and `UserControls`.

`apps/web/src/auth/__tests__/react.test.tsx`, additively:

- `profileToken` gained an OPTIONAL THIRD parameter `workspaceId`, appended so every existing call site compiles and keeps exercising the name fallback.
  Per plan-check suggestion S1, the existing multi-line comment above the `workspaces` parameter is KEPT VERBATIM; the new parameter carries its own comment restating the lesson for its own case.
- `SAME_NAME_ORGS`, two Organizations that genuinely share the name `Alpha`, the active one deliberately the SECOND.
- `OrganizationProbe`, which renders IDS rather than labels because these assertions are about identity.
- `renderOrganizations`, a dedicated flat host, so `renderProvider` is not disturbed.
- `openWorkspacePicker` and `workspaceOptions` beside `workspaceTrigger` and `switchWorkspace`; `switchWorkspace` cannot be reused because it finds its row by visible label and the case under test is two rows sharing one label.
- One new `describe`, appended at the END of the file after `identity-scoped query cache`, with the ten planned tests.

Nothing pre-existing was edited: no existing `profileToken` call gained a third argument, `renderProvider` / `renderProtected` / `Probe` / `beforeEach` / `afterEach` are untouched, `mocks.cache.expiresAt.mockReturnValue(null)` is untouched, and the new block does not call `vi.useFakeTimers()`.

## The discriminating oracle WAS RED before the fix

Confirmed explicitly, and deliberately staged to prove it: steps 1 to 6 (the claim read and the seam) were implemented FIRST while `HubUserControls` was left on the old name match. Running the named oracle at that point gave

```
Test Files  1 failed (1)
     Tests  1 failed | 62 passed (63)

FAIL > active organization and the useOrganizations seam >
  marks the active organization in the picker by id when two organizations share a name
AssertionError: expected <div aria-selected="true" ...>...</div>
                to be     <div aria-selected="false" ...>...</div>

- Expected                     + Received
- aria-selected="false"        + aria-selected="true"
- id=":r1l:-option-1"          + id=":r1l:-option-0"
```

That is the right reason exactly: the name match marked `option-0` (`workspace-alpha-1`), while the token's active Organization is `workspace-alpha-2` at index 1.
The other nine new tests were already green at that point, which is correct - they exercise the seam and the claim, both of which existed by then, and only the picker's `value` prop was still wrong.
Applying step 7 (`value={active?.id ?? ''}`) turned it green with no other edit.

## Test results (run-once, no watchers)

```
pnpm --filter @fxl-sales/web exec vitest run src/auth/__tests__/react.test.tsx
  Test Files  1 passed (1)
       Tests  63 passed (63)

pnpm --filter @fxl-sales/web lint
  clean, no output

pnpm --filter @fxl-sales/web type-check
  clean, no output

pnpm --filter @fxl-sales/web exec vitest run
  Test Files  52 passed (52)
       Tests  735 passed (735)
```

The full web suite is the must-not-break check: the four cache oracles, the ladder block, the renewal block and every sales-ops suite are green and untouched.

## Invariants deliberately left alone

- `queryClient.clear()` inside `setActive` is byte-unchanged, still after the `await` and after the `operationGeneration` check and before `tokenCache.seed`.
  The new test `reaches client.setActive through the seam and flushes the query cache exactly once` installs its spy AFTER the mount flush, because the cold-start signed-out to signed-in transition legitimately flushes once inside `observeToken`.
- No timer was added or read. `applyToken`'s control flow, `scheduleRenewal`, `observeToken` and `scheduleRevalidate` were not touched.
- The context `value` memo is unchanged, so `does not re-render auth consumers when a refresh returns the same token` keeps its meaning; the seam's three memos depend only on values that are stable while the token is unchanged.

## Scope confirmation

No file outside the two named ones was modified. No API change, no SDK change, no `?organization=` deep link, no i18n extraction, no edits under `apps/web/src/lib/**` or `apps/web/src/sales-ops/**`.
No em dash or en dash on any added line; the diff was grepped for U+2014 and U+2013 and came back empty.
