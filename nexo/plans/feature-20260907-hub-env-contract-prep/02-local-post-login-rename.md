---
slice: 02-local-post-login-rename
wave: 2
files_modified:
  - apps/api/src/env.ts
  - apps/api/src/middleware/app-auth.ts
  - apps/api/src/config/auth-provider.ts
  - apps/api/src/middleware/__tests__/app-auth.test.ts
  - apps/api/src/config/__tests__/auth-provider.test.ts
  - apps/api/.env.dev.example
  - apps/api/.env.example
  - scripts/no-legacy-env-names.mjs
  - CLAUDE.md
---

# 02 - Rename the post-login redirect pair off the Hub namespace

## What

`FXL_HUB_POST_LOGIN_REDIRECT` becomes `SALES_POST_LOGIN_REDIRECT`, and
`FXL_HUB_POST_LOGIN_ERROR_REDIRECT` becomes `SALES_POST_LOGIN_ERROR_REDIRECT`.
Behaviour is unchanged; only the names move.

## Why these two and not `FXL_HUB_REDIRECT_URI`

`FXL_HUB_REDIRECT_URI` **is** one of the canonical nine. It stays exactly as it is, and touching it
here would collide with the staged slice that hands its resolution to the SDK.

The POST_LOGIN pair is not among the nine, is not one of the four operational values the contract
standardizes (`redirectUri`, `healthToken`, `sessionEncryptionKey`, `trustedOrigins`), and is not a
`createHubBff` option name the contract governs. It is resolved start to finish inside this repo by
`resolveHubPostLoginRedirect` and `resolveHubPostLoginErrorRedirect`, and it falls back to
`CORS_ORIGIN`, which the Hub's plan names explicitly as the consumer's own configuration and
explicitly out of the contract. So the pair is ours, and after 2.3.0 the `FXL_HUB_` prefix on it
would be a false claim of canonicity.

`createHubBff` does still take `postLoginRedirect` / `postLoginErrorRedirect` as code options, and
that is unchanged: what moves is where THIS repo reads the values from, not how it passes them.

## Behaviour that MUST NOT change

- `resolveHubPostLoginRedirect` returns the explicit value, else `CORS_ORIGIN`, else `/`.
- `resolveHubPostLoginErrorRedirect` returns the explicit value, else the post-login redirect with
  `?error=auth` appended, and its `/` special case is preserved verbatim.
- Both are `emptyToUndefinedUrl` in `env.ts`.
- Both remain reachable through `hubEnvBag`. The bag is the ONE bridge between the validated env and
  the resolvers; the keys inside it are renamed, the bridge is not removed.

## Locked oracles

1. `apps/api/src/middleware/__tests__/app-auth.test.ts` - the four existing resolver tests
   (`:119`, `:123`, `:138`, `:161`, `:167`) keep their assertions against the renamed keys,
   including `falls back to the local web dev port when CORS_ORIGIN is absent`.
2. `apps/api/src/config/__tests__/auth-provider.test.ts` - `projects exactly the Hub variables off
   the validated env object` (`:170`). Its sorted-key assertion is the pin that fails if the bag and
   the schema disagree after the rename, so it is updated to the new key list and NOT loosened.
3. `scripts/no-legacy-env-names.mjs` - extended with both retired names, same pathspec rules as
   slice 01.

## Naming note for Execute

The test at `auth-provider.test.ts:170` is titled "projects exactly the **Hub** variables". After
this slice the bag carries two keys that are deliberately NOT Hub variables. Retitle it to
`projects exactly the auth variables off the validated env object` so the title does not assert
something the slice just made false. Do not weaken the assertion itself.
