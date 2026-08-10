# VERDICT: PASS

Verify sub-agent, slice `131-patch-removal`.
Branch `fix/hub-sdk-131-drop-patch`, change commit `04bf2151d4016c99d7ff9b78c20a43c01fef60ae`, baseline `master` at `6f6bf49`.
Working tree at start and at end carries only the untracked `.vscode/`, so nothing here mutated the repo.

## Command results

Exit codes were captured with `$?` after redirecting to a log file.
An early attempt used `${PIPESTATUS[0]}`, which is empty under zsh and reports nothing; every row below is a re-run with a real exit code.

| Command | Exit | Result |
| --- | --- | --- |
| `pnpm install --frozen-lockfile` | 0 | Lockfile up to date, resolution step skipped. |
| `pnpm run type-check` | 0 | 4 projects, all `Done`. |
| `pnpm run lint` | 0 | `apps/api` and `apps/web` eslint clean. |
| `pnpm test` | 0 | shared-utils 80, apps/api 382, apps/web 641. `no-legacy-auth` and `build-contract: ok`. |
| `pnpm run build` | 0 | packages, api and web all built. |
| `pnpm --filter @fxl-sales/api test:integration` | 0 | 25 files, 169 tests, against `06--product--fxl-sales-db-1` on port 5006. |

No test is skipped or marked todo anywhere in `apps/api/src`, `apps/api/test` or `apps/web/src`.

## Check 1. The pure-packaging-fix claim, verified from the registry

Both tarballs were fetched with `npm pack` and extracted, then compared file by file with `shasum -a 256`.
The registry shows exactly four published versions (`1.0.0`, `1.2.0`, `1.3.0`, `1.3.1`), `latest` is `1.3.1`, and `1.3.1` was published `2026-08-10T13:14:58Z`.

The two tarballs contain the identical set of 29 files, and neither ships a `src/` directory.
Eight files differ:

| File | Verdict |
| --- | --- |
| `dist/server.js`, `.cjs`, `.d.ts`, `.d.cts`, and both `.map` | BYTE-IDENTICAL |
| `dist/client.js`, `.cjs`, `.d.ts`, `.d.cts`, and both `.map` | BYTE-IDENTICAL |
| `dist/chunk-V26MVLPG.js` and `dist/chunk-XO3FVZPK.js` plus maps | BYTE-IDENTICAL |
| `dist/config-CvYwarJp.d.ts` / `.d.cts` | BYTE-IDENTICAL |
| `dist/session-store-COrln4Ro.d.ts` / `.d.cts` | BYTE-IDENTICAL |
| `schema/session-store.sql` | BYTE-IDENTICAL |
| `dist/index.js`, `.cjs`, `.d.ts`, `.d.cts` and maps | differ ONLY by `HUB_SDK_VERSION = "1.3.0"` to `"1.3.1"` |
| `package.json` | the packaging fix |
| `MIGRATION.md` | documentation only, see below |

The author's claim is CONFIRMED.
`dist/server.*`, `dist/client.*` and both chunks are byte-identical, and the only executable difference in the whole package is the one-line `HUB_SDK_VERSION` constant.

`package.json` is the fix itself.
`1.3.0` shipped top-level `main: "./src/index.ts"`, `types: "./src/index.ts"` and `exports` pointing at `./src/*.ts`, with the correct `dist` pointers sitting unused inside `publishConfig`.
`1.3.1` has the `publishConfig` swap applied: top-level `main: "./dist/index.cjs"`, `module: "./dist/index.js"`, `types: "./dist/index.d.ts"` and the three-subpath `exports` map with `import`/`require` conditions.
That is field for field what the deleted `patches/@fxl-business__hub-sdk@1.3.0.patch` produced, including the `module` key, so the resolution graph the repo was already running under the patch is exactly the resolution graph it now gets from the registry.
Publish-side residue also changed and has no consumer effect: `prepublishOnly` is gone from `scripts`, an `assert:publishable` script was added, and the two `workspace:*` devDependencies resolved to `1.0.0`.

`MIGRATION.md` gained one block and changed nothing else.
The new text is a caveat, credited to a consumer report, stating that `hub.getToken()` returns `Promise<string | null>` and collapses `401`, `503`, `502`, malformed and network failures into `null`, so the refresh classification exists on the wire and is discarded one layer up.
It then recommends calling `/auth/refresh` directly with `credentials: 'include'` and branching on `res.status`.
This is documentation, not behaviour, and it independently endorses the pattern `apps/web/src/auth/refresh.ts` already implements.

Conclusion on risk: because `dist/server.*` is byte-identical, every server-side oracle in this feature and every `dist/server.js:NNN` line citation in the code comments and in `nexo/ROADMAP.md` (`:275-277`, `:279`, `:407-413`, `:464`, `:467`, `:519`) remains exactly valid on `1.3.1`.
The existing oracles are sufficient and their risk profile is unchanged.

## Check 2. No trace of the patch remains

- `patches/` does not exist. `ls patches` returns `No such file or directory`.
- `patchedDependencies` appears in no configuration file. `grep` over `pnpm-lock.yaml` and `pnpm-workspace.yaml` returns nothing, and no `patch_hash` remains in the lockfile.
- The only tracked `patchedDependencies` hits are prose: `CLAUDE.md:51`, which states the entry has been deleted, and four lines under `nexo/runs/feature-20260807-hub-sdk-130-session-hardening/` (`notes-01.md`, `verify-01.md`), which are immutable historical run captures. Neither is a live reference.
- `pnpm-lock.yaml` records `@fxl-business/hub-sdk@1.3.1` at lines 745 and 3235, with both importers resolving `1.3.1(hono@4.12.28)`. No `1.3.0` entry survives.
- The installed directory, reached by following the symlink from both apps, is `node_modules/.pnpm/@fxl-business+hub-sdk@1.3.1_hono@4.12.28/node_modules/@fxl-business/hub-sdk`. It reports `version: 1.3.1` and contains only `dist`, `schema`, `MIGRATION.md` and `package.json`. There is no `src/`, confirmed for both `apps/api` and `apps/web`.
- `nexo/ROADMAP.md` no longer carries the patch entry. Its two surviving `1.3.0` mentions are the `hub_bff_sessions.account_id` chore and the Hub-side revoke chore, both of which describe behaviour that is byte-identical on `1.3.1` and are therefore still accurate.

## Check 3. All three entry points resolve at runtime without the patch

A type-check alone would not prove this, so each was imported for real.

From `apps/api`, ESM:

- `@fxl-business/hub-sdk` imported, `HUB_SDK_VERSION = 1.3.1`, 8 exported symbols.
- `@fxl-business/hub-sdk/server` imported, exports `createHubBff, requireHubAuth`, `typeof createHubBff === 'function'`.

From `apps/api`, CJS `require()`: both the root and `/server` resolve, root reports `1.3.1`.
This matters because the `1.3.1` `exports` map declares separate `import` and `require` conditions and only the `import` half is exercised by the app.

From `apps/web`, ESM:

- `@fxl-business/hub-sdk/client` imported, exports `createHubClient`, `typeof createHubClient === 'function'`.
- `@fxl-business/hub-sdk` root also imported, `1.3.1`.

These are the three subpaths the repo actually consumes: `apps/api/src/middleware/app-auth.ts:2` takes `/server`, `apps/web/src/auth/react.tsx:2` takes `/client`, and six files take the root for types plus `InMemoryHubSessionStore`.

## Check 4. Clean-clone deploy simulation

This is the check that matters, given the v2.3.0 history of a locally green build failing the Vercel deploy on workspace subpath resolution.

- Cloned the repo to a temp directory and checked out `04bf2151d4016c99d7ff9b78c20a43c01fef60ae`. `git rev-parse HEAD` confirms the commit.
- The clone arrived with no `node_modules`, no `*.tsbuildinfo` outside `node_modules`, and no `patches/` directory. A `find`-and-delete for `*.tsbuildinfo` was run anyway before building, so nothing could be incrementally short-circuited.
- `pnpm install --frozen-lockfile` exit `0`.
- The SDK resolved in the clone to `.pnpm/@fxl-business+hub-sdk@1.3.1_hono@4.12.28/...`, `version: 1.3.1`, with no `src/`.
- `pnpm --filter @fxl-sales/web build` exit `0`. That script is `pnpm --filter @fxl-sales/web^... build && tsc --noEmit && vite build`, so it built the workspace dependencies, type-checked, and produced the Vite bundle (`✓ built in 1.70s`, `index-HI9xnWXq.js` 251.53 kB).

The clean-clone build SUCCEEDS. The temp clone has been deleted.

## Check 5. Negative control

Two layers.

First, the structural one asked for: the clean clone contains no `patches/` directory, so there is no local bridge that could have silently rescued a bad resolution. The install there had to resolve `1.3.1` straight from the registry.

Second, a stronger empirical control. A throwaway project was created outside the repo declaring `"@fxl-business/hub-sdk": "1.3.0"` and `hono@4.12.28`, and installed with plain `npm install`.

- The install SUCCEEDED, exit `0`. The package unpacked with `dist`, `schema`, `MIGRATION.md`, `package.json` and, critically, `has src/? NO`, while `main` read `./src/index.ts`.
- `await import('@fxl-business/hub-sdk/server')` then FAILED with `Error [ERR_MODULE_NOT_FOUND]: Cannot find module .../node_modules/@fxl-business/hub-sdk/src/server.ts`.

So the exact probe used in check 3, which passes on `1.3.1`, demonstrably fails on `1.3.0`.
The harness is a genuine discriminator and not a test that passes unconditionally.
This also independently reproduces the original bug and confirms the premise of the whole change.

## Check 6. The hono override survives

Followed symlink targets rather than listing `.pnpm`.

- `apps/api/node_modules/hono` resolves to `node_modules/.pnpm/hono@4.12.28/node_modules/hono`, version `4.12.28`.
- Enumerating every `hono` symlink under `apps`, `packages` and `node_modules` to depth 3 and de-duplicating the real targets yields exactly ONE path: `.pnpm/hono@4.12.28/node_modules/hono`.
- The SDK's own peer directory is `.pnpm/@fxl-business+hub-sdk@1.3.1_hono@4.12.28/node_modules/hono`, and the `_hono@4.12.28` suffix in the store key is pnpm recording that this is the peer it was resolved against.
- The installed `1.3.1` declares `peerDependencies: {"hono": ">=4.12.28"}`. `4.12.28` satisfies it.
- The override is intact at `pnpm-workspace.yaml:17` (`hono: 4.12.28`) and `apps/api/package.json:27` (`"hono": "4.12.28"`).

Exactly one hono version, and it satisfies the peer range. The BFF's `Context` is the same one `server.ts` composes with.

## Check 7. No behavioural regression

All nine guarantees have present oracle tests, and every file listed below appears with a `✓` in the captured suite logs.

| Guarantee | Oracle | Status |
| --- | --- | --- |
| Row lock inside `withSession` spanning read and write | `apps/api/test/rls/hub-bff-session-store.test.ts:136` `serializes two concurrent refreshes on one session id so no rotation is lost` (1023 ms, so it genuinely blocked), `:195` `does not block a different session id while one row lock is held`, and `apps/api/src/auth/__tests__/hub-session-store.test.ts:183` | GREEN, 19 tests |
| 503 not 401 on store outage | `apps/api/src/auth/__tests__/hub-bff-errors.test.ts`, including `:122` `degrading to a null store read instead of throwing would be visible as a cookie-clearing 401` | GREEN, 5 tests |
| PKCE single-use | `hub-bff-session-store.test.ts:355` `consumes a login transaction exactly once across instances`, `:372` expired-consume returns null | GREEN |
| 90-day absolute TTL a rotation cannot extend | `hub-session-store.test.ts:232`, `:246`, `:264` `does not extend the absolute expiry when the SDK spreads the record back into update`, `:295`; and `hub-bff-session-store.test.ts:266`, `:292`, `:306` `does not move absolute_expires_at when a rotation slides expires_at` | GREEN |
| Refresh classification, only a 401 tears the session down | `apps/web/src/auth/__tests__/refresh.test.ts` (15 tests) plus `react.test.tsx:550` `signs out at once when the BFF says the session expired, without entering the ladder`, `:571` transient keeps the session, `:624` cold start | GREEN |
| Ladder consecutive-failure reset | `react.test.tsx:676` `resets the ladder after each recovery, so unrelated blips never accumulate`, plus `:728` and `:756` unmount guards | GREEN |
| Durable logout intent | `session-recovery.test.ts:261/269/273` plus `react.test.tsx:971` `does not auto-login while the logout intent is set`, `:984`, `:1006`, `:1029` `clears the intent whenever a live token is observed` | GREEN, 51 + 34 tests |
| Three query-cache flush sites | `react.test.tsx:1081` `drops every cached entry on logout`, `:1100` `drops every cached entry on a workspace switch`, `:1280` `keeps the cache when the revalidation ladder recovers from a blip`, with `:1129` and `:1161` guarding the in-flight and superseded switch | GREEN |
| Login supersede plus its memory-path guard | `apps/api/test/rls/hub-bff-login-supersede.test.ts` (3 tests, through the real SDK BFF), `apps/api/src/auth/__tests__/hub-login-scope.test.ts` (4 tests), and `apps/api/src/middleware/__tests__/app-auth-bff-memory-path.test.ts:72` `falls back to the SDK in-memory store` (2 tests) | GREEN |

The `1.3.1` claim and these oracles reinforce each other.
Because `dist/server.js` is byte-identical, the integration tests that drive the real SDK BFF (`hub-bff-login-supersede.test.ts`, `hub-bff-session-store.test.ts`) are exercising the same bytes they were verified against on `1.3.0`.

## Check 8. Docs accuracy

`CLAUDE.md` no longer instructs anyone to delete a patch.
The old three-line paragraph beginning "The published `@fxl-business/hub-sdk@1.3.0` tarball is BROKEN" is replaced by a paragraph that states the floor is `^1.3.1`, that it is a PACKAGING floor and not a behavioural one, and why.
`nexo/ROADMAP.md` no longer carries the "delete the patch" entry.

Every factual claim in the new text was checked against the artifacts:

- "`dist/server.*`, `dist/client.*` and both chunks are BYTE-IDENTICAL to `1.3.0`" - TRUE, verified by sha256 above.
- "the only code difference in the whole package is the `HUB_SDK_VERSION` constant" - TRUE.
- "every behavioural statement in this section that says 'as of 1.3.0' is still exactly true on `1.3.1`" - TRUE, and it is the right way to have handled the surviving `1.3.0` references at lines 32 and 34 rather than rewriting citations that were verified against a specific bundle.
- "the bundled client through at least `1.3.1` still declares `Promise<string | null>` and discards `res.status`" - TRUE. `dist/client.d.ts:39` reads `getToken(): Promise<string | null>`, and `dist/client.js:47-48` reads `if (res.status !== 200) { return null; }`.
- "the SDK's own `MIGRATION.md` now carries a caveat confirming it and recommending exactly this direct-fetch pattern" - TRUE, that block is precisely what the `1.3.0` to `1.3.1` `MIGRATION.md` diff adds.

One imprecision, flagged and not blocking.
Line 51 says "`1.3.0` is uninstallable".
It is not: my negative control installed `1.3.0` with exit `0`, and what failed was resolution of its entry points at import time (`ERR_MODULE_NOT_FOUND` on `src/server.ts`).
The two sentences directly above it state this correctly ("neither Node nor Vite could resolve the package at all"), so the paragraph as a whole is not misleading, but the single word "uninstallable" is loose.
It would read truer as "unresolvable".

## Green but worth knowing

1. The dependency range is `^1.3.1` in both apps, so a non-frozen `pnpm install` after the Hub publishes a `1.4.x` would take it without review. Deploy and CI use `--frozen-lockfile`, and this is the same caret shape the repo already had at `^1.3.0`, so it is not a regression introduced here. Noting it only because this change's entire subject is dependency resolution.
2. `nexo/runs/feature-20260807-hub-sdk-130-session-hardening/sdk-1.3.0/` still holds the staged copy of the `1.3.0` tarball, and `nexo/ROADMAP.md:31` cites `sdk-1.3.0/session-store.sql`. This is a historical run artifact, not a patch trace, and `schema/session-store.sql` is byte-identical between the two releases, so the citation is still accurate. No action needed.
3. `pnpm install` in the clean clone emitted `Ignored build scripts: esbuild`. This is pnpm's default postinstall gating, it did not stop the Vite build from succeeding, and it is pre-existing rather than introduced by this change.
4. The `1.3.1` `package.json` ends without a trailing newline. Cosmetic, upstream, no effect.

## Cleanup

The temp clone, the negative-control project and the extracted tarballs under the session scratchpad have been removed.
`git status --porcelain` in the repo returns only `?? .vscode/`, matching the state at the start of this verification.
