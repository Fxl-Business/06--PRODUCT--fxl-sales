---
slice: 04-sdk-230-bump
wave: 1
files_modified:
  - apps/api/package.json
  - apps/web/package.json
  - pnpm-lock.yaml
---

# 04 - Bump to 2.3.0, no behaviour change

## What

`@fxl-business/hub-sdk` from `2.2.0` to `2.3.0`, EXACT and with no caret, in BOTH
`apps/api/package.json` and `apps/web/package.json`, lockfile in the same commit.

The exact pin is the only spelling that survives an unrelated `pnpm install`, and
`@fxl-business/hub-sdk-testing` peer-requires the SDK at an exact version. If that twin is a
dependency anywhere in this repo it moves to `2.3.0` in the SAME commit or the install fails.
Check before assuming: the prep run believed it was not a dependency here, and that belief was never
verified.

## Why this is a separate slice from the migration

2.3.0's four new `HubConfig` fields are all OPTIONAL on the interface, and the SDK's own type
comment says why: *"optional on the interface only so a literal written against 2.2.x keeps
compiling"*. So the bump alone must be behaviour-neutral and the trunk must stay green with the
existing code untouched. If it is not green, that is a finding, and it belongs to this slice rather
than being discovered tangled up in the migration.

`hono`'s peer range is unchanged at `>=4.12.28`, verified against the published metadata, so the
`pnpm-workspace.yaml` override does NOT move. Do not touch it.

## Do NOT

Do not adopt any new API here. No `assertBootConfiguration`, no `config.redirectUri`, no
`config.trustedOrigins`. This slice changes two version strings and a lockfile.

## Locked oracles

1. `CI=true pnpm test` green with the SAME counts as the pre-bump baseline (shared-utils 80,
   api 428, web 784, guard oracles 11). A count that MOVES on a version bump means behaviour moved
   and must be explained, not accepted.
2. `apps/api/src/middleware/__tests__/app-auth-bff-wiring.test.ts` entire - it drives the REAL
   `createHubBff` against a fake Hub including the `__Host-` prefixed cookie rotation.
3. `apps/api/src/middleware/__tests__/app-auth-access-gate.test.ts` entire - it drives the REAL
   verifier off an in-process RSA keypair.
4. `pnpm run build` - a real build, because the 1.3.0 incident was a RESOLUTION failure that a
   type-check alone would not have caught.

## Verify the install actually resolved

After installing, confirm the resolved version on disk is 2.3.0 in the pnpm store and that
`node -e "require.resolve('@fxl-business/hub-sdk')"` succeeds from `apps/api`. This repo has a scar
here: 1.3.0 installed fine and then failed to resolve at import time.
