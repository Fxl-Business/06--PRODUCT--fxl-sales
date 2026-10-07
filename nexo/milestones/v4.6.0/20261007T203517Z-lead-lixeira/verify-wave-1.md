# Wave 1 verify (Gate 2, wave tier)

Tree: wave1-verify at d8ccf14 (master 1501b03 + slice 01). Verdict: PASS.

| # | Command | Exit | Result |
| --- | --- | --- | --- |
| 1 | pnpm run lint | 0 | clean |
| 2 | pnpm run type-check | 0 | clean (api, web, auth-fake, shared-utils) |
| 3 | CI=true pnpm test | 0 | node guards 91/91; auth-fake 48; shared-utils 174; api 1448 (99 files); web 1601 (123 files) |
| 4 | pnpm --filter @fxl-sales/api test:integration | 0 | 50 files, 391 tests passed, first run, no retries |
| 5 | pnpm run build | 0 | built; assert-web-bundle-clean ok |
| 6 | pnpm audit --prod --audit-level high | 0 | 13 vulns (1 low, 12 moderate), none high; dependency diff (package.json, lockfile) is empty, so pre-existing notes |

## Security read of the apps diff (16 files)
- GET /deleted and POST /:id/restore sit behind requireAdmin; POST /:id/delete is scope-checked via leadScope.
- The only raw SQL is a keyset row comparison in lead-trash-service.ts; values are bound parameters with casts, no sql.raw.
- deleted_by_user_id is written but never selected or projected (field-by-field projection).
- No em dash in the added diff lines.

## Migration 0028
Additive only: three nullable ADD COLUMN with no default, one partial CREATE INDEX, one CHECK constraint (all existing rows NULL, NULL pass). No UPDATE, DELETE or rewrite. Journal and snapshot added. The integration harness applied it cleanly (lead-soft-delete-migration.test.ts and leads-lixeira.test.ts passed).

No baseline worktree was needed: nothing failed.
