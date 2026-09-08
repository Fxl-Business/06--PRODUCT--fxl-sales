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

## CARRY-OVERS from slices 04 and 05's Gate 2 reports - all in scope here

**D6, the same defect class as slice 05's blocking failure, surviving in docs.**
`README.md:43-52` and `CLAUDE.md`'s "Required API vars" block each carry a fenced `dotenv` block a
human can copy wholesale. Both describe a PARTIAL Hub configuration - some identity variables with
values, others absent - which after slice 05 is a BOOT FAILURE rather than a 503.

The lesson slice 05 paid for is that the suite never read the artefact a human actually uses. Fixing
the two `.env` examples without fixing these two blocks leaves the same trap one file over. Make
both blocks show all five identity variables BLANK, exactly as the examples now do, with the
known-good values alongside as comments. Say in one line what the rule is: all five together, or
none.

Extend `env-example-contract.test.ts` to cover them if the fenced blocks can be parsed reliably. If
they cannot be parsed without inventing a markdown parser, say so plainly in your notes and leave
them covered by prose alone rather than writing a fragile test - a brittle oracle on a doc block is
worse than an honest gap.

**D4.** `CLAUDE.md` states the two BFF mount tests "keep their exact titles". Slice 05 renamed both,
justifiably, with assertions intact. Correct that line.

**The `nameDiscreteVar` decision, now that it is on the record.** `CLAUDE.md` documents that wrapper
and why it existed. It is deleted. Record the deletion AND its cost honestly: the SDK's
`operationalMessage` names the discrete variable for the four OPERATIONAL fields, but the five
IDENTITY fields still format as `FXL_HUB_CONFIG.<field>`, so an operator using the five discrete
variables who misconfigures one is now pointed at a variable they never set. That is an accepted
diagnostic regression, not an oversight, and it is reported upstream as 2.4.0 feedback.

**A comment wording nit from slice 04.** In
`apps/api/src/middleware/__tests__/app-auth-bff-production-boot.test.ts`, the fixture comment calls
`sales-api.fxlbusiness.test` "the BROWSER-facing origin". It is the API origin; the web origin in
these fixtures is `sales.fxlbusiness.test`. The VALUE is correct and load-bearing - it differs from
the fixture `apiUrl`, which is the only property check 7 tests - so fix the word, keep the value.

**`FXL_HUB_TRUSTED_ORIGINS` is a PROMOTION gate, not a `.env` matter.** Document it as such. Slice 05
moved `trustedOrigins` off `env.CORS_ORIGIN`; unset, the list is `[]` and the 2026-08-10 cross-origin
outage returns, because the web app and the API are on different hosts. The `.env` examples help a
fresh clone and do nothing for a deploy, so this needs a line in `CLAUDE.md` and an AUDIT entry, not
just an example value.

## The Auth Model section is now substantially wrong

`CLAUDE.md`'s Auth Model describes `hubConfigPresence`, `HUB_DISCRETE_ENV_VARS`, `nameDiscreteVar`,
the local health-token requirement and `resolveHubRedirectUri` as live. None of them exists. Rewrite
that section against the code as it now is, preserving the parts that are still true - the single
access gate, the deny taxonomy, the session store decision, the `503` fail-soft door and why it is
narrow. Do not rewrite what the slice did not change.

## Locked oracle

Documentation and examples: the full suite stays green, both guards exit 0, and a real
`pnpm run build` succeeds. Additionally grep both `.env` examples for every one of the nine
canonical names and confirm each is present exactly once with the right shape.
