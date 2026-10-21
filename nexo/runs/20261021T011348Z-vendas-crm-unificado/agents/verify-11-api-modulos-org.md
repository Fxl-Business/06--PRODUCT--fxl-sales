# Verify 11-api-modulos-org - PASS

Commands (slice worktree, baseline 529a998):
- pnpm run type-check: 0 errors. pnpm run lint: 0.
- CI=true NODE_ENV=test pnpm test (incl. root guard list: no-legacy-auth/env-names, hub-sdk-pin, fxl-contracts-pin, integration-env-docs, build-contract): shared-utils 198/198, auth-fake 48/48, api unit 1603/1603, web 1926/1926, node guards 112/112.
- pnpm --filter @fxl-sales/api test:integration (serial, local DB 5006): 61 files, 549/549.

AC coverage: backfill 7 rows token_backfill + 12 concurrent calls (org-modules.test.ts); Construbom-like org exact leads 403s + clients/import pass; token no longer decides; full org unchanged; PUT toggle changes 403 on next request; 10 concurrent first requests; one loader call per request behind two gates (require-capability.test.ts:125); orcamento stage normal when off (200, kind normal) and 409 sale_required_for_conversion when on; RLS FORCE + tenant policy in 0029; operator allow-list compared with c.get('userId'), default deny, plain admin gets 403 module_operator_required, GET stays admin-only.

Mutations (scratch copy, worktree untouched): (1) context.ts falls back to token instead of DB: 6 integration tests red. (2) PUT without requireModuleOperator: 2 unit tests red. (3) moveLead/advance scope without modules (un-awaited/lost leadScope modules): orcamento test red. (4) operator read from header instead of userId: 8 tests red.

Findings:
- minor: PATCH of an orcamento/conversion stage still answers is_system 409 with orcamentos off though the stage projects as normal (stage-service.ts updateLeadStage uses legacyStageIsSystem). Fails closed, no data risk; fix in a later slice.
- minor: no grep-net leftover: all leadScope( callers awaited.
