# Audit - feature-20260807-hub-sdk-130-session-hardening

Items an autopilot run parked for the human rather than deciding unilaterally.
Autopilot continued past each of these; none of them blocked a slice from landing on `master`.

## A1. The published `@fxl-business/hub-sdk@1.3.0` is unresolvable, and we are shipping on a local patch

**Status: needs a human decision before Gate 3 (promotion), not before merge to `master`.**

The published `1.3.0` tarball cannot be imported by anything.
Its `package.json` points `main`, `types` and `exports` at `./src/*.ts`, while `files` ships only `["dist","schema","MIGRATION.md"]`, so `src/` is not in the tarball at all.
Node fails with `ERR_MODULE_NOT_FOUND` and Vite with `Failed to resolve entry for package`.
`1.2.0` is correct and points at `dist`, so the `publishConfig` swap was applied for `1.2.0` and not for `1.3.0`.

Verified independently by the orchestrator, not taken from the executor:

```
$ npm view @fxl-business/hub-sdk@1.3.0 main
./src/index.ts
$ npm view @fxl-business/hub-sdk@1.2.0 main
./dist/index.cjs
```

The shipped `dist/` is complete and correct.
Only the pointers are wrong, so slice 01 bridged it with `patches/@fxl-business__hub-sdk@1.3.0.patch`, a single hunk rewriting those four fields to the `publishConfig` values already present in the same file.
No dependency code is modified.

**The decision:** promote on a patched dependency, or hold the feature on `master` until the Hub republishes a fixed `1.3.1`.

Arguments for holding: a `pnpm patch` is a build-time dependency on a local file that every deploy environment must apply, and Vercel builds the web app from the `production` branch, so the patch has to survive that path too.
Arguments for shipping: the patch is inert with respect to behaviour, the alternative is staying on a `1.2.0` whose BFF answers `401` for a transient Hub outage, and the patch is self-deleting the moment `1.3.1` lands.

This has been reported to the Hub as section 1b of `HUB-RESPONSE.md`, with a request to republish and to add a `prepublishOnly` assertion that the packed entry points resolve.

### A1a. The patch key is exact but the dependency range is a caret

Surfaced by the slice 01 verifier, recorded here rather than fixed, because slice 01 was already verified and changing it would invalidate that verification.

`apps/api/package.json` and `apps/web/package.json` both declare `"^1.3.0"`, while `pnpm-workspace.yaml` keys the patch to `@fxl-business/hub-sdk@1.3.0` exactly.
If the Hub publishes a `1.3.1` that still carries the packaging bug, a `pnpm update` resolves it unpatched and the package becomes unresolvable again, with the failure landing at import time far from its cause.

`--frozen-lockfile` installs are safe today, which is what CI and the deploy path use.
Consider pinning the range exactly for as long as the patch exists, and remove both together when `1.3.1` is confirmed good.

## A2. Frame acceptance criterion 8 was amended mid-run

**Status: recorded, no action needed, but the human should know the scope narrowed.**

Criterion 8 originally read "supersedes the prior session **for that account**", taken from the Hub's own invariant 3.
That form is unimplementable under SDK 1.3.0: `store.create` is called from exactly one place in the bundle and is never passed an `accountId`, so `hub_bff_sessions.account_id` is unconditionally `NULL`.
It would also fail to close the threat it names, while logging every operator out of every other device.

Amended to session-id keying in `00-OVERVIEW.md`, with the full reasoning, and reported back to the Hub.
The plan-checker flagged that an autopilot run should not narrow an approved criterion silently; this entry is that non-silence.
