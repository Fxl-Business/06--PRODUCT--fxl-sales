# Release verify v4.7.3 (Gate 2)

Worktree hotfix3, branch hotfix/v4.7.3, HEAD 2e9ddbf (on ba1505f). Verdict: PASS.

- lint: exit 0
- type-check: exit 0
- CI=true pnpm test: exit 0 (auth-fake 48, shared-utils 174, api 1491, web 1749, node guards 91 pass 0 fail)
- cold build (tsbuildinfo and dist removed in worktree): exit 0, web bundle clean check ok
- pnpm install --frozen-lockfile --offline: Done, nothing changed, git status clean
- integration on fxl_sales_v473 (setup-env.ts reads the three vars): exit 0, 51 files, 403 tests passed
  - import-routes.integration.test.ts ran: 13 passed
  - executor.integration.test.ts ran: 9 passed
- diff ba1505f..HEAD: CLAUDE.md, import domain (template, xlsx-package and tests), nexo docs only; no apps/api/drizzle files; no package.json or lockfile change; 0 added em dashes.
