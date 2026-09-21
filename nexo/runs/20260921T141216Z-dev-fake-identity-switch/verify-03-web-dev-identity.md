# Verify report: slice 03-web-dev-identity

Verdict: **FAIL**

## Decisive finding: the cross-check test is decorative

The plan requires `apps/web/src/dev/__tests__/dev-identity-roles.test.tsx` to discharge
slice 01's debt: prove that a roster identity's *declared* `expectedRoles` /
`expectedPaineis` are actually true of the real `getRolesFromHubClaims` +
`getVisibleWorkspaces` translation. This was checked by mutation, as instructed.

**Mutation applied:** in `packages/auth-fake/src/index.ts`, identity `team-owner`'s
`expectedPaineis` was changed from
`['tatico', 'operacional', 'cadastros', 'meus-dados']` to `['meus-dados']` (a
declared expectation that is now wrong for that identity's real claim shape:
`workspaceRole: 'owner'` still yields full access through the real
`getRolesFromHubClaims`).

**Result:**
- `pnpm --filter @fxl-sales/auth-fake test` → still **35/35 passed**. (`roster.test.ts`'s
  `covers every painel set the real visibility rule can produce` test only checks that
  the *set of distinct* `expectedPaineis` strings across all nine identities equals
  `{full-access, meus-dados, empty}`. Since three other identities still declare the
  full-access string, the distinct-set assertion is unaffected by mutating one
  identity's value to another already-present string. This is a known, pre-existing
  weakness of the package-level test, which is exactly why slice 03 was assigned the
  real cross-check.)
- `apps/web` cross-check, run directly: `npx vitest run src/dev/__tests__/dev-identity-roles.test.tsx`
  → still **12/12 passed**, `team-owner` case included.

**Root cause:** `dev-identity-roles.test.tsx`'s `REACHABLE_CASES` table hardcodes its
own expected strings per identity id:

```ts
const REACHABLE_CASES: Array<{ id: string; expected: string }> = [
  { id: 'team-owner', expected: 'tatico,operacional,cadastros,meus-dados' },
  ...
];
```

It never reads `identity.expectedRoles` / `identity.expectedPaineis` off the roster at
all. So it independently (and correctly) re-derives what the answer *should* be,
completely decoupled from the roster's own declared fields. Mutating the roster's
declared `expectedPaineis` therefore cannot ever turn this test red, because the test
does not consume that field — it drives the real translation from the identity's other
data (`workspaceRole`, `productRoles`, etc., via the minted token) and compares
against its own separately hand-typed literal. The roster's declared
`expectedRoles`/`expectedPaineis` fields remain unverified against reality by any test
in the tree: `roster.test.ts` only checks their aggregate set-membership, and this
slice's file bypasses them entirely.

Per the task's explicit instruction: *"If it does not go red, the cross-check is
decorative and this slice FAILS."* It did not go red. **FAIL.**

The mutation was reverted immediately after observation;
`git diff -- packages/auth-fake/src/index.ts` is confirmed empty and the tree is back
to its pre-probe state.

## Other checks performed (all otherwise clean — recorded for completeness)

1. **`apps/web/src/auth/__tests__/react.test.tsx` byte-unchanged.**
   `git diff HEAD -- apps/web/src/auth/__tests__/react.test.tsx` is empty. Confirmed.
   Running it standalone: 65/65 tests pass.

2. **Cold entry still redirects on the real path.** `react.tsx`'s diff only touches the
   `client` and `tokenCache` `useMemo` bodies inside `HubAuthProvider`; the login
   effect, `setActive`, and `HubProtected` are untouched. The dev-specific test
   `signs the operator in without ever calling login, so cold entry never redirects to
   a Hub that is not there` passes, and the ordinary (non-dev) cold-entry redirect
   tests inside the byte-unchanged `react.test.tsx` still pass (65/65).

3. **`setActive` not reimplemented.** The one copy of the four-statement critical
   section lives at `apps/web/src/auth/react.tsx:626` (`const setActive = useCallback(...)`)
   and is unchanged by the diff. The dev stand-in's `client.setActive` in
   `install-dev-identity.ts` only mints a token for a new `organizationId` and returns
   it; it performs no cache flush, no navigation, and is invoked *by* the one real
   `setActive`, never duplicating it. `switchDevIdentity` (the identity switcher's own
   write path) deliberately does a full `window.location.reload()` rather than any
   live swap, exactly to avoid a second copy of that critical section.

4. **Production unreachability.**
   - `pnpm run build` (root) succeeds.
   - Scanned every real `.js` chunk under `apps/web/dist/assets/*.js` (excluding
     `.map` files) for `auth-fake`, `dev-identity`, `DEV_FAKE_ROSTER`,
     `VITE_AUTH_FAKE`, `installDevIdentity`, `mountDevIdentitySwitcher` — **zero
     matches** in any shipped `.js` file. The roster sentinel string only appears in
     `index-*.js.map` (a debugging sourcemap, not shipped/executed code, and not
     the shipped bundle the acceptance criterion is about).
   - `import.meta.env.DEV` is checked before the dynamic import in source order in
     `main.tsx` (`if (import.meta.env.DEV) { const { installDevIdentityIfEnabled } =
     await import('./dev/install-dev-identity'); ... }`), and again inside
     `install-dev-identity.ts` via the module-scope `DEV_IDENTITY_ENABLED` constant
     read before the dynamic import of `@fxl-sales/auth-fake`.
   - `apps/web/src/dev/__tests__/dev-identity-isolation.test.ts` is a real
     source-scanning oracle (reads files off disk, not `git grep`) and passes; it
     specifically asserts the dynamic-import-only shape and that no file outside
     `src/dev` names the package.

5. **No static import of `@fxl-sales/auth-fake` in shipped source.** Grepped all of
   `apps/web/src` (`.ts`/`.tsx`): the only executable reference is
   `apps/web/src/dev/install-dev-identity.ts:213`,
   `const fake = (await import('@fxl-sales/auth-fake')) as unknown as FakeAuthModule;`
   — a dynamic import. `dev-identity-registry.ts` only mentions the package name in a
   comment, never in code. `react.tsx` names only `../dev/dev-identity-registry`
   (confirmed absent of the package name, `install-dev-identity`, or
   `dev-identity-switcher` strings).

6. **UI-control ban.** No `<select>`, `<option>`, `<datalist>`, and no
   `document.createElement('select'|'option'|'datalist')` anywhere under
   `apps/web/src/dev`, `react.tsx`, or `main.tsx` — checked by direct grep of source,
   not lint. `dev-identity-switcher.ts` builds its list rows and search input with
   plain `div`/`button`/`input` elements only.

7. **Dev dependency placement.** `@fxl-sales/auth-fake` is declared under
   `apps/web/package.json`'s `devDependencies`, not `dependencies`. Confirmed by
   parsing the JSON directly.

8. **No em dash / en dash in added lines.** Checked the diffs of `react.tsx`,
   `main.tsx`, and all files under the new `apps/web/src/dev/` tree — none found.

## Commands run and their real output

1. `pnpm --filter @fxl-sales/web test` → **75 files / 939 tests passed.**
2. `pnpm run lint` (root) → clean, all workspaces (`apps/api`, `apps/web` via eslint;
   the three `packages/*` have no lint script and no-op).
3. `pnpm run type-check` (root) → clean across `packages/auth-fake`,
   `packages/shared-types`, `packages/shared-utils`, `apps/web`, `apps/api`.
4. `pnpm run build` (root) → succeeds; `apps/api` (`tsc && tsc-alias`) and `apps/web`
   (`tsc --noEmit && vite build`) both build clean. Dead-code-elimination evidence
   captured in point 4 above.
5. `pnpm test` (root, full suite) → exit code 0. Breakdown:
   `packages/shared-utils` 80/80, `packages/auth-fake` 35/35, `apps/api` 542/542
   passed, `apps/web` 939/939, plus the local-database-guard/no-legacy-env-names
   node:test suite (21/21) and the tracked-file build-contract check (`ok`).

## Flake characterization (data collection only, not a PASS/FAIL factor)

`apps/web/src/sales-ops/leads/__tests__/leads-board-keyboard.test.tsx` run in
isolation 5 times via `npx vitest run <file>`:

- Run 1: 12/12 passed.
- Run 2: 12/12 passed.
- Run 3: 12/12 passed.
- Run 4: 12/12 passed.
- Run 5: 12/12 passed.

**0 failures in 5 runs.** No failing assertion text to report. This file is unrelated
to the leads Kanban feature's own auth path and shares no module, mock, or global
state with anything this slice touched (`apps/web/src/dev/**`, `auth/react.tsx`'s two
`useMemo` bodies, `main.tsx`'s bootstrap). The dev seam only activates behind
`import.meta.env.DEV && VITE_AUTH_FAKE`, which the leads-board-keyboard test suite
does not set, and `getDevIdentitySession()` answers `null` unless a session was
explicitly installed via `setDevIdentitySession`, which no leads test calls. This
slice's diff cannot be the cause of that flake; it is environmental/timing (as its
"failed once, passed on rerun" report already suggests) and out of scope here.

## Files inspected (absolute paths)

- `/Users/cauetpinciara/Documents/fxl/projects/06--PRODUCT--fxl-sales/.worktrees/20260921T141216Z-dev-fake-identity-switch/run/apps/web/src/dev/dev-identity-registry.ts`
- `/Users/cauetpinciara/Documents/fxl/projects/06--PRODUCT--fxl-sales/.worktrees/20260921T141216Z-dev-fake-identity-switch/run/apps/web/src/dev/install-dev-identity.ts`
- `/Users/cauetpinciara/Documents/fxl/projects/06--PRODUCT--fxl-sales/.worktrees/20260921T141216Z-dev-fake-identity-switch/run/apps/web/src/dev/dev-identity-switcher.ts`
- `/Users/cauetpinciara/Documents/fxl/projects/06--PRODUCT--fxl-sales/.worktrees/20260921T141216Z-dev-fake-identity-switch/run/apps/web/src/dev/__tests__/dev-identity-roles.test.tsx` (the decorative cross-check)
- `/Users/cauetpinciara/Documents/fxl/projects/06--PRODUCT--fxl-sales/.worktrees/20260921T141216Z-dev-fake-identity-switch/run/apps/web/src/dev/__tests__/dev-identity-isolation.test.ts`
- `/Users/cauetpinciara/Documents/fxl/projects/06--PRODUCT--fxl-sales/.worktrees/20260921T141216Z-dev-fake-identity-switch/run/apps/web/src/dev/__tests__/dev-identity-switcher.test.ts`
- `/Users/cauetpinciara/Documents/fxl/projects/06--PRODUCT--fxl-sales/.worktrees/20260921T141216Z-dev-fake-identity-switch/run/apps/web/src/auth/react.tsx`
- `/Users/cauetpinciara/Documents/fxl/projects/06--PRODUCT--fxl-sales/.worktrees/20260921T141216Z-dev-fake-identity-switch/run/apps/web/src/main.tsx`
- `/Users/cauetpinciara/Documents/fxl/projects/06--PRODUCT--fxl-sales/.worktrees/20260921T141216Z-dev-fake-identity-switch/run/packages/auth-fake/src/index.ts`
- `/Users/cauetpinciara/Documents/fxl/projects/06--PRODUCT--fxl-sales/.worktrees/20260921T141216Z-dev-fake-identity-switch/run/packages/auth-fake/src/__tests__/roster.test.ts`

## What would fix this (for the execute agent, not done here)

The `REACHABLE_CASES.expected` strings need to be derived from
`identity.expectedRoles`/`identity.expectedPaineis` (imported from
`@fxl-sales/auth-fake`) rather than hand-typed, e.g. build the table from
`fake.IDENTITIES` directly and assert
`getVisibleWorkspaces(getRolesFromHubClaims(claims)).toEqual(identity.expectedPaineis)`.
That would make the roster's declared field the thing under test, so a wrong
declaration in `packages/auth-fake/src/index.ts` fails exactly this file.
