# Production release v2.2.0

Flow: `nexo-ship-prod-ready`.
Milestone: `v2.2.0`.
Gate 3 approval: the user explicitly invoked the production-ready flow with `--auto` on 2026-07-16, approving the release cut and immediate production promotion without a staging validation pause.

## Release candidate

Tag: `v2.2.0`.
Release commit: `db8df37d8c420bd800cf15a2c228aa85ff7fac66`.
Previous release: `v2.1.0`.
The minor bump was derived from the feature commits since `v2.1.0`, with no breaking-change markers in the commit history or release diff.

The release corrects UTF-8 Hub JWT claim decoding, derives workspace visibility from Hub roles, adds the `Meus dados` personal workspace, and moves account actions into the sidebar footer.

## Migration and configuration risk

The release contains no database migrations, environment changes, deployment configuration changes, or dependency lockfile changes.
The delivery environment labels remain configured as the placeholder `<deploy-target>`, so branch pushes are the only deployment signal available to Nexo.

## Release verification

The independent verifier returned PASS for the exact release commit.
Lint, type-check, 256 unit and contract tests, 27 database integration tests, the production build, the legacy-auth security guard, and production plus full dependency audits all passed.
The detailed evidence is recorded in `release-verify.md`, and the durable verdict is recorded in `agents/release-verify.result.json`.

## Promotion

The annotated tag `v2.2.0` was created at the release commit and pushed to `origin`.
Before each environment push, Nexo fetched the current remote branch and confirmed it was an ancestor of the release commit.
The installed Git push command was used without force, so its default non-fast-forward rejection remained active after the explicit ancestry checks.
The existing `staging` branch was fast-forwarded from `7e1e5c2` to `db8df37`.
After staging succeeded, the existing `production` branch was fast-forwarded from `7e1e5c2` to the same `db8df37` commit.

## Milestone closure

The milestone summary is recorded in `nexo/milestones/v2.2.0/SUMMARY.md`.
The current milestone pointer was reset to `null` so the next slice can derive a fresh milestone version from its actual change type.
