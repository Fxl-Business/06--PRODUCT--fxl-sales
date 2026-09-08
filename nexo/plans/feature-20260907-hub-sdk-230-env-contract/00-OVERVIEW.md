---
feature: hub-sdk-230-env-contract
milestone: v3.1.0
status: PARKED, waiting on publication
---

# Adopt `@fxl-business/hub-sdk` 2.3.0, the canonical Hub env contract

STATUS: **PARKED**. Nothing here is executed. No install, no `package.json` edit, no lockfile move.

Evidence, 2026-09-07:

```
$ npm view @fxl-business/hub-sdk versions --json
["1.0.0","1.2.0","1.3.0","1.3.1","2.1.0","2.2.0"]
```

and in the Hub repo itself, `packages/hub-sdk/package.json` is still `"version": "2.2.0"` with
`nexo/plans/hub-env-contract/` slices 01-09 planned and unexecuted. The contract below is a SPEC,
not an implementation, and every line of this plan must be re-checked against the published tarball
before a character of it is executed.

No local shim, no type augmentation, no `file:` specifier, no tarball, no vendored copy. A local
workaround is the exact defect class this programme exists to delete, and building one to go faster
would be building the thing we are removing.

## What already landed, and why it did not need the SDK

Run `feature-20260907-hub-env-contract-prep` merged three slices to `master`. They moved THIS
repo's own variables out of the `FXL_HUB_` namespace the SDK is about to claim, which is pure local
hygiene and blocked by nothing:

| Was | Is | Why it is ours and not the contract's |
| --- | --- | --- |
| `HUB_SESSION_ENCRYPTION_KEY` | `SALES_SESSION_ENCRYPTION_IKM` | optional HKDF input with a `clientSecret` fallback, for the store this repo keeps by its own recorded decision. The canonical `FXL_HUB_SESSION_ENCRYPTION_KEY` is a REQUIRED strict-hex 32-byte AES key for the SDK's `SqlHubSessionStore`. Two types, one name apart |
| `FXL_HUB_POST_LOGIN_REDIRECT` | `SALES_POST_LOGIN_REDIRECT` | not among the nine, resolved entirely here, falls back to `CORS_ORIGIN` which the Hub plan puts explicitly outside the contract |
| `FXL_HUB_POST_LOGIN_ERROR_REDIRECT` | `SALES_POST_LOGIN_ERROR_REDIRECT` | same |

A fourth slice fixed `scripts/no-legacy-auth.mjs`, which was making `pnpm test` RED on `master`
before this run began, and added `scripts/no-legacy-env-names.mjs` so a retired name cannot return.

`FXL_HUB_REDIRECT_URI` was deliberately NOT renamed: it IS one of the canonical nine.

## The contract, read from the Hub source rather than from the handoff prompt

`16--INTERNAL--fxl-hub/nexo/plans/hub-env-contract/00-OVERVIEW.md`. The nine canonical names:

```
FXL_HUB_API_URL              FXL_HUB_REDIRECT_URI
FXL_HUB_ENVIRONMENT          FXL_HUB_HEALTH_TOKEN
FXL_HUB_CLIENT_ID            FXL_HUB_SESSION_ENCRYPTION_KEY
FXL_HUB_CLIENT_SECRET        FXL_HUB_TRUSTED_ORIGINS
FXL_HUB_AUDIENCE
```

**D1.** Session key is strict `^[0-9a-fA-F]{64}$`, decoded to exactly 32 bytes, refused before decode.
The regex is strict because `Buffer.from(s,'hex')` stops at the first invalid character and returns
a TRUNCATED buffer with no error, so a base64 key read as hex silently becomes a short key.
Irrelevant to us at runtime - we do not use `SqlHubSessionStore` - but it is what makes the name
collision dangerous, and it is why slice 01 happened.

**D2.** `loadHubConfig(env) -> HubConfig` keeps its signature and now also returns `redirectUri`,
`healthToken`, `sessionEncryptionKey` and `trustedOrigins`. No consumer call site changes SHAPE;
the object simply arrives complete. `HubPublicConfig` and `toPublicConfig` do not change, so the
browser half stays structurally incapable of carrying a secret.

**D3.** `FXL_HUB_CONFIG` stays the FIVE identity fields and only those. The four operational values
are always read from their own discrete variables, in BOTH configuration modes, and one of them
placed inside `FXL_HUB_CONFIG` is a hard refusal naming the discrete variable to use.
Reason: the five travel together because they are ONE Client credential pasted per environment,
while the four operational values rotate independently.
CONSEQUENCE HERE: both `.env` examples currently say `FXL_HUB_CONFIG is this repo's documented form`
with no carve-out, which after 2.3.0 would read as an instruction to do the one thing that is a hard
refusal.

**D4.** `redirectUri` / `healthToken` / `trustedOrigins` REMAIN `CreateHubBffOptions`, and the
explicit option WINS over the config value. Removing them would be a major bump and the track fixes
2.3.0 as a minor. `sessionStore` stays a code option because it is an implementation, not a value.

**D5.** Hard cutover. No legacy name accepted, no compatibility layer, no deprecation warning.

**D6, REVISED 2026-09-07 and the revision matters more than the original.**
`FXL_HUB_REDIRECT_URI` is REQUIRED outside `development`; the `${apiUrl}/auth/callback` default
survives ONLY in `development`. Absent with environment `staging` or `production` is a
`HubConfigError('redirectUri', ...)` naming the variable and explaining the SDK CANNOT derive it,
because it is the BROWSER's origin.
The original decision kept the default everywhere. The fxl-finance adoption session objected that
the default is never correct for any Application, since `apiUrl` is the HUB's origin, and the
objection was accepted. The refusal lives in `parseHubConfig`, not `boot.ts`, so it fails earliest
and `parseHubConfig` stays idempotent.

This plan was written once against the pre-revision D6 and was wrong. Re-read the Hub plan before
executing, because it moved once already.

## Slices, none of them started

### 04 - The bump

`apps/api/package.json` and `apps/web/package.json` to `2.3.0` EXACT, no caret, lockfile in the same
commit. `@fxl-business/hub-sdk-testing` peer-requires the SDK at an exact version, so it moves in
the same commit or the install fails.
Re-check the `hono` `4.12.28` override in `pnpm-workspace.yaml` against 2.3.0's peer range and move
it ONLY if 2.3.0 actually widened it. The override exists because `.npmrc` sets
`strict-peer-dependencies=false`, so without it the workspace resolves a second Hono copy and the
BFF's `Context` stops being the one `server.ts` composes with.

Oracles: the full suite unchanged; `app-auth-bff-wiring.test.ts` entire, which drives the REAL
`createHubBff` against a fake Hub including the `__Host-` cookie rotation; `app-auth-access-gate.test.ts`
entire, which runs the real verifier off an in-process RSA keypair.

### 05 - `loadHubConfig` as the single resolver

Delete from `apps/api/src/config/auth-provider.ts` what the SDK now owns. Line numbers are current
as of the merge of slice 02:

| Symbol | Line | Action |
| --- | --- | --- |
| `HUB_DISCRETE_ENV_VARS` | 26 | DELETE, the SDK owns the discrete-form list |
| `HubConfigPresence` | 34 | DELETE |
| `hubConfigPresence` | 100 | DELETE, two-forms detection and the mixed-forms refusal become the SDK's (D3 makes its refusal stricter than ours) |
| `HUB_FIELD_TO_DISCRETE_VAR` | 126 | DELETE, it exists only because the SDK named its JSON form |
| `nameDiscreteVar` | 150 | DELETE with it |
| `healthToken` requirement | 171 | CONDITIONAL, see the stop conditions |
| `HubEnvSource` / `hubEnvBag` | 41 / 75 | SHRINK, do not delete. See below |
| `tryLoadHubAuthConfig` | 185 | KEEP, permanently ours |

`hubEnvBag` must NOT be deleted. After the Hub keys leave it, it still carries `NODE_ENV`,
`CORS_ORIGIN` and the two `SALES_POST_LOGIN_*` names, which `resolveHubPostLoginRedirect` and
`resolveHubPostLoginErrorRedirect` read at `app-auth.ts:155` and `:159`. It stops being a Hub bag
and becomes what its comment already says it is: the one bridge between the validated env and the
auth loaders. Rename it if that reads better, but keep the bridge, and keep the sorted-key
assertion in `auth-provider.test.ts` that pins the bag and the schema together.

`tryLoadHubAuthConfig` must NOT be deleted. It is the only fail-soft door and the sole reason
`503 hub_auth_not_configured` still answers for a machine that has simply never been given
credentials. The file header's no-blanket-try/catch rule survives this slice unchanged.

### 06 - `trustedOrigins` from the contract

`apps/api/src/middleware/app-auth.ts:298` currently passes `trustedOrigins: [env.CORS_ORIGIN]`.
It becomes the SDK-resolved `FXL_HUB_TRUSTED_ORIGINS`. `CORS_ORIGIN` stays: it still feeds
`middleware/cors.ts:5` and the post-login fallbacks, and the Hub plan names consumer web-server
configuration as explicitly outside the contract.

Oracles, keeping their exact titles, now proving the contract-supplied value:
`does not 403 a cross-origin refresh from CORS_ORIGIN, through the real mount` and
`still 403s a cross-origin refresh from an origin that is not CORS_ORIGIN` in
`app-auth-bff-wiring.test.ts`, plus the exact-array assertion in
`app-auth-bff-production-boot.test.ts`.
Note the titles will name `CORS_ORIGIN` while the value comes from `FXL_HUB_TRUSTED_ORIGINS`;
retitle them in the same commit so the oracle does not assert a source it no longer has.

### 07 - `redirectUri`, and the decision this plan does NOT pre-answer

Today `resolveHubRedirectUri` (`app-auth.ts:133`) is: explicit value, else if `NODE_ENV` is not
production `${CORS_ORIGIN}/auth/callback`, else throw.

Under 2.3.0 the SDK refuses an absent value in staging and production - keyed on the HUB environment,
which is strictly better than our `NODE_ENV` key, because a staging deploy running `NODE_ENV=production`
is a real shape. In development the SDK defaults to `${apiUrl}/auth/callback`, which is the HUB's
origin and is WRONG here: vite proxies `/auth` from 8006 to the api on 3006, so the registered
callback is the WEB origin, `http://localhost:8006/auth/callback`.

RECOMMENDED, to be confirmed against the published SDK and not before: delete `resolveHubRedirectUri`
entirely and set `FXL_HUB_REDIRECT_URI=http://localhost:8006/auth/callback` in both `.env` examples.
`CLAUDE.md`'s own "Required API vars" block ALREADY ships exactly that value, so the examples simply
stop leaving it blank. One canonical variable, always set, no local resolver, and no dependence on a
default that is wrong for this topology.

FALLBACK if that proves wrong: keep the development value as the explicit `createHubBff` option D4
preserves. It is strictly worse because it re-reads an env name the SDK owns, and it is the fallback,
not the plan.

### 08 - Examples, docs and the guard

Both API `.env` examples, both web ones, `CLAUDE.md`, and every `vi.stubEnv` of a retired name.
D3 means the examples must stop presenting `FXL_HUB_CONFIG` as the whole configuration: the four
operational names are ALWAYS discrete, and putting one inside the JSON object is a hard refusal.
Extend `scripts/no-legacy-env-names.mjs` with anything this wave retires.

## Stop conditions - park and report, never work around

1. **`healthToken`'s requirement.** D2 puts it in `HubConfig`, but the Hub plan does not say whether
   the SDK also REQUIRES it outside development the way `auth-provider.ts:171` does today. If the SDK
   does not, deleting our check silently removes a boot failure. Determine it from the published
   package; do not guess in either direction.
2. **The `SALES_POST_LOGIN_*` pair.** The contract does not standardize it and `createHubBff` still
   takes the two code options. If 2.3.0 turns out to claim them after all, stop: that is a naming
   decision the Hub owns, and this repo just renamed them.
3. **Anything 2.3.0 does not cover** that this repo really needs. The whole point is to have no local
   workaround left, so a gap is a report, not a shim.

## Two lessons from the prep run that apply directly here

- `type EnvLike = Record<string, string | undefined>` at `app-auth.ts:14` is an index signature, so
  renaming a key read through it **type-checks cleanly**. For anything reached that way, `tsc` is NOT
  a rename oracle; the env-name guard plus a test that passes an explicit VALUE are.
- `git grep` reads the INDEX, so an unstaged file is invisible to both guards. Stage before trusting
  a green guard run.

## The operator's variable list, after the whole programme lands

Issued by the Hub admin when the Client is registered:
`FXL_HUB_API_URL`, `FXL_HUB_ENVIRONMENT`, `FXL_HUB_CLIENT_ID`, `FXL_HUB_CLIENT_SECRET`,
`FXL_HUB_AUDIENCE` (`app.fxl-sales`).

Registered in the Hub admin AND set here, byte-identical on both sides:
`FXL_HUB_REDIRECT_URI`.

Generated by the operator, never issued by the Hub:
`FXL_HUB_HEALTH_TOKEN` (required outside development),
`FXL_HUB_SESSION_ENCRYPTION_KEY` (`openssl rand -hex 32`; only if this repo ever adopts the SDK's
session store, which it currently does not),
`SALES_SESSION_ENCRYPTION_IKM` (optional; absent means HKDF from `FXL_HUB_CLIENT_SECRET`).

This repo's own web-server configuration, outside the Hub contract:
`CORS_ORIGIN`, `FXL_HUB_TRUSTED_ORIGINS` (contract-named but deployment-shaped),
`SALES_POST_LOGIN_REDIRECT`, `SALES_POST_LOGIN_ERROR_REDIRECT`, `PUBLIC_LINK_BASE_URL`.

Binding order, from the Hub's own plan: the Hub ships 2.3.0, then both consumers adopt and verify
without deploying, then the operator swaps the variables in Coolify and Vercel and deploys.
Swapping a variable BEFORE the code that reads it lands takes the boot down.
