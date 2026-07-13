# Production release v2.0.4

Flow: `nexo-ship-prod-ready`.
Milestone: null.
Gate 3 approval: the user explicitly requested production promotion on 2026-07-13.

## Release candidate

Tag: `v2.0.4`.
Release commit: `4e6e2c19b6082dec34a2821cfd6cdf2e7da238cb`.
Previous release: `v2.0.3`.
The patch bump was derived from the `fix` commits since `v2.0.3`.

The effective runtime change stabilizes browser authentication token refreshes through an in-memory expiry cache, concurrent refresh coalescing, and stale-operation guards.
The parked durable BFF session-store branch is not part of this release.
The release has no database migration or deployment configuration changes.

## Release verification

The independent verifier returned PASS for the exact release commit.
`CI=true pnpm test` passed 213 tests.
Lint, type-check, build, the production dependency audit, and `git diff --check` passed.
The release review found no credential material and no migration or deployment configuration risk.

Detailed evidence is in `agents/release-verify-report.md`.

## Promotion

The lightweight tag `v2.0.4` was created at the release commit and pushed to `origin`.
The existing `staging` branch passed the ancestry check and was fast-forwarded from `6ef8792` to `4e6e2c1`.
After staging succeeded, the existing `production` branch passed the ancestry check and was fast-forwarded from `6ef8792` to the same `4e6e2c1` commit.
No force push was used.
Remote `master`, `staging`, `production`, and tag `v2.0.4` all resolved to the release commit immediately after promotion.

The repository has no active Nexo milestone id, so no milestone summary or state advance was required.
