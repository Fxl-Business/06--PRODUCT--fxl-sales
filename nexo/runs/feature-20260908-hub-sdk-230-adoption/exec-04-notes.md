# exec 04 - `sdk-230-bump`

Branch `feat/04-sdk-230-bump`, off `master` at `5eeff1e`.

## What shipped

`@fxl-business/hub-sdk` `2.2.0` -> `2.3.0`, EXACT and with no caret, in `apps/api/package.json` and
`apps/web/package.json`, with `pnpm-lock.yaml` in the same commit.

One file beyond the contract's `files_modified` list changed, and it is a TEST FIXTURE.
It is written up in full below rather than mentioned in passing, because the slice's own premise
was that the bump would be behaviour-neutral and it was not, quite.

## `@fxl-business/hub-sdk-testing` is genuinely not a dependency here

Verified rather than assumed, which the slice explicitly asked for:

```
$ grep -rn "hub-sdk-testing" --include=package.json --include=pnpm-lock.yaml .   # (excluding node_modules)
(no output)
```

So nothing had to move with it, and the exact-peer trap did not fire.

## The lockfile moved only the SDK

`git diff pnpm-lock.yaml` is 14 lines across 4 hunks and every one of them is the SDK: the two
importer specifiers, the `packages` resolution integrity, and the snapshot key.
Nothing else drifted. The install was scoped (`pnpm install --filter @fxl-sales/api --filter
@fxl-sales/web`) for exactly that reason.

`hono` was NOT touched. 2.3.0's peer is unchanged at `>=4.12.28`:

```
$ npm view @fxl-business/hub-sdk@2.3.0 peerDependencies
{ hono: '>=4.12.28' }
```

and the lockfile still records the resolution as `2.3.0(hono@4.12.28)`, i.e. the
`pnpm-workspace.yaml` override still pins the one Hono copy the BFF's `Context` identity depends on.

## The install RESOLVED, not merely downloaded

This repo's `1.3.0` scar is a package that installs fine and then cannot be resolved at import time.
Checked directly, from `apps/api`:

```
$ node -e "console.log(require.resolve('@fxl-business/hub-sdk'))"
.../node_modules/.pnpm/@fxl-business+hub-sdk@2.3.0_hono@4.12.28/node_modules/@fxl-business/hub-sdk/dist/index.cjs
$ node -e "console.log(require.resolve('@fxl-business/hub-sdk/server'))"
.../@fxl-business/hub-sdk/dist/server.cjs
$ node -e "console.log(require.resolve('@fxl-business/hub-sdk/client'))"
.../@fxl-business/hub-sdk/dist/client.cjs
```

and the ESM side, which is what both apps actually import:

```
esm root keys: 16      esm server keys: 5
requireHubAuth: function   createHubBff: function   assertBootConfiguration: function
```

The installed manifest reads `"version": "2.3.0"`, `main`/`types`/every `exports` entry points at
`./dist/*`, and there is no `src/` directory in the package at all. The 1.3.0 shape is not repeated.

(`require.resolve('@fxl-business/hub-sdk/package.json')` throws `ERR_PACKAGE_PATH_NOT_EXPORTED`.
That is the exports map being strict and is not a defect; the manifest was read off disk instead.)

## The finding: 2.3.0 is NOT behaviour-neutral for `assertBootConfiguration`

The first full run after the bump was `427 passed | 1 failed` in `apps/api`. Exactly one test moved:

```
FAIL src/middleware/__tests__/app-auth-bff-production-boot.test.ts
  > is refused at BOOT, not answered as a 503, when the health token is absent
AssertionError: expected [Function] to not throw an error but
  'HubConfigError: hub-sdk: redirectUri "https://hub.fxlbusiness.test/auth/callback" is on the
   Hub's own origin (apiUrl is "https://hub.fxlbusiness.test") and environment is "staging". ...'
  was thrown
```

### Why, established from the shipped bundles rather than inferred

Both versions were unpacked with `npm pack` and `assertBootConfiguration` compared directly in
`dist/server.js`. `redirectUri` appears **3** times in 2.2.0's server bundle and **14** times in
2.3.0's. The function changed in two ways:

1. Its first statement stopped being `parseHubConfig(input.config)` and became a SPREAD that folds
   the code-level `redirectUri`, `healthToken` and `trustedOrigins` overrides over the config
   before parsing. (This is the precedence rule the frame quotes: *"in the spread inside
   `assertBootConfiguration`"*.)
2. It gained two NEW checks at the end, after the healthToken check:
   - `redirectUri` must be an absolute http(s) URL;
   - outside development, its origin must NOT equal `originOf(config.apiUrl)`.

   and it now RETURNS `{ ...config, redirectUri }`, which is the `ResolvedHubConfig` narrowing.

`parseHubConfig` defaults an absent `redirectUri` to `${apiUrl}/auth/callback`. So a fixture that
does not name one lands on the Hub's own origin, and check 7 refuses it at `staging`.

### Why this is a fixture gap and not a production regression

Nothing in `apps/` calls `assertBootConfiguration` today. `apps/api/src/middleware/app-auth.ts`
imports only `createHubBff` and `requireHubAuth`. The only caller in the tree is this test, which
reaches into the SDK directly to pin the boot refusal. Adopting `assertBootConfiguration` in
production is slice 05's job and was deliberately not done here.

The other five tests in that same file all passed, and they depend on the module-load
`createAppAuthBff()` in `beforeAll` succeeding, which is the real production path.

### The fix, and why it is the minimal one

The test's own comment states its invariant: *"The two inputs differ in the health token and in
NOTHING else, so the throw cannot be blamed on some other missing member."* After the bump that was
no longer true - BOTH inputs threw, so the `not.toThrow()` half had silently stopped testing the
health token and started testing the redirect. Adding an explicit, browser-facing
`redirectUri: 'https://sales-api.fxlbusiness.test/auth/callback'` to the shared `base.config`
restores the health token as the single variable. One fixture line plus the comment recording why.

No assertion was relaxed, no `toThrow` was weakened, and the file still drives the REAL
`assertBootConfiguration`. Deleting the health token from the passing input still reddens it.

This is a finding, not a paper-over: the new refusal is precisely the improvement the frame is
adopting the SDK for, and the frame already says nothing in this repo currently refuses a callback
pointed at the Hub's own origin. Slice 05 will rework this test when it wires the real thing.

## Verification - real exit codes, real numbers

| Gate | Exit | Result |
| --- | --- | --- |
| `CI=true pnpm test` | `0` | shared-utils **80**, api **428**, web **784** |
| guard oracles (`node --test scripts/__tests__/*`) | `0` | **11** pass, 0 fail |
| `node scripts/no-legacy-auth.mjs` | `0` | - |
| `node scripts/no-legacy-env-names.mjs` | `0` | - |
| `node scripts/build-contract.mjs` | `0` | `build-contract: ok` |
| `pnpm run lint` | `0` | api + web clean |
| `pnpm run type-check` | `0` | 4 projects clean |
| `pnpm run build` | `0` | packages + api + web, real Vite build, `built in 1.98s` |

Every count is IDENTICAL to the pre-bump baseline (80 / 428 / 784 / 11). Nothing was added, removed
or skipped to reach that; the single failure above was repaired at the fixture, not by deleting or
loosening a test.

Named oracles, run in isolation as well as in the full suite:

```
✓ src/middleware/__tests__/app-auth-bff-production-boot.test.ts  (6 tests)
✓ src/middleware/__tests__/app-auth-access-gate.test.ts          (9 tests)
✓ src/middleware/__tests__/app-auth-bff-wiring.test.ts          (23 tests)
Tests  38 passed (38)
```

Both of the contract's named files are green driving the real `createHubBff` and the real verifier.

## Not done, on purpose

No `assertBootConfiguration`, `config.redirectUri`, `config.trustedOrigins` or `config.healthToken`
adopted in production code. No `pnpm-workspace.yaml` change. No `.env` example change. No doc
change. Those are slices 05 and 06.

Integration tests (`pnpm --filter @fxl-sales/api test:integration`) were not run: they need the
local Docker Postgres and this slice touches no SQL, no schema and no query.

## A concurrency collision the orchestrator should know about

At `07:39:34`, while this agent was mid-verification, a CONCURRENT process on this same branch made
`da43534 docs(nexo): amend slice 05 before execution, on two counts` and swept this agent's
uncommitted working tree into it. That commit's message is purely about slice 05, and its contents
were the two plan documents PLUS all four of this slice's code files - the two `package.json`s, the
lockfile and the boot test.

That was split back apart before this slice was committed, because a `docs(nexo)` commit carrying a
dependency bump and a lockfile is not a history this repo can read later:

- `3b6084d docs(nexo): amend slice 05 before execution, on two counts` - the two plan files,
  original message and author/committer dates preserved byte for byte.
- `9bb7f7a chore(deps): pin @fxl-business/hub-sdk at 2.3.0 in both apps` - this slice.

Nothing was lost, and that is asserted rather than assumed:

```
$ git diff --stat da43534 HEAD
 .../exec-04-notes.md   | 162 +++++++++++++++++++++
 1 file changed, 162 insertions(+)
```

The only difference between the original mixed commit's tree and the split branch's tree is this
notes file. The SHA `da43534` no longer exists on the branch; anything holding that SHA should read
`9bb7f7a` instead.

Two files were left dirty in the working tree on purpose, because they belong to the concurrent
process and not to this slice: `nexo/runs/feature-20260907-hub-env-contract-prep/AUDIT.md` and
`.../budget.json`, plus the untracked `nexo/runs/feature-20260908-hub-sdk-230-adoption/orchestrator-notes.md`.

One substantive thing to carry into slice 05 from that amendment, since it bears directly on the
finding above: `createHubBff` calls `assertBootConfiguration` ITSELF. So slice 05 must not call it
separately and then construct the BFF from a different object - `redirectUri` is precisely the value
the two would silently disagree about.
