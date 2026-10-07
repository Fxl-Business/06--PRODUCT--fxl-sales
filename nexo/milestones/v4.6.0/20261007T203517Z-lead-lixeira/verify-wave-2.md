# Verify wave 2 - PASS

Tree: wave2-verify at f4f9c6a (master 1501b03 + slices 01-04). Run from worktree root.

| # | Command | Exit | Result |
|---|---------|------|--------|
| 1 | pnpm run lint | 0 | clean |
| 2 | pnpm run type-check | 0 | clean (web, api incl. scripts/test configs, packages) |
| 3 | CI=true pnpm test | 0 | auth-fake 48, shared-utils 174, api 1454, web 1658 passed; node --test 91 pass / 0 fail |
| 4 | pnpm --filter @fxl-sales/api test:integration | 0 | 51 files, 400 tests passed |
| 5 | pnpm run build | 0 | built; assert-web-bundle-clean: clean |
| 6 | pnpm audit --prod --audit-level high | 0 | 1 low, 12 moderate, no high or critical |

## Security
- Dependency diff vs 1501b03 (package.json, pnpm-lock.yaml): empty.
- New em dash in added lines of git diff 1501b03..HEAD: 0.
- dangerouslySetInnerHTML, sql.raw, raw SQL in the new wave: none. Summary uses parameterized drizzle with sql template aggregates only.
- GET /leads/summary uses resolveLeadScopePredicate and leadBoardConditions, the same scope as the list (seller scoping server-side).
- POST /:id/delete uses resolveLeadScopePredicate plus leadIdentityConditions (org + id + scope); out-of-scope reads not found. Deliberately not admin-gated so a vendedor can delete own leads.
- GET /deleted and POST /:id/restore are behind requireAdmin; restore filters by orgId and deleted condition inside withTenant.
- Actor comes from the verified context; audit written in the same tx.
- Web: no ids rendered observed in the diff scope (not exhaustively proven beyond grep for dangerous patterns).

Pre-existing failures: none. No flaky reruns needed.
