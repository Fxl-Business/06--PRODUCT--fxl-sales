# Verify 03 - Dependency Audit Remediation

Tested commit: `127cd40747d6b48cd08c52ab60b5279aa5cda33b`.

Verdict: PASS.

## Scope and lockfile

`git diff --name-only 127cd407^ 127cd407` reported only `apps/api/package.json`, `apps/web/package.json`, `pnpm-lock.yaml`, and `pnpm-workspace.yaml`.

`git diff --check 127cd407^ 127cd407` exited 0.

The manifest diff contains only compatible major-version development-tool updates, including `postcss` `^8.5.25`.

`pnpm-workspace.yaml` contains the exact `brace-expansion@<1.1.18: 1.1.18` override and no 5.x override.

`pnpm-lock.yaml` resolves `postcss@8.5.25`, `brace-expansion@1.1.18`, and `brace-expansion@5.0.9`.

`pnpm install --lockfile-only --frozen-lockfile` exited 0 using pnpm 10.17.1.

## Required command evidence

| Command | Exit | Evidence |
| --- | ---: | --- |
| `pnpm audit --prod --audit-level high` | 0 | Reports eight moderate findings and no high or critical finding. |
| `pnpm audit --audit-level high` | 0 | Reports eight moderate findings and no high or critical finding. |
| `CI=true pnpm run lint` | 0 | All four workspace lint targets completed. |
| `CI=true pnpm run type-check` | 0 | Shared package builds and all workspace type checks completed. |
| `CI=true pnpm test` | 0 | Shared utils 80, API 328, and web 534 tests passed; build-contract reported `ok`. |
| `CI=true pnpm run build` | 0 | Shared packages, API, and Vite web production build completed. |

No persistent processes were started by this verification.
