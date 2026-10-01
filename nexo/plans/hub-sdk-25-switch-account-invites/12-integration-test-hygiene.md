---
id: 12-integration-test-hygiene
milestone: v4.1.0
status: todo
depends_on: [10-verify-findings-polish]
files_modified:
  - apps/api/src/domains/sales-ops/__tests__/producer-emission.integration.test.ts
  - apps/api/vitest.config.ts
  - apps/api/test/rls/test-database-urls.ts
  - apps/api/test/rls/*.test.ts
  - apps/api/test/rls/*.integration.test.ts
  - apps/api/src/domains/integration/__tests__/outbox-adapter.integration.test.ts
  - apps/api/src/db/__tests__/settlement-test-cleanup.ts
acceptance: "given the integration suite, when it runs, then producer-emission.integration.test.ts is deterministic (passes 20 of 20 isolated runs and every full run), no integration file carries a dead `?? DATABASE_URL ?? 'postgresql://postgres:postgres@...'` fallback (they read the URLs setup-env.ts already resolved, through one tiny helper), and the vitest.config.ts comment describes the real URL source."
goal: "Fix a pre-existing flaky integration test found by slice 10's Gate 2 and delete the dead superuser fallbacks that contradict the new no-postgres-default rule."
verifier_focus: "Diagnose the flake first and fix its CAUSE (reading rows whose `position` is still NULL ordered by `position`), not by retrying or sleeping; position is assigned after commit by the single publisher per CLAUDE.md, so the test must either order by a deterministic column that exists today or drive the publisher before asserting order - never assign position at INSERT. The fallback cleanup is mechanical and behaviour-neutral: the full integration suite passes as fxl_sales_test before and after with identical counts."
must_not_break:
  - "CLAUDE.md Integracao rules: integration_outbox.position is NULL until the single elected publisher assigns it AFTER commit."
  - "setup-env.ts and assert-test-role.ts behaviour from slice 10."
  - "Unit-test files that use postgres URL strings as FIXTURES (apps/api/src/middleware/__tests__/*, apps/api/src/auth/__tests__/*, invitations-client.test.ts, assert-test-role.ts itself) are out of scope."
rules:
  - "Added at Execute from 10-verify.result.json (engine adapt). Pre-existing on master, fixed here because the owner treats flakes as defects."
  - "One helper `test-database-urls.ts` exports the resolved URLs from process.env and throws if setup-env did not run; every integration file imports it instead of its own fallback chain."
---

# Slice 12 - integration test hygiene

## Oracle

- `producer-emission.integration.test.ts` 20 isolated runs green.
- `pnpm --filter @fxl-sales/api test:integration` green as `fxl_sales_test`, same test count as before.
- `git grep -n "postgres:postgres" -- apps/api/test apps/api/src/domains/integration apps/api/src/db/__tests__` returns only `assert-test-role.ts` fixtures, if any.
