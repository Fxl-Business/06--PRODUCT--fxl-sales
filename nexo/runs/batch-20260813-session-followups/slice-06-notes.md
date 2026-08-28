# Slice 06 - close the verifier follow-ups

Four unrelated follow-ups filed by the Gate 2 verifiers, landed as four atomic commits on
`fix/06-close-the-verifier-follow-ups`.
Six files changed in total, exactly the six the plan lists in `files_modified`.

| commit | item |
| --- | --- |
| `3d82516` | 1 - delete `RoleRouter` |
| `c76b226` | 2 - case-insensitive `/auth` refusal |
| `115bbb4` | 3 - comment the unprefixed-cookie test |
| `e2f0507` | 4 - make the journey test's headline scenario able to fail |

## Item 1 - `chore(auth): delete the dead RoleRouter ...`

Deleted `RoleRouter` from `apps/web/src/components/auth/RoleGuard.tsx` and rewrote the `NoRolePage`
docstring so it no longer names it.

**Check before deleting.**
`git grep -n "RoleRouter" -- ':!*dist*'` found exactly two hits in application source: the
declaration itself, and the prose line in `apps/web/src/pages/errors/NoRolePage.tsx:6`.
No barrel file, no lazy import, no test, and no route table references it.
The remaining hits are `CLAUDE.md`, `nexo/ROADMAP.md` and four `nexo/` plan or run documents, all of
them prose.

The new docstring names the two navigators that really do send an operator to `/no-role` today,
`RoleGuard` for a legacy `/admin/*`, `/finder/*` or `/seller/*` URL and `SalesOpsApp` for an empty
`getVisibleWorkspaces(roles)`, plus `NoRoleGuard` as the way back out.
It also drops the stale `publicMetadata.role` phrasing, which belongs to the removed legacy auth
provider and is language this product has not used since the Hub migration.

`RoleGuard` and `NoRoleGuard` are byte-unchanged; the whole diff in that file is one removed hunk.
`Navigate` and `Skeleton` are both still used by the two surviving components, so no import changed.

## Item 2 - `fix(auth): compare sanitizeReturnTo's /auth refusal case-insensitively`

`apps/web/src/auth/session-recovery.ts` now lowercases `url.pathname` once and compares the
lowercased value, matching `isTerminalAuthRoute` directly beneath it instead of disagreeing with it
one line away.
`toLowerCase` and not `toLocaleLowerCase`, for the reason that function already states: the
comparison must not depend on the operator's locale.
Docstring check 6 records that it is now case-insensitive "exactly as check 8 compares", and an
inline comment records the property that makes the change obviously safe, which is that lowercasing
can only ever make this branch reject MORE inputs and never fewer, so it cannot open a redirect that
was previously closed.

**Before.**
The three new rejection cases were added to `REJECTED_RETURN_TO` first and run against the unchanged
source:

```
FAIL  rejects "/Auth/login"     AssertionError: expected '/Auth/login' to be null
FAIL  rejects "/AUTH"           AssertionError: expected '/AUTH' to be null
FAIL  rejects "/aUtH/callback"  AssertionError: expected '/aUtH/callback' to be null
Tests  3 failed | 65 passed (68)
```

All three were returned verbatim, so all three would have been restored as a `returnTo`.

**After.**

```
✓ src/auth/__tests__/session-recovery.test.ts (68 tests)
Tests  68 passed (68)
```

The lowercase `/auth` and `/auth/login` cases were already in the rejection table and still pass, and
the `never returns a value that resolves off-origin` property test runs over the whole enlarged
corpus.
Nothing moved from the accepted table to the rejected one, which is the concrete form of "rejects
more, never less".

## Item 3 - `docs(auth): record why the unprefixed-cookie test goes red ...`

A comment only, inside
`still persists the rotated refresh token when the Hub sends the unprefixed fxl_hub_session` in
`apps/api/src/middleware/__tests__/app-auth-bff-wiring.test.ts`.

It records that deleting `fetchImpl` from `app-auth.ts` also turns this test red, that this is a
harness artifact rather than evidence local development needs the wrapper, and why: `createHubBff`
binds `options.fetchImpl ?? fetch` once at construction, construction happened in `beforeAll` at
line 137, and `stubHub`'s `vi.stubGlobal('fetch', impl)` therefore never reaches the SDK, so the
request escapes to whatever `FXL_HUB_API_URL` points at and no rotation is ever seen.
It closes by pointing at the `__Host-` case as the real oracle.

Verified comment-only: `git diff --stat` reports `15 +++++++++++++++`, and
`git diff | grep -c "^-[^-]"` reports `0` removed lines.
No assertion, name or behaviour changed.
The suite stayed at 22 of 22.

## Item 4 - `test(auth): let the journey test's headline scenario actually fail`

Scenario 1 of `apps/web/src/__tests__/session-journey.test.tsx` entered at `/tatico/dashboard`,
which is also the admin default landing route, so it could not distinguish the behaviour it is named
after from the fallback.

Two changes.
It now enters at `/operacional/vendas`, a route the default landing can never produce, so the three
possible endings are all different strings: a restore arrives at the captured route, a deleted
restore falls through to `/tatico/dashboard`, and a login that never took hold stays at `/`.
And the returnTo assertion is now paired with the URL it had to produce, as one `toEqual` over
`{ slot, url }` against `{ slot: null, url: captured }`, where `captured` is read out of the slot
before the round trip.
An empty slot alone proves only that something consumed it, since `consumeReturnTo` destroys before
it validates; tying the empty slot to a URL that could only have come from that same value is what
separates a consumed-and-navigated slot from a merely consumed one.

Scenarios 2 and 3 are untouched, as required.
`/operacional/vendas` was chosen rather than `/cadastros/produtos` so the file does not gain two
scenarios driving the identical route; scenario 2 keeps `/cadastros/produtos` because its comment is
specifically about the `resolution.redirect` rewrite on that path.

**The probe, before the fix.**
This is the slice 05 verifier's finding, restated: neutering only the restore navigation left
scenario 1 green while scenarios 2 and 3 went red.

**The probe, after the fix.**
`apps/web/src/auth/react.tsx:726` was changed from

```ts
    if (target && target !== currentPath) navigate(target, { replace: true });
```

to

```ts
    // TEMPORARY PROBE - restore navigation neutered, consume left in place.
    void target;
```

so the `consumeReturnTo(currentOrigin())` call on the line above still runs and still empties the
slot, and only the navigation is gone.
Result:

```
❯ src/__tests__/session-journey.test.tsx (6 tests | 3 failed) 83ms
   → expected '/tatico/dashboard' to be '/operacional/vendas'
   → expected '/tatico/dashboard' to be '/cadastros/produtos'
   → expected '/tatico/dashboard' to be '/cadastros/produtos'

FAIL  ... > returns the operator to the route they were on after a lost session and a successful login
AssertionError: expected '/tatico/dashboard' to be '/operacional/vendas'
Expected: "/operacional/vendas"
Received: "/tatico/dashboard"
❯ src/__tests__/session-journey.test.tsx:444:37

FAIL  ... > returns the operator to a non-tatico route, where the second guard is load-bearing
❯ src/__tests__/session-journey.test.tsx:476:37

FAIL  ... > consumes the returnTo exactly once, so a later mount cannot replay it
❯ src/__tests__/session-journey.test.tsx:490:41

Tests  3 failed | 3 passed (6)
```

Scenario 1 is now the FIRST of the three to fail, at line 444, which is the
`expect(locationText(next.host)).toBe(captured)` assertion.
Before the fix it was the one that stayed green under this exact probe.

**`react.tsx` restored byte-exactly.**
`git hash-object apps/web/src/auth/react.tsx` was `5aea3b240bd42449bd5b5e3b87c19fa0c7e1ec0d` before
the probe and is `5aea3b240bd42449bd5b5e3b87c19fa0c7e1ec0d` after `git checkout --`.
`git status --short` afterwards showed only the intended
`M apps/web/src/__tests__/session-journey.test.tsx`, plus the pre-existing
`M nexo/runs/batch-20260813-session-followups/budget.json` and the untracked `?? .vscode/`, neither
of which this slice created or touched.

## Gate

All run once, no watchers.

| command | result |
| --- | --- |
| `pnpm --filter @fxl-sales/web exec vitest run src/auth/__tests__/session-recovery.test.ts` | 68 passed (68) |
| `pnpm --filter @fxl-sales/web exec vitest run src/__tests__/session-journey.test.tsx` | 6 passed (6) |
| `pnpm --filter @fxl-sales/web test` | 52 files, 718 passed (718) |
| `pnpm --filter @fxl-sales/api test` | 41 files, 415 passed (415) |
| `pnpm run lint` | clean, api and web |
| `pnpm run type-check` | clean, all four projects |

No em dash character appears in any of the four diffs; each was grepped for it before committing.
No process was left running.

## Disagreement with the plan

None on substance.
Two observations for the verifier, neither of which changes what this slice did.

First, `CLAUDE.md:194` still says `RoleGuard` and `RoleRouter` are byte-unchanged, in the paragraph
describing the slice 04 `/no-role` exception.
That sentence is a historical statement about that slice's diff rather than a live invariant, but it
now names a component that no longer exists, so it reads as stale.
The slice brief forbids editing `CLAUDE.md`, so it was left alone; flagging it so whoever writes the
next doc pass can drop the `and RoleRouter` clause.

Second, `nexo/ROADMAP.md:45` carries this same `RoleRouter` chore as an open item.
It is now done, but the brief forbids editing that file too, so it was left for the capture step.
