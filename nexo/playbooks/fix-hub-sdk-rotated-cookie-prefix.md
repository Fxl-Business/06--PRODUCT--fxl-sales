# Prompt to run in `16--INTERNAL--fxl-hub`

Written 2026-08-13 from `06--PRODUCT--fxl-sales`, run
`feature-20260812-session-survives-one-refresh`.
Copy everything below the line into a fresh agent session whose working directory is
`/Users/cauetpinciara/Documents/fxl/projects/16--INTERNAL--fxl-hub`.

The FXL Sales side is already fixed and does not depend on this.
Sales ships a local wrapper that works around the defect, and it is written to stay correct and
inert once this lands.
What this prompt fixes is the defect itself, for every other consumer.

---

/nexo --quick --discuss

`@fxl-business/hub-sdk` silently drops the rotated refresh token on every backchannel refresh when
the Hub is running in production mode, which logs every user of a split-origin consumer out roughly
every one to three minutes.
This was measured in production against FXL Sales on 2026-08-12 and traced to this repository.

## The defect

`packages/hub-sdk/src/server.ts` recovers the rotated refresh token from the Hub's response with:

```ts
function parseRotatedRefresh(setCookieHeader: string | null): string | undefined {
  if (!setCookieHeader) return undefined;
  const match = /(?:^|[,\s])fxl_hub_session=([^;]+)/.exec(setCookieHeader);
  return match?.[1];
}
```

called from BOTH `POST /auth/refresh` and `POST /auth/switch` as:

```ts
const rotated = parseRotatedRefresh(res.headers.get("set-cookie"));
if (rotated) await tx.update({ ...record, hubRefreshToken: rotated });
```

But this repo's own auth service names that cookie `__Host-fxl_hub_session` whenever it runs with
`NODE_ENV = production` (`apps/auth/src/cookies.ts`, `sessionCookieName()`), and
`apps/auth/Dockerfile` pins `ENV NODE_ENV=production`.
So in every real deployment the response header is `__Host-fxl_hub_session=...`, the cookie name is
preceded by `-`, which is neither `^` nor `[,\s]`, the regex cannot match, `rotated` is `undefined`,
`tx.update()` is NEVER CALLED, and the consumer's session store silently keeps the refresh token
that was just spent.
The BFF still answers `200`, so nothing anywhere reports a problem.

`rotateSession` in `packages/hub-db/src/repo.ts` forgives exactly ONE stale generation, for
`HUB_SESSION_GRACE_SECONDS` (default 60).
Because the consumer keeps replaying the same original token it falls further behind on every
cycle, so the first replay is forgiven and the second trips `reuse_detected`, at which point the
whole token family is revoked and the user is signed out.
Against a 120-second access token (`packages/shared-types/src/hub/constants.ts`) renewed at
`exp - 60s`, that is a dead session every one to three minutes, for every user.

## Why no test caught it

`packages/hub-sdk/src/__tests__/bff-prod-mode.test.ts` is the prod-mode test, and it mocks the Hub
returning the UNPREFIXED `fxl_hub_session=` name.
So the one test whose whole purpose is production behaviour asserts against a response production
never produces.
That is the actual root cause of the outage and it matters more than the regex.

## What I want

1. **Fix `parseRotatedRefresh`.** Accept both names, and read the header per cookie rather than from
   the single joined value:
   - the pattern needs to allow the optional `__Host-` prefix, along the lines of
     `(?:^|[,\s])(?:__Host-)?fxl_hub_session=([^;]+)`
   - prefer iterating `res.headers.getSetCookie()` over `res.headers.get("set-cookie")`. The joined
     form is ambiguous because an `Expires=Wed, 21 Oct 2026 ...` attribute embeds a comma. Node 18.14
     and newer expose `getSetCookie`; decide and state the floor you are targeting, and do NOT add a
     fallback that silently yields "no cookies", because that reinstates this exact defect invisibly.
   - it is called from two places. Fix both, and check whether anything else in the package parses
     that header.
2. **Fix the test gap, which is the more important half.** `bff-prod-mode.test.ts` must exercise the
   name the Hub ACTUALLY sends in production. Add coverage that would have failed before your change:
   - the rotated token is persisted when the Hub returns `__Host-fxl_hub_session`
   - the same for `/auth/switch`, not just `/auth/refresh`
   - the unprefixed name still works, so local development does not regress
   - a response carrying several `Set-Cookie` headers, at least one with a comma in an `Expires`
     attribute, so the per-cookie reading is genuinely exercised
   Then prove the tests are not vacuous: revert the `parseRotatedRefresh` change, confirm the new
   tests go red for the right reason, and restore. Show me that red output.
3. **Consider making this class of bug impossible.** The request and the response disagree about the
   cookie name today: `BACKCHANNEL_COOKIE_NAME = SESSION_COOKIE` sends the unprefixed name while the
   server replies with the prefixed one. There is a `SESSION_COOKIE_SECURE` constant already sitting
   in `server.ts` that nothing in the parse path uses. Have a look at whether one shared helper
   should own "is this our session cookie, under either name" so a third spelling cannot drift in.
   Your call, but say what you decided and why.
4. **Version and publish.** This is a patch-level bug fix, so `1.3.2`. Follow this repo's normal
   release flow. Note that `1.3.0` shipped broken packaging (`main`/`types`/`exports` pointed at
   `./src/*.ts` while `files` was `["dist","schema","MIGRATION.md"]`) and `1.3.1` was the repackage,
   so double check the published tarball actually resolves before calling it done.
5. **Say so in `MIGRATION.md`.** Consumers need to know this was silently losing rotations, because
   anyone who wrote a workaround wants to know they can remove it.

## Blast radius, worth checking before you scope it

Any consumer of this SDK whose web app and API are on different hosts is hitting this right now.
FXL Sales was, and its users were being signed out every couple of minutes.
Please check which other products consume `@fxl-business/hub-sdk` and whether they are deployed
split-origin, and tell me what you find. If any are, they are broken in production today.

## Context you may want

FXL Sales shipped `apps/api/src/auth/hub-rotated-cookie.ts`, which wraps `createHubBff`'s
`fetchImpl` and renames the cookie before the SDK parses it. It is a workaround, not a fix, and it
should be deleted once `1.3.2` is out. Its own non-vacuity test going red is the signal that the
SDK no longer needs it. You do not need to read it, but it is a working reference for the behaviour
you are restoring.

Do not change the Hub's cookie naming to fix this. `__Host-` is a real security attribute and the
prefix is correct; the SDK is what is wrong.
