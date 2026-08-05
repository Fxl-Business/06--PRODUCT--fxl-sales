# Release verification: v2.4.0

- Verdict: **PASS**
- Candidate: `a32b1a04fabbc63b5bb67ad411e23e90615e744d`
- Branch: `master`
- Base tag: `v2.3.1` at `8863b723ab16921296dc2bd85ec3c7697cb9482f`
- Verified: `2026-08-05`
- Mode: local release verification after blocker repairs

## Candidate identity and topology

`HEAD` and `origin/master` both resolve to `a32b1a04fabbc63b5bb67ad411e23e90615e744d`.
`v2.3.1` is an ancestor of the candidate.
The proposed `v2.4.0` tag is absent.
Remote `staging` and `production` both remain at `cd852bdb20c222cf612959a48f9568824363a572`.
No release tag or deployment pointer moved during verification.
The only untracked path is the pre-existing `.vscode/` directory, which was not modified.

The release range contains 220 changed files, 38,188 insertions, and 432 deletions.
Excluding `nexo/`, the range contains 80 changed files.

## Required release gate

| Command | Exit | Evidence |
|---|---:|---|
| `CI=true pnpm run lint` | 0 | All workspace lint targets completed without errors or warnings. |
| `CI=true pnpm run type-check` | 0 | Shared packages built and all workspace TypeScript checks completed. |
| `CI=true pnpm test` | 0 | 84 test files and 956 tests passed: shared utilities 80, API 342, and web 534. The auth and build contract checks passed. |
| Correctly role-split `CI=true pnpm --filter @fxl-sales/api test:integration` | 0 | 21 integration files and 130 tests passed with `fxl_sales_test` as a non-superuser, non-`BYPASSRLS` application role and `postgres` used separately for migration and admin setup. |
| `CI=true pnpm run build` | 0 | Shared packages, API, and the Vite web production bundle built successfully. |
| `pnpm audit --prod --audit-level high` | 0 | Eight moderate findings and zero high or critical findings. |
| `pnpm audit --audit-level high` | 0 | Eight moderate findings and zero high or critical findings. |
| `git diff --check v2.3.1..HEAD` | 0 | The complete release diff passed whitespace validation. |

All required commands ran once without watch mode.
Every process started by release verification exited.
Pre-existing development servers were observed and left untouched.

## Repaired release blockers

- Durable Hub session hydration, handler execution, and mutation flush now share one transaction and a row-level lock, so concurrent refreshes for one session serialize across replicas while different sessions remain independent.
- Professional payables persist `sale_professional_id`, and same-name professionals reconcile by durable identity instead of display name.
- Paid v2.3.1 full-cost one-shot professional payables now cover exactly one professional across upgrade and re-win, including ambiguous null-ID legacy rows, without duplicate obligations.
- Migration `0018_professional_payable_identity` now uses the shared phased migration runner with concurrent indexes, a not-valid then validated composite foreign key, bounded forced-RLS backfill transactions, retry safety, and journal-compatible crash recovery.
- Full dependency audit has no high or critical finding.
- Generated Nexo context packs have a narrowly scoped Git whitespace exemption while ordinary files still fail the whitespace gate.

## Release contents and operational notes

The release adds durable encrypted Hub BFF sessions, professional payment schedules, professional payable identity, legacy upgrade reconciliation, and the shared phased database migration runner.

Migrations included since `v2.3.1` are:

- `0016_hub_bff_session_store`
- `0017_professional_payment_split`
- `0018_professional_payable_identity`

Migration `0018` must be applied through the repository migration runner used by both production and integration startup.
It must not be applied through the stock all-migrations Drizzle transaction.

`HUB_SESSION_ENCRYPTION_KEY` remains optional and must be at least 32 characters when supplied.
When absent, stable key material is derived from `FXL_HUB_SECRET_KEY`.
All replicas must use the same effective key material or stored sessions will become unreadable.

## Version decision

The release contains `feat` commits after `v2.3.1`, so the next SemVer version is `v2.4.0`.

## Verdict

**PASS**.

The exact candidate is ready for Gate 3a approval to create tag `v2.4.0` and fast-forward `staging` to that tag.
