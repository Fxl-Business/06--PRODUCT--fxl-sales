# Verify - slice 04 `sdk-230-bump`

Branch `feat/04-sdk-230-bump`, two commits ahead of `master` (`a7f692b`).
Graded adversarially by an agent that did not write the slice and did not open the context pack.

Verdict: **PASS**. All eight criteria pass. No defect found. The non-neutral half of the bump was handled honestly and is provably still non-vacuous.

## Scope confirmation

`git show --name-only --format="" 3b6084d`

```
nexo/plans/feature-20260908-hub-sdk-230-adoption/00-OVERVIEW.md
nexo/plans/feature-20260908-hub-sdk-230-adoption/05-contract-single-resolver.md
```

Confirmed: the orchestrator's plan commit touches exactly those two plan documents and nothing under `apps/`, `packages/` or `scripts/`. Excluded from scope judgement, no finding.

`git show --name-only --format="" 4821d6b` - the slice:

```
apps/api/package.json
apps/api/src/middleware/__tests__/app-auth-bff-production-boot.test.ts
apps/web/package.json
nexo/runs/feature-20260908-hub-sdk-230-adoption/exec-04-notes.md
pnpm-lock.yaml
```

Two version strings, one lockfile, one test fixture line, one run note. No production source file.

## 1. Pins - PASS

```
-    "@fxl-business/hub-sdk": "2.2.0",     apps/api/package.json
+    "@fxl-business/hub-sdk": "2.3.0",
-    "@fxl-business/hub-sdk": "2.2.0",     apps/web/package.json
+    "@fxl-business/hub-sdk": "2.3.0",
```

Exactly `2.3.0` in both apps. No caret, no range, no `~`.

## 2. Lockfile moved the SDK and nothing else - PASS

`git diff master...HEAD -- pnpm-lock.yaml` is four hunks, 7 changed lines, all of them the SDK:

1. `importers.apps/api` - specifier `2.2.0` -> `2.3.0`, version `2.2.0(hono@4.12.28)` -> `2.3.0(hono@4.12.28)`.
2. `importers.apps/web` - the same two lines.
3. `packages` - the package key and its `resolution.integrity` (`sha512-/yH4np...` -> `sha512-DHUI/q...`).
4. `snapshots` - the snapshot key, with its `dependencies` block (`hono: 4.12.28`, `jose: 5.10.0`) unchanged as context.

No other package name appears anywhere in the diff. No transitive drift: `jose` stays `5.10.0`, `hono` stays `4.12.28`.

Sync proven, not assumed:

```
$ pnpm install --frozen-lockfile --offline
Lockfile is up to date, resolution step is skipped
frozen-lockfile EXIT:0
```

## 3. `hono` untouched - PASS

`git diff master...HEAD -- pnpm-workspace.yaml` is EMPTY. The override still reads `hono: 4.12.28` at line 17 of the `overrides:` block.

One hono in the lockfile, at one version:

```
$ grep -n "^  hono@" pnpm-lock.yaml
2059:  hono@4.12.28:
4498:  hono@4.12.28: {}
```

Two lines, one version - the `packages` entry and the `snapshots` entry for the same `hono@4.12.28`. There is no second resolution, so the BFF `Context` is still the one `server.ts` composes with. The installed 2.3.0 manifest declares `peerDependencies: { hono: ">=4.12.28" }`, which the workspace override pins down to the single copy.

## 4. The install RESOLVED, not merely downloaded - PASS

Real ESM resolution from `apps/api`, both entry points:

```
$ node --input-type=module -e "
  const root = await import('@fxl-business/hub-sdk');
  const s = await import('@fxl-business/hub-sdk/server');
  ..."
root OK, keys: 16
server OK, has assertBootConfiguration: function
server keys: assertBootConfiguration,assertConformantSessionStore,createHubBff,organizationScope,requireHubAuth
EXIT:0
```

Installed manifest (`apps/api/node_modules/@fxl-business/hub-sdk/package.json`, realpath `node_modules/.pnpm/@fxl-business+hub-sdk@2.3.0_hono@4.12.28/...`):

- `"version": "2.3.0"`
- `"main": "./dist/index.cjs"`, `"module": "./dist/index.js"`, `"types": "./dist/index.d.ts"`
- `exports` `.` / `./server` / `./client`, every one of the twelve leaves under `./dist/`
- `"files": ["dist","schema","MIGRATION.md"]`

Package contents on disk: `dist/`, `schema/`, `MIGRATION.md`, `package.json`. `find ... -name "*.ts" -path "*src*"` returns nothing - the package ships NO `src/`, so the 1.3.0 scar (manifest pointing at `./src/*.ts` absent from the tarball) is not reproduced. `apps/web/node_modules/@fxl-business/hub-sdk` symlinks to the same `.pnpm` store entry, so both apps resolve one copy at 2.3.0.

## 5. NO new API adopted in production code - PASS

```
$ grep -rn "assertBootConfiguration" apps packages   (node_modules excluded)
apps/api/src/middleware/app-auth.ts:236          <- a COMMENT, byte-unchanged by this slice
apps/api/src/middleware/__tests__/app-auth-bff-production-boot.test.ts:21,138,159,160
```

(plus the same four lines mirrored in the untracked, gitignored `apps/api/dist/` build output.)

The only call sites are the two `expect()` lines inside the boot test, and that import predates the slice. Nothing in `apps/` or `packages/` calls it in production, so this really is a fixture gap and not a production regression.

Added lines in the slice touching the three new-API names:

```
$ git show 4821d6b -- apps packages | grep -E "^\+.*(redirectUri|trustedOrigins|healthToken)"
+      `redirectUri` is a MEMBER of that pairing and not decoration.      (comment)
+      have, and `parseHubConfig` defaults an absent `redirectUri` to     (comment)
+        redirectUri: 'https://sales-api.fxlbusiness.test/auth/callback', (fixture value)
```

No `config.redirectUri`, `config.trustedOrigins` or `config.healthToken` read was added anywhere. One fixture value and ten comment lines. Permitted, and criterion 6 holds.

## 6. The fixture repair is honest - PASS (the criterion that matters)

The change is ONE added line inside the `base` fixture of `is refused at BOOT, not answered as a 503, when the health token is absent`, plus a ten-line comment recording why. **No assertion was touched.** The two assertions are byte-identical to `master`:

```ts
expect(() => assertBootConfiguration({ ...base })).toThrow();
expect(() => assertBootConfiguration({ ...base, healthToken: HEALTH_TOKEN })).not.toThrow();
```

### 6a. The two inputs still differ in the health token and in NOTHING else

Driven against the real installed 2.3.0 with the committed fixture, printing the thrown `HubConfigError.field`:

```
--- as committed ---
no healthToken    -> THROW field= healthToken msg= hub-sdk: healthToken is required when environment is 'staging'...
with healthToken  -> NO THROW
```

The throwing half throws for the health token specifically - `field === 'healthToken'` - so the `toThrow()` cannot be passing for the wrong reason. The fixture `apiUrl` is `https://hub.fxlbusiness.test` and the added `redirectUri` is on `https://sales-api.fxlbusiness.test`, a different origin, so redirect check 8 is satisfied for BOTH inputs and drops out of the pairing entirely. The health token is the single variable again.

### 6b. Removing the health token from the passing input still reddens it - PROVEN

Mutation applied to the real file, real run-once vitest:

```
$ CI=true npx vitest run src/middleware/__tests__/app-auth-bff-production-boot.test.ts   # baseline
 Test Files  1 passed (1)
      Tests  6 passed (6)

# MUTATION 1: expect(() => assertBootConfiguration({ ...base })).not.toThrow();
 Test Files  1 failed (1)
      Tests  1 failed | 5 passed (6)
```

RED. The test is not vacuous.

### 6c. The fixture line is load-bearing, not decoration - PROVEN

Reverting the fixture to its `master` shape (delete the `redirectUri` line) against 2.3.0:

```
# MUTATION 2: fixture reverted to master
 Test Files  1 failed (1)
      Tests  1 failed | 5 passed (6)      <- fails at line 159, the not.toThrow() half
```

And the direct probe explains exactly why:

```
--- MUTATION A: revert fixture (no redirectUri) ---
no healthToken    -> THROW field= healthToken
with healthToken  -> THROW field= redirectUri  msg= redirectUri "https://hub.fxlbusiness.test/auth/callback" is on the Hub's own origin...
--- MUTATION B: redirectUri on the Hub origin ---
with healthToken  -> THROW field= redirectUri
```

So the implementer's account is exactly right: without the fixture line, `parseHubConfig` defaults `redirectUri` to `${apiUrl}/auth/callback`, both inputs throw, and the `not.toThrow()` half would have gone red - the bump genuinely was NOT behaviour-neutral. The repair restored the property under test rather than removing it.

Working tree restored after both mutations; `git diff --stat` on the file is empty.

### 6d. The 2.3.0 claim verified independently

I read the installed `dist/server.js` myself. 2.3.0's `assertBootConfiguration` ends with two checks that operate on `config.redirectUri` (which it now spreads in from `input.redirectUri` before `parseHubConfig`):

- `typeof redirectUri !== 'string' || callbackOrigin === null` -> not an absolute http(s) URL
- `!isDevelopment && callbackOrigin === originOf(config.apiUrl)` -> "is on the Hub's own origin"

I then recovered the **2.2.0** `dist/server.js` from the pnpm content-addressable store (`files/2a/74be219022fa...`, identified by size 32366 and confirmed as 2.2.0 by the presence of the `__Host-fxl_hub_session` parser and `trustedOrigins`, both 2.2.0 features). Its `assertBootConfiguration` is `parseHubConfig(input.config)` followed by four checks, ending at `healthToken`, and reads `input.healthToken` rather than `config.healthToken`. There is **no** redirect check and no `REDIRECT_URI_ADVICE` in the file at all.

The claim is TRUE. The fixture change has no other possible cause.

Nit, not a defect: the added comment calls the value "the BROWSER-facing origin", while `sales-api.fxlbusiness.test` is the API origin (the browser-facing web origin in this file is `sales.fxlbusiness.test`). The VALUE is correct - it matches the `FXL_HUB_REDIRECT_URI` stubbed forty lines above, matches the deployed topology, and satisfies the only property the check cares about, which is "not the Hub's origin". Only the word is loose.

## 7. Counts unmoved - PASS

```
$ CI=true pnpm test
TEST_EXIT:0
packages/shared-utils  Test Files  3 passed (3)    Tests  80 passed (80)
apps/api               Test Files 42 passed (42)   Tests 428 passed (428)
apps/web               Test Files 56 passed (56)   Tests 784 passed (784)
guard oracles          1..11  # tests 11  # pass 11  # fail 0
build-contract: ok
```

80 / 428 / 784 / 11, exactly the stated pre-bump baseline. Nothing was added, skipped or removed.

## 8. Full green - PASS

| Command | Exit |
| --- | --- |
| `pnpm install --frozen-lockfile --offline` | 0 |
| `pnpm run lint` | 0 |
| `pnpm run type-check` | 0 |
| `CI=true pnpm test` | 0 |
| `pnpm run build` | 0 |
| `node scripts/no-legacy-auth.mjs` | 0 |
| `node scripts/no-legacy-env-names.mjs` | 0 |

The build is REAL: `*.tsbuildinfo` deleted and `apps/api/dist`, `apps/web/dist`, `packages/*/dist` removed first, so nothing was served from an incremental cache. It rebuilt clean and vite reported `built in 1.70s` with the full asset manifest.

## Conventions

- Em dashes in the slice diff: grepping the diff for U+2014 returns a count of **0**.
- Attribution: `git log --format="%H%n%B" master..HEAD | grep -iE "co-authored-by|claude|generated with|Claude-Session"` -> **no match** in either commit message.
- No `.env` example, no doc and no `CLAUDE.md` changed in the slice commit. The only non-code file is the run note `nexo/runs/.../exec-04-notes.md`.
- No watching test runner was used; every vitest invocation was `vitest run`. No process was killed by name.

## Was the non-neutral bump handled honestly, or papered over?

**Handled honestly.** The evidence is positive on three independent axes, each checked by me rather than taken from the notes:

1. **The assertions are unchanged.** The diff to the test file is one added fixture member and a comment. `toThrow()` and `not.toThrow()` are byte-identical to `master`. Nothing was relaxed to `toThrow(/health/)`, nothing was `skip`ped, no try/catch was introduced.
2. **The test is still non-vacuous, proven by mutation.** Deleting the health token from the passing input turns the test RED (mutation 1). The property the test exists to prove is still the property it proves, and the throw is attributable to `field: 'healthToken'` rather than to some unrelated missing member.
3. **The fixture line was necessary and is minimal.** Reverting it turns the test RED against 2.3.0 (mutation 2), for the redirect reason, on the `not.toThrow()` half - which is precisely the "stopped testing what it exists to test" failure the implementer described. Naming a non-Hub origin is the smallest change that restores the single variable, and it is a test-only value: `assertBootConfiguration` has no production caller in this repo.

The commit message declares the non-neutrality up front rather than describing the slice as a clean version bump, which is the disclosure this gate is looking for. Nothing was papered over.

## Addendum - the branch moved under me, mid-verification

At the start of this run, `HEAD` was `4821d6b` on `feat/04-sdk-230-bump`, two commits ahead of `master` at `a7f692b`, exactly as briefed. By the end of the gate runs the orchestrator had merged the slice and moved on: `HEAD` is now `5c7ff66` on `feat/05-contract-single-resolver`, over `b6eb877 Merge branch 'feat/04-sdk-230-bump'`.

This does not affect the verdict, and I checked rather than assumed:

```
$ git merge-base --is-ancestor 4821d6b HEAD          -> YES
$ git diff --stat 4821d6b b6eb877 -- apps packages scripts pnpm-lock.yaml pnpm-workspace.yaml
(empty)
$ git diff --stat 4821d6b HEAD    -- apps packages scripts pnpm-lock.yaml pnpm-workspace.yaml
(empty)
$ git show --name-only --format="" 5c7ff66
nexo/runs/feature-20260908-hub-sdk-230-adoption/orchestrator-notes.md
```

The merge introduced no code, and the only commit after it touches one nexo note. Every gate I ran therefore saw the exact slice tree, byte for byte. Recorded here rather than left to be noticed, since the merge landed before this verification returned its verdict.
