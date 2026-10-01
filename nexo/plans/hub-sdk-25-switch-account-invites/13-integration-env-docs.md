---
id: 13-integration-env-docs
milestone: v4.1.0
status: todo
depends_on: [10-verify-findings-polish]
files_modified:
  - apps/api/.env.dev.example
  - scripts/__tests__/integration-env-docs.test.mjs
  - package.json
acceptance: "given a fresh clone that copies apps/api/.env.dev.example to apps/api/.env, when a developer runs pnpm --filter @fxl-sales/api test:integration against the local Docker DB, then every variable slice 10 made required (TEST_DATABASE_URL, ADMIN_DATABASE_URL; TEST_MIGRATE_DATABASE_URL optional, falling back to ADMIN_DATABASE_URL) is present with its local value, and no line says ADMIN_DATABASE_URL is optional for the integration suite."
goal: "Close the wave-4 verify finding: slice 10 made the integration URLs required but the dev example still documented ADMIN_DATABASE_URL as optional and never mentioned TEST_DATABASE_URL."
verifier_focus: "The example stays copyable and valid for env-example-contract.test.ts. Values are LOCAL only (localhost:5006, the fxl_sales_test role for TEST_DATABASE_URL, the local postgres superuser for ADMIN). The runtime meaning of ADMIN_DATABASE_URL (getAdminDb) is described truthfully. A guard test reads the example and the names resolveIntegrationDatabaseUrls requires, so they cannot drift again."
must_not_break:
  - "apps/api/src/config/__tests__/env-example-contract.test.ts"
  - "scripts/__tests__/local-database-guard.test.mjs and the SALES_ENV_FILE note in the same file."
rules:
  - "Added at Execute from wave4-verify.result.json (engine adapt)."
  - "The guard imports nothing from apps/api at runtime if that would need a build; parsing the names out of apps/api/test/rls/assert-test-role.ts source is acceptable only if it fails loudly when it finds zero names."
---

# Slice 13 - integration env docs

## Oracle

- `node --test scripts/__tests__/integration-env-docs.test.mjs` (new, wired into the root `test` script).
- `env-example-contract.test.ts`.
