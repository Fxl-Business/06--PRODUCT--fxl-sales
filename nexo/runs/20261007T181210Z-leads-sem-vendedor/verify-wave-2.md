# Wave 2 verify (Gate 2, wave tier) - PASS

Tree: feat/20261007-00-run at d52389c. `git status --short`: only nexo/plans and nexo/runs untracked (no contamination).

| Check | Command | Exit | Result |
| --- | --- | --- | --- |
| Lint | `pnpm run lint` | 0 | api, web eslint clean |
| Type-check | `pnpm run type-check` | 0 | api (3 tsconfigs), web, packages clean |
| Unit | `CI=true pnpm test` | 0 | auth-fake 48, shared-utils 174, api 1426, web 1595 = 3243 passed; node:test 91 pass / 0 fail |
| Integration | `CI=true pnpm --filter @fxl-sales/api test:integration` | 0 | 48 files, 377 tests passed, no re-run needed |
| Build | `pnpm run build` | 0 | ok; assert-web-bundle-clean clean |
| Audit | `pnpm audit --prod --audit-level high` | 0 | 13 vulns (1 low, 12 moderate), none high; pre-existing |

## Security
- `git diff 1b26cf2..HEAD -- '**/package.json' pnpm-lock.yaml` is empty, so advisories are pre-existing.
- Em dash count in `git diff 1b26cf2..HEAD`: 0.
- Advisory lock: `sql\`SELECT pg_advisory_xact_lock(hashtext('fxl-sales:lead-board'), hashtext(${orgId}))\`` - orgId is a bound parameter via drizzle sql template, no string concatenation. Transaction scoped, taken before row locks in insertLead and moveLead; PATCH never takes it, so no cycle.
- Authz: unassigned pool visible only to an ACTIVE vendedor (`findActiveVendedor`); admin never claims; `or(own, isNull)` parenthesized so the org conjunct holds; claim only on unassigned row held FOR UPDATE; naming another seller on a claim is `seller_scope` 403; refused/converted writes never claim; org always first conjunct; no body-derived identity.
- No injection or authz issues found.

## Notes
No pre-existing failures observed, so no base worktree was needed. No processes left running.
