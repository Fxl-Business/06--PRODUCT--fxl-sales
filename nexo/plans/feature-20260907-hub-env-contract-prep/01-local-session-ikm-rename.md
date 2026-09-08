---
slice: 01-local-session-ikm-rename
wave: 1
files_modified:
  - apps/api/src/env.ts
  - apps/api/src/middleware/app-auth.ts
  - apps/api/src/auth/session-crypto.ts
  - apps/api/src/middleware/__tests__/app-auth-bff-wiring.test.ts
  - apps/api/src/middleware/__tests__/app-auth-access-gate.test.ts
  - apps/api/src/middleware/__tests__/app-auth-bff-memory-path.test.ts
  - apps/api/src/middleware/__tests__/app-auth-bff-production-boot.test.ts
  - apps/api/src/middleware/__tests__/app-auth-unconfigured.test.ts
  - apps/api/.env.dev.example
  - apps/api/.env.example
  - scripts/no-legacy-env-names.mjs
  - package.json
  - CLAUDE.md
---

# 01 - Rename the local session IKM off the Hub namespace

## What

`HUB_SESSION_ENCRYPTION_KEY` becomes `SALES_SESSION_ENCRYPTION_IKM`, with its semantics
**byte-for-byte unchanged**.

## Why this exact name

`IKM`, not `KEY`, because that is what the value is: input keying material for HKDF-SHA256, not a
key. `SALES_`, not `FXL_HUB_`, because after 2.3.0 the `FXL_HUB_` namespace means "the SDK resolves
and validates this", and the SDK will never see this variable - this repo keeps its own session
store by recorded decision.

The name it must not collide with is the canonical `FXL_HUB_SESSION_ENCRYPTION_KEY`, which the
Hub's D1 defines as a required strict-hex 32-byte AES key for `SqlHubSessionStore`. Ours is an
optional, arbitrary-length (32-char floor) HKDF input with a `clientSecret` fallback. An operator
who assumed they were the same thing would either put a 64-hex value into an HKDF input (harmless
but meaningless) or put our value into the SDK's key (a boot failure at best).

## Semantics that MUST NOT change

- Declared `emptyToUndefined`, so the blank value `.env.dev.example` ships becomes `undefined`.
  This is load-bearing and was a real boot failure once: `??` does not catch `''`, and
  `createSessionSealer('')` throws its 32-char floor at module top level.
- Read off the VALIDATED `env` object, never `process.env`.
- Exactly one read site, `apps/api/src/middleware/app-auth.ts`:
  `encryptionIkm: env.<NAME> ?? hubAuthConfig.clientSecret`.
- Absent means HKDF from `FXL_HUB_CLIENT_SECRET`.

## Locked oracles

Run these by name; they are the slice's Gate 2 tier.

1. `apps/api/src/middleware/__tests__/app-auth-bff-wiring.test.ts` - the existing
   `boots with the blank HUB_SESSION_ENCRYPTION_KEY that .env.dev.example ships` is **retitled** to
   the new variable and keeps its assertion. It must still boot the real `createAppAuthBff()` with
   the blank value stubbed.
2. A NEW test in the same file: **`falls back to the client secret when SALES_SESSION_ENCRYPTION_IKM
   is absent`** - asserts the sealer is constructed from `clientSecret` when the variable is unset,
   which is the property the rename could silently drop by renaming the declaration and not the
   read.
3. `scripts/no-legacy-env-names.mjs` - a NEW git-grep gate, modelled on `scripts/no-legacy-auth.mjs`
   and wired into the root `test` script beside it. It fails when a retired name appears in tracked
   files.

## The guard's pathspec is load-bearing

`nexo/` must be EXCLUDED. Run records and plan files under `nexo/runs/` and `nexo/plans/` are
append-only history that legitimately names the retired variable dozens of times; a guard that
swept them would force a rewrite of the record, which is exactly what the archive exists to
prevent.

`CLAUDE.md` must also be excluded, for the reason the repo already has a precedent for: it is the
prose record of what was renamed and why, so it is the one file that must still spell the old name.
This mirrors the existing `sales.core` carve-out documented in `CLAUDE.md` itself.

The pathspec is therefore `-- . ':(exclude)nexo' ':(exclude)CLAUDE.md'`, and the guard's own source
must not contain the literal it bans - use the same character-code construction
`scripts/no-legacy-auth.mjs` uses, or the gate matches itself and can never pass.

## Non-vacuity proof required of Execute

Revert the one read in `app-auth.ts` to the old name and confirm type-check fails; restore.
Delete the new fallback test's assertion and confirm it goes green (proving the assertion is what
carries it), restore, then mutate `?? hubAuthConfig.clientSecret` away and confirm it goes RED.
