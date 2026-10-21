# Plan check: fase0-1a (slices 01, 02, 03, 04)

Verdict: FAIL (one major defect in slice 04, fix is mechanical; slices 01, 02, 03 are PASS).

## Defects

1. MAJOR - plan 04 - the oracle run with `--git-base` (step 6 and the Commands section) fails as written.
   `check-levantamento.mjs` section 4 builds `changed` from `git ls-files --others --exclude-standard`, which today lists the run records `nexo/runs/<run>/agents/plan-fase0.result.json`, `plan-fase1a.result.json`, `plan-check.*`, `budget.json`, `policy-events.jsonl`, `policy.lock` (untracked, not ignored).
   Each is reported as "product or unexpected file changed", so the final oracle exits 1 and a haiku executor is tempted to hack it.
   Exact fix: in the script, drop every path that starts with `nexo/runs/` from `changed` before comparing (keep the allowed-set check for everything else, so any file under apps/, packages/, scripts/, root or CLAUDE.md still fails).
   Then recompute the script SHA-256 and update the pin in step 2 (`0d65e2b1...` becomes the new value), and re-run the red/green steps.
   Alternative without touching the script: drop `--git-base` from step 6 and the Commands, and make step 7 the gate: `git status --porcelain -- . ':!nexo/runs'` and `git diff --stat <base> -- . ':!nexo/runs'` must be empty.

2. MINOR - plan 04 - `depends_on` lists only slice 03 but the document is written against code after 01, 02 and 03 (step 1 requires the merges of all three). waves.sh puts 04 in wave 2 either way (verified), so no behaviour change; set `depends_on: ["01-marca-fxl-vendas", "02-etapas-seed-on-read", "03-funil-padrao-e-guard-aditivo"]` for honesty.

3. MINOR - plan 04 - 17 citations use the identifier `export`, which matches any exported line, so the checker cannot detect drift there. Prefer the symbol name in those 17 links (executor must not do it by hand; Verify spot-check covers it).

4. MINOR - plan 02 - comments that still assert the old rule are not in `files_modified`: `apps/api/scripts/seed-dev.ts:298` ("gets zero etapas", still true for the seed plan, add "until the first read seeds them"), `apps/api/src/domains/sales-ops/leads/lead-service.ts:1090` comment ("leads edition starts with zero etapas"), and the edicao-leads decision 5 note under `nexo/knowledge/decisions/`. Not behaviour, but stale rule text.

5. MINOR - plan 02 - `createLeadStage(db, org, {name:'Somente minha'})` in test case 6 must pass `LeadStageSchema.parse({ name: ... })` (the existing tests do that; signature takes `LeadStageInput`).

6. NOTE - plan 03 - 0c asks for a constant that is "fonte unica da seed"; the plan deliberately leaves `LEAD_STAGE_SEEDS` as the runtime seed (4 stages) and compares the 7-stage constant to migration 0022 through a legacy mapping, with a hook for the 0029 comparison. Consistent with 02 (ECV test expects the 4 seeds). Accepted, flagged in the report as "constant not yet consumed".

## Per-slice results

### 01-marca-fxl-vendas (PASS)
- Coverage: all user-visible hits found by my own grep are covered (7 lines in missing-entitlement-copy.ts, i18n pt-BR/en lines 3/20/276, index.html, template.ts 91/99/120/133/515, plan/leads.ts:191, server.ts:153, filenames in api routes.ts 24-25 and web types.ts 66-67, doc line 99). No additional string literal exists (checked BARE and BRAND regexes over src).
- Oracle verified by running the plan's test file in a scratch copy against the current tree: 17 pass, 3 fail (web literals, api literals, i18n/index.html), i.e. red exactly on the brand tests; positive control passes; every pin file exists and every pin passes; walkers visit 160 web / 98 api files; typescript resolves from scripts/ (5.9.3). Fails loudly on missing target (existsSync asserts).
- affected_tests: the web/api tests referenced exist and pass at baseline; none hard-codes the brand or filenames (import-routes.integration.test.ts uses the exported constants). Acceptable.
- files_modified inline, complete (root package.json test list gets the new file; registered only here). Wave-1 disjoint from 02 and 03 (waves.sh run: wave 1 = 01, 02, 03; wave 2 = 04).
- Safety: no technical id renamed; `/health` and boot tags untouched.
- Commands: oracle `node --test scripts/__tests__/brand-and-technical-ids.test.mjs`; affected web `pnpm --filter @fxl-sales/web exec vitest run src/sales-ops/__tests__/missing-entitlement-panel.test.tsx src/sales-ops/__tests__/entitlement-dead-end.test.tsx src/admin/sellers/__tests__/AdminSellersPage.test.tsx`; affected api `pnpm --filter @fxl-sales/api exec vitest run src/domains/import`; lint/type `pnpm --filter @fxl-sales/web lint && ... web type-check && ... api lint && ... api type-check`.
- Global guards touched: `node --test scripts/__tests__/no-legacy-env-names.test.mjs scripts/__tests__/auth-fake-isolation.test.mjs`, `node scripts/no-legacy-auth.mjs`, `node scripts/no-legacy-env-names.mjs`, root `pnpm test` list.

### 02-etapas-seed-on-read (PASS)
- Anchors checked (12+): stage-service.ts:79, stage-routes.ts:33-36, routes.ts:93-96 and imports 13-14, stages-seed.ts 22-34/62/92, service.ts:3147, lead-service.ts 1309-1310, CLAUDE.md lines 88 and 366-368, kanban-de-leads.md 75-76 and 87, seed-plan.test.ts:678, leads-stage-summary.test.ts:416, leads-lixeira header lines 16-34 and 695-707. All match.
- Behaviour reviewed: `ensureLeadStages` has-any-row guard, bare ON CONFLICT DO NOTHING and re-read give idempotency, no re-insert after rename/archive, no 500 under concurrency; `selectStages` order equals old `listLeadStages` order; callers of `listLeadStages` in tests all pre-seed or create a stage first (lead-stages-rls lines 80-98, 210, 232, 294-313). edition-gate-map still reaches handler (getDb proxy). Baseline of the affected unit suites is green.
- Stale-rule oracle `leads-edition-no-seed.test.ts` is renamed and re-pinned to the exact four callers; not weakened. Request 0b ACs (4 seeds, no dup, no reinsert, 2 concurrent GETs no 500) are all covered (plan uses 8 concurrent x 3 orgs).
- Commands: oracle `pnpm --filter @fxl-sales/api exec env VITEST_INTEGRATION=1 vitest run test/rls/lead-stages-seed-on-read.test.ts`; callers `pnpm --filter @fxl-sales/api exec vitest run src/domains/sales-ops/leads/__tests__/stages-seed-callers.test.ts src/domains/sales-ops/__tests__/lead-stages-routes.test.ts src/middleware/__tests__/edition-gate-map.test.ts`; integration list as in the plan; lint/type `pnpm --filter @fxl-sales/api lint && ... type-check`.
- Global guards touched: `leads/__tests__/lead-contract.test.ts` (asserts trash service has no ensureLeadStages), `edition-gate-map.test.ts`, `scripts/__tests__/seed-plan.test.ts`. Local DB container is up on 5006.

### 03-funil-padrao-e-guard-aditivo (PASS)
- Subpath export pattern verified (`exports` entries in packages/shared-utils/package.json ending with `./sales-edition`; tsconfig excludes `__tests__`; vitest config present; `scripts/build-contract.mjs` requires each imported subpath to be declared). No build or exports test needs a change besides the new entry.
- Ran the plan's scanner in a scratch copy: all 15 positive fixtures flagged with the named rule, all 12 negative fixtures clean, real drizzle folder: 29 files scanned, 7 with violations (0001 yields DROP), 0 files above 0028. Fails loudly on a missing folder. 0022 VALUES regex matches lines 134-139.
- Wave-1 files disjoint; no `package.json` root edit (vitest tests run through `pnpm -r test`). Migration journal ends at 0028.
- Commands: build `pnpm --filter @fxl-sales/shared-utils build`; oracle `pnpm --filter @fxl-sales/api exec vitest run src/db/__tests__/additive-migrations-guard.test.ts`; constant `pnpm --filter @fxl-sales/shared-utils exec vitest run src/__tests__/default-pipeline.test.ts`; parity `pnpm --filter @fxl-sales/api exec vitest run src/domains/sales-ops/leads/__tests__/default-pipeline-parity.test.ts`; neighbours single-role-db-contract and leads-schema-migration (integration); lint/type as in the plan.
- Global guards touched: `node scripts/build-contract.mjs`, `scripts/__tests__/api-test-typecheck.test.mjs`, `single-role-db-contract.test.ts`.

### 04-levantamento-entidades (FAIL only because of defect 1)
- Procedure run in scratch: awk extraction reproduces both SHA-256 pins (script `0d65e2b1...`, document `ac8a180d...`, 855 lines). Red (missing doc) exits 1 with "document not found". Pristine document: 666 citations / 585 unique, fails ONLY on the EXECUTOR-TODO markers (intended); classes {1 medio, 2 alto, 3 medio, 4 baixo, 5 medio, 6 baixo, 7 medio, 8 medio, 9 alto, 10 alto, 11 alto, 12 medio, 13 baixo}; 11 stage-kind and 18 stage_id reader files.
- Hand sample: 28 random citations resolve to the exact source line; semantic spot-checks (legacy `leads` has a single writer, conversions/service.ts:254, no reader; server.ts:102 route mount; consumer-mapping.ts:12; feed-routes.ts:45; schema.ts anchors) true.
- The three fixed high risks are alto: legacy `leads` (3.2), and the receivables/payables/settlements plus the `fxl-sales.obligation.*`/`settlement.*` events (both in 3.10, enforced alto by the checker). Judgement-based alto for 9 and 11 is conservative and acceptable.
- The checker requires one risk per entity, summary-table consistency, FXS01/FXS02, 0022 constraint names, pending rows P1-P3, em-dash absence; `--fix` re-anchors by nearest match (acceptable, final run is without it).

## Baseline global guards (all green at current HEAD)
- `CI=true node --test scripts/__tests__/*.test.mjs`: 91 pass, 0 fail.
- `node scripts/no-legacy-auth.mjs`, `node scripts/no-legacy-env-names.mjs`, `node scripts/build-contract.mjs`: ok.
- api vitest (single-role-db-contract, leads-edition-no-seed, lead-stages-routes, edition-gate-map, seed-plan, template, template-example, import-routes, plan-leads): 9 files, 364 tests pass.
- web vitest (missing-entitlement-panel, entitlement-dead-end, AdminSellersPage): 104 pass.
- waves.sh on the four plans: wave 1 = 01, 02, 03; wave 2 = 04; no overlap warnings.
- Not run (needs full integration pass, left to Verify): `leads-schema-migration.test.ts` and the rls list of 02.
