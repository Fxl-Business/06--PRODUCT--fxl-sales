# Release Verification: v2.0.4

## Verdict

PASS

The exact release commit `4e6e2c19b6082dec34a2821cfd6cdf2e7da238cb` was verified on `master`.
The only pre-existing working-tree entries were the untracked `.vscode/` directory and `nexo/knowledge/doubts/20260707-missing-entitlement.md`, and both remained untouched.

## Required Checks

| Check | Result | Evidence |
|---|---|---|
| Exact commit and branch | PASS | `HEAD` equals the requested commit and the branch is `master`. |
| `CI=true pnpm test` | PASS | 27 test files passed with 213 tests: shared-utils 17, API 153, web 43. |
| `pnpm run lint` | PASS | API and web ESLint checks exited 0. |
| `pnpm run type-check` | PASS | All four workspace projects completed TypeScript checks with exit 0. |
| `pnpm run build` | PASS | Shared packages, API, and production web build completed with exit 0; Vite transformed 1,807 modules. |
| `pnpm audit --prod --audit-level=high` | PASS | No known vulnerabilities found. |
| `git diff --check v2.0.3..HEAD` | PASS | No whitespace errors. |

## Release Diff Review

The effective runtime change is limited to browser authentication token caching and its provider integration.
The new cache is memory-only, applies a 30-second expiry skew, coalesces concurrent refresh calls, and invalidates late results across logout and workspace changes.
The release adds `happy-dom` as an exact-version development dependency for the new TSX auth tests and expands the Vitest test glob; no production dependency version changed.
No API source, database schema, migration, environment file, Dockerfile, Vercel configuration, or Coolify configuration changed.
Added-line credential keyword inspection found only documentation and test-language references, and a repository scan found no private-key, AWS-key, GitHub-token, Slack-token, or live Stripe-key signatures.
No credential material was found in the release diff.
The remaining file changes are tests, lockfile metadata for the development dependency, `.gitignore`, and Nexo documentation and run records.

## Risk Assessment

Migration risk is none because the release contains no database or schema changes.
Deployment configuration risk is low because no deployment or runtime environment configuration changed.
The auth change is covered by focused cache and React provider tests plus the full local release gate.
