# Verify 12-web-modulos-navegacao (12a, 12b)

Verdict: PASS

## Commands
- focused (navigation-edition, navigation-modules, org-modules-shell, auth/__tests__, crm-pipeline): 12 files, 404/404
- full web vitest run: 155 files, 1961/1961
- web lint (eslint src/): 0 problems; web type-check (tsc --noEmit): 0 errors
- web build + node scripts/assert-web-bundle-clean.mjs: clean
- root guards (no-legacy-auth, no-legacy-env-names, auth-fake-isolation, dev-identity-docs, brand-ids, dev-localhost-only node tests): 64 pass / 0 fail; no-legacy-auth.mjs, no-legacy-env-names.mjs, build-contract.mjs ok
- API integration suite not run (per dispatch). Worktree status unchanged (clean).

## Checks
- navigation-edition.test.ts diff: only call arguments changed (modulesFor / modulesForEdition wrappers); literal tables untouched.
- navigation.ts: no per-edition parallel lists left; entries carry `requires`, filtered by hasEveryModule.
- navigation-modules.test.ts: one module off at a time hides exactly its entries; compact/leads set; vendas-* lists hidden together; id dropped when orcamentos off; follow-ups always visible.
- Shell: modules = bootstrap orgModules else token hint; `rolesAreAuthoritative = isSignedIn && modulesSettled`, both Navigate early returns gated by it, no null/Skeleton while signed out. Redirect loop risk: none (after settle modules are stable; a failed bootstrap settles on the hint; a refetch with no data falls back to the hint with no redirect). Cost: a brief render of the hint navigation while loading (hint equals the backfill, so differs only after a toggle). Minor, accepted.
- useSalesEdition projects OrgModulesContext, falls back to the token hint outside the shell; react.test.tsx covers it; auth-mock-edition-export 39/39.
- D6: legacyKindOf keys on effective behavior (lookup, no inline kind ===); LEGACY_KIND_BY_TYPE gone; stageOpensConversion keys on projected kind; board also passes onRequestConversion only when fieldSet is 'full' (derived from modules). Second independent gate.

## Mutation probes (scratch clone, deleted afterwards)
- M1 ignore `requires` in catalogue filter: 52 failures (navigation-edition, navigation-modules).
- M2 legacyKindOf from `type` again: 3 failures (crm-pipeline tests).
- M3 drop `modulesSettled` from rolesAreAuthoritative: 2 failures (both no-redirect-while-loading shell tests).
- M4 edition hook ignores OrgModulesContext: 1 failure (react.test.tsx).

## Findings
- minor: D6 shell-level test (`with orcamentos off the Proposta stage is a normal board stage and a drop on it calls the move, not onRequestConversion`) was required by the plan addendum but is absent from org-modules-shell.test.tsx. Coverage is by unit chain only (crm-pipeline.test.ts `behavior none maps to kind normal`, board-move.test.ts stageOpensConversion, plus the fieldSet gate). No blocker or major. Fix: add the drop test in org-modules-shell.test.tsx or leads-pipeline-container.test.tsx with an orcamento stage carrying behavior none.
- No em dash in new text; no id renames; no weakened assertions seen.
