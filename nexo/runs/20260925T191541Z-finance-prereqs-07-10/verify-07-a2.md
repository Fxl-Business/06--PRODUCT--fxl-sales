# Verify 07-admin-gate-and-brl (attempt 2)

Verdict: PASS.
Worktree `.worktrees/20260925T191541Z-finance-prereqs-07-10/07-admin-gate-and-brl`, branch `feat/20260925-07-admin-gate-and-brl`, head `451c1b0`, base `2f1f406`.
Diff has no `nexo/runs` or `nexo/plans` files and no added em dash.
The source diff matches plan Design A, B and C line for line.

## Commands

| Command | Exit | Result |
| --- | --- | --- |
| api vitest run financial-admin-gate, transition-routes, routes | 0 | 3 files, 87 tests passed |
| web vitest run mutation-error-banner, settings-currency-brl, financial-mutation-forbidden, entitlement-dead-end, sales-transition-actions, sale-save-error | 0 | 6 files, 30 tests passed |
| `pnpm run lint` | 0 | clean |
| `pnpm run type-check` | 0 | clean |
| `CI=true pnpm test` | 0 | auth-fake 35, shared-utils 155, api 678 (63 files), web 998 (85 files), node guards 55 pass 0 fail |

## Acceptance criteria

1. Four routes answer 403 admin body for seller, finder, undefined and never call the service: implemented (`requireAdmin` on each route), asserted by 12 rows of `rejects %s for role %s ...`. Probes A1-A4 each kill exactly that route's 3 rows.
2. Admin gets 2xx with the verified org: asserted by `lets an admin through %s` (`slice(0, 2)` equals `[mockedDb, 'verified-org']`). Probe A5 kills.
3. POST /sales won from non-admin answers 403 before validation, createSale never called, even for invalid body: implemented on the raw body; asserted. Probe A6 kills 4 tests.
4. Seller draft/open POST /sales answers 201: asserted. Probe A7 (requireAdmin on POST /sales) kills.
5. Admin won POST /sales answers 201: asserted (`lets an admin create a won proposta`).
6. USD is 400 and upsertSettings not called; omitted currency persisted as BRL: `z.literal('BRL').default('BRL')`. Probe A8 kills the USD test, probe A9 kills the omitted test.
7. Configuracoes: no picker, no USD/Dolar, read-only `Real (BRL)`, always submits BRL even with legacy USD: asserted by `settings-currency-brl.test.tsx`. Probe P4 (echo stored currency) kills `saves BRL even when the stored currency is a legacy USD`.
8. A 403 on settings, transition and cancel-contract keeps the screen, shows the pt-BR alert, never ForbiddenPanel: asserted by three shell tests in `financial-mutation-forbidden.test.tsx` driving the real buttons through the real `apiFetch`.
   The previous gap is closed: probe P1 (drop `reportMutation` from `transitionSale.mutate` ALONE) fails `keeps Vendas on screen ... when a transition answers 403`; probe P2 (cancel-contract ALONE) fails `... when cancel-contract answers 403`; probe P3 (settings) fails the Configuracoes case.
9. SalesView canManage requires operacional AND admin: implemented (`workspace === 'operacional' && profile.roles.includes('admin')`).
   Probe P5 (drop the admin conjunct) survives the whole web suite, but it is an equivalent mutant: `resolveSalesOpsRoute` only yields `operacional` when `getVisibleWorkspaces(roles)` contains it, which requires `admin`. The conjunct is defense in depth, the plan names no oracle for it. Not blocking.
10. Docs: CLAUDE.md (Access gate bullet and `Financial role gate (PC23)` block), `propostas.md` (+21) and `auth-model.md` (+3) carry the gate and BRL lock in the same branch.

## Mutation probes (all restored with `git checkout --`, tree clean afterwards)

- P1 transition without reportMutation: RED (1 test).
- P2 cancel-contract without reportMutation: RED (1 test).
- P3 settings without reportMutation: RED (1 test).
- P4 activeSettings echoes stored currency: RED (1 test).
- P5 canManage without admin conjunct: survives, equivalent mutant (see criterion 9).
- A1-A4 drop requireAdmin from each gated route: RED (3 rows each).
- A5 hasAdminRole returns false: RED (37 tests).
- A6 disable won branch on POST /sales: RED (4 tests).
- A7 requireAdmin on POST /sales: RED (5 tests).
- A8 currency back to z.string: RED (1 test).
- A9 drop `.default('BRL')`: RED (1 test).
- A10 fail-open predicate (not seller and not finder): RED (9 tests, every undefined-role row).

## Security

- Gate fails closed: `hasAdminRole` is `userRole === 'admin'`; undefined role is refused (A10 proves the undefined rows are load-bearing).
- Body is `{error:'forbidden',reason:'admin_role_required'}` from the single `ADMIN_ROLE_REQUIRED_BODY`; the only non-test literal in `apps/api/src` is in `require-admin.ts` (plus a pre-existing doc comment in `lead-routes.ts`).
- `requireAdmin` runs before id checks on the `:id` routes, so no id probing by non-admins.
- Org scoping unchanged: handlers still pass `c.get('orgId')`; admin rows assert the verified org reaches the service.
- UI copy names no role, account or workspace id; the banner renders only fixed pt-BR copy.

No process left running; worktree clean at `451c1b0`.
