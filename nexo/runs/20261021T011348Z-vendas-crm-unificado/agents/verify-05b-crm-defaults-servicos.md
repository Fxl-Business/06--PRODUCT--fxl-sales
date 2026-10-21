# Verify 05b-crm-defaults-servicos

Verdict: PASS (one minor finding).
The helper was not used (no prepared baseline dir); the plan commands were run directly, Postgres one file at a time.

## Commands
- shared-utils build, then `pnpm --filter @fxl-sales/shared-utils test`: 8 files, 187/187 (includes crm-model 6, default-pipeline, sales-edition unchanged).
- `pnpm --filter @fxl-sales/api exec vitest run src/domains/crm src/domains/sales-ops/leads`: 7 files, 59/59 (crm-seed-callers 1, old stages-seed-callers green).
- Oracle `VITEST_INTEGRATION=1 vitest run test/rls/crm-defaults.test.ts`: 6/6, run 5 times, always green (3 concurrent first callers never error, one pipeline, 7 stages, 22 transitions, 1 field).
- `pnpm --filter @fxl-sales/api lint`: 0 problems. `pnpm run type-check`: all packages Done.
- Subpath export: from apps/api, `import('@fxl-sales/shared-utils/crm-model')` resolves; `modulesForEdition('leads')` = only importacao and clientes true.
- Nothing outside the defaults module and tests imports defaults.ts; default-pipeline.ts and sales-edition.ts untouched; no em dash in the diff; no destructive SQL; worktree status clean before and after.

## Mutations (scratch copy)
- Remove children guard (`inserted.length > 0` -> true): oracle red (concurrency).
- Remove Cliente field upsert: oracle red (3 tests).
- `removable: true`: oracle red and crm-model.test red.
- `planPipelineTransitions` without reverse edge / without pausado re-entry: crm-model.test red (2 each).
- `CAPABILITY_MODULES.import` -> orcamentos, and `.every` -> `.some` with a widened map: crm-model.test red.
- A stray caller of ensureCrmDefaults in src: crm-seed-callers red.
- SURVIVOR: remove the `existing.length > 0` early return: oracle stays 6/6 green, because the unique indexes (is_default, system_key, name) make the bare INSERT conflict anyway.
  A probe (existing pipeline with is_default=false, system_key NULL, other name) goes red without the guard, so the guard is real behavior that the oracle does not pin.

## Findings
- minor: `apps/api/test/rls/crm-defaults.test.ts` test 4 ("any pipeline is the guard") only renames/archives the DEFAULT pipeline, so the "any row" guard is not pinned.
  Fix: add a case that sets `is_default=false, system_key=NULL` on the seeded pipeline and expects `ensureDefaultPipeline` to return one row.
