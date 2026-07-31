# Hotfix: the Vercel production build could not resolve a workspace subpath

/ Date: 2026-07-31
/ Release: `v2.3.1`, hotfix on top of `v2.3.0`

## Symptom

The `v2.3.0` production deploy of `apps/web` failed on Vercel at commit `b34c964`.

```text
src/sales-ops/SalesOpsApp.tsx(110,39): error TS2307: Cannot find module
  '@fxl-sales/shared-utils/sale-financials' or its corresponding type declarations.
src/sales-ops/__tests__/sale-margin-parity.test.ts(9,39): error TS2307: ...
Error: Command "pnpm --filter @fxl-sales/web build" exited with 2
```

The API half of the release deployed normally, so production briefly ran the new API schema behind the previous web bundle.

## Root cause

`vercel.json` sets `buildCommand: "pnpm --filter @fxl-sales/web build"`, which builds only the web app.
`packages/shared-utils` publishes its `./sale-financials` subpath as `./dist/sale-financials.d.ts`, and `dist/` is gitignored, so on Vercel's fresh clone the file does not exist.

Locally it always did exist.
Every root script begins with `pnpm run build:packages`: `build`, `type-check` and `test` all do.
So `packages/*/dist` was already on disk before `tsc` ever ran, and no local command could observe the gap.

The gap was latent, not new.
`v2.3.0` shipped the first `apps/web` import of `@fxl-sales/shared-utils` in the repo's history; at `v2.2.0` there were zero, so the build command's missing dependency step never mattered.

## Second fault found while fixing

Rebuilding the packages did not fix the reproduction at first.
`tsc` reported `Done` and emitted nothing, because `packages/*/tsconfig.tsbuildinfo` survived while `dist/` was deleted, and a `composite` project trusts that file.
Measured directly: plain `tsc` emitted 0 files and exited 0; `tsc --build --force` emitted 24.

This is the more dangerous of the two faults.
It is a build that reports success while producing no output, which is exactly the shape that lets a Verify agent record a PASS on a broken artifact.

## Fix

- `apps/web` builds its own workspace dependencies: `pnpm --filter @fxl-sales/web^... build && tsc --noEmit && vite build`.
  The `^...` filter selects the dependencies of web and excludes web itself, so there is no recursion.
  This is invocation-independent, which is why it was preferred over editing `vercel.json`: any deploy target, Docker build or hand-run of `pnpm --filter @fxl-sales/web build` now works from a clean checkout.
  `vercel.json` was deliberately left untouched, and the fix was validated against its exact unmodified `buildCommand`.
- `packages/shared-types` and `packages/shared-utils` build with `tsc --build --force`, so a stale `tsconfig.tsbuildinfo` can never turn a build into a silent no-op.
- `apps/api` was deliberately not changed.
  `apps/api/Dockerfile` already builds both shared packages before the API, which is why the API deployed cleanly, and its image build path was not worth disturbing during an outage.

## Why the suite did not catch it

Nothing in the repo ever built `apps/web` the way the deploy does.
Gate 2 ran `pnpm run build`, which builds packages first by construction, so the release-verify PASS on `v2.3.0` was accurate about the command it ran and silent about the command Vercel runs.
There is no hosted CI by design, so no environment performed a clean-clone build.

## Guard added

`scripts/build-contract.mjs`, wired into the root `test` script, asserts two static invariants:

1. Every `@fxl-sales/<pkg>/<subpath>` imported from an app's source is a declared entry in that package's `exports` map.
2. An app that imports a workspace package either builds its own dependencies via a `<name>^...` filter, or every deploy entrypoint that builds it (`vercel.json`, `apps/api/Dockerfile`) builds that dependency first.

Proven in both directions: the guard passes with the fix, and reverting `apps/web`'s build script to its `v2.3.0` form makes it fail naming both packages and the remedy.

The guard is static and cheap, and it is not a substitute for a real clean-clone build.
It pins the config shape that made the clean-clone build impossible, which is the thing that actually regressed.

## Verification

Reproduced before fixing: with `packages/*/dist` and `packages/*/tsconfig.tsbuildinfo` removed, `pnpm --filter @fxl-sales/web build` failed with the identical two `TS2307` errors and exit status 2.
After the fix, from the same clean state, the identical command exits 0 and writes `apps/web/dist/index.html`.
