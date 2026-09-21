# Verify report: slice 03-web-dev-identity (attempt 2)

Verdict: **PASS**

## The defect from attempt 1, re-tested from scratch

Attempt 1 failed because `dev-identity-roles.test.tsx`'s `REACHABLE_CASES` table
hardcoded its own expected strings per identity id, never reading
`identity.expectedRoles` / `identity.expectedPaineis` off the roster, so mutating the
roster's declared fields could never turn the test red.

The current file replaces that table with:

```ts
const REACHABLE_IDENTITIES = fakeRoster.IDENTITIES.filter((identity) => identity.hasAccess);

it.each(REACHABLE_IDENTITIES)('... ($id) ...', async (identity) => {
  ...
  expect(workspacesText(host)).toBe(identity.expectedPaineis.join(','));
  ...
  expect(getRolesFromHubClaims(claims)).toEqual([...identity.expectedRoles]);
  ...
});
```

Both assertions read the identity's own declared fields directly, at test-execution
time, off the live `fakeRoster.IDENTITIES` import. There is no parallel hand-typed
table anywhere in the file.

I did not take this on trust. I ran both required probes myself, independently, before
reading any prior verifier's conclusion in detail.

**Probe A** - mutated the `seller` identity's `expectedPaineis` in
`packages/auth-fake/src/index.ts` from `['meus-dados']` to `['tatico']`, then ran
`pnpm --filter @fxl-sales/web exec vitest run src/dev/__tests__/dev-identity-roles.test.tsx`.

Result: **RED**, exactly on that identity's case:
```
FAIL ... ('seller') ...
AssertionError: expected 'meus-dados' to be 'tatico'
```
Reverted with `git checkout -- packages/auth-fake/src/index.ts`.

**Probe B** - mutated the same identity's `expectedRoles` from `['seller']` to
`['finder']`, ran the same command.

Result: **RED**, exactly on that identity's case, on the second assertion:
```
FAIL ... ('seller') ...
AssertionError: expected [ 'seller' ] to deeply equal [ 'finder' ]
```
(The `workspacesText`/`expectedPaineis` assertion still passed here, as expected,
since only `expectedRoles` was mutated and `getVisibleWorkspaces(['seller'])` and
`getVisibleWorkspaces(['finder'])` both yield `meus-dados` - which is itself evidence
the two assertions are independently wired to their respective declared fields rather
than one covering for the other.)
Reverted with `git checkout -- packages/auth-fake/src/index.ts`.

**Post-probe integrity check:** `git diff -- packages/auth-fake/src/index.ts` is empty
after each revert, and a byte `diff` against a pre-probe copy of the file confirms it
is IDENTICAL to the original. `dev-identity-roles.test.tsx` was re-run clean afterward:
13/13 tests passed.

## Shape judgment, not just behaviour

`REACHABLE_IDENTITIES` is derived by filtering the real, live-imported
`fakeRoster.IDENTITIES` array (`await import('@fxl-sales/auth-fake')`) on the roster's
own `hasAccess` field - it is not a second authored list of ids or expected strings.
The `it.each` case name interpolates `$id` from the same object. Both assertions in
the loop body read `identity.expectedPaineis` / `identity.expectedRoles` directly, not
a re-derived or re-typed value. This is a genuine derive-from-the-source-of-truth
fix, not a hardcoded table wearing a different hat.

**Identity count covered:** 9 identities total in the roster
(`team-owner`, `team-admin`, `product-admin`, `seller`, `finder`, `seller-finder`,
`no-role`, `no-access`, `multi-org`). The `it.each` loop covers **8** of them - every
identity with `hasAccess: true`. The one exclusion, `no-access`, is documented in the
test file's own comment: its Organization has no access, so `requireHubAuth` answers
402 and `Protected` renders `MissingEntitlementPanel` instead of `Probe`, meaning
`workspacesText` would read `undefined` rather than the identity's declared
`expectedPaineis` - a different, already-covered behaviour, not a gap in this
cross-check. This exclusion is principled (tied to real, distinct app behaviour) and
was already the same exclusion attempt 1's implementation used - it is not new
narrowing introduced to make the fix pass; the actual defect fixed here (the missing
comparison against declared fields) is orthogonal to which identities are iterated.
No previously-covered identity dropped out: the 8-case coverage set observed by
running the suite matches team-owner/team-admin/product-admin/seller/finder/
seller-finder/no-role/multi-org exactly.

## Everything else re-checked (not regressed)

1. **`apps/web/src/auth/__tests__/react.test.tsx` byte-unchanged.**
   `git diff HEAD -- apps/web/src/auth/__tests__/react.test.tsx | wc -l` → `0`.

2. **Cold entry still redirects on the real path.** `react.tsx`'s diff is scoped to
   the `client` and `tokenCache` `useMemo` bodies; `HubProtected`'s login effect and
   the ordinary (non-dev) redirect path are untouched by this diff, and the
   byte-unchanged `react.test.tsx` suite (65 tests) is part of the 940/940 green
   `apps/web` run below.

3. **`setActive` has exactly one copy.** `apps/web/src/auth/react.tsx:626` -
   `const setActive = useCallback(...)` - is the only implementation of the
   four-statement critical section. `apps/web/src/dev/install-dev-identity.ts`'s
   `client.setActive(organizationId)` (line ~144) only mints a token for the
   requested organization and returns it; it performs no query-cache flush and no
   navigation, and is invoked BY the one real `setActive`, never duplicating it.

4. **Production build clean of the dev seam.** `pnpm run build` (root) succeeded.
   Grepped every real `apps/web/dist/assets/*.js` chunk (all of them, not a sample)
   for `auth-fake`, `dev-identity`, `DEV_FAKE_ROSTER`, `VITE_AUTH_FAKE`,
   `installDevIdentity`, `mountDevIdentitySwitcher`, and the roster sentinel string
   `FXL_SALES_DEV_FAKE_ROSTER_SENTINEL` - zero matches in any shipped `.js` file.
   `apps/web/src/main.tsx` checks `import.meta.env.DEV` BEFORE the dynamic
   `import('./dev/install-dev-identity')` in source order (the `if` wraps the
   `await import(...)` call).

5. **Exactly one shipped file names `@fxl-sales/auth-fake`, only inside a dynamic
   import.** Grepped all executable (non-comment) references under `apps/web/src`:
   the only one is `apps/web/src/dev/install-dev-identity.ts:213` -
   `const fake = (await import('@fxl-sales/auth-fake')) as unknown as FakeAuthModule;`
   - a dynamic import, no static import, no type-only import of the package.
   `dev-identity-registry.ts` mentions the package name only inside a doc comment
   explaining that it deliberately does NOT reference it; that file imports nothing
   at runtime beyond two `import type`s from `@fxl-business/hub-sdk/client` and
   `../auth/refresh`. The two test files under `src/dev/__tests__/` also name the
   package (test files are not shipped). `package.json` lists it as a
   `devDependency` name (see point 7), which is package metadata, not shipped
   source.

6. **UI-control ban.** No `<select>`, `<option>`, `<datalist>`, and no
   `document.createElement('select'|...)` anywhere in `apps/web/src/dev`,
   `react.tsx`, or `main.tsx` - confirmed by direct grep.

7. **Dev-dependency placement.** `apps/web/package.json` lists
   `"@fxl-sales/auth-fake": "workspace:*"` under `"devDependencies"`, not
   `"dependencies"`.

8. **No em dash / en dash in added lines.** Checked the diffs of `react.tsx`,
   `main.tsx`, `apps/web/package.json`, and grepped every file under the new
   `apps/web/src/dev/` tree plus `packages/auth-fake/src/index.ts` for U+2014/U+2013
   - none found.

## Commands run and their real output

1. `pnpm --filter @fxl-sales/web test` → **75 files / 940 tests passed.**
2. `pnpm run lint` (root) → clean (`apps/web` and `apps/api` via eslint; the three
   `packages/*` have no lint script and no-op by design).
3. `pnpm run type-check` (root) → clean across `packages/auth-fake`,
   `packages/shared-types`, `packages/shared-utils`, `apps/web`, `apps/api`.
4. `pnpm run build` (root) → succeeds; `packages/shared-types`,
   `packages/shared-utils` build, `apps/api` (`tsc && tsc-alias`) and `apps/web`
   (`tsc --noEmit && vite build`) both build clean, 1853 modules transformed.
5. `pnpm test` (root, full suite) → **exit code 0.** Breakdown:
   `packages/shared-utils` 80/80, `packages/auth-fake` 35/35, `apps/api` 542/542,
   `apps/web` 75 files / 940/940, plus the local-database-guard /
   no-legacy-env-names `node:test` suite (21/21 `ok`), plus `build-contract: ok`.

## Tree left as found

No commit, stage, or stash performed. Both probe mutations were reverted; final
`git status --short` matches the pre-verify snapshot exactly (same 6 modified
tracked files, same 5 untracked entries under `apps/web/src/dev/` and
`nexo/runs/.../agents/` plus the attempt-1 report file). `apps/web/dist` is
gitignored and does not appear in `git status`.
