---
slice: 05-contract-single-resolver
wave: 2
files_modified:
  - apps/api/src/config/auth-provider.ts
  - apps/api/src/config/__tests__/auth-provider.test.ts
  - apps/api/src/middleware/app-auth.ts
  - apps/api/src/middleware/__tests__/app-auth.test.ts
  - apps/api/src/middleware/__tests__/app-auth-bff-wiring.test.ts
  - apps/api/src/middleware/__tests__/app-auth-bff-production-boot.test.ts
  - apps/api/src/middleware/__tests__/app-auth-unconfigured.test.ts
  - apps/api/src/env.ts
---

# 05 - The atomic flip onto `loadHubConfig` plus `assertBootConfiguration`

## Why this is ONE slice

`assertBootConfiguration` folds the code-level overrides over the config AND returns the
`ResolvedHubConfig` that `createHubBff` consumes. Splitting "resolve the config" from "consume it"
would leave `master` with a boot path belonging to neither shape. This repo has the precedent
recorded in `nexo/state.json` for the 2.1.0 run: early slices keep the trunk green, the migration
itself is the single atomic flip.

## The shipped contract, read from the 2.3.0 bundle rather than from any plan

```js
function assertBootConfiguration(input) {
  const config = parseHubConfig({ ...input.config,
    ...(input.redirectUri   !== undefined ? { redirectUri:   input.redirectUri   } : {}),
    ...(input.healthToken   !== undefined ? { healthToken:   input.healthToken   } : {}),
    ...(input.trustedOrigins!== undefined ? { trustedOrigins:input.trustedOrigins} : {}) });
  // check: sessionStore required unless allowEphemeralSessionStore
  // check: allowEphemeralSessionStore / insecureCookies legal only in development
  // check 6: healthToken required when environment !== 'development'
  // check 7: !isDevelopment && originOf(redirectUri) === originOf(config.apiUrl)  -> throw
  return { ...config, redirectUri };
}
```

That spread is the ONLY statement of the override precedence in the SDK, and the option wins.

## What is DELETED, and it is deleted because the SDK now owns it

Line numbers current as of `master` today:

| Symbol | Line | Why it goes |
| --- | --- | --- |
| `HUB_DISCRETE_ENV_VARS` | 26 | the SDK owns the discrete-form list |
| `HubConfigPresence` / `hubConfigPresence` | 34 / 100 | two-forms detection and the mixed-forms refusal are the SDK's, and D3 makes its refusal STRICTER than ours: an operational key inside `FXL_HUB_CONFIG` is now also a hard refusal, which ours never checked |
| `HUB_FIELD_TO_DISCRETE_VAR` / `nameDiscreteVar` | 126 / 150 | existed only because the SDK named its JSON form; 2.3.0's `operationalMessage` names the discrete variable itself, with the fix command |
| the `healthToken` requirement | 171 | REPLACED by check 6, not dropped. Prove the replacement with a test before deleting ours |
| `resolveHubRedirectUri` | `app-auth.ts:133` | REPLACED by `config.redirectUri` plus check 7, which is strictly stronger - see below |

## What SURVIVES, and must not be removed by tidiness

- **`tryLoadHubAuthConfig`** is the only fail-soft door and the sole reason
  `503 hub_auth_not_configured` still answers for a machine that has never been given credentials.
  `app-auth-unconfigured.test.ts` is its oracle and must stay green.
- **`hubEnvBag`** stops being a Hub bag but stays as the bridge: it still carries `NODE_ENV`,
  `CORS_ORIGIN` and the two `SALES_POST_LOGIN_*` names that `app-auth.ts:155` and `:159` read.
  Keep its sorted-key assertion in `auth-provider.test.ts`; it is the pin that catches the bag and
  the schema drifting apart, and it is the only thing that catches a bag-key rename, since
  `EnvLike` is an index signature and `tsc` will not.
- **The file header's no-blanket-try/catch rule.** A bad Hub configuration stays a BOOT FAILURE.

## `resolveHubRedirectUri` is replaced by something STRONGER, and the reasoning must not be garbled

There is NO presence rule for `FXL_HUB_REDIRECT_URI` in any environment. The shipped
`parseRedirectUri` returns `${apiUrl}/auth/callback` for an absent value unconditionally; the only
`environment` branch in it is the https-versus-http rule. Check 7 refuses on the ORIGIN of the
EFFECTIVE value.

Our current resolver is weaker in two ways: it keys on `NODE_ENV`, so a staging deploy running
`NODE_ENV=production` is judged by the wrong variable, and nothing anywhere refuses a callback
pointed at the Hub's own origin.

DO NOT write a presence assertion to replace it. It would be a second, weaker encoding of a rule the
SDK owns, and it waves through the operator who pastes the Hub's own callback - the exact outage
check 7 exists to close.

The local development convenience (`${CORS_ORIGIN}/auth/callback`) is preserved by SETTING
`FXL_HUB_REDIRECT_URI=http://localhost:8006/auth/callback` in both `.env` examples in slice 06, not
by keeping a resolver. `CLAUDE.md` already documents exactly that value.

## Locked oracles

1. `app-auth-unconfigured.test.ts` - `503 hub_auth_not_configured` still answers with no credentials.
2. `app-auth-bff-production-boot.test.ts` - its exact `trustedOrigins` array assertion, now proving
   the contract-supplied value. RETITLE any test whose title names `CORS_ORIGIN` as the source, so
   it does not assert a provenance it no longer has.
3. `app-auth-bff-wiring.test.ts` - the two origin mount tests keep their assertions; the `__Host-`
   rotation test must stay green.
4. NEW: **`refuses a redirect uri on the Hub's own origin outside development`** - drives the real
   `assertBootConfiguration` and pins check 7. This is the protection we did not have before and it
   must be proven, not assumed.
5. NEW: **`refuses a missing health token outside development`** - pins check 6 as the replacement
   for the deleted local check. Write this BEFORE deleting ours and watch it pass against the SDK.

## Non-vacuity required

For each of the two NEW oracles, disable the SDK call path (or pass a value that satisfies it) and
confirm the test goes RED. A boot assertion nobody proves is a boot assertion nobody has.
