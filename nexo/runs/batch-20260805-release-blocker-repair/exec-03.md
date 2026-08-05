# Execute evidence - 03-dependency-audit-remediation

Tested commit: `127cd40747d6b48cd08c52ab60b5279aa5cda33b`

## Red evidence

`pnpm audit --prod --audit-level high` exited 0 with eight moderate findings and no high or critical findings.

`pnpm audit --audit-level high` exited 1 with six high findings.

The failing graph resolved `postcss@8.5.16`, `brace-expansion@1.1.15`, and `brace-expansion@5.0.7`.

The high findings were the PostCSS source-map path traversal advisory and the brace-expansion denial-of-service advisories.

## Green implementation

Ran `pnpm update --recursive postcss eslint @eslint/js typescript-eslint` without `--latest`.

Added the selector-specific override `'brace-expansion@<1.1.18': 1.1.18` to the existing `pnpm-workspace.yaml` overrides block.

Ran `pnpm install --lockfile-only` to regenerate `pnpm-lock.yaml`, followed by `pnpm install --frozen-lockfile` to synchronize the local dependency graph used by compatibility checks.

No 5.x brace-expansion override was added.

The final lock graph resolves `postcss@8.5.25`, `brace-expansion@1.1.18`, and `brace-expansion@5.0.9`.

The vulnerable lock entries `postcss@8.5.16`, `brace-expansion@1.1.15`, and `brace-expansion@5.0.7` are absent.

Only direct development-tooling ranges changed in the workspace manifests.

No runtime dependency changed.

## Verification evidence

`pnpm audit --prod --audit-level high` exited 0 with eight moderate findings and no high or critical findings.

`pnpm audit --audit-level high` exited 0 with eight moderate findings and no high or critical findings.

`CI=true pnpm run lint` exited 0 for all workspace projects.

`CI=true pnpm run type-check` exited 0 for all workspace projects.

`CI=true pnpm test` exited 0 with 942 tests passing across shared-utils, API, and web suites.

`CI=true pnpm run build` exited 0 and completed the shared packages, API, and production web build.

`git diff --check` exited 0 before the implementation commit.

The implementation commit changes only `apps/api/package.json`, `apps/web/package.json`, `pnpm-workspace.yaml`, and `pnpm-lock.yaml`.

## Commit

`127cd40747d6b48cd08c52ab60b5279aa5cda33b chore(deps): clear high-severity tooling advisories`

No long-running process was started or left active.
