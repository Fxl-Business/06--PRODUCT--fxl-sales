---
slice: 03-staged-sdk-230-adoption
wave: 3
files_modified:
  - nexo/plans/feature-20260907-hub-sdk-230-env-contract/00-OVERVIEW.md
---

# 03 - Stage the SDK-dependent adoption as an exact, unexecuted diff

## What

Rewrite the parked plan at `nexo/plans/feature-20260907-hub-sdk-230-env-contract/00-OVERVIEW.md`
against the Hub's CONFIRMED decisions rather than against the handoff prompt's summary of them, and
carry it to the level of detail where executing it after publication is mechanical.

Documentation only. No code, no `package.json`, no lockfile.

## Why it is a slice and not a note

The prompt that opened this work asked for a plan; what exists is a plan written before the Hub's
own D1-D6 were read. Three of its assumptions are now known to be wrong or incomplete, and leaving
them in place would mislead whoever executes after publication:

1. It treated `healthToken`'s non-development requirement as possibly still ours. D2 puts
   `healthToken` in `HubConfig`, so the SDK resolves it; whether the SDK also REQUIRES it outside
   development is not stated in the Hub plan and becomes a stated stop condition rather than a guess.
2. It did not know D3 - that the four operational values are read from discrete variables in BOTH
   modes, and that placing one inside `FXL_HUB_CONFIG` is a hard rejection. Both `.env` examples
   currently document `FXL_HUB_CONFIG` as "this repo's documented form" without that carve-out.
3. It did not know D6 - that `redirectUri` still defaults to the HUB's origin. That makes
   `resolveHubRedirectUri`'s non-production fallback to `CORS_ORIGIN/auth/callback` **not**
   deletable, which the earlier plan implied it was. It survives as the explicit `createHubBff`
   option D4 preserves.

## Content the staged plan must carry

- The four remaining slices with named oracles: the bump, `loadHubConfig` as sole resolver,
  `trustedOrigins` from `FXL_HUB_TRUSTED_ORIGINS`, and the examples/doc sweep.
- The exact deletion list in `apps/api/src/config/auth-provider.ts` with line numbers, separating
  what is SDK duplication from what is permanently this repo's (`tryLoadHubAuthConfig`, and the
  now-Sales-only remnant of `hubEnvBag`).
- The `redirectUri` question stated as a decision to be taken with the published SDK in hand, not
  pre-answered.
- Stop conditions, unchanged in spirit: if 2.3.0 does not cover a real case here, park and report
  rather than reintroduce a local resolver.
- The operator's final variable list, split into what the Hub admin issues and what the operator
  generates.

## Locked oracle

Documentation slice: the oracle is the full suite staying green (nothing executable changed) plus
`node scripts/no-legacy-env-names.mjs` still passing, since the staged plan names retired variables
in prose and must therefore live outside the guard's pathspec or avoid the bare literals.
