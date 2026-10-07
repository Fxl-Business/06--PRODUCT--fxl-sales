# Exec 01-api-lixeira

Commit: ad74ef0 on feat/20261007-01-api-lixeira.

## Red
Oracles written first and run on the unchanged code: lead-soft-delete-schema (5 fail: no 0028 files, no Drizzle columns), lead-contract (suite fails: lead-trash-service.ts missing), lead-routes (3 new cases 404 instead of 204/403), edition-gate-map (exhaustive test fails: 3 unclassified routes), leads-lixeira (cannot import lead-trash-service), lead-soft-delete-migration (3 fail: columns, constraint, index absent).

## Green
- Unit: src/db/__tests__ + leads + middleware + executor.test: 21 files, 423 tests pass.
- Integration (oracles plus all lead, audit, import regression files from the plan): 14 files, 137 tests pass (leads-lixeira 10, lead-soft-delete-migration 4).
- type-check (tsc, scripts, test tsconfigs): clean. eslint on changed files: clean. drizzle-kit generate --name noop: "No schema changes".
- drizzle-kit output for 0028 matched the plan's five statements byte for byte; header comment prepended.

## Deviations
- leadActor reuses cadastroActor (nit 1), behaviour identical (getHubActorDisplayName).
- Test harness: raw deleted_at fixture in the list case uses ::text::timestamptz because postgres.js rounds a timestamptz-typed parameter to milliseconds.
