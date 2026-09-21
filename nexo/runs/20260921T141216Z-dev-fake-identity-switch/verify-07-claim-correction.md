# Verify 07 - claim correction re-check

**Scope**: decide whether the rewritten `CLAUDE.md` text about the dev-fake-identity Docker
exposure is now TRUE, without rebuilding the Docker image (relying on the prior verifier's build
evidence for that specific fact).

**Verdict: FAIL** - not because the Dockerfile-facing claims are wrong (they are all true and
verified below), but because the corrected text makes one additional, checkable claim about a
cross-referenced file, and that claim is false: the supporting documents it points to were not
actually brought in line with the correction.

## 1. Dockerfile facts, read first-hand

`apps/api/Dockerfile` (confirmed byte-identical to `git show HEAD:apps/api/Dockerfile`, and
`git diff HEAD -- apps/api/Dockerfile` is empty):

- `deps` stage: `COPY` only three `package.json` files (`apps/api`, `packages/shared-types`,
  `packages/shared-utils`) plus the lockfile/workspace files, then `RUN pnpm install
  --frozen-lockfile` - **no `--prod`**, so devDependencies (including `@fxl-sales/auth-fake`,
  declared as a `workspace:*` devDependency of `apps/api/package.json`) are resolved.
- `build` stage: `COPY . .` (whole repo, `packages/auth-fake` included), then builds
  shared-types, shared-utils and api only.
- `runtime` stage: `ENV NODE_ENV=production` is baked in, then
  `COPY --from=build /app/packages ./packages` copies the **entire** `packages/` tree (not a
  scoped subset the way the `deps` stage scopes its `package.json` copies), plus
  `apps/api/node_modules` (which resolves the workspace symlink to `packages/auth-fake`).

This matches the previous verifier's finding: the package physically ships inside the production
API image. I did not rebuild the image (relying on
`nexo/runs/20260921T141216Z-dev-fake-identity-switch/verify-07-and-final-integration.md` for that
evidence), but the Dockerfile text alone is sufficient to explain why it would.

`apps/api/src/auth/select.ts` confirms the boot refusal: `installFakeAuthIfRequested` checks
`isProductionEnv(env)` and `throw`s `appAuth.DEV_IDENTITY_ADAPTER_IN_PRODUCTION_MESSAGE`
**before** the dynamic `import('@fxl-sales/auth-fake')`, i.e. before the roster package is ever
touched.

`scripts/assert-web-bundle-clean.mjs` confirms the web-side claim: it fails hard on a missing
`apps/web/dist`, asserts the `FXL_SALES_DEV_FAKE_ROSTER_SENTINEL` literal still exists in
`packages/auth-fake/src` (so a deleted sentinel cannot make the scan vacuously green), and then
scans the built bundle for that sentinel.

`packages/auth-fake/package.json`'s `"main": "./src/index.ts"` confirms the accidental-crash
mechanism claimed for `NODE_ENV=development` forced against the production image: plain `node`
(no `tsx`/loader) cannot resolve raw `.ts` from that entrypoint. I grepped
`apps/api/src`, `apps/web/src` and `scripts/` for any test asserting this crash and found none -
consistent with the claim that "that crash is asserted by no test."

## 2. Claim-by-claim check of the corrected text

All checked TRUE against the Dockerfile and code:

| Claim | Verdict |
|---|---|
| Layer one ("absent from the production image") does NOT hold for the API artifact | TRUE |
| `deps` stage installs with no `--prod`; runtime stage copies the whole `packages/` tree, not scoped | TRUE (Dockerfile text quoted above) |
| `NODE_ENV=production` baked into the image at build time is what closes it, together with the boot refusal that reads it | TRUE (`ENV NODE_ENV=production` in runtime stage; `select.ts`'s production check precedes the package import) |
| Web exclusion is real and proven by `scripts/assert-web-bundle-clean.mjs` against the real built bundle | TRUE (script reads real `apps/web/dist`, fails on absence, self-checks the sentinel first) |
| `NODE_ENV=development` forced against the production image doesn't trip the boot refusal and only crashes by accident (raw `.ts` `main`), pinned by no test | TRUE |
| Honest count is TWO real, independent things holding the API artifact closed (not four) | TRUE, consistent with the above |
| Remediation named (scope the `packages` copy, install with `--prod`/prune, add an artifact-level test) | TRUE, and matches the `nexo/ROADMAP.md` entry verbatim in substance |
| No remaining occurrence of the old false claim ("absent from the production API artifact by construction") inside `CLAUDE.md` itself | TRUE - grepped; only the corrected framing remains, and the `## Auth Model` bullet's added sentence (line 32) matches the `## Development identity mode` section |

## 3. The claim that is FALSE

The supersession paragraph in `CLAUDE.md` (`## Development identity mode`, "This mode makes a
written prohibition FALSE...") ends:

> "The parked file carries a dated supersession note saying **exactly that**, and
> `nexo/knowledge/decisions/2026-09-21-development-identity-is-a-boot-time-adapter.md` carries the
> reasoning."

"Exactly that" refers back to the immediately preceding sentence: closure comes from
`NODE_ENV=production` baked in plus the boot refusal, **not** from the package's absence from the
image.

I read the actual supersession note in
`nexo/plans/feature-20260827-hub-sdk-210-access-model/05-dev-identity-fixtures.md`. It says:

> "What landed instead is a BOOT-TIME replacement of the middleware behind four independent
> layers: **a devDependency-only workspace package that is absent from the production install**,
> dynamic imports only so no static import can pull it into the build graph, an
> `import.meta.env.DEV` fence that `vite build` eliminates on the web side, and an API that
> refuses to boot with the flag set under `NODE_ENV=production`.
> `scripts/__tests__/auth-fake-isolation.test.mjs` proves all four and proves itself against
> mutated fixtures."

This is the disproven claim, stated flatly and without qualification, and it further claims the
isolation test "proves all four" layers - directly contradicting `CLAUDE.md`'s own new text, which
says the isolation test "never builds or inspects the actual Docker artifact, so it could not and
did not catch the layer-one gap." The parked plan's note was not updated when `CLAUDE.md` was
corrected; it still reflects the pre-correction (wrong) understanding.

The referenced decision doc,
`nexo/knowledge/decisions/2026-09-21-development-identity-is-a-boot-time-adapter.md`, has the same
problem in its "Decision, part two" section: "Layers one to three make the fake ABSENT from the
production artifact by construction; an operator cannot flip it on in production because there is
nothing there to flip." Nothing in that file notes the later Docker-build finding that falsifies
this for the API image. `CLAUDE.md` only says this file "carries the reasoning" (not that it was
updated), so this second instance is weaker evidence on its own, but combined with the parked
plan's note it shows the correction was applied to `CLAUDE.md` only and not propagated to the two
files `CLAUDE.md` itself points readers to for corroboration.

`scripts/__tests__/dev-identity-docs-reconciliation.test.mjs` does not catch this: by its own
docblock it is a narrow mechanical check (sentinel present, in the right order, `CLAUDE.md`
section heading present) and explicitly disclaims checking whether the content is true - "Whether
every clause of the new `CLAUDE.md` section is TRUE against the shipped code is a clause-by-clause
human or verify-agent reading... and is not automated here." That reading is this report, and it
finds one clause false.

## 4. Other checks

- `git diff HEAD -- apps/api/Dockerfile` is empty; `diff <(git show HEAD:apps/api/Dockerfile)
  apps/api/Dockerfile` reports no differences. The production image build was not touched in this
  run.
- `pnpm run test` at the root: **green**. `packages/auth-fake` 35/35, `packages/shared-utils`
  80/80, `apps/api` 601/601 (55 files), `apps/web` 940/940 (75 files), plus the root
  `node --test` guard suite (includes `scripts/__tests__/auth-fake-isolation.test.mjs` and
  `scripts/__tests__/dev-identity-docs-reconciliation.test.mjs`) at 53/53, and
  `node scripts/no-legacy-auth.mjs`, `node scripts/no-legacy-env-names.mjs`,
  `node scripts/build-contract.mjs` all clean. Exit code 0, zero failures anywhere.
- No files were modified, staged, or committed by this verification pass.

## Conclusion

Every claim in `CLAUDE.md`'s corrected text that is checkable directly against the Dockerfile and
the code is TRUE, and the Dockerfile is untouched, and the suite is green. But the corrected text
also asserts that the parked plan's supersession note says "exactly" the corrected story, and it
does not - that note (and the decision doc it also points to) still states the disproven "absent
from the production install by construction" claim as one of four layers the isolation test
supposedly "proves," with no amendment. That is a factual claim in the corrected `CLAUDE.md` text
that is false against the file it names. Recommend: amend the parked plan's supersession note (and
ideally add a short amendment note to the decision doc's "Decision, part two" section) to state the
same corrected understanding now in `CLAUDE.md`, then re-verify.
