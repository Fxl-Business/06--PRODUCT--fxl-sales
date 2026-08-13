---
id: 06-close-the-verifier-follow-ups
milestone: v2.8.0
status: todo
depends_on: []
files_modified:
  - apps/web/src/components/auth/RoleGuard.tsx
  - apps/web/src/pages/errors/NoRolePage.tsx
  - apps/web/src/auth/session-recovery.ts
  - apps/web/src/auth/__tests__/session-recovery.test.ts
  - apps/api/src/middleware/__tests__/app-auth-bff-wiring.test.ts
acceptance: "given the three small follow-ups the verifiers filed, when this slice lands, then RoleRouter is gone, sanitizeReturnTo's /auth check is case-insensitive like its sibling, and the unprefixed-cookie test records why it goes red under the fetchImpl probe"
goal: Close the three small follow-ups the Gate 2 verifiers filed, each as its own atomic commit.
must_not_break:
  - RoleGuard and NoRoleGuard, which stay exactly as they are
  - every existing sanitizeReturnTo assertion, especially the off-origin and dot-segment families
  - the api wiring suite, which must stay green with only a comment added
rules:
  - three atomic commits, one per item, never one combined commit
  - no em dashes anywhere
verifier_focus: that the case-insensitive /auth check only ever rejects MORE than before and cannot open a redirect it previously closed
---

# 06 - Close the verifier follow-ups

Three unrelated small items, filed by the Gate 2 verifiers during
`feature-20260812-session-survives-one-refresh`. They are grouped because each is a few lines, but
they are independent and must land as THREE atomic commits, not one.

## Item 1 - delete `RoleRouter`

`RoleRouter` in `apps/web/src/components/auth/RoleGuard.tsx` is dead code. It is referenced from
nowhere in the application; the only surviving mention is prose in the `NoRolePage` docstring.
Confirmed with a repo-wide search: the sole hit outside its own definition is
`apps/web/src/pages/errors/NoRolePage.tsx:6`.

It reads as though it is the `/` root redirect, which it is not: `/` is `SalesOpsApp` wrapped in
`Protected`, and `SalesOpsApp` resolves the default workspace itself. Leaving a plausible-looking
but unreachable router in the same file as two live guards is a trap for the next reader.

Delete the component. Update the `NoRolePage` docstring so it no longer names it, and so it
describes what actually sends an operator there now, which is `RoleGuard` and `SalesOpsApp`. Do not
touch `RoleGuard` or `NoRoleGuard`.

Check before you delete: confirm for yourself that nothing imports it, including any barrel file or
lazy import, and that no test references it. If you find a live reference, STOP and report it.

## Item 2 - make the `/auth` check case-insensitive

`apps/web/src/auth/session-recovery.ts:195` is:

```ts
if (url.pathname === '/auth' || url.pathname.startsWith('/auth/')) return null;
```

so `/Auth/login` walks straight past it, while `isTerminalAuthRoute` added directly beneath is
deliberately case-INSENSITIVE because React Router matches that way.

Two guards in one function using different case semantics is the kind of asymmetry that becomes a
real bug when someone copies one of them. The practical impact today is small, since `/auth/*` is a
BFF proxy target rather than a React route, so the cost is one wasted navigation rather than a
security hole.

Make it case-insensitive, matching its sibling. Use `toLowerCase` and not `toLocaleLowerCase`, for
the same reason stated in the `isTerminalAuthRoute` comment: this comparison must not depend on the
operator's locale.

This change can only ever REJECT MORE than before, never less, so it cannot open a redirect that was
previously closed. Say so in a short comment, because that is the property that makes it obviously
safe.

Add assertions to `apps/web/src/auth/__tests__/session-recovery.test.ts` in the existing style:
`/Auth/login`, `/AUTH`, and `/aUtH/callback` are rejected, and confirm the existing lowercase `/auth`
cases still pass. State which of these fail before your change.

## Item 3 - comment the unprefixed-cookie test

In `apps/api/src/middleware/__tests__/app-auth-bff-wiring.test.ts`, the test that pins the
UNPREFIXED `fxl_hub_session` rotation goes red when `fetchImpl` is removed from `app-auth.ts`.

That is a HARNESS artifact, not a real dependency: without the wrapper, `createHubBff` binds
`options.fetchImpl ?? fetch` once at construction, so the test's later `vi.stubGlobal('fetch', ...)`
never reaches it and the request escapes to whatever is on `FXL_HUB_API_URL`. Local development does
NOT depend on the rotated-cookie wrapper.

Two separate reviewers had to re-derive that from scratch, which is the definition of a comment
worth writing. Add one to that test explaining it. Comment only. No assertion, no name, no behaviour
may change, and the suite must stay green with a pure comment diff.

## Commands

```
pnpm --filter @fxl-sales/web exec vitest run src/auth/__tests__/session-recovery.test.ts
pnpm --filter @fxl-sales/web test
pnpm --filter @fxl-sales/api test
pnpm run lint
pnpm run type-check
```
