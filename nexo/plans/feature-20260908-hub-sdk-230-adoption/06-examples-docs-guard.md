---
slice: 06-examples-docs-guard
wave: 3
files_modified:
  - apps/api/.env.example
  - apps/api/.env.dev.example
  - apps/web/.env.example
  - apps/web/.env.dev.example
  - CLAUDE.md
  - scripts/no-legacy-env-names.mjs
  - scripts/__tests__/no-legacy-env-names.test.mjs
---

# 06 - Examples, docs and the mechanical guard

## What

1. **`FXL_HUB_REDIRECT_URI` is set, not blank**, in both API examples:
   `FXL_HUB_REDIRECT_URI=http://localhost:8006/auth/callback`. That is the WEB origin, because vite
   proxies `/auth` from 8006 to the api on 3006, and it is the value `CLAUDE.md`'s "Required API
   vars" block already documents. Leaving it blank now means the SDK's `apiUrl`-derived default
   applies, which is the Hub's origin.
2. **`FXL_HUB_TRUSTED_ORIGINS`** added, a comma-separated list, documented as the browser origins
   allowed to POST to the BFF beyond its own. For local development that is
   `http://localhost:8006`.
3. **D3's carve-out stated.** Both examples currently present `FXL_HUB_CONFIG` as "this repo's
   documented form" with no qualification. After 2.3.0 that reads as an instruction to do a thing
   that is a HARD REFUSAL: `FXL_HUB_CONFIG` is the FIVE identity fields only, and the four
   operational values are always discrete, in BOTH modes. Say so where an operator will read it.
4. **`CLAUDE.md`** updated: the deletions from slice 05, `assertBootConfiguration` as the boot gate,
   and D6 stated as an ORIGIN rule and never as a presence rule.
5. **The guard** extended with anything slice 05 retired.

## The one sentence that must be right in CLAUDE.md

An absent `FXL_HUB_REDIRECT_URI` in staging or production still fails the boot - but it fails
because the DEFAULT lands on the Hub's origin and check 7 refuses that origin, not because the
variable is missing. Write it that way. A reader who takes away "the variable is required" will
eventually write a presence check, and a presence check waves through the copy-error case.

## Locked oracle

Documentation and examples: the full suite stays green, both guards exit 0, and a real
`pnpm run build` succeeds. Additionally grep both `.env` examples for every one of the nine
canonical names and confirm each is present exactly once with the right shape.
