# Wave 3 verify (Gate 2): PASS

Tree: wave3-verify worktree, HEAD e59773906326752abc9f8e8a6f9ea1e2e962a829 (master 1501b03 + slices 01-05).

| Check | Command | Result |
| --- | --- | --- |
| Cold build | rm dist/tsbuildinfo; `pnpm --filter @fxl-sales/web build`; `pnpm run build` | exit 0 and 0; assert-web-bundle-clean: clean |
| Lint | `pnpm run lint` | exit 0 |
| Type-check | `pnpm run type-check` | exit 0 |
| Unit suite | `CI=true pnpm test` | exit 0; auth-fake 48, shared-utils 174, api 1454 (99 files), web 1699 (127 files), node:test 91/91 |
| Integration | `pnpm --filter @fxl-sales/api test:integration` | exit 0; 51 files, 400 tests passed |
| Audit | `pnpm audit --prod --audit-level high` | exit 0; 1 low, 12 moderate, no high; package.json/lockfile/workspace diff vs 1501b03 empty |
| Em dash | added lines of `git diff 1501b03..HEAD` | 0 |

Authz/injection review of the apps diff (api): GET /deleted and POST /:id/restore use requireAdmin; delete and stage summary use the seller scope predicate; every query filters by eq(orgId, c.get('orgId')) inside withTenant, drizzle parameterised, soft-delete filtered by liveLeadCondition/deletedLeadCondition; audit entries written with actorOrgId. No findings.

No failures; no base-worktree comparison needed.
