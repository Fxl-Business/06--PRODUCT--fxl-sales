---
feature: hub-sdk-230-adoption
milestone: v3.1.0
---

# Adopt `@fxl-business/hub-sdk` 2.3.0, the canonical Hub env contract

## Frame

### The block is gone, and it was verified rather than assumed

The prep run parked because 2.3.0 did not exist. It does now:

```
$ npm view @fxl-business/hub-sdk versions --json
[... "2.2.0","2.3.0"]          dist-tags.latest = 2.3.0     published 2026-09-08T10:23:37Z
$ npm view @fxl-business/hub-sdk-testing dist-tags --json
{"latest":"2.3.0"}                                          published 2026-09-08T10:20:59Z
```

A teammate session reported a SPLIT registry - the twin published, the SDK not - and asked us to
stay parked. That was true for about 2m38s and is no longer true; the SDK landed three minutes after
the twin. Checked directly here rather than taken on trust, which is the only reason it was caught.

Before trusting the publish, the packaging was checked against this repo's scar from `1.3.0`, which
INSTALLED fine and then failed to RESOLVE because `main`/`types`/`exports` pointed at `./src/*.ts`
while `files` shipped only `dist`:

```
$ npm pack @fxl-business/hub-sdk@2.3.0 && tar tzf ...
package/dist (28 files), package/schema, package/MIGRATION.md, package/package.json   -- no src/
```

`main`, `types` and every `exports` entry point at `./dist/*`. The 1.3.0 shape is not repeated.

The contract is really in the shipped bundle and not only in the plan: grepping `dist` finds all
nine canonical names, the four operational fields (`redirectUri` 30 refs, `healthToken` 23,
`trustedOrigins` 20, `sessionEncryptionKey` 12) and ADR 0014's validation verbatim - the
`[0-9a-fA-F]{64}` regex and the `openssl rand -hex 32` message. `hono`'s peer is unchanged at
`>=4.12.28`, so the `pnpm-workspace.yaml` override does NOT move.

### Both parked stop conditions are answered by the shipped types, not by guesswork

**`healthToken`.** `config-*.d.ts` says of it: *"Whether it is REQUIRED is decided in `boot.ts`."*
The SDK's `boot.ts` is not something this repo consumes today, so a naive deletion of our own check
at `auth-provider.ts:171` would silently remove a boot failure. But `assertBootConfiguration` IS
exported from `@fxl-business/hub-sdk/server`, and it is where that rule lives. So our check is
REPLACED by the SDK's, not deleted.

**The post-login pair.** `CreateHubBffOptions` still declares `postLoginRedirect` and
`postLoginErrorRedirect` as code options, and the contract never claimed them. The prep run's rename
to `SALES_POST_LOGIN_*` stands, and stop condition 2 closes clean.

### `assertBootConfiguration` is the seam, reached THROUGH `createHubBff`, and it answers the `redirectUri` question the prep run refused to pre-answer

```ts
declare function assertBootConfiguration(input: BootAssertionInput): ResolvedHubConfig;
type ResolvedHubConfig = HubConfig & { redirectUri: string };
```

It folds every code-level override over the config value - and the SDK states that precedence
exactly once, *"in the spread inside `assertBootConfiguration`"* - applies every `parseHubConfig`
default, and enforces every boot rule. `redirectUri` is narrowed to `string` because check 7 refuses
anything else, including *any value whose origin equals the Hub's*, which is precisely the fxl-finance
outage.

That is strictly better than what this repo hand-rolls today. `resolveHubRedirectUri` throws only
when `NODE_ENV === 'production'`, so a STAGING deploy running `NODE_ENV=production` is judged by the
wrong key, and nothing anywhere refuses a callback pointed at the Hub's own origin.

So the answer is: delete `resolveHubRedirectUri`, adopt `assertBootConfiguration`, and set
`FXL_HUB_REDIRECT_URI` explicitly in both `.env` examples - `CLAUDE.md`'s own "Required API vars"
block already ships exactly the right value, `http://localhost:8006/auth/callback`. One canonical
variable, always set, no local resolver, and a LOUDER refusal than we have now.

### Acceptance criteria

1. Both apps pinned at exactly `2.3.0`, no caret, lockfile in the same commit.
2. `loadHubConfig` is the only env resolver for the Hub contract; the duplicated presence,
   discrete-naming and healthToken layers are gone.
3. The boot assertion runs, and runs EXACTLY ONCE. `createHubBff` calls
   `assertBootConfiguration` itself, so this repo does NOT call it separately: two calls with
   different option objects would validate one configuration and construct another, and the value
   they would silently disagree about is `redirectUri`, which is the divergence check 7 exists to
   catch. `createAppAuthBff()` runs at module top level in `server.ts`, so the assertion is a real
   boot failure and not a lazy one.
4. `trustedOrigins` and `redirectUri` come from the contract, not from `env.CORS_ORIGIN` and not
   from a local resolver.
5. No file under `apps/` reads a `FXL_HUB_*` name. The guard proves it mechanically.
6. `503 hub_auth_not_configured` still answers for a machine with no credentials at all.
7. Full suite, lint, type-check and a real build green at every merge.

### Out of scope

No deploy, no promotion, no tag. Gate 3 untouched. No change to the access gate, to tenant scoping,
or to the session store this repo keeps by its own recorded decision.

## Slice index

| # | Slice | Depends on | Wave |
|---|---|---|---|
| 04 | `sdk-230-bump` - version and lockfile only, no behaviour change | - | 1 |
| 05 | `contract-single-resolver` - the atomic flip onto `loadHubConfig` + `assertBootConfiguration` | 04 | 2 |
| 06 | `examples-docs-guard` - `.env` examples, `CLAUDE.md`, guard sweep | 05 | 3 |

Slice 05 is deliberately ONE atomic slice rather than three. `assertBootConfiguration` folds the
overrides AND returns the config `createHubBff` consumes, so splitting "resolve the config" from
"consume it" would leave the trunk half-migrated with a boot path that belongs to neither shape.
This repo has the precedent recorded in `nexo/state.json`: the 2.1.0 run shaped its early slices to
keep the trunk green and made the migration itself "the single atomic flip".
