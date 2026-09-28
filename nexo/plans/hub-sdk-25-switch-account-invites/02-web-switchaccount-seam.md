---
id: 02-web-switchaccount-seam
milestone: v4.1.0
status: todo
depends_on: [01-sdk-bump-2.5.0]
files_modified:
  - apps/web/src/auth/react.tsx
  - apps/web/src/dev/install-dev-identity.ts
  - apps/web/src/auth/__tests__/react.test.tsx
  - apps/web/src/dev/__tests__/dev-identity-switch-account.test.ts
  - apps/web/src/auth/__tests__/no-hand-built-prompt.test.ts
acceptance: "given the 2.5.0 SDK, when a caller invokes switchAccount({ organization }) through the auth provider, then the real client's switchAccount is called exactly once with the active organization (when one exists), the dev client has a compiling switchAccount shim that behaves like its login (no navigation, no identity swap), useHubOrganizations surfaces switchAccount by reference, and a guard test proves no route hand-builds prompt=."
goal: "Expose switchAccount through the single auth seam (react.tsx) and shim the hand-rolled dev client, so the three UI surfaces can call one wrapper."
verifier_focus: "switchAccount is a sibling of setActive (account switch, not org switch); it follows the real 2.5.0 semantics recorded in sdk-2.5.0-surface.md (navigates like login => NO queryClient.clear/generation guard; if it instead resolves in-page, mirror setActive's four-statement critical section). The dev shim must not navigate or swap identity."
must_not_break:
  - "The setActive four-statement critical section (bump generation, await, generation check, queryClient.clear, tokenCache.seed, observeToken) stays the ONE copy and is unchanged."
  - "useHubOrganizations stays a thin projection; it must not call queryClient.clear itself."
  - "The dev client still satisfies HubClient and dev boots unchanged (scripts/assert-web-bundle-clean.mjs; auth-fake isolation)."
rules:
  - "switchAccount is exposed through the provider wrapper, not by calling client.switchAccount directly from UI."
  - "Pass the active organization: switchAccount({ organization: active?.id }) when an active org exists, else switchAccount()."
---

# Slice 02 - switchAccount through the auth seam

## Context (from investigation)

`apps/web/src/auth/react.tsx`:
- Hub client created via the ternary seam at lines ~245-278: `devSession ? devSession.client : createHubClient(loadHubBrowserConfig(...), { bffBasePath, autoRenew: false })`.
- `HubAuthState` context type ~lines 118-135 (has `setActive` at ~133).
- `login` wrapper: `const login = useCallback(() => client.login(), [client])` (~line 559) - simple, navigates, no cache flush.
- `setActive` wrapper: ~lines 626-651 - the four-statement critical section (the ONE copy CLAUDE.md pins).
- Context value memo ~lines 693-705.
- `useHubOrganizations` ~lines 984-1066 (exported as `useOrganizations` ~1130); returns `{ active, activeName, organizations, others, setActive, client }`; `setActive` handed through by reference (~1047); `client` returned raw (~1062).

`apps/web/src/dev/install-dev-identity.ts`: hand-rolled dev client object literal `satisfies HubClient` (~lines 116-194) implementing every HubClient method. `login()` reloads (~121-127). It does NOT use hub-sdk-testing.

`sdk-2.5.0-surface.md` (from slice 01) records the real `switchAccount` signature + whether it navigates.

## Steps (TDD: write the oracle first)

1. **react.test.tsx (red):** add a test that the provider exposes `switchAccount` and that calling it invokes `client.switchAccount` once with `{ organization: <activeId> }` when an active org exists (and with no/empty options otherwise). Mock the client the way the existing suite does.
2. **react.tsx (green):**
   - Add `switchAccount` to `HubAuthState` (near `setActive`, ~line 133): `switchAccount: (options?: { organization?: string }) => void` (match the SDK's return type from the surface note; likely `void` since it navigates).
   - Implement a `switchAccount` wrapper. **If the surface note says switchAccount navigates (like login):** implement it like `login` - `const switchAccount = useCallback((options?) => client.switchAccount(options), [client])` - NO generation guard, NO queryClient.clear (the page leaves and returns cold). **If the note says it resolves in-page** (returns a token result like setActive), mirror the setActive critical section instead. Default expectation: navigates.
   - Add it to the context value memo (~693-705).
   - Surface it from `useHubOrganizations` by reference (return object ~1035-1064), exactly like `setActive`.
3. **Dev client shim:** add `switchAccount(options?) { /* dev: behave like login - reload; never live-swap identity */ ... }` to the `satisfies HubClient` literal in `install-dev-identity.ts`, mirroring the dev `login()` (reload) so it compiles and matches spec section 8 (never navigates to Hub, never changes the adopted identity). Add `dev-identity-switch-account.test.ts` asserting the shim exists and does not throw / does not swap identity.
4. **Guard test (`no-hand-built-prompt.test.ts`):** a repo/source guard asserting no file under `apps/web/src` or `apps/api/src` builds `prompt=` by hand (grep the source, allow only comments/tests). This satisfies spec section 10 proof item 2. Key on real code, not comments (use a guard that strips comments or asserts the only hits are this test + known comments).

## Acceptance / oracle

- Named oracle: `apps/web/src/auth/__tests__/react.test.tsx` (switchAccount wrapper) + `apps/web/src/auth/__tests__/no-hand-built-prompt.test.ts` + `apps/web/src/dev/__tests__/dev-identity-switch-account.test.ts`.
- Plus `type-check` (the dev client `satisfies HubClient` must compile against the 2.5.0 type).
