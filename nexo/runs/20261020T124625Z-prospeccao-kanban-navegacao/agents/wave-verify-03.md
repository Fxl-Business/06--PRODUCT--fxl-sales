# Wave 03 independent Verify

Verdict: **PASS**.

## Machine gate

- Ran `bash nexo/runs/20261020T124625Z-prospeccao-kanban-navegacao/wave-suite.sh` once, exit 0.
- Shared package builds passed.
- API type check passed for application, scripts, and tests.
- API ESLint passed for `src/` and `scripts/`.
- API unit suite passed: 100 files, 1,482 tests.
- PostgreSQL RLS lixeira suite passed: 1 file, 11 tests.
- `git diff --check 3dd4d4e` passed.
- Full command output: `.nexo/runs/20261020T124625Z-prospeccao-kanban-navegacao/scratch/wave-verify-03.log` at the repository root.

## Independent security and behavior review

- The restore route obtains `orgId`, `userId`, and the admin role from verified request context, then passes them to the service. Request body values do not set actor or privilege.
- The service requires organization, lead id, and deleted state for every restore. For a non-admin it also requires `deleted_by_user_id = actor.userId`. The same predicate guards both the locked read and update.
- A seller cannot restore another actor's deletion, a different organization's deletion, or an already restored lead. These cases are exercised in the RLS test and return `not_found` without identifying the row.
- The deleted-leads list retains `requireAdmin`; its service query remains organization scoped. The router integration test exercises the seller's 403 on that list and successful restore of their own deletion.
- A successful restore clears deletion metadata, restores stage position, and writes a new audit event. Existing transaction and rollback tests passed. The new ownership test checks one delete and one restore audit event.
- No security or functional blocker found in the diff from `3dd4d4e`.

No processes were left running by this Verify step.
