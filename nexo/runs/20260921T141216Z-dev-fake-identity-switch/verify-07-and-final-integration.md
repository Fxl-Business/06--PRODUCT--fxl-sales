# Verify: 07-docs-reconciliation + final integration gate

**Verdict: FAIL**

The full test/lint/type-check/build tier is green, the reconciliation guard
genuinely bites, and every documentation clause I could check against the
*source* is true. But one load-bearing security claim in the new
`## Development identity mode` section of `CLAUDE.md` is **false when checked
against the actual shipped production artifact** (`apps/api/Dockerfile`, the
same file `docker-compose.yml` and Coolify build from). I built that
Dockerfile unmodified and proved the fake-identity package ships inside the
production image. This is exactly the class of defect this verify task exists
to catch ("documentation that reads well and is false is worse than none"),
and it is a security-relevant claim in a document this repository treats as
law, so I am not passing it forward.

Everything else below is reported for completeness; only the headline finding
in Part 4 is why this fails.

---

## Part 1 - clause-by-clause documentation check

Checked against real source, not against the prose's own internal consistency.

| Claim | Verified against | Result |
|---|---|---|
| Flag names `SALES_AUTH_FAKE` / `VITE_AUTH_FAKE` | `apps/api/src/auth/select.ts` (`isFakeAuthRequested` reads `env.SALES_AUTH_FAKE`), `apps/web/src/dev/install-dev-identity.ts` (`import.meta.env.VITE_AUTH_FAKE`) | TRUE |
| `make dev-fake` / `back-fake` / `front-fake` exist and set the right flags | `Makefile` lines 51-72 | TRUE |
| Both `.env` examples ship the flags commented | `apps/api/.env.example:157`, `apps/api/.env.dev.example:171`, `apps/web/.env.example:27`, `apps/web/.env.dev.example:30` - all `#`-commented | TRUE |
| `env-example-contract.test.ts` pins both flags absent/commented in all four files | `apps/api/src/config/__tests__/env-example-contract.test.ts:284-346` | TRUE |
| `packages/auth-fake` is a devDependency of both apps, never a dependency | `apps/api/package.json`, `apps/web/package.json` - both list `"@fxl-sales/auth-fake": "workspace:*"` under `devDependencies` only | TRUE (as a `package.json` fact) |
| Every access is a dynamic import; sanctioned seams are `apps/api/src/auth/select.ts` and `apps/web/src/dev/install-dev-identity.ts` | Read both files; both use `await import('@fxl-sales/auth-fake')`/`await import('../middleware/app-auth.js')`, never a static or type-only import | TRUE |
| Web half sits behind `import.meta.env.DEV`, eliminated by `vite build` | `install-dev-identity.ts`'s `DEV_IDENTITY_ENABLED = import.meta.env.DEV`; I ran the real `pnpm run build` and `assert-web-bundle-clean.mjs` reported `FXL_SALES_DEV_FAKE_ROSTER_SENTINEL is absent from apps/web/dist and still present under packages/auth-fake/src` | TRUE, for the Vite/static-asset deployment path (Vercel) |
| API refuses to boot with the flag set under `NODE_ENV=production` | `apps/api/src/middleware/app-auth.ts` `installAppAuthAdapter` throws `DEV_IDENTITY_ADAPTER_IN_PRODUCTION_MESSAGE`; reproduced live (see Part 4) | TRUE, and it is the ONLY thing standing between the API and a live bypass in the real deployment artifact (see Part 4) |
| `scripts/__tests__/auth-fake-isolation.test.mjs` proves the four layers and proves itself against mutated fixtures | Read the file (629 lines); ran it as part of the full suite (21 real tests, matches its own documented tripwire) | TRUE, but it only ever inspects the **source tree** - it never builds or inspects the actual Docker artifact, so it cannot and does not catch the Part 4 finding |
| Roles travel the real translation (`getRolesFromHubClaims`, `getVisibleWorkspaces`), nothing hands a ready-made profile | `packages/auth-fake/src/index.ts` emits Hub-shaped claims only; `apps/web/src/auth/claims.ts:21-32` and `apps/web/src/sales-ops/navigation.ts:116-126` are the real functions, unmodified | TRUE |
| Every admin-yielding branch of `getRolesFromHubClaims` returns the same `fullAccessRoles` literal, so `['admin']` alone is unreachable | Read `claims.ts` lines 11-32 directly: `isSuperAdmin`, `workspaceRole === 'owner'`, `workspaceRole === 'admin'`, and `productRoles.has('admin')` all `return fullAccessRoles` | TRUE |
| Roster carries `team-owner`/`team-admin`/`product-admin` exercising the three different admin-yielding shapes, and a named test records the `['admin']`-alone gap | `packages/auth-fake/src/index.ts` roster entries 1-3; `packages/auth-fake/src/__tests__/roster.test.ts:76-90` (`records that the admin-only role set is unreachable...`) | TRUE |
| The three named test files exist and are what's claimed | `apps/web/src/dev/__tests__/dev-identity-isolation.test.ts`, `dev-identity-roles.test.tsx`, `dev-identity-switcher.test.ts`; `apps/api/src/auth/__tests__/dev-identity-{flag,hub-config-independence,no-hub,production-refusal}.test.ts` all present and executed in the full run (part of the 601 api / 940 web passing tests) | TRUE |
| **"the production install and the production image do not contain it at all"** and **"Layers one to three make the fake ABSENT from the production artifact by construction"** | Built the real, unmodified `apps/api/Dockerfile` end to end | **FALSE - see Part 4** |

Part 2 and Part 3 checks (below) also passed.

## Part 2 - the three things that must not have happened

1. **Sales Ops Routing sentence** - `CLAUDE.md:328` still reads verbatim "team-only sees the three team workspaces and no `meus-dados`", byte-for-byte the pre-existing sentence (confirmed via `git diff CLAUDE.md`, which shows no edit inside `## Sales Ops Routing`). The new `## Development identity mode` section (`CLAUDE.md:262`) records the contradiction as open, names both sides (`getRolesFromHubClaims` vs. the routing sentence), and explicitly declines to resolve it, filing it in `nexo/ROADMAP.md` and pointing at `AUDIT.md`. Not harmonised. **Confirmed correct.**
2. **ONE-gate claim** - the original sentence "There is deliberately exactly ONE gate..." (`CLAUDE.md:29`) is untouched; three new sentences were appended directly after it (`CLAUDE.md:30-32`) that scope it ("in PRODUCTION, and in any run that does not set `SALES_AUTH_FAKE`...") rather than replacing or weakening it. **Confirmed correct** - though see Part 4: the scoping sentence's own confidence ("absent from the production artifact by construction") is the false part, not the qualification itself.
3. **Parked plan status** - `nexo/plans/feature-20260827-hub-sdk-210-access-model/05-dev-identity-fixtures.md` frontmatter still reads `status: parked` (unedited), and gained a dated `> **SUPERSEDED IN PART - 2026-09-21 - the prohibition only.**` blockquote above the frontmatter's closing fence plus a one-line pointer directly under the `### 1. No \`createDevHubClient\`, ever` heading. The four originally-forbidding passages (frontmatter `goal`, `acceptance`, the `rules` entry, and section 1's body) are left byte-identical, confirmed by diff. **Confirmed correct - amended in place, not rewritten or marked done.**

## Part 3 - the guard is not decorative

Deleted the `> **SUPERSEDED IN PART...**` blockquote from the parked plan (kept the file's other content, restored a byte-identical copy afterward from a scratch backup) and ran:

```
node --test scripts/__tests__/dev-identity-docs-reconciliation.test.mjs
```

Result: **RED**, exit code 1, `# fail 1` - `passes against the tree as shipped` failed with exactly the two expected violations (missing sentinel, and the resulting "note not above the prohibition" secondary check). The other three tests (synthetic positive/negative controls, vacuity control) all still passed, confirming the classifier itself is sound.

Restored the file from the scratch backup and re-ran: **GREEN**, exit 0, `# pass 4 / # fail 0`. `git diff` afterward showed only the original 13-line insertion - the tree was left exactly as found.

Confirmed wired into the root `test` script: `package.json`'s `test` entry runs
`node --test ... scripts/__tests__/auth-fake-isolation.test.mjs scripts/__tests__/dev-identity-docs-reconciliation.test.mjs && ...`, and it executed as part of the full `pnpm test` run in Part 4 (53 total `node --test` tests, 0 failures, matching the guard files' own combined counts).

## Part 4 - final integration gate

### Tiered results (real numbers)

- `pnpm run lint` - **PASS**, exit 0. All five lint-bearing workspaces (`packages/auth-fake`, `shared-types`, `shared-utils`, `apps/api`, `apps/web`) ran clean.
- `pnpm run type-check` - **PASS**, exit 0. `packages/auth-fake`, `shared-types`, `shared-utils`, `apps/api` (both `tsc --noEmit` and the scripts project), `apps/web` all clean.
- `pnpm test` (full suite) - **PASS**, exit chain completed through `build-contract: ok`.
  - `packages/shared-utils`: 3 test files, **80 passed**
  - `packages/auth-fake`: 1 test file, **35 passed**
  - `apps/api`: 55 test files, **601 passed**
  - `apps/web`: 75 test files, **940 passed**
  - Root `node --test` guard suite (no-legacy-auth, no-legacy-env-names, local-database-guard, auth-fake-isolation, dev-identity-docs-reconciliation): **53 passed, 0 failed**
  - `node scripts/no-legacy-auth.mjs`, `node scripts/no-legacy-env-names.mjs`, `node scripts/build-contract.mjs`: all clean (`build-contract: ok`)
  - **Total: 1709 unit/integration tests passed, 0 failed, across every workspace.**
- `pnpm run build` - **PASS**. `shared-types`, `shared-utils`, `apps/api` (`tsc && tsc-alias`), `apps/web` (`tsc --noEmit && vite build`) all succeeded; `scripts/assert-web-bundle-clean.mjs` confirmed `FXL_SALES_DEV_FAKE_ROSTER_SENTINEL is absent from apps/web/dist and still present under packages/auth-fake/src`.

### Security pass

**Q: Can any production build or production runtime reach the fake path? (the decisive question)**

**Yes, partially, and the documentation misdescribes why it currently doesn't go further.** I built the real, unmodified `apps/api/Dockerfile` (the file `docker-compose.yml` and, per `CLAUDE.md`'s Environments table, Coolify staging/production both build from) with `docker build -f apps/api/Dockerfile .` and inspected the resulting runtime image directly (no shortcuts, no mocked stages):

1. The `deps` stage runs `pnpm install --frozen-lockfile` (no `--prod`), so devDependencies - including `@fxl-sales/auth-fake` - are resolved. Because the deps stage only copies `apps/api/package.json`, `packages/shared-types/package.json` and `packages/shared-utils/package.json` (never `packages/auth-fake/package.json`), pnpm cannot find `packages/auth-fake` as a workspace project at that point, but it still creates the symlink `apps/api/node_modules/@fxl-sales/auth-fake -> ../../../../packages/auth-fake` (dangling at that stage).
2. The `build` stage's `COPY . .` brings in the **entire repository**, including the real `packages/auth-fake/` directory (`package.json`, `src/index.ts`, the whole roster). This makes the dangling symlink from step 1 resolve.
3. The final runtime stage does `COPY --from=build /app/packages ./packages` - copying the **whole** `packages/` tree, not a scoped subset - and `COPY --from=build /app/apps/api/node_modules ./apps/api/node_modules`, carrying the now-valid symlink forward.

I verified this empirically on the actual built image:
```
/app/packages/auth-fake/{package.json,src/,tsconfig.json}   <- present
/app/apps/api/node_modules/@fxl-sales/auth-fake              -> ../../../../packages/auth-fake  (resolves)
NODE_ENV=production                                          (baked into the image)
```

This directly contradicts `CLAUDE.md`'s claim ("the production install and the production image do not contain it at all") and the decision doc's claim ("`pnpm install --prod` never places it on disk, so there is nothing to import even if every other layer failed" - **this deployment never runs `pnpm install --prod` at all**). Layers 1-3 do not hold for this deployment path; the package is physically present in the shipped artifact.

**What actually stops exploitation today, and why it is thinner than documented:**
- I ran the real image with `-e SALES_AUTH_FAKE=1 -e NODE_ENV=production` (its baked-in default): boot correctly refused with the named error (`Error: SALES_AUTH_FAKE is set while NODE_ENV=production...`). This is Layer 4, doing all of the real work here - not "the belt" behind three structural braces as documented, but the **only** backstop.
- I then tried forcing `NODE_ENV=development` against the same production-built image (simulating an operator or a Coolify service misconfiguration): boot did **not** refuse, and it proceeded to `await import('@fxl-sales/auth-fake')` - which then crashed with `ERR_UNKNOWN_FILE_EXTENSION: Unknown file extension ".ts"`, because `packages/auth-fake`'s `package.json` points `"main"` straight at `./src/index.ts` with no build step (by design, so it stays out of `build:packages`), and plain `node` (the production runtime, no `tsx`) cannot load raw TypeScript. This crash is real, but it is an **accident of packaging**, not a designed security boundary: it is not asserted by any test, it is not mentioned in `CLAUDE.md` or the decision doc, and it would silently disappear the day anyone gives `packages/auth-fake` a build step (a natural-looking fix for the very workspace-resolution wrinkle described in point 1 above).
- `apps/web`'s deployment (Vercel, static assets, `vite build`) has no equivalent problem: I independently confirmed via the real build that the bundle-cleanliness check holds. This finding is API/Docker-specific.

So the honest state of the world: today, a live authentication bypass in the shipped API artifact needs *two* independent things to go wrong at once (`NODE_ENV` not literally `production`, *and* someone later gives the fake package a build step) rather than one. That is a materially different - and materially weaker - security story than "absent from the production artifact by construction," and `scripts/__tests__/auth-fake-isolation.test.mjs` (which only ever inspects the source tree, never the built artifact) cannot see this gap.

**Q: Is `requireHubAuth` still the only access gate on the real path, with `allowWithoutAccess` at default?**
Yes. `apps/api/src/middleware/app-auth.ts`: `const hubAuthMiddleware = hubSdkConfig ? requireHubAuth(hubSdkConfig) : null;` - no `allowWithoutAccess` argument, so it is the SDK's own default (`false`). `appAuthMiddleware` dispatches to `installedAppAuthAdapter ?? hubAppAuthMiddleware` - exactly one live gate per process, confirmed by reading `installAppAuthAdapter`'s second-install refusal.

**Q: Does the roster package carry any secret, real credential, or anything that should not be in a repo?**
No. Read the full 300+ lines of `packages/auth-fake/src/index.ts`: all emails are `*@fake.local`, all account/workspace ids are `user_fake_*`/`org_fake_*` literals, the token "signature" is the literal string `development-not-a-signature`, and the whole roster is static fixture data with no external references.

**Q: Is there any way the flag could be set unintentionally (default, fallback, active `.env` example line)?**
No default or fallback: `isFakeAuthRequested`/`isDevIdentityEnabled` both return `false` on anything but an exact truthy match, and no `.env` example (checked all four) ships either flag uncommented. The only way in is a human explicitly setting it or running a `*-fake` Make target. This part of the claim holds.

## Part 5 - end-to-end acceptance

DB: found `06--product--fxl-sales-db-1` already running and healthy on `localhost:5006` (pre-existing, shared across worktrees; I did not start or stop it). Ran `make migrate` (host/port confirmed `localhost:5006`, applied cleanly, idempotent notices only) and `make db-seed` (`seeded 3 org(s), 370 row(s) total`).

Booted with `make back-fake` (no Hub reachable on `localhost:9016` at any point):

```
[dev-identity] Ignoring the Hub configuration because SALES_AUTH_FAKE is active: hub-sdk: FXL_HUB_CONFIG.environment must be exactly one of "production", "staging" or "development"...
[dev-identity] SALES_AUTH_FAKE is active. Roster: team-owner, team-admin, product-admin, seller, finder, seller-finder, no-role, no-access, multi-org. Default identity: team-owner. Switch with the "x-fake-identity" header.
[fxl-sales-api] listening on http://localhost:3006 (development)
```

- `GET /health` -> **200**, `{"ok":true,"service":"fxl-sales-api","env":"development",...}`
- `GET /api/v1/sales-ops/bootstrap` with `x-fake-identity: team-owner` -> **200**, real seeded rows (e.g. a `won` sale, client "Construtora Ipê", seller "Ana Diretora", finder "Caio Indica")
- `GET /api/v1/sales-ops/bootstrap` with `x-fake-identity: seller` -> **200**, same org's real seeded rows (tenancy is `orgId`-scoped, not role-scoped, matching `## Tenancy`)
- `GET /api/v1/sales-ops/bootstrap` with `x-fake-identity: no-access` -> **402** `{"error":"payment_required","code":"no_org_access"}`, exactly the documented `MissingEntitlementPanel` trigger

All three match the documented/expected behaviour exactly.

### Cleanup

Identified the full process chain by PID: `make back-fake` (63141) -> `pnpm ... dev` (63519) -> `pnpm.cjs` (63522) -> `tsx watch` (63544) -> the actual listening `node` (63550, confirmed via `lsof -i :3006`). Killed top-down by exact PID (no name-pattern kill), verified every one of the five PIDs gone, and confirmed `lsof -i :3006` returns nothing. The pre-existing `06--product--fxl-sales-db-1` Postgres container was left running (I did not start it). Two throwaway Docker images I built for the Dockerfile inspection (`verify-deps-stage`, `verify-full-image`) were removed with `docker rmi`; a dangling `run-db-1` container/network/volume created by an accidental `make db-up` (port 5006 was already taken by the pre-existing container) was also removed.

Final `git status --short` in `<W>` matches the state given at the start of this task exactly (same five modified files, same three untracked files, no stray artifacts, no leftover `/tmp` probe files).

## Recommendation

Do not merge as-is. Before this can pass:
1. Fix `apps/api/Dockerfile` so `packages/auth-fake` genuinely cannot reach the runtime image - e.g. scope the final stage's `packages` copy to the specific packages the runtime needs (mirroring the deps stage's already-selective pattern) instead of `COPY --from=build /app/packages ./packages`, and/or run a `pnpm install --prod` (or `pnpm deploy`/prune) step before the runtime `COPY` of `node_modules` so devDependencies are actually excluded as the documentation claims.
2. Add a test that builds (or otherwise inspects, e.g. via a `pnpm --frozen-lockfile --prod` dry run or an actual `docker build` in CI) the real production artifact and asserts `packages/auth-fake` and `FXL_SALES_DEV_FAKE_ROSTER_SENTINEL` are absent - the existing `auth-fake-isolation.test.mjs` only ever inspects the source tree and cannot catch this class of defect, and `assert-web-bundle-clean.mjs` already proves this pattern works for the web half.
3. Correct `CLAUDE.md`'s `## Development identity mode` section and the decision doc once the fix lands, so the documented defense matches whatever is actually shipped - in particular, do not claim the package is "absent from the production artifact by construction" unless that has actually been demonstrated against the real Dockerfile, the way `assert-web-bundle-clean.mjs` demonstrates it for the web bundle.
