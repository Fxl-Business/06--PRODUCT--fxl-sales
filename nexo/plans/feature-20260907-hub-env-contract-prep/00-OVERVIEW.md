---
feature: hub-env-contract-prep
milestone: v3.1.0
---

# Prepare fxl-sales for the canonical Hub env contract

## Frame

### What

`@fxl-business/hub-sdk` 2.3.0 makes `loadHubConfig` the single resolver of the whole Hub
integration env contract, under nine canonical `FXL_HUB_*` names. It is **planned and not
published**: the registry answers `["1.0.0","1.2.0","1.3.0","1.3.1","2.1.0","2.2.0"]`, and the Hub
repo's own `packages/hub-sdk/package.json` still reads `2.2.0` with slices 01-09 of
`nexo/plans/hub-env-contract/` unexecuted.

So this run does the half of the adoption that does **not** depend on the SDK: it moves this
repository's OWN variables out of the `FXL_HUB_` namespace the SDK is about to claim, and it
stages the SDK-dependent half as an exact, unexecuted diff.

### Why this half is worth doing now, separately

After 2.3.0, `FXL_HUB_*` means "resolved and validated by the SDK". This repo currently owns three
variables that will sit inside that namespace while the SDK knows nothing about them, which is a
strictly worse version of the very defect the contract closes: a name that LOOKS canonical and is
not. One of them is actively dangerous, and the Hub's own plan is what proves it.

`HUB_SESSION_ENCRYPTION_KEY` here is an **optional HKDF input keying material** with a fallback to
`clientSecret` (`app-auth.ts:254`, `session-crypto.ts:6-14`), floor 32 characters, blank meaning
absent. The Hub's decision **D1** makes the canonical `FXL_HUB_SESSION_ENCRYPTION_KEY` a **required
strict-hex key**, `^[0-9a-fA-F]{64}$`, decoded to exactly 32 bytes, validated by the SDK, and it is
the key of the SDK's `SqlHubSessionStore` - a store this repo deliberately does not use
(`nexo/state.json`, `gate1_prior`). Two different types, two different lifecycles, one name apart.
fxl-finance already holds a third reading of the same string. Renaming ours is not cosmetic.

### Confirmed against the Hub's own plan, not assumed

Read from `16--INTERNAL--fxl-hub/nexo/plans/hub-env-contract/00-OVERVIEW.md` at commit `6f77ad3`:

| Decision | Consequence here |
| --- | --- |
| D1 - session key is strict hex, SDK-validated, for `SqlHubSessionStore` | our IKM must leave the namespace; slice 01 |
| D2 - `loadHubConfig(env) -> HubConfig` keeps its signature, returns four more fields | staged slice 02, no call-site reshape |
| D3 - the four operational values are ALWAYS discrete vars, in both modes; one inside `FXL_HUB_CONFIG` is a hard rejection | our `.env` examples must stop implying otherwise |
| D4 - `redirectUri`/`healthToken`/`trustedOrigins` stay `createHubBff` options, explicit wins | we keep our dev-only redirect fallback as an explicit override |
| D6 - `redirectUri` still defaults to `${apiUrl}/auth/callback`, the HUB's origin | our `resolveHubRedirectUri` stays load-bearing, it is not deletable |
| "O que NAO entra": `CORS_ORIGIN` and any consumer web-server variable | `CORS_ORIGIN` stays; the POST_LOGIN pair is ours; slice 02 |

`FXL_HUB_REDIRECT_URI` **is** one of the canonical nine, so it is deliberately NOT renamed here.
`FXL_HUB_POST_LOGIN_REDIRECT` and `FXL_HUB_POST_LOGIN_ERROR_REDIRECT` are not among the nine, are
not `createHubBff` options the contract standardizes, and are resolved entirely by this repo
(`app-auth.ts:147-160`), so they are ours and are renamed.

### Acceptance criteria

1. No source file under `apps/` reads a `FXL_HUB_*` name that the canonical nine do not contain.
2. The Hub BFF session sealer keeps its exact current semantics - optional, blank means absent,
   absent falls back to `clientSecret` - under a name that cannot be mistaken for the SDK's key.
3. A mechanical guard fails the suite if any retired name returns, following the
   `scripts/no-legacy-auth.mjs` precedent already wired into `pnpm test`.
4. The full suite, lint, type-check and a real build stay green at every merge to `master`.
5. The SDK-dependent work is staged as an exact diff that names its own stop conditions.

### Out of scope, deliberately

No install, no lockfile change, no `2.3.0` in any `package.json`: the package does not exist.
No local shim, no type augmentation, no `file:` specifier, no tarball - a local workaround is the
thing this whole programme exists to delete.
No deploy, no promotion. `master` only, and Gate 3 is untouched.

### The operator cost this creates, stated rather than buried

Renaming an env var means the operator sets the new name in Coolify **before** the deploy that
reads it. For `SALES_SESSION_ENCRYPTION_IKM` there is a sharper edge: it is the HKDF input, so the
VALUE must be carried across unchanged or every stored session seal stops opening and every user
is logged out once. Today the variable is blank in both environments (the documented default), in
which case there is nothing to carry and the rename is free. This is recorded in `AUDIT.md` as an
operator item either way.

## Slice index

| # | Slice | Depends on | Wave |
|---|---|---|---|
| 00 | `guard-pathspec-fix` - unbreak `pnpm test`, which is RED on `master` before this run | - | 0 |
| 01 | `local-session-ikm-rename` - `HUB_SESSION_ENCRYPTION_KEY` to `SALES_SESSION_ENCRYPTION_IKM` | - | 1 |
| 02 | `local-post-login-rename` - the POST_LOGIN pair to `SALES_*` | 01 | 2 |
| 03 | `staged-sdk-230-adoption` - the exact unexecuted diff, docs only | 01, 02 | 3 |

Slice 00 was not planned. It was found by taking a baseline: `pnpm test` already fails on `master`
at `5eeff1e` because `scripts/no-legacy-auth.mjs` greps the whole tree and the v3.0.0 release-verify
record quotes the banned literal as evidence. It is fixed first, because Gate 2 cannot mean anything
against a trunk that is already red, and because slice 01 adds a SECOND guard that would inherit the
same defect.

Waves are serial rather than parallel: slices 01 and 02 both rewrite `apps/api/src/env.ts`,
`apps/api/src/middleware/app-auth.ts`, both `.env` examples and `CLAUDE.md`, so `files_modified`
overlaps completely and `waves.sh` would refuse to parallelize them anyway.
